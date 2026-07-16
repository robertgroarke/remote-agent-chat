#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { execFileSync, spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex >= 0 && process.argv[labelIndex + 1]
  ? String(process.argv[labelIndex + 1])
  : 'benchmark';
const MESSAGE_COUNT = Math.max(100, Number(process.env.RAC_BENCH_MESSAGE_COUNT || 1200));
const BROWSER_COUNT = Math.max(1, Number(process.env.RAC_BENCH_BROWSER_COUNT || 8));
const SESSION_COUNT = Math.max(4, Number(process.env.RAC_BENCH_SESSION_COUNT || 60));
const ACTIVE_SESSION_COUNT = Math.max(1, Math.min(
  SESSION_COUNT,
  Number(process.env.RAC_BENCH_ACTIVE_SESSION_COUNT || 4),
));
const BURST_SIZE = Math.max(1, Number(process.env.RAC_BENCH_BURST_SIZE || 12));
const BURST_PAUSE_MS = Math.max(0, Number(process.env.RAC_BENCH_BURST_PAUSE_MS || 2));
const PAYLOAD_BYTES = Math.max(128, Number(process.env.RAC_BENCH_PAYLOAD_BYTES || 2048));
const port = 36500 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sqlite-forward-bench-'));
const relayLogs = [];
let relaySqliteConfig = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function round(value) {
  return Number(Number(value).toFixed(3));
}

function boundedLog(chunk) {
  const text = String(chunk);
  const configMatch = text.match(/SQLite configured (\{[^\r\n]+\})/);
  if (configMatch) {
    try { relaySqliteConfig = JSON.parse(configMatch[1]); } catch {}
  }
  relayLogs.push(text);
  while (relayLogs.join('').length > 32_000) relayLogs.shift();
}

async function waitForRelay(child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`relay exited ${child.exitCode}: ${relayLogs.join('').slice(-4000)}`);
    }
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await sleep(40);
  }
  throw new Error(`relay health timeout: ${relayLogs.join('').slice(-4000)}`);
}

