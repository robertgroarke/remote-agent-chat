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

assert(web.includes('className="content-block content-block-terminal-codex-desktop"'));
assert(web.includes('<span>Ran commands</span>'));
assert(!web.includes("? 'Ran commands' : title"));
assert(css.includes('details.content-block-terminal-codex-desktop'));
assert.match(css, /content-block-terminal-codex-desktop[\s\S]*?background:\s*transparent;/);
assert.match(css, /content-block-terminal-codex-desktop[\s\S]*?border:\s*0;/);
assert.match(css, /content-block-terminal-codex-desktop[\s\S]*?font-style:\s*normal;/);

assert(android.includes("nativeDesktopTerminal: normalizedAgent === 'codex-desktop'"));
assert(android.includes('function CodexDesktopTerminalBlock'));
assert(android.includes('>Ran commands</Text>'));
assert(!android.includes("? 'Ran commands' : rawLabel"));
assert(visual.includes('content-block-terminal-codex-desktop'));
assert(visual.includes('Ran commands'));

console.log(JSON.stringify({
  ok: true,
  harness: 'codex-desktop',
  native_source: 'flat expanded Ran commands disclosure with lightweight child rows',
  web: 'flat native terminal disclosure',
  android: 'flat adaptive terminal disclosure',
  visual_fixture: 'native label and hierarchy',
}, null, 2));
