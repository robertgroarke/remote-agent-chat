#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');
const quotaCache = require('../agent-proxy/antigravity-quota-cache');
const { ProviderUsageRegistry } = require('../agent-proxy/provider-usage');

const root = path.resolve(__dirname, '..');

function runtimeFromSession(session) {
  return { evaluate: options => session.send('Runtime.evaluate', options) };
}

function quotaResponse() {
  return {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          description: 'Gemini fixture group',
          buckets: [
            { displayName: 'Weekly Limit', window: 'weekly', remainingFraction: 0.75, resetTime: '2026-07-26T08:00:00Z' },
            { displayName: 'Five Hour Limit', window: '5h', remainingFraction: 0.5, resetTime: '2026-07-19T13:00:00Z' },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          description: 'Claude fixture group',
          buckets: [
            { displayName: 'Weekly Limit', window: 'weekly', remainingFraction: 1, resetTime: '2026-07-26T08:00:00Z' },
          ],
        },
      ],
      description: 'Fixture quota response',
    },
  };
}

function userStatusResponse() {
  return {
    userStatus: {
      planStatus: { planInfo: { planName: 'Pro' } },
      userTier: {
        name: 'Google AI Pro',
        availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: 0, minimumCreditAmountForUsage: 50 }],
      },
    },
  };
}

async function browserContract() {
  const executablePath = process.env.RAC_CHROME_PATH
    || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
  assert(fs.existsSync(executablePath), 'installed headless Chrome executable is unavailable');
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext();
  const calls = [];
  try {
    const page = await context.newPage();
    await page.route('https://127.0.0.1:9443/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Antigravity</title><main>fixture</main><script>window.__APP_CONFIG__={productName:"antigravity",appVersion:"2.1.4",csrfToken:"fixture-only"}</script>',
        });
        return;
      }
      const method = url.pathname.split('/').at(-1);
      calls.push({
        method,
        csrfPresent: route.request().headers()['x-codeium-csrf-token'] === 'fixture-only',
        body: route.request().postDataJSON(),
      });
      const body = method === 'RetrieveUserQuotaSummary' ? quotaResponse()
        : method === 'GetUserStatus' ? userStatusResponse()
          : { response: {} };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('https://127.0.0.1:9443/');
    const session = await context.newCDPSession(page);
    await session.send('Runtime.enable');
    const snapshot = await selectors.readAntigravityInternalQuota(runtimeFromSession(session), true);
    assert.strictEqual(snapshot?.ok, true);
    assert.strictEqual(snapshot.source, 'in_app_api');
    assert.strictEqual(snapshot.app_version, '2.1.4');
    assert.strictEqual(snapshot.schema_variant, 'internal_quota_rpc_v2_1_4');
    assert.strictEqual(snapshot.models.length, 3);
    assert.strictEqual(snapshot.models[0].percent_used, 25);
    assert.strictEqual(snapshot.models[1].percent_used, 50);
    assert.strictEqual(snapshot.available_ai_credits, 0);
    assert.strictEqual(snapshot.plan, 'Pro');
    assert.strictEqual(snapshot.tier, 'Google AI Pro');
    assert.strictEqual(snapshot.source_receipt.page_state_unchanged, true);
    assert.strictEqual(snapshot.source_receipt.dom_mutation_records, 0);
    assert.deepStrictEqual(calls.map(call => call.method), [
      'GetLoadCodeAssist', 'RetrieveUserQuotaSummary', 'GetUserStatus',
    ]);
    assert(calls.every(call => call.csrfPresent), 'in-context CSRF was not attached to every RPC');
    assert.strictEqual(calls[0].body.forceRefresh, true);
    assert.strictEqual(calls[1].body.forceRefresh, true);

    const callCountBeforeDrift = calls.length;
    await page.evaluate(() => { window.__APP_CONFIG__.appVersion = '2.1.5'; });
    const drift = await selectors.readAntigravityInternalQuota(runtimeFromSession(session), true);
    assert.strictEqual(drift?.ok, false);
    assert.strictEqual(drift?.code, 'unsupported_app_contract');
    assert.strictEqual(calls.length, callCountBeforeDrift, 'schema drift issued an RPC instead of failing closed');
    return { calls: calls.length, models: snapshot.models.length, schema_drift_rpc_calls: 0 };
  } finally {
    await browser.close();
  }
}

