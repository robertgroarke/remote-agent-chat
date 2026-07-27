#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { advanceLatencyTrace } = require('../shared/latency-trace');
const {
  estimateRelayClockOffset,
  relayClockStageObservation,
} = require('../shared/latency-clock');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-latency-relay-e2e-'));
const LEDGER_PATH = path.join(DATA_DIR, 'latency-trace-ledger.jsonl');
const logs = [];
const fixtures = [
  { session_id: 'latency-codex-cli', agent_type: 'codex_cli' },
  { session_id: 'latency-codex-desktop', agent_type: 'codex-desktop' },
  { session_id: 'latency-webview', agent_type: 'codex' },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function healthy(port) {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/healthz`, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
  });
}

function startRelay(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'latency-relay-e2e-session-secret-0123456789',
      JWT_SECRET: 'latency-relay-e2e-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: DATA_DIR,
      GOOGLE_CLIENT_ID: 'latency-relay-e2e-client',
      GOOGLE_CLIENT_SECRET: 'latency-relay-e2e-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
      LATENCY_TRACE_ACTIVE_TTL_MS: '1000',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
}

async function stopRelay(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(port, route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const origin = `http://127.0.0.1:${port}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${peerRole} connection timed out`)), 8000);
    ws.on('message', data => {
      try {
        const parsed = JSON.parse(String(data));
        Object.defineProperty(parsed, '_client_received_at_ms', {
          value: Date.now(),
          enumerable: false,
        });
        messages.push(parsed);
      } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'latency-relay-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(
      () => messages.some(message => message.type === 'connection_ack'),
      8000,
      `${peerRole} connection_ack`,
    ).then(() => {
      clearTimeout(timer);
      resolve({ ws, messages });
    }, reject);
  });
}

async function sampleRelayClock(socket, label) {
  let negativeRttSamplesRejected = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const clientSentAtMs = Date.now();
    const requestId = `${label}-clock-${clientSentAtMs}-${attempt}`;
    socket.ws.send(JSON.stringify({
      type: 'heartbeat',
      protocol_version: 1,
      request_id: requestId,
      client_sent_at_ms: clientSentAtMs,
      client_ts: new Date(clientSentAtMs).toISOString(),
    }));
    const ack = await waitFor(
      () => socket.messages.find(message => (
        message.type === 'heartbeat_ack' && message.request_id === requestId
      )),
      5_000,
      `${label} relay clock sample ${attempt}`,
    );
    assert.strictEqual(ack.client_sent_at_ms, clientSentAtMs);
    assert(Number.isFinite(ack.relay_received_at_ms));
    assert(Number.isFinite(ack.relay_sent_at_ms));
    assert(ack.relay_sent_at_ms >= ack.relay_received_at_ms);
    const estimated = estimateRelayClockOffset({
      clientSentAtMs,
      relayReceivedAtMs: ack.relay_received_at_ms,
      relaySentAtMs: ack.relay_sent_at_ms,
      clientReceivedAtMs: ack._client_received_at_ms,
    });
    if (estimated.ok) {
      assert.strictEqual(estimated.estimate.status, 'synchronized');
      const estimate = {
        ...estimated.estimate,
        samples_attempted: attempt,
        negative_rtt_samples_rejected: negativeRttSamplesRejected,
      };
      socket.clockEstimate = estimate;
      return estimate;
    }
    assert.strictEqual(estimated.code, 'clock_sample_negative_rtt');
    negativeRttSamplesRejected += 1;
    await sleep(2);
  }
  assert.fail(`${label} clock sampling rejected five negative-RTT samples`);
}

function tracedStage(rawAtMs, clockDomain, clockEstimate, source) {
  const observed = relayClockStageObservation(
    rawAtMs,
    clockDomain,
    clockEstimate,
    { nowMs: rawAtMs },
  );
  assert(observed.ok, observed.code);
  return {
    adjustedAtMs: observed.adjusted_at_ms,
    source: { source, ...observed.source },
  };
}

