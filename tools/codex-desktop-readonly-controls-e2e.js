#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const fidelity = require('./run-fidelity-regression');

const TIMEOUT_MS = Number(process.env.CODEX_DESKTOP_CONTROL_E2E_TIMEOUT_MS || 30000);

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = url => token
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        return reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function request(ws, messages, sessionId, type) {
  const requestId = `${type}-${crypto.randomBytes(5).toString('hex')}`;
  const startIndex = messages.length;
  const startedAt = Date.now();
  ws.send(JSON.stringify({ type, session_id: sessionId, request_id: requestId }));
  const result = await waitFor(
    () => messages.slice(startIndex).find(message =>
      message.type === 'agent_control_result' && message.request_id === requestId),
    `${type} control result`,
  );
  assert.equal(result.result, 'ok', `${type} control result must be ok`);
  const payload = await waitFor(
    () => messages.slice(startIndex).find(message =>
      message.type === type && (message.session_id === sessionId || message.session === sessionId)),
    `${type} payload`,
  );
  return { payload, elapsedMs: Date.now() - startedAt };
}

async function main() {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => {
    try { messages.push(JSON.parse(data.toString())); } catch {}
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay websocket open timed out')), TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'codex-desktop-readonly-controls-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });

  try {
    const session = await waitFor(() => {
      for (let index = messages.length - 1; index >= 0; index--) {
        const sessions = messages[index]?.sessions;
        if (!Array.isArray(sessions)) continue;
        return sessions.find(item => item.agent_type === 'codex-desktop' && item.status !== 'disconnected') || null;
      }
      return null;
    }, 'Codex Desktop relay session');
    const sessionId = session.session_id || session;

    const configRequestId = `config-${crypto.randomBytes(5).toString('hex')}`;
    const configStart = messages.length;
    ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: configRequestId }));
    const config = await waitFor(
      () => messages.slice(configStart).find(message =>
        message.type === 'agent_config' && (message.session_id === sessionId || message.session === sessionId)),
      'Codex Desktop agent config',
    );
    assert.equal(config.capabilities?.terminal_output, true);
    assert.equal(config.capabilities?.file_changes, true);
    assert.equal(config.capabilities?.terminal_input, false);

    const terminal = await request(ws, messages, sessionId, 'terminal_output');
    const terminalEntries = terminal.payload.entries || [];
    assert(terminalEntries.length >= 100, `expected substantial terminal history, got ${terminalEntries.length}`);
    assert(terminalEntries.every(entry => entry.collapsed === false), 'terminal entries must be expanded by default');
    assert(terminalEntries.every(entry => typeof entry.output === 'string'), 'terminal output must be string-preserved');
    assert(terminalEntries.some(entry => entry.output.length >= 500), 'substantial terminal output was truncated or absent');

    const changes = await request(ws, messages, sessionId, 'file_changes');
    const changeEntries = changes.payload.entries || [];
    assert(changeEntries.length >= 5, `expected file-change history, got ${changeEntries.length}`);
    assert(changeEntries.every(entry => entry.can_accept === false && entry.can_reject === false),
      'unsupported Codex Desktop file-change actions must remain inactive');
    assert(changeEntries.every(entry => typeof entry.content === 'string'), 'file-change content must be string-preserved');

    assert(terminal.elapsedMs < 10000, `terminal_output took ${terminal.elapsedMs}ms`);
    assert(changes.elapsedMs < 10000, `file_changes took ${changes.elapsedMs}ms`);
    console.log(
      `Codex Desktop read-only controls E2E: PASS ` +
      `(${terminalEntries.length} terminal in ${terminal.elapsedMs}ms, ` +
      `${changeEntries.length} file changes in ${changes.elapsedMs}ms)`,
    );
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch(error => {
  console.error(`Codex Desktop read-only controls E2E: FAIL (${error.message})`);
  process.exit(1);
});
