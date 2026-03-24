// vscode-ext/extension.js — VS Code extension wrapper for the agent proxy
//
// Wraps ProxyEngine from proxy-engine.js so the proxy runs inside
// Antigravity (or any VS Code fork) as an extension rather than a
// standalone Node.js process.
//
// Single-instance guard: only one Antigravity window runs the proxy at a
// time. A lock file with heartbeat ensures automatic failover if the
// leader window is closed — a standby window takes over within ~5-15s.
//
// Configuration is read from VS Code settings instead of .env files.
// Status is shown in the status bar instead of a system tray icon.
//
// Extension settings (contributes.configuration in package.json):
//   remoteAgentProxy.relayUrl       — Relay WebSocket URL
//   remoteAgentProxy.proxySecret    — Shared secret for relay auth
//   remoteAgentProxy.cdpPorts       — CDP port numbers (comma-separated)
//   remoteAgentProxy.machineLabel   — Machine label override
//   remoteAgentProxy.autoStart      — Start proxy on extension activation (default: true)

'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

let engine          = null;
let statusBarItem   = null;
let outputChannel   = null;

// ─── Single-instance lock ───────────────────────────────────────────────────
//
// Lock file lives in os.tmpdir() so all Antigravity windows can see it.
// Format: { pid: number, timestamp: number }
// The holder refreshes `timestamp` every HEARTBEAT_MS.
// Standbys poll every POLL_MS; if timestamp is older than STALE_MS the lock
// is considered abandoned and the standby breaks it.

const LOCK_FILE    = path.join(os.tmpdir(), 'remote-agent-proxy.lock');
const HEARTBEAT_MS = 5000;
const POLL_MS      = 5000;
const STALE_MS     = 15000;

let isLeader         = false;
let heartbeatTimer   = null;
let standbyTimer     = null;

