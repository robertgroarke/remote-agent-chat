'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLAUDE_CLI_MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet',  label: 'Sonnet' },
  { id: 'opus',    label: 'Opus' },
  { id: 'deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)' },
];

const CLAUDE_CLI_EFFORTS = [
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
];

const CLAUDE_CLI_PERMISSION_MODES = [
  { value: 'default',           label: 'Default' },
  { value: 'acceptEdits',       label: 'Accept edits' },
  { value: 'auto',              label: 'Auto' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
  { value: 'dontAsk',           label: 'Do not ask' },
  { value: 'plan',              label: 'Plan' },
];

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function projectsDir() {
  return path.join(homeDir(), '.claude', 'projects');
}

function decodeProjectDirName(name) {
  if (!name || typeof name !== 'string') return null;
  const normalized = name.replace(/\s+/g, '-');
  const m = normalized.match(/^([a-zA-Z])--(.+)$/);
  if (!m) return name.replace(/-/g, path.sep);
  return `${m[1].toUpperCase()}:\\${m[2].replace(/-/g, '\\')}`;
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function walkJsonlFiles(root, maxFiles) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.toLowerCase() === 'memory') continue;
        stack.push(full);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.jsonl')) {
        const st = safeStat(full);
        if (st) out.push({ filePath: full, stat: st });
      }
    }
  }
  out.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return out.slice(0, maxFiles);
}

function extractTextFromPart(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) return part.content.map(extractTextFromPart).filter(Boolean).join('\n');
  if (part.type === 'image') return '[Image]';
  return '';
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || '');
  }
}

function formatToolUse(part) {
  const name = part?.name || 'tool';
  const input = part?.input && typeof part.input === 'object' ? compactJson(part.input) : extractTextFromPart(part?.input);
  return `[Tool: ${name}]\n\n${input ? `\`\`\`json\n${input}\n\`\`\`` : ''}`.trim();
}

function formatToolResult(part, entry) {
  let text = extractTextFromPart(part);
  if (!text && entry?.toolUseResult) {
    const result = entry.toolUseResult;
    const bits = [];
    if (typeof result.stdout === 'string' && result.stdout) bits.push(result.stdout);
    if (typeof result.stderr === 'string' && result.stderr) bits.push(result.stderr);
    if (result.interrupted) bits.push('[Interrupted]');
    text = bits.join('\n');
  }
  const label = part?.is_error ? 'Tool error' : 'Tool result';
  return `[${label}]\n\n${text || '(no output)'}`;
}

function messageContentToText(entry) {
  const msg = entry?.message;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === 'tool_use') parts.push(formatToolUse(part));
    else if (part.type === 'tool_result') parts.push(formatToolResult(part, entry));
    else {
      const text = extractTextFromPart(part);
      if (text) parts.push(text);
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

function parseClaudeJsonl(filePath) {
  let lines = [];
  try {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }

  const messages = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isSidechain) continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = messageContentToText(entry).trim();
    if (!content) continue;
    const isToolResult = entry.type === 'user' && (entry.sourceToolAssistantUUID || entry.toolUseResult);
    messages.push({
      role: isToolResult ? 'assistant' : entry.type,
      content,
      ts: entry.timestamp ? Math.floor(new Date(entry.timestamp).getTime() / 1000) : undefined,
    });
  }
  return messages;
}

function readSessionSummary(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const cliSessionId = path.basename(filePath, '.jsonl');
  const workspaceDirName = path.basename(path.dirname(filePath));
  const workspacePath = decodeProjectDirName(workspaceDirName);
  const workspaceName = workspacePath ? path.basename(workspacePath) : workspaceDirName;
  const messages = parseClaudeJsonl(filePath);
  const entrypoints = new Set();
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(0, 50)) {
      try {
        const entry = JSON.parse(line);
        if (entry.entrypoint) entrypoints.add(String(entry.entrypoint));
      } catch {}
    }
  } catch {}
  const entrypointList = Array.from(entrypoints);
  const isCliLike = entrypointList.length === 0
    || entrypointList.some(ep => !/vscode|ide|desktop/i.test(ep));
  const firstUser = messages.find(m => m.role === 'user');
  const title = (firstUser?.content || '').replace(/\s+/g, ' ').trim().substring(0, 80) || 'Claude CLI session';
  return {
    cliSessionId,
    filePath,
    workspacePath,
    workspaceName,
    title,
    messages,
    messageCount: messages.length,
    updatedAt: stat.mtime.toISOString(),
    entrypoints: entrypointList,
    isCliLike,
  };
}

function discoverSessions(limit = 40) {
  const root = projectsDir();
  if (!fs.existsSync(root)) return [];
  const includeVsCode = process.env.CLAUDE_CLI_INCLUDE_VSCODE === 'true';
  return walkJsonlFiles(root, limit)
    .map(item => readSessionSummary(item.filePath))
    .filter(summary => summary && (includeVsCode || summary.isCliLike));
}

function findSessionByCliId(cliSessionId) {
  if (!cliSessionId || typeof cliSessionId !== 'string') return null;
  const root = projectsDir();
  if (!fs.existsSync(root)) return null;
  const wanted = `${cliSessionId}.jsonl`.toLowerCase();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.toLowerCase() === 'memory') continue;
        stack.push(full);
      } else if (ent.isFile() && ent.name.toLowerCase() === wanted) {
        return readSessionSummary(full);
      }
    }
  }
  return null;
}

function isOllamaLaunchModel(model) {
  return typeof model === 'string' && /:cloud$/i.test(model);
}

function realOllamaPath() {
  const candidates = [
    process.env.OLLAMA_REAL_EXE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : null,
    path.join(homeDir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['ollama'], { encoding: 'utf8' });
    if (found.status === 0) {
      const repoRoot = path.resolve(__dirname, '..').toLowerCase();
      for (const line of found.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        const normalized = line.toLowerCase();
        if (!normalized.startsWith(repoRoot) && fs.existsSync(line)) return line;
      }
    }
  }
  return null;
}

function buildClaudeArgs({ cliSessionId, resume = true, model, effort, permissionMode, print = false, extraArgs = [], includeModel = true } = {}) {
  const args = [];
  if (print) args.push('--print', '--output-format', 'stream-json', '--include-partial-messages', '--verbose');
  if (cliSessionId) {
    args.push(resume ? '--resume' : '--session-id', cliSessionId);
  }
  if (includeModel && model && model !== 'default' && model !== 'unknown') args.push('--model', model);
  if (effort && effort !== 'unknown') args.push('--effort', effort);
  if (permissionMode && permissionMode !== 'unknown') args.push('--permission-mode', permissionMode);
  if (Array.isArray(extraArgs) && extraArgs.length > 0) args.push(...extraArgs);
  return args;
}

function buildSpawnCommand(args, { model } = {}) {
  if (isOllamaLaunchModel(model)) {
    const command = realOllamaPath();
    if (!command) throw new Error('Could not find the real Ollama executable for Ollama Cloud Claude launch.');
    return { command, spawnArgs: ['launch', 'claude', '--model', model, '--', ...args] };
  }
  const command = process.platform === 'win32' ? 'cmd.exe' : 'claude';
  const spawnArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'claude.cmd', ...args] : args;
  return { command, spawnArgs };
}

function quoteCmdArg(value) {
  const s = String(value ?? '');
  if (s.length === 0) return '""';
  return `"${s.replace(/"/g, '""')}"`;
}

