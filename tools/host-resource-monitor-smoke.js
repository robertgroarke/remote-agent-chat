#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough, Writable } = require('stream');
const {
  HostResourceMonitor,
  MAX_PROCESSES,
  normalizeHostResourceSnapshot,
} = require('../agent-proxy/host-resource-monitor');
const {
  MAX_HOST_RESOURCE_BYTES,
  sanitizeHostResourceSnapshot,
} = require('../relay-server/host-resource-boundary');
const { WarmHostResourceCollector } = require('../agent-proxy/host-resource-warm-collector');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const secretCanary = 'Bearer host-resource-secret-canary-0123456789';

function rawFixture() {
  return {
    cpu_percent: 61.25,
    cpu_user_percent: 42.5,
    cpu_privileged_percent: 18.75,
    cpu_idle_percent: 38.75,
    processor_queue_length: 2,
    interrupts_per_sec: 1400,
    dpcs_per_sec: 220,
    context_switches_per_sec: 8100,
    current_frequency_mhz: 4725,
    physical_core_count: 4,
    cpu_per_logical: Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      utilization_percent: 40 + index,
      user_percent: 30 + index,
      privileged_percent: 10,
      idle_percent: 60 - index,
      frequency_mhz: 4725,
    })),
    memory_available_bytes: 6 * 1024 ** 3,
    memory_cache_bytes: 2 * 1024 ** 3,
    memory_commit_bytes: 12 * 1024 ** 3,
    memory_commit_limit_bytes: 24 * 1024 ** 3,
    memory_commit_peak_bytes: 14 * 1024 ** 3,
    memory_commit_percent: 50,
    memory_paged_pool_bytes: 300 * 1024 ** 2,
    memory_nonpaged_pool_bytes: 180 * 1024 ** 2,
    pagefile_used_bytes: 1 * 1024 ** 3,
    pages_per_sec: 12,
    faults_per_sec: 320,
    disk_read_bps: 2_000_000,
    disk_write_bps: 800_000,
    disk_busy_percent: 18.2,
    disk_read_iops: 120,
    disk_write_iops: 40,
    disk_read_latency_ms: 1.25,
    disk_write_latency_ms: 2.5,
    disk_transfer_latency_ms: 1.67,
    disk_queue_length: 0.7,
    disks: [{
      id: '0 C:', label: 'NVMe C:', kind: 'physical', read_bps: 2_000_000,
      write_bps: 800_000, read_iops: 120, write_iops: 40, busy_percent: 18.2,
      read_latency_ms: 1.25, write_latency_ms: 2.5, transfer_latency_ms: 1.67,
      queue_length: 0.7, capacity_bytes: 2 * 1024 ** 4, free_bytes: 1 * 1024 ** 4,
      free_percent: 50, available: true,
    }],
    network_receive_bps: 1_200_000,
    network_send_bps: 320_000,
    network_receive_pps: 900,
    network_send_pps: 310,
    network_utilization_percent: 1.216,
    network_output_queue_length: 0,
    network_receive_errors: 1,
    network_send_errors: 2,
    network_receive_discards: 3,
    network_send_discards: 4,
    network_adapters: [{
      id: 'ethernet-0', label: 'Ethernet', kind: 'physical', physical_default: true,
      receive_bps: 1_200_000, send_bps: 320_000, receive_pps: 900, send_pps: 310,
      link_speed_bps: 1_000_000_000, utilization_percent: 1.216,
      output_queue_length: 0, receive_errors: 1, send_errors: 2,
      receive_discards: 3, send_discards: 4, available: true,
    }],
    tcp_segments_per_sec: 1500,
    tcp_retransmits_per_sec: 2,
    tcp_connection_failures: 1,
    tcp_resets: 1,
    thread_total: 1800,
    handle_total: 84000,
    uptime_seconds: 86400,
    process_total: 80,
    processes: Array.from({ length: 80 }, (_, index) => ({
      pid: 1000 + index,
      parent_pid: index === 3 ? 1002 : 900,
      start_time: new Date(Date.parse('2026-07-14T12:00:00.000Z') + index * 1000).toISOString(),
      name: index === 0 ? 'node.exe' : index === 1 ? 'ChatGPT.exe' : index === 2 ? 'Cursor.exe' : index === 3 ? 'cursor-agent.exe' : `process-${index}.exe`,
      command_line: index === 0
        ? `node C:\\Users\\operator\\Remote Agent Chat\\agent-proxy\\index.js --token ${secretCanary}`
        : index === 2
          ? 'Cursor.exe C:\\Users\\operator\\Documents\\Remote Agent Chat'
          : index === 3
            ? 'cursor-agent.exe --workspace C:\\Users\\operator\\Documents\\Remote Agent Chat'
          : `C:\\Program Files\\fixture\\process-${index}.exe`,
      cpu_percent: index === 0 ? 3_074_910 : Math.max(0, 80 - index),
      memory_bytes: (index === 70 ? 16_000 : 100 + index) * 1024 ** 2,
      private_bytes: (90 + index) * 1024 ** 2,
      commit_bytes: (110 + index) * 1024 ** 2,
      io_read_bps: index === 71 ? 900_000_000 : index * 1000,
      io_write_bps: index === 72 ? 800_000_000 : index * 500,
      io_read_ops: index * 11,
      io_write_ops: index * 7,
      io_read_bytes_total: '18446744073709551615',
      io_write_bytes_total: String(9_007_199_254_740_993n + BigInt(index)),
      io_read_operations_total: String(90_071_992_547_409n + BigInt(index)),
      io_write_operations_total: String(80_071_992_547_409n + BigInt(index)),
      thread_count: 4 + index,
      handle_count: 20 + index,
      status: 'running',
    })),
  };
}

