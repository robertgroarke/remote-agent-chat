#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const hooks = read('frontend/hooks.jsx');
const app = read('frontend/app.jsx');
const styles = read('frontend/styles.css');
const bundle = read('frontend/dist/bundle.js');

assert.match(hooks, /function sendTerminalInput\(sessionId, text\)[\s\S]*?type: 'terminal_input'[\s\S]*?text/,
  'terminal input must have a WebSocket request helper');
assert.match(hooks, /return \{[^\n]*requestTerminalOutput, sendTerminalInput, terminalOutputs/,
  'terminal input request helper must be exposed by useRelay');
assert.match(app, /capabilities\?\.terminal_output \|\| activeConfig\?\.capabilities\?\.terminal_input/,
  'terminal controls must render for input-only harnesses');
assert.match(app, /<form className="terminal-input-form" onSubmit=\{submitCommand\}>/,
  'terminal input must use an explicit submit form');
assert.match(app, /aria-label="Terminal command"/,
  'terminal command input must have an accessible label');
assert.match(app, /onSend=\{text => sendTerminalInput\(activeSession, text\)\}/,
  'terminal command submit must target the active session');
assert.match(app, /controlResult\.result === 'ok'[\s\S]*?'Command sent'/,
  'terminal input must show relay-confirmed success');
assert.match(app, /controlResult\.error\?\.message \|\| controlResult\.error\?\.code/,
  'terminal input must expose relay failure details');
assert.match(styles, /\.terminal-input-form\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
  'terminal input layout must wrap at narrow widths');

for (const asset of ['app.jsx', 'hooks.jsx', 'styles.css']) {
  assert.strictEqual(
    read(`relay-server/public/${asset}`),
    read(`frontend/${asset}`),
    `relay-served ${asset} is not synced with frontend source`,
  );
}
assert.strictEqual(read('relay-server/public/dist/bundle.js'), bundle,
  'relay-served bundle is not synced with the frontend build');
assert(bundle.includes('Terminal command'), 'compiled bundle is missing terminal input controls');

console.log('frontend terminal input smoke: PASS');
