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
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const admin      = require('firebase-admin');
const webpush    = require('web-push');
const {
  UNSOLICITED_HISTORY_TAIL_LIMIT,
  buildUnsolicitedHistoryPayload,
  buildUnsolicitedHistoryChunkPayload,
  isUnsolicitedHistoryMessage,
  canBroadcastHistoryToBrowser,
} = require('./history-broadcast-policy');
const { buildDuplicateProxyAlarms } = require('./duplicate-proxy-alarm');
const { buildIncrementalHistoryPlan } = require('./history-sync-policy');
const { SendLifecycleTracker } = require('./send-lifecycle');
const { normalizeActivityTimeline } = require('./activity-timeline');
const {
  boundedString,
  createPrincipalRateLimit,
  validateQueueControlMessage,
  validateWebPushEndpoint,
  validateWebPushSubscription,
  validateWorkspaceControlMessage,
} = require('./request-security');

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
const HEALTH_DEGRADE_AFTER_MS = 120_000;  // inactivity threshold → degraded
const LAUNCH_TIMEOUT_MS       = 30_000;   // max wait for proxy to confirm a new session
const DEFAULT_HISTORY_CHUNK_LIMIT = 120;
const MAX_HISTORY_CHUNK_LIMIT = 500;
const NATIVE_HISTORY_TAIL_MIN_INTERVAL_MS = 1_500;
const NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS = 5_000;
const NATIVE_HISTORY_REPEAT_CURSOR_MS = 60_000;
const STATUS_BROADCAST_REFRESH_MS = 30_000;

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

// ── SQLite ────────────────────────────────────────────────────────────────────

const db = new Database(HISTORY_DB_PATH);

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
    content_blocks TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_session ON messages(session, id);
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
    agent_error        INTEGER NOT NULL DEFAULT 1,
    session_offline    INTEGER NOT NULL DEFAULT 1,
    rate_limit_cleared INTEGER NOT NULL DEFAULT 1,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS session_preferences (
    email        TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    display_name TEXT,
    archived     INTEGER NOT NULL DEFAULT 0,
    muted        INTEGER NOT NULL DEFAULT 0,
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
    completed_at  TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Existing installs predate the complete notification category set.
for (const column of ['permission_required', 'agent_error', 'session_offline']) {
  if (!db.prepare('PRAGMA table_info(notification_preferences)').all().some(info => info.name === column)) {
    db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
  }
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
  process.env.VAPID_SUBJECT || 'mailto:notifications@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

const NIGHTLY_VALIDATION_HARNESSES = new Set([
  'antigravity-v2', 'claude-cli', 'codex-cli', 'codex-desktop', 'cursor-cli', 'cursor',
]);

function nightlyValidationStatuses() {
  return db.prepare(`
    SELECT harness, status, app_version, validator, run_id, duration_ms,
           exit_code, detail, completed_at
    FROM nightly_validation_status
    ORDER BY harness
  `).all();
}

function saveNightlyValidationStatus(requested) {
  const harness = String(requested?.harness || '').trim();
  const status = String(requested?.status || '').trim();
  const completedAt = String(requested?.completed_at || '').trim();
  if (!NIGHTLY_VALIDATION_HARNESSES.has(harness)) throw new Error('Unknown validation harness');
  if (!['pass', 'fail', 'timed_out'].includes(status)) throw new Error('Invalid validation status');
  if (!completedAt || Number.isNaN(Date.parse(completedAt))) throw new Error('Invalid validation completion time');
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
  };
  db.prepare(`
    INSERT INTO nightly_validation_status
      (harness, status, app_version, validator, run_id, duration_ms, exit_code, detail, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(harness) DO UPDATE SET
      status = excluded.status,
      app_version = excluded.app_version,
      validator = excluded.validator,
      run_id = excluded.run_id,
      duration_ms = excluded.duration_ms,
      exit_code = excluded.exit_code,
      detail = excluded.detail,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `).run(
    value.harness, value.status, value.app_version, value.validator, value.run_id,
    value.duration_ms, value.exit_code, value.detail, value.completed_at,
  );
  return value;
}

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  permission_required: true,
  agent_ready: true,
  agent_error: true,
  session_offline: true,
  rate_limit_cleared: true,
});

function notificationPreferencesForEmail(email) {
  if (!email) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const row = db.prepare(`
    SELECT permission_required, agent_ready, agent_error, session_offline, rate_limit_cleared
    FROM notification_preferences
    WHERE email = ?
  `).get(email);
  return {
    permission_required: row ? !!row.permission_required : true,
    agent_ready: row ? !!row.agent_ready : true,
    agent_error: row ? !!row.agent_error : true,
    session_offline: row ? !!row.session_offline : true,
    rate_limit_cleared: row ? !!row.rate_limit_cleared : true,
  };
}

function saveNotificationPreferences(email, requested) {
  const current = notificationPreferencesForEmail(email);
  const preferences = {
    permission_required: typeof requested?.permission_required === 'boolean'
      ? requested.permission_required : current.permission_required,
    agent_ready: typeof requested?.agent_ready === 'boolean'
      ? requested.agent_ready : current.agent_ready,
    agent_error: typeof requested?.agent_error === 'boolean'
      ? requested.agent_error : current.agent_error,
    session_offline: typeof requested?.session_offline === 'boolean'
      ? requested.session_offline : current.session_offline,
    rate_limit_cleared: typeof requested?.rate_limit_cleared === 'boolean'
      ? requested.rate_limit_cleared : current.rate_limit_cleared,
  };
  db.prepare(`
    INSERT INTO notification_preferences
      (email, permission_required, agent_ready, agent_error, session_offline, rate_limit_cleared, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      permission_required = excluded.permission_required,
      agent_ready = excluded.agent_ready,
      agent_error = excluded.agent_error,
      session_offline = excluded.session_offline,
      rate_limit_cleared = excluded.rate_limit_cleared,
      updated_at = excluded.updated_at
  `).run(
    email,
    preferences.permission_required ? 1 : 0,
    preferences.agent_ready ? 1 : 0,
    preferences.agent_error ? 1 : 0,
    preferences.session_offline ? 1 : 0,
    preferences.rate_limit_cleared ? 1 : 0,
  );
  return preferences;
}

function sessionPreferencesForEmail(email) {
  if (!email) return {};
  const rows = db.prepare(`
    SELECT session_id, display_name, archived, muted
    FROM session_preferences
    WHERE email = ?
    ORDER BY updated_at DESC
  `).all(email);
  return Object.fromEntries(rows.map(row => [row.session_id, {
    display_name: row.display_name || '',
    archived: !!row.archived,
    muted: !!row.muted,
  }]));
}

