export const SEMANTIC_NOTIFICATION_TYPES = Object.freeze([
  'goal_completed',
  'goal_attention',
  'provider_usage_threshold',
]);

const TYPE_SET = new Set(SEMANTIC_NOTIFICATION_TYPES);
const CATEGORY_BY_TYPE = Object.freeze({
  goal_completed: 'goal_completed',
  goal_attention: 'goal_attention',
  provider_usage_threshold: 'provider_usage_warning',
});
const LEDGER_KEY = 'remote-agent-chat:semantic-notifications:v1';
const CLAIM_PREFIX = 'remote-agent-chat:semantic-notification-claim:v1:';
const MAX_LEDGER_ENTRIES = 256;
const LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeSemanticNotification(value) {
  if (!value || typeof value !== 'object' || value.type !== 'semantic_notification') return null;
  const eventType = String(value.event_type || '').trim();
  const dedupeKey = String(value.dedupe_key || '').trim();
  const sessionId = String(value.session_id || value.session || '').trim();
  if (!TYPE_SET.has(eventType) || !dedupeKey || !sessionId) return null;
  const category = String(value.category || CATEGORY_BY_TYPE[eventType]).trim();
  if (category !== CATEGORY_BY_TYPE[eventType]) return null;
  return {
    ...value,
    type: 'semantic_notification',
    event_type: eventType,
    category,
    dedupe_key: dedupeKey,
    session_id: sessionId,
    session: sessionId,
    title: String(value.title || '').trim() || (eventType === 'goal_completed'
      ? 'Goal completed' : eventType === 'provider_usage_threshold'
        ? 'Provider usage warning' : 'Goal needs attention'),
    body: String(value.body || '').trim(),
    created_at: value.created_at || new Date().toISOString(),
  };
}

export function mergeSemanticNotifications(previous, incoming, limit = 100) {
  const byKey = new Map();
  [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [incoming])]
    .map(normalizeSemanticNotification)
    .filter(Boolean)
    .forEach(event => byKey.set(event.dedupe_key, event));
  return [...byKey.values()].slice(-Math.max(1, Number(limit) || 100));
}

export function semanticNotificationAllowed(event, preferences = {}) {
  const normalized = normalizeSemanticNotification(event);
  return !!normalized && preferences?.[normalized.category] === true;
}

function readLedger(storage, nowMs) {
  try {
    const parsed = JSON.parse(storage?.getItem(LEDGER_KEY) || '{}');
    return Object.fromEntries(Object.entries(parsed || {})
      .filter(([, timestamp]) => Number(timestamp) > nowMs - LEDGER_RETENTION_MS)
      .slice(-MAX_LEDGER_ENTRIES));
  } catch {
    return {};
  }
}

function markConsumed(storage, dedupeKey, nowMs) {
  const ledger = readLedger(storage, nowMs);
  if (ledger[dedupeKey]) return false;
  ledger[dedupeKey] = nowMs;
  const entries = Object.entries(ledger).slice(-MAX_LEDGER_ENTRIES);
  try { storage?.setItem(LEDGER_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
  return true;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function claimWithStorage(storage, dedupeKey, nowMs) {
  if (!storage) return true;
  if (readLedger(storage, nowMs)[dedupeKey]) return false;
  const claimKey = `${CLAIM_PREFIX}${encodeURIComponent(dedupeKey).slice(0, 320)}`;
  const token = `${nowMs}:${Math.random().toString(36).slice(2)}`;
  try {
    storage.setItem(claimKey, JSON.stringify({ token, at: nowMs }));
    await wait(20);
    const claim = JSON.parse(storage.getItem(claimKey) || '{}');
    if (claim.token !== token) return false;
    if (!markConsumed(storage, dedupeKey, nowMs)) return false;
    const confirmed = readLedger(storage, nowMs)[dedupeKey] === nowMs;
    if (confirmed) storage.removeItem(claimKey);
    return confirmed;
  } catch {
    return markConsumed(storage, dedupeKey, nowMs);
  }
}

export async function claimSemanticNotification(event, {
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  locks = typeof navigator !== 'undefined' ? navigator.locks : null,
  now = () => Date.now(),
} = {}) {
  const normalized = normalizeSemanticNotification(event);
  if (!normalized) return false;
  const claim = () => claimWithStorage(storage, normalized.dedupe_key, now());
  if (locks?.request) {
    return locks.request(`rac-semantic:${normalized.dedupe_key}`, { mode: 'exclusive' }, claim);
  }
  return claim();
}

export async function recordSemanticNotificationStage(event, stage, {
  channel = 'web-in-app',
  reasonCode = '',
  clientId = 'web-app',
} = {}) {
  const normalized = normalizeSemanticNotification(event);
  if (!normalized || !['claimed', 'displayed', 'suppressed'].includes(stage)) return false;
  if (typeof fetch !== 'function') return false;
  try {
    const response = await fetch('/api/notifications/semantic-receipts', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dedupe_key: normalized.dedupe_key,
        stage,
        channel,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
        client_id: clientId,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
