#!/usr/bin/env node
'use strict';
// Relay permission round-trip on throwaway Cursor session (YOLO off → Allow/Deny UI).
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
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-permission-e2e' }));
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

async function findCdpTarget() {
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'throwaway CDP page not open');
  guard.assertProbeTarget(page, __filename);
  return page;
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const cdpTarget = await findCdpTarget();
  const { ws, messages } = await openRelay(deriveRelayWsUrl());

  try {
    const session = await waitFor(() => {
      const s = latestSessions(messages).find((x) => x.agent_type === 'cursor' && sessionIdOf(x) === guard.THROWAWAY_SESSION_ID);
      return s || null;
    }, 45000, 'throwaway cursor session');
    const sessionId = sessionIdOf(session);
    console.log('session', sessionId);

    const offId = `perm-off-${runId}`;
    ws.send(JSON.stringify({
      type: 'agent_set_auto_approve_permissions',
      session_id: sessionId,
      enabled: false,
      request_id: offId,
    }));
    await waitFor(
      () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === offId && m.result === 'ok'),
      20000,
      'auto-approve off'
    );

    const prompt = `Run exactly this shell command and wait for my approval before executing: echo RAC_PERM_E2E_${runId}`;
    const requestId = `perm-e2e-${runId}`;
    ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: requestId }));

    await waitFor(
      () => messages.find((m) => m.type === 'proxy_send_result' && m.client_message_id === requestId && m.result === 'delivered'),
      90000,
      'proxy_send_result delivered'
    );

    const promptMsg = await waitFor(
      () => messages.find((m) => m.type === 'permission_prompt' && (m.session_id === sessionId || m.session === sessionId)),
      120000,
      'permission_prompt'
    );
    console.log('permission_prompt', promptMsg.prompt_id, (promptMsg.choices || []).map((c) => c.choice_id));

    const respId = `perm-resp-${runId}`;
    ws.send(JSON.stringify({
      type: 'permission_response',
      session_id: sessionId,
      prompt_id: promptMsg.prompt_id,
      choice_id: 'allow',
      request_id: respId,
    }));

    const ctrl = await waitFor(
      () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === respId),
      30000,
      'permission_response control result'
    );
    if (ctrl.result !== 'ok') throw new Error(`permission_response failed: ${ctrl.result} ${ctrl.error?.message || ''}`);
    console.log('permission_response ok');

    const client = await CDP({ port: CDP_PORT, target: cdpTarget.id });
    try {
      await client.Runtime.enable();
      const still = await cursorSel.detectCursorPermissionDialog(client.Runtime);
      if (still && still.choices?.length) console.warn('WARN permission dialog still visible after allow');
    } finally {
      try { await client.close(); } catch {}
    }

    console.log('PASS cursor permission relay E2E');
  } finally {
    try { ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FAIL', err.message);
    process.exit(1);
  });
}
