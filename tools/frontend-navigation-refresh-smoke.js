#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
assert(
  app.includes('const TRANSCRIPT_WINDOW_THRESHOLD = 100;'),
  'ordinary long transcripts no longer enter the bounded render window',
);

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `Unable to isolate ${name}`);
  return app.slice(start, end);
}

for (const [name, nextName] of [
  ['handleNewThread', 'handleSwitchThread'],
  ['handleSwitchThread', 'handleAntigravityV2New'],
  ['handleAntigravityV2New', 'handleAntigravityV2Navigate'],
  ['handleAntigravityV2Navigate', 'updateInput'],
]) {
  const source = functionSource(name, nextName);
  assert(!source.includes('setTimeout('), `${name} retained timer-driven navigation refreshes`);
  assert(!source.includes('requestHistory('), `${name} can race the proxy's authoritative history snapshot`);
}

assert(
  hooks.includes("['new_thread', 'switch_thread'].includes(msg.command)")
    && hooks.includes('requestThreadList(sid);'),
  'thread navigation does not refresh from its terminal control result',
);
assert(
  hooks.includes("msg.command === 'switch_chat'")
    && hooks.includes('requestChatList(sid);'),
  'chat navigation does not refresh from its terminal control result',
);

const threadPollingSection = app.slice(
  app.indexOf('if (!(activeSession && hasThreadCap && (isDesktopAgent || showThreadList)))'),
  app.indexOf('function handleNewThread'),
);
assert(threadPollingSection.includes('showThreadList ? 3000 : 5000'));
assert.strictEqual(
  (threadPollingSection.match(/setInterval\(/g) || []).length,
  1,
  'visible thread history created overlapping polling intervals',
);

console.log('PASS frontend navigation refresh is event-driven with one bounded thread poller');
