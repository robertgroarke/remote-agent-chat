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

async function waitFor(port, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`condition timed out on port ${port}`);
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'transcript-search-e2e', machine_label: 'transcript-search-e2e', secret,
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

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-transcript-search-'));
  const secret = 'transcript-search-e2e-proxy-secret';
  const relayOutput = [];
  const backfillToken = 'RAC_FTS_PREEXISTING_BACKFILL_22d4';
  const fixtureDb = new Database(path.join(tempRoot, 'messages.db'));
  fixtureDb.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()), client_msg_id TEXT,
      status TEXT NOT NULL DEFAULT 'delivered', sequence INTEGER NOT NULL DEFAULT 0,
      content_blocks TEXT
    );
    CREATE TABLE session_meta (
      session_id TEXT PRIMARY KEY, workspace_path TEXT, project_root TEXT,
      workspace_name TEXT, agent_type TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO session_meta (session_id, workspace_path, project_root, workspace_name, agent_type)
      VALUES ('search-preexisting', 'C:\\work\\archive', 'C:\\work\\archive', 'Archive Project', 'cursor_cli');
  `);
  const insertFixtureMessage = fixtureDb.prepare(
    'INSERT INTO messages (session, role, content, ts, sequence) VALUES (?, ?, ?, ?, ?)'
  );
  fixtureDb.transaction(() => {
    for (let index = 0; index < 2500; index++) {
      insertFixtureMessage.run(
        'search-preexisting', index % 2 ? 'assistant' : 'user',
        index === 173 ? `Pre-existing archive marker ${backfillToken}.` : `Archived row ${index}.`,
        1_751_370_000 + index, index + 1,
      );
    }
  })();
  fixtureDb.close();
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'transcript-search-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'transcript-search-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'transcript-search-e2e-client-secret',
      PROXY_SECRET: secret,
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => relayOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => relayOutput.push(chunk.toString()));

  let proxy;
  let browser;
  try {
    await waitFor(port, async () => (await requestJson(port, '/healthz')).status === 200);
    const backfillHealthLatencies = [];
    const backfilled = await waitFor(port, async () => {
      const healthStartedAt = Date.now();
      const health = await requestJson(port, '/healthz');
      backfillHealthLatencies.push(Date.now() - healthStartedAt);
      assert.equal(health.status, 200, 'health must remain responsive during FTS backfill');
      const response = await requestJson(port, `/api/search/messages?q=${encodeURIComponent(backfillToken)}&project=${encodeURIComponent('Archive Project')}&harness=cursor_cli`);
      return response.status === 200 && response.body?.index?.ready && response.body.results?.length === 1 ? response : null;
    }, 20_000);
    const backfillHealthMaxMs = Math.max(...backfillHealthLatencies);
    assert(backfillHealthMaxMs < 1000, `FTS backfill starved health for ${backfillHealthMaxMs} ms`);
    assert.equal(backfilled.body.results[0].session_id, 'search-preexisting', 'startup backfill must index pre-existing rows and metadata');
    proxy = await connectProxy(port, secret);
    const sessions = [
      { session_id: 'search-codex', agent_type: 'codex_cli', workspace_name: 'Remote Agent Chat', workspace_path: 'C:\\work\\remote-agent-chat', project_root: 'C:\\work\\remote-agent-chat' },
      { session_id: 'search-claude', agent_type: 'claude_cli', workspace_name: 'Other Project', workspace_path: 'C:\\work\\other', project_root: 'C:\\work\\other' },
    ];
    proxy.send(JSON.stringify({ type: 'session_list', proxy_id: 'transcript-search-e2e', sessions }));

    const startTs = Math.floor(Date.parse('2026-07-01T12:00:00Z') / 1000);
    const targetToken = 'RAC_FTS_DEEP_LINK_7f02c9';
    const codexMessages = Array.from({ length: 260 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: index === 20 ? `The durable search marker is ${targetToken}.` : `Codex transcript row ${index}.`,
      ts: startTs + index,
    }));
    proxy.send(JSON.stringify({ type: 'history_snapshot', session_id: 'search-codex', messages: codexMessages }));
    proxy.send(JSON.stringify({
      type: 'history_snapshot', session_id: 'search-claude', messages: [
        { role: 'user', content: `A filtered-out duplicate ${targetToken}.`, ts: startTs + 500 },
        { role: 'assistant', content: 'Other project response.', ts: startTs + 501 },
      ],
    }));

    const encodedToken = encodeURIComponent(targetToken);
    const allMatches = await waitFor(port, async () => {
      const response = await requestJson(port, `/api/search/messages?q=${encodedToken}`);
      return response.status === 200 && response.body?.results?.length === 2 ? response : null;
    });
    assert.equal(allMatches.body.index.ready, true, 'fresh relay FTS backfill should be complete');
    const filtered = await requestJson(port, `/api/search/messages?q=${encodedToken}&project=${encodeURIComponent('Remote Agent Chat')}&harness=codex_cli&date_from=2026-07-01&date_to=2026-07-01`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.results.length, 1, 'combined project, harness, and date filters must isolate one row');
    assert.equal(filtered.body.results[0].session_id, 'search-codex');
    assert.equal(filtered.body.results[0].role, 'user');
    const targetMessageId = filtered.body.results[0].message_id;
    assert(Number.isSafeInteger(targetMessageId) && targetMessageId > 0);
    const invalid = await requestJson(port, '/api/search/messages?q=x&date_from=not-a-date');
    assert.equal(invalid.status, 400, 'invalid bounded query/date input must fail closed');

    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.locator('.hamburger').click();
    await page.getByRole('button', { name: 'Search all transcripts' }).click();
    const searchView = page.getByTestId('transcript-search-view');
    await searchView.waitFor();
    await searchView.getByLabel('Search text').fill(targetToken);
    await searchView.getByLabel('Project').fill('Remote Agent Chat');
    await searchView.getByLabel('Harness').fill('codex_cli');
    await searchView.getByLabel('From').fill('2026-07-01');
    await searchView.getByLabel('To').fill('2026-07-01');
    await searchView.getByRole('button', { name: 'Search transcripts' }).click();
    await page.locator('.transcript-search-result').waitFor();
    assert.equal(await page.locator('.transcript-search-result').count(), 1);
    assert((await page.locator('.transcript-search-result').innerText()).includes(targetToken));
    await page.locator('.transcript-search-result').click();
    try {
      await page.locator(`.message.search-match[data-message-id="${targetMessageId}"]`).waitFor({ timeout: 10_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        messageIds: [...document.querySelectorAll('.message[data-message-id]')].map(row => row.getAttribute('data-message-id')),
        messageCount: document.querySelectorAll('.message').length,
        bodyTail: document.body.innerText.slice(-1000),
      }));
      throw new Error(`deep-link highlight missing: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
    await page.waitForFunction(({ messageId, token }) => {
      const list = document.querySelector('.messages');
      const row = document.querySelector(`.message[data-message-id="${messageId}"]`);
      if (!list || !row) return false;
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return rowRect.bottom > listRect.top
        && rowRect.top < listRect.bottom
        && row.innerText.includes(token);
    }, { messageId: targetMessageId, token: targetToken }, { polling: 'raf', timeout: 10_000 });
    const matchedText = await page.locator(`.message[data-message-id="${targetMessageId}"]`).innerText();
    assert(matchedText.includes(targetToken), 'deep link must hydrate and center the exact old matched message');
    assert.equal(await page.locator('[data-testid="transcript-search-view"]').count(), 0);

    const androidList = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
    const androidChat = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
    const androidRelay = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'lib', 'relay.js'), 'utf8');
    for (const marker of ['Transcript search', '/api/search/messages', 'transcriptSearchProject', 'transcriptSearchHarness', 'searchMessageId']) {
      assert(androidList.includes(marker), `Android search surface missing ${marker}`);
    }
    for (const marker of ["msg.mode === 'around'", 'searchMessageIdRef', 'scrollToIndex', 'highlightedSearchMessageId']) {
      assert(androidChat.includes(marker), `Android deep-link path missing ${marker}`);
    }
    assert(androidRelay.includes("mode === 'around'"));
    assert(androidRelay.includes('message.around_id'));

    const result = {
      status: 'PASS', actual_relay: true, actual_web_bundle: true, viewport: '390x844',
      fts5_results: 2, scoped_results: 1, preexisting_rows_backfilled: 2500, exact_message_id: targetMessageId,
      backfill_health_max_ms: backfillHealthMaxMs,
      old_message_index: 20, transcript_messages: 260, exact_deep_link: true,
      project_filter: true, harness_filter: true, date_filter: true,
      android_source_parity: true, visible_windows: 0, protected_user_apps_touched: 0,
    };
    const evidenceIndex = process.argv.indexOf('--evidence');
    if (evidenceIndex !== -1) {
      const evidencePath = path.resolve(process.argv[evidenceIndex + 1]);
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(evidencePath, `${JSON.stringify({ ...result, recorded_at: new Date().toISOString() }, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeSocket(proxy).catch(() => {});
    if (!child.killed) child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
