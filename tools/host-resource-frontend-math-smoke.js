#!/usr/bin/env node
'use strict';

const assert = require('assert');
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

console.log('host resource frontend math smoke: PASS');
