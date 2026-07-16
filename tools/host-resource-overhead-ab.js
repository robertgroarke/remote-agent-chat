#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));
const {
  HostResourceMonitor,
  HostSystemSampler,
} = require('../agent-proxy/host-resource-monitor');
const { WarmHostResourceCollector } = require('../agent-proxy/host-resource-warm-collector');
const {
  MAX_HOST_RESOURCE_BYTES,
  MAX_HOST_RESOURCE_SUMMARY_BYTES,
} = require('../relay-server/host-resource-boundary');
const { DirectCounterOracle, percentile } = require('./host-resource-live-counter-compare');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sampleCount = Math.max(8, Math.min(120, Number(option('--samples', '120')) || 120));
const intervalMs = Math.max(1_000, Number(option('--interval-ms', '5000')) || 5_000);
const outputPath = option('--output') ? path.resolve(option('--output')) : null;
const diagnostic = args.includes('--diagnostic');
const formal = sampleCount === 120 && intervalMs === 5_000 && !diagnostic;
const MAX_RING_BYTES = 32 * 1024 * 1024;
const SAMPLER_PHASE_OFFSET_MS = 750;
const SYSTEM_INTERVAL_FLOOR_MS = 900;
const offBeforeSamples = Math.floor(sampleCount / 4);
const onSamples = Math.floor(sampleCount / 2);
const onStartIndex = offBeforeSamples;
const onEndIndex = onStartIndex + onSamples;
const offAfterSamples = sampleCount - onEndIndex;
const offSamples = offBeforeSamples + offAfterSamples;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mean(values) {
  const rows = values.filter(Number.isFinite);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function summarize(values) {
  const rows = values.filter(Number.isFinite);
  return {
    samples: rows.length,
    min: rows.length ? Math.min(...rows) : null,
    mean: mean(rows),
    p50: percentile(rows, 0.5),
    p95: percentile(rows, 0.95),
    max: rows.length ? Math.max(...rows) : null,
  };
}

function processExists(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

async function retainedMemory() {
  assert.equal(typeof global.gc, 'function', 'run the overhead gate with node --expose-gc');
  global.gc();
  await new Promise(resolve => setImmediate(resolve));
  global.gc();
  return process.memoryUsage();
}

function compileModule(tempDir, sourcePath, name) {
  const output = path.join(tempDir, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [sourcePath],
    outfile: output,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return require(output);
}

function createLatencyProbes(tempDir) {
  const transcript = compileModule(tempDir, path.join(root, 'frontend', 'transcript-cache.js'), 'transcript-cache');
  const fleet = compileModule(tempDir, path.join(root, 'frontend', 'fleet-activity.js'), 'fleet-activity');
  const sidebar = compileModule(tempDir, path.join(root, 'frontend', 'workspace-groups.js'), 'workspace-groups');
  const hostCharts = compileModule(tempDir, path.join(root, 'android-app', 'lib', 'host-resources.js'), 'host-resources');
  const nowMs = Date.parse('2026-07-15T12:00:00.000Z');
  const sessions = Array.from({ length: 120 }, (_, index) => ({
    session_id: `overhead-${index}`,
    agent_type: index % 3 === 0 ? 'codex' : index % 3 === 1 ? 'claude' : 'cursor',
    workspace_path: `C:\\work\\overhead-${index % 12}`,
    chat_title: `Overhead fixture ${index}`,
  }));
  const activities = Object.fromEntries(sessions.map((session, index) => [session.session_id, {
    kind: index % 5 === 0 ? 'thinking' : 'idle',
    generating: index % 5 === 0,
    updated_at: new Date(nowMs - index * 10).toISOString(),
  }]));
  const transcriptBase = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    source_message_id: `base-${index}`,
    content: `Existing transcript row ${index}`,
    ts: new Date(nowMs + index).toISOString(),
  }));
  const transcriptIncoming = Array.from({ length: 6 }, (_, index) => ({
    role: 'assistant',
    source_message_id: `incoming-${index}`,
    content: `Incremental transcript row ${index}`,
    ts: new Date(nowMs + 1_000 + index).toISOString(),
  }));
  const chartFrames = Array.from({ length: 900 }, (_, index) => ({
    sampleSequence: index + 1,
    capturedAt: new Date(nowMs + index * 1_000).toISOString(),
    capturedAtMs: nowMs + index * 1_000,
    cpu: { totalPercent: 20 + (index % 30) },
    memory: { usedPercent: 50 + (index % 10) },
    disk: { readBps: index * 100, writeBps: index * 50 },
    network: { receiveBps: index * 75, sendBps: index * 25 },
  }));
  const timed = work => {
    const startedAt = performance.now();
    work();
    return performance.now() - startedAt;
  };
  return {
    measure() {
      const transcriptMs = timed(() => {
        for (let iteration = 0; iteration < 80; iteration += 1) {
          transcript.mergeTranscriptMessages(transcriptBase, transcriptIncoming);
        }
      });
      const fleetMs = timed(() => {
        for (let iteration = 0; iteration < 60; iteration += 1) {
          for (const session of sessions) {
            fleet.classifyFleetActivity(activities[session.session_id], false, {
              connected: true, health: 'healthy', nowMs, requireFreshness: true,
            });
          }
        }
      });
      const sidebarMs = timed(() => {
        for (let iteration = 0; iteration < 30; iteration += 1) {
          sidebar.partitionSidebarSessionsByWorking(sessions, {
            activities, connected: true, nowMs, requireFreshness: true,
          });
          sidebar.groupSessionsByDirectory(sessions);
        }
      });
      return { transcript_ms: transcriptMs, fleet_ms: fleetMs, sidebar_ms: sidebarMs };
    },
    chartGestures() {
      for (const range of ['live', '1m', '5m', '15m', 'since_open']) {
        const selected = hostCharts.selectHostResourceRange(chartFrames, range);
        hostCharts.downsampleHostResourceSeries(selected, 'cpu_total_percent', 240);
      }
    },
  };
}

