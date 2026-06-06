#!/usr/bin/env node
'use strict';
// Relay-driven auto-approve verification for throwaway Cursor session.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const SESSION_ID = guard.THROWAWAY_SESSION_ID;
const STORE_PATH = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');

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
        if (v) return resolve(v);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out: ${label}`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function openRelay() {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-auto-approve-e2e' }));
      res();
    });
    ws.once('error', rej);
  });
  return { ws, messages };
}

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

async function setAutoApprove(ws, messages, enabled) {
  const requestId = `autoap-${crypto.randomBytes(4).toString('hex')}`;
  ws.send(JSON.stringify({
    type: 'agent_set_auto_approve_permissions',
    session_id: SESSION_ID,
    enabled,
    request_id: requestId,
  }));
  const ctrl = await waitFor(
    () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === requestId),
    20000,
    'agent_set_auto_approve_permissions'
  );
  if (ctrl.result !== 'ok') throw new Error(`toggle failed: ${ctrl.result}`);
  const cfg = await waitFor(
    () => messages.find((m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID)),
    15000,
    'agent_config after toggle'
  );
  return cfg;
}

async function main() {
  const { ws, messages } = await openRelay();
  try {
    await waitFor(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!Array.isArray(m.sessions)) continue;
        const s = m.sessions.find((x) => (x.session_id || x) === SESSION_ID);
        if (s) return s;
      }
      return null;
    }, 45000, 'throwaway session');

    const cfgReq = `cfg-req-${Date.now()}`;
    ws.send(JSON.stringify({ type: 'agent_config_request', session_id: SESSION_ID, request_id: cfgReq }));
    const cfg0 = await waitFor(
      () => messages.find((m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID) && m.capabilities),
      20000,
      'agent_config'
    );
    if (!cfg0.capabilities?.auto_approve_permissions_toggle) {
      throw new Error('auto_approve_permissions_toggle capability missing on cursor session');
    }
    console.log('PASS capability flag true');

    const beforeLen = messages.length;
    await setAutoApprove(ws, messages, true);
    const cfgOn = messages.slice(beforeLen).find(
      (m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID) && m.auto_approve_permissions === true
    ) || messages.filter((m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID)).pop();
    if (!cfgOn?.auto_approve_permissions) throw new Error('agent_config auto_approve_permissions not true after ON');
    console.log('PASS toggle ON in agent_config');

    const store = readStore();
    const sess = store.sessions?.[SESSION_ID];
    if (!sess?.auto_approve_permissions) throw new Error('session-store session flag not true');
    const prefKeys = Object.keys(store.preferences || {}).filter((k) => k.startsWith('cursor|'));
    const prefHit = prefKeys.some((k) => store.preferences[k]?.auto_approve_permissions === true);
    if (!prefHit) throw new Error(`no cursor preference key with auto_approve true (keys: ${prefKeys.join(', ')})`);
    console.log('PASS session-store persisted', prefKeys.find((k) => store.preferences[k]?.auto_approve_permissions));

    await setAutoApprove(ws, messages, false);
    const cfgOff = messages.filter((m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID)).pop();
    if (cfgOff?.auto_approve_permissions) throw new Error('toggle OFF did not clear agent_config');
    console.log('PASS toggle OFF');

    console.log('PASS cursor auto-approve relay E2E (capability + store + toggle)');
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
