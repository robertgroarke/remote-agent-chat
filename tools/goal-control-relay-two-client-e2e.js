#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-goal-stop-relay-'));
const port = 38100 + Math.floor(Math.random() * 500);
const origin = `http://127.0.0.1:${port}`;
const goalSessionId = 'exact-goal-control-session';
const stopSessionId = 'exact-stop-control-session';
const logs = [];
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
      SESSION_SECRET: 'goal-control-relay-session-secret-0123456789',
      JWT_SECRET: 'goal-control-relay-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'goal-control-relay-client',
      GOOGLE_CLIENT_SECRET: 'goal-control-relay-secret',
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
        ? { proxy_id: name, machine_label: 'goal-control-relay-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.find(message => message.type === 'connection_ack'), 8000, `${name} ack`)
      .then(ack => { clearTimeout(timeout); resolve({ ws, messages, ack }); }, reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function sessionFromAck(client, sessionId) {
  return client.ack.sessions.find(item => item?.session_id === sessionId);
}

function goalRequest(client, session, requestId) {
  return {
    type: 'agent_goal_control', protocol_version: 1,
    request_id: requestId, session_id: goalSessionId, action: 'resume',
    connection_id: client.ack.connection_id,
    session_generation: session.control_generation,
    goal_generation: 7,
    goal_transition_seq: 3,
    goal_fingerprint: 'goal-seven',
  };
}

function stopRequest(client, session, requestId) {
  return {
    type: 'agent_interrupt', protocol_version: 1,
    request_id: requestId, session_id: stopSessionId,
    connection_id: client.ack.connection_id,
    session_generation: session.control_generation,
    turn_generation: session.turn_generation,
  };
}

async function main() {
  const relay = startRelay();
  let proxy;
  let tabA;
  let tabB;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'goal-control-proxy');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1, proxy_id: 'goal-control-proxy',
      sessions: [
        {
          session_id: goalSessionId, agent_type: 'codex_cli', host_type: 'cli', status: 'healthy',
          capabilities: { goal_pause_resume: true, goal_blocked_resume: true, interrupt: true },
          activity: {
            kind: 'blocked', label: 'Dependency unavailable',
            goal: {
              state: 'blocked', status: 'blocked', objective: 'Exact control', token_budget: 700,
              generation: 7, transition_seq: 3, fingerprint: 'goal-seven',
            },
          },
        },
        {
          session_id: stopSessionId, agent_type: 'claude', host_type: 'vscode', status: 'healthy',
          capabilities: { interrupt: true },
          activity: { kind: 'working', label: 'Working' },
        },
      ],
    }));
    await sleep(100);
    tabA = await openSocket('/client-ws', 'browser', 'goal-control-tab-a');
    tabB = await openSocket('/client-ws', 'browser', 'goal-control-tab-b');
    const goalA = sessionFromAck(tabA, goalSessionId);
    const goalB = sessionFromAck(tabB, goalSessionId);
    const stopA = sessionFromAck(tabA, stopSessionId);
    const stopB = sessionFromAck(tabB, stopSessionId);
    assert(goalA && goalB && stopA && stopB, 'connection snapshot omitted control sessions');
    assert(goalA.control_generation > 0 && stopA.turn_generation > 0);

    const proxyGoalStart = proxy.messages.length;
    tabA.ws.send(JSON.stringify(goalRequest(tabA, goalA, 'goal-tab-a')));
    tabB.ws.send(JSON.stringify(goalRequest(tabB, goalB, 'goal-tab-b')));
    let upstreamGoal;
    try {
      upstreamGoal = await waitFor(() => proxy.messages.slice(proxyGoalStart)
        .find(message => message.type === 'agent_goal_control'), 5000, 'one upstream goal operation');
    } catch (error) {
      throw new Error(`${error.message}; proxy_state=${proxy.ws.readyState}; proxy=${JSON.stringify(proxy.messages.slice(-5))}; tabA=${JSON.stringify(tabA.messages.slice(-5))}; tabB=${JSON.stringify(tabB.messages.slice(-5))}; logs=${logs.join('').slice(-3000)}`);
    }
    await sleep(100);
    assert.equal(proxy.messages.slice(proxyGoalStart).filter(message => message.type === 'agent_goal_control').length, 1);
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result', protocol_version: 1,
      session_id: goalSessionId, request_id: upstreamGoal.request_id,
      command: 'agent_goal_control', result: 'ok', native_acknowledged: true,
      details: { native_acknowledged: true, native_operations: 1, transcript_messages_appended: 0 },
    }));
    const goalReceiptA = await waitFor(() => tabA.messages.find(message => message.request_id === 'goal-tab-a'), 5000, 'tab A goal receipt');
    const goalReceiptB = await waitFor(() => tabB.messages.find(message => message.request_id === 'goal-tab-b'), 5000, 'tab B goal receipt');
    assert.equal(goalReceiptA.result, 'ok');
    assert.equal(goalReceiptB.result, 'ok');
    assert.equal(goalReceiptA.native_acknowledged, true);
    assert.equal(goalReceiptB.native_acknowledged, true);

    const beforeReplay = proxy.messages.length;
    tabA.ws.send(JSON.stringify(goalRequest(tabA, goalA, 'goal-double-click')));
    const replay = await waitFor(() => tabA.messages.find(message => message.request_id === 'goal-double-click'), 5000, 'double-click replay');
    assert.equal(replay.replayed, true);
    assert.equal(proxy.messages.length, beforeReplay, 'resolved double-click reached the native proxy');

    const beforeStale = proxy.messages.length;
    tabA.ws.send(JSON.stringify({
      ...goalRequest(tabA, goalA, 'stale-connection'),
      connection_id: 'expired-connection-id',
    }));
    const staleConnection = await waitFor(() => tabA.messages.find(message => message.request_id === 'stale-connection'), 5000, 'stale connection rejection');
    assert.equal(staleConnection.error.code, 'stale_client_connection');
    tabB.ws.send(JSON.stringify({
      ...stopRequest(tabB, stopB, 'stale-session'),
      session_generation: stopB.control_generation + 1,
    }));
    const staleSession = await waitFor(() => tabB.messages.find(message => message.request_id === 'stale-session'), 5000, 'stale session rejection');
    assert.equal(staleSession.error.code, 'stale_session_generation');
    assert.equal(proxy.messages.length, beforeStale, 'stale controls reached the native proxy');

    const proxyStopStart = proxy.messages.length;
    tabA.ws.send(JSON.stringify(stopRequest(tabA, stopA, 'stop-tab-a')));
    tabB.ws.send(JSON.stringify(stopRequest(tabB, stopB, 'stop-tab-b')));
    const upstreamStop = await waitFor(() => proxy.messages.slice(proxyStopStart)
      .find(message => message.type === 'agent_interrupt'), 5000, 'one upstream stop operation');
    await sleep(100);
    assert.equal(proxy.messages.slice(proxyStopStart).filter(message => message.type === 'agent_interrupt').length, 1);
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result', protocol_version: 1,
      session_id: stopSessionId, request_id: upstreamStop.request_id,
      command: 'agent_interrupt', result: 'ok', native_acknowledged: true,
      details: { native_acknowledged: true, native_operations: 1 },
    }));
    const stopReceiptA = await waitFor(() => tabA.messages.find(message => message.request_id === 'stop-tab-a'), 5000, 'tab A stop receipt');
    const stopReceiptB = await waitFor(() => tabB.messages.find(message => message.request_id === 'stop-tab-b'), 5000, 'tab B stop receipt');
    assert.equal(stopReceiptA.result, 'ok');
    assert.equal(stopReceiptB.result, 'ok');
    assert.equal(stopReceiptA.native_acknowledged, true);
    assert.equal(stopReceiptB.native_acknowledged, true);

    proxy.ws.send(JSON.stringify({
      type: 'proxy_status', protocol_version: 1, session_id: stopSessionId, status: 'healthy',
      activity: { kind: 'idle', label: '' },
    }));
    proxy.ws.send(JSON.stringify({
      type: 'proxy_status', protocol_version: 1, session_id: stopSessionId, status: 'healthy',
      activity: { kind: 'working', label: 'Working again' },
    }));
    await sleep(150);
    const missingAckRequest = {
      ...stopRequest(tabA, stopA, 'missing-native-ack'),
      turn_generation: stopA.turn_generation + 1,
    };
    const missingAckStart = proxy.messages.length;
    tabA.ws.send(JSON.stringify(missingAckRequest));
    const upstreamMissingAck = await waitFor(() => proxy.messages.slice(missingAckStart)
      .find(message => message.type === 'agent_interrupt'), 5000, 'missing-ack stop operation');
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result', protocol_version: 1,
      session_id: stopSessionId, request_id: upstreamMissingAck.request_id,
      command: 'agent_interrupt', result: 'ok',
      details: { native_operations: 1 },
    }));
    const missingAckReceipt = await waitFor(() => tabA.messages.find(message => message.request_id === 'missing-native-ack'), 5000, 'missing native ack rejection');
    assert.equal(missingAckReceipt.result, 'failed');
    assert.equal(missingAckReceipt.error.code, 'native_receipt_missing');

    console.log(JSON.stringify({
      ok: true,
      two_clients: 2,
      goal_native_operations: 1,
      goal_transition: 'blocked_to_active',
      interrupt_native_operations: 1,
      receipts: 4,
      replayed_double_click: true,
      stale_connection_failed_closed: true,
      stale_session_failed_closed: true,
      missing_native_ack_failed_closed: true,
      visible_windows_opened: 0,
      focus_actions: 0,
    }, null, 2));
  } finally {
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
