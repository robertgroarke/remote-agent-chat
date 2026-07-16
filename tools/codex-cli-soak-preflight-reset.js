#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const codexCli = require('../agent-proxy/codex-cli');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const root = path.resolve(__dirname, '..');
const expectedWorkspace = 'c:\\temp\\remote-agent-vscode-test';
// Use the model that produced real post-reset assistant rows in the guarded
// latency lane. gpt-5.5 currently accepts the control but terminates without
// assistant output, which would make the formal soak fail before cycle one.
const soakModel = 'gpt-5.4-mini';
const soakEffort = 'low';

function normalize(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function parseArgs(argv) {
  const options = { sendLive: false, sessionId: '', output: '', model: soakModel };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--send-live') options.sendLive = true;
    else if (argv[index] === '--session-id' && argv[index + 1]) options.sessionId = argv[++index];
    else if (argv[index] === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--model' && argv[index + 1]) options.model = String(argv[++index]).trim();
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  assert(options.sendLive, 'Refusing Codex CLI preflight mutation without --send-live');
  assert(/^[0-9a-f-]{36}$/i.test(options.sessionId), '--session-id must be an explicit UUID');
  assert(options.output, '--output is required');
  assert(codexCli.CODEX_CLI_MODELS.some(model => model.id === options.model),
    `--model must be one of: ${codexCli.CODEX_CLI_MODELS.map(model => model.id).join(', ')}`);
  return options;
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
    if (messages.length > 10_000) messages.splice(0, messages.length - 10_000);
    if (Array.isArray(message.sessions)) sessions = message.sessions;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay connection timeout')), 30_000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello', protocol_version: 1, peer_role: 'browser',
        client_name: 'codex-cli-soak-preflight-reset',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  await waitFor(() => sessions.length > 0, 30_000, 'session inventory');
  return { ws, messages, sessions: () => sessions };
}

async function control(relay, sessionId, type, fields = {}) {
  const requestId = `codex-cli-preflight-${type}-${crypto.randomBytes(4).toString('hex')}`;
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

async function historyTail(relay, sessionId) {
  const requestId = `codex-cli-preflight-history-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'history_chunk_request', session_id: sessionId, session: sessionId,
    request_id: requestId, mode: 'tail', source: 'relay_sqlite', replace: true, limit: 100,
  }));
  return waitFor(
    () => relay.messages.slice(start).find(message => (
      message.type === 'history_chunk' && message.request_id === requestId
    )),
    30_000,
    'relay history proof',
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const lockPayload = `${JSON.stringify({
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    agent: 'codex-cli-soak-preflight-reset',
    kind: 'production-preflight',
  })}\n`;
  const releaseLock = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    lockPayload,
  );
  let relay;
  const startedAt = new Date().toISOString();
  const result = {
    ok: false,
    started_at: startedAt,
    source_session_id: options.sessionId,
    target_model: options.model,
    target_effort: soakEffort,
    visible_windows_opened: 0,
    focus_actions: 0,
  };
  try {
    relay = await openRelay();
    const source = relay.sessions().find(session => session.session_id === options.sessionId);
    assert(source, `session is not present: ${options.sessionId}`);
    assert.strictEqual(source.agent_type, 'codex_cli', 'guarded session is not Codex CLI');
    assert.strictEqual(normalize(source.workspace_path), expectedWorkspace, 'guarded session is not in the disposable workspace');
    assert.strictEqual(source.status, 'healthy', 'guarded session is not healthy');
    assert.strictEqual(source.activity?.kind || 'idle', 'idle', 'guarded session is active');

    result.set_model = await control(relay, source.session_id, 'agent_set_model', { model_id: options.model });
    result.set_effort = await control(relay, source.session_id, 'agent_set_effort', { effort: soakEffort });
    await waitFor(() => relay.messages.find(message => (
      message.type === 'agent_config'
      && (message.session_id || message.session) === source.session_id
      && message.model_id === options.model
      && message.effort === soakEffort
    )), 30_000, 'source config confirmation');

    const idsBefore = new Set(relay.sessions().map(session => session.session_id));
    result.new_chat = await control(relay, source.session_id, 'new_chat');
    const replacement = await waitFor(() => relay.sessions().find(session => (
      !idsBefore.has(session.session_id)
      && session.agent_type === 'codex_cli'
      && normalize(session.workspace_path) === expectedWorkspace
      && session.status === 'healthy'
      && (session.activity?.kind || 'idle') === 'idle'
    )), 30_000, 'fresh disposable Codex CLI session');
    result.session_id = replacement.session_id;
    result.replacement_set_model = await control(relay, replacement.session_id, 'agent_set_model', { model_id: options.model });
    result.replacement_set_effort = await control(relay, replacement.session_id, 'agent_set_effort', { effort: soakEffort });
    await waitFor(() => relay.messages.find(message => (
      message.type === 'agent_config'
      && (message.session_id || message.session) === replacement.session_id
      && message.model_id === options.model
      && message.effort === soakEffort
    )), 30_000, 'replacement config confirmation');

    const token = `RAC_CODEX_SOAK_PREFLIGHT_${Date.now().toString(36).toUpperCase()}`;
    const clientMessageId = `codex-cli-preflight-${crypto.randomBytes(6).toString('hex')}`;
    const eventStart = relay.messages.length;
    const sentAt = Date.now();
    relay.ws.send(JSON.stringify({
      type: 'send', session: replacement.session_id, session_id: replacement.session_id,
      client_message_id: clientMessageId,
      content: `Reply with exact string ${token} and nothing else.`,
    }));
    await waitFor(() => relay.messages.slice(eventStart).find(message => (
      message.type === 'message_accepted' && message.client_message_id === clientMessageId
    )), 30_000, 'message acceptance');
    const completion = await waitFor(() => {
      const assistant = relay.messages.slice(eventStart).find(message => {
        const sessionId = message.session_id || message.session;
        const candidates = [message.role ? message : null, message.message, ...(message.messages || [])].filter(Boolean);
        return sessionId === replacement.session_id && candidates.some(candidate => (
          candidate.role === 'assistant' && String(candidate.content || '').includes(token)
        ));
      });
      if (assistant) return { assistant };
      const current = relay.sessions().find(session => session.session_id === replacement.session_id);
      if (Date.now() - sentAt >= 5000 && current && (current.activity?.kind || 'idle') === 'idle') {
        return { idleWithoutAssistant: true };
      }
      return null;
    }, 180_000, 'assistant-role preflight token or terminal idle');
    if (completion.idleWithoutAssistant) {
      const terminalHistory = await historyTail(relay, replacement.session_id);
      result.terminal_history_messages = terminalHistory.total_messages ?? terminalHistory.messages?.length ?? 0;
      throw new Error(`Codex CLI reached idle without assistant output for ${options.model}; model quota or capacity is unavailable`);
    }
    const assistant = completion.assistant;
    await waitFor(() => {
      const current = relay.sessions().find(session => session.session_id === replacement.session_id);
      return current && (current.activity?.kind || 'idle') === 'idle' && /^reply with exact/i.test(String(current.chat_title || ''));
    }, 60_000, 'safe-title idle snapshot');
    const history = await historyTail(relay, replacement.session_id);
    assert((history.messages || []).some(message => (
      message.role === 'assistant' && String(message.content || '').includes(token)
    )), 'relay history omitted assistant-role preflight token');

    result.ok = true;
    result.token = token;
    result.assistant_event_type = assistant.type;
    result.assistant_elapsed_ms = Date.now() - sentAt;
    result.chat_title = relay.sessions().find(session => session.session_id === replacement.session_id)?.chat_title;
    result.relay_history_messages = history.total_messages ?? history.messages?.length ?? 0;
    result.completed_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    result.error = error.stack || error.message || String(error);
    result.completed_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    try { relay?.ws.close(); } catch {}
    releaseLock();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { expectedWorkspace, parseArgs, soakEffort, soakModel };
