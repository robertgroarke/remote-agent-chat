'use strict';

const crypto = require('crypto');

const FLEET_SUMMARY_SCHEMA_VERSION = 1;
const FLEET_SUMMARY_PARSER_VERSION = 'fleet-summary-v1';
const FLEET_SUMMARY_MAX_BYTES = 1024;
const SUMMARY_TEXT_CHARS = 96;
const TITLE_CHARS = 80;
const CREDENTIAL_RE = /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i;
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/gi;
const DURATION_ONLY_RE = /^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i;
const DURATION_LIKE_RE = /^[+-]?\d+\s*[dhms]\b/i;
const AGE_ONLY_RE = /^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i;
const STATUS_ONLY_RE = /^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i;
const PLACEHOLDER_ONLY_RE = /^(?:new chat|no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i;
const SURFACE_ONLY_RE = /^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i;

function normalizedText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rejectedSummaryTextReason(value, { title = false } = {}) {
  const text = normalizedText(value);
  if (!text) return 'empty';
  if (CREDENTIAL_RE.test(text)) return 'credential_shape';
  if (DURATION_ONLY_RE.test(text)) return 'duration_only';
  if (DURATION_LIKE_RE.test(text)) return 'duration_malformed';
  if (AGE_ONLY_RE.test(text)) return 'age_only';
  if (STATUS_ONLY_RE.test(text)) return 'status_only';
  if (PLACEHOLDER_ONLY_RE.test(text)) return 'placeholder_only';
  if (SURFACE_ONLY_RE.test(text) && !title) return 'surface_label_only';
  if (/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(text)) return 'structured_blob';
  if (/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(text)) return 'command_shape';
  return '';
}

function boundedSummaryText(value, maximum = SUMMARY_TEXT_CHARS, options = {}) {
  let text = normalizedText(value);
  if (rejectedSummaryTextReason(text, options)) return '';
  text = text.replace(ABSOLUTE_PATH_RE, ' ').replace(/\s+/g, ' ').trim();
  ABSOLUTE_PATH_RE.lastIndex = 0;
  if (!text || CREDENTIAL_RE.test(text)) return '';
  return text.slice(0, maximum).trim();
}

function scalarMessageText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.command || part.arguments || part.args || part.stdout || part.stderr || part.workdir) return '';
    return typeof part.text === 'string'
      ? part.text
      : typeof part.content === 'string'
        ? part.content
        : typeof part.markdown === 'string' ? part.markdown : '';
  }).filter(Boolean).join(' ');
}

function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  return boundedSummaryText(scalarMessageText(message.content || message.text || message.content_blocks));
}

function isoTimestamp(...values) {
  for (const value of values) {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
    const ms = Number.isFinite(numeric)
      ? (numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric)
      : Date.parse(String(value || ''));
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  return null;
}

function normalizedRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ['user', 'assistant'].includes(role) ? role : 'other';
}

function privacyKey(...parts) {
  return crypto.createHash('sha256').update(parts.map(part => String(part || '')).join('\0'), 'utf8').digest('hex').slice(0, 20);
}

function normalizedGoalState(goal) {
  const raw = String(goal?.state || goal?.status || goal?.raw_state || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (['active', 'running', 'working', 'pursuinggoal'].includes(raw)) return 'active';
  if (['paused', 'pausedgoal', 'goalpaused'].includes(raw)) return 'paused';
  if (['blocked', 'goalblocked', 'needsattention', 'waitingforuser'].includes(raw)) return 'blocked';
  if (['usagelimited', 'ratelimited', 'goalusagelimited', 'goalratelimited'].includes(raw)) return 'usageLimited';
  if (['budgetlimited', 'goallimited', 'goalbudgetlimited'].includes(raw)) return 'budgetLimited';
  if (['complete', 'completed', 'achieved', 'goalachieved'].includes(raw)) return 'complete';
  if (['cancelled', 'canceled', 'stopped', 'goalcancelled', 'goalcanceled', 'goalstopped'].includes(raw)) return 'cancelled';
  if (['failed', 'failure', 'goalfailed'].includes(raw)) return 'failed';
  return 'unknown';
}

function normalizedWorkState(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
  const states = {
    active: 'active',
    paused: 'paused',
    blocked: 'blocked',
    usagelimited: 'usageLimited',
    ratelimited: 'usageLimited',
    budgetlimited: 'budgetLimited',
    complete: 'complete',
    completed: 'complete',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    failed: 'failed',
    idle: 'idle',
    working: 'working',
  };
  return states[normalized] || null;
}

function latestMessageFacts(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  const counts = { message_count: rows.length, user_count: 0, assistant_count: 0, other_count: 0 };
  let latestUser = null;
  let lastDisplayable = null;
  let rejectedReason = '';
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const role = normalizedRole(row?.role);
    counts[`${role}_count`] += 1;
    const raw = scalarMessageText(row?.content || row?.text || row?.content_blocks);
    const text = messageText(row);
    if (!text && raw && !rejectedReason) rejectedReason = rejectedSummaryTextReason(raw);
    if (!text || role === 'other') continue;
    const at = isoTimestamp(row?.timestamp, row?.created_at, row?.ts, row?.server_ts);
    lastDisplayable = { role, text, at };
    if (role === 'user') latestUser = { text, at };
  }
  return { counts, latestUser, lastDisplayable, rejectedReason };
}

