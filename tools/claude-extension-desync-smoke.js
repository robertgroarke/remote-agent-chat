#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-claude-desync-'));
process.env.SESSION_STORE_PATH = path.join(tempDir, 'session-store.json');

const selectors = require('../agent-proxy/selectors');
const sessionStore = require('../agent-proxy/session-store');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fakeClaudeRuntime(mode) {
  const calls = [];
  let receiptReads = 0;
  const Runtime = {
    _innerContextId: 7,
    async evaluate(options) {
      calls.push(options);
      const expression = options.expression || '';
      let value = null;
      if (expression.includes("state: 'human-composer-active'")) {
        if (mode === 'human') value = JSON.stringify({ state: 'human-composer-active', characters: 11 });
        else if (mode === 'draft') value = JSON.stringify({ state: 'composer-not-empty', characters: 9 });
        else value = JSON.stringify({ state: 'ready', baseline: 0 });
      } else if (expression.includes("return 'sent'")) {
        value = 'sent';
      } else if (expression.includes('return count;')) {
        receiptReads += 1;
        value = mode === 'receipt' && receiptReads >= 2 ? 1 : 0;
      }
      return { result: { value } };
    },
  };
  return { Runtime, calls, get receiptReads() { return receiptReads; } };
}

async function testComposerOwnershipAndReceipt() {
  const selectorSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'selectors.js'), 'utf8');
  const sendStart = selectorSource.indexOf('async function sendClaudeWithSelectors');
  const sendEnd = selectorSource.indexOf('async function sendClaudePrimary', sendStart);
  const sendSource = selectorSource.slice(sendStart, sendEnd);
  assert(sendStart >= 0 && sendEnd > sendStart, 'Claude send implementation was not found');
  assert(!sendSource.includes('.focus('), 'Claude send path can move native focus');
  assert(!sendSource.includes('execCommand'), 'Claude send path can mutate the active editor selection');

  const human = fakeClaudeRuntime('human');
  const humanResult = await selectors.sendClaudePrimary(human.Runtime, 'Remote turn', 'claude-session');
  assert.strictEqual(humanResult.ok, false);
  assert.strictEqual(humanResult.code, 'human_composer_active');
  assert.strictEqual(human.calls.length, 1, 'human-owned composer reached a mutating send step');

  const draft = fakeClaudeRuntime('draft');
  const draftResult = await selectors.sendClaudePrimary(draft.Runtime, 'Remote turn', 'claude-session');
  assert.strictEqual(draftResult.ok, false);
  assert.strictEqual(draftResult.code, 'composer_not_empty');
  assert.strictEqual(draft.calls.length, 1, 'non-empty draft reached a mutating send step');

  const receipt = fakeClaudeRuntime('receipt');
  const startedAt = Date.now();
  const delivered = await selectors.sendClaudePrimary(receipt.Runtime, 'Remote turn', 'claude-session');
  assert.strictEqual(delivered.ok, true);
  assert.strictEqual(delivered.delivery_lifecycle, 'native_user_turn_observed');
  assert.strictEqual(delivered.native_receipt.transport, 'claude_extension_dom');
  assert.strictEqual(delivered.native_receipt.session_id, 'claude-session');
  assert(delivered.native_receipt.latency_ms < 2000, 'native receipt exceeded two-second budget');
  assert(Date.now() - startedAt < 2000, 'selector returned after two-second budget');
  assert(receipt.receiptReads >= 2, 'selector acknowledged before observing a new native occurrence');
  for (const call of receipt.calls) {
    assert.strictEqual(call.contextId, 7, 'persistent inner execution context was not used');
    assert.strictEqual(call.silent, true);
    assert.strictEqual(call.userGesture, false);
  }
}

async function testPersistentPoll() {
  const names = [
    'readMessages',
    'detectThinking',
    'readClaudeSessionTitle',
    'detectPermissionDialog',
    'detectSessionErrorPrompt',
    'readAgentConfig',
    'readClaudeRateLimit',
  ];
  const originals = Object.fromEntries(names.map(name => [name, selectors[name]]));
  const calls = [];
  const Runtime = { marker: 'persistent-runtime' };
  try {
    selectors.readMessages = async runtime => { calls.push(['messages', runtime]); return JSON.stringify([]); };
    selectors.detectThinking = async runtime => { calls.push(['thinking', runtime]); return { thinking: false }; };
    selectors.readClaudeSessionTitle = async runtime => { calls.push(['title', runtime]); return 'Persistent'; };
    selectors.detectPermissionDialog = async runtime => { calls.push(['permission', runtime]); return null; };
    selectors.detectSessionErrorPrompt = async runtime => { calls.push(['error', runtime]); return null; };
    selectors.readAgentConfig = async runtime => { calls.push(['config', runtime]); return { model_id: 'claude' }; };
    selectors.readClaudeRateLimit = async runtime => { calls.push(['rate', runtime]); return { rate_limited: false }; };

    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    const result = await engine._persistentClaudePoll({
      client: { Runtime },
      _webviewId: 'claude-webview',
      workspace_path: tempDir,
      lastObservedCount: 0,
    }, 'claude-session', { includeConfig: true, includeRateLimit: true });
    assert.strictEqual(result.sessionTitle, 'Persistent');
    assert.deepStrictEqual(calls.map(call => call[0]), [
      'messages', 'thinking', 'title', 'permission', 'error', 'config', 'rate',
    ]);
    assert(calls.every(call => call[1] === Runtime), 'poll replaced the persistent Runtime');
    assert(!engine._persistentClaudePoll.toString().includes('_ephemeralCdpPoll'));
    assert(!engine._persistentClaudePoll.toString().includes('CDP('));
  } finally {
    for (const [name, value] of Object.entries(originals)) selectors[name] = value;
  }
}