function cacheContract() {
  let stored = null;
  const store = {
    replacePreference(key, value) { stored = { credential_canary: 'must-be-replaced', key, ...value }; delete stored.credential_canary; },
    updatePreference(key, value) { stored = { key, ...value }; },
    getPreference(key) { return stored?.key === key ? { ...stored } : null; },
  };
  const sourceHistory = [
    quotaCache.sourceAttempt('official_cli', 'unavailable', 'interactive_tui_only', '2026-07-19T08:00:00Z'),
    quotaCache.sourceAttempt('in_app_api', 'ok', null, '2026-07-19T08:00:01Z'),
  ];
  assert.strictEqual(quotaCache.normalizeSnapshot({
    fetched_at: '2026-07-19T08:00:01Z',
    models: [{ model: 'Missing quota fraction', percent_used: null, percent_remaining: null }],
  }), null, 'missing quota fractions must not coerce to authoritative zero');
  const unknownCreditSnapshot = quotaCache.normalizeSnapshot({
    fetched_at: '2026-07-19T08:00:01Z',
    available_ai_credits: '',
    models: [{ model: 'Known quota fraction', percent_used: 25, percent_remaining: 75 }],
  });
  assert.strictEqual(unknownCreditSnapshot.available_ai_credits, null,
    'missing credit amounts must remain unknown');
  const cache = quotaCache.createCache({
    ...quotaResponse().response,
    schema_variant: 'internal_quota_rpc_v2_1_4',
    percentage_semantics: 'remaining_fraction',
    app_version: '2.1.4',
    plan: 'Pro',
    tier: 'Google AI Pro',
    available_ai_credits: 0,
    models: [
      { model: 'Gemini Models · Weekly Limit', quota_group: 'Gemini Models', quota_window: 'Weekly Limit', window_kind: 'weekly', resets_at: '2026-07-26T08:00:00Z', percent_remaining: 75, percent_used: 25 },
    ],
    fetched_at: '2026-07-19T08:00:01Z',
  }, { source: 'in_app_api', sourceHistory });
  assert(cache, 'normalized cache was rejected');
  assert.strictEqual(quotaCache.persistCache(store, cache), true);
  const serialized = JSON.stringify(stored);
  assert(!/csrf|cookie|access[_-]?token|refresh[_-]?token|bearer|email|account[_-]?id/i.test(serialized),
    'credential/account-shaped field entered the persisted quota cache');
  const rehydrated = quotaCache.hydrateCache(store, Date.parse('2026-07-19T08:05:00Z'));
  assert(rehydrated);
  assert.strictEqual(rehydrated.source, 'cached');
  assert.strictEqual(rehydrated.data.fetched_at, '2026-07-19T08:00:01.000Z');
  assert.strictEqual(rehydrated.data.available_ai_credits, 0);
  assert(rehydrated.sourceHistory.some(attempt => attempt.source === 'cached' && attempt.status === 'rehydrated'));
  const boundedAfterRepeatedRefresh = quotaCache.boundedSourceHistory([
    ...rehydrated.sourceHistory,
    ...Array.from({ length: 20 }, (_, index) => quotaCache.sourceAttempt(
      index % 2 ? 'in_app_api' : 'official_cli', index % 2 ? 'ok' : 'unavailable',
      index % 2 ? null : 'interactive_tui_only', new Date(Date.parse('2026-07-19T08:06:00Z') + index * 1000).toISOString(),
    )),
  ]);
  assert.strictEqual(boundedAfterRepeatedRefresh.length, quotaCache.MAX_SOURCE_ATTEMPTS);
  assert(boundedAfterRepeatedRefresh.some(attempt => attempt.source === 'cached' && attempt.status === 'rehydrated'),
    'bounded refresh history must retain one durable restart-rehydration witness');
  const failed = quotaCache.cacheAfterFailure(rehydrated, 'quota_schema_mismatch', Date.parse('2026-07-19T08:06:00Z'));
  assert.strictEqual(failed.source, 'cached');
  assert.strictEqual(quotaCache.persistCache(store, failed), true);
  assert.strictEqual(stored.next_refresh_at, '2026-07-19T08:21:00.000Z');
  assert(failed.sourceHistory.some(attempt => attempt.source === 'hidden_surface_open'
    && attempt.status === 'disabled' && attempt.code === 'invisibility_unproven'));
  return { persisted_bytes: Buffer.byteLength(serialized), models: rehydrated.data.models.length };
}

