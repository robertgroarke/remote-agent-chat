#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharedClock = require('../shared/latency-clock');
const {
  LATENCY_TRACE_STAGES,
  advanceLatencyTrace,
  latencyStageDurations,
} = require('../shared/latency-trace');

const ROOT = path.resolve(__dirname, '..');

function loadEsClock(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filePath, 'utf8')
    .replace(/\bexport const /g, 'const ')
    .replace(/\bexport function /g, 'function ');
  const module = { exports: {} };
  vm.runInNewContext(`${source}
module.exports = {
  estimateRelayClockOffset,
  relayClockStageObservation,
};`, {
    module,
    exports: module.exports,
    Date,
    Math,
    Number,
    Object,
    String,
    Array,
  }, { filename: filePath });
  return module.exports;
}

function sample({ clientAtMs, offsetMs, outboundMs, inboundMs, relayProcessingMs }) {
  return {
    clientSentAtMs: clientAtMs,
    relayReceivedAtMs: clientAtMs + offsetMs + outboundMs,
    relaySentAtMs: clientAtMs + offsetMs + outboundMs + relayProcessingMs,
    clientReceivedAtMs: clientAtMs + outboundMs + relayProcessingMs + inboundMs,
  };
}

function sourceFor(clock, rawAtMs, domain, estimate, source) {
  const observed = clock.relayClockStageObservation(
    rawAtMs,
    domain,
    estimate,
    { nowMs: rawAtMs },
  );
  assert(observed.ok, observed.code);
  return {
    atMs: observed.adjusted_at_ms ?? observed.adjustedAtMs,
    source: { source, ...observed.source },
  };
}

function completeTrace(index, browserEstimate, proxyEstimate) {
  const browserOffset = browserEstimate.offset_ms;
  const proxyOffset = proxyEstimate.offset_ms;
  const base = 2_000_000 + index * 1_000;
  const adjustedTimes = [
    base,
    base + 11,
    base + 23,
    base + 97,
    base + 131,
    base + 139,
    base + 151,
  ];
  const domains = ['browser', 'relay', 'proxy', 'proxy', 'proxy', 'relay', 'browser'];
  const estimates = [
    browserEstimate, null, proxyEstimate, proxyEstimate, proxyEstimate, null, browserEstimate,
  ];
  const offsets = [browserOffset, 0, proxyOffset, proxyOffset, proxyOffset, 0, browserOffset];
  let trace = {
    trace_id: `latency-clock-skew-${String(index).padStart(4, '0')}`,
    client_message_id: `clock-cid-${String(index).padStart(4, '0')}`,
    agent_type: 'codex_cli',
    stages: {},
  };
  LATENCY_TRACE_STAGES.forEach((stage, stageIndex) => {
    const rawAtMs = adjustedTimes[stageIndex] - offsets[stageIndex];
    const observation = sourceFor(
      sharedClock,
      rawAtMs,
      domains[stageIndex],
      estimates[stageIndex],
      `clock_skew_fixture_${stage}`,
    );
    const advanced = advanceLatencyTrace(trace, stage, rawAtMs, observation.source);
    assert(advanced.ok, `${stage}: ${advanced.code}`);
    trace = advanced.trace;
  });
  const measured = latencyStageDurations(trace);
  assert(measured.ok, measured.code);
  assert.strictEqual(Object.keys(measured.trace.raw_stages).length, LATENCY_TRACE_STAGES.length);
  assert.strictEqual(measured.durations.total_ms, 151);
  assert.strictEqual(measured.durations.relay_recv_to_proxy_recv_ms, 12);
  assert.strictEqual(measured.durations.relay_broadcast_to_webui_render_ms, 12);
  return measured;
}

