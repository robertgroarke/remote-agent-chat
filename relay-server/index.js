'use strict';

const express    = require('express');
const session    = require('express-session');
const passport   = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const WebSocket  = require('ws');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const { isDeepStrictEqual } = require('util');
const { Worker } = require('worker_threads');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const admin      = require('firebase-admin');
const webpush    = require('web-push');
const { SqliteSessionStore } = require('./sqlite-session-store');
const {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  isUnsolicitedHistoryMessage,
  canBroadcastHistoryToBrowser,
  canBroadcastDeltaToBrowser,
  MAX_BROWSER_DELTA_BUFFER_BYTES,
} = require('./history-broadcast-policy');
const { buildDuplicateProxyAlarms } = require('./duplicate-proxy-alarm');
const { ProxyOutageMonitor } = require('./proxy-outage-monitor');
const { historyRowsMatch, buildIncrementalHistoryPlan } = require('./history-sync-policy');
const { normalizeTranscriptCursor, evaluateTranscriptCursor } = require('./transcript-cursor-policy');
const { SendLifecycleTracker } = require('./send-lifecycle');
const {
  backfillRetrySafeLegacyFailures,
  restoreRetrySafeFailedMessages,
} = require('./send-attempt-migration');
const { normalizeActivityTimeline } = require('./activity-timeline');
const {
  boundedDisplayText: boundedFleetDisplayText,
  goalLifecycleSupported,
  normalizeFleetWorkContext,
  projectFleetWorkContext,
} = require('./fleet-work-context');
const { normalizeQuestionAnswers } = require('./question-answers');
const { loadSharedRuntimeContract } = require('./shared-runtime-contract');
const { createRelayOperatorActionProof } = loadSharedRuntimeContract('windows-operator-action-proof.js');
const {
  questionPromptDeadlineGraceMs,
  QuestionPromptRegistry,
  QuestionPromptRegistryError,
} = require('./question-prompt-registry');
const { MessageDeltaGate } = require('./message-delta');
const { buildSessionExport } = require('./session-export');
const { sessionIsTestSession, sessionNoiseMetadata } = require('./session-noise-policy');
const { mergeDurableChatTitleDetails } = require('./session-title-policy');
const {
  advanceFleetSummary,
  buildProducerFleetSummary,
  mergeProducerFleetSummary,
  normalizeFleetSummary,
  projectFleetSummary,
} = require('./fleet-summary-loader').loadFleetSummary();
const {
  containsCredentialShapedValue,
  providerUsageBoundaryAssessment,
  providerUsageCostDetailViolation,
  sanitizeProviderUsageCostDetail,
  sanitizeProviderUsageSnapshot,
} = require('./provider-usage-boundary');
const {
  sanitizeHostResourceHistoryChunk,
  sanitizeHostResourceSnapshot,
  sanitizeHostResourceSystemPoint,
} = require('./host-resource-boundary');
const { ProviderUsageAuthority, matchingSessionIds } = require('./provider-usage-authority');
const { ScheduledSendStore } = require('./scheduled-sends');
const { pruneDirectory } = require('./storage-retention');
const { LatencyTraceLedger } = require('./latency-trace-ledger');
const { GoalNotificationCoordinator } = require('./goal-notifications');
const { SessionAliasReconciler } = require('./session-alias-reconciler');
const {
  canMigrateSurfaceScopedState,
  isSurfaceScopedSessionMessage,
} = require('./session-surface-state');
const { ExactlyOnceControlRegistry } = require('./exactly-once-control');
const {
  NavigationEpochRegistry,
  evaluateNavigationMessage,
  navigationSessionId,
} = require('./navigation-epoch');
const {
  UsageThresholdTracker,
  buildUsageThresholdNotification,
} = require('./usage-thresholds');
const {
  goalFingerprint,
  goalObjective,
  goalState,
  isResumableGoal,
  parseResetAt,
  resumeClientMessageId,
  retryDelayMs,
} = require('./usage-resume');
const {
  boundedString,
  createPrincipalRateLimit,
  createPrincipalWindowLimiter,
  decodeBoundedBase64,
  resolveUploadReference,
  validateCodexConfigControlMessage,
  validateQueueControlMessage,
  validateWebPushEndpoint,
  validateWebPushSubscription,
  validateWorkspaceControlMessage,
} = require('./request-security');
const {
  advanceLatencyTrace,
  normalizeLatencyTrace,
  normalizeLatencyTraceTerminal,
} = loadSharedRuntimeContract('latency-trace.js');
const {
  relayClockStageObservation,
} = loadSharedRuntimeContract('latency-clock.js');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT                 = parseInt(process.env.PORT || '3500');
const ALLOWED_EMAIL        = process.env.ALLOWED_EMAIL;
const SESSION_SECRET       = process.env.SESSION_SECRET || '';
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PUBLIC_URL           = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const PROXY_SECRET              = process.env.PROXY_SECRET || null;
const JWT_SECRET                = process.env.JWT_SECRET || null;
const FIREBASE_SERVICE_ACCOUNT  = process.env.FIREBASE_SERVICE_ACCOUNT || null;
const NOTIFY_EVEN_IF_CONNECTED  = process.env.NOTIFY_EVEN_IF_CONNECTED === 'true';
const ALLOW_LAN_BYPASS          = process.env.ALLOW_LAN_BYPASS === 'true'; // SEC-03: opt-in only
const ALLOW_LOOPBACK_BYPASS     = process.env.ALLOW_LOOPBACK_BYPASS === 'true'; // isolated local tests only
const DATA_DIR                  = process.env.RAC_DATA_DIR || '/data';
const UPLOAD_RETENTION_MS       = Math.max(1, parseInt(process.env.RAC_UPLOAD_RETENTION_DAYS || '365', 10) || 365) * 24 * 60 * 60 * 1000;
const UPLOAD_MAX_TOTAL_BYTES    = Math.max(16, parseInt(process.env.RAC_UPLOAD_MAX_TOTAL_MB || '512', 10) || 512) * 1024 * 1024;
const UPLOAD_MAX_FILES          = Math.max(100, parseInt(process.env.RAC_UPLOAD_MAX_FILES || '5000', 10) || 5000);
const UPLOAD_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HISTORY_BACKUP_MAX_FILES = Math.max(1, parseInt(process.env.RAC_HISTORY_BACKUP_MAX_FILES || '3', 10) || 3);

// Fail fast if SESSION_SECRET is missing or is a known placeholder
if (!SESSION_SECRET || SESSION_SECRET === 'changeme') {
  console.error('[FATAL] SESSION_SECRET env var is not set or is the default placeholder. Set a strong secret in .env and restart.');
  process.exit(1);
}
// SEC-10: Validate JWT_SECRET minimum entropy when set
if (JWT_SECRET && JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters. Set a strong secret in .env and restart.');
  process.exit(1);
}
const PROTOCOL_VERSION        = 1;
const HEARTBEAT_INTERVAL_MS   = 30_000;
const HEARTBEAT_TIMEOUT_MS    = 10_000;
const PROXY_OUTAGE_GRACE_MS   = Math.max(50, parseInt(process.env.PROXY_OUTAGE_GRACE_MS || '120000', 10));
const HEALTH_DEGRADE_AFTER_MS = 120_000;  // inactivity threshold → degraded
const LAUNCH_TIMEOUT_MS       = 30_000;   // max wait for proxy to confirm a new session
const DEFAULT_HISTORY_CHUNK_LIMIT = 120;
const MAX_HISTORY_CHUNK_LIMIT = 500;
const NATIVE_HISTORY_TAIL_MIN_INTERVAL_MS = 1_500;
const NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS = 5_000;
const NATIVE_HISTORY_REQUEST_STATE_TTL_MS = 60_000;
const NATIVE_HISTORY_RESULT_CACHE_MS = 1_500;
const NATIVE_HISTORY_REQUEST_TIMEOUT_MS = 30_000;
const MAX_NATIVE_HISTORY_WAITERS = 128;
const STATUS_BROADCAST_REFRESH_MS = 30_000;
const USAGE_RESUME_TICK_MS = Math.max(50, parseInt(process.env.USAGE_RESUME_TICK_MS || '5000', 10));
const USAGE_RESUME_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.USAGE_RESUME_MAX_ATTEMPTS || '6', 10));
const STATUS_BROADCAST_COALESCE_MS = 50;
const SESSION_LIST_BROADCAST_COALESCE_MS = 250;
const SESSION_PATCH_BROADCAST_COALESCE_MS = 50;
const RELAY_STATE_EPOCH = crypto.randomBytes(6).toString('hex');
let relayStateSeq = 0;
const RUNTIME_MAP_MAX_ENTRIES = 2048;
const RUNTIME_REQUEST_TTL_MS = 2 * 60 * 1000;
const LATENCY_TRACE_ACTIVE_TTL_MS = Math.max(
  1_000,
  parseInt(process.env.LATENCY_TRACE_ACTIVE_TTL_MS || String(6 * 60 * 1000), 10),
);

function setBoundedMap(map, key, value, limit = RUNTIME_MAP_MAX_ENTRIES) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
  return value;
}

// ── Structured logger ─────────────────────────────────────────────────────────

function log(level, tag, msg, extra = {}) {
  const ts     = new Date().toISOString();
  const extras = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  console.log(`[${ts}] [${level.toUpperCase()}] [${tag}] ${msg}${extras}`);
}

// ── Upload directory ──────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const HISTORY_DB_PATH = path.join(DATA_DIR, 'messages.db');
const HISTORY_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LATENCY_TRACE_LEDGER_PATH = path.join(DATA_DIR, 'latency-trace-ledger.jsonl');
const latencyTraceLedger = new LatencyTraceLedger(LATENCY_TRACE_LEDGER_PATH, { log });
const activeLatencyTraces = new Map();
const latencyTraceIdByClientMessageId = new Map();

function dropActiveLatencyTrace(traceId) {
  const entry = activeLatencyTraces.get(traceId);
  if (!entry) return false;
  activeLatencyTraces.delete(traceId);
  if (entry.client_message_id
      && latencyTraceIdByClientMessageId.get(entry.client_message_id) === traceId) {
    latencyTraceIdByClientMessageId.delete(entry.client_message_id);
  }
  return true;
}

function retainActiveLatencyTrace(trace) {
  const traceId = trace.trace_id;
  const clientMessageId = trace.client_message_id || null;
  activeLatencyTraces.set(traceId, trace);
  if (clientMessageId) latencyTraceIdByClientMessageId.set(clientMessageId, traceId);
  while (activeLatencyTraces.size > RUNTIME_MAP_MAX_ENTRIES) {
    terminalizeActiveLatencyTrace(
      activeLatencyTraces.keys().next().value,
      'capacity_evicted',
    );
  }
  return trace;
}

function latencyTracePrefixMatches(current, incoming) {
  if (!current || !incoming || current.trace_id !== incoming.trace_id) return false;
  for (const [stage, atMs] of Object.entries(current.stages || {})) {
    if (incoming.stages?.[stage] !== atMs) return false;
  }
  return true;
}

function registerBrowserLatencyTrace(raw, sessionId, clientMessageId, receivedAtMs) {
  if (!raw || !clientMessageId) return null;
  const agentType = sessionMeta.get(sessionId)?.agent_type || raw.agent_type || 'unknown';
  const clock = relayClockStageObservation(receivedAtMs, 'relay');
  const advanced = advanceLatencyTrace({
    ...raw,
    client_message_id: clientMessageId,
    agent_type: agentType,
  }, 'relay_recv', receivedAtMs, { source: 'relay_client_ws', ...clock.source });
  if (!advanced.ok) {
    log('warn', 'latency-trace', 'Rejected browser send trace', {
      trace_id: raw.trace_id || null,
      code: advanced.code,
    });
    return null;
  }
  return retainActiveLatencyTrace(advanced.trace);
}

function acceptProxyLatencyTrace(raw) {
  if (!raw) return null;
  const normalized = normalizeLatencyTrace(raw);
  if (!normalized.ok) {
    log('warn', 'latency-trace', 'Rejected proxy trace', {
      trace_id: raw.trace_id || null,
      code: normalized.code,
    });
    return null;
  }
  const incoming = normalized.trace;
  const currentTraceId = incoming.client_message_id
    ? latencyTraceIdByClientMessageId.get(incoming.client_message_id)
    : incoming.trace_id;
  const current = activeLatencyTraces.get(currentTraceId || incoming.trace_id);
  if (current && !latencyTracePrefixMatches(current, incoming)) {
    log('warn', 'latency-trace', 'Rejected proxy trace prefix rewrite', {
      trace_id: incoming.trace_id,
    });
    return null;
  }
  return retainActiveLatencyTrace(incoming);
}

function latencyTraceForRelayBroadcast(raw, broadcastAtMs, source) {
  const accepted = acceptProxyLatencyTrace(raw);
  if (!accepted?.stages?.agent_first_output) return null;
  const clock = relayClockStageObservation(broadcastAtMs, 'relay');
  const advanced = advanceLatencyTrace(
    accepted,
    'relay_broadcast',
    broadcastAtMs,
    { ...(source || {}), ...clock.source },
  );
  if (!advanced.ok) {
    log('warn', 'latency-trace', 'Rejected relay broadcast trace', {
      trace_id: accepted.trace_id,
      code: advanced.code,
    });
    return null;
  }
  return retainActiveLatencyTrace(advanced.trace);
}

function completeBrowserLatencyTrace(raw) {
  const normalized = normalizeLatencyTrace(raw, { requireComplete: true });
  if (!normalized.ok) return normalized;
  const trace = normalized.trace;
  const current = activeLatencyTraces.get(trace.trace_id);
  if (!current) {
    return latencyTraceLedger.completedTraceIds.has(trace.trace_id)
      ? { ok: true, appended: false, duplicate: true, trace_id: trace.trace_id }
      : { ok: false, code: 'trace_not_active' };
  }
  if (!latencyTracePrefixMatches(current, trace)) {
    return { ok: false, code: 'trace_prefix_rewritten' };
  }
  const result = latencyTraceLedger.append(trace);
  if (result.ok) dropActiveLatencyTrace(trace.trace_id);
  return result;
}

function terminalizeProxyLatencyTrace(raw) {
  const normalized = normalizeLatencyTraceTerminal(raw);
  if (!normalized.ok) return normalized;
  const terminal = normalized.terminal;
  const currentTraceId = terminal.client_message_id
    ? latencyTraceIdByClientMessageId.get(terminal.client_message_id)
    : terminal.trace_id;
  const current = activeLatencyTraces.get(currentTraceId || terminal.trace_id);
  if (!current) {
    if (latencyTraceLedger.completedTraceIds.has(terminal.trace_id)) {
      return { ok: true, appended: false, duplicate: true, trace_id: terminal.trace_id };
    }
    const durableReceipt = terminal.client_message_id
      ? (stmtGetSendReceipt.get(terminal.client_message_id)
        || stmtGetByClientId.get(terminal.client_message_id))
      : null;
    if (!durableReceipt) return { ok: false, code: 'trace_not_active' };
    const durableAgentType = sessionMeta.get(durableReceipt.session)?.agent_type || null;
    if (durableAgentType && terminal.agent_type !== 'unknown'
        && terminal.agent_type !== durableAgentType) {
      return { ok: false, code: 'terminal_identity_mismatch' };
    }
    return latencyTraceLedger.appendTerminal(terminal);
  }
  if (current.trace_id !== terminal.trace_id
      || (current.client_message_id && terminal.client_message_id
        && current.client_message_id !== terminal.client_message_id)
      || (current.agent_type && terminal.agent_type
        && current.agent_type !== terminal.agent_type)) {
    return { ok: false, code: 'terminal_identity_mismatch' };
  }
  const result = latencyTraceLedger.appendTerminal(terminal);
  if (result.ok) dropActiveLatencyTrace(terminal.trace_id);
  return result;
}

function terminalizeActiveLatencyTrace(traceId, reason, terminalAtMs = Date.now()) {
  const trace = activeLatencyTraces.get(traceId);
  if (!trace) return { ok: false, code: 'trace_not_active' };
  const normalized = normalizeLatencyTraceTerminal({
    trace_id: trace.trace_id,
    client_message_id: trace.client_message_id,
    agent_type: trace.agent_type,
    surface_class: trace.surface_class,
    reason,
    terminal_at_ms: terminalAtMs,
    stages_completed: Object.keys(trace.stages || {}),
  });
  if (!normalized.ok) return normalized;
  const result = latencyTraceLedger.appendTerminal(normalized.terminal);
  if (result.ok) dropActiveLatencyTrace(trace.trace_id);
  if (result.appended) {
    broadcastToBrowsers({
      type: 'latency_trace_terminal',
      protocol_version: PROTOCOL_VERSION,
      latency_trace_terminal: normalized.terminal,
    });
  }
  log(result.ok ? 'info' : 'warn', 'latency-trace', 'Terminalized active send trace', {
    trace_id: trace.trace_id,
    reason,
    appended: result.appended === true,
    code: result.ok ? null : result.code,
  });
  return result;
}

function expireActiveLatencyTraces(now = Date.now()) {
  let expired = 0;
  for (const [traceId, trace] of [...activeLatencyTraces.entries()]) {
    const relayReceivedAt = Number(trace.stages?.relay_recv || 0);
    if (!(relayReceivedAt > 0) || now - relayReceivedAt <= LATENCY_TRACE_ACTIVE_TTL_MS) continue;
    const reason = trace.stages?.harness_delivered
      ? 'expired_no_output'
      : 'expired_before_delivery';
    if (terminalizeActiveLatencyTrace(traceId, reason, now).ok) expired += 1;
  }
  return expired;
}

const latencyTraceCleanupTimer = setInterval(() => {
  try {
    expireActiveLatencyTraces();
  } catch (error) {
    log('warn', 'latency-trace', 'Active trace cleanup failed', { error: error.message });
  }
}, Math.min(30_000, Math.max(1_000, Math.floor(LATENCY_TRACE_ACTIVE_TTL_MS / 10))));
latencyTraceCleanupTimer.unref?.();

let lastUploadMaintenanceAt = 0;
let uploadInventory = { retained: 0, retainedBytes: 0 };
function runUploadMaintenance() {
  lastUploadMaintenanceAt = Date.now();
  const result = pruneDirectory(UPLOAD_DIR, {
    maxAgeMs: UPLOAD_RETENTION_MS,
    maxBytes: UPLOAD_MAX_TOTAL_BYTES,
    maxFiles: UPLOAD_MAX_FILES,
  });
  if (result.removed > 0) {
    log('info', 'uploads', 'Removed expired/overflow uploads', {
      files: result.removed,
      reclaimed_bytes: result.removedBytes,
    });
  }
  uploadInventory = result;
  return result;
}
runUploadMaintenance();
const uploadMaintenanceTimer = setInterval(runUploadMaintenance, UPLOAD_MAINTENANCE_INTERVAL_MS);
uploadMaintenanceTimer.unref?.();

// ── SQLite ────────────────────────────────────────────────────────────────────

const db = new Database(HISTORY_DB_PATH);
// The relay's message path is event-loop synchronous. WAL avoids blocking readers
// behind every write, while NORMAL keeps WAL commits durable without forcing a
// full filesystem sync for each streamed message.
const SQLITE_JOURNAL_MODE = db.pragma('journal_mode = WAL', { simple: true });
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
// A checkpointed WAL normally remains allocated at its high-water mark. Put a
// hard ceiling on that reusable allocation so one burst cannot permanently
// consume arbitrary disk space.
const SQLITE_JOURNAL_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;
db.pragma(`journal_size_limit = ${SQLITE_JOURNAL_SIZE_LIMIT_BYTES}`);
const SQLITE_SYNCHRONOUS = db.pragma('synchronous', { simple: true });
const SQLITE_BUSY_TIMEOUT_MS = db.pragma('busy_timeout', { simple: true });
const SQLITE_JOURNAL_SIZE_LIMIT = db.pragma('journal_size_limit', { simple: true });
log('info', 'db', 'SQLite configured', {
  journal_mode: SQLITE_JOURNAL_MODE,
  synchronous: SQLITE_SYNCHRONOUS,
  busy_timeout_ms: SQLITE_BUSY_TIMEOUT_MS,
  journal_size_limit_bytes: SQLITE_JOURNAL_SIZE_LIMIT,
});

// Create table + the idx_session index (safe on old schema with no new columns)
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session       TEXT    NOT NULL,
    role          TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    ts            INTEGER NOT NULL DEFAULT (unixepoch()),
    client_msg_id TEXT,
    status        TEXT    NOT NULL DEFAULT 'delivered',
    sequence      INTEGER NOT NULL DEFAULT 0,
    content_blocks TEXT,
    source_message_id TEXT,
    source_cursor TEXT,
    source         TEXT,
    accepted_at    TEXT,
    launch_accepted_at TEXT,
    delivered_at   TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch  TEXT,
    failure_code   TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    delivery_attempt INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_session ON messages(session, id);
  CREATE TABLE IF NOT EXISTS send_receipts (
    client_msg_id TEXT PRIMARY KEY,
    session       TEXT NOT NULL,
    server_message_id INTEGER,
    sequence      INTEGER,
    ts            REAL,
    status        TEXT NOT NULL DEFAULT 'accepted',
    accepted_at   TEXT,
    launch_accepted_at TEXT,
    delivered_at  TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch TEXT,
    failure_code  TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    content       TEXT,
    delivery_attempt INTEGER NOT NULL DEFAULT 1,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_send_receipts_session ON send_receipts(session, updated_at);
  CREATE INDEX IF NOT EXISTS idx_send_receipts_server_message
    ON send_receipts(server_message_id) WHERE server_message_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS send_attempts (
    client_msg_id TEXT NOT NULL,
    delivery_attempt INTEGER NOT NULL,
    session TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    accepted_at TEXT,
    launch_accepted_at TEXT,
    delivered_at TEXT,
    agent_started_at TEXT,
    native_receipt TEXT,
    process_epoch TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    failure_native_attempted INTEGER,
    failure_retryable INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (client_msg_id, delivery_attempt)
  );
  CREATE INDEX IF NOT EXISTS idx_send_attempts_session
    ON send_attempts(session, client_msg_id, delivery_attempt);
  CREATE TABLE IF NOT EXISTS transcript_source_cursors (
    session           TEXT NOT NULL,
    source            TEXT NOT NULL,
    generation        TEXT NOT NULL,
    message_index     INTEGER NOT NULL,
    end_offset        INTEGER NOT NULL,
    file_size         INTEGER NOT NULL,
    source_message_id TEXT,
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (session, source)
  );
  CREATE TABLE IF NOT EXISTS question_prompt_tombstones (
    session_id  TEXT NOT NULL,
    prompt_id   TEXT NOT NULL,
    generation  TEXT NOT NULL,
    lifecycle   TEXT NOT NULL,
    terminal_at TEXT NOT NULL,
    error_code  TEXT,
    PRIMARY KEY (session_id, prompt_id)
  );
  CREATE INDEX IF NOT EXISTS idx_question_prompt_tombstones_terminal
    ON question_prompt_tombstones(terminal_at);
`);

// ── Android app auth tables (A12-01) ──────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS app_auth_tokens (
    token      TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fcm_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    platform   TEXT NOT NULL DEFAULT 'android',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_web_push_email_updated
    ON web_push_subscriptions(email, updated_at);
  CREATE TABLE IF NOT EXISTS relay_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notification_preferences (
    email              TEXT PRIMARY KEY,
    permission_required INTEGER NOT NULL DEFAULT 1,
    agent_ready        INTEGER NOT NULL DEFAULT 1,
    turn_ready         INTEGER NOT NULL DEFAULT 0,
    goal_completed     INTEGER NOT NULL DEFAULT 0,
    goal_attention     INTEGER NOT NULL DEFAULT 1,
    provider_usage_warning INTEGER NOT NULL DEFAULT 1,
    agent_error        INTEGER NOT NULL DEFAULT 1,
    session_offline    INTEGER NOT NULL DEFAULT 1,
    rate_limit_cleared INTEGER NOT NULL DEFAULT 1,
    completion_sound   INTEGER NOT NULL DEFAULT 0,
    completion_haptic  INTEGER NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS session_preferences (
    email        TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    display_name TEXT,
    archived     INTEGER NOT NULL DEFAULT 0,
    muted        INTEGER NOT NULL DEFAULT 0,
    pin_order    INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (email, session_id)
  );
  CREATE TABLE IF NOT EXISTS nightly_validation_status (
    harness       TEXT PRIMARY KEY,
    status        TEXT NOT NULL,
    app_version   TEXT NOT NULL,
    validator     TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    exit_code     INTEGER,
    detail        TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    completed_at  TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (!db.prepare('PRAGMA table_info(nightly_validation_status)').all().some(info => info.name === 'metadata_json')) {
  db.exec("ALTER TABLE nightly_validation_status ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
}

// Existing installs predate the complete notification category set.
for (const column of ['permission_required', 'agent_error', 'session_offline']) {
  if (!db.prepare('PRAGMA table_info(notification_preferences)').all().some(info => info.name === column)) {
    db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
  }
}
for (const column of ['completion_sound', 'completion_haptic']) {
  if (!db.prepare('PRAGMA table_info(notification_preferences)').all().some(info => info.name === column)) {
    db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  }
}
const notificationPreferenceColumns = new Set(
  db.prepare('PRAGMA table_info(notification_preferences)').all().map(info => info.name),
);
for (const column of ['turn_ready', 'goal_completed']) {
  if (notificationPreferenceColumns.has(column)) continue;
  db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
}
if (!notificationPreferenceColumns.has('provider_usage_warning')) {
  db.exec('ALTER TABLE notification_preferences ADD COLUMN provider_usage_warning INTEGER NOT NULL DEFAULT 1');
}
for (const [column, legacyColumn] of [
  ['goal_attention', 'agent_error'],
]) {
  if (notificationPreferenceColumns.has(column)) continue;
  db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  db.exec(`UPDATE notification_preferences SET ${column} = ${legacyColumn}`);
}
if (!db.prepare('PRAGMA table_info(session_preferences)').all().some(info => info.name === 'pin_order')) {
  db.exec('ALTER TABLE session_preferences ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0');
}

function getOrCreateVapidKeys() {
  const publicRow = db.prepare("SELECT value FROM relay_settings WHERE key = 'vapid_public_key'").get();
  const privateRow = db.prepare("SELECT value FROM relay_settings WHERE key = 'vapid_private_key'").get();
  if (publicRow?.value && privateRow?.value) {
    return { publicKey: publicRow.value, privateKey: privateRow.value };
  }
  const generated = webpush.generateVAPIDKeys();
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO relay_settings (key, value) VALUES (?, ?)')
      .run('vapid_public_key', generated.publicKey);
    db.prepare('INSERT OR REPLACE INTO relay_settings (key, value) VALUES (?, ?)')
      .run('vapid_private_key', generated.privateKey);
  })();
  return generated;
}

const vapidKeys = getOrCreateVapidKeys();
webpush.setVapidDetails(
  process.env.VAPID_CONTACT || 'mailto:notifications@your-server',
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

const NIGHTLY_VALIDATION_HARNESSES = new Set([
  'antigravity-v2', 'claude-cli', 'claude', 'codex-cli', 'codex-desktop', 'codex', 'continue',
  'cursor-cli', 'cursor', 'native-golden-approval', 'performance-budgets', 'production-block-inventory',
  'production-overnight-runner', 'scheduled-send', 'visual-regression',
  'operator-dogfood',
]);
const APP_UPDATE_VALIDATION_HARNESSES = new Set([
  ...NIGHTLY_VALIDATION_HARNESSES,
  'gemini', 'roo_code',
]);
const HARNESS_REVALIDATION_HARNESSES = new Set([
  ...APP_UPDATE_VALIDATION_HARNESSES,
  'cline',
  'revalidation-program',
]);

const LATEST_APP_UPDATE_VALIDATION_KEY = 'latest_app_update_validation';
const HARNESS_REVALIDATION_HEALTH_KEY = 'harness_revalidation_health';
const OPERATOR_DOGFOOD_HEALTH_KEY = 'operator_dogfood_health';

function operatorDogfoodHealth() {
  const row = db.prepare('SELECT value FROM relay_settings WHERE key = ?').get(OPERATOR_DOGFOOD_HEALTH_KEY);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function saveOperatorDogfoodHealth(value) {
  if (!value || typeof value !== 'object') return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > 128 * 1024) throw new Error('Operator dogfood health exceeds 128 KiB');
  db.prepare('INSERT OR REPLACE INTO relay_settings (key, value) VALUES (?, ?)')
    .run(OPERATOR_DOGFOOD_HEALTH_KEY, serialized);
  return value;
}

function harnessRevalidationHealth() {
  const row = db.prepare('SELECT value FROM relay_settings WHERE key = ?').get(HARNESS_REVALIDATION_HEALTH_KEY);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function saveHarnessRevalidationHealth(value) {
  if (!value || typeof value !== 'object') return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > 128 * 1024) throw new Error('Harness revalidation health exceeds 128 KiB');
  db.prepare('INSERT OR REPLACE INTO relay_settings (key, value) VALUES (?, ?)')
    .run(HARNESS_REVALIDATION_HEALTH_KEY, serialized);
  return value;
}

function latestAppUpdateValidation() {
  const row = db.prepare('SELECT value FROM relay_settings WHERE key = ?').get(LATEST_APP_UPDATE_VALIDATION_KEY);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function saveLatestAppUpdateValidation(validation, requested) {
  const value = {
    ...validation,
    kind: 'app_update_validation',
    previous_app_version: String(requested?.previous_app_version || 'unavailable').slice(0, 200),
    change_detected_at: requested?.change_detected_at && !Number.isNaN(Date.parse(requested.change_detected_at))
      ? new Date(requested.change_detected_at).toISOString()
      : validation.completed_at,
  };
  db.prepare('INSERT OR REPLACE INTO relay_settings (key, value) VALUES (?, ?)')
    .run(LATEST_APP_UPDATE_VALIDATION_KEY, JSON.stringify(value));
  return value;
}

function nightlyValidationStatuses() {
  return db.prepare(`
    SELECT harness, status, app_version, validator, run_id, duration_ms,
           exit_code, detail, completed_at, metadata_json
    FROM nightly_validation_status
    ORDER BY harness
  `).all().map(row => {
    const { metadata_json: metadataJson, ...base } = row;
    try {
      const metadata = JSON.parse(metadataJson || '{}');
      return metadata && typeof metadata === 'object' ? { ...base, ...metadata } : base;
    } catch {
      return base;
    }
  });
}

function saveNightlyValidationStatus(requested) {
  const harness = String(requested?.harness || '').trim();
  const status = String(requested?.status || '').trim();
  const completedAt = String(requested?.completed_at || '').trim();
  const allowedHarnesses = requested?.kind === 'app_update_validation'
    ? APP_UPDATE_VALIDATION_HARNESSES
    : ['harness_revalidation_tier2', 'harness_revalidation_program'].includes(requested?.kind)
      ? HARNESS_REVALIDATION_HARNESSES
    : NIGHTLY_VALIDATION_HARNESSES;
  if (!allowedHarnesses.has(harness)) throw new Error('Unknown validation harness');
  if (!['pass', 'fail', 'timed_out', 'gated', 'stale', 'skipped'].includes(status)) throw new Error('Invalid validation status');
  if (!completedAt || Number.isNaN(Date.parse(completedAt))) throw new Error('Invalid validation completion time');
  const metadata = {
    kind: String(requested?.kind || 'nightly_validation').slice(0, 80),
    tier2_status: requested?.tier2_status ? String(requested.tier2_status).slice(0, 80) : null,
    failure_stage: requested?.failure_stage ? String(requested.failure_stage).slice(0, 120) : null,
    fixture_diff: requested?.fixture_diff ? String(requested.fixture_diff).slice(0, 2000) : null,
    validation_transition: requested?.validation_transition ? String(requested.validation_transition).slice(0, 500) : null,
    next_tier1_at: requested?.next_tier1_at || null,
    next_tier2_at: requested?.next_tier2_at || null,
    last_validated_version: requested?.last_validated_version || null,
    last_tier2_pass: requested?.last_tier2_pass || null,
    program_health: requested?.program_health && typeof requested.program_health === 'object'
      ? requested.program_health
      : null,
  };
  let metadataJson = JSON.stringify(metadata);
  if (metadataJson.length > 128 * 1024) throw new Error('Validation metadata exceeds 128 KiB');
  const value = {
    harness,
    status,
    app_version: String(requested?.app_version || 'unavailable').slice(0, 200),
    validator: String(requested?.validator || '').slice(0, 300),
    run_id: String(requested?.run_id || '').slice(0, 200),
    duration_ms: Math.max(0, Math.min(Number(requested?.duration_ms) || 0, 24 * 60 * 60 * 1000)),
    exit_code: Number.isInteger(requested?.exit_code) ? requested.exit_code : null,
    detail: String(requested?.detail || '').slice(-4000),
    completed_at: new Date(completedAt).toISOString(),
    ...metadata,
  };
  db.prepare(`
    INSERT INTO nightly_validation_status
      (harness, status, app_version, validator, run_id, duration_ms, exit_code, detail, metadata_json, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(harness) DO UPDATE SET
      status = excluded.status,
      app_version = excluded.app_version,
      validator = excluded.validator,
      run_id = excluded.run_id,
      duration_ms = excluded.duration_ms,
      exit_code = excluded.exit_code,
      detail = excluded.detail,
      metadata_json = excluded.metadata_json,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `).run(
    value.harness, value.status, value.app_version, value.validator, value.run_id,
    value.duration_ms, value.exit_code, value.detail, metadataJson, value.completed_at,
  );
  return value;
}

const TURN_READY_NOTIFICATIONS_ENABLED = false;
const FORBIDDEN_COMPLETION_NOTIFICATION_TYPES = new Set(['agent_idle', 'turn_ready']);

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  permission_required: true,
  agent_ready: true,
  turn_ready: false,
  goal_completed: false,
  goal_attention: true,
  provider_usage_warning: true,
  agent_error: true,
  session_offline: true,
  rate_limit_cleared: true,
  completion_sound: false,
  completion_haptic: false,
});

function notificationPreferencesForEmail(email) {
  if (!email) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const row = db.prepare(`
    SELECT permission_required, agent_ready, turn_ready, goal_completed, goal_attention, provider_usage_warning,
           agent_error, session_offline, rate_limit_cleared,
           completion_sound, completion_haptic
    FROM notification_preferences
    WHERE email = ?
  `).get(email);
  return {
    permission_required: row ? !!row.permission_required : true,
    agent_ready: row ? !!row.agent_ready : true,
    turn_ready: TURN_READY_NOTIFICATIONS_ENABLED && (row ? !!row.turn_ready : false),
    goal_completed: row ? !!row.goal_completed : false,
    goal_attention: row ? !!row.goal_attention : true,
    provider_usage_warning: row ? !!row.provider_usage_warning : true,
    agent_error: row ? !!row.agent_error : true,
    session_offline: row ? !!row.session_offline : true,
    rate_limit_cleared: row ? !!row.rate_limit_cleared : true,
    completion_sound: row ? !!row.completion_sound : false,
    completion_haptic: row ? !!row.completion_haptic : false,
  };
}

function notificationPreferenceRevisionForEmail(email) {
  if (!email) return 'defaults';
  const row = db.prepare('SELECT updated_at FROM notification_preferences WHERE email = ?').get(email);
  return String(row?.updated_at || 'defaults');
}

function saveNotificationPreferences(email, requested) {
  const current = notificationPreferencesForEmail(email);
  const preferences = {
    permission_required: typeof requested?.permission_required === 'boolean'
      ? requested.permission_required : current.permission_required,
    agent_ready: typeof requested?.agent_ready === 'boolean'
      ? requested.agent_ready : current.agent_ready,
    turn_ready: false,
    goal_completed: typeof requested?.goal_completed === 'boolean'
      ? requested.goal_completed : current.goal_completed,
    goal_attention: typeof requested?.goal_attention === 'boolean'
      ? requested.goal_attention : current.goal_attention,
    provider_usage_warning: typeof requested?.provider_usage_warning === 'boolean'
      ? requested.provider_usage_warning : current.provider_usage_warning,
    agent_error: typeof requested?.agent_error === 'boolean'
      ? requested.agent_error : current.agent_error,
    session_offline: typeof requested?.session_offline === 'boolean'
      ? requested.session_offline : current.session_offline,
    rate_limit_cleared: typeof requested?.rate_limit_cleared === 'boolean'
      ? requested.rate_limit_cleared : current.rate_limit_cleared,
    completion_sound: typeof requested?.completion_sound === 'boolean'
      ? requested.completion_sound : current.completion_sound,
    completion_haptic: typeof requested?.completion_haptic === 'boolean'
      ? requested.completion_haptic : current.completion_haptic,
  };
  db.prepare(`
    INSERT INTO notification_preferences
      (email, permission_required, agent_ready, turn_ready, goal_completed, goal_attention, provider_usage_warning,
       agent_error, session_offline, rate_limit_cleared, completion_sound, completion_haptic, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      permission_required = excluded.permission_required,
      agent_ready = excluded.agent_ready,
      turn_ready = excluded.turn_ready,
      goal_completed = excluded.goal_completed,
      goal_attention = excluded.goal_attention,
      provider_usage_warning = excluded.provider_usage_warning,
      agent_error = excluded.agent_error,
      session_offline = excluded.session_offline,
      rate_limit_cleared = excluded.rate_limit_cleared,
      completion_sound = excluded.completion_sound,
      completion_haptic = excluded.completion_haptic,
      updated_at = excluded.updated_at
  `).run(
    email,
    preferences.permission_required ? 1 : 0,
    preferences.agent_ready ? 1 : 0,
    preferences.turn_ready ? 1 : 0,
    preferences.goal_completed ? 1 : 0,
    preferences.goal_attention ? 1 : 0,
    preferences.provider_usage_warning ? 1 : 0,
    preferences.agent_error ? 1 : 0,
    preferences.session_offline ? 1 : 0,
    preferences.rate_limit_cleared ? 1 : 0,
    preferences.completion_sound ? 1 : 0,
    preferences.completion_haptic ? 1 : 0,
  );
  return preferences;
}

function sessionPreferencesForEmail(email) {
  if (!email) return {};
  const rows = db.prepare(`
    SELECT session_id, display_name, archived, muted, pin_order
    FROM session_preferences
    WHERE email = ?
    ORDER BY updated_at DESC
  `).all(email);
  return Object.fromEntries(rows.map(row => [row.session_id, {
    display_name: row.display_name || '',
    archived: !!row.archived,
    muted: !!row.muted,
    pinned: Number(row.pin_order) > 0,
    pin_order: Number(row.pin_order) > 0 ? Number(row.pin_order) : 0,
  }]));
}

function saveSessionPreference(email, sessionId, requested) {
  const current = sessionPreferencesForEmail(email)[sessionId] || {
    display_name: '', archived: false, muted: false, pinned: false, pin_order: 0,
  };
  const displayName = requested.display_name === undefined
    ? current.display_name
    : String(requested.display_name || '').trim().slice(0, 100);
  let pinOrder = Number(current.pin_order) > 0 ? Number(current.pin_order) : 0;
  if (requested.pinned === false) pinOrder = 0;
  if (requested.pinned === true && pinOrder === 0) {
    pinOrder = Number(db.prepare(`
      SELECT COALESCE(MAX(pin_order), 0) + 1 AS next_order
      FROM session_preferences
      WHERE email = ?
    `).get(email)?.next_order || 1);
  }
  const preference = {
    display_name: displayName,
    archived: typeof requested.archived === 'boolean' ? requested.archived : current.archived,
    muted: typeof requested.muted === 'boolean' ? requested.muted : current.muted,
    pinned: pinOrder > 0,
    pin_order: pinOrder > 0 ? pinOrder : 0,
  };
  db.prepare(`
    INSERT INTO session_preferences (email, session_id, display_name, archived, muted, pin_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email, session_id) DO UPDATE SET
      display_name = excluded.display_name,
      archived = excluded.archived,
      muted = excluded.muted,
      pin_order = excluded.pin_order,
      updated_at = excluded.updated_at
  `).run(email, sessionId, preference.display_name || null,
    preference.archived ? 1 : 0, preference.muted ? 1 : 0, preference.pin_order);
  return preference;
}

// ── Automations table ────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'General',
    prompt      TEXT    NOT NULL,
    schedule    TEXT    NOT NULL DEFAULT 'daily',
    cron_hour   INTEGER NOT NULL DEFAULT 9,
    cron_minute INTEGER NOT NULL DEFAULT 0,
    cron_days   TEXT    NOT NULL DEFAULT '1,2,3,4,5',
    target_agent_type TEXT NOT NULL DEFAULT 'claude',
    target_session TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_resume_jobs (
    session_id       TEXT PRIMARY KEY,
    goal_fingerprint TEXT NOT NULL,
    goal_objective   TEXT NOT NULL,
    reset_hint       TEXT NOT NULL,
    reset_at         TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'pending',
    cycle_cleared    INTEGER NOT NULL DEFAULT 0,
    attempts         INTEGER NOT NULL DEFAULT 0,
    next_attempt_at  TEXT,
    client_msg_id    TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_usage_resume_due
    ON usage_resume_jobs(state, next_attempt_at, reset_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_resume_client_msg
    ON usage_resume_jobs(client_msg_id) WHERE client_msg_id IS NOT NULL;
`);
const scheduledSends = new ScheduledSendStore(db);
const goalNotifications = new GoalNotificationCoordinator(db);
const sessionAliases = new SessionAliasReconciler(db);

// ── Session metadata table — persists workspace info for resume ───────────────
const RELAY_VISIBLE_MESSAGE_KINDS = new Set([
  'user', 'assistant', 'tool', 'tool_result', 'permission', 'permission_prompt',
  'question', 'question_prompt', 'error', 'system',
]);

db.exec(`
  CREATE TABLE IF NOT EXISTS session_meta (
    session_id     TEXT PRIMARY KEY,
    workspace_path TEXT,
    project_root   TEXT,
    workspace_name TEXT,
    agent_type     TEXT,
    session_kind   TEXT NOT NULL DEFAULT 'operator',
    is_test_session INTEGER NOT NULL DEFAULT 0,
    project_group  TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS session_latest_visible_message (
    session_id     TEXT PRIMARY KEY,
    message_row_id INTEGER,
    message_id     TEXT,
    message_at     REAL,
    kind           TEXT,
    source         TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
let sessionNoiseBackfillRequired = false;
try {
  const sessionMetaCols = new Set(db.pragma('table_info(session_meta)').map(r => r.name));
  if (!sessionMetaCols.has('cli_session_id')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN cli_session_id TEXT`);
  }
  if (!sessionMetaCols.has('project_root')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN project_root TEXT`);
  }
  if (!sessionMetaCols.has('session_kind')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'operator'`);
    sessionNoiseBackfillRequired = true;
  }
  if (!sessionMetaCols.has('is_test_session')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN is_test_session INTEGER NOT NULL DEFAULT 0`);
    sessionNoiseBackfillRequired = true;
  }
  if (!sessionMetaCols.has('project_group')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN project_group TEXT`);
  }
} catch {}
if (sessionNoiseBackfillRequired) {
  const legacyRows = db.prepare(`
    SELECT session_id, workspace_path, project_root, workspace_name, agent_type
    FROM session_meta
  `).all();
  const updateNoise = db.prepare(`
    UPDATE session_meta
    SET session_kind = ?, is_test_session = ?, project_group = COALESCE(?, project_group)
    WHERE session_id = ?
  `);
  db.transaction(rows => rows.forEach(row => {
    const noise = sessionNoiseMetadata(row);
    updateNoise.run(noise.session_kind, noise.is_test_session ? 1 : 0, noise.project_group || null, row.session_id);
  }))(legacyRows);
  log('info', 'db', 'Backfilled legacy session noise metadata', {
    rows: legacyRows.length,
    validator_sessions: legacyRows.filter(sessionIsTestSession).length,
  });
}

// Full-text transcript search is maintained independently from the messages table so
// the one-time index build can yield between small batches. New writes are indexed by
// triggers immediately; interrupted backfills resume from their durable cursor.
const transcriptSearchTableExisted = !!db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'"
).get();
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS message_fts_state (
    singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
    cursor_id  INTEGER NOT NULL DEFAULT 0,
    complete   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT OR IGNORE INTO message_fts_state (singleton, cursor_id, complete) VALUES (1, 0, 0);
  CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT OR REPLACE INTO message_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    DELETE FROM message_fts WHERE rowid = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
    DELETE FROM message_fts WHERE rowid = old.id;
    INSERT OR REPLACE INTO message_fts(rowid, content) VALUES (new.id, new.content);
  END;
`);
if (!transcriptSearchTableExisted) {
  db.prepare('UPDATE message_fts_state SET cursor_id = 0, complete = 0, updated_at = datetime(\'now\') WHERE singleton = 1').run();
}
const stmtTranscriptSearchState = db.prepare(
  'SELECT cursor_id, complete FROM message_fts_state WHERE singleton = 1'
);
const stmtTranscriptSearchBackfillRows = db.prepare(
  'SELECT id, content FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?'
);
const TRANSCRIPT_SEARCH_BACKFILL_BATCH_SIZE = 100;
const TRANSCRIPT_SEARCH_BACKFILL_DELAY_MS = 50;
const stmtTranscriptSearchInsert = db.prepare(
  'INSERT OR REPLACE INTO message_fts(rowid, content) VALUES (?, ?)'
);
const stmtTranscriptSearchAdvance = db.prepare(
  'UPDATE message_fts_state SET cursor_id = ?, complete = ?, updated_at = datetime(\'now\') WHERE singleton = 1'
);
const insertTranscriptSearchBatch = db.transaction((rows) => {
  for (const row of rows) stmtTranscriptSearchInsert.run(row.id, row.content || '');
});
let transcriptSearchBackfillScheduled = false;
function runTranscriptSearchBackfillBatch() {
  transcriptSearchBackfillScheduled = false;
  const state = stmtTranscriptSearchState.get() || { cursor_id: 0, complete: 0 };
  if (state.complete) return;
  try {
    const rows = stmtTranscriptSearchBackfillRows.all(
      Number(state.cursor_id) || 0,
      TRANSCRIPT_SEARCH_BACKFILL_BATCH_SIZE,
    );
    if (rows.length === 0) {
      stmtTranscriptSearchAdvance.run(Number(state.cursor_id) || 0, 1);
      log('info', 'search', 'Transcript FTS5 backfill complete', { cursor_id: Number(state.cursor_id) || 0 });
      return;
    }
    insertTranscriptSearchBatch(rows);
    stmtTranscriptSearchAdvance.run(rows[rows.length - 1].id, 0);
  } catch (e) {
    log('error', 'search', 'Transcript FTS5 backfill batch failed', { err: e.message });
    setTimeout(scheduleTranscriptSearchBackfill, 5000);
    return;
  }
  scheduleTranscriptSearchBackfill();
}
function scheduleTranscriptSearchBackfill() {
  if (transcriptSearchBackfillScheduled) return;
  transcriptSearchBackfillScheduled = true;
  setTimeout(runTranscriptSearchBackfillBatch, TRANSCRIPT_SEARCH_BACKFILL_DELAY_MS);
}

// ── Live schema migrations — must run BEFORE creating indexes on new columns ──
const existingCols = new Set(db.pragma('table_info(messages)').map(r => r.name));
if (!existingCols.has('client_msg_id'))
  db.exec(`ALTER TABLE messages ADD COLUMN client_msg_id TEXT`);
if (!existingCols.has('status'))
  db.exec(`ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'delivered'`);
if (!existingCols.has('sequence'))
  db.exec(`ALTER TABLE messages ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0`);
if (!existingCols.has('content_blocks'))
  db.exec(`ALTER TABLE messages ADD COLUMN content_blocks TEXT`);
if (!existingCols.has('source_message_id'))
  db.exec(`ALTER TABLE messages ADD COLUMN source_message_id TEXT`);
if (!existingCols.has('source_cursor'))
  db.exec(`ALTER TABLE messages ADD COLUMN source_cursor TEXT`);
if (!existingCols.has('source'))
  db.exec(`ALTER TABLE messages ADD COLUMN source TEXT`);
if (!existingCols.has('accepted_at'))
  db.exec(`ALTER TABLE messages ADD COLUMN accepted_at TEXT`);
if (!existingCols.has('launch_accepted_at'))
  db.exec(`ALTER TABLE messages ADD COLUMN launch_accepted_at TEXT`);
if (!existingCols.has('delivered_at'))
  db.exec(`ALTER TABLE messages ADD COLUMN delivered_at TEXT`);
if (!existingCols.has('agent_started_at'))
  db.exec(`ALTER TABLE messages ADD COLUMN agent_started_at TEXT`);
if (!existingCols.has('native_receipt'))
  db.exec(`ALTER TABLE messages ADD COLUMN native_receipt TEXT`);
if (!existingCols.has('process_epoch'))
  db.exec(`ALTER TABLE messages ADD COLUMN process_epoch TEXT`);
if (!existingCols.has('failure_code'))
  db.exec(`ALTER TABLE messages ADD COLUMN failure_code TEXT`);
if (!existingCols.has('failure_reason'))
  db.exec(`ALTER TABLE messages ADD COLUMN failure_reason TEXT`);
if (!existingCols.has('failure_native_attempted'))
  db.exec(`ALTER TABLE messages ADD COLUMN failure_native_attempted INTEGER`);
if (!existingCols.has('failure_retryable'))
  db.exec(`ALTER TABLE messages ADD COLUMN failure_retryable INTEGER`);
if (!existingCols.has('delivery_attempt'))
  db.exec(`ALTER TABLE messages ADD COLUMN delivery_attempt INTEGER NOT NULL DEFAULT 1`);
const existingSendReceiptCols = new Set(db.pragma('table_info(send_receipts)').map(r => r.name));
if (!existingSendReceiptCols.has('failure_reason'))
  db.exec(`ALTER TABLE send_receipts ADD COLUMN failure_reason TEXT`);
if (!existingSendReceiptCols.has('failure_native_attempted'))
  db.exec(`ALTER TABLE send_receipts ADD COLUMN failure_native_attempted INTEGER`);
if (!existingSendReceiptCols.has('failure_retryable'))
  db.exec(`ALTER TABLE send_receipts ADD COLUMN failure_retryable INTEGER`);
if (!existingSendReceiptCols.has('content'))
  db.exec(`ALTER TABLE send_receipts ADD COLUMN content TEXT`);
if (!existingSendReceiptCols.has('delivery_attempt'))
  db.exec(`ALTER TABLE send_receipts ADD COLUMN delivery_attempt INTEGER NOT NULL DEFAULT 1`);
// The revalidation gate is evaluated before any native adapter is entered.
// Make that one legacy failure class explicitly retry-safe; every other
// historical failure remains fail-closed unless it carried exact safety flags.
// This migration is receipt-led and primary-key bounded so relay startup never
// scans the multi-gigabyte transcript table for a handful of durable sends.
const legacySendAttemptMigration = backfillRetrySafeLegacyFailures(db);
if (legacySendAttemptMigration.receipt_content_rows_changed
  || legacySendAttemptMigration.receipt_rows_changed
  || legacySendAttemptMigration.message_rows_changed
  || legacySendAttemptMigration.message_rows_restored
  || legacySendAttemptMigration.attempt_rows_inserted) {
  log('info', 'db', 'Backfilled retry-safe send attempt state', legacySendAttemptMigration);
}

// Indexes that reference migrated columns — safe to create now
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sequence ON messages(session, sequence)`); } catch {}
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_msg
    ON messages(client_msg_id) WHERE client_msg_id IS NOT NULL
  `);
} catch {}
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_message
    ON messages(session, source_message_id) WHERE source_message_id IS NOT NULL
  `);
} catch {}

// ── Firebase Admin + FCM (A12-02) ─────────────────────────────────────────────

let firebaseApp = null;
if (FIREBASE_SERVICE_ACCOUNT) {
  try {
    const svcAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT, 'utf8'));
    firebaseApp = admin.initializeApp({ credential: admin.credential.cert(svcAccount) });
    log('info', 'fcm', 'Firebase Admin initialized');
  } catch (e) {
    log('warn', 'fcm', 'Firebase Admin init failed — push notifications disabled', { err: e.message });
  }
}

const PUSH_TYPE_CONFIG = Object.freeze({
  permission_required: { category: 'permission_required', channelId: 'permission-required' },
  goal_completed:       { category: 'goal_completed',     channelId: 'goal-completed' },
  goal_attention:       { category: 'goal_attention',     channelId: 'goal-attention' },
  provider_usage_threshold: { category: 'provider_usage_warning', channelId: 'usage-warning', androidEnabled: false },
  agent_error:          { category: 'agent_error',        channelId: 'agent-error' },
  rate_limit_active:    { category: 'agent_error',        channelId: 'agent-error' },
  session_offline:      { category: 'session_offline',    channelId: 'session-offline' },
  proxy_offline:        { category: 'session_offline',    channelId: 'session-offline' },
  proxy_recovered:      { category: 'session_offline',    channelId: 'session-offline' },
  proxy_watchdog_failed:{ category: 'agent_error',        channelId: 'agent-error' },
  app_update_pass:      { category: 'agent_ready',        channelId: 'agent-idle' },
  app_update_fail:      { category: 'agent_error',        channelId: 'agent-error' },
  rate_limit_cleared:   { category: 'rate_limit_cleared', channelId: 'rate-limit' },
  rate_limit_resumed:   { category: 'rate_limit_cleared', channelId: 'rate-limit' },
});

async function sendPushNotification(title, body, data = {}) {
  if (FORBIDDEN_COMPLETION_NOTIFICATION_TYPES.has(String(data.type || '').trim())
    || /session completed/i.test(`${title || ''} ${body || ''}`)) {
    log('info', 'push', 'Legacy or unsupported completion notification suppressed', { type: data.type });
    return;
  }
  // FCM data payload values must be strings
  const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const pushConfig = PUSH_TYPE_CONFIG[data.type] || null;
  const category = pushConfig?.category || null;
  const sessionId = data.session_id || data.session || '';
  const semanticEvent = data.dedupe_key ? {
    type: 'semantic_notification',
    event_type: data.type,
    category: data.category || data.type,
    dedupe_key: data.dedupe_key,
    session_id: sessionId,
    title,
    body,
    created_at: data.created_at,
    harness: data.harness,
    goal_affiliation: data.goal_affiliation,
    native_event_id: data.native_event_id,
    turn_id: data.turn_id,
  } : null;
  const destinationId = value => crypto.createHash('sha256')
    .update(String(value || ''), 'utf8').digest('hex').slice(0, 12);
  const recordSemanticStage = (stage, email, transport, options = {}) => {
    if (!semanticEvent) return;
    goalNotifications.recordStage(semanticEvent, stage, {
      reasonCode: options.reasonCode,
      preferenceRevision: notificationPreferenceRevisionForEmail(email),
      clientChannel: transport,
      metadata: {
        client_id: options.destination ? destinationId(options.destination) : '',
        delivery_result: options.deliveryResult || '',
      },
    });
  };
  const isAllowed = (email, transport) => {
    if (semanticEvent) {
      const policy = semanticNotificationPolicyForEmail(semanticEvent, email);
      if (!policy.allowed) recordSemanticStage('suppressed', email, transport, { reasonCode: policy.reason });
      return policy.allowed;
    }
    if (sessionId && sessionIdIsTestSession(sessionId)) {
      log('info', transport, 'Push skipped for validator session', { type: data.type, session_id: sessionId });
      return false;
    }
    const preferences = notificationPreferencesForEmail(email);
    if (category && !preferences[category]) {
      log('info', transport, 'Push skipped by notification preference', { type: data.type });
      return false;
    }
    if (sessionId && sessionPreferencesForEmail(email)[sessionId]?.muted) {
      log('info', transport, 'Push skipped because session is muted', { type: data.type, session_id: sessionId });
      return false;
    }
    return true;
  };

  const staleTokens = [];
  if (firebaseApp) {
    const rows = db.prepare('SELECT token, email FROM fcm_tokens').all();
    for (const { token, email } of rows) {
      if (pushConfig?.androidEnabled === false) {
        recordSemanticStage('suppressed', email, 'fcm', { reasonCode: 'android_channel_unavailable' });
        continue;
      }
      if (!isAllowed(email, 'fcm')) continue;
      try {
        await admin.messaging().send({
          token,
          notification: { title, body },
          data:         strData,
          android: {
            priority:     'high',
            notification: { channel_id: pushConfig?.channelId || 'agent-idle' },
          },
        });
        log('info', 'fcm', 'Push sent', { title, type: data.type });
        recordSemanticStage('dispatched', email, 'fcm', {
          destination: token,
          deliveryResult: 'provider_accepted',
        });
      } catch (e) {
        if (
          e.code === 'messaging/registration-token-not-registered' ||
          e.code === 'messaging/invalid-registration-token'
        ) {
          staleTokens.push(token);
        } else {
          log('warn', 'fcm', 'Push send failed', { err: e.message });
        }
        recordSemanticStage('suppressed', email, 'fcm', {
          reasonCode: 'provider_rejected',
          destination: token,
          deliveryResult: String(e.code || 'error'),
        });
      }
    }
  }

  for (const token of staleTokens) {
    db.prepare('DELETE FROM fcm_tokens WHERE token = ?').run(token);
    log('info', 'fcm', 'Removed stale FCM token');
  }

  const staleEndpoints = [];
  const webRows = db.prepare('SELECT email, endpoint, p256dh, auth FROM web_push_subscriptions').all();
  for (const subscription of webRows) {
    if (!isAllowed(subscription.email, 'web-push')) continue;
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ title, body, data }), { TTL: 300, urgency: 'high' });
      log('info', 'web-push', 'Push sent', { title, type: data.type });
      recordSemanticStage('dispatched', subscription.email, 'web-push', {
        destination: subscription.endpoint,
        deliveryResult: 'provider_accepted',
      });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        staleEndpoints.push(subscription.endpoint);
      } else {
        log('warn', 'web-push', 'Push send failed', { status: e.statusCode, err: e.message });
      }
      recordSemanticStage('suppressed', subscription.email, 'web-push', {
        reasonCode: 'provider_rejected',
        destination: subscription.endpoint,
        deliveryResult: String(e.statusCode || 'error'),
      });
    }
  }
  for (const endpoint of staleEndpoints) {
    db.prepare('DELETE FROM web_push_subscriptions WHERE endpoint = ?').run(endpoint);
    log('info', 'web-push', 'Removed stale Web Push subscription');
  }
}

// ── Per-session sequence counter ──────────────────────────────────────────────
// Lazy-loaded from DB; incremented in memory and persisted on each insert.

const sessionSeq = new Map();
const stmtMaxSequence = db.prepare(
  'SELECT COALESCE(MAX(sequence), 0) AS s FROM messages WHERE session = ?'
);

function nextSeq(sessionId) {
  const current = sessionSeq.has(sessionId)
    ? sessionSeq.get(sessionId)
    : stmtMaxSequence.get(sessionId).s;
  const n = current + 1;
  setBoundedMap(sessionSeq, sessionId, n, 4096);
  return n;
}

function getIncrementalHistoryPlan(sessionId, incomingRows, existingCount, tailLimit = 50) {
  if (!Array.isArray(incomingRows) || incomingRows.length < existingCount) return null;
  const tailSize = Math.min(Math.max(0, existingCount), Math.max(1, tailLimit));
  const existingTail = tailSize > 0 ? getReconciliationHistoryRowsTail(sessionId, tailSize) : [];
  return buildIncrementalHistoryPlan(existingCount, existingTail, incomingRows);
}

function historiesTailLikelyMatch(sessionId, incomingRows, tailLimit = 50) {
  const existingCount = getReconciliationHistoryCount(sessionId);
  if (existingCount !== incomingRows.length) {
    return { match: false, existingCount };
  }
  const limit = Math.min(Math.max(1, tailLimit), incomingRows.length);
  if (limit <= 0) return { match: true, existingCount };
  const existingTail = getReconciliationHistoryRowsTail(sessionId, limit);
  const incomingTail = incomingRows.slice(-limit);
  return { match: historyRowsMatch(existingTail, incomingTail), existingCount };
}

function normalizeBrowserEchoContent(content) {
  return String(content || '')
    .replace(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\s*$/i, '')
    .replace(/\s+/g, '')
    .trim();
}

function isRecentBrowserUserEcho(sessionId, content) {
  const normalized = normalizeBrowserEchoContent(content);
  if (!normalized) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = stmtRecentBrowserUserMessages.all(sessionId);
  return rows.some((row) => (
    nowSec - Number(row.ts || 0) <= BROWSER_ECHO_DEDUP_WINDOW_SEC &&
    normalizeBrowserEchoContent(row.content) === normalized
  ));
}

// ── Prepared statements ───────────────────────────────────────────────────────

function serializeContentBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  try {
    return JSON.stringify(blocks);
  } catch {
    return null;
  }
}

function normalizeSourceMessageId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizeSourceName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 64 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function canonicalVisibleMessageKind(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!RELAY_VISIBLE_MESSAGE_KINDS.has(normalized)) return null;
  if (normalized === 'permission_prompt') return 'permission';
  if (normalized === 'question_prompt') return 'question';
  return normalized;
}

function canonicalLatestMessageSource(value) {
  const normalized = String(normalizeSourceName(value) || 'relay_persisted')
    .trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_.:/]/g, '');
  return normalized || 'relay_persisted';
}

function relayVisibleMessageId(rowId) {
  const numeric = Number(rowId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return `relay:${String(numeric).padStart(20, '0')}`;
}

function durableVisibleMessageId(rowId, sourceMessageId = null) {
  return normalizeSourceMessageId(sourceMessageId) || relayVisibleMessageId(rowId);
}

function serializeSourceCursor(cursor) {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
  try {
    const encoded = JSON.stringify(cursor);
    return Buffer.byteLength(encoded, 'utf8') <= 4096 ? encoded : null;
  } catch {
    return null;
  }
}

function proxyMessageTimestampSeconds(msg) {
  const values = [msg?.message?.created_at, msg?.created_at, msg?.timestamp, msg?.ts];
  for (const value of values) {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric / 1000 : numeric;
      continue;
    }
    const parsed = new Date(value || '').getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed / 1000;
  }
  return 0;
}

function timestampSecondsIso(value) {
  return Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function hydrateMessageRow(row) {
  if (!row) return row;
  const hydrated = { ...row };
  if (hydrated.client_msg_id && !hydrated.client_message_id) {
    hydrated.client_message_id = hydrated.client_msg_id;
  }
  if (typeof hydrated.content_blocks === 'string' && hydrated.content_blocks.trim()) {
    try {
      hydrated.content_blocks = JSON.parse(hydrated.content_blocks);
    } catch {
      hydrated.content_blocks = null;
    }
  } else {
    hydrated.content_blocks = null;
  }
  if (!hydrated.content_blocks) delete hydrated.content_blocks;
  if (typeof hydrated.source_cursor === 'string' && hydrated.source_cursor.trim()) {
    try {
      hydrated.source_cursor = JSON.parse(hydrated.source_cursor);
    } catch {
      hydrated.source_cursor = null;
    }
  }
  if (!hydrated.source_cursor || typeof hydrated.source_cursor !== 'object' || Array.isArray(hydrated.source_cursor)) {
    delete hydrated.source_cursor;
  }
  if (!hydrated.source_message_id) delete hydrated.source_message_id;
  if (!hydrated.source) delete hydrated.source;
  if (typeof hydrated.native_receipt === 'string' && hydrated.native_receipt.trim()) {
    try {
      hydrated.native_receipt = JSON.parse(hydrated.native_receipt);
    } catch {
      hydrated.native_receipt = null;
    }
  }
  if (!hydrated.native_receipt) delete hydrated.native_receipt;
  if (hydrated.failure_native_attempted != null) {
    hydrated.failure_native_attempted = Number(hydrated.failure_native_attempted) === 1;
  }
  if (hydrated.failure_retryable != null) {
    hydrated.failure_retryable = Number(hydrated.failure_retryable) === 1;
  }
  hydrated.delivery_attempt = Math.max(1, Number(hydrated.delivery_attempt) || 1);
  return hydrated;
}

const stmtInsert = db.prepare(
  `INSERT INTO messages (session, role, content, client_msg_id, status, sequence, content_blocks, source_message_id, source_cursor, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertWithTs = db.prepare(
  `INSERT INTO messages (session, role, content, client_msg_id, status, sequence, ts, content_blocks, source_message_id, source_cursor, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertIdempotent = db.prepare(
  `INSERT OR IGNORE INTO messages (session, role, content, client_msg_id, status, sequence, content_blocks, source_message_id, source_cursor, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertIdempotentWithTs = db.prepare(
  `INSERT OR IGNORE INTO messages (session, role, content, client_msg_id, status, sequence, ts, content_blocks, source_message_id, source_cursor, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

// Helper: insert a message, honoring proxy-supplied ts when available so
// historical messages render with their original timestamps (otherwise the
// table default unixepoch() makes every imported message look "now").
function insertMessage(session, role, content, clientMsgId, status, sequence, ts, contentBlocks, sourceMessageId = null, sourceCursor = null, source = null) {
  const blocksJson = serializeContentBlocks(contentBlocks);
  const cursorJson = serializeSourceCursor(sourceCursor);
  let info;
  if (Number.isFinite(ts) && ts >= 0) {
    info = stmtInsertWithTs.run(session, role, content, clientMsgId, status, sequence, ts, blocksJson, sourceMessageId, cursorJson, source);
  } else {
    info = stmtInsert.run(session, role, content, clientMsgId, status, sequence, blocksJson, sourceMessageId, cursorJson, source);
  }
  recordLatestVisibleMessageInsert(info, session, role, ts, source, sourceMessageId);
  return info;
}
function insertMessageIdempotent(session, role, content, clientMsgId, status, sequence, ts, contentBlocks, sourceMessageId = null, sourceCursor = null, source = null) {
  const blocksJson = serializeContentBlocks(contentBlocks);
  const cursorJson = serializeSourceCursor(sourceCursor);
  let info;
  if (Number.isFinite(ts) && ts >= 0) {
    info = stmtInsertIdempotentWithTs.run(session, role, content, clientMsgId, status, sequence, ts, blocksJson, sourceMessageId, cursorJson, source);
  } else {
    info = stmtInsertIdempotent.run(session, role, content, clientMsgId, status, sequence, blocksJson, sourceMessageId, cursorJson, source);
  }
  recordLatestVisibleMessageInsert(info, session, role, ts, source, sourceMessageId);
  return info;
}
function insertHistoryMessage(session, message) {
  const sourceMessageId = normalizeSourceMessageId(message?.source_message_id);
  const insert = sourceMessageId ? insertMessageIdempotent : insertMessage;
  return insert(
    session,
    message?.role,
    message?.content,
    null,
    message?.role === 'user' ? 'recorded' : 'delivered',
    nextSeq(session),
    proxyMessageTimestampSeconds(message),
    message?.content_blocks,
    sourceMessageId,
    message?.source_cursor,
    normalizeSourceName(message?.source),
  );
}
const insertConversationRowsBatch = db.transaction((targetSession, messages, idempotent) => {
  let inserted = 0;
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const seq = nextSeq(targetSession);
    const insert = idempotent ? insertMessageIdempotent : insertMessage;
    insert(
      targetSession,
      message.role,
      message.content,
      null,
      message.role === 'user' ? 'recorded' : 'delivered',
      seq,
      proxyMessageTimestampSeconds(message),
      message.content_blocks,
    );
    inserted++;
  }
  return inserted;
});
const stmtTailRoleContent = db.prepare(
  'SELECT role, content FROM messages WHERE session = ? ORDER BY id DESC LIMIT 1'
);
const stmtSourceMessageExists = db.prepare(
  'SELECT 1 AS found FROM messages WHERE session = ? AND source_message_id = ? LIMIT 1'
);
const stmtGetTranscriptSourceCursor = db.prepare(
  `SELECT generation, message_index, end_offset, file_size, source_message_id
   FROM transcript_source_cursors WHERE session = ? AND source = ?`
);
const stmtUpsertTranscriptSourceCursor = db.prepare(
  `INSERT INTO transcript_source_cursors
     (session, source, generation, message_index, end_offset, file_size, source_message_id, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
   ON CONFLICT(session, source) DO UPDATE SET
     generation = excluded.generation,
     message_index = excluded.message_index,
     end_offset = excluded.end_offset,
     file_size = excluded.file_size,
     source_message_id = excluded.source_message_id,
     updated_at = unixepoch()`
);
const stmtDeleteTranscriptSourceCursors = db.prepare(
  'DELETE FROM transcript_source_cursors WHERE session = ?'
);
const pendingTranscriptSourceCursors = new Map();

function transcriptSourceCursorKey(sessionId, source) {
  return `${sessionId}\u0000${source}`;
}

function evaluateProxyTranscriptCursor(sessionId, source, sourceCursor) {
  const key = transcriptSourceCursorKey(sessionId, source);
  const previous = pendingTranscriptSourceCursors.get(key)
    || stmtGetTranscriptSourceCursor.get(sessionId, source)
    || null;
  return evaluateTranscriptCursor(previous, sourceCursor);
}

function recordTranscriptSourceCursor(entry) {
  const cursor = normalizeTranscriptCursor(entry.sourceCursor);
  if (!cursor || !entry.source) return;
  stmtUpsertTranscriptSourceCursor.run(
    entry.id,
    entry.source,
    cursor.generation,
    cursor.message_index,
    cursor.end_offset,
    cursor.file_size,
    entry.sourceMessageId,
  );
}

function rebuildTranscriptSourceCursors(sessionId, messages) {
  stmtDeleteTranscriptSourceCursors.run(sessionId);
  for (const key of pendingTranscriptSourceCursors.keys()) {
    if (key.startsWith(`${sessionId}\u0000`)) pendingTranscriptSourceCursors.delete(key);
  }
  const latestBySource = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const source = normalizeSourceName(message?.source);
    const cursor = normalizeTranscriptCursor(message?.source_cursor);
    if (!source || !cursor) continue;
    const previous = latestBySource.get(source);
    if (!previous || cursor.message_index > previous.cursor.message_index) {
      latestBySource.set(source, {
        cursor,
        sourceMessageId: normalizeSourceMessageId(message?.source_message_id),
      });
    }
  }
  for (const [source, entry] of latestBySource) {
    stmtUpsertTranscriptSourceCursor.run(
      sessionId,
      source,
      entry.cursor.generation,
      entry.cursor.message_index,
      entry.cursor.end_offset,
      entry.cursor.file_size,
      entry.sourceMessageId,
    );
  }
}

// Proxy snapshots already use transactions, but live proxy messages arrive as
// bursts of individual WebSocket frames. Collect frames from one event-loop
// turn, commit them atomically, then forward in the same order. This bounds
// persistence delay to one microtask while avoiding one transaction commit per
// frame.
const pendingProxyMessageWrites = [];
const pendingProxyMessageTails = new Map();
const pendingProxySourceMessageIds = new Set();
let proxyMessageFlushScheduled = false;
const persistProxyMessageBatch = db.transaction((batch) => {
  for (const entry of batch) {
    const insert = entry.sourceMessageId ? insertMessageIdempotent : insertMessage;
    const info = insert(
      entry.id,
      entry.role,
      entry.content,
      null,
      'delivered',
      entry.seq,
      entry.messageTs,
      entry.contentBlocks,
      entry.sourceMessageId,
      entry.sourceCursor,
      entry.source,
    );
    entry.persisted = info.changes > 0;
    if (entry.persisted) {
      entry.rowId = info.lastInsertRowid;
      recordTranscriptSourceCursor(entry);
    }
  }
});

function isDuplicateProxyMessage(id, role, content, sourceMessageId = null) {
  if (sourceMessageId) {
    const key = `${id}\u0000${sourceMessageId}`;
    return pendingProxySourceMessageIds.has(key) || !!stmtSourceMessageExists.get(id, sourceMessageId);
  }
  const pendingTail = pendingProxyMessageTails.get(id);
  if (pendingTail) return pendingTail.role === role && pendingTail.content === content;
  const storedTail = stmtTailRoleContent.get(id);
  return !!storedTail && storedTail.role === role && storedTail.content === content;
}

function flushProxyMessageWrites() {
  proxyMessageFlushScheduled = false;
  if (pendingProxyMessageWrites.length === 0) return;
  const batch = pendingProxyMessageWrites.splice(0, pendingProxyMessageWrites.length);
  try {
    persistProxyMessageBatch(batch);
  } catch (error) {
    log('error', 'db', 'Proxy message batch insert failed; retrying individually', {
      messages: batch.length,
      err: error.message,
    });
    new Set(batch.map(entry => entry.id)).forEach(recomputeLatestVisibleMessage);
    for (const entry of batch) {
      entry.rowId = undefined;
      entry.persisted = false;
      try {
        const insert = entry.sourceMessageId ? insertMessageIdempotent : insertMessage;
        const info = insert(
          entry.id,
          entry.role,
          entry.content,
          null,
          entry.role === 'user' ? 'recorded' : 'delivered',
          entry.seq,
          entry.messageTs,
          entry.contentBlocks,
          entry.sourceMessageId,
          entry.sourceCursor,
          entry.source,
        );
        entry.persisted = info.changes > 0;
        if (entry.persisted) {
          entry.rowId = info.lastInsertRowid;
          recordTranscriptSourceCursor(entry);
        }
      } catch (insertError) {
        log('error', 'db', 'Insert failed', { session: entry.id, err: insertError.message });
      }
    }
  }
  for (const entry of batch) {
    pendingProxyMessageTails.delete(entry.id);
    if (entry.sourceMessageId) pendingProxySourceMessageIds.delete(`${entry.id}\u0000${entry.sourceMessageId}`);
    if (entry.source) pendingTranscriptSourceCursors.delete(transcriptSourceCursorKey(entry.id, entry.source));
    if (!entry.persisted) continue;
    touchSession(entry.id);
    log('info', 'msg', `${entry.role} message`, {
      session: entry.id,
      seq: entry.seq,
      content_sha256: crypto.createHash('sha256').update(String(entry.content || ''), 'utf8').digest('hex'),
      content_bytes: Buffer.byteLength(String(entry.content || ''), 'utf8'),
    });
    const latencyTrace = entry.latencyTrace
      ? latencyTraceForRelayBroadcast(
          entry.latencyTrace,
          Date.now(),
          { source: 'relay_persisted_message' },
        )
      : null;
    broadcastToBrowsers({
      type: 'message',
      session: entry.id,
      role: entry.role,
      content: entry.content,
      ...(entry.contentBlocks ? { content_blocks: entry.contentBlocks } : {}),
      sequence: entry.seq,
      server_message_id: entry.rowId,
      ts: entry.messageTs,
      ...(timestampSecondsIso(entry.messageTs) ? { created_at: timestampSecondsIso(entry.messageTs) } : {}),
      ...latestVisibleMessageProjection(entry.id),
      ...(entry.sourceMessageId ? { source_message_id: entry.sourceMessageId } : {}),
      ...(entry.sourceCursor ? { source_cursor: entry.sourceCursor } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(latencyTrace ? { latency_trace: latencyTrace } : {}),
    });
  }
}

function queueProxyMessageWrite(entry) {
  pendingProxyMessageWrites.push(entry);
  pendingProxyMessageTails.set(entry.id, { role: entry.role, content: entry.content });
  if (entry.sourceMessageId) pendingProxySourceMessageIds.add(`${entry.id}\u0000${entry.sourceMessageId}`);
  const normalizedCursor = normalizeTranscriptCursor(entry.sourceCursor);
  if (entry.source && normalizedCursor) {
    pendingTranscriptSourceCursors.set(transcriptSourceCursorKey(entry.id, entry.source), normalizedCursor);
  }
  if (proxyMessageFlushScheduled) return;
  proxyMessageFlushScheduled = true;
  queueMicrotask(flushProxyMessageWrites);
}
const DELIVERY_RECEIPT_OVERLAY_SQL = `
  EXISTS (
    SELECT 1 FROM send_receipts receipt_overlay
    WHERE receipt_overlay.server_message_id = messages.id
      AND receipt_overlay.status = 'failed'
      AND receipt_overlay.failure_native_attempted = 0
      AND receipt_overlay.failure_retryable = 1
  )
`;
const stmtDeleteSession = db.prepare(`
  DELETE FROM messages
  WHERE session = ? AND NOT (${DELIVERY_RECEIPT_OVERLAY_SQL})
`);
const stmtDeleteSessionSuffix = db.prepare(`
  DELETE FROM messages
  WHERE session = ? AND id >= ? AND NOT (${DELIVERY_RECEIPT_OVERLAY_SQL})
`);

// ── Session history queries ─────────────────────────────────────────────────
// Returns distinct sessions with their first user message, message count, and timestamps.
const stmtSessionHistory = db.prepare(`
  SELECT
    m.session,
    MIN(CASE WHEN m.role = 'user' THEN m.content END) AS first_user_message,
    COUNT(*)                AS message_count,
    MIN(m.ts)               AS created_at,
    MAX(m.ts)               AS last_active_at,
    sm.workspace_path,
    sm.project_root,
    sm.workspace_name,
    sm.agent_type,
    sm.cli_session_id,
    sm.session_kind,
    sm.is_test_session,
    sm.project_group
  FROM messages m
  LEFT JOIN session_meta sm ON sm.session_id = m.session
  WHERE (? = 1 OR COALESCE(sm.is_test_session, 0) = 0)
  GROUP BY m.session
  HAVING message_count > 0
  ORDER BY last_active_at DESC
  LIMIT ?
`);
const stmtUpsertSessionMeta = db.prepare(`
  INSERT INTO session_meta (session_id, workspace_path, project_root, workspace_name, agent_type, cli_session_id, session_kind, is_test_session, project_group, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(session_id) DO UPDATE SET
    workspace_path = COALESCE(excluded.workspace_path, workspace_path),
    project_root   = COALESCE(excluded.project_root, project_root),
    workspace_name = COALESCE(excluded.workspace_name, workspace_name),
    agent_type     = COALESCE(excluded.agent_type, agent_type),
    cli_session_id = COALESCE(excluded.cli_session_id, cli_session_id),
    session_kind   = excluded.session_kind,
    is_test_session = excluded.is_test_session,
    project_group  = COALESCE(excluded.project_group, project_group),
    updated_at     = datetime('now')
`);
const stmtGetSessionMeta = db.prepare(
  `SELECT session_id, workspace_path, project_root, workspace_name, agent_type, cli_session_id,
          session_kind, is_test_session, project_group, updated_at
   FROM session_meta WHERE session_id = ?`
);
const persistSessionMetaBatch = db.transaction((sessions) => {
  let changed = 0;
  for (const session of sessions) {
    const id = typeof session === 'string' ? session : session?.session_id;
    if (!id || !session || typeof session !== 'object') continue;
    const noise = sessionNoiseMetadata(session);
    const next = {
      workspace_path: session.workspace_path || null,
      project_root: session.project_root || null,
      workspace_name: session.workspace_name || null,
      agent_type: session.agent_type || null,
      cli_session_id: session.cli_session_id || null,
      session_kind: noise.session_kind,
      is_test_session: noise.is_test_session ? 1 : 0,
      project_group: noise.project_group || null,
    };
    const existing = stmtGetSessionMeta.get(id);
    if (
      existing
      && existing.workspace_path === next.workspace_path
      && existing.project_root === next.project_root
      && existing.workspace_name === next.workspace_name
      && existing.agent_type === next.agent_type
      && existing.cli_session_id === next.cli_session_id
      && existing.session_kind === next.session_kind
      && Number(existing.is_test_session || 0) === next.is_test_session
      && existing.project_group === next.project_group
    ) continue;
    stmtUpsertSessionMeta.run(
      id,
      next.workspace_path,
      next.project_root,
      next.workspace_name,
      next.agent_type,
      next.cli_session_id,
      next.session_kind,
      next.is_test_session,
      next.project_group,
    );
    changed++;
  }
  return changed;
});
const stmtGetHistory     = db.prepare(
  'SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt FROM messages WHERE session = ? ORDER BY id ASC'
);
const stmtGetExportHistory = db.prepare(
  'SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt FROM messages WHERE session = ? ORDER BY id ASC'
);
const stmtGetHistoryCount = db.prepare(
  'SELECT COUNT(*) AS count FROM messages WHERE session = ?'
);
const stmtGetHistoryTail = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM (
     SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
     FROM messages
     WHERE session = ?
     ORDER BY id DESC
     LIMIT ?
   )
   ORDER BY id ASC`
);
const stmtGetHistoryBeforeId = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM (
     SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
     FROM messages
     WHERE session = ? AND id < ?
     ORDER BY id DESC
     LIMIT ?
   )
   ORDER BY id ASC`
);
const stmtUpdateHistorySourceMetadata = db.prepare(
  'UPDATE messages SET ts = ?, source_message_id = ?, source = ? WHERE session = ? AND id = ?'
);
const stmtGetHistoryAtOrBeforeId = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM messages
   WHERE session = ? AND id <= ?
   ORDER BY id DESC
   LIMIT ?`
);
const stmtGetHistoryAfterId = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM messages
   WHERE session = ? AND id > ?
   ORDER BY id ASC
   LIMIT ?`
);
const stmtGetHistoryCountBeforeId = db.prepare(
  'SELECT COUNT(*) AS count FROM messages WHERE session = ? AND id < ?'
);
const stmtGetHistoryFrom = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM messages WHERE session = ? AND sequence > ? ORDER BY id ASC`
);
const stmtGetReconciliationHistory = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM messages
   WHERE session = ? AND NOT (${DELIVERY_RECEIPT_OVERLAY_SQL})
   ORDER BY id ASC`
);
const stmtGetReconciliationHistoryCount = db.prepare(
  `SELECT COUNT(*) AS count
   FROM messages
   WHERE session = ? AND NOT (${DELIVERY_RECEIPT_OVERLAY_SQL})`
);
const stmtGetReconciliationHistoryTail = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
   FROM (
     SELECT id, role, content, content_blocks, status, sequence, ts, client_msg_id, source_message_id, source_cursor, source, accepted_at, launch_accepted_at, delivered_at, agent_started_at, native_receipt, process_epoch, failure_code, failure_reason, failure_native_attempted, failure_retryable, delivery_attempt
     FROM messages
     WHERE session = ? AND NOT (${DELIVERY_RECEIPT_OVERLAY_SQL})
     ORDER BY id DESC
     LIMIT ?
   )
   ORDER BY id ASC`
);

function getHistoryRows(sessionId) {
  return stmtGetHistory.all(sessionId).map(hydrateMessageRow);
}

function getHistoryCount(sessionId) {
  return Number(stmtGetHistoryCount.get(sessionId)?.count || 0);
}

function getHistoryRowsTail(sessionId, limit) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 0)));
  return stmtGetHistoryTail.all(sessionId, safeLimit).map(hydrateMessageRow);
}

function getReconciliationHistoryRows(sessionId) {
  return stmtGetReconciliationHistory.all(sessionId).map(hydrateMessageRow);
}

function getReconciliationHistoryCount(sessionId) {
  return Number(stmtGetReconciliationHistoryCount.get(sessionId)?.count || 0);
}

function getReconciliationHistoryRowsTail(sessionId, limit) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 0)));
  return stmtGetReconciliationHistoryTail.all(sessionId, safeLimit).map(hydrateMessageRow);
}

function historyChunkLimit(limit) {
  return Math.max(1, Math.min(MAX_HISTORY_CHUNK_LIMIT, Math.floor(Number(limit) || DEFAULT_HISTORY_CHUNK_LIMIT)));
}

function getHistoryRowsBeforeId(sessionId, beforeId, limit) {
  const safeLimit = historyChunkLimit(limit);
  const safeBeforeId = Math.max(0, Math.floor(Number(beforeId) || 0));
  if (!safeBeforeId) return getHistoryRowsTail(sessionId, safeLimit);
  return stmtGetHistoryBeforeId.all(sessionId, safeBeforeId, safeLimit).map(hydrateMessageRow);
}

function reconcileHistoryTailSourceMetadata(sessionId, incomingRows, source) {
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];
  if (incoming.length === 0 || incoming.length > 1000) {
    return { applied: false, code: 'invalid_reconciliation_window', rows: 0 };
  }
  const existing = getReconciliationHistoryRowsTail(sessionId, incoming.length);
  if (existing.length !== incoming.length) {
    return { applied: false, code: 'history_length_mismatch', rows: 0 };
  }
  for (let index = 0; index < incoming.length; index++) {
    const stored = existing[index] || {};
    const replacement = incoming[index] || {};
    if (stored.role !== replacement.role || stored.content !== replacement.content) {
      return { applied: false, code: 'semantic_row_mismatch', rows: 0 };
    }
    const storedBlocks = JSON.stringify(stored.content_blocks || null);
    const replacementBlocks = JSON.stringify(Array.isArray(replacement.content_blocks) ? replacement.content_blocks : null);
    if (storedBlocks !== replacementBlocks) {
      return { applied: false, code: 'semantic_block_mismatch', rows: 0 };
    }
  }
  const normalized = incoming.map(message => ({
    sourceMessageId: normalizeSourceMessageId(message?.source_message_id),
    timestamp: proxyMessageTimestampSeconds(message),
  }));
  if (normalized.some(row => !row.sourceMessageId || !(row.timestamp > 0))) {
    return { applied: false, code: 'incomplete_source_metadata', rows: 0 };
  }
  if (new Set(normalized.map(row => row.sourceMessageId)).size !== normalized.length) {
    return { applied: false, code: 'duplicate_source_identity', rows: 0 };
  }
  const normalizedSource = normalizeSourceName(source);
  try {
    db.transaction(() => {
      for (let index = 0; index < existing.length; index++) {
        stmtUpdateHistorySourceMetadata.run(
          normalized[index].timestamp,
          normalized[index].sourceMessageId,
          normalizedSource || existing[index].source || null,
          sessionId,
          existing[index].id,
        );
      }
    })();
  } catch (error) {
    log('warn', 'history', 'Rejected source metadata reconciliation', {
      session: sessionId,
      rows: incoming.length,
      code: error.code || 'update_failed',
    });
    return { applied: false, code: 'source_identity_conflict', rows: 0 };
  }
  rebuildTranscriptSourceCursors(sessionId, getReconciliationHistoryRowsTail(sessionId, incoming.length));
  log('info', 'history', 'Reconciled native source metadata for persisted tail', {
    session: sessionId,
    rows: incoming.length,
    source: normalizedSource,
  });
  return { applied: true, code: 'metadata_reconciled', rows: incoming.length };
}

function getHistoryRowsAroundId(sessionId, aroundId, limit) {
  const safeLimit = historyChunkLimit(limit);
  const safeAroundId = Math.max(0, Math.floor(Number(aroundId) || 0));
  if (!safeAroundId) return [];
  const beforeLimit = Math.ceil(safeLimit / 2);
  const before = stmtGetHistoryAtOrBeforeId.all(sessionId, safeAroundId, beforeLimit).reverse();
  if (!before.some(row => row.id === safeAroundId)) return [];
  const after = stmtGetHistoryAfterId.all(sessionId, safeAroundId, safeLimit - before.length);
  return [...before, ...after].map(hydrateMessageRow);
}

function getHistoryCountBeforeId(sessionId, beforeId) {
  const safeBeforeId = Math.max(0, Math.floor(Number(beforeId) || 0));
  if (!safeBeforeId) return 0;
  return Number(stmtGetHistoryCountBeforeId.get(sessionId, safeBeforeId)?.count || 0);
}

function getHistoryRowsFrom(sessionId, sinceSeq) {
  return stmtGetHistoryFrom.all(sessionId, sinceSeq).map(hydrateMessageRow);
}
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
const stmtGetByClientId = db.prepare(
  `SELECT id, client_msg_id, session, content, sequence, ts, status, accepted_at,
          launch_accepted_at, delivered_at, agent_started_at, native_receipt,
          process_epoch, failure_code, failure_reason, failure_native_attempted,
          failure_retryable, delivery_attempt
   FROM messages WHERE client_msg_id = ?`
);
const stmtGetSendReceipt = db.prepare(
  `SELECT sr.client_msg_id, sr.session, sr.server_message_id AS id, sr.sequence,
          sr.ts, sr.status, sr.accepted_at, sr.launch_accepted_at,
          sr.delivered_at, sr.agent_started_at, sr.native_receipt,
          sr.process_epoch, sr.failure_code, sr.failure_reason,
          sr.failure_native_attempted, sr.failure_retryable,
          sr.delivery_attempt, COALESCE(sr.content, m.content) AS content
   FROM send_receipts sr
   LEFT JOIN messages m ON m.id = sr.server_message_id
   WHERE sr.client_msg_id = ?`
);
const stmtInsertSendReceipt = db.prepare(
  `INSERT OR IGNORE INTO send_receipts
     (client_msg_id, session, server_message_id, sequence, ts, status,
      accepted_at, content, delivery_attempt, updated_at)
   VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, 1, ?)`
);
const stmtInsertSendAttempt = db.prepare(
  `INSERT OR IGNORE INTO send_attempts
     (client_msg_id, delivery_attempt, session, status, accepted_at, updated_at)
   VALUES (?, ?, ?, 'accepted', ?, ?)`
);
const stmtMarkReceiptLaunchAccepted = db.prepare(
  `UPDATE send_receipts
   SET status = CASE WHEN status IN ('delivered', 'agent_started', 'failed') THEN status ELSE 'accepted' END,
       launch_accepted_at = CASE
         WHEN status IN ('delivered', 'agent_started', 'failed') THEN launch_accepted_at
         ELSE COALESCE(launch_accepted_at, ?)
       END,
       process_epoch = COALESCE(?, process_epoch), updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkReceiptDelivered = db.prepare(
  `UPDATE send_receipts
   SET status = CASE WHEN status = 'agent_started' THEN status ELSE 'delivered' END,
       delivered_at = COALESCE(delivered_at, ?), native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch), failure_code = NULL,
       failure_reason = NULL, failure_native_attempted = NULL,
       failure_retryable = NULL, updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkReceiptAgentStarted = db.prepare(
  `UPDATE send_receipts
   SET status = 'agent_started', delivered_at = COALESCE(delivered_at, ?),
       agent_started_at = COALESCE(agent_started_at, ?), native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch), failure_code = NULL,
       failure_reason = NULL, failure_native_attempted = NULL,
       failure_retryable = NULL, updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkReceiptFailed = db.prepare(
  `UPDATE send_receipts
   SET status = CASE WHEN status IN ('delivered', 'agent_started') THEN status ELSE 'failed' END,
       failure_code = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_code ELSE ? END,
       failure_reason = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_reason ELSE ? END,
       failure_native_attempted = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_native_attempted ELSE ? END,
       failure_retryable = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_retryable ELSE ? END,
       process_epoch = COALESCE(?, process_epoch), updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkMessageAccepted = db.prepare(
  `UPDATE messages
   SET status = CASE WHEN status IN ('delivered', 'agent_started') THEN status ELSE 'accepted' END,
       accepted_at = COALESCE(accepted_at, ?)
   WHERE client_msg_id = ?`
);
const stmtMarkMessageLaunchAccepted = db.prepare(
  `UPDATE messages
   SET status = CASE WHEN status IN ('delivered', 'agent_started', 'failed') THEN status ELSE 'accepted' END,
       launch_accepted_at = CASE
         WHEN status IN ('delivered', 'agent_started', 'failed') THEN launch_accepted_at
         ELSE COALESCE(launch_accepted_at, ?)
       END,
       process_epoch = COALESCE(?, process_epoch)
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkMessageDelivered = db.prepare(
  `UPDATE messages
   SET status = CASE WHEN status = 'agent_started' THEN status ELSE 'delivered' END,
       delivered_at = COALESCE(delivered_at, ?),
       native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch),
       failure_code = NULL, failure_reason = NULL,
       failure_native_attempted = NULL, failure_retryable = NULL
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkMessageAgentStarted = db.prepare(
  `UPDATE messages
   SET status = 'agent_started',
       delivered_at = COALESCE(delivered_at, ?),
       agent_started_at = COALESCE(agent_started_at, ?),
       native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch),
       failure_code = NULL, failure_reason = NULL,
       failure_native_attempted = NULL, failure_retryable = NULL
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkMessageFailed = db.prepare(
  `UPDATE messages
   SET status = CASE WHEN status IN ('delivered', 'agent_started') THEN status ELSE 'failed' END,
       failure_code = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_code ELSE ? END,
       failure_reason = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_reason ELSE ? END,
       failure_native_attempted = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_native_attempted ELSE ? END,
       failure_retryable = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_retryable ELSE ? END,
       process_epoch = COALESCE(?, process_epoch)
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkAttemptLaunchAccepted = db.prepare(
  `UPDATE send_attempts
   SET status = CASE WHEN status IN ('delivered', 'agent_started', 'failed') THEN status ELSE 'accepted' END,
       launch_accepted_at = CASE
         WHEN status IN ('delivered', 'agent_started', 'failed') THEN launch_accepted_at
         ELSE COALESCE(launch_accepted_at, ?)
       END,
       process_epoch = COALESCE(?, process_epoch), updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkAttemptDelivered = db.prepare(
  `UPDATE send_attempts
   SET status = CASE WHEN status = 'agent_started' THEN status ELSE 'delivered' END,
       delivered_at = COALESCE(delivered_at, ?),
       native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch), failure_code = NULL,
       failure_reason = NULL, failure_native_attempted = NULL,
       failure_retryable = NULL, updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkAttemptAgentStarted = db.prepare(
  `UPDATE send_attempts
   SET status = 'agent_started', delivered_at = COALESCE(delivered_at, ?),
       agent_started_at = COALESCE(agent_started_at, ?),
       native_receipt = COALESCE(?, native_receipt),
       process_epoch = COALESCE(?, process_epoch), failure_code = NULL,
       failure_reason = NULL, failure_native_attempted = NULL,
       failure_retryable = NULL, updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtMarkAttemptFailed = db.prepare(
  `UPDATE send_attempts
   SET status = CASE WHEN status IN ('delivered', 'agent_started') THEN status ELSE 'failed' END,
       failure_code = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_code ELSE ? END,
       failure_reason = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_reason ELSE ? END,
       failure_native_attempted = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_native_attempted ELSE ? END,
       failure_retryable = CASE WHEN status IN ('delivered', 'agent_started') THEN failure_retryable ELSE ? END,
       process_epoch = COALESCE(?, process_epoch), updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?`
);
const stmtResetMessageForRetry = db.prepare(
  `UPDATE messages
   SET status = 'accepted', accepted_at = ?, launch_accepted_at = NULL,
       delivered_at = NULL, agent_started_at = NULL, native_receipt = NULL,
       process_epoch = NULL, failure_code = NULL, failure_reason = NULL,
       failure_native_attempted = NULL, failure_retryable = NULL,
       delivery_attempt = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?
     AND status = 'failed' AND failure_native_attempted = 0
     AND failure_retryable = 1`
);
const stmtResetReceiptForRetry = db.prepare(
  `UPDATE send_receipts
   SET status = 'accepted', accepted_at = ?, launch_accepted_at = NULL,
       delivered_at = NULL, agent_started_at = NULL, native_receipt = NULL,
       process_epoch = NULL, failure_code = NULL, failure_reason = NULL,
       failure_native_attempted = NULL, failure_retryable = NULL,
       delivery_attempt = ?, updated_at = ?
   WHERE session = ? AND client_msg_id = ? AND delivery_attempt = ?
     AND status = 'failed' AND failure_native_attempted = 0
     AND failure_retryable = 1`
);

function serializeNativeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  try {
    const encoded = JSON.stringify(receipt);
    return Buffer.byteLength(encoded, 'utf8') <= 16 * 1024 ? encoded : null;
  } catch {
    return null;
  }
}

function deserializeNativeReceipt(receipt) {
  if (!receipt) return null;
  if (typeof receipt === 'object' && !Array.isArray(receipt)) return receipt;
  try { return JSON.parse(receipt); } catch { return null; }
}

function isSafeFailedSendRetry(row) {
  return row?.status === 'failed'
    && Number(row.failure_native_attempted) === 0
    && Number(row.failure_retryable) === 1
    && !row.launch_accepted_at
    && !row.delivered_at
    && !row.agent_started_at
    && !row.native_receipt;
}

const beginSafeSendRetry = db.transaction((clientMessageId, sessionId, acceptedAt) => {
  const before = stmtGetSendReceipt.get(clientMessageId) || stmtGetByClientId.get(clientMessageId) || null;
  if (!before || before.session !== sessionId) {
    return { ok: false, code: 'retry_identity_mismatch', row: before };
  }
  if (!isSafeFailedSendRetry(before)) {
    return { ok: false, code: 'retry_not_proven_safe', row: before };
  }
  const priorAttempt = Math.max(1, Number(before.delivery_attempt) || 1);
  const deliveryAttempt = priorAttempt + 1;
  const messageUpdate = stmtResetMessageForRetry.run(
    acceptedAt,
    deliveryAttempt,
    sessionId,
    clientMessageId,
    priorAttempt,
  );
  const receiptUpdate = stmtResetReceiptForRetry.run(
    acceptedAt,
    deliveryAttempt,
    acceptedAt,
    sessionId,
    clientMessageId,
    priorAttempt,
  );
  if (messageUpdate.changes !== 1 || receiptUpdate.changes !== 1) {
    const error = new Error('safe retry compare-and-swap failed');
    error.code = 'retry_compare_and_swap_failed';
    throw error;
  }
  stmtInsertSendAttempt.run(clientMessageId, deliveryAttempt, sessionId, acceptedAt, acceptedAt);
  return {
    ok: true,
    code: 'retry_attempt_started',
    prior_attempt: priorAttempt,
    delivery_attempt: deliveryAttempt,
    row: stmtGetSendReceipt.get(clientMessageId) || stmtGetByClientId.get(clientMessageId),
  };
});

function validateSendAttempt(message, row) {
  const currentAttempt = Math.max(1, Number(row?.delivery_attempt) || 1);
  const rawAttempt = Number(message?.delivery_attempt);
  if (!Number.isInteger(rawAttempt) || rawAttempt < 1) {
    return currentAttempt === 1
      ? { ok: true, delivery_attempt: 1, legacy: true }
      : { ok: false, code: 'missing_delivery_attempt', delivery_attempt: currentAttempt };
  }
  if (rawAttempt !== currentAttempt) {
    return {
      ok: false,
      code: rawAttempt < currentAttempt ? 'stale_delivery_attempt' : 'future_delivery_attempt',
      delivery_attempt: currentAttempt,
    };
  }
  return { ok: true, delivery_attempt: currentAttempt, legacy: false };
}

function persistSendLifecycle(message = {}) {
  const sessionId = message.session_id || message.session;
  const clientMessageId = message.client_message_id;
  if (!sessionId || !clientMessageId) return { applied: false, advanced: false, code: 'missing_lifecycle_key', row: null };
  const before = stmtGetSendReceipt.get(clientMessageId) || stmtGetByClientId.get(clientMessageId) || null;
  if (!before) return { applied: false, advanced: false, code: 'unknown_client_message_id', row: null };
  if (before.session !== sessionId) {
    return { applied: false, advanced: false, code: 'client_message_id_session_mismatch', row: before };
  }
  const attemptValidation = validateSendAttempt(message, before);
  if (!attemptValidation.ok) {
    return { applied: false, advanced: false, code: attemptValidation.code, row: before };
  }
  const deliveryAttempt = attemptValidation.delivery_attempt;
  const receiptJson = serializeNativeReceipt(message.native_receipt);
  const processEpoch = message.process_epoch || message.native_receipt?.process_epoch || null;
  const updatedAt = new Date().toISOString();
  let stage = null;
  if (message.type === 'agent_started') {
    stage = 'agent_started';
    const deliveredAt = message.delivered_at || message.native_receipt?.observed_at || updatedAt;
    const startedAt = message.started_at || message.native_start?.native_event_at || updatedAt;
    stmtMarkMessageAgentStarted.run(
      deliveredAt,
      startedAt,
      receiptJson,
      processEpoch,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkReceiptAgentStarted.run(
      deliveredAt,
      startedAt,
      receiptJson,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkAttemptAgentStarted.run(
      deliveredAt,
      startedAt,
      receiptJson,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
  } else if (message.result === 'launch_accepted') {
    stage = 'launch_accepted';
    const acceptedAt = message.accepted_at || updatedAt;
    stmtMarkMessageLaunchAccepted.run(
      acceptedAt,
      processEpoch,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkReceiptLaunchAccepted.run(
      acceptedAt,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkAttemptLaunchAccepted.run(
      acceptedAt,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
  } else if (message.result === 'delivered') {
    stage = 'delivered';
    const deliveredAt = message.delivered_at || message.native_receipt?.observed_at || updatedAt;
    stmtMarkMessageDelivered.run(
      deliveredAt,
      receiptJson,
      processEpoch,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkReceiptDelivered.run(
      deliveredAt,
      receiptJson,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkAttemptDelivered.run(
      deliveredAt,
      receiptJson,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
  } else if (message.result === 'failed') {
    stage = 'failed';
    const failureCode = message.error?.code || 'send_failed';
    const failureReason = String(message.error?.message || message.reason || 'Send failed').slice(0, 1000);
    const nativeAttempted = message.error?.native_attempted === false || message.native_attempted === false ? 0 : 1;
    const retryable = nativeAttempted === 0
      && (message.error?.retryable === true || message.retryable === true)
      ? 1
      : 0;
    stmtMarkMessageFailed.run(
      failureCode,
      failureReason,
      nativeAttempted,
      retryable,
      processEpoch,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    stmtMarkReceiptFailed.run(
      failureCode,
      failureReason,
      nativeAttempted,
      retryable,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
    const restored = restoreRetrySafeFailedMessages(db, clientMessageId);
    if (restored.changes > 0) {
      recomputeLatestVisibleMessage(sessionId);
      log('info', 'send', 'Restored retry-safe failed send after native history replacement', {
        session: sessionId,
        cid: clientMessageId,
      });
    }
    stmtMarkAttemptFailed.run(
      failureCode,
      failureReason,
      nativeAttempted,
      retryable,
      processEpoch,
      updatedAt,
      sessionId,
      clientMessageId,
      deliveryAttempt,
    );
  }
  if (!stage) return { applied: false, advanced: false, code: 'unknown_lifecycle_stage', row: before };
  const after = stmtGetSendReceipt.get(clientMessageId) || stmtGetByClientId.get(clientMessageId) || null;
  const advanced = stage === 'launch_accepted'
    ? !before.launch_accepted_at && Boolean(after?.launch_accepted_at)
    : stage === 'delivered'
      ? (!before.delivered_at && Boolean(after?.delivered_at)) || before.status !== after?.status
      : stage === 'agent_started'
        ? (!before.agent_started_at && Boolean(after?.agent_started_at)) || before.status !== after?.status
        : before.status !== after?.status
          || before.failure_code !== after?.failure_code
          || before.failure_reason !== after?.failure_reason
          || Number(before.failure_native_attempted) !== Number(after?.failure_native_attempted)
          || Number(before.failure_retryable) !== Number(after?.failure_retryable);
  return {
    applied: true,
    advanced,
    code: advanced ? 'lifecycle_advanced' : 'lifecycle_duplicate',
    delivery_attempt: deliveryAttempt,
    row: after,
  };
}
const stmtRecentBrowserUserMessages = db.prepare(
  `SELECT id, content, ts FROM messages
   WHERE session = ? AND role = 'user' AND client_msg_id IS NOT NULL
   ORDER BY id DESC LIMIT 10`
);

// ── Auth ──────────────────────────────────────────────────────────────────────

passport.use(new GoogleStrategy(
  {
    clientID:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL:  `${PUBLIC_URL}/auth/callback`,
  },
  (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (ALLOWED_EMAIL && email !== ALLOWED_EMAIL)
      return done(null, false, { message: 'Unauthorized email' });
    return done(null, { id: profile.id, email, name: profile.displayName });
  }
));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Express ───────────────────────────────────────────────────────────────────

const app    = express();
app.set('trust proxy', 1); // Behind Cloudflare — trust first proxy for secure cookies + correct protocol
const server = http.createServer(app);

const sessionMiddleware = session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  store:             new SqliteSessionStore(db),
  cookie:            { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 }, // 'lax' required for OAuth redirects from Google
});

// ── Security headers (A6-08) ──────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // SEC-09: HSTS
  // SEC-05: Babel Standalone removed — JSX pre-compiled by esbuild.
  // 'unsafe-eval' removed (was needed for Babel runtime compilation).
  // 'unsafe-inline' kept: Cloudflare Access injects inline scripts for auth.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' https://*.cloudflareaccess.com",
      "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com cdn.jsdelivr.net unpkg.com static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' cdnjs.cloudflare.com",
      "connect-src 'self' ws: wss: cdnjs.cloudflare.com unpkg.com",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "worker-src 'self'",
    ].join('; '),
  );
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// ── Bearer token middleware for Android app (A12-01) ─────────────────────────

function requireBearerToken(req, res, next) {
  if (!JWT_SECRET) return res.status(503).json({ error: 'App auth not configured (JWT_SECRET missing)' });
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (ALLOWED_EMAIL && payload.email !== ALLOWED_EMAIL)
      return res.status(403).json({ error: 'forbidden' });
    req.appUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

const authExchangeRateLimit = createPrincipalRateLimit({
  name: 'authentication exchange',
  limit: 30,
  windowMs: 60_000,
  principal: req => req.socket?.remoteAddress || 'unknown',
});
const fcmMutationRateLimit = createPrincipalRateLimit({
  name: 'FCM token mutation',
  limit: 20,
  windowMs: 60_000,
  principal: req => req.appUser?.email || req.socket?.remoteAddress || 'unknown',
});

// Auth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
);

// Android app OAuth entry point — sets isAppAuth flag before redirecting to Google
app.get('/auth/google/app', (req, res, next) => {
  req.session.isAppAuth = true;
  req.session.save(() => next());
}, passport.authenticate('google', { scope: ['email', 'profile'] }));

app.get('/auth/callback',
  passport.authenticate('google', { failureRedirect: '/auth/google' }),
  (req, res) => {
    // Android app flow: issue a one-time token and redirect to the custom scheme
    if (req.session.isAppAuth) {
      req.session.isAppAuth = false;
      if (!JWT_SECRET) {
        log('warn', 'auth', 'App auth attempted but JWT_SECRET is not set');
        return res.status(503).send('App auth not configured');
      }
      const token     = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
      db.prepare('INSERT INTO app_auth_tokens (token, email, expires_at) VALUES (?, ?, ?)')
        .run(token, req.user.email, expiresAt);
      log('info', 'auth', 'App one-time token issued', { email: req.user.email });
      return res.redirect(`agentchat://auth?token=${token}`);
    }
    res.redirect('/');
  }
);

// Direct app link — issues a JWT directly in the deep link so the app needs
// no additional HTTP round trip (which would be blocked by Cloudflare Access).
app.get('/auth/app-link', requireAuth, (req, res) => {
  if (!JWT_SECRET) return res.status(503).send('App auth not configured (JWT_SECRET missing)');
  const email = req.user?.email || ALLOWED_EMAIL;
  const appJwt = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  log('info', 'auth', 'App JWT issued via direct link', { email });
  res.redirect(`agentchat://auth?jwt=${appJwt}`);
});

// Exchange one-time app token for a long-lived JWT (A12-01)
app.post('/auth/app-token', authExchangeRateLimit, express.json(), (req, res) => {
  if (!JWT_SECRET) return res.status(503).json({ error: 'App auth not configured' });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });

  // Clean up expired tokens opportunistically
  db.prepare('DELETE FROM app_auth_tokens WHERE expires_at < ?').run(new Date().toISOString());

  const row = db.prepare('SELECT * FROM app_auth_tokens WHERE token = ?').get(token);
  if (!row) {
    log('warn', 'auth', 'App token exchange failed — token not found or expired');
    return res.status(401).json({ error: 'invalid or expired token' });
  }

  // Single use: delete immediately
  db.prepare('DELETE FROM app_auth_tokens WHERE token = ?').run(token);

  const appJwt = jwt.sign({ email: row.email }, JWT_SECRET, { expiresIn: '30d' });
  log('info', 'auth', 'App JWT issued', { email: row.email });
  res.json({ token: appJwt });
});

// Exchange a Google ID token (from in-app Google Sign-In) for an app JWT (A1)
app.post('/auth/google-id-token', authExchangeRateLimit, express.json(), async (req, res) => {
  if (!JWT_SECRET) return res.status(503).json({ error: 'App auth not configured' });
  const { id_token } = req.body || {};
  if (!id_token) return res.status(400).json({ error: 'missing id_token' });

  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
    const info = await r.json();
    if (!r.ok) {
      log('warn', 'auth', 'Google ID token verification failed', { error: info.error_description || info.error });
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    if (ALLOWED_EMAIL && info.email !== ALLOWED_EMAIL) {
      log('warn', 'auth', 'Google ID token email mismatch', { got: info.email, expected: ALLOWED_EMAIL });
      return res.status(403).json({ error: 'This Google account is not authorized' });
    }
    const appJwt = jwt.sign({ email: info.email }, JWT_SECRET, { expiresIn: '30d' });
    log('info', 'auth', 'App JWT issued via Google ID token', { email: info.email });
    res.json({ token: appJwt });
  } catch (err) {
    log('error', 'auth', 'Google ID token exchange error', { error: err.message });
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// Register / refresh FCM push token (A12-02 prep)
app.post('/fcm-token', requireBearerToken, fcmMutationRateLimit, express.json(), (req, res) => {
  const { fcm_token, platform = 'android' } = req.body || {};
  if (!boundedString(fcm_token, { min: 20, max: 4096 }) || !/^[A-Za-z0-9_:-]+$/.test(fcm_token)) {
    return res.status(400).json({ error: 'invalid fcm_token' });
  }
  if (platform !== 'android') return res.status(400).json({ error: 'invalid platform' });
  const ownerEmail = String(req.appUser.email || '').toLowerCase();
  const existing = db.prepare('SELECT email FROM fcm_tokens WHERE token = ?').get(fcm_token);
  if (existing && String(existing.email || '').toLowerCase() !== ownerEmail) {
    return res.status(409).json({ error: 'FCM token is already registered to another account' });
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO fcm_tokens (email, token, platform, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET platform = excluded.platform, updated_at = excluded.updated_at
  `).run(ownerEmail, fcm_token, platform, now);
  db.prepare(`
    DELETE FROM fcm_tokens
    WHERE email = ? AND id NOT IN (
      SELECT id FROM fcm_tokens WHERE email = ? ORDER BY updated_at DESC, id DESC LIMIT 20
    )
  `).run(ownerEmail, ownerEmail);
  log('info', 'fcm', 'FCM token registered', { email: ownerEmail, platform });
  res.json({ ok: true });
});

const pushMutationRateLimit = createPrincipalRateLimit({
  name: 'push subscription mutation', limit: 20,
  principal: req => authenticatedEmail(req),
});
const preferenceMutationRateLimit = createPrincipalRateLimit({
  name: 'preference mutation', limit: 60,
  principal: req => authenticatedEmail(req),
});
const semanticReceiptRateLimit = createPrincipalRateLimit({
  name: 'semantic notification receipt', limit: 240,
  principal: req => authenticatedEmail(req),
});
const scheduledSendMutationRateLimit = createPrincipalRateLimit({
  name: 'scheduled send mutation', limit: 60,
  principal: req => authenticatedEmail(req),
});
const historyReadRateLimit = createPrincipalRateLimit({
  name: 'history read', limit: 180,
  principal: req => authenticatedEmail(req),
});
const MAX_WEB_PUSH_SUBSCRIPTIONS_PER_USER = 10;

app.get('/api/push/web-config', requireAnyAuth, (req, res) => {
  res.json({ enabled: true, public_key: vapidKeys.publicKey });
});

app.post('/api/push/web-subscription', requireAnyAuth, pushMutationRateLimit, (req, res) => {
  const subscription = validateWebPushSubscription(req.body);
  if (!subscription.ok) return res.status(400).json({ error: subscription.error });
  const { endpoint, p256dh, auth } = subscription;
  const email = authenticatedEmail(req);
  const existing = db.prepare('SELECT email FROM web_push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (existing && existing.email !== email) {
    return res.status(409).json({ error: 'Web Push endpoint is already registered' });
  }
  if (!existing) {
    const count = db.prepare('SELECT COUNT(*) AS count FROM web_push_subscriptions WHERE email = ?').get(email).count;
    if (count >= MAX_WEB_PUSH_SUBSCRIPTIONS_PER_USER) {
      db.prepare(`
        DELETE FROM web_push_subscriptions
        WHERE id = (
          SELECT id FROM web_push_subscriptions WHERE email = ? ORDER BY updated_at ASC, id ASC LIMIT 1
        )
      `).run(email);
      log('info', 'web-push', 'Removed oldest subscription at per-user cap', { email });
    }
  }
  db.prepare(`
    INSERT INTO web_push_subscriptions (email, endpoint, p256dh, auth, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      email = excluded.email,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = excluded.updated_at
  `).run(email, endpoint, p256dh, auth, new Date().toISOString());
  log('info', 'web-push', 'Browser subscription registered', { email });
  res.json({ ok: true });
});

app.delete('/api/push/web-subscription', requireAnyAuth, pushMutationRateLimit, (req, res) => {
  const endpointResult = validateWebPushEndpoint(req.body?.endpoint);
  if (!endpointResult.ok) return res.status(400).json({ error: endpointResult.error });
  db.prepare('DELETE FROM web_push_subscriptions WHERE email = ? AND endpoint = ?')
    .run(authenticatedEmail(req), endpointResult.endpoint);
  res.json({ ok: true });
});

app.get('/auth/logout', (req, res) => req.logout(() => res.redirect('/auth/google')));

// Auth gate middleware
const LAN_PREFIXES = ['192.' + '168.', '10.', '172.16.', '::ffff:192.' + '168.', '::ffff:10.'];
const LOOPBACK_PREFIXES = ['127.', '::1', '::ffff:127.'];
function isLAN(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return LAN_PREFIXES.some(p => ip.startsWith(p))
    || (ALLOW_LOOPBACK_BYPASS && LOOPBACK_PREFIXES.some(p => ip.startsWith(p)));
}

function requireAuth(req, res, next) {
  if ((ALLOW_LAN_BYPASS && isLAN(req)) || req.isAuthenticated()) return next(); // SEC-03: LAN bypass is opt-in
  res.redirect('/auth/google');
}

// ── Health endpoints (A2-05) ──────────────────────────────────────────────────

app.get('/healthz', (req, res) => {
  res.json({
    status:      'ok',
    uptime_s:    Math.round(process.uptime()),
    ts:          Date.now(),
    connections: {
      browsers:       browserClients.size,
      proxy_sessions: proxySockets.size,
      proxy_connections: authenticatedProxyConnectionCount(),
    },
    proxy_watchdog: proxyOutageMonitor.snapshot(),
  });
});

function proxyWatchdogSecretMatches(req) {
  if (!PROXY_SECRET) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(PROXY_SECRET, 'utf8');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

app.post('/api/proxy-watchdog-event', (req, res) => {
  if (!PROXY_SECRET) return res.status(503).json({ error: 'Proxy authentication is not configured' });
  if (!proxyWatchdogSecretMatches(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.body?.type !== 'proxy_watchdog_failed') {
    return res.status(400).json({ error: 'Unsupported watchdog event type' });
  }
  const incidentId = String(req.body?.incident_id || '');
  const restartAttempts = Number(req.body?.restart_attempts);
  const missingSeconds = Number(req.body?.missing_seconds);
  if (
    !boundedString(incidentId, { max: 128 })
    || !Number.isInteger(restartAttempts) || restartAttempts < 1 || restartAttempts > 10
    || !Number.isFinite(missingSeconds) || missingSeconds < 0 || missingSeconds > 86_400
  ) {
    return res.status(400).json({ error: 'Invalid watchdog event' });
  }
  if (watchdogFailureIncidents.has(incidentId)) {
    return res.status(202).json({ ok: true, deduplicated: true });
  }
  watchdogFailureIncidents.set(incidentId, Date.now());
  while (watchdogFailureIncidents.size > RUNTIME_MAP_MAX_ENTRIES) {
    watchdogFailureIncidents.delete(watchdogFailureIncidents.keys().next().value);
  }
  for (const [id, timestamp] of watchdogFailureIncidents) {
    if (Date.now() - timestamp > 86_400_000) watchdogFailureIncidents.delete(id);
  }
  const event = {
    type: 'proxy_watchdog_status',
    status: 'failed',
    incident_id: incidentId,
    restart_attempts: restartAttempts,
    missing_seconds: Math.round(missingSeconds),
    server_ts: new Date().toISOString(),
  };
  broadcastToBrowsers(event);
  sendPushNotification(
    'Agent proxy recovery failed',
    `The proxy is still offline after ${restartAttempts} automatic restart attempts.`,
    { type: 'proxy_watchdog_failed', activity_type: 'error', incident_id: incidentId,
      restart_attempts: restartAttempts, missing_seconds: Math.round(missingSeconds) },
  ).catch(() => {});
  log('error', 'proxy-watchdog', 'Bounded automatic recovery failed', event);
  return res.status(202).json({ ok: true, deduplicated: false });
});

app.get('/readyz', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch { /* db down */ }
  const proxyUp = proxySockets.size > 0;
  res.status(dbOk ? 200 : 503).json({
    status:          dbOk ? 'ready' : 'not_ready',
    db:              dbOk ? 'ok' : 'error',
    proxy:           proxyUp ? 'connected' : 'disconnected',
  });
});

// ── File upload ───────────────────────────────────────────────────────────────

// Simple in-memory rate limiter: max 20 uploads per IP per minute.
const _uploadHits = new Map(); // ip -> [timestamp, ...]
function pruneUploadRateLimitState(now = Date.now()) {
  for (const [ip, timestamps] of _uploadHits) {
    const live = timestamps.filter(timestamp => now - timestamp < 60_000);
    if (live.length > 0) _uploadHits.set(ip, live);
    else _uploadHits.delete(ip);
  }
}
const uploadRateLimitCleanupTimer = setInterval(pruneUploadRateLimitState, 5 * 60_000);
uploadRateLimitCleanupTimer.unref?.();
function uploadRateLimit(req, res, next) {
  const ip  = req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const window = 60_000;
  const limit  = 20;
  const hits   = (_uploadHits.get(ip) || []).filter(t => now - t < window);
  if (hits.length >= limit) {
    return res.status(429).json({ error: 'Too many upload requests — try again in a minute' });
  }
  hits.push(now);
  _uploadHits.set(ip, hits);
  next();
}

app.post('/upload', requireAnyAuth, uploadRateLimit, (req, res) => {
  // Reject impossible JSON/base64 sizes before decoding, then enforce the
  // authoritative limit on decoded bytes for chunked and lengthless requests.
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const maxUploadRequestBytes = Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 + 16_384;
  if (contentLength > maxUploadRequestBytes) {
    return res.status(413).json({ error: `File too large — maximum upload is ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB` });
  }
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });
  const safe   = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') return res.status(400).json({ error: 'Invalid filename' });
  const unique = `${Date.now()}_${safe}`;
  const uploadReference = resolveUploadReference(UPLOAD_DIR, unique);
  if (!uploadReference.ok) return res.status(400).json({ error: uploadReference.error });
  const decoded = decodeBoundedBase64(content, UPLOAD_MAX_BYTES);
  if (!decoded.ok) return res.status(decoded.error === 'File too large' ? 413 : 400).json({ error: decoded.error });
  try {
    fs.writeFileSync(uploadReference.path, decoded.bytes);
    uploadInventory.retained += 1;
    uploadInventory.retainedBytes += decoded.bytes.length;
    if (Date.now() - lastUploadMaintenanceAt >= 60_000
      || uploadInventory.retained > UPLOAD_MAX_FILES
      || uploadInventory.retainedBytes > UPLOAD_MAX_TOTAL_BYTES) {
      runUploadMaintenance();
    }
    log('info', 'upload', 'File saved', { file: unique });
    res.json({ url: `/uploads/${unique}` });
  } catch (e) {
    log('error', 'upload', 'Write failed', { err: e.message });
    res.status(500).json({ error: 'Write failed' });
  }
});

app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

// ── Automations REST API ─────────────────────────────────────────────────────

// Prepared statements for automations
const stmtListAutomations  = db.prepare('SELECT * FROM automations ORDER BY category, name');
const stmtGetAutomation    = db.prepare('SELECT * FROM automations WHERE id = ?');
const stmtInsertAutomation = db.prepare(
  `INSERT INTO automations (name, description, category, prompt, schedule, cron_hour, cron_minute, cron_days, target_agent_type, target_session, enabled)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtUpdateAutomation = db.prepare(
  `UPDATE automations SET name=?, description=?, category=?, prompt=?, schedule=?, cron_hour=?, cron_minute=?, cron_days=?, target_agent_type=?, target_session=?, enabled=?, updated_at=datetime('now') WHERE id=?`
);
const stmtDeleteAutomation = db.prepare('DELETE FROM automations WHERE id = ?');
const stmtSetLastRun       = db.prepare(`UPDATE automations SET last_run_at = datetime('now') WHERE id = ?`);

// Combined auth: session cookie OR Bearer token
function requireAnyAuth(req, res, next) {
  if ((ALLOW_LAN_BYPASS && isLAN(req)) || req.isAuthenticated()) return next();
  // Try bearer token
  if (!JWT_SECRET) return res.status(401).json({ error: 'unauthorized' });
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (ALLOWED_EMAIL && payload.email !== ALLOWED_EMAIL) return res.status(403).json({ error: 'forbidden' });
    req.appUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

function authenticatedEmail(req) {
  return req.appUser?.email || req.user?.email || ALLOWED_EMAIL || 'lan-user';
}

app.get('/api/preferences/notifications', requireAnyAuth, (req, res) => {
  try {
    res.json({ preferences: notificationPreferencesForEmail(authenticatedEmail(req)) });
  } catch (e) {
    log('error', 'preferences', 'Notification preference read failed', { err: e.message });
    res.status(500).json({ error: 'Failed to load notification preferences' });
  }
});

app.put('/api/preferences/notifications', requireAnyAuth, preferenceMutationRateLimit, (req, res) => {
  const requested = req.body?.preferences || req.body || {};
  if (
    requested.permission_required !== undefined && typeof requested.permission_required !== 'boolean' ||
    requested.agent_ready !== undefined && typeof requested.agent_ready !== 'boolean' ||
    requested.turn_ready !== undefined && typeof requested.turn_ready !== 'boolean' ||
    requested.goal_completed !== undefined && typeof requested.goal_completed !== 'boolean' ||
    requested.goal_attention !== undefined && typeof requested.goal_attention !== 'boolean' ||
    requested.provider_usage_warning !== undefined && typeof requested.provider_usage_warning !== 'boolean' ||
    requested.agent_error !== undefined && typeof requested.agent_error !== 'boolean' ||
    requested.session_offline !== undefined && typeof requested.session_offline !== 'boolean' ||
    requested.rate_limit_cleared !== undefined && typeof requested.rate_limit_cleared !== 'boolean' ||
    requested.completion_sound !== undefined && typeof requested.completion_sound !== 'boolean' ||
    requested.completion_haptic !== undefined && typeof requested.completion_haptic !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Notification preferences must be boolean values' });
  }
  try {
    const preferences = saveNotificationPreferences(authenticatedEmail(req), requested);
    res.json({ ok: true, preferences });
  } catch (e) {
    log('error', 'preferences', 'Notification preference update failed', { err: e.message });
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

app.post('/api/notifications/semantic-receipts', requireAnyAuth, semanticReceiptRateLimit, (req, res) => {
  const dedupeKey = String(req.body?.dedupe_key || '').trim();
  const stage = String(req.body?.stage || '').trim();
  const channel = String(req.body?.channel || '').trim().toLowerCase();
  const reasonCode = String(req.body?.reason_code || '').trim().toLowerCase();
  const clientId = String(req.body?.client_id || '').trim();
  if (!dedupeKey || dedupeKey.length > 240
    || !['claimed', 'displayed', 'suppressed'].includes(stage)
    || !/^[a-z0-9_-]{1,64}$/.test(channel)
    || (reasonCode && !/^[a-z0-9_-]{1,120}$/.test(reasonCode))
    || clientId.length > 160) {
    return res.status(400).json({ error: 'Invalid semantic notification receipt' });
  }
  try {
    const email = authenticatedEmail(req);
    const recorded = goalNotifications.recordClientStage(dedupeKey, stage, {
      reasonCode: reasonCode || null,
      preferenceRevision: notificationPreferenceRevisionForEmail(email),
      clientChannel: channel,
      metadata: { client_id: clientId },
    });
    if (!recorded.ok && recorded.code === 'unknown_event') {
      return res.status(404).json({ error: 'Unknown semantic notification event' });
    }
    if (!recorded.ok) return res.status(400).json({ error: recorded.code });
    return res.json({ ok: true });
  } catch (e) {
    log('error', 'notifications', 'Semantic notification receipt failed', { err: e.message });
    return res.status(500).json({ error: 'Failed to record semantic notification receipt' });
  }
});

app.get('/api/notifications/semantic-diagnostics', requireAnyAuth, (req, res) => {
  try {
    const requestedMinutes = Number(req.query.max_age_minutes);
    const maxAgeMinutes = Number.isFinite(requestedMinutes)
      ? Math.max(1, Math.min(30 * 24 * 60, requestedMinutes))
      : 24 * 60;
    res.json({
      diagnostics: goalNotifications.diagnostics({ maxAgeMs: maxAgeMinutes * 60 * 1000 }),
      content_persisted: false,
    });
  } catch (e) {
    log('error', 'notifications', 'Semantic notification diagnostics failed', { err: e.message });
    res.status(500).json({ error: 'Failed to load semantic notification diagnostics' });
  }
});

app.get('/api/maintenance/validation', requireAnyAuth, (req, res) => {
  try {
    res.json({
      validations: nightlyValidationStatuses(),
      latest_app_update_validation: latestAppUpdateValidation(),
      revalidation_program_health: harnessRevalidationHealth(),
      operator_dogfood_health: operatorDogfoodHealth(),
    });
  } catch (e) {
    log('error', 'validation', 'Nightly validation status read failed', { err: e.message });
    res.status(500).json({ error: 'Failed to read nightly validation status' });
  }
});

app.put('/api/maintenance/validation', requireAnyAuth, (req, res) => {
  try {
    const requested = req.body?.validation || req.body || {};
    const validation = saveNightlyValidationStatus(requested);
    const revalidationHealth = ['app_update_validation', 'harness_revalidation_tier2', 'harness_revalidation_program'].includes(requested.kind)
      ? saveHarnessRevalidationHealth(requested.program_health) : null;
    const dogfoodHealth = requested.kind === 'operator_dogfood'
      ? saveOperatorDogfoodHealth(requested.program_health) : null;
    const validations = nightlyValidationStatuses();
    const failures = validations.filter(item => item.status !== 'pass');
    broadcastToBrowsers({
      type: 'nightly_validation_status',
      validations,
      failures,
      ...(revalidationHealth ? { revalidation_program_health: revalidationHealth } : {}),
      ...(dogfoodHealth ? { operator_dogfood_health: dogfoodHealth } : {}),
      server_ts: new Date().toISOString(),
    });
    if (revalidationHealth) {
      broadcastToBrowsers({
        type: 'harness_revalidation_status',
        program_health: revalidationHealth,
        server_ts: new Date().toISOString(),
      });
    }
    if (dogfoodHealth) {
      broadcastToBrowsers({
        type: 'operator_dogfood_status',
        program_health: dogfoodHealth,
        server_ts: new Date().toISOString(),
      });
    }
    let appUpdateValidation = null;
    if (requested.kind === 'app_update_validation') {
      appUpdateValidation = saveLatestAppUpdateValidation(validation, requested);
      broadcastToBrowsers({
        type: 'app_update_validation_status',
        validation: appUpdateValidation,
        server_ts: new Date().toISOString(),
      });
      const passed = appUpdateValidation.status === 'pass';
      sendPushNotification(
        passed ? 'App update validated' : 'App update drift validation failed',
        `${appUpdateValidation.harness} ${appUpdateValidation.previous_app_version} -> ${appUpdateValidation.app_version}`,
        {
          type: passed ? 'app_update_pass' : 'app_update_fail',
          harness: appUpdateValidation.harness,
          app_version: appUpdateValidation.app_version,
          previous_app_version: appUpdateValidation.previous_app_version,
          status: appUpdateValidation.status,
        },
      ).catch(error => log('warn', 'validation', 'App-update push failed', { err: error.message }));
    }
    res.json({ ok: true, validation: appUpdateValidation || validation, failures });
  } catch (e) {
    log('warn', 'validation', 'Nightly validation status update rejected', { err: e.message });
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/preferences/sessions', requireAnyAuth, (req, res) => {
  try {
    res.json({ preferences: sessionPreferencesForEmail(authenticatedEmail(req)) });
  } catch (e) {
    log('error', 'preferences', 'Session preference read failed', { err: e.message });
    res.status(500).json({ error: 'Failed to load session preferences' });
  }
});

app.put('/api/preferences/sessions/:sessionId', requireAnyAuth, preferenceMutationRateLimit, (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const requested = req.body?.preference || req.body || {};
  if (!sessionId || sessionId.length > 200) return res.status(400).json({ error: 'Invalid session id' });
  if (
    requested.display_name !== undefined && typeof requested.display_name !== 'string' ||
    requested.archived !== undefined && typeof requested.archived !== 'boolean' ||
    requested.muted !== undefined && typeof requested.muted !== 'boolean' ||
    requested.pinned !== undefined && typeof requested.pinned !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Invalid session preference values' });
  }
  try {
    const preference = saveSessionPreference(authenticatedEmail(req), sessionId, requested);
    res.json({ ok: true, session_id: sessionId, preference });
  } catch (e) {
    log('error', 'preferences', 'Session preference update failed', { err: e.message, session_id: sessionId });
    res.status(500).json({ error: 'Failed to save session preference' });
  }
});

app.delete('/api/preferences/sessions/:sessionId', requireAnyAuth, preferenceMutationRateLimit, (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId || sessionId.length > 200) return res.status(400).json({ error: 'Invalid session id' });
  try {
    db.prepare('DELETE FROM session_preferences WHERE email = ? AND session_id = ?')
      .run(authenticatedEmail(req), sessionId);
    res.json({ ok: true, session_id: sessionId });
  } catch (e) {
    log('error', 'preferences', 'Session preference reset failed', { err: e.message, session_id: sessionId });
    res.status(500).json({ error: 'Failed to reset session preference' });
  }
});

function historyStoreStats(retentionDays = 90) {
  const days = Math.max(1, Math.min(3650, Number(retentionDays) || 90));
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const totals = db.prepare(`
    SELECT COUNT(*) AS message_count, COUNT(DISTINCT session) AS session_count,
           MIN(ts) AS oldest_ts, MAX(ts) AS newest_ts
    FROM messages
  `).get();
  const inactiveRows = db.prepare(`
    SELECT session, COUNT(*) AS message_count, MAX(ts) AS last_ts
    FROM messages
    GROUP BY session
    HAVING MAX(ts) < ?
    ORDER BY MAX(ts) ASC
  `).all(cutoff).filter(row => !proxySockets.has(row.session));
  const fileBytes = fs.existsSync(HISTORY_DB_PATH) ? fs.statSync(HISTORY_DB_PATH).size : 0;
  const walPath = HISTORY_DB_PATH + '-wal';
  const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const backups = fs.existsSync(HISTORY_BACKUP_DIR)
    ? fs.readdirSync(HISTORY_BACKUP_DIR)
      .filter(name => /^messages-.+\.db$/.test(name))
      .map(name => {
        const backupPath = path.join(HISTORY_BACKUP_DIR, name);
        const stat = fs.statSync(backupPath);
        return { path: backupPath, bytes: stat.size, created_at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  return {
    db_bytes: fileBytes,
    wal_bytes: walBytes,
    message_count: totals.message_count || 0,
    session_count: totals.session_count || 0,
    oldest_ts: totals.oldest_ts || null,
    newest_ts: totals.newest_ts || null,
    retention_days: days,
    inactive_candidate_sessions: inactiveRows.length,
    inactive_candidate_messages: inactiveRows.reduce((sum, row) => sum + row.message_count, 0),
    backup_count: backups.length,
    latest_backup: backups[0] || null,
    _candidate_ids: inactiveRows.map(row => row.session),
  };
}

async function createHistoryBackup() {
  fs.mkdirSync(HISTORY_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(HISTORY_BACKUP_DIR, `messages-${stamp}.db`);
  const partial = destination + '.partial';
  await db.backup(partial);
  fs.renameSync(partial, destination);
  pruneDirectory(HISTORY_BACKUP_DIR, { maxFiles: HISTORY_BACKUP_MAX_FILES });
  return {
    path: destination,
    bytes: fs.statSync(destination).size,
    created_at: new Date().toISOString(),
  };
}

let historyBackupJob = { status: 'idle' };
function startHistoryBackupJob() {
  if (historyBackupJob.status === 'running') return historyBackupJob;
  historyBackupJob = { status: 'running', started_at: new Date().toISOString() };
  createHistoryBackup().then(backup => {
    historyBackupJob = { status: 'complete', started_at: historyBackupJob.started_at, completed_at: new Date().toISOString(), backup };
    log('info', 'history-maintenance', 'History backup created', { bytes: backup.bytes });
  }).catch(error => {
    historyBackupJob = { status: 'failed', started_at: historyBackupJob.started_at, completed_at: new Date().toISOString(), error: error.message };
    log('error', 'history-maintenance', 'History backup failed', { err: error.message });
  });
  return historyBackupJob;
}

app.get('/api/maintenance/history', requireAnyAuth, (req, res) => {
  try {
    const { _candidate_ids, ...stats } = historyStoreStats(req.query.retention_days);
    res.json({ stats, policy: { default_retention_days: 90, prune_requires_backup: true } });
  } catch (e) {
    log('error', 'history-maintenance', 'History stats failed', { err: e.message });
    res.status(500).json({ error: 'Failed to measure history store' });
  }
});

app.post('/api/maintenance/history/backup', requireAnyAuth, (req, res) => {
  if (historyBackupJob.status !== 'running' && req.body?.reuse_recent !== false) {
    const { _candidate_ids, ...stats } = historyStoreStats();
    const latest = stats.latest_backup;
    const ageMs = latest ? Date.now() - Date.parse(latest.created_at) : Infinity;
    if (latest && latest.bytes === stats.db_bytes && ageMs < 24 * 60 * 60 * 1000) {
      historyBackupJob = {
        status: 'complete',
        completed_at: latest.created_at,
        backup: latest,
        reused: true,
      };
    }
  }
  if (historyBackupJob.status === 'complete' && historyBackupJob.reused) {
    return res.json({ ok: true, job: historyBackupJob });
  }
  const job = startHistoryBackupJob();
  res.status(job.status === 'complete' ? 200 : 202).json({ ok: true, job });
});

app.get('/api/maintenance/history/backup', requireAnyAuth, (req, res) => {
  res.json({ job: historyBackupJob });
});

app.post('/api/maintenance/history/prune', requireAnyAuth, async (req, res) => {
  const retentionDays = Math.max(1, Math.min(3650, Number(req.body?.retention_days) || 90));
  if (req.body?.confirm !== 'PRUNE_INACTIVE_HISTORY') {
    return res.status(400).json({ error: 'confirm must equal PRUNE_INACTIVE_HISTORY' });
  }
  try {
    const before = historyStoreStats(retentionDays);
    const backup = before.latest_backup;
    const backupAgeMs = backup ? Date.now() - Date.parse(backup.created_at) : Infinity;
    if (!backup || req.body?.backup_path !== backup.path || backupAgeMs > 24 * 60 * 60 * 1000) {
      return res.status(409).json({
        error: 'A completed backup from the last 24 hours must be confirmed by exact backup_path',
        latest_backup: backup || null,
      });
    }
    const deleteMessages = db.prepare('DELETE FROM messages WHERE session = ?');
    const deleteMeta = db.prepare('DELETE FROM session_meta WHERE session_id = ?');
    const deleteLatestVisible = db.prepare('DELETE FROM session_latest_visible_message WHERE session_id = ?');
    const prune = db.transaction(sessionIds => {
      let deletedMessages = 0;
      for (const sessionId of sessionIds) {
        deletedMessages += deleteMessages.run(sessionId).changes;
        deleteMeta.run(sessionId);
        deleteLatestVisible.run(sessionId);
      }
      return deletedMessages;
    });
    const deletedMessages = prune(before._candidate_ids);
    before._candidate_ids.forEach(sessionId => latestVisibleMessages.delete(sessionId));
    const { _candidate_ids, ...after } = historyStoreStats(retentionDays);
    log('warn', 'history-maintenance', 'Inactive history pruned', {
      retention_days: retentionDays,
      sessions: before._candidate_ids.length,
      messages: deletedMessages,
      backup_bytes: backup.bytes,
    });
    res.json({
      ok: true,
      retention_days: retentionDays,
      pruned_sessions: before._candidate_ids.length,
      pruned_messages: deletedMessages,
      backup,
      stats: after,
    });
  } catch (e) {
    log('error', 'history-maintenance', 'History prune failed', { err: e.message });
    res.status(500).json({ error: 'Failed to prune history store' });
  }
});

app.get('/api/automations', requireAnyAuth, (req, res) => {
  try {
    const rows = stmtListAutomations.all();
    // Parse cron_days from comma-separated string back to array
    const automations = rows.map(r => ({
      ...r,
      enabled:   !!r.enabled,
      cron_days: r.cron_days ? r.cron_days.split(',').map(Number) : [1,2,3,4,5],
    }));
    res.json({ automations });
  } catch (e) {
    log('error', 'automations', 'List failed', { err: e.message });
    res.status(500).json({ error: 'Failed to list automations' });
  }
});

app.post('/api/automations', requireAnyAuth, (req, res) => {
  const { name, description, category, prompt, schedule, cron_hour, cron_minute, cron_days, target_agent_type, target_session, enabled } = req.body;
  if (!name || !prompt) return res.status(400).json({ error: 'name and prompt are required' });
  try {
    const info = stmtInsertAutomation.run(
      name, description || '', category || 'General', prompt,
      schedule || 'daily', cron_hour ?? 9, cron_minute ?? 0,
      Array.isArray(cron_days) ? cron_days.join(',') : (cron_days || '1,2,3,4,5'),
      target_agent_type || 'claude', target_session || null,
      enabled !== false ? 1 : 0
    );
    const row = stmtGetAutomation.get(info.lastInsertRowid);
    log('info', 'automations', 'Created automation', { id: row.id, name: row.name });
    res.json({ automation: { ...row, enabled: !!row.enabled, cron_days: row.cron_days.split(',').map(Number) } });
  } catch (e) {
    log('error', 'automations', 'Create failed', { err: e.message });
    res.status(500).json({ error: 'Failed to create automation' });
  }
});

app.put('/api/automations/:id', requireAnyAuth, (req, res) => {
  const { id } = req.params;
  const existing = stmtGetAutomation.get(id);
  if (!existing) return res.status(404).json({ error: 'Automation not found' });
  const { name, description, category, prompt, schedule, cron_hour, cron_minute, cron_days, target_agent_type, target_session, enabled } = req.body;
  try {
    stmtUpdateAutomation.run(
      name ?? existing.name, description ?? existing.description, category ?? existing.category,
      prompt ?? existing.prompt, schedule ?? existing.schedule,
      cron_hour ?? existing.cron_hour, cron_minute ?? existing.cron_minute,
      Array.isArray(cron_days) ? cron_days.join(',') : (cron_days ?? existing.cron_days),
      target_agent_type ?? existing.target_agent_type, target_session ?? existing.target_session,
      (enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled),
      id
    );
    const row = stmtGetAutomation.get(id);
    log('info', 'automations', 'Updated automation', { id: row.id, name: row.name });
    res.json({ automation: { ...row, enabled: !!row.enabled, cron_days: row.cron_days.split(',').map(Number) } });
  } catch (e) {
    log('error', 'automations', 'Update failed', { err: e.message });
    res.status(500).json({ error: 'Failed to update automation' });
  }
});

app.delete('/api/automations/:id', requireAnyAuth, (req, res) => {
  const { id } = req.params;
  const existing = stmtGetAutomation.get(id);
  if (!existing) return res.status(404).json({ error: 'Automation not found' });
  try {
    stmtDeleteAutomation.run(id);
    log('info', 'automations', 'Deleted automation', { id, name: existing.name });
    res.json({ ok: true });
  } catch (e) {
    log('error', 'automations', 'Delete failed', { err: e.message });
    res.status(500).json({ error: 'Failed to delete automation' });
  }
});

// Manual trigger endpoint
app.post('/api/automations/:id/run', requireAnyAuth, (req, res) => {
  const { id } = req.params;
  const automation = stmtGetAutomation.get(id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });
  const result = executeAutomation(automation);
  if (result.ok) {
    res.json({ ok: true, session: result.session });
  } else {
    res.status(503).json({ error: result.error });
  }
});

// ── Session history endpoint ────────────────────────────────────────────────
// Returns past sessions with preview text, message counts, and timestamps.
// Used by the "Resume Session" UI in the web and Android apps.

app.get('/api/sessions/history', requireAnyAuth, historyReadRateLimit, (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 50;
    const includeTestSessions = req.query.include_test === 'true';
    const rows = stmtSessionHistory.all(includeTestSessions ? 1 : 0, limit);
    // Filter out sessions that are currently active (already in sidebar)
    const activeSessions = new Set(proxySockets.keys());
    const history = rows
      .filter(r => !activeSessions.has(r.session))
      .map(r => ({
        session_id:         r.session,
        preview:            (r.first_user_message || '').substring(0, 120),
        message_count:      r.message_count,
        created_at:         r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
        last_active_at:     r.last_active_at ? new Date(r.last_active_at * 1000).toISOString() : null,
        workspace_path:     r.workspace_path || null,
        project_root:       r.project_root || null,
        workspace_name:     r.workspace_name || null,
        agent_type:         r.agent_type || null,
        cli_session_id:     r.cli_session_id || null,
        session_kind:       r.session_kind || 'operator',
        is_test_session:    !!r.is_test_session,
        project_group:      r.project_group || null,
      }));
    res.json({ sessions: history, include_test: includeTestSessions });
  } catch (e) {
    log('error', 'session-history', 'Failed to fetch session history', { err: e.message });
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});

function transcriptSearchMatchQuery(value) {
  const tokens = String(value || '')
    .normalize('NFKC')
    .trim()
    .split(/\s+/u)
    .map(token => token.replace(/["*:^(){}\[\]]/g, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (tokens.length === 0) return '';
  return tokens.map(token => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
}

function transcriptSearchDate(value, { endOfDay = false } = {}) {
  if (value == null || value === '') return null;
  if (!boundedString(value, { max: 40 })) return NaN;
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : raw;
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : NaN;
}

app.get('/api/search/messages', requireAnyAuth, historyReadRateLimit, (req, res) => {
  try {
    if (!boundedString(req.query.q, { min: 2, max: 200 })) {
      return res.status(400).json({ error: 'Search query must be between 2 and 200 characters' });
    }
    const project = req.query.project == null ? '' : String(req.query.project).trim();
    const harness = req.query.harness == null ? '' : String(req.query.harness).trim();
    if ((project && !boundedString(project, { max: 300 })) || (harness && !boundedString(harness, { max: 80 }))) {
      return res.status(400).json({ error: 'Invalid search filter' });
    }
    const dateFrom = transcriptSearchDate(req.query.date_from);
    const dateTo = transcriptSearchDate(req.query.date_to, { endOfDay: true });
    if (Number.isNaN(dateFrom) || Number.isNaN(dateTo) || (dateFrom != null && dateTo != null && dateFrom > dateTo)) {
      return res.status(400).json({ error: 'Invalid search date range' });
    }
    const matchQuery = transcriptSearchMatchQuery(req.query.q);
    if (!matchQuery) return res.status(400).json({ error: 'Search query has no searchable terms' });
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 30;
    const where = ['message_fts MATCH ?'];
    const params = [matchQuery];
    if (project) {
      where.push(`(
        lower(COALESCE(sm.workspace_name, '')) = lower(?) OR
        lower(COALESCE(sm.project_root, '')) = lower(?) OR
        lower(COALESCE(sm.workspace_path, '')) = lower(?)
      )`);
      params.push(project, project, project);
    }
    if (harness) {
      where.push("lower(COALESCE(sm.agent_type, '')) = lower(?)");
      params.push(harness);
    }
    if (dateFrom != null) {
      where.push('m.ts >= ?');
      params.push(dateFrom);
    }
    if (dateTo != null) {
      where.push('m.ts <= ?');
      params.push(dateTo);
    }
    params.push(limit + 1);
    const rows = db.prepare(`
      SELECT
        m.id AS message_id,
        m.session AS session_id,
        m.role,
        m.sequence,
        m.ts,
        snippet(message_fts, 0, '[', ']', ' … ', 28) AS snippet,
        sm.workspace_path,
        sm.project_root,
        sm.workspace_name,
        sm.agent_type
      FROM message_fts
      JOIN messages m ON m.id = message_fts.rowid
      LEFT JOIN session_meta sm ON sm.session_id = m.session
      WHERE ${where.join(' AND ')}
      ORDER BY bm25(message_fts), m.ts DESC, m.id DESC
      LIMIT ?
    `).all(...params);
    const state = stmtTranscriptSearchState.get() || { cursor_id: 0, complete: 0 };
    const hasMore = rows.length > limit;
    const results = rows.slice(0, limit).map(row => ({
      ...row,
      matched_at: row.ts ? new Date(row.ts * 1000).toISOString() : null,
    }));
    res.json({
      query: String(req.query.q).trim(),
      results,
      has_more: hasMore,
      index: { ready: !!state.complete, cursor_id: Number(state.cursor_id) || 0 },
    });
  } catch (e) {
    log('error', 'search', 'Transcript search failed', { err: e.message });
    res.status(500).json({ error: 'Transcript search failed' });
  }
});

app.get('/api/sessions/:sessionId/export', requireAnyAuth, historyReadRateLimit, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    const format = String(req.query.format || 'markdown').toLowerCase();
    if (!boundedString(sessionId, { max: 200 })) return res.status(400).json({ error: 'Invalid session id' });
    if (!['markdown', 'json'].includes(format)) return res.status(400).json({ error: 'Export format must be markdown or json' });
    const { sourceSession } = resolveEffectiveHistorySource(sessionId);
    const rows = stmtGetExportHistory.all(sourceSession);
    const metadata = stmtGetSessionMeta.get(sessionId) || stmtGetSessionMeta.get(sourceSession) || {};
    const preference = sessionPreferencesForEmail(authenticatedEmail(req))[sessionId] || {};
    const exported = buildSessionExport({
      sessionId,
      format,
      rows,
      metadata: {
        ...metadata,
        display_name: preference.display_name || null,
        source_session_id: sourceSession !== sessionId ? sourceSession : null,
      },
    });
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(exported.body);
  } catch (e) {
    log('error', 'session-export', 'Session export failed', { err: e.message, session: req.params.sessionId });
    res.status(500).json({ error: 'Session export failed' });
  }
});

app.get('/api/scheduled-sends', requireAnyAuth, historyReadRateLimit, (req, res) => {
  const sessionId = req.query.session_id ? String(req.query.session_id).trim() : null;
  if (sessionId && !isValidSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  res.json({ scheduled_sends: scheduledSends.list(authenticatedEmail(req), sessionId) });
});

app.post('/api/scheduled-sends', requireAnyAuth, scheduledSendMutationRateLimit, express.json({ limit: '600kb' }), (req, res) => {
  try {
    const sessionId = String(req.body?.session_id || '').trim();
    if (!isValidSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
    const job = scheduledSends.create({
      ownerEmail: authenticatedEmail(req),
      sessionId,
      content: req.body?.content,
      triggerKind: req.body?.trigger_kind,
      deliverAt: req.body?.deliver_at,
    });
    broadcastScheduledSend(job);
    res.status(201).json({ scheduled_send: job });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/scheduled-sends/:id', requireAnyAuth, scheduledSendMutationRateLimit, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!boundedString(id, { max: 100 })) return res.status(400).json({ error: 'Invalid scheduled send id' });
  const job = scheduledSends.cancel(authenticatedEmail(req), id);
  if (!job) return res.status(404).json({ error: 'Pending scheduled send not found' });
  broadcastScheduledSend(job);
  res.json({ scheduled_send: job });
});

app.get('/api/sessions/:sessionId/messages', requireAnyAuth, historyReadRateLimit, (req, res) => {
  try {
    if (!boundedString(req.params.sessionId, { max: 200 })) {
      return res.status(400).json({ error: 'Invalid session id' });
    }
    const hasLimitParameter = req.query.limit !== undefined
      || req.query.tail_limit !== undefined
      || req.query.history_limit !== undefined;
    const requestedLimit = req.query.full === 'true'
      ? 0
      : Number(req.query.limit || req.query.tail_limit || req.query.history_limit || 0);
    if (req.query.full !== 'true' && hasLimitParameter
      && (!Number.isFinite(requestedLimit) || requestedLimit <= 0)) {
      return res.status(400).json({ error: 'History limit must be a positive number' });
    }
    if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
      const limit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
      const result = getEffectiveHistoryTail(req.params.sessionId, limit);
      res.json({
        messages: result.messages,
        partial: result.total > result.loaded,
        total_messages: result.total,
        loaded_messages: result.loaded,
        limit,
        mode: 'tail',
      });
      return;
    }
    const messages = getEffectiveHistory(req.params.sessionId);
    res.json({
      messages,
      partial: false,
      total_messages: messages.length,
      loaded_messages: messages.length,
      mode: 'full',
    });
  } catch (e) {
    log('error', 'session-history', 'Failed to fetch session messages', { err: e.message });
    res.status(500).json({ error: 'Failed to fetch session messages' });
  }
});

// ── Static frontend (A2-06) ───────────────────────────────────────────────────
// Frontend files are synced to relay-server/public/ by the deploy script
// (tools/rebuild_unraid_docker.py copies frontend/ → public/ before docker build).
// The Dockerfile's COPY picks them up from there.

const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// manifest.json must be served as application/manifest+json for Chrome's install prompt.
// Served WITHOUT auth — Cloudflare Access blocks the browser's manifest fetch (no cookies),
// causing CORS errors. The manifest contains no sensitive data.
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(PUBLIC_DIR, 'manifest.json'));
});

// Preserve browser OAuth redirects while allowing headless/native clients to
// fetch the exact served app shell with a scoped, signed bearer JWT.
app.use('/', requireBrowserOrBearerAuth, express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    const lower = String(filePath || '').toLowerCase();
    if (lower.endsWith(path.sep + 'index.html') || lower.endsWith('/index.html') || lower.endsWith('\\index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return;
    }
    if (lower.endsWith(path.sep + 'sw.js') || lower.endsWith('/sw.js') || lower.endsWith('\\sw.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return;
    }
    if (/([\\/])dist[\\/].+\.js$/i.test(lower) || lower.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  },
}));

// ── Runtime state ─────────────────────────────────────────────────────────────

const proxySockets    = new Map();  // sessionId → proxy WebSocket
const sessionProxyId  = new Map();  // sessionId → proxy_id that owns it (A6-05)
const proxyConnections = new Set(); // all live proxy WebSocket connections (for launch routing)
const sessionControlGeneration = new Map(); // sessionId -> native owner generation
const sessionTurnGeneration = new Map(); // sessionId -> authoritative working edge generation
const proxySessionClaims = new Map(); // proxy WebSocket -> { proxy_id, sessions }
const browserClients  = new Set();  // all connected browser WebSockets
const watchdogFailureIncidents = new Map(); // incidentId -> accepted timestamp
const sessionMeta     = new Map();  // sessionId → latest proxy session metadata
const sessionHealth   = new Map();  // sessionId → 'healthy'|'degraded'|'disconnected'
const sessionLastSeen = new Map();  // sessionId → Date.now() of last activity
const sessionActivity = new Map();  // sessionId → last known activity kind (A12-02)
const usageThresholds = new UsageThresholdTracker();
const providerUsageAuthority = new ProviderUsageAuthority();
let cachedProviderUsage = null; // normalized, redacted, memory-only; never persisted to SQLite
let cachedProviderUsageProxyId = null;
let cachedProviderUsageMachineLabel = null;
const sendLifecycle = new SendLifecycleTracker();
const MAX_SESSION_SUBSCRIPTIONS = 128;
const SESSION_SUMMARY_SNIPPET_CHARS = 192;
const SESSION_SUMMARY_BROADCAST_COALESCE_MS = 100;

function canonicalizeSessionMessage(message) {
  if (!message || typeof message !== 'object'
      || message.type === 'session_alias_reconciled'
      || message.type === 'session_alias_released'
      || isSurfaceScopedSessionMessage(message)) return message;
  let changed = false;
  const next = { ...message };
  for (const key of ['session', 'session_id']) {
    if (typeof next[key] !== 'string') continue;
    const canonical = sessionAliases.resolve(next[key]);
    if (canonical === next[key]) continue;
    next[key] = canonical;
    changed = true;
  }
  if (next.message && typeof next.message === 'object' && typeof next.message.session_id === 'string') {
    const canonical = sessionAliases.resolve(next.message.session_id);
    if (canonical !== next.message.session_id) {
      next.message = { ...next.message, session_id: canonical };
      changed = true;
    }
  }
  return changed ? next : message;
}

function moveRuntimeSessionEntry(map, aliasId, canonicalId, merge = (canonical, alias) => canonical ?? alias) {
  if (!map?.has?.(aliasId)) return false;
  const alias = map.get(aliasId);
  const canonical = map.get(canonicalId);
  map.set(canonicalId, merge(canonical, alias));
  map.delete(aliasId);
  return true;
}

function migrateKeyedPromptMap(map, aliasId, canonicalId) {
  let changed = 0;
  for (const [key, value] of [...map]) {
    if (!String(key).startsWith(`${aliasId}:`) && !String(key).startsWith(`${aliasId}\0`)) continue;
    const suffix = String(key).slice(aliasId.length);
    const nextKey = `${canonicalId}${suffix}`;
    const prompt = value?.prompt && typeof value.prompt === 'object'
      ? { ...value.prompt, session_id: canonicalId, session: canonicalId }
      : value?.prompt;
    if (!map.has(nextKey)) map.set(nextKey, prompt ? { ...value, prompt } : value);
    map.delete(key);
    changed += 1;
  }
  return changed;
}

function migrateRuntimeSessionAlias(aliasId, canonicalId, event) {
  const counts = { maps: 0, prompts: 0, subscriptions: 0, claims: 0 };
  const canonicalMeta = sessionMeta.get(canonicalId) || {};
  const aliasMeta = sessionMeta.get(aliasId) || {};
  const nextMeta = {
    ...aliasMeta,
    ...canonicalMeta,
    session_id: canonicalId,
    canonical_session_id: canonicalId,
    canonical_conversation_id: event.canonical_conversation_id || canonicalMeta.canonical_conversation_id || null,
    canonical_native_id: event.canonical_native_id || canonicalMeta.canonical_native_id || null,
    current_surface: event.current_surface || canonicalMeta.current_surface || null,
    current_surface_label: event.current_surface_label || canonicalMeta.current_surface_label || null,
  };
  if (sessionMeta.has(aliasId) || sessionMeta.has(canonicalId)) {
    sessionMeta.set(canonicalId, nextMeta);
    sessionMeta.delete(aliasId);
    counts.maps += 1;
  }
  counts.maps += moveRuntimeSessionEntry(proxySockets, aliasId, canonicalId) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionProxyId, aliasId, canonicalId) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionHealth, aliasId, canonicalId, (canonical, alias) => canonical || alias) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionLastSeen, aliasId, canonicalId,
    (canonical, alias) => Math.max(Number(canonical) || 0, Number(alias) || 0)) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionActivity, aliasId, canonicalId) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionSeq, aliasId, canonicalId,
    (canonical, alias) => Math.max(Number(canonical) || 0, Number(alias) || 0)) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionControlGeneration, aliasId, canonicalId,
    (canonical, alias) => Math.max(Number(canonical) || 0, Number(alias) || 0)) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(sessionTurnGeneration, aliasId, canonicalId,
    (canonical, alias) => Math.max(Number(canonical) || 0, Number(alias) || 0)) ? 1 : 0;
  if (canMigrateSurfaceScopedState(aliasMeta, canonicalMeta)) {
    counts.maps += moveRuntimeSessionEntry(agentConfigs, aliasId, canonicalId,
      (canonical, alias) => ({ ...(alias || {}), ...(canonical || {}), session_id: canonicalId, session: canonicalId })) ? 1 : 0;
  }
  counts.maps += moveRuntimeSessionEntry(cachedChatLists, aliasId, canonicalId,
    (canonical, alias) => ({ ...(alias || {}), ...(canonical || {}), session_id: canonicalId, session: canonicalId })) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(recentResumeSessions, aliasId, canonicalId) ? 1 : 0;
  counts.maps += moveRuntimeSessionEntry(latestVisibleMessages, aliasId, canonicalId,
    (canonical, alias) => {
      const selected = Number(alias?.message_at || 0) > Number(canonical?.message_at || 0) ? alias : canonical || alias;
      return selected ? { ...selected, session_id: canonicalId } : selected;
    }) ? 1 : 0;
  counts.prompts += migrateKeyedPromptMap(pendingPrompts, aliasId, canonicalId);
  counts.prompts += migrateKeyedPromptMap(questionPromptTimers, aliasId, canonicalId);
  counts.prompts += migrateKeyedPromptMap(pendingErrorPrompts, aliasId, canonicalId);
  counts.prompts += questionPromptRegistry.migrateSession(aliasId, canonicalId);
  for (const claim of proxySessionClaims.values()) {
    if (!claim.sessions.delete(aliasId)) continue;
    claim.sessions.add(canonicalId);
    counts.claims += 1;
  }
  for (const client of browserClients) {
    if (client._sessionSubscriptions instanceof Set && client._sessionSubscriptions.delete(aliasId)) {
      client._sessionSubscriptions.add(canonicalId);
      counts.subscriptions += 1;
    }
    if (client._transcriptGaps instanceof Map && client._transcriptGaps.has(aliasId)) {
      if (!client._transcriptGaps.has(canonicalId)) client._transcriptGaps.set(canonicalId, client._transcriptGaps.get(aliasId));
      client._transcriptGaps.delete(aliasId);
    }
  }
  for (const summaries of pendingBrowserSessionSummaries.values()) {
    if (!summaries.has(aliasId)) continue;
    const alias = summaries.get(aliasId);
    summaries.set(canonicalId, mergeSessionSummary(summaries.get(canonicalId), {
      ...alias, session_id: canonicalId, session: canonicalId,
    }));
    summaries.delete(aliasId);
  }
  recomputeLatestVisibleMessage(canonicalId);
  return counts;
}

function normalizedLatestVisibleMessageRow(row) {
  if (!row) return null;
  const messageId = String(row.message_id || '').trim();
  const messageAt = Number(row.message_at);
  const kind = canonicalVisibleMessageKind(row.kind);
  const source = canonicalLatestMessageSource(row.source);
  if (!messageId || !Number.isFinite(messageAt) || messageAt <= 0 || !kind || !source) return null;
  return {
    session_id: String(row.session_id || ''),
    message_row_id: Number(row.message_row_id) || null,
    message_id: messageId,
    message_at: messageAt,
    kind,
    source,
  };
}

function latestVisibleMessageProjection(sessionId) {
  const latest = normalizedLatestVisibleMessageRow(latestVisibleMessages.get(sessionId));
  if (!latest) return {};
  const at = timestampSecondsIso(latest.message_at);
  if (!at) return {};
  return {
    latest_visible_message: {
      id: latest.message_id,
      at,
      kind: latest.kind,
      source: latest.source,
    },
    last_message_id: latest.message_id,
    last_message_at: at,
    last_message_kind: latest.kind,
    last_message_source: latest.source,
  };
}

function recordLatestVisibleMessageInsert(info, sessionId, role, suppliedTs, source, sourceMessageId = null) {
  if (!info || Number(info.changes) <= 0 || !sessionId) return false;
  const kind = canonicalVisibleMessageKind(role);
  const messageId = durableVisibleMessageId(info.lastInsertRowid, sourceMessageId);
  if (!kind || !messageId) return false;
  let messageAt = Number(suppliedTs);
  if (!Number.isFinite(messageAt) || messageAt <= 0) {
    messageAt = Number(stmtGetMessageTimestampById.get(info.lastInsertRowid)?.ts);
  }
  if (!Number.isFinite(messageAt) || messageAt <= 0) return false;
  const normalizedSource = canonicalLatestMessageSource(source);
  const updated = stmtUpsertLatestVisibleMessage.run(
    sessionId,
    info.lastInsertRowid,
    messageId,
    messageAt,
    kind,
    normalizedSource,
  );
  if (updated.changes > 0) {
    latestVisibleMessages.set(sessionId, {
      session_id: sessionId,
      message_row_id: Number(info.lastInsertRowid),
      message_id: messageId,
      message_at: messageAt,
      kind,
      source: normalizedSource,
    });
  }
  return updated.changes > 0;
}

function clearLatestVisibleMessage(sessionId) {
  if (!sessionId) return;
  stmtReplaceLatestVisibleMessage.run(sessionId, null, null, null, null, null);
  latestVisibleMessages.delete(sessionId);
}

function recomputeLatestVisibleMessage(sessionId) {
  if (!sessionId) return null;
  const row = stmtFindLatestVisibleMessageRow.get(sessionId);
  if (!row) {
    clearLatestVisibleMessage(sessionId);
    return null;
  }
  const kind = canonicalVisibleMessageKind(row.role);
  const messageId = durableVisibleMessageId(row.message_row_id, row.source_message_id);
  const messageAt = Number(row.ts);
  if (!kind || !messageId || !Number.isFinite(messageAt) || messageAt <= 0) {
    clearLatestVisibleMessage(sessionId);
    return null;
  }
  const source = canonicalLatestMessageSource(row.source);
  stmtReplaceLatestVisibleMessage.run(
    sessionId,
    row.message_row_id,
    messageId,
    messageAt,
    kind,
    source,
  );
  const latest = {
    session_id: sessionId,
    message_row_id: Number(row.message_row_id),
    message_id: messageId,
    message_at: messageAt,
    kind,
    source,
  };
  latestVisibleMessages.set(sessionId, latest);
  return latest;
}

function mergeProviderUsageCache(previous, incoming, options = {}) {
  if (!incoming || typeof incoming !== 'object') return previous;
  const sameProxy = !!previous && !!options.previousProxyId
    && options.previousProxyId === options.proxyId;
  const sameMachine = !!previous && !!options.previousMachineLabel
    && options.previousMachineLabel === options.machineLabel;
  const sameLogicalProxy = sameProxy || sameMachine;
  const previousSnapshots = Array.isArray(previous?.snapshots) ? previous.snapshots : [];
  const incomingSnapshots = Array.isArray(incoming.snapshots) ? incoming.snapshots : [];
  let snapshots = incomingSnapshots;
  let generation = Number(incoming.generation) || 0;
  // A new process starts collection at generation 0 and may emit partial
  // provider results while its independent cost scan completes. None of those
  // frames are authoritative yet, even when one or two providers have already
  // finished, so keep the prior process's complete quota set until generation
  // 1 proves that the replacement collection finished.
  const restartPlaceholder = sameLogicalProxy && previousSnapshots.length > 0
    && generation === 0;
  if (restartPlaceholder) {
    snapshots = previousSnapshots;
    generation = Math.max(generation, Number(previous.generation) || 0);
  }

  let estimatedCost = incoming.estimated_cost ?? null;
  const previousCost = previous?.estimated_cost;
  if (sameLogicalProxy && previousCost && ['ready', 'partial', 'stale'].includes(previousCost.status)
      && (restartPlaceholder
        || !estimatedCost
        || ['error', 'unavailable', 'cancelled'].includes(estimatedCost.status))) {
    estimatedCost = {
      ...previousCost,
      status: 'stale',
      reason_code: estimatedCost?.reason_code
        || (restartPlaceholder ? 'proxy_restarting' : 'cost_refresh_failed'),
      reason_path: estimatedCost?.reason_path || null,
      last_good_generated_at: previousCost.generated_at || previousCost.last_good_generated_at || null,
    };
  }
  return { ...incoming, generation, snapshots, estimated_cost: estimatedCost };
}

function authenticatedProxyConnectionCount() {
  let count = 0;
  for (const ws of proxyConnections) {
    if (ws._authenticated && ws.readyState === WebSocket.OPEN) count += 1;
  }
  return count;
}

function broadcastProxyWatchdogStatus(status, details) {
  broadcastToBrowsers({
    type: 'proxy_watchdog_status',
    status,
    ...details,
    server_ts: new Date().toISOString(),
  });
}

const proxyOutageMonitor = new ProxyOutageMonitor({
  graceMs: PROXY_OUTAGE_GRACE_MS,
  onOffline: details => {
    log('error', 'proxy-watchdog', 'All authenticated proxy connections have been offline beyond grace', details);
    broadcastProxyWatchdogStatus('offline', details);
    sendPushNotification(
      'Agent proxy is offline',
      'Remote harness sessions have been unavailable for more than two minutes. Automatic recovery is running.',
      { type: 'proxy_offline', activity_type: 'offline', incident_id: details.incident_id,
        missing_since: details.missing_since, missing_ms: details.missing_ms },
    ).catch(() => {});
  },
  onRecovered: details => {
    log('info', 'proxy-watchdog', 'Authenticated proxy connection recovered', details);
    broadcastProxyWatchdogStatus('recovered', details);
    sendPushNotification(
      'Agent proxy recovered',
      'Remote harness sessions are reachable again.',
      { type: 'proxy_recovered', activity_type: 'idle', incident_id: details.incident_id,
        recovered_at: details.recovered_at, missing_ms: details.missing_ms },
    ).catch(() => {});
  },
});

function sessionGoal(sessionId) {
  const meta = sessionMeta.get(sessionId);
  return meta?.activity?.goal || meta?.goal || null;
}

function broadcastUsageResume(type, job, extra = {}) {
  broadcastToBrowsers({
    type,
    protocol_version: PROTOCOL_VERSION,
    session_id: job.session_id,
    goal_objective: job.goal_objective,
    reset_at: job.reset_at,
    attempts: Number(job.attempts || 0),
    client_message_id: job.client_msg_id || null,
    server_ts: new Date().toISOString(),
    ...extra,
  });
}

function scheduleUsageResume(sessionId, resetHint, goal = sessionGoal(sessionId)) {
  if (!sessionId || !isResumableGoal(goal)) return null;
  const resetAt = parseResetAt(resetHint);
  if (!resetAt) {
    log('warn', 'usage-resume', 'Goal resume not scheduled because reset time is unreadable', {
      session: sessionId, reset_hint: resetHint || null,
    });
    return null;
  }
  const fingerprint = goalFingerprint(goal);
  const normalizedResetHint = String(resetHint).trim();
  const existing = db.prepare('SELECT * FROM usage_resume_jobs WHERE session_id = ?').get(sessionId);
  if (existing?.state === 'dispatching') return existing;
  if (
    existing
    && existing.goal_fingerprint === fingerprint
    && existing.reset_hint === normalizedResetHint
    && !existing.cycle_cleared
  ) return existing;

  const objective = goalObjective(goal).slice(0, 2000);
  const nowIso = new Date().toISOString();
  const nextAttemptAt = new Date(Math.max(Date.now(), Date.parse(resetAt))).toISOString();
  db.prepare(`
    INSERT INTO usage_resume_jobs
      (session_id, goal_fingerprint, goal_objective, reset_hint, reset_at, state, cycle_cleared,
       attempts, next_attempt_at, client_msg_id, last_error, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, ?, NULL, NULL, ?, ?, NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      goal_fingerprint = excluded.goal_fingerprint,
      goal_objective = excluded.goal_objective,
      reset_hint = excluded.reset_hint,
      reset_at = excluded.reset_at,
      state = 'pending',
      cycle_cleared = 0,
      attempts = 0,
      next_attempt_at = excluded.next_attempt_at,
      client_msg_id = NULL,
      last_error = NULL,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      completed_at = NULL
  `).run(sessionId, fingerprint, objective, normalizedResetHint, resetAt, nextAttemptAt, nowIso, nowIso);
  const job = db.prepare('SELECT * FROM usage_resume_jobs WHERE session_id = ?').get(sessionId);
  broadcastUsageResume('usage_resume_scheduled', job);
  log('info', 'usage-resume', 'Scheduled goal resume', { session: sessionId, reset_at: resetAt });
  return job;
}

function applyProviderUsageSessionLinks(snapshotPayload, allowedSessionIds = null) {
  const allowed = allowedSessionIds instanceof Set ? allowedSessionIds : null;
  const snapshots = Array.isArray(snapshotPayload?.snapshots) ? snapshotPayload.snapshots : [];
  if (snapshots.length === 0 && (Number(snapshotPayload?.generation) === 0 || snapshotPayload?.in_flight === true)) return;
  const candidatesBySession = new Map();
  for (const snapshot of snapshots) {
    for (const sessionId of matchingSessionIds(snapshot, sessionMeta, allowed)) {
      if (!candidatesBySession.has(sessionId)) candidatesBySession.set(sessionId, []);
      candidatesBySession.get(sessionId).push({
        providerId: String(snapshot.provider_id || ''),
        accountFingerprint: String(snapshot.account_fingerprint || ''),
        quotaDomain: String(snapshot.quota_domain || ''),
        capturedAt: String(snapshot.captured_at || snapshotPayload.generated_at || ''),
      });
    }
  }
  const sessionIds = allowed ? [...allowed] : [...candidatesBySession.keys()];
  for (const sessionId of sessionIds) {
    const previous = sessionMeta.get(sessionId);
    if (!previous || typeof previous !== 'object') continue;
    const candidates = candidatesBySession.get(sessionId) || [];
    const next = { ...previous };
    for (const key of [
      'usage_billing_provider_id', 'usage_account_fingerprint', 'usage_quota_domain',
      'usage_mapping_generation', 'usage_mapping_captured_at', 'usage_mapping_ambiguous',
    ]) delete next[key];
    if (candidates.length === 1) {
      const candidate = candidates[0];
      next.usage_billing_provider_id = candidate.providerId;
      next.usage_account_fingerprint = candidate.accountFingerprint;
      next.usage_quota_domain = candidate.quotaDomain;
      next.usage_mapping_generation = Number(snapshotPayload?.generation) || 0;
      next.usage_mapping_captured_at = candidate.capturedAt;
      next.usage_mapping_ambiguous = false;
    } else if (candidates.length > 1) {
      const providerIds = [...new Set(candidates.map(candidate => candidate.providerId).filter(Boolean))];
      if (providerIds.length === 1) next.usage_billing_provider_id = providerIds[0];
      next.usage_mapping_generation = Number(snapshotPayload?.generation) || 0;
      next.usage_mapping_captured_at = String(snapshotPayload?.generated_at || '');
      next.usage_mapping_ambiguous = true;
    }
    if (isDeepStrictEqual(previous, next)) continue;
    sessionMeta.set(sessionId, next);
    queueSessionPatchBroadcast(sessionId, previous, next);
  }
}

function applyProviderUsageAuthority(snapshot, proxyWs) {
  const allowedSessionIds = proxySessionClaims.get(proxyWs)?.sessions || null;
  applyProviderUsageSessionLinks(snapshot, allowedSessionIds);
  const alerts = providerUsageAuthority.observe(snapshot, sessionMeta, allowedSessionIds);
  for (const alert of alerts) {
    for (const sessionId of alert.affectedSessionIds) {
      if (!sessionMeta.has(sessionId)) continue;
      sessionMeta.set(sessionId, {
        ...sessionMeta.get(sessionId),
        percent_used: alert.percentUsed,
        rate_limit_active: alert.hardLimited,
        rate_limited_until: alert.resetHint || 'unknown',
        usage_limit_provider: alert.providerId || null,
        usage_limit_window: alert.windowLabel || alert.windowId || null,
        last_seen_at: new Date().toISOString(),
      });
    }
    if (alert.hardLimited && alert.resetHint) {
      for (const sessionId of alert.affectedSessionIds) {
        scheduleUsageResume(sessionId, alert.resetHint);
      }
    }
    broadcastToBrowsers({
      type: 'provider_usage_threshold',
      protocol_version: PROTOCOL_VERSION,
      provider_id: alert.providerId,
      account_label: alert.accountLabel,
      window_id: alert.windowId,
      window_label: alert.windowLabel,
      threshold: alert.threshold,
      percent_used: alert.percentUsed,
      hard_limited: alert.hardLimited,
      reset_hint: alert.resetHint,
      affected_session_ids: alert.affectedSessionIds,
      server_ts: new Date().toISOString(),
    });
    const notification = buildUsageThresholdNotification(
      `${alert.providerName} ${alert.windowLabel}`,
      alert.threshold,
      alert.percentUsed,
      alert.resetHint,
    );
    const primarySessionId = alert.affectedSessionIds[0] || '';
    if (primarySessionId) {
      const createdAt = new Date().toISOString();
      const cycleDigest = crypto.createHash('sha256')
        .update(String(alert.cycleKey || ''), 'utf8').digest('hex').slice(0, 32);
      const semanticEvent = goalNotifications.recordExternalEvent({
        type: 'semantic_notification',
        event_type: 'provider_usage_threshold',
        category: 'provider_usage_warning',
        dedupe_key: `provider-usage-threshold:${cycleDigest}:${alert.threshold}`,
        session_id: primarySessionId,
        session_name: notificationSessionName(primarySessionId),
        title: notification.title,
        body: notification.body.slice(0, 180),
        activity_type: alert.hardLimited ? 'rate_limit' : 'usage_warning',
        created_at: createdAt,
        harness: 'provider_usage',
        goal_affiliation: 'provider_usage',
        provider_id: alert.providerId,
        account_label: alert.accountLabel,
        window_id: alert.windowId || '',
        window_label: alert.windowLabel,
        threshold: alert.threshold,
        percent_used: alert.percentUsed,
        hard_limited: alert.hardLimited,
        reset_hint: alert.resetHint || '',
        affected_session_ids: alert.affectedSessionIds,
      }, {
        harness: 'provider_usage',
        goalAffiliation: 'provider_usage',
        occurredAt: createdAt,
        metadata: { source: 'provider_usage_snapshot' },
      });
      if (semanticEvent) dispatchSemanticNotification(semanticEvent);
    }
    log('info', 'provider-usage', 'Provider usage threshold crossed', {
      provider: alert.providerId,
      window: alert.windowId,
      threshold: alert.threshold,
      affected_sessions: alert.affectedSessionIds.length,
    });
  }
}

function failOrRetryUsageResume(job, error) {
  const attempts = Number(job.attempts || 0) + 1;
  const errorText = String(error || 'Session is not connected').slice(0, 500);
  if (attempts >= USAGE_RESUME_MAX_ATTEMPTS) {
    db.prepare(`
      UPDATE usage_resume_jobs
      SET state = 'failed', attempts = ?, last_error = ?, next_attempt_at = NULL,
          updated_at = ?, completed_at = ?
      WHERE session_id = ? AND state = 'pending'
    `).run(attempts, errorText, new Date().toISOString(), new Date().toISOString(), job.session_id);
    const failed = db.prepare('SELECT * FROM usage_resume_jobs WHERE session_id = ?').get(job.session_id);
    broadcastUsageResume('usage_resume_failed', failed, { error: errorText });
    if (shouldSendPush()) {
      const name = notificationSessionName(job.session_id);
      sendPushNotification(
        `${name} could not auto-resume`,
        `The usage reset passed, but the session stayed unavailable after ${attempts} attempts.`,
        { type: 'agent_error', activity_type: 'error', session_id: job.session_id, session_name: name },
      ).catch(() => {});
    }
    return;
  }
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
  db.prepare(`
    UPDATE usage_resume_jobs
    SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
    WHERE session_id = ? AND state = 'pending'
  `).run(attempts, errorText, nextAttemptAt, new Date().toISOString(), job.session_id);
  log('warn', 'usage-resume', 'Auto-resume deferred', {
    session: job.session_id, attempts, next_attempt_at: nextAttemptAt, error: errorText,
  });
}

function processUsageResumeJobs() {
  const nowIso = new Date().toISOString();
  const jobs = db.prepare(`
    SELECT * FROM usage_resume_jobs
    WHERE state = 'pending' AND reset_at <= ? AND COALESCE(next_attempt_at, reset_at) <= ?
    ORDER BY reset_at ASC LIMIT 20
  `).all(nowIso, nowIso);
  for (const job of jobs) {
    const goal = sessionGoal(job.session_id);
    const state = goalState(goal);
    if (goal && !isResumableGoal(goal)) {
      db.prepare(`
        UPDATE usage_resume_jobs
        SET state = 'cancelled', last_error = ?, updated_at = ?, completed_at = ?
        WHERE session_id = ? AND state = 'pending'
      `).run(`Goal entered terminal state: ${state || 'unknown'}`, nowIso, nowIso, job.session_id);
      broadcastUsageResume('usage_resume_cancelled', { ...job, state: 'cancelled' }, { goal_state: state });
      continue;
    }
    const proxyWs = proxySockets.get(job.session_id);
    if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
      failOrRetryUsageResume(job, 'Session is not connected');
      continue;
    }

    const clientMessageId = resumeClientMessageId(job.session_id, job.reset_at, job.goal_fingerprint);
    const claimed = db.prepare(`
      UPDATE usage_resume_jobs
      SET state = 'dispatching', client_msg_id = ?, updated_at = ?, last_error = NULL
      WHERE session_id = ? AND state = 'pending'
    `).run(clientMessageId, nowIso, job.session_id);
    if (claimed.changes !== 1) continue;

    const content = 'continue';
    const sequence = nextSeq(job.session_id);
    let serverMessageId = null;
    try {
      insertMessageIdempotent(job.session_id, 'user', content, clientMessageId, 'pending', sequence);
      serverMessageId = stmtGetByClientId.get(clientMessageId)?.id || null;
      proxyWs.send(JSON.stringify({
        type: 'send', session: job.session_id, content,
        client_message_id: clientMessageId, usage_auto_resume: true,
      }));
      broadcastToBrowsers({
        type: 'message', session: job.session_id, role: 'user', content,
        client_message_id: clientMessageId, server_message_id: serverMessageId,
        sequence, status: 'pending', ts: Math.floor(Date.now() / 1000),
        usage_auto_resume: true,
      });
      broadcastUsageResume('usage_resume_dispatching', { ...job, client_msg_id: clientMessageId });
      log('info', 'usage-resume', 'Dispatched goal resume', {
        session: job.session_id, client_message_id: clientMessageId,
      });
    } catch (error) {
      db.prepare(`
        UPDATE usage_resume_jobs
        SET state = 'failed', last_error = ?, updated_at = ?, completed_at = ?
        WHERE session_id = ? AND state = 'dispatching'
      `).run(String(error.message || error).slice(0, 500), nowIso, nowIso, job.session_id);
      broadcastUsageResume('usage_resume_failed', { ...job, client_msg_id: clientMessageId }, {
        error: String(error.message || error),
      });
    }
  }
}

function settleUsageResumeFromProxy(msg) {
  const clientMessageId = msg.client_message_id;
  if (!clientMessageId || !clientMessageId.startsWith('usage-resume-')) return null;
  const job = db.prepare('SELECT * FROM usage_resume_jobs WHERE client_msg_id = ?').get(clientMessageId);
  if (!job || job.state !== 'dispatching') return job || null;
  const nowIso = new Date().toISOString();
  if (msg.result === 'delivered') {
    db.prepare(`
      UPDATE usage_resume_jobs
      SET state = 'completed', updated_at = ?, completed_at = ?, last_error = NULL
      WHERE client_msg_id = ? AND state = 'dispatching'
    `).run(nowIso, nowIso, clientMessageId);
    const completed = { ...job, state: 'completed', completed_at: nowIso };
    broadcastUsageResume('usage_resume_started', completed);
    if (shouldSendPush()) {
      const name = notificationSessionName(job.session_id);
      sendPushNotification(
        `${name} resumed after reset`,
        String(job.goal_objective || 'The paused goal is running again.').slice(0, 180),
        {
          type: 'rate_limit_resumed', activity_type: 'working',
          session_id: job.session_id, session_name: name, reset_at: job.reset_at,
        },
      ).catch(() => {});
    }
    return completed;
  }
  if (msg.result === 'failed') {
    const errorText = String(msg.error?.message || msg.error || 'Proxy rejected the auto-resume').slice(0, 500);
    db.prepare(`
      UPDATE usage_resume_jobs
      SET state = 'failed', last_error = ?, updated_at = ?, completed_at = ?
      WHERE client_msg_id = ? AND state = 'dispatching'
    `).run(errorText, nowIso, nowIso, clientMessageId);
    const failed = { ...job, state: 'failed', last_error: errorText, completed_at: nowIso };
    broadcastUsageResume('usage_resume_failed', failed, { error: errorText });
    if (shouldSendPush()) {
      const name = notificationSessionName(job.session_id);
      sendPushNotification(
        `${name} auto-resume failed`, errorText,
        { type: 'agent_error', activity_type: 'error', session_id: job.session_id, session_name: name },
      ).catch(() => {});
    }
    return failed;
  }
  return job;
}

function broadcastScheduledSend(job) {
  if (!job) return;
  const ownerEmail = scheduledSends.ownerEmail(job.id);
  if (!ownerEmail) return;
  const data = JSON.stringify({
    type: 'scheduled_send_status',
    scheduled_send: job,
    server_ts: new Date().toISOString(),
  });
  for (const ws of browserClients) {
    if (ws.readyState === WebSocket.OPEN && ws._authenticatedEmail === ownerEmail) ws.send(data);
  }
}

function dispatchScheduledSend(job) {
  if (!job || job.state !== 'pending') return false;
  const proxyWs = proxySockets.get(job.session_id);
  if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) return false;
  const claimed = scheduledSends.claim(job.id);
  if (!claimed) return false;
  const sequence = nextSeq(claimed.session_id);
  try {
    insertMessageIdempotent(
      claimed.session_id, 'user', claimed.content,
      claimed.client_message_id, 'pending', sequence,
    );
    const row = stmtGetByClientId.get(claimed.client_message_id);
    proxyWs.send(JSON.stringify({
      type: 'send', session: claimed.session_id, content: claimed.content,
      client_message_id: claimed.client_message_id, scheduled_send_id: claimed.id,
    }));
    broadcastToBrowsers({
      type: 'message', session: claimed.session_id, role: 'user', content: claimed.content,
      client_message_id: claimed.client_message_id, server_message_id: row?.id || null,
      sequence: row?.sequence || sequence, status: 'pending',
      ts: row?.ts || Math.floor(Date.now() / 1000), scheduled_send_id: claimed.id,
    });
    broadcastScheduledSend(claimed);
    log('info', 'scheduled-send', 'Dispatched scheduled send', {
      id: claimed.id, session: claimed.session_id, trigger: claimed.trigger_kind,
    });
    return true;
  } catch (error) {
    const failed = scheduledSends.settle(claimed.client_message_id, 'failed', error.message || error);
    broadcastScheduledSend(failed);
    return false;
  }
}

function processScheduledSendJobs() {
  for (const job of scheduledSends.dueAt()) dispatchScheduledSend(job);
}

function dispatchIdleScheduledSends(sessionId) {
  for (const job of scheduledSends.dueIdle(sessionId)) dispatchScheduledSend(job);
}

function settleScheduledSendFromProxy(msg) {
  if (!String(msg.client_message_id || '').startsWith('scheduled-send-')) return null;
  const job = scheduledSends.settle(
    msg.client_message_id,
    msg.result,
    msg.error?.message || msg.error || null,
  );
  if (job?.client_message_id) {
    db.prepare('UPDATE messages SET status = ? WHERE client_msg_id = ?')
      .run(job.state === 'completed' ? 'delivered' : 'failed', job.client_message_id);
  }
  broadcastScheduledSend(job);
  return job;
}

const usageResumeTimer = setInterval(processUsageResumeJobs, USAGE_RESUME_TICK_MS);
usageResumeTimer.unref?.();
const scheduledSendTimer = setInterval(processScheduledSendJobs, 1_000);
scheduledSendTimer.unref?.();
const FULL_FIDELITY_SESSION_TYPES = new Set([
  'message', 'proxy_message', 'message_event',
  'message_delta',
  'status', 'proxy_status', 'session_status',
]);

function shouldSendPush() {
  return NOTIFY_EVEN_IF_CONNECTED || browserClients.size === 0;
}

function notificationSessionName(sessionId) {
  const meta = sessionMeta.get(sessionId) || {};
  return meta.display_name || meta.name || meta.session_name || meta.workspace_name
    || String(sessionId || 'Agent').slice(0, 32);
}

function semanticNotificationAllowedForEmail(event, email) {
  return semanticNotificationPolicyForEmail(event, email).allowed;
}

function semanticClientTelemetryId(ws) {
  if (!ws) return '';
  if (!ws._semanticNotificationTelemetryId) {
    const principalHash = crypto.createHash('sha256')
      .update(String(ws._authenticatedEmail || 'unknown'), 'utf8').digest('hex').slice(0, 12);
    ws._semanticNotificationTelemetryId = `ws-${principalHash}-${crypto.randomBytes(6).toString('hex')}`;
  }
  return ws._semanticNotificationTelemetryId;
}

function semanticNotificationPolicyForEmail(event, email) {
  const sessionId = event?.session_id || event?.session || '';
  const preferenceRevision = notificationPreferenceRevisionForEmail(email);
  if (!event || event.type !== 'semantic_notification' || !email) {
    return { allowed: false, reason: 'invalid_or_unauthenticated', preference_revision: preferenceRevision };
  }
  if (event.event_type === 'turn_ready' || event.category === 'turn_ready') {
    return { allowed: false, reason: 'unsupported_turn_ready', preference_revision: preferenceRevision };
  }
  if (/session completed/i.test(`${event.title || ''} ${event.body || ''}`)) {
    return { allowed: false, reason: 'legacy_completion_copy', preference_revision: preferenceRevision };
  }
  if (sessionId && sessionIdIsTestSession(sessionId)) {
    return { allowed: false, reason: 'validator_session', preference_revision: preferenceRevision };
  }
  const preferences = notificationPreferencesForEmail(email);
  if (event.category && !preferences[event.category]) {
    return { allowed: false, reason: 'category_disabled', preference_revision: preferenceRevision };
  }
  if (sessionId && sessionPreferencesForEmail(email)[sessionId]?.muted) {
    return { allowed: false, reason: 'session_muted', preference_revision: preferenceRevision };
  }
  return { allowed: true, reason: null, preference_revision: preferenceRevision };
}

function semanticNotificationsForClient(ws) {
  const clientId = semanticClientTelemetryId(ws);
  return goalNotifications.recentEvents()
    .filter(event => {
      const policy = semanticNotificationPolicyForEmail(event, ws?._authenticatedEmail);
      if (!policy.allowed) {
        goalNotifications.recordStage(event, 'suppressed', {
          reasonCode: policy.reason,
          preferenceRevision: policy.preference_revision,
          clientChannel: 'websocket-history',
          metadata: { client_id: clientId },
        });
      } else {
        goalNotifications.recordStage(event, 'dispatched', {
          preferenceRevision: policy.preference_revision,
          clientChannel: 'websocket-history',
          metadata: { client_id: clientId },
        });
      }
      return policy.allowed;
    });
}

function dispatchSemanticNotification(event) {
  if (!event || event.type !== 'semantic_notification') return;
  const data = JSON.stringify(event);
  for (const ws of browserClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const clientId = semanticClientTelemetryId(ws);
    const policy = semanticNotificationPolicyForEmail(event, ws._authenticatedEmail);
    if (!policy.allowed) {
      goalNotifications.recordStage(event, 'suppressed', {
        reasonCode: policy.reason,
        preferenceRevision: policy.preference_revision,
        clientChannel: 'websocket-live',
        metadata: { client_id: clientId },
      });
      continue;
    }
    ws.send(data);
    goalNotifications.recordStage(event, 'dispatched', {
      preferenceRevision: policy.preference_revision,
      clientChannel: 'websocket-live',
      metadata: { client_id: clientId },
    });
  }
  if (!shouldSendPush()) {
    goalNotifications.recordStage(event, 'suppressed', {
      reasonCode: 'connected_client_push_policy',
      clientChannel: 'push-policy',
    });
    return;
  }
  sendPushNotification(event.title, event.body, {
    type: event.event_type,
    category: event.category,
    activity_type: event.activity_type,
    dedupe_key: event.dedupe_key,
    session_id: event.session_id,
    session_name: event.session_name,
    created_at: event.created_at,
    harness: event.harness,
    goal_affiliation: event.goal_affiliation,
    native_event_id: event.native_event_id,
    turn_id: event.turn_id,
    ...(event.provider_id ? {
      provider_id: event.provider_id,
      account_label: event.account_label || '',
      window_id: event.window_id || '',
      window_label: event.window_label || '',
      threshold: event.threshold,
      percent_used: event.percent_used,
      hard_limited: event.hard_limited,
      reset_hint: event.reset_hint || '',
      session_ids: Array.isArray(event.affected_session_ids) ? event.affected_session_ids.join(',') : '',
    } : {}),
  }).catch(() => {});
}

const cachedChatLists = new Map();  // sessionId -> latest chat_list payload

function sessionIdIsTestSession(sessionId) {
  if (!sessionId) return false;
  const live = sessionMeta.get(sessionId);
  if (live) return sessionIsTestSession(live);
  try { return sessionIsTestSession(stmtGetSessionMeta.get(sessionId)); } catch { return false; }
}

// Duplicate suppression maps
const recentBrowserSends = new Map();  // "session:content" → timestamp
const recentFileSends    = new Map();  // "session:filename" → timestamp
const BROWSER_ECHO_DEDUP_WINDOW_SEC = 5 * 60;

// Workspace list from proxy snapshot (for "Launch New Session" dropdown)
let cachedWorkspaces = [];

// ── Pending session launch store (A2-08) ─────────────────────────────────────
// request_id → { agent_type, workspace_path, launched_at, timeout_at, browser_ws, timer }
const pendingLaunches = new Map();

// Track recently launched resume sessions so we can migrate messages if the
// proxy assigns a different session_id during rediscovery.
// Maps session_id → { source_session, launched_at, agent_type }
// Entries are auto-cleaned after 5 minutes.
const recentResumeSessions = new Map();
const RESUME_TRACK_TTL_MS = 5 * 60 * 1000;

// ── Agent control state (A2-07) ───────────────────────────────────────────────
// Open permission prompts: `${session_id}:${prompt_id}` → { prompt, timer }
const pendingPrompts  = new Map();
// First-class model/native questions are isolated from permission prompts. The
// registry never serializes submitted answers and atomically claims one browser
// response before it can be forwarded to a native adapter.
const QUESTION_PROMPT_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const stmtUpsertQuestionPromptTombstone = db.prepare(`
  INSERT INTO question_prompt_tombstones
    (session_id, prompt_id, generation, lifecycle, terminal_at, error_code)
  VALUES
    (@session_id, @prompt_id, @generation, @lifecycle, @terminal_at, @error_code)
  ON CONFLICT(session_id, prompt_id) DO UPDATE SET
    generation = excluded.generation,
    lifecycle = excluded.lifecycle,
    terminal_at = excluded.terminal_at,
    error_code = excluded.error_code
  WHERE julianday(excluded.terminal_at) >= julianday(question_prompt_tombstones.terminal_at)
`);
db.prepare(`
  DELETE FROM question_prompt_tombstones
  WHERE julianday(terminal_at) < julianday('now', '-30 days')
`).run();
const initialQuestionPromptTombstones = db.prepare(`
  SELECT session_id, prompt_id, generation, lifecycle, terminal_at, error_code FROM (
    SELECT session_id, prompt_id, generation, lifecycle, terminal_at, error_code
    FROM question_prompt_tombstones
    ORDER BY terminal_at DESC
    LIMIT 4096
  )
  ORDER BY terminal_at ASC
`).all();
const questionPromptRegistry = new QuestionPromptRegistry({
  maxEntries: 4096,
  tombstoneTtlMs: QUESTION_PROMPT_TOMBSTONE_TTL_MS,
  initialTombstones: initialQuestionPromptTombstones,
  onTombstone: tombstone => stmtUpsertQuestionPromptTombstone.run(tombstone),
});
const questionPromptTimers = new Map();
// Open session error prompts: `${session_id}:${prompt_id}` → { prompt }
const pendingErrorPrompts = new Map();
// Latest agent config per session: session_id → agent_config object
const agentConfigs    = new Map();
// Bounded diagnostics for mixed-version or malformed producers that attach a
// goal to a harness without a goal lifecycle contract.
const ignoredFleetGoalDiagnostics = new Map();
// In-flight control request routing: request_id → browser WebSocket
class PendingControlRequestMap extends Map {
  set(requestId, ws) {
    if (super.has(requestId)) super.delete(requestId);
    super.set(requestId, ws);
    // All set() calls, including legacy control branches, get an expiry and a
    // hard count ceiling without allocating one timer per request.
    if (pendingCtrlReqCreatedAt.has(requestId)) pendingCtrlReqCreatedAt.delete(requestId);
    pendingCtrlReqCreatedAt.set(requestId, Date.now());
    while (this.size > RUNTIME_MAP_MAX_ENTRIES) {
      const oldest = this.keys().next().value;
      clearPendingControlRequest(oldest);
    }
    while (pendingCtrlReqCreatedAt.size > RUNTIME_MAP_MAX_ENTRIES) {
      clearPendingControlRequest(pendingCtrlReqCreatedAt.keys().next().value);
    }
    return this;
  }

  delete(requestId) {
    const deleted = super.delete(requestId);
    // Most control branches release only the routing entry directly. Keep the
    // parallel timestamp index in exact lockstep instead of retaining dead
    // metadata until the next periodic prune.
    pendingCtrlReqCreatedAt.delete(requestId);
    return deleted;
  }
}
const pendingCtrlReqs = new PendingControlRequestMap();
const exactControlRegistry = new ExactlyOnceControlRegistry({ ttlMs: 60_000, maxEntries: 4096 });
const exactControlTimers = new Map();
const navigationEpochs = new NavigationEpochRegistry({ maxEntries: 4096 });
const NAVIGATION_CONTROL_TYPES = new Set(['new_chat', 'new_thread', 'switch_chat', 'switch_thread']);
const codexControlRequestBindings = new Map();
const codexControlRequestWaiters = new Map();
// Payload-backed controls emit both a payload and an agent_control_result. Track
// both halves so either arrival order reaches the initiating browser before the
// routing entry is released.
const pendingPayloadCtrlState = new Map();
const pendingPromptResponses = new Map();
const pendingErrorPromptResponses = new Map();
const nativeHistoryChunkRequests = new Map();
const nativeHistoryChunkFlights = new Map();
const nativeHistoryChunkFlightsByRequest = new Map();
const nativeHistoryChunkCache = new Map();
const nativeHistoryChunkMetrics = {
  requested: 0,
  coalesced: 0,
  served_from_cache: 0,
  retried: 0,
  throttled: 0,
  terminal_failure: 0,
};
const pendingHistoryMetadataReconciliations = new Map();
const transcriptResyncRateLimits = new Map();
const pendingTranscriptResyncRequests = new Map();
const pendingHostResourceRequests = new Map();
const pendingHostResourceSubscriptionRequests = new Map();
const pendingHostResourceHistoryRequests = new Map();
const hostResourceSubscriptions = new Map();
const pendingProviderUsageCostDetailRequests = new Map();
const activeProviderUsageRefreshes = new Map();
const providerUsageRefreshesByRequest = new Map();
let activeProviderUsageResetCredit = null;
const PROVIDER_USAGE_REQUEST_TIMEOUT_MS = 15_000;
const PROVIDER_USAGE_IDS = new Set(['openai-codex', 'anthropic-claude', 'google-antigravity', 'cursor', 'ollama-local']);
const HOST_RESOURCE_REQUEST_TIMEOUT_MS = 12_000;
const HOST_RESOURCE_REQUEST_MIN_INTERVAL_MS = 2_000;
const HOST_RESOURCE_SUBSCRIPTION_RE = /^host-sub-[a-f0-9]{32}$/;
const statusBroadcastState = new Map();
const messageDeltaGate = new MessageDeltaGate();
const pendingCtrlReqCreatedAt = new Map();

function clearPendingControlRequest(requestId) {
  const abandonedQuestion = questionPromptRegistry.abandonRequest(requestId);
  if (abandonedQuestion) publishQuestionPromptState(abandonedQuestion);
  pendingCtrlReqs.delete(requestId);
  pendingCtrlReqCreatedAt.delete(requestId);
  pendingPayloadCtrlState.delete(requestId);
  pendingPromptResponses.delete(requestId);
  pendingErrorPromptResponses.delete(requestId);
  pendingHistoryMetadataReconciliations.delete(requestId);
  codexControlRequestWaiters.delete(requestId);
}

function pruneRuntimeRequestState(now = Date.now()) {
  for (const [requestId, createdAt] of pendingCtrlReqCreatedAt) {
    if (!pendingCtrlReqs.has(requestId) || now - createdAt > RUNTIME_REQUEST_TTL_MS) {
      clearPendingControlRequest(requestId);
    }
  }
  for (const [key, value] of nativeHistoryChunkRequests) {
    if (now - Number(value?.at || 0) > NATIVE_HISTORY_REQUEST_STATE_TTL_MS) nativeHistoryChunkRequests.delete(key);
  }
  for (const [key, value] of nativeHistoryChunkCache) {
    if (now - Number(value?.storedAt || 0) > NATIVE_HISTORY_RESULT_CACHE_MS) nativeHistoryChunkCache.delete(key);
  }
  for (const [key, timestamp] of transcriptResyncRateLimits) {
    if (now - Number(timestamp || 0) > 60_000) transcriptResyncRateLimits.delete(key);
  }
  for (const [requestId, binding] of codexControlRequestBindings) {
    if (now - Number(binding?.createdAt || 0) > RUNTIME_REQUEST_TTL_MS) {
      codexControlRequestBindings.delete(requestId);
    }
  }
  for (const [key, pending] of pendingTranscriptResyncRequests) {
    if (now - Number(pending?.requestedAt || 0) > RUNTIME_REQUEST_TTL_MS) pendingTranscriptResyncRequests.delete(key);
  }
  messageDeltaGate.prune(now);
  sendLifecycle.prune(now);
  questionPromptRegistry.timeoutSubmitting(now, RUNTIME_REQUEST_TTL_MS)
    .forEach(publishQuestionPromptState);
  questionPromptRegistry.prune(now);
}
const runtimeRequestCleanupTimer = setInterval(pruneRuntimeRequestState, 60_000);
runtimeRequestCleanupTimer.unref?.();

function clearSessionAuxiliaryState(sessionId) {
  if (!sessionId) return;
  agentConfigs.delete(sessionId);
  ignoredFleetGoalDiagnostics.delete(sessionId);
  cachedChatLists.delete(sessionId);
  usageThresholds.clear(sessionId);
  providerUsageAuthority.clearSession(sessionId);
  sendLifecycle.clearSession(sessionId);
  messageDeltaGate.clearSession(sessionId);
  const colonPrefix = `${sessionId}:`;
  const cursorPrefix = `${sessionId}\u0000`;
  for (const key of nativeHistoryChunkRequests.keys()) {
    if (key.startsWith(colonPrefix)) nativeHistoryChunkRequests.delete(key);
  }
  for (const [key, flight] of nativeHistoryChunkFlights) {
    if (flight.sessionId !== sessionId) continue;
    finishNativeHistoryFlight(flight, {
      type: 'history_chunk',
      protocol_version: PROTOCOL_VERSION,
      session: sessionId,
      session_id: sessionId,
      mode: flight.mode,
      source: flight.requestedSource,
      messages: [],
      partial: false,
      complete: true,
      error: { code: 'session_removed', message: 'Session was removed while transcript history was loading.' },
    }, { terminalFailure: true });
  }
  for (const [key, cached] of nativeHistoryChunkCache) {
    if (cached.sessionId === sessionId) nativeHistoryChunkCache.delete(key);
  }
  for (const map of [transcriptResyncRateLimits, pendingTranscriptResyncRequests, pendingTranscriptSourceCursors]) {
    for (const key of map.keys()) {
      if (key.startsWith(cursorPrefix)) map.delete(key);
    }
  }
  for (const [key, entry] of pendingPrompts) {
    if (!key.startsWith(colonPrefix)) continue;
    if (entry?.timer) clearTimeout(entry.timer);
    pendingPrompts.delete(key);
  }
  for (const key of pendingErrorPrompts.keys()) {
    if (key.startsWith(colonPrefix)) pendingErrorPrompts.delete(key);
  }
  for (const [requestId, entry] of pendingPromptResponses) {
    if (entry?.sessionId === sessionId) clearPendingControlRequest(requestId);
  }
  for (const [requestId, entry] of pendingErrorPromptResponses) {
    if (entry?.sessionId === sessionId) clearPendingControlRequest(requestId);
  }
  for (const [requestId, entry] of pendingHistoryMetadataReconciliations) {
    if (entry?.sessionId === sessionId) clearPendingControlRequest(requestId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcastSessionId(msg) {
  return msg?.session || msg?.session_id || msg?.message?.session_id || null;
}

function compactSummaryGoal(goal) {
  if (!goal || typeof goal !== 'object') return null;
  const objective = String(goal.objective || goal.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const compact = {
    ...(goal.label ? { label: String(goal.label).slice(0, 120) } : {}),
    ...(objective ? { objective } : {}),
  };
  // Canonical lifecycle cursors/fingerprints stay server-side in the semantic
  // notification coordinator. Summary-only browsers only need render fields;
  // forwarding the full canonical record on every status tick breaks the
  // fixed-size fleet payload budget.
  [
    'state', 'status', 'started_at', 'created_at', 'updated_at',
    'time_used_seconds', 'tokens_used', 'progress_percent', 'percent_complete',
    'percent', 'progress',
  ].forEach(key => {
    if (goal[key] !== undefined) compact[key] = goal[key];
  });
  const fingerprint = String(goal.fingerprint || goal.goal_fingerprint || '').trim().slice(0, 96);
  if (fingerprint) compact.fingerprint = fingerprint;
  const generation = Number(goal.generation);
  if (Number.isFinite(generation) && generation > 0) compact.generation = Math.floor(generation);
  const transitionSeq = Number(goal.transition_seq);
  if (Number.isSafeInteger(transitionSeq) && transitionSeq >= 0) compact.transition_seq = transitionSeq;
  return compact;
}

const stmtUpsertLatestVisibleMessage = db.prepare(`
  INSERT INTO session_latest_visible_message
    (session_id, message_row_id, message_id, message_at, kind, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(session_id) DO UPDATE SET
    message_row_id = excluded.message_row_id,
    message_id = excluded.message_id,
    message_at = excluded.message_at,
    kind = excluded.kind,
    source = excluded.source,
    updated_at = datetime('now')
  WHERE session_latest_visible_message.message_at IS NULL
     OR excluded.message_at > session_latest_visible_message.message_at
     OR (excluded.message_at = session_latest_visible_message.message_at
       AND excluded.message_id > COALESCE(session_latest_visible_message.message_id, ''))
`);
const stmtReplaceLatestVisibleMessage = db.prepare(`
  INSERT INTO session_latest_visible_message
    (session_id, message_row_id, message_id, message_at, kind, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(session_id) DO UPDATE SET
    message_row_id = excluded.message_row_id,
    message_id = excluded.message_id,
    message_at = excluded.message_at,
    kind = excluded.kind,
    source = excluded.source,
    updated_at = datetime('now')
`);
const stmtListLatestVisibleMessages = db.prepare(`
  SELECT session_id, message_row_id, message_id, message_at, kind, source
  FROM session_latest_visible_message
  WHERE message_id IS NOT NULL AND message_at > 0 AND kind IS NOT NULL AND source IS NOT NULL
`);
const stmtGetLatestVisibleMessage = db.prepare(`
  SELECT session_id, message_row_id, message_id, message_at, kind, source
  FROM session_latest_visible_message
  WHERE session_id = ? AND message_id IS NOT NULL AND message_at > 0
`);
const stmtFindLatestVisibleMessageRow = db.prepare(`
  SELECT id AS message_row_id, role, ts, source, source_message_id
  FROM messages
  WHERE session = ?
    AND lower(replace(role, '-', '_')) IN
      ('user', 'assistant', 'tool', 'tool_result', 'permission', 'permission_prompt',
       'question', 'question_prompt', 'error', 'system')
    AND ts > 0
  ORDER BY ts DESC, id DESC
  LIMIT 1
`);
const stmtGetMessageTimestampById = db.prepare('SELECT ts FROM messages WHERE id = ?');

const latestVisibleMessages = new Map(
  stmtListLatestVisibleMessages.all().map(row => [row.session_id, row]),
); // sessionId -> compact content-free persisted message identity
let latestVisibleBackfillWorker = null;
let latestVisibleBackfillRetryTimer = null;

function missingLatestVisibleSessionIds() {
  return db.prepare(`
    SELECT meta.session_id
    FROM session_meta meta
    LEFT JOIN session_latest_visible_message latest ON latest.session_id = meta.session_id
    WHERE latest.session_id IS NULL
    ORDER BY meta.session_id
    LIMIT 4096
  `).pluck().all();
}

function scheduleLegacyLatestVisibleBackfill(delayMs = 0) {
  if (latestVisibleBackfillWorker || latestVisibleBackfillRetryTimer) return;
  latestVisibleBackfillRetryTimer = setTimeout(() => {
    latestVisibleBackfillRetryTimer = null;
    const sessionIds = missingLatestVisibleSessionIds();
    if (sessionIds.length === 0) return;
    const worker = new Worker(path.join(__dirname, 'latest-visible-backfill-worker.js'), {
      workerData: { dbPath: HISTORY_DB_PATH, sessionIds },
    });
    latestVisibleBackfillWorker = worker;
    worker.on('message', message => {
      if (message?.type === 'row') {
        const latest = normalizedLatestVisibleMessageRow(message.row);
        if (!latest?.session_id) return;
        latestVisibleMessages.set(latest.session_id, latest);
        const summary = buildSessionSummary({ type: 'latest_visible_backfill' }, latest.session_id);
        for (const ws of browserClients) {
          if (ws.readyState === WebSocket.OPEN && canBroadcastDeltaToBrowser(ws)) {
            queueBrowserSessionSummary(ws, latest.session_id, summary);
          }
        }
      } else if (message?.type === 'complete') {
        log('info', 'db', 'Backfilled latest visible message metadata', {
          candidates: message.candidates,
          sessions: message.backfilled,
        });
      }
    });
    worker.on('error', error => {
      log('error', 'db', 'Latest visible message backfill worker failed', { err: error.message });
    });
    worker.on('exit', code => {
      if (latestVisibleBackfillWorker === worker) latestVisibleBackfillWorker = null;
      if (code !== 0) scheduleLegacyLatestVisibleBackfill(5000);
    });
    worker.unref();
  }, Math.max(0, delayMs));
  latestVisibleBackfillRetryTimer.unref?.();
}

function compactSummaryGoalRun(goalRun) {
  if (!goalRun || typeof goalRun !== 'object' || goalRun.schema_version !== 1) return null;
  const runId = String(goalRun.run_id || '').trim().slice(0, 96);
  const fingerprint = String(goalRun.goal_fingerprint || '').trim().slice(0, 96);
  const generation = Number(goalRun.goal_generation);
  const lifecycle = String(goalRun.lifecycle || '').trim().slice(0, 48);
  if (!runId || !fingerprint || !Number.isFinite(generation) || generation <= 0 || !lifecycle) return null;
  return {
    schema_version: 1,
    run_id: runId,
    goal_fingerprint: fingerprint,
    goal_generation: Math.floor(generation),
    lifecycle,
    lease_active: goalRun.lease_active === true,
    owner_state: String(goalRun.owner_state || '').trim().slice(0, 32),
  };
}

function compactGoalProjection(value, forcedState = null) {
  if (!value || typeof value !== 'object' || value.schema_version !== 1) return null;
  const sessionId = String(value.session_id || '').trim().slice(0, 160);
  const surface = String(value.surface || '').trim().slice(0, 48);
  const nativeThreadId = String(value.native_thread_id || '').trim().slice(0, 200);
  const epoch = Number(value.epoch);
  const sequence = Number(value.sequence);
  const state = String(forcedState || value.state || '').trim().toLowerCase();
  if (!sessionId || !surface || !nativeThreadId
      || !Number.isSafeInteger(epoch) || epoch <= 0
      || !Number.isSafeInteger(sequence) || sequence <= 0
      || !['present', 'clear'].includes(state)) return null;
  return {
    schema_version: 1,
    session_id: sessionId,
    surface,
    native_thread_id: nativeThreadId,
    epoch,
    sequence,
    state,
    ...(value.native_thread_title
      ? { native_thread_title: String(value.native_thread_title).trim().slice(0, 200) }
      : {}),
    ...(value.observed_at ? { observed_at: value.observed_at } : {}),
    ...(value.reason ? { reason: String(value.reason).trim().slice(0, 120) } : {}),
    ...((value.goal_fingerprint || value.prior_fingerprint)
      ? { goal_fingerprint: String(value.goal_fingerprint || value.prior_fingerprint).trim().slice(0, 160) }
      : {}),
    ...(Number(value.goal_generation ?? value.prior_generation) > 0
      ? { goal_generation: Math.floor(Number(value.goal_generation ?? value.prior_generation)) }
      : {}),
  };
}

function compactSummaryActivity(activity, fallbackLabel = '') {
  if (!activity || typeof activity !== 'object') return null;
  const hasGoal = Object.prototype.hasOwnProperty.call(activity, 'goal');
  const goal = compactSummaryGoal(activity.goal);
  const goalRun = compactSummaryGoalRun(activity.goal_run);
  const goalProjection = compactGoalProjection(activity.goal_projection);
  const goalTombstone = compactGoalProjection(activity.goal_tombstone, 'clear');
  const workContext = normalizeFleetWorkContext(activity.work_context);
  const compact = {
    kind: activity.kind || 'idle',
    label: String(activity.label || fallbackLabel || '').slice(0, 120),
    ...(activity.started_at ? { started_at: activity.started_at } : {}),
    ...(activity.updated_at ? { updated_at: activity.updated_at } : {}),
    ...(activity.observed_at ? { observed_at: activity.observed_at } : {}),
    ...(activity.interrupt_hint ? { interrupt_hint: activity.interrupt_hint } : {}),
    ...(activity.connection ? { connection: activity.connection } : {}),
    ...(activity.connection_tombstone ? { connection_tombstone: activity.connection_tombstone } : {}),
    ...(activity.interruption ? { interruption: activity.interruption } : {}),
    ...(activity.interruption_tombstone ? { interruption_tombstone: activity.interruption_tombstone } : {}),
    ...(hasGoal ? { goal } : {}),
    ...(goalRun ? { goal_run: goalRun } : {}),
    ...(goalProjection ? { goal_projection: goalProjection } : {}),
    ...(goalTombstone ? { goal_tombstone: goalTombstone } : {}),
    ...(workContext ? { work_context: workContext } : {}),
    ...(activity.usage ? { usage: activity.usage } : {}),
  };
  return compact;
}

function compactActivityTrace(trace) {
  if (!trace || typeof trace !== 'object') return null;
  const compact = {};
  ['proxy_emitted_at_ms', 'relay_received_at_ms', 'relay_forwarded_at_ms'].forEach(key => {
    const value = Number(trace[key]);
    if (Number.isFinite(value) && value > 0) compact[key] = value;
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function summarySnippet(msg) {
  let content = msg?.content || msg?.message?.content || '';
  if (!content && msg?.type === 'message_delta' && msg.op === 'append') content = msg.append || '';
  if (!content && Array.isArray(msg?.messages) && msg.messages.length > 0) {
    content = msg.messages[msg.messages.length - 1]?.content || '';
  }
  return String(content || '').replace(/\s+/g, ' ').trim().slice(0, SESSION_SUMMARY_SNIPPET_CHARS);
}

function ensureRelayFleetSummary(sessionId, meta = {}) {
  return normalizeFleetSummary(meta.fleet_summary) || buildProducerFleetSummary({
    sessionId,
    session: meta,
    messages: [],
    previous: null,
  });
}

function advanceRelayFleetSummary(sessionId, event, metaOverride = null) {
  if (!sessionId) return {};
  const meta = metaOverride && typeof metaOverride === 'object'
    ? metaOverride
    : (sessionMeta.get(sessionId) || {});
  const previous = ensureRelayFleetSummary(sessionId, meta);
  const summary = advanceFleetSummary(previous, event, meta) || previous;
  if (!summary) return {};
  const projection = projectFleetSummary(summary);
  sessionMeta.set(sessionId, { ...meta, ...projection });
  return projection;
}

function buildSessionSummary(msg, sessionId) {
  const meta = sessionMeta.get(sessionId) || {};
  const fleetProjection = projectFleetSummary(meta.fleet_summary);
  const {
    last_message_at: _fleetLastMessageAt,
    last_message_id: _fleetLastMessageId,
    last_message_kind: _fleetLastMessageKind,
    last_message_source: _fleetLastMessageSource,
    latest_visible_message: _fleetLatestVisibleMessage,
    ...safeFleetProjection
  } = fleetProjection;
  const activity = compactSummaryActivity(msg.activity || meta.activity, msg.label);
  const role = msg.role || msg.message?.role || null;
  const snippet = fleetProjection.last_snippet || summarySnippet(msg);
  const unreadDelta = !sessionIdIsTestSession(sessionId) && role === 'assistant'
    && ['message', 'proxy_message', 'message_event'].includes(msg.type) ? 1 : 0;
  return {
    type: 'session_summary',
    protocol_version: PROTOCOL_VERSION,
    session: sessionId,
    session_id: sessionId,
    status: sessionHealth.get(sessionId) || meta.status || null,
    ...(activity ? { activity } : {}),
    ...safeFleetProjection,
    ...(compactActivityTrace(msg.activity_trace) ? { activity_trace: compactActivityTrace(msg.activity_trace) } : {}),
    ...(snippet ? { last_snippet: snippet } : {}),
    ...latestVisibleMessageProjection(sessionId),
    unread_delta: unreadDelta,
    ...(Number.isSafeInteger(msg?.state_seq) ? { state_seq: msg.state_seq } : {}),
    ...(msg?.state_epoch ? { state_epoch: msg.state_epoch } : {}),
  };
}

function browserWantsFullSession(ws, sessionId) {
  return ws._sessionSubscriptions instanceof Set && ws._sessionSubscriptions.has(sessionId);
}

function isSelectiveSessionPayload(msg) {
  return FULL_FIDELITY_SESSION_TYPES.has(msg?.type) || isUnsolicitedHistoryMessage(msg);
}

const AUTHORITATIVE_TRANSCRIPT_TYPES = new Set(['message', 'proxy_message', 'message_event']);
const TRANSCRIPT_GAP_HARD_BUFFER_BYTES = MAX_BROWSER_DELTA_BUFFER_BYTES * 4;

function transcriptResyncRequiredPayload(sessionId, detail = {}) {
  return {
    type: 'transcript_resync_required',
    protocol_version: PROTOCOL_VERSION,
    session: sessionId,
    session_id: sessionId,
    reason: detail.reason || 'cursor_gap',
    ...(detail.resync_id ? { resync_id: detail.resync_id } : {}),
    ...(detail.source ? { source: detail.source } : {}),
    ...(detail.source_cursor ? { source_cursor: detail.source_cursor } : {}),
    ...(Number.isSafeInteger(detail.expected_message_index)
      ? { expected_message_index: detail.expected_message_index }
      : {}),
    ...(Number.isSafeInteger(detail.received_message_index)
      ? { received_message_index: detail.received_message_index }
      : {}),
    server_ts: new Date().toISOString(),
  };
}

function markBrowserTranscriptGap(ws, sessionId, detail = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  if (!(ws._transcriptGaps instanceof Map)) ws._transcriptGaps = new Map();
  if (ws._transcriptGaps.has(sessionId)) return;
  const payload = transcriptResyncRequiredPayload(sessionId, detail);
  setBoundedMap(ws._transcriptGaps, sessionId, payload, MAX_SESSION_SUBSCRIPTIONS);
  if (Number(ws.bufferedAmount || 0) > TRANSCRIPT_GAP_HARD_BUFFER_BYTES) {
    ws.close(1013, 'transcript backpressure');
    return;
  }
  ws.send(JSON.stringify(payload));
}

function clearBrowserTranscriptGap(ws, sessionId) {
  ws?._transcriptGaps?.delete(sessionId);
}

function broadcastTranscriptGap(sessionId, detail = {}) {
  for (const ws of browserClients) {
    if (ws.readyState !== WebSocket.OPEN || !browserWantsFullSession(ws, sessionId)) continue;
    markBrowserTranscriptGap(ws, sessionId, detail);
  }
}

function requestProxyTranscriptResync(proxyWs, sessionId, source, cursorDecision) {
  if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN || !sessionId || !source) return null;
  const key = transcriptSourceCursorKey(sessionId, source);
  const existing = pendingTranscriptResyncRequests.get(key);
  if (existing) return existing.resyncId;
  const resyncId = crypto.randomUUID();
  setBoundedMap(pendingTranscriptResyncRequests, key, {
    resyncId,
    requestedAt: Date.now(),
    reason: cursorDecision?.code || 'cursor_gap',
  });
  proxyWs.send(JSON.stringify({
    type: 'transcript_resync_required',
    protocol_version: PROTOCOL_VERSION,
    session: sessionId,
    session_id: sessionId,
    source,
    resync_id: resyncId,
    reason: cursorDecision?.code || 'cursor_gap',
    ...(Number.isSafeInteger(cursorDecision?.expected_message_index)
      ? { expected_message_index: cursorDecision.expected_message_index }
      : {}),
    ...(Number.isSafeInteger(cursorDecision?.incoming?.message_index)
      ? { received_message_index: cursorDecision.incoming.message_index }
      : {}),
  }));
  return resyncId;
}

function completeProxyTranscriptResync(sessionId, source, resyncId) {
  if (!sessionId || !source || !resyncId) return;
  const key = transcriptSourceCursorKey(sessionId, source);
  const pending = pendingTranscriptResyncRequests.get(key);
  if (pending?.resyncId === resyncId) pendingTranscriptResyncRequests.delete(key);
}

function broadcastPersistedTranscriptRows(sessionId, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    broadcastToBrowsers({
      type: 'message',
      session: sessionId,
      session_id: sessionId,
      ...row,
    });
  }
}

const pendingBrowserSessionSummaries = new Map();
let sessionSummaryBroadcastTimer = null;

function mergeSessionSummary(previous, next) {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    unread_delta: Number(previous.unread_delta || 0) + Number(next.unread_delta || 0),
  };
}

function flushBrowserSessionSummaries() {
  sessionSummaryBroadcastTimer = null;
  const pending = [...pendingBrowserSessionSummaries.entries()];
  pendingBrowserSessionSummaries.clear();
  for (const [ws, summaries] of pending) {
    if (ws.readyState !== WebSocket.OPEN || !canBroadcastDeltaToBrowser(ws)) continue;
    for (const summary of summaries.values()) ws.send(JSON.stringify(summary));
  }
}

function queueBrowserSessionSummary(ws, sessionId, summary) {
  let summaries = pendingBrowserSessionSummaries.get(ws);
  if (!summaries) {
    summaries = new Map();
    pendingBrowserSessionSummaries.set(ws, summaries);
  }
  summaries.set(sessionId, mergeSessionSummary(summaries.get(sessionId), summary));
  if (sessionSummaryBroadcastTimer) return;
  sessionSummaryBroadcastTimer = setTimeout(
    flushBrowserSessionSummaries,
    SESSION_SUMMARY_BROADCAST_COALESCE_MS,
  );
}

function broadcastToBrowsers(msg) {
  let data = null;
  const isHistoryBroadcast = isUnsolicitedHistoryMessage(msg);
  const isMessageDelta = msg?.type === 'message_delta';
  const isAuthoritativeTranscript = AUTHORITATIVE_TRANSCRIPT_TYPES.has(msg?.type);
  const sessionId = broadcastSessionId(msg);
  const selective = !!sessionId && isSelectiveSessionPayload(msg);
  let summaryPayload = null;
  for (const ws of browserClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (selective && !browserWantsFullSession(ws, sessionId)) {
      if (canBroadcastDeltaToBrowser(ws)) {
        if (summaryPayload == null) summaryPayload = buildSessionSummary(msg, sessionId);
        queueBrowserSessionSummary(ws, sessionId, summaryPayload);
      }
      continue;
    }
    if (sessionId && (isMessageDelta || isAuthoritativeTranscript)) {
      if (ws._transcriptGaps?.has(sessionId)) {
        if (canBroadcastDeltaToBrowser(ws)) {
          if (summaryPayload == null) summaryPayload = buildSessionSummary(msg, sessionId);
          queueBrowserSessionSummary(ws, sessionId, summaryPayload);
        }
        continue;
      }
      if (!canBroadcastDeltaToBrowser(ws)) {
        markBrowserTranscriptGap(ws, sessionId, {
          reason: 'backpressure',
          source: msg.source || null,
          source_cursor: msg.source_cursor || null,
        });
        if (canBroadcastDeltaToBrowser(ws)) {
          if (summaryPayload == null) summaryPayload = buildSessionSummary(msg, sessionId);
          queueBrowserSessionSummary(ws, sessionId, summaryPayload);
        }
        continue;
      }
    }
    // Unsolicited history is expendable live-tail state. Do not queue it in
    // front of explicit history/control responses for the selected session.
    if (isHistoryBroadcast && !canBroadcastHistoryToBrowser(ws)) continue;
    if (data == null) data = JSON.stringify(msg);
    ws.send(data);
  }
}

const pendingStatusBroadcasts = new Map();
const pendingSessionPatches = new Map();
let statusBroadcastTimer = null;
let sessionListBroadcastTimer = null;
let sessionPatchBroadcastTimer = null;

function sequencedStateEvent(msg) {
  relayStateSeq += 1;
  return {
    ...msg,
    state_epoch: RELAY_STATE_EPOCH,
    state_seq: relayStateSeq,
  };
}

function flushStatusBroadcasts() {
  statusBroadcastTimer = null;
  const pending = [...pendingStatusBroadcasts.values()];
  pendingStatusBroadcasts.clear();
  pending.forEach(statusMsg => {
    const relayForwardedAtMs = Date.now();
    const forwarded = {
      ...statusMsg,
      activity_trace: compactActivityTrace({
        ...statusMsg.activity_trace,
        relay_forwarded_at_ms: relayForwardedAtMs,
      }),
      ...(statusMsg.stream_trace ? {
        stream_trace: { ...statusMsg.stream_trace, relay_forwarded_at_ms: relayForwardedAtMs },
      } : {}),
    };
    broadcastToBrowsers(sequencedStateEvent(forwarded));
  });
}

function queueStatusBroadcast(statusMsg) {
  const sessionId = broadcastSessionId(statusMsg);
  if (!sessionId) {
    broadcastToBrowsers(sequencedStateEvent(statusMsg));
    return;
  }
  pendingStatusBroadcasts.set(sessionId, statusMsg);
  if (statusBroadcastTimer) return;
  statusBroadcastTimer = setTimeout(flushStatusBroadcasts, STATUS_BROADCAST_COALESCE_MS);
}

const UNSAFE_SESSION_PATCH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function buildSessionPatch(previous, next) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const after = next && typeof next === 'object' ? next : {};
  const patch = Object.create(null);
  const removedFields = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (UNSAFE_SESSION_PATCH_KEYS.has(key) || key === 'session_id' || key === 'id') continue;
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      removedFields.push(key);
    } else if (!isDeepStrictEqual(before[key], after[key])) {
      patch[key] = after[key];
    }
  }
  return { patch, removedFields };
}

function flushSessionPatchBroadcasts() {
  sessionPatchBroadcastTimer = null;
  const pending = [...pendingSessionPatches.entries()];
  pendingSessionPatches.clear();
  for (const [sessionId, states] of pending) {
    const diff = buildSessionPatch(states.previous, states.next);
    if (Object.keys(diff.patch).length === 0 && diff.removedFields.length === 0) continue;
    broadcastToBrowsers(sequencedStateEvent({
      type: 'session_patch',
      protocol_version: PROTOCOL_VERSION,
      session: sessionId,
      session_id: sessionId,
      patch: diff.patch,
      ...(diff.removedFields.length > 0 ? { removed_fields: diff.removedFields } : {}),
    }));
  }
}

function queueSessionPatchBroadcast(sessionId, previous, next) {
  if (!sessionId || sessionListBroadcastTimer) return;
  const existing = pendingSessionPatches.get(sessionId);
  pendingSessionPatches.set(sessionId, {
    previous: existing?.previous || previous,
    next,
  });
  if (sessionPatchBroadcastTimer) return;
  sessionPatchBroadcastTimer = setTimeout(flushSessionPatchBroadcasts, SESSION_PATCH_BROADCAST_COALESCE_MS);
}

function flushSessionListBroadcast() {
  sessionListBroadcastTimer = null;
  broadcastToBrowsers(sequencedStateEvent({
    type: 'session_list',
    sessions: getSessionList(),
    workspaces: cachedWorkspaces,
  }));
}

function queueSessionListBroadcast() {
  pendingSessionPatches.clear();
  if (sessionPatchBroadcastTimer) clearTimeout(sessionPatchBroadcastTimer);
  sessionPatchBroadcastTimer = null;
  if (sessionListBroadcastTimer) return;
  sessionListBroadcastTimer = setTimeout(flushSessionListBroadcast, SESSION_LIST_BROADCAST_COALESCE_MS);
}

function clearQueuedSessionStatus(sessionId) {
  pendingStatusBroadcasts.delete(sessionId);
  statusBroadcastState.delete(sessionId);
}

let duplicateProxyAlarms = [];
function refreshDuplicateProxyAlarms() {
  const next = buildDuplicateProxyAlarms(proxySessionClaims, WebSocket.OPEN);
  if (JSON.stringify(next) === JSON.stringify(duplicateProxyAlarms)) return;
  duplicateProxyAlarms = next;
  log(next.length ? 'warn' : 'info', 'proxy-ws',
    next.length ? 'Duplicate proxy alarm active' : 'Duplicate proxy alarm cleared',
    { duplicate_sessions: next.map(item => item.session_id) });
  broadcastToBrowsers({
    type: 'duplicate_proxy_alarm',
    active: next.length > 0,
    duplicate_sessions: next,
    server_ts: new Date().toISOString(),
  });
}

// Static app-shell requests are browser navigation unless the caller explicitly
// presents a bearer/query token. Browsers need requireAuth's OAuth redirect;
// native/headless clients need requireAnyAuth's JSON bearer-token errors.
function requireBrowserOrBearerAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (!token) return requireAuth(req, res, next);
  return requireAnyAuth(req, res, next);
}

function broadcastToBrowsersExcept(msg, excludedWs) {
  const data = JSON.stringify(msg);
  for (const ws of browserClients) {
    if (ws !== excludedWs && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendHistoryChunkError(ws, { sessionId, requestId, mode = 'tail', source = 'native', code, message, retryAfterMs = 0 }) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  ws.send(JSON.stringify({
    type: 'history_chunk',
    protocol_version: PROTOCOL_VERSION,
    session: sessionId,
    session_id: sessionId,
    request_id: requestId || null,
    mode,
    source,
    messages: [],
    partial: true,
    complete: false,
    error: {
      code,
      message,
      ...(retryAfterMs > 0 ? { retry_after_ms: retryAfterMs } : {}),
    },
    cursor: {
      start_offset: 0,
      end_offset: 0,
      next_before_offset: null,
      total_bytes: 0,
    },
  }));
}

function validateFileBackedTranscriptResync(msg, sessionId) {
  const source = normalizeSourceName(msg?.source);
  if (msg?.type !== 'history_snapshot' || !source?.endsWith('_jsonl')) {
    return { ok: true, source };
  }
  const resyncId = normalizeSourceMessageId(msg.resync_id);
  const reason = typeof msg.resync_reason === 'string' ? msg.resync_reason.trim() : '';
  const sourceBytes = Number(msg.source_bytes);
  const requestedRateLimitMs = Number(msg.resync_rate_limit_ms);
  if (
    !resyncId
    || !reason
    || !Number.isSafeInteger(sourceBytes)
    || sourceBytes < 0
    || !Number.isSafeInteger(requestedRateLimitMs)
    || requestedRateLimitMs < 1000
  ) {
    return { ok: false, code: 'invalid_resync_metadata', source, resyncId };
  }
  const rateLimitMs = Math.min(60_000, requestedRateLimitMs);
  const key = `${sessionId}\u0000${source}`;
  const now = Date.now();
  const previous = transcriptResyncRateLimits.get(key) || 0;
  const requestedByRelay = pendingTranscriptResyncRequests.get(key)?.resyncId === resyncId;
  if (!requestedByRelay && now - previous < rateLimitMs) {
    return {
      ok: false,
      code: 'resync_rate_limited',
      source,
      resyncId,
      retryAfterMs: rateLimitMs - (now - previous),
    };
  }
  setBoundedMap(transcriptResyncRateLimits, key, now);
  return { ok: true, source, resyncId, reason, sourceBytes, rateLimitMs, requestedByRelay };
}

function throttleNativeHistoryChunkRequest(sessionId, msg) {
  const mode = msg.mode === 'older' ? 'older' : 'tail';
  const threadId = String(msg.thread_id || msg.threadId || '');
  if (mode === 'older' && !msg.user_initiated) {
    return {
      code: 'history_older_requires_user_action',
      message: 'Older native history chunks require a current manual WebUI request.',
      retryAfterMs: NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS,
    };
  }
  const now = Date.now();
  const key = `${sessionId}:${threadId || 'session'}:${mode}`;
  const minInterval = mode === 'older'
    ? NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS
    : NATIVE_HISTORY_TAIL_MIN_INTERVAL_MS;
  const previous = nativeHistoryChunkRequests.get(key);
  if (previous) {
    const elapsed = now - previous.at;
    if (elapsed < minInterval) {
      return {
        code: 'history_chunk_throttled',
        message: 'Native history chunk request throttled to protect the browser and proxy.',
        retryAfterMs: minInterval - elapsed,
      };
    }
  }
  // The flight signature already coalesces concurrent requests and the result
  // cache absorbs immediate replays. Do not tombstone an older-history cursor
  // across completed flights: a refresh, reconnect, or second tab must be able
  // to request the same native window after the bounded rate interval.
  setBoundedMap(nativeHistoryChunkRequests, key, { at: now });
  return null;
}

function nativeHistoryRequestSignature(sessionId, msg, requestedSource) {
  const mode = msg.mode === 'older' ? 'older' : 'tail';
  const threadId = String(msg.thread_id || msg.threadId || '');
  const beforeOffset = mode === 'older'
    ? (msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? '')
    : '';
  const beforeId = mode === 'older'
    ? (msg.before_id ?? msg.beforeId ?? msg.cursor?.next_before_id ?? '')
    : '';
  const limit = Math.max(0, Math.min(1000, Math.floor(Number(msg.limit || msg.tail_limit || msg.history_limit) || 0)));
  const chunkBytes = Math.max(0, Math.floor(Number(msg.chunk_bytes || msg.chunkBytes) || 0));
  return JSON.stringify([
    sessionId,
    requestedSource || 'native',
    threadId,
    mode,
    beforeOffset,
    beforeId,
    limit,
    chunkBytes,
    msg.replace === true,
    msg.reconcile_metadata === true,
  ]);
}

function addNativeHistoryWaiter(flight, ws, requestId) {
  if (!flight || !ws || !requestId) return false;
  if (flight.waiters.some(waiter => waiter.ws === ws && waiter.requestId === requestId)) return true;
  if (flight.waiters.length >= MAX_NATIVE_HISTORY_WAITERS) return false;
  flight.waiters.push({ ws, requestId, requestedAt: Date.now() });
  return true;
}

function sendNativeHistoryResponse(waiter, response, flight, options = {}) {
  if (!waiter?.ws || waiter.ws.readyState !== WebSocket.OPEN) return false;
  const latencyMs = Math.max(0, Date.now() - Number(waiter.requestedAt || flight.createdAt || Date.now()));
  waiter.ws.send(JSON.stringify({
    ...response,
    request_id: waiter.requestId,
    history_delivery: {
      coalesced: options.coalesced === true,
      served_from_cache: options.servedFromCache === true,
      retry_count: Math.max(0, Number(flight.retryCount) || 0),
      latency_ms: latencyMs,
    },
  }));
  clearBrowserTranscriptGap(waiter.ws, flight.sessionId);
  return true;
}

function releaseNativeHistoryFlight(flight) {
  if (!flight) return;
  clearTimeout(flight.retryTimer);
  clearTimeout(flight.timeoutTimer);
  nativeHistoryChunkFlights.delete(flight.signature);
  nativeHistoryChunkFlightsByRequest.delete(flight.upstreamRequestId);
  pendingHistoryMetadataReconciliations.delete(flight.upstreamRequestId);
}

function finishNativeHistoryFlight(flight, response, options = {}) {
  if (!flight || nativeHistoryChunkFlights.get(flight.signature) !== flight) return;
  const waiters = flight.waiters.splice(0);
  const successful = !response?.error && Array.isArray(response?.messages);
  if (successful) {
    const cachedResponse = { ...response };
    delete cachedResponse.request_id;
    setBoundedMap(nativeHistoryChunkCache, flight.signature, {
      sessionId: flight.sessionId,
      storedAt: Date.now(),
      response: cachedResponse,
    });
  }
  if (options.terminalFailure || response?.error) nativeHistoryChunkMetrics.terminal_failure += 1;
  releaseNativeHistoryFlight(flight);
  const coalesced = waiters.length > 1;
  for (const waiter of waiters) sendNativeHistoryResponse(waiter, response, flight, { coalesced });
  log(response?.error ? 'warn' : 'info', 'history', response?.error
    ? 'Native history hydration failed'
    : 'Native history hydration completed', {
    session: flight.sessionId,
    source: flight.requestedSource,
    mode: flight.mode,
    waiters: waiters.length,
    retries: flight.retryCount,
    metrics: { ...nativeHistoryChunkMetrics },
  });
}

function scheduleNativeHistoryFlight(flight, delayMs) {
  if (!flight || nativeHistoryChunkFlights.get(flight.signature) !== flight) return;
  clearTimeout(flight.retryTimer);
  const boundedDelay = Math.max(25, Math.min(60_000, Math.ceil(Number(delayMs) || 0) + 25));
  flight.retryTimer = setTimeout(() => {
    flight.retryTimer = null;
    forwardNativeHistoryFlight(flight);
  }, boundedDelay);
  flight.retryTimer.unref?.();
}

function forwardNativeHistoryFlight(flight) {
  if (!flight || nativeHistoryChunkFlights.get(flight.signature) !== flight || flight.inFlight) return;
  if (flight.waiters.length === 0) {
    releaseNativeHistoryFlight(flight);
    return;
  }
  const proxyWs = proxySockets.get(flight.sessionId);
  if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
    nativeHistoryChunkMetrics.retried += 1;
    flight.retryCount += 1;
    scheduleNativeHistoryFlight(flight, 250);
    return;
  }
  const throttle = throttleNativeHistoryChunkRequest(flight.sessionId, flight.request);
  if (throttle) {
    nativeHistoryChunkMetrics.throttled += 1;
    nativeHistoryChunkMetrics.retried += 1;
    flight.retryCount += 1;
    scheduleNativeHistoryFlight(flight, throttle.retryAfterMs);
    return;
  }
  flight.proxyWs = proxyWs;
  flight.inFlight = true;
  if (flight.request.reconcile_metadata === true) {
    pendingHistoryMetadataReconciliations.set(flight.upstreamRequestId, {
      sessionId: flight.sessionId,
      requestedAt: Date.now(),
    });
  }
  try {
    proxyWs.send(JSON.stringify({
      ...flight.request,
      type: 'history_chunk_request',
      session: flight.sessionId,
      session_id: flight.sessionId,
      request_id: flight.upstreamRequestId,
    }));
    log('info', 'history', 'Forwarded coalesced native history chunk request', {
      session: flight.sessionId,
      mode: flight.mode,
      waiters: flight.waiters.length,
      retry: flight.retryCount,
    });
  } catch (error) {
    flight.inFlight = false;
    finishNativeHistoryFlight(flight, {
      type: 'history_chunk', protocol_version: PROTOCOL_VERSION,
      session: flight.sessionId, session_id: flight.sessionId,
      mode: flight.mode, source: flight.requestedSource,
      messages: [], partial: false, complete: true,
      error: { code: 'proxy_send_failed', message: error?.message || 'Native transcript request could not be forwarded.' },
      cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 0 },
    }, { terminalFailure: true });
  }
}

function beginNativeHistoryRequest(ws, msg, sessionId, requestId, requestedSource) {
  const signature = nativeHistoryRequestSignature(sessionId, msg, requestedSource);
  nativeHistoryChunkMetrics.requested += 1;
  const cached = nativeHistoryChunkCache.get(signature);
  if (cached && Date.now() - cached.storedAt <= NATIVE_HISTORY_RESULT_CACHE_MS) {
    nativeHistoryChunkMetrics.served_from_cache += 1;
    const syntheticFlight = {
      createdAt: Date.now(), sessionId, requestedSource,
      retryCount: 0,
    };
    sendNativeHistoryResponse({ ws, requestId, requestedAt: Date.now() }, cached.response, syntheticFlight, {
      servedFromCache: true,
    });
    return;
  }
  if (cached) nativeHistoryChunkCache.delete(signature);
  const existing = nativeHistoryChunkFlights.get(signature);
  if (existing) {
    if (!addNativeHistoryWaiter(existing, ws, requestId)) {
      sendHistoryChunkError(ws, {
        sessionId, requestId, mode: msg.mode || 'tail', source: requestedSource,
        code: 'history_waiter_capacity',
        message: 'Too many clients are already waiting for this transcript refresh. Retry shortly.',
        retryAfterMs: NATIVE_HISTORY_TAIL_MIN_INTERVAL_MS,
      });
      return;
    }
    nativeHistoryChunkMetrics.coalesced += 1;
    return;
  }
  if (nativeHistoryChunkFlights.size >= RUNTIME_MAP_MAX_ENTRIES) {
    const oldest = nativeHistoryChunkFlights.values().next().value;
    if (oldest) finishNativeHistoryFlight(oldest, {
      type: 'history_chunk', protocol_version: PROTOCOL_VERSION,
      session: oldest.sessionId, session_id: oldest.sessionId,
      mode: oldest.mode, source: oldest.requestedSource,
      messages: [], partial: false, complete: true,
      error: { code: 'history_request_capacity', message: 'Transcript request capacity was reached; retry shortly.' },
      cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 0 },
    }, { terminalFailure: true });
  }
  const upstreamRequestId = `histnative-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const flight = {
    signature,
    upstreamRequestId,
    sessionId,
    requestedSource,
    mode: msg.mode === 'older' ? 'older' : 'tail',
    request: { ...msg, source: requestedSource },
    waiters: [],
    createdAt: Date.now(),
    retryCount: 0,
    inFlight: false,
    retryTimer: null,
    timeoutTimer: null,
  };
  addNativeHistoryWaiter(flight, ws, requestId);
  nativeHistoryChunkFlights.set(signature, flight);
  nativeHistoryChunkFlightsByRequest.set(upstreamRequestId, flight);
  flight.timeoutTimer = setTimeout(() => {
    finishNativeHistoryFlight(flight, {
      type: 'history_chunk', protocol_version: PROTOCOL_VERSION,
      session: sessionId, session_id: sessionId,
      mode: flight.mode, source: requestedSource,
      messages: [], partial: false, complete: true,
      error: { code: 'history_chunk_timeout', message: 'Transcript history request timed out after bounded automatic retries.' },
      cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 0 },
    }, { terminalFailure: true });
  }, NATIVE_HISTORY_REQUEST_TIMEOUT_MS);
  flight.timeoutTimer.unref?.();
  forwardNativeHistoryFlight(flight);
}

function nativeHistoryRetryAfterMs(msg, flight) {
  const code = String(msg?.error?.code || '');
  if (!['history_chunk_throttled', 'history_chunk_duplicate_cursor', 'throttled'].includes(code)) return 0;
  const hinted = Number(msg?.error?.retry_after_ms ?? msg?.retry_after_ms);
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(60_000, Math.ceil(hinted));
  return flight?.mode === 'older' ? NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS : NATIVE_HISTORY_TAIL_MIN_INTERVAL_MS;
}

function handleNativeHistoryFlightResponse(msg, sourceWs) {
  const requestId = msg?.request_id || null;
  const flight = requestId ? nativeHistoryChunkFlightsByRequest.get(requestId) : null;
  if (!flight) return false;
  if (flight.proxyWs !== sourceWs || (msg.session_id || msg.session) !== flight.sessionId) {
    log('warn', 'history', 'Ignored native history response from a mismatched proxy/session', {
      session: msg.session_id || msg.session || null,
      expected_session: flight.sessionId,
      request_id: requestId,
    });
    return true;
  }
  flight.inFlight = false;
  pendingHistoryMetadataReconciliations.delete(requestId);
  const retryAfterMs = nativeHistoryRetryAfterMs(msg, flight);
  if (retryAfterMs > 0 && flight.retryCount < 4) {
    nativeHistoryChunkMetrics.throttled += 1;
    nativeHistoryChunkMetrics.retried += 1;
    flight.retryCount += 1;
    scheduleNativeHistoryFlight(flight, retryAfterMs);
    return true;
  }
  const reconciliationRequest = msg.mode === 'older' && flight.request.reconcile_metadata === true
    ? { sessionId: flight.sessionId }
    : null;
  const reconciliation = reconciliationRequest
    && msg.source?.endsWith('_jsonl')
    ? reconcileHistoryTailSourceMetadata(flight.sessionId, msg.messages, msg.source)
    : null;
  if (reconciliation?.applied) {
    broadcastTranscriptGap(flight.sessionId, {
      reason: 'authoritative_metadata_reconciliation',
      source: msg.source || null,
      source_cursor: msg.cursor || msg.source_cursor || null,
    });
  }
  finishNativeHistoryFlight(flight, reconciliation ? { ...msg, metadata_reconciliation: reconciliation } : msg, {
    terminalFailure: !!msg.error,
  });
  return true;
}

function abandonNativeHistoryWaiter(ws) {
  for (const flight of nativeHistoryChunkFlights.values()) {
    flight.waiters = flight.waiters.filter(waiter => waiter.ws !== ws);
    if (flight.waiters.length === 0 && !flight.inFlight) releaseNativeHistoryFlight(flight);
  }
}

function recoverNativeHistoryFlightsForProxy(ws) {
  for (const flight of nativeHistoryChunkFlights.values()) {
    if (flight.proxyWs !== ws) continue;
    flight.proxyWs = null;
    flight.inFlight = false;
    pendingHistoryMetadataReconciliations.delete(flight.upstreamRequestId);
    nativeHistoryChunkMetrics.retried += 1;
    flight.retryCount += 1;
    scheduleNativeHistoryFlight(flight, 250);
  }
}

function statusBroadcastSignature(msg) {
  const activity = msg?.activity && typeof msg.activity === 'object' ? msg.activity : null;
  const goal = activity?.goal && typeof activity.goal === 'object'
      ? {
        label: activity.goal.label || '',
        text: activity.goal.text || '',
        objective: activity.goal.objective || '',
        state: activity.goal.state || '',
        status: activity.goal.status || '',
        raw_state: activity.goal.raw_state || '',
        fingerprint: activity.goal.fingerprint || '',
        generation: activity.goal.generation ?? null,
        transition_seq: activity.goal.transition_seq ?? null,
        transition_id: activity.goal.transition_id || '',
        native_updated_at: activity.goal.native_updated_at || null,
        native_cursor: activity.goal.native_cursor || null,
        started_at: activity.goal.started_at || null,
        time_used_seconds: activity.goal.time_used_seconds ?? activity.goal.timeUsedSeconds ?? null,
        tokens_used: activity.goal.tokens_used ?? activity.goal.tokensUsed ?? null,
      }
    : null;
  const goalRun = activity?.goal_run && typeof activity.goal_run === 'object'
    ? {
        schema_version: activity.goal_run.schema_version ?? null,
        run_id: activity.goal_run.run_id || '',
        goal_fingerprint: activity.goal_run.goal_fingerprint || '',
        goal_generation: activity.goal_run.goal_generation ?? null,
        lifecycle: activity.goal_run.lifecycle || '',
        lease_active: activity.goal_run.lease_active === true,
        owner_state: activity.goal_run.owner_state || '',
        transition_seq: activity.goal_run.transition_seq ?? null,
        transition_id: activity.goal_run.transition_id || '',
        source_sequence: activity.goal_run.source_sequence ?? null,
      }
    : null;
  return JSON.stringify({
    thinking: !!msg?.thinking,
    label: msg?.label || '',
    thinking_content: msg?.thinking_content || '',
    activity: activity ? {
      kind: activity.kind || '',
      label: activity.label || '',
      started_at: activity.started_at || null,
      observed_at: activity.observed_at || null,
      interrupt_hint: activity.interrupt_hint || '',
      thinkingContent: activity.thinkingContent || '',
      task_list: activity.task_list || null,
      context_card: activity.context_card || null,
      thinking: activity.thinking || null,
      connection: activity.connection || null,
      connection_tombstone: activity.connection_tombstone ? {
        state: activity.connection_tombstone.state || '',
        generation: activity.connection_tombstone.generation || '',
        generation_seq: activity.connection_tombstone.generation_seq || 0,
        attempt: activity.connection_tombstone.attempt || null,
        attempt_limit: activity.connection_tombstone.attempt_limit || null,
      } : null,
      interruption: activity.interruption || null,
      interruption_tombstone: activity.interruption_tombstone ? {
        event_id: activity.interruption_tombstone.event_id || '',
        resolution_state: activity.interruption_tombstone.resolution_state || '',
        transition_seq: activity.interruption_tombstone.transition_seq || 0,
        resolved_at: activity.interruption_tombstone.resolved_at || null,
      } : null,
      current: activity.current || null,
      step: activity.step || null,
      usage: activity.usage || null,
      goal,
      goal_run: goalRun,
    } : null,
  });
}

function shouldBroadcastStatus(sessionId, statusMsg) {
  if (!sessionId) return true;
  const now = Date.now();
  const sig = statusBroadcastSignature(statusMsg);
  const previous = statusBroadcastState.get(sessionId);
  if (!previous || previous.sig !== sig || now - previous.at >= STATUS_BROADCAST_REFRESH_MS) {
    statusBroadcastState.set(sessionId, { sig, at: now });
    return true;
  }
  return false;
}

function getSessionListEntry(id) {
  const meta = sessionMeta.get(id);
  if (!meta) {
    const latestProjection = latestVisibleMessageProjection(id);
    return Object.keys(latestProjection).length > 0
      ? {
        session_id: id,
        status: sessionHealth.get(id) || 'healthy',
        control_generation: Math.max(1, Number(sessionControlGeneration.get(id)) || 1),
        turn_generation: Math.max(0, Number(sessionTurnGeneration.get(id)) || 0),
        last_seen_at: sessionLastSeen.has(id) ? new Date(sessionLastSeen.get(id)).toISOString() : null,
        ...latestProjection,
      }
      : id;
  }
  const {
    latest_visible_message: _legacyLatestVisibleMessage,
    last_message_id: _legacyLastMessageId,
    last_message_at: _legacyLastMessageAt,
    last_message_kind: _legacyLastMessageKind,
    last_message_source: _legacyLastMessageSource,
    ...safeMeta
  } = meta;
  return {
    ...safeMeta,
    session_id:   id,
    status:       sessionHealth.get(id) || meta.status || 'healthy',
    control_generation: Math.max(1, Number(sessionControlGeneration.get(id)) || 1),
    turn_generation: Math.max(0, Number(sessionTurnGeneration.get(id)) || 0),
    last_seen_at: meta.last_seen_at || (sessionLastSeen.has(id) ? new Date(sessionLastSeen.get(id)).toISOString() : null),
    ...latestVisibleMessageProjection(id),
  };
}

function getSessionList() {
  return Array.from(proxySockets.keys()).map(getSessionListEntry);
}

function compactAgentConfigForAck(config) {
  if (!config || typeof config !== 'object') return null;
  const compact = {};
  [
    'session_id',
    'session',
    'agent_type',
    'model_id',
    'mode',
    'conversation_mode',
    'permission_mode',
    'permission_profile',
    'approval_policy',
    'approvals_reviewer',
    'bypass_permissions_active',
    'bypass_restore_profile',
    'file_access_scope',
    'branch',
    'effort',
    'speed',
    'sandbox_status',
    'auto_approve_permissions',
    'source_revision',
    'config_semantics',
    'conversation_scoped',
    'controls_available',
    'controls_unavailable_reason',
    'available_models',
    'available_efforts',
    'available_access',
    'available_speeds',
    'available_permission_profiles',
    'model_catalog',
    'effort_catalog',
    'permission_catalog',
    'capabilities',
  ].forEach(key => {
    if (config[key] !== undefined) compact[key] = config[key];
  });
  return compact;
}

function compactAgentConfigMessage(msg) {
  const sessionId = msg.session_id || msg.session;
  return {
    type:             'agent_config',
    protocol_version: msg.protocol_version || PROTOCOL_VERSION,
    session_id:       sessionId,
    ...compactAgentConfigForAck(msg),
    read_at:          msg.read_at || new Date().toISOString(),
  };
}

function getCompactAgentConfigsForAck() {
  const entries = [];
  for (const [sessionId, config] of agentConfigs) {
    if (!proxySockets.has(sessionId)) continue;
    const compact = compactAgentConfigForAck(config);
    if (compact) entries.push([sessionId, compact]);
  }
  return Object.fromEntries(entries);
}

function findRelatedHistorySession(sessionId) {
  const liveMeta = sessionMeta.get(sessionId);
  const persistedMeta = stmtGetSessionMeta.get(sessionId);
  const meta = liveMeta || persistedMeta;
  if (!meta || meta.agent_type !== 'codex-desktop') return null;
  if (liveMeta) return null;

  let candidate = null;
  if (meta.workspace_path) {
    candidate = stmtFindRelatedHistoryByPath.get(
      sessionId,
      meta.workspace_path,
      'codex-desktop',
      'codex-desktop',
      'codex-desktop'
    );
  }
  if (!candidate && meta.workspace_name) {
    candidate = stmtFindRelatedHistoryByName.get(
      sessionId,
      meta.workspace_name,
      'codex-desktop',
      'codex-desktop',
      'codex-desktop'
    );
  }
  if (!candidate?.session_id) return null;
  return candidate;
}

function getEffectiveHistory(sessionId) {
  const direct = getHistoryRows(sessionId);
  if (direct.length > 0) return direct;

  const candidate = findRelatedHistorySession(sessionId);
  if (!candidate?.session_id) return direct;

  const fallback = getHistoryRows(candidate.session_id);
  if (fallback.length > 0) {
    log('info', 'history', 'Using related Codex Desktop history fallback', {
      requested_session: sessionId,
      fallback_session: candidate.session_id,
      fallback_agent_type: candidate.agent_type,
      message_count: fallback.length,
    });
  }
  return fallback;
}

function getEffectiveHistoryTail(sessionId, limit) {
  const directTotal = getHistoryCount(sessionId);
  if (directTotal > 0) {
    const messages = getHistoryRowsTail(sessionId, limit);
    return {
      messages,
      total: directTotal,
      loaded: messages.length,
      source_session: sessionId,
    };
  }

  const candidate = findRelatedHistorySession(sessionId);
  if (!candidate?.session_id) {
    return { messages: [], total: 0, loaded: 0, source_session: sessionId };
  }

  const total = getHistoryCount(candidate.session_id);
  const messages = total > 0 ? getHistoryRowsTail(candidate.session_id, limit) : [];
  if (messages.length > 0) {
    log('info', 'history', 'Using related Codex Desktop history tail fallback', {
      requested_session: sessionId,
      fallback_session: candidate.session_id,
      fallback_agent_type: candidate.agent_type,
      message_count: messages.length,
      total_messages: total,
    });
  }
  return {
    messages,
    total,
    loaded: messages.length,
    source_session: candidate.session_id,
  };
}

function resolveEffectiveHistorySource(sessionId) {
  const directTotal = getHistoryCount(sessionId);
  if (directTotal > 0) return { sourceSession: sessionId, total: directTotal };

  const candidate = findRelatedHistorySession(sessionId);
  if (!candidate?.session_id) return { sourceSession: sessionId, total: 0 };

  const total = getHistoryCount(candidate.session_id);
  if (total > 0) {
    log('info', 'history', 'Using related history chunk fallback', {
      requested_session: sessionId,
      fallback_session: candidate.session_id,
      fallback_agent_type: candidate.agent_type,
      total_messages: total,
    });
  }
  return { sourceSession: candidate.session_id, total };
}

function getEffectiveHistoryChunk(sessionId, { beforeId = null, aroundId = null, limit = DEFAULT_HISTORY_CHUNK_LIMIT } = {}) {
  const safeLimit = historyChunkLimit(limit);
  const { sourceSession, total } = resolveEffectiveHistorySource(sessionId);
  if (!total) {
    return {
      messages: [],
      total: 0,
      source_session: sourceSession,
      next_before_id: null,
      partial: false,
      limit: safeLimit,
    };
  }

  const safeBeforeId = Math.max(0, Math.floor(Number(beforeId) || 0));
  const safeAroundId = Math.max(0, Math.floor(Number(aroundId) || 0));
  const messages = safeAroundId
    ? getHistoryRowsAroundId(sourceSession, safeAroundId, safeLimit)
    : safeBeforeId
      ? getHistoryRowsBeforeId(sourceSession, safeBeforeId, safeLimit)
      : getHistoryRowsTail(sourceSession, safeLimit);
  const firstId = messages[0]?.id || null;
  const remainingBefore = firstId ? getHistoryCountBeforeId(sourceSession, firstId) : 0;
  return {
    messages,
    total,
    source_session: sourceSession,
    next_before_id: remainingBefore > 0 ? firstId : null,
    partial: remainingBefore > 0,
    limit: safeLimit,
  };
}

// Returns any active proxy WebSocket, regardless of session registration.
// Used for launch_session which may target a proxy before any session is registered.
function getProxySocket() {
  for (const ws of proxyConnections) {
    if (ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

// Emit session_launch_failed for a pending request and clean up.
// Sends to the originating browser if still connected, otherwise broadcasts.
function cancelPendingLaunch(requestId, errorCode, reason) {
  const pending = pendingLaunches.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingLaunches.delete(requestId);
  const msg = JSON.stringify({
    type:             'session_launch_failed',
    protocol_version: PROTOCOL_VERSION,
    request_id:       requestId,
    agent_type:       pending.agent_type,
    error_code:       errorCode,
    reason,
    server_ts:        new Date().toISOString(),
  });
  if (pending.browser_ws?.readyState === WebSocket.OPEN) {
    pending.browser_ws.send(msg);
  } else {
    // Originating browser gone — broadcast so any reconnected tab picks it up
    for (const ws of browserClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
  log('warn', 'launch', `Launch failed: ${errorCode}`, { request_id: requestId, reason });
}

// Apply the default_choice for an expired permission prompt and notify browsers.
function expirePrompt(sessionId, promptId) {
  const key   = `${sessionId}:${promptId}`;
  const entry = pendingPrompts.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingPrompts.delete(key);
  // Send synthetic response to proxy so it dismisses the dialog
  const proxyWs = proxySockets.get(sessionId);
  if (proxyWs && proxyWs.readyState === WebSocket.OPEN) {
    proxyWs.send(JSON.stringify({
      type:             'permission_response',
      protocol_version: PROTOCOL_VERSION,
      session_id:       sessionId,
      prompt_id:        promptId,
      choice_id:        entry.prompt.default_choice,
      auto_applied:     true,
    }));
  }
  broadcastToBrowsers({
    type:             'permission_prompt_expired',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    prompt_id:        promptId,
    applied_choice:   entry.prompt.default_choice,
    server_ts:        new Date().toISOString(),
  });
  log('info', 'prompt', `Prompt expired, applied: ${entry.prompt.default_choice}`, { session: sessionId, prompt_id: promptId });
}

function questionPromptTimerKey(prompt) {
  return `${prompt.session_id}\0${prompt.prompt_id}\0${prompt.generation}`;
}

function clearQuestionPromptDeadline(prompt) {
  if (!prompt) return;
  const key = questionPromptTimerKey(prompt);
  const timer = questionPromptTimers.get(key);
  if (timer) clearTimeout(timer);
  questionPromptTimers.delete(key);
}

function publishQuestionPrompt(prompt) {
  broadcastToBrowsers({
    ...prompt,
    type: 'question_prompt',
    protocol_version: PROTOCOL_VERSION,
    server_ts: new Date().toISOString(),
  });
}

function publishQuestionPromptState(prompt) {
  if (!prompt) return;
  if (!['open', 'submitting'].includes(prompt.lifecycle)) clearQuestionPromptDeadline(prompt);
  broadcastToBrowsers({
    ...prompt,
    type: 'question_prompt_state',
    protocol_version: PROTOCOL_VERSION,
    server_ts: new Date().toISOString(),
  });
}

function scheduleQuestionPromptDeadline(prompt) {
  clearQuestionPromptDeadline(prompt);
  if (!prompt?.deadline_at || !['open', 'submitting'].includes(prompt.lifecycle)) return;
  const expiresAt = Date.parse(prompt.deadline_at) + questionPromptDeadlineGraceMs(prompt);
  const delay = Math.max(0, expiresAt - Date.now());
  const key = questionPromptTimerKey(prompt);
  const timer = setTimeout(() => {
    questionPromptTimers.delete(key);
    if (expiresAt > Date.now()) {
      scheduleQuestionPromptDeadline(prompt);
      return;
    }
    const expired = questionPromptRegistry.expire(prompt.session_id, prompt.prompt_id, prompt.generation);
    if (!expired) return;
    publishQuestionPromptState(expired);
    log('info', 'question', 'Native question deadline elapsed without a synthetic answer', {
      session: prompt.session_id,
      prompt_id: prompt.prompt_id,
      receipt_grace_ms: questionPromptDeadlineGraceMs(prompt),
    });
  }, Math.min(delay, 0x7fffffff));
  timer.unref?.();
  questionPromptTimers.set(key, timer);
}

function removeQuestionPromptsForSession(sessionId) {
  for (const prompt of questionPromptRegistry.views({ includeTerminal: true })) {
    if (prompt.session_id === sessionId) clearQuestionPromptDeadline(prompt);
  }
  questionPromptRegistry.removeSession(sessionId);
}

function questionControlFailure(ws, msg, code, message) {
  ws.send(JSON.stringify({
    type: 'agent_control_result',
    protocol_version: PROTOCOL_VERSION,
    request_id: msg?.request_id,
    session_id: msg?.session_id || msg?.session,
    command: 'question_response',
    result: 'failed',
    error: { code, message },
    server_ts: new Date().toISOString(),
  }));
}

function exactControlFailure(ws, msg, command, code, message, extra = {}) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'agent_control_result',
    protocol_version: PROTOCOL_VERSION,
    request_id: msg?.request_id || null,
    session_id: msg?.session_id || msg?.session || null,
    command,
    result: 'failed',
    error: { code, message },
    retryable: extra.retryable === true,
    native_attempted: extra.native_attempted === true,
    server_ts: new Date().toISOString(),
  }));
}

function deliverExactControlResult(upstreamRequestId, receipt) {
  const timer = exactControlTimers.get(upstreamRequestId);
  if (timer) clearTimeout(timer);
  exactControlTimers.delete(upstreamRequestId);
  const resolution = exactControlRegistry.resolve(upstreamRequestId, receipt);
  if (!resolution) return false;
  for (const delivery of resolution.deliveries) {
    if (delivery.client.readyState === WebSocket.OPEN) {
      delivery.client.send(JSON.stringify(delivery.receipt));
    }
  }
  return true;
}

function forwardExactlyOnceControl(ws, msg, command) {
  const rawSessionId = msg.session_id || msg.session;
  const rawRequestId = msg.request_id;
  if (!boundedString(rawSessionId, { min: 1, max: 160 })
      || !boundedString(rawRequestId, { min: 1, max: 120 })) {
    exactControlFailure(ws, msg, command, 'invalid_request', 'A bounded session and request ID are required.');
    return;
  }
  const sessionId = rawSessionId;
  const requestId = rawRequestId;
  if (!msg.connection_id || msg.connection_id !== ws._controlConnectionId) {
    exactControlFailure(ws, msg, command, 'stale_client_connection', 'This control came from an expired client connection.', { retryable: true });
    return;
  }
  const expectedSessionGeneration = Math.max(0, Number(msg.session_generation) || 0);
  const currentSessionGeneration = Math.max(1, Number(sessionControlGeneration.get(sessionId)) || 1);
  if (!expectedSessionGeneration || expectedSessionGeneration !== currentSessionGeneration) {
    exactControlFailure(ws, msg, command, 'stale_session_generation', 'The native session owner changed. Refresh before retrying.', { retryable: true });
    return;
  }
  const proxyWs = proxySockets.get(sessionId);
  if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
    exactControlFailure(ws, msg, command, 'no_proxy_connected', 'Session not connected', { retryable: true });
    return;
  }
  const meta = sessionMeta.get(sessionId) || {};
  const capabilities = agentConfigs.get(sessionId)?.capabilities || meta.capabilities || {};
  let key;
  let payload;
  if (command === 'agent_goal_control') {
    const action = msg.action === 'pause' ? 'pause' : msg.action === 'resume' ? 'resume' : null;
    const goal = meta.activity?.goal || null;
    const agentType = meta.agent_type || 'unknown';
    if (!action || capabilities.goal_pause_resume !== true || !goalLifecycleSupported(agentType, capabilities)) {
      exactControlFailure(ws, msg, command, 'goal_control_unsupported', 'This session has no verified native goal control.');
      return;
    }
    const generation = Math.max(1, Number(goal.generation) || 1);
    const transitionSeq = Math.max(0, Number(goal.transition_seq) || 0);
    const state = String(goal.state || goal.status || '').toLowerCase();
    const expectedStates = action === 'pause'
      ? ['active']
      : (capabilities.goal_blocked_resume === true ? ['paused', 'blocked'] : ['paused']);
    if (!expectedStates.includes(state)
        || Number(msg.goal_generation) !== generation
        || Number(msg.goal_transition_seq || 0) !== transitionSeq
        || !goal.fingerprint
        || msg.goal_fingerprint !== goal.fingerprint) {
      exactControlFailure(ws, msg, command, 'stale_goal_generation', 'The authoritative goal changed before this action.', { retryable: true });
      return;
    }
    key = [sessionId, currentSessionGeneration, command, action, generation, transitionSeq, goal.fingerprint].join(':');
    payload = {
      type: command,
      protocol_version: PROTOCOL_VERSION,
      session_id: sessionId,
      action,
      goal_generation: generation,
      goal_transition_seq: transitionSeq,
      goal_fingerprint: goal.fingerprint,
      session_generation: currentSessionGeneration,
    };
  } else {
    const turnGeneration = Math.max(0, Number(sessionTurnGeneration.get(sessionId)) || 0);
    const kind = String(meta.activity?.kind || sessionActivity.get(sessionId) || '').toLowerCase();
    const active = ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(kind);
    if (capabilities.interrupt !== true) {
      exactControlFailure(ws, msg, command, 'interrupt_unsupported', capabilities.interrupt_gate || 'No verified session-scoped stop exists.');
      return;
    }
    if (!active || !turnGeneration || Number(msg.turn_generation) !== turnGeneration) {
      exactControlFailure(ws, msg, command, 'stale_turn_generation', 'No matching in-flight turn remains.', { retryable: true });
      return;
    }
    key = [sessionId, currentSessionGeneration, command, turnGeneration].join(':');
    payload = {
      type: command,
      protocol_version: PROTOCOL_VERSION,
      session_id: sessionId,
      turn_generation: turnGeneration,
      session_generation: currentSessionGeneration,
    };
  }
  const claim = exactControlRegistry.claim({
    key,
    requestId,
    client: ws,
    context: { sessionId, command, proxyWs },
  });
  if (claim.state === 'replay') {
    ws.send(JSON.stringify(claim.receipt));
    return;
  }
  if (claim.state === 'coalesced') return;
  const upstreamRequestId = claim.upstreamRequestId;
  const timer = setTimeout(() => {
    deliverExactControlResult(upstreamRequestId, {
      type: 'agent_control_result',
      protocol_version: PROTOCOL_VERSION,
      request_id: upstreamRequestId,
      session_id: sessionId,
      command,
      result: 'failed',
      error: { code: 'native_control_timeout', message: 'The native adapter did not acknowledge this control in time.' },
      retryable: true,
      native_attempted: true,
      server_ts: new Date().toISOString(),
    });
  }, 15_000);
  timer.unref?.();
  exactControlTimers.set(upstreamRequestId, timer);
  proxyWs.send(JSON.stringify({ ...payload, request_id: upstreamRequestId }));
}

// ── Session health management (A2-02) ────────────────────────────────────────

function setHealth(sessionId, health) {
  const previousHealth = sessionHealth.get(sessionId);
  if (previousHealth === health) return;
  sessionHealth.set(sessionId, health);
  log('info', 'health', `${sessionId} → ${health}`);
  broadcastToBrowsers({ type: 'session_health', session: sessionId, health });
  if (health === 'disconnected' && previousHealth && shouldSendPush()) {
    const name = notificationSessionName(sessionId);
    sendPushNotification(
      `${name} went offline`,
      'The agent session disconnected from the relay.',
      { type: 'session_offline', activity_type: 'offline', session_id: sessionId, session_name: name },
    ).catch(() => {});
  }
}

function touchSession(sessionId) {
  sessionLastSeen.set(sessionId, Date.now());
  if (proxySockets.has(sessionId)) setHealth(sessionId, 'healthy');
}

// Degrade sessions with no recent activity
setInterval(() => {
  const now = Date.now();
  for (const [id] of proxySockets) {
    const last = sessionLastSeen.get(id) || 0;
    if (now - last > HEALTH_DEGRADE_AFTER_MS && sessionHealth.get(id) === 'healthy') {
      setHealth(id, 'degraded');
    }
  }
}, 30_000);

// ── Heartbeat management (A2-02) ─────────────────────────────────────────────

function startHeartbeat(ws, label) {
  ws._hbAlive = true;
  ws._hbMisses = 0;
  ws._hbTimer = setInterval(() => {
    if (!ws._hbAlive) {
      ws._hbMisses += 1;
      if (ws._hbMisses >= 2) {
        log('warn', 'heartbeat', `${label} missed two consecutive pongs — terminating`);
        ws.terminate();
        return;
      }
      log('warn', 'heartbeat', `${label} missed pong — allowing one grace interval`);
    } else {
      ws._hbMisses = 0;
    }
    ws._hbAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_INTERVAL_MS);
  ws.on('pong', () => {
    ws._hbAlive = true;
    ws._hbMisses = 0;
  });
  ws.on('close', () => clearInterval(ws._hbTimer));
}

function applicationHeartbeatAck(message, relayReceivedAtMs) {
  const relaySentAtMs = Date.now();
  const numericClientSentAtMs = Number(message?.client_sent_at_ms);
  const parsedClientSentAtMs = Number.isFinite(numericClientSentAtMs) && numericClientSentAtMs > 0
    ? numericClientSentAtMs
    : Date.parse(String(message?.client_ts || ''));
  return {
    type: 'heartbeat_ack',
    protocol_version: PROTOCOL_VERSION,
    request_id: message?.request_id,
    server_ts: new Date(relaySentAtMs).toISOString(),
    relay_clock_sample_version: 1,
    ...(Number.isFinite(parsedClientSentAtMs) && parsedClientSentAtMs > 0
      ? { client_sent_at_ms: parsedClientSentAtMs }
      : {}),
    relay_received_at_ms: relayReceivedAtMs,
    relay_sent_at_ms: relaySentAtMs,
  };
}

// ── Message validation (A8-01) ────────────────────────────────────────────────

const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024; // 128 MB transport-level limit
const MAX_CONTENT_BYTES = 1024 * 1024;       // 1 MB per send message
const UPLOAD_MAX_BYTES  = 2 * 1024 * 1024;   // 2 MB upload limit

// UUID v4 or short alphanumeric/hyphen/underscore slug (3–64 chars)
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[a-zA-Z0-9_-]{3,64}$/i;
function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

const KNOWN_PROXY_TYPES = new Set([
  'connection_hello', 'hello', 'heartbeat',
  'session_list', 'proxy_session_snapshot',
  'status', 'proxy_status',
  'message', 'proxy_message', 'message_delta',
  'session_launch_ack', 'session_launch_failed', 'session_closed', 'session_close_failed', 'session_meta_backfill',
  'session_alias_reconciled', 'session_alias_released',
  'permission_prompt', 'permission_prompt_expired', 'question_prompt', 'question_prompt_state',
  'session_error_prompt', 'session_error_prompt_cleared', 'agent_config', 'agent_control_result',
  'history', 'history_snapshot', 'history_chunk',
  'rate_limit_active', 'rate_limit_cleared',
  'chat_list', 'thread_list', 'terminal_output', 'file_changes',
  'branch_list', 'skill_list', 'codex_automation_view',
  'directory_listing', 'file_content',
  'message_queued', 'queue_delivered', 'steer_result', 'proxy_send_result', 'agent_started',
  'latency_trace_terminal',
  'native_queue',
  'provider_usage_snapshot',
  'provider_usage_refresh_receipt',
  'provider_usage_reset_credit_receipt',
  'provider_usage_cost_detail', 'provider_usage_cost_detail_error',
  'host_resource_snapshot', 'host_resource_live', 'host_resource_detail',
  'host_resource_subscription_ack', 'host_resource_subscription_error',
  'host_resource_history_chunk', 'host_resource_unsubscribed',
]);

const KNOWN_CLIENT_TYPES = new Set([
  'connection_hello', 'hello', 'heartbeat',
  'subscribe',
  'get_history', 'history_request', 'history_chunk_request',
  'send', 'send_message',
  'launch_session', 'resume_session', 'close_session', 'dismiss_session',
  'permission_response', 'question_response', 'error_prompt_action', 'agent_interrupt', 'agent_goal_control', 'agent_config_request',
  'agent_set_model', 'agent_set_effort', 'agent_set_permission_mode', 'agent_set_auto_approve_permissions',
  'set_codex_config', 'agent_set_mode',
  'new_thread', 'open_panel', 'open_native_window', 'chat_list', 'switch_chat', 'new_chat',
  'thread_list', 'switch_thread', 'switch_workspace', 'terminal_output',
  'file_changes', 'file_change_response', 'send_attachment', 'terminal_input',
  'branch_list', 'switch_branch', 'create_branch',
  'skill_list', 'automation_view_action', 'list_directory', 'read_file',
  'steer', 'discard_queued', 'edit_queued',
  'automations_list', 'automations_create', 'automations_update', 'automations_delete', 'automations_run',
  'provider_usage_refresh', 'provider_usage_watch',
  'provider_usage_reset_credit_consume',
  'provider_usage_cost_detail_request',
  'host_resource_refresh', 'host_resource_subscribe', 'host_resource_unsubscribe',
  'host_resource_history_request',
  'latency_trace_complete',
]);

// Rate limiting for browser sends (A8-03): 30 sends per 10 s window
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MS  = 10_000;
const MSG_RATE_LIMIT = 200;
const MSG_RATE_WINDOW = 60_000;
const browserSendRateLimit = createPrincipalWindowLimiter({
  limit: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_MS,
});
const browserMessageRateLimit = createPrincipalWindowLimiter({
  limit: MSG_RATE_LIMIT,
  windowMs: MSG_RATE_WINDOW,
});

function authenticatedWebSocketPrincipal(ws, req) {
  const email = ws._appUser?.email || req.user?.email || ALLOWED_EMAIL;
  if (email) return `email:${String(email).toLowerCase()}`;
  return `lan:${req.socket?.remoteAddress || 'unknown'}`;
}

function authenticatedWebSocketEmail(ws, req) {
  return String(ws._appUser?.email || req.user?.email || ALLOWED_EMAIL || 'lan-user').toLowerCase();
}

function relayOperatorActionProof(ws, req, msg, action) {
  if (msg?.operator_user_gesture !== true
      || msg?.synthetic === true
      || msg?.automation === true
      || msg?.validator === true) return null;
  const authenticatedEmail = String(ws._appUser?.email || req.user?.email || '').trim().toLowerCase();
  if (!authenticatedEmail) return null;
  if (ALLOWED_EMAIL && authenticatedEmail !== String(ALLOWED_EMAIL).trim().toLowerCase()) return null;
  return createRelayOperatorActionProof({
    action,
    requestId: msg.request_id,
    channel: ws._appUser ? 'android' : 'web',
  });
}

function rejectOperatorActionOnly(ws, msg, command) {
  ws.send(JSON.stringify({
    type: 'agent_control_result',
    protocol_version: PROTOCOL_VERSION,
    request_id: msg.request_id,
    session_id: msg.session_id || msg.session,
    command,
    result: 'failed',
    error: {
      code: 'operator_action_only',
      message: 'Visible native windows require an explicit click or press by the authenticated operator.',
    },
    server_ts: new Date().toISOString(),
  }));
}

// ── WebSocket routing ─────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

server.on('upgrade', (req, socket, head) => {
  sessionMiddleware(req, {}, () => {
    passport.initialize()(req, {}, () => {
      passport.session()(req, {}, () => {
        const url = req.url.split('?')[0];
        if (url === '/proxy-ws') {
          // SEC-02: Secret validation moved to connection_hello handler (no longer in URL query)
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws._type = 'proxy';
            ws._authenticated = !PROXY_SECRET; // pre-authenticated if no secret configured
            wss.emit('connection', ws, req);
          });
        } else if (url === '/client-ws') {
          // SEC-11: Validate Origin header to prevent cross-site WebSocket hijacking
          const origin = req.headers.origin;
          if (origin) {
            const allowedOrigins = new Set([new URL(PUBLIC_URL).origin]);
            // Also allow the server's own LAN origin (e.g. http://your-server-ip:3500)
            allowedOrigins.add(`http://localhost:${PORT}`);
            allowedOrigins.add(`http://127.0.0.1:${PORT}`);
            if (ALLOW_LAN_BYPASS && isLAN(req)) {
              allowedOrigins.add(origin); // trust LAN origins when bypass is enabled
            }
            if (!allowedOrigins.has(origin)) {
              log('warn', 'client-ws', 'Rejected WebSocket — origin mismatch', { origin, expected: [...allowedOrigins] });
              socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
              socket.destroy();
              return;
            }
          }
          // Accept cookie-session auth (browser) OR Bearer JWT auth (Android app)
          const params    = new URL(req.url, 'http://localhost').searchParams;
          const bearerTok = params.get('token');
          let appUser = null;
          if (bearerTok && JWT_SECRET) {
            try {
              const payload = jwt.verify(bearerTok, JWT_SECRET);
              if (!ALLOWED_EMAIL || payload.email === ALLOWED_EMAIL) appUser = payload;
            } catch { /* invalid token — fall through to cookie check */ }
          }
          // If a bearer token was presented (app connection), require valid JWT — no LAN bypass.
          // Browser connections (no bearer token) still get LAN bypass.
          if (!appUser && !req.isAuthenticated() && (bearerTok || !(ALLOW_LAN_BYPASS && isLAN(req)))) { // SEC-03
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws._type  = 'client';
            ws._appUser = appUser; // non-null for JWT-authenticated app connections
            wss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      });
    });
  });
});

wss.on('connection', (ws, req) => {
  if (ws._type === 'proxy')  handleProxyConnection(ws, req);
  if (ws._type === 'client') handleClientConnection(ws, req);
});

// ── Proxy connection handler (A2-01, A2-02, A2-03) ───────────────────────────

function handleProxyConnection(ws, req) {
  log('info', 'proxy-ws', 'Agent proxy connected');
  proxyConnections.add(ws);
  proxySessionClaims.set(ws, { proxy_id: null, sessions: new Set() });
  startHeartbeat(ws, 'proxy');
  const proxySessions = new Set();
  let thisProxyId = null; // set when connection_hello arrives with proxy_id (A6-05)
  let thisProxyMachineLabel = null;

  // SEC-02: Defer connection_ack until after secret validation in connection_hello
  // If no secret configured, send ack immediately
  if (ws._authenticated) {
    ws.send(JSON.stringify({
      type:                 'connection_ack',
      protocol_version:     PROTOCOL_VERSION,
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
      heartbeat_timeout_ms:  HEARTBEAT_TIMEOUT_MS,
      ts:                   Date.now(),
    }));
  }

  // SEC-02: Auto-close if no hello received within 10s (unauthenticated proxy stalling)
  const helloTimeout = !ws._authenticated ? setTimeout(() => {
    if (!ws._authenticated) {
      log('warn', 'proxy-ws', 'Proxy did not authenticate within 10s — closing');
      ws.close(4001, 'Authentication timeout');
    }
  }, 10000) : null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const proxyMessageReceivedAtMs = Date.now();
    const t = msg.type;
    if (t !== 'session_alias_reconciled' && t !== 'session_alias_released') {
      msg = canonicalizeSessionMessage(msg);
    }

    // SEC-02: Before authentication, only accept hello messages
    if (!ws._authenticated) {
      if (t !== 'connection_hello' && t !== 'hello') {
        log('warn', 'proxy-ws', 'Message before authentication — dropped', { type: t });
        return;
      }
    }

    // Drop messages with unknown or missing type (A8-01)
    if (typeof t !== 'string' || !KNOWN_PROXY_TYPES.has(t)) {
      log('warn', 'proxy-ws', 'Unknown message type — dropped', { type: t });
      return;
    }
    // Preserve proxy frame order across the micro-batched write boundary:
    // consecutive messages may share one transaction, but any following
    // status/control/snapshot frame observes and follows the committed rows.
    if (t !== 'message' && t !== 'proxy_message' && pendingProxyMessageWrites.length > 0) {
      flushProxyMessageWrites();
    }
    const navigationGate = evaluateNavigationMessage(navigationEpochs, msg);
    if (!navigationGate.accepted) {
      log('debug', 'navigation', `Dropped stale ${t}`, {
        session: navigationSessionId(msg),
        navigation_epoch: navigationGate.decision.epoch,
        latest_navigation_epoch: navigationGate.decision.latest,
      });
      return;
    }
    msg = navigationGate.message;

    // ── Handshake ──────────────────────────────────────────────────────────
    if (t === 'connection_hello' || t === 'hello') {
      // SEC-02: Validate proxy secret from hello message (not URL query)
      if (PROXY_SECRET && msg.secret !== PROXY_SECRET) {
        log('warn', 'proxy-ws', 'Rejected proxy — invalid secret', {
          ip: req.socket?.remoteAddress,
        });
        ws.close(4003, 'Forbidden');
        if (helloTimeout) clearTimeout(helloTimeout);
        return;
      }
      ws._authenticated = true;
      if (helloTimeout) clearTimeout(helloTimeout);
      proxyOutageMonitor.observe(authenticatedProxyConnectionCount());

      thisProxyId = msg.proxy_id || null;
      thisProxyMachineLabel = typeof msg.machine_label === 'string'
        ? msg.machine_label.slice(0, 160) : null;
      proxySessionClaims.get(ws).proxy_id = thisProxyId;
      log('info', 'proxy-ws', 'Proxy hello received', {
        role:     msg.peer_role,
        version:  msg.protocol_version,
        machine:  msg.machine_label,
        proxy_id: thisProxyId,
      });

      // Send connection_ack now that proxy is authenticated
      ws.send(JSON.stringify({
        type:                 'connection_ack',
        protocol_version:     PROTOCOL_VERSION,
        heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
        heartbeat_timeout_ms:  HEARTBEAT_TIMEOUT_MS,
        ts:                   Date.now(),
      }));
      const providerUsageWatcherCount = [...browserClients]
        .filter(client => client._providerUsageWatching === true).length;
      if (providerUsageWatcherCount > 0) ws.send(JSON.stringify({
        type: 'provider_usage_watch',
        protocol_version: PROTOCOL_VERSION,
        active: true,
        watcher_count: providerUsageWatcherCount,
      }));

    // ── Application heartbeat (in addition to native ping/pong) ───────────
    } else if (t === 'heartbeat') {
      ws.send(JSON.stringify(applicationHeartbeatAck(msg, proxyMessageReceivedAtMs)));

    // ── Session registration (old: session_list, new: proxy_session_snapshot)
    } else if (t === 'session_alias_reconciled') {
      const result = sessionAliases.reconcile(msg);
      if (!result.accepted) {
        log('warn', 'session-alias', 'Rejected canonical session alias reconciliation', {
          alias_session_id: result.alias_session_id || msg.alias_session_id || null,
          canonical_session_id: result.canonical_session_id || msg.canonical_session_id || null,
          reason: result.reason,
        });
        return;
      }
      const aliasId = result.alias.alias_session_id;
      const canonicalId = result.alias.canonical_session_id;
      const runtimeCounts = migrateRuntimeSessionAlias(aliasId, canonicalId, msg);
      const currentSurfaceLabel = typeof msg.current_surface_label === 'string'
        ? msg.current_surface_label.trim().slice(0, 80)
        : null;
      broadcastToBrowsers({
        type: 'session_alias_reconciled',
        protocol_version: PROTOCOL_VERSION,
        alias_session_id: aliasId,
        canonical_session_id: canonicalId,
        canonical_conversation_id: result.alias.canonical_conversation_id,
        canonical_native_id: result.alias.canonical_native_id,
        current_surface: result.alias.current_surface,
        current_surface_label: currentSurfaceLabel,
        suppression_reason: result.alias.suppression_reason,
        generation: result.alias.generation_clock,
        server_ts: new Date().toISOString(),
      });
      log('info', 'session-alias', 'Canonical session alias reconciled', {
        alias_session_id: aliasId,
        canonical_session_id: canonicalId,
        canonical_conversation_id: result.alias.canonical_conversation_id,
        reason: result.reason,
        database: result.counts,
        runtime: runtimeCounts,
      });
      queueSessionListBroadcast();

    } else if (t === 'session_alias_released') {
      const result = sessionAliases.release(msg);
      if (!result.accepted) {
        log('warn', 'session-alias', 'Rejected canonical session alias release', {
          alias_session_id: result.alias_session_id || msg.alias_session_id || null,
          canonical_session_id: result.canonical_session_id
            || msg.prior_canonical_session_id
            || msg.canonical_session_id
            || null,
          reason: result.reason,
        });
        return;
      }
      const aliasId = result.alias.alias_session_id;
      const canonicalId = result.alias.canonical_session_id;
      broadcastToBrowsers({
        type: 'session_alias_released',
        protocol_version: PROTOCOL_VERSION,
        alias_session_id: aliasId,
        prior_canonical_session_id: canonicalId,
        canonical_conversation_id: result.alias.canonical_conversation_id,
        canonical_native_id: result.alias.canonical_native_id,
        current_surface: result.alias.current_surface,
        release_reason: result.alias.suppression_reason,
        generation: result.alias.generation_clock,
        server_ts: new Date().toISOString(),
      });
      log('info', 'session-alias', 'Canonical session alias released by verified live owner', {
        alias_session_id: aliasId,
        canonical_session_id: canonicalId,
        reason: result.reason,
        generation: result.alias.generation_clock,
      });
      queueSessionListBroadcast();

    } else if (t === 'provider_usage_snapshot') {
      const assessment = providerUsageBoundaryAssessment(msg.snapshot);
      const snapshot = sanitizeProviderUsageSnapshot(msg.snapshot);
      if (!snapshot) {
        log('warn', 'provider-usage', 'Rejected provider quota snapshot', {
          violation: assessment.violation || '$:invalid',
          bytes: assessment.stats.bytes,
          snapshots: assessment.stats.snapshots,
          windows: assessment.stats.windows,
          cost_rows: assessment.stats.cost_daily_rows,
        });
        return;
      }
      if (assessment.cost_violation) {
        log('warn', 'provider-usage', 'Accepted provider quota with degraded cost detail', {
          violation: assessment.cost_violation,
          bytes: assessment.stats.bytes,
          cost_rows: assessment.stats.cost_daily_rows,
          cost_model_rows: assessment.stats.cost_model_rows,
          cost_project_rows: assessment.stats.cost_project_rows,
        });
      }
      cachedProviderUsage = mergeProviderUsageCache(cachedProviderUsage, snapshot, {
        previousProxyId: cachedProviderUsageProxyId,
        previousMachineLabel: cachedProviderUsageMachineLabel,
        proxyId: thisProxyId,
        machineLabel: thisProxyMachineLabel,
      });
      cachedProviderUsageProxyId = thisProxyId;
      cachedProviderUsageMachineLabel = thisProxyMachineLabel;
      applyProviderUsageAuthority(cachedProviderUsage, ws);
      broadcastToBrowsers({
        type: 'provider_usage_snapshot',
        protocol_version: PROTOCOL_VERSION,
        snapshot: cachedProviderUsage,
      });

    } else if (t === 'provider_usage_refresh_receipt') {
      const active = providerUsageRefreshesByRequest.get(msg.request_id);
      if (!active || active.proxyWs !== ws) return;
      clearTimeout(active.timer);
      providerUsageRefreshesByRequest.delete(active.upstreamRequestId);
      if (activeProviderUsageRefreshes.get(active.refreshKey) === active) {
        activeProviderUsageRefreshes.delete(active.refreshKey);
      }
      const status = msg.status === 'completed' ? 'completed' : 'error';
      for (const client of active.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        client.ws.send(JSON.stringify({
          type: 'provider_usage_refresh_receipt',
          protocol_version: PROTOCOL_VERSION,
          request_id: client.clientRequestId,
          provider_id: active.providerId,
          status,
          coalesced: client.initialStatus === 'coalesced' || msg.coalesced === true,
          generation: Math.max(0, Number(msg.generation) || 0),
          cost_status: typeof msg.cost_status === 'string' ? msg.cost_status.slice(0, 40) : null,
          retry_after_ms: Math.max(0, Number(msg.retry_after_ms) || 0),
          ...(status === 'error' ? { code: String(msg.code || 'refresh_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60) } : {}),
        }));
      }

    } else if (t === 'provider_usage_reset_credit_receipt') {
      const active = activeProviderUsageResetCredit;
      if (!active || msg.request_id !== active.upstreamRequestId || active.proxyWs !== ws) return;
      clearTimeout(active.timer);
      activeProviderUsageResetCredit = null;
      if (active.clientWs.readyState !== WebSocket.OPEN) return;
      const status = msg.status === 'completed' ? 'completed' : 'error';
      active.clientWs.send(JSON.stringify({
        type: 'provider_usage_reset_credit_receipt',
        protocol_version: PROTOCOL_VERSION,
        request_id: active.clientRequestId,
        status,
        ...(status === 'completed' ? {
          outcome: ['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'].includes(msg.outcome)
            ? msg.outcome : 'unknown',
          reset_credits_available: Math.max(0, Number(msg.reset_credits_available) || 0),
        } : {
          code: String(msg.code || 'reset_credit_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        }),
      }));

    } else if (t === 'provider_usage_cost_detail' || t === 'provider_usage_cost_detail_error') {
      const pending = pendingProviderUsageCostDetailRequests.get(msg.request_id);
      if (!pending || pending.proxyWs !== ws) return;
      pendingProviderUsageCostDetailRequests.delete(msg.request_id);
      clearTimeout(pending.timer);
      if (pending.ws.readyState !== WebSocket.OPEN) return;
      if (t === 'provider_usage_cost_detail_error') {
        pending.ws.send(JSON.stringify({
          type: 'provider_usage_cost_detail_error',
          request_id: pending.clientRequestId,
          code: String(msg.code || 'cost_detail_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        }));
        return;
      }
      const violation = providerUsageCostDetailViolation(msg.detail);
      const detail = sanitizeProviderUsageCostDetail(msg.detail);
      if (!detail) {
        log('warn', 'provider-usage', 'Rejected provider cost detail page', { violation: violation || '$:invalid' });
        pending.ws.send(JSON.stringify({
          type: 'provider_usage_cost_detail_error',
          request_id: pending.clientRequestId,
          code: 'invalid_cost_detail',
        }));
        return;
      }
      const queryMatches = detail.query.days === pending.query.days
        && (detail.query.provider_id || null) === pending.query.providerId
        && (detail.query.project || null) === pending.query.project
        && detail.pagination.cursor === pending.query.cursor
        && detail.pagination.page_size === pending.query.pageSize;
      if (!queryMatches) {
        log('warn', 'provider-usage', 'Rejected provider cost detail query mismatch');
        pending.ws.send(JSON.stringify({
          type: 'provider_usage_cost_detail_error',
          request_id: pending.clientRequestId,
          code: 'cost_detail_query_mismatch',
        }));
        return;
      }
      pending.ws.send(JSON.stringify({
        type: 'provider_usage_cost_detail',
        protocol_version: PROTOCOL_VERSION,
        request_id: pending.clientRequestId,
        detail,
      }));

    } else if (t === 'host_resource_live' || t === 'host_resource_detail') {
      const subscriptionId = typeof msg.subscription_id === 'string' ? msg.subscription_id : '';
      const subscription = hostResourceSubscriptions.get(subscriptionId);
      if (!subscription || subscription.proxyWs !== ws || subscription.ws.readyState !== WebSocket.OPEN) return;
      if (t === 'host_resource_live') {
        const point = sanitizeHostResourceSystemPoint(msg.point);
        if (!point || point.sample_sequence <= Number(subscription.lastLiveSequence || 0)) return;
        subscription.lastLiveSequence = point.sample_sequence;
        subscription.ws.send(JSON.stringify({
          type: 'host_resource_live',
          protocol_version: PROTOCOL_VERSION,
          subscription_id: subscriptionId,
          point,
        }));
      } else {
        const snapshot = sanitizeHostResourceSnapshot(msg.snapshot);
        if (!snapshot || snapshot.sample_sequence <= Number(subscription.lastDetailSequence || 0)) return;
        if (snapshot.privacy.aggregate_only !== subscription.aggregateOnly) return;
        subscription.lastDetailSequence = snapshot.sample_sequence;
        subscription.ws.send(JSON.stringify({
          type: 'host_resource_detail',
          protocol_version: PROTOCOL_VERSION,
          subscription_id: subscriptionId,
          snapshot,
        }));
      }

    } else if (t === 'host_resource_subscription_ack') {
      const pending = pendingHostResourceSubscriptionRequests.get(msg.request_id);
      if (!pending || pending.proxyWs !== ws || msg.subscriber_id !== pending.subscriptionId) return;
      pendingHostResourceSubscriptionRequests.delete(msg.request_id);
      clearTimeout(pending.timer);
      hostResourceSubscriptions.set(pending.subscriptionId, {
        ws: pending.ws,
        proxyWs: ws,
        aggregateOnly: msg.aggregate_only === true,
        lastLiveSequence: 0,
        lastDetailSequence: 0,
      });
      pending.ws._hostResourceSubscriptionId = pending.subscriptionId;
      if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
        type: 'host_resource_subscription_ack',
        protocol_version: PROTOCOL_VERSION,
        request_id: pending.clientRequestId,
        subscription_id: pending.subscriptionId,
        aggregate_only: msg.aggregate_only === true,
        resumed: msg.resumed === true,
        system_points: Math.max(0, Number(msg.system_points) || 0),
        detail_points: Math.max(0, Number(msg.detail_points) || 0),
      }));

    } else if (t === 'host_resource_history_chunk') {
      const pending = pendingHostResourceHistoryRequests.get(msg.request_id);
      if (!pending || pending.proxyWs !== ws || msg.subscription_id !== pending.subscriptionId) return;
      pendingHostResourceHistoryRequests.delete(msg.request_id);
      clearTimeout(pending.timer);
      const chunk = sanitizeHostResourceHistoryChunk(msg.chunk);
      if (!chunk || chunk.stream !== pending.stream) {
        if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
          type: 'host_resource_error', request_id: pending.clientRequestId,
          code: 'invalid_history_chunk', message: 'The Windows proxy returned an invalid history chunk.',
        }));
        return;
      }
      if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
        type: 'host_resource_history_chunk',
        protocol_version: PROTOCOL_VERSION,
        request_id: pending.clientRequestId,
        subscription_id: pending.subscriptionId,
        chunk,
      }));

    } else if (t === 'host_resource_subscription_error') {
      const pending = pendingHostResourceSubscriptionRequests.get(msg.request_id)
        || pendingHostResourceHistoryRequests.get(msg.request_id);
      if (!pending || pending.proxyWs !== ws) return;
      pendingHostResourceSubscriptionRequests.delete(msg.request_id);
      pendingHostResourceHistoryRequests.delete(msg.request_id);
      clearTimeout(pending.timer);
      if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
        type: 'host_resource_error',
        request_id: pending.clientRequestId,
        code: String(msg.code || 'subscription_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        message: 'Host resource subscription failed.',
      }));

    } else if (t === 'host_resource_unsubscribed') {
      // The relay removes requester routing before forwarding unsubscribe, so
      // this acknowledgement intentionally carries no retained state.
      return;

    } else if (t === 'host_resource_snapshot') {
      const pending = pendingHostResourceRequests.get(msg.request_id);
      if (!pending) return;
      if (pending.proxyWs !== ws) {
        log('warn', 'host-resources', 'Ignored host resource snapshot from a non-requested proxy');
        return;
      }
      pendingHostResourceRequests.delete(msg.request_id);
      clearTimeout(pending.timer);
      const snapshot = sanitizeHostResourceSnapshot(msg.snapshot);
      if (!snapshot) {
        log('warn', 'host-resources', 'Rejected malformed or sensitive host resource snapshot');
        if (pending.ws.readyState === WebSocket.OPEN) {
          pending.ws.send(JSON.stringify({
            type: 'host_resource_error',
            request_id: pending.clientRequestId,
            code: 'invalid_snapshot',
            message: 'The Windows proxy returned an invalid resource snapshot.',
          }));
        }
        return;
      }
      if (pending.ws.readyState === WebSocket.OPEN) {
        pending.ws.send(JSON.stringify({
          type: 'host_resource_snapshot',
          protocol_version: PROTOCOL_VERSION,
          request_id: pending.clientRequestId,
          snapshot,
        }));
      }

    } else if (t === 'session_list' || t === 'proxy_session_snapshot') {
      // A6-05: track which proxy_id is sending this snapshot
      const snapshotProxyId = msg.proxy_id || thisProxyId || null;
      const rawSessions = Array.isArray(msg.sessions) ? msg.sessions : [];
      const directIds = new Set(rawSessions.map(session => (
        typeof session === 'string' ? session : session?.session_id
      )).filter(id => id && sessionAliases.resolve(id) === id));
      const sessionsByCanonicalId = new Map();
      for (const session of rawSessions) {
        const rawId = typeof session === 'string' ? session : session?.session_id;
        if (!rawId) continue;
        const canonicalId = sessionAliases.resolve(rawId);
        if (rawId !== canonicalId && directIds.has(canonicalId)) continue;
        const normalized = typeof session === 'string'
          ? canonicalId
          : { ...session, session_id: canonicalId };
        if (!sessionsByCanonicalId.has(canonicalId) || rawId === canonicalId) {
          sessionsByCanonicalId.set(canonicalId, normalized);
        }
      }
      const sessions = [...sessionsByCanonicalId.values()];
      const duplicateSessions = [];
      const sessionIdsBefore = new Set(proxySockets.keys());
      const sessionStateBefore = new Map(sessionIdsBefore.size > 0
        ? sessions.map(session => {
          const id = typeof session === 'string' ? session : session?.session_id;
          return [id, id && sessionIdsBefore.has(id) ? getSessionListEntry(id) : null];
        }).filter(([id]) => !!id)
        : []);
      const workspacesBefore = cachedWorkspaces;

      // Evict sessions previously owned by THIS proxy that are absent from the new snapshot.
      // This handles Antigravity IDE restarts: the proxy WS stays connected but CDP targets
      // change, so old session IDs pile up on top of new ones without this cleanup.
      const incomingIds = new Set(sessions.map(s => (typeof s === 'string' ? s : s?.session_id)).filter(Boolean));
      proxySessionClaims.set(ws, { proxy_id: snapshotProxyId, sessions: incomingIds });
      const evictedResumeSessions = [];
      for (const [sid, sock] of proxySockets) {
        if (sock === ws && !incomingIds.has(sid)) {
          proxySockets.delete(sid);
          sessionProxyId.delete(sid);
          sessionMeta.delete(sid);
          sessionHealth.delete(sid);
          sessionLastSeen.delete(sid);
          sessionSeq.delete(sid);
          sessionActivity.delete(sid);
          clearQueuedSessionStatus(sid);
          cachedChatLists.delete(sid);
          navigationEpochs.delete(sid);
          clearSessionAuxiliaryState(sid);
          log('info', 'proxy-ws', `Evicted stale session ${sid} (not in new snapshot)`);
          // Check if this was a recently resumed session whose messages need migration
          if (recentResumeSessions.has(sid)) {
            evictedResumeSessions.push(sid);
          }
        }
      }

      // Migrate messages from evicted resume sessions to their replacement
      // in the new snapshot. The replacement is a new session of the same agent_type
      // that wasn't previously registered (i.e., the proxy re-discovered the same
      // target under a different session_id).
      if (evictedResumeSessions.length > 0) {
        const existingRegistered = new Set(proxySockets.keys());
        for (const evictedSid of evictedResumeSessions) {
          const resumeInfo = recentResumeSessions.get(evictedSid);
          if (!resumeInfo) continue;
          // Find a new session in the incoming snapshot that:
          // 1. Wasn't previously registered (brand new)
          // 2. Has the same agent_type
          const replacement = sessions.find(s => {
            const id = typeof s === 'string' ? s : s?.session_id;
            if (!id || id === evictedSid) return false;
            if (existingRegistered.has(id)) return false; // already known
            const sType = (typeof s === 'object' ? s.agent_type : null) || resumeInfo.agent_type;
            return sType === resumeInfo.agent_type;
          });
          const replacementId = replacement ? (typeof replacement === 'string' ? replacement : replacement?.session_id) : null;
          if (replacementId) {
            // Migrate messages from evicted session to replacement
            try {
              const messages = getHistoryRows(evictedSid);
              if (messages.length > 0) {
                const migrated = insertConversationRowsBatch(replacementId, messages, true);
                log('info', 'launch', 'Migrated resume messages to replacement session', {
                  evicted: evictedSid, replacement: replacementId, messages_migrated: migrated,
                });
              }
            } catch (e) {
              log('error', 'launch', 'Failed to migrate resume messages', {
                evicted: evictedSid, replacement: replacementId, err: e.message,
              });
            }
            recentResumeSessions.delete(evictedSid);
          }
        }
      }

      sessions.forEach(s => {
        const id = typeof s === 'string' ? s : s.session_id;
        if (!id) return;
        // Check if this session is already owned by a DIFFERENT proxy connection
        const existingWs = proxySockets.get(id);
        const existingProxyId = sessionProxyId.get(id);
        if (existingWs && existingWs !== ws && existingWs.readyState === WebSocket.OPEN) {
          duplicateSessions.push(id);
          log('warn', 'proxy-ws', `Session ${id} re-registered by proxy_id=${snapshotProxyId} (was proxy_id=${existingProxyId}) — last-writer-wins`);
        }
        // Last-writer-wins: adopt the new registration
        if (existingWs !== ws) {
          sessionControlGeneration.set(id, Math.max(0, Number(sessionControlGeneration.get(id)) || 0) + 1);
          sessionTurnGeneration.set(id, 0);
        }
        proxySockets.set(id, ws);
        sessionProxyId.set(id, snapshotProxyId);
        proxySessions.add(id);
        const snapshotActivityKind = String((s && typeof s === 'object' ? s.activity?.kind : '') || '').toLowerCase();
        if (['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(snapshotActivityKind)
            && !sessionTurnGeneration.get(id)) {
          sessionTurnGeneration.set(id, 1);
        }
        if (s && typeof s === 'object') {
          const previousMeta = sessionMeta.get(id) || {};
          const resetTitle = s.is_new_chat_draft === true;
          const mergedFleetSummary = resetTitle
            ? null
            : mergeProducerFleetSummary(previousMeta.fleet_summary, s.fleet_summary).summary;
          const fleetProjection = projectFleetSummary(mergedFleetSummary);
          const incomingTitle = fleetProjection.chat_title || s.chat_title;
          const incomingTitleSource = fleetProjection.chat_title_source || s.chat_title_source;
          const mergedTitle = mergeDurableChatTitleDetails(previousMeta.chat_title, incomingTitle, {
            previousSource: previousMeta.chat_title_source,
            incomingSource: incomingTitleSource,
            reset: resetTitle,
          });
          const nextMeta = {
            ...previousMeta,
            ...s,
            ...sessionNoiseMetadata(s),
            session_id: id,
            ...fleetProjection,
            fleet_summary: mergedFleetSummary,
            chat_title: mergedTitle.title,
            chat_title_source: mergedTitle.source,
          };
          if (resetTitle) {
            nextMeta.last_user_request = null;
            nextMeta.last_snippet = null;
            nextMeta.last_message_at = null;
            nextMeta.fleet_work_context = null;
            clearLatestVisibleMessage(id);
          }
          sessionMeta.set(id, nextMeta);
          const snapshotActivity = s.activity || (s.goal ? {
            kind: s.status || 'idle',
            goal: s.goal,
            updated_at: s.last_seen_at || s.updated_at,
          } : null);
          if (snapshotActivity) {
            const snapshotHarness = sessionMeta.get(id)?.agent_type || 'unknown';
            const hydrated = goalNotifications.observeActivity(id, snapshotActivity, {
              sessionName: notificationSessionName(id),
              hydrateOnly: true,
              reconcileLive: !sessionIdIsTestSession(id),
              harness: snapshotHarness,
            });
            hydrated.events.forEach(dispatchSemanticNotification);
            const snapshotCapabilities = agentConfigs.get(id)?.capabilities
              || sessionMeta.get(id)?.capabilities
              || null;
            if (goalLifecycleSupported(snapshotHarness, snapshotCapabilities)) {
              sessionMeta.set(id, {
                ...sessionMeta.get(id),
                activity: {
                  ...snapshotActivity,
                  goal: hydrated.goal,
                  ...(hydrated.goal_tombstone
                    ? { goal_tombstone: hydrated.goal_tombstone }
                    : {}),
                },
              });
            }
          }
          if (s.rate_limit_active === true) {
            const snapshotReset = s.activity?.usage?.resets_at
              || (/^\d{4}-\d{2}-\d{2}T/.test(String(s.rate_limited_until || ''))
                ? s.rate_limited_until : null);
            scheduleUsageResume(
              id,
              snapshotReset,
              s.activity?.goal || s.goal,
            );
          }
        }
        touchSession(id);
      });
      let persistedSessionMeta = 0;
      try { persistedSessionMeta = persistSessionMetaBatch(sessions); } catch (error) {
        log('warn', 'proxy-ws', 'Session metadata batch persistence failed', { err: error.message });
      }
      if (Array.isArray(msg.workspaces)) cachedWorkspaces = msg.workspaces;
      log('info', 'proxy-ws', 'Sessions registered', {
        proxy_id: snapshotProxyId,
        session_count: proxySessions.size,
        metadata_rows_changed: persistedSessionMeta,
      });
      // Notify the proxy about sessions it re-registered that were already owned by another proxy
      if (duplicateSessions.length > 0) {
        ws.send(JSON.stringify({ type: 'session_snapshot_ack', duplicate_sessions: duplicateSessions }));
      }
      refreshDuplicateProxyAlarms();
      const sessionIdsAfter = new Set(proxySockets.keys());
      const membershipChanged = sessionIdsBefore.size !== sessionIdsAfter.size
        || [...sessionIdsBefore].some(id => !sessionIdsAfter.has(id));
      const workspacesChanged = !isDeepStrictEqual(workspacesBefore, cachedWorkspaces);
      if (membershipChanged || workspacesChanged) {
        queueSessionListBroadcast();
      } else {
        for (const session of sessions) {
          const id = typeof session === 'string' ? session : session?.session_id;
          if (!id) continue;
          queueSessionPatchBroadcast(id, sessionStateBefore.get(id), getSessionListEntry(id));
        }
      }

    // ── Session meta backfill (populate workspace info for historical sessions)
    } else if (t === 'session_meta_backfill') {
      const sessions = msg.sessions;
      if (Array.isArray(sessions)) {
        let count = 0;
        try { count = persistSessionMetaBatch(sessions); } catch (error) {
          log('warn', 'proxy-ws', 'Session metadata backfill failed', { err: error.message });
        }
        log('info', 'proxy-ws', `Backfilled session_meta for ${count} changed sessions`);
      }

    // ── Thinking / activity status ─────────────────────────────────────────
    } else if (t === 'latency_trace_terminal') {
      const terminal = normalizeLatencyTraceTerminal(msg.latency_trace_terminal);
      const result = terminalizeProxyLatencyTrace(msg.latency_trace_terminal);
      if (!result.ok) {
        log('warn', 'latency-trace', 'Rejected proxy trace terminal', {
          trace_id: msg.latency_trace_terminal?.trace_id || null,
          code: result.code,
        });
        return;
      }
      if (terminal.ok && result.appended) {
        broadcastToBrowsers({
          type: 'latency_trace_terminal',
          protocol_version: PROTOCOL_VERSION,
          latency_trace_terminal: terminal.terminal,
        });
      }
      log('info', 'latency-trace', 'Persisted terminal send trace', {
        trace_id: result.trace_id,
        appended: result.appended,
        duplicate: result.duplicate,
        reason: terminal.ok ? terminal.terminal.reason : null,
      });

    } else if (t === 'message_delta') {
      // Ephemeral fast path: validate and forward without waiting on SQLite.
      // Settled proxy_message/history events remain the reconnect authority.
      const accepted = messageDeltaGate.accept(msg, proxyMessageReceivedAtMs);
      if (!accepted.ok) {
        log('warn', 'message-delta', 'Dropped invalid in-flight delta', {
          session: msg.session_id || msg.session || null,
          message_id: msg.message_id || null,
          seq: msg.seq,
          code: accepted.code,
          expected_seq: accepted.expected_seq,
        });
        return;
      }
      touchSession(accepted.message.session_id);
      const relayForwardedAtMs = Date.now();
      accepted.message.relay_forwarded_at_ms = relayForwardedAtMs;
      if (accepted.message.stream_trace) {
        accepted.message.stream_trace.relay_forwarded_at_ms = relayForwardedAtMs;
      }
      if (msg.latency_trace) {
        const latencyTrace = latencyTraceForRelayBroadcast(
          msg.latency_trace,
          relayForwardedAtMs,
          {
            source: 'relay_message_delta',
            relay_received_at_ms: proxyMessageReceivedAtMs,
            relay_forwarded_at_ms: relayForwardedAtMs,
          },
        );
        if (latencyTrace) accepted.message.latency_trace = latencyTrace;
      }
      broadcastToBrowsers(accepted.message);

    } else if (t === 'status' || t === 'proxy_status') {
      const id = msg.session || msg.session_id;
      if (id) touchSession(id);
      let broadcastActivity = msg.activity;
      if (id && msg.activity) {
        const previousActivity = sessionMeta.get(id)?.activity || null;
        broadcastActivity = normalizeActivityTimeline(
          msg.activity,
          previousActivity,
          new Date().toISOString(),
        );
        const meta = sessionMeta.get(id) || {};
        const capabilities = agentConfigs.get(id)?.capabilities || meta.capabilities || null;
        const agentType = meta.agent_type || msg.agent_type || 'unknown';
        const goalCapable = goalLifecycleSupported(agentType, capabilities);
        if (broadcastActivity?.goal && !goalCapable) {
          const signature = `${agentType}:${broadcastActivity.goal.updated_at || broadcastActivity.goal.status || 'goal'}`;
          if (ignoredFleetGoalDiagnostics.get(id) !== signature) {
            ignoredFleetGoalDiagnostics.delete(id);
            ignoredFleetGoalDiagnostics.set(id, signature);
            while (ignoredFleetGoalDiagnostics.size > 256) {
              ignoredFleetGoalDiagnostics.delete(ignoredFleetGoalDiagnostics.keys().next().value);
            }
            log('warn', 'fleet', 'Ignored goal for harness without goal lifecycle capability', {
              session: id,
              harness: agentType,
            });
          }
          const { goal: ignoredGoal, ...withoutGoal } = broadcastActivity;
          broadcastActivity = withoutGoal;
        }
        const semantic = goalNotifications.observeActivity(id, broadcastActivity, {
          sessionName: notificationSessionName(id),
          hydrateOnly: sessionIdIsTestSession(id),
          harness: sessionMeta.get(id)?.agent_type || msg.agent_type || 'unknown',
        });
        if (goalCapable) {
          broadcastActivity = {
            ...broadcastActivity,
            goal: semantic.goal,
            ...(semantic.goal_tombstone
              ? { goal_tombstone: semantic.goal_tombstone }
              : {}),
          };
        } else if (Object.prototype.hasOwnProperty.call(broadcastActivity, 'goal')) {
          const { goal: ignoredGoal, ...withoutGoal } = broadcastActivity;
          broadcastActivity = withoutGoal;
        }
        broadcastActivity = {
          ...broadcastActivity,
          work_context: projectFleetWorkContext({
            agentType,
            capabilities,
            activity: broadcastActivity,
            latestUserRequest: meta.last_user_request || null,
            preferProvided: false,
          }),
        };
        semantic.events.forEach(dispatchSemanticNotification);
        if (sessionMeta.has(id)) {
          const nextMeta = {
            ...sessionMeta.get(id),
            activity: broadcastActivity,
            status: msg.status || sessionMeta.get(id).status,
            last_seen_at: new Date().toISOString(),
          };
          sessionMeta.set(id, nextMeta);
          advanceRelayFleetSummary(id, { ...msg, activity: broadcastActivity }, nextMeta);
        }
        // Track activity kind for idle-triggered scheduled sends. User-facing
        // notifications are emitted only by the semantic lifecycle coordinator.
        const prevKind = sessionActivity.get(id);
        const currKind = (typeof broadcastActivity === 'object' ? broadcastActivity?.kind : broadcastActivity) || null;
        const activeKinds = new Set(['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working']);
        if (activeKinds.has(String(currKind || '').toLowerCase())
            && !activeKinds.has(String(prevKind || '').toLowerCase())) {
          sessionTurnGeneration.set(id, Math.max(0, Number(sessionTurnGeneration.get(id)) || 0) + 1);
        }
        sessionActivity.set(id, currKind);
        if (currKind === 'idle' && prevKind !== 'idle') dispatchIdleScheduledSends(id);
      }
      // Normalise to old shape so existing frontend still works
      const statusMsg = {
        type: 'status',
        session: id || msg.session,
        thinking: msg.thinking,
        label: msg.label,
        activity: broadcastActivity,
        activity_trace: compactActivityTrace({
          ...msg.activity_trace,
          relay_received_at_ms: proxyMessageReceivedAtMs,
        }),
      };
      if (msg.thinking_content) statusMsg.thinking_content = msg.thinking_content;
      if (msg.stream_trace && typeof msg.stream_trace === 'object') {
        statusMsg.stream_trace = {
          ...msg.stream_trace,
          relay_received_at_ms: proxyMessageReceivedAtMs,
        };
      }
      if (shouldBroadcastStatus(id, statusMsg)) {
        queueStatusBroadcast(statusMsg);
      }
      const agentStarted = sendLifecycle.consumeActivity({ ...msg, session_id: id, activity: broadcastActivity });
      if (agentStarted) {
        const persisted = persistSendLifecycle(agentStarted);
        if (persisted.applied && persisted.advanced) {
          broadcastToBrowsers(agentStarted);
          log('info', 'send', 'agent_started', { session: id, cid: agentStarted.client_message_id });
        }
      }

    // ── Incoming agent message ─────────────────────────────────────────────
    } else if (t === 'message' || t === 'proxy_message') {
      const id      = msg.session || msg.session_id;
      const role    = msg.role    || msg.message?.role;
      const content = msg.content || msg.message?.content;
      const contentBlocks = Array.isArray(msg.content_blocks)
        ? msg.content_blocks
        : (Array.isArray(msg.message?.content_blocks) ? msg.message.content_blocks : null);
      const sourceMessageId = normalizeSourceMessageId(msg.source_message_id || msg.message?.source_message_id);
      const sourceCursor = msg.source_cursor && typeof msg.source_cursor === 'object'
        ? msg.source_cursor
        : (msg.message?.source_cursor && typeof msg.message.source_cursor === 'object'
          ? msg.message.source_cursor
          : null);
      const source = normalizeSourceName(msg.source || msg.message?.source);
      if (!id || !role || !content) return;

      if (role === 'user') {
        const requestText = boundedFleetDisplayText(content);
        if (requestText) {
          const meta = sessionMeta.get(id) || {};
          const capabilities = agentConfigs.get(id)?.capabilities || meta.capabilities || null;
          const latestUserRequest = {
            text: requestText,
            updated_at: new Date(proxyMessageTimestampSeconds(msg) * 1000).toISOString(),
          };
          const activity = meta.activity && typeof meta.activity === 'object'
            ? {
              ...meta.activity,
              work_context: projectFleetWorkContext({
                agentType: meta.agent_type || msg.agent_type || 'unknown',
                capabilities,
                activity: meta.activity,
                latestUserRequest,
                preferProvided: false,
              }),
            }
            : meta.activity;
          sessionMeta.set(id, { ...meta, last_user_request: latestUserRequest, activity });
        }
      }

      // Dedup: suppress echoed user messages that came from the browser
      if (role === 'user') {
        const key = `${id}:${content}`;
        if (recentBrowserSends.has(key)) { recentBrowserSends.delete(key); return; }
        if (isRecentBrowserUserEcho(id, content)) {
          log('info', 'dedup', 'Skipping browser-originated user echo', { session: id });
          return;
        }
        for (const [fk] of recentFileSends.entries()) {
          const [fs, fn] = fk.split(':');
          if (fs === id && content.includes(fn)) { recentFileSends.delete(fk); return; }
        }
      }

      // Dedup: suppress duplicate proxy_messages that match the current DB tail.
      // This prevents double-inserts after a relay reconnect where the proxy
      // re-sends its pendingLast message that's already persisted in SQLite.
      if (isDuplicateProxyMessage(id, role, content, sourceMessageId)) {
        if (msg.latency_trace) {
          const relayForwardedAtMs = Date.now();
          const latencyTrace = latencyTraceForRelayBroadcast(
            msg.latency_trace,
            relayForwardedAtMs,
            {
              source: 'relay_duplicate_canonical_replay',
              relay_received_at_ms: proxyMessageReceivedAtMs,
              relay_forwarded_at_ms: relayForwardedAtMs,
            },
          );
          if (latencyTrace) {
            // An authoritative startup snapshot can persist the first assistant
            // row before its semantic replay arrives. Forward that replay only
            // for its pending trace so the browser can acknowledge real paint;
            // keep the duplicate out of SQLite.
            broadcastToBrowsers({
              ...msg,
              type: 'proxy_message',
              session: id,
              session_id: id,
              role,
              content,
              latency_trace: latencyTrace,
            });
          }
        }
        log('info', 'dedup', `Skipping duplicate proxy_message (${sourceMessageId ? 'source id' : 'tail match'})`, {
          session: id,
          role,
        });
        return;
      }

      if (sourceMessageId && source?.endsWith('_jsonl')) {
        const cursorDecision = evaluateProxyTranscriptCursor(id, source, sourceCursor);
        if (!cursorDecision.accepted) {
          log(cursorDecision.code === 'stale_cursor' ? 'info' : 'warn', 'transcript-cursor',
            `Dropped ${cursorDecision.code} file-backed append`, {
              session: id,
              source,
              source_message_id: sourceMessageId,
              expected_message_index: cursorDecision.expected_message_index,
              received_message_index: cursorDecision.incoming?.message_index ?? null,
          });
          if (cursorDecision.code !== 'stale_cursor') {
            const resyncId = requestProxyTranscriptResync(ws, id, source, cursorDecision);
            broadcastTranscriptGap(id, {
              reason: cursorDecision.code,
              resync_id: resyncId,
              source,
              source_cursor: cursorDecision.incoming || sourceCursor || null,
              expected_message_index: cursorDecision.expected_message_index,
              received_message_index: cursorDecision.incoming?.message_index,
            });
            broadcastToBrowsers({ ...msg, type: 'proxy_message', session: id, session_id: id, role, content });
          }
          return;
        }
      }

      advanceRelayFleetSummary(id, {
        ...msg,
        type: 'proxy_message',
        role,
        content,
        content_blocks: contentBlocks,
      });

      const seq = nextSeq(id);
      queueProxyMessageWrite({
        id,
        role,
        content,
        contentBlocks,
        seq,
        messageTs: proxyMessageTimestampSeconds(msg),
        sourceMessageId,
        sourceCursor,
        source,
        latencyTrace: msg.latency_trace || null,
      });

    // ── Session launch ack (A2-08) ────────────────────────────────────────
    } else if (t === 'session_launch_ack') {
      const requestId = msg.request_id;
      const pending   = pendingLaunches.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingLaunches.delete(requestId);
        const ackMsg = {
          type:             'session_launch_ack',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       msg.session_id,
          agent_type:       msg.agent_type || pending.agent_type,
          server_ts:        new Date().toISOString(),
          ...(msg.fire_and_forget ? { fire_and_forget: true, message: msg.message } : {}),
          ...(msg.owned_disposable?.armed === true ? {
            owned_disposable: {
              armed: true,
              scope: msg.owned_disposable.scope,
            },
          } : {}),
        };
        if (pending.browser_ws?.readyState === WebSocket.OPEN) {
          pending.browser_ws.send(JSON.stringify(ackMsg));
        } else {
          broadcastToBrowsers(ackMsg);
        }

        // ── Resume: copy old messages into the new session ──────────────
        // Skip SQLite replay for Cursor CLI when we resumed the same native
        // chat id — the proxy already hydrates from local stream-json JSONL.
        if (pending.resume_source && pending.resume_messages && msg.session_id) {
          const newSessionId = msg.session_id;
          const skipSqliteReplay = (pending.agent_type === 'cursor_cli' || pending.agent_type === 'codex_cli' || pending.agent_type === 'claude_cli')
            && !!(pending.cli_session_id || msg.cli_session_id);
          if (skipSqliteReplay) {
            log('info', 'launch', 'Resumed CLI session — skipping SQLite history copy (native transcript is source of truth)', {
              request_id: requestId, new_session: newSessionId,
              source: pending.resume_source, agent_type: pending.agent_type,
            });
          } else {
          const oldMessages = pending.resume_messages;
          const copied = insertConversationRowsBatch(newSessionId, oldMessages, false);
          log('info', 'launch', 'Resumed session — copied history', {
            request_id: requestId, new_session: newSessionId,
            source: pending.resume_source, messages_copied: copied,
          });
          // Send the copied history to the browser so it appears immediately
          const newHistory = getHistoryRows(newSessionId);
          if (pending.browser_ws?.readyState === WebSocket.OPEN) {
            pending.browser_ws.send(JSON.stringify({ type: 'history', session: newSessionId, messages: newHistory }));
          }

          // Track this resumed session so we can migrate messages if the proxy
          // re-discovers the same target under a different session_id
          recentResumeSessions.set(newSessionId, {
            source_session: pending.resume_source,
            launched_at: Date.now(),
            agent_type: pending.agent_type,
            messages_copied: copied,
          });
          setTimeout(() => recentResumeSessions.delete(newSessionId), RESUME_TRACK_TTL_MS);
          }
        }
      }
      log('info', 'launch', 'Session launch acked', { request_id: requestId, session_id: msg.session_id });

    // ── Session launch failed (A2-08) ─────────────────────────────────────
    } else if (t === 'session_launch_failed') {
      cancelPendingLaunch(
        msg.request_id,
        msg.error_code || 'launch_failed',
        msg.reason    || 'Launch failed'
      );

    // ── Session close failed without removing the retry target ────────────
    } else if (t === 'session_close_failed') {
      broadcastToBrowsers({
        type:             'session_close_failed',
        protocol_version: PROTOCOL_VERSION,
        session_id:       msg.session_id || msg.session,
        request_id:       msg.request_id,
        reason:           msg.reason || 'session_close_failed',
        owned_disposable_cleanup: {
          destroyed: false,
          reason: msg.owned_disposable_cleanup?.reason || msg.reason || 'session_close_failed',
          removed_session_count: 0,
          native_rollout_removed: msg.owned_disposable_cleanup?.native_rollout_removed === true,
        },
        server_ts:        new Date().toISOString(),
      });

    // ── Session closed (A2-08) ────────────────────────────────────────────
    } else if (t === 'session_closed') {
      const id = msg.session_id || msg.session;
      if (id) {
        proxySockets.delete(id);
        proxySessions.delete(id);
        sessionMeta.delete(id);
        sessionHealth.delete(id);
        sessionLastSeen.delete(id);
        sessionSeq.delete(id);
        sessionActivity.delete(id);
        clearQueuedSessionStatus(id);
        cachedChatLists.delete(id);
        clearSessionAuxiliaryState(id);
        removeQuestionPromptsForSession(id);
        for (const key of Array.from(pendingErrorPrompts.keys())) {
          if (key.startsWith(`${id}:`)) pendingErrorPrompts.delete(key);
        }
        log('info', 'proxy-ws', 'Session closed by proxy', { session: id });
      }
      broadcastToBrowsers({
        type:             'session_closed',
        protocol_version: PROTOCOL_VERSION,
        session_id:       id,
        request_id:       msg.request_id,
        reason:           msg.reason || 'user_requested',
        server_ts:        new Date().toISOString(),
        ...(msg.owned_disposable_cleanup ? {
          owned_disposable_cleanup: {
            destroyed: msg.owned_disposable_cleanup.destroyed === true,
            reason: msg.owned_disposable_cleanup.reason || null,
            removed_session_count: Number(msg.owned_disposable_cleanup.removed_session_count || 0),
            native_rollout_removed: msg.owned_disposable_cleanup.native_rollout_removed === true,
          },
        } : {}),
      });
      queueSessionListBroadcast();

    // ── Permission prompt (A2-07) ─────────────────────────────────────────
    } else if (t === 'question_prompt' || (t === 'permission_prompt' && msg.kind === 'question')) {
      try {
        const opened = questionPromptRegistry.open(msg);
        opened.replaced.forEach(publishQuestionPromptState);
        if (['open', 'submitting'].includes(opened.prompt.lifecycle)) {
          publishQuestionPrompt(opened.prompt);
          scheduleQuestionPromptDeadline(opened.prompt);
        } else {
          publishQuestionPromptState(opened.prompt);
        }
        if (opened.status === 'opened' && shouldSendPush()) {
          const name = notificationSessionName(opened.prompt.session_id);
          sendPushNotification(
            `${name} needs an answer`,
            String(opened.prompt.title || 'Review the native question.').slice(0, 180),
            {
              type: 'question_required', activity_type: 'question',
              session_id: opened.prompt.session_id, session_name: name,
            },
          ).catch(() => {});
        }
        log('info', 'question', 'Question prompt received', {
          session: opened.prompt.session_id,
          prompt_id: opened.prompt.prompt_id,
          source: opened.prompt.source?.surface,
          status: opened.status,
        });
      } catch (error) {
        const code = error instanceof QuestionPromptRegistryError ? error.code : 'invalid_question_prompt';
        log('warn', 'question', 'Question prompt rejected', { code });
      }

    } else if (t === 'question_prompt_state') {
      try {
        const terminal = questionPromptRegistry.terminalFromSource(msg);
        if (terminal) publishQuestionPromptState(terminal);
      } catch (error) {
        const code = error instanceof QuestionPromptRegistryError ? error.code : 'invalid_question_prompt_state';
        log('warn', 'question', 'Question prompt terminal state rejected', { code });
      }

    } else if (t === 'permission_prompt') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      if (!sessionId || !promptId) return;
      const key = `${sessionId}:${promptId}`;
      if (pendingPrompts.has(key)) return; // de-duplicate
      const timeoutMs = (typeof msg.timeout_ms === 'number' && msg.timeout_ms > 0)
        ? msg.timeout_ms : 60_000;
      const timer = setTimeout(() => expirePrompt(sessionId, promptId), timeoutMs);
      pendingPrompts.set(key, { prompt: msg, timer });
      broadcastToBrowsers(msg);
      if (shouldSendPush()) {
        const name = notificationSessionName(sessionId);
        sendPushNotification(
          `${name} needs permission`,
          String(msg.title || msg.message || msg.description || 'Review the pending permission request.').slice(0, 180),
          { type: 'permission_required', activity_type: 'permission', session_id: sessionId, session_name: name },
        ).catch(() => {});
      }
      log('info', 'prompt', 'Permission prompt received', { session: sessionId, prompt_id: promptId });

    // ── Permission prompt expired (proxy-originated dismiss) ──────────────
    } else if (t === 'permission_prompt_expired') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      if (!sessionId || !promptId) return;
      const key = `${sessionId}:${promptId}`;
      const entry = pendingPrompts.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        pendingPrompts.delete(key);
      }
      broadcastToBrowsers({
        type:             'permission_prompt_expired',
        protocol_version: PROTOCOL_VERSION,
        session_id:       sessionId,
        prompt_id:        promptId,
        server_ts:        new Date().toISOString(),
      });
      log('info', 'prompt', 'Permission prompt dismissed at source', { session: sessionId, prompt_id: promptId });

    // ── Session error prompt ──────────────────────────────────────────────
    } else if (t === 'session_error_prompt') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      if (!sessionId || !promptId) return;
      const key = `${sessionId}:${promptId}`;
      const isNewPrompt = !pendingErrorPrompts.has(key);
      pendingErrorPrompts.set(key, { prompt: msg });
      broadcastToBrowsers(msg);
      if (isNewPrompt && shouldSendPush()) {
        const name = notificationSessionName(sessionId);
        sendPushNotification(
          `${name} needs attention`,
          String(msg.title || msg.error || msg.message || 'The agent reported an error.').slice(0, 180),
          { type: 'agent_error', activity_type: 'error', session_id: sessionId, session_name: name },
        ).catch(() => {});
      }
      log('info', 'prompt', 'Session error prompt received', { session: sessionId, prompt_id: promptId });

    } else if (t === 'session_error_prompt_cleared') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      if (!sessionId || !promptId) return;
      const key = `${sessionId}:${promptId}`;
      pendingErrorPrompts.delete(key);
      broadcastToBrowsers({
        type:             'session_error_prompt_cleared',
        protocol_version: PROTOCOL_VERSION,
        session_id:       sessionId,
        prompt_id:        promptId,
        server_ts:        new Date().toISOString(),
      });
      log('info', 'prompt', 'Session error prompt cleared at source', { session: sessionId, prompt_id: promptId });

    // ── Agent config (A2-07) ──────────────────────────────────────────────
    } else if (t === 'agent_config') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) { agentConfigs.set(sessionId, msg); touchSession(sessionId); }
      const requestId = msg.request_id || null;
      const targetWs = requestId ? pendingCtrlReqs.get(requestId) : null;
      if (requestId) pendingCtrlReqs.delete(requestId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
        broadcastToBrowsersExcept(compactAgentConfigMessage(msg), targetWs);
      } else {
        broadcastToBrowsers(compactAgentConfigMessage(msg));
      }
      log('info', 'config', 'Agent config updated', { session: sessionId });

    // ── Chat list (Epic 9) ──────────────────────────────────────────────
    } else if (t === 'chat_list') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) {
        touchSession(sessionId);
        cachedChatLists.set(sessionId, { ...msg, session_id: sessionId });
      }
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Chat list received', { session: sessionId, count: (msg.chats || []).length });

    // ── Thread list (Epic 2) ─────────────────────────────────────────────
    } else if (t === 'thread_list') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Thread list received', { session: sessionId, count: (msg.threads || []).length });

    // ── Terminal output (Epic 4) ─────────────────────────────────────────
    } else if (t === 'terminal_output') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Terminal output received', { session: sessionId, count: (msg.entries || []).length });

    // ── File changes / diff (Epic 5) ─────────────────────────────────────
    } else if (t === 'file_changes') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'File changes received', { session: sessionId, count: (msg.entries || []).length });

    // ── Branch list ────────────────────────────────────────────────────
    } else if (t === 'branch_list') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Branch list received', { session: sessionId, count: (msg.branches || []).length });

    // ── Skill list (Codex Desktop) ──────────────────────────────────────
    } else if (t === 'skill_list') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Skill list received', { session: sessionId, installed: (msg.installed || []).length, recommended: (msg.recommended || []).length });

    // ── File browser: directory listing (proxy → browsers) ─────────────
    } else if (t === 'codex_automation_view') {
      const sessionId = msg.session_id || msg.session;
      if (sessionId) touchSession(sessionId);
      broadcastToBrowsers(msg);
      log('info', 'ctrl', 'Codex automation view received', { session: sessionId, visible: !!msg.view });

    } else if (t === 'directory_listing') {
      const requestId = msg.request_id;
      const targetWs  = requestId ? pendingCtrlReqs.get(requestId) : null;
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
      } else {
        broadcastToBrowsers(msg);
      }
      const controlState = requestId ? pendingPayloadCtrlState.get(requestId) : null;
      if (controlState) {
        controlState.payloadSeen = true;
        if (controlState.ackSeen) {
          pendingPayloadCtrlState.delete(requestId);
          pendingCtrlReqs.delete(requestId);
        }
      } else if (requestId) {
        pendingCtrlReqs.delete(requestId);
      }
      log('info', 'ctrl', 'Directory listing received', { session: msg.session_id, path: msg.path, count: (msg.entries || []).length });

    // ── File browser: file content (proxy → browsers) ─────────────────
    } else if (t === 'file_content') {
      const requestId = msg.request_id;
      const targetWs  = requestId ? pendingCtrlReqs.get(requestId) : null;
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
      } else {
        broadcastToBrowsers(msg);
      }
      const controlState = requestId ? pendingPayloadCtrlState.get(requestId) : null;
      if (controlState) {
        controlState.payloadSeen = true;
        if (controlState.ackSeen) {
          pendingPayloadCtrlState.delete(requestId);
          pendingCtrlReqs.delete(requestId);
        }
      } else if (requestId) {
        pendingCtrlReqs.delete(requestId);
      }
      log('info', 'ctrl', 'File content received', { session: msg.session_id, path: msg.path, truncated: msg.truncated });

    // ── Agent control result (A2-07) ──────────────────────────────────────
    } else if (t === 'agent_control_result') {
      const requestId = msg.request_id;
      if (['agent_interrupt', 'agent_goal_control'].includes(msg.command)) {
        if (msg.result === 'ok' && msg.native_acknowledged !== true) {
          msg = {
            ...msg,
            result: 'failed',
            error: {
              code: 'native_receipt_missing',
              message: 'The native adapter did not provide an exact acknowledgement.',
            },
            retryable: true,
            native_attempted: true,
          };
        }
        if (deliverExactControlResult(requestId, msg)) {
          log('info', 'ctrl', `Exactly-once control result: ${msg.result}`, {
            request_id: requestId,
            command: msg.command,
          });
          return;
        }
      }
      const targetWs  = requestId ? pendingCtrlReqs.get(requestId) : null;
      const codexWaiters = requestId && msg.command === 'set_codex_config'
        ? codexControlRequestWaiters.get(requestId)
        : null;
      const controlState = requestId ? pendingPayloadCtrlState.get(requestId) : null;
      if (controlState && msg.result === 'ok') {
        controlState.ackSeen = true;
        if (controlState.payloadSeen) {
          pendingPayloadCtrlState.delete(requestId);
          pendingCtrlReqs.delete(requestId);
        }
      } else if (requestId) {
        pendingPayloadCtrlState.delete(requestId);
        pendingCtrlReqs.delete(requestId);
      }
      const promptMeta = requestId ? pendingPromptResponses.get(requestId) : null;
      const errorPromptMeta = requestId ? pendingErrorPromptResponses.get(requestId) : null;
      if (requestId) pendingPromptResponses.delete(requestId);
      if (requestId) pendingErrorPromptResponses.delete(requestId);
      if (codexWaiters) codexControlRequestWaiters.delete(requestId);
      if (msg.command === 'question_response') {
        if (msg.result === 'ok' && msg.native_acknowledged !== true) {
          msg = {
            ...msg,
            result: 'failed',
            error: {
              code: 'native_receipt_missing',
              message: 'The adapter did not provide an exact native acknowledgement.',
            },
            native_attempted: true,
          };
        }
        const questionState = questionPromptRegistry.resolve(requestId, {
          ok: msg.result === 'ok',
          lifecycle: msg.lifecycle,
          errorCode: msg.error?.code,
          error: msg.error?.message || msg.error,
          retryable: msg.retryable === true,
          nativeAttempted: msg.native_attempted,
        });
        if (questionState) publishQuestionPromptState(questionState);
        else {
          msg = {
            ...msg,
            result: 'failed',
            error: {
              code: 'question_receipt_not_pending',
              message: 'The question was no longer submitting when this receipt arrived.',
            },
          };
        }
      }
      if (msg.command === 'permission_response' && promptMeta) {
        const entry = pendingPrompts.get(promptMeta.key);
        if (msg.result === 'ok') {
          if (entry) {
            clearTimeout(entry.timer);
            pendingPrompts.delete(promptMeta.key);
          }
          broadcastToBrowsers({
            type:             'permission_prompt_expired',
            protocol_version: PROTOCOL_VERSION,
            session_id:       promptMeta.sessionId,
            prompt_id:        promptMeta.promptId,
            applied_choice:   promptMeta.choiceId,
            server_ts:        new Date().toISOString(),
          });
        } else if (entry) {
          entry.prompt = {
            ...entry.prompt,
            submitting_choice_id: null,
            error: msg.error?.message || 'Permission action did not apply',
          };
          broadcastToBrowsers(entry.prompt);
        }
      }
      if (msg.command === 'error_prompt_action' && errorPromptMeta) {
        const entry = pendingErrorPrompts.get(errorPromptMeta.key);
        if (msg.result === 'failed' && entry) {
          entry.prompt = {
            ...entry.prompt,
            submitting_action_id: null,
            error: msg.error?.message || 'Error action did not apply',
          };
          broadcastToBrowsers(entry.prompt);
        }
      }
      if (codexWaiters?.size) {
        for (const waiter of codexWaiters) {
          if (waiter.readyState === WebSocket.OPEN) waiter.send(JSON.stringify(msg));
        }
      } else if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
      }
      log('info', 'ctrl', `Control result: ${msg.result}`, { request_id: requestId, command: msg.command });

    // ── Full history resync from proxy (legacy: 'history', v1: 'history_snapshot') ─
    } else if (t === 'history_chunk') {
      if (handleNativeHistoryFlightResponse(msg, ws)) return;
      const requestId = msg.request_id || null;
      const id = msg.session_id || msg.session;
      const targetWs = requestId ? pendingCtrlReqs.get(requestId) : null;
      const reconciliationRequest = requestId ? pendingHistoryMetadataReconciliations.get(requestId) : null;
      if (requestId) pendingCtrlReqs.delete(requestId);
      if (requestId) pendingHistoryMetadataReconciliations.delete(requestId);
      const reconciliation = reconciliationRequest
        && reconciliationRequest.sessionId === id
        && msg.mode === 'older'
        && msg.source?.endsWith('_jsonl')
        ? reconcileHistoryTailSourceMetadata(id, msg.messages, msg.source)
        : null;
      if (reconciliation?.applied) {
        broadcastTranscriptGap(id, {
          reason: 'authoritative_metadata_reconciliation',
          source: msg.source || null,
          source_cursor: msg.cursor || msg.source_cursor || null,
        });
      }
      const response = reconciliation ? { ...msg, metadata_reconciliation: reconciliation } : msg;
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(response));
        clearBrowserTranscriptGap(targetWs, id);
      } else {
        if (id) broadcastToBrowsers(buildSessionSummary(msg, id));
        log('warn', 'history', 'Dropped requestless or orphaned native history chunk', {
          session: id,
          request_id: requestId,
        });
      }
      log('info', 'history', targetWs ? 'Forwarded native history chunk to requester' : 'Suppressed native history chunk fan-out', {
        session: id,
        messages: Array.isArray(msg.messages) ? msg.messages.length : 0,
        partial: !!msg.partial,
      });

    } else if (t === 'history' || t === 'history_snapshot') {
      // A coalesced WebSocket data frame can emit messages and an authoritative
      // snapshot in the same JavaScript stack. Persist queued live rows first so
      // reconciliation observes them and cannot append them twice.
      if (pendingProxyMessageWrites.length > 0) flushProxyMessageWrites();
      const id       = msg.session || msg.session_id;
      const messages = msg.messages || [];
      if (!id || !Array.isArray(messages)) return;
      const resyncGate = validateFileBackedTranscriptResync(msg, id);
      if (!resyncGate.ok) {
        log('warn', 'history', `Dropped ${resyncGate.code} file-backed recovery snapshot`, {
          session: id,
          source: resyncGate.source,
          resync_id: resyncGate.resyncId,
          retry_after_ms: resyncGate.retryAfterMs,
        });
        broadcastTranscriptGap(id, {
          reason: resyncGate.code,
          resync_id: resyncGate.resyncId,
          source: resyncGate.source,
          source_cursor: msg.source_cursor || null,
        });
        broadcastToBrowsers(buildSessionSummary(msg, id));
        return;
      }
      const isLargeHistory = messages.length > UNSOLICITED_HISTORY_TAIL_LIMIT;
      const forceFullReplace = msg.replace_all === true;
      let existing = null;
      let existingLength = 0;
      let alreadyMatches = false;
      if (forceFullReplace) {
        existingLength = getReconciliationHistoryCount(id);
      } else if (messages.length > 0 && isLargeHistory) {
        const quick = historiesTailLikelyMatch(id, messages);
        existingLength = quick.existingCount;
        alreadyMatches = quick.match;
      } else {
        existing = getReconciliationHistoryRows(id);
        existingLength = existing.length;
        alreadyMatches = historyRowsMatch(existing, messages);
      }

      // A snapshot is authoritative even when it is empty. New-chat and
      // list-view transitions intentionally send [] to clear the previous
      // conversation; ignoring that snapshot causes the next native turns to
      // be appended behind stale SQLite history and appear duplicated.
      const incrementalPlan = !alreadyMatches && !forceFullReplace
        ? getIncrementalHistoryPlan(id, messages, existingLength)
        : null;
      if (incrementalPlan && incrementalPlan.rows.length > 0) {
        db.transaction((rows) => {
          if (incrementalPlan.mode === 'replace_suffix') {
            stmtDeleteSessionSuffix.run(id, incrementalPlan.delete_from_id);
            sessionSeq.delete(id);
          }
          rows.forEach(m => insertHistoryMessage(id, m));
        })(incrementalPlan.rows);
        recomputeLatestVisibleMessage(id);
        log('info', 'history', `${incrementalPlan.mode === 'append' ? 'Appended' : 'Replaced suffix with'} ${incrementalPlan.rows.length} msgs`, {
          session: id,
          previous: incrementalPlan.existing_count,
          prefix: incrementalPlan.prefix_count ?? incrementalPlan.existing_count,
          total: messages.length,
        });
        if (msg.source?.endsWith('_jsonl') || messages.some(message => message?.source_cursor)) {
          rebuildTranscriptSourceCursors(id, messages);
        }
        const isIncrementalLiveAppend = incrementalPlan.mode === 'append'
          && incrementalPlan.existing_count > 0
          && !msg.resync_id;
        if (isIncrementalLiveAppend) {
          broadcastPersistedTranscriptRows(id, getHistoryRowsTail(id, incrementalPlan.rows.length));
        } else {
          broadcastTranscriptGap(id, {
            reason: msg.resync_reason
              || (incrementalPlan.existing_count === 0 ? 'authoritative_initial_snapshot' : 'authoritative_mutation'),
            resync_id: msg.resync_id || null,
            source: msg.source || null,
            source_cursor: msg.source_cursor || null,
          });
          broadcastToBrowsers(buildSessionSummary(msg, id));
        }
      } else if (!alreadyMatches) {
        if (!existing) existing = getReconciliationHistoryRows(id);
        const resync = db.transaction((msgs) => {
          stmtDeleteSession.run(id);
          sessionSeq.delete(id);
          msgs.forEach(m => insertHistoryMessage(id, m));
        });
        resync(messages);
        recomputeLatestVisibleMessage(id);
        if (msg.source?.endsWith('_jsonl') || messages.some(message => message?.source_cursor) || messages.length === 0) {
          rebuildTranscriptSourceCursors(id, messages);
        }
        log('info', 'history', `Resynced ${existingLength}→${messages.length}`, { session: id });
        broadcastTranscriptGap(id, {
          reason: msg.resync_reason || (messages.length === 0 ? 'authoritative_clear' : 'authoritative_resync'),
          resync_id: msg.resync_id || null,
          source: msg.source || null,
          source_cursor: msg.source_cursor || null,
        });
        broadcastToBrowsers(buildSessionSummary(msg, id));
      } else if (!isLargeHistory && existing && existing.length === 0 && messages.length > 0) {
        db.transaction((msgs) => {
          msgs.forEach(m => insertHistoryMessage(id, m));
        })(messages);
        recomputeLatestVisibleMessage(id);
        if (msg.source?.endsWith('_jsonl') || messages.some(message => message?.source_cursor)) {
          rebuildTranscriptSourceCursors(id, messages);
        }
        log('info', 'history', `Stored ${messages.length} msgs`, { session: id });
        broadcastTranscriptGap(id, {
          reason: msg.resync_reason || 'authoritative_initial_snapshot',
          resync_id: msg.resync_id || null,
          source: msg.source || null,
          source_cursor: msg.source_cursor || null,
        });
        broadcastToBrowsers(buildSessionSummary(msg, id));
      }
      if (resyncGate.resyncId) {
        completeProxyTranscriptResync(id, resyncGate.source, resyncGate.resyncId);
        if (alreadyMatches) {
          broadcastTranscriptGap(id, {
            reason: resyncGate.reason || 'authoritative_resync_confirmed',
            resync_id: resyncGate.resyncId,
            source: resyncGate.source,
            source_cursor: msg.source_cursor || null,
          });
        }
      }

    // ── Rate limit events (A12-02, proxy side added in A12-03) ────────────
    } else if (t === 'rate_limit_active') {
      const id = msg.session_id || msg.session;
      const percentUsed = msg.percent_used ?? null;
      const hardLimited = msg.hard_limited === true
        || (msg.hard_limited == null && (percentUsed == null || Number(percentUsed) >= 100));
      if (id) touchSession(id);
      if (id && sessionMeta.has(id)) {
        sessionMeta.set(id, {
          ...sessionMeta.get(id),
          rate_limited_until: hardLimited ? (msg.retry_after_hint || 'unknown') : null,
          rate_limit_active: hardLimited,
          percent_used: percentUsed,
          last_seen_at: new Date().toISOString(),
        });
      }
      broadcastToBrowsers({ ...msg, hard_limited: hardLimited });
      const providerAuthoritative = id ? providerUsageAuthority.isAuthoritative(id) : false;
      const threshold = id && !providerAuthoritative
        ? usageThresholds.observe(id, { percentUsed, hardLimited })
        : null;
      if (id && hardLimited && !providerAuthoritative) {
        scheduleUsageResume(id, msg.reset_at || msg.retry_after_hint);
      }
      if (id && threshold != null) {
        const name = notificationSessionName(id);
        const notification = buildUsageThresholdNotification(name, threshold, percentUsed, msg.retry_after_hint);
        const createdAt = new Date().toISOString();
        const fallbackCycle = crypto.createHash('sha256').update([
          id, msg.reset_at || msg.retry_after_hint || 'open-cycle', threshold,
        ].join('\u0000'), 'utf8').digest('hex').slice(0, 32);
        const semanticEvent = goalNotifications.recordExternalEvent({
          type: 'semantic_notification',
          event_type: 'provider_usage_threshold',
          category: 'provider_usage_warning',
          dedupe_key: `provider-usage-threshold:fallback-${fallbackCycle}:${threshold}`,
          session_id: id,
          session_name: name,
          title: notification.title,
          body: notification.body.slice(0, 180),
          activity_type: hardLimited ? 'rate_limit' : 'usage_warning',
          created_at: createdAt,
          harness: sessionMeta.get(id)?.agent_type || 'unknown',
          goal_affiliation: 'provider_usage',
          provider_id: 'session-local',
          account_label: 'Session-local source',
          window_id: 'primary',
          window_label: 'Primary usage',
          threshold,
          percent_used: percentUsed,
          hard_limited: hardLimited,
          reset_hint: msg.reset_at || msg.retry_after_hint || '',
          affected_session_ids: [id],
        }, {
          harness: sessionMeta.get(id)?.agent_type || 'unknown',
          goalAffiliation: 'provider_usage',
          occurredAt: createdAt,
          metadata: { source: 'session_rate_limit_fallback' },
        });
        if (semanticEvent) dispatchSemanticNotification(semanticEvent);
      }
      log('info', 'rate-limit', hardLimited ? 'Rate limit active' : 'Usage warning', {
        session: id, percent_used: percentUsed, threshold, provider_authoritative: providerAuthoritative,
        retry_after_hint: msg.retry_after_hint,
      });

    } else if (t === 'rate_limit_cleared') {
      const id = msg.session_id || msg.session;
      const previousUsage = id ? usageThresholds.clear(id) : null;
      if (id) {
        db.prepare(`
          UPDATE usage_resume_jobs
          SET next_attempt_at = ?, cycle_cleared = 1, updated_at = ?
          WHERE session_id = ? AND state = 'pending'
        `).run(new Date().toISOString(), new Date().toISOString(), id);
        db.prepare(`
          UPDATE usage_resume_jobs
          SET cycle_cleared = 1, updated_at = ?
          WHERE session_id = ? AND state IN ('dispatching', 'completed', 'failed', 'cancelled')
        `).run(new Date().toISOString(), id);
      }
      if (id) touchSession(id);
      if (id && sessionMeta.has(id)) {
        sessionMeta.set(id, {
          ...sessionMeta.get(id),
          rate_limited_until: null,
          rate_limit_active: false,
          percent_used: null,
          last_seen_at: new Date().toISOString(),
        });
      }
      broadcastToBrowsers(msg);
      if (previousUsage?.hardLimited && shouldSendPush()) {
        sendPushNotification(
          'Rate limit cleared',
          `${notificationSessionName(id)} can use its harness again.`,
          { type: 'rate_limit_cleared', activity_type: 'idle', session_id: id || '' }
        ).catch(() => {});
      }
      log('info', 'rate-limit', 'Rate limit cleared', { session: id });

    // ── Steer / queue messages (proxy → browser) ─────────────────────────
    } else if (t === 'message_queued' || t === 'queue_delivered' || t === 'steer_result' || t === 'proxy_send_result' || t === 'agent_started') {
      let lifecyclePersistence = null;
      if (t === 'proxy_send_result') {
        lifecyclePersistence = persistSendLifecycle(msg);
      } else if (t === 'agent_started') {
        lifecyclePersistence = persistSendLifecycle(msg);
      } else if ((t === 'message_queued' || t === 'queue_delivered') && msg.client_message_id) {
        const row = stmtGetSendReceipt.get(msg.client_message_id)
          || stmtGetByClientId.get(msg.client_message_id)
          || null;
        let attemptValidation = row && row.session === (msg.session_id || msg.session)
          ? validateSendAttempt(msg, row)
          : { ok: false, code: row ? 'client_message_id_session_mismatch' : 'unknown_client_message_id' };
        if (attemptValidation.ok && row.status !== 'accepted') {
          attemptValidation = {
            ok: false,
            code: 'lifecycle_regression',
            delivery_attempt: attemptValidation.delivery_attempt,
          };
        }
        lifecyclePersistence = {
          applied: attemptValidation.ok === true,
          advanced: attemptValidation.ok === true,
          code: attemptValidation.ok ? 'attempt_matched' : attemptValidation.code,
          row,
        };
      }
      const keyedLifecycleEvent = (
        t === 'agent_started'
        || t === 'proxy_send_result'
        || t === 'message_queued'
        || t === 'queue_delivered'
      ) && Boolean(msg.client_message_id);
      const lifecycleAccepted = !keyedLifecycleEvent
        || (lifecyclePersistence?.applied === true && lifecyclePersistence?.advanced === true);
      if (t === 'proxy_send_result' && lifecycleAccepted) {
        if (msg.latency_trace) acceptProxyLatencyTrace(msg.latency_trace);
        if (msg.result === 'failed' && msg.client_message_id) {
          const failedTraceId = latencyTraceIdByClientMessageId.get(msg.client_message_id);
          if (failedTraceId) terminalizeActiveLatencyTrace(failedTraceId, 'send_failed');
        }
      }
      if (t === 'proxy_send_result' && lifecycleAccepted && (msg.result === 'delivered' || msg.result === 'failed')) {
        settleUsageResumeFromProxy(msg);
        settleScheduledSendFromProxy(msg);
      }
      const agentStarted = t === 'proxy_send_result' && lifecycleAccepted ? sendLifecycle.markProxyResult(msg) : null;
      if (lifecycleAccepted) broadcastToBrowsers(msg);
      else if (lifecyclePersistence?.code !== 'lifecycle_duplicate') {
        log('warn', 'send', 'Rejected unmatched lifecycle event', {
          session: msg.session_id || msg.session,
          cid: msg.client_message_id,
          code: lifecyclePersistence?.code || 'lifecycle_not_persisted',
        });
      }
      if (agentStarted) {
        const persisted = persistSendLifecycle(agentStarted);
        if (persisted.applied && persisted.advanced) {
          broadcastToBrowsers(agentStarted);
          log('info', 'send', 'agent_started', { session: agentStarted.session_id, cid: agentStarted.client_message_id });
        }
      }
      log('info', 'send', `${t}`, {
        session: msg.session_id,
        cid: msg.client_message_id,
        delivery_attempt: msg.delivery_attempt || lifecyclePersistence?.delivery_attempt || null,
      });

    // ── Native queue (Codex side-panel queue items) ─────────────────────────
    } else if (t === 'native_queue') {
      broadcastToBrowsers(msg);
    }
  });

  ws.on('close', () => {
    if (helloTimeout) clearTimeout(helloTimeout);
    log('info', 'proxy-ws', 'Agent proxy disconnected', { proxy_id: thisProxyId });
    recoverNativeHistoryFlightsForProxy(ws);
    proxyConnections.delete(ws);
    for (const [subscriptionId, subscription] of hostResourceSubscriptions) {
      if (subscription.proxyWs !== ws) continue;
      hostResourceSubscriptions.delete(subscriptionId);
      if (subscription.ws.readyState === WebSocket.OPEN) subscription.ws.send(JSON.stringify({
        type: 'host_resource_error', code: 'proxy_unavailable',
        message: 'The Windows proxy disconnected.',
      }));
    }
    for (const pendingMap of [pendingHostResourceSubscriptionRequests, pendingHostResourceHistoryRequests]) {
      for (const [requestId, pending] of pendingMap) {
        if (pending.proxyWs !== ws) continue;
        clearTimeout(pending.timer);
        pendingMap.delete(requestId);
      }
    }
    proxySessionClaims.delete(ws);
    proxyOutageMonitor.observe(authenticatedProxyConnectionCount());
    proxySessions.forEach(s => {
      if (proxySockets.get(s) === ws) {
        // Open native questions survive a relay transport reconnect and are
        // re-emitted by the proxy. Only an in-flight answer becomes uncertain.
        questionPromptRegistry.disconnectSession(s).forEach(publishQuestionPromptState);
        proxySockets.delete(s);
        sessionProxyId.delete(s);
        sessionMeta.delete(s);
        sessionActivity.delete(s);
        clearQueuedSessionStatus(s);
        sendLifecycle.clearSession(s);
        cachedChatLists.delete(s);
        clearSessionAuxiliaryState(s);
        setHealth(s, 'disconnected');
      }
    });
    if (getProxySocket() === null) cachedWorkspaces = [];
    refreshDuplicateProxyAlarms();
    queueSessionListBroadcast();
    // Cancel any in-flight launches if no proxy is left
    if (getProxySocket() === null && pendingLaunches.size > 0) {
      for (const [requestId] of pendingLaunches) {
        cancelPendingLaunch(requestId, 'no_proxy_connected', 'Agent proxy disconnected');
      }
    }
    // Expire open prompts for sessions owned by this proxy
    for (const [key, entry] of pendingPrompts) {
      const [sessionId] = key.split(':');
      if (proxySessions.has(sessionId)) expirePrompt(sessionId, entry.prompt.prompt_id);
    }
    for (const key of Array.from(pendingErrorPrompts.keys())) {
      const [sessionId] = key.split(':');
      if (proxySessions.has(sessionId)) {
        const entry = pendingErrorPrompts.get(key);
        pendingErrorPrompts.delete(key);
        if (entry?.prompt?.prompt_id) {
          broadcastToBrowsers({
            type:             'session_error_prompt_cleared',
            protocol_version: PROTOCOL_VERSION,
            session_id:       sessionId,
            prompt_id:        entry.prompt.prompt_id,
            server_ts:        new Date().toISOString(),
          });
        }
      }
    }
    for (const [refreshKey, active] of activeProviderUsageRefreshes) {
      if (active.proxyWs !== ws) continue;
      activeProviderUsageRefreshes.delete(refreshKey);
      providerUsageRefreshesByRequest.delete(active.upstreamRequestId);
      clearTimeout(active.timer);
      for (const client of active.clients) {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({
          type: 'provider_usage_refresh_receipt',
          request_id: client.clientRequestId,
          provider_id: active.providerId,
          status: 'error',
          code: 'proxy_disconnected',
        }));
      }
    }
    if (activeProviderUsageResetCredit?.proxyWs === ws) {
      const active = activeProviderUsageResetCredit;
      activeProviderUsageResetCredit = null;
      clearTimeout(active.timer);
      if (active.clientWs.readyState === WebSocket.OPEN) active.clientWs.send(JSON.stringify({
        type: 'provider_usage_reset_credit_receipt',
        request_id: active.clientRequestId,
        status: 'error',
        code: 'proxy_disconnected',
      }));
    }
    for (const [requestId, pending] of pendingProviderUsageCostDetailRequests) {
      if (pending.proxyWs !== ws) continue;
      clearTimeout(pending.timer);
      pendingProviderUsageCostDetailRequests.delete(requestId);
      if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
        type: 'provider_usage_cost_detail_error',
        request_id: pending.clientRequestId,
        code: 'proxy_disconnected',
      }));
    }
  });
}

// ── Browser client handler (A2-01, A2-02, A2-03, A2-04) ──────────────────────

function buildClientConnectionAck(ws) {
  const pendingLaunchList = Array.from(pendingLaunches.entries()).map(([rid, p]) => ({
    request_id:  rid,
    agent_type:  p.agent_type,
    launched_at: p.launched_at,
    timeout_at:  p.timeout_at,
  }));
  const openPromptList = Array.from(pendingPrompts.values()).map(e => e.prompt);
  const openQuestionPromptList = questionPromptRegistry.views()
    .filter(prompt => ['open', 'submitting'].includes(prompt.lifecycle));
  const openErrorPromptList = Array.from(pendingErrorPrompts.values()).map(e => e.prompt);
  const agentConfigMap = getCompactAgentConfigsForAck();
  const nightlyValidationFailures = nightlyValidationStatuses().filter(item => item.status !== 'pass');
  const latestAppUpdate = latestAppUpdateValidation();
  const revalidationHealth = harnessRevalidationHealth();
  const dogfoodHealth = operatorDogfoodHealth();
  const recentSemanticNotifications = semanticNotificationsForClient(ws);
  const sessionAliasList = [...sessionAliases.aliases.values()].map(alias => ({
    alias_session_id: alias.alias_session_id,
    canonical_session_id: alias.canonical_session_id,
    canonical_conversation_id: alias.canonical_conversation_id,
    canonical_native_id: alias.canonical_native_id,
    current_surface: alias.current_surface,
    suppression_reason: alias.suppression_reason,
    generation: alias.generation_clock,
  }));
  return {
    type:                 'connection_ack',
    protocol_version:     PROTOCOL_VERSION,
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    heartbeat_timeout_ms:  HEARTBEAT_TIMEOUT_MS,
    session_subscriptions: true,
    max_session_subscriptions: MAX_SESSION_SUBSCRIPTIONS,
    state_epoch:          RELAY_STATE_EPOCH,
    connection_id:        ws._controlConnectionId,
    sessions:             getSessionList(),
    session_health:       Object.fromEntries(sessionHealth),
    ...(pendingLaunchList.length > 0 ? { pending_launches:  pendingLaunchList  } : {}),
    ...(openPromptList.length  > 0 ? { open_prompts:      openPromptList      } : {}),
    ...(openQuestionPromptList.length > 0 ? { open_question_prompts: openQuestionPromptList } : {}),
    ...(openErrorPromptList.length > 0 ? { open_error_prompts: openErrorPromptList } : {}),
    ...(Object.keys(agentConfigMap).length > 0 ? { agent_configs: agentConfigMap } : {}),
    ...(duplicateProxyAlarms.length > 0 ? { duplicate_proxy_alarms: duplicateProxyAlarms } : {}),
    ...(nightlyValidationFailures.length > 0 ? { nightly_validation_failures: nightlyValidationFailures } : {}),
    ...(latestAppUpdate ? { latest_app_update_validation: latestAppUpdate } : {}),
    ...(revalidationHealth ? { revalidation_program_health: revalidationHealth } : {}),
    ...(dogfoodHealth ? { operator_dogfood_health: dogfoodHealth } : {}),
    ...(sessionAliasList.length > 0 ? { session_aliases: sessionAliasList } : {}),
    ...(cachedProviderUsage ? { provider_usage: cachedProviderUsage } : {}),
    ...(cachedWorkspaces.length > 0 ? { workspaces: cachedWorkspaces } : {}),
    ...(recentSemanticNotifications.length > 0
      ? { semantic_notifications: recentSemanticNotifications } : {}),
    ts:                   Date.now(),
  };
}

function handleClientConnection(ws, req) {
  log('info', 'client-ws', 'Browser connected');
  browserClients.add(ws);
  startHeartbeat(ws, 'browser');
  const clientPrincipal = authenticatedWebSocketPrincipal(ws, req);
  ws._authenticatedEmail = authenticatedWebSocketEmail(ws, req);
  ws._controlConnectionId = crypto.randomUUID();
  ws._providerUsageWatching = false;
  // Full transcript traffic is opt-in. Until the client subscribes, it receives
  // session summaries only; this prevents a reconnect race from replaying every
  // active transcript before the selected-session subscription arrives.
  ws._sessionSubscriptions = new Set();
  ws._transcriptGaps = new Map();

  // Keep the eager ack for existing Web clients. Native clients may request one
  // replay after their event handlers are attached.
  ws.send(JSON.stringify(buildClientConnectionAck(ws)));
  for (const [sessionId, chatList] of cachedChatLists) {
    if (proxySockets.has(sessionId)) ws.send(JSON.stringify(chatList));
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const clientMessageReceivedAtMs = Date.now();
    const t = msg.type;
    msg = canonicalizeSessionMessage(msg);

    // Drop messages with unknown or missing type (A8-01)
    if (typeof t !== 'string' || !KNOWN_CLIENT_TYPES.has(t)) {
      log('warn', 'client-ws', 'Unknown message type — dropped', { type: t });
      return;
    }

    // ── Rate limit ─────────────────────────────────────────────────────────
    const messageRate = browserMessageRateLimit.consume(clientPrincipal);
    if (!messageRate.ok) {
      log('warn', 'client-ws', 'Principal message rate limit exceeded — dropping message', {
        principal: clientPrincipal,
        retry_after_ms: messageRate.retryAfterMs,
      });
      return;
    }

    // ── Handshake ──────────────────────────────────────────────────────────
    if (t === 'connection_hello' || t === 'hello') {
      log('info', 'client-ws', 'Browser hello received', { last_seq: msg.last_sequence });
      if (msg.request_connection_ack === true) {
        ws.send(JSON.stringify(buildClientConnectionAck(ws)));
      }

    // ── Application heartbeat ──────────────────────────────────────────────
    } else if (t === 'heartbeat') {
      ws.send(JSON.stringify(applicationHeartbeatAck(msg, clientMessageReceivedAtMs)));

    } else if (t === 'latency_trace_complete') {
      const completion = completeBrowserLatencyTrace(msg.latency_trace);
      if (!completion.ok) {
        log('warn', 'latency-trace', 'Rejected browser render completion', {
          trace_id: msg.latency_trace?.trace_id || null,
          code: completion.code,
        });
      } else if (completion.appended) {
        log('info', 'latency-trace', 'Persisted completed send trace', {
          trace_id: completion.trace_id,
        });
      }

    // ── Selective session subscription ────────────────────────────────────
    } else if (t === 'provider_usage_watch') {
      ws._providerUsageWatching = msg.active === true;
      const watcherCount = [...browserClients].filter(client => client._providerUsageWatching === true).length;
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (proxyWs) proxyWs.send(JSON.stringify({
        type: 'provider_usage_watch',
        protocol_version: PROTOCOL_VERSION,
        active: watcherCount > 0,
        watcher_count: watcherCount,
      }));

    } else if (t === 'provider_usage_refresh') {
      const clientRequestId = boundedString(msg.request_id, { min: 1, max: 80 }) ? msg.request_id : null;
      const providerId = msg.provider_id == null ? null
        : boundedString(msg.provider_id, { min: 1, max: 80 }) && PROVIDER_USAGE_IDS.has(msg.provider_id)
          ? msg.provider_id : false;
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (!clientRequestId || providerId === false || !proxyWs) {
        ws.send(JSON.stringify({
          type: 'provider_usage_refresh_receipt',
          request_id: clientRequestId,
          provider_id: providerId || null,
          status: 'error',
          code: !clientRequestId ? 'invalid_request_id'
            : providerId === false ? 'invalid_provider' : 'proxy_unavailable',
        }));
        return;
      }
      const refreshKey = `${proxyWs._controlConnectionId || 'proxy'}:${providerId || '*'}`;
      const existing = activeProviderUsageRefreshes.get(refreshKey);
      if (existing && existing.proxyWs === proxyWs) {
        existing.clients.push({ ws, clientRequestId, initialStatus: 'coalesced' });
        ws.send(JSON.stringify({
          type: 'provider_usage_refresh_receipt',
          protocol_version: PROTOCOL_VERSION,
          request_id: clientRequestId,
          provider_id: providerId,
          status: 'coalesced',
        }));
        return;
      }
      const upstreamRequestId = `provider-usage-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        const active = activeProviderUsageRefreshes.get(refreshKey);
        if (!active || active.upstreamRequestId !== upstreamRequestId) return;
        activeProviderUsageRefreshes.delete(refreshKey);
        providerUsageRefreshesByRequest.delete(upstreamRequestId);
        for (const client of active.clients) {
          if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({
            type: 'provider_usage_refresh_receipt',
            request_id: client.clientRequestId,
            provider_id: providerId,
            status: 'error',
            code: 'collector_timeout',
          }));
        }
      }, PROVIDER_USAGE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      const active = {
        upstreamRequestId,
        refreshKey,
        providerId,
        proxyWs,
        clients: [{ ws, clientRequestId, initialStatus: 'accepted' }],
        timer,
      };
      activeProviderUsageRefreshes.set(refreshKey, active);
      providerUsageRefreshesByRequest.set(upstreamRequestId, active);
      ws.send(JSON.stringify({
        type: 'provider_usage_refresh_receipt',
        protocol_version: PROTOCOL_VERSION,
        request_id: clientRequestId,
        provider_id: providerId,
        status: 'accepted',
      }));
      proxyWs.send(JSON.stringify({
        type: 'provider_usage_refresh',
        protocol_version: PROTOCOL_VERSION,
        force: msg.force === true,
        provider_id: providerId,
        request_id: upstreamRequestId,
      }));
      log('info', 'provider-usage', 'Refresh request forwarded', { proxies: 1 });

    } else if (t === 'provider_usage_reset_credit_consume') {
      const clientRequestId = boundedString(msg.request_id, { min: 1, max: 80 }) ? msg.request_id : null;
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (!clientRequestId || msg.approved !== true || !proxyWs) {
        ws.send(JSON.stringify({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: PROTOCOL_VERSION,
          request_id: clientRequestId,
          status: 'error',
          code: !clientRequestId ? 'invalid_request_id'
            : (msg.approved !== true ? 'operator_approval_required' : 'proxy_unavailable'),
        }));
        return;
      }
      if (activeProviderUsageResetCredit) {
        ws.send(JSON.stringify({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: PROTOCOL_VERSION,
          request_id: clientRequestId,
          status: 'error',
          code: 'reset_in_progress',
        }));
        return;
      }
      const upstreamRequestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        const active = activeProviderUsageResetCredit;
        if (!active || active.upstreamRequestId !== upstreamRequestId) return;
        activeProviderUsageResetCredit = null;
        if (active.clientWs.readyState === WebSocket.OPEN) active.clientWs.send(JSON.stringify({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: PROTOCOL_VERSION,
          request_id: active.clientRequestId,
          status: 'error',
          code: 'collector_timeout',
        }));
      }, PROVIDER_USAGE_REQUEST_TIMEOUT_MS * 2);
      timer.unref?.();
      activeProviderUsageResetCredit = { upstreamRequestId, proxyWs, clientWs: ws, clientRequestId, timer };
      ws.send(JSON.stringify({
        type: 'provider_usage_reset_credit_receipt',
        protocol_version: PROTOCOL_VERSION,
        request_id: clientRequestId,
        status: 'accepted',
      }));
      proxyWs.send(JSON.stringify({
        type: 'provider_usage_reset_credit_consume',
        protocol_version: PROTOCOL_VERSION,
        request_id: upstreamRequestId,
        approved: true,
      }));
      log('info', 'provider-usage', 'Operator-approved reset credit request forwarded', { proxies: 1 });

    } else if (t === 'provider_usage_cost_detail_request') {
      const clientRequestId = boundedString(msg.request_id, { min: 1, max: 80 }) ? msg.request_id : null;
      const days = Number(msg.days);
      const pageSize = Number(msg.page_size);
      const cursor = String(msg.cursor ?? '0');
      const providerId = msg.provider_id == null || msg.provider_id === '' ? null : String(msg.provider_id);
      const project = msg.project == null || msg.project === '' ? null : String(msg.project);
      const valid = !!clientRequestId
        && Number.isInteger(days) && days >= 1 && days <= 365
        && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 256
        && /^\d{1,9}$/.test(cursor)
        && (providerId == null || ['openai-codex', 'anthropic-claude'].includes(providerId))
        && (project == null || (boundedString(project, { min: 1, max: 100 }) && !containsCredentialShapedValue(project)));
      if (!valid) {
        ws.send(JSON.stringify({ type: 'provider_usage_cost_detail_error', request_id: clientRequestId, code: 'invalid_request' }));
        return;
      }
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (!proxyWs) {
        ws.send(JSON.stringify({ type: 'provider_usage_cost_detail_error', request_id: clientRequestId, code: 'proxy_unavailable' }));
        return;
      }
      const upstreamRequestId = `provider-cost-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        const pending = pendingProviderUsageCostDetailRequests.get(upstreamRequestId);
        if (!pending) return;
        pendingProviderUsageCostDetailRequests.delete(upstreamRequestId);
        if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
          type: 'provider_usage_cost_detail_error',
          request_id: pending.clientRequestId,
          code: 'collector_timeout',
        }));
      }, PROVIDER_USAGE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pendingProviderUsageCostDetailRequests.set(upstreamRequestId, {
        ws,
        proxyWs,
        clientRequestId,
        timer,
        query: { days, pageSize, cursor, providerId, project },
      });
      proxyWs.send(JSON.stringify({
        type: 'provider_usage_cost_detail_request',
        protocol_version: PROTOCOL_VERSION,
        request_id: upstreamRequestId,
        days,
        page_size: pageSize,
        cursor,
        provider_id: providerId,
        project,
      }));

    } else if (t === 'host_resource_subscribe') {
      const clientRequestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      const requestedResume = typeof msg.resume_subscription_id === 'string' ? msg.resume_subscription_id : '';
      if (requestedResume && !HOST_RESOURCE_SUBSCRIPTION_RE.test(requestedResume)) {
        ws.send(JSON.stringify({ type: 'host_resource_error', request_id: clientRequestId, code: 'invalid_subscription', message: 'Invalid host resource resume token.' }));
        return;
      }
      const subscriptionId = requestedResume || `host-sub-${crypto.randomBytes(16).toString('hex')}`;
      const existingRoute = hostResourceSubscriptions.get(subscriptionId);
      if (existingRoute && existingRoute.ws !== ws) {
        ws.send(JSON.stringify({ type: 'host_resource_error', request_id: clientRequestId, code: 'subscription_in_use', message: 'That host resource subscription is already active.' }));
        return;
      }
      const proxyWs = existingRoute?.proxyWs || [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (!proxyWs) {
        ws.send(JSON.stringify({ type: 'host_resource_error', request_id: clientRequestId, code: 'proxy_unavailable', message: 'The Windows proxy is not connected.' }));
        return;
      }
      const previousId = ws._hostResourceSubscriptionId;
      if (previousId && previousId !== subscriptionId) {
        const previous = hostResourceSubscriptions.get(previousId);
        if (previous?.proxyWs?.readyState === WebSocket.OPEN) previous.proxyWs.send(JSON.stringify({
          type: 'host_resource_detach', protocol_version: PROTOCOL_VERSION, subscription_id: previousId,
        }));
        hostResourceSubscriptions.delete(previousId);
      }
      const upstreamRequestId = `host-subscribe-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        const pending = pendingHostResourceSubscriptionRequests.get(upstreamRequestId);
        if (!pending) return;
        pendingHostResourceSubscriptionRequests.delete(upstreamRequestId);
        if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
          type: 'host_resource_error', request_id: pending.clientRequestId,
          code: 'collector_timeout', message: 'The Windows resource subscription timed out.',
        }));
      }, HOST_RESOURCE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pendingHostResourceSubscriptionRequests.set(upstreamRequestId, {
        ws, proxyWs, clientRequestId, subscriptionId, timer,
      });
      proxyWs.send(JSON.stringify({
        type: 'host_resource_subscribe',
        protocol_version: PROTOCOL_VERSION,
        request_id: upstreamRequestId,
        subscription_id: subscriptionId,
        aggregate_only: msg.aggregate_only === true,
      }));

    } else if (t === 'host_resource_unsubscribe') {
      const clientRequestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      const subscriptionId = typeof msg.subscription_id === 'string' ? msg.subscription_id : '';
      const subscription = hostResourceSubscriptions.get(subscriptionId);
      if (!subscription || subscription.ws !== ws || ws._hostResourceSubscriptionId !== subscriptionId) {
        ws.send(JSON.stringify({ type: 'host_resource_error', request_id: clientRequestId, code: 'subscription_unknown', message: 'Host resource subscription is not active.' }));
        return;
      }
      hostResourceSubscriptions.delete(subscriptionId);
      ws._hostResourceSubscriptionId = null;
      if (subscription.proxyWs.readyState === WebSocket.OPEN) subscription.proxyWs.send(JSON.stringify({
        type: 'host_resource_unsubscribe', protocol_version: PROTOCOL_VERSION,
        request_id: `host-unsubscribe-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        subscription_id: subscriptionId,
      }));
      ws.send(JSON.stringify({
        type: 'host_resource_unsubscribed', protocol_version: PROTOCOL_VERSION,
        request_id: clientRequestId, subscription_id: subscriptionId,
      }));

    } else if (t === 'host_resource_history_request') {
      const clientRequestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      const subscriptionId = typeof msg.subscription_id === 'string' ? msg.subscription_id : '';
      const subscription = hostResourceSubscriptions.get(subscriptionId);
      const stream = msg.stream === 'detail' ? 'detail' : msg.stream === 'system' ? 'system' : '';
      const afterSequence = Math.max(0, Math.round(Number(msg.after_sequence) || 0));
      const maxPoints = Math.max(1, Math.min(stream === 'detail' ? 8 : 128, Math.round(Number(msg.max_points) || (stream === 'detail' ? 8 : 64))));
      if (!subscription || subscription.ws !== ws || !stream) {
        ws.send(JSON.stringify({ type: 'host_resource_error', request_id: clientRequestId, code: 'invalid_history_request', message: 'Invalid host resource history request.' }));
        return;
      }
      const upstreamRequestId = `host-history-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        const pending = pendingHostResourceHistoryRequests.get(upstreamRequestId);
        if (!pending) return;
        pendingHostResourceHistoryRequests.delete(upstreamRequestId);
        if (pending.ws.readyState === WebSocket.OPEN) pending.ws.send(JSON.stringify({
          type: 'host_resource_error', request_id: pending.clientRequestId,
          code: 'history_timeout', message: 'Host resource history timed out.',
        }));
      }, HOST_RESOURCE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pendingHostResourceHistoryRequests.set(upstreamRequestId, {
        ws, proxyWs: subscription.proxyWs, clientRequestId, subscriptionId, stream, timer,
      });
      subscription.proxyWs.send(JSON.stringify({
        type: 'host_resource_history_request', protocol_version: PROTOCOL_VERSION,
        request_id: upstreamRequestId, subscription_id: subscriptionId,
        stream, after_sequence: afterSequence, max_points: maxPoints,
      }));

    } else if (t === 'host_resource_refresh') {
      const now = Date.now();
      const clientRequestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      if (now - Number(ws._lastHostResourceRefreshAt || 0) < HOST_RESOURCE_REQUEST_MIN_INTERVAL_MS) {
        ws.send(JSON.stringify({
          type: 'host_resource_error',
          request_id: clientRequestId,
          code: 'refresh_throttled',
          message: 'Host resources refresh is limited to once every 2 seconds.',
        }));
        return;
      }
      ws._lastHostResourceRefreshAt = now;
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (!proxyWs) {
        ws.send(JSON.stringify({
          type: 'host_resource_error',
          request_id: clientRequestId,
          code: 'proxy_unavailable',
          message: 'The Windows proxy is not connected.',
        }));
        return;
      }
      const upstreamRequestId = `host-resource-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const timer = setTimeout(() => {
        const pending = pendingHostResourceRequests.get(upstreamRequestId);
        if (!pending) return;
        pendingHostResourceRequests.delete(upstreamRequestId);
        if (pending.ws.readyState === WebSocket.OPEN) {
          pending.ws.send(JSON.stringify({
            type: 'host_resource_error',
            request_id: pending.clientRequestId,
            code: 'collector_timeout',
            message: 'The Windows resource collector timed out.',
          }));
        }
      }, HOST_RESOURCE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pendingHostResourceRequests.set(upstreamRequestId, { ws, proxyWs, clientRequestId, timer });
      proxyWs.send(JSON.stringify({
        type: 'host_resource_refresh',
        protocol_version: PROTOCOL_VERSION,
        request_id: upstreamRequestId,
        force: msg.force === true,
        aggregate_only: msg.aggregate_only === true,
      }));

    } else if (t === 'subscribe') {
      const requested = msg.sessions ?? msg.session_ids;
      const valid = Array.isArray(requested)
        && requested.length <= MAX_SESSION_SUBSCRIPTIONS
        && requested.every(isValidSessionId);
      if (!valid) {
        ws.send(JSON.stringify({
          type: 'connection_error',
          request_id: msg.request_id || null,
          code: 'invalid_subscription',
          message: `sessions must contain at most ${MAX_SESSION_SUBSCRIPTIONS} valid session IDs`,
        }));
        return;
      }
      ws._sessionSubscriptions = new Set(requested);
      for (const sessionId of ws._transcriptGaps.keys()) {
        if (!ws._sessionSubscriptions.has(sessionId)) ws._transcriptGaps.delete(sessionId);
      }
      ws.send(JSON.stringify({
        type: 'subscription_ack',
        protocol_version: PROTOCOL_VERSION,
        request_id: msg.request_id || null,
        sessions: [...ws._sessionSubscriptions],
        summary_only_for_others: true,
        server_ts: new Date().toISOString(),
      }));

    // ── History request (A2-04) ────────────────────────────────────────────
    // Supports both old (get_history) and new (history_request) names,
    // and both old and new field names for delta mode.
    } else if (t === 'history_chunk_request') {
      const id = msg.session || msg.session_id;
      const requestId = msg.request_id || `histchunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!id) return;
      const requestedSource = msg.source || msg.history_source || 'native';
      if (requestedSource === 'relay_sqlite') {
        const mode = msg.mode === 'older' ? 'older' : msg.mode === 'around' ? 'around' : 'tail';
        const beforeId = msg.mode === 'older'
          ? (msg.before_id ?? msg.beforeId ?? msg.cursor?.next_before_id ?? null)
          : null;
        const aroundId = mode === 'around'
          ? (msg.around_id ?? msg.aroundId ?? null)
          : null;
        if (mode === 'around' && (!Number.isSafeInteger(Number(aroundId)) || Number(aroundId) <= 0)) {
          sendHistoryChunkError(ws, {
            sessionId: id,
            requestId,
            mode,
            source: requestedSource,
            code: 'invalid_history_anchor',
            message: 'A positive around_id is required.',
          });
          return;
        }
        const result = getEffectiveHistoryChunk(id, {
          beforeId,
          aroundId,
          limit: msg.limit || msg.tail_limit || msg.history_limit || DEFAULT_HISTORY_CHUNK_LIMIT,
        });
        ws.send(JSON.stringify({
          type: 'history_chunk',
          protocol_version: PROTOCOL_VERSION,
          session: id,
          session_id: id,
          request_id: requestId,
          mode,
          replace: mode === 'around' || (mode !== 'older' && msg.replace === true),
          source: 'relay_sqlite',
          source_session: result.source_session,
          messages: result.messages,
          partial: !!result.partial,
          complete: !result.partial,
          total_messages: result.total,
          loaded_messages: result.messages.length,
          limit: result.limit,
          cursor: {
            next_before_id: result.next_before_id,
            source_session: result.source_session,
            total_messages: result.total,
            limit: result.limit,
          },
        }));
        clearBrowserTranscriptGap(ws, id);
        log('info', 'history', 'Served relay history chunk', {
          session: id,
          source_session: result.source_session,
          mode,
          messages: result.messages.length,
          partial: !!result.partial,
        });
        return;
      }
      if (msg.reconcile_metadata === true) {
        if (msg.mode !== 'older') {
          sendHistoryChunkError(ws, {
            sessionId: id,
            requestId,
            mode: msg.mode || 'tail',
            source: requestedSource,
            code: 'metadata_reconciliation_requires_pinned_older_window',
            message: 'Source metadata reconciliation requires an explicit older-history cursor.',
          });
          return;
        }
      }
      beginNativeHistoryRequest(ws, msg, id, requestId, requestedSource);
      return;

    } else if (t === 'get_history' || t === 'history_request') {
      const id       = msg.session || msg.session_id;
      const sinceSeq = msg.since_sequence ?? msg.after_sequence ?? null;
      if (!id) return;
      if (sinceSeq != null && sinceSeq > 0) {
        const messages = getHistoryRowsFrom(id, sinceSeq);
        const latestSequence = messages.reduce(
          (maximum, message) => Math.max(maximum, Number(message.sequence || 0)),
          Number(sinceSeq) || 0,
        );
        ws.send(JSON.stringify({
          type: 'history_delta',
          protocol_version: PROTOCOL_VERSION,
          session: id,
          session_id: id,
          request_id: msg.request_id || null,
          after_sequence: Number(sinceSeq),
          last_sequence: latestSequence,
          total_messages: getHistoryCount(id),
          loaded_messages: messages.length,
          messages,
        }));
        clearBrowserTranscriptGap(ws, id);
      } else {
        const requestedLimit = msg.full ? 0 : Number(msg.limit || msg.tail_limit || msg.history_limit || 0);
        if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
          const limit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
          const result = getEffectiveHistoryTail(id, limit);
          ws.send(JSON.stringify({
            type: 'history',
            session: id,
            request_id: msg.request_id || null,
            messages: result.messages,
            partial: result.total > result.loaded,
            total_messages: result.total,
            loaded_messages: result.loaded,
            limit,
            mode: 'tail',
          }));
          clearBrowserTranscriptGap(ws, id);
          return;
        }
        const messages = getEffectiveHistory(id);
        ws.send(JSON.stringify({
          type: 'history',
          session: id,
          request_id: msg.request_id || null,
          messages,
          partial: false,
          total_messages: messages.length,
          loaded_messages: messages.length,
          mode: 'full',
        }));
        clearBrowserTranscriptGap(ws, id);
      }

    // ── Send message (A2-01, A2-03) ────────────────────────────────────────
    // Supports both old (send) and new (send_message) shapes.
    } else if (t === 'send' || t === 'send_message') {
      // Per-principal send rate limit: reconnecting must not reset the cap.
      const sendRate = browserSendRateLimit.consume(clientPrincipal);
      if (!sendRate.ok) {
        const clientIp = req.socket?.remoteAddress || 'unknown';
        log('warn', 'rate-limit', 'Principal send rate limit exceeded', {
          session: msg.session || msg.session_id,
          principal: clientPrincipal,
          ip: clientIp,
        });
        ws.send(JSON.stringify({
          type: 'error',
          code: 'rate_limited',
          message: `Send rate limit exceeded (${RATE_LIMIT_MAX} per ${RATE_LIMIT_MS / 1000} s)`,
          retry_after_ms: sendRate.retryAfterMs,
        }));
        return;
      }

      const id          = msg.session || msg.session_id;
      const content     = msg.content;
      const clientMsgId = msg.client_message_id || null;

      // Validate session_id (A8-01)
      if (!isValidSessionId(id)) {
        log('warn', 'send', 'Invalid or missing session_id — dropped', { session: id });
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_message', message: 'send requires a valid session_id' }));
        return;
      }

      // Validate content (A8-01)
      if (typeof content !== 'string' || content.length === 0) {
        if (clientMsgId) {
          ws.send(JSON.stringify({
            type:              'message_failed',
            session:           id,
            client_message_id: clientMsgId,
            reason:            'send requires a non-empty content string',
          }));
        }
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_message', message: 'send requires a non-empty content string' }));
        return;
      }
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > MAX_CONTENT_BYTES) {
        const detail = `content exceeds ${Math.round(MAX_CONTENT_BYTES / 1024)} KB limit`;
        if (clientMsgId) {
          ws.send(JSON.stringify({
            type:              'message_failed',
            session:           id,
            client_message_id: clientMsgId,
            reason:            detail,
          }));
        }
        ws.send(JSON.stringify({ type: 'error', code: 'message_too_large', message: detail }));
        return;
      }

      // A client-generated cid is the durable message identity. Ordinary
      // reconnect/replay is read-only. An explicit retry may start a new
      // delivery attempt only after the durable terminal receipt proves that
      // the prior attempt was retryable and never reached native.
      const existingSend = clientMsgId ? (stmtGetSendReceipt.get(clientMsgId) || stmtGetByClientId.get(clientMsgId)) : null;
      let retryCandidate = null;
      if (existingSend) {
        if (existingSend.session !== id) {
          ws.send(JSON.stringify({
            type: 'message_failed',
            session: id,
            client_message_id: clientMsgId,
            reason: 'client_message_id belongs to a different session',
            error: { code: 'client_message_id_session_mismatch' },
          }));
          return;
        }
        if (existingSend.content !== content) {
          ws.send(JSON.stringify({
            type: 'message_failed',
            session: id,
            client_message_id: clientMsgId,
            reason: 'client_message_id content does not match the durable message',
            error: { code: 'client_message_id_content_mismatch' },
          }));
          return;
        }
        const explicitRetry = msg.retry_failed === true || msg.retry_delivery === true;
        if (explicitRetry && isSafeFailedSendRetry(existingSend)) {
          retryCandidate = existingSend;
        } else {
          ws.send(JSON.stringify({
          type: 'message_accepted',
          session: id,
          client_message_id: clientMsgId,
          server_message_id: existingSend.id,
          sequence: existingSend.sequence,
          ts: existingSend.ts,
          created_at: new Date(Number(existingSend.ts || 0) * 1000).toISOString(),
          status: existingSend.status || 'accepted',
          accepted_at: existingSend.accepted_at || null,
          launch_accepted_at: existingSend.launch_accepted_at || null,
          delivered_at: existingSend.delivered_at || null,
          agent_started_at: existingSend.agent_started_at || null,
          native_receipt: deserializeNativeReceipt(existingSend.native_receipt),
          process_epoch: existingSend.process_epoch || null,
          failure_code: existingSend.failure_code || null,
          failure_reason: existingSend.failure_reason || null,
          failure_native_attempted: existingSend.failure_native_attempted == null
            ? null
            : Number(existingSend.failure_native_attempted) === 1,
          failure_retryable: existingSend.failure_retryable == null
            ? null
            : Number(existingSend.failure_retryable) === 1,
          delivery_attempt: Math.max(1, Number(existingSend.delivery_attempt) || 1),
          ...latestVisibleMessageProjection(id),
          replayed: true,
          retry_rejected: explicitRetry ? 'retry_not_proven_safe' : null,
        }));
          log('info', 'send', 'Idempotent client replay acknowledged without native redispatch', {
            session: id,
            cid: clientMsgId,
            status: existingSend.status,
            explicit_retry: explicitRetry,
          });
          return;
        }
      }

      const proxyWs = proxySockets.get(id);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        log('warn', 'send', 'Session not connected', { session: id });
        ws.send(JSON.stringify({
          type:              'message_failed',
          session:           id,
          client_message_id: clientMsgId,
          reason:            `Session ${id} not connected`,
        }));
        return;
      }

      // Attach file data if the message references an uploaded file
      const clientMessageTs = proxyMessageTimestampSeconds(msg);
      let messageTs = retryCandidate?.ts
        || (clientMessageTs > 0 ? clientMessageTs : Date.now() / 1000);
      let createdAt = new Date(messageTs * 1000).toISOString();
      let deliveryAttempt = retryCandidate
        ? Math.max(1, Number(retryCandidate.delivery_attempt) || 1) + 1
        : 1;
      const relayLatencyTrace = registerBrowserLatencyTrace(
        msg.latency_trace,
        id,
        clientMsgId,
        clientMessageReceivedAtMs,
      );
      const proxyMsg = {
        ...msg,
        type: 'send',
        session: id,
        created_at: createdAt,
        ts: messageTs,
        ...(clientMsgId ? { delivery_attempt: deliveryAttempt } : {}),
        ...(relayLatencyTrace ? { latency_trace: relayLatencyTrace } : {}),
      };
      const fileMatch = content && (
        content.match(/\[File: ([^\]]+)\]\(\/uploads\/([^)]+)\)/)
        || content.match(/!\[([^\]]*)\]\(\/uploads\/([^)]+)\)/)
      );
      if (fileMatch) {
        const [, originalNameRaw, storedName] = fileMatch;
        const originalName = originalNameRaw || storedName;
        const uploadReference = resolveUploadReference(UPLOAD_DIR, storedName);
        if (!uploadReference.ok) {
          if (relayLatencyTrace) {
            terminalizeActiveLatencyTrace(relayLatencyTrace.trace_id, 'send_failed');
          }
          ws.send(JSON.stringify({
            type: 'message_failed',
            session: id,
            client_message_id: clientMsgId,
            reason: 'The attachment reference is invalid',
            error: { code: 'invalid_attachment_reference' },
          }));
          return;
        }
        try {
          const fileData = fs.readFileSync(uploadReference.path);
          proxyMsg.file = { originalName, storedName, data: fileData.toString('base64') };
          const fk = `${id}:${originalName}`;
          recentFileSends.set(fk, Date.now());
          setTimeout(() => recentFileSends.delete(fk), 15_000);
        } catch (e) {
          log('error', 'relay', 'Could not read file for proxy', { err: e.message });
        }
      }

      // Persist user message — idempotent when client_message_id provided (A2-03)
      const seq = retryCandidate ? Number(retryCandidate.sequence || 0) : nextSeq(id);
      let serverId, finalSeq = seq;
      try {
        if (retryCandidate) {
          const acceptedAt = new Date().toISOString();
          const retryStarted = beginSafeSendRetry(clientMsgId, id, acceptedAt);
          if (!retryStarted.ok) {
            ws.send(JSON.stringify({
              type: 'message_failed',
              session: id,
              client_message_id: clientMsgId,
              reason: 'The prior delivery attempt is not proven safe to retry',
              error: { code: retryStarted.code },
            }));
            return;
          }
          const row = retryStarted.row;
          deliveryAttempt = retryStarted.delivery_attempt;
          proxyMsg.delivery_attempt = deliveryAttempt;
          serverId = row.id;
          finalSeq = row.sequence;
          if (row.ts) messageTs = row.ts;
        } else if (clientMsgId) {
          insertMessageIdempotent(id, 'user', content, clientMsgId, 'accepted', seq, messageTs);
          const acceptedAt = new Date().toISOString();
          stmtMarkMessageAccepted.run(acceptedAt, clientMsgId);
          const row = stmtGetByClientId.get(clientMsgId);
          if (row) {
            serverId = row.id;
            finalSeq = row.sequence;
            if (row.ts) messageTs = row.ts;
          }
          stmtInsertSendReceipt.run(clientMsgId, id, serverId, finalSeq, messageTs, acceptedAt, content, acceptedAt);
          stmtInsertSendAttempt.run(clientMsgId, 1, id, acceptedAt, acceptedAt);
        } else {
          const info = insertMessage(id, 'user', content, null, 'recorded', seq, messageTs);
          serverId = info.lastInsertRowid;
        }
      } catch (e) {
        if (relayLatencyTrace) {
          terminalizeActiveLatencyTrace(relayLatencyTrace.trace_id, 'send_failed');
        }
        log('error', 'db', 'User message insert failed', { session: id, err: e.message });
        ws.send(JSON.stringify({
          type: 'message_failed',
          session: id,
          client_message_id: clientMsgId,
          reason: 'Relay could not durably record the send before native dispatch',
          error: { code: 'receipt_journal_write_failed' },
        }));
        return;
      }
      createdAt = new Date(messageTs * 1000).toISOString();

      try {
        proxyWs.send(JSON.stringify(proxyMsg));
      } catch (error) {
        if (relayLatencyTrace) {
          terminalizeActiveLatencyTrace(relayLatencyTrace.trace_id, 'send_failed');
        }
        if (clientMsgId) {
          persistSendLifecycle({
            type: 'proxy_send_result',
            session_id: id,
            client_message_id: clientMsgId,
            delivery_attempt: deliveryAttempt,
            result: 'failed',
            error: {
              code: 'relay_proxy_forward_failed',
              message: 'Relay could not forward the accepted message to the proxy',
              retryable: true,
              native_attempted: false,
            },
          });
        }
        ws.send(JSON.stringify({
          type: 'message_failed',
          session: id,
          client_message_id: clientMsgId,
          reason: 'Relay could not forward the accepted message to the proxy',
          delivery_attempt: deliveryAttempt,
          error: {
            code: 'relay_proxy_forward_failed',
            retryable: true,
            native_attempted: false,
          },
        }));
        return;
      }

      // Register for dedup suppression (proxy will scrape this back)
      const key = `${id}:${content}`;
      recentBrowserSends.set(key, Date.now());
      setTimeout(() => recentBrowserSends.delete(key), BROWSER_ECHO_DEDUP_WINDOW_SEC * 1000);

      // Ack to the sending browser
      const acceptedState = clientMsgId
        ? (stmtGetSendReceipt.get(clientMsgId) || stmtGetByClientId.get(clientMsgId))
        : null;
      const acceptedFrame = {
        type:              'message_accepted',
        session:           id,
        client_message_id: clientMsgId,
        server_message_id: serverId,
        sequence:          finalSeq,
        ts:                messageTs,
        created_at:        createdAt,
        status:            clientMsgId ? 'accepted' : 'recorded',
        accepted_at:       acceptedState?.accepted_at || null,
        delivery_attempt:  clientMsgId ? deliveryAttempt : null,
        retry_restarted:   Boolean(retryCandidate),
        ...latestVisibleMessageProjection(id),
      };
      ws.send(JSON.stringify(acceptedFrame));

      // Broadcast to all browsers (including other tabs)
      if (retryCandidate) {
        broadcastToBrowsers(acceptedFrame);
      } else {
        broadcastToBrowsers({
          type:              'message',
          session:           id,
          role:              'user',
          content,
          client_message_id: clientMsgId,
          status:            clientMsgId ? 'accepted' : 'recorded',
          delivery_attempt:  clientMsgId ? deliveryAttempt : null,
          sequence:          finalSeq,
          server_message_id: serverId,
          ts:                messageTs,
          created_at:        createdAt,
          ...latestVisibleMessageProjection(id),
        });
      }

    // ── Steer (inject text into Codex input without sending) ───────────────
    } else if (t === 'steer') {
      const id = msg.session_id || msg.session;
      const proxyWs = proxySockets.get(id);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'steer_result', session_id: id, client_message_id: msg.client_message_id, result: 'failed', error: 'Session not connected' }));
        return;
      }
      proxyWs.send(JSON.stringify(msg));
      log('info', 'send', 'Steer request forwarded', { session: id, cid: msg.client_message_id });

    // ── Queue management (discard/edit queued messages) ───────────────────
    } else if (t === 'discard_queued' || t === 'edit_queued') {
      const validation = validateQueueControlMessage(msg, MAX_CONTENT_BYTES);
      if (!validation.ok) {
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_message', message: validation.error }));
        return;
      }
      const id = validation.sessionId;
      const proxyWs = proxySockets.get(id);
      if (proxyWs && proxyWs.readyState === WebSocket.OPEN) proxyWs.send(JSON.stringify(msg));

    // ── Launch session (A2-08) ─────────────────────────────────────────────
    } else if (t === 'launch_session') {
      const requestId = msg.request_id;
      const agentType = msg.agent_type;
      const ownedDisposable = msg.owned_disposable;

      if (!requestId || !agentType) {
        ws.send(JSON.stringify({
          type:             'connection_error',
          protocol_version: PROTOCOL_VERSION,
          code:             'invalid_message',
          message:          'launch_session requires request_id and agent_type',
        }));
        return;
      }
      if (ownedDisposable != null && (
        agentType !== 'codex_cli'
        || ownedDisposable.scope !== 'latency_trace_sampler_v1'
        || !/^[a-f0-9]{64}$/i.test(String(ownedDisposable.token || ''))
        || String(msg.workspace_path || '').replace(/\//g, '\\').toLowerCase()
          !== 'c:\\temp\\remote-agent-vscode-test'
      )) {
        ws.send(JSON.stringify({
          type:             'session_launch_failed',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          agent_type:       agentType,
          error_code:       'invalid_owned_disposable_capability',
          reason:           'Owned-disposable launch capability is invalid',
          server_ts:        new Date().toISOString(),
        }));
        return;
      }

      const proxyWs = getProxySocket();
      if (!proxyWs) {
        ws.send(JSON.stringify({
          type:             'session_launch_failed',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          agent_type:       agentType,
          error_code:       'no_proxy_connected',
          reason:           'No agent proxy is currently connected',
          server_ts:        new Date().toISOString(),
        }));
        return;
      }

      const launchedAt = new Date().toISOString();
      const timeoutAt  = new Date(Date.now() + LAUNCH_TIMEOUT_MS).toISOString();
      const timer = setTimeout(
        () => cancelPendingLaunch(requestId, 'launch_timeout', 'Agent did not appear within the timeout window'),
        LAUNCH_TIMEOUT_MS
      );
      pendingLaunches.set(requestId, {
        agent_type:     agentType,
        workspace_path: msg.workspace_path || null,
        model_id:       msg.model_id || null,
        collaboration_mode: msg.collaboration_mode || null,
        launched_at:    launchedAt,
        timeout_at:     timeoutAt,
        browser_ws:     ws,
        timer,
      });

      // Forward to proxy
      proxyWs.send(JSON.stringify({
        type:             'launch_session',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        agent_type:       agentType,
        ...(msg.workspace_path ? { workspace_path: msg.workspace_path } : {}),
        ...(msg.window_title   ? { window_title:   msg.window_title   } : {}),
        ...(msg.model_id       ? { model_id:       msg.model_id       } : {}),
        ...(msg.permission_mode ? { permission_mode: msg.permission_mode } : {}),
        ...(msg.effort         ? { effort:         msg.effort         } : {}),
        ...(msg.cli_session_id ? { cli_session_id: msg.cli_session_id } : {}),
        ...(msg.collaboration_mode ? { collaboration_mode: msg.collaboration_mode } : {}),
        ...(ownedDisposable ? {
          owned_disposable: {
            scope: ownedDisposable.scope,
            token: String(ownedDisposable.token).toLowerCase(),
          },
        } : {}),
      }));

      // Intermediate ack to the requesting browser
      ws.send(JSON.stringify({
        type:             'session_launching',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        agent_type:       agentType,
        server_ts:        launchedAt,
      }));
      log('info', 'launch', 'Session launch requested', { request_id: requestId, agent_type: agentType });

    // ── Resume session — launch new agent and replay old history ─────────
    // The browser sends { type: 'resume_session', source_session, agent_type, request_id }
    // We launch a fresh agent, then once it's up, replay the old messages.
    } else if (t === 'resume_session') {
      const sourceSession = msg.source_session;
      const agentType     = msg.agent_type || 'claude';
      const requestId     = msg.request_id;

      if (!requestId || !sourceSession) {
        ws.send(JSON.stringify({
          type: 'connection_error', protocol_version: PROTOCOL_VERSION,
          code: 'invalid_message', message: 'resume_session requires request_id and source_session',
        }));
        return;
      }

      // Verify source session has messages — or a native CLI id we can reopen.
      const oldMessages = getHistoryRows(sourceSession);
      const sourceMeta = stmtGetSessionMeta.get(sourceSession);
      const cliSessionId = msg.cli_session_id || sourceMeta?.cli_session_id || null;
      if (oldMessages.length === 0 && !cliSessionId) {
        ws.send(JSON.stringify({
          type: 'session_launch_failed', protocol_version: PROTOCOL_VERSION,
          request_id: requestId, agent_type: agentType,
          error_code: 'no_history', reason: 'Source session has no message history',
          server_ts: new Date().toISOString(),
        }));
        return;
      }

      // Tag this launch as a resume so we can replay history after ack
      const proxyWs = getProxySocket();
      if (!proxyWs) {
        ws.send(JSON.stringify({
          type: 'session_launch_failed', protocol_version: PROTOCOL_VERSION,
          request_id: requestId, agent_type: agentType,
          error_code: 'no_proxy_connected', reason: 'No agent proxy is currently connected',
          server_ts: new Date().toISOString(),
        }));
        return;
      }

      const launchedAt = new Date().toISOString();
      const timer = setTimeout(
        () => cancelPendingLaunch(requestId, 'launch_timeout', 'Agent did not appear within the timeout window'),
        LAUNCH_TIMEOUT_MS
      );
      pendingLaunches.set(requestId, {
        agent_type:      agentType,
        workspace_path:  msg.workspace_path || sourceMeta?.workspace_path || null,
        launched_at:     launchedAt,
        timeout_at:      new Date(Date.now() + LAUNCH_TIMEOUT_MS).toISOString(),
        browser_ws:      ws,
        timer,
        // Resume metadata — the session_launch_ack handler copies old messages
        resume_source:   sourceSession,
        resume_messages: oldMessages,
        cli_session_id:  cliSessionId,
      });

      proxyWs.send(JSON.stringify({
        type: 'launch_session', protocol_version: PROTOCOL_VERSION,
        request_id: requestId, agent_type: agentType,
        ...(msg.workspace_path || sourceMeta?.workspace_path
          ? { workspace_path: msg.workspace_path || sourceMeta.workspace_path }
          : {}),
        ...(msg.model_id ? { model_id: msg.model_id } : {}),
        ...(msg.permission_mode ? { permission_mode: msg.permission_mode } : {}),
        ...(cliSessionId ? { cli_session_id: cliSessionId } : {}),
        resume_source_session: sourceSession,
      }));

      ws.send(JSON.stringify({
        type: 'session_launching', protocol_version: PROTOCOL_VERSION,
        request_id: requestId, agent_type: agentType, server_ts: launchedAt,
      }));
      log('info', 'launch', 'Resume session requested', { request_id: requestId, source: sourceSession, agent_type: agentType });

    // ── Close session (A2-08) ──────────────────────────────────────────────
    } else if (t === 'close_session') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const destroyOwnedDisposable = msg.destroy_owned_disposable;

      if (!sessionId) return;
      if (destroyOwnedDisposable != null && (
        destroyOwnedDisposable.scope !== 'latency_trace_sampler_v1'
        || !/^[a-f0-9]{64}$/i.test(String(destroyOwnedDisposable.token || ''))
      )) {
        ws.send(JSON.stringify({
          type:             'connection_error',
          protocol_version: PROTOCOL_VERSION,
          code:             'invalid_owned_disposable_capability',
          message:          'Owned-disposable cleanup capability is invalid',
          request_id:       requestId,
        }));
        return;
      }

      const proxyWs = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'connection_error',
          protocol_version: PROTOCOL_VERSION,
          code:             'session_unknown',
          message:          `Session ${sessionId} is not currently connected`,
        }));
        return;
      }

      proxyWs.send(JSON.stringify({
        type:             'close_session',
        protocol_version: PROTOCOL_VERSION,
        session_id:       sessionId,
        request_id:       requestId,
        ...(destroyOwnedDisposable ? {
          destroy_owned_disposable: {
            scope: destroyOwnedDisposable.scope,
            token: String(destroyOwnedDisposable.token).toLowerCase(),
          },
        } : {}),
      }));
      log('info', 'close', 'Session close requested', { session: sessionId, request_id: requestId });

    // ── Dismiss session (remove from relay without proxy) ─────────────────
    // Lets the browser ✕ button remove orphaned / disconnected sessions from
    // the sidebar even when the proxy has no active socket for that session.
    } else if (t === 'dismiss_session') {
      const sessionId = msg.session_id || msg.session;
      if (!sessionId) return;
      proxySockets.delete(sessionId);
      sessionProxyId.delete(sessionId);
      sessionMeta.delete(sessionId);
      sessionHealth.delete(sessionId);
      sessionLastSeen.delete(sessionId);
      sessionSeq.delete(sessionId);
      sessionActivity.delete(sessionId);
      clearQueuedSessionStatus(sessionId);
      clearSessionAuxiliaryState(sessionId);
      removeQuestionPromptsForSession(sessionId);
      log('info', 'dismiss', 'Session dismissed by browser', { session: sessionId });
      queueSessionListBroadcast();

    // ── Permission response (A2-07) ────────────────────────────────────────
    } else if (t === 'question_response') {
      const sessionId = msg.session_id || msg.session;
      const proxyWs = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        questionControlFailure(ws, msg, 'no_proxy_connected', 'The native question adapter is not connected.');
        return;
      }
      let claimed;
      if (msg.request_id && pendingCtrlReqs.has(msg.request_id)) {
        questionControlFailure(ws, msg, 'duplicate_request_id', 'This control request ID is already in flight.');
        return;
      }
      try {
        claimed = questionPromptRegistry.claim({ ...msg, session_id: sessionId });
      } catch (error) {
        const code = error instanceof QuestionPromptRegistryError ? error.code : 'invalid_question_response';
        if (code === 'prompt_expired') {
          publishQuestionPromptState(questionPromptRegistry.get(sessionId, msg.prompt_id));
        }
        questionControlFailure(ws, msg, code, error?.message || 'Question response did not match the open prompt.');
        return;
      }
      publishQuestionPrompt(claimed.prompt);
      if (msg.request_id) pendingCtrlReqs.set(msg.request_id, ws);
      try {
        proxyWs.send(JSON.stringify({
          ...claimed.response,
          type: 'question_response',
          protocol_version: PROTOCOL_VERSION,
          request_id: msg.request_id,
        }));
        questionPromptRegistry.markForwarded(msg.request_id);
        log('info', 'question', 'Question response claimed and forwarded', {
          session: sessionId,
          prompt_id: msg.prompt_id,
          request_id: msg.request_id,
        });
      } catch (error) {
        pendingCtrlReqs.delete(msg.request_id);
        const failed = questionPromptRegistry.resolve(msg.request_id, {
          ok: false,
          errorCode: 'proxy_send_failed',
          error: 'The native question adapter disconnected before accepting the response.',
          retryable: true,
        });
        publishQuestionPromptState(failed);
        questionControlFailure(ws, msg, 'proxy_send_failed', 'The native question adapter did not accept the response.');
      }

    } else if (t === 'permission_response') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      const key       = `${sessionId}:${promptId}`;
      const entry     = pendingPrompts.get(key);
      if (!entry) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       msg.request_id,
          session_id:       sessionId,
          command:          'permission_response',
          result:           'failed',
          error:            { code: 'prompt_not_found', message: `No open prompt: ${promptId}` },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      const choiceId = typeof msg.choice_id === 'string' ? msg.choice_id.trim() : '';
      const hasChoice = !!choiceId;
      const hasAnswers = msg.answers !== undefined;
      const hasInstruction = msg.instruction !== undefined;
      if (Number(hasChoice) + Number(hasAnswers) + Number(hasInstruction) !== 1) {
        ws.send(JSON.stringify({
          type: 'agent_control_result', protocol_version: PROTOCOL_VERSION,
          request_id: msg.request_id, session_id: sessionId,
          command: 'permission_response', result: 'failed',
          error: { code: 'invalid_permission_response', message: 'Choose one permission response shape.' },
          server_ts: new Date().toISOString(),
        }));
        return;
      }
      if (hasChoice && !(entry.prompt.choices || []).some(choice => choice?.choice_id === choiceId)) {
        ws.send(JSON.stringify({
          type: 'agent_control_result', protocol_version: PROTOCOL_VERSION,
          request_id: msg.request_id, session_id: sessionId,
          command: 'permission_response', result: 'failed',
          error: { code: 'invalid_permission_choice', message: 'Permission choice did not match the open prompt.' },
          server_ts: new Date().toISOString(),
        }));
        return;
      }
      let normalizedAnswers = null;
      if (hasAnswers) {
        const answerResult = normalizeQuestionAnswers(entry.prompt, msg.answers);
        if (!answerResult.ok) {
          ws.send(JSON.stringify({
            type: 'agent_control_result', protocol_version: PROTOCOL_VERSION,
            request_id: msg.request_id, session_id: sessionId,
            command: 'permission_response', result: 'failed',
            error: { code: 'invalid_question_answers', message: 'Question answers did not match the open prompt.' },
            server_ts: new Date().toISOString(),
          }));
          return;
        }
        normalizedAnswers = answerResult.answers;
      }
      let normalizedInstruction = null;
      if (hasInstruction) {
        normalizedInstruction = typeof msg.instruction === 'string' ? msg.instruction.trim() : '';
        if (!entry.prompt.alternate_instruction_supported || !normalizedInstruction || normalizedInstruction.length > 2000) {
          ws.send(JSON.stringify({
            type: 'agent_control_result', protocol_version: PROTOCOL_VERSION,
            request_id: msg.request_id, session_id: sessionId,
            command: 'permission_response', result: 'failed',
            error: { code: 'invalid_permission_instruction', message: 'Alternate instruction is unavailable or invalid.' },
            server_ts: new Date().toISOString(),
          }));
          return;
        }
      }
      const proxyWs = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       msg.request_id,
          session_id:       sessionId,
          command:          'permission_response',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Proxy not connected' },
          server_ts:        new Date().toISOString(),
        }));
        entry.prompt = {
          ...entry.prompt,
          submitting_choice_id: null,
          error: 'Session not connected',
        };
        broadcastToBrowsers(entry.prompt);
        return;
      }
      entry.prompt = {
        ...entry.prompt,
        submitting_choice_id: choiceId || (normalizedAnswers ? 'question_answers' : (normalizedInstruction ? 'alternate_instruction' : null)),
        error: null,
      };
      broadcastToBrowsers(entry.prompt);
      if (msg.request_id) pendingCtrlReqs.set(msg.request_id, ws);
      if (msg.request_id) pendingPromptResponses.set(msg.request_id, {
        key,
        sessionId,
        promptId,
        choiceId: choiceId || null,
        answers: normalizedAnswers,
        instruction: !!normalizedInstruction,
      });
      proxyWs.send(JSON.stringify({
        ...msg,
        ...(hasChoice ? { choice_id: choiceId } : {}),
        ...(normalizedAnswers ? { answers: normalizedAnswers } : {}),
        ...(normalizedInstruction ? { instruction: normalizedInstruction } : {}),
        type: 'permission_response',
      }));
      log('info', 'prompt', 'Permission response forwarded', {
        session: sessionId, prompt_id: promptId, choice: choiceId || null,
        answers: normalizedAnswers?.length || 0, instruction: !!normalizedInstruction,
      });

    // ── Session error prompt action ───────────────────────────────────────
    } else if (t === 'error_prompt_action') {
      const sessionId = msg.session_id || msg.session;
      const promptId  = msg.prompt_id;
      const key       = `${sessionId}:${promptId}`;
      const entry     = pendingErrorPrompts.get(key);
      if (!entry) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       msg.request_id,
          session_id:       sessionId,
          command:          'error_prompt_action',
          result:           'failed',
          error:            { code: 'prompt_not_found', message: `No open error prompt: ${promptId}` },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      const operatorActionProof = msg.action_id === 'open_native_window'
        ? relayOperatorActionProof(ws, req, msg, 'open_native_window')
        : null;
      if (msg.action_id === 'open_native_window' && !operatorActionProof) {
        rejectOperatorActionOnly(ws, msg, 'error_prompt_action');
        return;
      }
      const proxyWs = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       msg.request_id,
          session_id:       sessionId,
          command:          'error_prompt_action',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Proxy not connected' },
          server_ts:        new Date().toISOString(),
        }));
        entry.prompt = {
          ...entry.prompt,
          submitting_action_id: null,
          error: 'Session not connected',
        };
        broadcastToBrowsers(entry.prompt);
        return;
      }
      entry.prompt = {
        ...entry.prompt,
        submitting_action_id: msg.action_id || null,
        error: null,
      };
      broadcastToBrowsers(entry.prompt);
      if (msg.request_id) pendingCtrlReqs.set(msg.request_id, ws);
      if (msg.request_id) pendingErrorPromptResponses.set(msg.request_id, {
        key,
        sessionId,
        promptId,
        actionId: msg.action_id || null,
      });
      proxyWs.send(JSON.stringify({
        ...msg,
        type: 'error_prompt_action',
        ...(operatorActionProof ? { operator_action_proof: operatorActionProof } : {}),
      }));
      log('info', 'prompt', 'Error prompt action forwarded', { session: sessionId, prompt_id: promptId, action: msg.action_id });

    // ── Agent interrupt (A2-07) ────────────────────────────────────────────
    } else if (t === 'agent_interrupt' || t === 'agent_goal_control') {
      forwardExactlyOnceControl(ws, msg, t);
      log('info', 'ctrl', `${t} accepted for validation`, {
        session: msg.session_id || msg.session,
        request_id: msg.request_id,
      });

    // ── Agent config request (A2-07) ───────────────────────────────────────
    } else if (t === 'agent_config_request') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      // Reply from cache immediately so UI populates without waiting for proxy round-trip
      const cached = agentConfigs.get(sessionId);
      if (cached) ws.send(JSON.stringify({ ...cached, request_id: requestId }));
      // Also forward to proxy for a fresh read
      const proxyWs = proxySockets.get(sessionId);
      if (proxyWs && proxyWs.readyState === WebSocket.OPEN) {
        if (requestId) pendingCtrlReqs.set(requestId, ws);
        proxyWs.send(JSON.stringify({
          type:             'agent_config_request',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
        }));
      }

    // ── Agent set model (A2-07) ────────────────────────────────────────────
    } else if (t === 'agent_set_model') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'agent_set_model',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'agent_set_model',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        model_id:         msg.model_id,
      }));
      log('info', 'ctrl', 'Set model forwarded', { session: sessionId, model: msg.model_id, request_id: requestId });

    // ── Agent set permission mode ──────────────────────────────────────────
    } else if (t === 'agent_set_effort') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'agent_set_effort',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'agent_set_effort',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        effort:           msg.effort,
      }));
      log('info', 'ctrl', 'Set effort forwarded', { session: sessionId, effort: msg.effort, request_id: requestId });

    } else if (t === 'agent_set_permission_mode') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'agent_set_permission_mode',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'agent_set_permission_mode',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        mode:             msg.mode,
      }));
      log('info', 'ctrl', 'Set permission mode forwarded', { session: sessionId, mode: msg.mode, request_id: requestId });

    } else if (t === 'agent_set_auto_approve_permissions') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'agent_set_auto_approve_permissions',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'agent_set_auto_approve_permissions',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        enabled:          msg.enabled === true,
      }));
      log('info', 'ctrl', 'Set auto-approve forwarded', { session: sessionId, enabled: msg.enabled === true, request_id: requestId });

    // ── Codex config change ────────────────────────────────────────────────
    } else if (t === 'set_codex_config') {
      const validation = validateCodexConfigControlMessage(msg);
      const sessionId = validation.sessionId || msg.session_id || msg.session;
      const requestId = validation.requestId || msg.request_id;
      if (!validation.ok) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'set_codex_config',
          result:           'failed',
          error:            { code: 'invalid_message', message: validation.error },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      const priorBinding = codexControlRequestBindings.get(requestId);
      if (priorBinding && priorBinding.fingerprint !== validation.fingerprint) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'set_codex_config',
          result:           'failed',
          error:            { code: 'duplicate_request_conflict', message: 'This request id is already bound to a different Codex config intent.' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'set_codex_config',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      setBoundedMap(codexControlRequestBindings, requestId, priorBinding || {
        fingerprint: validation.fingerprint,
        sessionId,
        createdAt: Date.now(),
      });
      let waiters = codexControlRequestWaiters.get(requestId);
      if (!waiters) {
        waiters = new Set();
        codexControlRequestWaiters.set(requestId, waiters);
      }
      waiters.add(ws);
      if (requestId && !pendingCtrlReqs.has(requestId)) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'set_codex_config',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        model_id:         msg.model_id,
        effort:           msg.effort,
        speed:            msg.speed,
        access_mode:      msg.access_mode,
        permission_profile: msg.permission_profile,
        confirm_bypass:   msg.confirm_bypass === true,
        source_revision:  msg.source_revision,
      }));
      log('info', 'ctrl', 'Set codex config forwarded', { session: sessionId, request_id: requestId });

    // ── Panel/agent control commands (Epics 2, 3, 4, 9) ──────────────────
    } else if (t === 'new_thread' || t === 'open_panel' || t === 'open_native_window' || t === 'chat_list' || t === 'switch_chat' || t === 'new_chat' || t === 'thread_list' || t === 'switch_thread' || t === 'switch_workspace' || t === 'terminal_output' || t === 'file_changes' || t === 'file_change_response' || t === 'send_attachment' || t === 'terminal_input' || t === 'branch_list' || t === 'switch_branch' || t === 'create_branch' || t === 'skill_list' || t === 'automation_view_action' || t === 'list_directory' || t === 'read_file') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const operatorActionProof = t === 'open_native_window'
        ? relayOperatorActionProof(ws, req, msg, 'open_native_window')
        : null;
      if (t === 'open_native_window' && !operatorActionProof) {
        rejectOperatorActionOnly(ws, msg, 'open_native_window');
        return;
      }
      const navigationEpoch = NAVIGATION_CONTROL_TYPES.has(t)
        ? navigationEpochs.issue(sessionId)
        : 0;
      if (navigationEpoch && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'navigation_started',
          protocol_version: PROTOCOL_VERSION,
          request_id: requestId,
          session_id: sessionId,
          command: t,
          navigation_epoch: navigationEpoch,
          server_ts: new Date().toISOString(),
        }));
      }
      if (t === 'list_directory' || t === 'read_file') {
        const validation = validateWorkspaceControlMessage(msg);
        if (!validation.ok) {
          ws.send(JSON.stringify({
            type: 'agent_control_result', protocol_version: PROTOCOL_VERSION,
            request_id: requestId, session_id: sessionId, command: t, result: 'failed',
            error: { code: 'invalid_message', message: validation.error },
            server_ts: new Date().toISOString(),
          }));
          return;
        }
      }
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          t,
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          ...(navigationEpoch ? { navigation_epoch: navigationEpoch } : {}),
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) {
        pendingCtrlReqs.set(requestId, ws);
        if (t === 'list_directory' || t === 'read_file') {
          pendingPayloadCtrlState.set(requestId, { payloadSeen: false, ackSeen: false });
        }
      }
      proxyWs.send(JSON.stringify({
        type:             t,
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        ...(operatorActionProof ? { operator_action_proof: operatorActionProof } : {}),
        session_id:       sessionId,
        ...(msg.chat_id ? { chat_id: msg.chat_id } : {}),
        ...(msg.thread_id ? { thread_id: msg.thread_id } : {}),
        ...(msg.folder_path ? { folder_path: msg.folder_path } : {}),
        ...(msg.branch_name ? { branch_name: msg.branch_name } : {}),
        ...(msg.text != null ? { text: msg.text } : {}),
        ...(msg.path != null ? { path: msg.path } : {}),
        ...(msg.max_size != null ? { max_size: msg.max_size } : {}),
        ...(msg.data != null ? { data: msg.data } : {}),
        ...(msg.mime_type != null ? { mime_type: msg.mime_type } : {}),
        ...(msg.filename != null ? { filename: msg.filename } : {}),
        ...(msg.change_id != null ? { change_id: msg.change_id } : {}),
        ...(msg.action != null ? { action: msg.action } : {}),
        ...(navigationEpoch ? { navigation_epoch: navigationEpoch } : {}),
      }));
      log('info', 'ctrl', `${t} forwarded`, {
        session: sessionId,
        request_id: requestId,
        ...(navigationEpoch ? { navigation_epoch: navigationEpoch } : {}),
      });

    // ── Automations CRUD over WebSocket (bypasses Cloudflare Access) ──────
    } else if (t === 'automations_list') {
      try {
        const rows = stmtListAutomations.all();
        const automations = rows.map(r => ({
          ...r,
          enabled: !!r.enabled,
          cron_days: r.cron_days ? r.cron_days.split(',').map(Number) : [1,2,3,4,5],
        }));
        ws.send(JSON.stringify({ type: 'automations_list', automations }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'automations_error', error: e.message }));
      }

    } else if (t === 'automations_create') {
      const { name, description, category, prompt, schedule, cron_hour, cron_minute, cron_days, target_agent_type, target_session, enabled } = msg;
      if (!name || !prompt) {
        ws.send(JSON.stringify({ type: 'automations_error', error: 'name and prompt are required' }));
        return;
      }
      try {
        const info = stmtInsertAutomation.run(
          name, description || '', category || 'General', prompt,
          schedule || 'daily', cron_hour ?? 9, cron_minute ?? 0,
          Array.isArray(cron_days) ? cron_days.join(',') : (cron_days || '1,2,3,4,5'),
          target_agent_type || 'claude', target_session || null,
          enabled !== false ? 1 : 0
        );
        const row = stmtGetAutomation.get(info.lastInsertRowid);
        ws.send(JSON.stringify({ type: 'automations_created', automation: { ...row, enabled: !!row.enabled, cron_days: row.cron_days.split(',').map(Number) } }));
        log('info', 'automations', 'Created via WS', { id: row.id, name: row.name });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'automations_error', error: e.message }));
      }

    } else if (t === 'automations_update') {
      const { id } = msg;
      const existing = stmtGetAutomation.get(id);
      if (!existing) { ws.send(JSON.stringify({ type: 'automations_error', error: 'Not found' })); return; }
      try {
        stmtUpdateAutomation.run(
          msg.name ?? existing.name, msg.description ?? existing.description, msg.category ?? existing.category,
          msg.prompt ?? existing.prompt, msg.schedule ?? existing.schedule,
          msg.cron_hour ?? existing.cron_hour, msg.cron_minute ?? existing.cron_minute,
          Array.isArray(msg.cron_days) ? msg.cron_days.join(',') : (msg.cron_days ?? existing.cron_days),
          msg.target_agent_type ?? existing.target_agent_type, msg.target_session ?? existing.target_session,
          (msg.enabled !== undefined ? (msg.enabled ? 1 : 0) : existing.enabled),
          id
        );
        const row = stmtGetAutomation.get(id);
        ws.send(JSON.stringify({ type: 'automations_updated', automation: { ...row, enabled: !!row.enabled, cron_days: row.cron_days.split(',').map(Number) } }));
        log('info', 'automations', 'Updated via WS', { id: row.id });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'automations_error', error: e.message }));
      }

    } else if (t === 'automations_delete') {
      const { id } = msg;
      const existing = stmtGetAutomation.get(id);
      if (!existing) { ws.send(JSON.stringify({ type: 'automations_error', error: 'Not found' })); return; }
      try {
        stmtDeleteAutomation.run(id);
        ws.send(JSON.stringify({ type: 'automations_deleted', id }));
        log('info', 'automations', 'Deleted via WS', { id });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'automations_error', error: e.message }));
      }

    } else if (t === 'automations_run') {
      const { id } = msg;
      const automation = stmtGetAutomation.get(id);
      if (!automation) { ws.send(JSON.stringify({ type: 'automations_error', error: 'Not found' })); return; }
      const result = executeAutomation(automation);
      ws.send(JSON.stringify({ type: 'automations_run_result', id, ...result }));
    }
  });

  ws.on('close', () => {
    log('info', 'client-ws', 'Browser disconnected');
    abandonNativeHistoryWaiter(ws);
    browserClients.delete(ws);
    exactControlRegistry.abandonClient(ws);
    pendingBrowserSessionSummaries.delete(ws);
    const hostSubscriptionId = ws._hostResourceSubscriptionId;
    const hostSubscription = hostResourceSubscriptions.get(hostSubscriptionId);
    if (hostSubscription?.ws === ws) {
      hostResourceSubscriptions.delete(hostSubscriptionId);
      if (hostSubscription.proxyWs.readyState === WebSocket.OPEN) hostSubscription.proxyWs.send(JSON.stringify({
        type: 'host_resource_detach', protocol_version: PROTOCOL_VERSION,
        subscription_id: hostSubscriptionId,
      }));
    }
    // Clean up pending control requests that targeted this browser
    for (const [reqId, targetWs] of pendingCtrlReqs) {
      if (targetWs === ws) {
        const replacement = [...(codexControlRequestWaiters.get(reqId) || [])]
          .find(waiter => waiter !== ws && waiter.readyState === WebSocket.OPEN);
        if (replacement) {
          pendingCtrlReqs.set(reqId, replacement);
        } else {
          pendingCtrlReqs.delete(reqId);
          pendingPayloadCtrlState.delete(reqId);
          pendingHistoryMetadataReconciliations.delete(reqId);
        }
      }
    }
    for (const [requestId, waiters] of codexControlRequestWaiters) {
      waiters.delete(ws);
      if (waiters.size === 0) codexControlRequestWaiters.delete(requestId);
    }
    for (const [requestId, pending] of pendingHostResourceRequests) {
      if (pending.ws !== ws) continue;
      clearTimeout(pending.timer);
      pendingHostResourceRequests.delete(requestId);
    }
    for (const pendingMap of [pendingHostResourceSubscriptionRequests, pendingHostResourceHistoryRequests]) {
      for (const [requestId, pending] of pendingMap) {
        if (pending.ws !== ws) continue;
        clearTimeout(pending.timer);
        pendingMap.delete(requestId);
      }
    }
    for (const [requestId, pending] of pendingProviderUsageCostDetailRequests) {
      if (pending.ws !== ws) continue;
      clearTimeout(pending.timer);
      pendingProviderUsageCostDetailRequests.delete(requestId);
    }
    for (const active of activeProviderUsageRefreshes.values()) {
      active.clients = active.clients.filter(client => client.ws !== ws);
    }
    if (ws._providerUsageWatching) {
      const watcherCount = [...browserClients].filter(client => client._providerUsageWatching === true).length;
      const proxyWs = [...proxyConnections].find(candidate => (
        candidate._authenticated && candidate.readyState === WebSocket.OPEN
      ));
      if (proxyWs) proxyWs.send(JSON.stringify({
        type: 'provider_usage_watch',
        protocol_version: PROTOCOL_VERSION,
        active: watcherCount > 0,
        watcher_count: watcherCount,
      }));
    }
  });
}

// ── Automation scheduler ─────────────────────────────────────────────────────

function executeAutomation(automation) {
  // Find a matching session by agent_type or specific session ID
  let targetSession = null;
  let targetProxyWs = null;

  if (automation.target_session) {
    // Specific session
    targetProxyWs = proxySockets.get(automation.target_session);
    if (targetProxyWs && targetProxyWs.readyState === WebSocket.OPEN) {
      targetSession = automation.target_session;
    }
  } else {
    // Find first connected session matching agent_type
    for (const [sid, ws] of proxySockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const meta = sessionMeta.get(sid);
      if (meta?.agent_type === automation.target_agent_type) {
        targetSession = sid;
        targetProxyWs = ws;
        break;
      }
    }
  }

  if (!targetSession || !targetProxyWs) {
    log('warn', 'automations', 'No matching session for automation', { id: automation.id, name: automation.name, target: automation.target_agent_type });
    return { ok: false, error: `No connected ${automation.target_agent_type} session` };
  }

  // Send the prompt to the agent via proxy
  const seq = nextSeq(targetSession);
  const clientMsgId = `auto-${automation.id}-${Date.now()}`;
  const content = automation.prompt;

  try {
    insertMessageIdempotent(targetSession, 'user', content, clientMsgId, 'delivered', seq);
  } catch (e) {
    log('error', 'automations', 'DB insert failed', { err: e.message });
  }

  targetProxyWs.send(JSON.stringify({
    type:              'send',
    session:           targetSession,
    content,
    client_message_id: clientMsgId,
  }));

  // Broadcast to browsers so the message appears
  broadcastToBrowsers({
    type:     'message',
    session:  targetSession,
    role:     'user',
    content,
    sequence: seq,
    status:   'delivered',
    ts:       Math.floor(Date.now() / 1000),
  });

  stmtSetLastRun.run(automation.id);
  log('info', 'automations', 'Executed automation', { id: automation.id, name: automation.name, session: targetSession });
  return { ok: true, session: targetSession };
}

// Check automations every minute
setInterval(() => {
  const now = new Date();
  const hour   = now.getHours();
  const minute = now.getMinutes();
  const day    = now.getDay(); // 0=Sun, 1=Mon, ... 6=Sat

  try {
    const rows = stmtListAutomations.all();
    for (const auto of rows) {
      if (!auto.enabled) continue;
      if (auto.cron_hour !== hour || auto.cron_minute !== minute) continue;

      // Check day of week
      const days = auto.cron_days ? auto.cron_days.split(',').map(Number) : [1,2,3,4,5];
      if (!days.includes(day)) continue;

      // Check if already ran today (prevent re-execution within the same minute window)
      if (auto.last_run_at) {
        const lastRun = new Date(auto.last_run_at + 'Z');
        const diffMs = now.getTime() - lastRun.getTime();
        if (diffMs < 120_000) continue; // ran within last 2 minutes
      }

      executeAutomation(auto);
    }
  } catch (e) {
    log('error', 'automations', 'Scheduler tick failed', { err: e.message });
  }
}, 60_000);

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  scheduleTranscriptSearchBackfill();
  scheduleLegacyLatestVisibleBackfill();
  log('info', 'relay', 'Listening', {
    port:          PORT,
    public_url:    PUBLIC_URL,
    allowed_email: ALLOWED_EMAIL || '(any)',
    proxy_auth:    PROXY_SECRET ? 'enabled' : 'DISABLED — set PROXY_SECRET to secure /proxy-ws',
  });
  if (!PROXY_SECRET) {
    log('warn', 'relay', 'PROXY_SECRET is not set — /proxy-ws accepts unauthenticated proxy connections');
  }
});
