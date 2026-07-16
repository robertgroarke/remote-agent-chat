#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-codex-app-server-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { canonicalQuestionPrompt } = require('../shared/question-prompt-contract');

class FakeTurn extends EventEmitter {
  constructor({ fail = false } = {}) {
    super();
    this.fail = fail;
    this.startCalls = [];
    this.answerCalls = [];
    this.stopCalls = 0;
  }

  async start(params) {
    this.startCalls.push(params);
    if (this.fail) {
      const error = new Error('Owned app-server start failed');
      error.code = 'owned_app_server_failed';
      throw error;
    }
    return {
      thread_id: 'native-thread',
      turn_id: 'native-turn',
      thread_path: path.join(tempRoot, 'rollout.jsonl'),
      native_receipt: {
        transport: 'codex_app_server',
        thread_id: 'native-thread',
        turn_id: 'native-turn',
        observed_at: new Date().toISOString(),
      },
    };
  }

  async answerQuestion(response) {
    this.answerCalls.push(response);
    return {
      ok: true,
      native_acknowledged: true,
      lifecycle: 'answered',
      native_receipt: { method: 'serverRequest/resolved' },
    };
  }

  async interrupt() { return { ok: true }; }
  async stop() { this.stopCalls += 1; }
}

function createHarness(fakeTurn) {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._codexCliAppServerTurnFactory = () => fakeTurn;
  engine._findCodexCliSummaryByCliId = () => null;
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._publishCodexCliConfig = () => {};
  engine._broadcastSessionSnapshot = () => {};
  engine._processMessageQueue = async () => {};
  engine._log = (level, message) => engine.logs.push({ level, message });
  return engine;
}

function prompt(sessionId) {
  return canonicalQuestionPrompt({
    prompt_id: 'prompt-owned',
    session_id: sessionId,
    generation: 'generation-owned',
    kind: 'request_user_input',
    source: { surface: 'codex_cli', version: 'test-version' },
    questions: [{
      id: 'choice', header: 'Choice', question: 'Choose one.',
      options: [
        { id: 'yes', label: 'Yes', description: 'Continue.' },
        { id: 'no', label: 'No', description: 'Stop.' },
      ],
    }],
  });
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const fakeTurn = new FakeTurn();
  const engine = createHarness(fakeTurn);
  const sessionId = 'codex-cli-session';
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    status: 'healthy',
    workspace_path: tempRoot,
    permission_mode: 'read-only',
    observedModelId: 'gpt-test',
    observedEffort: 'medium',
    activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
    messageQueue: [],
  };
  engine.sessions.set(sessionId, session);
  const result = await engine._sendCodexCliMessage(session, 'Ask a native question.', sessionId, {
    clientMessageId: 'client-message',
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.lifecycle_managed, true);
  assert.strictEqual(result.native_receipt.transport, 'codex_app_server');
  assert.strictEqual(session.cliSessionId, 'native-thread');
  assert.strictEqual(session._codexAppServerTurn, fakeTurn);
  assert.deepStrictEqual(fakeTurn.startCalls[0], {
    threadId: null,
    content: 'Ask a native question.',
    model: 'gpt-test',
    effort: 'medium',
    sandbox: 'read-only',
    clientMessageId: 'client-message',
    collaborationMode: null,
  });

  const opened = prompt(sessionId);
  fakeTurn.emit('question_prompt', opened);
  assert.strictEqual(engine.activeQuestionPromptAdapters.has(sessionId), true);
  assert.strictEqual(session.activity.kind, 'waiting_for_user');
  const relayedPrompt = engine.sent.find(message => message.type === 'question_prompt');
  assert.strictEqual(relayedPrompt.prompt_id, opened.prompt_id);
  engine._setCodexCliActivity(sessionId, session, {
    kind: 'idle', label: '', updated_at: new Date().toISOString(),
  });
  assert.strictEqual(session.activity.kind, 'waiting_for_user', 'stale JSONL idle must not hide an owned question');
  engine._handleRelayMessage({
    type: 'question_response',
    request_id: 'response-request',
    session_id: sessionId,
    prompt_id: opened.prompt_id,
    generation: opened.generation,
    action: 'answer',
    answers: [{
      question_id: 'choice',
      choice_ids: [opened.questions[0].choices[0].choice_id],
    }],
  });
  await settle();
  await settle();
  assert.strictEqual(fakeTurn.answerCalls.length, 1);
  const answerReceipt = engine.sent.find(message => message.command === 'question_response');
  assert.strictEqual(answerReceipt.result, 'ok');
  assert.strictEqual(answerReceipt.native_acknowledged, true);
  assert.strictEqual(session.activity.kind, 'generating');

  fakeTurn.emit('turn_completed', {
    thread_id: 'native-thread', turn_id: 'native-turn', status: 'completed',
  });
  await settle();
  await settle();
  assert.strictEqual(session._codexAppServerTurn, null);
  assert.strictEqual(session.waitingForAssistant, false);
  assert.strictEqual(fakeTurn.stopCalls, 1);

  const failedTurn = new FakeTurn({ fail: true });
  const failedEngine = createHarness(failedTurn);
  const failedSession = { ...session, session_id: 'failed-session', _codexAppServerTurn: null };
  failedEngine.sessions.set(failedSession.session_id, failedSession);
  const failed = await failedEngine._sendCodexCliMessage(
    failedSession, 'Do not fall back.', failedSession.session_id, { clientMessageId: 'failed-message' },
  );
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.code, 'owned_app_server_failed');
  assert.strictEqual(failedSession._codexAppServerTurn, null);
  assert.strictEqual(failedTurn.stopCalls, 1);

  console.log(JSON.stringify({
    result: 'PASS',
    app_server_default_transport: true,
    native_turn_receipt: true,
    question_relayed_once: true,
    response_forwarded_once: fakeTurn.answerCalls.length,
    native_ack_required: true,
    stale_idle_preserved_prompt: true,
    native_ack_resumed_activity: true,
    completion_released_owner: true,
    launch_failure_no_fallback: true,
    permission_path_untouched: engine.activePermissionPrompts.size === 0,
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
