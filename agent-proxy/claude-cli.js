'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { normalizeNativeLaunchMode, backgroundNativeLaunchResult } = require('./native-launch-mode');
const { setBoundedMap } = require('./bounded-map');
let chokidar = null;
try { chokidar = require('chokidar'); } catch {}

const CLAUDE_SUMMARY_CACHE = new Map();
const CLAUDE_TAIL_SUMMARY_CACHE = new Map();
const JSONL_CHUNK_BYTES = 256 * 1024;

function envMb(name, fallback, min = 1) {
  const parsed = parseInt(process.env[name] || '', 10);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(min, mb) * 1024 * 1024;
}

const JSONL_MAX_LINE_BYTES = envMb('CLAUDE_CLI_MAX_JSONL_LINE_MB', 8);
const DEFAULT_HYDRATE_MAX_BYTES = envMb('CLAUDE_CLI_HYDRATE_MAX_MB', 75);
const DEFAULT_HYDRATE_TAIL_BYTES = envMb('CLAUDE_CLI_HYDRATE_TAIL_MB', 4);

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

function fileCursorAnchor(filePath, offset) {
  const end = Math.max(0, Number(offset) || 0);
  if (end === 0) return '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const length = Math.min(256, end);
    const buffer = Buffer.allocUnsafe(length);
    const read = fs.readSync(fd, buffer, 0, length, end - length);
    return buffer.subarray(0, read).toString('base64');
  } catch {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
}

function scanStartAlignedToLine(filePath, startOffset) {
  if (!startOffset) return 0;
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    let position = Math.max(0, Math.min(Number(startOffset) || 0, stat.size));
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (position < stat.size) {
      const bytesRead = fs.readSync(fd, chunk, 0, Math.min(chunk.length, stat.size - position), position);
      if (!bytesRead) break;
      for (let index = 0; index < bytesRead; index += 1) {
        if (chunk[index] === 10) return position + index + 1;
      }
      position += bytesRead;
    }
  } catch {
    return Math.max(0, Number(startOffset) || 0);
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return Math.max(0, Number(startOffset) || 0);
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

function watchSessions(onSummary, { onError, debounceMs = 120, rootDir = projectsDir() } = {}) {
  if (!chokidar || !fs.existsSync(rootDir)) return null;
  const timers = new Map();
  const flush = filePath => {
    if (!String(filePath || '').toLowerCase().endsWith('.jsonl')) return;
    if (timers.has(filePath)) clearTimeout(timers.get(filePath));
    timers.set(filePath, setTimeout(() => {
      timers.delete(filePath);
      try {
        const summary = readSessionSummary(filePath);
        if (summary && onSummary) onSummary(summary);
      } catch (error) {
        if (onError) onError(error);
      }
    }, debounceMs));
  };
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: false,
    depth: 3,
  });
  watcher.on('add', flush);
  watcher.on('change', flush);
  watcher.on('error', error => onError && onError(error));
  const close = watcher.close.bind(watcher);
  watcher.close = async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    return close();
  };
  return watcher;
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

  if (name === 'TodoWrite' && Array.isArray(input.todos) && input.todos.length > 0) {
    return {
      type: 'plan',
      title: 'Tasks',
      tasks: input.todos.map((todo, index) => ({
        id: String(todo?.id || index + 1),
        step: String(todo?.content || todo?.activeForm || `Task ${index + 1}`),
        active_form: typeof todo?.activeForm === 'string' ? todo.activeForm : undefined,
        status: String(todo?.status || 'pending'),
      })),
      status,
      call_id: callId,
      tool_name: name,
      collapsed: false,
    };
  }

  if (name === 'AskUserQuestion' && Array.isArray(input.questions) && input.questions.length > 0) {
    const content = input.questions.map((question, index) => {
      const heading = String(question?.header || `Question ${index + 1}`);
      const prompt = String(question?.question || '').trim();
      const options = Array.isArray(question?.options)
        ? question.options.map(option => {
          const label = String(option?.label || '').trim();
          const description = String(option?.description || '').trim();
          return `- ${label}${description ? ` — ${description}` : ''}`;
        }).filter(line => line !== '- ')
        : [];
      return [`### ${heading}`, prompt, ...options].filter(Boolean).join('\n');
    }).join('\n\n');
    return {
      type: 'prompt',
      title: input.questions.length === 1
        ? String(input.questions[0]?.header || 'Question')
        : 'Questions',
      content,
      status,
      call_id: callId,
      tool_name: name,
      collapsed: false,
    };
  }

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

