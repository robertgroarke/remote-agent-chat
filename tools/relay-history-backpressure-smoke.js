#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  MAX_BROWSER_HISTORY_BUFFER_BYTES,
  buildUnsolicitedHistoryPayload,
  canBroadcastHistoryToBrowser,
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

console.log(
  `relay history backpressure smoke: PASS ` +
  `(tail=${UNSOLICITED_HISTORY_TAIL_LIMIT}, buffer=${MAX_BROWSER_HISTORY_BUFFER_BYTES})`,
);
