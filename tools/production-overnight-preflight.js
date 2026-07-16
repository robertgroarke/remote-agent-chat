#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const runner = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

function relayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = proxyEnv.RELAY_URL || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  let ws = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    .replace(/\/proxy-ws$/i, '/client-ws').replace(/\/+$/, '');
  if (!/\/client-ws$/i.test(ws)) ws += '/client-ws';
  return `${ws}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

async function main() {
  const ws = new WebSocket(relayWsUrl());
  try {
    const ack = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('production overnight preflight timed out')), 15_000);
      ws.once('error', reject);
      ws.on('message', data => {
        let message;
        try { message = JSON.parse(String(data)); } catch { return; }
        if (message.type !== 'connection_ack' || !Array.isArray(message.sessions)) return;
        clearTimeout(timer);
        resolve(message);
      });
    });
    const liveKinds = new Set(['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files']);
    const candidates = Object.fromEntries(runner.PRODUCTION_TYPES.map(type => [type, ack.sessions
      .filter(session => session && typeof session === 'object'
        && session.agent_type === type && runner.SAFE_SELECTORS[type](session))
      .map(session => ({
        session_id: session.session_id,
        workspace_path: session.workspace_path || null,
        title: session.session_title || session.chat_title || session.title || session.name || '',
        activity: session.activity?.kind || null,
        status: session.status || null,
        idle: !liveKinds.has(String(session.activity?.kind || '').toLowerCase()),
      }))]));
    let selected = null;
    let selectionError = null;
    try {
      selected = runner.selectSafeSessions(ack.sessions);
    } catch (error) {
      selectionError = error.message;
    }
    const result = {
      ok: !selectionError,
      read_only: true,
      session_count: ack.sessions.length,
      candidates,
      selected: selected ? Object.fromEntries(Object.entries(selected).map(([type, session]) => [type, {
        session_id: session.session_id,
        workspace_path: session.workspace_path || null,
        title: session.session_title || session.chat_title || session.title || session.name || '',
      }])) : {},
      error: selectionError,
      sends: 0,
      controls: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    if (selectionError) process.exitCode = 1;
  } finally {
    ws.close();
  }
}

main().catch(error => {
  console.error(`production overnight preflight: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
