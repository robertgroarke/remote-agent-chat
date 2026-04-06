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

// ─── Persistence ──────────────────────────────────────────────────────────────

let _store = _loadStore();

function _loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[session-store] Failed to load:', e.message);
  }
  return { sessions: {} };
}

function _saveStore() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2));
  } catch (e) {
    console.warn('[session-store] Failed to save:', e.message);
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
      return { ...sess };
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
      return { ...sess };
    }
  }

  // Create a new durable session
  const session_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayNames = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', antigravity: 'Antigravity', continue: 'Continue' };

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
  return { ...session };
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
  updateSession,
  markDisconnected,
  getSession,
  getAllSessions,
  pruneStale,
};
