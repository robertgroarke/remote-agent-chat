#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const SESSION_IDS = ['race-A', 'race-B', 'race-C'];
const WORKSPACE = 'C:\\temp\\remote-agent-vscode-race-smoke';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return null;
}

function baselineConfig() {
  return {
    model_id: 'gpt-5.6-sol',
    effort: 'extra-high',
    permission_profile: 'auto',
    permission_mode: 'workspace-write',
    approval_policy: 'on-request',
    approvals_reviewer: 'user',
    bypass_permissions_active: false,
    conversation_scoped: true,
  };
}

function applyUpdate(config, update) {
  if (update.model_id) config.model_id = update.model_id;
  if (update.effort) config.effort = update.effort;
  if (update.permission_profile) {
    config.permission_profile = update.permission_profile;
    if (update.permission_profile === 'full-access') {
      assert.equal(update.confirm_bypass, true, 'full access reached native without confirmation');
      config.permission_mode = 'danger-full-access';
      config.approval_policy = 'never';
      config.approvals_reviewer = 'user';
      config.bypass_permissions_active = true;
    } else {
      config.permission_mode = 'workspace-write';
      config.approval_policy = 'on-request';
      config.approvals_reviewer = update.permission_profile === 'guardian-approvals' ? 'guardian' : 'user';
      config.bypass_permissions_active = false;
    }
  }
}

function resultKey(update) {
  if (update.model_id) return 'model';
  if (update.effort) return 'effort';
  return 'permissions';
}

