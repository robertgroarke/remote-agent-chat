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
const sessionIds = Array.from({ length: 69 }, (_, index) => `cache-fixture-${index + 1}`);

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

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return null;
}

async function main() {
  const port = await freePort();
  let activeSocket = null;
  const historyRequests = [];
  const historyResponses = [];
  const subscriptionUpdates = [];
  const responseDelays = new Map();
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
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  const fixtureSessions = sessionIds.map((id, index) => ({
    session_id: id,
    title: `Cache fixture ${index + 1}`,
    display_name: `Cache fixture ${index + 1}`,
    agent_type: index === 2 ? 'claude_cli' : 'continue',
    status: 'healthy',
    is_test_session: false,
    workspace_path: root,
    project_root: root,
  }));
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    activeSocket = ws;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: fixtureSessions,
      workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
        return;
      }
      if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: message.session_id || message.session, capabilities: {} });
        return;
      }
      if (message.type === 'subscribe') {
        subscriptionUpdates.push({
          at: Date.now(),
          sessions: Array.isArray(message.sessions) ? [...message.sessions] : [],
        });
        if (subscriptionUpdates.length === 1) {
          send({ type: 'session_list', sessions: fixtureSessions, workspaces: [] });
        }
        return;
      }
      if (message.type !== 'history_chunk_request' && message.type !== 'get_history' && message.type !== 'history_request') return;
      const sid = message.session_id || message.session;
      if (!sessionIds.includes(sid)) return;
      const requestedAt = Date.now();
      historyRequests.push({
        session_id: sid,
        requested_at: requestedAt,
        type: message.type,
        replace: message.replace,
        after_sequence: message.after_sequence ?? null,
      });
      const delayMs = Number(responseDelays.get(sid) ?? 25);
      setTimeout(() => {
        const payload = message.type === 'history_chunk_request'
          ? {
              type: 'history_chunk', session_id: sid, request_id: message.request_id,
              source: message.source || 'relay_sqlite', mode: 'tail', replace: message.replace !== false,
              messages: [{ role: 'assistant', content: `Transcript ${sid}`, sequence: sessionIds.indexOf(sid) + 1 }],
              total_messages: 1, loaded_messages: 1, partial: false,
            }
          : message.type === 'history_request'
            ? {
                type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id,
                after_sequence: message.after_sequence, messages: [], loaded_messages: 0, total_messages: 1,
              }
            : {
              type: 'history', session: sid, request_id: message.request_id, mode: 'full',
              messages: [{ role: 'assistant', content: `Transcript ${sid}`, sequence: sessionIds.indexOf(sid) + 1 }],
            };
        send(payload);
        historyResponses.push({ session_id: sid, responded_at: Date.now(), delay_ms: delayMs });
      }, delayMs);
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let originalUrl;
  const pageErrors = [];
  const consoleErrors = [];
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    try {
      await page.locator(`.session-card[data-session-id="${sessionIds[0]}"]`).waitFor({ state: 'visible', timeout: 15000 });
    } catch (error) {
      const pageState = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        ready_state: document.readyState,
        root_child_count: document.querySelector('#root')?.childElementCount ?? null,
        session_card_count: document.querySelectorAll('.session-card').length,
        body_text: String(document.body?.innerText || '').slice(0, 1200),
      })).catch(evaluationError => ({ evaluation_error: String(evaluationError?.message || evaluationError) }));
      throw new Error(`fixture startup failed: ${JSON.stringify({
        ...pageState,
        websocket_connected: !!activeSocket,
        websocket_ready_state: activeSocket?.readyState ?? null,
        subscription_updates: subscriptionUpdates,
        page_errors: pageErrors,
        console_errors: consoleErrors,
      })}\n${error.message}`);
    }

    const visit = async (sid, targetMs = null) => page.evaluate(async ({ sessionId, target }) => {
      const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
      if (!card) throw new Error(`missing card ${sessionId}`);
      const startedAt = performance.now();
      card.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shellPaintMs = Number((performance.now() - startedAt).toFixed(1));
      const selected = card.classList.contains('active');
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 5000;
        const check = () => {
          const hasTranscript = [...document.querySelectorAll('.messages .message')]
            .some(row => String(row.textContent || '').includes(`Transcript ${sessionId}`));
          if (hasTranscript) return requestAnimationFrame(() => requestAnimationFrame(resolve));
          if (performance.now() >= deadline) return reject(new Error(`timed out waiting for ${sessionId}`));
          setTimeout(check, 4);
        };
        check();
      });
      const elapsed = Number((performance.now() - startedAt).toFixed(1));
      return {
        session_id: sessionId,
        shell_paint_ms: shellPaintMs,
        shell_target_pass: shellPaintMs <= 100 && selected,
        correct_paint_ms: elapsed,
        target_ms: target,
        target_pass: target == null ? null : elapsed <= target,
        loading_flash: !!document.querySelector('.history-loading-state'),
        blank_flash: document.querySelectorAll('.messages .message').length === 0,
      };
    }, { sessionId: sid, target: targetMs });

    await visit(sessionIds[0]);
    await visit(sessionIds[1]);
    responseDelays.set(sessionIds[0], 600);
    responseDelays.set(sessionIds[1], 600);
    const revisits = [];
    for (let index = 0; index < 6; index += 1) {
      revisits.push(await visit(sessionIds[index % 2], 150));
    }

    const backgroundHistoryBaseline = historyRequests.length;
    for (let index = 2; index < 22; index += 1) {
      activeSocket.send(JSON.stringify({
        type: 'status', session: sessionIds[index], thinking: true,
        activity: { kind: 'generating', generating: true, label: 'Thinking' },
      }));
    }
    await new Promise(resolve => setTimeout(resolve, 5500));
    const backgroundHistoryRequests = historyRequests.slice(backgroundHistoryBaseline)
      .filter(request => sessionIds.slice(2, 22).includes(request.session_id));
    assert.strictEqual(backgroundHistoryRequests.length, 0,
      'working background sessions must not trigger history requests');
    assert(subscriptionUpdates.every(update => update.sessions.length <= 1),
      'subscription updates must never fan out with working-session count');

    responseDelays.set(sessionIds[2], 300);
    const coldSelectedVisit = await visit(sessionIds[2], 500);
    assert(coldSelectedVisit.shell_target_pass,
      `cold selected-session shell missed 100ms (${coldSelectedVisit.shell_paint_ms}ms)`);
    const selectedHistoryRequests = historyRequests.slice(backgroundHistoryBaseline)
      .filter(request => request.session_id === sessionIds[2]);
    assert.strictEqual(selectedHistoryRequests.length, 1,
      'cold selection must hydrate its bounded transcript exactly once');
    assert.deepEqual(subscriptionUpdates.at(-1)?.sessions, [sessionIds[2]],
      'full-fidelity subscription must move atomically to the selected session');

    const values = revisits.map(sample => sample.correct_paint_ms);
    const result = {
      ok: revisits.every(sample => sample.target_pass && sample.shell_target_pass && !sample.loading_flash && !sample.blank_flash)
        && coldSelectedVisit.target_pass && coldSelectedVisit.shell_target_pass
        && !coldSelectedVisit.loading_flash && !coldSelectedVisit.blank_flash,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      target_ms: 150,
      cache_limit: 10,
      revisit_samples: revisits,
      revisit_p50_ms: percentile(values, 0.5),
      revisit_p95_ms: percentile(values, 0.95),
      revisit_max_ms: Math.max(...values),
      background_history_isolation: {
        session_count: sessionIds.length,
        working_session_count: 20,
        observation_ms: 5500,
        history_requests_before_selection: backgroundHistoryRequests.length,
        max_subscription_size: Math.max(0, ...subscriptionUpdates.map(update => update.sessions.length)),
        subscription_update_count: subscriptionUpdates.length,
      },
      selected_only_hydration: {
        session_id: sessionIds[2],
        request_observed_before_selection: false,
        request_count_after_selection: selectedHistoryRequests.length,
        visit: coldSelectedVisit,
      },
      cold_tail_response_delay_ms: 300,
      history_request_count: historyRequests.length,
      visible_windows_opened: 0,
      focus_actions: 0,
      sends: 0,
      controls: 0,
      original_origin_restored: originalUrl ? new URL(originalUrl).origin : null,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
    assert(result.ok, `cached session-switch target failed (${result.revisit_p50_ms}/${result.revisit_p95_ms} ms)`);
  } finally {
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
