'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CODEX_CLI_MODELS = [
  { id: 'gpt-5.5',                     label: 'GPT-5.5' },
  { id: 'gpt-5.4',                     label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',                label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex',               label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',               label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2',                     label: 'GPT-5.2' },
  { id: 'gpt-5.1-codex',               label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1',                     label: 'GPT-5.1' },
  { id: 'gpt-5',                       label: 'GPT-5' },
  { id: 'ollama:deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)' },
  { id: 'ollama:kimi-k2.6:cloud',       label: 'Kimi K2.6 (Ollama Cloud)' },
];

const CODEX_CLI_EFFORTS = [
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
];

const CODEX_CLI_ACCESS_MODES = [
  { value: 'read-only',          label: 'Read only' },
  { value: 'workspace-write',    label: 'Workspace write' },
  { value: 'danger-full-access', label: 'Full access' },
];

const SUMMARY_CACHE = new Map();

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function sessionsDir() {
  return path.join(homeDir(), '.codex', 'sessions');
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
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.jsonl')) {
        const stat = safeStat(full);
        if (stat) out.push({ filePath: full, stat });
      }
    }
  }
  out.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return out.slice(0, maxFiles);
}

function textFromContentPart(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (typeof part.text === 'string') return part.text;
  if (typeof part.output_text === 'string') return part.output_text;
  if (typeof part.input_text === 'string') return part.input_text;
  if (part.type === 'input_text' && typeof part.text === 'string') return part.text;
  if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  if (part.type === 'image_url' || part.type === 'input_image') return '[Image]';
  return '';
}

function compactJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value || ''); }
}

function responseMessageText(payload) {
  const content = payload?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textFromContentPart).filter(Boolean).join('\n\n');
  return '';
}

function isCodexContextNoise(text) {
  const trimmed = String(text || '').trim();
  return /^<environment_context>[\s\S]*<\/environment_context>$/i.test(trimmed)
    || /^# AGENTS\.md instructions\b/i.test(trimmed);
}

