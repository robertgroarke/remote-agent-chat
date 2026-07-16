#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');
const { WebSocketServer } = require(process.env.RAC_WS_MODULE || '../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PUBLIC_ROOT = path.join(ROOT, 'frontend');
const FLEET_CPU_PROFILE = process.env.RAC_FLEET_CPU_PROFILE || '';
const SESSION_COUNT = 69;
const MESSAGE_COUNT = 4000;
const OLDER_MESSAGE_COUNT = 100;
const SELECTED_SESSION_ID = 'p0-route-session-034';

function valueAfter(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PHASE = valueAfter('--phase', 'measurement');
const OUTPUT = valueAfter('--output') ? path.resolve(valueAfter('--output')) : '';
const PUBLIC_ROOT = path.resolve(valueAfter('--public-root', DEFAULT_PUBLIC_ROOT));
const PROFILE_REACT = process.argv.includes('--profile-react');
const VIEWPORT_WIDTH = Number(valueAfter('--width', '1440'));
const VIEWPORT_HEIGHT = Number(valueAfter('--height', '900'));
const ROUTE_ONLY = process.argv.includes('--route-only');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

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

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function fixtureSessions() {
  const base = Date.parse('2026-07-13T12:00:00Z');
  return Array.from({ length: SESSION_COUNT }, (_, index) => ({
    session_id: `p0-route-session-${String(index).padStart(3, '0')}`,
    display_name: `P0 route session ${String(index).padStart(2, '0')}`,
    chat_title: `P0 route isolation fixture ${String(index).padStart(2, '0')}`,
    agent_type: index % 3 === 0 ? 'codex_cli' : index % 3 === 1 ? 'claude_cli' : 'cursor_cli',
    status: 'healthy',
    health: 'connected',
    is_test_session: false,
    workspace_path: `${ROOT}\\fixture-${Math.floor(index / 23)}`,
    project_root: ROOT,
    last_seen_at: new Date(base - index * 1000).toISOString(),
  }));
}

function fixtureMessages() {
  const base = Date.parse('2026-07-13T12:30:00Z');
  return Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const sequence = index + 1;
    const common = {
      id: 100000 + sequence,
      server_message_id: 100000 + sequence,
      source_message_id: `p0-route-source:${sequence}`,
      sequence,
      ts: (base + sequence * 1000) / 1000,
    };
    if (index % 2 === 0) {
      return {
        ...common,
        role: 'user',
        content: `User row ${sequence}: deterministic production-shape transcript content.`,
      };
    }
    const code = index % 16 === 1
      ? `\n\n\`\`\`javascript\nconst row${sequence} = ${sequence};\nconsole.log(row${sequence});\n\`\`\``
      : '';
    const table = index % 40 === 3
      ? `\n\n| Field | Value |\n| --- | --- |\n| sequence | ${sequence} |\n| stable | yes |`
      : '';
    if (sequence === 2000) {
      return {
        ...common,
        role: 'assistant',
        content: `Assistant row ${sequence}: stable disclosure fixture.`,
        content_blocks: [{
          type: 'thinking',
          title: 'Stable disclosure fixture',
          content: `Assistant row ${sequence}: this collapsed state must survive a virtual-window unmount.`,
        }],
      };
    }
    return {
      ...common,
      role: 'assistant',
      content: `### Assistant row ${sequence}\n\nDeterministic **Markdown** content for the route/render fixture.\n\n- stable identity\n- preserved order${code}${table}`,
    };
  });
}

