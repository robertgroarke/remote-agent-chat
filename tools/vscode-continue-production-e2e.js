#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const selectors = require('../agent-proxy/selectors');
process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';
const guard = require('../agent-proxy/vscode-probe-guard');
const fidelity = require('./run-fidelity-regression');

const LOCK_PATH = path.join('C:\\temp', 'remote-agent-vscode-continue-mutation.lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function parseArgs(argv) {
  const out = { sendLive: false, resetOnly: false, allowShortSoak: false, soakMinutes: 10, intervalMs: 60000, timeoutMs: 300000, resultFile: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--send-live') out.sendLive = true;
    else if (argv[i] === '--reset-only') out.resetOnly = true;
    else if (argv[i] === '--allow-short-soak') out.allowShortSoak = true;
    else if (argv[i] === '--soak-minutes') out.soakMinutes = Number(argv[++i]);
    else if (argv[i] === '--interval-ms') out.intervalMs = Number(argv[++i]);
    else if (argv[i] === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (argv[i] === '--result-file') out.resultFile = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!out.sendLive) throw new Error('Refusing Continue mutation without --send-live');
  if (!Number.isFinite(out.soakMinutes) || out.soakMinutes < 0) throw new Error('--soak-minutes must be non-negative');
  if (out.soakMinutes < 10 && !out.allowShortSoak) throw new Error('Production soak must be at least 10 minutes');
  if (out.intervalMs !== 60000 && !out.allowShortSoak) throw new Error('Accelerated interval requires --allow-short-soak');
  return out;
}

function acquireLock() {
  const payload = JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), agent: 'continue' });
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(fd, payload, 'utf8');
    fs.closeSync(fd);
  } catch (error) {
    throw new Error(`Continue mutation lock unavailable at ${LOCK_PATH}: ${error.message}`);
  }
}

function releaseLock() {
  try {
    const owner = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (owner.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {}
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start <= timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || `${fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '')}/client-ws`;
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  const failures = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
    const messages = [];
    ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('relay open timeout after 20000ms')), 20000);
        ws.once('open', () => {
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'vscode-continue-production-e2e' }));
          resolve();
        });
        ws.once('error', error => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return { ws, messages, open_attempts: attempt, open_failures: failures, open_ms: Date.now() - startedAt };
    } catch (error) {
      failures.push(error.message);
      try { ws.terminate(); } catch {}
      if (attempt < 2) await sleep(500);
    }
  }
  throw new Error(`relay open failed after 2 attempts: ${failures.join(' | ')}`);
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

async function openNative() {
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const picked = guard.assertTargetSet(targets, 'continue', 'Continue production E2E');
  const client = await CDP({ port: guard.CDP_PORT, target: picked.frame.id });
  await client.Runtime.enable();
  client.Runtime._webviewId = (picked.frame.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
  await selectors.cacheInnerContextId(client.Runtime);
  return { ...picked, client };
}

async function readNative(native, sessionId) {
  const raw = await withTimeout(selectors.readMessages(native.client.Runtime, 'continue', sessionId), 30000, 'Continue native transcript read');
  const thinking = await withTimeout(selectors.detectThinking(native.client.Runtime, 'continue'), 30000, 'Continue native thinking read');
  return { messages: JSON.parse(raw || '[]'), thinking };
}

async function control(relay, sessionId, type, fields = {}, allowFailure = false) {
  const requestId = `continue-e2e-${type}-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type, session_id: sessionId, request_id: requestId, ...fields }));
  const result = await waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'agent_control_result' && message.request_id === requestId),
    60000,
    `${type} control result`
  );
  if (!allowFailure && result.result !== 'ok') throw new Error(`${type} failed: ${JSON.stringify(result)}`);
  return { requestId, result, start };
}

async function requestConfig(relay, sessionId) {
  const start = relay.messages.length;
  const requestId = `continue-e2e-config-${crypto.randomBytes(4).toString('hex')}`;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'agent_config' && (message.session_id || message.session) === sessionId),
    30000,
    'Continue config'
  );
}

async function requestChatList(relay, sessionId) {
  const start = relay.messages.length;
  await control(relay, sessionId, 'chat_list');
  const payload = await waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'chat_list' && (message.session_id || message.session) === sessionId),
    30000,
    'Continue chat list'
  );
  return payload.chats || [];
}

async function sendTurn(relay, native, sessionId, token, timeoutMs) {
  const clientMessageId = `continue-e2e-send-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  const startedAt = Date.now();
  relay.ws.send(JSON.stringify({
    type: 'send',
    session: sessionId,
    content: `Reply with exactly ${token} and nothing else.`,
    client_message_id: clientMessageId,
  }));
  const receipt = await waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'proxy_send_result' && message.client_message_id === clientMessageId),
    60000,
    'Continue delivery receipt',
    25
  );
  if (receipt.result !== 'delivered') throw new Error(`Continue send failed: ${JSON.stringify(receipt)}`);
  const receiptAt = Date.now();
  await waitFor(async () => (await readNative(native, sessionId)).messages.some(message =>
    message.role === 'user' && String(message.content || '').includes(token)
  ), 60000, 'Continue native user echo');
  const nativeEchoAt = Date.now();
  const state = await waitFor(async () => {
    const current = await readNative(native, sessionId);
    return current.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token))
      && !current.thinking?.thinking ? current : null;
  }, timeoutMs, 'Continue assistant token', 200);
  return {
    state,
    timing: {
      delivery_receipt_ms: receiptAt - startedAt,
      native_echo_ms: nativeEchoAt - startedAt,
      assistant_complete_ms: Date.now() - startedAt,
    },
  };
}

