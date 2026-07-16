'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const runner = fs.readFileSync(
  path.join(__dirname, 'vscode-continue-production-e2e.js'),
  'utf8'
);

assert.match(
  runner,
  /Start-Sleep -Seconds 30; Write-Output /,
  'Continue production interrupt gate must use a bounded terminal operation'
);
assert.doesNotMatch(
  runner,
  /1000 distinct software testing facts/,
  'Continue production interrupt gate must not overwhelm the webview with a huge response'
);
assert.match(
  runner,
  /control\(relay, session\.session_id, 'new_chat'\)/,
  'Continue production runs must start in a fresh owned native session'
);

console.log('continue-production-runner-smoke: ok');
