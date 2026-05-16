// session-store.js — Durable session matching and persistence
//
// Sessions survive proxy restarts by persisting metadata to session-store.json.
// On each CDP rediscovery the proxy attempts to match a discovered target to
// an existing session via target_signature before creating a new one.
//
// Covers task: A3-03 (durable session matching)

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const STORE_PATH      = path.join(__dirname, 'session-store.json');
const MAX_SESSIONS    = parseInt(process.env.SESSION_STORE_MAX || '200', 10);
const MAX_ACCUMULATED_BYTES = parseInt(process.env.SESSION_STORE_MAX_ACCUMULATED_BYTES || '2000000', 10);

// ─── Persistence ──────────────────────────────────────────────────────────────

let _store = _loadStore();

function _copyForSave() {
  const sessions = {};
  for (const [sid, sess] of Object.entries(_store.sessions || {})) {
    const copy = { ...sess };
    if (Array.isArray(copy.accumulated_messages)) {
      const size = Buffer.byteLength(JSON.stringify(copy.accumulated_messages), 'utf8');
      if (size > MAX_ACCUMULATED_BYTES) {
        delete copy.accumulated_messages;
        copy.accumulated_messages_omitted = {
          reason: 'size_limit',
          message_count: sess.accumulated_messages.length,
          bytes: size,
          limit: MAX_ACCUMULATED_BYTES,
          updated_at: new Date().toISOString(),
        };
      }
    }
    sessions[sid] = copy;
  }
  return { sessions, preferences: _store.preferences || {} };
}

function _loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      return {
        sessions: parsed && typeof parsed.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
        preferences: parsed && typeof parsed.preferences === 'object' && parsed.preferences ? parsed.preferences : {},
      };
    }
  } catch (e) {
    console.warn('[session-store] Failed to load:', e.message);
  }
  return { sessions: {}, preferences: {} };
}

function _saveStore() {
  const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(_copyForSave(), null, 2));
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, STORE_PATH);
        return;
      } catch (e) {
        lastError = e;
        // Windows file watchers and sync providers can briefly hold the JSON
        // file. A short blocking retry is cheaper than dropping the save and
        // leaving temp files behind during busy polling.
        if (attempt < 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
      }
    }
    throw lastError;
  } catch (e) {
    console.warn('[session-store] Failed to save:', e.message);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

// ─── Signature generation ─────────────────────────────────────────────────────
//
// The target_signature must be stable for the same logical panel while allowing
// multiple agent panels of the same type in the same window to coexist.
//
// extensionId is stable (baked into the installed extension URL).
// parentId identifies the Antigravity window, and the webview id differentiates
// multiple panels within that same window.

function buildTargetSignature(targetUrl, windowTitle, agentType) {
  const extMatch = targetUrl.match(/extensionId=([^&]+)/);
  const ext = extMatch ? extMatch[1] : 'unknown';
  const parentIdMatch = targetUrl.match(/[?&]parentId=([^&]+)/);
  const webviewIdMatch = targetUrl.match(/[?&]id=([^&]+)/);
  const parentId = parentIdMatch ? parentIdMatch[1] : 'unknown-parent';
  const webviewId = webviewIdMatch ? webviewIdMatch[1] : 'unknown-webview';
  const raw = `${agentType}|${ext}|${windowTitle}|${parentId}|${webviewId}`;
  return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
}

// ─── Session resolution ───────────────────────────────────────────────────────
//
// Given a discovered CDP target, find or create the durable session record.
// Returns the full session metadata object.

function resolveSession({ target, windowTitle, agentType, workspaceName, workspacePath, sigOverride }) {
  const machineLabel = os.hostname();
  // sigOverride allows callers (e.g. Antigravity Manager pages) to supply a
  // pre-computed signature string instead of deriving it from the target URL.
  const targetSignature = sigOverride
    ? crypto.createHash('sha1').update(sigOverride).digest('hex').substring(0, 16)
    : buildTargetSignature(target.url, windowTitle, agentType);

  // Primary match: same signature (stable URL parameters)
  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.target_signature === targetSignature) {
      sess.target_id    = target.id;
      sess.last_seen_at = new Date().toISOString();
      sess.status       = 'healthy';
      // Only overwrite workspace_name if the new value is meaningful (not a "window-N" placeholder)
      if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path = workspacePath;
      _saveStore();
      console.log(`[session-store] Matched ${sid} via sig=${targetSignature}`);
      return { ...sess, _matched_existing: true };
    }
  }

  // Fallback match: same physical CDP target_id with same agent_type.
  // Handles the case where Antigravity restarts and the webview URL gets new
  // parentId/id parameters — without this the store accumulates stale entries.
  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.target_id === target.id && sess.agent_type === agentType) {
      sess.target_signature = targetSignature; // update to new URL signature
      sess.last_seen_at     = new Date().toISOString();
      sess.status           = 'healthy';
      if (windowTitle)   sess.window_title    = windowTitle;
      if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path  = workspacePath;
      _saveStore();
      console.log(`[session-store] Matched ${sid} via target_id=${target.id} (sig updated)`);
      return { ...sess, _matched_existing: true };
    }
  }

  // Create a new durable session
  const session_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayNames = { claude: 'Claude Code', claude_cli: 'Claude Code CLI', codex: 'Codex', codex_cli: 'Codex CLI', gemini: 'Gemini', antigravity: 'Antigravity', continue: 'Continue' };

  const session = {
    session_id,
    agent_type:       agentType,
    display_name:     displayNames[agentType] || agentType,
    window_title:     windowTitle,
    workspace_name:   workspaceName || windowTitle,
    workspace_path:   workspacePath || null,
    machine_label:    machineLabel,
    target_signature: targetSignature,
    target_id:        target.id,
    created_at:       now,
    last_seen_at:     now,
    status:           'healthy',
    activity:         { kind: 'idle', label: '', updated_at: now },
  };

  _store.sessions[session_id] = session;
  _saveStore();
  console.log(`[session-store] New session ${session_id} (${agentType}, sig=${targetSignature})`);
  return { ...session, _matched_existing: false };
}

