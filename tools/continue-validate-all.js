#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--read-only')) {
  console.error('Continue validate-all only supports --read-only.');
  process.exit(2);
}

const stages = [
  ['selectors syntax', ['--check', 'agent-proxy/selectors.js']],
  ['production E2E syntax', ['--check', 'tools/vscode-continue-production-e2e.js']],
  ['composer selection fixture', ['tools/continue-composer-selection-smoke.js']],
];

for (const [name, commandArgs] of stages) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(`Continue validate-all failed: ${name}`);
    process.exit(result.status || 1);
  }
}

console.log(`Continue validate-all: PASS (${stages.length}/${stages.length})`);
