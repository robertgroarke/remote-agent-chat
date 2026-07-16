#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const TARGET_INTERACTIVE_MS = 3000;
const CPU_THROTTLE_RATE = 4;
const WARM_TRIALS = 3;
const pageDiagnostics = new WeakMap();

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
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

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

function attachDiagnostics(page) {
  const messages = [];
  pageDiagnostics.set(page, messages);
  page.on('console', message => messages.push(`console:${message.type()}:${message.text()}`));
  page.on('pageerror', error => messages.push(`pageerror:${error.message}`));
  page.on('websocket', socket => {
    messages.push(`websocket:${new URL(socket.url()).pathname}`);
    socket.on('socketerror', error => messages.push(`websocket-error:${error}`));
    socket.on('close', () => messages.push('websocket-close'));
  });
}

async function installColdLoadInstrumentation(context) {
  await context.addInitScript(() => {
    window.__racColdLoad = { init_ms: performance.now() };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function InstrumentedWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      window.__racColdLoad.websocket_created_ms ??= performance.now();
      socket.addEventListener('open', () => {
        window.__racColdLoad.websocket_open_ms ??= performance.now();
      });
      socket.addEventListener('message', event => {
        window.__racColdLoad.websocket_first_message_ms ??= performance.now();
        if (
          typeof event.data === 'string'
          && event.data.includes('"type":"connection_ack"')
        ) {
          window.__racColdLoad.connection_ack_ms ??= performance.now();
          window.__racColdLoad.connection_ack_bytes = event.data.length;
        }
      });
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      window.WebSocket[key] = NativeWebSocket[key];
    }
    document.addEventListener('DOMContentLoaded', () => {
      window.__racColdLoad.dom_content_loaded_observed_ms = performance.now();
      let scheduled = false;
      const inspect = () => {
        scheduled = false;
        const cards = document.querySelectorAll('.session-card').length;
        if (document.querySelector('.session-group-header')) window.__racColdLoad.first_group_ms ??= performance.now();
        if (cards >= 50) window.__racColdLoad.fifty_cards_ms ??= performance.now();
        if (document.querySelector('.sidebar-footer')?.textContent?.includes('Relay connected')) {
          window.__racColdLoad.relay_connected_dom_ms ??= performance.now();
        }
      };
      const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(inspect);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      inspect();
    }, { once: true });
  });
}

async function createProductionLoopbackProxy(upstreamUrl, publicOrigin, token) {
  const upstream = new URL(upstreamUrl);
  assert.equal(upstream.protocol, 'http:', 'loopback benchmark upstream must be the production LAN HTTP origin');
  const server = http.createServer((request, response) => {
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
      response.end(`production loopback proxy failed: ${error.message}`);
    });
    request.pipe(forwarded);
  });
  const localSockets = new WebSocket.Server({ server });
  localSockets.on('connection', (client, request) => {
    const incoming = new URL(request.url, 'http://localhost');
    if (incoming.pathname !== '/client-ws') return client.close(1008, 'unsupported path');
    incoming.searchParams.set('token', token);
    const upstreamSocket = new WebSocket(`ws://${upstream.host}${incoming.pathname}${incoming.search}`, {
      headers: { Origin: publicOrigin },
    });
    const pending = [];
    client.on('message', (data, isBinary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary: isBinary });
      else pending.push({ data, isBinary });
    });
    upstreamSocket.on('open', () => {
      for (const item of pending.splice(0)) upstreamSocket.send(item.data, { binary: item.isBinary });
    });
    upstreamSocket.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstreamSocket.on('close', () => {
      if (client.readyState === WebSocket.OPEN) client.close();
    });
    upstreamSocket.on('error', () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream websocket failed');
    });
    client.on('close', () => {
      if (upstreamSocket.readyState === WebSocket.CONNECTING || upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.close();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of localSockets.clients) client.terminate();
      localSockets.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function waitForInteractive(page) {
  try {
    await page.waitForFunction(() => {
      const group = document.querySelector('.session-group-header');
      const footer = document.querySelector('.sidebar-footer');
      const cards = document.querySelectorAll('.session-card').length;
      return !!document.getElementById('root')
        && !!group
        && cards >= 50
        && footer?.textContent?.includes('Relay connected');
    }, null, { timeout: 45000, polling: 25 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      body_text: document.body?.innerText?.slice(0, 2000) || '',
      root_html: document.getElementById('root')?.innerHTML?.slice(0, 2000) || '',
      group_count: document.querySelectorAll('.session-group-header').length,
      footer_text: document.querySelector('.sidebar-footer')?.textContent?.trim() || '',
      service_worker_controlled: !!navigator.serviceWorker?.controller,
    }));
    diagnostic.diagnostics = pageDiagnostics.get(page) || [];
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map(entry => [entry.name, entry.startTime]));
    const resources = performance.getEntriesByType('resource').map(entry => ({
      name: new URL(entry.name).pathname + new URL(entry.name).search,
      duration_ms: Number(entry.duration.toFixed(2)),
      transfer_bytes: entry.transferSize,
      decoded_bytes: entry.decodedBodySize,
      initiator: entry.initiatorType,
    }));
    return {
      interactive_ms: Number(performance.now().toFixed(2)),
      dom_content_loaded_ms: Number((navigation?.domContentLoadedEventEnd || 0).toFixed(2)),
      load_ms: Number((navigation?.loadEventEnd || 0).toFixed(2)),
      first_contentful_paint_ms: Number((paints['first-contentful-paint'] || 0).toFixed(2)),
      service_worker_controlled: !!navigator.serviceWorker?.controller,
      groups: document.querySelectorAll('.session-group-header').length,
      sessions: document.querySelectorAll('.session-card').length,
      resources,
      phases: window.__racColdLoad || {},
    };
  });
}

