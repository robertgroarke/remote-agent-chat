#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const port = 37500 + Math.floor(Math.random() * 250);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-usage-resume-'));
const sessionId = 'usage-resume-e2e';

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function openSocket(pathname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace(/^http/, 'ws') + pathname);
    const messages = [];
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${pathname}`)), 10_000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function startRelay() {
  const logs = [];
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: path.join(root, 'relay-server'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'usage-resume-session-secret-0123456789',
      JWT_SECRET: 'usage-resume-jwt-secret-01234567890123456789',
      PROXY_SECRET: '',
      ALLOW_LOOPBACK_BYPASS: 'true',
      ALLOW_LAN_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'usage-resume-client',
      GOOGLE_CLIENT_SECRET: 'usage-resume-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
      USAGE_RESUME_TICK_MS: '50',
      USAGE_RESUME_MAX_ATTEMPTS: '3',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  await waitFor(() => {
    if (child.exitCode != null) throw new Error(logs.join('').slice(-5000));
    return logs.some(line => line.includes('[relay] Listening'));
  }, 15_000, 'relay start');
  return { child, logs };
}

async function stopRelay(relay, sockets = []) {
  sockets.forEach(socket => {
    try { socket?.ws.close(); } catch {}
  });
  if (relay.child.exitCode == null) {
    const exited = new Promise(resolve => relay.child.once('exit', resolve));
    relay.child.kill();
    await exited;
  }
}

async function connectPair(resetAt) {
  const proxy = await openSocket('/proxy-ws');
  const browser = await openSocket('/client-ws');
  proxy.ws.send(JSON.stringify({
    type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
    proxy_id: 'usage-resume-e2e-proxy', machine_label: 'usage-resume-e2e',
  }));
  proxy.ws.send(JSON.stringify({
    type: 'proxy_session_snapshot', protocol_version: 1,
    proxy_id: 'usage-resume-e2e-proxy',
    sessions: [{
      session_id: sessionId,
      agent_type: 'codex_cli',
      display_name: 'Usage resume E2E',
      status: 'healthy',
      rate_limit_active: true,
      rate_limited_until: resetAt,
      percent_used: 100,
      activity: {
        kind: 'idle',
        goal: {
          objective: 'Finish the persisted usage-resume E2E',
          state: 'paused',
          status: 'paused',
          created_at: '2026-07-12T20:00:00.000Z',
        },
      },
    }],
  }));
  await waitFor(() => browser.messages.find(message => (
    message.type === 'session_list'
    && message.sessions?.some(session => session.session_id === sessionId)
  )), 10_000, 'session snapshot');
  return { proxy, browser };
}

function readJobs() {
  const db = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
  try {
    return db.prepare('SELECT * FROM usage_resume_jobs ORDER BY session_id').all();
  } finally {
    db.close();
  }
}

async function main() {
  let relay = null;
  let pair = null;
  try {
    const resetAt = new Date(Date.now() + 1600).toISOString();

    relay = await startRelay();
    pair = await connectPair(resetAt);
    const scheduled = await waitFor(() => pair.browser.messages.find(message => (
      message.type === 'usage_resume_scheduled' && message.session_id === sessionId
    )), 10_000, 'usage resume schedule');
    assert.equal(scheduled.reset_at, resetAt);
    await stopRelay(relay, [pair.proxy, pair.browser]);
    relay = null;
    pair = null;

    const beforeRestart = readJobs();
    assert.equal(beforeRestart.length, 1);
    assert.equal(beforeRestart[0].state, 'pending');

    relay = await startRelay();
    pair = await connectPair(resetAt);
    const sent = await waitFor(() => pair.proxy.messages.find(message => (
      message.type === 'send' && message.usage_auto_resume === true
    )), 10_000, 'auto-resume send after relay restart');
    assert.equal(sent.session, sessionId);
    assert.equal(sent.content, 'continue');
    assert.match(sent.client_message_id, /^usage-resume-[a-f0-9]{24}$/);
    assert.equal(pair.proxy.messages.filter(message => message.usage_auto_resume === true).length, 1);

    pair.proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result', protocol_version: 1,
      session_id: sessionId, client_message_id: sent.client_message_id,
      result: 'delivered', delivered_at: new Date().toISOString(),
    }));
    const started = await waitFor(() => pair.browser.messages.find(message => (
      message.type === 'usage_resume_started'
      && message.client_message_id === sent.client_message_id
    )), 10_000, 'usage resume started');
    assert.equal(started.goal_objective, 'Finish the persisted usage-resume E2E');
    await stopRelay(relay, [pair.proxy, pair.browser]);
    relay = null;
    pair = null;

    const completedJobs = readJobs();
    assert.equal(completedJobs[0].state, 'completed');
    assert.equal(completedJobs[0].client_msg_id, sent.client_message_id);

    relay = await startRelay();
    pair = await connectPair(resetAt);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(pair.proxy.messages.filter(message => message.usage_auto_resume === true).length, 0,
      'completed persisted job must not dispatch again after another relay restart');
    await stopRelay(relay, [pair.proxy, pair.browser]);
    relay = null;
    pair = null;

    const result = {
      ok: true,
      persisted_before_reset_restart: true,
      deterministic_continue_dispatches: 1,
      proxy_delivery_settled: true,
      completed_job_persisted: true,
      duplicate_dispatches_after_second_restart: 0,
      client_message_id: sent.client_message_id,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    if (relay) await stopRelay(relay, pair ? [pair.proxy, pair.browser] : []);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`usage resume relay e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
