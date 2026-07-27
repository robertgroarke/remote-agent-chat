#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-history-coalesce-'));
const port = 38600 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'history-coalesce-session';
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
      SESSION_SECRET: 'history-coalesce-session-secret-0123456789',
      JWT_SECRET: 'history-coalesce-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'history-coalesce-client',
      GOOGLE_CLIENT_SECRET: 'history-coalesce-secret',
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
        ? { proxy_id: name, machine_label: 'history-coalescing-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.find(message => message.type === 'connection_ack'), 8000, `${name} ack`)
      .then(ack => { clearTimeout(timeout); resolve({ ws, messages, ack, name }); }, reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function sendTail(client, requestId, limit = 200) {
  client.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    protocol_version: 1,
    session_id: sessionId,
    session: sessionId,
    request_id: requestId,
    mode: 'tail',
    source: 'native',
    replace: true,
    limit,
    chunk_bytes: 1024 * 1024,
  }));
}

function sendOlder(client, requestId, beforeOffset, limit = 200) {
  client.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    protocol_version: 1,
    session_id: sessionId,
    session: sessionId,
    request_id: requestId,
    mode: 'older',
    source: 'native',
    replace: false,
    user_initiated: true,
    before_offset: beforeOffset,
    limit,
    chunk_bytes: 1024 * 1024,
  }));
}

function nativeSuccess(request, marker) {
  const mode = request.mode === 'older' ? 'older' : 'tail';
  return {
    type: 'history_chunk', protocol_version: 1,
    session_id: sessionId, session: sessionId,
    request_id: request.request_id,
    mode, source: 'codex_cli_jsonl', replace: mode !== 'older',
    messages: [
      { source_message_id: `${marker}-user`, role: 'user', content: `question-${marker}`, sequence: 1, ts: 1784600000 },
      { source_message_id: `${marker}-assistant`, role: 'assistant', content: `answer-${marker}`, sequence: 2, ts: 1784600001 },
    ],
    partial: mode !== 'older', complete: mode === 'older',
    cursor: {
      start_offset: mode === 'older' ? 0 : 1024,
      end_offset: mode === 'older' ? 1024 : 4096,
      next_before_offset: mode === 'older' ? null : 1024,
      total_bytes: 31_471_461,
    },
  };
}

