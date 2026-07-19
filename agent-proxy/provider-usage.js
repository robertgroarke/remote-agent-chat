'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { enrichUsageWindow } = require('./usage-pace');
const { STALE_AFTER_MS: ANTIGRAVITY_QUOTA_STALE_AFTER_MS } = require('./antigravity-quota-cache');
const { readOllamaCloudUsageFromExistingChrome } = require('./ollama-cloud-usage');
const {
  compactProviderUsageSnapshot,
  providerUsageBoundaryAssessment,
  sanitizeProviderUsageSnapshot,
} = require('../relay-server/provider-usage-boundary');

const SCHEMA_VERSION = 4;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const OLLAMA_RECEIPT_SCHEMA_VERSION = 1;
const MAX_OLLAMA_REQUEST_RECEIPTS = 32;
const MAX_OLLAMA_RECEIPT_STATE_BYTES = 256 * 1024;

const PROVIDERS = Object.freeze({
  codex: {
    provider_id: 'openai-codex',
    provider_name: 'OpenAI Codex',
    quota_domain: 'codex-plan',
    dashboard_url: 'https://chatgpt.com/codex/settings/usage',
    agent_types: new Set(['codex', 'codex_cli', 'codex-desktop']),
  },
  claude: {
    provider_id: 'anthropic-claude',
    provider_name: 'Anthropic Claude',
    quota_domain: 'claude-plan',
    dashboard_url: 'https://claude.ai/settings/usage',
    agent_types: new Set(['claude', 'claude_cli', 'claude-desktop']),
  },
  antigravity: {
    provider_id: 'google-antigravity',
    provider_name: 'Google Antigravity',
    quota_domain: 'antigravity-model-quota',
    dashboard_url: null,
    agent_types: new Set(['antigravity', 'antigravity_panel', 'antigravity-v2', 'gemini']),
  },
  cursor: {
    provider_id: 'cursor',
    provider_name: 'Cursor',
    quota_domain: 'cursor-plan',
    dashboard_url: 'https://cursor.com/settings/usage',
    agent_types: new Set(['cursor', 'cursor_cli']),
  },
  ollama: {
    provider_id: 'ollama-local',
    provider_name: 'Ollama',
    quota_domain: 'ollama-cloud-and-local-runtime',
    dashboard_url: 'https://ollama.com/settings/usage',
    agent_types: new Set(['ollama']),
    always_collect: true,
  },
});

class ProviderUsageError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderUsageError';
    this.code = options.code || 'unavailable';
    this.status = options.status || 'unavailable';
    this.retryAfterMs = Math.max(0, Number(options.retryAfterMs) || 0);
  }
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const percent = numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.round(percent * 100) / 100);
}

function safeNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeText(value, maxLength = 160) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function isoTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function humanize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function windowDurationLabel(minutes) {
  const duration = Number(minutes);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (duration === 300) return '5-hour';
  if (duration === 10080) return 'Weekly';
  if (duration === 1440) return 'Daily';
  if (duration % 10080 === 0) return `${duration / 10080}-week`;
  if (duration % 1440 === 0) return `${duration / 1440}-day`;
  if (duration % 60 === 0) return `${duration / 60}-hour`;
  return `${duration}-minute`;
}

function relativeDurationMs(value) {
  const text = safeText(value, 160);
  if (!text) return null;
  let totalMs = 0;
  let matched = false;
  const unitPattern = /(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
  for (const match of text.matchAll(unitPattern)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit.startsWith('w') ? 7 * 24 * 60 * 60 * 1000
      : unit.startsWith('d') ? 24 * 60 * 60 * 1000
        : unit.startsWith('h') ? 60 * 60 * 1000
          : unit.startsWith('m') ? 60 * 1000
            : 1000;
    totalMs += amount * multiplier;
    matched = true;
  }
  if (!matched) {
    const clock = text.match(/\b(\d{1,3}):(\d{2})(?::(\d{2}))?\b/);
    if (clock) {
      totalMs = (Number(clock[1]) * 60 * 60 + Number(clock[2]) * 60 + Number(clock[3] || 0)) * 1000;
      matched = true;
    }
  }
  return matched && Number.isFinite(totalMs) && totalMs > 0 ? totalMs : null;
}

function normalizedWindow({
  id, label, scope = null, modelScope = null, usedPercent, remainingPercent = null,
  durationMinutes = null, startsAt = null, resetsAt = null, resetDescription = null,
  windowKind = null, source = null, provenance = null, status = 'available', error = null,
}) {
  const used = clampPercent(usedPercent);
  const normalizedStatus = status === 'unavailable' ? 'unavailable' : 'available';
  if (used == null && normalizedStatus !== 'unavailable') return null;
  const exactRemaining = safeNumber(remainingPercent);
  const normalizedModelScope = modelScope && typeof modelScope === 'object'
    ? {
      id: safeText(modelScope.id || modelScope.model_id, 120),
      label: safeText(modelScope.label || modelScope.display_name || modelScope.name, 120),
    }
    : (modelScope ? { id: safeText(modelScope, 120), label: safeText(modelScope, 120) } : null);
  return {
    id: safeText(id, 96) || `window-${crypto.randomBytes(3).toString('hex')}`,
    label: safeText(label, 96) || 'Usage',
    scope: safeText(scope, 96),
    used_percent: used,
    remaining_percent: used == null ? null : (exactRemaining == null
      ? Math.round((100 - used) * 100) / 100
      : Math.round(exactRemaining * 100) / 100),
    duration_minutes: durationMinutes != null && Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : null,
    starts_at: isoTimestamp(startsAt),
    resets_at: isoTimestamp(resetsAt),
    reset_description: safeText(resetDescription, 160),
    window_kind: ['rolling', 'calendar'].includes(windowKind) ? windowKind : null,
    model_scope: normalizedModelScope?.id || normalizedModelScope?.label ? normalizedModelScope : null,
    source: safeText(source, 60),
    provenance: safeText(provenance, 120),
    status: normalizedStatus,
    error: error && typeof error === 'object' ? {
      code: safeText(error.code, 60),
      message: safeText(error.message, 180),
    } : null,
  };
}

function planLabel(provider, raw) {
  const value = safeText(raw, 80);
  if (!value) return null;
  const lower = value.toLowerCase();
  if (provider === 'codex') {
    const labels = {
      free: 'ChatGPT Free', go: 'ChatGPT Go', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro',
      prolite: 'ChatGPT Pro Lite', team: 'ChatGPT Team', business: 'ChatGPT Business',
      self_serve_business_usage_based: 'ChatGPT Business', enterprise: 'ChatGPT Enterprise',
      enterprise_cbp_usage_based: 'ChatGPT Enterprise', edu: 'ChatGPT Education',
    };
    return labels[lower] || `ChatGPT ${humanize(value)}`;
  }
  if (provider === 'claude') {
    return lower.startsWith('claude ') ? value : `Claude ${humanize(value)}`;
  }
  if (provider === 'cursor') {
    return lower.startsWith('cursor ') ? value : `Cursor ${humanize(value)}`;
  }
  return value;
}

function maskEmail(value) {
  const email = safeText(value, 240);
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`.slice(0, 120);
}

function retryAfterMs(headers) {
  const raw = headers?.['retry-after'];
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function statusForHttp(statusCode) {
  if (statusCode === 401 || statusCode === 403) return 'auth_required';
  if (statusCode === 429) return 'rate_limited';
  return 'unavailable';
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const allowedHosts = new Set(['api.anthropic.com', 'api2.cursor.sh', 'chatgpt.com']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      reject(new ProviderUsageError('Provider endpoint is not allow-listed.', { code: 'endpoint_rejected' }));
      return;
    }
    const body = options.body == null
      ? null
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    const request = https.request(parsed, {
      method: options.method || (body == null ? 'GET' : 'POST'),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Remote-Agent-Chat/1.0',
        ...(body == null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }),
        ...(options.headers || {}),
      },
      timeout: Math.max(1000, Number(options.timeoutMs) || 10000),
    }, response => {
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on('end', () => {
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new ProviderUsageError('Provider response exceeded the safe size limit.', { code: 'response_too_large' }));
          return;
        }
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new ProviderUsageError(`Provider returned HTTP ${statusCode}.`, {
            code: `http_${statusCode || 'error'}`,
            status: statusForHttp(statusCode),
            retryAfterMs: retryAfterMs(response.headers),
          }));
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new ProviderUsageError('Provider returned malformed JSON.', { code: 'malformed_payload' }));
        }
      });
    });
    request.on('timeout', () => request.destroy(new ProviderUsageError('Provider request timed out.', { code: 'timeout' })));
    request.on('error', error => {
      reject(error instanceof ProviderUsageError
        ? error
        : new ProviderUsageError('Provider request failed.', { code: safeText(error?.code, 40) || 'network_error' }));
    });
    if (body != null) request.write(body);
    request.end();
  });
}

function localFingerprintKey(customKey = null) {
  if (customKey) return Buffer.from(String(customKey));
  const envKey = process.env.RAC_PROVIDER_USAGE_FINGERPRINT_KEY;
  if (envKey) return Buffer.from(envKey);
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.remote-agent-chat');
  const directory = path.join(base, 'RemoteAgentChat');
  const keyPath = path.join(directory, 'provider-usage-fingerprint.key');
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(keyPath)) {
      fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    if (key) return Buffer.from(key);
  } catch {}
  return crypto.createHash('sha256').update(`${os.hostname()}\0${os.homedir()}\0provider-usage`).digest();
}

function accountFingerprint(identity, fingerprintKey) {
  const normalized = safeText(identity, 512)?.toLowerCase() || 'local-default';
  return `acct_${crypto.createHmac('sha256', fingerprintKey).update(normalized).digest('hex').slice(0, 20)}`;
}

function mappedProviderSessions(sessions, provider) {
  const matches = [];
  for (const session of sessions || []) {
    const agentType = safeText(session?.agentType || session?.agent_type, 80);
    if (agentType && provider.agent_types.has(agentType)) matches.push({ session, agentType });
  }
  return {
    session_count: matches.length,
    mapped_harness_types: [...new Set(matches.map(match => match.agentType))].sort(),
  };
}

function sourceAttempt(source, status, extra = {}) {
  return {
    source,
    status,
    captured_at: new Date().toISOString(),
    ...(extra.code ? { code: safeText(extra.code, 60) } : {}),
  };
}

function codexCommand() {
  if (process.env.CODEX_CLI_PATH) return path.resolve(process.env.CODEX_CLI_PATH);
  if (process.platform === 'win32' && process.env.APPDATA) {
    const candidate = path.join(process.env.APPDATA, 'npm', 'codex.cmd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'codex';
}

function requestLoopbackJson(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const configured = safeText(options.baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434', 240);
    let base;
    try { base = new URL(configured.includes('://') ? configured : `http://${configured}`); } catch {
      reject(new ProviderUsageError('Ollama loopback endpoint is invalid.', { code: 'endpoint_rejected' }));
      return;
    }
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (base.protocol !== 'http:' || !loopbackHosts.has(base.hostname)
        || base.username || base.password || base.search || base.hash) {
      reject(new ProviderUsageError('Ollama endpoint must remain loopback-only.', { code: 'endpoint_rejected' }));
      return;
    }
    const target = new URL(pathname, `${base.origin}/`);
    const request = http.request(target, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Remote-Agent-Chat/1.0' },
      timeout: Math.max(250, Number(options.timeoutMs) || 1500),
    }, response => {
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on('end', () => {
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new ProviderUsageError('Ollama response exceeded the safe size limit.', { code: 'response_too_large' }));
          return;
        }
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new ProviderUsageError(`Ollama returned HTTP ${statusCode}.`, { code: `http_${statusCode || 'error'}` }));
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new ProviderUsageError('Ollama returned malformed JSON.', { code: 'malformed_payload' }));
        }
      });
    });
    request.on('timeout', () => request.destroy(new ProviderUsageError('Ollama loopback request timed out.', { code: 'timeout' })));
    request.on('error', error => reject(error instanceof ProviderUsageError
      ? error
      : new ProviderUsageError('Ollama is not running on the loopback endpoint.', {
        code: safeText(error?.code, 40) || 'not_running',
      })));
    request.end();
  });
}

