#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { canonicalizeClaudeMessageBlocks } = require('../agent-proxy/selectors');

const input = JSON.stringify([
  { role: 'user', content: 'Keep user turns plain.' },
  { role: 'assistant', content: 'Canonical assistant answer.' },
  {
    role: 'assistant',
    content: 'Structured answer.',
    content_blocks: [{ type: 'thinking', title: 'Thinking', content: 'Already structured.' }],
  },
  { role: 'assistant', content: '' },
]);
const messages = JSON.parse(canonicalizeClaudeMessageBlocks(input));

assert.strictEqual(messages[0].content_blocks, undefined, 'user turns must remain untyped');
assert.deepStrictEqual(messages[1].content_blocks, [{
  type: 'markdown',
  content: 'Canonical assistant answer.',
}]);
assert.deepStrictEqual(messages[2].content_blocks, [{
  type: 'thinking',
  title: 'Thinking',
  content: 'Already structured.',
}], 'existing structured blocks must remain byte-for-byte semantic equivalents');
assert.strictEqual(messages[3].content_blocks, undefined, 'empty assistant rows must remain empty');
assert.strictEqual(canonicalizeClaudeMessageBlocks('not json'), 'not json');

console.log(JSON.stringify({
  ok: true,
  plain_assistant_markdown_typed: true,
  user_untouched: true,
  structured_blocks_preserved: true,
  malformed_input_preserved: true,
}, null, 2));
