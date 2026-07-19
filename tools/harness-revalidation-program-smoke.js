#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyWriteCapabilityGate,
  programCoverage,
  validationGateForHarness,
} = require('../agent-proxy/harness-revalidation');
const { loadSentinelState, saveSentinelState } = require('./app-update-drift');
const { scanForUpdates } = require('./app-update-drift-sentinel');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-revalidation-drill-'));
const statePath = path.join(tempRoot, 'state.json');
const ledgerPath = path.join(tempRoot, 'ledger.jsonl');
const backlogPath = path.join(tempRoot, 'backlog.md');
const fixturePath = path.join(tempRoot, 'cursor-fixture.json');

function fixture(version) {
  fs.writeFileSync(fixturePath, `${JSON.stringify({
    schema_version: 1,
    harness: 'cursor',
    installed_version: version,
    captured_contract: `synthetic Cursor selector contract ${version}`,
  })}\n`, 'utf8');
}

function program() {
  return {
    schema_version: 1,
    harnesses: {
      cursor: {
        fixture: fixturePath,
        tier1: ['node', 'tools/cursor-validate-all.js', '--read-only'],
        tier2: {
          mode: 'owned_disposable',
          command: ['node', 'tools/cursor-validate-all.js', '--send-live'],
          weekday: 1,
        },
        capability_gate: true,
      },
    },
  };
}

function appendLedger(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function assertWritesGated(stage) {
  const state = loadSentinelState(statePath);
  const gate = validationGateForHarness('cursor', state);
  assert.equal(gate.gated, true, `${stage}: changed harness must be gated`);
  const capabilities = applyWriteCapabilityGate(
    { interrupt: true, set_model: true, chat_list: true },
    'cursor',
    state,
  );
  assert.equal(capabilities.interrupt, false);
  assert.equal(capabilities.set_model, false);
  assert.equal(capabilities.chat_list, true, 'read capabilities remain available during drift');
  assert.equal(capabilities.read_only_due_to_revalidation, true);
}

async function main() {
  fs.writeFileSync(backlogPath, '# Fixture backlog\n', 'utf8');
  fixture('3.5.32');
  saveSentinelState(statePath, {
    versions: { cursor: '3.5.32' },
    observed_at: new Date().toISOString(),
    last_changes: [],
  });
  const options = {
    state: statePath,
    ledger: ledgerPath,
    backlog: backlogPath,
    timeoutMs: 60_000,
    publish: false,
  };

  const failed = await scanForUpdates(options, {
    collectVersions: () => ({ cursor: '3.5.33' }),
    validators: [{ harness: 'cursor', script: 'cursor-validate-all.js' }],
    program: program(),
    runValidator: () => { throw new Error('fixture mismatch must fail before tier-1'); },
    appendLedger: appendLedger,
    appendDriftTriage: () => assertWritesGated('fixture mismatch'),
  });
  assert.equal(failed.failures, 1);
  assert.equal(failed.changes[0].failure_stage, 'fixture_coverage');
  assert.match(failed.changes[0].fixture_diff, /3\.5\.33.*3\.5\.32/);
  assertWritesGated('failed repair state');

  fixture('3.5.33');
  assert.equal(programCoverage(program(), { cursor: '3.5.33' }).ok, true,
    'fixture refresh must restore coverage before validation');

  let tier1Calls = 0;
  let tier2Calls = 0;
  const recovered = await scanForUpdates({ ...options, revalidate: 'cursor' }, {
    collectVersions: () => ({ cursor: '3.5.33' }),
    validators: [{ harness: 'cursor', script: 'cursor-validate-all.js' }],
    program: program(),
    runValidator: (validator, appVersion, timeoutMs, runId) => {
      tier1Calls += 1;
      assertWritesGated('tier-1 execution');
      return {
        schema_version: 1,
        kind: 'nightly_validation',
        run_id: runId,
        harness: validator.harness,
        status: 'pass',
        app_version: appVersion,
        validator: `tools/${validator.script}`,
        read_only: true,
        runtime_budget_ms: timeoutMs,
        budget_exhausted: false,
        duration_ms: 5,
        exit_code: 0,
        completed_at: new Date().toISOString(),
        detail: 'synthetic tier-1 pass after selector repair',
      };
    },
    runTier2: () => {
      tier2Calls += 1;
      assertWritesGated('tier-2 execution');
      return { status: 'pass', duration_ms: 7, detail: 'owned disposable write ladder passed' };
    },
    appendLedger,
    appendDriftTriage: () => { throw new Error('recovered validation must not append triage'); },
  });
  assert.equal(recovered.failures, 0);
  assert.equal(tier1Calls, 1);
  assert.equal(tier2Calls, 1);
  assert.match(recovered.changes[0].validation_transition, /validated cursor 3\.5\.32 -> 3\.5\.33/);
  const restoredState = loadSentinelState(statePath);
  assert.equal(validationGateForHarness('cursor', restoredState).gated, false);
  assert.equal(restoredState.revalidation_program.harnesses.cursor.last_validated_version, '3.5.33');
  assert(restoredState.revalidation_program.harnesses.cursor.last_tier2_pass);
  assert(restoredState.revalidation_program.harnesses.cursor.next_tier1_at);
  assert(restoredState.revalidation_program.harnesses.cursor.next_tier2_at);

  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].failure_stage, 'fixture_coverage');
  assert.equal(ledger[1].tier2_status, 'pass');
  assert(Array.isArray(ledger[0].repair_playbook) && ledger[0].repair_playbook.length === 6);

  console.log(JSON.stringify({
    ok: true,
    coverage_rows: 1,
    drill: ['detect', 'fail-close', 'fixture-repair', 'tier-1', 'tier-2', 'restore'],
    tier1_calls: tier1Calls,
    tier2_calls: tier2Calls,
    write_capabilities_restored: true,
    ledger_entries: ledger.length,
  }, null, 2));
}

main().finally(() => {
  const resolved = path.resolve(tempRoot);
  const expectedPrefix = path.resolve(os.tmpdir(), 'rac-revalidation-drill-');
  assert(resolved.startsWith(expectedPrefix), `refusing to remove unexpected fixture path ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
