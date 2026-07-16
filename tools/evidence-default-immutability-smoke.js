#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const PATH_BOUNDARY = String.raw`(?:[\\/]|['"]\s*,\s*['"])`;
const DATED_EVIDENCE = new RegExp(
  String.raw`evidence${PATH_BOUNDARY}harness-(?:maturity|restoration)${PATH_BOUNDARY}20\d\d-\d\d-\d\d`,
);
const ALLOWED_READ_ONLY_REFERENCES = new Set([
  'add-disposable-vscode-windows-isolated.ps1',
  'claude-cli-native-conversation-style-smoke.js',
  'continue-browser-latency-aggregate.js',
  'evidence-path-smoke.js',
  'notification-preference-race-matrix.js',
  'structured-producer-coverage-smoke.js',
  'structured-producer-coverage-contract-smoke.js',
  'vscode-codex-disposable-control-latency.js',
  'vscode-codex-disposable-open-panels.js',
  'worktree-hygiene-smoke.js',
]);

const files = fs.readdirSync(TOOLS)
  .filter(name => /\.(?:js|ps1|py)$/.test(name))
  .sort();
const datedReferences = files.filter(name => DATED_EVIDENCE.test(fs.readFileSync(path.join(TOOLS, name), 'utf8')));
const unexpected = datedReferences.filter(name => !ALLOWED_READ_ONLY_REFERENCES.has(name));
assert.deepStrictEqual(unexpected, [], `dated evidence defaults remain outside the read-only allowlist: ${unexpected.join(', ')}`);

for (const name of ALLOWED_READ_ONLY_REFERENCES) {
  assert(datedReferences.includes(name), `stale evidence allowlist entry no longer needed: ${name}`);
}

process.stdout.write(`evidence default immutability smoke: PASS (${datedReferences.length} read-only/fixture files)\n`);
