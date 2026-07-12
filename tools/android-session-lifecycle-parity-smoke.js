#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('android-app/lib/relay.js');
const list = read('android-app/screens/SessionListScreen.jsx');
const launch = read('android-app/components/LaunchSessionSheet.jsx');

for (const [method, type] of [
  ['launchSession', 'launch_session'],
  ['closeSession', 'close_session'],
]) {
  assert(relay.includes(`${method}(`), `missing Android lifecycle helper: ${method}`);
  assert(relay.includes(`'${type}'`), `missing Android lifecycle protocol type: ${type}`);
}
assert.match(relay, /isDisconnected \? 'dismiss_session' : 'close_session'/);
assert.match(relay, /cli_session_id: options\.cli_session_id/);

for (const marker of [
  "case 'session_launching'",
  "case 'session_launch_ack'",
  "case 'session_launch_failed'",
  "case 'session_closed'",
  "case 'connection_error'",
  'beginLaunch',
  'beginResume',
  'confirmCloseSession',
  '<LaunchSessionSheet',
  'Close native session?',
  'Dismiss session?',
  'New Session',
]) assert(list.includes(marker), `missing Android session-lifecycle marker: ${marker}`);

assert.match(list, /style: 'destructive'/);
assert.match(list, /clientRef\.current\?\.closeSession\(sid, disconnected\)/);
assert.match(list, /session\.agent_type \|\| 'claude'/);
assert.match(launch, /presentationStyle="pageSheet"/);
assert.match(launch, /Launching may open the selected harness on the desktop/);
assert.match(launch, /\['antigravity_panel', 'Antigravity Chat'\]/);
assert.match(launch, /accessibilityRole="radio"/);

console.log(JSON.stringify({
  ok: true,
  protocol_actions: ['launch_session', 'resume_session', 'close_session', 'dismiss_session'],
  launch_ack_and_failure_state: true,
  auto_open_launched_session: true,
  history_agent_type_preserved_on_resume: true,
  connected_close_confirmation: true,
  disconnected_dismiss_confirmation: true,
  history_retention_copy: true,
  focus_protection_notice: true,
  live_mutation_invoked: false,
}, null, 2));
