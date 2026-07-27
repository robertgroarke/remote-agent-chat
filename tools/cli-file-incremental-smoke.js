#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');
const proto = require('../agent-proxy/protocol');
const sessionStore = require('../agent-proxy/session-store');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;
if (outputArgIndex >= 0 && !outputPath) {
  throw new Error('--output requires a path');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cli-file-incremental-'));
const line = value => `${JSON.stringify(value)}\n`;
const appendPartial = (filePath, value) => {
  const encoded = JSON.stringify(value);
  const split = Math.floor(encoded.length / 2);
  fs.appendFileSync(filePath, encoded.slice(0, split), 'utf8');
  return () => fs.appendFileSync(filePath, `${encoded.slice(split)}\n`, 'utf8');
};

try {
  const codexPath = path.join(root, 'codex.jsonl');
  fs.writeFileSync(codexPath, [
    line({ type: 'session_meta', timestamp: '2026-07-13T16:00:00.000Z', payload: {
      id: '00000000-0000-4000-8000-000000000101', cwd: root, model: 'gpt-5.5',
    } }),
    line({ type: 'event_msg', timestamp: '2026-07-13T16:00:01.000Z', payload: {
      type: 'user_message', message: 'Codex initial',
    } }),
  ].join(''), 'utf8');
  const codexBaseline = codexCli.readSessionSummary(codexPath, { preferTailBytes: 1 });
  const codexBaselineMessages = JSON.parse(JSON.stringify(codexBaseline.messages));
  const finishCodex = appendPartial(codexPath, {
    type: 'event_msg', timestamp: '2026-07-13T16:00:02.000Z',
    payload: { type: 'agent_message', message: 'Codex appended' },
  });
  const codexPartial = codexCli.readSessionSummary(codexPath, { preferTailBytes: 1 });
  assert.strictEqual(codexPartial.messages.length, codexBaseline.messages.length,
    'Codex must not accept an unfinished JSONL event');
  assert.strictEqual(codexPartial.sourceCursor.end_offset, codexBaseline.sourceCursor.end_offset,
    'Codex must not advance its accepted cursor past an unfinished event');
  const codexPartialOffset = codexPartial.sourceCursor.end_offset;
  finishCodex();
  const codexAppend = codexCli.readSessionSummary(codexPath, { preferTailBytes: 1 });
  assert(codexAppend.messages.some(message => message.content === 'Codex appended'));
  assert.strictEqual(codexAppend.sourceCursor.mode, 'append');
  assert.strictEqual(codexAppend.sourceCursor.start_offset, codexPartialOffset);
  assert(codexAppend.sourceCursor.bytes_read < codexAppend.sourceCursor.file_size,
    'Codex append must read only the unfinished suffix, not the archive');

  const cursorPath = path.join(root, 'cursor.jsonl');
  fs.writeFileSync(cursorPath, [
    line({ type: 'session_meta', cliSessionId: '00000000-0000-4000-8000-000000000102', workspacePath: root }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Cursor initial' }] } }),
  ].join(''), 'utf8');
  const cursorBaseline = cursorCli.readSessionSummary(cursorPath, { preferTailBytes: 1 });
  const cursorBaselineCount = cursorBaseline.messages.length;
  fs.appendFileSync(cursorPath, line({
    type: 'assistant', timestamp_ms: Date.now(),
    message: { role: 'assistant', content: [{ type: 'text', text: 'Cursor appended' }] },
  }) + line({ type: 'result', subtype: 'success', result: 'Cursor appended' }), 'utf8');
  const cursorAppend = cursorCli.readSessionSummary(cursorPath, { preferTailBytes: 1 });
  assert.strictEqual(cursorAppend.sourceCursor.mode, 'append');
  assert(cursorAppend.sourceCursor.bytes_read < cursorAppend.sourceCursor.file_size,
    'Cursor append must read only new bytes');
  assert.strictEqual(cursorAppend.messages.length, cursorBaselineCount + 1);

  const claudeDir = path.join(root, 'claude-project');
  fs.mkdirSync(claudeDir, { recursive: true });
  const claudePath = path.join(claudeDir, '00000000-0000-4000-8000-000000000103.jsonl');
  const claudeRecord = value => ({
    sessionId: '00000000-0000-4000-8000-000000000103', cwd: root,
    entrypoint: 'cli', timestamp: '2026-07-13T16:00:00.000Z', ...value,
  });
  fs.writeFileSync(claudePath, line(claudeRecord({
    type: 'user', uuid: 'claude-user-1', message: { role: 'user', content: 'Claude initial' },
  })), 'utf8');
  const claudeBaseline = claudeCli.readSessionSummary(claudePath);
  const finishClaude = appendPartial(claudePath, claudeRecord({
    type: 'assistant', uuid: 'claude-assistant-1',
    message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Claude appended' }] },
  }));
  const claudePartial = claudeCli.readSessionSummary(claudePath);
  assert.strictEqual(claudePartial.messages.length, claudeBaseline.messages.length,
    'Claude must retain an incomplete suffix without accepting it');
  const claudePartialOffset = claudePartial.sourceCursor.end_offset;
  finishClaude();
  const claudeAppend = claudeCli.readSessionSummary(claudePath);
  assert.strictEqual(claudeAppend.sourceCursor.mode, 'append');
  assert.strictEqual(claudeAppend.sourceCursor.start_offset, claudePartialOffset);
  assert(claudeAppend.sourceCursor.bytes_read < claudeAppend.sourceCursor.file_size,
    'Claude append must read only the retained suffix');
  assert(claudeAppend.messages.some(message => message.content === 'Claude appended'));

  fs.writeFileSync(claudePath, [
    line(claudeRecord({ type: 'user', uuid: 'claude-user-rotated', message: { role: 'user', content: 'Rotated user' } })),
    line(claudeRecord({
      type: 'assistant', uuid: 'claude-assistant-rotated',
      message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Rotated answer replaces prior archive state' }] },
    })),
  ].join(''), 'utf8');
  const claudeRecovery = claudeCli.readSessionSummary(claudePath);
  assert.strictEqual(claudeRecovery.sourceCursor.mode, 'recovery');
  assert.deepStrictEqual(claudeRecovery.messages.map(message => message.content), [
    'Rotated user', 'Rotated answer replaces prior archive state',
  ]);

  const engine = Object.create(ProxyEngine.prototype);
  const outbound = [];
  const logs = [];
  engine._log = (level, message) => logs.push({ level, message });
  engine._sendToRelay = message => { outbound.push(message); return true; };
  engine._sendHistorySnapshot = (sessionId, messages, reason, options) => {
    outbound.push(proto.historySnapshot(sessionId, messages, {
      resyncId: options.resyncId,
      resyncReason: options.resyncReason,
      replaceAll: options.replaceAll,
      includeLegacyHistory: options.includeLegacyHistory,
      source: options.source,
      sourceCursor: options.sourceCursor,
      sourceBytes: options.sourceBytes,
      rateLimitMs: options.rateLimitMs,
    }));
    return true;
  };
  const transportSession = {
    agentType: 'codex_cli',
    _fileTranscriptState: engine._fileTranscriptState(
      'codex_cli', codexPath, codexBaselineMessages, codexBaseline.sourceCursor
    ),
  };
  const migrationEngine = Object.create(ProxyEngine.prototype);
  const migrationFrames = [];
  migrationEngine._log = () => {};
  migrationEngine.relayReady = true;
  migrationEngine.relayWs = { readyState: 1 };
  migrationEngine._sendHistorySnapshot = (sessionId, messages, reason, options) => {
    const frame = proto.historySnapshot(sessionId, messages, {
      resyncId: options.resyncId,
      resyncReason: options.resyncReason,
      replaceAll: options.replaceAll,
      includeLegacyHistory: options.includeLegacyHistory,
      source: options.source,
      sourceCursor: options.sourceCursor,
      sourceBytes: options.sourceBytes,
      rateLimitMs: options.rateLimitMs,
    });
    frame.test_direct_transport = options.directTransport === true;
    migrationFrames.push(frame);
    return true;
  };
  const canonicalMigrationSession = { agentType: 'codex_cli' };
  const canonicalMigrationResult = migrationEngine._sendFileBackedTranscriptUpdate(
    'canonical-migration-session',
    canonicalMigrationSession,
    [{
      role: 'assistant',
      content: 'Canonical answer without a citation.',
      source_message_id: 'codex_cli_pair:fixture-canonical',
      native_source_paired: true,
      content_blocks: [{ type: 'markdown', content: 'Canonical answer without a citation.' }],
    }],
    {
      agentType: 'codex_cli', filePath: codexPath,
      sourceCursor: { mode: 'baseline', start_offset: 0, end_offset: 460, file_size: 460 },
      reason: 'fixture baseline',
    },
  );
  assert.strictEqual(canonicalMigrationResult.mode, 'canonical_schema_migration');
  assert.strictEqual(migrationFrames.length, 1, 'canonical baseline must emit one authoritative migration');
  assert.strictEqual(migrationFrames[0].source, 'codex_cli_jsonl');
  assert.strictEqual(migrationFrames[0].test_direct_transport, true);
  assert.strictEqual(migrationFrames[0].replace_all, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(migrationFrames[0], 'history'), false);
  assert.match(migrationFrames[0].resync_reason, /canonical-v2 authoritative identity migration/);
  assert.strictEqual(migrationFrames[0].messages.length, 1);
  const pendingSession = {
    _fileTranscriptState: migrationEngine._fileTranscriptState(
      'codex_cli', codexPath, [{
        role: 'assistant',
        content: 'Canonical cited answer.',
        source_message_id: 'codex_cli_pair:fixture-pending-citation',
        native_source_paired: true,
        content_blocks: [
          { type: 'markdown', content: 'Canonical cited answer.' },
          { type: 'memory_citation', title: 'Sources', entries: [], rollout_ids: [] },
        ],
      }],
      { mode: 'baseline', start_offset: 0, end_offset: 460, file_size: 460 },
    ),
  };
  migrationEngine.relayReady = false;
  migrationEngine.sessions = new Map([['pending-canonical-session', pendingSession]]);
  const pendingMigration = migrationEngine._migrateCodexCliCanonicalTranscript(
    'pending-canonical-session', pendingSession, pendingSession._fileTranscriptState, 'initial registration',
  );
  assert.strictEqual(pendingMigration.mode, 'canonical_schema_migration_pending');
  assert.strictEqual(pendingSession._codexCliCanonicalMigrationPending, true);
  migrationEngine.relayReady = true;
  migrationEngine._flushCodexCliCanonicalMigrations();
  assert.strictEqual(pendingSession._codexCliCanonicalMigrationPending, false);
  assert.strictEqual(pendingSession._codexCliCanonicalMigrationAttempted, true);
  assert.strictEqual(migrationFrames.length, 2, 'relay handshake must flush pending canonical migration once');
  const originalReadSessionSummary = codexCli.readSessionSummary;
  const fullCitationMessages = [
    {
      role: 'assistant', content: 'Full canonical cited answer.',
      source_message_id: 'codex_cli_pair:fixture-full-citation', native_source_paired: true,
      content_blocks: [
        { type: 'markdown', content: 'Full canonical cited answer.' },
        { type: 'memory_citation', title: 'Sources', entries: [], rollout_ids: [] },
      ],
    },
    { role: 'user', content: 'Older retained row.', source_message_id: 'codex_cli:fixture-older-row' },
  ];
  codexCli.readSessionSummary = () => ({
    messages: fullCitationMessages,
    messagesHydrated: true,
    messagesPartial: false,
    sourceCursor: { mode: 'full', start_offset: 0, end_offset: 2048, file_size: 2048, partial: false },
  });
  let fullMigrationResult;
  try {
    const boundedCitationState = migrationEngine._fileTranscriptState(
      'codex_cli', codexPath, [fullCitationMessages[0]],
      { mode: 'tail', start_offset: 1024, end_offset: 2048, file_size: 2048, partial: true, window_start_offset: 1024 },
    );
    fullMigrationResult = migrationEngine._migrateCodexCliCanonicalTranscript(
      'full-canonical-session', {}, boundedCitationState, 'initial registration',
    );
  } finally {
    codexCli.readSessionSummary = originalReadSessionSummary;
  }
  assert.strictEqual(fullMigrationResult.mode, 'canonical_schema_migration');
  assert.strictEqual(fullMigrationResult.sent, 2, 'bounded canonical migration must hydrate the complete archive');
  assert.strictEqual(migrationFrames.length, 3);
  assert.strictEqual(migrationFrames[2].messages.length, 2);
  assert.strictEqual(migrationFrames[2].test_direct_transport, true);
  const latencyMigrationSessionId = 'canonical-latency-session';
  const latencyMigrationMessages = [
    { role: 'user', content: 'Measured request.', source_message_id: 'codex_cli:fixture-latency-user' },
    { role: 'assistant', content: 'Measured first output.', source_message_id: 'codex_cli:fixture-latency-assistant' },
  ];
  const latencyMigrationState = migrationEngine._fileTranscriptState(
    'codex_cli',
    codexPath,
    latencyMigrationMessages,
    { mode: 'full', start_offset: 0, end_offset: 2300, file_size: 2300, partial: false },
  );
  migrationEngine._latencyTraceClientIdsBySession = new Map([
    [latencyMigrationSessionId, ['fixture-latency-cid']],
  ]);
  migrationEngine._latencyTracesByClientMessageId = new Map([
    ['fixture-latency-cid', {
      delivered: false,
      completed: false,
      sessionId: latencyMigrationSessionId,
      clientMessageId: 'fixture-latency-cid',
      contentSha256: crypto.createHash('sha256').update('Measured request.').digest('hex'),
      registeredAtMs: Date.now(),
    }],
  ]);
  migrationEngine._latencyOutputSequenceBySession = new Map();
  const canonicalLatencyReplays = [];
  migrationEngine._sendProxyMessage = (sessionId, message) => {
    canonicalLatencyReplays.push({ sessionId, message });
    return true;
  };
  const latencyMigrationSession = {};
  const latencyMigrationResult = migrationEngine._migrateCodexCliCanonicalTranscript(
    latencyMigrationSessionId,
    latencyMigrationSession,
    latencyMigrationState,
    'latency fixture',
  );
  assert.strictEqual(latencyMigrationResult.mode, 'canonical_schema_migration');
  assert.strictEqual(latencyMigrationResult.latency_replay_sent, false);
  assert.strictEqual(canonicalLatencyReplays.length, 0,
    'a canonical assistant observed before delivery must remain deferred');
  assert.deepStrictEqual(
    latencyMigrationSession._pendingCanonicalLatencyMessages?.map(message => message.content),
    ['Measured request.', 'Measured first output.'],
  );
  migrationEngine._latencyTracesByClientMessageId.get('fixture-latency-cid').delivered = true;
  assert.strictEqual(
    migrationEngine._flushPendingCanonicalAssistantForLatency(
      latencyMigrationSessionId,
      latencyMigrationSession,
    ),
    true,
  );
  assert.strictEqual(canonicalLatencyReplays.length, 1,
    'the delivery receipt must replay exactly one deferred canonical assistant row');
  assert.strictEqual(canonicalLatencyReplays[0].sessionId, latencyMigrationSessionId);
  assert.strictEqual(canonicalLatencyReplays[0].message.role, 'assistant');
  assert.strictEqual(canonicalLatencyReplays[0].message.content, 'Measured first output.');
  assert.strictEqual(
    migrationEngine._flushPendingCanonicalAssistantForLatency(
      latencyMigrationSessionId,
      latencyMigrationSession,
    ),
    false,
    'a deferred canonical assistant must flush exactly once',
  );
  assert.strictEqual(canonicalLatencyReplays.length, 1);
  const terminalLatencyEngine = Object.create(ProxyEngine.prototype);
  const terminalLatencySessionId = 'terminal-latency-session';
  const terminalLatencyTurn = {
    threadId: 'terminal-latency-thread',
    turnId: 'terminal-latency-turn',
    emit: () => {},
  };
  const terminalLatencySession = {
    _codexAppServerTurn: terminalLatencyTurn,
    _codexAppServerTurnIdentity: {
      thread_id: terminalLatencyTurn.threadId,
      turn_id: terminalLatencyTurn.turnId,
    },
  };
  terminalLatencyEngine.sessions = new Map([
    [terminalLatencySessionId, terminalLatencySession],
  ]);
  terminalLatencyEngine._latencyTraceClientIdsBySession = new Map([
    [terminalLatencySessionId, ['terminal-latency-cid']],
  ]);
  terminalLatencyEngine._latencyTracesByClientMessageId = new Map([
    ['terminal-latency-cid', {
      delivered: true,
      completed: false,
      sessionId: terminalLatencySessionId,
      clientMessageId: 'terminal-latency-cid',
      contentSha256: crypto.createHash('sha256').update('Measured request.').digest('hex'),
      registeredAtMs: Date.now(),
      receiptIdentity: {
        native_session_id: terminalLatencyTurn.threadId,
        native_turn_id: terminalLatencyTurn.turnId,
        process_epoch: null,
        cursor: null,
      },
    }],
  ]);
  terminalLatencyEngine._latencyOutputSequenceBySession = new Map();
  terminalLatencyEngine._log = () => {};
  const terminalLatencyReplays = [];
  terminalLatencyEngine._sendProxyMessage = (sessionId, message) => {
    terminalLatencyReplays.push({ sessionId, message });
    return true;
  };
  const terminalAssistantAt = '2026-07-25T21:07:26.423Z';
  assert.strictEqual(terminalLatencyEngine._observeCodexCliOwnedTurnCompletion(
    terminalLatencySessionId,
    terminalLatencySession,
    {
      cliSessionId: terminalLatencyTurn.threadId,
      taskCompletedTurnId: terminalLatencyTurn.turnId,
      taskCompletedAt: '2026-07-25T21:07:26.446Z',
      messages: [
        { role: 'user', content: 'Measured request.', native_turn_id: terminalLatencyTurn.turnId },
        { role: 'assistant', content: 'Settled fallback.', native_turn_id: terminalLatencyTurn.turnId, created_at: terminalAssistantAt },
      ],
    },
  ), true);
  assert.strictEqual(terminalLatencyReplays.length, 1,
    'an exact terminal turn with no streamed delta must replay one settled assistant row');
  assert.strictEqual(terminalLatencyReplays[0].message.content, 'Settled fallback.');
  const terminalLatencySource = terminalLatencyEngine._firstOutputLatencySource(
    { created_at: terminalAssistantAt },
    terminalLatencySessionId,
  );
  assert.strictEqual(terminalLatencySource.observedAtMs, Date.parse(terminalAssistantAt));
  assert.strictEqual(terminalLatencySource.source.source, 'native_message_timestamp');
  assert.strictEqual(terminalLatencySource.source.native_timestamp_source, 'message_created_at');

  const orderingEngine = Object.create(ProxyEngine.prototype);
  const orderedFrames = [];
  const orderingSessionId = 'desktop-authoritative-boundary';
  orderingEngine._log = () => {};
  orderingEngine.sessions = new Map([[orderingSessionId, { agentType: 'codex-desktop' }]]);
  orderingEngine._canonicalSuppressedSessionIds = new Set();
  orderingEngine.relayReady = true;
  orderingEngine.relayWs = {
    readyState: 1,
    bufferedAmount: 0,
    send: encoded => orderedFrames.push(JSON.parse(encoded)),
  };
  orderingEngine._promoteSessionChatTitle = () => false;
  orderingEngine._pendingRelayBulk = new Map([[
    `history_snapshot:${orderingSessionId}`,
    { encoded: '{"type":"history_snapshot","messages":[{"content":"stale"}]}', byteLen: 64 },
  ]]);
  orderingEngine._relayBulkDeferralLogAt = new Map([[
    `history_snapshot:${orderingSessionId}`,
    Date.now(),
  ]]);
  assert.strictEqual(orderingEngine._sendHistorySnapshot(
    orderingSessionId,
    [],
    'codex desktop native thread change',
    { directTransport: true, replaceAll: true },
  ), true);
  assert.strictEqual(orderingEngine._pendingRelayBulk.has(`history_snapshot:${orderingSessionId}`), false,
    'a newer direct authoritative boundary must cancel the older deferred bulk snapshot');
  assert.strictEqual(orderingEngine._relayBulkDeferralLogAt.has(`history_snapshot:${orderingSessionId}`), false);
  assert.strictEqual(orderedFrames.length, 1);
  assert.strictEqual(orderedFrames[0].replace_all, true);
  assert.deepStrictEqual(orderedFrames[0].messages, []);

  const desktopBoundaryEngine = Object.create(ProxyEngine.prototype);
  const desktopBoundaryFrames = [];
  desktopBoundaryEngine._log = () => {};
  desktopBoundaryEngine._sendHistorySnapshot = (sessionId, messages, reason, options) => {
    desktopBoundaryFrames.push({ sessionId, messages, reason, options });
    return true;
  };
  const desktopSession = {
    agentType: 'codex-desktop',
    _activeThreadKey: 'local:00000000-0000-4000-8000-000000000111',
    _accumulatedMessages: [{ role: 'assistant', content: 'former thread' }],
    lastMessageCount: 1,
    lastObservedCount: 1,
    lastTranscriptSig: 'former',
  };
  const originalUpdateSession = sessionStore.updateSession;
  sessionStore.updateSession = () => {};
  try {
    desktopBoundaryEngine._applyCodexDesktopActiveThread(
      orderingSessionId,
      desktopSession,
      { id: 'local:00000000-0000-4000-8000-000000000222', title: 'Replacement thread' },
      { refreshMetadata: false },
    );
  } finally {
    sessionStore.updateSession = originalUpdateSession;
  }
  assert.strictEqual(desktopBoundaryFrames.length, 1);
  assert.deepStrictEqual(desktopBoundaryFrames[0].messages, []);
  assert.strictEqual(desktopBoundaryFrames[0].options.directTransport, true);
  assert.strictEqual(desktopBoundaryFrames[0].options.replaceAll, true);
  assert.strictEqual(desktopSession.lastMessageCount, 0);
  assert.strictEqual(desktopSession._activeThreadKey, 'local:00000000-0000-4000-8000-000000000222');

  const releasedAliasSessionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  const releasedCanonicalSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const releasedNativeId = '11111111-2222-4333-8444-555555555555';
  const releaseEngine = Object.create(ProxyEngine.prototype);
  let releasedFrame = null;
  let releasedStorePatch = null;
  releaseEngine._canonicalSuppressedSessionIds = new Set([releasedAliasSessionId]);
  releaseEngine._lastSessionSnapshotSig = 'before-release';
  releaseEngine.sessions = new Map([[
    releasedAliasSessionId,
    { agentType: 'codex_cli', canonical_suppressed: true },
  ]]);
  releaseEngine._sendToRelay = frame => {
    releasedFrame = frame;
    return true;
  };
  releaseEngine._log = () => {};
  const originalGetSession = sessionStore.getSession;
  const originalUpdateReleaseSession = sessionStore.updateSession;
  sessionStore.getSession = id => (id === releasedAliasSessionId ? {
    session_id: releasedAliasSessionId,
    canonical_suppressed: true,
    canonical_session_id: releasedCanonicalSessionId,
  } : null);
  sessionStore.updateSession = (id, patch) => {
    assert.strictEqual(id, releasedAliasSessionId);
    releasedStorePatch = patch;
  };
  try {
    assert.strictEqual(releaseEngine._releaseCodexCliCanonicalAlias(
      releasedAliasSessionId,
      releasedNativeId,
      {
        verified: true,
        generation: '2026-07-23T12:00:00.000Z',
        observed_at: '2026-07-23T12:00:00.000Z',
        native_pid: 1234,
      },
    ), true);
  } finally {
    sessionStore.getSession = originalGetSession;
    sessionStore.updateSession = originalUpdateReleaseSession;
  }
  assert.strictEqual(releasedFrame.type, 'session_alias_released');
  assert.strictEqual(releasedFrame.alias_session_id, releasedAliasSessionId);
  assert.strictEqual(releasedFrame.prior_canonical_session_id, releasedCanonicalSessionId);
  assert.strictEqual(releasedFrame.current_surface, 'codex_cli');
  assert.strictEqual(releasedFrame.owner_evidence.verified, true);
  assert.strictEqual(releasedStorePatch.canonical_suppressed, false);
  assert.strictEqual(releasedStorePatch.canonical_session_id, releasedAliasSessionId);
  assert.strictEqual(releaseEngine._canonicalSuppressedSessionIds.has(releasedAliasSessionId), false);
  assert.strictEqual(releaseEngine._lastSessionSnapshotSig, null);

  const flushOrderEngine = Object.create(ProxyEngine.prototype);
  const flushOrder = [];
  flushOrderEngine.relayReady = true;
  flushOrderEngine.relayWs = {
    readyState: 1,
    bufferedAmount: 0,
    send: encoded => flushOrder.push(JSON.parse(encoded).type),
  };
  flushOrderEngine._pendingPreReadyAliasEvents = new Map([[
    releasedAliasSessionId,
    JSON.stringify(releasedFrame),
  ]]);
  flushOrderEngine._pendingPreReadyHistory = new Map([[
    releasedAliasSessionId,
    JSON.stringify({
      type: 'history_snapshot',
      session_id: releasedAliasSessionId,
      messages: [],
      replace_all: true,
    }),
  ]]);
  flushOrderEngine._pendingPreReadyEvents = new Map();
  flushOrderEngine._pendingRelayBulk = new Map();
  flushOrderEngine._log = () => {};
  flushOrderEngine._flushPendingRelayBulk = () => {};
  flushOrderEngine._flushPendingPreReadyAliasEvents();
  flushOrderEngine._flushPendingPreReadyHistory();
  assert.deepStrictEqual(flushOrder, ['session_alias_released', 'history_snapshot'],
    'alias release must reach the relay before authoritative history');

  const appendResult = engine._sendFileBackedTranscriptUpdate(
    'incremental-session', transportSession, codexAppend.messages,
    { agentType: 'codex_cli', filePath: codexPath, sourceCursor: codexAppend.sourceCursor, reason: 'fixture append' },
  );
  assert.strictEqual(appendResult.mode, 'append');
  assert.strictEqual(appendResult.sent, 1);
  const appendedFrame = outbound.find(message => message.type === 'proxy_message');
  assert(appendedFrame?.source_message_id?.startsWith('codex_cli:'));
  assert.strictEqual(appendedFrame.source_cursor.end_offset, codexAppend.sourceCursor.end_offset);
  assert(!outbound.some(message => message.type === 'history_chunk'),
    'ordinary file append must never emit a requestless full tail');

  const restartedState = engine._fileTranscriptState('codex_cli', codexPath, codexAppend.messages, {
    ...codexAppend.sourceCursor,
    partial: true,
    start_offset: Math.max(0, codexAppend.sourceCursor.start_offset - 17),
  });
  const restartedFrame = proto.proxyMessage(
    'incremental-session',
    codexAppend.messages[codexAppend.messages.length - 1].role,
    codexAppend.messages[codexAppend.messages.length - 1].content,
    engine._fileTranscriptMessage(
      restartedState,
      codexAppend.messages[codexAppend.messages.length - 1],
      codexAppend.messages.length - 1,
      restartedState.sourceCursor,
    ),
  );
  assert.strictEqual(restartedFrame.source_message_id, appendedFrame.source_message_id,
    'semantic source identity must survive a bounded-tail offset change and proxy restart');

  const noReplayCount = outbound.length;
  const unchangedResult = engine._sendFileBackedTranscriptUpdate(
    'incremental-session', transportSession, codexAppend.messages,
    { agentType: 'codex_cli', filePath: codexPath, sourceCursor: codexAppend.sourceCursor, reason: 'duplicate watcher event' },
  );
  assert.strictEqual(unchangedResult.mode, 'unchanged');
  assert.strictEqual(outbound.length, noReplayCount, 'duplicate watcher events must emit nothing');
  const duplicateWatcherFrames = outbound.length - noReplayCount;

  engine.sessions = new Map([['incremental-session', transportSession]]);
  const relayRecoveryId = '00000000-0000-4000-8000-000000000199';
  engine._handleTranscriptResyncRequest({
    type: 'transcript_resync_required',
    session_id: 'incremental-session',
    source: 'codex_cli_jsonl',
    resync_id: relayRecoveryId,
    reason: 'cursor_gap',
  });
  const relayRecoveryFrame = outbound.find(message => message.resync_id === relayRecoveryId);
  assert(relayRecoveryFrame, 'relay cursor gap must trigger an identified recovery snapshot');
  assert.strictEqual(relayRecoveryFrame.source, 'codex_cli_jsonl');
  assert.strictEqual(relayRecoveryFrame.messages.length, codexAppend.messages.length);
  transportSession._lastFileTranscriptResyncAt = 0;

  const deferredSession = {
    agentType: 'codex_cli',
    _fileTranscriptState: engine._fileTranscriptState(
      'codex_cli', codexPath, codexBaselineMessages, codexBaseline.sourceCursor,
    ),
  };
  engine._sendToRelay = () => false;
  const deferredResult = engine._sendFileBackedTranscriptUpdate(
    'deferred-session', deferredSession, codexAppend.messages,
    { agentType: 'codex_cli', filePath: codexPath, sourceCursor: codexAppend.sourceCursor, reason: 'offline append' },
  );
  assert.strictEqual(deferredResult.mode, 'append_deferred');
  assert.strictEqual(deferredSession._fileTranscriptState.messages.length, codexBaselineMessages.length,
    'file cursor state must not advance when the relay enqueue rejects the append');
  engine._sendToRelay = message => { outbound.push(message); return true; };
  const retriedResult = engine._sendFileBackedTranscriptUpdate(
    'deferred-session', deferredSession, codexAppend.messages,
    { agentType: 'codex_cli', filePath: codexPath, sourceCursor: codexAppend.sourceCursor, reason: 'offline append retry' },
  );
  assert.strictEqual(retriedResult.mode, 'append');
  assert.strictEqual(retriedResult.sent, 1, 'the exact rejected append must be retryable after reconnect');

  const mutated = codexAppend.messages.map(message => ({ ...message }));
  mutated[mutated.length - 1].content = 'Codex appended and authoritatively corrected';
  const recoveryResult = engine._sendFileBackedTranscriptUpdate(
    'incremental-session', transportSession, mutated,
    { agentType: 'codex_cli', filePath: codexPath, sourceCursor: {
      ...codexAppend.sourceCursor, mode: 'recovery', bytes_read: 128,
    }, reason: 'fixture mutation' },
  );
  assert.strictEqual(recoveryResult.mode, 'resync');
  const recoveryFrame = outbound.find(message => (
    message.type === 'history_snapshot' && message.resync_reason === 'fixture mutation'
  ));
  assert(recoveryFrame?.resync_id);
  assert.strictEqual(recoveryFrame.resync_reason, 'fixture mutation');
  assert.strictEqual(recoveryFrame.source_bytes, 128);
  assert.strictEqual(recoveryFrame.resync_rate_limit_ms, 5000);

  // A long-lived active Codex file must periodically discard old parser
  // objects instead of retaining every message appended after the first tail.
  const boundedPath = path.join(root, 'codex-bounded.jsonl');
  const boundedSessionId = '00000000-0000-4000-8000-000000000104';
  const largeEvent = index => line({
    type: 'event_msg',
    timestamp: new Date(Date.parse('2026-07-13T17:00:00.000Z') + index).toISOString(),
    payload: { type: index % 2 ? 'agent_message' : 'user_message', message: `bounded-${index}-${'x'.repeat(4000)}` },
  });
  fs.writeFileSync(boundedPath, line({
    type: 'session_meta', timestamp: '2026-07-13T17:00:00.000Z',
    payload: { id: boundedSessionId, cwd: root, model: 'gpt-5.5' },
  }) + Array.from({ length: 310 }, (_, index) => largeEvent(index)).join(''), 'utf8');
  const boundedBaseline = codexCli.readSessionSummary(boundedPath, { preferTailBytes: 1024 * 1024 });
  fs.appendFileSync(
    boundedPath,
    Array.from({ length: 280 }, (_, index) => largeEvent(310 + index)).join(''),
    'utf8',
  );
  const boundedRebase = codexCli.readSessionSummary(boundedPath, { preferTailBytes: 1024 * 1024 });
  assert.strictEqual(boundedRebase.sourceCursor.mode, 'bounded_rebase');
  assert(
    boundedRebase.sourceCursor.retained_window_bytes <= 1024 * 1024,
    `bounded parser rebase retained ${boundedRebase.sourceCursor.retained_window_bytes} bytes`,
  );

  // The per-poll transport cost must scale with the append, not with the
  // multi-megabyte transcript already accepted by the relay.
  const hotEngine = Object.create(ProxyEngine.prototype);
  hotEngine._log = () => {};
  const hotFrames = [];
  hotEngine._sendProxyMessage = (_sessionId, message) => { hotFrames.push(message); return true; };
  const hotMessages = Array.from({ length: 1800 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `hot-${index}-${'h'.repeat(2048)}`,
    source_message_id: `hot-source-${index}`,
  }));
  const hotCursor = { mode: 'baseline_tail', start_offset: 10, end_offset: 5_000_000, file_size: 5_000_000 };
  const hotSession = {
    agentType: 'codex_cli',
    _fileTranscriptState: hotEngine._fileTranscriptState('codex_cli', boundedPath, hotMessages, hotCursor),
  };
  let signatureRows = 0;
  let clonedRows = 0;
  let identityRows = 0;
  const originalSignature = hotEngine._transcriptSignature;
  const originalClone = hotEngine._cloneTranscriptMessages;
  const originalIds = hotEngine._fileTranscriptMessageIds;
  hotEngine._transcriptSignature = function measuredSignature(messages) {
    signatureRows += Array.isArray(messages) ? messages.length : 0;
    return originalSignature.call(this, messages);
  };
  hotEngine._cloneTranscriptMessages = function measuredClone(messages) {
    clonedRows += Array.isArray(messages) ? messages.length : 0;
    return originalClone.call(this, messages);
  };
  hotEngine._fileTranscriptMessageIds = function measuredIds(agentType, generation, messages, occurrences) {
    identityRows += Array.isArray(messages) ? messages.length : 0;
    return originalIds.call(this, agentType, generation, messages, occurrences);
  };
  const hotAppend = {
    role: 'assistant', content: 'bounded O(append) row', source_message_id: 'hot-source-1800',
  };
  const hotResult = hotEngine._sendFileBackedTranscriptUpdate(
    'hot-session',
    hotSession,
    [...hotMessages, hotAppend],
    {
      agentType: 'codex_cli', filePath: boundedPath,
      sourceCursor: { mode: 'append', start_offset: 5_000_000, end_offset: 5_001_000, file_size: 5_001_000 },
      reason: 'large fixture append',
    },
  );
  assert.strictEqual(hotResult.mode, 'append');
  assert.strictEqual(hotResult.sent, 1);
  assert(signatureRows <= 2, `append seam serialized ${signatureRows} transcript rows`);
  assert(clonedRows <= 1, `append cloned ${clonedRows} transcript rows`);
  assert(identityRows <= 1, `append regenerated ${identityRows} source identities`);
  assert.strictEqual(
    hotEngine._fileTranscriptObservationKey(boundedPath, {
      mode: 'append', end_offset: 5_001_000, file_size: 5_001_000, mtime_ms: 1234,
    }, [...hotMessages, hotAppend]),
    hotEngine._fileTranscriptObservationKey(boundedPath, {
      mode: 'unchanged', end_offset: 5_001_000, file_size: 5_001_000, mtime_ms: 1234,
    }, [...hotMessages, hotAppend]),
    'an unchanged reread of one accepted cursor must not trigger another whole-tail comparison',
  );
  assert.strictEqual(
    hotEngine._fileTranscriptObservationKey(boundedPath, null, []),
    `${boundedPath}\u0000fallback\u00000\u0000empty`,
    'a registered metadata-only session needs a stable empty observation key',
  );
  const largeAppendWork = { signatureRows, clonedRows, identityRows };
  hotEngine._transcriptSignature = originalSignature;
  hotEngine._cloneTranscriptMessages = originalClone;
  hotEngine._fileTranscriptMessageIds = originalIds;

  // A bounded parser-window slide preserves its overlap and emits only new
  // semantic rows with a continuous logical message index.
  const slidePrevious = hotMessages.slice(0, 400);
  const slideCurrent = [...hotMessages.slice(200, 400), hotAppend, {
    role: 'user', content: 'post-slide row', source_message_id: 'hot-source-1801',
  }];
  const slideSession = {
    agentType: 'codex_cli',
    _fileTranscriptState: hotEngine._fileTranscriptState('codex_cli', boundedPath, slidePrevious, hotCursor),
  };
  hotFrames.length = 0;
  const slideResult = hotEngine._sendFileBackedTranscriptUpdate(
    'slide-session', slideSession, slideCurrent,
    {
      agentType: 'codex_cli', filePath: boundedPath,
      sourceCursor: {
        mode: 'bounded_rebase', start_offset: 4_000_000, end_offset: 5_002_000,
        file_size: 5_002_000, partial: true,
      },
      reason: 'bounded parser window slide',
    },
  );
  assert.strictEqual(slideResult.mode, 'bounded_rebase_append');
  assert.strictEqual(slideResult.overlap, 200);
  assert.deepStrictEqual(hotFrames.map(frame => frame.source_cursor.message_index), [400, 401]);
  assert.strictEqual(slideSession._fileTranscriptState.messages.length, 202);
  const noOverlapState = slideSession._fileTranscriptState;
  const noOverlapResult = hotEngine._sendFileBackedTranscriptUpdate(
    'slide-session', slideSession,
    [{ role: 'assistant', content: 'disjoint tail', source_message_id: 'disjoint-source' }],
    {
      agentType: 'codex_cli', filePath: boundedPath,
      sourceCursor: { mode: 'bounded_rebase', start_offset: 8_000_000, end_offset: 9_000_000, file_size: 9_000_000 },
      reason: 'disjoint bounded parser window',
    },
  );
  assert.strictEqual(noOverlapResult.mode, 'bounded_rebase_deferred');
  assert.strictEqual(slideSession._fileTranscriptState, noOverlapState,
    'a disjoint partial tail must not replace authoritative transcript state');

  // Automatic recovery must reject an oversized authoritative candidate before
  // constructing/remapping every source-cursor row, then coalesce retries.
  const recoveryEngine = Object.create(ProxyEngine.prototype);
  const recoveryLogs = [];
  recoveryEngine._log = (level, message) => recoveryLogs.push({ level, message });
  recoveryEngine._historySnapshotLimitBytes = () => 4 * 1024 * 1024;
  recoveryEngine._shouldLogLargeHistorySkip = () => true;
  recoveryEngine._sendProxyMessage = () => true;
  recoveryEngine._sendHistorySnapshot = () => { throw new Error('oversized recovery reached snapshot construction'); };
  const oversizedRows = Array.from({ length: 1200 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `oversized-${index}-${'z'.repeat(4096)}`,
    source_message_id: `oversized-source-${index}`,
  }));
  const oversizedSession = {
    agentType: 'codex_cli',
    _fileTranscriptState: recoveryEngine._fileTranscriptState('codex_cli', boundedPath, oversizedRows, hotCursor),
  };
  let recoveryStateBuilds = 0;
  let recoveryRowRemaps = 0;
  const recoveryStateFactory = recoveryEngine._fileTranscriptState;
  const recoveryMessageFactory = recoveryEngine._fileTranscriptMessage;
  recoveryEngine._fileTranscriptState = function measuredRecoveryState(...args) {
    recoveryStateBuilds += 1;
    return recoveryStateFactory.apply(this, args);
  };
  recoveryEngine._fileTranscriptMessage = function measuredRecoveryMessage(...args) {
    recoveryRowRemaps += 1;
    return recoveryMessageFactory.apply(this, args);
  };
  const oversizedMutation = oversizedRows.map((message, index) => (
    index === 0 ? { ...message, content: `${message.content}-mutated` } : message
  ));
  const oversizedMutationResult = recoveryEngine._sendFileBackedTranscriptUpdate(
    'oversized-session', oversizedSession, oversizedMutation,
    {
      agentType: 'codex_cli', filePath: boundedPath,
      sourceCursor: { mode: 'recovery', start_offset: 0, end_offset: 5_003_000, file_size: 5_003_000 },
      reason: 'oversized fixture mutation',
    },
  );
  assert.strictEqual(oversizedMutationResult.mode, 'resync_oversized');
  assert.strictEqual(recoveryStateBuilds, 0, 'oversized mutation must be rejected before rebuilding transcript state');
  recoveryEngine.sessions = new Map([['oversized-session', oversizedSession]]);
  recoveryEngine._handleTranscriptResyncRequest({
    type: 'transcript_resync_required', session_id: 'oversized-session',
    source: 'codex_cli_jsonl', resync_id: '00000000-0000-4000-8000-000000000198', reason: 'cursor_gap',
  });
  assert.strictEqual(recoveryRowRemaps, 0, 'oversized relay recovery must be rejected before row remapping');
  assert(recoveryLogs.some(entry => entry.message.includes('before row remap')));

  const result = {
    ok: true,
    parsers: {
      claude_cli: claudeAppend.sourceCursor,
      codex_cli: codexAppend.sourceCursor,
      cursor_cli: cursorAppend.sourceCursor,
    },
    partial_line_retained_until_valid: true,
    rotation_anchor_recovery: true,
    semantic_append_frames: appendResult.sent,
    duplicate_watcher_frames: duplicateWatcherFrames,
    requestless_history_chunks: outbound.filter(message => message.type === 'history_chunk').length,
    mutation_resync: {
      resync_id: recoveryFrame.resync_id,
      reason: recoveryFrame.resync_reason,
      bytes_read: recoveryFrame.source_bytes,
      rate_limit_ms: recoveryFrame.resync_rate_limit_ms,
    },
    canonical_schema_migration: {
      mode: canonicalMigrationResult.mode,
      rows: migrationFrames[0].messages.length,
      source: migrationFrames[0].source,
      replace_all: migrationFrames[0].replace_all === true,
      legacy_history_omitted: !Object.prototype.hasOwnProperty.call(migrationFrames[0], 'history'),
      pending_latency_replay_rows: canonicalLatencyReplays.length,
      terminal_latency_fallback_rows: terminalLatencyReplays.length,
    },
    authoritative_ordering: {
      stale_bulk_cancelled: true,
      desktop_thread_boundary_frames: desktopBoundaryFrames.length,
      replace_all: orderedFrames[0].replace_all === true,
      alias_release_before_history: flushOrder.join('>'),
      verified_owner_alias_release: releasedFrame.type,
    },
    stable_source_identity: appendedFrame.source_message_id,
    restart_stable_source_identity: restartedFrame.source_message_id,
    rejected_append_retried: retriedResult.sent,
    relay_requested_recovery: {
      resync_id: relayRecoveryFrame.resync_id,
      rows: relayRecoveryFrame.messages.length,
    },
    bounded_parser_window: boundedRebase.sourceCursor,
    large_append_work: {
      existing_rows: hotMessages.length,
      appended_rows: hotResult.sent,
      signature_rows: largeAppendWork.signatureRows,
      cloned_rows: largeAppendWork.clonedRows,
      identity_rows: largeAppendWork.identityRows,
    },
    bounded_transport_rebase: {
      overlap_rows: slideResult.overlap,
      appended_rows: slideResult.sent,
      retained_rows: slideSession._fileTranscriptState.messages.length,
      emitted_message_indexes: hotFrames.map(frame => frame.source_cursor.message_index),
    },
    oversized_recovery: {
      result: oversizedMutationResult.mode,
      state_rebuilds: recoveryStateBuilds,
      remapped_rows: recoveryRowRemaps,
      cooldown_ms: oversizedMutationResult.retry_after_ms,
    },
  };
  if (outputPath) {
    const resolvedOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
