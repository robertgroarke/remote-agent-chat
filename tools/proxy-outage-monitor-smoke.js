'use strict';

const assert = require('assert');
const { ProxyOutageMonitor } = require('../relay-server/proxy-outage-monitor');

let now = 1_720_000_000_000;
let timerCallback = null;
let timerDelay = null;
const offline = [];
const recovered = [];
const monitor = new ProxyOutageMonitor({
  graceMs: 120_000,
  now: () => now,
  setTimer: (callback, delay) => {
    timerCallback = callback;
    timerDelay = delay;
    return { unref() {} };
  },
  clearTimer: () => {
    timerCallback = null;
    timerDelay = null;
  },
  onOffline: event => offline.push(event),
  onRecovered: event => recovered.push(event),
});

assert.equal(monitor.observe(0), 'waiting_for_first_proxy');
assert.equal(timerCallback, null, 'relay startup without a proxy must not create a false outage');
assert.equal(monitor.observe(1), 'healthy');
assert.equal(monitor.observe(2), 'healthy');
assert.equal(monitor.observe(1), 'healthy', 'one of two proxies leaving is not a global outage');
assert.equal(monitor.observe(0), 'grace');
assert.equal(timerDelay, 120_000);

now += 119_999;
timerCallback();
assert.equal(offline.length, 0);
assert.equal(timerDelay, 1, 'early timer firing must preserve the full grace period');
now += 1;
timerCallback();
assert.equal(offline.length, 1);
assert.equal(offline[0].missing_ms, 120_000);
assert.equal(monitor.observe(0), 'offline');
assert.equal(offline.length, 1, 'offline notification must be one-shot per incident');

now += 5_000;
assert.equal(monitor.observe(1), 'healthy');
assert.equal(recovered.length, 1);
assert.equal(recovered[0].missing_ms, 125_000);
assert.equal(monitor.snapshot().incident_id, null);

console.log(JSON.stringify({
  status: 'PASS',
  grace_ms: 120_000,
  offline_notifications: offline.length,
  recovered_notifications: recovered.length,
  duplicate_notifications: 0,
  multi_proxy_safe: true,
}, null, 2));
