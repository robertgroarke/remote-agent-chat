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
const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;

function waitFor(messages, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve({ message: found, elapsedMs: Date.now() - startedAt });
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 10);
  });
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp, '.env RELAY_IP is required');
  assert(token, 'JWT bearer token could not be built');

  const ws = new WebSocket(`ws://${relayIp}:${relayPort}/client-ws?token=${encodeURIComponent(token)}`);
  const messages = [];
  ws.on('message', data => {
    try { messages.push(JSON.parse(data.toString())); } catch {}
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('production WebSocket open timeout')), 15_000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', reject);
    });
    const ackResult = await waitFor(messages, message => message.type === 'connection_ack', 15_000, 'connection_ack');
    const ack = ackResult.message;
    assert.equal(ack.session_subscriptions, true, 'production relay does not advertise subscriptions');
    assert.equal(ack.max_session_subscriptions, 128, 'production subscription ceiling drifted');
    const validId = (ack.sessions || []).map(session => (
      typeof session === 'string' ? session : session?.session_id
    )).find(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(id));
    assert(validId, 'production inventory has no valid subscription test session');

    ws.send(JSON.stringify({
      type: 'subscribe',
      protocol_version: 1,
      request_id: 'production-subscription-valid',
      sessions: [validId],
    }));
    const validResult = await waitFor(messages, message => (
      message.type === 'subscription_ack'
      && message.request_id === 'production-subscription-valid'
    ), 15_000, 'subscription_ack');
    assert.deepEqual(validResult.message.sessions, [validId]);
    assert.equal(validResult.message.summary_only_for_others, true);

    ws.send(JSON.stringify({
      type: 'subscribe',
      request_id: 'production-subscription-invalid',
      sessions: Array.from({ length: 129 }, (_, index) => `overflow-${index}`),
    }));
    const invalidResult = await waitFor(messages, message => (
      message.type === 'connection_error'
      && message.request_id === 'production-subscription-invalid'
    ), 15_000, 'invalid subscription rejection');
    assert.equal(invalidResult.message.code, 'invalid_subscription');

    ws.send(JSON.stringify({
      type: 'heartbeat',
      protocol_version: 1,
      request_id: 'production-subscription-heartbeat',
    }));
    const heartbeatResult = await waitFor(messages, message => (
      message.type === 'heartbeat_ack'
      && message.request_id === 'production-subscription-heartbeat'
    ), 15_000, 'heartbeat after invalid subscription');

    const result = {
      ok: true,
      relay_origin: `http://${relayIp}:${relayPort}`,
      session_count: Array.isArray(ack.sessions) ? ack.sessions.length : 0,
      advertised: {
        session_subscriptions: ack.session_subscriptions,
        max_session_subscriptions: ack.max_session_subscriptions,
      },
      selected_session: validId,
      subscription_ack_ms: validResult.elapsedMs,
      summary_only_for_others: validResult.message.summary_only_for_others,
      invalid_subscription_rejected: invalidResult.message.code === 'invalid_subscription',
      socket_healthy_after_rejection: heartbeatResult.message.type === 'heartbeat_ack',
      sends: 0,
      controls: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch(error => {
  console.error(`production session subscription smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
