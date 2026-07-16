#!/usr/bin/env node
'use strict';

const assert = require('assert');
const runner = require('./production-harness-overnight-soak');

const id = '11111111-1111-4111-8111-111111111111';
let sessions = runner.applyRelaySessionEvent([], {
  type: 'connection_ack',
  sessions: [{
    session_id: id,
    agent_type: 'claude_cli',
    workspace_path: 'C:\\temp\\remote-agent-claude-cli-test',
    activity: { kind: 'idle', label: '' },
  }],
});

assert.strictEqual(runner.selectSafeSessions(sessions, ['claude_cli']).claude_cli.session_id, id);

sessions = runner.applyRelaySessionEvent(sessions, {
  type: 'status',
  session: id,
  activity: { kind: 'generating', label: 'Claude CLI running', updated_at: '2026-07-12T07:41:32.000Z' },
});
assert.throws(
  () => runner.selectSafeSessions(sessions, ['claude_cli']),
  /No idle disposable claude_cli session/,
  'incremental busy status must update the guarded inventory',
);

sessions = runner.applyRelaySessionEvent(sessions, {
  type: 'status',
  session: id,
  activity: { kind: 'idle', label: '', updated_at: '2026-07-12T07:41:35.000Z' },
});
assert.strictEqual(
  runner.selectSafeSessions(sessions, ['claude_cli']).claude_cli.activity.kind,
  'idle',
  'incremental final-idle status must clear the guarded inventory',
);

console.log(JSON.stringify({
  ok: true,
  initial_snapshot: true,
  incremental_busy: true,
  incremental_final_idle: true,
}, null, 2));
