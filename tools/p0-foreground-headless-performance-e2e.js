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
const PUBLIC_ROOT = path.join(ROOT, 'frontend');
const SESSION_COUNT = 69;
const HISTORY_ROWS = 120;
const WORKING_COUNT = 5;
const DEFAULT_STEADY_MS = 30_000;
const DEFAULT_HEAP_SAMPLE_MS = 60_000;
const REQUIRED_HEAP_REPEAT_MS = 60 * 60 * 1000;
const MAX_HEAP_SLOPE_BYTES_PER_HOUR = 5 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    width: 1440,
    height: 900,
    steadyMs: DEFAULT_STEADY_MS,
    heapRepeatMs: 0,
    heapSampleMs: DEFAULT_HEAP_SAMPLE_MS,
    output: '',
    phase: 'measurement',
    disableAnimations: false,
    reducedMotion: false,
    largeTextScale: 1,
    blockingSmoke: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--width' && next) options.width = Number(argv[++index]);
    else if (arg === '--height' && next) options.height = Number(argv[++index]);
    else if (arg === '--steady-ms' && next) options.steadyMs = Number(argv[++index]);
    else if (arg === '--heap-repeat-ms' && next) options.heapRepeatMs = Number(argv[++index]);
    else if (arg === '--heap-sample-ms' && next) options.heapSampleMs = Number(argv[++index]);
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--phase' && next) options.phase = argv[++index];
    else if (arg === '--disable-animations') options.disableAnimations = true;
    else if (arg === '--reduced-motion') options.reducedMotion = true;
    else if (arg === '--large-text-scale' && next) options.largeTextScale = Number(argv[++index]);
    else if (arg === '--blocking-smoke') options.blockingSmoke = true;
    else if (arg === '--read-only') continue;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.width) && options.width >= 320, '--width must be >= 320');
  assert(Number.isInteger(options.height) && options.height >= 600, '--height must be >= 600');
  assert(Number.isInteger(options.steadyMs) && options.steadyMs >= 1000, '--steady-ms must be >= 1000');
  assert(Number.isInteger(options.heapRepeatMs) && options.heapRepeatMs >= 0, '--heap-repeat-ms must be >= 0');
  assert(Number.isInteger(options.heapSampleMs) && options.heapSampleMs >= 1000, '--heap-sample-ms must be >= 1000');
  assert(Number.isFinite(options.largeTextScale) && options.largeTextScale >= 1 && options.largeTextScale <= 2,
    '--large-text-scale must be between 1 and 2');
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

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    samples: finite.length,
    p50_ms: Number(percentile(finite, 0.50).toFixed(3)),
    p95_ms: Number(percentile(finite, 0.95).toFixed(3)),
    p99_ms: Number(percentile(finite, 0.99).toFixed(3)),
    max_ms: Number(Math.max(0, ...finite).toFixed(3)),
  };
}

function frameDistribution(values) {
  const refreshIntervalMs = 1000 / 60;
  const normalized = values.map(sample => (
    Math.max(1, Math.round(sample / refreshIntervalMs)) * refreshIntervalMs
  ));
  return {
    ...distribution(normalized),
    raw: distribution(values),
    frames_over_50ms: values.filter(value => value > 50).length,
  };
}

function metricMap(payload) {
  return Object.fromEntries((payload?.metrics || []).map(item => [item.name, item.value]));
}

function linearSlopeBytesPerHour(samples) {
  if (samples.length < 2) return 0;
  const xs = samples.map(sample => sample.elapsed_ms / 3_600_000);
  const ys = samples.map(sample => sample.heap_bytes);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + ((value - xMean) ** 2), 0);
  if (!denominator) return 0;
  return xs.reduce((sum, value, index) => sum + ((value - xMean) * (ys[index] - yMean)), 0) / denominator;
}

function fixtureSessions() {
  const base = Date.parse('2026-07-13T12:00:00Z');
  return Array.from({ length: SESSION_COUNT }, (_, index) => ({
    session_id: `foreground-session-${String(index).padStart(3, '0')}`,
    display_name: `Foreground performance session ${String(index).padStart(2, '0')}`,
    chat_title: `Foreground headless performance fixture ${String(index).padStart(2, '0')}`,
    agent_type: index % 3 === 0 ? 'codex_cli' : index % 3 === 1 ? 'claude_cli' : 'cursor_cli',
    status: 'healthy',
    health: 'connected',
    is_test_session: false,
    workspace_path: ROOT,
    project_root: ROOT,
    last_seen_at: new Date(base - index * 1000).toISOString(),
    activity: index < WORKING_COUNT ? { kind: 'working', label: 'Working' } : { kind: 'idle', label: '' },
  }));
}

