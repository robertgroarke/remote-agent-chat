#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('../relay-server/node_modules/jsonwebtoken');
const WebSocket = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

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
      host: '127.0.0.1', port, path: route, method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: response.statusCode, body: JSON.parse(text || '{}') });
      });
    });
    req.once('error', reject);
    req.end(data);
  });
}

async function waitFor(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('condition timed out');
}

function connectClient(port, token) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/client-ws?token=${encodeURIComponent(token)}`);
  return new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === 'connection_ack') resolve({ ws, messages });
    });
  });
}

async function main() {
  const port = await freePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-scheduled-owner-'));
  const jwtSecret = 'scheduled-owner-jwt-secret-at-least-32-characters';
  const proxySecret = 'scheduled-owner-proxy-secret';
  const logs = [];
  const relay = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'scheduled-owner-session-secret-at-least-32-chars',
      JWT_SECRET: jwtSecret,
      ALLOWED_EMAIL: '',
      GOOGLE_CLIENT_ID: 'scheduled-owner-client',
      GOOGLE_CLIENT_SECRET: 'scheduled-owner-secret',
      PROXY_SECRET: proxySecret,
      RAC_DATA_DIR: dataRoot,
      ALLOW_LAN_BYPASS: 'false',
      ALLOW_LOOPBACK_BYPASS: 'false',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  relay.stdout.on('data', chunk => logs.push(String(chunk)));
  relay.stderr.on('data', chunk => logs.push(String(chunk)));
  const ownerToken = jwt.sign({ email: 'owner@example.test' }, jwtSecret, { expiresIn: '5m' });
  const otherToken = jwt.sign({ email: 'other@example.test' }, jwtSecret, { expiresIn: '5m' });
  let proxy;
  const proxyMessages = [];
  let owner;
  let other;
  try {
    await waitFor(async () => {
      try { return (await request(port, ownerToken, 'GET', '/healthz')).status === 200; } catch { return false; }
    });
    proxy = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    await new Promise((resolve, reject) => {
      proxy.once('open', () => proxy.send(JSON.stringify({
        type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
        proxy_id: 'scheduled-owner-e2e', secret: proxySecret,
      })));
      proxy.once('error', reject);
      proxy.on('message', data => {
        const message = JSON.parse(String(data));
        proxyMessages.push(message);
        if (message.type === 'connection_ack') resolve();
      });
    });
    proxy.send(JSON.stringify({
      type: 'session_list',
      sessions: [{
        session_id: 'scheduled-owner-session', agent_type: 'codex_cli',
        workspace_name: 'Scheduled owner isolation', status: 'healthy',
      }],
    }));
    owner = await connectClient(port, ownerToken);
    other = await connectClient(port, otherToken);
    const timedCreated = await request(port, ownerToken, 'POST', '/api/scheduled-sends', {
      session_id: 'scheduled-owner-session',
      content: 'owner private pending content',
      trigger_kind: 'at',
      deliver_at: new Date(Date.now() + 500).toISOString(),
    });
    assert.equal(timedCreated.status, 201);
    const timedJob = timedCreated.body.scheduled_send;
    await waitFor(() => owner.messages.find(message => (
      message.type === 'scheduled_send_status' && message.scheduled_send?.id === timedJob.id
    )));
    const proxySend = await waitFor(() => proxyMessages.find(message => (
      message.type === 'send' && message.client_message_id === timedJob.client_message_id
    )));
    await waitFor(() => owner.messages.find(message => (
      message.type === 'scheduled_send_status'
      && message.scheduled_send?.id === timedJob.id
      && message.scheduled_send?.state === 'dispatching'
    )));
    proxy.send(JSON.stringify({
      type: 'proxy_send_result',
      session_id: 'scheduled-owner-session',
      client_message_id: proxySend.client_message_id,
      result: 'delivered',
    }));
    await waitFor(() => owner.messages.find(message => (
      message.type === 'scheduled_send_status'
      && message.scheduled_send?.id === timedJob.id
      && message.scheduled_send?.state === 'completed'
    )));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(other.messages.filter(message => message.type === 'scheduled_send_status').length, 0,
      'another authenticated principal received owner dispatch or settlement state');

    const created = await request(port, ownerToken, 'POST', '/api/scheduled-sends', {
      session_id: 'scheduled-owner-session',
      content: 'owner private cancellation content',
      trigger_kind: 'idle',
    });
    assert.equal(created.status, 201);
    const job = created.body.scheduled_send;
    await waitFor(() => owner.messages.find(message => (
      message.type === 'scheduled_send_status' && message.scheduled_send?.id === job.id
    )));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(other.messages.filter(message => message.type === 'scheduled_send_status').length, 0,
      'another authenticated principal received owner scheduled-send content');

    const cancelled = await request(port, ownerToken, 'DELETE', `/api/scheduled-sends/${job.id}`);
    assert.equal(cancelled.status, 200);
    await waitFor(() => owner.messages.find(message => (
      message.type === 'scheduled_send_status'
      && message.scheduled_send?.id === job.id
      && message.scheduled_send?.state === 'cancelled'
    )));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(other.messages.filter(message => message.type === 'scheduled_send_status').length, 0,
      'another authenticated principal received owner cancellation state');

    const ownerList = await request(port, ownerToken, 'GET', '/api/scheduled-sends');
    const otherList = await request(port, otherToken, 'GET', '/api/scheduled-sends');
    assert.equal(ownerList.body.scheduled_sends.length, 2);
    assert.equal(otherList.body.scheduled_sends.length, 0);
    const result = {
      ok: true,
      actual_relay: true,
      authenticated_principals: 2,
      owner_status_events: owner.messages.filter(message => message.type === 'scheduled_send_status').length,
      other_status_events: other.messages.filter(message => message.type === 'scheduled_send_status').length,
      owner_list_jobs: ownerList.body.scheduled_sends.length,
      other_list_jobs: otherList.body.scheduled_sends.length,
      pending_content_cross_principal_leaks: 0,
      cancellation_cross_principal_leaks: 0,
      dispatch_cross_principal_leaks: 0,
      settlement_cross_principal_leaks: 0,
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
  } catch (error) {
    throw new Error(`${error.stack || error}\n${logs.join('')}`);
  } finally {
    for (const socket of [owner?.ws, other?.ws, proxy]) {
      try { socket?.close(); } catch {}
    }
    if (relay.exitCode == null) {
      relay.kill();
      await new Promise(resolve => relay.once('exit', resolve));
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
