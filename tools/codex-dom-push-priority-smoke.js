#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-dom-push-priority-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const selectors = require('../agent-proxy/selectors');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

async function main() {
  const priorNewChat = selectors.newCodexChat;
  try {
    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    engine._running = true;
    engine._domPushSecondaryDelayMs = 25;
    engine._domPush.notePoll = () => {};
    engine._sendToRelay = () => true;

    const sessionId = 'codex-dom-push-priority';
    engine.sessions.set(sessionId, {
      session_id: sessionId,
      agentType: 'codex',
      client: { Runtime: {} },
      status: 'healthy',
      messageQueue: [],
    });

    let questionOpen = false;
    let questionPolls = 0;
    const slowTranscript = deferred();
    let transcriptPolls = 0;
    let permissionPolls = 0;
    engine._pollCodexVsCodeQuestionBounded = async () => { questionPolls += 1; };
    engine._hasOpenCodexVsCodeQuestion = () => questionOpen;
    engine._hasOpenCodexDesktopQuestion = () => false;
    engine._pollSessionBounded = async () => {
      transcriptPolls += 1;
      if (transcriptPolls === 1) await slowTranscript.promise;
    };
    engine._pollPermissionsBounded = async () => { permissionPolls += 1; };

    await engine._handleDomPush(sessionId, { executionContextId: 7, sourceAt: Date.now() });
    await waitFor(() => transcriptPolls === 1, 'quiet-period transcript poll did not start');

    questionOpen = true;
    const secondQuestion = engine._handleDomPush(sessionId, { executionContextId: 9, sourceAt: Date.now() });
    await Promise.race([
      secondQuestion,
      new Promise((_, reject) => setTimeout(() => reject(new Error('question lane blocked behind transcript poll')), 100)),
    ]);
    assert.strictEqual(questionPolls, 2, 'later question signal did not enter the fast lane');
    assert.strictEqual(permissionPolls, 0, 'secondary permission read ran while a question was open');

    slowTranscript.resolve();
    await waitFor(() => engine._domPushSecondaryPollInFlight.size === 0, 'slow transcript poll did not settle');

    questionOpen = false;
    engine.sessions.get(sessionId)._vscodeQuestionRemotePollUntil = Date.now() + 10000;
    await engine._handleDomPush(sessionId, { executionContextId: 11, sourceAt: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(transcriptPolls, 1,
      'post-send native-question watch allowed a secondary transcript read');
    engine.sessions.get(sessionId)._vscodeQuestionRemotePollUntil = 0;

    const newChatGate = deferred();
    selectors.newCodexChat = async () => {
      await newChatGate.promise;
      return true;
    };
    engine._scheduleDomPushSecondaryPoll(sessionId);
    const newChat = engine._handleRelayMessage({
      type: 'new_chat',
      session_id: sessionId,
      request_id: 'priority-new-chat',
    });
    assert.strictEqual(engine._priorityControlInFlight, 1, 'new_chat did not claim the priority lane');
    assert.strictEqual(engine.sessions.get(sessionId)._priorityControlInFlight, 1,
      'new_chat did not claim the session-scoped CDP control lane');
    assert.strictEqual(engine._domPushSecondaryPollTimers.has(sessionId), false,
      'priority control did not cancel the pending secondary poll');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(transcriptPolls, 1, 'secondary poll started during priority new_chat');
    newChatGate.resolve();
    await newChat;
    assert.strictEqual(engine._priorityControlInFlight, 0, 'priority lane was not released after new_chat');
    assert.strictEqual(engine.sessions.get(sessionId)._priorityControlInFlight, 0,
      'session-scoped CDP control lane was not released after new_chat');

    const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
    assert(proxySource.includes('Codex poll exceeded ${timeoutMs}ms during a priority control; retaining the shared CDP client'),
      'Codex poll timeout still closes the shared CDP client during a priority control');
    assert(proxySource.includes("this._isCodexSurface(session.agentType) && session._pollInProgress"),
      'VS Code Codex in-flight polls have no hard-stuck recovery path');

    engine.stop();
    assert.strictEqual(engine._domPushSecondaryPollTimers.size, 0, 'secondary timers survived engine stop');
    assert.strictEqual(engine._domPushSecondaryPollInFlight.size, 0, 'secondary in-flight state survived engine stop');

    process.stdout.write(JSON.stringify({
      ok: true,
      question_fast_lane_while_transcript_in_flight: true,
      post_send_question_lane_exclusive: true,
      priority_control_cancels_secondary_poll: true,
      priority_control_lifetime_tracked: true,
      priority_control_session_cdp_lifetime_tracked: true,
      codex_poll_timeout_retains_control_socket: true,
      stop_cleanup: true,
    }, null, 2) + '\n');
  } finally {
    selectors.newCodexChat = priorNewChat;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