function openSocket(route, peerRole, clientName) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${peerRole} WebSocket timeout`)), 8000);
    socket.on('message', data => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
    });
    socket.once('open', () => {
      socket.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: peerRole,
        ...(peerRole === 'proxy'
          ? { proxy_id: clientName, machine_label: 'sqlite-forward-benchmark' }
          : { client_name: clientName }),
      }));
    });
    const poll = setInterval(() => {
      if (!messages.some(message => message.type === 'connection_ack')) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ socket, messages });
    }, 10);
    socket.once('error', error => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(error);
    });
  });
}

async function waitFor(predicate, timeoutMs, labelText) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out: ${labelText}`);
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.close();
  await Promise.race([closed, sleep(1000)]);
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'sqlite-forward-benchmark-session-secret-0123456789',
      JWT_SECRET: 'sqlite-forward-benchmark-jwt-secret-01234567890123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'sqlite-forward-benchmark-client',
      GOOGLE_CLIENT_SECRET: 'sqlite-forward-benchmark-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', boundedLog);
  relay.stderr.on('data', boundedLog);
  const clients = [];
  let proxy = null;
  try {
    await waitForRelay(relay);
    proxy = await openSocket('/proxy-ws', 'proxy', 'sqlite-forward-benchmark-proxy');
    for (let index = 0; index < BROWSER_COUNT; index++) {
      clients.push(await openSocket('/client-ws', 'browser', `sqlite-forward-browser-${index}`));
    }

    const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
      session_id: `sqlite-forward-session-${index}`,
      agent_type: 'codex_cli',
      display_name: `SQLite forward session ${index}`,
      workspace_path: root,
      project_root: root,
      status: 'healthy',
      activity: { kind: 'idle', label: '' },
    }));
    proxy.socket.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: 'sqlite-forward-benchmark-proxy',
      sessions,
    }));
    await waitFor(
      () => clients[0].messages.some(message => Array.isArray(message.sessions)
        && message.sessions.length === SESSION_COUNT),
      5000,
      'browser session snapshot',
    );
    const snapshotRaceSession = sessions[sessions.length - 1].session_id;
    const activeSessionIds = [
      ...sessions.slice(0, ACTIVE_SESSION_COUNT).map(session => session.session_id),
      snapshotRaceSession,
    ];
    for (let index = 0; index < clients.length; index++) {
      const requestId = `sqlite-forward-subscribe-${index}`;
      clients[index].socket.send(JSON.stringify({
        type: 'subscribe',
        request_id: requestId,
        sessions: activeSessionIds,
      }));
      await waitFor(
        () => clients[index].messages.some(message => (
          message.type === 'subscription_ack' && message.request_id === requestId
        )),
        5000,
        `browser ${index} subscription`,
      );
    }

    for (let index = 0; index < 40; index++) {
      proxy.socket.send(JSON.stringify({
        type: 'proxy_message',
        session_id: sessions[index % ACTIVE_SESSION_COUNT].session_id,
        role: 'assistant',
        content: `warmup-${index}-${'w'.repeat(128)}`,
      }));
    }
    await waitFor(
      () => clients[0].messages.filter(message => message.type === 'message'
        && String(message.content || '').startsWith('warmup-')).length >= 40,
      10_000,
      'warmup forwards',
    );
    const duplicateContent = `pending-dedup-${Date.now()}`;
    proxy.socket.send(JSON.stringify({
      type: 'proxy_message',
      session_id: sessions[0].session_id,
      role: 'assistant',
      content: duplicateContent,
    }));
    proxy.socket.send(JSON.stringify({
      type: 'proxy_message',
      session_id: sessions[0].session_id,
      role: 'assistant',
      content: duplicateContent,
    }));
    await waitFor(
      () => clients[0].messages.filter(message => message.type === 'message'
        && message.content === duplicateContent).length === 1,
      5000,
      'one forwarded pending duplicate',
    );
    await sleep(100);
    assert.equal(
      clients[0].messages.filter(message => message.type === 'message'
        && message.content === duplicateContent).length,
      1,
      'same-burst proxy duplicate must be stored and forwarded once',
    );
    const snapshotRaceContent = `snapshot-race-${Date.now()}`;
    proxy.socket.send(JSON.stringify({
      type: 'proxy_message',
      session_id: snapshotRaceSession,
      role: 'assistant',
      content: snapshotRaceContent,
    }));
    proxy.socket.send(JSON.stringify({
      type: 'history_snapshot',
      session_id: snapshotRaceSession,
      messages: [{ role: 'assistant', content: snapshotRaceContent }],
    }));
    await waitFor(
      () => clients[0].messages.filter(message => message.type === 'message'
        && message.content === snapshotRaceContent).length === 1,
      5000,
      'same-turn message before snapshot',
    );
    await sleep(100);
    assert.equal(
      clients[0].messages.filter(message => message.type === 'message'
        && message.content === snapshotRaceContent).length,
      1,
      'same-turn authoritative snapshot must not duplicate the queued live row',
    );

    const prefix = `SQLITE_FORWARD_${Date.now()}_`;
    const padding = 'x'.repeat(Math.max(0, PAYLOAD_BYTES - prefix.length - 32));
    const sentAt = new Map();
    const latencies = [];
    let primaryBytes = 0;
    clients[0].socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type !== 'message' || !String(message.content || '').startsWith(prefix)) return;
      const token = String(message.content).slice(0, String(message.content).indexOf('|'));
      const started = sentAt.get(token);
      if (started == null) return;
      sentAt.delete(token);
      latencies.push(performance.now() - started);
      primaryBytes += Buffer.byteLength(data);
    });

    const startedAt = performance.now();
    for (let index = 0; index < MESSAGE_COUNT; index++) {
      const token = `${prefix}${index}`;
      const content = `${token}|${padding}`;
      sentAt.set(token, performance.now());
      proxy.socket.send(JSON.stringify({
        type: 'proxy_message',
        session_id: sessions[index % ACTIVE_SESSION_COUNT].session_id,
        role: 'assistant',
        content,
      }));
      if ((index + 1) % BURST_SIZE === 0 && index + 1 < MESSAGE_COUNT) {
        await sleep(BURST_PAUSE_MS);
      }
    }
    await waitFor(() => latencies.length === MESSAGE_COUNT, 90_000, 'all measured forwards');
    const completedAt = performance.now();
    const sorted = [...latencies].sort((a, b) => a - b);

    const dbPath = path.join(dataDir, 'messages.db');
    const inspectDb = new Database(dbPath, { readonly: true });
    const journalMode = inspectDb.pragma('journal_mode', { simple: true });
    const storedMessages = inspectDb.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    inspectDb.close();
    assert.equal(storedMessages, MESSAGE_COUNT + 42);
    const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'));

    const result = {
      ok: true,
      label,
      generated_at: new Date().toISOString(),
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root, encoding: 'utf8', windowsHide: true,
      }).trim(),
      relay_source_sha256: crypto.createHash('sha256').update(relaySource).digest('hex'),
      relay_source_dirty: !!execFileSync(
        'git',
        ['status', '--short', '--', 'relay-server/index.js'],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      ).trim(),
      journal_mode: journalMode,
      relay_sqlite_config: relaySqliteConfig,
      workload: {
        messages: MESSAGE_COUNT,
        warmup_messages: 40,
        duplicate_probe_frames: 2,
        same_turn_snapshot_probe_frames: 2,
        browsers: BROWSER_COUNT,
        sessions: SESSION_COUNT,
        active_sessions: ACTIVE_SESSION_COUNT,
        payload_bytes: PAYLOAD_BYTES,
        burst_size: BURST_SIZE,
        burst_pause_ms: BURST_PAUSE_MS,
      },
      relay_forward_ms: {
        min: round(sorted[0]),
        p50: round(percentile(sorted, 0.50)),
        p95: round(percentile(sorted, 0.95)),
        p99: round(percentile(sorted, 0.99)),
        max: round(sorted[sorted.length - 1]),
      },
      duration_ms: round(completedAt - startedAt),
      throughput_messages_per_second: round(MESSAGE_COUNT * 1000 / (completedAt - startedAt)),
      primary_browser_bytes: primaryBytes,
      total_fanout_bytes_estimate: primaryBytes * BROWSER_COUNT,
      stored_messages: storedMessages,
      pending_duplicate_stored_once: true,
      same_turn_snapshot_no_duplicate: true,
      sends: MESSAGE_COUNT + 44,
      controls: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all(clients.map(client => closeSocket(client.socket).catch(() => {})));
    await closeSocket(proxy?.socket).catch(() => {});
    await stopChild(relay);
    const tempRoot = path.resolve(os.tmpdir()).toLowerCase();
    const resolvedDataDir = path.resolve(dataDir);
    assert(resolvedDataDir.toLowerCase().startsWith(tempRoot + path.sep));
    assert(path.basename(resolvedDataDir).startsWith('rac-sqlite-forward-bench-'));
    fs.rmSync(resolvedDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