function ollamaReceiptStatePath(options = {}) {
  if (options.receiptPath) return path.resolve(options.receiptPath);
  if (process.env.RAC_OLLAMA_RECEIPT_PATH) return path.resolve(process.env.RAC_OLLAMA_RECEIPT_PATH);
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.remote-agent-chat');
  return path.join(base, 'RemoteAgentChat', 'ollama-request-receipts-v1.json');
}

function ollamaIdentifier(value, maxLength) {
  const normalized = safeText(value, maxLength);
  return normalized && /^[a-z0-9][a-z0-9._:/-]*$/i.test(normalized) ? normalized : null;
}

function nonNegativeMetric(value, { integer = false } = {}) {
  const normalized = safeNumber(value);
  if (normalized == null || normalized < 0 || (integer && !Number.isSafeInteger(normalized))) return null;
  return normalized;
}

function normalizeOllamaTerminalReceipt(response, metadata = {}) {
  if (!response || response.done !== true) {
    throw new ProviderUsageError('Ollama request receipt is not terminal.', { code: 'receipt_not_terminal' });
  }
  const model = ollamaIdentifier(metadata.model || response.model, 160);
  const surface = ollamaIdentifier(metadata.surface, 80);
  const capturedAt = isoTimestamp(metadata.capturedAt || metadata.captured_at || Date.now());
  const promptTokens = nonNegativeMetric(response.prompt_eval_count, { integer: true });
  const responseTokens = nonNegativeMetric(response.eval_count, { integer: true });
  const totalDurationNs = nonNegativeMetric(response.total_duration, { integer: true });
  const loadDurationNs = nonNegativeMetric(response.load_duration, { integer: true });
  const promptEvalDurationNs = nonNegativeMetric(response.prompt_eval_duration, { integer: true });
  const evalDurationNs = nonNegativeMetric(response.eval_duration, { integer: true });
  if (!model || !surface || !capturedAt || [
    promptTokens,
    responseTokens,
    totalDurationNs,
    loadDurationNs,
    promptEvalDurationNs,
    evalDurationNs,
  ].some(value => value == null)) {
    throw new ProviderUsageError('Ollama terminal receipt is missing bounded request metrics.', {
      code: 'receipt_metrics_missing',
    });
  }
  const tokensPerSecond = evalDurationNs > 0
    ? Math.round((responseTokens * 1e9 / evalDurationNs) * 1000) / 1000
    : null;
  const receipt = {
    schema_version: OLLAMA_RECEIPT_SCHEMA_VERSION,
    model,
    surface,
    captured_at: capturedAt,
    prompt_tokens: promptTokens,
    response_tokens: responseTokens,
    tokens_per_second: tokensPerSecond,
    total_duration_ns: totalDurationNs,
    load_duration_ns: loadDurationNs,
    prompt_eval_duration_ns: promptEvalDurationNs,
    eval_duration_ns: evalDurationNs,
  };
  return {
    receipt_id: crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex').slice(0, 24),
    ...receipt,
  };
}

function normalizePersistedOllamaReceipt(value) {
  if (!value || Number(value.schema_version) !== OLLAMA_RECEIPT_SCHEMA_VERSION) return null;
  try {
    const normalized = normalizeOllamaTerminalReceipt({
      done: true,
      model: value.model,
      prompt_eval_count: value.prompt_tokens,
      eval_count: value.response_tokens,
      total_duration: value.total_duration_ns,
      load_duration: value.load_duration_ns,
      prompt_eval_duration: value.prompt_eval_duration_ns,
      eval_duration: value.eval_duration_ns,
    }, {
      model: value.model,
      surface: value.surface,
      captured_at: value.captured_at,
    });
    return value.receipt_id && value.receipt_id !== normalized.receipt_id ? null : normalized;
  } catch {
    return null;
  }
}

function readOllamaRequestReceipts(options = {}) {
  const statePath = ollamaReceiptStatePath(options);
  try {
    const stats = fs.statSync(statePath);
    if (!stats.isFile() || stats.size > MAX_OLLAMA_RECEIPT_STATE_BYTES) return [];
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (Number(parsed?.schema_version) !== OLLAMA_RECEIPT_SCHEMA_VERSION || !Array.isArray(parsed.receipts)) return [];
    const deduped = new Map();
    for (const raw of parsed.receipts.slice(-MAX_OLLAMA_REQUEST_RECEIPTS * 2)) {
      const receipt = normalizePersistedOllamaReceipt(raw);
      if (receipt) deduped.set(receipt.receipt_id, receipt);
    }
    return [...deduped.values()]
      .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at))
      .slice(-MAX_OLLAMA_REQUEST_RECEIPTS);
  } catch {
    return [];
  }
}

function writeOllamaRequestReceipt(response, metadata = {}, options = {}) {
  const receipt = normalizeOllamaTerminalReceipt(response, metadata);
  const statePath = ollamaReceiptStatePath(options);
  const receipts = readOllamaRequestReceipts(options).filter(item => item.receipt_id !== receipt.receipt_id);
  receipts.push(receipt);
  const state = {
    schema_version: OLLAMA_RECEIPT_SCHEMA_VERSION,
    updated_at: receipt.captured_at,
    receipts: receipts.slice(-MAX_OLLAMA_REQUEST_RECEIPTS),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, statePath);
  return receipt;
}

function roundedMoney(value) {
  const numeric = safeNumber(value);
  return numeric == null ? null : Math.round(numeric * 100) / 100;
}

function canonicalMoney(amount, {
  currency = 'USD',
  sourceField = '',
  semantics = '',
  directlyReported = true,
} = {}) {
  const normalizedAmount = roundedMoney(amount);
  if (normalizedAmount == null) return null;
  return {
    amount: normalizedAmount,
    currency: safeText(currency, 12) || 'USD',
    source_field: safeText(sourceField, 120),
    semantics: safeText(semantics, 80),
    directly_reported: directlyReported === true,
  };
}

function moneyFromEnvelope(value, options = {}) {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    return canonicalMoney(value, options);
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const amountMinor = safeNumber(value.amount_minor ?? value.amountMinor);
  if (amountMinor != null) {
    const exponent = Math.max(0, Math.min(6, Math.trunc(safeNumber(value.exponent) ?? 2)));
    return canonicalMoney(amountMinor / (10 ** exponent), {
      ...options,
      currency: value.currency || options.currency,
    });
  }
  return canonicalMoney(value.amount ?? value.value, {
    ...options,
    currency: value.currency || options.currency,
  });
}

function validateProviderDashboardUrl(providerKey, candidate) {
  const expected = PROVIDERS[providerKey]?.dashboard_url || null;
  if (!expected || !candidate) return null;
  let parsed;
  let canonical;
  try {
    parsed = new URL(String(candidate));
    canonical = new URL(expected);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash) return null;
  if (parsed.origin !== canonical.origin || parsed.pathname !== canonical.pathname) return null;
  return expected;
}

