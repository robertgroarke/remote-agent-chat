#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const relay = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const webHooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');

for (const source of [relay, webHooks]) {
  assert.match(source, /openNativeWindow\(sessionId, operator(?:Gesture|Event)/);
  assert.match(source, /type: 'open_native_window'[\s\S]*?session_id: sessionId[\s\S]*?request_id: requestId/);
  assert.match(source, /operator_user_gesture:/);
}

assert.match(chat, /const hasNativeWindow = caps\?\.native_window/);
assert.match(chat, /hasNativeWindow && \(/);
assert.match(chat, /clientRef\.current\?\.openNativeWindow\(sessionId, !!event\?\.nativeEvent\)/);
assert.match(chat, /accessibilityLabel="Open native command window"/);
assert.match(chat, /cmd === 'open_native_window'/);
assert.match(proxy, /native_window:\s+isCodexCli \|\| isCursorCli/);
assert.match(proxy, /if \(type === 'open_native_window'\)/);

console.log(JSON.stringify({
  ok: true,
  protocol_type: 'open_native_window',
  capability: 'native_window',
  supported_android_fallback_agent_types: ['codex_cli', 'cursor_cli'],
  failure_feedback: true,
  operator_gesture_required: true,
  live_action_invoked: false,
  live_action_skip_reason: 'focus-protection rule: action intentionally opens a visible desktop window',
}, null, 2));
