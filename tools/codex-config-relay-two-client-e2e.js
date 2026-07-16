#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-control-relay-'));
const port = 37400 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'codex-control-two-client-session';
const logs = [];
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function startRelay() {
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'codex-control-relay-session-secret-0123456789',
      JWT_SECRET: 'codex-control-relay-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'codex-control-relay-client',
      GOOGLE_CLIENT_SECRET: 'codex-control-relay-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timeout = setTimeout(() => reject(new Error(`${name} connection timeout`)), 8000);
    ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'codex-control-relay-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${name} ack`)
      .then(() => { clearTimeout(timeout); resolve({ ws, messages }); }, reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function main() {
  const relay = startRelay();
  let proxy;
  let tabA;
  let tabB;
  let reconnectTab;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'codex-control-proxy');
    tabA = await openSocket('/client-ws', 'browser', 'codex-control-tab-a');
    tabB = await openSocket('/client-ws', 'browser', 'codex-control-tab-b');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1, proxy_id: 'codex-control-proxy',
      sessions: [{ session_id: sessionId, agent_type: 'codex', host_type: 'vscode', status: 'healthy' }],
    }));
    await sleep(100);
    for (const [tab, requestId] of [[tabA, 'subscribe-tab-a'], [tabB, 'subscribe-tab-b']]) {
      tab.ws.send(JSON.stringify({ type: 'subscribe', request_id: requestId, sessions: [sessionId] }));
      await waitFor(() => tab.messages.some(message =>
        message.type === 'subscription_ack' && message.request_id === requestId),
      5000, `${requestId} ack`);
    }

    const duplicate = {
      type: 'set_codex_config', protocol_version: 1, session_id: sessionId,
      request_id: 'same-request-two-tabs', model_id: 'gpt-5.5', source_revision: 'codex-revision-a',
    };
    tabA.ws.send(JSON.stringify(duplicate));
    tabB.ws.send(JSON.stringify(duplicate));
    await waitFor(() => proxy.messages.filter(message => message.request_id === duplicate.request_id).length === 2,
      5000, 'both idempotent duplicate forwards');
    const authoritativeConfig = {
      type: 'agent_config', protocol_version: 1, session_id: sessionId,
      model_id: 'gpt-5.5', effort: 'high', permission_profile: 'full-access',
      permission_mode: 'danger-full-access', approval_policy: 'never', approvals_reviewer: 'user',
      bypass_permissions_active: true, bypass_restore_profile: 'custom',
      source_revision: 'codex-revision-b', config_semantics: 'next_turn_native',
      conversation_scoped: true, controls_available: true, controls_unavailable_reason: null,
      available_models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      available_efforts: [{ id: 'high', label: 'High' }],
      available_permission_profiles: [{ id: 'full-access', label: 'Full access' }],
      model_catalog: { source: 'native_surface', client_version: 'fixture' },
      effort_catalog: { source: 'native_surface', client_version: 'fixture' },
      permission_catalog: { source: 'native_surface', client_version: 'fixture' },
      capabilities: { set_codex_config: true, codex_bypass_permissions: true },
    };
    proxy.ws.send(JSON.stringify(authoritativeConfig));
    await waitFor(() => [tabA, tabB].every(tab => tab.messages.some(message =>
      message.type === 'agent_config' && message.source_revision === 'codex-revision-b')),
    5000, 'authoritative config broadcast to both tabs');
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result', protocol_version: 1, session_id: sessionId,
      request_id: duplicate.request_id, command: 'set_codex_config', result: 'ok',
      details: { field: 'model_id', value: 'gpt-5.5', source_revision: 'codex-revision-b' },
    }));
    await waitFor(() => [tabA, tabB].every(tab => tab.messages.some(message =>
      message.type === 'agent_control_result' && message.request_id === duplicate.request_id)),
    5000, 'both tab terminal receipts');
    assert.equal(tabA.messages.filter(message => message.request_id === duplicate.request_id
      && message.type === 'agent_control_result').length, 1);
    assert.equal(tabB.messages.filter(message => message.request_id === duplicate.request_id
      && message.type === 'agent_control_result').length, 1);
    for (const tab of [tabA, tabB]) {
      const config = tab.messages.find(message =>
        message.type === 'agent_config' && message.source_revision === 'codex-revision-b');
      assert.equal(config.permission_profile, 'full-access');
      assert.equal(config.approval_policy, 'never');
      assert.equal(config.permission_mode, 'danger-full-access');
      assert.equal(config.bypass_permissions_active, true);
      assert.equal(config.available_permission_profiles[0].id, 'full-access');
      assert.equal(config.config_semantics, 'next_turn_native');
    }

    reconnectTab = await openSocket('/client-ws', 'browser', 'codex-control-reconnect-tab');
    const reconnectConfig = reconnectTab.messages.find(message => message.type === 'connection_ack')
      ?.agent_configs?.[sessionId];
    assert(reconnectConfig, 'reconnect snapshot omitted selected Codex config');
    assert.equal(reconnectConfig.source_revision, 'codex-revision-b');
    assert.equal(reconnectConfig.permission_profile, 'full-access');
    assert.equal(reconnectConfig.bypass_restore_profile, 'custom');
    assert.equal(reconnectConfig.available_models[0].id, 'gpt-5.5');

    const conflictA = { ...duplicate, request_id: 'revision-conflict' };
    const conflictB = { ...conflictA, source_revision: 'codex-different-revision' };
    const proxyStart = proxy.messages.length;
    tabA.ws.send(JSON.stringify(conflictA));
    await waitFor(() => proxy.messages.slice(proxyStart).some(message => message.request_id === conflictA.request_id),
      5000, 'first revision-bound request');
    tabB.ws.send(JSON.stringify(conflictB));
    const conflict = await waitFor(() => tabB.messages.find(message =>
      message.request_id === conflictA.request_id && message.error?.code === 'duplicate_request_conflict'),
    5000, 'revision conflict rejection');
    assert.equal(conflict.result, 'failed');
    assert.equal(proxy.messages.slice(proxyStart).filter(message => message.request_id === conflictA.request_id).length, 1,
      'conflicting duplicate reached proxy');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      two_clients: 2,
      same_request_forwarded_to_proxy: 2,
      native_terminal_results_emitted: 1,
      terminal_receipts_per_client: { tab_a: 1, tab_b: 1 },
      authoritative_config_broadcast_clients: 2,
      reconnect_snapshot_exact: true,
      duplicate_request_conflict: conflict.error.code,
      revision_bound: true,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeSocket(reconnectTab?.ws);
    await closeSocket(tabB?.ws);
    await closeSocket(tabA?.ws);
    await closeSocket(proxy?.ws);
    await stopChild(relay);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
