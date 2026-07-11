#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const engine = new ProxyEngine({
  cdpPorts: [],
  relayUrl: 'ws://relay.invalid',
  machineLabel: 'prompt-reconnect-smoke',
});

const sent = [];
engine._sendToRelay = message => sent.push(message);
engine._startHeartbeat = () => {};
engine._sendSessionSnapshotNow = () => {};
engine._flushPendingPreReadyHistory = () => {};
engine._sendSessionMetaBackfill = () => {};

engine.activePermissionPrompts.set('permission-session', {
  prompt_id: 'permission-prompt',
  surfaced: true,
  prompt: {
    type: 'permission_prompt',
    session_id: 'permission-session',
    prompt_id: 'permission-prompt',
    message: 'Approve this owned fixture?',
    choices: [{ choice_id: 'approve', label: 'Approve' }],
  },
});
engine.activeErrorPrompts.set('error-session', {
  prompt_id: 'error-prompt',
  surfaced: true,
  prompt: {
    prompt_id: 'error-prompt',
    title: 'Slow response',
    message: 'Retry or keep waiting.',
    actions: [{ action_id: 'retry_with_faster_model', label: 'Retry with faster model' }],
    display_mode: 'inline',
    blocking: false,
  },
});

engine._handleRelayMessage({
  type: 'connection_ack',
  connection_id: 'first',
  heartbeat_interval_ms: 10000,
});
assert.equal(engine._relayEpoch, 1, 'first handshake should establish relay epoch 1');
assert(sent.some(message => message.type === 'permission_prompt' && message.prompt_id === 'permission-prompt'));
assert(sent.some(message => message.type === 'session_error_prompt' && message.prompt_id === 'error-prompt'));

sent.length = 0;
engine._handleRelayMessage({
  type: 'connection_ack',
  connection_id: 'second',
  heartbeat_interval_ms: 10000,
});
assert.equal(engine._relayEpoch, 2, 'reconnect handshake should advance the relay epoch');
assert(sent.some(message => message.type === 'permission_prompt' && message.prompt_id === 'permission-prompt'), 'permission prompt should be resurfaced after reconnect');
assert(sent.some(message => message.type === 'session_error_prompt' && message.prompt_id === 'error-prompt'), 'session notice should be resurfaced after reconnect');

console.log('proxy prompt reconnect smoke: PASS');
