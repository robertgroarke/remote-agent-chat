#!/usr/bin/env node
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

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

(async () => {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 30000);
    ws.once('open', () => { clearTimeout(t); ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser' })); res(); });
    ws.once('error', rej);
  });
  const sessions = await (async () => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (Array.isArray(m.sessions) && m.sessions.length) return m.sessions;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return [];
  })();
  const cursor = sessions.filter((s) => s.agent_type === 'cursor');
  console.log(`cursor sessions: ${cursor.length}`);
  if (!cursor.length) {
    console.log('no cursor sessions on relay');
    ws.close();
    return;
  }
  for (const s of cursor) {
    const sid = s.session_id || s;
    const req = `cap-${sid.slice(0, 8)}-${Date.now()}`;
    const before = messages.length;
    ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sid, request_id: req }));
    const deadline = Date.now() + 20000;
    let cfg = null;
    while (Date.now() < deadline) {
      cfg = messages.slice(before).find(
        (m) => m.type === 'agent_config'
          && (m.session_id === sid || m.session === sid)
          && (m.request_id === req || !m.request_id)
      );
      if (cfg?.capabilities) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(sid.slice(0, 8), s.workspace_name || s.display_name, {
      toggle: cfg?.capabilities?.auto_approve_permissions_toggle,
      enabled: cfg?.auto_approve_permissions,
    });
  }
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
