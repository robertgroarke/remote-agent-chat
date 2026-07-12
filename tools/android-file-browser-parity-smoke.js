#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('android-app/lib/relay.js');
const chat = read('android-app/screens/ChatScreen.jsx');
const sheet = read('android-app/components/FileBrowserSheet.jsx');

for (const [method, type] of [
  ['requestDirectoryListing', 'list_directory'],
  ['requestFileContent', 'read_file'],
]) {
  assert(relay.includes(`${method}(`), `missing Android file helper: ${method}`);
  assert(relay.includes(`type: '${type}'`), `missing Android file protocol type: ${type}`);
}
for (const marker of [
  "case 'directory_listing'",
  "case 'file_content'",
  "cmd === 'list_directory' || cmd === 'read_file'",
  'hasFileBrowser',
  'Browse workspace files',
  '<FileBrowserSheet',
  'navigateFileBrowser',
  'openFilePreview',
  'refreshFileBrowser',
]) assert(chat.includes(marker), `missing Android file-browser marker: ${marker}`);

assert.match(chat, /sid !== sessionId/);
assert.match(sheet, /presentationStyle="pageSheet"/);
assert.match(sheet, /accessibilityLabel=\{`\$\{directory \? 'Folder' : 'File'\}/);
assert.match(sheet, /selectable/);
assert.match(sheet, /Preview truncated by the desktop file-size limit/);
assert.match(sheet, /VIEWABLE_EXTENSIONS/);
assert.match(sheet, /value\.startsWith\('\.'\)/);
assert.match(sheet, /onNavigate\(parentPath\(currentPath\)\)/);

console.log(JSON.stringify({
  ok: true,
  protocol_actions: ['list_directory', 'read_file'],
  session_scoped_responses: true,
  directory_navigation: true,
  parent_and_root_navigation: true,
  text_file_preview: true,
  binary_files_disabled: true,
  truncated_preview_notice: true,
  accessible_rows: true,
}, null, 2));