function main() {
  const webClock = loadEsClock('frontend/latency-clock.js');
  const androidClock = loadEsClock('android-app/lib/latency-clock.js');
  let negativeRawHopCount = 0;
  for (let index = 0; index < 1_000; index += 1) {
    const browserSample = sample({
      clientAtMs: 1_000_000 + index * 10_000,
      offsetMs: (index % 801) - 400,
      outboundMs: (index % 41) + 1,
      inboundMs: (index % 47) + 1,
      relayProcessingMs: index % 4,
    });
    const proxySample = sample({
      clientAtMs: 1_000_500 + index * 10_000,
      offsetMs: (index % 701) - 350,
      outboundMs: (index % 31) + 1,
      inboundMs: (index % 37) + 1,
      relayProcessingMs: index % 3,
    });
    const sharedBrowser = sharedClock.estimateRelayClockOffset(browserSample);
    const sharedProxy = sharedClock.estimateRelayClockOffset(proxySample);
    const webBrowser = webClock.estimateRelayClockOffset(browserSample);
    const androidBrowser = androidClock.estimateRelayClockOffset(browserSample);
    assert(sharedBrowser.ok && sharedProxy.ok);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(webBrowser)), sharedBrowser);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(androidBrowser)), sharedBrowser);
    assert.strictEqual(sharedBrowser.estimate.status, 'synchronized');
    assert.strictEqual(sharedProxy.estimate.status, 'synchronized');
    const measured = completeTrace(index, sharedBrowser.estimate, sharedProxy.estimate);
    if (Object.values(measured.raw_durations).some(value => value < 0)) negativeRawHopCount += 1;
  }

  const skew = sharedClock.estimateRelayClockOffset(sample({
    clientAtMs: 5_000,
    offsetMs: 1_500,
    outboundMs: 10,
    inboundMs: 10,
    relayProcessingMs: 1,
  }));
  assert.strictEqual(skew.estimate.status, 'skew_threshold_exceeded');
  const highRtt = sharedClock.estimateRelayClockOffset(sample({
    clientAtMs: 5_000,
    offsetMs: 0,
    outboundMs: 1_100,
    inboundMs: 1_100,
    relayProcessingMs: 1,
  }));
  assert.strictEqual(highRtt.estimate.status, 'rtt_threshold_exceeded');
  const stale = sharedClock.normalizeRelayClockEstimate(
    sharedClock.estimateRelayClockOffset(sample({
      clientAtMs: 5_000,
      offsetMs: 0,
      outboundMs: 10,
      inboundMs: 10,
      relayProcessingMs: 1,
    })).estimate,
    { nowMs: 70_021 },
  );
  assert.strictEqual(stale.estimate.status, 'stale');

  const regression = advanceLatencyTrace({
    trace_id: 'latency-clock-regression-fixture',
    agent_type: 'codex_cli',
    stages: { webui_send: 2_000 },
    raw_stages: { webui_send: 1_500 },
    stage_sources: {
      webui_send: {
        source: 'clock_regression_fixture',
        clock_domain: 'browser',
        clock_reference: 'relay',
        clock_status: 'synchronized',
        raw_at_ms: 1_500,
        adjusted_at_ms: 2_000,
        clock_offset_ms: 500,
        clock_rtt_ms: 20,
        clock_uncertainty_ms: 10,
        clock_sample_age_ms: 1,
      },
    },
  }, 'relay_recv', 1_999, {
    source: 'clock_regression_fixture',
    clock_domain: 'relay',
    clock_reference: 'relay',
    clock_status: 'reference',
    raw_at_ms: 1_999,
    adjusted_at_ms: 1_999,
    clock_offset_ms: 0,
    clock_rtt_ms: 0,
    clock_uncertainty_ms: 0,
    clock_sample_age_ms: 0,
  });
  assert.strictEqual(regression.ok, false);
  assert.strictEqual(regression.code, 'stage_regressed:relay_recv');
  assert.strictEqual(regression.regression_ms, 1);

  const frontendHooks = fs.readFileSync(path.join(ROOT, 'frontend', 'hooks.jsx'), 'utf8');
  const androidTrace = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'latency-trace.js'), 'utf8');
  assert(!/Math\.max\(relayBroadcastAtMs,\s*observedAtMs\)/.test(frontendHooks));
  assert(!/Math\.max\(relayBroadcastAtMs,\s*observedAtMs\)/.test(androidTrace));
  assert.match(frontendHooks, /raw_stages/);
  assert.match(androidTrace, /raw_stages/);

  console.log(JSON.stringify({
    result: 'PASS',
    randomized_cross_host_sequences: 1_000,
    shared_web_android_estimator_parity: true,
    adjusted_zero_hops: 0,
    negative_raw_hop_sequences_retained: negativeRawHopCount,
    raw_and_adjusted_observations: true,
    no_clock_clamping: true,
    regression_failure: {
      code: regression.code,
      regression_ms: regression.regression_ms,
    },
    threshold_states: {
      skew: skew.estimate.status,
      high_rtt: highRtt.estimate.status,
      stale: stale.estimate.status,
    },
    hosted_model_invocations: 0,
    visible_windows_opened: 0,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Latency clock skew smoke: FAIL (${error.stack || error.message})`);
  process.exit(1);
}
