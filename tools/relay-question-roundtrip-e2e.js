#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { canonicalQuestionPrompt, canonicalQuestionResponse } = require('../shared/question-prompt-contract');

const repoRoot = path.resolve(__dirname, '..');
const secretAnswer = 'relay-e2e-secret-must-not-persist';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

class Messages {
  constructor(ws) {
    this.frames = [];
    this.waiters = [];
    ws.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      this.frames.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
  }

  wait(predicate, timeoutMs = 5000) {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for WebSocket frame`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  count(predicate) {
    return this.frames.filter(predicate).length;
  }
}

function openSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    const onError = error => reject(error);
    ws.once('error', onError);
    ws.once('open', () => {
      ws.off('error', onError);
      resolve({ ws, messages: new Messages(ws) });
    });
  });
}

function closeSocket(ws) {
  return new Promise(resolve => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve();
    }, 1000);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    try { ws.close(); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function waitForListening(child, output, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (/Listening/.test(output.value)) return resolve();
      if (child.exitCode != null) return reject(new Error(`relay exited ${child.exitCode}: ${output.value}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`relay startup timed out: ${output.value}`));
      setTimeout(check, 25);
    };
    check();
  });
}

async function authenticateProxy(port, proxySecret, proxyId) {
  const socket = await openSocket(`ws://127.0.0.1:${port}/proxy-ws`);
  socket.ws.send(JSON.stringify({
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'proxy',
    client_name: 'question-e2e-proxy',
    client_version: '1',
    machine_label: 'question-e2e',
    proxy_id: proxyId,
    secret: proxySecret,
  }));
  await socket.messages.wait(message => message.type === 'connection_ack');
  return socket;
}

async function openClient(port, clientName = 'web') {
  const socket = await openSocket(`ws://127.0.0.1:${port}/client-ws`, {
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      'User-Agent': clientName === 'android'
        ? 'RemoteAgentChat-Android-FaultMatrix/1'
        : 'RemoteAgentChat-Web-FaultMatrix/1',
      'X-RAC-Fault-Client': clientName,
    },
  });
  const ack = await socket.messages.wait(message => message.type === 'connection_ack');
  return { ...socket, ack, clientName };
}

async function openBrowser(port) {
  return openClient(port, 'web');
}

async function openAndroid(port) {
  return openClient(port, 'android');
}

function registerSession(proxy, sessionId) {
  proxy.ws.send(JSON.stringify({
    type: 'proxy_session_snapshot',
    protocol_version: 1,
    proxy_id: 'question-e2e-proxy',
    sessions: [{
      session_id: sessionId,
      agent_type: 'codex_cli',
      workspace_name: 'Question E2E',
      status: 'healthy',
    }],
  }));
}

function question(sessionId, promptId, generation, options = {}) {
  return canonicalQuestionPrompt({
    prompt_id: promptId,
    session_id: sessionId,
    generation,
    kind: 'request_user_input',
    source: { surface: 'codex_cli', version: '0.144.4-e2e' },
    title: 'Relay E2E question',
    questions: [
      {
        id: 'choice', header: 'Choice', question: 'Choose one.',
        options: [
          { id: 'yes', label: 'Yes', description: 'Continue.' },
          { id: 'no', label: 'No', description: 'Stop.' },
        ],
      },
      {
        id: 'secret', header: 'Secret', question: 'Enter a disposable secret.',
        options: null, isSecret: true,
      },
    ],
    cancel_supported: options.cancel_supported === true,
  });
}

function answer(prompt, requestId) {
  return {
    type: 'question_response',
    protocol_version: 1,
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    answers: [
      { question_id: 'choice', choice_ids: [prompt.questions[0].choices[0].choice_id] },
      { question_id: 'secret', text: secretAnswer },
    ],
  };
}

function directoryContains(root, needle) {
  const bytes = Buffer.from(needle, 'utf8');
  const visit = current => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        if (visit(full)) return true;
      } else if (fs.readFileSync(full).includes(bytes)) return true;
    }
    return false;
  };
  return visit(root);
}