function functionCallText(payload) {
  const name = payload?.name || payload?.call_id || 'tool';
  let args = payload?.arguments || payload?.args || payload?.input || '';
  if (args && typeof args !== 'string') args = compactJson(args);
  return `[Tool: ${name}]${args ? `\n\n\`\`\`json\n${args}\n\`\`\`` : ''}`;
}

function functionOutputText(payload) {
  const out = payload?.output || payload?.content || payload?.result || '';
  const text = typeof out === 'string' ? out : compactJson(out);
  return `[Tool result]\n\n${text || '(no output)'}`;
}

function pushDedup(messages, next) {
  if (!next?.content || !next.content.trim()) return;
  if (next.role === 'user' && isCodexContextNoise(next.content)) return;
  const last = messages[messages.length - 1];
  if (last && last.role === next.role && last.content === next.content) return;
  messages.push(next);
}

function parseCodexJsonl(filePath) {
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
    const payload = entry?.payload || {};
    const ts = entry.timestamp ? Math.floor(new Date(entry.timestamp).getTime() / 1000) : undefined;
    if (entry.type === 'response_item') {
      if (payload.type === 'message') {
        if (payload.role === 'developer' || payload.role === 'system') continue;
        const role = payload.role === 'user' ? 'user' : 'assistant';
        pushDedup(messages, { role, content: responseMessageText(payload), ts });
      } else if (payload.type === 'function_call' || payload.type === 'local_shell_call') {
        pushDedup(messages, { role: 'assistant', content: functionCallText(payload), ts });
      } else if (payload.type === 'function_call_output' || payload.type === 'local_shell_call_output') {
        pushDedup(messages, { role: 'assistant', content: functionOutputText(payload), ts });
      }
      continue;
    }
    if (entry.type === 'event_msg') {
      if (payload.type === 'user_message') {
        pushDedup(messages, { role: 'user', content: payload.message || payload.text || '', ts });
      } else if (payload.type === 'agent_message') {
        pushDedup(messages, { role: 'assistant', content: payload.message || payload.text || '', ts });
      } else if (payload.type === 'exec_command_end') {
        const output = payload.output || payload.stdout || payload.stderr || '';
        if (output) pushDedup(messages, { role: 'assistant', content: `[Command output]\n\n${output}`, ts });
      }
    }
  }
  return messages;
}

function readSessionMeta(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(0, 50);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'session_meta' && entry.payload) return entry.payload;
    }
  } catch {}
  return {};
}

function readJsonlHead(filePath, maxBytes = 262144) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const len = Math.min(maxBytes, stat.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function readSessionCandidate(filePath, stat) {
  const lines = readJsonlHead(filePath);
  let meta = {};
  let firstUserText = '';
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const payload = entry?.payload || {};
    if (entry.type === 'session_meta' && payload) {
      meta = payload;
      continue;
    }
    if (firstUserText) continue;
    if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const text = responseMessageText(payload);
      if (!isCodexContextNoise(text)) firstUserText = text;
    } else if (entry.type === 'event_msg' && payload.type === 'user_message') {
      const text = payload.message || payload.text || '';
      if (!isCodexContextNoise(text)) firstUserText = text;
    }
  }
  const workspacePath = meta.cwd || null;
  const fileIdMatch = path.basename(filePath, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return {
    cliSessionId: meta.id || fileIdMatch?.[1] || path.basename(filePath, '.jsonl').replace(/^rollout-/, ''),
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : 'Codex CLI',
    title: firstUserText.replace(/\s+/g, ' ').trim().substring(0, 80) || 'Codex CLI session',
    updatedAt: stat.mtime.toISOString(),
    hasUser: !!firstUserText,
  };
}

function readSessionSummary(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  if (SUMMARY_CACHE.has(cacheKey)) return SUMMARY_CACHE.get(cacheKey);
  for (const key of SUMMARY_CACHE.keys()) {
    if (key.startsWith(`${filePath}:`) && key !== cacheKey) SUMMARY_CACHE.delete(key);
  }
  const meta = readSessionMeta(filePath);
  const fileIdMatch = path.basename(filePath, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const cliSessionId = meta.id || fileIdMatch?.[1] || path.basename(filePath, '.jsonl').replace(/^rollout-/, '');
  const messages = parseCodexJsonl(filePath);
  const firstUser = messages.find(m => m.role === 'user');
  const title = (firstUser?.content || '').replace(/\s+/g, ' ').trim().substring(0, 80) || 'Codex CLI session';
  const workspacePath = meta.cwd || null;
  const summary = {
    cliSessionId,
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : 'Codex CLI',
    title,
    messages,
    messageCount: messages.length,
    model_id: meta.model || meta.model_slug || 'default',
    updatedAt: stat.mtime.toISOString(),
  };
  SUMMARY_CACHE.set(cacheKey, summary);
  return summary;
}

function discoverSessions(limit = 40) {
  const root = sessionsDir();
  if (!fs.existsSync(root)) return [];
  return walkJsonlFiles(root, limit)
    .map(item => readSessionSummary(item.filePath))
    .filter(Boolean);
}

function findSessionByCliId(cliSessionId) {
  if (!cliSessionId) return null;
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  for (const item of walkJsonlFiles(root, 500)) {
    const summary = readSessionSummary(item.filePath);
    if (summary?.cliSessionId === cliSessionId) return summary;
  }
  return null;
}

function normPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function findLatestSessionForWorkspace(workspacePath, sinceMs = 0) {
  const wanted = normPath(workspacePath);
  const summaries = discoverSessions(80);
  return summaries.find(summary => {
    if (wanted && normPath(summary.workspacePath) !== wanted) return false;
    const updated = summary.updatedAt ? new Date(summary.updatedAt).getTime() : 0;
    return !sinceMs || updated >= sinceMs;
  }) || null;
}

function titleTokens(value) {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !/^(with|from|this|that|code|task|chat|session)$/.test(t)));
}

function tokenOverlapScore(a, b) {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

function findLatestSessionForTitle({ workspacePath, workspaceName, title, sinceMs = 0, maxFiles = 40 } = {}) {
  const wantedPath = normPath(workspacePath);
  const wantedName = String(workspaceName || '').toLowerCase();
  const wantedTitle = String(title || '').trim();
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  let best = null;
  let bestScore = 0;
  for (const item of walkJsonlFiles(root, maxFiles)) {
    if (sinceMs && item.stat.mtimeMs < sinceMs) continue;
    const candidate = readSessionCandidate(item.filePath, item.stat);
    if (!candidate || !candidate.hasUser) continue;
    if (wantedPath && normPath(candidate.workspacePath) !== wantedPath) continue;
    let score = 1;
    if (wantedName && String(candidate.workspaceName || '').toLowerCase() === wantedName) score += 1;
    if (wantedTitle) score += tokenOverlapScore(wantedTitle, candidate.title) * 8;
    if (!best || score > bestScore || (score === bestScore && new Date(candidate.updatedAt) > new Date(best.updatedAt))) {
      best = candidate;
      bestScore = score;
    }
    if (bestScore >= 7) break;
  }
  return bestScore >= 2 && best ? readSessionSummary(best.filePath) : null;
}

function isOllamaModel(model) {
  const raw = String(model || '');
  return /^ollama:/i.test(raw) || /:cloud$/i.test(raw);
}

function normalizeModel(model) {
  const raw = String(model || '').trim();
  return raw.replace(/^ollama:/i, '');
}

function buildCodexArgs({ execMode = false, cliSessionId, resume = true, model, effort, permissionMode, json = false, workspacePath, extraArgs = [] } = {}) {
  const args = [];
  if (execMode) args.push('exec');
  else if (resume && cliSessionId) args.push('resume', cliSessionId);
  if (json) args.push('--json');
  if (workspacePath) args.push('-C', workspacePath);
  const modelId = normalizeModel(model);
  if (modelId && modelId !== 'default' && modelId !== 'unknown') {
    if (isOllamaModel(model)) args.push('--oss', '--local-provider', 'ollama');
    args.push('-m', modelId);
  }
  if (effort && effort !== 'default' && effort !== 'unknown') {
    args.push('-c', `model_reasoning_effort="${effort}"`);
  }
  if (permissionMode && permissionMode !== 'default' && permissionMode !== 'unknown') {
    args.push('-s', permissionMode);
  }
  if (Array.isArray(extraArgs) && extraArgs.length > 0) args.push(...extraArgs);
  return args;
}

function quoteCmdArg(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function quotePowerShellString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function startCodexExecSession({ workspacePath, cliSessionId, resume = true, content, model, effort, permissionMode, onStdout, onStderr, onExit }) {
  const args = buildCodexArgs({
    execMode: true,
    cliSessionId,
    resume,
    model,
    effort,
    permissionMode,
    json: true,
    workspacePath,
    extraArgs: [content || ''],
  });
  const child = spawn('codex', args, {
    cwd: workspacePath || process.cwd(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => onStdout && onStdout(chunk.toString('utf8')));
  child.stderr.on('data', chunk => onStderr && onStderr(chunk.toString('utf8')));
  child.on('close', code => onExit && onExit(code));
  child.on('error', err => onExit && onExit(-1, err));
  return child;
}

function startNativeCodexWindow({ workspacePath, cliSessionId, resume = true, model, effort, permissionMode, title } = {}) {
  const cwd = workspacePath || process.cwd();
  if (process.platform !== 'win32') {
    const args = buildCodexArgs({ cliSessionId, resume, model, effort, permissionMode, workspacePath: cwd });
    return spawn('codex', args, { cwd, shell: false, stdio: 'inherit', windowsHide: false });
  }
  const args = buildCodexArgs({ cliSessionId, resume, model, effort, permissionMode, workspacePath: cwd });
  const windowTitle = String(title || 'Codex CLI').replace(/["&<>|]/g, '').slice(0, 80) || 'Codex CLI';
  const launcherPath = path.join(os.tmpdir(), `remote-agent-codex-cli-${cliSessionId || Date.now()}.cmd`);
  const commandLine = ['codex', ...args].map(quoteCmdArg).join(' ');
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
  CODEX_CLI_MODELS,
  CODEX_CLI_EFFORTS,
  CODEX_CLI_ACCESS_MODES,
  discoverSessions,
  findSessionByCliId,
  findLatestSessionForWorkspace,
  findLatestSessionForTitle,
  parseCodexJsonl,
  readSessionSummary,
  startCodexExecSession,
  startNativeCodexWindow,
};
