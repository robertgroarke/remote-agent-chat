#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const inventory = require('./production-block-inventory');

assert.throws(() => inventory.parseArgs([]), /pass --read-only explicitly/);
assert.deepStrictEqual(inventory.parseArgs(['--read-only']), { readOnly: true, resultFile: '' });

const selected = inventory.pickSession([
  { session_id: 'old-connected', agent_type: 'claude', status: 'healthy', created_at: '2026-07-11T00:00:00Z', last_seen_at: '2026-07-13T00:00:00Z' },
  { session_id: 'new-disconnected', agent_type: 'claude', status: 'disconnected', created_at: '2026-07-13T00:00:00Z', last_seen_at: '2026-07-13T00:00:00Z' },
  { session_id: 'new-connected', agent_type: 'claude', status: 'healthy', created_at: '2026-07-12T00:00:00Z', last_seen_at: '2026-07-12T00:00:00Z' },
  { session_id: 'list-view', agent_type: 'claude', status: 'healthy', created_at: '2026-07-14T00:00:00Z', last_seen_at: '2026-07-14T00:00:00Z', is_list_view: true },
], 'claude');
assert.strictEqual(selected.session_id, 'new-connected');

const historySelected = inventory.pickHistoryCandidate('claude_cli', [{
  session: { session_id: 'new-empty', agent_type: 'claude_cli', status: 'healthy' },
  history: { total_messages: 0, messages: [] },
}, {
  session: { session_id: 'older-current', agent_type: 'claude_cli', status: 'healthy' },
  history: { total_messages: 2, messages: [
    { role: 'user', content: 'question', ts: 1783785000 },
    { role: 'assistant', content: 'typed answer', ts: 1783785300, content_blocks: [{ type: 'markdown', content: 'typed answer' }] },
  ] },
}]);
assert.strictEqual(historySelected.session.session_id, 'older-current');

const summary = inventory.summarizeHistory('claude', selected, {
  total_messages: 4,
  messages: [
    { role: 'user', content: 'question', ts: 1783785000 },
    { role: 'assistant', content: 'plain answer', ts: 1783785122 },
    { role: 'assistant', content: 'thought', ts: 1783785200, content_blocks: [{ type: 'thinking', content: 'thought' }] },
    { role: 'assistant', content: 'result', ts: 1783785300, content_blocks: [{ type: 'tool_result', content: 'done' }] },
  ],
});
assert.deepStrictEqual(summary.observed_types, ['thinking', 'tool_result']);
assert.deepStrictEqual(summary.block_counts, { thinking: 1, tool_result: 1 });
assert.strictEqual(summary.structured_messages, 2);
assert.strictEqual(summary.plain_assistant_messages, 1);
assert.strictEqual(summary.latest_plain_assistant_at, '2026-07-11T15:52:02.000Z');
assert.deepStrictEqual(summary.latest_assistant, {
  at: '2026-07-11T15:55:00.000Z',
  typed: true,
  block_types: ['tool_result'],
});
assert.deepStrictEqual(summary.unknown_types, []);

const validatorSource = fs.readFileSync(path.join(__dirname, 'production-block-inventory-validate-all.js'), 'utf8');
assert(validatorSource.includes("'structured-producer-coverage-smoke.js'"));
assert(validatorSource.includes("'--inventory', inventoryPath"));

console.log(JSON.stringify({
  ok: true,
  read_only_required: true,
  connected_session_preferred: true,
  store_backed_history_relevance_preferred: true,
  immutable_creation_order_preferred: true,
  list_view_rejected: true,
  canonical_counts_preserved: true,
  legacy_plain_history_distinguished: true,
  fresh_inventory_coverage_gate: true,
}, null, 2));