function currentWorkFact(activity, latestUser) {
  const source = activity && typeof activity === 'object' ? activity : {};
  const provided = source.work_context && typeof source.work_context === 'object' ? source.work_context : null;
  const providedText = boundedSummaryText(provided?.text);
  if (providedText) {
    return {
      text: providedText,
      source: boundedSummaryText(provided?.source, 32) || 'provided',
      kind: boundedSummaryText(provided?.kind, 24) || 'activity',
      state: boundedSummaryText(provided?.state, 24) || null,
      at: isoTimestamp(provided?.updated_at, source.updated_at),
    };
  }
  const goal = source.goal && typeof source.goal === 'object' ? source.goal : null;
  const goalText = boundedSummaryText(goal?.objective || goal?.text);
  const goalState = normalizedGoalState(goal);
  if (goalText && goalState !== 'unknown') {
    return { text: goalText, source: 'goal', kind: 'goal', state: goalState, at: isoTimestamp(goal?.updated_at, goal?.observed_at, source.updated_at) };
  }
  const tasks = Array.isArray(source.task_list?.tasks) ? source.task_list.tasks : [];
  const task = tasks.find(row => /^(?:active|in[_ -]?progress|working|running|pending|queued|todo)$/i.test(String(row?.state || row?.status || '')));
  const taskText = boundedSummaryText(task?.text || task?.subject || task?.description || task?.label);
  if (taskText) return { text: taskText, source: 'task_list', kind: 'plan', at: isoTimestamp(task?.updated_at, source.task_list?.updated_at, source.updated_at) };
  const currentText = boundedSummaryText(source.current?.label || source.current?.title || source.current?.name);
  if (currentText) return { text: currentText, source: 'current', kind: 'activity', at: isoTimestamp(source.current?.updated_at, source.current?.since, source.updated_at) };
  return latestUser ? { text: latestUser.text, source: 'latest_user_request', kind: 'request', at: latestUser.at } : null;
}

function summaryIdentity(sessionId, session, previous) {
  const runtime = session && typeof session === 'object' ? session : {};
  const prior = previous && typeof previous === 'object' ? previous : {};
  const rawSessionIdentity = runtime.target_signature || runtime.cliSessionId || runtime.cli_session_id || sessionId;
  const sessionKey = privacyKey('session', sessionId, rawSessionIdentity);
  const sameSession = prior.session_key === sessionKey;
  const sessionGeneration = sameSession
    ? Math.max(1, Number(prior.session_generation) || 1)
    : Math.max(1, Number(prior.session_generation) || 0) + 1;
  const rawThreadIdentity = runtime._activeChatKey || runtime._activeThreadKey || runtime.cursorAgentId
    || runtime.cliSessionId || runtime.cli_session_id || runtime.v2ConversationId || '';
  const threadKey = rawThreadIdentity
    ? privacyKey('thread', sessionKey, rawThreadIdentity)
    : (sameSession && prior.thread_key ? prior.thread_key : privacyKey('thread', sessionKey, 'default'));
  const sameThread = sameSession && prior.thread_key === threadKey;
  const threadGeneration = sameThread
    ? Math.max(1, Number(prior.thread_generation) || 1)
    : Math.max(1, Number(prior.thread_generation) || 0) + 1;
  return { session_key: sessionKey, session_generation: sessionGeneration, thread_key: threadKey, thread_generation: threadGeneration };
}

