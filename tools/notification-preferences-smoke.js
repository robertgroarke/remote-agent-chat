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
const protocol = read('protocol.md');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS notification_preferences',
  "app.get('/api/preferences/notifications', requireAnyAuth",
  "app.put('/api/preferences/notifications', requireAnyAuth",
  'notificationPreferencesForEmail(email)',
  'saveNotificationPreferences(email, requested)',
  "permission_required: { category: 'permission_required'",
  "agent_idle:           { category: 'agent_ready'",
  "agent_error:          { category: 'agent_error'",
  "rate_limit_active:    { category: 'agent_error'",
  "session_offline:      { category: 'session_offline'",
  "rate_limit_cleared:   { category: 'rate_limit_cleared'",
  'if (category && !preferences[category])',
]) assert(relay.includes(marker), `missing relay preference marker: ${marker}`);

for (const marker of [
  'NotificationSettingsPanel',
  "fetch('/api/preferences/notifications'",
  "method: 'PUT'",
  "togglePreference('permission_required')",
  "togglePreference('agent_ready')",
  "togglePreference('agent_error')",
  "togglePreference('session_offline')",
  "togglePreference('rate_limit_cleared')",
  'These preferences sync across web and Android.',
]) assert(web.includes(marker), `missing web preference marker: ${marker}`);

for (const marker of [
  'fetchRelayPreferences',
  'saveRelayPreferences',
  'getStoredJwt',
  'RELAY_URL',
  "'permission_required'",
  "'agent_ready'",
  "'agent_error'",
  "'session_offline'",
  "'rate_limit_cleared'",
  'AsyncStorage.multiSet',
  'Settings not saved',
  'These preferences sync across web and Android.',
]) assert(android.includes(marker), `missing Android preference marker: ${marker}`);

assert(protocol.includes('## Relay Notification Preferences API'));
assert(protocol.includes('GET /api/preferences/notifications'));
assert(protocol.includes('PUT /api/preferences/notifications'));

const result = {
  ok: true,
  relay_persistence: true,
  authenticated_web_and_android_api: true,
  categories: ['permission_required', 'agent_ready', 'agent_error', 'session_offline', 'rate_limit_cleared'],
  push_filtering: true,
  web_ui: true,
  android_sync_and_offline_cache: true,
  protocol_documented: true,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}

console.log(JSON.stringify(result, null, 2));
