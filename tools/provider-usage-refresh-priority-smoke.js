#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  ProviderUsageRegistry,
  accountFingerprint,
  normalizedWindow,
} = require('../agent-proxy/provider-usage');

const KEY = 'provider-usage-refresh-priority-fixture';
const now = Date.parse('2026-07-17T09:40:00.000Z');
const account = (provider, source) => ({
  account_fingerprint: accountFingerprint(`${provider}-fixture`, KEY),
  account_label: `${provider} fixture`,
  plan: 'Fixture plan',
  source,
  source_history: [{ source, status: 'ok', captured_at: new Date(now).toISOString() }],
  captured_at: new Date(now).toISOString(),
  windows: [normalizedWindow({
    id: 'weekly', label: 'Weekly', usedPercent: 10, durationMinutes: 10080,
    resetsAt: now + 24 * 60 * 60 * 1000,
  })],
  credits: null,
  reset_credits: null,
  request_count: 1,
});

async function main() {
  const order = [];
  let releaseProvider;
  let releaseCost;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const costGate = new Promise(resolve => { releaseCost = resolve; });
  const registry = new ProviderUsageRegistry({
    getSessions: () => [{ sessionId: 'codex-fixture', agentType: 'codex_cli' }],
    collectors: {
      codex: async () => {
        order.push('provider_start');
        await providerGate;
        order.push('provider_complete');
        return account('codex', 'fixture');
      },
    },
    costScanner: {
      snapshot: () => ({ status: order.includes('cost_complete') ? 'ready' : 'scanning' }),
      refresh: async () => {
        order.push('cost_start');
        await costGate;
        order.push('cost_complete');
      },
    },
    fingerprintKey: KEY,
    now: () => now,
  });

  let clientSettled = false;
  const clientRefresh = registry.refresh({ force: true, reason: 'client', waitForCost: false })
    .then(snapshot => { clientSettled = true; return snapshot; });
  await Promise.resolve();
  assert.deepStrictEqual(order, ['provider_start']);
  assert.strictEqual(clientSettled, false);
  releaseProvider();
  const clientSnapshot = await clientRefresh;
  assert.strictEqual(clientSnapshot.generation, 1);
  assert.strictEqual(clientSnapshot.snapshots[0].status, 'fresh');
  assert.deepStrictEqual(order, ['provider_start', 'provider_complete', 'cost_start']);
  assert(registry.costInFlight, 'cost scan did not continue independently after the provider receipt');
  releaseCost();
  await registry.costInFlight;
  assert.deepStrictEqual(order, ['provider_start', 'provider_complete', 'cost_start', 'cost_complete']);

  let quotaReads = 0;
  const antigravityRegistry = new ProviderUsageRegistry({
    getSessions: () => [{ sessionId: 'antigravity-fixture', agentType: 'antigravity_panel' }],
    getAntigravityQuota: async () => {
      quotaReads += 1;
      await Promise.resolve();
      return {
        fetchedAt: now,
        data: {
          fetched_at: new Date(now).toISOString(),
          available_ai_credits: 0,
          models: [{ model: 'Gemini Models · Weekly Limit', percent_used: 10, refreshes_in: '1 day' }],
        },
      };
    },
    // Supplying only Codex keeps other always-collect providers inactive;
    // the mapped Antigravity session still exercises the default collector.
    collectors: { codex: async () => account('codex', 'fixture') },
    fingerprintKey: KEY,
    now: () => now,
  });
  await antigravityRegistry.refresh({ force: true });
  const antigravity = antigravityRegistry.snapshot().snapshots
    .find(item => item.provider_id === 'google-antigravity');
  assert.strictEqual(quotaReads, 1, 'Antigravity collector did not await the live quota-cache refresh');
  assert.strictEqual(antigravity.status, 'fresh');
  assert.strictEqual(antigravity.credits.balance, 0);
  assert.strictEqual(antigravity.windows[0].used_percent, 10);

  let existingCostAborted = false;
  let priorityProviderCalls = 0;
  const priorityRegistry = new ProviderUsageRegistry({
    getSessions: () => [{ sessionId: 'codex-force-fixture', agentType: 'codex_cli' }],
    collectors: {
      codex: async () => {
        priorityProviderCalls += 1;
        return account('codex-force', 'fixture');
      },
    },
    costScanner: {
      snapshot: () => ({ status: 'scanning' }),
      refresh: ({ signal }) => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          existingCostAborted = true;
          resolve();
        }, { once: true });
      }),
    },
    fingerprintKey: KEY,
    now: () => now,
  });
  const existingCostRun = priorityRegistry._startCostRefresh();
  const prioritySnapshot = await priorityRegistry.refresh({ force: true, reason: 'client', waitForCost: false });
  await existingCostRun;
  assert.strictEqual(existingCostAborted, true,
    'client provider refresh did not stop the older incremental cost scan');
  assert.strictEqual(priorityProviderCalls, 1, 'provider collection did not run after cost cancellation');
  assert.strictEqual(prioritySnapshot.snapshots[0].status, 'fresh');

  console.log(JSON.stringify({
    ok: true,
    provider_completed_before_cost_started: true,
    client_receipt_did_not_wait_for_cost: true,
    cost_continued_independently: true,
    antigravity_async_cache_refresh_awaited: true,
    authoritative_zero_credit_preserved: true,
    existing_cost_scan_aborted_for_client_receipt: true,
  }, null, 2));
}

main().catch(error => {
  console.error(`provider usage refresh priority smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
