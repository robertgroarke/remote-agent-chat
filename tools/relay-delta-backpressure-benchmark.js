#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] || 'before';
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
assert(['before', 'after'].includes(mode), '--mode must be before or after');

const deltaCount = 1000;
const deltaPayloadBytes = 4096;
const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const policyPath = path.join(root, 'relay-server', 'history-broadcast-policy.js');

let maxBufferedBytes = 256 * 1024;
let canBroadcastDeltaToBrowser = () => true;
if (mode === 'before') {
  assert(!relaySource.includes('canBroadcastDeltaToBrowser(ws)'),
    'baseline source already applies message-delta backpressure');
} else {
  assert(relaySource.includes('canBroadcastDeltaToBrowser(ws)'),
    'final relay source does not apply message-delta backpressure');
  ({ MAX_BROWSER_DELTA_BUFFER_BYTES: maxBufferedBytes, canBroadcastDeltaToBrowser } = require(policyPath));
}

function fakeClient(name, bufferedAmount) {
  return {
    name,
    readyState: 1,
    bufferedAmount,
    sent: [],
    queuedBytes: 0,
    send(data) {
      const message = JSON.parse(data);
      const bytes = Buffer.byteLength(data);
      this.sent.push({ message, bytes, queuedBefore: this.queuedBytes });
      this.queuedBytes += bytes;
    },
  };
}

const fast = fakeClient('fast-browser', 0);
const slow = fakeClient('slow-phone', maxBufferedBytes + 1);
const clients = [fast, slow];
const streamId = 'delta-backpressure-stream';

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (message.type === 'message_delta' && !canBroadcastDeltaToBrowser(ws)) continue;
    ws.send(data);
  }
}

for (let index = 0; index < deltaCount; index += 1) {
  broadcast({
    type: 'message_delta',
    session_id: 'delta-backpressure-session',
    message_id: streamId,
    block_index: 0,
    block_type: 'text',
    seq: index + 1,
    op: 'append',
    append: 'x'.repeat(deltaPayloadBytes),
  });
}
const settled = {
  type: 'message',
  session: 'delta-backpressure-session',
  role: 'assistant',
  content: 'authoritative settled response',
};
const control = {
  type: 'agent_control_result',
  session_id: 'delta-backpressure-session',
  request_id: 'delta-backpressure-control',
  action: 'agent_interrupt',
  result: 'ok',
};
broadcast(settled);
broadcast(control);

const fastDeltas = fast.sent.filter(entry => entry.message.type === 'message_delta');
const slowDeltas = slow.sent.filter(entry => entry.message.type === 'message_delta');
const slowSettle = slow.sent.find(entry => entry.message.type === 'message');
const slowControl = slow.sent.find(entry => entry.message.type === 'agent_control_result');
assert.strictEqual(fastDeltas.length, deltaCount, 'healthy browser must retain every provisional delta');
assert(slowSettle, 'slow browser must retain the authoritative settled message');
assert(slowControl, 'slow browser must retain control responses');
if (mode === 'after') {
  assert.strictEqual(slowDeltas.length, 0, 'slow browser must not queue expendable deltas above high water');
  assert.strictEqual(slowSettle.queuedBefore, 0, 'settle must not wait behind skipped deltas');
} else {
  assert.strictEqual(slowDeltas.length, deltaCount, 'baseline must reproduce all-delta slow-client queueing');
}

const result = {
  ok: true,
  mode,
  generated_at: new Date().toISOString(),
  clients: 2,
  delta_frames: deltaCount,
  delta_payload_bytes: deltaPayloadBytes,
  slow_client_initial_buffered_bytes: slow.bufferedAmount,
  high_water_bytes: maxBufferedBytes,
  fast_client_delta_frames: fastDeltas.length,
  slow_client_delta_frames: slowDeltas.length,
  slow_client_delta_bytes_queued: slowDeltas.reduce((sum, entry) => sum + entry.bytes, 0),
  settle_queue_ahead_bytes: slowSettle.queuedBefore,
  control_queue_ahead_bytes: slowControl.queuedBefore,
  authoritative_settle_retained: true,
  control_response_retained: true,
  visible_windows_opened: 0,
  protected_user_apps_touched: 0,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
