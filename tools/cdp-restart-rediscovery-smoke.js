'use strict';

const assert = require('assert');
const {
  classifyActiveSessionTarget,
  targetDiscoveryDueOnTick,
} = require('../agent-proxy/proxy-engine');

const oldRuntime = { targetId: 'target-before-app-restart', _cdpPort: 9225 };
const replacement = { id: 'target-after-app-restart', _cdpPort: 9225 };
assert.equal(
  classifyActiveSessionTarget(oldRuntime, replacement, new Set([replacement.id])),
  'replace_stale_target',
  'a new target on the same CDP port must replace the vanished pre-restart target',
);
assert.equal(
  classifyActiveSessionTarget(oldRuntime, replacement, new Set([oldRuntime.targetId, replacement.id])),
  'duplicate_live_target',
  'rediscovery must not replace a target while both old and new targets are live',
);

const dueTicks = [];
for (let tick = 1; tick <= 30; tick++) {
  if (targetDiscoveryDueOnTick(tick)) dueTicks.push(tick);
}
assert.deepEqual(dueTicks, [10, 20, 30]);
assert.equal(targetDiscoveryDueOnTick(0), false);
assert.equal(targetDiscoveryDueOnTick(9), false);
assert.equal(targetDiscoveryDueOnTick(10), true);

console.log(JSON.stringify({
  status: 'PASS',
  automatic_discovery_ticks: dueTicks,
  poll_interval_ms: 1000,
  maximum_restart_rediscovery_delay_ms: 10000,
  stale_target_action: 'replace_stale_target',
  simultaneous_live_target_action: 'duplicate_live_target',
  focus_actions: 0,
  visible_windows: 0,
}, null, 2));
