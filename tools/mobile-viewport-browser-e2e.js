#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium, webkit } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const SESSION_ID = 'p3-39-mobile-viewport-fixture';
const NOW = '2026-07-25T23:40:00.000Z';
const LONG_TEXT = Array.from(
  { length: 18 },
  (_, index) => `Streaming fixture line ${index + 1}: verifying compact mobile viewport ownership.`,
).join('\n');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

function parseArgs(argv) {
  const assetSource = valueAfter(argv, '--asset-source') || 'production';
  assert(['production', 'local'].includes(assetSource), '--asset-source must be production or local');
  const output = valueAfter(argv, '--output');
  const screenshotsDir = valueAfter(argv, '--screenshots-dir');
  assert(output, '--output is required');
  assert(screenshotsDir, '--screenshots-dir is required');
  const engines = (valueAfter(argv, '--engines') || 'chromium')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  assert(engines.length > 0 && engines.every(value => ['chromium', 'webkit'].includes(value)),
    '--engines must contain chromium and/or webkit');
  const soakMs = Number(valueAfter(argv, '--soak-ms') || 0);
  assert(Number.isFinite(soakMs) && soakMs >= 0, '--soak-ms must be a non-negative number');
  return {
    assetSource,
    output: path.resolve(output),
    screenshotsDir: path.resolve(screenshotsDir),
    assertAcceptance: argv.includes('--assert-acceptance'),
    matrix: argv.includes('--matrix'),
    soakMs,
    engines,
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executable;
}

async function launchHeadlessBrowser(engine) {
  if (engine === 'chromium') {
    return chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: [
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    });
  }
  const executablePath = webkit.executablePath();
  assert(fs.existsSync(executablePath),
    `Playwright WebKit is unavailable at ${executablePath}; install the pinned headless runtime before claiming WebKit coverage`);
  return webkit.launch({ headless: true });
}

const PHONE_VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '360x640', width: 360, height: 640 },
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '412x915', width: 412, height: 915 },
];

function receiptPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function contextOptions({ engine, width, height, dpr }) {
  return {
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    userAgent: engine === 'webkit'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36',
  };
}

async function configureContext(context, theme) {
  await context.addInitScript(selectedTheme => {
    localStorage.setItem('remote-agent-chat-theme', selectedTheme);
    localStorage.removeItem('remote-agent-chat-active-session');
    localStorage.removeItem('remote-agent-chat:mobile-system-banner-expanded:v1');
    localStorage.removeItem('remote-agent-chat:mobile-header-expanded:v1');
    localStorage.removeItem('remote-agent-chat:mobile-live-status-expanded:v1');
  }, theme);
  await context.addInitScript(() => {
    const watch = window.__RAC_MOBILE_VIEWPORT_WATCH__ = {
      active: false,
      baselineScrollTop: 0,
      maxDriftPx: 0,
      scrollWrites: 0,
      writeEvents: [],
      collapsedHeights: [],
      cls: 0,
      clsBaseline: 0,
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
          if (watch.active && this?.classList?.contains('messages')) {
            watch.scrollWrites += 1;
            if (watch.writeEvents.length < 20) {
              watch.writeEvents.push({
                kind: 'scrollTop',
                before_px: descriptor.get.call(this),
                requested_px: Number(value),
                stack: String(new Error().stack || '').split('\n').slice(1, 6),
              });
            }
          }
          return descriptor.set.call(this, value);
        },
      });
    }
    for (const method of ['scrollTo', 'scrollBy']) {
      const native = Element.prototype[method];
      if (typeof native !== 'function') continue;
      Element.prototype[method] = function instrumentedElementScroll(...args) {
        if (watch.active && this?.classList?.contains('messages')) {
          watch.scrollWrites += 1;
          if (watch.writeEvents.length < 20) {
            watch.writeEvents.push({
              kind: method,
              args,
              stack: String(new Error().stack || '').split('\n').slice(1, 6),
            });
          }
        }
        return native.apply(this, args);
      };
    }
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) watch.cls += entry.value;
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
      } catch {
        // WebKit may not expose layout-shift entries; the receipt records that separately.
      }
    }
    watch.start = () => {
      const list = document.querySelector('.messages');
      watch.baselineScrollTop = list?.scrollTop || 0;
      watch.maxDriftPx = 0;
      watch.scrollWrites = 0;
      watch.writeEvents = [];
      watch.collapsedHeights = [];
      watch.clsBaseline = watch.cls;
      watch.active = true;
    };
    watch.sample = () => {
      if (!watch.active) return;
      const list = document.querySelector('.messages');
      const banner = document.querySelector('.duplicate-proxy-banner');
      const topbar = document.querySelector('.topbar');
      const activity = document.querySelector('.transcript-live-footer');
      watch.maxDriftPx = Math.max(watch.maxDriftPx, Math.abs((list?.scrollTop || 0) - watch.baselineScrollTop));
      watch.collapsedHeights.push([
        banner?.getBoundingClientRect().height || 0,
        topbar?.getBoundingClientRect().height || 0,
        activity?.getBoundingClientRect().height || 0,
      ]);
    };
    watch.stop = () => {
      watch.sample();
      watch.active = false;
      const ranges = [0, 1, 2].map(index => {
        const values = watch.collapsedHeights.map(row => row[index]);
        return values.length ? Math.max(...values) - Math.min(...values) : 0;
      });
      return {
        scroll_writes: watch.scrollWrites,
        max_scroll_drift_px: watch.maxDriftPx,
        collapsed_height_ranges_px: {
          warning: ranges[0],
          topbar: ranges[1],
          working: ranges[2],
        },
        cls_after_start: Math.max(0, watch.cls - watch.clsBaseline),
        layout_shift_observer_supported: watch.cls !== undefined,
        write_events: watch.writeEvents,
        samples: watch.collapsedHeights.length,
      };
    };
  });
}

