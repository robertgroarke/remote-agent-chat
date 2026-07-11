#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const sessionStore = require('../agent-proxy/session-store');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');

function requireFromLocalOr(dir, mod) {
  try {
    return require(mod);
  } catch (_) {
    return require(path.join(__dirname, '..', dir, 'node_modules', mod));
  }
}

const CDP = requireFromLocalOr('agent-proxy', 'chrome-remote-interface');

let BetterSqlite3 = null;
try {
  BetterSqlite3 = requireFromLocalOr('relay-server', 'better-sqlite3');
} catch (_) {}

const PORTS = {
  antigravity: 9223,
  antigravityV2: 9226,
  codexDesktop: 9225,
};

const STATUS_PASS = 'pass';
const STATUS_FAIL = 'fail_fidelity';
const STATUS_SKIP = 'skip_precondition';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PATTERNS = {
  claude: [/Anthropic\.claude-code/i],
  codex: [/openai\.chatgpt/i, /openai/i],
  continue: [/Continue\.continue/i, /continue/i],
  roo_code: [/RooVeterinaryInc\.roo-cline/i, /roo-cline/i, /roo/i],
};

function truncate(value, limit = 180) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + '...';
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
    strict: false,
    allowActive: false,
    surfaces: ['codex-desktop', 'claude', 'codex', 'continue', 'roo_code', 'antigravity_panel', 'antigravity-v2'],
    jsonFile: null,
    tail: null,
    relayBaseUrl: null,
    relayDb: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--allow-active') {
      options.allowActive = true;
      continue;
    }
    if (arg === '--json-file' && argv[i + 1]) {
      options.jsonFile = argv[++i];
      continue;
    }
    if ((arg === '--surface' || arg === '--surfaces') && argv[i + 1]) {
      options.surfaces = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
      continue;
    }
    if (arg === '--tail' && argv[i + 1]) {
      options.tail = Math.max(1, parseInt(argv[++i], 10) || 0) || null;
      continue;
    }
    if (arg === '--relay-base-url' && argv[i + 1]) {
      options.relayBaseUrl = argv[++i];
      continue;
    }
    if (arg === '--relay-db' && argv[i + 1]) {
      options.relayDb = argv[++i];
      continue;
    }
  }

  return options;
}

function loadEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    values[key] = value;
  }
  return values;
}

function deriveRelayBaseUrls(cliValue, relayEnv, proxyEnv) {
  const values = [];
  if (cliValue) values.push(cliValue);
  const relayUrl = proxyEnv.RELAY_URL || '';
  if (relayUrl) {
    values.push(
      relayUrl
        .replace(/^ws:/i, 'http:')
        .replace(/^wss:/i, 'https:')
        .replace(/\/proxy-ws$/i, '')
    );
  }
  if (relayEnv.PUBLIC_URL) values.push(relayEnv.PUBLIC_URL);
  values.push('http://127.0.0.1:3500');
  const unique = [];
  for (const value of values.filter(Boolean)) {
    const normalized = value.replace(/\/+$/, '');
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  return unique;
}

function deriveRelayBaseUrl(cliValue, relayEnv, proxyEnv) {
  const urls = deriveRelayBaseUrls(cliValue, relayEnv, proxyEnv);
  if (urls.length > 0) return urls[0];
  const relayUrl = proxyEnv.RELAY_URL || '';
  if (!relayUrl) return null;
  return relayUrl.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/proxy-ws$/i, '').replace(/\/+$/, '');
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildBearerToken(relayEnv) {
  if (!relayEnv.JWT_SECRET || !relayEnv.ALLOWED_EMAIL) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email: relayEnv.ALLOWED_EMAIL,
    sub: 'cdp-regression-smoke',
    iat: nowSec,
    exp: nowSec + 60 * 60,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', relayEnv.JWT_SECRET)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function candidateRelayDbPaths(cliValue) {
  const list = [];
  if (cliValue) list.push(cliValue);
  list.push('/data/messages.db');
  list.push('C:\\data\\messages.db');
  list.push(path.join(__dirname, '..', 'relay-server', 'data', 'messages.db'));
  return list.filter(Boolean);
}

function findRelayDbPath(cliValue) {
  return candidateRelayDbPaths(cliValue).find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  }) || null;
}

function listSessions() {
  return sessionStore.getAllSessions();
}

function matchSessionByTarget(sessions, surface, targetId, displayHint) {
  const expectedType = surface === 'antigravity_panel' ? 'antigravity_panel' : surface;
  const candidates = sessions.filter((s) => s.agent_type === expectedType && s.target_id === targetId);
  if (candidates.length === 0 && surface === 'antigravity_panel') {
    return sessions
      .filter((s) => s.agent_type === 'antigravity_panel' && s.target_id === targetId)
      .sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null;
  }
  if (candidates.length === 0 && displayHint) {
    return sessions
      .filter((s) => s.agent_type === expectedType && String(s.workspace_name || '').toLowerCase().includes(displayHint.toLowerCase()))
      .sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null;
  }
  return candidates
    .sort((a, b) => {
      const healthyDelta = (b.status === 'healthy' ? 1 : 0) - (a.status === 'healthy' ? 1 : 0);
      if (healthyDelta !== 0) return healthyDelta;
      return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
    })[0] || null;
}

