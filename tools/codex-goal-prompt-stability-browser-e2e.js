#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const {
  OPERATION_LOCK_PATH,
  acquirePidLock,
} = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'frontend');
const SESSION_ID = 'codex-goal-prompt-stability-fixture';
const PROMPT_ID = 'codex-question-stable-goal-resume';
const GENERATION = 'codex-goal-generation-stable';
const HISTORY_ROWS = 120;
const DRAFT = 'This complete operator message remains editable while the goal decision is open.';

function parseArgs(argv) {
  const options = {
    samples: 20,
    intervalMs: 25,
    output: '',
    screenshotDir: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--samples' && next) options.samples = Number(argv[++index]);
    else if (arg === '--interval-ms' && next) options.intervalMs = Number(argv[++index]);
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--screenshot-dir' && next) options.screenshotDir = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.samples) && options.samples >= 10, '--samples must be at least 10');
  assert(Number.isInteger(options.intervalMs) && options.intervalMs >= 10, '--interval-ms must be at least 10');
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  assert(match, `Headless Chrome not found; checked ${candidates.join(', ')}`);
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
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

function fixtureSession() {
  return {
    session_id: SESSION_ID,
    agent_type: 'codex_cli',
    title: 'Owned Codex goal prompt stability',
    chat_title: 'Owned Codex goal prompt stability',
    status: 'healthy',
    health: 'connected',
    workspace_name: 'Synthetic RAC acceptance',
    workspace_path: 'C:\\synthetic\\rac-goal-prompt',
    is_test_session: false,
    control_generation: 1,
    turn_generation: 1,
  };
}

function fixtureMessages() {
  const base = Date.parse('2026-07-21T20:00:00.000Z');
  return Array.from({ length: HISTORY_ROWS }, (_, index) => ({
    id: `goal-prompt-history-${index + 1}`,
    source_message_id: `goal-prompt-source-${index + 1}`,
    sequence: index + 1,
    ts: (base + index * 1000) / 1000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Deterministic prompt-stability history row ${index + 1}`,
  }));
}

function questionPrompt(promptId = PROMPT_ID, generation = GENERATION) {
  return {
    type: 'question_prompt',
    contract_version: 1,
    prompt_id: promptId,
    session_id: SESSION_ID,
    generation,
    kind: 'request_user_input',
    source: { surface: 'codex_cli', version: '0.144.6' },
    title: 'Resume paused goal?',
    questions: [{
      question_id: 'goal_decision',
      header: 'Goal',
      message: 'Resume this goal now?',
      answer_mode: 'single',
      required: true,
      multi_select: false,
      choices: [
        { choice_id: 'resume', label: 'Resume', description: 'Continue the active goal.' },
        { choice_id: 'stay_paused', label: 'Stay paused', description: 'Keep the goal paused.' },
      ],
    }],
    lifecycle: 'open',
    observed_at: '2026-07-21T20:02:00.000Z',
    deadline_at: null,
    auto_resolution_ms: null,
    auto_resolution_policy: null,
    cancel_supported: false,
  };
}

function instrumentationScript(theme) {
  localStorage.setItem('remote-agent-chat-theme', theme);
  const state = window.__RAC_GOAL_PROMPT_WATCH__ = {
    active: false,
    scrollWrites: 0,
    membershipFlaps: 0,
    remounts: 0,
    focusLosses: 0,
    caretDrifts: 0,
    clickabilityFailures: 0,
    maxScrollDriftPx: 0,
    samples: 0,
    card: null,
    baselineScrollTop: 0,
    expectedValue: '',
    expectedSelectionStart: 0,
    expectedSelectionEnd: 0,
  };
  let descriptorOwner = Element.prototype;
  while (descriptorOwner && !Object.getOwnPropertyDescriptor(descriptorOwner, 'scrollTop')) {
    descriptorOwner = Object.getPrototypeOf(descriptorOwner);
  }
  const descriptor = descriptorOwner && Object.getOwnPropertyDescriptor(descriptorOwner, 'scrollTop');
  if (descriptor?.get && descriptor?.set && descriptor.configurable) {
    Object.defineProperty(descriptorOwner, 'scrollTop', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if (state.active && this?.classList?.contains('messages')) state.scrollWrites += 1;
        return descriptor.set.call(this, value);
      },
    });
  }
  const inspect = () => {
    if (!state.active) return;
    const cards = document.querySelectorAll('.messages .permission-card');
    if (cards.length !== 1) state.membershipFlaps += 1;
    const card = cards[0] || null;
    if (card && state.card && card !== state.card) state.remounts += 1;
    if (card && !state.card) state.card = card;
  };
  const observer = new MutationObserver(inspect);
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('focusout', event => {
    if (!state.active || !event.target?.matches?.('.input-area textarea')) return;
    const target = event.target;
    setTimeout(() => {
      if (state.active && document.activeElement !== target) state.focusLosses += 1;
    }, 0);
  }, true);
  state.start = ({ value, selectionStart, selectionEnd }) => {
    const list = document.querySelector('.messages');
    const composer = document.querySelector('.input-area textarea');
    const card = document.querySelector('.messages .permission-card');
    if (!list || !composer || !card) throw new Error('prompt watch surface is not ready');
    state.active = true;
    state.scrollWrites = 0;
    state.membershipFlaps = 0;
    state.remounts = 0;
    state.focusLosses = 0;
    state.caretDrifts = 0;
    state.clickabilityFailures = 0;
    state.maxScrollDriftPx = 0;
    state.samples = 0;
    state.card = card;
    state.baselineScrollTop = list.scrollTop;
    state.expectedValue = value;
    state.expectedSelectionStart = selectionStart;
    state.expectedSelectionEnd = selectionEnd;
  };
  state.sample = () => {
    const list = document.querySelector('.messages');
    const composer = document.querySelector('.input-area textarea');
    const cards = document.querySelectorAll('.messages .permission-card');
    const choice = document.querySelector('.messages .permission-action');
    if (cards.length !== 1) state.membershipFlaps += 1;
    const card = cards[0] || null;
    if (card && state.card && card !== state.card) state.remounts += 1;
    if (document.activeElement !== composer) state.focusLosses += 1;
    if (composer?.value !== state.expectedValue
        || composer?.selectionStart !== state.expectedSelectionStart
        || composer?.selectionEnd !== state.expectedSelectionEnd) state.caretDrifts += 1;
    const rect = choice?.getBoundingClientRect?.();
    const style = choice ? getComputedStyle(choice) : null;
    if (!choice || choice.disabled || !rect || rect.width <= 0 || rect.height <= 0
        || style?.visibility === 'hidden' || style?.display === 'none' || style?.pointerEvents === 'none') {
      state.clickabilityFailures += 1;
    }
    state.maxScrollDriftPx = Math.max(state.maxScrollDriftPx,
      Math.abs((list?.scrollTop || 0) - state.baselineScrollTop));
    state.samples += 1;
  };
  state.stop = () => {
    state.active = false;
    return {
      scroll_writes: state.scrollWrites,
      prompt_membership_flaps: state.membershipFlaps,
      prompt_remounts: state.remounts,
      focus_losses: state.focusLosses,
      caret_drifts: state.caretDrifts,
      clickability_failures: state.clickabilityFailures,
      max_scroll_drift_px: Number(state.maxScrollDriftPx.toFixed(3)),
      samples: state.samples,
      final_scroll_top: document.querySelector('.messages')?.scrollTop || 0,
      final_prompt_count: document.querySelectorAll('.messages .permission-card').length,
      final_composer_value: document.querySelector('.input-area textarea')?.value || '',
    };
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const releaseOperationLock = acquirePidLock(
    OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'codex-goal-prompt-stability-browser-e2e',
      kind: 'formal-headless-acceptance',
    })}\n`,
  );
  const port = await freePort();
  const sockets = new Set();
  const clientFrames = [];
  const mutations = [];
  const stateEpoch = `goal-prompt-stability-${Date.now()}`;
  let stateSeq = 0;
  const session = fixtureSession();
  const history = fixtureMessages();
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
    if (new URL(request.url, `http://127.0.0.1:${port}`).pathname !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  const frame = payload => ({ state_epoch: stateEpoch, state_seq: ++stateSeq, ...payload });
  const send = (ws, payload) => ws.readyState === 1 && ws.send(JSON.stringify(frame(payload)));
  const broadcast = payload => {
    const encoded = JSON.stringify(frame(payload));
    for (const ws of sockets) if (ws.readyState === 1) ws.send(encoded);
  };
  const ack = (ws, openQuestions) => send(ws, {
    type: 'connection_ack',
    heartbeat_interval_ms: 1000,
    heartbeat_timeout_ms: 5000,
    sessions: [session],
    workspaces: [],
    agent_configs: {
      [SESSION_ID]: { session_id: SESSION_ID, capabilities: { interrupt: true, question_prompts: true } },
    },
    ...(openQuestions ? { open_question_prompts: openQuestions } : {}),
  });
  wss.on('connection', ws => {
    sockets.add(ws);
    ack(ws, null);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrames.push(message.type || 'unknown');
      if (['question_response', 'agent_message', 'permission_response'].includes(message.type)) mutations.push(message);
      const sid = message.session_id || message.session;
      if (message.type === 'subscribe') {
        send(ws, { type: 'session_list', sessions: [session] });
      } else if (message.type === 'heartbeat') {
        send(ws, { type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send(ws, { type: 'agent_config', session_id: sid, capabilities: { interrupt: true, question_prompts: true } });
      } else if (message.type === 'history_chunk_request') {
        send(ws, {
          type: 'history_chunk', session_id: sid, request_id: message.request_id,
          source: 'fixture', mode: 'tail', replace: message.replace !== false,
          messages: history, total_messages: history.length, loaded_messages: history.length, partial: false,
        });
      } else if (message.type === 'get_history') {
        send(ws, { type: 'history', session: sid, request_id: message.request_id, messages: history });
      } else if (message.type === 'history_request') {
        send(ws, {
          type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id,
          messages: [], loaded_messages: 0, total_messages: history.length,
        });
      }
    });
  });

  let browser;
  const surfaces = [
    { name: 'desktop-dark', theme: 'dark', viewport: { width: 1440, height: 900 } },
    { name: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 900 } },
    { name: 'mobile-dark', theme: 'dark', viewport: { width: 390, height: 844 } },
    { name: 'mobile-light', theme: 'light', viewport: { width: 390, height: 844 } },
  ];
  try {
    await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    for (const surface of surfaces) {
      surface.context = await browser.newContext({ viewport: surface.viewport });
      await surface.context.addInitScript(instrumentationScript, surface.theme);
      surface.page = await surface.context.newPage();
      await surface.page.goto(`http://127.0.0.1:${port}/?session=${SESSION_ID}`, {
        waitUntil: 'domcontentloaded', timeout: 30_000,
      });
      await surface.page.waitForFunction(({ sessionId, rows }) => (
        document.querySelector('.session-card.active')?.dataset?.sessionId === sessionId
          && Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0) === rows
          && !!document.querySelector('.input-area textarea')
      ), { sessionId: SESSION_ID, rows: HISTORY_ROWS }, { timeout: 30_000 });
    }
    assert.strictEqual(sockets.size, surfaces.length, 'every responsive/theme surface must own a fixture connection');

    broadcast(questionPrompt());
    await Promise.all(surfaces.map(surface => surface.page.locator('.messages .permission-card')
      .waitFor({ state: 'visible', timeout: 5000 })));
    const caret = 23;
    for (const surface of surfaces) {
      const composer = surface.page.locator('.input-area textarea');
      await composer.fill(DRAFT);
      await composer.evaluate((node, position) => {
        node.focus();
        node.setSelectionRange(position, position);
      }, caret);
      await surface.page.evaluate(({ value, position }) => {
        window.__RAC_GOAL_PROMPT_WATCH__.start({
          value, selectionStart: position, selectionEnd: position,
        });
      }, { value: DRAFT, position: caret });
    }

    const watchStartedAt = Date.now();
    broadcast({
      type: 'message_delta', session_id: SESSION_ID, message_id: 'goal-prompt-stream',
      block_index: 0, seq: 0, op: 'block_open',
    });
    let rekeysSent = 0;
    let omittedAcksSent = 0;
    for (let sample = 0; sample < options.samples; sample += 1) {
      if (sample > 0 && sample % 25 === 0) {
        for (const ws of sockets) ack(ws, null);
        omittedAcksSent += sockets.size;
      }
      if (sample > 0 && sample % 137 === 0) {
        broadcast(questionPrompt(`transient-rekey-${sample}`, `transient-generation-${sample}`));
        rekeysSent += 1;
      } else {
        broadcast(questionPrompt());
      }
      broadcast({
        type: 'message_delta', session_id: SESSION_ID, message_id: 'goal-prompt-stream',
        block_index: 0, seq: sample + 1, op: 'append', append: sample === 0 ? 'Streaming' : '.',
      });
      const settleMs = Math.min(50, Math.max(5, Math.floor(options.intervalMs / 2)));
      await new Promise(resolve => setTimeout(resolve, settleMs));
      await Promise.all(surfaces.map(surface => surface.page.evaluate(() => {
        window.__RAC_GOAL_PROMPT_WATCH__.sample();
      })));
      await new Promise(resolve => setTimeout(resolve, Math.max(0, options.intervalMs - settleMs)));
    }
    const watchEndedAt = Date.now();
    const surfaceResults = {};
    for (const surface of surfaces) {
      surfaceResults[surface.name] = await surface.page.evaluate(() => window.__RAC_GOAL_PROMPT_WATCH__.stop());
      if (options.screenshotDir) {
        fs.mkdirSync(options.screenshotDir, { recursive: true });
        const screenshot = path.join(options.screenshotDir, `${surface.name}.png`);
        await surface.page.locator('.messages-wrap').screenshot({ path: screenshot, animations: 'disabled' });
        surfaceResults[surface.name].screenshot = path.relative(ROOT, screenshot);
      }
    }

    const primary = surfaces[0].page;
    await primary.locator('.permission-action').filter({ hasText: 'Resume' }).click();
    await primary.locator('.permission-question-submit').click();
    await waitFor(() => mutations.some(message => message.type === 'question_response'
      && message.prompt_id === PROMPT_ID && message.action === 'answer'), 5000, 'stable question response');
    const answer = mutations.find(message => message.type === 'question_response'
      && message.prompt_id === PROMPT_ID && message.action === 'answer');
    assert(answer, 'the stable Resume answer was not routed to the fixture');
    assert.deepStrictEqual(answer.answers, [{ question_id: 'goal_decision', choice_ids: ['resume'] }]);
    broadcast({
      type: 'question_prompt_state', session_id: SESSION_ID,
      prompt_id: PROMPT_ID, generation: GENERATION, lifecycle: 'answered',
      terminal_at: new Date().toISOString(),
    });
    await Promise.all(surfaces.map(surface => surface.page.locator('.messages .permission-card')
      .waitFor({ state: 'detached', timeout: 5000 })));
    const finalSuffix = ' It remains ready to send after resolution.';
    const composer = primary.locator('.input-area textarea');
    await composer.focus();
    await composer.press('End');
    await composer.type(finalSuffix);
    assert.strictEqual(await composer.inputValue(), `${DRAFT}${finalSuffix}`);

    const actualDurationMs = watchEndedAt - watchStartedAt;
    const formal = options.samples >= 600 && options.intervalMs >= 1000;
    const surfacePass = Object.values(surfaceResults).every(item => (
      item.samples === options.samples
      && item.scroll_writes === 0
      && item.prompt_membership_flaps === 0
      && item.prompt_remounts === 0
      && item.focus_losses === 0
      && item.caret_drifts === 0
      && item.clickability_failures === 0
      && item.max_scroll_drift_px <= 1
      && item.final_prompt_count === 1
      && item.final_composer_value === DRAFT
    ));
    const durationPass = !formal || actualDurationMs >= options.samples * options.intervalMs;
    const result = {
      ok: surfacePass && durationPass && mutations.filter(item => item.type === 'question_response').length === 1,
      generated_at: new Date().toISOString(),
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      bundle_sha256: crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(PUBLIC_ROOT, 'dist', 'bundle.js'))).digest('hex'),
      acceptance_class: formal ? 'formal_600_sample_one_second_goal_prompt_watch' : 'diagnostic_goal_prompt_watch',
      watch: {
        requested_samples: options.samples,
        recorded_samples_per_surface: Object.fromEntries(Object.entries(surfaceResults).map(([name, value]) => [name, value.samples])),
        interval_ms: options.intervalMs,
        actual_duration_ms: actualDurationMs,
        duration_pass: durationPass,
        stable_prompt_replays: options.samples - rekeysSent,
        same_semantic_rekeys: rekeysSent,
        incomplete_connection_acks: omittedAcksSent,
        streamed_delta_frames: options.samples + 1,
      },
      prompt: {
        prompt_id: PROMPT_ID,
        generation: GENERATION,
        answer_routed_once: true,
        explicit_terminal_detached_once: true,
        composer_editable_while_open: true,
        full_message_typed_without_interruption: true,
      },
      surfaces: surfaceResults,
      protocol: {
        connections: sockets.size,
        question_responses: mutations.filter(item => item.type === 'question_response').length,
        user_messages_sent: mutations.filter(item => item.type === 'agent_message').length,
        client_frame_types: Object.fromEntries([...new Set(clientFrames)].map(type => (
          [type, clientFrames.filter(value => value === type).length]
        ))),
      },
      safety: {
        headless: true,
        visible_windows_opened: 0,
        external_focus_actions: 0,
        protected_sessions_touched: 0,
        production_mutations: 0,
        proxy_restarts: 0,
        deploys: 0,
        operation_lock: OPERATION_LOCK_PATH,
      },
      total_elapsed_ms: Date.now() - startedAt,
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
    assert.strictEqual(result.ok, true, 'Codex goal prompt stability acceptance failed');
  } finally {
    for (const surface of surfaces) await surface.context?.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    releaseOperationLock();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