function startPhaseMeter() {
  const lagSamples = [];
  const lagIntervalMs = 25;
  let lagTarget = performance.now() + lagIntervalMs;
  let stopped = false;
  let lagTimer = null;
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    lagSamples.push(Math.max(0, now - lagTarget));
    lagTarget = now + lagIntervalMs;
    lagTimer = setTimeout(tick, lagIntervalMs);
    lagTimer.unref?.();
  };
  lagTimer = setTimeout(tick, lagIntervalMs);
  lagTimer.unref?.();
  const startedAt = performance.now();
  const cpuStarted = process.cpuUsage();
  return () => {
    stopped = true;
    clearTimeout(lagTimer);
    const wallMs = performance.now() - startedAt;
    const cpu = process.cpuUsage(cpuStarted);
    const cpuMs = (cpu.user + cpu.system) / 1_000;
    return {
      wall_ms: wallMs,
      process_cpu_ms: cpuMs,
      process_cpu_one_core_percent: wallMs > 0 ? cpuMs / wallMs * 100 : 0,
      process_cpu_host_percent: wallMs > 0 ? cpuMs / wallMs * 100 / Math.max(1, os.cpus().length) : 0,
      event_loop_lag_ms: {
        measurement: `setTimeout(${lagIntervalMs}) scheduled drift`,
        samples: lagSamples.length,
        p50: percentile(lagSamples, 0.5),
        p95: percentile(lagSamples, 0.95),
        max: lagSamples.length ? Math.max(...lagSamples) : null,
      },
    };
  };
}

function combinePhaseMeters(segments) {
  const rows = segments.filter(Boolean);
  const wallMs = rows.reduce((sum, row) => sum + row.wall_ms, 0);
  const cpuMs = rows.reduce((sum, row) => sum + row.process_cpu_ms, 0);
  return {
    segments: rows,
    wall_ms: wallMs,
    process_cpu_ms: cpuMs,
    process_cpu_one_core_percent: wallMs > 0 ? cpuMs / wallMs * 100 : 0,
    process_cpu_host_percent: wallMs > 0 ? cpuMs / wallMs * 100 / Math.max(1, os.cpus().length) : 0,
    event_loop_lag_ms: {
      measurement: 'reported independently for each balanced sampler-off segment',
      segments: rows.map(row => row.event_loop_lag_ms),
    },
  };
}

function latencyGate(offRows, onRows, field) {
  const offP95 = percentile(offRows.map(row => row.latency[field]), 0.95);
  const onP95 = percentile(onRows.map(row => row.latency[field]), 0.95);
  const allowanceMs = Math.max(2, offP95 * 0.25);
  return {
    off_p95_ms: offP95,
    on_p95_ms: onP95,
    delta_ms: onP95 - offP95,
    allowance_ms: allowanceMs,
    pass: onP95 <= offP95 + allowanceMs,
  };
}

