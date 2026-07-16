#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { hopDurations } = require('./stream-latency-report');

const root = path.resolve(__dirname, '..');
const engine = Object.create(ProxyEngine.prototype);
const sent = [];
engine._sendToRelay = message => {
  sent.push(message);
  return true;
};

const proxyReadAtMs = Date.now();
const nativeEventAtMs = proxyReadAtMs - 7;
const session = { status: 'healthy', agentType: 'codex_cli' };
engine._handleCodexCliJsonEvent(session, 'trace-session', JSON.stringify({
  type: 'item.updated',
  timestamp_ms: nativeEventAtMs,
  item: {
    id: 'answer-1',
    type: 'agent_message',
    text: 'Streaming answer text',
  },
}), proxyReadAtMs);

assert.strictEqual(sent.length, 1);
const status = sent[0];
assert.strictEqual(status.type, 'proxy_status');
assert.strictEqual(status.activity.current.kind, 'answer');
assert.strictEqual(status.activity.current.partial, 'Streaming answer text');
assert.strictEqual(status.activity.thinking, undefined, 'answer chunks must not be copied into reasoning');
assert(status.stream_trace.trace_id);
assert.strictEqual(status.stream_trace.agent_type, 'codex_cli');
assert.strictEqual(status.stream_trace.native_event_at_ms, nativeEventAtMs);
assert.strictEqual(status.stream_trace.proxy_read_at_ms, proxyReadAtMs);
assert(status.stream_trace.proxy_normalized_at_ms >= proxyReadAtMs);
assert(status.stream_trace.proxy_sent_at_ms >= status.stream_trace.proxy_normalized_at_ms);

const completeTrace = {
  ...status.stream_trace,
  relay_received_at_ms: status.stream_trace.proxy_sent_at_ms + 1,
  relay_forwarded_at_ms: status.stream_trace.proxy_sent_at_ms + 2,
  browser_received_at_ms: status.stream_trace.proxy_sent_at_ms + 3,
  browser_paint_at_ms: status.stream_trace.proxy_sent_at_ms + 20,
};
assert.strictEqual(hopDurations(completeTrace).browser_receive_to_paint_ms, 17);

const relay = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const protocol = fs.readFileSync(path.join(root, 'protocol.md'), 'utf8');
assert(/relay_received_at_ms:\s*proxyMessageReceivedAtMs/.test(relay));
assert(/relay_forwarded_at_ms\s*=\s*Date\.now\(\)/.test(relay));
assert(/browser_received_at_ms:\s*Date\.now\(\)/.test(hooks));
assert(/__RAC_STREAM_TRACES__/.test(hooks) && /browser_paint_at_ms:\s*Date\.now\(\)/.test(hooks));
assert(/native_event_at_ms[\s\S]+browser_paint_at_ms/.test(protocol));

console.log('Codex CLI stream trace smoke: PASS (native, proxy read/normalize/send, relay receive/forward, browser receive/paint)');
