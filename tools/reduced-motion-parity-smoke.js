#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const webApp = read('frontend/app.jsx');
const webStyles = read('frontend/styles.css');
const androidHook = read('android-app/lib/reduced-motion.js');
const androidApp = read('android-app/App.jsx');
const androidList = read('android-app/screens/SessionListScreen.jsx');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const androidTranscriptCache = read('android-app/lib/transcript-cache.js');
const androidPackage = JSON.parse(read('android-app/package.json'));
const androidEntry = read('android-app/index.js');

assert(webStyles.includes('@media (prefers-reduced-motion: reduce)'), 'web reduced-motion media query missing');
for (const marker of [
  'animation-duration: 0.01ms !important',
  'animation-iteration-count: 1 !important',
  'transition-duration: 0.01ms !important',
  'scroll-behavior: auto !important',
]) assert(webStyles.includes(marker), `web reduced-motion reset missing ${marker}`);
assert(webApp.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"), 'Claude spinner does not observe reduced motion');
assert.match(webApp, /if \(reducedMotion\) \{\r?\n\s+setFrame\(0\);/,
  'Claude spinner does not settle under reduced motion');
assert.match(webStyles, /\.session-group-working\s*\{[^}]*animation:\s*none;/s,
  'sidebar group activity must remain truthful without an unbounded animation');
assert.match(webStyles, /\.native-activity-spinner\.static[\s\S]*?animation:\s*none;/,
  'static at-scale activity indicators must not animate');
assert.equal((webApp.match(/<NativeActivitySpinner[^>]+animate=\{false\}/g) || []).length, 2,
  'sidebar and Fleet activity indicators must use the static at-scale variant');

for (const marker of [
  'AccessibilityInfo.isReduceMotionEnabled()',
  'subscription?.remove?.()',
]) assert(androidHook.includes(marker), `Android reduced-motion hook missing ${marker}`);
assert.match(androidHook, /AccessibilityInfo\.addEventListener\(\r?\n\s+'reduceMotionChanged'/,
  'Android reduced-motion change subscription missing');
assert(androidApp.includes("animation: reducedMotion ? 'none' : SCREEN_OPTIONS.animation"), 'Android navigation does not disable motion');
assert.match(androidApp, /if \(reducedMotionRef\.current\) \{\r?\n\s+opacity\.setValue\(1\);/,
  'Android notification banner does not settle immediately');
assert(androidList.includes("animationType={reducedMotion ? 'none' : 'slide'}"), 'Android operator sheets do not disable slide motion');
assert(androidList.includes("animationType={reducedMotion ? 'none' : 'fade'}"), 'Android title disclosure does not disable fade motion');
assert.match(androidList, /if \(reducedMotion\) \{\r?\n\s+opacity\.setValue\(0\.45\);/,
  'Android skeleton loop does not settle');

const androidFiles = [];
const visit = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.expo') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (/\.(?:js|jsx)$/.test(entry.name)) androidFiles.push(full);
  }
};
visit(path.join(root, 'android-app'));
const androidSource = androidFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
assert(!androidSource.includes('allowFontScaling={false}'), 'Android must retain native large-text scaling');
assert.equal(androidPackage.main, 'index.js', 'Android export must resolve through the worktree-local entrypoint');
assert(androidEntry.includes("import App from './App'"), 'Android entrypoint must import the worktree-local App');
assert(androidEntry.includes('registerRootComponent(App)'), 'Android entrypoint must register the local App');
assert(androidTranscriptCache.includes('export function stableTranscriptMessageKey(message)'),
  'Android transcript identity helper must be reusable by the list renderer');
assert(androidChat.includes('keyExtractor={stableTranscriptMessageKey}'),
  'Android transcript list must not use shifting array indexes as keys');
for (const marker of [
  'initialNumToRender={24}',
  'maxToRenderPerBatch={24}',
  'updateCellsBatchingPeriod={16}',
  'windowSize={9}',
]) assert(androidChat.includes(marker), `Android transcript batching contract missing ${marker}`);
for (const marker of [
  'keyExtractor={item => sessionId(item)}',
  'initialNumToRender={20}',
  'maxToRenderPerBatch={20}',
  'updateCellsBatchingPeriod={32}',
  'windowSize={9}',
]) assert(androidList.includes(marker), `Android sidebar batching contract missing ${marker}`);

console.log(JSON.stringify({
  ok: true,
  web_global_reduced_motion: true,
  web_javascript_spinner_settles: true,
  web_at_scale_activity_indicators_static: true,
  android_accessibility_subscription: true,
  android_navigation_and_operator_sheets_settle: true,
  android_skeleton_and_banner_settle: true,
  android_large_text_scaling_not_disabled: true,
  android_flat_list_stable_keys_and_batching: true,
  android_section_list_stable_keys_and_batching: true,
}, null, 2));
