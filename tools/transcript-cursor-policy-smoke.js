#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeTranscriptCursor,
  evaluateTranscriptCursor,
} = require('../relay-server/transcript-cursor-policy');

const cursor = (messageIndex, endOffset = 100 + messageIndex, generation = 'generation-a') => ({
  generation,
  message_index: messageIndex,
  end_offset: endOffset,
  file_size: endOffset,
});

assert.deepStrictEqual(normalizeTranscriptCursor(cursor(0)), cursor(0));
assert.strictEqual(normalizeTranscriptCursor({ ...cursor(0), file_size: 99 }), null);
assert.deepStrictEqual(evaluateTranscriptCursor(null, cursor(7)), {
  accepted: true,
  code: 'baseline',
  incoming: cursor(7),
  previous: null,
});
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(8)).accepted, true);
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(7)).code, 'stale_cursor');
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(6)).code, 'stale_cursor');
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(9)).code, 'cursor_gap');
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(8, 90)).code, 'stale_cursor');
assert.strictEqual(evaluateTranscriptCursor(cursor(7), cursor(0, 100, 'generation-b')).code, 'generation_changed');
assert.strictEqual(evaluateTranscriptCursor(cursor(7), { end_offset: 1 }).code, 'invalid_cursor');

const root = path.resolve(__dirname, '..');
const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const webSource = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const androidSource = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const androidRelaySource = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');

assert(relaySource.includes("ws._sessionSubscriptions = new Set();"));
assert(relaySource.includes("type: 'transcript_resync_required'"));
assert(relaySource.includes("'Dropped requestless or orphaned native history chunk'"));
assert(relaySource.includes('clearBrowserTranscriptGap(targetWs, id)'));
assert(webSource.includes("t === 'transcript_resync_required'"));
assert(webSource.includes('if (msg.source_message_id) return `source'));
assert(androidSource.includes("case 'transcript_resync_required':"));
assert(androidSource.includes("msg.mode === 'tail' && msg.replace === true"));
assert(androidRelaySource.includes("mode === 'tail' && options.replace === true"));

console.log('transcript cursor/fan-out policy smoke: PASS');
