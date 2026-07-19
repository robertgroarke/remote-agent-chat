#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalTextBytes = bytes => Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

function parseArgs(argv) {
  const options = {
    readOnlyProduction: false,
    envRoot: '',
    sourceRoot: '',
    output: '',
    ollamaReference: '',
    providerReference: '',
    antigravityReference: '',
    refreshProviderUsage: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--source-root') options.sourceRoot = path.resolve(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else if (arg === '--ollama-reference') options.ollamaReference = path.resolve(argv[++index] || '');
    else if (arg === '--provider-reference') options.providerReference = path.resolve(argv[++index] || '');
    else if (arg === '--antigravity-reference') options.antigravityReference = path.resolve(argv[++index] || '');
    else if (arg === '--refresh-provider-usage') options.refreshProviderUsage = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.envRoot, '--env-root is required');
  assert(options.sourceRoot, '--source-root is required');
  assert(options.output, '--output is required');
  return options;
}

const OLLAMA_RECEIPT_FIELDS = Object.freeze([
  'receipt_id',
  'model',
  'surface',
  'captured_at',
  'prompt_tokens',
  'response_tokens',
  'tokens_per_second',
  'total_duration_ns',
  'load_duration_ns',
  'prompt_eval_duration_ns',
  'eval_duration_ns',
]);
const FORBIDDEN_OLLAMA_CONTENT_KEYS = new Set(['prompt', 'response', 'content', 'messages', 'body']);

function forbiddenContentKeyPaths(value, currentPath = '$', matches = []) {
  if (!value || typeof value !== 'object') return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenContentKeyPaths(item, `${currentPath}[${index}]`, matches));
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    if (FORBIDDEN_OLLAMA_CONTENT_KEYS.has(String(key).toLowerCase())) matches.push(childPath);
    forbiddenContentKeyPaths(child, childPath, matches);
  }
  return matches;
}

const MONEY_FIELDS = Object.freeze([
  'prepaid_balance',
  'extra_usage_spend',
  'extra_usage_cap',
  'allowance_remaining',
  'reported_spend',
  'included_spend',
  'bonus_spend',
  'plan_limit',
  'reconciliation_delta',
]);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeMoney(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    amount: finiteOrNull(value.amount),
    currency: value.currency || null,
    source_field: value.source_field || null,
    semantics: value.semantics || null,
    directly_reported: value.directly_reported === true,
  };
}

function summarizeFinancials(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {
    semantics_version: Number(value.semantics_version) || null,
    source: value.source || null,
    observed_at: value.observed_at || null,
    account_scope: value.account_scope || null,
  };
  if (Object.prototype.hasOwnProperty.call(value, 'extra_usage_enabled')) {
    result.extra_usage_enabled = value.extra_usage_enabled === true;
  }
  for (const field of MONEY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) result[field] = summarizeMoney(value[field]);
  }
  if (value.pool_classification && typeof value.pool_classification === 'object') {
    result.pool_classification = {
      classification_status: value.pool_classification.classification_status || null,
      first_party: summarizeMoney(value.pool_classification.first_party),
      third_party: summarizeMoney(value.pool_classification.third_party),
      unclassified: summarizeMoney(value.pool_classification.unclassified),
      warning: value.pool_classification.warning || null,
    };
  }
  return result;
}

function summarizeProvider(item) {
  return {
    provider_id: item?.provider_id || null,
    status: item?.status || null,
    source: item?.source || null,
    captured_at: item?.captured_at || null,
    account_fingerprint: item?.account_fingerprint || null,
    plan: item?.plan || null,
    windows: (Array.isArray(item?.windows) ? item.windows : []).map(window => ({
      id: window?.id || null,
      label: window?.label || null,
      scope: window?.scope || null,
      model_scope: window?.model_scope || null,
      used_percent: finiteOrNull(window?.used_percent),
      remaining_percent: finiteOrNull(window?.remaining_percent),
      duration_minutes: finiteOrNull(window?.duration_minutes),
      resets_at: window?.resets_at || null,
      reset_description: window?.reset_description || null,
      source: window?.source || null,
      provenance: window?.provenance || null,
    })),
    credits: item?.credits && typeof item.credits === 'object' ? {
      enabled: item.credits.enabled === true,
      unlimited: item.credits.unlimited === true,
      balance: finiteOrNull(item.credits.balance),
      currency: item.credits.currency || null,
      unit: item.credits.unit || null,
    } : null,
    financials: summarizeFinancials(item?.financials),
    request_count: Number(item?.request_count) || 0,
    latency_ms: Number(item?.latency_ms) || 0,
  };
}

