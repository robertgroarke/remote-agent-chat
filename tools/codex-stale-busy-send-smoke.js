#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const selectors = require('../agent-proxy/selectors');
const sessionStore = require('../agent-proxy/session-store');

async function runCase(nativeThinking) {
  const engine = Object.create(ProxyEngine.prototype);
  const sessionId = `stale-busy-${nativeThinking ? 'busy' : 'idle'}`;
  const session = {
    agentType: 'codex',
    client: { Runtime: {} },
    activity: { kind: 'generating', label: 'Generating' },
    status: 'healthy',
    thinking: true,
    thinkingLabel: 'Thinking',
    thinkingContent: '',
    waitingForAssistant: true,
  };
  engine.sessions = new Map([[sessionId, session]]);
  engine._logs = [];
  engine._relay = [];
  engine._injections = [];
  engine._log = (_level, message) => engine._logs.push(message);
  engine._sendToRelay = message => engine._relay.push(message);
  engine._sendSessionMessage = async (_session, content) => {
    engine._injections.push(content);
    return { ok: true };
  };

  const originalThinking = selectors.detectThinking;
  const originalSteer = selectors.steerCodexInput;
  const originalUpdate = sessionStore.updateSession;
  selectors.detectThinking = async () => ({ thinking: nativeThinking, label: nativeThinking ? 'Thinking' : '' });
  selectors.steerCodexInput = async () => ({ ok: true });
  sessionStore.updateSession = () => {};
  try {
    await engine._handleSendRequest({
      session: sessionId,
      content: 'owned smoke prompt',
      client_message_id: `smoke-${nativeThinking ? 'busy' : 'idle'}`,
    });
  } finally {
    selectors.detectThinking = originalThinking;
    selectors.steerCodexInput = originalSteer;
    sessionStore.updateSession = originalUpdate;
  }
  return { session, logs: engine._logs, relay: engine._relay, injections: engine._injections };
}

async function main() {
  const stale = await runCase(false);
  assert.equal(stale.injections.length, 1, 'native-idle stale cache should inject immediately');
  assert.equal(stale.session.messageQueue?.length || 0, 0, 'native-idle stale cache must not queue');
  assert(stale.logs.some(line => line.includes('Cleared stale generating cache')), 'stale cache clear should be logged');
  assert(stale.relay.some(message => message.type === 'proxy_send_result' && message.result === 'delivered'), 'native-idle send should receive delivered receipt');

  const busy = await runCase(true);
  assert.equal(busy.injections.length, 0, 'genuinely busy native task must not inject');
  assert.equal(busy.session.messageQueue?.length, 1, 'genuinely busy native task should queue');
  assert(busy.relay.some(message => message.type === 'message_queued'), 'busy send should publish queue state');

  console.log(JSON.stringify({
    ok: true,
    stale_cache_injected: stale.injections.length,
    native_busy_queued: busy.session.messageQueue.length,
  }, null, 2));
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
