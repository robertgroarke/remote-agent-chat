#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const {
  CANONICAL_GOAL_STATES,
  canonicalGoalRecord,
  normalizeGoalState,
} = require('../agent-proxy/goal-lifecycle');
const { GoalNotificationCoordinator } = require('../relay-server/goal-notifications');
const codexCli = require('../agent-proxy/codex-cli');

let nowMs = Date.parse('2026-07-15T12:00:00.000Z');
const db = new Database(':memory:');
const coordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });
const sessionId = 'goal-loop-smoke';
const objective = 'Prove that goal loop checkpoints stay quiet';

function goal(state, previous = null, fields = {}) {
  nowMs += 1000;
  return canonicalGoalRecord({
    objective,
    raw_state: state,
    created_at: '2026-07-15T11:59:00.000Z',
    native_updated_at: new Date(nowMs).toISOString(),
    native_cursor: { kind: 'codex_cli_jsonl', end_offset: Number(fields.end_offset || nowMs) },
    ...fields,
  }, {
    previousGoal: previous,
    sessionKey: sessionId,
    source: 'codex_cli_jsonl',
    sourceCursor: { kind: 'codex_cli_jsonl', end_offset: Number(fields.end_offset || nowMs) },
    nativeUpdatedAt: new Date(nowMs).toISOString(),
    observedAt: new Date(nowMs).toISOString(),
  });
}

const aliases = {
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
  rate_limited: 'usageLimited',
  budget_limited: 'budgetLimited',
  completed: 'complete',
  canceled: 'cancelled',
  error: 'failed',
};
Object.entries(aliases).forEach(([raw, expected]) => assert.strictEqual(normalizeGoalState(raw), expected));
assert.deepStrictEqual(CANONICAL_GOAL_STATES, [
  'active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete', 'cancelled', 'failed',
]);

let activeGoal = goal('active');
let result = coordinator.observeActivity(sessionId, {
  kind: 'thinking',
  started_at: new Date(nowMs).toISOString(),
  updated_at: new Date(nowMs).toISOString(),
  goal: activeGoal,
}, { sessionName: 'Sol', hydrateOnly: true });
assert.strictEqual(result.events.length, 0);

let loopBoundaryEvents = 0;
for (let index = 0; index < 100; index += 1) {
  nowMs += 10;
  result = coordinator.observeActivity(sessionId, {
    kind: 'idle',
    updated_at: new Date(nowMs).toISOString(),
    goal: activeGoal,
  }, { sessionName: 'Sol' });
  loopBoundaryEvents += result.events.length;
  nowMs += 10;
  result = coordinator.observeActivity(sessionId, {
    kind: index % 2 ? 'generating' : 'thinking',
    started_at: new Date(nowMs).toISOString(),
    updated_at: new Date(nowMs).toISOString(),
    goal: activeGoal,
  }, { sessionName: 'Sol' });
  loopBoundaryEvents += result.events.length;
}
assert.strictEqual(loopBoundaryEvents, 0, 'active goal loop boundaries must remain silent');

const completeGoal = goal('complete', activeGoal);
result = coordinator.observeActivity(sessionId, {
  kind: 'idle',
  updated_at: new Date(nowMs).toISOString(),
  goal: completeGoal,
}, { sessionName: 'Sol' });
assert.strictEqual(result.events.length, 1);
assert.strictEqual(result.events[0].event_type, 'goal_completed');
assert.strictEqual(result.events[0].title, 'Goal completed');
assert.strictEqual(result.events[0].category, 'goal_completed');
const completionDedupeKey = result.events[0].dedupe_key;

for (let index = 0; index < 5; index += 1) {
  result = coordinator.observeActivity(sessionId, {
    kind: 'idle',
    updated_at: new Date(nowMs).toISOString(),
    goal: completeGoal,
  }, { sessionName: 'Sol' });
  assert.strictEqual(result.events.length, 0);
}
const reconnectedCoordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });
result = reconnectedCoordinator.observeActivity(sessionId, {
  kind: 'idle',
  updated_at: new Date(nowMs).toISOString(),
  goal: completeGoal,
}, { sessionName: 'Sol' });
assert.strictEqual(result.events.length, 0, 'relay reconnect must not repeat goal completion');
const twiceReconnectedCoordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });
result = twiceReconnectedCoordinator.observeActivity(sessionId, {
  kind: 'idle',
  updated_at: new Date(nowMs).toISOString(),
  goal: completeGoal,
}, { sessionName: 'Sol' });
assert.strictEqual(result.events.length, 0, 'a second relay reconnect must remain exactly once');
result = twiceReconnectedCoordinator.observeGoal(sessionId, activeGoal, { sessionName: 'Sol' });
assert.strictEqual(result.code, 'out_of_order', 'a delayed active frame must not replace terminal truth');
assert.strictEqual(result.goal.state, 'complete');
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'goal_completed'").get().count,
  1,
);
assert.strictEqual(
  db.prepare('SELECT dedupe_key FROM semantic_notification_events WHERE event_type = ?').get('goal_completed').dedupe_key,
  completionDedupeKey,
);

