#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const previousFlag = process.env.RAC_CODEX_CLI_MESSAGE_DELTA;
process.env.RAC_CODEX_CLI_MESSAGE_DELTA = 'true';

try {
  const engine = Object.create(ProxyEngine.prototype);
  const sent = [];
  const logs = [];
  engine._log = (level, message) => logs.push({ level, message });
  engine._sendToRelay = message => {
    sent.push(message);
    return true;
  };
  const session = { status: 'healthy', agentType: 'codex_cli' };
  const event = text => JSON.stringify({
    type: 'item.updated',
    timestamp_ms: Date.now() - 2,
    item: { id: 'answer-fixture', type: 'agent_message', text },
  });

  engine._handleCodexCliJsonEvent(session, 'delta-session', event('Hello'));
  engine._handleCodexCliJsonEvent(session, 'delta-session', event('Hello world'));
  engine._handleCodexCliJsonEvent(session, 'delta-session', event('Hello world'));
  assert.strictEqual(engine._closeCodexCliMessageDelta(session, 'delta-session'), true);
  assert.strictEqual(engine._closeCodexCliMessageDelta(session, 'delta-session'), false);
  const flagProbe = Object.create(ProxyEngine.prototype);
  flagProbe._log = (level, message) => logs.push({ level, message });
  flagProbe._codexCliWatcher = null;
  flagProbe._codexCliArchiveDiscoveryEnabled = () => false;
  flagProbe._startCodexCliWatcher();
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
  assert.strictEqual(statuses.length, 3, 'status/activity state must continue alongside transcript deltas');
  assert(statuses.every(message => message.activity.current.streaming_transport === 'message_delta'));
  assert(statuses.every(message => message.activity.current.partial == null && message.activity.thinkingContent == null),
    'delta mode must not retransmit the growing full answer in status frames');

  const splitSent = [];
  engine._sendToRelay = message => splitSent.push(message);
  const splitSession = { status: 'healthy' };
  const largeUnicode = '🙂'.repeat(20_000);
  engine._handleCodexCliJsonEvent(splitSession, 'split-session', event(largeUnicode));
  const splitChunks = splitSent.filter(message => message.op === 'append');
  assert(splitChunks.length > 1, 'large native events must be split into bounded chunks');
  assert(splitChunks.every(message => Buffer.byteLength(message.append, 'utf8') <= 48 * 1024));
  assert.strictEqual(splitChunks.map(message => message.append).join(''), largeUnicode,
    'UTF-8 chunking must not split or replace Unicode code points');

  process.env.RAC_CODEX_CLI_MESSAGE_DELTA = 'false';
  const disabledSent = [];
  engine._sendToRelay = message => disabledSent.push(message);
  engine._handleCodexCliJsonEvent({ status: 'healthy' }, 'disabled-session', event('disabled'));
  assert.deepStrictEqual(disabledSent.map(message => message.type), ['proxy_status']);
  assert.strictEqual(disabledSent[0].activity.current.partial, 'disabled');

  console.log(JSON.stringify({
    ok: true,
    flag: 'RAC_CODEX_CLI_MESSAGE_DELTA',
    default_enabled: false,
    operations: deltas.map(message => message.op),
    reconstructed: 'Hello world',
    max_producer_chunk_bytes: 48 * 1024,
    unicode_chunking_lossless: true,
    duplicate_cumulative_update_suppressed: true,
    full_answer_status_retransmit_suppressed: true,
    settled_file_append_reconciliation_retained: true,
  }, null, 2));
} finally {
  if (previousFlag == null) delete process.env.RAC_CODEX_CLI_MESSAGE_DELTA;
  else process.env.RAC_CODEX_CLI_MESSAGE_DELTA = previousFlag;
}
