#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tool = fs.readFileSync(path.join(ROOT, 'tools', 'p0-production-cpu-attribution.js'), 'utf8');

const settleMatch = tool.match(/const STEADY_STATE_SETTLE_MS = ([\d_]+);/);
assert(settleMatch, 'production CPU verifier must define a steady-state settle boundary');
const settleMs = Number(settleMatch[1].replaceAll('_', ''));

const longestCssActivityMs = 3 * 1_500;
const claudeSpinnerMs = 12 * 3 * 120;
assert(
  settleMs >= Math.max(longestCssActivityMs, claudeSpinnerMs),
  'steady-state sampling must start after every bounded activity animation can settle',
);

const settleAwait = tool.indexOf('sample.at_ms >= STEADY_STATE_SETTLE_MS');
const taskPhase = tool.indexOf("phase = 'task'");
assert(settleAwait >= 0 && taskPhase > settleAwait, 'TaskDuration sampling must start after the settle boundary');
assert(
  tool.includes('stableSettleSamples >= 4'),
  'verifier must require four consecutive stable DOM/history/animation samples',
);
assert(
  tool.includes(".filter(animation => animation.playState === 'running')"),
  'verifier must inspect running document animations after settling',
);
assert(
  tool.includes('steady_state_animation_settled: animationStateAfterSettle.running_count === 0'),
  'running animations after settling must fail acceptance',
);

console.log(JSON.stringify({
  status: 'PASS',
  steady_state_settle_ms: settleMs,
  longest_bounded_activity_animation_ms: longestCssActivityMs,
  claude_spinner_bound_ms: claudeSpinnerMs,
  task_sampling_after_settle: true,
  consecutive_stable_samples: 4,
  running_animation_acceptance_gate: true,
}, null, 2));
