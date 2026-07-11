#!/usr/bin/env node
'use strict';
// Relay-driven Cursor terminal input verification, confined to the throwaway workspace.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const THROWAWAY_ROOT = path.resolve('C:\\temp\\cursor-test');

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = url => token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (Array.isArray(message.sessions)) return message.sessions;
  }
  return [];
}

async function openRelay() {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay connection timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'cursor-terminal-input-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function main() {
  const runId = crypto.randomBytes(5).toString('hex');
  const token = `RAC_CURSOR_TERMINAL_${runId}`;
  const filename = `.rac-terminal-input-${runId}.txt`;
  const markerPath = path.join(THROWAWAY_ROOT, filename);
  const { ws, messages } = await openRelay();

  try {
    const session = await waitFor(
      () => guard.pickThrowawaySession(latestSessions(messages)),
      45000,
      'guarded throwaway Cursor session',
    );
    const sessionId = session.session_id || session.id;
    const workspacePath = path.resolve(session.workspace_path || '');
    assert.equal(workspacePath.toLowerCase(), THROWAWAY_ROOT.toLowerCase(),
      `refusing terminal mutation outside ${THROWAWAY_ROOT}: ${workspacePath}`);

    const configRequestId = `terminal-config-${runId}`;
    ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: configRequestId }));
    const config = await waitFor(
      () => messages.find(message =>
        message.type === 'agent_config'
        && (message.session_id === sessionId || message.session === sessionId)
        && message.capabilities),
      20000,
      'Cursor capability response',
    );
    assert.equal(config.capabilities.terminal_input, true, 'terminal_input capability must be true');
    assert.equal(config.capabilities.terminal_output, false, 'Cursor terminal_output must remain gated false');

    const requestId = `terminal-input-${runId}`;
    const command = `node -e \"require('fs').writeFileSync('${filename}','${token}')\"`;
    ws.send(JSON.stringify({
      type: 'terminal_input',
      protocol_version: 1,
      session_id: sessionId,
      request_id: requestId,
      text: command,
    }));
    const result = await waitFor(
      () => messages.find(message => message.type === 'agent_control_result' && message.request_id === requestId),
      30000,
      'terminal_input result',
    );
    assert.equal(result.result, 'ok', `terminal_input failed: ${JSON.stringify(result.error || {})}`);
    await waitFor(() => fs.existsSync(markerPath), 15000, 'terminal marker file');
    assert.equal(fs.readFileSync(markerPath, 'utf8'), token, 'terminal marker content mismatch');

    console.log(`PASS guarded terminal input ${sessionId.slice(0, 8)} ${filename}`);
  } finally {
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}
    try { ws.close(); } catch {}
  }
}

main().catch(error => {
  console.error('FAIL', error.message);
  process.exit(1);
});
