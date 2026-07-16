#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'frontend');
const SESSION_ID = 'timestamp-built-fixture';
const OUTPUT_ARG = process.argv.indexOf('--output-dir');
const OUTPUT_DIR = OUTPUT_ARG >= 0 && process.argv[OUTPUT_ARG + 1]
  ? path.resolve(process.argv[OUTPUT_ARG + 1])
  : null;

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

function fixtureRows() {
  const base = Date.parse('2024-07-03T09:46:40.125Z');
  return Array.from({ length: 39 }, (_, index) => {
    const sequence = index + 1;
    const role = sequence % 3 === 0 ? 'user' : 'assistant';
    const instantMs = base + sequence * 61_000;
    const row = {
      id: 10_000 + sequence,
      server_message_id: 10_000 + sequence,
      source_message_id: `timestamp-fixture:${sequence}`,
      sequence,
      role,
      content: `Timestamp fixture row ${sequence}. ${'Stable transcript content. '.repeat(8)}`,
    };
    if (sequence === 7) return row; // Honest unknown legacy timestamp.
    if (sequence === 8) return { ...row, timestamp: 'malformed', ts: instantMs / 1000 };
    if (sequence % 3 === 0) return { ...row, created_at: new Date(instantMs).toISOString() };
    if (sequence % 3 === 1) return { ...row, timestamp: new Date(instantMs).toISOString() };
    return { ...row, ts: instantMs / 1000 };
  }).map((row, index) => index === 20 ? {
    ...row,
    content: 'One top-level message owns these nested blocks.',
    content_blocks: [
      { type: 'markdown', text: 'Prose before the command.' },
      { type: 'tool_call', tool: 'shell_command', input: { command: 'Write-Output timestamp-fixture' } },
      { type: 'tool_result', tool: 'shell_command', output: 'timestamp-fixture' },
      { type: 'file_changes', files: [{ path: 'fixture.txt', change: 'modified' }] },
      { type: 'markdown', text: 'Prose after the command.' },
    ],
  } : row);
}

