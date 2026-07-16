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
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const sessionId = 'escape-interrupt-fixture';

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

function contentType(filePath) {
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const mutations = [];
  let fixtureSocket;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
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
  const send = payload => fixtureSocket?.readyState === fixtureSocket?.OPEN
    && fixtureSocket.send(JSON.stringify(payload));
  const setGenerating = value => send({
    type: 'session_status', session_id: sessionId, thinking: value,
    label: value ? 'Generating' : '', activity: { kind: value ? 'generating' : 'idle', label: value ? 'Generating' : '' },
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: [{
        session_id: sessionId, agent_type: 'codex_cli', title: 'Escape interrupt fixture',
        chat_title: 'Escape interrupt fixture', status: 'healthy', workspace_name: 'Remote Agent Chat',
      }], workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (['agent_interrupt', 'agent_message', 'permission_response'].includes(message.type)) mutations.push(message);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail',
          replace: message.replace !== false, messages: [{ role: 'assistant', content: 'Interrupt fixture ready.', sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: 'Interrupt fixture ready.', sequence: 1 }] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1 });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let originalUrl;
  let originalViewport;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    originalViewport = page.viewportSize();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const composer = page.locator('.input-area textarea');
    await composer.waitFor({ state: 'visible', timeout: 5000 });

    await composer.focus();
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('.interrupt-confirm-inline').count(), 0, 'idle Escape armed an interrupt');
    assert.strictEqual(mutations.length, 0, 'idle Escape emitted a mutation');

    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    const confirm = page.locator('.interrupt-confirm-inline');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    assert.match(await confirm.innerText(), /Esc again or Enter/);
    assert.strictEqual(mutations.length, 0, 'first Escape interrupted without confirmation');
    const desktopScreenshot = outputPath ? path.join(path.dirname(outputPath), 'escape-interrupt-desktop.png') : null;
    if (desktopScreenshot) await page.locator('.input-area').screenshot({ path: desktopScreenshot, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.deepStrictEqual(mutations.map(message => message.type), ['agent_interrupt']);

    setGenerating(false);
    await page.locator('.stop-btn').waitFor({ state: 'detached', timeout: 3000 });
    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.fill('/');
    await page.locator('.slash-menu').waitFor({ state: 'visible', timeout: 1000 });
    await page.keyboard.press('Escape');
    await page.locator('.slash-menu').waitFor({ state: 'detached', timeout: 1000 });
    assert.strictEqual(await confirm.count(), 0, 'slash-menu Escape also armed interrupt');
    assert.strictEqual(mutations.length, 1, 'slash-menu Escape emitted a mutation');
    await composer.fill('');

    send({
      type: 'permission_prompt', session_id: sessionId, prompt_id: 'prompt-priority', message: 'Prompt has Escape priority.',
      timeout_ms: 300000, default_choice: 'stay', choices: [{ choice_id: 'stay', label: 'Stay' }],
    });
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 1000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    assert.strictEqual(await confirm.count(), 0, 'prompt Escape also armed interrupt');
    assert.strictEqual(mutations.length, 1, 'prompt Escape emitted an interrupt');
    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'prompt-priority' });
    await page.locator('.permission-card').waitFor({ state: 'detached', timeout: 1000 });

    await composer.focus();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.deepStrictEqual(mutations.map(message => message.type), ['agent_interrupt', 'agent_interrupt']);

    setGenerating(false);
    await page.locator('.stop-btn').waitFor({ state: 'detached', timeout: 3000 });
    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    await page.waitForTimeout(2700);
    await confirm.waitFor({ state: 'detached', timeout: 1000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.strictEqual(mutations.length, 2, 'expired confirmation still interrupted');

    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    const mobileScreenshot = outputPath ? path.join(path.dirname(outputPath), 'escape-interrupt-mobile.png') : null;
    if (mobileScreenshot) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.input-area').screenshot({ path: mobileScreenshot, animations: 'disabled' });
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    assert.strictEqual(mutations.filter(message => message.type === 'agent_message').length, 0, 'fixture sent a user message');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      idle_escape_noop: true,
      first_escape_armed_only: true,
      double_escape_interrupts: 1,
      escape_then_enter_interrupts: 1,
      confirm_timeout_ms: 2500,
      expired_confirmation_noop: true,
      slash_menu_priority: true,
      permission_prompt_priority: true,
      agent_interrupts: mutations.filter(message => message.type === 'agent_interrupt').length,
      user_messages_sent: mutations.filter(message => message.type === 'agent_message').length,
      permission_responses: mutations.filter(message => message.type === 'permission_response').length,
      visible_windows_opened: 0,
      external_focus_actions: 0,
      screenshots: [desktopScreenshot, mobileScreenshot].filter(Boolean).map(file => path.relative(root, file)),
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
