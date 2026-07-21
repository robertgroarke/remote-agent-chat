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
const headlessIsolated = process.argv.includes('--headless-isolated');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const sessionId = 'escape-interrupt-fixture';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  assert(executablePath, `headless Chrome not found; checked ${candidates.join(', ')}`);
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
  const stateEpoch = `escape-interrupt-${Date.now()}`;
  let stateSeq = 0;
  let websocketConnections = 0;
  const clientMessageTypes = [];
  let fixtureSocket;
  const fixtureSessions = [{
    session_id: sessionId, agent_type: 'codex_cli', title: 'Escape interrupt fixture',
    chat_title: 'Escape interrupt fixture', status: 'healthy', workspace_name: 'Remote Agent Chat',
    workspace_path: 'C:\\workspace\\Remote Agent Chat', is_test_session: false,
    control_generation: 1, turn_generation: 1,
  }];
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
    if (new URL(request.url, `http://127.0.0.1:${port}`).pathname !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  const send = payload => fixtureSocket?.readyState === 1
    && fixtureSocket.send(JSON.stringify({ state_epoch: stateEpoch, state_seq: ++stateSeq, ...payload }));
  const setGenerating = value => send({
    type: 'session_status', session_id: sessionId, thinking: value,
    label: value ? 'Generating' : '', activity: { kind: value ? 'generating' : 'idle', label: value ? 'Generating' : '' },
  });
  wss.on('connection', ws => {
    websocketConnections += 1;
    fixtureSocket = ws;
    const sendAck = () => ws.send(JSON.stringify({
      type: 'connection_ack', state_epoch: stateEpoch, heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: fixtureSessions, workspaces: [],
      agent_configs: { [sessionId]: { session_id: sessionId, capabilities: { interrupt: true } } },
    }));
    sendAck();
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientMessageTypes.push(message.type || 'unknown');
      const sid = message.session_id || message.session;
      if (['agent_interrupt', 'agent_message', 'permission_response', 'question_response'].includes(message.type)) mutations.push(message);
      if (message.type === 'subscribe') {
        setTimeout(() => {
          if (ws.readyState !== 1) return;
          sendAck();
          ws.send(JSON.stringify({ type: 'session_list', state_epoch: stateEpoch, state_seq: ++stateSeq, sessions: fixtureSessions }));
        }, 50);
      } else if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: { interrupt: true } });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail',
          replace: message.replace !== false, messages: [{ role: 'assistant', content: 'Interrupt fixture ready.', sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: 'Interrupt fixture ready.', sequence: 1 }] });
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
  let persistentPages = 0;
  const browserDiagnostics = [];
  try {
    if (headlessIsolated) {
      browser = await chromium.launch({
        executablePath: findChrome(),
        headless: true,
        args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
      });
      page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    } else {
      browser = await chromium.connectOverCDP(cdpUrl);
      const pages = browser.contexts().flatMap(context => context.pages());
      persistentPages = pages.length;
      assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
      [page] = pages;
      originalUrl = page.url();
      originalViewport = page.viewportSize();
    }
    page.on('console', message => browserDiagnostics.push(`console:${message.type()}:${message.text()}`));
    page.on('pageerror', error => browserDiagnostics.push(`pageerror:${error.message}`));
    const response = await page.goto(`http://127.0.0.1:${port}/?escape_interrupt=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.strictEqual(response?.status(), 200, 'fixture app shell did not return 200');
    const fixtureCard = page.locator(`[data-session-id="${sessionId}"]`).first();
    try {
      await fixtureCard.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      const body = await page.locator('body').innerText().catch(() => 'unavailable');
      throw new Error(`fixture inventory did not render; websocket_connections=${websocketConnections}; client_messages=${JSON.stringify(clientMessageTypes)}; body=${JSON.stringify(body.slice(0, 1000))}; diagnostics=${JSON.stringify(browserDiagnostics.slice(-20))}; ${error.message}`);
    }
    await fixtureCard.click();
    const composer = page.locator('.input-area textarea');
    await composer.waitFor({ state: 'visible', timeout: 5000 });

    await composer.focus();
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('.interrupt-confirm-inline').count(), 0, 'idle Escape armed an interrupt');
    assert.strictEqual(mutations.length, 0, 'idle Escape emitted a mutation');

    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    const confirm = page.locator('.interrupt-confirm-inline');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    assert.match(await confirm.innerText(), /Esc again or Enter/);
    assert.strictEqual(mutations.length, 0, 'first Escape interrupted without confirmation');
    const desktopScreenshot = outputPath ? path.join(path.dirname(outputPath), 'escape-interrupt-desktop.png') : null;
    if (desktopScreenshot) await page.locator('.input-area').screenshot({ path: desktopScreenshot, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.deepStrictEqual(mutations.map(message => message.type), ['agent_interrupt']);

    setGenerating(false);
    await page.locator('.stop-btn').waitFor({ state: 'detached', timeout: 3000 });
    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.fill('/');
    await page.locator('.slash-menu').waitFor({ state: 'visible', timeout: 1000 });
    await page.keyboard.press('Escape');
    await page.locator('.slash-menu').waitFor({ state: 'detached', timeout: 1000 });
    assert.strictEqual(await confirm.count(), 0, 'slash-menu Escape also armed interrupt');
    assert.strictEqual(mutations.length, 1, 'slash-menu Escape emitted a mutation');
    await composer.fill('');

    send({
      type: 'permission_prompt', session_id: sessionId, prompt_id: 'prompt-priority', message: 'Prompt has Escape priority.',
      timeout_ms: 300000, default_choice: 'stay', choices: [{ choice_id: 'stay', label: 'Stay' }],
    });
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 1000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    assert.strictEqual(await confirm.count(), 0, 'prompt Escape also armed interrupt');
    assert.strictEqual(mutations.length, 1, 'prompt Escape emitted an interrupt');
    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'prompt-priority' });
    await page.locator('.permission-card').waitFor({ state: 'detached', timeout: 1000 });

    const question = (promptId, generation) => ({
      type: 'question_prompt',
      contract_version: 1,
      prompt_id: promptId,
      session_id: sessionId,
      generation,
      kind: 'request_user_input',
      source: { surface: 'codex_cli', version: 'fixture' },
      title: 'Choose the exact disposable action',
      questions: [{
        question_id: 'route', header: 'Route', message: 'Select one route.',
        answer_mode: 'single', required: true, multi_select: false,
        choices: [{ choice_id: 'relay', label: 'Relay', description: 'Use the isolated fixture.' }],
      }],
      lifecycle: 'open',
      observed_at: new Date().toISOString(),
      deadline_at: null,
      auto_resolution_ms: null,
      auto_resolution_policy: null,
      cancel_supported: true,
    });
    send(question('question-answer', 'generation-answer'));
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 1000 });
    await page.locator('.permission-action').filter({ hasText: 'Relay' }).click();
    await page.locator('.permission-question-submit').click();
    await page.waitForTimeout(50);
    const answered = mutations.find(message => message.type === 'question_response' && message.prompt_id === 'question-answer');
    assert(answered, 'genuine question answer was not routed');
    assert.strictEqual(answered.generation, 'generation-answer');
    assert.strictEqual(answered.action, 'answer');
    assert.deepStrictEqual(answered.answers, [{ question_id: 'route', choice_ids: ['relay'] }]);
    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'question-answer' });
    await page.locator('.permission-card').waitFor({ state: 'detached', timeout: 1000 });

    send(question('question-cancel', 'generation-cancel'));
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 1000 });
    await page.locator('.permission-question-cancel').click();
    await page.waitForTimeout(50);
    const cancelled = mutations.find(message => message.type === 'question_response' && message.prompt_id === 'question-cancel');
    assert(cancelled, 'genuine question cancellation was not routed');
    assert.strictEqual(cancelled.generation, 'generation-cancel');
    assert.strictEqual(cancelled.action, 'cancel');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(cancelled, 'answers'), false);
    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'question-cancel' });
    await page.locator('.permission-card').waitFor({ state: 'detached', timeout: 1000 });

    await composer.focus();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.deepStrictEqual(mutations.filter(message => message.type === 'agent_interrupt').map(message => message.type),
      ['agent_interrupt', 'agent_interrupt']);

    setGenerating(false);
    await page.locator('.stop-btn').waitFor({ state: 'detached', timeout: 3000 });
    setGenerating(true);
    await page.locator('.stop-btn').waitFor({ state: 'visible', timeout: 3000 });
    await composer.focus();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    await page.waitForTimeout(2700);
    await confirm.waitFor({ state: 'detached', timeout: 1000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.strictEqual(mutations.filter(message => message.type === 'agent_interrupt').length, 2,
      'expired confirmation still interrupted');

    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible', timeout: 1000 });
    const mobileScreenshot = outputPath ? path.join(path.dirname(outputPath), 'escape-interrupt-mobile.png') : null;
    if (mobileScreenshot) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.input-area').screenshot({ path: mobileScreenshot, animations: 'disabled' });
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    assert.strictEqual(mutations.filter(message => message.type === 'agent_message').length, 0, 'fixture sent a user message');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      headless_isolated: headlessIsolated,
      browser_cdp: headlessIsolated ? null : cdpUrl,
      persistent_browser_pages: persistentPages,
      persistent_browser_touched: headlessIsolated ? 0 : 1,
      idle_escape_noop: true,
      first_escape_armed_only: true,
      double_escape_interrupts: 1,
      escape_then_enter_interrupts: 1,
      confirm_timeout_ms: 2500,
      expired_confirmation_noop: true,
      slash_menu_priority: true,
      permission_prompt_priority: true,
      genuine_question_answers: mutations.filter(message => message.type === 'question_response' && message.action === 'answer').length,
      genuine_question_cancels: mutations.filter(message => message.type === 'question_response' && message.action === 'cancel').length,
      agent_interrupts: mutations.filter(message => message.type === 'agent_interrupt').length,
      user_messages_sent: mutations.filter(message => message.type === 'agent_message').length,
      permission_responses: mutations.filter(message => message.type === 'permission_response').length,
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
    if (!headlessIsolated && page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (!headlessIsolated && page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
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
