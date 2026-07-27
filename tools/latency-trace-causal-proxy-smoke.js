#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-latency-causal-proxy-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
fs.writeFileSync(process.env.SESSION_STORE_PATH, JSON.stringify({ sessions: {}, preferences: {} }));

const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function createEngine() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine._latencyTracesByClientMessageId = new Map();
  engine._latencyTraceClientIdsBySession = new Map();
  engine._latencyOutputSequenceBySession = new Map();
  engine._canonicalSuppressedSessionIds = new Set();
  engine.sent = [];
  engine._sendToRelay = message => {
    engine.sent.push(message);
    return true;
  };
  engine._log = () => {};
  return engine;
}

function browserTrace(id, agentType = 'codex_cli') {
  const now = Date.now();
  return {
    schema_version: 1,
    trace_id: `causal-${id}`,
    client_message_id: id,
    agent_type: agentType,
    stages: {
      webui_send: now - 3,
      relay_recv: now - 2,
    },
  };
}

function register(engine, {
  sessionId,
  clientMessageId,
  content,
  agentType = 'codex_cli',
}) {
  engine.sessions.set(sessionId, {
    session_id: sessionId,
    agentType,
    status: 'healthy',
  });
  const message = {
    type: 'send',
    session: sessionId,
    client_message_id: clientMessageId,
    content,
    latency_trace: browserTrace(clientMessageId, agentType),
  };
  const entry = engine._registerSendLatencyTrace(message, engine.sessions.get(sessionId));
  assert(entry, `trace ${clientMessageId} did not register`);
  return entry;
}

function deliver(engine, clientMessageId, receipt = null) {
  const trace = engine._advanceSendLatencyTrace(
    clientMessageId,
    'harness_delivered',
    Date.now(),
    { source: receipt ? 'native_receipt' : 'proxy_delivery_result' },
    receipt,
  );
  assert(trace, `trace ${clientMessageId} did not reach harness_delivered`);
}

function assistant(sessionId, content, {
  threadId = null,
  turnId = null,
  processEpoch = null,
  cursor = null,
} = {}) {
  return {
    type: 'message_delta',
    session_id: sessionId,
    role: 'assistant',
    op: 'append',
    append: content,
    stream_trace: {
      trace_id: `stream-${content.replace(/\W+/g, '-').toLowerCase()}`,
      native_event_at_ms: Date.now(),
      proxy_read_at_ms: Date.now(),
      ...(threadId ? { thread_id: threadId } : {}),
      ...(turnId ? { turn_id: turnId } : {}),
      ...(processEpoch ? { process_epoch: processEpoch } : {}),
      ...(cursor ? { source_cursor: cursor } : {}),
    },
  };
}

const engine = createEngine();
const sessionId = 'causal-session';
register(engine, {
  sessionId,
  clientMessageId: 'reverse-a',
  content: 'request A',
});
register(engine, {
  sessionId,
  clientMessageId: 'reverse-b',
  content: 'request B',
});
deliver(engine, 'reverse-a', {
  thread_id: 'thread-1',
  turn_id: 'turn-a',
  observed_at: new Date().toISOString(),
});
deliver(engine, 'reverse-b', {
  thread_id: 'thread-1',
  turn_id: 'turn-b',
  observed_at: new Date().toISOString(),
});
const reversedB = engine._attachFirstOutputLatencyTrace(assistant(sessionId, 'reply B', {
  threadId: 'thread-1',
  turnId: 'turn-b',
}));
const reversedA = engine._attachFirstOutputLatencyTrace(assistant(sessionId, 'reply A', {
  threadId: 'thread-1',
  turnId: 'turn-a',
}));
assert.strictEqual(reversedB.latency_trace.client_message_id, 'reverse-b');
assert.strictEqual(reversedA.latency_trace.client_message_id, 'reverse-a');
assert.strictEqual(reversedB.latency_causal_match, 'strong_identity');
assert.strictEqual(reversedA.latency_causal_match, 'strong_identity');
assert.strictEqual(
  reversedB.latency_trace.stage_sources.agent_first_output.causal_match,
  'strong_identity',
);
assert.strictEqual(
  reversedA.latency_trace.stage_sources.agent_first_output.causal_match,
  'strong_identity',
);

const processOnlyEngine = createEngine();
register(processOnlyEngine, {
  sessionId,
  clientMessageId: 'process-only',
  content: 'process-only request',
});
deliver(processOnlyEngine, 'process-only', {
  thread_id: 'thread-1',
  process_epoch: 'process-1',
  observed_at: new Date().toISOString(),
});
const unrelatedSameProcess = processOnlyEngine._attachFirstOutputLatencyTrace(
  assistant(sessionId, 'unrelated output from the same process', {
    threadId: 'thread-1',
    processEpoch: 'process-1',
  }),
);
assert.strictEqual(
  unrelatedSameProcess.latency_trace,
  undefined,
  'process identity without a native user/turn/cursor must not prove causality',
);
processOnlyEngine._attachFirstOutputLatencyTrace({
  type: 'proxy_message',
  session_id: sessionId,
  role: 'user',
  content: 'process-only request',
  native_session_id: 'thread-1',
  process_epoch: 'process-1',
});
const laterSameProcess = processOnlyEngine._attachFirstOutputLatencyTrace(
  assistant(sessionId, 'later output after the native user became visible', {
    threadId: 'thread-1',
    processEpoch: 'process-1',
  }),
);
assert.strictEqual(
  laterSameProcess.latency_trace,
  undefined,
  'a later output must not replace an unresolved first-output candidate',
);
const processOnlyEntry = processOnlyEngine._latencyTracesByClientMessageId.get('process-only');
processOnlyEntry.registeredAtMs = Date.now() - (6 * 60 * 1000);
assert.strictEqual(processOnlyEngine._expireSendLatencyTraces(), 1);

