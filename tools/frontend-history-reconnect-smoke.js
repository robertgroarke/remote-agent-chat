#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
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
const removeSupersededCliTranscriptPlaceholders = moduleRecord.exports.removeSupersededCliTranscriptPlaceholders;
const shouldRefreshNativeCliPlaceholder = moduleRecord.exports.shouldRefreshNativeCliPlaceholder;
const sessionMetadataActivityMaps = moduleRecord.exports.sessionMetadataActivityMaps;
const reconnectDelays = moduleRecord.exports.RELAY_RECONNECT_DELAYS_MS;
assert.equal(typeof shouldMergeHistorySnapshot, 'function');
assert.equal(typeof mergeHistoryTailByOverlap, 'function');
assert.equal(typeof removeSupersededCliTranscriptPlaceholders, 'function');
assert.equal(typeof shouldRefreshNativeCliPlaceholder, 'function');
assert.equal(typeof sessionMetadataActivityMaps, 'function');
assert.deepEqual(reconnectDelays, [250, 500, 1000, 2000, 3000], 'relay reconnect must begin below the 3-second recovery target');
assert.deepEqual(
  sessionMetadataActivityMaps([
    { session_id: 'active-cli', activity: { kind: 'generating', label: 'Working', thinkingContent: 'running' } },
    { session_id: 'idle-cli', activity: { kind: 'idle', label: '', thinkingContent: '' } },
  ]),
  {
    activities: {
        'active-cli': { kind: 'generating', label: 'Working', updatedAt: null, startedAt: null, interruptHint: '', goal: null, thinking: null, current: null, step: null, usage: null, task_list: null, context_card: null, thinkingContent: 'running', transport: null },
        'idle-cli': { kind: 'idle', label: '', updatedAt: null, startedAt: null, interruptHint: '', goal: null, thinking: null, current: null, step: null, usage: null, task_list: null, context_card: null, thinkingContent: '', transport: null },
    },
    thinkingContent: { 'active-cli': 'running', 'idle-cli': '' },
    thinking: { 'active-cli': 'Working', 'idle-cli': false },
  },
  'session snapshots must explicitly clear stale thinking state for idle sessions',
);
const staleCodexPlaceholder = {
  role: 'assistant',
  content: '**Codex CLI is waiting for a native transcript.**\n\nOnce Codex creates or updates the JSONL transcript file, this placeholder will be replaced with the real CLI chat history.',
};
assert.strictEqual(
  removeSupersededCliTranscriptPlaceholders([staleCodexPlaceholder])[0],
  staleCodexPlaceholder,
  'a genuinely pending CLI session must retain its only placeholder',
);
assert.equal(
  shouldRefreshNativeCliPlaceholder({ agent_type: 'codex_cli' }, [staleCodexPlaceholder]),
  true,
  'a selected Codex CLI placeholder must trigger a native history refresh after proxy reconnect',
);
const staleCursorPlaceholder = {
  role: 'assistant',
  content: '**Cursor CLI is waiting for a native transcript.**\n\nOnce Cursor Agent creates or updates the JSONL transcript file, this placeholder will be replaced with the real CLI chat history.',
};
assert.equal(
  shouldRefreshNativeCliPlaceholder({ agent_type: 'cursor_cli' }, [staleCursorPlaceholder]),
  true,
  'a selected Cursor CLI placeholder must trigger a native history refresh after proxy reconnect',
);
assert.equal(
  shouldRefreshNativeCliPlaceholder({ agent_type: 'cursor_cli' }, [staleCursorPlaceholder, { role: 'user', content: 'real turn' }]),
  false,
  'real Cursor CLI history must not trigger repeated placeholder refreshes',
);
assert.deepEqual(
  removeSupersededCliTranscriptPlaceholders([
    staleCodexPlaceholder,
    { role: 'user', content: 'real turn' },
    { role: 'assistant', content: 'real reply' },
  ]).map(message => message.content),
  ['real turn', 'real reply'],
  'stored CLI placeholders must disappear once real transcript history exists',
);
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
assert.equal(firstSocket.sent.filter(message => message.type === 'history_chunk_request').length, 1,
  'initial history request should be sent alongside the subscription handshake');
