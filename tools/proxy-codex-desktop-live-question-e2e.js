#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const selectors = require('../agent-proxy/selectors');
const production = require('./vscode-extension-production-e2e');
const desktop = require('./codex-desktop-owned-controls-e2e');
const { selectPlanMode } = require('./codex-desktop-question-owned-probe');
const { semanticChoice } = require('../shared/question-choice-label');
const {
  OPERATION_LOCK_PATH,
  acquirePidLock,
} = require('./production-harness-overnight-soak');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    sendLive: false,
    requireCapability: false,
    response: 'beta',
    output: freshEvidencePath(ROOT, 'codex-desktop-live-question-e2e.json'),
    timeoutMs: 180000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--require-capability') options.requireCapability = true;
    else if (arg === '--response' && argv[index + 1]) options.response = String(argv[++index]).toLowerCase();
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert.strictEqual(options.sendLive, true, 'explicit --send-live is required');
  assert(['alpha', 'beta', 'cancel'].includes(options.response),
    '--response must be alpha, beta, or cancel');
  assert(Number.isFinite(options.timeoutMs) && options.timeoutMs >= 30000, '--timeout-ms must be at least 30000');
  return options;
}

function responseFrame(prompt, requestId, choiceLabel) {
  const question = prompt.questions.find(item => Array.isArray(item.choices) && item.choices.length > 0);
  assert(question, 'live question prompt has no choice question');
  const choice = semanticChoice(question, choiceLabel);
  assert(choice, `live question prompt has no ${choiceLabel} choice`);
  return {
    type: 'question_response',
    protocol_version: 1,
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{ question_id: question.question_id, choice_ids: [choice.choice_id] }],
  };
}

function validateDesktopChoiceFidelity(livePrompt, nativePrompt) {
  const liveQuestion = livePrompt.questions[0];
  const nativeQuestion = nativePrompt.questions.find(item =>
    item.question_id === liveQuestion.question_id) || nativePrompt.questions[0];
  const alpha = semanticChoice(liveQuestion, 'Alpha');
  const beta = semanticChoice(liveQuestion, 'Beta');
  const nativeChoices = { choices: nativeQuestion?.options || [] };
  const nativeAlpha = semanticChoice(nativeChoices, 'Alpha');
  const nativeBeta = semanticChoice(nativeChoices, 'Beta');
  assert(alpha && beta && nativeAlpha && nativeBeta,
    'production prompt did not preserve both native choices');
  for (const [relayChoice, nativeChoice] of [[alpha, nativeAlpha], [beta, nativeBeta]]) {
    assert.strictEqual(relayChoice.choice_id, nativeChoice.choice_id,
      'relay choice identity diverged from the directly observed native choice');
    assert.strictEqual(relayChoice.label, nativeChoice.label,
      'relay choice label diverged from the directly observed native choice');
    assert.strictEqual(relayChoice.description, nativeChoice.description,
      'relay choice description diverged from the directly observed native choice');
    assert.strictEqual(relayChoice.selected, nativeChoice.selected,
      'relay selected state diverged from the directly observed native choice');
  }
  assert(alpha.description.includes('First branch'), 'native Alpha description lost the requested content');
  assert(beta.description.includes('Second branch'), 'native Beta description lost the requested content');
  return { alpha, beta };
}

function cancelFrame(prompt, requestId) {
  assert.strictEqual(prompt.cancel_supported, true, 'live Desktop prompt does not support cancel');
  return {
    type: 'question_response',
    protocol_version: 1,
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'cancel',
  };
}

async function waitForFrame(messages, start, predicate, timeoutMs, label) {
  return production.waitFor(
    () => messages.slice(start).find(predicate),
    timeoutMs,
    label,
    25,
  );
}

