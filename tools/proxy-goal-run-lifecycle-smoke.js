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

  const ownershipEngine = harness();
  const originalOwnerSnapshot = codexCli.runningCodexCliSessionOwners;
  const originalProcessCount = codexCli.runningCodexCliProcessCount;
  const originalInteractiveHistory = codexCli.recentInteractiveSessionIds;
  let snapshot = {
    state: 'confirmed',
    checked_at_ms: NOW,
    owners: new Map([['live-a', new Set([101])], ['live-b', new Set([102])]]),
  };
  ownershipEngine._findCodexCliSummaryByCliId = cliSessionId => ({ cliSessionId, origin: 'exact-owner' });
  try {
    codexCli.runningCodexCliSessionOwners = () => snapshot;
    codexCli.runningCodexCliProcessCount = () => { throw new Error('global process count must not classify ownership'); };
    codexCli.recentInteractiveSessionIds = () => { throw new Error('interactive history must not classify ownership'); };
    assert.deepStrictEqual(
      ownershipEngine._codexCliExternalActiveSummaries(NOW).map(item => item.cliSessionId),
      ['live-a', 'live-b'],
    );
    snapshot = {
      state: 'confirmed',
      checked_at_ms: NOW + 1_000,
      owners: new Map([['live-b', new Set([102])]]),
    };
    assert.deepStrictEqual(
      ownershipEngine._codexCliExternalActiveSummaries(NOW + 1_000).map(item => item.cliSessionId),
      ['live-a', 'live-b'],
      'one owner-free checkpoint must remain inside the bounded continuity grace',
    );
    snapshot = {
      state: 'confirmed',
      checked_at_ms: NOW + 31_000,
      owners: new Map([['live-b', new Set([102])]]),
    };
    assert.deepStrictEqual(
      ownershipEngine._codexCliExternalActiveSummaries(NOW + 31_000).map(item => item.cliSessionId),
      ['live-b'],
      'missing exact owner did not decay inside 120 seconds',
    );
  } finally {
    codexCli.runningCodexCliSessionOwners = originalOwnerSnapshot;
    codexCli.runningCodexCliProcessCount = originalProcessCount;
    codexCli.recentInteractiveSessionIds = originalInteractiveHistory;
  }

  const archiveModeEngine = harness();
  archiveModeEngine._codexCliArchiveDiscoveryEnabled = () => true;
  archiveModeEngine._codexCliArchiveSessionLimit = () => 3;
  archiveModeEngine._codexCliArchiveSummaryVisible = () => true;
  archiveModeEngine._codexCliExternalActiveSummaries = () => [activeDiscovery[0]];
  archiveModeEngine._broadcastSessionSnapshot = () => {};
  const oldLiveFile = path.join(tempRoot, 'old-live.jsonl');
  const removedLiveFile = path.join(tempRoot, 'removed-live.jsonl');
  fs.writeFileSync(oldLiveFile, '{}\n');
  fs.writeFileSync(removedLiveFile, '{}\n');
  archiveModeEngine.sessions.set('old-live', {
    session_id: 'old-live',
    agentType: 'codex_cli',
    cliSessionId: 'old-live',
    codexCliArchiveDiscovered: true,
    codexCliExternalActive: true,
    codexCliFilePath: oldLiveFile,
    activity: { kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString() },
  });
  archiveModeEngine.sessions.set('removed-live', {
    session_id: 'removed-live',
    agentType: 'codex_cli',
    cliSessionId: 'removed-live',
    codexCliArchiveDiscovered: true,
    codexCliExternalActive: true,
    codexCliFilePath: removedLiveFile,
    activity: { kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString() },
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
  assert.strictEqual(archiveModeEngine.sessions.has('removed-live'), true);
  assert.strictEqual(archiveModeEngine.sessions.get('removed-live').codexCliExternalActive, false);
  assert.strictEqual(archiveModeEngine.sessions.get('removed-live').codexCliOwnerDemoted, true);
  assert.strictEqual(archiveModeEngine.sessions.get('removed-live').activity.kind, 'idle');

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

  const exactOwnerSession = {
    session_id: 'exact-owner-first-discovery',
    agentType: 'codex_cli',
    cliSessionId: '019f6b9c-31c1-72c1-8f80-7ff60b163159',
    codexCliExternalActive: true,
    status: 'healthy',
    activity: { kind: 'idle', label: '', updated_at: new Date(NOW).toISOString() },
  };
  engine.sessions.set(exactOwnerSession.session_id, exactOwnerSession);
  engine._setCodexCliActivity(exactOwnerSession.session_id, exactOwnerSession, {
    kind: 'generating', label: 'Working', goal: activeGoal, updated_at: new Date(NOW + 150).toISOString(),
  }, engine._codexCliGoalRunContext({
    sourceCursor: { mode: 'baseline', start_offset: 0, end_offset: 150, events_read: 10 },
    taskStartedTurnId: 'turn-owner',
    activity: { kind: 'generating', goal: activeGoal },
    updatedAt: new Date(NOW + 150).toISOString(),
  }, { ownerState: 'confirmed' }));
  assert.strictEqual(exactOwnerSession.activity.goal_run.lease_active, true);
  assert.strictEqual(exactOwnerSession.activity.goal_run.owner_state, 'confirmed');

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

  const evidenceSession = {
    session_id: 'fresh-evidence-session',
    agentType: 'codex_cli',
    status: 'healthy',
    activity: { kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString() },
  };
  engine.sessions.set(evidenceSession.session_id, evidenceSession);
  const evidenceFramesBefore = engine.sent.length;
  engine._setCodexCliActivity(evidenceSession.session_id, evidenceSession, {
    kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString(),
  }, {
    observedAt: new Date(NOW + 5_000).toISOString(),
    evidenceType: 'poll_append',
    liveLeaseProof: true,
  });
  assert.strictEqual(evidenceSession.activity.observed_at, new Date(NOW + 5_000).toISOString());
  assert.strictEqual(engine.sent.length, evidenceFramesBefore + 1, 'fresh append evidence did not emit a status frame');
  engine._setCodexCliActivity(evidenceSession.session_id, evidenceSession, {
    kind: 'generating', label: 'Working', updated_at: new Date(NOW + 6_000).toISOString(),
  }, {
    observedAt: new Date(NOW + 6_000).toISOString(),
    evidenceType: 'controller_summary_without_new_evidence',
    liveLeaseProof: false,
  });
  assert.strictEqual(evidenceSession.activity.observed_at, new Date(NOW + 5_000).toISOString(),
    'non-evidentiary summary discarded or refreshed the last activity observation');
  const heartbeatFramesBefore = engine.sent.length;
  assert.strictEqual(engine._emitActivityObservationHeartbeat(evidenceSession.session_id, evidenceSession, {
    observedAt: new Date(NOW + 9_999).toISOString(),
  }), false, 'producer heartbeat ignored the bounded coalescing interval');
  assert.strictEqual(engine._emitActivityObservationHeartbeat(evidenceSession.session_id, evidenceSession, {
    observedAt: new Date(NOW + 10_000).toISOString(),
  }), true, 'live producer observation did not refresh active evidence');
  assert.strictEqual(evidenceSession.activity.observed_at, new Date(NOW + 10_000).toISOString());
  assert.strictEqual(engine.sent.length, heartbeatFramesBefore + 1);
  const idleHeartbeatSession = {
    session_id: 'idle-heartbeat-fixture',
    status: 'healthy',
    activity: { kind: 'idle', label: '', updated_at: new Date(NOW).toISOString() },
  };
  assert.strictEqual(engine._emitActivityObservationHeartbeat(idleHeartbeatSession.session_id, idleHeartbeatSession, {
    observedAt: new Date(NOW + 60_000).toISOString(),
  }), false, 'an idle producer observation created active freshness');
  const cursorHeartbeatSession = {
    session_id: 'cursor-heartbeat-fixture',
    agentType: 'cursor_cli',
    status: 'healthy',
    activity: { kind: 'generating', label: 'Cursor CLI running', updated_at: new Date(NOW).toISOString() },
  };
  const cursorFramesBefore = engine.sent.length;
  assert.strictEqual(engine._setCursorCliActivity(cursorHeartbeatSession.session_id, cursorHeartbeatSession, {
    kind: 'generating', label: 'Cursor CLI running', updated_at: new Date(NOW).toISOString(),
  }, { producerObserved: true, observedAt: new Date(NOW + 5_000).toISOString() }), true);
  assert.strictEqual(engine._setCursorCliActivity(cursorHeartbeatSession.session_id, cursorHeartbeatSession, {
    kind: 'generating', label: 'Cursor CLI running', updated_at: new Date(NOW).toISOString(),
  }, { producerObserved: true, observedAt: new Date(NOW + 9_999).toISOString() }), false);
  assert.strictEqual(engine._setCursorCliActivity(cursorHeartbeatSession.session_id, cursorHeartbeatSession, {
    kind: 'generating', label: 'Cursor CLI running', updated_at: new Date(NOW).toISOString(),
  }, { producerObserved: true, observedAt: new Date(NOW + 10_000).toISOString() }), true);
  assert.strictEqual(engine.sent.length, cursorFramesBefore + 2,
    'Cursor CLI producer observations were not coalesced to the heartbeat interval');

  const ownerOnlyEngine = harness();
  ownerOnlyEngine._codexCliGoalMonitorConnectionFactory = () => ({
    on() {}, async start() {}, async getGoal() { return { goal: null }; }, async stop() {},
  });
  ownerOnlyEngine._codexCliGoalMonitorOwnerProbe = async () => ({
    state: 'confirmed', checked_at_ms: NOW + 10_000, pid: 4321,
  });
  const ownerOnlySession = {
    session_id: 'owner-only-working-fixture',
    agentType: 'codex_cli',
    cliSessionId: '019f6b9c-31c1-72c1-8f80-7ff60b163160',
    codexCliExternalActive: true,
    status: 'healthy',
    activity: { kind: 'generating', label: 'Working', updated_at: new Date(NOW).toISOString() },
  };
  ownerOnlyEngine.sessions.set(ownerOnlySession.session_id, ownerOnlySession);
  assert.strictEqual(await ownerOnlyEngine._auditCodexCliGoalController(
    ownerOnlySession.session_id,
    ownerOnlySession,
    { force: true, nowMs: NOW + 10_000 },
  ), true, 'exact owner observation did not refresh an ordinary active Codex CLI session');
  assert.strictEqual(ownerOnlySession.activity.observed_at, new Date(NOW + 10_000).toISOString());
  assert.strictEqual(ownerOnlyEngine.sent.length, 1);
  await ownerOnlyEngine._stopCodexCliGoalMonitor();

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
    exact_owner_bound_discovery: true,
    exact_owner_first_discovery_lease: true,
    global_process_flap_ignored: true,
    interactive_history_visibility_only: true,
    owner_decay_ms: 31_000,
    rotation_twin_demoted_without_delete: true,
    fresh_append_status_emitted: true,
    non_evidentiary_summary_preserved_observation: true,
    active_producer_heartbeat_bounded: true,
    idle_producer_heartbeat_rejected: true,
    cursor_cli_heartbeat_bounded: true,
    exact_owner_activity_heartbeat: true,
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
