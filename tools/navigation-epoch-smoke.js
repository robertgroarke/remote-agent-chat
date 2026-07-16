#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.join(__dirname, '..');
const {
  NavigationEpochRegistry,
  evaluateNavigationMessage,
  navigationSessionId,
  normalizeNavigationEpoch,
} = require('../relay-server/navigation-epoch');

function loadFrontendGate() {
  const source = fs.readFileSync(path.join(ROOT, 'frontend', 'navigation-epoch.js'), 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js',
    format: 'cjs',
    target: 'es2020',
  });
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports) {${transformed.code}\n})(module, module.exports);`, {
    module,
  }, { filename: 'frontend/navigation-epoch.js' });
  return module.exports;
}

let now = 1_000;
const registry = new NavigationEpochRegistry({ maxEntries: 2, now: () => now });
const first = registry.issue('session-a');
const second = registry.issue('session-a');
assert.strictEqual(first, 1_000_000);
assert.strictEqual(second, first + 1, 'same-millisecond epochs must still be monotonic');
assert.strictEqual(registry.observe('session-a', first).accepted, false, 'older epoch was accepted');
assert.strictEqual(registry.observe('session-a', second).accepted, true, 'current epoch was rejected');
assert.strictEqual(registry.observe('session-a', second + 10).accepted, true, 'future proxy epoch was rejected');
assert.strictEqual(registry.latest('session-a'), second + 10);

const staleHistory = evaluateNavigationMessage(registry, {
  type: 'history_snapshot',
  session_id: 'session-a',
  navigation_epoch: second,
});
assert.strictEqual(staleHistory.accepted, false, 'relay accepted a stale transcript payload');
const staleResult = evaluateNavigationMessage(registry, {
  type: 'agent_control_result',
  session_id: 'session-a',
  request_id: 'request-old',
  command: 'switch_chat',
  result: 'ok',
  navigation_epoch: second,
});
assert.strictEqual(staleResult.accepted, true, 'relay failed to route a terminal stale control receipt');
assert.strictEqual(staleResult.message.result, 'failed');
assert.strictEqual(staleResult.message.error.code, 'operation_superseded');
assert.strictEqual(staleResult.message.navigation_epoch, second + 10);
assert.strictEqual(staleResult.message.superseded_navigation_epoch, second);

now += 1;
registry.issue('session-b');
registry.issue('session-c');
assert.strictEqual(registry.size, 2, 'relay epoch registry exceeded its hard bound');
assert.strictEqual(registry.latest('session-a'), 0, 'oldest relay epoch entry was not pruned');

assert.strictEqual(normalizeNavigationEpoch(Number.MAX_SAFE_INTEGER + 1), 0);
assert.strictEqual(normalizeNavigationEpoch(-1), 0);
assert.strictEqual(navigationSessionId({ navigation_session_id: 'barrier', session_id: 'payload' }), 'barrier');
assert.strictEqual(navigationSessionId({ session: 'legacy' }), 'legacy');

const { createNavigationEpochGate } = loadFrontendGate();
const browserGate = createNavigationEpochGate({ maxEntries: 2 });
assert.strictEqual(browserGate.accept({
  type: 'navigation_started',
  session_id: 'session-a',
  navigation_epoch: 200,
}), true);
assert.strictEqual(browserGate.accept({
  type: 'history_snapshot',
  session_id: 'session-a',
  navigation_epoch: 199,
}), false, 'browser accepted a stale transcript');
assert.strictEqual(browserGate.accept({
  type: 'history_snapshot',
  session_id: 'session-a',
  navigation_epoch: 200,
}), true);
assert.strictEqual(browserGate.accept({ type: 'history_snapshot', session_id: 'legacy' }), true);
browserGate.accept({ session_id: 'session-b', navigation_epoch: 201 });
browserGate.accept({ session_id: 'session-c', navigation_epoch: 202 });
assert.strictEqual(browserGate.size, 2, 'browser epoch registry exceeded its hard bound');
assert.strictEqual(browserGate.latest('session-a'), 0, 'oldest browser epoch entry was not pruned');

const relaySource = fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8');
const hooksSource = fs.readFileSync(path.join(ROOT, 'frontend', 'hooks.jsx'), 'utf8');
assert.match(relaySource, /type:\s*'navigation_started'/, 'relay does not publish the pre-navigation epoch barrier');
assert.match(relaySource, /evaluateNavigationMessage\(navigationEpochs, msg\)/, 'relay does not reject stale proxy output');
assert.match(hooksSource, /navigationEpochGate\.current\.accept\(msg\)/, 'WebUI does not enforce navigation epochs');

console.log('PASS navigation epochs are monotonic, stale-safe, and bounded end to end');
