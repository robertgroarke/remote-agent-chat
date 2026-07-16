#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  goalFingerprint,
  isResumableGoal,
  parseResetAt,
  resumeClientMessageId,
  retryDelayMs,
} = require('../relay-server/usage-resume');
const { rateLimitActive } = require('../agent-proxy/protocol');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

const now = Date.parse('2026-07-12T20:00:00.000Z');
assert.equal(parseResetAt('in 2h 15m', now), '2026-07-12T22:15:00.000Z');
assert.equal(parseResetAt('30 minutes', now), '2026-07-12T20:30:00.000Z');
assert.equal(parseResetAt('at 3:00 PM', now), '2026-07-12T22:00:00.000Z');
assert.equal(parseResetAt('2026-07-17T06:02:00.000Z', now), '2026-07-17T06:02:00.000Z');
assert.equal(parseResetAt(1783908000, now), '2026-07-13T02:00:00.000Z');
assert.equal(parseResetAt('unknown', now), null);
assert.equal(
  rateLimitActive('session-1', '2026-07-17T06:02:00.000Z', 100, true).reset_at,
  '2026-07-17T06:02:00.000Z',
);

const goal = { objective: 'Finish production maturity', status: 'active', created_at: '2026-07-12T18:00:00Z' };
assert.equal(isResumableGoal(goal), true);
assert.equal(isResumableGoal({ ...goal, status: 'paused' }), true);
assert.equal(isResumableGoal({ ...goal, status: 'completed' }), false);
assert.equal(isResumableGoal({ status: 'active' }), false);
const fingerprint = goalFingerprint(goal);
assert.equal(fingerprint.length, 24);
assert.equal(
  resumeClientMessageId('session-1', '2026-07-12T22:00:00.000Z', fingerprint),
  resumeClientMessageId('session-1', '2026-07-12T22:00:00.000Z', fingerprint),
);
assert.deepEqual([1, 2, 3, 4, 5, 6].map(retryDelayMs), [15000, 30000, 60000, 120000, 240000, 300000]);

const serialized = `${JSON.stringify({
  ok: true,
  relative_reset_formats: true,
  absolute_reset_formats: true,
  resumable_goal_states: ['active', 'paused', 'blocked'],
  deterministic_client_message_id: true,
  bounded_retry_delays_ms: [15000, 30000, 60000, 120000, 240000, 300000],
  visible_windows_opened: 0,
}, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
