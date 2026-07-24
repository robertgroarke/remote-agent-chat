#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  NATIVE_DEADLINE_RECEIPT_GRACE_MS,
  QuestionPromptRegistry,
  adaptLegacyQuestionPermissionPrompt,
  questionPromptDeadlineGraceMs,
} = require('../relay-server/question-prompt-registry');
const { canonicalQuestionResponse } = require('../shared/question-prompt-contract');

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code, `expected ${code}`);
}

let clock = Date.parse('2026-07-15T20:00:00.000Z');
const registry = new QuestionPromptRegistry({ now: () => clock, maxEntries: 1024 });

function prompt(surface, index, overrides = {}) {
  return {
    type: 'question_prompt',
    contract_version: 1,
    prompt_id: overrides.prompt_id || crypto.randomUUID(),
    session_id: overrides.session_id || `${surface}-session`,
    generation: overrides.generation || `${surface}-generation-${index}`,
    kind: overrides.kind || 'request_user_input',
    source: { surface, version: overrides.version || 'test-version' },
    title: 'Question',
    questions: overrides.questions || [{
      id: 'choice',
      header: 'Choice',
      question: 'Choose one.',
      options: [
        { id: 'yes', label: 'Yes', description: 'Continue.' },
        { id: 'no', label: 'No', description: 'Stop.' },
      ],
    }],
    observed_at: new Date(clock).toISOString(),
    deadline_at: overrides.deadline_at || null,
    auto_resolution_ms: overrides.auto_resolution_ms ?? null,
    auto_resolution_policy: overrides.auto_resolution_policy ?? null,
    cancel_supported: overrides.cancel_supported === true,
  };
}

function response(openPrompt, requestId, overrides = {}) {
  return {
    type: 'question_response',
    request_id: requestId,
    prompt_id: openPrompt.prompt_id,
    session_id: openPrompt.session_id,
    generation: overrides.generation || openPrompt.generation,
    action: overrides.action || 'answer',
    answers: overrides.answers || [{ question_id: 'choice', choice_ids: [openPrompt.questions[0].choices[0].choice_id] }],
  };
}

let opened = 0;
let duplicateFrames = 0;
let duplicateClaimsRejected = 0;
let wrongGenerationsRejected = 0;
for (const surface of ['codex_cli', 'codex', 'codex-desktop']) {
  for (let index = 0; index < 60; index += 1) {
    const result = registry.open(prompt(surface, index));
    assert.strictEqual(result.status, 'opened');
    opened += 1;
    const openPrompt = result.prompt;
    assert.strictEqual(registry.open(openPrompt).status, 'duplicate');
    duplicateFrames += 1;
    expectCode(() => registry.claim(response(openPrompt, `${surface}-wrong-${index}`, {
      generation: `${openPrompt.generation}-stale`,
    })), 'stale_generation');
    wrongGenerationsRejected += 1;
    const requestId = `${surface}-request-${index}`;
    const claimed = registry.claim(response(openPrompt, requestId));
    assert.strictEqual(claimed.prompt.lifecycle, 'submitting');
    expectCode(() => registry.claim(response(openPrompt, `${surface}-duplicate-${index}`)), 'prompt_already_claimed');
    duplicateClaimsRejected += 1;
    registry.markForwarded(requestId);
    const terminal = registry.resolve(requestId, { ok: true });
    assert.strictEqual(terminal.lifecycle, 'answered');
    assert.ok(!registry.views().some(view => view.prompt_id === openPrompt.prompt_id));
  }
}

const persistedTombstones = [];
const durableRegistry = new QuestionPromptRegistry({
  now: () => clock,
  maxEntries: 2048,
  tombstoneTtlMs: 30 * 24 * 60 * 60 * 1000,
  onTombstone: tombstone => persistedTombstones.push(tombstone),
});
const durablePrompt = prompt('codex_cli', 4000, {
  session_id: 'durable-terminal-session',
  prompt_id: 'durable-native-prompt',
  generation: 'durable-native-turn',
});
assert.strictEqual(durableRegistry.open(durablePrompt).status, 'opened');
assert.strictEqual(durableRegistry.terminalFromSource({
  session_id: durablePrompt.session_id,
  prompt_id: durablePrompt.prompt_id,
  generation: durablePrompt.generation,
  lifecycle: 'cancelled',
}).lifecycle, 'cancelled');
assert.strictEqual(persistedTombstones.length, 1);
const restartedRegistry = new QuestionPromptRegistry({
  now: () => clock,
  maxEntries: 2048,
  tombstoneTtlMs: 30 * 24 * 60 * 60 * 1000,
  initialTombstones: persistedTombstones,
});
for (let replay = 0; replay < 1000; replay += 1) {
  const terminalDuplicate = restartedRegistry.open(durablePrompt);
  assert.strictEqual(terminalDuplicate.status, 'terminal_duplicate');
  assert.strictEqual(terminalDuplicate.prompt.lifecycle, 'cancelled');
}
const terminalBeforeOpen = prompt('codex-desktop', 4001, {
  session_id: 'terminal-before-open-session',
  prompt_id: 'terminal-before-open-prompt',
  generation: 'terminal-before-open-turn',
});
assert.strictEqual(restartedRegistry.terminalFromSource({
  session_id: terminalBeforeOpen.session_id,
  prompt_id: terminalBeforeOpen.prompt_id,
  generation: terminalBeforeOpen.generation,
  lifecycle: 'answered',
}).lifecycle, 'answered');
assert.strictEqual(restartedRegistry.open(terminalBeforeOpen).status, 'terminal_duplicate');

