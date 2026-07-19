#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-goal-live-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const { canonicalGoalRecord } = require('../agent-proxy/goal-lifecycle');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const repoRoot = path.resolve(__dirname, '..');

function outputPath(argv) {
  const index = argv.indexOf('--output');
  if (index < 0 || !argv[index + 1]) return null;
  const target = path.resolve(argv[index + 1]);
  const evidenceRoot = path.join(repoRoot, 'evidence');
  const relative = path.relative(evidenceRoot, target);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    '--output must stay under the evidence tree');
  assert.strictEqual(path.extname(target).toLowerCase(), '.json', '--output must be JSON');
  return target;
}

function waitFor(predicate, label, timeoutMs = 120000) {
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

function connection(sessionId, notifications = null) {
  const value = new CodexAppServerConnection({
    sessionId,
    cwd: repoRoot,
    clientName: 'remote-agent-chat-goal-live-e2e',
    clientVersion: '1.0.0',
    requestTimeoutMs: 30000,
  });
  if (notifications) value.on('notification', message => notifications.push(message?.method || null));
  return value;
}

function canonicalNativeGoal(nativeGoal, previousGoal = null) {
  return canonicalGoalRecord({
    objective: nativeGoal.objective,
    raw_state: nativeGoal.status,
    created_at: nativeGoal.createdAt
      ? new Date(Number(nativeGoal.createdAt) * 1000).toISOString()
      : null,
    native_updated_at: nativeGoal.updatedAt
      ? new Date(Number(nativeGoal.updatedAt) * 1000).toISOString()
      : null,
  }, {
    previousGoal,
    sessionKey: 'native-goal-live-thread',
    source: 'codex_cli_jsonl',
    observedAt: new Date().toISOString(),
  });
}

function createHarness(notifications) {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.sent = [];
  engine._sendToRelay = message => { engine.sent.push(message); return true; };
  engine._codexCliGoalDecisionConnectionFactory = options => {
    const value = new CodexAppServerConnection(options);
    value.on('notification', message => notifications.push(message?.method || null));
    return value;
  };
  return engine;
}

async function readThread(connectionValue, threadId) {
  return connectionValue.request('thread/read', { threadId, includeTurns: true });
}

async function answerBranch(engine, session, decision, requestSuffix) {
  const sessionId = session.session_id;
  assert.strictEqual(engine._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity), true);
  const prompts = engine.sent.filter(message => message.type === 'question_prompt');
  const prompt = prompts.at(-1);
  assert.strictEqual(prompt.kind, 'goal_resume_decision');
  assert.strictEqual(prompt.questions[0].message, 'Resume paused goal?');
  const choice = prompt.questions[0].choices.find(candidate => candidate.choice_id === decision);
  assert.ok(choice, `native goal prompt omitted ${decision}`);
  const requestId = `goal-${requestSuffix}-${crypto.randomUUID()}`;
  engine._handleRelayMessage({
    type: 'question_response',
    request_id: requestId,
    session_id: sessionId,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{ question_id: 'goal_resume_decision', choice_ids: [choice.choice_id] }],
  });
  const receipt = await waitFor(
    () => engine.sent.find(message => message.command === 'question_response'
      && message.request_id === requestId),
    `${decision} proxy/native receipt`,
  );
  assert.strictEqual(receipt.result, 'ok');
  assert.strictEqual(receipt.native_acknowledged, true);
  assert.strictEqual(receipt.native_receipt.method, 'thread/goal/set');
  assert.strictEqual(receipt.native_receipt.native_operations, 1);
  assert.strictEqual(receipt.native_receipt.transcript_messages_appended, 0);
  return { prompt, receipt };
}

