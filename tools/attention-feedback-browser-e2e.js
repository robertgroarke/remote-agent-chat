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
const alpha = 'feedback-alpha';
const beta = 'feedback-beta';

const preferences = {
  permission_required: true,
  agent_ready: true,
  agent_error: true,
  session_offline: true,
  rate_limit_cleared: true,
  completion_sound: false,
  completion_haptic: false,
};

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
      if (request.method === 'PUT') {
        let raw = '';
        request.on('data', chunk => { raw += chunk; });
        request.on('end', () => {
          const body = JSON.parse(raw || '{}');
          Object.assign(preferences, body.preferences || {});
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: true, preferences }));
        });
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ preferences }));
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
      kind: value ? 'generating' : 'idle', generating: value, label: value ? 'Generating' : '',
    },
  });
  const prompt = (sessionId, promptId) => send({
    type: 'permission_prompt', session_id: sessionId, prompt_id: promptId,
    message: 'Review fixture permission.', timeout_ms: 300000,
    choices: [{ choice_id: 'deny', label: 'Deny' }],
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: [
        { session_id: alpha, agent_type: 'claude', title: 'Focused chat', chat_title: 'Focused chat', status: 'healthy', workspace_name: 'Remote Agent Chat' },
        { session_id: beta, agent_type: 'codex_cli', title: 'Background chat', chat_title: 'Background chat', status: 'healthy', workspace_name: 'Remote Agent Chat' },
      ], workspaces: [],
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
          type: 'history_chunk', session_id: sid, request_id: message.request_id,
          source: 'fixture', mode: 'tail', replace: message.replace !== false,
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
  let originalUrl;
  let originalViewport;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      window.__attentionCueStarts = 0;
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
      class FixtureAudioContext {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() { this.state = 'running'; return Promise.resolve(); }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
        createOscillator() {
          return {
            frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {}, stop() {},
            start() { window.__attentionCueStarts += 1; },
          };
        }
      }
      window.AudioContext = FixtureAudioContext;
      window.webkitAudioContext = FixtureAudioContext;
    });
    await page.locator(`.session-card[data-session-id="${alpha}"]`).waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(sessionId => document.querySelector('.session-card.active')?.dataset.sessionId === sessionId, alpha);

    prompt(beta, 'off-by-default');
    await page.locator('.attention-toast').waitFor({ state: 'visible', timeout: 2000 });
    assert.strictEqual(await page.evaluate(() => window.__attentionCueStarts), 0, 'default-off prompt played a cue');
    send({ type: 'permission_prompt_expired', session_id: beta, prompt_id: 'off-by-default' });
    await page.locator('.attention-toast').waitFor({ state: 'detached', timeout: 1000 });

    const settingsButton = page.getByRole('button', { name: 'Notification settings' });
    assert.strictEqual(await settingsButton.count(), 1, 'notification settings button must be unique');
    await settingsButton.click();
    await page.locator('.notification-settings-panel').waitFor({ state: 'visible', timeout: 2000 });
    const soundToggle = page.locator('label.notification-setting-row').filter({ hasText: 'Completion sound' }).locator('input');
    assert.strictEqual(await soundToggle.count(), 1, 'completion sound toggle must render exactly once');
    await soundToggle.check();
    await page.waitForFunction(element => !element.disabled, await soundToggle.elementHandle());
    await page.waitForFunction(() => window.__attentionCueStarts === 0);
    assert.strictEqual(preferences.completion_sound, true, 'completion sound preference did not persist');

    prompt(beta, 'enabled-prompt');
    await page.waitForFunction(() => window.__attentionCueStarts === 1);
    prompt(beta, 'enabled-prompt');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => window.__attentionCueStarts), 1, 'duplicate prompt replayed a cue');
    send({ type: 'permission_prompt_expired', session_id: beta, prompt_id: 'enabled-prompt' });

    setGenerating(beta, true);
    await page.waitForFunction(sessionId => document.querySelector(`.session-card[data-session-id="${sessionId}"] .session-card-native-status`), beta, { timeout: 2000 });
    await page.waitForTimeout(650);
    setGenerating(beta, false);
    await page.waitForFunction(() => window.__attentionCueStarts === 2);

    prompt(alpha, 'focused-prompt');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => window.__attentionCueStarts), 2, 'focused active prompt played a cue');
    send({ type: 'permission_prompt_expired', session_id: alpha, prompt_id: 'focused-prompt' });

    await soundToggle.uncheck();
    assert.strictEqual(preferences.completion_sound, false, 'completion sound preference did not disable');
    prompt(beta, 'disabled-again');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => window.__attentionCueStarts), 2, 'disabled prompt played a cue');
    send({ type: 'permission_prompt_expired', session_id: beta, prompt_id: 'disabled-again' });

    assert.deepStrictEqual(mutations, [], 'attention feedback fixture emitted a harness mutation');
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      default_off_silent: true,
      enabled_prompt_cues: 1,
      duplicate_prompt_suppressed: true,
      completion_cues: 1,
      focused_active_session_silent: true,
      disabled_again_silent: true,
      preference_restored_off: preferences.completion_sound === false,
      user_messages_sent: 0,
      controls_invoked: 0,
      visible_windows_opened: 0,
      external_focus_actions: 0,
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
