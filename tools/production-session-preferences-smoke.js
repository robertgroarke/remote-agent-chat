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

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const sessionId = `preference-smoke-${Date.now()}`;
  const secondSessionId = `${sessionId}-second`;
  const collectionUrl = `${origin}/api/preferences/sessions`;
  const itemUrl = `${collectionUrl}/${encodeURIComponent(sessionId)}`;
  const secondItemUrl = `${collectionUrl}/${encodeURIComponent(secondSessionId)}`;
  assert(token, 'JWT bearer token could not be built');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { cache: 'no-store', ...options, headers: { ...headers, ...(options.headers || {}) } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  const anonymous = await fetch(collectionUrl, { cache: 'no-store' });
  assert.equal(anonymous.status, 401);
  try {
    const create = await request(itemUrl, {
      method: 'PUT',
      body: JSON.stringify({ preference: { display_name: 'Smoke session', archived: true, muted: true, pinned: true } }),
    });
    assert.equal(create.status, 200);
    assert.deepEqual({ ...create.body.preference, pin_order: 0 }, {
      display_name: 'Smoke session', archived: true, muted: true, pinned: true, pin_order: 0,
    });
    assert(create.body.preference.pin_order > 0, 'first pinned session must receive a positive order');

    const createSecond = await request(secondItemUrl, {
      method: 'PUT',
      body: JSON.stringify({ preference: { display_name: 'Second smoke session', pinned: true } }),
    });
    assert.equal(createSecond.status, 200);
    assert(createSecond.body.preference.pin_order > create.body.preference.pin_order,
      'later explicit pin must append after the existing pin order');

    const partial = await request(itemUrl, {
      method: 'PUT',
      body: JSON.stringify({ preference: { archived: false } }),
    });
    assert.equal(partial.status, 200);
    assert.deepEqual(partial.body.preference, {
      display_name: 'Smoke session', archived: false, muted: true,
      pinned: true, pin_order: create.body.preference.pin_order,
    });

    const readBack = await request(collectionUrl);
    assert.equal(readBack.status, 200);
    assert.deepEqual(readBack.body.preferences[sessionId], partial.body.preference);
    assert.deepEqual(readBack.body.preferences[secondSessionId], createSecond.body.preference);

    const unpin = await request(itemUrl, {
      method: 'PUT', body: JSON.stringify({ preference: { pinned: false } }),
    });
    assert.equal(unpin.status, 200);
    assert.strictEqual(unpin.body.preference.pinned, false);
    assert.strictEqual(unpin.body.preference.pin_order, 0);

    const repin = await request(itemUrl, {
      method: 'PUT', body: JSON.stringify({ preference: { pinned: true } }),
    });
    assert.equal(repin.status, 200);
    assert(repin.body.preference.pin_order > createSecond.body.preference.pin_order,
      'repinned session must append without renumbering existing pins');
  } finally {
    const reset = await request(itemUrl, { method: 'DELETE' });
    assert.equal(reset.status, 200, 'smoke preference must be removed');
    const resetSecond = await request(secondItemUrl, { method: 'DELETE' });
    assert.equal(resetSecond.status, 200, 'second smoke preference must be removed');
  }

  const after = await request(collectionUrl);
  assert.equal(after.body.preferences[sessionId], undefined, 'reset preference must stay deleted');
  assert.equal(after.body.preferences[secondSessionId], undefined, 'second reset preference must stay deleted');
  const result = {
    ok: true,
    anonymous_status: anonymous.status,
    bearer_get_put_delete: true,
    partial_update_preserved_fields: true,
    pin_order_appends_and_persists: true,
    unpin_and_repin_order_verified: true,
    reset_verified: true,
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
  console.error('production session preferences smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
