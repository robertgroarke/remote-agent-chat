#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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

  const url = `http://${relayIp}:${relayPort}/api/preferences/notifications`;
  const unauthorizedResponse = await fetch(url, { cache: 'no-store' });
  assert.equal(unauthorizedResponse.status, 401, 'preference API must reject anonymous requests');

  const before = await request(url, token);
  assert.equal(before.status, 200, 'bearer GET must succeed');
  const categories = [
    'permission_required', 'turn_ready', 'goal_completed', 'goal_attention',
    'agent_error', 'session_offline', 'rate_limit_cleared',
    'completion_sound', 'completion_haptic',
  ];
  for (const category of categories) {
    assert.equal(typeof before.body.preferences?.[category], 'boolean', `${category} must be boolean`);
  }
  assert.equal(before.body.preferences.turn_ready, false,
    'turn_ready must be forced off while no harness has authoritative terminal support');

  const mutableCategories = categories.filter(category => category !== 'turn_ready');
  const toggled = {
    ...before.body.preferences,
    ...Object.fromEntries(
      mutableCategories.map(category => [category, !before.body.preferences[category]])
    ),
    turn_ready: true,
  };
  const expected = { ...toggled, turn_ready: false };
  let restored = false;
  try {
    const update = await request(url, token, {
      method: 'PUT',
      body: JSON.stringify({ preferences: toggled }),
    });
    assert.equal(update.status, 200, 'bearer PUT must succeed');
    assert.deepEqual(update.body.preferences, expected,
      'PUT must retain mutable categories and reject turn_ready opt-in');

    const readBack = await request(url, token);
    assert.equal(readBack.status, 200, 'bearer read-back must succeed');
    assert.deepEqual(readBack.body.preferences, expected,
      'relay must persist mutable categories without enabling turn_ready');
  } finally {
    const restore = await request(url, token, {
      method: 'PUT',
      body: JSON.stringify({ preferences: before.body.preferences }),
    });
    restored = restore.status === 200 &&
      JSON.stringify(restore.body.preferences) === JSON.stringify(before.body.preferences);
  }
  assert(restored, 'original notification preferences must be restored');

  const result = {
    ok: true,
    anonymous_status: unauthorizedResponse.status,
    bearer_get_status: before.status,
    bearer_put_status: 200,
    persisted_categories: categories,
    original_preferences: before.body.preferences,
    original_preferences_restored: true,
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
  console.error('production notification preferences smoke: FAIL (' +
    (error.stack || error.message || error) + ')');
  process.exit(1);
});
