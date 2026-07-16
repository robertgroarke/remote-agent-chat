#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const {
  GoalNotificationCoordinator,
  REQUIRED_TURN_TERMINAL_GATES,
  TURN_READY_CAPABILITIES,
  TURN_READY_NOTIFICATIONS_ENABLED,
  turnReadyCapabilityForHarness,
} = require('../relay-server/goal-notifications');

const expectedHarnesses = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo',
  'roo_code', 'cline', 'antigravity', 'antigravity_panel', 'antigravity-v2',
].sort();
assert.deepStrictEqual(Object.keys(TURN_READY_CAPABILITIES).sort(), expectedHarnesses);
assert.strictEqual(TURN_READY_NOTIFICATIONS_ENABLED, false);
assert.deepStrictEqual(REQUIRED_TURN_TERMINAL_GATES, [
  'stable_turn_id',
  'correlated_start_terminal_cursors',
  'terminal_reason_completed',
  'settled_final_output',
  'zero_pending_work',
  'explicit_non_goal_affiliation',
]);

for (const harness of expectedHarnesses) {
  const capability = turnReadyCapabilityForHarness(harness);
  assert.strictEqual(capability.status, 'GATED_OFF', `${harness} status drifted`);
  assert.strictEqual(capability.enabled, false, `${harness} unexpectedly enabled`);
  assert.strictEqual(capability.advertised, false, `${harness} unexpectedly advertised`);
  assert(capability.observed_source, `${harness} source is undocumented`);
  assert.deepStrictEqual(capability.missing, REQUIRED_TURN_TERMINAL_GATES);
}
assert.strictEqual(
  TURN_READY_CAPABILITIES.codex_cli.native_terminal_source,
  'event_msg.task_started + event_msg.task_complete',
);
assert.strictEqual(turnReadyCapabilityForHarness('future_harness').status, 'GATED_OFF');

let nowMs = Date.parse('2026-07-15T13:00:00.000Z');
const db = new Database(':memory:');
const coordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });
for (const harness of expectedHarnesses) {
  const sessionId = `turn-capability-${harness}`;
  const active = coordinator.observeActivity(sessionId, {
    kind: 'thinking',
    started_at: new Date(nowMs).toISOString(),
    updated_at: new Date(nowMs).toISOString(),
  }, { harness });
  assert.strictEqual(active.events.length, 0);
  nowMs += 10;
  const idle = coordinator.observeActivity(sessionId, {
    kind: 'idle',
    updated_at: new Date(nowMs).toISOString(),
    turn_terminal: {
      turn_id: `${harness}-untrusted-fixture`,
      reason: 'completed',
    },
  }, { harness });
  assert.strictEqual(idle.events.length, 0, `${harness} emitted while gated off`);
  assert.strictEqual(idle.turn_suppression?.reason, 'authoritative_terminal_missing');
  assert.strictEqual(idle.turn_suppression?.capability_status, 'GATED_OFF');
  assert.strictEqual(idle.turn_capability, TURN_READY_CAPABILITIES[harness]);
  nowMs += 10;
}

const forged = coordinator._event(
  'turn-capability-forged',
  'turn_ready',
  'turn_ready',
  'Fixture',
  null,
  'turn_ready:forged',
  new Date(nowMs).toISOString(),
  { harness: 'codex_cli', goalAffiliation: 'explicitly_no_goal' },
);
assert.strictEqual(forged, null);
const eventCount = db.prepare(
  "SELECT COUNT(*) AS count FROM semantic_notification_events WHERE event_type = 'turn_ready'",
).get().count;
assert.strictEqual(Number(eventCount), 0);
db.close();

const registry = Object.fromEntries(expectedHarnesses.map(harness => {
  const capability = TURN_READY_CAPABILITIES[harness];
  return [harness, {
    status: capability.status,
    observed_source: capability.observed_source,
    native_terminal_source: capability.native_terminal_source,
    missing: capability.missing,
  }];
}));
const result = {
  ok: true,
  harnesses_audited: expectedHarnesses.length,
  enabled_harnesses: 0,
  advertised_harnesses: 0,
  gated_off_harnesses: expectedHarnesses.length,
  required_gates: REQUIRED_TURN_TERMINAL_GATES,
  registry,
  forged_complete_envelope_events: 0,
  persisted_turn_ready_events: 0,
  visible_windows_opened: 0,
  focus_actions: 0,
  production_mutations: 0,
  generated_at: new Date().toISOString(),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
