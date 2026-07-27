#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  historyRowsMatch,
  buildAppendOnlyHistoryPlan,
  buildIncrementalHistoryPlan,
} = require('../relay-server/history-sync-policy');

const history = Array.from({ length: 4184 }, (_, index) => ({
  id: index + 1,
  role: index % 2 ? 'assistant' : 'user',
  content: `message-${index + 1}`,
  ts: 1700000000 + index,
}));
const tail = history.slice(-50);
const growth = [...history, { id: 4185, role: 'assistant', content: 'message-4185', ts: 1700004184 }];
const plan = buildAppendOnlyHistoryPlan(history.length, tail, growth);
assert(plan, 'append-only history growth should produce a plan');
assert.equal(plan.existing_count, history.length);
assert.equal(plan.append_rows.length, 1);
assert.equal(plan.append_rows[0].content, 'message-4185');

const changedPrefix = growth.map(row => ({ ...row }));
changedPrefix[history.length - 10].content = 'mutated-old-row';
assert.equal(buildAppendOnlyHistoryPlan(history.length, tail, changedPrefix), null);
assert.equal(buildAppendOnlyHistoryPlan(history.length, tail, history.slice(0, -1)), null);
assert(historyRowsMatch(tail, history.slice(-50)));
assert.strictEqual(historyRowsMatch(
  [{ role: 'assistant', content: 'same', source_message_id: 'source:1' }],
  [{ role: 'assistant', content: 'same', source_message_id: 'source:2' }],
), false, 'stable source identity must distinguish identical semantic content rows');
assert.strictEqual(historyRowsMatch(
  [{ role: 'assistant', content: 'same', source_message_id: 'source:1', ts: 1783962002 }],
  [{ role: 'assistant', content: 'same', source_message_id: 'source:1', ts: 1783962002.375 }],
), false, 'fractional producer timestamp changes must trigger metadata reconciliation');
assert.strictEqual(historyRowsMatch(
  [{ role: 'assistant', content: 'same', source_message_id: 'source:1', ts: 1783962002.375, source: 'codex_cli_jsonl' }],
  [{ role: 'assistant', content: 'same', source_message_id: 'source:1', ts: 1783962002.375, source: 'codex_cli_jsonl' }],
), true, 'identical source identity, timestamp, and producer must remain idempotent');

const changedTail = history.map(row => ({ ...row }));
changedTail[changedTail.length - 1].content = 'updated-live-tail';
const suffixPlan = buildIncrementalHistoryPlan(history.length, tail, changedTail);
assert.equal(suffixPlan.mode, 'replace_suffix');
assert.equal(suffixPlan.prefix_count, history.length - 1);
assert.equal(suffixPlan.delete_from_id, history.length);
assert.equal(suffixPlan.rows.length, 1);
const ambiguousTail = history.map(row => ({ ...row }));
ambiguousTail[ambiguousTail.length - 50].content = 'changed-before-sampled-prefix';
assert.equal(buildIncrementalHistoryPlan(history.length, tail, ambiguousTail), null);

const citationStableId = 'codex_cli_pair:memory-citation-fixture';
const citationExisting = [
  { id: 1, role: 'user', content: 'prefix', source_message_id: 'prefix-source' },
  {
    id: 2,
    role: 'assistant',
    content: 'One canonical answer.',
    source_message_id: citationStableId,
    content_blocks: [{ type: 'markdown', content: 'One canonical answer.' }],
  },
];
const citationIncoming = [
  { role: 'user', content: 'prefix', source_message_id: 'prefix-source' },
  {
    role: 'assistant',
    content: 'One canonical answer.',
    source_message_id: citationStableId,
    content_blocks: [
      { type: 'markdown', content: 'One canonical answer.' },
      { type: 'memory_citation', title: 'Sources', content: 'Memory references\n- MEMORY.md:10-11' },
    ],
  },
];
const citationPlan = buildIncrementalHistoryPlan(2, citationExisting, citationIncoming);
assert.strictEqual(citationPlan.mode, 'replace_suffix');
assert.strictEqual(citationPlan.prefix_count, 1);
assert.strictEqual(citationPlan.delete_from_id, 2);
assert.strictEqual(citationPlan.rows.length, 1, 'citation enrichment must replace one stable-ID row, not append a duplicate');
assert.strictEqual(citationPlan.rows[0].content_blocks.filter(block => block.type === 'memory_citation').length, 1);
assert.strictEqual(
  historyRowsMatch(citationIncoming, citationExisting),
  true,
  'a delayed provisional replay must not regress an already enriched stable-ID row',
);

const relaySource = fs.readFileSync(path.join(__dirname, '..', 'relay-server', 'index.js'), 'utf8');
assert(relaySource.includes('getIncrementalHistoryPlan(id, messages, existingLength)'));
assert(relaySource.includes('incrementalPlan.rows'));
assert(relaySource.includes('stmtDeleteSessionSuffix.run'));

console.log('history sync policy smoke: PASS (4184-row growth/tail edits write one suffix row)');
