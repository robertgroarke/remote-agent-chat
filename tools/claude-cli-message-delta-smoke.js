#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const disposableSession = require('./claude-cli-disposable-session-ensure');
const productionE2e = require('./claude-cli-message-delta-production-e2e');

const previousFlag = process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA;
process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA = 'true';

assert.throws(() => disposableSession.parseArgs([]), /--send-live/);
assert.throws(() => productionE2e.parseArgs([]), /--send-live/);
assert.throws(
  () => productionE2e.parseArgs(['--send-live', '--session-id', 'unsafe']),
  /explicit UUID/,
);
assert(disposableSession.isSafeIdleSession({
  agent_type: 'claude_cli',
  workspace_path: 'C:\\temp\\remote-agent-claude-cli-test',
  status: 'healthy',
  activity: { kind: 'idle' },
}), 'disposable-session guard rejected the exact safe idle workspace');
assert(!disposableSession.isSafeIdleSession({
  agent_type: 'claude_cli',
  workspace_path: 'C:\\Users\\Robert\\Documents',
  status: 'healthy',
  activity: { kind: 'idle' },
}), 'disposable-session guard admitted a user workspace');

try {
  const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
  assert.match(proxySource, /onStdout:\s*chunk\s*=>[\s\S]*?_handleClaudeCliStreamJsonEvent/,
    'native stream-json stdout must feed the incremental event handler');
  assert.match(proxySource, /onExit:\s*\(code, err\)\s*=>[\s\S]*?_closeClaudeCliMessageDelta[\s\S]*?_findClaudeCliSummaryByCliId/,
    'the provisional stream must close before settled transcript reconciliation');
  assert.match(proxySource, /provisionalStreamActive\s*=\s*this\._claudeCliMessageDeltaEnabled\(\)[\s\S]*?_claudeCliChild[\s\S]*?if \(!provisionalStreamActive\)/,
    'whole-history watcher snapshots must stay suppressed while a flagged native turn is active');

  const engine = Object.create(ProxyEngine.prototype);
  const sent = [];
  const logs = [];
  engine._log = (level, message) => logs.push({ level, message });
  engine._sendToRelay = message => {
    sent.push(message);
    return true;
  };
  const session = { status: 'healthy', agentType: 'claude_cli' };
  const delta = text => JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  });
  const assistant = text => JSON.stringify({
    type: 'assistant',
    timestamp: new Date(Date.now() - 2).toISOString(),
    message: { content: [{ type: 'text', text }] },
  });

  engine._handleClaudeCliStreamJsonEvent(session, 'delta-session', delta('Hello'));
  engine._handleClaudeCliStreamJsonEvent(session, 'delta-session', delta(' world'));
  engine._handleClaudeCliStreamJsonEvent(session, 'delta-session', assistant('Hello world'));
  assert.strictEqual(engine._closeClaudeCliMessageDelta(session, 'delta-session'), true);
  assert.strictEqual(engine._closeClaudeCliMessageDelta(session, 'delta-session'), false);
  const flagProbe = Object.create(ProxyEngine.prototype);
  flagProbe._log = (level, message) => logs.push({ level, message });
  flagProbe._claudeCliWatcher = {};
  flagProbe._startClaudeCliWatcher();
  assert(logs.some(row => row.message.includes('message_delta producer enabled')),
    'startup log must expose the effective rollout flag');

  const deltas = sent.filter(message => message.type === 'message_delta');
  assert.deepStrictEqual(deltas.map(message => [message.seq, message.op]), [
    [0, 'block_open'],
    [1, 'append'],
    [2, 'append'],
    [3, 'block_close'],
  ]);
  assert.strictEqual(deltas.filter(message => message.op === 'append').map(message => message.append).join(''), 'Hello world');
  assert.strictEqual(new Set(deltas.map(message => message.message_id)).size, 1);
  assert(deltas[1].stream_trace.proxy_sent_at_ms >= deltas[1].stream_trace.proxy_normalized_at_ms);
  const statuses = sent.filter(message => message.type === 'proxy_status');
  assert.strictEqual(statuses.length, 2, 'final cumulative assistant event must not duplicate streamed text');
  assert(statuses.every(message => message.activity.current.streaming_transport === 'message_delta'));
  assert(statuses.every(message => message.activity.current.partial == null && message.activity.thinkingContent == null),
    'delta mode must not retransmit the growing full answer in status frames');

  const splitSent = [];
  engine._sendToRelay = message => splitSent.push(message);
  const splitSession = { status: 'healthy' };
  const largeUnicode = '🙂'.repeat(20_000);
  engine._handleClaudeCliStreamJsonEvent(splitSession, 'split-session', delta(largeUnicode));
  const splitChunks = splitSent.filter(message => message.op === 'append');
  assert(splitChunks.length > 1, 'large native events must be split into bounded chunks');
  assert(splitChunks.every(message => Buffer.byteLength(message.append, 'utf8') <= 48 * 1024));
  assert.strictEqual(splitChunks.map(message => message.append).join(''), largeUnicode,
    'UTF-8 chunking must not split or replace Unicode code points');

  process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA = 'false';
  const disabledSent = [];
  engine._sendToRelay = message => disabledSent.push(message);
  engine._handleClaudeCliStreamJsonEvent({ status: 'healthy' }, 'disabled-session', delta('disabled'));
  assert.deepStrictEqual(disabledSent.map(message => message.type), ['proxy_status']);
  assert.strictEqual(disabledSent[0].activity.current.partial, 'disabled');

  console.log(JSON.stringify({
    ok: true,
    flag: 'RAC_CLAUDE_CLI_MESSAGE_DELTA',
    default_enabled: false,
    operations: deltas.map(message => message.op),
    reconstructed: 'Hello world',
    max_producer_chunk_bytes: 48 * 1024,
    unicode_chunking_lossless: true,
    native_partial_events_used: true,
    duplicate_final_assistant_suppressed: true,
    full_answer_status_retransmit_suppressed: true,
    settled_file_append_reconciliation_retained: true,
  }, null, 2));
} finally {
  if (previousFlag == null) delete process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA;
  else process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA = previousFlag;
}
