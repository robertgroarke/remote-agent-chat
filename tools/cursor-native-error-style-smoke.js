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

assert.match(css, /\.harness-theme-cursor \.content-block-error \{[\s\S]*?border-left: 0;[\s\S]*?padding-left: 0;/);
assert.match(css, /\.harness-theme-cursor \.content-block-error \.content-block-title::after \{[\s\S]*?content: ": ";/);
assert.match(css, /\.harness-theme-cursor \.content-block-error \.message-body \{[\s\S]*?font-weight: 600;/);
assert.match(css, /\.content-block-error \{[\s\S]*?border-left-color: rgba\(248, 81, 73, 0\.65\);/,
  'shared non-Cursor error rail must remain intact');

assert.match(android, /case 'error':[\s\S]*?theme\.nativePlainError[\s\S]*?accessibilityRole="alert"/);
assert.match(android, /const normalizedAgent = String\(agentType \|\| ''\)\.toLowerCase\(\)[\s\S]*?nativePlainError: normalizedAgent === 'cursor'/);
assert.match(android, /cursorNativeErrorLabel:[\s\S]*?fontWeight: '700'/);

assert(cursor.native_sources.some(source => source.theme === 'dark' && source.observed_blocks.includes('error')),
  'Cursor error approval requires a hashed same-theme observed source');
assert(cursor.approved_blocks.dark.includes('error'));
assert(!cursor.pending_blocks.dark.includes('error'));
assert(cursor.pending_blocks.light.includes('error'), 'light Cursor error must remain pending without a native source');

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  web_cursor_error: 'plain_inline_bold',
  android_cursor_error: 'plain_inline_bold_alert',
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