function saveSessionPreference(email, sessionId, requested) {
  const current = sessionPreferencesForEmail(email)[sessionId] || {
    display_name: '', archived: false, muted: false,
  };
  const displayName = requested.display_name === undefined
    ? current.display_name
    : String(requested.display_name || '').trim().slice(0, 100);
  const preference = {
    display_name: displayName,
    archived: typeof requested.archived === 'boolean' ? requested.archived : current.archived,
    muted: typeof requested.muted === 'boolean' ? requested.muted : current.muted,
  };
  db.prepare(`
    INSERT INTO session_preferences (email, session_id, display_name, archived, muted, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email, session_id) DO UPDATE SET
      display_name = excluded.display_name,
      archived = excluded.archived,
      muted = excluded.muted,
      updated_at = excluded.updated_at
  `).run(email, sessionId, preference.display_name || null,
    preference.archived ? 1 : 0, preference.muted ? 1 : 0);
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

// ── Session metadata table — persists workspace info for resume ───────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS session_meta (
    session_id     TEXT PRIMARY KEY,
    workspace_path TEXT,
    project_root   TEXT,
    workspace_name TEXT,
    agent_type     TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try {
  const sessionMetaCols = new Set(db.pragma('table_info(session_meta)').map(r => r.name));
  if (!sessionMetaCols.has('cli_session_id')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN cli_session_id TEXT`);
  }
  if (!sessionMetaCols.has('project_root')) {
    db.exec(`ALTER TABLE session_meta ADD COLUMN project_root TEXT`);
  }
} catch {}

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

// Indexes that reference migrated columns — safe to create now
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sequence ON messages(session, sequence)`); } catch {}
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_msg
    ON messages(client_msg_id) WHERE client_msg_id IS NOT NULL
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
  agent_idle:           { category: 'agent_ready',        channelId: 'agent-idle' },
  agent_error:          { category: 'agent_error',        channelId: 'agent-error' },
  rate_limit_active:    { category: 'agent_error',        channelId: 'agent-error' },
  session_offline:      { category: 'session_offline',    channelId: 'session-offline' },
  rate_limit_cleared:   { category: 'rate_limit_cleared', channelId: 'rate-limit' },
});

async function sendPushNotification(title, body, data = {}) {
  // FCM data payload values must be strings
  const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const pushConfig = PUSH_TYPE_CONFIG[data.type] || null;
  const category = pushConfig?.category || null;
  const sessionId = data.session_id || data.session || '';
  const isAllowed = (email, transport) => {
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
      } catch (e) {
        if (
          e.code === 'messaging/registration-token-not-registered' ||
          e.code === 'messaging/invalid-registration-token'
        ) {
          staleTokens.push(token);
        } else {
          log('warn', 'fcm', 'Push send failed', { err: e.message });
        }
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
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        staleEndpoints.push(subscription.endpoint);
      } else {
        log('warn', 'web-push', 'Push send failed', { status: e.statusCode, err: e.message });
      }
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

function nextSeq(sessionId) {
  if (!sessionSeq.has(sessionId)) {
    const row = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS s FROM messages WHERE session = ?'
    ).get(sessionId);
    sessionSeq.set(sessionId, row.s);
  }
  const n = sessionSeq.get(sessionId) + 1;
  sessionSeq.set(sessionId, n);
  return n;
}

function historiesMatch(existingRows, incomingRows) {
  if (existingRows.length !== incomingRows.length) return false;
  for (let i = 0; i < existingRows.length; i++) {
    const existing = existingRows[i];
    const incoming = incomingRows[i] || {};
    if (existing.role !== incoming.role || existing.content !== incoming.content) {
      return false;
    }
    const existingBlocks = JSON.stringify(existing.content_blocks || null);
    const incomingBlocks = JSON.stringify(Array.isArray(incoming.content_blocks) ? incoming.content_blocks : null);
    if (existingBlocks !== incomingBlocks) return false;
    // Trigger resync when the proxy supplies a timestamp that materially
    // differs from what's stored. Tolerate small drift (e.g. 1s rounding)
    // so we don't churn on every poll. Only checks when incoming.ts is
    // present — otherwise stored ts stands.
    if (incoming.ts && Number.isFinite(incoming.ts) && existing.ts) {
      if (Math.abs(existing.ts - incoming.ts) > 2) return false;
    }
  }
  return true;
}

function getIncrementalHistoryPlan(sessionId, incomingRows, existingCount, tailLimit = 50) {
  if (!Array.isArray(incomingRows) || incomingRows.length < existingCount) return null;
  const tailSize = Math.min(Math.max(0, existingCount), Math.max(1, tailLimit));
  const existingTail = tailSize > 0 ? getHistoryRowsTail(sessionId, tailSize) : [];
  return buildIncrementalHistoryPlan(existingCount, existingTail, incomingRows);
}

function historiesTailLikelyMatch(sessionId, incomingRows, tailLimit = 50) {
  const existingCount = getHistoryCount(sessionId);
  if (existingCount !== incomingRows.length) {
    return { match: false, existingCount };
  }
  const limit = Math.min(Math.max(1, tailLimit), incomingRows.length);
  if (limit <= 0) return { match: true, existingCount };
  const existingTail = getHistoryRowsTail(sessionId, limit);
  const incomingTail = incomingRows.slice(-limit);
  return { match: historiesMatch(existingTail, incomingTail), existingCount };
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

// Per-session throttle for large history broadcasts. The transcript is always
// persisted to the DB on every resync, but we don't need to push 400+ message
// payloads to every browser on every poll — that just chews uplink for no UX
// benefit. Send one broadcast immediately, then at most one per
// LARGE_HISTORY_BROADCAST_THROTTLE_MS for the same session, with a trailing
// flush so the latest state still lands.
const LARGE_HISTORY_BROADCAST_THROTTLE_MS = 1500;
const lastLargeBroadcastAt = new Map(); // session_id → epoch ms
const pendingLargeBroadcast = new Map(); // session_id → timer

function scheduleHistoryBroadcast(sessionId, payloadFactory) {
  const now = Date.now();
  const last = lastLargeBroadcastAt.get(sessionId) || 0;
  const elapsed = now - last;
  if (elapsed >= LARGE_HISTORY_BROADCAST_THROTTLE_MS) {
    lastLargeBroadcastAt.set(sessionId, now);
    broadcastToBrowsers(payloadFactory());
    return;
  }
  // Coalesce: replace any pending trailing broadcast with the latest factory.
  const existing = pendingLargeBroadcast.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingLargeBroadcast.delete(sessionId);
    lastLargeBroadcastAt.set(sessionId, Date.now());
    broadcastToBrowsers(payloadFactory());
  }, LARGE_HISTORY_BROADCAST_THROTTLE_MS - elapsed);
  pendingLargeBroadcast.set(sessionId, timer);
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

function hydrateMessageRow(row) {
  if (!row) return row;
  const hydrated = { ...row };
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
  return hydrated;
}

