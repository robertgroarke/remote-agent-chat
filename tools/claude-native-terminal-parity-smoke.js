#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _claudeTerminalBlockFromParts } = require('../agent-proxy/selectors');

const command = 'powershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION_12345678"';

const running = _claudeTerminalBlockFromParts(
  'Bash',
  'Echo permission test string',
  `IN\n${command}`,
  '',
);
assert.equal(running.type, 'terminal');
assert.equal(running.title, 'Bash Echo permission test string');
assert.equal(running.command, command);
assert.equal(running.stdout, '');
assert.equal(running.status, 'running');
assert.equal(running.collapsed, false);

const completed = _claudeTerminalBlockFromParts(
  'Bash',
  'Echo permission test string',
  `IN\n${command}\nOUT\nRAC_CLAUDE_PERMISSION_12345678`,
  '',
);
assert.equal(completed.type, 'terminal');
assert.equal(completed.command, command);
assert.equal(completed.stdout, 'RAC_CLAUDE_PERMISSION_12345678');
assert.equal(completed.content, `IN\n${command}\nOUT\nRAC_CLAUDE_PERMISSION_12345678`);
assert.equal(completed.status, 'completed');
assert.equal(completed.exit_code, null);

const rejected = _claudeTerminalBlockFromParts(
  'Bash',
  'Echo permission test string',
  `IN\n${command}\nOUT\nCommand canceled by user`,
  '',
);
assert.equal(rejected.status, 'error');
assert.equal(rejected.stdout, 'Command canceled by user');

assert.equal(
  _claudeTerminalBlockFromParts('Read', 'package.json', 'package.json', ''),
  null,
  'non-shell Claude tools must retain their canonical tool-call classification',
);

const e2eSource = fs.readFileSync(path.join(__dirname, 'vscode-claude-permission-e2e.js'), 'utf8');
assert.match(e2eSource, /--accept-command/);
assert.match(e2eSource, /block\.type === 'terminal'[\s\S]*?block\.stdout[\s\S]*?status === 'completed'/);
assert.match(e2eSource, /internally generated Write-Output command/);

console.log('Claude native terminal parity smoke: PASS');
