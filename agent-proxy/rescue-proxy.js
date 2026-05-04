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
const http = require('http');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MAIN_RELAY_URL = process.env.RELAY_URL || '';

function defaultMainHealthUrl() {
  if (process.env.RELAY_IP) {
    return `http://${process.env.RELAY_IP}:${process.env.RELAY_PORT || '3500'}/healthz`;
  }
  if (MAIN_RELAY_URL) {
    try {
      const parsed = new URL(MAIN_RELAY_URL);
      const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${parsed.host}/healthz`;
    } catch {
      // Fall through to localhost.
    }
  }
  return `http://localhost:${process.env.RELAY_PORT || '3500'}/healthz`;
}

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

const MAIN_HEALTH_URL =
  process.env.MAIN_RELAY_HEALTH_URL ||
  defaultMainHealthUrl();

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(parsed, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function mainProxyAlreadyConnected() {
  if (process.env.RESCUE_ALLOW_WITH_MAIN === '1') return false;
  try {
    const health = await fetchJson(MAIN_HEALTH_URL);
    const proxySessions = Number(health?.connections?.proxy_sessions || 0);
    return health?.status === 'ok' && proxySessions > 0;
  } catch {
    return false;
  }
}

function startMainProxyWatchdog() {
  const timer = setInterval(async () => {
    try {
      if (await mainProxyAlreadyConnected()) {
        console.log(`[rescue-proxy] Main proxy is connected at ${MAIN_HEALTH_URL}; stopping rescue proxy.`);
        try { engine.stop(); } catch {}
        clearInterval(timer);
        setTimeout(() => process.exit(0), 500);
      }
    } catch {
      // Keep rescue alive while the main relay/proxy is unreachable.
    }
  }, 15000);
  if (typeof timer.unref === 'function') timer.unref();
}

engine.on('log', (level, msg) => {
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
});

async function main() {
  if (await mainProxyAlreadyConnected()) {
    console.log(`[rescue-proxy] Main proxy is already connected at ${MAIN_HEALTH_URL}; rescue proxy exiting.`);
    return;
  }

  console.log('');
  console.log('========================================');
  console.log('  RESCUE PROXY');
  console.log(`  Relay: ${process.env.RELAY_URL}`);
  console.log(`  CDP ports: ${CDP_PORTS.join(', ')}`);
  console.log('========================================');
  console.log('');

  await engine.start();
  startMainProxyWatchdog();
}

main().catch(err => {
  console.error('[rescue-proxy] Fatal:', err);
  process.exit(1);
});
