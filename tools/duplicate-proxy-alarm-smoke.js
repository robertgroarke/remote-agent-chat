#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDuplicateProxyAlarms } = require('../relay-server/duplicate-proxy-alarm');

const open = proxyId => [{ readyState: 1 }, { proxy_id: proxyId, sessions: new Set() }];
const a = open('proxy-a');
const b = open('proxy-b');
a[1].sessions.add('session-a');
b[1].sessions.add('session-b');
assert.deepEqual(buildDuplicateProxyAlarms([a, b]), []);

b[1].sessions.add('session-a');
assert.deepEqual(buildDuplicateProxyAlarms([a, b]), [{
  session_id: 'session-a',
  proxy_ids: ['proxy-a', 'proxy-b'],
}]);

b[0].readyState = 3;
assert.deepEqual(buildDuplicateProxyAlarms([a, b]), [], 'closed proxy must clear collision');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('relay-server/index.js');
const webHooks = read('frontend/hooks.jsx');
const webApp = read('frontend/app.jsx');
const android = read('android-app/screens/SessionListScreen.jsx');

for (const marker of [
  'proxySessionClaims', 'refreshDuplicateProxyAlarms()',
  'duplicate_proxy_alarm', 'duplicate_proxy_alarms: duplicateProxyAlarms',
]) assert(relay.includes(marker), `missing relay duplicate-proxy marker: ${marker}`);
for (const marker of ['duplicateProxyAlarms', "t === 'duplicate_proxy_alarm'", 'msg.duplicate_proxy_alarms'])
  assert(webHooks.includes(marker), `missing web hook marker: ${marker}`);
assert(webApp.includes('Duplicate proxy detected.'));
assert(android.includes("case 'duplicate_proxy_alarm'"));
assert(android.includes('Duplicate proxy detected'));

const result = {
  ok: true,
  collision_detected: true,
  disconnected_claim_clears: true,
  reconnect_restore: true,
  web_persistent_banner: true,
  android_persistent_banner: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
