#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const root = path.resolve(__dirname, '..');
const workspacePath = 'C:\\temp\\remote-agent-claude-cli-test';
const normalizedWorkspace = workspacePath.toLowerCase();

function parseArgs(argv) {
  const options = { sendLive: false, output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--send-live') options.sendLive = true;
    else if (argv[index] === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  assert(options.sendLive, 'Refusing to create a disposable Claude CLI session without --send-live');
  return options;
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(root, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const configured = proxyEnv.RELAY_URL || relayEnv.PUBLIC_URL || 'http://127.0.0.1:3500';
  const url = configured
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/proxy-ws$/i, '/client-ws')
    .replace(/\/+$/, '');
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function normalize(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function isSafeIdleSession(session) {
  const activeKinds = new Set(['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files']);
  return session?.agent_type === 'claude_cli'
    && normalize(session.workspace_path) === normalizedWorkspace
    && session.status === 'healthy'
    && !activeKinds.has(String(session.activity?.kind || '').toLowerCase());
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
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'claude-cli-disposable-session-ensure',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  await waitFor(() => sessions.length > 0, 30_000, 'production session inventory');
  return { ws, messages, sessions: () => sessions };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'claude-cli-disposable-session-ensure',
      kind: 'guarded-session-launch',
    })}\n`,
  );
  let relay;
  try {
    fs.mkdirSync(workspacePath, { recursive: true });
    relay = await openRelay();
    let session = relay.sessions().filter(isSafeIdleSession)
      .sort((left, right) => String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || '')))[0] || null;
    let launchRequestId = null;
    if (!session) {
      launchRequestId = `claude-delta-launch-${crypto.randomBytes(6).toString('hex')}`;
      const startIndex = relay.messages.length;
      relay.ws.send(JSON.stringify({
        type: 'launch_session',
        protocol_version: 1,
        request_id: launchRequestId,
        agent_type: 'claude_cli',
        workspace_path: workspacePath,
        model_id: 'default',
        permission_mode: 'default',
        effort: 'medium',
      }));
      const ack = await waitFor(() => relay.messages.slice(startIndex).find(message => (
        message.request_id === launchRequestId
        && (message.type === 'session_launch_ack' || message.type === 'session_launch_failed')
      )), 60_000, 'Claude CLI session launch acknowledgement');
      assert.strictEqual(ack.type, 'session_launch_ack', `session launch failed: ${JSON.stringify(ack)}`);
      session = await waitFor(
        () => relay.sessions().find(candidate => candidate.session_id === ack.session_id && isSafeIdleSession(candidate)),
        60_000,
        'safe idle Claude CLI session inventory',
      );
    }
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      cli_session_id: session.cli_session_id,
      workspace_path: session.workspace_path,
      status: session.status,
      activity: session.activity?.kind || 'idle',
      launch_request_id: launchRequestId,
      reused_existing: launchRequestId == null,
      native_window_launch_mode: 'background',
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_user_sessions_touched: 0,
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    try { relay?.ws.close(); } catch {}
    releaseOperation();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude CLI disposable session ensure: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = { isSafeIdleSession, normalize, parseArgs };