function fixtureMessages(sessionId) {
  const base = Date.parse('2026-07-13T12:30:00Z');
  return Array.from({ length: HISTORY_ROWS }, (_, index) => ({
    id: `${sessionId}:${index + 1}`,
    source_message_id: `${sessionId}:source:${index + 1}`,
    sequence: index + 1,
    ts: (base + index * 1000) / 1000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === HISTORY_ROWS - 1
      ? `Transcript ${sessionId} ready row ${index + 1}`
      : `${sessionId} deterministic row ${index + 1}`,
  }));
}

async function measureTopbarProxyHealthStability(page, send, sessionId) {
  const snapshot = () => page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector);
      const box = node?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    return {
      meta: rect('.topbar-meta'),
      theme: rect('.topbar-meta .theme-toggle-btn'),
      relay: rect('.topbar-meta .context-pill:not(.topbar-proxy-health)'),
      proxy: rect('.topbar-proxy-health'),
      proxy_text: document.querySelector('.topbar-proxy-health')?.textContent?.trim() || '',
    };
  });
  const waitForProxyText = expected => page.waitForFunction(text => (
    document.querySelector('.topbar-proxy-health')?.textContent?.trim() === text
  ), expected, { timeout: 5000 });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(() => setTimeout(resolve, 20)),
  )));
  await settle();
  const before = await snapshot();
  assert(before.proxy, 'topbar proxy-health pill is missing');
  await page.evaluate(() => {
    window.__RAC_FOREGROUND_PERF__.layoutShift = 0;
    window.__RAC_FOREGROUND_PERF__.layoutShifts = [];
  });
  send({ type: 'session_health', session_id: sessionId, health: 'connecting' });
  await waitForProxyText('connecting');
  await settle();
  const connecting = await snapshot();
  send({ type: 'session_health', session_id: sessionId, health: 'healthy' });
  await waitForProxyText('live');
  await settle();
  const restored = await snapshot();
  const layoutEvidence = await page.evaluate(() => ({
    score: window.__RAC_FOREGROUND_PERF__.layoutShift,
    entries: window.__RAC_FOREGROUND_PERF__.layoutShifts,
  }));
  const topbarLayoutShift = layoutEvidence.entries
    .filter(entry => entry.sources.some(source => source.topbar_attributable))
    .reduce((sum, entry) => sum + entry.value, 0);
  const geometryKeys = ['meta', 'theme', 'relay', 'proxy'];
  const maxGeometryDelta = Math.max(...geometryKeys.flatMap(key => (
    ['x', 'y', 'width', 'height'].map(field => Math.abs(
      Number(connecting[key]?.[field] || 0) - Number(before[key]?.[field] || 0),
    ))
  )));
  const maxRestoreDelta = Math.max(...geometryKeys.flatMap(key => (
    ['x', 'y', 'width', 'height'].map(field => Math.abs(
      Number(restored[key]?.[field] || 0) - Number(before[key]?.[field] || 0),
    ))
  )));
  return {
    before,
    connecting,
    restored,
    max_geometry_delta_px: Number(maxGeometryDelta.toFixed(3)),
    max_restore_delta_px: Number(maxRestoreDelta.toFixed(3)),
    layout_shift_score: layoutEvidence.score,
    layout_shift_entries: layoutEvidence.entries,
    topbar_layout_shift_score: topbarLayoutShift,
    pass: maxGeometryDelta <= 0.01 && maxRestoreDelta <= 0.01 && topbarLayoutShift === 0,
  };
}

async function afterPaint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForTranscript(page, sessionId, timeoutMs = 5000) {
  await page.waitForFunction(id => [...document.querySelectorAll('.messages .message')]
    .some(row => String(row.textContent || '').includes(`Transcript ${id} ready`)), sessionId, {
    polling: 'raf', timeout: timeoutMs,
  });
  await afterPaint(page);
}

