#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-goal-run-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const codexCli = require('../agent-proxy/codex-cli');
const { canonicalGoalRecord } = require('../agent-proxy/goal-lifecycle');
const {
  ProxyEngine,
  mergeCodexCliArchiveDiscoverySummaries,
} = require('../agent-proxy/proxy-engine');

const NOW = Date.parse('2026-07-16T20:00:00.000Z');
const SESSION_ID = 'proxy-goal-run-fixture';
const CLI_ID = '019f6b9c-31c1-72c1-8f80-7ff60b163158';

function goal(previousGoal = null, state = 'active', generation = 1, offset = 100) {
  const record = canonicalGoalRecord({
    objective: 'PRIVATE OBJECTIVE MUST NEVER ENTER DIAGNOSTICS',
    raw_state: state,
    created_at: new Date(NOW - 60_000).toISOString(),
    native_updated_at: new Date(NOW + offset).toISOString(),
  }, {
    previousGoal,
    sessionKey: CLI_ID,
    source: 'codex_cli_jsonl',
    sourceCursor: { mode: 'append', end_offset: offset },
    nativeUpdatedAt: new Date(NOW + offset).toISOString(),
    observedAt: new Date(NOW + offset).toISOString(),
  });
  return generation === record.generation ? record : {
    ...record,
    fingerprint: `goal-generation-${generation}`,
    generation,
  };
}

function context({ offset, live, started = null, completed = null, owner = 'confirmed', evidence = 'fixture' }) {
  return {
    taskStartedTurnId: started,
    taskCompletedTurnId: completed,
    source: 'codex_cli_jsonl',
    sourceCursor: { mode: live ? 'append' : 'unchanged', start_offset: Math.max(0, offset - 10), end_offset: offset, events_read: live ? 1 : 0 },
    nativeEventAt: new Date(NOW + offset).toISOString(),
    observedAt: new Date(NOW + offset).toISOString(),
    evidenceType: evidence,
    liveLeaseProof: live,
    ownerState: owner,
  };
}

function harness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._log = (level, message) => engine.logs.push({ level, message });
  return engine;
}

