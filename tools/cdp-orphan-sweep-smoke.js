'use strict';

const assert = require('assert');
const {
  ProxyEngine,
  classifyStoredCdpOrphan,
  classifyActiveSessionTarget,
} = require('../agent-proxy/proxy-engine');

async function main() {
  const oldRuntime = { targetId: 'old-target', _cdpPort: 9230 };
  const replacement = { id: 'new-target', _cdpPort: 9230 };
  assert.strictEqual(
    classifyActiveSessionTarget(oldRuntime, replacement, new Set(['new-target'])),
    'replace_stale_target',
    'a durable session must rebind when its old target disappears after an app restart',
  );
  assert.strictEqual(
    classifyActiveSessionTarget(oldRuntime, replacement, new Set(['old-target', 'new-target'])),
    'duplicate_live_target',
    'two simultaneously live targets must not displace the canonical runtime arbitrarily',
  );
  assert.strictEqual(
    classifyActiveSessionTarget(oldRuntime, { id: 'old-target', _cdpPort: 9230 }, new Set(['old-target'])),
    'same_target',
    'normal rediscovery of the same target must remain a no-op',
  );

  const partialPorts = new Set([9223]);
  const missingContinue = {
    session_id: 'continue-session',
    agent_type: 'continue',
    target_id: 'continue-target',
    cdp_port: 9230,
  };
  assert.strictEqual(
    classifyStoredCdpOrphan(missingContinue, null, partialPorts),
    null,
    'a failed 9230 scan must preserve its durable Continue session',
  );
  assert.strictEqual(
    classifyStoredCdpOrphan(missingContinue, null, new Set([9230])),
    'gone',
    'a successful 9230 scan may retire a target that is actually absent',
  );
  assert.strictEqual(
    classifyStoredCdpOrphan({ ...missingContinue, cdp_port: null }, null, new Set([9223, 9230])),
    null,
    'legacy records without port ownership must fail safe until rediscovery migrates them',
  );

  const engine = new ProxyEngine({
    cdpPorts: [9223, 9230],
    relayUrl: 'ws://127.0.0.1:1',
    machineLabel: 'cdp-orphan-smoke',
  });
  engine._cdpPortCooldownUntil.set(9230, Date.now() + 60_000);
  const queried = [];
  engine._listTargetsOnPort = async (port) => {
    queried.push(port);
    return [{ id: `target-${port}`, type: 'page', url: 'about:blank' }];
  };
  const partial = await engine._resolveCdpTargets();
  assert.deepStrictEqual(queried, [9223], 'cooling ports must not count as successful empty scans');
  assert.deepStrictEqual(Array.from(partial.successfulCdpPorts), [9223]);
  assert.deepStrictEqual(partial.targets.map(target => target._cdpPort), [9223]);

  engine._cdpPortCooldownUntil.set(9223, Date.now() + 60_000);
  await assert.rejects(
    () => engine._resolveCdpTargets(),
    /All configured CDP ports are cooling down/,
    'an all-port cooldown must abort discovery before orphan cleanup',
  );

  console.log(JSON.stringify({
    ok: true,
    partial_success_ports: Array.from(partial.successfulCdpPorts),
    preserved_failed_port_session: true,
    all_port_cooldown_fails_closed: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
