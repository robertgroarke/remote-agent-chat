#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');

const SESSION_ID = 'chaos_fixture_session';

function parseArgs(argv) {
  const options = { relayUrl: null, stateFile: null, lockFile: null, workspacePath: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--relay-url' && argv[i + 1]) options.relayUrl = argv[++i];
    else if (argv[i] === '--state-file' && argv[i + 1]) options.stateFile = path.resolve(argv[++i]);
    else if (argv[i] === '--lock-file' && argv[i + 1]) options.lockFile = path.resolve(argv[++i]);
    else if (argv[i] === '--workspace' && argv[i + 1]) options.workspacePath = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.relayUrl || !options.stateFile || !options.lockFile) {
    throw new Error('--relay-url, --state-file, and --lock-file are required');
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
fs.mkdirSync(path.dirname(options.lockFile), { recursive: true });
let lockHandle;
let recoveredStaleLock = false;
for (let attempt = 0; attempt < 2 && lockHandle == null; attempt += 1) {
  try {
    lockHandle = fs.openSync(options.lockFile, 'wx');
    fs.writeFileSync(lockHandle, `${process.pid}\n`, 'utf8');
  } catch (error) {
    if (error.code !== 'EEXIST' || attempt > 0) throw error;
    const ownerPid = Number(fs.readFileSync(options.lockFile, 'utf8').trim());
    let ownerAlive = Number.isInteger(ownerPid) && ownerPid > 0;
    if (ownerAlive) {
      try { process.kill(ownerPid, 0); } catch (checkError) { ownerAlive = checkError.code === 'EPERM'; }
    }
    if (ownerAlive) {
      console.error(`Fixture proxy mutex already held by PID ${ownerPid}: ${options.lockFile}`);
      process.exit(17);
    }
    fs.unlinkSync(options.lockFile);
    recoveredStaleLock = true;
  }
}

let socket = null;
let stopped = false;
let reconnectTimer = null;
let blockedUntil = 0;
let lastAvailability = null;
let lastStateKey = '';
let lastMessageId = -1;
let lastGoodState = null;
let stateMissingSince = 0;
const STATE_ABSENCE_GRACE_MS = 350;

function report(message) {
  if (process.send) process.send({ ...message, pid: process.pid, at_ms: Date.now() });
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(options.stateFile, 'utf8'));
    if (Date.now() - Number(state.updated_at_ms || 0) > 600) throw new Error('stale fixture heartbeat');
    lastGoodState = state;
    stateMissingSince = 0;
    return state;
  } catch {}
  if (!stateMissingSince) stateMissingSince = Date.now();
  if (lastGoodState && Date.now() - stateMissingSince < STATE_ABSENCE_GRACE_MS) return lastGoodState;
  lastGoodState = null;
  return null;
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function syncState(force = false) {
  const state = readState();
  const available = !!state;
  const stateKey = state
    ? `${state.generation}:${state.activity?.kind}:${state.activity?.label}:${state.message_id}`
    : 'offline';
  if (force || available !== lastAvailability) {
    send({
      type: 'proxy_session_snapshot',
      proxy_id: 'chaos-fixture-proxy',
      sessions: available ? [{
        session_id: SESSION_ID,
        agent_type: 'claude_cli',
        name: 'Chaos Fixture Session',
        session_title: 'Chaos Fixture Session',
        workspace_name: 'Remote Agent Chat',
        workspace_path: options.workspacePath,
        project_root: options.workspacePath,
        status: 'connected',
        activity: state.activity,
        capabilities: { interrupt: true },
      }] : [],
    });
    lastAvailability = available;
    report({ type: available ? 'session_online' : 'session_offline' });
  }
  if (state && (force || stateKey !== lastStateKey)) {
    const working = state.activity?.kind === 'thinking' || state.activity?.kind === 'generating';
    send({
      type: 'proxy_status',
      session_id: SESSION_ID,
      thinking: working,
      label: state.activity?.label || (working ? 'Working' : 'Ready'),
      activity: state.activity,
    });
    if (Number(state.message_id) !== lastMessageId) {
      if (send({
        type: 'proxy_message',
        session_id: SESSION_ID,
        role: 'assistant',
        content: state.message,
      })) lastMessageId = Number(state.message_id);
    }
    lastStateKey = stateKey;
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = Math.max(100, blockedUntil - Date.now());
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopped) return;
  if (Date.now() < blockedUntil) return scheduleReconnect();
  socket = new WebSocket(options.relayUrl, { headers: { Origin: 'http://127.0.0.1' } });
  socket.once('open', () => {
    send({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'proxy',
      proxy_id: 'chaos-fixture-proxy',
      machine_label: 'chaos-fixture',
    });
  });
  socket.on('message', data => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.type === 'connection_ack') {
      lastAvailability = null;
      lastStateKey = '';
      syncState(true);
      report({ type: 'relay_connected', recovered_stale_lock: recoveredStaleLock });
    }
  });
  socket.once('close', () => {
    report({ type: 'relay_disconnected' });
    scheduleReconnect();
  });
  socket.once('error', () => {});
}

process.on('message', command => {
  if (command?.type === 'network_flap') {
    blockedUntil = Date.now() + Math.max(100, Number(command.duration_ms) || 500);
    try { socket?.terminate(); } catch {}
    report({ type: 'network_flap_started', duration_ms: blockedUntil - Date.now() });
  } else if (command?.type === 'sync') {
    syncState(true);
  }
});

function cleanup() {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { socket?.terminate(); } catch {}
  try { fs.closeSync(lockHandle); } catch {}
  try { fs.unlinkSync(options.lockFile); } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}
process.on('exit', cleanup);

connect();
setInterval(() => syncState(false), 100);

module.exports = { SESSION_ID, parseArgs };
