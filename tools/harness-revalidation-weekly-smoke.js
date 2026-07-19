#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validationGateForHarness } = require('../agent-proxy/harness-revalidation');
const { loadSentinelState, saveSentinelState } = require('./app-update-drift');
const { parseArgs, runWeekly } = require('./harness-revalidation-weekly');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-revalidation-weekly-'));
const statePath = path.join(tempRoot, 'state.json');
const ledgerPath = path.join(tempRoot, 'ledger.jsonl');
const now = '2026-07-20T10:30:00.000Z';
const program = {
  schema_version: 1,
  harnesses: {
    cursor: {
      fixture_gate: 'smoke',
      tier1_gate: 'smoke',
      tier2: { mode: 'owned_disposable', command: ['node', 'fixture.js'], weekday: 1 },
      capability_gate: true,
    },
    claude: {
      fixture_gate: 'smoke',
      tier1_gate: 'smoke',
      tier2: { mode: 'gated', reason: 'no owned target', weekday: 2 },
      capability_gate: true,
    },
  },
};

async function main() {
  assert.equal(parseArgs(['--no-publish', '--now', now]).publish, false);
  saveSentinelState(statePath, {
    versions: { cursor: '3.5.33', claude: '2.1.212' },
    revalidation_program: {
      schema_version: 1,
      harnesses: {
        cursor: { status: 'pass', installed_version: '3.5.33', next_tier2_at: '2026-07-19T10:30:00.000Z' },
        claude: { status: 'pass', installed_version: '2.1.212', next_tier2_at: '2026-07-19T10:30:00.000Z' },
      },
    },
  });
  const options = {
    state: statePath,
    ledger: ledgerPath,
    program: null,
    publish: false,
    nowMs: Date.parse(now),
    only: null,
    timeoutMs: 60_000,
  };
  const first = await runWeekly(options, {
    program,
    runTier2: harness => harness === 'cursor'
      ? { status: 'pass', duration_ms: 9, detail: 'owned disposable writes passed' }
      : { status: 'gated', duration_ms: 0, detail: 'no owned target' },
  });
  assert.equal(first.failures, 0);
  assert.equal(first.entries.length, 2);
  let state = loadSentinelState(statePath);
  assert.equal(state.revalidation_program.harnesses.cursor.last_tier2_status, 'pass');
  assert.equal(state.revalidation_program.harnesses.claude.last_tier2_status, 'gated');
  assert.equal(state.revalidation_program.harnesses.claude.status, 'pass',
    'an explicit unavailable-target gate is terminal coverage, not a false validation failure');

  state.revalidation_program.harnesses.cursor.next_tier2_at = '2026-07-19T10:30:00.000Z';
  saveSentinelState(statePath, state);
  const failed = await runWeekly({ ...options, only: ['cursor'] }, {
    program,
    runTier2: () => ({ status: 'fail', duration_ms: 4, exit_code: 1, detail: 'selector drift' }),
  });
  assert.equal(failed.failures, 1);
  state = loadSentinelState(statePath);
  assert.equal(state.revalidation_program.harnesses.cursor.failure_stage, 'weekly-tier-2');
  assert.equal(validationGateForHarness('cursor', state).gated, true,
    'a real weekly tier-2 failure must fail-close writes');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(ledger.length, 3);
  assert(ledger.every(entry => entry.next_tier2_at));
  console.log(JSON.stringify({
    ok: true,
    staggered_due_entries: 2,
    explicit_gate_recorded: true,
    configured_failure_fail_closed: true,
    next_runs_recorded: true,
  }, null, 2));
}

main().finally(() => {
  const resolved = path.resolve(tempRoot);
  const expectedPrefix = path.resolve(os.tmpdir(), 'rac-revalidation-weekly-');
  assert(resolved.startsWith(expectedPrefix), `refusing to remove unexpected fixture path ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
