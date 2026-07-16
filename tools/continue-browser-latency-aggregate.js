#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const explicitEvidence = [
  'evidence/harness-maturity/2026-07-11/continue-browser-latency-recovery-result.json',
  'evidence/harness-maturity/2026-07-12/continue-browser-latency-delta-era.json',
  'evidence/harness-maturity/2026-07-12/continue-browser-latency-final-result.json',
  'evidence/harness-maturity/2026-07-12/continue-browser-latency-extended-final-result.json',
];
const passiveEvidence = 'evidence/harness-maturity/2026-07-12/continue-soak-passive-browser-latency-result.json';
const soakLedger = 'evidence/harness-maturity/2026-07-12/production-overnight-soak-live.jsonl';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function explicitSample(relativePath) {
  const evidence = readJson(relativePath);
  const sample = evidence?.harnesses?.[0]?.samples?.[0] || evidence?.verified_transport_sample;
  assert(sample, `${relativePath} has no retained transport sample`);
  assert.equal(sample.delivery_evidence, 'proxy_send_result', `${relativePath} lacks proxy delivery receipt`);
  assert(Number.isFinite(sample.message_accepted_at_ms), `${relativePath} lacks acceptance timestamp`);
  assert(Number.isFinite(sample.message_delivered_at_ms), `${relativePath} lacks delivery timestamp`);
  assert.equal(evidence.persistent_browser_pages, 1, `${relativePath} did not use one browser page`);
  assert.equal(evidence.visible_windows_opened, 0, `${relativePath} opened a visible window`);
  assert.equal(evidence.focus_actions, 0, `${relativePath} used focus`);
  assert.equal(evidence.protected_user_sessions_touched, 0, `${relativePath} touched a protected session`);
  return { ...sample, source: relativePath, receipt_source: relativePath };
}

function passiveSample() {
  const evidence = readJson(passiveEvidence);
  assert.equal(evidence.visible_windows_opened, 0, 'passive sample opened a visible window');
  assert.equal(evidence.focus_actions, 0, 'passive sample used focus');
  assert.equal(evidence.sends_or_controls, 0, 'passive observer sent or controlled a session');
  assert.equal(evidence.operation_lock_acquired, false, 'passive observer acquired the operation lock');
  assert.equal(evidence.mutation_lock_acquired, false, 'passive observer acquired the mutation lock');
  const sample = evidence.samples?.[0];
  assert(sample, 'passive evidence has no retained sample');

  const ledgerRows = fs.readFileSync(path.join(root, soakLedger), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const cycle = ledgerRows.find(row => row.event === 'cycle_pass'
    && row.run_id === evidence.run_id
    && row.cycle === sample.cycle);
  assert(cycle, 'passive sample has no matching cycle-pass ledger row');
  const turn = cycle.turns?.find(candidate => candidate.type === 'continue' && candidate.token === sample.token);
  assert(turn, 'passive sample has no matching Continue turn receipt');
  assert.equal(turn.delivery_evidence, 'proxy_send_result', 'passive sample lacks proxy delivery receipt');
  assert.equal(turn.assistant_evidence, 'assistant_role_token', 'passive sample lacks assistant-role proof');
  return {
    ...sample,
    delivery_evidence: turn.delivery_evidence,
    assistant_evidence: turn.assistant_evidence,
    source: passiveEvidence,
    receipt_source: soakLedger,
  };
}

function buildResult() {
  const samples = [...explicitEvidence.map(explicitSample), passiveSample()];
  assert.equal(samples.length, 5, 'Continue distribution must contain exactly five retained samples');
  assert.equal(new Set(samples.map(sample => sample.token)).size, samples.length, 'Continue sample tokens must be unique');
  const values = samples.map(sample => sample.native_to_browser_paint_ms);
  assert(values.every(value => Number.isFinite(value) && value >= 0), 'Continue samples require finite non-negative latency');
  const p50 = percentile(values, 0.5);
  const p95 = percentile(values, 0.95);
  return {
    ok: p50 <= 500 && p95 <= 2000 && samples.every(sample => sample.within_p95_target),
    generated_at: new Date().toISOString(),
    agent_type: 'continue',
    scope: 'five unique authenticated native Continue DOM events to persistent-browser assistant paint',
    aggregation: 'independent retained production samples on the final delivery/tail path',
    sample_count: samples.length,
    samples,
    values_ms: values,
    p50_ms: p50,
    p95_ms: p95,
    target_p50_ms: 500,
    target_p95_ms: 2000,
    every_sample_has_proxy_delivery_receipt: true,
    persistent_browser_pages: 1,
    visible_windows_opened: 0,
    focus_actions: 0,
    protected_user_sessions_touched: 0,
  };
}

function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf('--output');
  assert(outputIndex >= 0 && argv[outputIndex + 1], '--output is required');
  assert.equal(argv.length, 2, 'only --output <path> is supported');
  const output = path.resolve(argv[outputIndex + 1]);
  const result = buildResult();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  assert(result.ok, 'Continue retained distribution exceeds the Phase 2 target');
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`Continue latency aggregate: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { buildResult, explicitSample, main, passiveSample, percentile };
