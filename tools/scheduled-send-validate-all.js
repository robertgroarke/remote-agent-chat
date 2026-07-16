#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let readOnly = false;
let resultFile = '';
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--read-only') readOnly = true;
  else if (args[index] === '--result-file' && args[index + 1]) resultFile = path.resolve(args[++index]);
  else {
    console.error(`Unknown or incomplete argument: ${args[index]}`);
    process.exit(2);
  }
}
if (!readOnly) {
  console.error('Scheduled-send validation is isolated/read-only; pass --read-only explicitly.');
  process.exit(2);
}

const stages = [
  'scheduled-send-store-smoke.js',
  'scheduled-send-owner-isolation-e2e.js',
  'scheduled-send-relay-e2e.js',
  'scheduled-send-browser-e2e.js',
];
const results = [];
for (const script of stages) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [path.join(ROOT, 'tools', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 45_000,
  });
  const durationMs = Date.now() - startedAt;
  if (child.error) throw child.error;
  assert.equal(child.signal, null, `${script} terminated by ${child.signal}`);
  assert.equal(child.status, 0, `${script} failed:\n${child.stdout || ''}\n${child.stderr || ''}`);
  results.push({ script, duration_ms: durationMs, status: 'pass' });
}

const result = {
  ok: true,
  read_only: true,
  isolated_relay_only: true,
  stages: results,
  production_mutations: 0,
  visible_windows_opened: 0,
  protected_user_apps_touched: 0,
  generated_at: new Date().toISOString(),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (resultFile) {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, serialized, 'utf8');
}
process.stdout.write(serialized);
