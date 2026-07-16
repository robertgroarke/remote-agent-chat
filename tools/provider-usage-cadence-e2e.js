#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ProviderUsageRegistry,
  accountFingerprint,
  normalizedWindow,
} = require('../agent-proxy/provider-usage');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const KEY = 'provider-usage-cadence-fixture-key';

async function main() {
  let now = Date.parse('2026-07-14T12:00:00.000Z');
  const providerSpecs = {
    codex: { source: 'app_server_fixture', used: [17, 42], requests: 1 },
    claude: { source: 'oauth_api_fixture', used: [8, 56], requests: 2 },
    antigravity: { source: 'local_settings_fixture', used: [31, 72], requests: 0 },
    cursor: { source: 'local_auth_connect_fixture', used: [57, 100], requests: 1 },
  };
  const callTimes = Object.fromEntries(Object.keys(providerSpecs).map(provider => [provider, []]));
  const activeCalls = Object.fromEntries(Object.keys(providerSpecs).map(provider => [provider, 0]));
  const maxActiveCalls = Object.fromEntries(Object.keys(providerSpecs).map(provider => [provider, 0]));
  const collectors = Object.fromEntries(Object.entries(providerSpecs).map(([provider, spec]) => [provider, async () => {
    callTimes[provider].push(now);
    activeCalls[provider] += 1;
    maxActiveCalls[provider] = Math.max(maxActiveCalls[provider], activeCalls[provider]);
    await Promise.resolve();
    activeCalls[provider] -= 1;
    return {
      account_fingerprint: accountFingerprint(`${provider}-cadence-account`, KEY),
      account_label: `${provider.slice(0, 2)}***@example.invalid`,
      plan: `${provider} fixture plan`,
      source: spec.source,
      source_history: [{ source: spec.source, status: 'ok', captured_at: new Date(now).toISOString() }],
      captured_at: new Date(now).toISOString(),
      windows: spec.used.map((used, index) => normalizedWindow({
        id: index === 0 ? 'primary' : 'secondary',
        label: index === 0 ? '5-hour' : 'Weekly',
        usedPercent: used,
        durationMinutes: index === 0 ? 300 : 10080,
        resetsAt: now + (index === 0 ? 2 : 48) * 60 * 60 * 1000,
      })),
      credits: null,
      reset_credits: null,
      request_count: spec.requests,
    };
  }]));
  const sessionTypes = ['codex_cli', 'claude_cli', 'antigravity_panel', 'cursor'];
  const sessions = Array.from({ length: 60 }, (_, index) => ({
    sessionId: `cadence-session-${index + 1}`,
    agentType: sessionTypes[index % sessionTypes.length],
  }));
  const emittedSnapshots = [];
  const registry = new ProviderUsageRegistry({
    getSessions: () => sessions,
    collectors,
    fingerprintKey: KEY,
    pollIntervalMs: 300000,
    staleAfterMs: 600000,
    now: () => now,
    random: () => 0.5,
    onSnapshot: snapshot => emittedSnapshots.push(snapshot),
  });

  await registry.refresh({ force: true, reason: 'startup-fixture' });
  const sampleSteps = new Set([0, 7, 14, 21, 28, 35, 42, 49, 56, 60]);
  const samples = [];
  const captureSample = step => {
    const snapshot = registry.snapshot();
    assert.strictEqual(snapshot.snapshots.length, 4);
    for (const account of snapshot.snapshots) {
      const provider = Object.entries(providerSpecs).find(([, spec]) => spec.source === account.source)?.[0];
      assert(provider, `unexpected fixture source ${account.source}`);
      assert.deepStrictEqual(account.windows.map(window => window.used_percent), providerSpecs[provider].used);
      assert.strictEqual(account.status, 'fresh');
      samples.push({
        step, provider, source: account.source, status: account.status,
        capture_age_ms: now - Date.parse(account.captured_at),
        latency_ms: account.latency_ms,
        request_count: account.request_count,
        fallback_taken: false,
        provenance: 'deterministic_time_fixture',
      });
    }
  };
  captureSample(0);
  for (let step = 1; step <= 60; step += 1) {
    now += 30000;
    await registry.refresh({ reason: step % 2 ? 'reconnect-fixture' : 'dashboard-open-fixture' });
    if (sampleSteps.has(step)) captureSample(step);
  }

  for (const [provider, times] of Object.entries(callTimes)) {
    assert.strictEqual(times.length, 7, `${provider} must make one startup plus six five-minute routine calls`);
    for (let index = 1; index < times.length; index += 1) {
      assert(times[index] - times[index - 1] >= 300000, `${provider} routine calls were amplified inside five minutes`);
    }
  }
  assert.strictEqual(samples.length, 40, 'ten samples per provider must be recorded');
  now += 30000;
  const beforeManual = Object.fromEntries(Object.entries(callTimes).map(([provider, times]) => [provider, times.length]));
  const concurrentManualRefreshes = 25;
  await Promise.all(Array.from({ length: concurrentManualRefreshes }, (_, index) => registry.refresh({
    force: true, reason: `manual-fixture-${index + 1}`,
  })));
  for (const [provider, times] of Object.entries(callTimes)) {
    assert.strictEqual(times.length, beforeManual[provider] + 1, `${provider} concurrent manual refresh was not single-flight`);
    assert.strictEqual(maxActiveCalls[provider], 1, `${provider} collector calls overlapped`);
  }
  const completionFrames = emittedSnapshots.filter(snapshot => snapshot.in_flight === false);
  assert.strictEqual(completionFrames.length, 8,
    'startup, six anchored routine cycles, and one coalesced manual storm must each emit one completion snapshot');
  for (const times of Object.values(callTimes)) {
    times.slice(0, 7).forEach(timestamp => assert.strictEqual(timestamp % 300000, 0,
      'routine collector time must be anchored to a five-minute wall-clock boundary'));
  }

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    provenance: 'deterministic_30_minute_time_simulation',
    simulated_duration_minutes: 30,
    reconnect_or_dashboard_refresh_attempts: 60,
    sessions: sessions.length,
    providers: Object.keys(providerSpecs).length,
    samples_per_provider: samples.length / Object.keys(providerSpecs).length,
    routine_collector_calls_per_provider: 7,
    minimum_routine_spacing_ms: 300000,
    concurrent_manual_refreshes: concurrentManualRefreshes,
    manual_collector_calls_per_provider: 1,
    maximum_overlapping_calls_per_provider: Math.max(...Object.values(maxActiveCalls)),
    synchronized_completion_frames: completionFrames.length,
    anchored_to_wall_clock: true,
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
  console.error(`provider usage cadence E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
