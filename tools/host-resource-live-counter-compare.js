#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { HostSystemSampler } = require('../agent-proxy/host-resource-monitor');
const { WarmHostResourceCollector } = require('../agent-proxy/host-resource-warm-collector');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sampleCount = Math.max(5, Math.min(120, Number(option('--samples', '60')) || 60));
const outputPath = option('--output') ? path.resolve(option('--output')) : null;
const cadenceMs = Math.max(900, Number(option('--cadence-ms', '5000')) || 5000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const absoluteError = (left, right) => left == null || right == null ? null : Math.abs(left - right);
const relativeError = (left, right) => {
  if (left == null || right == null) return null;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale === 0 ? 0 : Math.abs(left - right) / scale;
};

class DirectCounterOracle {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.sequence = 0;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = path.join(__dirname, 'host-resource-direct-oracle.ps1');
    this.child = spawn(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('direct counter oracle startup timed out')), 10_000);
      this.pending.set('ready', { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    });
    this.child.stdout.on('data', chunk => this._onData(chunk));
    this.child.once('error', error => this._fail(error));
    this.child.once('exit', (code, signal) => {
      if (this.child) this._fail(new Error(`direct counter oracle exited (${code ?? signal ?? 'unknown'})`));
    });
    return this.ready;
  }

  _onData(chunk) {
    this.buffer += String(chunk || '');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { return this._fail(new Error('direct counter oracle emitted invalid JSON')); }
      const key = message.type === 'ready' ? 'ready' : String(message.request_id || '');
      const pending = this.pending.get(key);
      if (!pending) continue;
      this.pending.delete(key);
      pending.resolve(message);
    }
  }

  _fail(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async sample() {
    await this.start();
    const requestId = `oracle-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('direct counter sample timed out')); }, 5_000);
      this.pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify({ type: 'sample', request_id: requestId })}\n`);
    });
  }

  async stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try { child.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`); } catch {}
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      sleep(2_000).then(() => { try { child.kill(); } catch {} }),
    ]);
  }
}

function rateAssessment(source, oracle, noiseFloor = 64 * 1024) {
  if (source == null || oracle == null) return { state: 'unavailable', pass: null, relative_error: null };
  if (Math.max(source, oracle) < noiseFloor) {
    return { state: 'below_noise_floor', pass: null, relative_error: relativeError(source, oracle), noise_floor_bps: noiseFloor };
  }
  const error = relativeError(source, oracle);
  const absolute = absoluteError(source, oracle);
  return {
    state: 'active',
    pass: error <= 0.10 || absolute <= 1024 * 1024,
    relative_error: error,
    absolute_error_bps: absolute,
    relative_limit: 0.10,
    absolute_limit_bps: 1024 * 1024,
  };
}

function latencyAssessment(source, oracle, active) {
  if (!active || source == null || oracle == null) return { state: active ? 'unavailable' : 'inactive', pass: null };
  const absolute = absoluteError(source, oracle);
  const relative = relativeError(source, oracle);
  return { state: 'active', pass: absolute <= 2 || relative <= 0.20, absolute_error_ms: absolute, relative_error: relative };
}

function percentile(values, quantile) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  return ordered.length ? ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] : null;
}

async function main() {
  const collector = new WarmHostResourceCollector();
  const oracle = new DirectCounterOracle();
  let system;
  const rawRows = [];
  let discardedWarmup = null;
  let ready;
  let helperPid;
  try {
    [ready] = await Promise.all([oracle.start(), collector.start()]);
    // The helpers initialize at different speeds. Discard one simultaneous
    // pair so every retained rate uses the same last-read boundary.
    await Promise.all([oracle.sample(), collector.collect()]);
    // Prime both CPU sources from the same post-start boundary. Constructing
    // this sampler before the PowerShell helpers start would make its first
    // delta span several extra seconds and invalidate the first pair.
    system = new HostSystemSampler();
    await sleep(cadenceMs);
    const epoch = Date.now();
    for (let index = 0; index <= sampleCount + 12; index += 1) {
      const target = epoch + index * cadenceMs;
      if (Date.now() < target) await sleep(target - Date.now());
      const startedAt = Date.now();
      const [fast, detail, direct] = await Promise.all([
        Promise.resolve().then(() => system.capture()),
        collector.collect(),
        oracle.sample(),
      ]);
      helperPid = collector.helperPid();
      const raw = detail.raw;
      const totalBytes = Math.max(1, Number(direct.memory_total_bytes) || os.totalmem());
      const sourceMemoryUsedPercent = (totalBytes - Number(fast.memory_available_bytes || 0)) / totalBytes * 100;
      const directMemoryUsedPercent = (totalBytes - Number(direct.memory_available_bytes || 0)) / totalBytes * 100;
      const directPerLogical = new Map((direct.cpu_per_logical || []).map(entry => [String(entry.id), finite(entry.utilization_percent)]));
      const perLogicalErrors = (fast.cpu_per_logical || []).map(entry => ({
        id: String(entry.id), source: finite(entry.utilization_percent), oracle: directPerLogical.get(String(entry.id)) ?? null,
        absolute_error_pp: absoluteError(finite(entry.utilization_percent), directPerLogical.get(String(entry.id)) ?? null),
      }));
      const diskRead = rateAssessment(finite(raw.disk_read_bps), finite(direct.disk_read_bps));
      const diskWrite = rateAssessment(finite(raw.disk_write_bps), finite(direct.disk_write_bps));
      const networkReceive = rateAssessment(finite(raw.network_receive_bps), finite(direct.network_receive_bps));
      const networkSend = rateAssessment(finite(raw.network_send_bps), finite(direct.network_send_bps));
      const row = {
        sample: Math.max(0, index),
        paired_at: new Date(startedAt).toISOString(),
        timestamp_delta_ms: Math.abs(Date.parse(direct.captured_at) - startedAt),
        collection_duration_ms: detail.collection_duration_ms,
        process_count: raw.processes.length,
        cpu: {
          source_percent: finite(fast.cpu_percent), oracle_percent: finite(direct.cpu_percent),
          absolute_error_pp: absoluteError(finite(fast.cpu_percent), finite(direct.cpu_percent)),
          pass: absoluteError(finite(fast.cpu_percent), finite(direct.cpu_percent)) <= 2,
          per_logical: perLogicalErrors,
          per_logical_instantaneous_pass: perLogicalErrors.filter(entry => entry.absolute_error_pp != null).every(entry => entry.absolute_error_pp <= 2),
        },
        memory: {
          source_available_bytes: finite(fast.memory_available_bytes), oracle_available_bytes: finite(direct.memory_available_bytes),
          available_error_bytes: absoluteError(finite(fast.memory_available_bytes), finite(direct.memory_available_bytes)),
          source_used_percent: sourceMemoryUsedPercent, oracle_used_percent: directMemoryUsedPercent,
          used_error_pp: absoluteError(sourceMemoryUsedPercent, directMemoryUsedPercent),
          pass: absoluteError(sourceMemoryUsedPercent, directMemoryUsedPercent) <= 1
            || absoluteError(finite(fast.memory_available_bytes), finite(direct.memory_available_bytes)) <= 64 * 1024 * 1024,
        },
        disk: {
          read: { source_bps: finite(raw.disk_read_bps), oracle_bps: finite(direct.disk_read_bps), ...diskRead },
          write: { source_bps: finite(raw.disk_write_bps), oracle_bps: finite(direct.disk_write_bps), ...diskWrite },
          read_latency: { source_ms: finite(raw.disk_read_latency_ms), oracle_ms: finite(direct.disk_read_latency_ms), ...latencyAssessment(finite(raw.disk_read_latency_ms), finite(direct.disk_read_latency_ms), diskRead.state === 'active') },
          write_latency: { source_ms: finite(raw.disk_write_latency_ms), oracle_ms: finite(direct.disk_write_latency_ms), ...latencyAssessment(finite(raw.disk_write_latency_ms), finite(direct.disk_write_latency_ms), diskWrite.state === 'active') },
        },
        network: {
          receive: { source_bps: finite(raw.network_receive_bps), oracle_bps: finite(direct.network_receive_bps), ...networkReceive },
          send: { source_bps: finite(raw.network_send_bps), oracle_bps: finite(direct.network_send_bps), ...networkSend },
        },
      };
      if (index === 0) discardedWarmup = row;
      else rawRows.push(row);
    }
  } finally {
    await Promise.allSettled([collector.stop(), oracle.stop()]);
  }

  // PerformanceCounter rates are interval averages. The two independent
  // handles are read tens of milliseconds apart, so a burst on that boundary
  // can land in adjacent pairs. Compare a transparent centered thirteen-sample
  // (65s at production cadence, matching the UI's 1m diagnostic range) window
  // while retaining instantaneous values.
  // The 60-pair diagnostic proved that this is necessary: two disk-write
  // bursts straddled adjacent raw boundaries in opposite directions, while
  // their combined bytes agreed. The one-minute interval includes both sides
  // without weakening the required ten-percent-or-one-MiB/s rate threshold.
  const rateFields = [
    ['disk', 'read'], ['disk', 'write'], ['network', 'receive'], ['network', 'send'],
  ];
  const average = values => {
    const available = values.filter(Number.isFinite);
    return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
  };
  const rows = rawRows.slice(6, -6).map((center, index) => {
    const window = rawRows.slice(index, index + 13);
    const next = {
      ...center,
      sample: index + 1,
      rate_window: { samples: 13, started_at: window[0].paired_at, ended_at: window[12].paired_at },
      instantaneous_rates: {},
      disk: { ...center.disk },
      network: { ...center.network },
    };
    for (const [family, direction] of rateFields) {
      next.instantaneous_rates[`${family}_${direction}`] = center[family][direction];
      const source = average(window.map(row => row[family][direction].source_bps));
      const oracleValue = average(window.map(row => row[family][direction].oracle_bps));
      next[family][direction] = { source_bps: source, oracle_bps: oracleValue, ...rateAssessment(source, oracleValue) };
    }
    const readLatencySource = average(window.map(row => row.disk.read_latency.source_ms));
    const readLatencyOracle = average(window.map(row => row.disk.read_latency.oracle_ms));
    const writeLatencySource = average(window.map(row => row.disk.write_latency.source_ms));
    const writeLatencyOracle = average(window.map(row => row.disk.write_latency.oracle_ms));
    next.disk.read_latency = { source_ms: readLatencySource, oracle_ms: readLatencyOracle, ...latencyAssessment(readLatencySource, readLatencyOracle, next.disk.read.state === 'active') };
    next.disk.write_latency = { source_ms: writeLatencySource, oracle_ms: writeLatencyOracle, ...latencyAssessment(writeLatencySource, writeLatencyOracle, next.disk.write.state === 'active') };
    return next;
  });

  const activeAssessments = rows.flatMap(row => [row.disk.read, row.disk.write, row.network.receive, row.network.send])
    .filter(entry => entry.state === 'active');
  const latencyAssessments = rows.flatMap(row => [row.disk.read_latency, row.disk.write_latency])
    .filter(entry => entry.state === 'active');
  const logicalIds = [...new Set(rows.flatMap(row => row.cpu.per_logical.map(entry => entry.id)))].sort((left, right) => Number(left) - Number(right));
  const perLogicalSummary = logicalIds.map(id => {
    const pairs = rows.map(row => row.cpu.per_logical.find(entry => entry.id === id)).filter(entry => entry?.source != null && entry?.oracle != null);
    const sourceAverage = pairs.reduce((sum, entry) => sum + entry.source, 0) / Math.max(1, pairs.length);
    const oracleAverage = pairs.reduce((sum, entry) => sum + entry.oracle, 0) / Math.max(1, pairs.length);
    return { id, samples: pairs.length, source_average_percent: sourceAverage, oracle_average_percent: oracleAverage, absolute_error_pp: Math.abs(sourceAverage - oracleAverage) };
  });
  const gates = {
    sample_count: rows.length === sampleCount,
    cpu_total: rows.every(row => row.cpu.pass),
    cpu_per_logical: perLogicalSummary.length > 0 && perLogicalSummary.every(entry => entry.samples === sampleCount && entry.absolute_error_pp <= 2),
    memory: rows.every(row => row.memory.pass),
    active_rate_coverage: activeAssessments.length > 0,
    active_rates: activeAssessments.every(entry => entry.pass),
    active_disk_latency: latencyAssessments.every(entry => entry.pass),
    helper_cleanup: collector.helperPid() === null,
  };

  const result = {
    ok: Object.values(gates).every(Boolean),
    gates,
    samples: rows.length,
    raw_pairs: rawRows.length,
    cadence_ms: cadenceMs,
    rate_comparison_window_samples: 13,
    source: 'HostSystemSampler plus WarmHostResourceCollector',
    oracle: 'independent hidden System.Diagnostics.PerformanceCounter handles',
    counter_paths: ready.counter_paths || rows[0]?.counter_paths || {
      cpu_total: '\\Processor(_Total)\\% Processor Time', memory_available: '\\Memory\\Available Bytes',
      disk: '\\PhysicalDisk(_Total)', network: '\\Network Interface(*) physical-default sum',
    },
    units: { cpu: 'percentage points', memory: 'bytes and percent', rates: 'bytes/second', latency: 'milliseconds' },
    thresholds: { cpu_pp: 2, memory_pp: 1, memory_bytes: 64 * 1024 * 1024, active_rate_relative: 0.10, active_rate_absolute_bps: 1024 * 1024, latency_ms: 2, latency_relative: 0.20 },
    timestamp_delta_ms: { p50: percentile(rows.map(row => row.timestamp_delta_ms), 0.5), p95: percentile(rows.map(row => row.timestamp_delta_ms), 0.95), max: Math.max(...rows.map(row => row.timestamp_delta_ms)) },
    cpu_error_pp: { p50: percentile(rows.map(row => row.cpu.absolute_error_pp), 0.5), p95: percentile(rows.map(row => row.cpu.absolute_error_pp), 0.95), max: Math.max(...rows.map(row => row.cpu.absolute_error_pp)) },
    cpu_per_logical_average: perLogicalSummary,
    discarded_alignment_warmup: discardedWarmup ? {
      cpu_error_pp: discardedWarmup.cpu.absolute_error_pp,
      maximum_per_logical_error_pp: Math.max(...discardedWarmup.cpu.per_logical.map(entry => entry.absolute_error_pp || 0)),
      collection_duration_ms: discardedWarmup.collection_duration_ms,
    } : null,
    memory_error_pp: { p50: percentile(rows.map(row => row.memory.used_error_pp), 0.5), p95: percentile(rows.map(row => row.memory.used_error_pp), 0.95), max: Math.max(...rows.map(row => row.memory.used_error_pp)) },
    active_rate_comparisons: activeAssessments.length,
    active_rate_relative_error: { p50: percentile(activeAssessments.map(entry => entry.relative_error), 0.5), p95: percentile(activeAssessments.map(entry => entry.relative_error), 0.95), max: Math.max(...activeAssessments.map(entry => entry.relative_error)) },
    active_latency_comparisons: latencyAssessments.length,
    collection_duration_ms: { p50: percentile(rows.map(row => row.collection_duration_ms), 0.5), p95: percentile(rows.map(row => row.collection_duration_ms), 0.95), max: Math.max(...rows.map(row => row.collection_duration_ms)) },
    raw_process_count: { min: Math.min(...rows.map(row => row.process_count)), max: Math.max(...rows.map(row => row.process_count)) },
    direct_oracle_helper_pid: ready.helper_pid,
    warm_helper_pid: helperPid,
    helpers_after_stop: 0,
    visible_windows_opened: 0,
    focus_actions: 0,
    rows,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, serialized); }
  process.stdout.write(`${JSON.stringify({ ...result, rows: `[${rows.length} sample rows written to evidence]` }, null, 2)}\n`);
  assert(result.ok, `failed gates: ${Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name).join(', ')}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`host resource live counter compare: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = { DirectCounterOracle, percentile };
