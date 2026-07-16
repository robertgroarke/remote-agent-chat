#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : freshEvidencePath(ROOT, 'message-delta-production-transport.json');

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws, predicate, timeoutMs = 10_000, label = 'WebSocket message') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
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

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  const secret = relayEnv.PROXY_SECRET;
  assert(token, 'JWT bearer token could not be built');
  assert(secret, 'PROXY_SECRET is required');

  const client = new WebSocket(`${origin.replace(/^http/, 'ws')}/client-ws?token=${encodeURIComponent(token)}`);
  const clientAck = waitForMessage(client, message => message.type === 'connection_ack', 10_000, 'client connection_ack');
  await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  await clientAck;
  const proxy = await openSocket(`${origin.replace(/^http/, 'ws')}/proxy-ws`);
  const sessionId = `message-delta-transport-${Date.now()}`;
  const messageId = `synthetic-${Date.now()}`;
  const received = [];
  const onMessage = raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.type === 'message_delta' && message.session_id === sessionId) {
      received.push({ message, client_received_at_ms: Date.now() });
    }
  };
  client.on('message', onMessage);

  try {
    const proxyAck = waitForMessage(proxy, message => message.type === 'connection_ack', 10_000, 'proxy connection_ack');
    proxy.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: `message-delta-e2e-${process.pid}`, machine_label: 'message-delta-e2e', secret,
    }));
    await proxyAck;

    const frames = [
      { seq: 0, op: 'block_open' },
      { seq: 1, op: 'append', append: 'small ' },
      { seq: 2, op: 'append', append: 'chunks' },
      { seq: 3, op: 'block_close' },
    ];
    for (const frame of frames) {
      const proxySentAtMs = Date.now();
      proxy.send(JSON.stringify({
        type: 'message_delta', protocol_version: 1, session_id: sessionId,
        message_id: messageId, role: 'assistant', block_index: 0, block_type: 'text',
        ...frame,
        ...(frame.op === 'append' ? {
          stream_trace: { trace_id: `${messageId}-${frame.seq}`, proxy_sent_at_ms: proxySentAtMs },
        } : {}),
      }));
    }
    for (let attempt = 0; attempt < 100 && !received.some(row => row.message.op === 'block_close'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(received.some(row => row.message.op === 'block_close'),
      `relay omitted block_close; received=${JSON.stringify(received.map(row => [row.message.seq, row.message.op]))}`);

    assert.deepStrictEqual(received.map(row => [row.message.seq, row.message.op]), [
      [0, 'block_open'], [1, 'append'], [2, 'append'], [3, 'block_close'],
    ]);
    assert.strictEqual(received.filter(row => row.message.op === 'append').map(row => row.message.append).join(''), 'small chunks');
    const appendLatencies = received.filter(row => row.message.op === 'append').map(row => ({
      seq: row.message.seq,
      proxy_to_relay_ms: row.message.stream_trace.relay_received_at_ms - row.message.stream_trace.proxy_sent_at_ms,
      relay_to_client_ms: row.client_received_at_ms - row.message.stream_trace.relay_forwarded_at_ms,
      proxy_to_client_ms: row.client_received_at_ms - row.message.stream_trace.proxy_sent_at_ms,
    }));
    assert(appendLatencies.every(row => row.proxy_to_client_ms >= 0),
      'same-process proxy-send to client-receive latency must be monotonic');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      production_origin: new URL(origin).origin,
      synthetic_session_registered: false,
      sqlite_messages_written: 0,
      operations: received.map(row => ({ seq: row.message.seq, op: row.message.op })),
      reconstructed: 'small chunks',
      append_latencies_ms: appendLatencies,
      clock_note: 'proxy_to_client_ms is same-machine monotonic evidence; relay hop fields use the relay host clock and may include host clock skew.',
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    client.off('message', onMessage);
    client.close();
    proxy.close();
  }
}

main().catch(error => {
  console.error(`message delta production transport E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