function summaryContentSignature(value) {
  const copy = { ...(value || {}) };
  delete copy.producer_seq;
  delete copy.summary_seq;
  return JSON.stringify(copy);
}

function titleConfidence(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'native') return 'authoritative';
  if (normalized === 'summary' || normalized === 'message') return 'derived';
  return 'unknown';
}

function buildProducerFleetSummary({ sessionId, session, messages, previous = null } = {}) {
  if (!sessionId) return null;
  const runtime = session && typeof session === 'object' ? session : {};
  const facts = latestMessageFacts(messages);
  const identity = summaryIdentity(sessionId, runtime, previous);
  const title = boundedSummaryText(runtime.chat_title, TITLE_CHARS, { title: true });
  const work = currentWorkFact(runtime.activity, facts.latestUser);
  const activityAt = isoTimestamp(runtime.activity?.updated_at, runtime.last_seen_at);
  const roleImbalance = facts.counts.assistant_count > 0 && facts.counts.user_count === 0
    ? 'assistant_without_user'
    : facts.counts.user_count > 0 && facts.counts.assistant_count === 0
      ? 'user_without_assistant'
      : 'balanced';
  const candidate = {
    schema_version: FLEET_SUMMARY_SCHEMA_VERSION,
    parser_version: FLEET_SUMMARY_PARSER_VERSION,
    ...identity,
    title: title || null,
    title_source: title ? String(runtime.chat_title_source || 'summary').slice(0, 24) : null,
    title_confidence: title ? titleConfidence(runtime.chat_title_source) : 'unknown',
    latest_user_request: facts.latestUser?.text || null,
    latest_user_request_at: facts.latestUser?.at || null,
    current_work: work?.text || null,
    current_work_source: work?.source || null,
    current_work_kind: work?.kind || null,
    current_work_state: work?.state || null,
    current_work_at: work?.at || null,
    last_role: facts.lastDisplayable?.role || null,
    last_message_at: facts.lastDisplayable?.at || null,
    last_snippet: facts.lastDisplayable?.text || null,
    ...facts.counts,
    role_imbalance: roleImbalance,
    rejected_candidate_reason: facts.rejectedReason
      || (!title && runtime.chat_title ? rejectedSummaryTextReason(runtime.chat_title, { title: true }) : null)
      || (!work && runtime.activity?.goal ? rejectedSummaryTextReason(runtime.activity.goal.objective || runtime.activity.goal.text) : null)
      || null,
    fresh_at: facts.lastDisplayable?.at || work?.at || activityAt,
  };
  const changed = !previous || summaryContentSignature(previous) !== summaryContentSignature(candidate);
  candidate.producer_seq = changed
    ? Math.max(0, Number(previous?.producer_seq) || 0) + 1
    : Math.max(1, Number(previous?.producer_seq) || 1);
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > FLEET_SUMMARY_MAX_BYTES) {
    candidate.latest_user_request = candidate.latest_user_request?.slice(0, 64) || null;
    candidate.current_work = candidate.current_work?.slice(0, 64) || null;
    candidate.last_snippet = candidate.last_snippet?.slice(0, 64) || null;
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > FLEET_SUMMARY_MAX_BYTES) return null;
  return candidate;
}

