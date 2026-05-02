'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

function buildClaudeArgs({ cliSessionId, resume = true, model, effort, permissionMode, print = false, extraArgs = [] } = {}) {
  const args = [];
  if (print) args.push('--print', '--output-format', 'stream-json', '--include-partial-messages');
  if (cliSessionId) {
    args.push(resume ? '--resume' : '--session-id', cliSessionId);
  }
  if (model && model !== 'default' && model !== 'unknown') args.push('--model', model);
  if (effort && effort !== 'unknown') args.push('--effort', effort);
  if (permissionMode && permissionMode !== 'unknown') args.push('--permission-mode', permissionMode);
  if (Array.isArray(extraArgs) && extraArgs.length > 0) args.push(...extraArgs);
  return args;
}

function buildSpawnCommand(args) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'claude';
  const spawnArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'claude.cmd', ...args] : args;
  return { command, spawnArgs };
}

function startClaudePrintSession({ workspacePath, cliSessionId, resume = true, content, model, effort, permissionMode, onStdout, onStderr, onExit }) {
  const args = buildClaudeArgs({ cliSessionId, resume, model, effort, permissionMode, print: true });
  const { command, spawnArgs } = buildSpawnCommand(args);
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

function startInteractiveClaude({ workspacePath, model, effort, permissionMode, extraArgs = [] } = {}) {
  const args = buildClaudeArgs({ model, effort, permissionMode, extraArgs });
  const { command, spawnArgs } = buildSpawnCommand(args);
  return spawn(command, spawnArgs, {
    cwd: workspacePath || process.cwd(),
    shell: false,
    stdio: 'inherit',
    windowsHide: false,
  });
}

module.exports = {
  CLAUDE_CLI_MODELS,
  CLAUDE_CLI_EFFORTS,
  CLAUDE_CLI_PERMISSION_MODES,
  discoverSessions,
  parseClaudeJsonl,
  readSessionSummary,
  startClaudePrintSession,
  startInteractiveClaude,
};
