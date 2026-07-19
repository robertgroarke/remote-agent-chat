#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-goal-decision-smoke-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function waitFor(predicate, label, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function goal(status = 'paused') {
  return {
    label: status === 'paused' ? 'Goal paused' : 'Pursuing goal',
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
    source: 'codex_cli_jsonl',
    tokens_used: 321,
    time_used_seconds: 12,
  };
}

class FakeGoalConnection {
  constructor(decisionLog) {
    this.decisionLog = decisionLog;
    this.current = {
      objective: 'Preserve this exact objective',
      tokenBudget: 5000,
      status: 'paused',
    };
    this.stops = 0;
  }

  async start() {
    return { version: '0.144.4' };
  }

  async getGoal(threadId) {
    assert.strictEqual(threadId, 'native-thread');
    return { goal: { ...this.current } };
  }

  async resolveGoalDecision(threadId, decision) {
    assert.strictEqual(threadId, 'native-thread');
    const before = { ...this.current };
    this.current.status = decision === 'resume' ? 'active' : 'paused';
    this.decisionLog.push({ threadId, decision, native_operations: 1 });
    return {
      ok: true,
      native_acknowledged: true,
      lifecycle: 'answered',
      decision,
      before,
      after: { ...this.current },
      native_operations: 1,
      transcript_messages_appended: 0,
    };
  }

  async stop() {
    this.stops += 1;
  }
}

function harness(decisionLog) {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.sent = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._codexCliGoalDecisionConnectionFactory = () => new FakeGoalConnection(decisionLog);
  return engine;
}

async function runBranch(decision) {
  const decisionLog = [];
  const engine = harness(decisionLog);
  const sessionId = `goal-${decision}`;
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    cliSessionId: 'native-thread',
    workspace_path: process.cwd(),
    status: 'healthy',
    codexCliExternalActive: true,
    waitingForAssistant: false,
    activity: { kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString() },
  };
  engine.sessions.set(sessionId, session);
  assert.strictEqual(engine._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity), true);
  const prompt = engine.sent.find(message => message.type === 'question_prompt');
  assert.ok(prompt, 'goal decision prompt was not relayed');
  assert.strictEqual(prompt.kind, 'goal_resume_decision');
  assert.strictEqual(prompt.questions[0].message, 'Resume paused goal?');
  assert.deepStrictEqual(prompt.questions[0].choices.map(choice => choice.label), [
    'Resume goal', 'Leave paused',
  ]);
  assert.deepStrictEqual(prompt.questions[0].choices.map(choice => choice.description), [
    'Mark it active and continue when idle',
    'Keep it paused; use /goal resume later',
  ]);
  assert.strictEqual(session.activity.kind, 'waiting_for_user');
  const choice = prompt.questions[0].choices.find(candidate => candidate.choice_id === decision);
  assert.ok(choice, `missing native decision ${decision}`);
  engine._handleRelayMessage({
    type: 'question_response',
    request_id: `request-${decision}`,
    session_id: sessionId,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{ question_id: 'goal_resume_decision', choice_ids: [choice.choice_id] }],
  });
  const receipt = await waitFor(
    () => engine.sent.find(message => message.command === 'question_response'),
    `${decision} native receipt`,
  );
  assert.strictEqual(receipt.result, 'ok');
  assert.strictEqual(receipt.native_acknowledged, true);
  assert.strictEqual(receipt.native_receipt.method, 'thread/goal/set');
  assert.strictEqual(receipt.native_receipt.native_operations, 1);
  assert.strictEqual(receipt.native_receipt.transcript_messages_appended, 0);
  assert.strictEqual(receipt.native_receipt.after_status, decision === 'resume' ? 'active' : 'paused');
  assert.deepStrictEqual(decisionLog, [{ threadId: 'native-thread', decision, native_operations: 1 }]);
  assert.strictEqual(engine.sent.filter(message => message.type === 'message').length, 0);
  assert.strictEqual(engine.sent.filter(message => message.type === 'turn_completed').length, 0);
  if (decision === 'leave_paused') {
    const promptsBefore = engine.sent.filter(message => message.type === 'question_prompt').length;
    session.activity = { kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString() };
    assert.strictEqual(engine._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity), false);
    assert.strictEqual(engine.sent.filter(message => message.type === 'question_prompt').length, promptsBefore);
  }
  return receipt;
}

