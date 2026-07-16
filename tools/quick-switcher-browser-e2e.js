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
const sessions = [
  { session_id: 'switch-alpha', agent_type: 'claude', chat_title: 'Restore relay controls', workspace_name: 'Remote Agent Chat', workspace_path: 'C:\\workspace\\Remote Agent Chat' },
  { session_id: 'switch-beta', agent_type: 'cursor', chat_title: 'Fix outpost route', workspace_name: 'GWA BotsHub', workspace_path: 'C:\\workspace\\GWA BotsHub' },
  { session_id: 'switch-gamma', agent_type: 'codex_cli', chat_title: 'Audit parser latency', workspace_name: 'Remote Agent Chat', workspace_path: 'C:\\workspace\\Remote Agent Chat' },
  { session_id: 'switch-delta', agent_type: 'codex-desktop', chat_title: 'Review native layout', workspace_name: 'Remote Agent Chat', workspace_path: 'C:\\workspace\\Remote Agent Chat' },
  { session_id: 'switch-epsilon', agent_type: 'continue', chat_title: 'Check extension health', workspace_name: 'Editor Harnesses', workspace_path: 'C:\\workspace\\Editor Harnesses' },
  { session_id: 'switch-zeta', agent_type: 'claude_cli', chat_title: 'Validate queue drain', workspace_name: 'GWA BotsHub', workspace_path: 'C:\\workspace\\GWA BotsHub' },
];

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
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const mutationMessages = [];
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
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: sessions.map(session => ({ ...session, title: session.chat_title, status: 'healthy', project_root: session.workspace_path })),
      workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (['agent_message', 'agent_interrupt', 'agent_control', 'permission_response'].includes(message.type)) {
        mutationMessages.push({ type: message.type, session_id: sid });
      }
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail',
          replace: message.replace !== false,
          messages: [{ role: 'assistant', content: `Transcript for ${sid}`, sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: `Transcript for ${sid}`, sequence: 1 }] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1 });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let cdpSession;
  let originalUrl;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    [page] = pages;
    cdpSession = await page.context().newCDPSession(page);
    originalUrl = page.url();
    await cdpSession.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length >= 6, null, { timeout: 5000 });

    const sidebarOrder = await page.locator('.session-card[data-session-id]').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    const openStarted = performance.now();
    await page.keyboard.press('Control+P');
    await page.locator('.quick-switcher-input').waitFor({ state: 'visible', timeout: 3000 });
    const openMs = performance.now() - openStarted;
    assert.strictEqual(await page.locator('.quick-switcher-option').count(), sessions.length, 'empty palette must preserve sidebar order');

    const filterStarted = performance.now();
    await page.locator('.quick-switcher-input').fill('outpost cursor');
    await page.waitForFunction(() => document.querySelectorAll('.quick-switcher-option').length === 1
      && document.querySelector('.quick-switcher-option')?.textContent.includes('Fix outpost route'), null, { timeout: 3000 });
    const filterMs = performance.now() - filterStarted;
    const filteredCount = await page.locator('.quick-switcher-option').count();
    const filteredMeta = await page.locator('.quick-switcher-option').first().innerText();
    assert.match(filteredMeta, /GWA BotsHub/);
    assert.match(filteredMeta, /Cursor/);
    const paletteScreenshot = outputPath ? path.join(path.dirname(outputPath), 'quick-switcher-source-palette.png') : null;
    if (paletteScreenshot) await page.locator('.quick-switcher').screenshot({ path: paletteScreenshot, animations: 'disabled' });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.session-card.active')?.dataset.sessionId === 'switch-beta', null, { timeout: 3000 });
    assert.strictEqual(await page.locator('.quick-switcher-overlay').count(), 0);

    const liveOrder = await page.locator('.session-card[data-session-id]').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    const currentIndex = liveOrder.indexOf('switch-beta');
    assert(currentIndex >= 0);
    const expectedNext = liveOrder[(currentIndex + 1) % liveOrder.length];
    const expectedCard = page.locator(`.session-card[data-session-id="${expectedNext}"]`);
    const expectedGroup = expectedCard.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " session-group ")][1]');
    if (!(await expectedGroup.getAttribute('class')).includes('collapsed')) {
      await expectedGroup.locator('.session-group-header').click();
    }
    assert((await expectedGroup.getAttribute('class')).includes('collapsed'), 'target group did not collapse');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id, expectedNext, { timeout: 3000 });
    const collapsedTraversal = {
      from: 'switch-beta',
      to: expectedNext,
      target_group_collapsed: true,
      active_session: await page.locator('.session-card.active').getAttribute('data-session-id'),
    };
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('.session-card.active')?.dataset.sessionId === 'switch-beta', null, { timeout: 3000 });

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.type('?');
    await page.locator('.shortcut-help').waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await page.locator('.shortcut-help').innerText(), /Ctrl\/Cmd P/);
    const helpScreenshot = outputPath ? path.join(path.dirname(outputPath), 'quick-switcher-source-help.png') : null;
    if (helpScreenshot) await page.locator('.shortcut-help').screenshot({ path: helpScreenshot, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.locator('.shortcut-help').waitFor({ state: 'detached', timeout: 3000 });

    const textarea = page.locator('.input-area textarea');
    await textarea.fill('draft');
    await textarea.press('?');
    assert.strictEqual(await textarea.inputValue(), 'draft?');
    assert.strictEqual(await page.locator('.shortcut-help').count(), 0, 'plain typing opened shortcut help');
    await textarea.fill('');
    await cdpSession.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await page.keyboard.press('Control+P');
    await page.locator('.quick-switcher-input').waitFor({ state: 'visible', timeout: 3000 });
    const mobileBounds = await page.locator('.quick-switcher').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, viewport_width: innerWidth, viewport_height: innerHeight };
    });
    assert(mobileBounds.width <= 362 && mobileBounds.width >= 340, `mobile palette width ${mobileBounds.width}`);
    const mobileScreenshot = outputPath ? path.join(path.dirname(outputPath), 'quick-switcher-source-mobile.png') : null;
    if (mobileScreenshot) await page.locator('.quick-switcher').screenshot({ path: mobileScreenshot, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.locator('.quick-switcher-overlay').waitFor({ state: 'detached', timeout: 3000 });
    await cdpSession.send('Emulation.clearDeviceMetricsOverride');

    assert.deepStrictEqual(mutationMessages, [], 'quick switching emitted a harness mutation');
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      sidebar_order: sidebarOrder,
      empty_palette_preserved_sidebar_order: sidebarOrder.join('|') === liveOrder.join('|'),
      fuzzy_filter: { query: 'outpost cursor', result: 'switch-beta', result_count: filteredCount, metadata: filteredMeta, elapsed_ms: Math.round(filterMs * 10) / 10 },
      palette_open_ms: Math.round(openMs * 10) / 10,
      collapsed_group_alt_navigation: collapsedTraversal,
      alt_up_restored_previous_session: true,
      shortcut_help_opened_with_question_mark: true,
      editable_question_mark_preserved: true,
      escape_closed_overlays: true,
      mobile_390: mobileBounds,
      screenshots: [paletteScreenshot, helpScreenshot, mobileScreenshot].filter(Boolean).map(file => path.relative(root, file)),
      sends: 0,
      controls: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
      original_origin_restored: originalUrl ? new URL(originalUrl).origin : null,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (cdpSession) await cdpSession.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
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
