#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-codex-app-server-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const nativeThreadId = '019f7444-1111-7111-8111-111111111111';
fs.writeFileSync(path.join(tempRoot, 'rollout.jsonl'), '{"type":"session_meta"}\n', 'utf8');
const {
  ProxyEngine,
  shouldFastPollCodexCliSession,
} = require('../agent-proxy/proxy-engine');
const { canonicalQuestionPrompt } = require('../shared/question-prompt-contract');
const { createReadyOwnerRegistry } = require('./codex-owner-test-fixture');
const { resolveLineageOwner } = require('../shared/codex-live-owner-registry');

class FakeTurn extends EventEmitter {
  constructor({ fail = false } = {}) {
    super();
    this.fail = fail;
    this.startCalls = [];
    this.answerCalls = [];
    this.stopCalls = 0;
    this.connection = { connectionGeneration: 'fixture-connection', child: { pid: process.pid } };
  }

  async start(params) {
    this.startCalls.push(params);
    if (this.fail) {
      const error = new Error('Owned app-server start failed');
      error.code = 'owned_app_server_failed';
      throw error;
    }
    this.threadId = nativeThreadId;
    this.turnId = 'native-turn';
    return {
      thread_id: nativeThreadId,
      turn_id: 'native-turn',
      thread_path: path.join(tempRoot, 'rollout.jsonl'),
      native_receipt: {
        transport: 'codex_app_server',
        thread_id: nativeThreadId,
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
  engine.broadcasts = 0;
  engine._codexCliAppServerTurnFactory = () => fakeTurn;
  engine._codexOwnerRegistryPath = createReadyOwnerRegistry(tempRoot);
  engine._findCodexCliSummaryByCliId = () => null;
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._publishCodexCliConfig = () => {};
  engine._broadcastSessionSnapshot = () => { engine.broadcasts += 1; };
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
  assert.strictEqual(shouldFastPollCodexCliSession({ agentType: 'codex_cli' }), false);
  assert.strictEqual(shouldFastPollCodexCliSession({ agentType: 'codex_cli', _codexAppServerTurn: {} }), true);
  assert.strictEqual(shouldFastPollCodexCliSession({ agentType: 'codex_cli', _codexCliChild: {} }), true);
  assert.strictEqual(shouldFastPollCodexCliSession({ agentType: 'codex', _codexAppServerTurn: {} }), false);
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
  assert.strictEqual(session.cliSessionId, nativeThreadId);
  assert.strictEqual(session._codexAppServerTurn, fakeTurn);
  assert.deepStrictEqual(session._codexAppServerLastTurnIdentity, {
    thread_id: nativeThreadId,
    turn_id: 'native-turn',
    process_epoch: result.process_epoch,
  });
  assert.deepStrictEqual(fakeTurn.startCalls[0], {
    threadId: null,
    content: 'Ask a native question.',
    model: 'gpt-test',
    effort: 'medium',
    sandbox: 'read-only',
    clientMessageId: 'client-message',
    collaborationMode: null,
  });
  const liveOwner = resolveLineageOwner(nativeThreadId, { registryPath: engine._codexOwnerRegistryPath });
  assert.strictEqual(liveOwner.state, 'confirmed');
  assert.strictEqual(liveOwner.owner.owner_kind, 'proxy_app_server');
  assert.strictEqual(liveOwner.owner.rac_session_id, sessionId);
  assert.strictEqual(liveOwner.owner.turn_id, 'native-turn');

  const opened = prompt(sessionId);
  fakeTurn.emit('question_prompt', opened);
  fakeTurn.emit('question_prompt', { ...opened, observed_at: new Date().toISOString() });
  assert.strictEqual(engine.activeQuestionPromptAdapters.has(sessionId), true);
  assert.strictEqual(session.activity.kind, 'waiting_for_user');
  const relayedPrompt = engine.sent.find(message => message.type === 'question_prompt');
  assert.strictEqual(relayedPrompt.prompt_id, opened.prompt_id);
  assert.strictEqual(engine.sent.filter(message => message.type === 'question_prompt').length, 1,
    'identical native question replay must not emit another relay open edge');
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

  assert.strictEqual(engine._observeCodexCliOwnedTurnCompletion(sessionId, session, {
    cliSessionId: nativeThreadId,
    taskCompletedTurnId: 'different-turn',
    taskCompletedAt: new Date().toISOString(),
  }), false, 'a different JSONL turn must not release the owned app-server turn');
  assert.strictEqual(session.activity.kind, 'generating');
  session._codexAppServerTurnIdentity = null;
  const idleStatusCount = () => engine.sent.filter(message =>
    message.type === 'proxy_status' && message.activity?.kind === 'idle').length;
  const liveTerminalStatuses = idleStatusCount();
  assert.strictEqual(engine._observeCodexCliOwnedTurnCompletion(sessionId, session, {
    cliSessionId: nativeThreadId,
    taskCompletedTurnId: 'native-turn',
    taskCompletedAt: new Date().toISOString(),
  }), true, 'the exact terminal JSONL turn must release via live turn-object identity');
  assert.strictEqual(idleStatusCount(), liveTerminalStatuses + 1,
    'exact terminal JSONL must publish idle status before asynchronous turn cleanup');
  await settle();
  await settle();
  assert.strictEqual(session._codexAppServerTurn, null);
  assert.strictEqual(session.waitingForAssistant, false);
  assert.strictEqual(session.activity.kind, 'idle');
  const terminalWatermark = session._codexAppServerTerminalCompletedAtMs;
  assert(Number.isFinite(terminalWatermark) && terminalWatermark > 0,
    'exact owned completion must retain a terminal activity watermark');
  assert.strictEqual(engine._setCodexCliActivity(sessionId, session, {
    kind: 'thinking',
    label: 'Stale reasoning',
    updated_at: new Date(terminalWatermark - 1).toISOString(),
  }), false, 'pre-terminal reasoning must not overwrite authoritative idle');
  assert.strictEqual(session.activity.kind, 'idle');
  assert.strictEqual(fakeTurn.stopCalls, 1);
  assert.strictEqual(resolveLineageOwner(nativeThreadId, {
    registryPath: engine._codexOwnerRegistryPath,
  }).state, 'none');

  session.activity = { kind: 'generating', label: 'stale', updated_at: new Date().toISOString() };
  session._codexCliPendingReceipt = null;
  assert.strictEqual(engine._observeCodexCliOwnedTurnCompletion(sessionId, session, {
    cliSessionId: nativeThreadId,
    taskCompletedTurnId: 'native-turn',
    taskCompletedAt: new Date().toISOString(),
  }), true, 'the retained exact turn identity must reconcile terminal activity after live ownership detaches');
  assert.strictEqual(session.activity.kind, 'idle');

  const reconciledStatuses = idleStatusCount();
  assert.strictEqual(engine._observeCodexCliOwnedTurnCompletion(sessionId, session, {
    cliSessionId: nativeThreadId,
    taskCompletedTurnId: 'native-turn',
    taskCompletedAt: new Date().toISOString(),
  }), true, 'an already reconciled exact terminal remains acknowledged');
  assert.strictEqual(idleStatusCount(), reconciledStatuses,
    'an already published idle terminal must not emit repeated status');

  session._codexAppServerTerminalReconciledTurnId = null;
  const detachedNoopStatuses = idleStatusCount();
  assert.strictEqual(engine._observeCodexCliOwnedTurnCompletion(sessionId, session, {
    cliSessionId: nativeThreadId,
    taskCompletedTurnId: 'native-turn',
    taskCompletedAt: new Date().toISOString(),
  }), true, 'a detached exact terminal must reconcile even when activity is already idle');
  assert.strictEqual(idleStatusCount(), detachedNoopStatuses + 1,
    'a first detached terminal must publish status when the idle update is a semantic no-op');

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
    owned_turn_fast_poll_lane: true,
    native_turn_receipt: true,
    canonical_owner_published_and_cleared: true,
    question_relayed_once: true,
    response_forwarded_once: fakeTurn.answerCalls.length,
    native_ack_required: true,
    stale_idle_preserved_prompt: true,
    native_ack_resumed_activity: true,
    mismatched_jsonl_terminal_rejected: true,
    exact_jsonl_terminal_released_owner: true,
    live_turn_identity_fallback: true,
    detached_turn_receipt_reconciled: true,
    last_turn_identity_retained: true,
    terminal_status_before_cleanup: true,
    detached_noop_terminal_status: true,
    terminal_status_deduplicated: true,
    stale_post_terminal_activity_rejected: true,
    terminal_activity_idle: true,
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
