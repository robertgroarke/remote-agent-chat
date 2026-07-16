#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return null;
}

async function main() {
  const engine = new ProxyEngine({
    cdpPorts: [],
    relayUrl: 'ws://127.0.0.1:1/proxy-ws',
    machineLabel: 'vscode-codex-config-gate-smoke',
  });

  const workspace = 'C:\\temp\\remote-agent-vscode-test';
  const vscodeCaps = engine._buildCapabilities('codex', workspace);
  assert.equal(vscodeCaps.set_codex_config, true);
  assert.equal(vscodeCaps.codex_model_change, true);
  assert.equal(vscodeCaps.codex_effort_change, true);
  assert.equal(vscodeCaps.codex_permission_profile_change, true);
  assert.equal(vscodeCaps.codex_bypass_permissions, true);
  assert.equal(vscodeCaps.codex_access_change, false);
  assert.equal(vscodeCaps.codex_speed_change, false);
  assert.equal(engine._buildCapabilities('codex-desktop', workspace).set_codex_config, true);

  const sent = [];
  let configWriteAttempted = false;
  let nativeApplyCount = 0;
  let activeNativeApplies = 0;
  let maxConcurrentNativeApplies = 0;
  const runtime = { fixture: 'selected-frame-A' };
  let nativeConfig = {
    model_id: 'gpt-5.6-sol',
    effort: 'extra-high',
    permission_profile: 'auto',
    permission_mode: 'workspace-write',
    approval_policy: 'on-request',
    approvals_reviewer: 'user',
    bypass_permissions_active: false,
    conversation_scoped: true,
  };

  engine._sendToRelay = message => sent.push(message);
  engine._writeCodexConfigValues = () => {
    configWriteAttempted = true;
    throw new Error('VS Code Codex must never reach the shared config writer');
  };
  engine.sessions.set('vscode-codex-session', {
    agentType: 'codex',
    workspace_path: workspace,
    client: { Runtime: runtime, Input: { fixture: 'must-not-be-used' } },
  });

  const originalReadAgentConfig = selectors.readAgentConfig;
  const originalSetCodexComposerConfig = selectors.setCodexComposerConfig;
  selectors.readAgentConfig = async (receivedRuntime, agentType) => {
    assert.strictEqual(receivedRuntime, runtime, 'read-back escaped the selected frame');
    assert.equal(agentType, 'codex');
    return { ...nativeConfig };
  };
  selectors.setCodexComposerConfig = async (receivedRuntime, update, usePageEval, inputDomain) => {
    assert.strictEqual(receivedRuntime, runtime, 'mutation escaped the selected frame');
    assert.equal(usePageEval, false, 'VS Code Codex mutation used page/Desktop evaluation');
    assert.strictEqual(inputDomain, null, 'VS Code Codex mutation used focus-capable CDP Input');
    nativeApplyCount += 1;
    activeNativeApplies += 1;
    maxConcurrentNativeApplies = Math.max(maxConcurrentNativeApplies, activeNativeApplies);
    await new Promise(resolve => setTimeout(resolve, 10));
    if (update.model_id) nativeConfig.model_id = update.model_id;
    if (update.effort) nativeConfig.effort = update.effort;
    if (update.permission_profile === 'full-access') {
      assert.equal(update.confirm_bypass, true);
      nativeConfig = {
        ...nativeConfig,
        permission_profile: 'full-access',
        permission_mode: 'danger-full-access',
        approval_policy: 'never',
        approvals_reviewer: 'user',
        bypass_permissions_active: true,
      };
    }
    activeNativeApplies -= 1;
    const resultKey = update.model_id ? 'model' : update.effort ? 'effort' : 'permissions';
    return { [resultKey]: { ok: true }, readback: { ...nativeConfig } };
  };

  try {
    engine._handleRelayMessage({
      type: 'set_codex_config',
      session_id: 'vscode-codex-session',
      request_id: 'config-model-request',
      model_id: 'gpt-5.5',
    });
    engine._handleRelayMessage({
      type: 'set_codex_config',
      session_id: 'vscode-codex-session',
      request_id: 'config-effort-request',
      effort: 'high',
    });

    const effortReceipt = await waitFor(() => sent.find(message =>
      message.type === 'agent_control_result' && message.request_id === 'config-effort-request'));
    assert(effortReceipt, 'serialized VS Code Codex controls produced no terminal receipt');
    assert.equal(effortReceipt.result, 'ok');
    assert.equal(maxConcurrentNativeApplies, 1, 'same-session native controls were not serialized');
    assert.equal(nativeConfig.model_id, 'gpt-5.5');
    assert.equal(nativeConfig.effort, 'high');

    const modelReceiptIndex = sent.findIndex(message => message.request_id === 'config-model-request'
      && message.type === 'agent_control_result');
    const modelConfigIndex = sent.findIndex(message => message.type === 'agent_config'
      && message.model_id === 'gpt-5.5');
    assert(modelConfigIndex >= 0 && modelConfigIndex < modelReceiptIndex,
      'success was emitted before authoritative native config publication');

    const appliesBeforeDuplicate = nativeApplyCount;
    engine._handleRelayMessage({
      type: 'set_codex_config',
      session_id: 'vscode-codex-session',
      request_id: 'config-model-request',
      model_id: 'gpt-5.5',
    });
    await waitFor(() => sent.filter(message => message.type === 'agent_control_result'
      && message.request_id === 'config-model-request').length === 2);
    assert.equal(nativeApplyCount, appliesBeforeDuplicate, 'duplicate request repeated the native mutation');

    engine._handleRelayMessage({
      type: 'set_codex_config',
      session_id: 'vscode-codex-session',
      request_id: 'config-invalid-request',
      model_id: 'gpt-5.5',
      effort: 'medium',
    });
    const invalid = sent.find(message => message.request_id === 'config-invalid-request');
    assert.equal(invalid?.result, 'failed');
    assert.equal(invalid?.error?.code, 'invalid_message');
    assert.equal(configWriteAttempted, false, 'VS Code Codex reached the global config writer');
  } finally {
    selectors.readAgentConfig = originalReadAgentConfig;
    selectors.setCodexComposerConfig = originalSetCodexComposerConfig;
  }

  console.log(JSON.stringify({
    ok: true,
    granular_capabilities: {
      model: vscodeCaps.codex_model_change,
      effort: vscodeCaps.codex_effort_change,
      permission_profile: vscodeCaps.codex_permission_profile_change,
      bypass: vscodeCaps.codex_bypass_permissions,
    },
    native_apply_count: nativeApplyCount,
    max_concurrent_native_applies: maxConcurrentNativeApplies,
    duplicate_native_applies: nativeApplyCount - 2,
    shared_config_write_attempted: configWriteAttempted,
    final_readback: nativeConfig,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