function resolveVirtualSession({ virtualId, agentType, displayName, workspaceName, workspacePath, windowTitle, extra }) {
  const machineLabel = os.hostname();
  const targetSignature = crypto.createHash('sha1')
    .update(`${agentType}|virtual|${virtualId || ''}`)
    .digest('hex')
    .substring(0, 16);

  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.target_signature === targetSignature) {
      sess.last_seen_at = new Date().toISOString();
      sess.status       = 'healthy';
      if (displayName)   sess.display_name   = displayName;
      if (windowTitle)   sess.window_title   = windowTitle;
      if (workspaceName) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path = workspacePath;
      if (extra && typeof extra === 'object') Object.assign(sess, extra);
      _saveStore();
      console.log(`[session-store] Matched virtual ${sid} via sig=${targetSignature}`);
      return { ...sess, _matched_existing: true };
    }
  }

  const session_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayNames = {
    claude: 'Claude Code',
    claude_cli: 'Claude Code CLI',
    codex: 'Codex',
    codex_cli: 'Codex CLI',
    gemini: 'Gemini',
    antigravity: 'Antigravity',
    continue: 'Continue',
  };

  const session = {
    session_id,
    agent_type:       agentType,
    display_name:     displayName || displayNames[agentType] || agentType,
    window_title:     windowTitle || displayName || workspaceName || agentType,
    workspace_name:   workspaceName || windowTitle || displayName || agentType,
    workspace_path:   workspacePath || null,
    machine_label:    machineLabel,
    target_signature: targetSignature,
    target_id:        null,
    virtual_id:       virtualId || null,
    created_at:       now,
    last_seen_at:     now,
    status:           'healthy',
    activity:         { kind: 'idle', label: '', updated_at: now },
    ...(extra && typeof extra === 'object' ? extra : {}),
  };

  _store.sessions[session_id] = session;
  _saveStore();
  console.log(`[session-store] New virtual session ${session_id} (${agentType}, sig=${targetSignature})`);
  return { ...session, _matched_existing: false };
}

// ─── Session updates ──────────────────────────────────────────────────────────

function updateSession(session_id, updates) {
  if (!_store.sessions[session_id]) return;
  Object.assign(_store.sessions[session_id], updates);
  _saveStore();
}

function markDisconnected(session_id) {
  updateSession(session_id, {
    status:       'disconnected',
    last_seen_at: new Date().toISOString(),
  });
}

function updatePreference(preference_key, updates) {
  if (!preference_key) return;
  const existing = _store.preferences[preference_key] || { preference_key };
  _store.preferences[preference_key] = { ...existing, ...updates, updated_at: new Date().toISOString() };
  _saveStore();
}

function getPreference(preference_key) {
  if (!preference_key) return null;
  const pref = _store.preferences[preference_key];
  return pref ? { ...pref } : null;
}

// ─── TTL pruning ──────────────────────────────────────────────────────────────
//
// Removes entries that haven't been seen in `maxAgeDays` days AND are not
// currently connected (status !== 'healthy'). Called at proxy startup so the
// store doesn't grow unboundedly over time.

function pruneStale(maxAgeDays = 1) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.status === 'healthy') continue; // never prune active sessions
    const lastSeen = sess.last_seen_at ? new Date(sess.last_seen_at).getTime() : 0;
    if (lastSeen < cutoff) {
      delete _store.sessions[sid];
      pruned++;
    }
  }
  if (pruned > 0) {
    _saveStore();
    console.log(`[session-store] Pruned ${pruned} stale session(s) older than ${maxAgeDays} days`);
  }

  // Hard cap: prune oldest by last_seen_at if total exceeds MAX_SESSIONS (A8-02)
  const total = Object.keys(_store.sessions).length;
  if (total > MAX_SESSIONS) {
    const target = Math.floor(MAX_SESSIONS / 2);
    const sorted = Object.entries(_store.sessions).sort((a, b) => {
      const ta = a[1].last_seen_at ? new Date(a[1].last_seen_at).getTime() : 0;
      const tb = b[1].last_seen_at ? new Date(b[1].last_seen_at).getTime() : 0;
      return ta - tb; // oldest first
    });
    const toRemove = sorted.slice(0, total - target);
    for (const [sid] of toRemove) delete _store.sessions[sid];
    _saveStore();
    console.warn(`[session-store] Pruned ${toRemove.length} sessions (cap=${MAX_SESSIONS}, reduced to ${target})`);
  }

  return pruned;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function getSession(session_id) {
  const s = _store.sessions[session_id];
  return s ? { ...s } : null;
}

function getAllSessions() {
  return Object.values(_store.sessions).map(s => ({ ...s }));
}

module.exports = {
  resolveSession,
  resolveVirtualSession,
  updateSession,
  markDisconnected,
  updatePreference,
  getPreference,
  getSession,
  getAllSessions,
  pruneStale,
};