async function seedWarmCache(page, publicUrl) {
  const response = await page.goto(`${publicUrl}/?mobile_cold_seed=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  assert(response && response.status() === 200, `cache seed returned HTTP ${response?.status()}`);
  await waitForInteractive(page);
  const ready = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, controlled: false };
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 10000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    return { supported: true, controlled: !!navigator.serviceWorker.controller };
  });
  assert(ready.supported, 'Chrome did not expose service worker support');
  assert(ready.controlled, 'service worker did not control the seeded PWA page');
  return ready;
}

async function measureTrial(context, publicUrl, trial) {
  const page = await context.newPage();
  attachDiagnostics(page);
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
  try {
    const response = await page.goto(`${publicUrl}/?mobile_cold_trial=${trial}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    assert(response && response.status() === 200, `warm trial ${trial} returned HTTP ${response?.status()}`);
    const measured = await waitForInteractive(page);
    assert(measured.service_worker_controlled, `warm trial ${trial} was not service-worker controlled`);
    return { trial, ...measured };
  } finally {
    await client.detach().catch(() => {});
    await page.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const configuredRelayUrl = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const productionLanUrl = configuredRelayUrl?.startsWith('http://')
    ? configuredRelayUrl
    : `http://${deployEnv.DEPLOY_HOST || 'tower'}:3500`;
  const upstreamUrl = (valueAfter(argv, '--url') || productionLanUrl).replace(/\/+$/, '');
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const token = fidelity.buildBearerToken(relayEnv);
  const outputValue = valueAfter(argv, '--output');
  const outputPath = outputValue ? path.resolve(outputValue) : '';
  assert(upstreamUrl, 'production LAN URL or --url is required');
  assert(token, 'JWT bearer token could not be built');
  const loopback = await createProductionLoopbackProxy(upstreamUrl, publicOrigin, token);
  const publicUrl = loopback.url;

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  });
  await installColdLoadInstrumentation(context);
  try {
    const seedPage = await context.newPage();
    attachDiagnostics(seedPage);
    const seed = await seedWarmCache(seedPage, publicUrl);
    await seedPage.close();
    const trials = [];
    for (let trial = 1; trial <= WARM_TRIALS; trial++) {
      trials.push(await measureTrial(context, publicUrl, trial));
    }
    const interactive = trials.map(trial => trial.interactive_ms);
    const result = {
      ok: trials.every(trial => (
        trial.interactive_ms <= TARGET_INTERACTIVE_MS
        && trial.sessions >= 50
        && Number.isFinite(trial.phases?.fifty_cards_ms)
      )),
      generated_at: new Date().toISOString(),
      public_origin: publicOrigin,
      production_lan_origin: new URL(upstreamUrl).origin,
      benchmark_transport: 'loopback auth/origin proxy to deployed production assets',
      profile: {
        viewport: { width: 390, height: 844 },
        device_scale_factor: 2.75,
        touch: true,
        cpu_throttle_rate: CPU_THROTTLE_RATE,
        warm_pwa_cache: true,
      },
      target_interactive_ms: TARGET_INTERACTIVE_MS,
      seed,
      summary: {
        min_ms: Number(Math.min(...interactive).toFixed(2)),
        p50_ms: Number(percentile(interactive, 0.5).toFixed(2)),
        p95_ms: Number(percentile(interactive, 0.95).toFixed(2)),
        max_ms: Number(Math.max(...interactive).toFixed(2)),
      },
      trials,
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    assert(result.ok, `mobile warm-cache interactive target missed: ${JSON.stringify(result.summary)}`);
    return result;
  } finally {
    await context.close();
    await browser.close();
    await loopback.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Mobile cold-load production E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = {
  TARGET_INTERACTIVE_MS,
  createProductionLoopbackProxy,
  findChrome,
  main,
  waitForInteractive,
};
