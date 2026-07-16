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

function waitForMessage(ws, predicate, timeoutMs = 10000, label = 'WebSocket message') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error(`Timed out waiting for ${label}`)), timeoutMs);
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

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  const secret = relayEnv.PROXY_SECRET;
  assert(token, 'JWT bearer token could not be built');
  assert(secret, 'PROXY_SECRET is required');

  const sessionId = `live-activity-smoke-${Date.now()}`;
  const proxyId = `live-activity-smoke-${process.pid}`;
  const client = new WebSocket(origin.replace(/^http/, 'ws') + '/client-ws?token=' + encodeURIComponent(token));
  const proxy = new WebSocket(origin.replace(/^http/, 'ws') + '/proxy-ws');
  await Promise.all([
    new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); }),
    new Promise((resolve, reject) => { proxy.once('open', resolve); proxy.once('error', reject); }),
  ]);
  const clientAck = waitForMessage(client, message => message.type === 'connection_ack', 10000, 'client connection_ack');
  const proxyAck = waitForMessage(proxy, message => message.type === 'connection_ack', 10000, 'proxy connection_ack');
  proxy.send(JSON.stringify({
    type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
    proxy_id: proxyId, machine_label: 'live-activity-smoke', secret,
  }));
  const [connectionAck] = await Promise.all([clientAck, proxyAck]);
  assert(connectionAck.state_epoch, 'production connection_ack did not advertise a state epoch');

  try {
    const snapshotPromise = waitForMessage(client, message =>
      message.type === 'session_list' && message.sessions?.some(session => session.session_id === sessionId),
    10000, 'throwaway session_list');
    proxy.send(JSON.stringify({
      type: 'proxy_session_snapshot', proxy_id: proxyId,
      sessions: [{
        session_id: sessionId,
        agent_type: 'fixture',
        name: 'Live activity smoke',
        validator_session: true,
        session_kind: 'validator',
      }],
    }));
    const snapshot = await snapshotPromise;
    assert.equal(snapshot.state_epoch, connectionAck.state_epoch, 'session-list epoch differs from connection ack');
    assert(Number.isSafeInteger(snapshot.state_seq), 'production session list is missing state_seq');

    const subscriptionPromise = waitForMessage(client, message =>
      message.type === 'subscription_ack' && message.request_id === 'live-activity-selected',
    10000, 'selected-session subscription_ack');
    client.send(JSON.stringify({
      type: 'subscribe', request_id: 'live-activity-selected', sessions: [sessionId],
    }));
    await subscriptionPromise;

    const firstUpdatedAt = new Date(Date.now() - 65_000).toISOString();
    const firstPromise = waitForMessage(client, message =>
      message.type === 'status' && message.session === sessionId && message.activity?.label === 'Working',
    10000, 'first Working status');
    proxy.send(JSON.stringify({
      type: 'proxy_status', session_id: sessionId, status: 'healthy',
      activity: { kind: 'working', label: 'Working', updated_at: firstUpdatedAt },
      activity_trace: { proxy_emitted_at_ms: Date.now() },
    }));
    const first = await firstPromise;
    assert.equal(first.activity.started_at, firstUpdatedAt, 'relay did not anchor the first active status');
    assert.equal(first.state_epoch, connectionAck.state_epoch, 'status epoch differs from connection ack');
    assert(first.state_seq > snapshot.state_seq, 'status state_seq did not advance after session list');
    assert(Number.isFinite(first.activity_trace?.proxy_emitted_at_ms), 'selected status lost proxy emission time');
    assert(first.activity_trace.relay_received_at_ms >= first.activity_trace.proxy_emitted_at_ms,
      'selected status has invalid relay receive time');
    assert(first.activity_trace.relay_forwarded_at_ms >= first.activity_trace.relay_received_at_ms,
      'selected status has invalid relay forward time');

    const burstMessages = [];
    const onBurstMessage = data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.type === 'status' && message.session === sessionId && /^Burst /.test(message.activity?.label || '')) {
        burstMessages.push(message);
      }
    };
    client.on('message', onBurstMessage);
    const burstPromise = waitForMessage(client, message =>
      message.type === 'status' && message.session === sessionId && message.activity?.label === 'Burst 19',
    10000, 'coalesced Burst 19 status');
    for (let index = 0; index < 20; index += 1) {
      proxy.send(JSON.stringify({
        type: 'proxy_status', session_id: sessionId, status: 'healthy',
        activity: { kind: 'working', label: `Burst ${index}`, updated_at: new Date().toISOString() },
        activity_trace: { proxy_emitted_at_ms: Date.now() },
      }));
    }
    const burst = await burstPromise;
    await new Promise(resolve => setTimeout(resolve, 100));
    client.off('message', onBurstMessage);
    assert.equal(burstMessages.length, 1, `production burst emitted ${burstMessages.length} status frames`);
    assert(burst.state_seq > first.state_seq, 'burst state_seq did not advance');

    const toolSentAt = Date.now();
    const toolPromise = waitForMessage(client, message =>
      message.type === 'status' && message.session === sessionId && message.activity?.label === 'Running tests',
    10000, 'Running tests status');
    proxy.send(JSON.stringify({
      type: 'proxy_status', session_id: sessionId, status: 'healthy',
      activity: {
        kind: 'running_command', label: 'Running tests',
        thinkingContent: 'Production streaming partial.', updated_at: new Date().toISOString(),
      },
      activity_trace: { proxy_emitted_at_ms: toolSentAt },
    }));
    const tool = await toolPromise;
    const toolStatusLatencyMs = Date.now() - toolSentAt;
    assert.equal(tool.activity.started_at, firstUpdatedAt, 'relay reset started_at on a tool transition');
    assert.equal(tool.activity.thinkingContent, 'Production streaming partial.');
    assert(toolStatusLatencyMs <= 1000, `production status propagation took ${toolStatusLatencyMs} ms`);
    assert(tool.state_seq > burst.state_seq, 'tool state_seq did not advance after burst');

    const idlePromise = waitForMessage(client, message =>
      message.type === 'status' && message.session === sessionId && message.activity?.kind === 'idle',
    10000, 'idle status');
    proxy.send(JSON.stringify({
      type: 'proxy_status', session_id: sessionId, status: 'healthy',
      activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
      activity_trace: { proxy_emitted_at_ms: Date.now() },
    }));
    const idle = await idlePromise;
    assert.equal(idle.activity.started_at, null, 'idle status retained an active elapsed anchor');
    assert(idle.state_seq > tool.state_seq, 'idle state_seq did not advance after tool status');

    const backgroundSubscriptionPromise = waitForMessage(client, message =>
      message.type === 'subscription_ack' && message.request_id === 'live-activity-background',
    10000, 'background subscription_ack');
    client.send(JSON.stringify({
      type: 'subscribe', request_id: 'live-activity-background', sessions: [],
    }));
    await backgroundSubscriptionPromise;

    const fleetFreshnessSamplesMs = [];
    for (let index = 0; index < 20; index += 1) {
      const label = `Fleet sample ${index}`;
      const proxyEmittedAtMs = Date.now();
      const summaryPromise = waitForMessage(client, message =>
        message.type === 'session_summary'
          && message.session === sessionId
          && message.activity?.label === label,
      10000, `${label} session_summary`);
      proxy.send(JSON.stringify({
        type: 'proxy_status', session_id: sessionId, status: 'healthy',
        activity: { kind: 'working', label, updated_at: new Date(proxyEmittedAtMs).toISOString() },
        activity_trace: { proxy_emitted_at_ms: proxyEmittedAtMs },
      }));
      const summary = await summaryPromise;
      const trace = summary.activity_trace;
      assert.equal(trace?.proxy_emitted_at_ms, proxyEmittedAtMs, `${label} lost proxy emission time`);
      assert(trace.relay_received_at_ms >= proxyEmittedAtMs, `${label} has invalid relay receive time`);
      assert(trace.relay_forwarded_at_ms >= trace.relay_received_at_ms, `${label} has invalid relay forward time`);
      fleetFreshnessSamplesMs.push(Date.now() - proxyEmittedAtMs);
    }
    const sortedFleetFreshnessMs = [...fleetFreshnessSamplesMs].sort((left, right) => left - right);
    const fleetFreshnessP95Ms = sortedFleetFreshnessMs[Math.ceil(sortedFleetFreshnessMs.length * 0.95) - 1];
    const fleetFreshnessMaxMs = sortedFleetFreshnessMs[sortedFleetFreshnessMs.length - 1];
    assert(fleetFreshnessP95Ms <= 2_000,
      `production Fleet background freshness p95 was ${fleetFreshnessP95Ms} ms`);

    const result = {
      ok: true,
      throwaway_session: sessionId,
      first_active_anchor: first.activity.started_at,
      tool_transition_anchor: tool.activity.started_at,
      tool_status_latency_ms: toolStatusLatencyMs,
      fleet_freshness_samples_ms: fleetFreshnessSamplesMs,
      fleet_freshness_p95_ms: fleetFreshnessP95Ms,
      fleet_freshness_max_ms: fleetFreshnessMaxMs,
      fleet_freshness_gate_ms: 2_000,
      selected_status_trace_preserved: true,
      background_summary_trace_preserved: true,
      source_status_burst: 20,
      browser_status_burst_frames: burstMessages.length,
      state_epoch: connectionAck.state_epoch,
      state_seq_monotonic: true,
      streaming_partial_preserved: true,
      idle_anchor_cleared: true,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    if (proxy.readyState === WebSocket.OPEN) {
      proxy.send(JSON.stringify({ type: 'proxy_session_snapshot', proxy_id: proxyId, sessions: [] }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    proxy.close();
    client.close();
  }
}

main().catch(error => {
  console.error(`production live activity smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