const CLAUDE_TASK_TOOLS = new Set(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList']);

function isClaudeTaskTool(name) {
  return CLAUDE_TASK_TOOLS.has(String(name || '').trim());
}

function normalizeClaudeTaskStatus(status) {
  const value = String(status || 'pending').trim().toLowerCase();
  return ['pending', 'in_progress', 'completed'].includes(value) ? value : 'pending';
}

function upsertClaudeTask(state, task, fallbackId) {
  const id = String(task?.id || task?.taskId || fallbackId || '').trim();
  if (!id) return null;
  const existing = state.tasksById.get(id) || {};
  const subject = String(task?.subject || task?.step || task?.text || existing.step || `Task ${id}`).trim();
  const next = {
    id,
    step: subject || `Task ${id}`,
    active_form: typeof task?.activeForm === 'string'
      ? task.activeForm
      : existing.active_form,
    status: normalizeClaudeTaskStatus(task?.status || existing.status),
  };
  if (!state.tasksById.has(id)) state.taskOrder.push(id);
  state.tasksById.set(id, next);
  return next;
}

function removeClaudeTask(state, taskId) {
  const id = String(taskId || '').trim();
  if (!id || !state.tasksById.has(id)) return;
  state.tasksById.delete(id);
  state.taskOrder = state.taskOrder.filter(candidate => candidate !== id);
}

function remapClaudeTask(state, fromId, toId, task = {}) {
  const source = String(fromId || '').trim();
  const target = String(toId || '').trim();
  if (!target) return null;
  const existing = {
    ...(state.tasksById.get(target) || {}),
    ...(state.tasksById.get(source) || {}),
  };
  if (source && source !== target) {
    const index = state.taskOrder.indexOf(source);
    if (index >= 0) state.taskOrder[index] = target;
    state.tasksById.delete(source);
    state.taskOrder = Array.from(new Set(state.taskOrder));
    state.tasksById.set(target, existing);
  }
  return upsertClaudeTask(state, { ...existing, ...task, id: target }, target);
}

function claudeTaskPlanBlock(state, { callId, toolName } = {}) {
  const tasks = state.taskOrder.map(id => state.tasksById.get(id)).filter(Boolean);
  const completed = tasks.filter(task => task.status === 'completed').length;
  const total = tasks.length;
  return {
    type: 'plan',
    title: `${total} ${total === 1 ? 'task' : 'tasks'} (${completed} done, ${total - completed} open)`,
    tasks,
    status: total > 0 && completed === total ? 'completed' : 'running',
    call_id: callId || undefined,
    tool_name: toolName || 'TaskList',
    collapsed: false,
  };
}

function refreshClaudeTaskPlan(state, entry, part) {
  if (state.taskOrder.length === 0) return;
  const block = claudeTaskPlanBlock(state, {
    callId: part?.id || part?.tool_use_id,
    toolName: part?.name,
  });
  const message = {
    role: 'assistant',
    content: '[Tasks]',
    content_blocks: [block],
    ts: timestampSeconds(entry),
  };
  if (Number.isInteger(state.taskPlanMessageIndex)) {
    state.messages[state.taskPlanMessageIndex] = message;
  } else {
    state.taskPlanMessageIndex = state.messages.length;
    state.messages.push(message);
  }
}

function applyClaudeTaskUse(state, part, entry) {
  const name = String(part?.name || '').trim();
  const input = part?.input && typeof part.input === 'object' ? part.input : {};
  const callId = String(part?.id || '').trim();
  if (name === 'TaskCreate') {
    const temporaryId = `pending:${callId || state.taskOrder.length + 1}`;
    upsertClaudeTask(state, {
      id: temporaryId,
      subject: input.subject || input.description,
      activeForm: input.activeForm,
      status: 'pending',
    }, temporaryId);
    if (callId) state.pendingTaskCreates.set(callId, temporaryId);
  } else if (name === 'TaskUpdate') {
    if (String(input.status || '').trim().toLowerCase() === 'deleted') {
      removeClaudeTask(state, input.taskId);
    } else {
      upsertClaudeTask(state, {
        id: input.taskId,
        subject: input.subject,
        activeForm: input.activeForm,
        status: input.status,
      }, input.taskId);
    }
  }
  refreshClaudeTaskPlan(state, entry, part);
}

function applyClaudeTaskResult(state, toolUse, resultPart, entry) {
  const name = String(toolUse?.part?.name || '').trim();
  const input = toolUse?.part?.input && typeof toolUse.part.input === 'object'
    ? toolUse.part.input
    : {};
  const structured = entry?.toolUseResult && typeof entry.toolUseResult === 'object'
    ? entry.toolUseResult
    : {};
  if (name === 'TaskCreate') {
    const callId = String(toolUse?.part?.id || resultPart?.tool_use_id || '').trim();
    const temporaryId = state.pendingTaskCreates.get(callId);
    const created = structured.task && typeof structured.task === 'object' ? structured.task : {};
    const taskId = created.id || structured.taskId;
    if (taskId) {
      remapClaudeTask(state, temporaryId, taskId, {
        ...created,
        subject: created.subject || input.subject || input.description,
        activeForm: input.activeForm,
        status: created.status || 'pending',
      });
    }
    if (callId) state.pendingTaskCreates.delete(callId);
  } else if (name === 'TaskUpdate') {
    const taskId = structured.taskId || input.taskId;
    if (String(input.status || '').trim().toLowerCase() === 'deleted') {
      removeClaudeTask(state, taskId);
    } else {
      upsertClaudeTask(state, {
        id: taskId,
        subject: input.subject,
        activeForm: input.activeForm,
        status: structured.statusChange?.to || input.status,
      }, taskId);
    }
  } else if (name === 'TaskList' && Array.isArray(structured.tasks)) {
    for (const task of structured.tasks) upsertClaudeTask(state, task, task?.id);
  } else if (name === 'TaskGet' && structured.task && typeof structured.task === 'object') {
    upsertClaudeTask(state, structured.task, structured.task.id || input.taskId);
  }
  refreshClaudeTaskPlan(state, entry, {
    ...toolUse?.part,
    tool_use_id: resultPart?.tool_use_id,
  });
}

function scanClaudeJsonlEntries(filePath, onEntry, { startOffset = 0 } = {}) {
  let fd = null;
  let stat = null;
  let position = Math.max(0, Number(startOffset) || 0);
  let lastCompleteOffset = position;
  let lineBuffers = [];
  let lineBytes = 0;
  let lineTooLarge = false;
  let emitted = 0;
  try {
    fd = fs.openSync(filePath, 'r');
    stat = fs.fstatSync(fd);
    if (position > stat.size) position = 0;
    const scanStartOffset = position;
    const chunk = Buffer.allocUnsafe(JSONL_CHUNK_BYTES);
    while (position < stat.size) {
      const bytesRead = fs.readSync(fd, chunk, 0, Math.min(chunk.length, stat.size - position), position);
      if (!bytesRead) break;
      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (chunk[index] !== 10) continue;
        if (index > segmentStart && !lineTooLarge) {
          const length = index - segmentStart;
          if (lineBytes + length <= JSONL_MAX_LINE_BYTES) {
            lineBuffers.push(Buffer.from(chunk.subarray(segmentStart, index)));
            lineBytes += length;
          } else {
            lineTooLarge = true;
            lineBuffers = [];
          }
        }
        if (!lineTooLarge) {
          let line = Buffer.concat(lineBuffers).toString('utf8');
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.trim()) {
            try {
              onEntry(JSON.parse(line));
              emitted += 1;
            } catch {}
          }
        }
        lineBuffers = [];
        lineBytes = 0;
        lineTooLarge = false;
        lastCompleteOffset = position + index + 1;
        segmentStart = index + 1;
      }
      if (segmentStart < bytesRead && !lineTooLarge) {
        const length = bytesRead - segmentStart;
        if (lineBytes + length <= JSONL_MAX_LINE_BYTES) {
          lineBuffers.push(Buffer.from(chunk.subarray(segmentStart, bytesRead)));
          lineBytes += length;
        } else {
          lineTooLarge = true;
          lineBuffers = [];
          lineBytes = 0;
        }
      }
      position += bytesRead;
    }
    if (!lineTooLarge && lineBuffers.length > 0) {
      let line = Buffer.concat(lineBuffers).toString('utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim()) {
        try {
          onEntry(JSON.parse(line));
          emitted += 1;
          lastCompleteOffset = stat.size;
        } catch {
          // Retain the last complete-line cursor. The unfinished suffix is
          // re-read with the next append and is never accepted twice.
        }
      } else {
        lastCompleteOffset = stat.size;
      }
    }
    return {
      stat,
      offset: lastCompleteOffset,
      emitted,
      bytesRead: Math.max(0, stat.size - scanStartOffset),
    };
  } catch {
    return { stat, offset: lastCompleteOffset, emitted, bytesRead: 0 };
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
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

function syntheticClaudeBlock(entry, content) {
  const errorCode = String(entry?.error || '').trim().toLowerCase();
  const apiStatus = Number(entry?.apiErrorStatus);
  const isError = entry?.isApiErrorMessage === true || !!errorCode || (Number.isFinite(apiStatus) && apiStatus >= 400);
  if (!isError) {
    return {
      type: 'notice',
      title: 'Claude CLI notice',
      content,
      collapsed: false,
    };
  }

  let title = 'Claude CLI error';
  if (errorCode === 'rate_limit' || apiStatus === 429) title = 'Rate limit reached';
  else if (errorCode === 'authentication_failed' || apiStatus === 401) title = 'Authentication failed';
  else if (errorCode === 'model_not_found' || apiStatus === 404) title = 'Model unavailable';
  else if (entry?.message?.stop_reason === 'refusal') title = 'Request refused';
  return {
    type: 'error',
    title,
    content,
    status: errorCode || (Number.isFinite(apiStatus) ? String(apiStatus) : 'error'),
    collapsed: false,
  };
}

function createClaudeParseState(filePath) {
  return {
    filePath,
    messages: [],
    pendingQueue: [],
    resultsByCallId: new Map(),
    toolUsesByCallId: new Map(),
    tasksById: new Map(),
    taskOrder: [],
    pendingTaskCreates: new Map(),
    taskPlanMessageIndex: null,
    entrypoints: new Set(),
    workspacePath: null,
    modelId: null,
    permissionMode: null,
    effort: null,
  };
}

function applyClaudeMetadata(state, entry) {
  if (entry?.entrypoint) state.entrypoints.add(String(entry.entrypoint));
  if (typeof entry?.cwd === 'string' && entry.cwd.trim()) state.workspacePath = entry.cwd.trim();
  const candidateModel = typeof entry?.message?.model === 'string' ? entry.message.model.trim() : '';
  if (candidateModel && !/^<synthetic>$/i.test(candidateModel)) state.modelId = candidateModel;
  if (typeof entry?.permissionMode === 'string' && entry.permissionMode.trim()) state.permissionMode = entry.permissionMode.trim();
  if (typeof entry?.effort === 'string' && entry.effort.trim()) state.effort = entry.effort.trim();
}

function refreshClaudeToolUse(state, callId) {
  const toolUse = state.toolUsesByCallId.get(callId);
  if (!toolUse || !Number.isInteger(toolUse.messageIndex)) return;
  const result = state.resultsByCallId.get(callId) || null;
  const previous = state.messages[toolUse.messageIndex];
  if (!previous) return;
  state.messages[toolUse.messageIndex] = {
    ...previous,
    content_blocks: [buildClaudeToolBlock(toolUse.part, toolUse.entry, result)],
  };
  if (result && Number.isInteger(result.messageIndex)) {
    const resultMessage = state.messages[result.messageIndex];
    const toolName = String(toolUse.part?.name || '').trim();
    if (resultMessage?.content_blocks?.[0]) {
      state.messages[result.messageIndex] = {
        ...resultMessage,
        content_blocks: [{
          ...resultMessage.content_blocks[0],
          title: `${result.part?.is_error ? 'Tool error' : 'Tool result'}${toolName ? `: ${toolName}` : ''}`,
          tool_name: toolName || undefined,
        }],
      };
    }
  }
}

function applyClaudeEntryToState(state, entry) {
  applyClaudeMetadata(state, entry);
  if (entry?.type === 'queue-operation') {
    const operation = String(entry.operation || '').trim().toLowerCase();
    if (operation === 'enqueue') {
      const content = typeof entry.content === 'string' ? entry.content.trim() : '';
      if (content) state.pendingQueue.push({ content, ts: timestampSeconds(entry) });
    } else if (operation === 'dequeue' && state.pendingQueue.length > 0) {
      state.pendingQueue.shift();
    }
    return;
  }
  if (entry?.isSidechain || (entry?.type !== 'user' && entry?.type !== 'assistant')) return;

  const rawContent = entry?.message?.content;
  const parts = Array.isArray(rawContent) ? rawContent : null;
  const ts = timestampSeconds(entry);
  if (!parts) {
    const content = messageContentToText(entry).trim();
    if (content) state.messages.push({ role: entry.type, content, ts });
    return;
  }

  for (const part of parts) {
    if (!part) continue;
    if (part.type === 'tool_result') {
      const callId = part.tool_use_id ? String(part.tool_use_id) : '';
      const toolUse = callId ? state.toolUsesByCallId.get(callId) : null;
      const toolName = String(toolUse?.part?.name || '').trim();
      const resultRecord = { part, entry, messageIndex: null };
      if (callId) state.resultsByCallId.set(callId, resultRecord);
      if (isClaudeTaskTool(toolName)) {
        applyClaudeTaskResult(state, toolUse, part, entry);
        continue;
      }
      if (!/^(bash|shell|powershell)$/i.test(toolName)) {
        const content = toolResultBody(part, entry);
        resultRecord.messageIndex = state.messages.length;
        state.messages.push({
          role: 'assistant',
          content: `[${part.is_error ? 'Tool error' : 'Tool result'}]`,
          content_blocks: [{
            type: 'tool_result',
            title: `${part.is_error ? 'Tool error' : 'Tool result'}${toolName ? `: ${toolName}` : ''}`,
            content,
            status: part.is_error ? 'failed' : 'completed',
            call_id: part.tool_use_id || undefined,
            tool_name: toolName || undefined,
            collapsed: false,
          }],
          ts,
        });
      }
      if (callId) refreshClaudeToolUse(state, callId);
      continue;
    }

    if (part.type === 'tool_use') {
      const callId = part.id ? String(part.id) : '';
      const result = callId ? state.resultsByCallId.get(callId) : null;
      if (isClaudeTaskTool(part.name)) {
        if (callId) state.toolUsesByCallId.set(callId, { part, entry, messageIndex: null });
        applyClaudeTaskUse(state, part, entry);
        if (result) applyClaudeTaskResult(state, { part, entry, messageIndex: null }, result.part, result.entry);
        continue;
      }
      const messageIndex = state.messages.length;
      state.messages.push({
        role: 'assistant',
        content: `[Tool: ${part.name || 'tool'}]`,
        content_blocks: [buildClaudeToolBlock(part, entry, result)],
        ts,
      });
      if (callId) {
        state.toolUsesByCallId.set(callId, { part, entry, messageIndex });
        refreshClaudeToolUse(state, callId);
      }
      continue;
    }

    if (part.type === 'thinking') {
      const thinking = extractTextFromPart(part);
      state.messages.push({
        role: 'assistant',
        content: thinking ? '[Thinking]' : 'Thinking',
        content_blocks: [{ type: 'thinking', title: 'Thinking', content: thinking, collapsed: false }],
        ts,
      });
      continue;
    }

    const content = extractTextFromPart(part);
    if (!content) continue;
    if (entry.type === 'assistant') {
      const isSynthetic = String(entry?.message?.model || '').trim() === '<synthetic>';
      state.messages.push({
        role: 'assistant',
        content,
        content_blocks: [isSynthetic ? syntheticClaudeBlock(entry, content) : { type: 'markdown', content }],
        ts,
      });
    } else {
      state.messages.push({ role: 'user', content, ts });
    }
  }
}

function claudeStateMessages(state) {
  const messages = [...state.messages];
  for (const queued of state.pendingQueue) {
    messages.push({
      role: 'assistant',
      content: `[Queued message]\n\n${queued.content}`,
      content_blocks: [{
        type: 'queued_message', title: 'Queued message', content: queued.content,
        status: 'pending', collapsed: false,
      }],
      ts: queued.ts,
    });
  }
  return messages;
}

function parseClaudeJsonlDetailed(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const prior = CLAUDE_SUMMARY_CACHE.get(filePath);
  const canTail = !!prior
    && stat.size >= prior.offset
    && stat.size >= prior.size
    && prior.anchor === fileCursorAnchor(filePath, prior.offset)
    && !(stat.size === prior.size && stat.mtimeMs !== prior.mtimeMs);
  const state = canTail ? prior.state : createClaudeParseState(filePath);
  const scanStartOffset = canTail ? prior.offset : 0;
  const scan = scanClaudeJsonlEntries(filePath, entry => applyClaudeEntryToState(state, entry), {
    startOffset: scanStartOffset,
  });
  setBoundedMap(CLAUDE_SUMMARY_CACHE, filePath, {
    state,
    offset: scan.offset,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    anchor: fileCursorAnchor(filePath, scan.offset),
  }, 32);
  return {
    state,
    stat,
    sourceCursor: {
      mode: canTail ? (stat.size > prior.size ? 'append' : 'unchanged') : (prior ? 'recovery' : 'baseline'),
      start_offset: scanStartOffset,
      end_offset: scan.offset,
      file_size: stat.size,
      bytes_read: scan.bytesRead,
      events_read: scan.emitted,
    },
  };
}

function parseClaudeJsonlTail(filePath, tailBytes = DEFAULT_HYDRATE_TAIL_BYTES) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const boundedTailBytes = Math.max(1024 * 1024, Number(tailBytes) || DEFAULT_HYDRATE_TAIL_BYTES);
  const prior = CLAUDE_TAIL_SUMMARY_CACHE.get(filePath);
  const canTail = !!prior
    && prior.tailBytes === boundedTailBytes
    && stat.size >= prior.offset
    && stat.size >= prior.size
    && prior.anchor === fileCursorAnchor(filePath, prior.offset)
    && !(stat.size === prior.size && stat.mtimeMs !== prior.mtimeMs);
  let state;
  let startOffset;
  let scanStartOffset;
  let windowStartOffset;
  if (canTail) {
    state = prior.state;
    startOffset = prior.startOffset;
    scanStartOffset = prior.offset;
    windowStartOffset = scanStartOffset;
  } else {
    state = createClaudeParseState(filePath);
    const wantedStart = Math.max(0, stat.size - boundedTailBytes);
    windowStartOffset = wantedStart;
    startOffset = scanStartAlignedToLine(filePath, wantedStart);
    scanStartOffset = startOffset;
  }
  const scan = scanClaudeJsonlEntries(filePath, entry => applyClaudeEntryToState(state, entry), {
    startOffset: scanStartOffset,
  });
  setBoundedMap(CLAUDE_TAIL_SUMMARY_CACHE, filePath, {
    state,
    startOffset,
    offset: scan.offset,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    tailBytes: boundedTailBytes,
    anchor: fileCursorAnchor(filePath, scan.offset),
  }, 32);
  return {
    state,
    stat,
    sourceCursor: {
      mode: canTail ? (stat.size > prior.size ? 'append' : 'unchanged') : (prior ? 'recovery' : 'baseline_tail'),
      start_offset: scanStartOffset,
      end_offset: scan.offset,
      file_size: stat.size,
      bytes_read: Math.max(0, stat.size - scanStartOffset),
      bounded_window_bytes_read: Math.max(0, stat.size - windowStartOffset),
      alignment_bytes_read: Math.max(0, scanStartOffset - windowStartOffset),
      events_read: scan.emitted,
      partial: startOffset > 0,
    },
  };
}

