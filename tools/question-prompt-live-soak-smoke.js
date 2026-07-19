#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const soak = require('./question-prompt-live-soak');
const cliProbe = require('./proxy-codex-cli-live-question-e2e');
const desktopProbe = require('./proxy-codex-desktop-live-question-e2e');
const production = require('./vscode-extension-production-e2e');
const { semanticChoice } = require('../shared/question-choice-label');

const vscodeProbeSource = fs.readFileSync(
  path.join(__dirname, 'vscode-codex-question-owned-probe.js'), 'utf8');
assert(vscodeProbeSource.includes("delivery.error?.code === 'session_unknown'"),
  'VS Code question probe must recognize the authoritative transient new-chat rebind receipt');
assert(vscodeProbeSource.includes('guard.assertStoreBinding(currentStore, candidate, native.frame)'),
  'VS Code question probe must revalidate the exact disposable frame binding before retrying');
assert(vscodeProbeSource.includes('for (let attempt = 0; attempt < 2; attempt += 1)'),
  'VS Code question probe retry must remain bounded to one authoritative non-delivery');

const canonicalPrompt = {
  session_id: 'fixture-session',
  prompt_id: 'fixture-prompt',
  generation: 'fixture-generation',
  cancel_supported: true,
  questions: [{
    question_id: 'route',
    choices: [
      { choice_id: 'one', label: 'Relay' },
      { choice_id: 'two', label: 'Native' },
    ],
  }],
};
const desktopCancel = desktopProbe.cancelFrame(canonicalPrompt, 'fixture-cancel');
assert.strictEqual(desktopCancel.action, 'cancel');
assert.strictEqual(Object.prototype.hasOwnProperty.call(desktopCancel, 'answers'), false);
const decoratedDesktopPrompt = {
  ...canonicalPrompt,
  questions: [{
    question_id: 'desktop-question-1',
    message: 'Choose the validation branch.',
    choices: [
      { choice_id: 'desktop-choice-1', label: 'Alpha (Recommended)', description: 'Alpha Recommended First branch', selected: true },
      { choice_id: 'desktop-choice-2', label: 'Beta', description: 'Second branch', selected: false },
    ],
  }],
};
const decoratedNativePrompt = {
  questions: [{
    question_id: 'desktop-question-1',
    options: decoratedDesktopPrompt.questions[0].choices,
  }],
};
assert.deepStrictEqual(
  desktopProbe.validateDesktopChoiceFidelity(decoratedDesktopPrompt, decoratedNativePrompt),
  {
    alpha: decoratedDesktopPrompt.questions[0].choices[0],
    beta: decoratedDesktopPrompt.questions[0].choices[1],
  },
);
assert.deepStrictEqual(
  desktopProbe.responseFrame(decoratedDesktopPrompt, 'fixture-decorated-alpha', 'Alpha').answers,
  [{ question_id: 'desktop-question-1', choice_ids: ['desktop-choice-1'] }],
);
assert.strictEqual(desktopProbe.parseArgs(['--send-live', '--response', 'alpha']).response, 'alpha');
assert.throws(() => cliProbe.parseArgs(['--send-live', '--response', 'cancel']));
assert.throws(() => cliProbe.parseArgs(['--send-live', '--response', 'other']));
assert.throws(() => desktopProbe.parseArgs(['--send-live', '--response', 'other']));
assert.strictEqual(semanticChoice(canonicalPrompt.questions[0], 'Relay').label, 'Relay');
assert.strictEqual(semanticChoice({
  choices: [{ choice_id: 'recommended', label: 'Relay (Recommended)' }],
}, 'Relay').choice_id, 'recommended');
assert.throws(() => semanticChoice({
  choices: [{ label: 'Relay' }, { label: 'Relay (Recommended)' }],
}, 'Relay'));

const liveSessionState = production.latestSessions([
  { sessions: [{ session_id: 'owned-cli', status: 'healthy', activity: { kind: 'generating', label: 'Running' } }] },
  { type: 'session_patch', session_id: 'owned-cli', state_seq: 9, patch: { activity: { kind: 'thinking', label: 'Working' } } },
  { type: 'session_summary', session: 'owned-cli', state_seq: 8, status: 'healthy', activity: { kind: 'generating', label: 'Older state' } },
  { type: 'session_summary', session: 'owned-cli', state_seq: 10, status: 'healthy', activity: { kind: 'idle', label: '' } },
]);
assert.strictEqual(liveSessionState[0].activity.kind, 'idle',
  'live session reducer must apply monotonic summary/patch frames after the latest session-list snapshot');
