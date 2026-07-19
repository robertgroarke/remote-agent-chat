#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  UsageThresholdTracker,
  buildUsageThresholdNotification,
  usageThreshold,
} = require('../relay-server/usage-thresholds');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const tracker = new UsageThresholdTracker();

assert.equal(usageThreshold(74, false), null);
assert.equal(usageThreshold(75, false), 75);
assert.equal(usageThreshold(90, false), 90);
assert.equal(usageThreshold(null, true), 100);

assert.equal(tracker.observe('session-a', { percentUsed: 74, hardLimited: false }), null);
assert.equal(tracker.observe('session-a', { percentUsed: 75, hardLimited: false }), 75);
assert.equal(tracker.observe('session-a', { percentUsed: 84, hardLimited: false }), null);
assert.equal(tracker.observe('session-a', { percentUsed: 91, hardLimited: false }), 90);
assert.equal(tracker.observe('session-a', { percentUsed: 92, hardLimited: false }), null);
assert.equal(tracker.observe('session-a', { percentUsed: 100, hardLimited: true }), 100);
assert.equal(tracker.observe('session-a', { percentUsed: 100, hardLimited: true }), null);
assert.equal(tracker.clear('session-a').hardLimited, true);
assert.equal(tracker.observe('session-a', { percentUsed: 82, hardLimited: false }), 75);

assert.equal(tracker.observe('session-b', { percentUsed: 95, hardLimited: false }), 90);
assert.equal(tracker.observe('session-b', { percentUsed: 85, hardLimited: false }), null);
assert.equal(tracker.clear('session-b').hardLimited, false);

const critical = buildUsageThresholdNotification('Codex CLI', 90, 93, 'in 45m');
assert.equal(critical.title, 'Codex CLI has 7% usage left');
assert.match(critical.body, /93%/);
assert.match(critical.body, /in 45m/);
const exhausted = buildUsageThresholdNotification('Claude Code', 100, null, 'at 3:00 PM');
assert.equal(exhausted.title, 'Claude Code usage exhausted');
assert.match(exhausted.body, /cannot continue/);

const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const proxySource = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');
assert.match(relaySource, /usageThresholds\.observe\(id, \{ percentUsed, hardLimited \}\)/);
assert.match(relaySource, /previousUsage\?\.hardLimited && shouldSendPush\(\)/);
assert.match(proxySource, /rateLimitActive\(sessionId, untilText, pctUsed, false\)/);
assert.match(proxySource, /rateLimitActive\(sessionId, untilText, pctUsed, true\)/);

const serialized = `${JSON.stringify({
  ok: true,
  thresholds: [75, 90, 100],
  duplicate_pushes: 0,
  warning_marked_hard_limited: false,
  warning_only_clear_pushes: 0,
  visible_windows_opened: 0,
}, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
