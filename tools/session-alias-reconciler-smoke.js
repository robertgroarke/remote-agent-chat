'use strict';

const assert = require('assert');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { SessionAliasReconciler } = require('../relay-server/session-alias-reconciler');

const aliasId = process.env.RAC_IDENTITY_ALIAS_SESSION_ID || 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const canonicalId = process.env.RAC_IDENTITY_CANONICAL_SESSION_ID || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const nativeId = process.env.RAC_IDENTITY_NATIVE_ID || '11111111-2222-4333-8444-555555555555';
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, source_message_id TEXT
  );
  CREATE UNIQUE INDEX idx_source_message ON messages(session, source_message_id)
    WHERE source_message_id IS NOT NULL;
  CREATE TABLE send_receipts (client_msg_id TEXT PRIMARY KEY, session TEXT NOT NULL, status TEXT, updated_at TEXT);
  CREATE TABLE transcript_source_cursors (
    session TEXT NOT NULL, source TEXT NOT NULL, generation TEXT NOT NULL,
    message_index INTEGER NOT NULL, end_offset INTEGER NOT NULL, file_size INTEGER NOT NULL,
    source_message_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(session, source)
  );
  CREATE TABLE session_preferences (
    email TEXT NOT NULL, session_id TEXT NOT NULL, display_name TEXT, archived INTEGER,
    muted INTEGER, pin_order INTEGER, updated_at TEXT, PRIMARY KEY(email, session_id)
  );
  CREATE TABLE usage_resume_jobs (
    session_id TEXT PRIMARY KEY, state TEXT, goal_fingerprint TEXT, updated_at TEXT
  );
  CREATE TABLE session_meta (
    session_id TEXT PRIMARY KEY, workspace_name TEXT, agent_type TEXT, updated_at TEXT
  );
  CREATE TABLE session_latest_visible_message (
    session_id TEXT PRIMARY KEY, message_row_id INTEGER, message_id TEXT,
    message_at REAL, kind TEXT, source TEXT, updated_at TEXT
  );
  CREATE TABLE goal_lifecycle_state (
    session_id TEXT PRIMARY KEY, fingerprint TEXT, generation INTEGER,
    transition_seq INTEGER, state TEXT, updated_at TEXT
  );
  CREATE TABLE session_turn_lifecycle (
    session_id TEXT PRIMARY KEY, activity_kind TEXT, updated_at TEXT
  );
  CREATE TABLE semantic_notification_events (
    dedupe_key TEXT PRIMARY KEY, session_id TEXT, payload_json TEXT
  );
  CREATE TABLE semantic_notification_telemetry (
    id INTEGER PRIMARY KEY, stage_key TEXT UNIQUE, session_id TEXT
  );
  CREATE TABLE scheduled_sends (
    id TEXT PRIMARY KEY, owner_email TEXT, session_id TEXT, content TEXT
  );
  CREATE TABLE automations (
    id INTEGER PRIMARY KEY, target_session TEXT
  );
