#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const engine = new ProxyEngine({
  cdpPorts: [],
  relayUrl: 'ws://127.0.0.1:1/proxy-ws',
  machineLabel: 'vscode-codex-config-gate-smoke',
});

const workspace = 'C:\\temp\\remote-agent-vscode-test';
assert.equal(
  engine._buildCapabilities('codex', workspace).set_codex_config,
  false,
  'VS Code Codex must not advertise the shared-config mutation surface',
);
assert.equal(
  engine._buildCapabilities('codex-desktop', workspace).set_codex_config,
  true,
  'Codex Desktop retains its full native/restart-scoped config surface',
);

const sent = [];
let configWriteAttempted = false;
engine._sendToRelay = message => sent.push(message);
engine._writeCodexConfigValues = () => {
  configWriteAttempted = true;
  throw new Error('VS Code Codex must not reach the shared config writer');
};
engine.sessions.set('vscode-codex-session', {
  agentType: 'codex',
  workspace_path: workspace,
  client: { Runtime: {}, Input: {} },
});

engine._handleRelayMessage({
  type: 'set_codex_config',
  session_id: 'vscode-codex-session',
  request_id: 'config-gate-request',
  model_id: 'gpt-5.6-sol',
});

const result = sent.find(message =>
  message.type === 'agent_control_result' && message.request_id === 'config-gate-request'
);
assert(result, 'direct VS Code Codex config request returned no control result');
assert.equal(result.result, 'failed');
assert.equal(result.error?.code, 'not_supported');
assert.equal(configWriteAttempted, false, 'direct request reached the shared config writer');

console.log(JSON.stringify({
  ok: true,
  vscode_codex_set_codex_config: false,
  codex_desktop_set_codex_config: true,
  direct_request_result: result.result,
  direct_request_code: result.error.code,
  shared_config_write_attempted: configWriteAttempted,
}, null, 2));