(async () => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-question-relay-e2e-'));
  const proxySecret = 'question-e2e-proxy-secret';
  const output = { value: '' };
  const child = spawn(process.execPath, [path.join(repoRoot, 'relay-server', 'index.js')], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'question-e2e-session-secret-with-more-than-thirty-two-characters',
      GOOGLE_CLIENT_ID: 'question-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'question-e2e-client-secret',
      PROXY_SECRET: proxySecret,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      ALLOWED_EMAIL: 'question-e2e@example.invalid',
    },
  });
  child.stdout.on('data', chunk => { output.value += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { output.value += chunk.toString('utf8'); });

  const sockets = [];
  try {
    await waitForListening(child, output);
    const sessionId = 'question-e2e-session';
    const proxy = await authenticateProxy(port, proxySecret, 'question-e2e-proxy');
    sockets.push(proxy.ws);
    registerSession(proxy, sessionId);

    const browserA = await openBrowser(port);
    const browserB = await openBrowser(port);
    const android = await openAndroid(port);
    sockets.push(browserA.ws, browserB.ws, android.ws);
    const launchRequestId = 'question-e2e-plan-launch';
    browserA.ws.send(JSON.stringify({
      type: 'launch_session',
      protocol_version: 1,
      request_id: launchRequestId,
      agent_type: 'codex_cli',
      workspace_path: dataDir,
      collaboration_mode: 'plan',
    }));
    const forwardedLaunch = await proxy.messages.wait(message =>
      message.type === 'launch_session' && message.request_id === launchRequestId);
    assert.strictEqual(forwardedLaunch.collaboration_mode, 'plan');
    proxy.ws.send(JSON.stringify({
      type: 'session_launch_failed',
      protocol_version: 1,
      request_id: launchRequestId,
      agent_type: 'codex_cli',
      error_code: 'fixture_complete',
      reason: 'Relay Plan passthrough fixture complete',
    }));
    await browserA.messages.wait(message =>
      message.type === 'session_launch_failed' && message.request_id === launchRequestId);
    const prompt = question(sessionId, 'question-e2e-prompt-001', 'question-e2e-generation-001');
    proxy.ws.send(JSON.stringify(prompt));
    const visibleA = await browserA.messages.wait(message => message.type === 'question_prompt' && message.prompt_id === prompt.prompt_id);
    const visibleB = await browserB.messages.wait(message => message.type === 'question_prompt' && message.prompt_id === prompt.prompt_id);
    const visibleAndroid = await android.messages.wait(message => message.type === 'question_prompt' && message.prompt_id === prompt.prompt_id);
    assert.strictEqual(visibleA.lifecycle, 'open');
    assert.strictEqual(visibleB.lifecycle, 'open');
    assert.strictEqual(visibleAndroid.lifecycle, 'open');
    assert.ok(!JSON.stringify(visibleA).includes(secretAnswer));

    android.ws.send(JSON.stringify({
      ...answer(visibleAndroid, 'question-e2e-response-stale-generation'),
      generation: `${visibleAndroid.generation}-stale`,
    }));
    const staleGenerationFailure = await android.messages.wait(message => (
      message.command === 'question_response'
      && message.request_id === 'question-e2e-response-stale-generation'
    ));
    assert.strictEqual(staleGenerationFailure.result, 'failed');
    assert.strictEqual(staleGenerationFailure.error.code, 'stale_generation');

    browserA.ws.send(JSON.stringify(answer(visibleA, 'question-e2e-response-a')));
    browserA.ws.send(JSON.stringify(answer(visibleA, 'question-e2e-response-a-duplicate-click')));
    browserB.ws.send(JSON.stringify(answer(visibleB, 'question-e2e-response-b')));
    android.ws.send(JSON.stringify(answer(visibleAndroid, 'question-e2e-response-android')));
    const forwarded = await proxy.messages.wait(message => message.type === 'question_response' && message.prompt_id === prompt.prompt_id);
    assert.strictEqual(forwarded.answers[1].text, secretAnswer);

    await new Promise(resolve => setTimeout(resolve, 200));
    const raceRequestIds = new Set([
      'question-e2e-response-a',
      'question-e2e-response-a-duplicate-click',
      'question-e2e-response-b',
      'question-e2e-response-android',
    ]);
    const raceFailures = [browserA, browserB, android].flatMap(client => client.messages.frames.filter(message => (
      message.command === 'question_response'
      && message.result === 'failed'
      && raceRequestIds.has(message.request_id)
    )));
    assert.strictEqual(raceFailures.length, 3, JSON.stringify(raceFailures));
    raceFailures.forEach(failure => assert.ok(
      ['prompt_already_claimed', 'duplicate_request_id'].includes(failure.error.code),
      JSON.stringify(failure),
    ));

    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result',
      protocol_version: 1,
      request_id: forwarded.request_id,
      session_id: sessionId,
      command: 'question_response',
      result: 'ok',
      native_acknowledged: true,
      lifecycle: 'answered',
    }));
    const terminalA = await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === prompt.prompt_id
      && message.lifecycle === 'answered'
    ));
    const terminalB = await browserB.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === prompt.prompt_id
      && message.lifecycle === 'answered'
    ));
    const terminalAndroid = await android.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === prompt.prompt_id
      && message.lifecycle === 'answered'
    ));
    assert.ok(!JSON.stringify(terminalA).includes(secretAnswer));
    assert.ok(!JSON.stringify(terminalB).includes(secretAnswer));
    assert.ok(!JSON.stringify(terminalAndroid).includes(secretAnswer));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.strictEqual(proxy.messages.count(message => message.type === 'question_response' && message.prompt_id === prompt.prompt_id), 1);

    // Native frames may be duplicated or arrive after the terminal receipt.
    // They must never resurrect the question or create another native answer.
    proxy.ws.send(JSON.stringify(prompt));
    proxy.ws.send(JSON.stringify(prompt));
    await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === prompt.prompt_id
      && message.lifecycle === 'answered'
    ));

    const cancelPrompt = question(
      sessionId,
      'question-e2e-prompt-cancel-001',
      'question-e2e-generation-cancel-001',
      { cancel_supported: true },
    );
    proxy.ws.send(JSON.stringify(cancelPrompt));
    const visibleCancel = await browserA.messages.wait(message =>
      message.type === 'question_prompt' && message.prompt_id === cancelPrompt.prompt_id);
    browserA.ws.send(JSON.stringify({
      type: 'question_response',
      protocol_version: 1,
      request_id: 'question-e2e-response-cancel',
      session_id: visibleCancel.session_id,
      prompt_id: visibleCancel.prompt_id,
      generation: visibleCancel.generation,
      action: 'cancel',
    }));
    const forwardedCancel = await proxy.messages.wait(message =>
      message.type === 'question_response' && message.prompt_id === cancelPrompt.prompt_id);
    assert.strictEqual(forwardedCancel.action, 'cancel');
    assert.strictEqual(Object.hasOwn(forwardedCancel, 'answers'), false);
    assert.deepStrictEqual(
      canonicalQuestionResponse(cancelPrompt, forwardedCancel),
      canonicalQuestionResponse(cancelPrompt, canonicalQuestionResponse(cancelPrompt, forwardedCancel)),
    );
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result',
      protocol_version: 1,
      request_id: forwardedCancel.request_id,
      session_id: sessionId,
      command: 'question_response',
      result: 'ok',
      native_acknowledged: true,
      lifecycle: 'cancelled',
    }));
    await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === cancelPrompt.prompt_id
      && message.lifecycle === 'cancelled'
    ));

    const replacedPrompt = question(
      sessionId,
      'question-e2e-prompt-replaced-001',
      'question-e2e-generation-replaced-001',
    );
    const replacementPrompt = question(
      sessionId,
      'question-e2e-prompt-replacement-002',
      'question-e2e-generation-replacement-002',
    );
    proxy.ws.send(JSON.stringify(replacedPrompt));
    const visibleReplaced = await browserA.messages.wait(message => (
      message.type === 'question_prompt' && message.prompt_id === replacedPrompt.prompt_id
    ));
    proxy.ws.send(JSON.stringify(replacementPrompt));
    const replacedTerminal = await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === replacedPrompt.prompt_id
      && message.lifecycle === 'cancelled'
    ));
    assert.strictEqual(replacedTerminal.error_code, 'replaced_by_native_prompt');
    const visibleReplacement = await browserA.messages.wait(message => (
      message.type === 'question_prompt' && message.prompt_id === replacementPrompt.prompt_id
    ));
    browserA.ws.send(JSON.stringify(answer(visibleReplaced, 'question-e2e-response-replaced-late')));
    const replacedLateFailure = await browserA.messages.wait(message => (
      message.command === 'question_response'
      && message.request_id === 'question-e2e-response-replaced-late'
    ));
    assert.strictEqual(replacedLateFailure.result, 'failed');
    assert.strictEqual(replacedLateFailure.error.code, 'prompt_already_claimed');
    // Reordered duplicate frames for both identities retain their exact current state.
    proxy.ws.send(JSON.stringify(replacedPrompt));
    proxy.ws.send(JSON.stringify(replacementPrompt));
    proxy.ws.send(JSON.stringify(replacementPrompt));
    browserB.ws.send(JSON.stringify(answer(visibleReplacement, 'question-e2e-response-replacement')));
    const forwardedReplacement = await proxy.messages.wait(message => (
      message.type === 'question_response' && message.prompt_id === replacementPrompt.prompt_id
    ));
    proxy.ws.send(JSON.stringify({
      type: 'agent_control_result',
      protocol_version: 1,
      request_id: forwardedReplacement.request_id,
      session_id: sessionId,
      command: 'question_response',
      result: 'ok',
      native_acknowledged: true,
      lifecycle: 'answered',
    }));
    await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === replacementPrompt.prompt_id
      && message.lifecycle === 'answered'
    ));

    const openPrompt = question(sessionId, 'question-e2e-prompt-002', 'question-e2e-generation-002');
    proxy.ws.send(JSON.stringify(openPrompt));
    await browserA.messages.wait(message => message.type === 'question_prompt' && message.prompt_id === openPrompt.prompt_id);
    await closeSocket(proxy.ws);
    const proxyReconnect = await authenticateProxy(port, proxySecret, 'question-e2e-proxy');
    sockets.push(proxyReconnect.ws);
    registerSession(proxyReconnect, sessionId);
    proxyReconnect.ws.send(JSON.stringify(openPrompt));
    const resurfaced = await browserA.messages.wait(message => (
      message.type === 'question_prompt'
      && message.prompt_id === openPrompt.prompt_id
      && message.lifecycle === 'open'
    ));
    assert.strictEqual(resurfaced.generation, openPrompt.generation);

    const browserReconnect = await openBrowser(port);
    sockets.push(browserReconnect.ws);
    assert.ok(browserReconnect.ack.open_question_prompts?.some(item => (
      item.prompt_id === openPrompt.prompt_id && item.lifecycle === 'open'
    )));

    // Android disconnect before submit preserves the open native question and
    // reconnect hydration. The reconnected Android client can then answer it.
    await closeSocket(android.ws);
    const androidReconnect = await openAndroid(port);
    sockets.push(androidReconnect.ws);
    assert.ok(androidReconnect.ack.open_question_prompts?.some(item => (
      item.prompt_id === openPrompt.prompt_id && item.lifecycle === 'open'
    )));
    androidReconnect.ws.send(JSON.stringify(answer(openPrompt, 'question-e2e-response-after-client-reconnect')));
    const forwardedAfterClientReconnect = await proxyReconnect.messages.wait(message => (
      message.type === 'question_response' && message.prompt_id === openPrompt.prompt_id
    ));
    proxyReconnect.ws.send(JSON.stringify({
      type: 'agent_control_result',
      protocol_version: 1,
      request_id: forwardedAfterClientReconnect.request_id,
      session_id: sessionId,
      command: 'question_response',
      result: 'ok',
      native_acknowledged: true,
      lifecycle: 'answered',
    }));
    await androidReconnect.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === openPrompt.prompt_id
      && message.lifecycle === 'answered'
    ));

    // A proxy/relay disconnect after submit makes the in-flight answer
    // terminal-failed. A late receipt from the reconnected proxy cannot turn it
    // into success or resurrect the prompt.
    const disconnectAfterSubmitPrompt = question(
      sessionId,
      'question-e2e-prompt-disconnect-after-submit',
      'question-e2e-generation-disconnect-after-submit',
    );
    proxyReconnect.ws.send(JSON.stringify(disconnectAfterSubmitPrompt));
    const visibleDisconnectAfterSubmit = await browserA.messages.wait(message => (
      message.type === 'question_prompt'
      && message.prompt_id === disconnectAfterSubmitPrompt.prompt_id
    ));
    browserA.ws.send(JSON.stringify(answer(
      visibleDisconnectAfterSubmit,
      'question-e2e-response-disconnect-after-submit',
    )));
    const forwardedDisconnectAfterSubmit = await proxyReconnect.messages.wait(message => (
      message.type === 'question_response'
      && message.prompt_id === disconnectAfterSubmitPrompt.prompt_id
    ));
    await closeSocket(proxyReconnect.ws);
    const failedAfterDisconnect = await browserA.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === disconnectAfterSubmitPrompt.prompt_id
      && message.lifecycle === 'failed'
    ));
    assert.strictEqual(failedAfterDisconnect.error_code, 'adapter_disconnected_during_submit');
    const browserAfterFailedPrompt = await openBrowser(port);
    sockets.push(browserAfterFailedPrompt.ws);
    assert.ok(!(browserAfterFailedPrompt.ack.open_question_prompts || []).some(item => (
      item.prompt_id === disconnectAfterSubmitPrompt.prompt_id
    )), 'connection_ack must not restore a retained terminal question prompt');

    const proxyAfterDisconnect = await authenticateProxy(port, proxySecret, 'question-e2e-proxy');
    sockets.push(proxyAfterDisconnect.ws);
    registerSession(proxyAfterDisconnect, sessionId);
    proxyAfterDisconnect.ws.send(JSON.stringify({
      type: 'agent_control_result',
      protocol_version: 1,
      request_id: forwardedDisconnectAfterSubmit.request_id,
      session_id: sessionId,
      command: 'question_response',
      result: 'ok',
      native_acknowledged: true,
      lifecycle: 'answered',
    }));
    const rejectedLateReceipt = await browserA.messages.wait(message => (
      message.type === 'agent_control_result'
      && message.request_id === forwardedDisconnectAfterSubmit.request_id
      && message.result === 'failed'
    ));
    assert.strictEqual(rejectedLateReceipt.error.code, 'question_receipt_not_pending');
    proxyAfterDisconnect.ws.send(JSON.stringify(disconnectAfterSubmitPrompt));
    await browserB.messages.wait(message => (
      message.type === 'question_prompt_state'
      && message.prompt_id === disconnectAfterSubmitPrompt.prompt_id
      && message.lifecycle === 'failed'
    ));

    const terminalExpectations = new Map([
      [prompt.prompt_id, 'answered'],
      [cancelPrompt.prompt_id, 'cancelled'],
      [replacedPrompt.prompt_id, 'cancelled'],
      [replacementPrompt.prompt_id, 'answered'],
      [openPrompt.prompt_id, 'answered'],
      [disconnectAfterSubmitPrompt.prompt_id, 'failed'],
    ]);
    for (const [promptId, lifecycle] of terminalExpectations) {
      assert.ok([browserA, browserB, browserReconnect, androidReconnect].some(client => (
        client.messages.frames.some(message => (
          message.type === 'question_prompt_state'
          && message.prompt_id === promptId
          && message.lifecycle === lifecycle
        ))
      )), `missing ${lifecycle} terminal for ${promptId}`);
    }

    assert.ok(!output.value.includes(secretAnswer), 'secret appeared in relay logs');
    console.log(JSON.stringify({
      result: 'PASS',
      prompts_exercised: terminalExpectations.size,
      terminal_prompts: terminalExpectations.size,
      native_question_forwards: 5,
      duplicate_native_answers: 0,
      wrong_session_answers: 0,
      wrong_generation_answers: 0,
      false_success_receipts: 0,
      secret_log_hits: 0,
      two_tab_atomic_claim: true,
      android_atomic_claim: true,
      duplicate_click_rejected: true,
      stale_generation_rejected: true,
      reordered_duplicate_frames_deduplicated: true,
      question_replacement_terminal: true,
      native_acknowledgement_required: true,
      cancel_contract_idempotent: true,
      open_prompt_reconnect_resurfaced: true,
      client_disconnect_before_submit_resurfaced: true,
      proxy_disconnect_after_submit_failed_closed: true,
      late_receipt_after_proxy_reconnect_rejected: true,
      stale_prompt_resurrections: 0,
      codex_cli_plan_launch_forwarded: true,
    }, null, 2));
  } finally {
    await Promise.allSettled(sockets.map(closeSocket));
    if (child.exitCode == null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode != null) return resolve();
      const timer = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    assert.ok(!directoryContains(dataDir, secretAnswer), 'secret answer persisted under relay data directory');
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
