#!/usr/bin/env node
'use strict';
// Relay thread/chat list and switch aliases on the guarded throwaway Cursor session.
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const CDP_PORT = 9227;

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
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
      setTimeout(tick, 500);
    };
    tick();
  });
}

function openRelay(url) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (data) => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('ws timeout')); }, 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-agent-switch-e2e' }));
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

function listSignature(items) {
  return JSON.stringify((items || []).map(item => ({
    id: item.id,
    title: item.title,
    active: !!item.active,
  })));
}

function historyEvent(messages, start, sessionId) {
  return messages.slice(start).find(msg =>
    (msg.type === 'history' || msg.type === 'history_snapshot')
    && (msg.session || msg.session_id) === sessionId
    && Array.isArray(msg.messages));
}

async function readNative(page) {
  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  try {
    const agents = await cursorSel.readCursorAgentList(client.Runtime);
    const raw = await cursorSel.readCursorMessages(client.Runtime);
    return { agents, messages: JSON.parse(raw || '[]') };
  } finally {
    await client.close();
  }
}

async function restoreNativeAgent(page, agentId) {
  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  try {
    const agents = await cursorSel.readCursorAgentList(client.Runtime);
    if (!agents.some(agent => agent && agent.active && agent.id === agentId)) {
      const result = await cursorSel.switchCursorAgent(client.Runtime, agentId);
      if (!result.ok) throw new Error(`cleanup restore failed: ${result.detail}`);
    }
  } finally {
    await client.close();
  }
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'no throwaway page');
  guard.assertProbeTarget(page, __filename);

  const { agents } = await readNative(page);
  console.log('agents', agents);
  if (agents.length < 2) {
    throw new Error(`Need >=2 agents, got ${agents.length}`);
  }
  const original = agents.find(agent => agent && agent.active);
  if (!original) throw new Error('No exact active Cursor agent');
  const target = agents.find((a) => !a.active) || agents[1];

  const { ws, messages } = await openRelay(deriveRelayWsUrl());
  try {
    const session = await waitFor(() => {
      const s = guard.pickThrowawaySession(latestSessions(messages));
      return s || null;
    }, 45000, 'throwaway session');
    const sessionId = sessionIdOf(session);

    const listStart = messages.length;
    const listRequestId = `chat-list-${runId}`;
    ws.send(JSON.stringify({
      type: 'chat_list',
      session_id: sessionId,
      request_id: listRequestId,
    }));
    const chatList = await waitFor(
      () => messages.slice(listStart).find(m => m.type === 'chat_list' && (m.session || m.session_id) === sessionId),
      30000,
      'chat_list payload'
    );
    const listCtrl = await waitFor(
      () => messages.find(m => m.type === 'agent_control_result' && m.request_id === listRequestId),
      30000,
      'chat_list result'
    );
    if (listCtrl.result !== 'ok') throw new Error(`chat_list failed: ${listCtrl.result}`);
    if (listSignature(chatList.chats) !== listSignature(agents)) {
      throw new Error(`chat_list mismatch: relay=${listSignature(chatList.chats)} native=${listSignature(agents)}`);
    }
    console.log('chat_list exact', chatList.chats.length, 'agents');

    const chatStart = messages.length;
    const chatRequestId = `sw-chat-${runId}`;
    ws.send(JSON.stringify({
      type: 'switch_chat',
      session_id: sessionId,
      chat_id: target.id,
      request_id: chatRequestId,
    }));
    const chatCtrl = await waitFor(
      () => messages.find(m => m.type === 'agent_control_result' && m.request_id === chatRequestId),
      30000,
      'switch_chat result'
    );
    if (chatCtrl.result !== 'ok') throw new Error(`switch_chat failed: ${chatCtrl.result}`);
    const switched = await waitFor(async () => {
      const native = await readNative(page);
      const active = native.agents.filter(agent => agent && agent.active);
      return active.length === 1 && active[0].id === target.id ? native : null;
    }, 15000, 'exact native active agent after switch_chat');
    const history = await waitFor(
      () => historyEvent(messages, chatStart, sessionId),
      30000,
      'authoritative switch_chat history'
    );
    const relayNormalized = fidelity.normalizeMessages(history.messages, null);
    const nativeNormalized = fidelity.normalizeMessages(switched.messages, null);
    if (JSON.stringify(relayNormalized) !== JSON.stringify(nativeNormalized)) {
      throw new Error(`switch_chat history mismatch: relay=${history.messages.length} native=${switched.messages.length}`);
    }
    const switchedList = await waitFor(
      () => messages.slice(chatStart).find(m => m.type === 'chat_list'
        && (m.session || m.session_id) === sessionId
        && Array.isArray(m.chats)
        && m.chats.some(agent => agent.id === target.id && agent.active)),
      30000,
      'updated chat_list after switch_chat'
    );
    console.log('switch_chat exact', target.title, history.messages.length, 'messages', switchedList.chats.length, 'agents');

    const requestId = `sw-thread-${runId}`;
    ws.send(JSON.stringify({
      type: 'switch_thread',
      session_id: sessionId,
      thread_id: original.id,
      request_id: requestId,
    }));
    const ctrl = await waitFor(
      () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === requestId),
      30000,
      'switch_thread result'
    );
    if (ctrl.result !== 'ok') throw new Error(`switch_thread failed: ${ctrl.result}`);
    const settled = await waitFor(async () => {
      const latest = await readNative(page);
      const active = latest.agents.filter(agent => agent && agent.active);
      return active.length === 1 && active[0].id === original.id ? active[0] : null;
    }, 15000, 'exact native active agent');
    console.log('switch_thread restored', settled.title, 'expected', original.title);
    console.log('PASS cursor agent list/switch alias E2E');
  } finally {
    await restoreNativeAgent(page, original.id).catch(err => console.error('cleanup warning', err.message));
    try { ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FAIL', err.message);
    process.exit(1);
  });
}
