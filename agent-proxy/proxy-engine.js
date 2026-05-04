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
const claudeCli    = require('./claude-cli');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Deterministic per-session stagger offset so different periodic reads
// (task_list, rate_limit, native_queue, automation_view…) don't fire on the
// same poll tick. Without this, every counter starts at 0 and they all hit
// their threshold together, which fires a burst of 4-5 heavy CDP evals at
// once and visibly locks up the renderer for codex / codex-desktop.
function staggerOffset(sessionId, key, modulo) {
  if (!modulo || modulo <= 1) return 0;
  let h = 2166136261;
  const s = String(sessionId || '') + '|' + String(key || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % modulo;
}

// ─── Codex model/effort/access constants ────────────────────────────────────

const CODEX_MODELS = [
  { id: 'gpt-5.5',           label: 'GPT-5.5' },
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
const CODEX_SPEEDS = [
  { id: 'standard', label: 'Standard' },
  { id: 'fast',     label: 'Fast' },
];

function normalizeCodexSpeed(value) {
  const speed = String(value || '').toLowerCase().trim();
  if (!speed || speed === 'unknown') return 'standard';
  if (speed === 'default' || speed === 'auto') return 'standard';
  return speed;
}

function codexSpeedToConfigValue(speed) {
  return normalizeCodexSpeed(speed) === 'standard' ? 'default' : normalizeCodexSpeed(speed);
}

// ─── Retriable send codes ───────────────────────────────────────────────────

const RETRIABLE_SEND_CODES = new Set([
  'input_not_found',
  'send_button_failed',
  'fallback_no_input',
  // agent_busy is NOT retriable — messages are queued instead (steer feature)
]);
const SEND_MAX_RETRIES    = 8;
const SEND_RETRY_DELAY_MS = 3000;
// Keep below the relay's 128 MB ws maxPayload, but large enough for long
// virtualized Codex transcripts that must be resynced as one authoritative
// history snapshot.
const RELAY_MESSAGE_MAX_BYTES = 96 * 1024 * 1024;

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
    this.activeErrorPrompts = new Map();
    this.openWorkspaces = [];
    this._cdpPortCooldownUntil = new Map();
    this._cdpTargetCooldownUntil = new Map();

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

    // Best-effort cache for Antigravity quota usage scraped from the Settings page.
    this._antigravityQuotaCache = { fetchedAt: 0, data: null };

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
    const isClaudeCli = agentType === 'claude_cli';
    const isDesktop = agentType === 'codex-desktop' || agentType === 'claude-desktop';
    const isContinue = agentType === 'continue' || agentType === 'continue_yolo';
    const isRooCode = agentType === 'roo_code';
    const isClineLike = isRooCode || agentType === 'cline';
    return {
      interrupt:              ['claude', 'claude_cli', 'codex', 'gemini', 'continue', 'continue_yolo', 'antigravity', 'antigravity_panel', 'claude-desktop', 'codex-desktop', 'roo_code', 'cline'].includes(agentType),
      set_model:              ['claude', 'claude_cli', 'antigravity', 'antigravity_panel', 'gemini', 'continue', 'continue_yolo'].includes(agentType) || isClineLike,
      set_mode:               agentType === 'antigravity' || isClineLike,
      permission_mode_change: agentType === 'claude' || agentType === 'claude_cli' || agentType === 'continue_yolo' || isRooCode,
      auto_approve_permissions_toggle: agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'antigravity_panel',
      permission_dialogs:     isClaude || isClaudeCli || isCodex || agentType === 'antigravity' || agentType === 'antigravity_panel' || isContinue || isClineLike,
      set_codex_config:       isCodex,
      set_effort:             isClaudeCli,
      new_thread:             isDesktop,
      thread_list:            isDesktop,
      switch_thread:          isDesktop,
      switch_workspace:       isDesktop,
      native_window:          isClaudeCli,
      open_panel:             false, // Codex side pane is already open if session exists
      chat_list:              agentType === 'codex' || agentType === 'continue' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || isClineLike,
      switch_chat:            agentType === 'codex' || agentType === 'continue' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || isClineLike,
      new_chat:               agentType === 'codex' || agentType === 'continue_yolo' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || agentType === 'claude' || agentType === 'claude_cli' || isClineLike,
      terminal_output:        isCodex || agentType === 'claude-desktop',
      terminal_input:         agentType === 'codex-desktop',
      file_changes:           isCodex || agentType === 'claude-desktop',
      send_attachment:        isCodex,
      branch_list:            true,
      switch_branch:          true,
      create_branch:          true,
      skill_list:             agentType === 'codex-desktop',
      automation_view:        agentType === 'codex-desktop',
      file_browser:           true, // all session types support workspace file browsing
    };
  }

  _readJsonFileIfPresent(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  _modelOption(id, label) {
    const value = String(id || '').trim();
    if (!value) return null;
    return { id: value, label: String(label || value).trim() || value };
  }

  _mergeModelOptions(...lists) {
    const out = [];
    const seen = new Set();
    const add = item => {
      const option = typeof item === 'string'
        ? this._modelOption(item)
        : this._modelOption(item?.id || item?.value || item?.model || item?.name, item?.label || item?.name || item?.id);
      if (!option) return;
      const key = option.id.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(option);
    };
    for (const list of lists) {
      if (Array.isArray(list)) list.forEach(add);
      else if (list) add(list);
    }
    return out;
  }

  _readRooOllamaModelOptions() {
    const appdata = process.env.APPDATA;
    if (!appdata) return [];
    const filePath = path.join(appdata, 'Antigravity', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'cache', 'ollama_models.json');
    const data = this._readJsonFileIfPresent(filePath);
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data)
      .map(([id, info]) => this._modelOption(id, info?.name || id))
      .filter(Boolean);
  }

  _readClineHistoryModelOptions() {
    const appdata = process.env.APPDATA;
    if (!appdata) return [];
    const filePath = path.join(appdata, 'Antigravity', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'state', 'taskHistory.json');
    const data = this._readJsonFileIfPresent(filePath);
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.tasks) ? data.tasks : []);
    return rows
      .map(row => row?.modelId || row?.model_id)
      .filter(Boolean)
      .map(id => this._modelOption(id))
      .filter(Boolean);
  }

  _stripProviderPrefix(modelId) {
    const raw = String(modelId || '').trim();
    const match = raw.match(/^(anthropic|openai|openrouter|gemini|lmstudio|vscode-lm|ollama|hicap|requesty|cline):(.+)$/i);
    return match ? match[2].trim() : raw;
  }

  _augmentClineLikeModels(agentType, domCfg) {
    const current = this._stripProviderPrefix(domCfg?.model_id);
    const domModels = Array.isArray(domCfg?.available_models)
      ? domCfg.available_models.map(model => {
          if (typeof model === 'string') return this._stripProviderPrefix(model);
          const id = this._stripProviderPrefix(model?.id || model?.value || model?.model || model?.name);
          return { ...model, id, label: model?.label || id };
        })
      : [];
    if (agentType === 'cline') {
      return this._mergeModelOptions(
        current && current !== 'unknown' ? current : null,
        domModels,
        this._readClineHistoryModelOptions(),
        this._readRooOllamaModelOptions()
      );
    }
    return this._mergeModelOptions(
      current && current !== 'unknown' ? current : null,
      domModels,
      this._readRooOllamaModelOptions()
    );
  }

  _mergeAgentConfig(agentType, domCfg, workspacePath) {
    const branch = this._readGitBranch(workspacePath);
    const codexCfg = this._readCodexConfigValues();
    if (agentType === 'claude') {
      const settings = this._readAntigravitySettings();
      const permMode  = domCfg?.permission_mode || settings['claudeCode.initialPermissionMode'] || 'unknown';
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
    if (agentType === 'claude_cli') {
      return {
        model_id:          domCfg?.model_id || 'default',
        permission_mode:   domCfg?.permission_mode || 'default',
        effort:            domCfg?.effort || 'medium',
        file_access_scope: workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:  claudeCli.CLAUDE_CLI_MODELS,
        available_efforts: claudeCli.CLAUDE_CLI_EFFORTS,
        available_permission_modes: claudeCli.CLAUDE_CLI_PERMISSION_MODES,
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'codex') {
      const modelId = (domCfg?.model_id && domCfg.model_id !== 'unknown')
        ? domCfg.model_id
        : (codexCfg.model || 'unknown');
      const effort = (domCfg?.effort && domCfg.effort !== 'unknown')
        ? domCfg.effort
        : (codexCfg.model_reasoning_effort || codexCfg.reasoning_effort || 'unknown');
      const permissionMode = (domCfg?.permission_mode && domCfg.permission_mode !== 'unknown')
        ? domCfg.permission_mode
        : (codexCfg.sandbox_mode || 'unknown');
      const speed = normalizeCodexSpeed((domCfg?.speed && domCfg.speed !== 'unknown')
        ? domCfg.speed
        : (codexCfg.service_tier || codexCfg.model_speed || codexCfg.speed || 'standard'));
      return {
        model_id:           modelId,
        permission_mode:    permissionMode,
        effort:             effort,
        speed:              speed,
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   CODEX_MODELS,
        available_efforts:  CODEX_EFFORTS,
        available_access:   CODEX_ACCESS_MODES,
        available_speeds:   CODEX_SPEEDS,
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'codex-desktop') {
      const modelId = (domCfg?.model_id && domCfg.model_id !== 'unknown')
        ? domCfg.model_id
        : (codexCfg.model || 'unknown');
      const effort = (domCfg?.effort && domCfg.effort !== 'unknown')
        ? domCfg.effort
        : (codexCfg.model_reasoning_effort || codexCfg.reasoning_effort || 'unknown');
      const permissionMode = (domCfg?.permission_mode && domCfg.permission_mode !== 'unknown')
        ? domCfg.permission_mode
        : (codexCfg.sandbox_mode || 'unknown');
      const speed = normalizeCodexSpeed((domCfg?.speed && domCfg.speed !== 'unknown')
        ? domCfg.speed
        : (codexCfg.service_tier || codexCfg.model_speed || codexCfg.speed || 'standard'));
      return {
        model_id:           modelId,
        permission_mode:    permissionMode,
        effort:             effort,
        speed:              speed,
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   CODEX_MODELS,
        available_efforts:  CODEX_EFFORTS,
        available_access:   CODEX_ACCESS_MODES,
        available_speeds:   CODEX_SPEEDS,
        branch:             branch || 'unknown',
        sandbox_status:     domCfg?.sandbox_status  || null,
      };
    }
    if (agentType === 'continue' || agentType === 'continue_yolo') {
      return {
        model_id:           domCfg?.model_id        || 'unknown',
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   domCfg?.available_models || [],
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'roo_code') {
      const availableModels = this._augmentClineLikeModels(agentType, domCfg);
      const modelId = this._stripProviderPrefix(domCfg?.model_id) || 'unknown';
      return {
        model_id:           modelId,
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   availableModels,
        available_modes:    domCfg?.available_modes || [],
        available_permission_modes: domCfg?.available_permission_modes || [],
        has_model_dropdown: !!domCfg?.has_model_dropdown,
        has_mode_control:   !!domCfg?.has_mode_control,
        has_permission_dropdown: !!domCfg?.has_permission_dropdown,
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'cline') {
      const availableModels = this._augmentClineLikeModels(agentType, domCfg);
      const modelId = this._stripProviderPrefix(domCfg?.model_id) || 'unknown';
      return {
        model_id:           modelId,
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   availableModels,
        available_modes:    domCfg?.available_modes || [],
        available_permission_modes: domCfg?.available_permission_modes || [],
        has_model_dropdown: !!domCfg?.has_model_dropdown,
        has_mode_control:   !!domCfg?.has_mode_control,
        has_permission_dropdown: !!domCfg?.has_permission_dropdown,
        branch:             branch || 'unknown',
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

  _decorateAgentConfig(session, config) {
    return {
      ...config,
      auto_approve_permissions: !!session?.autoApprovePermissions,
    };
  }

  _supportsAutoApprovePermissions(agentType) {
    return agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'antigravity_panel';
  }

  _normalizeAutoApprovePreferencePart(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\\/]+/g, '/')
      .replace(/\s+/g, ' ');
  }

  _buildAutoApprovePreferenceKey(agentType, context = {}) {
    if (!this._supportsAutoApprovePermissions(agentType)) return null;
    const workspacePath = this._normalizeAutoApprovePreferencePart(context.workspacePath);
    const workspaceName = this._normalizeAutoApprovePreferencePart(context.workspaceName);
    const windowTitle = this._normalizeAutoApprovePreferencePart(context.windowTitle);
    const base = workspacePath || workspaceName || windowTitle;
    if (!base) return null;
    return `${agentType}|${base}`;
  }

  _resolveAutoApproveState(agentType, sessionMeta, context = {}) {
    const preferenceKey = this._buildAutoApprovePreferenceKey(agentType, context);
    const pref = preferenceKey ? sessionStore.getPreference(preferenceKey) : null;
    const enabled = pref?.auto_approve_permissions === true || sessionMeta?.auto_approve_permissions === true;
    if (enabled && preferenceKey && pref?.auto_approve_permissions !== true) {
      sessionStore.updatePreference(preferenceKey, { auto_approve_permissions: true });
    }
    return { enabled, preferenceKey };
  }

  _refreshSessionPreferenceKey(session) {
    if (!session || !this._supportsAutoApprovePermissions(session.agentType)) return;
    const preferenceKey = this._buildAutoApprovePreferenceKey(session.agentType, {
      workspacePath: session.workspace_path,
      workspaceName: session.workspace_name,
      windowTitle: session.windowTitle,
    });
    if (!preferenceKey || preferenceKey === session.preferenceKey) return;
    session.preferenceKey = preferenceKey;
    if (session.autoApprovePermissions) {
      sessionStore.updatePreference(preferenceKey, { auto_approve_permissions: true });
    }
  }

  _selectAutoApproveChoice(prompt) {
    const choices = Array.isArray(prompt?.choices) ? prompt.choices : [];
    const positivePatterns = [
      /\baccept\b/i,
      /\ballow\b/i,
      /\bapprove\b/i,
      /\brun\b/i,
      /\bcontinue\b/i,
      /\bproceed\b/i,
      // Antigravity surfaces a "Running background command" prompt with
      // [Relocate / Always run / Cancel] after a long-running command starts.
      // Relocate just dismisses the UI prompt (the command keeps running),
      // so treat it as the auto-approve action to clear the dialog.
      /\brelocate\b/i,
    ];
    // "always run"/"allow always" are mode toggles on dropdowns (e.g. Antigravity
    // side panel) — selecting them changes the permission setting but does not
    // actually approve the pending action. Skip them so we fall through to the
    // real Run/Accept button.
    const negativePattern = /\b(reject|deny|cancel|block|stop|not now|always)\b/i;
    for (const choice of choices) {
      const label = String(choice?.label || choice?.title || choice?.text || choice?.choice_id || '').trim();
      const cid = String(choice?.choice_id || choice?.id || choice?.value || '').trim();
      if (!label || negativePattern.test(label) || negativePattern.test(cid)) continue;
      if (positivePatterns.some(pattern => pattern.test(label))) {
        return choice.choice_id || choice.id || choice.value || null;
      }
    }
    return null;
  }

  async _attemptAutoApprovePrompt(sessionId, session, prompt, surfacedToRelay = false) {
    if (!session || !session.autoApprovePermissions || !this._supportsAutoApprovePermissions(session.agentType)) {
      return false;
    }
    const choiceId = this._selectAutoApproveChoice(prompt);
    if (!choiceId) return false;

    this.activePermissionPrompts.set(sessionId, {
      prompt_id: prompt.prompt_id,
      prompt,
      surfaced: false,
      auto_pending: true,
    });
    this._log('info', `[${sessionId}] [perm] Auto-approving "${choiceId}"`);

    try {
      const permissionPromise = this._isEphemeralIframeAgent(session.agentType)
        ? this._withEphemeralIframeClient(session, client =>
            selectors.respondToPermissionDialog(client.Runtime, session.agentType, choiceId, sessionId)
          , 'permission_response')
        : selectors.respondToPermissionDialog(session.client.Runtime, session.agentType, choiceId, sessionId);
      const result = await permissionPromise;
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (!result.ok) {
        this._log('warn', `[${sessionId}] [perm] Auto-approve failed: ${result.detail || result.code || 'unknown'}`);
        return false;
      }
      if (surfacedToRelay) {
        this._sendToRelay({
          type:             'permission_prompt_expired',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id:       sessionId,
          prompt_id:        prompt.prompt_id,
          applied_choice:   choiceId,
          expired_at:       new Date().toISOString(),
        });
      }
      return true;
    } catch (err) {
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      this._log('warn', `[${sessionId}] [perm] Auto-approve exception: ${err.message}`);
      return false;
    }
  }

  async _handlePermissionDialogState(sessionId, session, perm) {
    if (perm) {
      const promptId = this._makePromptId(sessionId, perm.message, perm.choices);
      const last = this.activePermissionPrompts.get(sessionId);
      const isSameAsLast = last && last.prompt_id === promptId;

      // Same prompt as last poll — if it's already been surfaced to the webui
      // and auto-approve is now on (or a previous auto-approve attempt failed),
      // retry the click so the webui prompt clears once the click lands.
      // Without this, a prompt that fails initial auto-approve (e.g. button
      // not rendered yet) gets stuck on the webui forever.
      if (isSameAsLast) {
        if (session?.autoApprovePermissions && last.surfaced) {
          if (await this._attemptAutoApprovePrompt(sessionId, session, last.prompt, true)) {
            return;
          }
        }
        return;
      }

      const prompt = {
        type:             'permission_prompt',
        protocol_version: proto.PROTOCOL_VERSION,
        session_id:       sessionId,
        prompt_id:        promptId,
        message:          perm.message,
        choices:          perm.choices,
        timeout_ms:       300000,
        detected_at:      new Date().toISOString(),
      };

      if (await this._attemptAutoApprovePrompt(sessionId, session, prompt, false)) {
        return;
      }

      // Diagnostic-only prompts (no actionable choices) — log and skip relay.
      if (perm.message?.startsWith?.('[fwc-diag]')) {
        this._log('info', `[${sessionId}] [perm] ${perm.message.substring(0, 1500)}`);
        return;
      }

      this._log('info', `[${sessionId}] [perm] Permission dialog detected: "${perm.message.substring(0, 60)}..."`);
      this.activePermissionPrompts.set(sessionId, { prompt_id: promptId, prompt, surfaced: true });
      this._sendToRelay(prompt);
      return;
    }

    if (this.activePermissionPrompts.has(sessionId)) {
      const last = this.activePermissionPrompts.get(sessionId);
      this._log('info', `[${sessionId}] [perm] Permission dialog dismissed`);
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (last?.surfaced) {
        this._sendToRelay({
          type:             'permission_prompt_expired',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id:       sessionId,
          prompt_id:        last.prompt_id,
          expired_at:       new Date().toISOString(),
        });
      }
    }
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
      await this._safeClose(client);

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
      await this._safeClose(client);
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

  _isTranscriptAccumulating(agentType) {
    return agentType === 'antigravity_panel'
      || agentType === 'antigravity'
      || agentType === 'claude'
      || agentType === 'codex';
  }

  _shouldResetAccumulatorOnNoOverlap(agentType) {
    return false;
  }

  _maybePersistAccumulatedMessages(sessionId, session, options = {}) {
    if (!session || !Array.isArray(session._accumulatedMessages)) return;
    if (!session._accumulatedDirty && !options.force) return;
    const now = Date.now();
    const minIntervalMs = options.force ? 0 : 15000;
    if (!options.force && session._lastAccumulatedPersistAt && now - session._lastAccumulatedPersistAt < minIntervalMs) {
      return;
    }
    sessionStore.updateSession(sessionId, { accumulated_messages: session._accumulatedMessages });
    session._accumulatedDirty = false;
    session._lastAccumulatedPersistAt = now;
  }

  _transcriptWindowOffset(accumulated, windowMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const win = Array.isArray(windowMessages) ? windowMessages : [];
    if (win.length === 0) return acc.length;
    if (win.length > acc.length) return -1;
    for (let start = 0; start <= acc.length - win.length; start++) {
      let match = true;
      for (let i = 0; i < win.length; i++) {
        if (!this._messagesSoftMatch(acc[start + i], win[i])) {
          match = false;
          break;
        }
      }
      if (match) return start;
    }
    return -1;
  }

  _accumulatedTranscriptContainsWindow(accumulated, windowMessages) {
    return this._transcriptWindowOffset(accumulated, windowMessages) >= 0;
  }

  _mergeTranscriptWindow(sessionId, session, windowMessages) {
    const dom = Array.isArray(windowMessages) ? windowMessages : [];
    if (!session._accumulatedMessages) {
      session._accumulatedMessages = dom.slice();
      return session._accumulatedMessages;
    }

    const acc = session._accumulatedMessages;
    if (dom.length === 0) return acc;

    const existingOffset = this._transcriptWindowOffset(acc, dom);
    if (existingOffset >= 0) {
      for (let i = 0; i < dom.length; i++) {
        const accIdx = existingOffset + i;
        if (this._messageContentText(dom[i]).length > this._messageContentText(acc[accIdx]).length) {
          acc[accIdx] = dom[i];
        }
      }
      return acc;
    }

    let overlapLen = 0;
    for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
      let match = true;
      for (let k = 0; k < tryLen; k++) {
        if (!this._messagesSoftMatch(acc[acc.length - tryLen + k], dom[k])) {
          match = false;
          break;
        }
      }
      if (match) {
        overlapLen = tryLen;
        break;
      }
    }

    if (overlapLen > 0) {
      for (let k = 0; k < overlapLen; k++) {
        const accIdx = acc.length - overlapLen + k;
        if (this._messageContentText(dom[k]).length > this._messageContentText(acc[accIdx]).length) {
          acc[accIdx] = dom[k];
        }
      }
      for (let k = overlapLen; k < dom.length; k++) acc.push(dom[k]);
      return acc;
    }

    this._log('warn', `[${sessionId}] No transcript overlap while accumulating ${session.agentType}; appending visible window`);
    for (const m of dom) acc.push(m);
    return acc;
  }

  _resetTranscriptState(session, reason) {
    session._accumulatedMessages = null;
    session.lastMessageCount = 0;
    session.lastObservedCount = 0;
    session.lastTranscriptSig = '';
    session.pendingLast = null;
    session.resyncCandidateSig = null;
    session.waitingForAssistant = false;
    session._forceHistoryResync = reason || 'transcript reset';
  }

  // ─── Reconnect backoff ───────────────────────────────────────────────────

  _reconnectDelay() {
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt), this.MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    return delay;
  }

  _withTimeout(promise, timeoutMs, label) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // chrome-remote-interface's client.close() awaits the WebSocket close
  // handshake. When the underlying socket is wedged (renderer hung, network
  // drop), that handshake never completes and the await hangs forever. We
  // see this as the proxy poll loop "skipping" thousands of ticks because
  // a tear-down step never returns. Always close clients via this helper.
  async _safeClose(client, label = 'close') {
    if (!client) return;
    try {
      await this._withTimeout(client.close(), 2000, label);
    } catch {}
  }

  _isCodexSurface(agentType) {
    return agentType === 'codex' || agentType === 'codex-desktop';
  }

  _isCdpPortCooling(port) {
    const until = this._cdpPortCooldownUntil.get(port) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this._cdpPortCooldownUntil.delete(port);
      return false;
    }
    return true;
  }

  _cooldownCdpPort(port, reason, ms = 15000) {
    if (!port) return;
    const until = Date.now() + ms;
    const prev = this._cdpPortCooldownUntil.get(port) || 0;
    this._cdpPortCooldownUntil.set(port, Math.max(prev, until));
    if (!prev || Date.now() >= prev) {
      this._log('warn', `[cdp] Cooling down port ${port} for ${Math.round(ms / 1000)}s (${reason})`);
    }
  }

  _isCdpTargetCooling(targetId) {
    if (!targetId) return false;
    const until = this._cdpTargetCooldownUntil.get(targetId) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this._cdpTargetCooldownUntil.delete(targetId);
      return false;
    }
    return true;
  }

  _cooldownCdpTarget(targetOrSession, reason, ms = 30000) {
    const targetId = targetOrSession?.targetId || targetOrSession?.id;
    if (!targetId) return;
    const until = Date.now() + ms;
    const prev = this._cdpTargetCooldownUntil.get(targetId) || 0;
    this._cdpTargetCooldownUntil.set(targetId, Math.max(prev, until));
    if (targetOrSession?._cdpPort) this._cooldownCdpPort(targetOrSession._cdpPort, reason, Math.min(ms, 15000));
    if (!prev || Date.now() >= prev) {
      this._log('warn', `[cdp] Cooling down target ${targetId.substring(0, 8)} for ${Math.round(ms / 1000)}s (${reason})`);
    }
  }

  _connectCdpTarget(target, port, label, timeoutMs = 4000) {
    const targetId = typeof target === 'string' ? target : target.id;
    return this._withTimeout(CDP({ port, target: targetId }), timeoutMs, label || `CDP connect ${targetId?.substring?.(0, 8) || targetId}`);
  }

  // ─── CDP target resolution ───────────────────────────────────────────────

  async _listTargetsOnPort(port) {
    if (this._isCdpPortCooling(port)) return [];
    return this._withTimeout(CDP.List({ port }), 3000, `CDP list port ${port}`);
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
          if (String(r.reason?.message || '').includes('timed out')) {
            this._cooldownCdpPort(this.CDP_PORTS[i], r.reason.message, 15000);
          }
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
        this._readSessionConfig(session, resolvedPath)
          .then(cfg => {
            const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, cfg, resolvedPath));
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          })
          .catch(err => {
            const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, null, resolvedPath));
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}) fallback (err: ${err?.message}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          });
      }
      // Re-sync transcript history
      for (const [sessionId, session] of this.sessions.entries()) {
        this._readSessionMessages(session, sessionId)
          .then(raw => {
            if (!raw && !session._accumulatedMessages) return;
            const msgs = raw ? JSON.parse(raw) : [];
            const effMsgs = session._accumulatedMessages || msgs;
            if (effMsgs.length > 0) this._sendHistorySnapshot(sessionId, effMsgs, 'relay reconnect resync');
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
      if (sessionData.agentType === 'claude_cli') {
        if (sessionData._claudeCliChild) {
          try { sessionData._claudeCliChild.kill(); } catch {}
          sessionData._claudeCliChild = null;
        }
        const activity = { kind: 'idle', label: 'Interrupted', updated_at: new Date().toISOString() };
        sessionData.activity = activity;
        sessionStore.updateSession(sid, { activity });
        this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', activity));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'ok'));
        return;
      }
      const interruptPromise = this._isEphemeralIframeAgent(sessionData.agentType)
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.interruptAgent(client.Runtime, sessionData.agentType, sid)
          , 'interrupt')
        : selectors.interruptAgent(sessionData.client.Runtime, sessionData.agentType, sid);
      interruptPromise
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

    if (type === 'agent_set_auto_approve_permissions') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const enabled = msg.enabled === true;
      const agentT = sessionData?.agentType;

      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      if (!this._supportsAutoApprovePermissions(agentT)) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'failed', {
          code: 'not_supported', message: `Auto-approve is not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      sessionData.autoApprovePermissions = enabled;
      sessionStore.updateSession(sid, { auto_approve_permissions: enabled });
      if (sessionData.preferenceKey) {
        sessionStore.updatePreference(sessionData.preferenceKey, { auto_approve_permissions: enabled });
      }
      this._log('info', `[ctrl] auto_approve_permissions for ${sid}: ${enabled}`);
      this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'ok'));

      this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
        .then(cfg => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT) }));
        })
        .catch(() => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, sessionData.workspace_path));
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT) }));
        });

      const lastPrompt = this.activePermissionPrompts.get(sid);
      if (enabled && lastPrompt?.prompt) {
        this._attemptAutoApprovePrompt(sid, sessionData, lastPrompt.prompt, !!lastPrompt.surfaced).catch(() => {});
      }
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
        this.activeErrorPrompts.delete(sid);
        return;
      }

      const permissionPromise = this._isEphemeralIframeAgent(sessionData.agentType)
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.respondToPermissionDialog(client.Runtime, sessionData.agentType, choiceId, sid)
          , 'permission_response')
        : selectors.respondToPermissionDialog(sessionData.client.Runtime, sessionData.agentType, choiceId, sid);
      permissionPromise
        .then(result => {
          if (result.ok) {
            this.activePermissionPrompts.delete(sid);
            this.activeErrorPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'ok'));
          } else {
            // Clear activePermissionPrompts on failure so re-detection works
            this.activePermissionPrompts.delete(sid);
            this.activeErrorPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
              code: result.code || 'click_failed', message: result.detail || 'Could not click permission dialog button',
            }));
          }
        })
        .catch(err => {
          // Clear activePermissionPrompts on error so re-detection works
          this.activePermissionPrompts.delete(sid);
          this.activeErrorPrompts.delete(sid);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'error_prompt_action') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      this._log('info', `[ctrl] error_prompt_action for ${sid} action=${msg.action_id}`);
      const actionPromise = this._isEphemeralIframeAgent(sessionData.agentType)
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.respondToSessionErrorPrompt(client.Runtime, sessionData.agentType, msg.action_id, sid)
          , 'error_prompt_action')
        : selectors.respondToSessionErrorPrompt(sessionData.client.Runtime, sessionData.agentType, msg.action_id, sid);
      actionPromise
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
              code: result.code || 'click_failed', message: result.detail || 'Could not apply error prompt action',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
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
      if (sessionData.agentType === 'claude_cli') {
        sessionData.model_id = modelId || 'default';
        sessionStore.updateSession(sid, { model_id: sessionData.model_id });
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig('claude_cli', {
          model_id: sessionData.model_id,
          permission_mode: sessionData.permission_mode,
          effort: sessionData.effort,
        }, sessionData.workspace_path));
        this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities('claude_cli') }));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
        return;
      }
      const setModelPromise = this._isEphemeralIframeAgent(sessionData.agentType)
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.setAgentModel(client.Runtime, sessionData.agentType, modelId, sid, client.Input)
          , 'set_model')
        : selectors.setAgentModel(sessionData.client.Runtime, sessionData.agentType, modelId, sid, sessionData.client.Input);
      setModelPromise
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
            return this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path));
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
      const isRooCodeLike = sessionData.agentType === 'roo_code' || sessionData.agentType === 'cline';
      if (sessionData.agentType !== 'antigravity' && !isRooCodeLike) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'not_supported', message: `Conversation mode not supported for ${sessionData.agentType}`,
        }));
        return;
      }
      if (!isRooCodeLike && !sessionData.client.Input) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'no_input_domain', message: 'CDP Input domain not available',
        }));
        return;
      }
      const mode = msg.mode;
      this._log('info', `[ctrl] agent_set_mode for ${sid} mode=${mode}`);
      const setModePromise = isRooCodeLike
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.setRooCodeMode(client.Runtime, mode, sid, client.Input)
          , 'set_mode')
        : selectors.setAntigravityMode(sessionData.client.Runtime, sessionData.client.Input, mode, sid);
      setModePromise
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'ok'));
            return this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path));
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
          model_id: 'unknown', permission_mode: 'unknown', file_access_scope: 'unknown', auto_approve_permissions: false, capabilities,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_config_request for ${sid} (${agentT})`);
      this._readSessionConfig(
        sessionData,
        sessionData.workspace_path,
        (agentT === 'continue' || agentT === 'continue_yolo') ? { forceRefresh: true } : {}
      )
        .then(cfg => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
          this._log('info', `[ctrl] agent_config sending for ${sid}: ${JSON.stringify({ ...merged, capabilities })}`);
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities }));
        })
        .catch(() => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, sessionData.workspace_path));
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

      const isRooCodeLike = agentT === 'roo_code' || agentT === 'cline';
      if (agentT !== 'claude' && agentT !== 'claude_cli' && agentT !== 'continue_yolo' && !isRooCodeLike) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
          code: 'not_supported', message: `Permission mode change not supported for ${agentT || 'unknown'} agent`,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_set_permission_mode for ${sid} mode=${mode}`);
      if (agentT === 'claude_cli') {
        sessionData.permission_mode = mode || 'default';
        sessionStore.updateSession(sid, { permission_mode: sessionData.permission_mode });
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig('claude_cli', {
          model_id: sessionData.model_id,
          permission_mode: sessionData.permission_mode,
          effort: sessionData.effort,
        }, sessionData.workspace_path));
        this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities('claude_cli') }));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'ok'));
        return;
      }
      const persisted = agentT === 'claude'
        ? this._writeAntigravitySetting('claudeCode.initialPermissionMode', mode)
        : true;
      this._withEphemeralIframeClient(sessionData, client =>
        selectors.setAgentPermissionMode(client.Runtime, agentT, mode, sid, client.Input)
      , 'set_permission_mode')
        .then(result => {
          if (agentT === 'claude' && !persisted) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
              code: 'write_failed', message: 'Updated the live Claude session, but could not persist Antigravity settings.json',
            }));
            return;
          }
          if (!result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
              code: result.code || 'set_failed',
              message: result.detail || 'Could not update Claude permission mode in the live session',
            }));
            return;
          }

          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'ok'));
          setTimeout(() => {
            this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT) }));
              })
              .catch(() => {});
          }, 250);
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    // ── Codex config change ─────────────────────────────────────────────
    if (type === 'agent_set_effort') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const effort = msg.effort;
      if (!sessionData || sessionData.agentType !== 'claude_cli') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'failed', {
          code: 'not_supported', message: `Effort change not supported for ${sessionData?.agentType || 'unknown'} agent`,
        }));
        return;
      }
      const allowed = new Set(claudeCli.CLAUDE_CLI_EFFORTS.map(item => item.id));
      if (!effort || !allowed.has(effort)) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'failed', {
          code: 'invalid_effort', message: `Unsupported Claude CLI effort: ${effort || 'empty'}`,
        }));
        return;
      }
      sessionData.effort = effort;
      sessionStore.updateSession(sid, { effort });
      const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig('claude_cli', {
        model_id: sessionData.model_id,
        permission_mode: sessionData.permission_mode,
        effort: sessionData.effort,
      }, sessionData.workspace_path));
      this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities('claude_cli') }));
      this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'ok'));
      return;
    }

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
      if (msg.speed)         updates.service_tier       = codexSpeedToConfigValue(msg.speed);

      if (Object.keys(updates).length === 0) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'no_fields', message: 'No config fields specified',
        }));
        return;
      }

      this._log('info', `[ctrl] set_codex_config for ${sid}: ${JSON.stringify(updates)}`);

      if (agentT === 'codex' || agentT === 'codex-desktop') {
        const cdpUpdates = {};
        if (msg.model_id)    cdpUpdates.model_id    = msg.model_id;
        if (msg.effort)      cdpUpdates.effort      = msg.effort;
        if (msg.access_mode) cdpUpdates.access_mode = msg.access_mode;
        if (msg.speed)       cdpUpdates.speed       = msg.speed;
        selectors.setCodexDesktopConfig(sessionData.client.Runtime, cdpUpdates, agentT === 'codex-desktop').catch(() => {});
      }

      const ok = this._writeCodexConfigValues(updates);
      if (ok) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'ok'));
        selectors.readAgentConfig(sessionData.client.Runtime, agentT, sessionData.workspace_path)
          .then(cfg => {
            const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
            if (msg.model_id)    merged.model_id        = msg.model_id;
            if (msg.effort)      merged.effort           = msg.effort;
            if (msg.access_mode) merged.permission_mode  = msg.access_mode;
            if (msg.speed)       merged.speed            = msg.speed;
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
                  const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, folderPath));
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
        .then(async result => {
          if (result.ok) {
            try {
              const freshMessages = await selectors.readMessages(sessionData.client.Runtime, sessionData.agentType, sid);
              sessionData._accumulatedMessages = null;
              sessionStore.updateSession(sid, { accumulated_messages: null });
              sessionData.lastMessageCount = freshMessages.length;
              sessionData.lastObservedCount = freshMessages.length;
              sessionData.pendingLast = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
              this._sendHistorySnapshot(sid, freshMessages, 'switch_thread');
            } catch {}
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
        .then(async ok => {
          let finalOk = ok;
          if (!finalOk && agentT === 'codex-desktop') {
            try {
              const res = await sessionData.client.Runtime.evaluate({
                expression: `(function() {
                  const body = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
                  return /let.?s build|message codex|what can i help|start typing/.test(body);
                })()`,
                returnByValue: true,
                awaitPromise: false,
              });
              finalOk = !!res?.result?.value;
            } catch {}
          }
          if (finalOk) {
            try {
              const freshMessages = await selectors.readMessages(sessionData.client.Runtime, sessionData.agentType, sid);
              sessionData._accumulatedMessages = null;
              sessionStore.updateSession(sid, { accumulated_messages: null });
              sessionData.lastMessageCount = freshMessages.length;
              sessionData.lastObservedCount = freshMessages.length;
              sessionData.pendingLast = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
              this._sendHistorySnapshot(sid, freshMessages, 'new_thread');
            } catch {}
          }
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', finalOk ? 'ok' : 'failed'));
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

      if (agentT !== 'codex' && agentT !== 'continue' && agentT !== 'codex-desktop' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop') {
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

      if (agentT === 'codex-desktop') {
        sessionData._accumulatedMessages = null;
        sessionStore.updateSession(sid, { accumulated_messages: null });
      }
      if (agentT === 'continue') {
        this._withWorkbenchClient(sessionData, client =>
          selectors.readContinueWorkbenchChatList(client.Runtime, sessionData._webviewId)
        )
          .then(chats => {
            this._log('info', `[ctrl] chat_list result for ${sid}: ${chats.length} continue tabs`);
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] continue chat_list failed for ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
        return;
      }
      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      // For desktop apps, reuse the thread list reader which understands the page-level DOM
      const readerFn = (agentT === 'codex-desktop' || agentT === 'claude-desktop')
        ? selectors.readCodexThreadList(sessionData.client.Runtime, true)
        : selectors.readCodexChatList(sessionData.client.Runtime, usePageEval, true);
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

      if (agentT !== 'codex' && agentT !== 'continue' && agentT !== 'codex-desktop' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop') {
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

      if (agentT === 'continue') {
        this._withWorkbenchClient(sessionData, client =>
          selectors.switchContinueWorkbenchChat(client.Runtime, sessionData._webviewId, chatId)
        )
          .then(async result => {
            if (!result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
                code: result.code || 'chat_not_found', message: result.detail || 'Chat not found',
              }));
              return;
            }

            sessionData._continueConfigCache = null;
            sessionData.lastMessageCount = 0;
            sessionData.lastObservedCount = 0;
            sessionData.lastTranscriptSig = '';
            sessionData.pendingLast = null;
            sessionData.waitingForAssistant = false;
            sessionData.resyncCandidateSig = null;
            sessionData._lastStreamedContent = null;
            this._sendHistorySnapshot(sid, [], 'continue switch chat clear');

            if (Array.isArray(result.chats)) {
              const chatListSig = JSON.stringify(result.chats.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
              sessionData._lastChatListSig = chatListSig;
              this._sendToRelay(proto.chatList(sid, result.chats));
              const activeChat = result.chats.find(c => c && c.active);
              if (activeChat?.title) {
                sessionData.chat_title = activeChat.title;
              }
            }

            this._broadcastSessionSnapshot();
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
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

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'continue_yolo' && agentT !== 'antigravity_panel' && agentT !== 'claude-desktop' && agentT !== 'claude' && agentT !== 'claude_cli') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
          code: 'not_supported', message: `new_chat not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'claude_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspacePath = sessionData.workspace_path || process.cwd();
        const workspaceName = sessionData.workspace_name || path.basename(workspacePath) || 'Claude CLI';
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath,
          workspaceName,
          title: 'New Claude CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: sessionData.model_id || 'default',
          permission_mode: sessionData.permission_mode || 'default',
          effort: sessionData.effort || 'medium',
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'native_window_opened',
          nativeCliWindowOpened: true,
        };
        const newSession = this._registerClaudeCliSession(summary, { sendInitialHistory: false });
        if (newSession) {
          try {
            const child = claudeCli.startNativeClaudeWindow({
              workspacePath,
              cliSessionId,
              resume: false,
              model: newSession.model_id,
              effort: newSession.effort,
              permissionMode: newSession.permission_mode,
              title: `${workspaceName} - Claude CLI`,
            });
            newSession.nativeCliStartedAt = summary.nativeCliStartedAt;
            newSession.nativeCliStatus = 'native_window_opened';
            newSession.nativeCliWindowOpened = true;
            sessionStore.updateSession(newSession.session_id, {
              native_cli_started_at: newSession.nativeCliStartedAt,
              native_cli_status: newSession.nativeCliStatus,
              native_cli_window_opened: true,
            });
            this._sendHistorySnapshot(newSession.session_id, this._claudeCliPendingTranscriptMessages(newSession), 'claude cli native startup');
            this._log('info', `[ctrl] opened native Claude CLI window for new_chat ${newSession.session_id} pid=${child?.pid || 'unknown'} model=${newSession.model_id || 'default'}`);
          } catch (e) {
            this._log('warn', `[ctrl] new_chat native Claude CLI window failed for ${newSession.session_id}: ${e.message}`);
            newSession.nativeCliStatus = 'native_window_failed';
            sessionStore.updateSession(newSession.session_id, { native_cli_status: newSession.nativeCliStatus });
            this._sendHistorySnapshot(newSession.session_id, this._claudeCliPendingTranscriptMessages(newSession), 'claude cli native startup failed');
          }
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay(proto.agentControlResult(
          sid,
          requestId,
          'new_chat',
          newSession ? 'ok' : 'failed',
          newSession ? undefined : { code: 'create_failed', message: 'Could not create Claude CLI session' }
        ));
        return;
      }

      // Claude Code extension: send /clear to start a new conversation
      if (agentT === 'claude') {
        this._sendSessionMessage(sessionData, '/clear', sid)
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

      if (agentT === 'continue_yolo') {
        launchers.launchSession({
          agentType: 'continue_yolo',
          port: this.CDP_PORTS[0],
          sessions: this.sessions,
          requestId,
          workspacePath: sessionData.workspace_path || undefined,
          onSuccess: async newTarget => {
            const launchedFilter = new Set([newTarget.id]);
            let newSession = null;
            for (let i = 0; i < 5 && !newSession; i++) {
              await this._discoverTargets(launchedFilter);
              newSession = Array.from(this.sessions.values()).find(s => s.targetId === newTarget.id);
              if (!newSession) await sleep(1000);
            }
            this._sendToRelay(proto.agentControlResult(
              sid,
              requestId,
              'new_chat',
              newSession ? 'ok' : 'failed',
              newSession ? undefined : { code: 'register_failed', message: 'Continue YOLO session opened but was not discovered' }
            ));
          },
          onFailure: (reason, errorCode) => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
              code: errorCode || 'new_chat_failed',
              message: reason || 'Could not open a new Continue YOLO session',
            }));
          },
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
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, wp));
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
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, wp));
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
    if (type === 'automation_view_action') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', {
          code: 'not_supported', message: `automation_view_action not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.clickCodexAutomationAction(sessionData.client.Runtime, true)
        .then(result => {
          if (result?.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', {
              code: 'action_not_found', message: result?.detail || 'Show Automation action not found',
            }));
          }
        })
        .catch(err => {
          this._log('warn', `[ctrl] automation_view_action failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    if (type === 'open_native_window') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;

      if (sessionData?.agentType !== 'claude_cli') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'failed', {
          code: 'not_supported', message: `native window not supported for ${sessionData?.agentType || 'unknown'}`,
        }));
        return;
      }

      try {
        const cliSessionId = sessionData.cliSessionId || crypto.randomUUID();
        sessionData.cliSessionId = cliSessionId;
        sessionData.nativeCliStartedAt = new Date().toISOString();
        sessionData.nativeCliStatus = 'native_window_opened';
        sessionData.nativeCliWindowOpened = true;
        sessionStore.updateSession(sid, {
          cli_session_id: cliSessionId,
          claude_cli_archive_discovered: false,
          native_cli_started_at: sessionData.nativeCliStartedAt,
          native_cli_status: sessionData.nativeCliStatus,
          native_cli_window_opened: true,
        });
        const child = claudeCli.startNativeClaudeWindow({
          workspacePath: sessionData.workspace_path || process.cwd(),
          cliSessionId,
          resume: !!sessionData.claudeCliFilePath,
          model: sessionData.model_id,
          effort: sessionData.effort,
          permissionMode: sessionData.permission_mode,
          title: `${sessionData.workspace_name || 'Claude Code'} - Claude CLI`,
        });
        this._sendHistorySnapshot(sid, this._claudeCliPendingTranscriptMessages(sessionData), 'claude cli native startup');
        this._log('info', `[ctrl] opened native Claude CLI window for ${sid} pid=${child?.pid || 'unknown'} model=${sessionData.model_id || 'default'}`);
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'ok'));
      } catch (e) {
        this._log('warn', `[ctrl] open_native_window failed for ${sid}: ${e.message}`);
        sessionData.nativeCliStatus = 'native_window_failed';
        sessionStore.updateSession(sid, { native_cli_status: sessionData.nativeCliStatus });
        this._sendHistorySnapshot(sid, this._claudeCliPendingTranscriptMessages(sessionData), 'claude cli native startup failed');
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'failed', {
          code: 'spawn_failed', message: e.message,
        }));
      }
      return;
    }

    if (type === 'launch_session') {
      const agentType    = msg.agent_type;
      const requestId    = msg.request_id;
      const workspacePath = msg.workspace_path || null;
      this._log('info', `[ctrl] launch_session agent=${agentType} request=${requestId}`);

      if (agentType === 'claude_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspace = workspacePath || process.cwd();
        const workspaceName = path.basename(workspace) || 'Claude CLI';
        const modelId = msg.model_id || 'default';
        const permissionMode = msg.permission_mode || 'default';
        const effort = msg.effort || 'medium';
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath: workspace,
          workspaceName,
          title: 'New Claude CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: modelId,
          permission_mode: permissionMode,
          effort,
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'native_window_opened',
          nativeCliWindowOpened: true,
        };
        const session = this._registerClaudeCliSession(summary, { sendInitialHistory: false });
        if (!session) {
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            agent_type: agentType,
            reason: 'Could not create Claude CLI session',
            error_code: 'create_failed',
          });
          return;
        }
        try {
          const child = claudeCli.startNativeClaudeWindow({
            workspacePath: workspace,
            cliSessionId,
            resume: false,
            model: modelId,
            effort,
            permissionMode,
            title: `${workspaceName} - Claude CLI`,
          });
          session.nativeCliStartedAt = summary.nativeCliStartedAt;
          session.nativeCliStatus = 'native_window_opened';
          session.nativeCliWindowOpened = true;
          sessionStore.updateSession(session.session_id, {
            native_cli_started_at: session.nativeCliStartedAt,
            native_cli_status: session.nativeCliStatus,
            native_cli_window_opened: true,
          });
          this._sendHistorySnapshot(session.session_id, this._claudeCliPendingTranscriptMessages(session), 'claude cli native startup');
          this._log('info', `[ctrl] opened native Claude CLI window for launch_session ${session.session_id} pid=${child?.pid || 'unknown'} model=${modelId || 'default'}`);
        } catch (e) {
          this._log('warn', `[ctrl] launch_session native Claude CLI window failed for ${session.session_id}: ${e.message}`);
          session.nativeCliStatus = 'native_window_failed';
          sessionStore.updateSession(session.session_id, { native_cli_status: session.nativeCliStatus });
          this._sendHistorySnapshot(session.session_id, this._claudeCliPendingTranscriptMessages(session), 'claude cli native startup failed');
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay({
          type: 'session_launch_ack',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          session_id: session.session_id,
          agent_type: agentType,
        });
        return;
      }

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
        this.activeErrorPrompts.delete(sid);
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

      if (agentT === 'claude_cli') {
        if (sessionData._claudeCliChild) {
          try { sessionData._claudeCliChild.kill(); } catch {}
          sessionData._claudeCliChild = null;
        }
        finishClose();
        return;
      }

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
      const encoded = JSON.stringify(msg);
      const byteLen = Buffer.byteLength(encoded, 'utf8');
      if (byteLen > RELAY_MESSAGE_MAX_BYTES) {
        const kind = msg?.type || 'unknown';
        const sessionId = msg?.session_id || msg?.session || 'unknown';
        this._log('warn', `[relay] Dropping oversized ${kind} for ${sessionId} (${byteLen} bytes)`);
        return;
      }
      this.relayWs.send(encoded);
    }
  }

  _sendHistorySnapshot(sessionId, messages, reason = 'history') {
    const fullMessages = Array.isArray(messages) ? messages : [];
    const buildSnapshot = (msgs) => proto.historySnapshot(sessionId, msgs);
    const fitsRelayCap = (msgs) => {
      const encoded = JSON.stringify(buildSnapshot(msgs));
      return Buffer.byteLength(encoded, 'utf8') <= RELAY_MESSAGE_MAX_BYTES;
    };

    if (fitsRelayCap(fullMessages)) {
      this._sendToRelay(buildSnapshot(fullMessages));
      return;
    }

    if (fullMessages.length === 0) {
      this._sendToRelay(buildSnapshot([]));
      return;
    }

    // Do not send a clipped history snapshot. The relay treats snapshots as
    // authoritative and replaces persisted history; sending only the tail would
    // erase older messages from the WebUI.
    this._log('warn', `[${sessionId}] Not sending oversized history snapshot (${fullMessages.length} msgs, ${reason})`);
    return;

  }

  // ─── Heartbeat ───────────────────────────────────────────────────────

  _messageContentText(msg) {
    const content = msg?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.content || JSON.stringify(part);
      }).join('\n');
    }
    if (content == null) return '';
    return String(content);
  }

  _messagesSoftMatch(a, b) {
    if (!a || !b || a.role !== b.role) return false;
    const left = this._messageContentText(a).replace(/\s+/g, ' ').trim();
    const right = this._messageContentText(b).replace(/\s+/g, ' ').trim();
    if (!left || !right) return left === right;
    if (left === right) return true;
    const probeLen = Math.min(160, left.length, right.length);
    if (probeLen < 40) return false;
    const leftProbe = left.substring(0, probeLen);
    const rightProbe = right.substring(0, probeLen);
    return left.startsWith(rightProbe) || right.startsWith(leftProbe);
  }

  _isCodexCompletionSummaryMessage(msg) {
    if (!msg || msg.role !== 'assistant') return false;
    const text = this._messageContentText(msg).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /^Worked for\s+/i.test(text)
      || /\bTask completed\b/i.test(text)
      || /\bImplemented and (?:committed|pushed)\b/i.test(text)
      || /\bWhat changed:\b/i.test(text)
      || /\bVerified:\b/i.test(text)
      || /\b\d+\s+files?\s+changed\b/i.test(text);
  }

  _findMatchingMessageIndex(messages, needle, startAt = 0) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = Math.max(0, startAt); i < list.length; i++) {
      if (this._messagesSoftMatch(list[i], needle)) return i;
    }
    return -1;
  }

  _mergeCodexCompletionCollapse(accumulated, domMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    if (acc.length === 0 || dom.length < 2) return { matched: false, changed: false, messages: acc };

    const domUserIdx = dom.findIndex(m => m && m.role === 'user');
    if (domUserIdx < 0) return { matched: false, changed: false, messages: acc };

    const completionIdx = dom.reduce((last, msg, idx) => (
      this._isCodexCompletionSummaryMessage(msg) ? idx : last
    ), -1);
    if (completionIdx <= domUserIdx) return { matched: false, changed: false, messages: acc };

    const accUserIdx = this._findMatchingMessageIndex(acc, dom[domUserIdx]);
    if (accUserIdx < 0) return { matched: false, changed: false, messages: acc };

    const priorWork = acc.slice(accUserIdx + 1).some(msg =>
      msg &&
      msg.role === 'assistant' &&
      !this._isCodexCompletionSummaryMessage(msg) &&
      this._messageContentText(msg).trim().length > 120
    );
    if (!priorWork) return { matched: false, changed: false, messages: acc };

    let changed = false;
    const merged = acc.slice();
    for (let i = domUserIdx + 1; i < dom.length; i++) {
      const msg = dom[i];
      if (!msg || msg.role !== 'assistant') continue;
      if (!this._isCodexCompletionSummaryMessage(msg)) continue;

      const existingIdx = this._findMatchingMessageIndex(merged, msg, accUserIdx + 1);
      if (existingIdx >= 0) {
        if (this._messageContentText(msg).length > this._messageContentText(merged[existingIdx]).length) {
          merged[existingIdx] = msg;
          changed = true;
        }
        continue;
      }

      merged.push(msg);
      changed = true;
    }

    return { matched: true, changed, messages: merged };
  }

  _extractToolBlocks(content) {
    const text = this._messageContentText({ content });
    const blocks = [];
    const re = /\[([^\]\n]+)\]\n([\s\S]*?)\n?\[end\]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      blocks.push({
        raw: match[0],
        name: String(match[1] || '').trim(),
        body: String(match[2] || '').trim(),
      });
    }
    return blocks;
  }

  _codexToolKey(block) {
    if (!block || !block.name) return '';
    const name = block.name.replace(/\s+/g, ' ').trim();
    const bash = name.match(/^Bash\s+(.+)$/i);
    if (bash) {
      return `bash:${bash[1]
        .replace(/\s+for\s+\d+(?:ms|s|m)\s*$/i, '')
        .replace(/^Ran\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()}`;
    }
    const edit = name.match(/^(Edit|Write|Read|Created|Deleted)\s+(.+)$/i);
    if (edit) {
      return `file:${edit[2].replace(/\s+/g, ' ').trim().toLowerCase()}`;
    }
    return '';
  }

  _isRicherCodexToolBody(previous, next) {
    const prevBody = String(previous?.body || '').trim();
    const nextBody = String(next?.body || '').trim();
    if (!prevBody) return false;
    if (!nextBody) return true;
    const prevDiff = /(^|\n)(\+|-|@@)/.test(prevBody);
    const nextDiff = /(^|\n)(\+|-|@@)/.test(nextBody);
    if (prevDiff && !nextDiff) return true;
    return prevBody.length > nextBody.length + 80;
  }

  _mergeCodexExpandedToolContent(previousMsg, nextMsg) {
    if (!previousMsg || !nextMsg || previousMsg.role !== 'assistant' || nextMsg.role !== 'assistant') return nextMsg;
    const previousContent = this._messageContentText(previousMsg);
    const nextContent = this._messageContentText(nextMsg);
    if (!previousContent || !nextContent || previousContent === nextContent) return nextMsg;

    const previousBlocks = this._extractToolBlocks(previousContent);
    const nextBlocks = this._extractToolBlocks(nextContent);
    if (previousBlocks.length === 0 || nextBlocks.length === 0) return nextMsg;

    const previousByKey = new Map();
    for (const block of previousBlocks) {
      const key = this._codexToolKey(block);
      if (!key) continue;
      const existing = previousByKey.get(key);
      if (!existing || this._isRicherCodexToolBody(block, existing)) previousByKey.set(key, block);
    }

    let merged = nextContent;
    let changed = false;
    for (const block of nextBlocks) {
      const key = this._codexToolKey(block);
      const previous = key ? previousByKey.get(key) : null;
      if (!previous || !this._isRicherCodexToolBody(previous, block)) continue;
      merged = merged.replace(block.raw, previous.raw);
      changed = true;
    }

    if (!changed) return nextMsg;
    return { ...nextMsg, content: merged };
  }

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
      panel_title:      s.panel_title || null,
      panel_mode:       s.panel_mode || null,
      panel_model:      s.panel_model || null,
      panel_agent:      s.panel_agent || null,
      visible_pane_title:    s.visible_pane_title || null,
      visible_pane_agent:    s.visible_pane_agent || null,
      visible_pane_location: s.visible_pane_location || null,
      visible_pane_visible:  s.visible_pane_visible || false,
      machine_label:    s.machine_label,
      target_signature: s.target_signature,
      chat_title:       s.chat_title || null,
      status:           s.status,
      activity:         s.activity,
      last_seen_at:     s.last_seen_at,
      rate_limited_until: s.rate_limited_until || null,
      rate_limit_active:  s.rateLimitActive    || false,
      percent_used:       s.percentUsed        ?? null,
      auto_approve_permissions: !!s.autoApprovePermissions,
      active_quota_model: s.activeQuotaModel   || null,
      available_ai_credits: s.availableAiCredits ?? null,
      antigravity_quota_models: Array.isArray(s.antigravityQuotaModels) ? s.antigravityQuotaModels : null,
      is_list_view:       s._panelEmpty        || s._listView || false,
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

  // ─── Ephemeral CDP polling (Continue) ─────────────────────────────────
  //
  // Continue iframe targets in Electron/Antigravity steal focus and reset
  // scroll position when Runtime.evaluate is called on a persistent CDP
  // connection (the execution context stays "active").
  //
  // Fix: for Continue sessions, open a fresh CDP connection per poll,
  // perform all reads, then immediately disconnect.  This prevents the
  // webview from staying activated between polls.

  _isEphemeralIframeAgent(agentType) {
    // Claude used to use ephemeral CDP to avoid focus-stealing, but creating a
    // fresh CDP WebSocket connection every poll tick itself steals focus in
    // Electron (debugger attach activates the target).  With the persistent-
    // connection path now:
    //   - using cached inner contextId (no active-frame.contentDocument access)
    //   - passive executionContextCreated watcher (auto-recovers on reload)
    //   - silent:true + userGesture:false on all evaluate calls
    //   - no synthetic click dispatches in _expandOutputDetails
    // persistent CDP should no longer cause focus steal for Claude sessions.
    // Continue, Continue YOLO, and Roo Code remain ephemeral because they show
    // distinct focus-stealing symptoms there.
    return agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'roo_code' || agentType === 'cline';
  }

  async _ephemeralCdpPoll(session, sessionId, options = {}) {
    const { includeConfig = false, includeRateLimit = false, forceRefreshContext = false } = options;
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    let client;
    try {
      this._log('info', `[${sessionId}] [${focusTag}] poll attach:start target=${session.targetId}`);
      client = await CDP({ port: session._cdpPort || this.CDP_PORTS[0], target: session.targetId });
      client.Runtime._webviewId = session._webviewId || null;
      await this._primeEphemeralIframeRuntime(session, client.Runtime, forceRefreshContext);

      let raw      = await selectors.readMessages(client.Runtime, session.agentType, sessionId);
      let thinking = await selectors.detectThinking(client.Runtime, session.agentType);
      const perm   = await selectors.detectPermissionDialog(client.Runtime, session.agentType);
      const errorPrompt = await selectors.detectSessionErrorPrompt(client.Runtime, session.agentType).catch(() => null);
      const config = includeConfig
        ? await selectors.readAgentConfig(client.Runtime, session.agentType, session.workspace_path).catch(() => null)
        : null;
      const taskList = (session.agentType === 'roo_code' || session.agentType === 'cline')
        ? await selectors.readRooCodeTaskList(client.Runtime).catch(() => null)
        : null;
      const contextUsage = session.agentType === 'cline'
        ? await selectors.readClineContextUsage(client.Runtime).catch(() => null)
        : session.agentType === 'roo_code'
          ? await selectors.readRooCodePromptView(client.Runtime).catch(() => null)
          : null;
      const rateLimit = includeRateLimit
        ? await selectors.readClaudeRateLimit(client.Runtime).catch(() => null)
        : null;

      if (raw === JSON.stringify([]) && (session.lastObservedCount || 0) > 0) {
        await this._primeEphemeralIframeRuntime(session, client.Runtime, true);
        raw = await selectors.readMessages(client.Runtime, session.agentType, sessionId);
        thinking = await selectors.detectThinking(client.Runtime, session.agentType);
      }

      return { raw, thinking, perm, errorPrompt, config, taskList, contextUsage, rateLimit };
    } finally {
      this._log('info', `[${sessionId}] [${focusTag}] poll attach:end`);
      await this._safeClose(client);
    }
  }

  async _withEphemeralIframeClient(session, work, reason = 'unknown') {
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    let client;
    try {
      this._log('info', `[${session.session_id}] [${focusTag}] client attach:start reason=${reason} target=${session.targetId}`);
      client = await CDP({ port: session._cdpPort || this.CDP_PORTS[0], target: session.targetId });
      client.Runtime._webviewId = session._webviewId || null;
      await this._primeEphemeralIframeRuntime(session, client.Runtime);
      return await work(client);
    } finally {
      this._log('info', `[${session.session_id}] [${focusTag}] client attach:end reason=${reason}`);
      await this._safeClose(client);
    }
  }

  async _primeEphemeralIframeRuntime(session, Runtime, forceRefresh = false) {
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    const cachedContextId = session._iframeInnerContextId || session._continueInnerContextId || null;
    if (!forceRefresh && cachedContextId) {
      Runtime._innerContextId = cachedContextId;
      return cachedContextId;
    }
    this._log('info', `[${session.session_id}] [${focusTag}] context cache:start force=${forceRefresh}`);
    const contextId = await selectors.cacheInnerContextId(Runtime);
    if (contextId) {
      session._iframeInnerContextId = contextId;
      session._continueInnerContextId = contextId;
      Runtime._innerContextId = contextId;
    } else if (cachedContextId) {
      Runtime._innerContextId = cachedContextId;
    }
    this._log('info', `[${session.session_id}] [${focusTag}] context cache:end resolved=${Runtime._innerContextId || 'null'}`);
    return Runtime._innerContextId || null;
  }

  async _withWorkbenchClient(session, work) {
    const cdpPort = session._cdpPort || this.CDP_PORTS[0];
    const targets = await CDP.List({ port: cdpPort });
    const workbenchPages = targets.filter(t =>
      t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    if (workbenchPages.length === 0) {
      throw new Error('No workbench page found');
    }

    let workbenchTarget = workbenchPages[0];
    if (session.parentId) {
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
          if (res.result?.value === session.parentId) {
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
      return await work(client);
    } finally {
      await this._safeClose(client);
    }
  }

  async _withAntigravitySettingsClient(work) {
    const cdpPort = this.CDP_PORTS[0];
    const targets = await this._withTimeout(
      CDP.List({ port: cdpPort }), 3000, 'CDP.List for settings page'
    );
    const settingsPages = targets.filter(t =>
      t.type === 'page' &&
      t.title === 'Settings' &&
      t.url &&
      t.url.includes('workbench-jetski-agent')
    );
    if (settingsPages.length === 0) {
      throw new Error('No Antigravity Settings page found');
    }

    let client;
    try {
      client = await this._withTimeout(
        CDP({ port: cdpPort, target: settingsPages[0].id }),
        4000, 'CDP attach settings page'
      );
      await this._withTimeout(client.Runtime.enable(), 3000, 'Runtime.enable settings');
      // Bound the work callback itself — it issues Runtime.evaluate against
      // the settings page renderer, which can hang indefinitely if that
      // renderer is wedged. An unbounded await here was previously enough
      // to freeze the entire proxy poll loop for many minutes.
      return await this._withTimeout(work(client), 8000, 'antigravity settings work');
    } finally {
      if (client) {
        try { await this._withTimeout(client.close(), 2000, 'close settings client'); } catch {}
      }
    }
  }

  _normalizeAntigravityModelName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  _findAntigravityQuotaEntry(session, snapshot) {
    const models = Array.isArray(snapshot?.models) ? snapshot.models : [];
    if (models.length === 0) return null;
    const currentModel = session._currentModelId || session.panel_model || null;
    if (!currentModel) return null;

    const target = this._normalizeAntigravityModelName(currentModel);
    if (!target) return null;

    let best = null;
    let bestScore = -1;
    for (const entry of models) {
      const candidate = this._normalizeAntigravityModelName(entry?.model);
      if (!candidate) continue;
      let score = -1;
      if (candidate === target) score = 1000;
      else if (candidate.includes(target) || target.includes(candidate)) score = Math.min(candidate.length, target.length);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  _applyAntigravityQuotaSnapshot(snapshot) {
    let changed = false;
    for (const session of this.sessions.values()) {
      if (session.agentType !== 'antigravity' && session.agentType !== 'antigravity_panel') continue;
      const entry = this._findAntigravityQuotaEntry(session, snapshot);
      const nextPct = entry?.percent_used ?? null;
      const nextReset = entry?.refreshes_in || null;
      const nextCredits = snapshot?.available_ai_credits ?? null;
      const nextActiveModel = entry?.model || null;
      const nextQuotaModels = Array.isArray(snapshot?.models)
        ? snapshot.models.map(model => ({
            model: model?.model || null,
            refreshes_in: model?.refreshes_in || null,
            percent_used: model?.percent_used ?? null,
            color: model?.color || null,
          }))
        : null;
      if ((session.percentUsed ?? null) !== nextPct) {
        session.percentUsed = nextPct;
        changed = true;
      }
      if ((session.activeQuotaModel || null) !== nextActiveModel) {
        session.activeQuotaModel = nextActiveModel;
        changed = true;
      }
      if ((session.rate_limited_until || null) !== nextReset) {
        session.rate_limited_until = nextReset;
        changed = true;
      }
      if ((session.availableAiCredits ?? null) !== nextCredits) {
        session.availableAiCredits = nextCredits;
        changed = true;
      }
      if (JSON.stringify(session.antigravityQuotaModels || null) !== JSON.stringify(nextQuotaModels)) {
        session.antigravityQuotaModels = nextQuotaModels;
        changed = true;
      }
    }
    if (changed) this._broadcastSessionSnapshot();
    return changed;
  }

  async _refreshAntigravityQuotaUsage(force = false) {
    const hasAntigravitySessions = Array.from(this.sessions.values()).some(s =>
      s.agentType === 'antigravity' || s.agentType === 'antigravity_panel'
    );
    if (!hasAntigravitySessions) return false;

    const now = Date.now();
    if (!force && this._antigravityQuotaCache.data && (now - this._antigravityQuotaCache.fetchedAt) < 30000) {
      return this._applyAntigravityQuotaSnapshot(this._antigravityQuotaCache.data);
    }

    try {
      const snapshot = await this._withTimeout(
        this._withAntigravitySettingsClient(async client => {
          const refreshResult = await this._withTimeout(
            selectors.refreshAntigravityModelQuota(client.Runtime), 4000, 'refresh quota'
          );
          if (refreshResult?.ok) {
            await sleep(750);
          }
          return this._withTimeout(
            selectors.readAntigravityModelQuota(client.Runtime), 4000, 'read quota'
          );
        }),
        // Outer cap so a hung settings renderer can't wedge the main poll
        // loop. Inner timeouts protect each step; this is the belt.
        15000, 'antigravity quota refresh'
      );
      if (!snapshot || !Array.isArray(snapshot.models) || snapshot.models.length === 0) {
        return false;
      }
      this._antigravityQuotaCache = { fetchedAt: now, data: snapshot };
      return this._applyAntigravityQuotaSnapshot(snapshot);
    } catch {
      return false;
    }
  }

  _claudeCliPendingTranscriptMessages(session) {
    const workspaceName = session.workspace_name || session.workspaceName || 'the selected workspace';
    const model = session.model_id && session.model_id !== 'default' ? session.model_id : 'Default';
    const permissionMode = session.permission_mode || 'default';
    const effort = session.effort || 'medium';
    const failedNativeWindow = session.nativeCliStatus === 'native_window_failed';
    const hasNativeWindow = session.nativeCliWindowOpened === true || session.nativeCliStatus === 'native_window_opened';
    const nativeText = failedNativeWindow
      ? 'The proxy tried to open a native Claude Code CLI window, but the native launch reported a failure.'
      : hasNativeWindow
      ? 'A native Claude Code CLI window was opened for this session.'
      : 'This Claude Code CLI session does not have a transcript file yet.';
    return [{
      role: 'assistant',
      content: [
        '**Claude Code CLI is waiting for a native transcript.**',
        '',
        nativeText,
        `Workspace: ${workspaceName}`,
        `Model: ${model}`,
        `Permission mode: ${permissionMode}`,
        `Effort: ${effort}`,
        '',
        'If the native cmd window is showing the Claude workspace trust prompt, choose `1. Yes, I trust this folder` and press Enter there. Claude does not write JSONL transcript messages until that startup prompt is completed.',
        '',
        'Once Claude creates or updates the transcript file, this placeholder will be replaced with the real CLI chat history.',
      ].join('\n'),
      ts: session.nativeCliStartedAt ? Math.floor(new Date(session.nativeCliStartedAt).getTime() / 1000) : undefined,
    }];
  }

  async _readSessionMessages(session, sessionId) {
    if (session.agentType === 'claude_cli') {
      const messages = session.claudeCliFilePath ? claudeCli.parseClaudeJsonl(session.claudeCliFilePath) : [];
      return JSON.stringify(messages.length > 0 ? messages : this._claudeCliPendingTranscriptMessages(session));
    }
    if (this._isEphemeralIframeAgent(session.agentType)) {
      return this._withEphemeralIframeClient(session, client =>
        selectors.readMessages(client.Runtime, session.agentType, sessionId)
      , 'read_messages');
    }
    return selectors.readMessages(session.client.Runtime, session.agentType, sessionId);
  }

  async _readSessionConfig(session, workspacePath, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    if (session.agentType === 'claude_cli') {
      return {
        model_id: session.model_id || 'default',
        permission_mode: session.permission_mode || 'default',
        effort: session.effort || 'medium',
        file_access_scope: workspacePath || session.workspace_path || 'unknown',
      };
    }
    if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
      if (!forceRefresh && session._continueConfigCache) {
        return session._continueConfigCache;
      }
      if (session.agentType === 'continue_yolo') {
        const directCfg = await this._withEphemeralIframeClient(session, client =>
          selectors.readAgentConfig(client.Runtime, session.agentType, workspacePath)
        , forceRefresh ? 'read_config_force' : 'read_config').catch(() => null);

        let workbenchCfg = null;
        if (session._webviewId) {
          workbenchCfg = await this._withWorkbenchClient(session, client =>
            selectors.readContinueConfigFromWorkbench(client.Runtime, session._webviewId, workspacePath)
          ).catch(() => null);
        }

        const merged = this._mergeContinueConfigs(directCfg, workbenchCfg);
        if (merged) {
          return this._stabilizeContinueConfig(session, merged) || null;
        }
        return null;
      }
      return this._withEphemeralIframeClient(session, client =>
        selectors.readAgentConfig(client.Runtime, session.agentType, workspacePath)
      , forceRefresh ? 'read_config_force' : 'read_config').then(cfg => {
        if (cfg) {
          cfg = this._stabilizeContinueConfig(session, cfg);
        }
        return cfg || null;
      });
    }
    return selectors.readAgentConfig(session.client.Runtime, session.agentType, workspacePath);
  }

  async _refreshWorkbenchPaneMeta(session) {
    if (!session || !session.parentId) return false;
    try {
      const summary = await this._withWorkbenchClient(session, client =>
        selectors.readWorkbenchPaneSummary(client.Runtime)
      );
      const nextTitle = summary?.auxiliary_title || null;
      const nextAgent = summary?.auxiliary_agent || null;
      const nextVisible = summary?.auxiliary_visible === true;
      const nextLocation = nextVisible ? 'right' : null;
      let changed = false;
      if ((session.visible_pane_title || null) !== nextTitle) {
        session.visible_pane_title = nextTitle;
        changed = true;
      }
      if ((session.visible_pane_agent || null) !== nextAgent) {
        session.visible_pane_agent = nextAgent;
        changed = true;
      }
      if ((session.visible_pane_location || null) !== nextLocation) {
        session.visible_pane_location = nextLocation;
        changed = true;
      }
      if ((session.visible_pane_visible || false) !== nextVisible) {
        session.visible_pane_visible = nextVisible;
        changed = true;
      }
      return changed;
    } catch (e) {
      this._log('warn', `[${session.session_id}] workbench pane meta error: ${e.message}`);
      return false;
    }
  }

  async _sendSessionMessage(session, content, sessionId) {
    if (session.agentType === 'claude_cli') {
      return this._sendClaudeCliMessage(session, content, sessionId);
    }
    if (this._isEphemeralIframeAgent(session.agentType)) {
      return this._withEphemeralIframeClient(session, client =>
        selectors.sendMessage(client.Runtime, session.agentType, content, sessionId)
      , 'send_message');
    }
    return selectors.sendMessage(session.client.Runtime, session.agentType, content, sessionId);
  }

  _buildClaudeCliSessionFromSummary(sessionMeta, summary) {
    const now = new Date().toISOString();
    return {
      session_id:       sessionMeta.session_id,
      display_name:     sessionMeta.display_name || 'Claude Code CLI',
      workspace_name:   summary.workspaceName || sessionMeta.workspace_name,
      workspace_path:   summary.workspacePath || sessionMeta.workspace_path,
      machine_label:    sessionMeta.machine_label,
      target_signature: sessionMeta.target_signature,
      chat_title:       summary.title || null,
      client:           null,
      lastMessageCount: summary.messageCount || 0,
      lastObservedCount: summary.messageCount || 0,
      lastTranscriptSig: this._transcriptSignature(summary.messages || []),
      nullPollCount:    0,
      pendingLast:      null,
      resyncCandidateSig: null,
      waitingForAssistant: false,
      thinking:         false,
      thinkingLabel:    '',
      autoApprovePermissions: false,
      status:           'healthy',
      activity:         sessionMeta.activity || { kind: 'idle', label: '', updated_at: now },
      last_seen_at:     summary.updatedAt || now,
      windowTitle:      sessionMeta.window_title || summary.workspaceName || 'Claude Code CLI',
      agentType:        'claude_cli',
      parentId:         null,
      ext:              null,
      targetId:         null,
      cliSessionId:     summary.cliSessionId,
      claudeCliFilePath: summary.filePath,
      claudeCliArchiveDiscovered: sessionMeta.claude_cli_archive_discovered === true,
      nativeCliStartedAt: sessionMeta.native_cli_started_at || summary.nativeCliStartedAt || null,
      nativeCliStatus:    sessionMeta.native_cli_status || summary.nativeCliStatus || null,
      nativeCliWindowOpened: sessionMeta.native_cli_window_opened === true || summary.nativeCliWindowOpened === true,
      model_id:         sessionMeta.model_id || 'default',
      effort:           sessionMeta.effort || 'medium',
      permission_mode:  sessionMeta.permission_mode || 'default',
    };
  }

  _registerClaudeCliSession(summary, { sendInitialHistory = true, archiveDiscovered = false } = {}) {
    if (!summary?.cliSessionId) return null;
    const displayName = 'Claude Code CLI';
    const sessionMeta = sessionStore.resolveVirtualSession({
      virtualId: `claude-cli:${summary.cliSessionId}`,
      agentType: 'claude_cli',
      displayName,
      workspaceName: summary.workspaceName,
      workspacePath: summary.workspacePath,
      windowTitle: summary.workspaceName || displayName,
      extra: {
        cli_session_id: summary.cliSessionId,
        claude_cli_file_path: summary.filePath,
        claude_cli_archive_discovered: archiveDiscovered === true,
        chat_title: summary.title || null,
        model_id: summary.model_id || undefined,
        permission_mode: summary.permission_mode || undefined,
        effort: summary.effort || undefined,
        native_cli_started_at: summary.nativeCliStartedAt || undefined,
        native_cli_status: summary.nativeCliStatus || undefined,
        native_cli_window_opened: summary.nativeCliWindowOpened === true || undefined,
      },
    });
    const sessionId = sessionMeta.session_id;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.workspace_name = summary.workspaceName || existing.workspace_name;
      existing.workspace_path = summary.workspacePath || existing.workspace_path;
      existing.chat_title = summary.title || existing.chat_title;
      existing.last_seen_at = summary.updatedAt || existing.last_seen_at;
      existing.claudeCliFilePath = summary.filePath || existing.claudeCliFilePath;
      existing.claudeCliArchiveDiscovered = archiveDiscovered === true;
      existing.cliSessionId = summary.cliSessionId;
      if (summary.model_id) existing.model_id = summary.model_id;
      if (summary.permission_mode) existing.permission_mode = summary.permission_mode;
      if (summary.effort) existing.effort = summary.effort;
      if (summary.nativeCliStartedAt) existing.nativeCliStartedAt = summary.nativeCliStartedAt;
      if (summary.nativeCliStatus) existing.nativeCliStatus = summary.nativeCliStatus;
      if (summary.nativeCliWindowOpened === true) existing.nativeCliWindowOpened = true;
      const summaryMessages = summary.messages || [];
      const effectiveMessages = summaryMessages.length > 0 ? summaryMessages : this._claudeCliPendingTranscriptMessages(existing);
      const sig = this._transcriptSignature(effectiveMessages);
      if (sig !== existing.lastTranscriptSig) {
        existing.lastTranscriptSig = sig;
        existing.lastObservedCount = effectiveMessages.length;
        existing.lastMessageCount = effectiveMessages.length;
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'claude cli file changed');
      }
      return existing;
    }

    const session = this._buildClaudeCliSessionFromSummary(sessionMeta, summary);
    this.sessions.set(sessionId, session);
    this._log('info', `[claude-cli] registered ${sessionId} cli=${summary.cliSessionId} (${summary.messageCount} msgs)`);
    if (sendInitialHistory) {
      const initialMessages = summary.messages?.length ? summary.messages : this._claudeCliPendingTranscriptMessages(session);
      this._sendHistorySnapshot(sessionId, initialMessages, 'claude cli discovery');
      session.lastTranscriptSig = this._transcriptSignature(initialMessages);
      session.lastObservedCount = initialMessages.length;
      session.lastMessageCount = initialMessages.length;
    }
    const cfg = this._decorateAgentConfig(session, this._mergeAgentConfig('claude_cli', null, session.workspace_path));
    this._sendToRelay(proto.agentConfig(sessionId, { ...cfg, capabilities: this._buildCapabilities('claude_cli') }));
    return session;
  }

  async _discoverClaudeCliSessions() {
    if (process.env.CLAUDE_CLI_DISCOVER_ARCHIVES !== 'true') {
      if (!this._claudeCliArchiveDiscoveryLogged) {
        this._claudeCliArchiveDiscoveryLogged = true;
        this._log('info', '[claude-cli] archive transcript discovery disabled (set CLAUDE_CLI_DISCOVER_ARCHIVES=true to enable)');
      }
      let changed = false;
      const storedSessions = sessionStore.getAllSessions();
      for (const sess of storedSessions) {
        if (sess.agent_type !== 'claude_cli') continue;
        if (sess.claude_cli_archive_discovered !== true) continue;
        if (sess.status !== 'healthy') continue;
        sessionStore.markDisconnected(sess.session_id);
        changed = true;
      }
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType !== 'claude_cli') continue;
        if (session.claudeCliArchiveDiscovered !== true) continue;
        this.sessions.delete(sessionId);
        changed = true;
      }
      for (const sess of storedSessions) {
        if (sess.agent_type !== 'claude_cli') continue;
        if (sess.status !== 'healthy') continue;
        if (sess.claude_cli_archive_discovered === true) continue;
        if (!sess.cli_session_id) continue;
        if (this.sessions.has(sess.session_id)) continue;

        let messages = [];
        let updatedAt = sess.last_seen_at || new Date().toISOString();
        const filePath = sess.claude_cli_file_path || null;
        if (filePath && fs.existsSync(filePath)) {
          try {
            messages = claudeCli.parseClaudeJsonl(filePath);
            updatedAt = fs.statSync(filePath).mtime.toISOString();
          } catch (e) {
            this._log('warn', `[claude-cli] failed to restore transcript ${filePath}: ${e.message}`);
          }
        }

        const before = this.sessions.size;
        this._registerClaudeCliSession({
          cliSessionId: sess.cli_session_id,
          filePath,
          workspacePath: sess.workspace_path || process.cwd(),
          workspaceName: sess.workspace_name || 'Claude CLI',
          title: sess.chat_title || 'Claude CLI session',
          messages,
          messageCount: messages.length,
          updatedAt,
          model_id: sess.model_id,
          permission_mode: sess.permission_mode,
          effort: sess.effort,
        }, { archiveDiscovered: false });
        if (this.sessions.size !== before) changed = true;
      }
      if (changed) this._broadcastSessionSnapshot();
      return;
    }
    const limit = parseInt(process.env.CLAUDE_CLI_SESSION_LIMIT || '40', 10);
    const summaries = claudeCli.discoverSessions(Number.isFinite(limit) ? limit : 40);
    let changed = false;
    for (const summary of summaries) {
      const before = this.sessions.size;
      this._registerClaudeCliSession(summary, { archiveDiscovered: true });
      if (this.sessions.size !== before) changed = true;
    }
    if (changed) this._broadcastSessionSnapshot();
  }

  _findClaudeCliSummaryByCliId(cliSessionId) {
    if (!cliSessionId) return null;
    if (typeof claudeCli.findSessionByCliId === 'function') {
      return claudeCli.findSessionByCliId(cliSessionId);
    }
    const summaries = claudeCli.discoverSessions(parseInt(process.env.CLAUDE_CLI_SESSION_LIMIT || '80', 10));
    return summaries.find(s => s.cliSessionId === cliSessionId) || null;
  }

  _sendClaudeCliMessage(session, content, sessionId) {
    if (session._claudeCliChild) {
      return Promise.resolve({ ok: false, code: 'agent_busy', detail: 'Claude CLI process is already running' });
    }
    const cliSessionId = session.cliSessionId || crypto.randomUUID();
    session.cliSessionId = cliSessionId;
    sessionStore.updateSession(sessionId, { cli_session_id: cliSessionId });
    const workspacePath = session.workspace_path || process.cwd();
    const stderrChunks = [];

    const child = claudeCli.startClaudePrintSession({
      workspacePath,
      cliSessionId,
      resume: !!session.claudeCliFilePath,
      content,
      model: session.model_id,
      effort: session.effort,
      permissionMode: session.permission_mode,
      onStdout: () => {},
      onStderr: chunk => {
        if (chunk) stderrChunks.push(chunk);
      },
      onExit: (code, err) => {
        if (session._claudeCliChild === child) session._claudeCliChild = null;
        (async () => {
          let summary = this._findClaudeCliSummaryByCliId(cliSessionId);
          for (let attempt = 0; code === 0 && !summary && attempt < 8; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 250));
            summary = this._findClaudeCliSummaryByCliId(cliSessionId);
          }
          if (summary) {
            session.claudeCliFilePath = summary.filePath;
            session.workspace_path = summary.workspacePath || session.workspace_path;
            session.workspace_name = summary.workspaceName || session.workspace_name;
            session.chat_title = summary.title || session.chat_title;
            session.claudeCliArchiveDiscovered = false;
            this._registerClaudeCliSession(summary, { sendInitialHistory: false });
            const effectiveMessages = summary.messages?.length ? summary.messages : this._claudeCliPendingTranscriptMessages(session);
            this._sendHistorySnapshot(sessionId, effectiveMessages, 'claude cli send complete');
            session.lastMessageCount = effectiveMessages.length;
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = this._transcriptSignature(effectiveMessages);
          }
          if (!summary && (code !== 0 || err)) {
            const stderr = stderrChunks.join('').trim();
            const detail = stderr || err?.message || `Claude CLI exited with code ${code}`;
            this._sendToRelay(proto.proxyMessage(
              sessionId,
              'assistant',
              `Claude CLI failed to start or complete the request.\n\n${detail}`
            ));
          } else if (!summary) {
            this._sendToRelay(proto.proxyMessage(
              sessionId,
              'assistant',
              'Claude CLI exited without producing a transcript file for this session.'
            ));
          }
          const activity = {
            kind: 'idle',
            label: code === 0 && summary ? '' : 'Claude CLI failed',
            updated_at: new Date().toISOString(),
          };
          session.activity = activity;
          session.waitingForAssistant = false;
          sessionStore.updateSession(sessionId, {
            activity,
            workspace_path: session.workspace_path || null,
            workspace_name: session.workspace_name || null,
            cli_session_id: cliSessionId,
            claude_cli_file_path: session.claudeCliFilePath || null,
            claude_cli_archive_discovered: false,
          });
          this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
          if (code !== 0 || err) {
            this._log('warn', `[claude-cli] send exited code=${code} err=${err?.message || ''} stderr=${stderrChunks.join('').slice(0, 500)}`);
          }
          this._broadcastSessionSnapshot();
        })().catch(exitErr => {
          this._log('warn', `[claude-cli] send exit handler failed: ${exitErr.message}`);
        });
      },
    });
    session._claudeCliChild = child;
    return Promise.resolve({ ok: true });
  }

  async _pollSessionClaudeCli(sessionId, session) {
    const now = Date.now();
    const shouldLookupTranscript = !session._lastClaudeCliTranscriptLookupAt
      || now - session._lastClaudeCliTranscriptLookupAt >= 10000;
    if (!session.claudeCliFilePath && session.cliSessionId && shouldLookupTranscript) {
      session._lastClaudeCliTranscriptLookupAt = now;
      const summary = this._findClaudeCliSummaryByCliId(session.cliSessionId);
      if (summary?.filePath) {
        session.claudeCliFilePath = summary.filePath;
        session.workspace_path = summary.workspacePath || session.workspace_path;
        session.workspace_name = summary.workspaceName || session.workspace_name;
        session.chat_title = summary.title || session.chat_title;
        session.claudeCliArchiveDiscovered = false;
        sessionStore.updateSession(sessionId, {
          workspace_path: session.workspace_path || null,
          workspace_name: session.workspace_name || null,
          claude_cli_file_path: session.claudeCliFilePath,
          claude_cli_archive_discovered: false,
          chat_title: session.chat_title || null,
        });
      }
    }
    const messages = session.claudeCliFilePath ? claudeCli.parseClaudeJsonl(session.claudeCliFilePath) : [];
    const effectiveMessages = messages.length > 0 ? messages : this._claudeCliPendingTranscriptMessages(session);
    const sig = this._transcriptSignature(effectiveMessages);
    if (sig !== session.lastTranscriptSig) {
      session.lastTranscriptSig = sig;
      session.lastObservedCount = effectiveMessages.length;
      session.lastMessageCount = effectiveMessages.length;
      this._sendHistorySnapshot(
        sessionId,
        effectiveMessages,
        messages.length > 0 ? 'claude cli poll' : 'claude cli pending transcript'
      );
    }
    const kind = session._claudeCliChild ? 'generating' : 'idle';
    const label = session._claudeCliChild ? 'Claude CLI running' : '';
    if (session.activity?.kind !== kind || session.activity?.label !== label) {
      const activity = { kind, label, updated_at: new Date().toISOString() };
      session.activity = activity;
      sessionStore.updateSession(sessionId, { activity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
    }
  }

  // ─── Continue-specific poll (ephemeral CDP) ─────────────────────────

  async _pollSessionContinue(sessionId, session) {
    const configNow = Date.now();
    const includeConfig = this._shouldBackgroundPollContinueConfig(session)
      && (!session._lastConfigPollAt || configNow - session._lastConfigPollAt > 15000);
    if (includeConfig) session._lastConfigPollAt = configNow;
    let pollResult;
    try {
      pollResult = await this._ephemeralCdpPoll(session, sessionId, { includeConfig });
    } catch (e) {
      this._log('error', `[${sessionId}] Continue ephemeral poll error: ${e.message}`);
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 consecutive Continue poll failures — removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    let { raw, thinking: ts, perm, errorPrompt, config, taskList, contextUsage } = pollResult;
    if (includeConfig && session.agentType === 'continue_yolo' && session._webviewId) {
      try {
        const wbConfig = await this._withWorkbenchClient(session, client =>
          selectors.readContinueConfigFromWorkbench(client.Runtime, session._webviewId, session.workspace_path)
        );
        if (wbConfig) config = this._mergeContinueConfigs(config, wbConfig);
      } catch {}
    }
    const thinkingState = ts && typeof ts === 'object'
      ? ts
      : { thinking: false, label: '', thinkingContent: '' };

    // ── Null-read handling ──
    if (!raw) {
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount === 5 && session.status === 'healthy') {
        const failures = selectors.getSelectorFailures(sessionId);
        this._log('warn', `[${sessionId}] 5 null reads — marking degraded`);
        session.status = 'degraded';
        sessionStore.updateSession(sessionId, { status: 'degraded' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
      }
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 null — removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
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

    // ── Config refresh ──
    if (config) {
      try {
        const stabilized = this._stabilizeContinueConfig(session, config);
        const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, stabilized, session.workspace_path));
        session._currentModelId = merged.model_id || null;
        const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
        if (cfgSig !== session._lastConfigSig) {
          session._lastConfigSig = cfgSig;
          const capabilities = this._buildCapabilities(session.agentType);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
        }
      } catch {}
    }

    if (taskList !== undefined) {
      const sig = taskList ? JSON.stringify(taskList) : '';
      if (sig !== (session._taskListSig || '')) {
        session._taskListSig = sig;
        session.taskList = taskList;
        this._log('info', `[${sessionId}] task_list update: ${taskList ? taskList.tasks.length + ' tasks, ' + taskList.completed + '/' + taskList.total + ' done' : 'null'}`);
        if (!session.activity) {
          session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
        }
        session.activity.task_list = taskList;
        if (session.contextCard) session.activity.context_card = session.contextCard;
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
      }
    }

    if (session.agentType === 'cline' || session.agentType === 'roo_code') {
      const contextSig = contextUsage ? JSON.stringify(contextUsage) : '';
      if (contextSig !== (session._contextCardSig || '')) {
        session._contextCardSig = contextSig;
        session.contextCard = contextUsage || null;
        if (!session.activity) {
          session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
        }
        session.activity.context_card = session.contextCard;
        sessionStore.updateSession(sessionId, { activity: session.activity });
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
      }
    }

    // ── Message processing ── (same logic as generic _pollSession)
    const now = Date.now();
    if (session.agentType === 'continue' && (!session._lastContinueChatListPollAt || now - session._lastContinueChatListPollAt > 5000)) {
      session._lastContinueChatListPollAt = now;
      try {
        const chatList = await this._withWorkbenchClient(session, client =>
          selectors.readContinueWorkbenchChatList(client.Runtime, session._webviewId)
        );
        const chatListSig = JSON.stringify(chatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
        if (chatListSig !== session._lastChatListSig) {
          session._lastChatListSig = chatListSig;
          this._sendToRelay(proto.chatList(sessionId, chatList));
        }
        const activeChat = Array.isArray(chatList) ? chatList.find(c => c && c.active) : null;
        if (activeChat?.title && activeChat.title !== session.chat_title) {
          session.chat_title = activeChat.title;
          this._broadcastSessionSnapshot();
        }
      } catch (e) {
        this._log('warn', `[${sessionId}] readContinueWorkbenchChatList poll error: ${e.message}`);
      }
    }

    const messages = JSON.parse(raw);
    const effectiveMessages = messages;
    const transcriptSig = this._transcriptSignature(effectiveMessages);
    const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

    if (effectiveMessages.length < prevObservedCount) {
      this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}, forcing history snapshot`);
      this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
      session.lastMessageCount = effectiveMessages.length;
      session.lastObservedCount = effectiveMessages.length;
      session.lastTranscriptSig = transcriptSig;
      session.pendingLast = null;
      session.resyncCandidateSig = null;
      session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      // Still process thinking + permissions below
    } else if (
      session.lastTranscriptSig &&
      transcriptSig !== session.lastTranscriptSig &&
      effectiveMessages.length === prevObservedCount
    ) {
      if (session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Transcript mutated in place, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript mutation');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        session.resyncCandidateSig = transcriptSig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
      }
    } else {
      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        if (session.agentType === 'codex-desktop') {
          try {
            const ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
            if (ts?.thinking) {
              session.lastObservedCount = effectiveMessages.length;
              session.lastTranscriptSig = transcriptSig;
              return;
            }
          } catch {}
        }
        this._log('warn', `[${sessionId}] Mutated transcript stabilized — resyncing`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        if (effectiveMessages.length < session.lastMessageCount) {
          this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} → ${effectiveMessages.length}, resetting`);
          session.lastMessageCount = effectiveMessages.length;
          session.pendingLast = null;
        }

        const streamFlushThresholdMs = session.agentType === 'continue_yolo' ? 1200 : 5000;

        // Pending stabilisation
        if (session.pendingLast !== null) {
          const p = session.pendingLast;
          const current = effectiveMessages[session.lastMessageCount];
          if (current && current.role === p.role && current.content === p.content) {
            this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
            this._sendToRelay(proto.proxyMessage(sessionId, p.role, p.content));
            session.lastMessageCount++;
            session.pendingLast = null;
            session._pendingFirstSeenAt = null;
            if (p.role === 'user') session.waitingForAssistant = true;
            if (p.role === 'assistant') session.waitingForAssistant = false;
          } else if (current) {
            if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
            const pendingAge = Date.now() - session._pendingFirstSeenAt;
            if (pendingAge > streamFlushThresholdMs && current.content !== session._lastStreamedContent) {
              session._lastStreamedContent = current.content;
              this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
              this._log(
                'info',
                `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge)}ms)`
              );
            }
            session.pendingLast = { role: current.role, content: current.content };
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = transcriptSig;
          }
        }

        // Send newly complete messages
        const prev = session.lastMessageCount;
        if (effectiveMessages.length > prev && session.pendingLast === null) {
          for (let i = prev; i < effectiveMessages.length - 1; i++) {
            this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
            this._sendToRelay(proto.proxyMessage(sessionId, effectiveMessages[i].role, effectiveMessages[i].content));
            if (effectiveMessages[i].role === 'user') session.waitingForAssistant = true;
            if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
          }
          session.lastMessageCount = effectiveMessages.length - 1;
          const last = effectiveMessages[effectiveMessages.length - 1];
          session.pendingLast = { role: last.role, content: last.content };
        }

        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      }
    }

    // ── Thinking / activity state ──
    const active = session.pendingLast !== null || session.waitingForAssistant;
    const isContinueFamily = session.agentType === 'continue' || session.agentType === 'continue_yolo';
    const kind = isContinueFamily
      ? ((thinkingState.thinking || active) ? 'generating' : 'idle')
      : (thinkingState.thinking ? 'thinking' : active ? 'generating' : 'idle');
    const label = thinkingState.label || (active ? 'Generating' : '');
    const newActivity = { kind, label, updated_at: new Date().toISOString() };
    if (session.taskList) newActivity.task_list = session.taskList;
    if (session.contextCard) newActivity.context_card = session.contextCard;
    if (thinkingState.thinkingContent) newActivity.thinkingContent = thinkingState.thinkingContent;

    const prevKind = session.activity?.kind || 'idle';
    const prevThinkingContent = session.thinkingContent || '';
    const currThinkingContent = thinkingState.thinkingContent || '';
    const prevContextSig = session.activity?.context_card ? JSON.stringify(session.activity.context_card) : '';
    const currContextSig = newActivity.context_card ? JSON.stringify(newActivity.context_card) : '';
    if (thinkingState.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent || currContextSig !== prevContextSig) {
      session.thinking = thinkingState.thinking;
      session.thinkingLabel = label;
      session.thinkingContent = currThinkingContent;
      session.activity = newActivity;
      sessionStore.updateSession(sessionId, { activity: newActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));
      if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
        this._processMessageQueue(sessionId);
      }
    }

    // ── Permission dialog ──
    await this._handlePermissionDialogState(sessionId, session, perm);
    await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);
  }

  // ─── Session polling ─────────────────────────────────────────────────

  async _pollSessionClaude(sessionId, session) {
    if (session.rateLimitActive && session.rate_limited_until && session.rate_limited_until !== 'unknown') {
      const untilStr = session.rate_limited_until;
      let resetMs = null;
      const hmMatch = untilStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (hmMatch) {
        let h = parseInt(hmMatch[1], 10);
        const m = parseInt(hmMatch[2], 10);
        const ampm = (hmMatch[3] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        const now = new Date();
        const resetDate = new Date(now);
        resetDate.setHours(h, m, 0, 0);
        resetMs = resetDate.getTime();
      }
      const durationMatch = untilStr.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$|^(\d+)\s*m$/i);
      if (durationMatch && session._rateLimitDetectedAt) {
        const hours = parseInt(durationMatch[1] || '0', 10);
        const mins = parseInt(durationMatch[2] || durationMatch[3] || '0', 10);
        resetMs = session._rateLimitDetectedAt + (hours * 3600000) + (mins * 60000);
      }
      if (resetMs && Date.now() > resetMs) {
        this._log('info', `[${sessionId}] [rate-limit] Time-based auto-clear: ${untilStr} has passed`);
        session.rateLimitActive = false;
        session.rate_limited_until = null;
        session.percentUsed = null;
        session._rateLimitSig = null;
        this._sendToRelay(proto.rateLimitCleared(sessionId));
        this._broadcastSessionSnapshot();
      }
    }

    const configNow = Date.now();
    const includeConfig = !session._lastConfigPollAt || configNow - session._lastConfigPollAt > 15000;
    const includeRateLimit = (session._rateLimitPollCount || 0) + 1 >= 10;
    if (includeConfig) session._lastConfigPollAt = configNow;

    let pollResult;
    try {
      pollResult = await this._ephemeralCdpPoll(session, sessionId, {
        includeConfig,
        includeRateLimit,
      });
    } catch (e) {
      this._log('error', `[${sessionId}] Claude ephemeral poll error: ${e.message}`);
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 consecutive Claude poll failures - removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    const { raw, thinking: ts, perm, config, rateLimit } = pollResult;
    const thinkingState = ts && typeof ts === 'object'
      ? ts
      : { thinking: false, label: '', thinkingContent: '' };

    if (!raw) {
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount === 5 && session.status === 'healthy') {
        const failures = selectors.getSelectorFailures(sessionId);
        this._log('warn', `[${sessionId}] 5 null reads - marking degraded`);
        session.status = 'degraded';
        sessionStore.updateSession(sessionId, { status: 'degraded' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
      }
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 null - removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    if (session.nullPollCount > 0 && session.status === 'degraded') {
      this._log('info', `[${sessionId}] Reads recovered - marking healthy`);
      session.status = 'healthy';
      sessionStore.updateSession(sessionId, { status: 'healthy' });
      this._sendToRelay(proto.proxyStatus(sessionId, 'healthy', session.activity));
    }
    session.nullPollCount = 0;

    if (config) {
      try {
        const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, config, session.workspace_path));
        const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
        if (cfgSig !== session._lastConfigSig) {
          session._lastConfigSig = cfgSig;
          const capabilities = this._buildCapabilities(session.agentType);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
        }
      } catch {}
    }

    const messages = JSON.parse(raw);
    const effectiveMessages = messages;
    const transcriptSig = this._transcriptSignature(effectiveMessages);
    const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

    if (effectiveMessages.length < prevObservedCount) {
      this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}, forcing history snapshot`);
      this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
      session.lastMessageCount = effectiveMessages.length;
      session.lastObservedCount = effectiveMessages.length;
      session.lastTranscriptSig = transcriptSig;
      session.pendingLast = null;
      session.resyncCandidateSig = null;
      session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
    } else if (
      session.lastTranscriptSig &&
      transcriptSig !== session.lastTranscriptSig &&
      effectiveMessages.length === prevObservedCount
    ) {
      if (session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Transcript mutated in place, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript mutation');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        session.resyncCandidateSig = transcriptSig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
      }
    } else {
      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Mutated transcript stabilized - resyncing`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        if (effectiveMessages.length < session.lastMessageCount) {
          this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} -> ${effectiveMessages.length}, resetting`);
          session.lastMessageCount = effectiveMessages.length;
          session.pendingLast = null;
        }

        if (session.pendingLast !== null) {
          const p = session.pendingLast;
          const current = effectiveMessages[session.lastMessageCount];
          if (current && current.role === p.role && current.content === p.content) {
            this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
            this._sendToRelay(proto.proxyMessage(sessionId, p.role, p.content));
            session.lastMessageCount++;
            session.pendingLast = null;
            session._pendingFirstSeenAt = null;
            if (p.role === 'user') session.waitingForAssistant = true;
            if (p.role === 'assistant') session.waitingForAssistant = false;
          } else if (current) {
            if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
            const pendingAge = Date.now() - session._pendingFirstSeenAt;
            if (pendingAge > 5000 && current.content !== session._lastStreamedContent) {
              session._lastStreamedContent = current.content;
              this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
              this._log('info', `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge / 1000)}s)`);
            }
            session.pendingLast = { role: current.role, content: current.content };
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = transcriptSig;
          }
        }

        const prev = session.lastMessageCount;
        if (effectiveMessages.length > prev && session.pendingLast === null) {
          for (let i = prev; i < effectiveMessages.length - 1; i++) {
            this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
            this._sendToRelay(proto.proxyMessage(sessionId, effectiveMessages[i].role, effectiveMessages[i].content));
            if (effectiveMessages[i].role === 'user') session.waitingForAssistant = true;
            if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
          }
          session.lastMessageCount = effectiveMessages.length - 1;
          const last = effectiveMessages[effectiveMessages.length - 1];
          session.pendingLast = { role: last.role, content: last.content };
        }

        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      }
    }

    const active = session.pendingLast !== null || session.waitingForAssistant;
    const kind = thinkingState.thinking ? 'thinking' : active ? 'generating' : 'idle';
    const label = thinkingState.label || (active ? 'Generating' : '');
    const newActivity = { kind, label, updated_at: new Date().toISOString() };
    if (session.taskList) newActivity.task_list = session.taskList;
    if (thinkingState.thinkingContent) newActivity.thinkingContent = thinkingState.thinkingContent;

    const prevKind = session.activity?.kind || 'idle';
    const prevThinkingContent = session.thinkingContent || '';
    const currThinkingContent = thinkingState.thinkingContent || '';
    if (thinkingState.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent) {
      session.thinking = thinkingState.thinking;
      session.thinkingLabel = label;
      session.thinkingContent = currThinkingContent;
      session.activity = newActivity;
      sessionStore.updateSession(sessionId, { activity: newActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));
      if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
        this._processMessageQueue(sessionId);
      }
    }

    await this._handlePermissionDialogState(sessionId, session, perm);

    session._rateLimitPollCount = includeRateLimit ? 0 : ((session._rateLimitPollCount || 0) + 1);
    if (includeRateLimit) {
      const rl = rateLimit;
      const wasActive = session.rateLimitActive || false;
      const nowActive = rl?.rate_limited === true;
      const untilText = rl?.until_text || null;
      const pctUsed = rl?.percent_used ?? null;
      const hasBanner = pctUsed != null;
      const sig = `${nowActive}|${pctUsed}|${untilText}`;
      if (sig !== session._rateLimitSig) {
        session._rateLimitSig = sig;
        session.rateLimitActive = nowActive;
        session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
        session.percentUsed = hasBanner ? pctUsed : null;
        if (nowActive) {
          if (!wasActive) session._rateLimitDetectedAt = Date.now();
          this._log('info', `[${sessionId}] [rate-limit] Active: ${pctUsed != null ? pctUsed + '%' : ''} resets ${untilText || 'unknown'}`);
          this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed));
        } else if (hasBanner) {
          this._log('info', `[${sessionId}] [rate-limit] Usage: ${pctUsed}% resets ${untilText || 'unknown'}`);
          this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed));
        } else if (wasActive || session.percentUsed != null) {
          this._log('info', `[${sessionId}] [rate-limit] Cleared`);
          this._sendToRelay(proto.rateLimitCleared(sessionId));
        }
        this._broadcastSessionSnapshot();
      }
    }
  }

  async _pollSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session._pollInProgress) {
      session._skippedOverlappingPolls = (session._skippedOverlappingPolls || 0) + 1;
      if (session._skippedOverlappingPolls === 1 || session._skippedOverlappingPolls % 10 === 0) {
        this._log('warn', `[${sessionId}] Skipping overlapping poll (${session._skippedOverlappingPolls})`);
      }
      return;
    }
    session._pollInProgress = true;

    try {
      // Continue and Roo Code use ephemeral CDP.  Claude used to but now uses persistent
      // connections (see _isEphemeralIframeAgent for rationale) because ephemeral
      // attach itself steals focus in Electron.
      if (session.agentType === 'claude_cli') {
        return await this._pollSessionClaudeCli(sessionId, session);
      }
      if (session.agentType === 'continue' || session.agentType === 'continue_yolo' || session.agentType === 'roo_code' || session.agentType === 'cline') {
        return await this._pollSessionContinue(sessionId, session);
      }

      // Task list detection — runs before readMessages so it isn't skipped
      // by early returns in null-read or pending-stabilisation paths
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (codexAuxBusy) session._lastBusyAt = Date.now();
        // Task lists / native queues / automation views only meaningfully
        // change while the agent is working. Gate aux polls to busy + a
        // 30s grace window (catches the final state after generation ends).
        const auxRelevant = codexAuxBusy ||
          (session._lastBusyAt && Date.now() - session._lastBusyAt < 30000);
        const taskListPollEvery = session.agentType === 'codex-desktop' ? 30 : 15;
        if (session._taskListPollCount === undefined) {
          session._taskListPollCount = staggerOffset(sessionId, 'taskList', taskListPollEvery);
        }
        session._taskListPollCount += 1;
        if (auxRelevant && !session._taskListPollInProgress && session._taskListPollCount >= taskListPollEvery) {
          session._taskListPollCount = 0;
          session._taskListPollInProgress = true;
          const usePageEval = session.agentType === 'codex-desktop';
          const handleTaskList = (taskList) => {
            const sig = taskList ? JSON.stringify(taskList) : '';
            if (sig !== (session._taskListSig || '')) {
              session._taskListSig = sig;
              session.taskList = taskList;
              this._log('info', `[${sessionId}] task_list update: ${taskList ? taskList.tasks.length + ' tasks, ' + taskList.completed + '/' + taskList.total + ' done' : 'null'}`);
              if (!session.activity) {
                session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              }
              session.activity.task_list = taskList;
              this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
            }
          };
          // Fire-and-forget for all codex variants — previously codex-desktop
          // serialised this with the rest of the poll, blocking readMessages
          // behind a slow DOM walk.
          selectors.readCodexTaskList(session.client.Runtime, usePageEval)
            .then(handleTaskList)
            .catch(e => { this._log('warn', `[${sessionId}] task_list error: ${e.message}`); })
            .finally(() => { session._taskListPollInProgress = false; });
        }
      }

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
          await this._safeClose(session.client);
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
      const configPollMs = this._isCodexSurface(session.agentType) ? 30000 : 15000;
      if (!session._lastConfigPollAt || configNow - session._lastConfigPollAt > configPollMs) {
        session._lastConfigPollAt = configNow;
        try {
          const cfg = await selectors.readAgentConfig(session.client.Runtime, session.agentType, session.workspace_path);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, cfg, session.workspace_path));
          session._currentModelId = merged.model_id || null;
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
                this._sendHistorySnapshot(sessionId, [], 'empty list view clear');
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
            const panelSummary = await selectors.readAntigravityPanelSummary(session.client.Runtime);
            const panelTitle = panelSummary?.title || await selectors.readAntigravityPanelTitle(session.client.Runtime);
            const workspacePart = session.workspace_name || session.windowTitle.split(' / ')[0];
            const newTitle = panelTitle ? `${workspacePart} / ${panelTitle}` : workspacePart;
            let panelMetaChanged = false;
            if ((panelTitle || null) !== (session.panel_title || null)) {
              session.panel_title = panelTitle || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.mode || null) !== (session.panel_mode || null)) {
              session.panel_mode = panelSummary?.mode || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.model || null) !== (session.panel_model || null)) {
              session.panel_model = panelSummary?.model || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.pane_agent || null) !== (session.panel_agent || null)) {
              session.panel_agent = panelSummary?.pane_agent || null;
              panelMetaChanged = true;
            }
            if (newTitle && newTitle !== session.windowTitle) {
              this._log('info', `[${sessionId}] Panel conversation changed: "${session.windowTitle}" → "${newTitle}"`);
              session.windowTitle = newTitle;
              sessionStore.updateSession(sessionId, { window_title: newTitle, workspace_name: workspacePart });
              this._broadcastSessionSnapshot();
            } else if (panelMetaChanged) {
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

      // Codex chat-list polling: when the side pane is showing conversation history
      // with no active chat, treat that as list view and clear stale transcript state.
      if (session.agentType === 'codex') {
        const now = Date.now();
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexAuxBusy && (!session._lastWorkbenchPanePollAt || now - session._lastWorkbenchPanePollAt > 15000)) {
          session._lastWorkbenchPanePollAt = now;
          const changed = await this._refreshWorkbenchPaneMeta(session);
          if (changed) this._broadcastSessionSnapshot();
        }
        if (!codexAuxBusy && (!session._lastCodexChatListPollAt || now - session._lastCodexChatListPollAt > 15000)) {
          session._lastCodexChatListPollAt = now;
          try {
            const chatList = await selectors.readCodexChatList(session.client.Runtime, false);
            const chatListSig = JSON.stringify(chatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
            if (chatListSig !== session._lastChatListSig) {
              session._lastChatListSig = chatListSig;
              this._sendToRelay(proto.chatList(sessionId, chatList));
            }

            const hasChats = Array.isArray(chatList) && chatList.length > 0;
            const hasActiveChat = hasChats && chatList.some(c => c && c.active);
            const activeChat = hasActiveChat ? chatList.find(c => c && c.active) : null;
            const activeChatKey = activeChat ? `${activeChat.id || ''}:${activeChat.title || ''}` : '';
            if (activeChatKey && session._activeChatKey && activeChatKey !== session._activeChatKey) {
              this._log('info', `[${sessionId}] Codex active chat changed; resetting transcript accumulator`);
              this._resetTranscriptState(session, 'codex active chat change');
              sessionStore.updateSession(sessionId, { accumulated_messages: null });
            }
            if (activeChatKey) session._activeChatKey = activeChatKey;
            const shouldBeListView = hasChats && !hasActiveChat;
            if (shouldBeListView) {
              const wasListView = !!session._listView;
              let clearedMessages = false;
              if (!session._listView) {
                this._log('info', `[${sessionId}] Codex chat list visible with no active chat; entering list-view mode`);
              }
              if (session.lastMessageCount > 0) {
                this._log('info', `[${sessionId}] Codex list view - clearing ${session.lastMessageCount} stale messages from web UI`);
                this._sendHistorySnapshot(sessionId, [], 'codex list view clear');
                session.lastMessageCount = 0;
                session.lastObservedCount = 0;
                session.lastTranscriptSig = '';
                session.waitingForAssistant = false;
                session.pendingLast = null;
                clearedMessages = true;
              }
              session._listView = true;
              if (!wasListView || clearedMessages) {
                this._broadcastSessionSnapshot();
              }
            } else if (session._listView) {
              this._log('info', `[${sessionId}] Codex active chat resumed; leaving list-view mode`);
              session._listView = false;
              this._broadcastSessionSnapshot();
            }
          } catch (e) {
            this._log('warn', `[${sessionId}] readCodexChatList poll error: ${e.message}`);
          }
        }
      }

      // Skip stale message processing when the visible surface is in empty/list-view mode
      if (session._panelEmpty || session._listView) return;

      const messages = JSON.parse(raw);

      // ── Antigravity accumulation layer ──────────────────────────────
      // The Antigravity side panel virtualizes older turns — they disappear
      // from the DOM as the conversation grows.  Instead of treating the DOM
      // snapshot as authoritative (which would wipe history), we accumulate
      // messages in session._accumulatedMessages and merge new DOM content
      // into that buffer.
      const isAccumulating = this._isTranscriptAccumulating(session.agentType);
      let skipUnstableNoOverlap = false;

      if (isAccumulating) {
        if (!session._accumulatedMessages) {
          // First poll — seed with whatever the DOM has
          session._accumulatedMessages = messages.slice();
          session._accumulatedDirty = true;
        } else {
          let completionCollapseMatched = false;
          if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
            const completionMerge = this._mergeCodexCompletionCollapse(session._accumulatedMessages, messages);
            if (completionMerge.matched) {
              completionCollapseMatched = true;
              if (completionMerge.changed) {
                session._accumulatedMessages = completionMerge.messages;
                session._accumulatedDirty = true;
                session._forceHistoryResync = 'codex completion collapse retained';
                this._log('info', `[${sessionId}] Retained Codex work transcript across completed-task collapse`);
              }
              this._maybePersistAccumulatedMessages(sessionId, session);
            }
          }

          // Merge: find where current DOM messages overlap with the accumulated tail
          // The DOM always shows the newest N messages, so we match backwards.
          const acc  = session._accumulatedMessages;
          const dom  = messages;

          if (dom.length > 0 && !completionCollapseMatched) {
            // Find the longest suffix of `acc` that is a prefix of `dom`
            // (i.e. how many of the last accumulated messages are still visible)
            let overlapLen = 0;
            for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
              let match = true;
              for (let k = 0; k < tryLen; k++) {
                const accMsg = acc[acc.length - tryLen + k];
                const domMsg = dom[k];
                if (!this._messagesSoftMatch(accMsg, domMsg)) { match = false; break; }
              }
              if (match) { overlapLen = tryLen; break; }
            }

            if (overlapLen > 0) {
              const accStart = acc.length - overlapLen;
              if (
                this._shouldResetAccumulatorOnNoOverlap(session.agentType) &&
                accStart === 0 &&
                dom.length < acc.length
              ) {
                const domSig = this._transcriptSignature(dom);
                if (session._accumulatorPrefixTruncateSig === domSig) {
                  this._log('warn', `[${sessionId}] Codex Desktop transcript tail disappeared twice; trimming accumulated history to active thread`);
                  session._accumulatedMessages = dom.slice();
                  session._accumulatedDirty = true;
                  session._forceHistoryResync = 'codex-desktop accumulator trim';
                  session._accumulatorPrefixTruncateSig = null;
                } else {
                  this._log('warn', `[${sessionId}] Codex Desktop transcript is a shorter prefix; waiting for stable repeat before trimming`);
                  session._accumulatorPrefixTruncateSig = domSig;
                  skipUnstableNoOverlap = true;
                }
              }
              // Update overlapping tail (content may have grown from streaming)
              for (let k = 0; !skipUnstableNoOverlap && !session._forceHistoryResync && k < overlapLen; k++) {
                const accIdx = acc.length - overlapLen + k;
                const domIdx = k;
                const mergedMsg = (session.agentType === 'codex' || session.agentType === 'codex-desktop')
                  ? this._mergeCodexExpandedToolContent(acc[accIdx], dom[domIdx])
                  : dom[domIdx];
                if (mergedMsg !== dom[domIdx]) {
                  dom[domIdx] = mergedMsg;
                }
                // Keep the longer version
                if (this._messageContentText(dom[domIdx]).length > this._messageContentText(acc[accIdx]).length) {
                  acc[accIdx] = dom[domIdx];
                  session._accumulatedDirty = true;
                }
              }
              // Append truly new messages
              for (let k = overlapLen; !skipUnstableNoOverlap && !session._forceHistoryResync && k < dom.length; k++) {
                acc.push(dom[k]);
                session._accumulatedDirty = true;
              }
              if (!skipUnstableNoOverlap && !session._forceHistoryResync) {
                session._accumulatorNoOverlapCandidateSig = null;
                session._accumulatorPrefixTruncateSig = null;
              }
            } else {
              // No overlap — the DOM jumped to completely new content.
              // This can happen after a /clear or new_chat. Check if all DOM
              // messages are already in the tail of acc (subset check).
              if (this._shouldResetAccumulatorOnNoOverlap(session.agentType)) {
                const domSig = this._transcriptSignature(dom);
                if (session._accumulatorNoOverlapCandidateSig === domSig) {
                  this._log('warn', `[${sessionId}] Codex Desktop transcript window lost overlap twice; resetting accumulated history to active thread`);
                  session._accumulatedMessages = dom.slice();
                  session._accumulatedDirty = true;
                  session._forceHistoryResync = 'codex-desktop accumulator reset';
                  session._accumulatorNoOverlapCandidateSig = null;
                } else {
                  this._log('warn', `[${sessionId}] Codex Desktop transcript window lost overlap; waiting for a stable repeat before resetting`);
                  session._accumulatorNoOverlapCandidateSig = domSig;
                  skipUnstableNoOverlap = true;
                }
              } else {
                const lastAccContent = acc.length > 0 ? acc[acc.length - 1].content : '';
                const firstDomContent = dom[0]?.content || '';
                // If the DOM first message matches nothing in recent history, append all
                if (!lastAccContent || !firstDomContent.startsWith(lastAccContent.substring(0, 80))) {
                  for (const m of dom) {
                    acc.push(m);
                    session._accumulatedDirty = true;
                  }
                }
              }
            }
          }
        }
        this._maybePersistAccumulatedMessages(sessionId, session);
      }

      // Use accumulated messages for antigravity sessions, DOM snapshot for others
      const effectiveMessages = isAccumulating ? (session._accumulatedMessages || messages) : messages;
      const transcriptSig = this._transcriptSignature(effectiveMessages);
      const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

      if (skipUnstableNoOverlap) {
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        return;
      }

      if (session._forceHistoryResync) {
        const reason = session._forceHistoryResync;
        session._forceHistoryResync = null;
        this._sendHistorySnapshot(sessionId, effectiveMessages, reason);
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
        session._lastRegressionSnapshotSig = null;
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      if (effectiveMessages.length < prevObservedCount) {
        // For accumulating sessions this should rarely happen (new chat / clear)
        const regressionSig = `${prevObservedCount}->${effectiveMessages.length}:${transcriptSig}`;
        if (session._lastRegressionSnapshotSig === regressionSig) {
          session.lastMessageCount = effectiveMessages.length;
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          session.pendingLast = null;
          session.resyncCandidateSig = null;
          session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
          return;
        }
        session._lastRegressionSnapshotSig = regressionSig;
        this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}${isAccumulating ? ' (accumulated)' : ''}, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
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
          this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript mutation');
          this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
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
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
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
          if (session.agentType === 'codex-desktop' && p.role === 'assistant') {
            try {
              const ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
              if (ts?.thinking) {
                const genActivity = {
                  kind: 'thinking',
                  label: ts.label || 'Thinking',
                  updated_at: new Date().toISOString(),
                };
                if (session.taskList) genActivity.task_list = session.taskList;
                if (ts.thinkingContent) genActivity.thinkingContent = ts.thinkingContent;
                session.thinking = true;
                session.thinkingLabel = genActivity.label;
                session.thinkingContent = ts.thinkingContent || '';
                session.activity = genActivity;
                sessionStore.updateSession(sessionId, { activity: genActivity });
                this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
                session.lastObservedCount = effectiveMessages.length;
                session.lastTranscriptSig = transcriptSig;
                return;
              }
            } catch {}
          }
          this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
          this._sendToRelay(proto.proxyMessage(sessionId, p.role, p.content));
          session.lastMessageCount++;
          session.pendingLast = null;
          session._pendingFirstSeenAt = null;
          if (p.role === 'user')      session.waitingForAssistant = true;
          if (p.role === 'assistant') session.waitingForAssistant = false;
        } else if (current) {
          // Track how long the pending message has been changing
          if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
          const pendingAge = Date.now() - session._pendingFirstSeenAt;
          // Flush a full resync while content is changing.
          // Codex (both side pane and Desktop) benefits from a much shorter
          // threshold because its transcript/tool output evolves rapidly.
          const isCodexAny = session.agentType === 'codex' || session.agentType === 'codex-desktop';
          const streamFlushMs = isCodexAny ? 1500 : 5000;
          const holdCodexDesktopAssistant = session.agentType === 'codex-desktop' && current.role === 'assistant';
          if (!holdCodexDesktopAssistant && pendingAge > streamFlushMs && current.content !== session._lastStreamedContent) {
            session._lastStreamedContent = current.content;
            this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
            this._log('info', `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge / 1000)}s)`);
          }
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

      // Thinking / activity state. For Codex surfaces, reuse the cached
      // detection when the conversation DOM signature is unchanged from
      // the previous poll — detectThinking does a heavy DOM walk that
      // saturates the renderer's main thread and is the largest remaining
      // contributor to Codex wedging on idle sessions.
      let ts;
      if (this._isCodexSurface(session.agentType)) {
        const cachedTs = selectors.getCodexCachedThinking(sessionId);
        if (cachedTs) {
          ts = cachedTs;
        } else {
          ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
          selectors.setCodexCachedThinking(sessionId, ts);
        }
      } else {
        ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
      }
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
        if (session._threadListPollCount === undefined) {
          session._threadListPollCount = staggerOffset(sessionId, 'threadList', 60);
        }
        session._threadListPollCount += 1;
        const codexThreadBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexThreadBusy && session._threadListPollCount >= 60) {
          session._threadListPollCount = 0;
          await selectors.readCodexThreadList(session.client.Runtime, true)
            .then(threads => {
              if (threads.length > 0) {
                this._sendToRelay(proto.threadList(sessionId, threads));
                const activeThread = threads.find(t => t && t.active);
                const activeThreadKey = activeThread ? `${activeThread.id || ''}:${activeThread.title || ''}` : '';
                if (activeThreadKey && session._activeThreadKey && activeThreadKey !== session._activeThreadKey) {
                  this._log('info', `[${sessionId}] Codex Desktop active thread changed; resetting transcript accumulator`);
                  this._resetTranscriptState(session, 'codex-desktop active thread change');
                  sessionStore.updateSession(sessionId, { accumulated_messages: null });
                }
                if (activeThreadKey) session._activeThreadKey = activeThreadKey;
              }
            })
            .catch(() => {});
        }
      }

      // Rate limit / usage warning check — Codex and Claude
      if (session.agentType === 'codex') {
        // Time-based auto-clear: if we have a reset time and it's passed, clear immediately
        if (session.rateLimitActive && session.rate_limited_until && session.rate_limited_until !== 'unknown') {
          const untilStr = session.rate_limited_until;
          // Parse time like "2:50 PM", "14:50", "3h", "30m"
          let resetMs = null;
          const hmMatch = untilStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
          if (hmMatch) {
            let h = parseInt(hmMatch[1], 10);
            const m = parseInt(hmMatch[2], 10);
            const ampm = (hmMatch[3] || '').toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            const now = new Date();
            const resetDate = new Date(now);
            resetDate.setHours(h, m, 0, 0);
            // If the reset time is earlier today, it may have been yesterday's — assume it's passed
            resetMs = resetDate.getTime();
          }
          const durationMatch = untilStr.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$|^(\d+)\s*m$/i);
          if (durationMatch && session._rateLimitDetectedAt) {
            const hours = parseInt(durationMatch[1] || '0', 10);
            const mins = parseInt(durationMatch[2] || durationMatch[3] || '0', 10);
            resetMs = session._rateLimitDetectedAt + (hours * 3600000) + (mins * 60000);
          }
          if (resetMs && Date.now() > resetMs) {
            this._log('info', `[${sessionId}] [rate-limit] Time-based auto-clear: ${untilStr} has passed`);
            session.rateLimitActive = false;
            session.rate_limited_until = null;
            session.percentUsed = null;
            session._rateLimitSig = null;
            this._sendToRelay(proto.rateLimitCleared(sessionId));
            this._broadcastSessionSnapshot();
          }
        }

        if (session._rateLimitPollCount === undefined) {
          session._rateLimitPollCount = staggerOffset(sessionId, 'rateLimit', 30);
        }
        session._rateLimitPollCount += 1;
        const codexRateBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexRateBusy && !session._rateLimitPollInProgress && session._rateLimitPollCount >= 30) {
          session._rateLimitPollCount = 0;
          session._rateLimitPollInProgress = true;
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
                if (!wasActive) session._rateLimitDetectedAt = Date.now();
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
          }).catch(() => {})
            .finally(() => { session._rateLimitPollInProgress = false; });
        }
      }

      // Native queue detection — Codex side-panel queue items (messages with Steer buttons)
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        const nativeQueuePollEvery = session.agentType === 'codex-desktop' ? 30 : 10;
        if (session._nativeQueuePollCount === undefined) {
          session._nativeQueuePollCount = staggerOffset(sessionId, 'nativeQueue', nativeQueuePollEvery);
        }
        session._nativeQueuePollCount += 1;
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (codexAuxBusy) session._lastBusyAt = Date.now();
        const auxRelevant = codexAuxBusy ||
          (session._lastBusyAt && Date.now() - session._lastBusyAt < 30000);
        if (auxRelevant && !session._nativeQueuePollInProgress && session._nativeQueuePollCount >= nativeQueuePollEvery) {
          session._nativeQueuePollCount = 0;
          session._nativeQueuePollInProgress = true;
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
          }).catch((e) => { this._log('warn', `[${sessionId}] [native-queue] Error: ${e.message}`); })
            .finally(() => { session._nativeQueuePollInProgress = false; });
          // Fire-and-forget — previously codex-desktop awaited this and the
          // task list serially, stacking ~6s of CDP eval per poll on long sessions.
        }
      }

      if (session.agentType === 'codex-desktop') {
        if (session._automationViewPollCount === undefined) {
          session._automationViewPollCount = staggerOffset(sessionId, 'automationView', 30);
        }
        session._automationViewPollCount += 1;
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (codexAuxBusy) session._lastBusyAt = Date.now();
        const auxRelevant = codexAuxBusy ||
          (session._lastBusyAt && Date.now() - session._lastBusyAt < 30000);
        if (auxRelevant && session._automationViewPollCount >= 30) {
          session._automationViewPollCount = 0;
          try {
            const view = await selectors.readCodexAutomationView(session.client.Runtime, true);
            const sig = view ? JSON.stringify(view) : '';
            if (sig !== (session._automationViewSig || '')) {
              session._automationViewSig = sig;
              this._sendToRelay(proto.codexAutomationView(sessionId, view));
            }
          } catch (e) {
            this._log('warn', `[${sessionId}] automation_view error: ${e.message}`);
          }
        }
      }


    } catch (e) {
      this._log('error', `[${sessionId}] Poll error: ${e.message}`);
    } finally {
      session._pollInProgress = false;
    }
  }

  // ─── Permission dialog polling ───────────────────────────────────────

  async _pollSessionBounded(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const now = Date.now();
    if (this._isCdpTargetCooling(session.targetId)) return;
    if (session._pollBackoffUntil && now < session._pollBackoffUntil) return;
    if (session._pollBackoffUntil && now >= session._pollBackoffUntil) {
      session._pollBackoffUntil = 0;
    }
    const timeoutMs =
      this._isCodexSurface(session.agentType) ? 6000 :
      (session.agentType === 'continue' || session.agentType === 'continue_yolo') ? 10000 :
      12000;
    let timer = null;
    const pollStartedAt = Date.now();
    try {
      await Promise.race([
        this._pollSession(sessionId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`poll timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      // Surface unusually slow polls — these correspond to long-blocking
      // CDP evals on the agent's renderer, which the user perceives as the
      // Codex / Codex Desktop UI being locked up.
      const dur = Date.now() - pollStartedAt;
      const slowThresh = (session.agentType === 'codex' || session.agentType === 'codex-desktop') ? 1500 : 3000;
      if (dur >= slowThresh) {
        if (this._isCodexSurface(session.agentType)) {
          session._slowCodexPollCount = (session._slowCodexPollCount || 0) + 1;
          if (session._slowCodexPollCount >= 3) {
            session._pollBackoffUntil = Date.now() + 10000;
            session._slowCodexPollCount = 0;
            this._log('warn', `[${sessionId}] Codex polling backed off for 10s after repeated slow polls`);
          }
        }
        this._log('warn', `[${sessionId}] slow poll: ${dur}ms (agent=${session.agentType})`);
      } else if (this._isCodexSurface(session.agentType)) {
        session._slowCodexPollCount = 0;
      }
    } catch (e) {
      this._log('warn', `[${sessionId}] ${e.message}; closing CDP client for rediscovery`);
      if (this._isCodexSurface(session.agentType)) {
        this._cooldownCdpTarget(session, e.message, 30000);
      }
      sessionStore.markDisconnected(sessionId);
      await this._safeClose(session.client, `poll close ${sessionId.substring(0,8)}`);
      this.sessions.delete(sessionId);
      this._broadcastSessionSnapshot();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _makePromptId(sessionId, message, choices) {
    const raw = `${sessionId}||${message}||${choices.map(c => c.choice_id).join('|')}`;
    return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
  }

  _makeErrorPromptId(sessionId, prompt = {}) {
    const actions = Array.isArray(prompt.actions) ? prompt.actions.map(a => a.action_id || a.label || '').join('|') : '';
    const raw = `${sessionId}||${prompt.title || ''}||${prompt.message || ''}||${prompt.error_output || ''}||${prompt.display_mode || ''}||${prompt.blocking === false ? 'nonblocking' : 'blocking'}||${actions}`;
    return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
  }

  async _pollPermissions(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.agentType === 'claude_cli') return;
    if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
      try {
        const promptState = await this._withEphemeralIframeClient(session, async client => {
          const [dialog, errorPrompt] = await Promise.all([
            selectors.detectPermissionDialog(client.Runtime, session.agentType),
            selectors.detectSessionErrorPrompt(client.Runtime, session.agentType),
          ]);
          return { dialog, errorPrompt };
        }, 'permission_detect');
        const dialog = promptState?.dialog || null;
        const errorPrompt = promptState?.errorPrompt || null;
        await this._handlePermissionDialogState(sessionId, session, dialog);
        await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);
      } catch (e) {
        this._log('error', `[${sessionId}] [perm] Continue poll error: ${e.message}`);
      }
      return;
    }

    try {
      const dialog = await selectors.detectPermissionDialog(session.client.Runtime, session.agentType);

      await this._handlePermissionDialogState(sessionId, session, dialog);
    } catch (e) {
      this._log('error', `[${sessionId}] [perm] Poll error: ${e.message}`);
    }
  }

  async _pollPermissionsBounded(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session._permissionPollInProgress) return;

    const timeoutMs =
      session.agentType === 'continue' || session.agentType === 'continue_yolo' || session.agentType === 'roo_code' || session.agentType === 'cline'
        ? 5000
        : 3500;

    session._permissionPollInProgress = true;
    let timer = null;
    try {
      await Promise.race([
        this._pollPermissions(sessionId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`permission poll timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (e) {
      this._log('warn', `[${sessionId}] [perm] ${e.message}`);
      if (!this._isEphemeralIframeAgent(session.agentType)) {
        await this._safeClose(session.client, `perm close ${sessionId.substring(0,8)}`);
        sessionStore.markDisconnected(sessionId);
        this.sessions.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
    } finally {
      if (timer) clearTimeout(timer);
      session._permissionPollInProgress = false;
    }
  }

  async _handleSessionErrorPromptState(sessionId, session, prompt) {
    if (prompt) {
      const promptId = this._makeErrorPromptId(sessionId, prompt);
      const last = this.activeErrorPrompts.get(sessionId);
      if (last && last.prompt_id === promptId) return;

      const payload = {
        prompt_id:     promptId,
        title:         prompt.title || 'Error handling model response',
        message:       prompt.message || 'There was an error handling the model response.',
        error_output:  prompt.error_output || null,
        actions:       Array.isArray(prompt.actions) ? prompt.actions : [],
        display_mode:  prompt.display_mode || 'overlay',
        blocking:      prompt.blocking !== false,
      };
      this._log('info', `[${sessionId}] [error-prompt] detected: "${payload.title}" actions=${payload.actions.map(a => a.action_id).join(',')}`);
      this.activeErrorPrompts.set(sessionId, { prompt_id: promptId, prompt: payload, surfaced: true });
      this._sendToRelay(proto.sessionErrorPrompt(sessionId, payload));
      return;
    }

    if (this.activeErrorPrompts.has(sessionId)) {
      const last = this.activeErrorPrompts.get(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (last?.surfaced) {
        this._log('info', `[${sessionId}] [error-prompt] cleared`);
        this._sendToRelay(proto.sessionErrorPromptCleared(sessionId, last.prompt_id));
      }
    }
  }

  _stabilizeContinueConfig(session, cfg) {
    if (!session || !cfg) return cfg;

    if (this._isContinuePlaceholderValue(cfg.model_id)) {
      cfg.model_id = 'unknown';
    }
    if (this._isContinuePlaceholderValue(cfg.permission_mode)) {
      cfg.permission_mode = 'unknown';
    }
    cfg.available_models = this._sanitizeContinueModelList(cfg.available_models);

    if (!this._isContinuePlaceholderValue(cfg.model_id)) {
      session._lastContinueModelId = cfg.model_id;
    }
    if (!this._isContinuePlaceholderValue(cfg.permission_mode)) {
      session._lastContinuePermissionMode = cfg.permission_mode;
    }
    if (Array.isArray(cfg.available_models) && cfg.available_models.length > 0) {
      session._lastAvailableModels = cfg.available_models;
    }

    if (this._isContinuePlaceholderValue(cfg.model_id) && session._lastContinueModelId) {
      cfg.model_id = session._lastContinueModelId;
    }
    if (this._isContinuePlaceholderValue(cfg.permission_mode) && session._lastContinuePermissionMode) {
      cfg.permission_mode = session._lastContinuePermissionMode;
    }

    if ((!Array.isArray(cfg.available_models) || cfg.available_models.length === 0) && Array.isArray(session._lastAvailableModels) && session._lastAvailableModels.length > 0) {
      cfg.available_models = session._lastAvailableModels;
    } else if (!cfg.model_id || cfg.model_id === 'unknown' || !cfg.permission_mode || cfg.permission_mode === 'unknown' || !Array.isArray(cfg.available_models) || cfg.available_models.length === 0) {
      const sibling = Array.from(this.sessions.values()).find(s =>
        s !== session &&
        s.agentType === session.agentType &&
        s.workspace_path === session.workspace_path &&
        (
          (s._lastContinueModelId && s._lastContinueModelId !== 'unknown') ||
          (s._lastContinuePermissionMode && s._lastContinuePermissionMode !== 'unknown') ||
          (Array.isArray(s._lastAvailableModels) && s._lastAvailableModels.length > 0)
        )
      );
      if (sibling) {
        if ((!cfg.permission_mode || cfg.permission_mode === 'unknown') && sibling._lastContinuePermissionMode) {
          cfg.permission_mode = sibling._lastContinuePermissionMode;
          session._lastContinuePermissionMode = sibling._lastContinuePermissionMode;
        }
        if ((!Array.isArray(cfg.available_models) || cfg.available_models.length === 0) && Array.isArray(sibling._lastAvailableModels) && sibling._lastAvailableModels.length > 0) {
          cfg.available_models = sibling._lastAvailableModels;
          session._lastAvailableModels = sibling._lastAvailableModels;
        }
      }
    }

    session._continueConfigCache = cfg;
    return cfg;
  }

  _isContinuePlaceholderValue(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    return (
      text === 'unknown' ||
      text === 'select model' ||
      text === 'loading config' ||
      text === 'loading' ||
      text === 'choose model'
    );
  }

  _isUsableContinueModelOption(value) {
    const text = String(value || '').trim();
    if (this._isContinuePlaceholderValue(text)) return false;
    if (text.length > 120) return false;
    if (/\.md\b/i.test(text)) return false;
    if (/always applied/i.test(text)) return false;
    if (/^[0-9]+\.\s/.test(text)) return false;
    if (/[|`]/.test(text)) return false;
    if (/[\\/]/.test(text) && !/^[a-z0-9._:+ -]+$/i.test(text)) return false;
    return true;
  }

  _sanitizeContinueModelList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const cleaned = [];
    for (const item of list) {
      const text = String(item || '').trim();
      if (!this._isUsableContinueModelOption(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(text);
    }
    return cleaned;
  }

  _hasUsableContinueModels(list) {
    return this._sanitizeContinueModelList(list).length > 0;
  }

  _mergeContinueConfigs(primary, secondary) {
    if (!primary && !secondary) return null;
    if (!primary) return secondary;
    if (!secondary) return primary;

    const merged = { ...primary };
    const primaryModelUsable = !this._isContinuePlaceholderValue(primary.model_id);
    const secondaryModelUsable = !this._isContinuePlaceholderValue(secondary.model_id);
    const primaryModeUsable = !this._isContinuePlaceholderValue(primary.mode);
    const secondaryModeUsable = !this._isContinuePlaceholderValue(secondary.mode);
    const primaryPermUsable = !this._isContinuePlaceholderValue(primary.permission_mode);
    const secondaryPermUsable = !this._isContinuePlaceholderValue(secondary.permission_mode);
    const primaryModelsUsable = this._hasUsableContinueModels(primary.available_models);
    const secondaryModelsUsable = this._hasUsableContinueModels(secondary.available_models);

    if (!primaryModelUsable && secondaryModelUsable) merged.model_id = secondary.model_id;
    if (!primaryModeUsable && secondaryModeUsable) merged.mode = secondary.mode;
    if (!primaryPermUsable && secondaryPermUsable) merged.permission_mode = secondary.permission_mode;
    if (!primaryModelsUsable && secondaryModelsUsable) merged.available_models = secondary.available_models;

    return merged;
  }

  _shouldBackgroundPollContinueConfig(session) {
    if (!session || (session.agentType !== 'continue' && session.agentType !== 'continue_yolo')) return false;
    if (session.agentType === 'continue_yolo') {
      const cached = session._continueConfigCache || null;
      const modelKnown = !!(cached && !this._isContinuePlaceholderValue(cached.model_id));
      const permKnown = !!(cached && !this._isContinuePlaceholderValue(cached.permission_mode));
      const modelsKnown = !!(cached && this._hasUsableContinueModels(cached.available_models));
      return !(modelKnown && permKnown && modelsKnown);
    }
    return true;
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
        messageContent = content
          .replace(/\[File: [^\]]+\]\(\/uploads\/[^)]+\)/, `[File: ${file.originalName} → ${winPath}]`)
          .replace(/!\[[^\]]*\]\(\/uploads\/[^)]+\)/, `[File: ${file.originalName} → ${winPath}]`);
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
      result = await this._sendSessionMessage(sessionData, messageContent, sessionId);
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

    const result = await this._sendSessionMessage(session, item.content, sessionId);

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
        pageClient = await this._connectCdpTarget(page, 9223, `workbench page ${page.id.substring(0, 8)}`);
        await this._withTimeout(pageClient.Runtime.enable(), 3000, `Runtime.enable workbench ${page.id.substring(0, 8)}`);
        const res = await this._withTimeout(pageClient.Runtime.evaluate({
          expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
          returnByValue: true,
        }), 3000, `window id read ${page.id.substring(0, 8)}`);
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

      let sessionMetaChanged = false;
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
              this._refreshSessionPreferenceKey(session);
              sessionStore.updateSession(sid, {
                workspace_path: wsMatch.path,
                workspace_name: wsMatch.title,
                window_title: resolvedTitle,
              });
              this._log('info', `[discover] Corrected workspace for ${sid}: "${wsMatch.title}" (${wsMatch.path})`);
              sessionMetaChanged = true;
            }
            continue;
          }
        }

        // Fallback: derive workspace_name from workspace_path if we have one
        if (session.workspace_path && nameBad) {
          const derived = session.workspace_path.split(/[/\\]/).filter(Boolean).pop() || session.workspace_path;
          session.workspace_name = derived;
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { workspace_name: derived });
          this._log('info', `[discover] Derived workspace name for ${sid}: "${derived}"`);
          sessionMetaChanged = true;
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
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { window_title: resolvedTitle, workspace_name: resolvedTitle });
          this._log('info', `[discover] Fixed window title for ${sid}: "${resolvedTitle}"`);
          sessionMetaChanged = true;
        }
        if (wsMatch) {
          session.workspace_path = wsMatch.path;
          session.workspace_name = wsMatch.title;
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { workspace_path: wsMatch.path, workspace_name: wsMatch.title });
          this._log('info', `[discover] Resolved workspace for ${sid}: ${wsMatch.path}`);
          sessionMetaChanged = true;
        }
      }
      if (sessionMetaChanged) {
        this._broadcastSessionSnapshot();
      }
    }

    // ── Process iframe targets ──────────────────────────────────────────
    for (const target of iframes) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;

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
                      ext.toLowerCase().includes('gemini')    ||
                      ext.toLowerCase().includes('continue.continue') ||
                      ext.toLowerCase().includes('continue.continue-yolo') ||
                      ext.toLowerCase().includes('continue-yolo') ||
                      ext.toLowerCase().includes('roo') ||
                      ext.toLowerCase().includes('saoudrizwan.claude-dev') ||
                      ext.toLowerCase().includes('cline');
      if (!isAgent) continue;

      this._log('info', `[discover] Probing ${target.id.substring(0, 8)} ext=${ext}`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `iframe ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable iframe ${target.id.substring(0, 8)}`);
        client.Runtime._webviewId = (target.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || null;

        // Cache inner-frame context ID to avoid active-frame traversal
        // which causes focus/scroll steal in iframe-backed editor webviews
        if (ext.toLowerCase().includes('continue.continue') || ext.toLowerCase().includes('continue-yolo') || ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) {
          const focusTag = (ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) ? 'claude-focus' : 'continue-focus';
          this._log('info', `[discover] [${focusTag}] initial context cache:start target=${target.id}`);
        }
        await this._withTimeout(selectors.cacheInnerContextId(client.Runtime), 3000, `context cache ${target.id.substring(0, 8)}`);
        if (ext.toLowerCase().includes('continue.continue') || ext.toLowerCase().includes('continue-yolo') || ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) {
          const focusTag = (ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) ? 'claude-focus' : 'continue-focus';
          this._log('info', `[discover] [${focusTag}] initial context cache:end target=${target.id} resolved=${client.Runtime?._innerContextId || 'null'}`);
        }

        const agentType = await this._withTimeout(selectors.detectAgentType(client.Runtime, ext), 3000, `agent detect ${target.id.substring(0, 8)}`);
        if (!agentType) {
          this._log('info', `[discover] ${target.id.substring(0, 8)}: detectAgentType=null, skipping`);
          await this._safeClose(client);
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
        const { enabled: autoApprovePermissions, preferenceKey } = this._resolveAutoApproveState(agentType, sessionMeta, {
          workspacePath,
          workspaceName: workspaceMatch?.title || windowTitle,
          windowTitle,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] Session ${sessionId} already active, skipping duplicate target`);
          await this._safeClose(client);
          continue;
        }

        const currentTargetIds = new Set(targets.map(t => t.id));
        for (const [staleSid, staleSession] of this.sessions.entries()) {
          if (staleSession.agentType === agentType &&
              staleSession.parentId === parentId &&
              !currentTargetIds.has(staleSession.targetId)) {
            this._log('info', `[discover] Evicting stale session ${staleSid} — target ${staleSession.targetId?.substring(0,8)} no longer in CDP list`);
            sessionStore.markDisconnected(staleSid);
            await this._safeClose(staleSession.client);
            this.sessions.delete(staleSid);
            this.activePermissionPrompts.delete(staleSid);
            this.activeErrorPrompts.delete(staleSid);
          }
        }

        const raw          = await this._withTimeout(selectors.readMessages(client.Runtime, agentType, sessionId), 5000, `initial read ${sessionId.substring(0, 8)}`);
        const domMsgs      = raw ? JSON.parse(raw) : [];
        const isAccumAccum = this._isTranscriptAccumulating(agentType);
        let initialListView = false;
        let initialChatList = null;
        if (agentType === 'codex') {
          try {
            initialChatList = await this._withTimeout(
              selectors.readCodexChatList(client.Runtime, false),
              3000,
              `initial codex chat list ${sessionId.substring(0, 8)}`
            );
            const hasChats = Array.isArray(initialChatList) && initialChatList.length > 0;
            const hasActiveChat = hasChats && initialChatList.some(c => c && c.active);
            initialListView = hasChats && !hasActiveChat;
          } catch (e) {
            this._log('warn', `[discover] initial readCodexChatList failed for ${sessionId}: ${e.message}`);
          }
        }
        let storedAccumulated = Array.isArray(sessionMeta.accumulated_messages) ? sessionMeta.accumulated_messages : null;
        let useStoredAccumulated = false;
        if (isAccumAccum && storedAccumulated && domMsgs.length > 0) {
          const windowOffset = this._transcriptWindowOffset(storedAccumulated, domMsgs);
          useStoredAccumulated = agentType === 'codex-desktop'
            ? (windowOffset >= 0 && windowOffset + domMsgs.length === storedAccumulated.length)
            : windowOffset >= 0;
          if (!useStoredAccumulated && (agentType === 'codex' || agentType === 'codex-desktop')) {
            const completionMerge = this._mergeCodexCompletionCollapse(storedAccumulated, domMsgs);
            if (completionMerge.matched) {
              storedAccumulated = completionMerge.messages;
              useStoredAccumulated = true;
              if (completionMerge.changed) {
                sessionStore.updateSession(sessionId, { accumulated_messages: storedAccumulated });
              }
            }
          }
        }
        const initialMsgs  = initialListView
          ? []
          : (useStoredAccumulated ? storedAccumulated : domMsgs);
        const initialCount = initialMsgs.length;

        const firstUserMsg = initialMsgs.find(m => m.role === 'user');
        const rawFirstText = typeof firstUserMsg?.content === 'string'
          ? firstUserMsg.content
          : (Array.isArray(firstUserMsg?.content)
              ? firstUserMsg.content.map(c => c.text || c.content || '').join(' ')
              : '');
        const chatTitle = rawFirstText.replace(/\s+/g, ' ').trim().substring(0, 60) || null;
        const initialActiveChat = Array.isArray(initialChatList) ? initialChatList.find(c => c && c.active) : null;
        const initialActiveChatKey = initialActiveChat ? `${initialActiveChat.id || ''}:${initialActiveChat.title || ''}` : '';

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
          _accumulatedMessages: isAccumAccum ? initialMsgs.slice() : null,
          nullPollCount:    0,
          pendingLast:      null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:         false,
          thinkingLabel:    '',
          autoApprovePermissions,
          preferenceKey,
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
          _iframeInnerContextId: this._isEphemeralIframeAgent(agentType) ? (client.Runtime?._innerContextId || null) : null,
          _continueInnerContextId: (agentType === 'continue' || agentType === 'continue_yolo') ? (client.Runtime?._innerContextId || null) : null,
          _listView:        initialListView,
          _lastChatListSig: initialChatList ? JSON.stringify(initialChatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`)) : '',
          _activeChatKey:   initialActiveChatKey,
        });

        if (agentType === 'codex') {
          try {
            await this._withTimeout(
              this._refreshWorkbenchPaneMeta(this.sessions.get(sessionId)),
              3000,
              `initial workbench pane meta ${sessionId.substring(0, 8)}`
            );
          } catch {}
        }
        if (agentType === 'continue') {
          try {
            const continueSession = this.sessions.get(sessionId);
            const continueChatList = await this._withTimeout(
              this._withWorkbenchClient(continueSession, wbClient =>
                selectors.readContinueWorkbenchChatList(wbClient.Runtime, continueSession._webviewId)
              ),
              3000,
              `initial continue chat list ${sessionId.substring(0, 8)}`
            );
            if (Array.isArray(continueChatList) && continueChatList.length > 0) {
              continueSession._lastChatListSig = JSON.stringify(continueChatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
              const activeChat = continueChatList.find(c => c && c.active);
              if (activeChat?.title) {
                continueSession.chat_title = activeChat.title;
              }
              initialChatList = continueChatList;
            }
          } catch (e) {
            this._log('warn', `[discover] initial Continue chat list failed for ${sessionId}: ${e.message}`);
          }
        }

        // Continue uses ephemeral connections — drop the persistent client.
        // Claude keeps its persistent client (focus-stealing was caused by
        // active-frame access, now fixed via cached contextId + passive watcher).
        if (agentType === 'continue' || agentType === 'continue_yolo') {
          await this._safeClose(client);
          client = null;
          const ephemeralSession = this.sessions.get(sessionId);
          if (ephemeralSession) ephemeralSession.client = null;
        }

        this._log('info', `[cdp] ${agentType} → ${sessionId} in "${windowTitle}" (${initialCount} existing msgs)`);

        const shouldSendInitialHistory = raw && initialCount > 0 && (
          !isAccumAccum ||
          useStoredAccumulated ||
          sessionMeta._matched_existing === false
        );
        if (shouldSendInitialHistory) {
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }
        if (initialChatList) {
          this._sendToRelay(proto.chatList(sessionId, initialChatList));
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

        this._readSessionConfig(this.sessions.get(sessionId), resolvedPath).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, cfg, resolvedPath));
          if (session) session._currentModelId = merged.model_id || null;
          this._log('info', `[init-cfg] ${sessionId} (${agentType}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          if (session && merged.file_access_scope && merged.file_access_scope !== 'unknown') {
            const scopePath = merged.file_access_scope;
            const scopeName = scopePath.split(/[/\\]/).filter(Boolean).pop() || scopePath;
            if (!session.workspace_path || /^window-\d+$/.test(session.workspace_name)) {
              session.workspace_path = scopePath;
              session.workspace_name = scopeName;
              this._refreshSessionPreferenceKey(session);
              sessionStore.updateSession(sessionId, { workspace_path: scopePath, workspace_name: scopeName });
              this._log('info', `[init-cfg] ${sessionId}: backfilled workspace_name="${scopeName}" from file_access_scope`);
              this._broadcastSessionSnapshot();
            }
          }
        }).catch(err => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, null, resolvedPath));
          if (session) session._currentModelId = merged.model_id || null;
          this._log('info', `[init-cfg] ${sessionId} (${agentType}) fallback (${err?.message}): ${JSON.stringify({ ...merged, capabilities: agentCaps })}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        });

        if (client) {
          client.on('disconnect', () => {
            this._log('info', `[${sessionId}] CDP disconnected`);
            sessionStore.markDisconnected(sessionId);
            this.sessions.delete(sessionId);
            this.activePermissionPrompts.delete(sessionId);
            this.activeErrorPrompts.delete(sessionId);
            this._broadcastSessionSnapshot();
          });
        }

        this._broadcastSessionSnapshot();

      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
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
      if (this._isCdpTargetCooling(target.id)) continue;
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      this._log('info', `[discover] Probing Antigravity Manager page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `manager ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable manager ${target.id.substring(0, 8)}`);

        const convoTitle = await this._withTimeout(
          selectors.readAntigravitySessionTitle(client.Runtime),
          3000,
          `manager title ${target.id.substring(0, 8)}`
        );
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
          await this._safeClose(client);
          continue;
        }

        const raw          = await this._withTimeout(
          selectors.readMessages(client.Runtime, 'antigravity', sessionId),
          5000,
          `manager initial read ${sessionId.substring(0, 8)}`
        );
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
          autoApprovePermissions: sessionMeta.auto_approve_permissions === true,
          status:               'healthy',
          activity:             sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:         new Date().toISOString(),
          windowTitle:          displayName,
          agentType:            'antigravity',
          targetId:             target.id,
        });

        this._log('info', `[cdp] antigravity → ${sessionId} "${displayName}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }

        const agentCaps = this._buildCapabilities('antigravity');
        selectors.readAgentConfig(client.Runtime, 'antigravity', null).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig('antigravity', cfg, null));
          if (session) session._currentModelId = merged.model_id || null;
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
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
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
      if (this._isCdpTargetCooling(target.id)) continue;
      const existingSession = Array.from(this.sessions.values()).find(s => s.targetId === target.id);
      if (existingSession) {
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} skipped: targetId owned by session ${existingSession.session_id.substring(0,8)} (${existingSession.agentType})`);
        continue;
      }

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `antigravity panel ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable antigravity panel ${target.id.substring(0, 8)}`);

        const hasContent = await this._withTimeout(
          selectors.detectAntigravityPanelHasContent(client.Runtime),
          3000,
          `antigravity panel content ${target.id.substring(0, 8)}`
        );
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} "${target.title.substring(0,40)}" hasContent=${hasContent}`);
        // Register the panel even when empty so it shows in the web UI immediately.
        // The user can start typing and the session will persist.

        const workspaceName = (target.title || '').replace(/ - Antigravity.*/, '').trim() || target.title;
        const panelSummary  = await this._withTimeout(
          selectors.readAntigravityPanelSummary(client.Runtime),
          3000,
          `antigravity panel summary ${target.id.substring(0, 8)}`
        );
        const panelTitle    = panelSummary?.title || await this._withTimeout(
          selectors.readAntigravityPanelTitle(client.Runtime),
          3000,
          `antigravity panel title ${target.id.substring(0, 8)}`
        );
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
        const { enabled: autoApprovePermissions, preferenceKey } = this._resolveAutoApproveState('antigravity_panel', sessionMeta, {
          workspacePath: panelWsMatch?.path || null,
          workspaceName,
          windowTitle: displayName,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          await this._safeClose(client);
          continue;
        }

        const raw          = await this._withTimeout(
          selectors.readMessages(client.Runtime, 'antigravity_panel', sessionId),
          5000,
          `antigravity panel initial read ${sessionId.substring(0, 8)}`
        );
        const initialMsgs  = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     displayName,
          workspace_name:   workspaceName,
          workspace_path:   panelWsMatch?.path || null,
          panel_title:      panelTitle || null,
          panel_mode:       panelSummary?.mode || null,
          panel_model:      panelSummary?.model || null,
          panel_agent:      panelSummary?.pane_agent || null,
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
          autoApprovePermissions,
          preferenceKey,
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
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }

        const agentCaps = this._buildCapabilities('antigravity_panel');
        this._sendToRelay(proto.agentConfig(sessionId, {
          agent_type: 'antigravity_panel',
          display_name: displayName,
          workspace_name: workspaceName,
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
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe Antigravity side-panel ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Desktop app sessions ────────────────────────────────────────────
    for (const target of desktopPg) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      if (!target.url || target.url.startsWith('devtools') || target.url.startsWith('chrome-extension')) continue;

      const agentType = DESKTOP_PORT_MAP[target._cdpPort];
      this._log('info', `[discover] Probing ${agentType} page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort, `${agentType} ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable ${agentType} ${target.id.substring(0, 8)}`);

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
          await this._safeClose(client);
          continue;
        }

        const raw         = await this._withTimeout(
          selectors.readMessages(client.Runtime, agentType, sessionId),
          5000,
          `${agentType} initial read ${sessionId.substring(0, 8)}`
        ).catch(() => null);
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
          autoApprovePermissions: sessionMeta.auto_approve_permissions === true,
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
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }

        const agentCaps = this._buildCapabilities(agentType);
        selectors.readAgentConfig(client.Runtime, agentType, null).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, cfg, null));
          if (session) session._currentModelId = merged.model_id || null;
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
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
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
    await this._discoverClaudeCliSessions();
    await this._discoverTargets();
    await this._refreshAntigravityQuotaUsage(true);

    let tick = 0;
    this._pollTimer = setInterval(async () => {
      if (!this._running) return;
      if (this._pollLoopInProgress) {
        this._skippedPollTicks = (this._skippedPollTicks || 0) + 1;
        if (this._skippedPollTicks === 1 || this._skippedPollTicks % 10 === 0) {
          this._log('warn', `[poll] Previous tick still running; skipped ${this._skippedPollTicks} tick(s)`);
        }
        return;
      }
      this._pollLoopInProgress = true;
      try {
      tick++;

      // Top-level caps on discovery and quota refresh so a single hung
      // CDP renderer can never freeze the entire poll loop. Each function
      // already has internal per-step timeouts; these are belt-and-braces.
      if (tick % 10 === 0) {
        try {
          await this._withTimeout(this._discoverTargets(), 30000, 'tick discoverTargets');
        } catch (e) { this._log('warn', `[poll] discoverTargets: ${e.message}`); }
      }
      if (tick % 30 === 0) {
        try {
          await this._withTimeout(this._discoverClaudeCliSessions(), 10000, 'tick discoverClaudeCli');
        } catch (e) { this._log('warn', `[poll] discoverClaudeCli: ${e.message}`); }
      }

      if (tick % 30 === 0 && this.sessions.size > 0) {
        try {
          await this._refreshAntigravityQuotaUsage();
        } catch (e) { this._log('warn', `[poll] refreshAntigravityQuota: ${e.message}`); }
        for (const [id, s] of this.sessions.entries()) {
          this._log('info', `[status] ${id} (${s.agentType}): ${s.lastMessageCount} msgs, relay ${this.relayReady ? 'up' : 'down'}, status=${s.status}`);
        }
        this._broadcastSessionSnapshot();
      }

      // Poll desktop apps, Codex side pane sessions, and Continue YOLO every
      // tick. Continue YOLO still uses ephemeral CDP attaches via
      // _pollSessionContinue/_isEphemeralIframeAgent, but it should not share
      // the slow sidepane-Continue throttle because the editor-panel UX needs
      // near-live transcript sync.
      const everyTickIds = [];
      // Group remaining window-backed sessions by parentId (Antigravity window)
      // so we only interact with one window's CDP targets per tick.
      const windowGroups = new Map(); // parentId → [sessionId, ...]
      for (const [sessionId, session] of this.sessions.entries()) {
        if (
          session.agentType === 'codex-desktop' ||
          session.agentType === 'claude-desktop' ||
          session.agentType === 'codex'
        ) {
          everyTickIds.push(sessionId);
          continue;
        }
        const key = session.parentId || sessionId;
        if (!windowGroups.has(key)) windowGroups.set(key, []);
        windowGroups.get(key).push(sessionId);
      }

      for (const sessionId of everyTickIds) {
        const session = this.sessions.get(sessionId);
        if (!session) continue;
        if (session.agentType === 'continue_yolo') {
          await this._pollSessionBounded(sessionId);
          continue;
        }
        // Throttle desktop apps when idle — the user is most likely typing
        // and our DOM walking (readMessages + detectThinking) blocks the
        // renderer thread.  Poll every 3rd tick (~3s) when idle, every tick
        // when actively generating.
        if (session.agentType === 'codex-desktop' || session.agentType === 'claude-desktop') {
          const isActive = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
          let threshold = session.agentType === 'codex-desktop'
            ? (isActive ? 2 : 6)
            : (isActive ? 1 : 3);
          // Adaptive idle backoff: when the cheap dirty-check on Codex
          // messages has hit many polls in a row, the session is genuinely
          // idle. Stretch the polling interval (3s → ~10s+) to free the
          // renderer's main thread completely.
          if (!isActive && session.agentType === 'codex-desktop') {
            const cacheStats = selectors.getCodexReadCacheStats(sessionId);
            if (cacheStats.hits > 20) threshold = Math.max(threshold, 18);
            else if (cacheStats.hits > 5) threshold = Math.max(threshold, 12);
          }
          if (!isActive) {
            session._desktopIdlePollCount = (session._desktopIdlePollCount || 0) + 1;
            if (session._desktopIdlePollCount < threshold) continue;
            session._desktopIdlePollCount = 0;
          } else {
            session._desktopActivePollCount = (session._desktopActivePollCount || 0) + 1;
            if (session._desktopActivePollCount < threshold) continue;
            session._desktopActivePollCount = 0;
          }
        }
        if (session.agentType === 'codex') {
          const isActive = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
          let threshold = isActive ? 3 : 8;
          if (!isActive) {
            const cacheStats = selectors.getCodexReadCacheStats(sessionId);
            if (cacheStats.hits > 20) threshold = Math.max(threshold, 24);
            else if (cacheStats.hits > 5) threshold = Math.max(threshold, 16);
          }
          session._codexPollCount = (session._codexPollCount || 0) + 1;
          if (session._codexPollCount < threshold) continue;
          session._codexPollCount = 0;
        }
        await this._pollSessionBounded(sessionId);
        await this._pollPermissionsBounded(sessionId);
      }

      const windowKeys = Array.from(windowGroups.keys());
      if (windowKeys.length > 0) {
        // Pick which window to poll this tick (round-robin)
        this._pollWindowIndex = this._pollWindowIndex % windowKeys.length;
        const activeKey = windowKeys[this._pollWindowIndex];
        this._pollWindowIndex++;

        // Poll a small slice of the selected window. Polling every session in
        // a busy window can monopolize the tick and starve desktop app reads.
        let polledWindowSessions = 0;
        for (const sessionId of windowGroups.get(activeKey)) {
          const session = this.sessions.get(sessionId);
          if (!session) continue;
          // Throttle Continue sessions — CDP eval on their iframe steals
          // VS Code panel focus.  Poll every 5s instead of every tick.
          if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
            const shouldFastPollPermissions = session.autoApprovePermissions || this.activePermissionPrompts.has(sessionId);
            if (shouldFastPollPermissions) {
              await this._pollPermissionsBounded(sessionId);
            } else {
              session._continuePermissionPollCount = (session._continuePermissionPollCount || 0) + 1;
              if (session._continuePermissionPollCount >= 2) {
                session._continuePermissionPollCount = 0;
                await this._pollPermissionsBounded(sessionId);
              }
            }

            session._continuePollCount = (session._continuePollCount || 0) + 1;
            if (session._continuePollCount < 5) continue;
            session._continuePollCount = 0;
            await this._pollSessionBounded(sessionId);
            polledWindowSessions++;
            if (polledWindowSessions >= 2) break;
            continue;
          }
          await this._pollSessionBounded(sessionId);
          await this._pollPermissionsBounded(sessionId);
          polledWindowSessions++;
          if (polledWindowSessions >= 2) break;
        }
      }
      } catch (e) {
        this._log('error', `[poll] Tick error: ${e.message}`);
      } finally {
        this._pollLoopInProgress = false;
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
      if (session.client) {
        try { session.client.close(); } catch {}
      }
    }
    this.sessions.clear();
    this.activePermissionPrompts.clear();
    this.activeErrorPrompts.clear();

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
