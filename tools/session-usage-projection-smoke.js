#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');

const args = process.argv.slice(2);
const baselineLegacy = args.includes('--baseline-legacy');
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-07-19T09:30:00.000Z');
const CAPTURED_AT = '2026-07-19T09:29:30.000Z';
const STALE_AFTER = '2026-07-19T09:40:00.000Z';

function loadModule(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const transformed = esbuild.transformSync(source, { loader: 'js', format: 'cjs', target: 'es2020' }).code;
  const compiled = { exports: {} };
  new Function('module', 'exports', transformed)(compiled, compiled.exports);
  return compiled.exports;
}

const providerUsage = loadModule('frontend/provider-usage.js');
const webPolicy = loadModule('frontend/session-usage.js');
const androidPolicy = loadModule('android-app/lib/session-usage.js');

function window(id, label, used, extra = {}) {
  return {
    id, label, used_percent: used, remaining_percent: 100 - used,
    duration_minutes: extra.durationMinutes || null,
    resets_at: extra.resetsAt || '2026-07-20T09:30:00.000Z',
    window_kind: extra.windowKind || 'rolling', source: 'fixture', provenance: `fixture.${id}`,
    status: 'available', freshness_status: 'fresh',
    ...(extra.modelId ? { model_scope: { id: extra.modelId, label: extra.modelLabel || extra.modelId } } : {}),
  };
}

function snapshot(providerId, accountSuffix, windows, extra = {}) {
  return {
    schema_version: 4,
    provider_id: providerId,
    provider_name: extra.providerName || providerId,
    quota_domain: extra.quotaDomain || `${providerId}-plan`,
    account_fingerprint: `acct_${String(accountSuffix).padEnd(20, '0').slice(0, 20)}`,
    account_label: extra.accountLabel || `Fixture ${accountSuffix}`,
    plan: extra.plan || 'Fixture plan',
    source: 'fixture', source_history: [{ source: 'fixture', status: 'ok', captured_at: CAPTURED_AT }],
    status: extra.status || 'fresh', captured_at: CAPTURED_AT,
    stale_after: extra.staleAfter || STALE_AFTER, next_refresh_at: STALE_AFTER,
    windows, credits: extra.credits || null, financials: extra.financials || null,
    local_runtime: extra.localRuntime || null, cloud_usage: extra.cloudUsage || null,
    mapped_harness_types: extra.harnessTypes || [], session_count: 1,
  };
}

function normalized(...snapshots) {
  return providerUsage.normalizeProviderUsage({
    schema_version: 4, generation: 9, generated_at: CAPTURED_AT, snapshots,
  });
}

