const DEFAULT_RECENT_CHAT_LIMIT = 5;

const VISIBLE_MESSAGE_KINDS = new Set([
  'user',
  'assistant',
  'tool',
  'tool_result',
  'permission',
  'permission_prompt',
  'question',
  'question_prompt',
  'error',
  'system',
]);

function sessionIdOf(session) {
  return typeof session === 'string' ? session : String(session?.session_id || session?.id || '');
}

function canonicalMessageKind(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!VISIBLE_MESSAGE_KINDS.has(normalized)) return null;
  if (normalized === 'permission_prompt') return 'permission';
  if (normalized === 'question_prompt') return 'question';
  return normalized;
}

function stableMessageId(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function canonicalSource(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized || normalized.length > 64 || /[^a-z0-9_.:/]/.test(normalized)) return null;
  return normalized;
}

function timestampMs(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLatestVisibleMessage(session) {
  if (!session || typeof session !== 'object') return null;
  const nested = session.latest_visible_message && typeof session.latest_visible_message === 'object'
    ? session.latest_visible_message
    : null;
  const id = stableMessageId(nested?.id ?? nested?.message_id ?? session.last_message_id);
  const atMs = timestampMs(nested?.at ?? nested?.timestamp ?? session.last_message_at);
  const kind = canonicalMessageKind(nested?.kind ?? session.last_message_kind);
  const source = canonicalSource(nested?.source ?? session.last_message_source);
  if (!id || !atMs || !kind || !source) return null;
  return Object.freeze({
    id,
    at: new Date(atMs).toISOString(),
    atMs,
    kind,
    source,
  });
}

function latestVisibleMessageSessionPatch(value) {
  const latest = normalizeLatestVisibleMessage(value);
  if (!latest) return {};
  return {
    latest_visible_message: {
      id: latest.id,
      at: latest.at,
      kind: latest.kind,
      source: latest.source,
    },
    last_message_id: latest.id,
    last_message_at: latest.at,
    last_message_kind: latest.kind,
    last_message_source: latest.source,
  };
}

function compareRecentChatSessions(left, right) {
  const leftMessage = normalizeLatestVisibleMessage(left);
  const rightMessage = normalizeLatestVisibleMessage(right);
  if (leftMessage && !rightMessage) return -1;
  if (!leftMessage && rightMessage) return 1;
  if (!leftMessage && !rightMessage) return sessionIdOf(left).localeCompare(sessionIdOf(right));
  if (leftMessage.atMs !== rightMessage.atMs) return rightMessage.atMs - leftMessage.atMs;
  const messageTie = rightMessage.id.localeCompare(leftMessage.id);
  if (messageTie !== 0) return messageTie;
  return sessionIdOf(left).localeCompare(sessionIdOf(right));
}

function rankRecentChatSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter(session => !!sessionIdOf(session) && !!normalizeLatestVisibleMessage(session))
    .slice()
    .sort(compareRecentChatSessions);
}

function asIdSet(value) {
  if (value instanceof Set) return value;
  if (!value || typeof value[Symbol.iterator] !== 'function') return new Set();
  return new Set(Array.from(value, item => String(item || '')));
}

function projectRecentChatOwnership(sessions, options = {}) {
  const workingSessionIds = asIdSet(options.workingSessionIds);
  const pinnedSessionIds = asIdSet(options.pinnedSessionIds);
  const excludedSessionIds = asIdSet(options.excludedSessionIds);
  const limit = Number.isSafeInteger(options.limit) && options.limit >= 0
    ? options.limit
    : DEFAULT_RECENT_CHAT_LIMIT;
  const seen = new Set();
  const visible = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = sessionIdOf(session);
    if (!id || seen.has(id) || excludedSessionIds.has(id)) continue;
    seen.add(id);
    visible.push(session);
  }

  const working = visible.filter(session => workingSessionIds.has(sessionIdOf(session)));
  const nonWorking = visible.filter(session => !workingSessionIds.has(sessionIdOf(session)));
  const recent = rankRecentChatSessions(nonWorking).slice(0, limit);
  const recentIds = new Set(recent.map(sessionIdOf));
  const afterRecent = nonWorking.filter(session => !recentIds.has(sessionIdOf(session)));
  const pinned = afterRecent.filter(session => pinnedSessionIds.has(sessionIdOf(session)));
  const pinnedIds = new Set(pinned.map(sessionIdOf));
  const remaining = afterRecent.filter(session => !pinnedIds.has(sessionIdOf(session)));
  const ownership = Object.fromEntries([
    ...working.map(session => [sessionIdOf(session), 'working']),
    ...recent.map(session => [sessionIdOf(session), 'recent']),
    ...pinned.map(session => [sessionIdOf(session), 'pinned']),
    ...remaining.map(session => [sessionIdOf(session), 'workspace']),
  ]);
  return { working, recent, pinned, remaining, ownership };
}

export {
  DEFAULT_RECENT_CHAT_LIMIT,
  VISIBLE_MESSAGE_KINDS,
  canonicalMessageKind,
  compareRecentChatSessions,
  latestVisibleMessageSessionPatch,
  normalizeLatestVisibleMessage,
  projectRecentChatOwnership,
  rankRecentChatSessions,
};