function baseSession(activity, writeGate = '') {
  return {
    session_id: SESSION_ID,
    agent_type: 'codex_cli',
    title: 'P3-39 disposable mobile viewport fixture with a deliberately long title',
    chat_title: 'P3-39 disposable mobile viewport fixture with a deliberately long title',
    status: 'healthy',
    health: 'connected',
    machine: 'disposable-host',
    native_host_label: 'Codex CLI fixture',
    workspace_name: 'Disposable mobile viewport fixture workspace',
    workspace_path: 'C:\\disposable\\p3-39-mobile-viewport',
    is_test_session: true,
    activity,
    config: {
      model: 'gpt-5.4-mini',
      effort: 'low',
      branch: 'p3-39-disposable-mobile-viewport-fixture',
      capabilities: {
        send: true,
        interrupt: true,
        question_prompts: true,
        ...(writeGate ? { write_capability_gate: writeGate } : {}),
      },
    },
  };
}

function idleActivity() {
  return { kind: 'idle', label: '', updated_at: NOW };
}

function activeGoal() {
  return {
    kind: 'working',
    label: 'Working on mobile viewport recovery',
    updated_at: NOW,
    goal: {
      status: 'active',
      state: 'active',
      label: 'Pursuing goal',
      objective: 'Recover the phone chat viewport while retaining full safety and harness status detail.',
      updated_at: NOW,
    },
  };
}

function streamingActivity() {
  return {
    ...activeGoal(),
    kind: 'running_command',
    label: 'Running compact viewport verification',
    thinking: {
      label: 'Thinking through viewport ownership',
      text: LONG_TEXT,
      since: NOW,
    },
    current: {
      kind: 'tool',
      label: 'Running mobile matrix',
      partial: LONG_TEXT,
      since: NOW,
    },
  };
}

function rateLimitActivity() {
  return {
    kind: 'idle',
    label: '',
    updated_at: NOW,
    usage: {
      title: 'Usage limit reached',
      detail: 'Disposable cheap-model fixture is temporarily rate limited.',
      resets_at: '2026-07-26T00:00:00.000Z',
    },
  };
}

function passingDogfood() {
  return {
    status: 'PASS',
    latest: { status: 'PASS', completed_at: new Date().toISOString() },
    open_fingerprints: [],
  };
}

function failingDogfood() {
  return {
    status: 'FAIL',
    latest: { status: 'FAIL', completed_at: new Date().toISOString() },
    open_fingerprints: ['p3-39-fixture-a', 'p3-39-fixture-b', 'p3-39-fixture-c'],
  };
}

function nightlyFailure(index) {
  return {
    kind: 'nightly_validation',
    harness: `fixture-harness-${index}`,
    status: 'fail',
    app_version: `2026.7.${index}`,
    run_id: `p3-39-nightly-${index}`,
    detail: 'Disposable validation failure used for viewport geometry only.',
    completed_at: new Date().toISOString(),
  };
}

