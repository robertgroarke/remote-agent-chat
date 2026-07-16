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
const fixtureSessionId = 'web-push-owned-session';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;

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

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  let fixtureConnections = 0;
  const preferences = {
    permission_required: true, agent_ready: true, agent_error: true,
    session_offline: true, rate_limit_cleared: true,
  };
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/preferences/notifications')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ preferences }));
      return;
    }
    if (request.url.startsWith('/api/preferences/sessions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ preferences: {} }));
      return;
    }
    if (request.url.startsWith('/api/push/web-config')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ enabled: true, public_key: 'fixture-vapid-public-key' }));
      return;
    }
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
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    fixtureConnections += 1;
    const sessions = [{
        session_id: fixtureSessionId,
        display_name: 'Web Push owned session',
        agent_type: 'continue',
        workspace_path: root,
        project_root: root,
        status: 'healthy',
      }];
    setTimeout(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({
      type: 'connection_ack', sessions, workspaces: [], heartbeat_interval_ms: 30000,
    })), 10);
    setTimeout(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({
      type: 'session_list', sessions, workspaces: [],
    })), 25);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'get_history' || message.type === 'history_request') {
        ws.send(JSON.stringify({ type: 'history', session: fixtureSessionId, messages: [], mode: 'full' }));
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
    await page.goto(`http://127.0.0.1:${port}/?session=${fixtureSessionId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const selectedCard = page.locator(`.session-card.active[data-session-id="${fixtureSessionId}"]`);
    try {
      await selectedCard.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      const visibleText = await page.locator('body').innerText().catch(() => '');
      throw new Error(`notification deep-link fixture missing; ws=${fixtureConnections}; body=${visibleText.slice(0, 1200)}; ${error.message}`);
    }
    const notificationSettingsButton = page.getByRole('button', { name: 'Notification settings' });
    await notificationSettingsButton.waitFor({ state: 'attached', timeout: 5000 });
    await notificationSettingsButton.evaluate(button => button.click());
    await page.getByText('Browser notifications', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: 'Enable' }).waitFor({ state: 'visible', timeout: 5000 });
    const serviceWorker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { scope: registration.scope, active: !!registration.active, permission: Notification.permission };
    });
    assert(serviceWorker.active, 'PWA service worker did not become active');
    assert(serviceWorker.scope === `http://127.0.0.1:${port}/`, 'service worker scope does not cover the PWA');

    const result = {
      ok: true,
      cdp: cdpUrl,
      pages: 1,
      pwa_notification_settings_visible: true,
      settings_entry_method: 'dom-click-local-fixture-narrow-layout',
      enable_action_visible: true,
      notification_session_deep_link_selected: true,
      service_worker_active: true,
      notification_permission: serviceWorker.permission,
      original_origin_restored: new URL(originalUrl).origin,
      generated_at: new Date().toISOString(),
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(`Web Push browser E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
