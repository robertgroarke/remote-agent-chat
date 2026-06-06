#!/usr/bin/env node
'use strict';
// Quick throwaway probe smoke (read-only + short mutating). Exit 0 if all pass.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', 'agent-proxy');
const probes = [
  'probe-cursor-config-quick.js',
  'probe-cursor-targeted.js',
  'probe-cursor-live-send.js RAC_SMOKE',
  'probe-cursor-interrupt.js',
];

let failed = 0;
for (const spec of probes) {
  const [script, ...args] = spec.split(' ');
  const r = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
  const ok = r.status === 0;
  console.log(ok ? 'PASS' : 'FAIL', script, r.status);
  if (!ok) {
    failed += 1;
    if (r.stdout) process.stdout.write(r.stdout.slice(-500));
    if (r.stderr) process.stderr.write(r.stderr.slice(-500));
  }
}
process.exit(failed ? 1 : 0);