const secretResult = registry.open(prompt('codex_cli', 999, {
  questions: [{
    id: 'secret', header: 'Secret', question: 'Enter a secret.', options: null, isSecret: true,
  }],
}));
const secretValue = 'never-persist-this-secret';
const secretRequestId = 'secret-request-001';
registry.claim(response(secretResult.prompt, secretRequestId, {
  answers: [{ question_id: 'secret', text: secretValue }],
}));
assert.ok(!JSON.stringify(registry.views({ includeTerminal: true })).includes(secretValue));
registry.markForwarded(secretRequestId);
assert.strictEqual(registry.resolve(secretRequestId, { ok: true }).lifecycle, 'answered');

const cancellable = registry.open(prompt('codex', 998, {
  session_id: 'cancel-session',
  cancel_supported: true,
})).prompt;
const rawCancel = {
  type: 'question_response',
  request_id: 'cancel-request-001',
  prompt_id: cancellable.prompt_id,
  session_id: cancellable.session_id,
  generation: cancellable.generation,
  action: 'cancel',
};
const canonicalCancel = canonicalQuestionResponse(cancellable, rawCancel);
assert.strictEqual(Object.hasOwn(canonicalCancel, 'answers'), false,
  'canonical cancel must not serialize forbidden answers');
assert.deepStrictEqual(canonicalQuestionResponse(cancellable, canonicalCancel), canonicalCancel,
  'canonical cancel must be idempotent across relay and proxy validation');
expectCode(() => canonicalQuestionResponse(cancellable, { ...rawCancel, answers: [] }), 'cancel_with_answers');
const claimedCancel = registry.claim(rawCancel);
assert.strictEqual(Object.hasOwn(claimedCancel.response, 'answers'), false);
registry.markForwarded(rawCancel.request_id);
assert.strictEqual(registry.resolve(rawCancel.request_id, { ok: true, lifecycle: 'cancelled' }).lifecycle, 'cancelled');

const disconnected = registry.open(prompt('codex', 1000, { session_id: 'disconnect-session' })).prompt;
const failed = registry.failSession(disconnected.session_id);
assert.strictEqual(failed.length, 1);
assert.strictEqual(failed[0].lifecycle, 'failed');
expectCode(() => registry.claim(response(disconnected, 'disconnected-late-response')), 'prompt_already_claimed');

const reconnectOpen = registry.open(prompt('codex', 1002, { session_id: 'reconnect-open-session' })).prompt;
assert.deepStrictEqual(registry.disconnectSession(reconnectOpen.session_id), []);
assert.strictEqual(registry.get(reconnectOpen.session_id, reconnectOpen.prompt_id).lifecycle, 'open');
assert.strictEqual(registry.open(reconnectOpen).status, 'duplicate');

const reconnectSubmitting = registry.open(prompt('codex_cli', 1003, { session_id: 'reconnect-submit-session' })).prompt;
registry.claim(response(reconnectSubmitting, 'reconnect-submit-request'));
registry.markForwarded('reconnect-submit-request');
const reconnectFailed = registry.disconnectSession(reconnectSubmitting.session_id);
assert.strictEqual(reconnectFailed[0].lifecycle, 'failed');
assert.strictEqual(reconnectFailed[0].error_code, 'adapter_disconnected_during_submit');

const timeoutSubmitting = registry.open(prompt('codex', 1004, { session_id: 'submit-timeout-session' })).prompt;
registry.claim(response(timeoutSubmitting, 'submit-timeout-request'));
registry.markForwarded('submit-timeout-request');
clock += 120001;
const timedOut = registry.timeoutSubmitting(clock, 120000);
assert.strictEqual(timedOut[0].lifecycle, 'failed');
assert.strictEqual(timedOut[0].error_code, 'native_receipt_timeout');
assert.strictEqual(registry.open(timeoutSubmitting).prompt.lifecycle, 'failed', 'duplicate terminal frame must not reopen');

