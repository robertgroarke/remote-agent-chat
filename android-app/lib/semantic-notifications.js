import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, DeviceEventEmitter } from 'react-native';
import { noteSemanticNotificationForAttentionFeedback } from './attention-feedback';
import { getStoredJwt, RELAY_URL } from './auth';

export const SEMANTIC_NOTIFICATION_EVENT = 'rac:semantic-notification';
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
const LEDGER_KEY = 'semantic_notification_ledger_v1';
const MAX_LEDGER_ENTRIES = 256;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORY_PREFERENCES = Object.freeze({
  turn_ready: 'pref_notify_turn_ready',
  goal_completed: 'pref_notify_goal_completed',
  goal_attention: 'pref_notify_goal_attention',
  provider_usage_warning: 'pref_notify_provider_usage_warning',
});

let claimTail = Promise.resolve();
const runtimeClaims = new Set();
let authoritativeCategoryPreferences = null;

export function setAuthoritativeSemanticNotificationPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') {
    authoritativeCategoryPreferences = null;
    return false;
  }
  authoritativeCategoryPreferences = Object.freeze({
    turn_ready: false,
    goal_completed: preferences.goal_completed === true,
    goal_attention: preferences.goal_attention === true,
    // Keep this lane fail-closed on Android until its dedicated FCM channel
    // and operator-facing preference ship.
    provider_usage_warning: false,
  });
  return true;
}

export async function refreshAuthoritativeSemanticNotificationPreferences() {
  authoritativeCategoryPreferences = null;
  const jwt = await getStoredJwt();
  if (!jwt) return false;
  const response = await fetch(`${RELAY_URL}/api/preferences/notifications`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return false;
  return setAuthoritativeSemanticNotificationPreferences(body.preferences);
}

export function normalizeSemanticNotification(value) {
  if (!value || typeof value !== 'object') return null;
  const eventType = String(value.event_type || value.type || '').trim();
  const messageType = String(value.type || '').trim();
  const dedupeKey = String(value.dedupe_key || '').trim();
  const sessionId = String(value.session_id || value.session || '').trim();
  if (!TYPE_SET.has(eventType) || !dedupeKey || !sessionId) return null;
  if (messageType && messageType !== 'semantic_notification' && messageType !== eventType) return null;
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

function recentLedger(raw, nowMs) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return Object.fromEntries(Object.entries(parsed || {})
      .filter(([, timestamp]) => Number(timestamp) > nowMs - RETENTION_MS)
      .slice(-MAX_LEDGER_ENTRIES));
  } catch {
    return {};
  }
}

function claimExactlyOnce(dedupeKey) {
  const claim = claimTail.then(async () => {
    if (runtimeClaims.has(dedupeKey)) return false;
    const nowMs = Date.now();
    const raw = await AsyncStorage.getItem(LEDGER_KEY).catch(() => null);
    const ledger = recentLedger(raw, nowMs);
    if (ledger[dedupeKey]) {
      runtimeClaims.add(dedupeKey);
      return false;
    }
    ledger[dedupeKey] = nowMs;
    runtimeClaims.add(dedupeKey);
    await AsyncStorage.setItem(
      LEDGER_KEY,
      JSON.stringify(Object.fromEntries(Object.entries(ledger).slice(-MAX_LEDGER_ENTRIES))),
    ).catch(() => {});
    return true;
  });
  claimTail = claim.catch(() => false);
  return claim;
}

async function categoryEnabled(category) {
  const key = CATEGORY_PREFERENCES[category];
  if (!key) return false;
  if (!authoritativeCategoryPreferences) return false;
  return authoritativeCategoryPreferences[category] === true;
}

function eventIsUnfocused(event, activeSessionId) {
  return event.session_id !== activeSessionId || AppState.currentState !== 'active';
}

export async function recordSemanticNotificationStage(event, stage, {
  channel = 'android-foreground',
  reasonCode = '',
  clientId = 'android-app',
} = {}) {
  const normalized = normalizeSemanticNotification(event);
  if (!normalized || !['claimed', 'displayed', 'suppressed'].includes(stage)) return false;
  const jwt = await getStoredJwt();
  if (!jwt) return false;
  try {
    const response = await fetch(`${RELAY_URL}/api/notifications/semantic-receipts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
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

export async function processSemanticNotification(value, activeSessionId = null) {
  const event = normalizeSemanticNotification(value);
  if (!event) return { handled: false, code: 'invalid' };
  if (!authoritativeCategoryPreferences) {
    recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'preferences_pending' });
    return { handled: false, code: 'preferences_pending', event };
  }
  if (!await categoryEnabled(event.category)) {
    recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'client_preference' });
    return { handled: false, code: 'disabled', event };
  }
  if (!eventIsUnfocused(event, activeSessionId)) {
    recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'focused_session' });
    return { handled: false, code: 'focused', event };
  }
  if (!await claimExactlyOnce(event.dedupe_key)) {
    recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'client_duplicate' });
    return { handled: false, code: 'duplicate', event };
  }
  recordSemanticNotificationStage(event, 'claimed');
  const vibrated = await noteSemanticNotificationForAttentionFeedback(event, activeSessionId);
  DeviceEventEmitter.emit(SEMANTIC_NOTIFICATION_EVENT, event);
  recordSemanticNotificationStage(event, 'displayed');
  return { handled: true, code: 'surfaced', event, vibrated };
}

export function subscribeSemanticNotifications(listener) {
  return DeviceEventEmitter.addListener(SEMANTIC_NOTIFICATION_EVENT, listener);
}

export function semanticNotificationFromExpo(notification) {
  const content = notification?.request?.content || {};
  return normalizeSemanticNotification({
    ...(content.data || {}),
    title: content.title,
    body: content.body,
  });
}

export function semanticNotificationToBanner(event) {
  return {
    request: {
      content: {
        title: event.title,
        body: event.body,
        data: {
          ...event,
          type: event.event_type,
          activity_type: event.activity_type || event.event_type,
        },
      },
    },
  };
}
