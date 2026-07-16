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

function packageVersion(packagePath) {
  if (!packagePath || !fs.existsSync(packagePath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return manifest.version ? String(manifest.version) : null;
  } catch {
    return null;
  }
}

const CODEX_TARGETS = {
  'linux-x64': ['x86_64-unknown-linux-musl', 'codex-linux-x64'],
  'linux-arm64': ['aarch64-unknown-linux-musl', 'codex-linux-arm64'],
  'darwin-x64': ['x86_64-apple-darwin', 'codex-darwin-x64'],
  'darwin-arm64': ['aarch64-apple-darwin', 'codex-darwin-arm64'],
  'win32-x64': ['x86_64-pc-windows-msvc', 'codex-win32-x64'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 'codex-win32-arm64'],
};

function codexPackageVersion(packageRoot, platform = process.platform, arch = process.arch) {
  const version = packageVersion(path.join(packageRoot || '', 'package.json'));
  const target = CODEX_TARGETS[`${platform}-${arch}`];
  if (!version || !target) return null;
  const [targetTriple, platformPackage] = target;
  const platformRoot = path.join(packageRoot, 'node_modules', '@openai', platformPackage);
  const platformVersion = packageVersion(path.join(platformRoot, 'package.json'));
  const executable = path.join(
    platformRoot,
    'vendor',
    targetTriple,
    'bin',
    platform === 'win32' ? 'codex.exe' : 'codex',
  );
  if (platformVersion !== `${version}-${platform}-${arch}` || !fs.existsSync(executable)) return null;
  return `codex-cli ${version}`;
}

function resolvedInstallVersion(resolved) {
  for (const candidate of [resolved?.command, ...(resolved?.argsPrefix || [])]) {
    if (!candidate) continue;
    const parts = path.resolve(candidate).split(path.sep);
    const versionsIndex = parts.findIndex(part => part.toLowerCase() === 'versions');
    if (versionsIndex >= 0 && parts[versionsIndex + 1]) return parts[versionsIndex + 1];
  }
  return null;
}

function extensionVersion(prefixes, roots = null) {
  const candidates = [];
  const extensionRoots = roots || [
    path.join(process.env.USERPROFILE || '', '.vscode', 'extensions'),
    path.join(process.env.USERPROFILE || '', '.antigravity', 'extensions'),
  ];
  for (const extensionRoot of extensionRoots) {
    if (!extensionRoot || !fs.existsSync(extensionRoot)) continue;
    for (const entry of fs.readdirSync(extensionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !prefixes.some(prefix => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))) continue;
      const packagePath = path.join(extensionRoot, entry.name, 'package.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (manifest.version) candidates.push(String(manifest.version));
      } catch { /* ignore incomplete extension updates */ }
    }
  }
  return candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true })).at(0) || null;
}

function appVersionWatchRoots() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  return [...new Set([
    path.join(localAppData, 'Programs', 'Antigravity'),
    path.join(localAppData, 'Programs', 'cursor'),
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'),
    path.join(appData, 'npm', 'node_modules', '@openai', 'codex'),
    path.join(process.env.USERPROFILE || '', '.vscode', 'extensions'),
    path.join(process.env.USERPROFILE || '', '.antigravity', 'extensions'),
  ].filter(rootPath => rootPath && fs.existsSync(rootPath)))];
}

// Windows recursive directory watchers can enter a permanent hot loop after an
// updater replaces the watched install directory. Watch stable parents without
// recursion and retain the periodic full inventory scan for nested changes.
function appVersionEventWatchRoots() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  return [...new Set([
    path.join(localAppData, 'Programs'),
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai'),
    path.join(appData, 'npm', 'node_modules', '@openai'),
    path.join(process.env.USERPROFILE || '', '.vscode', 'extensions'),
    path.join(process.env.USERPROFILE || '', '.antigravity', 'extensions'),
  ].filter(rootPath => rootPath && fs.existsSync(rootPath)))];
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
  const claudePackage = packageVersion(path.join(
    appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'));
  const codexPackage = codexPackageVersion(path.join(
    appData, 'npm', 'node_modules', '@openai', 'codex'));

  return {
    'antigravity-v2': fileVersion(antigravity) || 'unavailable',
    claude: extensionVersion(['anthropic.claude-code-']) || 'unavailable',
    'claude-cli': (claudePackage ? `${claudePackage} (Claude Code)` : null)
      || run(claude, ['--version']) || 'unavailable',
    codex: extensionVersion(['openai.chatgpt-']) || 'unavailable',
    'codex-cli': codexPackage || commandVersion(codexCli) || 'unavailable',
    'codex-desktop': codexDesktop || 'unavailable',
    'cursor-cli': resolvedInstallVersion(cursorCli) || commandVersion(cursorCli) || 'unavailable',
    continue: extensionVersion(['continue.continue-']) || 'unavailable',
    cursor: fileVersion(cursor) || 'unavailable',
    gemini: extensionVersion(['google.geminicodeassist-']) || 'unavailable',
    roo_code: extensionVersion(['rooveterinaryinc.roo-cline-']) || 'unavailable',
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(collectAppVersions(), null, 2)}\n`);
}

module.exports = {
  appVersionEventWatchRoots,
  appVersionWatchRoots,
  codexPackageVersion,
  collectAppVersions,
  commandVersion,
  extensionVersion,
  fileVersion,
  packageVersion,
  resolvedInstallVersion,
};
