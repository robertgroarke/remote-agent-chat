#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const esbuild = require('../frontend/node_modules/esbuild');

const states = [];
let stateIndex = 0;
const refs = [];
let refIndex = 0;
const timers = new Map();
let timerSequence = 0;

const React = {
  useState(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], update => {
      states[index] = typeof update === 'function' ? update(states[index]) : update;
    }];
  },
  useRef(initial) {
    const index = refIndex++;
    if (!refs[index]) refs[index] = { current: initial };
    return refs[index];
  },
  useCallback(callback) { return callback; },
  useEffect(callback) { callback(); },
};

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  send(payload) { this.sent.push(JSON.parse(payload)); }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

function setFakeTimeout(callback, delay) {
  const id = ++timerSequence;
  timers.set(id, { callback, delay });
  return id;
}

function clearFakeTimeout(id) { timers.delete(id); }
function runTimer(delay) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
  assert(entry, `Expected a ${delay}ms timer`);
  timers.delete(entry[0]);
  entry[1].callback();
}

const built = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'frontend', 'hooks.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
});
const moduleRecord = { exports: {} };
const context = vm.createContext({
  module: moduleRecord,
  exports: moduleRecord.exports,
  React,
  WebSocket: FakeWebSocket,
  location: { protocol: 'https:', host: 'agent-chat.test' },
  setTimeout: setFakeTimeout,
  clearTimeout: clearFakeTimeout,
  console,
});
vm.runInContext(built.outputFiles[0].text, context, { filename: 'hooks.bundle.cjs' });

const relay = moduleRecord.exports.useRelay();
const firstSocket = FakeWebSocket.instances[0];
firstSocket.open();
relay.subscribeHostResources(false);
const subscribe = firstSocket.sent.find(message => message.type === 'host_resource_subscribe');
assert(subscribe, 'opening Host Resources must create a requester-scoped subscription');
assert.equal(subscribe.aggregate_only, false);
assert.equal(subscribe.resume_subscription_id, undefined, 'new subscriptions must not invent resume tokens');

firstSocket.receive({
  type: 'host_resource_subscription_ack',
  request_id: subscribe.request_id,
  subscription_id: 'host-sub-0123456789abcdef0123456789abcdef',
  aggregate_only: false,
  resumed: false,
  system_points: 2,
  detail_points: 1,
});
const initialHistory = firstSocket.sent.filter(message => message.type === 'host_resource_history_request');
assert.deepEqual(initialHistory.map(message => message.stream).sort(), ['detail', 'system']);
assert(initialHistory.every(message => message.after_sequence === 0));

const systemRequest = initialHistory.find(message => message.stream === 'system');
firstSocket.receive({
  type: 'host_resource_live',
  subscription_id: subscribe.subscription_id || 'host-sub-0123456789abcdef0123456789abcdef',
  point: { sample_sequence: 3, status: 'fresh' },
});
firstSocket.receive({
  type: 'host_resource_live',
  subscription_id: 'host-sub-0123456789abcdef0123456789abcdef',
  point: { sample_sequence: 3, status: 'fresh', duplicate: true },
});
firstSocket.receive({
  type: 'host_resource_live',
  subscription_id: 'host-sub-0123456789abcdef0123456789abcdef',
  point: { sample_sequence: 2, status: 'fresh', out_of_order: true },
});
firstSocket.receive({
  type: 'host_resource_history_chunk',
  request_id: systemRequest.request_id,
  subscription_id: 'host-sub-0123456789abcdef0123456789abcdef',
  chunk: {
    stream: 'system',
    points: [{ sample_sequence: 1, status: 'fresh' }, { sample_sequence: 2, status: 'fresh' }],
    next_sequence: 2,
    done: true,
  },
});
const systemState = states.find(value => Array.isArray(value)
  && value.length === 3
  && value.every(point => Number.isSafeInteger(point?.sample_sequence)));
assert(systemState, 'history arriving after live data must be merged into one ordered series');
assert.deepEqual(systemState.map(point => point.sample_sequence), [1, 2, 3]);
assert.equal(systemState[2].duplicate, undefined, 'duplicate live frames must be rejected');

firstSocket.close();
runTimer(250);
const secondSocket = FakeWebSocket.instances[1];
secondSocket.open();
const resume = secondSocket.sent.find(message => message.type === 'host_resource_subscribe');
assert.equal(resume.resume_subscription_id, 'host-sub-0123456789abcdef0123456789abcdef');
secondSocket.receive({
  type: 'host_resource_subscription_ack',
  request_id: resume.request_id,
  subscription_id: resume.resume_subscription_id,
  aggregate_only: false,
  resumed: true,
  system_points: 4,
  detail_points: 1,
});
const resumedSystem = secondSocket.sent.find(message => message.type === 'host_resource_history_request' && message.stream === 'system');
assert.equal(resumedSystem.after_sequence, 3, 'resume must hydrate only the sequence gap after the local tail');

relay.unsubscribeHostResources();
const unsubscribe = secondSocket.sent.find(message => message.type === 'host_resource_unsubscribe');
assert.equal(unsubscribe.subscription_id, resume.resume_subscription_id);

console.log('host resource frontend transport smoke: PASS');
