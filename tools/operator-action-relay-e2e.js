#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('../relay-server/node_modules/jsonwebtoken');
const WebSocket = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-operator-action-relay-'));
const port = 38300 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'operator-action-relay-session';
const allowedEmail = 'operator-action@example.test';
const jwtSecret = 'operator-action-relay-jwt-secret-0123456789';
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
  const child = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'operator-action-relay-session-secret-0123456789',
      JWT_SECRET: jwtSecret,
      PROXY_SECRET: '',
      ALLOWED_EMAIL: allowedEmail,
      ALLOW_LAN_BYPASS: 'false',
      ALLOW_LOOPBACK_BYPASS: 'false',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'operator-action-relay-client',
      GOOGLE_CLIENT_SECRET: 'operator-action-relay-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
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
        ? { proxy_id: name, machine_label: 'operator-action-relay-e2e' }
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

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const relay = startRelay();
  let proxy;
  let android;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'operator-action-proxy');
    const token = jwt.sign({ email: allowedEmail }, jwtSecret, { expiresIn: '5m' });
    android = await openSocket(`/client-ws?token=${encodeURIComponent(token)}`, 'browser', 'operator-action-android');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1, proxy_id: 'operator-action-proxy',
      sessions: [{ session_id: sessionId, agent_type: 'codex_cli', status: 'healthy' }],
    }));
    await waitFor(() => android.messages.some(message =>
      (message.type === 'session_list' || message.type === 'session_patch')
      && JSON.stringify(message).includes(sessionId)), 5000, 'session inventory');

    const baseline = proxy.messages.length;
    android.ws.send(JSON.stringify({
      type: 'open_native_window', session_id: sessionId, request_id: 'missing-gesture',
      operator_action_proof: { forged: true },
    }));
    const missing = await waitFor(() => android.messages.find(message =>
      message.request_id === 'missing-gesture' && message.error?.code === 'operator_action_only'),
    5000, 'missing gesture rejection');
    assert.equal(missing.result, 'failed');
    assert.equal(proxy.messages.length, baseline, 'missing gesture reached proxy');

    android.ws.send(JSON.stringify({
      type: 'open_native_window', session_id: sessionId, request_id: 'synthetic-gesture',
      operator_user_gesture: true, synthetic: true,
    }));
    await waitFor(() => android.messages.find(message =>
      message.request_id === 'synthetic-gesture' && message.error?.code === 'operator_action_only'),
    5000, 'synthetic gesture rejection');
    assert.equal(proxy.messages.length, baseline, 'synthetic gesture reached proxy');

    android.ws.send(JSON.stringify({
      type: 'open_native_window', session_id: sessionId, request_id: 'real-gesture',
      operator_user_gesture: true,
    }));
    const forwarded = await waitFor(() => proxy.messages.find(message => message.request_id === 'real-gesture'),
      5000, 'operator action forward');
    assert.equal(forwarded.type, 'open_native_window');
    assert.equal(forwarded.operator_action_proof.kind, 'relay_operator_action');
    assert.equal(forwarded.operator_action_proof.classification, 'operator-action-only');
    assert.equal(forwarded.operator_action_proof.channel, 'android');
    assert.equal(forwarded.operator_action_proof.authenticated, true);
    assert.equal(forwarded.operator_action_proof.user_gesture, true);
    assert.equal(forwarded.operator_action_proof.request_id, 'real-gesture');
    assert(!JSON.stringify(forwarded.operator_action_proof).includes(allowedEmail), 'proof leaked authenticated email');

    console.log(JSON.stringify({
      ok: true,
      authenticated_android_proof_forwarded: true,
      missing_gesture_rejected_at_relay: true,
      forged_client_proof_rejected_at_relay: true,
      synthetic_gesture_rejected_at_relay: true,
      proof_contains_identity: false,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    await closeSocket(android?.ws);
    await closeSocket(proxy?.ws);
    await stopChild(relay);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
