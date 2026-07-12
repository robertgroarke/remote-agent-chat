#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = { resultFile: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 150) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/client-ws';
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelayOnce() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('relay open timeout'));
    }, 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'vscode-codex-config-gate-e2e',
      }));
      resolve();
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { ws, messages };
}

async function openRelay() {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await openRelayOnce(); } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(2000);
    }
  }
  throw lastError;
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function storedCodexSession(sessionId, targetId) {
  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const sessions = Object.values(JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions || {});
  const matches = sessions.filter(session =>
    session.session_id === sessionId
    && session.agent_type === 'codex'
    && session.host_type === 'vscode'
    && Number(session.cdp_port) === guard.CDP_PORT
    && session.target_id === targetId
    && String(session.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
    && session.status === 'healthy'
  );
  assert.equal(matches.length, 1, `Expected one guarded Codex session, found ${matches.length}`);
  return matches[0];
}

async function requestConfig(relay, sessionId, label) {
  const requestId = `codex-config-gate-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'agent_config' && message.request_id === requestId),
    30000,
    label,
  );
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Codex config gate E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Codex config gate E2E is restricted to disposable CDP port 9230');

  const targets = await CDP.List({ port: guard.CDP_PORT });
  const pages = targets.filter(guard.isThrowawayWorkbench);
  const frames = targets.filter(target => guard.isThrowawayIframe(target, 'codex'));
  assert.equal(pages.length, 1, `Expected one disposable workbench, found ${pages.length}`);
  assert.equal(frames.length, 1, `Expected one disposable Codex frame, found ${frames.length}`);
  const frame = frames[0];
  const relay = await openRelay();
  try {
    const relaySession = await waitFor(() => latestSessions(relay.messages).find(candidate =>
      candidate?.agent_type === 'codex'
      && candidate?.host_type === 'vscode'
      && String(candidate?.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
      && candidate?.status === 'healthy'
    ), 90000, 'guarded live Codex relay session', 250);
    const session = storedCodexSession(relaySession.session_id, frame.id);
    const initial = await requestConfig(relay, session.session_id, 'initial Codex config gate');
    assert.equal(initial?.capabilities?.set_codex_config, false, 'VS Code Codex still advertises shared config mutation');
    assert(initial.model_id && initial.model_id !== 'unknown', 'Codex current model is unknown');

    const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
    const hashBefore = sha256(configPath);
    const requestId = `codex-config-reject-${crypto.randomBytes(4).toString('hex')}`;
    const start = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'set_codex_config',
      session_id: session.session_id,
      request_id: requestId,
      model_id: initial.model_id,
    }));
    const control = await waitFor(() => relay.messages.slice(start).find(message =>
      message.type === 'agent_control_result' && message.request_id === requestId
    ), 30000, 'rejected direct Codex config request');
    assert.equal(control.result, 'failed', JSON.stringify(control));
    assert.equal(control.error?.code, 'not_supported', JSON.stringify(control));
    const hashAfter = sha256(configPath);
    assert.equal(hashAfter, hashBefore, 'Rejected VS Code Codex request changed the shared config');

    const final = await requestConfig(relay, session.session_id, 'final Codex config gate');
    assert.equal(final.capabilities?.set_codex_config, false);
    assert.equal(final.model_id, initial.model_id);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      target_id: frame.id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      model_id: initial.model_id,
      set_codex_config: final.capabilities.set_codex_config,
      direct_request_result: control.result,
      direct_request_code: control.error.code,
      shared_config_unchanged: hashBefore === hashAfter,
      shared_config_sha256: hashAfter,
      protected_host: { port: 9223, untouched: true },
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try { relay.ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Codex config gate E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
