#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  MAX_BROWSER_HISTORY_BUFFER_BYTES,
  MAX_BROWSER_DELTA_BUFFER_BYTES,
  PRIORITY_LIVE_HISTORY_MAX_BYTES,
  buildUnsolicitedHistoryPayload,
  buildUnsolicitedHistoryChunkPayload,
  isUnsolicitedHistoryMessage,
  canBroadcastHistoryToBrowser,
  canBroadcastDeltaToBrowser,
  isPriorityLiveHistoryUpdate,
} = require('../relay-server/history-broadcast-policy');

const smallRows = Array.from({ length: 9 }, (_, index) => ({
  id: index + 1,
  role: index % 2 ? 'assistant' : 'user',
  content: `small-${index + 1}`,
}));
const small = buildUnsolicitedHistoryPayload('cursor-small', smallRows, smallRows.length);
assert.equal(small.messages.length, 9);
assert.equal(small.partial, false);
assert.equal(small.mode, 'full');
assert.equal(small.limit, null);

const largeTotal = UNSOLICITED_HISTORY_TAIL_LIMIT + 137;
const largeRows = Array.from({ length: UNSOLICITED_HISTORY_TAIL_LIMIT }, (_, index) => ({
  id: largeTotal - UNSOLICITED_HISTORY_TAIL_LIMIT + index + 1,
  role: 'assistant',
  content: `tail-${index + 1}`,
}));
const large = buildUnsolicitedHistoryPayload('busy-session', largeRows, largeTotal);
assert.equal(large.messages.length, UNSOLICITED_HISTORY_TAIL_LIMIT);
assert.equal(large.partial, true);
assert.equal(large.mode, 'tail');
assert.equal(large.total_messages, largeTotal);
assert.equal(large.loaded_messages, UNSOLICITED_HISTORY_TAIL_LIMIT);
assert.equal(large.limit, UNSOLICITED_HISTORY_TAIL_LIMIT);

assert.equal(canBroadcastHistoryToBrowser({ bufferedAmount: 0 }), true);
assert.equal(canBroadcastHistoryToBrowser({ bufferedAmount: MAX_BROWSER_HISTORY_BUFFER_BYTES }), true);
assert.equal(canBroadcastHistoryToBrowser({ bufferedAmount: MAX_BROWSER_HISTORY_BUFFER_BYTES + 1 }), false);
assert.equal(canBroadcastDeltaToBrowser({ bufferedAmount: 0 }), true);
assert.equal(canBroadcastDeltaToBrowser({ bufferedAmount: MAX_BROWSER_DELTA_BUFFER_BYTES }), true);
assert.equal(canBroadcastDeltaToBrowser({ bufferedAmount: MAX_BROWSER_DELTA_BUFFER_BYTES + 1 }), false);
assert.equal(isPriorityLiveHistoryUpdate({
  type: 'history_snapshot',
  live_update: 'assistant_completion',
  messages: [{ role: 'assistant', content: 'live tail' }],
}), true);
assert.equal(isPriorityLiveHistoryUpdate({
  type: 'history_snapshot',
  live_update: 'assistant_completion',
  messages: [{ role: 'assistant', content: 'x'.repeat(PRIORITY_LIVE_HISTORY_MAX_BYTES) }],
}), false);
assert.equal(isPriorityLiveHistoryUpdate({
  type: 'history_snapshot',
  messages: [{ role: 'assistant', content: 'ordinary history' }],
}), false);
assert.equal(isPriorityLiveHistoryUpdate({
  type: 'history_snapshot',
  session_id: 'long-live-session',
  live_update: 'assistant_completion',
  messages: [
    ...Array.from({ length: 75 }, (_, index) => ({ role: 'user', content: 'x'.repeat(2048) + index })),
    ...Array.from({ length: UNSOLICITED_HISTORY_TAIL_LIMIT }, (_, index) => ({ role: 'assistant', content: `tail-${index}` })),
  ],
}), true, 'priority eligibility must measure the bounded browser tail, not the larger inbound snapshot');

const unsolicitedChunk = buildUnsolicitedHistoryChunkPayload({
  type: 'history_chunk',
  session_id: 'busy-cli',
  source: 'codex_cli_live_tail',
  messages: Array.from({ length: 900 }, (_, index) => ({ role: 'assistant', content: `chunk-${index}` })),
});
assert.equal(unsolicitedChunk.messages.length, UNSOLICITED_HISTORY_TAIL_LIMIT);
assert.equal(unsolicitedChunk.messages[0].content, `chunk-${900 - UNSOLICITED_HISTORY_TAIL_LIMIT}`);
assert.equal(unsolicitedChunk.partial, true);
assert.equal(unsolicitedChunk.complete, false);
assert.equal(isUnsolicitedHistoryMessage(unsolicitedChunk), true);
assert.equal(isUnsolicitedHistoryMessage({ ...unsolicitedChunk, request_id: 'explicit-history' }), false);

// Guard the relay integration point as well as the pure policy. This caught a
// real regression where the limiter was accidentally applied to directory
// listings while unsolicited history_chunk payloads remained unbounded.
const relaySource = fs.readFileSync(path.join(__dirname, '..', 'relay-server', 'index.js'), 'utf8');
const historyChunkBranch = relaySource.match(
  /else if \(t === 'history_chunk'\)([\s\S]*?)else if \(t === 'history' \|\| t === 'history_snapshot'\)/,
);
assert(historyChunkBranch, 'relay history_chunk branch not found');
assert(
  historyChunkBranch[1].includes("'Dropped requestless or orphaned native history chunk'"),
  'requestless relay history_chunk traffic must be dropped instead of broadcast',
);
assert(
  !historyChunkBranch[1].includes('broadcastToBrowsers(buildUnsolicitedHistoryChunkPayload(msg))'),
  'requestless history chunks must never use the legacy bounded-tail broadcast path',
);
assert(
  relaySource.includes('broadcastPersistedTranscriptRows(id, getHistoryRowsTail(id, incrementalPlan.rows.length))'),
  'append-only legacy snapshots must become incremental persisted rows, not full snapshots',
);
assert(
  relaySource.includes("reason: 'backpressure'"),
  'slow transcript subscribers must receive a bounded gap/resync signal',
);

console.log(
  `relay history backpressure smoke: PASS ` +
  `(tail=${UNSOLICITED_HISTORY_TAIL_LIMIT}, history_buffer=${MAX_BROWSER_HISTORY_BUFFER_BYTES}, delta_buffer=${MAX_BROWSER_DELTA_BUFFER_BYTES})`,
);
