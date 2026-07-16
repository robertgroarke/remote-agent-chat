#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('../relay-server/node_modules/ws');
const Database = require('../relay-server/node_modules/better-sqlite3');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-relay-receipt-'));
const logs = [];
const sessionId = 'codex-receipt-e2e';
const secondSessionId = 'codex-receipt-other';
const cid = 'codex-receipt-cid-1';
const prompt = 'relay receipt e2e prompt body';
const processEpoch = 'receipt-e2e-epoch-1';
const contentSha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function health(port) {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/healthz`, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
  });
}

function startRelay(port) {
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'codex-receipt-e2e-session-secret-0123456789',
      JWT_SECRET: 'codex-receipt-e2e-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'codex-receipt-e2e-client',
      GOOGLE_CLIENT_SECRET: 'codex-receipt-e2e-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
}

async function stopRelay(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(port, route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const origin = `http://127.0.0.1:${port}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${peerRole} connection timed out`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'codex-receipt-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${peerRole} connection_ack`)
      .then(() => {
        clearTimeout(timer);
        resolve({ ws, messages });
      }, reject);
  });
}

async function closeSocket(socket) {
  const ws = socket?.ws || socket;
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function registerSessions(proxy) {
  proxy.ws.send(JSON.stringify({
    type: 'session_list',
    sessions: [sessionId, secondSessionId].map(id => ({
      session_id: id,
      display_name: id,
      agent_type: 'codex_cli',
      workspace_name: 'Receipt E2E',
      workspace_path: root,
      status: 'healthy',
      capabilities: { send_message: true },
    })),
  }));
}

async function main() {
  const port = await freePort();
  let relay = startRelay(port);
  let proxy;
  let browser;
  try {
    await waitFor(() => health(port), 10000, 'relay health');
    proxy = await openSocket(port, '/proxy-ws', 'proxy', 'codex-receipt-proxy');
    browser = await openSocket(port, '/client-ws', 'browser', 'codex-receipt-browser');
    registerSessions(proxy);
    await waitFor(() => browser.messages.some(message => message.type === 'session_list'), 5000, 'session list');
    browser.ws.send(JSON.stringify({ type: 'subscribe', sessions: [sessionId, secondSessionId], request_id: 'sub-1' }));
    await waitFor(() => browser.messages.some(message => message.type === 'subscription_ack' && message.request_id === 'sub-1'), 5000, 'subscription ack');

    browser.ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: cid }));
    const nativeSend = await waitFor(
      () => proxy.messages.find(message => message.type === 'send' && message.client_message_id === cid),
      5000,
      'single native dispatch',
    );
    assert.strictEqual(nativeSend.content, prompt);
    const accepted = await waitFor(
      () => browser.messages.find(message => message.type === 'message_accepted' && message.client_message_id === cid),
      5000,
      'relay acceptance',
    );
    assert.strictEqual(accepted.status, 'accepted');
    const echoed = await waitFor(
      () => browser.messages.find(message => message.type === 'message' && message.client_message_id === cid),
      5000,
      'accepted user echo',
    );
    assert.strictEqual(echoed.status, 'accepted');

    proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
      result: 'launch_accepted', lifecycle: 'proxy_launch_accepted', process_epoch: processEpoch,
      accepted_at: new Date().toISOString(),
    }));
    await waitFor(
      () => browser.messages.find(message => message.type === 'proxy_send_result' && message.result === 'launch_accepted' && message.client_message_id === cid),
      5000,
      'proxy launch acceptance',
    );
    proxy.ws.send(JSON.stringify({
      type: 'status', session_id: sessionId, activity: { kind: 'generating', label: 'Codex CLI running' },
    }));
    await sleep(100);
    assert.strictEqual(
      browser.messages.filter(message => message.type === 'agent_started' && message.client_message_id === cid).length,
      0,
      'launch/activity must not synthesize agent_started for native-receipt-managed sends',
    );

    const nativeReceipt = {
      session_id: 'native-cli-thread-1', client_message_id: cid,
      content_sha256: contentSha256, content_utf8_bytes: Buffer.byteLength(prompt, 'utf8'),
      content_characters: prompt.length, post_baseline_occurrence: 1,
      process_epoch: processEpoch, source: 'response_item.message',
      native_event_at: new Date().toISOString(), observed_at: new Date().toISOString(),
      source_cursor: { start_offset: 100, end_offset: 200, file_size: 300, rotated: false },
    };
    proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
      result: 'delivered', lifecycle: 'native_user_turn_observed',
      native_receipt: nativeReceipt, process_epoch: processEpoch,
    }));
    await waitFor(
      () => browser.messages.find(message => message.type === 'proxy_send_result' && message.result === 'delivered' && message.client_message_id === cid),
      5000,
      'native delivery receipt',
    );
    proxy.ws.send(JSON.stringify({
      type: 'agent_started', protocol_version: 1, session_id: sessionId, client_message_id: cid,
      delivered_at: nativeReceipt.observed_at, started_at: new Date().toISOString(),
      native_receipt: nativeReceipt,
      native_start: { source: 'response_item.reasoning', source_cursor: { start_offset: 201, end_offset: 250 } },
    }));
    await waitFor(
      () => browser.messages.find(message => message.type === 'agent_started' && message.client_message_id === cid),
      5000,
      'native agent_started',
    );
    assert.strictEqual(
      browser.messages.filter(message => message.type === 'agent_started' && message.client_message_id === cid).length,
      1,
      'agent_started must emit exactly once',
    );

    const deliveredCount = browser.messages.filter(message => message.type === 'proxy_send_result'
      && message.result === 'delivered' && message.client_message_id === cid).length;
    const startedCount = browser.messages.filter(message => message.type === 'agent_started'
      && message.client_message_id === cid).length;
    proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
      result: 'delivered', lifecycle: 'native_user_turn_observed',
      native_receipt: nativeReceipt, process_epoch: processEpoch,
    }));
    proxy.ws.send(JSON.stringify({
      type: 'agent_started', protocol_version: 1, session_id: sessionId, client_message_id: cid,
      delivered_at: nativeReceipt.observed_at, started_at: new Date().toISOString(),
      native_receipt: nativeReceipt,
      native_start: { source: 'response_item.reasoning', source_cursor: { start_offset: 201, end_offset: 250 } },
    }));
    await sleep(100);
    assert.strictEqual(browser.messages.filter(message => message.type === 'proxy_send_result'
      && message.result === 'delivered' && message.client_message_id === cid).length, deliveredCount,
    'duplicate native receipt event must not rebroadcast');
    assert.strictEqual(browser.messages.filter(message => message.type === 'agent_started'
      && message.client_message_id === cid).length, startedCount,
    'duplicate agent_started event must not rebroadcast');

    const firstDispatchCount = proxy.messages.filter(message => message.type === 'send' && message.client_message_id === cid).length;
    browser.ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: cid }));
    const replay = await waitFor(
      () => browser.messages.find(message => message.type === 'message_accepted' && message.client_message_id === cid && message.replayed),
      5000,
      'same-connection idempotent replay',
    );
    assert.strictEqual(replay.status, 'agent_started');
    await sleep(100);
    assert.strictEqual(proxy.messages.filter(message => message.type === 'send' && message.client_message_id === cid).length, firstDispatchCount);

    await closeSocket(proxy);
    proxy = null;
    const offlineReplayStart = browser.messages.length;
    browser.ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: cid }));
    const offlineReplay = await waitFor(
      () => browser.messages.slice(offlineReplayStart).find(message => message.type === 'message_accepted'
        && message.client_message_id === cid && message.replayed),
      5000,
      'offline idempotent replay',
    );
    assert.strictEqual(offlineReplay.status, 'agent_started');

    browser.ws.send(JSON.stringify({ type: 'send', session: secondSessionId, content: prompt, client_message_id: cid }));
    const mismatch = await waitFor(
      () => browser.messages.find(message => message.type === 'message_failed' && message.client_message_id === cid && message.error?.code === 'client_message_id_session_mismatch'),
      5000,
      'cross-session cid rejection',
    );
    assert(mismatch);

    await closeSocket(browser);
    await stopRelay(relay);

    const dbPath = path.join(dataDir, 'messages.db');
    const db = new Database(dbPath, { readonly: true });
    const messageRow = db.prepare('SELECT status, client_msg_id, native_receipt, process_epoch FROM messages WHERE client_msg_id = ?').get(cid);
    const receiptRow = db.prepare('SELECT status, native_receipt, process_epoch, failure_code FROM send_receipts WHERE client_msg_id = ?').get(cid);
    db.close();
    assert.strictEqual(messageRow.status, 'agent_started');
    assert.strictEqual(receiptRow.status, 'agent_started');
    assert.strictEqual(receiptRow.process_epoch, processEpoch);
    assert(!receiptRow.native_receipt.includes(prompt), 'receipt journal must not store prompt bodies');
    assert.strictEqual(JSON.parse(receiptRow.native_receipt).content_sha256, contentSha256);

    relay = startRelay(port);
    await waitFor(() => health(port), 10000, 'restarted relay health');
    proxy = await openSocket(port, '/proxy-ws', 'proxy', 'codex-receipt-proxy-restarted');
    browser = await openSocket(port, '/client-ws', 'browser', 'codex-receipt-browser-restarted');
    registerSessions(proxy);
    await waitFor(() => browser.messages.some(message => message.type === 'session_list'), 5000, 'restarted session list');
    browser.ws.send(JSON.stringify({ type: 'subscribe', sessions: [sessionId, secondSessionId], request_id: 'sub-2' }));
    await waitFor(() => browser.messages.some(message => message.type === 'subscription_ack' && message.request_id === 'sub-2'), 5000, 'restarted subscription ack');
    browser.ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: cid }));
    const restartReplay = await waitFor(
      () => browser.messages.find(message => message.type === 'message_accepted' && message.client_message_id === cid && message.replayed),
      5000,
      'restart idempotent replay',
    );
    assert.strictEqual(restartReplay.status, 'agent_started');
    await sleep(100);
    assert.strictEqual(proxy.messages.filter(message => message.type === 'send' && message.client_message_id === cid).length, 0);

    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      lifecycle: ['relay_accepted', 'proxy_launch_accepted', 'native_user_turn_observed', 'agent_started'],
      native_dispatches: 1,
      same_connection_retry_dispatches: 0,
      offline_retry_dispatches: 0,
      post_restart_retry_dispatches: 0,
      duplicate_lifecycle_rebroadcasts: 0,
      persisted_status: receiptRow.status,
      prompt_body_in_receipt_journal: false,
      visible_windows: 0,
      protected_sessions_touched: 0,
    })}\n`);
  } catch (error) {
    throw new Error(`${error.stack || error.message}\n${logs.join('')}`);
  } finally {
    await closeSocket(browser).catch(() => {});
    await closeSocket(proxy).catch(() => {});
    await stopRelay(relay).catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
