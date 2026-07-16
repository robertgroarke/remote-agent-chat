#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/cursor-selectors');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

assert.equal(selectors.classifyCursorCollapsibleHeader('Edited 6 files +124 -7'), 'file_changes');
assert.equal(selectors.classifyCursorCollapsibleHeader('Edited 1 file +1 -0'), 'file_changes');
assert.equal(selectors.classifyCursorCollapsibleHeader('Editing 6 files'), 'tool_call');
assert.equal(selectors.classifyCursorCollapsibleHeader('Explored 1 file, 1 search'), 'tool_call');
assert.equal(selectors.classifyCursorCollapsibleHeader('Worked for 1s'), 'status');
assert.equal(selectors.classifyCursorCollapsibleHeader('Thinking'), 'thinking');

const app = read('frontend/app.jsx');
const css = read('frontend/styles.css');
const android = read('android-app/components/MessageBubble.jsx');
const visual = read('tools/visual-regression.js');

assert.match(app, /isCursorSummaryOnly[\s\S]*?content-block-file-change-cursor-summary/);
assert.match(app, /!Array\.isArray\(block\.files\) \|\| block\.files\.length === 0/);
assert.match(app, /!Array\.isArray\(block\.actions\) \|\| block\.actions\.length === 0/);
assert.match(css, /\.content-block-file-change-cursor-summary \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
assert.match(css, /\.content-block-file-change-cursor-summary \.content-block-add \{[\s\S]*?color: #2a9d6f;/);
assert.match(css, /\.content-block-file-change-cursor-summary \.content-block-del \{[\s\S]*?color: #e5484d;/);
assert.match(android, /case 'file_changes':[\s\S]*?nativeCursorFileChangeSummary[\s\S]*?renderCursorFileChangeSummary/);
assert.match(android, /nativeCursorFileChangeSummary: normalizedAgent === 'cursor'/);
assert.match(android, /function isCursorFileChangeSummaryOnly\([\s\S]*?block\.files[\s\S]*?block\.actions/);
assert.match(visual, /agent === 'cursor' && theme === 'light'[\s\S]*?Edited 6 files[\s\S]*?\+124[\s\S]*?-7/);

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  parser: {
    completed_edit_summary: 'file_changes',
    in_progress_edit: 'tool_call',
    exploration: 'tool_call',
    worked: 'status',
    thinking: 'thinking',
  },
  web: 'flat_summary_only_with_colored_stats',
  android: 'flat_summary_only_with_colored_stats',
  detailed_diff_cards_preserved: true,
  cursor_light_visual_fixture: 'Edited 6 files +124 -7',
};

const rendered = `${JSON.stringify(result, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  assert(outputPath, '--output requires a path');
  const resolvedOutput = path.resolve(ROOT, outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, rendered, 'utf8');
}
process.stdout.write(rendered);
