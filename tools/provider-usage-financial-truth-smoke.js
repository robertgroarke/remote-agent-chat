#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const providerUsage = require('../agent-proxy/provider-usage');

function loadFrontendProviderUsage() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'provider-usage.js'), 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js', format: 'cjs', target: 'es2020',
  }).code;
  const compiled = { exports: {} };
  new Function('module', 'exports', transformed)(compiled, compiled.exports);
  return compiled.exports;
}

const frontendUsage = loadFrontendProviderUsage();

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;
const fixtureRoot = path.join(__dirname, 'fixtures', 'provider-usage');
const claudeRaw = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'claude-pro-live-shape.json'), 'utf8'));
const cursorRaw = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'cursor-pro-live-shape.json'), 'utf8'));

const checks = [];
function check(id, pass, details = {}) {
  checks.push({ id, pass: pass === true, ...details });
}

const claudeWindows = providerUsage.claudeUsageWindows(claudeRaw, 'oauth_api');
check('schema_v3', providerUsage.SCHEMA_VERSION >= 3, {
  expected: '>=3', actual: providerUsage.SCHEMA_VERSION,
});
check('ollama_provider_registered', !!providerUsage.PROVIDERS.ollama, {
  expected: true, actual: !!providerUsage.PROVIDERS.ollama,
});
check('claude_fable_scoped_weekly', claudeWindows.some(window => (
  window.scope === 'Fable' && window.used_percent === 95
)), {
  expected: { scope: 'Fable', used_percent: 95 },
  actual: claudeWindows.map(window => ({ id: window.id, scope: window.scope, used_percent: window.used_percent })),
});
check('claude_financial_normalizer_exported', typeof providerUsage.normalizeClaudeFinancials === 'function', {
  expected: 'function', actual: typeof providerUsage.normalizeClaudeFinancials,
});
check('cursor_financial_normalizer_exported', typeof providerUsage.normalizeCursorFinancials === 'function', {
  expected: 'function', actual: typeof providerUsage.normalizeCursorFinancials,
});
check('canonical_provider_link_validator_exported', typeof providerUsage.validateProviderDashboardUrl === 'function', {
  expected: 'function', actual: typeof providerUsage.validateProviderDashboardUrl,
});
check('cursor_usage_url_source', providerUsage.PROVIDERS.cursor.dashboard_url === 'https://cursor.com/settings/usage', {
  expected: 'https://cursor.com/settings/usage', actual: providerUsage.PROVIDERS.cursor.dashboard_url,
});

