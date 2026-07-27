'use strict';

const LATENCY_CLOCK_SCHEMA_VERSION = 1;
const LATENCY_CLOCK_SKEW_THRESHOLD_MS = 1_000;
const LATENCY_CLOCK_RTT_THRESHOLD_MS = 2_000;
const LATENCY_CLOCK_SAMPLE_MAX_AGE_MS = 60_000;

function finiteEpochMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function roundedMs(value) {
  return Math.round(Number(value) * 1_000) / 1_000;
}

function estimateRelayClockOffset({
  clientSentAtMs,
  relayReceivedAtMs,
  relaySentAtMs,
  clientReceivedAtMs,
} = {}) {
  const t0 = finiteEpochMs(clientSentAtMs);
  const t1 = finiteEpochMs(relayReceivedAtMs);
  const t2 = finiteEpochMs(relaySentAtMs);
  const t3 = finiteEpochMs(clientReceivedAtMs);
  if ([t0, t1, t2, t3].some(value => value === null)) {
    return { ok: false, code: 'clock_sample_timestamp_invalid' };
  }
  if (t2 < t1) return { ok: false, code: 'clock_sample_relay_regressed' };
  if (t3 < t0) return { ok: false, code: 'clock_sample_client_regressed' };
  const relayProcessingMs = t2 - t1;
  const rttMs = (t3 - t0) - relayProcessingMs;
  if (rttMs < 0) return { ok: false, code: 'clock_sample_negative_rtt' };
  const offsetMs = ((t1 - t0) + (t2 - t3)) / 2;
  const uncertaintyMs = rttMs / 2;
  const status = rttMs > LATENCY_CLOCK_RTT_THRESHOLD_MS
    ? 'rtt_threshold_exceeded'
    : Math.abs(offsetMs) > LATENCY_CLOCK_SKEW_THRESHOLD_MS
      ? 'skew_threshold_exceeded'
      : 'synchronized';
  return {
    ok: true,
    estimate: {
      schema_version: LATENCY_CLOCK_SCHEMA_VERSION,
      status,
      reference_clock: 'relay',
      offset_ms: roundedMs(offsetMs),
      rtt_ms: roundedMs(rttMs),
      uncertainty_ms: roundedMs(uncertaintyMs),
      client_sent_at_ms: t0,
      relay_received_at_ms: t1,
      relay_sent_at_ms: t2,
      client_received_at_ms: t3,
      sampled_at_ms: t3,
    },
  };
}

function normalizeRelayClockEstimate(raw, {
  nowMs = Date.now(),
  maxAgeMs = LATENCY_CLOCK_SAMPLE_MAX_AGE_MS,
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'clock_sample_missing' };
  }
  const recalculated = estimateRelayClockOffset({
    clientSentAtMs: raw.client_sent_at_ms,
    relayReceivedAtMs: raw.relay_received_at_ms,
    relaySentAtMs: raw.relay_sent_at_ms,
    clientReceivedAtMs: raw.client_received_at_ms,
  });
  if (!recalculated.ok) return recalculated;
  const estimate = recalculated.estimate;
  const now = finiteEpochMs(nowMs);
  if (now === null) return { ok: false, code: 'clock_sample_now_invalid' };
  const ageMs = Math.max(0, now - estimate.sampled_at_ms);
  if (ageMs > Math.max(1, Number(maxAgeMs) || LATENCY_CLOCK_SAMPLE_MAX_AGE_MS)) {
    return {
      ok: true,
      estimate: { ...estimate, status: 'stale', age_ms: roundedMs(ageMs) },
    };
  }
  return {
    ok: true,
    estimate: { ...estimate, age_ms: roundedMs(ageMs) },
  };
}

function relayClockStageObservation(observedAtMs, clockDomain, estimate = null, {
  nowMs = observedAtMs,
} = {}) {
  const rawAtMs = finiteEpochMs(observedAtMs);
  if (rawAtMs === null) return { ok: false, code: 'stage_timestamp_invalid' };
  const domain = String(clockDomain || '').trim().toLowerCase();
  if (!domain) return { ok: false, code: 'clock_domain_missing' };
  if (domain === 'relay') {
    return {
      ok: true,
      ranking_eligible: true,
      adjusted_at_ms: rawAtMs,
      source: {
        clock_domain: 'relay',
        clock_reference: 'relay',
        clock_status: 'reference',
        raw_at_ms: rawAtMs,
        adjusted_at_ms: rawAtMs,
        clock_offset_ms: 0,
        clock_rtt_ms: 0,
        clock_uncertainty_ms: 0,
        clock_sample_age_ms: 0,
      },
    };
  }
  const normalized = normalizeRelayClockEstimate(estimate, { nowMs });
  if (!normalized.ok) {
    return {
      ok: true,
      ranking_eligible: false,
      adjusted_at_ms: rawAtMs,
      source: {
        clock_domain: domain,
        clock_reference: 'relay',
        clock_status: normalized.code,
        raw_at_ms: rawAtMs,
        adjusted_at_ms: rawAtMs,
      },
    };
  }
  const clock = normalized.estimate;
  const adjustedAtMs = roundedMs(rawAtMs + clock.offset_ms);
  return {
    ok: true,
    ranking_eligible: clock.status === 'synchronized',
    adjusted_at_ms: adjustedAtMs,
    source: {
      clock_domain: domain,
      clock_reference: 'relay',
      clock_status: clock.status,
      raw_at_ms: rawAtMs,
      adjusted_at_ms: adjustedAtMs,
      clock_offset_ms: clock.offset_ms,
      clock_rtt_ms: clock.rtt_ms,
      clock_uncertainty_ms: clock.uncertainty_ms,
      clock_sample_age_ms: clock.age_ms,
    },
  };
}

module.exports = {
  LATENCY_CLOCK_RTT_THRESHOLD_MS,
  LATENCY_CLOCK_SAMPLE_MAX_AGE_MS,
  LATENCY_CLOCK_SCHEMA_VERSION,
  LATENCY_CLOCK_SKEW_THRESHOLD_MS,
  estimateRelayClockOffset,
  normalizeRelayClockEstimate,
  relayClockStageObservation,
};
