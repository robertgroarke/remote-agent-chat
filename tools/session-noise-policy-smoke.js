#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const proxyPolicy = require('../agent-proxy/session-noise-policy');
const relayPolicy = require('../relay-server/session-noise-policy');

const fixtures = [
  [{ workspace_path: 'C:\\temp\\cursor-test', workspace_name: 'cursor-test' }, true],
  [{ workspace_path: 'C:\\temp\\remote-agent-vscode-test', workspace_name: 'Remote Agent Chat' }, true],
  [{ workspace_path: 'C:\\temp\\remote-agent-vscode-switch-anchor-live' }, true],
  [{ workspace_path: 'C:\\work\\remote-agent-contest', workspace_name: 'remote-agent-contest' }, false],
  [{ workspace_path: 'C:\\Users\\Robert\\Documents\\Codex\\2026-07-12\\reply-with-exactly-rac-codex-desktop' }, true],
  [{ session_kind: 'validator', workspace_path: 'D:\\arbitrary' }, true],
  [{ is_test_session: true, workspace_path: 'D:\\arbitrary' }, true],
  [{ is_test_session: false, workspace_path: 'C:\\temp\\cursor-test' }, false],
  [{ workspace_path: 'C:\\Users\\Robert\\Documents\\Remote Agent Chat', workspace_name: 'Remote Agent Chat' }, false],
  [{ workspace_path: 'C:\\Users\\Robert\\Documents\\GWA Censured X BotsHub', workspace_name: 'GWA Censured X BotsHub' }, false],
  [{ workspace_path: 'C:\\Users\\Robert\\Documents\\Contest Results', workspace_name: 'Contest Results' }, false],
  [{ workspace_path: 'C:\\work\\remote-agent-contest-results', workspace_name: 'Contest Results' }, false],
  [{ workspace_path: 'C:\\work\\rac-protest-report', workspace_name: 'Protest Report' }, false],
];

for (const [fixture, expected] of fixtures) {
  assert.equal(proxyPolicy.sessionIsTestSession(fixture), expected, `proxy classification mismatch: ${JSON.stringify(fixture)}`);
  assert.equal(relayPolicy.sessionIsTestSession(fixture), expected, `relay classification mismatch: ${JSON.stringify(fixture)}`);
  assert.deepEqual(proxyPolicy.sessionNoiseMetadata(fixture), relayPolicy.sessionNoiseMetadata(fixture));
}

const tagged = proxyPolicy.sessionNoiseMetadata(fixtures[0][0]);
assert.deepEqual(tagged, {
  is_test_session: true,
  session_kind: 'validator',
  project_group: 'Remote Agent Chat',
});
assert.deepEqual(proxyPolicy.sessionNoiseMetadata({
  is_test_session: true,
  project_group: 'Custom Parent',
}), {
  is_test_session: true,
  session_kind: 'validator',
  project_group: 'Custom Parent',
});

const root = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'frontend', 'workspace-groups.js'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android-app', 'lib', 'workspace-groups.js'), 'utf8');
for (const marker of ['sessionIsTestSession', 'cursor-test', 'remote-agent-', 'reply-with-exactly-rac-']) {
  assert(web.includes(marker), `web classifier missing ${marker}`);
  assert(android.includes(marker), `Android classifier missing ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  fixtures: fixtures.length,
  validator_fixtures: fixtures.filter(([, expected]) => expected).length,
  operator_fixtures: fixtures.filter(([, expected]) => !expected).length,
  proxy_relay_policy_identical: true,
  web_android_fallback_present: true,
}, null, 2));
