#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-desktop-lock-smoke-'));
process.env.CODEX_DESKTOP_CDP_LOCK_PATH = path.join(tempRoot, 'codex-desktop-cdp.lock');
const {
  LOCK_PATH,
  acquireCodexDesktopCdpLock,
} = require('../agent-proxy/codex-desktop-cdp-lock');

async function main() {
  const releaseFirst = await acquireCodexDesktopCdpLock('smoke-first', { waitMs: 90000, staleMs: 60000 });
  assert.equal(typeof releaseFirst, 'function', 'first caller must acquire the CDP lock');
  const blocked = await acquireCodexDesktopCdpLock('smoke-blocked', { waitMs: 100 });
  assert.equal(blocked, null, 'second process lane must fail closed while the lock is held');
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(LOCK_PATH, old, old);
  const liveButOld = await acquireCodexDesktopCdpLock('smoke-live-old', { waitMs: 100, staleMs: 60000 });
  assert.equal(liveButOld, null, 'an old lock with a live owner must remain locked');
  releaseFirst();

  fs.writeFileSync(LOCK_PATH, JSON.stringify({
    token: 'dead-owner',
    pid: 2147483647,
    label: 'smoke-dead-owner',
    acquired_at: new Date().toISOString(),
  }));
  const releaseSecond = await acquireCodexDesktopCdpLock('smoke-second', { waitMs: 100 });
  assert.equal(typeof releaseSecond, 'function', 'a fresh lock owned by a dead PID must be reclaimed immediately');
  releaseSecond();
  console.log('Codex Desktop CDP lock smoke: PASS (live owner preserved, dead owner reclaimed)');
}

main().catch(error => {
  console.error(`Codex Desktop CDP lock smoke: FAIL (${error.message})`);
  process.exit(1);
}).finally(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
