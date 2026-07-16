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
  { session_id: 'native-status-claude', agent_type: 'claude', display_name: 'Claude native status' },
  { session_id: 'native-status-codex', agent_type: 'codex', display_name: 'Codex native status' },
  { session_id: 'native-status-cursor', agent_type: 'cursor', display_name: 'Cursor native status' },
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
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  let activeSocket;
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
      sessions: sessions.map(session => ({ ...session, title: session.display_name, status: 'healthy', workspace_path: root, project_root: root })),
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
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture',
          mode: 'tail', replace: message.replace !== false,
          messages: [{ role: 'assistant', content: `Status fixture ${sid}`, sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: `Status fixture ${sid}`, sequence: 1 }] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1 });
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
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.session-card[data-session-id="native-status-claude"]').waitFor({ state: 'visible', timeout: 5000 });

    const since = new Date().toISOString();
    const statuses = [
      ['native-status-claude', { kind: 'thinking', label: 'Wrangling…', thinking: { label: 'Wrangling…', text: 'Checking native structure.', since } }],
      ['native-status-codex', { kind: 'thinking', label: 'Thinking', thinking: { label: 'Thinking', text: 'Checking the current step.', since }, step: { state: 'in_progress', current: 2, total: 4, added: 8, deleted: 2 } }],
      ['native-status-cursor', { kind: 'thinking', label: 'Generating…', thinking: { label: 'Generating…', text: 'Building the response.', since } }],
    ];
    for (const [sessionId, activity] of statuses) {
      activeSocket.send(JSON.stringify({ type: 'status', session: sessionId, session_id: sessionId, thinking: true, activity }));
    }
    for (const [sessionId, activity] of statuses) {
      await page.waitForFunction(({ id, label }) => {
        const card = document.querySelector(`.session-card[data-session-id="${id}"]`);
        return card && card.querySelector('.session-card-sub')?.textContent.includes(label);
      }, { id: sessionId, label: activity.label }, { timeout: 5000 });
    }

    const inspect = async (sessionId, spinnerClass, label) => {
      await page.locator(`.session-card[data-session-id="${sessionId}"]`).evaluate(node => node.click());
      await page.waitForFunction(({ cls, expected }) => {
        const spinner = document.querySelector(`.live-thinking-row .native-activity-spinner.${cls}`);
        const text = document.querySelector('.live-thinking-row .live-status-label')?.textContent || '';
        return !!spinner && text.includes(expected);
      }, { cls: spinnerClass, expected: label }, { timeout: 5000 });
      return page.evaluate(({ cls, expected }) => {
        const liveSpinner = document.querySelector(`.live-thinking-row .native-activity-spinner.${cls}`);
        const cardSpinner = document.querySelector(`.session-card.active .native-activity-spinner.${cls}`);
        return {
          session_id: document.querySelector('.session-card.active')?.dataset.sessionId,
          label: document.querySelector('.live-thinking-row .live-status-label')?.textContent || '',
          live_spinner: !!liveSpinner,
          card_spinner: !!cardSpinner,
          card_static: cardSpinner?.classList.contains('static') || false,
          cursor_dots: liveSpinner?.querySelectorAll('i').length || 0,
          animation_name: liveSpinner ? getComputedStyle(liveSpinner.matches('i') ? liveSpinner : (liveSpinner.querySelector('i') || liveSpinner)).animationName : '',
          card_animation_name: cardSpinner ? getComputedStyle(cardSpinner.querySelector('i') || cardSpinner).animationName : '',
          expected,
        };
      }, { cls: spinnerClass, expected: label });
    };

    const claude = await inspect('native-status-claude', 'claude', 'Wrangling…');
    const codex = await inspect('native-status-codex', 'codex', 'Thinking');
    const codexStep = await page.locator('.live-step-chip').innerText();
    assert.match(codexStep, /Step 2 \/ 4/);
    assert(await page.locator('.live-step-chip .native-activity-spinner.codex').count(), 'Codex step chip lacks native spinner');
    const cursor = await inspect('native-status-cursor', 'cursor', 'Generating…');
    assert.strictEqual(cursor.cursor_dots, 3, 'Cursor live spinner must contain three dots');
    for (const row of [claude, codex, cursor]) {
      assert(row.live_spinner && row.card_spinner, `${row.session_id} missing native live/card spinner`);
      assert(row.card_static, `${row.session_id} card spinner must use the static at-scale variant`);
      assert.strictEqual(row.card_animation_name, 'none', `${row.session_id} card spinner must not consume steady-state animation CPU`);
    }

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      claude,
      codex: { ...codex, step_chip: codexStep },
      cursor,
      vocabulary_pass_through: true,
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
