#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const TEMPORAL_DETECTION_CLASSES = Object.freeze([
  'temporal_scroll_oscillation',
  'false_prompt_lifecycle_oscillation',
  'canonical_session_duplication',
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(detectionClass, evidence) {
  const safeEvidence = {
    session_id: evidence.session_id || null,
    canonical_conversation_id: evidence.canonical_conversation_id || null,
    prompt_id: evidence.prompt_id || null,
    prompt_generation: evidence.prompt_generation ?? null,
    writers: [...new Set(evidence.writers || [])].sort(),
    owner_surfaces: [...new Set(evidence.owner_surfaces || [])].sort(),
  };
  return crypto.createHash('sha256')
    .update(`${detectionClass}\u0000${stableJson(safeEvidence)}`)
    .digest('hex');
}

function normalizeSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .filter(sample => sample && typeof sample === 'object')
    .map((sample, index) => ({
      ...sample,
      at_epoch_ms: number(sample.at_epoch_ms ?? sample.at_ms, index),
      refresh_sequence: number(sample.refresh_sequence ?? sample.relay_frame_sequence, 0),
      scroll_top: number(sample.scroll_top ?? sample.after_scroll_top ?? sample.requested_scroll_top, 0),
      canonical_card_count: number(sample.canonical_card_count, 1),
      prompt_count: number(sample.prompt_count, sample.prompt_id ? 1 : 0),
      user_scroll_epoch: number(sample.user_scroll_epoch, 0),
    }))
    .sort((left, right) => left.at_epoch_ms - right.at_epoch_ms || left.refresh_sequence - right.refresh_sequence);
}

function settledSnapshotAudit(samples) {
  const ordered = normalizeSamples(samples);
  if (ordered.length < 2) return { ok: false, reason: 'insufficient_samples' };
  const first = ordered[0];
  const last = ordered.at(-1);
  const same = (field, tolerance = 0) => Math.abs(number(first[field]) - number(last[field])) <= tolerance;
  return {
    ok: same('scroll_top', 1)
      && same('anchor_offset_px', 1)
      && first.prompt_id === last.prompt_id
      && first.canonical_card_count === last.canonical_card_count,
    compared_samples: 2,
    ignored_intermediate_samples: Math.max(0, ordered.length - 2),
  };
}