function quotePowerShellString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function startClaudePrintSession({ workspacePath, cliSessionId, resume = true, content, model, effort, permissionMode, onStdout, onStderr, onExit }) {
  const useOllamaLaunch = isOllamaLaunchModel(model);
  const args = buildClaudeArgs({ cliSessionId, resume, model, effort, permissionMode, print: true, includeModel: !useOllamaLaunch });
  const { command, spawnArgs } = buildSpawnCommand(args, { model });
  const child = spawn(command, spawnArgs, {
    cwd: workspacePath || process.cwd(),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', chunk => onStdout && onStdout(chunk.toString('utf8')));
  child.stderr.on('data', chunk => onStderr && onStderr(chunk.toString('utf8')));
  child.on('close', code => onExit && onExit(code));
  child.on('error', err => onExit && onExit(-1, err));

  child.stdin.write(content || '');
  child.stdin.end();
  return child;
}

function startInteractiveClaude({ workspacePath, cliSessionId, resume = true, model, effort, permissionMode, extraArgs = [] } = {}) {
  const useOllamaLaunch = isOllamaLaunchModel(model);
  const args = buildClaudeArgs({ cliSessionId, resume, model, effort, permissionMode, extraArgs, includeModel: !useOllamaLaunch });
  const { command, spawnArgs } = buildSpawnCommand(args, { model });
  return spawn(command, spawnArgs, {
    cwd: workspacePath || process.cwd(),
    shell: false,
    stdio: 'inherit',
    windowsHide: false,
  });
}

function startNativeClaudeWindow({ workspacePath, cliSessionId, resume = true, model, effort, permissionMode, title } = {}) {
  const cwd = workspacePath || process.cwd();
  const useOllamaLaunch = isOllamaLaunchModel(model);
  const args = buildClaudeArgs({ cliSessionId, resume, model, effort, permissionMode, includeModel: !useOllamaLaunch });
  const { command, spawnArgs } = buildSpawnCommand(args, { model });

  if (process.platform !== 'win32') {
    return startInteractiveClaude({ workspacePath: cwd, cliSessionId, resume, model, effort, permissionMode });
  }

  const windowTitle = String(title || 'Claude Code CLI').replace(/["&<>|]/g, '').slice(0, 80) || 'Claude Code CLI';
  const nativeCommand = command === 'cmd.exe' ? 'claude.cmd' : command;
  const nativeArgs = command === 'cmd.exe' ? spawnArgs.slice(4) : spawnArgs;

  const launcherPath = path.join(os.tmpdir(), `remote-agent-claude-cli-${cliSessionId || Date.now()}.cmd`);
  const commandLine = [nativeCommand, ...nativeArgs].map(quoteCmdArg).join(' ');
  fs.writeFileSync(launcherPath, [
    '@echo off',
    `title ${windowTitle}`,
    `cd /d ${quoteCmdArg(cwd)}`,
    commandLine,
    '',
  ].join('\r\n'));

  const ps = [
    'Start-Process',
    '-FilePath', quotePowerShellString('cmd.exe'),
    '-WorkingDirectory', quotePowerShellString(cwd),
    '-ArgumentList', quotePowerShellString(`/k ${quoteCmdArg(launcherPath)}`),
    '-WindowStyle', 'Normal',
  ].join(' ');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    cwd,
    shell: false,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child;
}

module.exports = {
  CLAUDE_CLI_MODELS,
  CLAUDE_CLI_EFFORTS,
  CLAUDE_CLI_PERMISSION_MODES,
  discoverSessions,
  findSessionByCliId,
  parseClaudeJsonl,
  readSessionSummary,
  startClaudePrintSession,
  startInteractiveClaude,
  startNativeClaudeWindow,
};
