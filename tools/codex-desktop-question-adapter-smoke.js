#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-desktop-question-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const selectors = require('../agent-proxy/selectors');
const {
  ProxyEngine,
  detectCodexDesktopInstalledVersion,
} = require('../agent-proxy/proxy-engine');
const { selectPlanMode } = require('./codex-desktop-question-owned-probe');

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'codex-desktop',
  '26.707.9981.0',
  'request-user-input-dom.json',
), 'utf8'));

function harness(sessionId = 'desktop-question-session') {
  const engine = Object.create(ProxyEngine.prototype);
  engine.PROXY_ID = 'proxy-fixture';
  engine.CODEX_DESKTOP_SURFACE_VERSION = fixture.version;
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.activeErrorPrompts = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._log = (level, message) => engine.logs.push({ level, message });
  engine.freshQuestionClients = [];
  const session = {
    session_id: sessionId,
    agentType: 'codex-desktop',
    status: 'healthy',
    client: { Runtime: { _codexDesktopSharedClient: true } },
    targetId: `target-${sessionId}`,
    _cdpPort: 9225,
    _cdpHost: '::1',
    _activeThreadKey: fixture.expected_observed.native_thread_id,
    codexDesktopActiveThreadKey: fixture.expected_observed.native_thread_id,
    activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
    pendingLast: null,
    waitingForAssistant: false,
  };
  engine._connectCdpTarget = async (target, port) => {
    assert.strictEqual(target.id, session.targetId);
    assert.strictEqual(target._cdpHost, session._cdpHost);
    assert.strictEqual(port, session._cdpPort);
    const Runtime = {
      _codexDesktopFreshQuestionClient: true,
      enable: async () => {},
    };
    const client = {
      Runtime,
      closed: false,
      close: async () => { client.closed = true; },
    };
    engine.freshQuestionClients.push(client);
    return client;
  };
  engine.sessions.set(sessionId, session);
  return { engine, session };
}

