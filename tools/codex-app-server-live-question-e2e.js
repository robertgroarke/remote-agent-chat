#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const {
  CodexAppServerConnection,
} = require('../agent-proxy/codex-app-server');

const repoRoot = path.resolve(__dirname, '..');

function waitForQuestion(connection, diagnostics, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      connection.off('question_prompt', onPrompt);
      connection.off('notification', onNotification);
    };
    const fail = message => {
      cleanup();
      const error = new Error(message);
      error.diagnostics = diagnostics;
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(`Timed out after ${timeoutMs}ms waiting for a real Codex request_user_input`);
    }, timeoutMs);
    const onPrompt = prompt => {
      cleanup();
      resolve(prompt);
    };
    const onNotification = message => {
      if (message?.method === 'turn/completed') {
        fail('Codex completed the owned turn without issuing request_user_input');
      }
    };
    connection.on('question_prompt', onPrompt);
    connection.on('notification', onNotification);
  });
}

function waitForTurnCompleted(connection, threadId, turnId, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      connection.off('notification', onNotification);
      connection.off('disconnect', onDisconnect);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for the owned Codex turn to complete`));
    }, timeoutMs);
    const onNotification = message => {
      if (message?.method !== 'turn/completed') return;
      if (message.params?.threadId !== threadId || message.params?.turn?.id !== turnId) return;
      cleanup();
      resolve(message.params.turn);
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error('Codex app-server disconnected before the owned turn completed'));
    };
    connection.on('notification', onNotification);
    connection.on('disconnect', onDisconnect);
  });
}

(async () => {
  const sessionId = `codex-app-server-e2e-${crypto.randomUUID()}`;
  const connection = new CodexAppServerConnection({
    sessionId,
    cwd: repoRoot,
    clientName: 'remote-agent-chat-question-e2e',
    clientVersion: '1.0.0',
    requestTimeoutMs: 120000,
    questionReceiptTimeoutMs: 30000,
  });
  const observedMethods = [];
  const observedItemTypes = [];
  connection.on('notification', message => {
    if (observedMethods.length < 200) observedMethods.push(String(message.method || ''));
    const itemType = String(message?.params?.item?.type || '');
    if (itemType && observedItemTypes.length < 200) observedItemTypes.push(itemType);
  });
  let goalThreadId = null;
  try {
    const startup = await connection.start();
    assert.strictEqual(startup.schema.validation.ok, true);
    assert.strictEqual(startup.schema.validation.method, 'item/tool/requestUserInput');

    const threadResult = await connection.startThread({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    const threadId = threadResult.thread.id;
    const diagnostics = { observedMethods, observedItemTypes };
    const questionPromise = waitForQuestion(connection, diagnostics);
    const turnResult = await connection.startTurn(
      threadId,
      [
        'This is an owned disposable integration test.',
        'Call request_user_input now and do not answer the question yourself.',
        'Ask exactly one single-choice question with id color, header Color, and body Choose a color.',
        'Offer Red (description: Choose red.) and Blue (description: Choose blue.).',
        'After the tool response, acknowledge the selected color briefly and finish.',
      ].join(' '),
      {
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: threadResult.model,
            reasoning_effort: 'medium',
            developer_instructions: null,
          },
        },
      },
    );
    const prompt = await questionPromise;
    assert.strictEqual(prompt.type, 'question_prompt');
    assert.strictEqual(prompt.source.surface, 'codex_cli');
    assert.strictEqual(prompt.source.version, startup.version);
    assert.strictEqual(prompt.questions.length, 1);
    assert.strictEqual(prompt.questions[0].question_id, 'color');
    assert.strictEqual(prompt.questions[0].answer_mode, 'single');
    const red = prompt.questions[0].choices.find(choice => choice.label === 'Red');
    assert.ok(red, 'real native question did not include the requested Red option');

    const turnCompletedPromise = waitForTurnCompleted(connection, threadId, turnResult.turn.id);
    let answerResult;
    try {
      answerResult = await connection.answerQuestion({
        type: 'question_response',
        contract_version: 1,
        prompt_id: prompt.prompt_id,
        session_id: prompt.session_id,
        generation: prompt.generation,
        action: 'answer',
        answers: [{ question_id: 'color', choice_ids: [red.choice_id] }],
      });
    } catch (error) {
      turnCompletedPromise.catch(() => {});
      throw error;
    }
    assert.strictEqual(answerResult.ok, true);
    assert.strictEqual(answerResult.native_acknowledged, true);
    assert.strictEqual(answerResult.lifecycle, 'answered');
    assert.strictEqual(answerResult.native_receipt.method, 'serverRequest/resolved');
    assert.strictEqual(answerResult.native_receipt.thread_id, threadId);
    assert.strictEqual(answerResult.native_receipt.turn_id, turnResult.turn.id);
    const completedTurn = await turnCompletedPromise;
    assert.strictEqual(completedTurn.id, turnResult.turn.id);

    const completedTurnsBeforeGoalDecision = observedMethods.filter(method => method === 'turn/completed').length;
    const goalThreadResult = await connection.startThread({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
    });
    goalThreadId = goalThreadResult.thread.id;
    const seededGoal = await connection.request('thread/goal/set', {
      threadId: goalThreadId,
      objective: 'Disposable goal decision verification',
      tokenBudget: 2000,
      status: 'paused',
    });
    assert.strictEqual(seededGoal.goal.status, 'paused');
    const resumed = await connection.resolveGoalDecision(goalThreadId, 'resume');
    assert.strictEqual(resumed.after.status, 'active');
    assert.strictEqual(resumed.native_operations, 1);
    assert.strictEqual(resumed.transcript_messages_appended, 0);
    assert.strictEqual(resumed.before.objective, resumed.after.objective);
    assert.strictEqual(resumed.before.tokenBudget, resumed.after.tokenBudget);
    await connection.setGoal(goalThreadId, 'paused');
    const leftPaused = await connection.resolveGoalDecision(goalThreadId, 'leave_paused');
    assert.strictEqual(leftPaused.after.status, 'paused');
    assert.strictEqual(leftPaused.native_operations, 1);
    assert.strictEqual(leftPaused.transcript_messages_appended, 0);
    assert.strictEqual(leftPaused.before.objective, leftPaused.after.objective);
    assert.strictEqual(leftPaused.before.tokenBudget, leftPaused.after.tokenBudget);
    assert.strictEqual(
      observedMethods.filter(method => method === 'turn/completed').length,
      completedTurnsBeforeGoalDecision,
      'goal decisions must not emit a false turn completion',
    );

    console.log(JSON.stringify({
      result: 'PASS',
      codex_cli_version: startup.version,
      schema_validated: true,
      real_request_user_input: true,
      same_thread: answerResult.native_receipt.thread_id === threadId,
      same_turn: answerResult.native_receipt.turn_id === turnResult.turn.id,
      exact_native_request_id: true,
      native_acknowledged: true,
      ordinary_user_messages_for_answer: 0,
      goal_resume_status: resumed.after.status,
      goal_leave_status: leftPaused.after.status,
      goal_native_operations_per_branch: 1,
      goal_identity_changes: 0,
      false_goal_completion_events: 0,
      visible_windows_opened: 0,
      observed_notification_methods: [...new Set(observedMethods)].filter(Boolean).slice(0, 20),
    }, null, 2));
  } finally {
    if (goalThreadId) {
      try { await connection.request('thread/archive', { threadId: goalThreadId }, 10000); } catch {}
    }
    await connection.stop();
  }
})().catch(error => {
  if (error.diagnostics) {
    console.error(JSON.stringify({
      notification_methods: [...new Set(error.diagnostics.observedMethods)].filter(Boolean),
      item_types: [...new Set(error.diagnostics.observedItemTypes)].filter(Boolean),
    }));
  }
  if (error.code || error.rpcError) {
    console.error(JSON.stringify({
      code: error.code || null,
      rpc_error: error.rpcError || null,
    }));
  }
  console.error(error.stack || error.message);
  process.exit(1);
});
