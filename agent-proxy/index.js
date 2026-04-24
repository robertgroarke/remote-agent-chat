// agent-proxy/index.js — Standalone entry point for the agent proxy
//
// Loads environment from .env, creates a ProxyEngine instance, and runs it.
// This is the entry point used by the Windows Scheduled Task (restart-proxy.bat).
//
// For the VS Code extension version, see vscode-ext/extension.js which
// wraps the same ProxyEngine class.

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { ProxyEngine } = require('./proxy-engine');

const CDP_PORTS = (process.env.CDP_PORTS || process.env.CDP_PORT || '9223,9222')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(Number.isFinite);

const engine = new ProxyEngine({
  cdpPorts:     CDP_PORTS,
  relayUrl:     process.env.RELAY_URL || 'ws://localhost:3500/proxy-ws',
  proxySecret:  process.env.PROXY_SECRET || null,
  machineLabel: process.env.MACHINE_LABEL || require('os').hostname(),
});

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