`);

db.prepare('INSERT INTO messages(session, role, content, source_message_id) VALUES (?, ?, ?, ?)')
  .run(canonicalId, 'assistant', 'shared', 'native-1');
db.prepare('INSERT INTO messages(session, role, content, source_message_id) VALUES (?, ?, ?, ?)')
  .run(aliasId, 'assistant', 'shared', 'native-1');
db.prepare('INSERT INTO messages(session, role, content, source_message_id) VALUES (?, ?, ?, ?)')
  .run(aliasId, 'assistant', 'alias-only', 'native-2');
db.prepare('INSERT INTO send_receipts VALUES (?, ?, ?, ?)')
  .run('client-1', aliasId, 'delivered', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO transcript_source_cursors VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(aliasId, 'codex_cli', 'g2', 20, 200, 200, 'native-2', 20);
db.prepare('INSERT INTO transcript_source_cursors VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(canonicalId, 'codex_cli', 'g1', 10, 100, 100, 'native-1', 10);
db.prepare('INSERT INTO session_preferences VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('operator@example.invalid', aliasId, 'Pinned title', 0, 1, 7, '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO usage_resume_jobs VALUES (?, ?, ?, ?)')
  .run(aliasId, 'pending', 'goal-1', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO usage_resume_jobs VALUES (?, ?, ?, ?)')
  .run(canonicalId, 'completed', 'goal-old', '2026-07-20T18:00:00.000Z');
db.prepare('INSERT INTO session_meta VALUES (?, ?, ?, ?)')
  .run(aliasId, 'Alias workspace', 'codex_cli', '2026-07-20T18:00:00.000Z');
db.prepare('INSERT INTO session_meta VALUES (?, ?, ?, ?)')
  .run(canonicalId, 'Canonical workspace', 'codex-desktop', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO session_latest_visible_message VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(aliasId, 20, 'native-2', 20, 'assistant', 'proxy', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO session_latest_visible_message VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(canonicalId, 10, 'native-1', 10, 'assistant', 'proxy', '2026-07-20T18:00:00.000Z');
db.prepare('INSERT INTO goal_lifecycle_state VALUES (?, ?, ?, ?, ?, ?)')
  .run(aliasId, 'goal-1', 2, 5, 'paused', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO goal_lifecycle_state VALUES (?, ?, ?, ?, ?, ?)')
  .run(canonicalId, 'goal-1', 1, 3, 'active', '2026-07-20T18:00:00.000Z');
db.prepare('INSERT INTO session_turn_lifecycle VALUES (?, ?, ?)')
  .run(aliasId, 'idle', '2026-07-21T18:00:00.000Z');
db.prepare('INSERT INTO semantic_notification_events VALUES (?, ?, ?)')
  .run('event-1', aliasId, JSON.stringify({ session_id: aliasId, nested: { session: aliasId } }));
db.prepare('INSERT INTO semantic_notification_telemetry VALUES (?, ?, ?)').run(1, 'stage-1', aliasId);
db.prepare('INSERT INTO scheduled_sends VALUES (?, ?, ?, ?)')
  .run('scheduled-1', 'operator@example.invalid', aliasId, 'safe fixture');
db.prepare('INSERT INTO automations VALUES (?, ?)').run(1, aliasId);

const reconciler = new SessionAliasReconciler(db);
const event = {
  alias_session_id: aliasId,
  canonical_session_id: canonicalId,
  canonical_conversation_id: `codex:${nativeId}`,
  canonical_native_id: nativeId,
  current_surface: 'codex_desktop',
  suppression_reason: 'shared_archive_without_current_cli_owner',
  owner_evidence: { observed_at: '2026-07-21T18:00:01.000Z' },
};
const first = reconciler.reconcile(event);
assert.strictEqual(first.accepted, true);
assert.strictEqual(first.reason, 'reconciled');
assert.strictEqual(reconciler.resolve(aliasId), canonicalId);
assert.strictEqual(db.prepare('SELECT count(*) count FROM messages WHERE session = ?').get(aliasId).count, 0);
assert.strictEqual(db.prepare('SELECT count(*) count FROM messages WHERE session = ?').get(canonicalId).count, 2);
assert.strictEqual(db.prepare('SELECT session FROM send_receipts WHERE client_msg_id = ?').get('client-1').session, canonicalId);
assert.strictEqual(db.prepare('SELECT end_offset FROM transcript_source_cursors WHERE session = ?').get(canonicalId).end_offset, 200);
const preference = db.prepare('SELECT * FROM session_preferences WHERE email = ? AND session_id = ?')
  .get('operator@example.invalid', canonicalId);
assert.strictEqual(preference.pin_order, 7);
assert.strictEqual(preference.muted, 1);
assert.strictEqual(db.prepare('SELECT state FROM usage_resume_jobs WHERE session_id = ?').get(canonicalId).state, 'pending');
assert.strictEqual(db.prepare('SELECT agent_type FROM session_meta WHERE session_id = ?').get(canonicalId).agent_type, 'codex-desktop');
assert.strictEqual(db.prepare('SELECT message_id FROM session_latest_visible_message WHERE session_id = ?').get(canonicalId).message_id, 'native-2');
assert.strictEqual(db.prepare('SELECT generation FROM goal_lifecycle_state WHERE session_id = ?').get(canonicalId).generation, 2);
assert.strictEqual(db.prepare('SELECT activity_kind FROM session_turn_lifecycle WHERE session_id = ?').get(canonicalId).activity_kind, 'idle');
assert.strictEqual(db.prepare('SELECT session_id FROM semantic_notification_events WHERE dedupe_key = ?').get('event-1').session_id, canonicalId);
assert(!db.prepare('SELECT payload_json FROM semantic_notification_events WHERE dedupe_key = ?').get('event-1').payload_json.includes(aliasId));
assert.strictEqual(db.prepare('SELECT session_id FROM scheduled_sends WHERE id = ?').get('scheduled-1').session_id, canonicalId);
assert.strictEqual(db.prepare('SELECT target_session FROM automations WHERE id = 1').get().target_session, canonicalId);

const replay = reconciler.reconcile(event);
assert.strictEqual(replay.accepted, true);
assert.strictEqual(replay.reason, 'idempotent_replay');
const staleCollision = reconciler.reconcile({
  ...event,
  canonical_session_id: '11111111-1111-4111-8111-111111111111',
  owner_evidence: { observed_at: '2026-07-20T18:00:00.000Z' },
});
assert.strictEqual(staleCollision.accepted, false);
assert.strictEqual(staleCollision.reason, 'stale_alias_generation');

console.log(JSON.stringify({
  ok: true,
  alias_session_id: aliasId,
  canonical_session_id: canonicalId,
  migrated_counts: first.counts,
  messages_after_dedupe: 2,
  idempotent_replay: true,
  stale_generation_rejected: true,
}, null, 2));
db.close();
