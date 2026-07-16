#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { CodexCliAppServerTurn } = require('../agent-proxy/codex-cli-app-server');

class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.stops = 0;
  }

  async start() {
    this.calls.push(['start']);
    return { version: 'test-version' };
  }

  async resumeThread(threadId, params) {
    this.calls.push(['resumeThread', threadId, params]);
    return { thread: { id: threadId, path: 'C:\\owned\\rollout.jsonl' }, model: params.model };
  }

  async startThread(params) {
    this.calls.push(['startThread', params]);
    return { thread: { id: 'thread-new', path: 'C:\\owned\\new.jsonl' }, model: params.model };
  }

  async startTurn(threadId, content, params) {
    this.calls.push(['startTurn', threadId, content, params]);
    return { turn: { id: 'turn-owned' } };
  }

  async answerQuestion(response) {
    this.calls.push(['answerQuestion', response]);
    return { ok: true, native_acknowledged: true, lifecycle: 'answered' };
  }

  async request(method, params) {
    this.calls.push(['request', method, params]);
    return { ok: true };
  }

  async stop() {
    this.stops += 1;
    this.emit('disconnect', { code: 'app_server_stopped' });
  }
}

(async () => {
  const connection = new FakeConnection();
  const turn = new CodexCliAppServerTurn({
    sessionId: 'rac-session',
    cwd: 'C:\\workspace',
    connectionFactory: () => connection,
  });
  const prompts = [];
  const completions = [];
  const disconnects = [];
  turn.on('question_prompt', prompt => prompts.push(prompt));
  turn.on('turn_completed', completion => completions.push(completion));
  turn.on('disconnect', details => disconnects.push(details));

  const started = await turn.start({
    threadId: 'thread-existing',
    content: 'Owned prompt',
    model: 'gpt-test',
    effort: 'high',
    sandbox: 'workspace-write',
    clientMessageId: 'client-message',
  });
  assert.strictEqual(started.thread_id, 'thread-existing');
  assert.strictEqual(started.turn_id, 'turn-owned');
  assert.strictEqual(started.native_receipt.transport, 'codex_app_server');
  assert.deepStrictEqual(connection.calls[1], ['resumeThread', 'thread-existing', {
    approvalPolicy: 'never', model: 'gpt-test', sandbox: 'workspace-write',
  }]);
  assert.deepStrictEqual(connection.calls[2], ['startTurn', 'thread-existing', 'Owned prompt', {
    approvalPolicy: 'never', model: 'gpt-test', effort: 'high', clientUserMessageId: 'client-message',
  }]);

  connection.emit('question_prompt', { prompt_id: 'prompt-owned' });
  assert.deepStrictEqual(prompts, [{ prompt_id: 'prompt-owned' }]);
  const answer = await turn.answerQuestion({ prompt_id: 'prompt-owned' });
  assert.strictEqual(answer.native_acknowledged, true);
  await turn.interrupt();
  assert.deepStrictEqual(connection.calls.at(-1), ['request', 'turn/interrupt', {
    threadId: 'thread-existing', turnId: 'turn-owned',
  }]);

  connection.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'different-thread', turn: { id: 'turn-owned', status: 'completed' } },
  });
  assert.strictEqual(completions.length, 0);
  connection.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread-existing', turn: { id: 'turn-owned', status: 'completed' } },
  });
  assert.deepStrictEqual(completions, [{
    thread_id: 'thread-existing', turn_id: 'turn-owned', status: 'completed',
  }]);
  await turn.stop();
  assert.strictEqual(connection.stops, 1);
  assert.strictEqual(disconnects.at(-1).expected, true);

  const newConnection = new FakeConnection();
  const newTurn = new CodexCliAppServerTurn({
    sessionId: 'rac-new', cwd: 'C:\\workspace', connectionFactory: () => newConnection,
  });
  await newTurn.start({ content: 'New owned prompt', sandbox: 'invalid-mode' });
  assert.deepStrictEqual(newConnection.calls[1], ['startThread', {
    approvalPolicy: 'never', ephemeral: false,
  }]);
  await newTurn.stop();

  console.log(JSON.stringify({
    result: 'PASS',
    resume_owned: true,
    new_thread_persistent: true,
    approval_policy: 'never',
    exact_turn_completion: true,
    question_channel_preserved: true,
    exact_interrupt: true,
    expected_disconnect_classified: true,
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
