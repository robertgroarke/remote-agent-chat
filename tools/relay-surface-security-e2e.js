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

async function waitMessageCount(client, predicate, count) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (client.messages.filter(predicate).length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} WebSocket validation responses were not received`);
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
  const clients = [];
  try {
    await waitForRelay(relay);
    const ownerA = token('owner-a@example.test');
    const ownerB = token('owner-b@example.test');

    const readiness = await request('/readyz', '');
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.proxy_sessions, undefined, 'public readiness must not expose session identifiers');
    assert.equal(readiness.body.browser_clients, undefined, 'public readiness must not expose browser activity');
    assert.equal((await request('/api/sessions/history', '')).status, 401);
    assert.equal((await request('/api/preferences/sessions', '')).status, 401);
    assert.equal((await request('/api/push/web-config', '')).status, 401);

    let authExchange;
    for (let index = 0; index < 30; index += 1) {
      authExchange = await request('/auth/app-token', '', {
        method: 'POST', body: JSON.stringify({ token: `invalid-auth-token-${index}` }),
      });
    }
    assert.equal(authExchange.status, 401);
    const throttledAuthExchange = await request('/auth/app-token', '', {
      method: 'POST', body: JSON.stringify({ token: 'invalid-auth-token-throttled' }),
    });
    assert.equal(throttledAuthExchange.status, 429);
    assert(throttledAuthExchange.headers.get('retry-after'));

    const fcmToken = `security-fcm-${Date.now()}-APA91`;
    assert.equal((await request('/fcm-token', ownerA, {
      method: 'POST', body: JSON.stringify({ fcm_token: fcmToken, platform: 'android' }),
    })).status, 200);
    assert.equal((await request('/fcm-token', ownerB, {
      method: 'POST', body: JSON.stringify({ fcm_token: fcmToken, platform: 'android' }),
    })).status, 409, 'an FCM token must not be reassigned across authenticated principals');
    assert.equal((await request('/fcm-token', ownerB, {
      method: 'POST', body: JSON.stringify({ fcm_token: 'short', platform: 'android' }),
    })).status, 400);
    let invalidFcm;
    for (let index = 0; index < 18; index += 1) {
      invalidFcm = await request('/fcm-token', ownerB, {
        method: 'POST', body: JSON.stringify({ fcm_token: `short-${index}`, platform: 'android' }),
      });
    }
    assert.equal(invalidFcm.status, 400);
    const throttledFcm = await request('/fcm-token', ownerB, {
      method: 'POST', body: JSON.stringify({ fcm_token: 'short-throttled', platform: 'android' }),
    });
    assert.equal(throttledFcm.status, 429);
    assert(throttledFcm.headers.get('retry-after'));

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

    const uploadBytes = Buffer.from('security upload boundary');
    const validUpload = await request('/upload', ownerA, {
      method: 'POST',
      body: JSON.stringify({ filename: 'boundary.txt', content: uploadBytes.toString('base64') }),
    });
    assert.equal(validUpload.status, 200, 'bearer-authenticated Android uploads must be accepted');
    assert(/^\/uploads\/\d{10,16}_boundary\.txt$/.test(validUpload.body.url));
    const storedUpload = path.join(dataDir, 'uploads', path.basename(validUpload.body.url));
    assert.equal(fs.readFileSync(storedUpload).toString('utf8'), uploadBytes.toString('utf8'));
    assert.equal((await request('/upload', ownerA, {
      method: 'POST', body: JSON.stringify({ filename: 'invalid.txt', content: 'not base64' }),
    })).status, 400);
    assert.equal((await request('/upload', ownerA, {
      method: 'POST', body: JSON.stringify({ filename: 'oversized.bin', content: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }),
    })).status, 413);

    const client = await openClient(ownerA);
    clients.push(client);
    client.socket.send(JSON.stringify({ type: 'edit_queued', session_id: 'security-session', content: 'missing id' }));
    await waitMessage(client, message => message.type === 'error' && message.code === 'invalid_message');
    client.socket.send(JSON.stringify({
      type: 'read_file', session_id: 'security-session', request_id: 'security-request',
      path: 'x'.repeat(4097), max_size: 512,
    }));
    await waitMessage(client, message => message.type === 'agent_control_result'
      && message.request_id === 'security-request'
      && message.error?.code === 'invalid_message');

    const invalidSend = index => JSON.stringify({
      type: 'send_message',
      session_id: 'x',
      content: 'security rate-limit probe',
      client_message_id: `security-rate-${index}`,
    });
    for (let index = 0; index < 30; index += 1) client.socket.send(invalidSend(index));
    await waitMessageCount(client, message => message.type === 'error' && message.code === 'invalid_message', 31);

    const reconnectedOwner = await openClient(ownerA);
    clients.push(reconnectedOwner);
    reconnectedOwner.socket.send(invalidSend('reconnected'));
    await waitMessage(reconnectedOwner, message => message.type === 'error' && message.code === 'rate_limited');

    const otherOwner = await openClient(ownerB);
    clients.push(otherOwner);
    otherOwner.socket.send(invalidSend('other-owner'));
    await waitMessage(otherOwner, message => message.type === 'error' && message.code === 'invalid_message');

    const result = {
      ok: true,
      anonymous_http_rejected: true,
      public_readiness_minimized: true,
      auth_exchange_rate_limit: true,
      fcm_token_validation_and_ownership: true,
      fcm_mutation_rate_limit: true,
      preference_cross_user_isolation: true,
      push_endpoint_cross_user_isolation: true,
      push_input_validation: true,
      push_mutation_rate_limit: true,
      history_identifier_and_limit_bounds: true,
      bearer_upload_authentication: true,
      upload_decode_and_size_bounds: true,
      queue_and_workspace_ws_validation: true,
      websocket_rate_limit_reconnect_resistant: true,
      websocket_rate_limit_principal_isolation: true,
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
    for (const client of clients) client.socket.close();
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