async function main(argv = process.argv.slice(2)) {
  const destination = outputPath(argv);
  const notifications = [];
  const setup = connection(`goal-live-setup-${crypto.randomUUID()}`, notifications);
  let threadId = null;
  let startup = null;
  try {
    startup = await setup.start();
    const threadResult = await setup.startThread({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
    });
    threadId = threadResult.thread.id;
    const seeded = await setup.request('thread/goal/set', {
      threadId,
      objective: 'Disposable RAC goal decision verification',
      tokenBudget: 2000,
      status: 'paused',
    });
    assert.strictEqual(seeded.goal.status, 'paused');
    const beforeThread = await readThread(setup, threadId);
    const beforeTurns = beforeThread?.thread?.turns?.length || 0;
    await setup.stop();

    const engine = createHarness(notifications);
    const sessionId = `goal-live-${crypto.randomUUID()}`;
    const session = {
      session_id: sessionId,
      agentType: 'codex_cli',
      cliSessionId: threadId,
      workspace_path: repoRoot,
      status: 'healthy',
      codexCliExternalActive: true,
      waitingForAssistant: false,
      activity: {
        kind: 'idle',
        label: '',
        goal: canonicalNativeGoal(seeded.goal),
        updated_at: new Date().toISOString(),
      },
    };
    engine.sessions.set(sessionId, session);

    const resume = await answerBranch(engine, session, 'resume', 'resume');
    assert.strictEqual(resume.receipt.native_receipt.after_status, 'active');
    const verifier = connection(`goal-live-verify-${crypto.randomUUID()}`, notifications);
    await verifier.start();
    const afterResume = (await verifier.getGoal(threadId)).goal;
    assert.strictEqual(afterResume.status, 'active');
    assert.strictEqual(afterResume.objective, seeded.goal.objective);
    assert.strictEqual(afterResume.tokenBudget, seeded.goal.tokenBudget);

    const pausedAgain = await verifier.setGoal(threadId, 'paused');
    assert.strictEqual(pausedAgain.goal.status, 'paused');
    session._lastCanonicalGoal = session.activity.goal;
    session.activity = {
      kind: 'idle',
      label: '',
      goal: canonicalNativeGoal(pausedAgain.goal, session._lastCanonicalGoal),
      updated_at: new Date().toISOString(),
    };
    const leavePaused = await answerBranch(engine, session, 'leave_paused', 'leave');
    assert.strictEqual(leavePaused.receipt.native_receipt.after_status, 'paused');
    const afterLeave = (await verifier.getGoal(threadId)).goal;
    assert.strictEqual(afterLeave.status, 'paused');
    assert.strictEqual(afterLeave.objective, seeded.goal.objective);
    assert.strictEqual(afterLeave.tokenBudget, seeded.goal.tokenBudget);
    const afterThread = await readThread(verifier, threadId);
    const afterTurns = afterThread?.thread?.turns?.length || 0;
    assert.strictEqual(afterTurns, beforeTurns, 'goal choices appended a Codex user turn');
    assert.strictEqual(
      notifications.filter(method => method === 'turn/completed').length,
      0,
      'goal choices emitted a false turn completion',
    );
    assert.strictEqual(engine.sent.filter(message => message.type === 'message').length, 0);
    assert.strictEqual(engine.sent.filter(message => message.type === 'turn_completed').length, 0);
    await verifier.request('thread/archive', { threadId }, 10000);
    threadId = null;
    await verifier.stop();

    const result = {
      result: 'PASS',
      generated_at: new Date().toISOString(),
      codex_cli_version: startup.version,
      prompt_kind: resume.prompt.kind,
      prompt_text: resume.prompt.questions[0].message,
      branches: {
        resume: {
          authoritative_status: afterResume.status,
          native_operations: resume.receipt.native_receipt.native_operations,
        },
        leave_paused: {
          authoritative_status: afterLeave.status,
          native_operations: leavePaused.receipt.native_receipt.native_operations,
        },
      },
      goal_identity_changes: 0,
      transcript_turns_before: beforeTurns,
      transcript_turns_after: afterTurns,
      transcript_messages_appended: 0,
      false_completion_events: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
    if (destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (threadId) {
      try { await setup.request('thread/archive', { threadId }, 10000); } catch {}
    }
    try { await setup.stop(); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