async function main() {
  const allRows = fixtureRows();
  const olderRows = allRows.slice(0, 3);
  const tailRows = allRows.slice(3);
  const port = await freePort();
  let activeSocket = null;
  let sentMessage = null;
  let olderRequests = 0;
  const clientMessageTypes = [];

  const server = http.createServer((request, response) => {
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
    const sessions = [{
      session_id: SESSION_ID,
      title: 'Timestamp built fixture',
      display_name: 'Timestamp built fixture',
      chat_title: 'Timestamp built fixture',
      agent_type: 'codex_cli',
      status: 'healthy',
      health: 'connected',
      is_test_session: false,
      workspace_path: ROOT,
      project_root: ROOT,
    }];
    send({
      type: 'connection_ack', protocol_version: 1, heartbeat_interval_ms: 1000,
      sessions,
      workspaces: [],
    });
    send({ type: 'session_list', protocol_version: 1, sessions, workspaces: [] });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientMessageTypes.push(`${message.type}:${message.mode || ''}:${message.source || ''}`);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'subscribe') {
        send({ type: 'subscription_ack', request_id: message.request_id, sessions: [SESSION_ID] });
        send({ type: 'session_list', protocol_version: 1, sessions, workspaces: [] });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: SESSION_ID, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        if (message.mode === 'older') {
          olderRequests += 1;
          send({
            type: 'history_chunk', session: SESSION_ID, session_id: SESSION_ID,
            request_id: message.request_id, source: message.source, mode: 'older',
            replace: false, messages: olderRows, partial: true,
            total_messages: 100, loaded_messages: allRows.length,
            cursor: { next_before_id: olderRows[0].id - 1 },
          });
        } else {
          send({
            type: 'history_chunk', session: SESSION_ID, session_id: SESSION_ID,
            request_id: message.request_id, source: message.source, mode: 'tail',
            replace: true, messages: tailRows, partial: true,
            total_messages: allRows.length, loaded_messages: tailRows.length,
            cursor: { next_before_id: olderRows[olderRows.length - 1].id },
          });
        }
      } else if (message.type === 'history_request') {
        send({
          type: 'history_delta', session: SESSION_ID, session_id: SESSION_ID,
          request_id: message.request_id, messages: [], after_sequence: message.after_sequence,
          loaded_messages: 0, total_messages: tailRows.length,
        });
      } else if (message.type === 'send') {
        sentMessage = message;
        send({
          type: 'message_accepted', session: SESSION_ID,
          client_message_id: message.client_message_id,
          created_at: message.created_at,
          ts: Date.parse(message.created_at) / 1000,
        });
        setTimeout(() => send({
          type: 'message', session: SESSION_ID, role: 'user', content: message.content,
          client_message_id: message.client_message_id,
          server_message_id: 20_001, sequence: 41,
          source_message_id: 'timestamp-fixture:optimistic-settled',
          created_at: message.created_at,
          ts: Date.parse(message.created_at) / 1000,
        }), 20);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking'],
  });
  const scenarios = [
    { name: 'dark-desktop', theme: 'dark', viewport: { width: 1280, height: 900 } },
    { name: 'light-desktop', theme: 'light', viewport: { width: 1280, height: 900 } },
    { name: 'dark-mobile-390', theme: 'dark', viewport: { width: 390, height: 844 } },
    { name: 'light-mobile-390', theme: 'light', viewport: { width: 390, height: 844 } },
  ];
  const results = [];
  try {
    for (const scenario of scenarios) {
      sentMessage = null;
      olderRequests = 0;
      const context = await browser.newContext({ viewport: scenario.viewport, colorScheme: scenario.theme });
      await context.addInitScript((theme) => {
        localStorage.setItem('remote-agent-chat-theme', theme);
        window.__timestampLayoutShifts = [];
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__timestampLayoutShifts.push({
              value: entry.value,
              transcript: (entry.sources || []).some(source => source.node?.closest?.('.messages')),
              sources: (entry.sources || []).map(source => ({
                tag: source.node?.tagName || null,
                className: source.node?.className || null,
                previousRect: source.previousRect?.toJSON?.() || null,
                currentRect: source.currentRect?.toJSON?.() || null,
              })),
            });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, scenario.theme);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
      await page.goto(`http://127.0.0.1:${port}/?session=${SESSION_ID}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      try {
        await page.waitForFunction(() => document.querySelectorAll('.messages .message.transcript-virtual-row').length === 36,
          null, { timeout: 10_000 });
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          rows: document.querySelectorAll('.messages .message.transcript-virtual-row').length,
          rootText: document.querySelector('#root')?.textContent?.slice(0, 1000) || '',
          bodyClasses: document.body.className,
        }));
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}; pageErrors=${JSON.stringify(pageErrors)}; clientMessages=${JSON.stringify(clientMessageTypes.slice(-30))}`);
      }

      const coverage = async () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.messages .message[data-message-role]')];
        const settled = rows.filter(row => row.classList.contains('transcript-virtual-row'));
        const perRow = rows.map(row => row.querySelectorAll(':scope > .user-content .message-timestamp, :scope > .assistant-content .message-timestamp').length);
        const allTimes = rows.flatMap(row => [...row.querySelectorAll(':scope > .user-content .message-timestamp, :scope > .assistant-content .message-timestamp')]);
        const contrastRatio = node => {
          const parse = value => {
            const values = String(value).match(/[\d.]+/g)?.map(Number) || [];
            return { r: values[0] || 0, g: values[1] || 0, b: values[2] || 0, a: values.length > 3 ? values[3] : 1 };
          };
          const luminance = color => {
            const linear = [color.r, color.g, color.b].map(value => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
          };
          const foreground = parse(getComputedStyle(node).color);
          let ancestor = node;
          let background = null;
          while (ancestor && !background) {
            const candidate = parse(getComputedStyle(ancestor).backgroundColor);
            if (candidate.a > 0) background = candidate;
            ancestor = ancestor.parentElement;
          }
          background ||= { r: 255, g: 255, b: 255, a: 1 };
          const left = luminance(foreground);
          const right = luminance(background);
          return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
        };
        return {
          rows: rows.length,
          settled: settled.length,
          timestamp_nodes: allTimes.length,
          per_row_exactly_one: perRow.every(count => count === 1),
          semantic_time_nodes: allTimes.filter(node => node.tagName === 'TIME').length,
          unknown_nodes: allTimes.filter(node => node.classList.contains('message-timestamp-unknown')).length,
          nested_timestamp_nodes: document.querySelectorAll('.content-block .message-timestamp, details .message-timestamp').length,
          minimum_contrast: Math.min(...allTimes.map(contrastRatio)),
          minimum_font_px: Math.min(...allTimes.map(node => parseFloat(getComputedStyle(node).fontSize))),
          minimum_line_height_px: Math.min(...allTimes.map(node => parseFloat(getComputedStyle(node).lineHeight))),
          clipped: allTimes.some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1),
          hidden: allTimes.some(node => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden';
          }),
        };
      });

      const initial = await coverage();
      assert.strictEqual(initial.per_row_exactly_one, true);
      assert.strictEqual(initial.timestamp_nodes, initial.rows);
      assert.strictEqual(initial.unknown_nodes, 1, 'missing legacy instant must render exactly one honest unknown label');
      assert.strictEqual(initial.nested_timestamp_nodes, 0, 'nested tool/diff blocks must inherit the top-level timestamp');
      assert(initial.minimum_contrast >= 4.5, `timestamp contrast ${initial.minimum_contrast} is below AA`);
      assert(initial.minimum_font_px >= 12);
      assert(initial.minimum_line_height_px >= 16);
      assert.strictEqual(initial.clipped, false);
      assert.strictEqual(initial.hidden, false);

      const messages = page.locator('.messages');
      const anchorSelector = '[data-message-source-id="timestamp-fixture:20"]';
      await page.waitForTimeout(250);
      await messages.evaluate(node => {
        node.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true }));
        node.scrollTop = Math.floor(node.scrollHeight * 0.42);
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => { window.__timestampLayoutShifts = []; });
      const beforeAppend = await page.locator(anchorSelector).evaluate(node => node.getBoundingClientRect().top);
      activeSocket.send(JSON.stringify({
        type: 'message', session: SESSION_ID, role: 'assistant', content: 'Settled live append with producer time.',
        server_message_id: 20_000, sequence: 40, source_message_id: 'timestamp-fixture:live',
        created_at: '2026-07-13T19:00:00.625Z', ts: 1783969200.625,
      }));
      await page.waitForFunction(() => document.querySelector('[data-message-source-id="timestamp-fixture:live"]'));
      const afterAppend = await page.locator(anchorSelector).evaluate(node => node.getBoundingClientRect().top);
      const appendAnchorDrift = Math.abs(afterAppend - beforeAppend);
      assert(appendAnchorDrift <= 1, `append scroll anchor drifted ${appendAnchorDrift}px`);

      const composer = page.locator('.textarea-row textarea');
      await composer.fill('Optimistic timestamp fixture');
      await composer.press('Enter');
      await page.waitForFunction(() => !!window.document.querySelector('[data-message-source-id="timestamp-fixture:optimistic-settled"]'));
      assert(sentMessage?.created_at, 'client send did not carry the optimistic producer instant');

      const beforePrepend = await page.locator(anchorSelector).evaluate(node => node.getBoundingClientRect().top);
      await page.locator('.history-tail-banner button').evaluate(node => node.click());
      await page.waitForFunction(() => document.querySelectorAll('.messages .message.transcript-virtual-row').length === 41,
        null, { timeout: 5000 });
      const afterPrepend = await page.locator(anchorSelector).evaluate(node => node.getBoundingClientRect().top);
      const prependAnchorDrift = Math.abs(afterPrepend - beforePrepend);
      assert.strictEqual(olderRequests, 1);
      assert(prependAnchorDrift <= 1, `prepend scroll anchor drifted ${prependAnchorDrift}px`);

      activeSocket.send(JSON.stringify({
        type: 'message_delta', session_id: SESSION_ID, message_id: `provisional-${scenario.name}`,
        block_index: 0, seq: 0, op: 'block_open',
      }));
      activeSocket.send(JSON.stringify({
        type: 'message_delta', session_id: SESSION_ID, message_id: `provisional-${scenario.name}`,
        block_index: 0, seq: 1, op: 'append', append: 'Provisional timestamp fixture',
      }));
      await page.waitForFunction(() => document.querySelector('.provisional-stream .message-timestamp'));
      const provisionalCount = await page.locator('.provisional-stream .message-timestamp').count();
      assert.strictEqual(provisionalCount, 1);

      activeSocket.send(JSON.stringify({
        type: 'status', session: SESSION_ID, thinking: false,
        activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
      }));
      await page.waitForTimeout(100);
      assert.strictEqual(await page.locator('.provisional-stream').count(), 1,
        'terminal activity cleared non-empty provisional text before canonical settle');
      activeSocket.send(JSON.stringify({
        type: 'message', session: SESSION_ID, role: 'assistant', content: 'Settled provisional timestamp fixture.',
        server_message_id: 20_100, sequence: 42,
        source_message_id: `timestamp-fixture:provisional-settled:${scenario.name}`,
        created_at: '2026-07-13T19:01:00.625Z', ts: 1783969260.625,
      }));
      await page.waitForFunction(() => !document.querySelector('.provisional-stream'));

      activeSocket.send(JSON.stringify({
        type: 'agent_started', session_id: SESSION_ID,
        client_message_id: `empty-provisional-${scenario.name}`,
      }));
      await page.waitForFunction(() => document.querySelector('.provisional-stream[data-message-id="awaiting-first-delta"]'));
      activeSocket.send(JSON.stringify({
        type: 'status', session: SESSION_ID, thinking: false,
        activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
      }));
      await page.waitForFunction(() => !document.querySelector('.provisional-stream'));
      const emptyProvisionalRowsAfterIdle = await page.locator('.provisional-stream').count();
      assert.strictEqual(emptyProvisionalRowsAfterIdle, 0,
        'terminal activity left an empty awaiting-first-delta row in the transcript');

      const finalCoverage = await coverage();
      assert.strictEqual(finalCoverage.per_row_exactly_one, true);
      assert.strictEqual(finalCoverage.timestamp_nodes, finalCoverage.rows);
      assert(finalCoverage.minimum_contrast >= 4.5);
      const layoutShifts = await page.evaluate(() => window.__timestampLayoutShifts || []);
      const pageLayoutShift = layoutShifts.reduce((sum, entry) => sum + entry.value, 0);
      const layoutShift = layoutShifts.filter(entry => entry.transcript).reduce((sum, entry) => sum + entry.value, 0);
      assert.strictEqual(layoutShift, 0, `timestamp transcript CLS was ${layoutShift}: ${JSON.stringify(layoutShifts)}`);

      if (OUTPUT_DIR) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${scenario.name}.png`), fullPage: false });
      }
      results.push({
        ...scenario,
        initial,
        final: finalCoverage,
        provisional_timestamp_nodes: provisionalCount,
        nonempty_provisional_preserved_until_settle: true,
        empty_provisional_rows_after_idle: emptyProvisionalRowsAfterIdle,
        append_anchor_drift_px: appendAnchorDrift,
        prepend_anchor_drift_px: prependAnchorDrift,
        cls: layoutShift,
        page_cls: pageLayoutShift,
        optimistic_created_at: sentMessage.created_at,
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    built_bundle: true,
    scenarios: results,
    windows_opened: 0,
    focus_actions: 0,
  };
  if (OUTPUT_DIR) fs.writeFileSync(path.join(OUTPUT_DIR, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
