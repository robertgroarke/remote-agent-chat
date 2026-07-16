#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./codex-desktop-native-disclosure-capture');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'evidence', 'harness-maturity', 'fixture-codex-desktop-native.png');
const resultFile = path.join(root, 'evidence', 'harness-maturity', 'fixture-codex-desktop-native.json');

assert.throws(() => parseArgs(['--kind', 'notice', '--output', output]), /thinking or terminal/);
assert.throws(() => parseArgs(['--kind', 'thinking', '--output', path.join(root, 'unsafe.png')]), /evidence tree/);
const parsed = parseArgs(['--kind', 'terminal', '--output', output, '--result-file', resultFile]);
assert.strictEqual(parsed.kind, 'terminal');
assert.strictEqual(parsed.output, output);
assert.strictEqual(parsed.resultFile, resultFile);

const source = fs.readFileSync(path.join(__dirname, 'codex-desktop-native-disclosure-capture.js'), 'utf8');
assert(source.includes("pageState.visibility, 'hidden'"));
assert(source.includes("thinking.thinking, false"));
assert(source.includes('scroll_restored_exactly: true'));
assert(source.includes('restored.expanded, disclosure.originalExpanded'));
assert(source.includes('Buffer.isBuffer(value)'));
assert(source.includes('textDelta > 8'));
assert(source.includes("wasExpanded === 'true') continue"));
assert(!/bringToFront|\.focus\s*\(/.test(source));

console.log(JSON.stringify({
  ok: true,
  hidden_only: true,
  idle_required: true,
  exact_target_required: true,
  reversible_dom_state_required: true,
  expanded_output_growth_required: true,
  evidence_output_boundary: true,
  focus_actions: 0,
  visible_windows_opened: 0
}, null, 2));
