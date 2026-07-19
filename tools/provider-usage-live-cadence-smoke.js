#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PROVIDER_CADENCE,
  ProviderUsageError,
  ProviderUsageRegistry,
  accountFingerprint,
  normalizedWindow,
} = require('../agent-proxy/provider-usage');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;
const KEY = 'provider-usage-live-cadence-fixture-key';
const PROVIDER_IDS = {
  codex: 'openai-codex',
  claude: 'anthropic-claude',
  antigravity: 'google-antigravity',
  cursor: 'cursor',
  ollama: 'ollama-local',
};

async function main() {
  let now = Date.parse('2026-07-19T12:00:00.000Z');
  let randomIndex = 0;
  let failingProvider = null;
  const callTimes = Object.fromEntries(Object.keys(PROVIDER_IDS).map(key => [key, []]));
  const collectors = Object.fromEntries(Object.keys(PROVIDER_IDS).map(key => [key, async context => {
    callTimes[key].push(now);
    if (failingProvider === key) {
      throw new ProviderUsageError(`${key} fixture unavailable`, { code: 'forced_fixture_failure' });
    }
    return {
      account_fingerprint: accountFingerprint(`${key}-live-cadence`, KEY),
      account_label: `${key} fixture account`,
      plan: 'fixture plan',
      source: key === 'claude' ? 'oauth_api_fixture'
        : key === 'ollama' ? 'loopback_and_read_only_9240_fixture'
          : `${key}_fixture`,
      source_history: [],
      captured_at: new Date(now).toISOString(),
      windows: [normalizedWindow({
        id: 'primary', label: 'Primary', usedPercent: 25,
        durationMinutes: 300, resetsAt: now + 3_600_000,
      })],
      credits: null,
      reset_credits: null,
      request_count: key === 'claude' ? (context.allow_guarded ? 2 : 1) : 1,
    };
  }]));
  const agentTypes = ['codex_cli', 'claude_cli', 'antigravity_panel', 'cursor', 'ollama'];
  const sessions = agentTypes.map((agentType, index) => ({ sessionId: `cadence-${index}`, agentType }));
  const emitted = [];
  const registry = new ProviderUsageRegistry({
    getSessions: () => sessions,
    collectors,
    fingerprintKey: KEY,
    now: () => now,
    random: () => [0.25, 0.75][randomIndex++ % 2],
    onSnapshot: snapshot => emitted.push(snapshot),
  });

  await registry.refresh({ force: true, reason: 'startup_fixture', waitForCost: false });
  await registry.setWatching(true);
  const samples = [];
  const jitterOffsets = [];
  const wallStarted = process.hrtime.bigint();
  const cpuStarted = process.cpuUsage();
  for (let step = 1; step <= 40; step += 1) {
    now += 15_000;
    await registry.refresh({ reason: 'ten_minute_usage_view_fixture', waitForCost: false });
    const snapshot = registry.snapshot();
    assert.strictEqual(snapshot.cadence_mode, 'watching');
    assert.strictEqual(snapshot.snapshots.length, 5);
    for (const account of snapshot.snapshots) {
      const key = Object.entries(PROVIDER_IDS).find(([, id]) => id === account.provider_id)?.[0];
      assert(key, `unexpected provider ${account.provider_id}`);
      const cadence = DEFAULT_PROVIDER_CADENCE[key];
      const ageMs = now - Date.parse(account.captured_at);
      assert.strictEqual(account.refresh_interval_ms, cadence.fast_ms);
      assert.strictEqual(account.next_refresh_at != null, true);
      assert(Date.parse(account.next_refresh_at) > now, `${key} next refresh must be in the future`);
      if (cadence.fast_ms <= 90_000) {
        assert(ageMs <= cadence.fast_ms * 2,
          `${key} capture age ${ageMs} exceeded twice its ${cadence.fast_ms}ms live cadence`);
      }
      if (step % 4 === 0) samples.push({
        minute: step / 4,
        provider: key,
        age_ms: ageMs,
        refresh_interval_ms: account.refresh_interval_ms,
        next_refresh_at: account.next_refresh_at,
        status: account.status,
      });
      const interval = account.refresh_interval_ms;
      const baseAnchor = (Math.floor(now / interval) + 1) * interval;
      const offset = Date.parse(account.next_refresh_at) - baseAnchor;
      if (Math.abs(offset) <= interval * 0.081) jitterOffsets.push(offset);
    }
  }
  const wallElapsedMs = Number(process.hrtime.bigint() - wallStarted) / 1e6;
  const cpuElapsed = process.cpuUsage(cpuStarted);
  const cpuElapsedMs = (cpuElapsed.user + cpuElapsed.system) / 1000;
  const baselineCpuStarted = process.cpuUsage();
  for (let index = 0; index < 40; index += 1) registry.snapshot();
  const baselineCpu = process.cpuUsage(baselineCpuStarted);
  const baselineCpuMs = (baselineCpu.user + baselineCpu.system) / 1000;
  const cadenceCpuDeltaMs = Math.max(0, cpuElapsedMs - baselineCpuMs);
  const normalizedOneCorePercent = (cadenceCpuDeltaMs / 600_000) * 100;
  assert(wallElapsedMs < 1_000, `cadence simulation wall overhead ${wallElapsedMs.toFixed(2)}ms exceeded budget`);
  assert(cpuElapsedMs < 1_000, `cadence simulation CPU overhead ${cpuElapsedMs.toFixed(2)}ms exceeded budget`);
  assert(normalizedOneCorePercent <= 1,
    `cadence CPU delta ${normalizedOneCorePercent.toFixed(4)}% exceeded the 1% one-core budget`);

  for (const key of ['codex', 'claude', 'cursor', 'ollama']) {
    const cadence = DEFAULT_PROVIDER_CADENCE[key].fast_ms;
    const theoreticalMaximum = 1 + Math.ceil(600_000 / cadence) + 1;
    assert(callTimes[key].length <= theoreticalMaximum,
      `${key} exceeded bounded live polling overhead`);
    assert(callTimes[key].length >= 1 + Math.floor(600_000 / (cadence * 1.2)),
      `${key} did not sustain its documented live cadence`);
  }
  assert(callTimes.antigravity.length <= 4, 'guarded Antigravity collection was amplified by the Usage view');
  assert(jitterOffsets.some(offset => offset !== 0), 'routine schedules must include non-zero jitter');

  await registry.setWatching(false);
  const idleSnapshot = registry.snapshot();
  for (const account of idleSnapshot.snapshots) {
    const key = Object.entries(PROVIDER_IDS).find(([, id]) => id === account.provider_id)[0];
    assert.strictEqual(account.refresh_interval_ms, DEFAULT_PROVIDER_CADENCE[key].idle_ms);
    assert.strictEqual(account.watch_boost_active, false);
  }

  failingProvider = 'cursor';
  await registry.refresh({ force: true, providerId: 'cursor', reason: 'forced_failure_one', waitForCost: false });
  let cursor = registry.snapshot().snapshots.find(account => account.provider_id === 'cursor');
  assert.strictEqual(cursor.status, 'fresh', 'one miss must retain bounded fresh last-good data');
  assert.strictEqual(cursor.consecutive_misses, 1);
  now += 20_000;
  await registry.refresh({ force: true, providerId: 'cursor', reason: 'forced_failure_two', waitForCost: false });
  cursor = registry.snapshot().snapshots.find(account => account.provider_id === 'cursor');
  assert.strictEqual(cursor.status, 'stale');
  assert.strictEqual(cursor.stale_reason, 'two_consecutive_misses');
  assert.strictEqual(cursor.consecutive_misses, 2);
  assert(now - Date.parse(cursor.captured_at) > 0, 'stale card must retain an explicit captured age');

  const firstManual = registry.claimManualRefresh('cursor');
  const secondManual = registry.claimManualRefresh('cursor');
  assert.strictEqual(firstManual.ok, true);
  assert.strictEqual(secondManual.ok, false);
  assert.strictEqual(secondManual.code, 'manual_refresh_rate_limited');
  assert(secondManual.retryAfterMs > 0);

  const cheapCalls = ['codex', 'claude', 'cursor', 'ollama']
    .reduce((sum, key) => sum + callTimes[key].length, 0);
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    provenance: 'deterministic_ten_minute_usage_view_simulation',
    simulated_usage_view_minutes: 10,
    documented_cadence: DEFAULT_PROVIDER_CADENCE,
    provider_calls: Object.fromEntries(Object.entries(callTimes).map(([key, times]) => [key, times.length])),
    cheap_provider_calls: cheapCalls,
    guarded_provider_calls: callTimes.antigravity.length,
    total_collector_calls: Object.values(callTimes).reduce((sum, times) => sum + times.length, 0),
    emitted_frames: emitted.length,
    maximum_observed_cheap_age_ms: Math.max(...samples
      .filter(sample => DEFAULT_PROVIDER_CADENCE[sample.provider].fast_ms <= 90_000)
      .map(sample => sample.age_ms)),
    non_zero_jitter_offsets: jitterOffsets.filter(offset => offset !== 0).length,
    two_miss_stale: {
      provider_id: cursor.provider_id,
      status: cursor.status,
      stale_reason: cursor.stale_reason,
      consecutive_misses: cursor.consecutive_misses,
      captured_at: cursor.captured_at,
    },
    manual_refresh_rate_limit: {
      code: secondManual.code,
      retry_after_ms: secondManual.retryAfterMs,
    },
    bounded_overhead: true,
    overhead: {
      wall_ms: Math.round(wallElapsedMs * 1000) / 1000,
      cpu_ms: Math.round(cpuElapsedMs * 1000) / 1000,
      idle_snapshot_baseline_cpu_ms: Math.round(baselineCpuMs * 1000) / 1000,
      cadence_cpu_delta_ms: Math.round(cadenceCpuDeltaMs * 1000) / 1000,
      normalized_one_core_percent_over_ten_minutes: Math.round(normalizedOneCorePercent * 1e6) / 1e6,
      wall_budget_ms: 1_000,
      cpu_budget_ms: 1_000,
      normalized_one_core_budget_percent: 1,
    },
    visible_windows_opened: 0,
    focus_actions: 0,
    samples,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`provider usage live cadence smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
