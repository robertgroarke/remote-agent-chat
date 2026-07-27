#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyWriteCapabilityGate,
  commandValidationForHarness,
  programCoverage,
  validationGateForHarness,
} = require('../agent-proxy/harness-revalidation');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
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
    write_contracts: {
      send_message: {
        status: 'read_only_compatible',
        commands: ['send', 'send_message', 'message_send'],
        scope: 'current_visible_thread',
        does_not_claim_live_delivery: true,
      },
    },
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
        command_validations: {
          send_message: {
            tier1: [[process.execPath, '-e', 'process.exit(0)']],
          },
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
  const staleCoverageState = loadSentinelState(statePath);
  const partialSend = validationGateForHarness('cursor', staleCoverageState, 'send_message', {
    program: program(),
    root: tempRoot,
  });
  assert.equal(partialSend.gated, false, 'exact-version send contract should survive stale fixture-coverage state');
  assert.equal(partialSend.partial, true);
  const partialMessageSend = validationGateForHarness('cursor', staleCoverageState, 'message_send', {
    program: program(),
    root: tempRoot,
  });
  assert.equal(partialMessageSend.gated, false, 'message_send alias must share the exact-version send contract');
  assert.equal(partialMessageSend.validated_command, 'send_message');
  assert.equal(validationGateForHarness('cursor', staleCoverageState, 'agent_set_model', {
    program: program(),
    root: tempRoot,
  }).gated, true, 'unvalidated writes must remain fail-closed');
  const partialCapabilities = applyWriteCapabilityGate(
    { send: true, send_message: true, interrupt: true, set_model: true, chat_list: true },
    'cursor',
    staleCoverageState,
    { program: program(), root: tempRoot },
  );
  assert.equal(partialCapabilities.send_message, true);
  assert.equal(partialCapabilities.message_send, true);
  assert.equal(partialCapabilities.interrupt, false);
  assert.equal(partialCapabilities.set_model, false);
  assert.equal(partialCapabilities.chat_list, true);
  assert.equal(partialCapabilities.write_capability_gate, undefined);
  assert.equal(partialCapabilities.write_restricted_due_to_revalidation, true);
  assert.deepStrictEqual(
    partialCapabilities.revalidation_validated_commands,
    ['send', 'send_message', 'message_send'],
  );

  const engine = Object.create(ProxyEngine.prototype);
  engine._isGitWorkspace = () => false;
  engine._applyWriteCapabilityGate = (capabilities, agentType) => applyWriteCapabilityGate(
    capabilities,
    agentType,
    staleCoverageState,
    { program: program(), root: tempRoot },
  );
  const projectedCapabilities = engine._buildCapabilities('cursor');
  for (const command of ['send', 'send_message', 'message_send']) {
    assert.equal(projectedCapabilities[command], true, `${command} must remain available`);
  }
  for (const command of ['interrupt', 'set_model', 'new_thread', 'switch_thread']) {
    assert.equal(projectedCapabilities[command], false, `${command} must remain fail-closed`);
  }
  assert.equal(projectedCapabilities.thread_list, true, 'read-only thread inventory must remain available');

  const tier2UnavailableState = {
    versions: { cursor: '3.5.33' },
    revalidation_program: {
      harnesses: {
        cursor: {
          status: 'fail',
          installed_version: '3.5.33',
          failure_stage: 'tier-2',
          tier1_status: 'pass',
          tier2_status: 'unavailable',
          tier2_detail: 'no owned disposable tier-2 target configured for cursor',
          reason: 'Tier-1 passed; tier-2 unavailable: no owned disposable tier-2 target configured for cursor',
        },
      },
    },
  };
  const unavailableCommand = commandValidationForHarness(
    'cursor',
    tier2UnavailableState,
    'send_message',
    { program: program(), root: tempRoot },
  );
  assert.equal(unavailableCommand.status, 'unavailable');
  assert.equal(unavailableCommand.executable, true,
    'owned target unavailability must not masquerade as a send-contract failure');
  assert.equal(unavailableCommand.live_verified, false,
    'unavailable tier 2 must block a live_verified claim');
  const unavailableSendGate = validationGateForHarness(
    'cursor',
    tier2UnavailableState,
    'send_message',
    { program: program(), root: tempRoot },
  );
  assert.equal(unavailableSendGate.gated, false);
  assert.equal(unavailableSendGate.command_state.status, 'unavailable');
  const unavailableCapabilities = applyWriteCapabilityGate(
    { send: true, send_message: true, message_send: true, interrupt: true, chat_list: true },
    'cursor',
    tier2UnavailableState,
    { program: program(), root: tempRoot },
  );
  assert.equal(unavailableCapabilities.send, true);
  assert.equal(unavailableCapabilities.send_message, true);
  assert.equal(unavailableCapabilities.message_send, true);
  assert.equal(unavailableCapabilities.interrupt, false);
  assert.equal(unavailableCapabilities.revalidation_command_states.send_message.status, 'unavailable');

  const recordedUnavailableState = JSON.parse(JSON.stringify(tier2UnavailableState));
  recordedUnavailableState.revalidation_program.harnesses.cursor.command_states = {
    send_message: {
      status: 'unavailable',
      installed_version: '3.5.33',
      tier1_status: 'pass',
      tier2_status: 'unavailable',
      live_verified: false,
      checked_at: '2026-07-25T23:59:00.000Z',
      reason: 'owned disposable target unavailable',
    },
  };
  const recordedUnavailable = commandValidationForHarness(
    'cursor',
    recordedUnavailableState,
    'message_send',
    { program: program(), root: tempRoot },
  );
  assert.equal(recordedUnavailable.status, 'unavailable');
  assert.equal(recordedUnavailable.executable, true);
  assert.equal(recordedUnavailable.live_verified, false);
  assert.equal(recordedUnavailable.basis, 'recorded_command_state');
  const recordedFailedState = JSON.parse(JSON.stringify(recordedUnavailableState));
  recordedFailedState.revalidation_program.harnesses.cursor.command_states.send_message = {
    status: 'failed',
    installed_version: '3.5.33',
    tier1_status: 'failed',
    tier2_status: 'not_run',
    live_verified: false,
    reason: 'composer selector missing',
  };
  assert.equal(commandValidationForHarness(
    'cursor',
    recordedFailedState,
    'send_message',
    { program: program(), root: tempRoot },
  ).executable, false, 'recorded command failure must remain fail-closed');
  const recordedStaleState = JSON.parse(JSON.stringify(recordedUnavailableState));
  recordedStaleState.revalidation_program.harnesses.cursor.command_states.send_message.installed_version = '3.5.32';
  assert.equal(commandValidationForHarness(
    'cursor',
    recordedStaleState,
    'send_message',
    { program: program(), root: tempRoot },
  ).status, 'stale', 'recorded command state must be app-version scoped');

  const legacyTier2UnavailableState = {
    versions: { cursor: '3.5.33' },
    revalidation_program: {
      harnesses: {
        cursor: {
          status: 'fail',
          installed_version: '3.5.33',
          failure_stage: 'tier-2',
          last_tier2_status: 'gated',
          last_tier2_detail: 'no owned disposable tier-2 target configured for cursor',
          reason: 'Tier-1 passed; tier-2 gated: no owned disposable tier-2 target configured for cursor',
        },
      },
    },
  };
  const legacyUnavailable = commandValidationForHarness(
    'cursor',
    legacyTier2UnavailableState,
    'send_message',
    { program: program(), root: tempRoot },
  );
  assert.equal(legacyUnavailable.status, 'unavailable',
    'pre-command-state records must migrate without a restart-time send outage');
  assert.equal(legacyUnavailable.executable, true);

  const tier1FailedState = {
    versions: { cursor: '3.5.33' },
    revalidation_program: {
      harnesses: {
        cursor: {
          status: 'fail',
          installed_version: '3.5.33',
          failure_stage: 'tier-1',
          tier1_status: 'failed',
          tier2_status: 'not_run',
          reason: 'composer selector missing',
        },
      },
    },
  };
  const failedCommand = commandValidationForHarness(
    'cursor',
    tier1FailedState,
    'send_message',
    { program: program(), root: tempRoot },
  );
  assert.equal(failedCommand.status, 'failed');
  assert.equal(failedCommand.executable, false,
    'a send-specific tier-1 failure must remain fail-closed');
  assert.equal(validationGateForHarness(
    'cursor',
    tier1FailedState,
    'send_message',
    { program: program(), root: tempRoot },
  ).gated, true);

  const staleCommand = commandValidationForHarness(
    'cursor',
    {
      ...tier2UnavailableState,
      versions: { cursor: '3.5.34' },
    },
    'send_message',
    { program: program(), root: tempRoot },
  );
  assert.equal(staleCommand.status, 'stale');
  assert.equal(staleCommand.executable, false,
    'an installed/validated version mismatch must remain fail-closed');

  const pendingOwnedState = JSON.parse(JSON.stringify(recordedUnavailableState));
  pendingOwnedState.revalidation_program.harnesses.cursor = {
    ...pendingOwnedState.revalidation_program.harnesses.cursor,
    status: 'pending',
    installed_version: '3.5.33',
    command_revalidation_targets: {
      send_message: {
        command: 'send_message',
        installed_version: '3.5.33',
        tier1_status: 'pass',
        disposable: true,
        session_id: 'owned-session',
        cdp_port: 9255,
        staged_at: '2026-07-26T10:00:00Z',
        expires_at: '2026-07-26T10:05:00Z',
      },
    },
  };
  const pendingOwnedGate = validationGateForHarness(
    'cursor',
    pendingOwnedState,
    'send_message',
    {
      program: program(),
      root: tempRoot,
      sessionId: 'owned-session',
      cdpPort: 9255,
      nowMs: Date.parse('2026-07-26T10:01:00Z'),
    },
  );
  assert.equal(pendingOwnedGate.gated, false);
  assert.equal(pendingOwnedGate.partial, true);
  assert.equal(pendingOwnedGate.command_state.basis, 'owned_disposable_tier2_revalidation');
  assert.equal(pendingOwnedGate.command_state.executable, true);
  assert.equal(pendingOwnedGate.command_state.live_verified, false);
  for (const deniedScope of [
    { sessionId: 'other-session', cdpPort: 9255, nowMs: Date.parse('2026-07-26T10:01:00Z') },
    { sessionId: 'owned-session', cdpPort: 9225, nowMs: Date.parse('2026-07-26T10:01:00Z') },
    { sessionId: 'owned-session', cdpPort: 9255, nowMs: Date.parse('2026-07-26T10:06:00Z') },
  ]) {
    assert.equal(validationGateForHarness(
      'cursor',
      pendingOwnedState,
      'send_message',
      { program: program(), root: tempRoot, ...deniedScope },
    ).gated, true, 'pending tier-2 scope must fail closed outside its exact owned target');
  }

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
  assert.equal(restoredState.revalidation_program.harnesses.cursor.tier1_status, 'pass');
  assert.equal(restoredState.revalidation_program.harnesses.cursor.tier2_status, 'pass');
  assert.equal(
    restoredState.revalidation_program.harnesses.cursor.command_states.send_message.status,
    'unavailable',
    'command-scoped tier 1 pass must preserve unavailable owned tier-2 truth',
  );
  assert.equal(
    restoredState.revalidation_program.harnesses.cursor.command_states.send_message.executable,
    true,
  );
  assert.equal(
    restoredState.revalidation_program.harnesses.cursor.command_states.send_message.live_verified,
    false,
  );
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