const stmtInsert = db.prepare(
  `INSERT INTO messages (session, role, content, client_msg_id, status, sequence, content_blocks)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertWithTs = db.prepare(
  `INSERT INTO messages (session, role, content, client_msg_id, status, sequence, ts, content_blocks)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertIdempotent = db.prepare(
  `INSERT OR IGNORE INTO messages (session, role, content, client_msg_id, status, sequence, content_blocks)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const stmtInsertIdempotentWithTs = db.prepare(
  `INSERT OR IGNORE INTO messages (session, role, content, client_msg_id, status, sequence, ts, content_blocks)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

// Helper: insert a message, honoring proxy-supplied ts when available so
// historical messages render with their original timestamps (otherwise the
// table default unixepoch() makes every imported message look "now").
function insertMessage(session, role, content, clientMsgId, status, sequence, ts, contentBlocks) {
  const blocksJson = serializeContentBlocks(contentBlocks);
  if (ts && Number.isFinite(ts) && ts > 0) {
    return stmtInsertWithTs.run(session, role, content, clientMsgId, status, sequence, ts, blocksJson);
  }
  return stmtInsert.run(session, role, content, clientMsgId, status, sequence, blocksJson);
}
function insertMessageIdempotent(session, role, content, clientMsgId, status, sequence, ts, contentBlocks) {
  const blocksJson = serializeContentBlocks(contentBlocks);
  if (ts && Number.isFinite(ts) && ts > 0) {
    return stmtInsertIdempotentWithTs.run(session, role, content, clientMsgId, status, sequence, ts, blocksJson);
  }
  return stmtInsertIdempotent.run(session, role, content, clientMsgId, status, sequence, blocksJson);
}
const stmtDeleteSession  = db.prepare('DELETE FROM messages WHERE session = ?');
const stmtDeleteSessionSuffix = db.prepare('DELETE FROM messages WHERE session = ? AND id >= ?');

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
    sm.cli_session_id
  FROM messages m
  LEFT JOIN session_meta sm ON sm.session_id = m.session
  GROUP BY m.session
  HAVING message_count > 0
  ORDER BY last_active_at DESC
  LIMIT ?
`);
const stmtUpsertSessionMeta = db.prepare(`
  INSERT INTO session_meta (session_id, workspace_path, project_root, workspace_name, agent_type, cli_session_id, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(session_id) DO UPDATE SET
    workspace_path = COALESCE(excluded.workspace_path, workspace_path),
    project_root   = COALESCE(excluded.project_root, project_root),
    workspace_name = COALESCE(excluded.workspace_name, workspace_name),
    agent_type     = COALESCE(excluded.agent_type, agent_type),
    cli_session_id = COALESCE(excluded.cli_session_id, cli_session_id),
    updated_at     = datetime('now')
`);
const stmtGetSessionMeta = db.prepare(
  `SELECT session_id, workspace_path, project_root, workspace_name, agent_type, cli_session_id, updated_at
   FROM session_meta WHERE session_id = ?`
);
const persistSessionMetaBatch = db.transaction((sessions) => {
  let changed = 0;
  for (const session of sessions) {
    const id = typeof session === 'string' ? session : session?.session_id;
    if (!id || !session || typeof session !== 'object') continue;
    const next = {
      workspace_path: session.workspace_path || null,
      project_root: session.project_root || null,
      workspace_name: session.workspace_name || null,
      agent_type: session.agent_type || null,
      cli_session_id: session.cli_session_id || null,
    };
    const existing = stmtGetSessionMeta.get(id);
    if (
      existing
      && existing.workspace_path === next.workspace_path
      && existing.project_root === next.project_root
      && existing.workspace_name === next.workspace_name
      && existing.agent_type === next.agent_type
      && existing.cli_session_id === next.cli_session_id
    ) continue;
    stmtUpsertSessionMeta.run(
      id,
      next.workspace_path,
      next.project_root,
      next.workspace_name,
      next.agent_type,
      next.cli_session_id,
    );
    changed++;
  }
  return changed;
});
const stmtGetHistory     = db.prepare(
  'SELECT id, role, content, content_blocks, status, sequence, ts FROM messages WHERE session = ? ORDER BY id ASC'
);
const stmtGetHistoryCount = db.prepare(
  'SELECT COUNT(*) AS count FROM messages WHERE session = ?'
);
const stmtGetHistoryTail = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts
   FROM (
     SELECT id, role, content, content_blocks, status, sequence, ts
     FROM messages
     WHERE session = ?
     ORDER BY id DESC
     LIMIT ?
   )
   ORDER BY id ASC`
);
const stmtGetHistoryBeforeId = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts
   FROM (
     SELECT id, role, content, content_blocks, status, sequence, ts
     FROM messages
     WHERE session = ? AND id < ?
     ORDER BY id DESC
     LIMIT ?
   )
   ORDER BY id ASC`
);
const stmtGetHistoryCountBeforeId = db.prepare(
  'SELECT COUNT(*) AS count FROM messages WHERE session = ? AND id < ?'
);
const stmtGetHistoryFrom = db.prepare(
  `SELECT id, role, content, content_blocks, status, sequence, ts
   FROM messages WHERE session = ? AND sequence > ? ORDER BY id ASC`
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

function historyChunkLimit(limit) {
  return Math.max(1, Math.min(MAX_HISTORY_CHUNK_LIMIT, Math.floor(Number(limit) || DEFAULT_HISTORY_CHUNK_LIMIT)));
}

function getHistoryRowsBeforeId(sessionId, beforeId, limit) {
  const safeLimit = historyChunkLimit(limit);
  const safeBeforeId = Math.max(0, Math.floor(Number(beforeId) || 0));
  if (!safeBeforeId) return getHistoryRowsTail(sessionId, safeLimit);
  return stmtGetHistoryBeforeId.all(sessionId, safeBeforeId, safeLimit).map(hydrateMessageRow);
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
  'SELECT id, sequence, ts FROM messages WHERE client_msg_id = ?'
);
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
app.post('/auth/app-token', express.json(), (req, res) => {
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
app.post('/auth/google-id-token', express.json(), async (req, res) => {
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
app.post('/fcm-token', requireBearerToken, express.json(), (req, res) => {
  const { fcm_token, platform = 'android' } = req.body || {};
  if (!fcm_token) return res.status(400).json({ error: 'missing fcm_token' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO fcm_tokens (email, token, platform, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET email = excluded.email, platform = excluded.platform, updated_at = excluded.updated_at
  `).run(req.appUser.email, fcm_token, platform, now);
  log('info', 'fcm', 'FCM token registered', { email: req.appUser.email, platform });
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
const LAN_PREFIXES = ['192.168.', '10.', '172.16.', '::ffff:192.168.', '::ffff:10.'];
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
    },
  });
});

app.get('/readyz', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch { /* db down */ }
  const proxyUp = proxySockets.size > 0;
  res.status(dbOk ? 200 : 503).json({
    status:          dbOk ? 'ready' : 'not_ready',
    db:              dbOk ? 'ok' : 'error',
    proxy:           proxyUp ? 'connected' : 'disconnected',
    proxy_sessions:  Array.from(proxySockets.keys()),
    browser_clients: browserClients.size,
  });
});

// ── File upload ───────────────────────────────────────────────────────────────

// Simple in-memory rate limiter: max 20 uploads per IP per minute.
const _uploadHits = new Map(); // ip -> [timestamp, ...]
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

