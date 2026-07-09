#!/usr/bin/env node
'use strict';
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
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
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const wsUrl = deriveRelayWsUrl();
  const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-filechange-e2e' }));
      res();
    });
    ws.once('error', rej);
  });

  try {
    const session = await waitFor(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!Array.isArray(m.sessions)) continue;
        return guard.pickThrowawaySession(m.sessions);
      }
      return null;
    }, 45000, 'session');

    const sessionId = session.session_id || session;

    const targets = await CDP.List({ port: 9227 });
    const { page, blocked } = guard.pickProbePage(targets);
    if (blocked || !page) throw new Error(blocked || 'no throwaway CDP');
    guard.assertProbeTarget(page, __filename);
    const cdp = await CDP({ port: 9227, target: page.id });
    await cdp.Runtime.enable();
    await cursorSel.sendCursorMessage(
      cdp.Runtime,
      cdp,
      'Edit README.md: append a new final line exactly RAC_FILECHG_E2E_' + runId + ' (one line only).'
    );
    await cdp.close();

    let entry = null;
    for (let attempt = 0; attempt < 24 && !entry; attempt++) {
      const reqList = `fc-list-${runId}-${attempt}`;
      const before = messages.length;
      ws.send(JSON.stringify({ type: 'file_changes', session_id: sessionId, request_id: reqList }));
      await waitFor(
        () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === reqList && m.result === 'ok'),
        15000,
        'file_changes ack'
      );
      const payload = messages.slice(before).find((m) => m.type === 'file_changes' && (m.session_id === sessionId || m.session === sessionId));
      const entries = payload?.entries || [];
      entry = entries.find((e) => e.can_reject || e.can_accept);
      if (!entry) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!entry || !entry.can_reject) throw new Error('No rejectable file change on throwaway');

    const changeId = entry.id || entry.path;
    const reqRej = `fc-rej-${runId}`;
    ws.send(JSON.stringify({
      type: 'file_change_response',
      session_id: sessionId,
      change_id: changeId,
      action: 'reject',
      request_id: reqRej,
    }));
    const rejRes = await waitFor(
      () => messages.find((m) => m.type === 'agent_control_result' && m.request_id === reqRej),
      30000,
      'file_change_response'
    );
    if (rejRes.result !== 'ok') throw new Error(`reject failed: ${rejRes.result}`);
    console.log('PASS file_change_response reject', changeId);
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