async function main() {
  let stopWrites = 0;
  const fakeChild = new EventEmitter();
  fakeChild.pid = 42425;
  fakeChild.killed = false;
  fakeChild.stdout = new PassThrough();
  fakeChild.stdin = new Writable({
    write(chunk, encoding, callback) {
      const message = JSON.parse(String(chunk).trim());
      if (message.type === 'stop') {
        stopWrites += 1;
        setImmediate(() => fakeChild.emit('exit', 0, null));
      }
      callback();
    },
  });
  fakeChild.kill = () => {
    fakeChild.killed = true;
    setImmediate(() => fakeChild.emit('exit', 0, null));
  };
  const idempotentCollector = new WarmHostResourceCollector({ spawnProcess: () => fakeChild });
  const readyPromise = idempotentCollector.start();
  fakeChild.stdout.write(`${JSON.stringify({ type: 'ready', helper_pid: fakeChild.pid })}\n`);
  await readyPromise;
  await Promise.all([
    idempotentCollector.stop(),
    idempotentCollector.stop(),
    idempotentCollector.stop(),
  ]);
  assert.equal(stopWrites, 1, 'concurrent helper shutdown wrote more than one stop command');

  const sessions = [
    { session_id: 'resource-cursor', agent_type: 'cursor', workspace_path: 'C:\\Users\\operator\\Documents\\Remote Agent Chat', workspace_name: 'Remote Agent Chat' },
    { session_id: 'resource-codex', agent_type: 'codex-desktop', workspace_path: 'C:\\Users\\operator\\Documents\\Remote Agent Chat', workspace_name: 'Remote Agent Chat' },
  ];
  const snapshot = normalizeHostResourceSnapshot(rawFixture(), {
    sessions,
    ownedProcesses: new Map([[1000, {
      agentLabel: 'Remote Agent proxy', agentType: 'agent-proxy', sessionId: 'proxy-runtime',
      reason: 'Fixture owner registry matches PID and start time',
    }]]),
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
    capturedAtMs: Date.parse('2026-07-14T16:00:00.000Z'),
    monotonicMs: 998_001,
    sampleSequence: 41,
    sampleIntervalMs: 1_004,
    collectionDurationMs: 123,
  });
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.sample_sequence, 41);
  assert.equal(snapshot.sample_interval_ms, 1_004);
  assert.equal(snapshot.processes.length, MAX_PROCESSES);
  assert.equal(snapshot.processes[0].agent_label, 'Remote Agent proxy');
  assert.equal(snapshot.processes[0].attribution_level, 'owned');
  assert.equal(snapshot.processes[0].owned_session_id, 'proxy-runtime');
  assert.equal(snapshot.processes[0].cpu_core_equivalent, 800,
    'process core-equivalent CPU was not clamped to the logical-core ceiling');
  assert.equal(snapshot.processes[0].cpu_host_percent, 100,
    'process host CPU was not clamped to 100%');
  assert(snapshot.processes.some(process => process.agent_label === 'Codex Desktop'));
  assert(snapshot.processes.some(process => process.agent_label === 'Cursor' && process.workspace_label === 'Remote Agent Chat'));
  assert(snapshot.processes.some(process => process.agent_label === 'Cursor Agent' && process.agent_types.includes('cursor_cli')));
  assert(snapshot.processes.filter(process => process.pid !== 1000).every(process => process.owned_session_id === null));
  assert(snapshot.processes.every(process => /^[a-f0-9]{20}$/.test(process.stable_key)));
  assert.equal(new Set(snapshot.processes.map(process => process.stable_key)).size, snapshot.processes.length);
  assert(snapshot.processes.some(process => process.pid === 1070), 'memory outlier missing from process union');
  assert(snapshot.processes.some(process => process.pid === 1071), 'read outlier missing from process union');
  assert(snapshot.processes.some(process => process.pid === 1072), 'write outlier missing from process union');
  assert.equal(snapshot.processes[0].counter_totals.io_read_bytes, '18446744073709551615');
  assert.equal(snapshot.system.memory.used_percent, 62.5);
  assert.equal(snapshot.system.cpu.total_percent, 61.3);
  assert.equal(snapshot.system.cpu.per_logical.length, 8);
  assert.equal(snapshot.system.disk.read_bps, 2_000_000);
  assert.equal(snapshot.system.disk.write_bps, 800_000);
  assert.equal(snapshot.system.disks.length, 1);
  assert.equal(snapshot.system.network.receive_bps, 1_200_000);
  assert.equal(snapshot.system.network.send_bps, 320_000);
  assert.equal(snapshot.system.network_adapters[0].physical_default, true);
  assert.equal(snapshot.privacy.command_lines_transmitted, false);
  const encoded = JSON.stringify(snapshot);
  assert(!encoded.includes(secretCanary));
  assert(!encoded.includes('C:\\Users\\operator'));
  assert(Buffer.byteLength(encoded) < MAX_HOST_RESOURCE_BYTES);
  assert.deepStrictEqual(sanitizeHostResourceSnapshot(snapshot), snapshot);
  assert.equal(sanitizeHostResourceSnapshot({ ...snapshot, command_line: secretCanary }), null);
  const lossyCounter = JSON.parse(encoded);
  lossyCounter.processes[0].counter_totals.io_read_bytes = 18446744073709551615;
  assert.equal(sanitizeHostResourceSnapshot(lossyCounter), null, 'numeric 64-bit counter was accepted');

  const aggregateSnapshot = normalizeHostResourceSnapshot(rawFixture(), {
    sessions,
    aggregateOnly: true,
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
    capturedAtMs: Date.parse('2026-07-14T16:00:00.000Z'),
  });
  assert.equal(aggregateSnapshot.machine_label, null);
  assert.deepStrictEqual(aggregateSnapshot.processes, []);
  assert.deepStrictEqual(aggregateSnapshot.system.disks, []);
  assert.deepStrictEqual(aggregateSnapshot.system.network_adapters, []);
  assert.deepStrictEqual(sanitizeHostResourceSnapshot(aggregateSnapshot), aggregateSnapshot);

  let now = 1_000_000;
  let collections = 0;
  const delivered = [];
  const monitor = new HostResourceMonitor({
    getSessions: () => sessions,
    collectRaw: async () => { collections += 1; return rawFixture(); },
    onSnapshot: (value, requestId) => delivered.push({ value, requestId }),
    now: () => now,
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
    minIntervalMs: 2_000,
    detailIntervalMs: 2_000,
    monotonicNow: () => now + 50,
  });
  await monitor.refresh({ requestId: 'first' });
  now += 500;
  await monitor.refresh({ requestId: 'cached' });
  now += 2_500;
  await monitor.refresh({ requestId: 'next' });
  assert.equal(collections, 2, 'monitor did not enforce its minimum sample interval');
  assert.deepStrictEqual(delivered.map(item => item.requestId), ['first', 'cached', 'next']);
  assert.strictEqual(delivered[0].value, delivered[1].value, 'cached request rebuilt its snapshot');
  assert.equal(delivered[0].value.sample_sequence, 1);
  assert.equal(delivered[2].value.sample_sequence, 2);
  assert.equal(delivered[2].value.sample_interval_ms, 3000);
  monitor.stop();

  let cadenceNow = 2_000_000;
  let cadenceCollections = 0;
  const cadenceMonitor = new HostResourceMonitor({
    getSessions: () => sessions,
    collectRaw: async () => {
      cadenceCollections += 1;
      cadenceNow += 700;
      return rawFixture();
    },
    now: () => cadenceNow,
    minIntervalMs: 250,
    detailIntervalMs: 5_000,
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
  });
  await cadenceMonitor.refresh({ requestId: 'cadence-first' });
  cadenceNow += 4_300;
  await cadenceMonitor.refresh({ requestId: 'cadence-five-second-boundary' });
  assert.equal(cadenceCollections, 2,
    'five-second detail cadence drifted by the prior collection duration');
  cadenceMonitor.stop();

  let systemLaneNow = 3_000_000;
  const systemCaptureTimes = [];
  const systemCadenceMonitor = new HostResourceMonitor({
    getSessions: () => sessions,
    collectRaw: async () => {
      systemLaneNow += 700;
      return rawFixture();
    },
    systemSampler: {
      capture: () => {
        systemCaptureTimes.push(systemLaneNow);
        return {
          cpu_percent: 50,
          memory_available_bytes: 6 * 1024 ** 3,
          uptime_seconds: 86400,
        };
      },
    },
    now: () => systemLaneNow,
    monotonicNow: () => systemLaneNow,
    detailIntervalMs: 5_000,
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
  });
  const firstSystemTick = await systemCadenceMonitor._sample();
  systemLaneNow += 300;
  const secondSystemTick = await systemCadenceMonitor._sample();
  assert.deepStrictEqual(systemCaptureTimes, [3_000_000, 3_001_000],
    'slow detail collection caused a sub-second fast-counter catch-up read');
  assert.equal(secondSystemTick.snapshot.monotonic_ms - firstSystemTick.snapshot.monotonic_ms, 1_000,
    'system point source time drifted to detail-collection completion');
  assert.equal(secondSystemTick.snapshot.sample_interval_ms, 1_000,
    'system sample interval did not remain anchored to capture start');
  systemCadenceMonitor.stop();

  let fallbackNow = 4_000_000;
  let fallbackCollections = 0;
  const fallbackMonitor = new HostResourceMonitor({
    getSessions: () => sessions,
    collectRaw: async () => {
      fallbackCollections += 1;
      if (fallbackCollections === 1) return rawFixture();
      const error = new Error('private collector diagnostic must not cross the relay');
      error.code = 'detail_timeout';
      throw error;
    },
    systemSampler: {
      capture: () => ({
        cpu_percent: 37.5,
        cpu_user_percent: 25,
        cpu_privileged_percent: 12.5,
        cpu_idle_percent: 62.5,
        memory_available_bytes: 6 * 1024 ** 3,
        uptime_seconds: 86400,
      }),
    },
    now: () => fallbackNow,
    monotonicNow: () => fallbackNow,
    detailIntervalMs: 5_000,
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
  });
  const fallbackBaseline = await fallbackMonitor._sample();
  fallbackNow += 5_000;
  const fallback = await fallbackMonitor._sample();
  assert.equal(fallback.snapshot.status, 'fresh', 'detail failure hid healthy aggregate metrics');
  assert.equal(fallback.snapshot.system.cpu.total_percent, 37.5);
  assert.equal(fallback.snapshot.system.memory.used_percent, 62.5);
  assert.equal(fallback.snapshot.privacy.aggregate_only, true);
  assert.equal(fallback.snapshot.processes.length, 0);
  assert.equal(fallback.snapshot.error.code, 'detail_timeout');
  assert(!fallback.snapshot.error.message.includes('private collector diagnostic'));
  assert.equal(fallback.snapshot.last_good_captured_at, fallbackBaseline.snapshot.captured_at);
  assert.deepStrictEqual(sanitizeHostResourceSnapshot(fallback.snapshot), fallback.snapshot,
    'aggregate fallback did not survive the relay privacy boundary');
  fallbackMonitor.stop();

  let sharedCaptureCount = 0;
  let sharedCollectionCount = 0;
  const sharedCadenceMonitor = new HostResourceMonitor({
    getSessions: () => sessions,
    collectRaw: async () => {
      sharedCollectionCount += 1;
      return rawFixture();
    },
    systemSampler: {
      capture: () => {
        sharedCaptureCount += 1;
        return {
          cpu_percent: 50,
          memory_available_bytes: 6 * 1024 ** 3,
          uptime_seconds: 86400,
        };
      },
    },
    totalMemoryBytes: 16 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'fixture-host',
  });
  sharedCadenceMonitor.subscribe({ subscriberId: 'shared-first' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sharedCaptureCount, 1, 'first subscriber did not reuse the system-lane prime');
  assert.equal(sharedCollectionCount, 1, 'first subscriber did not collect initial detail once');
  sharedCadenceMonitor.subscribe({ subscriberId: 'shared-second' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sharedCaptureCount, 1,
    'joining subscriber created an extra fast capture between shared one-second ticks');
  assert.equal(sharedCollectionCount, 1,
    'joining subscriber created an extra detail collection');
  sharedCadenceMonitor.unsubscribe('shared-first');
  sharedCadenceMonitor.unsubscribe('shared-second');
  sharedCadenceMonitor.stop();

  let warmStops = 0;
  let warmPid = 42424;
  const leaseMonitor = new HostResourceMonitor({
    getSessions: () => sessions,
    warmCollector: {
      collect: async () => ({ raw: rawFixture(), collection_duration_ms: 321 }),
      helperPid: () => warmPid,
      stop: async () => {
        if (warmPid === null) return;
        warmStops += 1;
        warmPid = null;
      },
    },
    systemSampler: {
      capture: () => ({
        cpu_percent: 61.25,
        cpu_user_percent: 40,
        cpu_privileged_percent: 21.25,
        cpu_idle_percent: 38.75,
        current_frequency_mhz: 4725,
        cpu_per_logical: rawFixture().cpu_per_logical,
        memory_available_bytes: 6 * 1024 ** 3,
        uptime_seconds: 86400,
      }),
    },
    idleShutdownMs: 1_000,
  });
  await leaseMonitor.refresh({ requestId: 'lease' });
  assert.equal(leaseMonitor.helperPid(), 42424);
  leaseMonitor.subscribe({ subscriberId: 'explicit-cleanup' });
  assert.equal(leaseMonitor.unsubscribe('explicit-cleanup'), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(warmStops, 1, 'explicit unsubscribe did not stop the warm helper immediately');
  assert.equal(leaseMonitor.helperPid(), null);
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal(warmStops, 1, 'warm helper was not stopped after the inactive lease');
  assert.equal(leaseMonitor.helperPid(), null);
  assert.equal(leaseMonitor.lastSnapshot, null, 'inactive lease retained the last snapshot');
  leaseMonitor.stop();

  const result = {
    ok: true,
    process_limit: MAX_PROCESSES,
    snapshot_bytes: Buffer.byteLength(encoded),
    attributed_processes: snapshot.processes.filter(process => process.attributed).length,
    command_lines_transmitted: false,
    executable_paths_transmitted: false,
    credential_canary_transmitted: false,
    relay_boundary_accepted: true,
    relay_boundary_rejected_extra_secret_key: true,
    collection_requests: 3,
    actual_collections: collections,
    detail_cadence_anchored_to_collection_start: true,
    system_cadence_anchored_to_capture_start: true,
    joining_subscriber_reuses_shared_cadence: true,
    cached_identity_preserved: true,
    schema_version: snapshot.schema_version,
    sample_sequence: snapshot.sample_sequence,
    directional_metrics_preserved: true,
    process_union_outliers_preserved: true,
    exact_owned_session_claims: snapshot.processes.filter(process => process.owned_session_id).length,
    aggregate_only_boundary_accepted: true,
    numeric_64_bit_counter_rejected: true,
    explicit_unsubscribe_stops_helper_immediately: true,
    concurrent_helper_shutdown_idempotent: true,
    aggregate_fallback_on_detail_failure: true,
    detail_failure_reason_public_safe: true,
    last_good_detail_age_transmitted: true,
    warm_helper_stopped_after_inactive_lease: true,
    visible_windows_opened: 0,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`host resource monitor smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
