#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-codex-live-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { CodexCliAppServerTurn } = require('../agent-proxy/codex-cli-app-server');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const sessionStore = require('../agent-proxy/session-store');

const repoRoot = path.resolve(__dirname, '..');

function waitFor(predicate, label, timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function createHarness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._codexCliAppServerTurnFactory = options => new CodexCliAppServerTurn(options);
  engine._findCodexCliSummaryByCliId = () => null;
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._publishCodexCliConfig = () => {};
  engine._broadcastSessionSnapshot = () => {};
  engine._processMessageQueue = async () => {};
  engine._log = (level, message) => engine.logs.push({ level, message });
  return engine;
}

async function archiveThread(threadId) {
  if (!threadId) return false;
  const connection = new CodexAppServerConnection({
    sessionId: `cleanup-${crypto.randomUUID()}`,
    cwd: repoRoot,
    clientName: 'remote-agent-chat-live-cleanup',
    clientVersion: '1.0.0',
    requestTimeoutMs: 30000,
  });
  try {
    await connection.start();
    await connection.request('thread/archive', { threadId }, 10000);
    return true;
  } finally {
    await connection.stop();
  }
}

(async () => {
  const engine = createHarness();
  const sessionId = `proxy-codex-live-${crypto.randomUUID()}`;
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    status: 'healthy',
    workspace_path: repoRoot,
    permission_mode: 'read-only',
    codexCliCollaborationMode: 'plan',
    activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
    messageQueue: [],
  };
  engine.sessions.set(sessionId, session);
  let nativeThreadId = null;
  let archived = false;
  try {
    const sendResult = await engine._sendCodexCliMessage(
      session,
      [
        'This is an owned disposable proxy integration test.',
        'Call request_user_input now and do not answer it yourself.',
        'Ask exactly one question with id route, header Route, and body Choose a route.',
        'Offer Relay (description: Answer through RAC.) and Native (description: Answer locally.).',
        'After the tool response, acknowledge it briefly and finish.',
      ].join(' '),
      sessionId,
      { clientMessageId: `client-${crypto.randomUUID()}` },
    );
    assert.strictEqual(sendResult.ok, true);
    assert.strictEqual(sendResult.native_receipt.transport, 'codex_app_server');
    nativeThreadId = sendResult.native_receipt.thread_id;
    const prompt = await waitFor(
      () => engine.sent.find(message => message.type === 'question_prompt'),
      'the real question_prompt relay frame',
    );
    assert.strictEqual(prompt.session_id, sessionId);
    assert.strictEqual(prompt.source.surface, 'codex_cli');
    assert.strictEqual(session.activity.kind, 'waiting_for_user');
    const relayChoice = prompt.questions[0].choices.find(choice => choice.label === 'Relay');
    assert.ok(relayChoice, 'real native prompt did not include Relay');
    engine._handleRelayMessage({
      type: 'question_response',
      request_id: `answer-${crypto.randomUUID()}`,
      session_id: sessionId,
      prompt_id: prompt.prompt_id,
      generation: prompt.generation,
      action: 'answer',
      answers: [{ question_id: 'route', choice_ids: [relayChoice.choice_id] }],
    });
    const receipt = await waitFor(
      () => engine.sent.find(message => message.command === 'question_response'),
      'the exact native question receipt',
    );
    assert.strictEqual(receipt.result, 'ok');
    assert.strictEqual(receipt.native_acknowledged, true);
    assert.strictEqual(receipt.native_receipt.method, 'serverRequest/resolved');
    await waitFor(() => session._codexAppServerTurn === null, 'owned turn completion');
    assert.strictEqual(session.waitingForAssistant, false);
    archived = await archiveThread(nativeThreadId);
    nativeThreadId = null;
    assert.strictEqual(archived, true);
    console.log(JSON.stringify({
      result: 'PASS',
      default_proxy_transport: sendResult.native_receipt.transport,
      real_request_user_input: true,
      relay_prompt_frames: engine.sent.filter(message => message.type === 'question_prompt').length,
      native_answer_forwards: 1,
      exact_native_acknowledgement: receipt.native_receipt.method,
      same_thread: receipt.native_receipt.thread_id === sendResult.native_receipt.thread_id,
      same_turn: receipt.native_receipt.turn_id === sendResult.native_receipt.turn_id,
      final_activity: session.activity.kind,
      archived_owned_thread: archived,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    if (nativeThreadId) {
      try { await archiveThread(nativeThreadId); } catch {}
    }
    if (session._codexAppServerTurn) {
      try { await session._codexAppServerTurn.stop(); } catch {}
    }
    sessionStore.flushPendingSaves();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
