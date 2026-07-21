#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  TEMPORAL_DETECTION_CLASSES,
  analyzeTemporalTrace,
  settledSnapshotAudit,
} = require('./chat-stability-temporal-contract');

const base = {
  session_id: 'fixture-session', canonical_conversation_id: 'codex:fixture-thread',
  anchor_key: 'message-2000', anchor_offset_px: -24, user_scroll_epoch: 7,
  lifecycle: 'paused', prompt_id: null, prompt_count: 0, canonical_card_count: 1,
  canonical_rows: [{ surface: 'codex-desktop', canonical_conversation_id: 'codex:fixture-thread', owner_verified: true }],
};
const gifShaped = [
  { ...base, at_epoch_ms: 0, refresh_sequence: 0, scroll_top: 70_000 },
  { ...base, at_epoch_ms: 450, refresh_sequence: 1, scroll_top: 0,
    phase: 'programmatic_scroll_write', scroll_write: true, writer: 'prompt_transition',
    reason: 'inferred_goal_prompt', lifecycle: 'waiting_for_user', prompt_id: 'false-goal-prompt',
    prompt_generation: 12, prompt_source: 'inferred_goal_state', prompt_count: 1 },
  { ...base, at_epoch_ms: 850, refresh_sequence: 1, scroll_top: 70_000,
    phase: 'programmatic_scroll_write', scroll_write: true, writer: 'live_edge_anchor', reason: 'live_history_refresh' },
  { ...base, at_epoch_ms: 1_250, refresh_sequence: 2, scroll_top: 0,
    phase: 'programmatic_scroll_write', scroll_write: true, writer: 'prompt_transition',
    lifecycle: 'waiting_for_user', prompt_id: 'false-goal-prompt', prompt_generation: 12,
    prompt_source: 'inferred_goal_state', prompt_count: 1, canonical_card_count: 2,
    canonical_rows: [
      { surface: 'codex-desktop', canonical_conversation_id: 'codex:fixture-thread', owner_verified: true },
      { surface: 'codex_cli', canonical_conversation_id: 'codex:fixture-thread', owner_verified: false },
    ] },
  { ...base, at_epoch_ms: 1_650, refresh_sequence: 2, scroll_top: 70_000,
    phase: 'programmatic_scroll_write', scroll_write: true, writer: 'live_edge_anchor', reason: 'live_history_refresh' },
  { ...base, at_epoch_ms: 2_100, refresh_sequence: 2, scroll_top: 70_000 },
];

const oldAudit = settledSnapshotAudit(gifShaped);
assert.strictEqual(oldAudit.ok, true, 'the settled before/after audit must reproduce its false green');
assert(oldAudit.ignored_intermediate_samples >= 4);
const detected = analyzeTemporalTrace({
  samples: gifShaped,
  truth: { session_id: base.session_id, canonical_conversation_id: base.canonical_conversation_id, native_prompts: [] },
});
assert.strictEqual(detected.ok, false);
assert.deepStrictEqual(detected.detected_classes, [...TEMPORAL_DETECTION_CLASSES].sort());
assert(detected.refreshes_to_failure <= 2, 'seeded defect was not detected within two refreshes');
assert(detected.first_failure_at_epoch_ms <= 5_000, 'seeded defect was not detected within five seconds');
const scroll = detected.findings.find(item => item.detection_class === 'temporal_scroll_oscillation');
assert.deepStrictEqual(scroll.evidence.writers.sort(), ['live_edge_anchor', 'live_edge_anchor', 'prompt_transition', 'prompt_transition'].sort());

const genuinePrompt = [
  { ...base, at_epoch_ms: 0, refresh_sequence: 0, scroll_top: 70_000 },
  { ...base, at_epoch_ms: 400, refresh_sequence: 1, scroll_top: 0,
    phase: 'programmatic_scroll_write', scroll_write: true, reason: 'genuine_prompt_navigation',
    event_id: 'prompt-nav-1', prompt_id: 'native-q-1', prompt_generation: 3,
    prompt_source: 'native', prompt_count: 1, lifecycle: 'waiting_for_user' },
  { ...base, at_epoch_ms: 900, refresh_sequence: 2, scroll_top: 0,
    prompt_id: 'native-q-1', prompt_generation: 3, prompt_source: 'native', prompt_count: 1,
    lifecycle: 'waiting_for_user' },
];
const genuineResult = analyzeTemporalTrace({
  samples: genuinePrompt,
  truth: {
    session_id: base.session_id,
    canonical_conversation_id: base.canonical_conversation_id,
    native_prompts: [{ prompt_id: 'native-q-1', generation: 3 }],
    allowed_scroll_event_ids: ['prompt-nav-1'],
  },
});
assert.strictEqual(genuineResult.ok, true, 'one exact native prompt navigation must be allowed');

const repeatedPromptNavigation = [...genuinePrompt, {
  ...genuinePrompt[1], at_epoch_ms: 1_300, refresh_sequence: 3, event_id: 'prompt-nav-replay',
}];
const repeatedPromptResult = analyzeTemporalTrace({
  samples: repeatedPromptNavigation,
  truth: {
    session_id: base.session_id,
    canonical_conversation_id: base.canonical_conversation_id,
    native_prompts: [{ prompt_id: 'native-q-1', generation: 3 }],
    allowed_scroll_event_ids: ['prompt-nav-1', 'prompt-nav-replay'],
  },
});
assert.strictEqual(repeatedPromptResult.ok, false, 'one native prompt identity may navigate only once');
assert.strictEqual(repeatedPromptResult.findings[0].evidence.unauthorized_scroll_writes, 1);

const liveEdgeAppend = [
  { ...base, at_epoch_ms: 0, refresh_sequence: 0, scroll_top: 70_000 },
  { ...base, at_epoch_ms: 400, refresh_sequence: 1, scroll_top: 70_120,
    phase: 'programmatic_scroll_write', scroll_write: true, intentional_live_edge_append: true },
  { ...base, at_epoch_ms: 900, refresh_sequence: 2, scroll_top: 70_120 },
];
assert.strictEqual(analyzeTemporalTrace({ samples: liveEdgeAppend, truth: { native_prompts: [] } }).ok, true,
  'an intentional live-edge append must establish the next stability baseline');

const stable = Array.from({ length: 1_000 }, (_, index) => ({
  ...base, at_epoch_ms: index * 100, refresh_sequence: Math.floor(index / 10), scroll_top: 70_000,
}));
assert.strictEqual(analyzeTemporalTrace({ samples: stable, truth: { native_prompts: [] } }).ok, true);

process.stdout.write(`${JSON.stringify({
  ok: true,
  old_settled_audit_false_green: oldAudit.ok,
  detection_within_refreshes: detected.refreshes_to_failure,
  detection_within_ms: detected.first_failure_at_epoch_ms,
  detected_classes: detected.detected_classes,
  competing_scroll_writers: scroll.evidence.writers,
  genuine_prompt_exactly_once: true,
  repeated_prompt_navigation_rejected: true,
  live_edge_baseline_preserved: true,
  stable_samples: stable.length,
}, null, 2)}\n`);
