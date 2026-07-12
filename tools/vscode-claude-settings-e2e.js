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
        client_name: 'vscode-claude-settings-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function fileHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function storedClaudeSession(sessionId) {
  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const sessions = Object.values(JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions || {});
  const matches = sessions.filter(session =>
    (!sessionId || session.session_id === sessionId)
    &&
    session.agent_type === 'claude'
    && session.host_type === 'vscode'
    && Number(session.cdp_port) === guard.CDP_PORT
    && String(session.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
    && session.status === 'healthy'
  );
  assert.equal(matches.length, 1, `Expected one guarded Claude session, found ${matches.length}`);
  return matches[0];
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

async function requestConfig(relay, sessionId, label) {
  const requestId = `claude-cfg-${crypto.randomBytes(4).toString('hex')}`;
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

async function setPermissionMode(relay, sessionId, mode, label) {
  const requestId = `claude-permission-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'agent_set_permission_mode',
    session_id: sessionId,
    mode,
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
  const config = await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config'
      && (message.session_id || message.session) === sessionId
      && message.permission_mode === mode
    ),
    30000,
    `${label} confirming agent_config`,
  );
  return { control, config };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Claude settings E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Settings E2E is restricted to disposable CDP port 9230');
  const relay = await openRelay();
  let session = null;
  let originalMode = null;
  let restored = false;
  try {
    // Browser-facing relay snapshots deliberately omit the internal CDP port.
    // Select the unique disposable host/workspace here, then require the local
    // durable record to prove the exact guarded port before any mutation.
    const relaySession = await waitFor(() => latestSessions(relay.messages).find(session =>
      session?.agent_type === 'claude'
      && session?.host_type === 'vscode'
      && String(session?.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
      && session?.status === 'healthy'
    ), 90000, 'guarded live Claude relay session', 250);
    session = storedClaudeSession(relaySession.session_id);
    const userDataRoot = path.resolve(guard.USER_DATA_DIR);
    const settingsPath = path.join(userDataRoot, 'User', 'settings.json');
    const antigravityPath = path.join(process.env.APPDATA || '', 'Antigravity', 'User', 'settings.json');
    const antigravityBefore = fileHash(antigravityPath);
    const initial = await requestConfig(relay, session.session_id, 'initial Claude config');
    originalMode = String(initial.permission_mode || '').trim();
    const modes = (Array.isArray(initial.available_permission_modes) ? initial.available_permission_modes : [])
      .map(mode => typeof mode === 'string' ? mode : mode?.id || mode?.value)
      .filter(Boolean);
    assert(originalMode, 'Claude config did not report a permission mode');
    const alternateMode = modes.find(mode => mode && mode !== originalMode)
      || (originalMode === 'plan' ? 'default' : 'plan');

    const changed = await setPermissionMode(relay, session.session_id, alternateMode, 'alternate permission mode');
    const changedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(changedSettings['claudeCode.initialPermissionMode'], alternateMode,
      'alternate mode was not persisted to the disposable VS Code profile');
    assert.equal(fileHash(antigravityPath), antigravityBefore,
      'VS Code-hosted permission change mutated Antigravity settings');

    const restoredResult = await setPermissionMode(relay, session.session_id, originalMode, 'restored permission mode');
    restored = true;
    const restoredSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(restoredSettings['claudeCode.initialPermissionMode'], originalMode);
    assert.equal(fileHash(antigravityPath), antigravityBefore);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      user_data_dir: userDataRoot,
      settings_path: settingsPath,
      original_mode: originalMode,
      alternate_mode: alternateMode,
      alternate_control: changed.control.result,
      restore_control: restoredResult.control.result,
      restored,
      antigravity_settings_unchanged: true,
      protected_host: { port: 9223, untouched: true },
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (!restored && session && originalMode) {
      try { await setPermissionMode(relay, session.session_id, originalMode, 'finally restore permission mode'); } catch {}
    }
    try { relay.ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude settings E2E: FAIL (${error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
