'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  BoundedLogWriter,
  acquireProcessLock,
} = require('./bounded-process-supervisor');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-bounded-supervisor-'));

try {
  const maxBytes = 1024;
  const logPath = path.join(tempRoot, 'oversized.log');
  const original = Buffer.alloc(maxBytes * 5, 'a');
  Buffer.from('retained-tail').copy(original, original.length - 13);
  fs.writeFileSync(logPath, original);
  const writer = new BoundedLogWriter(logPath, maxBytes, 2);
  assert.equal(fs.statSync(logPath).size, 0, 'oversized current log must be truncated immediately');
  assert.equal(fs.statSync(`${logPath}.1`).size, maxBytes, 'only one bounded tail backup should survive normalization');
  assert(fs.readFileSync(`${logPath}.1`).subarray(-13).equals(Buffer.from('retained-tail')));

  for (let index = 0; index < 20; index += 1) writer.write(Buffer.alloc(300, String(index % 10)));
  const retainedLogs = [logPath, `${logPath}.1`, `${logPath}.2`].filter(file => fs.existsSync(file));
  assert(retainedLogs.every(file => fs.statSync(file).size <= maxBytes));
  assert(retainedLogs.reduce((sum, file) => sum + fs.statSync(file).size, 0) <= maxBytes * 3);

  const liveLockPath = path.join(tempRoot, 'live.lock');
  fs.writeFileSync(liveLockPath, `${process.pid}\nfixture\n`);
  const duplicate = acquireProcessLock(liveLockPath, 'fixture');
  assert.equal(duplicate.acquired, false, 'live supervisor lock must suppress a duplicate');
  assert.equal(duplicate.ownerPid, process.pid);

  const staleLockPath = path.join(tempRoot, 'stale.lock');
  fs.writeFileSync(staleLockPath, '2147483647\nstale\n');
  const replacement = acquireProcessLock(staleLockPath, 'fixture');
  assert.equal(replacement.acquired, true, 'stale supervisor lock must be recoverable');
  replacement.release();
  assert.equal(fs.existsSync(staleLockPath), false);

  const stdoutLog = path.join(tempRoot, 'child-out.log');
  const stderrLog = path.join(tempRoot, 'child-err.log');
  const childLock = path.join(tempRoot, 'child.lock');
  const supervisorPath = path.join(root, 'tools', 'bounded-process-supervisor.js');
  const childCode = "process.stdout.write('bounded-stdout'); process.stderr.write('bounded-stderr')";
  const result = spawnSync(process.execPath, [
    supervisorPath,
    '--name', 'smoke-child',
    '--cwd', root,
    '--stdout-log', stdoutLog,
    '--stderr-log', stderrLog,
    '--lock', childLock,
    '--max-bytes', String(maxBytes),
    '--backups', '2',
    '--exit-on-clean',
    '--', process.execPath, '-e', childCode,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert(fs.readFileSync(stdoutLog, 'utf8').includes('bounded-stdout'));
  assert(fs.readFileSync(stderrLog, 'utf8').includes('bounded-stderr'));
  assert.equal(fs.existsSync(childLock), false, 'clean supervisor exit must release its lock');

  for (const launcher of ['restart-proxy.bat', 'restart-rescue-proxy.bat', 'start-proxy.ps1']) {
    const source = fs.readFileSync(path.join(root, launcher), 'utf8');
    assert(source.includes('bounded-process-supervisor.js'), `${launcher} must use the bounded supervisor`);
  }

  console.log(JSON.stringify({
    ok: true,
    max_log_bytes: maxBytes,
    backup_count: 2,
    oversized_tail_retained: true,
    duplicate_suppressed: true,
    stale_lock_recovered: true,
    child_output_captured: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
