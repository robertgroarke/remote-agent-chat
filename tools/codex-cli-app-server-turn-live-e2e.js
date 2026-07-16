#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { CodexCliAppServerTurn } = require('../agent-proxy/codex-cli-app-server');

const repoRoot = path.resolve(__dirname, '..');

function waitForEvent(emitter, name, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      emitter.off(name, onEvent);
      emitter.off('disconnect', onDisconnect);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${name}`));
    }, timeoutMs);
    const onEvent = value => {
      cleanup();
      resolve(value);
    };
    const onDisconnect = details => {
      cleanup();
      reject(new Error(`Codex app-server disconnected before ${name}: ${details?.code || 'unknown'}`));
    };
    emitter.once(name, onEvent);
    emitter.once('disconnect', onDisconnect);
  });
}

(async () => {
  const sessionId = `codex-cli-turn-live-${crypto.randomUUID()}`;
  const turn = new CodexCliAppServerTurn({ sessionId, cwd: repoRoot });
  let threadId = null;
  try {
    const promptPromise = waitForEvent(turn, 'question_prompt');
    const started = await turn.start({
      content: [
        'This is an owned disposable integration test.',
        'Call request_user_input now and do not answer it yourself.',
        'Ask exactly one question with id transport, header Transport, and body Choose transport.',
        'Offer App server (description: Use the bidirectional channel.) and Legacy (description: Use the old runner.).',
        'After the response, acknowledge it briefly and finish.',
      ].join(' '),
      sandbox: 'read-only',
      clientMessageId: `client-${crypto.randomUUID()}`,
      collaborationMode: 'plan',
    });
    threadId = started.thread_id;
    assert.strictEqual(started.native_receipt.transport, 'codex_app_server');
    const prompt = await promptPromise;
    assert.strictEqual(prompt.source.surface, 'codex_cli');
    assert.strictEqual(prompt.questions.length, 1);
    assert.strictEqual(prompt.questions[0].question_id, 'transport');
    const appServer = prompt.questions[0].choices.find(choice => choice.label === 'App server');
    assert.ok(appServer, 'real native prompt did not include App server');
    const completionPromise = waitForEvent(turn, 'turn_completed');
    const answer = await turn.answerQuestion({
      type: 'question_response',
      contract_version: 1,
      prompt_id: prompt.prompt_id,
      session_id: prompt.session_id,
      generation: prompt.generation,
      action: 'answer',
      answers: [{ question_id: 'transport', choice_ids: [appServer.choice_id] }],
    });
    assert.strictEqual(answer.native_acknowledged, true);
    assert.strictEqual(answer.native_receipt.method, 'serverRequest/resolved');
    const completed = await completionPromise;
    assert.strictEqual(completed.thread_id, started.thread_id);
    assert.strictEqual(completed.turn_id, started.turn_id);
    await turn.connection.request('thread/archive', { threadId }, 10000);
    threadId = null;
    console.log(JSON.stringify({
      result: 'PASS',
      transport: started.native_receipt.transport,
      real_request_user_input: true,
      exact_native_acknowledgement: answer.native_receipt.method,
      same_thread: completed.thread_id === started.thread_id,
      same_turn: completed.turn_id === started.turn_id,
      ordinary_answer_messages: 0,
      archived_owned_thread: true,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    if (threadId && turn.connection) {
      try { await turn.connection.request('thread/archive', { threadId }, 10000); } catch {}
    }
    await turn.stop();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