async function forceContract() {
  let collectorContext = null;
  const registry = new ProviderUsageRegistry({
    getSessions: () => [{ agentType: 'antigravity-v2' }],
    collectors: {
      antigravity: async context => {
        collectorContext = context;
        return {
          account_fingerprint: 'acct_0123456789abcdef0123',
          account_label: 'Local Google AI account',
          plan: 'Pro',
          source: 'in_app_api',
          source_history: [],
          windows: [{ id: 'weekly', label: 'Weekly Limit', used_percent: 25, remaining_percent: 75 }],
          credits: { enabled: true, balance: 0, unit: 'AI credits' },
          next_refresh_at: '2026-07-19T08:15:00Z',
          stale_after_ms: quotaCache.STALE_AFTER_MS,
          captured_at: '2026-07-19T08:00:00Z',
        };
      },
    },
    collectAlwaysProviders: false,
    fingerprintKey: Buffer.alloc(32, 7),
    now: () => Date.parse('2026-07-19T08:00:00Z'),
    onSnapshot: () => {},
  });
  const snapshot = await registry.refresh({ force: true, reason: 'client' });
  assert.deepStrictEqual(collectorContext, { force: true, reason: 'client' });
  const antigravity = snapshot.snapshots.find(item => item.provider_id === 'google-antigravity');
  assert(antigravity, 'Antigravity provider snapshot missing');
  assert.strictEqual(antigravity.next_refresh_at, '2026-07-19T08:15:00.000Z');
  assert.strictEqual(antigravity.credits.balance, 0);
  return { force_propagated: true, next_refresh_at: antigravity.next_refresh_at };
}

async function main() {
  const browser = await browserContract();
  const cache = cacheContract();
  const force = await forceContract();
  const engineSource = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');
  const refreshStart = engineSource.indexOf('async _refreshAntigravityQuotaUsage(force = false)');
  const refreshEnd = engineSource.indexOf('\n  _claudeCliPendingTranscriptMessages', refreshStart);
  const refreshMethod = engineSource.slice(refreshStart, refreshEnd);
  const applyStart = engineSource.indexOf('_applyAntigravityQuotaSnapshot(snapshot)');
  const applyEnd = engineSource.indexOf('\n  async _refreshAntigravityQuotaUsage', applyStart);
  const applyMethod = engineSource.slice(applyStart, applyEnd);
  assert(refreshMethod.includes('readAntigravityInternalQuota'));
  assert(refreshMethod.includes('settings_surface'));
  assert(refreshMethod.includes('cacheAfterFailure'));
  assert(refreshMethod.includes('...priorSourceHistory'), 'restart hydration provenance is not retained after live refresh');
  assert(!refreshMethod.includes('Target.createTarget'), 'Tier C target creation shipped without invisibility proof');
  assert(applyMethod.includes("'antigravity-v2'"), 'Antigravity v2 session quota projection is missing');
  process.stdout.write(JSON.stringify({
    ok: true,
    primary_tier: 'in_app_api',
    official_cli: 'unavailable_interactive_tui_only',
    tier_c: 'disabled_invisibility_unproven',
    browser,
    cache,
    force,
    visible_windows_opened: 0,
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error('Antigravity quota autonomy smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
