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
  title: 'Host resource fixture', status: 'healthy', workspace_path: root, project_root: root,
};

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
  let subscriptionSerial = 0;
  let unsubscribeCount = 0;
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
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    let ackSent = false;
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrames.push(message);
      const sessionId = message.session_id || message.session;
      if (message.type === 'subscribe' && !ackSent) {
        ackSent = true;
        send({ type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000, sessions: [session], workspaces: [] });
        setTimeout(() => {
          send({ type: 'session_list', sessions: [session], workspaces: [] });
          send({ type: 'session_snapshot', sessions: [session] });
        }, 25);
      } else if (message.type === 'heartbeat') {
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
        subscriptions.set(id, { aggregateOnly: message.aggregate_only === true });
        send({ type: 'host_resource_subscription_ack', request_id: message.request_id, subscription_id: id, aggregate_only: message.aggregate_only === true, resumed: !!message.resume_subscription_id, system_points: 900, detail_points: 180 });
      } else if (message.type === 'host_resource_history_request') {
        const subscription = subscriptions.get(message.subscription_id);
        const aggregateOnly = subscription?.aggregateOnly === true;
        const source = message.stream === 'detail'
          ? detailHistory.map(snapshot => aggregateOnly ? detailSnapshot(snapshot.sample_sequence, true) : snapshot)
          : systemHistory;
        const maximum = message.stream === 'detail' ? 8 : 64;
        const points = source.filter(point => point.sample_sequence > Number(message.after_sequence || 0)).slice(0, maximum);
        const next = points.at(-1)?.sample_sequence || Number(message.after_sequence || 0);
        send({ type: 'host_resource_history_chunk', request_id: message.request_id, subscription_id: message.subscription_id, chunk: { stream: message.stream, points, after_sequence: message.after_sequence || 0, next_sequence: next, done: !source.some(point => point.sample_sequence > next), retained_points: source.length, aggregate_only: aggregateOnly } });
      } else if (message.type === 'host_resource_refresh') {
        const active = [...subscriptions.values()].at(-1);
        send({ type: 'host_resource_snapshot', request_id: message.request_id, snapshot: detailSnapshot(900, active?.aggregateOnly === true) });
      } else if (message.type === 'host_resource_unsubscribe') {
        subscriptions.delete(message.subscription_id);
        unsubscribeCount += 1;
        send({ type: 'host_resource_unsubscribed', request_id: message.request_id, subscription_id: message.subscription_id });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'no-preference', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('requestfailed', request => consoleErrors.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
    await page.goto(`http://127.0.0.1:${port}/?session=${session.session_id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const hostResourcesButton = page.getByRole('button', { name: 'Host resources' });
    await hostResourcesButton.waitFor({ state: 'visible', timeout: 12000 });
    await hostResourcesButton.click();
    const dashboard = page.locator('[data-testid="host-resource-dashboard"]');
    await dashboard.waitFor({ state: 'visible', timeout: 5000 });
    await dashboard.locator('.host-resource-process-table tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Since open' }).click();
    await page.waitForFunction(() => document.querySelector('.host-resource-controls')?.textContent.includes('900 samples'), null, { timeout: 10000 });

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

    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'host-resources-1440x900-dark.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
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
    assert(unsubscribeCount >= 3, 'route close and aggregate mode changes must explicitly unsubscribe');
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
      system_points: 900, detail_points: 180, unavailable_gaps: 2, spike_sequence: 777,
      desktop, mobile, charts: 4, accessible_tables: 4, keyboard_crosshair: true,
      wheel_zoom: true, touch_pinch: true, synchronized_viewport: true, pause_resume: true,
      process_tree_rows: 3, process_overlay: true, exact_64_bit_counter: true,
      aggregate_only_labels_removed: true, explicit_unsubscribes: unsubscribeCount,
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
