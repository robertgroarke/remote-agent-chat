#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const Database = require('../relay-server/node_modules/better-sqlite3');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-transcript-fanout-'));
const port = 37400 + Math.floor(Math.random() * 200);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'transcript-fanout-session';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (outputIndex >= 0 && !outputPath) throw new Error('--output requires a path');
const logs = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
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
      SESSION_SECRET: 'transcript-fanout-session-secret-0123456789',
      JWT_SECRET: 'transcript-fanout-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'transcript-fanout-client',
      GOOGLE_CLIENT_SECRET: 'transcript-fanout-secret',
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
    ws.on('message', data => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'transcript-fanout-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${name} ack`)
      .then(() => {
        clearTimeout(timeout);
        resolve({ ws, messages, name });
      }, reject);
  });
}

async function closeSocket(client) {
  const ws = client?.ws || client;
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function subscribe(client, sessions) {
  const requestId = `subscribe-${client.name}-${Date.now()}`;
  client.ws.send(JSON.stringify({ type: 'subscribe', request_id: requestId, sessions }));
  await waitFor(
    () => client.messages.some(message => message.type === 'subscription_ack' && message.request_id === requestId),
    5000,
    `${client.name} subscription`,
  );
}

function sourceFrame(sourceMessageId, messageIndex, content = 'same semantic content') {
  const sourceCursor = {
    generation: 'fanout-generation',
    message_index: messageIndex,
    end_offset: 1000 + messageIndex,
    file_size: 1000 + messageIndex,
  };
  return {
    type: 'proxy_message',
    protocol_version: 1,
    session: sessionId,
    session_id: sessionId,
    role: 'assistant',
    content,
    source_message_id: sourceMessageId,
    source_cursor: sourceCursor,
    source: 'codex_cli_jsonl',
    message: {
      role: 'assistant',
      content,
      created_at: `2026-07-13T17:10:0${Math.min(9, messageIndex)}.000Z`,
      source_message_id: sourceMessageId,
      source_cursor: sourceCursor,
      source: 'codex_cli_jsonl',
    },
  };
}

function count(client, type) {
  return client.messages.filter(message => message.type === type && (message.session || message.session_id) === sessionId).length;
}

async function requestRelayTail(client) {
  const requestId = `relay-tail-${client.name}-${Date.now()}`;
  client.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session: sessionId,
    session_id: sessionId,
    request_id: requestId,
    source: 'relay_sqlite',
    mode: 'tail',
    replace: true,
    limit: 200,
  }));
  return waitFor(
    () => client.messages.find(message => message.type === 'history_chunk' && message.request_id === requestId),
    5000,
    `${client.name} relay tail`,
  );
}

