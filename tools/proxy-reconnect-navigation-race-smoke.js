#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-reconnect-navigation-'));
process.env.SESSION_STORE_PATH = path.join(tempDir, 'session-store.json');

const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  try {
    const historyRead = deferred();
    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    const sessionId = 'reconnect-navigation-session';
    const relayed = [];
    engine.sessions.set(sessionId, {
      agentType: 'codex-desktop',
      client: { Runtime: {} },
      _accumulatedMessages: null,
    });
    engine._startHeartbeat = () => {};
    engine._sendSessionSnapshotNow = () => {};
    engine._flushPendingPreReadyHistory = () => {};
    engine._sendSessionMetaBackfill = () => {};
    engine._broadcastSessionSnapshot = () => {};
    engine._providerUsage.emit = () => {};
    engine._readSessionConfig = async () => ({});
    engine._readSessionMessages = () => historyRead.promise;
    engine._sendToRelay = message => {
      relayed.push(message);
      return true;
    };

    engine._handleRelayMessage({
      type: 'connection_ack',
      connection_id: 'reconnect-fixture',
      heartbeat_interval_ms: 10000,
    });
    engine._handleRelayMessage({
      type: 'switch_thread',
      session_id: sessionId,
      request_id: 'newer-navigation',
      thread_id: '',
    });
    historyRead.resolve(JSON.stringify([
      { role: 'user', content: 'stale reconnect transcript' },
    ]));
    await tick();

    assert(relayed.some(message => (
      message.type === 'agent_control_result'
      && message.request_id === 'newer-navigation'
      && message.result === 'failed'
    )), 'navigation did not receive a terminal result');
    assert(!relayed.some(message => (
      ['history', 'history_snapshot'].includes(message.type)
      && message.messages?.some(entry => entry.content === 'stale reconnect transcript')
    )), 'stale reconnect transcript overwrote a newer navigation epoch');

    console.log('PASS reconnect history is discarded after a newer navigation epoch');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
