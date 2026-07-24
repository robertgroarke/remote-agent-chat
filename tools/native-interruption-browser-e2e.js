'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const { normalizeActivityTimeline } = require('../relay-server/activity-timeline');
const { normalizeNativeInterruption, resolveNativeInterruption } = require('../shared/native-interruption');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = process.env.RAC_PUBLIC_ROOT
  ? path.resolve(process.env.RAC_PUBLIC_ROOT)
  : path.join(ROOT, 'frontend');
const SESSION_ID = 'native-interruption-browser-fixture';
const OUTPUT_ARG = process.argv.indexOf('--output-dir');
const OUTPUT_DIR = OUTPUT_ARG >= 0 && process.argv[OUTPUT_ARG + 1]
  ? path.resolve(process.argv[OUTPUT_ARG + 1])
  : null;
const SOAK_ARG = process.argv.indexOf('--soak-ms');
const SOAK_MS = SOAK_ARG >= 0 && process.argv[SOAK_ARG + 1]
  ? Math.max(500, Number(process.argv[SOAK_ARG + 1]) || 0)
  : 1000;
const ERROR_TEXT = 'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)';

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

function transcriptRows(interruption) {
  const base = Date.parse('2026-07-23T17:30:00.000Z');
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    server_message_id: index + 1,
    source_message_id: `native-interruption-fixture:${index + 1}`,
    sequence: index + 1,
    role: index % 7 === 0 ? 'user' : 'assistant',
    content: `Stable transcript row ${index + 1}. ${'History remains readable. '.repeat(5)}`,
    created_at: new Date(base + index * 1000).toISOString(),
  }));
  rows.push({
    id: 101,
    server_message_id: 101,
    source_message_id: 'native-interruption-fixture:error',
    sequence: 101,
    role: 'assistant',
    content: `[Error]\n\n${ERROR_TEXT}`,
    created_at: interruption.native_timestamp,
    content_blocks: [{
      type: 'error',
      title: interruption.title,
      content: interruption.safe_display_text,
      status: 'error',
      collapsed: false,
      interruption,
    }],
  });
  return rows;
}

