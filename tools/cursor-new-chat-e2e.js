#!/usr/bin/env node
'use strict';
// Guarded relay new_chat proof for the throwaway Cursor workspace.
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');
const { accumulatedTailMatches } = require('./cursor-production-e2e');

const CDP_PORT = 9227;

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function openRelay(url) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('relay websocket timeout')); }, 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-new-chat-e2e' }));
      resolve({ ws, messages });
    });
    ws.once('error', reject);
  });
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ((msg.type === 'connection_ack' || msg.type === 'session_list' || msg.type === 'session_snapshot')
      && Array.isArray(msg.sessions)) return msg.sessions;
  }
  return [];
}

function sessionIdOf(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

function controlResult(messages, requestId, command) {
  return messages.find(msg => msg.type === 'agent_control_result'
    && msg.request_id === requestId
    && (!command || msg.command === command));
}

function historyEvent(messages, start, sessionId, predicate) {
  return messages.slice(start).find(msg =>
    (msg.type === 'history' || msg.type === 'history_snapshot')
    && (msg.session || msg.session_id) === sessionId
    && Array.isArray(msg.messages)
    && predicate(msg.messages));
}

async function readBlankState(Runtime) {
  const result = await Runtime.evaluate({
    returnByValue: true,
    expression: `(() => {
      const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const groups = Array.from(document.querySelectorAll('.editor-group-container.has-composer-editor'));
      const blank = groups.filter(group => {
        const tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
        return tab && norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') === 'New Agent';
      });
      if (blank.length !== 1) return { ready: false, matches: blank.length };
      const group = blank[0];
      const input = Array.from(group.querySelectorAll('.ui-prompt-input-editor__input[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], .aislash-editor-input[contenteditable="true"]'))
        .find(el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 8; });
      return { ready: !!input && group.querySelectorAll('.composer-rendered-message').length === 0, input: !!input, messages: group.querySelectorAll('.composer-rendered-message').length };
    })()`,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'blank-state evaluation failed');
  return result.result.value;
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'no throwaway Cursor page');
  guard.assertProbeTarget(page, __filename);

  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  const baselineAgents = await cursorSel.readCursorAgentList(client.Runtime);
  if (!baselineAgents.length) throw new Error('No existing throwaway agents available for restoration');
  const orderedAgents = [
    ...baselineAgents.filter(agent => agent && agent.active),
    ...baselineAgents.filter(agent => agent && !agent.active),
  ];
  let restoreAgent = null;
  let baselineNative = [];
  for (const candidate of orderedAgents) {
    const switched = await cursorSel.switchCursorAgent(client.Runtime, candidate.id);
    if (!switched.ok) continue;
    const candidateMessages = JSON.parse(await cursorSel.readCursorMessages(client.Runtime));
    if (!candidateMessages.length) continue;
    restoreAgent = candidate;
    baselineNative = candidateMessages;
    break;
  }
  if (!restoreAgent) throw new Error('No populated throwaway agent available for restoration');

  const relay = await openRelay(deriveRelayWsUrl());
  let restored = false;
  try {
    const session = await waitFor(() => guard.pickThrowawaySession(latestSessions(relay.messages)), 45000, 'throwaway relay session');
    const sessionId = sessionIdOf(session);
    const expected = fidelity.normalizeMessages(baselineNative);
    async function proveBlankCommand(command, requestSuffix) {
      restored = false;
      const start = relay.messages.length;
      const requestId = `cursor-${requestSuffix}-${runId}`;
      relay.ws.send(JSON.stringify({ type: command, session_id: sessionId, request_id: requestId }));
      const result = await waitFor(() => controlResult(relay.messages, requestId, command), 30000, `${command} result`);
      if (result.result !== 'ok') throw new Error(`${command} failed: ${JSON.stringify(result.error || result)}`);

      const blank = await waitFor(async () => {
        const state = await readBlankState(client.Runtime);
        return state.ready ? state : null;
      }, 10000, `${command} native empty New Agent editor`);
      const blankMessages = JSON.parse(await cursorSel.readCursorMessages(client.Runtime));
      if (blankMessages.length !== 0) throw new Error(`${command} native blank selector returned ${blankMessages.length} messages`);
      const blankConfig = await cursorSel.readCursorConfig(client.Runtime);
      if (!blankConfig.model_id || blankConfig.model_id === 'unknown' || !blankConfig.available_models?.length) {
        throw new Error(`${command} blank Agent config unavailable: ${JSON.stringify(blankConfig)}`);
      }
      await waitFor(() => historyEvent(relay.messages, start, sessionId, rows => rows.length === 0), 30000, `${command} authoritative empty relay history`);

      const restoreStart = relay.messages.length;
      const restoreRequestId = `cursor-restore-${requestSuffix}-${runId}`;
      relay.ws.send(JSON.stringify({ type: 'switch_thread', session_id: sessionId, thread_id: restoreAgent.id, request_id: restoreRequestId }));
      const restoreResult = await waitFor(() => controlResult(relay.messages, restoreRequestId, 'switch_thread'), 30000, `${command} restore switch_thread result`);
      if (restoreResult.result !== 'ok') throw new Error(`${command} restore failed: ${JSON.stringify(restoreResult.error || restoreResult)}`);
      await waitFor(async () => {
        const agents = await cursorSel.readCursorAgentList(client.Runtime);
        const selected = agents.filter(agent => agent && agent.active);
        return selected.length === 1 && selected[0].id === restoreAgent.id ? selected[0] : null;
      }, 15000, `${command} restored native agent identity`);
      const restoredNative = JSON.parse(await cursorSel.readCursorMessages(client.Runtime));
      const actual = fidelity.normalizeMessages(restoredNative);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${command} restored transcript mismatch: expected ${expected.length}, got ${actual.length}`);
      }
      try {
        await waitFor(() => historyEvent(relay.messages, restoreStart, sessionId, rows => {
          const normalized = fidelity.normalizeMessages(rows);
          return accumulatedTailMatches(expected, normalized);
        }), 30000, `${command} restored relay history`);
      } catch (err) {
        const observed = relay.messages.slice(restoreStart)
          .filter(msg => (msg.type === 'history' || msg.type === 'history_snapshot')
            && (msg.session || msg.session_id) === sessionId
            && Array.isArray(msg.messages))
          .map(msg => ({
            type: msg.type,
            count: fidelity.normalizeMessages(msg.messages).length,
            matches: accumulatedTailMatches(expected, fidelity.normalizeMessages(msg.messages)),
          }));
        throw new Error(`${err.message}; expected=${expected.length}; observed=${JSON.stringify(observed)}`);
      }
      restored = true;
      return { blank, model: blankConfig.model_id, models: blankConfig.available_models.length };
    }

    const newChat = await proveBlankCommand('new_chat', 'new-chat');
    const newThread = await proveBlankCommand('new_thread', 'new-thread');
    console.log('new_chat', newChat.blank, newChat.model, `${newChat.models} models`);
    console.log('new_thread', newThread.blank, newThread.model, `${newThread.models} models`);
    console.log('restored', restoreAgent.id, restoreAgent.title, `${expected.length} messages`);
    console.log('PASS cursor new chat/thread relay E2E');
  } finally {
    if (!restored) {
      try { await cursorSel.switchCursorAgent(client.Runtime, restoreAgent.id); } catch {}
    }
    try { relay.ws.close(); } catch {}
    await client.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('FAIL', err.message);
    process.exit(1);
  });
}
