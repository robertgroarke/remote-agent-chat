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

function isUnsolicitedHistoryMessage(msg) {
  if (!msg || msg.request_id) return false;
  return msg.type === 'history' || msg.type === 'history_snapshot' || msg.type === 'history_chunk';
}

function buildUnsolicitedHistoryChunkPayload(msg) {
  const messages = Array.isArray(msg?.messages) ? msg.messages : [];
  if (messages.length <= UNSOLICITED_HISTORY_TAIL_LIMIT) return msg;
  const tail = messages.slice(-UNSOLICITED_HISTORY_TAIL_LIMIT);
  const total = Math.max(messages.length, Number(msg.total_messages) || 0);
  return {
    ...msg,
    messages: tail,
    partial: true,
    complete: false,
    total_messages: total,
    loaded_messages: tail.length,
    limit: UNSOLICITED_HISTORY_TAIL_LIMIT,
  };
}

function canBroadcastHistoryToBrowser(ws) {
  return Number(ws?.bufferedAmount || 0) <= MAX_BROWSER_HISTORY_BUFFER_BYTES;
}

module.exports = {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  MAX_BROWSER_HISTORY_BUFFER_BYTES,
  buildUnsolicitedHistoryPayload,
  buildUnsolicitedHistoryChunkPayload,
  isUnsolicitedHistoryMessage,
  canBroadcastHistoryToBrowser,
};
