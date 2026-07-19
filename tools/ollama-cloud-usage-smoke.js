#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const { collectOllama, ProviderUsageRegistry } = require('../agent-proxy/provider-usage');
const { providerUsageBoundaryViolation, sanitizeProviderUsageSnapshot } = require('../relay-server/provider-usage-boundary');

const KEY = Buffer.from('ollama-cloud-fixture-fingerprint-key');
const CAPTURED_AT = '2026-07-19T08:40:00.000Z';

function loadNormalizer(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const transformed = esbuild.transformSync(source, { loader: 'js', format: 'cjs', target: 'es2020' }).code;
  const compiled = { exports: {} };
  new Function('module', 'exports', transformed)(compiled, compiled.exports);
  return compiled.exports;
}

function localRequester({ available = true } = {}) {
  return async pathname => {
    if (!available) {
      const error = new Error('Fixture Ollama runtime is not running.');
      error.code = 'not_running';
      throw error;
    }
    if (pathname === '/api/ps') return { models: [{ name: 'qwen3.5:fixture', size: 12, size_vram: 10 }] };
    if (pathname === '/api/tags') return { models: [{ name: 'qwen3.5:fixture' }, { name: 'gemma3:fixture' }] };
    throw new Error(`Unexpected fixture path: ${pathname}`);
  };
}

function activeCloud() {
  return {
    ok: true,
    source: 'existing_signed_in_ollama_usage_surface',
    subscription_state: 'active',
    plan: 'Pro',
    session: { used_percent: 1.9, reset_description: '3 hours' },
    weekly: { used_percent: 48.3, reset_description: '2 days' },
    prepaid_balance: 0,
    auto_reload_enabled: false,
    captured_at: CAPTURED_AT,
    source_receipt: {
      ready_state: 'complete', visibility_state: 'visible', active_element_tag: 'BODY',
      page_path: '/settings/usage', page_state_unchanged: true, dom_mutation_records: 0,
      navigation_actions: 0, click_actions: 0, focus_actions: 0,
      existing_target_id_preserved: true, target_inventory_stable: true, targets_created: 0,
    },
  };
}

async function collect(options = {}) {
  return collectOllama(KEY, {
    requester: localRequester({ available: options.local !== false }),
    receiptReader: () => [],
    cloudReader: async () => options.cloud,
  });
}

async function main() {
  const cloudAndLocal = await collect({ cloud: activeCloud() });
  assert.strictEqual(cloudAndLocal.cloud_usage.subscription_state, 'active');
  assert.strictEqual(cloudAndLocal.local_runtime.status, 'running');
  assert.deepStrictEqual(cloudAndLocal.windows.map(window => [window.label, window.used_percent]), [
    ['Session', 1.9], ['Weekly', 48.3],
  ]);
  assert.strictEqual(cloudAndLocal.windows[0].resets_at, '2026-07-19T11:40:00.000Z');
  assert.strictEqual(cloudAndLocal.windows[1].resets_at, '2026-07-21T08:40:00.000Z');
  assert.strictEqual(cloudAndLocal.financials.prepaid_balance.amount, 0);
  assert.strictEqual(cloudAndLocal.cloud_usage.auto_reload_enabled, false);
  assert.strictEqual(cloudAndLocal.cloud_usage.source_receipt.navigation_actions, 0);

  const localOnly = await collect({ cloud: {
    ok: false,
    code: 'existing_usage_surface_unavailable',
    message: 'Cloud usage unavailable: no readable, already-open signed-in Ollama usage page was found.',
  } });
  assert.strictEqual(localOnly.cloud_usage.subscription_state, 'unavailable');
  assert.strictEqual(localOnly.windows.length, 0);
  assert.strictEqual(localOnly.local_runtime.loaded_models_count, 1);

  const noSubscription = await collect({ cloud: {
    ok: true, source: 'existing_signed_in_ollama_usage_surface', subscription_state: 'none',
    plan: null, session: null, weekly: null, prepaid_balance: null,
    auto_reload_enabled: null, captured_at: CAPTURED_AT,
  } });
  assert.strictEqual(noSubscription.cloud_usage.subscription_state, 'none');
  assert.strictEqual(noSubscription.plan, 'No cloud subscription');
  assert.strictEqual(noSubscription.windows.length, 0);

  const cloudOnly = await collect({ local: false, cloud: activeCloud() });
  assert.strictEqual(cloudOnly.local_runtime, null);
  assert.strictEqual(cloudOnly.windows.length, 2);

  const registry = new ProviderUsageRegistry({
    getSessions: () => [{ agent_type: 'ollama' }],
    collectors: { ollama: async () => cloudAndLocal },
    fingerprintKey: KEY,
    now: () => Date.parse(CAPTURED_AT),
  });
  const payload = await registry.refresh({ force: true });
  assert.strictEqual(payload.schema_version, 4);
  assert.strictEqual(payload.snapshots[0].schema_version, 4);
  assert.strictEqual(payload.snapshots[0].quota_domain, 'ollama-cloud-and-local-runtime');
  assert.strictEqual(payload.snapshots[0].dashboard_url, 'https://ollama.com/settings/usage');
  assert.strictEqual(providerUsageBoundaryViolation(payload), null);
  assert.ok(sanitizeProviderUsageSnapshot(payload));

  const web = loadNormalizer('frontend/provider-usage.js').normalizeProviderUsage(payload);
  const android = loadNormalizer('android-app/lib/provider-usage.js').normalizeProviderUsage(payload);
  assert.deepStrictEqual(android, web);
  const entry = web.entries[0];
  assert.strictEqual(entry.cloudUsage.subscriptionState, 'active');
  assert.strictEqual(entry.windows[0].label, 'Weekly');
  assert.strictEqual(entry.financials.prepaidBalance.amount, 0);
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['cookie', 'csrf', 'bearer', 'access_token', 'refresh_token', 'account_id', '@example.com']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `forbidden field/value leaked: ${forbidden}`);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    schema_version: payload.schema_version,
    fixtures: ['cloud+local', 'local-only', 'cloud-unavailable', 'no-cloud-subscription', 'cloud-only', '$0-balance'],
    exact_windows: entry.windows.map(window => ({ label: window.label, used_percent: window.usedPercent, resets_at: window.resetsAt })),
    prepaid_balance: entry.financials.prepaidBalance.amount,
    auto_reload_enabled: entry.cloudUsage.autoReloadEnabled,
    web_android_byte_equivalent: true,
    relay_boundary: 'pass',
    forbidden_fields: 0,
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
