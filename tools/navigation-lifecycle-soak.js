#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { monitorEventLoopDelay } = require('perf_hooks');
const { LatestSessionOperationQueue } = require('../agent-proxy/latest-session-operation-queue');
const {
  NavigationEpochRegistry,
  evaluateNavigationMessage,
} = require('../relay-server/navigation-epoch');

const FORMAL_SOAK_MS = 60 * 60 * 1000;

function numericArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? Number(value.slice(prefix.length)) : fallback;
}

const durationMs = Math.max(1000, numericArg('duration-ms', FORMAL_SOAK_MS));
const sessionCount = Math.max(1, Math.min(256, numericArg('sessions', 16)));
const allowShortSoak = process.argv.includes('--allow-short-soak');
if (durationMs < FORMAL_SOAK_MS && !allowShortSoak) {
  throw new Error('Sub-hour runs require --allow-short-soak so formal and accelerated evidence cannot be confused.');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessions = Array.from({ length: sessionCount }, (_, index) => `soak-session-${index}`);
let registry = new NavigationEpochRegistry({ maxEntries: sessionCount });
let issued = 0;
let completed = 0;
let superseded = 0;
let stalePayloads = 0;
let acceptedPayloads = 0;
let terminalSupersededResults = 0;
let legacySendFrames = 0;
let reconnects = 0;

const queue = new LatestSessionOperationQueue({
  onSupersede: operation => {
    superseded += 1;
    const gated = evaluateNavigationMessage(registry, {
      type: 'agent_control_result',
      session_id: operation.sessionId,
      request_id: operation.requestId,
      command: 'switch_chat',
      result: 'failed',
      navigation_epoch: operation.navigationEpoch,
    });
    if (gated.message?.error?.code === 'operation_superseded') terminalSupersededResults += 1;
  },
});

function enqueueNavigation(sessionId) {
  const navigationEpoch = registry.issue(sessionId);
  issued += 1;
  void queue.enqueue(sessionId, {
    sessionId,
    requestId: `soak-${issued}`,
    navigationEpoch,
  }, async () => {
    await delay((issued + sessionId.length) % 4);
    const gated = evaluateNavigationMessage(registry, {
      type: 'history_snapshot',
      session_id: sessionId,
      navigation_epoch: navigationEpoch,
      messages: [{ role: 'user', content: `epoch-${navigationEpoch}` }],
    });
    if (gated.accepted) acceptedPayloads += 1;
    else stalePayloads += 1;
    completed += 1;
  });
}

async function main() {
  if (global.gc) global.gc();
  const heapStart = process.memoryUsage().heapUsed;
  const cpuStart = process.cpuUsage();
  const startedAt = Date.now();
  let nextReconnectAt = startedAt + 5000;
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  while (Date.now() - startedAt < durationMs) {
    for (const sessionId of sessions) {
      enqueueNavigation(sessionId);
      enqueueNavigation(sessionId);
      const legacySend = evaluateNavigationMessage(registry, {
        type: 'proxy_message',
        session_id: sessionId,
        client_message_id: `send-${issued}`,
      });
      if (legacySend.accepted) legacySendFrames += 1;
    }
    if (Date.now() >= nextReconnectAt) {
      registry = new NavigationEpochRegistry({ maxEntries: sessionCount });
      reconnects += 1;
      nextReconnectAt = Date.now() + 5000;
    }
    await delay(10);
  }

  const finalAcceptedBefore = acceptedPayloads;
  const finalOperations = sessions.map(sessionId => {
    const navigationEpoch = registry.issue(sessionId);
    issued += 1;
    return queue.enqueue(sessionId, {
      sessionId,
      requestId: `final-${sessionId}`,
      navigationEpoch,
    }, async () => {
      await delay(1);
      const gated = evaluateNavigationMessage(registry, {
        type: 'history_snapshot',
        session_id: sessionId,
        navigation_epoch: navigationEpoch,
        messages: [{ role: 'user', content: 'final' }],
      });
      assert.strictEqual(gated.accepted, true, `final navigation was rejected for ${sessionId}`);
      acceptedPayloads += 1;
      completed += 1;
    });
  });
  await Promise.all(finalOperations);
  await delay(25);

  eventLoop.disable();
  if (global.gc) global.gc();
  const elapsedMs = Date.now() - startedAt;
  const heapEnd = process.memoryUsage().heapUsed;
  const cpu = process.cpuUsage(cpuStart);
  const cpuPercent = ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100;
  const heapGrowthBytes = heapEnd - heapStart;
  const p99EventLoopMs = eventLoop.percentile(99) / 1e6;

  assert.strictEqual(queue.size, 0, 'navigation queue retained session state after draining');
  assert(registry.size <= sessionCount, 'navigation epoch registry exceeded the session bound');
  assert.strictEqual(acceptedPayloads - finalAcceptedBefore, sessionCount, 'not every final selection was accepted');
  assert(stalePayloads > 0, 'soak did not exercise stale transcript rejection');
  assert(superseded > 0, 'soak did not exercise pending-operation supersession');
  assert(terminalSupersededResults > 0, 'soak did not produce terminal superseded receipts');
  assert(heapGrowthBytes < 32 * 1024 * 1024, `heap grew by ${(heapGrowthBytes / 1024 / 1024).toFixed(1)} MiB`);
  assert(p99EventLoopMs < 250, `p99 event-loop delay reached ${p99EventLoopMs.toFixed(1)} ms`);

  console.log(JSON.stringify({
    result: 'PASS',
    mode: durationMs >= FORMAL_SOAK_MS ? 'formal' : 'accelerated',
    duration_ms: elapsedMs,
    sessions: sessionCount,
    navigation_issued: issued,
    operations_completed: completed,
    pending_operations_superseded: superseded,
    stale_payloads_rejected: stalePayloads,
    payloads_accepted: acceptedPayloads,
    terminal_superseded_results: terminalSupersededResults,
    legacy_send_frames_accepted: legacySendFrames,
    simulated_reconnects: reconnects,
    queue_entries_after_drain: queue.size,
    epoch_entries_after_drain: registry.size,
    heap_growth_bytes: heapGrowthBytes,
    cpu_percent: Number(cpuPercent.toFixed(2)),
    event_loop_p99_ms: Number(p99EventLoopMs.toFixed(2)),
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
