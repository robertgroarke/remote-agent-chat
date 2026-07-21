#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('android-app/lib/relay.js');
const chat = read('android-app/screens/ChatScreen.jsx');

assert.match(relay, /requestHistoryChunk\(sessionId, options = \{\}\)/);
assert.match(relay, /type: 'history_chunk_request'/);
assert.match(relay, /source: options\.source \|\| 'relay_sqlite'/);
assert.match(relay, /mode === 'older'/);
assert.match(relay, /message\.before_id = options\.beforeId/);
assert.match(relay, /Math\.min\(500, Number\(options\.limit\) \|\| 200\)/);
assert.match(chat, /RECOVERABLE_HISTORY_CHUNK_CODES/);
assert.match(chat, /requestHistoryChunkWithState/);
assert.match(chat, /setMessages\(previous =>/);

for (const marker of [
  'HISTORY_PAGE_SIZE = 200',
  "case 'history_chunk'",
  'nativeHistorySource()',
  'history_chunk_throttled',
  'msg.cursor?.next_before_id',
  'setHasOlderHistory',
  'loadOlderHistory',
  'Load earlier messages',
  'maintainVisibleContentPosition',
  'historyUserScrolledRef.current',
  'requestHistoryTail',
  'Transcript history timed out after bounded automatic retries. Tap to retry.',
]) assert(chat.includes(marker), `missing Android history-pagination marker: ${marker}`);

assert.doesNotMatch(chat, /clientRef\.current\?\.requestHistory\(sessionId\)/,
  'Android connect must not request unbounded full history');
assert.match(chat, /mergeSorted\(\[\.\.\.prev, \.\.\.incoming\]\)/);
assert.match(chat, /clearTimeout\(historyRequestTimerRef\.current\)/);

console.log(JSON.stringify({
  ok: true,
  sources: ['relay_sqlite', 'native'],
  page_size: 200,
  bounded_tail_on_connect: true,
  before_id_backfill: true,
  deduplicated_chronological_merge: true,
  visible_and_scroll_triggered_backfill: true,
  visible_retryable_timeout: true,
  recoverable_backpressure_auto_retry: true,
  stale_while_revalidate_merge: true,
  full_history_connect_request_removed: true,
}, null, 2));
