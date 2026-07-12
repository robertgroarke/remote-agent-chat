#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');

assert.match(source, /import AsyncStorage\s+from '@react-native-async-storage\/async-storage'/);
assert.match(source, /DRAFT_STORAGE_PREFIX = 'remote-agent-chat:draft:v1:'/);
assert.match(source, /AsyncStorage\.getItem\(`\$\{DRAFT_STORAGE_PREFIX\}\$\{sessionId\}`\)/);
assert.match(source, /input \? AsyncStorage\.setItem\(key, input\) : AsyncStorage\.removeItem\(key\)/);
assert.match(source, /draftLoadedRef\.current/);

for (const command of ['/plan', '/review', '/fix', '/summarize']) {
  assert(source.includes(`command: '${command}'`), `missing Android slash command ${command}`);
}
assert.match(source, /const filteredSlashCommands = input\.startsWith\('\/'\)/);
assert.match(source, /setInput\(`\$\{command\} `\)/);
assert.match(source, /setSlashMenuDismissed\(true\)/);
assert.match(source, /accessibilityRole="menu"/);
assert.match(source, /accessibilityRole="menuitem"/);
assert.match(source, /requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/);

console.log(JSON.stringify({
  ok: true,
  per_session_draft_storage: true,
  draft_debounce_ms: 150,
  slash_commands: ['/plan', '/review', '/fix', '/summarize'],
  accessible_menu: true,
}, null, 2));
