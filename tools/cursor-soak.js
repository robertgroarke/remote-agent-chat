#!/usr/bin/env node
'use strict';
// Long-running throwaway session poll/soak. Run in background during Phase 2.
// Usage: node tools/cursor-soak.js [--minutes 30] [--interval-ms 15000]

const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const fidelity = require('./run-fidelity-regression');

const CDP_PORT = 9227;
const SESSION_ID = guard.THROWAWAY_SESSION_ID;

function parseArgs(argv) {
  const opts = { minutes: 20, intervalMs: 15000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--minutes' && argv[i + 1]) opts.minutes = Math.max(1, parseInt(argv[++i], 10));
    else if (argv[i] === '--interval-ms' && argv[i + 1]) opts.intervalMs = Math.max(5000, parseInt(argv[++i], 10));
  }
  return opts;
}

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

async function openRelay(url) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws timeout')), 30000);
    ws.once('open', () => { clearTimeout(t); ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-soak' })); resolve(); });
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + opts.minutes * 60 * 1000;
  const logPath = path.join(__dirname, '..', 'agent-proxy', 'cursor-soak.log');
  const fs = require('fs');
  const log = (msg) => {
    const line = `${new Date().toISOString()} ${msg}\n`;
    fs.appendFileSync(logPath, line);
    console.log(msg);
  };

  log(`soak start session=${SESSION_ID} minutes=${opts.minutes}`);
  const { ws, messages } = await openRelay(deriveRelayWsUrl());
  let errors = 0;
  let ticks = 0;

  const waitRelaySessions = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (messages.some((m) =>
        (m.type === 'connection_ack' || m.type === 'session_list' || m.type === 'session_snapshot')
        && Array.isArray(m.sessions)
      )) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
  await waitRelaySessions();

  try {
    while (Date.now() < deadline) {
      ticks += 1;
      try {
        const targets = await CDP.List({ port: CDP_PORT });
        const { page, blocked } = guard.pickProbePage(targets);
        if (blocked || !page) throw new Error(blocked);
        const client = await CDP({ port: CDP_PORT, target: page.id });
        const msgs = JSON.parse(await cursorSel.readCursorMessages(client.Runtime) || '[]');
        const thinking = await cursorSel.detectCursorThinking(client.Runtime);
        await client.close();
        const sessionOk = messages.some((m) =>
          (m.type === 'connection_ack' || m.type === 'session_list' || m.type === 'session_snapshot')
          && Array.isArray(m.sessions)
          && m.sessions.some((s) => (s.session_id || s) === SESSION_ID)
        );
        log(`tick ${ticks} msgs=${msgs.length} thinking=${thinking.thinking} relay=${sessionOk}`);
      } catch (e) {
        errors += 1;
        log(`tick ${ticks} ERROR ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
  } finally {
    try { ws.close(); } catch {}
  }
  log(`soak done ticks=${ticks} errors=${errors}`);
  process.exit(errors > ticks / 2 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
