#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-cli-close-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');
process.env.CODEX_SESSIONS_DIR = path.join(tempRoot, '.codex', 'sessions');
fs.mkdirSync(process.env.CODEX_SESSIONS_DIR, { recursive: true });

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
    engine._validationGateForAgentType = () => ({ gated: false });

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

    const cleanupToken = crypto.randomBytes(32).toString('hex');
    const cleanupTokenHash = crypto.createHash('sha256').update(cleanupToken).digest('hex');
    const cliSessionId = '019f0000-0000-7000-8000-000000000021';
    const rolloutPath = path.join(
      process.env.CODEX_SESSIONS_DIR,
      `rollout-owned-${cliSessionId}.jsonl`,
    );
    fs.writeFileSync(rolloutPath, '{}\n');
    const ownedMeta = sessionStore.resolveVirtualSession({
      virtualId: `codex-cli:${cliSessionId}`,
      agentType: 'codex_cli',
      displayName: 'Owned disposable Codex CLI',
      workspaceName: 'remote-agent-vscode-test',
      workspacePath: 'C:\\temp\\remote-agent-vscode-test',
      windowTitle: 'Owned disposable Codex CLI',
      extra: {
        cli_session_id: cliSessionId,
        codex_cli_file_path: rolloutPath,
        owned_disposable_scope: 'latency_trace_sampler_v1',
        owned_disposable_token_hash: cleanupTokenHash,
      },
    });
    const ownedSession = {
      session_id: ownedMeta.session_id,
      agentType: 'codex_cli',
      workspace_path: 'C:\\temp\\remote-agent-vscode-test',
      targetId: null,
      cliSessionId,
      codexCliFilePath: rolloutPath,
      ownedDisposableScope: 'latency_trace_sampler_v1',
      ownedDisposableTokenHash: cleanupTokenHash,
    };
    engine.sessions.set(ownedMeta.session_id, ownedSession);
    engine.sent.length = 0;
    engine._handleRelayMessage({
      type: 'close_session',
      session_id: ownedMeta.session_id,
      request_id: 'invalid-owned-cleanup',
      destroy_owned_disposable: {
        scope: 'latency_trace_sampler_v1',
        token: '0'.repeat(64),
      },
    });
    assert(engine.sessions.has(ownedMeta.session_id),
      'invalid cleanup removed the retry target');
    assert(fs.existsSync(rolloutPath), 'invalid cleanup removed the native rollout');
    assert(sessionStore.getSession(ownedMeta.session_id),
      'invalid cleanup removed the durable session');
    assert(engine.sent.some(message => (
      message.type === 'session_close_failed'
      && message.owned_disposable_cleanup?.destroyed === false
    )));

    engine.sent.length = 0;
    engine._handleRelayMessage({
      type: 'close_session',
      session_id: ownedMeta.session_id,
      request_id: 'valid-owned-cleanup',
      destroy_owned_disposable: {
        scope: 'latency_trace_sampler_v1',
        token: cleanupToken,
      },
    });
    assert.strictEqual(engine.sessions.has(ownedMeta.session_id), false);
    assert.strictEqual(fs.existsSync(rolloutPath), false);
    assert.strictEqual(sessionStore.getSession(ownedMeta.session_id), null);
    assert(engine.sent.some(message => (
      message.type === 'session_closed'
      && message.owned_disposable_cleanup?.destroyed === true
      && message.owned_disposable_cleanup?.native_rollout_removed === true
    )));

    console.log(JSON.stringify({
      result: 'PASS',
      owned_turn_stop_calls: turnStopCalls,
      owned_child_stop_calls: childStopCalls,
      cdp_close_calls: cdpCloseCalls,
      question_adapter_cleared: true,
      session_closed_emitted: true,
      invalid_cleanup_retained_retry_target: true,
      owned_rollout_destroyed: true,
      owned_durable_session_destroyed: true,
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
