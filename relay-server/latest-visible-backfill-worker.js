'use strict';

const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const VISIBLE_KINDS = new Set([
  'user', 'assistant', 'tool', 'tool_result', 'permission', 'permission_prompt',
  'question', 'question_prompt', 'error', 'system',
]);

function canonicalKind(value) {
  const kind = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!VISIBLE_KINDS.has(kind)) return null;
  if (kind === 'permission_prompt') return 'permission';
  if (kind === 'question_prompt') return 'question';
  return kind;
}

function canonicalSource(value) {
  const source = String(value || 'relay_persisted').trim().toLowerCase()
    .replace(/[\s-]+/g, '_').replace(/[^a-z0-9_.:/]/g, '');
  return source || 'relay_persisted';
}

function relayMessageId(rowId) {
  const numeric = Number(rowId);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? `relay:${String(numeric).padStart(20, '0')}`
    : null;
}

function durableMessageId(row) {
  const sourceMessageId = typeof row?.source_message_id === 'string'
    ? row.source_message_id.trim()
    : '';
  if (sourceMessageId && sourceMessageId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(sourceMessageId)) {
    return sourceMessageId;
  }
  return relayMessageId(row?.message_row_id);
}

const dbPath = String(workerData?.dbPath || '');
const sessionIds = Array.isArray(workerData?.sessionIds)
  ? [...new Set(workerData.sessionIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 4096)
  : [];
if (!dbPath || sessionIds.length === 0) throw new Error('Latest visible backfill worker requires bounded input');

const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');
const findLatest = db.prepare(`
  SELECT id AS message_row_id, role, ts, source, source_message_id
  FROM messages
  WHERE session = ?
    AND lower(replace(role, '-', '_')) IN
      ('user', 'assistant', 'tool', 'tool_result', 'permission', 'permission_prompt',
       'question', 'question_prompt', 'error', 'system')
    AND ts > 0
  ORDER BY ts DESC, id DESC
  LIMIT 1
`);
const upsertLatest = db.prepare(`
  INSERT INTO session_latest_visible_message
    (session_id, message_row_id, message_id, message_at, kind, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(session_id) DO UPDATE SET
    message_row_id = excluded.message_row_id,
    message_id = excluded.message_id,
    message_at = excluded.message_at,
    kind = excluded.kind,
    source = excluded.source,
    updated_at = datetime('now')
  WHERE session_latest_visible_message.message_at IS NULL
     OR excluded.message_at > session_latest_visible_message.message_at
     OR (excluded.message_at = session_latest_visible_message.message_at
       AND excluded.message_id > COALESCE(session_latest_visible_message.message_id, ''))
`);
const getLatest = db.prepare(`
  SELECT session_id, message_row_id, message_id, message_at, kind, source
  FROM session_latest_visible_message
  WHERE session_id = ?
`);

let backfilled = 0;
try {
  for (const sessionId of sessionIds) {
    const row = findLatest.get(sessionId);
    const kind = canonicalKind(row?.role);
    const messageId = durableMessageId(row);
    const messageAt = Number(row?.ts);
    if (!row || !kind || !messageId || !Number.isFinite(messageAt) || messageAt <= 0) continue;
    const result = upsertLatest.run(
      sessionId, row.message_row_id, messageId, messageAt, kind, canonicalSource(row.source),
    );
    if (result.changes <= 0) continue;
    backfilled += 1;
    parentPort.postMessage({ type: 'row', row: getLatest.get(sessionId) });
  }
  parentPort.postMessage({ type: 'complete', candidates: sessionIds.length, backfilled });
} finally {
  db.close();
}
