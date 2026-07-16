#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--read-only') {
  console.error('Codex extension validate-all only supports explicit --read-only mode.');
  process.exit(2);
}

const stages = [
  ['selector syntax', ['--check', 'agent-proxy/selectors.js']],
  ['proxy syntax', ['--check', 'agent-proxy/proxy-engine.js']],
  ['VS Code probe guard', ['tools/vscode-probe-guard-smoke.js']],
  ['extension runner disconnect safety', ['tools/vscode-extension-runner-smoke.js']],
  ['read-only update probe contract', ['tools/codex-vscode-readonly-update-contract.js']],
  ['thinking selector scope', ['tools/codex-thinking-scope-smoke.js']],
  ['config control gate', ['tools/vscode-codex-config-gate-smoke.js']],
  ['config request security', ['tools/codex-config-request-security-smoke.js']],
  ['config two-client relay routing', ['tools/codex-config-relay-two-client-e2e.js']],
  ['config race and reconnect lifecycle', ['tools/vscode-codex-config-race-smoke.js']],
  ['web and Android config parity', ['tools/vscode-codex-controls-ui-parity-smoke.js']],
  ['permission control gate', ['tools/vscode-codex-permission-gate-smoke.js']],
  ['status and compaction blocks', ['tools/codex-status-block-smoke.js']],
  ['frontend transcript fidelity', ['tools/frontend-transcript-fidelity-smoke.js']],
  ['live updated extension passive probe', ['tools/codex-vscode-readonly-update-e2e.js', '--read-only']],
];

for (const [label, commandArgs] of stages) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 20_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (output) process.stdout.write(`${output}\n`);
  if (result.error || result.status !== 0) {
    console.error(`Codex extension validate-all failed: ${label} (${result.error?.message || `exit ${result.status}`})`);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${label}`);
}

console.log(`Codex extension validate-all: PASS (${stages.length}/${stages.length})`);
console.log('READ-ONLY PASS (no transcript content, chats, controls, reloads, focus, or windows)');