function response(prompt, requestId, choiceIndex = 1) {
  return {
    type: 'question_response',
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{
      question_id: prompt.questions[0].question_id,
      choice_ids: [prompt.questions[0].choices[choiceIndex].choice_id],
    }],
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  assert.strictEqual(fixture.card.class_marker, 'request-card');
  assert.strictEqual(fixture.card.submit_button, null);
  assert.strictEqual(fixture.card.acknowledgement, 'request_card_disappeared');
  assert.deepStrictEqual(
    fixture.card.controls.filter(control => control.role === 'radio').map(control => control.aria_checked),
    [true, false],
  );
  assert.strictEqual(detectCodexDesktopInstalledVersion({ override: fixture.version }), fixture.version);

  const originalRespond = selectors.respondToCodexDesktopQuestion;
  const originalThinking = selectors.detectThinking;
  const originalDetect = selectors.detectCodexDesktopQuestion;
  const originalReadThreadList = selectors.readCodexThreadList;
  const originalEvalInPage = selectors.evalInPage;
  const priorLockHeld = process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
  process.env.CODEX_DESKTOP_CDP_LOCK_HELD = '1';
  let nativeCalls = 0;
  try {
    selectors.respondToCodexDesktopQuestion = async (Runtime, normalized, expected) => {
      nativeCalls += 1;
      assert.strictEqual(Runtime._codexDesktopFreshQuestionClient, true);
      assert.strictEqual(Runtime._codexDesktopSharedClient, undefined);
      assert.strictEqual(expected.native_thread_id, fixture.expected_observed.native_thread_id);
      assert.strictEqual(expected.native_signature, fixture.expected_observed.native_signature);
      assert.strictEqual(normalized.answers[0].choice_ids[0], expected.prompt.questions[0].choices[1].choice_id);
      return {
        ok: true,
        native_attempted: true,
        native_acknowledged: true,
        lifecycle: 'answered',
        native_receipt: {
          surface: 'codex-desktop',
          thread_unchanged: true,
          request_card_disappeared: true,
        },
      };
    };
    selectors.detectThinking = async Runtime => {
      assert.strictEqual(Runtime._codexDesktopFreshQuestionClient, true);
      return { thinking: true, label: 'Generating' };
    };

    let planInputCalls = 0;
    selectors.evalInPage = async () => ({
      plan: true,
      labels: ['Plan'],
      placeholder: '',
      composer_text_length: 0,
      document_focused: false,
      visibility: 'hidden',
    });
    const alreadyPlan = await selectPlanMode({
      Input: {
        insertText: async () => { planInputCalls += 1; },
        dispatchKeyEvent: async () => { planInputCalls += 1; },
      },
    }, {});
    assert.strictEqual(alreadyPlan.already, true);
    assert.strictEqual(planInputCalls, 0, 'already-active Plan mode performed native input');
    selectors.evalInPage = originalEvalInPage;

    const fast = harness('desktop-fast-question-session');
    fast.engine.CODEX_DESKTOP_QUESTION_POLL_TIMEOUT_MS = 50;
    selectors.detectCodexDesktopQuestion = async Runtime => {
      assert.strictEqual(Runtime._codexDesktopFreshQuestionClient, true);
      assert.strictEqual(Runtime._codexDesktopSharedClient, undefined);
      return {
        ...fixture.expected_observed,
        native_thread_title: 'Owned rotated thread',
        active_thread_proven: true,
      };
    };
    await fast.engine._pollCodexDesktopQuestionBounded(fast.session.session_id);
    assert(fast.engine.sent.some(message => message.type === 'question_prompt'), 'Desktop fast poll did not relay the native question');
    assert.strictEqual(fast.engine.freshQuestionClients.length, 1);
    assert.strictEqual(fast.engine.freshQuestionClients[0].closed, true);

    const rotated = harness('desktop-fast-thread-rotation');
    rotated.engine.CODEX_DESKTOP_QUESTION_POLL_TIMEOUT_MS = 50;
    rotated.session._activeThreadKey = 'local:previous-thread';
    rotated.session.codexDesktopActiveThreadKey = 'local:previous-thread';
    rotated.engine._refreshCodexDesktopThreadMetadata = () => {
      throw new Error('question identity promotion must not block on archive metadata');
    };
    selectors.readCodexThreadList = async () => {
      throw new Error('question fast path must not wait for the lagging full thread list');
    };
    await rotated.engine._pollCodexDesktopQuestionBounded(rotated.session.session_id);
    assert(rotated.engine.sent.some(message => message.type === 'question_prompt'),
      'Desktop fast poll did not relay after fresh active-thread validation');
    assert.strictEqual(rotated.session._activeThreadKey, fixture.expected_observed.native_thread_id,
      'Desktop fast poll did not promote the freshly validated active thread');
    assert.strictEqual(rotated.session._activeThreadTitle, 'Owned rotated thread');

    const recurring = harness('desktop-post-send-recurring-poll');
    recurring.engine.CODEX_DESKTOP_QUESTION_POLL_TIMEOUT_MS = 50;
    recurring.engine.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS = 17;
    recurring.session._codexDesktopQuestionRemotePollUntil = Date.now() + 5000;
    const scheduled = [];
    recurring.engine._scheduleCodexDesktopQuestionPoll = (sessionId, session, delay) => {
      assert.strictEqual(sessionId, recurring.session.session_id);
      assert.strictEqual(session, recurring.session);
      scheduled.push(delay);
    };
    selectors.detectCodexDesktopQuestion = async () => null;
    await recurring.engine._pollCodexDesktopQuestionBounded(recurring.session.session_id);
    assert(scheduled.includes(17), 'Desktop post-send window did not schedule a recurring fast question poll');
    selectors.detectCodexDesktopQuestion = async Runtime => {
      assert.strictEqual(Runtime._codexDesktopFreshQuestionClient, true);
      return {
        ...fixture.expected_observed,
        native_thread_title: 'Owned rotated thread',
        active_thread_proven: true,
      };
    };

    const order = [];
    fast.engine.activeQuestionPromptAdapters.clear();
    fast.engine._running = true;
    fast.engine._domPush = { notePoll() {} };
    fast.engine._pollCodexDesktopQuestionBounded = async () => { order.push('question'); };
    fast.engine._pollSessionBounded = async () => { order.push('transcript'); };
    fast.engine._pollPermissionsBounded = async () => { order.push('permission'); };
    await fast.engine._handleDomPush(fast.session.session_id, {});
    assert.deepStrictEqual(order, ['question'], 'DOM push held the native-question lane behind secondary reads');
    assert.strictEqual(fast.engine._domPushSecondaryPollTimers.has(fast.session.session_id), true);
    fast.engine._cancelDomPushSecondaryPoll(fast.session.session_id);
    await fast.engine._runDomPushSecondaryPoll(fast.session.session_id);
    assert.deepStrictEqual(order, ['question', 'transcript', 'permission']);

    const gated = harness('desktop-open-question-session');
    const gatedOrder = [];
    gated.engine._running = true;
    gated.engine._domPush = { notePoll() {} };
    gated.engine._pollCodexDesktopQuestionBounded = async () => {
      gatedOrder.push('question');
      gated.engine.activeQuestionPromptAdapters.set(gated.session.session_id, {
        adapter_surface: 'codex-desktop',
        claimed: true,
      });
    };
    gated.engine._pollSessionBounded = async () => { gatedOrder.push('transcript'); };
    gated.engine._pollPermissionsBounded = async () => { gatedOrder.push('permission'); };
    await gated.engine._handleDomPush(gated.session.session_id, {});
    assert.deepStrictEqual(gatedOrder, ['question']);
    assert.strictEqual(gated.engine._domPushSecondaryPollTimers?.has(gated.session.session_id) || false, false,
      'open native question retained a secondary transcript timer');

    const { engine, session } = harness();
    await engine._handleCodexDesktopQuestionState(
      session.session_id,
      session,
      fixture.expected_observed,
    );
    const prompt = engine.sent.find(message => message.type === 'question_prompt');
    assert(prompt, 'Desktop question was not relayed');
    assert.strictEqual(prompt.source.surface, 'codex-desktop');
    assert.strictEqual(prompt.source.version, fixture.version);
    assert.strictEqual(prompt.questions[0].choices[0].selected, true);
    assert.strictEqual(prompt.questions[0].choices[1].selected, false);
    assert.strictEqual(prompt.questions[0].choices[2].is_other, true);
    assert.strictEqual(prompt.cancel_supported, true);
    assert.strictEqual(prompt.auto_resolution_ms, null);
    assert.strictEqual(prompt.deadline_at, null);
    assert.strictEqual(session.activity.kind, 'waiting_for_user');
    assert.strictEqual(engine.activePermissionPrompts.size, 0);

    engine._handleRelayMessage(response(prompt, 'desktop-response'));
    await settle();
    await settle();
    assert.strictEqual(nativeCalls, 1);
    const receipt = engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'desktop-response');
    assert.strictEqual(receipt.result, 'ok');
    assert.strictEqual(receipt.native_acknowledged, true);
    assert.strictEqual(receipt.native_receipt.request_card_disappeared, true);
    assert.strictEqual(session.activity.kind, 'thinking');
    assert.strictEqual(engine.activeQuestionPromptAdapters.has(session.session_id), false);

    engine._handleRelayMessage(response(prompt, 'desktop-duplicate'));
    assert.strictEqual(nativeCalls, 1, 'duplicate response reached the native adapter');
    const duplicate = engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'desktop-duplicate');
    assert.strictEqual(duplicate.result, 'failed');
    assert.strictEqual(duplicate.error.code, 'question_prompt_not_owned');

    const stale = harness('desktop-stale-session');
    stale.session._activeThreadKey = 'local:another-thread';
    await stale.engine._handleCodexDesktopQuestionState(
      stale.session.session_id,
      stale.session,
      fixture.expected_observed,
    );
    assert.strictEqual(stale.engine.sent.some(message => message.type === 'question_prompt'), false);

    const invalid = harness('desktop-invalid-session');
    await invalid.engine._handleCodexDesktopQuestionState(
      invalid.session.session_id,
      invalid.session,
      fixture.expected_observed,
    );
    const invalidPrompt = invalid.engine.sent.find(message => message.type === 'question_prompt');
    const bad = response(invalidPrompt, 'desktop-invalid');
    bad.answers[0].choice_ids = ['not-open'];
    invalid.engine._handleRelayMessage(bad);
    await settle();
    await settle();
    const rejected = invalid.engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'desktop-invalid');
    assert.strictEqual(rejected.result, 'failed');
    assert.strictEqual(rejected.native_attempted, false);
    assert.strictEqual(invalid.engine.activeQuestionPromptAdapters.get(invalid.session.session_id).claimed, false);

    assert.strictEqual(
      ProxyEngine.prototype._buildCapabilities.call({}, 'codex-desktop', null).question_prompts,
      true,
      'capability must be enabled after the production native round trip',
    );

    console.log(JSON.stringify({
      result: 'PASS',
      fixture_version: fixture.version,
      selected_state_preserved: true,
      typed_question_prompt: true,
      waiting_for_user: true,
      native_answer_calls: nativeCalls,
      native_receipt_required: true,
      duplicate_native_answers: 0,
      wrong_thread_answers: 0,
      invalid_response_native_attempts: 0,
      permission_path_untouched: true,
      exact_target_fresh_detection_client: true,
      exact_target_fresh_answer_client: true,
      question_fast_lane_before_transcript: true,
      open_question_defers_expensive_reads: true,
      plan_mode_already_active_idempotent: true,
      question_prompt_capability_enabled: true,
    }, null, 2));
  } finally {
    selectors.respondToCodexDesktopQuestion = originalRespond;
    selectors.detectThinking = originalThinking;
    selectors.detectCodexDesktopQuestion = originalDetect;
    selectors.readCodexThreadList = originalReadThreadList;
    selectors.evalInPage = originalEvalInPage;
    if (priorLockHeld === undefined) delete process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
    else process.env.CODEX_DESKTOP_CDP_LOCK_HELD = priorLockHeld;
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
