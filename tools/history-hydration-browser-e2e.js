#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const sessionId = 'history-browser-session';
const liveMarker = 'Cached live row stays visible';
const reconciledMarker = 'Native reconciliation completed';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHealth(port, timeoutMs = 15_000) {
  await waitFor(async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/healthz' }, resolve);
        request.once('error', reject);
      });
      response.resume();
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }, timeoutMs, 'isolated relay health');
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    const messages = [];
    const timer = setTimeout(() => reject(new Error('proxy connection timeout')), 8000);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'history-browser-e2e', machine_label: 'history-browser-e2e', secret,
    })));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      messages.push(message);
      if (message.type === 'connection_ack') {
        clearTimeout(timer);
        resolve({ ws, messages });
      }
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function nativeResponse(request) {
  return {
    type: 'history_chunk', protocol_version: 1,
    session_id: sessionId, session: sessionId,
    request_id: request.request_id,
    mode: 'tail', source: 'codex_cli_jsonl', replace: true,
    messages: [
      {
        source_message_id: 'history-browser-live-row',
        role: 'assistant', content: liveMarker, sequence: 1, ts: 1784600000,
      },
      {
        source_message_id: 'history-browser-reconciled-row',
        role: 'assistant', content: reconciledMarker, sequence: 2, ts: 1784600001,
      },
    ],
    partial: true, complete: false,
    cursor: {
      start_offset: 1024, end_offset: 4096,
      next_before_offset: 1024, total_bytes: 31_471_461,
    },
  };
}

