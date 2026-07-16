'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-runtime-bounds-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

(async () => {
  try {
    const { ProxyEngine } = require('../agent-proxy/proxy-engine');
    const engine = new ProxyEngine({
      cdpPorts: [],
      relayUrl: 'ws://127.0.0.1:1/proxy-ws',
      uploadDir: path.join(tempRoot, 'uploads'),
    });
    engine.on('log', () => {});
    engine.relayReady = true;
    engine.relayWs = { readyState: 1, bufferedAmount: 64 * 1024 * 1024, send() {}, close() {} };

    const payload = 'x'.repeat(300 * 1024);
    for (let index = 0; index < 200; index += 1) {
      engine._queueRelayBulk(`history:${index}`, payload, { type: 'history_snapshot', session_id: `session-${index}` });
    }
    const bulkBytes = [...engine._pendingRelayBulk.values()].reduce((sum, item) => sum + item.byteLen, 0);
    assert(engine._pendingRelayBulk.size <= 128);
    assert(bulkBytes <= 32 * 1024 * 1024);

    engine.relayReady = false;
    for (let index = 0; index < 200; index += 1) {
      engine._sendToRelay({ type: 'history_snapshot', session_id: `pre-ready-${index}`, messages: [] });
    }
    assert(engine._pendingPreReadyHistory.size <= 64);

    for (let index = 0; index < 1000; index += 1) {
      engine._logDiscoverDeduped(`discover-${index}`, `message-${index}`);
      engine._shouldLogLargeHistorySkip(`session-${index}`, `reason-${index}`);
      engine._cooldownCdpTarget({ id: `target-${index}` }, 'fixture', 60_000);
      engine._codexCliHistoryChunkThrottle(`session-${index}`, { mode: 'tail' });
      engine._cursorCliHistoryChunkThrottle(`session-${index}`, { mode: 'tail' });
    }
    for (const map of [
      engine._discoverLogDedupe,
      engine._largeHistorySkipLogAt,
      engine._cdpTargetCooldownUntil,
      engine._codexCliHistoryChunkRequests,
      engine._cursorCliHistoryChunkRequests,
      engine._relayBulkDeferralLogAt,
    ]) assert(map.size <= 512, `runtime metadata map exceeded bound: ${map.size}`);

    for (let index = 0; index < 1000; index += 1) {
      engine._rememberCodexConfigReceipt(`session-${index}\u0001request-${index}`, { result: 'ok' });
    }
    assert.equal(engine._codexConfigReceipts.size, 512);

    engine.stop();
    assert.equal(engine._pendingRelayBulk.size, 0);
    assert.equal(engine._pendingPreReadyHistory.size, 0);
    assert.equal(engine._cdpTargetCooldownUntil.size, 0);
    assert.equal(engine._codexConfigQueues.size, 0);
    assert.equal(engine._codexConfigPending.size, 0);
    assert.equal(engine._codexConfigReceipts.size, 0);

    console.log(JSON.stringify({
      ok: true,
      deferred_bulk_entries: 128,
      deferred_bulk_max_bytes: 32 * 1024 * 1024,
      pre_ready_history_entries: 64,
      metadata_map_entries: 512,
      codex_config_receipt_entries: 512,
      stop_cleanup: true,
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
