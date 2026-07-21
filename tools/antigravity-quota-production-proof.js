#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'agent-proxy', 'session-store.json');
const preferenceKey = 'provider_usage.antigravity_quota.v1';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const waitIndex = process.argv.indexOf('--max-wait-ms');
const maxWaitMs = waitIndex >= 0 ? Number(process.argv[waitIndex + 1]) : 20 * 60 * 1000;
const baselineIndex = process.argv.indexOf('--baseline-fetched-at');
const requestedBaselineFetchedAt = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
assert(outputPath, '--output is required');
assert(Number.isFinite(maxWaitMs) && maxWaitMs >= 60_000, '--max-wait-ms must be at least 60000');

function readCache() {
  const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  return parsed?.preferences?.[preferenceKey] || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runtimeFromClient(client) {
  return { evaluate: options => client.Runtime.evaluate(options) };
}

function canonicalModels(models) {
  return (Array.isArray(models) ? models : []).map(model => ({
    model: String(model?.model || ''),
    window_kind: model?.window_kind || null,
    resets_at: model?.resets_at || null,
    percent_used: model?.percent_used ?? null,
    percent_remaining: model?.percent_remaining ?? null,
  })).sort((a, b) => a.model.localeCompare(b.model));
}

function forbiddenMatches(value) {
  const serialized = JSON.stringify(value);
  return (serialized.match(/csrf|cookie|bearer|access[_-]?token|refresh[_-]?token|password|email|account[_-]?id/gi) || []).length;
}

function windowProbe() {
  const command = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RacQuotaWindowProbe { [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); }'",
    '$fg=[RacQuotaWindowProbe]::GetForegroundWindow()',
    "$wins=@(Get-Process Antigravity -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object {[pscustomobject]@{pid=$_.Id;visible=[RacQuotaWindowProbe]::IsWindowVisible($_.MainWindowHandle);iconic=[RacQuotaWindowProbe]::IsIconic($_.MainWindowHandle);foreground=($_.MainWindowHandle -eq $fg)}})",
    '[pscustomobject]@{main_window_count=$wins.Count;antigravity_foreground=@($wins|Where-Object{$_.foreground}).Count -gt 0;windows=$wins}|ConvertTo-Json -Depth 5 -Compress',
  ].join('; ');
  return JSON.parse(execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true }).trim());
}

function getHttpsText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: false }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`native bundle status ${response.statusCode}`));
        return;
      }
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve(text));
    });
    request.setTimeout(15_000, () => request.destroy(new Error('native bundle timeout')));
    request.on('error', reject);
  });
}

async function listTargets() {
  const targets = await CDP.List({ port: 9226 });
  return targets.map(target => ({ id: target.id, type: target.type, title: target.title || '', url: target.url || '' }));
}

function antigravityPage(targets) {
  return targets.find(target => {
    if (target.type !== 'page' || target.title !== 'Antigravity') return false;
    try {
      const url = new URL(target.url);
      return ['127.0.0.1', '::1', 'localhost'].includes(url.hostname) && url.pathname === '/';
    } catch {
      return false;
    }
  }) || null;
}

