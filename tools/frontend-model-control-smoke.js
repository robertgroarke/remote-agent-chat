#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const hooks = read('frontend/hooks.jsx');

assert.match(hooks, /const modelChangeGrace = useRef\(\{\}\);/,
  'model-change grace state must survive React renders');
assert.doesNotMatch(hooks, /const modelChangeGrace = \{\};/,
  'render-local model-change grace state loses the in-flight update');
assert.match(hooks, /modelChangeGrace\.current\[sessionId\] = Date\.now\(\) \+ 10000;/,
  'setAgentModel must arm the persistent grace window');
assert.match(hooks, /const next = \{ \.\.\.existing, \.\.\.msg, model_id: existing\.model_id \|\| msg\.model_id \};/,
  'in-flight agent_config must merge into the existing config');
assert.match(hooks, /next\.available_models = existing\.available_models;/,
  'a transition config must not erase the verified native model catalog');

for (const asset of ['hooks.jsx', 'index.html', 'sw.js']) {
  assert.strictEqual(
    read(`relay-server/public/${asset}`),
    read(`frontend/${asset}`),
    `relay-served ${asset} is not synced with frontend source`,
  );
}
assert.match(read('frontend/index.html'), /bundle\.js\?v=20260710-cursor-new-chat-2/,
  'production bundle URL must carry the current Cursor control cache identity');
assert.match(read('frontend/sw.js'), /agent-chat-v57/,
  'service-worker cache must carry the current Cursor control cache identity');
assert.strictEqual(read('relay-server/public/dist/bundle.js'), read('frontend/dist/bundle.js'),
  'relay-served bundle is not synced with the frontend build');

console.log('frontend Cursor model-control smoke: PASS');
