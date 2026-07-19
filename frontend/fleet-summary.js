const SCHEMA_VERSION = 1;
const MAX_BYTES = 1024;
const CREDENTIAL_RE = /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i;
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;

function utf8Bytes(value) {
  let bytes = 0;
  for (const char of String(value || '')) {
    const code = char.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function safeText(value, maximum = 96) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || CREDENTIAL_RE.test(text) || ABSOLUTE_PATH_RE.test(text)) return '';
  return text.slice(0, maximum).trim();
}

function isoTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  const ms = Number.isFinite(numeric)
    ? (numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function normalizedWorkState(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const states = {
    active: 'active', paused: 'paused', blocked: 'blocked',
    usagelimited: 'usageLimited', ratelimited: 'usageLimited',
    budgetlimited: 'budgetLimited', complete: 'complete', completed: 'complete',
    cancelled: 'cancelled', canceled: 'cancelled', failed: 'failed',
    idle: 'idle', working: 'working',
  };
  return states[normalized] || null;
}

export function normalizeFleetSummary(value) {
  if (!value || typeof value !== 'object' || Number(value.schema_version) !== SCHEMA_VERSION) return null;
  const summary = {
    schema_version: SCHEMA_VERSION,
    parser_version: safeText(value.parser_version, 32) || 'fleet-summary-v1',
    session_key: safeText(value.session_key, 40),
    session_generation: Math.max(1, Number(value.session_generation) || 1),
    thread_key: safeText(value.thread_key, 40),
    thread_generation: Math.max(1, Number(value.thread_generation) || 1),
    producer_seq: Math.max(0, Number(value.producer_seq) || 0),
    summary_seq: Math.max(0, Number(value.summary_seq) || 0),
    title: safeText(value.title, 80) || null,
    title_source: safeText(value.title_source, 24) || null,
    title_confidence: ['authoritative', 'derived', 'unknown'].includes(value.title_confidence) ? value.title_confidence : 'unknown',
    latest_user_request: safeText(value.latest_user_request) || null,
    latest_user_request_at: isoTimestamp(value.latest_user_request_at),
    current_work: safeText(value.current_work) || null,
    current_work_source: safeText(value.current_work_source, 32) || null,
    current_work_kind: safeText(value.current_work_kind, 24) || null,
    current_work_state: normalizedWorkState(value.current_work_state),
    current_work_at: isoTimestamp(value.current_work_at),
    last_role: ['user', 'assistant'].includes(value.last_role) ? value.last_role : null,
    last_message_at: isoTimestamp(value.last_message_at),
    last_snippet: safeText(value.last_snippet) || null,
    message_count: Math.max(0, Number(value.message_count) || 0),
    user_count: Math.max(0, Number(value.user_count) || 0),
    assistant_count: Math.max(0, Number(value.assistant_count) || 0),
    other_count: Math.max(0, Number(value.other_count) || 0),
    role_imbalance: ['balanced', 'assistant_without_user', 'user_without_assistant'].includes(value.role_imbalance)
      ? value.role_imbalance : 'balanced',
    rejected_candidate_reason: safeText(value.rejected_candidate_reason, 48) || null,
    fresh_at: isoTimestamp(value.fresh_at),
  };
  if (!summary.session_key || !summary.thread_key || utf8Bytes(JSON.stringify(summary)) > MAX_BYTES) return null;
  return summary;
}

function titleRank(summary) {
  if (summary?.title_confidence === 'authoritative') return 3;
  if (summary?.title_confidence === 'derived') return 2;
  return summary?.title ? 1 : 0;
}

export function mergeFleetSummary(previousValue, incomingValue) {
  const previous = normalizeFleetSummary(previousValue);
  const incoming = normalizeFleetSummary(incomingValue);
  if (!incoming) return { summary: previous, accepted: false, changed: false, reason: 'invalid' };
  if (!previous) return { summary: { ...incoming, summary_seq: Math.max(1, incoming.summary_seq) }, accepted: true, changed: true, reason: 'initial' };
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
  if (!newGeneration && !newerSequence) return { summary: previous, accepted: false, changed: false, reason: 'replayed_or_out_of_order' };
  const merged = newGeneration ? { ...incoming } : { ...previous, ...incoming };
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
  merged.summary_seq = Math.max(previous.summary_seq || 0, incoming.summary_seq || 0);
  const changed = JSON.stringify(previous) !== JSON.stringify(merged);
  return { summary: changed ? merged : previous, accepted: true, changed, reason: changed ? 'upgraded' : 'unchanged' };
}

export function projectFleetSummary(value) {
  const summary = normalizeFleetSummary(value);
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
