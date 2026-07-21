#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');
const {
  createProductionLoopbackProxy,
  findChrome,
} = require('./mobile-cold-load-production-e2e');

const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'agent-proxy', 'session-store.json');

function parseArgs(argv) {
  const options = {
    readOnlyProduction: false,
    output: '',
    screenshot: '',
    minSessions: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else if (arg === '--screenshot') options.screenshot = path.resolve(argv[++index] || '');
    else if (arg === '--min-sessions') options.minSessions = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.output, '--output is required');
  assert(Number.isInteger(options.minSessions) && options.minSessions > 0,
    '--min-sessions must be a positive integer');
  for (const [label, filePath, extension] of [
    ['output', options.output, '.json'],
    ['screenshot', options.screenshot, '.png'],
  ]) {
    if (!filePath) continue;
    const relative = path.relative(path.join(ROOT, 'evidence'), filePath);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `--${label} must stay under the evidence tree`);
    assert.equal(path.extname(filePath).toLowerCase(), extension, `--${label} must use ${extension}`);
  }
  return options;
}

function healthyClaudeSessions() {
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  const sessions = new Map();
  for (const session of Object.values(store.sessions || {})) {
    if (!session || session.agent_type !== 'claude' || session.status !== 'healthy') continue;
    if (!session.session_id || sessions.has(session.session_id)) continue;
    const messages = Array.isArray(session.accumulated_messages) ? session.accumulated_messages : [];
    const transcriptMessages = messages.filter(message => ['user', 'assistant'].includes(message?.role));
    if (!transcriptMessages.length) continue;
    sessions.set(session.session_id, {
      session_id: session.session_id,
      store_transcript_rows: transcriptMessages.length,
      store_timestamped_rows: transcriptMessages.filter(message => (
        message.ts || message.timestamp || message.created_at || message.createdAt
      )).length,
    });
  }
  return [...sessions.values()].sort((left, right) => left.session_id.localeCompare(right.session_id));
}

async function waitForTranscriptInventory(page, minimumRows) {
  const deadline = Date.now() + 45_000;
  let lastTotal = -1;
  let stableSamples = 0;
  let olderLoads = 0;
  while (Date.now() < deadline) {
    const total = Number(await page.locator('.messages').getAttribute('data-total-message-count'));
    if (total < minimumRows) {
      const loadOlder = page.getByRole('button', { name: 'Load older messages' });
      if (await loadOlder.isVisible().catch(() => false) && await loadOlder.isEnabled().catch(() => false)) {
        await loadOlder.evaluate(button => button.click());
        olderLoads += 1;
        await page.waitForFunction(previous => {
          const list = document.querySelector('.messages');
          const current = Number(list?.dataset.totalMessageCount || 0);
          const button = [...document.querySelectorAll('.history-tail-banner button')]
            .find(node => node.textContent?.includes('Load older messages'));
          return current > previous || !button;
        }, total, { timeout: 15_000 });
        lastTotal = -1;
        stableSamples = 0;
        continue;
      }
    }
    if (total >= minimumRows && total === lastTotal) stableSamples += 1;
    else stableSamples = 0;
    if (stableSamples >= 3) return { total, olderLoads };
    lastTotal = total;
    await page.waitForTimeout(250);
  }
  throw new Error(`transcript inventory did not stabilize at ${minimumRows} rows (last=${lastTotal})`);
}

