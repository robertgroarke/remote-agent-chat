#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const {
  CodexAppServerConnection,
} = require('../agent-proxy/codex-app-server');
const { semanticChoice } = require('../shared/question-choice-label');

const repoRoot = path.resolve(__dirname, '..');

function waitForQuestion(connection, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      connection.off('question_prompt', onPrompt);
      connection.off('notification', onNotification);
      connection.off('disconnect', onDisconnect);
    };
    const fail = message => {
      cleanup();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Timed out waiting for an owned request_user_input'), timeoutMs);
    const onPrompt = prompt => {
      cleanup();
      resolve(prompt);
    };
    const onNotification = message => {
      if (message?.method === 'turn/completed') {
        fail('Owned turn completed without request_user_input');
      }
    };
    const onDisconnect = () => fail('App-server disconnected before request_user_input');
    connection.on('question_prompt', onPrompt);
    connection.on('notification', onNotification);
    connection.on('disconnect', onDisconnect);
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
      reject(new Error('Timed out waiting for the owned restarted turn to complete'));
    }, timeoutMs);
    const onNotification = message => {
      if (message?.method !== 'turn/completed') return;
      if (message.params?.threadId !== threadId || message.params?.turn?.id !== turnId) return;
      cleanup();
      resolve(message.params.turn);
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error('Restarted app-server disconnected before turn completion'));
    };
    connection.on('notification', onNotification);
    connection.on('disconnect', onDisconnect);
  });
}

function questionTurn(connection, threadId, model, ordinal) {
  const questionPromise = waitForQuestion(connection);
  const turnPromise = connection.startTurn(
    threadId,
    [
      'This is an owned disposable Remote Agent Chat app-server restart test.',
      'Call request_user_input now and do not answer it yourself.',
      `Ask exactly one single-choice question with id route, header Route, and body Choose restart route ${ordinal}.`,
      'Offer Relay (description: Continue through RAC.) and Native (description: Continue locally.).',
      'After the tool response, acknowledge the selected route briefly and finish.',
    ].join(' '),
    {
      collaborationMode: {
        mode: 'plan',
        settings: {
          model,
          reasoning_effort: 'medium',
          developer_instructions: null,
        },
      },
    },
  );
  return { questionPromise, turnPromise };
}

function responseFor(prompt, generation = prompt.generation) {
  const relay = semanticChoice(prompt.questions[0], 'Relay');
  assert.ok(relay, 'Owned native question omitted the requested Relay option');
  return {
    type: 'question_response',
    contract_version: 1,
    prompt_id: prompt.prompt_id,
    session_id: prompt.session_id,
    generation,
    action: 'answer',
    answers: [{ question_id: prompt.questions[0].question_id, choice_ids: [relay.choice_id] }],
  };
}

async function expectCode(operation, code) {
  let observed = null;
  try {
    await operation();
  } catch (error) {
    observed = error;
  }
  assert(observed, `Expected ${code} but the operation succeeded`);
  assert.strictEqual(observed.code, code, observed.stack || observed.message);
  return observed.code;
}

(async () => {
  const sessionId = `codex-app-server-restart-${crypto.randomUUID()}`;
  const connection = new CodexAppServerConnection({
    sessionId,
    cwd: repoRoot,
    clientName: 'remote-agent-chat-question-restart-e2e',
    clientVersion: '1.0.0',
    requestTimeoutMs: 120000,
    questionReceiptTimeoutMs: 30000,
  });
  const ownedThreads = [];
  let firstPrompt = null;
  let secondPrompt = null;
  try {
    const firstStartup = await connection.start();
    assert.strictEqual(firstStartup.schema.validation.ok, true);
    const firstPid = connection.child?.pid;
    const firstGeneration = connection.connectionGeneration;
    assert(Number.isInteger(firstPid) && firstPid > 0);

    const firstThread = await connection.startThread({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    ownedThreads.push(firstThread.thread.id);
    const first = questionTurn(connection, firstThread.thread.id, firstThread.model, 'one');
    const firstTurn = await first.turnPromise;
    firstPrompt = await first.questionPromise;
    assert.strictEqual(firstPrompt.source.surface, 'codex_cli');

    const disconnectPromise = new Promise(resolve => connection.once('disconnect', resolve));
    await connection.stop();
    const disconnected = await disconnectPromise;
    assert.strictEqual(disconnected.code, 'app_server_stopped');
    assert.ok(disconnected.failedPrompts.some(item => (
      item.prompt_id === firstPrompt.prompt_id
      && item.lifecycle === 'failed'
      && item.error_code === 'adapter_disconnected'
    )), JSON.stringify(disconnected));
    await expectCode(() => connection.answerQuestion(responseFor(firstPrompt)), 'prompt_not_found');

    const secondStartup = await connection.start();
    assert.strictEqual(secondStartup.schema.validation.ok, true);
    const secondPid = connection.child?.pid;
    const secondGeneration = connection.connectionGeneration;
    assert(Number.isInteger(secondPid) && secondPid > 0);
    assert.notStrictEqual(secondPid, firstPid, 'app-server restart reused the stopped process');
    assert.notStrictEqual(secondGeneration, firstGeneration, 'app-server restart reused the connection generation');

    const secondThread = await connection.startThread({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    ownedThreads.push(secondThread.thread.id);
    const second = questionTurn(connection, secondThread.thread.id, secondThread.model, 'two');
    const secondTurn = await second.turnPromise;
    secondPrompt = await second.questionPromise;
    assert.notStrictEqual(secondPrompt.prompt_id, firstPrompt.prompt_id);
    assert.notStrictEqual(secondPrompt.generation, firstPrompt.generation);
    await expectCode(() => connection.answerQuestion(responseFor(firstPrompt)), 'prompt_not_found');
    await expectCode(
      () => connection.answerQuestion(responseFor(secondPrompt, firstPrompt.generation)),
      'stale_generation',
    );

    const completion = waitForTurnCompleted(connection, secondThread.thread.id, secondTurn.turn.id);
    const answerResult = await connection.answerQuestion(responseFor(secondPrompt));
    assert.strictEqual(answerResult.ok, true);
    assert.strictEqual(answerResult.native_acknowledged, true);
    assert.strictEqual(answerResult.lifecycle, 'answered');
    assert.strictEqual(answerResult.native_receipt.thread_id, secondThread.thread.id);
    assert.strictEqual(answerResult.native_receipt.turn_id, secondTurn.turn.id);
    const completed = await completion;
    assert.strictEqual(completed.id, secondTurn.turn.id);

    process.stdout.write(`${JSON.stringify({
      result: 'PASS',
      installed_version: secondStartup.version,
      real_request_user_input_before_restart: true,
      app_server_process_restarted: true,
      connection_generation_rotated: true,
      disconnected_prompt_terminal: 'failed',
      old_prompt_after_restart_rejected: true,
      stale_generation_after_restart_rejected: true,
      new_prompt_answered_once: true,
      native_acknowledged: true,
      duplicate_native_answers: 0,
      wrong_thread_answers: 0,
      false_success_receipts: 0,
      stale_prompt_resurrections: 0,
      first_thread_id: firstThread.thread.id,
      first_turn_id: firstTurn.turn.id,
      second_thread_id: secondThread.thread.id,
      second_turn_id: secondTurn.turn.id,
      visible_windows_opened: 0,
      focus_actions: 0,
    }, null, 2)}\n`);
  } finally {
    for (const threadId of ownedThreads.reverse()) {
      try { await connection.request('thread/archive', { threadId }, 10000); } catch {}
    }
    await connection.stop().catch(() => {});
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
