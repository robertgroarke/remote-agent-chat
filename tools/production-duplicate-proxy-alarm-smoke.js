#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

function waitForMessage(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('Timed out waiting for WebSocket message')), timeoutMs);
    const onMessage = data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (predicate(message)) cleanup(null, message);
    };
    const onError = error => cleanup(error);
    const cleanup = (error, message) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(message);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function openProxy(origin, proxyId, secret) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/proxy-ws');
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const ack = waitForMessage(ws, message => message.type === 'connection_ack');
  ws.send(JSON.stringify({
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'proxy',
    proxy_id: proxyId,
    machine_label: 'duplicate-alarm-smoke',
    secret,
  }));
  await ack;
  return ws;
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  const secret = relayEnv.PROXY_SECRET;
  assert(token, 'JWT bearer token could not be built');
  assert(secret, 'PROXY_SECRET is required');

  const sessionId = `duplicate-alarm-smoke-${Date.now()}`;
  const client = new WebSocket(origin.replace(/^http/, 'ws') + '/client-ws?token=' + encodeURIComponent(token));
  await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  await waitForMessage(client, message => message.type === 'connection_ack');

  let proxyA;
  let proxyB;
  try {
    proxyA = await openProxy(origin, 'alarm-smoke-a', secret);
    proxyA.send(JSON.stringify({
      type: 'proxy_session_snapshot', proxy_id: 'alarm-smoke-a',
      sessions: [{ session_id: sessionId, agent_type: 'fixture', name: 'Duplicate alarm smoke A' }],
    }));
    await new Promise(resolve => setTimeout(resolve, 100));

    const activePromise = waitForMessage(client, message =>
      message.type === 'duplicate_proxy_alarm' && message.active === true &&
      message.duplicate_sessions?.some(item => item.session_id === sessionId));
    proxyB = await openProxy(origin, 'alarm-smoke-b', secret);
    proxyB.send(JSON.stringify({
      type: 'proxy_session_snapshot', proxy_id: 'alarm-smoke-b',
      sessions: [{ session_id: sessionId, agent_type: 'fixture', name: 'Duplicate alarm smoke B' }],
    }));
    const active = await activePromise;
    assert.deepEqual(active.duplicate_sessions[0].proxy_ids, ['alarm-smoke-a', 'alarm-smoke-b']);

    const clearPromise = waitForMessage(client, message =>
      message.type === 'duplicate_proxy_alarm' && message.active === false &&
      Array.isArray(message.duplicate_sessions) && message.duplicate_sessions.length === 0);
    proxyB.close();
    proxyB = null;
    await clearPromise;
  } finally {
    if (proxyB) proxyB.close();
    if (proxyA) proxyA.close();
    client.close();
  }

  const result = {
    ok: true,
    throwaway_session: sessionId,
    active_alarm_observed: true,
    proxy_ids_observed: ['alarm-smoke-a', 'alarm-smoke-b'],
    clear_after_duplicate_disconnect_ms_max: 10000,
    cleanup_complete: true,
    generated_at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error('production duplicate-proxy alarm smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
