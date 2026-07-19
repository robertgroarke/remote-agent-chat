#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('../frontend/node_modules/esbuild');

const built = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'frontend', 'host-resources.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
});
const record = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: record, exports: record.exports, console, Date, Map, Set });
const host = record.exports;
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

const startedAt = Date.parse('2026-07-15T18:00:00.000Z');
const frames = Array.from({ length: 900 }, (_, index) => {
  const sequence = index + 1;
  const unavailable = sequence === 300 || sequence === 301;
  return {
    schema_version: 2,
    frame_kind: 'system',
    status: unavailable ? 'unavailable' : 'fresh',
    captured_at: new Date(startedAt + index * 1000).toISOString(),
    sample_sequence: sequence,
    sample_interval_ms: 1000,
    dropped_gap_count: sequence >= 300 ? 2 : 0,
    cpu: unavailable ? null : { total_percent: sequence % 101, user_percent: sequence % 60, privileged_percent: sequence % 40 },
    memory: unavailable ? null : { used_percent: sequence % 90, commit_percent: sequence % 75 },
    disk: unavailable ? null : { read_bps: sequence === 777 ? 9_000_000_000 : sequence * 10_000, write_bps: sequence * 20_000 },
    network: unavailable ? null : { receive_bps: sequence * 30_000, send_bps: sequence * 40_000 },
  };
});

const merged = host.mergeOrderedHostResourceFrames(
  [frames[0], frames[1]],
  [...frames.slice(2), { ...frames[899], duplicate: true }, { ...frames[500], out_of_order: true }],
);
assert.equal(merged.length, 900);
assert.deepEqual(merged.slice(0, 3).map(frame => frame.sample_sequence), [1, 2, 3]);
assert.equal(merged.at(-1).duplicate, undefined);

const stats = host.hostResourceIntervalStats(merged, 'disk_read_bps');
assert.equal(stats.count, 898);
assert.equal(stats.max, 9_000_000_000);
assert.equal(stats.peakSequence, 777);
const diskValues = merged.map(frame => frame.disk?.read_bps).filter(Number.isFinite);
assert.equal(stats.average, diskValues.reduce((sum, value) => sum + value, 0) / diskValues.length);
assert.equal(stats.p95, [...diskValues].sort((left, right) => left - right)[Math.ceil(diskValues.length * 0.95) - 1]);

const buckets = host.downsampleHostResourceSeries(merged, 'disk_read_bps', 60);
assert.equal(buckets.length, 60);
assert(buckets.some(bucket => bucket.gap), 'unavailable history must remain a visible chart gap');
const spike = buckets.find(bucket => bucket.startSequence <= 777 && bucket.endSequence >= 777);
assert.equal(spike.max, 9_000_000_000, 'min/max/average downsampling must preserve one-sample peaks');

assert.equal(host.selectHostResourceRange(merged, '15m').length, 900);
assert(host.selectHostResourceRange(merged, 'live').length >= 30);
assert(host.selectHostResourceRange(merged, 'live').length <= 31);

const snapshot = {
  schema_version: 2,
  source: 'windows_proxy',
  status: 'fresh',
  captured_at: frames.at(-1).captured_at,
  sample_sequence: 900,
  machine_label: 'oracle-host',
  system: {
    cpu_percent: 42,
    cpu: { total_percent: 42, user_percent: 30, privileged_percent: 12, logical_core_count: 16, physical_core_count: 8 },
    memory: { total_bytes: 64 * 1024 ** 3, used_bytes: 32 * 1024 ** 3, used_percent: 50, commit_percent: 62 },
    disk: { read_bps: 1, write_bps: 2 }, disks: [],
    network: { receive_bps: 3, send_bps: 4 }, network_adapters: [],
  },
  processes: [{
    pid: 4242, parent_pid: 4000, start_time: '2026-07-15T17:00:00.000Z',
    stable_key: '4242:2026-07-15T17:00:00.000Z', name: 'node.exe', attributed: true,
    attribution_level: 'owned', attribution_reason: 'Explicit proxy ownership', agent_label: 'Remote Agent proxy',
    cpu_host_percent: 5, cpu_core_equivalent: 80, memory_bytes: 100, private_bytes: 90, commit_bytes: 95,
    counter_totals: { io_read_bytes: '9007199254740993', io_write_bytes: '8007199254740993' },
  }],
  privacy: { ephemeral: true, relay_cached: false, relay_persisted: false, aggregate_only: false },
};
const normalized = host.normalizeHostResources(snapshot);
assert.equal(normalized.schemaVersion, 2);
assert.equal(normalized.system.cpu.userPercent, 30);
assert.equal(normalized.processes[0].stableKey, snapshot.processes[0].stable_key);
assert.equal(normalized.processes[0].cpuCoreEquivalent, 80);
assert.equal(normalized.processes[0].counterTotals.ioReadBytes, '9007199254740993');
assert.equal(host.formatHostResourceBytes(1024), '1.00 KiB');

