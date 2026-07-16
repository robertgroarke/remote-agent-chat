#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function option(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const sessionId = option('--session-id');
const marker = option('--marker');
const expectedAsset = option('--expected-asset');
const sourceCommit = option('--source-commit');
const outputPath = path.resolve(option('--output'));
const screenshotPath = path.resolve(option('--screenshot'));
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

assert(sessionId, '--session-id is required');
assert(/^RAC_CLAUDE_PERMISSION_[a-f0-9]+$/i.test(marker), '--marker must be an owned Claude permission marker');
assert(/^build-[a-f0-9]{16}$/.test(expectedAsset), '--expected-asset must be an immutable build id');
assert(/^[a-f0-9]{40}$/.test(sourceCommit), '--source-commit must be a full Git commit id');
for (const [label, filePath, extension] of [
  ['output', outputPath, '.json'],
  ['screenshot', screenshotPath, '.png'],
]) {
  const relative = path.relative(path.join(ROOT, 'evidence'), filePath);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} must stay under the evidence tree`);
  assert.equal(path.extname(filePath).toLowerCase(), extension, `${label} must use ${extension}`);
}

function waitFor(predicate, timeoutMs, label, intervalMs = 50) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const value = predicate();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, intervalMs);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function relayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built');
  const configured = proxyEnv.RELAY_URL || relayEnv.PUBLIC_URL || 'http://127.0.0.1:3500';
  const base = configured
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/proxy-ws$/i, '/client-ws')
    .replace(/\/+$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

async function openRelay() {
  const messages = [];
  const ws = new WebSocket(relayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  ws.on('message', raw => {
    try { messages.push(JSON.parse(String(raw))); } catch {}
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay connection timed out')), 30_000);
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'claude-terminal-production-e2e',
      }));
    });
    ws.once('error', reject);
    const poll = setInterval(() => {
      if (!messages.some(message => message.type === 'connection_ack')) return;
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    }, 25);
  });
  return { ws, messages };
}

async function requestHistory(relay) {
  const requestId = `claude-terminal-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  relay.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session_id: sessionId,
    session: sessionId,
    request_id: requestId,
    mode: 'tail',
    source: 'relay_sqlite',
    limit: 500,
  }));
  return waitFor(
    () => relay.messages.find(message => message.type === 'history_chunk' && message.request_id === requestId),
    30_000,
    'request-correlated Claude relay history',
  );
}

function historyProof(messages) {
  const exactCommand = `powershell -NoProfile -Command "Write-Output ${marker}"`;
  let terminal = null;
  let terminalMessageIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const block = (message.content_blocks || []).find(candidate => (
      candidate.type === 'terminal'
      && candidate.command === exactCommand
      && String(candidate.stdout || '').trim() === marker
      && candidate.status === 'completed'
    ));
    if (!block) continue;
    terminal = block;
    terminalMessageIndex = index;
    break;
  }
  if (!terminal) return null;
  const finalTailIndex = messages.findIndex((message, index) => (
    index > terminalMessageIndex
    && message.role === 'assistant'
    && (message.content_blocks || []).some(block => block.type === 'markdown' && String(block.content || '').trim())
  ));
  if (finalTailIndex < 0) return null;
  const finalTail = messages[finalTailIndex];
  const finalMarkdown = finalTail.content_blocks.find(block => (
    block.type === 'markdown' && String(block.content || '').trim()
  ));
  return {
    message_count: messages.length,
    terminal_message_index: terminalMessageIndex,
    terminal: {
      type: terminal.type,
      title: terminal.title,
      status: terminal.status,
      command: terminal.command,
      stdout: terminal.stdout,
      stderr: terminal.stderr || '',
    },
    final_markdown_tail_index: finalTailIndex,
    final_markdown_tail: String(finalMarkdown.content || '').trim(),
  };
}

function ownedHistoryDiagnostics(messages) {
  return messages.map((message, index) => ({ message, index }))
    .filter(({ message }) => JSON.stringify(message).includes(marker))
    .slice(-10)
    .map(({ message, index }) => ({
      index,
      role: message.role,
      content: String(message.content || '').slice(0, 500),
      blocks: (message.content_blocks || []).map(block => ({
        type: block.type,
        title: block.title,
        status: block.status,
        command: block.command,
        stdout: block.stdout,
        stderr: block.stderr,
        content: String(block.content || '').slice(0, 500),
      })),
    }));
}

async function waitForHistoryProof(relay, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastMessages = [];
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    const history = await requestHistory(relay);
    lastMessages = history.messages || [];
    const proof = historyProof(lastMessages);
    if (proof) return { history, proof, attempts };
    await delay(500);
  }
  throw new Error('Timed out waiting for persisted completed Claude terminal plus final markdown tail: '
    + JSON.stringify({ attempts, message_count: lastMessages.length, owned: ownedHistoryDiagnostics(lastMessages) }));
}

function parseAssetVersion(url) {
  return String(url || '').match(/[?&]v=(build-[a-f0-9]+)/)?.[1] || '';
}