function normalizeFleetSummary(value) {
  if (!value || typeof value !== 'object' || Number(value.schema_version) !== FLEET_SUMMARY_SCHEMA_VERSION) return null;
  const summary = {
    schema_version: FLEET_SUMMARY_SCHEMA_VERSION,
    parser_version: String(value.parser_version || FLEET_SUMMARY_PARSER_VERSION).slice(0, 32),
    session_key: String(value.session_key || '').slice(0, 40),
    session_generation: Math.max(1, Number(value.session_generation) || 1),
    thread_key: String(value.thread_key || '').slice(0, 40),
    thread_generation: Math.max(1, Number(value.thread_generation) || 1),
    producer_seq: Math.max(0, Number(value.producer_seq) || 0),
    summary_seq: Math.max(0, Number(value.summary_seq) || 0),
    title: boundedSummaryText(value.title, TITLE_CHARS, { title: true }) || null,
    title_source: boundedSummaryText(value.title_source, 24) || null,
    title_confidence: ['authoritative', 'derived', 'unknown'].includes(value.title_confidence) ? value.title_confidence : 'unknown',
    latest_user_request: boundedSummaryText(value.latest_user_request) || null,
    latest_user_request_at: isoTimestamp(value.latest_user_request_at),
    current_work: boundedSummaryText(value.current_work) || null,
    current_work_source: boundedSummaryText(value.current_work_source, 32) || null,
    current_work_kind: boundedSummaryText(value.current_work_kind, 24) || null,
    current_work_state: normalizedWorkState(value.current_work_state),
    current_work_at: isoTimestamp(value.current_work_at),
    last_role: ['user', 'assistant'].includes(value.last_role) ? value.last_role : null,
    last_message_at: isoTimestamp(value.last_message_at),
    last_snippet: boundedSummaryText(value.last_snippet) || null,
    message_count: Math.max(0, Number(value.message_count) || 0),
    user_count: Math.max(0, Number(value.user_count) || 0),
    assistant_count: Math.max(0, Number(value.assistant_count) || 0),
    other_count: Math.max(0, Number(value.other_count) || 0),
    role_imbalance: ['balanced', 'assistant_without_user', 'user_without_assistant'].includes(value.role_imbalance)
      ? value.role_imbalance : 'balanced',
    rejected_candidate_reason: boundedSummaryText(value.rejected_candidate_reason, 48) || null,
    fresh_at: isoTimestamp(value.fresh_at),
  };
  if (!summary.session_key || !summary.thread_key) return null;
  return Buffer.byteLength(JSON.stringify(summary), 'utf8') <= FLEET_SUMMARY_MAX_BYTES ? summary : null;
}

function titleRank(summary) {
  if (summary?.title_confidence === 'authoritative') return 3;
  if (summary?.title_confidence === 'derived') return 2;
  return summary?.title ? 1 : 0;
}

function mergeProducerFleetSummary(previousValue, incomingValue) {
  const previous = normalizeFleetSummary(previousValue);
  const incoming = normalizeFleetSummary(incomingValue);
  if (!incoming) return { summary: previous, accepted: false, changed: false, reason: 'invalid' };
  if (!previous) {
    incoming.summary_seq = 1;
    return { summary: incoming, accepted: true, changed: true, reason: 'initial' };
  }
  if (incoming.session_generation < previous.session_generation) return { summary: previous, accepted: false, changed: false, reason: 'older_session_generation' };
  if (incoming.session_generation === previous.session_generation && incoming.session_key !== previous.session_key) return { summary: previous, accepted: false, changed: false, reason: 'session_identity_mismatch' };
  if (incoming.session_generation === previous.session_generation && incoming.thread_generation < previous.thread_generation) return { summary: previous, accepted: false, changed: false, reason: 'older_thread_generation' };
  if (incoming.session_generation === previous.session_generation
      && incoming.thread_generation === previous.thread_generation
      && incoming.thread_key !== previous.thread_key) {
    return { summary: previous, accepted: false, changed: false, reason: 'thread_identity_mismatch' };
  }
  const newGeneration = incoming.session_generation > previous.session_generation
    || incoming.thread_generation > previous.thread_generation;
  const newerSequence = incoming.producer_seq > previous.producer_seq
    || (incoming.producer_seq === previous.producer_seq && incoming.summary_seq > previous.summary_seq);
  if (!newGeneration && !newerSequence) {
    return { summary: previous, accepted: false, changed: false, reason: 'replayed_or_out_of_order' };
  }
  const merged = newGeneration ? incoming : { ...previous, ...incoming };
  if (!newGeneration) {
    if (!incoming.title || titleRank(incoming) < titleRank(previous)) {
      merged.title = previous.title;
      merged.title_source = previous.title_source;
      merged.title_confidence = previous.title_confidence;
    }
    for (const field of ['latest_user_request', 'latest_user_request_at', 'current_work', 'current_work_source', 'current_work_kind', 'current_work_state', 'current_work_at', 'last_role', 'last_message_at', 'last_snippet', 'fresh_at']) {
      if (incoming[field] == null || incoming[field] === '') merged[field] = previous[field];
    }
    for (const field of ['message_count', 'user_count', 'assistant_count', 'other_count']) merged[field] = Math.max(previous[field] || 0, incoming[field] || 0);
  }
  merged.summary_seq = Math.max(0, Number(previous.summary_seq) || 0) + 1;
  const changed = summaryContentSignature(previous) !== summaryContentSignature(merged);
  return { summary: changed ? merged : previous, accepted: true, changed, reason: changed ? 'upgraded' : 'unchanged' };
}

