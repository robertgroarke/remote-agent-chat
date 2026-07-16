#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  acquireExclusiveMutationLock,
  buildRunResult,
  interSampleSettleMs,
  localCliTranscriptPath,
  nativeResponseTimeoutMs,
  parseArgs,
  selectLatencySessions,
  summarizeHarness,
} = require('./per-harness-browser-latency-e2e');
const {
  buildResult: buildPassiveResult,
  cycleToken,
  parseArgs: parsePassiveArgs,
} = require('./continue-soak-passive-browser-latency');

const options = { samples: 5, types: ['continue'] };
const session = { session_id: 'continue-smoke' };
const partial = summarizeHarness('continue', session, [{
  sample: 1,
  native_to_browser_paint_ms: 310,
}], 5, {
  sample: 2,
  message: 'native DOM timed out',
});

assert.strictEqual(partial.completed, false);
assert.strictEqual(partial.pass, false);
assert.strictEqual(partial.p50_ms, 310);
assert.strictEqual(partial.p95_ms, 310);
assert.strictEqual(partial.inter_sample_settle_ms, 6000);
assert.strictEqual(partial.native_response_timeout_ms, 360000);
assert.deepStrictEqual(partial.failure, {
  sample: 2,
  message: 'native DOM timed out',
});

const failedRun = buildRunResult(options, 1, [partial], {
  agent_type: 'continue',
  message: 'native DOM timed out',
});
assert.deepStrictEqual(failedRun.completed_types, []);
assert.strictEqual(failedRun.harnesses[0].samples.length, 1);

const complete = summarizeHarness('continue', session, [120, 180, 220, 300, 420].map((ms, index) => ({
  sample: index + 1,
  native_to_browser_paint_ms: ms,
})), 5);
assert.strictEqual(complete.completed, true);
assert.strictEqual(complete.pass, true);
assert.strictEqual(complete.p50_ms, 220);
assert.strictEqual(complete.p95_ms, 420);
assert.strictEqual(interSampleSettleMs('continue'), 6000);
assert.strictEqual(interSampleSettleMs('cursor'), 0);
assert.strictEqual(nativeResponseTimeoutMs('continue'), 360000);
assert.strictEqual(nativeResponseTimeoutMs('cursor'), 120000);

const passiveOptions = parsePassiveArgs([
  '--run-id', '20260712074833',
  '--cycles', '6,7,8,9,10',
  '--session-id', 'continue-smoke',
]);
assert.strictEqual(cycleToken(passiveOptions.runId, 6), 'RAC_OVERNIGHT_20260712074833_06_CONTINUE');
const passive = buildPassiveResult(passiveOptions, [{
  cycle: 6,
  native_to_browser_paint_ms: 240,
}]);
assert.strictEqual(passive.ok, false);
assert.strictEqual(passive.sample_count, 1);
assert.strictEqual(passive.requested_samples, 5);
assert.strictEqual(passive.sends_or_controls, 0);
assert.strictEqual(passive.operation_lock_acquired, false);
assert.strictEqual(passive.mutation_lock_acquired, false);

const lockPath = path.join(os.tmpdir(), `rac-latency-smoke-${process.pid}.lock`);
const release = acquireExclusiveMutationLock(lockPath, 'smoke lock');
assert(fs.existsSync(lockPath));
assert.throws(
  () => acquireExclusiveMutationLock(lockPath, 'smoke lock'),
  /smoke lock unavailable/,
);
release();
assert(!fs.existsSync(lockPath));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-latency-cli-path-'));
try {
  const runtimeArchive = path.join(tempRoot, 'runtime-codex.jsonl');
  fs.writeFileSync(runtimeArchive, '{}\n', 'utf8');
  const detachedStore = path.join(tempRoot, 'missing-clean-runtime-store.json');
  assert.strictEqual(localCliTranscriptPath({
    session_id: 'relay-session',
    cli_session_id: 'native-cli-session',
  }, 'codex_cli', {
    sessionStorePath: detachedStore,
    findByCliId: cliSessionId => (
      cliSessionId === 'native-cli-session' ? { filePath: runtimeArchive } : null
    ),
  }), runtimeArchive, 'immutable CLI id did not recover a detached-runtime archive');

  const storeArchive = path.join(tempRoot, 'store-codex.jsonl');
  fs.writeFileSync(storeArchive, '{}\n', 'utf8');
  const storePath = path.join(tempRoot, 'session-store.json');
  fs.writeFileSync(storePath, JSON.stringify({
    sessions: { 'relay-session': { codex_cli_file_path: storeArchive } },
  }), 'utf8');
  assert.strictEqual(localCliTranscriptPath({
    session_id: 'relay-session',
    cli_session_id: 'native-cli-session',
  }, 'codex_cli', {
    sessionStorePath: storePath,
    findByCliId: () => ({ filePath: runtimeArchive }),
  }), storeArchive, 'local runtime store should remain the fast path');

  const proxySourceRoot = path.join(tempRoot, 'clean-runtime');
  const proxyStoreDir = path.join(proxySourceRoot, 'agent-proxy');
  fs.mkdirSync(proxyStoreDir, { recursive: true });
  fs.writeFileSync(path.join(proxyStoreDir, 'session-store.json'), JSON.stringify({
    sessions: {
      'continue-local': { cdp_port: 9230, target_id: 'continue-target' },
    },
  }), 'utf8');
  const selected = selectLatencySessions([{
    session_id: 'continue-stale',
    agent_type: 'continue',
    workspace_path: 'C:\\temp\\remote-agent-vscode-test',
    last_seen_at: '2026-07-12T10:00:00.000Z',
    activity: { kind: 'idle' },
  }, {
    session_id: 'continue-local',
    agent_type: 'continue',
    workspace_path: 'C:\\temp\\remote-agent-vscode-test',
    last_seen_at: '2026-07-12T09:00:00.000Z',
    activity: { kind: 'idle' },
  }], ['continue'], proxySourceRoot);
  assert.strictEqual(selected.continue.session_id, 'continue-local',
    'latency selection should skip a newer stale relay row without local CDP metadata');
  const parsed = parseArgs([
    '--samples', '3',
    '--types', 'continue',
    '--proxy-source-root', proxySourceRoot,
  ]);
  assert.strictEqual(parsed.proxySourceRoot, proxySourceRoot);
  assert.throws(
    () => parseArgs(['--samples', '3', '--types', 'continue', '--proxy-source-root', path.join(tempRoot, 'missing')]),
    /must contain agent-proxy\/session-store\.json/,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS per-harness browser latency result retention, detached CLI archive recovery, and passive-soak contract');
