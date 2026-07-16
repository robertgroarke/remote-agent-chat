#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-cli-close-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const launchers = require('../agent-proxy/launchers');
const codexCli = require('../agent-proxy/codex-cli');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const sessionStore = require('../agent-proxy/session-store');

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const originalCloseSession = launchers.closeSession;
  const originalStopCodex = codexCli.stopCodexExecSession;
  let cdpCloseCalls = 0;
  let childStopCalls = 0;
  let turnStopCalls = 0;
  try {
    launchers.closeSession = async () => {
      cdpCloseCalls += 1;
      return { ok: true };
    };
    codexCli.stopCodexExecSession = () => {
      childStopCalls += 1;
      return { ok: true };
    };

    const sessionId = 'owned-codex-cli-close';
    const child = { pid: 12345 };
    const turn = { stop: async () => { turnStopCalls += 1; } };
    const engine = Object.create(ProxyEngine.prototype);
    engine.sessions = new Map([[sessionId, {
      session_id: sessionId,
      agentType: 'codex_cli',
      _codexCliChild: child,
      _codexAppServerTurn: turn,
      _codexAppServerTurnIdentity: { thread_id: 'owned-thread' },
      _codexAppServerTurnCompleted: false,
      waitingForAssistant: true,
    }]]);
    engine.activeQuestionPromptAdapters = new Map([[sessionId, { claimed: false }]]);
    engine.activePermissionPrompts = new Map([[sessionId, { prompt_id: 'permission' }]]);
    engine.activeErrorPrompts = new Map([[sessionId, { prompt_id: 'error' }]]);
    engine.sent = [];
    engine._sendToRelay = message => engine.sent.push(message);
    engine._broadcastSessionSnapshot = () => {};
    engine._log = () => {};

    engine._handleRelayMessage({ type: 'close_session', session_id: sessionId });
    await settle();
    await settle();

    assert.strictEqual(turnStopCalls, 1, 'owned app-server turn must stop exactly once');
    assert.strictEqual(childStopCalls, 1, 'owned legacy child must stop exactly once');
    assert.strictEqual(cdpCloseCalls, 0, 'Codex CLI close must never enter a CDP close path');
    assert.strictEqual(engine.sessions.has(sessionId), false);
    assert.strictEqual(engine.activeQuestionPromptAdapters.has(sessionId), false);
    assert.strictEqual(engine.activePermissionPrompts.has(sessionId), false);
    assert.strictEqual(engine.activeErrorPrompts.has(sessionId), false);
    assert.ok(engine.sent.some(message => message.type === 'session_closed' && message.session_id === sessionId));

    console.log(JSON.stringify({
      result: 'PASS',
      owned_turn_stop_calls: turnStopCalls,
      owned_child_stop_calls: childStopCalls,
      cdp_close_calls: cdpCloseCalls,
      question_adapter_cleared: true,
      session_closed_emitted: true,
    }, null, 2));
  } finally {
    launchers.closeSession = originalCloseSession;
    codexCli.stopCodexExecSession = originalStopCodex;
    sessionStore.flushPendingSaves();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