const missedSid = 'goal-missed-during-reconnect';
const missedActive = canonicalGoalRecord({ objective: 'Reconcile one missed terminal event', raw_state: 'active' }, {
  sessionKey: missedSid,
  source: 'fixture',
  nativeUpdatedAt: new Date(nowMs).toISOString(),
  observedAt: new Date(nowMs).toISOString(),
});
coordinator.observeGoal(missedSid, missedActive, { sessionName: 'Reconnect', hydrateOnly: true });
nowMs += 1000;
const missedComplete = canonicalGoalRecord({ objective: missedActive.objective, raw_state: 'complete' }, {
  previousGoal: missedActive,
  sessionKey: missedSid,
  source: 'fixture',
  nativeUpdatedAt: new Date(nowMs).toISOString(),
  observedAt: new Date(nowMs).toISOString(),
});
const afterBriefDisconnect = new GoalNotificationCoordinator(db, { now: () => nowMs });
result = afterBriefDisconnect.observeGoal(missedSid, missedComplete, {
  sessionName: 'Reconnect',
  hydrateOnly: true,
  reconcileLive: true,
});
assert.strictEqual(result.event?.event_type, 'goal_completed', 'a fresh missed terminal transition must reconcile');
const afterSecondBriefDisconnect = new GoalNotificationCoordinator(db, { now: () => nowMs });
result = afterSecondBriefDisconnect.observeGoal(missedSid, missedComplete, {
  sessionName: 'Reconnect',
  hydrateOnly: true,
  reconcileLive: true,
});
assert.strictEqual(result.event, null, 'reconciled terminal transition must not replay');

const attentionStates = ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'cancelled', 'failed'];
for (const state of attentionStates) {
  const sid = `goal-${state}`;
  const active = canonicalGoalRecord({ objective: `State ${state}`, raw_state: 'active' }, {
    sessionKey: sid, source: 'fixture', nativeUpdatedAt: '2026-07-15T12:00:00.000Z', observedAt: '2026-07-15T12:00:00.000Z',
  });
  coordinator.observeGoal(sid, active, { sessionName: state, hydrateOnly: true });
  const next = canonicalGoalRecord({ objective: `State ${state}`, raw_state: state }, {
    previousGoal: active, sessionKey: sid, source: 'fixture', nativeUpdatedAt: '2026-07-15T12:00:01.000Z', observedAt: '2026-07-15T12:00:01.000Z',
  });
  const transition = coordinator.observeGoal(sid, next, { sessionName: state });
  assert.strictEqual(transition.event?.event_type, 'goal_attention');
  assert.notStrictEqual(transition.event?.title, 'Goal completed');
}

const unknownSid = 'goal-unknown';
coordinator.observeGoal(unknownSid, canonicalGoalRecord({ objective: 'Unknown metadata', raw_state: '' }, {
  sessionKey: unknownSid, source: 'fixture', observedAt: new Date(nowMs).toISOString(), nativeUpdatedAt: null,
}), { sessionName: 'Unknown', hydrateOnly: true });
result = coordinator.observeActivity(unknownSid, { kind: 'idle', updated_at: new Date(nowMs).toISOString() }, { sessionName: 'Unknown' });
assert.strictEqual(result.events.length, 0, 'missing/unknown goal state must fail closed');

