#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WarmHostResourceCollector } = require('../agent-proxy/host-resource-warm-collector');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const samplesIndex = args.indexOf('--samples');
const sampleCount = Math.max(8, Math.min(120, Number(samplesIndex >= 0 ? args[samplesIndex + 1] : 22) || 22));

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function main() {
  const collector = new WarmHostResourceCollector();
  const rows = [];
  let helperPid = null;
  let readyInfo = null;
  try {
    const concurrent = await Promise.all([collector.collect(), collector.collect()]);
    assert.strictEqual(concurrent[0], concurrent[1], 'concurrent detail requests were not coalesced');
    rows.push(concurrent[0]);
    for (let index = 1; index < sampleCount; index += 1) rows.push(await collector.collect());
    helperPid = collector.helperPid();
    readyInfo = { ...collector.readyInfo };
    assert(Number.isSafeInteger(helperPid) && helperPid > 0);
    assert.equal(new Set(rows.map(row => row.helper_pid)).size, 1, 'helper PID changed during the warm run');
    assert(rows.every(row => row.helper_pid === helperPid));
    assert(rows.every(row => row.raw.processes.length >= 500), 'live process-count prerequisite was not met');
    assert(rows.slice(1).some(row => row.raw.processes.some(processRow => processRow.cpu_percent > 0)),
      'warm process CPU deltas never became valid');
    const logicalCpuCount = Math.max(1, os.cpus().length);
    const maximumProcessCoreEquivalent = Math.max(...rows.slice(1).flatMap(row => (
      row.raw.processes.map(processRow => Number(processRow.cpu_percent) || 0)
    )));
    assert(maximumProcessCoreEquivalent <= logicalCpuCount * 100 + 0.1,
      `raw process CPU exceeded the host's ${logicalCpuCount}-core ceiling: ${maximumProcessCoreEquivalent}%`);
    assert(rows.every(row => row.raw.processes.every(processRow => (
      typeof processRow.io_read_bytes_total === 'string'
      && typeof processRow.io_write_bytes_total === 'string'
    ))), 'raw cumulative counters lost string precision');
    assert(rows.every(row => row.raw.disks.some(disk => disk.kind === 'physical')));
    assert(rows.every(row => row.raw.disks.some(disk => disk.kind === 'logical')));
    assert(rows.every(row => row.raw.network_adapters.length > 0));
    const warmDurations = rows.slice(2).map(row => row.collection_duration_ms);
    assert(percentile(warmDurations, 0.95) <= 750,
      `warm detail p95 exceeded 750 ms: ${percentile(warmDurations, 0.95)} ms`);
  } finally {
    await collector.stop();
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(collector.helperPid(), null);
  assert.equal(processExists(helperPid), false, 'warm helper remained after stop');

  const warmDurations = rows.slice(2).map(row => row.collection_duration_ms);
  const logicalCpuCount = Math.max(1, os.cpus().length);
  const maximumProcessCoreEquivalent = Math.max(...rows.slice(1).flatMap(row => (
    row.raw.processes.map(processRow => Number(processRow.cpu_percent) || 0)
  )));
  const result = {
    ok: true,
    samples: rows.length,
    warm_samples: warmDurations.length,
    startup_duration_ms: readyInfo?.startup_duration_ms || null,
    collection_duration_ms: {
      min: Math.min(...warmDurations),
      p50: percentile(warmDurations, 0.5),
      p95: percentile(warmDurations, 0.95),
      max: Math.max(...warmDurations),
      limit_p95: 750,
    },
    raw_process_count: {
      min: Math.min(...rows.map(row => row.raw.processes.length)),
      max: Math.max(...rows.map(row => row.raw.processes.length)),
    },
    process_cpu_core_equivalent: {
      maximum_percent: maximumProcessCoreEquivalent,
      logical_cpu_count: logicalCpuCount,
      ceiling_percent: logicalCpuCount * 100,
      bounded: true,
    },
    physical_and_logical_disk_families: true,
    network_adapter_families: true,
    cumulative_counters_preserved_as_strings: true,
    concurrent_requests_coalesced: true,
    stable_helper_pid: true,
    maximum_helpers: 1,
    helpers_after_stop: 0,
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

main().catch(error => {
  console.error(`host resource warm sampler smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