function assertInactiveArchiveDoesNotPrompt() {
  const engine = harness([]);
  const session = {
    session_id: 'inactive-archive',
    agentType: 'codex_cli',
    cliSessionId: 'native-thread',
    workspace_path: process.cwd(),
    status: 'healthy',
    codexCliExternalActive: false,
    activity: { kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString() },
  };
  engine.sessions.set(session.session_id, session);
  assert.strictEqual(
    engine._syncCodexCliGoalDecisionPrompt(session.session_id, session, session.activity),
    false,
  );
  assert.strictEqual(engine.sent.filter(message => message.type === 'question_prompt').length, 0);
}

async function assertStaleGoalFailsBeforeNative() {
  const decisionLog = [];
  const engine = harness(decisionLog);
  const sessionId = 'stale-goal';
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    cliSessionId: 'native-thread',
    workspace_path: process.cwd(),
    status: 'healthy',
    codexCliExternalActive: true,
    activity: { kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString() },
  };
  engine.sessions.set(sessionId, session);
  engine._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity);
  const prompt = engine.sent.find(message => message.type === 'question_prompt');
  session.activity = {
    kind: 'idle', label: '', goal: goal('active'), updated_at: new Date().toISOString(),
  };
  engine._handleRelayMessage({
    type: 'question_response',
    request_id: 'stale-response',
    session_id: sessionId,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{ question_id: 'goal_resume_decision', choice_ids: ['resume'] }],
  });
  const receipt = await waitFor(
    () => engine.sent.find(message => message.request_id === 'stale-response'),
    'stale-goal rejection',
  );
  assert.strictEqual(receipt.result, 'failed');
  assert.strictEqual(receipt.error.code, 'stale_goal_generation');
  assert.strictEqual(receipt.native_attempted, false);
  assert.deepStrictEqual(decisionLog, []);
}

function assertInactiveEdgeExpiresPrompt() {
  const engine = harness([]);
  const sessionId = 'inactive-edge';
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    cliSessionId: 'native-thread',
    workspace_path: process.cwd(),
    status: 'healthy',
    codexCliExternalActive: true,
    waitingForAssistant: false,
    activity: { kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString() },
  };
  engine.sessions.set(sessionId, session);
  engine._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity);
  assert.strictEqual(session.waitingForAssistant, true);
  session.codexCliExternalActive = false;
  engine._setCodexCliActivity(sessionId, session, {
    kind: 'idle', label: '', goal: goal(), updated_at: new Date().toISOString(),
  });
  assert.strictEqual(engine.activeQuestionPromptAdapters.has(sessionId), false);
  assert.strictEqual(session.activity.kind, 'idle');
  assert.strictEqual(session.waitingForAssistant, false);
  const terminal = engine.sent.find(message => message.type === 'question_prompt_state');
  assert.strictEqual(terminal.lifecycle, 'expired');
  assert.strictEqual(terminal.error_code, 'native_goal_changed');
}

(async () => {
  try {
    assertInactiveArchiveDoesNotPrompt();
    assertInactiveEdgeExpiresPrompt();
    await assertStaleGoalFailsBeforeNative();
    const resume = await runBranch('resume');
    const leavePaused = await runBranch('leave_paused');
    console.log(JSON.stringify({
      result: 'PASS',
      prompt_kind: 'goal_resume_decision',
      branches: [resume.native_receipt.decision, leavePaused.native_receipt.decision],
      native_operations_per_branch: 1,
      transcript_messages_appended: 0,
      false_completion_events: 0,
      inactive_archives_do_not_prompt: true,
      inactive_process_expires_prompt: true,
      stale_goal_rejected_before_native_operation: true,
      unchanged_goal_suppressed_after_leave_paused: true,
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
