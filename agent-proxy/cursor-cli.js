'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let chokidar = null;
try { chokidar = require('chokidar'); } catch {}

const CURSOR_CLI_MODELS = [
  { id: 'claude-sonnet-5-thinking-high',     label: 'Claude Sonnet 5 Thinking High' },
  { id: 'claude-opus-4-8-thinking-high',     label: 'Claude Opus 4.8 Thinking High' },
  { id: 'claude-fable-5-thinking-high',      label: 'Claude Fable 5 Thinking High' },
  { id: 'claude-4.6-sonnet-medium-thinking', label: 'Claude 4.6 Sonnet Medium Thinking' },
  { id: 'grok-4.5-fast-xhigh',               label: 'Grok 4.5 Fast XHigh' },
  { id: 'gpt-5.5-medium',                    label: 'GPT-5.5 Medium' },
  { id: 'gpt-5.3-codex',                     label: 'GPT-5.3 Codex' },
  { id: 'composer-2.5',                      label: 'Composer 2.5' },
  { id: 'composer-2.5-fast',                 label: 'Composer 2.5 Fast' },
];

const CURSOR_CLI_PERMISSION_MODES = [
  { value: 'default', label: 'Default' },
  { value: 'force',   label: 'Force (Yolo)' },
  { value: 'plan',    label: 'Plan mode' },
  { value: 'ask',     label: 'Ask mode' },
];

const CURSOR_CLI_SANDBOX_MODES = [
  { value: 'enabled',  label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const SUMMARY_CACHE = new Map();
const MODELS_CACHE = { ts: 0, models: null };
const JSONL_CHUNK_BYTES = 1024 * 1024;
const JSONL_PARSE_ERROR = Symbol('jsonl_parse_error');
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

function envMb(name, fallback, min = 1) {
  const parsed = parseInt(process.env[name] || '', 10);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(min, mb) * 1024 * 1024;
}

const JSONL_MAX_LINE_BYTES = envMb('CURSOR_CLI_MAX_JSONL_LINE_MB', 8);
const DEFAULT_HYDRATE_MAX_BYTES = envMb('CURSOR_CLI_HYDRATE_MAX_MB', 75);
const DEFAULT_HYDRATE_TAIL_BYTES = envMb('CURSOR_CLI_HYDRATE_TAIL_MB', 4);
const DEFAULT_ACTIVE_HYDRATE_MAX_BYTES = envMb('CURSOR_CLI_ACTIVE_HYDRATE_MAX_MB', 16, 4);
const DEFAULT_ACTIVE_HYDRATE_TAIL_BYTES = envMb('CURSOR_CLI_ACTIVE_HYDRATE_TAIL_MB', 4);
const CURSOR_CLI_ACTIVITY_STALE_MS = Math.max(
  60 * 1000,
  parseInt(process.env.CURSOR_CLI_ACTIVITY_STALE_MS || '14400000', 10) || 14400000
);

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function sessionsDir() {
  return path.join(homeDir(), '.cursor', 'cli-sessions');
}

function sessionFilePath(cliSessionId, date) {
  const d = date instanceof Date ? date : new Date();
  const yyyy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(sessionsDir(), yyyy, mm, dd, `cursor-cli-${cliSessionId}.jsonl`);
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
  return Number.isFinite(maxFiles) && maxFiles > 0 ? out.slice(0, maxFiles) : out;
}

function compactJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value || ''); }
}

function pushDedup(messages, next) {
  if ((!next?.content || !next.content.trim()) && !Array.isArray(next?.content_blocks)) return;
  const last = messages[messages.length - 1];
  const lastBlocks = last?.content_blocks ? compactJson(last.content_blocks) : '';
  const nextBlocks = next?.content_blocks ? compactJson(next.content_blocks) : '';
  if (last && last.role === next.role && last.content === next.content && lastBlocks === nextBlocks) return;
  messages.push(next);
}

