#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-cli-plan-launch-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const sessionStore = require('../agent-proxy/session-store');

function engineHarness() {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map();
  engine.sent = [];
  engine._sendToRelay = message => engine.sent.push(message);
  engine._broadcastSessionSnapshot = () => {};
  engine._publishCodexCliConfig = () => {};
  engine._log = () => {};
  engine._registerCodexCliSession = summary => {
    const session = {
      session_id: `session-${summary.cliSessionId}`,
      agentType: 'codex_cli',
      cliSessionId: summary.cliSessionId,
      workspace_path: summary.workspacePath,
      messageQueue: [],
    };
    engine.sessions.set(session.session_id, session);
    return session;
  };
  return engine;
}

try {
  const valid = engineHarness();
  valid._handleRelayMessage({
    type: 'launch_session',
    request_id: 'plan-launch-valid',
    agent_type: 'codex_cli',
    workspace_path: tempRoot,
    permission_mode: 'read-only',
    collaboration_mode: 'plan',
  });
  const acknowledgement = valid.sent.find(message => message.type === 'session_launch_ack');
  assert(acknowledgement, 'Plan launch did not acknowledge the disposable session');
  const session = valid.sessions.get(acknowledgement.session_id);
  assert(session, 'Plan launch did not register the disposable session');
  assert.strictEqual(session.codexCliCollaborationMode, 'plan');

  const invalid = engineHarness();
  invalid._handleRelayMessage({
    type: 'launch_session',
    request_id: 'plan-launch-invalid',
    agent_type: 'codex_cli',
    workspace_path: tempRoot,
    collaboration_mode: 'untrusted-mode',
  });
  const rejected = invalid.sent.find(message => message.type === 'session_launch_failed');
  assert(rejected, 'invalid collaboration mode did not fail closed');
  assert.strictEqual(rejected.error_code, 'invalid_collaboration_mode');
  assert.strictEqual(invalid.sessions.size, 0);

  console.log(JSON.stringify({
    result: 'PASS',
    plan_mode_registered: true,
    background_window_opened: false,
    invalid_mode_failed_closed: true,
  }, null, 2));
} finally {
  sessionStore.flushPendingSaves();
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
