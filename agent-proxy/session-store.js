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
const { isDeepStrictEqual } = require('util');

// Rescue drills and isolated proxy fixtures must never race the production
// proxy's durable store. Production keeps the historical default; callers
// may opt into a separate absolute path before requiring this module.
const STORE_PATH      = path.resolve(process.env.SESSION_STORE_PATH || path.join(__dirname, 'session-store.json'));
const MAX_SESSIONS    = parseInt(process.env.SESSION_STORE_MAX || '200', 10);
const MAX_ACCUMULATED_BYTES = parseInt(process.env.SESSION_STORE_MAX_ACCUMULATED_BYTES || '2000000', 10);

function _processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function _cleanupStaleTempFiles() {
  const directory = path.dirname(STORE_PATH);
  const prefix = `${path.basename(STORE_PATH)}.`;
  if (!fs.existsSync(directory)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.tmp')) continue;
    const pid = Number.parseInt(entry.slice(prefix.length).split('.', 1)[0], 10);
    if (_processIsAlive(pid)) continue;
    try {
      fs.unlinkSync(path.join(directory, entry));
      removed += 1;
    } catch {}
  }
  if (removed > 0) console.log(`[session-store] Removed ${removed} stale temp file(s)`);
  return removed;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

_cleanupStaleTempFiles();
let _store = _loadStore();
let _saveTimer = null;
let _saveFirstRequestedAt = 0;
const SAVE_DEBOUNCE_MS = Math.max(250, parseInt(process.env.SESSION_STORE_SAVE_DEBOUNCE_MS || '10000', 10) || 10000);
const SAVE_MAX_WAIT_MS = Math.max(SAVE_DEBOUNCE_MS, parseInt(process.env.SESSION_STORE_SAVE_MAX_WAIT_MS || '30000', 10) || 30000);
const COALESCED_UPDATE_KEYS = new Set([
  'last_seen_at',
  'activity',
  'accumulated_messages',
  'cursor_agent_histories',
  'cursor_active_thread_key',
  'cursor_message_observation_seq',
  'codex_desktop_active_thread_key',
  'codex_desktop_active_thread_title',
]);
const LAST_SEEN_PERSIST_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.SESSION_STORE_LAST_SEEN_PERSIST_MS || String(60 * 60 * 1000), 10) || 60 * 60 * 1000,
);
const _persistedLastSeen = new WeakMap();
for (const session of Object.values(_store.sessions || {})) {
  _persistedLastSeen.set(session, Date.parse(session.last_seen_at || '') || 0);
}

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
    if (copy.cursor_agent_histories && typeof copy.cursor_agent_histories === 'object') {
      const size = Buffer.byteLength(JSON.stringify(copy.cursor_agent_histories), 'utf8');
      if (size > MAX_ACCUMULATED_BYTES) {
        delete copy.cursor_agent_histories;
        copy.cursor_agent_histories_omitted = {
          reason: 'size_limit',
          thread_count: Object.keys(sess.cursor_agent_histories || {}).length,
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
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = null;
  _saveFirstRequestedAt = 0;
  const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(_copyForSave(), null, 2));
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, STORE_PATH);
        for (const session of Object.values(_store.sessions || {})) {
          _persistedLastSeen.set(session, Date.parse(session.last_seen_at || '') || Date.now());
        }
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

function buildTargetSignature(targetUrl, windowTitle, agentType, hostType = null) {
  const extMatch = targetUrl.match(/extensionId=([^&]+)/);
  const ext = extMatch ? extMatch[1] : 'unknown';
  const parentIdMatch = targetUrl.match(/[?&]parentId=([^&]+)/);
  const webviewIdMatch = targetUrl.match(/[?&]id=([^&]+)/);
  const parentId = parentIdMatch ? parentIdMatch[1] : 'unknown-parent';
  const webviewId = webviewIdMatch ? webviewIdMatch[1] : 'unknown-webview';
  const legacyRaw = `${agentType}|${ext}|${windowTitle}|${parentId}|${webviewId}`;
  const raw = hostType ? `${hostType}|${legacyRaw}` : legacyRaw;
  return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
}

function flushPendingSaves() {
  if (_saveTimer) clearTimeout(_saveTimer);
  const hadPendingSave = _saveTimer !== null || _saveFirstRequestedAt > 0;
  _saveTimer = null;
  _saveFirstRequestedAt = 0;
  if (hadPendingSave && fs.existsSync(path.dirname(STORE_PATH))) _saveStore();
  return hadPendingSave;
}

function _scheduleSave() {
  const now = Date.now();
  if (!_saveFirstRequestedAt) _saveFirstRequestedAt = now;
  if (_saveTimer) clearTimeout(_saveTimer);
  const remaining = Math.max(0, SAVE_MAX_WAIT_MS - (now - _saveFirstRequestedAt));
  _saveTimer = setTimeout(flushPendingSaves, Math.min(SAVE_DEBOUNCE_MS, remaining));
  _saveTimer.unref?.();
}

function _activityPersistenceSignature(activity) {
  if (!activity || typeof activity !== 'object') return JSON.stringify(activity || null);
  const copy = { ...activity };
  delete copy.updated_at;
  delete copy.thinkingContent;
  delete copy.thinking_content;
  delete copy.thinking;
  delete copy.transport;
  delete copy.usage;
  if (copy.goal && typeof copy.goal === 'object') {
    copy.goal = { ...copy.goal };
    [
      'updated_at', 'time_used_seconds', 'elapsed_seconds', 'tokens_used',
      'progress', 'progress_percent', 'percent', 'percent_complete',
    ].forEach(key => delete copy.goal[key]);
  }
  return JSON.stringify(copy);
}

function _updatesChangeDurableState(session, updates) {
  for (const [key, value] of Object.entries(updates || {})) {
    if (key === 'last_seen_at') continue;
    if (key === 'activity') {
      if (_activityPersistenceSignature(session.activity) !== _activityPersistenceSignature(value)) return true;
      continue;
    }
    if (!isDeepStrictEqual(session[key], value)) return true;
  }
  return false;
}

function _setIfChanged(target, key, value) {
  if (isDeepStrictEqual(target[key], value)) return false;
  target[key] = value;
  return true;
}

function _touchLastSeen(session, value = new Date().toISOString()) {
  const persistedAt = _persistedLastSeen.get(session) ?? (Date.parse(session.last_seen_at || '') || 0);
  session.last_seen_at = value;
  const observedAt = Date.parse(value) || Date.now();
  return observedAt - persistedAt >= LAST_SEEN_PERSIST_INTERVAL_MS;
}

// A synchronous exit hook is deliberately small: it only runs when a delayed
// durable update is pending, preserving the existing crash/restart contract
// without rewriting the multi-megabyte store on every polling touch.
process.once('exit', flushPendingSaves);

function _normalizeCursorWorkspacePath(value) {
  return String(value || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

function _normalizeCursorWorkspaceName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildCursorStableSignatureSource({ workspacePath, workspaceName, windowTitle, cursorAgentId, cursorWorkspaceKey }) {
  const normalizedAgentId = String(cursorAgentId || '').trim().toLowerCase();
  if (normalizedAgentId) {
    const normalizedWorkspaceKey = String(cursorWorkspaceKey || '').trim().toLowerCase();
    return `cursor::agent::${normalizedWorkspaceKey || 'unknown-workspace'}::${normalizedAgentId}`;
  }
  const normalizedPath = _normalizeCursorWorkspacePath(workspacePath);
  if (normalizedPath) return `cursor::workspace::${normalizedPath}`;
  const normalizedName = _normalizeCursorWorkspaceName(workspaceName || windowTitle || 'cursor');
  return `cursor::surface::${normalizedName || 'cursor'}`;
}

function _cursorSessionHistoryDepth(session) {
  const accumulated = Array.isArray(session?.accumulated_messages)
    ? session.accumulated_messages.length
    : 0;
  const histories = session?.cursor_agent_histories && typeof session.cursor_agent_histories === 'object'
    ? Object.values(session.cursor_agent_histories)
    : [];
  const deepestHistory = histories.reduce((max, messages) => (
    Array.isArray(messages) ? Math.max(max, messages.length) : max
  ), 0);
  return Math.max(accumulated, deepestHistory);
}

function findCursorStableSession(sessions, { workspacePath, workspaceName, windowTitle, cursorAgentId }) {
  const normalizedAgentId = String(cursorAgentId || '').trim().toLowerCase();
  if (normalizedAgentId) {
    const match = Object.entries(sessions || {}).find(([, session]) => (
      session?.agent_type === 'cursor'
      && String(session.cursor_agent_id || '').trim().toLowerCase() === normalizedAgentId
    ));
    return match || null;
  }
  const normalizedPath = _normalizeCursorWorkspacePath(workspacePath);
  const normalizedName = _normalizeCursorWorkspaceName(workspaceName || windowTitle);
  const matches = Object.entries(sessions || {}).filter(([, session]) => {
    if (session?.agent_type !== 'cursor') return false;
    const sessionPath = _normalizeCursorWorkspacePath(session.workspace_path);
    if (normalizedPath) return sessionPath === normalizedPath;
    if (sessionPath) return false;
    return _normalizeCursorWorkspaceName(session.workspace_name || session.window_title) === normalizedName;
  });
  matches.sort((a, b) => {
    const historyDelta = _cursorSessionHistoryDepth(b[1]) - _cursorSessionHistoryDepth(a[1]);
    if (historyDelta) return historyDelta;
    return String(a[1]?.created_at || '').localeCompare(String(b[1]?.created_at || ''));
  });
  return matches[0] || null;
}

const SINGLETON_EXTENSION_AGENTS = new Set(['continue', 'gemini', 'roo_code']);

function buildSingletonExtensionStableKey({ agentType, hostType, cdpPort, workbenchWindowId, workspacePath }) {
  const normalizedPath = _normalizeCursorWorkspacePath(workspacePath);
  if (!SINGLETON_EXTENSION_AGENTS.has(agentType) || !normalizedPath) return null;
  return [
    'singleton-extension',
    String(hostType || 'unknown-host').toLowerCase(),
    Number.isInteger(Number(cdpPort)) ? Number(cdpPort) : 'unknown-port',
    String(workbenchWindowId || 'unknown-window').toLowerCase(),
    agentType,
    normalizedPath,
  ].join('::');
}

function findSingletonExtensionSession(sessions, options) {
  const stableKey = buildSingletonExtensionStableKey(options);
  if (!stableKey) return null;
  const normalizedPath = _normalizeCursorWorkspacePath(options.workspacePath);
  const cdpPort = Number(options.cdpPort);
  const workbenchWindowId = String(options.workbenchWindowId || '').toLowerCase();
  const hostType = String(options.hostType || '').toLowerCase();
  const matches = Object.entries(sessions || {}).filter(([, session]) => {
    if (session?.agent_type !== options.agentType) return false;
    if (_normalizeCursorWorkspacePath(session.workspace_path) !== normalizedPath) return false;
    if (hostType && session.host_type && String(session.host_type).toLowerCase() !== hostType) return false;
    if (Number.isInteger(cdpPort) && session.cdp_port != null && session.cdp_port !== '' && Number(session.cdp_port) !== cdpPort) return false;
    if (workbenchWindowId && session.workbench_window_id && String(session.workbench_window_id).toLowerCase() !== workbenchWindowId) return false;
    return true;
  });
  if (matches.length === 0) return null;

  const canonical = matches.filter(([, session]) => (
    session.stable_surface_key === stableKey
    && session.stable_surface_version === 2
    && !session.superseded_by
  ));
  const ranked = (canonical.length > 0 ? canonical : matches).slice().sort((a, b) => {
    const createdDelta = Date.parse(a[1].created_at || 0) - Date.parse(b[1].created_at || 0);
    if (createdDelta) return createdDelta;
    return Date.parse(b[1].last_seen_at || 0) - Date.parse(a[1].last_seen_at || 0);
  });
  return { match: ranked[0], matches, stableKey };
}

// ─── Session resolution ───────────────────────────────────────────────────────
//
// Given a discovered CDP target, find or create the durable session record.
// Returns the full session metadata object.

function resolveSession({
  target,
  windowTitle,
  agentType,
  workspaceName,
  workspacePath,
  hostType,
  hostLabel,
  sigOverride,
  cursorAgentId,
  cursorAgentTitle,
  cursorWorkspaceKey,
}) {
  const machineLabel = os.hostname();
  // sigOverride allows callers (e.g. Antigravity Manager pages) to supply a
  // pre-computed signature string instead of deriving it from the target URL.
  const targetSignature = sigOverride
    ? crypto.createHash('sha1').update(sigOverride).digest('hex').substring(0, 16)
    : buildTargetSignature(target.url, windowTitle, agentType, hostType);
  const legacyTargetSignature = !sigOverride && hostType
    ? buildTargetSignature(target.url, windowTitle, agentType)
    : null;
  const workbenchWindowId = ((String(target.url || '').match(/[?&]parentId=([^&]+)/i) || [])[1] || '').toLowerCase();
  const applyHostIdentity = (sess) => {
    if (hostType) sess.host_type = hostType;
    if (hostLabel) sess.host_label = hostLabel;
    if (Number.isInteger(target?._cdpPort)) sess.cdp_port = target._cdpPort;
    if (workbenchWindowId) sess.workbench_window_id = workbenchWindowId;
  };
  const applyCursorIdentity = (sess) => {
    if (agentType !== 'cursor') return;
    if (cursorAgentId) sess.cursor_agent_id = cursorAgentId;
    if (cursorAgentTitle) sess.cursor_agent_title = cursorAgentTitle;
    if (cursorWorkspaceKey) sess.cursor_workspace_key = cursorWorkspaceKey;
  };

  const singletonMatch = findSingletonExtensionSession(_store.sessions, {
    agentType,
    hostType,
    cdpPort: target?._cdpPort,
    workbenchWindowId,
    workspacePath,
  });
  if (singletonMatch) {
    const [sid, sess] = singletonMatch.match;
    let durableChanged = false;
    durableChanged = _setIfChanged(sess, 'target_signature', targetSignature) || durableChanged;
    durableChanged = _setIfChanged(sess, 'target_id', target.id) || durableChanged;
    durableChanged = _touchLastSeen(sess) || durableChanged;
    durableChanged = _setIfChanged(sess, 'status', 'healthy') || durableChanged;
    durableChanged = _setIfChanged(sess, 'stable_surface_key', singletonMatch.stableKey) || durableChanged;
    durableChanged = _setIfChanged(sess, 'stable_surface_version', 2) || durableChanged;
    if (Object.prototype.hasOwnProperty.call(sess, 'superseded_by')) {
      delete sess.superseded_by;
      durableChanged = true;
    }
    if (windowTitle) durableChanged = _setIfChanged(sess, 'window_title', windowTitle) || durableChanged;
    if (workspaceName && !/^window-\d+$/.test(workspaceName)) durableChanged = _setIfChanged(sess, 'workspace_name', workspaceName) || durableChanged;
    if (workspacePath) durableChanged = _setIfChanged(sess, 'workspace_path', workspacePath) || durableChanged;
    const beforeHostIdentity = JSON.stringify([sess.host_type, sess.host_label, sess.cdp_port, sess.workbench_window_id]);
    applyHostIdentity(sess);
    durableChanged = beforeHostIdentity !== JSON.stringify([sess.host_type, sess.host_label, sess.cdp_port, sess.workbench_window_id]) || durableChanged;
    for (const [duplicateSid, duplicate] of singletonMatch.matches) {
      if (duplicateSid === sid) continue;
      durableChanged = _setIfChanged(duplicate, 'status', 'disconnected') || durableChanged;
      durableChanged = _setIfChanged(duplicate, 'superseded_by', sid) || durableChanged;
    }
    if (durableChanged) {
      _scheduleSave();
      console.log(`[session-store] Matched ${sid} via stable singleton extension surface (${agentType})`);
    }
    return { ...sess, _matched_existing: true };
  }

  // Cursor target IDs change on every full app restart. Resolve its stable
  // workspace identity before the generic signature/target matches so a short
  // duplicate created by an earlier failed restart cannot take precedence over
  // the original durable transcript.
  const cursorMatch = agentType === 'cursor'
    ? findCursorStableSession(_store.sessions, { workspacePath, workspaceName, windowTitle, cursorAgentId })
    : null;
  if (cursorMatch) {
    const [sid, sess] = cursorMatch;
    const before = JSON.stringify([
      sess.target_signature, sess.target_id, sess.status, sess.window_title,
      sess.workspace_name, sess.workspace_path, sess.host_type, sess.host_label,
      sess.cdp_port, sess.workbench_window_id, sess.cursor_agent_id,
      sess.cursor_agent_title, sess.cursor_workspace_key,
    ]);
    sess.target_signature = targetSignature;
    sess.target_id = target.id;
    const persistLastSeen = _touchLastSeen(sess);
    sess.status = 'healthy';
    if (windowTitle) sess.window_title = windowTitle;
    if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
    if (workspacePath) sess.workspace_path = workspacePath;
    applyHostIdentity(sess);
    applyCursorIdentity(sess);
    const after = JSON.stringify([
      sess.target_signature, sess.target_id, sess.status, sess.window_title,
      sess.workspace_name, sess.workspace_path, sess.host_type, sess.host_label,
      sess.cdp_port, sess.workbench_window_id, sess.cursor_agent_id,
      sess.cursor_agent_title, sess.cursor_workspace_key,
    ]);
    if (before !== after || persistLastSeen) {
      _scheduleSave();
      console.log(`[session-store] Matched ${sid} via stable Cursor workspace (sig migrated to ${targetSignature})`);
    }
    return { ...sess, _matched_existing: true };
  }

  // Primary match: same signature (stable URL parameters)
  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.target_signature === targetSignature) {
      if (agentType === 'cursor' && cursorAgentId
          && String(sess.cursor_agent_id || '').toLowerCase() !== String(cursorAgentId).toLowerCase()) continue;
      const before = JSON.stringify([
        sess.target_id, sess.status, sess.window_title, sess.workspace_name,
        sess.workspace_path, sess.host_type, sess.host_label, sess.cdp_port,
        sess.workbench_window_id, sess.cursor_agent_id, sess.cursor_agent_title,
        sess.cursor_workspace_key,
      ]);
      sess.target_id    = target.id;
      const persistLastSeen = _touchLastSeen(sess);
      sess.status       = 'healthy';
      if (windowTitle) sess.window_title = windowTitle;
      // Only overwrite workspace_name if the new value is meaningful (not a "window-N" placeholder)
      if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path = workspacePath;
      applyHostIdentity(sess);
      applyCursorIdentity(sess);
      const after = JSON.stringify([
        sess.target_id, sess.status, sess.window_title, sess.workspace_name,
        sess.workspace_path, sess.host_type, sess.host_label, sess.cdp_port,
        sess.workbench_window_id, sess.cursor_agent_id, sess.cursor_agent_title,
        sess.cursor_workspace_key,
      ]);
      if (before !== after || persistLastSeen) {
        _scheduleSave();
        console.log(`[session-store] Matched ${sid} via sig=${targetSignature}`);
      }
      return { ...sess, _matched_existing: true };
    }
  }

  // One-time migration for extension sessions created before host identity was
  // part of the signature. Keep the durable relay/sidebar ID while moving the
  // record onto the collision-safe host-qualified signature.
  if (legacyTargetSignature) {
    for (const [sid, sess] of Object.entries(_store.sessions)) {
      if (sess.target_signature !== legacyTargetSignature || sess.agent_type !== agentType) continue;
      sess.target_signature = targetSignature;
      sess.target_id = target.id;
      sess.last_seen_at = new Date().toISOString();
      sess.status = 'healthy';
      if (windowTitle) sess.window_title = windowTitle;
      if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path = workspacePath;
      applyHostIdentity(sess);
      applyCursorIdentity(sess);
      _scheduleSave();
      console.log(`[session-store] Matched ${sid} via legacy signature (host migrated to ${hostType})`);
      return { ...sess, _matched_existing: true };
    }
  }

  // Fallback match: same physical CDP target_id with same agent_type.
  // Handles the case where Antigravity restarts and the webview URL gets new
  // parentId/id parameters — without this the store accumulates stale entries.
  for (const [sid, sess] of Object.entries(_store.sessions)) {
    if (sess.target_id === target.id && sess.agent_type === agentType) {
      if (agentType === 'cursor' && cursorAgentId
          && String(sess.cursor_agent_id || '').toLowerCase() !== String(cursorAgentId).toLowerCase()) continue;
      sess.target_signature = targetSignature; // update to new URL signature
      sess.last_seen_at     = new Date().toISOString();
      sess.status           = 'healthy';
      if (windowTitle)   sess.window_title    = windowTitle;
      if (workspaceName && !/^window-\d+$/.test(workspaceName)) sess.workspace_name = workspaceName;
      if (workspacePath) sess.workspace_path  = workspacePath;
      applyHostIdentity(sess);
      applyCursorIdentity(sess);
      _scheduleSave();
      console.log(`[session-store] Matched ${sid} via target_id=${target.id} (sig updated)`);
      return { ...sess, _matched_existing: true };
    }
  }

  // Create a new durable session
  const session_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayNames = { claude: 'Claude Code', claude_cli: 'Claude Code CLI', codex: 'Codex', codex_cli: 'Codex CLI', cursor: 'Cursor', cursor_cli: 'Cursor CLI', gemini: 'Gemini', antigravity: 'Antigravity', 'antigravity-v2': 'Antigravity v2', continue: 'Continue' };

  const session = {
    session_id,
    agent_type:       agentType,
    display_name:     displayNames[agentType] || agentType,
    window_title:     windowTitle,
    workspace_name:   workspaceName || windowTitle,
    workspace_path:   workspacePath || null,
    host_type:         hostType || null,
    host_label:        hostLabel || null,
    machine_label:    machineLabel,
    target_signature: targetSignature,
    target_id:        target.id,
    cdp_port:         Number.isInteger(target?._cdpPort) ? target._cdpPort : null,
    workbench_window_id: workbenchWindowId || null,
    stable_surface_key: buildSingletonExtensionStableKey({
      agentType,
      hostType,
      cdpPort: target?._cdpPort,
      workbenchWindowId,
      workspacePath,
    }),
    stable_surface_version: SINGLETON_EXTENSION_AGENTS.has(agentType) ? 2 : null,
    cursor_agent_id: agentType === 'cursor' ? (cursorAgentId || null) : null,
    cursor_agent_title: agentType === 'cursor' ? (cursorAgentTitle || null) : null,
    cursor_workspace_key: agentType === 'cursor' ? (cursorWorkspaceKey || null) : null,
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
      const updates = {
        status: 'healthy',
        ...(displayName ? { display_name: displayName } : {}),
        ...(windowTitle ? { window_title: windowTitle } : {}),
        ...(workspaceName ? { workspace_name: workspaceName } : {}),
        ...(workspacePath ? { workspace_path: workspacePath } : {}),
        ...(extra && typeof extra === 'object'
          ? Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined))
          : {}),
      };
      let durableChanged = _updatesChangeDurableState(sess, updates);
      durableChanged = _touchLastSeen(sess) || durableChanged;
      Object.assign(sess, updates);
      if (durableChanged) {
        _scheduleSave();
        console.log(`[session-store] Matched virtual ${sid} via sig=${targetSignature}`);
      }
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
    cursor_cli: 'Cursor CLI',
    gemini: 'Gemini',
    antigravity: 'Antigravity',
    'antigravity-v2': 'Antigravity v2',
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
  const session = _store.sessions[session_id];
  if (!session || !updates || typeof updates !== 'object') return false;
  const persistLastSeen = Object.prototype.hasOwnProperty.call(updates, 'last_seen_at')
    && ((Date.parse(updates.last_seen_at || '') || Date.now())
      - (_persistedLastSeen.get(session) ?? (Date.parse(session.last_seen_at || '') || 0))
      >= LAST_SEEN_PERSIST_INTERVAL_MS);
  const durableChanged = _updatesChangeDurableState(session, updates) || persistLastSeen;
  Object.assign(session, updates);
  if (durableChanged) {
    const keys = Object.keys(updates);
    if (keys.length > 0 && keys.every(key => COALESCED_UPDATE_KEYS.has(key))) _scheduleSave();
    else _saveStore();
  }
  return durableChanged;
}

