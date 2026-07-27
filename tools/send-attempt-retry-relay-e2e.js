#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-send-attempt-retry-'));
const sessionId = '11111111-2222-4333-8444-555555555555';
const logs = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
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
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function startRelay(port) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'send-attempt-retry-session-secret-0123456789',
      JWT_SECRET: 'send-attempt-retry-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'send-attempt-retry-client',
      GOOGLE_CLIENT_SECRET: 'send-attempt-retry-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return { child, origin };
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(port, route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const origin = `http://127.0.0.1:${port}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timeout = setTimeout(() => reject(new Error(`${name} connection timeout`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'send-attempt-retry-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(
      () => messages.some(message => message.type === 'connection_ack'),
      8000,
      `${name} connection ack`,
    ).then(() => {
      clearTimeout(timeout);
      resolve({ ws, messages });
    }, reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function sendFrame(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function lifecycleFrame(clientMessageId, deliveryAttempt, result, error = null) {
  return {
    type: 'proxy_send_result',
    protocol_version: 1,
    session_id: sessionId,
    client_message_id: clientMessageId,
    delivery_attempt: deliveryAttempt,
    result,
    ...(result === 'delivered'
      ? {
          delivered_at: new Date().toISOString(),
          native_receipt: {
            thread_id: 'fixture-thread',
            turn_id: `fixture-turn-${deliveryAttempt}`,
            process_epoch: `fixture-epoch-${deliveryAttempt}`,
            observed_at: new Date().toISOString(),
          },
        }
      : result === 'launch_accepted'
        ? { accepted_at: new Date().toISOString(), process_epoch: `fixture-epoch-${deliveryAttempt}` }
        : { error: error || { code: 'fixture_failure', message: 'fixture failure' } }),
  };
}

async function main() {
  const port = await freePort();
  const { child, origin } = startRelay(port);
  let proxy;
  let browserA;
  let browserB;
  try {
    await waitFor(async () => {
      if (child.exitCode != null) throw new Error(logs.join('').slice(-8000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');

    proxy = await openSocket(port, '/proxy-ws', 'proxy', 'send-attempt-proxy');
    browserA = await openSocket(port, '/client-ws', 'browser', 'send-attempt-browser-a');
    browserB = await openSocket(port, '/client-ws', 'browser', 'send-attempt-browser-b');
    for (const browser of [browserA, browserB]) {
      sendFrame(browser.ws, {
        type: 'subscribe',
        request_id: `subscribe-${Math.random()}`,
        sessions: [sessionId],
      });
      await waitFor(
        () => browser.messages.some(message => message.type === 'subscription_ack'),
        5000,
        'browser subscription',
      );
    }
    sendFrame(proxy.ws, {
      type: 'proxy_session_snapshot',
      protocol_version: 1,
      proxy_id: 'send-attempt-proxy',
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex-desktop',
        status: 'healthy',
      }],
    });
    await sleep(100);

    const retryableCid = 'retryable-client-message';
    const retryableContent = 'retry the same durable message exactly once';
    sendFrame(browserA.ws, {
      type: 'send',
      session: sessionId,
      client_message_id: retryableCid,
      content: retryableContent,
    });
    const firstDispatch = await waitFor(
      () => proxy.messages.find(message => message.type === 'send'
        && message.client_message_id === retryableCid),
      5000,
      'first proxy dispatch',
    );
    assert.strictEqual(firstDispatch.delivery_attempt, 1);
    sendFrame(proxy.ws, lifecycleFrame(retryableCid, 1, 'failed', {
      code: 'pending_revalidation',
      message: 'fixture gate rejected before native',
      retryable: true,
      native_attempted: false,
    }));
    await waitFor(
      () => browserA.messages.some(message => message.type === 'proxy_send_result'
        && message.client_message_id === retryableCid && message.result === 'failed'),
      5000,
      'retryable failure broadcast',
    );

    for (let index = 0; index < 1000; index += 1) {
      sendFrame(proxy.ws, {
        type: 'history_snapshot',
        protocol_version: 1,
        session: sessionId,
        messages: [],
        replace_all: index === 0,
      });
    }
    await sleep(750);
    const failedOverlayDb = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
    const failedOverlayRows = failedOverlayDb.prepare(`
      SELECT client_msg_id, content, status, failure_native_attempted,
             failure_retryable
      FROM messages WHERE client_msg_id = ?
    `).all(retryableCid);
    failedOverlayDb.close();
    assert.deepStrictEqual(failedOverlayRows, [{
      client_msg_id: retryableCid,
      content: retryableContent,
      status: 'failed',
      failure_native_attempted: 0,
      failure_retryable: 1,
    }], '1,000 native snapshots must preserve one retry-safe failed row');

    await closeSocket(browserB.ws);
    browserB = await openSocket(port, '/client-ws', 'browser', 'send-attempt-browser-b-reconnected');
    sendFrame(browserB.ws, {
      type: 'subscribe',
      request_id: 'subscribe-reconnected',
      sessions: [sessionId],
    });
    await waitFor(
      () => browserB.messages.some(message => message.type === 'subscription_ack'),
      5000,
      'reconnected browser subscription',
    );
    sendFrame(browserB.ws, {
      type: 'history_request',
      request_id: 'failed-overlay-history',
      session: sessionId,
      full: true,
    });
    const hydratedFailure = await waitFor(
      () => browserB.messages.find(message => message.type === 'history'
        && message.request_id === 'failed-overlay-history'),
      5000,
      'failed overlay history hydration after reconnect',
    );
    assert.strictEqual(hydratedFailure.messages.length, 1);
    assert.strictEqual(hydratedFailure.messages[0].client_msg_id, retryableCid);
    assert.strictEqual(hydratedFailure.messages[0].content, retryableContent);
    assert.strictEqual(hydratedFailure.messages[0].status, 'failed');

    const retryStartedAt = Date.now();
    sendFrame(browserA.ws, {
      type: 'send',
      session: sessionId,
      client_message_id: retryableCid,
      content: retryableContent,
      retry_failed: true,
    });
    const secondDispatch = await waitFor(
      () => proxy.messages.filter(message => message.type === 'send'
        && message.client_message_id === retryableCid).length === 2
        && proxy.messages.filter(message => message.type === 'send'
          && message.client_message_id === retryableCid)[1],
      5000,
      'second proxy dispatch',
    );
    const retryDispatchMs = Date.now() - retryStartedAt;
    assert.strictEqual(secondDispatch.delivery_attempt, 2);
    assert(retryDispatchMs <= 2000, `retry dispatch exceeded 2s: ${retryDispatchMs}ms`);
    await waitFor(
      () => [browserA, browserB].every(browser => browser.messages.some(message =>
        message.type === 'message_accepted'
        && message.client_message_id === retryableCid
        && message.delivery_attempt === 2
        && message.retry_restarted === true)),
      5000,
      'two-tab retry acceptance',
    );

    sendFrame(proxy.ws, lifecycleFrame(retryableCid, 2, 'delivered'));
    await waitFor(
      () => [browserA, browserB].every(browser => browser.messages.some(message =>
        message.type === 'proxy_send_result'
        && message.client_message_id === retryableCid
        && message.result === 'delivered'
        && message.delivery_attempt === 2)),
      5000,
      'two-tab delivered receipt',
    );
    const postDeliveredCounts = [browserA, browserB].map(browser =>
      browser.messages.filter(message => message.client_message_id === retryableCid
        && ['proxy_send_result', 'agent_started', 'message_queued', 'queue_delivered'].includes(message.type)).length);

    for (let index = 0; index < 1000; index += 1) {
      const mode = index % 7;
      if (mode === 0) sendFrame(proxy.ws, lifecycleFrame(retryableCid, 1, 'delivered'));
      else if (mode === 1) sendFrame(proxy.ws, lifecycleFrame(retryableCid, 1, 'failed'));
      else if (mode === 2) sendFrame(proxy.ws, lifecycleFrame(retryableCid, 2, 'failed'));
      else if (mode === 3) sendFrame(proxy.ws, lifecycleFrame(retryableCid, 2, 'launch_accepted'));
      else if (mode === 4) sendFrame(proxy.ws, lifecycleFrame(retryableCid, 2, 'delivered'));
      else if (mode === 5) sendFrame(proxy.ws, {
        type: 'message_queued',
        session_id: sessionId,
        client_message_id: retryableCid,
        delivery_attempt: 1,
        content: retryableContent,
      });
      else sendFrame(proxy.ws, {
        type: 'queue_delivered',
        session_id: sessionId,
        client_message_id: retryableCid,
        delivery_attempt: 1,
      });
    }
    await sleep(750);
    assert.deepStrictEqual(
      [browserA, browserB].map(browser =>
        browser.messages.filter(message => message.client_message_id === retryableCid
          && ['proxy_send_result', 'agent_started', 'message_queued', 'queue_delivered'].includes(message.type)).length),
      postDeliveredCounts,
      '1,000 stale/replayed lifecycle frames must produce zero state-regressing broadcasts',
    );

    sendFrame(proxy.ws, {
      type: 'agent_started',
      protocol_version: 1,
      session_id: sessionId,
      client_message_id: retryableCid,
      delivery_attempt: 2,
      delivered_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      native_receipt: {
        thread_id: 'fixture-thread',
        turn_id: 'fixture-turn-2',
        process_epoch: 'fixture-epoch-2',
        observed_at: new Date().toISOString(),
      },
    });
    await waitFor(
      () => [browserA, browserB].every(browser => browser.messages.some(message =>
        message.type === 'agent_started'
        && message.client_message_id === retryableCid
        && message.delivery_attempt === 2)),
      5000,
      'attempt-scoped agent started',
    );

    const unsafeCid = 'unsafe-client-message';
    const unsafeContent = 'never redispatch an uncertain native attempt';
    sendFrame(browserA.ws, {
      type: 'send',
      session: sessionId,
      client_message_id: unsafeCid,
      content: unsafeContent,
    });
    await waitFor(
      () => proxy.messages.some(message => message.type === 'send'
        && message.client_message_id === unsafeCid),
      5000,
      'unsafe first dispatch',
    );
    sendFrame(proxy.ws, lifecycleFrame(unsafeCid, 1, 'failed', {
      code: 'native_receipt_missing',
      message: 'native outcome is uncertain',
      retryable: true,
      native_attempted: true,
    }));
    await waitFor(
      () => browserA.messages.some(message => message.type === 'proxy_send_result'
        && message.client_message_id === unsafeCid && message.result === 'failed'),
      5000,
      'unsafe failure broadcast',
    );
    const unsafeDispatchesBefore = proxy.messages.filter(message =>
      message.type === 'send' && message.client_message_id === unsafeCid).length;
    sendFrame(browserA.ws, {
      type: 'send',
      session: sessionId,
      client_message_id: unsafeCid,
      content: unsafeContent,
      retry_failed: true,
    });
    await waitFor(
      () => browserA.messages.some(message => message.type === 'message_accepted'
        && message.client_message_id === unsafeCid
        && message.retry_rejected === 'retry_not_proven_safe'),
      5000,
      'unsafe retry rejection',
    );
    await sleep(100);
    assert.strictEqual(
      proxy.messages.filter(message => message.type === 'send'
        && message.client_message_id === unsafeCid).length,
      unsafeDispatchesBefore,
      'native-attempted failure must never redispatch',
    );

    sendFrame(browserA.ws, {
      type: 'send',
      session: sessionId,
      client_message_id: retryableCid,
      content: 'different content under the same identity',
      retry_failed: true,
    });
    await waitFor(
      () => browserA.messages.some(message => message.type === 'message_failed'
        && message.client_message_id === retryableCid
        && message.error?.code === 'client_message_id_content_mismatch'),
      5000,
      'content mismatch rejection',
    );

    const db = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
    const messageRows = db.prepare(
      'SELECT client_msg_id, status, delivery_attempt, failure_code FROM messages ORDER BY id',
    ).all();
    const attemptRows = db.prepare(
      `SELECT client_msg_id, delivery_attempt, status, failure_native_attempted,
              failure_retryable
       FROM send_attempts ORDER BY client_msg_id, delivery_attempt`,
    ).all();
    db.close();
    assert.strictEqual(messageRows.length, 2, 'retry must not create duplicate transcript rows');
    assert.deepStrictEqual(messageRows.find(row => row.client_msg_id === retryableCid), {
      client_msg_id: retryableCid,
      status: 'agent_started',
      delivery_attempt: 2,
      failure_code: null,
    });
    assert.deepStrictEqual(
      attemptRows.filter(row => row.client_msg_id === retryableCid).map(row => ({
        delivery_attempt: row.delivery_attempt,
        status: row.status,
        native_attempted: row.failure_native_attempted,
        retryable: row.failure_retryable,
      })),
      [
        { delivery_attempt: 1, status: 'failed', native_attempted: 0, retryable: 1 },
        { delivery_attempt: 2, status: 'agent_started', native_attempted: null, retryable: null },
      ],
    );

    console.log(JSON.stringify({
      status: 'PASS',
      model: 'none',
      effort: 'none',
      protected_sessions_touched: 0,
      visible_windows: 0,
      browsers: 2,
      retry_dispatch_ms: retryDispatchMs,
      replayed_lifecycle_frames: 1000,
      replayed_history_snapshots: 1000,
      reconnected_failed_history_rows: 1,
      duplicate_transcript_rows: 0,
      safe_retry_native_dispatches: 2,
      unsafe_retry_native_dispatches: unsafeDispatchesBefore,
      durable_attempts: attemptRows.length,
      terminal_status: 'agent_started',
    }));
  } finally {
    await Promise.all([
      closeSocket(browserA?.ws),
      closeSocket(browserB?.ws),
      closeSocket(proxy?.ws),
    ]);
    await stopChild(child);
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  if (logs.length) console.error(logs.join('').slice(-12_000));
  process.exitCode = 1;
});
