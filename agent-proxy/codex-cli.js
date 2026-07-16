'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { normalizeNativeLaunchMode, backgroundNativeLaunchResult } = require('./native-launch-mode');
const { setBoundedMap } = require('./bounded-map');
const { canonicalGoalRecord } = require('./goal-lifecycle');

let chokidar = null;
try { chokidar = require('chokidar'); } catch {}

const FALLBACK_CODEX_CLI_MODELS = [
  { id: 'gpt-5.5',                     label: 'GPT-5.5' },
  { id: 'gpt-5.6-sol',                 label: 'GPT-5.6-Sol' },
  { id: 'gpt-5.6-terra',               label: 'GPT-5.6-Terra' },
  { id: 'gpt-5.6-luna',                label: 'GPT-5.6-Luna' },
  { id: 'gpt-5.4',                     label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',                label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex-spark',         label: 'GPT-5.3 Codex Spark' },
  { id: 'ollama:deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)' },
  { id: 'ollama:kimi-k2.6:cloud',       label: 'Kimi K2.6 (Ollama Cloud)' },
];

const FALLBACK_CODEX_CLI_EFFORTS = [
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
  { id: 'xhigh',  label: 'Extra High' },
];

const CODEX_MODEL_ALIASES = Object.freeze({
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
  'gpt-5.6 sol': 'gpt-5.6-sol',
  'gpt-5.6 terra': 'gpt-5.6-terra',
  'gpt-5.6 luna': 'gpt-5.6-luna',
});

const CODEX_CLI_ACCESS_MODES = [
  { value: 'read-only',          label: 'Read only' },
  { value: 'workspace-write',    label: 'Workspace write' },
  { value: 'danger-full-access', label: 'Full access' },
];

const SUMMARY_CACHE = new Map();
const TAIL_SUMMARY_CACHE = new Map();
const CONFIG_OBSERVATION_CACHE = new Map();
const GOAL_RECOVERY_CACHE = new Map();
const SESSION_INDEX_CACHE = { sig: '', map: new Map() };
const CODEX_PROCESS_COUNT_CACHE = { ts: 0, count: 0 };
const JSONL_CHUNK_BYTES = 1024 * 1024;
const JSONL_PARSE_ERROR = Symbol('jsonl_parse_error');

function envMb(name, fallback, min = 1) {
  const parsed = parseInt(process.env[name] || '', 10);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(min, mb) * 1024 * 1024;
}

const JSONL_MAX_LINE_BYTES = envMb('CODEX_CLI_MAX_JSONL_LINE_MB', 8);
const DEFAULT_HYDRATE_MAX_BYTES = envMb('CODEX_CLI_HYDRATE_MAX_MB', 75);
const DEFAULT_HYDRATE_TAIL_BYTES = envMb('CODEX_CLI_HYDRATE_TAIL_MB', 4);
const DEFAULT_ACTIVE_HYDRATE_MAX_BYTES = envMb(
  'CODEX_CLI_ACTIVE_HYDRATE_MAX_MB',
  16,
  4
);
const DEFAULT_ACTIVE_HYDRATE_TAIL_BYTES = envMb('CODEX_CLI_ACTIVE_HYDRATE_TAIL_MB', 4);
const DEFAULT_CONFIG_OBSERVATION_TAIL_BYTES = envMb('CODEX_CLI_CONFIG_OBSERVATION_TAIL_MB', 64, 4);
const DEFAULT_INTERACTIVE_HISTORY_HOURS = Math.max(1, parseInt(process.env.CODEX_CLI_INTERACTIVE_HISTORY_HOURS || '24', 10) || 24);
const CODEX_CLI_ACTIVITY_STALE_MS = Math.max(60 * 1000, parseInt(process.env.CODEX_CLI_ACTIVITY_STALE_MS || '14400000', 10) || 14400000);

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function sessionsDir() {
  return path.join(homeDir(), '.codex', 'sessions');
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function normalizeCodexModelAlias(value, models = null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase().replace(/[_]+/g, '-').replace(/\s+/g, ' ').trim();
  const explicitAlias = CODEX_MODEL_ALIASES[lowered];
  if (explicitAlias) return explicitAlias;
  const catalog = Array.isArray(models) ? models : [];
  const compact = lowered.replace(/[\s-]+/g, '');
  const match = catalog.find(model => {
    const id = String(model?.id || '').toLowerCase();
    const label = String(model?.label || '').toLowerCase();
    return id === lowered
      || label === lowered
      || id.replace(/[\s-]+/g, '') === compact
      || label.replace(/[\s-]+/g, '') === compact;
  });
  return match?.id || raw;
}

function effortLabel(effort) {
  const value = String(effort || '').trim().toLowerCase();
  if (value === 'xhigh') return 'Extra High';
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readCodexModelCatalog(cachePath = path.join(homeDir(), '.codex', 'models_cache.json')) {
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  const advertised = Array.isArray(parsed?.models)
    ? parsed.models.filter(model => model?.visibility !== 'hide' && String(model?.slug || '').trim())
    : [];
  if (advertised.length === 0) {
    return {
      models: FALLBACK_CODEX_CLI_MODELS.map(model => ({ ...model })),
      efforts: FALLBACK_CODEX_CLI_EFFORTS.map(effort => ({ ...effort })),
      source: 'bundled_fallback',
      fetched_at: null,
      client_version: null,
    };
  }
  const models = advertised.map(model => ({
    id: String(model.slug),
    label: String(model.display_name || model.slug),
    default_effort: String(model.default_reasoning_level || '').trim() || null,
    supported_efforts: Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.map(level => String(level?.effort || level || '').trim()).filter(Boolean)
      : [],
  }));
  const effortIds = [];
  for (const model of models) {
    for (const effort of model.supported_efforts) {
      if (!effortIds.includes(effort)) effortIds.push(effort);
    }
  }
  return {
    models,
    efforts: (effortIds.length > 0 ? effortIds : FALLBACK_CODEX_CLI_EFFORTS.map(item => item.id))
      .map(id => ({ id, label: effortLabel(id) })),
    source: 'codex_models_cache',
    fetched_at: parsed?.fetched_at || null,
    client_version: parsed?.client_version || null,
  };
}

const CODEX_CLI_CATALOG = readCodexModelCatalog();
const CODEX_CLI_MODELS = CODEX_CLI_CATALOG.models;
const CODEX_CLI_EFFORTS = CODEX_CLI_CATALOG.efforts;

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

function prettyJsonString(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return compactJson(value);
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function responseMessageText(payload) {
  const content = payload?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textFromContentPart).filter(Boolean).join('\n\n');
  return '';
}

function reasoningText(payload) {
  const summary = payload?.summary;
  if (typeof summary === 'string') return summary;
  if (Array.isArray(summary)) {
    return summary.map(part => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || part?.summary || '';
    }).filter(Boolean).join('\n\n');
  }
  if (summary && typeof summary === 'object') {
    return summary.text || summary.content || '';
  }
  return responseMessageText(payload) || payload?.text || '';
}

function isCodexContextNoise(text) {
  const trimmed = String(text || '').trim();
  return /^<(?:recommended_plugins|environment_context|codex_internal_context|goal_context|turn_aborted)(?:\s|>)/i.test(trimmed)
    || /^# AGENTS\.md instructions\b/i.test(trimmed);
}

function functionCallText(payload) {
  const name = payload?.name || payload?.call_id || 'tool';
  const body = toolCallBody(payload);
  return `[Tool: ${name}]${body ? `\n\n${body}` : ''}`;
}

function functionOutputText(payload, knownCall = null) {
  const name = knownCall?.name || payload?.name || payload?.tool || '';
  const label = name ? `Tool result: ${name}` : 'Tool result';
  return `[${label}]\n\n${toolResultBody(payload, knownCall) || '(no output)'}`;
}

const CODEX_NATIVE_CONTEXT = Symbol('codex_native_context');

function codexNativePairFamily(kind, role) {
  if (role === 'assistant' && (kind === 'response_item.message' || kind === 'event_msg.agent_message')) return 'assistant_message';
  if (role === 'user' && (kind === 'response_item.message' || kind === 'event_msg.user_message')) return 'user_message';
  if (role === 'assistant' && (kind === 'response_item.reasoning' || kind === 'event_msg.agent_reasoning')) return 'reasoning';
  return '';
}

function stampNativeMessage(messages, next) {
  const context = messages?.[CODEX_NATIVE_CONTEXT];
  if (!context) return;
  const identity = nativeEntryIdentity(context.entry, context.offsets);
  if (!next.native_source_id) next.native_source_id = identity.id;
  if (!next.native_source_kind) next.native_source_kind = identity.kind;
  if (!next.source_message_id) {
    const basis = `${context.state?.cliSessionId || context.state?.fileCliSessionId || ''}\u0000${next.native_source_id}`;
    next.source_message_id = `codex_cli:${crypto.createHash('sha256').update(basis).digest('hex').substring(0, 32)}`;
  }
  const producerTime = new Date(context.entry?.timestamp || '').getTime();
  if (Number.isFinite(producerTime)) next.created_at = new Date(producerTime).toISOString();
  Object.defineProperty(next, '_native_start_offset', {
    configurable: true,
    enumerable: false,
    value: Math.max(0, Number(context.offsets?.start_offset) || 0),
  });
  Object.defineProperty(next, '_native_end_offset', {
    configurable: true,
    enumerable: false,
    value: Math.max(0, Number(context.offsets?.end_offset) || 0),
  });
}

function pushDedup(messages, next) {
  if ((!next?.content || !next.content.trim()) && !Array.isArray(next?.content_blocks)) return;
  if (next.role === 'user' && isCodexContextNoise(next.content)) return;
  stampNativeMessage(messages, next);
  const last = messages[messages.length - 1];
  const lastBlocks = last?.content_blocks ? compactJson(last.content_blocks) : '';
  const nextBlocks = next?.content_blocks ? compactJson(next.content_blocks) : '';
  const sameBody = last && last.role === next.role && last.content === next.content && lastBlocks === nextBlocks;
  const lastFamily = codexNativePairFamily(last?.native_source_kind, last?.role);
  const nextFamily = codexNativePairFamily(next?.native_source_kind, next?.role);
  const explicitNativePair = sameBody
    && !last?.native_source_paired
    && !!lastFamily
    && lastFamily === nextFamily
    && last.native_source_kind !== next.native_source_kind;
  if (explicitNativePair) {
    if (next.native_source_kind.startsWith('response_item.')) {
      last.native_source_id = next.native_source_id;
      last.source_message_id = next.source_message_id;
      last.native_source_kind = next.native_source_kind;
      if (next.created_at) last.created_at = next.created_at;
      if (next.ts != null) last.ts = next.ts;
    }
    last.native_source_paired = true;
    delete next._preserve_identical;
    return;
  }
  if (sameBody && next._preserve_identical !== true) return;
  delete next._preserve_identical;
  messages.push(next);
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
  let lineStartOffset = position;
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
          const keepGoing = onLine(line, {
            start_offset: lineStartOffset,
            end_offset: position + i + 1,
          });
          if (keepGoing === false || (maxLines > 0 && emitted >= maxLines)) {
            return { stat, offset: position + i + 1, emitted };
          }
        }
        lineTooLarge = false;
        lastCompleteOffset = position + i + 1;
        lineStartOffset = lastCompleteOffset;
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
        const keepGoing = onLine(line, {
          start_offset: lineStartOffset,
          end_offset: stopOffset,
        });
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
  return scanJsonlLines(filePath, (line, offsets) => {
    try { return onEntry(JSON.parse(line), offsets); } catch { return JSONL_PARSE_ERROR; }
  }, options);
}

function timestampSeconds(entry) {
  return entry?.timestamp ? Math.floor(new Date(entry.timestamp).getTime() / 1000) : undefined;
}

