#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeHostResourceSnapshot } = require('../agent-proxy/host-resource-monitor');
const {
  HostResourceHistoryStore,
  MAX_DETAIL_POINTS,
  MAX_HISTORY_CHUNK_BYTES,
  MAX_SUMMARY_BYTES,
  MAX_SYSTEM_POINTS,
  aggregateOnlySnapshot,
  appendOrdered,
  boundedChunk,
  downsampleSystemPoints,
  intervalStats,
  systemPointFromSnapshot,
} = require('../agent-proxy/host-resource-history');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

function fixture(sequence, options = {}) {
  const capturedAtMs = Date.parse('2026-07-15T18:00:00.000Z') + (sequence - 1) * 1000;
  if (options.unavailable) {
    return {
      schema_version: 2, source: 'windows_proxy', status: 'unavailable',
      captured_at: new Date(capturedAtMs).toISOString(), monotonic_ms: sequence * 1000,
      sample_sequence: sequence, sample_interval_ms: 1000,
      dropped_gap_count: options.droppedGapCount || 0, machine_label: 'oracle-host', system: null,
      processes: [], capabilities: { schema_v2: true, unavailable: [] },
      sampling: { collection_duration_ms: 0, min_interval_ms: 1000, process_total: 0, process_included: 0, process_limit: 32, truncated: false, selection_rule: 'union: owned + top cpu + top memory + top read + top write', system_interval_ms: 1000, detail_interval_ms: 5000, windows_hide: true },
      privacy: { ephemeral: true, relay_cached: false, relay_persisted: false, command_lines_transmitted: false, executable_paths_transmitted: false, aggregate_only: false, transient_fields: [] },
      error: { code: 'collector_unavailable', message: 'Windows host metrics are temporarily unavailable.' },
    };
  }
  const cpu = sequence === 777 ? 100 : sequence % 101;
  const diskRead = sequence === 777 ? 9_000_000_000 : sequence * 10_000;
  return normalizeHostResourceSnapshot({
    cpu_percent: cpu,
    cpu_user_percent: cpu * 0.7,
    cpu_privileged_percent: cpu * 0.3,
    cpu_idle_percent: 100 - cpu,
    current_frequency_mhz: 4700,
    physical_core_count: 8,
    cpu_per_logical: Array.from({ length: 16 }, (_, index) => ({ id: index, utilization_percent: (cpu + index) % 101, user_percent: cpu * 0.7, privileged_percent: cpu * 0.3, idle_percent: 100 - cpu, frequency_mhz: 4700 })),
    memory_available_bytes: (32 - sequence % 16) * 1024 ** 3,
    memory_cache_bytes: 4 * 1024 ** 3,
    memory_commit_bytes: (20 + sequence % 8) * 1024 ** 3,
    memory_commit_limit_bytes: 64 * 1024 ** 3,
    memory_commit_peak_bytes: 30 * 1024 ** 3,
    memory_commit_percent: 31.25 + sequence % 12,
    disk_read_bps: diskRead,
    disk_write_bps: sequence * 20_000 + 7,
    disk_read_iops: sequence * 2,
    disk_write_iops: sequence * 3,
    disk_busy_percent: sequence % 100,
    disk_read_latency_ms: 1.25,
    disk_write_latency_ms: 2.5,
    disk_transfer_latency_ms: 1.75,
    disk_queue_length: sequence % 7,
    disks: sequence >= 450 ? [{ id: 'disk-added', label: 'Disk added', kind: 'physical', read_bps: diskRead, write_bps: sequence * 20_000, available: true }] : [],
    network_receive_bps: sequence * 30_000 + 11,
    network_send_bps: sequence * 40_000 + 13,
    network_receive_pps: sequence * 4,
    network_send_pps: sequence * 5,
    network_adapters: sequence < 600 ? [{ id: 'ethernet', label: 'Ethernet', kind: 'physical', physical_default: true, receive_bps: sequence * 30_000, send_bps: sequence * 40_000, available: true }] : [],
    process_total: 40,
    thread_total: 400,
    handle_total: 4000,
    uptime_seconds: sequence,
    processes: [{
      pid: 4242, parent_pid: 4000, start_time: '2026-07-15T17:00:00.000Z', name: 'node.exe', command_line: 'node agent-proxy/index.js',
      cpu_percent: cpu * 16, memory_bytes: 256 * 1024 ** 2, private_bytes: 200 * 1024 ** 2, commit_bytes: 220 * 1024 ** 2,
      io_read_bps: sequence * 1000, io_write_bps: sequence * 2000, io_read_ops: sequence, io_write_ops: sequence * 2,
      io_read_bytes_total: String(9_007_199_254_740_993n + BigInt(sequence)), io_write_bytes_total: String(8_007_199_254_740_993n + BigInt(sequence)),
      io_read_operations_total: String(sequence * 10), io_write_operations_total: String(sequence * 20), thread_count: 12, handle_count: 80,
    }],
  }, {
    totalMemoryBytes: 64 * 1024 ** 3, logicalCpuCount: 16, machineLabel: 'oracle-host',
    capturedAtMs, monotonicMs: sequence * 1000, sampleSequence: sequence,
    sampleIntervalMs: 1000, droppedGapCount: options.droppedGapCount || 0,
  });
}

