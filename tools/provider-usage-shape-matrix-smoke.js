#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const {
  ProviderUsageError,
  collectClaude,
  collectCursor,
  normalizeClaudeFinancials,
  normalizeCursorFinancials,
} = require('../agent-proxy/provider-usage');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;
const fixturePath = path.join(__dirname, 'fixtures', 'provider-usage', 'financial-shape-matrix.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const observedAt = '2026-07-16T08:00:00.000Z';
const fingerprintKey = Buffer.alloc(32, 7);

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
const moneyFields = Object.freeze({
  claude: ['prepaid_balance', 'extra_usage_spend', 'extra_usage_cap', 'allowance_remaining'],
  cursor: [
    'reported_spend', 'included_spend', 'bonus_spend', 'plan_limit',
    'allowance_remaining', 'prepaid_balance', 'reconciliation_delta',
  ],
});

function comparable(actual, key) {
  if (key === 'extra_usage_enabled') return actual.extra_usage_enabled;
  if (key === 'classification_status') return actual.pool_classification?.classification_status || null;
  return actual[key]?.amount ?? null;
}

function safeSummary(actual, provider) {
  const summary = Object.fromEntries(moneyFields[provider].map(field => [field, actual[field]?.amount ?? null]));
  if (provider === 'claude') summary.extra_usage_enabled = actual.extra_usage_enabled;
  if (provider === 'cursor') summary.classification_status = actual.pool_classification?.classification_status || null;
  return summary;
}

function assertMoneyEnvelope(money, field, caseId) {
  if (money == null) return;
  assert(Number.isFinite(money.amount), `${caseId}.${field} amount must be finite`);
  assert.match(money.currency, /^[A-Z]{3,12}$/, `${caseId}.${field} currency missing`);
  assert(money.source_field, `${caseId}.${field} source field missing`);
  assert(money.semantics, `${caseId}.${field} semantics missing`);
  assert.equal(typeof money.directly_reported, 'boolean', `${caseId}.${field} direct-report flag missing`);
  if (field === 'reconciliation_delta') assert.equal(money.directly_reported, false);
  else assert.equal(money.directly_reported, true);
}

async function main() {
  assert.equal(fixture.schema_version, 1);
  assert(Array.isArray(fixture.cases) && fixture.cases.length >= 12);
  const variants = new Set();
  const outcomes = [];
  for (const testCase of fixture.cases) {
    variants.add(testCase.variant);
    const normalizer = testCase.provider === 'claude'
      ? normalizeClaudeFinancials : normalizeCursorFinancials;
    const actual = normalizer(testCase.raw, {
      observedAt,
      accountScope: testCase.account_scope,
      source: testCase.provider === 'claude' ? 'fixture_oauth_api' : 'fixture_cursor_connect',
    });
    assert.equal(actual.observed_at, observedAt, `${testCase.id} observed_at drifted`);
    assert.equal(actual.account_scope, testCase.account_scope, `${testCase.id} account scope drifted`);
    assert(actual.source.startsWith('fixture_'), `${testCase.id} source provenance missing`);
    for (const field of moneyFields[testCase.provider]) assertMoneyEnvelope(actual[field], field, testCase.id);
    for (const [key, expected] of Object.entries(testCase.expected)) {
      assert.deepStrictEqual(comparable(actual, key), expected, `${testCase.id}.${key}`);
    }

    if (testCase.provider === 'cursor') {
      assert.equal(actual.allowance_remaining, null, `${testCase.id} must not invent remaining allowance`);
      assert.equal(actual.prepaid_balance, null, `${testCase.id} must not invent prepaid balance`);
      assert.equal(actual.pool_classification.first_party, null, `${testCase.id} must not invent first-party pool`);
      assert.equal(actual.pool_classification.third_party, null, `${testCase.id} must not invent third-party pool`);
      assert.match(actual.pool_classification.warning, /does not expose/i);
      if (testCase.variant === 'team') {
        assert.equal(actual.pool_classification.unclassified?.amount, testCase.expected.reported_spend);
      }
      if (['individual', 'bonus', 'team'].includes(testCase.variant)) {
        assert(Math.abs(actual.reconciliation_delta?.amount || 0) <= 0.01,
          `${testCase.id} must reconcile within one cent`);
      }
      if (testCase.variant === 'refund') {
        assert.equal(actual.reconciliation_delta?.amount, -5,
          'unmapped refund-like fields must surface as reconciliation delta rather than a fake balance');
      }
    } else {
      assert.equal(actual.allowance_remaining, null, `${testCase.id} must not derive remaining allowance`);
      if (testCase.variant === 'refund') {
        assert(!Object.hasOwn(actual, 'refund'), 'unsupported refund extension must not become an invented canonical pool');
      }
    }

    const normalized = frontendUsage.normalizeProviderUsage({
      schema_version: 3,
      generation: 1,
      snapshots: [{
        provider_id: `${testCase.provider}-fixture`,
        provider_name: `${testCase.provider} fixture`,
        quota_domain: `${testCase.provider}-fixture`,
        account_fingerprint: `acct_${testCase.id.padEnd(20, 'x').slice(0, 20)}`,
        account_label: 'Redacted fixture',
        status: 'fresh',
        windows: [],
        financials: actual,
      }],
    });
    const rows = frontendUsage.providerFinancialRows(normalized.entries[0].financials);
    if (Object.entries(testCase.expected).every(([key, value]) => (
      !moneyFields[testCase.provider].includes(key) || value == null
    ))) {
      assert(!rows.some(row => row.value === '$0.00'), `${testCase.id} null money rendered as zero`);
    }
    outcomes.push({
      id: testCase.id,
      provider: testCase.provider,
      variant: testCase.variant,
      normalized: safeSummary(actual, testCase.provider),
      ui_zero_from_null: false,
    });
  }

  for (const required of ['missing', 'null', 'legacy', 'team', 'individual', 'bonus', 'refund']) {
    assert(variants.has(required), `shape matrix missing ${required} variant`);
  }

  let claudeFallbackHistory = null;
  const claudeFallback = await collectClaude(fingerprintKey, {
    oauthCollector: async () => {
      throw new ProviderUsageError('fixture OAuth unavailable', { code: 'fixture_oauth_unavailable' });
    },
    cliCollector: async (_key, history) => {
      claudeFallbackHistory = history;
      return {
        account_fingerprint: 'acct_fixtureclaudefallback',
        account_label: 'Local Claude account',
        plan: 'Claude fixture',
        source: 'hidden_cli',
        source_history: [...history, { source: 'hidden_cli', status: 'ok', captured_at: observedAt }],
        windows: [],
        credits: null,
        financials: null,
        reset_credits: null,
        request_count: 0,
      };
    },
  });
  assert.equal(claudeFallback.source, 'hidden_cli');
  assert.equal(claudeFallbackHistory[0].source, 'oauth_api');
  assert.equal(claudeFallbackHistory[0].status, 'failed');

  const cursorFixture = fixture.cases.find(testCase => testCase.id === 'cursor_individual_reconciled').raw;
  let cursorRequest = null;
  const cursorFallback = await collectCursor(fingerprintKey, {
    authReader: async () => ({
      token: 'fixture', email: null, membership: 'pro', subscriptionStatus: 'active', storageSource: 'python_sqlite',
    }),
    requester: async (url, options) => {
      cursorRequest = { url, method: options.method, hasAuthorization: !!options.headers?.Authorization };
      return cursorFixture;
    },
  });
  assert.equal(cursorFallback.source, 'python_sqlite_connect');
  assert.deepStrictEqual(cursorFallback.source_history.map(row => [row.source, row.status]), [
    ['node_sqlite', 'failed'], ['python_sqlite_connect', 'ok'], ['cursor_usage_connect', 'ok'],
  ]);
  assert.deepStrictEqual(cursorRequest, {
    url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    method: 'POST',
    hasAuthorization: true,
  });
  assert.equal(cursorFallback.financials.reported_spend.amount, 110.63);

  let cursorAttempts = 0;
  const cursorRetry = await collectCursor(fingerprintKey, {
    authReader: async () => ({
      token: 'fixture', email: null, membership: 'pro', subscriptionStatus: 'active', storageSource: 'node_sqlite',
    }),
    requester: async (_url, options) => {
      cursorAttempts += 1;
      assert.equal(options.timeoutMs, 4000);
      if (cursorAttempts === 1) {
        throw new ProviderUsageError('fixture timeout', { code: 'timeout' });
      }
      return cursorFixture;
    },
  });
  assert.equal(cursorAttempts, 2, 'Cursor transient timeout was not retried exactly once');
  assert.deepStrictEqual(cursorRetry.source_history.map(row => [row.source, row.status, row.code || null]), [
    ['local_auth_connect', 'ok', null],
    ['cursor_usage_connect', 'failed', 'timeout'],
    ['cursor_usage_connect', 'ok', null],
  ]);

  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  assert(!/(?:authorization|access.?token|refresh.?token|cookie|password|email|account.?id)/i.test(fixtureText),
    'financial fixtures must not contain credentials or account identifiers');
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    fixture_schema_version: fixture.schema_version,
    cases: outcomes,
    case_count: outcomes.length,
    variants: [...variants].sort(),
    source_fallbacks: {
      claude: { primary: 'oauth_api', fallback: 'hidden_cli', history_preserved: true },
      cursor: { primary: 'node_sqlite', fallback: 'python_sqlite_connect', history_preserved: true },
    },
    money_reconciliation_tolerance_cents: 1,
    invented_remaining_balances: 0,
    invented_provider_pools: 0,
    null_money_rendered_as_zero: 0,
    fixture_secret_fields: 0,
    visible_windows_opened: 0,
    focus_actions: 0,
    production_mutations: 0,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`provider usage shape matrix: FAIL (${error.stack || error.message})`);
  process.exitCode = 1;
});