const pressureStart = Date.parse('2026-07-16T20:00:00.000Z');
const sustainedPressure = Array.from({ length: 16 }, (_, index) => ({
  schema_version: 2,
  frame_kind: 'system',
  status: 'fresh',
  captured_at: new Date(pressureStart + index * 1000).toISOString(),
  sample_sequence: 1_001 + index,
  sample_interval_ms: 1000,
  cpu: { total_percent: 96 },
  memory: { used_percent: 86, used_bytes: 55 * 1024 ** 3, total_bytes: 64 * 1024 ** 3 },
}));
const pressureProjection = host.projectHostResourceStrip(sustainedPressure, {
  connected: true,
  nowMs: pressureStart + 15_500,
  subscriptionStatus: 'live',
});
assert.equal(pressureProjection.status, 'live');
assert.equal(pressureProjection.cpuLevel, 'critical');
assert.equal(pressureProjection.memoryLevel, 'warning');
assert.equal(pressureProjection.attention, 'critical');
assert.equal(pressureProjection.memoryTotalBytes, 64 * 1024 ** 3);

const oneSampleSpike = sustainedPressure.map((frame, index) => ({
  ...frame,
  cpu: { total_percent: index === sustainedPressure.length - 1 ? 99 : 20 },
  memory: { ...frame.memory, used_percent: index === sustainedPressure.length - 1 ? 99 : 50 },
}));
const spikeProjection = host.projectHostResourceStrip(oneSampleSpike, {
  connected: true,
  nowMs: pressureStart + 15_500,
  subscriptionStatus: 'live',
});
assert.equal(spikeProjection.cpuLevel, 'normal', 'one CPU spike must not flash warning chrome');
assert.equal(spikeProjection.memoryLevel, 'normal', 'one RAM spike must not flash warning chrome');

const staleProjection = host.projectHostResourceStrip(sustainedPressure, {
  connected: true,
  nowMs: pressureStart + 19_000,
  subscriptionStatus: 'live',
});
assert.equal(staleProjection.status, 'stale');
assert.equal(staleProjection.ageSeconds, 4);
assert.equal(staleProjection.cpuPercent, 96, 'stale state must retain the last-good CPU value');
const reconnectProjection = host.projectHostResourceStrip(sustainedPressure, {
  connected: false,
  nowMs: pressureStart + 16_000,
  subscriptionStatus: 'reconnecting',
});
assert.equal(reconnectProjection.status, 'reconnecting');
assert.equal(reconnectProjection.memoryPercent, 86, 'reconnect must retain the last-good RAM value');
const boundedProjection = host.projectHostResourceStrip(Array.from({ length: 100 }, (_, index) => ({
  ...sustainedPressure[index % sustainedPressure.length],
  sample_sequence: 2_000 + index,
  captured_at: new Date(pressureStart + index * 1000).toISOString(),
})), { connected: true, nowMs: pressureStart + 99_500, subscriptionStatus: 'live' });
assert.equal(boundedProjection.frames.length, 60, 'global strip history must stay bounded to 60 samples');

const alignedStart = Date.parse('2026-07-16T21:00:00.000Z');
const alignedFrames = Array.from({ length: 60 }, (_, index) => ({
  schema_version: 2,
  frame_kind: 'system',
  status: 'fresh',
  captured_at: new Date(alignedStart + index * 1_000).toISOString(),
  sample_sequence: 3_001 + index,
  sample_interval_ms: 1_000,
  cpu: { total_percent: 23.037 + index * 0.311 },
  memory: { used_percent: 41.019 + index * 0.217 },
}));
const truthRows = alignedFrames.map((frame, index) => {
  const compact = host.projectHostResourceStrip(alignedFrames.slice(0, index + 1), {
    connected: true,
    nowMs: Date.parse(frame.captured_at) + 10,
    subscriptionStatus: 'live',
  });
  const detail = host.normalizeHostResources({
    schema_version: 2,
    source: 'fixture',
    status: 'fresh',
    captured_at: frame.captured_at,
    sample_sequence: frame.sample_sequence,
    sample_interval_ms: frame.sample_interval_ms,
    system: { cpu: frame.cpu, cpu_percent: frame.cpu.total_percent, memory: frame.memory },
    processes: [],
  });
  return {
    sample_sequence: frame.sample_sequence,
    compact_cpu_percent: compact.cpuPercent,
    detail_cpu_percent: detail.system.cpuPercent,
    cpu_error_percentage_points: Math.abs(compact.cpuPercent - detail.system.cpuPercent),
    compact_memory_percent: compact.memoryPercent,
    detail_memory_percent: detail.system.memory.usedPercent,
    memory_error_percentage_points: Math.abs(compact.memoryPercent - detail.system.memory.usedPercent),
  };
});
const maxCpuError = Math.max(...truthRows.map(row => row.cpu_error_percentage_points));
const maxMemoryError = Math.max(...truthRows.map(row => row.memory_error_percentage_points));
assert(maxCpuError <= 0.1, `compact/detail CPU drift ${maxCpuError}pp exceeds 0.1pp`);
assert(maxMemoryError <= 0.1, `compact/detail memory drift ${maxMemoryError}pp exceeds 0.1pp`);
const result = {
  ok: true,
  aligned_samples: truthRows.length,
  cadence_ms: 1_000,
  sequence_range: [truthRows[0].sample_sequence, truthRows.at(-1).sample_sequence],
  maximum_cpu_error_percentage_points: maxCpuError,
  maximum_memory_error_percentage_points: maxMemoryError,
  compact_history_points: boundedProjection.frames.length,
  pressure_duration_ms: 15_000,
  rows: truthRows,
  generated_at: new Date().toISOString(),
};
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

console.log('host resource frontend math smoke: PASS');
