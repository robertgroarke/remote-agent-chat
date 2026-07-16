#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--read-only')) {
  console.error('Claude CLI validate-all only supports --read-only.');
  process.exit(2);
}
const claudeCommand = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  : 'claude';
const stages = [
  ['Claude parser syntax', process.execPath, ['--check', 'agent-proxy/claude-cli.js']],
  ['Proxy engine syntax', process.execPath, ['--check', 'agent-proxy/proxy-engine.js']],
  ['Session store syntax', process.execPath, ['--check', 'agent-proxy/session-store.js']],
  ['Claude parser smoke', process.execPath, ['tools/claude-cli-parser-smoke.js']],
  ['Claude sparse archive performance', process.execPath, ['tools/claude-cli-sparse-archive-smoke.js']],
  ['Claude controls smoke', process.execPath, ['tools/claude-cli-controls-smoke.js']],
  ['Frontend history reconnect smoke', process.execPath, ['tools/frontend-history-reconnect-smoke.js']],
  ['Frontend transcript fidelity smoke', process.execPath, ['tools/frontend-transcript-fidelity-smoke.js']],
  ['Claude CLI version', claudeCommand, ['--version']],
];

for (const [label, command, args] of stages) {
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

console.log(`ALL CLAUDE CLI VALIDATION STAGES PASS (${stages.length}/${stages.length})`);
console.log('READ-ONLY PASS (no chats, prompts, controls, or service restarts were performed)');