async function main() {
  const activeDiscovery = [
    { cliSessionId: 'live-a', origin: 'active' },
    { cliSessionId: 'live-b', origin: 'active' },
  ];
  const archiveDiscovery = [
    { cliSessionId: 'archive-a', origin: 'archive' },
    { cliSessionId: 'live-a', origin: 'archive-duplicate' },
    { cliSessionId: 'archive-b', origin: 'archive' },
  ];
  const mergedDiscovery = mergeCodexCliArchiveDiscoverySummaries(
    activeDiscovery,
    archiveDiscovery,
    3,
  );
  assert.deepStrictEqual(
    mergedDiscovery.summaries.map(summary => summary.cliSessionId),
    ['live-a', 'live-b', 'archive-a'],
  );
  assert.strictEqual(mergedDiscovery.summaries[0].origin, 'active');
  assert.strictEqual(mergedDiscovery.externalActiveIds.has('live-a'), true);
  assert.strictEqual(mergedDiscovery.externalActiveIds.has('archive-a'), false);

  const archiveModeEngine = harness();
  archiveModeEngine._codexCliArchiveDiscoveryEnabled = () => true;
  archiveModeEngine._codexCliArchiveSessionLimit = () => 3;
  archiveModeEngine._codexCliArchiveSummaryVisible = () => true;
  archiveModeEngine._codexCliExternalActiveSummaries = () => [activeDiscovery[0]];
  archiveModeEngine._broadcastSessionSnapshot = () => {};
  archiveModeEngine.sessions.set('old-live', {
    session_id: 'old-live',
    agentType: 'codex_cli',
    cliSessionId: 'old-live',
    codexCliArchiveDiscovered: true,
    codexCliExternalActive: true,
  });
  archiveModeEngine.sessions.set('removed-live', {
    session_id: 'removed-live',
    agentType: 'codex_cli',
    cliSessionId: 'removed-live',
    codexCliArchiveDiscovered: true,
    codexCliExternalActive: true,
  });
  const registrations = [];
  archiveModeEngine._registerCodexCliSession = (summary, options) => {
    registrations.push({ cliSessionId: summary.cliSessionId, ...options });
    const existing = Array.from(archiveModeEngine.sessions.values())
      .find(session => session.cliSessionId === summary.cliSessionId);
    if (existing) existing.codexCliExternalActive = options.externalActive === true;
    return existing || summary;
  };
  const originalDiscoverSessions = codexCli.discoverSessions;
  try {
    codexCli.discoverSessions = () => [
      archiveDiscovery[0],
      { cliSessionId: 'old-live', origin: 'archive' },
    ];
    await archiveModeEngine._discoverCodexCliSessions();
  } finally {
    codexCli.discoverSessions = originalDiscoverSessions;
  }
  assert.deepStrictEqual(
    registrations.map(item => [item.cliSessionId, item.externalActive]),
    [['live-a', true], ['archive-a', false], ['old-live', false]],
  );
  assert.strictEqual(archiveModeEngine.sessions.get('old-live').codexCliExternalActive, false);
  assert.strictEqual(archiveModeEngine.sessions.has('removed-live'), false);

  const engine = harness();
  const activeGoal = goal();
  const session = {
    session_id: SESSION_ID,
    agentType: 'codex_cli',
    cliSessionId: CLI_ID,
    codexCliExternalActive: true,
    status: 'healthy',
    activity: { kind: 'idle', label: '', updated_at: new Date(NOW).toISOString() },
  };
  engine.sessions.set(SESSION_ID, session);

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'generating', label: 'Working', goal: activeGoal, updated_at: new Date(NOW + 100).toISOString(),
  }, context({ offset: 100, live: false, started: 'turn-1', owner: 'ambiguous', evidence: 'archive_baseline' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'unknown_disconnected');
  assert.strictEqual(session.activity.goal_run.lease_active, false);

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'generating', label: 'Working', goal: activeGoal, updated_at: new Date(NOW + 200).toISOString(),
  }, context({ offset: 200, live: true, started: 'turn-1', evidence: 'watch_append' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'running_turn');
  assert.strictEqual(session.activity.goal_run.lease_active, true);
  const runId = session.activity.goal_run.run_id;

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'idle', label: '', goal: activeGoal, updated_at: new Date(NOW + 300).toISOString(),
  }, context({ offset: 300, live: true, started: 'turn-1', completed: 'turn-1', evidence: 'task_complete' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'checkpoint_pending_continuation');
  assert.strictEqual(session.activity.goal_run.lease_active, true);
  assert.strictEqual(session.activity.goal_run.run_id, runId);
  assert.strictEqual(session.activity.label, 'Waiting for next goal turn');

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'idle', label: '', goal: activeGoal, updated_at: new Date(NOW + 30_000).toISOString(),
  }, context({ offset: 300, live: false, started: 'turn-1', completed: 'turn-1', owner: 'ambiguous', evidence: 'relay_gap' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'verifying');
  assert.strictEqual(session.activity.goal_run.lease_active, true);
  assert.strictEqual(session.activity.label, 'Reconnecting');

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'idle', label: '', goal: activeGoal, updated_at: new Date(NOW + 31_500).toISOString(),
  }, context({ offset: 300, live: false, started: 'turn-1', completed: 'turn-1', owner: 'gone', evidence: 'confirmed_owner_gone' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'unknown_disconnected');
  assert.strictEqual(session.activity.goal_run.lease_active, false);
  const disconnectedSeq = session.activity.goal_run.transition_seq;

  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'generating', label: 'Working', goal: activeGoal, updated_at: new Date(NOW + 32_000).toISOString(),
  }, context({ offset: 250, live: true, started: 'turn-1', evidence: 'old_replay' }));
  assert.strictEqual(session.activity.goal_run.lifecycle, 'unknown_disconnected');
  assert.strictEqual(session.activity.goal_run.transition_seq, disconnectedSeq);
  assert.strictEqual(session.activity.goal_run.lease_active, false);

  const generationTwo = goal(null, 'active', 2, 500);
  engine._setCodexCliActivity(SESSION_ID, session, {
    kind: 'generating', label: 'Working', goal: generationTwo, updated_at: new Date(NOW + 500).toISOString(),
  }, context({ offset: 500, live: true, started: 'turn-generation-2', evidence: 'new_generation' }));
  assert.strictEqual(session.activity.goal_run.goal_generation, 2);
  assert.strictEqual(session.activity.goal_run.lifecycle, 'running_turn');
  assert.strictEqual(session.activity.goal_run.lease_active, true);
  assert.notStrictEqual(session.activity.goal_run.run_id, runId);

  const originalOwnerProbe = codexCli.codexCliSessionOwnerState;
  const ownerSamples = [
    { state: 'missing', checked_at_ms: 1_000 },
    { state: 'missing', checked_at_ms: 1_800 },
    { state: 'missing', checked_at_ms: 2_600 },
  ];
  try {
    codexCli.codexCliSessionOwnerState = () => ownerSamples.shift();
    const auditSession = { cliSessionId: CLI_ID };
    assert.strictEqual(engine._codexCliGoalRunOwnerState(auditSession), 'ambiguous');
    assert.strictEqual(engine._codexCliGoalRunOwnerState(auditSession), 'ambiguous');
    assert.strictEqual(engine._codexCliGoalRunOwnerState(auditSession), 'gone');
  } finally {
    codexCli.codexCliSessionOwnerState = originalOwnerProbe;
  }

  const logText = engine.logs.map(item => item.message).join('\n');
  assert(!logText.includes('PRIVATE OBJECTIVE'));
  assert(!logText.includes('C:\\'));
  assert(logText.includes('session='));
  assert(logText.includes('generation='));
  assert(logText.includes('source_seq='));
  assert(engine.sent.some(message => message.type === 'proxy_status' && message.activity?.goal_run));

  const controllerEngine = harness();
  let controllerStatus = 'active';
  let controllerReads = 0;
  const controllerConnection = {
    started: false,
    on() {},
    async start() { this.started = true; },
    async getGoal(threadId) {
      assert.strictEqual(threadId, CLI_ID);
      controllerReads += 1;
      return { goal: {
        objective: 'PRIVATE CONTROLLER OBJECTIVE',
        status: controllerStatus,
        createdAt: Math.floor((NOW - 60_000) / 1000),
        updatedAt: Math.floor((NOW + controllerReads * 1000) / 1000),
        timeUsedSeconds: controllerReads,
        tokensUsed: controllerReads * 10,
      } };
    },
    async stop() { this.started = false; },
  };
  controllerEngine._codexCliGoalMonitorConnectionFactory = () => controllerConnection;
  controllerEngine._codexCliGoalMonitorOwnerProbe = async () => ({
    state: 'confirmed', checked_at_ms: NOW, pid: 1234,
  });
  const controllerSession = {
    session_id: `${SESSION_ID}-controller`,
    agentType: 'codex_cli',
    cliSessionId: CLI_ID,
    codexCliExternalActive: true,
    status: 'healthy',
    activity: { kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString() },
  };
  controllerEngine.sessions.set(controllerSession.session_id, controllerSession);
  const acquired = await controllerEngine._auditCodexCliGoalController(
    controllerSession.session_id,
    controllerSession,
    { force: true, nowMs: NOW },
  );
  assert.strictEqual(acquired, true);
  assert.strictEqual(controllerSession.activity.goal.state, 'active');
  assert.strictEqual(controllerSession.activity.goal_run.lifecycle, 'running_turn');
  assert.strictEqual(controllerSession.activity.goal_run.lease_active, true);
  assert.strictEqual(controllerSession.activity.goal_run.evidence_type, 'native_goal_controller');
  const controllerRunId = controllerSession.activity.goal_run.run_id;

  controllerStatus = 'complete';
  const released = await controllerEngine._auditCodexCliGoalController(
    controllerSession.session_id,
    controllerSession,
    { force: true, nowMs: NOW + 1000 },
  );
  assert.strictEqual(released, true);
  assert.strictEqual(controllerSession.activity.goal_run.lifecycle, 'completed_cancelled_failed');
  assert.strictEqual(controllerSession.activity.goal_run.lease_active, false);
  assert.strictEqual(controllerSession.activity.goal_run.run_id, controllerRunId);
  assert.strictEqual(controllerReads, 2);
  await controllerEngine._stopCodexCliGoalMonitor();

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    producer_transitions: engine.logs.filter(item => item.message.includes('[goal-run]')).length,
    relay_frames: engine.sent.filter(message => message.type === 'proxy_status').length,
    archive_false_start: 0,
    checkpoint_working_edges: 0,
    confirmed_disconnect_ms: 1600,
    replay_regressions: 0,
    new_generation_started: true,
    controller_lease_acquired: true,
    controller_terminal_released: true,
    archive_mode_live_lease_eligible: true,
    archive_mode_stale_lease_ineligible: true,
    diagnostics_redacted: true,
  };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
}

main().finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
