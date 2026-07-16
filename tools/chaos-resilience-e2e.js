#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const jwt = require('../relay-server/node_modules/jsonwebtoken');
const { fork, spawn } = require('child_process');
const { chromium } = require('../frontend/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const SESSION_NAME = 'Chaos Fixture Session';
const MAX_RECOVERY_MS = 3000;

function parseArgs(argv) {
  const options = { output: null, keepArtifacts: false, authOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) options.output = path.resolve(argv[++i]);
    else if (argv[i] === '--keep-artifacts') options.keepArtifacts = true;
    else if (argv[i] === '--auth-only') options.authOnly = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
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

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function boundedLogs(child) {
  const lines = [];
  const collect = chunk => {
    lines.push(String(chunk));
    while (lines.join('').length > 16_000) lines.shift();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  return () => lines.join('');
}

function eventQueue(child) {
  const events = [];
  child.on('message', message => events.push(message));
  return {
    events,
    async wait(type, after = 0, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = events.find(event => event.type === type && Number(event.at_ms || 0) >= after);
        if (match) return match;
        if (child.exitCode != null) throw new Error(`Child exited ${child.exitCode} waiting for ${type}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for child event ${type}`);
    },
  };
}

async function stopChild(child, label) {
  if (!child || child.exitCode != null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exit,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} did not stop`)), 3000)),
  ]);
}

async function waitHealth(origin, child, logs, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Relay exited ${child.exitCode}: ${logs()}`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Relay health timeout: ${logs()}`);
}

async function verifyAuthSurface(origin) {
  const headers = { 'X-Forwarded-For': '203.0.113.10', 'X-Forwarded-Proto': 'https' };
  const unauthenticated = await fetch(`${origin}/`, { redirect: 'manual', headers });
  assert.equal(unauthenticated.status, 302, 'chaos unauthenticated root must redirect');
  assert.equal(unauthenticated.headers.get('location'), '/auth/google');
  const token = jwt.sign(
    { email: 'chaos-fixture@localhost' },
    'chaos-fixture-jwt-secret-012345678901234567890123456789',
    { expiresIn: '5m' },
  );
  const authenticated = await fetch(`${origin}/`, {
    headers: { ...headers, Authorization: `Bearer ${token}` },
  });
  const body = await authenticated.text();
  assert.equal(authenticated.status, 200, 'chaos authenticated root must load');
  assert(body.includes('id="root"'), 'chaos authenticated root is missing app shell');
  return { unauthenticated_status: 302, redirect: '/auth/google', authenticated_status: 200 };
}

function startRelay(port, dataDir) {
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'chaos-fixture-session-secret-0123456789',
      JWT_SECRET: 'chaos-fixture-jwt-secret-012345678901234567890123456789',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'chaos-fixture-client-id',
      GOOGLE_CLIENT_SECRET: 'chaos-fixture-client-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  return { child, logs: boundedLogs(child) };
}

function startHarness(stateFile, generation) {
  const child = fork(path.join(__dirname, 'chaos-fixture-harness.js'), [
    '--state-file', stateFile,
    '--generation', String(generation),
  ], { cwd: root, silent: true, windowsHide: true });
  return { child, queue: eventQueue(child), logs: boundedLogs(child) };
}

function startProxy(relayUrl, stateFile, lockFile) {
  const child = fork(path.join(__dirname, 'chaos-fixture-proxy.js'), [
    '--relay-url', relayUrl,
    '--state-file', stateFile,
    '--lock-file', lockFile,
    '--workspace', root,
  ], { cwd: root, silent: true, windowsHide: true });
  return { child, queue: eventQueue(child), logs: boundedLogs(child) };
}

async function pageState(page) {
  return page.evaluate(name => {
    const body = document.body?.innerText || '';
    return {
      session_visible: body.includes(name),
      reconnecting: body.includes('Reconnecting…') || body.includes('No agents connected'),
      working: body.includes('Working') || body.includes('Generating'),
      stop_visible: !!document.querySelector('.stop-btn'),
      body: body.slice(0, 1200),
    };
  }, SESSION_NAME);
}

async function selectFixture(page) {
  const card = page.getByText(SESSION_NAME, { exact: true }).first();
  await card.waitFor({ state: 'visible', timeout: 3000 });
  await card.click({ timeout: 1000 });
}

async function waitForFixtureCard(page, relay, proxy, timeoutMs = 8000) {
  try {
    await page.getByText(SESSION_NAME, { exact: true }).first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      `Fixture session card was not visible at ${page.url()}: ${error.message}`,
      `body=${body.slice(0, 1600)}`,
      `relay=${relay?.logs?.().slice(-3000) || ''}`,
      `proxy=${proxy?.logs?.().slice(-3000) || ''}`,
    ].join('\n'));
  }
}

async function waitForMarker(page, marker, timeoutMs = 3000) {
  await page.waitForFunction(
    ({ marker, name }) => {
      const body = document.body?.innerText || '';
      return body.includes(name)
        && body.includes(marker)
        && !body.includes('Reconnecting…')
        && !body.includes('No agents connected')
        && !body.includes('Working')
        && !body.includes('Generating')
        && !document.querySelector('.stop-btn');
    },
    { marker, name: SESSION_NAME },
    { timeout: timeoutMs },
  );
}

async function waitWorking(page, timeoutMs = 3000) {
  await page.waitForFunction(
    name => {
      const body = document.body?.innerText || '';
      return body.includes(name) && (body.includes('Working') || body.includes('Generating'));
    },
    SESSION_NAME,
    { timeout: timeoutMs },
  );
}

function sendHarness(harness, message) {
  if (!harness?.child?.connected) throw new Error('Fixture harness IPC is unavailable');
  harness.child.send(message);
}

async function settleScenario(results, name, startedAt, page, marker, relay, proxy) {
  if (await page.locator('.session-card.active').count() === 0) {
    try { await selectFixture(page); } catch {}
  }
  try {
    await waitForMarker(page, marker, MAX_RECOVERY_MS);
  } catch (error) {
    const state = await pageState(page).catch(() => ({}));
    throw new Error([
      `${name} did not settle on ${marker}: ${error.message}`,
      `page=${page.url()} state=${JSON.stringify(state)}`,
      `relay=${relay?.logs?.().slice(-3000) || ''}`,
      `proxy=${proxy?.logs?.().slice(-3000) || ''}`,
    ].join('\n'));
  }
  const recoveryMs = Date.now() - startedAt;
  const state = await pageState(page);
  assert(recoveryMs <= MAX_RECOVERY_MS, `${name} recovery ${recoveryMs}ms exceeds ${MAX_RECOVERY_MS}ms`);
  assert(!state.working && !state.stop_visible, `${name} left stale Working/Stop state`);
  results.push({ scenario: name, status: 'pass', recovery_ms: recoveryMs, max_recovery_ms: MAX_RECOVERY_MS, state });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-chaos-'));
  const dataDir = path.join(tempRoot, 'data');
  const stateFile = path.join(tempRoot, 'harness-state.json');
  const lockFile = path.join(tempRoot, 'proxy.lock');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const relayUrl = `ws://127.0.0.1:${port}/proxy-ws`;
  const scenarios = [];
  const authGates = [];
  let relay;
  let harness;
  let proxy;
  let browser;
  let desktopContext;
  let mobileContext;
  let generation = 1;

  try {
    relay = startRelay(port, dataDir);
    await waitHealth(origin, relay.child, relay.logs);
    authGates.push({ stage: 'initial_start', ...(await verifyAuthSurface(origin)) });
    if (options.authOnly) {
      await stopChild(relay.child, 'relay auth-only restart');
      relay = startRelay(port, dataDir);
      await waitHealth(origin, relay.child, relay.logs);
      authGates.push({ stage: 'relay_restart', ...(await verifyAuthSurface(origin)) });
      const result = {
        ok: authGates.length === 2,
        generated_at: new Date().toISOString(),
        isolated_fixture: true,
        auth_only: true,
        visible_windows_opened: 0,
        protected_user_apps_touched: 0,
        auth_gates: authGates,
      };
      if (options.output) {
        fs.mkdirSync(path.dirname(options.output), { recursive: true });
        fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    harness = startHarness(stateFile, generation);
    await harness.queue.wait('ready', 0, 3000);
    proxy = startProxy(relayUrl, stateFile, lockFile);
    await proxy.queue.wait('relay_connected', 0, 5000);

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: [
        '--disable-gpu', '--disable-background-networking', '--disable-component-update',
        '--disable-default-apps', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      ],
    });
    desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desktop = await desktopContext.newPage();
    await desktop.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitForFixtureCard(desktop, relay, proxy);
    await selectFixture(desktop);
    await waitForMarker(desktop, 'CHAOS_BASELINE_G1', 5000);

    // 1. Relay/container restart: preserve DB, reconnect both peers, and deliver
    // a marker generated while the relay is unavailable.
    await stopChild(relay.child, 'relay');
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_RELAY_RESTART' });
    relay = startRelay(port, dataDir);
    await waitHealth(origin, relay.child, relay.logs);
    authGates.push({ stage: 'relay_restart', ...(await verifyAuthSurface(origin)) });
    const relayReadyAt = Date.now();
    await settleScenario(scenarios, 'relay_container_restart', relayReadyAt, desktop, 'CHAOS_RELAY_RESTART', relay, proxy);

    // 2. Network flap on the proxy transport. State changes while disconnected
    // must land idle and never retain the pre-flap Working state.
    sendHarness(harness, { type: 'set_activity', kind: 'working', label: 'Working' });
    await waitWorking(desktop);
    const flapStarted = Date.now();
    proxy.child.send({ type: 'network_flap', duration_ms: 650 });
    await proxy.queue.wait('network_flap_started', flapStarted, 2000);
    sendHarness(harness, { type: 'set_activity', kind: 'idle', label: 'Ready' });
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_NETWORK_FLAP' });
    const proxyReconnected = await proxy.queue.wait('relay_connected', flapStarted, 3000);
    await settleScenario(scenarios, 'tunnel_network_flap', proxyReconnected.at_ms, desktop, 'CHAOS_NETWORK_FLAP', relay, proxy);

    // 3. Proxy kill/restart through the fixture mutex.
    sendHarness(harness, { type: 'set_activity', kind: 'working', label: 'Working' });
    await waitWorking(desktop);
    await stopChild(proxy.child, 'fixture proxy');
    sendHarness(harness, { type: 'set_activity', kind: 'idle', label: 'Ready' });
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_PROXY_RESTART' });
    proxy = startProxy(relayUrl, stateFile, lockFile);
    const proxyRestarted = await proxy.queue.wait('relay_connected', 0, 3000);
    assert.strictEqual(Number(fs.readFileSync(lockFile, 'utf8').trim()), proxy.child.pid, 'Fixture proxy mutex owner was not replaced');
    await settleScenario(scenarios, 'proxy_kill_mutex_restart', proxyRestarted.at_ms, desktop, 'CHAOS_PROXY_RESTART', relay, proxy);
    scenarios[scenarios.length - 1].recovered_stale_mutex = proxyRestarted.recovered_stale_lock;

    // 4. Owned fixture harness app kill/relaunch. Its session must disappear,
    // then return idle with the new-generation marker.
    sendHarness(harness, { type: 'set_activity', kind: 'working', label: 'Working' });
    await waitWorking(desktop);
    await stopChild(harness.child, 'fixture harness');
    const harnessStoppedAt = Date.now();
    await desktop.waitForFunction(
      () => {
        const body = document.body?.innerText || '';
        return !document.querySelector('.session-card')
          && !document.querySelector('.stop-btn')
          && !body.includes('Working')
          && !body.includes('Generating');
      },
      null,
      { timeout: MAX_RECOVERY_MS },
    );
    const offlineRecovery = Date.now() - harnessStoppedAt;
    assert(offlineRecovery <= MAX_RECOVERY_MS);
    generation += 1;
    harness = startHarness(stateFile, generation);
    const harnessReady = await harness.queue.wait('ready', 0, 3000);
    sendHarness(harness, { type: 'set_activity', kind: 'idle', label: 'Ready' });
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_HARNESS_RELAUNCH' });
    await settleScenario(scenarios, 'harness_app_kill_relaunch', harnessReady.at_ms, desktop, 'CHAOS_HARNESS_RELAUNCH', relay, proxy);
    scenarios[scenarios.length - 1].offline_recovery_ms = offlineRecovery;

    // 5. Desktop browser sleep/wake mid-stream.
    sendHarness(harness, { type: 'set_activity', kind: 'working', label: 'Working' });
    await waitWorking(desktop);
    await desktopContext.setOffline(true);
    await new Promise(resolve => setTimeout(resolve, 400));
    sendHarness(harness, { type: 'set_activity', kind: 'idle', label: 'Ready' });
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_BROWSER_WAKE' });
    await desktopContext.setOffline(false);
    await settleScenario(scenarios, 'browser_sleep_wake_mid_stream', Date.now(), desktop, 'CHAOS_BROWSER_WAKE', relay, proxy);

    // 6. Phone-sized client sleep/wake mid-stream against the same real WebUI.
    mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobile = await mobileContext.newPage();
    await mobile.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitForFixtureCard(mobile, relay, proxy);
    await mobile.locator('.hamburger').click();
    await selectFixture(mobile);
    await waitForMarker(mobile, 'CHAOS_BROWSER_WAKE', 5000);
    sendHarness(harness, { type: 'set_activity', kind: 'working', label: 'Working' });
    await waitWorking(mobile);
    await mobileContext.setOffline(true);
    await new Promise(resolve => setTimeout(resolve, 400));
    sendHarness(harness, { type: 'set_activity', kind: 'idle', label: 'Ready' });
    sendHarness(harness, { type: 'emit_marker', marker: 'CHAOS_PHONE_WAKE' });
    await mobileContext.setOffline(false);
    await settleScenario(scenarios, 'phone_sleep_wake_mid_stream', Date.now(), mobile, 'CHAOS_PHONE_WAKE', relay, proxy);

    const result = {
      ok: scenarios.length === 6 && scenarios.every(item => item.status === 'pass'),
      generated_at: new Date().toISOString(),
      isolated_fixture: true,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      actual_relay_server: true,
      actual_web_bundle: true,
      browser: browser.version(),
      recovery_target_ms: MAX_RECOVERY_MS,
      auth_gates: authGates,
      scenarios,
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return result;
  } finally {
    try { await mobileContext?.close(); } catch {}
    try { await desktopContext?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { await stopChild(proxy?.child, 'fixture proxy'); } catch {}
    try { await stopChild(harness?.child, 'fixture harness'); } catch {}
    try { await stopChild(relay?.child, 'relay'); } catch {}
    if (!options.keepArtifacts) {
      const safePrefix = path.join(os.tmpdir(), 'remote-agent-chaos-').toLowerCase();
      if (tempRoot.toLowerCase().startsWith(safePrefix)) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { MAX_RECOVERY_MS, main, parseArgs };
