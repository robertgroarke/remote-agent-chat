// proxy-engine.js — Core proxy engine, shared between standalone and VSIX modes
//
// Extracts the CDP discovery, relay connection, session polling, and message
// handling logic from index.js into a reusable class. Both the standalone
// Node.js process and the VS Code extension instantiate this engine with
// their respective configurations.
//
// Usage:
//   const { ProxyEngine } = require('./proxy-engine');
//   const engine = new ProxyEngine({ cdpPorts, relayUrl, ... });
//   engine.on('log', (level, msg) => console.log(msg));
//   await engine.start();
//   // later:
//   engine.stop();

'use strict';

const CDP = require('chrome-remote-interface');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const selectors    = require('./selectors');
const proto        = require('./protocol');
const sessionStore = require('./session-store');
const launchers    = require('./launchers');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Codex model/effort/access constants ────────────────────────────────────

const CODEX_MODELS = [
  { id: 'gpt-5.4',           label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',      label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex',     label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',     label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2',           label: 'GPT-5.2' },
  { id: 'gpt-5.1-codex',     label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1',           label: 'GPT-5.1' },
  { id: 'gpt-5',             label: 'GPT-5' },
];
const CODEX_EFFORTS = [
  { id: 'low',        label: 'Low' },
  { id: 'medium',     label: 'Medium' },
  { id: 'high',       label: 'High' },
  { id: 'extra-high', label: 'Extra High' },
];
const CODEX_ACCESS_MODES = [
  { id: 'read-only',          label: 'Read only' },
  { id: 'workspace-write',    label: 'Workspace write' },
  { id: 'danger-full-access', label: 'Full access' },
];

// ─── Retriable send codes ───────────────────────────────────────────────────

const RETRIABLE_SEND_CODES = new Set([
  'input_not_found',
  'send_button_failed',
  'fallback_no_input',
  // agent_busy is NOT retriable — messages are queued instead (steer feature)
]);
const SEND_MAX_RETRIES    = 8;
const SEND_RETRY_DELAY_MS = 3000;

// ─── ProxyEngine class ─────────────────────────────────────────────────────

class ProxyEngine extends EventEmitter {

  /**
   * @param {object} config
   * @param {number[]} config.cdpPorts       — CDP port numbers to scan
   * @param {string}   config.relayUrl       — Base relay WebSocket URL
   * @param {string}   [config.proxySecret]  — Shared secret for relay auth
   * @param {string}   [config.machineLabel] — Machine label for session metadata
   * @param {string}   [config.uploadDir]    — Directory for uploaded files
   */
  constructor(config) {
    super();

    this.CDP_PORTS = config.cdpPorts;
    this.RELAY_URL_BASE = config.relayUrl;
    this.PROXY_SECRET = config.proxySecret || null;
    this.RELAY_URL = this.RELAY_URL_BASE; // SEC-02: secret moved to connection_hello message
    this.MACHINE_LABEL = config.machineLabel || require('os').hostname();
    this.PROXY_ID = crypto.randomUUID();
    this.POLL_INTERVAL_MS = 1000;

    // Upload directory
    this.LOCAL_UPLOAD_DIR = config.uploadDir || path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(this.LOCAL_UPLOAD_DIR)) fs.mkdirSync(this.LOCAL_UPLOAD_DIR, { recursive: true });

    // Codex config path
    this.CODEX_CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');

    // In-memory session runtime state
    this.sessions = new Map();
    this.activePermissionPrompts = new Map();
    this.openWorkspaces = [];

    // Relay connection state
    this.relayWs = null;
    this.relayReady = false;
    this.connectionId = null;
    this.hbIntervalMs = 10000;
    this.hbTimer = null;
    this.reconnectAttempt = 0;
    this.MAX_RECONNECT_DELAY_MS = 60000;

    // Snapshot debounce timer
    this._snapshotTimer = null;

    // Main poll interval handle
    this._pollTimer = null;

    // Window-staggered polling: rotate which parentId (window) gets polled each tick
    // to avoid rapid CDP interactions across multiple Antigravity windows that cause
    // OS-level focus stealing.
    this._pollWindowIndex = 0;

    // Running flag
    this._running = false;
  }

  // ─── Logging helper ──────────────────────────────────────────────────────

  _log(level, msg) {
    this.emit('log', level, msg);
  }

  // ─── Antigravity settings helpers ────────────────────────────────────────

  _readAntigravitySettings() {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return {};
      const settingsPath = path.join(appData, 'Antigravity', 'User', 'settings.json');
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeAntigravitySetting(key, value) {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return false;
      const settingsPath = path.join(appData, 'Antigravity', 'User', 'settings.json');
      const data = this._readAntigravitySettings();
      data[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  // ─── Codex config.toml helpers ───────────────────────────────────────────

  _readCodexConfigToml() {
    try {
      return fs.readFileSync(this.CODEX_CONFIG_PATH, 'utf8');
    } catch {
      return '';
    }
  }

  _writeCodexConfigValues(updates) {
    try {
      let toml = this._readCodexConfigToml();
      for (const [key, value] of Object.entries(updates)) {
        const quoted = JSON.stringify(String(value));
        const lineRe = new RegExp(`^${key}\\s*=.*$`, 'm');
        if (lineRe.test(toml)) {
          toml = toml.replace(lineRe, `${key} = ${quoted}`);
        } else {
          const sectionIdx = toml.indexOf('\n[');
          if (sectionIdx !== -1) {
            toml = toml.slice(0, sectionIdx) + `\n${key} = ${quoted}` + toml.slice(sectionIdx);
          } else {
            toml = toml.trimEnd() + `\n${key} = ${quoted}\n`;
          }
        }
      }
      fs.writeFileSync(this.CODEX_CONFIG_PATH, toml, 'utf8');
      return true;
    } catch (e) {
      this._log('error', `[codex-cfg] Write failed: ${e.message}`);
      return false;
    }
  }

  _readGitBranch(workspacePath) {
    if (!workspacePath || workspacePath === 'unknown') return null;
    try {
      const { execFileSync } = require('child_process');
      const branch = execFileSync('git', ['-C', workspacePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 2000, stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim();
      return branch || null;
    } catch { return null; }
  }

  _listGitBranches(workspacePath) {
    if (!workspacePath || workspacePath === 'unknown') return null;
    try {
      const { execFileSync } = require('child_process');
      const current = this._readGitBranch(workspacePath) || '';
      const raw = execFileSync('git', ['-C', workspacePath, 'branch', '--list', '--no-color'], {
        timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim();
      if (!raw) return { current, branches: [] };
      const branches = raw.split('\n')
        .map(line => line.replace(/^\*?\s*/, '').trim())
        .filter(Boolean);
      return { current, branches };
    } catch { return null; }
  }

  _switchGitBranch(workspacePath, branchName) {
    if (!workspacePath || workspacePath === 'unknown') return { ok: false, error: 'No workspace path' };
    try {
      const { execFileSync } = require('child_process');
      execFileSync('git', ['-C', workspacePath, 'checkout', branchName], {
        timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr?.toString().trim() || err.message };
    }
  }

  _createGitBranch(workspacePath, branchName) {
    if (!workspacePath || workspacePath === 'unknown') return { ok: false, error: 'No workspace path' };
    try {
      const { execFileSync } = require('child_process');
      execFileSync('git', ['-C', workspacePath, 'checkout', '-b', branchName], {
        timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr?.toString().trim() || err.message };
    }
  }

  _readCodexConfigValues() {
    const toml = this._readCodexConfigToml();
    const result = {};
    for (const line of toml.split('\n')) {
      const m = line.match(/^(\w+)\s*=\s*"([^"]*)"$/);
      if (m) result[m[1]] = m[2];
    }
    return result;
  }

  // ─── Agent config helpers ──────────────────────────────────────────────

  _buildCapabilities(agentType) {
    const isCodex   = agentType === 'codex' || agentType === 'codex-desktop';
    const isClaude  = agentType === 'claude' || agentType === 'claude-desktop';
    const isDesktop = agentType === 'codex-desktop' || agentType === 'claude-desktop';
    return {
      interrupt:              ['claude', 'codex', 'gemini', 'antigravity', 'antigravity_panel', 'claude-desktop', 'codex-desktop'].includes(agentType),
      set_model:              agentType === 'claude' || agentType === 'antigravity' || agentType === 'antigravity_panel' || agentType === 'gemini',
      set_mode:               agentType === 'antigravity',
      permission_mode_change: agentType === 'claude',
      permission_dialogs:     isClaude || isCodex || agentType === 'antigravity' || agentType === 'antigravity_panel',
      set_codex_config:       isCodex,
      new_thread:             isDesktop,
      thread_list:            isDesktop,
      switch_thread:          isDesktop,
      switch_workspace:       isDesktop,
      open_panel:             false, // Codex side pane is already open if session exists
      chat_list:              agentType === 'codex' || agentType === 'antigravity_panel' || agentType === 'claude-desktop',
      switch_chat:            agentType === 'codex' || agentType === 'antigravity_panel' || agentType === 'claude-desktop',
      new_chat:               agentType === 'codex' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || agentType === 'claude',
      terminal_output:        isCodex || agentType === 'claude-desktop',
      terminal_input:         agentType === 'codex-desktop',
      file_changes:           isCodex || agentType === 'claude-desktop',
      send_attachment:        isCodex,
      branch_list:            true,
      switch_branch:          true,
      create_branch:          true,
      skill_list:             agentType === 'codex-desktop',
      file_browser:           true, // all session types support workspace file browsing
    };
  }

  _mergeAgentConfig(agentType, domCfg, workspacePath) {
    const branch = this._readGitBranch(workspacePath);
    if (agentType === 'claude') {
      const settings = this._readAntigravitySettings();
      const permMode  = settings['claudeCode.initialPermissionMode'] || domCfg?.permission_mode || 'unknown';
      const settingsModel = settings['claudeCode.selectedModel'];
      const modelId = (settingsModel && settingsModel !== 'default')
        ? settingsModel
        : (domCfg?.model_id && domCfg.model_id !== 'unknown' ? domCfg.model_id : (settingsModel || 'unknown'));
      return {
        model_id:          modelId,
        permission_mode:   permMode,
        file_access_scope: workspacePath || 'unknown',
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'codex') {
      return {
        model_id:           domCfg?.model_id        || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        effort:             domCfg?.effort          || 'unknown',
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   CODEX_MODELS,
        available_efforts:  CODEX_EFFORTS,
        available_access:   CODEX_ACCESS_MODES,
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'codex-desktop') {
      return {
        model_id:           domCfg?.model_id        || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        effort:             domCfg?.effort          || 'unknown',
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   CODEX_MODELS,
        available_efforts:  CODEX_EFFORTS,
        available_access:   CODEX_ACCESS_MODES,
        branch:             branch || 'unknown',
        sandbox_status:     domCfg?.sandbox_status  || null,
      };
    }
    return {
      model_id:           domCfg?.model_id           || 'unknown',
      conversation_mode:  domCfg?.conversation_mode  || 'unknown',
      permission_mode:    domCfg?.permission_mode    || 'unknown',
      file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
      branch:             branch || 'unknown',
    };
  }

  // ─── Panel management helpers ───────────────────────────────────────────

  async _openCodexPanelViaWorkbench(sessionId, requestId, sessionData) {
    const cdpPort = sessionData?._cdpPort || this.CDP_PORTS[0];
    let targets;
    try {
      targets = await CDP.List({ port: cdpPort });
    } catch (e) {
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'cdp_unavailable', message: 'Cannot list CDP targets',
      }));
      return;
    }

    // Find the workbench page (same window as the session if possible)
    const workbenchPages = targets.filter(t =>
      t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    if (workbenchPages.length === 0) {
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'no_workbench', message: 'No Antigravity workbench page found',
      }));
      return;
    }

    // Prefer the workbench page matching the session's parentId
    let workbenchTarget = workbenchPages[0];
    if (sessionData?.parentId) {
      for (const page of workbenchPages) {
        let pageClient;
        try {
          pageClient = await CDP({ port: cdpPort, target: page.id });
          await pageClient.Runtime.enable();
          const res = await pageClient.Runtime.evaluate({
            expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
            returnByValue: true,
          });
          await pageClient.close();
          if (res.result?.value === sessionData.parentId) {
            workbenchTarget = page;
            break;
          }
        } catch {
          if (pageClient) try { await pageClient.close(); } catch {}
        }
      }
    }

    let client;
    try {
      client = await CDP({ port: cdpPort, target: workbenchTarget.id });
      await client.Runtime.enable();
      const result = await selectors.openCodexPanel(client.Runtime);
      await client.close();

      if (result.ok) {
        this._log('info', `[ctrl] open_panel OK for ${sessionId}: method=${result.method} detail=${result.detail}`);
        this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'ok'));
      } else {
        this._log('warn', `[ctrl] open_panel failed for ${sessionId}: ${result.detail}`);
        this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
          code: 'icon_not_found', message: result.detail || 'Could not find Codex activity bar icon',
        }));
      }
    } catch (e) {
      if (client) try { await client.close(); } catch {}
      this._log('warn', `[ctrl] open_panel error for ${sessionId}: ${e.message}`);
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'cdp_error', message: e.message,
      }));
    }
  }

  // ─── Workspace discovery helpers ─────────────────────────────────────────

  _readAntigravityWindowPaths() {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return [];
      const storagePath = path.join(appData, 'Antigravity', 'User', 'globalStorage', 'storage.json');
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      const ws = data.windowsState || {};
      const allWindows = [
        ...(ws.lastActiveWindow ? [ws.lastActiveWindow] : []),
        ...(ws.openedWindows || []),
      ];
      const seen = new Set();
      return allWindows
        .filter(w => w.folder)
        .map(w => {
          let p = decodeURIComponent(w.folder.replace(/^file:\/\/\//, ''));
          p = p.replace(/\//g, '\\');
          const title = p.split('\\').filter(Boolean).pop() || p;
          return { title, path: p };
        })
        .filter(w => {
          if (seen.has(w.path.toLowerCase())) return false;
          seen.add(w.path.toLowerCase());
          return true;
        });
    } catch {
      return [];
    }
  }

  // ─── Transcript signature ────────────────────────────────────────────────

  _transcriptSignature(messages) {
    return JSON.stringify((messages || []).map(m => [m.role, m.content]));
  }

  // ─── Reconnect backoff ───────────────────────────────────────────────────

  _reconnectDelay() {
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt), this.MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    return delay;
  }

  // ─── CDP target resolution ───────────────────────────────────────────────

  async _listTargetsOnPort(port) {
    return CDP.List({ port });
  }

  async _resolveCdpTargets() {
    const results = await Promise.allSettled(
      this.CDP_PORTS.map(port => this._listTargetsOnPort(port).then(targets =>
        targets.map(t => Object.assign({}, t, { _cdpPort: port }))
      ))
    );

    const allTargets = [];
    let anySucceeded = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        anySucceeded = true;
        allTargets.push(...r.value);
      } else {
        if (!r.reason?.message?.includes('ECONNREFUSED')) {
          this._log('warn', `[cdp] Port ${this.CDP_PORTS[i]} error: ${r.reason?.message}`);
        }
      }
    }

    if (!anySucceeded) {
      throw new Error(`No configured CDP ports responded (tried: ${this.CDP_PORTS.join(', ')})`);
    }

    return allTargets;
  }

  // ─── Relay connection ────────────────────────────────────────────────────

  connectRelay() {
    if (!this._running) return;
    const attempt = this.reconnectAttempt + 1;
    this._log('info', `[relay] Connecting to ${this.RELAY_URL} (attempt ${attempt})...`);
    const ws = new WebSocket(this.RELAY_URL);
    this.relayWs = ws;

    ws.on('open', () => {
      this._log('info', '[relay] Socket open — sending connection_hello');
      ws.send(JSON.stringify(proto.hello(this.MACHINE_LABEL, this.PROXY_ID, this.PROXY_SECRET)));
    });

    ws.on('message', (data) => {
      try {
        this._handleRelayMessage(JSON.parse(data.toString()));
      } catch (e) {
        this._log('error', `[relay] Bad message: ${e.message}`);
      }
    });

    ws.on('close', (code) => {
      this.relayReady   = false;
      this.connectionId = null;
      this._stopHeartbeat();
      if (!this._running) return;
      const delay = this._reconnectDelay();
      this._log('info', `[relay] Closed (${code}). Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connectRelay(), delay);
    });

    ws.on('error', (err) => {
      this._log('error', `[relay] Error: ${err.message}`);
    });
  }

  _handleRelayMessage(msg) {
    const { type } = msg;

    // ── Protocol v1 handshake ───────────────────────────────────────────
    if (type === 'connection_ack') {
      this.reconnectAttempt = 0;
      this.relayReady       = true;
      this.connectionId     = msg.connection_id || null;
      this.hbIntervalMs     = msg.heartbeat_interval_ms || 10000;
      this._log('info', `[relay] Handshake OK. connection_id=${this.connectionId}, hb=${this.hbIntervalMs}ms`);
      this._startHeartbeat();
      this._broadcastSessionSnapshot();
      // Send all known sessions from session-store for relay backfill
      this._sendSessionMetaBackfill();
      // Re-emit agent config for all active sessions
      for (const [sessionId, session] of this.sessions.entries()) {
        const agentCaps = this._buildCapabilities(session.agentType);
        const resolvedPath = session.workspace_path;
        selectors.readAgentConfig(session.client.Runtime, session.agentType, resolvedPath)
          .then(cfg => {
            const merged = this._mergeAgentConfig(session.agentType, cfg, resolvedPath);
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          })
          .catch(err => {
            const merged = this._mergeAgentConfig(session.agentType, null, resolvedPath);
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}) fallback (err: ${err?.message}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          });
      }
      // Re-sync transcript history
      for (const [sessionId, session] of this.sessions.entries()) {
        selectors.readMessages(session.client.Runtime, session.agentType, sessionId)
          .then(raw => {
            if (!raw && !session._accumulatedMessages) return;
            const msgs = raw ? JSON.parse(raw) : [];
            const effMsgs = session._accumulatedMessages || msgs;
            if (effMsgs.length > 0) this._sendToRelay(proto.historySnapshot(sessionId, effMsgs));
          })
          .catch(e => this._log('warn', `[relay] History resync failed for ${sessionId}: ${e.message}`));
      }
      // Re-broadcast queued messages so the frontend queue bar survives refresh
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.messageQueue?.length) {
          for (const item of session.messageQueue) {
            this._sendToRelay(proto.messageQueued(sessionId, item.client_message_id, item.content));
          }
          this._log('info', `[relay] Re-broadcast ${session.messageQueue.length} queued messages for ${sessionId}`);
        }
        // Re-broadcast native queue state and reset signature so next poll re-sends
        if (session.nativeQueue?.length) {
          this._sendToRelay(proto.nativeQueue(sessionId, session.nativeQueue));
          this._log('info', `[relay] Re-broadcast ${session.nativeQueue.length} native queue items for ${sessionId}`);
        }
        session._nativeQueueSig = null; // Force re-detection on next poll
      }
      return;
    }

    if (type === 'heartbeat_ack') return;

    if (type === 'session_snapshot_ack') {
      const duplicates = msg.duplicate_sessions || [];
      if (duplicates.length > 0) {
        this._log('warn', `[proxy] WARNING: ${duplicates.length} session(s) already registered under a different proxy — possible duplicate proxy process. Sessions: ${duplicates.join(', ')}`);
      }
      return;
    }

    if (type === 'connection_error') {
      this._log('error', `[relay] Protocol error: ${msg.code} — ${msg.message}`);
      return;
    }

    // ── Send requests ───────────────────────────────────────────────────
    if (type === 'send_message') {
      this._handleSendRequest({
        session:           msg.session_id,
        content:           msg.content,
        file:              msg.file,
        client_message_id: msg.client_message_id,
      });
      return;
    }

    if (type === 'send') {
      this._handleSendRequest(msg);
      return;
    }

    if (type === 'steer') {
      this._handleSteerRequest(msg);
      return;
    }

    if (type === 'discard_queued') {
      const sid = msg.session_id || msg.session;
      const session = this.sessions.get(sid);
      const cid = msg.client_message_id;

      // Native queue item — click Codex's "Delete queued message" button
      if (cid && cid.startsWith('native-') && session) {
        const idx = parseInt(cid.replace('native-', ''), 10) || 0;
        const usePageEval = session.agentType === 'codex-desktop';
        const evalFn = usePageEval ? selectors.evalInPage : selectors.evalInFrame;
        evalFn(session.client.Runtime, `
          var delBtns = Array.from(d.querySelectorAll('button[aria-label="Delete queued message"]'));
          if (delBtns.length > ${idx}) { delBtns[${idx}].click(); return 'deleted-' + ${idx}; }
          if (delBtns.length > 0) { delBtns[0].click(); return 'deleted-0-fallback'; }
          return 'no-delete-btn';
        `).then(r => {
          this._log('info', `[${sid}] Native queue delete: ${r}`);
          // Reset native queue sig to force re-detection
          session._nativeQueueSig = null;
        }).catch(() => {});
        return;
      }

      // Proxy-queued item
      if (session?.messageQueue) {
        const wasFirst = session.messageQueue[0]?.client_message_id === cid;
        session.messageQueue = session.messageQueue.filter(m => m.client_message_id !== cid);
        this._log('info', `[${sid}] Discarded queued message ${cid} (remaining: ${session.messageQueue.length})`);
        // If the discarded message was the one in ProseMirror, type the next one
        if (wasFirst) this._typeNextQueuedIntoProseMirror(sid);
      }
      return;
    }

    if (type === 'edit_queued') {
      const sid = msg.session_id || msg.session;
      const session = this.sessions.get(sid);
      if (session?.messageQueue) {
        const item = session.messageQueue.find(m => m.client_message_id === msg.client_message_id);
        if (item) {
          item.content = msg.content;
          this._log('info', `[${sid}] Edited queued message ${msg.client_message_id}`);
        }
      }
      return;
    }

    // ── Agent control commands ──────────────────────────────────────────
    if (type === 'agent_interrupt') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_interrupt for ${sid} (${sessionData.agentType})`);
      selectors.interruptAgent(sessionData.client.Runtime, sessionData.agentType, sid)
        .then((result) => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
              code: result.code || 'interrupt_failed', message: result.detail || 'Interrupt failed',
            }));
          }
        })
        .catch((err) => {
          this._log('error', `[ctrl] agent_interrupt failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
            code: 'interrupt_exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'permission_response') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      const choiceId = msg.choice_id;
      this._log('info', `[ctrl] permission_response for ${sid} prompt=${msg.prompt_id} choice=${choiceId} auto=${!!msg.auto_applied}`);

      // Auto-expiration from relay with no valid choice — just clear local state
      // so the dialog can be re-detected on the next poll cycle
      if (msg.auto_applied && !choiceId) {
        this._log('info', `[ctrl] Auto-expired prompt for ${sid}, clearing for re-detection`);
        this.activePermissionPrompts.delete(sid);
        return;
      }

      selectors.respondToPermissionDialog(sessionData.client.Runtime, sessionData.agentType, choiceId, sid)
        .then(result => {
          if (result.ok) {
            this.activePermissionPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'ok'));
          } else {
            // Clear activePermissionPrompts on failure so re-detection works
            this.activePermissionPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
              code: result.code || 'click_failed', message: result.detail || 'Could not click permission dialog button',
            }));
          }
        })
        .catch(err => {
          // Clear activePermissionPrompts on error so re-detection works
          this.activePermissionPrompts.delete(sid);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_set_model') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      const modelId = msg.model_id;
      this._log('info', `[ctrl] agent_set_model for ${sid} model=${modelId}`);
      selectors.setAgentModel(sessionData.client.Runtime, sessionData.agentType, modelId, sid, sessionData.client.Input)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
            return selectors.readAgentConfig(sessionData.client.Runtime, sessionData.agentType, sessionData.workspace_path)
              .then(cfg => {
                const merged = this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path);
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(sessionData.agentType) }));
              }).catch(() => {});
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
              code: result.code || 'select_failed', message: result.detail || 'Model selection failed',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_set_mode') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      if (sessionData.agentType !== 'antigravity') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'not_supported', message: `Conversation mode not supported for ${sessionData.agentType}`,
        }));
        return;
      }
      if (!sessionData.client.Input) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'no_input_domain', message: 'CDP Input domain not available',
        }));
        return;
      }
      const mode = msg.mode;
      this._log('info', `[ctrl] agent_set_mode for ${sid} mode=${mode}`);
      selectors.setAntigravityMode(sessionData.client.Runtime, sessionData.client.Input, mode, sid)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'ok'));
            return selectors.readAgentConfig(sessionData.client.Runtime, sessionData.agentType, sessionData.workspace_path)
              .then(cfg => {
                const merged = this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path);
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(sessionData.agentType) }));
              }).catch(() => {});
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
              code: result.code || 'set_failed', message: result.detail || 'Mode selection failed',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_config_request') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const capabilities = this._buildCapabilities(agentT);

      if (!sessionData) {
        this._sendToRelay(proto.agentConfig(sid, {
          model_id: 'unknown', permission_mode: 'unknown', file_access_scope: 'unknown', capabilities,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_config_request for ${sid} (${agentT})`);
      selectors.readAgentConfig(sessionData.client.Runtime, agentT, sessionData.workspace_path)
        .then(cfg => {
          const merged = this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path);
          this._log('info', `[ctrl] agent_config sending for ${sid}: ${JSON.stringify({ ...merged, capabilities })}`);
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities }));
        })
        .catch(() => {
          const merged = this._mergeAgentConfig(agentT, null, sessionData.workspace_path);
          this._log('info', `[ctrl] agent_config sending (fallback) for ${sid}: ${JSON.stringify({ ...merged, capabilities })}`);
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities }));
        });
      return;
    }

    if (type === 'agent_set_permission_mode') {
      const sid = msg.session_id || msg.session;
      const mode = msg.mode;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      if (agentT !== 'claude') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
          code: 'not_supported', message: `Permission mode change not supported for ${agentT || 'unknown'} agent`,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_set_permission_mode for ${sid} mode=${mode}`);
      const ok = this._writeAntigravitySetting('claudeCode.initialPermissionMode', mode);
      if (ok) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'ok'));
        const caps = this._buildCapabilities(agentT);
        const merged = this._mergeAgentConfig(agentT, null, sessionData?.workspace_path);
        merged.permission_mode = mode;
        this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: caps }));
      } else {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
          code: 'write_failed', message: 'Could not update Antigravity settings.json',
        }));
      }
      return;
    }

    // ── Codex config change ─────────────────────────────────────────────
    if (type === 'set_codex_config') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      if (agentT !== 'codex' && agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'not_supported', message: `set_codex_config not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const updates = {};
      if (msg.model_id)      updates.model             = msg.model_id;
      if (msg.effort)        updates.reasoning_effort   = msg.effort;
      if (msg.access_mode)   updates.sandbox_mode       = msg.access_mode;

      if (Object.keys(updates).length === 0) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'no_fields', message: 'No config fields specified',
        }));
        return;
      }

      this._log('info', `[ctrl] set_codex_config for ${sid}: ${JSON.stringify(updates)}`);

      if (agentT === 'codex-desktop') {
        const cdpUpdates = {};
        if (msg.model_id)    cdpUpdates.model_id    = msg.model_id;
        if (msg.effort)      cdpUpdates.effort      = msg.effort;
        if (msg.access_mode) cdpUpdates.access_mode = msg.access_mode;
        selectors.setCodexDesktopConfig(sessionData.client.Runtime, cdpUpdates).catch(() => {});
      }

      const ok = this._writeCodexConfigValues(updates);
      if (ok) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'ok'));
        selectors.readAgentConfig(sessionData.client.Runtime, agentT, sessionData.workspace_path)
          .then(cfg => {
            const merged = this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path);
            if (msg.model_id)    merged.model_id        = msg.model_id;
            if (msg.effort)      merged.effort           = msg.effort;
            if (msg.access_mode) merged.permission_mode  = msg.access_mode;
            this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT) }));
          })
          .catch(() => {});
      } else {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'write_failed', message: 'Could not write ~/.codex/config.toml',
        }));
      }
      return;
    }

    // ── Switch workspace (codex-desktop, Epic 3) ───────────────────────
    if (type === 'switch_workspace') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const folderPath = msg.folder_path;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
          code: 'not_supported', message: `switch_workspace not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!folderPath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
          code: 'invalid_message', message: 'switch_workspace requires folder_path',
        }));
        return;
      }

      this._log('info', `[ctrl] switch_workspace for ${sid}: ${folderPath}`);
      selectors.switchCodexWorkspace(sessionData.client.Runtime, folderPath, true)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'ok'));
            // Refresh config after workspace switch
            setTimeout(() => {
              selectors.readAgentConfig(sessionData.client.Runtime, agentT, folderPath)
                .then(cfg => {
                  const merged = this._mergeAgentConfig(agentT, cfg, folderPath);
                  this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT) }));
                }).catch(() => {});
            }, 2000);
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
              code: result.code || 'workspace_not_found', message: result.detail || 'Workspace not found',
            }));
          }
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Thread list (codex-desktop, Epic 2) ─────────────────────────────
    if (type === 'thread_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'failed', {
          code: 'not_supported', message: `thread_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.readCodexThreadList(sessionData.client.Runtime, true)
        .then(threads => {
          this._sendToRelay(proto.threadList(sid, threads));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] thread_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Switch thread (codex-desktop, Epic 2) ────────────────────────────
    if (type === 'switch_thread') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const threadId = msg.thread_id;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
          code: 'not_supported', message: `switch_thread not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!threadId) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
          code: 'invalid_message', message: 'switch_thread requires thread_id',
        }));
        return;
      }

      selectors.switchCodexThread(sessionData.client.Runtime, threadId, true)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
              code: 'thread_not_found', message: result.detail || 'Thread not found',
            }));
          }
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── New thread (codex-desktop) ──────────────────────────────────────
    if (type === 'new_thread') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', 'failed', {
          code: 'not_supported', message: `new_thread not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.newCodexThread(sessionData.client.Runtime, true)
        .then(ok => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', ok ? 'ok' : 'failed'));
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Open panel (codex — activity bar click on workbench page) ──────
    if (type === 'open_panel') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'antigravity_panel') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
          code: 'not_supported', message: `open_panel not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'antigravity_panel') {
        // antigravity_panel sessions already have a workbench page Runtime
        selectors.openAntigravityPanel(sessionData.client.Runtime)
          .then(result => {
            if (result.ok) {
              this._log('info', `[ctrl] open_panel OK for AG panel ${sid}: method=${result.method} detail=${result.detail}`);
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'ok'));
              // Trigger rediscovery after a short delay so the newly opened panel
              // is picked up as a session without waiting for the next poll cycle
              setTimeout(() => this._discoverTargets().catch(() => {}), 2000);
            } else {
              this._log('warn', `[ctrl] open_panel failed for AG panel ${sid}: ${result.detail}`);
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
                code: result.code || 'panel_not_found', message: result.detail || 'Panel icon not found',
              }));
            }
          })
          .catch(e => {
            this._log('warn', `[ctrl] open_panel error for AG panel ${sid}: ${e.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
              code: 'cdp_error', message: e.message,
            }));
          });
        return;
      }

      // Connect to a workbench page to click the activity bar
      this._openCodexPanelViaWorkbench(sid, requestId, sessionData);
      return;
    }

    // ── Chat list (codex / codex-desktop) ────────────────────────────────
    if (type === 'chat_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      this._log('info', `[ctrl] chat_list request for ${sid} (${agentT || 'no session'})`);

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', {
          code: 'not_supported', message: `chat_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'antigravity_panel') {
        selectors.readAntigravityPanelChatList(sessionData.client.Runtime)
          .then(chats => {
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] chat_list failed for AG panel ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      // For desktop apps, reuse the thread list reader which understands the page-level DOM
      const readerFn = (agentT === 'codex-desktop' || agentT === 'claude-desktop')
        ? selectors.readCodexThreadList(sessionData.client.Runtime, true)
        : selectors.readCodexChatList(sessionData.client.Runtime, usePageEval);
      readerFn
        .then(chats => {
          this._log('info', `[ctrl] chat_list result for ${sid}: ${chats.length} chats`);
          this._sendToRelay(proto.chatList(sid, chats));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] chat_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Switch chat (codex / codex-desktop) ──────────────────────────────
    if (type === 'switch_chat') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const chatId = msg.chat_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
          code: 'not_supported', message: `switch_chat not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!chatId) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
          code: 'invalid_message', message: 'switch_chat requires chat_id',
        }));
        return;
      }

      if (agentT === 'antigravity_panel') {
        selectors.switchAntigravityPanelChat(sessionData.client.Runtime, chatId)
          .then(result => {
            if (result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
            } else {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
                code: result.code || 'chat_not_found', message: result.detail || 'Chat not found',
              }));
            }
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      // For desktop apps, use the thread switcher which understands the page-level DOM
      const switchFn = (agentT === 'codex-desktop' || agentT === 'claude-desktop')
        ? selectors.switchCodexThread(sessionData.client.Runtime, chatId, true)
        : selectors.switchCodexChat(sessionData.client.Runtime, chatId, usePageEval);
      switchFn
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
              code: 'chat_not_found', message: result.detail || 'Chat not found',
            }));
          }
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── New chat (codex / codex-desktop) ─────────────────────────────────
    if (type === 'new_chat') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop' && agentT !== 'claude') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
          code: 'not_supported', message: `new_chat not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      // Claude Code extension: send /clear to start a new conversation
      if (agentT === 'claude') {
        selectors.sendMessage(sessionData.client.Runtime, 'claude', '/clear', sid)
          .then(result => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', result.ok ? 'ok' : 'failed',
              result.ok ? undefined : { code: result.code || 'new_chat_failed', message: result.detail }));
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      if (agentT === 'antigravity_panel') {
        // Suppress hasContent removal check while the panel resets
        sessionData._newChatPending = Date.now();
        // Clear accumulated message buffer so we start fresh
        sessionData._accumulatedMessages = null;
        sessionStore.updateSession(sid, { accumulated_messages: null });
        selectors.newAntigravityPanelChat(sessionData.client.Runtime)
          .then(result => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', result.ok ? 'ok' : 'failed',
              result.ok ? undefined : { code: result.code || 'new_chat_failed', message: result.detail }));
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      selectors.newCodexChat(sessionData.client.Runtime, usePageEval)
        .then(ok => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', ok ? 'ok' : 'failed'));
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Terminal output (codex / codex-desktop) ────────────────────────
    if (type === 'terminal_output') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'failed', {
          code: 'not_supported', message: `terminal_output not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      const readFn = agentT === 'claude-desktop'
        ? selectors.readClaudeDesktopTerminalOutput || selectors.readCodexTerminalOutput
        : selectors.readCodexTerminalOutput;
      readFn(sessionData.client.Runtime, usePageEval)
        .then(entries => {
          this._sendToRelay(proto.terminalOutput(sid, entries));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] terminal_output failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Terminal input (codex-desktop) ─────────────────────────────────
    if (type === 'terminal_input') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const text = msg.text || '';

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'failed', {
          code: 'not_supported', message: `terminal_input not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.writeCodexTerminalInput(sessionData.client.Runtime, true, text)
        .then(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'ok'));
          // Auto-refresh terminal output after a short delay so the user sees the result
          setTimeout(() => {
            selectors.readCodexTerminalOutput(sessionData.client.Runtime, true)
              .then(entries => this._sendToRelay(proto.terminalOutput(sid, entries)))
              .catch(() => {});
          }, 500);
        })
        .catch(err => {
          this._log('warn', `[ctrl] terminal_input failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── File changes / diff (codex / codex-desktop) ────────────────────
    if (type === 'file_changes') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'failed', {
          code: 'not_supported', message: `file_changes not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      const readFn = agentT === 'claude-desktop'
        ? selectors.readClaudeDesktopFileChanges || selectors.readCodexFileChanges
        : selectors.readCodexFileChanges;
      readFn(sessionData.client.Runtime, usePageEval)
        .then(entries => {
          this._sendToRelay(proto.fileChanges(sid, entries));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] file_changes failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── File browser: list directory ──────────────────────────────────────
    if (type === 'list_directory') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const workspacePath = sessionData?.workspace_path;

      if (!workspacePath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
          code: 'no_workspace', message: 'Session has no workspace path',
        }));
        return;
      }

      const requestPath = msg.path || '.';
      const absPath = path.resolve(workspacePath, requestPath);

      // Security: ensure resolved path is within workspace
      if (!absPath.toLowerCase().startsWith(workspacePath.toLowerCase().replace(/\\/g, path.sep).replace(/\//g, path.sep)) &&
          !absPath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
          code: 'path_traversal', message: 'Path is outside workspace',
        }));
        return;
      }

      fs.readdir(absPath, { withFileTypes: true }, (err, dirents) => {
        if (err) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
            code: 'fs_error', message: err.message,
          }));
          return;
        }

        const entries = [];
        let pending = dirents.length;
        if (pending === 0) {
          this._sendToRelay(proto.directoryListing(sid, requestPath, [], requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
          return;
        }

        for (const d of dirents) {
          // Skip hidden files/dirs (starting with .) and node_modules
          if (d.name.startsWith('.') || d.name === 'node_modules') {
            if (--pending === 0) {
              entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              this._sendToRelay(proto.directoryListing(sid, requestPath, entries, requestId));
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
            }
            continue;
          }
          const fullPath = path.join(absPath, d.name);
          fs.stat(fullPath, (statErr, stats) => {
            if (!statErr) {
              entries.push({
                name: d.name,
                type: d.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime.toISOString(),
              });
            }
            if (--pending === 0) {
              entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              this._sendToRelay(proto.directoryListing(sid, requestPath, entries, requestId));
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
            }
          });
        }
      });
      return;
    }

    // ── File browser: read file ─────────────────────────────────────────
    if (type === 'read_file') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const workspacePath = sessionData?.workspace_path;
      const MAX_FILE_SIZE = msg.max_size || 512 * 1024; // 512KB default

      if (!workspacePath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: 'no_workspace', message: 'Session has no workspace path',
        }));
        return;
      }

      const requestPath = msg.path;
      if (!requestPath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: 'invalid_message', message: 'read_file requires path',
        }));
        return;
      }

      const absPath = path.resolve(workspacePath, requestPath);

      // Security: ensure resolved path is within workspace
      if (!absPath.toLowerCase().startsWith(workspacePath.toLowerCase().replace(/\\/g, path.sep).replace(/\//g, path.sep)) &&
          !absPath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: 'path_traversal', message: 'Path is outside workspace',
        }));
        return;
      }

      fs.stat(absPath, (statErr, stats) => {
        if (statErr) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
            code: 'fs_error', message: statErr.message,
          }));
          return;
        }

        const truncated = stats.size > MAX_FILE_SIZE;
        const readSize = truncated ? MAX_FILE_SIZE : stats.size;

        if (readSize === 0) {
          this._sendToRelay(proto.fileContent(sid, requestPath, '', false, requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'ok'));
          return;
        }

        // Read up to MAX_FILE_SIZE bytes
        const stream = fs.createReadStream(absPath, { start: 0, end: readSize - 1, encoding: 'utf8' });
        let content = '';
        stream.on('data', chunk => { content += chunk; });
        stream.on('end', () => {
          this._sendToRelay(proto.fileContent(sid, requestPath, content, truncated, requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'ok'));
        });
        stream.on('error', readErr => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
            code: 'fs_error', message: readErr.message,
          }));
        });
      });
      return;
    }

    // ── Send attachment / image (codex / codex-desktop) ──────────────────
    if (type === 'send_attachment') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', {
          code: 'not_supported', message: `send_attachment not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop';
      const { data, mime_type, filename } = msg;
      selectors.injectCodexImage(sessionData.client.Runtime, data, mime_type, filename, usePageEval)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', {
              code: result.detail || 'inject_failed',
            }));
          }
        })
        .catch(err => {
          this._log('warn', `[ctrl] send_attachment failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Branch list ──────────────────────────────────────────────────────
    if (type === 'branch_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch listing',
        }));
        return;
      }

      const result = this._listGitBranches(wp);
      if (!result) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'failed', {
          code: 'git_error', message: 'Failed to list branches',
        }));
        return;
      }

      this._sendToRelay(proto.branchList(sid, result.branches, result.current));
      this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'ok'));
      return;
    }

    // ── Switch branch ────────────────────────────────────────────────────
    if (type === 'switch_branch') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const branchName = msg.branch_name;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch switch',
        }));
        return;
      }

      if (!branchName) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'invalid_message', message: 'switch_branch requires branch_name',
        }));
        return;
      }

      this._log('info', `[ctrl] switch_branch for ${sid}: ${branchName}`);
      const result = this._switchGitBranch(wp, branchName);
      if (result.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'ok'));
        // Refresh config to update branch display
        const agentT = sessionData?.agentType;
        const merged = this._mergeAgentConfig(agentT, null, wp);
        merged.capabilities = this._buildCapabilities(agentT);
        this._sendToRelay(proto.agentConfig(sid, merged));
      } else {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'git_error', message: result.error,
        }));
      }
      return;
    }

    // ── Create branch ────────────────────────────────────────────────────
    if (type === 'create_branch') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const branchName = msg.branch_name;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch creation',
        }));
        return;
      }

      if (!branchName) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'invalid_message', message: 'create_branch requires branch_name',
        }));
        return;
      }

      this._log('info', `[ctrl] create_branch for ${sid}: ${branchName}`);
      const result = this._createGitBranch(wp, branchName);
      if (result.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'ok'));
        // Refresh config to update branch display
        const agentT = sessionData?.agentType;
        const merged = this._mergeAgentConfig(agentT, null, wp);
        merged.capabilities = this._buildCapabilities(agentT);
        this._sendToRelay(proto.agentConfig(sid, merged));
      } else {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'git_error', message: result.error,
        }));
      }
      return;
    }

    // ── Skills list (codex-desktop) ────────────────────────────────────
    if (type === 'skill_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'failed', {
          code: 'not_supported', message: `skill_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.readCodexSkillsList(sessionData.client.Runtime, true)
        .then(skills => {
          this._sendToRelay(proto.skillsList(sid, skills));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] skill_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Launch / close ──────────────────────────────────────────────────
    if (type === 'launch_session') {
      const agentType    = msg.agent_type;
      const requestId    = msg.request_id;
      const workspacePath = msg.workspace_path || null;
      this._log('info', `[ctrl] launch_session agent=${agentType} request=${requestId}`);

      // Antigravity window: File > New Window via DOM menu on existing workbench
      if (agentType === 'antigravity') {
        (async () => {
          try {
            const targets = await CDP.List({ port: this.CDP_PORTS[0] });
            const workbenchPages = targets.filter(t =>
              t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
            );
            if (workbenchPages.length === 0) {
              launchers.spawnAntigravity(this.CDP_PORTS[0]);
              this._log('info', `[launch] No Antigravity workbench — spawned fresh`);
            } else {
              const page = workbenchPages[0];
              let pageClient;
              try {
                pageClient = await CDP({ port: this.CDP_PORTS[0], target: page.id });
                await pageClient.Runtime.enable();
                await pageClient.Runtime.evaluate({ expression: 'window.focus()' });
                await sleep(200);
                // Alt+F to open File menu (DOM-based in Antigravity)
                await pageClient.Input.dispatchKeyEvent({ type: 'rawKeyDown', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 1 });
                await pageClient.Input.dispatchKeyEvent({ type: 'keyUp', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 });
                await sleep(600);
                // Click "New Window" by aria-label
                const result = await pageClient.Runtime.evaluate({
                  expression: `(function() {
                    var item = document.querySelector('[aria-label="New Window"]');
                    if (item) { item.click(); return 'ok'; }
                    return 'not-found';
                  })()`,
                  returnByValue: true,
                });
                await pageClient.close();
                const val = result.result?.value;
                if (val === 'ok') {
                  this._log('info', `[launch] Clicked File > New Window on "${page.title}"`);
                } else {
                  this._log('warn', `[launch] New Window menu item not found`);
                  launchers.spawnAntigravity(this.CDP_PORTS[0]);
                }
              } catch (e) {
                if (pageClient) try { await pageClient.close(); } catch {}
                this._log('warn', `[launch] File > New Window failed: ${e.message}`);
                launchers.spawnAntigravity(this.CDP_PORTS[0]);
              }
            }
            this._sendToRelay({
              type: 'session_launch_ack',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId,
              session_id: null,
              fire_and_forget: true,
              message: 'Antigravity window opened — select a workspace to start chatting',
            });
          } catch (e) {
            this._log('error', `[launch] Antigravity launch error: ${e.message}`);
            this._sendToRelay({
              type: 'session_launch_failed',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId,
              agent_type: agentType,
              reason: e.message,
              error_code: 'spawn_failed',
            });
          }
        })();
        return;
      }

      // Antigravity Chat: open the side panel on an existing workbench page
      if (agentType === 'antigravity_panel') {
        this._log('info', `[launch] Opening Antigravity side-panel`);
        (async () => {
          try {
            // Check if a panel session already exists for the target workspace
            const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
            const wantedBase = workspacePath ? normalise(workspacePath).split('/').filter(Boolean).pop() : '';
            const existingPanel = Array.from(this.sessions.values()).find(s =>
              s.agentType === 'antigravity_panel' && wantedBase &&
              (normalise(s.workspace_path) === normalise(workspacePath) ||
               (s.windowTitle || '').toLowerCase().includes(wantedBase))
            );
            if (existingPanel) {
              this._log('info', `[launch] Panel already exists for workspace: ${existingPanel.session_id}`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: existingPanel.session_id,
              });
              return;
            }

            const targets = await CDP.List({ port: this.CDP_PORTS[0] });
            const workbenchPages = targets.filter(t =>
              t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
            );
            if (workbenchPages.length === 0) {
              this._sendToRelay({
                type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, agent_type: agentType,
                reason: 'No Antigravity window open — launch Antigravity first',
                error_code: 'agent_not_open',
              });
              return;
            }
            // If workspace specified, prefer matching window
            if (workspacePath && workbenchPages.length > 1) {
              const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
              const wanted = normalise(workspacePath);
              const wantedBase = wanted.split('/').filter(Boolean).pop() || '';
              workbenchPages.sort((a, b) => {
                const aT = (a.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
                const bT = (b.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
                return (bT === wantedBase || wanted.endsWith(bT) ? 1 : 0)
                     - (aT === wantedBase || wanted.endsWith(aT) ? 1 : 0);
              });
            }
            let panelOpened = false;
            for (const page of workbenchPages) {
              let pageClient;
              try {
                pageClient = await CDP({ port: this.CDP_PORTS[0], target: page.id });
                await pageClient.Runtime.enable();
                const result = await selectors.openAntigravityPanel(pageClient.Runtime);
                await pageClient.close();
                if (result.ok) {
                  this._log('info', `[launch] Opened Antigravity side-panel: method=${result.method} on "${page.title}"`);
                  panelOpened = true;
                  break;
                }
              } catch (e) {
                if (pageClient) try { await pageClient.close(); } catch {}
                this._log('warn', `[launch] openAntigravityPanel failed on ${page.id.substring(0, 8)}: ${e.message}`);
              }
            }
            if (!panelOpened) {
              this._sendToRelay({
                type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, agent_type: agentType,
                reason: 'Could not open Antigravity side panel',
                error_code: 'panel_open_failed',
              });
              return;
            }
            // Wait for discovery to pick up the new panel session
            this._log('info', `[launch] Waiting for side-panel session to appear...`);
            await sleep(3000);
            await this._discoverTargets();
            // Find the newly appeared antigravity_panel session
            const panelSession = Array.from(this.sessions.values()).find(s =>
              s.agentType === 'antigravity_panel' && (!workspacePath ||
                (s.windowTitle || '').toLowerCase().includes(
                  (workspacePath || '').split(/[\\/]/).filter(Boolean).pop().toLowerCase()
                ))
            );
            if (panelSession) {
              this._log('info', `[launch] session_launch_ack: ${panelSession.session_id}`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: panelSession.session_id,
              });
            } else {
              // Panel opened but no session yet — fire-and-forget, discovery will catch it
              this._log('info', `[launch] Panel opened but session not yet discovered — acking without session`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: null,
                fire_and_forget: true,
                message: 'Antigravity side panel opened — session will appear shortly',
              });
            }
          } catch (e) {
            this._log('error', `[launch] Antigravity panel launch error: ${e.message}`);
            this._sendToRelay({
              type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId, agent_type: agentType,
              reason: e.message, error_code: 'panel_open_failed',
            });
          }
        })();
        return;
      }

      launchers.launchSession({
        agentType,
        port:          this.CDP_PORTS[0],
        sessions:      this.sessions,
        requestId,
        workspacePath,
        onSuccess: async (newTarget, reqId, wsPath) => {
          const launchedFilter = new Set([newTarget.id]);
          let newSession = null;
          for (let i = 0; i < 5 && !newSession; i++) {
            await this._discoverTargets(launchedFilter);
            newSession = Array.from(this.sessions.values()).find(s => s.targetId === newTarget.id);
            if (!newSession) await sleep(1000);
          }
          if (!newSession) {
            this._log('error', `[launch] Target ${newTarget.id.substring(0, 8)} appeared but could not be registered`);
            this._sendToRelay({
              type: 'session_launch_failed',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: reqId,
              agent_type: agentType,
              reason: 'Session appeared but failed to register',
              error_code: 'register_failed',
            });
            return;
          }
          const sessionId = newSession.session_id;
          this._log('info', `[launch] session_launch_ack: ${sessionId}`);
          this._sendToRelay({
            type: 'session_launch_ack',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: reqId,
            session_id: sessionId,
          });
          if (wsPath) {
            setTimeout(async () => {
              const s = this.sessions.get(sessionId);
              if (s) {
                this._log('info', `[launch] Injecting /cd ${wsPath} into ${sessionId}`);
                await selectors.sendMessage(s.client.Runtime, s.agentType, `/cd ${wsPath}`, sessionId)
                  .catch(e => this._log('warn', `[launch] /cd inject failed: ${e.message}`));
              }
            }, 2000);
          }
        },
        onFailure: (reason, errorCode, reqId) => {
          this._log('warn', `[launch] session_launch_failed: ${reason} (${errorCode})`);
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: reqId,
            agent_type: agentType,
            reason,
            error_code: errorCode,
          });
        },
      });
      return;
    }

    if (type === 'close_session') {
      const sid = msg.session_id || msg.session;
      this._log('info', `[ctrl] close_session for ${sid}`);
      const sessionData = this.sessions.get(sid);

      const finishClose = () => {
        sessionStore.markDisconnected(sid);
        this.sessions.delete(sid);
        this.activePermissionPrompts.delete(sid);
        this._sendToRelay({
          type: 'session_closed',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id: sid,
        });
        this._broadcastSessionSnapshot();
      };

      if (!sessionData) {
        finishClose();
        return;
      }

      const agentT = sessionData.agentType;
      const isDesktopApp = agentT === 'codex-desktop' || agentT === 'claude-desktop';

      if (isDesktopApp) {
        // Desktop apps are standalone windows — /json/close/ is safe here
        launchers.closeSession({ targetId: sessionData.targetId, port: sessionData._cdpPort || this.CDP_PORTS[0] })
          .then(finishClose)
          .catch(finishClose);
        return;
      }

      // For Antigravity sessions: click the tab/panel close button in the
      // workbench DOM instead of using /json/close/ (which kills the whole window).
      const cdpPort = sessionData._cdpPort || this.CDP_PORTS[0];
      const closeOpts = {
        webviewId: sessionData._webviewId || null,
        chatTitle: sessionData.chat_title || null,
      };

      (async () => {
        try {
          const targets = await CDP.List({ port: cdpPort });
          const workbenchPages = targets.filter(t =>
            t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
          );

          // Prefer the workbench page matching the session's parentId
          let workbenchTarget = workbenchPages[0];
          if (sessionData.parentId) {
            for (const page of workbenchPages) {
              let pageClient;
              try {
                pageClient = await CDP({ port: cdpPort, target: page.id });
                await pageClient.Runtime.enable();
                const res = await pageClient.Runtime.evaluate({
                  expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
                  returnByValue: true,
                });
                await pageClient.close();
                if (res.result?.value === sessionData.parentId) {
                  workbenchTarget = page;
                  break;
                }
              } catch {
                if (pageClient) try { await pageClient.close(); } catch {}
              }
            }
          }

          if (workbenchTarget) {
            let wbClient;
            try {
              wbClient = await CDP({ port: cdpPort, target: workbenchTarget.id });
              await wbClient.Runtime.enable();
              const result = await selectors.closeSessionTab(wbClient.Runtime, closeOpts);
              await wbClient.close();
              this._log('info', `[ctrl] closeSessionTab(${JSON.stringify(closeOpts)}): ${JSON.stringify(result)}`);
            } catch (e) {
              if (wbClient) try { await wbClient.close(); } catch {}
              this._log('warn', `[ctrl] closeSessionTab error: ${e.message}`);
            }
          }
        } catch (e) {
          this._log('warn', `[ctrl] close_session CDP error: ${e.message}`);
        }

        // Always disconnect our CDP client and clean up
        if (sessionData.client) {
          try { sessionData.client.close(); } catch {}
        }
        finishClose();
      })();
      return;
    }

    // ── Legacy relay support ────────────────────────────────────────────
    if (!this.relayReady) {
      this._log('info', `[relay] Received '${type}' before ack — assuming legacy relay, marking ready`);
      this.reconnectAttempt = 0;
      this.relayReady = true;
      this._broadcastSessionSnapshot();
    }
  }

  _sendToRelay(msg) {
    if (this.relayReady && this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify(msg));
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────

  _startHeartbeat() {
    this._stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (!this.relayReady || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return;
      const requestId = `hb_${Date.now()}`;
      this.relayWs.send(JSON.stringify(proto.heartbeat(this.connectionId, requestId)));
    }, this.hbIntervalMs);
  }

  _stopHeartbeat() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
  }

  // ─── Session broadcast ───────────────────────────────────────────────

  _buildSessionMetas() {
    return Array.from(this.sessions.values()).map(s => ({
      session_id:       s.session_id,
      agent_type:       s.agentType,
      display_name:     s.display_name,
      window_title:     s.windowTitle,
      workspace_name:   s.workspace_name,
      workspace_path:   s.workspace_path,
      machine_label:    s.machine_label,
      target_signature: s.target_signature,
      chat_title:       s.chat_title || null,
      status:           s.status,
      activity:         s.activity,
      last_seen_at:     s.last_seen_at,
      rate_limited_until: s.rate_limited_until || null,
      rate_limit_active:  s.rateLimitActive    || false,
      percent_used:       s.percentUsed        ?? null,
      is_list_view:       s._panelEmpty        || false,
    }));
  }

  _sendSessionMetaBackfill() {
    const allSessions = sessionStore.getAllSessions();
    if (allSessions.length === 0) return;
    const backfill = allSessions
      .filter(s => s.workspace_path || s.workspace_name)
      .map(s => ({
        session_id:     s.session_id,
        workspace_path: s.workspace_path || null,
        workspace_name: s.workspace_name || null,
        agent_type:     s.agent_type || null,
      }));
    if (backfill.length === 0) return;
    this._log('info', `[relay] Sending session_meta backfill for ${backfill.length} sessions`);
    this._sendToRelay({ type: 'session_meta_backfill', protocol_version: proto.PROTOCOL_VERSION, sessions: backfill });
  }

  _broadcastSessionSnapshot() {
    if (this._snapshotTimer) return;
    this._snapshotTimer = setTimeout(() => {
      this._snapshotTimer = null;
      const metas = this._buildSessionMetas();
      this._log('info', `[snapshot] Broadcasting ${metas.length} sessions: ${metas.map(m => m.session_id.substring(0,8) + '(' + m.agent_type + ')').join(', ')}`);
      this._sendToRelay(proto.sessionSnapshot(metas, this.openWorkspaces, this.PROXY_ID));
    }, 250);
  }

  // ─── Session polling ─────────────────────────────────────────────────

  async _pollSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const raw = await selectors.readMessages(session.client.Runtime, session.agentType, sessionId);

      if (!raw) {
        session.nullPollCount = (session.nullPollCount || 0) + 1;

        if (session.nullPollCount === 5 && session.status === 'healthy') {
          const failures = selectors.getSelectorFailures(sessionId);
          this._log('warn', `[${sessionId}] 5s null reads — marking degraded (readFails=${failures.readFails} sendFails=${failures.sendFails})`);
          session.status = 'degraded';
          sessionStore.updateSession(sessionId, { status: 'degraded' });
          this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
        }

        if (session.nullPollCount >= 15) {
          this._log('warn', `[${sessionId}] 15s null — closing CDP client to force re-discovery`);
          sessionStore.markDisconnected(sessionId);
          try { await session.client.close(); } catch {}
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        }
        return;
      }

      if (session.nullPollCount > 0 && session.status === 'degraded') {
        this._log('info', `[${sessionId}] Reads recovered — marking healthy`);
        session.status = 'healthy';
        sessionStore.updateSession(sessionId, { status: 'healthy' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'healthy', session.activity));
      }
      session.nullPollCount = 0;

      // Periodic agent config refresh (branch, model changes) — every 15s
      const configNow = Date.now();
      if (!session._lastConfigPollAt || configNow - session._lastConfigPollAt > 15000) {
        session._lastConfigPollAt = configNow;
        try {
          const cfg = await selectors.readAgentConfig(session.client.Runtime, session.agentType, session.workspace_path);
          const merged = this._mergeAgentConfig(session.agentType, cfg, session.workspace_path);
          const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
          if (cfgSig !== session._lastConfigSig) {
            session._lastConfigSig = cfgSig;
            const capabilities = this._buildCapabilities(session.agentType);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
          }
        } catch {}
      }

      // Antigravity Manager title polling
      if (session.agentType === 'antigravity') {
        const now = Date.now();
        if (!session._lastTitleCheckAt || now - session._lastTitleCheckAt > 5000) {
          session._lastTitleCheckAt = now;
          try {
            const newTitle = await selectors.readAntigravitySessionTitle(session.client.Runtime);
            if (newTitle && newTitle !== session.windowTitle) {
              this._log('info', `[${sessionId}] Antigravity conversation changed: "${session.windowTitle}" → "${newTitle}"`);
              session.windowTitle  = newTitle;
              session.workspace_name = newTitle;
              sessionStore.updateSession(sessionId, { window_title: newTitle, workspace_name: newTitle });
              this._broadcastSessionSnapshot();
            }
          } catch {}
        }
      }

      // Antigravity side-panel title polling
      if (session.agentType === 'antigravity_panel') {
        const now = Date.now();
        if (!session._lastTitleCheckAt || now - session._lastTitleCheckAt > 5000) {
          session._lastTitleCheckAt = now;
          try {
            const hasContent = await selectors.detectAntigravityPanelHasContent(session.client.Runtime);
            this._log('info', `[${sessionId}] panel poll: hasContent=${hasContent} _panelEmpty=${!!session._panelEmpty} lastMsgCount=${session.lastMessageCount}`);
            if (!hasContent) {
              // Panel is in "new chat" / list view — no active conversation.
              // Clear any stale messages from the web UI so it doesn't show
              // old content that doesn't match what the user sees.
              if (session.lastMessageCount > 0) {
                this._log('info', `[${sessionId}] Panel empty — clearing ${session.lastMessageCount} stale messages from web UI`);
                this._sendToRelay(proto.historySnapshot(sessionId, []));
                session.lastMessageCount = 0;
                session.lastObservedCount = 0;
                session.lastTranscriptSig = '';
                session._accumulatedMessages = null;
                sessionStore.updateSession(sessionId, { accumulated_messages: null });
              }
              if (session._newChatPending) {
                delete session._newChatPending;
              }
              // Mark panel as empty so we skip stale message processing below
              session._panelEmpty = true;
            } else if (session._newChatPending) {
              // Panel has content again after new_chat — clear the flag and update title
              delete session._newChatPending;
            }
            if (hasContent) session._panelEmpty = false;
            const panelTitle = await selectors.readAntigravityPanelTitle(session.client.Runtime);
            const workspacePart = session.windowTitle.split(' / ')[0];
            const newTitle = panelTitle ? `${workspacePart} / ${panelTitle}` : workspacePart;
            if (newTitle && newTitle !== session.windowTitle) {
              this._log('info', `[${sessionId}] Panel conversation changed: "${session.windowTitle}" → "${newTitle}"`);
              session.windowTitle    = newTitle;
              session.workspace_name = newTitle;
              sessionStore.updateSession(sessionId, { window_title: newTitle, workspace_name: newTitle });
              this._broadcastSessionSnapshot();
            }

            // Proactively send chat list so the web UI can show conversation history
            try {
              const chatList = await selectors.readAntigravityPanelChatList(session.client.Runtime);
              this._log('info', `[${sessionId}] chatList: ${chatList.length} items`);
              const chatListSig = JSON.stringify(chatList.map(c => c.title + ':' + c.active));
              if (chatListSig !== session._lastChatListSig) {
                session._lastChatListSig = chatListSig;
                this._sendToRelay(proto.chatList(sessionId, chatList));
                this._log('info', `[${sessionId}] Sent chat_list with ${chatList.length} conversations`);
              }
            } catch (e) {
              this._log('warn', `[${sessionId}] readAntigravityPanelChatList error: ${e.message}`);
            }
          } catch {}
        }
      }

      // Skip stale message processing when the Antigravity panel is in empty/list-view mode
      if (session._panelEmpty) return;

      const messages = JSON.parse(raw);

      // ── Antigravity accumulation layer ──────────────────────────────
      // The Antigravity side panel virtualizes older turns — they disappear
      // from the DOM as the conversation grows.  Instead of treating the DOM
      // snapshot as authoritative (which would wipe history), we accumulate
      // messages in session._accumulatedMessages and merge new DOM content
      // into that buffer.
      const isAccumulating = session.agentType === 'antigravity_panel' || session.agentType === 'antigravity';

      if (isAccumulating) {
        if (!session._accumulatedMessages) {
          // First poll — seed with whatever the DOM has
          session._accumulatedMessages = messages.slice();
        } else {
          // Merge: find where current DOM messages overlap with the accumulated tail
          // The DOM always shows the newest N messages, so we match backwards.
          const acc  = session._accumulatedMessages;
          const dom  = messages;

          if (dom.length > 0) {
            // Find the longest suffix of `acc` that is a prefix of `dom`
            // (i.e. how many of the last accumulated messages are still visible)
            let overlapLen = 0;
            for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
              let match = true;
              for (let k = 0; k < tryLen; k++) {
                const accMsg = acc[acc.length - tryLen + k];
                const domMsg = dom[k];
                if (accMsg.role !== domMsg.role) { match = false; break; }
                // Content may have grown (streaming) — check if DOM content starts with accumulated or vice versa
                if (accMsg.content !== domMsg.content &&
                    !domMsg.content.startsWith(accMsg.content.substring(0, 80)) &&
                    !accMsg.content.startsWith(domMsg.content.substring(0, 80))) {
                  match = false; break;
                }
              }
              if (match) { overlapLen = tryLen; break; }
            }

            if (overlapLen > 0) {
              // Update overlapping tail (content may have grown from streaming)
              for (let k = 0; k < overlapLen; k++) {
                const accIdx = acc.length - overlapLen + k;
                const domIdx = k;
                // Keep the longer version
                if (dom[domIdx].content.length > acc[accIdx].content.length) {
                  acc[accIdx] = dom[domIdx];
                }
              }
              // Append truly new messages
              for (let k = overlapLen; k < dom.length; k++) {
                acc.push(dom[k]);
              }
            } else {
              // No overlap — the DOM jumped to completely new content.
              // This can happen after a /clear or new_chat. Check if all DOM
              // messages are already in the tail of acc (subset check).
              const lastAccContent = acc.length > 0 ? acc[acc.length - 1].content : '';
              const firstDomContent = dom[0]?.content || '';
              // If the DOM first message matches nothing in recent history, append all
              if (!lastAccContent || !firstDomContent.startsWith(lastAccContent.substring(0, 80))) {
                for (const m of dom) acc.push(m);
              }
            }
          }
        }
        sessionStore.updateSession(sessionId, { accumulated_messages: session._accumulatedMessages });
      }

      // Use accumulated messages for antigravity sessions, DOM snapshot for others
      const effectiveMessages = isAccumulating ? (session._accumulatedMessages || messages) : messages;
      const transcriptSig = this._transcriptSignature(effectiveMessages);
      const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

      if (effectiveMessages.length < prevObservedCount) {
        // For accumulating sessions this should rarely happen (new chat / clear)
        this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}${isAccumulating ? ' (accumulated)' : ''}, forcing history snapshot`);
        this._sendToRelay(proto.historySnapshot(sessionId, effectiveMessages));
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      if (
        session.lastTranscriptSig &&
        transcriptSig !== session.lastTranscriptSig &&
        effectiveMessages.length === prevObservedCount
      ) {
        if (session.resyncCandidateSig === transcriptSig) {
          this._log('warn', `[${sessionId}] Transcript mutated in place, forcing history snapshot`);
          this._sendToRelay(proto.historySnapshot(sessionId, effectiveMessages));
          session.lastMessageCount = effectiveMessages.length;
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          session.pendingLast = null;
          session.resyncCandidateSig = null;
          session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
          return;
        }
        session.resyncCandidateSig = transcriptSig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        return;
      }

      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Mutated transcript stabilized — resyncing`);
        this._sendToRelay(proto.historySnapshot(sessionId, effectiveMessages));
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      if (effectiveMessages.length < session.lastMessageCount) {
        this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} → ${effectiveMessages.length}, resetting`);
        session.lastMessageCount = effectiveMessages.length;
        session.pendingLast = null;
      }

      // Pending stabilisation
      if (session.pendingLast !== null) {
        const p       = session.pendingLast;
        const current = effectiveMessages[session.lastMessageCount];
        if (current && current.role === p.role && current.content === p.content) {
          this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
          this._sendToRelay(proto.proxyMessage(sessionId, p.role, p.content));
          session.lastMessageCount++;
          session.pendingLast = null;
          if (p.role === 'user')      session.waitingForAssistant = true;
          if (p.role === 'assistant') session.waitingForAssistant = false;
        } else if (current) {
          session.pendingLast = { role: current.role, content: current.content };
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          if (session.activity?.kind !== 'generating' && session.activity?.kind !== 'thinking') {
            const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
            if (session.taskList) genActivity.task_list = session.taskList;
            session.activity = genActivity;
            sessionStore.updateSession(sessionId, { activity: genActivity });
            this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
          }
          return;
        }
      }

      // Send newly complete messages
      const prev = session.lastMessageCount;
      if (effectiveMessages.length > prev) {
        for (let i = prev; i < effectiveMessages.length - 1; i++) {
          this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
          this._sendToRelay(proto.proxyMessage(sessionId, effectiveMessages[i].role, effectiveMessages[i].content));
          if (effectiveMessages[i].role === 'user')      session.waitingForAssistant = true;
          if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
        }
        session.lastMessageCount = effectiveMessages.length - 1;
        const last = effectiveMessages[effectiveMessages.length - 1];
        session.pendingLast = { role: last.role, content: last.content };
      }

      session.lastObservedCount = effectiveMessages.length;
      session.lastTranscriptSig = transcriptSig;
      session.resyncCandidateSig = null;

      // Thinking / activity state
      const ts     = await selectors.detectThinking(session.client.Runtime, session.agentType);
      const active = session.pendingLast !== null || session.waitingForAssistant;
      const kind   = ts.thinking ? 'thinking' : active ? 'generating' : 'idle';
      const label  = ts.label || (active ? 'Generating' : '');
      const newActivity = { kind, label, updated_at: new Date().toISOString() };
      // Carry forward task list from previous activity
      if (session.taskList) newActivity.task_list = session.taskList;
      // Attach thinking content (command being run, tool output, etc.)
      if (ts.thinkingContent) {
        newActivity.thinkingContent = ts.thinkingContent;
      }

      const prevKind = session.activity?.kind || 'idle';
      const prevThinkingContent = session.thinkingContent || '';
      const currThinkingContent = ts.thinkingContent || '';
      if (ts.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent) {
        session.thinking     = ts.thinking;
        session.thinkingLabel = label;
        session.thinkingContent = currThinkingContent;
        session.activity     = newActivity;
        sessionStore.updateSession(sessionId, { activity: newActivity });
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));

        // Auto-send queued messages when agent transitions to idle
        if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
          this._processMessageQueue(sessionId);
        }
      }

      // Thread list polling — Codex Desktop only (Epic 2)
      // Polls every 10 cycles (~30-50s) to keep the thread list current.
      if (session.agentType === 'codex-desktop') {
        session._threadListPollCount = (session._threadListPollCount || 0) + 1;
        if (session._threadListPollCount >= 10) {
          session._threadListPollCount = 0;
          selectors.readCodexThreadList(session.client.Runtime, true)
            .then(threads => {
              if (threads.length > 0) {
                this._sendToRelay(proto.threadList(sessionId, threads));
              }
            })
            .catch(() => {});
        }
      }

      // Rate limit / usage warning check — Codex and Claude
      if (session.agentType === 'codex' || session.agentType === 'claude') {
        session._rateLimitPollCount = (session._rateLimitPollCount || 0) + 1;
        if (session._rateLimitPollCount >= 10) {
          session._rateLimitPollCount = 0;
          const readFn = session.agentType === 'codex'
            ? selectors.readCodexRateLimit(session.client.Runtime)
            : selectors.readClaudeRateLimit(session.client.Runtime);
          readFn.then(rl => {
            const wasActive = session.rateLimitActive || false;
            const nowActive = rl?.rate_limited === true;
            const untilText = rl?.until_text || null;
            const pctUsed   = rl?.percent_used ?? null;
            const hasBanner = pctUsed != null;
            const sig = `${nowActive}|${pctUsed}|${untilText}`;
            if (sig !== session._rateLimitSig) {
              session._rateLimitSig = sig;
              session.rateLimitActive    = nowActive;
              session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
              session.percentUsed        = hasBanner ? pctUsed : null;
              if (nowActive) {
                this._log('info', `[${sessionId}] [rate-limit] Active: ${pctUsed != null ? pctUsed + '%' : ''} resets ${untilText || 'unknown'}`);
                this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed));
              } else if (hasBanner) {
                // Usage warning (banner visible but not hard-limited) — send percent for display
                this._log('info', `[${sessionId}] [rate-limit] Usage: ${pctUsed}% resets ${untilText || 'unknown'}`);
                this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed));
              } else if (wasActive || session.percentUsed != null) {
                this._log('info', `[${sessionId}] [rate-limit] Cleared`);
                this._sendToRelay(proto.rateLimitCleared(sessionId));
              }
              this._broadcastSessionSnapshot();
            }
          }).catch(() => {});
        }
      }

      // Native queue detection — Codex side-panel queue items (messages with Steer buttons)
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        session._nativeQueuePollCount = (session._nativeQueuePollCount || 0) + 1;
        if (session._nativeQueuePollCount >= 3) {
          session._nativeQueuePollCount = 0;
          const usePageEval = session.agentType === 'codex-desktop';
          selectors.readCodexNativeQueue(session.client.Runtime, usePageEval).then(items => {
            const sig = items.map(i => i.text).join('|');
            const changed = sig !== (session._nativeQueueSig || '');
            // Always re-send every ~10 polls (~30s) so new browsers pick it up
            session._nativeQueueResendCount = (session._nativeQueueResendCount || 0) + 1;
            const forceResend = items.length > 0 && session._nativeQueueResendCount >= 10;
            if (changed || forceResend) {
              if (forceResend) session._nativeQueueResendCount = 0;
              session._nativeQueueSig = sig;
              session.nativeQueue = items;
              if (changed && items.length > 0) {
                this._log('info', `[${sessionId}] [native-queue] ${items.length} items detected`);
              }
              this._sendToRelay(proto.nativeQueue(sessionId, items));
            }
          }).catch((e) => { this._log('warn', `[${sessionId}] [native-queue] Error: ${e.message}`); });
        }
      }

      // Task list detection — Codex plan/task items
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        session._taskListPollCount = (session._taskListPollCount || 0) + 1;
        if (session._taskListPollCount >= 5) {
          session._taskListPollCount = 0;
          const usePageEval = session.agentType === 'codex-desktop';
          selectors.readCodexTaskList(session.client.Runtime, usePageEval).then(taskList => {
            const sig = taskList ? JSON.stringify(taskList) : '';
            if (sig !== (session._taskListSig || '')) {
              session._taskListSig = sig;
              session.taskList = taskList;
              // Attach task list to the activity update (create a minimal activity if none exists yet)
              if (!session.activity) {
                session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              }
              session.activity.task_list = taskList;
              this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
            }
          }).catch(() => {});
        }
      }

    } catch (e) {
      this._log('error', `[${sessionId}] Poll error: ${e.message}`);
    }
  }

  // ─── Permission dialog polling ───────────────────────────────────────

  _makePromptId(sessionId, message, choices) {
    const raw = `${sessionId}||${message}||${choices.map(c => c.choice_id).join('|')}`;
    return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
  }

  async _pollPermissions(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const dialog = await selectors.detectPermissionDialog(session.client.Runtime, session.agentType);

      if (dialog) {
        const promptId = this._makePromptId(sessionId, dialog.message, dialog.choices);
        const last     = this.activePermissionPrompts.get(sessionId);

        if (!last || last.prompt_id !== promptId) {
          this._log('info', `[${sessionId}] [perm] Permission dialog detected: "${dialog.message.substring(0, 60)}..."`);
          const prompt = {
            type:             'permission_prompt',
            protocol_version: proto.PROTOCOL_VERSION,
            session_id:       sessionId,
            prompt_id:        promptId,
            message:          dialog.message,
            choices:          dialog.choices,
            timeout_ms:       300000,
            detected_at:      new Date().toISOString(),
          };
          this.activePermissionPrompts.set(sessionId, { prompt_id: promptId, prompt });
          this._sendToRelay(prompt);
        }
      } else {
        if (this.activePermissionPrompts.has(sessionId)) {
          const { prompt_id } = this.activePermissionPrompts.get(sessionId);
          this._log('info', `[${sessionId}] [perm] Dialog dismissed (prompt_id=${prompt_id})`);
          this.activePermissionPrompts.delete(sessionId);
          this._sendToRelay({
            type:             'permission_prompt_expired',
            protocol_version: proto.PROTOCOL_VERSION,
            session_id:       sessionId,
            prompt_id,
            expired_at:       new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      this._log('error', `[${sessionId}] [perm] Poll error: ${e.message}`);
    }
  }

  // ─── Send request handler ────────────────────────────────────────────

  async _handleSendRequest(msg) {
    const { session: sessionId, content, file, client_message_id } = msg;
    const sessionData = this.sessions.get(sessionId);

    if (!sessionData) {
      this._log('warn', `[send] Unknown session: ${sessionId}`);
      if (client_message_id) {
        this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'failed', {
          error: { code: 'session_unknown', message: `No active session: ${sessionId}` },
        }));
      }
      return;
    }

    let messageContent = content;

    if (file) {
      const localPath = path.join(this.LOCAL_UPLOAD_DIR, file.storedName);
      try {
        fs.writeFileSync(localPath, Buffer.from(file.data, 'base64'));
        this._log('info', `[${sessionId}] File saved: ${localPath}`);
        const winPath = localPath.replace(/\//g, '\\');
        messageContent = content.replace(
          /\[File: [^\]]+\]\(\/uploads\/[^)]+\)/,
          `[File: ${file.originalName} → ${winPath}]`
        );
      } catch (e) {
        this._log('error', `[${sessionId}] File save failed: ${e.message}`);
      }
    }

    this._log('info', `[${sessionId}] Injecting: ${messageContent.substring(0, 80)}...`);

    // Pre-send busy check for Codex: if the agent is busy, queue the message
    // and type it into ProseMirror so Codex shows its native Steer button.
    // The web UI shows queued messages with Steer buttons that click the native button.
    const isCodexType = sessionData.agentType === 'codex' || sessionData.agentType === 'codex-desktop';
    const activityKind = sessionData.activity?.kind;
    if (isCodexType && (activityKind === 'thinking' || activityKind === 'generating') && client_message_id) {
      if (!sessionData.messageQueue) sessionData.messageQueue = [];
      const isFirstInQueue = sessionData.messageQueue.length === 0;
      sessionData.messageQueue.push({ content: messageContent, client_message_id, queued_at: Date.now() });
      // Only type the FIRST queued message into ProseMirror (so Codex shows its
      // native Steer button). Subsequent messages stay in proxy queue — typing
      // each one would overwrite the previous in the single ProseMirror input.
      if (isFirstInQueue) {
        const usePageEval = sessionData.agentType === 'codex-desktop';
        await selectors.steerCodexInput(sessionData.client.Runtime, messageContent, usePageEval);
      }
      this._log('info', `[${sessionId}] Agent is ${activityKind} — queued ${client_message_id} (depth: ${sessionData.messageQueue.length})${isFirstInQueue ? ' + typed into input' : ''}`);
      this._sendToRelay(proto.messageQueued(sessionId, client_message_id, messageContent));
      return;
    }

    let result;
    for (let attempt = 0; attempt <= SEND_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        this._log('info', `[${sessionId}] [send] Retry ${attempt}/${SEND_MAX_RETRIES} in ${SEND_RETRY_DELAY_MS}ms (prev: ${result.code})`);
        await new Promise(r => setTimeout(r, SEND_RETRY_DELAY_MS));
        if (!this.sessions.has(sessionId)) {
          result = { ok: false, code: 'session_gone', detail: 'Session removed during send retry' };
          break;
        }
      }
      result = await selectors.sendMessage(
        sessionData.client.Runtime,
        sessionData.agentType,
        messageContent,
        sessionId
      );
      if (result.ok) break;
      if (!RETRIABLE_SEND_CODES.has(result.code)) break;
    }

    // Queue message if agent is busy (steer feature)
    if (!result.ok && result.code === 'agent_busy' && client_message_id) {
      if (!sessionData.messageQueue) sessionData.messageQueue = [];
      sessionData.messageQueue.push({ content: messageContent, client_message_id, queued_at: Date.now() });
      this._log('info', `[${sessionId}] Agent busy — queued message ${client_message_id} (queue depth: ${sessionData.messageQueue.length})`);
      this._sendToRelay(proto.messageQueued(sessionId, client_message_id, messageContent));
      return;
    }

    if (result.ok) {
      sessionData.waitingForAssistant = true;
      const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
      sessionData.activity = genActivity;
      sessionStore.updateSession(sessionId, { activity: genActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, sessionData.status || 'healthy', genActivity));
    }

    if (client_message_id) {
      if (result.ok) {
        this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'delivered'));
      } else {
        this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'failed', {
          error: {
            code: result.code || 'send_injection_failed',
            message: result.detail || 'Inject failed after all strategies',
          },
        }));
      }
    }
  }

  // Process queued messages when agent goes idle
  async _processMessageQueue(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.messageQueue || session.messageQueue.length === 0) return;

    const item = session.messageQueue.shift();
    this._log('info', `[${sessionId}] Auto-sending queued message ${item.client_message_id}`);

    const result = await selectors.sendMessage(
      session.client.Runtime, session.agentType, item.content, sessionId
    );

    if (result.ok) {
      session.waitingForAssistant = true;
      const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
      if (session.taskList) genActivity.task_list = session.taskList;
      session.activity = genActivity;
      sessionStore.updateSession(sessionId, { activity: genActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
      this._sendToRelay(proto.queueDelivered(sessionId, item.client_message_id));
      this._sendToRelay(proto.proxySendResult(sessionId, item.client_message_id, 'delivered'));
      // Type next queued message into ProseMirror
      await this._typeNextQueuedIntoProseMirror(sessionId);
    } else if (result.code === 'agent_busy') {
      // Agent went busy again — re-queue
      session.messageQueue.unshift(item);
    } else {
      this._sendToRelay(proto.proxySendResult(sessionId, item.client_message_id, 'failed', {
        error: { code: result.code, message: result.detail || 'Queued send failed' },
      }));
      // Type next queued message into ProseMirror even on failure
      await this._typeNextQueuedIntoProseMirror(sessionId);
    }
  }

  // Handle steer request — force-send a queued message to Codex even while busy.
  // Uses steerCodexInput (type text) + Enter key dispatch (submit) to bypass
  // the SVG-based busy check that would normally block sendCodexPrimary.
  async _handleSteerRequest(msg) {
    const { session_id: sessionId, client_message_id, content, native_index } = msg;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'failed', 'Session not found'));
      return;
    }

    // Remove from proxy queue (only relevant for proxy-queued items, not native)
    if (session.messageQueue) {
      session.messageQueue = session.messageQueue.filter(m => m.client_message_id !== client_message_id);
    }

    if (session.agentType !== 'codex' && session.agentType !== 'codex-desktop') {
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'failed', 'Steer not supported'));
      return;
    }

    const idx = native_index != null ? native_index : 0;
    this._log('info', `[${sessionId}] Steer: clicking Codex native Steer button (index: ${idx})`);

    const usePageEval = session.agentType === 'codex-desktop';
    const evalFn = usePageEval ? selectors.evalInPage : selectors.evalInFrame;

    // Find and click Codex's native "Steer" button in the DOM at the specified index.
    const clickResult = await evalFn(session.client.Runtime, `
      var btns = Array.from(d.querySelectorAll('button')).filter(function(b) {
        return b.textContent.trim() === 'Steer';
      });
      var targetIdx = ${idx};
      if (btns.length > targetIdx) { btns[targetIdx].click(); return 'clicked-steer-' + targetIdx + '-of-' + btns.length; }
      if (btns.length > 0) { btns[0].click(); return 'clicked-steer-0-fallback-of-' + btns.length; }
      return 'no-steer-button';
    `);

    if (clickResult && clickResult.startsWith('clicked')) {
      this._log('info', `[${sessionId}] Steer: ${clickResult}`);
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'ok'));
    } else {
      // Fallback: type + Enter if native steer button not found
      this._log('warn', `[${sessionId}] Steer: native button not found (${clickResult}), falling back to type+Enter`);
      const typeResult = await selectors.steerCodexInput(session.client.Runtime, content, usePageEval);
      if (typeResult.ok) {
        await new Promise(r => setTimeout(r, 400));
        await evalFn(session.client.Runtime, `
          var input = d.querySelector('.ProseMirror');
          if (input) { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }
        `);
      }
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, typeResult.ok ? 'ok' : 'failed', typeResult.ok ? null : 'fallback'));
    }
    if (ok) {
      this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'delivered'));
    }

    // Type the next queued message into ProseMirror (if any remain)
    await this._typeNextQueuedIntoProseMirror(sessionId);
  }

  // After a queued message is consumed (steered/delivered/discarded),
  // type the next one into ProseMirror so Codex shows its native Steer button.
  async _typeNextQueuedIntoProseMirror(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session?.messageQueue?.length) return;
    const next = session.messageQueue[0];
    const usePageEval = session.agentType === 'codex-desktop';
    try {
      await selectors.steerCodexInput(session.client.Runtime, next.content, usePageEval);
      this._log('info', `[${sessionId}] Typed next queued message into ProseMirror: ${next.client_message_id}`);
    } catch (e) {
      this._log('warn', `[${sessionId}] Failed to type next queued: ${e.message}`);
    }
  }

  // ─── Target discovery ────────────────────────────────────────────────

  async _discoverTargets(allowedTargetIds = null) {
    let targets;
    try {
      targets = await this._resolveCdpTargets();
    } catch (e) {
      const triedPorts = this.CDP_PORTS.join(', ');
      this._log('error', `[cdp] Cannot list targets on configured ports (${triedPorts}): ${e.message}`);
      return;
    }

    const DESKTOP_PORT_MAP = { 9224: 'claude-desktop', 9225: 'codex-desktop' };
    const iframes       = targets.filter(t => t.type === 'iframe');
    const antigravityPg = targets.filter(t => t.type === 'page' && t._cdpPort === 9223);
    const desktopPg     = targets.filter(t => t.type === 'page' && DESKTOP_PORT_MAP[t._cdpPort]);
    this._log('info', `[discover] ${targets.length} targets — ${iframes.length} iframes, ${antigravityPg.length} ag-pages, ${desktopPg.length} desktop-pages`);

    const storagePaths = this._readAntigravityWindowPaths();

    // Build vscodeWindowId → page target map.
    // Cache by page.id to avoid opening new CDP connections to workbench pages
    // on every discovery cycle — those connections can steal window focus.
    if (!this._windowIdCache) this._windowIdCache = new Map(); // pageId → winId
    const windowIdToPage = new Map();
    const winIdPages = antigravityPg.filter(t =>
      t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    for (const page of winIdPages) {
      // Use cached windowId if we already resolved this page target
      const cached = this._windowIdCache.get(page.id);
      if (cached) {
        windowIdToPage.set(cached, page);
        continue;
      }
      let pageClient;
      try {
        pageClient = await CDP({ port: 9223, target: page.id });
        await pageClient.Runtime.enable();
        const res = await pageClient.Runtime.evaluate({
          expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
          returnByValue: true,
        });
        const winId = res.result?.value;
        if (winId) {
          windowIdToPage.set(winId, page);
          this._windowIdCache.set(page.id, winId);
        }
        await pageClient.close();
      } catch (e) {
        if (pageClient) try { await pageClient.close(); } catch {}
      }
    }
    // Prune cached windowIds for page targets that no longer exist
    const currentPageIds = new Set(winIdPages.map(p => p.id));
    for (const cachedPageId of this._windowIdCache.keys()) {
      if (!currentPageIds.has(cachedPageId)) this._windowIdCache.delete(cachedPageId);
    }
    if (windowIdToPage.size > 0) {
      const entries = Array.from(windowIdToPage.entries()).map(([id, p]) => `${id}→"${p.title.substring(0,40)}"`);
      this._log('info', `[discover] windowId map: ${entries.join(', ')}`);
    }

    // Refresh workspace list
    if (!allowedTargetIds) {
      this.openWorkspaces = antigravityPg
        .map(p => {
          const title = p.title.replace(/ - Antigravity.*/, '').trim();
          if (!title || title.toLowerCase() === 'antigravity') return null;
          const match = storagePaths.find(w => w.title.toLowerCase() === title.toLowerCase());
          return { title, path: match ? match.path : null };
        })
        .filter(Boolean);

      const openWithPaths = this.openWorkspaces.filter(w => w.path);
      for (const [sid, session] of this.sessions.entries()) {
        const nameBad = !session.workspace_name || /^window-\d+$/.test(session.workspace_name);

        // Use windowIdToPage to resolve the correct workspace from parentId
        const parentPageForSession = session.parentId ? windowIdToPage.get(session.parentId) : null;
        if (parentPageForSession) {
          const resolvedTitle = parentPageForSession.title.replace(/ - Antigravity.*/, '').trim();
          const wsMatch = this.openWorkspaces.find(w => w.path && w.title.toLowerCase() === resolvedTitle.toLowerCase());
          if (wsMatch) {
            // Correct workspace if it differs from what's stored
            const pathChanged = session.workspace_path !== wsMatch.path;
            const nameChanged = session.workspace_name !== wsMatch.title;
            if (pathChanged || nameChanged) {
              session.workspace_path = wsMatch.path;
              session.workspace_name = wsMatch.title;
              session.windowTitle = resolvedTitle;
              sessionStore.updateSession(sid, {
                workspace_path: wsMatch.path,
                workspace_name: wsMatch.title,
                window_title: resolvedTitle,
              });
              this._log('info', `[discover] Corrected workspace for ${sid}: "${wsMatch.title}" (${wsMatch.path})`);
            }
            continue;
          }
        }

        // Fallback: derive workspace_name from workspace_path if we have one
        if (session.workspace_path && nameBad) {
          const derived = session.workspace_path.split(/[/\\]/).filter(Boolean).pop() || session.workspace_path;
          session.workspace_name = derived;
          sessionStore.updateSession(sid, { workspace_name: derived });
          this._log('info', `[discover] Derived workspace name for ${sid}: "${derived}"`);
          continue;
        }
        if (session.workspace_path) continue;

        // No parentId match and no workspace_path — try title-based resolution
        const resolvedTitle = parentPageForSession
          ? parentPageForSession.title.replace(/ - Antigravity.*/, '').trim()
          : session.windowTitle;
        const wsMatch = this.openWorkspaces.find(w => w.path && w.title.toLowerCase() === resolvedTitle?.toLowerCase())
          || (openWithPaths.length === 1 ? openWithPaths[0] : null);
        if (nameBad && resolvedTitle && resolvedTitle !== session.windowTitle) {
          session.windowTitle = resolvedTitle;
          session.workspace_name = resolvedTitle;
          sessionStore.updateSession(sid, { window_title: resolvedTitle, workspace_name: resolvedTitle });
          this._log('info', `[discover] Fixed window title for ${sid}: "${resolvedTitle}"`);
        }
        if (wsMatch) {
          session.workspace_path = wsMatch.path;
          session.workspace_name = wsMatch.title;
          sessionStore.updateSession(sid, { workspace_path: wsMatch.path, workspace_name: wsMatch.title });
          this._log('info', `[discover] Resolved workspace for ${sid}: ${wsMatch.path}`);
        }
      }
    }

    // ── Process iframe targets ──────────────────────────────────────────
    for (const target of iframes) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;

      const hostMatch   = target.url.match(/vscode-webview:\/\/([^/]+)/);
      const parentMatch = target.url.match(/parentId=(\w+)/);
      const extMatch    = target.url.match(/extensionId=([^&]+)/);
      const ext         = extMatch ? extMatch[1] : 'unknown';

      if (!hostMatch || !parentMatch) continue;

      const parentId = parentMatch[1];

      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      const isAgent = ext.toLowerCase().includes('anthropic') ||
                      ext.toLowerCase().includes('claude')    ||
                      ext.toLowerCase().includes('openai')    ||
                      ext.toLowerCase().includes('chatgpt')   ||
                      ext.toLowerCase().includes('googlecloud') ||
                      ext.toLowerCase().includes('gemini');
      if (!isAgent) continue;

      this._log('info', `[discover] Probing ${target.id.substring(0, 8)} ext=${ext}`);

      let client;
      try {
        client = await CDP({ port: target._cdpPort || this.CDP_PORTS[0], target: target.id });
        await client.Runtime.enable();

        const agentType = await selectors.detectAgentType(client.Runtime, ext);
        if (!agentType) {
          this._log('info', `[discover] ${target.id.substring(0, 8)}: detectAgentType=null, skipping`);
          await client.close();
          continue;
        }

        const parentPage   = windowIdToPage.get(parentId);
        const windowTitle  = parentPage
          ? parentPage.title.replace(/ - Antigravity.*/, '').trim()
          : `window-${parentId}`;

        // Match workspace by title; only use single-workspace fallback when
        // parentId couldn't be resolved (window-N placeholder), to avoid
        // mis-attributing sessions from other Antigravity windows.
        const hasParentPage = !!parentPage;
        const openWithPaths  = this.openWorkspaces.filter(w => w.path);
        const workspaceMatch = storagePaths.find(w => w.title.toLowerCase() === windowTitle.toLowerCase())
          || (!hasParentPage && openWithPaths.length === 1 ? openWithPaths[0] : null)
          || (!hasParentPage && storagePaths.length === 1 ? storagePaths[0] : null);
        const workspacePath  = workspaceMatch ? workspaceMatch.path : null;

        const sessionMeta = sessionStore.resolveSession({
          target,
          windowTitle,
          agentType,
          workspaceName: workspaceMatch?.title || windowTitle,
          workspacePath,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] Session ${sessionId} already active, skipping duplicate target`);
          await client.close();
          continue;
        }

        const currentTargetIds = new Set(targets.map(t => t.id));
        for (const [staleSid, staleSession] of this.sessions.entries()) {
          if (staleSession.agentType === agentType &&
              staleSession.parentId === parentId &&
              !currentTargetIds.has(staleSession.targetId)) {
            this._log('info', `[discover] Evicting stale session ${staleSid} — target ${staleSession.targetId?.substring(0,8)} no longer in CDP list`);
            sessionStore.markDisconnected(staleSid);
            try { await staleSession.client.close(); } catch {}
            this.sessions.delete(staleSid);
            this.activePermissionPrompts.delete(staleSid);
          }
        }

        const raw          = await selectors.readMessages(client.Runtime, agentType, sessionId);
        const domMsgs      = raw ? JSON.parse(raw) : [];
        const isAccumAccum = (agentType === 'antigravity_panel' || agentType === 'antigravity');
        const initialMsgs  = (isAccumAccum && sessionMeta.accumulated_messages) ? sessionMeta.accumulated_messages : domMsgs;
        const initialCount = initialMsgs.length;

        const firstUserMsg = initialMsgs.find(m => m.role === 'user');
        const rawFirstText = typeof firstUserMsg?.content === 'string'
          ? firstUserMsg.content
          : (Array.isArray(firstUserMsg?.content)
              ? firstUserMsg.content.map(c => c.text || c.content || '').join(' ')
              : '');
        const chatTitle = rawFirstText.replace(/\s+/g, ' ').trim().substring(0, 60) || null;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   workspaceMatch?.title || sessionMeta.workspace_name,
          workspace_path:   workspacePath || sessionMeta.workspace_path,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          chat_title:       chatTitle,
          client,
          lastMessageCount: initialCount,
          lastObservedCount: initialCount,
          lastTranscriptSig: this._transcriptSignature(initialMsgs),
          _accumulatedMessages: (isAccumAccum && sessionMeta.accumulated_messages) ? sessionMeta.accumulated_messages : (isAccumAccum ? domMsgs : null),
          nullPollCount:    0,
          pendingLast:      null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:         false,
          thinkingLabel:    '',
          status:           'healthy',
          activity:         sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:     new Date().toISOString(),
          windowTitle,
          agentType,
          parentId,
          ext,
          targetId:         target.id,
          _cdpPort:         target._cdpPort,
          _webviewId:       (target.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || null,
        });

        this._log('info', `[cdp] ${agentType} → ${sessionId} in "${windowTitle}" (${initialCount} existing msgs)`);

        if (raw && initialCount > 0) {
          this._sendToRelay(proto.historySnapshot(sessionId, initialMsgs));
        }

        const agentCaps = this._buildCapabilities(agentType);
        const resolvedPath = workspacePath || sessionMeta.workspace_path;

        if (agentType === 'codex') {
          selectors.readCodexRateLimit(client.Runtime).then(rl => {
            const session = this.sessions.get(sessionId);
            if (!session) return;
            const nowActive = rl?.rate_limited === true;
            const untilText = rl?.until_text || null;
            session.rateLimitActive    = nowActive;
            session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
            if (nowActive) {
              this._log('info', `[${sessionId}] [rate-limit] Initial detection: ${untilText || 'no reset time'}`);
              this._sendToRelay(proto.rateLimitActive(sessionId, untilText));
              this._broadcastSessionSnapshot();
            }
          }).catch(() => {});
        }

        selectors.readAgentConfig(client.Runtime, agentType, resolvedPath).then(cfg => {
          const merged = this._mergeAgentConfig(agentType, cfg, resolvedPath);
          this._log('info', `[init-cfg] ${sessionId} (${agentType}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          const session = this.sessions.get(sessionId);
          if (session && merged.file_access_scope && merged.file_access_scope !== 'unknown') {
            const scopePath = merged.file_access_scope;
            const scopeName = scopePath.split(/[/\\]/).filter(Boolean).pop() || scopePath;
            if (!session.workspace_path || /^window-\d+$/.test(session.workspace_name)) {
              session.workspace_path = scopePath;
              session.workspace_name = scopeName;
              sessionStore.updateSession(sessionId, { workspace_path: scopePath, workspace_name: scopeName });
              this._log('info', `[init-cfg] ${sessionId}: backfilled workspace_name="${scopeName}" from file_access_scope`);
              this._broadcastSessionSnapshot();
            }
          }
        }).catch(err => {
          const merged = this._mergeAgentConfig(agentType, null, resolvedPath);
          this._log('info', `[init-cfg] ${sessionId} (${agentType}) fallback (${err?.message}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        });

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this.activePermissionPrompts.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        if (client) try { await client.close(); } catch {}
        this._log('error', `[cdp] Failed to probe ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Antigravity native Agent Manager pages ──────────────────────────
    const managerPages = antigravityPg.filter(t =>
      t.url && t.url.includes('workbench-jetski-agent') &&
      t.title && !['Settings', 'Launchpad'].includes(t.title)
    );

    for (const target of managerPages) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      this._log('info', `[discover] Probing Antigravity Manager page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await CDP({ port: target._cdpPort || this.CDP_PORTS[0], target: target.id });
        await client.Runtime.enable();

        const convoTitle = await selectors.readAntigravitySessionTitle(client.Runtime);
        const displayName = convoTitle || target.title || 'Antigravity Agent';

        const sigSource = `${target.url}::${target.title}`;
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: displayName,
          agentType: 'antigravity',
          workspaceName: displayName,
          workspacePath: null,
          sigOverride: sigSource,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] Antigravity session ${sessionId} already active, skipping`);
          await client.close();
          continue;
        }

        const raw          = await selectors.readMessages(client.Runtime, 'antigravity', sessionId);
        const initialMsgs  = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   displayName,
          workspace_path:   null,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:     initialCount,
          lastObservedCount:    initialCount,
          lastTranscriptSig:    this._transcriptSignature(initialMsgs),
          nullPollCount:        0,
          pendingLast:          null,
          resyncCandidateSig:   null,
          waitingForAssistant:  false,
          thinking:             false,
          thinkingLabel:        '',
          status:               'healthy',
          activity:             sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:         new Date().toISOString(),
          windowTitle:          displayName,
          agentType:            'antigravity',
          targetId:             target.id,
        });

        this._log('info', `[cdp] antigravity → ${sessionId} "${displayName}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendToRelay(proto.historySnapshot(sessionId, initialMsgs));
        }

        const agentCaps = this._buildCapabilities('antigravity');
        selectors.readAgentConfig(client.Runtime, 'antigravity', null).then(cfg => {
          const merged = this._mergeAgentConfig('antigravity', cfg, null);
          this._log('info', `[init-cfg] ${sessionId} (antigravity): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        }).catch(() => {});

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] Antigravity Manager CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        if (client) try { await client.close(); } catch {}
        this._log('error', `[cdp] Failed to probe Antigravity Manager ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Antigravity side-panel sessions ─────────────────────────────────
    const workspacePages = antigravityPg.filter(t =>
      t.url && t.url.includes('workbench.html') && t.title && t.title.includes('Antigravity')
    );
    this._log('info', `[discover] Checking ${workspacePages.length} workspace page(s) for Antigravity side-panel`);
    // DEBUG: file log for panel discovery (temporary)
    try { fs.appendFileSync(path.join(__dirname, 'panel-discovery.log'), `${new Date().toISOString()} Checking ${workspacePages.length} pages, sessions=${this.sessions.size}, sessionTargetIds=[${Array.from(this.sessions.values()).map(s => s.targetId?.substring(0,8) + '(' + s.agentType + ')').join(',')}]\n`); } catch {};

    for (const target of workspacePages) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) {
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} skipped: not in allowedTargetIds`);
        continue;
      }
      const existingSession = Array.from(this.sessions.values()).find(s => s.targetId === target.id);
      if (existingSession) {
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} skipped: targetId owned by session ${existingSession.session_id.substring(0,8)} (${existingSession.agentType})`);
        continue;
      }

      let client;
      try {
        client = await CDP({ port: target._cdpPort || this.CDP_PORTS[0], target: target.id });
        await client.Runtime.enable();

        const hasContent = await selectors.detectAntigravityPanelHasContent(client.Runtime);
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} "${target.title.substring(0,40)}" hasContent=${hasContent}`);
        // Register the panel even when empty so it shows in the web UI immediately.
        // The user can start typing and the session will persist.

        const workspaceName = (target.title || '').replace(/ - Antigravity.*/, '').trim() || target.title;
        const panelTitle    = await selectors.readAntigravityPanelTitle(client.Runtime);
        const displayName   = panelTitle ? `${workspaceName} / ${panelTitle}` : workspaceName;

        this._log('info', `[discover] Probing Antigravity side-panel in "${workspaceName}" (${target.id.substring(0, 8)})`);

        const sigSource  = `${target.url}::panel::${workspaceName}`;
        // Resolve workspace path from open workspaces list
        const panelWsMatch = this.openWorkspaces.find(w =>
          w.path && w.title && w.title.toLowerCase() === workspaceName.toLowerCase()
        );
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: displayName,
          agentType: 'antigravity_panel',
          workspaceName: displayName,
          workspacePath: panelWsMatch?.path || null,
          sigOverride: sigSource,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          await client.close();
          continue;
        }

        const raw          = await selectors.readMessages(client.Runtime, 'antigravity_panel', sessionId);
        const initialMsgs  = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     displayName,
          workspace_name:   displayName,
          workspace_path:   null,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:  initialCount,
          lastObservedCount: initialCount,
          lastTranscriptSig: this._transcriptSignature(initialMsgs),
          nullPollCount:     0,
          pendingLast:       null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:          false,
          thinkingLabel:     '',
          status:            'healthy',
          activity:          sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:      new Date().toISOString(),
          windowTitle:       displayName,
          agentType:         'antigravity_panel',
          parentId:          null,
          ext:               null,
          targetId:          target.id,
        });

        this._log('info', `[cdp] antigravity_panel → ${sessionId} "${displayName}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendToRelay(proto.historySnapshot(sessionId, initialMsgs));
        }

        const agentCaps = this._buildCapabilities('antigravity_panel');
        this._sendToRelay(proto.agentConfig(sessionId, {
          agent_type: 'antigravity_panel',
          display_name: displayName,
          workspace_name: displayName,
          capabilities: agentCaps,
        }));

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] Antigravity side-panel CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        if (client) try { await client.close(); } catch {}
        this._log('error', `[cdp] Failed to probe Antigravity side-panel ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Desktop app sessions ────────────────────────────────────────────
    for (const target of desktopPg) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      if (!target.url || target.url.startsWith('devtools') || target.url.startsWith('chrome-extension')) continue;

      const agentType = DESKTOP_PORT_MAP[target._cdpPort];
      this._log('info', `[discover] Probing ${agentType} page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await CDP({ port: target._cdpPort, target: target.id });
        await client.Runtime.enable();

        const sigSource = `${agentType}::${target.url}`;
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: target.title || agentType,
          agentType,
          workspaceName: target.title || agentType,
          workspacePath: null,
          sigOverride: sigSource,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] ${agentType} session ${sessionId} already active, skipping`);
          await client.close();
          continue;
        }

        const raw         = await selectors.readMessages(client.Runtime, agentType, sessionId).catch(() => null);
        const initialMsgs = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   target.title || agentType,
          workspace_path:   null,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:  initialCount,
          lastObservedCount: initialCount,
          lastTranscriptSig: this._transcriptSignature(initialMsgs),
          nullPollCount:     0,
          pendingLast:       null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:          false,
          thinkingLabel:     '',
          status:            'healthy',
          activity:          sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:      new Date().toISOString(),
          windowTitle:       target.title || agentType,
          agentType,
          parentId:          null,
          ext:               null,
          targetId:          target.id,
        });

        this._log('info', `[cdp] ${agentType} → ${sessionId} "${target.title}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendToRelay(proto.historySnapshot(sessionId, initialMsgs));
        }

        const agentCaps = this._buildCapabilities(agentType);
        selectors.readAgentConfig(client.Runtime, agentType, null).then(cfg => {
          const merged = this._mergeAgentConfig(agentType, cfg, null);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        }).catch(() => {
          this._sendToRelay(proto.agentConfig(sessionId, { agent_type: agentType, capabilities: agentCaps }));
        });

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] ${agentType} CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        if (client) try { await client.close(); } catch {}
        this._log('error', `[cdp] Failed to probe ${agentType} target ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Orphan sweep ────────────────────────────────────────────────────
    if (!allowedTargetIds) {
      const currentTargetIds = new Set(targets.map(t => t.id));
      for (const sess of sessionStore.getAllSessions()) {
        if (sess.status !== 'healthy') continue;
        if (this.sessions.has(sess.session_id)) continue;
        if (!sess.target_id) continue;
        if (!currentTargetIds.has(sess.target_id)) {
          this._log('info', `[discover] Orphan sweep: marking ${sess.session_id} disconnected — target ${sess.target_id.substring(0, 8)} gone`);
          sessionStore.markDisconnected(sess.session_id);
        }
      }
      this._broadcastSessionSnapshot();
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Start the proxy engine: prune stale sessions, connect to relay,
   * discover initial targets, and start the poll loop.
   */
  async start() {
    this._running = true;
    this._log('info', `[proxy] Starting — CDP ports ${this.CDP_PORTS.join(', ')}, relay ${this.RELAY_URL}, machine ${this.MACHINE_LABEL}, proxy_id ${this.PROXY_ID}`);

    sessionStore.pruneStale(7);

    this.connectRelay();
    await this._discoverTargets();

    let tick = 0;
    this._pollTimer = setInterval(async () => {
      if (!this._running) return;
      tick++;

      if (tick % 10 === 0) await this._discoverTargets();

      if (tick % 30 === 0 && this.sessions.size > 0) {
        for (const [id, s] of this.sessions.entries()) {
          this._log('info', `[status] ${id} (${s.agentType}): ${s.lastMessageCount} msgs, relay ${this.relayReady ? 'up' : 'down'}, status=${s.status}`);
        }
        this._broadcastSessionSnapshot();
      }

      // Group sessions by parentId (Antigravity window) so we only interact with
      // one window's CDP targets per tick.  This prevents rapid focus-stealing
      // between multiple Antigravity windows when the user is typing.
      const windowGroups = new Map(); // parentId → [sessionId, ...]
      for (const [sessionId, session] of this.sessions.entries()) {
        const key = session.parentId || sessionId; // desktop apps have no parentId
        if (!windowGroups.has(key)) windowGroups.set(key, []);
        windowGroups.get(key).push(sessionId);
      }

      const windowKeys = Array.from(windowGroups.keys());
      if (windowKeys.length > 0) {
        // Pick which window to poll this tick (round-robin)
        this._pollWindowIndex = this._pollWindowIndex % windowKeys.length;
        const activeKey = windowKeys[this._pollWindowIndex];
        this._pollWindowIndex++;

        // Poll all sessions in the selected window
        for (const sessionId of windowGroups.get(activeKey)) {
          await this._pollSession(sessionId);
          await this._pollPermissions(sessionId);
        }
      }
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop the proxy engine: close relay, close all CDP clients, clear timers.
   */
  stop() {
    this._running = false;
    this._log('info', '[proxy] Stopping engine...');

    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._snapshotTimer) { clearTimeout(this._snapshotTimer); this._snapshotTimer = null; }
    this._stopHeartbeat();

    // Close all CDP clients
    for (const [sid, session] of this.sessions.entries()) {
      try { session.client.close(); } catch {}
    }
    this.sessions.clear();
    this.activePermissionPrompts.clear();

    // Close relay
    if (this.relayWs) {
      try { this.relayWs.close(); } catch {}
      this.relayWs = null;
    }
    this.relayReady = false;

    this._log('info', '[proxy] Engine stopped');
  }

  /**
   * Get current session count (for status display).
   */
  getSessionCount() {
    return this.sessions.size;
  }

  /**
   * Get whether relay is connected.
   */
  isRelayConnected() {
    return this.relayReady;
  }
}

module.exports = { ProxyEngine };