function questionPrompt() {
  return {
    type: 'question_prompt',
    contract_version: 1,
    prompt_id: 'p3-39-native-question-1',
    session_id: SESSION_ID,
    generation: 'p3-39-native-turn-1',
    kind: 'request_user_input',
    source: { surface: 'codex_cli', version: 'fixture-cheap-model' },
    title: 'Native fixture question',
    questions: [{
      question_id: 'route',
      header: 'Route',
      message: 'Choose the disposable validation route.',
      answer_mode: 'single',
      required: true,
      multi_select: false,
      choices: [
        { choice_id: 'alpha', label: 'Alpha', description: 'First disposable route.' },
        { choice_id: 'beta', label: 'Beta', description: 'Second disposable route.' },
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

const SCENARIOS = [
  {
    id: 'no-warning-idle',
    activity: idleActivity(),
  },
  {
    id: 'one-nightly-failure',
    activity: idleActivity(),
    nightly: [nightlyFailure(1)],
  },
  {
    id: 'worst-warning-stack',
    activity: streamingActivity(),
    nightly: Array.from({ length: 8 }, (_, index) => nightlyFailure(index + 1)),
    appUpdate: {
      kind: 'app_update_validation',
      harness: 'codex',
      status: 'fail',
      previous_app_version: '26.724.1',
      app_version: '26.725.1',
      run_id: 'p3-39-app-drift',
      completed_at: new Date().toISOString(),
    },
    duplicateProxyAlarms: [{ session_id: SESSION_ID }, { session_id: `${SESSION_ID}-alias` }],
    dogfood: failingDogfood(),
    writeGate: 'A disposable fixture write gate is active while native capability parity is revalidated.',
  },
  {
    id: 'goal-running',
    activity: activeGoal(),
  },
  {
    id: 'thinking-long-current-output',
    activity: streamingActivity(),
  },
  {
    id: 'question-prompt',
    activity: idleActivity(),
    questions: [questionPrompt()],
  },
  {
    id: 'rate-limit',
    activity: rateLimitActivity(),
  },
  {
    id: 'reconnect',
    activity: idleActivity(),
    reconnect: true,
  },
];

function fixtureMessages() {
  const base = Date.parse('2026-07-25T20:00:00.000Z');
  return Array.from({ length: 60 }, (_, index) => ({
    id: `p3-39-message-${index + 1}`,
    source_message_id: `p3-39:native:${index + 1}`,
    native_source_id: `p3-39:turn:${Math.floor(index / 2) + 1}:${index % 2 ? 'assistant' : 'user'}`,
    native_turn_id: `p3-39-turn-${Math.floor(index / 2) + 1}`,
    sequence: index + 1,
    ts: (base + index * 1000) / 1000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Disposable transcript row ${index + 1}. Stable mobile viewport fixture content.`,
  }));
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

function createAssetResponder({ assetSource, upstreamUrl, token }) {
  if (assetSource === 'local') {
    const publicRoot = path.join(ROOT, 'frontend');
    return (request, response) => {
      if (request.url.startsWith('/api/')) {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end('{}');
        return;
      }
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.resolve(publicRoot, relative);
      if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)
          || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(response);
    };
  }
  const upstream = new URL(upstreamUrl);
  return (request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{}');
      return;
    }
    const headers = { ...request.headers, host: upstream.host, authorization: `Bearer ${token}` };
    delete headers.connection;
    const forwarded = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: request.url,
      method: request.method,
      headers,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    forwarded.on('error', error => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`production asset proxy failed: ${error.message}`);
    });
    request.pipe(forwarded);
  };
}

async function startFixtureServer(options) {
  let activeScenario = SCENARIOS[0];
  let reconnectLocked = false;
  let connectionCount = 0;
  const sentFrames = [];
  const messages = fixtureMessages();
  const requestHandler = createAssetResponder(options);
  const server = http.createServer(requestHandler);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url, 'http://127.0.0.1').pathname !== '/client-ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    connectionCount += 1;
    if (reconnectLocked) {
      ws.close(1012, 'disposable reconnect fixture');
      return;
    }
    const send = payload => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };
    const sessionFactory = typeof options.sessionFactory === 'function' ? options.sessionFactory : baseSession;
    const session = sessionFactory(activeScenario.activity, activeScenario.writeGate, activeScenario);
    const connectionAck = {
      type: 'connection_ack',
      protocol_version: 1,
      heartbeat_interval_ms: 1000,
      heartbeat_timeout_ms: 5000,
      state_epoch: 'p3-39-mobile-fixture',
      connection_id: `p3-39-${activeScenario.id}`,
      sessions: [session],
      session_health: { [SESSION_ID]: 'healthy' },
      workspaces: [],
      open_prompts: [],
      open_question_prompts: activeScenario.questions || [],
      open_error_prompts: [],
      agent_configs: { [SESSION_ID]: session.config },
      duplicate_proxy_alarms: activeScenario.duplicateProxyAlarms || [],
      nightly_validation_failures: activeScenario.nightly || [],
      ...(activeScenario.appUpdate ? { latest_app_update_validation: activeScenario.appUpdate } : {}),
      operator_dogfood_health: activeScenario.dogfood || passingDogfood(),
      ts: Date.now(),
    };
    setTimeout(() => send(connectionAck), 25);
    ws.on('message', raw => {
      let frame;
      try { frame = JSON.parse(String(raw)); } catch { return; }
      const sessionId = frame.session_id || frame.session;
      if (frame.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: frame.request_id, server_ts: new Date().toISOString() });
      } else if (frame.type === 'subscribe') {
        send({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] });
      } else if (frame.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sessionId, ...session.config });
      } else if (frame.type === 'history_chunk_request') {
        send({
          type: 'history_chunk',
          session_id: sessionId,
          request_id: frame.request_id,
          source: 'p3-39-disposable-fixture',
          mode: 'tail',
          replace: frame.replace !== false,
          messages,
          total_messages: messages.length,
          loaded_messages: messages.length,
          partial: false,
        });
      } else if (frame.type === 'get_history') {
        send({ type: 'history', session: sessionId, request_id: frame.request_id, messages });
      } else if (frame.type === 'history_request') {
        send({
          type: 'history_snapshot',
          session_id: sessionId,
          request_id: frame.request_id,
          messages,
          total_messages: messages.length,
          loaded_messages: messages.length,
        });
      } else if (frame.type === 'send') {
        sentFrames.push(frame);
        const replyId = `p3-39-echo-${sentFrames.length}`;
        send({
          type: 'proxy_send_result',
          session_id: sessionId,
          session: sessionId,
          client_message_id: frame.client_message_id,
          status: 'delivered',
          delivered: true,
        });
        setTimeout(() => send({
          type: 'proxy_message',
          protocol_version: 1,
          session_id: sessionId,
          session: sessionId,
          role: 'assistant',
          id: replyId,
          message_id: replyId,
          source_message_id: `p3-39:echo:${sentFrames.length}`,
          sequence: messages.length + sentFrames.length,
          ts: Date.now() / 1000,
          content: `Disposable fixture received: ${frame.content}`,
        }), 30);
      } else if (typeof options.onFrame === 'function') {
        options.onFrame({
          frame,
          send,
          session,
          scenario: activeScenario,
          messages,
        });
      }
    });
    if (activeScenario.reconnect) {
      setTimeout(() => {
        reconnectLocked = true;
        ws.close(1012, 'disposable reconnect fixture');
      }, 350);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    selectScenario(scenario) {
      activeScenario = scenario;
      reconnectLocked = false;
    },
    broadcast(payload) {
      const serialized = JSON.stringify(payload);
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(serialized);
      }
    },
    broadcastScenarioSnapshot(activity = activeScenario.activity) {
      const session = baseSession(activity, activeScenario.writeGate);
      this.broadcast({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] });
      this.broadcast({
        type: 'status',
        protocol_version: 1,
        session: SESSION_ID,
        session_id: SESSION_ID,
        status: 'healthy',
        thinking: activity.kind !== 'idle',
        label: activity.label || '',
        activity,
      });
    },
    reconnectAll() {
      reconnectLocked = false;
      for (const ws of wss.clients) ws.terminate();
    },
    sentFrames,
    connectionCount: () => connectionCount,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function measurePage(page, scenario) {
  const testSessionToggle = page.locator('.test-session-toggle');
  if (await testSessionToggle.count() && await testSessionToggle.getAttribute('aria-pressed') !== 'true') {
    await testSessionToggle.evaluate(node => node.click());
  }
  await page.waitForSelector(
    `.session-card[data-session-id="${SESSION_ID}"]`,
    { state: 'attached', timeout: 15_000 },
  ).catch(async error => {
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body_text: (document.body?.innerText || '').slice(0, 2500),
      root_html: (document.getElementById('root')?.innerHTML || '').slice(0, 2500),
    }));
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  await page.locator(`.session-card[data-session-id="${SESSION_ID}"]`).evaluate(node => node.click());
  await page.waitForFunction(
    id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
    SESSION_ID,
    { timeout: 10_000 },
  );
  if (scenario.questions?.length) {
    await page.waitForSelector('.permission-card', { timeout: 10_000 });
  }
  if (scenario.reconnect) {
    await page.waitForFunction(
      () => document.querySelector('.topbar-relay-status')?.textContent?.includes('reconnecting'),
      null,
      { timeout: 10_000 },
    );
  }
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        x: Number(value.x.toFixed(2)),
        y: Number(value.y.toFixed(2)),
        width: Number(value.width.toFixed(2)),
        height: Number(value.height.toFixed(2)),
        top: Number(value.top.toFixed(2)),
        right: Number(value.right.toFixed(2)),
        bottom: Number(value.bottom.toFixed(2)),
        left: Number(value.left.toFixed(2)),
      };
    };
    const overlap = (left, right) => {
      if (!left || !right) return 0;
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return Number((width * height).toFixed(2));
    };
    const effectiveTouchTarget = selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      const pseudo = getComputedStyle(node, '::after');
      const topExtension = Math.max(0, -(parseFloat(pseudo.top) || 0));
      const bottomExtension = Math.max(0, -(parseFloat(pseudo.bottom) || 0));
      const leftExtension = Math.max(0, -(parseFloat(pseudo.left) || 0));
      const rightExtension = Math.max(0, -(parseFloat(pseudo.right) || 0));
      return {
        visual_width: Number(value.width.toFixed(2)),
        visual_height: Number(value.height.toFixed(2)),
        effective_width: Number((value.width + leftExtension + rightExtension).toFixed(2)),
        effective_height: Number((value.height + topExtension + bottomExtension).toFixed(2)),
      };
    };
    const safeProbe = document.createElement('div');
    safeProbe.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'padding-top:env(safe-area-inset-top)',
      'padding-right:env(safe-area-inset-right)',
      'padding-bottom:env(safe-area-inset-bottom)',
      'padding-left:env(safe-area-inset-left)',
    ].join(';');
    document.body.appendChild(safeProbe);
    const safeStyle = getComputedStyle(safeProbe);
    const safeArea = {
      top: parseFloat(safeStyle.paddingTop) || 0,
      right: parseFloat(safeStyle.paddingRight) || 0,
      bottom: parseFloat(safeStyle.paddingBottom) || 0,
      left: parseFloat(safeStyle.paddingLeft) || 0,
    };
    safeProbe.remove();
    const banner = rect('.duplicate-proxy-banner');
    const topbar = rect('.topbar');
    const transcript = rect('.messages');
    const liveStatus = rect('.transcript-live-footer');
    const composer = rect('.input-area');
    const prompt = rect('.permission-overlay');
    const viewport = window.visualViewport
      ? {
          width: window.visualViewport.width,
          height: window.visualViewport.height,
          offset_top: window.visualViewport.offsetTop,
          offset_left: window.visualViewport.offsetLeft,
          scale: window.visualViewport.scale,
        }
      : { width: innerWidth, height: innerHeight, offset_top: 0, offset_left: 0, scale: 1 };
    const list = document.querySelector('.messages');
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const combinedChrome = (banner?.height || 0) + (topbar?.height || 0) + (liveStatus?.height || 0);
    return {
      asset_identity: document.querySelector('link[href*="styles.css?v="]')?.getAttribute('href') || '',
      viewport,
      inner: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      safe_area_px: safeArea,
      rects: { banner, topbar, transcript, live_status: liveStatus, composer, prompt },
      combined_chrome_px: Number(combinedChrome.toFixed(2)),
      transcript_height_ratio: Number(((transcript?.height || 0) / viewport.height).toFixed(4)),
      composer_reachable: !!composer && composer.top < viewport.height && composer.bottom > 0,
      composer_fully_visible: !!composer && composer.top >= 0 && composer.bottom <= viewport.height,
      horizontal_overflow_px: Number(Math.max(0, documentWidth - document.documentElement.clientWidth).toFixed(2)),
      touch_targets: {
        system_disclosure: effectiveTouchTarget('.system-banner-disclosure'),
        header_disclosure: effectiveTouchTarget('.mobile-header-disclosure'),
        live_status_disclosure: effectiveTouchTarget('.mobile-live-status-summary'),
      },
      overlaps_px2: {
        banner_transcript: overlap(banner, transcript),
        topbar_transcript: overlap(topbar, transcript),
        live_status_transcript: overlap(liveStatus, transcript),
        composer_transcript: overlap(composer, transcript),
        prompt_composer: overlap(prompt, composer),
      },
      scroll: {
        window_x: scrollX,
        window_y: scrollY,
        transcript_top: list?.scrollTop || 0,
        transcript_height: list?.scrollHeight || 0,
        transcript_client_height: list?.clientHeight || 0,
      },
      body_text_excerpt: (document.body?.innerText || '').slice(0, 1000),
    };
  });
}

async function exerciseDisclosures(page) {
  await page.locator('.messages').evaluate(node => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -480, bubbles: true }));
    node.scrollTop = Math.max(120, Math.floor((node.scrollHeight - node.clientHeight) * 0.45));
    node.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(50);
  const baseline = await page.locator('.messages').evaluate(node => node.scrollTop);
  const specs = [
    {
      id: 'system_warning',
      button: '.system-banner-disclosure',
      detail: '.system-banner-details',
    },
    {
      id: 'session_header',
      button: '.mobile-header-disclosure',
      detail: '.topbar-meta',
    },
    {
      id: 'working_status',
      button: '.mobile-live-status-summary',
      detail: '.live-status-details',
    },
  ];
  const receipts = [];
  for (const spec of specs) {
    const button = page.locator(spec.button);
    assert.strictEqual(await button.count(), 1, `${spec.id} disclosure is missing`);
    await button.click();
    await page.waitForFunction(selector => {
      const node = document.querySelector(selector);
      return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0;
    }, spec.detail, { timeout: 3000 });
    const expanded = await page.evaluate(({ buttonSelector, detailSelector, expectedScrollTop }) => {
      const buttonNode = document.querySelector(buttonSelector);
      const detailNode = document.querySelector(detailSelector);
      const list = document.querySelector('.messages');
      const rect = detailNode.getBoundingClientRect();
      return {
        aria_expanded: buttonNode.getAttribute('aria-expanded'),
        transcript_scroll_top: list.scrollTop,
        transcript_drift_px: Math.abs(list.scrollTop - expectedScrollTop),
        detail_rect: {
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        detail_scroll_height: detailNode.scrollHeight,
        detail_client_height: detailNode.clientHeight,
        detail_internal_overflow: getComputedStyle(detailNode).overflowY,
        viewport_height: visualViewport?.height || innerHeight,
      };
    }, { buttonSelector: spec.button, detailSelector: spec.detail, expectedScrollTop: baseline });
    assert.strictEqual(expanded.aria_expanded, 'true', `${spec.id} did not expose expanded semantics`);
    assert(expanded.transcript_drift_px <= 0.5, `${spec.id} expansion moved the transcript`);
    assert(expanded.detail_rect.top >= 0 && expanded.detail_rect.bottom <= expanded.viewport_height + 0.5,
      `${spec.id} detail escaped the visual viewport`);
    await button.click();
    await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).display === 'none',
      spec.detail, { timeout: 3000 });
    const collapsed = await page.locator('.messages').evaluate((node, expectedScrollTop) => ({
      scroll_top: node.scrollTop,
      drift_px: Math.abs(node.scrollTop - expectedScrollTop),
    }), baseline);
    assert(collapsed.drift_px <= 0.5, `${spec.id} collapse moved the transcript`);
    receipts.push({ id: spec.id, expanded, collapsed });
  }
  return { baseline_scroll_top: baseline, disclosures: receipts };
}

async function exerciseSendReceive(page, fixture) {
  const marker = `p3-39-mobile-send-${Date.now()}`;
  const before = fixture.sentFrames.length;
  const composer = page.locator('.input-area textarea');
  await composer.fill(marker);
  await composer.press('Enter');
  await page.waitForFunction(
    expected => [...document.querySelectorAll('.message')].some(node => node.textContent.includes(expected)),
    `Disposable fixture received: ${marker}`,
    { timeout: 5000 },
  );
  assert.strictEqual(fixture.sentFrames.length, before + 1, 'disposable fixture did not receive exactly one send');
  const received = fixture.sentFrames.at(-1);
  assert.strictEqual(received.content, marker, 'disposable fixture received the wrong send content');
  return {
    sent: marker,
    received_by_fixture: received.content,
    assistant_echo_rendered: true,
    model: 'gpt-5.4-mini',
    effort: 'low',
  };
}

function geometryAcceptance(geometry, { orientation = 'portrait' } = {}) {
  const safeTop = Number(geometry.safe_area_px?.top || 0);
  const bannerHeight = Math.max(0, Number(geometry.rects.banner?.height || 0) - safeTop);
  const topbarSafe = geometry.rects.banner ? 0 : safeTop;
  const topbarHeight = Math.max(0, Number(geometry.rects.topbar?.height || 0) - topbarSafe);
  const workingHeight = Number(geometry.rects.live_status?.height || 0);
  const targets = Object.values(geometry.touch_targets || {}).filter(Boolean);
  return {
    warning_le_40: bannerHeight <= 40.5,
    topbar_le_56: topbarHeight <= 56.5,
    working_le_52: workingHeight <= 52.5,
    combined_chrome_le_148: bannerHeight + topbarHeight + workingHeight <= 148.5,
    ...(orientation === 'portrait'
      ? { transcript_ge_40_percent_portrait: geometry.transcript_height_ratio >= 0.4 }
      : {
          transcript_landscape_usable: geometry.transcript_height_ratio >= 0.2
            && Number(geometry.rects.transcript?.height || 0) >= 64,
        }),
    composer_fully_visible: geometry.composer_fully_visible,
    horizontal_overflow_zero: geometry.horizontal_overflow_px === 0,
    touch_targets_ge_44: targets.every(target => (
      target.effective_width >= 44 && target.effective_height >= 44
    )),
    no_component_overlap: Object.entries(geometry.overlaps_px2 || {})
      .filter(([key]) => key !== 'prompt_composer')
      .every(([, value]) => value === 0),
  };
}

async function runViewportMatrix({ options, fixture, browsers }) {
  if (!options.matrix) return [];
  const matrix = [];
  fixture.selectScenario(SCENARIOS.find(item => item.id === 'worst-warning-stack'));
  for (let engineIndex = 0; engineIndex < options.engines.length; engineIndex += 1) {
    const engine = options.engines[engineIndex];
    const browser = browsers.get(engine);
    for (let sizeIndex = 0; sizeIndex < PHONE_VIEWPORTS.length; sizeIndex += 1) {
      const base = PHONE_VIEWPORTS[sizeIndex];
      for (let orientationIndex = 0; orientationIndex < 2; orientationIndex += 1) {
        const orientation = orientationIndex === 0 ? 'portrait' : 'landscape';
        const width = orientation === 'portrait' ? base.width : base.height;
        const height = orientation === 'portrait' ? base.height : base.width;
        const dpr = 1 + ((sizeIndex + orientationIndex + engineIndex) % 3);
        const theme = (sizeIndex + orientationIndex + engineIndex) % 2 === 0 ? 'dark' : 'light';
        const context = await browser.newContext(contextOptions({ engine, width, height, dpr }));
        await configureContext(context, theme);
        const page = await context.newPage();
        const diagnostics = [];
        page.on('console', message => diagnostics.push(`console:${message.type()}:${message.text()}`));
        page.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`));
        try {
          const response = await page.goto(
            `${fixture.url}/?p3_39_matrix=${engine}-${base.id}-${orientation}-${theme}&t=${Date.now()}`,
            { waitUntil: 'domcontentloaded', timeout: 30_000 },
          );
          assert(response && response.status() === 200, `matrix ${engine}/${base.id}/${orientation} app shell failed`);
          const geometry = await measurePage(page, SCENARIOS.find(item => item.id === 'worst-warning-stack'));
          const acceptance = geometryAcceptance(geometry, { orientation });
          const screenshot = path.join(
            options.screenshotsDir,
            `matrix-${engine}-${base.id}-${orientation}-dpr${dpr}-${theme}.png`,
          );
          await page.screenshot({ path: screenshot, fullPage: false });
          matrix.push({
            engine,
            emulation: engine === 'webkit' ? 'WebKit iPhone' : 'Chromium Android',
            base_viewport: base,
            orientation,
            viewport: { width, height },
            dpr,
            theme,
            model: 'gpt-5.4-mini',
            effort: 'low',
            geometry,
            acceptance,
            ok: Object.values(acceptance).every(Boolean),
            screenshot: receiptPath(screenshot),
            diagnostics,
          });
        } finally {
          await context.close();
        }
      }
    }
  }
  return matrix;
}

async function runScrollSoak({ options, fixture, browser }) {
  if (options.soakMs <= 0) return null;
  const scenario = SCENARIOS.find(item => item.id === 'worst-warning-stack');
  fixture.selectScenario(scenario);
  const context = await browser.newContext(contextOptions({
    engine: 'chromium', width: 390, height: 844, dpr: 3,
  }));
  await configureContext(context, 'dark');
  const page = await context.newPage();
  try {
    const response = await page.goto(`${fixture.url}/?p3_39_soak=${options.soakMs}&t=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    assert(response && response.status() === 200, 'soak app shell failed');
    await measurePage(page, scenario);
    await page.locator('.messages').evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -720, bubbles: true }));
      node.scrollTop = Math.max(120, Math.floor((node.scrollHeight - node.clientHeight) * 0.42));
      node.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(75);
    await page.evaluate(() => window.__RAC_MOBILE_VIEWPORT_WATCH__.start());
    const startedAt = Date.now();
    const initialConnections = fixture.connectionCount();
    const reconnectTargets = [Math.floor(options.soakMs / 3), Math.floor(options.soakMs * 2 / 3)];
    let reconnects = 0;
    let oneHzSnapshots = 0;
    let burstSnapshots = 0;
    let samples = 0;
    let nextOneHz = 0;
    let lastProgressBucket = -1;
    while (Date.now() - startedAt < options.soakMs) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= nextOneHz) {
        const activity = streamingActivity();
        activity.current = {
          ...activity.current,
          partial: `${LONG_TEXT}\nRefresh ${oneHzSnapshots + 1}`,
        };
        fixture.broadcastScenarioSnapshot(activity);
        oneHzSnapshots += 1;
        nextOneHz += 1000;
      }
      const burstPhase = elapsed % 12_000;
      if (burstPhase < 1000) {
        fixture.broadcastScenarioSnapshot(streamingActivity());
        burstSnapshots += 1;
      }
      if (reconnects < reconnectTargets.length && elapsed >= reconnectTargets[reconnects]) {
        fixture.reconnectAll();
        reconnects += 1;
      }
      await page.evaluate(() => {
        window.__RAC_MOBILE_VIEWPORT_WATCH__.sample();
      });
      samples += 1;
      const progressBucket = Math.floor(elapsed / 30_000);
      if (progressBucket > lastProgressBucket) {
        lastProgressBucket = progressBucket;
        process.stdout.write(`[mobile-viewport-soak] elapsed_ms=${elapsed} snapshots=${oneHzSnapshots} bursts=${burstSnapshots} reconnects=${reconnects}\n`);
      }
      await page.waitForTimeout(100);
    }
    const metrics = await page.evaluate(() => window.__RAC_MOBILE_VIEWPORT_WATCH__.stop());
    const geometry = await measurePage(page, scenario);
    const screenshot = path.join(options.screenshotsDir, 'soak-390x844-dpr3-dark-final.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    const acceptance = {
      duration_120s: options.soakMs >= 120_000,
      scroll_writes_zero: metrics.scroll_writes === 0,
      pixel_drift_zero: metrics.max_scroll_drift_px <= 0.5,
      collapsed_height_oscillation_zero: Object.values(metrics.collapsed_height_ranges_px).every(value => value <= 0.5),
      cls_le_0_01: metrics.cls_after_start <= 0.01,
      reconnects_two: reconnects === 2,
      reconnected: fixture.connectionCount() >= initialConnections + 2,
      one_hz_exercised: oneHzSnapshots >= Math.floor(options.soakMs / 1000),
      bounded_ten_hz_bursts_exercised: burstSnapshots >= Math.floor(options.soakMs / 12_000) * 8,
    };
    return {
      duration_ms: Date.now() - startedAt,
      profile: {
        engine: 'chromium',
        emulation: 'Chromium Android',
        viewport: { width: 390, height: 844 },
        dpr: 3,
        theme: 'dark',
        model: 'gpt-5.4-mini',
        effort: 'low',
      },
      one_hz_snapshots: oneHzSnapshots,
      bounded_ten_hz_burst_snapshots: burstSnapshots,
      reconnects,
      samples,
      metrics,
      geometry,
      acceptance,
      ok: Object.values(acceptance).every(Boolean),
      screenshot: receiptPath(screenshot),
    };
  } finally {
    await context.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const configured = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const upstreamUrl = configured?.startsWith('http://')
    ? configured
    : `http://${deployEnv.DEPLOY_HOST || 'tower'}:3500`;
  const token = fidelity.buildBearerToken(relayEnv);
  if (options.assetSource === 'production') assert(token, 'production bearer token is unavailable');
  const fixture = await startFixtureServer({
    assetSource: options.assetSource,
    upstreamUrl,
    token,
  });
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(options.screenshotsDir, { recursive: true });
  const browsers = new Map();
  const results = [];
  let matrix = [];
  let soak = null;
  try {
    const requiredEngines = new Set(['chromium', ...(options.matrix ? options.engines : [])]);
    for (const engine of requiredEngines) {
      browsers.set(engine, await launchHeadlessBrowser(engine));
    }
    const browser = browsers.get('chromium');
    for (const scenario of SCENARIOS) {
      fixture.selectScenario(scenario);
      const context = await browser.newContext(contextOptions({
        engine: 'chromium', width: 390, height: 844, dpr: 3,
      }));
      await configureContext(context, 'dark');
      const page = await context.newPage();
      const diagnostics = [];
      page.on('console', message => diagnostics.push(`console:${message.type()}:${message.text()}`));
      page.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`));
      try {
        const response = await page.goto(`${fixture.url}/?p3_39_scenario=${scenario.id}&t=${Date.now()}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        assert(response && response.status() === 200, `${scenario.id} app shell returned ${response?.status()}`);
        const geometry = await measurePage(page, scenario);
        const interactions = scenario.id === 'worst-warning-stack'
          ? await exerciseDisclosures(page)
          : null;
        const sendReceive = scenario.id === 'no-warning-idle'
          ? await exerciseSendReceive(page, fixture)
          : null;
        const screenshot = path.join(options.screenshotsDir, `${scenario.id}-390x844-dpr3-dark.png`);
        await page.screenshot({ path: screenshot, fullPage: false });
        results.push({
          scenario: scenario.id,
          model: 'gpt-5.4-mini',
          effort: 'low',
          disposable_session: true,
          geometry,
          acceptance: geometryAcceptance(geometry),
          interactions,
          send_receive: sendReceive,
          screenshot: receiptPath(screenshot),
          diagnostics,
        });
      } finally {
        await context.close();
      }
    }
    matrix = await runViewportMatrix({ options, fixture, browsers });
    soak = await runScrollSoak({ options, fixture, browser });
  } finally {
    for (const browser of browsers.values()) await browser.close().catch(() => {});
    await fixture.close();
  }
  const worst = results.find(row => row.scenario === 'worst-warning-stack').geometry;
  const worstRow = results.find(row => row.scenario === 'worst-warning-stack');
  const sendRow = results.find(row => row.scenario === 'no-warning-idle');
  const worstAcceptance = geometryAcceptance(worst);
  const disclosureDrifts = worstRow.interactions.disclosures.flatMap(receipt => [
    receipt.expanded.transcript_drift_px,
    receipt.collapsed.drift_px,
  ]);
  const acceptance = {
    ...worstAcceptance,
    all_state_geometry_green: results.every(row => (
      row.geometry.horizontal_overflow_px === 0
      && row.geometry.composer_fully_visible
    )),
    disclosure_scroll_drift_zero: disclosureDrifts.every(value => value <= 0.5),
    every_disclosure_exercised: worstRow.interactions.disclosures.length === 3,
    disposable_send_receive_green: !!sendRow.send_receive?.assistant_echo_rendered,
    horizontal_overflow_zero: results.every(row => row.geometry.horizontal_overflow_px === 0),
    matrix_green: !options.matrix || (
      matrix.length === options.engines.length * PHONE_VIEWPORTS.length * 2
      && matrix.every(row => row.ok)
    ),
    soak_green: !soak || soak.ok,
  };
  const output = {
    schema_version: 1,
    kind: 'phase3-p3-39-mobile-viewport',
    ok: Object.values(acceptance).every(Boolean),
    mode: options.assertAcceptance ? 'acceptance' : 'baseline',
    asset_source: options.assetSource,
    production_origin: options.assetSource === 'production' ? 'authenticated-production-relay' : null,
    served_asset_identity: results[0]?.geometry.asset_identity || '',
    browser: 'headless Chromium Android emulation',
    viewport: { width: 390, height: 844, device_scale_factor: 3, touch: true },
    requested_engines: options.engines,
    matrix_enabled: options.matrix,
    soak_requested_ms: options.soakMs,
    visible_windows_opened: 0,
    focus_actions: 0,
    acceptance,
    results,
    matrix,
    soak,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: output.ok,
    mode: output.mode,
    asset_source: output.asset_source,
    served_asset_identity: output.served_asset_identity,
    acceptance,
    state_profiles: results.length,
    matrix_cells: matrix.length,
    soak: soak ? {
      ok: soak.ok,
      duration_ms: soak.duration_ms,
      metrics: soak.metrics,
      acceptance: soak.acceptance,
    } : null,
    geometry: Object.fromEntries(results.map(row => [row.scenario, {
      banner_px: row.geometry.rects.banner?.height || 0,
      topbar_px: row.geometry.rects.topbar?.height || 0,
      live_status_px: row.geometry.rects.live_status?.height || 0,
      transcript_px: row.geometry.rects.transcript?.height || 0,
      transcript_ratio: row.geometry.transcript_height_ratio,
      composer_fully_visible: row.geometry.composer_fully_visible,
      horizontal_overflow_px: row.geometry.horizontal_overflow_px,
    }])),
    output: receiptPath(options.output),
    screenshots_dir: receiptPath(options.screenshotsDir),
    visible_windows_opened: 0,
  }, null, 2)}\n`);
  if (options.assertAcceptance) assert(output.ok, `mobile viewport acceptance failed: ${JSON.stringify(acceptance)}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Mobile viewport browser E2E: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = {
  PHONE_VIEWPORTS,
  SCENARIOS,
  SESSION_ID,
  baseSession,
  configureContext,
  contextOptions,
  launchHeadlessBrowser,
  startFixtureServer,
};
