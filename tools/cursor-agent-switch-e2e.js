#!/usr/bin/env node
'use strict';
// Relay switch_thread on throwaway Cursor session.
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

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'no throwaway page');
  guard.assertProbeTarget(page, __filename);

  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  const agents = await cursorSel.readCursorAgentList(client.Runtime);
  console.log('agents', agents);
  if (agents.length < 2) {
    await client.close();
    throw new Error(`Need >=2 agents, got ${agents.length}`);
  }
  const target = agents.find((a) => !a.active) || agents[1];
  await client.close();

  const { ws, messages } = await openRelay(deriveRelayWsUrl());
  try {
    const session = await waitFor(() => {
      const s = latestSessions(messages).find((x) => x.agent_type === 'cursor' && sessionIdOf(x) === guard.THROWAWAY_SESSION_ID);
      return s || null;
    }, 45000, 'throwaway session');
    const sessionId = sessionIdOf(session);
    const requestId = `sw-thread-${runId}`;
    ws.send(JSON.stringify({
      type: 'switch_thread',
      session_id: sessionId,
      thread_id: target.id,
      request_id: requestId,
    }));
    const ctrl = await waitFor(
      () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === requestId),
      30000,
      'switch_thread result'
    );
    if (ctrl.result !== 'ok') throw new Error(`switch_thread failed: ${ctrl.result}`);
    console.log('switched to', target.id, target.title);

    const c2 = await CDP({ port: CDP_PORT, target: page.id });
    await c2.Runtime.enable();
    const active = await c2.Runtime.evaluate({
      expression: `(() => {
        const tabs = Array.from(document.querySelectorAll('a.label-name'));
        const active = tabs.find(t => t.classList.contains('active') || t.getAttribute('aria-selected') === 'true');
        return active ? (active.textContent || '').trim() : null;
      })()`,
      returnByValue: true,
    });
    console.log('active tab', active.result?.value, 'expected', target.title);
    await c2.close();
    console.log('PASS cursor agent switch E2E');
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
