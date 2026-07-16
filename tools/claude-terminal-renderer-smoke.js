#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const web = read('frontend/app.jsx');
const css = read('frontend/styles.css');
const android = read('android-app/components/MessageBubble.jsx');
const visual = read('tools/visual-regression.js');

assert.match(web, /isClaude[\s\S]*?content-block-terminal-claude[\s\S]*?block\.command[\s\S]*?block\.stdout/);
assert.match(css, /\.harness-theme-claude \.content-block-terminal-claude-body[\s\S]*?border: 1px solid #3c3c3c/);
assert.match(css, /:root\[data-theme="light"\] \.harness-theme-claude \.content-block-terminal-claude-body[\s\S]*?background: #ffffff/);
assert.match(android, /nativeClaudeTerminal[\s\S]*?ClaudeTerminalBlock/);
assert.match(android, /function ClaudeTerminalBlock[\s\S]*?block\.command[\s\S]*?block\.stdout/);
assert.match(visual, /agent === 'claude'[\s\S]*?content-block-terminal-claude[\s\S]*?42 passed, 0 failed/);
assert.match(visual, /harness-theme-claude \[data-visual-block="terminal"\][\s\S]*?margin-bottom: 84\.46875px/);

console.log('Claude terminal renderer smoke: PASS');
