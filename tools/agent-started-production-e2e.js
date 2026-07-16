#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const vscodeGuard = require('../agent-proxy/vscode-probe-guard');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = 'C:\\temp\\remote-agent-vscode-continue-mutation.lock';

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

function acquireLock() {
  const handle = fs.openSync(LOCK_PATH, 'wx');
  fs.writeFileSync(handle, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
  return () => {
    try { fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  };
}

function waitForAck(ws, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('Timed out waiting for connection_ack')), timeoutMs);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'connection_ack') cleanup(null, message);
    };
    const onError = error => cleanup(error);
    const cleanup = (error, value) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function waitForLifecycle(ws, clientMessageId, startedAt, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => cleanup(new Error(`Timed out waiting for agent_started; events=${JSON.stringify(events)}`)), timeoutMs);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.client_message_id !== clientMessageId) return;
      const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
      events.push({ type: message.type, result: message.result || null, elapsed_ms: elapsedMs });
      if (message.type === 'message_failed' || (message.type === 'proxy_send_result' && message.result === 'failed')) {
        cleanup(new Error(`Lifecycle failed: ${message.error?.message || message.reason || 'unknown error'}`));
      } else if (message.type === 'agent_started') {
        cleanup(null, { events, agentStarted: message });
      }
    };
    const onError = error => cleanup(error);
    const cleanup = (error, value) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function waitForSessionIdle(ws, sessionId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error(`Timed out waiting for ${sessionId} to become idle`)), timeoutMs);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!['status', 'proxy_status', 'session_status'].includes(message.type)) return;
      if ((message.session_id || message.session) !== sessionId) return;
      const kind = typeof message.activity === 'object' ? message.activity?.kind : message.activity;
      if (kind === 'idle' || (!message.thinking && !kind)) cleanup();
    };
    const onError = error => cleanup(error);
    const cleanup = error => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve();
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function main(argv = process.argv.slice(2)) {
  const outputValue = valueAfter(argv, '--output');
  const outputPath = outputValue ? path.resolve(outputValue) : '';
  vscodeGuard.assertUpdatesDisabled('agent-started production E2E');
  const targets = await CDP.List({ port: vscodeGuard.CDP_PORT });
  vscodeGuard.assertTargetSet(targets, 'continue', 'agent-started production E2E');

  const releaseLock = acquireLock();
  let ws;
  try {
    const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
    const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
    const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
    const token = fidelity.buildBearerToken(relayEnv);
    assert(token, 'JWT bearer token could not be built');
    ws = new WebSocket(origin.replace(/^http/, 'ws') + '/client-ws?token=' + encodeURIComponent(token));
    const ackPromise = waitForAck(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const ack = await ackPromise;
    const session = vscodeGuard.pickThrowawaySession(ack.sessions, 'continue');
    const activityKind = typeof session.activity === 'object' ? session.activity?.kind : session.activity;
    if (['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(activityKind)) {
      await waitForSessionIdle(ws, session.session_id);
    }
    const tokenText = `RAC_AGENT_STARTED_${Date.now().toString(36).toUpperCase()}`;
    const content = `Reply with exactly ${tokenText} and nothing else. Do not use tools, edit files, or change settings.`;
    const clientMessageId = `agent-started-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = performance.now();
    const lifecyclePromise = waitForLifecycle(ws, clientMessageId, startedAt);
    ws.send(JSON.stringify({
      type: 'send',
      session: session.session_id,
      content,
      client_message_id: clientMessageId,
    }));
    const lifecycle = await lifecyclePromise;
    const elapsed = Object.fromEntries(lifecycle.events.map(event => [
      event.type === 'proxy_send_result' ? `${event.type}:${event.result}` : event.type,
      event.elapsed_ms,
    ]));
    assert(elapsed.message_accepted != null, 'missing message_accepted');
    assert(elapsed['proxy_send_result:delivered'] != null, 'missing delivered proxy_send_result');
    assert(elapsed.agent_started != null, 'missing agent_started');
    assert(elapsed.message_accepted <= elapsed['proxy_send_result:delivered']);
    assert(elapsed['proxy_send_result:delivered'] <= elapsed.agent_started);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      agent_type: session.agent_type,
      host_type: session.host_type,
      workspace_path: session.workspace_path,
      client_message_id: clientMessageId,
      token: tokenText,
      events: lifecycle.events,
      delivered_ms: elapsed['proxy_send_result:delivered'],
      agent_started_ms: elapsed.agent_started,
      agent_started_payload: lifecycle.agentStarted,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    return result;
  } finally {
    try { ws?.close(); } catch {}
    releaseLock();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Agent-started production E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, waitForLifecycle, waitForSessionIdle };