function fixtureOlderMessages() {
  const base = Date.parse('2026-07-13T12:00:00Z');
  return Array.from({ length: OLDER_MESSAGE_COUNT }, (_, index) => ({
    id: 90000 + index,
    server_message_id: 90000 + index,
    source_message_id: `p0-route-older-source:${index + 1}`,
    sequence: index - OLDER_MESSAGE_COUNT,
    ts: (base + index * 1000) / 1000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Older row ${index + 1}: anchor-preservation fixture.`,
  }));
}

async function browserNavigationMeasurement(page, triggerSelector, targetSelector, expectedRouteState = null) {
  return page.evaluate(async ({ triggerSelector, targetSelector, expectedRouteState }) => {
    const trigger = document.querySelector(triggerSelector);
    if (!trigger) throw new Error(`missing route trigger ${triggerSelector}`);
    const profilerStart = Array.isArray(window.__RAC_RENDER_PROFILER__)
      ? window.__RAC_RENDER_PROFILER__.length : 0;
    const longTaskStart = Array.isArray(window.__RAC_P0_ROUTE_PERF__?.longTasks)
      ? window.__RAC_P0_ROUTE_PERF__.longTasks.length : 0;
    const startedAt = performance.now();
    trigger.click();
    while (!document.querySelector(targetSelector)) {
      if (performance.now() - startedAt > 10000) throw new Error(`route timed out: ${targetSelector}`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    let routeStateRestored = expectedRouteState == null;
    if (expectedRouteState) {
      let restoredFrames = 0;
      while (performance.now() - startedAt <= 100) {
        const list = document.querySelector('.messages');
        let restoredThisFrame = false;
        if (list) {
          if (expectedRouteState.bottom_gap < 80) {
            const bottomGap = list.scrollHeight - list.scrollTop - list.clientHeight;
            restoredThisFrame = Math.abs(expectedRouteState.bottom_gap - bottomGap) <= 1;
          } else {
            const listRect = list.getBoundingClientRect();
            const row = [...list.querySelectorAll('.transcript-window-row[data-window-index]')]
              .find(candidate => candidate.querySelector('.message')?.dataset?.messageSourceId === expectedRouteState.anchor_source_id);
            restoredThisFrame = !!row
              && Math.abs((row.getBoundingClientRect().top - listRect.top) - expectedRouteState.anchor_offset_px) <= 1;
          }
        }
        restoredFrames = restoredThisFrame ? restoredFrames + 1 : 0;
        routeStateRestored = restoredFrames >= 2;
        if (routeStateRestored) break;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    } else {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return {
      elapsed_ms: Number((performance.now() - startedAt).toFixed(2)),
      route_state_restored: routeStateRestored,
      profiler_commits: Array.isArray(window.__RAC_RENDER_PROFILER__)
        ? window.__RAC_RENDER_PROFILER__.slice(profilerStart) : [],
      long_tasks: Array.isArray(window.__RAC_P0_ROUTE_PERF__?.longTasks)
        ? window.__RAC_P0_ROUTE_PERF__.longTasks.slice(longTaskStart) : [],
    };
  }, { triggerSelector, targetSelector, expectedRouteState });
}

async function captureChatRouteState(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.messages');
    if (!list) throw new Error('chat route transcript is missing');
    const listRect = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('.transcript-window-row[data-window-index]')];
    const anchor = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= listRect.top && rect.top < listRect.bottom;
    }) || rows.find(row => row.getBoundingClientRect().bottom > listRect.top) || rows[0] || null;
    const anchorMessage = anchor?.querySelector('.message[data-message-source-id]') || null;
    return {
      active_session: document.querySelector('.session-card.active')?.dataset.sessionId || null,
      scroll_top: Number(list.scrollTop.toFixed(3)),
      scroll_height: Number(list.scrollHeight.toFixed(3)),
      client_height: Number(list.clientHeight.toFixed(3)),
      bottom_gap: Number((list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(3)),
      anchor_source_id: anchorMessage?.dataset.messageSourceId || null,
      anchor_offset_px: anchor
        ? Number((anchor.getBoundingClientRect().top - listRect.top).toFixed(3))
        : null,
    };
  });
}

async function waitForStableChatRouteState(page) {
  await page.evaluate(async () => {
    const deadline = performance.now() + 5000;
    let previous = null;
    let stableFrames = 0;
    const samples = [];
    while (performance.now() < deadline && stableFrames < 3) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const list = document.querySelector('.messages');
      if (!list) throw new Error('chat route transcript is missing');
      const listRect = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.transcript-window-row[data-window-index]')];
      const row = rows.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.top >= listRect.top && rect.top < listRect.bottom;
      }) || rows.find(candidate => candidate.getBoundingClientRect().bottom > listRect.top) || rows[0] || null;
      const current = {
        sourceId: row?.querySelector('.message[data-message-source-id]')?.dataset?.messageSourceId || null,
        offset: row ? row.getBoundingClientRect().top - listRect.top : null,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
      };
      samples.push(current);
      if (samples.length > 20) samples.shift();
      stableFrames = previous
        && current.sourceId
        && current.sourceId === previous.sourceId
        && Math.abs(current.offset - previous.offset) <= 0.25
        ? stableFrames + 1
        : 0;
      previous = current;
    }
    if (stableFrames < 3) throw new Error(`chat route anchor did not stabilize before navigation: ${JSON.stringify(samples)}`);
  });
  return captureChatRouteState(page);
}

function routeScrollRestored(before, after) {
  if (before.bottom_gap < 80) return Math.abs(before.bottom_gap - after.bottom_gap) <= 1;
  return before.anchor_source_id
    && before.anchor_source_id === after.anchor_source_id
    && Math.abs(before.anchor_offset_px - after.anchor_offset_px) <= 1;
}

async function inspectTranscriptIndex(page, index, expectedSourceId) {
  const result = await page.evaluate(async ({ index, total }) => {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const list = document.querySelector('.messages');
      if (!list) throw new Error('transcript list is missing');
      if (window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex) {
        window.__RAC_TRANSCRIPT_WINDOW__.scrollToIndex(index, 'center');
      } else {
        const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
        list.scrollTop = maximum * (total <= 1 ? 0 : index / (total - 1));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selector = window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex
        ? `[data-window-index="${index}"] .message`
        : '';
      const row = selector
        ? document.querySelector(selector)
        : document.querySelectorAll('.messages .message')[index];
      if (!row) continue;
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!row.isConnected) continue;
      const rich = row.querySelector('[data-rich-content-ready]');
      if (rich && rich.dataset.richContentReady !== 'true') continue;
      return {
        source_id: row.dataset.messageSourceId || '',
        text: row.textContent || '',
        block_type: row.dataset.messageBlockType || '',
      };
    }
    throw new Error(`timed out inspecting transcript index ${index}`);
  }, { index, total: MESSAGE_COUNT });
  assert.strictEqual(result.source_id, expectedSourceId, `unexpected source identity at index ${index}`);
  assert(result.text.includes(`row ${index + 1}`), `transcript content missing at index ${index}`);
  return result;
}

async function exerciseDisclosurePersistence(page) {
  const index = 1999;
  await inspectTranscriptIndex(page, index, 'p0-route-source:2000');
  await page.waitForFunction(targetIndex => {
    window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex(targetIndex, 'center');
    return !!document.querySelector(`[data-window-index="${targetIndex}"] details.content-block-thinking`);
  }, index, { polling: 'raf', timeout: 30000 });
  const details = page.locator(`[data-window-index="${index}"] details.content-block-thinking`);
  const summary = details.locator('summary');
  await details.waitFor({ state: 'visible', timeout: 30000 });
  assert.strictEqual(await details.getAttribute('open') !== null, true, 'fixture disclosure should begin open');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(targetIndex => {
    const node = document.querySelector(`[data-window-index="${targetIndex}"] details.content-block-thinking`);
    return !!node && !node.open;
  }, index, { timeout: 10000 });
  const keyboardFocused = await summary.evaluate(node => document.activeElement === node);
  await page.evaluate(() => window.__RAC_TRANSCRIPT_WINDOW__.scrollToIndex(0, 'center'));
  await page.waitForFunction(targetIndex => !document.querySelector(`[data-window-index="${targetIndex}"]`), index, { timeout: 10000 });
  await page.waitForFunction(targetIndex => {
    window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex(targetIndex, 'center');
    const node = document.querySelector(`[data-window-index="${targetIndex}"] details.content-block-thinking`);
    return !!node && !node.open;
  }, index, { polling: 'raf', timeout: 30000 });
  return { keyboard_focused: keyboardFocused, collapsed_after_remount: true };
}

async function exerciseSearchJump(page) {
  await page.locator('[aria-label="Search all transcripts"]').evaluate(button => button.click());
  await page.locator('[data-testid="transcript-search-view"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('input[placeholder="Words from any conversation"]').fill('stable disclosure');
  await page.locator('.transcript-search-submit').click();
  const result = page.locator('.transcript-search-result');
  await result.waitFor({ state: 'visible', timeout: 10000 });
  await result.click();
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-message-id="102000"]');
    return !!row && row.classList.contains('search-match');
  }, null, { timeout: 30000 });
  return page.evaluate(() => {
    const row = document.querySelector('[data-message-id="102000"]');
    return {
      source_id: row?.dataset.messageSourceId || '',
      highlighted: !!row?.classList.contains('search-match'),
      window_index: Number(row?.closest('[data-window-index]')?.dataset.windowIndex || -1),
    };
  });
}

async function exerciseOlderHistoryAnchor(page) {
  const sourceId = 'p0-route-source:1';
  await page.waitForFunction(id => {
    window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex(0, 'start');
    document.querySelector('.messages').scrollTop = 0;
    return !!document.querySelector(`[data-message-source-id="${id}"]`);
  }, sourceId, { polling: 'raf', timeout: 30000 });
  await page.waitForTimeout(1600);
  const before = await page.evaluate(id => {
    const list = document.querySelector('.messages');
    list.scrollTop = 200;
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    list.dispatchEvent(new Event('scroll'));
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
    const row = document.querySelector(`[data-message-source-id="${id}"]`);
    if (!row || list.scrollTop > 1) throw new Error('older-history anchor row is not at the top');
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (!(rowRect.bottom > listRect.top && rowRect.top < listRect.bottom)) {
      throw new Error('older-history anchor row is not visible');
    }
    const snapshot = { top: rowRect.top - listRect.top, scroll_top: list.scrollTop };
    document.querySelector('.history-tail-banner button').click();
    return snapshot;
  }, sourceId);
  try {
    await page.waitForFunction(expected => Number(document.querySelector('.messages')?.dataset.totalMessageCount || 0) === expected, MESSAGE_COUNT + OLDER_MESSAGE_COUNT, { timeout: 30000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      total_message_count: Number(document.querySelector('.messages')?.dataset.totalMessageCount || 0),
      window_start: Number(document.querySelector('.messages')?.dataset.windowStart || -1),
      window_end: Number(document.querySelector('.messages')?.dataset.windowEnd || -1),
      mounted_rows: document.querySelectorAll('.message').length,
      banner_text: document.querySelector('.history-tail-banner')?.textContent?.trim() || '',
      button_disabled: !!document.querySelector('.history-tail-banner button')?.disabled,
    }));
    throw new Error(`older-history total timeout: ${JSON.stringify(diagnostic)} (${error.message})`);
  }
  const anchorSamples = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    anchorSamples.push(await page.evaluate(id => {
      const list = document.querySelector('.messages');
      const row = document.querySelector(`[data-message-source-id="${id}"]`);
      return {
        row: !!row,
        top: row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top : null,
        scroll_top: list.scrollTop,
        window_start: Number(list.dataset.windowStart || -1),
        window_end: Number(list.dataset.windowEnd || -1),
      };
    }, sourceId));
    await page.waitForTimeout(50);
  }
  const after = anchorSamples[anchorSamples.length - 1];
  if (!after.row) throw new Error(`older-history anchor disappeared: ${JSON.stringify(anchorSamples)}`);
  return {
    total_rows_after: MESSAGE_COUNT + OLDER_MESSAGE_COUNT,
    anchor_source_id: sourceId,
    anchor_delta_px: Number((after.top - before.top).toFixed(2)),
    scroll_delta_px: Number((after.scroll_top - before.scroll_top).toFixed(2)),
    anchor_samples: anchorSamples,
  };
}

async function main() {
  const sessions = fixtureSessions();
  const messages = fixtureMessages();
  const olderMessages = fixtureOlderMessages();
  const port = await freePort();
  let historySentEpochMs = 0;
  let historyResponses = 0;
  let aroundHistoryResponses = 0;
  let olderHistoryResponses = 0;
  const clientMessageTypes = [];

  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/search/messages')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        index: { ready: true },
        results: [{
          session_id: SELECTED_SESSION_ID,
          message_id: 102000,
          workspace_name: 'P0 route fixture',
          project_root: ROOT,
          agent_type: 'claude_cli',
          role: 'assistant',
          snippet: 'Stable disclosure fixture row 2000',
          matched_at: '2026-07-13T13:03:20Z',
        }],
      }));
      return;
    }
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{},"settings":{}}');
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
    if (relative === 'index.html' && PROFILE_REACT) {
      // The production React UMD intentionally disables Profiler callbacks. This
      // diagnostic fixture swaps only the ReactDOM runtime for its official
      // profiling build; the application bundle under test remains byte-for-byte
      // the production bundle.
      const diagnosticIndex = fs.readFileSync(filePath, 'utf8').replace(
        /<script src="https:\/\/unpkg\.com\/react-dom@18\/umd\/react-dom\.production\.min\.js"[^>]*><\/script>/,
        '<script src="https://unpkg.com/react-dom@18/umd/react-dom.profiling.min.js" crossorigin="anonymous"></script>',
      );
      response.end(diagnosticIndex);
      return;
    }
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
      type: 'connection_ack', protocol_version: 1, heartbeat_interval_ms: 1000,
      sessions, workspaces: [],
    });
    send({ type: 'session_list', protocol_version: 1, sessions, workspaces: [] });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientMessageTypes.push(`${message.type}:${message.mode || ''}:${message.source || ''}`);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'subscribe') {
        send({ type: 'subscription_ack', request_id: message.request_id, sessions: [SELECTED_SESSION_ID] });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: message.session_id || message.session, capabilities: {} });
      } else if (message.type === 'history_chunk_request' && message.mode === 'around') {
        aroundHistoryResponses += 1;
        send({
          type: 'history_chunk', protocol_version: 1,
          session: SELECTED_SESSION_ID, session_id: SELECTED_SESSION_ID,
          request_id: message.request_id, source: message.source, mode: 'around',
          replace: false, messages: [messages[1999]], partial: false, complete: true,
          total_messages: messages.length + olderMessages.length,
          loaded_messages: 1,
          cursor: { start_offset: 1999000, end_offset: 2000000, total_bytes: 4100000, next_before_offset: 100000 },
        });
      } else if (message.type === 'history_chunk_request' && message.mode === 'older') {
        olderHistoryResponses += 1;
        send({
          type: 'history_chunk', protocol_version: 1,
          session: SELECTED_SESSION_ID, session_id: SELECTED_SESSION_ID,
          request_id: message.request_id, source: message.source, mode: 'older',
          replace: false, messages: olderMessages, partial: false, complete: true,
          total_messages: messages.length + olderMessages.length,
          loaded_messages: messages.length + olderMessages.length,
          cursor: { start_offset: 0, end_offset: 4000000, total_bytes: 4100000, next_before_offset: null },
        });
      } else if (message.type === 'history_chunk_request') {
        historyResponses += 1;
        if (!historySentEpochMs) historySentEpochMs = Date.now();
        send({
          type: 'history_chunk', protocol_version: 1,
          session: SELECTED_SESSION_ID, session_id: SELECTED_SESSION_ID,
          request_id: message.request_id, source: message.source, mode: 'tail',
          replace: true, messages, partial: true, complete: false,
          total_messages: messages.length + olderMessages.length, loaded_messages: messages.length,
          fixture_sent_epoch_ms: historySentEpochMs,
          cursor: { start_offset: 100000, end_offset: 4000000, total_bytes: 4100000, next_before_offset: 100000 },
        });
      } else if (message.type === 'history_request') {
        send({
          type: 'history_delta', session: SELECTED_SESSION_ID, session_id: SELECTED_SESSION_ID,
          request_id: message.request_id, messages: [], after_sequence: message.after_sequence,
          loaded_messages: 0, total_messages: messages.length,
        });
      }
    });
  });

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    ],
  });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      colorScheme: 'dark',
    });
    await context.addInitScript(expectedCount => {
      window.__RAC_P0_ROUTE_PERF__ = {
        longTasks: [],
        rowPaintEpochMs: 0,
      };
      if (typeof PerformanceObserver === 'function') {
        try {
          const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              window.__RAC_P0_ROUTE_PERF__.longTasks.push({
                start: entry.startTime,
                duration: entry.duration,
              });
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {}
      }
      const mutationObserver = new MutationObserver(() => {
        if (window.__RAC_P0_ROUTE_PERF__.rowPaintEpochMs) return;
        const list = document.querySelector('.messages');
        const mountedRows = document.querySelectorAll('.messages .message').length;
        const totalRows = Number(list?.dataset?.totalMessageCount || mountedRows);
        if (totalRows !== expectedCount || mountedRows === 0) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__RAC_P0_ROUTE_PERF__.rowPaintEpochMs = performance.timeOrigin + performance.now();
        }));
      });
      const startMutationObserver = () => {
        if (!document.documentElement) return false;
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
        return true;
      };
      if (!startMutationObserver()) {
        document.addEventListener('readystatechange', startMutationObserver, { once: true });
      }
    }, MESSAGE_COUNT);
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    await page.goto(`http://127.0.0.1:${port}/?session=${encodeURIComponent(SELECTED_SESSION_ID)}&render_profile=1`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForFunction(count => document.querySelectorAll('.session-card[data-session-id]').length === count, SESSION_COUNT, { timeout: 30000 });
    await page.waitForFunction(count => {
      const list = document.querySelector('.messages');
      const mounted = document.querySelectorAll('.messages .message').length;
      return Number(list?.dataset?.totalMessageCount || mounted) === count && mounted > 0;
    }, MESSAGE_COUNT, { timeout: 60000 });
    await page.waitForFunction(() => window.__RAC_P0_ROUTE_PERF__?.rowPaintEpochMs > 0, null, { timeout: 60000 });
    await page.waitForTimeout(100);

    const initial = await page.evaluate(({ expectedCount, sentEpochMs }) => {
      const rows = [...document.querySelectorAll('.messages .message')];
      const list = document.querySelector('.messages');
      const ready = document.querySelectorAll('[data-rich-content-ready="true"]').length;
      const deferred = document.querySelectorAll('[data-rich-content-ready="false"]').length;
      const perf = window.__RAC_P0_ROUTE_PERF__;
      const requestStart = sentEpochMs - performance.timeOrigin;
      const relevantLongTasks = perf.longTasks.filter(entry => entry.start >= requestStart);
      return {
        mounted_rows: rows.length,
        total_rows: Number(list?.dataset?.totalMessageCount || rows.length),
        windowed: list?.dataset?.transcriptWindowed === 'true',
        window_start: Number(list?.dataset?.windowStart || 0),
        window_end: Number(list?.dataset?.windowEnd || rows.length),
        rich_content_ready: ready,
        rich_content_deferred: deferred,
        history_to_rows_painted_ms: Number((perf.rowPaintEpochMs - sentEpochMs).toFixed(2)),
        long_task_count: relevantLongTasks.length,
        long_task_total_ms: Number(relevantLongTasks.reduce((sum, entry) => sum + entry.duration, 0).toFixed(2)),
        long_task_max_ms: Number(Math.max(0, ...relevantLongTasks.map(entry => entry.duration)).toFixed(2)),
        first_mounted_identity: rows[0]?.dataset?.messageSourceId || '',
        last_mounted_identity: rows[rows.length - 1]?.dataset?.messageSourceId || '',
        first_mounted_text: rows[0]?.textContent || '',
        last_text: rows[rows.length - 1]?.textContent || '',
        profiler_commits: Array.isArray(window.__RAC_RENDER_PROFILER__) ? window.__RAC_RENDER_PROFILER__ : [],
      };
    }, { expectedCount: MESSAGE_COUNT, sentEpochMs: historySentEpochMs });

    const fidelityBeforeRoutes = {
      first: await inspectTranscriptIndex(page, 0, 'p0-route-source:1'),
      middle: await inspectTranscriptIndex(page, 1999, 'p0-route-source:2000'),
      last: await inspectTranscriptIndex(page, MESSAGE_COUNT - 1, `p0-route-source:${MESSAGE_COUNT}`),
    };
    const disclosure = await exerciseDisclosurePersistence(page);

    const route = {};
    const routeProfiles = {};
    const routeState = {};
    routeState.before_fleet = await waitForStableChatRouteState(page);
    if (FLEET_CPU_PROFILE) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    const fleetOpen = await browserNavigationMeasurement(page, '[aria-label="Fleet view"]', '[data-testid="fleet-view"]');
    if (FLEET_CPU_PROFILE) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.mkdirSync(path.dirname(path.resolve(FLEET_CPU_PROFILE)), { recursive: true });
      fs.writeFileSync(path.resolve(FLEET_CPU_PROFILE), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
      await cdp.send('Profiler.disable');
    }
    route.fleet_open_ms = fleetOpen.elapsed_ms;
    routeProfiles.fleet_open = { profiler_commits: fleetOpen.profiler_commits, long_tasks: fleetOpen.long_tasks };
    const fleetBack = await browserNavigationMeasurement(page, '[data-testid="fleet-view"] .automations-back', '.messages', routeState.before_fleet);
    route.fleet_back_ms = fleetBack.elapsed_ms;
    routeProfiles.fleet_back = { profiler_commits: fleetBack.profiler_commits, long_tasks: fleetBack.long_tasks };
    await page.waitForFunction(count => {
      const mounted = document.querySelectorAll('.messages .message').length;
      return Number(document.querySelector('.messages')?.dataset?.totalMessageCount || mounted) === count;
    }, MESSAGE_COUNT, { timeout: 60000 });
    routeState.after_fleet = await captureChatRouteState(page);
    routeState.before_usage = routeState.after_fleet;
    const usageOpen = await browserNavigationMeasurement(page, '[aria-label="Usage and limits"]', '[data-testid="usage-dashboard"]');
    route.usage_open_ms = usageOpen.elapsed_ms;
    routeProfiles.usage_open = { profiler_commits: usageOpen.profiler_commits, long_tasks: usageOpen.long_tasks };
    const usageBack = await browserNavigationMeasurement(page, '[data-testid="usage-dashboard"] .automations-back', '.messages', routeState.before_usage);
    route.usage_back_ms = usageBack.elapsed_ms;
    routeProfiles.usage_back = { profiler_commits: usageBack.profiler_commits, long_tasks: usageBack.long_tasks };
    await page.waitForFunction(count => {
      const mounted = document.querySelectorAll('.messages .message').length;
      return Number(document.querySelector('.messages')?.dataset?.totalMessageCount || mounted) === count;
    }, MESSAGE_COUNT, { timeout: 60000 });
    routeState.after_usage = await captureChatRouteState(page);
    if (ROUTE_ONLY) {
      const routeStateGate = routeState.before_fleet.active_session === routeState.after_fleet.active_session
        && routeState.before_usage.active_session === routeState.after_usage.active_session
        && routeScrollRestored(routeState.before_fleet, routeState.after_fleet)
        && routeScrollRestored(routeState.before_usage, routeState.after_usage);
      const routeOnlyResult = {
        ok: routeStateGate && Object.values(route).every(value => value <= 100),
        generated_at: new Date().toISOString(),
        phase: PHASE,
        fixture: { sessions: SESSION_COUNT, messages: MESSAGE_COUNT, viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } },
        route,
        route_state: { ...routeState, restored: routeStateGate },
      };
      const serialized = `${JSON.stringify(routeOnlyResult, null, 2)}\n`;
      if (OUTPUT) {
        fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
        fs.writeFileSync(OUTPUT, serialized, 'utf8');
      }
      process.stdout.write(serialized);
      assert(routeOnlyResult.ok, 'route-only performance/state gate failed');
      return;
    }
    const scroll = await page.evaluate(async expectedCount => {
      const list = document.querySelector('.messages');
      const steadyStartedAt = performance.now();
      const samples = [];
      const positions = [];
      const frameCount = 480;
      let previous = performance.now();
      for (let frame = 0; frame < frameCount; frame += 1) {
        await new Promise(resolve => requestAnimationFrame(now => {
          samples.push(now - previous);
          previous = now;
          const progress = frame < frameCount / 2
            ? 1 - (frame / (frameCount / 2))
            : (frame - frameCount / 2) / (frameCount / 2);
          list.scrollTop = (list.scrollHeight - list.clientHeight) * progress;
          positions.push(list.scrollTop);
          resolve();
        }));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 50));
      const rows = [...document.querySelectorAll('.messages .message')];
      const listAfter = document.querySelector('.messages');
      const steadyLongTasks = (window.__RAC_P0_ROUTE_PERF__?.longTasks || [])
        .filter(entry => entry.start >= steadyStartedAt);
      return {
        samples: samples.slice(2),
        mounted_rows_after: rows.length,
        total_rows_after: Number(listAfter?.dataset?.totalMessageCount || rows.length),
        window_start_after: Number(listAfter?.dataset?.windowStart || 0),
        window_end_after: Number(listAfter?.dataset?.windowEnd || rows.length),
        rich_content_ready_after: document.querySelectorAll('[data-rich-content-ready="true"]').length,
        rich_content_deferred_after: document.querySelectorAll('[data-rich-content-ready="false"]').length,
        final_scroll_top: list.scrollTop,
        scroll_height: list.scrollHeight,
        steady_long_task_count: steadyLongTasks.length,
        steady_long_task_total_ms: Number(steadyLongTasks.reduce((sum, entry) => sum + entry.duration, 0).toFixed(2)),
        steady_long_task_max_ms: Number(Math.max(0, ...steadyLongTasks.map(entry => entry.duration)).toFixed(2)),
      };
    }, MESSAGE_COUNT);
    const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const taskMetrics = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(taskMetrics.metrics.map(metric => [metric.name, metric.value]));
    const frameSamples = scroll.samples;
    delete scroll.samples;
    const fidelityAfterScroll = {
      first: await inspectTranscriptIndex(page, 0, 'p0-route-source:1'),
      middle: await inspectTranscriptIndex(page, 1999, 'p0-route-source:2000'),
      last: await inspectTranscriptIndex(page, MESSAGE_COUNT - 1, `p0-route-source:${MESSAGE_COUNT}`),
    };
    const olderHistory = await exerciseOlderHistoryAnchor(page);
    const search = await exerciseSearchJump(page);

    const refreshIntervalMs = 1000 / 60;
    const deliveredFrameSamples = frameSamples.map(sample => (
      Math.max(1, Math.round(sample / refreshIntervalMs)) * refreshIntervalMs
    ));
    const scrollMetrics = {
      ...scroll,
      sample_count: frameSamples.length,
      measurement: '60hz-vsync-normalized; raw rAF intervals retained below',
      p50_frame_ms: Number(percentile(deliveredFrameSamples, 0.50).toFixed(2)),
      p95_frame_ms: Number(percentile(deliveredFrameSamples, 0.95).toFixed(2)),
      p99_frame_ms: Number(percentile(deliveredFrameSamples, 0.99).toFixed(2)),
      max_frame_ms: Number(Math.max(...deliveredFrameSamples).toFixed(2)),
      raw_raf_p50_ms: Number(percentile(frameSamples, 0.50).toFixed(2)),
      raw_raf_p95_ms: Number(percentile(frameSamples, 0.95).toFixed(2)),
      raw_raf_p99_ms: Number(percentile(frameSamples, 0.99).toFixed(2)),
      raw_raf_max_ms: Number(Math.max(...frameSamples).toFixed(2)),
      missed_vsync_count: deliveredFrameSamples.filter(value => value > refreshIntervalMs * 1.01).length,
      frames_over_50ms: frameSamples.filter(value => value > 50).length,
    };
    const routeGate = Object.values(route).every(value => value <= 100);
    const routeStateGate = routeState.before_fleet.active_session === routeState.after_fleet.active_session
      && routeState.before_usage.active_session === routeState.after_usage.active_session
      && routeScrollRestored(routeState.before_fleet, routeState.after_fleet)
      && routeScrollRestored(routeState.before_usage, routeState.after_usage);
    const result = {
      ok: initial.total_rows === MESSAGE_COUNT
        && initial.mounted_rows <= MESSAGE_COUNT / 20
        && initial.history_to_rows_painted_ms <= 500
        && (PROFILE_REACT ? initial.profiler_commits.length > 0 : scrollMetrics.steady_long_task_count === 0)
        && scroll.total_rows_after === MESSAGE_COUNT
        && scrollMetrics.p95_frame_ms <= 16.7
        && routeGate
        && routeStateGate
        && disclosure.keyboard_focused
        && disclosure.collapsed_after_remount
        && search.source_id === 'p0-route-source:2000'
        && search.highlighted
        && search.window_index >= 0
        && olderHistory.total_rows_after === MESSAGE_COUNT + OLDER_MESSAGE_COUNT
        && Math.abs(olderHistory.anchor_delta_px) <= 1
        && fidelityBeforeRoutes.first.source_id === fidelityAfterScroll.first.source_id
        && fidelityBeforeRoutes.middle.source_id === fidelityAfterScroll.middle.source_id
        && fidelityBeforeRoutes.last.source_id === fidelityAfterScroll.last.source_id,
      generated_at: new Date().toISOString(),
      phase: PHASE,
      fixture: {
        sessions: SESSION_COUNT,
        messages: MESSAGE_COUNT,
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        selected_session: SELECTED_SESSION_ID,
        history_responses: historyResponses,
        around_history_responses: aroundHistoryResponses,
        older_history_responses: olderHistoryResponses,
        headless: true,
        react_runtime: PROFILE_REACT ? 'profiling-diagnostic' : 'production',
        os_windows_opened: 0,
        focus_actions: 0,
      },
      initial,
      fidelity_before_routes: fidelityBeforeRoutes,
      disclosure,
      route,
      route_state: {
        ...routeState,
        restored: routeStateGate,
      },
      route_profiles: routeProfiles,
      search,
      scroll: scrollMetrics,
      fidelity_after_scroll: fidelityAfterScroll,
      older_history: olderHistory,
      browser: {
        heap_before_bytes: heapBefore,
        heap_after_bytes: heapAfter,
        heap_delta_bytes: heapAfter - heapBefore,
        task_duration_seconds: metrics.TaskDuration || 0,
        script_duration_seconds: metrics.ScriptDuration || 0,
        layout_duration_seconds: metrics.LayoutDuration || 0,
      },
      client_message_types: clientMessageTypes,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (OUTPUT) {
      fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
      fs.writeFileSync(OUTPUT, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    assert(result.ok, '4,000-message route/render production gate failed');
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(`P0 route/render E2E: FAIL (${error.stack || error.message || error})`);
  process.exitCode = 1;
});