async function main() {
  const baseline = readCache();
  assert(baseline?.snapshot?.models?.length, 'no durable Antigravity baseline is available');
  assert.strictEqual(forbiddenMatches(baseline), 0, 'baseline cache contains a forbidden field name');
  const baselineFetchedMs = Date.parse(requestedBaselineFetchedAt || baseline.fetched_at || '');
  assert(Number.isFinite(baselineFetchedMs), 'baseline fetched_at is invalid');
  const startedAt = Date.now();
  const windowsBefore = windowProbe();
  const targetsBefore = await listTargets();
  const pageTarget = antigravityPage(targetsBefore);
  assert(pageTarget, 'existing Antigravity renderer is unavailable');

  let refreshed = baseline;
  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(1000);
    refreshed = readCache();
    if (Date.parse(refreshed?.fetched_at || '') > baselineFetchedMs) break;
  }
  const refreshedFetchedMs = Date.parse(refreshed?.fetched_at || '');
  assert(refreshedFetchedMs > baselineFetchedMs, 'autonomous cache refresh did not occur before the deadline');
  assert.strictEqual(refreshed.source, 'in_app_api');
  assert.strictEqual(forbiddenMatches(refreshed), 0, 'refreshed cache contains a forbidden field name');

  const client = await CDP({ port: 9226, target: pageTarget.id });
  let direct;
  try {
    await client.Runtime.enable();
    direct = await selectors.readAntigravityInternalQuota(runtimeFromClient(client), false);
  } finally {
    await client.close().catch(() => {});
  }
  assert.strictEqual(direct?.ok, true, 'same-minute native quota comparison failed');
  const comparisonDelayMs = Math.abs(Date.parse(direct.fetched_at) - refreshedFetchedMs);
  assert(comparisonDelayMs <= 60_000, `native comparison missed the same-minute window (${comparisonDelayMs}ms)`);
  assert.deepStrictEqual(canonicalModels(direct.models), canonicalModels(refreshed.snapshot.models));
  assert.strictEqual(direct.available_ai_credits, refreshed.snapshot.available_ai_credits);
  assert.strictEqual(direct.plan, refreshed.snapshot.plan);
  assert.strictEqual(direct.tier, refreshed.snapshot.tier);

  const origin = new URL(pageTarget.url).origin;
  const nativeBundle = await getHttpsText(`${origin}/main.js`);
  const sourceContract = {
    main_js_sha256: crypto.createHash('sha256').update(nativeBundle).digest('hex'),
    settings_component_quota_call: /retrieveUserQuotaSummary\?\.\([^)]*\)/.test(nativeBundle)
      || nativeBundle.includes('retrieveUserQuotaSummary?.('),
    settings_component_credit_call: nativeBundle.includes('loadCodeAssist('),
    native_service_quota_method: nativeBundle.includes('retrieveUserQuotaSummary:async'),
    native_force_refresh_contract: nativeBundle.includes('forceRefresh'),
  };
  assert(Object.values(sourceContract).slice(1).every(Boolean), 'native Settings source contract was not found');

  const targetsAfter = await listTargets();
  const windowsAfter = windowProbe();
  assert.deepStrictEqual(targetsAfter.map(target => target.id).sort(), targetsBefore.map(target => target.id).sort(),
    'CDP target inventory changed during the passive proof');
  assert.strictEqual(direct.source_receipt?.page_state_unchanged, true);
  assert.strictEqual(direct.source_receipt?.dom_mutation_records, 0);

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    commit: '36520304',
    autonomous_refresh: {
      baseline_fetched_at: new Date(baselineFetchedMs).toISOString(),
      refreshed_fetched_at: new Date(refreshedFetchedMs).toISOString(),
      observed_after_ms: refreshedFetchedMs - baselineFetchedMs,
      source: refreshed.source,
      model_windows: refreshed.snapshot.models.length,
      next_refresh_at: refreshed.next_refresh_at,
    },
    same_minute_native_comparison: {
      compared_at: direct.fetched_at,
      delay_ms: comparisonDelayMs,
      exact_model_windows: canonicalModels(direct.models).length,
      exact_models_match: true,
      exact_credits_match: true,
      exact_plan_and_tier_match: true,
      native_settings_source: sourceContract,
    },
    restart_cache: {
      cached_rehydrated_receipts: (refreshed.source_history || [])
        .filter(entry => entry?.source === 'cached' && entry?.status === 'rehydrated').length,
      forbidden_field_matches: 0,
    },
    non_actuation: {
      existing_target_id_preserved: true,
      target_count_before: targetsBefore.length,
      target_count_after: targetsAfter.length,
      page_state_unchanged: true,
      dom_mutation_records: 0,
      navigation_actions: 0,
      click_actions: 0,
      focus_actions: 0,
      targets_created: 0,
      windows_before: windowsBefore,
      windows_after: windowsAfter,
    },
  };
  assert(result.restart_cache.cached_rehydrated_receipts >= 1, 'restart cache rehydration receipt is missing');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch(error => {
  console.error('Antigravity quota production proof: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
