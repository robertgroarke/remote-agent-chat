#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const { CANONICAL_BLOCK_TYPES } = require('../android-app/lib/content-blocks');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const HARNESS_TYPES = [
  'claude',
  'codex',
  'antigravity_panel',
  'codex-desktop',
  'antigravity-v2',
  'cursor',
  'claude_cli',
  'codex_cli',
  'cursor_cli',
  'gemini',
  'continue',
  'roo_code',
];
const HISTORY_LIMIT = 200;
const INVENTORY_SETTLE_MS = 1000;
const STORE_BACKED_TYPES = new Set(['claude_cli', 'codex_cli', 'cursor_cli']);

function parseArgs(argv) {
  const options = { readOnly: false, resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.readOnly) throw new Error('Production block inventory is read-only; pass --read-only explicitly');
  return options;
}

function relayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = url => token
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const value = predicate();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}

function sessionId(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

async function openRelay() {
  const events = [];
  let sessions = [];
  const ws = new WebSocket(relayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    events.push(message);
    if (Array.isArray(message.sessions)) sessions = message.sessions;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay connection timed out')), 30_000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'production-block-inventory',
      }));
      resolve();
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await waitFor(() => sessions.length > 0, 30_000, 'production session inventory');
  await new Promise(resolve => setTimeout(resolve, INVENTORY_SETTLE_MS));
  return { ws, events, sessions: () => sessions };
}

async function historyTail(relay, id) {
  const requestId = `block-inventory-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  relay.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session_id: id,
    session: id,
    request_id: requestId,
    mode: 'tail',
    source: 'relay_sqlite',
    replace: true,
    limit: HISTORY_LIMIT,
  }));
  return waitFor(
    () => relay.events.find(event => event.type === 'history_chunk' && event.request_id === requestId),
    30_000,
    `history tail ${id}`,
  );
}

function candidateSessions(sessions, type) {
  return (sessions || [])
    .filter(session => session && typeof session === 'object'
      && session.agent_type === type && !session.is_list_view)
    .sort((left, right) => {
      const leftConnected = left.status === 'disconnected' ? 0 : 1;
      const rightConnected = right.status === 'disconnected' ? 0 : 1;
      if (leftConnected !== rightConnected) return rightConnected - leftConnected;
      const createdOrder = String(right.created_at || '').localeCompare(String(left.created_at || ''));
      if (createdOrder !== 0) return createdOrder;
      return String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || ''));
    });
}

function pickSession(sessions, type) {
  return candidateSessions(sessions, type)[0] || null;
}

function summarizeHistory(type, session, history) {
  const messages = Array.isArray(history.messages) ? history.messages : [];
  const blockCounts = Object.fromEntries(CANONICAL_BLOCK_TYPES.map(blockType => [blockType, 0]));
  const unknown = new Set();
  let structuredMessages = 0;
  let plainAssistantMessages = 0;
  let latestAssistant = null;
  let latestPlainAssistantAt = null;
  const timestampIso = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  for (const message of messages) {
    const blocks = Array.isArray(message?.content_blocks) ? message.content_blocks : [];
    if (blocks.length > 0) structuredMessages += 1;
    else if (message?.role === 'assistant' && String(message.content || '').trim()) {
      plainAssistantMessages += 1;
      latestPlainAssistantAt = timestampIso(message.ts) || latestPlainAssistantAt;
    }
    if (message?.role === 'assistant' && String(message.content || '').trim()) {
      latestAssistant = {
        at: timestampIso(message.ts),
        typed: blocks.length > 0,
        block_types: blocks.map(block => String(block?.type || '')).filter(Boolean),
      };
    }
    for (const block of blocks) {
      const blockType = String(block?.type || '');
      if (Object.hasOwn(blockCounts, blockType)) blockCounts[blockType] += 1;
      else if (blockType) unknown.add(blockType);
    }
  }
  const observedTypes = CANONICAL_BLOCK_TYPES.filter(blockType => blockCounts[blockType] > 0);
  return {
    agent_type: type,
    status: session.status || 'unknown',
    session_id: sessionId(session),
    workspace_path: session.workspace_path || null,
    history_messages: history.total_messages ?? messages.length,
    inspected_tail_messages: messages.length,
    structured_messages: structuredMessages,
    plain_assistant_messages: plainAssistantMessages,
    latest_plain_assistant_at: latestPlainAssistantAt,
    latest_assistant: latestAssistant,
    observed_types: observedTypes,
    block_counts: Object.fromEntries(observedTypes.map(blockType => [blockType, blockCounts[blockType]])),
    unknown_types: [...unknown].sort(),
  };
}

function pickHistoryCandidate(type, candidates) {
  return (candidates || []).map((candidate, index) => ({
    ...candidate,
    index,
    summary: summarizeHistory(type, candidate.session, candidate.history),
  })).sort((left, right) => {
    const leftLatest = Date.parse(left.summary.latest_assistant?.at || '') || 0;
    const rightLatest = Date.parse(right.summary.latest_assistant?.at || '') || 0;
    if (leftLatest !== rightLatest) return rightLatest - leftLatest;
    if (left.summary.history_messages !== right.summary.history_messages) {
      return right.summary.history_messages - left.summary.history_messages;
    }
    return left.index - right.index;
  })[0] || null;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const relay = await openRelay();
  const rows = [];
  try {
    for (const type of HARNESS_TYPES) {
      const candidates = candidateSessions(relay.sessions(), type);
      let session = candidates[0] || null;
      if (!session) {
        rows.push({ agent_type: type, status: 'unavailable', session_id: null, observed_types: [], unknown_types: [] });
        continue;
      }
      let history;
      if (STORE_BACKED_TYPES.has(type)) {
        const connected = candidates.filter(candidate => candidate.status !== 'disconnected');
        const pool = (connected.length ? connected : candidates).slice(0, 20);
        const histories = [];
        for (const candidate of pool) {
          histories.push({ session: candidate, history: await historyTail(relay, sessionId(candidate)) });
        }
        const selected = pickHistoryCandidate(type, histories);
        session = selected.session;
        history = selected.history;
      } else {
        history = await historyTail(relay, sessionId(session));
      }
      rows.push(summarizeHistory(type, session, history));
    }
  } finally {
    try { relay.ws.close(); } catch {}
  }
  const unknownTypes = [...new Set(rows.flatMap(row => row.unknown_types || []))].sort();
  assert.deepStrictEqual(unknownTypes, [], `Unknown content block types: ${unknownTypes.join(', ')}`);
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    read_only: true,
    history_source: 'relay_sqlite',
    history_tail_limit: HISTORY_LIMIT,
    canonical_block_types: CANONICAL_BLOCK_TYPES,
    harnesses: rows,
    available_harnesses: rows.filter(row => row.session_id).length,
    unavailable_harnesses: rows.filter(row => !row.session_id).map(row => row.agent_type),
    sends: 0,
    controls: 0,
    visible_windows_opened: 0,
    focus_actions: 0,
  };
  if (options.resultFile) {
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  HARNESS_TYPES, HISTORY_LIMIT, INVENTORY_SETTLE_MS, STORE_BACKED_TYPES,
  candidateSessions, main, parseArgs, pickHistoryCandidate, pickSession, summarizeHistory,
};
