'use strict';

const LEGACY_RETRY_SAFE_CODE = 'pending_revalidation';

const RECEIPT_CONTENT_BACKFILL_SQL = `
  UPDATE send_receipts
  SET content = (
    SELECT messages.content
    FROM messages
    WHERE messages.id = send_receipts.server_message_id
  )
  WHERE content IS NULL AND server_message_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = send_receipts.server_message_id
    )
`;

const LEGACY_RECEIPT_BACKFILL_SQL = `
  UPDATE send_receipts
  SET failure_native_attempted = 0, failure_retryable = 1
  WHERE status = 'failed' AND failure_code = '${LEGACY_RETRY_SAFE_CODE}'
    AND failure_native_attempted IS NULL AND failure_retryable IS NULL
`;

// Drive the message update from the tiny durable receipt ledger and address
// messages by their INTEGER PRIMARY KEY. Production transcript rows can be
// multi-kilobyte records, so a predicate-led scan of the messages table turns
// a seven-receipt migration into a multi-gigabyte startup outage.
const LEGACY_MESSAGE_BACKFILL_SQL = `
  UPDATE messages
  SET failure_native_attempted = 0, failure_retryable = 1
  WHERE id IN (
    SELECT server_message_id
    FROM send_receipts
    WHERE status = 'failed' AND failure_code = '${LEGACY_RETRY_SAFE_CODE}'
      AND failure_native_attempted = 0 AND failure_retryable = 1
      AND server_message_id IS NOT NULL
  )
    AND status = 'failed' AND failure_code = '${LEGACY_RETRY_SAFE_CODE}'
    AND failure_native_attempted IS NULL AND failure_retryable IS NULL
`;

const LEGACY_ATTEMPT_BACKFILL_SQL = `
  INSERT OR IGNORE INTO send_attempts
    (client_msg_id, delivery_attempt, session, status, accepted_at,
     launch_accepted_at, delivered_at, agent_started_at, native_receipt,
     process_epoch, failure_code, failure_reason, failure_native_attempted,
     failure_retryable, updated_at)
  SELECT client_msg_id, COALESCE(delivery_attempt, 1), session, status,
         accepted_at, launch_accepted_at, delivered_at, agent_started_at,
         native_receipt, process_epoch, failure_code, failure_reason,
         failure_native_attempted, failure_retryable, updated_at
  FROM send_receipts
`;

const RETRY_SAFE_FAILED_MESSAGE_RESTORE_SQL = `
  INSERT OR IGNORE INTO messages
    (id, session, role, content, ts, client_msg_id, status, sequence,
     accepted_at, launch_accepted_at, delivered_at, agent_started_at,
     native_receipt, process_epoch, failure_code, failure_reason,
     failure_native_attempted, failure_retryable, delivery_attempt, source)
  SELECT sr.server_message_id, sr.session, 'user', sr.content, sr.ts,
         sr.client_msg_id, sr.status, COALESCE(sr.sequence, 0),
         sr.accepted_at, sr.launch_accepted_at, sr.delivered_at,
         sr.agent_started_at, sr.native_receipt, sr.process_epoch,
         sr.failure_code, sr.failure_reason, sr.failure_native_attempted,
         sr.failure_retryable, COALESCE(sr.delivery_attempt, 1),
         'relay_failed_send'
  FROM send_receipts sr
  WHERE sr.status = 'failed'
    AND sr.failure_native_attempted = 0 AND sr.failure_retryable = 1
    AND sr.server_message_id IS NOT NULL AND sr.content IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = sr.server_message_id
    )
`;

function restoreRetrySafeFailedMessages(db, clientMessageId = null) {
  const scoped = typeof clientMessageId === 'string' && clientMessageId
    ? `${RETRY_SAFE_FAILED_MESSAGE_RESTORE_SQL}\n    AND sr.client_msg_id = ?`
    : RETRY_SAFE_FAILED_MESSAGE_RESTORE_SQL;
  return db.prepare(scoped).run(...(clientMessageId ? [clientMessageId] : []));
}

function backfillRetrySafeLegacyFailures(db, { now = () => Date.now() } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('backfillRetrySafeLegacyFailures requires a better-sqlite3 database');
  }
  const startedAt = now();
  const receiptHasContent = db.prepare(
    "SELECT 1 FROM pragma_table_info('send_receipts') WHERE name = 'content'",
  ).get();
  const migrate = db.transaction(() => {
    const contentResult = receiptHasContent
      ? db.prepare(RECEIPT_CONTENT_BACKFILL_SQL).run()
      : { changes: 0 };
    const receiptResult = db.prepare(LEGACY_RECEIPT_BACKFILL_SQL).run();
    const messageResult = db.prepare(LEGACY_MESSAGE_BACKFILL_SQL).run();
    const restoredResult = receiptHasContent
      ? restoreRetrySafeFailedMessages(db)
      : { changes: 0 };
    const attemptResult = db.prepare(LEGACY_ATTEMPT_BACKFILL_SQL).run();
    return {
      receipt_content_rows_changed: contentResult.changes,
      receipt_rows_changed: receiptResult.changes,
      message_rows_changed: messageResult.changes,
      message_rows_restored: restoredResult.changes,
      attempt_rows_inserted: attemptResult.changes,
    };
  });
  return {
    ...migrate(),
    duration_ms: Math.max(0, now() - startedAt),
  };
}

module.exports = {
  LEGACY_ATTEMPT_BACKFILL_SQL,
  LEGACY_MESSAGE_BACKFILL_SQL,
  LEGACY_RECEIPT_BACKFILL_SQL,
  LEGACY_RETRY_SAFE_CODE,
  RECEIPT_CONTENT_BACKFILL_SQL,
  RETRY_SAFE_FAILED_MESSAGE_RESTORE_SQL,
  backfillRetrySafeLegacyFailures,
  restoreRetrySafeFailedMessages,
};
