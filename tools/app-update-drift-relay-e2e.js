#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');

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

function requestJson(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* assertion owns invalid JSON */ }
        resolve({ status: response.statusCode, json, text });
      });
    });
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, 'GET', '/healthz');
      if (response.status === 200 && response.json?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/client-ws`, { origin: `http://127.0.0.1:${port}` });
    const messages = [];
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      if (message.type === 'connection_ack') resolve({ ws, messages, ack: message });
    });
    ws.once('error', reject);
  });
}

async function waitForMessage(messages, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for relay event; received: ${messages.map(item => item.type).join(', ')}`);
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

function validation(harness, status, previous, current, runId) {
  return {
    kind: 'app_update_validation', harness, status,
    previous_app_version: previous, app_version: current,
    validator: `tools/${harness}-validate-all.js`, run_id: runId,
    duration_ms: 17, exit_code: status === 'pass' ? 0 : 1,
    detail: status === 'pass' ? 'isolated pass' : 'isolated failure',
    completed_at: new Date().toISOString(), change_detected_at: new Date().toISOString(),
  };
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-app-update-relay-'));
  const output = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'app-update-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'app-update-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'app-update-e2e-client-secret',
      PROXY_SECRET: 'app-update-e2e-proxy-secret',
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  let firstClient;
  let restoredClient;
  let browser;
  try {
    await waitForHealth(port);
    firstClient = await connectClient(port);
    assert.equal(firstClient.ack.latest_app_update_validation, undefined);
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const passEntry = validation('cursor', 'pass', '3.5.32', '3.5.33', 'app-update-pass-e2e');
    const passResponse = await requestJson(port, 'PUT', '/api/maintenance/validation', { validation: passEntry });
    assert.equal(passResponse.status, 200, passResponse.text);
    assert.equal(passResponse.json.validation.kind, 'app_update_validation');
    assert.equal(passResponse.json.validation.previous_app_version, '3.5.32');
    const passEvent = await waitForMessage(firstClient.messages, item => (
      item.type === 'app_update_validation_status' && item.validation?.run_id === passEntry.run_id
    ));
    assert.equal(passEvent.validation.status, 'pass');
    await page.getByText('App update validated.', { exact: true }).waitFor();
    assert((await page.locator('.duplicate-proxy-banner.app-update-pass').count()) === 1);
    assert((await page.locator('body').innerText()).includes('cursor 3.5.32 -> 3.5.33'));

    const readback = await requestJson(port, 'GET', '/api/maintenance/validation');
    assert.equal(readback.status, 200);
    assert.equal(readback.json.latest_app_update_validation.run_id, passEntry.run_id);

    await closeSocket(firstClient.ws);
    firstClient = null;
    restoredClient = await connectClient(port);
    assert.equal(restoredClient.ack.latest_app_update_validation.run_id, passEntry.run_id);

    const failEntry = validation('codex', 'fail', '26.706.1', '26.707.1', 'app-update-fail-e2e');
    const failResponse = await requestJson(port, 'PUT', '/api/maintenance/validation', { validation: failEntry });
    assert.equal(failResponse.status, 200, failResponse.text);
    assert.equal(failResponse.json.validation.status, 'fail');
    await waitForMessage(restoredClient.messages, item => (
      item.type === 'app_update_validation_status' && item.validation?.run_id === failEntry.run_id
    ));
    const nightlyFailure = await waitForMessage(restoredClient.messages, item => (
      item.type === 'nightly_validation_status'
      && item.failures?.some(failure => failure.harness === 'codex')
    ));
    assert(nightlyFailure.failures.some(failure => failure.harness === 'codex'));
    await page.getByText('App update drift validation failed.', { exact: true }).waitFor();
    const mobileBody = await page.locator('body').innerText();
    assert(mobileBody.includes('codex 26.706.1 -> 26.707.1'));
    assert(!mobileBody.includes('Nightly validation failed.'), 'same-run generic warning must be suppressed');

    const genericCodex = { ...failEntry, kind: 'nightly_validation' };
    const genericRejected = await requestJson(port, 'PUT', '/api/maintenance/validation', { validation: genericCodex });
    assert.equal(genericRejected.status, 400, 'extra app surfaces must remain scoped to app-update validation');
    const unknownRejected = await requestJson(port, 'PUT', '/api/maintenance/validation', {
      validation: { ...passEntry, harness: 'unknown-harness', run_id: 'unknown' },
    });
    assert.equal(unknownRejected.status, 400);

    const relaySource = fs.readFileSync(path.join(__dirname, '..', 'relay-server', 'index.js'), 'utf8');
    const webSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.jsx'), 'utf8');
    const androidSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
    assert(relaySource.includes("app_update_pass:      { category: 'agent_ready'")
      && relaySource.includes("app_update_fail:      { category: 'agent_error'"));
    assert(webSource.includes('App update validated.') && webSource.includes('App update drift validation failed.'));
    assert(androidSource.includes('App update validated') && androidSource.includes('App update drift validation failed'));

    console.log(JSON.stringify({
      status: 'PASS',
      baseline_ack_empty: true,
      live_pass_banner_event: true,
      reconnect_restoration: true,
      live_failure_banner_event: true,
      nightly_failure_projection: true,
      push_routes: { pass: 'agent_ready', fail: 'agent_error' },
      generic_allowlist_isolated: true,
      web_android_banner_parity: true,
      actual_bundle_mobile_banner: true,
      duplicate_failure_banner_suppressed: true,
      visible_windows: 0,
    }, null, 2));
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await closeSocket(firstClient?.ws);
    await closeSocket(restoredClient?.ws);
    await browser?.close();
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-app-update-relay-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
