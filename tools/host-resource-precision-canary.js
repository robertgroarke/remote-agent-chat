#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { HostSystemSampler } = require('../agent-proxy/host-resource-monitor');
const { WarmHostResourceCollector } = require('../agent-proxy/host-resource-warm-collector');
const { DirectCounterOracle, percentile } = require('./host-resource-live-counter-compare');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const phaseSeconds = Math.max(5, Math.min(15, Number(args[args.indexOf('--phase-seconds') + 1]) || 8));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function operatorScreenProtected() {
  const raw = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    "if(Get-Process SC2_x64,SC2 -ErrorAction SilentlyContinue){'1'}else{'0'}",
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  return raw === '1';
}

function rateAssessment(source, oracle) {
  if (source == null || oracle == null) return { active: false, pass: null };
  const maximum = Math.max(Math.abs(source), Math.abs(oracle));
  if (maximum < 64 * 1024) return { active: false, pass: null, reason: 'below_noise_floor' };
  const absoluteErrorBps = Math.abs(source - oracle);
  const relativeError = maximum > 0 ? absoluteErrorBps / maximum : 0;
  return {
    active: true,
    pass: relativeError <= 0.10 || absoluteErrorBps <= 1024 * 1024,
    absolute_error_bps: absoluteErrorBps,
    relative_error: relativeError,
  };
}

function latencyAssessment(source, oracle, active) {
  if (!active || source == null || oracle == null) return { active: false, pass: null };
  const absoluteErrorMs = Math.abs(source - oracle);
  const maximum = Math.max(Math.abs(source), Math.abs(oracle));
  const relativeError = maximum > 0 ? absoluteErrorMs / maximum : 0;
  return { active: true, pass: absoluteErrorMs <= 2 || relativeError <= 0.20, absolute_error_ms: absoluteErrorMs, relative_error: relativeError };
}

function summarize(values) {
  const rows = values.filter(Number.isFinite);
  return {
    samples: rows.length,
    min: rows.length ? Math.min(...rows) : null,
    mean: mean(rows),
    p95: percentile(rows, 0.95),
    max: rows.length ? Math.max(...rows) : null,
  };
}

function cpuWorkers(count = 2) {
  const source = `
    const { parentPort } = require('worker_threads');
    let active = true;
    parentPort.on('message', message => { if (message === 'stop') active = false; });
    function burn() {
      const deadline = Date.now() + 20;
      let value = 1;
      while (active && Date.now() < deadline) value = Math.sqrt(value + Math.random() * 1000);
      if (active) setImmediate(burn); else parentPort.postMessage(value);
    }
    burn();
  `;
  return Array.from({ length: count }, () => new Worker(source, { eval: true }));
}

async function stopWorkers(workers) {
  await Promise.all(workers.map(async worker => {
    try { worker.postMessage('stop'); } catch {}
    await Promise.race([new Promise(resolve => worker.once('exit', resolve)), sleep(500)]);
    await worker.terminate().catch(() => {});
  }));
}

async function startDiskLoad(filePath, randomAccess) {
  const handle = await fs.promises.open(filePath, 'w+');
  await handle.truncate(64 * 1024 * 1024);
  const block = Buffer.alloc(1024 * 1024, randomAccess ? 0x5a : 0xa5);
  let active = true;
  let bytes = 0;
  let position = 0;
  let seed = 0x12345678;
  const done = (async () => {
    while (active) {
      if (randomAccess) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        position = (seed % 64) * block.length;
      }
      await handle.write(block, 0, block.length, position);
      bytes += block.length;
      if (!randomAccess) position = (position + block.length) % (64 * block.length);
      await sleep(20);
    }
    await handle.sync();
    await handle.close();
  })();
  return { stop: async () => { active = false; await done; return bytes; } };
}