function analyzeTemporalTrace(input = {}) {
  const samples = normalizeSamples(input.samples);
  const truth = input.truth && typeof input.truth === 'object' ? input.truth : {};
  const nativePrompts = new Set((truth.native_prompts || []).map(prompt => (
    `${prompt.prompt_id || ''}\u0000${prompt.generation ?? ''}`
  )));
  const allowedScrollIds = new Set(truth.allowed_scroll_event_ids || []);
  const findings = [];
  const push = (detectionClass, message, evidence) => {
    const finding = {
      detection_class: detectionClass,
      severity: 'P0',
      message,
      evidence,
    };
    finding.fingerprint = fingerprint(detectionClass, evidence);
    findings.push(finding);
  };

  const isScrollWrite = sample => sample.phase === 'programmatic_scroll_write' || sample.scroll_write;
  const seenPromptNavigations = new Set();
  const authorizationBySample = new WeakMap();
  for (const sample of samples) {
    let authorized = !!(
      sample.intentional_navigation
      || sample.intentional_live_edge_append
      || sample.selected_session_change
      || (sample.event_id && allowedScrollIds.has(sample.event_id))
    );
    if (isScrollWrite(sample) && sample.reason === 'genuine_prompt_navigation') {
      const key = `${sample.prompt_id || ''}\u0000${sample.prompt_generation ?? ''}`;
      authorized = nativePrompts.has(key) && !seenPromptNavigations.has(key);
      if (authorized) seenPromptNavigations.add(key);
    }
    authorizationBySample.set(sample, authorized);
  }
  const isAuthorizedTransition = sample => authorizationBySample.get(sample) === true;
  const unauthorizedWrites = samples.filter(sample => isScrollWrite(sample) && !isAuthorizedTransition(sample));
  const stableSamples = samples;
  const start = stableSamples[0];
  const jumps = [];
  let stabilityBaseline = start;
  for (const sample of stableSamples.slice(1)) {
    if (isAuthorizedTransition(sample)) {
      stabilityBaseline = sample;
      continue;
    }
    if (!stabilityBaseline || sample.user_scroll_epoch !== stabilityBaseline.user_scroll_epoch) {
      stabilityBaseline = sample;
      continue;
    }
    if (Math.abs(number(sample.scroll_top) - number(stabilityBaseline.scroll_top)) > 1
      || (sample.anchor_key && sample.anchor_key === stabilityBaseline.anchor_key
        && Math.abs(number(sample.anchor_offset_px) - number(stabilityBaseline.anchor_offset_px)) > 1)) {
      jumps.push(sample);
    }
  }
  const directions = [];
  let directionSegment = 0;
  for (let index = 1; index < stableSamples.length; index += 1) {
    const previous = stableSamples[index - 1];
    const current = stableSamples[index];
    if (isAuthorizedTransition(current) || current.user_scroll_epoch !== previous.user_scroll_epoch) {
      directionSegment += 1;
      continue;
    }
    const delta = current.scroll_top - previous.scroll_top;
    if (Math.abs(delta) > 1) directions.push({ at: current.at_epoch_ms, direction: Math.sign(delta), segment: directionSegment });
  }
  const reversals = directions.filter((entry, index) => index > 0
    && entry.segment === directions[index - 1].segment
    && entry.direction !== directions[index - 1].direction);
  const reversalWindow = reversals.some(entry => (
    reversals.filter(candidate => candidate.segment === entry.segment
      && candidate.at >= entry.at - 2_000 && candidate.at <= entry.at).length >= 3
  ));
  if (unauthorizedWrites.length || jumps.length || reversalWindow) {
    const firstFailure = [...unauthorizedWrites, ...jumps].sort((a, b) => a.at_epoch_ms - b.at_epoch_ms)[0]
      || reversals[0] || start || {};
    push('temporal_scroll_oscillation',
      'Transcript moved without a genuine prompt, explicit navigation, selected-session change, or live-edge append', {
        at_epoch_ms: firstFailure.at_epoch_ms || null,
        session_id: firstFailure.session_id || truth.session_id || null,
        canonical_conversation_id: firstFailure.canonical_conversation_id || truth.canonical_conversation_id || null,
        max_scroll_drift_px: start ? Math.max(0, ...stableSamples.map(sample => Math.abs(sample.scroll_top - start.scroll_top))) : 0,
        max_anchor_drift_px: start ? Math.max(0, ...stableSamples.map(sample => (
          sample.anchor_key === start.anchor_key
            ? Math.abs(number(sample.anchor_offset_px) - number(start.anchor_offset_px)) : 0
        ))) : 0,
        unauthorized_scroll_writes: unauthorizedWrites.length,
        direction_reversals: reversals.length,
        reversal_window: reversalWindow,
        writers: unauthorizedWrites.map(sample => sample.writer || sample.reason || 'unattributed_programmatic'),
      });
  }

  const falsePrompts = samples.filter(sample => {
    if (!sample.prompt_id && sample.prompt_count <= 0) return false;
    const key = `${sample.prompt_id || ''}\u0000${sample.prompt_generation ?? ''}`;
    return !nativePrompts.has(key) || sample.prompt_source === 'inferred_goal_state';
  });
  const lifecycleSamples = samples.filter(sample => sample.lifecycle || sample.status);
  const lifecycleOscillates = lifecycleSamples.some((sample, index) => {
    if (index === 0) return false;
    const value = String(sample.lifecycle || sample.status || '');
    const previous = String(lifecycleSamples[index - 1].lifecycle || lifecycleSamples[index - 1].status || '');
    if (!((value === 'paused' && previous === 'waiting_for_user')
      || (value === 'waiting_for_user' && previous === 'paused'))) return false;
    const waiting = value === 'waiting_for_user' ? sample : lifecycleSamples[index - 1];
    const key = `${waiting.prompt_id || ''}\u0000${waiting.prompt_generation ?? ''}`;
    return !nativePrompts.has(key);
  });
  if (falsePrompts.length || lifecycleOscillates) {
    const firstFailure = falsePrompts[0] || samples.find(sample => sample.lifecycle || sample.status) || {};
    push('false_prompt_lifecycle_oscillation',
      'Rendered prompt or waiting lifecycle is not backed by the producer-side native prompt ledger', {
        at_epoch_ms: firstFailure.at_epoch_ms || null,
        session_id: firstFailure.session_id || truth.session_id || null,
        canonical_conversation_id: firstFailure.canonical_conversation_id || truth.canonical_conversation_id || null,
        prompt_id: firstFailure.prompt_id || null,
        prompt_generation: firstFailure.prompt_generation ?? null,
        prompt_source: firstFailure.prompt_source || null,
        false_prompt_samples: falsePrompts.length,
        lifecycle_oscillation: lifecycleOscillates,
      });
  }

  const duplicateSamples = samples.filter(sample => {
    if (sample.canonical_card_count > 1) return true;
    const rows = Array.isArray(sample.canonical_rows) ? sample.canonical_rows : [];
    const byCanonical = new Map();
    for (const row of rows) {
      const canonical = String(row.canonical_conversation_id || '');
      if (!canonical) continue;
      if (!byCanonical.has(canonical)) byCanonical.set(canonical, []);
      byCanonical.get(canonical).push(row);
    }
    return [...byCanonical.values()].some(group => group.length > 1)
      || rows.some(row => row.owner_verified === false && row.surface === 'codex_cli');
  });
  if (duplicateSamples.length) {
    const firstFailure = duplicateSamples[0];
    const rows = Array.isArray(firstFailure.canonical_rows) ? firstFailure.canonical_rows : [];
    push('canonical_session_duplication',
      'One canonical native conversation is projected as multiple session rows or an unowned CLI alias', {
        at_epoch_ms: firstFailure.at_epoch_ms || null,
        session_id: firstFailure.session_id || truth.session_id || null,
        canonical_conversation_id: firstFailure.canonical_conversation_id || truth.canonical_conversation_id || null,
        canonical_card_count: firstFailure.canonical_card_count,
        owner_surfaces: rows.map(row => row.surface || 'unknown'),
        owner_evidence_gap: rows.some(row => row.owner_verified === false),
      });
  }

  if (number(input.dropped_samples, 0) > 0) {
    push('temporal_scroll_oscillation', 'Temporal observer dropped samples and cannot produce a green result', {
      session_id: truth.session_id || null,
      canonical_conversation_id: truth.canonical_conversation_id || null,
      dropped_samples: number(input.dropped_samples, 0),
      writers: [],
    });
  }

  const unique = [...new Map(findings.map(item => [item.fingerprint, item])).values()];
  const firstFailureAt = Math.min(...unique.map(item => number(item.evidence.at_epoch_ms, Number.MAX_SAFE_INTEGER)));
  const firstFailureSample = Number.isFinite(firstFailureAt)
    ? samples.find(sample => sample.at_epoch_ms >= firstFailureAt) : null;
  return {
    ok: unique.length === 0,
    sample_count: samples.length,
    dropped_samples: number(input.dropped_samples, 0),
    detected_classes: [...new Set(unique.map(item => item.detection_class))].sort(),
    first_failure_at_epoch_ms: Number.isFinite(firstFailureAt) ? firstFailureAt : null,
    refreshes_to_failure: firstFailureSample ? firstFailureSample.refresh_sequence : null,
    findings: unique,
  };
}

module.exports = {
  TEMPORAL_DETECTION_CLASSES,
  analyzeTemporalTrace,
  fingerprint,
  settledSnapshotAudit,
};
