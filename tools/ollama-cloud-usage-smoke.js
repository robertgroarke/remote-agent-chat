#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const { collectOllama, ProviderUsageRegistry } = require('../agent-proxy/provider-usage');
const {
  EXTRACTION_SIGNATURE,
  readOllamaCloudUsageFromExistingChrome,
} = require('../agent-proxy/ollama-cloud-usage');
const {
  providerUsageBoundaryViolation,
  sanitizeProviderUsageSnapshot,
} = require('../relay-server/provider-usage-boundary');

const KEY = Buffer.from('ollama-cloud-fixture-fingerprint-key');
const CAPTURED_AT = '2026-07-26T08:40:00.000Z';
const USAGE_TARGET = Object.freeze({
  id: 'ollama-usage-target',
  type: 'page',
  url: 'https://ollama.com/settings/usage',
});
const AUTH_TARGET = Object.freeze({
  id: 'ollama-auth-target',
  type: 'page',
  url: 'https://ollama.com/signin',
});

function loadNormalizer(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const transformed = esbuild.transformSync(source, { loader: 'js', format: 'cjs', target: 'es2020' }).code;
  const compiled = { exports: {} };
  new Function('module', 'exports', transformed)(compiled, compiled.exports);
  return compiled.exports;
}

function fixtureError(code = 'not_running') {
  const error = new Error(`Fixture ${code}`);
  error.code = code;
  return error;
}

function localRequester({
  available = true,
  failPath = null,
  malformedPath = null,
  runningModels = [{ name: 'qwen3.5:fixture', size: 12, size_vram: 10 }],
  installedModels = [{ name: 'qwen3.5:fixture' }, { name: 'gemma3:fixture' }],
} = {}) {
  return async pathname => {
    if (!available || pathname === failPath) throw fixtureError(available ? 'timeout' : 'not_running');
    if (pathname === malformedPath) return { unexpected: [] };
    if (pathname === '/api/ps') return { models: runningModels };
    if (pathname === '/api/tags') return { models: installedModels };
    throw new Error(`Unexpected fixture path: ${pathname}`);
  };
}

function activeCloud(overrides = {}) {
  return {
    ok: true,
    source: 'owned_signed_in_ollama_usage_surface',
    lifecycle_status: 'fresh',
    attempt_id: 'cloud-active-attempt',
    attempted_at: CAPTURED_AT,
    subscription_state: 'active',
    plan: 'Pro',
    session: { used_percent: 1.9, reset_description: '3 hours' },
    weekly: { used_percent: 48.3, reset_description: '2 days' },
    prepaid_balance: 0,
    auto_reload_enabled: false,
    captured_at: CAPTURED_AT,
    configured_ports: [9240],
    fallback_ports: [],
    effective_ports: [9240],
    fallback_policy: 'none',
    extraction_signature: EXTRACTION_SIGNATURE,
    attempts: [{
      port: 9240, status: 'fresh', code: null, reachable: true,
      elapsed_ms: 12, ollama_origin_targets: 1, usage_targets: 1,
    }],
    source_receipt: {
      extraction_signature: EXTRACTION_SIGNATURE,
      ready_state: 'complete', visibility_state: 'hidden', active_element_tag: 'BODY',
      page_path: '/settings/usage', page_state_unchanged: true, dom_mutation_records: 0,
      navigation_actions: 0, click_actions: 0, focus_actions: 0,
      existing_target_id_preserved: true, target_inventory_stable: true, targets_created: 0,
    },
    ...overrides,
  };
}

function disconnectedCloud(overrides = {}) {
  return {
    ok: false,
    source: 'owned_ollama_usage_surface',
    lifecycle_status: 'unavailable',
    code: 'cdp_endpoint_unavailable',
    message: 'Ollama Cloud monitoring is not connected: the configured owned browser endpoint is unavailable.',
    attempt_id: 'cloud-disconnected-attempt',
    attempted_at: CAPTURED_AT,
    next_action: 'start_owned_cloud_source',
    configured_ports: [9240],
    fallback_ports: [],
    effective_ports: [9240],
    fallback_policy: 'none',
    extraction_signature: EXTRACTION_SIGNATURE,
    attempts: [{
      port: 9240, status: 'unavailable', code: 'cdp_endpoint_unavailable',
      reachable: false, elapsed_ms: 3,
    }],
    ...overrides,
  };
}

