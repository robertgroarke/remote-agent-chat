#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

function externalHeaders(publicUrl, extra = {}) {
  return {
    Host: new URL(publicUrl).host,
    'X-Forwarded-For': '203.0.113.10',
    'X-Forwarded-Proto': 'https',
    ...extra,
  };
}

async function fetchText(url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, { cache: 'no-store', redirect: 'manual', ...options });
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    body: await response.text(),
    elapsedMs: Date.now() - startedAt,
  };
}

function verifyAndroidWebSocket(origin, token) {
  return new Promise((resolve, reject) => {
    const wsUrl = origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      + '/client-ws?token=' + encodeURIComponent(token);
    const startedAt = Date.now();
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('Android-style bearer WebSocket timed out'));
    }, 15000);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    ws.once('error', error => finish(error));
    ws.on('message', data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      const hasInitialSessions = message.type === 'connection_ack' && Array.isArray(message.sessions);
      if (hasInitialSessions || message.type === 'session_list' || message.type === 'proxy_session_snapshot') {
        const providerSnapshots = Array.isArray(message.provider_usage?.snapshots)
          ? message.provider_usage.snapshots
          : [];
        finish(null, {
          elapsed_ms: Date.now() - startedAt,
          first_message_type: message.type,
          session_count: Array.isArray(message.sessions) ? message.sessions.length : null,
          duplicate_proxy_alarms: Array.isArray(message.duplicate_proxy_alarms)
            ? message.duplicate_proxy_alarms.length : 0,
          provider_usage: providerSnapshots.map(snapshot => ({
            provider_id: snapshot.provider_id,
            status: snapshot.status,
            source: snapshot.source,
            window_count: Array.isArray(snapshot.windows) ? snapshot.windows.length : 0,
            request_count: Number(snapshot.request_count) || 0,
          })).sort((left, right) => String(left.provider_id).localeCompare(String(right.provider_id))),
        });
      }
    });
  });
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(publicUrl, 'relay-server/.env PUBLIC_URL is required');
  assert(relayIp, '.env RELAY_IP is required');
  const origin = `http://${relayIp}:${relayPort}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built');

  const unauthenticated = await fetchText(origin + '/', {
    headers: externalHeaders(publicUrl),
  });
  assert.equal(unauthenticated.status, 302, 'unauthenticated app shell must redirect');
  assert.equal(unauthenticated.location, '/auth/google', 'unauthenticated app shell must enter Google OAuth');
  assert(!unauthenticated.body.includes('"error":"unauthorized"'), 'app shell returned API-style unauthorized JSON');

  const health = await fetchText(origin + '/healthz', {
    headers: externalHeaders(publicUrl),
  });
  assert.equal(health.status, 200, '/healthz must remain public and healthy');
  const healthBody = JSON.parse(health.body);
  assert.equal(healthBody.status, 'ok', '/healthz payload is not ok');

  const authenticated = await fetchText(origin + '/', {
    headers: externalHeaders(publicUrl, { Authorization: 'Bearer ' + token }),
  });
  assert.equal(authenticated.status, 200, 'authenticated bearer app shell must load');
  assert(authenticated.body.includes('id="root"'), 'authenticated app shell is missing the root mount');

  const invalidHistoryLimit = await fetchText(origin + '/api/sessions/security-audit/messages?limit=-1', {
    headers: externalHeaders(publicUrl, { Authorization: 'Bearer ' + token }),
  });
  assert.equal(invalidHistoryLimit.status, 400, 'explicit negative history limit must fail closed');

  const android = await verifyAndroidWebSocket(origin, token);
  const result = {
    ok: true,
    public_origin: new URL(publicUrl).origin,
    relay_origin: new URL(origin).origin,
    unauthenticated: {
      status: unauthenticated.status,
      location: unauthenticated.location,
      elapsed_ms: unauthenticated.elapsedMs,
    },
    authenticated: {
      status: authenticated.status,
      elapsed_ms: authenticated.elapsedMs,
      app_root: true,
    },
    healthz: {
      status: health.status,
      elapsed_ms: health.elapsedMs,
      relay_status: healthBody.status,
    },
    history_input_guard: {
      negative_limit_status: invalidHistoryLimit.status,
    },
    android_websocket: android,
    generated_at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error('production auth smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