function migrateVirtualSession(session_id, virtualId, agentType = null) {
  const session = _store.sessions[session_id];
  if (!session || !virtualId) return null;
  const effectiveAgentType = agentType || session.agent_type;
  const targetSignature = crypto.createHash('sha1')
    .update(`${effectiveAgentType}|virtual|${virtualId}`)
    .digest('hex')
    .substring(0, 16);
  let structuralChanged = false;
  for (const [otherId, other] of Object.entries(_store.sessions)) {
    if (otherId === session_id || other.target_signature !== targetSignature) continue;
    structuralChanged = _setIfChanged(other, 'status', 'disconnected') || structuralChanged;
  }
  structuralChanged = _setIfChanged(session, 'virtual_id', virtualId) || structuralChanged;
  structuralChanged = _setIfChanged(session, 'target_signature', targetSignature) || structuralChanged;
  structuralChanged = _setIfChanged(session, 'status', 'healthy') || structuralChanged;
  const persistLastSeen = _touchLastSeen(session);
  if (structuralChanged) _saveStore();
  else if (persistLastSeen) _scheduleSave();
  return { ...session };
}

function markDisconnected(session_id) {
  updateSession(session_id, {
    status:       'disconnected',
    last_seen_at: new Date().toISOString(),
  });
}

function removeOwnedDisposableSession(session_id, expected = {}) {
  const session = _store.sessions[session_id];
  const scope = String(expected.scope || '');
  const tokenHash = String(expected.tokenHash || '').toLowerCase();
  const cliSessionId = String(expected.cliSessionId || '');
  const workspacePath = expected.workspacePath ? path.resolve(expected.workspacePath) : '';
  if (!session) return { removed: false, reason: 'session_not_found', removed_session_ids: [] };
  if (!scope || !/^[a-f0-9]{64}$/.test(tokenHash) || !cliSessionId || !workspacePath) {
    return { removed: false, reason: 'invalid_expected_identity', removed_session_ids: [] };
  }
  const storedHash = String(session.owned_disposable_token_hash || '').toLowerCase();
  const hashMatches = /^[a-f0-9]{64}$/.test(storedHash)
    && crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(tokenHash, 'hex'));
  if (session.owned_disposable_scope !== scope
      || !hashMatches
      || session.cli_session_id !== cliSessionId
      || path.resolve(session.workspace_path || '') !== workspacePath) {
    return { removed: false, reason: 'owned_identity_mismatch', removed_session_ids: [] };
  }

  const removedSessionIds = [];
  for (const [sid, candidate] of Object.entries(_store.sessions)) {
    if (candidate.owned_disposable_scope !== scope) continue;
    if (String(candidate.owned_disposable_token_hash || '').toLowerCase() !== tokenHash) continue;
    if (candidate.cli_session_id !== cliSessionId) continue;
    if (path.resolve(candidate.workspace_path || '') !== workspacePath) continue;
    _persistedLastSeen.delete(candidate);
    delete _store.sessions[sid];
    removedSessionIds.push(sid);
  }
  if (removedSessionIds.length === 0) {
    return { removed: false, reason: 'owned_aliases_not_found', removed_session_ids: [] };
  }
  _saveStore();
  return {
    removed: true,
    reason: 'owned_disposable_removed',
    removed_session_ids: removedSessionIds,
  };
}

function updatePreference(preference_key, updates) {
  if (!preference_key) return;
  const existing = _store.preferences[preference_key] || { preference_key };
  _store.preferences[preference_key] = { ...existing, ...updates, updated_at: new Date().toISOString() };
  _saveStore();
}

function replacePreference(preference_key, value) {
  if (!preference_key) return;
  const replacement = value && typeof value === 'object' ? value : {};
  _store.preferences[preference_key] = {
    preference_key,
    ...replacement,
    updated_at: new Date().toISOString(),
  };
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
  buildTargetSignature,
  buildCursorStableSignatureSource,
  findCursorStableSession,
  buildSingletonExtensionStableKey,
  findSingletonExtensionSession,
  resolveSession,
  resolveVirtualSession,
  updateSession,
  migrateVirtualSession,
  markDisconnected,
  removeOwnedDisposableSession,
  updatePreference,
  getPreference,
  replacePreference,
  getSession,
  getAllSessions,
  pruneStale,
  flushPendingSaves,
};
