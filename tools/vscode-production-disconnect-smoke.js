#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const {
  attachNativeDisconnectState,
  assertNativeConnected,
} = require('./vscode-extension-production-e2e');

const client = new EventEmitter();
client.Runtime = {};
const connectionState = attachNativeDisconnectState(client, 'codex', 'target-disposable');
const native = { client, frame: { id: 'target-disposable' }, connectionState };

assert.doesNotThrow(() => assertNativeConnected(native, 'codex', 'preflight'));
client.emit('disconnect');
assert.equal(connectionState.disconnected, true);
assert(connectionState.disconnected_at);
assert.equal(client.Runtime._suppressReadErrors, true);

assert.throws(
  () => assertNativeConnected(native, 'codex', 'soak turn'),
  error => error.code === 'native_cdp_disconnected'
    && error.retryable === true
    && error.fatal === true
    && error.targetId === 'target-disposable'
    && /soak turn/.test(error.message),
);

console.log(JSON.stringify({
  ok: true,
  failure_class: 'native_cdp_disconnected',
  retryable: true,
  target_id: connectionState.target_id,
}, null, 2));
