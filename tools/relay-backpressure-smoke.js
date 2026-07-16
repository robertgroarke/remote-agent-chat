#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

  // A Codex Desktop transcript can fit below the 4 MiB frame ceiling once, but
  // exceed it when the legacy `history` alias duplicates the `messages` array.
  // The proxy must preserve the full authoritative transcript and omit only
  // that redundant compatibility copy instead of dropping the update.
  const compactSessionId = 'session-e';
  const compactMessages = Array.from({ length: 3 }, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `${index}:`.padEnd(800 * 1024, String(index)),
    ts: index + 1,
  }));
  engine.sessions = new Map([[compactSessionId, { agentType: 'codex-desktop' }]]);
  engine._largeHistorySkipLogAt = new Map();
  bufferedAmount = 0;
  const compatibilitySize = engine._historySnapshotSizeInfo(
    compactSessionId, compactMessages, 4 * 1024 * 1024, true
  );
  const compactSize = engine._historySnapshotSizeInfo(
    compactSessionId, compactMessages, 4 * 1024 * 1024, false
  );
  assert.strictEqual(compatibilitySize.fits, false, 'duplicated compatibility snapshot should exceed the fixture budget');
  assert.strictEqual(compactSize.fits, true, 'single-copy canonical snapshot should fit the fixture budget');
  engine._sendHistorySnapshot(compactSessionId, compactMessages, 'assistant completion');
  const compactPending = engine._pendingRelayBulk.get(`history_snapshot:${compactSessionId}`);
  assert(compactPending, 'compact authoritative snapshot should enter the bounded bulk queue');
  assert(compactPending.byteLen < 4 * 1024 * 1024, 'compact snapshot must remain below the bulk frame ceiling');
  assert.strictEqual(compactPending.byteLen, compactSize.bytes, 'size guard must match the actual encoded frame');
  const compactSnapshot = JSON.parse(compactPending.encoded);
  assert.strictEqual(compactSnapshot.messages.length, compactMessages.length, 'compact snapshot must preserve every message');
  assert.strictEqual(Object.hasOwn(compactSnapshot, 'history'), false, 'compact snapshot should omit only the redundant legacy array');
  assert(logs.some(entry => entry.message.includes('Sending compact history snapshot')));

  engine._flushPendingRelayBulk();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.strictEqual(sent.at(-1).session_id, compactSessionId, 'compact snapshot must flush after the socket drains');
  assert.strictEqual(sent.at(-1).messages.length, compactMessages.length);

  const starvedLargeSnapshot = {
    type: 'history_snapshot',
    session_id: 'session-starved',
    marker: 'aged-large-snapshot',
    payload: 'x'.repeat(800 * 1024),
  };
  bufferedAmount = 64 * 1024;
  engine._sendToRelay(starvedLargeSnapshot, { bulkKey: 'history_snapshot:session-starved' });
  const agedItem = engine._pendingRelayBulk.get('history_snapshot:session-starved');
  assert(agedItem, 'large snapshot should enter the bulk queue');
  agedItem.queuedAt -= 300;
  engine._flushPendingRelayBulk();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.strictEqual(sent.at(-1).marker, 'aged-large-snapshot',
    'an aged authoritative snapshot must not starve behind continuous small frames');
  assert.strictEqual(engine._pendingRelayBulk.size, 0);

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
  const result = {
    ok: true,
    sent_types: sent.map(message => message.type),
    coalesced_marker: sent[1].marker,
    large_snapshot_marker: sent[3].marker,
    compact_snapshot_messages: compactMessages.length,
    compatibility_snapshot_bytes: compatibilitySize.bytes,
    compact_snapshot_bytes: compactSize.bytes,
    aged_large_snapshot_flushed: true,
  };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const output = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
