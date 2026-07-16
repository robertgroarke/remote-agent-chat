#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const { normalizeActivityTimeline } = require('../relay-server/activity-timeline');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const fixtureSessionId = 'live-activity-fixture';
const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? path.resolve(process.argv[outputArgIndex + 1])
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

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  let currentActivity = normalizeActivityTimeline({
    kind: 'working',
    label: 'Working',
    thinkingContent: 'Streaming partial: inspecting the current state.',
    updated_at: new Date(Date.now() - 65_000).toISOString(),
  }, null);
  let fixtureSocket = null;

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
      response.writeHead(404);
      response.end('not found');
      return;
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
    fixtureSocket = ws;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    setTimeout(() => send({
      type: 'session_list',
      sessions: [{
        session_id: fixtureSessionId,
        title: 'Live activity fixture',
        display_name: 'Live activity fixture',
        agent_type: 'continue',
        status: 'healthy',
        workspace_path: root,
        project_root: root,
        activity: currentActivity,
      }],
      workspaces: [],
    }), 25);
    setTimeout(() => send({
      type: 'status', session: fixtureSessionId, thinking: true,
      label: currentActivity.label, activity: currentActivity,
      thinking_content: currentActivity.thinkingContent,
    }), 50);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'get_history' || message.type === 'history_request') {
        send({ type: 'history', session: fixtureSessionId, messages: [], mode: 'full' });
      }
      if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: fixtureSessionId, capabilities: {} });
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
    const fixtureCard = page.locator(`.session-card[data-session-id="${fixtureSessionId}"]`);
    await fixtureCard.waitFor({ state: 'attached', timeout: 5000 });
    await fixtureCard.evaluate(node => node.click());
    await page.waitForFunction(
      id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
      fixtureSessionId,
      { timeout: 5000 },
    );

    const activityStack = page.locator('[data-testid="live-status-stack"]').last();
    await activityStack.waitFor({ state: 'visible', timeout: 5000 }).catch(async error => {
      const body = (await page.locator('body').innerText()).slice(-3000);
      throw new Error(`Live activity row did not render: ${error.message}\n${body}`);
    });
    const initialLabel = await activityStack.innerText();
    assert.match(initialLabel, /Working[\s\S]*1m \d{2}s/, `missing minute-level ticker: ${initialLabel}`);
    await page.getByText('Streaming partial: inspecting the current state.', { exact: true }).waitFor({ state: 'visible' });

    const firstAnchor = currentActivity.started_at;
    currentActivity = normalizeActivityTimeline({
      kind: 'running_command',
      label: 'Running tests',
      thinkingContent: 'Streaming partial: test output is arriving.',
      updated_at: new Date().toISOString(),
    }, currentActivity);
    assert.strictEqual(currentActivity.started_at, firstAnchor, 'tool transition reset the active interval');
    const statusSentAt = Date.now();
    fixtureSocket.send(JSON.stringify({
      type: 'status', session: fixtureSessionId, thinking: true,
      label: currentActivity.label, activity: currentActivity,
      thinking_content: currentActivity.thinkingContent,
    }));
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-testid="live-status-stack"]')?.innerText || '';
      return /Running tests[\s\S]*1m \d{2}s/.test(text);
    }, null, { timeout: 1000 });
    const toolStatusLatencyMs = Date.now() - statusSentAt;
    assert(toolStatusLatencyMs <= 1000, `tool activity rendered in ${toolStatusLatencyMs} ms`);
    await page.getByText('Streaming partial: test output is arriving.', { exact: true }).waitFor({ state: 'visible' });

    currentActivity = normalizeActivityTimeline({
      kind: 'idle', label: '', updated_at: new Date().toISOString(),
    }, currentActivity);
    fixtureSocket.send(JSON.stringify({
      type: 'status', session: fixtureSessionId, thinking: false, label: '', activity: currentActivity,
    }));
    await page.locator('[data-testid="live-status-stack"]').waitFor({ state: 'detached', timeout: 1000 });

    const result = {
      ok: true,
      cdp: cdpUrl,
      pages: 1,
      initial_label: initialLabel,
      active_anchor_preserved: firstAnchor,
      tool_label: 'Running tests',
      tool_status_latency_ms: toolStatusLatencyMs,
      streaming_partial_rendered: true,
      idle_cleared_within_ms: 1000,
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
