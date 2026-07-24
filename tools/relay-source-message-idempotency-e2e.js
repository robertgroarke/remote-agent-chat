#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const Database = require('../relay-server/node_modules/better-sqlite3');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-source-idempotency-'));
const port = 37100 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const sessionId = 'source-idempotency-session';
const replaceSessionId = 'source-authoritative-replace-session';
const releasedAliasSessionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const releasedCanonicalSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const releasedNativeId = '11111111-2222-4333-8444-555555555555';
const logs = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function startRelay() {
  const child = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'source-idempotency-session-secret-0123456789',
      JWT_SECRET: 'source-idempotency-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'source-idempotency-client',
      GOOGLE_CLIENT_SECRET: 'source-idempotency-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

function openSocket(route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    const timeout = setTimeout(() => reject(new Error(`${peerRole} connection timeout`)), 8000);
    ws.on('message', data => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'source-idempotency-e2e' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(() => messages.some(message => message.type === 'connection_ack'), 8000, `${peerRole} ack`)
      .then(() => {
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

function sourceFrame(sourceMessageId, messageIndex) {
  const createdAt = '2026-07-13T17:00:02.375Z';
  const sourceCursor = { generation: 'fixture-generation', message_index: messageIndex, end_offset: 460, file_size: 460 };
  return {
    type: 'proxy_message',
    protocol_version: 1,
    session_id: sessionId,
    session: sessionId,
    role: 'assistant',
    content: 'same semantic content may be a distinct native row',
    source_message_id: sourceMessageId,
    source_cursor: sourceCursor,
    source: 'codex_cli_jsonl',
    message: {
      role: 'assistant',
      content: 'same semantic content may be a distinct native row',
      created_at: createdAt,
      source_message_id: sourceMessageId,
      source_cursor: sourceCursor,
      source: 'codex_cli_jsonl',
    },
  };
}

async function connectPair(run) {
  await waitFor(async () => {
    if (run.exitCode != null) throw new Error(logs.join('').slice(-5000));
    try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
  }, 15_000, 'relay health');
  const proxy = await openSocket('/proxy-ws', 'proxy', `source-idempotency-proxy-${Date.now()}`);
  const browser = await openSocket('/client-ws', 'browser', `source-idempotency-browser-${Date.now()}`);
  browser.ws.send(JSON.stringify({
    type: 'subscribe',
    request_id: `subscribe-${Date.now()}`,
    sessions: [
      sessionId,
      replaceSessionId,
      releasedAliasSessionId,
      releasedCanonicalSessionId,
    ],
  }));
  await waitFor(() => browser.messages.some(message => message.type === 'subscription_ack'), 5000, 'subscription ack');
  return { proxy, browser };
}

async function main() {
  let relay = startRelay();
  let pair = null;
  let observer = null;
  try {
    pair = await connectPair(relay);
    observer = await openSocket('/client-ws', 'browser', `source-idempotency-observer-${Date.now()}`);
    observer.ws.send(JSON.stringify({
      type: 'subscribe',
      request_id: `observer-subscribe-${Date.now()}`,
      sessions: [sessionId],
    }));
    await waitFor(() => observer.messages.some(message => message.type === 'subscription_ack'), 5000, 'observer subscription ack');
    pair.proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      protocol_version: 1,
      proxy_id: 'source-idempotency-proxy',
      sessions: [
        { session_id: sessionId, agent_type: 'codex_cli' },
        { session_id: replaceSessionId, agent_type: 'codex_cli' },
        { session_id: releasedAliasSessionId, agent_type: 'codex_cli' },
        { session_id: releasedCanonicalSessionId, agent_type: 'codex-desktop' },
      ],
    }));
    await sleep(100);
    const first = sourceFrame('codex_cli:stable:first', 0);
    const second = sourceFrame('codex_cli:stable:second', 1);
    pair.proxy.ws.send(JSON.stringify(first));
    pair.proxy.ws.send(JSON.stringify(first));
    pair.proxy.ws.send(JSON.stringify(second));
    await waitFor(
      () => pair.browser.messages.filter(message => message.type === 'message' && message.session === sessionId).length === 2,
      5000,
      'two distinct source rows',
    );
    await sleep(100);
    const firstRunRows = pair.browser.messages.filter(message => message.type === 'message' && message.session === sessionId);
    assert.deepStrictEqual(firstRunRows.map(message => message.source_message_id), [
      'codex_cli:stable:first',
      'codex_cli:stable:second',
    ], 'same source id must dedupe while distinct stable ids preserve identical content rows');
    assert(firstRunRows.every(message => message.source_cursor?.end_offset === 460));
    assert(firstRunRows.every(message => message.ts === 1783962002.375));
    assert(firstRunRows.every(message => message.created_at === '2026-07-13T17:00:02.375Z'));

    const correctedTimestamp = 1783962002.625;
    const correctedCursor = { generation: 'fixture-generation', message_index: 1, end_offset: 480, file_size: 480 };
    const correctedRows = ['first', 'second'].map((suffix, index) => ({
      role: 'assistant',
      content: 'same semantic content may be a distinct native row',
      ts: correctedTimestamp,
      source_message_id: `codex_cli:corrected:${suffix}`,
      source_cursor: { ...correctedCursor, message_index: index },
      source: 'codex_cli_jsonl',
    }));
    const reconcileRequestId = `reconcile-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_chunk_request',
      protocol_version: 1,
      session: sessionId,
      session_id: sessionId,
      request_id: reconcileRequestId,
      source: 'native',
      mode: 'older',
      before_offset: 480,
      limit: 2,
      user_initiated: true,
      reconcile_metadata: true,
    }));
    let forwardedReconcileRequest;
    try {
      forwardedReconcileRequest = await waitFor(
        () => pair.proxy.messages.find(message => message.type === 'history_chunk_request'
          && message.session_id === sessionId && message.reconcile_metadata === true),
        5000,
        'metadata reconciliation native request',
      );
    } catch (error) {
      throw new Error(`${error.message}; proxy=${JSON.stringify(pair.proxy.messages.slice(-8).map(message => ({
        type: message.type,
        session: message.session_id || message.session || null,
        request_id: message.request_id || null,
        error: message.error?.code || message.code || null,
      })))}; browser=${JSON.stringify(pair.browser.messages.slice(-8).map(message => ({
        type: message.type,
        session: message.session_id || message.session || null,
        request_id: message.request_id || null,
        error: message.error?.code || message.code || null,
      })))}; relay=${logs.join('').slice(-3000)}`);
    }
    const observerStart = observer.messages.length;
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_chunk',
      protocol_version: 1,
      session: sessionId,
      session_id: sessionId,
      request_id: forwardedReconcileRequest.request_id,
      source: 'codex_cli_jsonl',
      mode: 'older',
      messages: correctedRows,
    }));
    const reconciliation = await waitFor(
      () => pair.browser.messages.find(message => message.type === 'history_chunk'
        && message.request_id === reconcileRequestId),
      5000,
      'metadata reconciliation response',
    );
    assert.deepStrictEqual(reconciliation.metadata_reconciliation, {
      applied: true,
      code: 'metadata_reconciled',
      rows: 2,
    });
    await waitFor(
      () => observer.messages.slice(observerStart).some(message => message.type === 'transcript_resync_required'
        && message.session === sessionId && message.reason === 'authoritative_metadata_reconciliation'),
      5000,
      'observer metadata reconciliation gap',
    );
    assert.strictEqual(
      observer.messages.slice(observerStart).filter(message => message.type === 'history_chunk'
        && message.request_id === reconcileRequestId).length,
      0,
      'request-scoped native history must not fan out to another subscriber',
    );

    // A schema migration is an explicit full replacement. Keep the last 60
    // identities unchanged while changing the first 60 so the relay's normal
    // 50-row tail optimization would incorrectly report a match without the
    // replace_all contract.
    const originalCanonicalRows = Array.from({ length: 120 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `canonical row ${index}`,
      source_message_id: `canonical-v1:${index}`,
      source: 'codex_cli_jsonl',
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: replaceSessionId,
      session_id: replaceSessionId,
      messages: originalCanonicalRows,
    }));
    await sleep(150);
    const replacementCanonicalRows = originalCanonicalRows.map((row, index) => ({
      ...row,
      source_message_id: index < 60 ? `canonical-v2:${index}` : row.source_message_id,
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: replaceSessionId,
      session_id: replaceSessionId,
      messages: replacementCanonicalRows,
      replace_all: true,
    }));
    await sleep(150);
    const replaceRequestId = `replace-history-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: replaceSessionId,
      session_id: replaceSessionId,
      request_id: replaceRequestId,
      full: true,
    }));
    const replacedHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === replaceRequestId
      )),
      5000,
      'replace_all authoritative history',
    );
    assert.deepStrictEqual(
      replacedHistory.messages.map(message => message.source_message_id),
      replacementCanonicalRows.map(message => message.source_message_id),
      'replace_all must not trust a matching 50-row tail when earlier canonical identities changed',
    );

    const aliasReconcileEvent = {
      type: 'session_alias_reconciled',
      protocol_version: 1,
      alias_session_id: releasedAliasSessionId,
      canonical_session_id: releasedCanonicalSessionId,
      canonical_conversation_id: `codex:${releasedNativeId}`,
      canonical_native_id: releasedNativeId,
      current_surface: 'codex_desktop',
      suppression_reason: 'shared_archive_without_current_cli_owner',
      owner_evidence: { observed_at: '2026-07-23T12:00:00.000Z' },
    };
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedCanonicalSessionId,
      session_id: releasedCanonicalSessionId,
      messages: [{
        role: 'assistant',
        content: 'desktop retained row',
        source_message_id: 'codex-desktop:retained',
      }],
      replace_all: true,
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      messages: [{
        role: 'assistant',
        content: 'archive-only CLI row',
        source_message_id: 'codex_cli:archive-only',
        source: 'codex_cli_jsonl',
      }],
      replace_all: true,
    }));
    pair.proxy.ws.send(JSON.stringify(aliasReconcileEvent));
    await waitFor(
      () => pair.browser.messages.some(message => (
        message.type === 'session_alias_reconciled'
        && message.alias_session_id === releasedAliasSessionId
      )),
      5000,
      'cross-surface alias reconciliation',
    );
    pair.proxy.ws.send(JSON.stringify({
      type: 'session_alias_released',
      protocol_version: 1,
      alias_session_id: releasedAliasSessionId,
      prior_canonical_session_id: releasedCanonicalSessionId,
      canonical_conversation_id: `codex:${releasedNativeId}`,
      canonical_native_id: releasedNativeId,
      current_surface: 'codex_cli',
      release_reason: 'verified_cli_owner_restored',
      owner_evidence: {
        verified: false,
        observed_at: '2026-07-23T12:00:01.000Z',
      },
    }));
    await sleep(100);
    assert.strictEqual(
      pair.browser.messages.filter(message => (
        message.type === 'session_alias_released'
        && message.alias_session_id === releasedAliasSessionId
      )).length,
      0,
      'an unverified release must fail closed',
    );
    const aliasReleaseEvent = {
      type: 'session_alias_released',
      protocol_version: 1,
      alias_session_id: releasedAliasSessionId,
      prior_canonical_session_id: releasedCanonicalSessionId,
      canonical_conversation_id: `codex:${releasedNativeId}`,
      canonical_native_id: releasedNativeId,
      current_surface: 'codex_cli',
      release_reason: 'verified_cli_owner_restored',
      owner_evidence: {
        verified: true,
        observed_at: '2026-07-23T12:00:02.000Z',
      },
    };
    pair.proxy.ws.send(JSON.stringify(aliasReleaseEvent));
    await waitFor(
      () => pair.browser.messages.some(message => (
        message.type === 'session_alias_released'
        && message.alias_session_id === releasedAliasSessionId
      )),
      5000,
      'verified cross-surface alias release',
    );
    const restoredAliasRows = Array.from({ length: 3 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `restored CLI row ${index}`,
      source_message_id: `codex_cli:restored:${index}`,
      source: 'codex_cli_jsonl',
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      messages: restoredAliasRows,
      replace_all: true,
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedCanonicalSessionId,
      session_id: releasedCanonicalSessionId,
      messages: [],
      replace_all: true,
    }));
    await sleep(150);
    const restoredAliasRequestId = `released-alias-${Date.now()}`;
    const clearedCanonicalRequestId = `released-canonical-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      request_id: restoredAliasRequestId,
      full: true,
    }));
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: releasedCanonicalSessionId,
      session_id: releasedCanonicalSessionId,
      request_id: clearedCanonicalRequestId,
      full: true,
    }));
    const restoredAliasHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === restoredAliasRequestId
      )),
      5000,
      'released alias history',
    );
    const clearedCanonicalHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === clearedCanonicalRequestId
      )),
      5000,
      'cleared prior canonical history',
    );
    assert.deepStrictEqual(
      restoredAliasHistory.messages.map(message => message.source_message_id),
      restoredAliasRows.map(message => message.source_message_id),
      'verified owner release must restore an independent CLI transcript key',
    );
    assert.deepStrictEqual(clearedCanonicalHistory.messages, [],
      'the Desktop canonical key must accept its independent authoritative clear');

    pair.proxy.ws.send(JSON.stringify(aliasReconcileEvent));
    await sleep(100);
    const postTombstoneRows = [...restoredAliasRows, {
      role: 'assistant',
      content: 'row after stale alias replay',
      source_message_id: 'codex_cli:restored:3',
      source: 'codex_cli_jsonl',
    }];
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      messages: postTombstoneRows,
      replace_all: true,
    }));
    await sleep(150);
    const tombstoneRequestId = `release-tombstone-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      request_id: tombstoneRequestId,
      full: true,
    }));
    const tombstoneHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === tombstoneRequestId
      )),
      5000,
      'release tombstone history',
    );
    assert.deepStrictEqual(
      tombstoneHistory.messages.map(message => message.source_message_id),
      postTombstoneRows.map(message => message.source_message_id),
      'a stale alias replay must not resurrect cross-surface canonicalization',
    );

    await closeSocket(observer.ws);
    observer = null;
    await closeSocket(pair.browser.ws);
    await closeSocket(pair.proxy.ws);
    pair = null;
    await stopChild(relay);

    relay = startRelay();
    pair = await connectPair(relay);
    pair.proxy.ws.send(JSON.stringify(aliasReconcileEvent));
    await sleep(100);
    const postRestartAliasRows = [...postTombstoneRows, {
      role: 'assistant',
      content: 'row after relay restart',
      source_message_id: 'codex_cli:restored:4',
      source: 'codex_cli_jsonl',
    }];
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      messages: postRestartAliasRows,
      replace_all: true,
    }));
    pair.proxy.ws.send(JSON.stringify({
      type: 'history_snapshot',
      protocol_version: 1,
      session: releasedCanonicalSessionId,
      session_id: releasedCanonicalSessionId,
      messages: [],
      replace_all: true,
    }));
    await sleep(150);
    const postRestartAliasRequestId = `release-restart-alias-${Date.now()}`;
    const postRestartCanonicalRequestId = `release-restart-canonical-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: releasedAliasSessionId,
      session_id: releasedAliasSessionId,
      request_id: postRestartAliasRequestId,
      full: true,
    }));
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: releasedCanonicalSessionId,
      session_id: releasedCanonicalSessionId,
      request_id: postRestartCanonicalRequestId,
      full: true,
    }));
    const postRestartAliasHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === postRestartAliasRequestId
      )),
      5000,
      'release tombstone after relay restart',
    );
    const postRestartCanonicalHistory = await waitFor(
      () => pair.browser.messages.find(message => (
        message.type === 'history' && message.request_id === postRestartCanonicalRequestId
      )),
      5000,
      'canonical history after relay restart',
    );
    assert.deepStrictEqual(
      postRestartAliasHistory.messages.map(message => message.source_message_id),
      postRestartAliasRows.map(message => message.source_message_id),
      'the release tombstone must survive relay restart and reject stale re-aliasing',
    );
    assert.deepStrictEqual(postRestartCanonicalHistory.messages, []);

    const historyRequestId = `history-${Date.now()}`;
    pair.browser.ws.send(JSON.stringify({
      type: 'history_request',
      session: sessionId,
      session_id: sessionId,
      request_id: historyRequestId,
      full: true,
    }));
    const replayHistory = await waitFor(
      () => pair.browser.messages.find(message => message.type === 'history' && message.request_id === historyRequestId),
      5000,
      'persisted source cursor history replay',
    );
    assert.strictEqual(replayHistory.messages.length, 2);
    assert.deepStrictEqual(replayHistory.messages.map(message => message.source_message_id), [
      'codex_cli:corrected:first',
      'codex_cli:corrected:second',
    ], 'authoritative history must reconcile stale source identities even when semantic content is unchanged');
    assert(replayHistory.messages.every(message => message.source_cursor?.end_offset === 460),
      'persisted source cursor must hydrate back to an object');
    const replayStart = pair.browser.messages.length;
    pair.proxy.ws.send(JSON.stringify({ ...first, source_message_id: 'codex_cli:corrected:first', message: {
      ...first.message,
      source_message_id: 'codex_cli:corrected:first',
      created_at: '2026-07-13T17:00:02.625Z',
    } }));
    await sleep(250);
    const replayRows = pair.browser.messages.slice(replayStart)
      .filter(message => message.type === 'message' && message.session === sessionId);
    assert.strictEqual(replayRows.length, 0, 'source id replay after relay restart must not fan out again');

    await closeSocket(pair.browser.ws);
    await closeSocket(pair.proxy.ws);
    pair = null;
    await stopChild(relay);

    const db = new Database(path.join(dataDir, 'messages.db'), { readonly: true });
    const rows = db.prepare(`
      SELECT role, content, ts, source_message_id, source_cursor, source
      FROM messages WHERE session = ? ORDER BY id ASC
    `).all(sessionId);
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_source_message'").get();
    db.close();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(new Set(rows.map(row => row.source_message_id)).size, 2);
    assert(rows.every(row => JSON.parse(row.source_cursor).end_offset === 460));
    assert(rows.every(row => row.source === 'codex_cli_jsonl'));
    assert(rows.every(row => row.ts === correctedTimestamp), 'fractional producer created_at must survive metadata reconciliation');
    assert(index?.sql?.includes('UNIQUE INDEX'));

    console.log(JSON.stringify({
      ok: true,
      persisted_rows: rows.length,
      first_run_browser_rows: 2,
      duplicate_same_run_rows: 0,
      duplicate_after_restart_rows: 0,
      identical_content_distinct_source_rows: 2,
      source_cursor_end_offset: 460,
      source_timestamp: rows[0].ts,
      unique_index: 'idx_source_message',
      history_replay_source_cursor_object: true,
      replace_all_rows: 120,
      replace_all_early_identity_changes: 60,
      verified_owner_alias_release_rows: 5,
      stale_alias_replay_resurrections: 0,
      release_tombstone_survived_relay_restart: true,
      windows_opened: 0,
    }, null, 2));
  } finally {
    if (observer) await closeSocket(observer.ws);
    if (pair) {
      await closeSocket(pair.browser?.ws);
      await closeSocket(pair.proxy?.ws);
    }
    await stopChild(relay);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
