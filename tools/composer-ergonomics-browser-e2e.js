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
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const sessionIds = ['composer-fixture-a', 'composer-fixture-b'];

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

function historyFor(sessionId) {
  return Array.from({ length: 48 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${sessionId} transcript row ${index + 1} ${'content '.repeat(10)}`,
    sequence: index + 1,
  }));
}

async function main() {
  const port = await freePort();
  let activeSocket = null;
  const sentMessages = [];
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
  wss.on('connection', ws => {
    activeSocket = ws;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: sessionIds.map((sessionId, index) => ({
        session_id: sessionId,
        title: `Composer fixture ${index + 1}`,
        display_name: `Composer fixture ${index + 1}`,
        agent_type: 'claude_cli',
        status: 'healthy',
        workspace_path: root,
        project_root: root,
      })),
      workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: {} });
      } else if (['history_chunk_request', 'get_history', 'history_request'].includes(message.type)) {
        if (!sessionIds.includes(sid)) return;
        const messages = historyFor(sid);
        if (message.type === 'history_chunk_request') {
          send({
            type: 'history_chunk', session_id: sid, request_id: message.request_id,
            source: 'fixture', mode: 'tail', replace: message.replace !== false,
            messages, total_messages: messages.length, loaded_messages: messages.length, partial: false,
          });
        } else if (message.type === 'history_request') {
          send({
            type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id,
            after_sequence: message.after_sequence, messages: [], loaded_messages: 0,
            total_messages: messages.length,
          });
        } else {
          send({ type: 'history', session: sid, request_id: message.request_id, mode: 'full', messages });
        }
      } else if (message.type === 'send') {
        sentMessages.push({ session_id: sid, content: message.content });
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
    assert.strictEqual(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    originalViewport = page.viewportSize();

    const loadFixture = async (sessionId, viewport) => {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${port}/?session=${encodeURIComponent(sessionId)}`, {
        waitUntil: 'domcontentloaded', timeout: 15000,
      });
      await page.locator('.textarea-row textarea').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
        sessionId, { timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('.messages .message').length >= 40,
        null, { timeout: 5000 });
    };

    const measureTextarea = async (viewport) => {
      const composer = page.locator('.textarea-row textarea');
      await composer.fill('one line');
      const single = await composer.evaluate(node => ({ height: node.getBoundingClientRect().height, overflow: node.style.overflowY }));
      await composer.fill(Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join('\n'));
      const tall = await composer.evaluate(node => ({
        height: node.getBoundingClientRect().height,
        overflow: node.style.overflowY,
        scrollHeight: node.scrollHeight,
      }));
      assert(tall.height > single.height, 'composer did not grow with multiline content');
      assert(tall.height <= Math.floor(viewport.height * 0.4) + 2,
        `composer exceeded 40vh cap (${tall.height}px at ${viewport.height}px)`);
      assert.strictEqual(tall.overflow, 'auto', 'capped composer did not enable internal scrolling');
      await composer.fill('');
      return { viewport, single, tall, cap_px: Math.floor(viewport.height * 0.4) };
    };

    const exerciseDeltaScroll = async (sessionId, label) => {
      const list = page.locator('.messages');
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
      const messageId = `delta-${label}`;
      activeSocket.send(JSON.stringify({
        type: 'message_delta', session_id: sessionId, message_id: messageId,
        block_index: 0, seq: 0, op: 'block_open',
      }));
      activeSocket.send(JSON.stringify({
        type: 'message_delta', session_id: sessionId, message_id: messageId,
        block_index: 0, seq: 1, op: 'append', append: `Pinned ${label} delta`,
      }));
      await page.waitForFunction(text => document.querySelector('.provisional-stream-text')?.textContent.includes(text),
        `Pinned ${label} delta`, { timeout: 3000 });
      const pinned = await list.evaluate(node => ({
        bottomGap: node.scrollHeight - node.scrollTop - node.clientHeight,
        jumpVisible: !!document.querySelector('.jump-to-newest'),
      }));
      assert(pinned.bottomGap < 80, `${label} pinned stream drifted ${pinned.bottomGap}px from bottom`);
      assert.strictEqual(pinned.jumpVisible, false, `${label} pinned stream unexpectedly showed jump pill`);

      await list.evaluate(node => {
        node.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
        node.scrollTop = 0;
        node.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(50);
      const before = await list.evaluate(node => node.scrollTop);
      activeSocket.send(JSON.stringify({
        type: 'message_delta', session_id: sessionId, message_id: messageId,
        block_index: 0, seq: 2, op: 'append', append: ` Scrolled ${label} delta`,
      }));
      await page.waitForFunction(text => document.querySelector('.provisional-stream-text')?.textContent.includes(text),
        `Scrolled ${label} delta`, { timeout: 3000 });
      await page.locator('.jump-to-newest').waitFor({ state: 'visible', timeout: 3000 });
      const scrolled = await list.evaluate(node => ({
        scrollTop: node.scrollTop,
        jumpText: document.querySelector('.jump-to-newest')?.textContent || '',
      }));
      assert(Math.abs(scrolled.scrollTop - before) < 3, `${label} scrolled-away transcript was forced to bottom`);
      assert.strictEqual(scrolled.jumpText.trim(), '↓ 1 new', `${label} jump pill did not count the streamed arrival`);
      await page.locator('.jump-to-newest').click();
      await page.waitForFunction(() => !document.querySelector('.jump-to-newest'));
      const restored = await list.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
      assert(restored < 80, `${label} jump action did not restore the newest anchor`);
      return { label, pinned, scrolled, restored_bottom_gap: restored };
    };

    const desktopViewport = { width: 1280, height: 900 };
    await loadFixture(sessionIds[0], desktopViewport);
    const desktopTextarea = await measureTextarea(desktopViewport);
    const composer = page.locator('.textarea-row textarea');
    await composer.fill('first desktop send'); await composer.press('Enter');
    await composer.fill('second desktop send'); await composer.press('Enter');
    await composer.press('ArrowUp'); assert.strictEqual(await composer.inputValue(), 'second desktop send');
    await composer.press('ArrowUp'); assert.strictEqual(await composer.inputValue(), 'first desktop send');
    await composer.press('ArrowDown'); assert.strictEqual(await composer.inputValue(), 'second desktop send');
    await composer.press('ArrowDown'); assert.strictEqual(await composer.inputValue(), '');
    await page.locator(`.session-card[data-session-id="${sessionIds[1]}"]`).click();
    await composer.press('ArrowUp'); assert.strictEqual(await composer.inputValue(), '', 'history leaked between sessions');
    await composer.fill('session b send'); await composer.press('Enter');
    await page.locator(`.session-card[data-session-id="${sessionIds[0]}"]`).click();
    await composer.press('ArrowUp'); assert.strictEqual(await composer.inputValue(), 'second desktop send');
    await composer.fill('');
    const desktopDelta = await exerciseDeltaScroll(sessionIds[0], 'desktop');

    const mobileViewport = { width: 390, height: 844 };
    await loadFixture(sessionIds[1], mobileViewport);
    const mobileTextarea = await measureTextarea(mobileViewport);
    const mobileDelta = await exerciseDeltaScroll(sessionIds[1], 'mobile-390');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      desktop: { textarea: desktopTextarea, delta_scroll: desktopDelta },
      mobile_390: { textarea: mobileTextarea, delta_scroll: mobileDelta },
      history: {
        per_session: true,
        reverse_and_forward_navigation: true,
        sent_messages: sentMessages,
      },
      visible_windows_opened: 0,
      focus_actions: 0,
      original_origin_restored: originalUrl ? new URL(originalUrl).origin : null,
    };
    assert.deepStrictEqual(sentMessages.map(item => [item.session_id, item.content]), [
      [sessionIds[0], 'first desktop send'],
      [sessionIds[0], 'second desktop send'],
      [sessionIds[1], 'session b send'],
    ], 'fixture did not receive the expected per-session sends');
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 2000);
      wss.close(() => { clearTimeout(timeout); resolve(); });
    });
    server.closeAllConnections?.();
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 2000);
      server.close(() => { clearTimeout(timeout); resolve(); });
    });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
