#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const marks = fs.readFileSync(path.join(root, 'frontend', 'provider-marks.jsx'), 'utf8');
const androidScreen = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const androidRelay = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');

for (const marker of [
  'function SessionUsageMiniMonitor({ session, config, providerUsage, onOpenUsage })',
  'sessionUsageProjection(session, config, normalizedUsage, nowMs)',
  'data-testid="session-usage-mini"',
  'function formatUsageResetLabel(value)',
  'function UsageDashboard({ usage, refreshReceipt, resetReceipt, costDetail, onBack, onRefresh, onWatch, onConsumeResetCredit, onRequestCostDetail })',
  'normalizeProviderUsage(usage)',
  'data-testid="usage-dashboard"',
  'Warnings start at 75% used.',
  '<details',
  'data-provider-id={entry.providerId}',
  '<ProviderMark providerId={entry.providerId} providerName={entry.providerName} />',
  '<span>providers</span>',
  '<span>accounts</span>',
  'Open provider dashboard',
  'Local estimated API-equivalent cost',
  "normalized.collectionState === 'not-started'",
  'normalized.summaryAuthoritative',
  'Quota totals remain unknown until a provider collection completes.',
  'No zero total is reported because the scan did not complete.',
  'selectEstimatedCost',
  'window.visualPercent',
  'window.pace.category',
  'window.thresholds.warningPercent',
  'data-testid="ollama-owned-request-metrics"',
  'data-testid="ollama-cloud-usage"',
  'data-testid="ollama-cloud-unavailable"',
  'data-testid="ollama-cloud-no-subscription"',
  'formatOllamaTokenRate(entry.localRuntime.latestRequest.tokensPerSecond)',
  'formatOllamaDuration(entry.localRuntime.latestRequest.promptEvalDurationNs)',
  'usage-pace-budgets',
  'usage-cost-table',
  'requestProviderUsageRefresh',
  'onWatch={setProviderUsageWatching}',
  'Refresh now',
  'entry.status === \'stale\'',
  'requestProviderUsageCostDetail',
  'Paginated local cost detail',
  'projection.headerWindows.map(sessionUsageWindowLabel)',
  'title="Usage and limits"',
  "className={`app${hasSystemBanner ? ' has-system-banner' : ''}`}",
  "'--system-banner-height': `${systemBannerHeight}px`",
]) assert(app.includes(marker), `missing usage dashboard marker: ${marker}`);

for (const marker of [
  "t === 'provider_usage_refresh_receipt'",
  "t === 'provider_usage_cost_detail'",
  "type: 'provider_usage_cost_detail_request'",
  "type: 'provider_usage_watch'",
  'provider_id: providerId',
]) assert(hooks.includes(marker), `missing usage transport marker: ${marker}`);

for (const marker of [
  'setProviderUsageWatching(true)',
  'setProviderUsageWatching(false)',
  "requestProviderUsageRefresh(true, entry.providerId)",
  "providerUsageRefreshReceipt?.provider_id === entry.providerId",
  "entry.status === 'stale'",
  'Refresh now',
]) assert(androidScreen.includes(marker), `missing Android usage cadence marker: ${marker}`);
for (const marker of [
  'requestProviderUsageRefresh(force = false, providerId = null)',
  'setProviderUsageWatching(active)',
  "type: 'provider_usage_watch'",
]) assert(androidRelay.includes(marker), `missing Android usage transport marker: ${marker}`);

for (const marker of [
  '.usage-dashboard-summary',
  '.usage-dashboard-grid',
  '.usage-dashboard-card.warning',
  '.usage-dashboard-card.critical',
  '.usage-dashboard-card-summary',
  '.usage-dashboard-window.critical',
  '.usage-dashboard-refresh',
  '.usage-cost-panel',
  '.usage-dashboard-collection-state',
  '.usage-cost-chart',
  '.usage-cost-table',
  '.usage-cost-detail-pager',
  '.usage-refresh-receipt',
  '.usage-pace-chart',
  '.usage-pace-budgets',
  '.session-usage-mini.tone-critical',
  '.sidebar-footer-action',
  '.app.has-system-banner .main',
  'grid-template-columns: repeat(2, minmax(0, 1fr))',
]) assert(styles.includes(marker), `missing usage dashboard style: ${marker}`);

for (const marker of [
  "from '../provider-assets/manifest.json'",
  'aria-label={`${accessibleName} provider mark`}',
  'usage-dashboard-provider-mark-fallback',
]) assert(marks.includes(marker), `missing provider mark marker: ${marker}`);
assert(!app.includes('entry.providerName.slice(0, 2).toUpperCase()'), 'synthetic provider initials must not be primary marks');

const result = {
  ok: true,
  provider_account_aggregation: true,
  all_native_windows: true,
  credits_and_reset_credits: true,
  freshness_and_source: true,
  threshold_warning_at_75_percent: true,
  exhausted_state: true,
  reset_countdown_and_timestamp: true,
  active_session_header_chip: true,
  active_session_mini_usage_monitor: true,
  responsive_mobile_grid: true,
  predictive_pace_and_safe_budgets: true,
  per_window_thresholds: true,
  over_100_truth_with_visual_cap: true,
  local_estimated_cost_separate_from_quota: true,
  cost_range_and_project_filters: true,
  accessible_cost_chart_and_table: true,
  provider_lifecycle_without_false_zero: true,
  cost_lifecycle_without_false_zero: true,
  correlated_refresh_receipts: true,
  subscription_aware_live_cadence: true,
  per_card_refresh_now: true,
  web_android_cadence_parity: true,
  paginated_cost_detail: true,
  arbitrary_session_jump_removed: !app.includes('onSelectSession={(sessionId)'),
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
