#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { parseArgs, selectThinkingFrame } = require('./cursor-cli-native-thinking-e2e');

assert.throws(() => parseArgs([]), /--send-live/, 'live-send consent must fail closed');
assert.throws(() => parseArgs([
  '--send-live', '--workspace', 'C:/temp/not-owned',
  '--screenshot', 'evidence/a.png', '--result-file', 'evidence/a.json',
]), /restricted/, 'workspace guard must fail closed');
assert.throws(() => parseArgs([
  '--send-live', '--workspace', 'C:/temp/cursor-test',
  '--model', 'bad model', '--screenshot', 'evidence/a.png', '--result-file', 'evidence/a.json',
]), /unsupported/, 'model argument must reject shell-like input');

const options = parseArgs([
  '--send-live', '--workspace', 'C:/temp/cursor-test',
  '--screenshot', 'evidence/harness-maturity/test.png',
  '--result-file', 'evidence/harness-maturity/test.json',
]);
assert.equal(options.workspace.toLowerCase(), path.resolve('C:/temp/cursor-test').toLowerCase());
assert.equal(options.model, 'cursor-grok-4.5-medium-fast');
assert.equal(selectThinkingFrame([{ plain: 'idle' }]), null);
assert.equal(selectThinkingFrame([
  { plain: 'Thinking...', id: 1 },
  { plain: 'Generating answer', id: 2 },
  { plain: 'done', id: 3 },
]).id, 2, 'middle active frame should be selected');

console.log('PASS Cursor CLI native thinking E2E guard contract');
