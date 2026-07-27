// agent-proxy/index.js — Standalone entry point for the agent proxy
//
// Loads environment from .env, creates a ProxyEngine instance, and runs it.
// This is the entry point used by the Windows Scheduled Task (restart-proxy.bat).
//
// For the VS Code extension version, see vscode-ext/extension.js which
// wraps the same ProxyEngine class.

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { ProxyEngine } = require('./proxy-engine');

function parsePortCsv(value, label) {
  const tokens = String(value).split(',').map(token => token.trim());
  if (tokens.length === 0 || tokens.some(token => !/^\d+$/.test(token))) {
    throw new Error(`${label} must be a comma-separated list of numeric ports`);
  }
  const ports = tokens.map(Number);
  if (ports.some(port => !Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new Error(`${label} contains a port outside 1..65535`);
  }
  return [...new Set(ports)];
}

function resolveCodexDesktopCdpPorts(value, cdpPorts) {
  const ports = value == null
    ? (cdpPorts.includes(9225) ? [9225] : [])
    : (String(value).trim() ? parsePortCsv(value, 'CODEX_DESKTOP_CDP_PORTS') : []);
  for (const port of ports) {
    if (!cdpPorts.includes(port)) {
      throw new Error(`CODEX_DESKTOP_CDP_PORTS port ${port} is not present in CDP_PORTS`);
    }
  }
  return ports;
}

function createEngine(env = process.env) {
  const cdpPorts = parsePortCsv(
    env.CDP_PORTS || env.CDP_PORT || '9223,9228,9225,9226,9227',
    'CDP_PORTS',
  );
  return new ProxyEngine({
    cdpPorts,
    codexDesktopCdpPorts: resolveCodexDesktopCdpPorts(env.CODEX_DESKTOP_CDP_PORTS, cdpPorts),
    relayUrl:     env.RELAY_URL || 'ws://localhost:3500/proxy-ws',
    proxySecret:  env.PROXY_SECRET || null,
    machineLabel: env.MACHINE_LABEL || require('os').hostname(),
  });
}

function main() {
  const engine = createEngine();

  // Route engine logs to console (standalone mode)
  engine.on('log', (level, msg) => {
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else console.log(msg);
  });

  engine.start().catch(err => {
    console.error('[proxy] Fatal:', err);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = {
  parsePortCsv,
  resolveCodexDesktopCdpPorts,
  createEngine,
};
