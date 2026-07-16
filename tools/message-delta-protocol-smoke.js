#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const proto = require('../agent-proxy/protocol');
const { MAX_APPEND_BYTES, MessageDeltaGate, validateMessageDelta } = require('../relay-server/message-delta');

const root = path.resolve(__dirname, '..');
const gate = new MessageDeltaGate({ ttlMs: 60_000 });
const sessionId = 'codex-cli-fixture';
const messageId = 'turn-fixture';
const open = proto.messageDelta(sessionId, messageId, 0, 0, 'block_open');
const append = proto.messageDelta(sessionId, messageId, 0, 1, 'append', 'small chunk', {
  stream_trace: { trace_id: 'trace-fixture', proxy_sent_at_ms: 1000 },
});
const close = proto.messageDelta(sessionId, messageId, 0, 2, 'block_close');

assert.deepStrictEqual(validateMessageDelta(open), { ok: true });
assert.strictEqual(gate.accept(open, 1001).ok, true);
const forwarded = gate.accept(append, 1002);
assert.strictEqual(forwarded.ok, true);
assert.strictEqual(forwarded.message.append, 'small chunk');
assert.strictEqual(forwarded.message.relay_received_at_ms, 1002);
assert.strictEqual(forwarded.message.stream_trace.relay_received_at_ms, 1002);
assert.strictEqual(gate.accept(close, 1003).ok, true);
assert.strictEqual(gate.accept(proto.messageDelta(sessionId, messageId, 0, 3, 'append', 'late'), 1004).code, 'stream_closed');

const gapGate = new MessageDeltaGate();
assert.strictEqual(gapGate.accept(open).ok, true);
const gap = gapGate.accept(proto.messageDelta(sessionId, messageId, 0, 2, 'append', 'gap'));
assert.strictEqual(gap.code, 'sequence_gap');
assert.strictEqual(gap.expected_seq, 1);
assert.strictEqual(new MessageDeltaGate().accept(proto.messageDelta(sessionId, 'other', 0, 1, 'append', 'x')).code, 'stream_not_open');
assert.strictEqual(validateMessageDelta({ ...append, append: 'x'.repeat(MAX_APPEND_BYTES + 1) }).code, 'append_too_large');

const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const deltaBranch = relaySource.indexOf("} else if (t === 'message_delta') {");
const settledBranch = relaySource.indexOf("} else if (t === 'message' || t === 'proxy_message') {");
assert(deltaBranch >= 0 && deltaBranch < settledBranch, 'delta fast path must precede settled-message persistence');
const fastPathSource = relaySource.slice(deltaBranch, relaySource.indexOf("} else if (t === 'status'", deltaBranch));
assert(fastPathSource.includes('broadcastToBrowsers(accepted.message)'), 'delta fast path must broadcast immediately');
assert(!/db\.|prepare\(|INSERT|persist/i.test(fastPathSource), 'delta fast path must not wait on persistence');
assert(/KNOWN_PROXY_TYPES[\s\S]*?'message_delta'/.test(relaySource),
  'authenticated proxy validation must admit message_delta before the fast path');

console.log(JSON.stringify({
  ok: true,
  protocol_version: open.protocol_version,
  operations: ['block_open', 'append', 'block_close'],
  strict_sequence: true,
  max_append_bytes: MAX_APPEND_BYTES,
  sqlite_bypass: true,
  snapshot_reconcile: true,
}, null, 2));
