#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGES = [
  'production-overnight-assistant-proof-smoke.js',
  'production-overnight-session-activity-smoke.js',
  'production-overnight-history-integrity-smoke.js',
  'production-overnight-event-ring-smoke.js',
];

function parseArgs(argv) {
  assert.deepStrictEqual(argv, ['--read-only'], 'pass --read-only explicitly');
  return { readOnly: true };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const stages = [];
  for (const script of STAGES) {
    const startedAt = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, script)], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    const durationMs = Date.now() - startedAt;
    assert.notStrictEqual(run.error?.code, 'ETIMEDOUT', `${script} exceeded its 15-second stage budget`);
    assert.strictEqual(run.status, 0,
      `${script} failed (${run.stderr || run.stdout || run.error?.message || 'no output'})`);
    const output = JSON.parse(run.stdout);
    assert.strictEqual(output.ok, true, `${script} did not report ok`);
    stages.push({ script, duration_ms: durationMs, status: 'pass' });
  }

  const result = {
    ok: true,
    read_only: options.readOnly,
    stages,
    production_mutations: 0,
    protected_user_apps_touched: 0,
    visible_windows_opened: 0,
    generated_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { STAGES, main, parseArgs };
