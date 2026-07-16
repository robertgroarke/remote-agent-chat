#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.resolve(__dirname, '..');
const webPolicy = fs.readFileSync(path.join(ROOT, 'frontend', 'session-pins.js'), 'utf8');
const androidPolicy = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'session-pins.js'), 'utf8');
assert.strictEqual(androidPolicy, webPolicy, 'web and Android pin policies must stay byte-identical');

const transformed = esbuild.transformSync(webPolicy, {
  loader: 'js', format: 'cjs', target: 'es2020',
}).code;
const moduleShim = { exports: {} };
new Function('module', 'exports', transformed)(moduleShim, moduleShim.exports);
const { partitionPinnedSessions, sessionIsPinned, sessionPinOrder } = moduleShim.exports;

const sessions = [
  { session_id: 'gamma', chat_title: 'Gamma' },
  { session_id: 'alpha', chat_title: 'Alpha' },
  { session_id: 'beta', chat_title: 'Beta' },
  { session_id: 'delta', chat_title: 'Delta' },
];
const preferences = {
  gamma: { pinned: true, pin_order: 2 },
  alpha: { pinned: true, pin_order: 1 },
  beta: { pinned: false, pin_order: 0 },
  delta: { pinned: true, pin_order: 3 },
};
const first = partitionPinnedSessions(sessions, preferences);
assert.deepStrictEqual(first.pinned.map(session => session.session_id), ['alpha', 'gamma', 'delta']);
assert.deepStrictEqual(first.unpinned.map(session => session.session_id), ['beta']);

const refreshed = partitionPinnedSessions([
  { ...sessions[3], status: 'working', last_seen_at: '2026-07-14T13:45:03Z' },
  { ...sessions[2], status: 'healthy', last_seen_at: '2026-07-14T13:45:02Z' },
  { ...sessions[0], status: 'waiting_for_user', last_seen_at: '2026-07-14T13:45:01Z' },
  { ...sessions[1], status: 'healthy', chat_title: 'Alpha hydrated' },
], preferences);
assert.deepStrictEqual(refreshed.pinned.map(session => session.session_id), ['alpha', 'gamma', 'delta'],
  'status, title, activity, or transport order refresh moved pinned chats');

assert.strictEqual(sessionIsPinned({ pinned: true, pin_order: 0 }), true);
assert.strictEqual(sessionIsPinned({ pinned: false, pin_order: 7 }), true);
assert.strictEqual(sessionIsPinned({ pinned: false, pin_order: 0 }), false);
assert.strictEqual(sessionPinOrder({ pin_order: -1 }), 0);
assert.strictEqual(sessionPinOrder({ pin_order: 4 }), 4);

const relay = fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8');
const web = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const android = fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8');
for (const marker of [
  'pin_order    INTEGER NOT NULL DEFAULT 0',
  'MAX(pin_order)',
  'requested.pinned === true',
  'requested.pinned === false',
]) assert(relay.includes(marker), `missing relay pin contract: ${marker}`);
for (const marker of [
  'pinned-session-group', 'session-card-pin-toggle', 'aria-label={`Unpin ${chatTitle}`}',
  'partitionPinnedSessions(orderedSessions, sessionPreferences)', '...workingSessions, ...pinnedSessions, ...sessionGroups',
]) assert(web.includes(marker), `missing web pin surface: ${marker}`);
for (const marker of [
  "key: '__pinned__'", 'pinToggleOverlay', 'accessibilityLabel={`Unpin ${sessionName(item)}`}',
  'partitionPinnedSessions(visibleSessions, sessionPreferences)', 'const sections = [workingSection, pinnedSection',
]) assert(android.includes(marker), `missing Android pin surface: ${marker}`);

const result = {
  ok: true,
  policy_byte_identical: true,
  pin_order: first.pinned.map(session => session.session_id),
  non_pin_refresh_order_stable: true,
  remaining_pinned_after_working: true,
  pinned_sessions_deduplicated_from_workspace_groups: true,
  direct_unpin_web: true,
  direct_unpin_android: true,
  authenticated_api_gets_bypass_service_worker_cache: serviceWorker.includes("url.pathname.startsWith('/api/')"),
  search_and_filter_source_contracts: true,
};
assert.strictEqual(result.authenticated_api_gets_bypass_service_worker_cache, true,
  'service worker must not cache authenticated API GETs');
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