function summarizeProviderUsage(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const snapshots = Array.isArray(snapshot.snapshots) ? snapshot.snapshots : [];
  const providers = snapshots.map(summarizeProvider)
    .sort((left, right) => String(left.provider_id).localeCompare(String(right.provider_id)));
  const ollama = snapshots.find(item => item?.provider_id === 'ollama-local') || null;
  const runtime = ollama?.local_runtime && typeof ollama.local_runtime === 'object'
    ? ollama.local_runtime : null;
  const receipts = (Array.isArray(runtime?.request_receipts) ? runtime.request_receipts : [])
    .map(receipt => Object.fromEntries(OLLAMA_RECEIPT_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(receipt || {}, field))
      .map(field => [field, receipt[field]])));
  return {
    schema_version: Number(snapshot.schema_version) || null,
    generation: Number(snapshot.generation) || null,
    generated_at: snapshot.generated_at || null,
    provider_count: snapshots.length,
    provider_ids: snapshots.map(item => String(item?.provider_id || '')).filter(Boolean).sort(),
    providers,
    ollama: ollama ? {
      provider_id: ollama.provider_id,
      status: ollama.status || null,
      source: ollama.source || null,
      request_count: Number(ollama.request_count) || 0,
      latency_ms: Number(ollama.latency_ms) || 0,
      local_runtime: runtime ? {
        status: runtime.status || null,
        endpoint_scope: runtime.endpoint_scope || null,
        installed_models_count: Number(runtime.installed_models_count) || 0,
        loaded_models_count: Number(runtime.loaded_models_count) || 0,
        telemetry_status: runtime.telemetry_status || null,
        telemetry_reason: runtime.telemetry_reason || null,
        observed_request_count: Number(runtime.observed_request_count) || 0,
        request_receipts: receipts,
        forbidden_content_key_paths: forbiddenContentKeyPaths(runtime),
      } : null,
    } : null,
  };
}

function numericDelta(left, right) {
  if (left == null || right == null) return null;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? Number(Math.abs(leftNumber - rightNumber).toFixed(4)) : null;
}

function compareMoneyField(providerId, field, actual, expected) {
  if (actual == null || expected == null) {
    assert.equal(actual, expected, `${providerId} financial field ${field} nullability differs`);
    return { field, both_unreported: true, amount_delta: null };
  }
  const amountDelta = numericDelta(actual.amount, expected.amount);
  assert(amountDelta != null && amountDelta <= 0.01,
    `${providerId} financial field ${field} delta ${amountDelta} exceeded $0.01`);
  assert.equal(actual.currency, expected.currency, `${providerId} financial field ${field} currency differs`);
  assert.equal(actual.semantics, expected.semantics, `${providerId} financial field ${field} semantics differs`);
  return { field, both_unreported: false, amount_delta: amountDelta };
}

function compareFinancials(providerId, actual, expected) {
  if (!actual && !expected) return null;
  assert(actual && expected, `${providerId} omitted directly observed financial semantics`);
  const fields = [];
  for (const field of MONEY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(expected, field)) {
      fields.push(compareMoneyField(providerId, field, actual[field], expected[field]));
    }
  }
  if (expected.pool_classification) {
    assert(actual.pool_classification, `${providerId} omitted pool classification`);
    assert.equal(actual.pool_classification.classification_status,
      expected.pool_classification.classification_status,
      `${providerId} pool classification status differs`);
    for (const field of ['first_party', 'third_party', 'unclassified']) {
      fields.push(compareMoneyField(providerId, `pool_classification.${field}`,
        actual.pool_classification[field], expected.pool_classification[field]));
    }
  }
  return { tolerance_usd: 0.01, fields };
}

