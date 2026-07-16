#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const STORAGE_KEY = 'remote-agent-chat:show-test-sessions:v1';

function externalHeaders(publicUrl, token) {
  return {
    Host: new URL(publicUrl).host,
    'X-Forwarded-For': '203.0.113.10',
    'X-Forwarded-Proto': 'https',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `${url} failed: ${response.status} ${body.error || ''}`);
  return body;
}

function readInventory(origin, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/client-ws?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('production inventory WebSocket timed out'));
    }, 15_000);
    ws.once('error', reject);
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.type !== 'connection_ack' || !Array.isArray(message.sessions)) return;
      clearTimeout(timer);
      ws.close();
      resolve(message.sessions);
    });
  });
}

async function cardIds(page, selector) {
  return page.locator(selector).evaluateAll(nodes => (
    [...new Set(nodes.map(node => node.getAttribute('data-session-id')).filter(Boolean))]
  ));
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(publicUrl && deployEnv.RELAY_IP && token, 'production URL, relay IP, and bearer token are required');
  const headers = externalHeaders(publicUrl, token);

  const inventory = await readInventory(origin, token);
  const taggedTestSessions = inventory.filter(session => session.is_test_session === true || session.session_kind === 'validator');
  const taggedOperatorSessions = inventory.filter(session => !taggedTestSessions.includes(session));
  assert(taggedTestSessions.length > 0, 'production proxy inventory has no tagged validator sessions');
  assert(taggedOperatorSessions.length > 0, 'production proxy inventory has no operator sessions');

  const defaultHistory = await fetchJson(`${origin}/api/sessions/history?limit=200`, headers);
  const includedHistory = await fetchJson(`${origin}/api/sessions/history?limit=200&include_test=true`, headers);
  assert(defaultHistory.sessions.every(session => !session.is_test_session), 'default production history leaked a validator session');
  assert(includedHistory.sessions.some(session => session.is_test_session), 'production history opt-in returned no validator sessions');
  assert.equal(defaultHistory.include_test, false);
  assert.equal(includedHistory.include_test, true);

  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'session-noise-production-e2e',
      kind: 'production-browser-e2e',
    })}\n`,
  );
  const browser = await chromium.connectOverCDP(cdpUrl);
  let originalStorage = null;
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(await page.locator('#root').count(), 1, 'persistent browser is not authenticated');
    originalStorage = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
    await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length > 0, null, { timeout: 20_000 });

    const defaultIds = await cardIds(page, '.session-card[data-session-id]');
    let showTests = page.getByRole('button', { name: 'Show test sessions' });
    if (!await showTests.isVisible().catch(() => false)) {
      const hamburger = page.locator('.hamburger');
      if (await hamburger.isVisible().catch(() => false)) await hamburger.evaluate(button => button.click());
    }
    await showTests.waitFor({ state: 'attached', timeout: 5_000 });
    assert.equal(await showTests.getAttribute('aria-pressed'), 'false');
    await showTests.evaluate(button => button.click());
    await page.waitForFunction(before => (
      document.querySelectorAll('.session-card[data-session-id]').length > before
    ), defaultIds.length, { timeout: 10_000 });
    const revealedIds = await cardIds(page, '.session-card[data-session-id]');
    const defaultSet = new Set(defaultIds);
    const revealedTestIds = revealedIds.filter(id => !defaultSet.has(id));
    assert(revealedTestIds.length > 0, 'show-test toggle revealed no sessions');
    for (const id of revealedTestIds) {
      assert.equal(
        await page.locator(`.session-card[data-session-id="${id}"] .session-card-badge`).count(),
        0,
        'revealed validator session displayed unread noise',
      );
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(expected => (
      document.querySelectorAll('.session-card[data-session-id]').length >= expected
    ), revealedIds.length, { timeout: 20_000 });
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), '1');
    const fleetButton = page.getByRole('button', { name: 'Fleet view' });
    if (!await fleetButton.isVisible().catch(() => false)) {
      const hamburger = page.locator('.hamburger');
      if (await hamburger.isVisible().catch(() => false)) await hamburger.evaluate(button => button.click());
    }
    await fleetButton.evaluate(button => button.click());
    await page.getByTestId('fleet-view').waitFor({ state: 'visible', timeout: 10_000 });
    const fleetIds = new Set(await cardIds(page, '.fleet-card[data-session-id]'));
    assert(revealedTestIds.every(id => !fleetIds.has(id)), 'Fleet included a revealed validator session');

    const result = {
      ok: true,
      source_commit: 'b33e844b8180bfb325e1a3850c20883eaf1071e9',
      public_origin: new URL(publicUrl).origin,
      inventory_sessions: inventory.length,
      inventory_validator_sessions: taggedTestSessions.length,
      inventory_operator_sessions: taggedOperatorSessions.length,
      default_history_sessions: defaultHistory.sessions.length,
      opt_in_history_sessions: includedHistory.sessions.length,
      opt_in_history_validator_sessions: includedHistory.sessions.filter(session => session.is_test_session).length,
      default_visible_sessions: defaultIds.length,
      revealed_test_sessions: revealedTestIds.length,
      reveal_toggle_survived_reload: true,
      revealed_test_unread_badges: 0,
      fleet_validator_sessions: 0,
      authenticated_persistent_pages: pages.length,
      production_sends: 0,
      production_controls: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_user_apps_touched: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    try {
      const pages = browser.contexts().flatMap(context => context.pages());
      const page = pages[0];
      if (page) {
        await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.evaluate(({ key, value }) => {
          if (value == null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }, { key: STORAGE_KEY, value: originalStorage });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      }
    } catch {}
    await browser.close().catch(() => {});
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`session noise production e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
