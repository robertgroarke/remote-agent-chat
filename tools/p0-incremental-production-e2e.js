#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const root = path.resolve(__dirname, '..');
const PRODUCER_COMMIT = 'bd324f23f00c9c2b05537f7e169d36f43b1be514';
const RELAY_COMMIT = '7e9adc74fd625782383faa66b1b0a1e58783cb7a';
const args = process.argv.slice(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const outputPath = argValue('--output');
const activeProxySourceRoot = argValue('--active-proxy-source-root');
const activeProxyPid = Number(argValue('--active-proxy-pid'));
if (args.includes('--output') && !outputPath) throw new Error('--output requires a path');
if (!args.includes('--confirm-live-production')) {
  throw new Error('Refusing production protocol mutation without --confirm-live-production');
}
if (!activeProxySourceRoot) throw new Error('--active-proxy-source-root is required');
if (!Number.isInteger(activeProxyPid) || activeProxyPid <= 0) {
  throw new Error('--active-proxy-pid must be a positive integer');
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: options.timeout || 30_000,
    env: options.env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-2000);
    throw new Error(`${command} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function git(repoRoot, ...gitArgs) {
  return run('git', ['-c', `safe.directory=${repoRoot}`, '-C', repoRoot, ...gitArgs]);
}

function isAncestor(repoRoot, ancestor, descendant = 'HEAD') {
  const result = spawnSync('git', [
    '-c', `safe.directory=${repoRoot}`, '-C', repoRoot,
    'merge-base', '--is-ancestor', ancestor, descendant,
  ], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git merge-base exited ${result.status}: ${String(result.stderr || '').trim()}`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function trackSocket(ws, name) {
  const tracked = { ws, name, messages: [], frames: [] };
  ws.on('message', data => {
    const raw = Buffer.from(data);
    try {
      const message = JSON.parse(raw.toString('utf8'));
      tracked.messages.push(message);
      tracked.frames.push({ message, bytes: raw.length });
    } catch {}
  });
  return tracked;
}

async function waitForOpen(ws, label) {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out opening ${label}`)), 10_000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function openBrowser(origin, token, name) {
  const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/client-ws?token=${encodeURIComponent(token)}`);
  const client = trackSocket(ws, name);
  await waitForOpen(ws, name);
  await waitFor(() => client.messages.find(message => message.type === 'connection_ack'), 10_000, `${name} connection_ack`);
  return client;
}

async function openProxy(origin, secret, proxyId) {
  const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/proxy-ws`);
  const proxy = trackSocket(ws, proxyId);
  await waitForOpen(ws, proxyId);
  ws.send(JSON.stringify({
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'proxy',
    proxy_id: proxyId,
    machine_label: 'p0-incremental-production-e2e',
    secret,
  }));
  await waitFor(() => proxy.messages.find(message => message.type === 'connection_ack'), 10_000, 'proxy connection_ack');
  return proxy;
}

async function subscribe(client, sessions) {
  const requestId = `subscribe-${client.name}-${Date.now()}`;
  client.ws.send(JSON.stringify({ type: 'subscribe', request_id: requestId, sessions }));
  return waitFor(
    () => client.messages.find(message => message.type === 'subscription_ack' && message.request_id === requestId),
    10_000,
    `${client.name} subscription_ack`,
  );
}

async function closeSocket(tracked) {
  const ws = tracked?.ws || tracked;
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

function sessionFrames(client, sessionId, type) {
  return client.frames.filter(({ message }) => (
    message.type === type && (message.session === sessionId || message.session_id === sessionId)
  ));
}

function sourceFrame(sessionId, generation, sourceMessageId, messageIndex, content) {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  const acceptedEndOffset = 10_000 + (messageIndex * 2048) + contentBytes;
  const sourceCursor = {
    generation,
    message_index: messageIndex,
    end_offset: acceptedEndOffset,
    file_size: acceptedEndOffset,
  };
  const createdAt = new Date(Date.now() + messageIndex).toISOString();
  return {
    type: 'proxy_message',
    protocol_version: 1,
    session: sessionId,
    session_id: sessionId,
    role: 'assistant',
    content,
    source_message_id: sourceMessageId,
    source_cursor: sourceCursor,
    source: 'codex_cli_jsonl',
    message: {
      role: 'assistant',
      content,
      created_at: createdAt,
      source_message_id: sourceMessageId,
      source_cursor: sourceCursor,
      source: 'codex_cli_jsonl',
    },
  };
}

async function requestRelayTail(client, sessionId) {
  const requestId = `relay-tail-${client.name}-${Date.now()}`;
  client.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session: sessionId,
    session_id: sessionId,
    request_id: requestId,
    source: 'relay_sqlite',
    mode: 'tail',
    replace: true,
    limit: 200,
  }));
  return waitFor(
    () => client.messages.find(message => message.type === 'history_chunk' && message.request_id === requestId),
    10_000,
    `${client.name} relay tail`,
  );
}

function runActiveProducerSmoke(sourceRoot) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-active-producer-proof-'));
  const output = path.join(tempRoot, 'result.json');
  const dependencyRoots = [
    path.join(root, 'agent-proxy', 'node_modules'),
    path.join(root, 'relay-server', 'node_modules'),
    path.join(root, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean);
  try {
    run(process.execPath, [path.join(sourceRoot, 'tools', 'cli-file-incremental-smoke.js'), '--output', output], {
      cwd: sourceRoot,
      timeout: 90_000,
      env: { ...process.env, NODE_PATH: dependencyRoots.join(path.delimiter) },
    });
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  assert(processAlive(activeProxyPid), `active proxy PID ${activeProxyPid} is not alive`);
  const activeRoot = path.resolve(activeProxySourceRoot);
  assert(fs.existsSync(path.join(activeRoot, 'agent-proxy', 'proxy-engine.js')), 'active proxy source root is incomplete');
  const activeProxyCommit = git(activeRoot, 'rev-parse', 'HEAD');
  assert(isAncestor(activeRoot, PRODUCER_COMMIT), 'active proxy source does not contain the incremental producer commit');
  assert.strictEqual(git(activeRoot, 'status', '--porcelain'), '', 'active proxy source root is dirty');

  const masterHead = git(root, 'rev-parse', 'HEAD');
  assert(isAncestor(root, RELAY_COMMIT), 'master does not contain the incremental relay fanout commit');
  const producerSmoke = runActiveProducerSmoke(activeRoot);
  assert.strictEqual(producerSmoke.ok, true);
  assert.strictEqual(producerSmoke.requestless_history_chunks, 0);
  assert.strictEqual(producerSmoke.duplicate_watcher_frames, 0);

  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  const secret = relayEnv.PROXY_SECRET;
  assert(token, 'JWT bearer token could not be built');
  assert(secret, 'PROXY_SECRET is required');

  const stamp = Date.now();
  const sessionId = `validator-p0-incremental-${stamp}`;
  const proxyId = `p0-incremental-production-${process.pid}`;
  const generation = `p0-production-${stamp}`;
  const operationPayload = `${JSON.stringify({
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    agent: 'p0-incremental-production-e2e',
    kind: 'production-protocol-verification',
  })}\n`;
  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    operationPayload,
  );
  const clients = [];
  let proxy = null;
  let registrationCleaned = false;
  try {
    const subscriber = await openBrowser(origin, token, 'p0-subscriber');
    const summaryOnly = await openBrowser(origin, token, 'p0-summary-only');
    proxy = await openProxy(origin, secret, proxyId);
    clients.push(subscriber, summaryOnly);

    const inventoryPromise = waitFor(
      () => subscriber.messages.find(message => (
        message.type === 'session_list'
        && message.sessions?.some(session => session.session_id === sessionId)
      )),
      10_000,
      'validator session inventory',
    );
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: proxyId,
      sessions: [{
        session_id: sessionId,
        agent_type: 'codex_cli',
        display_name: 'P0 incremental production validator',
        workspace: 'C:\\temp\\remote-agent-chat-p0-incremental-validator',
        workspace_path: 'C:\\temp\\remote-agent-chat-p0-incremental-validator',
        project_group: 'Remote Agent Chat',
        session_kind: 'validator',
        is_test_session: true,
        status: 'healthy',
        activity: { kind: 'idle', label: '', updated_at: new Date().toISOString() },
      }],
    }));
    await inventoryPromise;
    const subscriptionAck = await subscribe(subscriber, [sessionId]);
    await subscribe(summaryOnly, []);
    assert(subscriptionAck.sessions.includes(sessionId));

    const payload = `P0-1K:${'x'.repeat(1018)}`;
    assert.strictEqual(Buffer.byteLength(payload, 'utf8'), 1024);
    const firstFrame = sourceFrame(sessionId, generation, `${generation}:0`, 0, payload);
    const subscriberMessagesBefore = sessionFrames(subscriber, sessionId, 'message').length;
    const summaryMessagesBefore = sessionFrames(summaryOnly, sessionId, 'session_summary').length;
    const subscriberHistoryBefore = sessionFrames(subscriber, sessionId, 'history_chunk').length;
    const summaryHistoryBefore = sessionFrames(summaryOnly, sessionId, 'history_chunk').length;
    proxy.ws.send(JSON.stringify(firstFrame));

    const subscriberFrame = await waitFor(() => (
      sessionFrames(subscriber, sessionId, 'message')[subscriberMessagesBefore]
    ), 10_000, 'subscribed incremental append');
    const summaryFrame = await waitFor(() => (
      sessionFrames(summaryOnly, sessionId, 'session_summary')[summaryMessagesBefore]
    ), 10_000, 'summary-only append');
    assert.strictEqual(subscriberFrame.message.source_message_id, `${generation}:0`);
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'message').length, 0);
    assert.strictEqual(sessionFrames(subscriber, sessionId, 'history_chunk').length, subscriberHistoryBefore);
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'history_chunk').length, summaryHistoryBefore);
    const serializedBytes = subscriberFrame.bytes + summaryFrame.bytes;
    const amplificationLimitBytes = (4 * 1024) + 4096;
    assert(serializedBytes <= amplificationLimitBytes,
      `1 KiB append amplified to ${serializedBytes} bytes (limit ${amplificationLimitBytes})`);

    proxy.ws.send(JSON.stringify(firstFrame));
    await sleep(350);
    assert.strictEqual(sessionFrames(subscriber, sessionId, 'message').length, subscriberMessagesBefore + 1,
      'duplicate source row fanned out twice');

    const gapFrame = sourceFrame(sessionId, generation, `${generation}:2`, 2, 'gap row');
    assert(gapFrame.source_cursor.end_offset > firstFrame.source_cursor.end_offset,
      'gap fixture must advance the accepted source byte offset');
    assert.strictEqual(gapFrame.source_cursor.message_index, firstFrame.source_cursor.message_index + 2,
      'gap fixture must skip exactly one source message index');
    proxy.ws.send(JSON.stringify(gapFrame));
    const subscriberGap = await waitFor(() => (
      sessionFrames(subscriber, sessionId, 'transcript_resync_required')[0]
    ), 10_000, 'subscriber cursor-gap signal');
    const proxyResync = await waitFor(() => proxy.messages.find(message => (
      message.type === 'transcript_resync_required' && message.session_id === sessionId
    )), 10_000, 'proxy cursor-gap recovery request');
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'transcript_resync_required').length, 0,
      'non-subscriber received a transcript-gap signal');
    assert.strictEqual(sessionFrames(subscriber, sessionId, 'message').length, subscriberMessagesBefore + 1,
      'gap row fanned out before recovery');

    const recoveryFrames = [
      firstFrame,
      sourceFrame(sessionId, generation, `${generation}:1`, 1, 'recovered missing row'),
      gapFrame,
    ];
    proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      session: sessionId,
      session_id: sessionId,
      messages: recoveryFrames.map(frame => frame.message),
      resync_id: proxyResync.resync_id,
      resync_reason: proxyResync.reason,
      source: 'codex_cli_jsonl',
      source_cursor: recoveryFrames[2].source_cursor,
      source_bytes: 1024 + Buffer.byteLength('recovered missing row') + Buffer.byteLength('gap row'),
      resync_rate_limit_ms: 5000,
    }));

    const subscriberTail = await requestRelayTail(subscriber, sessionId);
    assert.deepStrictEqual(subscriberTail.messages.map(message => message.source_message_id), [
      `${generation}:0`, `${generation}:1`, `${generation}:2`,
    ]);
    const summaryHistoryAfterSubscriberRequest = sessionFrames(summaryOnly, sessionId, 'history_chunk').length;
    assert.strictEqual(summaryHistoryAfterSubscriberRequest, summaryHistoryBefore,
      'relay history leaked to a non-requester');

    const postRecovery = sourceFrame(sessionId, generation, `${generation}:3`, 3, 'post-recovery live row');
    proxy.ws.send(JSON.stringify(postRecovery));
    await waitFor(() => (
      sessionFrames(subscriber, sessionId, 'message').length === subscriberMessagesBefore + 2
    ), 10_000, 'post-recovery live append');
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'message').length, 0);
    const finalTail = await requestRelayTail(subscriber, sessionId);
    assert.deepStrictEqual(finalTail.messages.map(message => message.source_message_id), [
      `${generation}:0`, `${generation}:1`, `${generation}:2`, `${generation}:3`,
    ]);

    const requestlessSubscriberBefore = sessionFrames(subscriber, sessionId, 'history_chunk').length;
    const requestlessSummaryBefore = sessionFrames(summaryOnly, sessionId, 'history_chunk').length;
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      session: sessionId,
      session_id: sessionId,
      source: 'codex_cli_live_tail',
      messages: Array.from({ length: 50 }, (_, index) => ({ role: 'assistant', content: `legacy-tail-${index}` })),
    }));
    await sleep(350);
    assert.strictEqual(sessionFrames(subscriber, sessionId, 'history_chunk').length, requestlessSubscriberBefore);
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'history_chunk').length, requestlessSummaryBefore);

    const nativeRequestId = `native-explicit-${stamp}`;
    const summaryNativeBefore = sessionFrames(summaryOnly, sessionId, 'history_chunk').length;
    subscriber.ws.send(JSON.stringify({
      type: 'history_chunk_request',
      session: sessionId,
      session_id: sessionId,
      request_id: nativeRequestId,
      source: 'native',
      mode: 'tail',
    }));
    const nativeRequest = await waitFor(() => proxy.messages.find(message => (
      message.type === 'history_chunk_request' && message.request_id === nativeRequestId
    )), 10_000, 'explicit native history request');
    proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      session: sessionId,
      session_id: sessionId,
      request_id: nativeRequest.request_id,
      source: 'native',
      mode: 'tail',
      messages: [{ role: 'assistant', content: 'explicit native history' }],
      partial: false,
      complete: true,
    }));
    await waitFor(() => subscriber.messages.find(message => (
      message.type === 'history_chunk' && message.request_id === nativeRequestId
    )), 10_000, 'explicit native history response');
    assert.strictEqual(sessionFrames(summaryOnly, sessionId, 'history_chunk').length, summaryNativeBefore,
      'native history response leaked to a non-requester');

    const cleanupInventoryIndex = subscriber.messages.length;
    proxy.ws.send(JSON.stringify({ type: 'proxy_session_snapshot', proxy_id: proxyId, sessions: [] }));
    proxy.ws.send(JSON.stringify({ type: 'session_closed', session_id: sessionId, session: sessionId }));
    await waitFor(() => subscriber.messages.slice(cleanupInventoryIndex).find(message => (
      message.type === 'session_list'
      && !message.sessions?.some(session => session.session_id === sessionId)
    )), 10_000, 'validator registration cleanup');
    registrationCleaned = true;

    const activeFiles = [
      'agent-proxy/proxy-engine.js',
      'agent-proxy/claude-cli.js',
      'agent-proxy/codex-cli.js',
      'agent-proxy/cursor-cli.js',
    ];
    const result = {
      ok: true,
      scope: 'p0_incremental_producer_relay_production_activation',
      source_identity: {
        master_head: masterHead,
        active_proxy_commit: activeProxyCommit,
        active_proxy_source_root: activeRoot,
        active_proxy_pid: activeProxyPid,
        active_proxy_pid_alive: true,
        producer_commit_ancestor: PRODUCER_COMMIT,
        relay_commit_ancestor: RELAY_COMMIT,
        active_proxy_source_clean: true,
        active_proxy_file_sha256: Object.fromEntries(activeFiles.map(relative => [
          relative,
          sha256File(path.join(activeRoot, relative)),
        ])),
      },
      producer_exact_active_source_smoke: {
        ok: producerSmoke.ok,
        semantic_append_frames: producerSmoke.semantic_append_frames,
        duplicate_watcher_frames: producerSmoke.duplicate_watcher_frames,
        requestless_history_chunks: producerSmoke.requestless_history_chunks,
        partial_line_retained_until_valid: producerSmoke.partial_line_retained_until_valid,
        rotation_anchor_recovery: producerSmoke.rotation_anchor_recovery,
        restart_stable_source_identity: !!producerSmoke.restart_stable_source_identity,
        rejected_append_retried: producerSmoke.rejected_append_retried,
        mutation_resync_rate_limit_ms: producerSmoke.mutation_resync?.rate_limit_ms,
      },
      live_relay_protocol: {
        test_session: true,
        session_id_sha256: crypto.createHash('sha256').update(sessionId).digest('hex'),
        payload_bytes: 1024,
        producer_frame_bytes: Buffer.byteLength(JSON.stringify(firstFrame), 'utf8'),
        subscribed_incremental_frames: 1,
        non_subscriber_full_frames: 0,
        non_subscriber_summary_frames: sessionFrames(summaryOnly, sessionId, 'session_summary').length,
        first_append_serialized_browser_bytes: serializedBytes,
        first_append_amplification_limit_bytes: amplificationLimitBytes,
        duplicate_rows_fanned_out: 0,
        gap_rows_fanned_out_before_resync: 0,
        subscriber_gap_signals: sessionFrames(subscriber, sessionId, 'transcript_resync_required').length,
        non_subscriber_gap_signals: 0,
        proxy_resync_requests: 1,
        recovery_snapshot_rows: recoveryFrames.length,
        final_relay_rows: finalTail.messages.length,
        final_cursor_message_index: finalTail.messages.at(-1)?.source_cursor?.message_index,
        requestless_history_chunks_delivered: 0,
        explicit_history_nonrequester_deliveries: 0,
        subscriber_gap_reason: subscriberGap.message.reason,
      },
      safety: {
        operation_lock_acquired: true,
        validator_registration_only: true,
        validator_registration_cleanup_verified: true,
        operator_sessions_touched: 0,
        harness_sends: 0,
        harness_controls: 0,
        production_relay_restarts: 0,
        production_proxy_restarts: 0,
        visible_windows_opened: 0,
        focus_actions: 0,
      },
      generated_at: new Date().toISOString(),
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (!registrationCleaned && proxy?.ws?.readyState === WebSocket.OPEN) {
      try {
        proxy.ws.send(JSON.stringify({ type: 'proxy_session_snapshot', proxy_id: proxyId, sessions: [] }));
        proxy.ws.send(JSON.stringify({ type: 'session_closed', session_id: sessionId, session: sessionId }));
        await sleep(250);
      } catch {}
    }
    await Promise.all(clients.map(closeSocket));
    await closeSocket(proxy);
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`p0 incremental production e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
