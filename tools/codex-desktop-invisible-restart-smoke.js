#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const preflight = require('./codex-desktop-restart-preflight');

const root = path.join(__dirname, '..');
const launcher = fs.readFileSync(path.join(__dirname, 'codex-desktop-invisible-restart.ps1'), 'utf8');

assert.throws(() => preflight.parseArgs([]), /--owned-thread-id is required/);
assert.strictEqual(
  preflight.parseArgs(['--owned-thread-id', 'local:owned']).ownedThreadId,
  'local:owned',
);
for (const required of [
  "if ($Port -ne 9225)",
  'codex-desktop-invisible-restart-preflight',
  '$preflight.owned -ne $true -or $preflight.idle -ne $true',
  "if ($oldDesktop.CurrentHresult -ne 0",
  'WS_EX_NOACTIVATE',
  'Math.Min(-32000',
  'watchdog_interval_ms = 5',
  '[RacMsixLaunch]::Begin',
  '[RacCbtGuardHost]::Start',
  '[RacCodexWindowGuard]::StartEventGuard',
  '[RacCodexWindowGuard]::LockForeground()',
  '[RacCodexWindowGuard]::UnlockForeground()',
  '[RacCodexWindowGuard]::Sweep',
  '[RacCodexWindowGuard]::Reset()',
  'VisibleBeforeGuard',
  'EverForeground',
  'MoveWindowHandle:',
  '196d464fa0ea4fc5e7db3363aca1b94b7de8051a8b42eb6a7fab041193c9fbd4',
  'c70015d1cdfdaf7844d1c1f6653db8fa791c7bc1f328c93a6a215a9b9705d1d0',
  'MarkRelocatedAndSetBounds',
  '$result.primary_guarded_before_show = $true',
  '$result.primary_moved_after_offscreen_show = $true',
  '$finalDesktop.Cloak -eq 0',
]) {
  assert(launcher.includes(required), `launcher lost invariant: ${required}`);
}
assert(!launcher.includes('Start-Process'), 'launcher must not use a post-launch Start-Process hide');
assert(!launcher.includes('ShowWindowAsync'), 'launcher must not accept post-paint SW_HIDE');
assert(!launcher.includes('SW_HIDE'), 'launcher must not accept post-paint SW_HIDE');
assert(!launcher.includes('$result.visible_before_guard'), 'launcher must use the native primary guard result field');

console.log('Codex Desktop first-paint-invisible restart smoke passed');