assert.strictEqual(cliProbe.relaySessionActivity({
  type: 'session_patch',
  session_id: 'owned-cli',
  patch: { activity: { kind: 'idle' } },
}, 'owned-cli').kind, 'idle');
assert.deepStrictEqual(cliProbe.compactSessionStateTimeline([
  { type: 'session_list', sessions: [{ session_id: 'owned-cli', status: 'healthy', activity: { kind: 'generating', updated_at: '2026-07-16T00:00:00.000Z' } }] },
  { type: 'status', session: 'owned-cli', state_seq: 7, activity: { kind: 'idle', updated_at: '2026-07-16T00:00:01.000Z' } },
], 'owned-cli'), [
  {
    message_index: 0,
    type: 'session_list',
    state_seq: null,
    state_epoch: null,
    status: 'healthy',
    activity: { kind: 'generating', label: '', updated_at: '2026-07-16T00:00:00.000Z', started_at: null },
  },
  {
    message_index: 1,
    type: 'status',
    state_seq: 7,
    state_epoch: null,
    status: null,
    activity: { kind: 'idle', label: '', updated_at: '2026-07-16T00:00:01.000Z', started_at: null },
  },
]);

const options = soak.parseArgs([
  '--plan-only',
  '--count-per-adapter', '50',
  '--output', path.join('C:\\temp', 'question-prompt-live-soak-smoke.json'),
  '--raw-dir', path.join('C:\\temp', 'question-prompt-live-soak-smoke-raw'),
]);
const plan = soak.buildPlan(options, { runs: [] });
assert.strictEqual(plan.length, 150);
for (const adapter of soak.ADAPTERS) {
  assert.strictEqual(plan.filter(run => run.adapter === adapter).length, 50);
}
assert(plan.every(run => run.args.includes('--send-live')));
assert(plan.every(run => run.args.includes('--require-capability')));
assert(plan.every(run => run.args.includes('--output')));
assert(plan.every(run => run.rawPath.startsWith(options.rawDir)));
assert(plan.every(run => !run.args.join(' ').includes('restart-proxy')));

const cliResponses = new Set(plan.filter(run => run.adapter === 'codex_cli')
  .map(run => run.plan.response));
assert.deepStrictEqual([...cliResponses].sort(), ['native', 'relay']);
const desktopResponses = new Set(plan.filter(run => run.adapter === 'codex-desktop')
  .map(run => run.plan.response));
assert.deepStrictEqual([...desktopResponses].sort(), ['alpha', 'beta', 'cancel']);
const vscodePlans = plan.filter(run => run.adapter === 'codex');
assert(vscodePlans.some(run => run.plan.form === 'multi'));
assert(vscodePlans.some(run => run.plan.response === 'other'));
assert(vscodePlans.some(run => run.plan.response === 'cancel'));

const resumed = soak.buildPlan(options, {
  runs: [
    { adapter: 'codex_cli', index: 1, result: 'PASS' },
    { adapter: 'codex-desktop', index: 1, result: 'PASS' },
    { adapter: 'codex', index: 1, result: 'PASS' },
  ],
});
assert.strictEqual(resumed.length, 147);
const failedResume = soak.buildPlan(options, {
  runs: [],
  failures: [{ adapter: 'codex-desktop', index: 13 }],
});
const retriedDesktop = failedResume.find(run =>
  run.adapter === 'codex-desktop' && run.index === 13);
assert.strictEqual(retriedDesktop.attempt, 2);
assert(retriedDesktop.rawPath.endsWith('codex-desktop-013-retry-002.json'));
assert(retriedDesktop.args.includes(retriedDesktop.rawPath));

const recoveryDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rac-question-soak-recovery-'));
const recoveryRawOne = path.join(recoveryDir, 'raw-one.json');
const recoveryRawTwo = path.join(recoveryDir, 'raw-two.json');
fs.writeFileSync(recoveryRawOne, '{"ok":true}\n');
fs.writeFileSync(recoveryRawTwo, '{"ok":true,"index":2}\n');
const recoveryRun = (rawPath, index) => ({
  adapter: 'codex',
  index,
  result: 'PASS',
  raw_path: rawPath,
  raw_sha256: require('crypto').createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex'),
});
const recoveryManifest = path.join(recoveryDir, 'manifest.json');
fs.writeFileSync(recoveryManifest, JSON.stringify({
  updated_at: '2026-07-16T00:00:00.000Z',
  runs: [recoveryRun(recoveryRawOne, 1)],
}));
fs.writeFileSync(recoveryManifest + '.tmp-42', JSON.stringify({
  updated_at: '2026-07-16T00:00:01.000Z',
  runs: [recoveryRun(recoveryRawOne, 1), recoveryRun(recoveryRawTwo, 2)],
}));
const recovered = soak.readVerifiedResumeManifest(recoveryManifest);
assert.strictEqual(recovered.file, recoveryManifest + '.tmp-42');
assert.strictEqual(recovered.manifest.runs.length, 2);

const originalRenameSync = fs.renameSync;
let renameAttempts = 0;
try {
  fs.renameSync = (...args) => {
    renameAttempts += 1;
    if (renameAttempts < 3) {
      const error = new Error('simulated Windows evidence-reader lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(...args);
  };
  const atomicPath = path.join(recoveryDir, 'atomic.json');
  soak.writeJsonAtomic(atomicPath, { ok: true });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(atomicPath, 'utf8')), { ok: true });
  assert.strictEqual(renameAttempts, 3);
} finally {
  fs.renameSync = originalRenameSync;
  fs.rmSync(recoveryDir, { recursive: true, force: true });
}
assert.strictEqual(soak.percentile([1, 2, 3, 4, 5], 95), 5);
const correctedVsCodeRun = soak.compactRun({
  adapter: 'codex',
  index: 1,
  attempt: 1,
  plan: { form: 'single', response: 'relay' },
  rawPath: 'owned-vscode.json',
}, {
  ok: true,
  question_visible_ms: 9000,
  producer_to_relay_visible_ms: 240,
  native_to_relay_ms: 80,
}, 'abc123');
assert.strictEqual(correctedVsCodeRun.first_visible_ms, 240,
  'VS Code first-visible metric still includes pre-producer model time');
assert.strictEqual(correctedVsCodeRun.native_to_relay_ms, 80);
const correctedDesktopRun = soak.compactRun({
  adapter: 'codex-desktop',
  index: 1,
  attempt: 1,
  plan: { form: 'single', response: 'alpha' },
  rawPath: 'owned-desktop.json',
}, {
  result: 'PASS',
  native_observed_to_visible_ms: 75,
  send_receipt_to_native_visible_ms: 9000,
}, 'desktop123');
assert.strictEqual(correctedDesktopRun.first_visible_ms, 75,
  'Desktop first-visible metric still includes native model-generation time');
assert.strictEqual(correctedDesktopRun.native_generation_ms, 9000,
  'Desktop native model-generation time is no longer preserved separately');

const manifest = soak.summarize({
  adapters: [...soak.ADAPTERS],
  count_per_adapter: 1,
  runs: soak.ADAPTERS.map(adapter => ({
    adapter,
    index: 1,
    result: 'PASS',
    first_visible_ms: 100,
    native_to_relay_ms: 20,
    click_to_native_ack_ms: 30,
    terminal_lifecycle: 'answered',
    duplicate_native_answers: 0,
    wrong_native_answers: 0,
    false_success_receipts: 0,
    ordinary_answer_user_turns: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
    protected_actions: 0,
  })),
});
assert.strictEqual(manifest.status, 'COUNT_AND_BASELINE_PASS');

console.log(JSON.stringify({
  result: 'PASS',
  planned_live_prompts: plan.length,
  prompts_per_adapter: 50,
  resumable: true,
  raw_evidence_hashed: true,
  child_process_windows_hidden: true,
  relay_status_reducer: true,
  relay_status_timeline: true,
  branch_coverage: {
    codex_cli: [...cliResponses].sort(),
    codex_desktop: [...desktopResponses].sort(),
    codex: Array.from(new Set(vscodePlans.map(run =>
      run.plan.form + ':' + run.plan.response))).sort(),
  },
  acceptance_boundary_explicit: true,
}, null, 2));
