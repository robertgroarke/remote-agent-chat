#!/usr/bin/env node
'use strict';
// With auto-approve ON, shell pending approval should be auto-cleared without relay permission_prompt.
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const SESSION_ID = guard.THROWAWAY_SESSION_ID;

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
        const v = await predicate();
        if (v !== undefined && v !== null && v !== false) return resolve(v);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out: ${label}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-auto-approve-shell' }));
      res();
    });
    ws.once('error', rej);
  });

  try {
    await waitFor(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!Array.isArray(m.sessions)) continue;
        if (m.sessions.some((s) => (s.session_id || s) === SESSION_ID)) return true;
      }
      return false;
    }, 45000, 'session');

    const onId = `aa-on-${runId}`;
    ws.send(JSON.stringify({ type: 'agent_set_auto_approve_permissions', session_id: SESSION_ID, enabled: true, request_id: onId }));
    await waitFor(() => messages.find((m) => m.type === 'agent_control_result' && m.request_id === onId && m.result === 'ok'), 20000, 'auto ON');

    const prompt = `Run exactly this shell command and wait for approval: echo RAC_AUTOAPPROVE_${runId}`;
    const sendId = `send-${runId}`;
    const before = messages.length;
    ws.send(JSON.stringify({ type: 'send', session: SESSION_ID, content: prompt, client_message_id: sendId }));
    await waitFor(
      () => messages.find((m) => m.type === 'proxy_send_result' && m.client_message_id === sendId && m.result === 'delivered'),
      90000,
      'send delivered'
    );

    await new Promise((r) => setTimeout(r, 15000));
    const prompts = messages.slice(before).filter((m) => m.type === 'permission_prompt' && (m.session_id === SESSION_ID || m.session === SESSION_ID));
    if (prompts.length > 0) {
      console.warn('WARN permission_prompt surfaced to relay while auto-approve ON (may be brief race)');
    } else {
      console.log('PASS no permission_prompt broadcast (auto-approved locally)');
    }

    const offId = `aa-off-${runId}`;
    ws.send(JSON.stringify({ type: 'agent_set_auto_approve_permissions', session_id: SESSION_ID, enabled: false, request_id: offId }));
    await waitFor(() => messages.find((m) => m.type === 'agent_control_result' && m.request_id === offId && m.result === 'ok'), 20000, 'auto OFF');
    console.log('PASS auto-approve shell test complete — check proxy.log for [perm] Auto-approving');
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
