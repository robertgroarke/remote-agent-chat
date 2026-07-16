#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const web = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
const android = fs.readFileSync(path.join(ROOT, 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
const visual = fs.readFileSync(path.join(ROOT, 'tools', 'visual-regression.js'), 'utf8');

assert(web.includes("const isCodexDesktop = safeString(agentType).toLowerCase() === 'codex-desktop';"));
assert(web.includes('className="content-block content-block-thinking-codex-desktop"'));
assert(web.includes('isCodexDesktop && bodyIsTitleOnly'));
assert(css.includes('.harness-theme-codex-desktop .content-block-thinking-codex-desktop'));
assert.match(css, /content-block-thinking-codex-desktop[\s\S]*?font-style:\s*normal;/);
assert.match(css, /content-block-thinking-codex-desktop[\s\S]*?background:\s*transparent;/);

assert(android.includes("nativeDesktopThinking: normalizedAgent === 'codex-desktop'"));
assert(android.includes('if (theme.nativeDesktopThinking)'));
assert(android.includes('bodyIsTitleOnly'));
assert(visual.includes("agent === 'codex-desktop'"));
assert(visual.includes('Worked for 19m 5s'));
assert(visual.includes('content-block-thinking-codex-desktop'));

console.log(JSON.stringify({
  ok: true,
  harness: 'codex-desktop',
  native_source: 'flat Worked for disclosure row with ordinary transcript body',
  web: 'flat native reasoning boundary',
  android: 'flat adaptive reasoning boundary',
  visual_fixture: 'native label and hierarchy',
}, null, 2));
