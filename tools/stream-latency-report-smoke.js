#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hopDurations, readTraces, summarizeTraces } = require('./stream-latency-report');

function trace(agentType, base, offsets) {
  return {
    trace_id: `${agentType}-${base}`,
    agent_type: agentType,
    native_event_at_ms: base,
    proxy_read_at_ms: base + offsets[0],
    proxy_normalized_at_ms: base + offsets[1],
    proxy_sent_at_ms: base + offsets[2],
    relay_received_at_ms: base + offsets[3],
    relay_forwarded_at_ms: base + offsets[4],
    browser_received_at_ms: base + offsets[5],
    browser_paint_at_ms: base + offsets[6],
  };
}

const rows = [
  trace('codex_cli', 1_000, [20, 32, 35, 42, 44, 52, 68]),
  trace('codex_cli', 2_000, [24, 39, 43, 51, 54, 65, 84]),
  trace('codex_cli', 3_000, [22, 35, 39, 47, 50, 60, 76]),
];

assert.deepStrictEqual(hopDurations(rows[0]), {
  native_to_proxy_read_ms: 20,
  proxy_read_to_normalize_ms: 12,
  normalize_to_proxy_send_ms: 3,
  proxy_send_to_relay_receive_ms: 7,
  relay_receive_to_forward_ms: 2,
  relay_forward_to_browser_receive_ms: 8,
  browser_receive_to_paint_ms: 16,
  native_to_browser_paint_ms: 68,
});

const report = summarizeTraces(rows);
assert.strictEqual(report.traces, 3);
assert.strictEqual(report.harnesses[0].agent_type, 'codex_cli');
assert.strictEqual(report.harnesses[0].hops.native_to_browser_paint_ms.p50_ms, 76);
assert.strictEqual(report.harnesses[0].hops.native_to_browser_paint_ms.p95_ms, 84);
assert.throws(() => hopDurations({ ...rows[0], proxy_read_at_ms: 999 }), /precedes/);

const fixture = path.join(os.tmpdir(), `rac-stream-trace-${process.pid}.json`);
try {
  fs.writeFileSync(fixture, `${JSON.stringify(rows[0], null, 2)}\n`, 'utf8');
  assert.deepStrictEqual(readTraces(fixture), [rows[0]]);
} finally {
  try { fs.unlinkSync(fixture); } catch {}
}

console.log('Stream latency report smoke: PASS (8 correlated hops, p50/p95 aggregation, monotonic fail-closed validation)');