const ordinarySid = 'ordinary-turn';
const ordinaryStart = new Date(nowMs).toISOString();
coordinator.observeActivity(ordinarySid, {
  kind: 'generating', started_at: ordinaryStart, updated_at: ordinaryStart,
}, { sessionName: 'Ordinary', hydrateOnly: true });
nowMs += 1000;
result = coordinator.observeActivity(ordinarySid, {
  kind: 'idle', updated_at: new Date(nowMs).toISOString(),
}, { sessionName: 'Ordinary' });
assert.strictEqual(result.events.length, 0, 'idle-only turn boundaries must fail closed');
assert.deepStrictEqual(
  result.suppressions.map(item => item.reason),
  ['authoritative_terminal_missing'],
);
assert.strictEqual(result.turn_suppression?.reason, 'authoritative_terminal_missing');
result = coordinator.observeActivity(ordinarySid, {
  kind: 'idle', updated_at: new Date(nowMs).toISOString(),
}, { sessionName: 'Ordinary' });
assert.strictEqual(result.events.length, 0, 'duplicate idle frames must not repeat turn-ready');

const newGoal = canonicalGoalRecord({ objective, raw_state: 'active' }, {
  previousGoal: completeGoal,
  sessionKey: sessionId,
  source: 'codex_extension_dom',
  observedAt: new Date(nowMs).toISOString(),
  nativeUpdatedAt: null,
});
assert.notStrictEqual(newGoal.fingerprint, completeGoal.fingerprint, 'terminal -> active is a new goal generation');
result = coordinator.observeGoal(sessionId, newGoal, { sessionName: 'Sol' });
assert.strictEqual(result.event, null, 'starting a new goal is state, not completion');
result = coordinator.observeGoal(sessionId, completeGoal, { sessionName: 'Sol' });
assert.strictEqual(result.code, 'out_of_order', 'an older goal generation must not mask the new active goal');
assert.strictEqual(result.goal.fingerprint, newGoal.fingerprint);

const fixturePath = path.join(os.tmpdir(), `rac-goal-terminal-${process.pid}-${Date.now()}.jsonl`);
const cliSessionId = '00000000-0000-4000-8000-00000000aa15';
const cliActive = {
  timestamp: '2026-07-15T12:00:00.000Z',
  type: 'event_msg',
  payload: { type: 'thread_goal_updated', goal: { objective: 'CLI terminal persistence', status: 'active', createdAt: 1784145540, updatedAt: 1784145600 } },
};
const cliComplete = {
  timestamp: '2026-07-15T12:00:02.000Z',
  type: 'event_msg',
  payload: { type: 'thread_goal_updated', goal: { objective: 'CLI terminal persistence', status: 'complete', createdAt: 1784145540, updatedAt: 1784145602 } },
};
const completeJson = JSON.stringify(cliComplete);
try {
  fs.writeFileSync(fixturePath, [
    JSON.stringify({ timestamp: '2026-07-15T11:59:00.000Z', type: 'session_meta', payload: { id: cliSessionId, cwd: process.cwd() } }),
    JSON.stringify(cliActive),
    completeJson.slice(0, 60),
  ].join('\n'));
  let summary = codexCli.readSessionSummary(fixturePath);
  assert.strictEqual(summary.activity.goal.state, 'active', 'partial final goal event must not apply early');
  fs.appendFileSync(fixturePath, `${completeJson.slice(60)}\n`);
  summary = codexCli.readSessionSummary(fixturePath);
  assert.strictEqual(summary.activity.goal.state, 'complete');
  assert.strictEqual(summary.activity.goal.raw_state, 'complete');
  assert.strictEqual(summary.activity.goal.source, 'codex_cli_jsonl');
  assert(summary.activity.goal.objective_hash);
  assert(summary.activity.goal.fingerprint);
  assert(summary.activity.goal.native_cursor?.end_offset > 0);
  assert(summary.activity.goal.transition_seq >= 2);
} finally {
  try { fs.unlinkSync(fixturePath); } catch {}
  db.close();
}

const resultSummary = {
  ok: true,
  canonical_states: CANONICAL_GOAL_STATES,
  active_loop_boundaries: 100,
  false_completion_events: loopBoundaryEvents,
  goal_completion_events: 1,
  attention_states: attentionStates.length,
  turn_ready_events: 0,
  idle_only_suppressions: 1,
  reconnects_tested: 2,
  reconnect_duplicates: 0,
  reconciled_missed_terminal_events: 1,
  out_of_order_frames_rejected: 2,
  completion_dedupe_key: completionDedupeKey,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(resultSummary, null, 2)}\n`);
}
console.log(JSON.stringify(resultSummary, null, 2));
