#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

async function main() {
  const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
  const sessionId = 'codex-desktop-hard-stuck-smoke';
  const session = {
    agentType: 'codex-desktop',
    targetId: 'FAKE_CODEX_DESKTOP_TARGET',
    _cdpPort: 9225,
    _pollInProgress: true,
    _pollStartedAt: Date.now() - 61_000,
    client: { Runtime: {} },
  };
  const logs = [];
  let closed = false;
  let broadcast = false;
  engine.on('log', (level, message) => logs.push({ level, message }));
  engine._safeClose = async client => {
    assert.strictEqual(client, session.client);
    closed = true;
  };
  engine._broadcastSessionSnapshot = () => { broadcast = true; };
  engine.sessions.set(sessionId, session);

  await engine._pollSessionBounded(sessionId);

  assert.strictEqual(session._intentionalPollClose, true);
  assert.strictEqual(session.client.Runtime._suppressReadErrors, true);
  assert.strictEqual(closed, true);
  assert.strictEqual(broadcast, true);
  assert.strictEqual(engine.sessions.has(sessionId), false);
  assert(engine._isCdpTargetCooling(session.targetId));
  assert((engine._cdpTargetCooldownUntil.get(session.targetId) - Date.now()) > 14 * 60_000);
  assert(logs.some(entry => /closing genuinely stuck CDP client/.test(entry.message)));
  assert(logs.some(entry => /Cooling down target/.test(entry.message)));
  console.log('PASS Codex Desktop hard-stuck poll cooldown and intentional close');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`FAIL Codex Desktop hard-stuck smoke: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