async function visitSession(page, sessionId, expectedTailMs) {
  const measurement = await page.evaluate(id => new Promise((resolve, reject) => {
    const card = document.querySelector(`.session-card[data-session-id="${id}"]`);
    if (!card) {
      reject(new Error(`missing session card ${id}`));
      return;
    }
    const startedAt = performance.now();
    let shellSeenFrame = null;
    let tailSeenFrame = null;
    let shellPaintMs = null;
    let tailPaintMs = null;
    const timeout = setTimeout(() => reject(new Error(`session paint timeout ${id}`)), 10_000);
    const sampleFrame = now => {
      const shellVisible = Boolean(document.querySelector(`.session-card.active[data-session-id="${id}"]`));
      const tailVisible = [...document.querySelectorAll('.messages .message')]
        .some(row => String(row.textContent || '').includes(`Transcript ${id} ready`));
      if (shellVisible) {
        if (shellSeenFrame === null) shellSeenFrame = now;
        else if (shellPaintMs === null) shellPaintMs = now - startedAt;
      }
      if (tailVisible) {
        if (tailSeenFrame === null) tailSeenFrame = now;
        else if (tailPaintMs === null) tailPaintMs = now - startedAt;
      }
      if (shellPaintMs !== null && tailPaintMs !== null) {
        clearTimeout(timeout);
        resolve({ shellPaintMs, tailPaintMs });
        return;
      }
      requestAnimationFrame(sampleFrame);
    };
    card.click();
    requestAnimationFrame(sampleFrame);
  }), sessionId);
  const { shellPaintMs, tailPaintMs } = measurement;
  return {
    session_id: sessionId,
    shell_paint_ms: Number(shellPaintMs.toFixed(3)),
    tail_paint_ms: Number(tailPaintMs.toFixed(3)),
    shell_pass: shellPaintMs <= 100,
    tail_pass: tailPaintMs <= expectedTailMs,
  };
}

async function measureRoute(page, triggerSelector, targetSelector) {
  return page.evaluate(async ({ triggerSelector, targetSelector }) => {
    const trigger = document.querySelector(triggerSelector);
    if (!trigger) throw new Error(`missing route trigger ${triggerSelector}`);
    const startedAt = performance.now();
    trigger.click();
    while (!document.querySelector(targetSelector)) {
      if (performance.now() - startedAt > 5000) throw new Error(`route timeout ${targetSelector}`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - startedAt;
  }, { triggerSelector, targetSelector });
}

async function measureScroll(page, frameCount = 480) {
  const samples = await page.evaluate(async count => {
    const list = document.querySelector('.messages');
    const values = [];
    let previous = performance.now();
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise(resolve => requestAnimationFrame(now => {
        values.push(now - previous);
        previous = now;
        const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
        const progress = frame < count / 2
          ? 1 - (frame / (count / 2))
          : (frame - count / 2) / (count / 2);
        list.scrollTop = maximum * progress;
        resolve();
      }));
    }
    return values.slice(2);
  }, frameCount);
  return frameDistribution(samples);
}

async function measureFrameCadence(page, frameCount = 480) {
  const samples = await page.evaluate(count => new Promise(resolve => {
    const values = [];
    let previous = performance.now();
    const sampleFrame = now => {
      values.push(now - previous);
      previous = now;
      if (values.length >= count) {
        resolve(values.slice(2));
        return;
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  }), frameCount);
  return frameDistribution(samples);
}

async function measureComposer(page, samples = 24) {
  const textarea = page.locator('.input-area textarea');
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });
  await textarea.focus();
  await page.evaluate(() => {
    const node = document.querySelector('.input-area textarea');
    window.__RAC_FOREGROUND_PERF__.lastKeydown = 0;
    node.addEventListener('keydown', () => {
      window.__RAC_FOREGROUND_PERF__.lastKeydown = performance.now();
    }, true);
  });
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const character = String.fromCharCode(97 + (index % 26));
    await page.keyboard.type(character);
    values.push(await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - window.__RAC_FOREGROUND_PERF__.lastKeydown;
    }));
  }
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  const eventDurations = await page.evaluate(() => window.__RAC_FOREGROUND_PERF__.events
    .filter(entry => entry.name === 'keydown' || entry.name === 'input')
    .map(entry => entry.duration));
  return {
    keystroke_to_paint: distribution(values),
    event_timing: distribution(eventDurations),
  };
}

async function startTracing(cdp, traceState) {
  cdp.on('Tracing.dataCollected', payload => {
    for (const event of payload.value || []) {
      if (event.ph !== 'X' || !Number.isFinite(event.dur)) continue;
      const durationMs = event.dur / 1000;
      const name = String(event.name || 'unknown');
      traceState.categories[name] = (traceState.categories[name] || 0) + durationMs;
      if (name === 'MinorGC' || name === 'MajorGC' || name === 'GCEvent') {
        traceState.gc.push({ name, duration_ms: durationMs });
      }
    }
  });
  traceState.complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,v8',
    options: 'record-as-much-as-possible',
    transferMode: 'ReportEvents',
  });
}

async function stopTracing(cdp, traceState) {
  await cdp.send('Tracing.end');
  await traceState.complete;
}

