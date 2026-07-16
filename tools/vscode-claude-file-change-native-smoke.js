#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { lightPixelStats, negativeChoice, ownedChangeState, parseArgs, positiveChoice } = require('./vscode-claude-file-change-native-e2e');
const { parseArgs: parseRetainedArgs } = require('./vscode-claude-file-change-native-retained');

assert.throws(() => parseArgs([]), /--send-live/);
assert.throws(() => parseArgs(['--send-live']), /--session-id/);
const options = parseArgs([
  '--send-live',
  '--session-id', '110f2fe0-0d94-4798-b35d-e3386aa4238b',
  '--expected-readme-sha256', 'a'.repeat(64),
  '--screenshot', path.join(__dirname, '..', 'evidence', 'fixture.png'),
  '--result-file', path.join(__dirname, '..', 'evidence', 'fixture.json'),
]);
assert.equal(options.sendLive, true);
assert.equal(positiveChoice({ choices: [{ choice_id: '1_yes', label: 'Yes' }] }).choice_id, '1_yes');
assert.equal(negativeChoice({ choices: [{ choice_id: '3_no', label: 'No' }] }).choice_id, '3_no');
const marker = 'RAC_CLAUDE_FILE_CHANGE_fixture';
const toolOnly = ownedChangeState([
  { role: 'assistant', content_blocks: [{ type: 'file_changes', content: 'Added 1 line' }] },
], marker);
assert.equal(toolOnly.settled, false, 'Tool completion must not masquerade as settled assistant completion');
const settled = ownedChangeState([
  { role: 'assistant', content_blocks: [{ type: 'file_changes', content: 'Added 1 line' }] },
  { role: 'assistant', content_blocks: [{ type: 'markdown', content: marker }] },
], marker);
assert.equal(settled.settled, true);
assert.equal(settled.finalMarkdownBlocks.length, 1);
const lightPixels = { width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4, 255) };
assert.equal(lightPixelStats(lightPixels).is_light, true);
const darkPixels = { width: 4, height: 4, data: Buffer.from(lightPixels.data) };
for (let index = 0; index < darkPixels.data.length; index += 4) {
  darkPixels.data[index] = 24;
  darkPixels.data[index + 1] = 24;
  darkPixels.data[index + 2] = 24;
}
assert.equal(lightPixelStats(darkPixels).is_light, false,
  'Dark compositor pixels must not masquerade as a light native source');
assert.throws(() => parseRetainedArgs([]), /--read-only/);
const retained = parseRetainedArgs([
  '--read-only',
  '--session-id', options.sessionId,
  '--marker', 'RAC_CLAUDE_FILE_CHANGE_deadbeef',
  '--screenshot', path.join(__dirname, '..', 'evidence', 'retained.png'),
  '--result-file', path.join(__dirname, '..', 'evidence', 'retained.json'),
]);
assert.equal(retained.readOnly, true);
assert.throws(() => parseArgs([
  '--send-live', '--session-id', options.sessionId,
  '--expected-readme-sha256', 'a'.repeat(64),
  '--screenshot', path.join(__dirname, '..', 'outside.png'),
  '--result-file', path.join(__dirname, '..', 'evidence', 'fixture.json'),
]), /evidence tree/);

console.log('PASS Claude native file-change E2E guard contract');
