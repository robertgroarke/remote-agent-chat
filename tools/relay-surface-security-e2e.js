#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('../relay-server/node_modules/jsonwebtoken');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const port = 36100 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-security-e2e-'));
const jwtSecret = 'relay-security-e2e-jwt-secret-01234567890123456789';

function token(email) {
  return jwt.sign({ email }, jwtSecret, { expiresIn: '5m' });
}

async function request(route, bearer, options = {}) {
  const response = await fetch(`${origin}${route}`, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) };
}

async function waitForRelay(child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`relay exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.status === 200) return;
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('relay did not become healthy');
}

function openClient(bearer) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/client-ws?token=${encodeURIComponent(bearer)}`, {
      origin,
    });
    const messages = [];
    const timeout = setTimeout(() => reject(new Error('WebSocket client did not open')), 5000);
    socket.on('message', data => messages.push(JSON.parse(data.toString())));
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve({ socket, messages });
    });
    socket.once('error', reject);
  });
}

async function waitMessage(client, predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const match = client.messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('expected WebSocket validation response was not received');
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
      SESSION_SECRET: 'relay-security-e2e-session-secret-0123456789',
      JWT_SECRET: jwtSecret,
      ALLOWED_EMAIL: '',
      ALLOW_LAN_BYPASS: 'false',
      ALLOW_LOOPBACK_BYPASS: 'false',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'relay-security-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'relay-security-e2e-client-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  let client;
  try {
    await waitForRelay(relay);
    const ownerA = token('owner-a@example.test');
    const ownerB = token('owner-b@example.test');

    assert.equal((await request('/api/sessions/history', '')).status, 401);
    assert.equal((await request('/api/preferences/sessions', '')).status, 401);
    assert.equal((await request('/api/push/web-config', '')).status, 401);

    const preferenceRoute = '/api/preferences/sessions/security-session';
    assert.equal((await request(preferenceRoute, ownerA, {
      method: 'PUT', body: JSON.stringify({ display_name: 'Owner A only', muted: true }),
    })).status, 200);
    const preferencesA = await request('/api/preferences/sessions', ownerA);
    const preferencesB = await request('/api/preferences/sessions', ownerB);
    assert.equal(preferencesA.body.preferences['security-session'].display_name, 'Owner A only');
    assert.equal(preferencesB.body.preferences['security-session'], undefined, 'session preferences must be email-scoped');

    const endpoint = `https://push.example.test/security-e2e-${Date.now()}`;
    const subscription = { endpoint, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
    assert.equal((await request('/api/push/web-subscription', ownerA, {
      method: 'POST', body: JSON.stringify({ subscription }),
    })).status, 200);
    assert.equal((await request('/api/push/web-subscription', ownerB, {
      method: 'DELETE', body: JSON.stringify({ endpoint }),
    })).status, 200);
    assert.equal((await request('/api/push/web-subscription', ownerB, {
      method: 'POST', body: JSON.stringify({ subscription }),
    })).status, 409, 'another authenticated principal must not claim an existing endpoint');

    const malformed = await request('/api/push/web-subscription', ownerB, {
      method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example.test', keys: { p256dh: 'short', auth: 'short' } }),
    });
    assert.equal(malformed.status, 400);
    let throttled;
    for (let index = 0; index < 20; index += 1) {
      throttled = await request('/api/push/web-subscription', ownerB, {
        method: 'POST', body: JSON.stringify({ endpoint: `https://push.example.test/invalid-${index}`, keys: { p256dh: 'short', auth: 'short' } }),
      });
    }
    assert.equal(throttled.status, 429, 'push mutations must be rate limited per authenticated principal');
    assert(throttled.headers.get('retry-after'));

    assert.equal((await request('/api/sessions/%00/messages?limit=10', ownerA)).status, 400);
    assert.equal((await request('/api/sessions/security-session/messages?limit=-1', ownerA)).status, 400);
    assert.equal((await request('/api/sessions/security-session/messages?limit=not-a-number', ownerA)).status, 400);
    const boundedHistory = await request('/api/sessions/history?limit=-1', ownerA);
    assert.equal(boundedHistory.status, 200);
    assert(Array.isArray(boundedHistory.body.sessions));

    client = await openClient(ownerA);
    client.socket.send(JSON.stringify({ type: 'edit_queued', session_id: 'security-session', content: 'missing id' }));
    await waitMessage(client, message => message.type === 'error' && message.code === 'invalid_message');
    client.socket.send(JSON.stringify({
      type: 'read_file', session_id: 'security-session', request_id: 'security-request',
      path: 'x'.repeat(4097), max_size: 512,
    }));
    await waitMessage(client, message => message.type === 'agent_control_result'
      && message.request_id === 'security-request'
      && message.error?.code === 'invalid_message');

    const result = {
      ok: true,
      anonymous_http_rejected: true,
      preference_cross_user_isolation: true,
      push_endpoint_cross_user_isolation: true,
      push_input_validation: true,
      push_mutation_rate_limit: true,
      history_identifier_and_limit_bounds: true,
      queue_and_workspace_ws_validation: true,
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
    if (client?.socket) client.socket.close();
    relay.kill();
    await new Promise(resolve => {
      if (relay.exitCode !== null) return resolve();
      relay.once('exit', resolve);
      setTimeout(resolve, 2000);
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`relay surface security E2E: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