async function main() {
  const engine = new ProxyEngine({
    cdpPorts: [],
    relayUrl: 'ws://127.0.0.1:1/proxy-ws',
    machineLabel: 'vscode-codex-config-race-smoke',
  });
  const configs = new Map(SESSION_IDS.map(sid => [sid, baselineConfig()]));
  const runtimes = new Map();
  const sessions = new Map();
  const sent = [];
  const applyLog = [];
  const activeBySession = new Map();
  const maxBySession = new Map();
  let activeGlobal = 0;
  let maxGlobal = 0;
  let nativeApplyCount = 0;
  let globalWriteAttempted = false;

  engine._sendToRelay = message => sent.push(message);
  engine._writeCodexConfigValues = () => {
    globalWriteAttempted = true;
    throw new Error('VS Code Codex race smoke reached the shared config writer');
  };
  for (const sid of SESSION_IDS) {
    const runtime = { sid, delayMs: 2, skipMutationNext: false, replaceFrameNext: false };
    const session = {
      agentType: 'codex',
      workspace_path: WORKSPACE,
      client: { Runtime: runtime, Input: { forbidden: true } },
      status: 'healthy',
    };
    runtimes.set(sid, runtime);
    sessions.set(sid, session);
    engine.sessions.set(sid, session);
    engine._decorateAgentConfig(session, engine._mergeAgentConfig('codex', configs.get(sid), WORKSPACE));
  }

  const originalReadAgentConfig = selectors.readAgentConfig;
  const originalSetCodexComposerConfig = selectors.setCodexComposerConfig;
  selectors.readAgentConfig = async (runtime, agentType) => {
    assert.equal(agentType, 'codex');
    assert.strictEqual(runtimes.get(runtime.sid), runtime, 'read-back escaped its selected frame');
    return { ...configs.get(runtime.sid) };
  };
  selectors.setCodexComposerConfig = async (runtime, update, usePageEval, inputDomain) => {
    const sid = runtime.sid;
    assert.strictEqual(runtimes.get(sid), runtime, 'mutation escaped its selected frame');
    assert.equal(usePageEval, false, 'VS Code mutation used Desktop/page evaluation');
    assert.strictEqual(inputDomain, null, 'VS Code mutation used focus-capable CDP Input');
    nativeApplyCount += 1;
    activeGlobal += 1;
    maxGlobal = Math.max(maxGlobal, activeGlobal);
    const active = (activeBySession.get(sid) || 0) + 1;
    activeBySession.set(sid, active);
    maxBySession.set(sid, Math.max(maxBySession.get(sid) || 0, active));
    applyLog.push({ sid, update: { ...update } });
    await new Promise(resolve => setTimeout(resolve, runtime.delayMs));
    if (!runtime.skipMutationNext) applyUpdate(configs.get(sid), update);
    runtime.skipMutationNext = false;
    if (runtime.replaceFrameNext) {
      runtime.replaceFrameNext = false;
      engine.sessions.set(sid, { ...sessions.get(sid), client: { Runtime: { sid: `${sid}-replacement` } } });
    }
    activeGlobal -= 1;
    activeBySession.set(sid, active - 1);
    return { [resultKey(update)]: { ok: true }, readback: { ...configs.get(sid) } };
  };

  const receiptsFor = requestId => sent.filter(message =>
    message.type === 'agent_control_result' && message.request_id === requestId);
  const waitReceipt = requestId => waitFor(() => receiptsFor(requestId)[0]);
  const dispatch = message => engine._handleRelayMessage({ type: 'set_codex_config', ...message });
  const revision = sid => sessions.get(sid)._codexConfigRevision;

  try {
    // Rapid A -> B -> A and two-client same-session changes use the revision
    // accepted when queued, then serialize per selected conversation.
    const rapid = [
      { session_id: 'race-A', request_id: 'tab-1-A-model', model_id: 'gpt-5.5', source_revision: revision('race-A') },
      { session_id: 'race-B', request_id: 'tab-1-B-effort', effort: 'high', source_revision: revision('race-B') },
      { session_id: 'race-A', request_id: 'tab-2-A-effort', effort: 'medium', source_revision: revision('race-A') },
      { session_id: 'race-A', request_id: 'tab-1-A-restore', model_id: 'gpt-5.6-sol', source_revision: revision('race-A') },
    ];
    rapid.forEach(dispatch);
    assert(await waitFor(() => rapid.every(item => receiptsFor(item.request_id).length === 1)),
      'rapid A-B-A requests did not all terminate');
    assert(rapid.every(item => receiptsFor(item.request_id)[0].result === 'ok'));
    assert.equal(configs.get('race-A').model_id, 'gpt-5.6-sol');
    assert.equal(configs.get('race-A').effort, 'medium');
    assert.equal(configs.get('race-B').effort, 'high');

    // Invalid/rejected values fail before native mutation.
    const beforeInvalid = nativeApplyCount;
    dispatch({ session_id: 'race-A', request_id: 'invalid-effort', effort: 'impossible' });
    const invalid = await waitReceipt('invalid-effort');
    assert.equal(invalid.result, 'failed');
    assert.equal(invalid.error.code, 'invalid_value');
    assert.equal(nativeApplyCount, beforeInvalid);

    // A revision that was already stale when queued never reaches native.
    dispatch({ session_id: 'race-A', request_id: 'stale-source', model_id: 'gpt-5.5', source_revision: 'codex-stale' });
    const staleSource = await waitReceipt('stale-source');
    assert.equal(staleSource.result, 'failed');
    assert.equal(staleSource.error.code, 'stale_config');

    // Native control remains a labelled next-turn operation during an active turn.
    sessions.get('race-B').status = 'working';
    configs.get('race-B').turn_state = 'answering';
    const activeRevision = engine._decorateAgentConfig(
      sessions.get('race-B'),
      engine._mergeAgentConfig('codex', configs.get('race-B'), WORKSPACE),
    ).source_revision;
    dispatch({ session_id: 'race-B', request_id: 'active-next-turn', effort: 'extra-high', source_revision: activeRevision });
    const activeTurn = await waitReceipt('active-next-turn');
    assert.equal(activeTurn.result, 'ok');
    assert.equal(activeTurn.details.field, 'effort');
    assert.equal(configs.get('race-B').effort, 'extra-high');

    // An in-flight frame replacement produces one stale-frame terminal error.
    const cBeforeStale = { ...configs.get('race-C') };
    runtimes.get('race-C').replaceFrameNext = true;
    dispatch({ session_id: 'race-C', request_id: 'stale-frame', model_id: 'gpt-5.5', source_revision: revision('race-C') });
    const staleFrame = await waitReceipt('stale-frame');
    assert.equal(staleFrame.result, 'failed');
    assert.equal(staleFrame.error.code, 'stale_frame');
    engine.sessions.set('race-C', sessions.get('race-C'));
    configs.set('race-C', cBeforeStale);
    engine._decorateAgentConfig(sessions.get('race-C'), engine._mergeAgentConfig('codex', cBeforeStale, WORKSPACE));

    // Exact read-back mismatch rolls the optimistic/native attempt back.
    const beforeMismatch = configs.get('race-C').effort;
    runtimes.get('race-C').skipMutationNext = true;
    dispatch({ session_id: 'race-C', request_id: 'readback-mismatch', effort: 'high', source_revision: revision('race-C') });
    const mismatch = await waitReceipt('readback-mismatch');
    assert.equal(mismatch.result, 'failed');
    assert.equal(mismatch.error.code, 'readback_mismatch');
    assert.equal(configs.get('race-C').effort, beforeMismatch);

    // A duplicate from a second client while pending applies once. Replaying it
    // after a proxy WebSocket reconnect returns the cached receipt, not a mutation.
    runtimes.get('race-A').delayMs = 20;
    const duplicateMessage = {
      session_id: 'race-A', request_id: 'duplicate-idempotent', model_id: 'gpt-5.5', source_revision: revision('race-A'),
    };
    const beforeDuplicate = nativeApplyCount;
    dispatch(duplicateMessage);
    dispatch(duplicateMessage);
    assert(await waitFor(() => receiptsFor('duplicate-idempotent').length === 1), 'pending duplicate did not terminate');
    assert.equal(nativeApplyCount, beforeDuplicate + 1);
    const reconnectReceipts = [];
    engine._sendToRelay = message => reconnectReceipts.push(message);
    dispatch(duplicateMessage);
    assert(await waitFor(() => reconnectReceipts.length === 1), 'reconnect did not replay cached receipt');
    assert.equal(reconnectReceipts[0].result, 'ok');
    assert.equal(nativeApplyCount, beforeDuplicate + 1);
    const duplicateNativeApplies = nativeApplyCount - beforeDuplicate;
    engine._sendToRelay = message => sent.push(message);
    runtimes.get('race-A').delayMs = 2;

    // Deterministic 100-change multi-session run. Each session is independently
    // serialized while the three selected frames may progress concurrently.
    let randomState = 0x5eed1234;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    const stress = [];
    const expected = new Map(SESSION_IDS.map(sid => [sid, { ...configs.get(sid) }]));
    const models = ['gpt-5.5', 'gpt-5.6-sol'];
    const efforts = ['light', 'medium', 'high', 'extra-high', 'ultra'];
    const profiles = ['auto', 'guardian-approvals', 'custom', 'full-access'];
    for (let index = 0; index < 100; index += 1) {
      const sid = SESSION_IDS[Math.floor(random() * SESSION_IDS.length)];
      const fieldIndex = Math.floor(random() * 3);
      let message;
      if (fieldIndex === 0) {
        message = { model_id: models[Math.floor(random() * models.length)] };
      } else if (fieldIndex === 1) {
        message = { effort: efforts[Math.floor(random() * efforts.length)] };
      } else {
        const permission_profile = profiles[Math.floor(random() * profiles.length)];
        message = { permission_profile, ...(permission_profile === 'full-access' ? { confirm_bypass: true } : {}) };
      }
      const request = { session_id: sid, request_id: `stress-${String(index).padStart(3, '0')}`, ...message };
      stress.push(request);
      applyUpdate(expected.get(sid), message);
      dispatch(request);
    }
    assert(await waitFor(() => stress.every(item => receiptsFor(item.request_id).length === 1), 20000),
      '100-change run did not produce exactly one terminal receipt per request');
    assert(stress.every(item => receiptsFor(item.request_id)[0].result === 'ok'), '100-change run contained a failure');
    assert(await waitFor(() => engine._codexConfigPending.size === 0 && engine._codexConfigQueues.size === 0),
      'Codex control queues did not return to baseline');
    for (const sid of SESSION_IDS) {
      assert.deepStrictEqual(configs.get(sid), expected.get(sid), `${sid} final config was not authoritative`);
      assert.equal(maxBySession.get(sid), 1, `${sid} ran concurrent native mutations`);
    }
    for (const request of stress) {
      const receipt = receiptsFor(request.request_id)[0];
      assert.equal(receipt.session_id, request.session_id, `${request.request_id} crossed sessions`);
      assert(!JSON.stringify(receipt).includes('Runtime'), 'receipt leaked raw frame state');
    }
    assert(maxGlobal >= 2, 'independent selected conversations did not make concurrent progress');
    assert.equal(globalWriteAttempted, false);
    assert.equal(engine._codexConfigPending.size, 0);
    assert.equal(engine._codexConfigQueues.size, 0);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      rapid_selection_requests: rapid.length,
      two_client_same_session: true,
      rejected_value: invalid.error.code,
      stale_source: staleSource.error.code,
      stale_frame: staleFrame.error.code,
      readback_mismatch: mismatch.error.code,
      active_turn_semantics: 'next_turn_native',
      duplicate_native_applies: duplicateNativeApplies,
      reconnect_cached_receipts: reconnectReceipts.length,
      randomized_changes: stress.length,
      randomized_terminal_receipts: stress.filter(item => receiptsFor(item.request_id).length === 1).length,
      pending_after: engine._codexConfigPending.size,
      queues_after: engine._codexConfigQueues.size,
      receipt_cache_size: engine._codexConfigReceipts.size,
      max_concurrent_per_session: Object.fromEntries(maxBySession),
      max_concurrent_selected_frames: maxGlobal,
      shared_config_write_attempted: globalWriteAttempted,
      native_apply_count: nativeApplyCount,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    selectors.readAgentConfig = originalReadAgentConfig;
    selectors.setCodexComposerConfig = originalSetCodexComposerConfig;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
