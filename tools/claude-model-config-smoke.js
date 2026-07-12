#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function main() {
  const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
  engine._readAntigravitySettings = () => ({
    'claudeCode.initialPermissionMode': 'default',
    'claudeCode.selectedModel': 'default',
  });

  const unknown = engine._mergeAgentConfig('claude', {
    model_id: 'unknown',
    permission_mode: 'default',
    available_permission_modes: [],
    available_efforts: [],
  }, 'C:\\temp\\remote-agent-vscode-test');
  assert.equal(unknown.model_id, 'unknown', 'default Antigravity setting must not masquerade as a VS Code session model');
  assert.deepEqual(unknown.available_models.map(option => option.id), ['default', 'sonnet', 'fable', 'opus', 'haiku']);

  const session = {
    agentType: 'claude',
    model_id: 'fable',
    _currentModelId: 'fable',
    _lastAvailableModels: unknown.available_models,
    autoApprovePermissions: false,
  };
  const stable = engine._decorateAgentConfig(session, { ...unknown, model_id: 'unknown' });
  assert.equal(stable.model_id, 'fable', 'confirmed Claude selection must survive later passive unknown reads');
  assert.deepEqual(stable.available_models.map(option => option.id), ['default', 'sonnet', 'fable', 'opus', 'haiku']);

  console.log(JSON.stringify({
    ok: true,
    unknown_before_control: unknown.model_id,
    stable_after_control: stable.model_id,
    available_models: stable.available_models.map(option => option.id),
  }, null, 2));
}

try {
main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
