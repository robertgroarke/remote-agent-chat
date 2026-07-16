import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Vibration } from 'react-native';
import { getStoredJwt, RELAY_URL } from './auth';

export const PREF_ATTENTION_HAPTIC = 'pref_attention_haptic';

let hapticEnabled = false;
let preferenceLoaded = false;
const promptIds = new Map();
let lastVibrationAt = 0;

export async function loadAttentionHapticPreference() {
  const raw = await AsyncStorage.getItem(PREF_ATTENTION_HAPTIC).catch(() => null);
  try {
    hapticEnabled = raw === null ? false : JSON.parse(raw) === true;
  } catch {
    hapticEnabled = false;
  }
  preferenceLoaded = true;
  return hapticEnabled;
}

export async function refreshAttentionHapticPreference() {
  await loadAttentionHapticPreference();
  const jwt = await getStoredJwt();
  if (!jwt) return hapticEnabled;
  try {
    const response = await fetch(`${RELAY_URL}/api/preferences/notifications`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return hapticEnabled;
    hapticEnabled = body.preferences?.completion_haptic === true;
    preferenceLoaded = true;
    await AsyncStorage.setItem(PREF_ATTENTION_HAPTIC, JSON.stringify(hapticEnabled));
  } catch {
    // Retain the cached value while offline.
  }
  return hapticEnabled;
}

export function setAttentionHapticPreference(enabled) {
  hapticEnabled = enabled === true;
  preferenceLoaded = true;
}

function attentionEventIsUnfocused(sessionId, activeSessionId) {
  return sessionId !== activeSessionId || AppState.currentState !== 'active';
}

async function maybeVibrate(kind, sessionId, activeSessionId) {
  if (!preferenceLoaded) await loadAttentionHapticPreference();
  if (!hapticEnabled || !sessionId || !attentionEventIsUnfocused(sessionId, activeSessionId)) return false;
  const now = Date.now();
  if (now - lastVibrationAt < 600) return false;
  lastVibrationAt = now;
  Vibration.vibrate(kind === 'prompt' ? [0, 40, 35, 40] : 45, false);
  return true;
}

export async function notePromptForAttentionFeedback(message, activeSessionId) {
  const sessionId = message?.session_id || message?.session;
  if (!sessionId) return false;
  const promptId = message?.prompt_id || message?.request_id || message?.id || 'prompt';
  if (promptIds.get(sessionId) === promptId) return false;
  promptIds.set(sessionId, promptId);
  return maybeVibrate('prompt', sessionId, activeSessionId);
}

export function rememberPromptForAttentionFeedback(message) {
  const sessionId = message?.session_id || message?.session;
  if (!sessionId) return;
  const promptId = message?.prompt_id || message?.request_id || message?.id || 'prompt';
  promptIds.set(sessionId, promptId);
}

export function clearPromptAttentionFeedback(message) {
  const sessionId = message?.session_id || message?.session;
  if (sessionId) promptIds.delete(sessionId);
}

export async function noteSemanticNotificationForAttentionFeedback(message, activeSessionId) {
  const sessionId = message?.session_id || message?.session;
  if (!sessionId) return false;
  const eventType = String(message?.event_type || '').trim();
  if (!['goal_completed', 'goal_attention'].includes(eventType)) return false;
  return maybeVibrate(eventType === 'goal_attention' ? 'prompt' : 'completion', sessionId, activeSessionId);
}