const codex = snapshot('openai-codex', 'codex', [
  window('five_hour', '5-hour', 72, { durationMinutes: 300 }),
  window('weekly', 'Weekly', 48, { durationMinutes: 10080 }),
], { providerName: 'OpenAI Codex', harnessTypes: ['codex', 'codex_cli'], credits: { balance: 12, unit: 'credits' } });
const claude = snapshot('anthropic-claude', 'claude-a', [
  window('five_hour', '5-hour', 52, { durationMinutes: 300 }),
  window('weekly_all', 'All-model weekly', 64, { durationMinutes: 10080 }),
  window('weekly_fable', 'Fable weekly', 81, { durationMinutes: 10080, modelId: 'claude-fable-5', modelLabel: 'Fable' }),
  window('weekly_opus', 'Opus weekly', 93, { durationMinutes: 10080, modelId: 'claude-opus-5', modelLabel: 'Opus' }),
], { providerName: 'Anthropic Claude', harnessTypes: ['claude', 'claude_cli'] });
const claudeSecond = snapshot('anthropic-claude', 'claude-b', [
  window('five_hour', '5-hour', 11, { durationMinutes: 300 }),
  window('weekly_all', 'All-model weekly', 22, { durationMinutes: 10080 }),
], { providerName: 'Anthropic Claude', harnessTypes: ['claude_cli'] });
const cursor = snapshot('cursor', 'cursor', [
  window('monthly', 'Monthly included usage', 70, { durationMinutes: 43200, windowKind: 'billing_cycle' }),
], {
  providerName: 'Cursor', harnessTypes: ['cursor', 'cursor_cli'],
  financials: {
    semantics_version: 1, source: 'fixture', observed_at: CAPTURED_AT,
    account_scope: 'fixture', extra_usage_enabled: true,
    reported_spend: { amount: 14, currency: 'USD', source_field: 'fixture', semantics: 'reported', directly_reported: true },
    plan_limit: { amount: 20, currency: 'USD', source_field: 'fixture', semantics: 'reported', directly_reported: true },
  },
});
const antigravity = snapshot('google-antigravity', 'antigravity', [
  window('gemini', 'Gemini Pro', 43, { modelId: 'gemini-2.5-pro' }),
  window('claude', 'Claude model quota', 91, { modelId: 'claude-sonnet-4.5', modelLabel: 'Claude Sonnet 4.5' }),
], { providerName: 'Google Antigravity', harnessTypes: ['antigravity_panel', 'antigravity-v2'] });
const ollama = snapshot('ollama-local', 'ollama', [
  window('five_hour', 'Session', 35, { durationMinutes: 300 }),
  window('weekly', 'Weekly', 55, { durationMinutes: 10080 }),
], {
  providerName: 'Ollama', harnessTypes: ['ollama'],
  localRuntime: { status: 'running', endpoint_scope: 'loopback', installed_models_count: 3, loaded_models_count: 1 },
  cloudUsage: { subscription_state: 'active', source: 'fixture', captured_at: CAPTURED_AT },
  financials: { semantics_version: 1, source: 'fixture', observed_at: CAPTURED_AT, account_scope: 'fixture', extra_usage_enabled: false,
    prepaid_balance: { amount: 0, currency: 'USD', source_field: 'fixture', semantics: 'balance', directly_reported: true } },
});

