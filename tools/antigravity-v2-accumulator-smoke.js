#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const engine = Object.create(ProxyEngine.prototype);

function assistant(label, thinking, markdown = 'RAC_V2_ACCUMULATOR_SMOKE') {
  return {
    role: 'assistant',
    content: `${thinking}\n\n${markdown}`,
    content_blocks: [
      { type: 'thinking', label, title: label, content: thinking, collapsed: false },
      { type: 'markdown', content: markdown },
    ],
  };
}

const streaming = assistant('Thinking.', 'Same settled thinking content.');
const settled = assistant('Thought for 1s', 'Same settled thinking content.');

assert.strictEqual(
  engine._shouldReplaceAccumulatedMessage('antigravity-v2', streaming, settled),
  true,
  'Antigravity v2 equal-text label finalization must replace the accumulated message',
);
assert.strictEqual(
  engine._shouldReplaceAccumulatedMessage('antigravity-v2', settled, settled),
  false,
  'An identical Antigravity v2 message must not churn the accumulator',
);
assert.strictEqual(
  engine._shouldReplaceAccumulatedMessage('codex-desktop', streaming, settled),
  false,
  'The structural replacement exception must remain scoped to Antigravity v2',
);
assert.strictEqual(
  engine._shouldReplaceAccumulatedMessage('antigravity-v2', settled, assistant('Thinking.', 'Short')),
  false,
  'A shorter Antigravity v2 observation must not overwrite a longer accumulated message',
);
assert.strictEqual(
  engine._shouldReplaceAccumulatedMessage('antigravity-v2', streaming, assistant('Thinking.', 'Same settled thinking content plus more.')),
  true,
  'Growing Antigravity v2 content must still replace the accumulated message',
);

console.log('antigravity v2 accumulator smoke: PASS');
