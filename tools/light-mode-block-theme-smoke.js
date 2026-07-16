#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { THEMES, parseArgs, fixtureHtml } = require('./visual-regression');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8');
const assetVersion = worker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
assert(assetVersion, 'service worker is missing the immutable asset version');

for (const token of [
  '--code-text: #24292f',
  '--terminal-bg: #f6f8fa',
  '--terminal-text: #24292f',
  '--terminal-command: #0550ae',
  '--syntax-keyword: #cf222e',
  '--syntax-string: #0a3069',
]) {
  assert(css.includes(token), `light palette is missing ${token}`);
}
for (const selector of [
  ':root[data-theme="light"] .hljs-keyword',
  ':root[data-theme="light"] .harness-theme-codex',
  ':root[data-theme="light"] .harness-theme-codex-desktop',
  ':root[data-theme="light"] .harness-theme-claude_cli',
  ':root[data-theme="light"] .harness-theme .tool-body',
]) {
  assert(css.includes(selector), `light palette is missing ${selector}`);
}
assert.match(css, /\.terminal-viewer\s*\{[\s\S]*?background:\s*var\(--terminal-bg\)/);
assert.match(css, /\.terminal-output\s*\{[\s\S]*?color:\s*var\(--terminal-text\)/);
assert.match(css, /\.content-block-pre\s*\{[\s\S]*?color:\s*var\(--code-text\)/);

const darkCdnAt = index.indexOf('github-dark.min.css');
const appCssAt = index.indexOf(`/styles.css?v=${assetVersion}`);
assert(darkCdnAt >= 0 && appCssAt > darkCdnAt, 'app stylesheet must load after the CDN dark syntax theme');
assert.deepStrictEqual(THEMES, ['dark', 'light']);
assert.strictEqual(parseArgs(['--theme', 'light']).theme, 'light');
const fixture = fixtureHtml(css);
assert.match(fixture, /document\.documentElement\.dataset\.theme = theme/);
assert(fixture.includes('content-block content-block-status-chip">Working'), 'status fixture must use the real renderer class');
assert(!fixture.includes('content-block content-block-status-chip thinking">Working'), 'status fixture must not inject the thinking class');
assert.match(css, /\.harness-theme-claude \.content-block-status-chip\s*\{[\s\S]*?font-style:\s*italic/);

console.log(JSON.stringify({
  ok: true,
  web_light_code_palette: true,
  web_light_terminal_palette: true,
  per_harness_light_fallbacks: true,
  syntax_palette_is_semantic_not_inverted: true,
  visual_themes: THEMES,
}, null, 2));
