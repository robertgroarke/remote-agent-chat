#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  hasSubmittedUserTurn,
  isReadyFrame,
  isThinkingFrame,
  parseArgs,
  recentUniqueFrameTails,
} = require('./claude-cli-native-conversation-e2e');

assert.throws(() => parseArgs([]), /--send-live/, 'live-send consent must fail closed');
assert.throws(() => parseArgs([
  '--send-live', '--workspace', 'C:/temp/not-owned',
  '--thinking-screenshot', 'evidence/a.png',
  '--markdown-screenshot', 'evidence/b.png',
  '--result-file', 'evidence/c.json',
]), /restricted/, 'workspace guard must fail closed');

const options = parseArgs([
  '--send-live', '--workspace', 'C:/temp/remote-agent-claude-cli-native-replace-test',
  '--thinking-screenshot', 'evidence/harness-maturity/test-thinking.png',
  '--markdown-screenshot', 'evidence/harness-maturity/test-markdown.png',
  '--result-file', 'evidence/harness-maturity/test-result.json',
]);
assert.equal(options.workspace.toLowerCase(),
  path.resolve('C:/temp/remote-agent-claude-cli-native-replace-test').toLowerCase());

const marker = 'RAC_CLAUDE_NATIVE_1234ABCD';
assert(isReadyFrame({ plain: 'Claude Code v2.1.207\nTips for getting started\n❯\u00a0Try "fix tests"' }));
assert(!isReadyFrame({ plain: 'Claude Code v2.1.207\nloading' }));
assert(isThinkingFrame({ plain: `❯ prompt ${marker}\n✻ Hatching… (esc to interrupt)` }, marker));
assert(!isThinkingFrame({ plain: `❯ prompt ${marker}\n✻ Hatching…` }, marker));
assert.deepEqual(recentUniqueFrameTails([
  { elapsed_ms: 1, plain: 'same' },
  { elapsed_ms: 2, plain: 'same' },
  { elapsed_ms: 3, plain: 'changed' },
]), [
  { elapsed_ms: 1, sha256: '0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5', tail: 'same' },
  { elapsed_ms: 3, sha256: 'd67e2e944994496c8d8ec76eed0cf9f09679448d584b532bebf941852a37f5ed', tail: 'changed' },
]);
assert.equal(hasSubmittedUserTurn('C:/definitely/missing/archive.jsonl', marker), false);

console.log('PASS Claude CLI native conversation E2E guard contract');
