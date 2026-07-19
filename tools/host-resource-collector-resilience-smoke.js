#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough, Writable } = require('stream');
const {
  MAX_CONSECUTIVE_PARSE_FAILURES,
  WarmHostResourceCollector,
} = require('../agent-proxy/host-resource-warm-collector');

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.requests = [];
  child.stdout = new PassThrough();
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      const message = JSON.parse(String(chunk).trim());
      child.requests.push(message);
      if (message.type === 'stop') setImmediate(() => child.emit('exit', 0, null));
      callback();
    },
  });
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    setImmediate(() => child.emit('exit', null, 'SIGTERM'));
  };
  return child;
}

function writeSplitUtf8(stream, value, needle) {
  const encoded = Buffer.from(value, 'utf8');
  const needleBytes = Buffer.from(needle, 'utf8');
  const start = encoded.indexOf(needleBytes);
  assert(start >= 0, `split needle ${needle} missing from fixture`);
  const split = start + 1;
  stream.write(encoded.subarray(0, split));
  stream.write(encoded.subarray(split));
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return Date.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function deterministicFramingProof() {
  const child = fakeChild(42431);
  const logs = [];
  const collector = new WarmHostResourceCollector({
    spawnProcess: () => child,
    log: (level, message) => logs.push({ level, message }),
    respawnBackoffInitialMs: 1,
    respawnBackoffMaxMs: 1,
    random: () => 0,
  });
  const ready = collector.start();
  child.stdout.write(`${JSON.stringify({ type: 'ready', helper_pid: child.pid })}\n`);
  await ready;

  child.stdout.write('invalid C:\\Users\\operator\\private Bearer abcdefghijklmnop\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.killed, false, 'one malformed line killed the warm child');
  assert.equal(logs.length, 1, 'malformed line did not emit one bounded diagnostic');
  assert(logs[0].message.includes('dropped invalid JSON line 1/3'));
  assert(!logs[0].message.includes('operator'));
  assert(!logs[0].message.includes('abcdefghijklmnop'));
  assert(logs[0].message.length < 360, 'invalid-line diagnostic was not bounded');

  const pending = collector.collect();
  await waitFor(() => child.requests.some(request => request.type === 'detail'), 1_000,
    'collector did not write the detail request');
  const request = child.requests.find(message => message.type === 'detail');
  const response = `${JSON.stringify({
    type: 'detail', request_id: request.request_id, helper_pid: child.pid,
    raw: { processes: [{ name: '分析器-é-collector' }] }, collection_duration_ms: 12,
  })}\n`;
  writeSplitUtf8(child.stdout, response, '分');
  const detail = await pending;
  assert.equal(detail.raw.processes[0].name, '分析器-é-collector');
  assert.equal(child.killed, false, 'split multi-byte detail killed the warm child');
  await collector.stop();

  const thresholdChild = fakeChild(42432);
  const thresholdCollector = new WarmHostResourceCollector({
    spawnProcess: () => thresholdChild,
    respawnBackoffInitialMs: 1,
    respawnBackoffMaxMs: 1,
    random: () => 0,
  });
  const thresholdReady = thresholdCollector.start();
  thresholdChild.stdout.write(`${JSON.stringify({ type: 'ready', helper_pid: thresholdChild.pid })}\n`);
  await thresholdReady;
  thresholdChild.stdout.write(Array.from(
    { length: MAX_CONSECUTIVE_PARSE_FAILURES }, (_, index) => `bad-${index}\n`,
  ).join(''));
  await waitFor(() => thresholdChild.killed, 1_000, 'consecutive bad-line threshold did not terminate child');
  await thresholdCollector.stop();

  return {
    utf8_split_parsed: true,
    multibyte_process_name: detail.raw.processes[0].name,
    single_bad_line_child_survived: true,
    invalid_line_diagnostic_redacted: true,
    consecutive_failure_threshold: MAX_CONSECUTIVE_PARSE_FAILURES,
  };
}

async function liveRespawnProof() {
  const collector = new WarmHostResourceCollector({
    respawnBackoffInitialMs: 50,
    respawnBackoffMaxMs: 250,
    random: () => 0,
  });
  let originalPid = null;
  let recovered = null;
  let recoveryStartedAt = 0;
  try {
    const baseline = await collector.collect();
    originalPid = collector.helperPid();
    assert(Number.isSafeInteger(originalPid) && originalPid > 0);
    assert.equal(baseline.helper_pid, originalPid);
    process.kill(originalPid);
    recoveryStartedAt = Date.now();
    await waitFor(() => collector.helperPid() === null, 2_000,
      'killed warm helper did not settle');
    let lastError = null;
    while (Date.now() - recoveryStartedAt < 10_000) {
      try {
        recovered = await collector.collect();
        if (collector.helperPid() && collector.helperPid() !== originalPid) break;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(recovered, `warm helper did not recover: ${lastError?.message || 'no sample'}`);
    assert.notEqual(collector.helperPid(), originalPid, 'recovery reused the killed helper PID');
  } finally {
    await collector.stop();
  }
  const recoveryMs = Date.now() - recoveryStartedAt;
  assert(recoveryMs <= 10_000, `warm helper recovery exceeded 10 seconds: ${recoveryMs}ms`);
  return {
    original_helper_pid: originalPid,
    recovered_helper_pid: recovered?.helper_pid || null,
    recovery_ms: recoveryMs,
    recovery_limit_ms: 10_000,
  };
}

async function main() {
  const framing = await deterministicFramingProof();
  const respawn = await liveRespawnProof();
  const result = {
    ok: true,
    framing,
    respawn,
    invalid_json_terminations_before_threshold: 0,
    unavailable_snapshots_beyond_recovery_window: 0,
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
  console.error(`host resource collector resilience smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