async function listTargetsByPort() {
  const output = {};
  for (const [name, port] of Object.entries(PORTS)) {
    try {
      output[name] = await CDP.List({ port });
    } catch (error) {
      output[name] = { error: error.message };
    }
  }
  return output;
}

async function withTarget(port, target, fn) {
  const client = await CDP({ port, target: target.id });
  try {
    await client.Runtime.enable();
    return await fn(client.Runtime, client);
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

function findWorkbenchTarget(targets) {
  return targets.find((t) => t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski'));
}

function findAntigravityV2Target(targets) {
  return targets.find((t) => t.type === 'page' && /\/c\/[0-9a-f-]{36}/i.test(t.url || ''))
    || targets.find((t) => t.type === 'page');
}

function findFirstMatchingTarget(targets, patterns) {
  return targets.find((t) => t.type === 'iframe' && patterns.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
}

function findMatchingTargets(targets, patterns) {
  return targets.filter((t) => t.type === 'iframe' && patterns.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
}

function stripTimestampOnlyLines(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(trimmed)) return false;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) return false;
      if (/^Worked for\s+\d+[smhd]/i.test(trimmed)) return false;
      if (/^Working for\s+\d+/i.test(trimmed)) return false;
      if (/^(?:\d+\s*h\s*)?(?:\d+\s*m\s*)?(?:\d+\s*s)\s*$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}

function normalizeWindowsPaths(text) {
  return text.replace(/[A-Za-z]:\\[^\n\r]+/g, (match) =>
    match.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  );
}

function normalizeContent(text) {
  const noTimestamps = stripTimestampOnlyLines(String(text || '').replace(/\r\n/g, '\n'))
    .replace(/\b\d{1,2}:\d{2}\s?(?:AM|PM)(?:,\s*\d{1,2}\/\d{1,2}\/\d{4})?\s*$/i, '')
    // Active Codex terminal cards continuously rewrite this elapsed label.
    // Compare the command/output body strictly while ignoring only the
    // sampling-time-dependent in-progress timer. Completed "Ran ... for Ns"
    // durations remain untouched and must still match exactly.
    .replace(/(Running command)(?:\s+for)?\s+(?:(?:\d+h\s*)?(?:\d+m\s*)?\d+s|(?:\d+h\s*)?\d+m)(?=\s|$|[A-Z])/gi, '$1')
    .replace(/(Working) for\s+(?:(?:\d+h\s*)?(?:\d+m\s*)?\d+s|(?:\d+h\s*)?\d+m)(?=\s|$|[A-Z])/gi, '$1')
    .replace(/([.!?])(?=[A-Z])/g, '$1 ');
  const withNormalizedPaths = normalizeWindowsPaths(noTimestamps);
  return withNormalizedPaths
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function contentBlockText(block) {
  if (!block) return '';
  if (typeof block === 'string') return block;
  const terminalParts = [
    block.workdir ? `cwd: ${block.workdir}` : '',
    block.command ? `$ ${block.command}` : '',
    block.stdout || '',
    block.stderr ? `stderr:\n${block.stderr}` : '',
    block.exit_code != null ? `exit code: ${block.exit_code}` : '',
  ].filter(Boolean);
  if (terminalParts.length > 0) return terminalParts.join('\n\n');
  if (Array.isArray(block.files) && block.files.length > 0) {
    const files = block.files.map(file => [
      file.path || file.file || '',
      file.added != null ? `+${file.added}` : '',
      file.removed != null ? `-${file.removed}` : '',
    ].filter(Boolean).join(' ')).filter(Boolean).join('\n');
    return [block.content || block.text || block.markdown || '', files].filter(Boolean).join('\n\n');
  }
  return block.content || block.text || block.markdown || block.title || block.label || '';
}

function messageText(msg) {
  if (Array.isArray(msg?.content_blocks) && msg.content_blocks.length > 0) {
    return msg.content_blocks.map(contentBlockText).filter(Boolean).join('\n\n') || String(msg.content || '');
  }
  return String(msg?.content || '');
}

function normalizeMessages(messages, tail) {
  const list = Array.isArray(messages) ? messages : [];
  const sliced = tail ? list.slice(-tail) : list.slice();
  return sliced
    .map((msg) => {
      const role = String(msg.role || '').trim();
      let content = normalizeContent(messageText(msg));
      if (role === 'user') content = content.replace(/\s*\n+\s*/g, ' ');
      return { role, content };
    })
    .filter((msg) => msg.role && msg.content);
}

function compareSequences(nativeMessages, webuiMessages) {
  const exact = nativeMessages.length === webuiMessages.length &&
    nativeMessages.every((msg, index) => msg.role === webuiMessages[index]?.role && msg.content === webuiMessages[index]?.content);

  let prefixMatchCount = 0;
  while (
    prefixMatchCount < nativeMessages.length &&
    prefixMatchCount < webuiMessages.length &&
    nativeMessages[prefixMatchCount].role === webuiMessages[prefixMatchCount].role &&
    nativeMessages[prefixMatchCount].content === webuiMessages[prefixMatchCount].content
  ) {
    prefixMatchCount++;
  }

  const matchedWeb = new Set();
  const missing = [];
  let cursor = 0;
  for (const native of nativeMessages) {
    let foundIndex = -1;
    for (let i = cursor; i < webuiMessages.length; i++) {
      if (native.role === webuiMessages[i].role && native.content === webuiMessages[i].content) {
        foundIndex = i;
        cursor = i + 1;
        matchedWeb.add(i);
        break;
      }
    }
    if (foundIndex === -1) missing.push(native);
  }

  const extra = webuiMessages.filter((_, index) => !matchedWeb.has(index));
  return {
    exact,
    prefixMatchCount,
    missing,
    extra,
  };
}

function messagesSoftMatch(left, right) {
  if (!left || !right || left.role !== right.role) return false;
  const a = left.content || '';
  const b = right.content || '';
  if (a === b) return true;
  if (!a || !b) return false;
  const normalizedA = a.replace(/\[Bash\s+/gi, '$ ').replace(/\]\s*\[end\]/g, ' ').replace(/\[end\]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedB = b.replace(/\[Bash\s+/gi, '$ ').replace(/\]\s*\[end\]/g, ' ').replace(/\[end\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalizedA === normalizedB) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 80 && longer.startsWith(shorter)) return true;
  const probeLen = Math.min(160, normalizedA.length, normalizedB.length);
  if (probeLen < 40) return false;
  return normalizedA.substring(0, probeLen) === normalizedB.substring(0, probeLen);
}

function findContiguousWindow(needleMessages, haystackMessages) {
  if (!Array.isArray(needleMessages) || !Array.isArray(haystackMessages)) return -1;
  if (needleMessages.length === 0) return 0;
  if (needleMessages.length > haystackMessages.length) return -1;
  for (let start = 0; start <= haystackMessages.length - needleMessages.length; start++) {
    let match = true;
    for (let i = 0; i < needleMessages.length; i++) {
      const needle = needleMessages[i];
      const hay = haystackMessages[start + i];
      if (!messagesSoftMatch(needle, hay)) {
        match = false;
        break;
      }
    }
    if (match) return start;
  }
  return -1;
}

function findOrderedSubsequence(needleMessages, haystackMessages) {
  if (!Array.isArray(needleMessages) || !Array.isArray(haystackMessages)) return null;
  if (needleMessages.length === 0) return { start: 0, end: 0, matched: 0 };

  let cursor = 0;
  let start = -1;
  let end = -1;
  for (const needle of needleMessages) {
    let found = -1;
    for (let i = cursor; i < haystackMessages.length; i++) {
      if (messagesSoftMatch(needle, haystackMessages[i])) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    if (start < 0) start = found;
    end = found;
    cursor = found + 1;
  }

  return { start, end, matched: needleMessages.length };
}

function allowsAccumulatedWebui(surface) {
  return surface === 'codex' || surface === 'codex-desktop' || surface === 'antigravity-v2';
}

function detectTrailingPartialMismatch(nativeMessages, webuiMessages, comparison) {
  if (!Array.isArray(nativeMessages) || !Array.isArray(webuiMessages)) return null;
  const lastIndex = Math.max(nativeMessages.length, webuiMessages.length) - 1;
  if (lastIndex < 0) return null;
  if (comparison.prefixMatchCount !== lastIndex) return null;

  const native = nativeMessages[lastIndex];
  const webui = webuiMessages[lastIndex];
  if (!native || !webui) return null;
  if (native.role !== webui.role) return null;

  const a = native.content || '';
  const b = webui.content || '';
  if (!a || !b || a === b) return null;
  if (!(a.startsWith(b) || b.startsWith(a))) return null;

  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if ((longer - shorter) < 40) return null;

  return {
    role: native.role,
    native_length: a.length,
    webui_length: b.length,
    trailing_delta: longer - shorter,
  };
}

function createReporter(options) {
  const results = [];
  const summary = { pass: 0, fail_fidelity: 0, skip_precondition: 0 };

  function color(status, text) {
    if (options.json) return text;
    if (status === STATUS_PASS) return '\x1b[32m' + text + '\x1b[0m';
    if (status === STATUS_FAIL) return '\x1b[31m' + text + '\x1b[0m';
    return '\x1b[33m' + text + '\x1b[0m';
  }

  function add(result) {
    const normalized = {
      surface: result.surface,
      test_id: result.test_id,
      status: result.status,
      detail: result.detail || '',
      native_evidence: result.native_evidence || null,
      webui_evidence: result.webui_evidence || null,
      expected: result.expected || null,
      actual: result.actual || null,
      investigation_hint: result.investigation_hint || null,
    };
    results.push(normalized);
    if (summary[normalized.status] == null) summary[normalized.status] = 0;
    summary[normalized.status]++;
    if (!options.json) {
      const label = normalized.status === STATUS_PASS ? 'PASS' : normalized.status === STATUS_FAIL ? 'FAIL' : 'SKIP';
      console.log('  ' + color(normalized.status, label) + ' ' + normalized.test_id + ': ' + normalized.detail);
    }
  }

  function buildReport(meta = {}) {
    return {
      generated_at: new Date().toISOString(),
      options: {
        surfaces: options.surfaces,
        strict: !!options.strict,
        allow_active: !!options.allowActive,
        tail: options.tail,
        relay_base_url: options.relayBaseUrl,
      },
      meta,
      summary,
      results,
    };
  }

  return { add, buildReport };
}

async function fetchRelayHistory(sessionId, relayBaseUrls, bearerToken) {
  if (!Array.isArray(relayBaseUrls) || relayBaseUrls.length === 0 || !bearerToken) {
    return { source: null, messages: null, error: 'relay api unavailable' };
  }
  let lastError = 'relay api unavailable';
  for (const relayBaseUrl of relayBaseUrls) {
    try {
      const res = await fetch(`${relayBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        lastError = `${relayBaseUrl} returned ${res.status}`;
        continue;
      }
      if (!/application\/json/i.test(contentType)) {
        lastError = `${relayBaseUrl} returned non-json content-type ${contentType}`;
        continue;
      }
      const data = await res.json();
      return { source: 'relay_api', source_detail: relayBaseUrl, messages: data.messages || [] };
    } catch (error) {
      lastError = `${relayBaseUrl} ${error.message}`;
    }
  }
  return { source: null, messages: null, error: lastError };
}

function createDbReader(dbPath) {
  if (!dbPath || !BetterSqlite3) return null;
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const stmtGetHistory = db.prepare(
    'SELECT id, role, content, status, sequence, ts FROM messages WHERE session = ? ORDER BY id ASC'
  );
  const stmtGetSessionMeta = db.prepare(
    'SELECT session_id, workspace_path, workspace_name, agent_type, updated_at FROM session_meta WHERE session_id = ?'
  );
  const stmtFindRelatedHistoryByPath = db.prepare(`
    SELECT sm.session_id, sm.agent_type, MAX(m.ts) AS last_active_at
    FROM session_meta sm
    JOIN messages m ON m.session = sm.session_id
    WHERE sm.session_id <> ?
      AND sm.workspace_path = ?
      AND sm.agent_type IN (?, ?)
    GROUP BY sm.session_id, sm.agent_type
    ORDER BY
      CASE sm.agent_type WHEN ? THEN 0 ELSE 1 END,
      last_active_at DESC
    LIMIT 1
  `);
  const stmtFindRelatedHistoryByName = db.prepare(`
    SELECT sm.session_id, sm.agent_type, MAX(m.ts) AS last_active_at
    FROM session_meta sm
    JOIN messages m ON m.session = sm.session_id
    WHERE sm.session_id <> ?
      AND sm.workspace_name = ?
      AND sm.agent_type IN (?, ?)
    GROUP BY sm.session_id, sm.agent_type
    ORDER BY
      CASE sm.agent_type WHEN ? THEN 0 ELSE 1 END,
      last_active_at DESC
    LIMIT 1
  `);

  return {
    dbPath,
    readHistory(sessionId) {
      const direct = stmtGetHistory.all(sessionId);
      if (direct.length > 0) return { source: 'relay_db', messages: direct };

      const meta = stmtGetSessionMeta.get(sessionId);
      if (!meta || meta.agent_type !== 'codex-desktop') return { source: 'relay_db', messages: direct };

      let candidate = null;
      if (meta.workspace_path) {
        candidate = stmtFindRelatedHistoryByPath.get(sessionId, meta.workspace_path, 'codex-desktop', 'codex-desktop', 'codex-desktop');
      }
      if (!candidate && meta.workspace_name) {
        candidate = stmtFindRelatedHistoryByName.get(sessionId, meta.workspace_name, 'codex-desktop', 'codex-desktop', 'codex-desktop');
      }
      if (!candidate?.session_id) return { source: 'relay_db', messages: direct };
      return { source: 'relay_db_fallback', messages: stmtGetHistory.all(candidate.session_id) };
    },
    close() {
      try {
        db.close();
      } catch (_) {}
    },
  };
}

function readSessionStoreHistory(session) {
  if (!session || !Array.isArray(session.accumulated_messages)) return { source: null, messages: null };
  return { source: 'session_store', messages: session.accumulated_messages };
}

async function readWebuiHistory(session, context) {
  if (!session) return { source: null, messages: null, error: 'no mapped session' };

  const apiResult = await fetchRelayHistory(session.session_id, context.relayBaseUrls, context.bearerToken);
  if (Array.isArray(apiResult.messages)) return apiResult;

  if (context.dbReader) {
    const dbResult = context.dbReader.readHistory(session.session_id);
    if (Array.isArray(dbResult.messages) && dbResult.messages.length > 0) return dbResult;
  }

  const storeResult = readSessionStoreHistory(session);
  if (Array.isArray(storeResult.messages)) return storeResult;

  return { source: null, messages: null, error: apiResult.error || 'no available history source' };
}

async function collectNativeTranscript(surface, target, sessionId, options = {}) {
  if (surface === 'codex-desktop') {
    return withTarget(PORTS.codexDesktop, target, async (Runtime) => {
      const recentTurnLimit = options.tail ? Math.max(24, Math.ceil(options.tail / 2) + 4) : 0;
      const recentUnitLimit = options.tail ? Math.max(128, options.tail * 3 + 32) : 0;
      return parseMaybeJson(await selectors.readMessages(
        Runtime,
        'codex-desktop',
        sessionId || `fidelity-${surface}`,
        recentTurnLimit ? { maxRecentTurns: recentTurnLimit, maxRecentUnits: recentUnitLimit } : {},
      ), []);
    });
  }

  if (surface === 'antigravity_panel') {
    return withTarget(PORTS.antigravity, target, async (Runtime) => {
      return parseMaybeJson(await selectors.readMessages(Runtime, 'antigravity_panel', sessionId || `fidelity-${surface}`), []);
    });
  }

  if (surface === 'antigravity-v2') {
    return withTarget(PORTS.antigravityV2, target, async (Runtime) => {
      return parseMaybeJson(await selectors.readMessages(Runtime, 'antigravity-v2', sessionId || `fidelity-${surface}`), []);
    });
  }

  if (surface === 'roo_code') {
    return withTarget(PORTS.antigravity, target, async (Runtime) => {
      return parseMaybeJson(await selectors.readMessages(Runtime, 'roo_code', sessionId || `fidelity-${surface}`), []);
    });
  }

  const expectedType = surface === 'codex' ? 'codex' : surface;
  return withTarget(PORTS.antigravity, target, async (Runtime) => {
    return parseMaybeJson(await selectors.readMessages(Runtime, expectedType, sessionId || `fidelity-${surface}`), []);
  });
}

async function runSurfaceComparison(surface, target, mappedSession, context, reporter) {
  let nativeMessages = await collectNativeTranscript(surface, target, mappedSession?.session_id, context.options);
  let webuiResult = await readWebuiHistory(mappedSession, context);

  if (!Array.isArray(nativeMessages)) {
    reporter.add({
      surface,
      test_id: `${surface}.fidelity.compare`,
      status: STATUS_SKIP,
      detail: 'Native transcript unavailable',
      investigation_hint: 'Check selectors.readMessages for ' + surface,
    });
    return;
  }

  if (!Array.isArray(webuiResult.messages)) {
    reporter.add({
      surface,
      test_id: `${surface}.fidelity.compare`,
      status: STATUS_SKIP,
      detail: 'WebUI transcript source unavailable: ' + (webuiResult.error || 'unknown'),
      native_evidence: { native_count: nativeMessages.length, mapped_session: mappedSession?.session_id || null },
      investigation_hint: 'Check relay auth/DB availability or session mapping for ' + surface,
    });
    return;
  }

  let normalizedNative = normalizeMessages(nativeMessages, context.options.tail);
  let normalizedWebui = normalizeMessages(webuiResult.messages, context.options.tail);
  let normalizedNativeFull = normalizeMessages(nativeMessages, null);
  let normalizedWebuiFull = normalizeMessages(webuiResult.messages, null);

  if (!context.options.allowActive) {
    const thinking = surface === 'codex-desktop'
      ? await withTarget(PORTS.codexDesktop, target, (Runtime) => selectors.detectThinking(Runtime, 'codex-desktop'))
      : await withTarget(PORTS.antigravity, target, (Runtime) => selectors.detectThinking(Runtime, surface));
    if (thinking && thinking.thinking) {
      reporter.add({
        surface,
        test_id: `${surface}.fidelity.compare`,
        status: STATUS_SKIP,
        detail: `Session actively generating (${thinking.label || 'thinking'})`,
        native_evidence: {
          mapped_session: mappedSession?.session_id || null,
          native_count: normalizedNative.length,
          thinking,
        },
        webui_evidence: {
          source: webuiResult.source,
          webui_count: normalizedWebui.length,
          sample_last_webui: normalizedWebui.length ? truncate(normalizedWebui[normalizedWebui.length - 1].content, 240) : null,
        },
        expected: 'Transcript fidelity should be checked on a stable session unless --allow-active is used',
        actual: {
          active: true,
          label: thinking.label || null,
        },
        investigation_hint: 'Wait for the session to stop generating, or rerun with --allow-active to compare moving transcripts',
      });
      return;
    }
  }

  if (surface === 'antigravity_panel' && normalizedNative.length === 0) {
    const panelState = await withTarget(PORTS.antigravity, target, async (Runtime) => ({
      has_content: await selectors.detectAntigravityPanelHasContent(Runtime),
      summary: await selectors.readAntigravityPanelSummary(Runtime),
      chats: await selectors.readAntigravityPanelChatList(Runtime),
    }));

    if (panelState && panelState.has_content === false) {
      const mode = panelState.summary?.mode || 'unknown';
      const model = panelState.summary?.model || 'unknown';
      reporter.add({
        surface,
        test_id: `${surface}.fidelity.compare`,
        status: STATUS_SKIP,
        detail: `Panel is not showing transcript content (${mode}; ${model})`,
        native_evidence: {
          mapped_session: mappedSession?.session_id || null,
          native_count: 0,
          panel_summary: panelState.summary || null,
          visible_chat_count: Array.isArray(panelState.chats) ? panelState.chats.length : 0,
        },
        webui_evidence: {
          source: webuiResult.source,
          webui_count: normalizedWebui.length,
          sample_last_webui: normalizedWebui.length ? truncate(normalizedWebui[normalizedWebui.length - 1].content, 240) : null,
        },
        expected: 'Visible Antigravity panel transcript should be compared only when transcript content is actually present',
        actual: {
          has_content: false,
          summary_mode: mode,
          summary_model: model,
        },
        investigation_hint: 'Select an Antigravity Chat conversation with visible transcript content before running panel fidelity checks',
      });
      return;
    }
  }

  if (surface === 'codex-desktop' && normalizedNativeFull.length === 0) {
    const threads = await withTarget(PORTS.codexDesktop, target, (Runtime) => selectors.readCodexThreadList(Runtime, true));
    const activeThread = Array.isArray(threads) ? threads.find((thread) => thread && thread.active) : null;
    reporter.add({
      surface,
      test_id: `${surface}.fidelity.compare`,
      status: STATUS_SKIP,
      detail: activeThread
        ? 'Codex Desktop active thread has no visible transcript content'
        : 'Codex Desktop is showing the project/thread list, not a visible transcript',
      native_evidence: {
        mapped_session: mappedSession?.session_id || null,
        native_count: 0,
        active_thread: activeThread || null,
        visible_thread_count: Array.isArray(threads) ? threads.length : 0,
      },
      webui_evidence: {
        source: webuiResult.source,
        webui_count: normalizedWebui.length,
        webui_full_count: normalizedWebuiFull.length,
        sample_last_webui: normalizedWebui.length ? truncate(normalizedWebui[normalizedWebui.length - 1].content, 240) : null,
      },
      expected: 'Codex Desktop fidelity should be compared only when a native transcript is visible',
      actual: {
        has_active_thread: !!activeThread,
        native_count: 0,
      },
      investigation_hint: 'Open/select a Codex Desktop thread with visible messages before running the desktop fidelity comparison',
    });
    return;
  }

  let previewComparison = compareSequences(normalizedNative, normalizedWebui);
  let activeSamplingAttempts = 1;
  if (surface === 'codex-desktop' && context.options.allowActive && !previewComparison.exact) {
    // A live relay snapshot is sampled after the native DOM and may represent
    // either side of a streaming poll boundary. Bracket it with fresh native
    // reads and refreshed relay snapshots; accept only a fully exact pair.
    // This removes sampling races without weakening any message comparison.
    const nativeCandidates = [{
      messages: nativeMessages,
      normalized: normalizedNative,
      full: normalizedNativeFull,
    }];
    for (let retry = 0; retry < 4 && !previewComparison.exact; retry++) {
      await sleep(150);
      const candidateMessages = await collectNativeTranscript(
        surface,
        target,
        mappedSession?.session_id,
        context.options,
      );
      activeSamplingAttempts++;
      if (Array.isArray(candidateMessages)) {
        nativeCandidates.push({
          messages: candidateMessages,
          normalized: normalizeMessages(candidateMessages, context.options.tail),
          full: normalizeMessages(candidateMessages, null),
        });
      }

      let exactCandidate = nativeCandidates.find(candidate =>
        compareSequences(candidate.normalized, normalizedWebui).exact
      );
      if (!exactCandidate) {
        const refreshedWebui = await readWebuiHistory(mappedSession, context);
        if (Array.isArray(refreshedWebui.messages)) {
          webuiResult = refreshedWebui;
          normalizedWebui = normalizeMessages(refreshedWebui.messages, context.options.tail);
          normalizedWebuiFull = normalizeMessages(refreshedWebui.messages, null);
          exactCandidate = nativeCandidates.find(candidate =>
            compareSequences(candidate.normalized, normalizedWebui).exact
          );
        }
      }
      if (exactCandidate) {
        nativeMessages = exactCandidate.messages;
        normalizedNative = exactCandidate.normalized;
        normalizedNativeFull = exactCandidate.full;
      } else if (nativeCandidates.length > 0) {
        const latest = nativeCandidates[nativeCandidates.length - 1];
        nativeMessages = latest.messages;
        normalizedNative = latest.normalized;
        normalizedNativeFull = latest.full;
      }
      previewComparison = compareSequences(normalizedNative, normalizedWebui);
    }
  }
  const trailingPartial = detectTrailingPartialMismatch(normalizedNative, normalizedWebui, previewComparison);
  if (trailingPartial) {
    reporter.add({
      surface,
      test_id: `${surface}.fidelity.compare`,
      status: STATUS_SKIP,
      detail: `Final message is still streaming across native/WebUI (${trailingPartial.trailing_delta} char delta)`,
      native_evidence: {
        mapped_session: mappedSession?.session_id || null,
        native_count: normalizedNative.length,
        sample_last_native: normalizedNative.length ? truncate(normalizedNative[normalizedNative.length - 1].content, 240) : null,
      },
      webui_evidence: {
        source: webuiResult.source,
        webui_count: normalizedWebui.length,
        sample_last_webui: normalizedWebui.length ? truncate(normalizedWebui[normalizedWebui.length - 1].content, 240) : null,
      },
      expected: 'Final assistant turn should be compared only after native and relay have both settled on the same completed message body',
      actual: trailingPartial,
      investigation_hint: 'Wait for the active surface to finish flushing its final assistant turn, then rerun the fidelity sweep',
    });
    return;
  }

  const comparison = previewComparison;
  const accumulatedWindowOffset = allowsAccumulatedWebui(surface)
    ? findContiguousWindow(normalizedNativeFull, normalizedWebuiFull)
    : -1;
  const passAccumulatedWindow = normalizedNativeFull.length > 0 && accumulatedWindowOffset >= 0;
  const accumulatedSubsequence = allowsAccumulatedWebui(surface)
    ? findOrderedSubsequence(normalizedNativeFull, normalizedWebuiFull)
    : null;
  const passAccumulatedSubsequence = normalizedNativeFull.length > 0 && !!accumulatedSubsequence;
  const pass = comparison.missing.length === 0 && comparison.extra.length === 0 && comparison.prefixMatchCount === normalizedNative.length && normalizedNative.length === normalizedWebui.length;

  reporter.add({
    surface,
    test_id: `${surface}.fidelity.compare`,
    status: (pass || passAccumulatedWindow || passAccumulatedSubsequence) ? STATUS_PASS : STATUS_FAIL,
    detail: pass
      ? `Matched ${normalizedNative.length} normalized messages using ${webuiResult.source}`
      : passAccumulatedWindow
        ? `Native visible transcript window (${normalizedNativeFull.length} msgs) is retained inside full WebUI history (${normalizedWebuiFull.length} msgs) using ${webuiResult.source}`
      : passAccumulatedSubsequence
        ? `Native visible transcript (${normalizedNativeFull.length} msgs) is retained in order inside expanded WebUI history (${normalizedWebuiFull.length} msgs) using ${webuiResult.source}`
      : `Mismatch via ${webuiResult.source}: native=${normalizedNative.length} webui=${normalizedWebui.length} missing=${comparison.missing.length} extra=${comparison.extra.length} prefix=${comparison.prefixMatchCount}`,
    native_evidence: {
      mapped_session: mappedSession?.session_id || null,
      native_count: normalizedNative.length,
      sample_last_native: normalizedNative.length ? truncate(normalizedNative[normalizedNative.length - 1].content, 240) : null,
      missing_samples: comparison.missing.slice(0, 3).map((m) => ({ role: m.role, content: truncate(m.content, 240) })),
    },
    webui_evidence: {
      source: webuiResult.source,
      webui_count: normalizedWebui.length,
      webui_full_count: normalizedWebuiFull.length,
      sample_last_webui: normalizedWebui.length ? truncate(normalizedWebui[normalizedWebui.length - 1].content, 240) : null,
      extra_samples: comparison.extra.slice(0, 3).map((m) => ({ role: m.role, content: truncate(m.content, 240) })),
    },
    expected: 'Normalized native transcript should match WebUI/relay transcript',
    actual: {
      prefix_match_count: comparison.prefixMatchCount,
      missing_count: comparison.missing.length,
      extra_count: comparison.extra.length,
      accumulated_window_offset: accumulatedWindowOffset >= 0 ? accumulatedWindowOffset : null,
      accumulated_window_length: passAccumulatedWindow ? normalizedNativeFull.length : null,
      accumulated_subsequence: accumulatedSubsequence,
      active_sampling_attempts: activeSamplingAttempts,
      exact: comparison.exact,
    },
    investigation_hint: 'Check selector/native DOM first, then proxy session state, then relay history, then frontend rendering',
  });
}

async function runFidelitySuite(options = {}) {
  const reporter = createReporter(options);
  const relayEnv = loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const relayBaseUrls = deriveRelayBaseUrls(options.relayBaseUrl, relayEnv, proxyEnv);
  const relayBaseUrl = relayBaseUrls[0] || null;
  const bearerToken = buildBearerToken(relayEnv);
  const relayDbPath = findRelayDbPath(options.relayDb);
  const dbReader = createDbReader(relayDbPath);
  const targetsByPort = await listTargetsByPort();
  const sessions = listSessions();

  const meta = {
    relay_base_url: relayBaseUrl,
    relay_base_urls: relayBaseUrls,
    relay_db_path: relayDbPath,
    relay_auth_mode: bearerToken ? 'bearer_jwt' : 'none',
    stored_sessions: sessions.length,
    antigravity_targets: Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity.length : 0,
    antigravity_v2_targets: Array.isArray(targetsByPort.antigravityV2) ? targetsByPort.antigravityV2.length : 0,
    codex_desktop_targets: Array.isArray(targetsByPort.codexDesktop) ? targetsByPort.codexDesktop.length : 0,
  };

  try {
    if (options.surfaces.includes('codex-desktop')) {
      const target = Array.isArray(targetsByPort.codexDesktop)
        ? targetsByPort.codexDesktop.find((t) => t.type === 'page' && t.title === 'Codex')
        : null;
      if (!target) {
        reporter.add({
          surface: 'codex-desktop',
          test_id: 'codex-desktop.fidelity.compare',
          status: STATUS_SKIP,
          detail: 'No Codex Desktop target found',
          investigation_hint: 'Open Codex Desktop before running the fidelity regression',
        });
      } else {
        const mapped = matchSessionByTarget(sessions, 'codex-desktop', target.id, 'codex');
        await runSurfaceComparison('codex-desktop', target, mapped, { relayBaseUrl, relayBaseUrls, bearerToken, dbReader, options }, reporter);
      }
    }

    if (options.surfaces.includes('antigravity-v2')) {
      const target = Array.isArray(targetsByPort.antigravityV2) ? findAntigravityV2Target(targetsByPort.antigravityV2) : null;
      if (!target) {
        reporter.add({
          surface: 'antigravity-v2',
          test_id: 'antigravity-v2.fidelity.compare',
          status: STATUS_SKIP,
          detail: 'No Antigravity v2 target found',
          investigation_hint: 'Open Antigravity v2 before running the fidelity regression',
        });
      } else {
        const mapped = matchSessionByTarget(sessions, 'antigravity-v2', target.id, target.title || target.url || 'antigravity-v2');
        await runSurfaceComparison('antigravity-v2', target, mapped, { relayBaseUrl, relayBaseUrls, bearerToken, dbReader, options }, reporter);
      }
    }

    if (Array.isArray(targetsByPort.antigravity)) {
      if (options.surfaces.includes('antigravity_panel')) {
        const workbench = findWorkbenchTarget(targetsByPort.antigravity);
        if (!workbench) {
          reporter.add({
            surface: 'antigravity_panel',
            test_id: 'antigravity_panel.fidelity.compare',
            status: STATUS_SKIP,
            detail: 'No Antigravity workbench target found',
            investigation_hint: 'Open Antigravity before running the fidelity regression',
          });
        } else {
          const mapped = matchSessionByTarget(sessions, 'antigravity_panel', workbench.id, ' / ');
          await runSurfaceComparison('antigravity_panel', workbench, mapped, { relayBaseUrl, relayBaseUrls, bearerToken, dbReader, options }, reporter);
        }
      }

      for (const surface of ['claude', 'codex', 'continue']) {
        if (!options.surfaces.includes(surface)) continue;
        const targets = surface === 'codex'
          ? findMatchingTargets(targetsByPort.antigravity, PATTERNS[surface])
          : [findFirstMatchingTarget(targetsByPort.antigravity, PATTERNS[surface])].filter(Boolean);
        if (targets.length === 0) {
          reporter.add({
            surface,
            test_id: `${surface}.fidelity.compare`,
            status: STATUS_SKIP,
            detail: `No ${surface} iframe target found`,
            investigation_hint: `Open the ${surface} surface before running the fidelity regression`,
          });
          continue;
        }
        for (const target of targets) {
          const mapped = matchSessionByTarget(sessions, surface, target.id, target.title || target.url || surface);
          await runSurfaceComparison(surface, target, mapped, { relayBaseUrl, relayBaseUrls, bearerToken, dbReader, options }, reporter);
        }
      }
    }
  } finally {
    if (dbReader) dbReader.close();
  }

  return reporter.buildReport(meta);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const run = () => runFidelitySuite(options);
  const report = options.surfaces.includes('codex-desktop')
    ? await withCodexDesktopCdpLock('codex-desktop-fidelity', run, { waitMs: 90000 })
    : await run();

  if (options.json) {
    const jsonText = JSON.stringify(report, null, 2);
    if (options.jsonFile) {
      fs.writeFileSync(options.jsonFile, jsonText);
    } else {
      process.stdout.write(jsonText + '\n');
    }
  } else {
    console.log('\n=== CDP FIDELITY SUMMARY ===\n');
    console.log('  PASS ' + report.summary.pass + '  FAIL ' + report.summary.fail_fidelity + '  SKIP ' + report.summary.skip_precondition);
    console.log('  Total ' + report.results.length);
    if (options.jsonFile) {
      fs.writeFileSync(options.jsonFile, JSON.stringify(report, null, 2));
      console.log('  Wrote JSON report to ' + options.jsonFile);
    }
  }

  if (options.strict && report.summary.fail_fidelity > 0) {
    process.exitCode = 1;
  }

  return report;
}

module.exports = {
  PATTERNS,
  buildBearerToken,
  collectNativeTranscript,
  createDbReader,
  deriveRelayBaseUrl,
  deriveRelayBaseUrls,
  findFirstMatchingTarget,
  findMatchingTargets,
  findAntigravityV2Target,
  findOrderedSubsequence,
  findRelayDbPath,
  findWorkbenchTarget,
  listSessions,
  listTargetsByPort,
  loadEnvFile,
  main,
  matchSessionByTarget,
  normalizeMessages,
  parseArgs,
  readWebuiHistory,
  runFidelitySuite,
  truncate,
  withTarget,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}
