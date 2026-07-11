'use strict';

// Unsolicited proxy snapshots are only a live-tail hint. Browsers load the
// authoritative transcript through explicit history requests, so broadcasting
// hundreds of rows for every active session can starve the selected session.
const UNSOLICITED_HISTORY_TAIL_LIMIT = 50;
const MAX_BROWSER_HISTORY_BUFFER_BYTES = 256 * 1024;

function buildUnsolicitedHistoryPayload(sessionId, rows, totalMessages) {
  const messages = Array.isArray(rows) ? rows : [];
  const total = Math.max(messages.length, Number(totalMessages) || 0);
  const partial = total > messages.length;
  return {
    type: 'history',
    session: sessionId,
    messages,
    partial,
    total_messages: total,
    loaded_messages: messages.length,
    limit: partial ? UNSOLICITED_HISTORY_TAIL_LIMIT : null,
    mode: partial ? 'tail' : 'full',
  };
}

function canBroadcastHistoryToBrowser(ws) {
  return Number(ws?.bufferedAmount || 0) <= MAX_BROWSER_HISTORY_BUFFER_BYTES;
}

module.exports = {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  MAX_BROWSER_HISTORY_BUFFER_BYTES,
  buildUnsolicitedHistoryPayload,
  canBroadcastHistoryToBrowser,
};