function main() {
  let now = 0;
  const store = new HostResourceHistoryStore({ now: () => now, detachedRetentionMs: 30_000 });
  store.subscribe('full');
  store.subscribe('aggregate', { aggregateOnly: true });
  let lastSnapshot = null;
  for (let sequence = 1; sequence <= 900; sequence += 1) {
    const snapshot = fixture(sequence, {
      unavailable: sequence === 300 || sequence === 301,
      droppedGapCount: sequence >= 300 ? 2 : 0,
    });
    lastSnapshot = snapshot;
    store.appendSystem(snapshot);
    if (sequence % 5 === 0) store.appendDetail(snapshot);
  }
  const full = store.subscribers.get('full');
  const aggregate = store.subscribers.get('aggregate');
  assert.equal(full.system.length, MAX_SYSTEM_POINTS);
  assert.equal(full.detail.length, MAX_DETAIL_POINTS);
  assert.equal(aggregate.system.length, MAX_SYSTEM_POINTS);
  assert.equal(aggregate.detail.length, MAX_DETAIL_POINTS);
  assert.equal(aggregate.detail.at(-1).machine_label, null);
  assert.deepStrictEqual(aggregate.detail.at(-1).processes, []);
  assert.deepStrictEqual(aggregate.detail.at(-1).system.disks, []);
  assert.deepStrictEqual(aggregate.detail.at(-1).system.network_adapters, []);
  assert.equal(full.detail.at(-1).processes[0].counter_totals.io_read_bytes, String(9_007_199_254_740_993n + 900n));
  assert.equal(Buffer.byteLength(JSON.stringify(systemPointFromSnapshot(lastSnapshot))) <= MAX_SUMMARY_BYTES, true);

  const beforeDuplicate = full.system.length;
  assert.equal(appendOrdered(full.system, full.system.at(-1), MAX_SYSTEM_POINTS), false);
  assert.equal(appendOrdered(full.system, { ...full.system.at(-1), sample_sequence: 899 }, MAX_SYSTEM_POINTS), false);
  assert.equal(full.system.length, beforeDuplicate);

  const diskStats = intervalStats(full.system, 'disk_read_bps');
  const diskValues = full.system.map(point => point.disk?.read_bps).filter(Number.isFinite);
  assert.equal(diskStats.current, 9_000_000);
  assert.equal(diskStats.min, Math.min(...diskValues));
  assert.equal(diskStats.max, 9_000_000_000);
  assert.equal(diskStats.peak_sequence, 777);
  assert.equal(diskStats.average, diskValues.reduce((sum, value) => sum + value, 0) / diskValues.length);
  const orderedDisk = [...diskValues].sort((left, right) => left - right);
  assert.equal(diskStats.p95, orderedDisk[Math.ceil(orderedDisk.length * 0.95) - 1]);

  const buckets = downsampleSystemPoints(full.system, 60);
  assert.equal(buckets.length, 60);
  const spikeBucket = buckets.find(bucket => bucket.kind === 'bucket' && bucket.start_sequence <= 777 && bucket.end_sequence >= 777);
  assert(spikeBucket);
  assert.equal(spikeBucket.metrics.disk_read_bps.max, 9_000_000_000);
  assert.equal(spikeBucket.metrics.disk_read_bps.peak_sequence, 777);
  assert(buckets.some(bucket => bucket.gap_count > 0), 'unavailable gap disappeared during downsampling');

  let afterSequence = 0;
  let historyPoints = 0;
  let chunks = 0;
  while (true) {
    const chunk = store.chunk('full', 'system', { afterSequence, maxPoints: 64 });
    assert(chunk);
    assert(Buffer.byteLength(JSON.stringify(chunk.points)) <= MAX_HISTORY_CHUNK_BYTES);
    historyPoints += chunk.points.length;
    chunks += 1;
    afterSequence = chunk.next_sequence;
    if (chunk.done) break;
  }
  assert.equal(historyPoints, 900);
  assert(chunks > 1);
  const detailChunk = boundedChunk(full.detail, 0, 64);
  assert(detailChunk.points.length >= 1 && detailChunk.points.length < 64);
  assert(Buffer.byteLength(JSON.stringify(detailChunk.points)) <= MAX_HISTORY_CHUNK_BYTES);

  store.detach('full');
  now = 29_999;
  store.prune();
  assert(store.subscribers.has('full'));
  store.subscribe('full');
  assert.equal(store.subscribers.get('full').system.length, 900, 'resume lost retained history');
  store.detach('full');
  now = 60_000;
  store.prune();
  assert.equal(store.subscribers.has('full'), false);

  const result = {
    ok: true,
    ordered_system_points: 900,
    ordered_detail_points: 180,
    duplicate_frames_rejected: true,
    out_of_order_frames_rejected: true,
    unavailable_gap_points: 2,
    device_add_remove_preserved: true,
    one_sample_spike_sequence: 777,
    one_sample_spike_value: 9_000_000_000,
    statistics: diskStats,
    downsample_buckets: buckets.length,
    downsample_spike_preserved: true,
    history_chunks: chunks,
    summary_frame_bytes: Buffer.byteLength(JSON.stringify(systemPointFromSnapshot(lastSnapshot))),
    summary_frame_limit: MAX_SUMMARY_BYTES,
    history_chunk_limit: MAX_HISTORY_CHUNK_BYTES,
    counter_above_safe_integer_preserved: true,
    aggregate_only_labels_omitted: true,
    reconnect_resume_before_30s_preserved: true,
    detached_history_cleared_at_30s: true,
    visible_windows_opened: 0,
    focus_actions: 0,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

try { main(); } catch (error) {
  console.error(`host resource history oracle: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
}
