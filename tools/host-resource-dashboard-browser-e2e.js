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
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : null;
};
const outputPath = option('--output');
const screenshotDir = option('--screenshot-dir');

const session = {
  session_id: 'host-resource-fixture', agent_type: 'codex_cli', display_name: 'Host resource fixture',
  title: 'Host resource fixture', chat_title: 'Host resource fixture', status: 'healthy',
  workspace_name: 'Remote Agent Chat', workspace_path: root, project_root: root,
};
const desktopSession = {
  session_id: 'host-resource-desktop-fixture', agent_type: 'codex-desktop', display_name: 'Host resource desktop fixture',
  title: 'Host resource desktop fixture', chat_title: 'Host resource desktop fixture', status: 'healthy',
  workspace_name: 'Remote Agent Chat', workspace_path: root, project_root: root,
};
const fixtureSessions = [session, desktopSession];

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

async function waitUntil(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const startedAt = Date.now() - 899_000;
function systemPoint(sequence) {
  const unavailable = sequence === 300 || sequence === 301;
  const cpu = sequence === 777 ? 96 : 18 + (sequence % 35);
  return {
    schema_version: 2, frame_kind: 'system', source: 'windows_proxy',
    status: unavailable ? 'unavailable' : 'fresh',
    captured_at: new Date(startedAt + (sequence - 1) * 1000).toISOString(),
    monotonic_ms: sequence * 1000, sample_sequence: sequence, sample_interval_ms: 1000,
    dropped_gap_count: sequence >= 300 ? 2 : 0,
    cpu: unavailable ? null : { total_percent: cpu, user_percent: cpu * 0.7, privileged_percent: cpu * 0.3 },
    memory: unavailable ? null : { used_percent: 42 + sequence % 12, commit_percent: 50 + sequence % 8 },
    disk: unavailable ? null : {
      read_bps: sequence === 777 ? 9_000_000_000 : 2_000_000 + sequence * 1000,
      write_bps: 800_000 + sequence * 500, read_iops: sequence * 2, write_iops: sequence,
    },
    network: unavailable ? null : { receive_bps: 700_000 + sequence * 100, send_bps: 250_000 + sequence * 50 },
  };
}

function detailSnapshot(sequence, aggregateOnly = false) {
  const point = systemPoint(sequence);
  return {
    schema_version: 2, source: 'windows_proxy', status: point.status,
    captured_at: point.captured_at, monotonic_ms: point.monotonic_ms,
    sample_sequence: sequence, sample_interval_ms: 1000, dropped_gap_count: point.dropped_gap_count,
    machine_label: aggregateOnly ? null : 'Fixture workstation',
    system: point.status === 'fresh' ? {
      cpu_percent: point.cpu.total_percent,
      cpu: { ...Object.fromEntries(Object.entries(point.cpu).map(([key, value]) => [key, value])), logical_core_count: 16, physical_core_count: 8, current_frequency_mhz: 4700, per_logical: [] },
      memory: { total_bytes: 64 * 1024 ** 3, used_bytes: 32 * 1024 ** 3, available_bytes: 32 * 1024 ** 3, cache_bytes: 4 * 1024 ** 3, commit_bytes: 36 * 1024 ** 3, commit_limit_bytes: 72 * 1024 ** 3, ...point.memory },
      disk: { ...point.disk, busy_percent: 12, read_latency_ms: 1.2, write_latency_ms: 2.4, queue_length: 0.5 },
      disks: aggregateOnly ? [] : [{ id: 'disk0', label: 'Physical disk 0', kind: 'physical', read_bps: point.disk.read_bps, write_bps: point.disk.write_bps, available: true }],
      network: { ...point.network, receive_pps: 400, send_pps: 200, receive_errors: 0, send_errors: 0 },
      network_adapters: aggregateOnly ? [] : [{ id: 'ethernet', label: 'Ethernet', kind: 'physical', physical_default: true, receive_bps: point.network.receive_bps, send_bps: point.network.send_bps, available: true }],
      process_count: 80, thread_count: 900, handle_count: 8000, uptime_seconds: 100000,
    } : null,
    processes: aggregateOnly ? [] : [
      {
        pid: 4242, parent_pid: 4000, start_time: '2026-07-15T17:00:00.000Z', stable_key: '4242:2026-07-15T17:00:00.000Z', parent_key: null,
        name: 'node.exe', attributed: true, agent_label: 'Remote Agent proxy', agent_types: ['agent-proxy'], workspace_label: 'Remote Agent Chat', session_count: 1,
        attribution_level: 'owned', attribution_reason: 'PID is explicitly owned by the local proxy runtime', cpu_host_percent: 3.5, cpu_core_equivalent: 56,
        memory_bytes: 256 * 1024 ** 2, private_bytes: 220 * 1024 ** 2, commit_bytes: 240 * 1024 ** 2,
        io_read_bps: sequence * 100, io_write_bps: sequence * 200, io_read_ops: 10, io_write_ops: 20, thread_count: 12, handle_count: 80,
        child_count: 1, selected_as: ['owned', 'cpu'], selected_parent_present: false,
        counter_totals: { io_read_bytes: '9007199254740993', io_write_bytes: '8007199254740993', io_read_operations: '100', io_write_operations: '200' },
      },
      {
        pid: 4343, parent_pid: 4242, start_time: '2026-07-15T17:00:10.000Z', stable_key: '4343:2026-07-15T17:00:10.000Z', parent_key: '4242:2026-07-15T17:00:00.000Z',
        name: 'worker.exe', attributed: false, attribution_level: 'unattributed', attribution_reason: 'No proved agent relationship',
        cpu_host_percent: 1.2, cpu_core_equivalent: 19.2, memory_bytes: 64 * 1024 ** 2, private_bytes: 50 * 1024 ** 2, commit_bytes: 55 * 1024 ** 2,
        io_read_bps: 1000, io_write_bps: 2000, child_count: 0, selected_as: ['read'], selected_parent_present: true,
        counter_totals: { io_read_bytes: '42', io_write_bytes: '84', io_read_operations: '4', io_write_operations: '8' },
      },
      {
        pid: 5151, parent_pid: 5000, start_time: '2026-07-15T17:01:00.000Z', stable_key: '5151:2026-07-15T17:01:00.000Z', parent_key: null,
        name: 'Code.exe', attributed: true, agent_label: 'VS Code', agent_types: ['codex'], workspace_label: 'Remote Agent Chat', session_count: 2,
        attribution_level: 'runtime', attribution_reason: 'Shared VS Code runtime; no exact session ownership is implied',
        cpu_host_percent: 2.4, cpu_core_equivalent: 38.4, memory_bytes: 800 * 1024 ** 2, private_bytes: 700 * 1024 ** 2, commit_bytes: 750 * 1024 ** 2,
        io_read_bps: 3000, io_write_bps: 4000, child_count: 0, selected_as: ['memory'], selected_parent_present: false,
        counter_totals: { io_read_bytes: '1000', io_write_bytes: '2000', io_read_operations: '10', io_write_operations: '20' },
      },
    ],
    capabilities: { schema_v2: true, gpu: false, sensors: false, unavailable: [] },
    sampling: { collection_duration_ms: 610, process_total: 80, process_included: aggregateOnly ? 0 : 3, process_limit: 32, truncated: !aggregateOnly, selection_rule: 'union: owned + top cpu + top memory + top read + top write', system_interval_ms: 1000, detail_interval_ms: 5000, windows_hide: true },
    privacy: { ephemeral: true, relay_cached: false, relay_persisted: false, command_lines_transmitted: false, executable_paths_transmitted: false, aggregate_only: aggregateOnly, transient_fields: aggregateOnly ? [] : ['pid', 'process_name', 'machine_label', 'workspace_label', 'metrics'] },
    error: point.status === 'fresh' ? null : { code: 'collector_unavailable', message: 'Windows host metrics are temporarily unavailable.' },
  };
}

const systemHistory = Array.from({ length: 900 }, (_, index) => systemPoint(index + 1));
const detailHistory = Array.from({ length: 180 }, (_, index) => detailSnapshot((index + 1) * 5));

async function main() {
  const port = await freePort();
  const clientFrames = [];
  const consoleErrors = [];
  const subscriptions = new Map();
  const connections = new Set();
  let subscriptionSerial = 0;
  let connectionSerial = 0;
  let connectionCount = 0;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  let maxSubscriptions = 0;
  let maxSubscriptionsPerConnection = 0;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.url.startsWith('/api/scheduled-sends') ? '{"scheduled_sends":[]}' : '{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
  wss.on('connection', ws => {
    const connectionId = ++connectionSerial;
    connectionCount += 1;
    connections.add(ws);
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({ type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000, sessions: fixtureSessions, workspaces: [] });
    setTimeout(() => {
      send({ type: 'session_list', sessions: fixtureSessions, workspaces: [] });
      send({ type: 'session_snapshot', sessions: fixtureSessions });
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
        send({ type: 'history_chunk', session_id: sessionId, request_id: message.request_id, source: 'fixture', mode: 'tail', replace: true, messages: [{ role: 'assistant', content: 'Host resource fixture ready.', sequence: 1 }], total_messages: 1, loaded_messages: 1, partial: false });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sessionId, session_id: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'host_resource_subscribe') {
        const id = message.resume_subscription_id || `host-sub-${String(++subscriptionSerial).padStart(32, '0')}`;
        subscriptions.set(id, { aggregateOnly: message.aggregate_only === true, connectionId, ws });
        subscribeCount += 1;
        maxSubscriptions = Math.max(maxSubscriptions, subscriptions.size);
        maxSubscriptionsPerConnection = Math.max(maxSubscriptionsPerConnection,
          [...subscriptions.values()].filter(subscription => subscription.connectionId === connectionId).length);
        send({ type: 'host_resource_subscription_ack', request_id: message.request_id, subscription_id: id, aggregate_only: message.aggregate_only === true, resumed: !!message.resume_subscription_id, system_points: message.aggregate_only === true ? 60 : 900, detail_points: message.aggregate_only === true ? 0 : 180 });
      } else if (message.type === 'host_resource_history_request') {
        const subscription = subscriptions.get(message.subscription_id);
        const aggregateOnly = subscription?.aggregateOnly === true;
        const source = message.stream === 'detail'
          ? detailHistory.map(snapshot => aggregateOnly ? detailSnapshot(snapshot.sample_sequence, true) : snapshot)
          : systemHistory;
        const maximum = message.stream === 'detail' ? 8 : 64;
        const points = source.filter(point => point.sample_sequence > Number(message.after_sequence || 0)).slice(0, maximum);
        const next = points.at(-1)?.sample_sequence || Number(message.after_sequence || 0);
        const done = !source.some(point => point.sample_sequence > next);
        send({ type: 'host_resource_history_chunk', request_id: message.request_id, subscription_id: message.subscription_id, chunk: { stream: message.stream, points, after_sequence: message.after_sequence || 0, next_sequence: next, done, retained_points: source.length, aggregate_only: aggregateOnly } });
        if (message.stream === 'system' && done) {
          const freshPoint = { ...systemPoint(900), sample_sequence: 901, monotonic_ms: 901_000, captured_at: new Date().toISOString() };
          setTimeout(() => send({ type: 'host_resource_live', subscription_id: message.subscription_id, point: freshPoint }), 5);
        }
      } else if (message.type === 'host_resource_refresh') {
        const active = [...subscriptions.values()].filter(subscription => subscription.connectionId === connectionId).at(-1);
        send({ type: 'host_resource_snapshot', request_id: message.request_id, snapshot: detailSnapshot(900, active?.aggregateOnly === true) });
      } else if (message.type === 'host_resource_unsubscribe') {
        subscriptions.delete(message.subscription_id);
        unsubscribeCount += 1;
        send({ type: 'host_resource_unsubscribed', request_id: message.request_id, subscription_id: message.subscription_id });
      }
    });
    ws.on('close', () => {
      connections.delete(ws);
      for (const [id, subscription] of subscriptions) {
        if (subscription.connectionId === connectionId) subscriptions.delete(id);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'no-preference', ignoreHTTPSErrors: true });
    await context.addInitScript(() => {
      localStorage.setItem('remote-agent-chat:show-test-sessions:v1', '1');
      localStorage.setItem('remote-agent-chat-theme', 'light');
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('requestfailed', request => consoleErrors.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
    await page.goto(`http://127.0.0.1:${port}/?session=${session.session_id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 10000 });
    const globalStrip = page.locator('[data-testid="global-host-resource-strip"]');
    await globalStrip.waitFor({ state: 'visible', timeout: 12000 });
    await page.waitForFunction(() => /CPU\s+\d+%.*RAM\s+\d+%/s.test(document.querySelector('[data-testid="global-host-resource-strip"]')?.textContent || ''), null, { timeout: 10000 });
    const stripBeforeDashboard = await globalStrip.evaluate(node => {
      const box = node.getBoundingClientRect();
      const rail = node.closest('[data-testid="global-desktop-status-rail"]')?.getBoundingClientRect();
      return {
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        status: node.dataset.status,
        sampleSequence: Number(node.dataset.sampleSequence || 0),
        bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
        railHeight: rail?.height || 0,
      };
    });
    assert(
      stripBeforeDashboard.status === 'live' || stripBeforeDashboard.status === 'stale',
      `route matrix strip must retain a truthful live/stale state, received ${stripBeforeDashboard.status}`,
    );
    assert.match(stripBeforeDashboard.text, /CPU\s+\d+%.*RAM\s+\d+%/s);
    assert.equal(stripBeforeDashboard.railHeight, 36);
    assert(stripBeforeDashboard.sampleSequence > 0);
    await page.locator(`.session-card[data-session-id="${session.session_id}"]`).click();
    await page.locator('.topbar-title-row').waitFor({ state: 'visible', timeout: 10000 });

    const routeSamples = [];
    const captureRoute = async (name, selector, theme) => {
      await page.locator(selector).waitFor({ state: 'visible', timeout: 10000 });
      const sample = await page.evaluate(({ routeName, themeName }) => {
        const rail = document.querySelector('[data-testid="global-desktop-status-rail"]');
        const strip = document.querySelector('[data-testid="global-host-resource-strip"]');
        const railBox = rail?.getBoundingClientRect();
        const stripBox = strip?.getBoundingClientRect();
        return {
          route: routeName,
          expectedTheme: themeName,
          theme: document.documentElement.dataset.theme || null,
          rail: railBox ? { x: railBox.x, y: railBox.y, width: railBox.width, height: railBox.height } : null,
          strip: stripBox ? { x: stripBox.x, y: stripBox.y, width: stripBox.width, height: stripBox.height } : null,
          status: strip?.dataset.status || null,
          text: strip?.textContent?.replace(/\s+/g, ' ').trim() || '',
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, { routeName: name, themeName: theme });
      assert(sample.rail, `${name} route is missing the global desktop rail`);
      assert(sample.strip, `${name} route is missing the CPU/RAM strip`);
      assert.equal(sample.theme, theme, `${name} route did not apply the ${theme} app theme`);
      assert.equal(sample.rail.height, 36, `${name} route changed the reserved rail height`);
      assert.equal(sample.strip.width, 326, `${name} route changed the strip width`);
      assert(sample.horizontalOverflow <= 1, `${name} route horizontal overflow ${sample.horizontalOverflow}`);
      routeSamples.push(sample);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `global-strip-${name}-1440-${theme}.png`), fullPage: true });
    };
    const backToChat = async selector => {
      await page.locator(selector).click();
      await page.locator('.messages').waitFor({ state: 'visible', timeout: 10000 });
    };
    const cycleRoutes = async theme => {
      await captureRoute('chat', '.messages', theme);

      await page.getByRole('button', { name: 'Usage and limits', exact: true }).click();
      await captureRoute('usage', '[data-testid="usage-dashboard"]', theme);
      await backToChat('.usage-dashboard .automations-back');

      await page.getByRole('button', { name: 'Fleet view', exact: true }).click();
      await captureRoute('fleet', '[data-testid="fleet-view"]', theme);
      await backToChat('.fleet-view .automations-back');

      await page.getByRole('button', { name: 'Search all transcripts', exact: true }).click();
      await captureRoute('search', '[data-testid="transcript-search-view"]', theme);
      await backToChat('.transcript-search-view .skills-back');

      const sessionActions = page.getByLabel('Session actions for Host resource desktop fixture');
      const automationsItem = page.getByRole('menuitem', { name: 'Automations', exact: true });
      if (!(await automationsItem.isVisible().catch(() => false))) {
        await sessionActions.click();
      }
      await automationsItem.click();
      await captureRoute('automations', '.automations-view', theme);
      await backToChat('.automations-view .automations-back');

      if (!(await page.getByRole('menuitem', { name: 'Skills', exact: true }).isVisible().catch(() => false))) {
        await sessionActions.click();
      }
      await page.getByRole('menuitem', { name: 'Skills', exact: true }).click();
      await captureRoute('skills', '.skills-view', theme);
      await backToChat('.skills-view .skills-back');
    };
    const captureZoomAndWide = async theme => {
      const samples = [];
      for (const zoom of [1, 1.25, 2]) {
        await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
        await page.waitForTimeout(50);
        const sample = await page.evaluate(({ zoomValue, themeName }) => {
          const rail = document.querySelector('[data-testid="global-desktop-status-rail"]')?.getBoundingClientRect();
          const strip = document.querySelector('[data-testid="global-host-resource-strip"]')?.getBoundingClientRect();
          return {
            theme: themeName,
            actualTheme: document.documentElement.dataset.theme || null,
            zoom: zoomValue,
            railHeight: rail?.height || 0,
            stripWidth: strip?.width || 0,
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, { zoomValue: zoom, themeName: theme });
        assert.equal(sample.actualTheme, theme);
        assert(sample.railHeight > 0 && sample.stripWidth > 0, `${theme} ${zoom * 100}% zoom hid the desktop strip`);
        assert(sample.horizontalOverflow <= 1, `${theme} ${zoom * 100}% zoom overflow ${sample.horizontalOverflow}`);
        samples.push(sample);
        if (screenshotDir && zoom > 1) {
          await page.screenshot({ path: path.join(screenshotDir, `global-strip-chat-1440-zoom-${Math.round(zoom * 100)}-${theme}.png`), fullPage: true });
        }
      }
      await page.evaluate(() => { document.body.style.zoom = ''; });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(50);
      const wide = await page.locator('[data-testid="global-host-resource-strip"]').evaluate((node, themeName) => {
        const box = node.getBoundingClientRect();
        return {
          theme: themeName,
          actualTheme: document.documentElement.dataset.theme || null,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, theme);
      assert.equal(wide.actualTheme, theme);
      assert.equal(wide.width, 326);
      assert(wide.overflow <= 1);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `global-strip-chat-1920-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      return { samples, wide };
    };
    const chatTitleBeforeRoutes = await page.locator('.topbar-title-row').evaluate(node => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await cycleRoutes('light');
    const lightGeometry = await captureZoomAndWide('light');
    const unsubscribesBeforeLightMobile = unsubscribeCount;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-testid="global-desktop-status-rail"]').count(), 0,
      '390px light Web must reserve no permanent CPU/RAM strip slot');
    await page.getByRole('button', { name: 'Host resources', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    const lightMobile = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme || null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(lightMobile.theme, 'light');
    assert(lightMobile.overflow <= 1, `390px light Web overflow ${lightMobile.overflow}`);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'global-strip-chat-390x844-light.png'), fullPage: true });
    assert.equal(unsubscribeCount, unsubscribesBeforeLightMobile + 1,
      'the final light-mobile consumer release must unsubscribe exactly once');
    await page.setViewportSize({ width: 1440, height: 900 });
    await globalStrip.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(100);
    await page.getByTitle('Toggle Light/Dark Mode').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 10000 });
    await cycleRoutes('dark');
    const darkGeometry = await captureZoomAndWide('dark');
    const visibilityRefreshBefore = clientFrames.filter(frame => frame.type === 'host_resource_refresh').length;
    await page.evaluate(() => {
      window.__hostResourceOriginalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState') || null;
      window.__hostResourceFixtureVisibility = 'hidden';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => window.__hostResourceFixtureVisibility,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => document.visibilityState), 'hidden');
    await page.evaluate(() => {
      window.__hostResourceFixtureVisibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
    await waitUntil(
      () => clientFrames.filter(frame => frame.type === 'host_resource_refresh').length > visibilityRefreshBefore,
      5000,
      'visibility-return aggregate refresh',
    );
    await page.evaluate(() => {
      const original = window.__hostResourceOriginalVisibilityDescriptor;
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else delete document.visibilityState;
      delete window.__hostResourceFixtureVisibility;
      delete window.__hostResourceOriginalVisibilityDescriptor;
    });
    const visibilityLifecycle = {
      hidden_observed: true,
      visible_observed: true,
      refresh_frames: clientFrames.filter(frame => frame.type === 'host_resource_refresh').length - visibilityRefreshBefore,
    };

    const connectionCountBeforeReconnect = connectionCount;
    const subscribeCountBeforeReconnect = subscribeCount;
    const activeMainSubscription = [...subscriptions.values()][0];
    assert(activeMainSubscription?.ws, 'main tab is missing its aggregate subscription before reconnect');
    activeMainSubscription.ws.close(4001, 'fixture reconnect');
    await waitUntil(
      () => connectionCount > connectionCountBeforeReconnect && subscriptions.size === 1 && subscribeCount > subscribeCountBeforeReconnect,
      10000,
      'main tab aggregate subscription reconnect',
    );
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="global-host-resource-strip"]')?.dataset.status;
      return status === 'live' || status === 'stale';
    }, null, { timeout: 10000 });
    const reconnectLifecycle = {
      connections_created: connectionCount - connectionCountBeforeReconnect,
      subscribe_frames: subscribeCount - subscribeCountBeforeReconnect,
      effective_subscriptions_after: subscriptions.size,
      retained_values: await globalStrip.evaluate(node => (
        node.dataset.cpuPercent !== ''
        && node.dataset.memoryPercent !== ''
        && Number.isFinite(Number(node.dataset.cpuPercent))
        && Number.isFinite(Number(node.dataset.memoryPercent))
      )),
    };
    assert(reconnectLifecycle.retained_values, 'reconnect cleared the strip last-good values');

    const secondPage = await context.newPage();
    secondPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(`tab2: ${message.text()}`); });
    secondPage.on('pageerror', error => consoleErrors.push(`tab2: ${error.message}`));
    await secondPage.goto(`http://127.0.0.1:${port}/?session=${session.session_id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await secondPage.locator('[data-testid="global-host-resource-strip"]').waitFor({ state: 'visible', timeout: 10000 });
    await waitUntil(() => subscriptions.size === 2, 5000, 'one effective aggregate subscription per browser tab');
    assert.equal(maxSubscriptionsPerConnection, 1, 'a Web client created duplicate effective subscriptions');
    const twoTabLifecycle = {
      effective_subscriptions_while_open: subscriptions.size,
      maximum_per_connection: maxSubscriptionsPerConnection,
    };
    await secondPage.close();
    await waitUntil(() => subscriptions.size === 1, 5000, 'second-tab subscription cleanup');
    twoTabLifecycle.effective_subscriptions_after_close = subscriptions.size;
    twoTabLifecycle.first_tab_retained_values = await globalStrip.evaluate(node => (
      node.dataset.cpuPercent !== ''
      && node.dataset.memoryPercent !== ''
      && Number.isFinite(Number(node.dataset.cpuPercent))
      && Number.isFinite(Number(node.dataset.memoryPercent))
    ));
    assert(twoTabLifecycle.first_tab_retained_values, 'closing tab two cleared tab one strip values');

    const unsubscribeBeforeRapidMounts = unsubscribeCount;
    const rapidMountSequences = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.setViewportSize({ width: 899, height: 900 });
      await page.waitForFunction(() => !document.querySelector('[data-testid="global-desktop-status-rail"]'), null, { timeout: 5000 });
      await waitUntil(() => subscriptions.size === 0, 5000, `rapid unmount ${cycle + 1}`);
      await page.setViewportSize({ width: 900, height: 900 });
      await globalStrip.waitFor({ state: 'visible', timeout: 5000 });
      await waitUntil(() => subscriptions.size === 1, 5000, `rapid remount ${cycle + 1}`);
      await page.waitForFunction(minimumSequence => (
        Number(document.querySelector('[data-testid="global-host-resource-strip"]')?.dataset.sampleSequence || 0)
          >= minimumSequence
      ), stripBeforeDashboard.sampleSequence, { timeout: 10000 });
      rapidMountSequences.push(await globalStrip.evaluate(node => Number(node.dataset.sampleSequence || 0)));
    }
    assert.equal(unsubscribeCount - unsubscribeBeforeRapidMounts, 3,
      'each rapid final-consumer unmount must unsubscribe exactly once');
    assert(rapidMountSequences.every(sequence => sequence >= stripBeforeDashboard.sampleSequence),
      'rapid remount cleared or regressed retained aggregate history');
    await page.setViewportSize({ width: 1440, height: 900 });
    const rapidMountLifecycle = {
      cycles: 3,
      explicit_unsubscribes: unsubscribeCount - unsubscribeBeforeRapidMounts,
      sequences_after_remount: rapidMountSequences,
      effective_subscriptions_after: subscriptions.size,
    };
    const chatTitleAfterRoutes = await page.locator('.topbar-title-row').evaluate(node => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    assert.deepEqual(chatTitleAfterRoutes, chatTitleBeforeRoutes,
      'route cycles must restore the exact chat-title geometry');

    const zoomSamples = [...lightGeometry.samples, ...darkGeometry.samples];
    const wideDesktop = { light: lightGeometry.wide, dark: darkGeometry.wide };

    const hostResourcesButton = page.getByRole('button', { name: 'Host resources', exact: true });
    await hostResourcesButton.waitFor({ state: 'visible', timeout: 12000 });
    await hostResourcesButton.click();
    const dashboard = page.locator('[data-testid="host-resource-dashboard"]');
    await dashboard.waitFor({ state: 'visible', timeout: 5000 });
    await dashboard.locator('.host-resource-process-table tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Since open' }).click();
    await page.waitForFunction(() => document.querySelector('.host-resource-controls')?.textContent.includes('60 samples'), null, { timeout: 10000 });

    assert.equal(await dashboard.locator('.host-resource-chart').count(), 4, 'four interactive charts must render');
    assert.equal(await dashboard.locator('.host-resource-chart-data').count(), 4, 'each chart must expose an accessible table');
    assert.equal(await dashboard.locator('.host-resource-process-table tbody tr').count(), 3);
    const desktop = await dashboard.evaluate(node => ({
      overflow: node.scrollWidth - node.clientWidth,
      chartColumns: getComputedStyle(document.querySelector('.host-resource-charts')).gridTemplateColumns.split(' ').filter(Boolean).length,
      chartHeights: [...document.querySelectorAll('.host-resource-chart')].map(chart => chart.getBoundingClientRect().height),
      canvasHeights: [...document.querySelectorAll('.host-resource-chart-canvas')].map(chart => chart.getBoundingClientRect().height),
    }));
    assert(desktop.overflow <= 1, `desktop overflow ${desktop.overflow}`);
    assert.equal(desktop.chartColumns, 2, 'desktop charts must be a 2x2 grid');
    assert(desktop.chartHeights.every(height => height >= 240));
    assert(desktop.canvasHeights.every(height => height >= 210));

    const firstCanvas = dashboard.locator('.host-resource-chart-canvas').first();
    await firstCanvas.focus();
    const tooltipBefore = await dashboard.locator('.host-resource-chart-tooltip').first().innerText();
    await firstCanvas.press('ArrowLeft');
    const tooltipAfter = await dashboard.locator('.host-resource-chart-tooltip').first().innerText();
    assert.notEqual(tooltipAfter, tooltipBefore, 'keyboard crosshair must move to an exact prior sample');
    await firstCanvas.hover();
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('button', { name: 'Reset zoom' }).isDisabled(), false, 'wheel zoom must update the shared viewport');
    const box = await firstCanvas.boundingBox();
    assert(box);
    await firstCanvas.dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: box.x + box.width * 0.35, clientY: box.y + 80, buttons: 1 });
    await firstCanvas.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', clientX: box.x + box.width * 0.65, clientY: box.y + 80, buttons: 1 });
    await firstCanvas.dispatchEvent('pointermove', { pointerId: 12, pointerType: 'touch', clientX: box.x + box.width * 0.8, clientY: box.y + 80, buttons: 1 });
    await firstCanvas.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch', clientX: box.x + box.width * 0.35, clientY: box.y + 80 });
    await firstCanvas.dispatchEvent('pointerup', { pointerId: 12, pointerType: 'touch', clientX: box.x + box.width * 0.8, clientY: box.y + 80 });
    await page.getByRole('button', { name: 'Reset zoom' }).click();

    const firstLegend = dashboard.locator('.host-resource-chart-legend button').first();
    await firstLegend.click();
    assert.equal(await firstLegend.getAttribute('aria-pressed'), 'false', 'legend toggles must be stateful and accessible');
    await firstLegend.click();
    const autoScale = dashboard.locator('.host-resource-chart-heading button').first();
    await autoScale.click();
    assert.match(await autoScale.innerText(), /^Fixed /, 'rate scale must support a fixed read-back');
    await autoScale.click();

    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Resume' }).waitFor();
    await page.getByRole('button', { name: 'Resume' }).click();
    const processSearch = dashboard.locator('.host-resource-process-controls input');
    await processSearch.fill('worker');
    assert.equal(await dashboard.locator('.host-resource-process-table tbody tr').count(), 1);
    await processSearch.fill('');
    await dashboard.locator('.host-resource-process-select').first().click();
    await dashboard.locator('.host-resource-process-overlay').waitFor({ state: 'visible' });
    assert((await dashboard.locator('.host-resource-chart-legend').first().innerText()).includes('overlay'));
    assert((await dashboard.locator('.host-resource-process-overlay').innerText()).includes('9007199254740993'), '64-bit counter strings must remain exact');

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const aggregate = page.getByLabel('Aggregate-only privacy');
    await aggregate.check();
    await page.waitForFunction(() => document.querySelector('.host-resource-meta')?.textContent.includes('Aggregate-only'));
    assert.equal(await dashboard.locator('.host-resource-process-section').count(), 0, 'aggregate-only mode must remove process labels and rows');
    assert(!(await dashboard.innerText()).includes('Fixture workstation'), 'aggregate-only mode must remove the machine label');
    await aggregate.uncheck();
    await dashboard.locator('.host-resource-process-section').waitFor({ state: 'visible', timeout: 10000 });
    const explicitUnsubscribesBeforeFinalDashboardClose = unsubscribeCount;

    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'host-resources-1440x900-dark.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-testid="global-desktop-status-rail"]').count(), 0,
      '390px Web must reserve no permanent CPU/RAM strip slot');
    const mobile = await dashboard.evaluate(node => ({
      overflow: node.scrollWidth - node.clientWidth,
      bounds: (() => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right }; })(),
      chartColumns: getComputedStyle(document.querySelector('.host-resource-charts')).gridTemplateColumns.split(' ').filter(Boolean).length,
      chartHeights: [...document.querySelectorAll('.host-resource-chart')].map(chart => chart.getBoundingClientRect().height),
    }));
    assert(mobile.overflow <= 1, `mobile overflow ${mobile.overflow}`);
    assert(mobile.bounds.left >= -1 && mobile.bounds.right <= 391);
    assert.equal(mobile.chartColumns, 1, 'mobile charts must be full-width');
    assert(mobile.chartHeights.every(height => height >= 210));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'host-resources-390x844-dark.png'), fullPage: true });

    await dashboard.locator('.automations-back').click();
    await page.locator('.messages').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(50);
    assert.equal(unsubscribeCount, explicitUnsubscribesBeforeFinalDashboardClose + 1,
      'aggregate/detail mode changes must retain one subscription; the final dashboard consumer release must unsubscribe once');
    const forbidden = new Set(['send', 'input', 'agent_interrupt', 'agent_config_set', 'agent_control', 'broadcast_send', 'permission_response', 'question_answer', 'terminal_input', 'new_conversation', 'switch_conversation', 'close_session']);
    const mutating = clientFrames.filter(frame => forbidden.has(frame.type));
    assert.deepEqual(mutating, []);
    assert.deepEqual(consoleErrors, [], `browser errors: ${consoleErrors.join(' | ')}`);

    const result = {
      ok: true,
      build: await page.evaluate(() => {
        const bundle = document.querySelector('script[src*="/dist/bundle.js"]');
        return bundle ? new URL(bundle.src, location.href).searchParams.get('v') : null;
      }),
      system_points: 60, detail_points: 180, unavailable_gaps: 0, spike_sequence: null,
      strip_before_dashboard: stripBeforeDashboard,
      route_samples: routeSamples,
      zoom_samples: zoomSamples,
      wide_desktop: wideDesktop,
      visibility_lifecycle: visibilityLifecycle,
      reconnect_lifecycle: reconnectLifecycle,
      two_tab_lifecycle: twoTabLifecycle,
      rapid_mount_lifecycle: rapidMountLifecycle,
      chat_title_geometry_restored: true,
      desktop, mobile_light: lightMobile, mobile, charts: 4, accessible_tables: 4, keyboard_crosshair: true,
      wheel_zoom: true, touch_pinch: true, synchronized_viewport: true, pause_resume: true,
      process_tree_rows: 3, process_overlay: true, exact_64_bit_counter: true,
      aggregate_only_labels_removed: true, explicit_unsubscribes: unsubscribeCount,
      subscribe_frames: subscribeCount,
      max_effective_subscriptions_all_tabs: maxSubscriptions,
      max_effective_subscriptions_per_client: maxSubscriptionsPerConnection,
      mode_change_unsubscribes: 0, mobile_permanent_strip: false,
      console_errors: consoleErrors, mutating_frames: mutating.length,
      visible_windows_opened: 0, focus_actions: 0, headless: true,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, serialized); }
    process.stdout.write(serialized);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(`host resource dashboard browser E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
