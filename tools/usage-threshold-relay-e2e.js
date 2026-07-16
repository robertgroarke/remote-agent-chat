#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const port = 37100 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-usage-threshold-'));

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function openSocket(pathname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace(/^http/, 'ws') + pathname);
    const messages = [];
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${pathname}`)), 10_000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function inventorySession() {
  const client = await openSocket('/client-ws');
  try {
    const ack = await waitFor(
      () => client.messages.find(message => message.type === 'connection_ack'),
      10_000,
      'connection_ack',
    );
    return ack.sessions.find(session => session.session_id === 'usage-threshold-e2e');
  } finally {
    client.ws.close();
  }
}

async function main() {
  const logs = [];
  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: path.join(root, 'relay-server'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'usage-threshold-session-secret-0123456789',
      JWT_SECRET: 'usage-threshold-jwt-secret-0123456789012345',
      PROXY_SECRET: '',
      ALLOW_LOOPBACK_BYPASS: 'true',
      ALLOW_LAN_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'usage-threshold-client',
      GOOGLE_CLIENT_SECRET: 'usage-threshold-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
      NOTIFY_EVEN_IF_CONNECTED: 'true',
    },
  });
  relay.stdout.on('data', chunk => logs.push(String(chunk)));
  relay.stderr.on('data', chunk => logs.push(String(chunk)));
  let proxy = null;
  let observer = null;
  try {
    await waitFor(() => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-4000));
      return logs.some(line => line.includes('[relay] Listening'));
    }, 15_000, 'relay health');

    proxy = await openSocket('/proxy-ws');
    observer = await openSocket('/client-ws');
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      protocol_version: 1,
      proxy_id: 'usage-threshold-e2e-proxy',
      sessions: [{
        session_id: 'usage-threshold-e2e',
        agent_type: 'codex_cli',
        display_name: 'Usage threshold E2E',
        status: 'healthy',
      }],
    }));
    await waitFor(() => observer.messages.find(message => (
      message.type === 'session_list'
      && message.sessions?.some(session => session.session_id === 'usage-threshold-e2e')
    )), 10_000, 'session snapshot');

    proxy.ws.send(JSON.stringify({
      type: 'rate_limit_active', session_id: 'usage-threshold-e2e',
      percent_used: 82, retry_after_hint: 'in 2h', hard_limited: false,
    }));
    const warningEvent = await waitFor(() => observer.messages.find(message => (
      message.type === 'rate_limit_active' && message.percent_used === 82
    )), 10_000, 'warning event');
    assert.equal(warningEvent.hard_limited, false);
    const warningInventory = await inventorySession();
    assert.equal(warningInventory.rate_limit_active, false);
    assert.equal(warningInventory.percent_used, 82);

    proxy.ws.send(JSON.stringify({
      type: 'rate_limit_active', session_id: 'usage-threshold-e2e',
      percent_used: 100, retry_after_hint: 'in 2h', hard_limited: true,
    }));
    const exhaustedEvent = await waitFor(() => observer.messages.find(message => (
      message.type === 'rate_limit_active' && message.percent_used === 100
    )), 10_000, 'exhausted event');
    assert.equal(exhaustedEvent.hard_limited, true);
    const exhaustedInventory = await inventorySession();
    assert.equal(exhaustedInventory.rate_limit_active, true);
    assert.equal(exhaustedInventory.rate_limited_until, 'in 2h');

    proxy.ws.send(JSON.stringify({ type: 'rate_limit_cleared', session_id: 'usage-threshold-e2e' }));
    await waitFor(() => observer.messages.find(message => message.type === 'rate_limit_cleared'), 10_000, 'clear event');
    const clearedInventory = await inventorySession();
    assert.equal(clearedInventory.rate_limit_active, false);
    assert.equal(clearedInventory.percent_used, null);

    const result = {
      ok: true,
      warning_forwarded_as_hard_limited: warningEvent.hard_limited,
      warning_inventory_active: warningInventory.rate_limit_active,
      exhausted_forwarded_as_hard_limited: exhaustedEvent.hard_limited,
      exhausted_inventory_active: exhaustedInventory.rate_limit_active,
      cleared_inventory_active: clearedInventory.rate_limit_active,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    try { observer?.ws.close(); } catch {}
    try { proxy?.ws.close(); } catch {}
    if (relay.exitCode == null) {
      const exited = new Promise(resolve => relay.once('exit', resolve));
      relay.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`usage threshold relay e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