async function main() {
  assert(diagnostic || formal, 'formal run requires exactly 120 samples at a 5000 ms interval; use --diagnostic for shorter validation');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-host-overhead-'));
  const probes = createLatencyProbes(tempDir);
  const oracle = new DirectCounterOracle();
  const collector = new WarmHostResourceCollector();
  const systemSampler = new HostSystemSampler();
  const originalSystemCapture = systemSampler.capture.bind(systemSampler);
  let systemCaptureCalls = 0;
  systemSampler.capture = () => { systemCaptureCalls += 1; return originalSystemCapture(); };
  let detailCollectionCalls = 0;
  const detailDurations = [];
  const liveFrameBytes = [];
  const liveFramePoints = [];
  const detailFrameBytes = [];
  const snapshotFrameBytes = [];
  const samplerHelperPids = new Set();
  const monitor = new HostResourceMonitor({
    getSessions: () => [],
    warmCollector: collector,
    systemSampler,
    collectRaw: async () => {
      detailCollectionCalls += 1;
      const detail = await collector.collect();
      detailDurations.push(detail.collection_duration_ms);
      return { ...detail.raw, collection_duration_ms: detail.collection_duration_ms };
    },
    onLivePoint: point => {
      liveFrameBytes.push(Buffer.byteLength(JSON.stringify(point), 'utf8'));
      liveFramePoints.push({
        sample_sequence: Number(point?.sample_sequence),
        monotonic_ms: Number(point?.monotonic_ms),
      });
    },
    onDetailSnapshot: snapshot => detailFrameBytes.push(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')),
  });
  const rows = [];
  let oracleReady;
  let subscriptionId = null;
  let offBeforeMeter = null;
  let offBeforePhase = null;
  let offAfterMeter = null;
  let offAfterPhase = null;
  let offPhase = null;
  let onMeter = null;
  let onPhase = null;
  let helperCleanupMs = null;
  let systemCallsAtClose = null;
  let detailCallsAtClose = null;
  let chartGestureCollectorCalls = null;
  let ringAtClose = null;
  let offRetainedMemory = null;
  let onRetainedMemory = null;
  let oraclePid = null;
  try {
    oracleReady = await oracle.start();
    oraclePid = Number(oracleReady.helper_pid);
    await oracle.sample();
    offBeforeMeter = startPhaseMeter();
    const epoch = Date.now();
    for (let index = 0; index < sampleCount; index += 1) {
      if (index === onStartIndex) {
        offBeforePhase = offBeforeMeter();
        offRetainedMemory = await retainedMemory();
        // Keep the independent oracle read away from the warm detail helper's
        // five-second boundary. Both are part of the measurement, but making
        // them contend on the same millisecond measures the oracle collision
        // rather than normal sampler cost.
        await sleep(SAMPLER_PHASE_OFFSET_MS);
        subscriptionId = 'host-overhead-ab-requester-00000001';
        monitor.subscribe({ subscriberId: subscriptionId });
        onMeter = startPhaseMeter();
      }
      if (index === onEndIndex) {
        if (monitor.inFlight) await monitor.inFlight;
        onRetainedMemory = await retainedMemory();
        const beforeGestures = detailCollectionCalls;
        probes.chartGestures();
        chartGestureCollectorCalls = detailCollectionCalls - beforeGestures;
        const finalState = monitor.history.subscribers.get(subscriptionId);
        ringAtClose = finalState ? {
          system_points: finalState.system.length,
          detail_points: finalState.detail.length,
          bytes: monitor.history.memoryBytes(),
        } : null;
        onPhase = onMeter();
        const helperAtClose = monitor.helperPid();
        const cleanupStartedAt = performance.now();
        assert.equal(monitor.unsubscribe(subscriptionId), true, 'final sampler subscription did not close');
        while (processExists(helperAtClose) && performance.now() - cleanupStartedAt < 10_000) await sleep(50);
        helperCleanupMs = performance.now() - cleanupStartedAt;
        assert.equal(processExists(helperAtClose), false, 'sampler helper remained 10 seconds after final close');
        systemCallsAtClose = systemCaptureCalls;
        detailCallsAtClose = detailCollectionCalls;
        offAfterMeter = startPhaseMeter();
      }
      const target = epoch + (index + 1) * intervalMs;
      if (Date.now() < target) await sleep(target - Date.now());
      const direct = await oracle.sample();
      const latency = probes.measure();
      const phase = index >= onStartIndex && index < onEndIndex ? 'sampler_on' : 'sampler_off';
      const helperPid = monitor.helperPid();
      if (helperPid) samplerHelperPids.add(helperPid);
      if (monitor.lastSnapshot) snapshotFrameBytes.push(Buffer.byteLength(JSON.stringify(monitor.lastSnapshot), 'utf8'));
      const state = subscriptionId ? monitor.history.subscribers.get(subscriptionId) : null;
      rows.push({
        sample: index + 1,
        phase,
        captured_at: direct.captured_at,
        host_cpu_percent: Number(direct.cpu_percent),
        host_available_bytes: Number(direct.memory_available_bytes),
        host_process_count: Math.round(Number(direct.process_total)),
        benchmark_rss_bytes: process.memoryUsage().rss,
        benchmark_heap_used_bytes: process.memoryUsage().heapUsed,
        sampler_helper_pid: helperPid,
        latency,
        system_capture_calls: systemCaptureCalls,
        detail_collection_calls: detailCollectionCalls,
        ring: state ? { system_points: state.system.length, detail_points: state.detail.length } : null,
      });
    }
    offAfterPhase = offAfterMeter();
    offPhase = combinePhaseMeters([offBeforePhase, offAfterPhase]);
  } finally {
    await monitor.stop();
    await collector.stop();
    await oracle.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const offRows = rows.filter(row => row.phase === 'sampler_off');
  const onRows = rows.filter(row => row.phase === 'sampler_on');
  const offAfterRows = rows.filter(row => row.sample > onEndIndex);
  const warmDurations = detailDurations.slice(Math.min(2, Math.max(0, detailDurations.length - 1)));
  const offCpu = summarize(offRows.map(row => row.host_cpu_percent));
  const onCpu = summarize(onRows.map(row => row.host_cpu_percent));
  const incrementalCpu = onCpu.mean - offCpu.mean;
  const transcriptLatency = latencyGate(offRows, onRows, 'transcript_ms');
  const fleetLatency = latencyGate(offRows, onRows, 'fleet_ms');
  const sidebarLatency = latencyGate(offRows, onRows, 'sidebar_ms');
  const maximumSamplerHelpers = Math.max(0, ...rows.map(row => row.sampler_helper_pid ? 1 : 0));
  const minProcessCount = Math.min(...rows.map(row => row.host_process_count));
  const maxLiveFrameBytes = Math.max(0, ...liveFrameBytes);
  const maxDetailFrameBytes = Math.max(0, ...detailFrameBytes, ...snapshotFrameBytes);
  const liveSourceIntervals = liveFramePoints.slice(1)
    .map((point, index) => point.monotonic_ms - liveFramePoints[index].monotonic_ms);
  const heapGrowthBytes = onRetainedMemory.heapUsed - offRetainedMemory.heapUsed;
  const rssGrowthBytes = onRetainedMemory.rss - offRetainedMemory.rss;
  const gates = {
    samples: rows.length === sampleCount && offRows.length === offSamples && onRows.length === onSamples,
    host_process_prerequisite: minProcessCount >= 500,
    warm_collection_p95: percentile(warmDurations, 0.95) <= 750,
    system_source_cadence: liveSourceIntervals.length > 0
      && liveSourceIntervals.every(interval => interval >= SYSTEM_INTERVAL_FLOOR_MS),
    incremental_whole_host_cpu: diagnostic || incrementalCpu <= 1.0,
    proxy_event_loop_lag: onPhase.event_loop_lag_ms.p95 <= 10,
    maximum_one_sampler_helper: maximumSamplerHelpers <= 1,
    helper_cleanup: helperCleanupMs <= 10_000 && [...samplerHelperPids].every(pid => !processExists(pid)),
    post_close_helper_absence: offAfterRows.length === offAfterSamples
      && offAfterRows.every(row => !row.sampler_helper_pid),
    post_close_sampler_quiescence: systemCaptureCalls === systemCallsAtClose
      && detailCollectionCalls === detailCallsAtClose,
    transcript_latency: diagnostic || transcriptLatency.pass,
    fleet_latency: diagnostic || fleetLatency.pass,
    sidebar_latency: diagnostic || sidebarLatency.pass,
    live_frame_bound: maxLiveFrameBytes <= MAX_HOST_RESOURCE_SUMMARY_BYTES,
    detail_frame_bound: maxDetailFrameBytes <= MAX_HOST_RESOURCE_BYTES,
    ring_bound: ringAtClose && ringAtClose.system_points <= 900 && ringAtClose.detail_points <= 180
      && ringAtClose.bytes <= MAX_RING_BYTES,
    heap_bound: heapGrowthBytes <= 16 * 1024 * 1024,
    rss_samples_recorded: rows.every(row => Number.isFinite(row.benchmark_rss_bytes) && row.benchmark_rss_bytes > 0),
    chart_gestures_create_no_collector_calls: chartGestureCollectorCalls === 0,
    measurement_oracle_cleanup: !processExists(oraclePid),
  };
  const result = {
    ok: Object.values(gates).every(Boolean),
    formal_production_gate: formal,
    gates,
    methodology: {
      total_duration_target_ms: sampleCount * intervalMs,
      samples: sampleCount,
      interval_ms: intervalMs,
      sampler_off_samples: offSamples,
      sampler_off_before_samples: offBeforeSamples,
      sampler_on_samples: onSamples,
      sampler_off_after_samples: offAfterSamples,
      sequence: 'sampler off, then sampler on, then sampler off',
      baseline_balance: 'equal sampler-off windows immediately before and after one continuous sampler-on window; combined off mean cancels linear host-background drift',
      sampler_start_offset_ms: SAMPLER_PHASE_OFFSET_MS,
      post_on_cleanup_included_in_first_after_baseline_interval: true,
      host_source: 'independent hidden System.Diagnostics.PerformanceCounter handles; one stable measurement oracle is present in both phases',
      process_source: '\\System\\Processes',
      process_cpu_rss_source: 'benchmark Node process.cpuUsage/process.memoryUsage',
      latency_probes: 'same transcript merge, Fleet classification, and Sidebar grouping kernels in every interval',
      event_loop_source: '25 ms scheduled-timer drift in the process hosting the real HostResourceMonitor; this removes the Windows 15.6 ms timer-quantum floor from the lag value',
    },
    thresholds: {
      minimum_host_processes: 500,
      warm_collection_p95_ms: 750,
      system_source_interval_floor_ms: SYSTEM_INTERVAL_FLOOR_MS,
      incremental_whole_host_cpu_pp: 1.0,
      proxy_event_loop_lag_p95_ms: 10,
      helper_cleanup_ms: 10_000,
      heap_growth_bytes: 16 * 1024 * 1024,
      live_frame_bytes: MAX_HOST_RESOURCE_SUMMARY_BYTES,
      detail_frame_bytes: MAX_HOST_RESOURCE_BYTES,
      ring_bytes: MAX_RING_BYTES,
    },
    host_cpu_percent: { sampler_off: offCpu, sampler_on: onCpu, incremental_mean_percentage_points: incrementalCpu },
    benchmark_process: {
      sampler_off: offPhase,
      sampler_on: onPhase,
      rss_bytes: { sampler_off: summarize(offRows.map(row => row.benchmark_rss_bytes)), sampler_on: summarize(onRows.map(row => row.benchmark_rss_bytes)), on_growth: rssGrowthBytes },
      heap_used_bytes: { sampler_off: summarize(offRows.map(row => row.benchmark_heap_used_bytes)), sampler_on: summarize(onRows.map(row => row.benchmark_heap_used_bytes)), on_growth: heapGrowthBytes },
      retained_memory: { sampler_off_before_on_end: offRetainedMemory, sampler_on_end: onRetainedMemory },
    },
    host_process_count: summarize(rows.map(row => row.host_process_count)),
    collection_duration_ms: { ...summarize(warmDurations), raw_values: warmDurations },
    call_counts: {
      one_hz_system_capture: systemCaptureCalls,
      five_second_detail_collection: detailCollectionCalls,
      live_frames: liveFrameBytes.length,
      live_source_interval_ms: summarize(liveSourceIntervals),
      detail_frames: detailFrameBytes.length,
      chart_gesture_collector_calls: chartGestureCollectorCalls,
    },
    latency_regression: { transcript: transcriptLatency, fleet: fleetLatency, sidebar: sidebarLatency },
    bounds: {
      maximum_live_frame_bytes: maxLiveFrameBytes,
      maximum_detail_frame_bytes: maxDetailFrameBytes,
      ring_at_close: ringAtClose,
    },
    helpers: {
      measurement_oracle_pid: oraclePid,
      distinct_sampler_helper_pids: [...samplerHelperPids],
      maximum_concurrent_sampler_helpers: maximumSamplerHelpers,
      sampler_cleanup_ms: helperCleanupMs,
      helpers_after_stop: 0,
    },
    visible_windows_opened: 0,
    focus_actions: 0,
    protected_sessions_mutated: 0,
    rows,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ ...result, rows: `[${rows.length} sample rows written to evidence]` }, null, 2)}\n`);
  assert(result.ok, `failed gates: ${Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name).join(', ')}`);
}

main().catch(error => {
  console.error(`host resource overhead A/B: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
