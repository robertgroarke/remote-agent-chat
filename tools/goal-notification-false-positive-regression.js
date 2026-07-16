#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { GoalNotificationCoordinator } = require('../relay-server/goal-notifications');

let nowMs = Date.parse('2026-07-15T12:00:00.000Z');
const db = new Database(':memory:');
const coordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });
const suppressionCounts = new Map();

function observe(sessionId, kind, fields = {}) {
  nowMs += 1;
  const result = coordinator.observeActivity(sessionId, {
    kind,
    updated_at: new Date(nowMs).toISOString(),
    ...(kind === 'idle' ? {} : { started_at: new Date(nowMs).toISOString() }),
    ...fields,
  }, { sessionName: sessionId });
  for (const item of result.suppressions || []) {
    suppressionCounts.set(item.reason, (suppressionCounts.get(item.reason) || 0) + 1);
  }
  return result;
}

// Replay the measured production distribution: 39 idle edges, 12 sessions.
const productionShape = [
  ['codex_cli', [8, 7, 5, 4, 2]],
  ['cursor', [6]],
  ['claude', [1, 1, 1, 1]],
  ['codex', [2]],
  ['codex-desktop', [1]],
];
let productionEdges = 0;
for (const [harness, perSession] of productionShape) {
  perSession.forEach((count, sessionIndex) => {
    const sessionId = `production-${harness}-${sessionIndex}`;
    for (let edge = 0; edge < count; edge += 1) {
      observe(sessionId, edge % 2 ? 'thinking' : 'generating');
      const result = observe(sessionId, 'idle');
      assert.strictEqual(result.events.length, 0);
      productionEdges += 1;
    }
  });
}
assert.strictEqual(productionEdges, 39);
assert.strictEqual(suppressionCounts.get('authoritative_terminal_missing'), 39);

// Each supported pipeline receives >=500 deterministic status transitions.
const harnesses = [
  'codex_cli', 'cursor_cli', 'claude_cli', 'codex', 'codex-desktop',
  'claude', 'cursor', 'antigravity_panel', 'continue', 'roo_code',
];
const activeKinds = ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'tool'];
const nonTerminalKinds = ['idle', 'waiting_for_user', 'blocked', 'rate_limited', 'failed'];
for (const harness of harnesses) {
  const sessionId = `matrix-${harness}`;
  for (let transition = 0; transition < 500; transition += 1) {
    const kind = transition % 2 === 0
      ? activeKinds[(transition / 2) % activeKinds.length]
      : nonTerminalKinds[((transition - 1) / 2) % nonTerminalKinds.length];
    const result = observe(sessionId, kind);
    assert.strictEqual(result.events.length, 0, `${harness} emitted on ${kind}`);
  }
}

const stored = db.prepare(`
  SELECT event_type, COUNT(*) AS count
  FROM semantic_notification_events
  GROUP BY event_type
`).all();
assert.deepStrictEqual(stored, []);

const summary = {
  ok: true,
  production_shape: {
    sessions: 12,
    idle_edges: productionEdges,
    semantic_events: 0,
    displayed_cues: 0,
  },
  deterministic_matrix: {
    harnesses: harnesses.length,
    transitions_per_harness: 500,
    transitions_total: harnesses.length * 500,
    false_turn_ready: 0,
    false_goal_completed: 0,
  },
  suppression_counts: Object.fromEntries(suppressionCounts),
};

db.close();
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
