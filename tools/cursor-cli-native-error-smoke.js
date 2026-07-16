#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./cursor-cli-native-error-e2e');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

assert.throws(() => parseArgs([]), /--probe-live-auth-failure/, 'live auth-failure consent must fail closed');
assert.throws(() => parseArgs([
  '--probe-live-auth-failure', '--workspace', 'C:/temp/not-owned',
  '--screenshot', 'evidence/a.png', '--result-file', 'evidence/a.json',
]), /restricted/, 'workspace guard must fail closed');
const options = parseArgs([
  '--probe-live-auth-failure', '--workspace', 'C:/temp/cursor-test',
  '--screenshot', 'evidence/harness-maturity/error.png',
  '--result-file', 'evidence/harness-maturity/error.json',
]);
assert.equal(options.workspace.toLowerCase(), path.resolve('C:/temp/cursor-test').toLowerCase());

const css = read('frontend/styles.css');
const fixture = read('tools/visual-regression.js');
assert.match(css, /\.harness-theme-cursor_cli \.content-block-error \{[\s\S]*?border-left: 0;[\s\S]*?padding-left: 0;[\s\S]*?color: var\(--harness-text\);/,
  'Cursor CLI errors must use the native unboxed terminal hierarchy');
assert.match(css, /\.harness-theme-cursor_cli \.content-block-error \.content-block-title::before \{[\s\S]*?content: "\\26A0\\00A0";/,
  'Cursor CLI error label must retain the native warning glyph');
assert.match(css, /\.harness-theme-cursor_cli \.content-block-error \.content-block-title \{[\s\S]*?color: #c4a000;/,
  'Cursor CLI dark warning must use the captured xterm palette-3 color');
assert.match(css, /\.harness-theme-cursor_cli \.message\.assistant \.content-block-error \.message-body \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;/,
  'the shared CLI message-body box must not leak into Cursor CLI errors');
assert.match(css, /\.content-block-error \{[\s\S]*?border-left-color: rgba\(248, 81, 73, 0\.65\);/,
  'shared non-Cursor-CLI error rail must remain intact');
assert.match(fixture, /agent === 'cursor_cli'[\s\S]*?cursor-cli-native-error-primary[\s\S]*?The provided API key is invalid\.[\s\S]*?authenticate without it\./,
  'Cursor CLI error fixture must use the exact captured native copy');

console.log('PASS Cursor CLI native error guard and style parity contracts');