function _readLock() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _writeLock() {
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function _deleteLock() {
  try {
    // Only delete if we own it
    const lock = _readLock();
    if (lock && lock.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

function _isLockStale(lock) {
  if (!lock) return true;
  // Check if the heartbeat is too old
  if (Date.now() - lock.timestamp > STALE_MS) return true;
  // Check if the PID is still alive (Windows + Unix compatible)
  try {
    process.kill(lock.pid, 0); // signal 0 = existence check, doesn't kill
    return false;
  } catch {
    return true; // process doesn't exist
  }
}

function _tryAcquireLock() {
  const existing = _readLock();
  if (existing && !_isLockStale(existing)) {
    return false; // another live instance holds it
  }
  // Stale or missing — take over
  return _writeLock();
}

function _startHeartbeat() {
  _stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (isLeader) _writeLock();
  }, HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function _startStandbyPoll() {
  _stopStandbyPoll();
  standbyTimer = setInterval(() => {
    if (isLeader) return; // shouldn't happen, but guard
    const lock = _readLock();
    if (_isLockStale(lock)) {
      outputChannel?.appendLine('[lock] Leader gone — taking over as leader');
      if (_tryAcquireLock()) {
        _stopStandbyPoll();
        _becomeLeader();
      }
    }
  }, POLL_MS);
}

function _stopStandbyPoll() {
  if (standbyTimer) { clearInterval(standbyTimer); standbyTimer = null; }
}

async function _becomeLeader() {
  isLeader = true;
  _startHeartbeat();
  updateStatusBar();

  const config = getConfig();
  if (config.autoStart) {
    await startProxy();
  }
}

function _resignLeader() {
  isLeader = false;
  _stopHeartbeat();
  if (engine) {
    if (engine._statusInterval) clearInterval(engine._statusInterval);
    engine.stop();
    engine = null;
  }
  _deleteLock();
}

// ─── Config ─────────────────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('remoteAgentProxy');
  const cdpPortsRaw = cfg.get('cdpPorts', '9223,9225');
  const cdpPorts = cdpPortsRaw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(Number.isFinite);

  return {
    cdpPorts,
    relayUrl:     cfg.get('relayUrl', 'ws://localhost:3500/proxy-ws'),
    proxySecret:  cfg.get('proxySecret', ''),
    machineLabel: cfg.get('machineLabel', '') || os.hostname(),
    autoStart:    cfg.get('autoStart', true),
  };
}

// ─── Status bar ─────────────────────────────────────────────────────────────

function updateStatusBar() {
  if (!statusBarItem) return;

  if (!isLeader) {
    statusBarItem.text = '$(eye) Proxy (standby)';
    statusBarItem.tooltip = 'Another Antigravity window is running the proxy. This window will take over if the leader closes.';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (!engine) {
    statusBarItem.text = '$(circle-slash) Proxy Off';
    statusBarItem.tooltip = 'Remote Agent Proxy is stopped (this window is leader)';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  const sessionCount = engine.getSessionCount();
  const relayUp      = engine.isRelayConnected();

  if (!relayUp) {
    statusBarItem.text = '$(debug-disconnect) Proxy (no relay)';
    statusBarItem.tooltip = 'Proxy running but relay not connected';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (sessionCount === 0) {
    statusBarItem.text = '$(search) Proxy (discovering)';
    statusBarItem.tooltip = 'Relay connected, discovering agent sessions...';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = `$(broadcast) Proxy (${sessionCount})`;
    statusBarItem.tooltip = `Relay connected, ${sessionCount} session(s) active`;
    statusBarItem.backgroundColor = undefined;
  }
}

// ─── Proxy lifecycle ────────────────────────────────────────────────────────

async function startProxy() {
  if (engine) {
    vscode.window.showInformationMessage('Remote Agent Proxy is already running.');
    return;
  }

  if (!isLeader) {
    vscode.window.showWarningMessage('This window is in standby mode. The proxy is running in another Antigravity window.');
    return;
  }

  const config = getConfig();

  if (!config.relayUrl) {
    vscode.window.showErrorMessage('Remote Agent Proxy: relayUrl is not configured. Set remoteAgentProxy.relayUrl in settings.');
    return;
  }

  const { ProxyEngine } = require('../proxy-engine');

  engine = new ProxyEngine({
    cdpPorts:     config.cdpPorts,
    relayUrl:     config.relayUrl,
    proxySecret:  config.proxySecret || null,
    machineLabel: config.machineLabel,
    uploadDir:    path.join(os.tmpdir(), 'remote-agent-proxy-uploads'),
  });

  // Route logs to VS Code output channel
  engine.on('log', (level, msg) => {
    if (outputChannel) outputChannel.appendLine(msg);
  });

  // Periodic status bar updates
  const statusInterval = setInterval(updateStatusBar, 3000);
  engine._statusInterval = statusInterval;

  try {
    await engine.start();
    updateStatusBar();
    outputChannel?.appendLine('[proxy] Proxy started as leader');
  } catch (err) {
    outputChannel?.appendLine(`[proxy] Fatal: ${err.message}`);
    vscode.window.showErrorMessage(`Remote Agent Proxy failed to start: ${err.message}`);
    engine = null;
    clearInterval(statusInterval);
    updateStatusBar();
  }
}

function stopProxy() {
  if (!engine) {
    vscode.window.showInformationMessage('Remote Agent Proxy is not running.');
    return;
  }

  if (engine._statusInterval) clearInterval(engine._statusInterval);
  engine.stop();
  engine = null;
  updateStatusBar();
  vscode.window.showInformationMessage('Remote Agent Proxy stopped.');
}

function restartProxy() {
  stopProxy();
  // Invalidate cached proxy-engine module and its dependencies so code changes are picked up
  const enginePath = require.resolve('../proxy-engine');
  delete require.cache[enginePath];
  // Also invalidate selectors.js, protocol.js, session-store.js, launchers.js
  const deps = ['../selectors', '../protocol', '../session-store', '../launchers'];
  for (const dep of deps) {
    try { delete require.cache[require.resolve(dep)]; } catch {}
  }
  startProxy();
}

// ─── Extension lifecycle ────────────────────────────────────────────────────

function activate(context) {
  // Output channel for proxy logs
  outputChannel = vscode.window.createOutputChannel('Remote Agent Proxy');
  context.subscriptions.push(outputChannel);

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'remoteAgentProxy.toggleMenu';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteAgentProxy.start', startProxy),
    vscode.commands.registerCommand('remoteAgentProxy.stop', stopProxy),
    vscode.commands.registerCommand('remoteAgentProxy.restart', restartProxy),
    vscode.commands.registerCommand('remoteAgentProxy.showLogs', () => {
      outputChannel?.show();
    }),
    vscode.commands.registerCommand('remoteAgentProxy.toggleMenu', async () => {
      const running = !!engine;
      const items = [];

      if (!isLeader) {
        items.push(
          { label: '$(eye) Standby — another window is leader', command: '' },
          { label: '$(output) Show Logs', command: 'remoteAgentProxy.showLogs' },
        );
      } else if (running) {
        items.push(
          { label: '$(debug-stop) Stop Proxy',       command: 'remoteAgentProxy.stop' },
          { label: '$(debug-restart) Restart Proxy',  command: 'remoteAgentProxy.restart' },
          { label: '$(output) Show Logs',             command: 'remoteAgentProxy.showLogs' },
        );
      } else {
        items.push(
          { label: '$(play) Start Proxy',  command: 'remoteAgentProxy.start' },
          { label: '$(output) Show Logs',  command: 'remoteAgentProxy.showLogs' },
        );
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: !isLeader
          ? 'Proxy standby (another window is leader)'
          : running
            ? `Proxy running (${engine.getSessionCount()} sessions)`
            : 'Proxy stopped (this window is leader)',
      });
      if (picked && picked.command) vscode.commands.executeCommand(picked.command);
    })
  );

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('remoteAgentProxy') && engine) {
        vscode.window.showInformationMessage(
          'Remote Agent Proxy settings changed. Restart the proxy for changes to take effect.',
          'Restart'
        ).then(choice => {
          if (choice === 'Restart') restartProxy();
        });
      }
    })
  );

  // ── Leader election ────────────────────────────────────────────────────
  if (_tryAcquireLock()) {
    outputChannel.appendLine('[lock] Acquired leader lock');
    _becomeLeader();
  } else {
    const lock = _readLock();
    outputChannel.appendLine(`[lock] Another instance is leader (pid=${lock?.pid}) — entering standby`);
    updateStatusBar();
    _startStandbyPoll();
  }
}

function deactivate() {
  _stopStandbyPoll();

  if (isLeader) {
    _resignLeader();
  }
}

module.exports = { activate, deactivate };
