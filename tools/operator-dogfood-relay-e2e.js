#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* assertion owns invalid JSON */ }
        resolve({ status: response.statusCode, json, text });
      });
    });
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, 'GET', '/healthz');
      if (response.status === 200 && response.json?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/client-ws`, { origin: `http://127.0.0.1:${port}` });
    const messages = [];
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === 'connection_ack') resolve({ ws, messages, ack: message });
    });
    ws.once('error', reject);
  });
}

async function waitForMessage(messages, predicate) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for relay event; received ${messages.map(item => item.type).join(',')}`);
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

function validation(runId, status, health) {
  return {
    schema_version: 1,
    kind: 'operator_dogfood',
    harness: 'operator-dogfood',
    status,
    app_version: 'a'.repeat(64),
    validator: 'tools/operator-dogfood.js',
    run_id: runId,
    duration_ms: 120_000,
    exit_code: status === 'pass' ? 0 : 1,
    detail: `isolated operator dogfood ${status}`,
    completed_at: new Date().toISOString(),
    program_health: health,
  };
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-operator-dogfood-relay-'));
  const output = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'x'.repeat(32),
      GOOGLE_CLIENT_ID: 'operator-dogfood-relay-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'y'.repeat(32),
      PROXY_SECRET: 'operator-dogfood-relay-e2e-proxy-secret',
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  let first;
  let restored;
  try {
    await waitForHealth(port);
    first = await connectClient(port);
    assert.strictEqual(first.ack.operator_dogfood_health, undefined);

    const failHealth = {
      schema_version: 1,
      status: 'FAIL',
      latest: {
        run_id: 'dogfood-relay-fail', mode: 'canary', status: 'FAIL',
        trigger_source: 'scheduled_task', source_commit: 'b'.repeat(40),
        source_bundle_sha256: 'a'.repeat(64), served_asset_identity: 'build-fixture',
        duration_ms: 120_000, scenario_count: 1, refresh_count: 211,
        dropped_samples: 0, next_due_at: new Date(Date.now() + 1_800_000).toISOString(),
        scheduler_last_result: 'FAIL',
      },
      open_fingerprints: ['temporal_scroll_oscillation:fixture'],
    };
    const failed = await requestJson(port, 'PUT', '/api/maintenance/validation', {
      validation: validation('dogfood-relay-fail', 'fail', failHealth),
    });
    assert.strictEqual(failed.status, 200, failed.text);
    const failEvent = await waitForMessage(first.messages, message => message.type === 'operator_dogfood_status');
    assert.deepStrictEqual(failEvent.program_health, failHealth);

    const readback = await requestJson(port, 'GET', '/api/maintenance/validation');
    assert.strictEqual(readback.status, 200, readback.text);
    assert.deepStrictEqual(readback.json.operator_dogfood_health, failHealth);

    await closeSocket(first.ws);
    first = null;
    restored = await connectClient(port);
    assert.deepStrictEqual(restored.ack.operator_dogfood_health, failHealth);

    const passHealth = {
      ...failHealth,
      status: 'PASS',
      latest: { ...failHealth.latest, run_id: 'dogfood-relay-pass', status: 'PASS', scheduler_last_result: 'PASS' },
      open_fingerprints: [],
    };
    const passed = await requestJson(port, 'PUT', '/api/maintenance/validation', {
      validation: validation('dogfood-relay-pass', 'pass', passHealth),
    });
    assert.strictEqual(passed.status, 200, passed.text);
    const passEvent = await waitForMessage(restored.messages, message => (
      message.type === 'operator_dogfood_status' && message.program_health?.latest?.run_id === 'dogfood-relay-pass'
    ));
    assert.deepStrictEqual(passEvent.program_health, passHealth);

    process.stdout.write(`${JSON.stringify({
      status: 'PASS', live_failure_broadcast: true, persisted_readback: true,
      reconnect_restoration: true, live_recovery_broadcast: true,
      visible_windows: 0, focus_actions: 0, production_mutations: 0,
    }, null, 2)}\n`);
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await closeSocket(first?.ws);
    await closeSocket(restored?.ws);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-operator-dogfood-relay-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
