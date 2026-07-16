#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { expandCodexMessagesRaw } = require('../agent-proxy/selectors');

const messages = JSON.parse(expandCodexMessagesRaw(JSON.stringify([
  { role: 'user', content: 'You stopped after 2s' },
  { role: 'assistant', content: 'Partial answer.\n\nYou stopped after 2s' },
  { role: 'assistant', content: 'Interrupted' },
  { role: 'assistant', content: 'The runner stopped after the expected validation gate.' },
  { role: 'assistant', content: '--- Context automatically compacted ---' },
  { role: 'assistant', content: 'Context automatically compacted' },
  { role: 'assistant', content: 'The context automatically compacted after the test.' },
]), { structuredBlocks: true }));

assert.strictEqual(messages[0].content_blocks, undefined, 'user text must remain untyped');
assert.deepStrictEqual(messages[1].content_blocks.map(block => block.type), ['markdown', 'status']);
assert.deepStrictEqual(messages[1].content_blocks[1], {
  type: 'status',
  label: 'You stopped after 2s',
  content: 'You stopped after 2s',
  status: 'stopped',
});
assert.deepStrictEqual(messages[2].content_blocks.map(block => block.type), ['status']);
assert.deepStrictEqual(messages[3].content_blocks.map(block => block.type), ['markdown'],
  'ordinary prose containing stopped must remain Markdown');
assert.deepStrictEqual(messages[4].content_blocks, [{
  type: 'notice',
  label: 'Context compacted',
  content: '--- Context automatically compacted ---',
  tone: 'info',
}], 'the native banner must be a notice, never an actionable prompt');
assert.deepStrictEqual(messages[5].content_blocks.map(block => block.type), ['notice'],
  'the unadorned native compaction row must also be a notice');
assert.deepStrictEqual(messages[6].content_blocks.map(block => block.type), ['markdown'],
  'ordinary prose mentioning compaction must remain Markdown');

console.log(JSON.stringify({
  ok: true,
  native_stopped_row_typed: true,
  interrupted_row_typed: true,
  native_compaction_notice_typed: true,
  native_compaction_prompt_emitted: false,
  ordinary_prose_preserved: true,
  user_untouched: true,
}, null, 2));
