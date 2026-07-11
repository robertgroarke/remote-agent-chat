#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  acquireCodexDesktopCdpLock,
} = require('../agent-proxy/codex-desktop-cdp-lock');

async function main() {
  const releaseFirst = await acquireCodexDesktopCdpLock('smoke-first', { waitMs: 90000, staleMs: 60000 });
  assert.equal(typeof releaseFirst, 'function', 'first caller must acquire the CDP lock');
  const blocked = await acquireCodexDesktopCdpLock('smoke-blocked', { waitMs: 100 });
  assert.equal(blocked, null, 'second process lane must fail closed while the lock is held');
  releaseFirst();
  const releaseSecond = await acquireCodexDesktopCdpLock('smoke-second', { waitMs: 100 });
  assert.equal(typeof releaseSecond, 'function', 'lock must be reacquirable after release');
  releaseSecond();
  console.log('Codex Desktop CDP lock smoke: PASS');
}

main().catch(error => {
  console.error(`Codex Desktop CDP lock smoke: FAIL (${error.message})`);
  process.exit(1);
});
