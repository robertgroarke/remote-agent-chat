#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const css = read('frontend/styles.css');
const android = read('android-app/components/MessageBubble.jsx');
const manifest = JSON.parse(read('evidence/harness-maturity/native-golden-approvals.json'));
const cursor = manifest.harnesses.find(row => row.agent === 'cursor');

assert.match(css, /\.harness-theme-cursor \.content-block-notice \{[\s\S]*?border: 1px solid #2d2d30;[\s\S]*?border-left-width: 1px;[\s\S]*?background: #252526;[\s\S]*?padding: 4px 8px 4px 28px;/);
assert.match(css, /\.harness-theme-cursor \.content-block-notice::before \{[\s\S]*?content: "\\24D8";[\s\S]*?color: #75beff;/);
assert.match(css, /\.harness-theme-cursor \.content-block-notice \.content-block-title,[\s\S]*?display: inline;[\s\S]*?font: inherit;/);
assert.match(css, /\.content-block-notice \{[\s\S]*?border-left-color: rgba\(219, 171, 9, 0\.65\);/,
  'shared non-Cursor notice rail must remain intact');

assert.match(android, /case 'notice':[\s\S]*?theme\.nativeInlineNotice[\s\S]*?renderCursorNativeNotice/);
assert.match(android, /function renderCursorNativeNotice\([\s\S]*?accessibilityRole="alert"/);
assert.match(android, /nativeInlineNotice: normalizedAgent === 'cursor'/);
assert.match(android, /cursorNativeNotice:[\s\S]*?backgroundColor: '#252526'/);

assert(cursor.native_sources.some(source => source.theme === 'dark' && source.observed_blocks.includes('notice')),
  'Cursor notice approval requires a hashed same-theme observed source');
assert(cursor.approved_blocks.dark.includes('notice'));
assert(!cursor.pending_blocks.dark.includes('notice'));
assert(cursor.pending_blocks.light.includes('notice'),
  'light Cursor notice must remain pending without a native light source');

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  web_cursor_notice: 'compact_inline_info_banner',
  android_cursor_notice: 'compact_inline_info_banner_alert',
  shared_non_cursor_notice_preserved: true,
  dark_native_source_grounded: true,
  light_native_source_gate_preserved: true,
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
