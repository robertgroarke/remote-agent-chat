#!/usr/bin/env node
'use strict';
// Enable auto-approve, restart proxy externally, verify preference restores on reconnect.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const SESSION_ID = guard.THROWAWAY_SESSION_ID;
const ROOT = path.join(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'agent-proxy', 'session-store.json');

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
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

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

async function openRelay(clientName) {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: clientName,
      }));
      res();
    });
    ws.once('error', rej);
  });
  return { ws, messages };
}

async function waitForThrowawaySession(messages) {
  await waitFor(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!Array.isArray(m.sessions)) continue;
      if (m.sessions.some((s) => (s.session_id || s) === SESSION_ID)) return true;
    }
    return null;
  }, 45000, 'throwaway session in session_list');
}

async function setAutoApprove(ws, messages, enabled) {
  const requestId = `autoap-${crypto.randomBytes(4).toString('hex')}`;
  const before = messages.length;
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
  const cfg = messages.slice(before).find(
    (m) => m.type === 'agent_config'
      && (m.session_id === SESSION_ID || m.session === SESSION_ID)
      && m.auto_approve_permissions === enabled
  ) || messages.filter(
    (m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID)
  ).pop();
  if (!!cfg?.auto_approve_permissions !== enabled) {
    throw new Error(`agent_config auto_approve_permissions not ${enabled} after toggle`);
  }
  return cfg;
}

async function requestAgentConfig(ws, messages) {
  const requestId = `cfg-${Date.now()}`;
  const before = messages.length;
  ws.send(JSON.stringify({
    type: 'agent_config_request',
    session_id: SESSION_ID,
    request_id: requestId,
  }));
  const cfg = await waitFor(
    () => messages.slice(before).find(
      (m) => m.type === 'agent_config'
        && (m.session_id === SESSION_ID || m.session === SESSION_ID)
        && m.request_id === requestId
    ) || messages.filter(
      (m) => m.type === 'agent_config' && (m.session_id === SESSION_ID || m.session === SESSION_ID)
    ).pop(),
    30000,
    'agent_config_request response'
  );
  return cfg;
}

function assertStorePersisted() {
  const store = readStore();
  const sess = store.sessions?.[SESSION_ID];
  if (!sess?.auto_approve_permissions) {
    throw new Error('session-store session flag not true before restart');
  }
  const prefKeys = Object.keys(store.preferences || {}).filter((k) => k.startsWith('cursor|'));
  const prefHit = prefKeys.some((k) => store.preferences[k]?.auto_approve_permissions === true);
  if (!prefHit) {
    throw new Error(`no cursor preference key with auto_approve true (keys: ${prefKeys.join(', ')})`);
  }
}

async function main() {
  const { ws, messages } = await openRelay('cursor-auto-restore');
  try {
    await waitForThrowawaySession(messages);
    await setAutoApprove(ws, messages, true);
    assertStorePersisted();
    console.log('enabled auto-approve ON before restart');
  } finally {
    try { ws.close(); } catch {}
  }

  const r = spawnSync('python', ['proxy_restart_lock.py', '--agent', 'auto-approve-restore'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`proxy restart failed: ${r.stderr || r.stdout}`);

  const { ws: ws2, messages: messages2 } = await openRelay('cursor-auto-restore-verify');
  try {
    await waitForThrowawaySession(messages2);
    const cfg = await requestAgentConfig(ws2, messages2);
    if (!cfg?.auto_approve_permissions) {
      throw new Error('auto_approve not restored after proxy restart');
    }
    const store = readStore();
    const prefKeys = Object.keys(store.preferences || {}).filter((k) => k.startsWith('cursor|'));
    const prefOn = prefKeys.some((k) => store.preferences[k]?.auto_approve_permissions === true);
    if (!prefOn) {
      throw new Error(`session-store preference not true after restart (keys: ${prefKeys.join(', ')})`);
    }
    console.log('PASS preference restored after restart', cfg.auto_approve_permissions);
  } finally {
    try { ws2.close(); } catch {}
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
