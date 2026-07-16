#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');
const WebSocket = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const SESSION_COUNT = 69;
const SELECTED_INDEX = SESSION_COUNT - 1;
const WORKING_COUNTS = [1, 5, 20];
const MAX_BROWSER_BYTES_PER_MINUTE = 300 * 1024;
const APPEND_CONTENT_BYTES = 1024;
const APPEND_MAX_SERIALIZED_BYTES = (APPEND_CONTENT_BYTES * 4) + (4 * 1024);
const REQUIRED_STEADY_STATE_MS = 60_000;
const STREAM_TICK_MS = 1_000;
const STATUS_CHURN_TICK_COUNT = 15;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-p0-fixed-shape-relay-'));
const RELAY_LOGS = [];

function parseArgs(argv) {
  const options = { output: '', durationMs: REQUIRED_STEADY_STATE_MS };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--duration-ms' && argv[index + 1]) {
      options.durationMs = Number(argv[++index]);
      if (!Number.isInteger(options.durationMs) || options.durationMs < 1_000) {
        throw new Error('--duration-ms must be an integer >= 1000');
      }
    }
    else if (argv[index] === '--read-only') continue;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return options;
}

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

function openSocket(port, origin, route, peerRole, clientName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const sent = [];
    const originalSend = ws.send.bind(ws);
    ws.send = data => {
      sent.push({ data: String(data), bytes: Buffer.byteLength(String(data)), at_ms: Date.now() });
      return originalSend(data);
    };
    const timer = setTimeout(() => reject(new Error(`${peerRole} connection timeout`)), 8000);
    ws.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      messages.push({ message, bytes: Buffer.byteLength(data), received_at_ms: Date.now() });
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: peerRole,
        ...(peerRole === 'proxy'
          ? { proxy_id: clientName, machine_label: 'p0-fixed-shape-relay-benchmark' }
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
      resolve({ ws, messages, sent });
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

function summarizeWire(entries) {
  const framesByType = {};
  const bytesByType = {};
  let bytes = 0;
  for (const entry of entries) {
    const type = String(entry.message?.type || 'unknown');
    bytes += entry.bytes;
    framesByType[type] = (framesByType[type] || 0) + 1;
    bytesByType[type] = (bytesByType[type] || 0) + entry.bytes;
  }
  return {
    frame_count: entries.length,
    bytes,
    frames_by_type: framesByType,
    bytes_by_type: bytesByType,
  };
}

function summarizeSentWire(entries) {
  return summarizeWire(entries.map(entry => {
    let message = {};
    try { message = JSON.parse(entry.data); } catch { message = { type: 'invalid_json' }; }
    return { message, bytes: entry.bytes };
  }));
}

function sessionId(index) {
  return `p0-fixed-shape-session-${String(index).padStart(3, '0')}`;
}

function frameSession(message) {
  return message?.session_id || message?.session || '';
}

function fullTranscriptFrame(message) {
  return new Set([
    'message', 'proxy_message', 'message_delta', 'status', 'proxy_status',
    'history', 'history_chunk', 'history_snapshot', 'history_delta',
  ]).has(message?.type);
}

function inventoryFrame(message) {
  return ['session_list', 'session_snapshot', 'proxy_session_snapshot'].includes(message?.type);
}

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const relay = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'p0-fixed-shape-session-secret-0123456789',
      JWT_SECRET: 'p0-fixed-shape-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: DATA_DIR,
      GOOGLE_CLIENT_ID: 'p0-fixed-shape-client',
      GOOGLE_CLIENT_SECRET: 'p0-fixed-shape-client-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => RELAY_LOGS.push(String(chunk)));
  relay.stderr.on('data', chunk => RELAY_LOGS.push(String(chunk)));
  let proxy;
  let selectedBrowser;
  let emptyBrowser;
  let database;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(RELAY_LOGS.join('').slice(-4000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');
    proxy = await openSocket(port, origin, '/proxy-ws', 'proxy', 'p0-fixed-shape-proxy');
    selectedBrowser = await openSocket(port, origin, '/client-ws', 'browser', 'p0-fixed-shape-selected');
    emptyBrowser = await openSocket(port, origin, '/client-ws', 'browser', 'p0-fixed-shape-empty');

    const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
      session_id: sessionId(index),
      agent_type: index % 3 === 0 ? 'codex_cli' : index % 3 === 1 ? 'claude_cli' : 'cursor_cli',
      display_name: `P0 fixed-shape session ${index}`,
      workspace_path: ROOT,
      status: 'healthy',
      activity: { kind: 'idle', label: '' },
    }));
    sendJson(proxy.ws, {
      type: 'proxy_session_snapshot',
      proxy_id: 'p0-fixed-shape-proxy',
      sessions,
    });
    for (const browser of [selectedBrowser, emptyBrowser]) {
      await waitFor(
        () => browser.messages.some(entry => Array.isArray(entry.message.sessions)
          && entry.message.sessions.length === SESSION_COUNT),
        5000,
        `${browser === selectedBrowser ? 'selected' : 'empty'} 69-session inventory`,
      );
    }

    const selectedSession = sessionId(SELECTED_INDEX);
    sendJson(selectedBrowser.ws, {
      type: 'subscribe', request_id: 'p0-fixed-selected-subscription', sessions: [selectedSession],
    });
    sendJson(emptyBrowser.ws, {
      type: 'subscribe', request_id: 'p0-fixed-empty-subscription', sessions: [],
    });
    await waitFor(() => selectedBrowser.messages.some(entry => (
      entry.message.type === 'subscription_ack'
      && entry.message.request_id === 'p0-fixed-selected-subscription'
    )), 5000, 'selected subscription ack');
    await waitFor(() => emptyBrowser.messages.some(entry => (
      entry.message.type === 'subscription_ack'
      && entry.message.request_id === 'p0-fixed-empty-subscription'
    )), 5000, 'empty subscription ack');

    sendJson(selectedBrowser.ws, {
      type: 'subscribe', request_id: 'p0-fixed-overflow',
      sessions: Array.from({ length: 129 }, (_, index) => `overflow-${index}`),
    });
    await waitFor(() => selectedBrowser.messages.some(entry => (
      entry.message.type === 'connection_error'
      && entry.message.request_id === 'p0-fixed-overflow'
      && entry.message.code === 'invalid_subscription'
    )), 5000, 'overflow rejection');

    const databasePath = path.join(DATA_DIR, 'messages.db');
    await waitFor(() => fs.existsSync(databasePath), 5000, 'relay SQLite database');
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const scenarios = [];

    for (const workingCount of WORKING_COUNTS) {
      const setupMarker = `P0_SETUP_${workingCount}`;
      for (let index = 0; index < SESSION_COUNT; index += 1) {
        sendJson(proxy.ws, {
          type: 'status',
          session: sessionId(index),
          activity: index < workingCount
            ? { kind: 'working', label: index === workingCount - 1 ? setupMarker : 'Working' }
            : { kind: 'idle', label: index === SESSION_COUNT - 1 ? setupMarker : '' },
        });
      }
      await waitFor(() => selectedBrowser.messages.some(entry => (
        ['session_summary', 'session_patch', 'status'].includes(entry.message.type)
        && (entry.message.activity?.label === setupMarker
          || entry.message.patch?.activity?.label === setupMarker
          || entry.message.label === setupMarker)
      )), 10_000, `${workingCount}-working setup marker`);
      await sleep(100);

      const selectedStart = selectedBrowser.messages.length;
      const emptyStart = emptyBrowser.messages.length;
      const selectedRequestStart = selectedBrowser.sent.length;
      const emptyRequestStart = emptyBrowser.sent.length;
      const proxyStart = proxy.sent.length;
      const databaseCountBefore = database.prepare('SELECT COUNT(*) count FROM messages WHERE session = ?')
        .get(selectedSession).count;
      const databaseStatBefore = fs.statSync(databasePath);
      const appendContent = 'x'.repeat(APPEND_CONTENT_BYTES);
      const appendSourceId = `p0-fixed-shape:${workingCount}:append`;
      const appendSentAtMs = Date.now();
      sendJson(proxy.ws, {
        type: 'proxy_message',
        session_id: selectedSession,
        role: 'assistant',
        content: appendContent,
        source_message_id: appendSourceId,
        source: 'p0_fixed_shape_fixture',
      });
      const selectedAppend = await waitFor(() => selectedBrowser.messages.slice(selectedStart).find(entry => (
        entry.message.type === 'message'
        && frameSession(entry.message) === selectedSession
        && entry.message.content === appendContent
      )), 10_000, `${workingCount}-working selected append`);
      await waitFor(() => database.prepare('SELECT COUNT(*) count FROM messages WHERE session = ?')
        .get(selectedSession).count === databaseCountBefore + 1, 10_000, `${workingCount}-working SQLite append`);
      const databaseStatAfter = fs.statSync(databasePath);

      const streamSession = sessionId(0);
      const streamMessageId = `working-${workingCount}-long-stream`;
      const streamSourceId = `p0-fixed-shape:${workingCount}:long-stream`;
      const streamDatabaseCountBefore = database.prepare('SELECT COUNT(*) count FROM messages WHERE session = ?')
        .get(streamSession).count;
      sendJson(proxy.ws, {
        type: 'message_delta', session_id: streamSession, message_id: streamMessageId,
        role: 'assistant', block_index: 0, block_type: 'text', seq: 0, op: 'block_open',
      });
      const steadyStateStartedAtMs = Date.now();
      const streamChunks = [];
      let streamTickCount = 0;
      let statusChurnEvents = 0;
      while (Date.now() - steadyStateStartedAtMs < options.durationMs) {
        const targetAt = steadyStateStartedAtMs + (streamTickCount * STREAM_TICK_MS);
        if (Date.now() < targetAt) await sleep(targetAt - Date.now());
        if (Date.now() - steadyStateStartedAtMs >= options.durationMs) break;
        streamTickCount += 1;
        const streamChunk = `stream-${String(streamTickCount).padStart(4, '0')}-observability-`.padEnd(64, 's');
        streamChunks.push(streamChunk);
        sendJson(proxy.ws, {
          type: 'message_delta', session_id: streamSession, message_id: streamMessageId,
          role: 'assistant', block_index: 0, block_type: 'text', seq: streamTickCount,
          op: 'append', append: streamChunk,
        });
        if (streamTickCount === 1 || streamTickCount % STATUS_CHURN_TICK_COUNT === 0) {
          for (let index = 0; index < workingCount; index += 1) {
            sendJson(proxy.ws, {
              type: 'status', session: sessionId(index),
              activity: {
                kind: 'working',
                label: `Working phase ${Math.floor(streamTickCount / STATUS_CHURN_TICK_COUNT) % 2}`,
              },
            });
            statusChurnEvents += 1;
          }
        }
      }
      const remainingSteadyStateMs = options.durationMs - (Date.now() - steadyStateStartedAtMs);
      if (remainingSteadyStateMs > 0) await sleep(remainingSteadyStateMs);
      const steadyStateEndedAtMs = Date.now();
      sendJson(proxy.ws, {
        type: 'message_delta', session_id: streamSession, message_id: streamMessageId,
        role: 'assistant', block_index: 0, block_type: 'text', seq: streamTickCount + 1, op: 'block_close',
      });
      sendJson(proxy.ws, {
        type: 'proxy_message', session_id: streamSession, role: 'assistant',
        content: streamChunks.join(''),
        source_message_id: streamSourceId,
        source: 'p0_fixed_shape_fixture',
      });
      const sentinelSession = sessionId(SESSION_COUNT - 2);
      const sentinel = `P0_SENTINEL_${workingCount}`;
      sendJson(proxy.ws, {
        type: 'status', session: sentinelSession,
        activity: { kind: 'idle', label: sentinel },
      });
      await waitFor(() => database.prepare('SELECT COUNT(*) count FROM messages WHERE session = ?')
        .get(streamSession).count === streamDatabaseCountBefore + 1, 10_000, `${workingCount}-working long stream SQLite settle`);
      const selectedSourceRows = database.prepare(
        'SELECT COUNT(*) count FROM messages WHERE session = ? AND source_message_id = ?',
      ).get(selectedSession, appendSourceId).count;
      const streamSourceRows = database.prepare(
        'SELECT COUNT(*) count FROM messages WHERE session = ? AND source_message_id = ?',
      ).get(streamSession, streamSourceId).count;
      for (const browser of [selectedBrowser, emptyBrowser]) {
        const start = browser === selectedBrowser ? selectedStart : emptyStart;
        await waitFor(() => browser.messages.slice(start).some(entry => (
          frameSession(entry.message) === sentinelSession
          && (entry.message.activity?.label === sentinel
            || entry.message.patch?.activity?.label === sentinel
            || entry.message.label === sentinel)
        )), 15_000, `${workingCount}-working ${browser === selectedBrowser ? 'selected' : 'empty'} sentinel`);
      }
      await sleep(250);

      const selectedSteadyEnd = selectedBrowser.messages.length;
      const emptySteadyEnd = emptyBrowser.messages.length;
      const burstSelectedStart = selectedSteadyEnd;
      const burstEmptyStart = emptySteadyEnd;
      const burstProxyStart = proxy.sent.length;
      for (let index = 0; index < workingCount; index += 1) {
        const id = sessionId(index);
        const messageId = `working-${workingCount}-${index}-burst`;
        sendJson(proxy.ws, {
          type: 'message_delta', session_id: id, message_id: messageId,
          role: 'assistant', block_index: 0, block_type: 'text', seq: 0, op: 'block_open',
        });
        for (let tick = 0; tick < 60; tick += 1) {
          sendJson(proxy.ws, {
            type: 'message_delta', session_id: id, message_id: messageId,
            role: 'assistant', block_index: 0, block_type: 'text', seq: tick + 1,
            op: 'append', append: `burst-${String(tick).padStart(3, '0')}-`.padEnd(64, 'b'),
          });
        }
        sendJson(proxy.ws, {
          type: 'message_delta', session_id: id, message_id: messageId,
          role: 'assistant', block_index: 0, block_type: 'text', seq: 61, op: 'block_close',
        });
      }
      const burstSentinel = `P0_BURST_SENTINEL_${workingCount}`;
      sendJson(proxy.ws, {
        type: 'status', session: sentinelSession,
        activity: { kind: 'idle', label: burstSentinel },
      });
      for (const browser of [selectedBrowser, emptyBrowser]) {
        const start = browser === selectedBrowser ? burstSelectedStart : burstEmptyStart;
        await waitFor(() => browser.messages.slice(start).some(entry => (
          frameSession(entry.message) === sentinelSession
          && (entry.message.activity?.label === burstSentinel
            || entry.message.patch?.activity?.label === burstSentinel
            || entry.message.label === burstSentinel)
        )), 15_000, `${workingCount}-working burst sentinel`);
      }
      await sleep(250);

      const selectedEntries = selectedBrowser.messages.slice(selectedStart, selectedSteadyEnd);
      const emptyEntries = emptyBrowser.messages.slice(emptyStart, emptySteadyEnd);
      const burstSelectedEntries = selectedBrowser.messages.slice(burstSelectedStart);
      const burstEmptyEntries = emptyBrowser.messages.slice(burstEmptyStart);
      const selectedWire = summarizeWire(selectedEntries);
      const emptyWire = summarizeWire(emptyEntries);
      const proxyWire = summarizeSentWire(proxy.sent.slice(proxyStart));
      const burstProxyWire = summarizeSentWire(proxy.sent.slice(burstProxyStart));
      const burstSelectedWire = summarizeWire(burstSelectedEntries);
      const burstEmptyWire = summarizeWire(burstEmptyEntries);
      const selectedRequests = summarizeSentWire(selectedBrowser.sent.slice(selectedRequestStart));
      const emptyRequests = summarizeSentWire(emptyBrowser.sent.slice(emptyRequestStart));
      const selectedFullFrames = selectedEntries.filter(entry => fullTranscriptFrame(entry.message));
      const emptyFullFrames = emptyEntries.filter(entry => fullTranscriptFrame(entry.message));
      const burstSelectedFullFrames = burstSelectedEntries.filter(entry => fullTranscriptFrame(entry.message));
      const burstEmptyFullFrames = burstEmptyEntries.filter(entry => fullTranscriptFrame(entry.message));
      const selectedAppendFrames = selectedEntries.filter(entry => (
        entry.message.type === 'message'
        && frameSession(entry.message) === selectedSession
        && entry.message.content === appendContent
      ));
      const selectedAppendBytes = selectedAppendFrames.reduce((sum, entry) => sum + entry.bytes, 0);
      const leakedBackgroundFullFrames = selectedFullFrames.filter(entry => frameSession(entry.message) !== selectedSession);
      const inventoryFrames = selectedEntries.filter(entry => inventoryFrame(entry.message));
      const historyFrames = selectedEntries.filter(entry => String(entry.message.type || '').startsWith('history'));
      const throttledHistoryFrames = [...selectedEntries, ...emptyEntries].filter(entry => (
        entry.message.type === 'history_throttled'
        || (String(entry.message.type || '').startsWith('history') && entry.message.code === 'rate_limited')
      ));
      const backgroundHistoryRequests = [
        ...selectedBrowser.sent.slice(selectedRequestStart),
        ...emptyBrowser.sent.slice(emptyRequestStart),
      ].filter(entry => {
        try { return String(JSON.parse(entry.data).type || '').includes('history'); } catch { return false; }
      });
      const databaseWalPath = `${databasePath}-wal`;

      const scenario = {
        ok: selectedWire.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && emptyWire.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && burstSelectedWire.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && burstEmptyWire.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && selectedAppendFrames.length === 1
          && selectedAppendBytes <= APPEND_MAX_SERIALIZED_BYTES
          && leakedBackgroundFullFrames.length === 0
          && emptyFullFrames.length === 0
          && inventoryFrames.length === 0
          && historyFrames.length === 0
          && burstSelectedFullFrames.length === 0
          && burstEmptyFullFrames.length === 0
          && throttledHistoryFrames.length === 0
          && backgroundHistoryRequests.length === 0
          && selectedSourceRows === 1
          && streamSourceRows === 1
          && steadyStateEndedAtMs - steadyStateStartedAtMs >= options.durationMs
          && databaseStatAfter.size === databaseStatBefore.size,
        working_sessions: workingCount,
        empty_selected_session: selectedSession,
        steady_state: {
          required_duration_ms: options.durationMs,
          measured_duration_ms: steadyStateEndedAtMs - steadyStateStartedAtMs,
          stream_ticks: streamTickCount,
          status_churn_events: statusChurnEvents,
        },
        proxy_to_relay: proxyWire,
        selected_browser: selectedWire,
        empty_subscription_browser: emptyWire,
        burst_stress: {
          streams: workingCount,
          deltas_per_stream: 62,
          proxy_to_relay: burstProxyWire,
          selected_browser: burstSelectedWire,
          empty_subscription_browser: burstEmptyWire,
          selected_full_transcript_frames: burstSelectedFullFrames.length,
          empty_full_transcript_frames: burstEmptyFullFrames.length,
        },
        browser_to_relay: {
          selected: selectedRequests,
          empty_subscription: emptyRequests,
          background_history_requests: backgroundHistoryRequests.length,
        },
        selected_append: {
          content_bytes: APPEND_CONTENT_BYTES,
          full_frames: selectedAppendFrames.length,
          serialized_bytes: selectedAppendBytes,
          source_to_browser_ms: selectedAppend.received_at_ms - appendSentAtMs,
          sqlite_rows_before: databaseCountBefore,
          sqlite_rows_after: databaseCountBefore + 1,
          exact_source_rows: selectedSourceRows,
          database_size_before: databaseStatBefore.size,
          database_size_after: databaseStatAfter.size,
          base_database_rewritten: databaseStatAfter.size !== databaseStatBefore.size,
          wal_bytes_after: fs.existsSync(databaseWalPath) ? fs.statSync(databaseWalPath).size : 0,
        },
        isolation: {
          selected_background_full_frames: leakedBackgroundFullFrames.length,
          empty_subscription_full_frames: emptyFullFrames.length,
          history_frames: historyFrames.length,
          throttled_history_frames: throttledHistoryFrames.length,
          full_inventory_frames_after_initial_connection: inventoryFrames.length,
        },
        relay_persistence: {
          long_stream_sqlite_rows_before: streamDatabaseCountBefore,
          long_stream_sqlite_rows_after: streamDatabaseCountBefore + 1,
          long_stream_settled_content_bytes: Buffer.byteLength(streamChunks.join('')),
          long_stream_source_message_id: streamSourceId,
          exact_source_rows: streamSourceRows,
          duplicate_semantic_rows: Math.max(0, selectedSourceRows - 1) + Math.max(0, streamSourceRows - 1),
        },
      };
      scenarios.push(scenario);
    }

    const result = {
      ok: scenarios.length === WORKING_COUNTS.length && scenarios.every(scenario => scenario.ok),
      generated_at: new Date().toISOString(),
      evidence_class: options.durationMs >= REQUIRED_STEADY_STATE_MS
        ? 'isolated_fixture'
        : 'isolated_fixture_diagnostic',
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT, encoding: 'utf8', windowsHide: true,
      }).trim(),
      relay_source_sha256: crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'))).digest('hex'),
      fixture: {
        sessions: SESSION_COUNT,
        working_session_scenarios: WORKING_COUNTS,
        selected_sessions: 1,
        selected_session_initially_empty: true,
        required_duration_ms_per_scenario: REQUIRED_STEADY_STATE_MS,
        configured_duration_ms_per_scenario: options.durationMs,
        wall_clock_steady_state: true,
        headless: true,
        visible_windows_opened: 0,
        focus_actions: 0,
        production_mutations: 0,
      },
      budgets: {
        max_browser_bytes_per_minute: MAX_BROWSER_BYTES_PER_MINUTE,
        append_max_serialized_bytes: APPEND_MAX_SERIALIZED_BYTES,
      },
      scenarios,
      acceptance: {
        zero_background_history: scenarios.every(item => item.isolation.history_frames === 0),
        zero_client_originated_background_history_requests: scenarios.every(item => (
          item.browser_to_relay.background_history_requests === 0
        )),
        zero_throttled_history: scenarios.every(item => item.isolation.throttled_history_frames === 0),
        zero_background_full_transcript_leaks: scenarios.every(item => (
          item.isolation.selected_background_full_frames === 0
          && item.isolation.empty_subscription_full_frames === 0
        )),
        zero_unchanged_inventory_replays: scenarios.every(item => (
          item.isolation.full_inventory_frames_after_initial_connection === 0
        )),
        zero_duplicate_semantic_rows: scenarios.every(item => (
          item.relay_persistence.duplicate_semantic_rows === 0
        )),
        browser_bytes_under_300_kib_per_minute: scenarios.every(item => (
          item.selected_browser.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && item.empty_subscription_browser.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && item.burst_stress.selected_browser.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
          && item.burst_stress.empty_subscription_browser.bytes <= MAX_BROWSER_BYTES_PER_MINUTE
        )),
        exactly_one_selected_append: scenarios.every(item => item.selected_append.full_frames === 1),
        append_under_amplification_budget: scenarios.every(item => (
          item.selected_append.serialized_bytes <= APPEND_MAX_SERIALIZED_BYTES
        )),
        sqlite_wal_without_base_rewrite: scenarios.every(item => !item.selected_append.base_database_rewritten),
      },
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assert(result.ok, 'fixed-shape relay benchmark failed');
    return result;
  } finally {
    if (database) database.close();
    await closeSocket(emptyBrowser?.ws).catch(() => {});
    await closeSocket(selectedBrowser?.ws).catch(() => {});
    await closeSocket(proxy?.ws).catch(() => {});
    await stopChild(relay);
    const tempRoot = path.resolve(os.tmpdir()).toLowerCase();
    const resolved = path.resolve(DATA_DIR);
    assert(resolved.toLowerCase().startsWith(`${tempRoot}${path.sep}`));
    assert(path.basename(resolved).startsWith('rac-p0-fixed-shape-relay-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`P0 fixed-shape relay benchmark: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, summarizeWire };