function isoFromMs(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

function latestIso(...values) {
  let best = 0;
  for (const value of values) {
    const ms = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
    if (Number.isFinite(ms) && ms > best) best = ms;
  }
  return isoFromMs(best);
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function scanJsonlLines(filePath, onLine, { startOffset = 0, endOffset = Infinity, processFinalLine = true, maxLines = 0, maxLineBytes = JSONL_MAX_LINE_BYTES } = {}) {
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
    const requestedEnd = Number(endOffset);
    const stopOffset = Number.isFinite(requestedEnd)
      ? Math.max(position, Math.min(stat.size, requestedEnd))
      : stat.size;
    const chunk = Buffer.allocUnsafe(JSONL_CHUNK_BYTES);
    while (position < stopOffset) {
      const wanted = Math.min(JSONL_CHUNK_BYTES, stopOffset - position);
      const bytesRead = fs.readSync(fd, chunk, 0, wanted, position);
      if (!bytesRead) break;
      let segmentStart = 0;
      for (let i = 0; i < bytesRead; i++) {
        if (chunk[i] !== 10) continue;
        if (i > segmentStart && !lineTooLarge) {
          const segmentLength = i - segmentStart;
          if (lineBytes + segmentLength <= maxLineBytes) {
            lineBuffers.push(Buffer.from(chunk.subarray(segmentStart, i)));
            lineBytes += segmentLength;
          } else {
            lineTooLarge = true;
            lineBuffers = [];
          }
        }
        let line = '';
        if (!lineTooLarge) {
          line = Buffer.concat(lineBuffers).toString('utf8');
          if (line.endsWith('\r')) line = line.slice(0, -1);
        }
        lineBuffers = [];
        lineBytes = 0;
        if (!lineTooLarge && line.trim()) {
          emitted++;
          const keepGoing = onLine(line);
          if (keepGoing === false || (maxLines > 0 && emitted >= maxLines)) {
            return { stat, offset: position + i + 1, emitted };
          }
        }
        lineTooLarge = false;
        lastCompleteOffset = position + i + 1;
        segmentStart = i + 1;
      }
      if (segmentStart < bytesRead && !lineTooLarge) {
        const segmentLength = bytesRead - segmentStart;
        if (lineBytes + segmentLength <= maxLineBytes) {
          lineBuffers.push(Buffer.from(chunk.subarray(segmentStart, bytesRead)));
          lineBytes += segmentLength;
        } else {
          lineTooLarge = true;
          lineBuffers = [];
          lineBytes = 0;
        }
      }
      position += bytesRead;
    }
    if (processFinalLine && !lineTooLarge && lineBuffers.length > 0) {
      let line = Buffer.concat(lineBuffers).toString('utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim()) {
        emitted++;
        const keepGoing = onLine(line);
        if (keepGoing !== JSONL_PARSE_ERROR) lastCompleteOffset = stopOffset;
        if (keepGoing === false) return { stat, offset: lastCompleteOffset, emitted };
      } else {
        lastCompleteOffset = stopOffset;
      }
    }
    return { stat, offset: lastCompleteOffset, emitted };
  } catch {
    return { stat, offset: lastCompleteOffset, emitted };
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function scanJsonlEntries(filePath, onEntry, options = {}) {
  return scanJsonlLines(filePath, line => {
    try { return onEntry(JSON.parse(line)); } catch { return JSONL_PARSE_ERROR; }
  }, options);
}

function scanStartAlignedToLine(filePath, startOffset) {
  if (!startOffset) return 0;
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    let pos = Math.max(0, Math.min(startOffset, stat.size));
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (pos < stat.size) {
      const bytes = fs.readSync(fd, chunk, 0, Math.min(chunk.length, stat.size - pos), pos);
      if (!bytes) break;
      for (let i = 0; i < bytes; i++) {
        if (chunk[i] === 10) return pos + i + 1;
      }
      pos += bytes;
    }
  } catch {
    return Math.max(0, startOffset);
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return Math.max(0, startOffset);
}

function extractTextFromMessage(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && part.type === 'text') return String(part.text || '');
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function buildToolCallBlock(completedEvent, startedEvent) {
  const toolCall = completedEvent?.tool_call || startedEvent?.tool_call || {};
  const callId = String(completedEvent?.call_id || startedEvent?.call_id || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (toolCall.shellToolCall) {
    const shell = toolCall.shellToolCall;
    const argsRaw = shell.args;
    let command = '';
    if (typeof argsRaw === 'string') {
      command = argsRaw;
    } else if (Array.isArray(argsRaw)) {
      command = argsRaw.map(a => (typeof a === 'string' && /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : String(a))).join(' ');
    } else if (argsRaw && typeof argsRaw === 'object') {
      command = String(argsRaw.command || argsRaw.cmd || '');
    }
    if (!command) command = String(shell.command || '');

    const result = shell.result && typeof shell.result === 'object' ? shell.result : null;
    const success = result && result.success && typeof result.success === 'object' ? result.success : null;
    const failure = result && result.failure && typeof result.failure === 'object' ? result.failure : null;
    const resultPayload = success || failure || result;
    const stdout = success
      ? String(success.interleavedOutput || success.stdout || '')
      : (typeof shell.result === 'string' ? shell.result : String(shell.output || shell.stdout || ''));
    const stderr = success
      ? String(success.stderr || '')
      : String((resultPayload && resultPayload.stderr) || shell.stderr || '');
    const exitCode = success
      ? (success.exitCode ?? success.exit_code ?? 0)
      : (resultPayload && (resultPayload.exitCode ?? resultPayload.exit_code) != null
        ? (resultPayload.exitCode ?? resultPayload.exit_code)
        : (shell.exit_code ?? shell.exitCode ?? null));

    return {
      type: 'terminal',
      title: shell.description || (argsRaw && argsRaw.description) || (command ? 'Command' : 'Shell'),
      command,
      stdout,
      stderr,
      exit_code: exitCode,
      status: failure ? 'failed' : 'completed',
      collapsed: true,
      call_id: callId || undefined,
    };
  }

  const toolType = Object.keys(toolCall).find(k => k !== 'call_id') || '';
  const toolData = toolType ? (toolCall[toolType] || {}) : toolCall;
  const description = toolData.description || toolType || 'Tool';
  const argsSection = toolData.args != null ? `arguments:\n${compactJson(toolData.args)}` : null;
  const resultSection = toolData.result != null ? `result:\n${compactJson(toolData.result)}` : null;
  const content = [argsSection, resultSection].filter(Boolean).join('\n\n');

  return {
    type: 'tool_call',
    title: description,
    content: content || compactJson(toolData),
    status: 'completed',
    collapsed: true,
    tool_name: toolType || undefined,
    call_id: callId || undefined,
  };
}

function createParseState(filePath) {
  const fileNameBase = path.basename(filePath, '.jsonl');
  const uuidMatch = fileNameBase.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return {
    filePath,
    cliSessionId: uuidMatch?.[1] || fileNameBase.replace(/^cursor-cli-/, ''),
    meta: {},
    messages: [],
    firstUserText: '',
    pendingToolCalls: new Map(),
    thinkingBuffer: '',
    pendingAssistantText: '',
    pendingAssistantHasNoTs: false,
    taskStartedAt: 0,
    taskCompletedAt: 0,
    lastEventAt: 0,
    lastUserAt: 0,
    lastAssistantAt: 0,
    lastThinkingAt: 0,
    model_id: 'default',
    permission_mode: 'default',
    workspacePath: null,
  };
}

function flushPendingThinking(state, tsMs) {
  if (!state.thinkingBuffer) return;
  const text = state.thinkingBuffer;
  state.thinkingBuffer = '';
  const ts = tsMs ? Math.floor(tsMs / 1000) : undefined;
  pushDedup(state.messages, {
    role: 'assistant',
    content: '',
    content_blocks: [{ type: 'thinking', title: 'Thinking', content: text, collapsed: true }],
    ts,
  });
}

function flushPendingAssistant(state, tsMs) {
  const text = state.pendingAssistantText;
  if (!text) return;
  state.pendingAssistantText = '';
  state.pendingAssistantHasNoTs = false;
  const ts = tsMs ? Math.floor(tsMs / 1000) : undefined;
  pushDedup(state.messages, {
    role: 'assistant',
    content: text,
    content_blocks: [{ type: 'markdown', content: text }],
    ts,
  });
}

function applyEventToState(state, event) {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'session_meta') {
    state.meta = { ...state.meta, ...event };
    if (event.cliSessionId) state.cliSessionId = event.cliSessionId;
    if (event.model_id) state.model_id = event.model_id;
    if (event.permission_mode) state.permission_mode = event.permission_mode;
    if (event.workspacePath) state.workspacePath = event.workspacePath;
    return;
  }

  const tsMs = typeof event.timestamp_ms === 'number' ? event.timestamp_ms : 0;
  if (tsMs > state.lastEventAt) state.lastEventAt = tsMs;

  if (event.type === 'system' && event.subtype === 'init') {
    if (event.session_id) state.cliSessionId = event.session_id;
    if (event.model) state.model_id = event.model;
    if (event.permissionMode) state.permission_mode = event.permissionMode;
    if (event.cwd) state.workspacePath = event.cwd;
    if (!state.taskStartedAt) state.taskStartedAt = tsMs || Date.now();
    return;
  }

  if (event.type === 'user') {
    flushPendingThinking(state, tsMs);
    flushPendingAssistant(state, tsMs);
    const content = extractTextFromMessage(event.message);
    if (!content) return;
    if (tsMs) state.lastUserAt = tsMs;
    if (!state.firstUserText) state.firstUserText = content;
    const ts = tsMs ? Math.floor(tsMs / 1000) : undefined;
    pushDedup(state.messages, { role: 'user', content, ts });
    return;
  }

  if (event.type === 'thinking') {
    const text = event.text || '';
    if (event.subtype === 'delta') {
      state.thinkingBuffer += text;
      if (tsMs) state.lastThinkingAt = tsMs;
    } else if (event.subtype === 'completed') {
      if (text) state.thinkingBuffer = text;
      if (tsMs) state.lastThinkingAt = tsMs;
      if (state.thinkingBuffer) flushPendingThinking(state, tsMs);
    }
    return;
  }

  if (event.type === 'assistant') {
    const text = extractTextFromMessage(event.message);
    if (!text) return;
    if (tsMs) state.lastAssistantAt = tsMs;
    const hasNoTs = typeof event.timestamp_ms !== 'number';
    if (!state.pendingAssistantHasNoTs) {
      if (hasNoTs || text.length > state.pendingAssistantText.length) {
        state.pendingAssistantText = text;
        if (hasNoTs) state.pendingAssistantHasNoTs = true;
      }
    }
    return;
  }

  if (event.type === 'tool_call') {
    if (event.subtype === 'started') {
      flushPendingThinking(state, tsMs);
      flushPendingAssistant(state, tsMs);
      const callId = String(event.call_id || '');
      if (callId) state.pendingToolCalls.set(callId, { ...event, startedAtMs: tsMs || Date.now() });
    } else if (event.subtype === 'completed') {
      const callId = String(event.call_id || '');
      const started = callId ? state.pendingToolCalls.get(callId) : null;
      if (callId) state.pendingToolCalls.delete(callId);
      const block = buildToolCallBlock(event, started);
      const ts = tsMs ? Math.floor(tsMs / 1000) : undefined;
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[${block.title || 'Tool'}]`,
        content_blocks: [block],
        ts,
      });
    }
    return;
  }

  if (event.type === 'result') {
    flushPendingThinking(state, tsMs);
    flushPendingAssistant(state, tsMs);
    state.taskCompletedAt = tsMs || Date.now();
    state.pendingToolCalls.clear();
    if (event.subtype === 'error') {
      const content = String(event.result || 'Cursor Agent CLI reported an error.');
      const ts = tsMs ? Math.floor(tsMs / 1000) : undefined;
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[Error]\n\n${content}`,
        content_blocks: [{ type: 'error', title: 'Error', content, status: 'error' }],
        ts,
      });
    }
  }
}

function parseCursorJsonlDetailed(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const prior = SUMMARY_CACHE.get(filePath);
  let state;
  let offset = 0;
  const canTail = prior && stat.size >= prior.offset && stat.size >= prior.size;
  if (canTail) {
    state = prior.state;
    offset = prior.offset;
  } else {
    state = createParseState(filePath);
  }
  const scan = scanJsonlEntries(filePath, entry => applyEventToState(state, entry), {
    startOffset: offset,
    processFinalLine: !canTail,
  });
  const next = { state, size: stat.size, mtimeMs: stat.mtimeMs, offset: scan.offset };
  SUMMARY_CACHE.set(filePath, next);
  return { state, stat };
}

function parseCursorJsonl(filePath) {
  const detailed = parseCursorJsonlDetailed(filePath);
  return detailed?.state?.messages || [];
}

function readSessionMeta(filePath) {
  const meta = {};
  scanJsonlEntries(filePath, entry => {
    if (entry?.type === 'session_meta') {
      Object.assign(meta, entry);
    } else if (entry?.type === 'system' && entry?.subtype === 'init') {
      if (entry.session_id && !meta.cliSessionId) meta.cliSessionId = entry.session_id;
      if (entry.model && !meta.model_id) meta.model_id = entry.model;
      if (entry.permissionMode && !meta.permission_mode) meta.permission_mode = entry.permissionMode;
      if (entry.cwd && !meta.workspacePath) meta.workspacePath = entry.cwd;
    }
  }, { maxLines: 80, processFinalLine: true });
  return meta;
}

function createCursorChunkParseState(filePath) {
  const meta = readSessionMeta(filePath);
  const state = createParseState(filePath);
  state.meta = { ...meta };
  if (meta.cliSessionId) state.cliSessionId = meta.cliSessionId;
  if (meta.model_id) state.model_id = meta.model_id;
  if (meta.permission_mode) state.permission_mode = meta.permission_mode;
  if (meta.workspacePath) state.workspacePath = meta.workspacePath;
  return state;
}

function parseCursorJsonlTail(filePath, tailBytes = DEFAULT_HYDRATE_TAIL_BYTES) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const state = createCursorChunkParseState(filePath);
  const wantedStart = Math.max(0, stat.size - Math.max(1024 * 1024, Number(tailBytes) || DEFAULT_HYDRATE_TAIL_BYTES));
  const startOffset = scanStartAlignedToLine(filePath, wantedStart);
  scanJsonlEntries(filePath, entry => applyEventToState(state, entry), { startOffset, processFinalLine: true });
  return { state, stat, startOffset };
}