async function testOrderedQueueAndClaudeNoSteer() {
  const priorUpdate = sessionStore.updateSession;
  const priorThinking = selectors.detectThinking;
  const priorSteer = selectors.steerCodexInput;
  sessionStore.updateSession = () => {};
  selectors.detectThinking = async () => ({ thinking: true, label: 'Working' });
  let steerCalls = 0;
  selectors.steerCodexInput = async () => { steerCalls += 1; return { ok: true }; };
  try {
    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    engine._sendToRelay = () => true;
    const busySession = {
      agentType: 'claude',
      client: { Runtime: {} },
      activity: { kind: 'thinking', label: 'Working' },
      messageQueue: [],
      status: 'healthy',
    };
    engine.sessions.set('busy-claude', busySession);
    await engine._handleSendRequest({
      session: 'busy-claude',
      content: 'queued while busy',
      client_message_id: 'busy-1',
    });
    assert.deepStrictEqual(busySession.messageQueue.map(item => item.client_message_id), ['busy-1']);
    assert.strictEqual(steerCalls, 0, 'Claude queue touched Codex ProseMirror steering');

    const drainGate = deferred();
    const queuedSession = {
      agentType: 'claude',
      client: { Runtime: {} },
      activity: { kind: 'idle', label: '' },
      messageQueue: [
        { content: 'one', client_message_id: 'q1' },
        { content: 'two', client_message_id: 'q2' },
      ],
      status: 'healthy',
    };
    engine.sessions.set('queued-claude', queuedSession);
    const sends = [];
    engine._sendSessionMessage = async (_session, content) => {
      sends.push(content);
      await drainGate.promise;
      return { ok: false, code: 'human_composer_active', detail: 'human typing' };
    };
    const firstDrain = engine._processMessageQueue('queued-claude');
    const overlappingDrain = engine._processMessageQueue('queued-claude');
    assert.deepStrictEqual(sends, ['one'], 'overlapping drain duplicated or reordered a queued turn');
    drainGate.resolve();
    await Promise.all([firstDrain, overlappingDrain]);
    assert.deepStrictEqual(queuedSession.messageQueue.map(item => item.client_message_id), ['q1', 'q2']);
  } finally {
    sessionStore.updateSession = priorUpdate;
    selectors.detectThinking = priorThinking;
    selectors.steerCodexInput = priorSteer;
  }
}

async function testImmediateNativeUserTranscript() {
  const priorUpdate = sessionStore.updateSession;
  sessionStore.updateSession = () => {};
  try {
    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    const observed = [];
    engine._sendProxyMessage = (_sessionId, message) => observed.push(message);
    engine._sendToRelay = () => true;
    engine._handlePermissionDialogState = async () => {};
    engine._handleSessionErrorPromptState = async () => {};
    engine._persistentClaudePoll = async () => ({
      raw: JSON.stringify([{ role: 'user', content: 'native receipt' }]),
      thinking: { thinking: false, label: '' },
      sessionTitle: null,
      perm: null,
      errorPrompt: null,
      config: null,
      rateLimit: null,
    });
    const session = {
      agentType: 'claude',
      client: { Runtime: {} },
      lastMessageCount: 0,
      lastObservedCount: 0,
      lastTranscriptSig: null,
      pendingLast: null,
      waitingForAssistant: false,
      thinking: false,
      thinkingLabel: '',
      thinkingContent: '',
      nullPollCount: 0,
      activity: { kind: 'idle', label: '' },
      messageQueue: [],
      status: 'healthy',
    };
    engine.sessions.set('poll-claude', session);
    await engine._pollSessionClaude('poll-claude', session);
    assert.deepStrictEqual(observed, [{ role: 'user', content: 'native receipt' }]);
    assert.strictEqual(session.lastMessageCount, 1);
    assert.strictEqual(session.pendingLast, null);
    assert.strictEqual(session.waitingForAssistant, true);
  } finally {
    sessionStore.updateSession = priorUpdate;
  }
}

async function main() {
  await testComposerOwnershipAndReceipt();
  await testPersistentPoll();
  await testOrderedQueueAndClaudeNoSteer();
  await testImmediateNativeUserTranscript();
  console.log('claude-extension-desync-smoke: PASS');
  console.log(JSON.stringify({
    persistent_runtime: true,
    composer_guard: true,
    native_receipt_budget_ms: 2000,
    ordered_queue: true,
    codex_steer_calls_for_claude: 0,
    immediate_user_transcript: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
