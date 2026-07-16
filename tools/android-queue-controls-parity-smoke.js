#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('android-app/lib/relay.js');
const chat = read('android-app/screens/ChatScreen.jsx');
const bar = read('android-app/components/QueuedMessageBar.jsx');

for (const [method, type] of [
  ['steerMessage', 'steer'],
  ['discardQueuedMessage', 'discard_queued'],
  ['editQueuedMessage', 'edit_queued'],
]) {
  assert(relay.includes(`${method}(`), `missing Android relay helper: ${method}`);
  assert(relay.includes(`type: '${type}'`), `missing Android queue protocol type: ${type}`);
}
assert.match(relay, /message\.native_index = nativeIndex/);

for (const marker of [
  "case 'message_queued'",
  "case 'queue_delivered'",
  "case 'steer_result'",
  "case 'native_queue'",
  'setQueuedMessages',
  'handleSteerQueued',
  'handleDiscardQueued',
  'handleEditQueued',
  '<QueuedMessageBar',
]) assert(chat.includes(marker), `missing Android queue state marker: ${marker}`);

assert.match(chat, /sid && sid !== sessionId/);
assert.match(chat, /item\.nativeIndex/);
assert.match(chat, /delete next\[item\.cid\]/);
assert.match(chat, /message\._cid !== item\.cid/);
assert.match(chat, /pendingMsgId\.current\?\._id === cid/);
assert.match(chat, /pending_action: null, error/);
assert.match(chat, /block\?\.type === 'queued_message'/);
assert.match(chat, /content_blocks: contentBlocks/);
assert.match(chat, /content_blocks: \(queued\.content_blocks \|\| \[\]\)\.map/);

for (const marker of [
  'accessibilityRole="summary"',
  'Edit queued message',
  'onSteer(item)',
  'onDiscard(item)',
  'onEdit(item, content)',
  '!item.native',
]) assert(bar.includes(marker), `missing queued-message control marker: ${marker}`);

console.log(JSON.stringify({
  ok: true,
  protocol_actions: ['steer', 'discard_queued', 'edit_queued'],
  proxy_queue_controls: ['steer', 'edit', 'discard'],
  native_queue_controls: ['steer', 'discard'],
  session_scoped_events: true,
  optimistic_edit_and_discard: true,
  queued_receipt_releases_composer: true,
  retryable_steer_failure: true,
  accessible_controls: true,
}, null, 2));
