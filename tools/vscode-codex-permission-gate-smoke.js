#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const engine = new ProxyEngine({
  cdpPorts: [],
  relayUrl: 'ws://127.0.0.1:1/proxy-ws',
  machineLabel: 'vscode-codex-permission-gate-smoke',
});
const workspace = 'C:\\temp\\remote-agent-vscode-test';

assert.equal(
  engine._buildCapabilities('codex', workspace).permission_dialogs,
  false,
  'VS Code Codex must not advertise permission dialogs under never/danger-full-access',
);
assert.equal(
  engine._buildCapabilities('codex-desktop', workspace).permission_dialogs,
  true,
  'Codex Desktop retains its independently verified native permission surface',
);
assert.equal(engine._buildCapabilities('claude', workspace).permission_dialogs, true);

console.log(JSON.stringify({
  ok: true,
  vscode_codex_permission_dialogs: false,
  codex_desktop_permission_dialogs: true,
  claude_permission_dialogs: true,
}, null, 2));