app.post('/upload', requireAuth, uploadRateLimit, (req, res) => {
  // Enforce 2 MB server-side via Content-Length before trusting body (A8-01)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > UPLOAD_MAX_BYTES) {
    return res.status(413).json({ error: `File too large — maximum upload is ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB` });
  }
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });
  const safe   = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const unique = `${Date.now()}_${safe}`;
  const fpath  = path.join(UPLOAD_DIR, unique);
  // SEC-12: Verify resolved path is still within UPLOAD_DIR (path traversal protection)
  if (!path.resolve(fpath).startsWith(path.resolve(UPLOAD_DIR))) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  try {
    fs.writeFileSync(fpath, Buffer.from(content, 'base64'));
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
    requested.agent_error !== undefined && typeof requested.agent_error !== 'boolean' ||
    requested.session_offline !== undefined && typeof requested.session_offline !== 'boolean' ||
    requested.rate_limit_cleared !== undefined && typeof requested.rate_limit_cleared !== 'boolean'
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

app.get('/api/maintenance/validation', requireAnyAuth, (req, res) => {
  try {
    res.json({ validations: nightlyValidationStatuses() });
  } catch (e) {
    log('error', 'validation', 'Nightly validation status read failed', { err: e.message });
    res.status(500).json({ error: 'Failed to read nightly validation status' });
  }
});

app.put('/api/maintenance/validation', requireAnyAuth, (req, res) => {
  try {
    const validation = saveNightlyValidationStatus(req.body?.validation || req.body || {});
    const validations = nightlyValidationStatuses();
    const failures = validations.filter(item => item.status !== 'pass');
    broadcastToBrowsers({
      type: 'nightly_validation_status',
      validations,
      failures,
      server_ts: new Date().toISOString(),
    });
    res.json({ ok: true, validation, failures });
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
    requested.muted !== undefined && typeof requested.muted !== 'boolean'
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
    const prune = db.transaction(sessionIds => {
      let deletedMessages = 0;
      for (const sessionId of sessionIds) {
        deletedMessages += deleteMessages.run(sessionId).changes;
        deleteMeta.run(sessionId);
      }
      return deletedMessages;
    });
    const deletedMessages = prune(before._candidate_ids);
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
    const rows = stmtSessionHistory.all(limit);
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
      }));
    res.json({ sessions: history });
  } catch (e) {
    log('error', 'session-history', 'Failed to fetch session history', { err: e.message });
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
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
const proxySessionClaims = new Map(); // proxy WebSocket -> { proxy_id, sessions }
const browserClients  = new Set();  // all connected browser WebSockets
const sessionMeta     = new Map();  // sessionId → latest proxy session metadata
const sessionHealth   = new Map();  // sessionId → 'healthy'|'degraded'|'disconnected'
const sessionLastSeen = new Map();  // sessionId → Date.now() of last activity
const sessionActivity = new Map();  // sessionId → last known activity kind (A12-02)
const sendLifecycle = new SendLifecycleTracker();

function shouldSendPush() {
  return NOTIFY_EVEN_IF_CONNECTED || browserClients.size === 0;
}

function notificationSessionName(sessionId) {
  const meta = sessionMeta.get(sessionId) || {};
  return meta.display_name || meta.name || meta.session_name || meta.workspace_name
    || String(sessionId || 'Agent').slice(0, 32);
}

const cachedChatLists = new Map();  // sessionId -> latest chat_list payload

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
// Open session error prompts: `${session_id}:${prompt_id}` → { prompt }
const pendingErrorPrompts = new Map();
// Latest agent config per session: session_id → agent_config object
const agentConfigs    = new Map();
// In-flight control request routing: request_id → browser WebSocket
const pendingCtrlReqs = new Map();
// Payload-backed controls emit both a payload and an agent_control_result. Track
// both halves so either arrival order reaches the initiating browser before the
// routing entry is released.
const pendingPayloadCtrlState = new Map();
const pendingPromptResponses = new Map();
const pendingErrorPromptResponses = new Map();
const nativeHistoryChunkRequests = new Map();
const statusBroadcastState = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcastToBrowsers(msg) {
  const data = JSON.stringify(msg);
  const isHistoryBroadcast = isUnsolicitedHistoryMessage(msg);
  for (const ws of browserClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // Unsolicited history is expendable live-tail state. Do not queue it in
    // front of explicit history/control responses for the selected session.
    if (isHistoryBroadcast && !canBroadcastHistoryToBrowser(ws)) continue;
    ws.send(data);
  }
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

function nativeHistoryCursorSig(msg) {
  if (!msg || msg.mode !== 'older') return '';
  const beforeOffset = msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? '';
  const beforeId = msg.before_id ?? msg.beforeId ?? msg.cursor?.next_before_id ?? '';
  return `${beforeOffset}\u0001${beforeId}`;
}

function throttleNativeHistoryChunkRequest(sessionId, msg) {
  const mode = msg.mode === 'older' ? 'older' : 'tail';
  if (mode === 'older' && !msg.user_initiated) {
    return {
      code: 'history_older_requires_user_action',
      message: 'Older native history chunks require a current manual WebUI request.',
      retryAfterMs: NATIVE_HISTORY_OLDER_MIN_INTERVAL_MS,
    };
  }
  const now = Date.now();
  const key = `${sessionId}:${mode}`;
  const cursorSig = nativeHistoryCursorSig(msg);
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
    if (mode === 'older' && cursorSig && previous.cursorSig === cursorSig && elapsed < NATIVE_HISTORY_REPEAT_CURSOR_MS) {
      return {
        code: 'history_chunk_duplicate_cursor',
        message: 'Duplicate older native history cursor ignored.',
        retryAfterMs: NATIVE_HISTORY_REPEAT_CURSOR_MS - elapsed,
      };
    }
  }
  nativeHistoryChunkRequests.set(key, { at: now, cursorSig });
  return null;
}

function statusBroadcastSignature(msg) {
  const activity = msg?.activity && typeof msg.activity === 'object' ? msg.activity : null;
  const goal = activity?.goal && typeof activity.goal === 'object'
    ? {
        label: activity.goal.label || '',
        objective: activity.goal.objective || '',
        status: activity.goal.status || '',
        tokens_used: activity.goal.tokens_used ?? activity.goal.tokensUsed ?? null,
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
      interrupt_hint: activity.interrupt_hint || '',
      thinkingContent: activity.thinkingContent || '',
      task_list: activity.task_list || null,
      context_card: activity.context_card || null,
      goal,
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

function getSessionList() {
  return Array.from(proxySockets.keys()).map((id) => {
    const meta = sessionMeta.get(id);
    if (!meta) return id;
    return {
      ...meta,
      session_id:   id,
      status:       sessionHealth.get(id) || meta.status || 'healthy',
      last_seen_at: meta.last_seen_at || (sessionLastSeen.has(id) ? new Date(sessionLastSeen.get(id)).toISOString() : null),
    };
  });
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
    'approval_policy',
    'file_access_scope',
    'branch',
    'effort',
    'speed',
    'sandbox_status',
    'auto_approve_permissions',
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

function getEffectiveHistoryChunk(sessionId, { beforeId = null, limit = DEFAULT_HISTORY_CHUNK_LIMIT } = {}) {
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
  const messages = safeBeforeId
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
  'message', 'proxy_message',
  'session_launch_ack', 'session_launch_failed', 'session_closed', 'session_meta_backfill',
  'permission_prompt', 'permission_prompt_expired', 'session_error_prompt', 'session_error_prompt_cleared', 'agent_config', 'agent_control_result',
  'history', 'history_snapshot', 'history_chunk',
  'rate_limit_active', 'rate_limit_cleared',
  'chat_list', 'thread_list', 'terminal_output', 'file_changes',
  'branch_list', 'skill_list', 'codex_automation_view',
  'directory_listing', 'file_content',
  'message_queued', 'queue_delivered', 'steer_result', 'proxy_send_result',
  'native_queue',
]);

const KNOWN_CLIENT_TYPES = new Set([
  'connection_hello', 'hello', 'heartbeat',
  'get_history', 'history_request', 'history_chunk_request',
  'send', 'send_message',
  'launch_session', 'resume_session', 'close_session', 'dismiss_session',
  'permission_response', 'error_prompt_action', 'agent_interrupt', 'agent_config_request',
  'agent_set_model', 'agent_set_effort', 'agent_set_permission_mode', 'agent_set_auto_approve_permissions',
  'set_codex_config', 'agent_set_mode',
  'new_thread', 'open_panel', 'open_native_window', 'chat_list', 'switch_chat', 'new_chat',
  'thread_list', 'switch_thread', 'switch_workspace', 'terminal_output',
  'file_changes', 'file_change_response', 'send_attachment', 'terminal_input',
  'branch_list', 'switch_branch', 'create_branch',
  'skill_list', 'automation_view_action', 'list_directory', 'read_file',
  'steer', 'discard_queued', 'edit_queued',
  'automations_list', 'automations_create', 'automations_update', 'automations_delete', 'automations_run',
]);

// Rate limiting for browser sends (A8-03): 30 sends per 10 s window
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MS  = 10_000;

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
    const t = msg.type;

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

      thisProxyId = msg.proxy_id || null;
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

    // ── Application heartbeat (in addition to native ping/pong) ───────────
    } else if (t === 'heartbeat') {
      ws.send(JSON.stringify({
        type:             'heartbeat_ack',
        protocol_version: PROTOCOL_VERSION,
        request_id:       msg.request_id,
        server_ts:        new Date().toISOString(),
      }));

    // ── Session registration (old: session_list, new: proxy_session_snapshot)
    } else if (t === 'session_list' || t === 'proxy_session_snapshot') {
      // A6-05: track which proxy_id is sending this snapshot
      const snapshotProxyId = msg.proxy_id || thisProxyId || null;
      const sessions = msg.sessions || [];
      const duplicateSessions = [];

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
          cachedChatLists.delete(sid);
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
                let migrated = 0;
                for (const m of messages) {
                  if (m.role === 'user' || m.role === 'assistant') {
                    const seq = nextSeq(replacementId);
                    insertMessageIdempotent(replacementId, m.role, m.content, null, 'delivered', seq, null, m.content_blocks);
                    migrated++;
                  }
                }
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
        proxySockets.set(id, ws);
        sessionProxyId.set(id, snapshotProxyId);
        proxySessions.add(id);
        if (s && typeof s === 'object') {
          sessionMeta.set(id, {
            ...s,
            session_id: id,
          });
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
      broadcastToBrowsers({ type: 'session_list', sessions: getSessionList(), workspaces: cachedWorkspaces });

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
        if (sessionMeta.has(id)) {
          sessionMeta.set(id, {
            ...sessionMeta.get(id),
            activity: broadcastActivity,
            status: msg.status || sessionMeta.get(id).status,
            last_seen_at: new Date().toISOString(),
          });
        }
        // Track activity kind for idle-transition FCM (A12-02)
        const prevKind = sessionActivity.get(id);
        const currKind = (typeof broadcastActivity === 'object' ? broadcastActivity?.kind : broadcastActivity) || null;
        sessionActivity.set(id, currKind);
        if ((prevKind === 'generating' || prevKind === 'thinking') && currKind === 'idle') {
          if (shouldSendPush()) {
            const name = notificationSessionName(id);
            sendPushNotification(
              `${name} is ready`,
              'Agent has finished and is waiting for input.',
              { type: 'agent_idle', activity_type: 'idle', session_id: id, session_name: name }
            ).catch(() => {});
          }
        }
      }
      // Normalise to old shape so existing frontend still works
      const statusMsg = { type: 'status', session: id || msg.session, thinking: msg.thinking, label: msg.label, activity: broadcastActivity };
      if (msg.thinking_content) statusMsg.thinking_content = msg.thinking_content;
      if (shouldBroadcastStatus(id, statusMsg)) broadcastToBrowsers(statusMsg);
      const agentStarted = sendLifecycle.consumeActivity({ ...msg, session_id: id, activity: broadcastActivity });
      if (agentStarted) {
        broadcastToBrowsers(agentStarted);
        log('info', 'send', 'agent_started', { session: id, cid: agentStarted.client_message_id });
      }

    // ── Incoming agent message ─────────────────────────────────────────────
    } else if (t === 'message' || t === 'proxy_message') {
      const id      = msg.session || msg.session_id;
      const role    = msg.role    || msg.message?.role;
      const content = msg.content || msg.message?.content;
      const contentBlocks = Array.isArray(msg.content_blocks)
        ? msg.content_blocks
        : (Array.isArray(msg.message?.content_blocks) ? msg.message.content_blocks : null);
      if (!id || !role || !content) return;

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
      const tailRow = db.prepare(
        'SELECT role, content FROM messages WHERE session = ? ORDER BY id DESC LIMIT 1'
      ).get(id);
      if (tailRow && tailRow.role === role && tailRow.content === content) {
        log('info', 'dedup', 'Skipping duplicate proxy_message (tail match)', { session: id, role });
        return;
      }

      const seq = nextSeq(id);
      let messageTs = Math.floor(Date.now() / 1000);
      let rowId;
      try {
        const info = insertMessage(id, role, content, null, 'delivered', seq, null, contentBlocks);
        rowId = info.lastInsertRowid;
      } catch (e) {
        log('error', 'db', 'Insert failed', { session: id, err: e.message });
      }

      touchSession(id);
      log('info', 'msg', `${role}: ${content.substring(0, 80)}`, { session: id, seq });
      broadcastToBrowsers({
        type:              'message',
        session:           id,
        role,
        content,
        ...(contentBlocks ? { content_blocks: contentBlocks } : {}),
        sequence:          seq,
        server_message_id: rowId,
        ts:                messageTs,
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
          let copied = 0;
          for (const m of oldMessages) {
            if (m.role === 'user' || m.role === 'assistant') {
              const seq = nextSeq(newSessionId);
              insertMessage(newSessionId, m.role, m.content, null, 'delivered', seq, null, m.content_blocks);
              copied++;
            }
          }
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
        cachedChatLists.delete(id);
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
      });
      broadcastToBrowsers({ type: 'session_list', sessions: getSessionList(), workspaces: cachedWorkspaces });

    // ── Permission prompt (A2-07) ─────────────────────────────────────────
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
      const targetWs  = requestId ? pendingCtrlReqs.get(requestId) : null;
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
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
      }
      log('info', 'ctrl', `Control result: ${msg.result}`, { request_id: requestId, command: msg.command });

    // ── Full history resync from proxy (legacy: 'history', v1: 'history_snapshot') ─
    } else if (t === 'history_chunk') {
      const requestId = msg.request_id || null;
      const targetWs = requestId ? pendingCtrlReqs.get(requestId) : null;
      if (requestId) pendingCtrlReqs.delete(requestId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
      } else {
        broadcastToBrowsers(buildUnsolicitedHistoryChunkPayload(msg));
      }
      log('info', 'history', 'Forwarded native history chunk', {
        session: msg.session_id || msg.session,
        messages: Array.isArray(msg.messages) ? msg.messages.length : 0,
        partial: !!msg.partial,
      });

    } else if (t === 'history' || t === 'history_snapshot') {
      const id       = msg.session || msg.session_id;
      const messages = msg.messages || [];
      if (!id || !Array.isArray(messages)) return;

      const isLargeHistory = messages.length > UNSOLICITED_HISTORY_TAIL_LIMIT;
      let existing = null;
      let existingLength = 0;
      let alreadyMatches = false;
      if (messages.length > 0 && isLargeHistory) {
        const quick = historiesTailLikelyMatch(id, messages);
        existingLength = quick.existingCount;
        alreadyMatches = quick.match;
      } else {
        existing = getHistoryRows(id);
        existingLength = existing.length;
        alreadyMatches = historiesMatch(existing, messages);
      }

      // A snapshot is authoritative even when it is empty. New-chat and
      // list-view transitions intentionally send [] to clear the previous
      // conversation; ignoring that snapshot causes the next native turns to
      // be appended behind stale SQLite history and appear duplicated.
      const incrementalPlan = !alreadyMatches
        ? getIncrementalHistoryPlan(id, messages, existingLength)
        : null;
      if (incrementalPlan && incrementalPlan.rows.length > 0) {
        db.transaction((rows) => {
          if (incrementalPlan.mode === 'replace_suffix') {
            stmtDeleteSessionSuffix.run(id, incrementalPlan.delete_from_id);
            sessionSeq.delete(id);
          }
          rows.forEach(m => insertMessage(id, m.role, m.content, null, 'delivered', nextSeq(id), m.ts, m.content_blocks));
        })(incrementalPlan.rows);
        log('info', 'history', `${incrementalPlan.mode === 'append' ? 'Appended' : 'Replaced suffix with'} ${incrementalPlan.rows.length} msgs`, {
          session: id,
          previous: incrementalPlan.existing_count,
          prefix: incrementalPlan.prefix_count ?? incrementalPlan.existing_count,
          total: messages.length,
        });
        scheduleHistoryBroadcast(id, () => {
          const total = getHistoryCount(id);
          const rows = total > UNSOLICITED_HISTORY_TAIL_LIMIT
            ? getHistoryRowsTail(id, UNSOLICITED_HISTORY_TAIL_LIMIT)
            : getHistoryRows(id);
          return buildUnsolicitedHistoryPayload(id, rows, total);
        });
      } else if (!alreadyMatches) {
        if (!existing) existing = getHistoryRows(id);
        const resync = db.transaction((msgs) => {
          stmtDeleteSession.run(id);
          sessionSeq.delete(id);
          msgs.forEach(m => insertMessage(id, m.role, m.content, null, 'delivered', nextSeq(id), m.ts, m.content_blocks));
        });
        resync(messages);
        log('info', 'history', `Resynced ${existingLength}→${messages.length}`, { session: id });
        const buildPayload = () => {
          const total = getHistoryCount(id);
          const rows = total > UNSOLICITED_HISTORY_TAIL_LIMIT
            ? getHistoryRowsTail(id, UNSOLICITED_HISTORY_TAIL_LIMIT)
            : getHistoryRows(id);
          return buildUnsolicitedHistoryPayload(id, rows, total);
        };
        if (messages.length === 0) {
          // Navigation/new-chat clears must land immediately.
          broadcastToBrowsers(buildPayload());
        } else {
          scheduleHistoryBroadcast(id, buildPayload);
        }
      } else if (!isLargeHistory && existing && existing.length === 0 && messages.length > 0) {
        db.transaction((msgs) => {
          msgs.forEach(m => insertMessage(id, m.role, m.content, null, 'delivered', nextSeq(id), m.ts, m.content_blocks));
        })(messages);
        log('info', 'history', `Stored ${messages.length} msgs`, { session: id });
        scheduleHistoryBroadcast(id, () => {
          const total = getHistoryCount(id);
          const rows = total > UNSOLICITED_HISTORY_TAIL_LIMIT
            ? getHistoryRowsTail(id, UNSOLICITED_HISTORY_TAIL_LIMIT)
            : getHistoryRows(id);
          return buildUnsolicitedHistoryPayload(id, rows, total);
        });
      }

    // ── Rate limit events (A12-02, proxy side added in A12-03) ────────────
    } else if (t === 'rate_limit_active') {
      const id = msg.session_id || msg.session;
      if (id) touchSession(id);
      if (id && sessionMeta.has(id)) {
        sessionMeta.set(id, {
          ...sessionMeta.get(id),
          rate_limited_until: msg.retry_after_hint || 'unknown',
          rate_limit_active: true,
          percent_used: msg.percent_used ?? null,
          last_seen_at: new Date().toISOString(),
        });
      }
      broadcastToBrowsers(msg);
      if (id && shouldSendPush()) {
        const name = notificationSessionName(id);
        sendPushNotification(
          `${name} is rate limited`,
          String(msg.retry_after_hint || 'The agent cannot continue until the limit clears.').slice(0, 180),
          { type: 'rate_limit_active', activity_type: 'rate_limit', session_id: id, session_name: name },
        ).catch(() => {});
      }
      log('info', 'rate-limit', 'Rate limit active', { session: id, retry_after_hint: msg.retry_after_hint });

    } else if (t === 'rate_limit_cleared') {
      const id = msg.session_id || msg.session;
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
      if (shouldSendPush()) {
        sendPushNotification(
          'Rate limit cleared',
          'Claude Code is no longer rate limited.',
          { type: 'rate_limit_cleared', activity_type: 'idle', session_id: id || '' }
        ).catch(() => {});
      }
      log('info', 'rate-limit', 'Rate limit cleared', { session: id });

    // ── Steer / queue messages (proxy → browser) ─────────────────────────
    } else if (t === 'message_queued' || t === 'queue_delivered' || t === 'steer_result' || t === 'proxy_send_result') {
      const agentStarted = t === 'proxy_send_result' ? sendLifecycle.markProxyResult(msg) : null;
      broadcastToBrowsers(msg);
      if (agentStarted) {
        broadcastToBrowsers(agentStarted);
        log('info', 'send', 'agent_started', { session: agentStarted.session_id, cid: agentStarted.client_message_id });
      }
      log('info', 'send', `${t}`, { session: msg.session_id, cid: msg.client_message_id });

    // ── Native queue (Codex side-panel queue items) ─────────────────────────
    } else if (t === 'native_queue') {
      broadcastToBrowsers(msg);
    }
  });

  ws.on('close', () => {
    if (helloTimeout) clearTimeout(helloTimeout);
    log('info', 'proxy-ws', 'Agent proxy disconnected', { proxy_id: thisProxyId });
    proxyConnections.delete(ws);
    proxySessionClaims.delete(ws);
    proxySessions.forEach(s => {
      if (proxySockets.get(s) === ws) {
        proxySockets.delete(s);
        sessionProxyId.delete(s);
        sessionMeta.delete(s);
        sessionActivity.delete(s);
        sendLifecycle.clearSession(s);
        cachedChatLists.delete(s);
        setHealth(s, 'disconnected');
      }
    });
    if (getProxySocket() === null) cachedWorkspaces = [];
    refreshDuplicateProxyAlarms();
    broadcastToBrowsers({ type: 'session_list', sessions: getSessionList(), workspaces: cachedWorkspaces });
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
  });
}