async function timestampRows(page, totalRows) {
  const rowsByIndex = new Map();
  const readMounted = () => page.evaluate(() => ([...document.querySelectorAll(
    '.messages .transcript-window-row[data-window-index], .messages > .message[data-message-role]',
  )].map((wrapper, fallbackIndex) => {
    const row = wrapper.matches('.message[data-message-role]')
      ? wrapper : wrapper.querySelector(':scope > .message[data-message-role]');
    if (!row) return null;
    const index = wrapper.matches('.transcript-window-row')
      ? Number(wrapper.getAttribute('data-window-index')) : fallbackIndex;
    const timestamps = [...row.querySelectorAll(
      ':scope > .user-content .message-timestamp, :scope > .assistant-content .message-timestamp',
    )];
    const timestamp = timestamps[0] || null;
    const rect = timestamp?.getBoundingClientRect();
    const text = timestamp?.textContent?.trim() || '';
    const dateTime = timestamp?.getAttribute('datetime') || '';
    return {
      index,
      key: row.getAttribute('data-message-key') || '',
      count: timestamps.length,
      semantic_time: timestamp?.tagName === 'TIME',
      text,
      date_time: dateTime,
      valid_instant: Number.isFinite(Date.parse(dateTime)),
      unknown: timestamp?.classList.contains('message-timestamp-unknown') || text === 'Time unknown',
      visible: Boolean(timestamp && rect && rect.width > 0 && rect.height > 0
        && getComputedStyle(timestamp).display !== 'none'
        && getComputedStyle(timestamp).visibility !== 'hidden'),
      data_instant: row.getAttribute('data-message-timestamp') || '',
      role: row.getAttribute('data-message-role') || '',
    };
  }).filter(Boolean)));

  const windowed = await page.locator('.messages').getAttribute('data-transcript-windowed') === 'true';
  if (!windowed) {
    for (const row of await readMounted()) rowsByIndex.set(row.index, row);
    return [...rowsByIndex.values()].sort((left, right) => left.index - right.index);
  }

  await page.waitForTimeout(1_700);
  await page.waitForFunction(() => {
    const list = document.querySelector('.messages');
    if (!list) return false;
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    return Number(list.dataset.windowStart) === 0;
  }, null, { timeout: 10_000, polling: 100 });
  let attempts = 0;
  let reachedBottom = false;
  while (attempts < Math.max(200, totalRows * 2)) {
    const mounted = await readMounted();
    for (const row of mounted) rowsByIndex.set(row.index, row);
    if (rowsByIndex.size === totalRows) break;
    const metrics = await page.locator('.messages').evaluate(list => ({
      scroll_top: list.scrollTop,
      max_scroll: Math.max(0, list.scrollHeight - list.clientHeight),
      client_height: list.clientHeight,
    }));
    reachedBottom = metrics.scroll_top >= metrics.max_scroll - 1;
    if (reachedBottom) break;
    const target = Math.min(metrics.max_scroll,
      metrics.scroll_top + Math.max(80, metrics.client_height * 0.4));
    await page.locator('.messages').evaluate((list, next) => {
      list.scrollTop = next;
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, target);
    await page.waitForTimeout(100);
    attempts += 1;
  }
  assert(reachedBottom || rowsByIndex.size === totalRows,
    `virtual transcript traversal did not reach its bottom after ${attempts} steps`);
  return [...rowsByIndex.values()].sort((left, right) => left.index - right.index);
}

async function captureTimestampCoverage(page, session) {
  const selector = `.session-card[data-session-id="${session.session_id}"]`;
  const card = page.locator(selector);
  await card.waitFor({ state: 'attached', timeout: 45_000 });
  await card.evaluate(element => element.click());
  await page.waitForFunction(sessionId => (
    document.querySelector('.session-card.active')?.dataset.sessionId === sessionId
      && document.querySelector('.messages')?.dataset.agentType === 'claude'
  ), session.session_id, { timeout: 15_000 });
  const inventory = await waitForTranscriptInventory(page, session.store_transcript_rows);
  const totalRows = inventory.total;
  const details = await timestampRows(page, totalRows);
  const coverage = {
      rendered_rows: details.length,
      transcript_total_rows: totalRows,
      older_history_loads: inventory.olderLoads,
      user_rows: details.filter(row => row.role === 'user').length,
      assistant_rows: details.filter(row => row.role === 'assistant').length,
      timestamp_nodes: details.reduce((sum, row) => sum + row.count, 0),
      rows_with_exactly_one_timestamp: details.filter(row => row.count === 1).length,
      semantic_time_rows: details.filter(row => row.semantic_time).length,
      valid_instant_rows: details.filter(row => row.valid_instant).length,
      visible_timestamp_rows: details.filter(row => row.visible).length,
      unknown_rows: details.filter(row => row.unknown).length,
      unknown_data_rows: details.filter(row => row.data_instant === 'unknown').length,
      empty_visible_time_rows: details.filter(row => !row.text).length,
      unique_message_keys: new Set(details.map(row => row.key)).size,
  };

  assert.equal(coverage.rendered_rows, totalRows,
    `${session.session_id} traversed ${coverage.rendered_rows}/${totalRows} transcript rows`);
  assert.equal(coverage.unique_message_keys, totalRows,
    `${session.session_id} repeated or omitted a stable message key`);
  assert.equal(coverage.timestamp_nodes, coverage.rendered_rows,
    `${session.session_id} did not render one timestamp per row`);
  assert.equal(coverage.rows_with_exactly_one_timestamp, coverage.rendered_rows,
    `${session.session_id} rendered duplicate or missing timestamp nodes`);
  assert.equal(coverage.semantic_time_rows, coverage.rendered_rows,
    `${session.session_id} rendered a non-semantic timestamp`);
  assert.equal(coverage.valid_instant_rows, coverage.rendered_rows,
    `${session.session_id} rendered an invalid timestamp instant`);
  assert.equal(coverage.visible_timestamp_rows, coverage.rendered_rows,
    `${session.session_id} hid a timestamp`);
  assert.equal(coverage.unknown_rows, 0, `${session.session_id} still renders Time unknown`);
  assert.equal(coverage.unknown_data_rows, 0, `${session.session_id} still carries unknown row metadata`);
  assert.equal(coverage.empty_visible_time_rows, 0, `${session.session_id} renders an empty time label`);
  return { ...session, ...coverage };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const upstreamUrl = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(upstreamUrl?.startsWith('http://'), 'configured production LAN relay URL is required');
  assert(token, 'JWT bearer token could not be built');

  const sessions = healthyClaudeSessions();
  assert(sessions.length >= options.minSessions,
    `expected at least ${options.minSessions} healthy Claude sessions, found ${sessions.length}`);
  assert(sessions.every(session => session.store_timestamped_rows === session.store_transcript_rows),
    'the live proxy store contains a healthy Claude transcript without complete timestamps');

  const loopback = await createProductionLoopbackProxy(upstreamUrl, publicOrigin, token);
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
  });
  const sentFrameTypes = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('websocket', socket => socket.on('framesent', frame => {
      try {
        const value = JSON.parse(String(frame.payload));
        if (value?.type) sentFrameTypes.push(String(value.type));
      } catch {}
    }));
    const response = await page.goto(loopback.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    assert.equal(response?.status(), 200, 'production app shell did not load');
    await page.waitForFunction(minimum => (
      document.querySelectorAll('.session-card[data-session-id]').length >= minimum
        && /Relay (?:healthy|connected)/.test(document.querySelector('.sidebar-footer')?.textContent || '')
    ), sessions.length, { timeout: 45_000 });
    const loadedAssetVersion = await page.evaluate(() => ([...document.scripts]
      .map(script => script.src).find(src => src.includes('/dist/bundle.js')) || '')
      .match(/v=(build-[0-9a-f]+)/)?.[1] || '');
    assert(/^build-[0-9a-f]{16}$/.test(loadedAssetVersion), 'served bundle has no immutable build id');

    const coverage = [];
    for (const session of sessions) coverage.push(await captureTimestampCoverage(page, session));
    if (options.screenshot) {
      fs.mkdirSync(path.dirname(options.screenshot), { recursive: true });
      await page.screenshot({ path: options.screenshot, fullPage: false });
    }

    const forbiddenFrameTypes = sentFrameTypes.filter(type => (
      /(?:send|interrupt|answer|question|approve|reject|archive|stop|resume|control|preference|pin|rename|schedule|delete|mark[_-]?read)/i.test(type)
    ));
    assert.deepStrictEqual(forbiddenFrameTypes, [],
      `read-only browser emitted forbidden WebSocket frames: ${forbiddenFrameTypes.join(', ')}`);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      public_origin: publicOrigin,
      loaded_asset_version: loadedAssetVersion,
      healthy_claude_sessions: coverage.length,
      total_store_transcript_rows: coverage.reduce((sum, item) => sum + item.store_transcript_rows, 0),
      total_rendered_rows: coverage.reduce((sum, item) => sum + item.rendered_rows, 0),
      total_unknown_rows: coverage.reduce((sum, item) => sum + item.unknown_rows, 0),
      sessions: coverage,
      websocket_sent_frame_types: [...new Set(sentFrameTypes)].sort(),
      forbidden_websocket_frames: forbiddenFrameTypes.length,
      safety: {
        production_sends: 0,
        production_controls: 0,
        persistent_browser_connections: 0,
        protected_session_mutations: 0,
        visible_windows_opened: 0,
        focus_actions: 0,
      },
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, serialized, 'utf8');
    process.stdout.write(serialized);
    return result;
  } finally {
    await browser.close();
    await loopback.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude extension timestamp production E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { captureTimestampCoverage, healthyClaudeSessions, main, parseArgs };
