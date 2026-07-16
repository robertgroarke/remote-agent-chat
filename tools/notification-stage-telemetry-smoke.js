#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { GoalNotificationCoordinator } = require('../relay-server/goal-notifications');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
let nowMs = Date.parse('2026-07-15T13:00:00.000Z');
const db = new Database(':memory:');
const coordinator = new GoalNotificationCoordinator(db, { now: () => nowMs });

function iso() {
  return new Date(nowMs).toISOString();
}

const sessionId = 'notification-telemetry-codex-cli';
coordinator.observeActivity(sessionId, {
  kind: 'thinking',
  started_at: iso(),
  updated_at: iso(),
}, { harness: 'codex_cli', sessionName: 'Telemetry fixture' });
nowMs += 1000;
const idle = coordinator.observeActivity(sessionId, {
  kind: 'idle',
  updated_at: iso(),
}, { harness: 'codex_cli', sessionName: 'Telemetry fixture' });
assert.strictEqual(idle.events.length, 0, 'idle edge must remain notification-silent');
assert.strictEqual(idle.turn_suppression.reason, 'authoritative_terminal_missing');

const objective = 'Verify content-free notification telemetry';
const activeGoal = {
  objective,
  fingerprint: 'goal:telemetry-fixture',
  generation: 1,
  state: 'active',
  raw_state: 'active',
  transition_seq: 1,
  transition_id: 'goal-transition:telemetry-active',
  native_updated_at: iso(),
  observed_at: iso(),
  source: 'fixture',
};
coordinator.observeGoal(sessionId, activeGoal, {
  harness: 'codex_cli',
  sessionName: 'Telemetry fixture',
});
nowMs += 1000;
const completed = coordinator.observeGoal(sessionId, {
  ...activeGoal,
  state: 'complete',
  raw_state: 'completed',
  transition_seq: 2,
  transition_id: 'goal-transition:telemetry-complete',
  native_updated_at: iso(),
  observed_at: iso(),
}, { harness: 'codex_cli', sessionName: 'Telemetry fixture' });
assert(completed.event, 'explicit native goal completion must create one semantic event');

coordinator.recordStage(completed.event, 'dispatched', {
  preferenceRevision: '2026-07-15 13:00:00',
  clientChannel: 'websocket-live',
  metadata: {
    client_id: 'fixture-client',
    delivery_result: 'socket_sent',
    forbidden_content: 'DO-NOT-PERSIST-THIS',
  },
});
assert.strictEqual(coordinator.recordClientStage(completed.event.dedupe_key, 'claimed', {
  preferenceRevision: '2026-07-15 13:00:00',
  clientChannel: 'web-in-app',
}).ok, true);
assert.strictEqual(coordinator.recordClientStage(completed.event.dedupe_key, 'displayed', {
  preferenceRevision: '2026-07-15 13:00:00',
  clientChannel: 'web-in-app',
}).ok, true);
assert.strictEqual(coordinator.recordClientStage(completed.event.dedupe_key, 'displayed', {
  preferenceRevision: '2026-07-15 13:00:00',
  clientChannel: 'web-in-app',
}).duplicate, true, 'duplicate client receipts must be idempotent');
assert.deepStrictEqual(
  coordinator.recordClientStage('unknown:event', 'displayed', { clientChannel: 'web-in-app' }),
  { ok: false, code: 'unknown_event' },
  'clients must not invent displayed events',
);
assert.strictEqual(
  coordinator.recordClientStage(completed.event.dedupe_key, 'candidate', { clientChannel: 'web-in-app' }).code,
  'invalid_stage',
  'clients cannot forge classifier stages',
);

const rows = db.prepare('SELECT * FROM semantic_notification_telemetry ORDER BY id').all();
const stages = Object.fromEntries(
  db.prepare('SELECT stage, COUNT(*) AS count FROM semantic_notification_telemetry GROUP BY stage')
    .all().map(row => [row.stage, Number(row.count)]),
);
assert.deepStrictEqual(stages, {
  candidate: 2,
  claimed: 1,
  dispatched: 1,
  displayed: 1,
  eligible: 1,
  suppressed: 1,
});
assert(rows.some(row => row.reason_code === 'authoritative_terminal_missing'));
assert(rows.some(row => row.harness === 'codex_cli'));
assert(rows.some(row => row.goal_affiliation === 'active_terminal_goal'));
assert(rows.some(row => row.native_event_id === 'goal-transition:telemetry-complete'));
assert(rows.some(row => row.preference_revision === '2026-07-15 13:00:00'));
assert(rows.some(row => row.client_channel === 'web-in-app'));

