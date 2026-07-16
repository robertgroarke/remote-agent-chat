#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_SCRIPT = path.join(__dirname, 'structured-producer-coverage-smoke.js');
const BASELINE_PATH = path.join(
  ROOT,
  'evidence',
  'harness-maturity',
  '2026-07-12',
  'production-block-inventory-history-ranked.json',
);

function runCoverage(inventoryPath) {
  return spawnSync(process.execPath, [COVERAGE_SCRIPT, '--inventory', inventoryPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeFixture(tempRoot, name, value) {
  const fixturePath = path.join(tempRoot, `${name}.json`);
  fs.writeFileSync(fixturePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return fixturePath;
}

function assertRejected(tempRoot, baseline, name, mutate, pattern) {
  const fixture = clone(baseline);
  mutate(fixture);
  const run = runCoverage(writeFixture(tempRoot, name, fixture));
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.notStrictEqual(run.status, 0, `${name} unexpectedly passed`);
  assert.match(output, pattern, `${name} did not fail for the expected reason`);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const baselineRun = runCoverage(BASELINE_PATH);
assert.strictEqual(baselineRun.status, 0, baselineRun.stderr || baselineRun.stdout);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-structured-producer-coverage-'));
try {
  assertRejected(tempRoot, baseline, 'flattened-assistant', fixture => {
    const row = fixture.harnesses.find(item => item.agent_type === 'codex');
    row.plain_assistant_messages = 1;
    row.latest_plain_assistant_at = row.latest_assistant.at;
    row.latest_assistant.typed = false;
    row.latest_assistant.block_types = [];
  }, /codex has current flattened assistant output/);

  assertRejected(tempRoot, baseline, 'unknown-block', fixture => {
    fixture.harnesses.find(row => row.agent_type === 'codex').unknown_types = ['future_block'];
  }, /codex emitted an unknown block type/);

  assertRejected(tempRoot, baseline, 'observed-unmapped', fixture => {
    fixture.harnesses.find(row => row.agent_type === 'codex').observed_types.push('artifact');
  }, /codex observed artifact without a typed producer classification/);

  assertRejected(tempRoot, baseline, 'external-gate-cleared', fixture => {
    const row = fixture.harnesses.find(item => item.agent_type === 'gemini');
    row.status = 'healthy';
    row.session_id = 'fixture-gemini';
  }, /gemini external gate unexpectedly became available/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  baseline_passed: true,
  rejected: [
    'flattened-assistant',
    'unknown-block',
    'observed-unmapped',
    'external-gate-cleared',
  ],
  production_contacts: 0,
  production_mutations: 0,
};
const rendered = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  assert(outputPath, '--output requires a path');
  const resolvedOutput = path.resolve(ROOT, outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, rendered, 'utf8');
}
process.stdout.write(rendered);
