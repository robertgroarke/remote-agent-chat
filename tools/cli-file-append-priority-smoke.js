#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { performance } = require('perf_hooks');

const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('timed out waiting for append drain'));
      setImmediate(check);
    };
    check();
  });
}

async function main() {
  const engine = Object.create(ProxyEngine.prototype);
  engine._running = true;
  engine._log = () => {};
  const filePath = 'C:\\owned\\codex.jsonl';
  const baseline = [{ role: 'user', content: 'row-0', native_source_id: 'row-0' }];
  const burst = [...baseline, ...Array.from({ length: 80 }, (_, index) => ({
    role: 'assistant',
    content: `row-${index + 1}`,
    native_source_id: `row-${index + 1}`,
  }))];
  const latest = [...burst, {
    role: 'assistant',
    content: 'row-81',
    native_source_id: 'row-81',
  }];
  const session = {
    agentType: 'codex_cli',
    _fileTranscriptState: engine._fileTranscriptState('codex_cli', filePath, baseline, {
      start_offset: 0,
      end_offset: 10,
    }),
  };
  const sent = [];
  engine._sendProxyMessage = (sessionId, frame) => {
    const busyUntil = performance.now() + 2;
    while (performance.now() < busyUntil) {}
    sent.push({ sessionId, content: frame.content });
    return true;
  };

  let controlObservedAt = null;
  setTimeout(() => { controlObservedAt = sent.length; }, 0);
  const callStarted = performance.now();
  const scheduled = engine._sendFileBackedTranscriptUpdate(
    'priority-session',
    session,
    burst,
    {
      agentType: 'codex_cli',
      filePath,
      sourceCursor: { start_offset: 10, end_offset: 9000 },
      reason: 'large owned append',
    },
  );
  const callElapsedMs = performance.now() - callStarted;
  assert.strictEqual(scheduled.mode, 'append_scheduled');
  assert.strictEqual(scheduled.pending, 80);
  assert(callElapsedMs < 50, `large append scheduling blocked for ${callElapsedMs.toFixed(1)}ms`);

  const coalesced = engine._sendFileBackedTranscriptUpdate(
    'priority-session',
    session,
    latest,
    {
      agentType: 'codex_cli',
      filePath,
      sourceCursor: { start_offset: 10, end_offset: 9100 },
      reason: 'newer owned append',
    },
  );
  assert.strictEqual(coalesced.mode, 'append_coalesced');
  await waitFor(() => !session._fileTranscriptAppendDrain
    && session._fileTranscriptState?.messages?.length === latest.length);

  assert(controlObservedAt != null, 'event-loop control callback never ran during the append drain');
  assert(controlObservedAt < 80,
    `control callback was starved behind all ${controlObservedAt} initial catch-up rows`);
  assert.deepStrictEqual(sent.map(item => item.content),
    Array.from({ length: 81 }, (_, index) => `row-${index + 1}`));
  assert.strictEqual(session._fileTranscriptState.messages.length, 82);

  console.log(JSON.stringify({
    ok: true,
    scheduled_rows: scheduled.pending,
    coalesced_newer_update: true,
    semantic_rows_sent: sent.length,
    control_observed_after_rows: controlObservedAt,
    initial_call_ms: Math.round(callElapsedMs * 1000) / 1000,
    final_state_rows: session._fileTranscriptState.messages.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
