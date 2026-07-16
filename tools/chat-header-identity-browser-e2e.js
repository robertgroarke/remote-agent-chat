#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const { findChrome } = require('./mobile-cold-load-production-e2e');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'frontend');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const outputPath = option('--output') ? path.resolve(option('--output')) : null;
const soakMs = Math.max(0, Number(option('--soak-ms', '60000')) || 0);
const screenshotTitle = 'what is the next best pass target for code review to continue to improve the code quality of the repo towards production grade maturity?';

const sessions = [
  {
    session_id: 'header-shot', agent_type: 'codex', chat_title: screenshotTitle,
    chat_title_source: 'native', workspace_name: 'Remote Agent Chat',
    workspace_path: 'C:\\workspace\\Remote Agent Chat', status: 'healthy',
  },
  {
    session_id: 'header-a', agent_type: 'claude', workspace_name: 'Remote Agent Chat',
    workspace_path: 'C:\\workspace\\Remote Agent Chat', status: 'healthy',
  },
  {
    session_id: 'header-b', agent_type: 'cursor', native_chat_title: 'B native title',
    workspace_name: 'Cursor Workspace', workspace_path: 'C:\\workspace\\Cursor Workspace', status: 'healthy',
  },
  {
    session_id: 'header-custom', agent_type: 'codex_cli', workspace_name: 'CLI Workspace',
    workspace_path: 'C:\\workspace\\CLI Workspace', status: 'healthy',
  },
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
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  })[path.extname(filePath)] || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const sockets = new Set();
  const forbiddenMessages = [];
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_ROOT, relative);
    if (!filePath.startsWith(`${path.resolve(PUBLIC_ROOT)}${path.sep}`)
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

  let connectionCount = 0;
  let weakReconnects = 0;
  let stateSeq = 0;
  const broadcast = payload => {
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    }
  };
  wss.on('connection', ws => {
    sockets.add(ws);
    connectionCount += 1;
    const epoch = `header-e2e-${connectionCount}`;
    const inventory = sessions.map(session => {
      if (weakReconnects <= 0 || session.session_id !== 'header-a') return { ...session };
      const weak = { ...session };
      for (const field of ['chat_title', 'chat_title_source', 'native_chat_title', 'session_title']) delete weak[field];
      return weak;
    });
    if (weakReconnects > 0) weakReconnects -= 1;
    ws.send(JSON.stringify({
      type: 'connection_ack', state_epoch: epoch, heartbeat_interval_ms: 1000,
      heartbeat_timeout_ms: 5000, sessions: inventory, workspaces: [],
      agent_configs: Object.fromEntries(sessions.map(session => [session.session_id, {
        session_id: session.session_id,
        branch: session.session_id === 'header-shot' ? 'master' : 'fixture',
        capabilities: { branch_list: true },
      }])),
    }));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (['send', 'agent_message', 'permission_response', 'error_prompt_action', 'agent_interrupt',
        'set_codex_config', 'agent_set_model', 'agent_set_permission_mode', 'agent_set_effort'].includes(message.type)) {
        forbiddenMessages.push({ type: message.type, session_id: sid || null });
      }
      if (message.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat_ack', request_id: message.request_id }));
      } else if (message.type === 'agent_config_request') {
        ws.send(JSON.stringify({
          type: 'agent_config', session_id: sid,
          branch: sid === 'header-shot' ? 'master' : 'fixture', capabilities: { branch_list: true },
        }));
      } else if (message.type === 'history_chunk_request') {
        ws.send(JSON.stringify({
          type: 'history_chunk', session_id: sid, request_id: message.request_id,
          source: 'fixture', mode: 'tail', replace: true,
          messages: [{ role: 'assistant', content: `Fixture transcript for ${sid}`, sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        }));
      } else if (message.type === 'get_history') {
        ws.send(JSON.stringify({
          type: 'history', session: sid, request_id: message.request_id,
          messages: [{ role: 'assistant', content: `Fixture transcript for ${sid}`, sequence: 1 }],
        }));
      } else if (message.type === 'history_request') {
        ws.send(JSON.stringify({
          type: 'history_delta', session: sid, session_id: sid,
          request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1,
        }));
      }
    });
    ws.on('close', () => sockets.delete(ws));
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  const browser = await chromium.launch({
    executablePath: findChrome(), headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__chatHeaderE2E = { cls: 0, shifts: 0, shiftSources: [] };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__chatHeaderE2E.cls += entry.value;
        window.__chatHeaderE2E.shifts += 1;
        window.__chatHeaderE2E.shiftSources.push({
          value: entry.value,
          sources: (entry.sources || []).map(source => ({
            node: source.node ? `${source.node.tagName || ''}.${source.node.className || ''}` : '',
            previous: source.previousRect ? {
              x: source.previousRect.x, y: source.previousRect.y,
              width: source.previousRect.width, height: source.previousRect.height,
            } : null,
            current: source.currentRect ? {
              x: source.currentRect.x, y: source.currentRect.y,
              width: source.currentRect.width, height: source.currentRect.height,
            } : null,
          })),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  const selectSession = async sessionId => {
    const card = page.locator(`.session-card[data-session-id="${sessionId}"]`);
    await card.waitFor({ state: 'attached', timeout: 10000 });
    await card.evaluate(node => node.click());
    await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
      sessionId, { timeout: 5000 });
  };
  const waitForTitle = async (expectedTitle, expectedSource) => {
    await page.waitForFunction(({ title, source }) => {
      const projection = document.querySelector('.topbar-title-projection');
      return projection?.dataset?.chatTitleSource === source
        && projection.querySelector('.topbar-title')?.textContent?.trim() === title;
    }, { title: expectedTitle, source: expectedSource }, { timeout: 5000 });
  };
  const sendState = payload => {
    stateSeq += 1;
    broadcast({ state_epoch: `header-e2e-${connectionCount}`, state_seq: stateSeq, ...payload });
  };

  try {
    const response = await page.goto(`http://127.0.0.1:${port}/?chat_header_identity=1`, {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
    assert.equal(response?.status(), 200);
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length === 4,
      null, { timeout: 10000 });

    await selectSession('header-shot');
    await waitForTitle(screenshotTitle.slice(0, 80), 'native');
    const screenshotShape = await page.evaluate(expected => {
      const title = document.querySelector('.topbar-title');
      const subtitle = document.querySelector('.topbar-subtitle');
      const row = document.querySelector('.topbar-title-row');
      return {
        primary: title?.textContent?.trim() || '',
        source: document.querySelector('.topbar-title-projection')?.dataset?.chatTitleSource || '',
        subtitle: subtitle?.textContent?.replace(/\s+/g, ' ').trim() || '',
        accessible_name: row?.getAttribute('aria-label') || '',
        workspace_used_as_primary: title?.textContent?.trim() === 'Remote Agent Chat',
        exact_title: title?.textContent?.trim() === expected,
      };
    }, screenshotTitle.slice(0, 80));
    assert.equal(screenshotShape.exact_title, true);
    assert.equal(screenshotShape.workspace_used_as_primary, false);
    assert.match(screenshotShape.subtitle, /Remote Agent Chat/);
    assert.match(screenshotShape.subtitle, /master/);
    assert.equal(screenshotShape.accessible_name, `Codex chat: ${screenshotTitle.slice(0, 80)}`);

    await selectSession('header-a');
    await waitForTitle('New chat', 'fallback');
    sendState({
      type: 'session_summary', session_id: 'header-a', chat_title: 'Producer summary title',
      chat_title_source: 'summary', status: 'healthy',
    });
    await waitForTitle('Producer summary title', 'summary');
    sendState({
      type: 'session_patch', session_id: 'header-a',
      patch: { native_chat_title: 'Native promoted title' },
    });
    await waitForTitle('Native promoted title', 'native');
    sendState({
      type: 'session_patch', session_id: 'header-a',
      patch: { native_chat_title: 'Native switched thread title' },
    });
    await waitForTitle('Native switched thread title', 'native');

    await selectSession('header-custom');
    await waitForTitle('New chat', 'fallback');
    sendState({
      type: 'session_patch', session_id: 'header-custom',
      patch: { custom_display_name: 'Operator custom rename' },
    });
    await waitForTitle('Operator custom rename', 'custom');

    await selectSession('header-a');
    await selectSession('header-b');
    await waitForTitle('B native title', 'native');
    sendState({
      type: 'session_patch', session_id: 'header-a',
      patch: { native_chat_title: 'Late A title must stay off B' },
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.topbar-title').innerText(), 'B native title');

    await selectSession('header-a');
    await waitForTitle('Late A title must stay off B', 'native');
    weakReconnects = 1;
    const expectedConnectionCount = connectionCount + 1;
    for (const socket of [...sockets]) socket.close(1012, 'fixture reconnect');
    const reconnectDeadline = Date.now() + 15000;
    while (connectionCount < expectedConnectionCount && Date.now() < reconnectDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(connectionCount >= expectedConnectionCount, 'fixture client did not reconnect');
    await page.waitForFunction(() => document.querySelector('.sidebar-footer')?.textContent?.includes('Relay healthy'),
      null, { timeout: 15000 });
    await waitForTitle('Late A title must stay off B', 'native');

    await page.waitForFunction(() => !document.querySelector('.toast.visible'), null, { timeout: 5000 });
    await page.locator('.input-area textarea').focus();
    const stabilityBefore = await page.evaluate(() => {
      window.__chatHeaderE2E.cls = 0;
      window.__chatHeaderE2E.shifts = 0;
      window.__chatHeaderE2E.shiftSources = [];
      window.__chatHeaderE2E.messagesNode = document.querySelector('.messages');
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        focus: document.activeElement?.tagName || '',
        scroll_top: document.querySelector('.messages')?.scrollTop || 0,
        topbar_height: topbar?.height || 0,
      };
    });
    const soakStarted = Date.now();
    const statusTimer = setInterval(() => sendState({
      type: 'status', session: 'header-a', thinking: false,
      activity: { kind: 'idle', generating: false, label: '' },
    }), 1000);
    await page.waitForTimeout(soakMs);
    clearInterval(statusTimer);
    const stabilityAfter = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        focus: document.activeElement?.tagName || '',
        scroll_top: document.querySelector('.messages')?.scrollTop || 0,
        topbar_height: topbar?.height || 0,
        messages_node_same: window.__chatHeaderE2E.messagesNode === document.querySelector('.messages'),
        cls: window.__chatHeaderE2E.cls,
        layout_shifts: window.__chatHeaderE2E.shifts,
        layout_shift_sources: window.__chatHeaderE2E.shiftSources,
      };
    });
    assert.equal(stabilityAfter.messages_node_same, true);
    assert.equal(stabilityAfter.focus, stabilityBefore.focus);
    assert.equal(stabilityAfter.scroll_top, stabilityBefore.scroll_top);
    assert.equal(stabilityAfter.topbar_height, stabilityBefore.topbar_height);
    assert.equal(stabilityAfter.cls, 0, `layout shift sources: ${JSON.stringify(stabilityAfter.layout_shift_sources)}`);

    await selectSession('header-shot');
    const captures = [];
    const captureRoot = outputPath ? path.join(path.dirname(outputPath), 'chat-header-identity-visual') : '';
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'narrow', width: 900, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of ['dark', 'light']) {
        const current = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
        if (current !== theme) await page.locator('.theme-toggle-btn').evaluate(node => node.click());
        await page.waitForFunction(expected => (
          (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark') === expected
        ), theme);
        const layout = await page.evaluate(() => {
          const title = document.querySelector('.topbar-title');
          const rect = title?.getBoundingClientRect();
          return {
            title_height: rect?.height || 0,
            title_width: rect?.width || 0,
            viewport_width: innerWidth,
            horizontal_overflow: document.body.scrollWidth > innerWidth,
          };
        });
        assert.equal(layout.horizontal_overflow, false);
        assert(layout.title_height > 0 && layout.title_height <= 24);
        const file = captureRoot ? path.join(captureRoot, `${viewport.name}-${theme}.png`) : '';
        if (file) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
        }
        captures.push({ ...viewport, theme, layout, file: file ? path.relative(ROOT, file).replace(/\\/g, '/') : null });
      }
    }
    const titleTrigger = page.locator('.topbar-title');
    await titleTrigger.focus();
    await page.locator('.topbar-title-disclosure').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('.topbar-title-disclosure').innerText(), screenshotTitle.slice(0, 80));
    const disclosure = await page.locator('.topbar-title-disclosure').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    });
    assert(disclosure.left >= 0 && disclosure.right <= 390 && disclosure.top >= 0 && disclosure.bottom <= 844);

    assert.deepStrictEqual(forbiddenMessages, []);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser: 'Google Chrome headless',
      fixture_sessions: sessions.length,
      screenshot_shape: screenshotShape,
      live_title_sequence: ['fallback', 'summary', 'native', 'native thread switch'],
      custom_rename_live: true,
      rapid_a_b_late_a_isolated: true,
      weaker_reconnect_regression_blocked: true,
      reconnect_toast_settled_before_cls_soak: true,
      soak: {
        requested_ms: soakMs,
        elapsed_ms: Date.now() - soakStarted,
        before: stabilityBefore,
        after: stabilityAfter,
      },
      visual_captures: captures,
      mobile_disclosure_bounds: disclosure,
      forbidden_messages: forbiddenMessages.length,
      user_messages_sent: 0,
      production_controls_clicked: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close().catch(() => {});
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`Chat header identity browser E2E: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
