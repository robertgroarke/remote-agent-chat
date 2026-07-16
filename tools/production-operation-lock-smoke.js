#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-soak-lock-'));
process.env.RAC_OPERATION_LOCK_FILE = path.join(tempRoot, 'operation.lock');
process.env.RAC_SOAK_RUN_LOCK_FILE = path.join(tempRoot, 'soak.lock');

const runner = require('./production-harness-overnight-soak');

try {
  const release = runner.acquireRunLock();
  const operation = JSON.parse(fs.readFileSync(runner.OPERATION_LOCK_PATH, 'utf8'));
  assert.strictEqual(operation.pid, process.pid);
  assert.strictEqual(operation.kind, 'production-soak');
  assert.strictEqual(Number(fs.readFileSync(runner.RUN_LOCK_PATH, 'utf8').trim()), process.pid);
  assert.throws(() => runner.acquireRunLock(), /production operation lock is held/);
  const blockedDeploy = spawnSync('python', [
    path.join(__dirname, '..', 'deploy_lock.py'),
    '--timeout', '0',
    '--lock-file', runner.OPERATION_LOCK_PATH,
    '--agent', 'operation-lock-smoke',
    'python', '-c', 'print("unexpected deploy")',
  ], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(blockedDeploy.status, 1);
  assert.match(blockedDeploy.stderr, /deploy is prohibited until the soak exits/);
  release();
  assert(!fs.existsSync(runner.OPERATION_LOCK_PATH));
  assert(!fs.existsSync(runner.RUN_LOCK_PATH));

  fs.writeFileSync(runner.OPERATION_LOCK_PATH, `${JSON.stringify({
    pid: 99999999,
    acquired_at: new Date().toISOString(),
    agent: 'dead-deploy',
    kind: 'deploy',
  })}\n`);
  const releaseRecovered = runner.acquireRunLock();
  assert.strictEqual(JSON.parse(fs.readFileSync(runner.OPERATION_LOCK_PATH, 'utf8')).pid, process.pid);
  releaseRecovered();
  console.log('production operation lock smoke: PASS');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
