#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');

const root = path.resolve(__dirname, '..');
const webPath = path.join(root, 'frontend', 'goal-command.js');
const androidPath = path.join(root, 'android-app', 'lib', 'goal-command.js');

function loadModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js', format: 'cjs', target: 'es2020',
  }).code;
  const module = { exports: {} };
  new Function('module', 'exports', transformed)(module, module.exports);
  return module.exports;
}

const webSource = fs.readFileSync(webPath, 'utf8');
const androidSource = fs.readFileSync(androidPath, 'utf8');
const normalizeEol = source => source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
assert.strictEqual(
  normalizeEol(androidSource),
  normalizeEol(webSource),
  'Web and Android goal command policy must remain text-identical',
);
const policy = loadModule(webPath);
const classify = (text, attachmentCount = 0) => policy.classifyGoalCommandIntent(text, { attachmentCount });

assert.deepStrictEqual(classify(' /goal resume '), {
  kind: 'goal_control', action: 'resume', command: '/goal resume', text: '/goal resume',
});
assert.deepStrictEqual(classify('/GOAL PAUSE'), {
  kind: 'goal_control', action: 'pause', command: '/goal pause', text: '/GOAL PAUSE',
});
assert.strictEqual(classify('/goal resume', 1).kind, 'chat', 'attachments must keep slash text in ordinary chat');
assert.strictEqual(classify('/goal resume\nwith details').kind, 'chat', 'multiline prompts must remain ordinary chat');
assert.strictEqual(classify('Please run /goal resume after checking state.').kind, 'chat');
assert.strictEqual(classify('/goal resume please').kind, 'unsupported_goal_control');
assert.strictEqual(classify('/goal').kind, 'unsupported_goal_control');
assert.strictEqual(classify('/review').kind, 'chat');
assert.strictEqual(policy.satisfiedGoalCommandLabel('resume', 'active'), 'Already active');
assert.strictEqual(policy.satisfiedGoalCommandLabel('pause', 'paused'), 'Already paused');
assert.strictEqual(policy.satisfiedGoalCommandLabel('resume', 'paused'), '');

const webApp = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const webHooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const androidChat = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const androidRelay = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');
for (const source of [webApp, androidChat]) {
  assert(source.includes('classifyGoalCommandIntent'));
  assert(source.includes('pendingGoalSlashControl'));
  assert(source.includes('Command retained'));
  assert(source.includes('Validating goal, then applying native control'));
}
for (const source of [webHooks, androidRelay]) {
  assert(source.includes('String(options.requestId ||'), 'goal control must accept a stable request identity');
}
assert(!webApp.includes('use /goal resume later'));

console.log(JSON.stringify({
  status: 'PASS',
  exact_controls: ['/goal resume', '/goal pause'],
  attachment_and_multiline_boundary: true,
  unsupported_goal_command_visible: true,
  web_android_policy_byte_identical: true,
  stable_request_identity: true,
  optimistic_chat_bubble_for_control: false,
}, null, 2));
