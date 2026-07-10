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
let nextTimerId = 1;

function fakeSetTimeout(callback, delay) {
  const id = nextTimerId++;
  timers.set(id, { callback, delay });
  return id;
}

function fakeClearTimeout(id) {
  timers.delete(id);
}

function runTimer(delay) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
  assert(entry, `Expected a pending ${delay}ms timer`);
  const [id, timer] = entry;
  timers.delete(id);
  timer.callback();
}

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
  useCallback(callback) {
    return callback;
  },
  useEffect(callback) {
    callback();
  },
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

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const hooksPath = path.join(__dirname, '..', 'frontend', 'hooks.jsx');
const built = esbuild.buildSync({
  entryPoints: [hooksPath],
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
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  console,
});
vm.runInContext(built.outputFiles[0].text, context, { filename: 'hooks.bundle.cjs' });

const shouldMergeHistorySnapshot = moduleRecord.exports.shouldMergeHistorySnapshot;
const mergeHistoryTailByOverlap = moduleRecord.exports.mergeHistoryTailByOverlap;
assert.equal(typeof shouldMergeHistorySnapshot, 'function');
assert.equal(typeof mergeHistoryTailByOverlap, 'function');
assert.equal(
  shouldMergeHistorySnapshot(
    'history_snapshot',
    { messages: [{ role: 'user', content: 'sent' }, { role: 'assistant', content: 'done' }] },
    { mode: 'chunked', partial: true },
  ),
  false,
  'authoritative proxy snapshots must replace a previously chunked live transcript',
);
assert.equal(
  shouldMergeHistorySnapshot(
    'history',
    { messages: [{ role: 'user', content: 'sent' }, { role: 'assistant', content: 'stream update' }] },
    { mode: 'chunked', partial: true },
  ),
  false,
  'relay-shaped full history broadcasts must replace streaming state instead of duplicating turns',
);
assert.equal(
  shouldMergeHistorySnapshot('history', { mode: 'tail', partial: true }, { mode: 'full' }),
  true,
  'explicit tail snapshots must still merge with loaded history',
);

const authoritativeV2Tail = [
  { role: 'user', content: 'Active soak turn 3. Reply with exactly RAC_V2_SOAK_LABEL_03.' },
  {
    role: 'assistant',
    content: 'Settled thinking content.\n\nRAC_V2_SOAK_LABEL_03',
    content_blocks: [
      { type: 'thinking', label: 'Thought for 1s', content: 'Settled thinking content.' },
      { type: 'markdown', content: 'RAC_V2_SOAK_LABEL_03' },
    ],
  },
];
const delayedRelaySqliteTail = [
  { id: 901, role: 'user', content: authoritativeV2Tail[0].content },
  {
    id: 902,
    role: 'assistant',
    content: authoritativeV2Tail[1].content,
    content_blocks: [
      { type: 'thinking', label: 'Thinking.', content: 'Settled thinking content.' },
      { type: 'markdown', content: 'RAC_V2_SOAK_LABEL_03' },
    ],
  },
];
assert.strictEqual(
  mergeHistoryTailByOverlap(authoritativeV2Tail, delayedRelaySqliteTail),
  authoritativeV2Tail,
  'a delayed SQLite tail with IDs must not duplicate an authoritative ID-less live tail',
);
const nextRelayTail = [
  ...delayedRelaySqliteTail,
  { id: 903, role: 'user', content: 'Active soak turn 4.' },
  { id: 904, role: 'assistant', content: 'RAC_V2_SOAK_LABEL_04' },
];
assert.deepEqual(
  mergeHistoryTailByOverlap(authoritativeV2Tail, nextRelayTail).slice(-2).map(message => message.content),
  ['Active soak turn 4.', 'RAC_V2_SOAK_LABEL_04'],
  'ordered tail overlap must append only genuinely new messages',
);

const relay = moduleRecord.exports.useRelay();
const firstSocket = FakeWebSocket.instances[0];
firstSocket.open();
relay.requestHistoryChunk('reconnect-session', { source: 'native' });
assert.equal(firstSocket.sent.length, 1, 'initial history request should be sent');
firstSocket.close();
assert.deepEqual(states[3], {}, 'socket close should clear visible loading state');

runTimer(3000);
const secondSocket = FakeWebSocket.instances[1];
secondSocket.open();
relay.requestHistoryChunk('reconnect-session', { source: 'native' });
assert.equal(secondSocket.sent.length, 1, 'reconnected socket should be allowed to request history again');
const reconnectRequest = secondSocket.sent[0];
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'reconnect-session',
  request_id: reconnectRequest.request_id,
  source: 'codex_cli_jsonl',
  messages: [{ role: 'assistant', content: 'restored' }],
  loaded_messages: 1,
  total_messages: 1,
  partial: false,
  cursor: {},
});
assert.equal(states[1]['reconnect-session'][0].content, 'restored');
assert.equal(states[3]['reconnect-session'], undefined, 'successful history should clear loading state');

relay.requestHistoryChunk('timeout-session', { source: 'native' });
assert.equal(secondSocket.sent.filter(message => message.session_id === 'timeout-session').length, 1);
runTimer(15000);
assert.equal(secondSocket.sent.filter(message => message.session_id === 'timeout-session').length, 2, 'first timeout should retry once');
runTimer(15000);
assert.equal(states[3]['timeout-session'], undefined, 'final timeout should clear loading state');
assert.match(states[2]['timeout-session'].error, /timed out/i, 'final timeout should expose an actionable error');

console.log('frontend history reconnect smoke: PASS');