// ── Browser client handler (A2-01, A2-02, A2-03, A2-04) ──────────────────────

function handleClientConnection(ws, req) {
  log('info', 'client-ws', 'Browser connected');
  browserClients.add(ws);
  startHeartbeat(ws, 'browser');

  // Per-client send rate limit (A8-03): 30 send messages per 10 s window
  ws._rlCount = 0;
  const _rlInterval = setInterval(() => { ws._rlCount = 0; }, RATE_LIMIT_MS);
  ws.on('close', () => clearInterval(_rlInterval));

  // Per-client message rate limit: 200 messages per minute
  // (reconnect with many sessions sends ~24+ config/history requests at once)
  const _msgTimestamps = [];
  const MSG_RATE_LIMIT  = 200;
  const MSG_RATE_WINDOW = 60_000;

  // Send ack with current session state + any in-flight launches + cached control state
  const pendingLaunchList = Array.from(pendingLaunches.entries()).map(([rid, p]) => ({
    request_id:  rid,
    agent_type:  p.agent_type,
    launched_at: p.launched_at,
    timeout_at:  p.timeout_at,
  }));
  const openPromptList = Array.from(pendingPrompts.values()).map(e => e.prompt);
  const openErrorPromptList = Array.from(pendingErrorPrompts.values()).map(e => e.prompt);
  const agentConfigMap = getCompactAgentConfigsForAck();
  const nightlyValidationFailures = nightlyValidationStatuses().filter(item => item.status !== 'pass');
  ws.send(JSON.stringify({
    type:                 'connection_ack',
    protocol_version:     PROTOCOL_VERSION,
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    heartbeat_timeout_ms:  HEARTBEAT_TIMEOUT_MS,
    sessions:             getSessionList(),
    session_health:       Object.fromEntries(sessionHealth),
    ...(pendingLaunchList.length > 0 ? { pending_launches:  pendingLaunchList  } : {}),
    ...(openPromptList.length  > 0 ? { open_prompts:      openPromptList      } : {}),
    ...(openErrorPromptList.length > 0 ? { open_error_prompts: openErrorPromptList } : {}),
    ...(Object.keys(agentConfigMap).length > 0 ? { agent_configs: agentConfigMap } : {}),
    ...(duplicateProxyAlarms.length > 0 ? { duplicate_proxy_alarms: duplicateProxyAlarms } : {}),
    ...(nightlyValidationFailures.length > 0 ? { nightly_validation_failures: nightlyValidationFailures } : {}),
    ...(cachedWorkspaces.length > 0 ? { workspaces: cachedWorkspaces } : {}),
    ts:                   Date.now(),
  }));
  for (const [sessionId, chatList] of cachedChatLists) {
    if (proxySockets.has(sessionId)) ws.send(JSON.stringify(chatList));
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const t = msg.type;

    // Drop messages with unknown or missing type (A8-01)
    if (typeof t !== 'string' || !KNOWN_CLIENT_TYPES.has(t)) {
      log('warn', 'client-ws', 'Unknown message type — dropped', { type: t });
      return;
    }

    // ── Rate limit ─────────────────────────────────────────────────────────
    const _now = Date.now();
    while (_msgTimestamps.length && _now - _msgTimestamps[0] > MSG_RATE_WINDOW) _msgTimestamps.shift();
    if (_msgTimestamps.length >= MSG_RATE_LIMIT) {
      log('warn', 'client-ws', 'Client rate limit exceeded — dropping message');
      return;
    }
    _msgTimestamps.push(_now);

    // ── Handshake ──────────────────────────────────────────────────────────
    if (t === 'connection_hello' || t === 'hello') {
      log('info', 'client-ws', 'Browser hello received', { last_seq: msg.last_sequence });
      // ack already sent on connect

    // ── Application heartbeat ──────────────────────────────────────────────
    } else if (t === 'heartbeat') {
      ws.send(JSON.stringify({
        type:             'heartbeat_ack',
        protocol_version: PROTOCOL_VERSION,
        request_id:       msg.request_id,
        server_ts:        new Date().toISOString(),
      }));

    // ── History request (A2-04) ────────────────────────────────────────────
    // Supports both old (get_history) and new (history_request) names,
    // and both old and new field names for delta mode.
    } else if (t === 'history_chunk_request') {
      const id = msg.session || msg.session_id;
      const requestId = msg.request_id || `histchunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!id) return;
      const requestedSource = msg.source || msg.history_source || 'native';
      if (requestedSource !== 'relay_sqlite') {
        const throttle = throttleNativeHistoryChunkRequest(id, msg);
        if (throttle) {
          sendHistoryChunkError(ws, {
            sessionId: id,
            requestId,
            mode: msg.mode || 'tail',
            source: requestedSource,
            code: throttle.code,
            message: throttle.message,
            retryAfterMs: throttle.retryAfterMs,
          });
          log('warn', 'history', 'Rejected native history chunk request', {
            session: id,
            mode: msg.mode || 'tail',
            code: throttle.code,
          });
          return;
        }
      }
      if (requestedSource === 'relay_sqlite') {
        const beforeId = msg.mode === 'older'
          ? (msg.before_id ?? msg.beforeId ?? msg.cursor?.next_before_id ?? null)
          : null;
        const result = getEffectiveHistoryChunk(id, {
          beforeId,
          limit: msg.limit || msg.tail_limit || msg.history_limit || DEFAULT_HISTORY_CHUNK_LIMIT,
        });
        ws.send(JSON.stringify({
          type: 'history_chunk',
          protocol_version: PROTOCOL_VERSION,
          session: id,
          session_id: id,
          request_id: requestId,
          mode: msg.mode === 'older' ? 'older' : 'tail',
          replace: msg.mode !== 'older' && msg.replace === true,
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
        log('info', 'history', 'Served relay history chunk', {
          session: id,
          source_session: result.source_session,
          mode: msg.mode === 'older' ? 'older' : 'tail',
          messages: result.messages.length,
          partial: !!result.partial,
        });
        return;
      }
      const proxyWs = proxySockets.get(id);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'history_chunk',
          session: id,
          session_id: id,
          request_id: requestId,
          mode: msg.mode || 'tail',
          messages: [],
          partial: false,
          complete: true,
          error: { code: 'session_not_connected', message: `Session ${id} not connected` },
          cursor: { start_offset: 0, end_offset: 0, next_before_offset: null, total_bytes: 0 },
        }));
        return;
      }
      pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        ...msg,
        type: 'history_chunk_request',
        session: id,
        session_id: id,
        request_id: requestId,
      }));
      log('info', 'history', 'Forwarded native history chunk request', { session: id, mode: msg.mode || 'tail' });

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
      }

    // ── Send message (A2-01, A2-03) ────────────────────────────────────────
    // Supports both old (send) and new (send_message) shapes.
    } else if (t === 'send' || t === 'send_message') {
      // Per-send rate limit: 30 per 10 s window (A8-03)
      ws._rlCount++;
      if (ws._rlCount > RATE_LIMIT_MAX) {
        const clientIp = req.socket?.remoteAddress || 'unknown';
        log('warn', 'rate-limit', 'Send rate limit exceeded', { session: msg.session || msg.session_id, ip: clientIp });
        ws.send(JSON.stringify({ type: 'error', code: 'rate_limited', message: `Send rate limit exceeded (${RATE_LIMIT_MAX} per ${RATE_LIMIT_MS / 1000} s)` }));
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
      const proxyMsg = { ...msg, type: 'send', session: id };
      const fileMatch = content && (
        content.match(/\[File: ([^\]]+)\]\(\/uploads\/([^)]+)\)/)
        || content.match(/!\[([^\]]*)\]\(\/uploads\/([^)]+)\)/)
      );
      if (fileMatch) {
        const [, originalNameRaw, storedName] = fileMatch;
        const originalName = originalNameRaw || storedName;
        const fpath = path.join(UPLOAD_DIR, storedName);
        try {
          const fileData = fs.readFileSync(fpath);
          proxyMsg.file = { originalName, storedName, data: fileData.toString('base64') };
          const fk = `${id}:${originalName}`;
          recentFileSends.set(fk, Date.now());
          setTimeout(() => recentFileSends.delete(fk), 15_000);
        } catch (e) {
          log('error', 'relay', 'Could not read file for proxy', { err: e.message });
        }
      }

      proxyWs.send(JSON.stringify(proxyMsg));

      // Persist user message — idempotent when client_message_id provided (A2-03)
      const seq = nextSeq(id);
      let messageTs = Math.floor(Date.now() / 1000);
      let serverId, finalSeq = seq;
      try {
        if (clientMsgId) {
          insertMessageIdempotent(id, 'user', content, clientMsgId, 'delivered', seq);
          const row = stmtGetByClientId.get(clientMsgId);
          if (row) {
            serverId = row.id;
            finalSeq = row.sequence;
            if (row.ts) messageTs = row.ts;
          }
        } else {
          const info = insertMessage(id, 'user', content, null, 'delivered', seq);
          serverId = info.lastInsertRowid;
        }
      } catch (e) {
        log('error', 'db', 'User message insert failed', { session: id, err: e.message });
      }

      // Register for dedup suppression (proxy will scrape this back)
      const key = `${id}:${content}`;
      recentBrowserSends.set(key, Date.now());
      setTimeout(() => recentBrowserSends.delete(key), BROWSER_ECHO_DEDUP_WINDOW_SEC * 1000);

      // Ack to the sending browser
      ws.send(JSON.stringify({
        type:              'message_accepted',
        session:           id,
        client_message_id: clientMsgId,
        server_message_id: serverId,
        sequence:          finalSeq,
        ts:                messageTs,
      }));

      // Broadcast to all browsers (including other tabs)
      broadcastToBrowsers({
        type:              'message',
        session:           id,
        role:              'user',
        content,
        sequence:          finalSeq,
        server_message_id: serverId,
        ts:                messageTs,
      });

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

      if (!requestId || !agentType) {
        ws.send(JSON.stringify({
          type:             'connection_error',
          protocol_version: PROTOCOL_VERSION,
          code:             'invalid_message',
          message:          'launch_session requires request_id and agent_type',
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

      if (!sessionId) return;

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
      log('info', 'dismiss', 'Session dismissed by browser', { session: sessionId });
      broadcastToBrowsers({ type: 'session_list', sessions: getSessionList(), workspaces: cachedWorkspaces });

    // ── Permission response (A2-07) ────────────────────────────────────────
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
        submitting_choice_id: msg.choice_id || null,
        error: null,
      };
      broadcastToBrowsers(entry.prompt);
      if (msg.request_id) pendingCtrlReqs.set(msg.request_id, ws);
      if (msg.request_id) pendingPromptResponses.set(msg.request_id, {
        key,
        sessionId,
        promptId,
        choiceId: msg.choice_id || null,
      });
      proxyWs.send(JSON.stringify({ ...msg, type: 'permission_response' }));
      log('info', 'prompt', 'Permission response forwarded', { session: sessionId, prompt_id: promptId, choice: msg.choice_id });

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
      proxyWs.send(JSON.stringify({ ...msg, type: 'error_prompt_action' }));
      log('info', 'prompt', 'Error prompt action forwarded', { session: sessionId, prompt_id: promptId, action: msg.action_id });

    // ── Agent interrupt (A2-07) ────────────────────────────────────────────
    } else if (t === 'agent_interrupt') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
      const proxyWs   = proxySockets.get(sessionId);
      if (!proxyWs || proxyWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type:             'agent_control_result',
          protocol_version: PROTOCOL_VERSION,
          request_id:       requestId,
          session_id:       sessionId,
          command:          'agent_interrupt',
          result:           'failed',
          error:            { code: 'no_proxy_connected', message: 'Session not connected' },
          server_ts:        new Date().toISOString(),
        }));
        return;
      }
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'agent_interrupt',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
      }));
      log('info', 'ctrl', 'Agent interrupt forwarded', { session: sessionId, request_id: requestId });

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
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
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
      if (requestId) pendingCtrlReqs.set(requestId, ws);
      proxyWs.send(JSON.stringify({
        type:             'set_codex_config',
        protocol_version: PROTOCOL_VERSION,
        request_id:       requestId,
        session_id:       sessionId,
        model_id:         msg.model_id,
        effort:           msg.effort,
        speed:            msg.speed,
        access_mode:      msg.access_mode,
      }));
      log('info', 'ctrl', 'Set codex config forwarded', { session: sessionId, request_id: requestId });

    // ── Panel/agent control commands (Epics 2, 3, 4, 9) ──────────────────
    } else if (t === 'new_thread' || t === 'open_panel' || t === 'open_native_window' || t === 'chat_list' || t === 'switch_chat' || t === 'new_chat' || t === 'thread_list' || t === 'switch_thread' || t === 'switch_workspace' || t === 'terminal_output' || t === 'file_changes' || t === 'file_change_response' || t === 'send_attachment' || t === 'terminal_input' || t === 'branch_list' || t === 'switch_branch' || t === 'create_branch' || t === 'skill_list' || t === 'automation_view_action' || t === 'list_directory' || t === 'read_file') {
      const sessionId = msg.session_id || msg.session;
      const requestId = msg.request_id;
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
      }));
      log('info', 'ctrl', `${t} forwarded`, { session: sessionId, request_id: requestId });

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
    browserClients.delete(ws);
    // Clean up pending control requests that targeted this browser
    for (const [reqId, targetWs] of pendingCtrlReqs) {
      if (targetWs === ws) {
        pendingCtrlReqs.delete(reqId);
        pendingPayloadCtrlState.delete(reqId);
      }
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