async function main() {
  const relay = startRelay();
  const clients = [];
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');

    const proxy = await openSocket('/proxy-ws', 'proxy', 'fanout-proxy');
    const requester = await openSocket('/client-ws', 'browser', 'requester');
    const observer = await openSocket('/client-ws', 'browser', 'observer');
    const summaryOnly = await openSocket('/client-ws', 'browser', 'summary-only');
    const defaultClient = await openSocket('/client-ws', 'browser', 'default-no-subscribe');
    clients.push(proxy, requester, observer, summaryOnly, defaultClient);

    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: 'fanout-proxy',
      sessions: [{ session_id: sessionId, agent_type: 'codex_cli', display_name: 'Fanout fixture' }],
    }));
    await subscribe(requester, [sessionId]);
    await subscribe(observer, [sessionId]);
    await subscribe(summaryOnly, []);

    proxy.ws.send(JSON.stringify(sourceFrame('codex_cli:fanout:0', 0)));
    await waitFor(() => count(requester, 'message') === 1 && count(observer, 'message') === 1, 5000, 'subscriber append');
    await waitFor(() => count(summaryOnly, 'session_summary') >= 1 && count(defaultClient, 'session_summary') >= 1, 5000, 'summary-only append');
    assert.strictEqual(count(summaryOnly, 'message'), 0);
    assert.strictEqual(count(defaultClient, 'message'), 0, 'clients must opt in before full transcript fan-out');

    proxy.ws.send(JSON.stringify(sourceFrame('codex_cli:fanout:0', 0)));
    proxy.ws.send(JSON.stringify(sourceFrame('codex_cli:fanout:2', 2, 'gap row')));
    await waitFor(
      () => count(requester, 'transcript_resync_required') === 1 && count(observer, 'transcript_resync_required') === 1,
      5000,
      'cursor gap signals',
    );
    assert.strictEqual(count(requester, 'message'), 1, 'gap row must not persist or fan out');
    const resyncRequest = await waitFor(
      () => proxy.messages.find(message => message.type === 'transcript_resync_required' && message.session_id === sessionId),
      5000,
      'proxy cursor recovery request',
    );
    const recoveryFrames = [
      sourceFrame('codex_cli:fanout:0', 0),
      sourceFrame('codex_cli:fanout:1', 1, 'recovered missing row'),
      sourceFrame('codex_cli:fanout:2', 2, 'gap row'),
    ];
    proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      session: sessionId,
      session_id: sessionId,
      messages: recoveryFrames.map(frame => frame.message),
      resync_id: resyncRequest.resync_id,
      resync_reason: resyncRequest.reason,
      source: 'codex_cli_jsonl',
      source_cursor: recoveryFrames[2].source_cursor,
      source_bytes: 1002,
      resync_rate_limit_ms: 5000,
    }));

    const observerChunkCount = count(observer, 'history_chunk');
    const requesterTail = await requestRelayTail(requester);
    assert.strictEqual(requesterTail.messages.length, 3);
    assert.strictEqual(count(observer, 'history_chunk'), observerChunkCount, 'explicit relay history must remain requester-only');
    const observerTail = await requestRelayTail(observer);
    assert.strictEqual(observerTail.messages.length, 3);

    proxy.ws.send(JSON.stringify(sourceFrame('codex_cli:fanout:3', 3, 'post-recovery live row')));
    await waitFor(() => count(requester, 'message') === 2 && count(observer, 'message') === 2, 5000, 'post-recovery live row');

    const historyCountsBefore = clients.map(client => count(client, 'history_chunk'));
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      session: sessionId,
      session_id: sessionId,
      source: 'codex_cli_live_tail',
      messages: Array.from({ length: 50 }, (_, index) => ({ role: 'assistant', content: `legacy-tail-${index}` })),
    }));
    await sleep(150);
    clients.forEach((client, index) => {
      assert.strictEqual(count(client, 'history_chunk'), historyCountsBefore[index], 'requestless history chunk must never fan out');
    });

    const nativeRequestId = `native-explicit-${Date.now()}`;
    const observerNativeCount = count(observer, 'history_chunk');
    requester.ws.send(JSON.stringify({
      type: 'history_chunk_request',
      session: sessionId,
      session_id: sessionId,
      request_id: nativeRequestId,
      source: 'native',
      mode: 'tail',
    }));
    const nativeRequest = await waitFor(
      () => proxy.messages.find(message => message.type === 'history_chunk_request' && message.request_id === nativeRequestId),
      5000,
      'native request routing',
    );
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      session: sessionId,
      session_id: sessionId,
      request_id: nativeRequest.request_id,
      source: 'native',
      mode: 'tail',
      messages: [{ role: 'assistant', content: 'explicit native history' }],
      partial: false,
      complete: true,
    }));
    await waitFor(
      () => requester.messages.some(message => message.type === 'history_chunk' && message.request_id === nativeRequestId),
      5000,
      'native response routing',
    );
    assert.strictEqual(count(observer, 'history_chunk'), observerNativeCount, 'native history response leaked to another subscriber');

    const db = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
    const stored = db.prepare('SELECT source_message_id FROM messages WHERE session = ? ORDER BY id').all(sessionId);
    const cursor = db.prepare('SELECT generation, message_index FROM transcript_source_cursors WHERE session = ? AND source = ?')
      .get(sessionId, 'codex_cli_jsonl');
    db.close();
    assert.deepStrictEqual(stored.map(row => row.source_message_id), [
      'codex_cli:fanout:0', 'codex_cli:fanout:1', 'codex_cli:fanout:2', 'codex_cli:fanout:3',
    ]);
    assert.deepStrictEqual(cursor, { generation: 'fanout-generation', message_index: 3 });

    const result = {
      ok: true,
      persisted_incremental_rows: stored.length,
      duplicate_rows: 0,
      rejected_gap_rows_before_resync: 1,
      subscribed_requester_messages: count(requester, 'message'),
      summary_only_full_messages: count(summaryOnly, 'message'),
      default_full_messages: count(defaultClient, 'message'),
      cursor_gap_signals_per_subscriber: 1,
      proxy_resync_requests: 1,
      recovered_snapshot_rows: recoveryFrames.length,
      requestless_history_chunks_delivered: 0,
      explicit_history_nonrequester_deliveries: 0,
      final_cursor_message_index: cursor.message_index,
      windows_opened: 0,
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all(clients.map(closeSocket));
    await stopChild(relay);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
