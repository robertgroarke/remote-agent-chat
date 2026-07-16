#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { canonicalQuestionPrompt } = require('../shared/question-prompt-contract');

function engineHarness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.sessions = new Map();
  engine.sent = [];
  engine._sendToRelay = message => engine.sent.push(message);
  return engine;
}

function openPrompt(sessionId, generation) {
  return canonicalQuestionPrompt({
    prompt_id: `prompt-${generation}`,
    session_id: sessionId,
    generation,
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

function response(prompt, requestId) {
  return {
    type: 'question_response',
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    answers: [{ question_id: 'choice', choice_ids: [prompt.questions[0].choices[0].choice_id] }],
  };
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const okEngine = engineHarness();
  const okPrompt = openPrompt('adapter-ok-session', 'generation-ok');
  let nativeCalls = 0;
  okEngine._registerQuestionPromptAdapter(okPrompt.session_id, okPrompt, async message => {
    nativeCalls += 1;
    assert.strictEqual(message.prompt_id, okPrompt.prompt_id);
    return { ok: true, native_acknowledged: true, native_receipt: { selected: true, submitted: true, disappeared: true } };
  });
  okEngine._handleRelayMessage(response(okPrompt, 'question-request-ok'));
  await settle();
  assert.strictEqual(nativeCalls, 1);
  const success = okEngine.sent.find(message => message.command === 'question_response');
  assert.strictEqual(success.result, 'ok');
  assert.strictEqual(success.native_acknowledged, true);
  assert.strictEqual(okEngine.activeQuestionPromptAdapters.has(okPrompt.session_id), false);

  const noReceiptEngine = engineHarness();
  const noReceiptPrompt = openPrompt('adapter-no-receipt', 'generation-no-receipt');
  noReceiptEngine._registerQuestionPromptAdapter(noReceiptPrompt.session_id, noReceiptPrompt, async () => ({
    ok: true,
    native_acknowledged: false,
    native_attempted: false,
    retryable: true,
  }));
  noReceiptEngine._handleRelayMessage(response(noReceiptPrompt, 'question-request-no-receipt'));
  await settle();
  const rejected = noReceiptEngine.sent.find(message => message.command === 'question_response');
  assert.strictEqual(rejected.result, 'failed');
  assert.strictEqual(rejected.error.code, 'native_question_not_acknowledged');

  const absentEngine = engineHarness();
  const absentPrompt = openPrompt('adapter-absent', 'generation-absent');
  absentEngine._handleRelayMessage(response(absentPrompt, 'question-request-absent'));
  const absent = absentEngine.sent.find(message => message.command === 'question_response');
  assert.strictEqual(absent.result, 'failed');
  assert.match(absent.error.message, /Answer in native Codex/);

  for (const surface of ['codex', 'codex_cli', 'codex-desktop']) {
    assert.strictEqual(
      ProxyEngine.prototype._buildCapabilities.call({}, surface, null).question_prompts,
      true,
      `${surface} production native round trip must advertise question prompts`,
    );
  }
  assert.strictEqual(okEngine.activePermissionPrompts.size, 0);
  assert.strictEqual(noReceiptEngine.activePermissionPrompts.size, 0);

  console.log(JSON.stringify({
    result: 'PASS',
    exact_adapter_call_count: nativeCalls,
    success_requires_native_acknowledgement: true,
    missing_adapter_fails_closed: true,
    permission_path_untouched: true,
    question_prompt_capability_enabled: ['codex', 'codex_cli', 'codex-desktop'],
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
