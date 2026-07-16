#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webModulePath = path.join(root, 'frontend', 'message-delta.js');
const androidModulePath = path.join(root, 'android-app', 'lib', 'message-delta.js');
const webSource = fs.readFileSync(webModulePath, 'utf8');
const androidSource = fs.readFileSync(androidModulePath, 'utf8');
assert.strictEqual(androidSource, webSource, 'web and Android delta reducers must remain byte-identical');

function loadReducer(source) {
  const executable = `${source.replace(/export\s+function\s+/g, 'function ')}\nreturn { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal };`;
  return Function(executable)();
}

const { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal } = loadReducer(webSource);
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
assert(android.includes('ListFooterComponent={provisionalStream ? <ProvisionalBubble'),
  'Android must render the provisional assistant row in transcript order');
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
  snapshot_reconcile: true,
}, null, 2));