async function runHeapRepeat({ page, cdp, send, durationMs, sampleMs, selectedSession }) {
  if (!durationMs) return null;
  let stateSeq = 100_000;
  let deltaSeq = 0;
  let generation = 0;
  let messageId = `heap-stream-${generation}`;
  send({
    type: 'message_delta', session_id: selectedSession, message_id: messageId,
    role: 'assistant', block_index: 0, block_type: 'text', seq: 0, op: 'block_open',
  });
  const interval = setInterval(() => {
    deltaSeq += 1;
    stateSeq += 1;
    send({
      type: 'message_delta', session_id: selectedSession, message_id: messageId,
      role: 'assistant', block_index: 0, block_type: 'text', seq: deltaSeq,
      op: 'append', append: `h${deltaSeq % 10}`,
    });
    send({
      type: 'session_summary', protocol_version: 1,
      session: `foreground-session-${String(1 + (deltaSeq % WORKING_COUNT)).padStart(3, '0')}`,
      activity: { kind: 'working', label: `Heap repeat ${deltaSeq % 4}` },
      unread_delta: 0, state_seq: stateSeq, state_epoch: 'foreground-heap',
    });
  }, 1000);
  const startedAt = Date.now();
  const samples = [];
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    samples.push({ elapsed_ms: 0, heap_bytes: (await cdp.send('Runtime.getHeapUsage')).usedSize });
    while (Date.now() - startedAt < durationMs) {
      const remaining = durationMs - (Date.now() - startedAt);
      await page.waitForTimeout(Math.min(sampleMs, Math.max(1, remaining)));
      send({
        type: 'message_delta', session_id: selectedSession, message_id: messageId,
        role: 'assistant', block_index: 0, block_type: 'text', seq: deltaSeq + 1, op: 'block_close',
      });
      send({
        type: 'proxy_message', session_id: selectedSession, role: 'assistant',
        content: `Heap repeat settled sample ${samples.length}`,
        source_message_id: `heap-repeat-settle:${samples.length}`,
        sequence: HISTORY_ROWS + samples.length,
      });
      generation += 1;
      deltaSeq = 0;
      messageId = `heap-stream-${generation}`;
      send({
        type: 'message_delta', session_id: selectedSession, message_id: messageId,
        role: 'assistant', block_index: 0, block_type: 'text', seq: 0, op: 'block_open',
      });
      await page.waitForTimeout(100);
      await cdp.send('HeapProfiler.collectGarbage');
      const sample = {
        elapsed_ms: Date.now() - startedAt,
        heap_bytes: (await cdp.send('Runtime.getHeapUsage')).usedSize,
      };
      samples.push(sample);
      process.stderr.write(`HEAP_SAMPLE ${samples.length - 1} ${sample.elapsed_ms}ms ${sample.heap_bytes} bytes\n`);
    }
  } finally {
    clearInterval(interval);
  }
  const slope = linearSlopeBytesPerHour(samples);
  return {
    configured_duration_ms: durationMs,
    required_duration_ms: REQUIRED_HEAP_REPEAT_MS,
    sample_interval_ms: sampleMs,
    samples,
    slope_bytes_per_hour: Number(slope.toFixed(3)),
    growth_bytes: samples.at(-1).heap_bytes - samples[0].heap_bytes,
    max_allowed_slope_bytes_per_hour: MAX_HEAP_SLOPE_BYTES_PER_HOUR,
    canonical_one_hour: durationMs >= REQUIRED_HEAP_REPEAT_MS,
    pass: slope <= MAX_HEAP_SLOPE_BYTES_PER_HOUR,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const sessions = fixtureSessions();
  const histories = new Map(sessions.map(session => [session.session_id, fixtureMessages(session.session_id)]));
  const historyDelays = new Map();
  const historyRequests = [];
  const clientFrames = [];
  const port = await freePort();
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
  let fixtureSocket = null;
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', protocol_version: 1, heartbeat_interval_ms: 1000,
      heartbeat_timeout_ms: 5000, session_subscriptions: true,
      max_session_subscriptions: 128, sessions, workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrames.push(message.type);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'subscribe') {
        send({
          type: 'subscription_ack', protocol_version: 1,
          request_id: message.request_id, sessions: message.sessions || [], summary_only_for_others: true,
        });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: message.session_id || message.session, capabilities: {} });
      } else if (['history_chunk_request', 'get_history', 'history_request'].includes(message.type)) {
        const sessionId = message.session_id || message.session;
        if (!histories.has(sessionId)) return;
        historyRequests.push({ session_id: sessionId, type: message.type, at_ms: Date.now() });
        const delayMs = Number(historyDelays.get(sessionId) ?? 20);
        setTimeout(() => send({
          type: 'history_chunk', protocol_version: 1,
          session: sessionId, session_id: sessionId, request_id: message.request_id,
          source: 'relay_sqlite', mode: 'tail', replace: true,
          messages: histories.get(sessionId), partial: false, complete: true,
          total_messages: HISTORY_ROWS, loaded_messages: HISTORY_ROWS,
        }), delayMs);
      }
    });
  });

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--js-flags=--expose-gc',
    ],
  });
  let page;
  try {
    const cssViewport = {
      width: Math.max(1, Math.floor(options.width / options.largeTextScale)),
      height: Math.max(1, Math.floor(options.height / options.largeTextScale)),
    };
    const context = await browser.newContext({
      viewport: cssViewport,
      deviceScaleFactor: options.largeTextScale,
      colorScheme: 'dark',
      reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
    });
    await context.addInitScript(() => {
      window.__RAC_FOREGROUND_PERF__ = { longTasks: [], events: [], layoutShift: 0, layoutShifts: [] };
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            window.__RAC_FOREGROUND_PERF__.longTasks.push({ start: entry.startTime, duration: entry.duration });
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            window.__RAC_FOREGROUND_PERF__.events.push({ name: entry.name, duration: entry.duration });
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      } catch {}
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            window.__RAC_FOREGROUND_PERF__.layoutShift += entry.value;
            window.__RAC_FOREGROUND_PERF__.layoutShifts.push({
              start_ms: Number(entry.startTime.toFixed(3)),
              value: entry.value,
              sources: Array.from(entry.sources || []).map(source => ({
                node: source.node instanceof Element
                  ? `${source.node.tagName.toLowerCase()}.${Array.from(source.node.classList || []).join('.')}`
                  : null,
                topbar_attributable: source.node instanceof Element && !!source.node.closest('.topbar-meta'),
              })),
            });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    });
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    const selectedSession = sessions[0].session_id;
    await page.goto(`http://127.0.0.1:${port}/?session=${selectedSession}`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    });
    if (options.disableAnimations) {
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    }
    await page.waitForFunction(count => document.querySelectorAll('.session-card[data-session-id]').length === count,
      SESSION_COUNT, { timeout: 30_000 });
    await waitForTranscript(page, selectedSession, 30_000);

    const send = payload => fixtureSocket?.readyState === fixtureSocket?.OPEN
      && fixtureSocket.send(JSON.stringify(payload));
    assert(fixtureSocket, 'fixture WebSocket did not connect');
    const topbarProxyHealthStability = await measureTopbarProxyHealthStability(page, send, selectedSession);

    await page.waitForTimeout(50);
    const accessibilityPresentation = await page.evaluate(() => {
      const runningAnimationDetails = document.getAnimations()
        .filter(animation => animation.playState === 'running')
        .map(animation => {
          const timing = animation.effect?.getComputedTiming?.() || {};
          const durationMs = Number(timing.duration);
          const iterations = Number(timing.iterations);
          return {
            animation_name: animation.animationName || '',
            target_class: String(animation.effect?.target?.className || ''),
            duration_ms: Number.isFinite(durationMs) ? durationMs : null,
            iterations: Number.isFinite(iterations) ? iterations : null,
            play_state: animation.playState,
            reduced_motion_safe: Number.isFinite(durationMs)
              && durationMs <= 0.011
              && Number.isFinite(iterations)
              && iterations <= 1,
          };
        });
      return {
        reduced_motion_matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        running_animations: runningAnimationDetails.length,
        unsafe_running_animations: runningAnimationDetails.filter(item => !item.reduced_motion_safe).length,
        running_animation_details: runningAnimationDetails,
        root_font_size_px: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        body_zoom: Number.parseFloat(getComputedStyle(document.body).zoom || '1'),
        css_viewport: { width: window.innerWidth, height: window.innerHeight },
        device_pixel_ratio: window.devicePixelRatio,
      };
    });

    const composer = await measureComposer(page, options.blockingSmoke ? 12 : 24);

    const coldVisits = [];
    const coldVisitCount = options.blockingSmoke ? 5 : 10;
    for (let index = 1; index <= coldVisitCount; index += 1) {
      const sessionId = sessions[index].session_id;
      historyDelays.set(sessionId, 300);
      coldVisits.push(await visitSession(page, sessionId, 500));
    }
    const cachedVisits = [];
    const cachedVisitCount = options.blockingSmoke ? 10 : 20;
    for (let index = 0; index < cachedVisitCount; index += 1) {
      cachedVisits.push(await visitSession(page, sessions[(coldVisitCount - 1) + (index % 2)].session_id, 100));
    }
    const coldShell = distribution(coldVisits.map(item => item.shell_paint_ms));
    const coldTail = distribution(coldVisits.map(item => item.tail_paint_ms));
    const cachedTail = distribution(cachedVisits.map(item => item.tail_paint_ms));

    await measureRoute(page, '[aria-label="Fleet view"]', '[data-testid="fleet-view"]');
    await measureRoute(page, '[data-testid="fleet-view"] .automations-back', '.messages');
    await measureRoute(page, '[aria-label="Usage and limits"]', '[data-testid="usage-dashboard"]');
    await measureRoute(page, '[data-testid="usage-dashboard"] .automations-back', '.messages');
    const routeSamples = { fleet: [], fleet_back: [], usage: [], usage_back: [] };
    for (let index = 0; index < 20; index += 1) {
      routeSamples.fleet.push(await measureRoute(page, '[aria-label="Fleet view"]', '[data-testid="fleet-view"]'));
      routeSamples.fleet_back.push(await measureRoute(page, '[data-testid="fleet-view"] .automations-back', '.messages'));
      routeSamples.usage.push(await measureRoute(page, '[aria-label="Usage and limits"]', '[data-testid="usage-dashboard"]'));
      routeSamples.usage_back.push(await measureRoute(page, '[data-testid="usage-dashboard"] .automations-back', '.messages'));
    }
    const surfaceOverflow = {};
    const captureSurfaceOverflow = async (name, selector) => {
      surfaceOverflow[name] = await page.locator(selector).evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const sources = [...node.querySelectorAll('*')]
          .map(element => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              class_name: String(element.className || '').slice(0, 180),
              left_px: rect.left,
              right_px: rect.right,
              width_px: rect.width,
              overflow_right_px: Math.max(0, rect.right - bounds.right),
              scroll_overflow_px: Math.max(0, element.scrollWidth - element.clientWidth),
            };
          })
          .filter(item => item.overflow_right_px > 1 || item.scroll_overflow_px > 1)
          .sort((left, right) => Math.max(right.overflow_right_px, right.scroll_overflow_px)
            - Math.max(left.overflow_right_px, left.scroll_overflow_px))
          .slice(0, 20);
        return {
          node_client_width_px: node.clientWidth,
          node_scroll_width_px: node.scrollWidth,
          node_overflow_px: Math.max(0, node.scrollWidth - node.clientWidth),
          document_overflow_px: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          sources,
        };
      });
    };
    await captureSurfaceOverflow('chat', '.messages-wrap');
    await measureRoute(page, '[aria-label="Fleet view"]', '[data-testid="fleet-view"]');
    await captureSurfaceOverflow('fleet', '[data-testid="fleet-view"]');
    await measureRoute(page, '[data-testid="fleet-view"] .automations-back', '.messages');
    await measureRoute(page, '[aria-label="Usage and limits"]', '[data-testid="usage-dashboard"]');
    await captureSurfaceOverflow('usage', '[data-testid="usage-dashboard"]');
    await measureRoute(page, '[data-testid="usage-dashboard"] .automations-back', '.messages');
    const routes = Object.fromEntries(Object.entries(routeSamples).map(([key, values]) => [key, distribution(values)]));

    await visitSession(page, selectedSession, 100);
    const frameSampleCount = options.blockingSmoke ? 60 : 480;
    const scrollFrames = await measureScroll(page, frameSampleCount);
    let stateSeq = 0;
    const startChurn = messageId => {
      const state = { ticks: 0, delta_frames: 0, summary_frames: 0, stopped: false };
      send({
        type: 'message_delta', session_id: selectedSession, message_id: messageId,
        role: 'assistant', block_index: 0, block_type: 'text', seq: 0, op: 'block_open',
      });
      const tick = () => {
        state.ticks += 1;
        if (state.ticks === 1 || state.ticks % 4 === 0) {
          state.delta_frames += 1;
          send({
            type: 'message_delta', session_id: selectedSession, message_id: messageId,
            role: 'assistant', block_index: 0, block_type: 'text', seq: state.delta_frames,
            op: 'append', append: `s${state.delta_frames % 10}`,
          });
        }
        if (state.ticks % 10 === 0) {
          for (let index = 1; index <= WORKING_COUNT; index += 1) {
            stateSeq += 1;
            state.summary_frames += 1;
            send({
              type: 'session_summary', protocol_version: 1, session: sessions[index].session_id,
              activity: { kind: 'working', label: `Steady ${state.ticks}` }, unread_delta: 0,
              state_seq: stateSeq, state_epoch: 'foreground-steady',
            });
          }
        }
      };
      tick();
      const interval = setInterval(tick, 1000);
      state.stop = () => {
        if (state.stopped) return;
        state.stopped = true;
        clearInterval(interval);
        send({
          type: 'message_delta', session_id: selectedSession, message_id: messageId,
          role: 'assistant', block_index: 0, block_type: 'text', seq: state.delta_frames + 1, op: 'block_close',
        });
      };
      return state;
    };

    // Sample presentation cadence under the same churn independently from the
    // 30-second task/GC budget. A permanent rAF loop would itself wake layout,
    // IntersectionObserver, and prepaint on every frame and charge the probe to
    // application TaskDuration.
    const frameChurn = startChurn('foreground-frame-stream');
    const frameMeasurement = measureFrameCadence(page, frameSampleCount);
    await page.waitForTimeout(100);
    const activeAnimations = await page.evaluate(() => document.getAnimations().map(animation => ({
      animation_name: animation.animationName || '',
      class_name: String(animation.effect?.target?.className || ''),
      tag_name: String(animation.effect?.target?.tagName || '').toLowerCase(),
      play_state: animation.playState,
    })));
    const streamFrames = await frameMeasurement;
    const framePhaseCounts = {
      delta_frames: frameChurn.delta_frames,
      summary_frames: frameChurn.summary_frames,
    };
    await page.waitForTimeout(200);
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    await page.evaluate(() => {
      window.__RAC_FOREGROUND_PERF__.longTasks = [];
      window.__RAC_FOREGROUND_PERF__.layoutShift = 0;
    });
    // TaskDuration must be measured without DevTools tracing. Tracing adds its
    // own main-thread instrumentation and would report the probe as app work.
    const metricsBefore = metricMap(await cdp.send('Performance.getMetrics'));
    const taskCountsBefore = {
      delta_frames: frameChurn.delta_frames,
      summary_frames: frameChurn.summary_frames,
    };
    await page.waitForTimeout(options.steadyMs);
    const metricsAfter = metricMap(await cdp.send('Performance.getMetrics'));
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const browserSteady = await page.evaluate(() => ({
      long_tasks: window.__RAC_FOREGROUND_PERF__.longTasks,
      layout_shift_score: window.__RAC_FOREGROUND_PERF__.layoutShift,
      rendered_dom_rows: document.querySelectorAll('.messages .message').length,
      total_rows: Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0),
    }));

    // Run an equivalent, separate churn interval for exact GC distributions
    // and CPU attribution. This leaves the task budget free of trace overhead.
    const traceState = { gc: [], categories: {} };
    await startTracing(cdp, traceState);
    const traceCountsBefore = {
      delta_frames: frameChurn.delta_frames,
      summary_frames: frameChurn.summary_frames,
    };
    await page.waitForTimeout(options.steadyMs);
    await stopTracing(cdp, traceState);
    frameChurn.stop();
    await page.waitForTimeout(200);
    const gcDurations = traceState.gc.map(item => item.duration_ms);
    const gc = {
      ...distribution(gcDurations),
      total_ms: Number(gcDurations.reduce((sum, value) => sum + value, 0).toFixed(3)),
      events: traceState.gc.length,
    };
    const categoryTotals = Object.entries(traceState.categories)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([name, durationMs]) => ({ name, duration_ms: Number(durationMs.toFixed(3)) }));
    const taskDurationMs = ((metricsAfter.TaskDuration || 0) - (metricsBefore.TaskDuration || 0)) * 1000;
    const scriptDurationMs = ((metricsAfter.ScriptDuration || 0) - (metricsBefore.ScriptDuration || 0)) * 1000;
    const steady = {
      duration_ms: options.steadyMs,
      proxy_frames_sent: (traceCountsBefore.delta_frames - taskCountsBefore.delta_frames)
        + (traceCountsBefore.summary_frames - taskCountsBefore.summary_frames),
      stream_delta_frames: traceCountsBefore.delta_frames - taskCountsBefore.delta_frames,
      summary_frames: traceCountsBefore.summary_frames - taskCountsBefore.summary_frames,
      frame_sample_proxy_frames_sent: 1 + framePhaseCounts.delta_frames + framePhaseCounts.summary_frames,
      trace_proxy_frames_sent: (frameChurn.delta_frames - traceCountsBefore.delta_frames)
        + (frameChurn.summary_frames - traceCountsBefore.summary_frames),
      stream_close_frames_after_trace: 1,
      selected_stream_cadence_ms: 4000,
      background_summary_cadence_ms: 10000,
      active_animations: activeAnimations,
      main_thread_task_time_ms: Number(taskDurationMs.toFixed(3)),
      script_time_ms: Number(scriptDurationMs.toFixed(3)),
      long_tasks_over_50ms: browserSteady.long_tasks.filter(item => item.duration > 50).length,
      long_task_total_ms: Number(browserSteady.long_tasks.reduce((sum, item) => sum + item.duration, 0).toFixed(3)),
      long_task_max_ms: Number(Math.max(0, ...browserSteady.long_tasks.map(item => item.duration)).toFixed(3)),
      gc,
      heap_before_bytes: heapBefore,
      heap_after_gc_bytes: heapAfter,
      heap_delta_after_gc_bytes: heapAfter - heapBefore,
      layout_shift_score: browserSteady.layout_shift_score,
      rendered_dom_rows: browserSteady.rendered_dom_rows,
      total_rows: browserSteady.total_rows,
      stream_frames: streamFrames,
      scroll_frames: scrollFrames,
      cpu_trace_top_categories: categoryTotals,
    };

    const heapRepeat = await runHeapRepeat({
      page, cdp, send, durationMs: options.heapRepeatMs,
      sampleMs: options.heapSampleMs, selectedSession,
    });
    const routePass = Object.values(routes).every(item => item.p95_ms <= 100);
    const surfaceOverflowPass = Object.values(surfaceOverflow).every(item => (
      item.node_overflow_px <= 1 && item.document_overflow_px <= 1
    ));
    const reducedMotionPass = !options.reducedMotion || (
      accessibilityPresentation.reduced_motion_matches
      && accessibilityPresentation.unsafe_running_animations === 0
    );
    const largeTextPass = accessibilityPresentation.css_viewport.width === cssViewport.width
      && accessibilityPresentation.css_viewport.height === cssViewport.height
      && Math.abs(accessibilityPresentation.device_pixel_ratio - options.largeTextScale) <= 0.01
      && accessibilityPresentation.body_zoom === 1;
    const result = {
      ok: composer.keystroke_to_paint.p95_ms <= 50
        && topbarProxyHealthStability.pass
        && cachedTail.p95_ms <= 100
        && coldShell.p95_ms <= 100
        && coldTail.p95_ms <= 500
        && routePass
        && steady.long_tasks_over_50ms === 0
        && steady.main_thread_task_time_ms <= 500
        && steady.gc.total_ms <= 100
        && steady.stream_frames.p95_ms <= 16.7
        && steady.scroll_frames.p95_ms <= 16.7
        && surfaceOverflowPass
        && reducedMotionPass
        && largeTextPass
        && (!heapRepeat || heapRepeat.pass),
      generated_at: new Date().toISOString(),
      evidence_class: options.heapRepeatMs >= REQUIRED_HEAP_REPEAT_MS
        ? 'headless_production_bundle_one_hour'
        : 'headless_production_bundle',
      phase: options.phase,
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      bundle_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_ROOT, 'dist', 'bundle.js'))).digest('hex'),
      fixture: {
        sessions: SESSION_COUNT,
        working_sessions: WORKING_COUNT,
        history_rows_per_session: HISTORY_ROWS,
        viewport: { width: options.width, height: options.height },
        css_viewport: cssViewport,
        device_scale_factor: options.largeTextScale,
        browser_zoom_percent: options.largeTextScale * 100,
        browser: 'chromium',
        headless: true,
        foreground_rendering: true,
        os_windows_opened: 0,
        focus_actions: 0,
        production_mutations: 0,
        animations_disabled: options.disableAnimations,
        reduced_motion: options.reducedMotion,
        large_text_scale: options.largeTextScale,
        blocking_smoke: options.blockingSmoke,
      },
      accessibility_presentation: accessibilityPresentation,
      surface_overflow: surfaceOverflow,
      composer,
      topbar_proxy_health_stability: topbarProxyHealthStability,
      cached_session_click: cachedTail,
      cold_session_shell: coldShell,
      cold_session_tail: coldTail,
      routes,
      steady,
      heap_repeat: heapRepeat,
      protocol: {
        history_requests: historyRequests.length,
        client_frame_types: Object.fromEntries([...new Set(clientFrames)].map(type => [type, clientFrames.filter(item => item === type).length])),
      },
      budgets: {
        composer_p95_ms: 50,
        cached_session_p95_ms: 100,
        cold_shell_p95_ms: 100,
        cold_tail_p95_ms: 500,
        route_p95_ms: 100,
        topbar_proxy_health_max_geometry_delta_px: 0.01,
        main_thread_task_time_ms: 500,
        gc_total_ms: 100,
        frame_p95_ms: 16.7,
        heap_slope_bytes_per_hour: MAX_HEAP_SLOPE_BYTES_PER_HOUR,
      },
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assert(result.ok, 'foreground headless performance budget failed');
    return result;
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`P0 foreground headless performance E2E: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = { distribution, linearSlopeBytesPerHour, main, parseArgs };
