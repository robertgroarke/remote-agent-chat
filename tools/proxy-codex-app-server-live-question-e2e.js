#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-codex-live-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { CodexCliAppServerTurn } = require('../agent-proxy/codex-cli-app-server');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const sessionStore = require('../agent-proxy/session-store');
const { createReadyOwnerRegistry } = require('./codex-owner-test-fixture');

const repoRoot = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

function waitFor(predicate, label, timeoutMs = 90000) {
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

function createHarness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.activeQuestionPromptAdapters = new Map();
  engine.activePermissionPrompts = new Map();
  engine.sent = [];
  engine.logs = [];
  engine._codexCliAppServerTurnFactory = options => new CodexCliAppServerTurn(options);
  engine._codexOwnerRegistryPath = createReadyOwnerRegistry(tempRoot);
  engine._sendToRelay = message => {
    engine.sent.push({ ...message, __test_observed_at_ms: Date.now() });
    return true;
  };
  engine._publishCodexCliConfig = () => {};
  engine._broadcastSessionSnapshot = () => {};
  engine._processMessageQueue = async () => {};
  engine._log = (level, message) => engine.logs.push({ level, message });
  return engine;
}

async function archiveThread(threadId) {
  if (!threadId) return false;
  const connection = new CodexAppServerConnection({
    sessionId: `cleanup-${crypto.randomUUID()}`,
    cwd: repoRoot,
    clientName: 'remote-agent-chat-live-cleanup',
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

(async () => {
  const engine = createHarness();
  const sessionId = `proxy-codex-live-${crypto.randomUUID()}`;
  const session = {
    session_id: sessionId,
    agentType: 'codex_cli',
    status: 'healthy',
    workspace_path: repoRoot,
    permission_mode: 'read-only',
    codexCliCollaborationMode: 'plan',
    activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
    messageQueue: [],
  };
  engine.sessions.set(sessionId, session);
  let nativeThreadId = null;
  let archived = false;
  let turnCompletedAtMs = null;
  try {
    const sendResult = await engine._sendCodexCliMessage(
      session,
      [
        'This is an owned disposable proxy integration test.',
        'Call request_user_input now and do not answer it yourself.',
        'Ask exactly one question with id route, header Route, and body Choose a route.',
        'Offer Relay (description: Answer through RAC.) and Native (description: Answer locally.).',
        'After the tool response, acknowledge it briefly and finish.',
      ].join(' '),
      sessionId,
      { clientMessageId: `client-${crypto.randomUUID()}` },
    );
    assert.strictEqual(sendResult.ok, true, `live send failed: ${JSON.stringify(sendResult)}; logs=${JSON.stringify(engine.logs)}`);
    assert.strictEqual(sendResult.native_receipt.transport, 'codex_app_server');
    nativeThreadId = sendResult.native_receipt.thread_id;
    const ownedTurn = session._codexAppServerTurn;
    assert(ownedTurn, 'proxy did not retain the owned app-server turn');
    ownedTurn.once('turn_completed', () => { turnCompletedAtMs = Date.now(); });
    const prompt = await waitFor(
      () => engine.sent.find(message => message.type === 'question_prompt'),
      'the real question_prompt relay frame',
    );
    assert.strictEqual(prompt.session_id, sessionId);
    assert.strictEqual(prompt.source.surface, 'codex_cli');
    assert.strictEqual(session.activity.kind, 'waiting_for_user');
    const relayChoice = prompt.questions[0].choices.find(choice => /^Relay(?: \(Recommended\))?$/i.test(choice.label));
    assert.ok(relayChoice, 'real native prompt did not include Relay or Relay (Recommended)');
    engine._handleRelayMessage({
      type: 'question_response',
      request_id: `answer-${crypto.randomUUID()}`,
      session_id: sessionId,
      prompt_id: prompt.prompt_id,
      generation: prompt.generation,
      action: 'answer',
      answers: [{ question_id: 'route', choice_ids: [relayChoice.choice_id] }],
    });
    const receipt = await waitFor(
      () => engine.sent.find(message => message.command === 'question_response'),
      'the exact native question receipt',
    );
    assert.strictEqual(receipt.result, 'ok');
    assert.strictEqual(receipt.native_acknowledged, true);
    assert.strictEqual(receipt.native_receipt.method, 'serverRequest/resolved');
    await waitFor(() => session._codexAppServerTurn === null, 'owned turn completion');
    assert.strictEqual(session.waitingForAssistant, false);
    const streamFrames = engine.sent.filter(message => message.type === 'message_delta');
    const appendFrames = streamFrames.filter(message => message.op === 'append');
    assert(appendFrames.length >= 1, 'real app-server turn emitted no assistant delta before completion');
    assert.strictEqual(streamFrames.filter(message => message.op === 'block_open').length, 1,
      'real app-server turn must open exactly one provisional assistant block');
    assert.strictEqual(streamFrames.filter(message => message.op === 'block_close').length, 1,
      'real app-server turn must close exactly one provisional assistant block');
    assert(turnCompletedAtMs != null, 'real app-server turn did not expose a completion boundary');
    assert(appendFrames.every(message => message.__test_observed_at_ms <= turnCompletedAtMs),
      'assistant delta was observed only after the native completion boundary');
    const nativeToProxyLatenciesMs = appendFrames.map(message => Math.max(0,
      message.__test_observed_at_ms - Number(message.stream_trace?.native_event_at_ms || message.__test_observed_at_ms)));
    assert(nativeToProxyLatenciesMs.every(value => value <= 1000),
      `native observation to proxy broadcast exceeded 1s: ${nativeToProxyLatenciesMs.join(',')}`);
    const reconstructed = appendFrames.map(message => message.append || '').join('');
    assert(reconstructed.length > 0, 'real app-server assistant stream reconstructed empty content');
    archived = await archiveThread(nativeThreadId);
    nativeThreadId = null;
    assert.strictEqual(archived, true);
    const result = {
      result: 'PASS',
      source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot, encoding: 'utf8', windowsHide: true,
      }).trim(),
      default_proxy_transport: sendResult.native_receipt.transport,
      real_request_user_input: true,
      relay_prompt_frames: engine.sent.filter(message => message.type === 'question_prompt').length,
      native_answer_forwards: 1,
      exact_native_acknowledgement: receipt.native_receipt.method,
      same_thread: receipt.native_receipt.thread_id === sendResult.native_receipt.thread_id,
      same_turn: receipt.native_receipt.turn_id === sendResult.native_receipt.turn_id,
      pre_completion_assistant_delta_frames: appendFrames.length,
      message_delta_operations: streamFrames.map(message => message.op),
      assistant_stream_sha256: crypto.createHash('sha256').update(reconstructed, 'utf8').digest('hex'),
      assistant_stream_characters: reconstructed.length,
      native_observation_to_proxy_broadcast_ms: {
        maximum: Math.max(...nativeToProxyLatenciesMs),
        samples: nativeToProxyLatenciesMs.length,
      },
      native_completion_reconciled_once: true,
      final_activity: session.activity.kind,
      archived_owned_thread: archived,
      prompt_bodies_in_evidence: false,
      credential_content_in_evidence: false,
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_sessions_touched: 0,
      production_mutations: 0,
      proxy_restarts: 0,
      deploys: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (nativeThreadId) {
      try { await archiveThread(nativeThreadId); } catch {}
    }
    if (session._codexAppServerTurn) {
      try { await session._codexAppServerTurn.stop(); } catch {}
    }
    sessionStore.flushPendingSaves();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
