#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-switch-state-'));
process.env.SESSION_STORE_PATH = path.join(tempDir, 'session-store.json');

const selectors = require('../agent-proxy/selectors');
const sessionStore = require('../agent-proxy/session-store');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for Codex Desktop switch result');
}

async function main() {
  const priorSwitch = selectors.switchCodexThread;
  const priorRead = selectors.readMessages;
  const priorUpdateSession = sessionStore.updateSession;
  try {
    const targetThread = 'local:client-new-thread:owned-switch-fixture';
    const freshMessages = [
      {
        role: 'user',
        content: `owned switch anchor alpha ${'a'.repeat(90)}`,
      },
      {
        role: 'assistant',
        content: 'first fixture reply',
      },
      {
        role: 'user',
        content: `owned switch anchor beta ${'b'.repeat(90)}`,
      },
    ];
    selectors.switchCodexThread = async (_Runtime, threadId, waitForContent) => {
      assert.strictEqual(threadId, targetThread);
      assert.strictEqual(waitForContent, true);
      return { ok: true };
    };
    selectors.readMessages = async () => JSON.stringify(freshMessages);

    const engine = new ProxyEngine({
      cdpPorts: [],
      relayUrl: 'ws://127.0.0.1:1/proxy-ws',
    });
    const sessionId = 'codex-desktop-switch-state-smoke';
    const session = {
      agentType: 'codex-desktop',
      client: { Runtime: {} },
      _activeThreadKey: 'local:previous-thread',
      codexDesktopActiveThreadKey: 'local:previous-thread',
      _accumulatedMessages: [{ role: 'user', content: 'stale transcript' }],
      _codexDesktopArchivePath: 'C:\\stale\\archive.jsonl',
      _codexDesktopArchiveCliSessionId: 'stale-archive',
    };
    const relayed = [];
    const persistedUpdates = [];
    sessionStore.updateSession = (id, updates) => {
      persistedUpdates.push({ id, updates: JSON.parse(JSON.stringify(updates)) });
    };
    engine._sendToRelay = message => {
      relayed.push(message);
      return true;
    };
    engine.sessions.set(sessionId, session);

    engine._handleRelayMessage({
      type: 'switch_thread',
      session_id: sessionId,
      request_id: 'switch-state-fixture',
      thread_id: targetThread,
    });
    await waitFor(() => relayed.find(message =>
      message.type === 'agent_control_result'
      && message.request_id === 'switch-state-fixture'));

    assert.strictEqual(session._activeThreadKey, targetThread);
    assert.strictEqual(session.codexDesktopActiveThreadKey, targetThread);
    assert.deepStrictEqual(session._accumulatedMessages, freshMessages);
    assert.notStrictEqual(session._accumulatedMessages, freshMessages,
      'selected transcript accumulator retained the caller-owned array');
    assert.strictEqual(session._codexDesktopArchivePath, null);
    assert.strictEqual(session._codexDesktopArchiveCliSessionId, null);
    assert(relayed.some(message =>
      ['history', 'history_snapshot'].includes(message.type)
      && Array.isArray(message.messages)
      && message.messages.length === freshMessages.length));

    const persisted = persistedUpdates.find(update =>
      update.id === sessionId
      && update.updates.codex_desktop_active_thread_key === targetThread);
    assert(persisted, 'selected transcript state was not sent to the durable session store');
    assert.deepStrictEqual(
      persisted.updates.accumulated_messages,
      freshMessages,
      'fresh selected transcript was not persisted for immediate receipt baselines',
    );
    assert.strictEqual(
      persisted.updates.codex_desktop_active_thread_key,
      targetThread,
    );
    console.log('PASS Codex Desktop switch retains the exact fresh transcript for immediate send receipts');
  } finally {
    selectors.switchCodexThread = priorSwitch;
    selectors.readMessages = priorRead;
    sessionStore.updateSession = priorUpdateSession;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
