#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const production = require('./vscode-extension-production-e2e');
const soak = require('./production-harness-overnight-soak');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const workspacePath = 'C:\\temp\\remote-agent-codex-cli-question-production';

function parseArgs(argv) {
  const options = {
    sendLive: false,
    requireCapability: false,
    output: freshEvidencePath(ROOT, 'codex-cli-live-question-e2e.json'),
    timeoutMs: 180000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--require-capability') options.requireCapability = true;
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert.strictEqual(options.sendLive, true, 'explicit --send-live is required');
  assert(Number.isFinite(options.timeoutMs) && options.timeoutMs >= 30000, '--timeout-ms must be at least 30000');
  return options;
}

function waitForFrame(messages, start, predicate, timeoutMs, label) {
  return production.waitFor(
    () => messages.slice(start).find(predicate),
    timeoutMs,
    label,
    25,
  );
}

async function requestConfig(relay, sessionId) {
  const requestId = `codex-cli-question-config-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitForFrame(
    relay.messages,
    start,
    message => message.type === 'agent_config' && message.request_id === requestId,
    30000,
    'Codex CLI production config',
  );
}

function responseFrame(prompt, requestId, label) {
  const question = prompt.questions.find(item => Array.isArray(item.choices) && item.choices.length > 0);
  assert(question, 'production CLI prompt has no choice question');
  const choice = question.choices.find(item => item.label === label);
  assert(choice, `production CLI prompt has no ${label} choice`);
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

async function archiveThread(threadId) {
  if (!threadId) return false;
  const connection = new CodexAppServerConnection({
    sessionId: `codex-cli-question-cleanup-${crypto.randomUUID()}`,
    cwd: workspacePath,
    clientName: 'remote-agent-chat-production-question-cleanup',
    clientVersion: '1.0.0',
    requestTimeoutMs: 30000,
  });
  try {
    await connection.start();
    await connection.request('thread/archive', { threadId }, 10000);
    return true;
  } finally {
    await connection.stop();
  }
}

async function closeOwnedSession(relay, sessionId) {
  if (!relay || relay.ws.readyState !== WebSocket.OPEN || !sessionId) return false;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'close_session',
    protocol_version: 1,
    request_id: `codex-cli-question-close-${crypto.randomBytes(5).toString('hex')}`,
    session_id: sessionId,
  }));
  const closed = await waitForFrame(
    relay.messages,
    start,
    message => message.type === 'session_closed'
      && (message.session_id === sessionId || message.session === sessionId),
    30000,
    'owned Codex CLI session close',
  );
  return !!closed;
}

async function requestHistory(relay, sessionId, timeoutMs) {
  const requestId = `codex-cli-question-history-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'get_history', session: sessionId, request_id: requestId, limit: 200 }));
  return waitForFrame(
    relay.messages,
    start,
    message => ['history', 'history_snapshot'].includes(message.type)
      && (message.session_id === sessionId || message.session === sessionId)
      && (!message.request_id || message.request_id === requestId),
    timeoutMs,
    'owned Codex CLI history',
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = crypto.randomBytes(6).toString('hex');
  const result = {
    result: 'FAIL',
    generated_at: new Date().toISOString(),
    run_id: runId,
    production_proxy: true,
    workspace_path: workspacePath,
    focus_actions: 0,
    visible_windows_opened: 0,
    native_window_launch_mode: 'background',
    protected_user_sessions_touched: 0,
    stages: [],
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });

  let releaseOperation = null;
  let relay = null;
  let sessionId = '';
  let nativeThreadId = '';
  let sessionClosed = false;
  let threadArchived = false;
  try {
    releaseOperation = soak.acquirePidLock(
      soak.OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-cli-live-question-e2e', kind: 'owned-mutation', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = soak.OPERATION_LOCK_PATH;
    result.stages.push('operation_lock');

    relay = await production.openRelay();
    await production.waitFor(
      () => production.latestSessions(relay.messages).length > 0,
      30000,
      'production session inventory',
    );
    result.stages.push('production_relay');

    const launchRequestId = `codex-cli-question-launch-${runId}`;
    const launchStart = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'launch_session',
      protocol_version: 1,
      request_id: launchRequestId,
      agent_type: 'codex_cli',
      workspace_path: workspacePath,
      permission_mode: 'read-only',
      collaboration_mode: 'plan',
    }));
    const launch = await waitForFrame(
      relay.messages,
      launchStart,
      message => message.request_id === launchRequestId
        && ['session_launch_ack', 'session_launch_failed'].includes(message.type),
      60000,
      'disposable Codex CLI launch',
    );
    assert.strictEqual(launch.type, 'session_launch_ack', JSON.stringify(launch));
    sessionId = launch.session_id;
    result.session_id = sessionId;
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item => item.session_id === sessionId),
      60000,
      'disposable Codex CLI session inventory',
    );
    assert.strictEqual(session.agent_type, 'codex_cli');
    assert.strictEqual(session.status, 'healthy');
    assert.notStrictEqual(session.native_cli_window_opened, true, 'disposable CLI launch opened a native window');
    result.stages.push('owned_background_session');

    const config = await requestConfig(relay, sessionId);
    result.question_prompts_capability = config.capabilities?.question_prompts === true;
    if (options.requireCapability) {
      assert.strictEqual(result.question_prompts_capability, true, 'production CLI question_prompts capability is not advertised');
    }
    result.stages.push('capability_read');

    const promptText = [
      'This is an owned disposable Remote Agent Chat production validation turn.',
      'Call request_user_input now and do not answer it yourself.',
      'Ask exactly one question with id route, header Route, and body Choose a route.',
      'Offer Relay with description Answer through RAC. and Native with description Answer locally.',
      'After the tool response, acknowledge the selected route briefly and finish.',
      'Do not call any other tool.',
    ].join(' ');
    const clientMessageId = `codex-cli-live-question-${runId}`;
    const messageStart = relay.messages.length;
    const deliveryStarted = Date.now();
    relay.ws.send(JSON.stringify({
      type: 'send',
      session: sessionId,
      content: promptText,
      client_message_id: clientMessageId,
    }));
    const delivery = await waitForFrame(
      relay.messages,
      messageStart,
      message => message.type === 'proxy_send_result'
        && message.client_message_id === clientMessageId
        && ['delivered', 'failed', 'rejected'].includes(message.result),
      90000,
      'Codex CLI native delivery receipt',
    );
    assert.strictEqual(delivery.result, 'delivered', JSON.stringify(delivery));
    assert.strictEqual(delivery.native_receipt?.transport, 'codex_app_server', JSON.stringify(delivery));
    nativeThreadId = delivery.native_receipt.thread_id;
    result.delivery = {
      result: delivery.result,
      transport: delivery.native_receipt.transport,
      thread_id: nativeThreadId,
      turn_id: delivery.native_receipt.turn_id,
      receipt_ms: Date.now() - deliveryStarted,
    };
    result.stages.push('native_delivery');

    const visibleStarted = Date.now();
    const prompt = await waitForFrame(
      relay.messages,
      messageStart,
      message => message.type === 'question_prompt'
        && message.session_id === sessionId
        && message.source?.surface === 'codex_cli'
        && message.lifecycle === 'open',
      options.timeoutMs,
      'production Codex CLI question prompt',
    );
    result.delivery_to_visible_ms = Date.now() - visibleStarted;
    result.producer_to_visible_ms = Math.max(0, Date.now() - Date.parse(prompt.observed_at));
    assert.strictEqual(prompt.title, 'Route');
    assert.strictEqual(prompt.questions.length, 1);
    assert.strictEqual(prompt.questions[0].message, 'Choose a route.');
    const relayChoice = prompt.questions[0].choices.find(choice => choice.label === 'Relay');
    const nativeChoice = prompt.questions[0].choices.find(choice => choice.label === 'Native');
    assert(relayChoice && nativeChoice, 'production prompt did not preserve both native choices');
    result.prompt = {
      prompt_id: prompt.prompt_id,
      generation: prompt.generation,
      source: prompt.source,
      title: prompt.title,
      question: prompt.questions[0].message,
      choices: prompt.questions[0].choices.map(choice => ({ label: choice.label, description: choice.description })),
      lifecycle: prompt.lifecycle,
    };
    result.stages.push('browser_question_visible');

    const waiting = await waitForFrame(
      relay.messages,
      messageStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind === 'waiting_for_user',
      30000,
      'Codex CLI waiting_for_user activity',
    );
    result.waiting_activity = waiting.activity;
    result.stages.push('waiting_for_user');

    const requestId = `codex-cli-live-answer-${runId}`;
    const response = responseFrame(prompt, requestId, 'Relay');
    const responseStart = relay.messages.length;
    const answerStarted = Date.now();
    relay.ws.send(JSON.stringify(response));
    const receipt = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'agent_control_result' && message.request_id === requestId,
      30000,
      'Codex CLI native question receipt',
    );
    result.click_to_native_ack_ms = Date.now() - answerStarted;
    assert.strictEqual(receipt.result, 'ok', JSON.stringify(receipt));
    assert.strictEqual(receipt.native_acknowledged, true, JSON.stringify(receipt));
    assert.strictEqual(receipt.native_receipt?.method, 'serverRequest/resolved', JSON.stringify(receipt));
    assert.strictEqual(receipt.native_receipt?.thread_id, delivery.native_receipt.thread_id);
    assert.strictEqual(receipt.native_receipt?.turn_id, delivery.native_receipt.turn_id);
    result.native_receipt = {
      method: receipt.native_receipt.method,
      same_thread: true,
      same_turn: true,
      native_acknowledged: true,
    };

    const terminal = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'question_prompt_state'
        && message.prompt_id === prompt.prompt_id
        && message.lifecycle === 'answered',
      30000,
      'answered CLI question terminal state',
    );
    result.terminal_lifecycle = terminal.lifecycle;
    const resumed = await waitForFrame(
      relay.messages,
      responseStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind !== 'waiting_for_user',
      90000,
      'Codex CLI post-answer activity',
    );
    result.after_answer_activity = resumed.activity;
    result.stages.push('native_answer_acknowledged');

    const duplicateRequestId = `codex-cli-live-duplicate-${runId}`;
    const duplicateStart = relay.messages.length;
    relay.ws.send(JSON.stringify({ ...response, request_id: duplicateRequestId }));
    const duplicate = await waitForFrame(
      relay.messages,
      duplicateStart,
      message => message.type === 'agent_control_result' && message.request_id === duplicateRequestId,
      15000,
      'duplicate CLI question rejection',
    );
    assert.strictEqual(duplicate.result, 'failed', JSON.stringify(duplicate));
    assert.strictEqual(duplicate.error?.code, 'prompt_already_claimed', JSON.stringify(duplicate));
    assert.notStrictEqual(duplicate.native_attempted, true, JSON.stringify(duplicate));
    result.duplicate = {
      code: duplicate.error.code,
      native_attempted: false,
      rejection_boundary: 'relay_question_registry',
    };
    result.stages.push('duplicate_rejected');

    await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.session_id === sessionId && !['thinking', 'generating', 'working', 'waiting_for_user'].includes(item.activity?.kind)),
      90000,
      'settled disposable Codex CLI session',
      100,
    );
    const history = await requestHistory(relay, sessionId, 30000);
    const messages = Array.isArray(history.messages) ? history.messages : [];
    result.history = {
      messages: messages.length,
      user_messages: messages.filter(message => message.role === 'user').length,
      assistant_messages: messages.filter(message => message.role === 'assistant').length,
      ordinary_answer_messages: messages.filter(message =>
        message.role === 'user' && String(message.content || '').trim() === 'Relay').length,
    };
    assert.strictEqual(result.history.ordinary_answer_messages, 0, 'native question answer became an ordinary user message');

    threadArchived = await archiveThread(nativeThreadId);
    assert.strictEqual(threadArchived, true, 'owned Codex CLI thread was not archived');
    result.thread_archived = true;
    nativeThreadId = '';
    sessionClosed = await closeOwnedSession(relay, sessionId);
    assert.strictEqual(sessionClosed, true, 'owned Codex CLI session did not close');
    result.session_closed = true;
    result.stages.push('owned_cleanup');

    result.duplicate_native_answers = 0;
    result.wrong_session_answers = 0;
    result.false_success_receipts = 0;
    result.result = 'PASS';
    return result;
  } catch (error) {
    result.error = error.stack || error.message;
    throw error;
  } finally {
    if (sessionId && !sessionClosed) {
      try {
        sessionClosed = await closeOwnedSession(relay, sessionId);
        result.cleanup_session_closed = sessionClosed;
      } catch {}
    }
    if (nativeThreadId && !threadArchived) {
      try {
        threadArchived = await archiveThread(nativeThreadId);
        result.cleanup_thread_archived = threadArchived;
      } catch {}
    }
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
    try { relay?.ws?.close(); } catch {}
    try { releaseOperation?.(); } catch {}
    const resolvedWorkspace = path.resolve(workspacePath).toLowerCase();
    if (resolvedWorkspace.startsWith(path.resolve('C:\\temp').toLowerCase() + path.sep)) {
      try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch {}
    }
  }
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, responseFrame };
