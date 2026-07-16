#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const selectors = require(path.join(__dirname, '..', 'agent-proxy', 'selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'vscode-probe-guard'));
const fidelity = require('./run-fidelity-regression');

function parseArgs(argv) {
  const options = { agent: '', sendLive: false, allowShortSoak: false, soakMinutes: 10, intervalMs: 60000, timeoutMs: 300000, resultFile: '', evidenceDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = argv[++i] || '';
    else if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--allow-short-soak') options.allowShortSoak = true;
    else if (arg === '--soak-minutes') options.soakMinutes = Number(argv[++i]);
    else if (arg === '--interval-ms') options.intervalMs = Number(argv[++i]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--result-file') options.resultFile = path.resolve(argv[++i]);
    else if (arg === '--evidence-dir') options.evidenceDir = path.resolve(argv[++i]);
  }
  if (!['claude', 'codex'].includes(options.agent)) throw new Error('--agent must be claude or codex');
  if (!options.sendLive) throw new Error('Refusing mutation without --send-live');
  if (!Number.isFinite(options.soakMinutes) || options.soakMinutes <= 0) throw new Error('--soak-minutes must be positive');
  if (options.soakMinutes < 10 && !options.allowShortSoak) throw new Error('Production soak must be at least 10 minutes');
  if (options.intervalMs !== 60000 && !options.allowShortSoak) throw new Error('Accelerated interval requires --allow-short-soak');
  return options;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const NATIVE_READ_TIMEOUT_MS = Math.max(5000, Number(process.env.VSCODE_E2E_NATIVE_READ_TIMEOUT_MS || 30000));

async function withFatalTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} timed out after ${timeoutMs}ms`);
          error.fatal = true;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 500) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started <= timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      if (error?.fatal) throw error;
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/client-ws';
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'vscode-extension-production-e2e' }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function captureProxyLogOffsets() {
  const root = path.join(__dirname, '..');
  return ['proxy.log', 'proxy-err.log'].map(name => {
    const file = path.join(root, name);
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    return { name, file, size };
  });
}

function targetSessionLogErrors(offsets, sessionIds) {
  const ids = new Set((sessionIds || []).filter(Boolean));
  const errors = [];
  for (const entry of offsets || []) {
    let buffer;
    try { buffer = fs.readFileSync(entry.file); } catch { continue; }
    const start = buffer.length >= entry.size ? entry.size : 0;
    const lines = buffer.subarray(start).toString('utf8').split(/\r?\n/);
    for (const line of lines) {
      const sid = Array.from(ids).find(id => line.includes(`[${id}]`));
      if (!sid) continue;
      if (/\b(error|failed|timeout|degraded)\b|\[sel\]/i.test(line)) {
        errors.push({ log: entry.name, session_id: sid, line });
      }
    }
  }
  return errors;
}

async function openNative(agentType, requestedFrame = null) {
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const picked = guard.assertTargetSet(targets, agentType, 'native open');
  const frame = requestedFrame || picked.frame;
  if (!picked.frames.some(candidate => candidate.id === frame.id)) throw new Error('guard: requested native frame is outside disposable target set');
  const client = await CDP({ port: guard.CDP_PORT, target: frame.id });
  await client.Runtime.enable();
  await client.Page.enable();
  client.Runtime._webviewId = (frame.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
  const connectionState = attachNativeDisconnectState(client, agentType, frame.id);
  await selectors.cacheInnerContextId(client.Runtime);
  return { ...picked, frame, client, connectionState };
}

function attachNativeDisconnectState(client, agentType, targetId = '') {
  const state = { disconnected: false, disconnected_at: null, agent_type: agentType, target_id: targetId };
  client.on('disconnect', () => {
    state.disconnected = true;
    state.disconnected_at = new Date().toISOString();
    if (client.Runtime) client.Runtime._suppressReadErrors = true;
  });
  return state;
}

function assertNativeConnected(native, agentType, label = 'native read') {
  if (!native?.connectionState?.disconnected) return;
  const error = new Error(`${agentType} native CDP target disconnected during ${label}`);
  error.code = 'native_cdp_disconnected';
  error.retryable = true;
  error.fatal = true;
  error.targetId = native.connectionState.target_id || native?.frame?.id || '';
  error.disconnectedAt = native.connectionState.disconnected_at || null;
  throw error;
}

async function settleCodexFastModeOnboarding(native, evalFn = selectors.evalInFrame) {
  assertNativeConnected(native, 'codex', 'Fast mode onboarding check');
  const outcome = await evalFn(native.client.Runtime, `
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && el.getClientRects().length > 0;
    }
    function exactText(el, text) { return (el && (el.textContent || '').trim()) === text; }
    function exactButtons(root, text) {
      return Array.from(root.querySelectorAll('button')).filter(function(button) {
        return visible(button) && exactText(button, text);
      });
    }

    var title = Array.from(d.querySelectorAll('h1, h2, h3, [role="heading"]')).find(function(el) {
      return visible(el) && exactText(el, 'Introducing Fast mode');
    });
    if (!title) return { status: 'absent' };

    var surface = title.closest('[role="dialog"], dialog, [aria-modal="true"]');
    if (!surface) {
      var candidate = title.parentElement;
      for (var depth = 0; candidate && depth < 8; depth++, candidate = candidate.parentElement) {
        if (exactButtons(candidate, 'Use standard speed').length > 0
            && exactButtons(candidate, 'Turn on Fast mode').length > 0) {
          surface = candidate;
          break;
        }
      }
    }
    if (!surface || !visible(surface)) return { status: 'ambiguous', reason: 'surface-not-found' };

    var standardButtons = exactButtons(surface, 'Use standard speed');
    var fastButtons = exactButtons(surface, 'Turn on Fast mode');
    if (standardButtons.length !== 1 || fastButtons.length !== 1) {
      return {
        status: 'ambiguous',
        reason: 'exact-choice-count',
        standard_count: standardButtons.length,
        fast_count: fastButtons.length,
      };
    }
    standardButtons[0].click();
    return { status: 'dismissed' };
  `);
  assertNativeConnected(native, 'codex', 'Fast mode onboarding check');
  if (outcome?.status === 'ambiguous') {
    const error = new Error(`Codex Fast mode onboarding was present but unsafe to resolve: ${JSON.stringify(outcome)}`);
    error.code = 'codex_fast_mode_onboarding_ambiguous';
    error.fatal = true;
    throw error;
  }
  if (outcome?.status === 'dismissed') {
    native.fastModeOnboardingDismissals = (native.fastModeOnboardingDismissals || 0) + 1;
  }
  return outcome || { status: 'absent' };
}

async function readNative(native, agentType, sessionId) {
  assertNativeConnected(native, agentType, 'native read');
  return withFatalTimeout((async () => {
    const raw = await selectors.readMessages(native.client.Runtime, agentType, sessionId);
    assertNativeConnected(native, agentType, 'native read');
    const thinking = await selectors.detectThinking(native.client.Runtime, agentType);
    assertNativeConnected(native, agentType, 'thinking read');
    return { messages: JSON.parse(raw || '[]'), thinking };
  })(), NATIVE_READ_TIMEOUT_MS, `${agentType} native read`);
}

async function capturePage(page, output) {
  if (!output) return;
  const client = await CDP({ port: guard.CDP_PORT, target: page.id });
  try {
    await client.Page.enable();
    const shot = await client.Page.captureScreenshot({ format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));
  } finally { await client.close(); }
}

async function control(ws, messages, sessionId, type, fields = {}, timeoutMs = 60000) {
  const requestId = `vscode-e2e-${type}-${crypto.randomBytes(4).toString('hex')}`;
  const start = messages.length;
  ws.send(JSON.stringify({ type, session_id: sessionId, request_id: requestId, ...fields }));
  const result = await waitFor(() => messages.slice(start).find(message => message.type === 'agent_control_result' && message.request_id === requestId), timeoutMs, `${type} result`);
  if (result.result !== 'ok') throw new Error(`${type} failed: ${JSON.stringify(result)}`);
  return { result, start };
}

async function requestCodexChatList(ws, messages, sessionId, label) {
  const start = messages.length;
  await control(ws, messages, sessionId, 'chat_list');
  const listMessage = await waitFor(
    () => messages.slice(start).find(message => message.type === 'chat_list' && (message.session_id || message.session) === sessionId),
    30000,
    `${label} chat list`
  );
  return listMessage.chats || listMessage.chat_list || [];
}

async function sendTurn(ws, messages, native, agentType, sessionId, token, timeoutMs) {
  if (agentType === 'codex') await settleCodexFastModeOnboarding(native);
  const startedAt = Date.now();
  const id = `vscode-e2e-send-${crypto.randomBytes(4).toString('hex')}`;
  const start = messages.length;
  ws.send(JSON.stringify({ type: 'send', session: sessionId, content: `Reply with exactly ${token} and nothing else.`, client_message_id: id }));
  const delivered = await waitFor(() => messages.slice(start).find(message => message.type === 'proxy_send_result' && message.client_message_id === id), 60000, 'send delivery', 25);
  const receiptAt = Date.now();
  if (delivered.result !== 'delivered') throw new Error(`send failed: ${JSON.stringify(delivered)}`);
  await waitFor(async () => (await readNative(native, agentType, sessionId)).messages.some(message => message.role === 'user' && String(message.content || '').includes(token)), 60000, 'native user echo', 100);
  const nativeEchoAt = Date.now();
  const settled = await waitFor(async () => {
    const state = await readNative(native, agentType, sessionId);
    return state.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token)) && !state.thinking?.thinking ? state : null;
  }, timeoutMs, 'native assistant token', 100);
  if (agentType === 'codex') await settleCodexFastModeOnboarding(native);
  return {
    state: settled,
    timing: {
      delivery_receipt_ms: receiptAt - startedAt,
      native_echo_ms: nativeEchoAt - startedAt,
      assistant_complete_ms: Date.now() - startedAt,
    },
  };
}

async function interruptTurn(ws, messages, native, agentType, sessionId, runId, afterStarted = null) {
  if (agentType === 'codex') await settleCodexFastModeOnboarding(native);
  const marker = `RAC_VSCODE_INTERRUPT_${agentType.toUpperCase()}_${runId}`;
  const id = `vscode-e2e-interrupt-send-${runId}`;
  const start = messages.length;
  ws.send(JSON.stringify({ type: 'send', session: sessionId, content: `Write a numbered list of 1000 distinct software testing facts. Put ${marker} only in item 1000. Do not use tools.`, client_message_id: id }));
  await waitFor(() => messages.slice(start).find(message => message.type === 'proxy_send_result' && message.client_message_id === id && message.result === 'delivered'), 60000, 'interrupt prompt delivery');
  await waitFor(async () => (await readNative(native, agentType, sessionId)).thinking?.thinking, 60000, 'native generating before interrupt');
  if (afterStarted) await afterStarted({ marker });
  await control(ws, messages, sessionId, 'agent_interrupt');
  const settled = await waitFor(async () => {
    const state = await readNative(native, agentType, sessionId);
    return !state.thinking?.thinking ? state : null;
  }, 60000, 'native idle after interrupt');
  if (settled.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(marker))) {
    throw new Error('interrupt marker completed instead of stopping');
  }
  if (agentType === 'codex') await settleCodexFastModeOnboarding(native);
  return { marker, messages: settled.messages.length };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('vscode production e2e');
  const runId = `${options.agent}-${Date.now().toString(36)}`;
  let native = await openNative(options.agent);
  const relay = await openRelay();
  const logOffsets = captureProxyLogOffsets();
  const result = { ok: false, run_id: runId, agent: options.agent, workspace: guard.WORKSPACE_PATH, stages: [], soak_turns: [], session_ids: [] };
  try {
    let store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
    let session = await waitFor(() => guard.pickSessionForFrame(latestSessions(relay.messages), options.agent, store, native.frame), 30000, 'guarded relay session');
    guard.assertStoreBinding(store, session, native.frame);
    let sessionId = session.session_id;
    result.session_id = sessionId;
    result.session_ids.push(sessionId);
    result.stages.push('guard');

    let codexBaselineIds = null;
    if (options.agent === 'codex') {
      const baselineChats = await requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex baseline');
      codexBaselineIds = new Set(baselineChats.map(chat => chat?.id).filter(Boolean));
    }

    const baselineClaudeFrames = options.agent === 'claude' ? new Set(native.frames.map(frame => frame.id)) : null;
    await control(relay.ws, relay.messages, sessionId, 'new_chat');
    if (options.agent === 'claude') {
      const newFrame = await waitFor(async () => {
        const targets = await CDP.List({ port: guard.CDP_PORT });
        return targets.find(target => guard.isThrowawayIframe(target, 'claude')
          && !baselineClaudeFrames.has(target.id)
          && !/[?&]purpose=webviewView(?:&|$)/i.test(String(target.url || '')));
      }, 30000, 'new Claude editor iframe');
      await native.client.close();
      native = await openNative(options.agent, newFrame);
      session = await waitFor(() => {
        store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
        return guard.pickSessionForFrame(latestSessions(relay.messages), options.agent, store, newFrame);
      }, 30000, 'new Claude relay session');
      guard.assertStoreBinding(store, session, newFrame);
      sessionId = session.session_id;
      result.session_id = sessionId;
      result.session_ids.push(sessionId);
    }
    await waitFor(async () => (await readNative(native, options.agent, sessionId)).messages.length === 0, 30000, 'empty new chat');
    result.stages.push('new_chat');

    const firstToken = `RAC_VSCODE_${options.agent.toUpperCase()}_${runId}`;
    const firstTurn = await sendTurn(relay.ws, relay.messages, native, options.agent, sessionId, firstToken, options.timeoutMs);
    result.first_turn = { token: firstToken, ...firstTurn.timing };
    result.stages.push('send');

    const switchWhileOwnedInterruptActive = options.agent === 'codex'
      ? async ({ marker }) => {
          const ownedList = await requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex active owned');
          const ownedCandidates = ownedList.filter(chat => chat?.id && !codexBaselineIds.has(chat.id));
          if (ownedCandidates.length !== 1) {
            throw new Error(`Codex active owned UUID was not unique: ${JSON.stringify({ baseline: Array.from(codexBaselineIds), chats: ownedList })}`);
          }
          const owned = ownedCandidates[0];
          await control(relay.ws, relay.messages, sessionId, 'switch_chat', { chat_id: owned.id });
          await waitFor(async () => {
            const state = await readNative(native, options.agent, sessionId);
            const returnedToOwnedChat = state.messages.some(message =>
              message.role === 'user' && String(message.content || '').includes(marker)
            );
            return returnedToOwnedChat && state.thinking?.thinking ? state : null;
          }, 30000, 'Codex active owned chat after switch');
          result.stages.push('switch_chat');
        }
      : null;
    if (!switchWhileOwnedInterruptActive) result.stages.push('switch_chat_not_advertised');

    result.interrupt = await interruptTurn(relay.ws, relay.messages, native, options.agent, sessionId, runId, switchWhileOwnedInterruptActive);
    result.stages.push('interrupt');

    if (options.evidenceDir) {
      await capturePage(native.page, path.join(options.evidenceDir, `vscode-${runId}-start-native.png`));
    }
    const soakStarted = Date.now();
    const soakDeadline = soakStarted + options.soakMinutes * 60000;
    let turn = 0;
    while (Date.now() < soakDeadline) {
      turn++;
      const token = `RAC_VSCODE_SOAK_${options.agent.toUpperCase()}_${runId}_${turn}`;
      const started = Date.now();
      const outcome = await sendTurn(relay.ws, relay.messages, native, options.agent, sessionId, token, options.timeoutMs);
      result.soak_turns.push({
        turn,
        token,
        elapsed_seconds: Math.round((Date.now() - soakStarted) / 1000),
        native_messages: outcome.state.messages.length,
        ...outcome.timing,
      });
      const next = Math.min(soakDeadline, started + options.intervalMs);
      while (Date.now() < next) {
        if (relay.ws.readyState !== WebSocket.OPEN) throw new Error('relay disconnected during soak');
        await sleep(Math.min(5000, next - Date.now()));
      }
    }
    result.soak_elapsed_seconds = Math.round((Date.now() - soakStarted) / 1000);
    if (options.evidenceDir) {
      await capturePage(native.page, path.join(options.evidenceDir, `vscode-${runId}-final-native.png`));
    }
    result.relay_connected_at_end = relay.ws.readyState === WebSocket.OPEN;
    if (options.agent === 'codex') {
      result.fast_mode_onboarding_dismissals = native.fastModeOnboardingDismissals || 0;
    }
    result.proxy_log_errors = targetSessionLogErrors(logOffsets, result.session_ids);
    if (!result.relay_connected_at_end) throw new Error('relay disconnected before soak completion');
    if (result.proxy_log_errors.length > 0) {
      throw new Error(`target-session proxy log errors: ${JSON.stringify(result.proxy_log_errors)}`);
    }
    result.ok = true;
    result.stages.push('soak');
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    result.error = error.message;
    if (error.code) result.failure_class = error.code;
    if (error.retryable === true) result.retryable = true;
    if (error.targetId) result.native_target_id = error.targetId;
    if (error.disconnectedAt) result.native_disconnected_at = error.disconnectedAt;
    result.cdp_port = guard.CDP_PORT;
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    throw error;
  } finally {
    try { relay.ws.close(); } catch {}
    try { await native.client.close(); } catch {}
  }
}

if (require.main === module) main().catch(error => { console.error('FATAL:', error.message); process.exitCode = 1; });

module.exports = {
  main,
  parseArgs,
  waitFor,
  openRelay,
  latestSessions,
  openNative,
  readNative,
  control,
  requestCodexChatList,
  captureProxyLogOffsets,
  targetSessionLogErrors,
  withFatalTimeout,
  attachNativeDisconnectState,
  assertNativeConnected,
  settleCodexFastModeOnboarding,
};