function bindCodexAppServerInput(child, finish) {
  const fail = error => finish(new ProviderUsageError('Codex app-server input pipe failed.', {
    code: error?.code === 'EPIPE' ? 'app_server_epipe' : 'app_server_pipe_error',
  }));
  child.stdin.on('error', fail);
  return message => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`, error => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  };
}

function runCodexAppServer(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const executable = codexCommand();
    const onWindows = process.platform === 'win32';
    const npmEntrypoint = onWindows && String(executable).toLowerCase().endsWith('.cmd')
      ? path.join(path.dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      : null;
    const useNpmEntrypoint = npmEntrypoint && fs.existsSync(npmEntrypoint);
    const command = useNpmEntrypoint
      ? process.execPath
      : (onWindows ? (process.env.ComSpec || 'cmd.exe') : executable);
    const args = useNpmEntrypoint
      ? [npmEntrypoint, 'app-server', '--stdio']
      : onWindows
        ? ['/d', '/s', '/c', `""${String(executable).replace(/"/g, '')}" app-server --stdio"`]
        : ['app-server', '--stdio'];
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let settled = false;
    let initialized = false;
    const responses = new Map();
    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new ProviderUsageError('Codex app-server timed out.', { code: 'app_server_timeout' })), timeoutMs);
    const send = bindCodexAppServerInput(child, finish);
    child.on('error', () => finish(new ProviderUsageError('Codex app-server could not start.', { code: 'app_server_unavailable' })));
    child.on('exit', code => {
      if (!settled) finish(new ProviderUsageError(`Codex app-server exited (${code ?? 'unknown'}).`, { code: 'app_server_exit' }));
    });
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id == null) continue;
        responses.set(String(message.id), message);
        if (String(message.id) === '1' && !initialized) {
          initialized = true;
          send({ id: 2, method: 'account/read', params: { refreshToken: false } });
          send({ id: 3, method: 'account/rateLimits/read', params: null });
        }
        if (responses.has('2') && responses.has('3')) {
          const accountResponse = responses.get('2');
          const limitsResponse = responses.get('3');
          if (accountResponse.error || limitsResponse.error) {
            finish(new ProviderUsageError('Codex app-server rejected the account probe.', {
              code: 'app_server_request_failed',
              status: accountResponse.error?.code === -32001 ? 'auth_required' : 'unavailable',
            }));
            return;
          }
          finish(null, { account: accountResponse.result || {}, limits: limitsResponse.result || {} });
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'remote-agent-chat-usage', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function codexWindows(limits) {
  const buckets = limits?.rateLimitsByLimitId && typeof limits.rateLimitsByLimitId === 'object'
    ? Object.entries(limits.rateLimitsByLimitId)
    : [['codex', limits?.rateLimits || {}]];
  const windows = [];
  for (const [bucketId, snapshot] of buckets) {
    const group = safeText(snapshot?.limitName, 80) || humanize(bucketId) || 'Codex';
    for (const [kind, window] of [['primary', snapshot?.primary], ['secondary', snapshot?.secondary]]) {
      if (!window || clampPercent(window.usedPercent ?? window.used_percent) == null) continue;
      const duration = safeNumber(window.windowDurationMins ?? window.limit_window_seconds / 60);
      const durationLabel = windowDurationLabel(duration);
      const isDefault = String(bucketId).toLowerCase() === 'codex' || group.toLowerCase() === 'codex';
      const label = isDefault
        ? (durationLabel || (kind === 'primary' ? 'Primary' : 'Secondary'))
        : [group, durationLabel].filter(Boolean).join(' · ');
      const normalized = normalizedWindow({
        id: `${safeText(bucketId, 60) || 'codex'}-${kind}`,
        label,
        scope: group,
        usedPercent: window.usedPercent ?? window.used_percent,
        remainingPercent: window.remainingPercent ?? window.remaining_percent,
        durationMinutes: duration,
        startsAt: window.startsAt ?? window.start_at,
        resetsAt: window.resetsAt ?? window.reset_at,
        windowKind: 'rolling',
        source: 'app_server',
        provenance: `rateLimitsByLimitId.${bucketId}.${kind}`,
      });
      if (normalized) windows.push(normalized);
    }
  }
  return windows;
}

function normalizeCodexAppServer(result, fingerprintKey) {
  const account = result.account?.account || null;
  if (result.account?.requiresOpenaiAuth && !account) {
    throw new ProviderUsageError('Sign in required.', { code: 'sign_in_required', status: 'auth_required' });
  }
  const rateSnapshot = result.limits?.rateLimits || {};
  const email = account?.email || null;
  const identity = email || account?.type || 'codex-local';
  const credits = rateSnapshot.credits || null;
  const spend = rateSnapshot.individualLimit || null;
  const resetSummary = result.limits?.rateLimitResetCredits || null;
  return {
    account_fingerprint: accountFingerprint(identity, fingerprintKey),
    account_label: maskEmail(email) || (account?.type === 'apiKey' ? 'Local API key' : 'Local Codex account'),
    plan: planLabel('codex', account?.planType || rateSnapshot.planType),
    source: 'app_server',
    source_history: [sourceAttempt('app_server', 'ok')],
    windows: codexWindows(result.limits),
    credits: credits ? {
      enabled: credits.hasCredits === true,
      unlimited: credits.unlimited === true,
      balance: safeNumber(credits.balance),
      currency: 'USD',
      ...(spend ? {
        used: safeNumber(spend.used),
        limit: safeNumber(spend.limit),
        remaining_percent: clampPercent(spend.remainingPercent),
        resets_at: isoTimestamp(spend.resetsAt),
      } : {}),
    } : (spend ? {
      enabled: true,
      used: safeNumber(spend.used),
      limit: safeNumber(spend.limit),
      currency: 'USD',
      remaining_percent: clampPercent(spend.remainingPercent),
      resets_at: isoTimestamp(spend.resetsAt),
    } : null),
    reset_credits: resetSummary ? {
      available_count: Math.max(0, Number(resetSummary.availableCount ?? resetSummary.available_count) || 0),
      details: Array.isArray(resetSummary.credits || resetSummary.reset_credits)
        ? (resetSummary.credits || resetSummary.reset_credits).slice(0, 10).map(credit => ({
        title: safeText(credit?.title, 100) || 'Rate-limit reset',
        description: safeText(credit?.description, 160),
        status: safeText(credit?.status, 30),
        granted_at: isoTimestamp(credit?.grantedAt ?? credit?.granted_at),
        expires_at: isoTimestamp(credit?.expiresAt ?? credit?.expires_at),
      })) : null,
    } : null,
    request_count: 1,
  };
}

function codexAuthPath() {
  const base = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(base, 'auth.json');
}

async function collectCodex(fingerprintKey) {
  const attempts = [];
  try {
    return normalizeCodexAppServer(await runCodexAppServer(), fingerprintKey);
  } catch (error) {
    attempts.push(sourceAttempt('app_server', 'failed', { code: error.code }));
  }
  let auth;
  try { auth = JSON.parse(fs.readFileSync(codexAuthPath(), 'utf8')); } catch {
    throw new ProviderUsageError('Codex local authentication is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  }
  const token = safeText(auth?.tokens?.access_token || auth?.OPENAI_API_KEY, 20000);
  const accountId = safeText(auth?.tokens?.account_id, 300);
  if (!token) throw new ProviderUsageError('Codex local authentication is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  const headers = { Authorization: `Bearer ${token}` };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  const [usage, resetCredits] = await Promise.all([
    requestJson('https://chatgpt.com/backend-api/wham/usage', { headers }),
    requestJson('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits', { headers }).catch(() => null),
  ]);
  const rateLimit = usage?.rate_limit || {};
  const normalized = normalizeCodexAppServer({
    account: { account: { type: 'chatgpt', planType: usage?.plan_type }, requiresOpenaiAuth: false },
    limits: {
      rateLimits: {
        planType: usage?.plan_type,
        primary: rateLimit.primary_window,
        secondary: rateLimit.secondary_window,
        credits: usage?.credits ? {
          hasCredits: usage.credits.has_credits,
          unlimited: usage.credits.unlimited,
          balance: usage.credits.balance,
        } : null,
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: rateLimit.primary_window,
          secondary: rateLimit.secondary_window,
        },
        ...(rateLimit.code_review_window ? {
          'code-review': { limitId: 'code-review', limitName: 'Code review', primary: rateLimit.code_review_window },
        } : {}),
      },
      rateLimitResetCredits: resetCredits,
    },
  }, fingerprintKey);
  normalized.account_fingerprint = accountFingerprint(accountId || 'codex-local', fingerprintKey);
  normalized.source = 'oauth_api';
  normalized.source_history = [...attempts, sourceAttempt('oauth_api', 'ok')];
  normalized.request_count = resetCredits ? 2 : 1;
  return normalized;
}

function claudeCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function claudeWindowLabel(key) {
  const labels = {
    five_hour: 'Current session', seven_day: 'All models weekly', seven_day_opus: 'Opus weekly',
    seven_day_sonnet: 'Sonnet weekly', seven_day_oauth_apps: 'OAuth apps weekly',
    seven_day_cowork: 'Cowork weekly', seven_day_omelette: 'Designs weekly',
    omelette_promotional: 'Designs promotional',
  };
  return labels[key] || humanize(key);
}

function claudeWindowDuration(key) {
  if (key === 'five_hour') return 300;
  if (key.startsWith('seven_day')) return 10080;
  return null;
}

function stripTerminalControl(value) {
  return String(value || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function timeZoneParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function zonedDateToTimestamp(parts, timeZone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  let guess = target;
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const observed = timeZoneParts(guess, timeZone);
      const observedUtc = Date.UTC(
        observed.year, observed.month - 1, observed.day,
        observed.hour, observed.minute, observed.second,
      );
      guess += target - observedUtc;
    }
    return Number.isFinite(guess) ? guess : null;
  } catch {
    return null;
  }
}

function claudeCliResetAt(value, nowMs = Date.now()) {
  const text = stripTerminalControl(value).replace(/^\s*resets?\s*/i, '').trim();
  if (!text) return null;
  const direct = Date.parse(text);
  if (Number.isFinite(direct) && /\d{4}|T\d{2}:/.test(text)) return new Date(direct).toISOString();
  const zoneMatch = text.match(/\(([^()]+\/[A-Za-z0-9_+\-]+)\)\s*$/);
  const timeZone = zoneMatch?.[1] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const withoutZone = text.replace(/\([^()]+\)\s*$/, '').replace(/\bat\b/i, ' ').trim();
  const timeMatch = withoutZone.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  // The hidden CLI often reports only minute precision. Use the midpoint of
  // that represented minute rather than fabricating second zero.
  const second = Number(timeMatch[3] ?? 30);
  const meridiem = String(timeMatch[4] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  let today;
  try { today = timeZoneParts(nowMs, timeZone); } catch { return null; }
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dateMatch = withoutZone.match(/\b([A-Za-z]{3,9})\s*(\d{1,2})\b/);
  let year = today.year;
  let month = today.month;
  let day = today.day;
  if (dateMatch) {
    month = monthNames.indexOf(dateMatch[1].slice(0, 3).toLowerCase()) + 1;
    day = Number(dateMatch[2]);
    if (month <= 0) return null;
  }
  let timestamp = zonedDateToTimestamp({ year, month, day, hour, minute, second }, timeZone);
  if (!Number.isFinite(timestamp)) return null;
  if (dateMatch && timestamp < nowMs - 24 * 60 * 60 * 1000) {
    timestamp = zonedDateToTimestamp({ year: year + 1, month, day, hour, minute, second }, timeZone);
  } else if (!dateMatch && timestamp <= nowMs) {
    const tomorrow = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
    timestamp = zonedDateToTimestamp({
      year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate(),
      hour, minute, second,
    }, timeZone);
  }
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function claudeCliWindow(segment, id, label, scope, durationMinutes, nowMs) {
  const percent = segment.match(/(\d+(?:\.\d+)?)%(used|left)/i);
  if (!percent) return null;
  const raw = Number(percent[1]);
  const usedPercent = percent[2].toLowerCase() === 'left' ? 100 - raw : raw;
  const resetMatch = segment.slice((percent.index || 0) + percent[0].length).match(/resets?(.{1,160})/i);
  let resetDescription = resetMatch ? resetMatch[1].trim().slice(0, 160) : null;
  if (resetDescription) {
    const zone = resetDescription.match(/\([^()]+\/[A-Za-z0-9_+\-]+\)/);
    if (zone) resetDescription = resetDescription.slice(0, zone.index + zone[0].length);
    const sectionBoundary = resetDescription.search(
      /(?:what'?scontributing|approximate,based|scanninglocal|extralimits|learnmore|manageplan)/i,
    );
    if (sectionBoundary >= 0) resetDescription = resetDescription.slice(0, sectionBoundary);
    resetDescription = resetDescription.trim() || null;
  }
  return normalizedWindow({
    id, label, scope, usedPercent, durationMinutes,
    resetsAt: claudeCliResetAt(resetDescription, nowMs),
    resetDescription,
    modelScope: scope ? { id: scope.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: scope } : null,
    windowKind: 'rolling',
    source: 'hidden_cli',
    provenance: 'claude /usage',
  });
}

function parseClaudeCliUsage(output, nowMs = Date.now()) {
  const clean = stripTerminalControl(output);
  const compact = clean.replace(/\s+/g, '');
  const lower = compact.toLowerCase();
  const windows = [];
  const weekMatches = [...lower.matchAll(/currentweek(?:\(([^)]*)\))?/g)];
  const sessionIndex = lower.indexOf('currentsession');
  if (sessionIndex >= 0) {
    const end = weekMatches[0]?.index ?? compact.length;
    const session = claudeCliWindow(compact.slice(sessionIndex, end), 'five_hour', 'Current session', null, 300, nowMs);
    if (session) windows.push(session);
  }
  weekMatches.forEach((match, index) => {
    const segment = compact.slice(match.index, weekMatches[index + 1]?.index ?? compact.length);
    const normalizedScope = String(match[1] || 'allmodels').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const scopeName = normalizedScope.replace(/only$/, '');
    const isAll = !scopeName || scopeName === 'allmodels';
    const scope = isAll ? null : humanize(scopeName);
    const id = isAll ? 'seven_day' : `seven_day_${scopeName}`;
    const label = isAll ? 'All models weekly' : `${scope} weekly`;
    const window = claudeCliWindow(segment, id, label, scope, 10080, nowMs);
    if (window) windows.push(window);
  });
  if (windows.length === 0) {
    throw new ProviderUsageError('Claude hidden CLI did not return plan limit percentages.', { code: 'cli_usage_unavailable' });
  }
  const deduplicated = new Map();
  for (const window of windows) {
    const previous = deduplicated.get(window.id);
    if (!previous || window.resets_at || !previous.resets_at) deduplicated.set(window.id, window);
  }
  return [...deduplicated.values()];
}

function claudeScopedWeeklyEntries(usage) {
  const candidates = [
    usage?.scoped_weekly, usage?.weekly_scoped, usage?.scopedWeekly, usage?.weeklyScoped,
    usage?.rate_limits, usage?.rateLimits, usage?.windows, usage?.limits,
  ].flatMap(value => Array.isArray(value) ? value : []);
  return candidates.filter(value => {
    const kind = String(value?.kind || value?.type || '').toLowerCase();
    const group = String(value?.group || value?.window || '').toLowerCase();
    return kind === 'weekly_scoped' || kind === 'scoped_weekly' || group === 'weekly';
  });
}

function claudeUsageWindows(usage, source = 'oauth_api') {
  const windows = [];
  const ignoredKeys = new Set([
    'extra_usage', 'extraUsage', 'scoped_weekly', 'weekly_scoped', 'scopedWeekly',
    'weeklyScoped', 'rate_limits', 'rateLimits', 'windows', 'limits', 'spend',
  ]);
  for (const [key, value] of Object.entries(usage || {})) {
    const used = clampPercent(value?.utilization ?? value?.used_percent ?? value?.usedPercent);
    if (ignoredKeys.has(key) || !value || typeof value !== 'object' || used == null) continue;
    const scopedName = key.startsWith('seven_day_') ? humanize(key.replace('seven_day_', '')) : null;
    const normalized = normalizedWindow({
      id: key,
      label: claudeWindowLabel(key),
      scope: scopedName,
      modelScope: scopedName ? { id: key.replace(/^seven_day_/, ''), label: scopedName } : null,
      usedPercent: used,
      remainingPercent: value.remaining_percent ?? value.remainingPercent,
      durationMinutes: claudeWindowDuration(key),
      startsAt: value.starts_at || value.startsAt,
      resetsAt: value.resets_at || value.resetsAt,
      windowKind: 'rolling',
      source,
      provenance: `${source}.${key}`,
    });
    if (normalized) windows.push(normalized);
  }
  for (const [index, value] of claudeScopedWeeklyEntries(usage).entries()) {
    const model = value?.scope?.model || value?.model || value?.scope || {};
    const modelId = safeText(model?.id || model?.model_id || value?.model_id || value?.id, 120);
    const modelLabel = safeText(model?.display_name || model?.label || model?.name || value?.display_name, 120)
      || (modelId ? humanize(modelId.replace(/^claude-/, '')) : null);
    const used = clampPercent(
      value?.utilization ?? value?.used_percent ?? value?.usedPercent ?? value?.percentage ?? value?.percent,
    );
    if (!modelLabel || used == null) continue;
    const slug = (modelId || modelLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const normalized = normalizedWindow({
      id: `seven_day_scoped_${slug || index + 1}`,
      label: `${modelLabel} weekly`,
      scope: modelLabel,
      modelScope: { id: modelId || slug, label: modelLabel },
      usedPercent: used,
      remainingPercent: value.remaining_percent ?? value.remainingPercent,
      durationMinutes: safeNumber(value.duration_minutes ?? value.window_minutes) || 10080,
      startsAt: value.starts_at || value.startsAt,
      resetsAt: value.resets_at || value.resetsAt || value.reset_at,
      windowKind: 'rolling',
      source,
      provenance: `${source}.scoped_weekly`,
    });
    if (normalized && !windows.some(window => window.id === normalized.id)) windows.push(normalized);
  }
  return windows;
}

function normalizeClaudeFinancials(usage, context = {}) {
  const extra = usage?.extra_usage || usage?.extraUsage || {};
  const spend = usage?.spend && typeof usage.spend === 'object' ? usage.spend : {};
  const currency = safeText(
    spend?.used?.currency || spend?.balance?.currency || spend?.cap?.currency
      || extra.currency || context.currency,
    12,
  ) || 'USD';
  const extraUsageSpend = moneyFromEnvelope(spend.used, {
    currency, sourceField: 'spend.used', semantics: 'extra_usage_spend',
  }) || canonicalMoney(extra.used_credits, {
    currency, sourceField: 'extra_usage.used_credits', semantics: 'extra_usage_spend',
  });
  const extraUsageCap = moneyFromEnvelope(spend.cap ?? spend.limit, {
    currency,
    sourceField: spend.cap != null ? 'spend.cap' : 'spend.limit',
    semantics: 'extra_usage_cap',
  }) || canonicalMoney(extra.monthly_limit ?? extra.monthlyLimit, {
    currency, sourceField: 'extra_usage.monthly_limit', semantics: 'extra_usage_cap',
  });
  const prepaidBalance = moneyFromEnvelope(spend.balance, {
    currency, sourceField: 'spend.balance', semantics: 'prepaid_balance',
  });
  return {
    semantics_version: 1,
    source: safeText(context.source, 60) || 'oauth_api',
    observed_at: isoTimestamp(context.observedAt) || new Date().toISOString(),
    account_scope: safeText(context.accountScope, 100),
    extra_usage_enabled: spend.enabled === true || extra.is_enabled === true,
    prepaid_balance: prepaidBalance,
    extra_usage_spend: extraUsageSpend,
    extra_usage_cap: extraUsageCap,
    allowance_remaining: null,
    disclaimer: safeText(spend.disclaimer, 240),
  };
}

function normalizeCursorFinancials(usage, context = {}) {
  const planUsage = usage?.planUsage && typeof usage.planUsage === 'object' ? usage.planUsage : {};
  const cents = (field, semantics) => {
    const value = safeNumber(planUsage[field]);
    return value == null ? null : canonicalMoney(value / 100, {
      currency: 'USD', sourceField: `planUsage.${field}`, semantics,
    });
  };
  const reportedSpend = cents('totalSpend', 'reported_spend');
  const includedSpend = cents('includedSpend', 'included_spend');
  const bonusSpend = cents('bonusSpend', 'bonus_spend');
  const planLimit = cents('limit', 'reported_plan_limit');
  const reconciliationAmount = reportedSpend && includedSpend && bonusSpend
    ? roundedMoney(reportedSpend.amount - includedSpend.amount - bonusSpend.amount)
    : null;
  return {
    semantics_version: 1,
    source: safeText(context.source, 60) || 'cursor_connect',
    observed_at: isoTimestamp(context.observedAt) || new Date().toISOString(),
    account_scope: safeText(context.accountScope, 100),
    reported_spend: reportedSpend,
    included_spend: includedSpend,
    bonus_spend: bonusSpend,
    plan_limit: planLimit,
    allowance_remaining: null,
    prepaid_balance: null,
    reconciliation_delta: reconciliationAmount == null ? null : canonicalMoney(reconciliationAmount, {
      currency: 'USD',
      sourceField: 'planUsage.totalSpend-includedSpend-bonusSpend',
      semantics: 'reconciliation_delta',
      directlyReported: false,
    }),
    pool_classification: {
      classification_status: 'unavailable',
      first_party: null,
      third_party: null,
      unclassified: reportedSpend,
      warning: 'Current account response does not expose first-party and third-party monetary pools.',
    },
    resets_at: isoTimestamp(usage?.billingCycleEnd),
  };
}

function claudeCliExecutable() {
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function runClaudeUsagePty(options = {}) {
  return new Promise((resolve, reject) => {
    let pty;
    try { pty = require('node-pty'); } catch {
      reject(new ProviderUsageError('Claude hidden PTY support is unavailable.', { code: 'hidden_pty_unavailable' }));
      return;
    }
    const executable = options.executable || claudeCliExecutable();
    if (!executable) {
      reject(new ProviderUsageError('Claude CLI is not installed.', { code: 'cli_not_installed' }));
      return;
    }
    const probeDir = options.cwd || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'RemoteAgentChat', 'claude-usage-probe');
    fs.mkdirSync(probeDir, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
    Object.assign(env, {
      NO_COLOR: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_ENTRYPOINT: 'remote-agent-chat-provider-usage',
    });
    let terminal;
    try {
      terminal = pty.spawn(executable, '--safe-mode --setting-sources user --permission-mode plan', {
        name: 'xterm-256color', cols: 120, rows: 40, cwd: probeDir, env, useConpty: true,
      });
    } catch (error) {
      reject(new ProviderUsageError('Claude hidden PTY could not start.', { code: 'hidden_pty_start_failed' }));
      return;
    }
    let output = '';
    let settled = false;
    let usageSent = false;
    let trustAccepted = false;
    let sendTimer = null;
    let idleTimer = null;
    let totalTimer = null;
    const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 25000);
    const finish = (error, value, alreadyExited = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(sendTimer);
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      if (!alreadyExited) {
        try {
          terminal.write('\x1b\x03');
          setTimeout(() => { try { terminal.write('/exit\r'); } catch {} }, 100).unref?.();
          setTimeout(() => { try { terminal.kill(); } catch {} }, 2000).unref?.();
        } catch {}
      }
      if (error) reject(error); else resolve(value);
    };
    const sendUsage = () => {
      if (settled || usageSent) return;
      usageSent = true;
      const script = '/usage';
      let index = 0;
      const typeNext = () => {
        if (settled) return;
        if (index < script.length) {
          terminal.write(script[index++]);
          sendTimer = setTimeout(typeNext, 40);
        } else terminal.write('\r');
      };
      typeNext();
    };
    const scheduleUsage = delay => {
      clearTimeout(sendTimer);
      sendTimer = setTimeout(sendUsage, delay);
    };
    terminal.onData(data => {
      if (settled) return;
      output = `${output}${data}`.slice(-MAX_RESPONSE_BYTES);
      const plain = stripTerminalControl(output).toLowerCase();
      const compactPlain = plain.replace(/\s+/g, '');
      if (!usageSent && !trustAccepted
        && (compactPlain.includes('trustthisfolder') || compactPlain.includes('quicksafetycheck'))) {
        trustAccepted = true;
        clearTimeout(sendTimer);
        terminal.write('\r');
        scheduleUsage(1800);
      }
      try {
        parseClaudeCliUsage(output);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(null, output), 4000);
      } catch {}
    });
    terminal.onExit(() => {
      if (settled) return;
      try { parseClaudeCliUsage(output); finish(null, output, true); } catch {
        finish(new ProviderUsageError('Claude hidden CLI exited without usage limits.', { code: 'cli_usage_unavailable' }), null, true);
      }
    });
    scheduleUsage(Math.max(500, Number(options.initialDelayMs) || 3000));
    totalTimer = setTimeout(() => {
      try { parseClaudeCliUsage(output); finish(null, output); } catch {
        finish(new ProviderUsageError('Claude hidden CLI usage probe timed out.', { code: 'cli_usage_timeout' }));
      }
    }, timeoutMs);
  });
}

async function collectClaudeOAuth(fingerprintKey, credentialsOverride = null) {
  let credentials;
  try { credentials = credentialsOverride || JSON.parse(fs.readFileSync(claudeCredentialsPath(), 'utf8')); } catch {
    throw new ProviderUsageError('Claude local authentication is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  }
  const oauth = credentials?.claudeAiOauth || {};
  const token = safeText(oauth.accessToken, 20000);
  if (!token) throw new ProviderUsageError('Claude local authentication is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  const headers = {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'claude-code/2.1.207',
  };
  const [usage, profileResult] = await Promise.all([
    requestJson('https://api.anthropic.com/api/oauth/usage', { headers }),
    requestJson('https://api.anthropic.com/api/oauth/profile', { headers })
      .then(profile => ({ profile }))
      .catch(error => ({ error })),
  ]);
  const profile = profileResult.profile || {};
  const windows = claudeUsageWindows(usage, 'oauth_api');
  const extra = usage?.extra_usage || usage?.extraUsage || null;
  const email = profile?.account?.email || null;
  const organizationIdentity = profile?.organization?.uuid || credentials?.organizationUuid || null;
  const plan = oauth.subscriptionType
    || profile?.organization?.seat_tier
    || profile?.organization?.rate_limit_tier
    || oauth.rateLimitTier;
  const financials = normalizeClaudeFinancials(usage, {
    observedAt: Date.now(),
    accountScope: planLabel('claude', plan),
    source: 'oauth_api',
  });
  return {
    account_fingerprint: accountFingerprint(organizationIdentity || email || 'claude-local', fingerprintKey),
    account_label: maskEmail(email) || 'Local Claude account',
    plan: planLabel('claude', plan),
    source: 'oauth_api',
    source_history: [
      sourceAttempt('oauth_api', 'ok'),
      sourceAttempt('oauth_profile', profileResult.error ? 'failed' : 'ok', { code: profileResult.error?.code }),
    ],
    windows,
    credits: financials.prepaid_balance ? {
      enabled: true,
      balance: financials.prepaid_balance.amount,
      currency: financials.prepaid_balance.currency,
    } : null,
    financials,
    reset_credits: null,
    request_count: profileResult.error ? 1 : 2,
  };
}

async function collectClaudeCli(fingerprintKey, sourceHistory = []) {
  let credentials = {};
  try { credentials = JSON.parse(fs.readFileSync(claudeCredentialsPath(), 'utf8')); } catch {}
  const oauth = credentials?.claudeAiOauth || {};
  const output = await runClaudeUsagePty();
  const windows = parseClaudeCliUsage(output);
  const identity = credentials?.organizationUuid || oauth.organizationUuid || os.hostname();
  return {
    account_fingerprint: accountFingerprint(identity, fingerprintKey),
    account_label: 'Local Claude account',
    plan: planLabel('claude', oauth.subscriptionType || oauth.rateLimitTier),
    source: 'hidden_cli',
    source_history: [...sourceHistory, sourceAttempt('hidden_cli', 'ok')],
    windows,
    credits: null,
    reset_credits: null,
    request_count: 0,
  };
}

async function collectClaude(fingerprintKey, options = {}) {
  const oauthCollector = options.oauthCollector || collectClaudeOAuth;
  const cliCollector = options.cliCollector || collectClaudeCli;
  try {
    return await oauthCollector(fingerprintKey);
  } catch (oauthError) {
    const history = [sourceAttempt('oauth_api', 'failed', { code: oauthError?.code || 'unavailable' })];
    try {
      return await cliCollector(fingerprintKey, history);
    } catch (cliError) {
      throw new ProviderUsageError('Claude usage is unavailable from local OAuth and the hidden CLI fallback.', {
        code: cliError?.code || oauthError?.code || 'unavailable',
        status: ['auth_required', 'rate_limited'].includes(oauthError?.status)
          ? oauthError.status
          : 'unavailable',
        retryAfterMs: oauthError?.retryAfterMs,
      });
    }
  }
}

function cursorStoragePath() {
  return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function decodeStorageValue(value) {
  let decoded = value;
  try { decoded = JSON.parse(value); } catch {}
  if (typeof decoded === 'string') return decoded.trim();
  if (decoded && typeof decoded === 'object') {
    return safeText(decoded.accessToken || decoded.value, 20000);
  }
  return safeText(value, 20000);
}

function cursorAuthFromRows(rows, storageSource = 'node_sqlite') {
  const values = Object.fromEntries(rows.map(row => [row.key, decodeStorageValue(row.value)]));
  return {
    token: values['cursorAuth/accessToken'] || null,
    email: values['cursorAuth/cachedEmail'] || null,
    membership: values['cursorAuth/stripeMembershipType'] || null,
    subscriptionStatus: values['cursorAuth/stripeSubscriptionStatus'] || null,
    storageSource,
  };
}

function readCursorRowsWithPython(databasePath) {
  const script = [
    'import json, sqlite3, sys',
    'db = sqlite3.connect("file:" + sys.argv[1].replace("\\\\", "/") + "?mode=ro", uri=True)',
    'rows = db.execute("SELECT key, value FROM ItemTable WHERE key IN (?,?,?,?)", ("cursorAuth/accessToken", "cursorAuth/cachedEmail", "cursorAuth/stripeMembershipType", "cursorAuth/stripeSubscriptionStatus")).fetchall()',
    'db.close()',
    'print(json.dumps([{"key": row[0], "value": row[1]} for row in rows]))',
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile(process.env.PYTHON || 'python', ['-c', script, databasePath], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 256 * 1024,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(new ProviderUsageError('Cursor local credential store could not be read.', { code: 'sqlite_unavailable' }));
        return;
      }
      try {
        const rows = JSON.parse(stdout);
        if (!Array.isArray(rows)) throw new Error('invalid rows');
        resolve(rows);
      } catch {
        reject(new ProviderUsageError('Cursor local credential store returned malformed data.', { code: 'malformed_payload' }));
      }
    });
  });
}

async function readCursorLocalAuth(options = {}) {
  const databasePath = cursorStoragePath();
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw new ProviderUsageError('Cursor local credential store is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  }
  if (!options.forcePython) {
    let database;
    try {
      const { DatabaseSync } = require('node:sqlite');
      database = new DatabaseSync(databasePath, { readOnly: true });
      const rows = database.prepare(`
        SELECT key, value FROM ItemTable
        WHERE key IN (
          'cursorAuth/accessToken', 'cursorAuth/cachedEmail',
          'cursorAuth/stripeMembershipType', 'cursorAuth/stripeSubscriptionStatus'
        )
      `).all();
      return cursorAuthFromRows(rows, 'node_sqlite');
    } catch {
      // The production proxy may run on Node 20, where node:sqlite is absent.
      // Fall through to a bounded, hidden Python stdlib sqlite3 read.
    } finally {
      try { database?.close(); } catch {}
    }
  }
  return cursorAuthFromRows(await readCursorRowsWithPython(databasePath), 'python_sqlite');
}

async function collectCursor(fingerprintKey, options = {}) {
  const authReader = options.authReader || readCursorLocalAuth;
  const requester = options.requester || requestJson;
  const auth = await authReader(options);
  if (!auth.token) throw new ProviderUsageError('Cursor local authentication is unavailable.', { code: 'local_auth_missing', status: 'auth_required' });
  const requestOptions = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Connect-Protocol-Version': '1',
    },
    body: {},
    timeoutMs: Math.max(1000, Math.min(5000, Number(options.requestTimeoutMs) || 4000)),
  };
  const requestAttempts = Math.max(1, Math.min(2, Number(options.requestAttempts) || 2));
  const requestFailures = [];
  let usage;
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    try {
      usage = await requester(
        'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
        requestOptions,
      );
      break;
    } catch (error) {
      const code = safeText(error?.code, 60) || 'unavailable';
      requestFailures.push(sourceAttempt('cursor_usage_connect', 'failed', { code }));
      if (code !== 'timeout' || attempt >= requestAttempts) throw error;
    }
  }
  const planUsage = usage?.planUsage || null;
  const source = auth.storageSource === 'python_sqlite' ? 'python_sqlite_connect' : 'local_auth_connect';
  const accountScope = planLabel('cursor', auth.membership);
  const financials = normalizeCursorFinancials(usage, {
    observedAt: Date.now(), accountScope, source,
  });
  const resetAt = isoTimestamp(usage?.billingCycleEnd);
  const windows = [];
  if (planUsage) {
    const totalPercent = clampPercent(planUsage.totalPercentUsed)
      ?? (safeNumber(planUsage.limit) > 0
        ? clampPercent(safeNumber(planUsage.totalSpend) / safeNumber(planUsage.limit))
        : null);
    for (const window of [
      { id: 'plan', label: 'Plan', usedPercent: totalPercent },
      { id: 'auto', label: 'Auto', usedPercent: planUsage.autoPercentUsed },
      { id: 'api', label: 'API', usedPercent: planUsage.apiPercentUsed },
    ]) {
      const normalized = normalizedWindow({ ...window, resetsAt: resetAt });
      if (normalized) windows.push(normalized);
    }
  }
  if (usage?.enabled === false && windows.length === 0) {
    throw new ProviderUsageError('Cursor does not report plan usage for this account.', { code: 'usage_not_reported' });
  }
  return {
    account_fingerprint: accountFingerprint(auth.email || 'cursor-local', fingerprintKey),
    account_label: maskEmail(auth.email) || 'Local Cursor account',
    plan: accountScope,
    account_metadata: auth.subscriptionStatus ? { subscription_status: safeText(auth.subscriptionStatus, 40) } : null,
    source,
    source_history: [
      ...(auth.storageSource === 'python_sqlite'
        ? [sourceAttempt('node_sqlite', 'failed', { code: 'sqlite_unavailable' }), sourceAttempt('python_sqlite_connect', 'ok')]
        : [sourceAttempt('local_auth_connect', 'ok')]),
      ...requestFailures,
      sourceAttempt('cursor_usage_connect', 'ok'),
    ],
    windows,
    credits: null,
    financials,
    reset_credits: null,
    request_count: 1,
  };
}

function normalizeOllamaCloudUsage(value, capturedAt = Date.now()) {
  const source = safeText(value?.source, 60) || 'existing_signed_in_ollama_usage_surface';
  if (!value?.ok) {
    return {
      windows: [],
      financials: null,
      cloud_usage: {
        subscription_state: 'unavailable',
        source,
        captured_at: null,
        auto_reload_enabled: null,
        error: {
          code: safeText(value?.code, 60) || 'existing_usage_surface_unavailable',
          message: safeText(value?.message, 180)
            || 'Cloud usage unavailable: no readable, already-open signed-in Ollama usage page was found.',
        },
        source_receipt: null,
      },
    };
  }
  const capturedIso = isoTimestamp(value.captured_at) || new Date(capturedAt).toISOString();
  const capturedMs = Date.parse(capturedIso);
  const subscriptionState = value.subscription_state === 'none' ? 'none' : 'active';
  const resetAt = description => {
    const duration = relativeDurationMs(description);
    return duration == null ? null : new Date(capturedMs + duration).toISOString();
  };
  const windows = subscriptionState === 'active' ? [
    value.session ? normalizedWindow({
      id: 'ollama-cloud-session', label: 'Session', scope: 'Ollama Cloud',
      usedPercent: value.session.used_percent, durationMinutes: 300,
      resetsAt: resetAt(value.session.reset_description),
      resetDescription: value.session.reset_description, windowKind: 'rolling',
      source, provenance: 'Signed-in Ollama usage surface',
    }) : null,
    value.weekly ? normalizedWindow({
      id: 'ollama-cloud-weekly', label: 'Weekly', scope: 'Ollama Cloud',
      usedPercent: value.weekly.used_percent, durationMinutes: 10080,
      resetsAt: resetAt(value.weekly.reset_description),
      resetDescription: value.weekly.reset_description, windowKind: 'rolling',
      source, provenance: 'Signed-in Ollama usage surface',
    }) : null,
  ].filter(Boolean) : [];
  const prepaidBalance = safeNumber(value.prepaid_balance);
  const financials = prepaidBalance == null ? null : {
    semantics_version: 1,
    source,
    observed_at: capturedIso,
    account_scope: safeText(value.plan, 80) || 'Ollama Cloud',
    extra_usage_enabled: true,
    prepaid_balance: canonicalMoney(prepaidBalance, {
      currency: 'USD', sourceField: 'balance_remaining', semantics: 'prepaid_balance', directlyReported: true,
    }),
    extra_usage_spend: null,
    extra_usage_cap: null,
    allowance_remaining: null,
    reported_spend: null,
    included_spend: null,
    bonus_spend: null,
    plan_limit: null,
    reconciliation_delta: null,
    pool_classification: null,
    resets_at: null,
    disclaimer: 'Ollama Cloud quota and local runtime telemetry are separate truth domains.',
  };
  const receipt = value.source_receipt && typeof value.source_receipt === 'object'
    ? {
      ready_state: safeText(value.source_receipt.ready_state, 40),
      visibility_state: safeText(value.source_receipt.visibility_state, 40),
      active_element_tag: safeText(value.source_receipt.active_element_tag, 40),
      page_path: safeText(value.source_receipt.page_path, 120),
      page_state_unchanged: value.source_receipt.page_state_unchanged === true,
      dom_mutation_records: Math.max(0, Number(value.source_receipt.dom_mutation_records) || 0),
      navigation_actions: Math.max(0, Number(value.source_receipt.navigation_actions) || 0),
      click_actions: Math.max(0, Number(value.source_receipt.click_actions) || 0),
      focus_actions: Math.max(0, Number(value.source_receipt.focus_actions) || 0),
      existing_target_id_preserved: value.source_receipt.existing_target_id_preserved === true,
      target_inventory_stable: value.source_receipt.target_inventory_stable === true,
      targets_created: Math.max(0, Number(value.source_receipt.targets_created) || 0),
    }
    : null;
  return {
    windows,
    financials,
    cloud_usage: {
      subscription_state: subscriptionState,
      source,
      captured_at: capturedIso,
      auto_reload_enabled: typeof value.auto_reload_enabled === 'boolean' ? value.auto_reload_enabled : null,
      error: null,
      source_receipt: receipt,
    },
  };
}

async function collectOllama(fingerprintKey, options = {}) {
  const requester = options.requester || requestLoopbackJson;
  const receiptReader = options.receiptReader || readOllamaRequestReceipts;
  const cloudReader = options.cloudReader || readOllamaCloudUsageFromExistingChrome;
  const [runningResult, installedResult, requestReceiptsResult, cloudResult] = await Promise.allSettled([
    requester('/api/ps', options),
    requester('/api/tags', options),
    Promise.resolve(receiptReader(options)),
    Promise.resolve(cloudReader(options.cloudOptions || {})),
  ]);
  const running = runningResult.status === 'fulfilled' ? runningResult.value : null;
  const installed = installedResult.status === 'fulfilled' ? installedResult.value : null;
  const requestReceiptsValue = requestReceiptsResult.status === 'fulfilled' ? requestReceiptsResult.value : [];
  const cloudRaw = cloudResult.status === 'fulfilled'
    ? cloudResult.value
    : { ok: false, code: 'existing_usage_surface_failed', message: 'The passive Ollama cloud usage source failed.' };
  const cloud = normalizeOllamaCloudUsage(cloudRaw);
  const localAvailable = runningResult.status === 'fulfilled' || installedResult.status === 'fulfilled';
  if (!localAvailable && cloud.cloud_usage.subscription_state === 'unavailable') {
    const localError = runningResult.reason || installedResult.reason;
    throw new ProviderUsageError(
      safeText(localError?.message, 180) || 'Ollama local runtime and cloud usage are unavailable.',
      { code: safeText(localError?.code, 60) || 'not_running' },
    );
  }
  const runningModels = (Array.isArray(running?.models) ? running.models : []).slice(0, 64).map(model => ({
    name: safeText(model?.name || model?.model, 160) || 'Unnamed local model',
    size_bytes: Math.max(0, safeNumber(model?.size) || 0),
    size_vram_bytes: Math.max(0, safeNumber(model?.size_vram) || 0),
    context_length: Math.max(0, safeNumber(model?.context_length) || 0),
    expires_at: isoTimestamp(model?.expires_at),
  }));
  const installedCount = Array.isArray(installed?.models) ? installed.models.length : 0;
  const requestReceipts = (Array.isArray(requestReceiptsValue) ? requestReceiptsValue : [])
    .map(normalizePersistedOllamaReceipt)
    .filter(Boolean)
    .slice(-MAX_OLLAMA_REQUEST_RECEIPTS);
  const latestReceipt = requestReceipts.at(-1) || null;
  const cloudAvailable = cloud.cloud_usage.subscription_state !== 'unavailable';
  const plan = cloudAvailable
    ? (cloud.cloud_usage.subscription_state === 'none' ? 'No cloud subscription' : safeText(cloudRaw.plan, 80) || 'Ollama Cloud')
    : 'Local models';
  return {
    account_fingerprint: accountFingerprint(cloudAvailable ? `ollama-cloud:${plan}` : 'ollama-loopback-runtime', fingerprintKey),
    account_label: cloudAvailable && localAvailable ? 'Cloud account + loopback runtime'
      : cloudAvailable ? 'Cloud account' : 'Loopback runtime',
    plan,
    source: cloud.cloud_usage.subscription_state === 'active' ? cloud.cloud_usage.source : 'loopback_api',
    source_history: [
      sourceAttempt('ollama_api_ps', runningResult.status === 'fulfilled' ? 'ok' : 'failed', {
        code: runningResult.status === 'fulfilled' ? null : safeText(runningResult.reason?.code, 60) || 'not_running',
      }),
      sourceAttempt('ollama_api_tags', installedResult.status === 'fulfilled' ? 'ok' : 'failed', {
        code: installedResult.status === 'fulfilled' ? null : safeText(installedResult.reason?.code, 60) || 'not_running',
      }),
      ...(latestReceipt ? [sourceAttempt('ollama_owned_request_receipt', 'ok')] : []),
      sourceAttempt('ollama_cloud_existing_surface', cloud.cloud_usage.subscription_state === 'unavailable' ? 'failed' : 'ok', {
        code: cloud.cloud_usage.error?.code || null,
      }),
    ],
    windows: cloud.windows,
    credits: null,
    financials: cloud.financials,
    cloud_usage: cloud.cloud_usage,
    local_runtime: localAvailable ? {
      status: runningResult.status === 'fulfilled' && installedResult.status === 'fulfilled' ? 'running' : 'partial',
      endpoint_scope: 'loopback_only',
      installed_models_count: installedCount,
      loaded_models_count: runningModels.length,
      loaded_models: runningModels,
      prompt_tokens: latestReceipt?.prompt_tokens ?? null,
      response_tokens: latestReceipt?.response_tokens ?? null,
      tokens_per_second: latestReceipt?.tokens_per_second ?? null,
      total_duration_ns: latestReceipt?.total_duration_ns ?? null,
      load_duration_ns: latestReceipt?.load_duration_ns ?? null,
      prompt_eval_duration_ns: latestReceipt?.prompt_eval_duration_ns ?? null,
      eval_duration_ns: latestReceipt?.eval_duration_ns ?? null,
      observed_request_count: requestReceipts.length,
      request_receipts: requestReceipts,
      telemetry_status: latestReceipt ? 'observed_owned_requests' : 'not_observed',
      telemetry_reason: latestReceipt
        ? 'Only explicit owned terminal response receipts are counted; Ollama exposes no historical request totals.'
        : 'Ollama exposes no historical request totals; only explicit owned terminal response receipts are counted.',
    } : null,
    reset_credits: null,
    request_count: 3,
  };
}

function collectAntigravity(fingerprintKey, quotaCache, machineLabel) {
  const snapshot = quotaCache?.data || quotaCache || null;
  if (!snapshot || !Array.isArray(snapshot.models) || snapshot.models.length === 0) {
    throw new ProviderUsageError('Open Antigravity Settings once to expose local model quotas.', { code: 'local_quota_unavailable' });
  }
  const capturedAt = Date.parse(snapshot.fetched_at || '') || Number(quotaCache?.fetchedAt) || Date.now();
  const windows = snapshot.models.map((model, index) => {
    const resetDescription = safeText(model?.refreshes_in, 160);
    const resetDurationMs = relativeDurationMs(resetDescription);
    return normalizedWindow({
      id: `model-${index + 1}`,
      label: safeText(model?.model, 100) || `Model ${index + 1}`,
      scope: 'Model quota',
      usedPercent: model?.percent_used,
      resetsAt: isoTimestamp(model?.resets_at)
        || (resetDurationMs == null ? null : new Date(capturedAt + resetDurationMs).toISOString()),
      resetDescription,
      windowKind: safeText(model?.window_kind, 40),
    });
  }).filter(Boolean);
  const source = safeText(quotaCache?.source || snapshot?.source, 60) || 'settings_surface';
  const sourceHistory = (Array.isArray(quotaCache?.sourceHistory) ? quotaCache.sourceHistory : [])
    .map(attempt => ({
      source: safeText(attempt?.source, 60),
      status: safeText(attempt?.status, 40),
      captured_at: isoTimestamp(attempt?.captured_at),
      ...(safeText(attempt?.code, 60) ? { code: safeText(attempt.code, 60) } : {}),
    }))
    .filter(attempt => attempt.source && attempt.status && attempt.captured_at)
    .slice(-8);
  return {
    account_fingerprint: accountFingerprint(`antigravity:${machineLabel || os.hostname()}`, fingerprintKey),
    account_label: 'Local Google AI account',
    plan: safeText(snapshot.plan || snapshot.tier, 100) || 'Google AI plan',
    source,
    source_history: sourceHistory.length > 0 ? sourceHistory : [sourceAttempt(source, 'ok')],
    windows,
    credits: snapshot.available_ai_credits == null ? null : {
      enabled: true,
      balance: safeNumber(snapshot.available_ai_credits),
      unit: 'AI credits',
    },
    reset_credits: null,
    request_count: 0,
    captured_at: isoTimestamp(snapshot.fetched_at || quotaCache?.fetchedAt),
    next_refresh_at: isoTimestamp(quotaCache?.nextRefreshAt),
    stale_after_ms: ANTIGRAVITY_QUOTA_STALE_AFTER_MS,
  };
}

function publicError(error) {
  const known = error instanceof ProviderUsageError ? error : new ProviderUsageError('Usage source is unavailable.');
  const messages = {
    auth_required: 'Sign in required.',
    rate_limited: 'Provider refresh is rate limited.',
    unavailable: known.message || 'Usage source is unavailable.',
  };
  return {
    status: known.status || 'unavailable',
    error: {
      code: safeText(known.code, 60) || 'unavailable',
      message: safeText(messages[known.status] || known.message, 180) || 'Usage source is unavailable.',
      retry_after_ms: known.retryAfterMs || 0,
    },
  };
}

class ProviderUsageRegistry {
  constructor(options = {}) {
    this.getSessions = options.getSessions || (() => []);
    this.getAntigravityQuota = options.getAntigravityQuota || (() => null);
    this.onSnapshot = options.onSnapshot || (() => {});
    this.log = options.log || (() => {});
    this.machineLabel = options.machineLabel || os.hostname();
    this.pollIntervalMs = Math.max(60_000, Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
    this.staleAfterMs = Math.max(this.pollIntervalMs, Number(options.staleAfterMs) || DEFAULT_STALE_AFTER_MS);
    this.fingerprintKey = localFingerprintKey(options.fingerprintKey);
    const suppliedCollectors = options.collectors && typeof options.collectors === 'object'
      ? options.collectors
      : null;
    this.explicitCollectorKeys = new Set(Object.keys(suppliedCollectors || {}));
    this.collectAlwaysProviders = options.collectAlwaysProviders == null
      ? suppliedCollectors == null
      : options.collectAlwaysProviders === true;
    this.collectors = {
      codex: options.collectors?.codex || (() => collectCodex(this.fingerprintKey)),
      claude: options.collectors?.claude || (() => collectClaude(this.fingerprintKey)),
      antigravity: options.collectors?.antigravity || (async context => collectAntigravity(
        this.fingerprintKey,
        await this.getAntigravityQuota(context),
        this.machineLabel,
      )),
      cursor: options.collectors?.cursor || (() => collectCursor(this.fingerprintKey)),
      ollama: options.collectors?.ollama || (() => collectOllama(this.fingerprintKey)),
    };
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.thresholds = options.thresholds ?? process.env.RAC_PROVIDER_USAGE_THRESHOLDS ?? null;
    this.costScanner = options.costScanner || null;
    this.costAbortController = null;
    this.lastGood = new Map();
    this.identitiesByProvider = new Map();
    this.currentErrors = new Map();
    this.nextAllowedAt = new Map();
    this.failureCounts = new Map();
    this.generation = 0;
    this.lastCompletedAt = 0;
    this.nextRoutineAt = 0;
    this.providerInFlight = null;
    this.costInFlight = null;
    this.inFlight = null;
    this.timer = null;
  }

  activeProviders() {
    const sessions = Array.from(this.getSessions() || []);
    return Object.entries(PROVIDERS).map(([key, provider]) => ({
      key,
      provider,
      mapped: mappedProviderSessions(sessions, provider),
    })).filter(entry => entry.mapped.session_count > 0 || (
      entry.provider.always_collect === true
      && (this.collectAlwaysProviders || this.explicitCollectorKeys.has(entry.key))
    ));
  }

  snapshot(statusOverride = null) {
    const now = this.now();
    const snapshots = [];
    for (const entry of this.activeProviders()) {
      const failure = this.currentErrors.get(entry.key) || null;
      const identities = this.identitiesByProvider.get(entry.key) || new Set();
      for (const identityKey of identities) {
        const good = this.lastGood.get(identityKey) || null;
        if (!good) continue;
        const expired = Date.parse(good.stale_after || '') <= now;
        snapshots.push({
          ...good,
          ...entry.mapped,
          status: statusOverride === 'refreshing'
            ? 'refreshing'
            : (failure || expired ? 'stale' : 'fresh'),
          ...(failure ? { error: failure.error, last_good_captured_at: good.captured_at } : { error: null }),
        });
      }
      if (identities.size === 0 && failure) {
        snapshots.push({
          schema_version: SCHEMA_VERSION,
          provider_id: entry.provider.provider_id,
          provider_name: entry.provider.provider_name,
          quota_domain: entry.provider.quota_domain,
          dashboard_url: entry.provider.dashboard_url,
          account_fingerprint: `unavailable_${entry.provider.provider_id}`,
          account_label: 'Account unavailable',
          plan: null,
          source: null,
          source_history: [],
          status: failure.status,
          captured_at: null,
          stale_after: null,
          windows: [],
          credits: null,
          financials: null,
           local_runtime: null,
           cloud_usage: null,
           reset_credits: null,
          error: failure.error,
          request_count: 0,
          latency_ms: failure.latency_ms || null,
          ...entry.mapped,
        });
      }
    }
    return compactProviderUsageSnapshot({
      schema_version: SCHEMA_VERSION,
      generation: this.generation,
      generated_at: new Date(now).toISOString(),
      poll_interval_ms: this.pollIntervalMs,
      in_flight: statusOverride === 'refreshing' || !!this.providerInFlight || !!this.costInFlight,
      estimated_cost: this.costScanner?.snapshot?.() || null,
      snapshots,
    });
  }

  nextAnchor(now = this.now()) {
    return (Math.floor(now / this.pollIntervalMs) + 1) * this.pollIntervalMs;
  }

  emit(statusOverride = null) {
    const payload = this.snapshot(statusOverride);
    const assessment = providerUsageBoundaryAssessment(payload);
    const sanitized = sanitizeProviderUsageSnapshot(payload);
    if (!sanitized) {
      this.log('warn', `[usage] local snapshot rejected: ${assessment.violation || '$:invalid'} bytes=${assessment.stats.bytes ?? 'unknown'} snapshots=${assessment.stats.snapshots ?? 'unknown'} cost_rows=${assessment.stats.cost_daily_rows ?? 'unknown'}`);
      return null;
    }
    if (assessment.cost_violation) {
      this.log('warn', `[usage] local cost degraded: ${assessment.cost_violation} bytes=${assessment.stats.bytes ?? 'unknown'} cost_rows=${assessment.stats.cost_daily_rows ?? 'unknown'}`);
    }
    this.onSnapshot(sanitized);
    return sanitized;
  }

  _startCostRefresh() {
    if (!this.costScanner || this.costInFlight) return this.costInFlight;
    this.costAbortController = new AbortController();
    const costRun = this.costScanner.refresh({ signal: this.costAbortController.signal }).catch(error => {
      this.log('warn', `[usage] local estimated cost: ${safeText(error?.code || error?.message, 100) || 'unavailable'}`);
    }).then(() => {
      if (this.costInFlight === costRun) this.costInFlight = null;
      return this.emit();
    });
    this.costInFlight = costRun;
    return costRun;
  }

  async refresh(options = {}) {
    const force = options.force === true;
    const cacheFresh = !force && this.lastCompletedAt && this.now() < this.nextRoutineAt;
    if (cacheFresh && !this.providerInFlight && !this.costInFlight) {
      return this.snapshot();
    }
    const active = this.activeProviders();
    if (active.length === 0 && !this.costScanner) return this.emit();
    if (options.waitForCost === false && this.costInFlight && this.costAbortController) {
      // A client-correlated provider refresh has a 15-second receipt contract.
      // Stop any older incremental transcript scan at its next bounded yield so
      // it cannot contend with provider network/CDP callbacks. The durable cost
      // checkpoint resumes on the next routine scan.
      this.costAbortController.abort();
    }
    let startedProvider = false;
    let startedCost = false;
    if (!this.providerInFlight && !cacheFresh) {
      startedProvider = true;
      const jobs = active.map(async entry => {
        const startedAt = this.now();
        const blockedUntil = this.nextAllowedAt.get(entry.key) || 0;
        if (blockedUntil > startedAt) return;
        try {
          const collected = await this.collectors[entry.key]({ force, reason: options.reason || 'unspecified' });
          const results = Array.isArray(collected) ? collected : [collected];
          if (results.length === 0) {
            throw new ProviderUsageError('Provider returned no account usage.', { code: 'usage_not_reported' });
          }
          const nextIdentities = new Set();
          for (const result of results) {
            const rawWindows = Array.isArray(result?.windows) ? result.windows : [];
            const windows = rawWindows.map(window => enrichUsageWindow({
              ...window,
              source: window?.source || safeText(result.source, 60),
              captured_at: result.captured_at || new Date(this.now()).toISOString(),
              freshness_status: 'fresh',
            }, {
              providerId: entry.provider.provider_id,
              thresholds: this.thresholds,
              now: this.now(),
            })).filter(Boolean);
            if (windows.length === 0 && !result?.credits && !result?.reset_credits
                && !result?.financials && !result?.local_runtime && !result?.cloud_usage) {
              throw new ProviderUsageError('Provider returned no usable quota values.', { code: 'usage_not_reported' });
            }
            const fingerprint = safeText(result?.account_fingerprint, 80);
            if (!fingerprint) {
              throw new ProviderUsageError('Provider account identity is unavailable.', { code: 'account_identity_missing' });
            }
            const capturedAt = result.captured_at || new Date(this.now()).toISOString();
            const parsedCapturedAt = Date.parse(capturedAt);
            if (!Number.isFinite(parsedCapturedAt)) {
              throw new ProviderUsageError('Provider capture timestamp is invalid.', { code: 'malformed_payload' });
            }
            const identityKey = `${entry.provider.provider_id}:${fingerprint}:${entry.provider.quota_domain}`;
            nextIdentities.add(identityKey);
            const resultStaleAfterMs = Math.max(
              this.pollIntervalMs,
              Number(result.stale_after_ms) || this.staleAfterMs,
            );
            this.lastGood.set(identityKey, {
              schema_version: SCHEMA_VERSION,
              provider_id: entry.provider.provider_id,
              provider_name: entry.provider.provider_name,
              quota_domain: entry.provider.quota_domain,
              dashboard_url: entry.provider.dashboard_url,
              account_fingerprint: fingerprint,
              account_label: safeText(result.account_label, 120) || 'Local account',
              plan: safeText(result.plan, 100),
              account_metadata: result.account_metadata || null,
              source: safeText(result.source, 60),
              source_history: Array.isArray(result.source_history) ? result.source_history.slice(-8) : [],
              status: 'fresh',
              captured_at: new Date(parsedCapturedAt).toISOString(),
              stale_after: new Date(parsedCapturedAt + resultStaleAfterMs).toISOString(),
              next_refresh_at: isoTimestamp(result.next_refresh_at),
              windows,
              credits: result.credits || null,
              financials: result.financials || null,
              local_runtime: result.local_runtime || null,
              cloud_usage: result.cloud_usage || null,
              reset_credits: result.reset_credits || null,
              error: null,
              request_count: Math.max(0, Number(result.request_count) || 0),
              latency_ms: this.now() - startedAt,
              ...entry.mapped,
            });
          }
          const previousIdentities = this.identitiesByProvider.get(entry.key) || new Set();
          for (const identityKey of previousIdentities) {
            if (!nextIdentities.has(identityKey)) this.lastGood.delete(identityKey);
          }
          this.identitiesByProvider.set(entry.key, nextIdentities);
          this.currentErrors.delete(entry.key);
          this.nextAllowedAt.delete(entry.key);
          this.failureCounts.delete(entry.key);
        } catch (error) {
          const failure = publicError(error);
          this.currentErrors.set(entry.key, { ...failure, latency_ms: this.now() - startedAt });
          const failures = (this.failureCounts.get(entry.key) || 0) + 1;
          this.failureCounts.set(entry.key, failures);
          const baseDelay = Math.min(this.pollIntervalMs, 15_000 * (2 ** Math.min(5, failures - 1)));
          const jitteredDelay = Math.max(1_000, Math.round(baseDelay * (0.8 + this.random() * 0.4)));
          const delay = error?.retryAfterMs
            || (failure.status === 'auth_required' ? this.pollIntervalMs : jitteredDelay);
          this.nextAllowedAt.set(entry.key, this.now() + delay);
          this.log('warn', `[usage] ${entry.provider.provider_name}: ${failure.error.code}`);
        }
      });
      const providerRun = Promise.all(jobs).then(() => {
        if (this.providerInFlight === providerRun) this.providerInFlight = null;
        this.lastCompletedAt = this.now();
        this.nextRoutineAt = this.nextAnchor(this.lastCompletedAt);
        this.generation += 1;
        return this.emit();
      });
      this.providerInFlight = providerRun;
    }
    let deferredCostRun = null;
    if (this.costScanner && !this.costInFlight && !cacheFresh) {
      startedCost = true;
      // Provider APIs and the local transcript-cost scan are independent.
      // Let network/CDP quota collection settle first so JSONL aggregation
      // cannot starve its callbacks past the correlated 15-second receipt.
      deferredCostRun = this.providerInFlight
        ? this.providerInFlight.then(() => this._startCostRefresh())
        : this._startCostRefresh();
    }
    if ((startedProvider || startedCost) && (this.lastGood.size > 0 || this.currentErrors.size > 0)) {
      this.emit(startedProvider ? 'refreshing' : null);
    }
    const pending = [
      this.providerInFlight,
      ...(options.waitForCost === false ? [] : [deferredCostRun || this.costInFlight]),
    ].filter(Boolean);
    if (pending.length === 0) return this.snapshot();
    const requestRun = Promise.all(pending).then(() => this.snapshot()).finally(() => {
      if (this.inFlight === requestRun) this.inFlight = null;
    });
    this.inFlight = requestRun;
    return requestRun;
  }

  costDetailPage(options = {}) {
    if (!this.costScanner?.detailPage) {
      throw new ProviderUsageError('Local cost detail is unavailable.', { code: 'cost_detail_unavailable' });
    }
    return this.costScanner.detailPage(options);
  }

  start() {
    if (this.timer) return;
    this.refresh({ force: true, reason: 'startup' }).catch(() => {});
    const schedule = () => {
      const delay = Math.max(1000, this.nextAnchor(this.now()) - this.now());
      this.timer = setTimeout(async () => {
        try { await this.refresh({ reason: 'routine' }); } catch {}
        if (this.timer) schedule();
      }, delay);
      this.timer.unref?.();
    };
    schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.costAbortController?.abort();
    this.costAbortController = null;
  }
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  PROVIDERS,
  ProviderUsageError,
  ProviderUsageRegistry,
  SCHEMA_VERSION,
  accountFingerprint,
  bindCodexAppServerInput,
  clampPercent,
  collectAntigravity,
  collectClaude,
  collectClaudeCli,
  collectClaudeOAuth,
  collectCodex,
  collectCursor,
  collectOllama,
  codexWindows,
  claudeUsageWindows,
  maskEmail,
  normalizeClaudeFinancials,
  normalizeCursorFinancials,
  normalizedWindow,
  planLabel,
  readOllamaRequestReceipts,
  parseClaudeCliUsage,
  relativeDurationMs,
  readCursorLocalAuth,
  runClaudeUsagePty,
  requestJson,
  requestLoopbackJson,
  normalizeOllamaTerminalReceipt,
  ollamaReceiptStatePath,
  validateProviderDashboardUrl,
  writeOllamaRequestReceipt,
};
