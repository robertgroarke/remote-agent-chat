'use strict';

const assert = require('assert');
const {
  INTERRUPTION_SCHEMA_VERSION,
  redactNativeInterruptionText,
  normalizeNativeInterruption,
  resolveNativeInterruption,
  reduceNativeInterruption,
} = require('../shared/native-interruption');
const protocol = require('../agent-proxy/protocol');
const { normalizeActivityTimeline } = require('../relay-server/activity-timeline');
const { resolveSharedRuntimeContract } = require('../relay-server/shared-runtime-contract');
const path = require('path');

assert.strictEqual(
  resolveSharedRuntimeContract('native-interruption.js'),
  path.resolve(__dirname, '..', 'shared', 'native-interruption.js'),
  'relay must resolve the interruption contract from a source checkout',
);
assert.strictEqual(
  resolveSharedRuntimeContract('native-interruption.js', {
    baseDir: '/app',
    existsSync: candidate => candidate === path.resolve('/app', 'shared', 'native-interruption.js'),
  }),
  path.resolve('/app', 'shared', 'native-interruption.js'),
  'relay must resolve the interruption contract from the packaged container layout',
);

const sessionId = 'session-native-interruption';
const turnId = 'turn-native-interruption';
const nativeTimestamp = '2026-07-23T17:55:51.473Z';
const terminalText = 'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)';

const taskComplete = normalizeNativeInterruption({
  session_id: sessionId,
  surface: 'codex_cli',
  native_thread_id: '019f88f2-4d38-7db2-96b7-da6a4f6dc43d',
  turn_id: turnId,
  native_timestamp: nativeTimestamp,
  message: terminalText,
  provider_error_code: 'other',
  source_kind: 'event_msg.task_complete.error',
  source_id: 'event_msg.task_complete:offset:123',
});
const standalone = normalizeNativeInterruption({
  session_id: sessionId,
  surface: 'codex_cli',
  native_thread_id: '019f88f2-4d38-7db2-96b7-da6a4f6dc43d',
  turn_id: turnId,
  native_timestamp: nativeTimestamp,
  message: terminalText,
  provider_error_code: 'other',
  source_kind: 'event_msg.error',
  source_id: 'event_msg.error:offset:456',
});

assert.strictEqual(taskComplete.schema_version, INTERRUPTION_SCHEMA_VERSION);
assert.strictEqual(taskComplete.event_id, standalone.event_id, 'duplicate native representations must share one event id');
assert.strictEqual(taskComplete.category, 'stream_interruption');
assert.strictEqual(taskComplete.code, 'stream_interrupted');
assert.strictEqual(taskComplete.blocking, true);
assert.strictEqual(taskComplete.action_required, true);
assert.strictEqual(taskComplete.retryable, true);
assert.strictEqual(taskComplete.resolution_state, 'unresolved');
assert.notStrictEqual(
  taskComplete.event_id,
  normalizeNativeInterruption({ ...taskComplete, session_id: 'another-session', event_id: null }).event_id,
  'provider outages must remain session scoped',
);

const fallback = normalizeNativeInterruption({
  session_id: sessionId,
  surface: 'codex_cli',
  native_timestamp: nativeTimestamp,
  message: 'Falling back from WebSockets to HTTPS transport: stream disconnected before completion: No such host is known. (os error 11001)',
});
assert.strictEqual(fallback.category, 'dns_offline');
assert.strictEqual(fallback.code, 'network_dns');
assert.strictEqual(fallback.blocking, true);

const redacted = redactNativeInterruptionText(
  'failed C:\\Users\\PrivateName\\repo with token=abc123 and https://user:pass@example.com/path?secret=1',
);
assert(!redacted.includes('PrivateName'));
assert(!redacted.includes('abc123'));
assert(!redacted.includes('user:pass'));
assert(!redacted.includes('secret=1'));
assert(redacted.includes('%USERPROFILE%'));
assert(redacted.includes('https://example.com/path'));