async function main() {
  let relay;
  let browser;
  let page;
  let original;
  let restored = false;
  let testSessionFilterToggled = false;
  let testSessionFilterToggleCount = 0;
  try {
    relay = await openRelay();
    const ack = relay.messages.find(message => message.type === 'connection_ack');
    assert(Array.isArray(ack.sessions), 'connection_ack did not include relay inventory');
    assert(ack.sessions.some(session => session.session_id === sessionId), 'Claude session is absent from production inventory');
    assert.equal((ack.duplicate_proxy_alarms || []).length, 0, 'production inventory has duplicate-proxy alarms');

    const persisted = await waitForHistoryProof(relay);

    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    [page] = pages;
    await page.waitForFunction(() => document.querySelectorAll('.session-card').length > 0,
      null, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const label = document.querySelector('.sidebar-footer-health > span')?.textContent || '';
      return label && !/connecting|disconnected/i.test(label);
    }, null, { timeout: 30_000 });
    original = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar-session-list') || document.querySelector('.sidebar');
      const messages = document.querySelector('.messages');
      return {
        selected_session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        sidebar_scroll_top: sidebar?.scrollTop || 0,
        transcript_scroll_top: messages?.scrollTop || 0,
        visibility: document.visibilityState,
        has_focus: document.hasFocus(),
        asset_url: [...document.scripts].map(script => script.src).find(src => src.includes('/dist/bundle.js')) || '',
        connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
        session_cards: document.querySelectorAll('.session-card').length,
        session_groups: document.querySelectorAll('.session-group').length,
        show_test_sessions: document.querySelector('.test-session-toggle')?.getAttribute('aria-pressed') === 'true',
        show_test_sessions_storage: localStorage.getItem('remote-agent-chat:show-test-sessions:v1'),
      };
    });
    assert(original.selected_session_id, 'persistent browser has no selected session to restore');
    assert.equal(parseAssetVersion(original.asset_url), expectedAsset, 'persistent browser is not serving the exact deployed build');

    let selected = await page.evaluate(id => {
      const card = document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`);
      if (!card) return false;
      card.click();
      return true;
    }, sessionId);
    if (!selected && !original.show_test_sessions) {
      const toggled = await page.evaluate(() => {
        const button = document.querySelector('.test-session-toggle[aria-pressed="false"]');
        if (!button) return false;
        button.click();
        return true;
      });
      assert(toggled, 'production sidebar could not temporarily reveal validator sessions');
      testSessionFilterToggled = true;
      testSessionFilterToggleCount += 1;
      await page.waitForFunction(id => (
        document.querySelector('.test-session-toggle')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`)
      ), sessionId, { timeout: 10_000 });
      selected = await page.evaluate(id => {
        const card = document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`);
        if (!card) return false;
        card.click();
        return true;
      }, sessionId);
    }
    assert(selected, 'production sidebar is missing the disposable Claude session card');
    await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
      sessionId, { timeout: 10_000 });
    await page.waitForFunction(value => (
      [...document.querySelectorAll('.content-block-terminal-claude')]
        .some(card => (card.textContent || '').includes(value))
    ), marker, { timeout: 30_000 });

    const matchingCards = page.locator('.content-block-terminal-claude').filter({ hasText: marker });
    assert.equal(await matchingCards.count(), 1, 'expected one native Claude terminal card for the owned marker');
    const terminalCard = matchingCards.first();
    const dom = await terminalCard.evaluate((card, value) => {
      const rows = [...card.querySelectorAll('.content-block-terminal-claude-row')].map(row => ({
        label: row.querySelector(':scope > span')?.textContent?.trim() || '',
        value: row.querySelector(':scope > pre')?.textContent || '',
        error: row.classList.contains('error'),
      }));
      const genericMatches = [...document.querySelectorAll('details.content-block-terminal')]
        .filter(node => (node.textContent || '').includes(value)).length;
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return {
        tool: card.querySelector('.content-block-terminal-claude-header strong')?.textContent?.trim() || '',
        description: card.querySelector('.content-block-terminal-claude-header > span:last-child:not(.content-block-terminal-claude-dot)')?.textContent?.trim() || '',
        status_classes: [...(card.querySelector('.content-block-terminal-claude-dot')?.classList || [])],
        rows,
        generic_disclosure_matches: genericMatches,
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        active_agent_type: document.querySelector('.messages')?.dataset.agentType || '',
        has_focus: document.hasFocus(),
      };
    }, marker);
    assert.equal(dom.tool, 'Bash', 'Claude terminal card is missing its native Bash heading');
    assert(dom.status_classes.includes('completed'), 'Claude terminal card is missing completed status');
    assert(dom.rows.some(row => row.label === 'IN' && row.value === persisted.proof.terminal.command),
      'Claude terminal card is missing the exact IN command');
    assert(dom.rows.some(row => row.label === 'OUT' && row.value.trim() === marker),
      'Claude terminal card is missing the exact OUT marker');
    assert(!dom.rows.some(row => row.label === 'ERR'), 'successful Claude terminal card rendered an ERR row');
    assert.equal(dom.generic_disclosure_matches, 0, 'owned Claude terminal leaked through the generic terminal disclosure');
    assert(dom.visible, 'owned Claude terminal card is not visible');
    assert.equal(dom.active_agent_type, 'claude', 'selected transcript is not the Claude harness');
    assert.equal(dom.has_focus, original.has_focus,
      'production browser document focus state changed during the read-only audit');

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await terminalCard.screenshot({ path: screenshotPath });
    const screenshot = fs.readFileSync(screenshotPath);

    if (original.selected_session_id !== sessionId) {
      await page.evaluate(id => {
        document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`)?.click();
      }, original.selected_session_id);
      await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
        original.selected_session_id, { timeout: 10_000 });
    }
    if (testSessionFilterToggled) {
      await page.evaluate(() => document.querySelector('.test-session-toggle[aria-pressed="true"]')?.click());
      await page.waitForFunction(() => (
        document.querySelector('.test-session-toggle')?.getAttribute('aria-pressed') === 'false'
      ), null, { timeout: 10_000 });
      testSessionFilterToggleCount += 1;
      await page.evaluate(value => {
        const key = 'remote-agent-chat:show-test-sessions:v1';
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }, original.show_test_sessions_storage);
      testSessionFilterToggled = false;
    }
    await page.evaluate(state => {
      const sidebar = document.querySelector('.sidebar-session-list') || document.querySelector('.sidebar');
      const messages = document.querySelector('.messages');
      if (sidebar) sidebar.scrollTop = state.sidebar_scroll_top;
      if (messages) messages.scrollTop = state.transcript_scroll_top;
    }, original);
    restored = true;

    const final = await page.evaluate(() => ({
      selected_session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      pages: 1,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
      show_test_sessions: document.querySelector('.test-session-toggle')?.getAttribute('aria-pressed') === 'true',
      show_test_sessions_storage: localStorage.getItem('remote-agent-chat:show-test-sessions:v1'),
    }));
    assert.equal(final.selected_session_id, original.selected_session_id, 'persistent browser selection was not restored');
    assert.equal(final.has_focus, original.has_focus, 'persistent browser document focus state changed');
    assert.equal(final.show_test_sessions, original.show_test_sessions, 'test-session visibility preference was not restored');
    assert.equal(final.show_test_sessions_storage, original.show_test_sessions_storage,
      'test-session localStorage preference was not restored');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      source_commit: sourceCommit,
      expected_asset: expectedAsset,
      session_id: sessionId,
      marker,
      relay: {
        first_message_type: ack.type,
        session_count: ack.sessions.length,
        duplicate_proxy_alarms: (ack.duplicate_proxy_alarms || []).length,
        history_chunk_request_id: persisted.history.request_id,
        history_request_attempts: persisted.attempts,
        persisted_history: persisted.proof,
      },
      browser: {
        cdp: cdpUrl,
        pages: pages.length,
        before: original,
        terminal_card: dom,
        screenshot: {
          path: path.relative(ROOT, screenshotPath),
          bytes: screenshot.length,
          sha256: crypto.createHash('sha256').update(screenshot).digest('hex'),
        },
        after: final,
        selection_and_scroll_restored: restored,
      },
      safety: {
        relay_requests: persisted.attempts,
        web_session_selections: original.selected_session_id === sessionId ? 0 : 2,
        web_test_session_visibility_toggles: testSessionFilterToggleCount,
        native_sends: 0,
        native_controls: 0,
        native_navigation_actions: 0,
        focus_actions: 0,
        visible_windows_opened: 0,
        protected_host_9223_untouched: true,
      },
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    if (page && original && !restored) {
      if (original.selected_session_id) {
        await page.evaluate(id => {
          document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`)?.click();
        }, original.selected_session_id).catch(() => {});
      }
      await page.evaluate(state => {
        const sidebar = document.querySelector('.sidebar-session-list') || document.querySelector('.sidebar');
        const messages = document.querySelector('.messages');
        if (sidebar) sidebar.scrollTop = state.sidebar_scroll_top;
        if (messages) messages.scrollTop = state.transcript_scroll_top;
      }, original).catch(() => {});
      if (testSessionFilterToggled) {
        await page.evaluate(() => document.querySelector('.test-session-toggle[aria-pressed="true"]')?.click()).catch(() => {});
        await page.evaluate(value => {
          const key = 'remote-agent-chat:show-test-sessions:v1';
          if (value == null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }, original.show_test_sessions_storage).catch(() => {});
      }
    }
    if (browser) await browser.close().catch(() => {});
    if (relay) relay.ws.close();
  }
}

main().catch(error => {
  const failure = {
    ok: false,
    generated_at: new Date().toISOString(),
    source_commit: sourceCommit,
    expected_asset: expectedAsset,
    session_id: sessionId,
    marker,
    error: error.stack || error.message || String(error),
    safety: {
      native_sends: 0,
      native_controls: 0,
      native_navigation_actions: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
      protected_host_9223_untouched: true,
    },
  };
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2) + '\n', 'utf8');
  } catch {}
  console.error(`Claude terminal production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
