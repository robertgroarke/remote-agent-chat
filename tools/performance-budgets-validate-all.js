#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--read-only') {
  console.error('Performance budgets validate-all only supports --read-only.');
  process.exit(2);
}

const stages = [
  ['fixed 69-session relay shape', 'p0-fixed-shape-relay-benchmark.js', ['--duration-ms', '3000', '--read-only']],
  ['subscription isolation', 'relay-session-subscription-benchmark.js', ['--mode', 'after']],
  ['state broadcast compaction', 'relay-state-broadcast-benchmark.js', ['--mode', 'after']],
  ['delta backpressure', 'relay-delta-backpressure-benchmark.js', ['--mode', 'after']],
  ['transcript fanout recovery', 'relay-transcript-fanout-e2e.js', []],
  ['foreground headless desktop', 'p0-foreground-headless-performance-e2e.js', ['--blocking-smoke', '--steady-ms', '1000', '--phase', 'blocking-desktop', '--read-only']],
  ['foreground headless 390 px', 'p0-foreground-headless-performance-e2e.js', ['--blocking-smoke', '--width', '390', '--height', '844', '--steady-ms', '1000', '--phase', 'blocking-390', '--read-only']],
];

const results = [];
for (const [label, script, stageArgs] of stages) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...stageArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
  assert(!result.error, `${label} failed to run: ${result.error?.message || 'unknown error'}`);
  assert.equal(result.status, 0, `${label} failed:\n${detail.slice(-4000)}`);
  results.push({ label, duration_ms: Date.now() - startedAt, status: 'pass' });
}

console.log(JSON.stringify({
  ok: true,
  read_only: true,
  visible_windows_opened: 0,
  production_mutations: 0,
  stages: results,
}, null, 2));
console.log(`Performance budgets validate-all: PASS (${results.length}/${results.length})`);
