'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const launcher = read('launch-antigravity-ide-cdp-9228.bat');
const alias = read('launch-antigravity-cdp.bat');
assert.match(launcher, /CDP_PORT=9228/);
assert.match(launcher, /remote-debugging-port=%CDP_PORT%/);
assert.match(launcher, /already running[\s\S]*no process was stopped/i);
assert.doesNotMatch(launcher, /Stop-Process|taskkill|\.Kill\(/i, 'launcher must not displace a running IDE');
assert.match(alias, /launch-antigravity-ide-cdp-9228\.bat/i);
assert.doesNotMatch(alias, /Stop-Process|taskkill/i);

const expectedPorts = '9223,9228,9225,9226,9227';
for (const relative of [
  'agent-proxy/index.js',
  'agent-proxy/vscode-ext/extension.js',
  'agent-proxy/vscode-ext/package.json',
  'README.md',
  'CLAUDE.md',
]) {
  assert.ok(read(relative).includes(expectedPorts), `${relative} is missing the dual-host CDP default`);
}

for (const relative of ['tools/cdp-regression-smoke.js', 'tools/run-fidelity-regression.js']) {
  const source = read(relative);
  assert.match(source, /vscode:\s*9223/);
  assert.match(source, /antigravity:\s*9228/);
  assert.match(source, /_cdpPort/);
}

assert.match(read('tools/reload-antigravity.js'), /CDP_PORT \|\| '9228'/);
assert.match(read('tools/safe-reload-ide.py'), /ANTIGRAVITY_CDP_PORT', '9228'/);

console.log(JSON.stringify({
  ok: true,
  vscode_port: 9223,
  antigravity_ide_port: 9228,
  launcher_replaces_running_ide: false,
  configured_default_ports: expectedPorts,
  regression_tools_dual_host: true,
}, null, 2));