const deadline = new Date(clock + 1000).toISOString();
const expiring = registry.open(prompt('codex-desktop', 1001, {
  session_id: 'deadline-session', deadline_at: deadline, auto_resolution_ms: 1000,
  auto_resolution_policy: 'native',
})).prompt;
clock += 1001;
expectCode(() => registry.claim(response(expiring, 'deadline-late-response')), 'prompt_expired');
assert.strictEqual(questionPromptDeadlineGraceMs(expiring), NATIVE_DEADLINE_RECEIPT_GRACE_MS);
assert.strictEqual(NATIVE_DEADLINE_RECEIPT_GRACE_MS, 15000,
  'native receipt-only grace does not cover the measured 8.98s proxy delivery tail');
assert.strictEqual(registry.get(expiring.session_id, expiring.prompt_id).lifecycle, 'open',
  'a late browser response must not beat the native deadline receipt during its bounded grace');
assert.strictEqual(registry.terminalFromSource({
  session_id: expiring.session_id,
  prompt_id: expiring.prompt_id,
  generation: expiring.generation,
  lifecycle: 'auto_resolved',
  error_code: 'native_auto_resolution',
}).lifecycle, 'auto_resolved');

const missingReceiptDeadline = new Date(clock + 1000).toISOString();
const missingReceipt = registry.open(prompt('codex', 1005, {
  session_id: 'deadline-missing-receipt-session',
  deadline_at: missingReceiptDeadline,
  auto_resolution_ms: 1000,
  auto_resolution_policy: 'native',
})).prompt;
clock += 1000 + NATIVE_DEADLINE_RECEIPT_GRACE_MS + 1;
expectCode(() => registry.claim(response(missingReceipt, 'deadline-missing-receipt-late')), 'prompt_expired');
assert.strictEqual(registry.get(missingReceipt.session_id, missingReceipt.prompt_id).lifecycle, 'expired');

const legacy = adaptLegacyQuestionPermissionPrompt({
  type: 'permission_prompt',
  kind: 'question',
  prompt_id: 'legacy-question-001',
  session_id: 'legacy-session',
  agent_type: 'codex',
  questions: [{
    question_id: 'legacy-choice',
    label: 'Legacy choice',
    message: 'Choose one.',
    choices: [
      { choice_id: 'a', label: 'A', description: 'First.' },
      { choice_id: 'other', label: 'Other', description: 'Another.', requires_text: true },
    ],
  }],
});
assert.strictEqual(legacy.type, 'question_prompt');
assert.strictEqual(legacy.kind, 'request_user_input');
assert.ok(!JSON.stringify(legacy).includes('permission_response'));

const deployedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-question-relay-layout-'));
let deployedLayoutLoaded = false;
try {
  fs.mkdirSync(path.join(deployedRoot, 'shared'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'relay-server', 'question-contract-loader.js'),
    path.join(deployedRoot, 'question-contract-loader.js'),
  );
  fs.copyFileSync(
    path.join(__dirname, '..', 'relay-server', 'question-prompt-registry.js'),
    path.join(deployedRoot, 'question-prompt-registry.js'),
  );
  fs.copyFileSync(
    path.join(__dirname, '..', 'shared', 'question-prompt-contract.js'),
    path.join(deployedRoot, 'shared', 'question-prompt-contract.js'),
  );
  const { QuestionPromptRegistry: DeployedQuestionPromptRegistry } = require(path.join(
    deployedRoot,
    'question-prompt-registry.js',
  ));
  const deployedRegistry = new DeployedQuestionPromptRegistry({ now: () => clock });
  assert.strictEqual(deployedRegistry.open(prompt('codex-desktop', 2000)).status, 'opened');
  deployedLayoutLoaded = true;
} finally {
  fs.rmSync(deployedRoot, { recursive: true, force: true });
}

const deploySource = fs.readFileSync(path.join(__dirname, 'rebuild_unraid_docker.py'), 'utf8');
assert.match(deploySource, /Syncing shared runtime contracts/);
assert.match(deploySource, /os\.path\.join\(SOURCE_ROOT, 'shared'\)/);
assert.match(deploySource, /f'\{relay_path\}\/shared'/);

console.log(JSON.stringify({
  result: 'PASS',
  relay_prompts: opened,
  per_adapter: 60,
  duplicate_frames_deduplicated: duplicateFrames,
  duplicate_claims_rejected: duplicateClaimsRejected,
  wrong_generations_rejected: wrongGenerationsRejected,
  secret_snapshot_hits: 0,
  disconnect_failed_closed: true,
  reconnect_open_prompt_resurfaced: true,
  reconnect_submit_failed_closed: true,
  submit_receipt_timeout_failed_closed: true,
  terminal_duplicate_not_resurrected: true,
  durable_terminal_replays_rejected: 1000,
  terminal_before_open_fail_closed: true,
  deadline_failed_closed: true,
  native_deadline_receipt_grace_ms: NATIVE_DEADLINE_RECEIPT_GRACE_MS,
  browser_response_window_extended: false,
  cancel_contract_idempotent: true,
  legacy_question_adapter_separate_from_permissions: true,
  deployed_contract_layout_loaded: deployedLayoutLoaded,
  deploy_syncs_shared_runtime_contracts: true,
}, null, 2));
