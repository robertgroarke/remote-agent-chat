#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SESSION = '7ab3cfdb-8350-4edb-87e0-fa6bd72f244f';

function parseArgs(argv) {
  const valueAfter = flag => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
  };
  const output = valueAfter('--output');
  return {
    sessionId: valueAfter('--session-id') || DEFAULT_SESSION,
    output: output ? path.resolve(output) : '',
  };
}

function waitForMessage(ws, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('relay response timed out')), timeoutMs);
    const onMessage = data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (predicate(message)) finish(null, message);
    };
    const onError = error => finish(error);
    function finish(error, value) {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(value);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function request(ws, payload, expectedType) {
  const pending = waitForMessage(ws, message => (
    message.type === expectedType && message.request_id === payload.request_id
  ));
  ws.send(JSON.stringify(payload));
  return pending;
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT_SECRET + ALLOWED_EMAIL are required');
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  assert(base, 'relay base URL is required');
  const wsUrl = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    + '/client-ws?token=' + encodeURIComponent(token);
  const ws = new WebSocket(wsUrl);
  try {
    await waitForMessage(ws, message => message.type === 'connection_ack');
    const tailRequest = {
      type: 'history_chunk_request',
      protocol_version: 1,
      session_id: options.sessionId,
      request_id: `pagination-tail-${Date.now()}`,
      mode: 'tail',
      source: 'relay_sqlite',
      limit: 120,
      replace: true,
    };
    const tail = await request(ws, tailRequest, 'history_chunk');
    assert.equal(tail.error, undefined, JSON.stringify(tail.error));
    assert.equal(tail.mode, 'tail');
    assert.equal(tail.partial, true, 'real production session must expose older rows');
    assert(Array.isArray(tail.messages) && tail.messages.length === 120, 'tail must be bounded to 120 messages');
    assert(tail.cursor?.next_before_id, 'tail must return an older-row cursor');

    const olderRequest = {
      ...tailRequest,
      request_id: `pagination-older-${Date.now()}`,
      mode: 'older',
      replace: false,
      user_initiated: true,
      before_id: tail.cursor.next_before_id,
    };
    const older = await request(ws, olderRequest, 'history_chunk');
    assert.equal(older.error, undefined, JSON.stringify(older.error));
    assert.equal(older.mode, 'older');
    assert(Array.isArray(older.messages) && older.messages.length === 120, 'older page must remain bounded');
    const tailIds = new Set(tail.messages.map(message => message.id));
    assert(older.messages.every(message => !tailIds.has(message.id)), 'older page must not overlap the visible tail');
    assert(older.messages.every(message => Number(message.id) < Number(tail.messages[0].id)), 'older page must precede the tail');

    const maxSequence = Math.max(...tail.messages.map(message => Number(message.sequence) || 0));
    assert(maxSequence > 5, 'tail must expose monotonic relay sequences');
    const afterSequence = maxSequence - 5;
    const deltaRequest = {
      type: 'history_request',
      protocol_version: 1,
      session_id: options.sessionId,
      request_id: `pagination-delta-${Date.now()}`,
      after_sequence: afterSequence,
    };
    const delta = await request(ws, deltaRequest, 'history_delta');
    assert(Array.isArray(delta.messages), 'delta response must contain messages');
    assert(delta.messages.length > 0 && delta.messages.length <= 5, 'delta must return only the missing suffix');
    assert(delta.messages.every(message => Number(message.sequence) > afterSequence), 'delta must contain only newer sequences');
    assert.equal(Number(delta.last_sequence), maxSequence, 'delta must report the current last sequence');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: options.sessionId,
      initial_tail: {
        loaded_messages: tail.messages.length,
        total_messages: tail.total_messages,
        partial: tail.partial,
        next_before_id: tail.cursor.next_before_id,
      },
      older_backfill: {
        loaded_messages: older.messages.length,
        partial: older.partial,
        no_overlap: true,
        chronological_prepend: true,
      },
      reconnect_delta: {
        after_sequence: afterSequence,
        returned_messages: delta.messages.length,
        last_sequence: delta.last_sequence,
        full_tail_replayed: false,
      },
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
    }
    process.stdout.write(serialized);
    return result;
  } finally {
    await closeWebSocket(ws);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`History pagination production E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