async function waitForStableIdle(native, sessionId, label, stableMs = 3000, timeoutMs = 60000) {
  let idleSince = 0;
  let lastSignature = '';
  return waitFor(async () => {
    const state = await readNative(native, sessionId);
    const signature = JSON.stringify(state.messages.slice(-4).map(message => [message.role, message.content]));
    if (state.thinking?.thinking) {
      idleSince = 0;
      lastSignature = signature;
      return null;
    }
    if (signature !== lastSignature) {
      lastSignature = signature;
      idleSince = Date.now();
      return null;
    }
    if (!idleSince) idleSince = Date.now();
    return Date.now() - idleSince >= stableMs ? state : null;
  }, timeoutMs, label, 200);
}

async function interruptWhenReady(relay, native, sessionId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastResult = null;
  while (Date.now() <= deadline) {
    attempts += 1;
    const response = await control(relay, sessionId, 'agent_interrupt', {}, true);
    lastResult = response.result;
    if (lastResult.result === 'ok') return { attempts, result: lastResult };
    if (lastResult.error?.code !== 'agent_not_active') {
      throw new Error('agent_interrupt failed: ' + JSON.stringify(lastResult));
    }
    const nativeState = await readNative(native, sessionId);
    if (!nativeState.thinking?.thinking) {
      throw new Error('Continue stopped generating before an actionable interrupt control appeared');
    }
    await sleep(200);
  }
  throw new Error('Continue interrupt control did not become actionable: ' + JSON.stringify(lastResult));
}

async function interruptTurn(relay, native, sessionId, runId) {
  const marker = 'RAC_CONTINUE_INTERRUPT_' + runId;
  const permissionMarker = marker;
  const encodedCommand = Buffer.from(
    'Start-Sleep -Seconds 30; Write-Output ' + marker,
    'utf16le'
  ).toString('base64');
  const permissionMessageId = 'continue-e2e-permission-' + runId;
  const permissionStart = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'send',
    session: sessionId,
    content: 'Use the terminal tool now (do not simulate it) to run powershell -NoProfile -EncodedCommand '
      + encodedCommand + '. Do not decode, paraphrase, or print the encoded command.',
    client_message_id: permissionMessageId,
  }));
  await waitFor(() => relay.messages.slice(permissionStart).find(message =>
    message.type === 'proxy_send_result' && message.client_message_id === permissionMessageId && message.result === 'delivered'
  ), 60000, 'Continue permission prompt receipt');
  const permissionPrompt = await waitFor(() => relay.messages.slice(permissionStart).find(message =>
    message.type === 'permission_prompt'
      && (message.session_id || message.session) === sessionId
      && Array.isArray(message.choices)
      && message.choices.some(choice => /^Accept$/i.test(String(choice.label || '')))
  ), 60000, 'Continue terminal permission prompt');
  const accept = permissionPrompt.choices.find(choice => /^Accept$/i.test(String(choice.label || '')));
  const permissionResponse = await control(relay, sessionId, 'permission_response', {
    prompt_id: permissionPrompt.prompt_id,
    choice_id: accept.choice_id,
  });
  await waitFor(async () => (await readNative(native, sessionId)).thinking?.thinking, 60000, 'Continue terminal active before interrupt', 10);
  const interruptControl = await interruptWhenReady(relay, native, sessionId);
  const settled = await waitForStableIdle(native, sessionId, 'Continue stable idle after interrupt');
  if (settled.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(marker))) {
    throw new Error('Continue interrupt prompt completed instead of stopping');
  }
  return {
    marker,
    permission_marker: permissionMarker,
    control_attempts: interruptControl.attempts,
    messages: settled.messages.length,
    permission_prompt: {
      prompt_id: permissionPrompt.prompt_id,
      message: permissionPrompt.message,
      accepted_choice_id: accept.choice_id,
    },
    permission_response: permissionResponse.result,
  };
}

