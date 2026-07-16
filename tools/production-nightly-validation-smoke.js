#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;

function waitForMessage(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('Timed out waiting for validation event')), timeoutMs);
    const onMessage = data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (predicate(message)) cleanup(null, message);
    };
    const onError = error => cleanup(error);
    const cleanup = (error, message) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(message);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function request(origin, token, method, body) {
  const response = await fetch(`${origin}/api/maintenance/validation`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json().catch(() => ({}));
  assert(response.ok, value.error || `HTTP ${response.status}`);
  return value;
}

async function openClient(origin, token) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/client-ws?token=' + encodeURIComponent(token));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const ack = await waitForMessage(ws, message => message.type === 'connection_ack');
  return { ws, ack };
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(deployEnv.RELAY_IP, '.env RELAY_IP is required');
  assert(token, 'JWT bearer token could not be built');

  const runId = `validation-smoke-${Date.now()}`;
  const failure = {
    harness: 'cursor', status: 'fail', app_version: '3.5.33-smoke',
    validator: 'tools/production-nightly-validation-smoke.js', run_id: runId,
    duration_ms: 42, exit_code: 1, detail: 'intentional visible-warning smoke',
    completed_at: new Date().toISOString(),
  };
  const pass = {
    ...failure, status: 'pass', app_version: '3.5.33', exit_code: 0,
    detail: 'production alert lifecycle smoke restored passing status',
    completed_at: new Date(Date.now() + 1).toISOString(),
  };

  const first = await openClient(origin, token);
  let second;
  try {
    const failureEventPromise = waitForMessage(first.ws, message =>
      message.type === 'nightly_validation_status'
      && message.failures?.some(item => item.harness === 'cursor' && item.run_id === runId));
    const failed = await request(origin, token, 'PUT', { validation: failure });
    assert(failed.failures.some(item => item.harness === 'cursor'));
    await failureEventPromise;

    second = await openClient(origin, token);
    assert(second.ack.nightly_validation_failures?.some(item => item.harness === 'cursor' && item.run_id === runId),
      'connection_ack did not restore the validation warning');

    const clearEventPromise = waitForMessage(first.ws, message =>
      message.type === 'nightly_validation_status'
      && !message.failures?.some(item => item.harness === 'cursor'));
    const restored = await request(origin, token, 'PUT', { validation: pass });
    assert(!restored.failures.some(item => item.harness === 'cursor'));
    await clearEventPromise;

    const latest = await request(origin, token, 'GET');
    const cursor = latest.validations.find(item => item.harness === 'cursor');
    assert.equal(cursor.status, 'pass');
    assert.equal(cursor.app_version, '3.5.33');
  } finally {
    first.ws.close();
    second?.ws.close();
  }

  const result = {
    ok: true,
    authenticated_get_put: true,
    failure_broadcast: true,
    reconnect_warning_restore: true,
    passing_result_clears_warning: true,
    final_status: 'pass',
    run_id: runId,
    generated_at: new Date().toISOString(),
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
