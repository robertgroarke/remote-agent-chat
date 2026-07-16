#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const selectors = require('../agent-proxy/selectors');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const progress = label => process.stderr.write('[vscode-codex-config-e2e] ' + label + '\n');
const CONFIG_FIELDS = [
  'model_id', 'effort', 'permission_profile', 'permission_mode',
  'approval_policy', 'approvals_reviewer', 'bypass_permissions_active',
  'conversation_scoped',
];

function parseArgs(argv) {
  const options = { resultFile: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || `${fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '')}/client-ws`;
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
    const messages = [];
    ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
        ws.once('open', () => {
          clearTimeout(timer);
          ws.send(JSON.stringify({
            type: 'connection_hello', protocol_version: 1, peer_role: 'browser',
            client_name: 'vscode-codex-config-gate-e2e',
          }));
          resolve();
        });
        ws.once('error', error => { clearTimeout(timer); reject(error); });
      });
      return { ws, messages };
    } catch (error) {
      lastError = error;
      try { ws.terminate(); } catch {}
      if (attempt < 2) await sleep(2000);
    }
  }
  throw lastError;
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function sessionStore() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
}

function fileSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
    size: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

function exactConfig(config) {
  return Object.fromEntries(CONFIG_FIELDS.map(field => [field, config?.[field] ?? null]));
}

async function nativeSnapshots(port, targetIds) {
  const snapshots = [];
  for (const targetId of [...targetIds].sort()) {
    let client;
    try {
      client = await CDP({ port, target: targetId });
      await client.Runtime.enable();
      const config = await selectors.readAgentConfig(client.Runtime, 'codex', '');
      snapshots.push({ target_id: targetId, config: exactConfig(config) });
    } finally {
      if (client) await client.close().catch(() => {});
    }
  }
  const body = JSON.stringify(snapshots);
  return { count: snapshots.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), snapshots };
}

async function requestConfig(relay, sessionId, label) {
  const requestId = `codex-config-read-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config' && message.session_id === sessionId && message.request_id === requestId),
    30000,
    label,
  );
}

async function subscribeSession(relay, sessionId) {
  const requestId = `codex-config-subscribe-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'subscribe', request_id: requestId, sessions: [sessionId] }));
  await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'subscription_ack' && message.request_id === requestId),
    10000,
    'Codex config E2E subscription',
  );
}

