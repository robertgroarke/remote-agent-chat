#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const claudeCli = require('../agent-proxy/claude-cli');

function usage() {
  console.error([
    'Usage:',
    '  ollama launch claude --model <model> [--cwd <path>] [--permission-mode <mode>] [--effort <low|medium|high>] [--dry-run] [-- <extra claude args>]',
    '',
    'Example:',
    '  ollama launch claude --model deepseek-v4-pro:cloud',
  ].join('\n'));
}

function takeOption(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const value = args[idx + 1];
  args.splice(idx, 2);
  return value || '';
}

function realOllamaPath() {
  const candidates = [
    process.env.OLLAMA_REAL_EXE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const found = spawnSync('where.exe', ['ollama'], { encoding: 'utf8' });
  if (found.status === 0) {
    const selfDir = path.resolve(__dirname, '..').toLowerCase();
    for (const line of found.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      if (!line.toLowerCase().startsWith(selfDir) && fs.existsSync(line)) return line;
    }
  }
  return null;
}

function delegateToOllama(args) {
  const exe = realOllamaPath();
  if (!exe) {
    console.error('Could not find real Ollama executable. Set OLLAMA_REAL_EXE to its path.');
    process.exit(1);
  }
  const child = spawn(exe, args, { stdio: 'inherit', shell: false });
  child.on('exit', code => process.exit(code ?? 0));
}

function launchClaude(args) {
  const model = takeOption(args, '--model') || takeOption(args, '-m');
  const workspacePath = takeOption(args, '--cwd') || takeOption(args, '--workspace') || process.cwd();
  const permissionMode = takeOption(args, '--permission-mode') || undefined;
  const effort = takeOption(args, '--effort') || undefined;
  const dryRun = args.includes('--dry-run');
  if (dryRun) args.splice(args.indexOf('--dry-run'), 1);
  const sep = args.indexOf('--');
  const extraArgs = sep >= 0 ? args.slice(sep + 1) : args;
  if (!model) {
    usage();
    process.exit(2);
  }
  if (dryRun) {
    console.log(JSON.stringify({ command: 'claude', model, workspacePath, permissionMode, effort, extraArgs }, null, 2));
    return;
  }
  const child = claudeCli.startInteractiveClaude({
    workspacePath,
    model,
    effort,
    permissionMode,
    extraArgs,
  });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => {
    console.error(`Failed to launch Claude CLI: ${err.message}`);
    process.exit(1);
  });
}

function main(argv) {
  if (argv[0] === 'launch' && (argv[1] === 'claude' || argv[1] === 'claude-cli' || argv[1] === 'claude_code')) {
    launchClaude(argv.slice(2));
    return;
  }
  delegateToOllama(argv);
}

main(process.argv.slice(2));
