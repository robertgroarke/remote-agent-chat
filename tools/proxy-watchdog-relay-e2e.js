'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

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

function requestJson({ port, method = 'GET', pathname, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* assertion below owns invalid JSON */ }
        resolve({ status: response.statusCode, json, text });
      });
    });
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson({ port, pathname: '/healthz' });
      if (response.status === 200 && response.json?.status === 'ok') return response.json;
    } catch { /* retry during process startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/client-ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const messages = [];
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      if (message.type === 'connection_ack') resolve({ ws, messages });
    });
    ws.once('error', reject);
  });
}

function connectProxy(port, secret, proxyId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: proxyId, machine_label: 'watchdog-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
    });
    ws.once('error', reject);
  });
}

async function waitForMessage(messages, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for relay event; received: ${messages.map(item => item.type).join(', ')}`);
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

async function main() {
  const port = await freePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-watchdog-relay-'));
  const secret = 'watchdog-e2e-secret';
  const output = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'watchdog-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'watchdog-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'watchdog-e2e-client-secret',
      PROXY_SECRET: secret,
      RAC_DATA_DIR: root,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      PROXY_OUTAGE_GRACE_MS: '150',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  let client;
  let firstProxy;
  let recoveredProxy;
  try {
    const startup = await waitForHealth(port);
    assert.equal(startup.connections.proxy_connections, 0);
    assert.equal(startup.proxy_watchdog.has_seen_proxy, false);

    client = await connectClient(port);
    firstProxy = await connectProxy(port, secret, 'watchdog-e2e-first');
    let health = await waitForHealth(port);
    assert.equal(health.connections.proxy_connections, 1);
    assert.equal(health.connections.proxy_sessions, 0, 'zero targets must not make a connected proxy unhealthy');

    await closeSocket(firstProxy);
    firstProxy = null;
    const offline = await waitForMessage(client.messages, item => item.type === 'proxy_watchdog_status' && item.status === 'offline');
    assert(offline.missing_ms >= 150, `offline grace was only ${offline.missing_ms}ms`);
    assert.equal(client.messages.filter(item => item.type === 'proxy_watchdog_status' && item.status === 'offline').length, 1);

    recoveredProxy = await connectProxy(port, secret, 'watchdog-e2e-recovered');
    const recovered = await waitForMessage(client.messages, item => item.type === 'proxy_watchdog_status' && item.status === 'recovered');
    assert.equal(recovered.incident_id, offline.incident_id);

    const unauthorized = await requestJson({
      port, method: 'POST', pathname: '/api/proxy-watchdog-event',
      body: { type: 'proxy_watchdog_failed', incident_id: 'e2e-failure', restart_attempts: 3, missing_seconds: 300 },
    });
    assert.equal(unauthorized.status, 401);
    const invalid = await requestJson({
      port, method: 'POST', pathname: '/api/proxy-watchdog-event', token: secret,
      body: { type: 'proxy_watchdog_failed', incident_id: 'e2e-failure', restart_attempts: 0, missing_seconds: 300 },
    });
    assert.equal(invalid.status, 400);
    const accepted = await requestJson({
      port, method: 'POST', pathname: '/api/proxy-watchdog-event', token: secret,
      body: { type: 'proxy_watchdog_failed', incident_id: 'e2e-failure', restart_attempts: 3, missing_seconds: 300 },
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.json.deduplicated, false);
    const failed = await waitForMessage(client.messages, item => item.type === 'proxy_watchdog_status' && item.status === 'failed');
    assert.equal(failed.restart_attempts, 3);
    const duplicate = await requestJson({
      port, method: 'POST', pathname: '/api/proxy-watchdog-event', token: secret,
      body: { type: 'proxy_watchdog_failed', incident_id: 'e2e-failure', restart_attempts: 3, missing_seconds: 301 },
    });
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.json.deduplicated, true);
    assert.equal(client.messages.filter(item => item.type === 'proxy_watchdog_status' && item.status === 'failed').length, 1);

    health = await waitForHealth(port);
    assert.equal(health.connections.proxy_connections, 1);
    assert.equal(health.proxy_watchdog.state, 'healthy');
    console.log(JSON.stringify({
      status: 'PASS',
      isolated_relay: true,
      grace_ms: 150,
      offline_events: 1,
      recovered_events: 1,
      failure_events: 1,
      failure_duplicates: 0,
      unauthorized_status: unauthorized.status,
      invalid_status: invalid.status,
      connected_zero_target_safe: true,
      visible_windows: 0,
    }, null, 2));
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await closeSocket(firstProxy);
    await closeSocket(recoveredProxy);
    await closeSocket(client?.ws);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => {
          if (child.exitCode == null) child.kill('SIGKILL');
        }, 1_000).unref();
      });
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