function parseCursorJsonlChunk(filePath, { beforeOffset = null, chunkBytes = DEFAULT_HYDRATE_TAIL_BYTES } = {}) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const rawBefore = Number(beforeOffset);
  const endOffset = Number.isFinite(rawBefore) && rawBefore > 0
    ? Math.max(0, Math.min(stat.size, rawBefore))
    : stat.size;
  const bytes = Math.max(256 * 1024, Math.min(16 * 1024 * 1024, Number(chunkBytes) || DEFAULT_HYDRATE_TAIL_BYTES));
  const wantedStart = Math.max(0, endOffset - bytes);
  const startOffset = scanStartAlignedToLine(filePath, wantedStart);
  const state = createCursorChunkParseState(filePath);
  scanJsonlEntries(filePath, entry => applyEventToState(state, entry), {
    startOffset,
    endOffset,
    processFinalLine: endOffset >= stat.size,
  });
  return {
    state,
    stat,
    startOffset,
    endOffset,
    nextBeforeOffset: startOffset > 0 ? startOffset : null,
  };
}

function appendStreamEvent(filePath, event) {
  const line = (typeof event === 'string' ? event : JSON.stringify(event)) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

function ensureSessionFile(cliSessionId, meta) {
  const filePath = sessionFilePath(cliSessionId);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const metaLine = JSON.stringify({
      type: 'session_meta',
      cliSessionId,
      workspacePath: meta?.workspacePath || null,
      workspaceName: meta?.workspaceName || null,
      model_id: meta?.model_id || 'default',
      permission_mode: meta?.permission_mode || 'default',
      title: meta?.title || '',
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(filePath, metaLine + '\n', 'utf8');
  }
  return filePath;
}

function oversizedTranscriptMessage(summary, maxBytes) {
  return [{
    role: 'assistant',
    content: [
      '**Cursor Agent CLI transcript is too large to hydrate automatically.**',
      '',
      `File: ${summary.filePath}`,
      `Size: ${formatBytes(summary.sizeBytes || 0)}`,
      `Hydration cap: ${formatBytes(maxBytes)}`,
      '',
      'The session is listed and can still be resumed. Raise `CURSOR_CLI_HYDRATE_MAX_MB` if this archive needs to be fully loaded into the web UI.',
    ].join('\n'),
  }];
}

function readLightweightSessionSummary(filePath, stat) {
  const meta = readSessionMeta(filePath);
  const base = path.basename(filePath, '.jsonl');
  const uuidMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const cliSessionId = meta.cliSessionId || uuidMatch?.[1] || base.replace(/^cursor-cli-/, '');
  const workspacePath = meta.workspacePath || null;
  return {
    cliSessionId,
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : (meta.workspaceName || 'Cursor Agent'),
    title: meta.title || 'Cursor Agent session',
    messages: [],
    messageCount: 0,
    messagesHydrated: false,
    model_id: meta.model_id || 'default',
    permission_mode: meta.permission_mode || 'default',
    updatedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

function tailSessionSummary(filePath, stat, maxHydrateBytes, tailBytes, hydrateSkippedReason) {
  const summary = readLightweightSessionSummary(filePath, stat);
  const tail = parseCursorJsonlTail(filePath, tailBytes);
  const fallbackMessages = oversizedTranscriptMessage(summary, maxHydrateBytes);
  const messages = tail?.state?.messages?.length ? tail.state.messages : fallbackMessages;
  const tailHydrated = messages !== fallbackMessages;
  const tailState = tail?.state || null;
  const firstUser = tailState?.messages?.find(m => m.role === 'user');
  const titleSource = tailState?.firstUserText || firstUser?.content || '';
  const title = titleSource.replace(/\s+/g, ' ').trim().substring(0, 80) || summary.title;
  return {
    ...summary,
    ...(tailState?.model_id && tailState.model_id !== 'default' ? { model_id: tailState.model_id } : {}),
    ...(tailState?.permission_mode ? { permission_mode: tailState.permission_mode } : {}),
    ...(title !== summary.title ? { title } : {}),
    messages,
    messageCount: messages.length,
    messagesHydrated: tailHydrated,
    messagesPartial: true,
    hydrateSkippedReason: tailHydrated ? hydrateSkippedReason : 'file_too_large',
    activity: tailState ? buildActivityFromState(tailState) : null,
  };
}

function readSessionSummary(filePath, { includeMessages = true, maxHydrateBytes = DEFAULT_HYDRATE_MAX_BYTES, preferTailBytes = 0 } = {}) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  if (!includeMessages) return readLightweightSessionSummary(filePath, stat);
  if (Number(preferTailBytes) > 0 && stat.size > Number(preferTailBytes)) {
    return tailSessionSummary(filePath, stat, maxHydrateBytes, preferTailBytes, 'active_tail');
  }
  if (stat.size > maxHydrateBytes) {
    return tailSessionSummary(filePath, stat, maxHydrateBytes, DEFAULT_HYDRATE_TAIL_BYTES, 'file_too_large_tail');
  }
  const detailed = parseCursorJsonlDetailed(filePath);
  if (!detailed) return null;
  const { state } = detailed;
  const firstUser = state.messages.find(m => m.role === 'user');
  const titleSource = state.firstUserText || firstUser?.content || state.meta?.title || '';
  const title = titleSource.replace(/\s+/g, ' ').trim().substring(0, 80) || 'Cursor Agent session';
  const workspacePath = state.workspacePath || state.meta?.workspacePath || null;
  return {
    cliSessionId: state.cliSessionId,
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : (state.meta?.workspaceName || 'Cursor Agent'),
    title,
    messages: state.messages,
    messageCount: state.messages.length,
    messagesHydrated: true,
    model_id: state.model_id || state.meta?.model_id || 'default',
    permission_mode: state.permission_mode || state.meta?.permission_mode || 'default',
    updatedAt: latestIso(stat.mtime),
    sizeBytes: stat.size,
    activity: buildActivityFromState(state),
  };
}

function discoverSessions(limit = 0, options = {}) {
  const root = sessionsDir();
  if (!fs.existsSync(root)) return [];
  const rawLimit = parseInt(process.env.CURSOR_CLI_SESSION_LIMIT || '', 10);
  const effectiveLimit = (Number.isFinite(limit) && limit > 0) ? limit
    : (Number.isFinite(rawLimit) && rawLimit > 0) ? rawLimit : 20;
  const maxAgeHours = Math.max(0, parseFloat(process.env.CURSOR_CLI_ARCHIVE_MAX_AGE_HOURS || '') || 72);
  const maxAgeMs = maxAgeHours > 0 ? maxAgeHours * 60 * 60 * 1000 : 0;
  const now = Date.now();
  const files = walkJsonlFiles(root, 0);
  const filtered = maxAgeMs > 0 ? files.filter(item => now - item.stat.mtimeMs <= maxAgeMs) : files;
  return filtered
    .slice(0, effectiveLimit)
    .map(item => readSessionSummary(item.filePath, options))
    .filter(Boolean);
}

function findSessionByCliId(cliSessionId, options = {}) {
  if (!cliSessionId) return null;
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  const target = `cursor-cli-${cliSessionId}`;
  for (const item of walkJsonlFiles(root, 0)) {
    if (path.basename(item.filePath, '.jsonl') === target) {
      return readSessionSummary(item.filePath, options);
    }
  }
  return null;
}

function normPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function findLatestSessionForWorkspace(workspacePath, sinceMs = 0, options = {}) {
  const wanted = normPath(workspacePath);
  const summaries = discoverSessions(80, options);
  return summaries.find(summary => {
    if (wanted && normPath(summary.workspacePath) !== wanted) return false;
    const updated = summary.updatedAt ? new Date(summary.updatedAt).getTime() : 0;
    return !sinceMs || updated >= sinceMs;
  }) || null;
}

function existingFile(value) {
  if (!value) return null;
  try {
    const stat = fs.statSync(value);
    return stat.isFile() ? value : null;
  } catch {
    return null;
  }
}

function commandForPath(commandPath) {
  if (/\.m?js$/i.test(commandPath)) return { command: process.execPath, argsPrefix: [commandPath], shell: false };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
    return { command: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', commandPath], shell: false };
  }
  return { command: commandPath, argsPrefix: [], shell: false };
}

function resolveCursorCommand() {
  const explicit = existingFile(process.env.CURSOR_CLI_PATH);
  if (explicit) return commandForPath(explicit);
  const localApp = process.env.LOCALAPPDATA || path.join(homeDir(), 'AppData', 'Local');
  const agentCmd = existingFile(path.join(localApp, 'cursor-agent', 'agent.cmd'));
  if (agentCmd) return commandForPath(agentCmd);
  for (const bin of ['agent', 'cursor-agent']) {
    const where = process.platform === 'win32'
      ? spawnSync('where.exe', [bin], { encoding: 'utf8', timeout: 2000, windowsHide: true })
      : spawnSync('which', [bin], { encoding: 'utf8', timeout: 2000 });
    if (where.status === 0) {
      const found = String(where.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      if (found) return commandForPath(found);
    }
  }
  return null;
}

function createChatId() {
  const resolved = resolveCursorCommand();
  if (!resolved) return Promise.reject(new Error('Cursor Agent CLI not found'));
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, [...resolved.argsPrefix, 'create-chat'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.on('close', code => {
      const uuid = String(stdout).trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
      if (uuid) resolve(uuid);
      else reject(new Error(`create-chat exited ${code}: ${stdout.trim()}`));
    });
    child.on('error', reject);
  });
}

function listModels() {
  const now = Date.now();
  if (MODELS_CACHE.models && now - MODELS_CACHE.ts < MODELS_CACHE_TTL_MS) {
    return Promise.resolve(MODELS_CACHE.models);
  }
  const resolved = resolveCursorCommand();
  if (!resolved) return Promise.resolve(CURSOR_CLI_MODELS);
  return new Promise(resolve => {
    const child = spawn(resolved.command, [...resolved.argsPrefix, 'models'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.on('close', () => {
      const models = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = line.trim().match(/^([^\s]+)\s+-\s+(.+)$/);
        if (match) models.push({ id: match[1].trim(), label: match[2].trim() });
      }
      const result = models.length ? models : CURSOR_CLI_MODELS;
      MODELS_CACHE.ts = Date.now();
      MODELS_CACHE.models = result;
      resolve(result);
    });
    child.on('error', () => resolve(CURSOR_CLI_MODELS));
  });
}

function startCursorExecSession(opts) {
  const {
    workspacePath, cliSessionId, resume = false, content,
    model, permissionMode, sandbox, force,
    onStdout, onStderr, onEvent, onExit,
  } = opts || {};

  const resolved = resolveCursorCommand();
  if (!resolved) {
    process.nextTick(() => onExit && onExit(-1, new Error('Cursor Agent CLI not found')));
    return null;
  }

  const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust'];

  if (force || permissionMode === 'force' || permissionMode === 'yolo') {
    args.push('--force');
  } else if (permissionMode === 'plan') {
    args.push('--mode', 'plan');
  } else if (permissionMode === 'ask') {
    args.push('--mode', 'ask');
  }

  if (sandbox === 'enabled' || sandbox === true) args.push('--sandbox', 'enabled');
  else if (sandbox === 'disabled' || sandbox === false) args.push('--sandbox', 'disabled');

  if (model) args.push('--model', model);
  if (workspacePath) args.push('--workspace', workspacePath);

  if (resume && cliSessionId) {
    args.push('--resume', cliSessionId);
  } else if (cliSessionId) {
    args.push('--new-session-id', cliSessionId);
  }

  args.push(content || '');

  const filePath = cliSessionId
    ? ensureSessionFile(cliSessionId, {
        workspacePath: workspacePath || null,
        model_id: model || null,
        permission_mode: permissionMode || null,
      })
    : null;

  let lineBuffer = '';

  const child = spawn(resolved.command, [...resolved.argsPrefix, ...args], {
    cwd: workspacePath || process.cwd(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', chunk => {
    const text = chunk.toString('utf8');
    if (onStdout) onStdout(text);
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
      lineBuffer = lineBuffer.slice(idx + 1);
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (filePath) { try { appendStreamEvent(filePath, event); } catch {} }
      if (onEvent) onEvent(event);
    }
  });

  child.stderr.on('data', chunk => onStderr && onStderr(chunk.toString('utf8')));

  child.on('close', code => {
    if (lineBuffer.trim()) {
      let event;
      try { event = JSON.parse(lineBuffer.trim()); } catch {}
      if (event) {
        if (filePath) { try { appendStreamEvent(filePath, event); } catch {} }
        if (onEvent) onEvent(event);
      }
    }
    if (onExit) onExit(code);
  });

  child.on('error', err => onExit && onExit(-1, err));

  return child;
}

function quoteCmdArg(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function quotePowerShellString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function startNativeCursorWindow({ workspacePath, cliSessionId, resume = false, model, title } = {}) {
  const cwd = workspacePath || process.cwd();
  const resolved = resolveCursorCommand();
  const baseBin = resolved ? [resolved.command, ...resolved.argsPrefix] : ['agent'];

  const args = [];
  if (workspacePath) args.push('--workspace', workspacePath);
  if (resume && cliSessionId) args.push('--resume', cliSessionId);
  else if (cliSessionId) args.push('--new-session-id', cliSessionId);
  if (model) args.push('--model', model);

  if (process.platform !== 'win32') {
    return spawn(baseBin[0], [...baseBin.slice(1), ...args], { cwd, shell: false, stdio: 'inherit', windowsHide: false });
  }

  const windowTitle = String(title || 'Cursor Agent').replace(/["&<>|]/g, '').slice(0, 80) || 'Cursor Agent';
  const launcherId = cliSessionId || Date.now();
  const launcherPath = path.join(os.tmpdir(), `remote-agent-cursor-cli-${launcherId}.cmd`);
  const cmdLine = [...baseBin, ...args].map(quoteCmdArg).join(' ');

  fs.writeFileSync(launcherPath, [
    '@echo off',
    `title ${windowTitle}`,
    `cd /d ${quoteCmdArg(cwd)}`,
    cmdLine,
    '',
  ].join('\r\n'));

  const wtProbe = spawnSync('where.exe', ['wt'], { encoding: 'utf8', timeout: 1000, windowsHide: true });
  const hasWt = wtProbe.status === 0 && String(wtProbe.stdout || '').trim();

  let child;
  if (hasWt) {
    child = spawn('wt.exe', ['cmd.exe', '/k', launcherPath], {
      cwd,
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  } else {
    const ps = [
      'Start-Process',
      '-FilePath', quotePowerShellString('cmd.exe'),
      '-WorkingDirectory', quotePowerShellString(cwd),
      '-ArgumentList', quotePowerShellString(`/k ${quoteCmdArg(launcherPath)}`),
      '-WindowStyle', 'Normal',
    ].join(' ');
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      cwd,
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  child.unref();
  return child;
}

function watchSessions(onSummary, { onError, debounceMs = 120, summaryOptions = {} } = {}) {
  const root = sessionsDir();
  if (!chokidar) return null;
  if (String(process.env.CURSOR_CLI_WATCH_SESSIONS || '').toLowerCase() === 'false') return null;
  if (!fs.existsSync(root)) return null;
  const timers = new Map();
  const flush = filePath => {
    if (!String(filePath || '').toLowerCase().endsWith('.jsonl')) return;
    if (timers.has(filePath)) clearTimeout(timers.get(filePath));
    timers.set(filePath, setTimeout(() => {
      timers.delete(filePath);
      try {
        const summary = readSessionSummary(filePath, summaryOptions);
        if (summary && onSummary) onSummary(summary);
      } catch (e) {
        if (onError) onError(e);
      }
    }, debounceMs));
  };
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: false,
    depth: 8,
  });
  watcher.on('add', flush);
  watcher.on('change', flush);
  watcher.on('error', err => onError && onError(err));
  const close = watcher.close.bind(watcher);
  watcher.close = async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    return close();
  };
  return watcher;
}

function buildActivityFromState(state, { nowMs = Date.now() } = {}) {
  const completedAt = state.taskCompletedAt || 0;
  const pending = Array.from(state.pendingToolCalls?.values?.() || []).filter(call => {
    const startedAt = call?.startedAtMs || 0;
    if (!startedAt) return false;
    if (nowMs - startedAt > CURSOR_CLI_ACTIVITY_STALE_MS) return false;
    if ((state.lastAssistantAt || 0) > startedAt) return false;
    if (completedAt > startedAt) return false;
    return true;
  });
  const activeTool = pending[pending.length - 1] || null;
  const turnActive = state.taskStartedAt > completedAt
    && state.lastEventAt > 0
    && nowMs - state.lastEventAt <= CURSOR_CLI_ACTIVITY_STALE_MS;
  const updatedMs = activeTool?.startedAtMs || (turnActive ? state.lastEventAt : 0) || state.lastThinkingAt || state.lastEventAt || 0;
  const stale = updatedMs > 0 && nowMs - updatedMs > CURSOR_CLI_ACTIVITY_STALE_MS;
  const thinkingActive = !stale
    && state.lastThinkingAt > 0
    && state.lastThinkingAt >= (state.lastAssistantAt || 0)
    && state.lastThinkingAt > completedAt;
  const userAwaitingAssistant = !stale
    && state.lastUserAt > 0
    && state.lastUserAt > (state.lastAssistantAt || 0)
    && state.lastUserAt > completedAt;

  if (!activeTool && !turnActive && !thinkingActive && !userAwaitingAssistant) return null;

  const isShell = activeTool?.tool_call?.shellToolCall != null;
  const activeStartedMs = state.taskStartedAt > completedAt
    ? state.taskStartedAt
    : (activeTool?.startedAtMs || updatedMs || nowMs);

  return {
    kind: activeTool ? (isShell ? 'running_command' : 'generating') : 'generating',
    label: 'Working',
    updated_at: isoFromMs(updatedMs || nowMs),
    started_at: isoFromMs(activeStartedMs),
    interrupt_hint: 'esc to interrupt',
  };
}

module.exports = {
  CURSOR_CLI_MODELS,
  CURSOR_CLI_PERMISSION_MODES,
  CURSOR_CLI_SANDBOX_MODES,
  CURSOR_CLI_ACTIVE_HYDRATE_MAX_BYTES: DEFAULT_ACTIVE_HYDRATE_MAX_BYTES,
  CURSOR_CLI_ACTIVE_HYDRATE_TAIL_BYTES: DEFAULT_ACTIVE_HYDRATE_TAIL_BYTES,
  sessionsDir,
  resolveCursorCommand,
  createChatId,
  listModels,
  discoverSessions,
  findSessionByCliId,
  findLatestSessionForWorkspace,
  readSessionSummary,
  parseCursorJsonl,
  parseCursorJsonlChunk,
  appendStreamEvent,
  ensureSessionFile,
  startCursorExecSession,
  startNativeCursorWindow,
  watchSessions,
  buildActivityFromState,
};
