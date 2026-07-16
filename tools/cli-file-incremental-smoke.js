#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');
const proto = require('../agent-proxy/protocol');
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
    stable_source_identity: appendedFrame.source_message_id,
    restart_stable_source_identity: restartedFrame.source_message_id,
    rejected_append_retried: retriedResult.sent,
    relay_requested_recovery: {
      resync_id: relayRecoveryFrame.resync_id,
      rows: relayRecoveryFrame.messages.length,
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
