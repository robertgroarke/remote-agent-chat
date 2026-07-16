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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-source-idempotency-'));
const port = 37100 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'source-idempotency-session';
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
      SESSION_SECRET: 'source-idempotency-session-secret-0123456789',
      JWT_SECRET: 'source-idempotency-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'source-idempotency-client',
      GOOGLE_CLIENT_SECRET: 'source-idempotency-secret',
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
    const timeout = setTimeout(() => reject(new Error(`${peerRole} connection timeout`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'source-idempotency-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${peerRole} ack`)
      .then(() => {
        clearTimeout(timeout);
        resolve({ ws, messages });
      }, reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function sourceFrame(sourceMessageId, messageIndex) {
  const createdAt = '2026-07-13T17:00:02.375Z';
  const sourceCursor = { generation: 'fixture-generation', message_index: messageIndex, end_offset: 460, file_size: 460 };
  return {
    type: 'proxy_message',
    protocol_version: 1,
    session_id: sessionId,
    session: sessionId,
    role: 'assistant',
    content: 'same semantic content may be a distinct native row',
    source_message_id: sourceMessageId,
    source_cursor: sourceCursor,
    source: 'codex_cli_jsonl',
    message: {
      role: 'assistant',
      content: 'same semantic content may be a distinct native row',
      created_at: createdAt,
      source_message_id: sourceMessageId,
      source_cursor: sourceCursor,
      source: 'codex_cli_jsonl',
    },
  };
}

async function connectPair(run) {
  await waitFor(async () => {
    if (run.exitCode != null) throw new Error(logs.join('').slice(-5000));
    try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
  }, 15_000, 'relay health');
  const proxy = await openSocket('/proxy-ws', 'proxy', `source-idempotency-proxy-${Date.now()}`);
  const browser = await openSocket('/client-ws', 'browser', `source-idempotency-browser-${Date.now()}`);
  browser.ws.send(JSON.stringify({ type: 'subscribe', request_id: `subscribe-${Date.now()}`, sessions: [sessionId] }));
  await waitFor(() => browser.messages.some(message => message.type === 'subscription_ack'), 5000, 'subscription ack');
  return { proxy, browser };
}

async function main() {
  let relay = startRelay();
  let pair = null;
  let observer = null;
  try {
    pair = await connectPair(relay);
    observer = await openSocket('/client-ws', 'browser', `source-idempotency-observer-${Date.now()}`);
    observer.ws.send(JSON.stringify({
      type: 'subscribe',
      request_id: `observer-subscribe-${Date.now()}`,
      sessions: [sessionId],
    }));
    await waitFor(() => observer.messages.some(message => message.type === 'subscription_ack'), 5000, 'observer subscription ack');
    pair.proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      protocol_version: 1,
      proxy_id: 'source-idempotency-proxy',
      sessions: [{ session_id: sessionId, agent_type: 'codex_cli' }],
    }));
    await sleep(100);
    const first = sourceFrame('codex_cli:stable:first', 0);
    const second = sourceFrame('codex_cli:stable:second', 1);
    pair.proxy.ws.send(JSON.stringify(first));
    pair.proxy.ws.send(JSON.stringify(first));
    pair.proxy.ws.send(JSON.stringify(second));
    await waitFor(
      () => pair.browser.messages.filter(message => message.type === 'message' && message.session === sessionId).length === 2,
      5000,
      'two distinct source rows',
    );
    await sleep(100);
    const firstRunRows = pair.browser.messages.filter(message => message.type === 'message' && message.session === sessionId);
    assert.deepStrictEqual(firstRunRows.map(message => message.source_message_id), [
      'codex_cli:stable:first',
      'codex_cli:stable:second',
    ], 'same source id must dedupe while distinct stable ids preserve identical content rows');
    assert(firstRunRows.every(message => message.source_cursor?.end_offset === 460));
    assert(firstRunRows.every(message => message.ts === 1783962002.375));
    assert(firstRunRows.every(message => message.created_at === '2026-07-13T17:00:02.375Z'));

    const correctedTimestamp = 1783962002.625;
    const correctedCursor = { generation: 'fixture-generation', message_index: 1, end_offset: 480, file_size: 480 };
    const correctedRows = ['first', 'second'].map((suffix, index) => ({
      role: 'assistant',
      content: 'same semantic content may be a distinct native row',
      ts: correctedTimestamp,
      source_message_id: `codex_cli:corrected:${suffix}`,
      source_cursor: { ...correctedCursor, message_index: index },
      source: 'codex_cli_jsonl',
    }));
    const reconcileRequestId = `reconcile-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_chunk_request',
      protocol_version: 1,
      session: sessionId,
      session_id: sessionId,
      request_id: reconcileRequestId,
      source: 'native',
      mode: 'older',
      before_offset: 480,
      limit: 2,
      user_initiated: true,
      reconcile_metadata: true,
    }));
    await waitFor(
      () => pair.proxy.messages.some(message => message.type === 'history_chunk_request'
        && message.request_id === reconcileRequestId && message.reconcile_metadata === true),
      5000,
      'metadata reconciliation native request',
    );
    const observerStart = observer.messages.length;
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      protocol_version: 1,
      session: sessionId,
      session_id: sessionId,
      request_id: reconcileRequestId,
      source: 'codex_cli_jsonl',
      mode: 'older',
      messages: correctedRows,
    }));
    const reconciliation = await waitFor(
      () => pair.browser.messages.find(message => message.type === 'history_chunk'
        && message.request_id === reconcileRequestId),
      5000,
      'metadata reconciliation response',
    );
    assert.deepStrictEqual(reconciliation.metadata_reconciliation, {
      applied: true,
      code: 'metadata_reconciled',
      rows: 2,
    });
    await waitFor(
      () => observer.messages.slice(observerStart).some(message => message.type === 'transcript_resync_required'
        && message.session === sessionId && message.reason === 'authoritative_metadata_reconciliation'),
      5000,
      'observer metadata reconciliation gap',
    );
    assert.strictEqual(
      observer.messages.slice(observerStart).filter(message => message.type === 'history_chunk'
        && message.request_id === reconcileRequestId).length,
      0,
      'request-scoped native history must not fan out to another subscriber',
    );

    await closeSocket(observer.ws);
    observer = null;
    await closeSocket(pair.browser.ws);
    await closeSocket(pair.proxy.ws);
    pair = null;
    await stopChild(relay);

    relay = startRelay();
    pair = await connectPair(relay);
    const historyRequestId = `history-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: sessionId,
      session_id: sessionId,
      request_id: historyRequestId,
      full: true,
    }));
    const replayHistory = await waitFor(
      () => pair.browser.messages.find(message => message.type === 'history' && message.request_id === historyRequestId),
      5000,
      'persisted source cursor history replay',
    );
    assert.strictEqual(replayHistory.messages.length, 2);
    assert.deepStrictEqual(replayHistory.messages.map(message => message.source_message_id), [
      'codex_cli:corrected:first',
      'codex_cli:corrected:second',
    ], 'authoritative history must reconcile stale source identities even when semantic content is unchanged');
    assert(replayHistory.messages.every(message => message.source_cursor?.end_offset === 460),
      'persisted source cursor must hydrate back to an object');
    const replayStart = pair.browser.messages.length;
    pair.proxy.ws.send(JSON.stringify({ ...first, source_message_id: 'codex_cli:corrected:first', message: {
      ...first.message,
      source_message_id: 'codex_cli:corrected:first',
      created_at: '2026-07-13T17:00:02.625Z',
    } }));
    await sleep(250);
    const replayRows = pair.browser.messages.slice(replayStart)
      .filter(message => message.type === 'message' && message.session === sessionId);
    assert.strictEqual(replayRows.length, 0, 'source id replay after relay restart must not fan out again');

    await closeSocket(pair.browser.ws);
    await closeSocket(pair.proxy.ws);
    pair = null;
    await stopChild(relay);

    const db = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
    const rows = db.prepare(`
      SELECT role, content, ts, source_message_id, source_cursor, source
      FROM messages WHERE session = ? ORDER BY id ASC
    `).all(sessionId);
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_source_message'").get();
    db.close();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(new Set(rows.map(row => row.source_message_id)).size, 2);
    assert(rows.every(row => JSON.parse(row.source_cursor).end_offset === 460));
    assert(rows.every(row => row.source === 'codex_cli_jsonl'));
    assert(rows.every(row => row.ts === correctedTimestamp), 'fractional producer created_at must survive metadata reconciliation');
    assert(index?.sql?.includes('UNIQUE INDEX'));

    console.log(JSON.stringify({
      ok: true,
      persisted_rows: rows.length,
      first_run_browser_rows: 2,
      duplicate_same_run_rows: 0,
      duplicate_after_restart_rows: 0,
      identical_content_distinct_source_rows: 2,
      source_cursor_end_offset: 460,
      source_timestamp: rows[0].ts,
      unique_index: 'idx_source_message',
      history_replay_source_cursor_object: true,
      windows_opened: 0,
    }, null, 2));
  } finally {
    if (observer) await closeSocket(observer.ws);
    if (pair) {
      await closeSocket(pair.browser?.ws);
      await closeSocket(pair.proxy?.ws);
    }
    await stopChild(relay);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