function parseClaudeJsonl(filePath) {
  const detailed = parseClaudeJsonlDetailed(filePath);
  return detailed ? claudeStateMessages(detailed.state) : [];
}

function readClaudeMetadata(filePath) {
  const detailed = parseClaudeJsonlDetailed(filePath);
  const state = detailed?.state;
  return state ? {
    entrypoints: Array.from(state.entrypoints),
    workspacePath: state.workspacePath,
    modelId: state.modelId,
    permissionMode: state.permissionMode,
    effort: state.effort,
  } : { entrypoints: [], workspacePath: null, modelId: null, permissionMode: null, effort: null };
}

function buildClaudeSessionSummary(filePath, detailed, {
  messagesPartial = false,
  hydrateSkippedReason = null,
} = {}) {
  if (!detailed) return null;
  const { stat, state } = detailed;
  const cliSessionId = path.basename(filePath, '.jsonl');
  const workspaceDirName = path.basename(path.dirname(filePath));
  const workspacePath = state.workspacePath || decodeProjectDirName(workspaceDirName);
  const workspaceName = workspacePath ? path.basename(workspacePath) : workspaceDirName;
  const messages = claudeStateMessages(state);
  const entrypointList = Array.from(state.entrypoints);
  const isCliLike = entrypointList.length === 0
    || entrypointList.some(ep => !/vscode|ide|desktop/i.test(ep));
  const firstUser = messages.find(message => message.role === 'user');
  const title = (firstUser?.content || '').replace(/\s+/g, ' ').trim().substring(0, 80) || 'Claude CLI session';
  return {
    cliSessionId,
    filePath,
    workspacePath,
    workspaceName,
    title,
    messages,
    messageCount: messages.length,
    messagesHydrated: true,
    messagesPartial,
    ...(hydrateSkippedReason ? { hydrateSkippedReason } : {}),
    updatedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    entrypoints: entrypointList,
    isCliLike,
    model_id: state.modelId || undefined,
    permission_mode: state.permissionMode || undefined,
    effort: state.effort || undefined,
    sourceCursor: detailed.sourceCursor,
  };
}

