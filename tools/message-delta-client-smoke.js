#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webModulePath = path.join(root, 'frontend', 'message-delta.js');
const androidModulePath = path.join(root, 'android-app', 'lib', 'message-delta.js');
const flushModulePath = path.join(root, 'frontend', 'provisional-flush.js');
const webSource = fs.readFileSync(webModulePath, 'utf8');
const androidSource = fs.readFileSync(androidModulePath, 'utf8');
const flushSource = fs.readFileSync(flushModulePath, 'utf8');
const normalizeEol = source => source.replace(/\r\n/g, '\n');
assert.strictEqual(normalizeEol(androidSource), normalizeEol(webSource),
  'web and Android delta reducers must remain source-identical after checkout EOL normalization');

function loadReducer(source) {
  const executable = `${source.replace(/export\s+function\s+/g, 'function ')}\nreturn { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal };`;
  return Function(executable)();
}

const { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal } = loadReducer(webSource);
const mergeProvisionalFlushItem = Function(
  `${flushSource.replace(/export\s+function\s+/g, 'function ')}\nreturn mergeProvisionalFlushItem;`,
)();
let stream = createProvisionalStream('session-1', 'cid-1', 1000);
assert.strictEqual(shouldClearEmptyProvisionalOnTerminal(stream, { kind: 'idle' }), true);
assert.strictEqual(shouldClearEmptyProvisionalOnTerminal(stream, { kind: 'completed' }), true);
assert.strictEqual(shouldClearEmptyProvisionalOnTerminal(stream, { kind: 'working' }), false);
assert.strictEqual(shouldClearEmptyProvisionalOnTerminal(stream, { kind: 'idle' }, true), false);
assert.strictEqual(shouldClearEmptyProvisionalOnTerminal({ ...stream, content: 'visible partial' }, { kind: 'idle' }), false);
let result = reduceMessageDeltaStream(stream, {
  type: 'message_delta', session_id: 'session-1', message_id: 'message-1', block_index: 0, seq: 0, op: 'block_open',
}, 1001);
assert.strictEqual(result.accepted, true);
stream = result.stream;
assert.strictEqual(stream.clientMessageId, 'cid-1');
assert.strictEqual(stream.startedAtMs, 1000);
for (const [seq, append] of [[1, 'Hello'], [2, ' world']]) {
  result = reduceMessageDeltaStream(stream, {
    type: 'message_delta', session_id: 'session-1', message_id: 'message-1', block_index: 0, seq, op: 'append', append,
  });
  assert.strictEqual(result.accepted, true);
  stream = result.stream;
}
assert.strictEqual(stream.content, 'Hello world');
assert.strictEqual(reduceMessageDeltaStream(stream, {
  type: 'message_delta', session_id: 'session-1', message_id: 'message-1', block_index: 0, seq: 4, op: 'append', append: 'gap',
}).code, 'sequence_gap');
result = reduceMessageDeltaStream(stream, {
  type: 'message_delta', session_id: 'session-1', message_id: 'message-1', block_index: 0, seq: 3, op: 'block_close',
});
assert.strictEqual(result.accepted, true);
assert.strictEqual(result.stream.open, false);

const firstTrace = { trace_id: 'trace-first-output' };
const firstStreamTrace = { trace_id: 'stream-first-output' };
let pendingFlush = mergeProvisionalFlushItem(null, {
  stream: { ...stream, seq: 2, content: 'Hello world', open: true },
  streamTrace: firstStreamTrace,
  latencyTrace: firstTrace,
  receivedAtMs: 2000,
});
pendingFlush = mergeProvisionalFlushItem(pendingFlush, {
  stream: { ...stream, seq: 3, content: 'Hello world', open: false },
  streamTrace: null,
  latencyTrace: null,
  receivedAtMs: 2001,
});
assert.strictEqual(pendingFlush.stream.open, false,
  'same-frame close must publish the newest stream state');
assert.strictEqual(pendingFlush.streamTrace, firstStreamTrace,
  'same-frame untraced close must not erase the first-output stream trace');
assert.strictEqual(pendingFlush.latencyTrace, firstTrace,
  'same-frame untraced close must not erase the first-output latency trace');
assert.strictEqual(pendingFlush.receivedAtMs, 2000,
  'retained latency trace must keep its matching browser receive timestamp');
const replacementTrace = { trace_id: 'trace-replacement' };
pendingFlush = mergeProvisionalFlushItem(pendingFlush, {
  stream: { ...stream, seq: 4, content: 'Hello world!', open: true },
  latencyTrace: replacementTrace,
  receivedAtMs: 2002,
});
assert.strictEqual(pendingFlush.latencyTrace, replacementTrace,
  'a later traced delta must replace earlier pending trace metadata');
assert.strictEqual(pendingFlush.receivedAtMs, 2002,
  'replacement trace must carry its own receive timestamp');
const nextFrame = mergeProvisionalFlushItem(null, {
  stream: { ...stream, seq: 5, content: 'Hello world!!', open: true },
});
assert.strictEqual(nextFrame.latencyTrace, null,
  'a cleared render batch must not leak a prior response trace');

const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
assert(hooks.includes("if (t === 'message_delta')") && hooks.includes('provisionalPendingFlush'),
  'web relay hook must consume and rAF-batch message deltas');
assert(hooks.includes("if (role === 'assistant') clearProvisionalStream(id)"),
  'settled web assistant message must atomically reconcile the provisional row');
assert(hooks.includes('shouldClearEmptyProvisionalOnTerminal('),
  'terminal web activity must reconcile an empty provisional row');
assert(app.includes('node.appendChild(document.createTextNode(append))'),
  'web provisional row must append text nodes in place');
assert(app.includes('<ProvisionalStreamingBubble') && styles.includes('.provisional-stream-caret'),
  'web provisional row and themed caret must render');
assert(android.includes("case 'message_delta':") && android.includes('requestAnimationFrame'),
  'Android must consume and rAF-batch the same deltas');
assert(android.includes('ListFooterComponent={visibleProvisionalStream ? <ProvisionalBubble'),
  'Android must render only the selected-thread provisional assistant row in transcript order');
assert(android.includes("if (msg.role === 'assistant') clearProvisionalStream()"),
  'settled Android assistant message must reconcile the provisional row');
assert(android.includes('shouldClearEmptyProvisionalOnTerminal('),
  'terminal Android activity must reconcile an empty provisional row');

console.log(JSON.stringify({
  ok: true,
  clients: ['web', 'android'],
  shared_reducer_identical: true,
  reconstructed: stream.content,
  sequence_gap_rejected: true,
  empty_terminal_stream_cleared: true,
  nonempty_terminal_stream_preserved_until_settle: true,
  web_dom_append: 'O(chunk)',
  raf_batched: true,
  same_frame_close_trace_retained: true,
  later_trace_replaced_atomically: true,
  cleared_batch_trace_isolated: true,
  snapshot_reconcile: true,
}, null, 2));
