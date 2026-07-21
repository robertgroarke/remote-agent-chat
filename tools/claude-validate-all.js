#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--read-only')) {
  console.error('Claude validate-all only supports --read-only.');
  process.exit(2);
}
const stages = [
  ['selectors syntax', ['--check', 'agent-proxy/selectors.js']],
  ['proxy syntax', ['--check', 'agent-proxy/proxy-engine.js']],
  ['extension persistent poll and send ownership', ['tools/claude-extension-desync-smoke.js']],
  ['relay syntax', ['--check', 'relay-server/index.js']],
  ['VS Code target guard', ['tools/vscode-probe-guard-smoke.js']],
  ['relay question answer contract', ['tools/relay-question-answers-smoke.js']],
  ['frontend transcript fidelity', ['tools/frontend-transcript-fidelity-smoke.js']],
  ['assistant markdown block mapping', ['tools/claude-markdown-block-smoke.js']],
  ['native Bash terminal mapping', ['tools/claude-native-terminal-parity-smoke.js']],
  ['completed tool prefix resync', ['tools/completed-prefix-mutation-smoke.js']],
  ['native terminal web/Android renderer', ['tools/claude-terminal-renderer-smoke.js']],
  ['question prompt fixture', ['tools/claude-question-prompt-smoke.js']],
  ['Android question prompt parity', ['tools/android-question-prompt-smoke.js']],
];

for (const [name, args] of stages) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) {
    console.error(`Claude validate-all failed: ${name}`);
    process.exit(result.status || 1);
  }
}
console.log(`Claude validate-all: PASS (${stages.length}/${stages.length})`);
