#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

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
        body: Buffer.concat(chunks).toString('utf8'),
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

function connectSocket(port, pathname, hello = null) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`);
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${pathname} connection timed out`)), 10_000);
    ws.once('open', () => {
      if (hello) ws.send(JSON.stringify(hello));
    });
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === 'connection_ack') {
        clearTimeout(timer);
        resolve({ ws, messages });
      }
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
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

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-noise-'));
  const secret = 'session-noise-e2e-proxy-secret';
  const relayOutput = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'session-noise-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'session-noise-e2e-client-id', GOOGLE_CLIENT_SECRET: 'session-noise-e2e-client-secret',
      PROXY_SECRET: secret, RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true', ALLOW_LOOPBACK_BYPASS: 'true',
      NOTIFY_EVEN_IF_CONNECTED: 'true', FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', chunk => relayOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => relayOutput.push(chunk.toString()));

  const liveOperator = 'operator-live-session';
  const liveValidator = 'validator-live-session';
  const historyOperator = 'operator-history-session';
  const historyValidator = 'validator-history-session';
  let proxy;
  let client;
  let browser;
  try {
    await waitFor(async () => (await request(port, '/healthz')).status === 200);
    ({ ws: proxy } = await connectSocket(port, '/proxy-ws', {
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'session-noise-e2e', machine_label: 'session-noise-e2e', secret,
    }));
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    proxy.send(JSON.stringify({
      type: 'session_list',
      sessions: [
        {
          session_id: liveOperator, agent_type: 'codex_cli', workspace_name: 'Operator Project',
          workspace_path: 'C:\\work\\operator-project', status: 'healthy',
          activity: { kind: 'working', generating: true, started_at: startedAt },
        },
        {
          session_id: liveValidator, agent_type: 'codex_cli', workspace_name: 'Validator Fixture',
          workspace_path: 'C:\\temp\\remote-agent-vscode-test', status: 'healthy',
          activity: { kind: 'working', generating: true, started_at: startedAt },
        },
      ],
    }));
    proxy.send(JSON.stringify({
      type: 'session_meta_backfill',
      sessions: [
        {
          session_id: historyOperator, agent_type: 'claude_cli', workspace_name: 'Operator History',
          workspace_path: 'C:\\work\\operator-history', is_test_session: false,
        },
        {
          session_id: historyValidator, agent_type: 'claude_cli', workspace_name: 'Validator History',
          workspace_path: 'C:\\temp\\remote-agent-history-validator', is_test_session: true,
        },
      ],
    }));
    for (const [sessionId, label] of [[historyOperator, 'operator'], [historyValidator, 'validator']]) {
      proxy.send(JSON.stringify({
        type: 'history_snapshot', session_id: sessionId,
        messages: [
          { role: 'user', content: `${label} history prompt`, sequence: 1, ts: 1_783_900_000 },
          { role: 'assistant', content: `${label} history answer`, sequence: 2, ts: 1_783_900_010 },
        ],
      }));
    }

    const defaultHistory = await waitFor(async () => {
      const response = await request(port, '/api/sessions/history?limit=30');
      if (response.status !== 200) return null;
      const body = JSON.parse(response.body);
      return body.sessions?.some(session => session.session_id === historyOperator) ? body : null;
    });
    assert(defaultHistory.sessions.some(session => session.session_id === historyOperator));
    assert(!defaultHistory.sessions.some(session => session.session_id === historyValidator));
    const includedHistory = JSON.parse((await request(port, '/api/sessions/history?limit=30&include_test=true')).body);
    assert(includedHistory.sessions.some(session => session.session_id === historyOperator));
    assert(includedHistory.sessions.some(session => session.session_id === historyValidator));
    assert.equal(includedHistory.sessions.find(session => session.session_id === historyValidator).is_test_session, true);

    const clientConnection = await connectSocket(port, '/client-ws');
    client = clientConnection.ws;
    const clientMessages = clientConnection.messages;
    client.send(JSON.stringify({ type: 'subscribe', request_id: 'noise-subscribe', sessions: [] }));
    await waitFor(() => clientMessages.some(message => message.type === 'subscription_ack'));
    proxy.send(JSON.stringify({ type: 'message', session_id: liveOperator, role: 'assistant', content: 'operator unread message' }));
    proxy.send(JSON.stringify({ type: 'message', session_id: liveValidator, role: 'assistant', content: 'validator unread message' }));
    const summaries = await waitFor(() => {
      const rows = clientMessages.filter(message => message.type === 'session_summary');
      return rows.some(message => message.session_id === liveOperator)
        && rows.some(message => message.session_id === liveValidator) ? rows : null;
    });
    assert.equal(summaries.find(message => message.session_id === liveOperator).unread_delta, 1);
    assert.equal(summaries.find(message => message.session_id === liveValidator).unread_delta, 0);

    const fixtureDb = new Database(path.join(tempRoot, 'messages.db'));
    fixtureDb.prepare(`
      INSERT INTO web_push_subscriptions (email, endpoint, p256dh, auth, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run('noise@example.test', 'https://127.0.0.1:1/noise-e2e', 'fixture-key', 'fixture-auth');
    fixtureDb.close();

    proxy.send(JSON.stringify({
      type: 'permission_prompt', session_id: liveValidator, prompt_id: 'validator-permission',
      title: 'Validator permission', message: 'This must not notify.', timeout_ms: 30_000,
    }));
    await waitFor(() => relayOutput.join('').includes('Push skipped for validator session'));

    browser = await chromium.launch({
      executablePath: findChrome(), headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.locator(`[data-session-id="${liveOperator}"]`).waitFor({ timeout: 10_000 });
    assert.equal(await page.locator(`[data-session-id="${liveValidator}"]`).count(), 0, 'validator session must be hidden by default');
    await page.locator('.hamburger').click();
    const showTests = page.getByRole('button', { name: 'Show test sessions' });
    assert.equal(await showTests.getAttribute('aria-pressed'), 'false');
    await showTests.evaluate(button => button.click());
    await page.locator(`[data-session-id="${liveValidator}"]`).waitFor({ timeout: 5_000 });
    assert.equal(await page.getByRole('button', { name: 'Hide test sessions' }).getAttribute('aria-pressed'), 'true');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator(`[data-session-id="${liveValidator}"]`).waitFor({ timeout: 10_000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('remote-agent-chat:show-test-sessions:v1')), '1');
    await page.locator('.hamburger').click();
    await page.getByRole('button', { name: 'Fleet view' }).evaluate(button => button.click());
    await page.getByTestId('fleet-view').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator(`.fleet-card[data-session-id="${liveOperator}"]`).count(), 1);
    assert.equal(await page.locator(`.fleet-card[data-session-id="${liveValidator}"]`).count(), 0, 'validator session must stay out of Fleet when revealed');

    const result = {
      status: 'PASS', actual_relay: true, actual_web_bundle: true, viewport: '390x844',
      default_sidebar_operator_visible: true, default_sidebar_validator_hidden: true,
      reveal_toggle_persisted_contract: true, revealed_validator_visible: true,
      fleet_excludes_validator_when_revealed: true,
      history_default_excludes_validator: true, history_opt_in_includes_validator: true,
      operator_unread_delta: 1, validator_unread_delta: 0,
      validator_push_suppressed: true,
      visible_windows: 0, protected_user_apps_touched: 0,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${relayOutput.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(client);
    await closeSocket(proxy);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-session-noise-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(`session noise control e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
