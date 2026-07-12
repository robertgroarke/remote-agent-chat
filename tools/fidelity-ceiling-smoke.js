#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const docPath = path.join(root, 'docs', 'HARNESS_FIDELITY_CEILINGS.md');
const backlogPath = path.join(root, 'HARNESS_MATURITY_PHASE2_BACKLOG.md');
const source = fs.readFileSync(docPath, 'utf8');
const backlog = fs.readFileSync(backlogPath, 'utf8');

const requiredAgentTypes = [
  'claude',
  'codex',
  'antigravity_panel',
  'antigravity-v2',
  'codex-desktop',
  'cursor',
  'claude_cli',
  'codex_cli',
  'cursor_cli',
  'gemini',
  'continue',
  'roo_code',
];

for (const agentType of requiredAgentTypes) {
  assert.match(backlog, new RegExp('`' + agentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`'), `backlog inventory missing ${agentType}`);
  const tableMarker = new RegExp('\\|[^\\n]*`' + agentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`[^\\n]*\\|');
  assert.match(source, tableMarker, `fidelity ceiling missing ${agentType}`);
}

for (const invariant of [
  'content, order, semantic type, state, and default',
  'Desktop transcripts reflow at mobile widths',
  'must never invent a visual clone',
  'desktop plus 390-pixel crops',
  'Model choice does not define the surface',
  'Never replace missing native evidence',
]) {
  assert(source.includes(invariant), `global fidelity invariant missing: ${invariant}`);
}

const harnessRows = source.split(/\r?\n/).filter(line => /^\| [^|-].*`[^`]+`.*\|$/.test(line));
assert.strictEqual(harnessRows.length, requiredAgentTypes.length, 'expected exactly one fidelity-ceiling row per harness');
for (const row of harnessRows) {
  assert.strictEqual((row.match(/\|/g) || []).length, 6, `malformed fidelity-ceiling table row: ${row}`);
}

console.log(`Harness fidelity ceiling smoke: PASS (${harnessRows.length} harnesses)`);
