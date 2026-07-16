#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const hooks = read('frontend/hooks.jsx');

assert.match(hooks, /const configControlStatesRef = useRef\(\{\}\);/,
  'request-correlated config transactions must survive React renders');
assert.match(hooks, /previousValue: current\[configKey\], requestedValue,/,
  'config transactions must retain both rollback and requested values');
assert.match(hooks, /\(\) => rollbackConfigControl\(key, 'Timed out waiting for the agent to confirm this setting\.'\)/,
  'config transactions must arm the bounded rollback timeout');
assert.match(hooks, /\[transaction\.sessionId\]: \{ \.\.\.\(prev\[transaction\.sessionId\] \|\| \{\}\), \[transaction\.configKey\]: transaction\.previousValue \}/,
  'failed config transactions must restore the prior value');
assert.match(hooks, /const next = \{ \.\.\.existing, \.\.\.msg \};/,
  'authoritative agent_config must merge into the existing config');
assert.match(hooks, /next\.available_models = existing\.available_models;/,
  'a transition config must not erase the verified native model catalog');
assert.match(hooks, /next\[transaction\.configKey\] = transaction\.requestedValue;/,
  'in-flight config transactions must retain their optimistic value until confirmation');

for (const asset of ['hooks.jsx', 'index.html', 'sw.js']) {
  assert.strictEqual(
    read(`relay-server/public/${asset}`),
    read(`frontend/${asset}`),
    `relay-served ${asset} is not synced with frontend source`,
  );
}
const indexHtml = read('frontend/index.html');
const styleCacheIdentity = indexHtml.match(/styles\.css\?v=([a-zA-Z0-9._-]+)/)?.[1];
const bundleCacheIdentity = indexHtml.match(/bundle\.js\?v=([a-zA-Z0-9._-]+)/)?.[1];
assert(styleCacheIdentity, 'production stylesheet URL must carry a cache identity');
assert(bundleCacheIdentity, 'production bundle URL must carry a cache identity');
assert.strictEqual(bundleCacheIdentity, styleCacheIdentity,
  'production stylesheet and bundle must carry the same current cache identity');
assert.match(read('frontend/sw.js'), /const CACHE_NAME = 'agent-chat-build-[a-f0-9]{16}';/,
  'service-worker cache must carry a versioned cache identity');
assert.strictEqual(read('relay-server/public/dist/bundle.js'), read('frontend/dist/bundle.js'),
  'relay-served bundle is not synced with the frontend build');

console.log('frontend Cursor model-control smoke: PASS');
