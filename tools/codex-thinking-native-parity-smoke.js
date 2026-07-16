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

assert(web.includes("const isCodex = safeString(agentType).toLowerCase() === 'codex';"));
assert(web.includes('className="content-block content-block-thinking-native"'));
assert(web.includes("title.toLowerCase() !== 'thinking'"));
assert(css.includes('.harness-theme-codex .content-block-thinking-native'));
assert.match(css, /\.harness-theme-codex \.content-block-thinking-native[\s\S]*?font-style:\s*normal;/);

assert(android.includes("nativePlainThinking: normalizedAgent === 'codex'"));
assert.match(android, /if \(theme\.nativePlainThinking\)[\s\S]*?<Markdown key=\{i\} style=\{theme\.markdown\}>/);
assert(visual.includes("const thinkingBlock = agent === 'codex'"));
assert(visual.includes('content-block-thinking-native'));

console.log(JSON.stringify({
  ok: true,
  harness: 'codex',
  web: 'plain settled commentary',
  android: 'plain settled commentary',
  visual_fixture: 'native plain transcript prose',
}, null, 2));
