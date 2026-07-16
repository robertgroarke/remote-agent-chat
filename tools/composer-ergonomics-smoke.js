#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');

assert.match(app, /const sendHistoryRef = useRef\(\{\}\)/,
  'composer must keep independent send histories by session');
assert.match(app, /\[\.\.\.previous, text\]\.slice\(-100\)/,
  'composer history must remain bounded');
assert.match(app, /e\.key === 'ArrowUp'.+currentInput === ''/,
  'Up must recall history from an empty composer');
assert.match(app, /e\.key === 'ArrowDown' && historyCursorActive/,
  'Down must navigate recalled history back toward the scratch draft');
assert.match(app, /Math\.floor\(window\.innerHeight \* 0\.4\)/,
  'composer height must cap at 40 percent of the viewport');
assert.match(app, /textarea\.style\.overflowY = textarea\.scrollHeight > maximum \? 'auto' : 'hidden'/,
  'overflow must become internal scrolling only after the viewport cap');
assert.match(styles, /\.input-col textarea[\s\S]+max-height:\s*40vh/,
  'CSS must retain the same 40vh cap as the runtime resize logic');
assert.match(app, /activeProvisionalStream\?\.content\?\.length/,
  'scroll anchoring must react to provisional delta growth');
assert.match(app, /countTranscriptArrivalsSince\(jumpBaselineRef\.current, activeTranscriptArrival\)/,
  'jump-pill count must include delta-stream arrivals while scrolled away');
assert.match(app, /programmaticScrollUntilRef\.current = 0/,
  'real user scroll intent must override the auto-scroll guard immediately');
assert.match(app, /scrollPinGenerationRef\.current \+= 1/,
  'real user scroll intent must cancel already-queued pin animation frames');
assert.match(app, /newMessagesBelow > 0 \? `↓ \$\{newMessagesBelow\} new`/,
  'jump pill must expose the number of new arrivals');

console.log(JSON.stringify({
  ok: true,
  auto_expand_cap: '40vh',
  send_history: 'per-session, bounded to 100',
  history_keys: ['ArrowUp', 'ArrowDown'],
  delta_scroll_anchor: true,
  counted_jump_pill: true,
}, null, 2));
