#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const Database = require('../relay-server/node_modules/better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-claude-timestamp-reconcile-'));
const PORT = 38200 + Math.floor(Math.random() * 400);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION_ID = 'claude-observed-timestamp-reconciliation';
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
  const child = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      PUBLIC_URL: ORIGIN,
      SESSION_SECRET: 'claude-timestamp-session-secret-0123456789',
      JWT_SECRET: 'claude-timestamp-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: DATA_DIR,
      GOOGLE_CLIENT_ID: 'claude-timestamp-client',
      GOOGLE_CLIENT_SECRET: 'claude-timestamp-secret',
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
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${route}`, { origin: ORIGIN });
    const messages = [];
    const timeout = setTimeout(() => reject(new Error(`${peerRole} connection timeout`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'claude-timestamp-e2e' }
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

function historySnapshot(messages) {
  return {
    type: 'history_snapshot',
    protocol_version: 1,
    session: SESSION_ID,
    session_id: SESSION_ID,
    messages,
    history: messages,
  };
}

function persistedRows() {
  const databasePath = path.join(DATA_DIR, 'messages.db');
  if (!fs.existsSync(databasePath)) return [];
  try {
    const db = new Database(databasePath, { readonly: true });
    const rows = db.prepare(
      'SELECT ts, source, source_message_id FROM messages WHERE session = ? ORDER BY id ASC',
    ).all(SESSION_ID);
    db.close();
    return rows;
  } catch {
    return [];
  }
}

async function main() {
  const relay = startRelay();
  let proxy = null;
  let browser = null;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-5000));
      try { return (await fetch(`${ORIGIN}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', `claude-timestamp-proxy-${Date.now()}`);
    browser = await openSocket('/client-ws', 'browser', `claude-timestamp-browser-${Date.now()}`);
    browser.ws.send(JSON.stringify({
      type: 'subscribe',
      request_id: `subscribe-${Date.now()}`,
      sessions: [SESSION_ID],
    }));
    await waitFor(() => browser.messages.some(message => message.type === 'subscription_ack'),
      5000, 'browser subscription');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      protocol_version: 1,
      proxy_id: 'claude-timestamp-proxy',
      sessions: [{ session_id: SESSION_ID, agent_type: 'claude', status: 'healthy' }],
    }));

    const semanticRows = [
      { role: 'user', content: 'legacy Claude row without a native timestamp', ts: 0 },
      {
        role: 'assistant',
        content: 'legacy Claude answer without a native timestamp',
        content_blocks: [{ type: 'markdown', content: 'stable block' }],
        ts: 0,
      },
    ];
    proxy.ws.send(JSON.stringify(historySnapshot(semanticRows)));
    await waitFor(() => persistedRows().length === 2, 5000,
      'legacy timestamp-zero snapshot persistence');

    const observedAt = '2026-07-21T18:22:21.436Z';
    const timestamp = Date.parse(observedAt) / 1000;
    const correctedRows = semanticRows.map((row, index) => ({
      ...row,
      ts: timestamp,
      timestamp: observedAt,
      created_at: observedAt,
      source: 'claude_extension_observed',
      source_message_id: `claude_extension_observed:${SESSION_ID}:${index + 1}:fixture`,
    }));
    proxy.ws.send(JSON.stringify(historySnapshot(correctedRows)));
    await waitFor(() => {
      const rows = persistedRows();
      return rows.length === correctedRows.length
        && rows.every(row => row.ts === timestamp)
        && rows.every(row => row.source === 'claude_extension_observed');
    }, 5000, 'automatic timestamp-bearing authoritative resync');

    const requestId = `history-${Date.now()}`;
    browser.ws.send(JSON.stringify({
      type: 'history_request',
      protocol_version: 1,
      session: SESSION_ID,
      session_id: SESSION_ID,
      request_id: requestId,
      full: true,
    }));
    const history = await waitFor(() => browser.messages.find(message => (
      message.type === 'history' && message.request_id === requestId
    )), 5000, 'reconciled history response');
    assert.equal(history.messages.length, 2);
    assert(history.messages.every(message => message.ts === timestamp));
    assert(history.messages.every(message => message.source === 'claude_extension_observed'));
    assert(history.messages.every(message => message.source_message_id?.startsWith('claude_extension_observed:')));

    const beforeReplay = persistedRows();
    proxy.ws.send(JSON.stringify(historySnapshot(correctedRows)));
    await sleep(250);
    assert.deepStrictEqual(persistedRows(), beforeReplay,
      'identical corrected snapshot changed durable metadata');

    const rows = persistedRows();
    assert.equal(rows.length, 2);
    assert(rows.every(row => row.ts === timestamp));
    assert(rows.every(row => row.source === 'claude_extension_observed'));
    assert.equal(new Set(rows.map(row => row.source_message_id)).size, rows.length);

    const result = {
      ok: true,
      reconciled_rows: rows.length,
      timestamp,
      source: 'claude_extension_observed',
      stable_source_ids: rows.length,
      idempotent_replays: 1,
      visible_windows_opened: 0,
      focus_actions: 0,
      production_mutations: 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await closeSocket(browser?.ws).catch(() => {});
    await closeSocket(proxy?.ws).catch(() => {});
    await stopChild(relay);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude observed timestamp reconciliation E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
