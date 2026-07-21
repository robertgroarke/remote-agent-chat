#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  ProxyEngine,
  CLAUDE_EXTENSION_OBSERVED_SOURCE,
} = require('../agent-proxy/proxy-engine');

const SESSION_ID = 'claude-extension-timestamp-fixture';
const FIRST_OBSERVED_MS = Date.parse('2026-07-20T20:00:00.000Z');
const engine = Object.create(ProxyEngine.prototype);

const initial = engine._prepareClaudeMessageObservations(SESSION_ID, [
  { role: 'user', content: 'Inspect the current tree.' },
  { role: 'assistant', content: 'I am inspecting it now.' },
], { observedAtMs: FIRST_OBSERVED_MS });

assert.strictEqual(initial.newlyObserved, 2);
assert.strictEqual(initial.changed, true);
assert.strictEqual(new Set(initial.messages.map(message => message.source_message_id)).size, 2);
assert(initial.messages.every(message => message.source === CLAUDE_EXTENSION_OBSERVED_SOURCE));
assert(initial.messages.every(message => message.ts === FIRST_OBSERVED_MS / 1000));
assert(initial.messages.every(message => Date.parse(message.created_at) === FIRST_OBSERVED_MS));

const assistantIdentity = initial.messages[1].source_message_id;
const assistantTimestamp = initial.messages[1].ts;
const grownAssistant = engine._preserveObservedTimestampMetadata(initial.messages[1], {
  role: 'assistant',
  content: 'I am inspecting it now. The relevant tests are next.',
});
assert.strictEqual(grownAssistant.source_message_id, assistantIdentity);
assert.strictEqual(grownAssistant.ts, assistantTimestamp);

const replay = engine._prepareClaudeMessageObservations(SESSION_ID, [
  initial.messages[0],
  grownAssistant,
], {
  sequence: initial.sequence,
  observedAtMs: FIRST_OBSERVED_MS + 60_000,
});
assert.strictEqual(replay.changed, false);
assert.strictEqual(replay.newlyObserved, 0);
assert.strictEqual(replay.messages[1].source_message_id, assistantIdentity);
assert.strictEqual(replay.messages[1].ts, assistantTimestamp,
  're-poll must not refresh the first-observed timestamp');

const persisted = JSON.parse(JSON.stringify(replay.messages));
const restartedEngine = Object.create(ProxyEngine.prototype);
const restarted = restartedEngine._prepareClaudeMessageObservations(SESSION_ID, persisted, {
  observedAtMs: FIRST_OBSERVED_MS + 120_000,
});
assert.strictEqual(restarted.changed, false);
assert.strictEqual(restarted.newlyObserved, 0);
assert.strictEqual(restarted.messages[1].source_message_id, assistantIdentity);
assert.strictEqual(restarted.messages[1].ts, assistantTimestamp,
  'proxy restart must retain the persisted timestamp');

const appended = restartedEngine._prepareClaudeMessageObservations(SESSION_ID, [
  ...restarted.messages,
  { role: 'assistant', content: 'Validation is complete.' },
], {
  sequence: restarted.sequence,
  observedAtMs: FIRST_OBSERVED_MS + 180_000,
});
assert.strictEqual(appended.newlyObserved, 1);
assert(appended.messages[2].ts >= appended.messages[1].ts,
  'observed timestamps must remain non-decreasing');

console.log(JSON.stringify({
  status: 'PASS',
  source: CLAUDE_EXTENSION_OBSERVED_SOURCE,
  populated_rows: appended.messages.length,
  stable_repolls: true,
  stable_stream_growth: true,
  stable_proxy_restart: true,
  non_decreasing: true,
  native_dom_timestamp_identity_available: false,
}, null, 2));