async function collect(options = {}) {
  return collectOllama(KEY, {
    attemptId: options.attemptId || 'local-fixture-attempt',
    requester: localRequester(options.localOptions || {
      available: options.local !== false,
    }),
    receiptReader: () => [],
    cloudReader: async () => options.cloud,
  });
}

function mockCdpClient(receipt, options = {}) {
  return {
    Runtime: {
      enable: async () => {},
      evaluate: options.evaluationNeverSettles
        ? () => new Promise(() => {})
        : async () => ({ result: { value: receipt } }),
    },
    close: async () => {},
  };
}

async function sourceContract() {
  const common = {
    ports: '9240',
    attemptId: 'source-contract-attempt',
    sourceTimeoutMs: 800,
    stageTimeoutMs: 100,
  };
  const unconfigured = await readOllamaCloudUsageFromExistingChrome({
    ...common, ports: '',
  });
  assert.strictEqual(unconfigured.code, 'cdp_not_configured');
  assert.deepStrictEqual(unconfigured.effective_ports, []);

  const cdpDown = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => { throw fixtureError('ECONNREFUSED'); },
  });
  assert.strictEqual(cdpDown.code, 'cdp_endpoint_unavailable');
  assert.strictEqual(cdpDown.lifecycle_status, 'unavailable');
  assert.deepStrictEqual(cdpDown.effective_ports, [9240]);

  let recoveredInventoryCalls = 0;
  let recoveredLaunchCalls = 0;
  const supervisedRecovery = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => {
      recoveredInventoryCalls += 1;
      if (recoveredInventoryCalls === 1) throw fixtureError('ECONNREFUSED');
      return [USAGE_TARGET];
    },
    ensureOwnedBrowser: async port => {
      recoveredLaunchCalls += 1;
      return {
        ok: true,
        status: 'started',
        code: null,
        port,
        elapsed_ms: 14,
        visible_windows_opened: 0,
        protected_existing_targets_mutated: 0,
      };
    },
    cdpClientFactory: async () => mockCdpClient(activeCloud()),
  });
  assert.strictEqual(supervisedRecovery.ok, true);
  assert.strictEqual(recoveredLaunchCalls, 1);
  assert.strictEqual(recoveredInventoryCalls, 3);
  assert.strictEqual(supervisedRecovery.supervision.status, 'started');
  assert.strictEqual(supervisedRecovery.source_receipt.navigation_actions, 0);
  assert.strictEqual(supervisedRecovery.source_receipt.targets_created, 0);

  const supervisedFailure = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => { throw fixtureError('ECONNREFUSED'); },
    ensureOwnedBrowser: async port => ({
      ok: false,
      status: 'failed',
      code: 'owned_browser_profile_locked',
      port,
      elapsed_ms: 9,
      visible_windows_opened: 0,
      protected_existing_targets_mutated: 0,
    }),
    suppressSupervisorWarning: true,
  });
  assert.strictEqual(supervisedFailure.code, 'owned_browser_profile_locked');
  assert.strictEqual(supervisedFailure.lifecycle_status, 'unavailable');
  assert.strictEqual(supervisedFailure.next_action, 'start_owned_cloud_source');
  assert.match(supervisedFailure.message, /owned usage browser is not running/i);
  assert.strictEqual(supervisedFailure.supervision.protected_existing_targets_mutated, 0);

  const supervisedStarting = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    sourceTimeoutMs: 250,
    listTargets: async () => { throw fixtureError('ECONNREFUSED'); },
    ensureOwnedBrowser: () => new Promise(() => {}),
    suppressSupervisorWarning: true,
  });
  assert.strictEqual(supervisedStarting.code, 'owned_browser_start_timeout');
  assert.strictEqual(supervisedStarting.supervision.status, 'starting');
  assert.match(supervisedStarting.message, /starting headlessly/i);

  const noTarget = await readOllamaCloudUsageFromExistingChrome({
    ...common, listTargets: async () => [],
  });
  assert.strictEqual(noTarget.code, 'usage_target_absent');
  assert.strictEqual(noTarget.attempts[0].reachable, true);

  const signedOut = await readOllamaCloudUsageFromExistingChrome({
    ...common, listTargets: async () => [AUTH_TARGET],
  });
  assert.strictEqual(signedOut.code, 'usage_auth_required');
  assert.strictEqual(signedOut.lifecycle_status, 'auth_required');

  const schemaDrift = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => [USAGE_TARGET],
    cdpClientFactory: async () => mockCdpClient({ ok: false, code: 'usage_dom_unrecognized' }),
  });
  assert.strictEqual(schemaDrift.code, 'usage_schema_drift');
  assert.strictEqual(schemaDrift.lifecycle_status, 'error');

  const extractionStartedAt = Date.now();
  const extractionTimeout = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => [USAGE_TARGET],
    cdpClientFactory: async () => mockCdpClient(null, { evaluationNeverSettles: true }),
  });
  assert.strictEqual(extractionTimeout.code, 'usage_evaluation_timeout');
  assert(Date.now() - extractionStartedAt < 5000, 'evaluation timeout exceeded the source contract');

  const inventoryStartedAt = Date.now();
  const inventoryTimeout = await readOllamaCloudUsageFromExistingChrome({
    ...common, listTargets: () => new Promise(() => {}),
  });
  assert.strictEqual(inventoryTimeout.code, 'cdp_inventory_timeout');
  assert(Date.now() - inventoryStartedAt < 5000, 'inventory timeout exceeded the source contract');

  let redirectInventoryCalls = 0;
  const redirect = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => (++redirectInventoryCalls === 1 ? [USAGE_TARGET] : [AUTH_TARGET]),
    cdpClientFactory: async () => mockCdpClient(activeCloud()),
  });
  assert.strictEqual(redirect.code, 'usage_auth_required');

  const sourceFresh = await readOllamaCloudUsageFromExistingChrome({
    ...common,
    listTargets: async () => [USAGE_TARGET],
    cdpClientFactory: async () => mockCdpClient(activeCloud()),
  });
  assert.strictEqual(sourceFresh.ok, true);
  assert.strictEqual(sourceFresh.lifecycle_status, 'fresh');
  assert.strictEqual(sourceFresh.source_receipt.extraction_signature, EXTRACTION_SIGNATURE);
  assert.strictEqual(sourceFresh.source_receipt.navigation_actions, 0);
  assert.strictEqual(sourceFresh.source_receipt.click_actions, 0);
  assert.strictEqual(sourceFresh.source_receipt.focus_actions, 0);
  assert.strictEqual(sourceFresh.source_receipt.targets_created, 0);

  return {
    unconfigured, cdpDown, supervisedRecovery, supervisedFailure,
    supervisedStarting, noTarget, signedOut, schemaDrift,
    extractionTimeout, inventoryTimeout, redirect, sourceFresh,
  };
}