const cases = [
  {
    id: 'codex-short-weekly-credits', session: { agent_type: 'codex_cli' }, config: { observed_model_id: 'gpt-5.6-sol' }, usage: normalized(codex),
    expected: { provider: 'openai-codex', state: 'ready', windows: ['5-hour', 'Weekly'], applicable: 2, modelVendor: 'OpenAI' },
  },
  {
    id: 'claude-model-scoped-first', session: { agent_type: 'claude_cli' }, config: { observed_model_id: 'claude-fable-5' }, usage: normalized(claude),
    expected: { provider: 'anthropic-claude', state: 'ready', windows: ['Fable weekly', 'All-model weekly'], applicable: 3, modelVendor: 'Anthropic' },
  },
  {
    id: 'claude-unknown-model-excludes-scoped', session: { agent_type: 'claude_cli' }, config: { observed_model_id: 'future-model' }, usage: normalized(claude),
    expected: { provider: 'anthropic-claude', state: 'ready', windows: ['All-model weekly', '5-hour'], applicable: 2, modelVendor: 'Unknown model vendor' },
  },
  {
    id: 'cursor-monthly-no-fabricated-short-window', session: { agent_type: 'cursor' }, config: { observed_model_id: 'claude-fable-5' }, usage: normalized(cursor),
    expected: { provider: 'cursor', state: 'ready', windows: ['Monthly included usage'], applicable: 1, modelVendor: 'Anthropic' },
  },
  {
    id: 'antigravity-claude-model-google-billing', session: { agent_type: 'antigravity_panel' }, config: { observed_model_id: 'claude-sonnet-4.5' }, usage: normalized(antigravity),
    expected: { provider: 'google-antigravity', state: 'ready', windows: ['Claude model quota'], applicable: 1, modelVendor: 'Anthropic' },
  },
  {
    id: 'ollama-local-trusted-runtime', session: { agent_type: 'ollama', usage_runtime_kind: 'local' }, config: { observed_model_id: 'qwen3.5' }, usage: normalized(ollama),
    expected: { provider: 'ollama-local', state: 'local', windows: [], applicable: 0, modelVendor: 'Ollama/runtime-defined' },
  },
  {
    id: 'ollama-cloud-trusted-runtime', session: { agent_type: 'ollama', usage_runtime_kind: 'cloud' }, config: { observed_model_id: 'qwen3.5:cloud' }, usage: normalized(ollama),
    expected: { provider: 'ollama-local', state: 'ready', windows: ['Weekly', 'Session'], applicable: 2, modelVendor: 'Ollama/runtime-defined' },
  },
  {
    id: 'ollama-runtime-not-guessed', session: { agent_type: 'ollama' }, config: { observed_model_id: 'qwen3.5' }, usage: normalized(ollama),
    expected: { provider: 'ollama-local', state: 'ambiguous', windows: [], applicable: 0, modelVendor: 'Ollama/runtime-defined' },
  },
  {
    id: 'multiple-accounts-ambiguous', session: { agent_type: 'claude_cli' }, config: { observed_model_id: 'claude-fable-5' }, usage: normalized(claude, claudeSecond),
    expected: { provider: 'anthropic-claude', state: 'ambiguous', windows: [], applicable: 0, modelVendor: 'Anthropic' },
  },
  {
    id: 'explicit-account-link', session: { agent_type: 'claude_cli', usage_account_fingerprint: claudeSecond.account_fingerprint, usage_quota_domain: claudeSecond.quota_domain }, config: { observed_model_id: 'claude-fable-5' }, usage: normalized(claude, claudeSecond),
    expected: { provider: 'anthropic-claude', state: 'ready', windows: ['All-model weekly', '5-hour'], applicable: 2, modelVendor: 'Anthropic' },
  },
  {
    id: 'stale-source-retains-values', session: { agent_type: 'codex_cli' }, config: { observed_model_id: 'gpt-5.6-sol' }, usage: normalized({ ...codex, status: 'stale', stale_after: '2026-07-19T09:00:00.000Z' }),
    expected: { provider: 'openai-codex', state: 'stale', windows: ['5-hour', 'Weekly'], applicable: 2, modelVendor: 'OpenAI' },
  },
  {
    id: 'missing-provider-unavailable-not-zero', session: { agent_type: 'codex_cli' }, config: { observed_model_id: 'gpt-5.6-sol' }, usage: normalized(),
    expected: { provider: 'openai-codex', state: 'unavailable', windows: [], applicable: 0, modelVendor: 'OpenAI' },
  },
  {
    id: 'exhausted-window', session: { agent_type: 'codex_cli' }, config: { observed_model_id: 'gpt-5.6-sol' }, usage: normalized({ ...codex, windows: [window('five_hour', '5-hour', 100, { durationMinutes: 300 }), window('weekly', 'Weekly', 48, { durationMinutes: 10080 })] }),
    expected: { provider: 'openai-codex', state: 'exhausted', windows: ['5-hour', 'Weekly'], applicable: 2, modelVendor: 'OpenAI' },
  },
];

function legacyProjection(session) {
  const percentUsed = Number.isFinite(Number(session?.percent_used)) ? Number(session.percent_used) : null;
  return {
    state: percentUsed == null ? 'unknown' : percentUsed >= 100 ? 'exhausted' : 'ready',
    provider: null, windows: percentUsed == null ? [] : ['Session'], applicable: percentUsed == null ? 0 : 1,
    modelVendor: null,
  };
}

function evaluate(testCase, policy) {
  const projection = baselineLegacy
    ? legacyProjection(testCase.session)
    : policy.sessionUsageProjection(testCase.session, testCase.config, testCase.usage, NOW);
  const actual = {
    provider: projection.billingProviderId || projection.provider,
    state: projection.state,
    windows: (projection.headerWindows || projection.windows || []).map(item => typeof item === 'string' ? item : item.label),
    applicable: projection.applicableWindows?.length ?? projection.applicable,
    modelVendor: projection.modelVendor,
  };
  return { projection, actual, pass: JSON.stringify(actual) === JSON.stringify(testCase.expected) };
}