const columns = db.prepare('PRAGMA table_info(semantic_notification_telemetry)').all().map(row => row.name);
for (const forbidden of ['title', 'body', 'content', 'message', 'email', 'endpoint', 'token']) {
  assert(!columns.includes(forbidden), `telemetry schema must not persist ${forbidden}`);
}
const serializedRows = JSON.stringify(rows);
assert(!serializedRows.includes(objective), 'goal objective must not enter telemetry');
assert(!serializedRows.includes('Telemetry fixture'), 'session display name must not enter telemetry');
assert(!serializedRows.includes('DO-NOT-PERSIST-THIS'), 'non-allowlisted metadata must be discarded');

const diagnostics = coordinator.diagnostics({ maxAgeMs: 60 * 60 * 1000 });
assert.strictEqual(diagnostics.total, rows.length);
assert(diagnostics.by_stage.some(row => row.key === 'displayed' && row.count === 1));
assert(diagnostics.by_reason.some(row => row.key === 'authoritative_terminal_missing' && row.count === 1));
assert(diagnostics.by_channel.some(row => row.key === 'web-in-app' && row.count === 2));
assert(diagnostics.by_harness.some(row => row.key === 'codex_cli'));

const legacyDb = new Database(':memory:');
legacyDb.exec(`
  CREATE TABLE semantic_notification_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stage TEXT NOT NULL,
    reason_code TEXT,
    harness TEXT NOT NULL DEFAULT 'unknown',
    goal_affiliation TEXT NOT NULL DEFAULT 'unknown',
    preference_revision TEXT,
    client_channel TEXT,
    native_event_id TEXT,
    turn_id TEXT,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  INSERT INTO semantic_notification_telemetry
    (dedupe_key, session_id, event_type, stage, occurred_at)
  VALUES ('legacy-event', 'legacy-session', 'goal_attention', 'eligible', '2026-07-15T12:00:00.000Z');
`);
new GoalNotificationCoordinator(legacyDb, { now: () => nowMs });
assert.strictEqual(
  legacyDb.prepare('SELECT stage_key FROM semantic_notification_telemetry WHERE id = 1').get().stage_key,
  'legacy:1',
  'existing telemetry tables must receive stable migration keys',
);
legacyDb.close();

const relay = read('relay-server/index.js');
const web = read('frontend/semantic-notifications.js');
const sw = read('frontend/sw.js');
const android = read('android-app/lib/semantic-notifications.js');
const protocol = read('protocol.md');
for (const marker of [
  "app.post('/api/notifications/semantic-receipts', requireAnyAuth",
  "app.get('/api/notifications/semantic-diagnostics', requireAnyAuth",
  "clientChannel: 'websocket-live'",
  "recordSemanticStage('dispatched', email, 'fcm'",
  "recordSemanticStage('dispatched', subscription.email, 'web-push'",
]) assert(relay.includes(marker), `relay missing telemetry marker: ${marker}`);
assert(web.includes("recordSemanticNotificationStage(event, stage"));
assert(sw.includes("channel: 'web-service-worker'"));
assert(android.includes("channel = 'android-foreground'"));
assert(!android.includes('await recordSemanticNotificationStage('), 'Android display must not await telemetry I/O');
assert(
  sw.indexOf('await self.registration.showNotification') < sw.indexOf('await Promise.allSettled'),
  'service-worker display must happen before receipt settlement',
);
assert(protocol.includes('semantic_notification_telemetry'));
assert(protocol.includes('content-free counts grouped by stage'));

const result = {
  ok: true,
  telemetry_rows: rows.length,
  stages,
  suppression_reasons: diagnostics.by_reason.filter(row => row.key !== 'none'),
  channels: diagnostics.by_channel,
  harnesses: diagnostics.by_harness,
  content_columns_persisted: 0,
  client_forged_events_rejected: true,
  duplicate_receipts_idempotent: true,
  legacy_schema_migration: true,
  turn_ready_enabled: false,
};

const outputArg = process.argv.indexOf('--output');
if (outputArg >= 0 && process.argv[outputArg + 1]) {
  const outputPath = path.resolve(process.argv[outputArg + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
