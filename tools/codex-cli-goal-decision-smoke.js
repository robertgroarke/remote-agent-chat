#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-goal-decision-smoke-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { canonicalQuestionPrompt } = require('../shared/question-prompt-contract');

function goal(status = 'paused') {
  return {
    label: status === 'blocked' ? 'Goal blocked' : 'Goal paused',
    text: 'Preserve this exact objective',
    objective: 'Preserve this exact objective',
    objective_hash: 'objective-hash',
    fingerprint: 'goal-fingerprint',
    generation: 3,
    state: status,
    status,
    raw_state: status,
    transition_seq: status === 'paused' ? 4 : 5,
    transition_id: `transition-${status}`,
    source: 'codex_cli_goal_controller',
  };
}

function harness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.sent = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  return engine;
}

function session(status = 'paused') {
  return {
    session_id: `goal-${status}`,
    agentType: 'codex_cli',
    cliSessionId: 'native-thread',
    status: 'healthy',
    codexCliExternalActive: true,
    waitingForAssistant: false,
    activity: {
      kind: status === 'blocked' ? 'blocked' : 'idle',
      label: status === 'blocked' ? 'Goal blocked' : 'Goal paused',
      goal: goal(status),
      updated_at: new Date().toISOString(),
    },
  };
}

function questionPrompt(sessionId, kind = 'request_user_input') {
  return canonicalQuestionPrompt({
    prompt_id: `${kind}-prompt`,
    session_id: sessionId,
    generation: `${kind}-generation`,
    kind,
    source: { surface: 'codex_cli', version: 'test' },
    title: kind === 'goal_resume_decision' ? 'Goal paused' : 'Native question',
    questions: [{
      id: 'question',
      header: 'Question',
      message: 'Choose one',
      options: [{ id: 'one', label: 'One', description: 'First choice' }],
    }],
    observed_at: new Date().toISOString(),
    cancel_supported: false,
  });
}

try {
  for (const status of ['paused', 'blocked']) {
    const engine = harness();
    const current = session(status);
    engine.sessions.set(current.session_id, current);
    assert.strictEqual(
      engine._syncCodexCliGoalDecisionPrompt(current.session_id, current, current.activity),
      false,
    );
    assert.strictEqual(engine.sent.filter(message => message.type === 'question_prompt').length, 0);
    assert.strictEqual(current.activity.kind, status === 'blocked' ? 'blocked' : 'idle');
    assert.strictEqual(current.waitingForAssistant, false);
  }

  const cleanupEngine = harness();
  const paused = session('paused');
  cleanupEngine.sessions.set(paused.session_id, paused);
  cleanupEngine._registerQuestionPromptAdapter(
    paused.session_id,
    questionPrompt(paused.session_id, 'goal_resume_decision'),
    async () => ({}),
    { adapter_surface: 'codex_cli_goal_decision' },
  );
  paused.waitingForAssistant = true;
  assert.strictEqual(
    cleanupEngine._syncCodexCliGoalDecisionPrompt(paused.session_id, paused, paused.activity),
    true,
  );
  assert.strictEqual(cleanupEngine.activeQuestionPromptAdapters.has(paused.session_id), false);
  assert.strictEqual(paused.waitingForAssistant, false);
  const terminal = cleanupEngine.sent.find(message => message.type === 'question_prompt_state');
  assert.strictEqual(terminal.lifecycle, 'expired');
  assert.strictEqual(terminal.error_code, 'synthetic_goal_prompt_removed');

  const nativeEngine = harness();
  const native = session('paused');
  nativeEngine.sessions.set(native.session_id, native);
  nativeEngine._registerQuestionPromptAdapter(
    native.session_id,
    questionPrompt(native.session_id),
    async () => ({}),
    { adapter_surface: 'codex_cli_app_server' },
  );
  assert.strictEqual(
    nativeEngine._syncCodexCliGoalDecisionPrompt(native.session_id, native, native.activity),
    false,
  );
  assert.strictEqual(nativeEngine.activeQuestionPromptAdapters.has(native.session_id), true);

  console.log(JSON.stringify({
    result: 'PASS',
    paused_goal_synthetic_prompts: 0,
    blocked_goal_synthetic_prompts: 0,
    stale_synthetic_prompt_expired: true,
    native_request_user_input_preserved: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