async function setConfig(relay, sessionId, sourceRevision, update, label) {
  const requestId = `codex-config-set-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'set_codex_config', session_id: sessionId, request_id: requestId,
    source_revision: sourceRevision, ...update,
  }));
  const receipt = await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_control_result' && message.request_id === requestId),
    30000,
    label,
  );
  assert.equal(receipt.session_id, sessionId, `${label} receipt crossed sessions`);
  assert.equal(receipt.result, 'ok', `${label}: ${JSON.stringify(receipt)}`);
  const configIndex = relay.messages.findIndex((message, index) => index >= start
    && message.type === 'agent_config'
    && message.session_id === sessionId
    && message.source_revision === receipt.details?.source_revision);
  const receiptIndex = relay.messages.indexOf(receipt);
  assert(configIndex >= start && configIndex < receiptIndex, `${label} succeeded before authoritative config publication`);
  return { requestId, receipt };
}

async function restoreExactConfig(relay, sessionId, initial) {
  let current = await requestConfig(relay, sessionId, 'cleanup current config');
  const apply = async (update, label) => {
    const requestId = `codex-config-cleanup-${crypto.randomBytes(5).toString('hex')}`;
    const start = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'set_codex_config', session_id: sessionId, request_id: requestId,
      source_revision: current.source_revision, ...update,
    }));
    const receipt = await waitFor(
      () => relay.messages.slice(start).find(message =>
        message.type === 'agent_control_result' && message.request_id === requestId),
      30000,
      label,
    );
    assert.equal(receipt.result, 'ok', `${label}: ${JSON.stringify(receipt)}`);
    current = await requestConfig(relay, sessionId, `${label} read-back`);
  };
  if (current.permission_profile !== initial.permission_profile) {
    await apply({ permission_profile: initial.permission_profile }, 'cleanup safe permission profile');
  }
  if (current.effort !== initial.effort) await apply({ effort: initial.effort }, 'cleanup effort');
  if (current.model_id !== initial.model_id) await apply({ model_id: initial.model_id }, 'cleanup model');
  assert.deepStrictEqual(exactConfig(current), exactConfig(initial), 'cleanup did not restore exact selected-conversation config');
}

function differentOption(options, current) {
  return (Array.isArray(options) ? options : [])
    .map(option => typeof option === 'string' ? option : option?.id)
    .find(value => value && value !== current);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const settingsPath = guard.assertUpdatesDisabled('VS Code Codex native control E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Codex native control E2E is restricted to disposable CDP port 9230');

  const targets = await CDP.List({ port: guard.CDP_PORT });
  const disposablePages = targets.filter(target => target?.type === 'page'
    && /workbench\.html/i.test(String(target.url || ''))
    && String(target.title || '').toLowerCase().includes('remote-agent-vscode-test'));
  const codexFrames = targets.filter(target => guard.isThrowawayIframe(target, 'codex'));
  assert(disposablePages.length >= 3, `Expected A/B/C disposable workbenches, found ${disposablePages.length}`);
  assert(codexFrames.length >= 3, `Expected A/B/C disposable Codex frames, found ${codexFrames.length}`);

  const relay = await openRelay();
  let relaySession = null;
  let initial = null;
  try {
    relaySession = await waitFor(() => latestSessions(relay.messages).find(candidate =>
      guard.isThrowawaySession(candidate, 'codex') && candidate?.status === 'healthy'
    ), 90000, 'base disposable Codex relay session', 250);
    progress('selected disposable session ' + relaySession.session_id);
    await subscribeSession(relay, relaySession.session_id);
    const store = sessionStore();
    const stored = store.sessions?.[relaySession.session_id];
    assert(stored, `Session ${relaySession.session_id} missing from durable store`);
    assert.equal(Number(stored.cdp_port), 9230);
    assert(codexFrames.some(frame => frame.id === stored.target_id), 'Selected relay session is not bound to a live disposable frame');
    const selectedTargetId = stored.target_id;
    const siblingTargetIds = codexFrames.map(frame => frame.id).filter(id => id !== selectedTargetId);

    const protectedTargets = (await CDP.List({ port: 9223 }))
      .filter(target => guard.isThrowawayIframe(target, 'codex'))
      .map(target => target.id);
    assert(protectedTargets.length >= 1, 'Protected VS Code Codex frames are unavailable for passive isolation proof');

    const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
    const filesBefore = { config: fileSnapshot(configPath), settings: fileSnapshot(settingsPath) };
    const siblingsBefore = await nativeSnapshots(9230, siblingTargetIds);
    const protectedBefore = await nativeSnapshots(9223, protectedTargets);
    initial = await requestConfig(relay, relaySession.session_id, 'initial native Codex config');
    progress('initial ' + initial.model_id + '/' + initial.effort + '/' + initial.permission_profile);

    assert.equal(initial.capabilities?.set_codex_config, true);
    assert.equal(initial.capabilities?.codex_model_change, true);
    assert.equal(initial.capabilities?.codex_effort_change, true);
    assert.equal(initial.capabilities?.codex_permission_profile_change, true);
    assert.equal(initial.capabilities?.codex_bypass_permissions, true);
    assert.equal(initial.controls_available, true, initial.controls_unavailable_reason || 'controls unavailable');
    assert.equal(initial.config_semantics, 'next_turn_native');
    assert(initial.source_revision, 'native config omitted source revision');
    assert(initial.permission_profile && !['unknown', 'full-access'].includes(initial.permission_profile),
      `E2E requires an observed safe starting profile, got ${initial.permission_profile}`);
    const alternateModel = differentOption(initial.available_models, initial.model_id);
    const alternateEffort = differentOption(initial.available_efforts, initial.effort);
    assert(alternateModel, 'No alternate native model is available');
    assert(alternateEffort, 'No alternate native effort is available');

    const controls = [];
    let current = initial;
    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { model_id: alternateModel }, 'set alternate model'));
    progress('alternate model applied: ' + alternateModel);
    current = await requestConfig(relay, relaySession.session_id, 'alternate model read-back');
    assert.equal(current.model_id, alternateModel);

    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { effort: alternateEffort }, 'set alternate effort'));
    progress('alternate effort applied: ' + alternateEffort);
    current = await requestConfig(relay, relaySession.session_id, 'alternate effort read-back');
    assert.equal(current.effort, alternateEffort);

    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { permission_profile: 'full-access', confirm_bypass: true }, 'enable confirmed bypass'));
    progress('confirmed bypass applied');
    current = await requestConfig(relay, relaySession.session_id, 'bypass read-back');
    assert.equal(current.permission_profile, 'full-access');
    assert.equal(current.permission_mode, 'danger-full-access');
    assert.equal(current.approval_policy, 'never');
    assert.equal(current.bypass_permissions_active, true);

    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { permission_profile: initial.permission_profile }, 'restore safe permission profile'));
    progress('safe permission profile restored: ' + initial.permission_profile);
    current = await requestConfig(relay, relaySession.session_id, 'safe profile read-back');
    assert.equal(current.permission_profile, initial.permission_profile);
    assert.notEqual(current.approval_policy, 'never');
    assert.notEqual(current.permission_mode, 'danger-full-access');
    assert.equal(current.bypass_permissions_active, false);

    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { effort: initial.effort }, 'restore effort'));
    progress('effort restored: ' + initial.effort);
    current = await requestConfig(relay, relaySession.session_id, 'restored effort read-back');
    assert.equal(current.effort, initial.effort);

    controls.push(await setConfig(relay, relaySession.session_id, current.source_revision,
      { model_id: initial.model_id }, 'restore model'));
    progress('model restored: ' + initial.model_id);
    const final = await requestConfig(relay, relaySession.session_id, 'final restored config');
    assert.deepStrictEqual(exactConfig(final), exactConfig(initial), 'selected conversation did not restore exactly');

    const siblingsAfter = await nativeSnapshots(9230, siblingTargetIds);
    const protectedAfter = await nativeSnapshots(9223, protectedTargets);
    const filesAfter = { config: fileSnapshot(configPath), settings: fileSnapshot(settingsPath) };
    assert.equal(siblingsAfter.sha256, siblingsBefore.sha256, 'Sibling B/C native configs changed');
    assert.equal(protectedAfter.sha256, protectedBefore.sha256, 'Protected 9223 native configs changed');
    assert.deepStrictEqual(filesAfter, filesBefore, 'Global config or disposable VS Code settings changed');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      route: 'websocket-browser-to-relay-to-proxy-to-selected-native-frame',
      session_id: relaySession.session_id,
      target_id: selectedTargetId,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      source_revision_present: true,
      config_semantics: final.config_semantics,
      controls: controls.map(item => ({ request_id: item.requestId, field: item.receipt.details.field, result: item.receipt.result })),
      authoritative_publication_before_receipt: true,
      bypass_readback: { permission_profile: 'full-access', permission_mode: 'danger-full-access', approval_policy: 'never' },
      safe_restore_profile: initial.permission_profile,
      selected_restored_exactly: true,
      sibling_frames: { count: siblingsAfter.count, unchanged: siblingsAfter.sha256 === siblingsBefore.sha256, sha256: siblingsAfter.sha256 },
      protected_frames: { port: 9223, count: protectedAfter.count, unchanged: protectedAfter.sha256 === protectedBefore.sha256, sha256: protectedAfter.sha256 },
      global_config_unchanged: filesAfter.config.sha256 === filesBefore.config.sha256 && filesAfter.config.mtime_ms === filesBefore.config.mtime_ms,
      disposable_settings_unchanged: filesAfter.settings.sha256 === filesBefore.settings.sha256 && filesAfter.settings.mtime_ms === filesBefore.settings.mtime_ms,
      visible_windows_opened: 0,
      focus_actions: 0,
      user_messages_sent: 0,
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try {
      if (relaySession && initial) {
        progress('cleanup verification started');
        await restoreExactConfig(relay, relaySession.session_id, initial);
        progress('cleanup verification completed');
      }
    } finally {
      try { relay.ws.close(); } catch {}
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Codex native control E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
