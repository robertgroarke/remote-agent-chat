'use strict';

function historyRowsMatch(existingRows, incomingRows) {
  if (!Array.isArray(existingRows) || !Array.isArray(incomingRows)) return false;
  if (existingRows.length !== incomingRows.length) return false;
  for (let index = 0; index < existingRows.length; index++) {
    const existing = existingRows[index] || {};
    const incoming = incomingRows[index] || {};
    if (existing.source_message_id || incoming.source_message_id) {
      if (existing.source_message_id !== incoming.source_message_id) return false;
    }
    if (existing.role !== incoming.role || existing.content !== incoming.content) return false;
    const existingBlocks = JSON.stringify(existing.content_blocks || null);
    const incomingBlocks = JSON.stringify(Array.isArray(incoming.content_blocks) ? incoming.content_blocks : null);
    if (existingBlocks !== incomingBlocks) return false;
    const incomingTimestamp = Number(incoming.ts);
    if (Number.isFinite(incomingTimestamp) && incomingTimestamp > 0) {
      const existingTimestamp = Number(existing.ts);
      if (!Number.isFinite(existingTimestamp) || existingTimestamp <= 0 || existingTimestamp !== incomingTimestamp) {
        return false;
      }
    }
    if (incoming.source && existing.source !== incoming.source) return false;
  }
  return true;
}

function buildAppendOnlyHistoryPlan(existingCount, existingTail, incomingRows) {
  const count = Math.max(0, Math.floor(Number(existingCount) || 0));
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];
  const tail = Array.isArray(existingTail) ? existingTail : [];
  if (incoming.length <= count) return null;
  if (count === 0) return { existing_count: 0, append_rows: incoming };
  if (tail.length === 0 || tail.length > count) return null;
  const incomingPrefixTail = incoming.slice(count - tail.length, count);
  if (!historyRowsMatch(tail, incomingPrefixTail)) return null;
  return { existing_count: count, append_rows: incoming.slice(count) };
}

function buildIncrementalHistoryPlan(existingCount, existingTail, incomingRows) {
  const count = Math.max(0, Math.floor(Number(existingCount) || 0));
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];
  const tail = Array.isArray(existingTail) ? existingTail : [];
  if (count === 0) {
    return incoming.length > 0 ? { mode: 'append', existing_count: 0, rows: incoming } : null;
  }
  if (incoming.length < count || tail.length === 0 || tail.length > count) return null;
  const tailStart = count - tail.length;
  let mismatch = -1;
  for (let index = 0; index < tail.length; index++) {
    if (!historyRowsMatch([tail[index]], [incoming[tailStart + index]])) {
      mismatch = index;
      break;
    }
  }
  if (mismatch === -1) {
    return incoming.length > count
      ? { mode: 'append', existing_count: count, rows: incoming.slice(count) }
      : null;
  }
  // A leading match proves the authoritative change begins inside the stored
  // tail. If the first sampled row already differs, older rows may also have
  // changed and the caller must retain the full-resync fallback.
  if (mismatch === 0 || tail[mismatch]?.id == null) return null;
  return {
    mode: 'replace_suffix',
    existing_count: count,
    prefix_count: tailStart + mismatch,
    delete_from_id: tail[mismatch].id,
    rows: incoming.slice(tailStart + mismatch),
  };
}

module.exports = { historyRowsMatch, buildAppendOnlyHistoryPlan, buildIncrementalHistoryPlan };
