#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const EXPECTED_MODELS = ['default', 'sonnet', 'fable', 'opus', 'haiku'];

function parseArgs(argv) {
  const options = { resultFile: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
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

async function openRelay() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'vscode-claude-model-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function storedClaudeSession(sessionId) {
  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const sessions = Object.values(JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions || {});
  const matches = sessions.filter(session =>
    session.session_id === sessionId
    && session.agent_type === 'claude'
    && session.host_type === 'vscode'
    && Number(session.cdp_port) === guard.CDP_PORT
    && String(session.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
    && session.status === 'healthy'
  );
  assert.equal(matches.length, 1, `Expected one guarded Claude session, found ${matches.length}`);
  return matches[0];
}

function modelIds(config) {
  return (Array.isArray(config?.available_models) ? config.available_models : [])
    .map(model => typeof model === 'string' ? model : model?.id || model?.value)
    .filter(Boolean);
}

async function requestConfig(relay, sessionId, label) {
  const requestId = `claude-model-cfg-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config'
      && (message.session_id || message.session) === sessionId
      && (!message.request_id || message.request_id === requestId)
    ),
    30000,
    label,
  );
}

async function setModel(relay, sessionId, modelId, label) {
  const requestId = `claude-model-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'agent_set_model',
    session_id: sessionId,
    model_id: modelId,
    request_id: requestId,
  }));
  const control = await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_control_result' && message.request_id === requestId
    ),
    30000,
    `${label} control result`,
  );
  if (control.result !== 'ok') throw new Error(`${label} failed: ${JSON.stringify(control)}`);
  const broadcastConfig = await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config'
      && (message.session_id || message.session) === sessionId
      && message.model_id === modelId
    ),
    30000,
    `${label} confirming config`,
  );
  // Normal broadcasts are deliberately compact. A targeted config request must
  // return the relay's full cached config, including the live model choices.
  const config = await requestConfig(relay, sessionId, `${label} full config`);
  assert.equal(config.model_id, modelId, `${label} full config did not retain the selected model`);
  const actualModels = modelIds(config);
  assert.deepEqual(
    actualModels,
    EXPECTED_MODELS,
    `${label} returned the wrong Claude model list: ${JSON.stringify(actualModels)}`,
  );
  return { control, broadcastConfig, config };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Claude model E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Model E2E is restricted to disposable CDP port 9230');
  const relay = await openRelay();
  let session = null;
  let changed = false;
  try {
    const relaySession = await waitFor(() => latestSessions(relay.messages).find(candidate =>
      candidate?.agent_type === 'claude'
      && candidate?.host_type === 'vscode'
      && String(candidate?.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
      && candidate?.status === 'healthy'
    ), 90000, 'guarded live Claude relay session', 250);
    session = storedClaudeSession(relaySession.session_id);

    const initial = await requestConfig(relay, session.session_id, 'initial Claude model config');
    assert.deepEqual(modelIds(initial), EXPECTED_MODELS, 'initial Claude config did not advertise the live-verified model set');

    changed = true;
    const alternate = await setModel(relay, session.session_id, 'sonnet', 'alternate Claude model');
    await sleep(16500);
    const stable = await requestConfig(relay, session.session_id, 'post-poll Claude model config');
    assert.equal(stable.model_id, 'sonnet', 'passive config poll rolled back the confirmed Claude model');
    assert.deepEqual(modelIds(stable), EXPECTED_MODELS);

    const restored = await setModel(relay, session.session_id, 'fable', 'restored Claude model');
    changed = false;
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      initial_model: initial.model_id,
      alternate_model: alternate.config.model_id,
      stable_after_passive_poll: stable.model_id,
      restored_model: restored.config.model_id,
      available_models: modelIds(restored.config),
      protected_host: { port: 9223, untouched: true },
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (changed && session) {
      try { await setModel(relay, session.session_id, 'fable', 'finally restored Claude model'); } catch {}
    }
    try { relay.ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude model E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
