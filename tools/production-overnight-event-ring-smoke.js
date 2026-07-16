#!/usr/bin/env node
'use strict';

const assert = require('assert');
const runner = require('./production-harness-overnight-soak');

const events = [];
let nextSequence = 0;

function push(event) {
  event.__soak_sequence = nextSequence;
  nextSequence += 1;
  events.push(event);
  if (events.length > runner.EVENT_BUFFER_LIMIT) {
    events.splice(0, events.length - runner.EVENT_BUFFER_LIMIT);
  }
}

for (let index = 0; index < runner.EVENT_BUFFER_LIMIT; index += 1) {
  push({ type: 'status', index });
}

const startSequence = nextSequence;
const clientMessageId = 'event-ring-fixture';
const token = 'RAC_OVERNIGHT_EVENT_RING_FIXTURE';
push({ type: 'message_accepted', client_message_id: clientMessageId });
push({ type: 'proxy_send_result', client_message_id: clientMessageId, result: 'delivered' });
push({
  type: 'message',
  session_id: 'fixture',
  message: { role: 'assistant', content: token },
});

assert.strictEqual(events.length, runner.EVENT_BUFFER_LIMIT, 'fixture must stay at the exact ring cap');
assert.strictEqual(events.slice(runner.EVENT_BUFFER_LIMIT).length, 0,
  'the legacy array-length cursor must reproduce its empty-slice failure at the cap');

const recent = runner.eventsSince(events, startSequence);
assert.deepStrictEqual(recent.map(event => event.type), [
  'message_accepted',
  'proxy_send_result',
  'message',
]);
assert.strictEqual(
  runner.findDeliveryEvidence(events, startSequence, clientMessageId, token)?.type,
  'proxy_send_result',
  'delivery proof must remain visible after front truncation',
);
assert(recent.some(event => runner.eventHasAssistantToken(event, token)),
  'assistant-role proof must remain visible after front truncation');

console.log(JSON.stringify({
  ok: true,
  ring_limit: runner.EVENT_BUFFER_LIMIT,
  legacy_length_cursor_reproduced: true,
  monotonic_cursor_preserved_acceptance: true,
  monotonic_cursor_preserved_delivery: true,
  monotonic_cursor_preserved_assistant_proof: true,
  production_mutations: 0,
}, null, 2));