async function closeSocket(socket) {
  const ws = socket?.ws || socket;
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function registerFixtures(proxy) {
  proxy.ws.send(JSON.stringify({
    type: 'session_list',
    sessions: fixtures.map(fixture => ({
      ...fixture,
      display_name: fixture.session_id,
      workspace_name: 'Latency relay E2E',
      workspace_path: ROOT,
      status: 'healthy',
      capabilities: { send_message: true },
    })),
  }));
}

async function runFixture(proxy, browser, fixture, index) {
  const cid = `cmsg-latency-e2e-${index}`;
  const traceId = `latency-relay-e2e-${index}`;
  const content = `owned latency relay fixture ${index}`;
  const webuiSendAtMs = Date.now() - 5;
  const webuiSend = tracedStage(
    webuiSendAtMs,
    'browser',
    browser.clockEstimate,
    'relay_e2e_fixture',
  );
  browser.ws.send(JSON.stringify({
    type: 'send',
    session: fixture.session_id,
    content,
    client_message_id: cid,
    latency_trace: {
      schema_version: 2,
      trace_id: traceId,
      client_message_id: cid,
      agent_type: fixture.agent_type,
      stages: { webui_send: webuiSend.adjustedAtMs },
      raw_stages: { webui_send: webuiSendAtMs },
      stage_sources: { webui_send: webuiSend.source },
    },
  }));
  const nativeSend = await waitFor(
    () => proxy.messages.find(message => (
      message.type === 'send' && message.client_message_id === cid
    )),
    5000,
    `traced native dispatch ${fixture.agent_type}`,
  );
  assert(nativeSend.latency_trace);
  assert(nativeSend.latency_trace.stages.relay_recv >= webuiSend.adjustedAtMs);

  const proxyRecvAtMs = Date.now();
  const proxyRecv = tracedStage(
    proxyRecvAtMs,
    'proxy',
    proxy.clockEstimate,
    'fixture_proxy_recv',
  );
  let trace = advanceLatencyTrace(
    nativeSend.latency_trace,
    'proxy_recv',
    proxyRecvAtMs,
    proxyRecv.source,
  ).trace;
  const harnessDeliveredAtMs = Date.now();
  const harnessDelivered = tracedStage(
    harnessDeliveredAtMs,
    'proxy',
    proxy.clockEstimate,
    'fixture_native_receipt',
  );
  trace = advanceLatencyTrace(
    trace,
    'harness_delivered',
    harnessDeliveredAtMs,
    harnessDelivered.source,
  ).trace;
  proxy.ws.send(JSON.stringify({
    type: 'proxy_send_result',
    protocol_version: 1,
    session_id: fixture.session_id,
    client_message_id: cid,
    result: 'delivered',
    lifecycle: 'native_user_turn_observed',
    latency_trace: trace,
  }));
  const firstOutputAtMs = Date.now();
  const firstOutput = tracedStage(
    firstOutputAtMs,
    'proxy',
    proxy.clockEstimate,
    'fixture_first_output',
  );
  trace = advanceLatencyTrace(
    trace,
    'agent_first_output',
    firstOutputAtMs,
    firstOutput.source,
  ).trace;
  let rendered;
  if (fixture.agent_type === 'codex_cli') {
    const canonicalMessage = {
      type: 'proxy_message',
      protocol_version: 1,
      session_id: fixture.session_id,
      role: 'assistant',
      content: 'fixture canonical output',
      source_message_id: `codex_cli:canonical-latency-${index}`,
    };
    proxy.ws.send(JSON.stringify(canonicalMessage));
    await waitFor(
      () => browser.messages.find(message => (
        message.type === 'message'
        && message.source_message_id === canonicalMessage.source_message_id
        && !message.latency_trace
      )),
      5000,
      'canonical assistant persistence before trace replay',
    );
    proxy.ws.send(JSON.stringify({ ...canonicalMessage, latency_trace: trace }));
    rendered = await waitFor(
      () => browser.messages.find(message => (
        message.type === 'proxy_message'
        && message.source_message_id === canonicalMessage.source_message_id
        && message.latency_trace?.trace_id === traceId
      )),
      5000,
      'traced canonical duplicate relay broadcast',
    );
    assert.strictEqual(
      browser.messages.filter(message => (
        (message.type === 'message' || message.type === 'proxy_message')
        && message.source_message_id === canonicalMessage.source_message_id
      )).length,
      2,
      'canonical trace replay must broadcast exactly once without another persistence row',
    );
  } else {
    const messageId = `latency-message-${index}`;
    proxy.ws.send(JSON.stringify({
      type: 'message_delta',
      protocol_version: 1,
      session_id: fixture.session_id,
      message_id: messageId,
      role: 'assistant',
      block_index: 0,
      block_type: 'text',
      seq: 0,
      op: 'block_open',
    }));
    proxy.ws.send(JSON.stringify({
      type: 'message_delta',
      protocol_version: 1,
      session_id: fixture.session_id,
      message_id: messageId,
      role: 'assistant',
      block_index: 0,
      block_type: 'text',
      seq: 1,
      op: 'append',
      append: 'fixture output',
      latency_trace: trace,
    }));
    rendered = await waitFor(
      () => browser.messages.find(message => (
        message.type === 'message_delta'
        && message.message_id === messageId
        && message.op === 'append'
        && message.latency_trace?.trace_id === traceId
      )),
      5000,
      `relay broadcast ${fixture.agent_type}`,
    );
  }
  assert(rendered.latency_trace.stages.relay_broadcast >= trace.stages.agent_first_output);
  const renderAtMs = Date.now();
  const render = tracedStage(
    renderAtMs,
    'browser',
    browser.clockEstimate,
    'fixture_post_paint',
  );
  const completed = advanceLatencyTrace(
    rendered.latency_trace,
    'webui_render',
    renderAtMs,
    render.source,
  ).trace;
  const completion = {
    type: 'latency_trace_complete',
    protocol_version: 1,
    latency_trace: completed,
  };
  browser.ws.send(JSON.stringify(completion));
  browser.ws.send(JSON.stringify(completion));
  return { traceId, cid };
}

async function registerPendingTrace(proxy, browser, fixture, suffix, { traced = true } = {}) {
  const cid = `cmsg-latency-terminal-${suffix}`;
  const traceId = `latency-relay-terminal-${suffix}`;
  const webuiSendAtMs = Date.now() - 5;
  const webuiSend = tracedStage(
    webuiSendAtMs,
    'browser',
    browser.clockEstimate,
    'relay_terminal_e2e_fixture',
  );
  browser.ws.send(JSON.stringify({
    type: 'send',
    session: fixture.session_id,
    content: `owned terminal fixture ${suffix}`,
    client_message_id: cid,
    ...(traced ? {
      latency_trace: {
        schema_version: 2,
        trace_id: traceId,
        client_message_id: cid,
        agent_type: fixture.agent_type,
        stages: { webui_send: webuiSend.adjustedAtMs },
        raw_stages: { webui_send: webuiSendAtMs },
        stage_sources: { webui_send: webuiSend.source },
      },
    } : {}),
  }));
  const nativeSend = await waitFor(
    () => proxy.messages.find(message => (
      message.type === 'send' && message.client_message_id === cid
    )),
    5000,
    `pending terminal dispatch ${suffix}`,
  );
  if (traced) assert.strictEqual(nativeSend.latency_trace?.trace_id, traceId);
  else assert.strictEqual(nativeSend.latency_trace, undefined);
  return { cid, traceId, nativeSend };
}

async function sendProxyTerminal(proxy, browser, fixture, pending, reason) {
  const terminal = {
    schema_version: 1,
    trace_id: pending.traceId,
    client_message_id: pending.cid,
    agent_type: fixture.agent_type,
    reason,
    terminal_at_ms: Date.now(),
    stages_completed: Object.keys(pending.nativeSend.latency_trace?.stages || {}),
  };
  proxy.ws.send(JSON.stringify({
    type: 'latency_trace_terminal',
    protocol_version: 1,
    latency_trace_terminal: terminal,
  }));
  return waitFor(
    () => browser.messages.find(message => (
      message.type === 'latency_trace_terminal'
      && message.latency_trace_terminal?.trace_id === pending.traceId
    )),
    5000,
    `terminal broadcast ${pending.traceId}`,
  );
}

async function main() {
  const port = await freePort();
  const relay = startRelay(port);
  let proxy;
  let browser;
  try {
    await waitFor(() => healthy(port), 10000, 'relay health');
    proxy = await openSocket(port, '/proxy-ws', 'proxy', 'latency-relay-proxy');
    browser = await openSocket(port, '/client-ws', 'browser', 'latency-relay-browser');
    const proxyClock = await sampleRelayClock(proxy, 'proxy');
    const browserClock = await sampleRelayClock(browser, 'browser');
    registerFixtures(proxy);
    await waitFor(
      () => browser.messages.some(message => message.type === 'session_list'),
      5000,
      'session list',
    );
    browser.ws.send(JSON.stringify({
      type: 'subscribe',
      sessions: fixtures.map(fixture => fixture.session_id),
      request_id: 'latency-subscribe',
    }));
    await waitFor(
      () => browser.messages.some(message => (
        message.type === 'subscription_ack' && message.request_id === 'latency-subscribe'
      )),
      5000,
      'subscription ack',
    );

    const receipts = [];
    for (let index = 0; index < fixtures.length; index += 1) {
      receipts.push(await runFixture(proxy, browser, fixtures[index], index + 1));
    }

    const explicitTerminal = await registerPendingTrace(
      proxy,
      browser,
      fixtures[0],
      'explicit',
    );
    await sendProxyTerminal(
      proxy,
      browser,
      fixtures[0],
      explicitTerminal,
      'causal_identity_ambiguous',
    );
    await sendProxyTerminal(
      proxy,
      browser,
      fixtures[0],
      explicitTerminal,
      'causal_identity_ambiguous',
    );
    await sleep(100);
    assert.strictEqual(browser.messages.filter(message => (
      message.type === 'latency_trace_terminal'
      && message.latency_trace_terminal?.trace_id === explicitTerminal.traceId
    )).length, 1, 'duplicate proxy terminals must not rebroadcast');

    const durableReceiptTerminal = await registerPendingTrace(
      proxy,
      browser,
      fixtures[1],
      'durable-receipt',
      { traced: false },
    );
    await sendProxyTerminal(
      proxy,
      browser,
      fixtures[1],
      durableReceiptTerminal,
      'proxy_stopped',
    );

    const failedSendTerminal = await registerPendingTrace(
      proxy,
      browser,
      fixtures[1],
      'failed-send',
    );
    proxy.ws.send(JSON.stringify({
      type: 'proxy_send_result',
      protocol_version: 1,
      session_id: fixtures[1].session_id,
      client_message_id: failedSendTerminal.cid,
      result: 'failed',
      error: { code: 'relay_terminal_fixture_failure' },
    }));
    await waitFor(
      () => browser.messages.find(message => (
        message.type === 'latency_trace_terminal'
        && message.latency_trace_terminal?.trace_id === failedSendTerminal.traceId
        && message.latency_trace_terminal?.reason === 'send_failed'
      )),
      5000,
      'failed-send terminal fallback',
    );

    const ttlTerminal = await registerPendingTrace(
      proxy,
      browser,
      fixtures[2],
      'relay-ttl',
    );
    await waitFor(
      () => browser.messages.find(message => (
        message.type === 'latency_trace_terminal'
        && message.latency_trace_terminal?.trace_id === ttlTerminal.traceId
        && message.latency_trace_terminal?.reason === 'expired_before_delivery'
      )),
      5000,
      'independent relay TTL terminal',
    );

    const expectedRows = fixtures.length + 4;
    await waitFor(
      () => fs.existsSync(LEDGER_PATH)
        && fs.readFileSync(LEDGER_PATH, 'utf8').trim().split(/\r?\n/).length === expectedRows,
      5000,
      'deduplicated latency ledger rows',
    );
    const text = fs.readFileSync(LEDGER_PATH, 'utf8');
    const rows = text.trim().split(/\r?\n/).map(JSON.parse);
    assert.strictEqual(rows.length, expectedRows);
    assert.deepStrictEqual(
      rows.slice(0, fixtures.length).map(row => row.agent_type),
      fixtures.map(fixture => fixture.agent_type),
    );
    assert(rows.every(row => row.sample_kind === 'real_webui_send'));
    assert(rows.slice(0, fixtures.length).every(row => (
      Object.keys(row.raw_stages || {}).length === 7
      && Object.keys(row.raw_durations_ms || {}).length === 7
      && row.stage_sources.webui_send.clock_status === 'synchronized'
      && row.stage_sources.relay_recv.clock_status === 'reference'
      && row.stage_sources.proxy_recv.clock_status === 'synchronized'
      && row.stage_sources.relay_broadcast.clock_status === 'reference'
      && row.stage_sources.webui_render.clock_status === 'synchronized'
    )));
    assert(rows.every(row => row.session_id == null && row.content == null));
    assert(!fixtures.some(fixture => text.includes(fixture.session_id)));
    assert(!text.includes('owned latency relay fixture'));
    console.log(JSON.stringify({
      ok: true,
      owned_fixture_transport_sends: fixtures.length,
      acceptance_real_native_sends: false,
      agent_types: rows.map(row => row.agent_type),
      stages: Object.keys(rows[0].stages),
      exact_once_rows: rows.length,
      measured_rows: rows.filter(row => row.measurement_status !== 'unmeasured').length,
      terminal_rows: rows.filter(row => row.measurement_status === 'unmeasured').length,
      duplicate_render_acks: fixtures.length,
      relay_clock_samples: {
        proxy: proxyClock,
        browser: browserClock,
      },
      raw_and_adjusted_stage_parity: true,
      duplicate_terminal_broadcasts: 0,
      durable_receipt_recovery: true,
      failed_send_terminal_fallback: true,
      independent_relay_ttl: true,
      canonical_duplicate_trace_replays: 1,
      persisted_session_ids: false,
      persisted_content: false,
      visible_windows_opened: 0,
      protected_sessions_touched: 0,
      trace_ids: receipts.map(receipt => receipt.traceId),
    }, null, 2));
  } finally {
    await closeSocket(browser);
    await closeSocket(proxy);
    await stopRelay(relay);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`Latency trace relay E2E: FAIL (${error.stack || error.message || error})`);
  if (logs.length > 0) console.error(logs.join(''));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
