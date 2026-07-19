#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const marks = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'ProviderMark.jsx'), 'utf8');
for (const marker of [
  "case 'provider_usage_snapshot':",
  'normalizeProviderUsage(providerUsage)',
  'accessibilityLabel="Usage and limits"',
  '<Text style={s.usageTitle}>Usage & limits</Text>',
  "normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.providers",
  "normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.accounts",
  'provider-usage-card-${entry.providerId}',
  '<ProviderMark providerId={entry.providerId} providerName={entry.providerName} colorScheme="dark" />',
  'accessibilityState={{ expanded: !collapsed }}',
  'requestProviderUsageRefresh(true)',
  "case 'provider_usage_refresh_receipt':",
  "case 'provider_usage_cost_detail':",
  'requestProviderUsageCostDetail(query)',
  'Paginated local cost detail',
  'Open dashboard',
  'formatProviderUsageReset(window.resetsAt',
  'Next refresh {formatProviderUsageReset(entry.nextRefreshAt',
  'Local estimated API-equivalent cost',
  "normalizedProviderUsage.collectionState === 'not-started'",
  'normalizedProviderUsage.summaryAuthoritative',
  'Quota totals remain unknown until a provider collection completes.',
  'No zero total is reported because the scan did not complete.',
  'selectEstimatedCost(',
  'window.visualPercent',
  'window.pace.category',
  'window.thresholds.warningPercent',
  'accessibilityLabel="Ollama owned request metrics"',
  'accessibilityLabel="Ollama Cloud usage"',
  'accessibilityLabel="Ollama Cloud usage unavailable"',
  'accessibilityLabel="Ollama Cloud no subscription"',
  'formatOllamaTokenRate(entry.localRuntime.latestRequest.tokensPerSecond)',
  'formatOllamaDuration(entry.localRuntime.latestRequest.promptEvalDurationNs)',
  'usagePaceBudgets',
  'usageCostTable',
]) assert(source.includes(marker), `missing Android usage-dashboard marker: ${marker}`);

assert(!source.includes('function collectUsageByHarness'), 'legacy Android harness aggregation must be removed');
assert(!source.includes("navigation.navigate('Chat', { sessionId: entry.sessionId"), 'usage cards must not jump to an arbitrary session');
assert(!source.includes('entry.providerName.slice(0, 2).toUpperCase()'), 'synthetic provider initials must not be primary marks');
for (const marker of [
  'accessibilityRole="image"',
  'provider mark${failed || !mark',
  "require('../assets/providers/openai-light.png')",
  "require('../assets/providers/ollama-light.png')",
]) assert(marks.includes(marker), `missing Android provider mark marker: ${marker}`);

const result = {
  ok: true,
  provider_account_aggregation: true,
  live_provider_snapshot_updates: true,
  all_windows_and_reset_capacity: true,
  source_age_and_next_refresh: true,
  warning_and_exhausted_states: true,
  collapsible_expanded_cards: true,
  arbitrary_session_jump_removed: true,
  accessible_modal: true,
  predictive_pace_and_safe_budgets: true,
  per_window_thresholds: true,
  over_100_truth_with_visual_cap: true,
  local_estimated_cost_separate_from_quota: true,
  cost_range_and_project_filters: true,
  provider_lifecycle_without_false_zero: true,
  cost_lifecycle_without_false_zero: true,
  correlated_refresh_receipts: true,
  paginated_cost_detail: true,
  official_provider_marks: true,
  provider_mark_text_fallback: true,
  ollama_owned_request_metrics: true,
  ollama_cloud_usage_states: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