const historyLoadingStateIndex = states.findIndex(state => (
  state && state['reconnect-session']?.kind === 'chunked'
));
assert(historyLoadingStateIndex >= 0, 'history request should expose a visible loading state');
firstSocket.close();
assert.deepEqual(states[historyLoadingStateIndex], {}, 'socket close should clear visible loading state');

runTimer(250);
const secondSocket = FakeWebSocket.instances[1];
secondSocket.open();
relay.requestHistoryChunk('reconnect-session', { source: 'native' });
const reconnectHistoryRequests = secondSocket.sent.filter(message => message.type === 'history_chunk_request');
assert.equal(reconnectHistoryRequests.length, 1,
  'reconnected socket should be allowed to request history again alongside subscription replay');
const reconnectRequest = reconnectHistoryRequests[0];
assert.equal(reconnectRequest.replace, true, 'tail history requests should replace stale browser state by default');
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'reconnect-session',
  request_id: reconnectRequest.request_id,
  mode: 'tail',
  replace: reconnectRequest.replace,
  source: 'codex_cli_jsonl',
  messages: [{ role: 'assistant', content: 'restored' }],
  loaded_messages: 1,
  total_messages: 1,
  partial: false,
  cursor: {},
});
assert.equal(relay.messages['reconnect-session'][0].content, 'restored');
assert.equal(states[historyLoadingStateIndex]['reconnect-session'], undefined, 'successful history should clear loading state');

relay.messages['delta-session'] = [
  { id: 1, sequence: 40, role: 'user', content: 'already loaded' },
  { id: 2, sequence: 41, role: 'assistant', content: 'existing reply' },
];
relay.requestHistory('delta-session', { afterSequence: 41 });
const deltaRequest = secondSocket.sent.find(message => message.session_id === 'delta-session');
assert.equal(deltaRequest.type, 'history_request', 'reconnect resync must use the versioned history request');
assert.equal(deltaRequest.after_sequence, 41, 'reconnect resync must request only sequences after the local tail');
assert.equal(deltaRequest.limit, undefined, 'delta resync must not replay a bounded tail');
secondSocket.receive({
  type: 'history_delta',
  session_id: 'delta-session',
  request_id: deltaRequest.request_id,
  after_sequence: 41,
  last_sequence: 42,
  total_messages: 3,
  messages: [
    { id: 2, sequence: 41, role: 'assistant', content: 'existing reply' },
    { id: 3, sequence: 42, role: 'assistant', content: 'new delta reply' },
  ],
});
assert.deepEqual(
  relay.messages['delta-session'].map(message => message.content),
  ['already loaded', 'existing reply', 'new delta reply'],
  'history deltas must append only unseen messages',
);
assert.equal(states[historyLoadingStateIndex]['delta-session'], undefined, 'delta completion must clear loading state');

relay.messages['replace-session'] = [
  { role: 'user', content: 'stale duplicated turn' },
  { role: 'assistant', content: 'stale duplicated reply' },
];
relay.requestHistoryChunk('replace-session', { source: 'relay_sqlite' });
const replaceRequest = secondSocket.sent.find(message => message.session_id === 'replace-session');
assert.equal(replaceRequest.replace, true, 'relay SQLite tail request should request authoritative replacement');
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'replace-session',
  request_id: replaceRequest.request_id,
  mode: 'tail',
  replace: true,
  source: 'relay_sqlite',
  messages: [{ role: 'assistant', content: 'authoritative tail only' }],
  loaded_messages: 1,
  total_messages: 1,
  partial: false,
  cursor: {},
});
assert.deepEqual(
  relay.messages['replace-session'].map(message => message.content),
  ['authoritative tail only'],
  'authoritative tail should remove a stale duplicated browser prefix instead of merging it',
);

relay.messages['native-short-session'] = [
  { source_message_id: 'native-short-1', role: 'assistant', content: 'retained prose one' },
  { source_message_id: 'native-short-2', role: 'assistant', content: 'retained prose two' },
];
relay.requestHistoryChunk('native-short-session', { source: 'native', limit: 2 });
const nativeShortRequest = secondSocket.sent.find(message => message.session_id === 'native-short-session');
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'native-short-session',
  request_id: nativeShortRequest.request_id,
  mode: 'tail',
  replace: true,
  source: 'codex_cli_jsonl',
  messages: [{ source_message_id: 'native-short-2', role: 'assistant', content: 'retained prose two' }],
  loaded_messages: 1,
  total_messages: 2,
  partial: true,
  cursor: { next_before_offset: 100 },
});
assert.deepEqual(
  relay.messages['native-short-session'].map(message => message.content),
  ['retained prose one', 'retained prose two'],
  'an undersized native tail must not overwrite a larger transcript already held by the client',
);

