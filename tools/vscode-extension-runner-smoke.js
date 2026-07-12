#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'vscode-probe-guard'));
const {
  attachNativeDisconnectState,
  assertNativeConnected,
} = require('./vscode-extension-production-e2e');

function main() {
  const settingsPath = guard.assertUpdatesDisabled('runner smoke');
  const client = new EventEmitter();
  client.Runtime = {};
  const state = attachNativeDisconnectState(client, 'codex', 'fixture-target');
  assert.strictEqual(state.disconnected, false);

  client.emit('disconnect');
  assert.strictEqual(state.disconnected, true);
  assert.strictEqual(client.Runtime._suppressReadErrors, true);

  const native = { client, connectionState: state, frame: { id: 'fixture-target' } };
  assert.throws(
    () => assertNativeConnected(native, 'codex', 'fixture read'),
    error => error?.fatal === true
      && error?.retryable === true
      && error?.code === 'native_cdp_disconnected'
      && error?.targetId === 'fixture-target',
  );

  console.log(JSON.stringify({
    ok: true,
    settings_path: settingsPath,
    failure_class: 'native_cdp_disconnected',
    retryable: true,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
