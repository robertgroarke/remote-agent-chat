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
  if (!match) throw new Error('Headless Chrome not found');
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

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ status: response.statusCode, body: null }); }
      });
    });
    request.once('error', reject);
  });
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, '/healthz');
      if (response.status === 200 && response.body?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectProxy(port, secret, sends) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'broadcast-e2e', machine_label: 'broadcast-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
      if (message.type !== 'send') return;
      sends.push(message);
      if (message.session === 'broadcast-claude') {
        ws.send(JSON.stringify({
          type: 'proxy_send_result', session_id: message.session,
          client_message_id: message.client_message_id, result: 'delivered',
        }));
        setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({
          type: 'status', session: message.session, thinking: true,
          activity: { kind: 'running_command', label: 'Fixture started', started_at: new Date().toISOString() },
        })), 25);
      } else {
        ws.send(JSON.stringify({
          type: 'proxy_send_result', session_id: message.session,
          client_message_id: message.client_message_id, result: 'failed',
          reason: 'fixture native target unavailable',
        }));
      }
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-broadcast-send-'));
  const secret = 'broadcast-e2e-proxy-secret';
  const output = [];
  const sends = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'broadcast-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'broadcast-e2e-client-id', GOOGLE_CLIENT_SECRET: 'broadcast-e2e-client-secret',
      PROXY_SECRET: secret, RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true', ALLOW_LOOPBACK_BYPASS: 'true', FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  let proxy;
  let browser;
  try {
    await waitForHealth(port);
    proxy = await connectProxy(port, secret, sends);
    const sessions = [
      { session_id: 'broadcast-claude', agent_type: 'claude_cli', display_name: 'Claude throwaway', workspace_name: 'Broadcast Fixture' },
      { session_id: 'broadcast-codex', agent_type: 'codex_cli', display_name: 'Codex throwaway', workspace_name: 'Broadcast Fixture' },
      { session_id: 'broadcast-disabled', agent_type: 'cursor', display_name: 'Unsupported throwaway', workspace_name: 'Broadcast Fixture', capabilities: { send: false } },
    ];
    proxy.send(JSON.stringify({ type: 'session_list', proxy_id: 'broadcast-e2e', sessions }));
    proxy.send(JSON.stringify({
      type: 'agent_config', session_id: 'broadcast-disabled',
      capabilities: { send: false, send_message: false },
    }));
    for (const session of sessions) proxy.send(JSON.stringify({
      type: 'status', session: session.session_id, thinking: true,
      activity: { kind: 'working', label: 'Fixture active', started_at: new Date(Date.now() - 10_000).toISOString() },
    }));
    await new Promise(resolve => setTimeout(resolve, 350));

    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--disable-gpu', '--no-first-run'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Fleet view' }).click();
    await page.locator('[data-testid="broadcast-send"]').waitFor();

    const claudeSelect = page.getByRole('checkbox', { name: 'Select Claude throwaway for broadcast' });
    const codexSelect = page.getByRole('checkbox', { name: 'Select Codex throwaway for broadcast' });
    const disabledSelect = page.getByRole('checkbox', { name: 'Select Unsupported throwaway for broadcast' });
    assert.equal(await disabledSelect.isDisabled(), true, 'capability-gated session must remain unavailable');
    await claudeSelect.check();
    await codexSelect.check();
    const prompt = 'BROADCAST_E2E_REVIEW_THE_THROWAWAY_CHANGE';
    await page.getByRole('textbox', { name: 'Broadcast prompt' }).fill(prompt);
    const sendButton = page.getByRole('button', { name: 'Send to 2' });
    assert.equal(await sendButton.isDisabled(), true, 'send must require exact confirmation');
    await page.getByRole('textbox', { name: 'Broadcast confirmation' }).fill('SEND');
    assert.equal(await sendButton.isDisabled(), true, 'wrong confirmation must remain blocked');
    await page.getByRole('textbox', { name: 'Broadcast confirmation' }).fill('SEND TO 2 SESSIONS');
    assert.equal(await sendButton.isEnabled(), true);
    await sendButton.click();
    await page.waitForFunction(() => {
      const text = document.querySelector('.fleet-broadcast-receipts')?.textContent || '';
      return text.includes('agent started') && text.includes('failed');
    }, null, { timeout: 5_000 });
    assert.equal(sends.length, 2);
    assert.deepEqual(new Set(sends.map(message => message.session)), new Set(['broadcast-claude', 'broadcast-codex']));
    assert(sends.every(message => message.content === prompt && message.client_message_id));
    assert(!sends.some(message => message.session === 'broadcast-disabled'));

    const androidSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
    for (const marker of [
      'broadcastSelectedIds', 'SEND TO ${broadcastSelectedIds.length} SESSIONS',
      'normalizeBroadcastRequest', 'Broadcast delivery receipts', 'submitBroadcast',
    ]) assert(androidSource.includes(marker), `Android broadcast parity missing ${marker}`);

    console.log(JSON.stringify({
      status: 'PASS', actual_relay: true, actual_web_bundle: true,
      selected_sessions: 2, sends_received: sends.length,
      exact_confirmation_required: true, wrong_confirmation_rejected: true,
      capability_gated_sessions: 1, unsupported_sends: 0,
      receipts: { 'broadcast-claude': 'agent_started', 'broadcast-codex': 'failed' },
      identical_prompt_fanout: true, android_source_parity: true,
      visible_windows: 0, protected_user_apps_touched: 0,
    }, null, 2));
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(proxy);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve); child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-broadcast-send-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