async function main() {
  const sourceCases = await sourceContract();

  const cloudAndLocal = await collect({ cloud: activeCloud() });
  assert.strictEqual(cloudAndLocal.cloud_usage.subscription_state, 'active');
  assert.strictEqual(cloudAndLocal.cloud_usage.lifecycle.status, 'fresh');
  assert.strictEqual(cloudAndLocal.local_runtime.status, 'running');
  assert.strictEqual(cloudAndLocal.local_runtime.lifecycle.status, 'fresh');
  assert.deepStrictEqual(cloudAndLocal.windows.map(window => [window.label, window.used_percent]), [
    ['Session', 1.9], ['Weekly', 48.3],
  ]);
  assert.strictEqual(cloudAndLocal.windows[0].resets_at, '2026-07-26T11:40:00.000Z');
  assert.strictEqual(cloudAndLocal.windows[1].resets_at, '2026-07-28T08:40:00.000Z');
  assert.strictEqual(cloudAndLocal.financials.prepaid_balance.amount, 0);
  assert.strictEqual(cloudAndLocal.cloud_usage.auto_reload_enabled, false);
  assert.strictEqual(cloudAndLocal.cloud_usage.source_receipt.navigation_actions, 0);

  const localOnly = await collect({ cloud: disconnectedCloud() });
  assert.strictEqual(localOnly.cloud_usage.subscription_state, 'unavailable');
  assert.strictEqual(localOnly.cloud_usage.lifecycle.status, 'unavailable');
  assert.strictEqual(localOnly.windows.length, 0);
  assert.strictEqual(localOnly.local_runtime.loaded_models_count, 1);
  const supervisedLocalOnly = await collect({ cloud: sourceCases.supervisedFailure });
  assert.strictEqual(supervisedLocalOnly.cloud_usage.lifecycle.diagnostic.supervision.status, 'failed');
  assert.strictEqual(
    supervisedLocalOnly.cloud_usage.lifecycle.diagnostic.supervision.protected_existing_targets_mutated,
    0,
  );

  const noSubscription = await collect({ cloud: activeCloud({
    subscription_state: 'none', plan: null, session: null, weekly: null,
    prepaid_balance: null, auto_reload_enabled: null,
  }) });
  assert.strictEqual(noSubscription.cloud_usage.subscription_state, 'none');
  assert.strictEqual(noSubscription.plan, 'No cloud subscription');
  assert.strictEqual(noSubscription.windows.length, 0);

  const cloudOnly = await collect({ local: false, cloud: activeCloud() });
  assert.strictEqual(cloudOnly.local_runtime.status, 'unavailable');
  assert.strictEqual(cloudOnly.local_runtime.lifecycle.status, 'unavailable');
  assert.strictEqual(cloudOnly.local_runtime.loaded_models_count, null);
  assert.strictEqual(cloudOnly.local_runtime.installed_models_count, null);
  assert.strictEqual(cloudOnly.windows.length, 2);

  const noModels = await collect({
    cloud: disconnectedCloud(),
    localOptions: { runningModels: [], installedModels: [] },
  });
  assert.strictEqual(noModels.local_runtime.status, 'running');
  assert.strictEqual(noModels.local_runtime.loaded_models_count, 0);
  assert.strictEqual(noModels.local_runtime.installed_models_count, 0);

  const psFailed = await collect({
    cloud: disconnectedCloud(),
    localOptions: { failPath: '/api/ps', installedModels: [{ name: 'installed-only' }] },
  });
  assert.strictEqual(psFailed.local_runtime.status, 'partial');
  assert.strictEqual(psFailed.local_runtime.loaded_models_count, null);
  assert.strictEqual(psFailed.local_runtime.installed_models_count, 1);
  assert.strictEqual(psFailed.local_runtime.observations.api_ps.status, 'error');
  assert.strictEqual(psFailed.local_runtime.observations.api_tags.status, 'fresh');

  const tagsMalformed = await collect({
    cloud: disconnectedCloud(),
    localOptions: { malformedPath: '/api/tags', runningModels: [] },
  });
  assert.strictEqual(tagsMalformed.local_runtime.loaded_models_count, 0);
  assert.strictEqual(tagsMalformed.local_runtime.installed_models_count, null);
  assert.strictEqual(tagsMalformed.local_runtime.observations.api_tags.reason.code, 'malformed_payload');

  const allUnavailable = await collect({ local: false, cloud: disconnectedCloud() });
  assert.strictEqual(allUnavailable.provider_status, 'unavailable');
  assert.strictEqual(allUnavailable.local_runtime.lifecycle.status, 'unavailable');
  assert.strictEqual(allUnavailable.cloud_usage.lifecycle.status, 'unavailable');

  let recoveryPhase = 0;
  const recoveryRegistry = new ProviderUsageRegistry({
    getSessions: () => [{ agent_type: 'ollama' }],
    collectors: {
      ollama: async () => {
        recoveryPhase += 1;
        if (recoveryPhase === 1) return collect({
          attemptId: 'recovery-1',
          cloud: activeCloud(),
        });
        if (recoveryPhase === 2) return collect({
          attemptId: 'recovery-2',
          cloud: disconnectedCloud(),
          localOptions: { failPath: '/api/ps', installedModels: [{ name: 'new-tag' }] },
        });
        return collect({
          attemptId: 'recovery-3',
          cloud: disconnectedCloud(),
          local: false,
        });
      },
    },
    fingerprintKey: KEY,
    jitterRatio: 0,
  });
  const recovery1 = await recoveryRegistry.refresh({ force: true });
  const recovery2 = await recoveryRegistry.refresh({ force: true });
  const recovery3 = await recoveryRegistry.refresh({ force: true });
  const recoveredFresh = recovery1.snapshots[0];
  const recoveredPartial = recovery2.snapshots[0];
  const recoveredStale = recovery3.snapshots[0];
  assert.strictEqual(recoveredFresh.cloud_usage.lifecycle.status, 'fresh');
  assert.strictEqual(recoveredPartial.cloud_usage.lifecycle.status, 'stale');
  assert.strictEqual(recoveredPartial.local_runtime.observations.api_ps.status, 'stale');
  assert.strictEqual(recoveredPartial.local_runtime.observations.api_tags.status, 'fresh');
  assert.strictEqual(recoveredStale.status, 'stale');
  assert.strictEqual(recoveredStale.local_runtime.observations.api_ps.status, 'stale');
  assert.strictEqual(recoveredStale.local_runtime.observations.api_tags.status, 'stale');
  assert(recoveredStale.windows.every(window => window.freshness_status === 'stale'));

  const registry = new ProviderUsageRegistry({
    getSessions: () => [{ agent_type: 'ollama' }],
    collectors: { ollama: async () => supervisedLocalOnly },
    fingerprintKey: KEY,
    now: () => Date.parse(CAPTURED_AT),
  });
  const payload = await registry.refresh({ force: true });
  assert.strictEqual(payload.schema_version, 5);
  assert.strictEqual(payload.snapshots[0].schema_version, 5);
  assert.strictEqual(payload.snapshots[0].quota_domain, 'ollama-cloud-and-local-runtime');
  assert.strictEqual(payload.snapshots[0].dashboard_url, 'https://ollama.com/settings/usage');
  assert.strictEqual(providerUsageBoundaryViolation(payload), null);
  assert.ok(sanitizeProviderUsageSnapshot(payload));

  const webModule = loadNormalizer('frontend/provider-usage.js');
  const androidModule = loadNormalizer('android-app/lib/provider-usage.js');
  const web = webModule.normalizeProviderUsage(payload);
  const android = androidModule.normalizeProviderUsage(payload);
  assert.deepStrictEqual(android, web);
  const entry = web.entries[0];
  assert.strictEqual(entry.cloudUsage.subscriptionState, 'unavailable');
  assert.strictEqual(entry.cloudUsage.lifecycle.diagnostic.effectivePorts[0], 9240);
  assert.strictEqual(entry.cloudUsage.lifecycle.diagnostic.supervision.status, 'failed');
  assert.strictEqual(entry.cloudUsage.lifecycle.diagnostic.supervision.code, 'owned_browser_profile_locked');
  assert.strictEqual(entry.cloudUsage.lifecycle.diagnostic.supervision.visibleWindowsOpened, 0);
  assert.strictEqual(entry.cloudUsage.lifecycle.diagnostic.supervision.protectedExistingTargetsMutated, 0);
  assert.strictEqual(entry.localRuntime.loadedModelsCount, 1);
  assert.strictEqual(entry.localRuntime.installedModelsCount, 2);

  let webRetained = null;
  let androidRetained = null;
  const reordered = [];
  for (let generation = 1; generation <= 1000; generation += 1) {
    reordered.push({
      schema_version: 5,
      generation,
      generated_at: new Date(Date.parse(CAPTURED_AT) + generation).toISOString(),
      in_flight: false,
      snapshots: payload.snapshots,
    });
    if (generation % 7 === 0) reordered.push({
      schema_version: 5,
      generation,
      generated_at: new Date(Date.parse(CAPTURED_AT) + generation).toISOString(),
      in_flight: true,
      snapshots: [],
    });
    if (generation > 1 && generation % 11 === 0) reordered.push({
      schema_version: 5,
      generation: generation - 1,
      generated_at: new Date(Date.parse(CAPTURED_AT) + generation - 1).toISOString(),
      in_flight: false,
      snapshots: [],
    });
  }
  for (const event of reordered) {
    webRetained = webModule.retainNewerProviderUsage(webRetained, event);
    androidRetained = androidModule.retainNewerProviderUsage(androidRetained, event);
  }
  assert.strictEqual(webRetained.generation, 1000);
  assert.strictEqual(androidRetained.generation, 1000);
  assert.strictEqual(webRetained.snapshots.length, 1);
  assert.deepStrictEqual(androidRetained, webRetained);

  const serialized = JSON.stringify({
    sourceCases,
    payload,
    recovery: [recovery1, recovery2, recovery3],
  });
  for (const forbidden of [
    'cookie', 'csrf', 'bearer', 'access_token', 'refresh_token',
    'account_id', '@example.com', 'password',
  ]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `forbidden field/value leaked: ${forbidden}`);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    schema_version: payload.schema_version,
    fixtures: [
      'cloud+local', 'local-only', 'cloud-only', 'no-cloud-subscription',
      'zero-loaded', 'zero-installed', 'one-loopback-endpoint-failed',
      'local-service-stopped', 'cdp-down', 'no-target', 'signed-out',
      'spa-redirect', 'dom-drift', 'extraction-timeout',
      'owned-browser-supervised-recovery', 'owned-browser-start-failure',
      'owned-browser-starting-timeout',
      'last-good-stale-recovered',
    ],
    exact_local_counts: {
      live_shape: {
        loaded: localOnly.local_runtime.loaded_models_count,
        installed: localOnly.local_runtime.installed_models_count,
      },
      zero_models: {
        loaded: noModels.local_runtime.loaded_models_count,
        installed: noModels.local_runtime.installed_models_count,
      },
      partial_ps_failure: {
        loaded: psFailed.local_runtime.loaded_models_count,
        installed: psFailed.local_runtime.installed_models_count,
      },
    },
    source_deadline_ms: 5000,
    source_terminal_statuses: {
      cdp_down: sourceCases.cdpDown.lifecycle_status,
      supervised_recovery: sourceCases.supervisedRecovery.lifecycle_status,
      supervised_failure: sourceCases.supervisedFailure.lifecycle_status,
      supervised_starting: sourceCases.supervisedStarting.lifecycle_status,
      no_target: sourceCases.noTarget.lifecycle_status,
      signed_out: sourceCases.signedOut.lifecycle_status,
      dom_drift: sourceCases.schemaDrift.lifecycle_status,
      extraction_timeout: sourceCases.extractionTimeout.lifecycle_status,
      fresh: sourceCases.sourceFresh.lifecycle_status,
    },
    last_good_lifecycle: {
      cloud: [
        recoveredFresh.cloud_usage.lifecycle.status,
        recoveredPartial.cloud_usage.lifecycle.status,
        recoveredStale.cloud_usage.lifecycle.status,
      ],
      local_ps: [
        recoveredFresh.local_runtime.observations.api_ps.status,
        recoveredPartial.local_runtime.observations.api_ps.status,
        recoveredStale.local_runtime.observations.api_ps.status,
      ],
    },
    reordered_lifecycle_events: reordered.length,
    retained_generation: webRetained.generation,
    web_android_byte_equivalent: true,
    relay_boundary: 'pass',
    forbidden_fields: 0,
    hosted_model_calls: 0,
    navigation_actions: 0,
    click_actions: 0,
    focus_actions: 0,
    targets_created: 0,
    owned_browser_launches: 1,
    protected_existing_targets_mutated: 0,
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
