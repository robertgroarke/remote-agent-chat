#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { ScheduledSendStore } = require('../relay-server/scheduled-sends');

let now = new Date('2026-07-12T23:00:00.000Z');
const db = new Database(':memory:');
const store = new ScheduledSendStore(db, { now: () => new Date(now) });

const timed = store.create({
  ownerEmail: 'owner@example.test', sessionId: 'session-one', content: 'run overnight',
  triggerKind: 'at', deliverAt: '2026-07-12T23:01:00.000Z',
});
const idle = store.create({
  ownerEmail: 'owner@example.test', sessionId: 'session-one', content: 'continue when idle',
  triggerKind: 'idle',
});
assert.equal(store.dueAt().length, 0);
assert.deepEqual(store.dueIdle('session-one').map(job => job.id), [idle.id]);
assert.equal(store.list('other@example.test').length, 0);
assert.equal(store.list('owner@example.test', 'session-one').length, 2);
assert.equal(store.ownerEmail(timed.id), 'owner@example.test');
assert.equal(store.ownerEmail('missing-job'), null);

now = new Date('2026-07-12T23:01:01.000Z');
assert.deepEqual(store.dueAt().map(job => job.id), [timed.id]);
const claimed = store.claim(timed.id);
assert.equal(claimed.state, 'dispatching');
assert.equal(store.claim(timed.id), null);
assert.equal(store.settle(claimed.client_message_id, 'delivered').state, 'completed');
assert.equal(store.settle(claimed.client_message_id, 'delivered').state, 'completed');
assert.equal(store.cancel('owner@example.test', idle.id).state, 'cancelled');
assert.equal(store.cancel('owner@example.test', idle.id), null);
const interrupted = store.create({
  ownerEmail: 'owner@example.test', sessionId: 'session-one', content: 'restart uncertainty',
  triggerKind: 'idle',
});
assert.equal(store.claim(interrupted.id).state, 'dispatching');
const restartedStore = new ScheduledSendStore(db, { now: () => new Date(now) });
const recovered = restartedStore.list('owner@example.test').find(job => job.id === interrupted.id);
assert.equal(recovered.state, 'failed');
assert.match(recovered.last_error, /delivery state is unknown/);

for (const fixture of [
  { content: '', triggerKind: 'idle' },
  { content: 'x', triggerKind: 'at', deliverAt: '2026-07-12T22:00:00.000Z' },
  { content: 'x', triggerKind: 'unknown' },
]) {
  assert.throws(() => store.create({ ownerEmail: 'owner@example.test', sessionId: 'session-one', ...fixture }));
}

console.log(JSON.stringify({
  ok: true, triggers: ['at', 'idle'], durable_states: ['pending', 'dispatching', 'completed', 'failed', 'cancelled'],
  deterministic_client_message_id: claimed.client_message_id.startsWith('scheduled-send-scheduled-'),
  owner_isolation: true, atomic_claim: true, idempotent_settle: true,
  restart_after_handoff_fails_without_replay: true,
}, null, 2));
