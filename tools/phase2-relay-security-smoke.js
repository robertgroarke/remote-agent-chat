#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  boundedString,
  createPrincipalRateLimit,
  validateQueueControlMessage,
  validateWebPushEndpoint,
  validateWebPushSubscription,
  validateWorkspaceControlMessage,
} = require('../relay-server/request-security');

assert.equal(boundedString('session-1'), true);
assert.equal(boundedString(`bad\u0000id`), false);

const validSubscription = validateWebPushSubscription({
  endpoint: 'https://push.example.test/subscription/123',
  keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
});
assert.equal(validSubscription.ok, true, JSON.stringify(validSubscription));
for (const invalid of [
  { endpoint: 'http://push.example.test/no-tls', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } },
  { endpoint: `https://push.example.test/${'x'.repeat(2050)}`, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } },
  { endpoint: 'https://push.example.test/sub', keys: { p256dh: 'short', auth: 'short' } },
  { endpoint: 'https://user:pass@push.example.test/sub', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } },
]) assert.equal(validateWebPushSubscription(invalid).ok, false, JSON.stringify(invalid));
assert.equal(validateWebPushEndpoint('https://push.example.test/sub#secret').ok, false);

assert.equal(validateQueueControlMessage({
  type: 'edit_queued', session_id: 'session-1', client_message_id: 'message-1', content: 'replacement',
}, 1024).ok, true);
assert.equal(validateQueueControlMessage({
  type: 'edit_queued', session_id: 'session-1', client_message_id: 'message-1', content: 'x'.repeat(1025),
}, 1024).ok, false);
assert.equal(validateQueueControlMessage({ type: 'discard_queued', session_id: 'session-1' }, 1024).ok, false);

assert.equal(validateWorkspaceControlMessage({
  type: 'list_directory', session_id: 'session-1', request_id: 'request-1',
}).ok, true);
assert.equal(validateWorkspaceControlMessage({
  type: 'read_file', session_id: 'session-1', request_id: 'request-1', path: '../outside', max_size: 4 * 1024 * 1024 + 1,
}).ok, false);
assert.equal(validateWorkspaceControlMessage({
  type: 'read_file', session_id: 'session-1', request_id: 'request-1', path: 'x'.repeat(4097),
}).ok, false);

let now = 0;
const realNow = Date.now;
Date.now = () => now;
try {
  const middleware = createPrincipalRateLimit({ name: 'test', limit: 2, windowMs: 1000, principal: req => req.user });
  const statuses = [];
  const response = {
    set() {},
    status(code) { statuses.push(code); return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalls = 0;
  middleware({ user: 'owner@example.test' }, response, () => { nextCalls += 1; });
  middleware({ user: 'owner@example.test' }, response, () => { nextCalls += 1; });
  middleware({ user: 'owner@example.test' }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
  assert.deepEqual(statuses, [429]);
  now = 1001;
  middleware({ user: 'owner@example.test' }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 3, 'rate-limit window must expire');
} finally {
  Date.now = realNow;
}

console.log(JSON.stringify({
  ok: true,
  web_push_validation: true,
  authenticated_mutation_rate_limit: true,
  queue_control_validation: true,
  workspace_control_validation: true,
}, null, 2));
