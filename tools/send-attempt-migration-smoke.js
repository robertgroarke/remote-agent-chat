#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('../relay-server/node_modules/better-sqlite3');
const {
  LEGACY_MESSAGE_BACKFILL_SQL,
  backfillRetrySafeLegacyFailures,
} = require('../relay-server/send-attempt-migration');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts REAL,
    status TEXT NOT NULL DEFAULT 'delivered',
    sequence INTEGER NOT NULL DEFAULT 0,
    client_msg_id TEXT,
    accepted_at TEXT,
    launch_accepted_at TEXT,
    delivered_at TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    delivery_attempt INTEGER NOT NULL DEFAULT 1,
    source TEXT
  );
  CREATE TABLE send_receipts (
    client_msg_id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    server_message_id INTEGER,
    sequence INTEGER,
    ts REAL,
    status TEXT NOT NULL,
    accepted_at TEXT,
    launch_accepted_at TEXT,
    delivered_at TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    content TEXT,
    delivery_attempt INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE send_attempts (
    client_msg_id TEXT NOT NULL,
    delivery_attempt INTEGER NOT NULL,
    session TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    accepted_at TEXT,
    launch_accepted_at TEXT,
    delivered_at TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (client_msg_id, delivery_attempt)
  );
`);

const insertMessage = db.prepare(`
  INSERT INTO messages
    (session, role, content, status, client_msg_id, failure_code,
     failure_native_attempted, failure_retryable)
  VALUES (?, 'user', ?, ?, ?, ?, ?, ?)
`);
const insertDecoys = db.transaction(count => {
  for (let index = 0; index < count; index += 1) {
    insertMessage.run(
      `decoy-${index % 64}`,
      `ordinary transcript row ${index}`,
      'delivered',
      null,
      null,
      null,
      null,
    );
  }
});
const decoyRows = 50_000;
insertDecoys(decoyRows);

const insertReceipt = db.prepare(`
  INSERT INTO send_receipts
    (client_msg_id, session, server_message_id, status, failure_code,
     failure_reason, failure_native_attempted, failure_retryable,
     delivery_attempt, updated_at)
  VALUES (?, ?, ?, 'failed', 'pending_revalidation',
          'Legacy gate rejected before native dispatch', NULL, NULL, 1, ?)
`);
const retryableRows = [];
for (let index = 0; index < 7; index += 1) {
  const cid = `retryable-${index}`;
  const row = insertMessage.run(
    'retry-session',
    `retryable transcript row ${index}`,
    'failed',
    cid,
    'pending_revalidation',
    null,
    null,
  );
  retryableRows.push({ id: Number(row.lastInsertRowid), cid });
  insertReceipt.run(cid, 'retry-session', Number(row.lastInsertRowid), new Date().toISOString());
}

const orphanCid = 'retryable-without-message-id';
const orphanMessage = insertMessage.run(
  'retry-session',
  'fail closed without a durable message row id',
  'failed',
  orphanCid,
  'pending_revalidation',
  null,
  null,
);
insertReceipt.run(orphanCid, 'retry-session', null, new Date().toISOString());

const plan = db.prepare(`EXPLAIN QUERY PLAN ${LEGACY_MESSAGE_BACKFILL_SQL}`).all();
assert(
  plan.some(step => /SEARCH messages USING INTEGER PRIMARY KEY/.test(step.detail)),
  `legacy message backfill is not primary-key bounded: ${JSON.stringify(plan)}`,
);
assert(
  !plan.some(step => /^SCAN messages/.test(step.detail)),
  `legacy message backfill scans the transcript table: ${JSON.stringify(plan)}`,
);

const first = backfillRetrySafeLegacyFailures(db);
assert.deepStrictEqual(
  {
    receipt_content_rows_changed: first.receipt_content_rows_changed,
    receipt_rows_changed: first.receipt_rows_changed,
    message_rows_changed: first.message_rows_changed,
    message_rows_restored: first.message_rows_restored,
    attempt_rows_inserted: first.attempt_rows_inserted,
  },
  {
    receipt_content_rows_changed: 7,
    receipt_rows_changed: 8,
    message_rows_changed: 7,
    message_rows_restored: 0,
    attempt_rows_inserted: 8,
  },
);
for (const row of retryableRows) {
  assert.deepStrictEqual(
    db.prepare('SELECT failure_native_attempted, failure_retryable FROM messages WHERE id = ?').get(row.id),
    { failure_native_attempted: 0, failure_retryable: 1 },
  );
}
assert.deepStrictEqual(
  db.prepare('SELECT failure_native_attempted, failure_retryable FROM messages WHERE id = ?')
    .get(Number(orphanMessage.lastInsertRowid)),
  { failure_native_attempted: null, failure_retryable: null },
  'a receipt without a durable message row id must remain fail-closed in transcript state',
);

db.prepare('DELETE FROM messages WHERE id = ?').run(retryableRows[0].id);
const second = backfillRetrySafeLegacyFailures(db);
assert.deepStrictEqual(
  {
    receipt_content_rows_changed: second.receipt_content_rows_changed,
    receipt_rows_changed: second.receipt_rows_changed,
    message_rows_changed: second.message_rows_changed,
    message_rows_restored: second.message_rows_restored,
    attempt_rows_inserted: second.attempt_rows_inserted,
  },
  {
    receipt_content_rows_changed: 0,
    receipt_rows_changed: 0,
    message_rows_changed: 0,
    message_rows_restored: 1,
    attempt_rows_inserted: 0,
  },
  'migration must restore a receipt-backed failed row without scanning transcript history',
);
assert.deepStrictEqual(
  db.prepare(`
    SELECT id, content, failure_native_attempted, failure_retryable, source
    FROM messages WHERE client_msg_id = ?
  `).get(retryableRows[0].cid),
  {
    id: retryableRows[0].id,
    content: 'retryable transcript row 0',
    failure_native_attempted: 0,
    failure_retryable: 1,
    source: 'relay_failed_send',
  },
);
const third = backfillRetrySafeLegacyFailures(db);
assert.deepStrictEqual(
  {
    receipt_content_rows_changed: third.receipt_content_rows_changed,
    receipt_rows_changed: third.receipt_rows_changed,
    message_rows_changed: third.message_rows_changed,
    message_rows_restored: third.message_rows_restored,
    attempt_rows_inserted: third.attempt_rows_inserted,
  },
  {
    receipt_content_rows_changed: 0,
    receipt_rows_changed: 0,
    message_rows_changed: 0,
    message_rows_restored: 0,
    attempt_rows_inserted: 0,
  },
  'migration must be idempotent after restoration',
);

const preContentSchemaDb = new Database(':memory:');
for (const table of ['messages', 'send_receipts', 'send_attempts']) {
  let sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").pluck().get(table);
  if (table === 'send_receipts') sql = sql.replace(/\n\s*content TEXT,/, '');
  preContentSchemaDb.exec(sql);
}
const preContentResult = backfillRetrySafeLegacyFailures(preContentSchemaDb);
assert.strictEqual(preContentResult.receipt_content_rows_changed, 0);
assert.strictEqual(preContentResult.message_rows_restored, 0);
preContentSchemaDb.close();

console.log(JSON.stringify({
  ok: true,
  decoy_rows: decoyRows,
  retry_safe_receipts: 8,
  primary_key_message_updates: 7,
  receipt_content_backfills: 7,
  restored_failed_rows: 1,
  pre_content_schema_compatible: true,
  orphan_messages_fail_closed: 1,
  send_attempt_rows: db.prepare('SELECT COUNT(*) AS count FROM send_attempts').get().count,
  query_plan: plan.map(step => step.detail),
  first_duration_ms: first.duration_ms,
  second_duration_ms: second.duration_ms,
}));