async function main() {
  const interruption = normalizeNativeInterruption({
    session_id: SESSION_ID,
    surface: 'codex_cli',
    native_thread_id: '019f88f2-4d38-7db2-96b7-da6a4f6dc43d',
    turn_id: 'a727b401-3c79-4a70-b3eb-f4c10f95102f',
    native_timestamp: '2026-07-23T17:55:51.473Z',
    message: ERROR_TEXT,
    provider_error_code: 'other',
    source_kind: 'event_msg.task_complete.error',
    source_id: 'event_msg.task_complete:offset:fixture',
  });
  const unresolvedActivity = normalizeActivityTimeline({
    kind: 'failed',
    label: interruption.title,
    updated_at: interruption.native_timestamp,
    interruption,
    goal: {
      objective: 'Keep the interrupted goal recoverable',
      text: 'Keep the interrupted goal recoverable',
      state: 'blocked',
      status: 'blocked',
    },
  }, null, interruption.native_timestamp);
  const rows = transcriptRows(interruption);
  const port = await freePort();
  const sockets = new Set();
  const clientMessageTypes = [];
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_ROOT, relative);
    if (!filePath.startsWith(`${path.resolve(PUBLIC_ROOT)}${path.sep}`)
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
    sockets.add(ws);
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    const session = {
      session_id: SESSION_ID,
      title: 'Interrupted Codex CLI fixture',
      chat_title: 'Interrupted Codex CLI fixture',
      display_name: 'Interrupted Codex CLI fixture',
      agent_type: 'codex_cli',
      status: 'healthy',
      health: 'connected',
      is_test_session: false,
      workspace_path: ROOT,
      project_root: ROOT,
      activity: unresolvedActivity,
    };
    send({
      type: 'connection_ack',
      protocol_version: 1,
      heartbeat_interval_ms: 1000,
      sessions: [session],
      workspaces: [],
    });
    setTimeout(() => send({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] }), 20);
    setTimeout(() => send({
      type: 'status',
      session: SESSION_ID,
      thinking: false,
      label: unresolvedActivity.label,
      activity: unresolvedActivity,
    }), 40);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientMessageTypes.push(message.type || 'unknown');
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'subscribe') {
        send({ type: 'subscription_ack', request_id: message.request_id, sessions: [SESSION_ID] });
        send({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk',
          session: SESSION_ID,
          session_id: SESSION_ID,
          request_id: message.request_id,
          source: message.source,
          mode: message.mode || 'tail',
          replace: message.mode !== 'older',
          messages: rows,
          partial: false,
          loaded_messages: rows.length,
          total_messages: rows.length,
        });
      } else if (['get_history', 'history_request'].includes(message.type)) {
        send({
          type: 'history',
          session: SESSION_ID,
          session_id: SESSION_ID,
          messages: rows,
          mode: 'full',
          replace: true,
        });
      }
      if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: SESSION_ID, capabilities: {} });
      }
    });
    ws.once('close', () => sockets.delete(ws));
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking', '--no-default-browser-check'],
  });
  const scenarios = [
    { name: 'dark-desktop', theme: 'dark', viewport: { width: 1280, height: 900 } },
    { name: 'light-desktop', theme: 'light', viewport: { width: 1280, height: 900 } },
    { name: 'dark-mobile-390', theme: 'dark', viewport: { width: 390, height: 844 } },
    { name: 'light-mobile-390', theme: 'light', viewport: { width: 390, height: 844 } },
  ];
  const results = [];
  try {
    for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
      const scenario = scenarios[scenarioIndex];
      const context = await browser.newContext({
        viewport: scenario.viewport,
        colorScheme: scenario.theme,
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
      });
      await context.addInitScript(theme => {
        localStorage.setItem('remote-agent-chat-theme', theme);
      }, scenario.theme);
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const card = page.locator(`.session-card[data-session-id="${SESSION_ID}"]`);
      await card.waitFor({ state: 'attached', timeout: 10000 }).catch(async error => {
        const diagnostic = await page.evaluate(() => ({
          body: document.body.innerText.slice(0, 3000),
          url: location.href,
          readyState: document.readyState,
        }));
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}; pageErrors=${JSON.stringify(pageErrors)}; consoleErrors=${JSON.stringify(consoleErrors)}; clientMessages=${JSON.stringify(clientMessageTypes.slice(-30))}; sockets=${sockets.size}`);
      });
      await card.evaluate(node => node.click());
      const banner = page.locator('[data-live-channel="native-interruption"]');
      await banner.waitFor({ state: 'visible', timeout: 10000 }).catch(async error => {
        const diagnostic = await page.evaluate(() => ({
          body: document.body.innerText.slice(-5000),
          active: document.querySelector('.session-card.active')?.dataset.sessionId || null,
          liveStatus: document.querySelector('[data-testid="live-status-stack"]')?.innerText || null,
          messageCount: document.querySelectorAll('.messages .message').length,
        }));
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}; clientMessages=${JSON.stringify(clientMessageTypes.slice(-50))}`);
      });
      assert.strictEqual(await banner.getAttribute('role'), 'alert');
      assert.strictEqual(await banner.getAttribute('data-interruption-event-id'), interruption.event_id);
      assert.match(await banner.innerText(), /Provider stream interrupted[\s\S]*Needs attention/);
      assert.match(await banner.innerText(), /stream disconnected before completion/);
      const errorBlocks = page.locator('.content-block-error');
      await errorBlocks.last().waitFor({ state: 'visible', timeout: 10000 });
      assert.strictEqual(await errorBlocks.count(), 1, 'one native error must render once');
      assert.match(await errorBlocks.last().innerText(), /stream disconnected before completion/);

      const messagesViewport = page.locator('.messages');
      await messagesViewport.hover();
      await page.mouse.wheel(0, -3000);
      await page.waitForTimeout(150);
      const scrollBaseline = await page.evaluate(() => {
        const node = document.querySelector('.messages');
        window.__nativeInterruptionScrollEvents = 0;
        node.addEventListener('scroll', () => { window.__nativeInterruptionScrollEvents += 1; });
        return { top: node.scrollTop, max: node.scrollHeight - node.clientHeight };
      });
      assert(scrollBaseline.max > 100, `fixture transcript did not overflow in ${scenario.name}`);
      assert(scrollBaseline.top < scrollBaseline.max - 200, `${scenario.name} did not leave the live edge`);

      const scenarioSoakMs = scenarioIndex === 0 ? SOAK_MS : Math.min(SOAK_MS, 1000);
      const startedAt = Date.now();
      let frames = 0;
      let historyReplays = 0;
      while (Date.now() - startedAt < scenarioSoakMs) {
        const elapsed = Date.now() - startedAt;
        const inBurst = elapsed % 6000 < 1000;
        if (inBurst || elapsed % 1000 < 100) {
          for (const ws of sockets) {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({
              type: 'status',
              session: SESSION_ID,
              thinking: false,
              label: unresolvedActivity.label,
              activity: unresolvedActivity,
            }));
          }
          frames += 1;
        }
        if (elapsed > 0 && Math.floor(elapsed / 5000) > historyReplays) {
          historyReplays += 1;
          for (const ws of sockets) {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({
              type: 'history',
              session: SESSION_ID,
              session_id: SESSION_ID,
              messages: rows,
              mode: 'full',
              replace: true,
            }));
          }
        }
        await page.waitForTimeout(100);
      }
      const scrollAfter = await page.evaluate(() => {
        const node = document.querySelector('.messages');
        return { top: node.scrollTop, events: window.__nativeInterruptionScrollEvents || 0 };
      });
      assert.strictEqual(scrollAfter.top, scrollBaseline.top, `${scenario.name} transcript drifted while user owned scroll`);
      assert.strictEqual(scrollAfter.events, 0, `${scenario.name} received programmatic scroll events`);
      await messagesViewport.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(100);
      assert.strictEqual(await errorBlocks.count(), 1, `${scenario.name} duplicated the interruption row`);

      const resolved = resolveNativeInterruption(interruption, {
        timestamp: '2026-07-23T18:01:00.000Z',
        resolution_reason: 'later_native_turn_started',
      });
      let relayActivity = normalizeActivityTimeline({
        kind: 'idle',
        label: '',
        updated_at: resolved.resolved_at,
        interruption_tombstone: resolved,
      }, unresolvedActivity, resolved.resolved_at);
      relayActivity = normalizeActivityTimeline({
        kind: 'failed',
        label: interruption.title,
        updated_at: interruption.native_timestamp,
        interruption,
      }, relayActivity, resolved.resolved_at);
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({
          type: 'status',
          session: SESSION_ID,
          thinking: false,
          label: relayActivity.label,
          activity: relayActivity,
        }));
      }
      await banner.waitFor({ state: 'detached', timeout: 3000 });
      assert.strictEqual(relayActivity.interruption, null);
      assert.strictEqual(relayActivity.interruption_tombstone.resolution_state, 'resolved');
      assert.strictEqual(await errorBlocks.count(), 1, 'resolution must retain the historical transcript row');

      if (OUTPUT_DIR) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${scenario.name}.png`), fullPage: true });
      }
      results.push({
        scenario: scenario.name,
        soak_ms: Date.now() - startedAt,
        frames,
        history_replays: historyReplays,
        scroll_top_before: scrollBaseline.top,
        scroll_top_after: scrollAfter.top,
        scroll_events: scrollAfter.events,
        interruption_rows: await errorBlocks.count(),
        page_errors: pageErrors,
      });
      assert.deepStrictEqual(pageErrors, []);
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }

  const result = {
    status: 'pass',
    build_identity: fs.readFileSync(path.join(PUBLIC_ROOT, 'index.html'), 'utf8')
      .match(/build-[0-9a-f]+/)?.[0] || null,
    schema_version: interruption.schema_version,
    event_id: interruption.event_id,
    source_message_count: rows.length,
    interruption_message_count: rows.filter(row => row.content_blocks?.some(block => block.interruption)).length,
    scenarios: results,
    protected_sessions_touched: 0,
    visible_windows_opened: 0,
  };
  if (OUTPUT_DIR) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
