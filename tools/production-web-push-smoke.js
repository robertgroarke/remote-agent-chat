#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp, '.env RELAY_IP is required');
  assert(token, 'JWT bearer token could not be built');
  const base = `http://${relayIp}:${relayPort}`;

  const anonymous = await request(`${base}/api/push/web-config`, '');
  assert.equal(anonymous.status, 401, 'Web Push config must reject anonymous requests');
  const config = await request(`${base}/api/push/web-config`, token);
  assert.equal(config.status, 200, 'bearer Web Push config must succeed');
  assert.equal(config.body.enabled, true);
  assert.equal(typeof config.body.public_key, 'string');
  assert(config.body.public_key.length > 40, 'VAPID public key is missing or malformed');
  const configAgain = await request(`${base}/api/push/web-config`, token);
  assert.equal(configAgain.body.public_key, config.body.public_key, 'VAPID public key must be stable');

  const endpoint = `https://push.invalid/rac-smoke-${Date.now()}`;
  const subscription = {
    endpoint,
    keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
  };
  const malformed = await request(`${base}/api/push/web-subscription`, token, {
    method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'https://push.invalid', keys: { p256dh: 'short', auth: 'short' } } }),
  });
  assert.equal(malformed.status, 400, 'malformed Web Push keys must be rejected');
  try {
    const registered = await request(`${base}/api/push/web-subscription`, token, {
      method: 'POST', body: JSON.stringify({ subscription }),
    });
    assert.equal(registered.status, 200, 'bearer Web Push registration must succeed');
    assert.equal(registered.body.ok, true);
  } finally {
    const removed = await request(`${base}/api/push/web-subscription`, token, {
      method: 'DELETE', body: JSON.stringify({ endpoint }),
    });
    assert.equal(removed.status, 200, 'Web Push smoke subscription cleanup must succeed');
  }

  const result = {
    ok: true,
    anonymous_status: anonymous.status,
    config_status: config.status,
    vapid_public_key_stable: true,
    subscription_register_status: 200,
    malformed_subscription_status: malformed.status,
    subscription_removed: true,
    generated_at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`production Web Push smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