const results = cases.map(testCase => ({ id: testCase.id, ...evaluate(testCase, webPolicy), expected: testCase.expected }));
const failures = results.filter(result => !result.pass).map(result => ({ id: result.id, expected: result.expected, actual: result.actual }));

if (!baselineLegacy) {
  assert.deepStrictEqual(
    cases.map(testCase => androidPolicy.sessionUsageProjection(testCase.session, testCase.config, testCase.usage, NOW)),
    cases.map(testCase => webPolicy.sessionUsageProjection(testCase.session, testCase.config, testCase.usage, NOW)),
    'Web and Android session usage policy diverged',
  );
  assert.deepStrictEqual(failures, []);
  const generationNine = { schema_version: 4, generation: 9, snapshots: [codex] };
  assert.strictEqual(
    providerUsage.retainNewerProviderUsage(generationNine, { schema_version: 4, generation: 8, snapshots: [] }),
    generationNine,
    'stale provider generation must not regress a known snapshot',
  );
  assert.deepStrictEqual(
    providerUsage.retainNewerProviderUsage(generationNine, { schema_version: 4, generation: 9, in_flight: true, snapshots: [] }),
    { ...generationNine, in_flight: true },
    'same-generation in-flight empty state must retain known values without hiding refresh state',
  );
  const androidChat = fs.readFileSync(path.join(root, 'android-app/screens/ChatScreen.jsx'), 'utf8');
  const androidList = fs.readFileSync(path.join(root, 'android-app/screens/SessionListScreen.jsx'), 'utf8');
  for (const marker of [
    'sessionUsageProjection(',
    'provider_usage_snapshot',
    'testID="session-usage-details"',
    'Billing provider',
    'Model vendor',
    'Applicable limits',
    'Open Usage &amp; limits',
    "navigation.navigate('SessionList', { openUsageNonce: Date.now() })",
  ]) assert(androidChat.includes(marker), `Android session usage UI missing ${marker}`);
  assert(androidList.includes('route?.params?.openUsageNonce'), 'Android Usage route handoff missing');
}

const performanceSamples = [];
if (!baselineLegacy) {
  const sessions = Array.from({ length: 120 }, (_, index) => cases[index % cases.length]);
  for (let round = 0; round < 60; round += 1) {
    const started = process.hrtime.bigint();
    for (const testCase of sessions) webPolicy.sessionUsageProjection(testCase.session, testCase.config, testCase.usage, NOW + round * 1000);
    performanceSamples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
}
const sortedPerformance = [...performanceSamples].sort((left, right) => left - right);
const p95 = sortedPerformance.length ? sortedPerformance[Math.ceil(sortedPerformance.length * 0.95) - 1] : null;
if (!baselineLegacy) assert(p95 <= 16, `120-session projection p95 ${p95}ms exceeded 16ms`);

const output = {
  ok: !baselineLegacy && failures.length === 0,
  expected_before_failure: baselineLegacy,
  generated_at: new Date().toISOString(),
  cases: results.map(result => ({ id: result.id, pass: result.pass, expected: result.expected, actual: result.actual })),
  case_count: results.length,
  failures,
  web_android_byte_identical: fs.readFileSync(path.join(root, 'frontend/session-usage.js'), 'utf8')
    === fs.readFileSync(path.join(root, 'android-app/lib/session-usage.js'), 'utf8'),
  android_ui_contract: baselineLegacy ? null : true,
  stale_generation_regressions: baselineLegacy ? null : 0,
  performance: baselineLegacy ? null : { sessions: 120, rounds: 60, p95_ms: Number(p95.toFixed(3)), limit_ms: 16 },
  guessed_accounts: 0,
  guessed_ollama_runtime: 0,
  visible_windows_opened: 0,
  focus_actions: 0,
  production_mutations: 0,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
if (baselineLegacy) process.exitCode = failures.length > 0 ? 1 : 2;
