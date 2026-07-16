'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_PATH = path.resolve(
  process.env.CODEX_DESKTOP_CDP_LOCK_PATH
    || path.join(os.tmpdir(), 'remote-agent-chat-codex-desktop-cdp.lock'),
);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function removeStaleLock(staleMs) {
  try {
    const stat = fs.statSync(LOCK_PATH);
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')); } catch {}
    if (owner?.pid && processIsAlive(owner.pid)) return false;
    if (!owner?.pid && Date.now() - stat.mtimeMs <= staleMs) return false;
    fs.unlinkSync(LOCK_PATH);
    return true;
  } catch (_) {
    return false;
  }
}

async function acquireCodexDesktopCdpLock(label, options = {}) {
  if (process.env.CODEX_DESKTOP_CDP_LOCK_HELD === '1') return () => {};
  const waitMs = Math.max(0, Number(options.waitMs ?? 0));
  const pollMs = Math.max(20, Number(options.pollMs || 50));
  const staleMs = Math.max(60000, Number(options.staleMs || 120000));
  const deadline = Date.now() + waitMs;
  const token = crypto.randomBytes(12).toString('hex');

  while (true) {
    let fd = null;
    try {
      fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, label, acquired_at: new Date().toISOString() }));
      fs.closeSync(fd);
      fd = null;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
          if (current.token === token) fs.unlinkSync(LOCK_PATH);
        } catch (_) {}
      };
    } catch (error) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
      if (error.code !== 'EEXIST') throw error;
      if (removeStaleLock(staleMs)) continue;
      if (Date.now() >= deadline) return null;
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

async function withCodexDesktopCdpLock(label, fn, options = {}) {
  if (process.env.CODEX_DESKTOP_CDP_LOCK_HELD === '1') return fn();
  const release = await acquireCodexDesktopCdpLock(label, options);
  if (!release) {
    const error = new Error(`Codex Desktop CDP lock busy after ${Number(options.waitMs || 0)}ms`);
    error.code = 'CODEX_DESKTOP_CDP_LOCK_BUSY';
    throw error;
  }
  const prior = process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
  process.env.CODEX_DESKTOP_CDP_LOCK_HELD = '1';
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
    else process.env.CODEX_DESKTOP_CDP_LOCK_HELD = prior;
    release();
  }
}

module.exports = {
  LOCK_PATH,
  acquireCodexDesktopCdpLock,
  processIsAlive,
  withCodexDesktopCdpLock,
};
