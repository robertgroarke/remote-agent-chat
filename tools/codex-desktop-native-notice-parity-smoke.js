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
const desktop = manifest.harnesses.find(row => row.agent === 'codex-desktop');

assert.match(css, /:root\[data-theme="light"\] \.harness-theme-codex-desktop \.content-block-notice \{[\s\S]*?grid-template-columns: 18px minmax\(0, 1fr\) auto;[\s\S]*?border: 1px solid #e7e7e7;[\s\S]*?border-radius: 16px;[\s\S]*?background: #fff;/);
assert.match(css, /\.harness-theme-codex-desktop \.content-block-notice::before \{[\s\S]*?content: "\\25F4";/);
assert.match(css, /\.harness-theme-codex-desktop \.content-block-notice \.content-block-action-label \{[\s\S]*?border-radius: 999px;[\s\S]*?background: #202124;[\s\S]*?color: #fff;/);
assert.match(css, /\.content-block-notice \{[\s\S]*?border-left-color: rgba\(219, 171, 9, 0\.65\);/,
  'shared and dark Codex Desktop notice treatment must remain intact');

assert.match(android, /case 'notice':[\s\S]*?theme\.nativeDesktopNotice[\s\S]*?renderCodexDesktopNotice/);
assert.match(android, /function renderCodexDesktopNotice\([\s\S]*?accessibilityRole="alert"/);
assert.match(android, /nativeDesktopNotice: normalizedAgent === 'codex-desktop' && isLight/,
  'Android native notice must stay light-only without a dark native source');
assert.match(android, /codexDesktopNotice:[\s\S]*?borderRadius: 16,[\s\S]*?backgroundColor: '#ffffff'/);

assert(desktop.native_sources.some(source => source.theme === 'light' && source.observed_blocks.includes('notice')),
  'Codex Desktop light notice approval requires a hashed same-theme observed source');
assert(desktop.approved_blocks.light.includes('notice'));
assert(!desktop.pending_blocks.light.includes('notice'));
assert(desktop.pending_blocks.dark.includes('notice'),
  'dark Codex Desktop notice must remain pending without a native dark source');

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  harness: 'codex-desktop',
  web_light_notice: 'native_bounded_usage_alert',
  android_light_notice: 'native_bounded_usage_alert',
  shared_and_dark_notice_preserved: true,
  light_native_source_grounded: true,
  dark_native_source_gate_preserved: true,
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
