#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const expectedWorkspace = 'c:\\temp\\remote-agent-claude-cli-test';

function normalize(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function parseArgs(argv) {
  const out = { sendLive: false, sessionId: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--send-live') out.sendLive = true;
    else if (argv[index] === '--session-id' && argv[index + 1]) out.sessionId = argv[++index];
    else if (argv[index] === '--output' && argv[index + 1]) out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  assert(out.sendLive, 'Refusing Claude CLI preflight mutation without --send-live');
  assert(/^[0-9a-f-]{36}$/i.test(out.sessionId), '--session-id must be an explicit UUID');
  return out;
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(root, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || `${fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '')}/client-ws`;
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const value = predicate();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}

async function openRelay() {
  const messages = [];
  let sessions = [];
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    messages.push(message);
    if (Array.isArray(message.sessions)) sessions = message.sessions;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay connection timeout')), 30_000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello', protocol_version: 1, peer_role: 'browser',
        client_name: 'claude-cli-soak-preflight-reset',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  await waitFor(() => sessions.length > 0, 30_000, 'session inventory');
  return { ws, messages, sessions: () => sessions };
}

async function control(relay, sessionId, type, fields = {}) {
  const requestId = `claude-cli-preflight-${type}-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type, session_id: sessionId, request_id: requestId, ...fields }));
  const result = await waitFor(
    () => relay.messages.slice(start).find(message => (
      message.type === 'agent_control_result' && message.request_id === requestId
    )),
    60_000,
    `${type} control result`,
  );
  assert.strictEqual(result.result, 'ok', `${type} failed: ${JSON.stringify(result.error || result)}`);
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const relay = await openRelay();
  const startedAt = new Date().toISOString();
  try {
    const original = relay.sessions().find(session => session.session_id === options.sessionId);
    assert(original, `session is not present: ${options.sessionId}`);
    assert.strictEqual(original.agent_type, 'claude_cli', 'guarded session is not Claude CLI');
    assert.strictEqual(normalize(original.workspace_path), expectedWorkspace, 'guarded session is not in the disposable Claude CLI workspace');
    assert.strictEqual(original.status, 'healthy', 'guarded session is not healthy');
    assert.strictEqual(original.activity?.kind || 'idle', 'idle', 'guarded session is active');
    assert(
      original.model_id === '<synthetic>' || original.model_id === 'default',
      `guarded session has an unexpected model: ${original.model_id}`,
    );

    const setModel = original.model_id === 'default'
      ? null
      : await control(relay, options.sessionId, 'agent_set_model', { model_id: 'default' });
    await waitFor(() => {
      const current = relay.sessions().find(session => session.session_id === options.sessionId);
      return current?.model_id === 'default' ? current : null;
    }, 30_000, 'default model snapshot');

    const isReplacement = session => (
      session.session_id !== options.sessionId
      && session.agent_type === 'claude_cli'
      && normalize(session.workspace_path) === expectedWorkspace
      && session.model_id === 'default'
      && session.status === 'healthy'
      && (session.activity?.kind || 'idle') === 'idle'
      && /^[0-9a-f-]{36}$/i.test(session.cli_session_id || '')
    );
    let replacement = relay.sessions().find(isReplacement) || null;
    let newChat = null;
    if (!replacement) {
      const sessionIdsBefore = new Set(relay.sessions().map(session => session.session_id));
      newChat = await control(relay, options.sessionId, 'new_chat');
      replacement = await waitFor(
        () => relay.sessions().find(session => isReplacement(session) && !sessionIdsBefore.has(session.session_id)),
        60_000,
        'healthy idle default-model replacement',
      );
    }

    const result = {
      ok: true,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      original_session_id: options.sessionId,
      original_model_id: original.model_id,
      replacement_session_id: replacement.session_id,
      replacement_cli_session_id: replacement.cli_session_id,
      replacement_model_id: replacement.model_id,
      replacement_status: replacement.status,
      replacement_activity: replacement.activity?.kind || 'idle',
      workspace_path: replacement.workspace_path,
      set_model_result: setModel?.result || 'already_default',
      new_chat_result: newChat?.result || 'already_prepared',
      protected_user_sessions_touched: 0,
      visible_windows_opened: 0,
      native_window_launch_mode: 'background',
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    try { relay.ws.terminate(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude CLI soak preflight reset: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { normalize, parseArgs };
