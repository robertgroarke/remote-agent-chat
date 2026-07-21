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
const isolatedHeadless = process.argv.includes('--isolated-headless');
const fixtureSessionId = 'delivery-timeout-retry-fixture';
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
  const sends = [];
  let controlAttempts = 0;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    setTimeout(() => send({
      type: 'session_list',
      sessions: [{
        session_id: fixtureSessionId,
        title: 'Delivery timeout retry fixture',
        display_name: 'Delivery timeout retry fixture',
        agent_type: 'continue',
        status: 'healthy',
        workspace_path: root,
        project_root: root,
      }],
      workspaces: [],
    }), 25);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'get_history' || message.type === 'history_request') {
        send({ type: 'history', session: fixtureSessionId, messages: [], mode: 'full' });
      }
      if (message.type === 'agent_config_request') {
        send({
          type: 'agent_config', session_id: fixtureSessionId,
          model_id: controlAttempts >= 2 ? 'new-model' : 'old-model',
          available_models: [{ id: 'old-model', label: 'Old model' }, { id: 'new-model', label: 'New model' }],
          capabilities: { set_model: true },
        });
      }
      if (message.type === 'agent_set_model' && message.session_id === fixtureSessionId) {
        controlAttempts += 1;
        if (controlAttempts === 1) {
          setTimeout(() => send({
            type: 'agent_control_result', session_id: fixtureSessionId,
            request_id: message.request_id, command: 'agent_set_model', result: 'failed',
            error: { message: 'Fixture rejected model change.' },
          }), 75);
        } else {
          setTimeout(() => send({
            type: 'agent_control_result', session_id: fixtureSessionId,
            request_id: message.request_id, command: 'agent_set_model', result: 'ok',
          }), 50);
          setTimeout(() => send({
            type: 'agent_config', session_id: fixtureSessionId, model_id: 'new-model',
            available_models: [{ id: 'old-model', label: 'Old model' }, { id: 'new-model', label: 'New model' }],
            capabilities: { set_model: true },
          }), 100);
        }
      }
      if (message.type !== 'send' || message.session !== fixtureSessionId) return;
      sends.push({ cid: message.client_message_id, content: message.content, at: Date.now() });
      if (sends.length === 3) {
        setTimeout(() => send({
          type: 'proxy_send_result',
          session_id: fixtureSessionId,
          client_message_id: message.client_message_id,
          result: 'failed',
          error: {
            code: 'pending_revalidation',
            message: 'fixture version mismatch: expected current, found prior',
          },
        }), 25);
        return;
      }
      if (sends.length !== 2) return;
      setTimeout(() => send({ type: 'message_accepted', client_message_id: message.client_message_id, ts: Date.now() }), 25);
      setTimeout(() => send({ type: 'message_delivered', client_message_id: message.client_message_id }), 50);
      setTimeout(() => send({ type: 'agent_started', client_message_id: message.client_message_id, session_id: fixtureSessionId }), 75);
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let originalUrl;
  try {
    if (isolatedHeadless) {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
      });
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.addInitScript(() => {
        localStorage.setItem('remote-agent-chat:show-test-sessions:v1', '1');
      });
      originalUrl = 'about:blank';
    } else {
      browser = await chromium.connectOverCDP(cdpUrl);
      const pages = browser.contexts().flatMap(context => context.pages());
      assert.strictEqual(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
      [page] = pages;
      originalUrl = page.url();
    }
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.getByText('Delivery timeout retry fixture', { exact: true }).first().click({ timeout: 5000 });
    const composer = page.locator('.textarea-row textarea');
    await composer.fill('timeout retry correlation proof');
    await page.locator('.send-btn').click();

    const retry = page.locator('.delivery.failed .delivery-retry');
    await retry.waitFor({ state: 'visible', timeout: 13000 });
    const failureTitle = await retry.locator('xpath=..').getAttribute('title');
    assert.match(failureTitle || '', /relay acceptance/i);
    await retry.click();
    await page.locator('.delivery.agent-started').waitFor({ state: 'visible', timeout: 5000 });

    assert.strictEqual(sends.length, 2, 'fixture should observe exactly the initial send and one retry');
    assert.strictEqual(sends[1].cid, sends[0].cid, 'retry must reuse the original client_message_id');
    assert.strictEqual(await page.locator('.message.user').count(), 1, 'retry must reuse the original user bubble');
    assert.strictEqual(await page.locator('.delivery.failed').count(), 0, 'successful retry must clear failed state');

    await composer.fill('structured failure reason proof');
    await page.locator('.send-btn').click();
    const structuredFailure = page.locator('.delivery.failed').last();
    await structuredFailure.waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await structuredFailure.innerText(), /Update validation pending/i);
    assert.match(await structuredFailure.getAttribute('title') || '', /fixture version mismatch/);
    assert.strictEqual(sends.length, 3, 'fixture should observe one explicit structured-failure send');
    assert.strictEqual(await page.locator('.message.user').count(), 2, 'structured failure retains one explanatory user bubble');

    await page.locator('.composer-gear-btn').first().click();
    const modelSelect = page.locator('.composer-setting-label').filter({ hasText: 'Model' }).locator('select').first();
    await modelSelect.waitFor({ state: 'visible', timeout: 3000 });
    assert.strictEqual(await modelSelect.inputValue(), 'old-model');
    await modelSelect.selectOption('new-model');
    assert.strictEqual(await modelSelect.inputValue(), 'new-model', 'model selection should render optimistically');
    await page.locator('.composer-control-state.failed').waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await page.locator('.composer-control-state.failed').innerText(), /rejected model change/i);
    assert.strictEqual(await modelSelect.inputValue(), 'old-model', 'failed control should roll back to the prior model');
    await modelSelect.selectOption('new-model');
    await page.locator('.composer-control-state.pending').waitFor({ state: 'visible', timeout: 1000 });
    await page.waitForFunction(() => document.querySelector('.composer-setting-label select')?.value === 'new-model'
      && !document.querySelector('.composer-control-state.pending'), null, { timeout: 3000 });
    const result = {
      ok: true,
      browser_mode: isolatedHeadless ? 'isolated-headless' : 'persistent-cdp',
      cdp: isolatedHeadless ? null : cdpUrl,
      pages: 1,
      timeout_stage: 'queued',
      correlation_id_reused: true,
      user_bubbles: 2,
      structured_failure_reason_visible: true,
      final_state: 'agent_started',
      optimistic_control: 'new-model',
      rejected_control_rolled_back: 'old-model',
      confirmed_control: 'new-model',
      control_attempts: controlAttempts,
      original_origin_restored: new URL(originalUrl).origin,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (!isolatedHeadless && page && originalUrl) {
      await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
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