if (typeof providerUsage.normalizeClaudeFinancials === 'function') {
  const actual = providerUsage.normalizeClaudeFinancials(claudeRaw, {
    observedAt: '2026-07-16T02:50:00.000Z', accountScope: 'Claude Pro', source: 'oauth_api',
  });
  check('claude_spend_not_prepaid_balance', actual?.prepaid_balance?.amount == null
    && actual?.extra_usage_spend?.amount === 0, { actual });
}
if (typeof providerUsage.normalizeCursorFinancials === 'function') {
  const actual = providerUsage.normalizeCursorFinancials(cursorRaw, {
    observedAt: '2026-07-16T02:50:00.000Z', accountScope: 'Cursor Pro', source: 'cursor_connect',
  });
  check('cursor_spend_not_available_balance', actual?.allowance_remaining?.amount == null
    && actual?.prepaid_balance?.amount == null
    && actual?.reported_spend?.amount === 110.63, { actual });
  check('cursor_money_reconciles_to_cent', Math.abs(
    (actual?.reported_spend?.amount || 0)
      - (actual?.included_spend?.amount || 0)
      - (actual?.bonus_spend?.amount || 0)
  ) < 0.005, { actual });
  const normalized = frontendUsage.normalizeProviderUsage({
    schema_version: 3,
    generation: 1,
    snapshots: [{
      provider_id: 'cursor', provider_name: 'Cursor', quota_domain: 'cursor-plan',
      account_fingerprint: `acct_${'a'.repeat(20)}`, account_label: 'Fixture account',
      status: 'fresh', windows: [], financials: actual,
    }],
  });
  const rows = frontendUsage.providerFinancialRows(normalized.entries[0]?.financials);
  check('cursor_ui_uses_financial_semantics', rows.some(row => (
    row.label === 'Provider-reported spend' && row.value === '$110.63'
  )) && rows.some(row => (
    row.label === 'Available allowance' && row.value === 'Not reported by provider'
  )) && !rows.some(row => row.label === 'Available prepaid balance'), { rows });
  check('legacy_cursor_spend_not_formatted_as_balance', frontendUsage.formatProviderCredits({
    used: 110.63, included: 20, bonus: 90.63, limit: 20, currency: 'USD',
  }) === '', {
    actual: frontendUsage.formatProviderCredits({
      used: 110.63, included: 20, bonus: 90.63, limit: 20, currency: 'USD',
    }),
  });
  check('null_credit_balance_never_becomes_zero', frontendUsage.formatProviderCredits({
    balance: null, currency: 'USD',
  }) === '', {
    actual: frontendUsage.formatProviderCredits({ balance: null, currency: 'USD' }),
  });
  const nullMoney = frontendUsage.normalizeProviderUsage({
    schema_version: 3, generation: 1, snapshots: [{
      provider_id: 'fixture', provider_name: 'Fixture', quota_domain: 'fixture',
      account_fingerprint: `acct_${'b'.repeat(20)}`, status: 'fresh', windows: [],
      financials: { semantics_version: 1, prepaid_balance: { amount: null, currency: 'USD' } },
    }],
  });
  check('null_money_never_becomes_zero', !frontendUsage.providerFinancialRows(
    nullMoney.entries[0]?.financials,
  ).some(row => row.value === '$0.00'), { rows: frontendUsage.providerFinancialRows(nullMoney.entries[0]?.financials) });
}
const ollamaUi = frontendUsage.normalizeProviderUsage({
  schema_version: 3, generation: 1, snapshots: [{
    provider_id: 'ollama-local', provider_name: 'Ollama', quota_domain: 'ollama-local-runtime',
    account_fingerprint: `acct_${'c'.repeat(20)}`, account_label: 'Loopback runtime',
    status: 'fresh', windows: [], local_runtime: {
      status: 'running', endpoint_scope: 'loopback_only', installed_models_count: 2,
      loaded_models_count: 1, loaded_models: [], telemetry_status: 'not_observed',
      telemetry_reason: 'Fixture historical request totals are unavailable.',
    },
  }],
});
check('ollama_ui_reports_fresh_runtime', ollamaUi.summary.reporting === 1
  && ollamaUi.entries[0]?.tone === 'ok'
  && ollamaUi.entries[0]?.localRuntime?.loadedModelsCount === 1, { actual: ollamaUi });
if (typeof providerUsage.validateProviderDashboardUrl === 'function') {
  check('cursor_usage_url_allowed', providerUsage.validateProviderDashboardUrl(
    'cursor', 'https://cursor.com/settings/usage',
  ) === 'https://cursor.com/settings/usage');
  for (const unsafe of [
    'https://cursor.com/dashboard/billing',
    'https://cursor.com/settings/usage#token=x',
    'https://user:pass@cursor.com/settings/usage',
    'javascript:alert(1)',
    'https://example.com/settings/usage',
  ]) {
    check(`cursor_url_reject_${Buffer.from(unsafe).toString('hex').slice(0, 12)}`,
      providerUsage.validateProviderDashboardUrl('cursor', unsafe) === null, { unsafe });
  }
}

const failed = checks.filter(item => !item.pass);
const result = {
  ok: failed.length === 0,
  phase: failed.length === 0 ? 'green' : 'red',
  generated_at: new Date().toISOString(),
  fixture_sources: [
    'claude-pro-live-shape.json',
    'cursor-pro-live-shape.json',
  ],
  checks,
  failed_check_ids: failed.map(item => item.id),
  secrets_or_account_identifiers_in_fixtures: 0,
  visible_windows_opened: 0,
  focus_actions: 0,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
if (!result.ok) process.exitCode = 1;
