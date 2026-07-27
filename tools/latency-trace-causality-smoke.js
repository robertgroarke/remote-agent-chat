#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  bindDeliveryReceipt,
  bindNativeUser,
  canonicalAssistantForEntry,
  contentSha256,
  selectCausalEntry,
} = require('../agent-proxy/latency-trace-causality');

function entry(id, content, {
  delivered = true,
  turnId = null,
  sessionId = 'native-session',
  processEpoch = null,
  cursor = null,
} = {}) {
  const value = {
    clientMessageId: id,
    contentSha256: contentSha256(content),
    delivered,
    completed: false,
  };
  if (turnId || processEpoch || cursor) {
    bindDeliveryReceipt(value, {
      session_id: sessionId,
      ...(turnId ? { turn_id: turnId } : {}),
      ...(processEpoch ? { process_epoch: processEpoch } : {}),
      ...(cursor ? { source_cursor: cursor } : {}),
    });
  }
  return value;
}

function shuffled(values, random) {
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const reversed = [
  entry('client-a', 'request A', { turnId: 'turn-a' }),
  entry('client-b', 'request B', { turnId: 'turn-b' }),
];
const outputB = selectCausalEntry(reversed, {
  role: 'assistant',
  content: 'reply B',
  native_turn_id: 'turn-b',
  native_session_id: 'native-session',
}, 10);
const outputA = selectCausalEntry(reversed, {
  role: 'assistant',
  content: 'reply A',
  native_turn_id: 'turn-a',
  native_session_id: 'native-session',
}, 11);
assert.strictEqual(outputB.entry.clientMessageId, 'client-b');
assert.strictEqual(outputA.entry.clientMessageId, 'client-a');

const ambiguousNoOutput = [
  entry('no-output-a', 'command A'),
  entry('normal-b', 'command B'),
];
assert(bindNativeUser(ambiguousNoOutput, {
  role: 'user',
  content: 'command A',
}, 1).ok);
assert(bindNativeUser(ambiguousNoOutput, {
  role: 'user',
  content: 'command B',
}, 2).ok);
const ambiguousOutput = selectCausalEntry(ambiguousNoOutput, {
  role: 'assistant',
  content: 'normal reply',
}, 3);
assert.strictEqual(ambiguousOutput.ok, false);
assert.strictEqual(ambiguousOutput.code, 'causal_identity_missing');

const cursorBound = [
  entry('cursor-a', 'cursor request A'),
  entry('cursor-b', 'cursor request B'),
];
assert(bindNativeUser(cursorBound, {
  role: 'user',
  content: 'cursor request A',
  source_cursor: { generation: 'g1', message_index: 4 },
}, 1).ok);
assert(bindNativeUser(cursorBound, {
  role: 'user',
  content: 'cursor request B',
  source_cursor: { generation: 'g1', message_index: 5 },
}, 2).ok);
const cursorOutput = selectCausalEntry(cursorBound, {
  role: 'assistant',
  content: 'cursor reply B',
  source_cursor: { generation: 'g1', message_index: 6 },
}, 3);
assert.strictEqual(cursorOutput.ok, true);
assert.strictEqual(cursorOutput.entry.clientMessageId, 'cursor-b');
assert.strictEqual(cursorOutput.match, 'source_cursor');

const queued = [
  entry('queued', 'queued request', { delivered: false, turnId: 'queued-turn' }),
];
assert.strictEqual(selectCausalEntry(queued, {
  role: 'assistant',
  content: 'early unrelated output',
  native_turn_id: 'queued-turn',
}, 1).code, 'no_delivered_trace');
queued[0].delivered = true;
assert.strictEqual(selectCausalEntry(queued, {
  role: 'assistant',
  content: 'queued reply',
  native_turn_id: 'queued-turn',
}, 2).entry, queued[0]);

const canonical = entry('canonical', 'measured request', { turnId: 'turn-canonical' });
const recovered = canonicalAssistantForEntry(canonical, [
  { role: 'assistant', content: 'stale assistant', native_turn_id: 'old-turn' },
  { role: 'user', content: 'measured request', native_turn_id: 'turn-canonical' },
  { role: 'assistant', content: 'measured reply', native_turn_id: 'turn-canonical' },
], 'generation-7');
assert.strictEqual(recovered.ok, true);
assert.strictEqual(recovered.assistant.content, 'measured reply');
assert.strictEqual(recovered.user_index, 1);
assert.strictEqual(recovered.assistant_index, 2);
assert.strictEqual(canonicalAssistantForEntry(canonical, [
  { role: 'user', content: 'measured request' },
  { role: 'assistant', content: 'first possible reply' },
  { role: 'user', content: 'measured request' },
  { role: 'assistant', content: 'second possible reply' },
]).code, 'canonical_user_ambiguous');
assert.strictEqual(canonicalAssistantForEntry(canonical, [
  { role: 'user', content: 'measured request' },
  { role: 'user', content: 'next request' },
  { role: 'assistant', content: 'reply to next request' },
]).code, 'canonical_no_output_before_next_user');

const agentTypes = [
  'antigravity',
  'antigravity_panel',
  'antigravity-v2',
  'claude',
  'claude-desktop',
  'claude_cli',
  'cline',
  'codex',
  'codex-desktop',
  'codex_cli',
  'continue',
  'continue_yolo',
  'cursor',
  'cursor_cli',
  'gemini',
  'roo_code',
];
let randomizedOutputs = 0;
let crossTurnAttachments = 0;
const random = seededRandom(0x50333);
for (let ordering = 0; ordering < 10_000; ordering += 1) {
  const agentType = agentTypes[ordering % agentTypes.length];
  const count = 2 + (ordering % 7);
  const entries = [];
  const outputs = [];
  for (let index = 0; index < count; index += 1) {
    const turnId = `${agentType}-turn-${ordering}-${index}`;
    entries.push(entry(
      `${agentType}-client-${ordering}-${index}`,
      `${agentType} request ${ordering}/${index}`,
      { turnId, sessionId: `${agentType}-session-${ordering}` },
    ));
    outputs.push({
      role: 'assistant',
      content: `${agentType} reply ${ordering}/${index}`,
      native_turn_id: turnId,
      native_session_id: `${agentType}-session-${ordering}`,
      expectedClientMessageId: `${agentType}-client-${ordering}-${index}`,
    });
  }
  const replayed = shuffled(outputs, random);
  replayed.forEach((output, index) => {
    const selected = selectCausalEntry(entries, output, index + 1);
    if (!selected.ok || selected.entry.clientMessageId !== output.expectedClientMessageId) {
      crossTurnAttachments += 1;
    }
    randomizedOutputs += 1;
  });
}
assert.strictEqual(crossTurnAttachments, 0);

console.log(JSON.stringify({
  result: 'PASS',
  randomized_orderings: 10_000,
  randomized_outputs: randomizedOutputs,
  harness_families: agentTypes,
  cross_turn_attachments: crossTurnAttachments,
  overlapping_reversed_outputs: 'exact_turn_bound',
  no_output_then_normal_without_identity: 'unmeasured_ambiguous',
  cursor_boundary_selection: 'latest_preceding_user',
  stale_history_replay: 'matching_user_then_assistant_only',
  queued_before_delivery: 'rejected',
  privacy_fields: ['content_sha256', 'native_session_id', 'native_turn_id', 'process_epoch', 'source_cursor'],
}, null, 2));