function advanceFleetSummary(previousValue, event = {}, meta = {}) {
  const previous = normalizeFleetSummary(previousValue);
  if (!previous) return null;
  const next = { ...previous };
  const eventType = String(event.type || '').trim().toLowerCase();
  const role = normalizedRole(event.role || event.message?.role);
  const rawContent = scalarMessageText(event.content || event.message?.content || event.content_blocks || event.message?.content_blocks);
  const content = boundedSummaryText(rawContent);
  const at = isoTimestamp(event.ts, event.timestamp, event.created_at, event.server_ts, Date.now());
  let changed = false;

  if (['message', 'proxy_message', 'message_event'].includes(eventType) && content && role !== 'other') {
    // Producer snapshots are authoritative for transcript/role counts. A
    // settled relay event may arrive before or after the snapshot containing
    // that same message, so incrementing here would make delivery order change
    // the count and could leave it permanently one high.
    next.last_role = role;
    next.last_message_at = at;
    next.last_snippet = content;
    next.fresh_at = at;
    if (role === 'user') {
      next.latest_user_request = content;
      next.latest_user_request_at = at;
      if (!next.current_work || next.current_work_source === 'latest_user_request') {
        next.current_work = content;
        next.current_work_source = 'latest_user_request';
        next.current_work_kind = 'request';
        next.current_work_state = null;
        next.current_work_at = at;
      }
    }
    changed = true;
  }

  const activity = event.activity && typeof event.activity === 'object'
    ? event.activity
    : (meta.activity && typeof meta.activity === 'object' ? meta.activity : null);
  if (activity) {
    const latestUser = next.latest_user_request
      ? { text: next.latest_user_request, at: next.latest_user_request_at }
      : null;
    const work = currentWorkFact(activity, latestUser);
    if (work && (
      next.current_work !== work.text
      || next.current_work_source !== work.source
      || next.current_work_kind !== work.kind
      || next.current_work_state !== (work.state || null)
      || next.current_work_at !== (work.at || null)
    )) {
      next.current_work = work.text;
      next.current_work_source = work.source;
      next.current_work_kind = work.kind;
      next.current_work_state = work.state || null;
      next.current_work_at = work.at || null;
      next.fresh_at = work.at || next.fresh_at;
      changed = true;
    }
  }

  if (!changed) return previous;
  next.summary_seq = Math.max(0, Number(previous.summary_seq) || 0) + 1;
  return normalizeFleetSummary(next) || previous;
}

function projectFleetSummary(summaryValue) {
  const summary = normalizeFleetSummary(summaryValue);
  if (!summary) return {};
  const workContext = summary.current_work ? {
    kind: summary.current_work_kind || 'activity',
    label: summary.current_work_kind === 'goal' ? 'Goal' : summary.current_work_kind === 'request' ? 'Request' : 'Current work',
    text: summary.current_work,
    source: summary.current_work_source || 'fleet_summary',
    updated_at: summary.current_work_at,
    ...(summary.current_work_state ? { state: summary.current_work_state } : {}),
  } : null;
  return {
    fleet_summary: summary,
    ...(summary.title ? { chat_title: summary.title, chat_title_source: summary.title_source } : {}),
    ...(summary.latest_user_request ? { last_user_request: { text: summary.latest_user_request, updated_at: summary.latest_user_request_at } } : {}),
    ...(summary.last_snippet ? { last_snippet: summary.last_snippet, last_message_at: summary.last_message_at } : {}),
    ...(workContext ? { fleet_work_context: workContext } : {}),
  };
}

module.exports = {
  FLEET_SUMMARY_MAX_BYTES,
  FLEET_SUMMARY_PARSER_VERSION,
  FLEET_SUMMARY_SCHEMA_VERSION,
  boundedSummaryText,
  advanceFleetSummary,
  buildProducerFleetSummary,
  mergeProducerFleetSummary,
  normalizeFleetSummary,
  projectFleetSummary,
  rejectedSummaryTextReason,
};