relay.requestHistoryChunk('native-race-session', { source: 'native', limit: 2 });
const nativeRaceRequest = secondSocket.sent.find(message => message.session_id === 'native-race-session');
secondSocket.receive({
  type: 'message',
  session: 'native-race-session',
  source_message_id: 'native-race-live',
  role: 'assistant',
  content: 'live prose appended during hydration',
  ts: 2,
});
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'native-race-session',
  request_id: nativeRaceRequest.request_id,
  mode: 'tail',
  replace: true,
  source: 'codex_cli_jsonl',
  messages: [{ source_message_id: 'native-race-history', role: 'assistant', content: 'cold history prose', ts: 1 }],
  loaded_messages: 1,
  total_messages: 1,
  partial: false,
  cursor: {},
});
assert.deepEqual(
  relay.messages['native-race-session'].map(message => message.content),
  ['cold history prose', 'live prose appended during hydration'],
  'a live append during initial history load must survive replacement reconciliation',
);

relay.requestHistoryChunk('stale-tail-session', { source: 'relay_sqlite' });
const staleTailRequests = () => secondSocket.sent.filter(message => message.session_id === 'stale-tail-session');
const firstStaleTailRequest = staleTailRequests()[0];
runTimer(15000);
assert.equal(staleTailRequests().length, 2, 'tail timeout should advance to one retry request');
secondSocket.receive({
  type: 'history_chunk',
  session_id: 'stale-tail-session',
  request_id: firstStaleTailRequest.request_id,
  mode: 'tail',
  replace: true,
  source: 'relay_sqlite',
  messages: [{ role: 'assistant', content: 'compatible earlier tail' }],
  loaded_messages: 1,
  total_messages: 1,
  partial: false,
  cursor: {},
});
assert.equal(
  relay.messages['stale-tail-session'][0].content,
  'compatible earlier tail',
  'a compatible authoritative tail must not be discarded after the retry ID advances',
);
assert.equal(states[historyLoadingStateIndex]['stale-tail-session'], undefined, 'compatible tail should clear retry loading state');

relay.requestHistoryChunk('timeout-session', { source: 'native' });
assert.equal(secondSocket.sent.filter(message => message.session_id === 'timeout-session').length, 1);
runTimer(15000);
assert.equal(secondSocket.sent.filter(message => message.session_id === 'timeout-session').length, 2, 'first timeout should retry once');
runTimer(15000);
assert.equal(states[historyLoadingStateIndex]['timeout-session'], undefined, 'final timeout should clear loading state');
assert.match(states[1]['timeout-session'].error, /timed out/i, 'final timeout should expose an actionable error');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.jsx'), 'utf8');
assert(
  !/return list\.slice\(0,\s*8\);/.test(appSource),
  'desktop thread tabs must preserve the complete native thread inventory instead of hiding entries after the eighth tab',
);
assert.match(
  appSource,
  /const CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES = 256 \* 1024;/,
  'native CLI initial history must remain bounded so another selected session is not starved by initial rendering',
);
assert.match(
  appSource,
  /\? \{ chunkBytes: CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES \}/,
  'Codex/Cursor CLI initial history requests must carry the bounded chunk size',
);
assert.match(
  appSource,
  /function selectSession\(id, sessionMeta\)[\s\S]*?requestHistory\(id, historyRequestOptionsFor\(sessionMeta\)\)/,
  'selecting a session must refresh history even when a stale startup placeholder is already rendered',
);
assert.match(
  appSource,
  /list\.scrollTop < 160[\s\S]*?requestOlderHistoryRef\.current\?\.\(\)/,
  'intentional top-of-scroll navigation must trigger one bounded older-history request',
);
assert.match(
  appSource,
  /lastSequence > 0[\s\S]*?requestHistory\(activeSession, \{ afterSequence: lastSequence \}\)/,
  'reconnect with sequenced local history must request a delta instead of replacing the tail',
);

console.log('frontend history reconnect smoke: PASS');
