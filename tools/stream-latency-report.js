#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HOPS = [
  ['native_to_proxy_read_ms', 'native_event_at_ms', 'proxy_read_at_ms'],
  ['proxy_read_to_normalize_ms', 'proxy_read_at_ms', 'proxy_normalized_at_ms'],
  ['normalize_to_proxy_send_ms', 'proxy_normalized_at_ms', 'proxy_sent_at_ms'],
  ['proxy_send_to_relay_receive_ms', 'proxy_sent_at_ms', 'relay_received_at_ms'],
  ['relay_receive_to_forward_ms', 'relay_received_at_ms', 'relay_forwarded_at_ms'],
  ['relay_forward_to_browser_receive_ms', 'relay_forwarded_at_ms', 'browser_received_at_ms'],
  ['browser_receive_to_paint_ms', 'browser_received_at_ms', 'browser_paint_at_ms'],
  ['native_to_browser_paint_ms', 'native_event_at_ms', 'browser_paint_at_ms'],
];

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function hopDurations(trace) {
  const durations = {};
  for (const [name, startField, endField] of HOPS) {
    const start = Number(trace?.[startField]);
    const end = Number(trace?.[endField]);
    assert(Number.isFinite(start), `stream trace is missing ${startField}`);
    assert(Number.isFinite(end), `stream trace is missing ${endField}`);
    assert(end >= start, `${endField} precedes ${startField}`);
    durations[name] = end - start;
  }
  return durations;
}

function summarizeTraces(traces) {
  assert(Array.isArray(traces) && traces.length > 0, 'at least one stream trace is required');
  const normalized = traces.map(trace => ({
    ...trace,
    durations: hopDurations(trace),
  }));
  const byHarness = new Map();
  for (const trace of normalized) {
    const harness = String(trace.agent_type || 'unknown');
    if (!byHarness.has(harness)) byHarness.set(harness, []);
    byHarness.get(harness).push(trace);
  }
  return {
    generated_at: new Date().toISOString(),
    traces: normalized.length,
    harnesses: [...byHarness.entries()].map(([agentType, rows]) => ({
      agent_type: agentType,
      samples: rows.length,
      hops: Object.fromEntries(HOPS.map(([name]) => {
        const values = rows.map(row => row.durations[name]);
        return [name, { p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95) }];
      })),
    })),
  };
}

function readTraces(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) return JSON.parse(raw);
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed.traces)) return parsed.traces;
  if (parsed.stream_trace) return [parsed.stream_trace];
  if (parsed.trace_id) return [parsed];
  return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0] ? path.resolve(argv[0]) : '';
  assert(input, 'usage: node tools/stream-latency-report.js <trace.json|jsonl> [output.json]');
  const report = summarizeTraces(readTraces(input));
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (argv[1]) fs.writeFileSync(path.resolve(argv[1]), encoded, 'utf8');
  process.stdout.write(encoded);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Stream latency report: FAIL (${error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { HOPS, hopDurations, percentile, readTraces, summarizeTraces };
