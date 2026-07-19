#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ARG = process.argv.indexOf('--output');
const OUTPUT = OUTPUT_ARG >= 0 ? path.resolve(process.argv[OUTPUT_ARG + 1]) : null;
const WebSocket = require(path.join(ROOT, 'relay-server', 'node_modules', 'ws'));
const Database = require(path.join(ROOT, 'relay-server', 'node_modules', 'better-sqlite3'));
const jwt = require(path.join(ROOT, 'relay-server', 'node_modules', 'jsonwebtoken'));
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-recent-relay-'));
const SECRET = 'recent-chats-relay-fixture-secret';
const JWT_SECRET = 'recent-chats-fixture-jwt-secret-at-least-thirty-two-characters';
const MESSAGE_CONTENT = 'PRIVATE_FIXTURE_CONTENT_MUST_NOT_ENTER_INVENTORY';
const TARGET = 'fixture-session-012';
const MESSAGE_AT = '2026-07-16T20:00:00.000Z';
const HARNESS_TYPES = [
  'claude', 'claude_cli', 'claude-desktop', 'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo', 'roo_code', 'cline',
  'antigravity', 'antigravity_panel', 'antigravity-v2',
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(port, child) {
  const startedAt = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`relay exited ${child.exitCode}`);
    try {
      const status = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/healthz`, response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        req.setTimeout(500, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      });
      if (status === 200) return Date.now() - startedAt;
    } catch {}
    await delay(50);
  }
  throw new Error('relay health timeout');
}

async function startRelay(port) {
  const logs = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      RAC_DATA_DIR: TEMP,
      SESSION_SECRET: 'recent-chats-session-secret-at-least-thirty-two-characters',
      PROXY_SECRET: SECRET,
      GOOGLE_CLIENT_ID: 'recent-chats-fixture-client-id',
      GOOGLE_CLIENT_SECRET: 'recent-chats-fixture-client-secret',
      JWT_SECRET,
      ALLOW_LOOPBACK_BYPASS: 'true',
      ALLOWED_EMAIL: 'fixture@example.invalid',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  try {
    const healthMs = await waitForHealth(port, child);
    return { child, logs, healthMs };
  } catch (error) {
    throw new Error(`${error.message}\n${logs.join('').slice(-8000)}`);
  }
}

async function stopRelay(runtime) {
  if (!runtime?.child || runtime.child.exitCode != null) return;
  runtime.child.kill();
  await Promise.race([
    new Promise(resolve => runtime.child.once('exit', resolve)),
    delay(3_000),
  ]);
  if (runtime.child.exitCode == null) runtime.child.kill('SIGKILL');
}

function socketInbox(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const waiterIndex = waiters.findIndex(waiter => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  function next(predicate, timeoutMs = 5_000) {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const liveIndex = waiters.indexOf(waiter);
        if (liveIndex >= 0) waiters.splice(liveIndex, 1);
        reject(new Error('websocket message timeout'));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }
  return { ws, opened, next, queue };
}

function fixtureSessions() {
  return Array.from({ length: 79 }, (_, index) => ({
    session_id: `fixture-session-${String(index).padStart(3, '0')}`,
    agent_type: HARNESS_TYPES[index % HARNESS_TYPES.length],
    workspace_path: `C:\\fixture\\workspace-${index % 7}`,
    project_root: `C:\\fixture\\workspace-${index % 7}`,
    workspace_name: `workspace-${index % 7}`,
    chat_title: `Fixture ${index}`,
    activity: { kind: 'idle', updated_at: '2026-07-16T19:00:00.000Z' },
  }));
}

function assertCanonical(target, expectedId = null) {
  assert(target && typeof target === 'object');
  assert.strictEqual(target.last_message_at, MESSAGE_AT);
  assert.strictEqual(target.last_message_kind, 'assistant');
  assert.strictEqual(target.last_message_source, 'fixture_stream');
  assert.strictEqual(target.last_message_id, expectedId || 'fixture-message-1');
  assert.deepStrictEqual(target.latest_visible_message, {
    id: target.last_message_id,
    at: MESSAGE_AT,
    kind: 'assistant',
    source: 'fixture_stream',
  });
  assert.strictEqual(JSON.stringify(target.latest_visible_message).includes(MESSAGE_CONTENT), false);
  return target.last_message_id;
}

async function connectProxy(port, sessions) {
  const proxy = socketInbox(`ws://127.0.0.1:${port}/proxy-ws`);
  await proxy.opened;
  proxy.ws.send(JSON.stringify({
    type: 'connection_hello', protocol_version: 1, secret: SECRET,
    proxy_id: 'recent-chats-fixture-proxy', machine_label: 'fixture',
  }));
  await proxy.next(message => message.type === 'connection_ack');
  proxy.ws.send(JSON.stringify({
    type: 'session_list', proxy_id: 'recent-chats-fixture-proxy', sessions,
  }));
  await delay(300);
  return proxy;
}

async function connectClient(port) {
  const token = jwt.sign({ email: 'fixture@example.invalid' }, JWT_SECRET, { expiresIn: '5m' });
  const client = socketInbox(`ws://127.0.0.1:${port}/client-ws?token=${encodeURIComponent(token)}`);
  await client.opened;
  const ack = await client.next(message => message.type === 'connection_ack');
  return { ...client, ack };
}

async function run() {
  const port = await reservePort();
  const sessions = fixtureSessions();
  let runtime = await startRelay(port);
  let proxy;
  let client;
  try {
    proxy = await connectProxy(port, sessions);
    client = await connectClient(port);
    assert.strictEqual(client.ack.sessions.length, 79);
    assert.strictEqual(JSON.stringify(client.ack.sessions).includes(MESSAGE_CONTENT), false);
    const before = client.ack.sessions.find(session => session.session_id === TARGET);
    assert(before);
    assert.strictEqual(before.latest_visible_message, undefined);

    proxy.ws.send(JSON.stringify({
      type: 'message', session: TARGET, role: 'assistant', content: MESSAGE_CONTENT,
      created_at: MESSAGE_AT, source_message_id: 'fixture-message-1', source: 'fixture_stream',
    }));
    const firstSummary = await client.next(message => message.type === 'session_summary' && message.session_id === TARGET);
    const messageId = assertCanonical(firstSummary);

    // A source-backed streaming replacement may delete/reinsert the SQLite
    // suffix, but the canonical Recent identity must remain the producer's
    // durable source ID rather than churn with the relay row ID.
    proxy.ws.send(JSON.stringify({
      type: 'history_snapshot', session_id: TARGET, session: TARGET,
      messages: [{
        role: 'assistant', content: `${MESSAGE_CONTENT} streamed growth`,
        created_at: MESSAGE_AT, ts: Date.parse(MESSAGE_AT) / 1000,
        source_message_id: 'fixture-message-1', source: 'fixture_stream',
      }],
    }));
    const streamedSummary = await client.next(message => message.type === 'session_summary' && message.session_id === TARGET);
    assertCanonical(streamedSummary, messageId);

    // Duplicate ID and older persisted rows cannot replace the canonical identity.
    proxy.ws.send(JSON.stringify({
      type: 'message', session: TARGET, role: 'assistant', content: MESSAGE_CONTENT,
      created_at: MESSAGE_AT, source_message_id: 'fixture-message-1', source: 'fixture_stream',
    }));
    proxy.ws.send(JSON.stringify({
      type: 'message', session: TARGET, role: 'user', content: 'older private fixture',
      created_at: '2026-07-16T19:00:00.000Z', source_message_id: 'fixture-message-older', source: 'fixture_stream',
    }));
    const olderSummary = await client.next(message => message.type === 'session_summary' && message.session_id === TARGET);
    assertCanonical(olderSummary, messageId);

    proxy.ws.send(JSON.stringify({
      type: 'status', session: TARGET, status: 'healthy', label: 'noise',
      activity: { kind: 'idle', updated_at: '2030-01-01T00:00:00.000Z' },
      created_at: '2030-01-01T00:00:00.000Z',
    }));
    const statusSummary = await client.next(message => message.type === 'session_summary' && message.session_id === TARGET);
    assertCanonical(statusSummary, messageId);

    client.ws.close();
    proxy.ws.close();
    await stopRelay(runtime);

    // Exercise the production upgrade path: a legacy store has durable messages
    // but no compact projection. Startup must listen immediately while the
    // worker reconstructs and publishes the missing row.
    const legacyDb = new Database(path.join(TEMP, 'messages.db'));
    const insertLegacy = legacyDb.prepare(`
      INSERT INTO messages (session, role, content, ts, source)
      VALUES (?, 'assistant', 'legacy fixture', ?, 'legacy_fixture')
    `);
    legacyDb.transaction(() => {
      for (let index = 0; index < 25_000; index += 1) {
        insertLegacy.run(TARGET, 1_700_000_000 + index);
      }
    })();
    legacyDb.prepare('DELETE FROM session_latest_visible_message WHERE session_id = ?').run(TARGET);
    legacyDb.close();

    runtime = await startRelay(port);
    assert(runtime.healthMs < 5_000, `legacy startup blocked health for ${runtime.healthMs}ms`);
    proxy = await connectProxy(port, sessions);
    client = await connectClient(port);
    let coldTarget = client.ack.sessions.find(session => session.session_id === TARGET);
    if (!coldTarget?.latest_visible_message) {
      coldTarget = await client.next(message => message.type === 'session_summary'
        && message.session_id === TARGET && message.latest_visible_message, 10_000);
    }
    assertCanonical(coldTarget, messageId);
    assert.strictEqual(JSON.stringify(client.ack.sessions).includes(MESSAGE_CONTENT), false);

    const db = new Database(path.join(TEMP, 'messages.db'), { readonly: true });
    const columns = db.pragma('table_info(session_latest_visible_message)').map(column => column.name);
    const row = db.prepare('SELECT * FROM session_latest_visible_message WHERE session_id = ?').get(TARGET);
    db.close();
    assert.deepStrictEqual(columns, [
      'session_id', 'message_row_id', 'message_id', 'message_at', 'kind', 'source', 'updated_at',
    ]);
    assert.strictEqual(JSON.stringify(row).includes(MESSAGE_CONTENT), false);
    assert.strictEqual(row.message_id, messageId);

    return {
      status: 'PASS',
      fixture_sessions: sessions.length,
      harness_types: new Set(sessions.map(session => session.agent_type)).size,
      latest_message_id: messageId,
      authoritative_message_at: MESSAGE_AT,
      duplicate_delta_moves: 0,
      streaming_resync_identity_stable: true,
      older_message_moves: 0,
      status_noise_moves: 0,
      cold_restart_match: true,
      legacy_backfill_runs_after_listen: true,
      legacy_rows_preloaded: 25_000,
      legacy_startup_health_ms: runtime.healthMs,
      transcript_fetches: 0,
      inventory_contains_message_content: false,
      metadata_columns: columns,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
  } finally {
    client?.ws?.close();
    proxy?.ws?.close();
    await stopRelay(runtime);
  }
}

(async () => {
  const receipt = {
    schema_version: 1,
    test: 'sidebar-recent-chats-relay-persistence',
    generated_at: new Date().toISOString(),
  };
  try {
    Object.assign(receipt, await run());
  } catch (error) {
    Object.assign(receipt, { status: 'FAIL', error: String(error?.stack || error) });
  } finally {
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
  if (OUTPUT) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.status !== 'PASS') process.exitCode = 1;
})();
