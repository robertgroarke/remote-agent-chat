#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-navigation-race-'));
process.env.SESSION_STORE_PATH = path.join(tempDir, 'session-store.json');

const selectors = require('../agent-proxy/selectors');
const sessionStore = require('../agent-proxy/session-store');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

async function main() {
  const priorSwitch = selectors.switchCodexThread;
  const priorRead = selectors.readMessages;
  const priorUpdate = sessionStore.updateSession;
  try {
    const gates = new Map([
      ['thread-a', deferred()],
      ['thread-b', deferred()],
      ['thread-c', deferred()],
    ]);
    const starts = [];
    let nativeThread = 'thread-original';
    selectors.switchCodexThread = async (_Runtime, threadId) => {
      starts.push(threadId);
      await gates.get(threadId).promise;
      nativeThread = threadId;
      return { ok: true };
    };
    selectors.readMessages = async () => JSON.stringify([
      { role: 'user', content: `transcript-${nativeThread}` },
    ]);
    sessionStore.updateSession = () => {};

    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    const sessionId = 'navigation-race-session';
    const session = {
      agentType: 'codex-desktop',
      client: { Runtime: {} },
      _activeThreadKey: 'thread-original',
      _accumulatedMessages: [],
    };
    const relayed = [];
    engine.sessions.set(sessionId, session);
    engine._sendToRelay = message => {
      relayed.push(engine._stampNavigationMessage(message));
      return true;
    };

    const navigate = (requestId, threadId) => engine._handleRelayMessage({
      type: 'switch_thread',
      session_id: sessionId,
      request_id: requestId,
      thread_id: threadId,
      navigation_epoch: Number(threadId.slice(-1).charCodeAt(0)),
    });

    const first = navigate('request-a', 'thread-a');
    const skipped = navigate('request-b', 'thread-b');
    const latest = navigate('request-c', 'thread-c');

    assert.deepStrictEqual(starts, ['thread-a'], 'same-session native switches overlapped');
    await waitFor(
      () => relayed.find(message => message.request_id === 'request-b'),
      'superseded navigation did not receive a terminal control result',
    );
    const skippedControl = relayed.find(message => message.request_id === 'request-b');
    assert.strictEqual(skippedControl.result, 'failed');
    assert.strictEqual(skippedControl.error?.code, 'operation_superseded');
    assert.strictEqual(skippedControl.navigation_epoch, 'b'.charCodeAt(0));

    gates.get('thread-a').resolve();
    await waitFor(() => starts.includes('thread-c'), 'latest navigation did not start after active navigation');
    assert(!starts.includes('thread-b'), 'intermediate navigation reached the native surface');
    gates.get('thread-c').resolve();

    await Promise.all([first, skipped, latest]);
    await waitFor(
      () => relayed.find(message => message.request_id === 'request-c' && message.result === 'ok'),
      'latest navigation did not complete',
    );
    assert.strictEqual(nativeThread, 'thread-c');
    assert.strictEqual(session._activeThreadKey, 'thread-c');
    assert.strictEqual(session.codexDesktopActiveThreadKey, 'thread-c');
    assert.deepStrictEqual(session._accumulatedMessages, [
      { role: 'user', content: 'transcript-thread-c' },
    ]);
    assert.strictEqual(engine._navigationOperations.size, 0, 'navigation queue retained completed session state');

    const firstControl = relayed.find(message => message.request_id === 'request-a');
    const latestControl = relayed.find(message => message.request_id === 'request-c' && message.result === 'ok');
    assert.strictEqual(firstControl.navigation_epoch, 'a'.charCodeAt(0));
    assert.strictEqual(latestControl.navigation_epoch, 'c'.charCodeAt(0));

    const snapshots = relayed.filter(message => (
      ['history', 'history_snapshot'].includes(message.type)
      && Array.isArray(message.messages)
    ));
    assert.strictEqual(snapshots[0].navigation_epoch, 'a'.charCodeAt(0));
    const finalSnapshot = snapshots.at(-1);
    assert.strictEqual(finalSnapshot.messages[0].content, 'transcript-thread-c');
    assert.strictEqual(finalSnapshot.navigation_epoch, 'c'.charCodeAt(0));

    console.log('PASS proxy navigation is latest-wins, epoch-correlated, ordered, and bounded');
  } finally {
    selectors.switchCodexThread = priorSwitch;
    selectors.readMessages = priorRead;
    sessionStore.updateSession = priorUpdate;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
