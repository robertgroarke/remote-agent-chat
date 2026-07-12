#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCursorCommand } = require('../agent-proxy/cursor-cli');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const readOnly = args.includes('--read-only');
const sendLive = args.includes('--send-live');
if (args.some(arg => arg !== '--read-only' && arg !== '--send-live') || readOnly === sendLive) {
  console.error('Choose exactly one Cursor CLI validation mode: --read-only or --send-live.');
  process.exit(2);
}
const stages = [
  ['Cursor CLI parser syntax', process.execPath, ['--check', 'agent-proxy/cursor-cli.js']],
  ['Proxy engine syntax', process.execPath, ['--check', 'agent-proxy/proxy-engine.js']],
  ['Session store syntax', process.execPath, ['--check', 'agent-proxy/session-store.js']],
  ['Protocol syntax', process.execPath, ['--check', 'agent-proxy/protocol.js']],
  ['Cursor CLI parser, lifecycle, and quoted-tool smoke', process.execPath,
    ['tools/cursor-cli-parser-smoke.js', ...(readOnly ? ['--read-only'] : [])]],
  ['Cursor CLI controls and interrupt smoke', process.execPath, ['tools/cursor-cli-controls-smoke.js']],
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

const cursor = resolveCursorCommand();
assert(cursor, 'Cursor Agent CLI not found');
runStage('Cursor Agent CLI version', cursor.command, [...cursor.argsPrefix, '--version']);

const total = stages.length + 2;
console.log(`ALL CURSOR CLI VALIDATION STAGES PASS (${total}/${total})`);
if (readOnly) console.log('READ-ONLY PASS (live CLI send/resume/tool stages were intentionally not run)');
