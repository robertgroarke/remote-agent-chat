#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const styles = read('frontend/styles.css');
const manifest = JSON.parse(read('evidence/harness-maturity/native-golden-approvals.json'));
const claudeCli = manifest.harnesses.find(row => row.agent === 'claude_cli');

assert(claudeCli, 'Claude CLI native approval row is missing');
for (const block of ['markdown', 'thinking']) {
  assert(claudeCli.approved_blocks.dark.includes(block), `${block} must be dark-native-approved`);
  assert(!claudeCli.pending_blocks.dark.includes(block), `${block} must leave the dark pending set`);
}
const sourceByBlock = Object.fromEntries(claudeCli.native_sources.flatMap(source =>
  source.observed_blocks.map(block => [block, source])));
assert.equal(sourceByBlock.markdown.path,
  'evidence/harness-maturity/2026-07-15/claude-cli-native-markdown.png');
assert.equal(sourceByBlock.markdown.sha256,
  '2ea1fb11f77a86f8ea0d27451c47305715e0d0f659808bd6b97ea1a622a2d5af');
assert.equal(sourceByBlock.thinking.path,
  'evidence/harness-maturity/2026-07-15/claude-cli-native-thinking.png');
assert.equal(sourceByBlock.thinking.sha256,
  'cf070f10dd8cb4dbd12bcd6aa14be9435ab72770e13b7cc4a2acc84fafd8f2c1');

assert.match(styles,
  /:root\[data-theme="dark"\] \.harness-theme-claude_cli details\.content-block-thinking \{[\s\S]*?border-left: 0;[\s\S]*?font-style: normal;/,
  'Claude CLI dark thinking must be an unboxed native row');
assert.match(styles,
  /\.harness-theme-claude_cli details\.content-block-thinking > summary \{[\s\S]*?color: #d97757;[\s\S]*?list-style: none;/,
  'Claude CLI dark thinking summary must use native orange without the shared marker');
assert.match(styles,
  /\.harness-theme-claude_cli details\.content-block-thinking > summary::before \{\s*content: "\\273B\\00A0";/,
  'Claude CLI dark thinking summary must expose the native activity glyph');
assert.match(styles,
  /\.harness-theme-claude_cli details\.content-block-thinking \.message-body \{[\s\S]*?font-style: italic;/,
  'Retained Claude CLI reasoning must stay visually distinct');

const verification = JSON.parse(read('evidence/harness-maturity/2026-07-15/claude-cli-native-conversation-verification.json'));
assert.equal(verification.ok, true);
assert.deepEqual(verification.native_surfaces, ['thinking', 'markdown']);
assert.equal(verification.safety.sends, 0);
assert.equal(verification.safety.visible_windows_opened, 0);

console.log('PASS Claude CLI native markdown/thinking approval and style contract');
