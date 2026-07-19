#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const diagnostic = args.includes('--diagnostic');
const durationSeconds = Math.max(10, Math.round(Number(option('--duration-seconds', diagnostic ? '20' : '1800')) || 0));
const intervalMs = 1_000;
const formal = !diagnostic && durationSeconds >= 1_800;
const outputPath = option('--output') ? path.resolve(option('--output')) : null;
const screenshotPath = option('--screenshot') ? path.resolve(option('--screenshot')) : null;
const session = {
  session_id: 'global-strip-soak-fixture',
  agent_type: 'codex_cli',
  display_name: 'Global strip soak fixture',
  title: 'Global strip soak fixture',
  chat_title: 'Global strip soak fixture',
  status: 'healthy',
  workspace_name: 'Remote Agent Chat',
  workspace_path: root,
  project_root: root,
};
const forbiddenWireKeys = [
  'processes', 'process_rows', 'detail_history', 'machine_label', 'workspace_label',
  'command_line', 'command_lines', 'executable_path', 'executable_paths', 'pid', 'parent_pid',
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome executable not found');
  return executable;
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

function percentile(values, quantile) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function summarize(values) {
  const rows = values.filter(Number.isFinite);
  return {
    samples: rows.length,
    min: rows.length ? Math.min(...rows) : null,
    p50: percentile(rows, 0.5),
    p95: percentile(rows, 0.95),
    max: rows.length ? Math.max(...rows) : null,
    mean: rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null,
  };
}

function metricMap(metrics) {
  return Object.fromEntries((metrics?.metrics || []).map(metric => [metric.name, metric.value]));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function aggregatePoint(sequence, capturedAtMs) {
  const cpuPercent = 18.037 + (sequence % 61) * 0.611;
  const memoryPercent = 39.019 + (sequence % 43) * 0.317;
  const totalBytes = 64 * 1024 ** 3;
  return {
    schema_version: 2,
    frame_kind: 'system',
    source: 'soak_fixture',
    status: 'fresh',
    captured_at: new Date(capturedAtMs).toISOString(),
    monotonic_ms: sequence * intervalMs,
    sample_sequence: sequence,
    sample_interval_ms: intervalMs,
    dropped_gap_count: 0,
    cpu: {
      total_percent: cpuPercent,
      user_percent: cpuPercent * 0.7,
      privileged_percent: cpuPercent * 0.3,
    },
    memory: {
      used_percent: memoryPercent,
      commit_percent: memoryPercent + 5,
      used_bytes: Math.round(totalBytes * memoryPercent / 100),
      total_bytes: totalBytes,
    },
    disk: { read_bps: 0, write_bps: 0, read_iops: 0, write_iops: 0 },
    network: { receive_bps: 0, send_bps: 0, receive_pps: 0, send_pps: 0 },
  };
}

async function main() {
  assert(diagnostic || formal, 'formal soak requires at least 1800 seconds; use --diagnostic for a shorter run');
  const port = await freePort();
  const clientFrames = [];
  const subscriptions = new Map();
  const sockets = new Set();
  const consoleErrors = [];
  const rows = [];
  const checkpoints = [];
  const sendIntervalsMs = [];
  let latestPoint = null;
  let previousSendAt = null;
  let subscriptionSerial = 0;
  let subscribeFrames = 0;
  let unsubscribeFrames = 0;
  let maximumEffectiveSubscriptions = 0;
  let maximumSourceSamplers = 0;

  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.url.startsWith('/api/scheduled-sends') ? '{"scheduled_sends":[]}' : '{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)
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
    send({ type: 'connection_ack', heartbeat_interval_ms: 1_000, heartbeat_timeout_ms: 5_000, sessions: [session], workspaces: [] });
    setTimeout(() => {
      send({ type: 'session_list', sessions: [session], workspaces: [] });
      send({ type: 'session_snapshot', sessions: [session] });
    }, 25);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrames.push(message);
      const sessionId = message.session_id || message.session;
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sessionId, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sessionId, request_id: message.request_id,
          source: 'fixture', mode: 'tail', replace: true,
          messages: [{ role: 'assistant', content: 'Global strip soak fixture ready.', sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sessionId, session_id: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'host_resource_subscribe') {
        assert.equal(message.aggregate_only, true, 'global-only soak requested process detail');
        const id = message.resume_subscription_id || `host-strip-soak-${String(++subscriptionSerial).padStart(24, '0')}`;
        subscriptions.set(id, ws);
        subscribeFrames += 1;
        maximumEffectiveSubscriptions = Math.max(maximumEffectiveSubscriptions, subscriptions.size);
        maximumSourceSamplers = Math.max(maximumSourceSamplers, subscriptions.size ? 1 : 0);
        send({
          type: 'host_resource_subscription_ack', request_id: message.request_id,
          subscription_id: id, aggregate_only: true, resumed: Boolean(message.resume_subscription_id),
          system_points: 0, detail_points: 0,
        });
      } else if (message.type === 'host_resource_history_request') {
        assert.equal(message.stream, 'system', 'aggregate-only soak requested detail history');
        send({
          type: 'host_resource_history_chunk', request_id: message.request_id,
          subscription_id: message.subscription_id,
          chunk: {
            stream: 'system', points: [], after_sequence: message.after_sequence || 0,
            next_sequence: message.after_sequence || 0, done: true, retained_points: 0,
            aggregate_only: true,
          },
        });
      } else if (message.type === 'host_resource_refresh') {
        if (latestPoint) {
          send({
            type: 'host_resource_snapshot', request_id: message.request_id,
            snapshot: {
              ...latestPoint,
              frame_kind: undefined,
              system: {
                cpu_percent: latestPoint.cpu.total_percent,
                cpu: latestPoint.cpu,
                memory: latestPoint.memory,
                disk: latestPoint.disk,
                network: latestPoint.network,
                disks: [], network_adapters: [],
              },
              processes: [],
              privacy: {
                ephemeral: true, relay_cached: false, relay_persisted: false,
                aggregate_only: true, command_lines_transmitted: false,
                executable_paths_transmitted: false,
              },
            },
          });
        }
      } else if (message.type === 'host_resource_unsubscribe') {
        subscriptions.delete(message.subscription_id);
        unsubscribeFrames += 1;
        send({ type: 'host_resource_unsubscribed', request_id: message.request_id, subscription_id: message.subscription_id });
      }
    });
    ws.on('close', () => {
      sockets.delete(ws);
      for (const [id, owner] of subscriptions) if (owner === ws) subscriptions.delete(id);
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser = null;
  let page = null;
  let baseline = null;
  try {
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--js-flags=--expose-gc'],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript(() => {
      localStorage.setItem('remote-agent-chat:show-test-sessions:v1', '1');
      const metrics = {
        activeTimeouts: 0,
        activeIntervals: 0,
        activeAnimationFrames: 0,
        activeListeners: 0,
        layoutShift: 0,
        stripTopbarLayoutShift: 0,
        layoutShiftSources: [],
        longTaskCount: 0,
        longTaskDurationMs: 0,
      };
      const timeoutIds = new Set();
      const intervalIds = new Set();
      const animationFrameIds = new Set();
      const listenerRegistry = new WeakMap();
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeClearTimeout = window.clearTimeout.bind(window);
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
      const nativeAddEventListener = EventTarget.prototype.addEventListener;
      const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;
      window.setTimeout = (callback, delay, ...callbackArgs) => {
        let id;
        id = nativeSetTimeout((...runArgs) => {
          timeoutIds.delete(id);
          metrics.activeTimeouts = timeoutIds.size;
          callback(...runArgs);
        }, delay, ...callbackArgs);
        timeoutIds.add(id);
        metrics.activeTimeouts = timeoutIds.size;
        return id;
      };
      window.clearTimeout = id => {
        timeoutIds.delete(id);
        metrics.activeTimeouts = timeoutIds.size;
        return nativeClearTimeout(id);
      };
      window.setInterval = (callback, delay, ...callbackArgs) => {
        const id = nativeSetInterval(callback, delay, ...callbackArgs);
        intervalIds.add(id);
        metrics.activeIntervals = intervalIds.size;
        return id;
      };
      window.clearInterval = id => {
        intervalIds.delete(id);
        metrics.activeIntervals = intervalIds.size;
        return nativeClearInterval(id);
      };
      window.requestAnimationFrame = callback => {
        let id;
        id = nativeRequestAnimationFrame(timestamp => {
          animationFrameIds.delete(id);
          metrics.activeAnimationFrames = animationFrameIds.size;
          callback(timestamp);
        });
        animationFrameIds.add(id);
        metrics.activeAnimationFrames = animationFrameIds.size;
        return id;
      };
      window.cancelAnimationFrame = id => {
        animationFrameIds.delete(id);
        metrics.activeAnimationFrames = animationFrameIds.size;
        return nativeCancelAnimationFrame(id);
      };
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        let byKey = listenerRegistry.get(this);
        if (!byKey) { byKey = new Map(); listenerRegistry.set(this, byKey); }
        const key = `${String(type)}:${capture ? 'capture' : 'bubble'}`;
        let listeners = byKey.get(key);
        if (!listeners) { listeners = new Set(); byKey.set(key, listeners); }
        if (listener && !listeners.has(listener)) {
          listeners.add(listener);
          metrics.activeListeners += 1;
        }
        return nativeAddEventListener.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, options) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        const key = `${String(type)}:${capture ? 'capture' : 'bubble'}`;
        const listeners = listenerRegistry.get(this)?.get(key);
        if (listeners?.delete(listener)) metrics.activeListeners -= 1;
        return nativeRemoveEventListener.call(this, type, listener, options);
      };
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            metrics.layoutShift += entry.value;
            const sources = (entry.sources || []).map(source => {
              const rawNode = source.node;
              const node = rawNode?.nodeType === 1 ? rawNode : rawNode?.parentElement;
              const relevant = Boolean(node?.closest?.(
                '[data-testid="global-desktop-status-rail"], .topbar, .topbar-title-row',
              ));
              return {
                relevant,
                tag: node?.tagName || null,
                id: node?.id || null,
                class_name: typeof node?.className === 'string' ? node.className.slice(0, 160) : null,
              };
            });
            if (sources.some(source => source.relevant)) metrics.stripTopbarLayoutShift += entry.value;
            if (metrics.layoutShiftSources.length < 50) {
              metrics.layoutShiftSources.push({ value: entry.value, sources });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            metrics.longTaskCount += 1;
            metrics.longTaskDurationMs += entry.duration;
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      window.__globalStripSoakMetrics = metrics;
    });
    page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('requestfailed', request => consoleErrors.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
    await page.goto(`http://127.0.0.1:${port}/?session=${session.session_id}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const strip = page.locator('[data-testid="global-host-resource-strip"]');
    await strip.waitFor({ state: 'visible', timeout: 12_000 });
    await page.locator('.topbar-title-row').waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 10_000 });
    await page.evaluate(() => {
      window.__globalStripPaints = {};
      const stripNode = document.querySelector('[data-testid="global-host-resource-strip"]');
      const observer = new MutationObserver(() => {
        const sequence = Number(stripNode?.dataset.sampleSequence || 0);
        if (!sequence || window.__globalStripPaints[sequence]) return;
        requestAnimationFrame(() => { window.__globalStripPaints[sequence] = Date.now(); });
      });
      observer.observe(stripNode, { attributes: true, attributeFilter: ['data-sample-sequence'] });
      window.__globalStripPaintObserver = observer;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(2_000);
    assert.equal(subscriptions.size, 1, 'global strip did not establish one aggregate subscription');
    const baselinePage = await page.evaluate(() => {
      const stripNode = document.querySelector('[data-testid="global-host-resource-strip"]');
      const railNode = document.querySelector('[data-testid="global-desktop-status-rail"]');
      const titleNode = document.querySelector('.topbar-title-row');
      const box = node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        metrics: { ...window.__globalStripSoakMetrics },
        strip: box(stripNode), rail: box(railNode), title: box(titleNode),
      };
    });
    const baselinePerformance = metricMap(await cdp.send('Performance.getMetrics'));
    const baselineHeap = await cdp.send('Runtime.getHeapUsage');
    const soakStartedAt = performance.now();
    baseline = {
      page: baselinePage,
      performance: baselinePerformance,
      heap: baselineHeap,
      wall_started_at_ms: soakStartedAt,
    };
    let previousTaskDuration = Number(baselinePerformance.TaskDuration) || 0;

    for (let sequence = 1; sequence <= durationSeconds; sequence += 1) {
      const target = soakStartedAt + sequence * intervalMs;
      const remaining = target - performance.now();
      if (remaining > 0) await sleep(remaining);
      const sentAt = Date.now();
      if (previousSendAt !== null) sendIntervalsMs.push(sentAt - previousSendAt);
      previousSendAt = sentAt;
      latestPoint = aggregatePoint(sequence, sentAt);
      const payload = JSON.stringify({
        type: 'host_resource_live', subscription_id: [...subscriptions.keys()][0], point: latestPoint,
      });
      assert(!forbiddenWireKeys.some(key => payload.includes(`"${key}"`)), 'aggregate live frame leaked detail fields');
      for (const [id, owner] of subscriptions) {
        if (owner.readyState === owner.OPEN) owner.send(JSON.stringify({ type: 'host_resource_live', subscription_id: id, point: latestPoint }));
      }
      const painted = await page.waitForFunction(expectedSequence => {
        const node = document.querySelector('[data-testid="global-host-resource-strip"]');
        const renderedSequence = Number(node?.dataset.sampleSequence || 0);
        const paintedAt = Number(window.__globalStripPaints?.[expectedSequence] || 0);
        if (renderedSequence < expectedSequence || !paintedAt) return null;
        return {
          paintedAt,
          renderedSequence,
          cpuPercent: Number(node.dataset.cpuPercent),
          memoryPercent: Number(node.dataset.memoryPercent),
          historyCount: Number(node.dataset.historyCount),
          status: node.dataset.status,
        };
      }, sequence, { timeout: 5_000 });
      const paintedValue = await painted.jsonValue();
      const currentPerformance = metricMap(await cdp.send('Performance.getMetrics'));
      const taskDuration = Number(currentPerformance.TaskDuration) || previousTaskDuration;
      const renderTaskMs = Math.max(0, (taskDuration - previousTaskDuration) * 1_000);
      previousTaskDuration = taskDuration;
      rows.push({
        sample_sequence: sequence,
        sent_at_ms: sentAt,
        painted_at_ms: paintedValue.paintedAt,
        sample_to_paint_ms: paintedValue.paintedAt - sentAt,
        render_task_ms: renderTaskMs,
        expected_cpu_percent: latestPoint.cpu.total_percent,
        rendered_cpu_percent: paintedValue.cpuPercent,
        cpu_error_percentage_points: Math.abs(latestPoint.cpu.total_percent - paintedValue.cpuPercent),
        expected_memory_percent: latestPoint.memory.used_percent,
        rendered_memory_percent: paintedValue.memoryPercent,
        memory_error_percentage_points: Math.abs(latestPoint.memory.used_percent - paintedValue.memoryPercent),
        history_count: paintedValue.historyCount,
        status: paintedValue.status,
      });
      if (sequence === 1 || sequence % 60 === 0 || sequence === durationSeconds) {
        const checkpoint = await page.evaluate(sampleSequence => {
          const stripNode = document.querySelector('[data-testid="global-host-resource-strip"]');
          const railNode = document.querySelector('[data-testid="global-desktop-status-rail"]');
          const titleNode = document.querySelector('.topbar-title-row');
          const box = node => {
            const rect = node.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          };
          return {
            sample_sequence: sampleSequence,
            metrics: { ...window.__globalStripSoakMetrics },
            strip: box(stripNode), rail: box(railNode), title: box(titleNode),
            history_count: Number(stripNode.dataset.historyCount || 0),
            status: stripNode.dataset.status,
          };
        }, sequence);
        checkpoint.heap = await cdp.send('Runtime.getHeapUsage');
        checkpoints.push(checkpoint);
      }
    }

    const soakEndedAt = performance.now();
    const endPerformance = metricMap(await cdp.send('Performance.getMetrics'));
    const preGcHeap = await cdp.send('Runtime.getHeapUsage');
    await cdp.send('HeapProfiler.collectGarbage');
    const endHeap = await cdp.send('Runtime.getHeapUsage');
    const endPage = await page.evaluate(() => ({
      metrics: { ...window.__globalStripSoakMetrics },
      build: (() => {
        const bundle = document.querySelector('script[src*="/dist/bundle.js"]');
        return bundle ? new URL(bundle.src, location.href).searchParams.get('v') : null;
      })(),
    }));
    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    const paintLatencies = rows.map(row => row.sample_to_paint_ms);
    const renderTasks = rows.map(row => row.render_task_ms);
    const cpuErrors = rows.map(row => row.cpu_error_percentage_points);
    const memoryErrors = rows.map(row => row.memory_error_percentage_points);
    const taskDurationMs = Math.max(0,
      ((Number(endPerformance.TaskDuration) || 0) - (Number(baselinePerformance.TaskDuration) || 0)) * 1_000);
    const wallMs = soakEndedAt - soakStartedAt;
    const oneCoreCpuPercent = wallMs > 0 ? taskDurationMs / wallMs * 100 : Infinity;
    const heapGrowthBytes = Number(endHeap.usedSize) - Number(baselineHeap.usedSize);
    const layoutShiftDelta = endPage.metrics.layoutShift - baselinePage.metrics.layoutShift;
    const stripTopbarLayoutShiftDelta = endPage.metrics.stripTopbarLayoutShift
      - baselinePage.metrics.stripTopbarLayoutShift;
    const timerSnapshots = [baselinePage, ...checkpoints].map(snapshot => snapshot.metrics);
    const geometryStable = (field, tolerance = 0.01) => checkpoints.every(checkpoint => (
      ['x', 'y', 'width', 'height'].every(key => (
        Math.abs(checkpoint[field][key] - baselinePage[field][key]) <= tolerance
      ))
    ));
    const hostFrames = clientFrames.filter(frame => String(frame.type || '').startsWith('host_resource'));
    const serializedHostFrames = JSON.stringify(hostFrames);
    const gates = {
      formal_duration: diagnostic || (formal && wallMs >= 1_800_000 - 100),
      samples: rows.length === durationSeconds,
      one_effective_subscription: maximumEffectiveSubscriptions === 1 && subscriptions.size === 1,
      one_source_sampler: maximumSourceSamplers === 1,
      aggregate_only_subscribe: hostFrames.filter(frame => frame.type === 'host_resource_subscribe')
        .every(frame => frame.aggregate_only === true),
      no_detail_history_requests: !hostFrames.some(frame => frame.type === 'host_resource_history_request' && frame.stream === 'detail'),
      no_privacy_leaks: !forbiddenWireKeys.some(key => serializedHostFrames.includes(`"${key}"`)),
      compact_history_bound: rows.every(row => row.history_count <= 60)
        && rows.filter(row => row.sample_sequence >= 60).every(row => row.history_count === 60),
      truth_cpu: Math.max(...cpuErrors) <= 0.1,
      truth_memory: Math.max(...memoryErrors) <= 0.1,
      sample_to_paint: percentile(paintLatencies, 0.95) <= 2_000,
      render_work: percentile(renderTasks, 0.95) <= 16,
      renderer_cpu: oneCoreCpuPercent <= 0.5,
      heap_growth: heapGrowthBytes <= 25 * 1024 * 1024,
      listener_bound: Math.max(...timerSnapshots.map(snapshot => snapshot.activeListeners))
        <= baselinePage.metrics.activeListeners + 2,
      interval_bound: Math.max(...timerSnapshots.map(snapshot => snapshot.activeIntervals))
        <= baselinePage.metrics.activeIntervals + 1,
      timeout_bound: Math.max(...timerSnapshots.map(snapshot => snapshot.activeTimeouts))
        <= baselinePage.metrics.activeTimeouts + 8,
      animation_frame_bound: Math.max(...timerSnapshots.map(snapshot => snapshot.activeAnimationFrames)) <= 2,
      strip_topbar_layout_shift_zero: Math.abs(stripTopbarLayoutShiftDelta) < 0.0000005,
      strip_geometry_stable: geometryStable('strip'),
      rail_geometry_stable: geometryStable('rail'),
      chat_title_geometry_stable: geometryStable('title'),
      no_console_errors: consoleErrors.length === 0,
      no_mutating_frames: !clientFrames.some(frame => [
        'send', 'input', 'agent_interrupt', 'agent_config_set', 'agent_control', 'broadcast_send',
        'permission_response', 'question_answer', 'terminal_input', 'new_conversation',
        'switch_conversation', 'close_session',
      ].includes(frame.type)),
      live_status: rows.every(row => row.status === 'live'),
      cadence: sendIntervalsMs.length === Math.max(0, durationSeconds - 1)
        && percentile(sendIntervalsMs, 0.95) <= 1_100,
    };
    const result = {
      ok: Object.values(gates).every(Boolean),
      formal_30_minute_gate: formal,
      build: endPage.build,
      gates,
      duration: {
        requested_seconds: durationSeconds,
        measured_ms: wallMs,
        sample_interval_ms: intervalMs,
        samples: rows.length,
        sequence_range: rows.length ? [rows[0].sample_sequence, rows.at(-1).sample_sequence] : [],
      },
      sample_to_paint_ms: summarize(paintLatencies),
      render_task_ms: summarize(renderTasks),
      truth: {
        aligned_samples: rows.length,
        maximum_cpu_error_percentage_points: Math.max(...cpuErrors),
        maximum_memory_error_percentage_points: Math.max(...memoryErrors),
      },
      cadence_ms: summarize(sendIntervalsMs),
      subscription: {
        subscribe_frames: subscribeFrames,
        unsubscribe_frames: unsubscribeFrames,
        maximum_effective_subscriptions: maximumEffectiveSubscriptions,
        effective_subscriptions_at_end: subscriptions.size,
        maximum_source_samplers: maximumSourceSamplers,
      },
      browser_overhead: {
        logical_cpu_count: os.cpus().length,
        renderer_task_duration_ms: taskDurationMs,
        renderer_one_core_cpu_percent: oneCoreCpuPercent,
        heap_used_bytes_before_gc_baseline: baselineHeap.usedSize,
        heap_used_bytes_before_gc_end: preGcHeap.usedSize,
        heap_used_bytes_after_gc_end: endHeap.usedSize,
        retained_heap_growth_bytes: heapGrowthBytes,
        listener_timer_baseline: baselinePage.metrics,
        listener_timer_end: endPage.metrics,
        listener_timer_checkpoints: timerSnapshots,
      },
      layout: {
        total_page_cls_delta: layoutShiftDelta,
        strip_topbar_cls_contribution: stripTopbarLayoutShiftDelta,
        observed_shift_sources: endPage.metrics.layoutShiftSources,
        baseline: { strip: baselinePage.strip, rail: baselinePage.rail, title: baselinePage.title },
        checkpoints: checkpoints.map(checkpoint => ({
          sample_sequence: checkpoint.sample_sequence,
          strip: checkpoint.strip,
          rail: checkpoint.rail,
          title: checkpoint.title,
          history_count: checkpoint.history_count,
          status: checkpoint.status,
        })),
      },
      privacy: {
        aggregate_only: true,
        detail_history_requests: hostFrames.filter(frame => frame.type === 'host_resource_history_request' && frame.stream === 'detail').length,
        forbidden_wire_keys_present: forbiddenWireKeys.filter(key => serializedHostFrames.includes(`"${key}"`)),
        process_rows_transmitted: 0,
        command_lines_transmitted: 0,
        executable_paths_transmitted: 0,
      },
      console_errors: consoleErrors,
      mutating_frames: clientFrames.filter(frame => [
        'send', 'input', 'agent_interrupt', 'agent_config_set', 'agent_control', 'broadcast_send',
        'permission_response', 'question_answer', 'terminal_input', 'new_conversation',
        'switch_conversation', 'close_session',
      ].includes(frame.type)).length,
      headless: true,
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_sessions_mutated: 0,
      checkpoints,
      rows,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
    }
    process.stdout.write(`${JSON.stringify({ ...result, rows: `[${rows.length} rows written to evidence]`, checkpoints: `[${checkpoints.length} checkpoints written to evidence]` }, null, 2)}\n`);
    assert(result.ok, `failed gates: ${Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name).join(', ')}`);
  } finally {
    try { await page?.evaluate(() => window.__globalStripPaintObserver?.disconnect()); } catch {}
    for (const socket of sockets) try { socket.close(); } catch {}
    if (browser) await browser.close();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`global host resource strip soak: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
