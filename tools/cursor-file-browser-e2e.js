#!/usr/bin/env node
'use strict';
// Relay-driven Cursor file browser verification, confined to the throwaway workspace.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const THROWAWAY_ROOT = path.resolve('C:\\temp\\cursor-test');
const README_PATH = path.join(THROWAWAY_ROOT, 'README.md');

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
    if (Array.isArray(messages[i].sessions)) return messages[i].sessions;
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
        client_name: 'cursor-file-browser-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function control(ws, messages, sessionId, type, runId, extra = {}) {
  const requestId = `${type}-${runId}-${crypto.randomBytes(2).toString('hex')}`;
  ws.send(JSON.stringify({ type, protocol_version: 1, session_id: sessionId, request_id: requestId, ...extra }));
  const result = await waitFor(
    () => messages.find(message => message.type === 'agent_control_result' && message.request_id === requestId),
    45000,
    `${type} result`,
  );
  return { requestId, result };
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const { ws, messages } = await openRelay();
  try {
    const session = await waitFor(
      () => guard.pickThrowawaySession(latestSessions(messages)),
      45000,
      'guarded throwaway Cursor session',
    );
    const sessionId = session.session_id || session.id;
    assert.equal(path.resolve(session.workspace_path || '').toLowerCase(), THROWAWAY_ROOT.toLowerCase(),
      `refusing file browser test outside ${THROWAWAY_ROOT}`);

    const configRequestId = `file-config-${runId}`;
    ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: configRequestId }));
    const config = await waitFor(
      () => messages.find(message =>
        message.type === 'agent_config'
        && (message.session_id === sessionId || message.session === sessionId)
        && message.capabilities),
      20000,
      'Cursor capability response',
    );
    assert.equal(config.capabilities.file_browser, true, 'file_browser capability must be true');

    const listingRequest = `list_directory-${runId}`;
    ws.send(JSON.stringify({
      type: 'list_directory', protocol_version: 1, session_id: sessionId,
      request_id: listingRequest, path: '.',
    }));
    const listing = await waitFor(
      () => messages.find(message => message.type === 'directory_listing' && message.request_id === listingRequest),
      45000,
      'directory listing payload',
    );
    const listingResult = await waitFor(
      () => messages.find(message => message.type === 'agent_control_result' && message.request_id === listingRequest),
      45000,
      'directory listing result',
    );
    assert.equal(listingResult.result, 'ok');
    const readme = listing.entries.find(entry => entry.name === 'README.md');
    assert(readme, 'README.md missing from root listing');
    assert.equal(readme.type, 'file');
    assert.equal(readme.size, fs.statSync(README_PATH).size, 'README.md listing size mismatch');
    assert(!listing.entries.some(entry => entry.name === '.vscode'), 'hidden directories must not be exposed');

    const fileRequest = `read_file-${runId}`;
    ws.send(JSON.stringify({
      type: 'read_file', protocol_version: 1, session_id: sessionId,
      request_id: fileRequest, path: 'README.md', max_size: 4096,
    }));
    const file = await waitFor(
      () => messages.find(message => message.type === 'file_content' && message.request_id === fileRequest),
      45000,
      'file content payload',
    );
    const fileResult = await waitFor(
      () => messages.find(message => message.type === 'agent_control_result' && message.request_id === fileRequest),
      45000,
      'file content result',
    );
    assert.equal(fileResult.result, 'ok');
    assert.equal(file.truncated, false);
    assert.equal(file.content, fs.readFileSync(README_PATH, 'utf8'), 'README.md content mismatch');

    const traversal = await control(ws, messages, sessionId, 'list_directory', runId, { path: '..' });
    assert.equal(traversal.result.result, 'failed', 'workspace traversal must fail');
    assert.equal(traversal.result.error?.code, 'path_traversal');

    console.log(`PASS guarded file browser ${sessionId.slice(0, 8)} ${readme.size} bytes + traversal blocked`);
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch(error => {
  console.error('FAIL', error.message);
  process.exit(1);
});
