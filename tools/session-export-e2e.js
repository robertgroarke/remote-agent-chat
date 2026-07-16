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

const CANONICAL_TYPES = [
  'markdown', 'thinking', 'tool_call', 'tool_result', 'terminal', 'file_changes',
  'artifact', 'prompt', 'plan', 'queued_message', 'notice', 'error', 'status',
];

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
        headers: response.headers,
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
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('condition timed out');
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'session-export-e2e', machine_label: 'session-export-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
    });
    ws.once('error', reject);
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

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

async function downloadText(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: label }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { filename: download.suggestedFilename(), body: Buffer.concat(chunks).toString('utf8') };
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-export-'));
  const secret = 'session-export-e2e-proxy-secret';
  const output = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'session-export-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'session-export-e2e-client-id', GOOGLE_CLIENT_SECRET: 'session-export-e2e-client-secret',
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
    await waitFor(async () => (await request(port, '/healthz')).status === 200);
    proxy = await connectProxy(port, secret);
    const sessionId = 'session-export-fixture';
    proxy.send(JSON.stringify({
      type: 'session_list', proxy_id: 'session-export-e2e', sessions: [{
        session_id: sessionId, agent_type: 'codex_cli', workspace_name: 'Export Fixture',
        workspace_path: 'C:\\work\\export-fixture', project_root: 'C:\\work\\export-fixture',
      }],
    }));
    const blocks = CANONICAL_TYPES.map((type, index) => ({
      type, content: `${type} complete body ${index}`, metadata: { index, expanded: true },
    }));
    proxy.send(JSON.stringify({
      type: 'history_snapshot', session_id: sessionId, messages: [
        { role: 'user', content: 'Export every persisted message.', ts: 1_783_900_000, sequence: 1, client_message_id: 'export-user-1' },
        { role: 'assistant', content: '', content_blocks: blocks, ts: 1_783_900_010, sequence: 2 },
      ],
    }));

    const markdown = await waitFor(async () => {
      const response = await request(port, `/api/sessions/${sessionId}/export?format=markdown`);
      return response.status === 200 && response.body.includes('Messages: 2') ? response : null;
    });
    assert.match(markdown.headers['content-type'], /^text\/markdown/);
    assert(markdown.headers['content-disposition'].includes("filename*=UTF-8''Export%20Fixture.md"));
    assert(markdown.body.includes('Export every persisted message.'));
    for (const type of CANONICAL_TYPES) {
      assert(markdown.body.includes(`${type} complete body`), `Markdown export omitted ${type}`);
    }

    const jsonResponse = await request(port, `/api/sessions/${sessionId}/export?format=json`);
    assert.equal(jsonResponse.status, 200);
    assert.match(jsonResponse.headers['content-type'], /^application\/json/);
    const json = JSON.parse(jsonResponse.body);
    assert.equal(json.schema_version, 1);
    assert.equal(json.session.session_id, sessionId);
    assert.equal(json.session.agent_type, 'codex_cli');
    assert.equal(json.messages.length, 2);
    assert.deepEqual(json.messages[1].content_blocks.map(block => block.type), CANONICAL_TYPES);
    assert.equal(json.messages[0].client_message_id, null, 'history snapshots do not invent an unstored client id');
    const invalid = await request(port, `/api/sessions/${sessionId}/export?format=xml`);
    assert.equal(invalid.status, 400);

    browser = await chromium.launch({
      executablePath: findChrome(), headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.locator('.hamburger').click();
    await page.getByRole('button', { name: 'Manage sessions' }).click();
    await page.getByText('Manage sessions', { exact: true }).waitFor();
    const markdownDownload = await downloadText(page, 'Download Markdown');
    assert.equal(markdownDownload.filename, 'Export Fixture.md');
    assert(markdownDownload.body.includes('Messages: 2'));
    assert(markdownDownload.body.includes('Export every persisted message.'));
    for (const type of CANONICAL_TYPES) assert(markdownDownload.body.includes(`${type} complete body`));
    const jsonDownload = await downloadText(page, 'Download JSON');
    assert.equal(jsonDownload.filename, 'Export Fixture.json');
    const downloadedJson = JSON.parse(jsonDownload.body);
    assert.deepEqual(downloadedJson.session, json.session);
    assert.deepEqual(downloadedJson.messages, json.messages);
    assert.match(downloadedJson.exported_at, /^\d{4}-\d{2}-\d{2}T/);

    const androidChat = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
    const androidSettings = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'AgentSettingsSheet.jsx'), 'utf8');
    for (const marker of ['Share.share', '/api/sessions/${encodeURIComponent(sessionId)}/export', 'onExport={shareSessionExport}']) {
      assert(androidChat.includes(marker), `Android export path missing ${marker}`);
    }
    for (const marker of ['Export session', 'Share Markdown', 'Share JSON']) {
      assert(androidSettings.includes(marker), `Android export menu missing ${marker}`);
    }

    console.log(JSON.stringify({
      status: 'PASS', actual_relay: true, actual_web_bundle: true, viewport: '390x844',
      formats: ['markdown', 'json'], messages: 2, canonical_blocks_expanded: CANONICAL_TYPES.length,
      web_downloads: 2, android_share_sheet_source: true, invalid_format_rejected: true,
      visible_windows: 0, protected_user_apps_touched: 0,
    }, null, 2));
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(proxy);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-session-export-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
