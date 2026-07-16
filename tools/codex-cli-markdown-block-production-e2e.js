#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');
const codexCli = require('../agent-proxy/codex-cli');
const latency = require('./per-harness-browser-latency-e2e');
const soak = require('./production-harness-overnight-soak');
const { freshEvidencePath } = require('./evidence-path');

const root = path.resolve(__dirname, '..');
const outputArg = process.argv.indexOf('--output');
const outputPath = outputArg >= 0 && process.argv[outputArg + 1]
  ? path.resolve(process.argv[outputArg + 1])
  : freshEvidencePath(root, 'codex-cli-markdown-block-production-result.json');
const browserCdp = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function loadEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const value = predicate();
      if (value) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 25);
  });
}

async function openRelay() {
  const relayEnv = loadEnv(path.join(root, 'relay-server', '.env'));
  const proxyEnv = loadEnv(path.join(root, 'agent-proxy', '.env'));
  const configured = proxyEnv.RELAY_URL || relayEnv.PUBLIC_URL || 'http://127.0.0.1:3500';
  const base = configured
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/proxy-ws$/i, '/client-ws')
    .replace(/\/+$/, '');
  const token = latency.buildBearerToken(relayEnv);
  const ws = new WebSocket(`${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`, {
    headers: { Origin: 'http://127.0.0.1:3500' },
  });
  const messages = [];
  let sessions = [];
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    messages.push(message);
    if (Array.isArray(message.sessions)) sessions = message.sessions;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay connection timeout')), 30_000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'codex-cli-markdown-block-production-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  await waitFor(() => sessions.length > 0, 30_000, 'relay session inventory');
  return { ws, messages, sessions: () => sessions };
}

async function requestHistory(relay, sessionId) {
  const requestId = `codex-markdown-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  relay.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session_id: sessionId,
    session: sessionId,
    request_id: requestId,
    mode: 'tail',
    limit: 500,
  }));
  return waitFor(
    () => relay.messages.find(message => message.type === 'history_chunk' && message.request_id === requestId),
    30_000,
    'Codex CLI relay history',
  );
}

function choosePlainSnippet(content) {
  const text = String(content || '').replace(/[`*_#>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/[A-Za-z0-9][A-Za-z0-9 ,.:;/'"-]{23,120}/);
  return match ? match[0].trim().slice(0, 80) : text.slice(0, 60);
}

async function main() {
  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({ pid: process.pid, agent: 'codex-cli-markdown-block-production-e2e', kind: 'read-only-e2e' })}\n`,
  );
  let relay;
  let browser;
  try {
    relay = await openRelay();
    const sessionStoreRaw = JSON.parse(fs.readFileSync(path.join(root, 'agent-proxy', 'session-store.json'), 'utf8'));
    const storedSessions = Array.isArray(sessionStoreRaw)
      ? sessionStoreRaw
      : Object.values(sessionStoreRaw.sessions || sessionStoreRaw);
    const storedById = new Map(storedSessions.map(session => [session.session_id, session]));
    const candidates = relay.sessions().filter(session => (
      session.agent_type === 'codex_cli' && session.status === 'healthy'
    )).map(session => ({
      ...session,
      codex_cli_file_path: storedById.get(session.session_id)?.codex_cli_file_path || null,
    })).filter(session => session.codex_cli_file_path && fs.existsSync(session.codex_cli_file_path));
    assert(candidates.length > 0, 'no readable healthy Codex CLI session is available');
    candidates.sort((left, right) => {
      const leftPreferred = /remote agent chat/i.test(`${left.workspace_name || ''} ${left.workspace_path || ''}`) ? 1 : 0;
      const rightPreferred = /remote agent chat/i.test(`${right.workspace_name || ''} ${right.workspace_path || ''}`) ? 1 : 0;
      return rightPreferred - leftPreferred;
    });

    let selected = null;
    let nativeMessage = null;
    for (const candidate of candidates) {
      const summary = codexCli.readSessionSummary(candidate.codex_cli_file_path);
      const match = [...(summary?.messages || [])].reverse().find(message => (
        message.role === 'assistant'
        && message.content_blocks?.some(block => block.type === 'markdown' && block.content === message.content)
        && choosePlainSnippet(message.content).length >= 24
      ));
      if (match) {
        selected = candidate;
        nativeMessage = match;
        break;
      }
    }
    assert(selected && nativeMessage, 'no Codex CLI native assistant markdown block was found');

    const history = await requestHistory(relay, selected.session_id);
    const relayMessage = (history.messages || []).find(message => (
      message.role === 'assistant'
      && message.content === nativeMessage.content
      && message.content_blocks?.some(block => block.type === 'markdown' && block.content === nativeMessage.content)
    ));
    assert(relayMessage, 'relay history did not preserve the native Codex CLI markdown block');

    browser = await chromium.connectOverCDP(browserCdp);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent browser page, found ${pages.length}`);
    const [page] = pages;
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/?session=${encodeURIComponent(selected.session_id)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const snippet = choosePlainSnippet(nativeMessage.content);
    await page.waitForFunction(value => Array.from(document.querySelectorAll('.message.assistant'))
      .some(node => String(node.innerText || '').replace(/\s+/g, ' ').includes(value)), snippet, { timeout: 30_000 });

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: selected.session_id,
      native_file: selected.codex_cli_file_path,
      block_type: 'markdown',
      content_sha256: crypto.createHash('sha256').update(nativeMessage.content).digest('hex'),
      snippet,
      relay_history_total: history.total_messages ?? history.messages?.length ?? 0,
      browser_cdp: browserCdp,
      persistent_browser_pages: pages.length,
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_user_sessions_touched: 0,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { relay?.ws.close(); } catch {}
    if (browser) await browser.close().catch(() => {});
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`Codex CLI markdown block production E2E: FAIL (${error.stack || error.message})`);
  process.exitCode = 1;
});
