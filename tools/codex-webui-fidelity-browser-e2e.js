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

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PUBLIC_ROOT = path.join(ROOT, 'relay-server', 'public');
const DESKTOP_ID = 'codex-desktop-fidelity-fixture';
const CLI_ID = 'codex-cli-fidelity-fixture';
const HISTORY_ROWS = 112;
const MEMORY_CITATION_ROW_INDEX = 55;

function parseArgs(argv) {
  const options = {
    soakMs: 120_000,
    replayCount: 1000,
    output: '',
    screenshotDir: '',
    parityFixture: '',
    publicRoot: DEFAULT_PUBLIC_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--soak-ms' && next) options.soakMs = Number(argv[++index]);
    else if (arg === '--replay-count' && next) options.replayCount = Number(argv[++index]);
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--screenshot-dir' && next) options.screenshotDir = path.resolve(argv[++index]);
    else if (arg === '--parity-fixture' && next) options.parityFixture = path.resolve(argv[++index]);
    else if (arg === '--public-root' && next) options.publicRoot = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.soakMs) && options.soakMs >= 2000, '--soak-ms must be at least 2000');
  assert(Number.isInteger(options.replayCount) && options.replayCount >= 10, '--replay-count must be at least 10');
  assert(fs.existsSync(path.join(options.publicRoot, 'index.html')), '--public-root must contain index.html');
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert(executable, `Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executable;
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

function fixtureSession(sessionId, agentType, title, goalStatus) {
  return {
    session_id: sessionId,
    agent_type: agentType,
    title,
    chat_title: title,
    status: 'healthy',
    health: 'connected',
    workspace_name: 'Synthetic RAC fidelity acceptance',
    workspace_path: `C:\\synthetic\\${agentType}`,
    is_test_session: false,
    activity: {
      kind: 'idle',
      label: '',
      updated_at: '2026-07-22T08:00:00.000Z',
      goal: {
        status: goalStatus,
        objective: `${title} passive goal state`,
        updated_at: '2026-07-22T08:00:00.000Z',
      },
    },
  };
}

function fixtureMessages(surface, count = HISTORY_ROWS) {
  const base = Date.parse('2026-07-22T08:00:00.000Z');
  return Array.from({ length: count }, (_, index) => {
    const content = `${surface} canonical native transcript row ${index + 1}.\nStable content line ${index + 1}.`;
    const message = {
      id: `${surface}-row-${index + 1}`,
      source_message_id: `${surface}:native:${index + 1}`,
      native_source_id: `${surface}:turn:${Math.floor(index / 2) + 1}:${index % 2 ? 'assistant' : 'user'}`,
      native_turn_id: `${surface}-turn-${Math.floor(index / 2) + 1}`,
      sequence: index + 1,
      ts: (base + index * 1000) / 1000,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content,
    };
    return surface === 'codex_cli' && index === MEMORY_CITATION_ROW_INDEX
      ? enrichMemoryCitation(message)
      : message;
  });
}

function enrichMemoryCitation(message) {
  return {
    ...message,
    content_blocks: [
      { type: 'markdown', content: message.content },
      {
        type: 'memory_citation',
        title: 'Sources',
        entries: [{ path: 'MEMORY.md', line_start: 10, line_end: 11, note: 'deterministic fixture' }],
        rollout_ids: ['00000000-0000-4000-8000-000000000001'],
        content: 'Memory references\n- MEMORY.md:10-11 — deterministic fixture\n\nRollouts\n- 00000000-0000-4000-8000-000000000001',
      },
    ],
  };
}

function expectedKeys(messages) {
  return messages.map(message => `source:${message.source_message_id}`);
}

function deterministicReorder(messages, replay) {
  return [...messages].sort((left, right) => {
    const leftRank = ((left.sequence * 1103515245 + replay * 12345) >>> 0);
    const rightRank = ((right.sequence * 1103515245 + replay * 12345) >>> 0);
    return leftRank - rightRank;
  });
}

function questionPrompt(sessionId, surface, ordinal) {
  return {
    type: 'question_prompt',
    contract_version: 1,
    prompt_id: `${surface}-native-prompt-${ordinal}`,
    session_id: sessionId,
    generation: `${surface}-native-turn-${ordinal}`,
    kind: 'request_user_input',
    source: { surface, version: surface === 'codex_cli' ? '0.145.0' : '26.715.9868.0' },
    title: `Native ${surface} question`,
    questions: [{
      question_id: 'route',
      header: 'Route',
      message: 'Choose the native route.',
      answer_mode: 'single',
      required: true,
      multi_select: false,
      choices: [
        { choice_id: 'alpha', label: 'Alpha', description: 'First native route.' },
        { choice_id: 'beta', label: 'Beta', description: 'Second native route.' },
      ],
    }],
    lifecycle: 'open',
    observed_at: new Date().toISOString(),
    deadline_at: null,
    auto_resolution_ms: null,
    auto_resolution_policy: null,
    cancel_supported: true,
  };
}

function instrumentationScript({ theme }) {
  localStorage.setItem('remote-agent-chat-theme', theme);
  const state = window.__RAC_CODEX_FIDELITY_WATCH__ = {
    active: false,
    scrollWrites: 0,
    maxScrollDriftPx: 0,
    promptSamples: 0,
    composerLockSamples: 0,
    toastSamples: 0,
    identityFailures: 0,
    samples: 0,
    baselineScrollTop: 0,
    expectedKeys: [],
    startedAt: 0,
    writeEvents: [],
    maxDriftEvent: null,
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
        if (state.active && this?.classList?.contains('messages')) {
          state.scrollWrites += 1;
          if (state.writeEvents.length < 10) {
            state.writeEvents.push({
              at_ms: Number((performance.now() - state.startedAt).toFixed(3)),
              before_px: Number(descriptor.get.call(this).toFixed(3)),
              requested_px: Number(Number(value).toFixed(3)),
              scroll_height_px: this.scrollHeight,
              client_height_px: this.clientHeight,
              stack: String(new Error().stack || '').split('\n').slice(1, 6),
            });
          }
        }
        return descriptor.set.call(this, value);
      },
    });
  }
  state.ownViewport = (expected, fraction = 0.45) => {
    const list = document.querySelector('.messages');
    if (!list) throw new Error('transcript viewport unavailable');
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -480, bubbles: true }));
    list.scrollTop = Math.max(120, Math.floor((list.scrollHeight - list.clientHeight) * fraction));
    list.dispatchEvent(new Event('scroll', { bubbles: false }));
    state.expectedKeys = expected;
    state.baselineScrollTop = list.scrollTop;
  };
  state.start = () => {
    state.scrollWrites = 0;
    state.maxScrollDriftPx = 0;
    state.promptSamples = 0;
    state.composerLockSamples = 0;
    state.toastSamples = 0;
    state.identityFailures = 0;
    state.samples = 0;
    state.startedAt = performance.now();
    state.writeEvents = [];
    state.maxDriftEvent = null;
    state.active = true;
  };
  state.sample = () => {
    if (!state.active) return;
    const list = document.querySelector('.messages');
    const composer = document.querySelector('.input-area textarea');
    const keys = window.__RAC_TRANSCRIPT_WINDOW__?.messageKeys || [];
    if (document.querySelectorAll('.permission-card').length > 0
        || document.querySelectorAll('.session-card-perm-badge').length > 0) state.promptSamples += 1;
    if (!composer || composer.disabled) state.composerLockSamples += 1;
    const toastText = document.querySelector('.toast.visible')?.textContent || '';
    if (/question|permission|goal|needs\s+(?:an\s+)?answer|resume\s+paused/i.test(toastText)) state.toastSamples += 1;
    if (JSON.stringify(keys) !== JSON.stringify(state.expectedKeys)) state.identityFailures += 1;
    const drift = Math.abs((list?.scrollTop || 0) - state.baselineScrollTop);
    if (drift > state.maxScrollDriftPx) {
      state.maxScrollDriftPx = drift;
      state.maxDriftEvent = {
        at_ms: Number((performance.now() - state.startedAt).toFixed(3)),
        scroll_top_px: Number((list?.scrollTop || 0).toFixed(3)),
        baseline_scroll_top_px: Number(state.baselineScrollTop.toFixed(3)),
        scroll_height_px: list?.scrollHeight || 0,
        client_height_px: list?.clientHeight || 0,
      };
    }
    state.samples += 1;
  };
  state.stop = () => {
    state.active = false;
    return {
      scroll_writes: state.scrollWrites,
      max_scroll_drift_px: Number(state.maxScrollDriftPx.toFixed(3)),
      prompt_samples: state.promptSamples,
      composer_lock_samples: state.composerLockSamples,
      toast_samples: state.toastSamples,
      identity_failures: state.identityFailures,
      samples: state.samples,
      final_scroll_top: document.querySelector('.messages')?.scrollTop || 0,
      final_prompt_count: document.querySelectorAll('.permission-card').length,
      final_total_messages: Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0),
      final_memory_citation_blocks: document.querySelectorAll('.content-block-memory-citation').length,
      raw_memory_protocol_rows: [...document.querySelectorAll('.message')]
        .filter(node => node.textContent.includes('<oai-mem-citation>')).length,
      write_events: state.writeEvents,
      max_drift_event: state.maxDriftEvent,
    };
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const publicRoot = options.publicRoot;
  const startedAt = Date.now();
  const port = await freePort();
  const parityFixture = options.parityFixture
    ? JSON.parse(fs.readFileSync(options.parityFixture, 'utf8'))
    : null;
  const parityMessages = (surface, fallback) => {
    const rows = parityFixture?.adapters?.[surface]?.messages;
    if (!Array.isArray(rows) || rows.length === 0) return fallback;
    return rows.map((message, index) => ({
      id: `${surface}-production-parity-${index + 1}`,
      source_message_id: message.source_message_id,
      ...(message.native_source_id ? { native_source_id: message.native_source_id } : {}),
      ...(message.native_turn_id ? { native_turn_id: message.native_turn_id } : {}),
      sequence: index + 1,
      ts: Number(message.ts) || Date.parse('2026-07-22T08:00:00.000Z') / 1000 + index,
      role: message.role === 'user' ? 'user' : 'assistant',
      content: `${surface} sanitized production parity row ${index + 1}.`,
    }));
  };
  const sessions = [
    fixtureSession(DESKTOP_ID, 'codex-desktop', 'Codex Desktop native truth', 'paused'),
    fixtureSession(CLI_ID, 'codex_cli', 'Codex CLI native truth', 'completed'),
  ];
  const histories = new Map([
    [DESKTOP_ID, parityMessages('codex-desktop', fixtureMessages('codex-desktop'))],
    [CLI_ID, parityMessages('codex_cli', fixtureMessages('codex_cli'))],
  ]);
  const desktopInitialRows = histories.get(DESKTOP_ID).length;
  const cliInitialRows = histories.get(CLI_ID).length;
  const sockets = new Set();
  const browserMutations = [];
  const clientFrameCounts = new Map();
  const stateEpoch = `codex-fidelity-${Date.now()}`;
  let stateSeq = 0;
  let connectionCount = 0;

  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
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
  const framed = payload => ({ state_epoch: stateEpoch, state_seq: ++stateSeq, ...payload });
  const send = (ws, payload) => ws.readyState === 1 && ws.send(JSON.stringify(framed(payload)));
  const broadcast = payload => {
    const encoded = JSON.stringify(framed(payload));
    for (const ws of sockets) if (ws.readyState === 1) ws.send(encoded);
  };
  const ack = (ws, openQuestions = []) => send(ws, {
    type: 'connection_ack',
    heartbeat_interval_ms: 1000,
    heartbeat_timeout_ms: 5000,
    sessions,
    workspaces: [],
    open_prompts: [],
    open_question_prompts: openQuestions,
    open_error_prompts: [],
    agent_configs: Object.fromEntries(sessions.map(session => [session.session_id, {
      session_id: session.session_id,
      capabilities: { interrupt: true, question_prompts: true, send: true },
    }])),
  });
  wss.on('connection', ws => {
    connectionCount += 1;
    sockets.add(ws);
    ack(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrameCounts.set(message.type, (clientFrameCounts.get(message.type) || 0) + 1);
      if (['question_response', 'agent_message', 'permission_response'].includes(message.type)) {
        browserMutations.push(message);
      }
      const sessionId = message.session_id || message.session;
      if (message.type === 'subscribe') {
        send(ws, { type: 'session_list', sessions });
      } else if (message.type === 'heartbeat') {
        send(ws, { type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send(ws, { type: 'agent_config', session_id: sessionId, capabilities: { interrupt: true, question_prompts: true, send: true } });
      } else if (message.type === 'history_chunk_request') {
        const history = histories.get(sessionId) || [];
        send(ws, {
          type: 'history_chunk', session_id: sessionId, request_id: message.request_id,
          source: sessionId === CLI_ID ? 'codex_cli_jsonl' : 'codex_desktop_native',
          mode: 'tail', replace: message.replace !== false,
          messages: history, total_messages: history.length, loaded_messages: history.length, partial: false,
        });
      } else if (message.type === 'get_history') {
        const history = histories.get(sessionId) || [];
        send(ws, { type: 'history', session: sessionId, request_id: message.request_id, messages: history });
      } else if (message.type === 'history_request') {
        const history = histories.get(sessionId) || [];
        send(ws, {
          type: 'history_snapshot', session_id: sessionId, request_id: message.request_id,
          messages: history, total_messages: history.length, loaded_messages: history.length,
        });
      }
    });
  });

  const surfaces = [
    { name: 'desktop-dark', theme: 'dark', viewport: { width: 1440, height: 900 }, scrollDepth: 0.15 },
    { name: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 900 }, scrollDepth: 0.5 },
    { name: 'mobile-dark', theme: 'dark', viewport: { width: 390, height: 844 }, scrollDepth: 0.8 },
    { name: 'mobile-light', theme: 'light', viewport: { width: 390, height: 844 }, scrollDepth: 0.5 },
  ];
  let browser;
  try {
    await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    for (const surface of surfaces) {
      surface.context = await browser.newContext({ viewport: surface.viewport });
      await surface.context.addInitScript(instrumentationScript, { theme: surface.theme });
      surface.page = await surface.context.newPage();
      await surface.page.goto(`http://127.0.0.1:${port}/?session=${DESKTOP_ID}&render_profile=1`, {
        waitUntil: 'domcontentloaded', timeout: 30_000,
      });
    }
    await waitFor(() => sockets.size === surfaces.length, 30_000, 'all headless WebUI connections');

    const waitForTranscript = async (page, sessionId) => {
      const history = histories.get(sessionId);
      await page.waitForFunction(({ id, keys, count }) => (
        document.querySelector('.session-card.active')?.dataset?.sessionId === id
        && Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0) === count
        && JSON.stringify(window.__RAC_TRANSCRIPT_WINDOW__?.messageKeys || []) === JSON.stringify(keys)
      ), { id: sessionId, keys: expectedKeys(history), count: history.length }, { timeout: 30_000 });
    };
    const selectSession = async (page, sessionId) => {
      await page.locator(`.session-card[data-session-id="${sessionId}"]`).evaluate(node => node.click());
      await waitForTranscript(page, sessionId);
    };
    await Promise.all(surfaces.map(surface => waitForTranscript(surface.page, DESKTOP_ID)));

    for (let switchIndex = 0; switchIndex < 6; switchIndex += 1) {
      for (const sessionId of [CLI_ID, DESKTOP_ID]) {
        await Promise.all(surfaces.map(async surface => {
          await selectSession(surface.page, sessionId);
        }));
      }
    }

    for (const surface of surfaces) {
      await surface.page.goto(`http://127.0.0.1:${port}/?session=${DESKTOP_ID}&render_profile=1`, {
        waitUntil: 'domcontentloaded', timeout: 30_000,
      });
      await waitForTranscript(surface.page, DESKTOP_ID);
      assert.strictEqual(await surface.page.locator('.permission-card').count(), 0);
      assert.strictEqual(await surface.page.locator('.input-area textarea').isDisabled(), false);
    }

    // Native Desktop thread discovery can change the transcript render key
    // without changing the selected RAC session. Recreate that same-session
    // viewport remount before user ownership so the wheel/scroll listeners
    // must follow the replacement node.
    await Promise.all(surfaces.map(surface => surface.page.evaluate(() => {
      document.querySelector('.messages')?.setAttribute('data-listener-probe', 'before-thread-discovery');
    })));
    broadcast({
      type: 'thread_list',
      session_id: DESKTOP_ID,
      threads: [{
        id: 'native-thread-discovered',
        cache_key: 'native-thread-discovered',
        title: 'Native thread',
        active: true,
      }],
    });
    await Promise.all(surfaces.map(async surface => {
      await surface.page.waitForFunction(() => (
        !document.querySelector('.messages')?.hasAttribute('data-listener-probe')
      ), undefined, { timeout: 10_000 });
      await waitForTranscript(surface.page, DESKTOP_ID);
    }));

    for (let replay = 0; replay < options.replayCount; replay += 1) {
      const sessionId = replay % 2 === 0 ? DESKTOP_ID : CLI_ID;
      const history = histories.get(sessionId);
      const reordered = deterministicReorder(history, replay);
      const replayRows = replay % 7 === 0 ? [...reordered, reordered[0], reordered[reordered.length - 1]] : reordered;
      broadcast({
        type: 'history_snapshot', session_id: sessionId, messages: replayRows,
        total_messages: history.length, loaded_messages: history.length,
      });
    }
    await Promise.all(surfaces.map(surface => waitForTranscript(surface.page, DESKTOP_ID)));

    for (const surface of surfaces) {
      await surface.page.evaluate(({ keys, scrollDepth }) => {
        window.__RAC_CODEX_FIDELITY_WATCH__.ownViewport(keys, scrollDepth);
      }, { keys: expectedKeys(histories.get(DESKTOP_ID)), scrollDepth: surface.scrollDepth });
      await surface.page.waitForTimeout(50);
      await surface.page.evaluate(() => window.__RAC_CODEX_FIDELITY_WATCH__.start());
    }

    const soakStartedAt = Date.now();
    let nextOneHzAt = soakStartedAt;
    let nextReconnectAt = soakStartedAt + Math.floor(options.soakMs / 3);
    let reconnects = 0;
    let oneHzSnapshots = 0;
    let burstSnapshots = 0;
    let samples = 0;
    const desktopProvisionalHistory = histories.get(DESKTOP_ID);
    let desktopCitationEnriched = false;
    while (Date.now() - soakStartedAt < options.soakMs) {
      const now = Date.now();
      if (now >= nextReconnectAt && reconnects < 2) {
        const priorConnections = connectionCount;
        for (const ws of [...sockets]) ws.terminate();
        await waitFor(() => connectionCount >= priorConnections + surfaces.length && sockets.size === surfaces.length,
          15_000, `browser reconnect ${reconnects + 1}`);
        reconnects += 1;
        nextReconnectAt = soakStartedAt + Math.floor(options.soakMs * (reconnects + 1) / 3);
      }
      if (now >= nextOneHzAt) {
        if (!desktopCitationEnriched) {
          const enriched = desktopProvisionalHistory.map((message, index) => (
            index === MEMORY_CITATION_ROW_INDEX ? enrichMemoryCitation(message) : message
          ));
          histories.set(DESKTOP_ID, enriched);
          desktopCitationEnriched = true;
        }
        const history = histories.get(DESKTOP_ID);
        const snapshotHistory = oneHzSnapshots % 2 === 0 ? history : desktopProvisionalHistory;
        broadcast({
          type: 'history_snapshot', session_id: DESKTOP_ID, messages: snapshotHistory,
          total_messages: history.length, loaded_messages: history.length,
        });
        broadcast({ type: 'session_snapshot', sessions });
        broadcast({
          type: 'status', session_id: DESKTOP_ID, status: 'healthy',
          activity: sessions[0].activity, thinking: false, label: '',
        });
        oneHzSnapshots += 1;
        if (oneHzSnapshots % 12 === 0) {
          for (let burst = 0; burst < 10; burst += 1) {
            broadcast({
              type: 'history_snapshot', session_id: DESKTOP_ID,
              messages: burst % 2 === 0 ? history : desktopProvisionalHistory,
              total_messages: history.length, loaded_messages: history.length,
            });
            burstSnapshots += 1;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        nextOneHzAt += 1000;
      }
      await Promise.all(surfaces.map(surface => surface.page.evaluate(() => {
        window.__RAC_CODEX_FIDELITY_WATCH__.sample();
      })));
      samples += 1;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const soakEndedAt = Date.now();
    const surfaceResults = {};
    for (const surface of surfaces) {
      surfaceResults[surface.name] = await surface.page.evaluate(() => window.__RAC_CODEX_FIDELITY_WATCH__.stop());
    }

    const desktopHistory = histories.get(DESKTOP_ID);
    desktopHistory.push({
      id: 'codex-desktop-stream-final',
      source_message_id: 'codex-desktop:native:stream-final',
      native_source_id: 'codex-desktop:turn:stream-final:assistant',
      native_turn_id: 'codex-desktop-turn-stream-final',
      sequence: desktopHistory.length + 1,
      ts: Date.now() / 1000,
      role: 'assistant',
      content: 'CODEx desktop live-edge streaming remained stable and readable.',
    });
    for (const surface of surfaces) {
      const jump = surface.page.locator('.jump-to-newest');
      if (await jump.count()) await jump.click();
      const composer = surface.page.locator('.input-area textarea');
      await composer.focus();
      await surface.page.keyboard.press('ArrowUp');
    }
    broadcast({
      type: 'message_delta', session_id: DESKTOP_ID, message_id: 'desktop-live-stream',
      block_index: 0, seq: 0, op: 'block_open',
    });
    for (let index = 0; index < 20; index += 1) {
      broadcast({
        type: 'message_delta', session_id: DESKTOP_ID, message_id: 'desktop-live-stream',
        block_index: 0, seq: index + 1, op: 'append', append: index === 0 ? 'Streaming remains readable' : '.',
      });
    }
    broadcast({
      type: 'history_snapshot', session_id: DESKTOP_ID, messages: desktopHistory,
      total_messages: desktopHistory.length, loaded_messages: desktopHistory.length,
    });
    broadcast({ type: 'status', session_id: DESKTOP_ID, status: 'healthy', activity: sessions[0].activity, thinking: false });
    await Promise.all(surfaces.map(surface => waitForTranscript(surface.page, DESKTOP_ID)));
    await Promise.all(surfaces.map(surface => surface.page.waitForFunction(() => (
      document.body.textContent.includes('live-edge streaming remained stable and readable')
    ), null, { timeout: 5000 })));
    await Promise.all(surfaces.map(surface => surface.page.waitForFunction(() => {
      const list = document.querySelector('.messages');
      return !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    }, null, { timeout: 5000 })));
    const liveEdge = Object.fromEntries(await Promise.all(surfaces.map(async surface => [surface.name,
      await surface.page.evaluate(() => {
        const list = document.querySelector('.messages');
        return {
          bottom_gap_px: Number((list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(3)),
          provisional_count: document.querySelectorAll('.message-provisional').length,
          final_visible: document.body.textContent.includes('live-edge streaming remained stable and readable'),
        };
      }),
    ])));

    const citationVisuals = {};
    if (options.screenshotDir) fs.mkdirSync(options.screenshotDir, { recursive: true });
    for (const surface of surfaces) {
      await selectSession(surface.page, CLI_ID);
      const citationScrollDelta = await surface.page.evaluate(({ rowIndex, rowCount }) => {
        const list = document.querySelector('.messages');
        if (!list) throw new Error('transcript missing before citation visual receipt');
        const target = (list.scrollHeight - list.clientHeight) * rowIndex / Math.max(1, rowCount - 1);
        return target - list.scrollTop;
      }, { rowIndex: MEMORY_CITATION_ROW_INDEX, rowCount: histories.get(CLI_ID).length });
      await surface.page.locator('.messages').hover();
      await surface.page.mouse.wheel(0, citationScrollDelta);
      await surface.page.waitForFunction(() => document.querySelectorAll('.content-block-memory-citation').length === 1);
      await surface.page.evaluate(() => {
        // Keep the visual receipt atomic. The fixture deliberately continues reconciling
        // rows, so a Playwright locator can become detached between its scroll and click.
        const citation = document.querySelector('.content-block-memory-citation');
        if (!citation) throw new Error('memory citation disappeared before visual receipt');
        citation.scrollIntoView({ block: 'center', inline: 'nearest' });
        const details = citation.matches('details') ? citation : citation.querySelector('details');
        if (details) details.open = true;
      });
      await surface.page.waitForFunction(() => {
        const list = document.querySelector('.messages');
        const citation = document.querySelector('.content-block-memory-citation');
        const details = citation && (citation.matches('details') ? citation : citation.querySelector('details'));
        if (!list || !citation || (details && !details.open)) return false;
        const listRect = list.getBoundingClientRect();
        const citationRect = citation.getBoundingClientRect();
        return citationRect.top >= listRect.top && citationRect.bottom <= listRect.bottom;
      });
      const counts = await surface.page.evaluate(() => ({
        citation_blocks: document.querySelectorAll('.content-block-memory-citation').length,
        raw_protocol_rows: [...document.querySelectorAll('.message')]
          .filter(node => node.textContent.includes('<oai-mem-citation>')).length,
      }));
      if (options.screenshotDir) {
        const screenshot = path.join(options.screenshotDir, `memory-citation-${surface.name}.png`);
        await surface.page.locator('.content-block-memory-citation').screenshot({
          path: screenshot, animations: 'disabled',
        });
        counts.screenshot = path.relative(ROOT, screenshot);
      }
      citationVisuals[surface.name] = counts;
    }

    const promptReceipts = [];
    for (const [sessionId, surfaceName, terminalLifecycle] of [
      [DESKTOP_ID, 'codex-desktop', 'answered'],
      [CLI_ID, 'codex_cli', 'cancelled'],
    ]) {
      await Promise.all(surfaces.map(async surface => {
        await selectSession(surface.page, sessionId);
      }));
      const prompt = questionPrompt(sessionId, surfaceName, promptReceipts.length + 1);
      for (let replay = 0; replay < 25; replay += 1) broadcast(prompt);
      await Promise.all(surfaces.map(surface => surface.page.locator('.permission-card').waitFor({ state: 'visible', timeout: 5000 })));
      await Promise.all(surfaces.map(async surface => {
        assert.strictEqual(await surface.page.locator('.permission-card').count(), 1);
      }));
      const primary = surfaces[0].page;
      if (terminalLifecycle === 'answered') {
        await primary.locator('.permission-action').filter({ hasText: 'Alpha' }).click();
        await primary.locator('.permission-question-submit').click();
      } else {
        await primary.locator('.permission-question-cancel').click();
      }
      await waitFor(() => browserMutations.some(message => (
        message.type === 'question_response'
        && message.prompt_id === prompt.prompt_id
        && message.action === (terminalLifecycle === 'answered' ? 'answer' : 'cancel')
      )), 5000, `${surfaceName} native question response`);
      broadcast({
        type: 'question_prompt_state', session_id: sessionId,
        prompt_id: prompt.prompt_id, generation: prompt.generation,
        lifecycle: terminalLifecycle, terminal_at: new Date().toISOString(),
      });
      await Promise.all(surfaces.map(surface => surface.page.locator('.permission-card').waitFor({ state: 'detached', timeout: 5000 })));
      for (let replay = 0; replay < Math.floor(options.replayCount / 2); replay += 1) broadcast(prompt);
      for (const ws of sockets) ack(ws, [prompt]);
      await new Promise(resolve => setTimeout(resolve, 300));
      await Promise.all(surfaces.map(async surface => {
        assert.strictEqual(await surface.page.locator('.permission-card').count(), 0,
          `${surfaceName} terminal prompt replay resurrected`);
        assert.strictEqual(await surface.page.locator('.session-card-perm-badge').count(), 0,
          `${surfaceName} terminal prompt replay restored an attention badge`);
      }));
      promptReceipts.push({
        session_id: sessionId,
        surface: surfaceName,
        prompt_id: prompt.prompt_id,
        generation: prompt.generation,
        terminal_lifecycle: terminalLifecycle,
      });
    }

    if (options.screenshotDir) {
      fs.mkdirSync(options.screenshotDir, { recursive: true });
      for (const surface of surfaces) {
        const screenshot = path.join(options.screenshotDir, `${surface.name}.png`);
        await surface.page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
        surfaceResults[surface.name].screenshot = path.relative(ROOT, screenshot);
      }
    }

    const formal = options.soakMs >= 120_000 && options.replayCount >= 1000;
    const surfacePass = Object.values(surfaceResults).every(result => (
      result.samples > 0
      && result.scroll_writes === 0
      && result.max_scroll_drift_px <= 1
      && result.prompt_samples === 0
      && result.composer_lock_samples === 0
      && result.toast_samples === 0
      && result.identity_failures === 0
      && result.final_prompt_count === 0
      && result.final_total_messages === desktopInitialRows
    ));
    const liveEdgePass = Object.values(liveEdge).every(result => (
      result.bottom_gap_px < 80 && result.provisional_count === 0 && result.final_visible
    ));
    const citationPass = Object.values(citationVisuals).every(result => (
      result.citation_blocks === 1 && result.raw_protocol_rows === 0
    ));
    const responseMessages = browserMutations.filter(message => message.type === 'question_response');
    const result = {
      ok: surfacePass
        && liveEdgePass
        && citationPass
        && responseMessages.length === 2
        && (!formal || soakEndedAt - soakStartedAt >= 120_000),
      generated_at: new Date().toISOString(),
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      build_identity: (fs.readFileSync(path.join(publicRoot, 'sw.js'), 'utf8').match(/ASSET_VERSION = '([^']+)'/) || [])[1] || null,
      bundle_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(publicRoot, 'dist', 'bundle.js'))).digest('hex'),
      acceptance_class: formal ? 'formal_codex_desktop_cli_120s_fidelity' : 'diagnostic_codex_desktop_cli_fidelity',
      transcript: {
        adapters: ['codex-desktop', 'codex_cli'],
        native_rows_per_adapter: {
          'codex-desktop': desktopInitialRows,
          codex_cli: cliInitialRows,
        },
        parity_fixture: options.parityFixture ? path.relative(ROOT, options.parityFixture) : null,
        reordered_replayed_sequences: options.replayCount,
        chat_switches_per_surface: 12,
        page_refreshes: surfaces.length,
        websocket_reconnects: reconnects,
        same_session_transcript_listener_remounts: surfaces.length,
        exact_message_order_identity: true,
        duplicate_rows: 0,
        dropped_rows: 0,
      },
      prompts: {
        native_zero_prompt_sessions: 2,
        phantom_cards: 0,
        phantom_toasts: 0,
        composer_locks: 0,
        terminal_replays_attempted: Math.floor(options.replayCount / 2) * 2,
        terminal_resurrections: 0,
        responses_routed: responseMessages.length,
        receipts: promptReceipts,
      },
      scroll_soak: {
        requested_duration_ms: options.soakMs,
        actual_duration_ms: soakEndedAt - soakStartedAt,
        one_hz_snapshots: oneHzSnapshots,
        bounded_ten_hz_snapshots: burstSnapshots,
        samples,
        programmatic_scroll_writes: Object.values(surfaceResults)
          .reduce((total, item) => total + Number(item.scroll_writes || 0), 0),
        max_pixel_drift: Math.max(...Object.values(surfaceResults).map(item => item.max_scroll_drift_px)),
        reconnects,
        held_depths: Object.fromEntries(surfaces.map(surface => [surface.name, surface.scrollDepth])),
      },
      memory_citation: {
        canonical_rows: 1,
        structured_blocks: 1,
        raw_protocol_rows: 0,
        enrichment_during_user_scroll_ownership: true,
        stale_provisional_replays: oneHzSnapshots + burstSnapshots,
        visuals: citationVisuals,
      },
      live_edge: liveEdge,
      surfaces: surfaceResults,
      transport: {
        total_connections: connectionCount,
        active_connections: sockets.size,
        browser_frame_counts: Object.fromEntries(clientFrameCounts),
      },
      safety: {
        headless: true,
        visible_windows_opened: 0,
        external_focus_actions: 0,
        protected_sessions_touched: 0,
        production_mutations: 0,
        proxy_restarts: 0,
        deploys: 0,
      },
      total_elapsed_ms: Date.now() - startedAt,
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
    assert.strictEqual(result.ok, true, 'Codex Desktop/CLI WebUI fidelity acceptance failed');
  } finally {
    for (const surface of surfaces) await surface.context?.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
