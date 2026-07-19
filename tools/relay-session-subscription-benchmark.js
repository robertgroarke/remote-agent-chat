#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] || 'before';
const outputArg = args.indexOf('--output');
const outputPath = outputArg >= 0 ? path.resolve(args[outputArg + 1]) : null;
assert(['before', 'after'].includes(mode), '--mode must be before or after');

const sessionCount = 60;
const activeSessionCount = 4;
const selectedSessionIndex = 4;
const subscribedIndexes = [0, 1, 2, 3, selectedSessionIndex];
const port = 36800 + Math.floor(Math.random() * 250);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-subscription-bench-'));
const relayLogs = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function openSocket(route, peerRole, clientName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`${peerRole} connection timeout`)), 8000);
    ws.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      messages.push({ message, bytes: Buffer.byteLength(data) });
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: peerRole,
        ...(peerRole === 'proxy'
          ? { proxy_id: clientName, machine_label: 'session-subscription-benchmark' }
          : { client_name: clientName }),
      }));
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    waitFor(
      () => messages.some(entry => entry.message.type === 'connection_ack'),
      8000,
      `${peerRole} connection ack`,
    ).then(() => {
      clearTimeout(timer);
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

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'session-subscription-benchmark-secret-0123456789',
      JWT_SECRET: 'session-subscription-benchmark-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'session-subscription-benchmark-client',
      GOOGLE_CLIENT_SECRET: 'session-subscription-benchmark-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => relayLogs.push(String(chunk)));
  relay.stderr.on('data', chunk => relayLogs.push(String(chunk)));
  let proxy;
  let browser;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(relayLogs.join('').slice(-4000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'session-subscription-benchmark-proxy');
    browser = await openSocket('/client-ws', 'browser', 'session-subscription-benchmark-phone');

    const sessions = Array.from({ length: sessionCount }, (_, index) => ({
      session_id: `subscription-session-${index}`,
      agent_type: index % 2 ? 'codex_cli' : 'claude_cli',
      display_name: `Subscription session ${index}`,
      workspace_path: root,
      status: 'healthy',
      activity: index < activeSessionCount
        ? { kind: 'working', label: 'Working', started_at: new Date().toISOString() }
        : { kind: 'idle', label: '' },
    }));
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: 'session-subscription-benchmark-proxy',
      sessions,
    }));
    await waitFor(
      () => browser.messages.some(entry => Array.isArray(entry.message.sessions)
        && entry.message.sessions.length === sessionCount),
      5000,
      '60-session inventory',
    );

    if (mode === 'after') {
      browser.ws.send(JSON.stringify({
        type: 'subscribe',
        request_id: 'subscription-benchmark-request',
        sessions: subscribedIndexes.map(index => sessions[index].session_id),
      }));
      await waitFor(
        () => browser.messages.some(entry => entry.message.type === 'subscription_ack'
          && entry.message.request_id === 'subscription-benchmark-request'),
        5000,
        'subscription ack',
      );
      browser.ws.send(JSON.stringify({
        type: 'subscribe',
        request_id: 'subscription-benchmark-invalid',
        sessions: Array.from({ length: 129 }, (_, index) => `invalid-overflow-${index}`),
      }));
      await waitFor(
        () => browser.messages.some(entry => entry.message.type === 'connection_error'
          && entry.message.request_id === 'subscription-benchmark-invalid'
          && entry.message.code === 'invalid_subscription'),
        5000,
        'invalid subscription rejection',
      );
    }

    const measurementStart = browser.messages.length;
    const activePayload = 'd'.repeat(512);
    const backgroundPayload = 'm'.repeat(2048);
    const backgroundStatusPayload = 's'.repeat(512);

    // One deterministic minute of logical traffic, emitted without wall-clock delay:
    // four active prefetched tails, one selected idle session, and 55 summary-only
    // background sessions.
    for (let index = 0; index < activeSessionCount; index++) {
      const sessionId = sessions[index].session_id;
      proxy.ws.send(JSON.stringify({
        type: 'message_delta',
        session_id: sessionId,
        message_id: `active-${index}`,
        role: 'assistant',
        block_index: 0,
        block_type: 'text',
        seq: 0,
        op: 'block_open',
      }));
      for (let tick = 0; tick < 60; tick++) {
        proxy.ws.send(JSON.stringify({
          type: 'message_delta',
          session_id: sessionId,
          message_id: `active-${index}`,
          role: 'assistant',
          block_index: 0,
          block_type: 'text',
          seq: tick + 1,
          op: 'append',
          append: activePayload,
        }));
      }
      proxy.ws.send(JSON.stringify({
        type: 'message_delta',
        session_id: sessionId,
        message_id: `active-${index}`,
        role: 'assistant',
        block_index: 0,
        block_type: 'text',
        seq: 61,
        op: 'block_close',
      }));
      for (let tick = 0; tick < 6; tick++) {
        proxy.ws.send(JSON.stringify({
          type: 'status',
          session: sessionId,
          thinking: true,
          label: 'Working',
          activity: {
            kind: 'working',
            label: 'Working',
            current: { kind: 'answer', partial: activePayload },
          },
        }));
      }
      for (let tick = 0; tick < 2; tick++) {
        proxy.ws.send(JSON.stringify({
          type: 'proxy_message',
          session_id: sessionId,
          role: 'assistant',
          content: `active-${index}-${tick}-${backgroundPayload}`,
        }));
      }
    }

    for (let index = activeSessionCount; index < sessionCount; index++) {
      const sessionId = sessions[index].session_id;
      for (let tick = 0; tick < 4; tick++) {
        proxy.ws.send(JSON.stringify({
          type: 'status',
          session: sessionId,
          thinking: false,
          label: '',
          activity: {
            kind: 'idle',
            label: '',
            current: { kind: 'answer', partial: backgroundStatusPayload },
          },
        }));
      }
      for (let tick = 0; tick < 2; tick++) {
        proxy.ws.send(JSON.stringify({
          type: 'proxy_message',
          session_id: sessionId,
          role: 'assistant',
          content: `background-${index}-${tick}-${backgroundPayload}`,
        }));
      }
    }

    const sentinelSession = sessions[sessionCount - 1].session_id;
    const sentinelGoalFingerprint = 'goal:subscription-summary-sentinel';
    proxy.ws.send(JSON.stringify({
      type: 'status',
      session: sentinelSession,
      thinking: false,
      label: 'BENCHMARK_SENTINEL',
      activity: {
        kind: 'idle',
        label: 'BENCHMARK_SENTINEL',
        goal: {
          objective: 'Keep the summary-only session in Working.',
          fingerprint: sentinelGoalFingerprint,
          generation: 1,
          status: 'active',
        },
        goal_run: {
          schema_version: 1,
          run_id: 'goal-run:subscription-summary-sentinel',
          goal_fingerprint: sentinelGoalFingerprint,
          goal_generation: 1,
          lifecycle: 'checkpoint_pending_continuation',
          lease_active: true,
          owner_state: 'confirmed',
        },
      },
    }));
    await waitFor(
      () => browser.messages.slice(measurementStart).some(entry => (
        (entry.message.type === 'status' || entry.message.type === 'session_summary')
        && (entry.message.session || entry.message.session_id) === sentinelSession
        && (entry.message.label === 'BENCHMARK_SENTINEL'
          || entry.message.activity?.label === 'BENCHMARK_SENTINEL')
      )),
      15_000,
      'terminal summary sentinel',
    );
    await sleep(250);

    const measured = browser.messages.slice(measurementStart);
    const subscribedIds = new Set(subscribedIndexes.map(index => sessions[index].session_id));
    const fullTypes = new Set(['message', 'proxy_message', 'message_delta', 'status', 'proxy_status', 'history', 'history_snapshot']);
    const byType = {};
    let totalBytes = 0;
    let backgroundFullFidelityEvents = 0;
    let compactSummaryRows = [];
    for (const entry of measured) {
      totalBytes += entry.bytes;
      byType[entry.message.type] = (byType[entry.message.type] || 0) + 1;
      const sessionId = entry.message.session || entry.message.session_id;
      if (sessionId && !subscribedIds.has(sessionId) && fullTypes.has(entry.message.type)) {
        backgroundFullFidelityEvents++;
      }
    }
    if (mode === 'after') {
      assert.equal(backgroundFullFidelityEvents, 0,
        'summary-only background sessions received full-fidelity traffic');
      assert((byType.session_summary || 0) > 0, 'no background session summaries were received');
      compactSummaryRows = measured.filter(entry => entry.message.type === 'session_summary');
      assert(compactSummaryRows.every(entry => entry.message.activity?.work_context),
        'one or more background summaries omitted bounded work context');
      assert(compactSummaryRows.every(entry => !entry.message.activity?.current
        && !entry.message.activity?.thinking && !entry.message.activity?.task_list
        && !entry.message.activity?.step),
      'a compact background summary leaked raw current/thinking/task/step state');
      assert(compactSummaryRows.every(entry => Buffer.byteLength(JSON.stringify(entry.message.activity.work_context), 'utf8') <= 512),
        'a compact background work-context record exceeded 512 bytes');
      const sentinelSummary = compactSummaryRows.find(entry => (
        (entry.message.session || entry.message.session_id) === sentinelSession
        && entry.message.activity?.label === 'BENCHMARK_SENTINEL'
      ));
      assert(sentinelSummary, 'summary-only goal-run sentinel was not received');
      assert.equal(sentinelSummary.message.activity.goal?.fingerprint, sentinelGoalFingerprint,
        'compact summary omitted the canonical goal fingerprint');
      assert.equal(sentinelSummary.message.activity.goal_run?.goal_fingerprint, sentinelGoalFingerprint,
        'compact summary omitted the canonical goal-run lease');
      assert.equal(sentinelSummary.message.activity.goal_run?.lifecycle, 'checkpoint_pending_continuation',
        'compact summary changed the canonical goal-run lifecycle');
      assert.equal(sentinelSummary.message.activity.goal_run?.lease_active, true,
        'compact summary released the canonical goal-run lease');
    } else {
      assert(backgroundFullFidelityEvents > 0, 'baseline unexpectedly filtered background traffic');
    }

    const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'));
    const result = {
      ok: true,
      mode,
      generated_at: new Date().toISOString(),
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      relay_source_sha256: crypto.createHash('sha256').update(relaySource).digest('hex'),
      relay_source_dirty: !!execFileSync('git', ['status', '--short', '--', 'relay-server/index.js'], {
        cwd: root, encoding: 'utf8', windowsHide: true,
      }).trim(),
      logical_duration_minutes: 1,
      workload: {
        sessions: sessionCount,
        active_prefetch_sessions: activeSessionCount,
        selected_sessions: 1,
        summary_only_sessions: sessionCount - subscribedIndexes.length,
        subscribed_session_ids: [...subscribedIds],
      },
      websocket_bytes_per_minute: totalBytes,
      events_per_minute: measured.length,
      events_by_type: byType,
      background_full_fidelity_events: backgroundFullFidelityEvents,
      compact_work_context_summaries: compactSummaryRows.length,
      compact_work_context_max_bytes: compactSummaryRows.length === 0 ? 0 : Math.max(...compactSummaryRows.map(entry => (
        Buffer.byteLength(JSON.stringify(entry.message.activity.work_context), 'utf8')
      ))),
      raw_current_thinking_task_step_leaks: 0,
      invalid_subscription_rejected: mode === 'after',
      visible_windows_opened: 0,
      focus_actions: 0,
      production_mutations: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeSocket(browser?.ws).catch(() => {});
    await closeSocket(proxy?.ws).catch(() => {});
    await stopChild(relay);
    const tempRoot = path.resolve(os.tmpdir()).toLowerCase();
    const resolved = path.resolve(dataDir);
    assert(resolved.toLowerCase().startsWith(`${tempRoot}${path.sep}`));
    assert(path.basename(resolved).startsWith('rac-session-subscription-bench-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
