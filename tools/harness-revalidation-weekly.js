#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadProgram, programCoverage } = require('../agent-proxy/harness-revalidation');
const { loadSentinelState, saveSentinelState } = require('./app-update-drift');
const { appendLedger, publishEntry, resolveRelay } = require('./nightly-validation-ledger');
const { nextWeeklyAt, runTier2Definition } = require('./harness-revalidation-program');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE = path.join(ROOT, 'data', 'app-update-drift-state.json');
const DEFAULT_LEDGER = path.join(ROOT, 'data', 'harness-revalidation-ledger.jsonl');

function parseArgs(argv) {
  const options = {
    state: DEFAULT_STATE,
    ledger: DEFAULT_LEDGER,
    program: null,
    publish: true,
    nowMs: Date.now(),
    only: null,
    timeoutMs: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--state' && argv[index + 1]) options.state = path.resolve(argv[++index]);
    else if (arg === '--ledger' && argv[index + 1]) options.ledger = path.resolve(argv[++index]);
    else if (arg === '--program' && argv[index + 1]) options.program = path.resolve(argv[++index]);
    else if (arg === '--only' && argv[index + 1]) options.only = String(argv[++index]).split(',').map(x => x.trim()).filter(Boolean);
    else if (arg === '--now' && argv[index + 1]) {
      options.nowMs = Date.parse(argv[++index]);
      if (!Number.isFinite(options.nowMs)) throw new Error('Invalid --now timestamp');
    }
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Math.max(10_000, Number(argv[++index]) || 60_000);
    else if (arg === '--no-publish') options.publish = false;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function dueHarnesses(state, program, nowMs) {
  const records = state?.revalidation_program?.harnesses || {};
  return Object.entries(program.harnesses)
    .filter(([harness]) => !records[harness]?.next_tier2_at
      || Date.parse(records[harness].next_tier2_at) <= nowMs)
    .map(([harness, definition]) => ({ harness, definition, record: records[harness] || {} }));
}

async function runWeekly(options, dependencies = {}) {
  const state = loadSentinelState(options.state);
  if (!state?.revalidation_program?.harnesses) {
    throw new Error('Sentinel state has not been initialized with the revalidation program');
  }
  const program = dependencies.program || loadProgram(options.program || undefined);
  const executeTier2 = dependencies.runTier2 || runTier2Definition;
  const append = dependencies.appendLedger || appendLedger;
  const publish = dependencies.publishEntry || publishEntry;
  const relay = options.publish ? (dependencies.relay || resolveRelay(options)) : null;
  let failures = 0;
  const entries = [];
  let due = dueHarnesses(state, program, options.nowMs);
  if (options.only) due = due.filter(item => options.only.includes(item.harness));
  for (const item of due) {
    const result = executeTier2(item.harness, item.definition, { timeoutMs: options.timeoutMs });
    const completedAt = new Date(options.nowMs).toISOString();
    const entry = {
      schema_version: 1,
      kind: 'harness_revalidation_tier2',
      run_id: `tier2-${item.harness}-${completedAt.replace(/[:.]/g, '-')}`,
      harness: item.harness,
      status: result.status,
      app_version: String(state.versions?.[item.harness] || item.record.installed_version || 'unavailable'),
      validator: 'tools/harness-revalidation-weekly.js',
      read_only: false,
      tier2_status: result.status,
      duration_ms: result.duration_ms || 0,
      exit_code: result.exit_code ?? null,
      completed_at: completedAt,
      detail: result.detail || '',
      next_tier2_at: nextWeeklyAt(item.definition.tier2?.weekday, options.nowMs),
    };
    const record = state.revalidation_program.harnesses[item.harness];
    record.last_tier2_status = result.status;
    record.last_tier2_detail = result.detail || null;
    record.next_tier2_at = entry.next_tier2_at;
    record.updated_at = completedAt;
    if (result.status === 'pass') {
      record.last_tier2_pass = completedAt;
    } else if (result.status === 'fail') {
      failures += 1;
      record.status = 'fail';
      record.failure_stage = 'weekly-tier-2';
      record.reason = `weekly tier-2 failed for ${entry.app_version}: ${entry.detail}`;
    }
    state.revalidation_program.updated_at = completedAt;
    entry.program_health = JSON.parse(JSON.stringify({
      ...state.revalidation_program,
      coverage_matrix: programCoverage(program, state.versions).matrix,
    }));
    append(options.ledger, entry);
    if (options.publish) await publish(relay, entry);
    entries.push(entry);
  }
  state.revalidation_program.updated_at = new Date(options.nowMs).toISOString();
  saveSentinelState(options.state, state);
  return { entries, failures };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runWeekly(options);
  for (const entry of result.entries) {
    console.log(`${entry.status.toUpperCase()} ${entry.harness} ${entry.app_version} next=${entry.next_tier2_at}`);
  }
  process.exitCode = result.failures ? 1 : 0;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_LEDGER, DEFAULT_STATE, dueHarnesses, parseArgs, runWeekly };