function readSessionSummary(filePath, {
  includeMessages = true,
  maxHydrateBytes = DEFAULT_HYDRATE_MAX_BYTES,
  preferTailBytes = 0,
} = {}) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  if (!includeMessages) {
    const detailed = parseClaudeJsonlTail(filePath, DEFAULT_HYDRATE_TAIL_BYTES);
    const summary = buildClaudeSessionSummary(filePath, detailed, {
      messagesPartial: stat.size > DEFAULT_HYDRATE_TAIL_BYTES,
      hydrateSkippedReason: 'metadata_only_tail',
    });
    return summary ? { ...summary, messages: [], messageCount: 0, messagesHydrated: false } : null;
  }
  if (Number(preferTailBytes) > 0 && stat.size > Number(preferTailBytes)) {
    return buildClaudeSessionSummary(filePath, parseClaudeJsonlTail(filePath, preferTailBytes), {
      messagesPartial: true,
      hydrateSkippedReason: 'active_tail',
    });
  }
  if (stat.size > maxHydrateBytes) {
    return buildClaudeSessionSummary(filePath, parseClaudeJsonlTail(filePath, DEFAULT_HYDRATE_TAIL_BYTES), {
      messagesPartial: true,
      hydrateSkippedReason: 'file_too_large_tail',
    });
  }
  return buildClaudeSessionSummary(filePath, parseClaudeJsonlDetailed(filePath));
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

function startNativeClaudeWindow({ workspacePath, cliSessionId, resume = true, model, effort, permissionMode, title, launchMode = 'foreground' } = {}) {
  if (normalizeNativeLaunchMode(launchMode) === 'background') {
    return backgroundNativeLaunchResult('claude_cli');
  }
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
  watchSessions,
  startClaudePrintSession,
  startInteractiveClaude,
  startNativeClaudeWindow,
  stopNativeClaudeWindow,
  isWorkspaceTrusted,
  trustWorkspace,
};
