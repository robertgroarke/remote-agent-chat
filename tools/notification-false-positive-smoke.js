#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const {
  GoalNotificationCoordinator,
  TURN_READY_NOTIFICATIONS_ENABLED,
} = require('../relay-server/goal-notifications');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
let nowMs = Date.parse('2026-07-15T12:00:00.000Z');
const db = new Database(':memory:');
const coordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });

assert.strictEqual(TURN_READY_NOTIFICATIONS_ENABLED, false);

function activeIdleEdge(sessionId, { goal = null, hydrateIdle = false, stale = false } = {}) {
  nowMs += 5;
  const activeAt = new Date(nowMs).toISOString();
  const active = coordinator.observeActivity(sessionId, {
    kind: 'thinking',
    generating: true,
    started_at: activeAt,
    updated_at: activeAt,
    ...(goal ? { goal } : {}),
  }, { sessionName: sessionId });
  assert.strictEqual(active.events.filter(event => event.event_type === 'turn_ready').length, 0);
  nowMs += 5;
  const idleAt = new Date(stale ? nowMs - 60 * 60 * 1000 : nowMs).toISOString();
  const idle = coordinator.observeActivity(sessionId, {
    kind: 'idle',
    updated_at: idleAt,
    ...(goal ? { goal } : {}),
  }, { sessionName: sessionId, hydrateOnly: hydrateIdle });
  assert.strictEqual(idle.turn_event, null);
  assert.strictEqual(idle.events.filter(event => event.event_type === 'turn_ready').length, 0);
  assert(idle.turn_suppression, `missing suppression diagnostic for ${sessionId}`);
  return idle.turn_suppression.reason;
}

// Replay the measured production distribution: 39 idle edges, 12 sessions.
const measured = [
  ['codex-cli', [8, 7, 6, 4, 1]],
  ['cursor', [6]],
  ['claude', [1, 1, 1, 1]],
  ['codex', [2]],
  ['codex-desktop', [1]],
];
const measuredSuppressionCounts = {};
let measuredEdges = 0;
let measuredSessions = 0;
for (const [harness, perSession] of measured) {
  perSession.forEach((count, sessionIndex) => {
    measuredSessions += 1;
    for (let edge = 0; edge < count; edge += 1) {
      const reason = activeIdleEdge(`measured-${harness}-${sessionIndex}`);
      measuredSuppressionCounts[reason] = (measuredSuppressionCounts[reason] || 0) + 1;
      measuredEdges += 1;
    }
  });
}
assert.strictEqual(measuredSessions, 12);
assert.strictEqual(measuredEdges, 39);
assert.deepStrictEqual(measuredSuppressionCounts, { authoritative_terminal_missing: 39 });
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'turn_ready'").get().count,
  0,
);

// Stress every supported harness with 500 idle/postcondition edges. Goal
// affiliation is deliberately missing, unknown, active, stale, or hydrated.
const harnesses = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo',
  'roo_code', 'cline', 'antigravity', 'antigravity_panel', 'antigravity-v2',
];
const stressSuppressionCounts = {};
let stressEdges = 0;
for (const harness of harnesses) {
  for (let index = 0; index < 500; index += 1) {
    const variant = index % 5;
    const goal = variant === 1 ? {
      objective: `${harness} unknown goal`,
      state: 'unknown',
      transition_id: `${harness}-unknown`,
      transition_seq: 1,
      observed_at: new Date(nowMs).toISOString(),
    } : variant === 2 ? {
      objective: `${harness} active goal`,
      state: 'active',
      transition_id: `${harness}-active`,
      transition_seq: 1,
      observed_at: new Date(nowMs).toISOString(),
    } : null;
    const reason = activeIdleEdge(`stress-${harness}-${variant}`, {
      goal,
      hydrateIdle: variant === 3,
      stale: variant === 4,
    });
    stressSuppressionCounts[reason] = (stressSuppressionCounts[reason] || 0) + 1;
    stressEdges += 1;
  }
}
assert.strictEqual(stressEdges, harnesses.length * 500);
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'turn_ready'").get().count,
  0,
);
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'goal_completed'").get().count,
  0,
);

// Explicit native goal completion remains supported and exactly once.
const goalSession = 'explicit-goal-terminal';
const activeGoal = {
  objective: 'Retain explicit goal completion',
  state: 'active',
  transition_id: 'goal-active-1',
  transition_seq: 1,
  observed_at: new Date(nowMs).toISOString(),
};
coordinator.observeGoal(goalSession, activeGoal, { hydrateOnly: true, sessionName: 'Goal fixture' });
nowMs += 10;
const completed = coordinator.observeGoal(goalSession, {
  ...activeGoal,
  state: 'complete',
  transition_id: 'goal-complete-2',
  transition_seq: 2,
  observed_at: new Date(nowMs).toISOString(),
}, { sessionName: 'Goal fixture' });
assert.strictEqual(completed.event?.event_type, 'goal_completed');

// Old rows may remain for diagnostics, but reconnect feeds must never replay them.
const legacyPayload = {
  type: 'semantic_notification',
  event_type: 'turn_ready',
  category: 'turn_ready',
  dedupe_key: 'turn_ready:legacy-production-row',
  session_id: 'legacy',
  title: 'Turn finished',
  body: 'Legacy idle edge',
  created_at: new Date(nowMs).toISOString(),
};
db.prepare(`
  INSERT INTO semantic_notification_events
    (dedupe_key, session_id, event_type, category, title, body, payload_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  legacyPayload.dedupe_key,
  legacyPayload.session_id,
  legacyPayload.event_type,
  legacyPayload.category,
  legacyPayload.title,
  legacyPayload.body,
  JSON.stringify(legacyPayload),
  legacyPayload.created_at,
);
assert.strictEqual(coordinator.recentEvents().some(event => event.event_type === 'turn_ready'), false);

const relay = read('relay-server/index.js');
const web = read('frontend/semantic-notifications.js');
const worker = read('frontend/sw.js');
const webApp = read('frontend/app.jsx');
const android = read('android-app/lib/semantic-notifications.js');
const androidSettings = read('android-app/screens/SettingsScreen.jsx');
assert(relay.includes('const TURN_READY_NOTIFICATIONS_ENABLED = false'));
assert(relay.includes("new Set(['agent_idle', 'turn_ready'])"));
assert(!relay.includes("agent_idle:           { category: 'agent_ready'"));
assert(!relay.includes("turn_ready:           { category: 'turn_ready'"));
assert(!/SEMANTIC_NOTIFICATION_TYPES = Object\.freeze\(\[\s*'turn_ready'/.test(web));
assert(!/SEMANTIC_NOTIFICATION_TYPES = Object\.freeze\(\[\s*'turn_ready'/.test(android));
assert(worker.includes("['agent_idle', 'turn_ready']"));
assert(webApp.includes('turn_ready: false'));
assert(androidSettings.includes('[PREF_NOTIFY_TURN_READY]: false'));
assert(androidSettings.includes('Unavailable until this harness supplies an authoritative native turn boundary'));

db.close();

const result = {
  ok: true,
  production_replay: {
    sessions: measuredSessions,
    idle_edges: measuredEdges,
    semantic_notifications: 0,
    suppression_counts: measuredSuppressionCounts,
  },
  stress: {
    harnesses: harnesses.length,
    transitions_per_harness: 500,
    idle_edges: stressEdges,
    false_turn_ready: 0,
    false_goal_completed: 0,
    suppression_counts: stressSuppressionCounts,
  },
  explicit_goal_completed: 1,
  legacy_turn_ready_replayed: 0,
  web_android_service_worker_boundaries_fail_closed: true,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
