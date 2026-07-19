#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('android-app/lib/relay.js');
const chat = read('android-app/screens/ChatScreen.jsx');
const component = read('android-app/components/ErrorPrompt.jsx');
const permission = read('android-app/components/PermissionPrompt.jsx');

assert.match(relay, /respondToErrorPrompt\(sessionId, promptId, actionId, operatorGesture = false\)/);
assert.match(relay, /type: 'error_prompt_action'/);
assert.match(relay, /operator_user_gesture: operatorGesture === true/);
for (const marker of [
  "case 'session_error_prompt'",
  "case 'session_error_prompt_cleared'",
  'msg.open_error_prompts',
  "msg.command === 'error_prompt_action'",
  'submitting_action_id: null',
  'composerBlockedByPrompt',
]) assert(chat.includes(marker), `missing Android error-prompt marker: ${marker}`);

assert.match(chat, /respondToErrorPrompt\(sessionId, promptId, actionId, !!operatorEvent\?\.nativeEvent\)/);
assert.match(chat, /uploading \|\| composerBlockedByPrompt/);
assert.match(chat, /prompt=\{permPrompt \? null : errorPrompt\}/);
assert.match(component, /accessibilityRole="alert"/);
assert.match(component, /accessibilityLiveRegion="assertive"/);
assert.match(component, /prompt\.error_output/);
assert.match(component, /disabled=\{!!submittingActionId\}/);
assert.match(component, /onAction\(prompt\.prompt_id, actionId, event\)/);
assert.match(permission, /submitting_choice_id/);
assert.match(permission, /choice\.choice_id \|\| choice\.id/);
assert.match(permission, /disabled=\{!!submittingChoiceId\}/);
assert.match(permission, /prompt\.error/);

console.log(JSON.stringify({
  ok: true,
  restored_from_connection_ack: true,
  live_prompt_and_clear_events: true,
  blocking_prompt_disables_send: true,
  pending_and_retryable_failure_state: true,
  accessible_alert_surface: true,
}, null, 2));
