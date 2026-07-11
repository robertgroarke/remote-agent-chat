#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { normalizeMessages } = require('./run-fidelity-regression');

function terminalMessage(stdout) {
  return [{
    role: 'assistant',
    content_blocks: [{
      type: 'terminal',
      command: 'commands',
      stdout,
    }],
  }];
}

const early = normalizeMessages(terminalMessage(
  'Running command for 4m 16s\nRan node tools/codex-desktop-validate-all.js',
));
const late = normalizeMessages(terminalMessage(
  'Running command for 6m 59s\nRan node tools/codex-desktop-validate-all.js',
));
assert.deepEqual(early, late,
  'active command elapsed labels must not create a false transcript mismatch');

const nativeCompact = normalizeMessages(terminalMessage('Running command 32s\nGet-Content proxy.log'));
const relayCompact = normalizeMessages(terminalMessage('Running command 27s\nGet-Content proxy.log'));
assert.deepEqual(nativeCompact, relayCompact,
  'compact active command elapsed labels must not create a false transcript mismatch');

const nativeAdjacent = normalizeMessages(terminalMessage(
  'Running command for 6m 49sRunning command for 6m 49sRan rg -n "fidelity" tools',
));
const relayAdjacent = normalizeMessages(terminalMessage(
  'Running command for 6m 16sRunning command for 6m 16sRan rg -n "fidelity" tools',
));
assert.deepEqual(nativeAdjacent, relayAdjacent,
  'concatenated duplicate active timers must normalize without requiring whitespace');

const completed31 = normalizeMessages(terminalMessage('Ran validation for 31s'));
const completed32 = normalizeMessages(terminalMessage('Ran validation for 32s'));
assert.notDeepEqual(completed31, completed32,
  'completed command durations remain fidelity-significant');

console.log('Codex fidelity normalization smoke: PASS');
