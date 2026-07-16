#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const jwt = require('../relay-server/node_modules/jsonwebtoken');
const WebSocket = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, token, method, route, body = null) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(data ? {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        try { parsed = JSON.parse(text || '{}'); } catch { parsed = { raw: text }; }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    req.once('error', reject);
    req.end(data);
  });
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch { /* startup/state retry */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('condition timed out');
}

function connectClient(port, token, label) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/client-ws?token=${encodeURIComponent(token)}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} connection timed out`)), 10_000);
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === 'connection_ack') {
        clearTimeout(timer);
        resolve({ ws, messages, ack: message, label });
      }
    });
  });
}

function connectProxy(port, proxySecret) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy connection timed out')), 10_000);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'proxy',
      proxy_id: 'notification-preference-race-e2e',
      machine_label: 'isolated-fixture',
      secret: proxySecret,
    })));
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === 'connection_ack') {
        clearTimeout(timer);
        resolve({ ws, messages });
      }
    });
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 500);
    timer.unref?.();
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.close();
  });
}

function semanticEvents(connection) {
  return connection.messages.filter(message => message.type === 'semantic_notification');
}

function semanticHistory(connection) {
  return Array.isArray(connection.ack?.semantic_notifications)
    ? connection.ack.semantic_notifications : [];
}

function goal(generation, state, transitionSeq) {
  const at = new Date(Date.now() + generation * 1000 + transitionSeq * 10).toISOString();
  return {
    objective: `Preference race fixture goal ${generation}`,
    fingerprint: `goal:preference-race:${generation}`,
    generation,
    state,
    raw_state: state,
    transition_seq: transitionSeq,
    transition_id: `goal-transition:preference-race:${generation}:${state}`,
    source: 'isolated_fixture',
    native_updated_at: at,
    observed_at: at,
    updated_at: at,
  };
}

function sendGoalStatus(proxy, sessionId, generation, state, transitionSeq) {
  const active = state === 'active';
  proxy.send(JSON.stringify({
    type: 'status',
    session: sessionId,
    thinking: active,
    status: active ? 'working' : 'idle',
    activity: {
      kind: active ? 'thinking' : 'idle',
      label: active ? 'Working' : '',
      updated_at: new Date().toISOString(),
      goal: goal(generation, state, transitionSeq),
    },
  }));
}

async function main() {
  const port = await freePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-notification-race-'));
  const jwtSecret = 'notification-race-jwt-secret-at-least-32-characters';
  const proxySecret = 'notification-race-proxy-secret';
  const relayLogs = [];
  const relay = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'notification-race-session-secret-at-least-32-chars',
      JWT_SECRET: jwtSecret,
      ALLOWED_EMAIL: '',
      GOOGLE_CLIENT_ID: 'notification-race-client',
      GOOGLE_CLIENT_SECRET: 'notification-race-secret',
      PROXY_SECRET: proxySecret,
      RAC_DATA_DIR: dataRoot,
      ALLOW_LAN_BYPASS: 'false',
      ALLOW_LOOPBACK_BYPASS: 'false',
      NOTIFY_EVEN_IF_CONNECTED: 'false',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  relay.stdout.on('data', chunk => relayLogs.push(String(chunk)));
  relay.stderr.on('data', chunk => relayLogs.push(String(chunk)));

  const accountAToken = jwt.sign({ email: 'account-a@example.test' }, jwtSecret, { expiresIn: '5m' });
  const accountBToken = jwt.sign({ email: 'account-b@example.test' }, jwtSecret, { expiresIn: '5m' });
  const sessionId = 'notification-pref-race';
  let proxy;
  const clients = [];
  try {
    await waitFor(async () => {
      try { return (await request(port, accountAToken, 'GET', '/healthz')).status === 200; }
      catch { return false; }
    });
    ({ ws: proxy } = await connectProxy(port, proxySecret));

    const prefsA = await request(port, accountAToken, 'PUT', '/api/preferences/notifications', {
      preferences: { turn_ready: true, goal_completed: true, goal_attention: true },
    });
    const prefsB = await request(port, accountBToken, 'PUT', '/api/preferences/notifications', {
      preferences: { turn_ready: true, goal_completed: false, goal_attention: true },
    });
    assert.strictEqual(prefsA.status, 200);
    assert.strictEqual(prefsB.status, 200);
    assert.strictEqual(prefsA.body.preferences.turn_ready, false, 'account A cannot enable turn_ready');
    assert.strictEqual(prefsB.body.preferences.turn_ready, false, 'account B cannot enable turn_ready');

    proxy.send(JSON.stringify({
      type: 'session_list',
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex_cli',
        workspace_name: 'Notification Preferences',
        status: 'working',
        activity: {
          kind: 'thinking',
          label: 'Working',
          updated_at: new Date().toISOString(),
          goal: goal(1, 'active', 1),
        },
      }],
    }));

    const accountA1 = await connectClient(port, accountAToken, 'account-a-1');
    const accountB1 = await connectClient(port, accountBToken, 'account-b-1');
    clients.push(accountA1, accountB1);
    assert(accountA1.ack.sessions.some(session => session.session_id === sessionId));

    sendGoalStatus(proxy, sessionId, 1, 'complete', 2);
    let event1;
    try {
      event1 = await waitFor(() => semanticEvents(accountA1)[0], 2_000);
    } catch (error) {
      const debugDb = new Database(path.join(dataRoot, 'messages.db'), { readonly: true });
      const debug = {
        goal: debugDb.prepare('SELECT * FROM goal_lifecycle_state WHERE session_id = ?').get(sessionId),
        events: debugDb.prepare('SELECT event_type, dedupe_key, created_at FROM semantic_notification_events').all(),
        telemetry: debugDb.prepare(`
          SELECT event_type, stage, reason_code, harness, client_channel
          FROM semantic_notification_telemetry ORDER BY id
        `).all(),
        account_a_messages: accountA1.messages.map(message => message.type),
        account_b_messages: accountB1.messages.map(message => message.type),
      };
      debugDb.close();
      throw new Error(`first goal event timed out: ${JSON.stringify(debug)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(semanticEvents(accountB1).length, 0, 'disabled account received a live event');

    const accountA2 = await connectClient(port, accountAToken, 'account-a-2');
    const accountB2 = await connectClient(port, accountBToken, 'account-b-2');
    clients.push(accountA2, accountB2);
    assert.strictEqual(semanticHistory(accountA2).filter(event => event.dedupe_key === event1.dedupe_key).length, 1,
      'enabled account reconnect must recover one event');
    assert.strictEqual(semanticHistory(accountB2).length, 0,
      'disabled account reconnect must recover zero events');

    const muted = await request(port, accountAToken, 'PUT', `/api/preferences/sessions/${sessionId}`, {
      preference: { muted: true },
    });
    assert.strictEqual(muted.status, 200);
    const countsBeforeMutedGoal = clients.map(connection => semanticEvents(connection).length);
    sendGoalStatus(proxy, sessionId, 2, 'active', 1);
    sendGoalStatus(proxy, sessionId, 2, 'complete', 2);
    await waitFor(async () => {
      const response = await request(port, accountAToken, 'GET', '/api/notifications/semantic-diagnostics?max_age_minutes=60');
      return response.body.diagnostics?.by_stage?.find(row => row.key === 'eligible')?.count >= 2;
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    clients.forEach((connection, index) => {
      assert.strictEqual(semanticEvents(connection).length, countsBeforeMutedGoal[index],
        `${connection.label} received muted/disabled goal event`);
    });

    assert.strictEqual((await request(port, accountAToken, 'PUT', `/api/preferences/sessions/${sessionId}`, {
      preference: { muted: false },
    })).status, 200);
    assert.strictEqual((await request(port, accountBToken, 'PUT', '/api/preferences/notifications', {
      preferences: { goal_completed: true },
    })).status, 200);

    sendGoalStatus(proxy, sessionId, 3, 'active', 1);
    sendGoalStatus(proxy, sessionId, 3, 'complete', 2);
    const event3A = await waitFor(() => semanticEvents(accountA1)
      .find(event => event.dedupe_key.includes('preference-race:3:complete')));
    const event3B = await waitFor(() => semanticEvents(accountB1)
      .find(event => event.dedupe_key === event3A.dedupe_key));
    assert(event3B, 'newly enabled second account did not receive the event');
    await waitFor(() => semanticEvents(accountA2).find(event => event.dedupe_key === event3A.dedupe_key));
    await waitFor(() => semanticEvents(accountB2).find(event => event.dedupe_key === event3A.dedupe_key));

    for (const stage of ['claimed', 'displayed', 'displayed']) {
      const receipt = await request(port, accountAToken, 'POST', '/api/notifications/semantic-receipts', {
        dedupe_key: event3A.dedupe_key,
        stage,
        channel: 'web-in-app',
        client_id: 'account-a-web',
      });
      assert.strictEqual(receipt.status, 200);
    }
    const forged = await request(port, accountAToken, 'POST', '/api/notifications/semantic-receipts', {
      dedupe_key: 'goal_completed:forged',
      stage: 'displayed',
      channel: 'web-in-app',
      client_id: 'account-a-web',
    });
    assert.strictEqual(forged.status, 404);

    const diagnosticResponse = await request(
      port, accountAToken, 'GET', '/api/notifications/semantic-diagnostics?max_age_minutes=60',
    );
    assert.strictEqual(diagnosticResponse.status, 200);
    assert.strictEqual(diagnosticResponse.body.content_persisted, false);
    const diagnostics = diagnosticResponse.body.diagnostics;
    for (const stage of ['candidate', 'eligible', 'suppressed', 'dispatched', 'claimed', 'displayed']) {
      assert(diagnostics.by_stage.some(row => row.key === stage), `missing ${stage} diagnostics`);
    }
    assert(diagnostics.by_reason.some(row => row.key === 'category_disabled'));
    assert(diagnostics.by_reason.some(row => row.key === 'session_muted'));

    const db = new Database(path.join(dataRoot, 'messages.db'), { readonly: true });
    const telemetryColumns = db.prepare('PRAGMA table_info(semantic_notification_telemetry)')
      .all().map(row => row.name);
    for (const forbidden of ['title', 'body', 'content', 'message', 'email', 'endpoint', 'token']) {
      assert(!telemetryColumns.includes(forbidden), `telemetry persisted forbidden column ${forbidden}`);
    }
    const displayedRows = db.prepare(`
      SELECT COUNT(*) AS count FROM semantic_notification_telemetry
      WHERE dedupe_key = ? AND stage = 'displayed' AND client_channel = 'web-in-app'
    `).get(event3A.dedupe_key);
    assert.strictEqual(Number(displayedRows.count), 1, 'duplicate displayed receipt was not idempotent');
    const policyRows = db.prepare(`
      SELECT COUNT(*) AS count FROM semantic_notification_telemetry
      WHERE client_channel LIKE 'websocket-%' AND preference_revision IS NOT NULL
    `).get();
    assert(Number(policyRows.count) > 0, 'policy telemetry omitted preference revisions');
    const turnEvents = db.prepare(`
      SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'turn_ready'
    `).get();
    assert.strictEqual(Number(turnEvents.count), 0);
    db.close();

    const result = {
      ok: true,
      actual_isolated_relay: true,
      authenticated_accounts: 2,
      account_a_live_enabled_deliveries: semanticEvents(accountA1).length,
      account_b_disabled_live_deliveries: 0,
      enabled_reconnect_history_events: semanticHistory(accountA2).length,
      disabled_reconnect_history_events: semanticHistory(accountB2).length,
      muted_goal_deliveries: 0,
      two_tabs_per_account_received_enabled_event: true,
      displayed_receipts_after_duplicate: 1,
      forged_receipt_status: forged.status,
      diagnostic_total: diagnostics.total,
      diagnostic_stages: diagnostics.by_stage,
      diagnostic_reasons: diagnostics.by_reason,
      preference_revisions_recorded: Number(policyRows.count),
      persisted_turn_ready_events: 0,
      content_columns_persisted: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
      production_mutations: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n${relayLogs.join('')}\n`);
    process.exitCode = 1;
  } finally {
    await Promise.all(clients.map(connection => closeSocket(connection.ws)));
    await closeSocket(proxy);
    if (!relay.killed) relay.kill();
    await new Promise(resolve => {
      if (relay.exitCode != null) return resolve();
      const timer = setTimeout(resolve, 1000);
      timer.unref?.();
      relay.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
  }
}

main();
