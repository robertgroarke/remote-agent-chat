#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const web = read('frontend/app.jsx');
const css = read('frontend/styles.css');
const android = read('android-app/components/MessageBubble.jsx');
const collapse = read('android-app/components/CollapsibleBlock.jsx');
const built = read('relay-server/public/dist/bundle.js');

for (const source of [web, android, built]) {
  assert(source.includes('activity_summary'), 'typed activity-summary discriminator missing');
  assert(source.includes('Codex activity summary'), 'semantic summary label missing');
}
assert(web.includes("['codex', 'codex-desktop', 'codex_cli']"), 'Web Codex-family routing missing');
assert(web.includes('<MessageTimestamp instant={block.producer_timestamp'), 'Web block timestamp contract missing');
assert(web.includes('data-native-source-id={block.native_source_id'), 'Web native source identity missing');
assert(css.includes('.content-block-thinking-native-summary'), 'Web subdued summary style missing');
assert.match(css, /content-block-thinking-native-summary[\s\S]*?overflow-wrap:\s*anywhere;/,
  'Web long summary wrapping missing');
assert(android.includes('function CodexActivitySummaryBlock'), 'Android typed summary renderer missing');
assert(android.includes('<CollapsibleBlock maxHeight={154}>'), 'Android long-summary collapse path missing');
assert(android.includes('block.producer_timestamp || block.created_at'), 'Android block timestamp contract missing');
assert(android.includes('accessibilityRole="text"'), 'Android semantic text role missing');
assert(collapse.includes('minHeight:         44'), 'Android collapse control must meet 44px touch target');
assert(collapse.includes('accessibilityState={{ expanded: !collapsed }}'), 'Android collapse state semantics missing');

console.log(JSON.stringify({
  ok: true,
  surfaces: ['codex-desktop', 'codex-vscode', 'codex-cli'],
  clients: ['web', 'android'],
  full_timestamp: true,
  semantic_label: true,
  long_summary_wrap_or_expand: true,
  minimum_touch_target_px: 44,
  built_asset_contains_contract: true,
}));