const queued = register(engine, {
  sessionId,
  clientMessageId: 'queued-send',
  content: 'queued request',
});
const premature = engine._attachFirstOutputLatencyTrace(assistant(sessionId, 'premature', {
  threadId: 'thread-1',
  turnId: 'turn-queued',
}));
assert.strictEqual(premature.latency_trace, undefined);
assert.strictEqual(queued.delivered, false);
deliver(engine, 'queued-send', {
  thread_id: 'thread-1',
  turn_id: 'turn-queued',
  observed_at: new Date().toISOString(),
});
const queuedOutput = engine._attachFirstOutputLatencyTrace(assistant(sessionId, 'queued reply', {
  threadId: 'thread-1',
  turnId: 'turn-queued',
}));
assert.strictEqual(queuedOutput.latency_trace.client_message_id, 'queued-send');

const ambiguousA = register(engine, {
  sessionId,
  clientMessageId: 'no-output-a',
  content: 'no output request',
});
const ambiguousB = register(engine, {
  sessionId,
  clientMessageId: 'normal-after-no-output',
  content: 'normal request',
});
deliver(engine, ambiguousA.clientMessageId);
deliver(engine, ambiguousB.clientMessageId);
engine._attachFirstOutputLatencyTrace({
  type: 'proxy_message',
  session_id: sessionId,
  role: 'user',
  content: 'no output request',
});
engine._attachFirstOutputLatencyTrace({
  type: 'proxy_message',
  session_id: sessionId,
  role: 'user',
  content: 'normal request',
});
const ambiguousAssistant = engine._attachFirstOutputLatencyTrace({
  type: 'proxy_message',
  session_id: sessionId,
  role: 'assistant',
  content: 'normal reply without native identity',
});
assert.strictEqual(ambiguousAssistant.latency_trace, undefined);
assert.strictEqual(engine._latencyTracesByClientMessageId.has(ambiguousA.clientMessageId), true);
assert.strictEqual(engine._latencyTracesByClientMessageId.has(ambiguousB.clientMessageId), true);

const stale = register(engine, {
  sessionId,
  clientMessageId: 'expired-send',
  content: 'expired request',
});
deliver(engine, stale.clientMessageId, {
  thread_id: 'thread-1',
  turn_id: 'turn-expired',
  observed_at: new Date().toISOString(),
});
stale.registeredAtMs = Date.now() - (6 * 60 * 1000);
const staleOutput = engine._attachFirstOutputLatencyTrace(assistant(sessionId, 'stale reply', {
  threadId: 'thread-1',
  turnId: 'turn-expired',
}));
assert.strictEqual(staleOutput.latency_trace, undefined);
assert.strictEqual(engine._latencyTracesByClientMessageId.has(stale.clientMessageId), false);

const aliasSessionId = 'causal-alias-session';
const canonicalSessionId = 'causal-canonical-session';
const alias = register(engine, {
  sessionId: aliasSessionId,
  clientMessageId: 'alias-send',
  content: 'alias request',
});
deliver(engine, alias.clientMessageId, {
  thread_id: 'thread-alias',
  turn_id: 'turn-alias',
  observed_at: new Date().toISOString(),
});
assert.strictEqual(engine._moveSendLatencyTracesSession(aliasSessionId, canonicalSessionId), 1);
const aliasOutput = engine._attachFirstOutputLatencyTrace(assistant(canonicalSessionId, 'alias reply', {
  threadId: 'thread-alias',
  turnId: 'turn-alias',
}));
assert.strictEqual(aliasOutput.latency_trace.client_message_id, alias.clientMessageId);
assert.strictEqual(alias.sessionId, canonicalSessionId);

for (const entry of [ambiguousA, ambiguousB]) {
  entry.registeredAtMs = Date.now() - (6 * 60 * 1000);
}
assert.strictEqual(engine._expireSendLatencyTraces(), 2);
assert.strictEqual(engine._expireSendLatencyTraces(), 0);

const terminalMessages = [...engine.sent, ...processOnlyEngine.sent]
  .filter(message => message.type === 'latency_trace_terminal');
const terminalTraceIds = terminalMessages.map(message => message.latency_trace_terminal.trace_id);
assert.strictEqual(new Set(terminalTraceIds).size, terminalTraceIds.length);
assert(terminalMessages.some(message => (
  message.latency_trace_terminal.client_message_id === 'expired-send'
  && message.latency_trace_terminal.reason === 'expired_no_output'
)));
assert.strictEqual(terminalMessages.filter(message => (
  message.latency_trace_terminal.reason === 'causal_identity_ambiguous'
)).length, 3);
assert.strictEqual(engine._latencyTracesByClientMessageId.size, 0);
assert.strictEqual(engine._latencyTraceClientIdsBySession.size, 0);
assert.strictEqual(processOnlyEngine._latencyTracesByClientMessageId.size, 0);
assert.strictEqual(processOnlyEngine._latencyTraceClientIdsBySession.size, 0);

console.log(JSON.stringify({
  result: 'PASS',
  reversed_outputs_bound_to_exact_turn: true,
  queued_output_before_delivery_rejected: true,
  no_output_then_normal_without_identity_cross_attachments: 0,
  stale_output_attachments: 0,
  alias_migration_preserved_trace: true,
  measured_traces: 4,
  terminal_traces: terminalMessages.length,
  terminal_trace_ids_unique: true,
  process_only_without_turn: 'terminal_unmeasured',
  unresolved_first_output_replacement: 'rejected',
  open_traces: engine._latencyTracesByClientMessageId.size
    + processOnlyEngine._latencyTracesByClientMessageId.size,
}, null, 2));

fs.rmSync(tempRoot, { recursive: true, force: true });
