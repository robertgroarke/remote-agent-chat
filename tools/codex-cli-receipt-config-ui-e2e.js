#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const sessionId = 'codex-cli-ui-receipt-e2e';
const observedModel = 'gpt-5.5-codex-native-observation-with-a-long-provenance-safe-label';
const nextModel = 'Terra';
const observedEffort = 'xhigh';
const nextEffort = 'high';
const logs = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const chrome = candidates.find(candidate => fs.existsSync(candidate));
  if (!chrome) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return chrome;
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
    const value = await predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function health(port) {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/healthz`, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('error', () => resolve(false));
  });
}

function startRelay(port, dataDir, secret) {
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'codex-cli-ui-e2e-session-secret-0123456789',
      JWT_SECRET: 'codex-cli-ui-e2e-jwt-secret-0123456789',
      PROXY_SECRET: secret,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'codex-cli-ui-e2e-client',
      GOOGLE_CLIENT_SECRET: 'codex-cli-ui-e2e-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(port, route, peerRole, name, secret = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${peerRole} connection timed out`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: name, secret }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${peerRole} connection_ack`)
      .then(() => {
        clearTimeout(timer);
        resolve({ ws, messages });
      }, reject);
  });
}

async function closeSocket(socket) {
  const ws = socket?.ws || socket;
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function nativeReceipt(cid, content, offset) {
  return {
    session_id: 'native-codex-cli-ui-e2e',
    client_message_id: cid,
    content_sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    content_utf8_bytes: Buffer.byteLength(content, 'utf8'),
    content_characters: content.length,
    post_baseline_occurrence: 1,
    process_epoch: 'codex-cli-ui-e2e-process-epoch',
    source: 'response_item.message',
    native_event_at: new Date().toISOString(),
    observed_at: new Date().toISOString(),
    source_cursor: { start_offset: offset, end_offset: offset + 80, file_size: offset + 160, rotated: false },
  };
}

async function seedSend(browser, proxy, content, cid, lifecycle) {
  const proxyStart = proxy.messages.length;
  browser.ws.send(JSON.stringify({ type: 'send', session: sessionId, content, client_message_id: cid }));
  await waitFor(
    () => proxy.messages.slice(proxyStart).find(message => message.type === 'send' && message.client_message_id === cid),
    5000,
    `proxy dispatch ${cid}`,
  );
  await waitFor(
    () => browser.messages.find(message => message.type === 'message_accepted' && message.client_message_id === cid),
    5000,
    `relay acceptance ${cid}`,
  );
  if (lifecycle === 'accepted') return;
  proxy.ws.send(JSON.stringify({
    type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
    result: 'launch_accepted', lifecycle: 'proxy_launch_accepted',
    process_epoch: 'codex-cli-ui-e2e-process-epoch', accepted_at: new Date().toISOString(),
  }));
  if (lifecycle === 'launch_accepted') return;
  if (lifecycle === 'failed') {
    proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
      result: 'failed', lifecycle: 'terminal_failure',
      process_epoch: 'codex-cli-ui-e2e-process-epoch',
      error: { code: 'controlled_nonzero_exit', message: 'Controlled disposable failure' },
    }));
    return;
  }
  const receipt = nativeReceipt(cid, content, 1000 + Number(cid.slice(-1)) * 200);
  proxy.ws.send(JSON.stringify({
    type: 'proxy_send_result', session_id: sessionId, client_message_id: cid,
    result: 'delivered', lifecycle: 'native_user_turn_observed',
    process_epoch: receipt.process_epoch, native_receipt: receipt,
  }));
  if (lifecycle === 'agent_started') {
    proxy.ws.send(JSON.stringify({
      type: 'agent_started', protocol_version: 1, session_id: sessionId, client_message_id: cid,
      delivered_at: receipt.observed_at, started_at: new Date().toISOString(),
      native_receipt: receipt,
      native_start: { source: 'response_item.reasoning', source_cursor: { start_offset: receipt.source_cursor.end_offset + 1, end_offset: receipt.source_cursor.end_offset + 60 } },
    }));
  }
}

function fixtureHistoryMessages() {
  const base = Date.parse('2026-07-14T22:30:00.000Z') / 1000;
  const deliveredReceipt = nativeReceipt('ui-receipt-3', 'native user turn delivered fixture', 1600);
  const startedReceipt = nativeReceipt('ui-receipt-4', 'agent started fixture', 1800);
  return [
    { id: 1, sequence: 1, role: 'user', content: 'relay accepted fixture', client_message_id: 'ui-receipt-1', status: 'accepted', accepted_at: new Date(base * 1000).toISOString(), ts: base },
    { id: 2, sequence: 2, role: 'user', content: 'native launch accepted fixture', client_message_id: 'ui-receipt-2', status: 'accepted', accepted_at: new Date((base + 1) * 1000).toISOString(), launch_accepted_at: new Date((base + 1.1) * 1000).toISOString(), ts: base + 1 },
    { id: 3, sequence: 3, role: 'user', content: 'native user turn delivered fixture', client_message_id: 'ui-receipt-3', status: 'delivered', accepted_at: new Date((base + 2) * 1000).toISOString(), launch_accepted_at: new Date((base + 2.1) * 1000).toISOString(), delivered_at: deliveredReceipt.observed_at, native_receipt: deliveredReceipt, ts: base + 2 },
    { id: 4, sequence: 4, role: 'user', content: 'agent started fixture', client_message_id: 'ui-receipt-4', status: 'agent_started', accepted_at: new Date((base + 3) * 1000).toISOString(), launch_accepted_at: new Date((base + 3.1) * 1000).toISOString(), delivered_at: startedReceipt.observed_at, agent_started_at: new Date((base + 3.3) * 1000).toISOString(), native_receipt: startedReceipt, ts: base + 3 },
    { id: 5, sequence: 5, role: 'user', content: 'controlled failure fixture', client_message_id: 'ui-receipt-5', status: 'failed', accepted_at: new Date((base + 4) * 1000).toISOString(), launch_accepted_at: new Date((base + 4.1) * 1000).toISOString(), failure_code: 'controlled_nonzero_exit', ts: base + 4 },
    { id: 6, sequence: 6, role: 'user', content: 'legacy recorded fixture', status: 'recorded', ts: base + 5 },
  ];
}

function installHistoryResponder(proxy) {
  proxy.ws.on('message', data => {
    let request;
    try { request = JSON.parse(String(data)); } catch { return; }
    if (request.type !== 'history_chunk_request' || (request.session_id || request.session) !== sessionId) return;
    const messages = fixtureHistoryMessages();
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      protocol_version: 1,
      request_id: request.request_id,
      session_id: sessionId,
      session: sessionId,
      source: request.source || 'codex_cli_jsonl',
      mode: request.mode || 'tail',
      replace: request.mode !== 'older',
      partial: false,
      loaded_messages: messages.length,
      total_messages: messages.length,
      cursor: { start_offset: 0, end_offset: 2400, next_before_offset: null, total_bytes: 2400 },
      messages,
    }));
  });
}

async function captureSurface(page, viewport, theme) {
  await page.waitForSelector(`.session-card[data-session-id="${sessionId}"]`);
  if (viewport === 'mobile') {
    await page.locator('.hamburger').click();
    await page.waitForSelector('.sidebar.open');
  }
  await page.locator(`.session-card[data-session-id="${sessionId}"] .session-card-sub`).click();
  if (viewport === 'mobile') await page.waitForFunction(() => !document.querySelector('.overlay')?.classList.contains('open'));
  await page.waitForFunction(() => document.querySelectorAll('.message.user .delivery').length >= 6);

  const transcript = await page.evaluate(() => [...document.querySelectorAll('.message.user')].map(message => ({
    content: message.querySelector('.user-text')?.textContent?.trim() || '',
    status: message.querySelector('.delivery')?.textContent?.trim() || '',
    title: message.querySelector('.delivery')?.getAttribute('title') || '',
    aria: message.querySelector('.delivery')?.getAttribute('aria-label') || '',
  })));
  const statusSummary = Object.fromEntries(transcript.map(row => [row.content, row]));
  assert.match(statusSummary['relay accepted fixture']?.aria || '', /Relay accepted/i);
  assert.match(statusSummary['native launch accepted fixture']?.aria || '', /Native launch accepted.*receipt pending/i);
  assert.match(statusSummary['native user turn delivered fixture']?.aria || '', /Native user turn delivered/i);
  assert.match(statusSummary['agent started fixture']?.aria || '', /Agent started/i);
  assert.match(statusSummary['controlled failure fixture']?.aria || '', /Send failed/i);
  assert.match(statusSummary['legacy recorded fixture']?.aria || '', /Recorded.*receipt unknown/i);
  assert(!/✓/.test(statusSummary['native launch accepted fixture']?.status || ''), 'launch acceptance must not render a success checkmark');

  await page.locator('button[title="Toggle settings"]').click();
  await page.waitForSelector('.composer-settings.is-open');
  const composer = await page.evaluate(({ observedModelValue, nextModelValue }) => {
    const rootNode = document.querySelector('.composer-settings.is-open');
    const text = rootNode?.innerText || '';
    const normalizedText = text.toLowerCase();
    const rootRect = rootNode?.getBoundingClientRect();
    const overflowing = [...(rootNode?.querySelectorAll('.composer-setting-label, .composer-hint') || [])]
      .filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
      }).map(node => node.textContent?.trim() || node.tagName);
    return {
      text,
      hasObserved: normalizedText.includes('observed model') && text.includes(observedModelValue) && normalizedText.includes('observed effort') && normalizedText.includes('xhigh'),
      hasNext: normalizedText.includes('next model') && text.includes(nextModelValue) && normalizedText.includes('next effort') && normalizedText.includes('high'),
      overflowing,
    };
  }, { observedModelValue: observedModel, nextModelValue: nextModel });
  assert(composer.hasObserved, `${viewport}/${theme} composer lost observed model/effort truth: ${JSON.stringify(composer)}`);
  assert(composer.hasNext, `${viewport}/${theme} composer lost next-send model/effort truth: ${JSON.stringify(composer)}`);
  assert.deepStrictEqual(composer.overflowing, [], `${viewport}/${theme} composer values clipped`);

  await page.getByRole('button', { name: /Session details/i }).click();
  await page.waitForSelector('.settings-panel');
  const details = await page.evaluate(({ observedModelValue, nextModelValue }) => {
    const panel = document.querySelector('.settings-panel');
    const text = panel?.innerText || '';
    const normalizedText = text.toLowerCase();
    const panelRect = panel?.getBoundingClientRect();
    const overflowing = [...(panel?.querySelectorAll('.settings-row, .settings-value') || [])]
      .filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1 || node.scrollWidth > node.clientWidth + 1;
      }).map(node => node.textContent?.trim() || node.tagName);
    return {
      text,
      hasObserved: normalizedText.includes('observed model') && text.includes(observedModelValue) && normalizedText.includes('observed effort') && normalizedText.includes('xhigh'),
      hasNext: normalizedText.includes('next send model') && text.includes(nextModelValue) && normalizedText.includes('next send effort') && normalizedText.includes('high'),
      overflowing,
      panelWithinViewport: panelRect.left >= 0 && panelRect.right <= innerWidth && panelRect.top >= 0 && panelRect.bottom <= innerHeight,
    };
  }, { observedModelValue: observedModel, nextModelValue: nextModel });
  assert(details.hasObserved, `${viewport}/${theme} session details lost observed truth: ${JSON.stringify(details)}`);
  assert(details.hasNext, `${viewport}/${theme} session details lost next-send truth: ${JSON.stringify(details)}`);
  assert(details.panelWithinViewport, `${viewport}/${theme} session details escaped viewport`);
  assert.deepStrictEqual(details.overflowing, [], `${viewport}/${theme} session detail values clipped`);

  await page.locator('.settings-panel-close').click();
  if (viewport === 'desktop') {
    await page.locator('button[aria-label="Fleet view"]').click();
    await page.waitForSelector('.fleet-view');
    await page.getByRole('button', { name: /^Show \d+ idle session/i }).click().catch(() => {});
    const fleetText = await page.locator(`.fleet-card[data-session-id="${sessionId}"]`).innerText();
    assert(fleetText.includes(`Observed ${observedModel} / ${observedEffort}`));
    assert(fleetText.includes(`Next ${nextModel} / ${nextEffort}`));
    await page.locator('.automations-back').click();
  }

  // Stay outside the relay's deliberate 1.5 s native-tail request throttle so
  // this refresh exercises persisted lifecycle replay instead of a rejected
  // duplicate history request.
  await page.waitForTimeout(1_600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(`.session-card[data-session-id="${sessionId}"]`);
  if (viewport === 'mobile') {
    await page.locator('.hamburger').click();
    await page.waitForSelector('.sidebar.open');
  }
  await page.locator(`.session-card[data-session-id="${sessionId}"] .session-card-sub`).click();
  if (viewport === 'mobile') await page.waitForFunction(() => !document.querySelector('.overlay')?.classList.contains('open'));
  await page.waitForFunction(() => document.querySelectorAll('.message.user .delivery').length >= 6);
  const replayed = await page.evaluate(() => [...document.querySelectorAll('.message.user .delivery')].map(node => ({
    title: node.getAttribute('title') || '',
    aria: node.getAttribute('aria-label') || '',
  })));
  assert(replayed.some(row => /Native launch accepted/.test(row.aria)));
  assert(replayed.some(row => /Native user turn delivered/.test(row.aria)));
  assert(replayed.some(row => /Agent started/.test(row.aria)));
  assert(replayed.some(row => /Recorded.*receipt unknown/i.test(row.aria)));

  return {
    viewport,
    theme,
    lifecycle_rows: transcript.length,
    composer_observed_next_unambiguous: true,
    session_details_observed_next_unambiguous: true,
    fleet_observed_next_unambiguous: viewport === 'desktop',
    overflow_count: 0,
    accessible_statuses: 6,
    refresh_stable: true,
  };
}

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-cli-ui-e2e-'));
  const secret = 'codex-cli-ui-e2e-proxy-secret';
  const relay = startRelay(port, dataDir, secret);
  let proxy;
  let seedBrowser;
  let browser;
  try {
    await waitFor(() => health(port), 10_000, 'isolated relay health');
    proxy = await openSocket(port, '/proxy-ws', 'proxy', 'codex-cli-ui-e2e-proxy', secret);
    installHistoryResponder(proxy);
    seedBrowser = await openSocket(port, '/client-ws', 'browser', 'codex-cli-ui-e2e-seeder');
    proxy.ws.send(JSON.stringify({
      type: 'session_list', protocol_version: 1, proxy_id: 'codex-cli-ui-e2e-proxy',
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex_cli',
        display_name: 'Codex CLI receipt/config UI E2E',
        chat_title: 'Codex CLI receipt and config truth',
        workspace_name: 'Remote Agent Chat',
        workspace_path: root,
        status: 'healthy',
        capabilities: { send_message: true },
      }],
    }));
    await waitFor(() => seedBrowser.messages.some(message => message.type === 'session_list'), 5000, 'session inventory');
    seedBrowser.ws.send(JSON.stringify({ type: 'subscribe', sessions: [sessionId], request_id: 'ui-e2e-subscribe' }));
    await waitFor(() => seedBrowser.messages.some(message => message.type === 'subscription_ack'), 5000, 'seeder subscription');
    proxy.ws.send(JSON.stringify({
      type: 'agent_config', protocol_version: 1, session_id: sessionId,
      config_semantics: 'observed_and_next_send',
      model_id: observedModel,
      observed_model_id: observedModel,
      observed_model_raw: observedModel,
      observed_effort: observedEffort,
      observed_effort_raw: observedEffort,
      effort: observedEffort,
      model_provenance: { source: 'turn_context', observed_at: new Date().toISOString() },
      effort_provenance: { source: 'turn_context', observed_at: new Date().toISOString() },
      next_send_model_id: nextModel,
      next_send_model_status: 'pending',
      next_send_effort: nextEffort,
      next_send_effort_status: 'pending',
      available_models: [
        { id: nextModel, label: `${nextModel} · currently advertised alias` },
        { id: 'Sol', label: 'Sol' },
        { id: 'Luna', label: 'Luna' },
      ],
      available_efforts: ['low', 'medium', 'high', 'xhigh'].map(value => ({ id: value, label: value })),
      capabilities: { set_model: true, set_effort: true, send_message: true },
      read_at: new Date().toISOString(),
    }));
    await sleep(100);

    await seedSend(seedBrowser, proxy, 'relay accepted fixture', 'ui-receipt-1', 'accepted');
    await seedSend(seedBrowser, proxy, 'native launch accepted fixture', 'ui-receipt-2', 'launch_accepted');
    await seedSend(seedBrowser, proxy, 'native user turn delivered fixture', 'ui-receipt-3', 'delivered');
    await seedSend(seedBrowser, proxy, 'agent started fixture', 'ui-receipt-4', 'agent_started');
    await seedSend(seedBrowser, proxy, 'controlled failure fixture', 'ui-receipt-5', 'failed');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_message', session_id: sessionId, role: 'user', content: 'legacy recorded fixture',
      created_at: new Date().toISOString(),
    }));
    await sleep(200);
    await closeSocket(seedBrowser);
    seedBrowser = null;

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check'],
    });
    const cases = [];
    for (const [viewport, size] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
      for (const theme of ['dark', 'light']) {
        const context = await browser.newContext({ viewport: size, colorScheme: theme });
        await context.addInitScript(value => localStorage.setItem('remote-agent-chat-theme', value), theme);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
        cases.push(await captureSurface(page, viewport, theme));
        await context.close();
        // Each case owns a fresh browser context. Keep its first native-tail
        // request outside the relay's per-session 1.5 s anti-churn window.
        await sleep(1_600);
      }
    }

    const publicBundle = fs.readFileSync(path.join(root, 'relay-server', 'public', 'dist', 'bundle.js'), 'utf8');
    assert(publicBundle.includes('Native launch accepted; user-turn receipt pending'));
    assert(publicBundle.includes('Observed model'));
    assert(publicBundle.includes('Next send effort'));

    process.stdout.write(`${JSON.stringify({
      status: 'PASS',
      build_asset: fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8').match(/bundle\.js\?v=([^"']+)/)?.[1] || null,
      cases,
      lifecycle_states: ['accepted', 'launch_accepted', 'delivered', 'agent_started', 'failed', 'recorded'],
      observed_model: observedModel,
      observed_effort: observedEffort,
      next_send_model: nextModel,
      next_send_effort: nextEffort,
      visible_windows: 0,
      focus_actions: 0,
      production_mutations: 0,
      protected_sessions_touched: 0,
    })}\n`);
  } catch (error) {
    throw new Error(`${error.stack || error.message}\n${logs.join('')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeSocket(seedBrowser).catch(() => {});
    await closeSocket(proxy).catch(() => {});
    await stopChild(relay).catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
