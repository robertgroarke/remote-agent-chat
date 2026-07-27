#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const contractPath = path.join(ROOT, 'android-app', 'lib', 'latency-trace.js');
const clockPath = path.join(ROOT, 'android-app', 'lib', 'latency-clock.js');
const relayPath = path.join(ROOT, 'android-app', 'lib', 'relay.js');
const chatPath = path.join(ROOT, 'android-app', 'screens', 'ChatScreen.jsx');

function loadAndroidContract() {
  const clockSource = fs.readFileSync(clockPath, 'utf8')
    .replace(/\bexport const /g, 'const ')
    .replace(/\bexport function /g, 'function ');
  const clockModule = { exports: {} };
  vm.runInNewContext(`${clockSource}
module.exports = { estimateRelayClockOffset, relayClockStageObservation };`, {
    module: clockModule,
    exports: clockModule.exports,
    Date,
    Math,
    Number,
    Object,
    String,
    Array,
  }, { filename: clockPath });
  const source = fs.readFileSync(contractPath, 'utf8')
    .replace(/^import .*?;\r?\n/m, '')
    .replace(/\bexport function /g, 'function ');
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    Date,
    Number,
    Object,
    String,
    Array,
    relayClockStageObservation: clockModule.exports.relayClockStageObservation,
    globalThis: {},
  };
  vm.runInNewContext(`${source}
module.exports = {
  createAndroidLatencyTrace,
  completeAndroidLatencyTrace,
  retainAndroidLatencyCompletion,
  retainAndroidLatencyTerminal,
};`, context, { filename: contractPath });
  return { contract: module.exports, diagnostics: context.globalThis };
}

const { contract, diagnostics } = loadAndroidContract();
const zeroOffsetClock = {
  client_sent_at_ms: 900,
  relay_received_at_ms: 905,
  relay_sent_at_ms: 906,
  client_received_at_ms: 911,
};
const trace = contract.createAndroidLatencyTrace(
  'android-smoke-cid',
  'codex_cli',
  1_000,
  zeroOffsetClock,
);
assert.strictEqual(trace.trace_id, 'android:android-smoke-cid');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(trace.stages)),
  { webui_send: 1_000 },
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(trace.raw_stages)),
  { webui_send: 1_000 },
);
assert.strictEqual(trace.stage_sources.webui_send.clock_status, 'synchronized');
assert.strictEqual(trace.stage_sources.webui_send.source, 'android_composer_action');

const relayTrace = {
  ...trace,
  stages: {
    ...trace.stages,
    relay_recv: 1_010,
    proxy_recv: 1_020,
    harness_delivered: 1_030,
    agent_first_output: 1_040,
    relay_broadcast: 1_050,
  },
};
const completed = contract.completeAndroidLatencyTrace(relayTrace, 1_060, zeroOffsetClock);
assert(completed);
assert.strictEqual(completed.stages.webui_render, 1_060);
assert.strictEqual(completed.raw_stages.webui_render, 1_060);
assert.strictEqual(
  completed.stage_sources.webui_render.source,
  'android_react_native_post_paint',
);
assert.strictEqual(contract.completeAndroidLatencyTrace(completed, 1_070), null);
const unclamped = contract.completeAndroidLatencyTrace(relayTrace, 900, zeroOffsetClock);
assert.strictEqual(unclamped.stages.webui_render, 900);
assert.strictEqual(unclamped.raw_stages.webui_render, 900);
assert.strictEqual(unclamped.stage_sources.webui_render.clock_adjustment_ms, undefined);
contract.retainAndroidLatencyCompletion(completed);
const terminal = contract.retainAndroidLatencyTerminal({
  trace_id: 'android-terminal-smoke',
  client_message_id: 'android-terminal-cid',
  agent_type: 'codex_cli',
  surface_class: 'codex_cli',
  reason: 'causal_identity_ambiguous',
  terminal_at_ms: 1_100,
  stages_completed: ['webui_send', 'relay_recv', 'not_a_stage'],
  session_id: 'must-not-retain',
  content: 'must-not-retain',
});
assert.strictEqual(terminal.session_id, undefined);
assert.strictEqual(terminal.content, undefined);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(terminal.stages_completed)),
  ['webui_send', 'relay_recv'],
);
assert.strictEqual(diagnostics.__RAC_LATENCY_TRACES__.length, 2);

const relaySource = fs.readFileSync(relayPath, 'utf8');
const chatSource = fs.readFileSync(chatPath, 'utf8');
assert.match(relaySource, /sendMessage\([^)]*latencyTrace = null, options = \{\}\)/);
assert.match(relaySource, /\.\.\.\(latencyTrace \? \{ latency_trace: latencyTrace \} : \{\}\)/);
assert.match(relaySource, /options\.retryFailed === true \? \{ retry_failed: true \}/);
assert.match(relaySource, /type: 'latency_trace_complete'/);
assert.match(chatSource, /createAndroidLatencyTrace\(/);
assert.match(chatSource, /scheduleLatencyTraceAfterRender/);
assert.match(chatSource, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{/);
assert.match(chatSource, /case 'message_delta':[\s\S]*scheduleLatencyTraceAfterRender/);
assert.match(chatSource, /case 'proxy_message':[\s\S]*scheduleLatencyTraceAfterRender/);
assert.match(chatSource, /case 'latency_trace_terminal':?[\s\S]*retainAndroidLatencyTerminal/);
assert.match(chatSource, /latencyTraceCompletedIdsRef\.current\.has\(traceId\)/);

console.log(JSON.stringify({
  result: 'PASS',
  client_surface: 'android',
  send_trace_created: true,
  post_render_frames: 2,
  exact_once_completion_guard: true,
  streaming_delta_completion: true,
  canonical_proxy_message_completion: true,
  terminal_outcome_retained: true,
  terminal_privacy_clean: true,
  diagnostic_rows: diagnostics.__RAC_LATENCY_TRACES__.length,
}, null, 2));
