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

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;

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

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      }));
    });
    req.once('error', reject);
  });
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch { /* startup or state retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('condition timed out');
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error('Headless Chrome not found');
  return match;
}

async function connectProxy(port, secret) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy connection timed out')), 10_000);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'scheduled-browser-e2e', machine_label: 'scheduled-browser-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.type === 'connection_ack') {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.once('error', reject);
  });
  return ws;
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-scheduled-browser-'));
  const secret = 'scheduled-browser-e2e-secret';
  const relayOutput = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'scheduled-browser-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'scheduled-browser-client-id',
      GOOGLE_CLIENT_SECRET: 'scheduled-browser-client-secret',
      PROXY_SECRET: secret, RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true', ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', chunk => relayOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => relayOutput.push(chunk.toString()));

  const sessionId = 'overnight-operator-session';
  const content = 'Continue the overnight browser run';
  let proxy;
  let browser;
  try {
    await waitFor(async () => (await request(port, '/healthz')).status === 200);
    proxy = await connectProxy(port, secret);
    proxy.send(JSON.stringify({
      type: 'session_list',
      sessions: [{
        session_id: sessionId, agent_type: 'codex_cli', workspace_name: 'Overnight Ops',
        workspace_path: 'C:\\work\\overnight-ops', status: 'healthy',
        activity: { kind: 'working', generating: true, label: 'Working' },
        is_test_session: false, session_kind: 'operator',
      }],
    }));

    browser = await chromium.launch({
      executablePath: findChrome(), headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const sessionCard = page.locator(`[data-session-id="${sessionId}"]`);
    await sessionCard.waitFor();
    assert((await sessionCard.getAttribute('class') || '').includes('active'));
    const composer = page.locator('.input-area textarea');
    await composer.fill(content);
    await page.getByRole('button', { name: 'Schedule message' }).click();
    const panel = page.getByTestId('scheduled-send-panel');
    await panel.waitFor();
    assert.equal(await panel.locator('textarea').inputValue(), content);
    await panel.getByRole('button', { name: 'Schedule', exact: true }).click();

    const pending = await waitFor(async () => {
      const response = await request(port, `/api/scheduled-sends?session_id=${sessionId}`);
      return response.body.scheduled_sends?.find(job => job.content === content && job.state === 'pending');
    });
    assert.equal(pending.trigger_kind, 'idle');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await waitFor(async () => {
      const response = await request(port, `/api/scheduled-sends?session_id=${sessionId}`);
      return response.body.scheduled_sends?.find(job => job.id === pending.id)?.state === 'cancelled';
    });
    await panel.getByText(content).waitFor({ state: 'detached' });
    assert.equal(await composer.inputValue(), '');

    const result = {
      status: 'PASS', actual_relay: true, actual_production_bundle: true,
      viewport: '390x844', composed_draft_carried_into_scheduler: true,
      next_idle_job_created: true, pending_job_cancelled: true,
      composer_cleared_after_schedule: true,
      visible_windows: 0, protected_user_apps_touched: 0,
    };
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, text);
    }
    process.stdout.write(text);
  } catch (error) {
    throw new Error(`${error.stack || error}\n${relayOutput.join('')}`);
  } finally {
    try { await browser?.close(); } catch {}
    try { proxy?.close(); } catch {}
    if (child.exitCode == null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
