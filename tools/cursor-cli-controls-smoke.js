'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const cursorCli = require('../agent-proxy/cursor-cli');

assert.equal(typeof cursorCli.buildNativeCursorWindowPowerShell, 'function');
assert.equal(typeof cursorCli.stopCursorExecSession, 'function');
assert.equal(typeof cursorCli.shouldApplyCursorSummaryHistory, 'function');
assert.equal(cursorCli.shouldApplyCursorSummaryHistory({ messages: [] }, false), false);
assert.equal(cursorCli.shouldApplyCursorSummaryHistory({ messages: [{ role: 'user', content: 'real' }] }, false), true);
assert.equal(cursorCli.shouldApplyCursorSummaryHistory({ messages: [] }, true), true);
assert.deepEqual(cursorCli.stopCursorExecSession(null), {
  ok: false,
  detail: 'No owned Cursor CLI process to stop',
});
const handoff = cursorCli.buildNativeCursorWindowPowerShell({
  cwd: 'c:\\temp\\cursor-test',
  launcherPath: 'c:\\temp\\remote-agent-cursor-cli-fixture.cmd',
});
assert.match(handoff, /Start-Process/);
assert.match(handoff, /cmd\.exe/);
assert.match(handoff, /-WorkingDirectory/);
assert.match(handoff, /-ArgumentList '\/k', 'c:\\temp\\remote-agent-cursor-cli-fixture\.cmd'/);
assert.match(handoff, /-WindowStyle Normal/);
assert.match(handoff, /-PassThru \| Select-Object -ExpandProperty Id/);

const cursorSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'cursor-cli.js'), 'utf8');
assert.doesNotMatch(cursorSource, /spawn\('wt\.exe'/, 'native Cursor CLI must not use an unverified wt.exe wrapper PID');
assert.match(cursorSource, /permissionMode === 'plan'.*args\.push\('--mode', 'plan'\)/s);
assert.match(cursorSource, /permissionMode === 'ask'.*args\.push\('--mode', 'ask'\)/s);
assert.match(cursorSource, /permissionMode === 'force'.*args\.push\('--force'\)/s);
assert.match(cursorSource, /sandbox === 'enabled'.*args\.push\('--sandbox', 'enabled'\)/s);
assert.match(cursorSource, /const ps1Path = commandPath\.replace/);
assert.match(cursorSource, /if \(existingFile\(ps1Path\)\) return commandForPath\(ps1Path\)/);
assert.match(cursorSource, /function resolveVersionedCursorCommand\(agentRoot\)/);
assert.match(cursorSource, /latest \? \{ command: latest\.node, argsPrefix: \[latest\.index\], shell: false \} : null/);

const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
assert.ok(
  (proxySource.match(/permissionMode: (?:newSession|sessionData)\.permission_mode|permissionMode,/g) || []).length >= 3,
  'every Cursor native launch path must carry the selected permission mode',
);
assert.ok(
  (proxySource.match(/sandbox: (?:newSession|sessionData|session)\.sandbox/g) || []).length >= 3,
  'every Cursor native launch path must carry the selected sandbox mode',
);
assert.match(proxySource, /cursorCli\.stopCursorExecSession\(sessionData\[childKey\]\)/);
assert.match(proxySource, /cursor_cli_interrupted: true/);
assert.match(proxySource, /const nextActivity = session\._cursorCliInterrupted === true\s*\? \{ kind: 'idle', label: 'Interrupted'/);
assert.doesNotMatch(proxySource, /permission_dialogs:[^\n]*isCursorCli/);
assert.match(proxySource, /permission_mode_change:[^\n]*isCursorCli/);

console.log('cursor cli controls smoke: PASS');
