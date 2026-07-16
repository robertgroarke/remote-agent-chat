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
const alpha = 'attention-alpha';
const beta = 'attention-beta';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executablePath;
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

function contentType(filePath) {
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const mutations = [];
  let fixtureSocket;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/preferences/notifications')) {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"preferences":{"turn_ready":false,"goal_completed":false,"goal_attention":true}}');
      }, 200);
      return;
    }
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
  const setGenerating = (sessionId, value) => send({
    type: 'session_status', session_id: sessionId, thinking: value,
    label: value ? 'Generating' : '', activity: {
      kind: value ? 'generating' : 'idle',
      label: value ? 'Generating' : '',
      updated_at: new Date().toISOString(),
    },
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: [
        { session_id: alpha, agent_type: 'claude', title: 'Active operator chat', chat_title: 'Active operator chat', status: 'healthy', workspace_name: 'Remote Agent Chat' },
        { session_id: beta, agent_type: 'codex_cli', title: 'Background build', chat_title: 'Background build', status: 'healthy', workspace_name: 'Remote Agent Chat' },
      ], workspaces: [],
      semantic_notifications: [{
        type: 'semantic_notification', event_type: 'goal_completed', category: 'goal_completed',
        dedupe_key: 'goal_completed:disabled-history-race', session_id: beta,
        title: 'Goal completed', body: 'This disabled history event must stay quiet.',
        created_at: new Date().toISOString(),
      }],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (['agent_message', 'agent_interrupt', 'permission_response', 'agent_control'].includes(message.type)) mutations.push(message);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail',
          replace: message.replace !== false, messages: [{ role: 'assistant', content: `Transcript for ${sid}`, sequence: 1 }],
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
  let originalUrl;
  let originalViewport;
  try {
    const isolatedHeadless = process.env.RAC_ISOLATED_HEADLESS === '1';
    if (isolatedHeadless) {
      browser = await chromium.launch({
        executablePath: findChrome(),
        headless: true,
        args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
      });
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    } else {
      browser = await chromium.connectOverCDP(cdpUrl);
      const persistentPages = browser.contexts().flatMap(context => context.pages());
      assert.strictEqual(persistentPages.length, 1, `expected one persistent page, found ${persistentPages.length}`);
      [page] = persistentPages;
      originalUrl = page.url();
      originalViewport = page.viewportSize();
    }
    const pages = [page];
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator(`.session-card[data-session-id="${alpha}"]`).waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(sessionId => document.querySelector('.session-card.active')?.dataset.sessionId === sessionId, alpha);
    await page.waitForTimeout(350);
    assert.strictEqual(await page.locator('.attention-toast').count(), 0,
      'connection history bypassed the delayed authoritative disabled preference');

    send({
      type: 'permission_prompt', session_id: beta, prompt_id: 'jump-question', kind: 'question',
      message: 'Choose a background build option.', timeout_ms: 300000,
      questions: [{ question_id: 'q1', label: 'Action', multi_select: false, choices: [{ choice_id: 'wait', label: 'Wait' }] }],
    });
    const toast = page.locator('.attention-toast');
    await toast.waitFor({ state: 'visible', timeout: 2000 });
    assert.match(await toast.innerText(), /Question needs an answer/);
    assert.match(await toast.innerText(), /Background build/);
    const desktopScreenshot = outputPath ? path.join(path.dirname(outputPath), 'cross-session-attention-desktop.png') : null;
    if (desktopScreenshot) await toast.screenshot({ path: desktopScreenshot, animations: 'disabled' });
    await toast.getByRole('button', { name: 'Jump' }).click();
    await page.waitForFunction(sessionId => document.querySelector('.session-card.active')?.dataset.sessionId === sessionId, beta);
    assert.strictEqual(await toast.count(), 0, 'Jump did not dismiss the attention toast');
    send({ type: 'permission_prompt_expired', session_id: beta, prompt_id: 'jump-question' });
    await page.locator('.permission-card').waitFor({ state: 'detached', timeout: 1000 });

    await page.locator(`.session-card[data-session-id="${alpha}"]`).evaluate(node => node.click());
    await page.waitForFunction(sessionId => document.querySelector('.session-card.active')?.dataset.sessionId === sessionId, alpha);
    send({
      type: 'permission_prompt', session_id: beta, prompt_id: 'auto-resolve', message: 'Temporary permission.',
      timeout_ms: 300000, default_choice: 'deny', choices: [{ choice_id: 'deny', label: 'Deny' }],
    });
    await toast.waitFor({ state: 'visible', timeout: 2000 });
    send({ type: 'permission_prompt_expired', session_id: beta, prompt_id: 'auto-resolve' });
    await toast.waitFor({ state: 'detached', timeout: 1000 });

    setGenerating(beta, true);
    await page.waitForFunction(sessionId => document.querySelector(`.session-card[data-session-id="${sessionId}"] .session-card-native-status`), beta, { timeout: 2000 });
    setGenerating(beta, false);
    await page.waitForTimeout(300);
    assert.strictEqual(await toast.count(), 0,
      'generic generating-to-idle transition incorrectly surfaced a completion toast');

    await page.getByRole('button', { name: 'Fleet view' }).click();
    await page.getByRole('heading', { name: 'Fleet view' }).waitFor();
    const fleetSummary = await page.locator('.fleet-summary').innerText();
    assert(fleetSummary.includes('0\nNEED ATTENTION'),
      'ordinary completion was incorrectly promoted to Fleet Needs attention');
    await page.locator('.fleet-filter-row button').click();
    assert.equal(await page.locator(`.fleet-card[data-session-id="${beta}"][data-activity-state="idle"]`).count(), 1,
      'completed background session did not remain an ordinary Fleet idle row');
    await page.locator('[data-testid="fleet-view"] .automations-back').click();
    await page.locator('[data-testid="fleet-view"]').waitFor({ state: 'detached' });

    send({
      type: 'semantic_notification', event_type: 'goal_attention', category: 'goal_attention',
      dedupe_key: 'goal_attention:background-build-blocked', session_id: beta,
      title: 'Needs attention', body: "Background build's goal is blocked.",
      created_at: new Date().toISOString(),
    });
    await toast.waitFor({ state: 'visible', timeout: 2000 });
    assert.match(await toast.innerText(), /Needs attention/);
    assert.match(await toast.innerText(), /Background build/);

    await page.setViewportSize({ width: 390, height: 844 });
    const hamburgerAttention = page.locator('.hamburger-attention');
    await hamburgerAttention.waitFor({ state: 'visible', timeout: 1000 });
    assert.match(await hamburgerAttention.getAttribute('title'), /need attention/);
    const mobileScreenshot = outputPath ? path.join(path.dirname(outputPath), 'cross-session-attention-mobile.png') : null;
    if (mobileScreenshot) await page.screenshot({ path: mobileScreenshot, animations: 'disabled' });
    await toast.getByRole('button', { name: 'Jump' }).click();
    await page.waitForFunction(sessionId => document.querySelector('.session-card.active')?.dataset.sessionId === sessionId, beta);
    await hamburgerAttention.waitFor({ state: 'detached', timeout: 1000 });
    if (originalViewport) await page.setViewportSize(originalViewport);

    assert.deepStrictEqual(mutations, [], 'attention UI emitted a harness mutation');
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      isolated_headless: isolatedHeadless,
      persistent_browser_pages: pages.length,
      question_toast_with_jump: true,
      jump_selected_background_session: true,
      prompt_auto_dismissed_on_resolve: true,
      connection_history_waited_for_authoritative_preferences: true,
      disabled_history_event_toasts: 0,
      idle_transition_completion_toast: false,
      explicit_goal_attention_toast: true,
      completion_not_fleet_attention: true,
      mobile_hamburger_attention: true,
      attention_cleared_on_view: true,
      user_messages_sent: 0,
      controls_invoked: 0,
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
