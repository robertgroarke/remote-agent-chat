#!/usr/bin/env node
'use strict';
// Run all Cursor throwaway E2E harnesses (sequential). Exit 1 if any fail.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const scripts = [
  'cursor-accumulator-smoke.js',
  'cursor-restart-identity-smoke.js',
  'cursor-agent-identity-smoke.js',
  'cursor-capability-contract-smoke.js',
  'frontend-terminal-input-smoke.js',
  'frontend-model-control-smoke.js',
  'frontend-cursor-new-chat-smoke.js',
  'cursor-capabilities-check.js',
  'cursor-phase2-smoke.js',
  'cursor-web-e2e.js',
  'cursor-terminal-input-e2e.js',
  'cursor-file-browser-e2e.js',
  'cursor-agent-switch-e2e.js',
  'cursor-new-chat-e2e.js',
  'cursor-model-e2e.js',
  'cursor-permission-e2e.js',
  'cursor-auto-approve-e2e.js',
];

function runScript(script, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
      env: process.env,
    });
    if (r.status === 0) return { ok: true, script };
    if (i < attempts - 1) {
      console.log('RETRY', script, `(exit ${r.status})`);
      spawnSync('python', ['proxy_restart_lock.py', '--agent', 'harness-restoration'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 120000,
      });
    } else {
      if (r.stdout) process.stdout.write(r.stdout.slice(-800));
      if (r.stderr) process.stderr.write(r.stderr.slice(-800));
      return { ok: false, script, status: r.status };
    }
  }
  return { ok: false, script };
}

let failed = 0;
for (const script of scripts) {
  const result = runScript(script);
  console.log(result.ok ? 'PASS' : 'FAIL', script, result.status || '');
  if (!result.ok) failed += 1;
}
console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
