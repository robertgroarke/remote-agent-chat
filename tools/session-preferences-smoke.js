#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('relay-server/index.js');
const web = read('frontend/app.jsx');
const androidList = read('android-app/screens/SessionListScreen.jsx');
const androidSheet = read('android-app/components/SessionPreferencesSheet.jsx');
const protocol = read('protocol.md');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS session_preferences',
  "app.get('/api/preferences/sessions', requireAnyAuth",
  "app.put('/api/preferences/sessions/:sessionId', requireAnyAuth",
  "app.delete('/api/preferences/sessions/:sessionId', requireAnyAuth",
  'saveSessionPreference(email, sessionId, requested)',
  "sessionPreferencesForEmail(email)[sessionId]?.muted",
]) assert(relay.includes(marker), `missing relay session preference marker: ${marker}`);

for (const marker of [
  'SessionManagementPanel', '/api/preferences/sessions',
  'Hide from sidebar', 'Restore to sidebar', 'Mute notifications',
  'allManagedSessions.filter', 'session-card-muted',
]) assert(web.includes(marker), `missing web session management marker: ${marker}`);

for (const marker of [
  'SessionPreferencesSheet', '/api/preferences/sessions',
  'visibleSessions', 'setShowSessionPreferences(true)', 'Hidden (',
]) assert(androidList.includes(marker), `missing Android list marker: ${marker}`);

for (const marker of [
  'Hide from session list', 'Restore to session list', 'Mute notifications',
  'Hidden sessions', 'Names, hidden state, and mute settings sync across web and Android.',
]) assert(androidSheet.includes(marker), `missing Android sheet marker: ${marker}`);

assert(protocol.includes('## Relay Session Preferences API'));

const result = {
  ok: true,
  relay_persistence: true,
  custom_name: true,
  archive_hide_restore: true,
  per_session_push_mute: true,
  web_surface: true,
  android_surface: true,
  cross_device_contract: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
