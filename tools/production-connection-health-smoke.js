#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

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

async function openClient(origin, token) {
  const startedAt = Date.now();
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/client-ws?token=' + encodeURIComponent(token));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const ack = await waitForMessage(ws, message => message.type === 'connection_ack');
  return { ws, ack, connectMs: Date.now() - startedAt };
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built');

  const first = await openClient(origin, token);
  const rtts = [];
  try {
    assert(
      first.ack.heartbeat_interval_ms >= 1000 && first.ack.heartbeat_interval_ms <= 60000,
      `invalid advertised heartbeat interval ${first.ack.heartbeat_interval_ms}`,
    );
    assert(
      first.ack.heartbeat_timeout_ms >= 1000 && first.ack.heartbeat_timeout_ms <= 60000,
      `invalid advertised heartbeat timeout ${first.ack.heartbeat_timeout_ms}`,
    );
    for (let index = 0; index < 5; index += 1) {
      const requestId = `production-hb-${Date.now()}-${index}`;
      const startedAt = Date.now();
      const ackPromise = waitForMessage(first.ws, message => message.type === 'heartbeat_ack' && message.request_id === requestId);
      first.ws.send(JSON.stringify({
        type: 'heartbeat', protocol_version: 1, request_id: requestId,
        client_ts: new Date(startedAt).toISOString(),
      }));
      await ackPromise;
      rtts.push(Date.now() - startedAt);
    }
  } finally {
    first.ws.close();
  }

  const reconnectStartedAt = Date.now();
  const second = await openClient(origin, token);
  const reconnectMs = Date.now() - reconnectStartedAt;
  second.ws.close();

  const sorted = [...rtts].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  assert(max <= 500, `production heartbeat RTT is not healthy (${max} ms)`);
  assert(reconnectMs <= 3000, `production reconnect exceeded target (${reconnectMs} ms)`);

  const result = {
    ok: true,
    heartbeat_interval_ms: first.ack.heartbeat_interval_ms,
    heartbeat_timeout_ms: first.ack.heartbeat_timeout_ms,
    heartbeat_rtt_ms: rtts,
    heartbeat_rtt_p50_ms: p50,
    heartbeat_rtt_max_ms: max,
    initial_connect_ms: first.connectMs,
    reconnect_ms: reconnectMs,
    health_tone: 'healthy',
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`production connection health smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