function compareProviderReference(providerUsage, reference) {
  assert(providerUsage && Array.isArray(providerUsage.providers), 'relay provider summary is unavailable');
  assert(reference && Array.isArray(reference.providers), 'direct provider reference is unavailable');
  const comparisons = [];
  for (const expected of reference.providers.filter(item => item.status === 'ok')) {
    const actual = providerUsage.providers.find(item => item.provider_id === expected.provider);
    assert(actual, `production snapshot omitted live provider ${expected.provider}`);
    assert.equal(actual.status, 'fresh', `production provider ${expected.provider} is not fresh`);
    const lanes = [];
    for (const expectedLane of expected.windows || []) {
      const actualLane = actual.windows.find(window => window.id === expectedLane.id)
        || actual.windows.find(window => window.label === expectedLane.label);
      assert(actualLane, `production ${expected.provider} omitted live lane ${expectedLane.id || expectedLane.label}`);
      const usedDelta = numericDelta(actualLane.used_percent, expectedLane.used_percent);
      const remainingDelta = numericDelta(actualLane.remaining_percent, expectedLane.remaining_percent);
      const actualReset = Date.parse(actualLane.resets_at || '');
      const expectedReset = Date.parse(expectedLane.resets_at || '');
      const resetDelta = Number.isFinite(actualReset) && Number.isFinite(expectedReset)
        ? Math.abs(actualReset - expectedReset) / 1000 : null;
      if (usedDelta != null) assert(usedDelta <= 1,
        `${expected.provider}/${expectedLane.id} used delta ${usedDelta}pp exceeded 1pp`);
      if (remainingDelta != null) assert(remainingDelta <= 1,
        `${expected.provider}/${expectedLane.id} remaining delta ${remainingDelta}pp exceeded 1pp`);
      if (resetDelta != null) assert(resetDelta <= 60,
        `${expected.provider}/${expectedLane.id} reset delta ${resetDelta}s exceeded 60s`);
      lanes.push({
        id: expectedLane.id,
        label: expectedLane.label,
        used_delta_percentage_points: usedDelta,
        remaining_delta_percentage_points: remainingDelta,
        reset_delta_seconds: resetDelta,
        within_tolerance: true,
      });
    }
    comparisons.push({
      provider_id: expected.provider,
      direct_source: expected.source,
      production_source: actual.source,
      lanes,
      financials: compareFinancials(expected.provider, actual.financials, expected.financials),
    });
  }
  return comparisons;
}

function compareAntigravityReference(providerUsage, reference) {
  assert(providerUsage && Array.isArray(providerUsage.providers), 'relay provider summary is unavailable');
  const expectedSnapshot = reference?.snapshot;
  assert(expectedSnapshot && Array.isArray(expectedSnapshot.models), 'Antigravity reference is unavailable');
  const actual = providerUsage.providers.find(item => item.provider_id === 'google-antigravity');
  assert(actual, 'production snapshot omitted google-antigravity');
  assert.equal(actual.status, 'fresh', 'production google-antigravity snapshot is not fresh');
  assert.equal(actual.source, 'local_settings', 'production google-antigravity source is not local Settings');
  const capturedDeltaSeconds = Math.abs(Date.parse(actual.captured_at) - Date.parse(expectedSnapshot.fetched_at)) / 1000;
  assert(Number.isFinite(capturedDeltaSeconds) && capturedDeltaSeconds <= 60,
    `production Antigravity capture delta ${capturedDeltaSeconds}s exceeded 60s`);
  const lanes = expectedSnapshot.models.map(expected => {
    const actualLane = actual.windows.find(window => window.label === expected.model);
    assert(actualLane, `production Antigravity omitted ${expected.model}`);
    const usedDelta = numericDelta(actualLane.used_percent, expected.percent_used);
    const remainingDelta = numericDelta(actualLane.remaining_percent, expected.percent_remaining);
    assert(usedDelta != null && usedDelta <= 1,
      `Antigravity ${expected.model} used delta ${usedDelta}pp exceeded 1pp`);
    assert(remainingDelta != null && remainingDelta <= 1,
      `Antigravity ${expected.model} remaining delta ${remainingDelta}pp exceeded 1pp`);
    assert.equal(actualLane.reset_description, expected.refreshes_in,
      `Antigravity ${expected.model} reset description differs`);
    return {
      label: expected.model,
      used_delta_percentage_points: usedDelta,
      remaining_delta_percentage_points: remainingDelta,
      reset_description_exact: true,
    };
  });
  const creditDelta = numericDelta(actual.credits?.balance, expectedSnapshot.available_ai_credits);
  assert(creditDelta != null && creditDelta <= 0.01,
    `Antigravity credit delta ${creditDelta} exceeded 0.01`);
  return {
    provider_id: 'google-antigravity',
    production_source: actual.source,
    capture_delta_seconds: capturedDeltaSeconds,
    credit_delta: creditDelta,
    lanes,
  };
}