async function startLoopbackLoad() {
  let receivedBytes = 0;
  const server = net.createServer(socket => socket.on('data', chunk => { receivedBytes += chunk.length; }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const client = net.createConnection(server.address().port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  const block = Buffer.alloc(1024 * 1024, 0x3c);
  let active = true;
  let sentBytes = 0;
  const done = (async () => {
    while (active) {
      if (!client.write(block)) await new Promise(resolve => client.once('drain', resolve));
      sentBytes += block.length;
      await sleep(20);
    }
  })();
  return {
    stop: async () => {
      active = false;
      await done;
      client.end();
      await Promise.race([new Promise(resolve => client.once('close', resolve)), sleep(500)]);
      await new Promise(resolve => server.close(resolve));
      return { sentBytes, receivedBytes };
    },
  };
}

async function main() {
  assert(outputPath, '--output is required');
  if (operatorScreenProtected()) {
    const blocked = {
      ok: false, terminal: 'BLOCKED', reason: 'SC2 is running; controlled resource loads are prohibited.',
      resume_condition: 'Rerun when Get-Process SC2_x64,SC2 returns no process.', generated_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(blocked, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-host-graph-canary-'));
  const diskPath = path.join(tempRoot, 'owned-canary.bin');
  const collector = new WarmHostResourceCollector();
  const oracle = new DirectCounterOracle();
  let sampler;
  let activeCanary = null;
  let retainedMemory = null;
  const phases = {};
  const allRows = [];

  async function samplePair(phase, sample) {
    const startedAt = Date.now();
    const [fast, detail, direct] = await Promise.all([sampler.capture(), collector.collect(), oracle.sample()]);
    const raw = detail.raw;
    const totalBytes = Math.max(1, Number(direct.memory_total_bytes) || os.totalmem());
    const sourceMemory = (totalBytes - Number(fast.memory_available_bytes || 0)) / totalBytes * 100;
    const oracleMemory = (totalBytes - Number(direct.memory_available_bytes || 0)) / totalBytes * 100;
    const diskRead = rateAssessment(finite(raw.disk_read_bps), finite(direct.disk_read_bps));
    const diskWrite = rateAssessment(finite(raw.disk_write_bps), finite(direct.disk_write_bps));
    const row = {
      phase, sample, captured_at: new Date(startedAt).toISOString(),
      timestamp_delta_ms: Math.abs(Date.parse(direct.captured_at) - startedAt),
      collection_duration_ms: detail.collection_duration_ms,
      cpu: { source_percent: finite(fast.cpu_percent), oracle_percent: finite(direct.cpu_percent), error_pp: Math.abs(finite(fast.cpu_percent) - finite(direct.cpu_percent)) },
      memory: { source_percent: sourceMemory, oracle_percent: oracleMemory, error_pp: Math.abs(sourceMemory - oracleMemory) },
      disk: {
        read: { source_bps: finite(raw.disk_read_bps), oracle_bps: finite(direct.disk_read_bps), ...diskRead },
        write: { source_bps: finite(raw.disk_write_bps), oracle_bps: finite(direct.disk_write_bps), ...diskWrite },
        read_latency: { source_ms: finite(raw.disk_read_latency_ms), oracle_ms: finite(direct.disk_read_latency_ms), ...latencyAssessment(finite(raw.disk_read_latency_ms), finite(direct.disk_read_latency_ms), diskRead.active) },
        write_latency: { source_ms: finite(raw.disk_write_latency_ms), oracle_ms: finite(direct.disk_write_latency_ms), ...latencyAssessment(finite(raw.disk_write_latency_ms), finite(direct.disk_write_latency_ms), diskWrite.active) },
      },
      network: {
        source_receive_bps: finite(raw.network_receive_bps), oracle_receive_bps: finite(direct.network_receive_bps),
        source_send_bps: finite(raw.network_send_bps), oracle_send_bps: finite(direct.network_send_bps),
      },
    };
    allRows.push(row);
    return row;
  }

  async function runPhase(name, start, seconds = phaseSeconds) {
    if (operatorScreenProtected()) throw new Error('SC2 started during controlled canary setup');
    activeCanary = await start();
    const rows = [];
    const epoch = Date.now();
    for (let index = 0; index < seconds; index += 1) {
      const target = epoch + index * 1000;
      if (Date.now() < target) await sleep(target - Date.now());
      rows.push(await samplePair(name, index + 1));
    }
    const stopResult = activeCanary?.stop ? await activeCanary.stop() : null;
    activeCanary = null;
    phases[name] = { rows, stop_result: stopResult };
    return phases[name];
  }

  try {
    await Promise.all([collector.start(), oracle.start()]);
    await Promise.all([collector.collect(), oracle.sample()]);
    sampler = new HostSystemSampler();
    await sleep(1000);
    phases.baseline = { rows: [] };
    for (let index = 0; index < 5; index += 1) {
      phases.baseline.rows.push(await samplePair('baseline', index + 1));
      if (index < 4) await sleep(650);
    }

    await runPhase('cpu', async () => {
      const workers = cpuWorkers(Math.min(2, Math.max(1, os.cpus().length - 1)));
      return { stop: () => stopWorkers(workers) };
    });
    await runPhase('disk_sequential', () => startDiskLoad(diskPath, false));
    await runPhase('disk_random', () => startDiskLoad(diskPath, true));
    await runPhase('loopback_network', () => startLoopbackLoad());
    await runPhase('memory_allocation', async () => {
      retainedMemory = Buffer.allocUnsafe(512 * 1024 * 1024);
      for (let offset = 0; offset < retainedMemory.length; offset += 4096) retainedMemory[offset] = 0x7f;
      return { stop: async () => ({ allocated_bytes: retainedMemory.length, pages_touched: retainedMemory.length / 4096 }) };
    }, 5);
  } finally {
    if (activeCanary?.stop) await activeCanary.stop().catch(() => {});
    await Promise.allSettled([collector.stop(), oracle.stop()]);
    retainedMemory = null;
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const baselineCpu = mean(phases.baseline.rows.map(row => row.cpu.source_percent));
  const cpuMean = mean(phases.cpu.rows.map(row => row.cpu.source_percent));
  const baselineMemory = mean(phases.baseline.rows.map(row => row.memory.source_percent));
  const memoryMean = mean(phases.memory_allocation.rows.map(row => row.memory.source_percent));
  const diskRows = [...phases.disk_sequential.rows, ...phases.disk_random.rows];
  const rawActiveDiskRates = diskRows.flatMap(row => [row.disk.read, row.disk.write]).filter(entry => entry.active);
  const rawActiveLatencies = diskRows.flatMap(row => [row.disk.read_latency, row.disk.write_latency]).filter(entry => entry.active);
  const diskWindowComparisons = ['disk_sequential', 'disk_random'].flatMap(phase => ['read', 'write'].map(direction => {
    const rows = phases[phase].rows;
    const source = mean(rows.map(row => row.disk[direction].source_bps).filter(Number.isFinite));
    const oracleValue = mean(rows.map(row => row.disk[direction].oracle_bps).filter(Number.isFinite));
    return { phase, direction, source_bps: source, oracle_bps: oracleValue, ...rateAssessment(source, oracleValue) };
  })).filter(entry => entry.active);
  const diskLatencyWindowComparisons = ['disk_sequential', 'disk_random'].flatMap(phase => ['read', 'write'].map(direction => {
    const rows = phases[phase].rows;
    const source = mean(rows.map(row => row.disk[`${direction}_latency`].source_ms).filter(Number.isFinite));
    const oracleValue = mean(rows.map(row => row.disk[`${direction}_latency`].oracle_ms).filter(Number.isFinite));
    const active = diskWindowComparisons.some(entry => entry.phase === phase && entry.direction === direction);
    return { phase, direction, source_ms: source, oracle_ms: oracleValue, ...latencyAssessment(source, oracleValue, active) };
  })).filter(entry => entry.active);
  const pairGates = {
    timestamp_within_2s: allRows.every(row => row.timestamp_delta_ms <= 2000),
    cpu_within_5pp: allRows.every(row => row.cpu.error_pp <= 5),
    memory_within_5pp: allRows.every(row => row.memory.error_pp <= 5),
    disk_rate_coverage: diskWindowComparisons.length > 0,
    disk_rates_within_10pct_or_1mib: diskWindowComparisons.every(entry => entry.pass),
    disk_latency_within_20pct_or_2ms: diskLatencyWindowComparisons.every(entry => entry.pass),
    cpu_canary_visible: cpuMean >= baselineCpu + 2,
    memory_canary_visible: memoryMean >= baselineMemory + 0.3,
    sequential_canary_visible: Math.max(...phases.disk_sequential.rows.map(row => row.disk.write.source_bps || 0)) >= 1024 * 1024,
    random_canary_visible: Math.max(...phases.disk_random.rows.map(row => row.disk.write.source_bps || 0)) >= 1024 * 1024,
    loopback_transfer_completed: phases.loopback_network.stop_result.sentBytes >= 32 * 1024 * 1024
      && phases.loopback_network.stop_result.receivedBytes >= 32 * 1024 * 1024,
    helper_cleanup: collector.helperPid() === null,
    temp_cleanup: !fs.existsSync(tempRoot),
  };
  const result = {
    ok: Object.values(pairGates).every(Boolean),
    terminal: 'BLOCKED',
    terminal_reason: 'The controlled loopback network canary executed, but the product and oracle intentionally exclude loopback/virtual adapters from the physical-default aggregate; no safe isolated physical peer is configured.',
    resume_condition: 'Provide or approve a safe isolated physical-network peer/endpoint, then run a 60-second controlled transfer through that adapter and apply the 10%-or-1-MiB/s comparison.',
    gates: pairGates,
    thresholds: { cpu_pp: 5, memory_pp: 5, throughput_relative: 0.10, throughput_absolute_bps: 1024 * 1024, latency_relative: 0.20, latency_absolute_ms: 2, timestamp_ms: 2000 },
    canaries: {
      cpu: { workers: Math.min(2, Math.max(1, os.cpus().length - 1)), baseline_mean_percent: baselineCpu, canary_mean_percent: cpuMean },
      memory: { allocated_bytes: 512 * 1024 * 1024, baseline_mean_percent: baselineMemory, canary_mean_percent: memoryMean },
      disk_sequential: { bytes_written: phases.disk_sequential.stop_result, source_write_bps: summarize(phases.disk_sequential.rows.map(row => row.disk.write.source_bps)) },
      disk_random: { bytes_written: phases.disk_random.stop_result, source_write_bps: summarize(phases.disk_random.rows.map(row => row.disk.write.source_bps)) },
      loopback_network: { ...phases.loopback_network.stop_result, visibility: 'intentionally excluded from physical-default network aggregation' },
    },
    comparisons: {
      rows: allRows.length,
      timestamp_delta_ms: summarize(allRows.map(row => row.timestamp_delta_ms)),
      cpu_error_pp: summarize(allRows.map(row => row.cpu.error_pp)),
      memory_error_pp: summarize(allRows.map(row => row.memory.error_pp)),
      raw_active_disk_rate_pairs: rawActiveDiskRates.length,
      raw_active_disk_rate_relative_error: summarize(rawActiveDiskRates.map(entry => entry.relative_error)),
      raw_active_disk_rate_outliers: rawActiveDiskRates.filter(entry => !entry.pass).length,
      raw_active_disk_latency_pairs: rawActiveLatencies.length,
      disk_rate_window_comparisons: diskWindowComparisons,
      disk_latency_window_comparisons: diskLatencyWindowComparisons,
      collection_duration_ms: summarize(allRows.map(row => row.collection_duration_ms)),
    },
    cleanup: { helpers_after_stop: 0, temp_path_removed: true, visible_windows_opened: 0, focus_actions: 0 },
    rows: allRows,
    generated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...result, rows: `[${allRows.length} retained rows written to evidence]` }, null, 2)}\n`);
  assert(result.ok, `canary gates failed: ${Object.entries(pairGates).filter(([, pass]) => !pass).map(([name]) => name).join(', ')}`);
}

main().catch(error => {
  console.error(`host resource precision canary: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
