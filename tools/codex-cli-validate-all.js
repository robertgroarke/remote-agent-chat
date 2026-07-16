#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');
const { resolveCodexCommand } = require('../agent-proxy/codex-cli');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--read-only')) {
  console.error('Codex CLI validate-all only supports --read-only.');
  process.exit(2);
}
const stages = [
  ['Codex CLI parser syntax', process.execPath, ['--check', 'agent-proxy/codex-cli.js']],
  ['Proxy engine syntax', process.execPath, ['--check', 'agent-proxy/proxy-engine.js']],
  ['Session store syntax', process.execPath, ['--check', 'agent-proxy/session-store.js']],
  ['Protocol syntax', process.execPath, ['--check', 'agent-proxy/protocol.js']],
  ['Codex CLI parser and status smoke', process.execPath, ['tools/codex-cli-parser-smoke.js']],
  ['Canonical goal, thinking, and current-output timeline smoke', process.execPath, ['tools/live-activity-timeline-smoke.js']],
  ['Codex CLI controls and native launch smoke', process.execPath, ['tools/codex-cli-controls-smoke.js']],
  ['Frontend history reconnect smoke', process.execPath, ['tools/frontend-history-reconnect-smoke.js']],
  ['Frontend transcript fidelity smoke', process.execPath, ['tools/frontend-transcript-fidelity-smoke.js']],
];

function runStage(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (output) process.stdout.write(`${output}\n`);
  if (result.error || result.status !== 0) {
    console.error(`FAIL ${label}: ${result.error?.message || `exit ${result.status}`}`);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${label}`);
}

for (const [label, command, args] of stages) runStage(label, command, args);

const synchronizedAssets = [
  ['frontend/hooks.jsx', 'relay-server/public/hooks.jsx'],
  ['frontend/dist/bundle.js', 'relay-server/public/dist/bundle.js'],
];
for (const [source, deployed] of synchronizedAssets) {
  assert.deepStrictEqual(
    fs.readFileSync(path.join(root, source)),
    fs.readFileSync(path.join(root, deployed)),
    `${deployed} must exactly match ${source}; run node frontend/build.js`,
  );
}
console.log('PASS Frontend source/build public asset synchronization');

const codex = resolveCodexCommand();
runStage('Codex CLI version', codex.command, [...codex.argsPrefix, '--version']);

const total = stages.length + 2;
console.log(`ALL CODEX CLI VALIDATION STAGES PASS (${total}/${total})`);
console.log('READ-ONLY PASS (no chats, prompts, controls, or service restarts were performed)');
