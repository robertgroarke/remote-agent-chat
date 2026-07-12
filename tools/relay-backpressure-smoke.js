#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

async function main() {
  const engine = Object.create(ProxyEngine.prototype);
  const sent = [];
  const logs = [];
  let bufferedAmount = 2 * 1024 * 1024;

  engine.relayReady = true;
  engine._log = (level, message) => logs.push({ level, message });
  engine.relayWs = {
    readyState: 1,
    get bufferedAmount() { return bufferedAmount; },
    send(encoded, callback) {
      sent.push(JSON.parse(encoded));
      if (callback) callback();
    },
  };

  const first = { type: 'history_chunk', session_id: 'session-a', source: 'codex_cli_live_tail', marker: 'first' };
  const latest = { type: 'history_chunk', session_id: 'session-a', source: 'codex_cli_live_tail', marker: 'latest' };
  assert.strictEqual(engine._sendToRelay(first, { bulkKey: 'codex_cli_live_tail:session-a' }), true);
  assert.strictEqual(engine._sendToRelay(latest, { bulkKey: 'codex_cli_live_tail:session-a' }), true);
  assert.strictEqual(sent.length, 0, 'bulk frames should wait above the high-water mark');
  assert.strictEqual(engine._pendingRelayBulk.size, 1, 'bulk frames should coalesce by key');

  const receipt = { type: 'proxy_send_result', session_id: 'session-a', client_message_id: 'message-a', result: 'delivered' };
  assert.strictEqual(engine._sendToRelay(receipt), true);
  assert.deepStrictEqual(sent, [receipt], 'control receipts must bypass bulk backpressure');

  bufferedAmount = 0;
  engine._flushPendingRelayBulk();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.strictEqual(sent.length, 2, 'coalesced bulk frame should flush after the socket drains');
  assert.strictEqual(sent[1].marker, 'latest', 'only the latest coalesced bulk frame should flush');
  assert.strictEqual(engine._pendingRelayBulk.size, 0);
  assert(logs.some(entry => entry.message.includes('Coalescing bulk history_chunk')));

  bufferedAmount = 400 * 1024;
  const projectedOverflow = {
    type: 'history_chunk',
    session_id: 'session-b',
    source: 'codex_cli_live_tail',
    marker: 'projected-overflow',
    payload: 'x'.repeat(200 * 1024),
  };
  assert.strictEqual(engine._sendToRelay(projectedOverflow, { bulkKey: 'codex_cli_live_tail:session-b' }), true);
  assert.strictEqual(sent.length, 2, 'bulk frame must wait when current buffer plus frame would cross the budget');
  assert.strictEqual(engine._pendingRelayBulk.size, 1);

  bufferedAmount = 0;
  engine._flushPendingRelayBulk();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.strictEqual(sent.length, 3);
  assert.strictEqual(sent[2].marker, 'projected-overflow');

  const drainedLargeSnapshot = {
    type: 'history_chunk',
    session_id: 'session-c',
    source: 'codex_desktop_snapshot',
    marker: 'drained-large-snapshot',
    payload: 'x'.repeat(800 * 1024),
  };
  bufferedAmount = 1;
  assert.strictEqual(engine._sendToRelay(drainedLargeSnapshot, { bulkKey: 'history_snapshot:session-c' }), true);
  assert.strictEqual(sent.length, 3, 'a large snapshot must wait until the socket is fully drained');
  assert.strictEqual(engine._pendingRelayBulk.size, 1);

  bufferedAmount = 0;
  engine._flushPendingRelayBulk();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.strictEqual(sent.length, 4, 'a bounded large snapshot must flush on an empty socket');
  assert.strictEqual(sent[3].marker, 'drained-large-snapshot');
  assert.strictEqual(engine._pendingRelayBulk.size, 0);

  const oversizedBulk = {
    type: 'history_chunk',
    session_id: 'session-d',
    source: 'codex_cli_live_tail',
    payload: 'x'.repeat(5 * 1024 * 1024),
  };
  assert.strictEqual(engine._sendToRelay(oversizedBulk, { bulkKey: 'codex_cli_live_tail:session-d' }), false);
  assert.strictEqual(sent.length, 4, 'a frame above the bounded bulk maximum must fail closed');
  assert.strictEqual(engine._pendingRelayBulk.size, 0);
  assert(logs.some(entry => entry.message.includes('Dropping oversized bulk history_chunk')));

  let maintenanceCalls = 0;
  engine._priorityControlInFlight = 1;
  assert.strictEqual(await engine._runBackgroundMaintenanceStep('smoke maintenance', async () => {
    maintenanceCalls++;
  }), false);
  assert.strictEqual(maintenanceCalls, 0, 'background maintenance must yield to a user control');
  engine._priorityControlInFlight = 0;
  assert.strictEqual(await engine._runBackgroundMaintenanceStep('smoke maintenance', async () => {
    maintenanceCalls++;
  }), true);
  assert.strictEqual(maintenanceCalls, 1, 'deferred maintenance must remain runnable after the control settles');

  if (engine._relayBulkFlushTimer) clearTimeout(engine._relayBulkFlushTimer);
  console.log(JSON.stringify({
    ok: true,
    sent_types: sent.map(message => message.type),
    coalesced_marker: sent[1].marker,
    large_snapshot_marker: sent[3].marker,
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