async function waitForNativeAndRelayQuestion({
  Runtime,
  messages,
  start,
  predicate,
  timeoutMs,
  relayAfterNativeMs = 15000,
  onNative,
}) {
  const started = Date.now();
  let deadline = started + timeoutMs;
  let nativeQuestion = null;
  let lastNativeError = null;
  while (Date.now() <= deadline) {
    const relayPrompt = messages.slice(start).find(predicate);
    if (relayPrompt) {
      if (!nativeQuestion) {
        try {
          const current = await selectors.detectCodexDesktopQuestion(Runtime);
          if (current && !current.error) {
            nativeQuestion = current;
            const observedAt = Date.now();
            if (typeof onNative === 'function') onNative(current, observedAt - started, observedAt);
          }
        } catch {}
      }
      return { relayPrompt, nativeQuestion };
    }
    if (!nativeQuestion) {
      try {
        const current = await selectors.detectCodexDesktopQuestion(Runtime);
        if (current && !current.error) {
          nativeQuestion = current;
          const observedAt = Date.now();
          if (typeof onNative === 'function') onNative(current, observedAt - started, observedAt);
          deadline = Math.min(deadline, Date.now() + relayAfterNativeMs);
        } else if (current?.error) {
          lastNativeError = current;
        }
      } catch (error) {
        lastNativeError = { error: 'native_observer_exception', detail: error.message };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (nativeQuestion) {
    const error = new Error(`Native Codex Desktop question was visible but no production relay question_prompt arrived within ${relayAfterNativeMs}ms`);
    error.nativeQuestion = nativeQuestion;
    throw error;
  }
  const suffix = lastNativeError ? `; last native result=${JSON.stringify(lastNativeError)}` : '';
  throw new Error(`Timed out waiting for native and production relay Codex Desktop question${suffix}`);
}

async function cleanupOpenPrompt(relay, prompt) {
  if (!relay || relay.ws.readyState !== WebSocket.OPEN || !prompt?.cancel_supported) return false;
  const requestId = `codex-desktop-question-cleanup-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'question_response',
    protocol_version: 1,
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'cancel',
  }));
  const result = await waitForFrame(
    relay.messages,
    start,
    message => message.type === 'agent_control_result' && message.request_id === requestId,
    15000,
    'owned question cleanup receipt',
  );
  return result.result === 'ok' && result.native_acknowledged === true;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = crypto.randomBytes(6).toString('hex');
  const result = {
    result: 'FAIL',
    generated_at: new Date().toISOString(),
    run_id: runId,
    production_proxy: true,
    cdp_port: 9225,
    focus_actions: 0,
    visible_windows_opened: 0,
    app_restarted: false,
    stages: [],
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });

  let releaseOperation = null;
  let native = null;
  let relay = null;
  let sessionId = '';
  let originalThreadId = '';
  let ownedThreadId = '';
  let newThreadRequested = false;
  let livePrompt = null;
  let nativeAnswered = false;
  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-desktop-live-question-e2e', kind: 'owned-mutation', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = OPERATION_LOCK_PATH;
    result.stages.push('operation_lock');

    native = await desktop.openNative();
    relay = await production.openRelay();
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.agent_type === 'codex-desktop' && item.status !== 'disconnected'),
      45000,
      'connected production Codex Desktop relay session',
      100,
    );
    sessionId = session.session_id;
    result.session_id = sessionId;

    const baseline = await desktop.nativeState(native, sessionId);
    assert(baseline.active?.id, 'Codex Desktop has no exact active thread');
    assert.strictEqual(baseline.thinking?.thinking, false, 'Codex Desktop is active; refusing owned mutation');
    originalThreadId = baseline.active.id;
    result.original_thread = { id: originalThreadId, title: baseline.active.title || '' };
    result.stages.push('idle_guard');

    const config = await desktop.requestConfig(relay, sessionId);
    result.question_prompts_capability = config.capabilities?.question_prompts === true;
    if (options.requireCapability) {
      assert.strictEqual(result.question_prompts_capability, true, 'production Desktop question_prompts capability is not advertised');
    }
    result.stages.push('capability_read');

    await production.control(relay.ws, relay.messages, sessionId, 'new_thread');
    newThreadRequested = true;
    await production.waitFor(async () => {
      const state = await desktop.nativeState(native, sessionId);
      const draft = await desktop.nativeDraftState(native);
      return desktop.isOwnedDisposableComposer(state, draft) ? { state, draft } : null;
    }, 30000, 'empty owned Codex Desktop thread', 100);
    result.stages.push('owned_new_thread');

    result.plan_mode = await selectPlanMode(native.client, native.client.Runtime);
    const planState = await desktop.nativeState(native, sessionId);
    assert.strictEqual(planState.messages.length, 0, 'Plan mode command created an ordinary transcript turn');
    result.stages.push('plan_mode');

    const promptText = [
      'This is an owned disposable Remote Agent Chat validation thread.',
      'Use the request_user_input tool now and do not answer in prose.',
      'Ask exactly one question with header "RAC check" and question "Choose the validation branch."',
      'Offer option "Alpha" with description "First branch" and option "Beta" with description "Second branch".',
      'Wait for the answer. Do not call any other tool.',
    ].join(' ');
    const messageStart = relay.messages.length;
    const deliveryStarted = Date.now();
    const delivery = await desktop.send(
      relay,
      sessionId,
      promptText,
      `codex-desktop-live-question-${runId}`,
    );
    result.delivery = {
      result: delivery.result,
      receipt_ms: Date.now() - deliveryStarted,
    };
    result.stages.push('relay_send_delivered');

    const visibleStarted = Date.now();
    const observed = await waitForNativeAndRelayQuestion({
      Runtime: native.client.Runtime,
      messages: relay.messages,
      start: messageStart,
      predicate: message => message.type === 'question_prompt'
        && message.session_id === sessionId
        && message.source?.surface === 'codex-desktop'
        && message.lifecycle === 'open',
      timeoutMs: options.timeoutMs,
      onNative: (question, elapsedMs, observedAt) => {
        result.direct_native_question = question;
        result.send_receipt_to_native_visible_ms = elapsedMs;
        result.native_observed_at = new Date(observedAt).toISOString();
      },
    });
    livePrompt = observed.relayPrompt;
    if (observed.nativeQuestion && !result.direct_native_question) {
      result.direct_native_question = observed.nativeQuestion;
      result.send_receipt_to_native_visible_ms = Date.now() - visibleStarted;
      result.native_observed_at = new Date().toISOString();
    }
    const visibleAt = Date.now();
    result.send_receipt_to_visible_ms = visibleAt - visibleStarted;
    const nativeObservedAt = Date.parse(result.native_observed_at || '');
    assert(Number.isFinite(nativeObservedAt), 'independent native question observation timestamp is unavailable');
    result.native_observed_to_visible_ms = Math.max(0, visibleAt - nativeObservedAt);
    result.proxy_observed_to_visible_ms = Math.max(0, visibleAt - Date.parse(livePrompt.observed_at));
    const nativePrompt = result.direct_native_question || observed.nativeQuestion;
    assert(nativePrompt && !nativePrompt.error, 'relay prompt arrived without a directly observed native question');
    result.requested_header_rendered_natively = nativePrompt.title === 'RAC check';
    assert.strictEqual(
      livePrompt.title,
      nativePrompt.title,
      'relay title diverged from the directly observed installed Desktop request card',
    );
    assert.strictEqual(livePrompt.title, 'Choose the validation branch.');
    assert.strictEqual(livePrompt.questions.length, 1);
    assert.strictEqual(livePrompt.questions[0].message, 'Choose the validation branch.');
    const { alpha, beta } = validateDesktopChoiceFidelity(livePrompt, nativePrompt);
    assert.strictEqual(alpha.selected, true, 'native initially-selected Alpha state was not preserved');
    assert.strictEqual(beta.selected, false, 'native initially-unselected Beta state was not preserved');
    assert(!Object.prototype.hasOwnProperty.call(livePrompt, 'native_thread_id'), 'relay leaked native thread identity');
    assert(!Object.prototype.hasOwnProperty.call(livePrompt, 'native_signature'), 'relay leaked native selector signature');
    result.prompt = {
      prompt_id: livePrompt.prompt_id,
      generation: livePrompt.generation,
      source: livePrompt.source,
      title: livePrompt.title,
      question: livePrompt.questions[0].message,
      choices: livePrompt.questions[0].choices.map(choice => ({
        label: choice.label,
        description: choice.description,
        selected: choice.selected === true,
      })),
      lifecycle: livePrompt.lifecycle,
      cancel_supported: livePrompt.cancel_supported === true,
      auto_resolution_ms: livePrompt.auto_resolution_ms,
    };
    result.stages.push('browser_question_visible');

    const waitingStatus = await waitForFrame(
      relay.messages,
      messageStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind === 'waiting_for_user',
      30000,
      'waiting_for_user production status',
    );
    result.waiting_activity = waitingStatus.activity;
    result.stages.push('waiting_for_user');

    const nativeQuestion = await selectors.detectCodexDesktopQuestion(native.client.Runtime);
    assert(nativeQuestion && !nativeQuestion.error, `native question missing after relay prompt: ${JSON.stringify(nativeQuestion)}`);
    const beforeAnswer = await desktop.nativeState(native, sessionId);
    assert(beforeAnswer.active?.id, 'owned native question has no active thread');
    ownedThreadId = beforeAnswer.active.id;
    assert.notStrictEqual(ownedThreadId, originalThreadId, 'owned question appeared in original user thread');
    assert.strictEqual(nativeQuestion.native_thread_id, ownedThreadId, 'native question was not scoped to exact owned thread');
    result.owned_thread = { id: ownedThreadId, title: beforeAnswer.active.title || '' };
    result.stages.push('native_scope_verified');

    const requestId = `codex-desktop-live-answer-${runId}`;
    const responseLabel = options.response === 'alpha' ? 'Alpha' : 'Beta';
    const response = options.response === 'cancel'
      ? cancelFrame(livePrompt, requestId)
      : responseFrame(livePrompt, requestId, responseLabel);
    const expectedLifecycle = options.response === 'cancel' ? 'cancelled' : 'answered';
    result.requested_response = options.response;
    const responseStart = relay.messages.length;
    const answerStarted = Date.now();
    relay.ws.send(JSON.stringify(response));
    const receipt = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'agent_control_result' && message.request_id === requestId,
      30000,
      'production native question receipt',
    );
    result.click_to_native_ack_ms = Date.now() - answerStarted;
    assert.strictEqual(receipt.result, 'ok', JSON.stringify(receipt));
    assert.strictEqual(receipt.native_acknowledged, true, JSON.stringify(receipt));
    nativeAnswered = true;
    result.native_receipt = {
      result: receipt.result,
      native_acknowledged: receipt.native_acknowledged,
      lifecycle: receipt.lifecycle,
    };

    const terminal = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'question_prompt_state'
        && message.prompt_id === livePrompt.prompt_id
        && message.lifecycle === expectedLifecycle,
      30000,
      `${expectedLifecycle} question terminal state`,
    );
    result.terminal_lifecycle = terminal.lifecycle;
    await production.waitFor(async () => {
      const current = await selectors.detectCodexDesktopQuestion(native.client.Runtime);
      return current === null ? true : null;
    }, 15000, 'native question card disappearance', 50);
    const answeredState = await desktop.nativeState(native, sessionId);
    assert.strictEqual(answeredState.active?.id, ownedThreadId, 'native acknowledgement changed threads');
    const ordinaryAnswerTurns = answeredState.messages.filter(message =>
      message.role === 'user' && ['Alpha', 'Beta'].includes(String(message.content || '').trim())).length;
    assert.strictEqual(ordinaryAnswerTurns, 0, 'native answer was appended as an ordinary user transcript turn');
    result.native_prompt_disappeared = true;
    result.same_thread = true;
    result.ordinary_answer_user_turns = ordinaryAnswerTurns;
    result.after_answer_thinking = !!answeredState.thinking?.thinking;
    result.stages.push('native_answer_acknowledged');

    const resumedStatus = await waitForFrame(
      relay.messages,
      responseStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind !== 'waiting_for_user',
      30000,
      'post-answer native-evidence activity',
    );
    result.after_answer_activity = resumedStatus.activity;

    const duplicateId = `codex-desktop-live-duplicate-${runId}`;
    const duplicateStart = relay.messages.length;
    relay.ws.send(JSON.stringify({ ...response, request_id: duplicateId }));
    const duplicate = await waitForFrame(
      relay.messages,
      duplicateStart,
      message => message.type === 'agent_control_result' && message.request_id === duplicateId,
      15000,
      'duplicate question rejection',
    );
    assert.strictEqual(duplicate.result, 'failed', JSON.stringify(duplicate));
    result.duplicate = {
      rejected: true,
      code: duplicate.error?.code || '',
      native_attempted: duplicate.native_attempted === true,
    };
    assert.notStrictEqual(result.duplicate.native_attempted, true, 'duplicate response reached the native adapter');
    result.duplicate_native_answers = 0;
    result.wrong_thread_answers = 0;
    result.false_success_receipts = 0;
    result.stages.push('duplicate_rejected');

    result.result = 'PASS';
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    result.error = error.stack || error.message;
    if (native) {
      try {
        const failureState = await desktop.nativeState(native, sessionId);
        const failureQuestion = await selectors.detectCodexDesktopQuestion(native.client.Runtime);
        result.failure_native_state = {
          active_thread: failureState.active
            ? { id: failureState.active.id, title: failureState.active.title || '' }
            : null,
          messages: failureState.messages.map(message => ({
            role: message.role,
            content: String(message.content || '').slice(0, 1000),
          })),
          thinking: failureState.thinking,
          question: failureQuestion,
        };
      } catch (diagnosticError) {
        result.failure_diagnostic_error = diagnosticError.message;
      }
    }
    throw error;
  } finally {
    if (!nativeAnswered && relay && livePrompt) {
      try { result.cleanup_native_acknowledged = await cleanupOpenPrompt(relay, livePrompt); } catch (error) { result.cleanup_error = error.message; }
    }
    if (native && originalThreadId && newThreadRequested) {
      try { result.original_thread_restored = await desktop.restoreOriginal(native, relay, sessionId, originalThreadId); }
      catch (error) { result.restore_error = error.message; }
    }
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
    try { relay?.ws?.close(); } catch {}
    try { await native?.client?.close(); } catch {}
    try { releaseOperation?.(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  cancelFrame,
  cleanupOpenPrompt,
  main,
  parseArgs,
  responseFrame,
  validateDesktopChoiceFidelity,
  waitForFrame,
  waitForNativeAndRelayQuestion,
};
