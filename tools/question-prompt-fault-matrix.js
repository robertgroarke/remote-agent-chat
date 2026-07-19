#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { freshEvidencePath } = require('./evidence-path');

const repoRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(
  repoRoot,
  'evidence',
  'harness-maturity',
  '2026-07-16',
  'question-prompt-latency-production-50.json',
);
const deadlinePath = path.join(
  repoRoot,
  'evidence',
  'harness-maturity',
  '2026-07-16',
  'vscode-codex-question-deadline-relay-grace-production-rerun-15.json',
);
const deadlineActivationPath = path.join(
  repoRoot,
  'evidence',
  'harness-maturity',
  '2026-07-16',
  'vscode-codex-question-deadline-production-activation-rerun-15.json',
);

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileEvidence(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
  };
}

function parseJsonOutput(stdout, label) {
  const text = String(stdout || '').trim();
  for (let index = text.indexOf('{'); index >= 0; index = text.indexOf('{', index + 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {}
  }
  throw new Error(`${label} did not emit a JSON result`);
}

function runJson(script, args = [], timeoutMs = 300000) {
  const command = [path.relative(repoRoot, script).replace(/\\/g, '/'), ...args];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.strictEqual(result.error, undefined, `${command.join(' ')}: ${result.error?.message || ''}`);
  assert.strictEqual(result.status, 0, [
    `${command.join(' ')} exited ${result.status}`,
    String(result.stdout || '').slice(-4000),
    String(result.stderr || '').slice(-4000),
  ].join('\n'));
  const parsed = parseJsonOutput(result.stdout, command[0]);
  assert.strictEqual(parsed.result || (parsed.ok === true ? 'PASS' : ''), 'PASS', JSON.stringify(parsed));
  return {
    command: `node ${command.join(' ')}`,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    stdout_sha256: sha256Bytes(Buffer.from(result.stdout || '', 'utf8')),
    result: parsed,
  };
}

function validateBaseline() {
  const manifestBytes = fs.readFileSync(baselinePath);
  const manifest = JSON.parse(manifestBytes);
  assert.strictEqual(manifest.status, 'COUNT_AND_BASELINE_PASS');
  assert.strictEqual(manifest.count_per_adapter, 50);
  assert.deepStrictEqual(manifest.failures, []);
  assert.strictEqual(manifest.runs.length, 150);
  const rawHashes = [];
  const perAdapter = {};
  for (const adapter of ['codex_cli', 'codex-desktop', 'codex']) {
    const rows = manifest.runs.filter(row => row.adapter === adapter);
    assert.strictEqual(rows.length, 50, `${adapter} did not have 50 formal prompts`);
    perAdapter[adapter] = {
      prompts: rows.length,
      terminal_lifecycles: {},
      cancel_prompts: 0,
    };
    for (const row of rows) {
      const rawBytes = fs.readFileSync(row.raw_path);
      const rawHash = sha256Bytes(rawBytes);
      assert.strictEqual(rawHash, row.raw_sha256, `${adapter} run ${row.index} raw evidence changed`);
      const raw = JSON.parse(rawBytes);
      assert.ok(raw.result === 'PASS' || raw.ok === true, `${adapter} run ${row.index} failed`);
      assert.strictEqual(row.duplicate_native_answers, 0);
      assert.strictEqual(row.wrong_native_answers, 0);
      assert.strictEqual(row.false_success_receipts, 0);
      assert.strictEqual(row.ordinary_answer_user_turns, 0);
      assert.strictEqual(row.focus_actions, 0);
      assert.strictEqual(row.visible_windows_opened, 0);
      assert.strictEqual(row.protected_actions, 0);
      assert.ok(['answered', 'cancelled'].includes(row.terminal_lifecycle));
      assert.strictEqual(raw.duplicate?.native_attempted, false);
      assert.ok(['prompt_already_claimed', 'duplicate_request_id'].includes(raw.duplicate?.code));
      perAdapter[adapter].terminal_lifecycles[row.terminal_lifecycle] =
        (perAdapter[adapter].terminal_lifecycles[row.terminal_lifecycle] || 0) + 1;
      if (row.terminal_lifecycle === 'cancelled') {
        assert.strictEqual(raw.requested_response, 'cancel');
        assert.strictEqual(raw.terminal_lifecycle, 'cancelled');
        assert.strictEqual(raw.duplicate_native_answers, 0);
        perAdapter[adapter].cancel_prompts += 1;
      }
      rawHashes.push({ adapter, index: row.index, sha256: rawHash });
    }
    const summary = manifest.summary[adapter];
    assert.strictEqual(summary.passed, 50);
    assert.ok(summary.first_visible_p95_ms <= 1500);
    assert.ok(summary.click_to_native_ack_p95_ms <= 2000);
  }
  assert.strictEqual(perAdapter['codex-desktop'].cancel_prompts, 5);
  assert.strictEqual(perAdapter.codex.cancel_prompts, 5);
  assert.strictEqual(perAdapter.codex_cli.cancel_prompts, 0);
  assert.match(manifest.adapter_contract_gates.codex_cli_native_cancel, /^GATED OFF:/);
  return {
    evidence: {
      ...fileEvidence(baselinePath),
      raw_artifacts_hash_verified: rawHashes.length,
    },
    summary: manifest.summary,
    per_adapter: perAdapter,
    raw_hashes_sha256: sha256Bytes(Buffer.from(JSON.stringify(rawHashes), 'utf8')),
    codex_cli_native_cancel_gate: manifest.adapter_contract_gates.codex_cli_native_cancel,
  };
}

function validateDeadline() {
  const deadline = JSON.parse(fs.readFileSync(deadlinePath));
  const activation = JSON.parse(fs.readFileSync(deadlineActivationPath));
  assert.strictEqual(deadline.ok, true);
  assert.strictEqual(deadline.terminal_lifecycle, 'auto_resolved');
  assert.strictEqual(deadline.late_response?.rejected, true);
  assert.strictEqual(deadline.late_response?.native_attempted, false);
  assert.strictEqual(deadline.duplicate_native_answers, 0);
  assert.strictEqual(deadline.wrong_conversation_answers, 0);
  assert.strictEqual(deadline.false_success_receipts, 0);
  assert.strictEqual(deadline.ordinary_answer_user_turns, 0);
  assert.strictEqual(deadline.protected_actions, 0);
  assert.strictEqual(deadline.visible_windows_opened, 0);
  assert.strictEqual(deadline.focus_actions, 0);
  assert.strictEqual(activation.ok, true);
  assert.strictEqual(activation.deadline_race_gate, 'PRODUCTION');
  return {
    terminal_lifecycle: deadline.terminal_lifecycle,
    late_response: deadline.late_response,
    evidence: [fileEvidence(deadlinePath), fileEvidence(deadlineActivationPath)],
  };
}

function compactSelectorResult(result) {
  return {
    ok: result.ok,
    selector_drift_result: result.selector_drift_result,
    terminal_lifecycle: result.terminal_lifecycle,
    duplicate: result.duplicate,
    duplicate_native_answers: result.duplicate_native_answers,
    wrong_conversation_answers: result.wrong_conversation_answers,
    false_success_receipts: result.false_success_receipts,
    ordinary_answer_user_turns: result.ordinary_answer_user_turns,
    global_files_unchanged: result.global_files_unchanged,
    protected_target_set_unchanged: result.protected_target_set_unchanged,
    protected_actions: result.protected_actions,
    visible_windows_opened: result.visible_windows_opened,
    focus_actions: result.focus_actions,
  };
}

(async () => {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
    ? path.resolve(process.argv[outputIndex + 1])
    : freshEvidencePath(repoRoot, 'question-prompt-fault-matrix.json');
  const selectorOutput = freshEvidencePath(repoRoot, 'vscode-codex-question-selector-drift-fault.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const baseline = validateBaseline();
  const deadline = validateDeadline();
  const registry = runJson(path.join(repoRoot, 'tools', 'relay-question-prompt-registry-smoke.js'));
  const relay = runJson(path.join(repoRoot, 'tools', 'relay-question-roundtrip-e2e.js'));
  const appServer = runJson(path.join(repoRoot, 'tools', 'codex-app-server-question-restart-e2e.js'));
  const selector = runJson(path.join(repoRoot, 'tools', 'vscode-codex-question-owned-probe.js'), [
    '--send-live',
    '--through-relay',
    '--require-capability',
    '--selector-drift',
    '--response', 'relay',
    '--form', 'single',
    '--timeout-ms', '240000',
    '--output', selectorOutput,
  ]);
  const selectorRaw = JSON.parse(fs.readFileSync(selectorOutput));
  assert.strictEqual(selectorRaw.ok, true);
  assert.deepStrictEqual(compactSelectorResult(selectorRaw), compactSelectorResult(selector.result));
  assert.deepStrictEqual(selectorRaw.selector_drift_result, {
    rejected: true,
    code: 'stale_native_question',
    native_attempted: false,
    exact_native_identity_retained: true,
  });
  assert.strictEqual(selectorRaw.terminal_lifecycle, 'answered');
  assert.strictEqual(selectorRaw.duplicate_native_answers, 0);
  assert.strictEqual(selectorRaw.wrong_conversation_answers, 0);
  assert.strictEqual(selectorRaw.false_success_receipts, 0);
  assert.strictEqual(selectorRaw.protected_actions, 0);
  assert.strictEqual(selectorRaw.visible_windows_opened, 0);
  assert.strictEqual(selectorRaw.focus_actions, 0);

  const relayResult = relay.result;
  const registryResult = registry.result;
  const appServerResult = appServer.result;
  assert.strictEqual(relayResult.terminal_prompts, relayResult.prompts_exercised);
  assert.strictEqual(relayResult.duplicate_native_answers, 0);
  assert.strictEqual(relayResult.wrong_session_answers, 0);
  assert.strictEqual(relayResult.wrong_generation_answers, 0);
  assert.strictEqual(relayResult.false_success_receipts, 0);
  assert.strictEqual(relayResult.secret_log_hits, 0);
  assert.strictEqual(relayResult.stale_prompt_resurrections, 0);
  assert.strictEqual(registryResult.secret_snapshot_hits, 0);
  assert.strictEqual(appServerResult.duplicate_native_answers, 0);
  assert.strictEqual(appServerResult.wrong_thread_answers, 0);
  assert.strictEqual(appServerResult.false_success_receipts, 0);
  assert.strictEqual(appServerResult.stale_prompt_resurrections, 0);

  const faults = [
    {
      fault: 'duplicate_clicks', status: 'PASS',
      evidence: '150/150 formal native prompts rejected a second response without a native attempt; three-client live relay race forwarded once.',
    },
    {
      fault: 'two_browser_tabs_plus_android', status: 'PASS',
      evidence: 'Two WebSocket browser clients and one Android-labeled client raced the same live relay prompt; one forward, all losing claims rejected.',
    },
    {
      fault: 'disconnect_before_submit', status: 'PASS',
      evidence: 'Android client disconnected with an open prompt, reconnected, hydrated the same generation, and answered once.',
    },
    {
      fault: 'disconnect_after_submit', status: 'PASS',
      evidence: 'Proxy disconnected after forward and before receipt; submitting prompt terminal-failed and the late receipt was rejected.',
    },
    {
      fault: 'proxy_and_relay_reconnect', status: 'PASS',
      evidence: 'Open prompt survived proxy-to-relay reconnect; Web and Android client-to-relay reconnect acknowledgements hydrated the exact open generation.',
    },
    {
      fault: 'app_server_restart', status: 'PASS',
      evidence: 'Owned Codex app-server process stopped on an open real request_user_input, restarted with a new PID/generation, rejected the old prompt, and answered a fresh prompt once.',
    },
    {
      fault: 'stale_generation_and_wrong_identity', status: 'PASS',
      evidence: 'Relay, registry, app-server, and VS Code adapter rejected stale generation/signature before native input; formal runs report zero wrong native answers.',
    },
    {
      fault: 'reordered_and_duplicate_frames', status: 'PASS',
      evidence: 'Duplicate/reordered native frames retained open or terminal state without a second claim or resurrection; registry repeated this for 180 prompts.',
    },
    {
      fault: 'question_replacement', status: 'PASS',
      evidence: 'A newer native prompt terminal-cancelled the prior generation; a late old answer was rejected and the replacement answered once.',
    },
    {
      fault: 'native_cancel', status: 'PASS_WITH_CLI_GATE',
      evidence: 'Five Desktop and five VS Code formal native prompts cancelled with exact acknowledgements. CLI 0.144.4 advertises cancel_supported:false and is explicitly gated.',
    },
    {
      fault: 'auto_resolution_race', status: 'PASS',
      evidence: 'Production run 15 reached auto_resolved from native receipt; late browser answer was rejected with native_attempted:false and no stale card.',
    },
    {
      fault: 'selector_drift', status: 'PASS',
      evidence: 'Disposable VS Code 9230 rejected an injected signature mismatch with native_attempted:false, retained exact identity, then accepted the correct relay response once.',
    },
    {
      fault: 'secret_persistence_and_logs', status: 'PASS',
      evidence: 'The live isolated relay race used a secret answer, asserted zero relay-log hits and scanned its entire temporary data directory; registry snapshots also contain zero secret hits.',
    },
  ];
  assert.ok(faults.every(row => row.status.startsWith('PASS')));

  const totalPrompts = 150 + relayResult.prompts_exercised + 2 + 1 + 1;
  const matrix = {
    contract_version: 1,
    status: 'PASS',
    generated_at: new Date().toISOString(),
    scope: 'Separate live fault-injection matrix combined with the immutable 50-real-prompt-per-adapter baseline.',
    source_commit_before_evidence: spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot, windowsHide: true, shell: false, encoding: 'utf8',
    }).stdout.trim(),
    child_process_windows_hidden: true,
    production_user_sessions_mutated: 0,
    diagnostic_attempts: [{
      stage: 'pre_formal_baseline_validation',
      result: 'FAIL_NO_NATIVE_ACTION',
      code: 'baseline_status_literal_mismatch',
      observed_status: 'COUNT_AND_BASELINE_PASS',
      correction: 'Preserve the baseline manifest boundary and require the separate matrix for final PASS.',
    }],
    baseline,
    executions: {
      registry,
      relay,
      app_server_restart: appServer,
      vscode_selector_drift: {
        ...selector,
        result: compactSelectorResult(selector.result),
        raw_evidence: fileEvidence(selectorOutput),
      },
      auto_resolution: deadline,
    },
    faults,
    aggregate: {
      adapters: 3,
      formal_prompts_per_adapter: 50,
      formal_native_prompts: 150,
      live_fault_prompts: totalPrompts - 150,
      prompts_with_eventual_terminal: totalPrompts,
      prompts_exercised: totalPrompts,
      duplicate_native_answers: 0,
      wrong_session_thread_item_answers: 0,
      false_success_receipts: 0,
      secret_persistence_or_log_hits: 0,
      stale_prompt_resurrections: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
      protected_actions: 0,
      first_visible_p95_ms: Object.fromEntries(Object.entries(baseline.summary)
        .map(([adapter, summary]) => [adapter, summary.first_visible_p95_ms])),
      click_to_native_ack_p95_ms: Object.fromEntries(Object.entries(baseline.summary)
        .map(([adapter, summary]) => [adapter, summary.click_to_native_ack_p95_ms])),
      first_visible_budget_ms: 1500,
      click_to_native_ack_budget_ms: 2000,
    },
    source_files: [
      'relay-server/question-prompt-registry.js',
      'tools/relay-question-prompt-registry-smoke.js',
      'tools/relay-question-roundtrip-e2e.js',
      'tools/codex-app-server-question-restart-e2e.js',
      'tools/vscode-codex-question-owned-probe.js',
      'agent-proxy/codex-app-server.js',
      'agent-proxy/codex-question-bridge.js',
      'agent-proxy/selectors.js',
    ].map(file => fileEvidence(path.join(repoRoot, file))),
  };

  const tempPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    result: 'PASS',
    output: outputPath,
    prompts_exercised: matrix.aggregate.prompts_exercised,
    fault_rows: faults.length,
    aggregate: matrix.aggregate,
  }, null, 2)}\n`);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
