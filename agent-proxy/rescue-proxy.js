'use strict';

// Rescue proxy entry point — connects to the rescue relay (port 3501) instead
// of the main relay. Used as a safety net when the main proxy (VSIX) is down.
//
// This proxy discovers the same CDP targets as the VSIX proxy but sends
// messages through the rescue relay. It should only be run when the VSIX
// proxy is offline (e.g. during an IDE reload) to avoid two engines
// fighting over the same CDP targets.
//
// Set RESCUE_RELAY_URL in your environment to override the relay endpoint.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Override relay URL BEFORE ProxyEngine reads it
process.env.RELAY_URL     = process.env.RESCUE_RELAY_URL || `ws://${process.env.RELAY_IP || 'localhost'}:3501/proxy-ws`;
process.env.MACHINE_LABEL = (process.env.MACHINE_LABEL || require('os').hostname()) + '-rescue';

const { ProxyEngine } = require('./proxy-engine');

const CDP_PORTS = (process.env.CDP_PORTS || process.env.CDP_PORT || '9223')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(Number.isFinite);

const engine = new ProxyEngine({
  cdpPorts:     CDP_PORTS,
  relayUrl:     process.env.RELAY_URL,
  proxySecret:  null,  // rescue relay doesn't require auth
  machineLabel: process.env.MACHINE_LABEL,
});

engine.on('log', (level, msg) => {
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
});

console.log('');
console.log('========================================');
console.log('  RESCUE PROXY');
console.log(`  Relay: ${process.env.RELAY_URL}`);
console.log(`  CDP ports: ${CDP_PORTS.join(', ')}`);
console.log('========================================');
console.log('');

engine.start().catch(err => {
  console.error('[rescue-proxy] Fatal:', err);
  process.exit(1);
});