async function main() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-history-browser-'));
  const secret = 'history-browser-e2e-proxy-secret';
  const relayLogs = [];
  const relay = spawn(process.execPath, ['index.js'], {
    cwd: path.join(root, 'relay-server'),
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'history-browser-session-secret-0123456789',
      JWT_SECRET: 'history-browser-jwt-secret-0123456789',
      PROXY_SECRET: secret,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'history-browser-client',
      GOOGLE_CLIENT_SECRET: 'history-browser-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => relayLogs.push(String(chunk)));
  relay.stderr.on('data', chunk => relayLogs.push(String(chunk)));

  let proxy;
  let browser;
  const pageErrors = [];
  const consoleErrors = [];
  try {
    await waitForHealth(port);
    proxy = await connectProxy(port, secret);
    proxy.ws.send(JSON.stringify({
      type: 'session_list', protocol_version: 1,
      proxy_id: 'history-browser-e2e',
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex_cli', host_type: 'cli', status: 'healthy',
        is_test_session: false,
        display_name: 'History browser fixture', chat_title: 'History browser fixture',
        workspace_path: root, project_root: root,
        capabilities: {}, activity: { kind: 'working', label: 'Answering' },
      }],
    }));
    await sleep(250);

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, colorScheme: 'dark',
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
    const card = page.locator(`.session-card[data-session-id="${sessionId}"]`);
    try {
      await card.waitFor({ state: 'visible', timeout: 15_000 });
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
        proxy_messages: proxy.messages.slice(-10),
        page_errors: pageErrors,
        console_errors: consoleErrors,
        relay_log_tail: relayLogs.join('').slice(-4000),
      })}\n${error.message}`);
    }
    await card.click();
    await page.locator(`.session-card.active[data-session-id="${sessionId}"]`).waitFor();

    const firstRequest = await waitFor(() => proxy.messages.find(message => (
      message.type === 'history_chunk_request' && (message.session_id || message.session) === sessionId
    )), 2500, 'first native history request');

    // Model a live/cached row arriving while the native archive is still refreshing.
    proxy.ws.send(JSON.stringify({
      type: 'proxy_message', protocol_version: 1,
      session: sessionId, session_id: sessionId,
      role: 'assistant', content: liveMarker,
      source: 'history_browser_e2e', source_message_id: 'history-browser-live-row',
      created_at: new Date().toISOString(),
    }));
    await page.getByText(liveMarker, { exact: true }).waitFor({ state: 'visible', timeout: 2500 });

    proxy.ws.send(JSON.stringify({
      type: 'history_chunk', protocol_version: 1,
      session_id: sessionId, session: sessionId,
      request_id: firstRequest.request_id,
      mode: 'tail', source: 'codex_cli_jsonl', replace: true,
      messages: [], partial: true, complete: false,
      error: {
        code: 'history_chunk_throttled', message: 'native cooldown', retry_after_ms: 300,
      },
      cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 31_471_461 },
    }));

    const refreshBanner = page.getByText('Refreshing latest messages...', { exact: true });
    await refreshBanner.waitFor({ state: 'visible', timeout: 2500 });
    const duringThrottle = await page.evaluate(marker => ({
      live_rows: [...document.querySelectorAll('.messages .message')]
        .filter(node => String(node.textContent || '').includes(marker)).length,
      refresh_status: [...document.querySelectorAll('[role="status"]')]
        .some(node => String(node.textContent || '').includes('Refreshing latest messages...')),
      visible_throttle_errors: String(document.body?.innerText || '').includes('Native history chunk request throttled'),
      full_history_error: !!document.querySelector('.history-error-inline, .history-error-state'),
      message_count: document.querySelectorAll('.messages .message').length,
    }), liveMarker);
    assert.equal(duringThrottle.live_rows, 1, 'usable live transcript row disappeared or duplicated during backpressure');
    assert.equal(duringThrottle.refresh_status, true, 'compact refresh status was not rendered');
    assert.equal(duringThrottle.visible_throttle_errors, false, 'recoverable throttle became visible');
    assert.equal(duringThrottle.full_history_error, false, 'recoverable throttle rendered an error state');

    const secondRequest = await waitFor(() => proxy.messages.filter(message => (
      message.type === 'history_chunk_request' && (message.session_id || message.session) === sessionId
    ))[1], 2500, 'automatic native history retry');
    assert.equal(secondRequest.request_id, firstRequest.request_id, 'relay retry changed the upstream request identity');
    await sleep(400);
    assert.equal(await page.getByText(liveMarker, { exact: true }).count(), 1,
      'usable row did not remain visible for the full retry delay');
    assert.equal(await refreshBanner.count(), 1, 'refresh status disappeared before native reconciliation');
    proxy.ws.send(JSON.stringify(nativeResponse(secondRequest)));

    await page.getByText(reconciledMarker, { exact: true }).waitFor({ state: 'visible', timeout: 2500 });
    await refreshBanner.waitFor({ state: 'hidden', timeout: 2500 });
    const afterReconcile = await page.evaluate(({ live, reconciled }) => ({
      live_rows: [...document.querySelectorAll('.messages .message')]
        .filter(node => String(node.textContent || '').includes(live)).length,
      reconciled_rows: [...document.querySelectorAll('.messages .message')]
        .filter(node => String(node.textContent || '').includes(reconciled)).length,
      message_count: document.querySelectorAll('.messages .message').length,
      refresh_status: String(document.body?.innerText || '').includes('Refreshing latest messages...'),
      visible_throttle_errors: String(document.body?.innerText || '').includes('Native history chunk request throttled'),
      inline_error: !!document.querySelector('.history-error-inline, .history-error-state'),
    }), { live: liveMarker, reconciled: reconciledMarker });
    assert.equal(afterReconcile.live_rows, 1);
    assert.equal(afterReconcile.reconciled_rows, 1);
    assert.equal(afterReconcile.message_count, 2);
    assert.equal(afterReconcile.refresh_status, false);
    assert.equal(afterReconcile.visible_throttle_errors, false);
    assert.equal(afterReconcile.inline_error, false);
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

    console.log(JSON.stringify({
      result: 'PASS',
      actual_relay: true,
      actual_built_bundle: true,
      native_requests: proxy.messages.filter(message => message.type === 'history_chunk_request').length,
      retry_request_identity_stable: secondRequest.request_id === firstRequest.request_id,
      during_throttle: duringThrottle,
      after_reconcile: afterReconcile,
      page_errors: pageErrors.length,
      console_errors: consoleErrors.length,
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_sessions_touched: 0,
    }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (proxy) await closeSocket(proxy.ws);
    await stopChild(relay);
    const resolvedDataDir = path.resolve(dataDir);
    const tempPrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (resolvedDataDir.startsWith(tempPrefix)) fs.rmSync(resolvedDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
