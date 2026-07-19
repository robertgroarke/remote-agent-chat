#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));
const {
  canonicalGoalRecord,
  reduceGoalRunLifecycle,
} = require('../agent-proxy/goal-lifecycle');

const ROOT = path.join(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-goal-loop-continuity-'));
const BASE_MS = Date.parse('2026-07-16T18:00:00.000Z');
const GAPS_MS = [0, 1_000, 5_000, 15_100, 30_000, 60_000, 120_000];
const ACTIVE_KINDS = new Set(['thinking', 'generating', 'running_command', 'working']);

function compile(sourcePath, name) {
  const outfile = path.join(SCRATCH, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [sourcePath],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return require(outfile);
}

function goal({ state = 'active', generation = 1, previousGoal = null, nowMs = BASE_MS } = {}) {
  return canonicalGoalRecord({
    objective: 'Exercise a redacted continuous goal loop',
    raw_state: state,
    created_at: new Date(BASE_MS - 60_000).toISOString(),
    native_updated_at: new Date(nowMs).toISOString(),
  }, {
    previousGoal,
    sessionKey: 'fixture-session',
    source: 'codex_cli_jsonl',
    sourceCursor: { mode: 'append', end_offset: generation * 10_000 + Math.max(0, nowMs - BASE_MS) },
    nativeUpdatedAt: new Date(nowMs).toISOString(),
    observedAt: new Date(nowMs).toISOString(),
  });
}

function observation(goalRecord, {
  nowMs,
  kind = 'idle',
  evidence = 'current_generation_event',
  live = false,
  owner = 'confirmed',
  turnId = null,
  completedTurnId = null,
  cursor = null,
  explicitStop = false,
  confirmedDisconnect = false,
} = {}) {
  const resolvedCursor = cursor || {
    mode: live ? 'append' : 'unchanged',
    start_offset: Math.max(0, nowMs - BASE_MS),
    end_offset: 10_000 + Math.max(0, nowMs - BASE_MS),
    events_read: live ? 1 : 0,
  };
  return {
    session_key: 'fixture-session',
    goal: goalRecord,
    activity_kind: kind,
    task_started_turn_id: turnId,
    task_completed_turn_id: completedTurnId,
    source: 'codex_cli_jsonl',
    source_cursor: resolvedCursor,
    native_event_at: new Date(nowMs).toISOString(),
    observed_at: new Date(nowMs).toISOString(),
    evidence_type: evidence,
    live_lease_proof: live,
    owner_state: owner,
    explicit_stop: explicitStop,
    confirmed_disconnect: confirmedDisconnect,
  };
}

function activity(goalRecord, run, kind, updatedAtMs) {
  return {
    kind,
    label: '',
    goal: goalRecord,
    goal_run: run,
    updated_at: new Date(updatedAtMs).toISOString(),
    ...(ACTIVE_KINDS.has(kind) ? { generating: true } : {}),
  };
}

function assertStableTransition(previous, next, sameLifecycle) {
  assert(next.transition_seq >= previous.transition_seq, 'lifecycle sequence regressed');
  if (sameLifecycle) assert.strictEqual(next.transition_seq, previous.transition_seq, 'duplicate snapshot advanced lifecycle sequence');
}

function runBoundaryMatrix(webFleet, androidFleet, webGroups, androidGroups) {
  const sessionId = 'constant-session-id';
  const session = { session_id: sessionId, agent_type: 'codex_cli', workspace_path: 'C:\\fixture\\goal' };
  const idleSession = { session_id: 'stable-idle-session', agent_type: 'claude', workspace_path: 'C:\\fixture\\idle' };
  const sessions = [session, idleSession];
  const activeGoal = goal();
  let run = reduceGoalRunLifecycle(null, observation(activeGoal, {
    nowMs: BASE_MS,
    kind: 'generating',
    live: true,
    turnId: 'turn-0',
  }));
  assert.strictEqual(run.lifecycle, 'running_turn');
  assert.strictEqual(run.lease_active, true);
  const runId = run.run_id;
  const classifications = [];
  let departures = 0;
  let reentries = 0;
  let wasWorking = true;
  let rowMoves = 0;
  let remounts = 0;
  let terminalRehomes = 0;
  let webLedger = webGroups.createSidebarWorkingLedger([session]);
  let androidLedger = androidGroups.createSidebarWorkingLedger([session]);
  const stableIndex = webLedger.sessionOrder.indexOf(sessionId);
  let cursor = 10_000;
  for (let index = 0; index < 100; index += 1) {
    const gapMs = GAPS_MS[index % GAPS_MS.length];
    const completedAt = BASE_MS + index * 180_000 + 1_000;
    cursor += 100;
    const beforeSeq = run.transition_seq;
    run = reduceGoalRunLifecycle(run, observation(activeGoal, {
      nowMs: completedAt,
      kind: 'idle',
      live: true,
      turnId: `turn-${index}`,
      completedTurnId: `turn-${index}`,
      evidence: index % 9 === 0 ? 'context_compaction_checkpoint' : 'task_complete',
      cursor: { mode: 'append', start_offset: cursor - 50, end_offset: cursor, events_read: 2 },
    }));
    assert.strictEqual(run.lifecycle, 'checkpoint_pending_continuation');
    assert.strictEqual(run.lease_active, true);
    assert.strictEqual(run.run_id, runId);
    assert(run.transition_seq >= beforeSeq);

    const quietAt = completedAt + gapMs;
    const quietActivity = activity(activeGoal, run, 'idle', completedAt);
    const options = {
      connected: index % 8 !== 0,
      health: index % 8 === 0 ? 'disconnected' : 'healthy',
      nowMs: quietAt,
      requireFreshness: true,
    };
    const webState = webFleet.classifyFleetActivity(quietActivity, false, options);
    const androidState = androidFleet.classifyFleetActivity(quietActivity, false, options);
    assert.strictEqual(androidState, webState);
    classifications.push({ index, gap_ms: gapMs, state: webState, lifecycle: run.lifecycle });
    const working = webFleet.fleetStateIsWorking(webState);
    if (wasWorking && !working) departures += 1;
    if (!wasWorking && working) reentries += 1;
    assert.strictEqual(working, true, `goal left Working now at boundary ${index}, gap=${gapMs}`);
    wasWorking = working;

    const groupOptions = {
      activities: {
        [sessionId]: quietActivity,
        [idleSession.session_id]: { kind: 'idle', updated_at: new Date(completedAt).toISOString() },
      },
      health: { [sessionId]: options.health, [idleSession.session_id]: 'healthy' },
      connected: options.connected,
      nowMs: quietAt,
      requireFreshness: true,
    };
    const webPartition = webGroups.partitionSidebarSessionsByWorking(sessions, groupOptions);
    const androidPartition = androidGroups.partitionSidebarSessionsByWorking(sessions, groupOptions);
    assert.deepStrictEqual(androidPartition.states, webPartition.states);
    assert.deepStrictEqual(webPartition.working.map(item => item.session_id), [sessionId]);
    const webReconciled = webGroups.reconcileSidebarWorkingLedger(webLedger, webPartition.working);
    const androidReconciled = androidGroups.reconcileSidebarWorkingLedger(androidLedger, androidPartition.working);
    if (webReconciled.structuralChanged) rowMoves += 1;
    if (webReconciled.sessions[stableIndex] !== session) remounts += 1;
    assert.deepStrictEqual(androidReconciled.sessions.map(item => item.session_id), webReconciled.sessions.map(item => item.session_id));
    assert.strictEqual(androidReconciled.structuralChanged, webReconciled.structuralChanged);
    webLedger = webReconciled.ledger;
    androidLedger = androidReconciled.ledger;

    const duplicate = reduceGoalRunLifecycle(run, observation(activeGoal, {
      nowMs: quietAt,
      kind: 'idle',
      evidence: 'duplicate_snapshot',
      cursor: { mode: 'unchanged', start_offset: cursor, end_offset: cursor, events_read: 0 },
    }));
    assertStableTransition(run, duplicate, true);
    assert.strictEqual(duplicate.run_id, runId);
    run = duplicate;

    const replay = reduceGoalRunLifecycle(run, observation(activeGoal, {
      nowMs: quietAt,
      kind: 'generating',
      live: true,
      turnId: `turn-${Math.max(0, index - 1)}`,
      evidence: 'reconnect_replay',
      cursor: { mode: 'recovery', start_offset: Math.max(0, cursor - 200), end_offset: cursor - 100, events_read: 4 },
    }));
    assertStableTransition(run, replay, true);
    run = replay;

    cursor += 100;
    run = reduceGoalRunLifecycle(run, observation(activeGoal, {
      nowMs: quietAt,
      kind: index % 6 === 0 ? 'running_command' : 'generating',
      live: true,
      turnId: `turn-${index + 1}`,
      evidence: index % 6 === 0 ? 'silent_tool_continuation' : 'task_started',
      cursor: { mode: 'append', start_offset: cursor - 50, end_offset: cursor, events_read: 1 },
    }));
    assert.strictEqual(run.lifecycle, 'running_turn');
    assert.strictEqual(run.lease_active, true);
    assert.strictEqual(run.run_id, runId);
  }
  assert.strictEqual(departures, 0);
  assert.strictEqual(reentries, 0);
  assert.strictEqual(rowMoves, 0);
  assert.strictEqual(remounts, 0);
  const terminalAt = BASE_MS + 100 * 180_000 + 2_000;
  const completedGoal = terminalGoalFrom(activeGoal, 'complete', terminalAt);
  run = reduceGoalRunLifecycle(run, observation(completedGoal, {
    nowMs: terminalAt,
    kind: 'idle',
    live: true,
    evidence: 'goal_complete',
    cursor: { mode: 'append', start_offset: cursor, end_offset: cursor + 100, events_read: 1 },
  }));
  const terminalPartition = webGroups.partitionSidebarSessionsByWorking(sessions, {
    activities: {
      [sessionId]: activity(completedGoal, run, 'idle', terminalAt),
      [idleSession.session_id]: { kind: 'idle', updated_at: new Date(terminalAt).toISOString() },
    },
    health: { [sessionId]: 'healthy', [idleSession.session_id]: 'healthy' },
    connected: true,
    nowMs: terminalAt,
    requireFreshness: true,
  });
  const terminalReconciled = webGroups.reconcileSidebarWorkingLedger(webLedger, terminalPartition.working);
  if (terminalReconciled.structuralChanged) terminalRehomes += 1;
  assert.deepStrictEqual(terminalPartition.working, []);
  assert.strictEqual(terminalRehomes, 1);
  const terminalReplay = webGroups.reconcileSidebarWorkingLedger(terminalReconciled.ledger, terminalPartition.working);
  assert.strictEqual(terminalReplay.structuralChanged, false);
  assert.strictEqual(terminalRehomes, 1);
  return {
    boundaries: 100,
    departures,
    reentries,
    row_moves: rowMoves,
    remounts,
    terminal_rehomes: terminalRehomes,
    constant_session_id: sessionId,
    run_id: runId,
    classifications,
    run,
  };
}

function terminalGoalFrom(activeGoal, state, nowMs) {
  return canonicalGoalRecord({
    objective: activeGoal.objective,
    raw_state: state,
    created_at: activeGoal.created_at,
    native_updated_at: new Date(nowMs).toISOString(),
  }, {
    previousGoal: activeGoal,
    sessionKey: 'fixture-session',
    source: 'codex_cli_jsonl',
    sourceCursor: { mode: 'append', end_offset: 999_000 + nowMs - BASE_MS },
    nativeUpdatedAt: new Date(nowMs).toISOString(),
    observedAt: new Date(nowMs).toISOString(),
  });
}

function runExitMatrix(webFleet, androidFleet) {
  const cases = [
    ['complete', 'complete', 'idle'],
    ['cancel', 'cancelled', 'idle'],
    ['fail', 'failed', 'needs_attention'],
    ['pause', 'paused', 'idle'],
    ['explicit_stop', 'active', 'idle'],
    ['question', 'active', 'needs_attention'],
    ['blocked', 'blocked', 'needs_attention'],
    ['rate_limited', 'usageLimited', 'needs_attention'],
    ['usage_limited', 'usageLimited', 'needs_attention'],
    ['budget_limited', 'budgetLimited', 'needs_attention'],
    ['confirmed_disconnect', 'active', 'stale'],
  ];
  const results = [];
  for (const [name, goalState, expected] of cases) {
    for (let sample = 0; sample < 5; sample += 1) {
      const startMs = BASE_MS + sample * 10_000;
      const activeGoal = goal({ nowMs: startMs });
      let run = reduceGoalRunLifecycle(null, observation(activeGoal, {
        nowMs: startMs,
        kind: 'generating',
        live: true,
        turnId: `exit-${name}-${sample}`,
      }));
      const exitMs = startMs + 1_500;
      const nextGoal = goalState === 'active' ? activeGoal : terminalGoalFrom(activeGoal, goalState, exitMs);
      const kind = name === 'question' ? 'waiting_for_user'
        : name.includes('limited') || name === 'blocked' ? name
          : name === 'fail' ? 'failed' : 'idle';
      run = reduceGoalRunLifecycle(run, observation(nextGoal, {
        nowMs: exitMs,
        kind,
        live: true,
        explicitStop: name === 'explicit_stop',
        confirmedDisconnect: name === 'confirmed_disconnect',
        owner: name === 'confirmed_disconnect' ? 'gone' : 'confirmed',
        evidence: name,
        cursor: { mode: 'append', start_offset: 200, end_offset: 300 + sample, events_read: 1 },
      }));
      assert.strictEqual(run.lease_active, false, `${name} retained a working lease`);
      const observed = activity(nextGoal, run, kind, exitMs);
      const options = { connected: true, health: 'healthy', nowMs: exitMs, requireFreshness: true };
      const state = webFleet.classifyFleetActivity(observed, false, options);
      assert.strictEqual(state, expected, name);
      assert.strictEqual(androidFleet.classifyFleetActivity(observed, false, options), state, name);
      const duplicate = reduceGoalRunLifecycle(run, observation(nextGoal, {
        nowMs: exitMs + 100,
        kind,
        evidence: `duplicate_${name}`,
        explicitStop: name === 'explicit_stop',
        confirmedDisconnect: name === 'confirmed_disconnect',
        owner: name === 'confirmed_disconnect' ? 'gone' : 'confirmed',
        cursor: { mode: 'unchanged', start_offset: 300 + sample, end_offset: 300 + sample, events_read: 0 },
      }));
      assert.strictEqual(duplicate.transition_seq, run.transition_seq, `${name} duplicate produced a second edge`);
      results.push({ name, sample, state, lifecycle: run.lifecycle, latency_ms: 1_500, transition_seq: run.transition_seq });
    }
  }
  return { cases: cases.length, samples: results.length, max_latency_ms: Math.max(...results.map(item => item.latency_ms)), results };
}

function runStaleMatrix(webFleet, androidFleet) {
  const results = [];
  const bareActive = goal({ nowMs: BASE_MS });
  const bareState = webFleet.classifyFleetActivity({
    kind: 'generating', generating: true, goal: bareActive, updated_at: new Date(BASE_MS).toISOString(),
  }, false, { connected: true, health: 'healthy', nowMs: BASE_MS, requireFreshness: true });
  assert.strictEqual(webFleet.fleetStateIsWorking(bareState), false, 'bare active goal bypassed the producer lease');
  for (let index = 0; index < 50; index += 1) {
    const activeGoal = goal({ nowMs: BASE_MS - (index + 1) * 60_000 });
    const run = reduceGoalRunLifecycle(null, observation(activeGoal, {
      nowMs: BASE_MS,
      kind: index % 2 ? 'idle' : 'generating',
      evidence: index % 3 === 0 ? 'archive_discovery' : index % 3 === 1 ? 'startup_replay' : 'truncated_tail',
      live: false,
      owner: index % 4 === 0 ? 'ambiguous' : 'gone',
      cursor: { mode: index % 2 ? 'baseline' : 'recovery', start_offset: 0, end_offset: 100 + index, events_read: 20 },
    }));
    assert.strictEqual(run.lease_active, false);
    const observed = activity(activeGoal, run, index % 2 ? 'idle' : 'generating', BASE_MS - 60_000);
    const options = { connected: true, health: 'healthy', nowMs: BASE_MS, requireFreshness: true };
    const webState = webFleet.classifyFleetActivity(observed, false, options);
    const androidState = androidFleet.classifyFleetActivity(observed, false, options);
    assert.strictEqual(androidState, webState);
    assert.strictEqual(webFleet.fleetStateIsWorking(webState), false, `stale archive ${index} entered Working now`);
    results.push({ index, state: webState, lifecycle: run.lifecycle });
  }

  const first = goal({ nowMs: BASE_MS });
  let run = reduceGoalRunLifecycle(null, observation(first, {
    nowMs: BASE_MS,
    kind: 'generating',
    live: true,
    turnId: 'generation-one',
    cursor: { mode: 'append', start_offset: 0, end_offset: 1_000, events_read: 2 },
  }));
  const completed = terminalGoalFrom(first, 'complete', BASE_MS + 1_000);
  run = reduceGoalRunLifecycle(run, observation(completed, {
    nowMs: BASE_MS + 1_000,
    kind: 'idle',
    live: true,
    cursor: { mode: 'append', start_offset: 1_000, end_offset: 1_100, events_read: 1 },
  }));
  const terminalSeq = run.transition_seq;
  const replay = reduceGoalRunLifecycle(run, observation(first, {
    nowMs: BASE_MS + 2_000,
    kind: 'generating',
    live: true,
    turnId: 'generation-one',
    evidence: 'old_generation_replay',
    cursor: { mode: 'recovery', start_offset: 100, end_offset: 900, events_read: 8 },
  }));
  assert.strictEqual(replay.lifecycle, run.lifecycle);
  assert.strictEqual(replay.transition_seq, terminalSeq);
  assert.strictEqual(replay.lease_active, false);
  return { stale_archives: results.length, false_working_entries: 0, lifecycle_regressions: 0, results };
}

function runStorm(webFleet, androidFleet) {
  const activeGoal = goal();
  let run = reduceGoalRunLifecycle(null, observation(activeGoal, {
    nowMs: BASE_MS,
    kind: 'generating',
    live: true,
    turnId: 'storm-turn',
  }));
  let membershipEdges = 0;
  let prior = 'working_goal';
  const labels = new Set();
  for (let second = 0; second <= 60; second += 1) {
    const nowMs = BASE_MS + second * 1_000;
    if (second > 0 && second % 11 === 0) {
      run = reduceGoalRunLifecycle(run, observation(activeGoal, {
        nowMs,
        kind: 'idle',
        evidence: 'relay_gap',
        owner: 'ambiguous',
        cursor: { mode: 'unchanged', start_offset: 20_000, end_offset: 20_000, events_read: 0 },
      }));
    } else if (second > 0 && second % 13 === 0) {
      run = reduceGoalRunLifecycle(run, observation(activeGoal, {
        nowMs,
        kind: 'generating',
        evidence: 'owner_revalidated',
        owner: 'confirmed',
        cursor: { mode: 'unchanged', start_offset: 20_000, end_offset: 20_000, events_read: 0 },
      }));
    }
    const observed = activity(activeGoal, run, second % 2 ? 'idle' : 'generating', BASE_MS);
    const options = {
      connected: second % 7 !== 0,
      health: second % 7 === 0 ? 'disconnected' : 'healthy',
      nowMs,
      requireFreshness: true,
    };
    const state = webFleet.classifyFleetActivity(observed, false, options);
    assert.strictEqual(androidFleet.classifyFleetActivity(observed, false, options), state);
    if (state !== prior) membershipEdges += 1;
    assert.strictEqual(webFleet.fleetStateIsWorking(state), true);
    labels.add(webFleet.fleetGoalSubstateLabel(observed, options));
    prior = state;
  }
  return { simulated_seconds: 60, samples: 61, membership_edges: membershipEdges, substates: Array.from(labels).sort() };
}

function main() {
  assert.strictEqual(typeof reduceGoalRunLifecycle, 'function', 'goal-run lifecycle reducer is missing');
  const webFleetPath = path.join(ROOT, 'frontend', 'fleet-activity.js');
  const androidFleetPath = path.join(ROOT, 'android-app', 'lib', 'fleet-activity.js');
  const normalizedSource = filePath => fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(normalizedSource(androidFleetPath), normalizedSource(webFleetPath), 'Web/Android Fleet classifiers drifted');
  const webFleet = compile(webFleetPath, 'web-fleet');
  const androidFleet = compile(androidFleetPath, 'android-fleet');
  const webGroups = compile(path.join(ROOT, 'frontend', 'workspace-groups.js'), 'web-groups');
  const androidGroups = compile(path.join(ROOT, 'android-app', 'lib', 'workspace-groups.js'), 'android-groups');
  assert.strictEqual(typeof webFleet.fleetGoalSubstateLabel, 'function', 'goal-loop substate labels are missing');

  const boundary = runBoundaryMatrix(webFleet, androidFleet, webGroups, androidGroups);
  const exits = runExitMatrix(webFleet, androidFleet);
  const stale = runStaleMatrix(webFleet, androidFleet);
  const storm = runStorm(webFleet, androidFleet);
  const nonGoal = { kind: 'idle', updated_at: new Date(BASE_MS).toISOString() };
  assert.strictEqual(webFleet.classifyFleetActivity(nonGoal, false, {
    connected: true, health: 'healthy', nowMs: BASE_MS, requireFreshness: true,
  }), 'idle', 'ordinary non-goal idle behavior changed');

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    boundary: { ...boundary, classifications: undefined, run: undefined },
    exits: { cases: exits.cases, samples: exits.samples, max_latency_ms: exits.max_latency_ms },
    stale: { stale_archives: stale.stale_archives, false_working_entries: stale.false_working_entries, lifecycle_regressions: stale.lifecycle_regressions },
    storm,
    web_android_classifier_bytes_equal: true,
    ordinary_non_goal_terminal_preserved: true,
  };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(`PASS working-now goal-loop continuity: ${report.boundary.boundaries} boundaries, ${report.exits.samples} authoritative exits, ${report.stale.stale_archives} stale archives, ${report.storm.samples} storm samples`);
}

try {
  main();
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}