function readRelayInventory(origin, token, WebSocket, { refreshProviderUsage = false } = {}) {
  return new Promise((resolve, reject) => {
    const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
      + `/client-ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('passive production inventory timed out'));
    }, refreshProviderUsage ? 60_000 : 15_000);
    const requestId = `operator-dogfood-provider-refresh-${Date.now()}`;
    const refreshStages = [];
    let acknowledgement = null;
    let latestProviderUsage = null;
    let terminalGeneration = 0;
    let refreshSent = false;
    const finish = (error, value) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    ws.once('error', error => finish(error));
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'browser',
      client_name: 'operator-dogfood-production-passive-e2e',
    })));
    const inventory = () => ({
      first_message_type: acknowledgement?.type || null,
      session_count: Array.isArray(acknowledgement?.sessions) ? acknowledgement.sessions.length : 0,
      duplicate_proxy_alarms: Array.isArray(acknowledgement?.duplicate_proxy_alarms)
        ? acknowledgement.duplicate_proxy_alarms.length : 0,
      provider_usage: summarizeProviderUsage(latestProviderUsage || acknowledgement?.provider_usage),
      provider_refresh: refreshProviderUsage ? {
        request_id: requestId,
        initial_generation: Number(acknowledgement?.provider_usage?.generation) || 0,
        final_generation: terminalGeneration,
        stages: refreshStages,
      } : null,
    });
    const maybeFinish = () => {
      if (!acknowledgement) return;
      if (!refreshProviderUsage) return finish(null, inventory());
      if (!terminalGeneration || !latestProviderUsage) return;
      if (Number(latestProviderUsage.generation) !== terminalGeneration) return;
      finish(null, inventory());
    };
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'connection_ack') {
        acknowledgement = message;
        latestProviderUsage = message.provider_usage || null;
        if (refreshProviderUsage && !refreshSent) {
          refreshSent = true;
          ws.send(JSON.stringify({
            type: 'provider_usage_refresh',
            protocol_version: 1,
            request_id: requestId,
            force: true,
          }));
        }
      } else if (message.type === 'provider_usage_snapshot' && message.snapshot) {
        latestProviderUsage = message.snapshot;
      } else if (message.type === 'provider_usage_refresh_receipt' && message.request_id === requestId) {
        refreshStages.push({
          status: message.status || null,
          coalesced: message.coalesced === true,
          generation: Number(message.generation) || 0,
          cost_status: message.cost_status || null,
          code: message.code || null,
        });
        if (message.status === 'error') {
          return finish(new Error(`provider usage refresh failed: ${message.code || 'unknown'}`));
        }
        if (message.status === 'completed') terminalGeneration = Number(message.generation) || 0;
      }
      maybeFinish();
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { chromium } = require(path.join(options.envRoot, 'frontend', 'node_modules', 'playwright-core'));
  const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
  const localWorker = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'sw.js'));
  const localStyles = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'styles.css'));
  const localBundle = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'dist', 'bundle.js'));
  const expectedAssetVersion = localWorker.toString('utf8').match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(expectedAssetVersion, 'exact source service worker is missing ASSET_VERSION');
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const relayOrigin = `http://${relayIp}:${relayPort}`;
  const WebSocket = require(path.join(options.envRoot, 'relay-server', 'node_modules', 'ws'));

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    const beforeUrl = page.url();
    assert(/^https?:/i.test(beforeUrl), 'the sole verification page is not on an HTTP origin');
    const sample = () => page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      active_agent_type: document.querySelector('.messages')?.dataset.agentType || '',
      selected_session: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      loaded_asset_version: ([...document.scripts].map(script => script.src)
        .find(src => src.includes('/dist/bundle.js')) || '').match(/v=(build-[0-9a-f]+)/)?.[1] || '',
      connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
      session_cards: document.querySelectorAll('.session-card').length,
      session_groups: document.querySelectorAll('.session-group').length,
      duplicate_proxy_banners: document.querySelectorAll('.duplicate-proxy-banner').length,
    }));
    const before = await sample();
    const requestOptions = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      maxRedirects: 0,
    };
    const nonce = Date.now();
    const [indexResponse, workerResponse, stylesResponse, bundleResponse, inventory] = await Promise.all([
      page.request.get(new URL(`/?operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/sw.js?operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(expectedAssetVersion)}&operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/dist/bundle.js?v=${encodeURIComponent(expectedAssetVersion)}&operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      readRelayInventory(relayOrigin, token, WebSocket, {
        refreshProviderUsage: options.refreshProviderUsage,
      }),
    ]);
    const indexText = await indexResponse.text();
    const workerBytes = await workerResponse.body();
    const stylesBytes = await stylesResponse.body();
    const bundleBytes = await bundleResponse.body();
    const workerText = workerBytes.toString('utf8');
    const after = await sample();
    const providerComparisons = options.providerReference
      ? compareProviderReference(inventory.provider_usage,
        JSON.parse(fs.readFileSync(options.providerReference, 'utf8')))
      : [];
    const antigravityComparison = options.antigravityReference
      ? compareAntigravityReference(inventory.provider_usage,
        JSON.parse(fs.readFileSync(options.antigravityReference, 'utf8')))
      : null;

    assert.equal(indexResponse.status(), 200, 'authenticated app-shell request failed');
    assert(indexText.includes('id="root"'), 'authenticated app shell is missing the root mount');
    assert.equal(workerResponse.status(), 200, 'served service-worker request failed');
    assert.equal(stylesResponse.status(), 200, 'served stylesheet request failed');
    assert.equal(bundleResponse.status(), 200, 'served bundle request failed');
    assert.equal((workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '', expectedAssetVersion,
      'served asset version differs from exact source');
    assert.equal(sha256(canonicalTextBytes(workerBytes)), sha256(canonicalTextBytes(localWorker)),
      'served service worker differs semantically from exact source');
    assert.equal(sha256(canonicalTextBytes(stylesBytes)), sha256(canonicalTextBytes(localStyles)),
      'served stylesheet differs semantically from exact source');
    assert.equal(sha256(canonicalTextBytes(bundleBytes)), sha256(canonicalTextBytes(localBundle)),
      'served bundle differs semantically from exact source');
    if (options.ollamaReference) {
      const referenceReport = JSON.parse(fs.readFileSync(options.ollamaReference, 'utf8'));
      const referenceReceipt = referenceReport?.canary?.receipt;
      assert(referenceReceipt?.receipt_id, 'Ollama reference is missing canary.receipt');
      const providerUsage = inventory.provider_usage;
      assert(providerUsage, 'relay connection acknowledgement omitted provider usage');
      assert(providerUsage.ollama, 'relay provider usage omitted Ollama');
      assert(providerUsage.ollama.local_runtime, 'relay Ollama snapshot omitted local runtime');
      const runtime = providerUsage.ollama.local_runtime;
      assert.equal(runtime.endpoint_scope, 'loopback_only', 'production Ollama scope is not loopback-only');
      assert.equal(runtime.telemetry_status, 'observed_owned_requests',
        'production Ollama snapshot did not report owned-request telemetry');
      assert.deepEqual(runtime.forbidden_content_key_paths, [],
        'production Ollama snapshot contains forbidden prompt/response content keys');
      const productionReceipt = runtime.request_receipts
        .find(receipt => receipt.receipt_id === referenceReceipt.receipt_id);
      assert(productionReceipt, `production Ollama snapshot omitted owned receipt ${referenceReceipt.receipt_id}`);
      for (const field of OLLAMA_RECEIPT_FIELDS) {
        assert.deepEqual(productionReceipt[field], referenceReceipt[field],
          `production Ollama receipt field ${field} differs from owned canary`);
      }
    }
    assert.equal(page.url(), beforeUrl, 'persistent page navigated');
    assert.equal(after.url, before.url, 'persistent page URL changed');
    assert.equal(after.selected_session, before.selected_session, 'persistent page selection changed');
    assert.equal(after.active_agent_type, before.active_agent_type, 'persistent page agent changed');
    assert.equal(after.visibility, before.visibility, 'persistent page visibility changed');
    assert.equal(after.has_focus, before.has_focus, 'persistent page focus state changed');
    assert(inventory.session_count > 0, 'passive production inventory is empty');
    assert.equal(inventory.duplicate_proxy_alarms, 0, 'passive production inventory has duplicate proxy alarms');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      mode: 'passive_request_context',
      cdp: cdpUrl,
      pages: pages.length,
      source_root: options.sourceRoot,
      expected_asset_version: expectedAssetVersion,
      served_asset_version: expectedAssetVersion,
      assets: {
        app_shell_status: indexResponse.status(),
        service_worker_sha256: sha256(workerBytes),
        stylesheet_sha256: sha256(stylesBytes),
        bundle_sha256: sha256(bundleBytes),
        service_worker_exact_source_match: true,
        stylesheet_exact_source_match: true,
        bundle_exact_source_match: true,
      },
      relay_inventory: inventory,
      page: {
        url_unchanged: true,
        selected_session_unchanged: true,
        active_agent_unchanged: true,
        visibility_unchanged: true,
        focus_state_unchanged: true,
        loaded_asset_version_before: before.loaded_asset_version,
        loaded_asset_version_after: after.loaded_asset_version,
        connection_label_before: before.connection_label,
        connection_label_after: after.connection_label,
        session_cards_before: before.session_cards,
        session_cards_after: after.session_cards,
        session_groups_before: before.session_groups,
        session_groups_after: after.session_groups,
        duplicate_proxy_banners_before: before.duplicate_proxy_banners,
        duplicate_proxy_banners_after: after.duplicate_proxy_banners,
      },
      automation: {
        page_navigations: 0,
        page_reloads: 0,
        focus_actions: 0,
        sends: 0,
        controls: 0,
        dom_mutations: 0,
        visible_windows_opened: 0,
        protected_session_mutations: 0,
        provider_refresh_requests: options.refreshProviderUsage ? 1 : 0,
      },
      ollama_reference: options.ollamaReference ? {
        path: path.relative(options.sourceRoot, options.ollamaReference).replace(/\\/g, '/'),
        exact_receipt_match: true,
      } : null,
      provider_reference: options.providerReference ? {
        path: path.relative(options.sourceRoot, options.providerReference).replace(/\\/g, '/'),
        comparisons: providerComparisons,
      } : null,
      antigravity_reference: options.antigravityReference ? {
        path: path.relative(options.sourceRoot, options.antigravityReference).replace(/\\/g, '/'),
        comparison: antigravityComparison,
      } : null,
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Operator dogfood passive production E2E: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = {
  compareAntigravityReference,
  compareProviderReference,
  main,
  parseArgs,
  summarizeProviderUsage,
};
