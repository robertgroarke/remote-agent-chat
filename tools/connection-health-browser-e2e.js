#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const fixtureSessionId = 'connection-health-fixture';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForValue(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return null;
}

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  let allowReconnect = true;
  let connectionCount = 0;
  let activeSocket = null;
  let reconnectAckAt = null;
  const sends = [];
  const historyRequests = [];

  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)
      || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws' || !allowReconnect) return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    activeSocket = ws;
    connectionCount += 1;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: [{
        session_id: fixtureSessionId, title: 'Connection health fixture',
        display_name: 'Connection health fixture', agent_type: 'continue', status: 'healthy',
        workspace_path: root, project_root: root,
      }],
      workspaces: [],
    });
    if (connectionCount > 1) reconnectAckAt = Date.now();
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      }
      if (message.type === 'get_history' || message.type === 'history_request') {
        historyRequests.push(message);
        send({
          type: 'history', session: fixtureSessionId,
          messages: [{ role: 'assistant', content: 'Connection baseline', sequence: 5 }],
          mode: 'full', last_sequence: 5,
        });
      }
      if (message.type === 'history_chunk_request') {
        historyRequests.push(message);
        send({
          type: 'history_chunk', session_id: fixtureSessionId, request_id: message.request_id,
          source: 'relay_sqlite', messages: [{ role: 'assistant', content: 'Connection baseline', sequence: 5 }],
          total: 1, loaded: 1, partial: false, replace: true,
        });
      }
      if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: fixtureSessionId, capabilities: {} });
      }
      if (message.type === 'send' && message.session === fixtureSessionId) {
        sends.push(message);
        setTimeout(() => send({ type: 'message_accepted', client_message_id: message.client_message_id }), 10);
        setTimeout(() => send({ type: 'message_delivered', client_message_id: message.client_message_id }), 20);
        setTimeout(() => send({ type: 'agent_started', session_id: fixtureSessionId, client_message_id: message.client_message_id }), 30);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let originalUrl;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.getByText('Connection health fixture', { exact: true }).first().click({ timeout: 5000 });
    await page.getByText(/Relay healthy · \d+ ms/).waitFor({ state: 'visible', timeout: 5000 });
    const initialHealth = await page.getByText(/Relay healthy · \d+ ms/).innerText();

    allowReconnect = false;
    activeSocket.close();
    await page.locator('.sidebar-footer').filter({ hasText: 'Reconnecting' }).waitFor({ state: 'visible', timeout: 3000 });
    const composer = page.locator('.textarea-row textarea');
    await composer.fill('offline queue correlation proof');
    const sendButton = page.locator('.send-btn');
    assert.equal(await sendButton.getAttribute('title'), 'Queue until reconnected');
    await sendButton.click();
    await page.locator('.delivery.offline-queued').waitFor({ state: 'visible', timeout: 1000 });
    assert.equal(sends.length, 0, 'offline message reached the server before reconnect');
    assert.equal(await page.locator('.message.user').count(), 1, 'offline send must create exactly one optimistic bubble');

    const reconnectAllowedAt = Date.now();
    allowReconnect = true;
    assert(await waitForValue(() => connectionCount > 1, 5000), `browser did not reconnect (connections=${connectionCount})`);
    assert(await waitForValue(() => sends.length === 1, 2000), `offline queue did not flush (connections=${connectionCount}, sends=${sends.length})`);
    await page.locator('.delivery.agent-started').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(sends.length, 1, 'offline queue should flush exactly once');
    assert.equal(sends[0].content, 'offline queue correlation proof');
    assert(sends[0].client_message_id, 'flushed send lost its correlation id');
    assert.equal(await page.locator('.message.user').count(), 1, 'reconnect flush duplicated the user bubble');
    await page.getByText(/Relay healthy · \d+ ms/).waitFor({ state: 'visible', timeout: 3000 });
    const reconnectMs = reconnectAckAt - reconnectAllowedAt;
    assert(reconnectMs >= 0 && reconnectMs <= 3000, `reconnect ack took ${reconnectMs} ms`);

    const result = {
      ok: true,
      cdp: cdpUrl,
      pages: 1,
      initial_health: initialHealth,
      offline_state_visible: true,
      reconnect_ms: reconnectMs,
      flushed_once: true,
      correlation_id: sends[0].client_message_id,
      user_bubbles: 1,
      final_receipt: 'agent_started',
      history_requests: historyRequests.length,
      original_origin_restored: new URL(originalUrl).origin,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