function timestampMs(entry) {
  const ms = entry?.timestamp ? new Date(entry.timestamp).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
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

function msFromUnixSeconds(value) {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 0;
}

function eventTimeMsFromUnixSeconds(value, entryMs = 0) {
  const payloadMs = msFromUnixSeconds(value);
  if (!payloadMs) return entryMs || 0;
  if (entryMs && Math.abs(entryMs - payloadMs) < 1000) return Math.max(payloadMs, entryMs);
  return payloadMs;
}

function parseToolArguments(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function toolCommandDetails(payload) {
  const args = parseToolArguments(payload?.arguments ?? payload?.args ?? payload?.input ?? payload?.content);
  if (!args || typeof args !== 'object') return {};
  const command = args.command || args.cmd || args.script || '';
  const workdir = args.workdir || args.cwd || args.working_directory || '';
  const details = {};
  if (command) details.command = String(command);
  if (workdir) details.workdir = String(workdir);
  return details;
}

function toolCallBody(payload) {
  const argsRaw = payload?.arguments ?? payload?.args ?? payload?.input ?? payload?.content ?? '';
  const sections = [
    payload?.name ? `tool: ${payload.name}` : null,
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    argsRaw !== '' && argsRaw != null ? `arguments:\n${prettyJsonString(argsRaw)}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function toolResultBody(payload, knownCall = null) {
  const out = payload?.output ?? payload?.content ?? payload?.result ?? '';
  const sections = [
    knownCall?.name ? `tool: ${knownCall.name}` : payload?.name ? `tool: ${payload.name}` : payload?.tool ? `tool: ${payload.tool}` : null,
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    out !== '' && out != null ? `output:\n${prettyJsonString(out)}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function webSearchBody(payload) {
  const action = payload?.action || {};
  const queries = Array.isArray(action.queries) ? action.queries : [];
  const query = payload?.query || action.query || queries[0] || '';
  const sections = [
    'tool: web_search',
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    query ? `query:\n${query}` : null,
    queries.length > 1 ? `queries:\n${queries.map(q => `- ${q}`).join('\n')}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function toolSearchCallBody(payload) {
  const args = payload?.arguments || {};
  const sections = [
    'tool: tool_search',
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    Object.keys(args).length ? `arguments:\n${prettyJsonString(args)}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function toolSearchOutputBody(payload) {
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const names = [];
  for (const namespace of tools) {
    const ns = namespace?.name || namespace?.namespace || 'tools';
    const inner = Array.isArray(namespace?.tools) ? namespace.tools : [];
    if (inner.length === 0) {
      names.push(String(ns));
      continue;
    }
    for (const tool of inner) {
      names.push(`${ns}.${tool?.name || tool?.type || 'tool'}`);
    }
  }
  const sections = [
    'tool: tool_search',
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    names.length ? `matched tools:\n${names.map(name => `- ${name}`).join('\n')}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function mcpInvocationName(payload) {
  const invocation = payload?.invocation || {};
  const server = invocation.server || payload?.server || '';
  const tool = invocation.tool || payload?.tool || payload?.name || '';
  if (server && tool) return `${server}.${tool}`;
  return tool || server || 'MCP tool';
}

function mcpToolCallBody(payload) {
  const invocation = payload?.invocation || {};
  const sections = [
    `tool: ${mcpInvocationName(payload)}`,
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    invocation.arguments ? `arguments:\n${prettyJsonString(invocation.arguments)}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function mcpToolResultBody(payload) {
  const result = payload?.result;
  const ok = result?.Ok ?? result?.ok ?? result;
  const structured = ok?.structuredContent || ok?.structured_content || null;
  const content = Array.isArray(ok?.content)
    ? ok.content.map(part => part?.text || part?.content || '').filter(Boolean).join('\n\n')
    : '';
  const duration = payload?.duration && typeof payload.duration === 'object'
    ? `${payload.duration.secs || 0}.${String(payload.duration.nanos || 0).padStart(9, '0')}s`
    : '';
  const sections = [
    `tool: ${mcpInvocationName(payload)}`,
    payload?.call_id ? `call_id: ${payload.call_id}` : null,
    duration ? `duration: ${duration}` : null,
    structured ? `structuredContent:\n${prettyJsonString(structured)}` : null,
    content ? `content:\n${content}` : null,
    !structured && !content && result ? `result:\n${prettyJsonString(result)}` : null,
  ].filter(Boolean);
  return sections.join('\n\n');
}

function toolBlock(payload, { title, status = 'completed', type = 'tool_call', collapsed, content: contentOverride } = {}) {
  const isOutput = payload?.type === 'function_call_output'
    || payload?.type === 'local_shell_call_output'
    || payload?.type === 'custom_tool_call_output';
  let content = contentOverride;
  if (content == null) {
    content = isOutput ? toolResultBody(payload) : toolCallBody(payload);
  }
  if (content && typeof content !== 'string') content = compactJson(content);
  const block = {
    type,
    title: title || payload?.name || payload?.call_id || 'Tool',
    status,
    content: String(content != null ? content : (isOutput ? toolResultBody(payload) : toolCallBody(payload))),
    call_id: payload?.call_id || undefined,
    tool_name: payload?.name || payload?.tool || undefined,
    ...toolCommandDetails(payload),
  };
  if (collapsed != null) block.collapsed = collapsed;
  return block;
}

function promptBlock({ title, content, status = null, collapsed = false }) {
  const block = {
    type: 'prompt',
    title,
    content: String(content || ''),
    collapsed,
  };
  if (status) block.status = status;
  return block;
}

function noticeBlock({ title, content, tone = 'info', status = null, actions = null }) {
  const block = {
    type: 'notice',
    title,
    content: String(content || ''),
    tone,
  };
  if (status) block.status = status;
  if (Array.isArray(actions) && actions.length) block.actions = actions;
  return block;
}

function stoppedStatusBlock(label = 'Interrupted') {
  const content = String(label || 'Interrupted').trim() || 'Interrupted';
  return {
    type: 'status',
    label: content,
    content,
    status: 'stopped',
  };
}

function planBlock(taskList, { title = 'Plan' } = {}) {
  return {
    type: 'plan',
    title,
    total: taskList?.total || 0,
    completed: taskList?.completed || 0,
    tasks: Array.isArray(taskList?.tasks) ? taskList.tasks : [],
  };
}

function commandText(value) {
  if (Array.isArray(value)) {
    return value.map(part => {
      const raw = String(part ?? '');
      return /\s/.test(raw) ? `"${raw.replace(/"/g, '\\"')}"` : raw;
    }).join(' ');
  }
  return String(value || '');
}

function execCommandBlock(payload) {
  const command = commandText(payload?.command || payload?.cmd || '');
  return {
    type: 'terminal',
    title: command ? 'Command' : 'Terminal output',
    collapsed: false,
    command,
    workdir: payload?.cwd || payload?.workdir || '',
    stdout: payload?.stdout || payload?.output || payload?.aggregated_output || '',
    stderr: payload?.stderr || '',
    exit_code: payload?.exit_code ?? payload?.code ?? null,
  };
}

function patchBlock(payload) {
  const rawChanges = payload?.changes;
  const changes = Array.isArray(rawChanges)
    ? rawChanges
    : (rawChanges && typeof rawChanges === 'object')
      ? Object.entries(rawChanges).map(([filePath, change]) => ({
        ...(change && typeof change === 'object' ? change : {}),
        path: filePath,
      }))
      : [];
  const files = changes.map(change => {
    const diff = change.unified_diff || change.diff || change.patch || '';
    const added = change.added ?? change.additions;
    const removed = change.removed ?? change.deletions;
    return {
      path: change.path || change.file || 'file',
      added,
      removed,
      type: change.type || change.status || undefined,
      diff: diff || undefined,
    };
  });
  const diffBody = files
    .filter(file => file.diff)
    .map(file => [
      `### ${file.path}`,
      '',
      '```diff',
      file.diff,
      '```',
    ].join('\n'))
    .join('\n\n');
  const output = payload?.stdout || payload?.aggregated_output || payload?.message || '';
  return {
    type: 'file_changes',
    title: 'Patch applied',
    status: payload?.success === false ? 'failed' : 'completed',
    collapsed: false,
    files_changed: files.length || undefined,
    files,
    content: [output, diffBody].filter(Boolean).join('\n\n'),
  };
}

function compactedBlock(payload) {
  const content = payload?.message || payload?.text || 'Conversation context compacted.';
  return noticeBlock({ title: 'Context compacted', content });
}

function rollbackBlock(payload) {
  const turns = Number(payload?.num_turns || payload?.turns || 0);
  const content = turns > 0
    ? `Rolled back ${turns} ${turns === 1 ? 'turn' : 'turns'}.`
    : 'Thread rolled back.';
  return noticeBlock({ title: 'Thread rolled back', content, status: 'completed' });
}

function viewImageBlock(payload) {
  const imagePath = payload?.path || payload?.file || payload?.image_path || '';
  const content = imagePath ? `Viewed image:\n\n${imagePath}` : 'Viewed image.';
  return {
    type: 'artifact',
    title: 'Image viewed',
    content,
    path: imagePath || undefined,
  };
}

function normalizePlanStatus(status) {
  const raw = String(status || '').toLowerCase().replace(/[-\s]+/g, '_');
  if (raw === 'completed' || raw === 'complete' || raw === 'done') return 'completed';
  if (raw === 'in_progress' || raw === 'running' || raw === 'active' || raw === 'working') return 'in_progress';
  return 'pending';
}

function planTaskListFromArgs(argsRaw) {
  const args = parseToolArguments(argsRaw);
  const plan = Array.isArray(args?.plan) ? args.plan : [];
  const tasks = plan.map(item => ({
    text: String(item?.step || item?.text || item?.title || '').trim(),
    state: normalizePlanStatus(item?.status || item?.state),
  })).filter(item => item.text);
  if (tasks.length === 0) return null;
  return {
    total: tasks.length,
    completed: tasks.filter(item => item.state === 'completed').length,
    tasks,
  };
}

function activePlanText(taskList) {
  if (!taskList || !Array.isArray(taskList.tasks)) return '';
  return (taskList.tasks.find(t => t.state === 'in_progress') || taskList.tasks.find(t => t.state === 'pending') || taskList.tasks[0])?.text || '';
}

function normalizeThreadGoal(payload, tsMs = 0, {
  previousGoal = null,
  sessionKey = '',
  sourceCursor = null,
} = {}) {
  const goal = payload?.goal;
  if (!goal || typeof goal !== 'object') return null;
  const createdMs = msFromUnixSeconds(goal.createdAt);
  const updatedMs = msFromUnixSeconds(goal.updatedAt) || tsMs || 0;
  return canonicalGoalRecord({
    objective: String(goal.objective || '').trim(),
    raw_state: String(goal.status || '').trim() || 'active',
    time_used_seconds: Math.max(0, Number(goal.timeUsedSeconds) || 0),
    tokens_used: Math.max(0, Number(goal.tokensUsed) || 0),
    created_at: createdMs ? isoFromMs(createdMs) : null,
    native_updated_at: updatedMs ? isoFromMs(updatedMs) : null,
  }, {
    previousGoal,
    sessionKey,
    source: 'codex_cli_jsonl',
    sourceCursor,
    nativeUpdatedAt: updatedMs ? isoFromMs(updatedMs) : null,
    observedAt: tsMs ? isoFromMs(tsMs) : new Date().toISOString(),
  });
}

function activityGoal(goal) {
  if (!goal || typeof goal !== 'object') return null;
  const state = String(goal.state || goal.status || 'unknown');
  return {
    ...goal,
    label: goal.label || 'Goal',
    text: goal.objective || '',
    objective: goal.objective || '',
    state,
    status: state,
    time_used_seconds: goal.time_used_seconds ?? goal.timeUsedSeconds ?? 0,
    tokens_used: goal.tokens_used ?? goal.tokensUsed ?? 0,
    started_at: goal.started_at || goal.created_at || null,
    created_at: goal.created_at || null,
    updated_at: goal.updated_at || null,
  };
}

function activityStep(taskList) {
  const tasks = Array.isArray(taskList?.tasks) ? taskList.tasks : [];
  if (tasks.length === 0) return null;
  let index = tasks.findIndex(task => task?.state === 'in_progress');
  if (index < 0) index = tasks.findIndex(task => task?.state === 'pending');
  if (index < 0) index = Math.max(0, tasks.length - 1);
  return {
    current: index + 1,
    total: tasks.length,
    state: tasks[index]?.state || 'pending',
    text: tasks[index]?.text || '',
  };
}

function activityUsage(state) {
  if (!state?.rateLimitActive && !(Number(state?.percentUsed) >= 100)) return null;
  const reset = state.rateLimitedUntil && state.rateLimitedUntil !== 'unknown'
    ? state.rateLimitedUntil
    : null;
  return {
    state: 'exhausted',
    title: "You're out of Codex and Work usage",
    detail: reset ? `Your rate limit resets at ${reset}.` : 'Your rate limit reset time is not available yet.',
    resets_at: reset,
    percent_used: Number(state.percentUsed) || 100,
  };
}

function toolActivityText(known) {
  if (!known) return '';
  if (known.command) return `$ ${known.command}`;
  const syntheticPayload = {
    name: known.name,
    call_id: known.call_id,
    arguments: known.arguments,
  };
  return toolCallBody(syntheticPayload);
}

function buildCodexCliActivity(state, { nowMs = Date.now() } = {}) {
  const completedAt = state.taskCompletedAt || 0;
  const pending = Array.from(state.pendingToolCalls?.values?.() || []).filter(call => {
    const startedAt = call?.startedAtMs || 0;
    if (!startedAt) return false;
    if (nowMs - startedAt > CODEX_CLI_ACTIVITY_STALE_MS) return false;
    if (state.lastAssistantAt > startedAt) return false;
    if (completedAt > startedAt) return false;
    return true;
  });
  const activeTool = pending[pending.length - 1] || null;
  const turnActive = state.taskStartedAt > completedAt
    && state.lastEventAt > 0
    && nowMs - state.lastEventAt <= CODEX_CLI_ACTIVITY_STALE_MS;
  const updatedMs = activeTool?.startedAtMs || (turnActive ? state.lastEventAt : 0) || state.lastReasoningAt || state.lastResponseItemAt || state.lastEventAt || 0;
  const stale = updatedMs > 0 && nowMs - updatedMs > CODEX_CLI_ACTIVITY_STALE_MS;
  const assistantAt = state.lastAssistantAt || 0;
  const userAt = state.lastUserAt || 0;
  const reasoningActive = !stale && state.lastReasoningAt > 0 && state.lastReasoningAt >= assistantAt && (state.lastReasoningAt >= userAt || userAt > assistantAt);
  // A terminal task_complete is authoritative even when the provider exits
  // without an assistant message (for example, exhausted model credits).
  // Otherwise the last user row keeps a restarted proxy stuck in generating
  // until the multi-hour stale timeout expires.
  const userAwaitingAssistant = !stale && userAt > 0 && userAt > assistantAt && userAt > completedAt;
  const goal = activityGoal(state.activeGoal);
  const step = activityStep(state.latestPlan);
  const usage = activityUsage(state);
  if (!activeTool && !turnActive && !reasoningActive && !userAwaitingAssistant) {
    if (state.latestPlan || goal || usage) {
      return {
        kind: 'idle',
        label: '',
        updated_at: isoFromMs(state.lastEventAt),
        ...(state.latestPlan ? { task_list: state.latestPlan } : {}),
        ...(step ? { step } : {}),
        ...(goal ? { goal } : {}),
        ...(usage ? { usage } : {}),
      };
    }
    return null;
  }
  const isCommand = !!activeTool?.command || activeTool?.name === 'shell_command' || activeTool?.type === 'local_shell_call';
  const label = 'Working';
  const activeTurnStartedMs = state.taskStartedAt > completedAt ? state.taskStartedAt : 0;
  const activeStartedMs = activeTurnStartedMs || activeTool?.startedAtMs || updatedMs || nowMs;
  const reasoningText = reasoningActive
    ? String(state.lastReasoningText || '').trim()
    : '';
  const assistantActive = !activeTool
    && turnActive
    && state.lastAssistantAt > activeTurnStartedMs
    && state.lastAssistantAt > completedAt
    && !!String(state.lastAssistantText || '').trim();
  const current = activeTool
    ? {
        kind: 'tool',
        label: isCommand ? 'Running command' : `Tool: ${activeTool.name || activeTool.type || 'tool'}`,
        partial: toolActivityText(activeTool),
        since: isoFromMs(activeTool.startedAtMs || activeStartedMs),
      }
    : (assistantActive
        ? {
            kind: 'answer',
            label: 'Answering',
            partial: String(state.lastAssistantText || '').trim(),
            since: isoFromMs(state.lastAssistantAt || activeStartedMs),
          }
        : null);
  const activity = {
    kind: activeTool ? (isCommand ? 'running_command' : 'generating') : (reasoningActive ? 'thinking' : 'generating'),
    label,
    updated_at: isoFromMs(updatedMs || nowMs),
    started_at: isoFromMs(activeStartedMs),
    interrupt_hint: 'esc to interrupt',
  };
  if (reasoningText) {
    activity.thinking = {
      text: reasoningText,
      since: isoFromMs(state.lastReasoningAt || activeStartedMs),
    };
  }
  if (current) activity.current = current;
  // Legacy clients consumed one overloaded field. Keep it during the rollout,
  // but canonical clients must use activity.thinking/activity.current.
  const legacyLiveText = current?.partial || reasoningText;
  if (legacyLiveText) activity.thinkingContent = legacyLiveText;
  if (state.latestPlan) activity.task_list = state.latestPlan;
  if (step) activity.step = step;
  if (goal) activity.goal = goal;
  if (usage) activity.usage = usage;
  return activity;
}

function sessionIdFromFilePath(filePath) {
  return path.basename(filePath, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] || '';
}

function fallbackSessionIdFromPath(filePath) {
  return path.basename(filePath, '.jsonl').replace(/^rollout-/, '');
}

function metadataSessionId(meta) {
  return String(meta?.session_id || meta?.id || '').trim();
}

function applyMetadataSessionId(state, meta) {
  const metaId = metadataSessionId(meta);
  if (metaId && !state.fileCliSessionId) state.cliSessionId = metaId;
}

function nativeConfigFields(entry) {
  const payload = entry?.payload || {};
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const rawModel = payload.model || payload.model_slug || metadata.model || metadata.model_slug || null;
  const rawEffort = payload.effort
    || payload.reasoning_effort
    || payload.model_reasoning_effort
    || metadata.effort
    || metadata.reasoning_effort
    || metadata.model_reasoning_effort
    || null;
  return {
    rawModel: rawModel == null ? null : String(rawModel).trim() || null,
    rawEffort: rawEffort == null ? null : String(rawEffort).trim() || null,
  };
}

function nativeConfigSource(entry) {
  if (entry?.type === 'session_meta') return 'session_meta';
  if (entry?.type === 'turn_context') return 'turn_context';
  if (entry?.type === 'response_item') return `response_item.${entry?.payload?.type || 'metadata'}`;
  return String(entry?.type || 'native_metadata');
}

function applyNativeConfigObservation(state, entry, offsets = null) {
  const { rawModel, rawEffort } = nativeConfigFields(entry);
  if (!rawModel && !rawEffort) return false;
  const observedAt = entry?.timestamp && !Number.isNaN(Date.parse(entry.timestamp))
    ? new Date(entry.timestamp).toISOString()
    : null;
  const source = nativeConfigSource(entry);
  const cursor = {
    start_offset: Math.max(0, Number(offsets?.start_offset) || 0),
    end_offset: Math.max(0, Number(offsets?.end_offset) || 0),
  };
  if (rawModel) {
    state.model_id = normalizeCodexModelAlias(rawModel, CODEX_CLI_MODELS);
    state.model_observation = {
      raw_value: rawModel,
      normalized_value: state.model_id,
      source,
      observed_at: observedAt,
      cursor,
    };
  }
  if (rawEffort) {
    state.effort = rawEffort.toLowerCase();
    state.effort_observation = {
      raw_value: rawEffort,
      normalized_value: state.effort,
      source,
      observed_at: observedAt,
      cursor,
    };
  }
  return true;
}

function createParseState(filePath) {
  const fileCliSessionId = sessionIdFromFilePath(filePath);
  return {
    filePath,
    fileCliSessionId,
    cliSessionId: fileCliSessionId || fallbackSessionIdFromPath(filePath),
    meta: {},
    messages: [],
    firstUserText: '',
    toolCalls: new Map(),
    pendingToolCalls: new Map(),
    latestPlan: null,
    activeGoal: null,
    lastGoalTranscriptKey: '',
    threadName: '',
    tokenUsage: null,
    rateLimits: null,
    percentUsed: null,
    rateLimitActive: false,
    rateLimitedUntil: null,
    taskStartedAt: 0,
    taskCompletedAt: 0,
    lastEventAt: 0,
    lastUserAt: 0,
    lastAssistantAt: 0,
    lastAssistantText: '',
    lastReasoningAt: 0,
    lastReasoningText: '',
    lastResponseItemAt: 0,
    model_id: 'unknown',
    effort: 'unknown',
    model_observation: null,
    effort_observation: null,
    permission_mode: 'workspace-write',
    approval_policy: null,
  };
}

function rememberToolCall(state, payload, startedAtMs = 0) {
  const callId = String(payload?.call_id || '').trim();
  if (!callId) return null;
  const details = toolCommandDetails(payload);
  const argsRaw = payload?.arguments ?? payload?.args ?? payload?.input ?? payload?.content ?? '';
  const known = {
    call_id: callId,
    name: payload?.name || payload?.tool || '',
    type: payload?.type || '',
    arguments: argsRaw,
    command: details.command || '',
    workdir: details.workdir || '',
    startedAtMs,
  };
  state.toolCalls.set(callId, known);
  state.pendingToolCalls.set(callId, known);
  const taskList = known.name === 'update_plan' ? planTaskListFromArgs(argsRaw) : null;
  if (taskList) {
    known.taskList = taskList;
    state.latestPlan = taskList;
  }
  return known;
}

function lookupToolCall(state, payload) {
  const callId = String(payload?.call_id || '').trim();
  return callId ? state.toolCalls.get(callId) || null : null;
}

function applyEntryToState(state, entry) {
  const payload = entry?.payload || {};
  const ts = timestampSeconds(entry);
  const tsMs = timestampMs(entry);
  const nativeContext = state.messages?.[CODEX_NATIVE_CONTEXT];
  applyNativeConfigObservation(state, entry, nativeContext?.offsets || null);
  if (tsMs) state.lastEventAt = tsMs;
  if (entry.type === 'session_meta' && payload) {
    state.meta = { ...state.meta, ...payload };
    applyMetadataSessionId(state, payload);
    return;
  }
  if (entry.type === 'turn_context' && payload) {
    if (payload.sandbox_mode || payload.sandbox_policy?.mode || payload.sandbox_policy?.type) {
      state.permission_mode = payload.sandbox_mode || payload.sandbox_policy.mode || payload.sandbox_policy.type;
    }
    if (payload.approval_policy) state.approval_policy = payload.approval_policy;
    return;
  }
  if (entry.type === 'compacted') {
    const block = compactedBlock(payload);
    pushDedup(state.messages, {
      role: 'assistant',
      content: `[Context compacted]\n\n${block.content}`,
      content_blocks: [block],
      ts,
    });
    return;
  }
  if (entry.type === 'response_item') {
    if (tsMs) state.lastResponseItemAt = tsMs;
    if (payload.type === 'message') {
      if (payload.role === 'developer' || payload.role === 'system') return;
      const role = payload.role === 'user' ? 'user' : 'assistant';
      const content = responseMessageText(payload);
      if (role === 'user') state.lastUserAt = tsMs || state.lastUserAt;
      else {
        state.lastAssistantAt = tsMs || state.lastAssistantAt;
        if (content) state.lastAssistantText = content;
      }
      if (role === 'user' && !state.firstUserText && !isCodexContextNoise(content)) state.firstUserText = content;
      pushDedup(state.messages, {
        role,
        content,
        ...(role === 'assistant' && content ? { content_blocks: [{ type: 'markdown', content }] } : {}),
        ...(payload.id ? { native_source_id: `response_item.message:id:${String(payload.id)}` } : {}),
        native_source_kind: 'response_item.message',
        _preserve_identical: true,
        ts,
      });
    } else if (payload.type === 'reasoning') {
      state.lastReasoningAt = tsMs || state.lastReasoningAt;
      const text = reasoningText(payload);
      if (text) {
        state.lastReasoningText = text;
        pushDedup(state.messages, {
          role: 'assistant',
          content: 'Reasoning',
          content_blocks: [{ type: 'thinking', title: 'Reasoning', content: text, collapsed: false }],
          native_source_kind: 'response_item.reasoning',
          _preserve_identical: true,
          ts,
        });
      }
    } else if (payload.type === 'function_call' || payload.type === 'local_shell_call') {
      const knownCall = rememberToolCall(state, payload, tsMs);
      const block = knownCall?.taskList
        ? planBlock(knownCall.taskList)
        : toolBlock(payload, { title: payload.name ? `Tool: ${payload.name}` : 'Tool call', status: payload.status || 'completed', collapsed: false });
      pushDedup(state.messages, { role: 'assistant', content: functionCallText(payload), content_blocks: [block], ts });
    } else if (payload.type === 'function_call_output' || payload.type === 'local_shell_call_output') {
      const knownCall = lookupToolCall(state, payload);
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const title = knownCall?.name ? `Tool result: ${knownCall.name}` : 'Tool result';
      const block = toolBlock(payload, { title, type: 'tool_result', status: payload.status || 'completed', collapsed: false, content: toolResultBody(payload, knownCall) });
      pushDedup(state.messages, { role: 'assistant', content: functionOutputText(payload, knownCall), content_blocks: [block], ts });
    } else if (payload.type === 'custom_tool_call') {
      rememberToolCall(state, payload, tsMs);
      const block = toolBlock(payload, { title: payload.name ? `Tool: ${payload.name}` : 'Tool call', status: payload.status || 'completed', collapsed: false });
      pushDedup(state.messages, { role: 'assistant', content: functionCallText(payload), content_blocks: [block], ts });
    } else if (payload.type === 'custom_tool_call_output') {
      const knownCall = lookupToolCall(state, payload);
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const title = knownCall?.name ? `Tool result: ${knownCall.name}` : 'Tool result';
      const block = toolBlock(payload, { title, type: 'tool_result', status: payload.status || 'completed', collapsed: false, content: toolResultBody(payload, knownCall) });
      pushDedup(state.messages, { role: 'assistant', content: functionOutputText(payload, knownCall), content_blocks: [block], ts });
    } else if (payload.type === 'web_search_call') {
      const block = toolBlock(payload, {
        title: 'Tool: web_search',
        status: payload.status || 'running',
        collapsed: false,
        content: webSearchBody(payload),
      });
      pushDedup(state.messages, { role: 'assistant', content: '[Tool: web_search]', content_blocks: [block], ts });
    } else if (payload.type === 'tool_search_call') {
      rememberToolCall(state, { ...payload, name: 'tool_search', arguments: payload.arguments || {} }, tsMs);
      const block = toolBlock(payload, {
        title: 'Tool: tool_search',
        status: payload.status || 'running',
        collapsed: false,
        content: toolSearchCallBody(payload),
      });
      pushDedup(state.messages, { role: 'assistant', content: '[Tool: tool_search]', content_blocks: [block], ts });
    } else if (payload.type === 'tool_search_output') {
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const block = toolBlock(payload, {
        title: 'Tool result: tool_search',
        type: 'tool_result',
        status: payload.status || 'completed',
        collapsed: false,
        content: toolSearchOutputBody(payload),
      });
      pushDedup(state.messages, { role: 'assistant', content: '[Tool result: tool_search]', content_blocks: [block], ts });
    }
    return;
  }
  if (entry.type === 'event_msg') {
    if (payload.type === 'user_message') {
      const content = payload.message || payload.text || '';
      state.lastUserAt = tsMs || state.lastUserAt;
      if (!state.firstUserText && !isCodexContextNoise(content)) state.firstUserText = content;
      pushDedup(state.messages, {
        role: 'user',
        content,
        native_source_kind: 'event_msg.user_message',
        _preserve_identical: true,
        ts,
      });
    } else if (payload.type === 'agent_message') {
      state.lastAssistantAt = tsMs || state.lastAssistantAt;
      const content = payload.message || payload.text || '';
      if (content) state.lastAssistantText = content;
      pushDedup(state.messages, {
        role: 'assistant',
        content,
        ...(content ? { content_blocks: [{ type: 'markdown', content }] } : {}),
        native_source_kind: 'event_msg.agent_message',
        _preserve_identical: true,
        ts,
      });
    } else if (payload.type === 'exec_command_end') {
      const block = execCommandBlock(payload);
      const output = block.stdout || block.stderr || '';
      if (output || block.command) {
        pushDedup(state.messages, {
          role: 'assistant',
          content: block.command ? `[Command]\n\n$ ${block.command}` : `[Command output]\n\n${output}`,
          content_blocks: [block],
          ts,
        });
      }
    } else if (payload.type === 'patch_apply_end') {
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const block = patchBlock(payload);
      pushDedup(state.messages, { role: 'assistant', content: 'Patch applied', content_blocks: [block], ts });
    } else if (payload.type === 'mcp_tool_call_end') {
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const name = mcpInvocationName(payload);
      const block = toolBlock(payload, {
        title: `Tool result: ${name}`,
        type: 'tool_result',
        status: payload.status || 'completed',
        collapsed: false,
        content: [mcpToolCallBody(payload), mcpToolResultBody(payload)].filter(Boolean).join('\n\n'),
      });
      pushDedup(state.messages, { role: 'assistant', content: `[Tool result: ${name}]`, content_blocks: [block], ts });
    } else if (payload.type === 'agent_reasoning') {
      const text = payload.text || payload.message || '';
      if (text) {
        state.lastReasoningAt = tsMs || state.lastReasoningAt;
        state.lastReasoningText = text;
        pushDedup(state.messages, {
          role: 'assistant',
          content: 'Reasoning',
          content_blocks: [{ type: 'thinking', title: 'Reasoning', content: text, collapsed: false }],
          native_source_kind: 'event_msg.agent_reasoning',
          _preserve_identical: true,
          ts,
        });
      }
    } else if (payload.type === 'web_search_end') {
      if (payload?.call_id) state.pendingToolCalls.delete(String(payload.call_id));
      const block = toolBlock(payload, {
        title: 'Tool result: web_search',
        type: 'tool_result',
        status: payload.status || 'completed',
        collapsed: false,
        content: webSearchBody(payload),
      });
      pushDedup(state.messages, { role: 'assistant', content: '[Tool result: web_search]', content_blocks: [block], ts });
    } else if (payload.type === 'thread_goal_updated') {
      const goal = normalizeThreadGoal(payload, tsMs, {
        previousGoal: state.activeGoal,
        sessionKey: state.cliSessionId || state.fileCliSessionId || state.filePath,
        sourceCursor: nativeContext?.offsets || null,
      });
      state.activeGoal = goal || state.activeGoal;
      if (goal?.objective) {
        const key = `${goal.objective}\n${goal.status}`;
        if (key !== state.lastGoalTranscriptKey) {
          state.lastGoalTranscriptKey = key;
          const content = [
            `Status: ${goal.status}`,
            '',
            goal.objective,
            goal.timeUsedSeconds ? `\nTime used: ${goal.timeUsedSeconds}s` : '',
            goal.tokensUsed ? `Tokens used: ${goal.tokensUsed}` : '',
          ].filter(part => part !== '').join('\n');
          pushDedup(state.messages, {
            role: 'assistant',
            content: `[Goal updated]\n\n${content}`,
            content_blocks: [noticeBlock({ title: 'Goal updated', content, status: goal.status })],
            ts,
          });
        }
      }
    } else if (payload.type === 'thread_name_updated') {
      if (payload.thread_name) state.threadName = String(payload.thread_name || '').trim();
    } else if (payload.type === 'view_image_tool_call') {
      const block = viewImageBlock(payload);
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[Image viewed]\n\n${block.content}`,
        content_blocks: [block],
        ts,
      });
    } else if (payload.type === 'token_count') {
      state.tokenUsage = payload.info?.total_token_usage || payload.info?.last_token_usage || state.tokenUsage;
      state.rateLimits = payload.rate_limits || state.rateLimits;
      const primary = payload.rate_limits?.primary || null;
      const secondary = payload.rate_limits?.secondary || null;
      const primaryPct = Number(primary?.used_percent);
      const secondaryPct = Number(secondary?.used_percent);
      const pct = Math.max(
        Number.isFinite(primaryPct) ? primaryPct : -1,
        Number.isFinite(secondaryPct) ? secondaryPct : -1
      );
      if (pct >= 0) state.percentUsed = pct;
      state.rateLimitActive = !!payload.rate_limits?.rate_limit_reached_type || pct >= 100;
      const resetAt = primary?.resets_at || secondary?.resets_at;
      state.rateLimitedUntil = state.rateLimitActive && resetAt ? isoFromMs(msFromUnixSeconds(resetAt)) : null;
    } else if (payload.type === 'task_started') {
      state.taskStartedAt = eventTimeMsFromUnixSeconds(payload.started_at, tsMs) || state.taskStartedAt;
    } else if (payload.type === 'task_complete') {
      state.taskCompletedAt = eventTimeMsFromUnixSeconds(payload.completed_at, tsMs) || state.taskCompletedAt;
      state.pendingToolCalls.clear();
    } else if (payload.type === 'turn_aborted') {
      state.taskCompletedAt = tsMs || state.taskCompletedAt;
      state.pendingToolCalls.clear();
      const label = String(payload.reason || '').toLowerCase() === 'interrupted'
        ? 'Interrupted'
        : 'Turn aborted';
      pushDedup(state.messages, {
        role: 'assistant',
        content: label,
        content_blocks: [stoppedStatusBlock(label)],
        ts,
      });
    } else if (payload.type === 'error') {
      const content = payload.message || payload.text || payload.error || 'Codex CLI reported an error.';
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[Error]\n\n${content}`,
        content_blocks: [{
          type: 'error',
          title: payload.codex_error_info ? `Error: ${payload.codex_error_info}` : 'Error',
          content,
          status: 'error',
        }],
        ts,
      });
    } else if (payload.type === 'context_compacted') {
      const content = compactedBlock(payload).content;
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[Context compacted]\n\n${content}`,
        content_blocks: [compactedBlock(payload)],
        ts,
      });
    } else if (payload.type === 'thread_rolled_back') {
      const block = rollbackBlock(payload);
      pushDedup(state.messages, {
        role: 'assistant',
        content: `[Thread rolled back]\n\n${block.content}`,
        content_blocks: [block],
        ts,
      });
    }
  }
}

function parseCodexJsonlDetailed(filePath) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const prior = SUMMARY_CACHE.get(filePath);
  let state;
  let offset = 0;
  const canTail = !!prior
    && stat.size >= prior.offset
    && stat.size >= prior.size
    && prior.anchor === fileCursorAnchor(filePath, prior.offset)
    && !(stat.size === prior.size && stat.mtimeMs !== prior.mtimeMs);
  if (canTail) {
    state = prior.state;
    offset = prior.offset;
  } else {
    state = createParseState(filePath);
  }
  const scanStartOffset = offset;
  const scan = scanJsonlEntries(filePath, (entry, offsets) => applyScannedEntryToState(state, entry, offsets), {
    startOffset: offset,
    processFinalLine: true,
  });
  const next = {
    state,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    offset: scan.offset,
    anchor: fileCursorAnchor(filePath, scan.offset),
  };
  setBoundedMap(SUMMARY_CACHE, filePath, next, 32);
  return {
    state,
    stat,
    sourceCursor: {
      mode: canTail ? (stat.size > prior.size ? 'append' : 'unchanged') : (prior ? 'recovery' : 'baseline'),
      start_offset: scanStartOffset,
      end_offset: scan.offset,
      file_size: stat.size,
      bytes_read: Math.max(0, stat.size - scanStartOffset),
      events_read: scan.emitted,
    },
  };
}

function parseCodexJsonl(filePath) {
  const detailed = parseCodexJsonlDetailed(filePath);
  return detailed?.state?.messages || [];
}

function sessionIndexPath() {
  return path.join(homeDir(), '.codex', 'session_index.jsonl');
}

function historyPath() {
  return path.join(homeDir(), '.codex', 'history.jsonl');
}

function readSessionIndex() {
  const filePath = sessionIndexPath();
  const stat = safeStat(filePath);
  if (!stat) return new Map();
  const sig = `${stat.mtimeMs}:${stat.size}`;
  if (SESSION_INDEX_CACHE.sig === sig) return SESSION_INDEX_CACHE.map;
  const map = new Map();
  scanJsonlEntries(filePath, entry => {
    if (entry?.id) setBoundedMap(map, entry.id, entry, 4096);
  }, { processFinalLine: true });
  SESSION_INDEX_CACHE.sig = sig;
  SESSION_INDEX_CACHE.map = map;
  return map;
}

function readCliHistory({ maxLines = 500 } = {}) {
  const filePath = historyPath();
  const stat = safeStat(filePath);
  if (!stat) return [];
  const entries = [];
  scanJsonlEntries(filePath, entry => {
    if (entry?.session_id) entries.push(entry);
  }, { processFinalLine: true });
  entries.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  return Number.isFinite(maxLines) && maxLines > 0 ? entries.slice(0, maxLines) : entries;
}

function recentInteractiveSessionIds({ limit = 1, maxAgeMs = DEFAULT_INTERACTIVE_HISTORY_HOURS * 60 * 60 * 1000 } = {}) {
  const nowSeconds = Date.now() / 1000;
  const maxAgeSeconds = Math.max(0, Number(maxAgeMs) || 0) / 1000;
  const seen = new Set();
  const out = [];
  for (const entry of readCliHistory()) {
    const sessionId = String(entry.session_id || '').trim();
    if (!sessionId || seen.has(sessionId)) continue;
    const ts = Number(entry.ts) || 0;
    if (maxAgeSeconds > 0 && ts > 0 && nowSeconds - ts > maxAgeSeconds) continue;
    seen.add(sessionId);
    out.push(sessionId);
    if (Number.isFinite(limit) && limit > 0 && out.length >= limit) break;
  }
  return out;
}

function runningCodexCliProcessCount({ cacheMs = 10000 } = {}) {
  const now = Date.now();
  if (cacheMs > 0 && CODEX_PROCESS_COUNT_CACHE.ts && now - CODEX_PROCESS_COUNT_CACHE.ts < cacheMs) {
    return CODEX_PROCESS_COUNT_CACHE.count;
  }
  let count = 0;
  try {
    if (process.platform === 'win32') {
      const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$items = Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match '@openai\\\\codex|codex\\.js' }",
        '@($items).Count',
      ].join('; ');
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
      });
      count = parseInt(String(result.stdout || '').trim(), 10) || 0;
    } else {
      const result = spawnSync('ps', ['-eo', 'command'], { encoding: 'utf8', timeout: 2500 });
      count = String(result.stdout || '')
        .split(/\r?\n/)
        .filter(line => /@openai[\\/]+codex|codex\.js/i.test(line))
        .length;
    }
  } catch {
    count = 0;
  }
  CODEX_PROCESS_COUNT_CACHE.ts = now;
  CODEX_PROCESS_COUNT_CACHE.count = Math.max(0, count);
  return CODEX_PROCESS_COUNT_CACHE.count;
}

function readJsonlHead(filePath, maxLines = 80) {
  const lines = [];
  scanJsonlLines(filePath, line => {
    lines.push(line);
  }, { maxLines, processFinalLine: true });
  return lines;
}

function readSessionMeta(filePath) {
  const lines = readJsonlHead(filePath, 80);
  let meta = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const payload = entry?.payload || {};
      if (entry.type === 'session_meta' && payload) {
        meta = { ...meta, ...payload };
      } else if (entry.type === 'turn_context' && payload) {
        if (payload.cwd && !meta.cwd) meta.cwd = payload.cwd;
        if (payload.model) meta.model = payload.model;
        if (payload.effort || payload.reasoning_effort || payload.model_reasoning_effort) {
          meta.effort = payload.effort || payload.reasoning_effort || payload.model_reasoning_effort;
        }
        if (payload.sandbox_mode || payload.sandbox_policy?.mode || payload.sandbox_policy?.type) {
          meta.sandbox_mode = payload.sandbox_mode || payload.sandbox_policy.mode || payload.sandbox_policy.type;
        }
        if (payload.approval_policy) meta.approval_policy = payload.approval_policy;
      } else if (entry.type === 'event_msg' && payload.type === 'thread_name_updated' && payload.thread_name) {
        meta.thread_name = payload.thread_name;
      }
    } catch {}
  }
  return meta;
}

function cloneConfigObservationState(filePath, source = null) {
  const state = createParseState(filePath);
  if (!source) return state;
  state.model_id = source.model_id || 'unknown';
  state.effort = source.effort || 'unknown';
  state.model_observation = source.model_observation ? { ...source.model_observation } : null;
  state.effort_observation = source.effort_observation ? { ...source.effort_observation } : null;
  return state;
}

function readLatestNativeConfigObservation(filePath, tailBytes = DEFAULT_CONFIG_OBSERVATION_TAIL_BYTES) {
  const stat = safeStat(filePath);
  if (!stat) return {
    model_id: 'unknown', effort: 'unknown', model_observation: null, effort_observation: null,
    source_cursor: null,
  };
  const boundedTailBytes = Math.max(4 * 1024 * 1024, Number(tailBytes) || DEFAULT_CONFIG_OBSERVATION_TAIL_BYTES);
  const prior = CONFIG_OBSERVATION_CACHE.get(filePath);
  const canAppend = !!prior
    && prior.tailBytes === boundedTailBytes
    && stat.size >= prior.offset
    && stat.size >= prior.size
    && prior.anchor === fileCursorAnchor(filePath, prior.offset)
    && !(stat.size === prior.size && stat.mtimeMs !== prior.mtimeMs);
  if (canAppend && stat.size === prior.size && stat.mtimeMs === prior.mtimeMs) return prior.result;

  let state;
  let scanStartOffset;
  let mode;
  if (canAppend) {
    state = cloneConfigObservationState(filePath, prior.state);
    scanStartOffset = prior.offset;
    mode = 'append';
  } else {
    state = createParseState(filePath);
    scanJsonlEntries(filePath, (entry, offsets) => {
      applyNativeConfigObservation(state, entry, offsets);
    }, { maxLines: 80, processFinalLine: true });
    scanStartOffset = scanStartAlignedToLine(filePath, Math.max(0, stat.size - boundedTailBytes));
    mode = prior ? 'recovery' : 'bounded_tail';
  }
  const scan = scanJsonlEntries(filePath, (entry, offsets) => {
    applyNativeConfigObservation(state, entry, offsets);
  }, { startOffset: scanStartOffset, processFinalLine: true });
  const result = {
    model_id: state.model_observation ? state.model_id : 'unknown',
    effort: state.effort_observation ? state.effort : 'unknown',
    model_observation: state.model_observation,
    effort_observation: state.effort_observation,
    source_cursor: {
      mode,
      start_offset: scanStartOffset,
      end_offset: scan.offset,
      file_size: stat.size,
      bounded_tail_bytes: boundedTailBytes,
    },
  };
  setBoundedMap(CONFIG_OBSERVATION_CACHE, filePath, {
    state,
    result,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    offset: scan.offset,
    tailBytes: boundedTailBytes,
    anchor: fileCursorAnchor(filePath, scan.offset),
  }, 128);
  return result;
}

function trimPathCandidate(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const variants = [
    text.replace(/\s+\(.+$/s, ''),
    text.replace(/\s+\[.+$/s, ''),
    text.replace(/\.\s+.+$/s, ''),
    text.replace(/;\s+.+$/s, ''),
    text.replace(/,\s+.+$/s, ''),
    text,
  ];
  for (const variant of variants) {
    const cleaned = variant.replace(/[)\].,;:]+$/g, '').trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function existingPathPrefix(rawPath) {
  let candidate = trimPathCandidate(rawPath);
  if (!candidate) return '';
  if (fs.existsSync(candidate)) return candidate;
  const parts = candidate.split(/[\\/]+/).filter(Boolean);
  if (!/^[A-Za-z]:/.test(candidate) || parts.length < 2) return '';
  const drive = parts[0];
  for (let end = parts.length; end >= 2; end--) {
    const prefix = `${drive}\\${parts.slice(1, end).join('\\')}`;
    if (fs.existsSync(prefix)) return prefix;
  }
  return '';
}

function directoryForWorkspaceCandidate(rawPath) {
  const existing = existingPathPrefix(rawPath);
  if (!existing) return '';
  try {
    const stat = fs.statSync(existing);
    return stat.isFile() ? path.dirname(existing) : existing;
  } catch {
    return '';
  }
}

function findGitRoot(startPath) {
  let cur = directoryForWorkspaceCandidate(startPath) || startPath;
  if (!cur) return '';
  try { cur = path.resolve(cur); } catch { return ''; }
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (!parent || parent === cur) return '';
    cur = parent;
  }
}

function isHomeWorkspace(workspacePath) {
  if (!workspacePath) return true;
  try {
    return path.resolve(workspacePath).toLowerCase() === path.resolve(homeDir()).toLowerCase();
  } catch {
    return false;
  }
}

function workspaceCandidatesFromText(text) {
  const source = String(text || '');
  if (!source) return [];
  const byRoot = new Map();
  const re = /[A-Za-z]:\\[^\r\n"'<>|]+/g;
  let match;
  while ((match = re.exec(source))) {
    const fragments = match[0]
      .split(/(?=\s*[A-Za-z]:\\)/g)
      .map(part => part.trim())
      .filter(Boolean);
    for (const raw of fragments) {
      const dir = directoryForWorkspaceCandidate(raw);
      const root = findGitRoot(dir || raw) || dir;
      if (!root) continue;
      const key = root.toLowerCase();
      const rawIndex = Math.max(0, source.indexOf(raw, match.index));
      const context = source.slice(Math.max(0, rawIndex - 120), Math.min(source.length, rawIndex + raw.length + 160)).toLowerCase();
      let score = 1;
      if (/agents\.md|claude\.md|readme\.md|package\.json|\.sln|\.csproj/i.test(raw)) score += 16;
      if (/\b(work in|working in|all your work happens|parent repo|repo root|cwd|cd\s+)/i.test(context)) score += 16;
      if (/\bread first\b|\bmandatory\b|\bsource of truth\b/i.test(context)) score += 4;
      if (/\btargeting\b|\bdo not touch\b|\bnon-goals?\b|\bexcept by\b/i.test(context)) score -= 14;
      if (/\.git[\\/]hooks|install(?:ing)? a hook/i.test(raw) || /\.git[\\/]hooks|install(?:ing)? a hook/i.test(context)) score -= 12;
      if (fs.existsSync(path.join(root, '.git'))) score += 4;
      const existing = byRoot.get(key);
      if (!existing || score > existing.score) {
        byRoot.set(key, { workspacePath: root, workspaceName: path.basename(root) || root, score });
      }
    }
  }
  const out = Array.from(byRoot.values());
  out.sort((a, b) => b.score - a.score || a.workspacePath.length - b.workspacePath.length);
  return out;
}

function resolveCodexWorkspace(metaCwd, ...texts) {
  const cwd = metaCwd || null;
  const cwdWorkspace = cwd ? (findGitRoot(cwd) || directoryForWorkspaceCandidate(cwd) || cwd) : null;
  if (cwdWorkspace && !isHomeWorkspace(cwdWorkspace)) {
    return {
      workspacePath: cwdWorkspace,
      workspaceName: path.basename(cwdWorkspace) || cwdWorkspace,
    };
  }

  const inferred = workspaceCandidatesFromText(texts.filter(Boolean).join('\n\n'))[0] || null;
  const workspacePath = inferred?.workspacePath || cwdWorkspace || cwd || null;
  return {
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : 'Codex CLI',
  };
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
  const workspace = resolveCodexWorkspace(meta.cwd || null, firstUserText);
  const workspacePath = workspace.workspacePath || null;
  const fileCliSessionId = sessionIdFromFilePath(filePath);
  return {
    cliSessionId: fileCliSessionId || metadataSessionId(meta) || fallbackSessionIdFromPath(filePath),
    filePath,
    workspacePath,
    workspaceName: workspace.workspaceName,
    title: firstUserText.replace(/\s+/g, ' ').trim().substring(0, 80) || 'Codex CLI session',
    updatedAt: stat.mtime.toISOString(),
    hasUser: !!firstUserText,
  };
}

function readLightweightSessionSummary(filePath, stat) {
  const meta = readSessionMeta(filePath);
  const configObservation = readLatestNativeConfigObservation(filePath);
  const candidate = readSessionCandidate(filePath, stat);
  const cliSessionId = candidate.cliSessionId || metadataSessionId(meta);
  const index = readSessionIndex().get(cliSessionId) || null;
  const workspace = resolveCodexWorkspace(meta.cwd || null, candidate.title);
  const candidateWorkspacePath = candidate.workspacePath && !isHomeWorkspace(candidate.workspacePath)
    ? candidate.workspacePath
    : null;
  const workspacePath = candidateWorkspacePath || workspace.workspacePath || candidate.workspacePath || null;
  const titleSource = index?.thread_name || meta.thread_name || candidate.title || '';
  return {
    cliSessionId,
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : workspace.workspaceName,
    title: titleSource.replace(/\s+/g, ' ').trim().substring(0, 80) || 'Codex CLI session',
    messages: [],
    messageCount: 0,
    messagesHydrated: false,
    model_id: configObservation.model_id,
    effort: configObservation.effort,
    model_observation: configObservation.model_observation,
    effort_observation: configObservation.effort_observation,
    config_source_cursor: configObservation.source_cursor,
    permission_mode: meta.sandbox_mode || 'workspace-write',
    approval_policy: meta.approval_policy || null,
    updatedAt: latestIso(index?.updated_at, stat.mtime),
    sizeBytes: stat.size,
  };
}

function oversizedTranscriptMessage(summary, maxBytes) {
  return [{
    role: 'assistant',
    content: [
      '**Codex CLI transcript is too large to hydrate automatically.**',
      '',
      `File: ${summary.filePath}`,
      `Size: ${formatBytes(summary.sizeBytes || 0)}`,
      `Hydration cap: ${formatBytes(maxBytes)}`,
      '',
      'The session is listed and can still be resumed. Raise `CODEX_CLI_HYDRATE_MAX_MB` if this archive needs to be fully loaded into the web UI.',
    ].join('\n'),
  }];
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

function readJsonlLineAtOffset(fd, statSize, offset, maxLineBytes = 1024 * 1024) {
  const radius = Math.max(64 * 1024, maxLineBytes);
  const start = Math.max(0, offset - radius);
  const end = Math.min(statSize, offset + radius);
  const buffer = Buffer.allocUnsafe(Math.max(0, end - start));
  const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
  const view = bytes === buffer.length ? buffer : buffer.subarray(0, bytes);
  const local = offset - start;
  const before = view.lastIndexOf(10, Math.max(0, local - 1));
  const after = view.indexOf(10, Math.max(0, local));
  const lineStart = before >= 0 ? start + before + 1 : start;
  const lineEnd = after >= 0 ? start + after : end;
  const bounded = (before >= 0 || start === 0)
    && (after >= 0 || end === statSize)
    && lineEnd - lineStart <= maxLineBytes;
  if (!bounded) return { line: '', lineStart, lineEnd, tooLarge: true };
  return {
    line: view.subarray(lineStart - start, lineEnd - start).toString('utf8'),
    lineStart,
    lineEnd,
    tooLarge: false,
  };
}

function nativeEntryIdentity(entry, offsets = null) {
  const payload = entry?.payload || {};
  const kind = `${entry?.type || 'entry'}.${payload.type || 'unknown'}`;
  const explicitId = payload.id || payload.item_id || payload.message_id || payload.call_id || '';
  const locator = explicitId
    ? `id:${String(explicitId)}`
    : `offset:${Math.max(0, Number(offsets?.start_offset) || 0)}`;
  return {
    id: `${kind}:${locator}`,
    kind,
  };
}

function applyScannedEntryToState(state, entry, offsets = null) {
  const before = state.messages.length;
  state.messages[CODEX_NATIVE_CONTEXT] = { state, entry, offsets };
  try {
    applyEntryToState(state, entry);
  } finally {
    delete state.messages[CODEX_NATIVE_CONTEXT];
  }
  if (state.messages.length <= before) return;
  const identity = nativeEntryIdentity(entry, offsets);
  for (let index = before; index < state.messages.length; index++) {
    const message = state.messages[index];
    if (!message.native_source_id) {
      message.native_source_id = state.messages.length - before > 1
        ? `${identity.id}:row:${index - before}`
        : identity.id;
    }
    if (!message.native_source_kind) message.native_source_kind = identity.kind;
    if (!message.source_message_id) {
      const basis = `${state.cliSessionId || state.fileCliSessionId || ''}\u0000${message.native_source_id}`;
      message.source_message_id = `codex_cli:${crypto.createHash('sha256').update(basis).digest('hex').substring(0, 32)}`;
    }
    const producerTime = new Date(entry?.timestamp || '').getTime();
    if (Number.isFinite(producerTime) && !message.created_at) message.created_at = new Date(producerTime).toISOString();
    Object.defineProperty(message, '_native_start_offset', {
      configurable: true,
      enumerable: false,
      value: Math.max(0, Number(offsets?.start_offset) || 0),
    });
    Object.defineProperty(message, '_native_end_offset', {
      configurable: true,
      enumerable: false,
      value: Math.max(0, Number(offsets?.end_offset) || 0),
    });
  }
}

function recoverLatestGoalState(filePath, stat) {
  const cached = GOAL_RECOVERY_CACHE.get(filePath);
  if (cached && stat.size === cached.size) return cached.goal;
  const marker = Buffer.from('thread_goal_updated', 'utf8');
  const chunkBytes = 4 * 1024 * 1024;
  // Once an oversized archive has been searched, only inspect bytes appended
  // since that search. Keep a small overlap so a line that was incomplete at
  // the prior stat boundary can become a valid goal event on the next read.
  // A truncated/replaced archive must be searched from the end as new input.
  const searchFloor = cached && stat.size > cached.size
    ? Math.max(0, cached.size - 1024 * 1024)
    : 0;
  let fd = null;
  let searchEnd = stat.size;
  try {
    fd = fs.openSync(filePath, 'r');
    while (searchEnd > searchFloor) {
      const start = Math.max(searchFloor, searchEnd - chunkBytes);
      const buffer = Buffer.allocUnsafe(searchEnd - start);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
      const view = bytes === buffer.length ? buffer : buffer.subarray(0, bytes);
      let local = view.lastIndexOf(marker);
      while (local >= 0) {
        const absolute = start + local;
        const candidate = readJsonlLineAtOffset(fd, stat.size, absolute);
        if (!candidate.tooLarge && candidate.line) {
          try {
            const entry = JSON.parse(candidate.line);
            if (entry?.type === 'event_msg' && entry?.payload?.type === 'thread_goal_updated') {
              const goal = normalizeThreadGoal(entry.payload, timestampMs(entry), {
                sessionKey: sessionIdFromFilePath(filePath) || fallbackSessionIdFromPath(filePath),
                sourceCursor: {
                  kind: 'codex_cli_jsonl',
                  start_offset: candidate.lineStart,
                  end_offset: candidate.lineEnd,
                },
              });
              setBoundedMap(GOAL_RECOVERY_CACHE, filePath, { size: stat.size, goal }, 128);
              return goal;
            }
          } catch {}
        }
        local = view.lastIndexOf(marker, local - 1);
      }
      if (start === searchFloor) break;
      searchEnd = start + marker.length - 1;
    }
  } catch {
    // Tail hydration remains usable if an archive is concurrently rotating.
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  const goal = cached && stat.size > cached.size ? cached.goal : null;
  setBoundedMap(GOAL_RECOVERY_CACHE, filePath, { size: stat.size, goal }, 128);
  return goal;
}

function parseCodexJsonlTail(filePath, tailBytes = DEFAULT_HYDRATE_TAIL_BYTES) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const boundedTailBytes = Math.max(1024 * 1024, Number(tailBytes) || DEFAULT_HYDRATE_TAIL_BYTES);
  const prior = TAIL_SUMMARY_CACHE.get(filePath);
  const canTail = !!prior
    && prior.tailBytes === boundedTailBytes
    && stat.size >= prior.offset
    && stat.size >= prior.size
    && prior.anchor === fileCursorAnchor(filePath, prior.offset)
    && !(stat.size === prior.size && stat.mtimeMs !== prior.mtimeMs);
  let state;
  let startOffset;
  let scanStartOffset;
  if (canTail) {
    state = prior.state;
    startOffset = prior.startOffset;
    scanStartOffset = prior.offset;
  } else {
    const meta = readSessionMeta(filePath);
    const configObservation = readLatestNativeConfigObservation(filePath, boundedTailBytes);
    state = createParseState(filePath);
    state.meta = { ...meta };
    applyMetadataSessionId(state, meta);
    state.model_id = configObservation.model_id;
    state.effort = configObservation.effort;
    state.model_observation = configObservation.model_observation;
    state.effort_observation = configObservation.effort_observation;
    if (meta.sandbox_mode) state.permission_mode = meta.sandbox_mode;
    if (meta.approval_policy) state.approval_policy = meta.approval_policy;
    if (meta.thread_name) state.threadName = meta.thread_name;
    const wantedStart = Math.max(0, stat.size - boundedTailBytes);
    startOffset = scanStartAlignedToLine(filePath, wantedStart);
    scanStartOffset = startOffset;
  }
  const scan = scanJsonlEntries(filePath, (entry, offsets) => applyScannedEntryToState(state, entry, offsets), {
    startOffset: scanStartOffset,
    processFinalLine: true,
  });
  setBoundedMap(TAIL_SUMMARY_CACHE, filePath, {
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
    startOffset,
    sourceCursor: {
      mode: canTail ? (stat.size > prior.size ? 'append' : 'unchanged') : (prior ? 'recovery' : 'baseline_tail'),
      start_offset: scanStartOffset,
      end_offset: scan.offset,
      file_size: stat.size,
      bytes_read: Math.max(0, stat.size - scanStartOffset),
      events_read: scan.emitted,
      partial: startOffset > 0,
    },
  };
}

function createChunkParseState(filePath) {
  const meta = readSessionMeta(filePath);
  const configObservation = readLatestNativeConfigObservation(filePath);
  const state = createParseState(filePath);
  state.meta = { ...meta };
  applyMetadataSessionId(state, meta);
  state.model_id = configObservation.model_id;
  state.effort = configObservation.effort;
  state.model_observation = configObservation.model_observation;
  state.effort_observation = configObservation.effort_observation;
  if (meta.sandbox_mode) state.permission_mode = meta.sandbox_mode;
  if (meta.approval_policy) state.approval_policy = meta.approval_policy;
  if (meta.thread_name) state.threadName = meta.thread_name;
  return state;
}

function parseCodexJsonlChunk(filePath, {
  beforeOffset = null,
  chunkBytes = DEFAULT_HYDRATE_TAIL_BYTES,
  minimumMessages = 0,
  maxChunkBytes = 16 * 1024 * 1024,
} = {}) {
  const stat = safeStat(filePath);
  if (!stat) return null;
  const rawBefore = Number(beforeOffset);
  const endOffset = Number.isFinite(rawBefore) && rawBefore > 0
    ? Math.max(0, Math.min(stat.size, rawBefore))
    : stat.size;
  const targetMessages = Math.max(0, Math.min(1000, Math.floor(Number(minimumMessages) || 0)));
  const maximumBytes = Math.max(
    256 * 1024,
    Math.min(16 * 1024 * 1024, Number(maxChunkBytes) || 16 * 1024 * 1024),
  );
  let bytes = Math.max(
    256 * 1024,
    Math.min(maximumBytes, Number(chunkBytes) || DEFAULT_HYDRATE_TAIL_BYTES),
  );
  let startOffset = endOffset;
  let state = null;
  let scan = null;
  while (true) {
    const wantedStart = Math.max(0, endOffset - bytes);
    startOffset = scanStartAlignedToLine(filePath, wantedStart);
    state = createChunkParseState(filePath);
    scan = scanJsonlEntries(filePath, (entry, offsets) => applyScannedEntryToState(state, entry, offsets), {
      startOffset,
      endOffset,
      processFinalLine: endOffset >= stat.size,
    });
    if (targetMessages <= 0 || state.messages.length >= targetMessages || startOffset <= 0 || bytes >= maximumBytes) break;
    bytes = Math.min(maximumBytes, bytes * 2);
  }
  return {
    state,
    stat,
    startOffset,
    endOffset,
    nextBeforeOffset: startOffset > 0 ? startOffset : null,
    messageStartOffsets: state.messages.map(message => Math.max(0, Number(message._native_start_offset) || 0)),
    bytesRead: Math.max(0, endOffset - startOffset),
    eventsRead: scan?.emitted || 0,
    requestedMinimumMessages: targetMessages,
  };
}

function tailSessionSummary(filePath, stat, maxHydrateBytes, tailBytes, hydrateSkippedReason) {
  const summary = readLightweightSessionSummary(filePath, stat);
  const tail = parseCodexJsonlTail(filePath, tailBytes);
  const fallbackMessages = oversizedTranscriptMessage(summary, maxHydrateBytes);
  const messages = tail?.state?.messages?.length ? tail.state.messages : fallbackMessages;
  const tailHydrated = messages !== fallbackMessages;
  const tailState = tail?.state || null;
  if (tailState) {
    if (tailState.activeGoal) {
      setBoundedMap(GOAL_RECOVERY_CACHE, filePath, { size: stat.size, goal: tailState.activeGoal }, 128);
    } else {
      tailState.activeGoal = recoverLatestGoalState(filePath, stat);
    }
  }
  return {
    ...summary,
    ...(tailState?.model_id ? { model_id: tailState.model_id } : {}),
    ...(tailState?.effort ? { effort: tailState.effort } : {}),
    ...(tailState?.model_observation ? { model_observation: tailState.model_observation } : {}),
    ...(tailState?.effort_observation ? { effort_observation: tailState.effort_observation } : {}),
    ...(tailState?.permission_mode ? { permission_mode: tailState.permission_mode } : {}),
    ...(tailState?.approval_policy ? { approval_policy: tailState.approval_policy } : {}),
    ...(tailState?.tokenUsage ? { token_usage: tailState.tokenUsage } : {}),
    ...(tailState?.rateLimits ? { rate_limits: tailState.rateLimits } : {}),
    ...(tailState?.percentUsed != null ? { percent_used: tailState.percentUsed } : {}),
    ...(tailState ? {
      rate_limit_active: tailState.rateLimitActive === true,
      rate_limited_until: tailState.rateLimitActive ? tailState.rateLimitedUntil || 'unknown' : null,
    } : {}),
    ...(tailState?.threadName ? { title: tailState.threadName.replace(/\s+/g, ' ').trim().substring(0, 80) } : {}),
    messages,
    messageCount: messages.length,
    messagesHydrated: tailHydrated,
    messagesPartial: true,
    hydrateSkippedReason: tailHydrated ? hydrateSkippedReason : 'file_too_large',
    activity: tailState ? buildCodexCliActivity(tailState) : null,
    sourceCursor: tail?.sourceCursor || null,
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
  const detailed = parseCodexJsonlDetailed(filePath);
  if (!detailed) return null;
  const { state } = detailed;
  const index = readSessionIndex().get(state.cliSessionId) || null;
  const meta = state.meta || {};
  const firstUser = state.messages.find(m => m.role === 'user');
  const titleSource = index?.thread_name || state.threadName || state.firstUserText || firstUser?.content || '';
  const title = titleSource.replace(/\s+/g, ' ').trim().substring(0, 80) || 'Codex CLI session';
  const goalObjective = state.activeGoal?.objective || '';
  const workspace = resolveCodexWorkspace(meta.cwd || null, state.firstUserText, firstUser?.content, goalObjective);
  const workspacePath = workspace.workspacePath || null;
  const summary = {
    cliSessionId: state.cliSessionId,
    filePath,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) : workspace.workspaceName,
    title,
    messages: state.messages,
    messageCount: state.messages.length,
    messagesHydrated: true,
    model_id: state.model_observation ? state.model_id : 'unknown',
    effort: state.effort_observation ? state.effort : 'unknown',
    model_observation: state.model_observation,
    effort_observation: state.effort_observation,
    permission_mode: state.permission_mode || 'workspace-write',
    approval_policy: state.approval_policy || null,
    token_usage: state.tokenUsage || null,
    rate_limits: state.rateLimits || null,
    percent_used: state.percentUsed,
    rate_limit_active: state.rateLimitActive,
    rate_limited_until: state.rateLimitedUntil,
    updatedAt: latestIso(index?.updated_at, stat.mtime),
    sizeBytes: stat.size,
    activity: buildCodexCliActivity(state),
    sourceCursor: detailed.sourceCursor || null,
  };
  return summary;
}

function discoverSessions(limit = 0, options = {}) {
  const root = sessionsDir();
  if (!fs.existsSync(root)) return [];
  return walkJsonlFiles(root, limit)
    .map(item => readSessionSummary(item.filePath, options))
    .filter(Boolean);
}

function recentActiveSessionSummaries({
  limit = 4,
  maxAgeMs = 30 * 60 * 1000,
  maxFiles = 80,
  summaryOptions = {},
} = {}) {
  const root = sessionsDir();
  if (!fs.existsSync(root)) return [];
  const now = Date.now();
  const ageMs = Math.max(0, Number(maxAgeMs) || 0);
  const seen = new Set();
  const out = [];
  for (const item of walkJsonlFiles(root, maxFiles)) {
    if (ageMs > 0 && now - item.stat.mtimeMs > ageMs) continue;
    const summary = readSessionSummary(item.filePath, summaryOptions);
    if (!summary?.cliSessionId || seen.has(summary.cliSessionId)) continue;
    seen.add(summary.cliSessionId);
    out.push(summary);
    if (Number.isFinite(limit) && limit > 0 && out.length >= limit) break;
  }
  return out;
}

function findSessionByCliId(cliSessionId, options = {}) {
  if (!cliSessionId) return null;
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  const items = walkJsonlFiles(root, 0);
  const exact = items.find(item => sessionIdFromFilePath(item.filePath) === cliSessionId);
  if (exact) return readSessionSummary(exact.filePath, options);
  for (const item of items) {
    const summary = readSessionSummary(item.filePath, options);
    if (summary?.cliSessionId === cliSessionId) return summary;
  }
  return null;
}

function questionIdentity(question, canonical = false) {
  const options = canonical
    ? (Array.isArray(question?.choices) ? question.choices : []).filter(choice => choice?.is_other !== true)
    : (Array.isArray(question?.options) ? question.options : []);
  return JSON.stringify({
    id: String((canonical ? question?.question_id : question?.id) || ''),
    header: String(question?.header || ''),
    question: String((canonical ? question?.message : question?.question) || ''),
    options: options.map(option => [String(option?.label || ''), String(option?.description || '')]),
  });
}

function readCodexRequestUserInputResolution(cliSessionId, {
  turnId = '',
  questions = [],
  deadlineMs = null,
  rootDir = sessionsDir(),
  maxTailBytes = 4 * 1024 * 1024,
} = {}) {
  if (!cliSessionId || !turnId || !Array.isArray(questions) || questions.length < 1) return null;
  if (!fs.existsSync(rootDir)) return null;
  const item = walkJsonlFiles(rootDir, 0)
    .find(candidate => sessionIdFromFilePath(candidate.filePath) === cliSessionId);
  if (!item?.filePath || !item.stat?.size) return null;
  const bytes = Math.max(64 * 1024, Math.min(16 * 1024 * 1024, Number(maxTailBytes) || 0));
  const start = Math.max(0, item.stat.size - bytes);
  let fd = null;
  let content = '';
  try {
    fd = fs.openSync(item.filePath, 'r');
    const buffer = Buffer.allocUnsafe(item.stat.size - start);
    const read = fs.readSync(fd, buffer, 0, buffer.length, start);
    content = buffer.subarray(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
  if (start > 0) content = content.substring(Math.max(0, content.indexOf('\n') + 1));
  const records = content.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  let turnStart = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === 'event_msg' && record.payload?.type === 'task_started'
        && String(record.payload?.turn_id || '') === String(turnId)) {
      turnStart = index;
    }
  }
  if (turnStart < 0) return null;
  const expectedQuestions = questions.map(question => questionIdentity(question, true));
  let call = null;
  let callIndex = -1;
  for (let index = turnStart + 1; index < records.length; index += 1) {
    const itemPayload = records[index]?.type === 'response_item' ? records[index].payload : null;
    if (itemPayload?.type !== 'function_call' || itemPayload?.name !== 'request_user_input') continue;
    let args = null;
    try { args = JSON.parse(itemPayload.arguments); } catch { continue; }
    const actualQuestions = Array.isArray(args?.questions)
      ? args.questions.map(question => questionIdentity(question, false)) : [];
    if (JSON.stringify(actualQuestions) !== JSON.stringify(expectedQuestions)) continue;
    call = { payload: itemPayload, args };
    callIndex = index;
  }
  if (!call?.payload?.call_id || callIndex < 0) return null;
  const outputRecord = records.slice(callIndex + 1).find(record =>
    record.type === 'response_item'
      && record.payload?.type === 'function_call_output'
      && record.payload?.call_id === call.payload.call_id);
  if (!outputRecord) return null;
  let output = null;
  try { output = JSON.parse(outputRecord.payload.output); } catch { return null; }
  if (!output?.answers || typeof output.answers !== 'object' || Array.isArray(output.answers)) return null;
  const answerCount = Object.values(output.answers).reduce((count, answer) =>
    count + (Array.isArray(answer?.answers) ? answer.answers.length : 0), 0);
  const resolvedAtMs = Date.parse(outputRecord.timestamp || '');
  if (!Number.isFinite(resolvedAtMs)) return null;
  const exactDeadlineMs = Number(deadlineMs);
  const deadlineDeltaMs = Number.isFinite(exactDeadlineMs) ? resolvedAtMs - exactDeadlineMs : null;
  let lifecycle = null;
  if (answerCount > 0) lifecycle = 'answered';
  else if (Number.isFinite(deadlineDeltaMs) && call.args.autoResolutionMs != null
      && deadlineDeltaMs >= -2000 && deadlineDeltaMs <= 5000) lifecycle = 'auto_resolved';
  else if (Number.isFinite(deadlineDeltaMs) && deadlineDeltaMs < -2000) lifecycle = 'cancelled';
  if (!lifecycle) return null;
  return {
    lifecycle,
    native_acknowledged: true,
    resolved_at: new Date(resolvedAtMs).toISOString(),
    deadline_delta_ms: deadlineDeltaMs,
    answer_count: answerCount,
    call_id_hash: crypto.createHash('sha256').update(String(call.payload.call_id)).digest('hex').slice(0, 16),
  };
}

function normalizedUserAnchor(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findRecentSessionByUserAnchor(userContent, options = {}) {
  const wanted = normalizedUserAnchor(userContent);
  if (!wanted) return null;
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  const sinceMs = Math.max(0, Number(options.sinceMs || 0));
  const maxFiles = Math.max(1, Math.min(100, Number(options.maxFiles || 40)));
  const items = walkJsonlFiles(root, 0)
    // A provisional Desktop key can only belong to a newly created archive.
    // Old operator sessions may still have a current mtime because background
    // agents are appending to them, so creation time is the bounded identity
    // window here; using mtime would hydrate unrelated multi-GB histories.
    .filter(item => !sinceMs || Number(item.stat.birthtimeMs || 0) >= sinceMs)
    .sort((a, b) => Number(b.stat.birthtimeMs || 0) - Number(a.stat.birthtimeMs || 0))
    .slice(0, maxFiles);
  for (const item of items) {
    const candidate = readSessionCandidate(item.filePath, item.stat);
    if (!candidate?.hasUser) continue;
    const candidatePrefix = normalizedUserAnchor(candidate.title);
    if (!candidatePrefix || !wanted.startsWith(candidatePrefix)) continue;
    const summary = readSessionSummary(item.filePath, options.summaryOptions || {});
    const firstUser = summary?.messages?.find(message => message?.role === 'user');
    if (normalizedUserAnchor(firstUser?.content) === wanted) return summary;
  }
  return null;
}

function findRecentSessionByUserAnchors(userContents, options = {}) {
  const wanted = Array.from(new Set((Array.isArray(userContents) ? userContents : [])
    .map(normalizedUserAnchor)
    .filter(Boolean)));
  // A non-first user row is not a sufficient provisional-thread identity on
  // its own. Require multiple exact anchors and refuse ambiguous archives.
  if (wanted.length < 2) return null;
  const root = sessionsDir();
  if (!fs.existsSync(root)) return null;
  const sinceMs = Math.max(0, Number(options.sinceMs || 0));
  const maxFiles = Math.max(1, Math.min(100, Number(options.maxFiles || 40)));
  const items = walkJsonlFiles(root, 0)
    .filter(item => !sinceMs || Number(item.stat.birthtimeMs || 0) >= sinceMs)
    .sort((a, b) => Number(b.stat.birthtimeMs || 0) - Number(a.stat.birthtimeMs || 0))
    .slice(0, maxFiles);
  let match = null;
  for (const item of items) {
    const summary = readSessionSummary(item.filePath, options.summaryOptions || {});
    if (!summary?.hasUser && !Array.isArray(summary?.messages)) continue;
    const observed = new Set((summary.messages || [])
      .filter(message => message?.role === 'user')
      .map(message => normalizedUserAnchor(message.content))
      .filter(Boolean));
    if (!wanted.every(anchor => observed.has(anchor))) continue;
    if (match) return null;
    match = summary;
  }
  return match;
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

function findLatestSessionForTitle({ workspacePath, workspaceName, title, sinceMs = 0, maxFiles = 40, summaryOptions = {} } = {}) {
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
  return bestScore >= 2 && best ? readSessionSummary(best.filePath, summaryOptions) : null;
}

function contentFingerprint(content) {
  const text = String(content || '');
  return {
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    utf8_bytes: Buffer.byteLength(text, 'utf8'),
    characters: text.length,
  };
}

function statFileIdentity(filePath, stat = safeStat(filePath)) {
  if (!stat) return null;
  return {
    path: path.resolve(filePath),
    dev: Number(stat.dev) || 0,
    ino: Number(stat.ino) || 0,
    birthtime_ms: Number(stat.birthtimeMs) || 0,
  };
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  if (left.dev && left.ino && right.dev && right.ino) return left.dev === right.dev && left.ino === right.ino;
  return String(left.path || '').toLowerCase() === String(right.path || '').toLowerCase()
    && Number(left.birthtime_ms || 0) === Number(right.birthtime_ms || 0);
}

function captureCodexReceiptBaseline({ filePath = null, cliSessionId = null, workspacePath = null, content, clientMessageId = null, processEpoch = null } = {}) {
  const stat = filePath ? safeStat(filePath) : null;
  const fingerprint = contentFingerprint(content);
  const capturedAt = new Date().toISOString();
  return {
    version: 1,
    cli_session_id: cliSessionId || null,
    workspace_path: workspacePath || null,
    client_message_id: clientMessageId || null,
    expected_content_sha256: fingerprint.sha256,
    expected_content_utf8_bytes: fingerprint.utf8_bytes,
    expected_content_characters: fingerprint.characters,
    captured_at: capturedAt,
    captured_at_ms: Date.parse(capturedAt),
    process_epoch: processEpoch || crypto.randomUUID(),
    file_path: stat ? path.resolve(filePath) : null,
    file_identity: stat ? statFileIdentity(filePath, stat) : null,
    file_size: stat ? stat.size : 0,
    file_anchor: stat ? fileCursorAnchor(filePath, stat.size) : '',
  };
}

function receiptUserText(entry) {
  const payload = entry?.payload || {};
  if (entry?.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
    return { text: responseMessageText(payload), source: 'response_item.message' };
  }
  if (entry?.type === 'event_msg' && payload.type === 'user_message') {
    return { text: payload.message || payload.text || '', source: 'event_msg.user_message' };
  }
  return null;
}

function isCodexAgentStartEntry(entry) {
  const payload = entry?.payload || {};
  if (entry?.type === 'response_item') {
    if (payload.type === 'message') return payload.role === 'assistant';
    return [
      'reasoning', 'function_call', 'local_shell_call', 'custom_tool_call',
      'web_search_call', 'tool_search_call', 'mcp_tool_call', 'computer_initialize_state',
    ].includes(payload.type);
  }
  if (entry?.type !== 'event_msg') return false;
  return [
    'agent_reasoning', 'agent_message', 'exec_command_begin', 'patch_apply_begin',
    'mcp_tool_call_begin', 'web_search_begin', 'view_image_tool_call',
  ].includes(payload.type);
}

function receiptCandidateFiles(baseline) {
  const candidates = [];
  const seen = new Set();
  const add = filePath => {
    if (!filePath) return;
    const resolved = path.resolve(filePath);
    const key = resolved.toLowerCase();
    if (seen.has(key) || !safeStat(resolved)) return;
    seen.add(key);
    candidates.push(resolved);
  };
  add(baseline?.file_path);
  if (baseline?.cli_session_id) {
    const root = sessionsDir();
    if (fs.existsSync(root)) {
      const exact = walkJsonlFiles(root, 0).find(item => sessionIdFromFilePath(item.filePath) === baseline.cli_session_id);
      add(exact?.filePath);
    }
  }
  if (candidates.length === 0) {
    const root = sessionsDir();
    if (fs.existsSync(root)) {
      const floor = Math.max(0, Number(baseline?.captured_at_ms || 0) - 2000);
      for (const item of walkJsonlFiles(root, 16)) {
        if (Number(item.stat.mtimeMs || 0) >= floor || Number(item.stat.birthtimeMs || 0) >= floor) add(item.filePath);
      }
    }
  }
  return candidates;
}

function inspectCodexReceipt(baseline) {
  if (!baseline?.expected_content_sha256) {
    return { ok: false, code: 'receipt_baseline_invalid', detail: 'Missing expected content fingerprint' };
  }
  const candidates = receiptCandidateFiles(baseline);
  if (candidates.length === 0) return { ok: false, pending: true, code: 'native_transcript_not_found' };
  const matches = [];
  let malformedLines = 0;
  let wrongSessionObserved = false;
  for (const filePath of candidates) {
    const stat = safeStat(filePath);
    if (!stat) continue;
    const identity = statFileIdentity(filePath, stat);
    const sameFile = sameFileIdentity(identity, baseline.file_identity);
    const anchored = sameFile
      && stat.size >= Number(baseline.file_size || 0)
      && baseline.file_anchor === fileCursorAnchor(filePath, Number(baseline.file_size || 0));
    const fileSessionId = sessionIdFromFilePath(filePath) || null;
    if (baseline.cli_session_id && fileSessionId && fileSessionId !== baseline.cli_session_id) {
      wrongSessionObserved = true;
      continue;
    }
    const startOffset = anchored ? Number(baseline.file_size || 0) : 0;
    const earliestMs = anchored ? 0 : Math.max(0, Number(baseline.captured_at_ms || 0) - 2000);
    const parsed = [];
    const scan = scanJsonlLines(filePath, (line, offsets) => {
      try {
        const entry = JSON.parse(line);
        parsed.push({ entry, offsets });
      } catch {
        malformedLines++;
      }
    }, { startOffset, processFinalLine: false });
    for (let index = 0; index < parsed.length; index++) {
      const { entry, offsets } = parsed[index];
      const eventMs = timestampMs(entry);
      if (earliestMs && eventMs && eventMs < earliestMs) continue;
      const user = receiptUserText(entry);
      if (!user) continue;
      const observed = contentFingerprint(user.text);
      if (observed.sha256 !== baseline.expected_content_sha256
          || observed.utf8_bytes !== Number(baseline.expected_content_utf8_bytes)) continue;
      const later = parsed.slice(index + 1).find(candidate => (
        Number(candidate.offsets?.start_offset || 0) >= Number(offsets?.end_offset || 0)
        && isCodexAgentStartEntry(candidate.entry)
      ));
      matches.push({
        filePath,
        identity,
        fileSessionId,
        source: user.source,
        entry,
        offsets,
        later,
        scan,
        rotated: !anchored && !!baseline.file_identity,
      });
    }
  }
  const canonical = matches.filter(match => match.source === 'response_item.message');
  const usable = canonical.length > 0 ? canonical : matches;
  if (usable.length === 0) {
    return {
      ok: false,
      pending: true,
      code: wrongSessionObserved ? 'native_receipt_wrong_session' : (malformedLines ? 'native_receipt_malformed_tail' : 'native_user_turn_not_observed'),
      malformed_lines: malformedLines,
    };
  }
  const unique = new Map();
  for (const match of usable) {
    const key = `${match.filePath.toLowerCase()}\u0000${match.offsets.start_offset}\u0000${match.offsets.end_offset}`;
    unique.set(key, match);
  }
  if (unique.size !== 1) {
    return { ok: false, code: 'native_receipt_ambiguous', detail: `${unique.size} exact post-baseline native user turns matched` };
  }
  const match = Array.from(unique.values())[0];
  const receipt = {
    session_id: baseline.cli_session_id || match.fileSessionId || null,
    client_message_id: baseline.client_message_id || null,
    content_sha256: baseline.expected_content_sha256,
    content_utf8_bytes: baseline.expected_content_utf8_bytes,
    content_characters: baseline.expected_content_characters,
    process_epoch: baseline.process_epoch || null,
    source: match.source,
    post_baseline_occurrence: 1,
    native_event_at: match.entry?.timestamp || null,
    observed_at: new Date().toISOString(),
    file_identity: match.identity ? {
      dev: match.identity.dev,
      ino: match.identity.ino,
      birthtime_ms: match.identity.birthtime_ms,
    } : null,
    source_cursor: {
      start_offset: match.offsets.start_offset,
      end_offset: match.offsets.end_offset,
      file_size: match.scan?.stat?.size || null,
      rotated: match.rotated,
    },
  };
  const agentStarted = match.later ? {
    source: nativeConfigSource(match.later.entry),
    native_event_at: match.later.entry?.timestamp || null,
    observed_at: new Date().toISOString(),
    source_cursor: {
      start_offset: match.later.offsets.start_offset,
      end_offset: match.later.offsets.end_offset,
    },
  } : null;
  return { ok: true, receipt, agent_started: agentStarted };
}

function waitForCodexReceipt(baseline, {
  timeoutMs = 30000,
  pollMs = 75,
  childState = null,
} = {}) {
  const started = Date.now();
  return new Promise(resolve => {
    let exitObservedAt = 0;
    const poll = () => {
      const inspected = inspectCodexReceipt(baseline);
      if (inspected.ok || inspected.code === 'native_receipt_ambiguous') {
        resolve(inspected);
        return;
      }
      const child = typeof childState === 'function' ? childState() : null;
      if (child?.exited) {
        if (!exitObservedAt) exitObservedAt = Date.now();
        if (child.code !== 0 || child.error) {
          resolve({
            ok: false,
            code: classifyCodexSendFailure(child.code, child.stderr, child.error),
            detail: child.error?.message || String(child.stderr || '').trim() || `Codex CLI exited with code ${child.code}`,
          });
          return;
        }
        if (Date.now() - exitObservedAt >= 1000) {
          resolve({ ok: false, code: inspected.code || 'native_user_turn_not_observed', detail: 'Codex CLI exited 0 without an exact native user-turn append' });
          return;
        }
      }
      if (Date.now() - started >= Math.max(1000, Number(timeoutMs) || 30000)) {
        resolve({ ok: false, code: 'native_receipt_timeout', detail: 'Timed out waiting for the exact native Codex user turn' });
        return;
      }
      setTimeout(poll, Math.max(25, Number(pollMs) || 75));
    };
    poll();
  });
}

function waitForCodexAgentStart(baseline, receipt, { timeoutMs = 120000, pollMs = 100 } = {}) {
  const started = Date.now();
  return new Promise(resolve => {
    const poll = () => {
      const inspected = inspectCodexReceipt(baseline);
      if (inspected.ok && inspected.agent_started) {
        resolve({ ok: true, agent_started: inspected.agent_started, receipt });
        return;
      }
      if (Date.now() - started >= Math.max(1000, Number(timeoutMs) || 120000)) {
        resolve({ ok: false, code: 'agent_start_timeout', detail: 'Native user turn arrived, but no later native Codex agent event was observed' });
        return;
      }
      setTimeout(poll, Math.max(25, Number(pollMs) || 100));
    };
    poll();
  });
}

function classifyCodexSendFailure(code, stderr, error = null) {
  const text = `${error?.message || ''}\n${stderr || ''}`.toLowerCase();
  if (/rate.?limit|usage limit|quota|too many requests|429/.test(text)) return 'codex_usage_or_rate_limited';
  if (/auth|unauthorized|forbidden|login|credential|401|403/.test(text)) return 'codex_auth_failed';
  if (Number(code) !== 0) return 'codex_cli_nonzero_exit';
  return 'codex_cli_launch_failed';
}

function isOllamaModel(model) {
  const raw = String(model || '');
  return /^ollama:/i.test(raw) || /:cloud$/i.test(raw);
}

function normalizeModel(model) {
  const raw = normalizeCodexModelAlias(model, CODEX_CLI_MODELS);
  return raw.replace(/^ollama:/i, '');
}

function buildCodexArgs({ execMode = false, cliSessionId, resume = true, model, effort, permissionMode, json = false, workspacePath, extraArgs = [] } = {}) {
  const args = [];
  const execResume = execMode && resume && cliSessionId;
  if (execMode) {
    args.push('exec');
    if (execResume) args.push('resume');
  } else if (resume && cliSessionId) {
    args.push('resume');
  }
  if (json) args.push('--json');
  if (execMode) args.push('--skip-git-repo-check');
  if (execResume) args.push('--all');
  if (workspacePath && !execResume) args.push('-C', workspacePath);
  const modelId = normalizeModel(model);
  if (modelId && modelId !== 'default' && modelId !== 'unknown') {
    if (isOllamaModel(model)) args.push('--oss', '--local-provider', 'ollama');
    args.push('-m', modelId);
  }
  if (effort && effort !== 'default' && effort !== 'unknown') {
    args.push('-c', `model_reasoning_effort="${effort}"`);
  }
  if (permissionMode && permissionMode !== 'default' && permissionMode !== 'unknown') {
    // `codex exec resume` has a narrower option surface than `codex exec`:
    // 0.144.1 rejects `-s/--sandbox` after the resume subcommand. The
    // underlying config key remains supported, so use it only for exec-resume
    // while keeping the documented flag for new exec/native TUI launches.
    if (execResume) args.push('-c', `sandbox_mode="${permissionMode}"`);
    else args.push('-s', permissionMode);
  }
  if (resume && cliSessionId) args.push(cliSessionId);
  if (Array.isArray(extraArgs) && extraArgs.length > 0) args.push(...extraArgs);
  return args;
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
  if (/\.m?js$/i.test(commandPath)) return { command: process.execPath, argsPrefix: [commandPath] };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
    return { command: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', commandPath] };
  }
  return { command: commandPath, argsPrefix: [] };
}

function resolveCodexCommand() {
  const explicit = existingFile(process.env.CODEX_CLI_PATH);
  if (explicit) return commandForPath(explicit);
  const appData = process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming');
  const npmScript = existingFile(path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  if (npmScript) return commandForPath(npmScript);
  const where = process.platform === 'win32'
    ? spawnSync('where.exe', ['codex'], { encoding: 'utf8' })
    : spawnSync('which', ['codex'], { encoding: 'utf8' });
  const found = where.status === 0
    ? String(where.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean)
    : '';
  if (found) return commandForPath(found);
  return { command: 'codex', argsPrefix: [] };
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
  const resolved = resolveCodexCommand();
  const child = spawn(resolved.command, [...resolved.argsPrefix, ...args], {
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

function stopCodexExecSession(child) {
  const pid = Number(child?.pid ?? child);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, detail: 'No owned Codex CLI process to stop' };
  }
  if (process.platform !== 'win32') {
    try {
      child.kill('SIGTERM');
      return { ok: true, detail: `stopped process ${pid}` };
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

function buildNativeCodexWindowPowerShell({ cwd, launcherPath, elevated = false } = {}) {
  const ps = [
    'Start-Process',
    '-FilePath', quotePowerShellString('cmd.exe'),
    '-WorkingDirectory', quotePowerShellString(cwd || process.cwd()),
    '-ArgumentList', `${quotePowerShellString('/k')}, ${quotePowerShellString(launcherPath)}`,
  ];
  if (elevated) ps.push('-Verb', quotePowerShellString('RunAs'));
  ps.push('-WindowStyle', 'Normal', '-PassThru', '|', 'Select-Object', '-ExpandProperty', 'Id');
  return ps.join(' ');
}

function startNativeCodexWindow({ workspacePath, cliSessionId, resume = true, model, effort, permissionMode, title, elevated = false, launchMode = 'foreground' } = {}) {
  if (normalizeNativeLaunchMode(launchMode) === 'background') {
    return backgroundNativeLaunchResult('codex_cli');
  }
  const cwd = workspacePath || process.cwd();
  if (process.platform !== 'win32') {
    const args = buildCodexArgs({ cliSessionId, resume, model, effort, permissionMode, workspacePath: cwd });
    return spawn('codex', args, { cwd, shell: false, stdio: 'inherit', windowsHide: false });
  }
  const args = buildCodexArgs({ cliSessionId, resume, model, effort, permissionMode, workspacePath: cwd });
  const windowTitle = String(title || 'Codex CLI').replace(/["&<>|]/g, '').slice(0, 80) || 'Codex CLI';
  const launcherPath = path.join(os.tmpdir(), `remote-agent-codex-cli-${cliSessionId || Date.now()}.cmd`);
  const resolved = resolveCodexCommand();
  const commandLine = [resolved.command, ...resolved.argsPrefix, ...args].map(quoteCmdArg).join(' ');
  fs.writeFileSync(launcherPath, [
    '@echo off',
    `title ${windowTitle}`,
    `cd /d ${quoteCmdArg(cwd)}`,
    commandLine,
    '',
  ].join('\r\n'));
  const ps = buildNativeCodexWindowPowerShell({ cwd, launcherPath, elevated });
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    cwd,
    shell: false,
    encoding: 'utf8',
    // Hiding this short-lived launcher causes Windows 11's default-terminal
    // delegation to create an unusable hidden/failed cmd session. Keep the
    // launcher visible long enough for Start-Process to hand off the real TUI.
    windowsHide: false,
  });
  if (result.status !== 0 || result.error) {
    const detail = String(result.stderr || result.error?.message || `PowerShell exited ${result.status}`).trim();
    throw new Error(`Could not open Codex CLI window: ${detail}`);
  }
  const pid = Number(String(result.stdout || '').trim()) || null;
  return { pid, remoteAgentElevated: !!elevated };
}

function watchSessions({ onSummary, onError, debounceMs = 120, summaryOptions = {}, rootDir = sessionsDir() } = {}) {
  const root = rootDir;
  if (!chokidar || !fs.existsSync(root)) return null;
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

module.exports = {
  CODEX_CLI_MODELS,
  CODEX_CLI_EFFORTS,
  CODEX_CLI_CATALOG,
  CODEX_CLI_ACCESS_MODES,
  CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES: DEFAULT_ACTIVE_HYDRATE_MAX_BYTES,
  CODEX_CLI_ACTIVE_HYDRATE_TAIL_BYTES: DEFAULT_ACTIVE_HYDRATE_TAIL_BYTES,
  discoverSessions,
  findSessionByCliId,
  readCodexRequestUserInputResolution,
  findRecentSessionByUserAnchor,
  findRecentSessionByUserAnchors,
  findLatestSessionForWorkspace,
  findLatestSessionForTitle,
  parseCodexJsonl,
  parseCodexJsonlChunk,
  readSessionIndex,
  readCliHistory,
  recentInteractiveSessionIds,
  recentActiveSessionSummaries,
  runningCodexCliProcessCount,
  readCodexModelCatalog,
  readLatestNativeConfigObservation,
  normalizeCodexModelAlias,
  contentFingerprint,
  captureCodexReceiptBaseline,
  inspectCodexReceipt,
  waitForCodexReceipt,
  waitForCodexAgentStart,
  classifyCodexSendFailure,
  readSessionSummary,
  buildCodexArgs,
  resolveCodexCommand,
  startCodexExecSession,
  stopCodexExecSession,
  buildNativeCodexWindowPowerShell,
  startNativeCodexWindow,
  watchSessions,
};