async function requestHistory(relay, sessionId) {
  const requestId = `continue-e2e-history-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'history_request', session: sessionId, session_id: sessionId, request_id: requestId, full: true }));
  return waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'history' && message.request_id === requestId),
    30000,
    'Continue relay history'
  );
}

function messageBlockTypes(messages) {
  return (messages || []).flatMap(message =>
    Array.isArray(message.content_blocks) ? message.content_blocks.map(block => block?.type).filter(Boolean) : []
  );
}

async function waitForHistoryParity(relay, sessionId, nativeMessages, timeoutMs = 30000) {
  const nativeTerminalBlocks = messageBlockTypes(nativeMessages).filter(type => type === 'terminal').length;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = { messages: [], terminal_blocks: 0 };
  while (Date.now() <= deadline) {
    attempts += 1;
    const history = await requestHistory(relay, sessionId);
    const messages = history.messages || [];
    const terminalBlocks = messageBlockTypes(messages).filter(type => type === 'terminal').length;
    last = { history, messages, terminal_blocks: terminalBlocks };
    if (messages.length >= nativeMessages.length && terminalBlocks === nativeTerminalBlocks) {
      return { ...last, attempts };
    }
    await sleep(500);
  }
  throw new Error(
    'Continue relay history did not converge: native_messages=' + nativeMessages.length
      + ', relay_messages=' + last.messages.length
      + ', native_terminals=' + nativeTerminalBlocks
      + ', relay_terminals=' + last.terminal_blocks
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (guard.CDP_PORT !== 9230) throw new Error(`Continue production E2E requires disposable port 9230, got ${guard.CDP_PORT}`);
  guard.assertUpdatesDisabled('Continue production E2E');
  acquireLock();

  const result = {
    ok: false,
    run_id: `continue-${Date.now().toString(36)}`,
    cdp_port: guard.CDP_PORT,
    stages: [],
    soak_turns: [],
    advertised_control_gates: [],
    started_at: new Date().toISOString(),
  };
  let relay;
  let native;
  let baselineAutoApprove = false;
  let autoApproveChanged = false;
  try {
    native = await openNative();
    relay = await openRelay();
    result.relay_open = { attempts: relay.open_attempts, failures: relay.open_failures, ms: relay.open_ms };
    const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
    const session = await waitFor(
      () => guard.pickSessionForFrame(latestSessions(relay.messages), 'continue', store, native.frame),
      30000,
      'guarded Continue relay session'
    );
    guard.assertStoreBinding(store, session, native.frame);
    result.session_id = session.session_id;
    result.stages.push('guard');

    const newChat = await control(relay, session.session_id, 'new_chat');
    result.new_chat = newChat.result;
    const emptySession = await waitFor(async () => {
      const state = await readNative(native, session.session_id);
      return state.messages.length === 0 && !state.thinking?.thinking ? state : null;
    }, 30000, 'empty Continue New Session');
    result.new_chat_messages = emptySession.messages.length;
    result.stages.push('new_chat');

    if (options.resetOnly) {
      result.reset_only = true;
      result.relay_connected_at_end = relay.ws.readyState === WebSocket.OPEN;
      if (!result.relay_connected_at_end) throw new Error('Relay disconnected before Continue reset completed');
      result.ok = true;
    } else {
    const config = await requestConfig(relay, session.session_id);
    result.initial_config = {
      model_id: config.model_id,
      mode: config.mode,
      permission_mode: config.permission_mode,
      available_models: config.available_models || [],
      auto_approve_permissions: config.auto_approve_permissions,
      capabilities: config.capabilities,
    };
    baselineAutoApprove = !!config.auto_approve_permissions;
    result.stages.push('config');

    const firstToken = `RAC_CONTINUE_${result.run_id}`;
    const first = await sendTurn(relay, native, session.session_id, firstToken, options.timeoutMs);
    result.first_turn = { token: firstToken, ...first.timing, messages: first.state.messages.length };
    result.stages.push('send');

    const modelControl = await control(relay, session.session_id, 'agent_set_model', { model_id: config.model_id }, true);
    result.model_control = modelControl.result;
    if (modelControl.result.result !== 'ok') result.advertised_control_gates.push({ control: 'agent_set_model', result: modelControl.result });
    result.stages.push('model');

    const toggle = await control(relay, session.session_id, 'agent_set_auto_approve_permissions', { enabled: !baselineAutoApprove }, true);
    result.auto_approve_toggle = toggle.result;
    if (toggle.result.result === 'ok') autoApproveChanged = true;
    else result.advertised_control_gates.push({ control: 'agent_set_auto_approve_permissions', result: toggle.result });
    if (autoApproveChanged) {
      const restore = await control(relay, session.session_id, 'agent_set_auto_approve_permissions', { enabled: baselineAutoApprove }, true);
      result.auto_approve_restore = restore.result;
      if (restore.result.result !== 'ok') throw new Error(`Failed to restore Continue auto-approve: ${JSON.stringify(restore.result)}`);
      autoApproveChanged = false;
    }
    result.stages.push('auto_approve');

    if (config.capabilities?.chat_list || config.capabilities?.switch_chat) {
      throw new Error('Continue must not advertise VS Code editor tabs as native chat history');
    }
    result.chat_list = { exercised: false, reason: 'gated_not_advertised_native_history_unavailable' };
    result.chat_switch = { exercised: false, reason: 'gated_not_advertised_native_history_unavailable' };
    result.stages.push('chat_list');

    result.interrupt = await interruptTurn(relay, native, session.session_id, result.run_id);
    result.stages.push('interrupt');

    const soakDeadline = Date.now() + options.soakMinutes * 60000;
    let turn = 0;
    while (Date.now() < soakDeadline) {
      turn += 1;
      const token = `RAC_CONTINUE_SOAK_${result.run_id}_${turn}`;
      const sent = await sendTurn(relay, native, session.session_id, token, options.timeoutMs);
      result.soak_turns.push({ turn, token, ...sent.timing, messages: sent.state.messages.length });
      if (Date.now() < soakDeadline) await sleep(Math.min(options.intervalMs, soakDeadline - Date.now()));
    }
    result.stages.push('soak');

    const nativeState = await readNative(native, session.session_id);
    const parityHistory = await waitForHistoryParity(relay, session.session_id, nativeState.messages);
    const relayMessages = parityHistory.messages;
    const ownedTokens = [firstToken, ...result.soak_turns.map(turnRow => turnRow.token)];
    for (const token of ownedTokens) {
      if (!relayMessages.some(message => String(message.content || '').includes(token))) throw new Error(`Relay history missing ${token}`);
      if (!nativeState.messages.some(message => String(message.content || '').includes(token))) throw new Error(`Native transcript missing ${token}`);
    }
    result.fidelity = { native_messages: nativeState.messages.length, relay_messages: relayMessages.length, owned_tokens: ownedTokens.length };
    const nativeBlockTypes = messageBlockTypes(nativeState.messages);
    const relayBlockTypes = messageBlockTypes(relayMessages);
    const nativeTerminalBlocks = nativeBlockTypes.filter(type => type === 'terminal').length;
    const relayTerminalBlocks = relayBlockTypes.filter(type => type === 'terminal').length;
    if (nativeTerminalBlocks < 1) throw new Error('Native Continue transcript did not expose its terminal cards as canonical blocks');
    if (relayTerminalBlocks !== nativeTerminalBlocks) {
      throw new Error('Continue terminal block mismatch: native=' + nativeTerminalBlocks + ', relay=' + relayTerminalBlocks);
    }
    result.structured_fidelity = {
      native_block_types: [...new Set(nativeBlockTypes)],
      relay_block_types: [...new Set(relayBlockTypes)],
      native_terminal_blocks: nativeTerminalBlocks,
      relay_terminal_blocks: relayTerminalBlocks,
      history_parity_attempts: parityHistory.attempts,
    };
    result.stages.push('relay_fidelity');

    result.relay_connected_at_end = relay.ws.readyState === WebSocket.OPEN;
    if (!result.relay_connected_at_end) throw new Error('Relay disconnected before Continue gate completed');
    if (result.advertised_control_gates.length > 0) throw new Error(`Advertised Continue controls failed: ${JSON.stringify(result.advertised_control_gates)}`);
    result.ok = true;
    }
  } catch (error) {
    result.error = error.message;
    if (native && result.session_id) {
      try {
        const failureState = await readNative(native, result.session_id);
        result.failure_native_state = {
          thinking: failureState.thinking,
          messages: failureState.messages.slice(-6),
        };
      } catch {}
    }
  } finally {
    if (autoApproveChanged && relay && result.session_id) {
      try { await control(relay, result.session_id, 'agent_set_auto_approve_permissions', { enabled: baselineAutoApprove }, true); } catch {}
    }
    result.completed_at = new Date().toISOString();
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    try { await withTimeout(native?.client?.close() || Promise.resolve(), 2000, 'Continue native CDP close'); } catch {}
    try { relay?.ws?.terminate(); } catch {}
    releaseLock();
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  releaseLock();
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
