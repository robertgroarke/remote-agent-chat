#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  compareAntigravityReference,
  compareProviderReference,
  parseArgs,
  summarizeProviderUsage,
} = require('./operator-dogfood-production-passive-e2e');

const parsed = parseArgs([
  '--read-only-production', '--env-root', '.', '--source-root', '.', '--output', 'fixture.json',
  '--refresh-provider-usage',
]);
assert.strictEqual(parsed.refreshProviderUsage, true);

const capturedAt = '2026-07-17T09:30:00.000Z';
const money = (amount, semantics) => ({
  amount,
  currency: 'USD',
  source_field: semantics,
  semantics,
  directly_reported: true,
});
const snapshot = summarizeProviderUsage({
  schema_version: 3,
  generation: 1,
  generated_at: capturedAt,
  snapshots: [
    {
      provider_id: 'anthropic-claude',
      status: 'fresh',
      source: 'oauth_api',
      captured_at: capturedAt,
      windows: [{
        id: 'seven_day', label: 'All models weekly', used_percent: 12,
        remaining_percent: 88, resets_at: '2026-07-18T08:00:00.000Z',
      }],
      financials: {
        semantics_version: 1,
        source: 'oauth_api',
        prepaid_balance: null,
        extra_usage_spend: money(0, 'extra_usage_spend'),
        extra_usage_cap: null,
        allowance_remaining: null,
      },
    },
    {
      provider_id: 'cursor',
      status: 'fresh',
      source: 'local_auth_connect',
      captured_at: capturedAt,
      windows: [{ id: 'plan', label: 'Plan', used_percent: 32.07, remaining_percent: 67.93 }],
      financials: {
        semantics_version: 1,
        source: 'cursor_connect',
        reported_spend: money(110.63, 'reported_spend'),
        included_spend: money(20, 'included_spend'),
        bonus_spend: money(90.63, 'bonus_spend'),
        plan_limit: money(20, 'reported_plan_limit'),
        allowance_remaining: null,
        prepaid_balance: null,
        reconciliation_delta: money(0, 'reconciliation_delta'),
        pool_classification: {
          classification_status: 'unavailable',
          first_party: null,
          third_party: null,
          unclassified: money(110.63, 'reported_spend'),
        },
      },
    },
    {
      provider_id: 'google-antigravity',
      status: 'fresh',
      source: 'local_settings',
      captured_at: capturedAt,
      windows: [
        {
          id: 'model-1', label: 'Gemini Models · Weekly Limit', used_percent: 10,
          remaining_percent: 90, reset_description: '1 day, 8 hours',
        },
        {
          id: 'model-2', label: 'Gemini Models · Five Hour Limit', used_percent: 0,
          remaining_percent: 100, reset_description: null,
        },
      ],
      credits: { enabled: true, balance: 0, unit: 'AI credits' },
    },
  ],
});

const providerReference = {
  providers: [
    {
      provider: 'anthropic-claude', status: 'ok', source: 'oauth_api',
      windows: [{
        id: 'seven_day', label: 'All models weekly', used_percent: 12,
        remaining_percent: 88, resets_at: '2026-07-18T08:00:00.000Z',
      }],
      financials: snapshot.providers.find(item => item.provider_id === 'anthropic-claude').financials,
    },
    {
      provider: 'cursor', status: 'ok', source: 'local_auth_connect',
      windows: [{ id: 'plan', label: 'Plan', used_percent: 32.07, remaining_percent: 67.93 }],
      financials: snapshot.providers.find(item => item.provider_id === 'cursor').financials,
    },
  ],
};
const providerComparisons = compareProviderReference(snapshot, providerReference);
assert.strictEqual(providerComparisons.length, 2);
assert(providerComparisons.every(item => item.financials?.fields.every(field =>
  field.both_unreported || field.amount_delta === 0)));

const antigravityReference = {
  snapshot: {
    fetched_at: '2026-07-17T09:30:20.000Z',
    available_ai_credits: 0,
    models: [
      {
        model: 'Gemini Models · Weekly Limit', percent_used: 10,
        percent_remaining: 90, refreshes_in: '1 day, 8 hours',
      },
      {
        model: 'Gemini Models · Five Hour Limit', percent_used: 0,
        percent_remaining: 100, refreshes_in: null,
      },
    ],
  },
};
const antigravityComparison = compareAntigravityReference(snapshot, antigravityReference);
assert.strictEqual(antigravityComparison.credit_delta, 0);
assert.strictEqual(antigravityComparison.lanes.length, 2);

const badReference = JSON.parse(JSON.stringify(providerReference));
badReference.providers[1].financials.reported_spend.amount += 0.02;
assert.throws(() => compareProviderReference(snapshot, badReference), /exceeded \$0\.01/);
const badAntigravity = JSON.parse(JSON.stringify(antigravityReference));
badAntigravity.snapshot.models[0].percent_used = 12;
assert.throws(() => compareAntigravityReference(snapshot, badAntigravity), /exceeded 1pp/);

console.log(JSON.stringify({
  ok: true,
  provider_comparisons: providerComparisons.length,
  financial_tolerance_usd: 0.01,
  quota_tolerance_percentage_points: 1,
  reset_tolerance_seconds: 60,
  antigravity_lanes: antigravityComparison.lanes.length,
  mismatch_rejections: 2,
}, null, 2));