const update = { ...taskComplete, transition_seq: 2, observed_at: '2026-07-23T17:55:52.000Z' };
const resolved = resolveNativeInterruption(update, {
  timestamp: '2026-07-23T18:01:00.000Z',
  resolution_reason: 'later_native_turn_started',
});
assert.strictEqual(resolved.transition_seq, 3);
assert.strictEqual(resolved.resolution_state, 'resolved');
assert.strictEqual(resolved.tombstone, true);

let permutationCount = 0;
let resurrectionRejects = 0;
for (let iteration = 0; iteration < 1000; iteration += 1) {
  const rows = [
    taskComplete,
    { ...taskComplete },
    update,
    { ...update },
    resolved,
    { ...taskComplete, observed_at: '2026-07-23T17:55:50.000Z' },
  ];
  // Deterministic Fisher-Yates variants exercise every arrival position without
  // introducing a nondeterministic test seed.
  let seed = (iteration + 1) * 2654435761;
  for (let index = rows.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swap = seed % (index + 1);
    [rows[index], rows[swap]] = [rows[swap], rows[index]];
  }
  let current = null;
  for (const row of rows) {
    const reduced = reduceNativeInterruption(current, row);
    if (reduced.code === 'rejected_resurrection') resurrectionRejects += 1;
    current = reduced.value;
  }
  assert.strictEqual(current.event_id, taskComplete.event_id);
  assert.strictEqual(current.transition_seq, 3);
  assert.strictEqual(current.resolution_state, 'resolved');
  assert.strictEqual(current.tombstone, true);
  permutationCount += 1;
}
assert.strictEqual(permutationCount, 1000);
assert(resurrectionRejects > 0, 'permutations must exercise stale resurrection rejection');

const contentBlock = {
  type: 'error',
  title: taskComplete.title,
  content: taskComplete.safe_display_text,
  status: 'error',
  interruption: taskComplete,
};
const message = protocol.proxyMessage(sessionId, 'assistant', `[Error]\n\n${terminalText}`, {
  created_at: nativeTimestamp,
  source_message_id: 'codex_cli:stable-interruption',
  content_blocks: [contentBlock],
});
assert.deepStrictEqual(message.message.content_blocks[0].interruption, taskComplete);
assert.strictEqual(message.message.source_message_id, 'codex_cli:stable-interruption');
const history = protocol.historySnapshot(sessionId, [message.message], {
  snapshot_id: 'interruptions',
  source: 'codex_cli_jsonl',
});
assert.deepStrictEqual(history.messages[0].content_blocks[0].interruption, taskComplete);
const status = protocol.proxyStatus(sessionId, 'healthy', {
  kind: 'failed',
  label: taskComplete.title,
  interruption: taskComplete,
  updated_at: nativeTimestamp,
});
assert.deepStrictEqual(status.activity.interruption, taskComplete);
assert.strictEqual(status.activity.kind, 'failed');

const relayUnresolved = normalizeActivityTimeline(status.activity, null, nativeTimestamp);
assert.strictEqual(relayUnresolved.interruption.event_id, taskComplete.event_id);
const relayResolved = normalizeActivityTimeline({
  kind: 'idle',
  label: '',
  updated_at: resolved.resolved_at,
  interruption_tombstone: resolved,
}, relayUnresolved, resolved.resolved_at);
assert.strictEqual(relayResolved.interruption, null);
assert.strictEqual(relayResolved.interruption_tombstone.resolution_state, 'resolved');
const relayStaleReplay = normalizeActivityTimeline({
  kind: 'failed',
  label: taskComplete.title,
  updated_at: nativeTimestamp,
  interruption: taskComplete,
}, relayResolved, resolved.resolved_at);
assert.strictEqual(relayStaleReplay.interruption, null, 'relay must not resurrect a tombstoned interruption');
assert.strictEqual(relayStaleReplay.interruption_tombstone.resolution_state, 'resolved');

console.log(JSON.stringify({
  status: 'pass',
  schema_version: INTERRUPTION_SCHEMA_VERSION,
  permutations: permutationCount,
  resurrection_rejections: resurrectionRejects,
  stable_event_id: taskComplete.event_id,
  protocol_message_count: history.messages.length,
}, null, 2));
