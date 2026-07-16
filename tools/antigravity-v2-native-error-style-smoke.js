#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const app = read('frontend/app.jsx');
const css = read('frontend/styles.css');
const android = read('android-app/components/MessageBubble.jsx');
const fixture = read('tools/visual-regression.js');

assert.match(app, /type === 'error' && isAntigravityV2[\s\S]*?content-block-error-antigravity-v2[\s\S]*?defaultOpen=\{false\}/);
assert.match(app, /function TranscriptDisclosure\([\s\S]*?defaultOpen = true[\s\S]*?: defaultOpen/,
  'existing disclosures must remain expanded by default');
assert.match(css, /\.harness-theme-antigravity-v2 details\.content-block-error-antigravity-v2 \{[\s\S]*?border-left: 0;[\s\S]*?padding-left: 0;/);
assert.match(css, /content-block-error-antigravity-v2 > summary \{[\s\S]*?display: flex;[\s\S]*?font-weight: 400;/);
assert.match(css, /content-block-error-antigravity-v2 > summary::after \{[\s\S]*?content: "\\203A";/);
assert.match(css, /\.content-block-error \{[\s\S]*?border-left-color: rgba\(248, 81, 73, 0\.65\);/,
  'shared non-Antigravity error rail must remain intact');

assert.match(android, /case 'error':[\s\S]*?theme\.nativeAntigravityError[\s\S]*?<AntigravityErrorBlock/);
assert.match(android, /function AntigravityErrorBlock[\s\S]*?useState\(false\)[\s\S]*?accessibilityState=\{\{ expanded: open \}\}/);
assert.match(android, /nativeAntigravityError: normalizedAgent === 'antigravity-v2'/);
assert.match(fixture, /agent === 'antigravity-v2'[\s\S]*?content-block-error-antigravity-v2[\s\S]*?Agent execution terminated due to error/);

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  web_antigravity_v2_error: 'collapsed_flat_disclosure',
  android_antigravity_v2_error: 'collapsed_flat_accessible_disclosure',
  shared_error_treatments_preserved: true,
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
