#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-vscode-codex-question-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const selectors = require('../agent-proxy/selectors');
const codexCli = require('../agent-proxy/codex-cli');
const {
  ProxyEngine,
  detectVsCodeCodexInstalledVersion,
  expectedCodexQuestionAnswers,
} = require('../agent-proxy/proxy-engine');

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'vscode-codex',
  '26.707.91948',
  'request-user-input-dom.json',
), 'utf8'));
const multiFixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'vscode-codex',
  '26.707.91948',
  'request-user-input-multi-dom.json',
), 'utf8'));
const secretFixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'vscode-codex',
  '26.707.91948',
  'request-user-input-secret-unsupported.json',
), 'utf8'));
const deadlineFixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'vscode-codex',
  '26.707.91948',
  'request-user-input-deadline-dom.json',
), 'utf8'));

function harness(sessionId = 'vscode-question-session') {
  const engine = Object.create(ProxyEngine.prototype);
  engine.PROXY_ID = 'proxy-fixture';
  engine.VSCODE_CODEX_SURFACE_VERSION = fixture.version;
  engine.VSCODE_CODEX_QUESTION_POLL_TIMEOUT_MS = 100;
  engine.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS = 1;
  engine.VSCODE_CODEX_QUESTION_IDLE_POLL_INTERVAL_MS = 1;
  engine.VSCODE_CODEX_QUESTION_REMOTE_POLL_WINDOW_MS = 120000;
  engine.VSCODE_CODEX_QUESTION_MISSING_GRACE_MS = 20;
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.activeErrorPrompts = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._log = (level, message) => engine.logs.push({ level, message });
  engine._scheduleCodexVsCodeQuestionPoll = () => {};
  engine._codexVsCodeQuestionCallEvidenceReader = (conversationId, options) => {
    assert.strictEqual(conversationId, fixture.request.conversation_id);
    assert.strictEqual(options.turnId, fixture.request.turn_id);
    assert.strictEqual(options.questions[0].message, 'Choose a route.');
    assert.strictEqual(options.questions[0].choices[0].label, 'Relay');
    return {
      native_at: '2026-07-16T10:12:16.980Z',
      call_id_hash: '0123456789abcdef',
    };
  };
  engine.deadlineSchedules = [];
  engine._scheduleCodexVsCodeQuestionDeadlinePoll = (scheduledSessionId, scheduledSession, deadlineMs, delayMs = null) => {
    const schedule = { scheduledSessionId, scheduledSession, deadlineMs };
    if (delayMs != null) schedule.delayMs = delayMs;
    engine.deadlineSchedules.push(schedule);
  };
  const session = {
    session_id: sessionId,
    agentType: 'codex',
    host_type: 'vscode',
    status: 'healthy',
    client: {
      Runtime: { _vscodeQuestionFixture: true },
      Input: { _vscodeQuestionFixture: true },
    },
    targetId: `target-${sessionId}`,
    _cdpPort: 9230,
    _activeCodexChatId: null,
    activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
    pendingLast: null,
    waitingForAssistant: false,
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
  const nativeRows = fixture.card.controls.filter(control => control.role === 'radio');
  assert.deepStrictEqual(nativeRows.map(control => control.aria_checked), [true, false]);
  assert.deepStrictEqual(nativeRows.map(control => control.aria_disabled), [false, false]);
  assert.deepStrictEqual(nativeRows.map(control => control.aria_description), [
    'Answer through RAC.',
    'Answer locally.',
  ]);
  assert.strictEqual(
    selectors.codexVsCodeCanonicalChoiceLabel('Relay (Recommended)', '1 Relay'),
    'Relay',
    'native recommendation chrome leaked into the authored choice label',
  );
  assert.strictEqual(
    selectors.codexVsCodeCanonicalChoiceLabel('Relay (Recommended)', '1 Relay (Recommended)'),
    'Relay (Recommended)',
    'an authored Recommended suffix was stripped from visible choice text',
  );
  assert.strictEqual(
    selectors.codexVsCodeCanonicalChoiceLabel('Different', '1 Relay'),
    null,
    'unrelated native and rendered labels were accepted',
  );
  assert(selectors.CODEX_VSCODE_QUESTION_EXPR.includes('nativeValue === renderedValue + \' (Recommended)\''),
    'installed native recommendation decoration is not reconciled by the browser extractor');
  assert.strictEqual(selectors.CODEX_VSCODE_EXACT_RESPONSE_VERSION, fixture.version,
    'exact native response callback is not bound to the installed fixture version');
  assert(!selectors.respondToCodexVsCodeQuestion.toString().includes('dispatchMouseEvent'),
    'installed exact response path still enters the five-second native snooze gesture');
  assert.strictEqual(multiFixture.card.question_count, 2);
  assert.deepStrictEqual(multiFixture.card.pages.map(page => page.counter), ['1 of 2', '2 of 2']);
  assert.deepStrictEqual(multiFixture.card.pages.map(page => page.question), [
    'Choose a route.',
    'Choose a pace.',
  ]);
  assert.deepStrictEqual(multiFixture.answer_sequence.map(answer => answer.label), ['Relay', 'Safe']);
  assert.strictEqual(multiFixture.card.acknowledgement, 'request_card_disappeared');
  assert.strictEqual(selectors.codexVsCodeQuestionPageIndex(['1 of 2'], 2), 0);
  assert.strictEqual(selectors.codexVsCodeQuestionPageIndex(['2 of 2'], 2), 1);
  assert.strictEqual(selectors.codexVsCodeQuestionPageIndex(['1 of 2', '2 of 2'], 2), -1);
  assert.strictEqual(selectors.codexVsCodeQuestionPageIndex(['1 of 3'], 2), -1);
  assert.strictEqual(selectors.codexVsCodeQuestionPageIndex([], 1), 0);
  assert(selectors.CODEX_VSCODE_QUESTION_EXPR.includes('native_question_page_counter_ambiguous'),
    'multi-question detection does not fail closed on an ambiguous native page counter');
  assert(selectors.waitForCodexVsCodeQuestionAcknowledgement.toString().includes('domQuietMs = 1500'),
    'native hidden-webview choice transition has no quiet settle window');
  assert(selectors.waitForCodexVsCodeQuestionAcknowledgement.toString().includes('pollIntervalMs = 100'),
    'native persisted receipt polling is not bounded');
  assert.strictEqual(secretFixture.native_result, 'unsupported');
  assert.strictEqual(secretFixture.native_card_rendered, false);
  assert.strictEqual(secretFixture.reason_code, 'installed_tool_requires_non_empty_options');
  assert.strictEqual(secretFixture.request.question.options.length, 0);
  assert.strictEqual(secretFixture.request.question.isSecret, null);
  assert.strictEqual(secretFixture.native_error,
    'request_user_input requires non-empty options for every question');
  assert.strictEqual(deadlineFixture.request.autoResolutionMs, 60000);
  assert.strictEqual(deadlineFixture.card.visible_countdown, false);
  assert.strictEqual(deadlineFixture.card.react_auto_resolution.deadlineMs, 1784196486265);
  assert(selectors.CODEX_VSCODE_QUESTION_EXPR.includes('autoResolution.deadlineMs'),
    'installed native deadline prop is not part of VS Code question extraction');
  const resolutionRoot = path.join(tempRoot, 'codex-sessions');
  const resolutionDay = path.join(resolutionRoot, '2026', '07', '16');
  fs.mkdirSync(resolutionDay, { recursive: true });
  const resolutionCliId = '019f6a69-9516-7001-977e-10c35b541a25';
  const resolutionTurnId = '019f6a69-9698-7a62-99ef-402bd8179c83';
  const resolutionDeadlineMs = Date.parse('2026-07-16T10:13:46.993Z');
  const resolutionCallId = 'call_native_deadline_fixture';
  fs.writeFileSync(path.join(
    resolutionDay,
    `rollout-2026-07-16T03-12-12-${resolutionCliId}.jsonl`,
  ), [
    { timestamp: '2026-07-16T10:12:12.658Z', type: 'event_msg', payload: { type: 'task_started', turn_id: resolutionTurnId } },
    { timestamp: '2026-07-16T10:12:16.980Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: resolutionCallId, arguments: JSON.stringify({ autoResolutionMs: 60000, questions: deadlineFixture.request.question ? [deadlineFixture.request.question] : [] }) } },
    { timestamp: '2026-07-16T10:13:47.008Z', type: 'response_item', payload: { type: 'function_call_output', call_id: resolutionCallId, output: JSON.stringify({ answers: {} }) } },
    { timestamp: '2026-07-16T10:13:48.477Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: resolutionTurnId } },
  ].map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  const nativeResolution = codexCli.readCodexRequestUserInputResolution(resolutionCliId, {
    turnId: resolutionTurnId,
    questions: fixture.expected_observed.questions.map(question => ({
      question_id: question.question_id,
      header: question.header,
      message: question.question,
      choices: question.options,
    })),
    deadlineMs: resolutionDeadlineMs,
    rootDir: resolutionRoot,
  });
  assert.deepStrictEqual(nativeResolution, {
    lifecycle: 'auto_resolved',
    native_acknowledged: true,
    resolved_at: '2026-07-16T10:13:47.008Z',
    deadline_delta_ms: 15,
    answer_count: 0,
    native_at: '2026-07-16T10:12:16.980Z',
    call_id_hash: require('crypto').createHash('sha256').update(resolutionCallId).digest('hex').slice(0, 16),
  });
  assert.deepStrictEqual(codexCli.readCodexRequestUserInputCallEvidence(resolutionCliId, {
    turnId: resolutionTurnId,
    questions: fixture.expected_observed.questions.map(question => ({
      question_id: question.question_id,
      header: question.header,
      message: question.question,
      choices: question.options,
    })),
    rootDir: resolutionRoot,
  }), {
    native_at: '2026-07-16T10:12:16.980Z',
    call_id_hash: require('crypto').createHash('sha256').update(resolutionCallId).digest('hex').slice(0, 16),
  });
  assert(!JSON.stringify(nativeResolution).includes('Relay'), 'native resolution receipt leaked answer values');
  const exactAutoResolution = codexCli.readCodexRequestUserInputResolution(resolutionCliId, {
    turnId: resolutionTurnId,
    questions: fixture.expected_observed.questions.map(question => ({
      question_id: question.question_id,
      header: question.header,
      message: question.question,
      choices: question.options,
    })),
    deadlineMs: resolutionDeadlineMs,
    expectedAnswers: {},
    rootDir: resolutionRoot,
  });
  assert.strictEqual(exactAutoResolution.answers_match, true);
  const mismatchedResolution = codexCli.readCodexRequestUserInputResolution(resolutionCliId, {
    turnId: resolutionTurnId,
    questions: fixture.expected_observed.questions.map(question => ({
      question_id: question.question_id,
      header: question.header,
      message: question.question,
      choices: question.options,
    })),
    deadlineMs: resolutionDeadlineMs,
    expectedAnswers: { route: { answers: ['Native'] } },
    rootDir: resolutionRoot,
  });
  assert.strictEqual(mismatchedResolution.error, 'native_answer_mismatch');
  assert.strictEqual(mismatchedResolution.native_acknowledged, false);
  assert(!JSON.stringify(mismatchedResolution).includes('Native'), 'mismatch receipt leaked expected answer values');

  let persistedReceiptReads = 0;
  const persistedAck = await selectors.waitForCodexVsCodeQuestionAcknowledgement({}, {
    expected: {
      native_conversation_id: fixture.request.conversation_id,
      native_turn_id: fixture.request.turn_id,
      native_request_id: fixture.request.request_id,
      native_signature: fixture.expected_observed.native_signature,
      readNativeResolution: () => {
        persistedReceiptReads += 1;
        return persistedReceiptReads < 2 ? null : {
          lifecycle: 'answered',
          native_acknowledged: true,
          resolved_at: '2026-07-16T10:13:47.008Z',
          answer_count: 1,
          answers_match: true,
          call_id_hash: '0123456789abcdef',
        };
      },
    },
    action: 'answer',
    submissionPath: 'trusted_cdp_input',
    pollIntervalMs: 1,
  });
  assert.strictEqual(persistedAck.ok, true);
  assert.strictEqual(persistedAck.native_receipt.native_resolution_persisted, true);
  assert.strictEqual(persistedAck.native_receipt.request_card_disappeared, false);
  assert.strictEqual(persistedAck.native_receipt.answers_match, true);
  assert.strictEqual(persistedReceiptReads, 2);
  assert(!selectors.CODEX_VSCODE_QUESTION_EXPR.includes(
    '[choice.label, choice.description, choice.native_role, choice.selected]',
  ), 'mutable selected state is still part of native request identity');
  assert(!selectors.CODEX_VSCODE_QUESTION_EXPR.includes('cancel: !!skip'),
    'mutable Skip availability is still part of native request identity');
  assert(!selectors.CODEX_VSCODE_QUESTION_EXPR.includes('deadline_ms: identity.deadline_ms'),
    'mutable auto-resolution deadline is still part of native request identity');
  assert.strictEqual(selectors.codexVsCodeQuestionFollowupState(null, fixture.expected_observed), 'disappeared');
  assert.strictEqual(selectors.codexVsCodeQuestionFollowupState(
    fixture.expected_observed,
    fixture.expected_observed,
  ), 'still_open');
  assert.strictEqual(selectors.codexVsCodeQuestionFollowupState(
    { ...fixture.expected_observed, native_signature: 'selected-state-changed' },
    fixture.expected_observed,
  ), 'replaced');
  assert.strictEqual(selectors.codexVsCodeQuestionFollowupState(
    { error: 'transient_dom_error' },
    fixture.expected_observed,
  ), 'uncertain');

  const fakeExtensionRoot = path.join(tempRoot, 'extensions');
  fs.mkdirSync(path.join(fakeExtensionRoot, 'openai.chatgpt-26.707.71524-win32-x64'), { recursive: true });
  fs.mkdirSync(path.join(fakeExtensionRoot, `openai.chatgpt-${fixture.version}-win32-x64`), { recursive: true });
  assert.strictEqual(
    detectVsCodeCodexInstalledVersion({ extensionRoots: [fakeExtensionRoot] }),
    fixture.version,
  );

  const originalRespond = selectors.respondToCodexVsCodeQuestion;
  const originalThinking = selectors.detectThinking;
  const originalDetect = selectors.detectCodexVsCodeQuestion;
  const originalDetectReceipt = selectors.detectCodexVsCodeQuestionReceipt;
  let nativeCalls = 0;
  try {
    selectors.respondToCodexVsCodeQuestion = async (Runtime, Input, normalized, expected) => {
      nativeCalls += 1;
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      assert.strictEqual(Input._vscodeQuestionFixture, true);
      assert.strictEqual(expected.target_id, `target-${normalized.session_id}`);
      assert.strictEqual(expected.native_conversation_id, fixture.request.conversation_id);
      assert.strictEqual(expected.native_turn_id, fixture.request.turn_id);
      assert.strictEqual(expected.native_request_id, fixture.request.request_id);
      assert.strictEqual(expected.native_signature, fixture.expected_observed.native_signature);
      assert.strictEqual(normalized.answers[0].choice_ids[0], expected.prompt.questions[0].choices[1].choice_id);
      return {
        ok: true,
        native_attempted: true,
        native_acknowledged: true,
        lifecycle: 'answered',
        native_receipt: {
          surface: 'codex',
          conversation_unchanged: true,
          turn_id: expected.native_turn_id,
          request_card_disappeared: true,
        },
      };
    };
    selectors.detectThinking = async Runtime => {
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      return { thinking: true, label: 'Generating' };
    };
    selectors.detectCodexVsCodeQuestion = async Runtime => {
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      return fixture.expected_observed;
    };
    selectors.detectCodexVsCodeQuestionReceipt = async Runtime => {
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      return null;
    };

    const fast = harness('vscode-fast-question-session');
    await fast.engine._pollCodexVsCodeQuestionBounded(fast.session.session_id);
    assert(fast.engine.sent.some(message => message.type === 'question_prompt'),
      'VS Code fast poll did not relay the native question');

    const activeFallback = harness('vscode-active-question-fallback');
    activeFallback.session.waitingForAssistant = false;
    activeFallback.session.activity = { kind: 'idle', label: '' };
    activeFallback.session._vscodeQuestionRemotePollUntil = Date.now() + 60000;
    let activeFallbackSchedule = null;
    activeFallback.engine._scheduleCodexVsCodeQuestionPoll = (sessionId, session, delayMs) => {
      activeFallbackSchedule = { sessionId, session, delayMs };
    };
    selectors.detectCodexVsCodeQuestion = async () => null;
    await activeFallback.engine._pollCodexVsCodeQuestionBounded(activeFallback.session.session_id);
    assert.strictEqual(activeFallbackSchedule.sessionId, activeFallback.session.session_id);
    assert.strictEqual(activeFallbackSchedule.session, activeFallback.session);
    assert.strictEqual(activeFallbackSchedule.delayMs, activeFallback.engine.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS);
    let activeSweepPolls = 0;
    activeFallback.engine._pollCodexVsCodeQuestionBounded = async sessionId => {
      assert.strictEqual(sessionId, activeFallback.session.session_id);
      activeSweepPolls += 1;
    };
    assert.strictEqual(activeFallback.engine._sweepCodexVsCodeActiveQuestionPolls(), 1);
    await settle();
    assert.strictEqual(activeSweepPolls, 1,
      'engine-owned active sweep did not preserve the bounded post-send question lane');
    activeFallback.engine.activeQuestionPromptAdapters.set(activeFallback.session.session_id, {
      adapter_surface: 'codex',
    });
    assert.strictEqual(activeFallback.engine._sweepCodexVsCodeActiveQuestionPolls(), 0,
      'engine-owned active sweep polled through an already-open question');
    const promotedContext = harness('vscode-hinted-context-promotion');
    promotedContext.session.client.Runtime._innerContextId = 41;
    promotedContext.session._iframeInnerContextId = 41;
    promotedContext.session._vscodeQuestionPollHintContextIds = new Set([73]);
    const contextReads = [];
    selectors.detectCodexVsCodeQuestion = async (Runtime, options = {}) => {
      contextReads.push(options.contextId || Runtime._innerContextId || null);
      if (options.contextId === 73) return null;
      assert.strictEqual(Runtime._innerContextId, 73,
        'empty authoritative DOM hint did not replace the stale inner context');
      return fixture.expected_observed;
    };
    await promotedContext.engine._pollCodexVsCodeQuestionBounded(promotedContext.session.session_id);
    assert.deepStrictEqual(contextReads, [73, 73]);
    assert.strictEqual(promotedContext.session.client.Runtime._innerContextId, 73);
    assert.strictEqual(promotedContext.session._iframeInnerContextId, 73);
    assert(promotedContext.engine.sent.some(message => message.type === 'question_prompt'),
      'active fallback did not detect the prompt after promoting the current hinted context');
    const observerContext = harness('vscode-observer-context-inventory');
    observerContext.session.client.Runtime._innerContextId = 41;
    observerContext.session._iframeInnerContextId = 41;
    observerContext.engine._domPush = {
      getState: sessionId => {
        assert.strictEqual(sessionId, observerContext.session.session_id);
        return { installedContextIds: [41, 73] };
      },
    };
    const observerContextReads = [];
    selectors.detectCodexVsCodeQuestion = async (Runtime, options = {}) => {
      observerContextReads.push(options.contextId || Runtime._innerContextId || null);
      return options.contextId === 73 ? fixture.expected_observed : null;
    };
    await observerContext.engine._pollCodexVsCodeQuestionBounded(observerContext.session.session_id);
    assert.deepStrictEqual(observerContextReads, [73],
      'active fallback did not check the newest installed observer context first');
    assert.strictEqual(observerContext.session.client.Runtime._innerContextId, 73);
    assert(observerContext.engine.sent.some(message => message.type === 'question_prompt'),
      'active fallback did not detect the prompt from the observer context inventory');
    const sendSource = ProxyEngine.prototype._handleSendRequest.toString();
    assert(sendSource.indexOf("if (result.ok && sessionData.agentType === 'codex')")
      > sendSource.indexOf('result.ok && result.lifecycle_managed'),
    'lifecycle-managed VS Code sends do not start the active question fallback');
    assert(sendSource.includes('sessionData._vscodeQuestionRemotePollUntil = Date.now()'),
      'lifecycle-managed VS Code sends do not sustain polling across transient native idle');
    const permissionSource = ProxyEngine.prototype._pollPermissions.toString();
    assert(permissionSource.includes('await this._pollCodexVsCodeQuestionBounded(sessionId)'),
      'permission polling does not share the serialized VS Code question lane');
    assert(!permissionSource.includes('selectors.detectCodexVsCodeQuestion(session.client.Runtime)'),
      'permission polling still races the serialized VS Code question detector');
    selectors.detectCodexVsCodeQuestion = async Runtime => {
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      return fixture.expected_observed;
    };

    const order = [];
    fast.engine.activeQuestionPromptAdapters.clear();
    fast.engine._running = true;
    fast.engine._domPush = { notePoll() {} };
    fast.engine._pollCodexVsCodeQuestionBounded = async () => { order.push('question'); };
    fast.engine._pollSessionBounded = async () => { order.push('transcript'); };
    fast.engine._pollPermissionsBounded = async () => { order.push('permission'); };
    await fast.engine._handleDomPush(fast.session.session_id, {});
    assert.deepStrictEqual(order, ['question'], 'DOM push held the native-question lane behind secondary reads');
    assert.strictEqual(fast.engine._domPushSecondaryPollTimers.has(fast.session.session_id), true);
    fast.engine._cancelDomPushSecondaryPoll(fast.session.session_id);
    await fast.engine._runDomPushSecondaryPoll(fast.session.session_id);
    assert.deepStrictEqual(order, ['question', 'transcript', 'permission']);

    const gated = harness('vscode-open-question-session');
    const gatedOrder = [];
    gated.engine._running = true;
    gated.engine._domPush = { notePoll() {} };
    gated.engine._pollCodexVsCodeQuestionBounded = async () => {
      gatedOrder.push('question');
      gated.engine.activeQuestionPromptAdapters.set(gated.session.session_id, {
        adapter_surface: 'codex',
        claimed: false,
      });
    };
    gated.engine._pollSessionBounded = async () => { gatedOrder.push('transcript'); };
    gated.engine._pollPermissionsBounded = async () => { gatedOrder.push('permission'); };
    await gated.engine._handleDomPush(gated.session.session_id, {});
    assert.deepStrictEqual(gatedOrder, ['question']);
    assert.strictEqual(gated.engine._domPushSecondaryPollTimers?.has(gated.session.session_id) || false, false,
      'open native question retained a secondary transcript timer');

    const { engine, session } = harness();
    await engine._handleCodexVsCodeQuestionState(
      session.session_id,
      session,
      fixture.expected_observed,
    );
    const prompt = engine.sent.find(message => message.type === 'question_prompt');
    assert(prompt, 'VS Code question was not relayed');
    assert.strictEqual(prompt.source.surface, 'codex');
    assert.strictEqual(prompt.source.version, fixture.version);
    assert.strictEqual(prompt.native_at, '2026-07-16T10:12:16.980Z');
    assert.strictEqual(prompt.title, 'Route');
    assert.strictEqual(prompt.questions[0].message, 'Choose a route.');
    assert.strictEqual(prompt.questions[0].choices[0].description, 'Answer through RAC.');
    assert.strictEqual(prompt.questions[0].choices[1].description, 'Answer locally.');
    assert.strictEqual(prompt.questions[0].choices[0].selected, true);
    assert.strictEqual(prompt.questions[0].choices[1].selected, false);
    assert.strictEqual(prompt.questions[0].choices[2].is_other, true);
    assert.strictEqual(prompt.cancel_supported, true);
    assert.strictEqual(session.activity.kind, 'waiting_for_user');
    assert.strictEqual(engine.activePermissionPrompts.size, 0);
    const raced = harness('vscode-producer-evidence-race');
    let producerReads = 0;
    raced.engine._codexVsCodeQuestionCallEvidenceReader = () => {
      producerReads += 1;
      return producerReads < 2 ? null : {
        native_at: '2026-07-16T10:12:16.980Z',
        call_id_hash: '0123456789abcdef',
      };
    };
    const racedEvidence = await raced.engine._readCodexVsCodeQuestionCallEvidence(fixture.expected_observed);
    assert.strictEqual(racedEvidence.native_at, '2026-07-16T10:12:16.980Z');
    assert.strictEqual(producerReads, 2, 'producer timestamp write-order race was not retried exactly once');
    assert.deepStrictEqual(expectedCodexQuestionAnswers(prompt, response(prompt, 'expected-native-answer')), {
      route: { answers: ['Native'] },
    });
    assert.deepStrictEqual(expectedCodexQuestionAnswers(prompt, {
      action: 'cancel',
      answers: [],
    }), {});

    const otherChoice = prompt.questions[0].choices.find(choice => choice.is_other);
    assert(otherChoice, 'installed fixture did not expose Other');
    assert.deepStrictEqual(selectors.codexVsCodeQuestionNativeAction({
      action: 'answer',
      answers: [{
        question_id: prompt.questions[0].question_id,
        choice_ids: [otherChoice.choice_id],
        other_text: 'Use the verified alternate route.',
      }],
    }, { prompt, skip_label: 'Skip' }), {
      ok: true,
      action: 'answer',
      nativeActions: [{
        kind: 'other',
        text: 'Use the verified alternate route.',
        question_index: 0,
        question: 'Choose a route.',
      }],
    });
    assert.strictEqual(selectors.codexVsCodeQuestionNativeAction({
      action: 'answer',
      answers: [{
        question_id: prompt.questions[0].question_id,
        choice_ids: [otherChoice.choice_id],
        other_text: '',
      }],
    }, { prompt, skip_label: 'Skip' }).code, 'vscode_other_text_required');

    const multiPrompt = {
      ...prompt,
      questions: [
        prompt.questions[0],
        {
          question_id: 'pace',
          header: 'Pace',
          message: 'Choose a pace.',
          answer_mode: 'single',
          required: true,
          multi_select: false,
          allow_other: true,
          secret: false,
          choices: [
            { choice_id: 'vscode-choice-1', label: 'Fast', description: 'Prefer speed.', selected: true, requires_text: false, is_other: false },
            { choice_id: 'vscode-choice-2', label: 'Safe', description: 'Prefer caution.', selected: false, requires_text: false, is_other: false },
            { choice_id: 'vscode-choice-other', label: 'Other', description: 'No, and tell ChatGPT what to do differently', selected: false, requires_text: true, is_other: true },
          ],
        },
      ],
    };
    assert.deepStrictEqual(selectors.codexVsCodeQuestionNativeAction({
      action: 'answer',
      answers: [
        { question_id: 'route', choice_ids: ['vscode-choice-1'] },
        { question_id: 'pace', choice_ids: ['vscode-choice-2'] },
      ],
    }, { prompt: multiPrompt, skip_label: 'Skip' }), {
      ok: true,
      action: 'answer',
      nativeActions: [
        { kind: 'choice', label: 'Relay', question_index: 0, question: 'Choose a route.' },
        { kind: 'choice', label: 'Safe', question_index: 1, question: 'Choose a pace.' },
      ],
    });
    assert(originalRespond.toString().includes("? 'installed_exact_dismiss_callback'"),
      'installed cancel response does not use the exact version-bound native dismiss contract');
    assert(originalRespond.toString().includes(": 'installed_exact_submit_callback'"),
      'installed answer forms do not use the exact version-bound native submit contract');
    assert(originalRespond.toString().includes('candidate.onSubmit(answers)'),
      'installed answer path does not call the exact native form handler');
    assert(originalRespond.toString().includes('candidate.onEscapeDismiss()'),
      'installed cancel path does not call the exact native dismiss handler');

    await engine._handleCodexVsCodeQuestionState(session.session_id, session, null);
    assert.strictEqual(engine.activeQuestionPromptAdapters.has(session.session_id), true,
      'one transient missing observation expired the open native prompt');
    assert(session._codexVsCodeQuestionMissingSince > 0);
    await engine._handleCodexVsCodeQuestionState(
      session.session_id,
      session,
      fixture.expected_observed,
    );
    assert.strictEqual(session._codexVsCodeQuestionMissingSince, 0,
      'native prompt re-observation did not reset the missing grace');

    const expired = harness('vscode-question-expiry-session');
    await expired.engine._handleCodexVsCodeQuestionState(
      expired.session.session_id,
      expired.session,
      fixture.expected_observed,
    );
    expired.session._codexVsCodeQuestionMissingSince = Date.now() - 1000;
    await expired.engine._handleCodexVsCodeQuestionState(
      expired.session.session_id,
      expired.session,
      null,
    );
    assert.strictEqual(expired.engine.activeQuestionPromptAdapters.has(expired.session.session_id), false,
      'sustained native disappearance did not expire the prompt');
    assert(expired.engine.sent.some(message => message.type === 'question_prompt_state'
      && message.lifecycle === 'expired'
      && message.error_code === 'native_question_disappeared'));

    const autoResolved = harness('vscode-question-auto-resolution-session');
    const nativeDeadlineMs = Date.now() + 60000;
    await autoResolved.engine._handleCodexVsCodeQuestionState(
      autoResolved.session.session_id,
      autoResolved.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-deadline-signature',
        native_deadline_ms: nativeDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const deadlinePrompt = autoResolved.engine.sent.find(message => message.type === 'question_prompt');
    assert.strictEqual(deadlinePrompt.deadline_at, new Date(nativeDeadlineMs).toISOString());
    assert(deadlinePrompt.auto_resolution_ms > 59000 && deadlinePrompt.auto_resolution_ms <= 60000);
    assert.strictEqual(deadlinePrompt.auto_resolution_policy, 'native');
    assert.deepStrictEqual(autoResolved.engine.deadlineSchedules, [{
      scheduledSessionId: autoResolved.session.session_id,
      scheduledSession: autoResolved.session,
      deadlineMs: nativeDeadlineMs,
    }]);
    const activeDeadline = autoResolved.engine.activeQuestionPromptAdapters.get(autoResolved.session.session_id);
    activeDeadline.prompt.deadline_at = new Date(Date.now() - 1).toISOString();
    autoResolved.engine._codexVsCodeQuestionResolutionReader = () => ({
      lifecycle: 'auto_resolved',
      native_acknowledged: true,
      resolved_at: new Date().toISOString(),
      deadline_delta_ms: 1,
      answer_count: 0,
      call_id_hash: 'fixture-resolution',
    });
    let blockedDomReceiptReads = 0;
    selectors.detectCodexVsCodeQuestionReceipt = async () => {
      blockedDomReceiptReads += 1;
      return new Promise(() => {});
    };
    await autoResolved.engine._handleCodexVsCodeQuestionState(
      autoResolved.session.session_id,
      autoResolved.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-deadline-signature',
        native_deadline_ms: nativeDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    assert.strictEqual(blockedDomReceiptReads, 0,
      'available exact native JSONL receipt was delayed behind a DOM read');
    assert(autoResolved.engine.sent.some(message => message.type === 'question_prompt_state'
      && message.lifecycle === 'auto_resolved'
      && message.error_code === 'native_auto_resolution'));

    const domAutoResolved = harness('vscode-question-dom-auto-resolution-session');
    const domDeadlineMs = Date.now() + 60000;
    await domAutoResolved.engine._handleCodexVsCodeQuestionState(
      domAutoResolved.session.session_id,
      domAutoResolved.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-dom-deadline-signature',
        native_deadline_ms: domDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const domEntry = domAutoResolved.engine.activeQuestionPromptAdapters.get(
      domAutoResolved.session.session_id,
    );
    domEntry.prompt.deadline_at = new Date(Date.now() - 1).toISOString();
    domAutoResolved.engine._codexVsCodeQuestionResolutionReader = () => null;
    let domReceiptReads = 0;
    selectors.detectCodexVsCodeQuestionReceipt = async (Runtime, expected) => {
      assert.strictEqual(Runtime._vscodeQuestionFixture, true);
      assert.strictEqual(expected.native_conversation_id, fixture.request.conversation_id);
      assert.strictEqual(expected.native_turn_id, fixture.request.turn_id);
      assert.strictEqual(expected.native_request_id, fixture.request.request_id);
      assert.deepStrictEqual(expected.prompt.questions, domEntry.prompt.questions);
      domReceiptReads += 1;
      return {
        lifecycle: 'auto_resolved',
        native_acknowledged: true,
        source: 'vscode_dom_user_input_response',
        answer_count: 0,
      };
    };
    await domAutoResolved.engine._handleCodexVsCodeQuestionState(
      domAutoResolved.session.session_id,
      domAutoResolved.session,
      null,
    );
    assert.strictEqual(domReceiptReads, 1, 'exact native DOM receipt was not read once');
    assert(domAutoResolved.engine.sent.some(message => message.type === 'question_prompt_state'
      && message.lifecycle === 'auto_resolved'
      && message.error_code === 'native_auto_resolution'));
    assert(domAutoResolved.engine.logs.some(entry => entry.message.includes('native DOM terminal auto_resolved')));

    const boundedDom = harness('vscode-question-bounded-dom-session');
    const boundedDomDeadlineMs = Date.now() + 60000;
    await boundedDom.engine._handleCodexVsCodeQuestionState(
      boundedDom.session.session_id,
      boundedDom.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-bounded-dom-signature',
        native_deadline_ms: boundedDomDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const boundedDomEntry = boundedDom.engine.activeQuestionPromptAdapters.get(
      boundedDom.session.session_id,
    );
    boundedDomEntry.prompt.deadline_at = new Date(Date.now() - 1).toISOString();
    boundedDom.engine._codexVsCodeQuestionResolutionReader = () => null;
    selectors.detectCodexVsCodeQuestionReceipt = async () => new Promise(() => {});
    const boundedDomStartedAt = Date.now();
    await boundedDom.engine._handleCodexVsCodeQuestionState(
      boundedDom.session.session_id,
      boundedDom.session,
      null,
    );
    const boundedDomElapsedMs = Date.now() - boundedDomStartedAt;
    assert(boundedDomElapsedMs >= 80 && boundedDomElapsedMs < 1000,
      `hung native DOM receipt was not bounded (${boundedDomElapsedMs}ms)`);
    assert(boundedDom.engine.logs.some(entry => entry.message.includes('timed out after 100ms')),
      'bounded native DOM receipt timeout was not logged');
    assert.strictEqual(boundedDom.engine.deadlineSchedules.at(-1).delayMs, 100,
      'bounded native DOM receipt fallback did not retain exact JSONL retry scheduling');

    selectors.detectCodexVsCodeQuestionReceipt = async () => null;
    const promptsBeforeStale = autoResolved.engine.sent.filter(message => message.type === 'question_prompt').length;
    await autoResolved.engine._handleCodexVsCodeQuestionState(
      autoResolved.session.session_id,
      autoResolved.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-deadline-signature',
        native_deadline_ms: nativeDeadlineMs,
        auto_resolution_seconds_remaining: 0,
        auto_resolution_policy: 'native',
      },
    );
    assert.strictEqual(
      autoResolved.engine.sent.filter(message => message.type === 'question_prompt').length,
      promptsBeforeStale,
      'stale native deadline card resurrected a terminal prompt',
    );

    let deadlineWakeups = 0;
    let deadlineWakeCdpPolls = 0;
    const deadlineWakeSession = {};
    const deadlineWakeEngine = {
      _pollCodexVsCodeQuestionDeadlineReceipt: (scheduledSessionId, expectedDeadlineMs) => {
        assert.strictEqual(scheduledSessionId, 'vscode-deadline-wakeup');
        assert(Number.isFinite(expectedDeadlineMs));
        deadlineWakeups += 1;
      },
      _pollCodexVsCodeQuestionBounded: async () => { deadlineWakeCdpPolls += 1; },
      _log: () => {},
    };
    ProxyEngine.prototype._scheduleCodexVsCodeQuestionDeadlinePoll.call(
      deadlineWakeEngine,
      'vscode-deadline-wakeup',
      deadlineWakeSession,
      Date.now() + 20,
    );
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.strictEqual(deadlineWakeups, 1, 'exact native deadline did not schedule one bounded wake-up');
    assert.strictEqual(deadlineWakeCdpPolls, 0, 'deadline receipt wake-up entered the collision-prone CDP poll lane');

    const watcherReceipt = harness('vscode-question-watcher-receipt-session');
    const watcherDeadlineMs = Date.now() + 1000;
    await watcherReceipt.engine._handleCodexVsCodeQuestionState(
      watcherReceipt.session.session_id,
      watcherReceipt.session,
      {
        ...fixture.expected_observed,
        native_conversation_id: 'fixture-watcher-conversation',
        native_signature: 'fixture-watcher-signature',
        native_deadline_ms: watcherDeadlineMs,
        auto_resolution_seconds_remaining: 1,
        auto_resolution_policy: 'native',
      },
    );
    let watcherReceiptTriggers = 0;
    const originalDeadlineReceiptPoll = watcherReceipt.engine._pollCodexVsCodeQuestionDeadlineReceipt;
    watcherReceipt.engine._pollCodexVsCodeQuestionDeadlineReceipt = (scheduledSessionId, expectedDeadlineMs) => {
      assert.strictEqual(scheduledSessionId, watcherReceipt.session.session_id);
      assert.strictEqual(expectedDeadlineMs, watcherDeadlineMs);
      watcherReceiptTriggers += 1;
      return true;
    };
    assert.strictEqual(
      watcherReceipt.engine._reconcileCodexVsCodeQuestionReceiptForCliSession('wrong-conversation'),
      0,
    );
    assert.strictEqual(
      watcherReceipt.engine._reconcileCodexVsCodeQuestionReceiptForCliSession('fixture-watcher-conversation'),
      1,
    );
    assert.strictEqual(watcherReceiptTriggers, 1,
      'exact Codex JSONL watcher event did not trigger deadline receipt reconciliation');
    watcherReceipt.engine._pollCodexVsCodeQuestionDeadlineReceipt = originalDeadlineReceiptPoll;

    const sweepReceipt = harness('vscode-question-engine-sweep-receipt-session');
    const sweepDeadlineMs = Date.now() + 60000;
    await sweepReceipt.engine._handleCodexVsCodeQuestionState(
      sweepReceipt.session.session_id,
      sweepReceipt.session,
      {
        ...fixture.expected_observed,
        native_conversation_id: 'fixture-sweep-conversation',
        native_signature: 'fixture-sweep-signature',
        native_deadline_ms: sweepDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const sweepEntry = sweepReceipt.engine.activeQuestionPromptAdapters.get(
      sweepReceipt.session.session_id,
    );
    sweepEntry.prompt.deadline_at = new Date(Date.now() - 1).toISOString();
    sweepReceipt.engine._codexVsCodeQuestionResolutionReader = () => ({
      lifecycle: 'auto_resolved',
      native_acknowledged: true,
      resolved_at: new Date().toISOString(),
      deadline_delta_ms: 1,
      answer_count: 0,
      call_id_hash: 'fixture-sweep-resolution',
    });
    const deadlineSweepChecks = sweepReceipt.engine._sweepCodexVsCodeQuestionDeadlineReceipts();
    assert.strictEqual(deadlineSweepChecks, 1,
      'engine-owned deadline sweep did not inspect the due VS Code receipt');
    assert(sweepReceipt.engine.logs.some(entry => entry.message.includes(
      'Engine deadline receipt sweep entered at',
    )), 'engine-owned deadline sweep did not record its first due check');
    assert(sweepReceipt.engine.sent.some(message => message.type === 'question_prompt_state'
      && message.lifecycle === 'auto_resolved'
      && message.error_code === 'native_auto_resolution'),
    'engine-owned deadline sweep did not emit the exact native terminal');

    const deadlineRetry = harness('vscode-question-deadline-retry-session');
    const retryDeadlineMs = Date.now() + 60000;
    await deadlineRetry.engine._handleCodexVsCodeQuestionState(
      deadlineRetry.session.session_id,
      deadlineRetry.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-deadline-retry-signature',
        native_deadline_ms: retryDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const retryEntry = deadlineRetry.engine.activeQuestionPromptAdapters.get(deadlineRetry.session.session_id);
    const retryPastDeadlineMs = Date.now() - 1;
    retryEntry.prompt.deadline_at = new Date(retryPastDeadlineMs).toISOString();
    deadlineRetry.engine._codexVsCodeQuestionResolutionReader = () => null;
    deadlineRetry.engine._pollCodexVsCodeQuestionDeadlineReceipt(
      deadlineRetry.session.session_id,
      retryPastDeadlineMs,
    );
    assert.strictEqual(deadlineRetry.engine.deadlineSchedules.at(-1).delayMs, 100,
      'missing native receipt did not stay on the dedicated bounded retry lane');

    const deadlineMissing = harness('vscode-question-deadline-missing-session');
    const missingDeadlineMs = Date.now() + 60000;
    await deadlineMissing.engine._handleCodexVsCodeQuestionState(
      deadlineMissing.session.session_id,
      deadlineMissing.session,
      {
        ...fixture.expected_observed,
        native_signature: 'fixture-deadline-missing-signature',
        native_deadline_ms: missingDeadlineMs,
        auto_resolution_seconds_remaining: 60,
        auto_resolution_policy: 'native',
      },
    );
    const missingEntry = deadlineMissing.engine.activeQuestionPromptAdapters.get(deadlineMissing.session.session_id);
    const expiredDeadlineMs = Date.now() - 16000;
    missingEntry.prompt.deadline_at = new Date(expiredDeadlineMs).toISOString();
    deadlineMissing.engine._codexVsCodeQuestionResolutionReader = () => null;
    deadlineMissing.engine._pollCodexVsCodeQuestionDeadlineReceipt(
      deadlineMissing.session.session_id,
      expiredDeadlineMs,
    );
    assert(deadlineMissing.engine.sent.some(message => message.type === 'question_prompt_state'
      && message.lifecycle === 'expired'
      && message.error_code === 'native_resolution_receipt_missing'));

    const reboundSession = {
      ...session,
      client: {
        Runtime: { _vscodeQuestionFixture: true },
        Input: { _vscodeQuestionFixture: true },
      },
    };
    engine.sessions.set(session.session_id, reboundSession);
    engine._handleRelayMessage(response(prompt, 'vscode-response'));
    await settle();
    await settle();
    assert.strictEqual(nativeCalls, 1);
    const receipt = engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'vscode-response');
    assert.strictEqual(receipt.result, 'ok');
    assert.strictEqual(receipt.native_acknowledged, true);
    assert.strictEqual(receipt.native_receipt.request_card_disappeared, true);
    assert.strictEqual(receipt.native_receipt.turn_id, fixture.request.turn_id);
    assert.strictEqual(reboundSession.activity.kind, 'thinking');
    assert.strictEqual(engine.activeQuestionPromptAdapters.has(session.session_id), false);

    engine._handleRelayMessage(response(prompt, 'vscode-duplicate'));
    assert.strictEqual(nativeCalls, 1, 'duplicate response reached the native adapter');
    const duplicate = engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'vscode-duplicate');
    assert.strictEqual(duplicate.result, 'failed');
    assert.strictEqual(duplicate.error.code, 'question_prompt_not_owned');

    const stale = harness('vscode-stale-session');
    stale.session._activeCodexChatId = '019f0000-0000-7000-8000-000000000000';
    await stale.engine._handleCodexVsCodeQuestionState(
      stale.session.session_id,
      stale.session,
      fixture.expected_observed,
    );
    assert.strictEqual(stale.engine.sent.some(message => message.type === 'question_prompt'), false);

    const invalid = harness('vscode-invalid-session');
    await invalid.engine._handleCodexVsCodeQuestionState(
      invalid.session.session_id,
      invalid.session,
      fixture.expected_observed,
    );
    const invalidPrompt = invalid.engine.sent.find(message => message.type === 'question_prompt');
    const bad = response(invalidPrompt, 'vscode-invalid');
    bad.answers[0].choice_ids = ['not-open'];
    invalid.engine._handleRelayMessage(bad);
    await settle();
    await settle();
    const rejected = invalid.engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'vscode-invalid');
    assert.strictEqual(rejected.result, 'failed');
    assert.strictEqual(rejected.native_attempted, false);
    assert.strictEqual(invalid.engine.activeQuestionPromptAdapters.get(invalid.session.session_id).claimed, false);

    const changedTarget = harness('vscode-changed-target-session');
    await changedTarget.engine._handleCodexVsCodeQuestionState(
      changedTarget.session.session_id,
      changedTarget.session,
      fixture.expected_observed,
    );
    const changedTargetPrompt = changedTarget.engine.sent.find(message => message.type === 'question_prompt');
    changedTarget.engine.sessions.set(changedTarget.session.session_id, {
      ...changedTarget.session,
      targetId: 'different-target',
    });
    changedTarget.engine._handleRelayMessage(response(changedTargetPrompt, 'vscode-changed-target'));
    await settle();
    await settle();
    const changedTargetReceipt = changedTarget.engine.sent.find(message =>
      message.command === 'question_response' && message.request_id === 'vscode-changed-target');
    assert.strictEqual(changedTargetReceipt.result, 'failed');
    assert.strictEqual(changedTargetReceipt.error.code, 'vscode_session_changed');
    assert.strictEqual(changedTargetReceipt.native_attempted, false);
    assert.strictEqual(nativeCalls, 1, 'a changed CDP target reached the native adapter');

    assert.strictEqual(
      ProxyEngine.prototype._buildCapabilities.call({}, 'codex', null).question_prompts,
      true,
      'capability must be enabled after the production browser-to-native round trip',
    );

    const pushAttachCalls = [];
    const pushRuntime = { _innerContextId: 73 };
    const pushSession = {
      agentType: 'codex',
      client: { Runtime: pushRuntime },
      _iframeInnerContextId: pushRuntime._innerContextId,
    };
    const originalCacheInnerContextId = selectors.cacheInnerContextId;
    selectors.cacheInnerContextId = async Runtime => Runtime._innerContextId;
    try {
      await ProxyEngine.prototype._syncDomPushObservers.call({
        sessions: new Map([['vscode-question-push', pushSession]]),
        _domPush: {
          sessionIds: () => new Set().values(),
          detach: async () => {},
          getState: () => null,
          attach: async (sessionId, client, options) => {
            pushAttachCalls.push({ sessionId, client, contextId: await options.resolveContextId() });
            return { ok: true };
          },
        },
        _isEphemeralIframeAgent: ProxyEngine.prototype._isEphemeralIframeAgent,
        _log: () => {},
      });
    } finally {
      selectors.cacheInnerContextId = originalCacheInnerContextId;
    }
    assert.deepStrictEqual(pushAttachCalls, [{
      sessionId: 'vscode-question-push',
      client: pushSession.client,
      contextId: 73,
    }]);

    console.log(JSON.stringify({
      result: 'PASS',
      fixture_version: fixture.version,
      installed_version_detection: true,
      selected_and_disabled_state_preserved: true,
      native_descriptions_preserved: true,
      private_identity_fields: ['conversation_id', 'turn_id', 'request_id'],
      typed_question_prompt: true,
      waiting_for_user: true,
      native_answer_calls: nativeCalls,
      native_receipt_required: true,
      immutable_native_request_signature: true,
      transient_missing_observation_debounced: true,
      visible_replacement_not_acknowledged: true,
      other_text_native_action_validated: true,
      exact_version_bound_response_callback: true,
      native_auto_resolution_snooze_bypassed: true,
      multi_question_navigation_validated: true,
      secret_inventory: 'gated_by_installed_tool_contract',
      exact_native_deadline_propagated: true,
      native_auto_resolution_terminal: true,
      native_jsonl_resolution_receipt: true,
      native_jsonl_exact_answer_match: true,
      native_jsonl_normal_response_ack: true,
      native_jsonl_receipt_precedes_dom_reads: blockedDomReceiptReads === 0,
      native_dom_resolution_receipt: true,
      native_dom_resolution_receipt_reads: domReceiptReads,
      native_dom_resolution_receipt_timeout_ms: boundedDomElapsedMs,
      stale_deadline_card_resurrection: 0,
      exact_deadline_wakeup_count: deadlineWakeups,
      deadline_receipt_lane_cdp_polls: deadlineWakeCdpPolls,
      deadline_receipt_retry_ms: 100,
      deadline_missing_receipt_failed_closed: true,
      jsonl_watcher_receipt_trigger_count: watcherReceiptTriggers,
      engine_deadline_sweep_receipt_checks: deadlineSweepChecks,
      duplicate_native_answers: 0,
      wrong_conversation_answers: 0,
      invalid_response_native_attempts: 0,
      permission_path_untouched: true,
      question_fast_lane_before_transcript: true,
      open_question_defers_expensive_reads: true,
      question_dom_push_inner_context: 73,
      question_prompt_capability_enabled: true
    }, null, 2));
  } finally {
    selectors.respondToCodexVsCodeQuestion = originalRespond;
    selectors.detectThinking = originalThinking;
    selectors.detectCodexVsCodeQuestion = originalDetect;
    selectors.detectCodexVsCodeQuestionReceipt = originalDetectReceipt;
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
