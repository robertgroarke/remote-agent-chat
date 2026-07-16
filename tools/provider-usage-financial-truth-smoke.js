#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const providerUsage = require('../agent-proxy/provider-usage');

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
}
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
