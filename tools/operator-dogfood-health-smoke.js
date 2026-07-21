#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { updateMachineState, persistFailureTrace } = require('./operator-dogfood');
const { analyzeTemporalTrace } = require('./chat-stability-temporal-contract');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-dogfood-health-smoke-'));
try {
  const options = {
    mode: 'canary', triggerSource: 'scheduled_task', outputDir: temp,
    stateFile: path.join(temp, 'state.json'), ledger: path.join(temp, 'ledger.jsonl'),
  };
  const contract = analyzeTemporalTrace({
    samples: [
      { at_ms: 0, refresh_sequence: 0, session_id: 'fixture', canonical_conversation_id: 'codex:fixture',
        scroll_top: 500, anchor_key: 'a', anchor_offset_px: 0, user_scroll_epoch: 0 },
      { at_ms: 300, refresh_sequence: 1, session_id: 'fixture', canonical_conversation_id: 'codex:fixture',
        scroll_top: 0, anchor_key: 'a', anchor_offset_px: -500, user_scroll_epoch: 0,
        phase: 'programmatic_scroll_write', writer: 'prompt_transition' },
    ],
    truth: { native_prompts: [] },
  });
  const temporal = {
    ok: false, bundle_sha256: 'a'.repeat(64), storm: { total_refresh_frames: 2 },
    temporal_contract: { ok: false, depths: { top: contract } },
    depths: { top: { dropped_samples: 0, events: [{ phase: 'baseline' }, { phase: 'failure' }] } },
  };
  const result = {
    run_id: 'scheduled-run-1', mode: 'canary', result: 'FAIL',
    started_at: '2026-07-21T00:00:00.000Z', completed_at: '2026-07-21T00:02:00.000Z',
    elapsed_ms: 120000, source_commit: 'b'.repeat(40),
    safety: { visible_windows: 0, focus_actions: 0, protected_session_mutations: 0,
      production_mutations: 0, proxy_restarts: 0, deploys: 0 },
  };
  const first = updateMachineState(options, result, temporal, { cache_key: 'build-fixture' });
  const second = updateMachineState(options, { ...result, run_id: 'scheduled-run-2' }, temporal, { cache_key: 'build-fixture' });
  assert.strictEqual(first.open_fingerprints.length, 1);
  assert.strictEqual(second.open_fingerprints.length, 1, 'repeated failure must deduplicate by fingerprint');
  assert.strictEqual(Object.values(second.findings)[0].count, 2, 'deduplicated failure count must increment');
  assert.strictEqual(second.latest.trigger_source, 'scheduled_task');
  assert.strictEqual(second.latest.scheduler_last_result, 'FAIL');
  assert(second.latest.next_due_at);
  assert.strictEqual(fs.readFileSync(options.ledger, 'utf8').trim().split(/\r?\n/).length, 2);
  assert.strictEqual(fs.readdirSync(temp).some(name => name.endsWith('.tmp')), false, 'atomic state left a temp file');

  const failureEvidence = persistFailureTrace(options, temporal, second);
  const compressed = path.join(root, failureEvidence.compressed_trace);
  assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(compressed))), temporal);
  assert(fs.existsSync(path.join(root, failureEvidence.first_last_frames)));

  const relay = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
  const webHooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
  const android = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  for (const token of ['operator-dogfood', 'operator_dogfood_health', 'operator_dogfood_status', 'saveOperatorDogfoodHealth']) {
    assert(relay.includes(token), `relay is missing ${token}`);
  }
  for (const source of [webHooks, web, android]) {
    assert(source.includes('operatorDogfoodHealth'), 'client is missing dogfood program health state');
  }
  assert(web.includes('Chat stability sentinel'));
  assert(android.includes('Chat stability sentinel'));
  process.stdout.write('PASS operator dogfood deduped health projection\n');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
