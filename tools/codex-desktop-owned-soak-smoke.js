#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  archiveTokenState,
  blockCounts,
  codexFailureLines,
  parseArgs,
  resolveOwnedArchive,
  strongUserAnchors,
  webCaptureStateIsReady,
} = require('./codex-desktop-owned-soak-e2e');

assert.throws(() => parseArgs([]), /--send-live/);
assert.throws(() => parseArgs(['--send-live', '--soak-minutes', '9']), /at least 10 minutes/);
assert.throws(() => parseArgs(['--send-live', '--soak-interval-ms', '1']), /Accelerated soak controls/);
assert.throws(() => parseArgs(['--send-live', '--owned-thread-id', 'local:owned']), /supplied together/);
const formal = parseArgs(['--send-live']);
assert.strictEqual(formal.soakMinutes, 10);
assert.strictEqual(formal.soakIntervalMs, 60_000);
const accelerated = parseArgs([
  '--send-live', '--allow-short-soak', '--soak-minutes', '0.01', '--soak-interval-ms', '0', '--soak-turn-limit', '1',
]);
assert.strictEqual(accelerated.soakTurnLimit, 1);
const preOwned = parseArgs([
  '--send-live', '--owned-thread-id', 'local:owned', '--owned-marker', 'RAC_OWNED_MARKER',
]);
assert.strictEqual(preOwned.ownedThreadId, 'local:owned');
assert.strictEqual(preOwned.idleStabilityMs, 30_000);

assert.deepStrictEqual(blockCounts([
  { content_blocks: [{ type: 'terminal' }, { type: 'file_changes' }] },
  { content_blocks: [{ type: 'terminal' }] },
]), { terminal: 2, file_changes: 1 });
assert.deepStrictEqual(codexFailureLines([
  '[codex-desktop] selector failure session-1',
  '[codex-desktop] healthy refresh session-1',
  '[other] exception',
].join('\n'), 'session-1'), ['[codex-desktop] selector failure session-1']);

assert.deepStrictEqual(strongUserAnchors([
  { role: 'user', content: `short` },
  { role: 'user', content: `anchor alpha ${'a'.repeat(90)}` },
  { role: 'assistant', content: `anchor beta ${'b'.repeat(90)}` },
  { role: 'user', content: `anchor alpha ${'a'.repeat(90)}` },
  { role: 'user', content: `anchor gamma ${'c'.repeat(90)}` },
]), [`anchor alpha ${'a'.repeat(90)}`, `anchor gamma ${'c'.repeat(90)}`]);

const readyWebCapture = {
  token_visible: true,
  terminal_blocks: 1,
  file_change_blocks: 1,
  markdown_rows: 1,
  active_live_channels: [],
  active_step_spinners: 0,
  active_card_spinners: 0,
  visible_stop_controls: 0,
  rect: { width: 800, height: 600 },
  visibility_state: 'hidden',
  has_focus: false,
};
assert.strictEqual(webCaptureStateIsReady(readyWebCapture), true);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, active_live_channels: ['current'] }), false);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, active_live_channels: ['thinking'] }), false);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, active_step_spinners: 1 }), false);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, active_card_spinners: 1 }), false);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, visible_stop_controls: 1 }), false);
assert.strictEqual(webCaptureStateIsReady({ ...readyWebCapture, visibility_state: 'visible' }), false);

const archiveDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rac-codex-soak-archive-'));
const archivePath = path.join(archiveDir, 'owned.jsonl');
try {
  const token = 'RAC_CODEX_DESKTOP_SOAK_ARCHIVE_FIXTURE';
  fs.writeFileSync(archivePath, [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `prompt ${token}` }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: token }] } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  assert.deepStrictEqual(archiveTokenState(archivePath, token), { user: true, assistant: true });
  assert.deepStrictEqual(archiveTokenState(archivePath, 'ABSENT_TOKEN'), { user: false, assistant: false });
} finally {
  fs.rmSync(archiveDir, { recursive: true, force: true });
}

const archiveHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rac-codex-soak-home-'));
const previousUserProfile = process.env.USERPROFILE;
try {
  process.env.USERPROFILE = archiveHome;
  const sessionsDir = path.join(archiveHome, '.codex', 'sessions', '2026', '07', '13');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const firstAnchor = `retained owned archive anchor one ${'a'.repeat(90)}`;
  const secondAnchor = `retained owned archive anchor two ${'b'.repeat(90)}`;
  const retainedArchive = path.join(sessionsDir, 'retained-owned.jsonl');
  fs.writeFileSync(retainedArchive, [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: firstAnchor }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first reply' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: secondAnchor }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'second reply' }] } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  assert.strictEqual(resolveOwnedArchive([
    { role: 'user', content: firstAnchor },
    { role: 'user', content: secondAnchor },
  ]), retainedArchive);
} finally {
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  fs.rmSync(archiveHome, { recursive: true, force: true });
}

const source = fs.readFileSync(path.join(__dirname, 'codex-desktop-owned-soak-e2e.js'), 'utf8');
for (const required of [
  'acquirePidLock(',
  'waitForStableNativeIdle',
  'Exact pre-owned Codex Desktop thread is absent',
  'Exactly one persistent verification page is required',
  'Emulation.clearDeviceMetricsOverride',
  "assert.strictEqual(restore.visibility_state, 'hidden'",
  "assert.strictEqual(summary.has_focus, false",
  'original_thread_restored',
  'active_traffic_span_seconds',
  'exact_native_archive',
  'token_in_exact_native_archive',
  'content-block-terminal',
  'content-block-file-change',
  'structured idle WebUI capture state',
  'idle_stable_ms',
  'WebUI became active during capture',
  'WebUI Stop control appeared during capture',
]) {
  assert(source.includes(required), `missing soak safety contract: ${required}`);
}
assert(!source.includes('chromium.connectOverCDP'), 'Playwright must not activate the verification page during capture');
assert(
  source.indexOf('releaseOperation = acquirePidLock(') < source.indexOf('report = reporter(options.progress)'),
  'soak evidence reporter is initialized before production lock ownership',
);
assert(
  source.includes('if (ownsEvidence) fs.writeFileSync(options.output'),
  'lock-rejected soak can overwrite the active owner result',
);

console.log('PASS Codex Desktop owned production soak safety, duration, structure, and hidden visual contracts');
