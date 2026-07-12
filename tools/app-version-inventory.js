#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCodexCommand } = require('../agent-proxy/codex-cli');
const { resolveCursorCommand } = require('../agent-proxy/cursor-cli');

function run(command, args, timeout = 15000) {
  if (!command) return null;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || null;
}

function powershell(script) {
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  return run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]);
}

function fileVersion(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const escaped = filePath.replace(/'/g, "''");
  return powershell(`(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`);
}

function commandVersion(resolved) {
  if (!resolved?.command) return null;
  return run(resolved.command, [...(resolved.argsPrefix || []), '--version']);
}

function collectAppVersions() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const antigravity = process.env.ANTIGRAVITY_EXE || path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
  const cursor = process.env.CURSOR_EXE || path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe');
  const claude = process.platform === 'win32'
    ? path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    : 'claude';
  const codexDesktop = powershell("(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Version).ToString()");
  const codexCli = resolveCodexCommand();
  const cursorCli = resolveCursorCommand();

  return {
    'antigravity-v2': fileVersion(antigravity) || 'unavailable',
    'claude-cli': run(claude, ['--version']) || 'unavailable',
    'codex-cli': commandVersion(codexCli) || 'unavailable',
    'codex-desktop': codexDesktop || 'unavailable',
    'cursor-cli': commandVersion(cursorCli) || 'unavailable',
    cursor: fileVersion(cursor) || 'unavailable',
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(collectAppVersions(), null, 2)}\n`);
}

module.exports = { collectAppVersions, commandVersion, fileVersion };
