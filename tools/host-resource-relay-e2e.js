#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { normalizeHostResourceSnapshot } = require('../agent-proxy/host-resource-monitor');
const { systemPointFromSnapshot } = require('../agent-proxy/host-resource-history');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const port = 37720 + Math.floor(Math.random() * 200);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-host-resource-relay-'));
const secretCanary = 'Bearer host-resource-relay-canary-0123456789';

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function openSocket(pathname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace(/^http/, 'ws') + pathname);
    const messages = [];
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${pathname}`)), 10_000);
    ws.once('open', () => { clearTimeout(timer); resolve({ ws, messages }); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function fixture() {
  return normalizeHostResourceSnapshot({
    cpu_percent: 44,
    memory_available_bytes: 4 * 1024 ** 3,
    disk_read_bps: 400_000,
    disk_write_bps: 200_000,
    disk_busy_percent: 12,
    network_receive_bps: 300_000,
    network_send_bps: 100_000,
    processes: [{
      pid: 4242,
      name: 'node.exe',
      command_line: 'node agent-proxy/index.js',
      cpu_percent: 30,
      memory_bytes: 200 * 1024 ** 2,
      io_read_bps: 10_000,
      io_write_bps: 5_000,
    }],
  }, {
    totalMemoryBytes: 8 * 1024 ** 3,
    logicalCpuCount: 8,
    machineLabel: 'relay-fixture',
    capturedAtMs: Date.parse('2026-07-14T16:00:00.000Z'),
    collectionDurationMs: 120,
  });
}

function dataDirContains(value) {
  const needle = Buffer.from(value);
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).some(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(target);
    return fs.readFileSync(target).includes(needle);
  });
  return visit(dataDir);
}

async function main() {
  const logs = [];
  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: path.join(root, 'relay-server'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: origin,
      SESSION_SECRET: 'host-resource-session-secret-0123456789',
      JWT_SECRET: 'host-resource-jwt-secret-0123456789012345',
      PROXY_SECRET: '', ALLOW_LOOPBACK_BYPASS: 'true', ALLOW_LAN_BYPASS: 'true',
      RAC_DATA_DIR: dataDir, GOOGLE_CLIENT_ID: 'host-resource-client',
      GOOGLE_CLIENT_SECRET: 'host-resource-secret', FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => logs.push(String(chunk)));
  relay.stderr.on('data', chunk => logs.push(String(chunk)));
  let proxy;
  let requester;
  let observer;
  let reconnect;
  try {
    await waitFor(() => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-4000));
      return logs.some(line => line.includes('[relay] Listening'));
    }, 15_000, 'relay listening');
    proxy = await openSocket('/proxy-ws');
    requester = await openSocket('/client-ws');
    observer = await openSocket('/client-ws');
    await waitFor(() => requester.messages.find(message => message.type === 'connection_ack'), 5_000, 'requester ack');
    await waitFor(() => observer.messages.find(message => message.type === 'connection_ack'), 5_000, 'observer ack');

    requester.ws.send(JSON.stringify({
      type: 'host_resource_refresh', protocol_version: 1, request_id: 'client-resource-1', force: false,
    }));
    const upstream = await waitFor(() => proxy.messages.find(message => message.type === 'host_resource_refresh'), 5_000, 'targeted proxy refresh');
    assert.notEqual(upstream.request_id, 'client-resource-1', 'relay exposed the client request ID upstream');
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_snapshot', protocol_version: 1, request_id: upstream.request_id, snapshot: fixture(),
    }));
    const response = await waitFor(() => requester.messages.find(message => (
      message.type === 'host_resource_snapshot' && message.request_id === 'client-resource-1'
    )), 5_000, 'requester-only resource snapshot');
    assert.equal(response.snapshot.processes.length, 1);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(observer.messages.some(message => message.type === 'host_resource_snapshot'), false, 'observer received another client resource snapshot');

    requester.ws.send(JSON.stringify({
      type: 'host_resource_refresh', protocol_version: 1, request_id: 'client-resource-throttled', force: true,
    }));
    const throttled = await waitFor(() => requester.messages.find(message => (
      message.type === 'host_resource_error' && message.request_id === 'client-resource-throttled'
    )), 5_000, 'resource throttle response');
    assert.equal(throttled.code, 'refresh_throttled');
    assert.equal(proxy.messages.filter(message => message.type === 'host_resource_refresh').length, 1);

    await new Promise(resolve => setTimeout(resolve, 2_050));
    requester.ws.send(JSON.stringify({
      type: 'host_resource_refresh', protocol_version: 1, request_id: 'client-resource-invalid', force: true,
    }));
    const invalidUpstream = await waitFor(() => {
      const frames = proxy.messages.filter(message => message.type === 'host_resource_refresh');
      return frames.length >= 2 ? frames.at(-1) : null;
    }, 5_000, 'invalid snapshot request');
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_snapshot', protocol_version: 1, request_id: invalidUpstream.request_id,
      snapshot: { ...fixture(), command_line: secretCanary },
    }));
    const invalid = await waitFor(() => requester.messages.find(message => (
      message.type === 'host_resource_error' && message.request_id === 'client-resource-invalid'
    )), 5_000, 'invalid snapshot rejection');
    assert.equal(invalid.code, 'invalid_snapshot');

    requester.ws.send(JSON.stringify({
      type: 'host_resource_subscribe', protocol_version: 1,
      request_id: 'client-subscribe-1', aggregate_only: false,
    }));
    const subscribeUpstream = await waitFor(() => proxy.messages.find(message => (
      message.type === 'host_resource_subscribe'
    )), 5_000, 'host resource subscribe upstream');
    assert(/^host-sub-[a-f0-9]{32}$/.test(subscribeUpstream.subscription_id));
    assert.notEqual(subscribeUpstream.request_id, 'client-subscribe-1');
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_subscription_ack', protocol_version: 1,
      request_id: subscribeUpstream.request_id,
      subscriber_id: subscribeUpstream.subscription_id,
      aggregate_only: false, resumed: false, system_points: 0, detail_points: 0,
    }));
    const subscriptionAck = await waitFor(() => requester.messages.find(message => (
      message.type === 'host_resource_subscription_ack' && message.request_id === 'client-subscribe-1'
    )), 5_000, 'host resource subscription ack');
    const subscriptionId = subscriptionAck.subscription_id;
    const liveSnapshot = fixture();
    const livePoint = systemPointFromSnapshot(liveSnapshot);
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_live', protocol_version: 1, subscription_id: subscriptionId, point: livePoint,
    }));
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_detail', protocol_version: 1, subscription_id: subscriptionId, snapshot: liveSnapshot,
    }));
    await waitFor(() => requester.messages.find(message => message.type === 'host_resource_live'), 5_000, 'live resource point');
    await waitFor(() => requester.messages.find(message => message.type === 'host_resource_detail'), 5_000, 'live resource detail');
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_live', protocol_version: 1, subscription_id: subscriptionId, point: livePoint,
    }));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(requester.messages.filter(message => message.type === 'host_resource_live').length, 1,
      'duplicate live sequence was forwarded');
    assert.equal(observer.messages.some(message => ['host_resource_live', 'host_resource_detail'].includes(message.type)), false,
      'observer received subscription telemetry');

    requester.ws.send(JSON.stringify({
      type: 'host_resource_history_request', protocol_version: 1, request_id: 'client-history-1',
      subscription_id: subscriptionId, stream: 'system', after_sequence: 0, max_points: 64,
    }));
    const historyUpstream = await waitFor(() => proxy.messages.find(message => (
      message.type === 'host_resource_history_request'
    )), 5_000, 'history request upstream');
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_history_chunk', protocol_version: 1,
      request_id: historyUpstream.request_id, subscription_id: subscriptionId,
      chunk: { stream: 'system', points: [livePoint], after_sequence: 0,
        next_sequence: livePoint.sample_sequence, done: true, retained_points: 1, aggregate_only: false },
    }));
    const historyResponse = await waitFor(() => requester.messages.find(message => (
      message.type === 'host_resource_history_chunk' && message.request_id === 'client-history-1'
    )), 5_000, 'history response');
    assert.equal(historyResponse.chunk.points.length, 1);

    requester.ws.close();
    const detach = await waitFor(() => proxy.messages.find(message => (
      message.type === 'host_resource_detach' && message.subscription_id === subscriptionId
    )), 5_000, 'subscription detach');
    assert(detach);

    reconnect = await openSocket('/client-ws');
    const reconnectAck = await waitFor(() => reconnect.messages.find(message => message.type === 'connection_ack'), 5_000, 'reconnect ack');
    assert.equal(Object.hasOwn(reconnectAck, 'host_resources'), false, 'resource snapshot leaked into connection_ack cache');
    reconnect.ws.send(JSON.stringify({
      type: 'host_resource_subscribe', protocol_version: 1, request_id: 'client-resume-1',
      resume_subscription_id: subscriptionId, aggregate_only: false,
    }));
    const resumeUpstream = await waitFor(() => proxy.messages.find(message => (
      message.type === 'host_resource_subscribe' && message.request_id !== subscribeUpstream.request_id
    )), 5_000, 'subscription resume upstream');
    assert.equal(resumeUpstream.subscription_id, subscriptionId);
    proxy.ws.send(JSON.stringify({
      type: 'host_resource_subscription_ack', protocol_version: 1,
      request_id: resumeUpstream.request_id, subscriber_id: subscriptionId,
      aggregate_only: false, resumed: true, system_points: 1, detail_points: 1,
    }));
    const resumeAck = await waitFor(() => reconnect.messages.find(message => (
      message.type === 'host_resource_subscription_ack' && message.request_id === 'client-resume-1'
    )), 5_000, 'subscription resume ack');
    assert.equal(resumeAck.resumed, true);
    assert.equal(resumeAck.system_points, 1);
    assert.equal(dataDirContains(secretCanary), false, 'resource canary entered relay storage');
    assert.equal(logs.join('').includes(secretCanary), false, 'resource canary entered relay logs');

    const result = {
      ok: true,
      requester_only_delivery: true,
      observer_snapshot_frames: 0,
      client_request_id_hidden_upstream: true,
      reconnect_cache_present: false,
      relay_persistence_present: false,
      invalid_sensitive_snapshot_rejected: true,
      credential_canary_in_relay_storage: false,
      credential_canary_in_relay_logs: false,
      refresh_min_interval_ms: 2000,
      throttle_forwarded_frames: 0,
      subscription_requester_only: true,
      compact_live_frame_bytes: Buffer.byteLength(JSON.stringify(livePoint)),
      duplicate_live_sequences_rejected: true,
      chunked_history_requester_only: true,
      disconnect_detach_forwarded: true,
      reconnect_resume_preserved: true,
      visible_windows_opened: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    try { reconnect?.ws.close(); } catch {}
    try { observer?.ws.close(); } catch {}
    try { requester?.ws.close(); } catch {}
    try { proxy?.ws.close(); } catch {}
    if (relay.exitCode == null) {
      const exited = new Promise(resolve => relay.once('exit', resolve));
      relay.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`host resource relay e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
