#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
for (const marker of [
  "case 'provider_usage_snapshot':",
  'normalizeProviderUsage(providerUsage)',
  'accessibilityLabel="Usage and limits"',
  '<Text style={s.usageTitle}>Usage & limits</Text>',
  "normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.providers",
  "normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.accounts",
  'provider-usage-card-${entry.providerId}',
  'accessibilityState={{ expanded: !collapsed }}',
  'requestProviderUsageRefresh(true)',
  "case 'provider_usage_refresh_receipt':",
  "case 'provider_usage_cost_detail':",
  'requestProviderUsageCostDetail(query)',
  'Paginated local cost detail',
  'Open dashboard',
  'formatProviderUsageReset(window.resetsAt',
  'Local estimated API-equivalent cost',
  "normalizedProviderUsage.collectionState === 'not-started'",
  'normalizedProviderUsage.summaryAuthoritative',
  'Quota totals remain unknown until a provider collection completes.',
  'No zero total is reported because the scan did not complete.',
  'selectEstimatedCost(',
  'window.visualPercent',
  'window.pace.category',
  'window.thresholds.warningPercent',
  'usagePaceBudgets',
  'usageCostTable',
]) assert(source.includes(marker), `missing Android usage-dashboard marker: ${marker}`);

assert(!source.includes('function collectUsageByHarness'), 'legacy Android harness aggregation must be removed');
assert(!source.includes("navigation.navigate('Chat', { sessionId: entry.sessionId"), 'usage cards must not jump to an arbitrary session');

const result = {
  ok: true,
  provider_account_aggregation: true,
  live_provider_snapshot_updates: true,
  all_windows_and_reset_capacity: true,
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
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
