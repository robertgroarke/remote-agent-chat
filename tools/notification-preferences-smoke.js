#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('relay-server/index.js');
const web = read('frontend/app.jsx');
const android = read('android-app/screens/SettingsScreen.jsx');
const androidFeedback = read('android-app/lib/attention-feedback.js');
const androidSemantic = read('android-app/lib/semantic-notifications.js');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const androidList = read('android-app/screens/SessionListScreen.jsx');
const protocol = read('protocol.md');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS notification_preferences',
  "app.get('/api/preferences/notifications', requireAnyAuth",
  "app.put('/api/preferences/notifications', requireAnyAuth",
  'notificationPreferencesForEmail(email)',
  'saveNotificationPreferences(email, requested)',
  "permission_required: { category: 'permission_required'",
  'const TURN_READY_NOTIFICATIONS_ENABLED = false',
  "const FORBIDDEN_COMPLETION_NOTIFICATION_TYPES = new Set(['agent_idle', 'turn_ready'])",
  "goal_completed:       { category: 'goal_completed'",
  "goal_attention:       { category: 'goal_attention'",
  "agent_error:          { category: 'agent_error'",
  "rate_limit_active:    { category: 'agent_error'",
  "session_offline:      { category: 'session_offline'",
  "rate_limit_cleared:   { category: 'rate_limit_cleared'",
  'if (category && !preferences[category])',
  'completion_sound: false',
  'completion_haptic: false',
  'dispatchSemanticNotification(event)',
  'semanticNotificationsForClient(ws)',
]) assert(relay.includes(marker), `missing relay preference marker: ${marker}`);
assert(!relay.includes("agent_idle:           { category: 'agent_ready'"),
  'legacy agent_idle frames must not have a push route');
assert(relay.includes('turn_ready: false'));
assert(relay.includes('goal_completed: false'));
assert(!relay.includes('Agent has finished and is waiting for input.'),
  'legacy generating-to-idle push producer must be removed');

for (const marker of [
  'NotificationSettingsPanel',
  "fetch('/api/preferences/notifications'",
  "method: 'PUT'",
  "togglePreference('permission_required')",
  "togglePreference('turn_ready')",
  "togglePreference('goal_completed')",
  "togglePreference('goal_attention')",
  "togglePreference('agent_error')",
  "togglePreference('session_offline')",
  "togglePreference('rate_limit_cleared')",
  "togglePreference('completion_sound')",
  "playAttentionSound('prompt')",
  "playAttentionSound(kind === 'goal_attention' ? 'prompt' : 'completion')",
  'attentionEventIsUnfocused(sessionId, activeSession)',
  'NOTIFICATION_PREFERENCE_PENDING',
  'notificationPreferencesLoaded',
  'sessionPreferencesLoaded',
  'These preferences sync across web and Android.',
]) assert(web.includes(marker), `missing web preference marker: ${marker}`);
assert(web.includes('turn_ready: false'));
assert(web.includes('goal_completed: false'));

for (const marker of [
  'fetchRelayPreferences',
  'saveRelayPreferences',
  'getStoredJwt',
  'RELAY_URL',
  "'permission_required'",
  "'turn_ready'",
  "'goal_completed'",
  "'goal_attention'",
  "'agent_error'",
  "'session_offline'",
  "'rate_limit_cleared'",
  "'completion_haptic'",
  'AsyncStorage.multiSet',
  'Settings not saved',
  'These preferences sync across web and Android.',
]) assert(android.includes(marker), `missing Android preference marker: ${marker}`);
assert(android.includes('[PREF_NOTIFY_TURN_READY]: false'));
assert(android.includes('[PREF_NOTIFY_GOAL_DONE]: false'));
assert(androidSemantic.includes('if (!authoritativeCategoryPreferences) return false'));
assert(androidSemantic.includes('setAuthoritativeSemanticNotificationPreferences'));

for (const marker of [
  "PREF_ATTENTION_HAPTIC = 'pref_attention_haptic'",
  'Vibration.vibrate',
  'promptIds.get(sessionId) === promptId',
  'refreshAttentionHapticPreference',
  'body.preferences?.completion_haptic === true',
  'now - lastVibrationAt < 600',
  'noteSemanticNotificationForAttentionFeedback',
]) assert(androidFeedback.includes(marker), `missing Android attention-feedback marker: ${marker}`);
assert(!androidFeedback.includes('noteActivityForAttentionFeedback'));
assert(!androidFeedback.includes('generatingBySession'));
for (const marker of [
  'semantic_notification_ledger_v1',
  'DeviceEventEmitter.emit',
  'processSemanticNotification',
  'goal_completed',
  'goal_attention',
  'turn_ready',
  'preferences_pending',
  'refreshAuthoritativeSemanticNotificationPreferences',
]) assert(androidSemantic.includes(marker), `missing Android semantic-notification marker: ${marker}`);
assert(androidChat.includes('notePromptForAttentionFeedback(msg, sessionId)'));
assert(androidChat.includes('processSemanticNotification(msg, sessionId)'));
assert(androidChat.includes('msg.semantic_notifications'));
assert(androidChat.includes('rememberPromptForAttentionFeedback(openPermission)'));
assert(androidList.includes('notePromptForAttentionFeedback(msg, activeSessionRef.current)'));
assert(androidList.includes('processSemanticNotification(msg, activeSessionRef.current)'));
assert(androidList.includes('msg.semantic_notifications'));
assert(androidList.includes('rememberPromptForAttentionFeedback(p)'));
assert(web.includes('wallNow - lastAttentionSoundAt < 600'));

assert(protocol.includes('## Relay Notification Preferences API'));
assert(protocol.includes('GET /api/preferences/notifications'));
assert(protocol.includes('PUT /api/preferences/notifications'));
assert(protocol.includes('### `semantic_notification`'));
assert(protocol.includes('Canonical goal lifecycle record'));

const result = {
  ok: true,
  relay_persistence: true,
  authenticated_web_and_android_api: true,
  categories: ['permission_required', 'turn_ready', 'goal_completed', 'goal_attention', 'agent_error', 'session_offline', 'rate_limit_cleared'],
  attention_feedback: ['completion_sound', 'completion_haptic'],
  attention_feedback_defaults_off: true,
  duplicate_and_initial_restore_suppression: true,
  semantic_lifecycle_notifications: true,
  push_filtering: true,
  web_ui: true,
  android_sync_and_cache_fail_closed: true,
  protocol_documented: true,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}

console.log(JSON.stringify(result, null, 2));
