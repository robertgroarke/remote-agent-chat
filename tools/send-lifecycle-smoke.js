#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SendLifecycleTracker } = require('../relay-server/send-lifecycle');

let now = Date.parse('2026-07-11T20:00:00.000Z');
const tracker = new SendLifecycleTracker({ now: () => now, maxPendingMs: 120000 });

tracker.markProxyResult({
  type: 'proxy_send_result', session_id: 'sess-a', client_message_id: 'cid-a',
  result: 'delivered', delivery_attempt: 2,
  delivered_at: '2026-07-11T20:00:00.000Z',
});
assert.equal(tracker.consumeActivity({ session_id: 'sess-a', activity: { kind: 'idle' } }), null);
now += 82;
const started = tracker.consumeActivity({
  session_id: 'sess-a',
  activity: { kind: 'thinking', label: 'Thinking', started_at: '2026-07-11T20:00:00.082Z' },
});
assert.deepEqual(started, {
  type: 'agent_started',
  protocol_version: 1,
  session_id: 'sess-a',
  client_message_id: 'cid-a',
  delivery_attempt: 2,
  delivered_at: '2026-07-11T20:00:00.000Z',
  started_at: '2026-07-11T20:00:00.082Z',
  activity: { kind: 'thinking', label: 'Thinking', started_at: '2026-07-11T20:00:00.082Z' },
});
assert.equal(tracker.consumeActivity({ session_id: 'sess-a', thinking: true }), null, 'receipt must emit once');

now += 1000;
assert.equal(tracker.consumeActivity({
  session_id: 'sess-race', activity: { kind: 'generating', label: 'Generating' },
}), null, 'pre-delivery activity should be retained but not emitted');
now += 25;
const raced = tracker.markProxyResult({
  session_id: 'sess-race', client_message_id: 'cid-race', result: 'delivered',
  delivered_at: new Date(now).toISOString(),
});
assert.equal(raced.client_message_id, 'cid-race');
assert.equal(raced.activity.kind, 'generating');

now += 1000;
assert.equal(tracker.consumeActivity({
  session_id: 'sess-stale',
  activity: { kind: 'generating', started_at: '2026-07-11T19:59:00.000Z' },
}), null);
now += 25;
const stale = tracker.markProxyResult({
  session_id: 'sess-stale', client_message_id: 'cid-stale', result: 'delivered',
  delivered_at: new Date(now).toISOString(),
});
assert.equal(stale.started_at, new Date(now).toISOString(), 'stale pre-send activity clock must be clamped to delivery');
assert(Date.parse(stale.started_at) >= Date.parse(stale.delivered_at), 'terminal receipt must not predate delivery');

tracker.markProxyResult({ session_id: 'sess-b', client_message_id: 'cid-b', result: 'delivered' });
tracker.markProxyResult({ session_id: 'sess-b', client_message_id: 'cid-b', result: 'failed' });
assert.equal(tracker.consumeActivity({ session_id: 'sess-b', activity: { kind: 'working' } }), null);

tracker.markProxyResult({
  session_id: 'sess-native', client_message_id: 'cid-native', result: 'delivered',
  lifecycle: 'native_user_turn_observed',
  native_receipt: { content_sha256: '0'.repeat(64), content_utf8_bytes: 12 },
});
assert.equal(
  tracker.consumeActivity({ session_id: 'sess-native', activity: { kind: 'generating' } }),
  null,
  'receipt-managed sends must wait for the proxy native agent_started event',
);

tracker.markProxyResult({ session_id: 'sess-c', client_message_id: 'cid-c', result: 'delivered' });
now += 120001;
assert.equal(tracker.consumeActivity({ session_id: 'sess-c', activity: { kind: 'generating' } }), null, 'expired correlation must fail closed');

const root = path.resolve(__dirname, '..');
const relay = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const webApp = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const androidBubble = fs.readFileSync(path.join(root, 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
const protocol = fs.readFileSync(path.join(root, 'protocol.md'), 'utf8');
for (const marker of [
  'sendLifecycle.markProxyResult(msg)',
  'sendLifecycle.consumeActivity',
  "broadcastToBrowsers(agentStarted)",
]) assert(relay.includes(marker), `relay integration missing ${marker}`);
assert(web.includes("if (t === 'agent_started')"));
assert(webApp.includes("status === 'agent_started'"));
assert(android.includes("case 'agent_started':"));
assert(androidBubble.includes("deliveryState === 'agent_started'"));
assert(protocol.includes('### `agent_started`'));

console.log('send lifecycle smoke: PASS (truthful legacy chronology plus native-receipt-managed agent_started gating)');
