#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const options = {
    name: 'process',
    cwd: process.cwd(),
    stdoutLog: null,
    stderrLog: null,
    lock: null,
    maxBytes: 10 * 1024 * 1024,
    backups: 3,
    restartDelayMs: 5000,
    exitOnClean: false,
    normalizeOnly: false,
    command: [],
  };
  let index = 0;
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.command = argv.slice(index + 1);
      break;
    }
    if (arg === '--exit-on-clean') options.exitOnClean = true;
    else if (arg === '--normalize-only') options.normalizeOnly = true;
    else if (arg === '--name' && argv[index + 1]) options.name = argv[++index];
    else if (arg === '--cwd' && argv[index + 1]) options.cwd = path.resolve(argv[++index]);
    else if (arg === '--stdout-log' && argv[index + 1]) options.stdoutLog = path.resolve(argv[++index]);
    else if (arg === '--stderr-log' && argv[index + 1]) options.stderrLog = path.resolve(argv[++index]);
    else if (arg === '--lock' && argv[index + 1]) options.lock = path.resolve(argv[++index]);
    else if (arg === '--max-bytes' && argv[index + 1]) options.maxBytes = Math.max(1024, Number(argv[++index]) || options.maxBytes);
    else if (arg === '--backups' && argv[index + 1]) options.backups = Math.max(0, Math.min(20, Number(argv[++index]) || 0));
    else if (arg === '--restart-delay-ms' && argv[index + 1]) options.restartDelayMs = Math.max(100, Number(argv[++index]) || options.restartDelayMs);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.stdoutLog || !options.stderrLog) throw new Error('--stdout-log and --stderr-log are required');
  if (!options.normalizeOnly && options.command.length === 0) throw new Error('A command is required after --');
  return options;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireProcessLock(lockPath, name = 'process') {
  if (!lockPath) return { acquired: true, release() {} };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(handle, `${process.pid}\n${name}\n${new Date().toISOString()}\n`, 'utf8');
      let released = false;
      return {
        acquired: true,
        release() {
          if (released) return;
          released = true;
          try { fs.closeSync(handle); } catch {}
          try {
            const owner = Number.parseInt(fs.readFileSync(lockPath, 'utf8').split(/\r?\n/, 1)[0], 10);
            if (owner === process.pid) fs.unlinkSync(lockPath);
          } catch {}
        },
      };
    } catch (error) {
      if (handle !== undefined) try { fs.closeSync(handle); } catch {}
      if (error.code !== 'EEXIST') throw error;
      let ownerPid = 0;
      try { ownerPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').split(/\r?\n/, 1)[0], 10); } catch {}
      if (processIsAlive(ownerPid)) return { acquired: false, ownerPid, release() {} };
      try { fs.unlinkSync(lockPath); } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  throw new Error(`Could not acquire ${name} supervisor lock: ${lockPath}`);
}

class BoundedLogWriter {
  constructor(filePath, maxBytes, backups) {
    this.filePath = path.resolve(filePath);
    this.maxBytes = Math.max(1024, Number(maxBytes) || 10 * 1024 * 1024);
    this.backups = Math.max(0, Number(backups) || 0);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._normalizeOversizedFile();
    this.size = this._size(this.filePath);
  }

  _size(filePath) {
    try { return fs.statSync(filePath).size; } catch { return 0; }
  }

  _backupPath(index) {
    return `${this.filePath}.${index}`;
  }

  _shiftBackups() {
    if (this.backups <= 0) return;
    try { fs.unlinkSync(this._backupPath(this.backups)); } catch {}
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      const source = this._backupPath(index);
      const destination = this._backupPath(index + 1);
      if (!fs.existsSync(source)) continue;
      try { fs.renameSync(source, destination); } catch {}
    }
  }

  _readTail(filePath, bytes) {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, bytes);
    const buffer = Buffer.allocUnsafe(length);
    const fd = fs.openSync(filePath, 'r');
    try { fs.readSync(fd, buffer, 0, length, stat.size - length); } finally { fs.closeSync(fd); }
    return buffer;
  }

  _normalizeOversizedFile() {
    const size = this._size(this.filePath);
    if (size <= this.maxBytes) return;
    const tail = this.backups > 0 ? this._readTail(this.filePath, this.maxBytes) : null;
    this._shiftBackups();
    if (tail) fs.writeFileSync(this._backupPath(1), tail);
    fs.writeFileSync(this.filePath, '');
  }

  _rotate() {
    if (this.backups > 0) {
      this._shiftBackups();
      if (fs.existsSync(this.filePath)) {
        try { fs.renameSync(this.filePath, this._backupPath(1)); } catch {
          const tail = this._readTail(this.filePath, this.maxBytes);
          fs.writeFileSync(this._backupPath(1), tail);
          fs.writeFileSync(this.filePath, '');
        }
      }
    } else {
      fs.writeFileSync(this.filePath, '');
    }
    this.size = 0;
  }

  write(chunk) {
    let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (data.length >= this.maxBytes) {
      this._rotate();
      data = data.subarray(data.length - this.maxBytes);
    } else if (this.size + data.length > this.maxBytes) {
      this._rotate();
    }
    fs.appendFileSync(this.filePath, data);
    this.size += data.length;
  }
}

function timestampLine(message) {
  return `[${new Date().toISOString()}] [supervisor] ${message}\n`;
}

function runSupervisor(options) {
  if (options.normalizeOnly) {
    new BoundedLogWriter(options.stdoutLog, options.maxBytes, options.backups);
    new BoundedLogWriter(options.stderrLog, options.maxBytes, options.backups);
    return Promise.resolve(0);
  }

  const lock = acquireProcessLock(options.lock, options.name);
  // Acquire ownership before touching shared logs. Concurrent scheduled-task
  // launches otherwise race while normalizing or rotating the same files.
  if (!lock.acquired) return Promise.resolve(0);

  const stdout = new BoundedLogWriter(options.stdoutLog, options.maxBytes, options.backups);
  const stderr = new BoundedLogWriter(options.stderrLog, options.maxBytes, options.backups);

  let child = null;
  let restartTimer = null;
  let shuttingDown = false;
  const release = () => lock.release();
  process.once('exit', release);

  return new Promise(resolve => {
    const finish = code => {
      if (restartTimer) clearTimeout(restartTimer);
      release();
      resolve(code);
    };
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (child && !child.killed) {
        try { child.kill(); } catch {}
        setTimeout(() => finish(0), 2000).unref?.();
      } else {
        finish(0);
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    const launch = () => {
      if (shuttingDown) return finish(0);
      const [command, ...args] = options.command;
      stdout.write(timestampLine(`Starting ${options.name}.`));
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', chunk => stdout.write(chunk));
      child.stderr.on('data', chunk => stderr.write(chunk));
      child.on('error', error => stderr.write(timestampLine(`${options.name} spawn failed: ${error.message}`)));
      child.on('close', code => {
        child = null;
        if (shuttingDown) return finish(0);
        const exitCode = Number.isInteger(code) ? code : 1;
        if (options.exitOnClean && exitCode === 0) {
          stderr.write(timestampLine(`${options.name} exited cleanly; supervisor stopping.`));
          return finish(0);
        }
        stderr.write(timestampLine(`${options.name} exited with code ${exitCode}; restarting in ${options.restartDelayMs} ms.`));
        restartTimer = setTimeout(() => {
          restartTimer = null;
          launch();
        }, options.restartDelayMs);
      });
    };
    launch();
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const exitCode = await runSupervisor(options);
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  BoundedLogWriter,
  acquireProcessLock,
  parseArgs,
  processIsAlive,
  runSupervisor,
};
