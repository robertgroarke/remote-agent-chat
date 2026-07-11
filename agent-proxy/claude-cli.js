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
  if (typeof part.thinking === 'string') return part.thinking;
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

function resultPartText(part) {
  const text = extractTextFromPart(part);
  if (text) return text;
  if (part?.content != null && typeof part.content === 'object') return compactJson(part.content);
  return '';
}

function timestampSeconds(entry) {
  if (!entry?.timestamp) return undefined;
  const time = new Date(entry.timestamp).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

function toolResultBody(part, entry) {
  const sections = [];
  const visible = resultPartText(part);
  if (visible) sections.push(visible);

  const structured = entry?.toolUseResult;
  if (structured && typeof structured === 'object') {
    const serialized = compactJson(structured);
    if (serialized && serialized !== '{}' && serialized !== compactJson(visible)) {
      sections.push(`structured result:\n${serialized}`);
    }
  }

  if (sections.length === 0) sections.push('(no output)');
  return sections.join('\n\n');
}

function buildClaudeToolBlock(part, entry, resultRecord) {
  const name = String(part?.name || 'Tool');
  const input = part?.input && typeof part.input === 'object' ? part.input : {};
  const resultPart = resultRecord?.part || null;
  const resultEntry = resultRecord?.entry || null;
  const structured = resultEntry?.toolUseResult && typeof resultEntry.toolUseResult === 'object'
    ? resultEntry.toolUseResult
    : {};
  const failed = resultPart?.is_error === true;
  const status = resultRecord ? (failed ? 'failed' : 'completed') : 'running';
  const callId = part?.id || resultPart?.tool_use_id || undefined;

  if (/^(bash|shell|powershell)$/i.test(name)) {
    const stdout = typeof structured.stdout === 'string'
      ? structured.stdout
      : (!failed ? resultPartText(resultPart) : '');
    const stderr = typeof structured.stderr === 'string'
      ? structured.stderr
      : (failed ? resultPartText(resultPart) : '');
    return {
      type: 'terminal',
      title: input.description || name,
      command: typeof input.command === 'string' ? input.command : compactJson(input),
      workdir: entry?.cwd || '',
      stdout,
      stderr,
      interrupted: structured.interrupted === true,
      status,
      call_id: callId,
      tool_name: name,
      collapsed: false,
    };
  }

  const sections = [];
  if (part?.input != null) sections.push(`input:\n${compactJson(part.input)}`);
  if (resultRecord) sections.push(`result:\n${toolResultBody(resultPart, resultEntry)}`);
  return {
    type: 'tool_call',
    title: name,
    content: sections.join('\n\n') || '(no input)',
    status,
    call_id: callId,
    tool_name: name,
    collapsed: false,
  };
}

function readClaudeEntries(filePath) {
  let lines = [];
  try {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return entries;
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
  const entries = readClaudeEntries(filePath);
  if (entries.length === 0) return [];

  const resultsByCallId = new Map();
  for (const entry of entries) {
    if (entry?.isSidechain || entry?.type !== 'user') continue;
    const parts = Array.isArray(entry?.message?.content) ? entry.message.content : [];
    for (const part of parts) {
      if (part?.type === 'tool_result' && part.tool_use_id) {
        resultsByCallId.set(String(part.tool_use_id), { part, entry });
      }
    }
  }

  const messages = [];
  for (const entry of entries) {
    if (entry.isSidechain) continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const rawContent = entry?.message?.content;
    const parts = Array.isArray(rawContent) ? rawContent : null;
    const ts = timestampSeconds(entry);

    if (!parts) {
      const content = messageContentToText(entry).trim();
      if (content) messages.push({ role: entry.type, content, ts });
      continue;
    }

    for (const part of parts) {
      if (!part) continue;
      if (part.type === 'tool_result') {
        if (part.tool_use_id && resultsByCallId.has(String(part.tool_use_id))) continue;
        const content = toolResultBody(part, entry);
        messages.push({
          role: 'assistant',
          content: `[${part.is_error ? 'Tool error' : 'Tool result'}]`,
          content_blocks: [{
            type: part.is_error ? 'error' : 'tool_call',
            title: part.is_error ? 'Tool error' : 'Tool result',
            content,
            status: part.is_error ? 'failed' : 'completed',
            call_id: part.tool_use_id || undefined,
            collapsed: false,
          }],
          ts,
        });
        continue;
      }

      if (part.type === 'tool_use') {
        const result = part.id ? resultsByCallId.get(String(part.id)) : null;
        const block = buildClaudeToolBlock(part, entry, result);
        messages.push({
          role: 'assistant',
          content: `[Tool: ${part.name || 'tool'}]`,
          content_blocks: [block],
          ts,
        });
        continue;
      }

      if (part.type === 'thinking') {
        const thinking = extractTextFromPart(part);
        messages.push({
          role: 'assistant',
          content: thinking ? '[Thinking]' : 'Thinking',
          content_blocks: [{
            type: 'thinking',
            title: 'Thinking',
            content: thinking,
            collapsed: false,
          }],
          ts,
        });
        continue;
      }

      const content = extractTextFromPart(part);
      if (!content) continue;
      if (entry.type === 'assistant') {
        messages.push({
          role: 'assistant',
          content,
          content_blocks: [{ type: 'markdown', content }],
          ts,
        });
      } else {
        messages.push({ role: 'user', content, ts });
      }
    }
  }
  return messages;
}

function readClaudeMetadata(filePath) {
  const entries = readClaudeEntries(filePath);
  const entrypoints = new Set();
  let workspacePath = null;
  let modelId = null;
  let permissionMode = null;
  let effort = null;
  for (const entry of entries) {
    if (entry?.entrypoint) entrypoints.add(String(entry.entrypoint));
    if (typeof entry?.cwd === 'string' && entry.cwd.trim()) workspacePath = entry.cwd.trim();
    if (typeof entry?.message?.model === 'string' && entry.message.model.trim()) modelId = entry.message.model.trim();
    if (typeof entry?.permissionMode === 'string' && entry.permissionMode.trim()) permissionMode = entry.permissionMode.trim();
    if (typeof entry?.effort === 'string' && entry.effort.trim()) effort = entry.effort.trim();
  }
  return { entries, entrypoints: Array.from(entrypoints), workspacePath, modelId, permissionMode, effort };
}

function readSessionSummary(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const cliSessionId = path.basename(filePath, '.jsonl');
  const workspaceDirName = path.basename(path.dirname(filePath));
  const metadata = readClaudeMetadata(filePath);
  const workspacePath = metadata.workspacePath || decodeProjectDirName(workspaceDirName);
  const workspaceName = workspacePath ? path.basename(workspacePath) : workspaceDirName;
  const messages = parseClaudeJsonl(filePath);
  const entrypointList = metadata.entrypoints;
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
    model_id: metadata.modelId || undefined,
    permission_mode: metadata.permissionMode || undefined,
    effort: metadata.effort || undefined,
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
  const claudeExe = process.platform === 'win32'
    ? [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe') : null,
        path.join(homeDir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      ].find(candidate => candidate && (safeStat(candidate)?.size || 0) > 1024 * 1024)
    : null;
  if (claudeExe) return { command: claudeExe, spawnArgs: args };
  if (process.platform === 'win32') {
    throw new Error('Could not find a valid Claude Code native executable. Run `claude install stable` or reinstall @anthropic-ai/claude-code.');
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
  // Remote Agent Chat does not expose Claude's Chrome browser integration as
  // a capability. Disable it explicitly so a newly installed extension cannot
  // insert an unseen native Yes/No startup prompt ahead of the transcript.
  const nativeExtraArgs = ['--no-chrome'];
  const args = buildClaudeArgs({
    cliSessionId,
    resume,
    model,
    effort,
    permissionMode,
    extraArgs: nativeExtraArgs,
    includeModel: !useOllamaLaunch,
  });
  const { command, spawnArgs } = buildSpawnCommand(args, { model });

  if (process.platform !== 'win32') {
    return startInteractiveClaude({
      workspacePath: cwd,
      cliSessionId,
      resume,
      model,
      effort,
      permissionMode,
      extraArgs: nativeExtraArgs,
    });
  }

  const windowTitle = String(title || 'Claude Code CLI').replace(/["&<>|]/g, '').slice(0, 80) || 'Claude Code CLI';
  const nativeCommand = command === 'cmd.exe' ? (spawnArgs[3] || 'claude.cmd') : command;
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

  const child = spawn('cmd.exe', ['/d', '/k', launcherPath], {
    cwd,
    shell: false,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

function stopNativeClaudeWindow(child) {
  const pid = Number(child?.pid ?? child);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, detail: 'No owned Claude CLI process to stop' };
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM');
      return { ok: true, detail: `stopped process group ${pid}` };
    } catch (e) {
      return { ok: false, detail: e.message };
    }
  }
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    encoding: 'utf8',
  });
  const detail = String(result.stdout || result.stderr || '').trim();
  return result.status === 0
    ? { ok: true, detail: detail || `stopped process tree ${pid}` }
    : { ok: false, detail: detail || `taskkill exited with ${result.status}` };
}

function claudeConfigPath() {
  return path.join(homeDir(), '.claude.json');
}

function readClaudeConfig(configPath = claudeConfigPath()) {
  try {
    if (!fs.existsSync(configPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function workspaceTrustKeys(workspacePath) {
  const exactPath = path.resolve(workspacePath);
  const keys = [exactPath];
  if (process.platform === 'win32') {
    const slashPath = exactPath.replace(/\\/g, '/');
    keys.push(slashPath);
    keys.push(slashPath.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`));
  }
  return Array.from(new Set(keys));
}

function isWorkspaceTrusted(workspacePath, configPath = claudeConfigPath()) {
  if (!workspacePath || typeof workspacePath !== 'string') return false;
  const config = readClaudeConfig(configPath);
  if (!config) return false;
  return workspaceTrustKeys(workspacePath)
    .some(projectPath => config.projects?.[projectPath]?.hasTrustDialogAccepted === true);
}

function trustWorkspace({ workspacePath, configPath = claudeConfigPath() } = {}) {
  const cwd = path.resolve(workspacePath || process.cwd());
  try {
    const stat = safeStat(cwd);
    if (!stat?.isDirectory()) {
      return Promise.resolve({ ok: false, detail: `Workspace does not exist or is not a directory: ${cwd}` });
    }

    const config = readClaudeConfig(configPath);
    if (!config) {
      return Promise.resolve({ ok: false, detail: `Claude config is not valid JSON: ${configPath}` });
    }

    const projects = config.projects && typeof config.projects === 'object' && !Array.isArray(config.projects)
      ? config.projects
      : {};
    const updatedProjects = { ...projects };
    for (const projectPath of workspaceTrustKeys(cwd)) {
      const existing = projects[projectPath] && typeof projects[projectPath] === 'object' && !Array.isArray(projects[projectPath])
        ? projects[projectPath]
        : {};
      updatedProjects[projectPath] = {
        allowedTools: [],
        mcpContextUris: [],
        enabledMcpjsonServers: [],
        disabledMcpjsonServers: [],
        projectOnboardingSeenCount: 0,
        hasClaudeMdExternalIncludesApproved: false,
        hasClaudeMdExternalIncludesWarningShown: false,
        ...existing,
        hasTrustDialogAccepted: true,
      };
    }
    config.projects = updatedProjects;
    const fullscreenUpsellSeenCount = Number(config.fullscreenUpsellSeenCount);
    config.fullscreenUpsellSeenCount = Math.max(
      Number.isFinite(fullscreenUpsellSeenCount) ? fullscreenUpsellSeenCount : 0,
      3
    );

    const parent = path.dirname(configPath);
    fs.mkdirSync(parent, { recursive: true });
    const tempPath = path.join(parent, `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, configPath);
    return Promise.resolve({ ok: true, detail: 'workspace trusted' });
  } catch (e) {
    return Promise.resolve({ ok: false, detail: e.message });
  }
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
  stopNativeClaudeWindow,
  isWorkspaceTrusted,
  trustWorkspace,
};
