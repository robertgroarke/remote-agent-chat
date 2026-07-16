#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  calculateUsagePace,
  enrichUsageWindow,
  thresholdsForWindow,
} = require('../agent-proxy/usage-pace');
const {
  claudeUsageWindows,
  normalizedWindow,
} = require('../agent-proxy/provider-usage');
const { usageThreshold } = require('../relay-server/usage-thresholds');

const WEEK_START = '2026-07-13T00:00:00.000Z';
const WEEK_RESET = '2026-07-20T00:00:00.000Z';
const MID_WEEK = Date.parse('2026-07-16T12:00:00.000Z');

function weeklyWindow(usedPercent, extra = {}) {
  return normalizedWindow({
    id: 'seven_day', label: 'All models weekly', usedPercent,
    durationMinutes: 10080, startsAt: WEEK_START, resetsAt: WEEK_RESET,
    windowKind: 'rolling', source: 'fixture', ...extra,
  });
}

function paceFixtures() {
  const zero = calculateUsagePace(weeklyWindow(0), MID_WEEK);
  assert.strictEqual(zero.category, 'slow');
  assert.strictEqual(zero.will_last_to_reset, true);

  const steady = calculateUsagePace(weeklyWindow(50), MID_WEEK);
  assert.strictEqual(steady.stage, 'on_track');
  assert.strictEqual(steady.category, 'steady');
  assert.strictEqual(steady.expected_used_percent, 50);
  assert.strictEqual(steady.projected_used_at_reset_percent, 100);
  assert.strictEqual(steady.will_last_to_reset, true);

  const racing = calculateUsagePace(weeklyWindow(58), MID_WEEK);
  assert.strictEqual(racing.stage, 'ahead');
  assert.strictEqual(racing.category, 'racing');
  assert.strictEqual(racing.will_last_to_reset, false);
  assert.strictEqual(racing.exhaustion_at, '2026-07-19T00:49:39.310Z');

  const burning = calculateUsagePace(weeklyWindow(80), MID_WEEK);
  assert.strictEqual(burning.stage, 'far_ahead');
  assert.strictEqual(burning.category, 'burning');
  assert.strictEqual(burning.projected_used_at_reset_percent, 160);
  const exhausted = enrichUsageWindow(weeklyWindow(100), { providerId: 'anthropic-claude', now: MID_WEEK });
  assert.strictEqual(exhausted.visual_percent, 100);
  assert.strictEqual(exhausted.pace.category, 'burning');

  const slow = calculateUsagePace(weeklyWindow(30), MID_WEEK);
  assert.strictEqual(slow.stage, 'far_behind');
  assert.strictEqual(slow.category, 'slow');
  assert.strictEqual(slow.will_last_to_reset, true);
  assert(slow.budget_percent.next_hour > slow.budget_percent.now);
  assert(slow.budget_percent.next_five_hours >= slow.budget_percent.next_hour);

  assert.strictEqual(calculateUsagePace(weeklyWindow(20, { resetsAt: '2026-07-16T11:59:59.000Z' }), MID_WEEK), null);
  assert.strictEqual(calculateUsagePace(normalizedWindow({ id: 'missing', label: 'Missing', usedPercent: 20 }), MID_WEEK), null);
  assert.strictEqual(calculateUsagePace(weeklyWindow(1, { startsAt: new Date(MID_WEEK).toISOString() }), MID_WEEK), null);

  const sparse = calculateUsagePace(weeklyWindow(1, {
    startsAt: new Date(MID_WEEK - 60_000).toISOString(),
    resetsAt: new Date(MID_WEEK + 10079 * 60_000).toISOString(),
  }), MID_WEEK);
  assert.strictEqual(sparse.category, 'burning');
  assert(sparse.projected_used_at_reset_percent > 1000);

  const dst = calculateUsagePace(normalizedWindow({
    id: 'dst-calendar', label: 'DST day', usedPercent: 50,
    startsAt: '2026-03-08T08:00:00.000Z', resetsAt: '2026-03-09T07:00:00.000Z',
    durationMinutes: 1440, windowKind: 'calendar',
  }), Date.parse('2026-03-08T19:30:00.000Z'));
  assert.strictEqual(dst.expected_used_percent, 50, 'explicit calendar endpoints must preserve the 23-hour DST day');
}

function exactPercentageAndThresholdFixtures() {
  const over = enrichUsageWindow(weeklyWindow(125), {
    providerId: 'anthropic-claude',
    thresholds: {
      default: { warning: 80, critical: 90 },
      'anthropic-claude': {
        warning: 75, critical: 88,
        windows: { seven_day: { warning: 70, critical: 85 } },
      },
    },
    now: MID_WEEK,
  });
  assert.strictEqual(over.used_percent, 125);
  assert.strictEqual(over.remaining_percent, -25);
  assert.strictEqual(over.visual_percent, 100);
  assert.deepStrictEqual(over.thresholds, { warning_percent: 70, critical_percent: 85 });
  assert.strictEqual(usageThreshold(72, false, over.thresholds), 70);
  assert.strictEqual(usageThreshold(87, false, over.thresholds), 85);
  assert.strictEqual(usageThreshold(125, true, over.thresholds), 100);
  assert.deepStrictEqual(thresholdsForWindow({}, 'openai-codex', 'primary'), {
    warning_percent: 80, critical_percent: 90,
  });
}

function claudeScopedFixtures() {
  const reset = '2026-07-20T00:00:00.000Z';
  const windows = claudeUsageWindows({
    five_hour: { utilization: 12.25, resets_at: '2026-07-15T04:00:00.000Z' },
    seven_day: { utilization: 34.5, resets_at: reset },
    scoped_weekly: [{
      kind: 'weekly_scoped', group: 'weekly', utilization: 56.75, resets_at: reset,
      scope: { model: { id: 'claude-fable-5', display_name: 'Fable' } },
    }],
  }, 'web_session_fixture');
  assert.deepStrictEqual(windows.map(window => window.label), [
    'Current session', 'All models weekly', 'Fable weekly',
  ]);
  assert.strictEqual(windows[2].model_scope.id, 'claude-fable-5');
  assert.strictEqual(windows[2].model_scope.label, 'Fable');
  assert.strictEqual(windows[2].used_percent, 56.75);
  assert.strictEqual(windows[2].source, 'web_session_fixture');
  assert.strictEqual(windows[1].used_percent, 34.5, 'model-scoped usage must not be merged into all-model usage');
}

paceFixtures();
exactPercentageAndThresholdFixtures();
claudeScopedFixtures();
const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  deterministic_clock_cases: ['rolling', 'calendar_dst', 'expired', 'missing_reset', 'sparse_early'],
  usage_cases: [0, 100, 125],
  pace_cases: ['slow', 'steady', 'racing', 'burning'],
  safe_budget_horizons: ['now', 'next_hour', 'next_five_hours', 'today'],
  per_provider_and_window_thresholds: true,
  claude_scoped_sources: ['web_shape', 'oauth_shape', 'cli_shape'],
  over_100_truth_visual_cap_only: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log('provider usage pace smoke: PASS');
