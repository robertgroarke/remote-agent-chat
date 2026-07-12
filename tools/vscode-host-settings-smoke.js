#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-vscode-host-settings-'));
  const appData = path.join(tempRoot, 'appdata');
  const vscodeRoot = path.join(tempRoot, 'disposable-vscode');
  const ambiguousRoot = path.join(tempRoot, 'ambiguous-vscode');
  const workspace = path.join(tempRoot, 'workspace');
  const vscodeSettings = path.join(vscodeRoot, 'User', 'settings.json');
  const ambiguousSettings = path.join(ambiguousRoot, 'User', 'settings.json');
  const antigravitySettings = path.join(appData, 'Antigravity', 'User', 'settings.json');
  const originalAppData = process.env.APPDATA;
  const originalRoots = process.env.VSCODE_USER_DATA_DIRS;

  try {
    fs.mkdirSync(workspace, { recursive: true });
    writeJson(path.join(vscodeRoot, 'User', 'globalStorage', 'storage.json'), {
      windowsState: { lastActiveWindow: { folder: `file:///${workspace.replace(/\\/g, '/')}` } },
    });
    writeJson(vscodeSettings, { 'update.mode': 'none', untouched: 'vscode' });
    writeJson(antigravitySettings, { untouched: 'antigravity' });
    process.env.APPDATA = appData;
    process.env.VSCODE_USER_DATA_DIRS = vscodeRoot;

    const engine = Object.create(ProxyEngine.prototype);
    const vscodeSession = { host_type: 'vscode', workspace_path: workspace };
    const resolved = engine._vsCodeSettingsPathForSession(vscodeSession);
    assert.equal(path.resolve(resolved), path.resolve(vscodeSettings));
    assert.deepEqual(
      engine._writeWorkbenchSetting(vscodeSession, 'claudeCode.initialPermissionMode', 'plan'),
      { ok: true, path: vscodeSettings, host: 'VS Code' },
    );
    assert.equal(JSON.parse(fs.readFileSync(vscodeSettings, 'utf8'))['claudeCode.initialPermissionMode'], 'plan');
    assert.equal(JSON.parse(fs.readFileSync(antigravitySettings, 'utf8'))['claudeCode.initialPermissionMode'], undefined,
      'a VS Code-hosted control must never mutate Antigravity settings');

    writeJson(path.join(ambiguousRoot, 'User', 'globalStorage', 'storage.json'), {
      windowsState: { lastActiveWindow: { folder: `file:///${workspace.replace(/\\/g, '/')}` } },
    });
    writeJson(ambiguousSettings, { untouched: 'ambiguous' });
    process.env.VSCODE_USER_DATA_DIRS = [vscodeRoot, ambiguousRoot].join(path.delimiter);
    assert.equal(engine._vsCodeSettingsPathForSession(vscodeSession), null,
      'ambiguous profile ownership must fail closed');
    assert.equal(engine._writeWorkbenchSetting(vscodeSession, 'claudeCode.initialPermissionMode', 'default').ok, false);

    const antigravitySession = { host_type: 'antigravity_ide', workspace_path: workspace };
    assert.equal(engine._writeWorkbenchSetting(antigravitySession, 'claudeCode.initialPermissionMode', 'acceptEdits').ok, true);
    assert.equal(JSON.parse(fs.readFileSync(antigravitySettings, 'utf8'))['claudeCode.initialPermissionMode'], 'acceptEdits');

    console.log(JSON.stringify({
      ok: true,
      vscode_profile_scoped: true,
      ambiguous_profile_fails_closed: true,
      antigravity_route_preserved: true,
    }, null, 2));
  } finally {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalRoots === undefined) delete process.env.VSCODE_USER_DATA_DIRS;
    else process.env.VSCODE_USER_DATA_DIRS = originalRoots;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { main };