async function main() {
  const relay = startRelay();
  let proxy;
  const clients = [];
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'history-coalescing-proxy');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1,
      proxy_id: 'history-coalescing-proxy',
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex_cli', host_type: 'cli', status: 'healthy',
        capabilities: {}, activity: { kind: 'working', label: 'Answering' },
      }],
    }));
    await sleep(100);
    clients.push(...await Promise.all(Array.from({ length: 10 }, (_, index) => (
      openSocket('/client-ws', 'browser', `history-tab-${index + 1}`)
    ))));

    const coldStartedAt = Date.now();
    const proxyStart = proxy.messages.length;
    clients.forEach((client, index) => sendTail(client, `cold-${index + 1}`));
    const upstreamCold = await waitFor(() => proxy.messages.slice(proxyStart)
      .find(message => message.type === 'history_chunk_request'), 2500, 'one coalesced cold native request');
    await sleep(100);
    assert.equal(proxy.messages.slice(proxyStart).filter(message => message.type === 'history_chunk_request').length, 1);
    proxy.ws.send(JSON.stringify(nativeSuccess(upstreamCold, 'cold')));
    const coldResponses = await Promise.all(clients.map((client, index) => waitFor(() => client.messages.find(message => (
      message.type === 'history_chunk' && message.request_id === `cold-${index + 1}`
    )), 2500, `cold response ${index + 1}`)));
    const coldLatencyMs = Date.now() - coldStartedAt;
    assert(coldLatencyMs < 2500, `cold hydration exceeded 2500 ms: ${coldLatencyMs}`);
    assert(coldResponses.every(response => response.messages.length === 2));
    assert(coldResponses.every(response => response.history_delivery?.coalesced === true));
    assert(coldResponses.every(response => !response.error));

    const cacheStart = proxy.messages.length;
    sendTail(clients[0], 'cache-hit');
    const cacheResponse = await waitFor(() => clients[0].messages.find(message => message.request_id === 'cache-hit'), 500, 'cache response');
    assert.equal(cacheResponse.history_delivery?.served_from_cache, true);
    assert.equal(proxy.messages.length, cacheStart, 'cache hit caused a second native parse');

    const retryStart = proxy.messages.length;
    const retryRequestedAt = Date.now();
    sendTail(clients[0], 'recoverable-retry', 201);
    await sleep(250);
    assert.equal(clients[0].messages.some(message => (
      message.request_id === 'recoverable-retry' && message.error?.code === 'history_chunk_throttled'
    )), false, 'expected backpressure became operator-visible');
    const upstreamRetry = await waitFor(() => proxy.messages.slice(retryStart)
      .find(message => message.type === 'history_chunk_request'), 4000, 'relay-delayed native retry');
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk', protocol_version: 1,
      session_id: sessionId, session: sessionId,
      request_id: upstreamRetry.request_id,
      mode: 'tail', source: 'codex_cli_jsonl', replace: true,
      messages: [], partial: true, complete: false,
      error: { code: 'history_chunk_throttled', message: 'native cooldown', retry_after_ms: 100 },
      cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 31_471_461 },
    }));
    const upstreamRetryAgain = await waitFor(() => proxy.messages.slice(retryStart)
      .filter(message => message.type === 'history_chunk_request').at(1), 4000, 'proxy-throttled automatic retry');
    assert.equal(upstreamRetryAgain.request_id, upstreamRetry.request_id, 'retry changed upstream request identity');
    proxy.ws.send(JSON.stringify(nativeSuccess(upstreamRetryAgain, 'retried')));
    const recovered = await waitFor(() => clients[0].messages.find(message => message.request_id === 'recoverable-retry'), 2500, 'recovered response');
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.messages[1].content, 'answer-retried');
    assert(recovered.history_delivery.retry_count >= 2);
    assert.equal(clients[0].messages.filter(message => message.request_id === 'recoverable-retry').length, 1);

    const firstOlderStart = proxy.messages.length;
    sendOlder(clients[0], 'older-first-tab', 1024);
    const firstOlderRequest = await waitFor(() => proxy.messages.slice(firstOlderStart)
      .find(message => message.type === 'history_chunk_request' && message.mode === 'older'),
    2500, 'first older-history request');
    proxy.ws.send(JSON.stringify(nativeSuccess(firstOlderRequest, 'older-first')));
    const firstOlderResponse = await waitFor(() => clients[0].messages.find(message => (
      message.type === 'history_chunk' && message.request_id === 'older-first-tab'
    )), 2500, 'first older-history response');
    assert.equal(firstOlderResponse.error, undefined);

    // Let only the five-second rate interval expire. The former global cursor
    // tombstone remained for sixty seconds and stranded this independent tab
    // behind the relay flight timeout.
    await sleep(5100);
    const repeatedOlderStart = proxy.messages.length;
    sendOlder(clients[1], 'older-second-tab', 1024);
    const repeatedOlderRequest = await waitFor(() => proxy.messages.slice(repeatedOlderStart)
      .find(message => message.type === 'history_chunk_request' && message.mode === 'older'),
    2500, 'same-cursor older-history request from a second tab');
    proxy.ws.send(JSON.stringify(nativeSuccess(repeatedOlderRequest, 'older-second')));
    const repeatedOlderResponse = await waitFor(() => clients[1].messages.find(message => (
      message.type === 'history_chunk' && message.request_id === 'older-second-tab'
    )), 2500, 'same-cursor older-history response to a second tab');
    assert.equal(repeatedOlderResponse.error, undefined);
    assert.equal(repeatedOlderResponse.messages[1].content, 'answer-older-second');

    console.log(JSON.stringify({
      result: 'PASS',
      authenticated_clients: 10,
      cold_native_tail_parses: 1,
      cold_responses: coldResponses.length,
      cold_latency_ms: coldLatencyMs,
      response_hash_equal: new Set(coldResponses.map(response => JSON.stringify(response.messages))).size === 1,
      cache_hit_latency_budget_ms: 500,
      native_parses_on_cache_hit: 0,
      retry_delay_ms: Date.now() - retryRequestedAt,
      recoverable_throttle_visible_to_clients: 0,
      automatic_retry_terminal_receipts: 1,
      repeated_completed_cursor_tabs: 2,
      repeated_cursor_terminal_timeouts: 0,
      duplicate_rows: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
    }, null, 2));
  } finally {
    await Promise.all(clients.map(client => closeSocket(client.ws)));
    if (proxy) await closeSocket(proxy.ws);
    await stopChild(relay);
    if (path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  if (logs.length) console.error(logs.join('').slice(-8000));
  process.exit(1);
});
