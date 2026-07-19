#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const ADAPTERS = ['codex_cli', 'codex-desktop', 'codex'];
const SCRIPTS = {
  codex_cli: 'proxy-codex-cli-live-question-e2e.js',
  'codex-desktop': 'proxy-codex-desktop-live-question-e2e.js',
  codex: 'vscode-codex-question-owned-probe.js',
};

function parseArgs(argv) {
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    + '-' + crypto.randomBytes(4).toString('hex');
  const options = {
    sendLive: false,
    planOnly: false,
    allowShort: false,
    resume: false,
    countPerAdapter: 50,
    timeoutMs: 240000,
    adapters: [...ADAPTERS],
    output: freshEvidencePath(ROOT, 'question-prompt-live-soak.json'),
    rawDir: path.join('C:\\temp', 'rac-question-prompt-live-soak-' + runId),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--plan-only') options.planOnly = true;
    else if (arg === '--allow-short') options.allowShort = true;
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--count-per-adapter' && argv[index + 1]) {
      options.countPerAdapter = Number(argv[++index]);
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === '--adapters' && argv[index + 1]) {
      options.adapters = String(argv[++index]).split(',').map(value => value.trim()).filter(Boolean);
    } else if (arg === '--output' && argv[index + 1]) {
      options.output = path.resolve(argv[++index]);
    } else if (arg === '--raw-dir' && argv[index + 1]) {
      options.rawDir = path.resolve(argv[++index]);
    } else {
      throw new Error('Unknown or incomplete argument: ' + arg);
    }
  }
  assert(options.planOnly !== options.sendLive,
    'choose exactly one of --plan-only or --send-live');
  assert(Number.isInteger(options.countPerAdapter) && options.countPerAdapter > 0,
    '--count-per-adapter must be a positive integer');
  if (!options.allowShort) {
    assert(options.countPerAdapter >= 50,
      'live maturity soak requires at least 50 prompts per adapter');
  }
  assert(Number.isFinite(options.timeoutMs)
    && options.timeoutMs >= 30000 && options.timeoutMs <= 300000,
  '--timeout-ms must be between 30000 and 300000');
  assert(options.adapters.length > 0 && options.adapters.every(adapter => ADAPTERS.includes(adapter)),
    '--adapters contains an unsupported adapter');
  assert.strictEqual(new Set(options.adapters).size, options.adapters.length,
    '--adapters must not contain duplicates');
  if (options.resume) assert(fs.existsSync(options.output), '--resume output does not exist');
  return options;
}

function responsePlan(adapter, index) {
  assert(Number.isInteger(index) && index >= 1);
  if (adapter === 'codex_cli') {
    return { form: 'single', response: index % 2 ? 'relay' : 'native' };
  }
  if (adapter === 'codex-desktop') {
    return { form: 'single', response: index % 10 === 0 ? 'cancel' : (index % 2 ? 'beta' : 'alpha') };
  }
  if (index % 10 === 0) return { form: 'single', response: 'cancel' };
  if (index % 10 === 5) return { form: 'multi', response: 'relay' };
  const responses = ['relay', 'native', 'other'];
  return { form: 'single', response: responses[(index - 1) % responses.length] };
}

function rawPathFor(rawDir, adapter, index, attempt = 1) {
  const retrySuffix = attempt > 1 ? '-retry-' + String(attempt).padStart(3, '0') : '';
  return path.join(rawDir, adapter + '-' + String(index).padStart(3, '0') + retrySuffix + '.json');
}

function childArgs(adapter, index, options, attempt = 1) {
  const rawPath = rawPathFor(options.rawDir, adapter, index, attempt);
  const plan = responsePlan(adapter, index);
  const args = [
    path.join(__dirname, SCRIPTS[adapter]),
    '--send-live',
    '--require-capability',
    '--timeout-ms', String(options.timeoutMs),
    '--output', rawPath,
  ];
  if (adapter === 'codex') {
    args.push('--through-relay', '--form', plan.form, '--response', plan.response);
  } else {
    args.push('--response', plan.response);
  }
  return { adapter, index, attempt, plan, rawPath, args };
}

function existingPasses(manifest, adapter) {
  return new Set((manifest.runs || [])
    .filter(run => run.adapter === adapter && run.result === 'PASS')
    .map(run => run.index));
}

function buildPlan(options, manifest = { runs: [] }) {
  const result = [];
  const completed = new Map(options.adapters.map(adapter => [
    adapter,
    existingPasses(manifest, adapter),
  ]));
  for (let index = 1; index <= options.countPerAdapter; index += 1) {
    for (const adapter of options.adapters) {
      if (!completed.get(adapter).has(index)) {
        const attempt = 1 + (manifest.failures || []).filter(failure =>
          failure.adapter === adapter && failure.index === index).length;
        result.push(childArgs(adapter, index, options, attempt));
      }
    }
  }
  return result;
}

function percentile(values, percentileValue) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function rawPass(adapter, raw) {
  return adapter === 'codex' ? raw?.ok === true : raw?.result === 'PASS';
}

function compactRun(item, raw, sha256) {
  const adapter = item.adapter;
  const firstVisibleMs = adapter === 'codex_cli'
    ? raw.producer_to_visible_ms
    : adapter === 'codex-desktop'
      ? raw.native_observed_to_visible_ms
      : raw.producer_to_relay_visible_ms;
  const nativeToRelayMs = adapter === 'codex_cli'
    ? raw.producer_to_visible_ms
    : adapter === 'codex-desktop'
      ? raw.native_observed_to_visible_ms
      : raw.native_to_relay_ms;
  const clickToNativeAckMs = raw.click_to_native_ack_ms ?? null;
  const nativeGenerationMs = adapter === 'codex-desktop'
    ? raw.send_receipt_to_native_visible_ms
    : null;
  const prompt = adapter === 'codex'
    ? raw.relay_prompt || raw.question_lifecycle_messages?.[0]
    : raw.prompt;
  const nativeIdentity = adapter === 'codex_cli'
    ? { thread_id: raw.delivery?.thread_id || '', turn_id: raw.delivery?.turn_id || '' }
    : adapter === 'codex-desktop'
      ? { owned_thread_id: raw.owned_thread?.id || '' }
      : {
          conversation_id: raw.adapter_observed?.native_conversation_id || '',
          turn_id: raw.adapter_observed?.native_turn_id || '',
          request_id: raw.adapter_observed?.native_request_id || '',
        };
  return {
    adapter,
    index: item.index,
    attempt: item.attempt,
    result: rawPass(adapter, raw) ? 'PASS' : 'FAIL',
    form: item.plan.form,
    response: item.plan.response,
    started_at: raw.generated_at || null,
    finished_at: raw.finished_at || null,
    session_id: raw.session_id || '',
    prompt_id: prompt?.prompt_id || '',
    generation_hash: prompt?.generation
      ? crypto.createHash('sha256').update(String(prompt.generation)).digest('hex').slice(0, 16)
      : '',
    native_identity: nativeIdentity,
    terminal_lifecycle: raw.terminal_lifecycle || null,
    first_visible_ms: Number.isFinite(firstVisibleMs) ? firstVisibleMs : null,
    native_to_relay_ms: Number.isFinite(nativeToRelayMs) ? nativeToRelayMs : null,
    native_generation_ms: Number.isFinite(nativeGenerationMs) ? nativeGenerationMs : null,
    click_to_native_ack_ms: Number.isFinite(clickToNativeAckMs) ? clickToNativeAckMs : null,
    duplicate_native_answers: raw.duplicate_native_answers || 0,
    wrong_native_answers: raw.wrong_session_answers
      || raw.wrong_thread_answers || raw.wrong_conversation_answers || 0,
    false_success_receipts: raw.false_success_receipts || 0,
    ordinary_answer_user_turns: raw.ordinary_answer_user_turns
      ?? raw.history?.ordinary_answer_messages ?? 0,
    focus_actions: raw.focus_actions || 0,
    visible_windows_opened: raw.visible_windows_opened || 0,
    protected_actions: raw.protected_actions || 0,
    global_files_unchanged: raw.global_files_unchanged ?? null,
    protected_target_set_unchanged: raw.protected_target_set_unchanged ?? null,
    original_thread_restored: raw.original_thread_restored ?? null,
    owned_cleanup: adapter === 'codex_cli'
      ? raw.thread_archived === true && raw.session_closed === true
      : adapter === 'codex-desktop'
        ? raw.original_thread_restored === true
        : true,
    raw_path: item.rawPath,
    raw_sha256: sha256,
  };
}

function summarize(manifest) {
  const summary = {};
  for (const adapter of manifest.adapters) {
    const runs = manifest.runs.filter(run => run.adapter === adapter && run.result === 'PASS');
    const sum = field => runs.reduce((total, run) => total + Number(run[field] || 0), 0);
    summary[adapter] = {
      passed: runs.length,
      required: manifest.count_per_adapter,
      first_visible_p50_ms: percentile(runs.map(run => run.first_visible_ms), 50),
      first_visible_p95_ms: percentile(runs.map(run => run.first_visible_ms), 95),
      first_visible_max_ms: percentile(runs.map(run => run.first_visible_ms), 100),
      native_to_relay_p95_ms: percentile(runs.map(run => run.native_to_relay_ms), 95),
      native_generation_p95_ms: percentile(runs.map(run => run.native_generation_ms), 95),
      click_to_native_ack_p95_ms: percentile(runs.map(run => run.click_to_native_ack_ms), 95),
      duplicate_native_answers: sum('duplicate_native_answers'),
      wrong_native_answers: sum('wrong_native_answers'),
      false_success_receipts: sum('false_success_receipts'),
      ordinary_answer_user_turns: sum('ordinary_answer_user_turns'),
      focus_actions: sum('focus_actions'),
      visible_windows_opened: sum('visible_windows_opened'),
      protected_actions: sum('protected_actions'),
      terminal_lifecycles: runs.reduce((counts, run) => {
        const key = run.terminal_lifecycle || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    };
  }
  manifest.summary = summary;
  manifest.status = manifest.adapters.every(adapter =>
    summary[adapter].passed >= manifest.count_per_adapter
    && summary[adapter].duplicate_native_answers === 0
    && summary[adapter].wrong_native_answers === 0
    && summary[adapter].false_success_receipts === 0
    && summary[adapter].ordinary_answer_user_turns === 0
    && summary[adapter].focus_actions === 0
    && summary[adapter].visible_windows_opened === 0
    && summary[adapter].protected_actions === 0)
    ? 'COUNT_AND_BASELINE_PASS'
    : 'IN_PROGRESS';
  return manifest;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  const retryable = new Set(['EBUSY', 'EACCES', 'EPERM']);
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || attempt >= 40) throw error;
      const delayMs = Math.min(250, 25 * (attempt + 1));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rawRunHashMatches(run) {
  if (!run || run.result !== 'PASS' || !run.raw_path || !run.raw_sha256) return false;
  try {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(run.raw_path)).digest('hex');
    return actual === run.raw_sha256;
  } catch {
    return false;
  }
}

function readVerifiedResumeManifest(file) {
  const directory = path.dirname(file);
  const base = path.basename(file);
  const candidates = [file];
  try {
    for (const name of fs.readdirSync(directory)) {
      if (name.startsWith(base + '.tmp-')) candidates.push(path.join(directory, name));
    }
  } catch {}
  const valid = [];
  for (const candidate of candidates) {
    try {
      const manifest = readJson(candidate);
      if (!Array.isArray(manifest.runs) || !manifest.runs.every(rawRunHashMatches)) continue;
      valid.push({ file: candidate, manifest });
    } catch {}
  }
  valid.sort((left, right) => {
    const runDelta = right.manifest.runs.length - left.manifest.runs.length;
    if (runDelta) return runDelta;
    return Date.parse(right.manifest.updated_at || '') - Date.parse(left.manifest.updated_at || '');
  });
  assert(valid.length > 0, 'resume manifest and temporary checkpoints failed raw receipt verification');
  return valid[0];
}

function runChild(item) {
  return new Promise(resolve => {
    fs.mkdirSync(path.dirname(item.rawPath), { recursive: true });
    const child = spawn(process.execPath, item.args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, QUESTION_PROMPT_LIVE_SOAK: '1' },
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString('utf8')).slice(-16384);
    });
    child.on('error', error => resolve({ code: null, error, stderr }));
    child.on('exit', code => resolve({ code, stderr }));
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let manifest;
  if (options.resume) {
    const recovered = readVerifiedResumeManifest(options.output);
    manifest = recovered.manifest;
    assert.deepStrictEqual(manifest.adapters, options.adapters, 'resume adapters changed');
    assert.strictEqual(manifest.count_per_adapter, options.countPerAdapter,
      'resume count-per-adapter changed');
    options.rawDir = manifest.raw_dir;
    if (path.resolve(recovered.file) !== path.resolve(options.output)) {
      writeJsonAtomic(options.output, summarize(manifest));
      process.stdout.write(JSON.stringify({
        event: 'manifest_recovered',
        recovered_runs: manifest.runs.length,
        source: recovered.file,
      }) + '\n');
    }
  } else {
    manifest = {
      contract_version: 1,
      status: 'IN_PROGRESS',
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      adapters: options.adapters,
      count_per_adapter: options.countPerAdapter,
      raw_dir: options.rawDir,
      operation_lock_owned_by_children: true,
      child_process_windows_hidden: true,
      real_native_prompt_per_run: true,
      built_in_duplicate_after_terminal: true,
      varied_native_branches: true,
      adapter_contract_gates: {
        codex_cli_native_cancel: 'GATED OFF: Codex CLI 0.144.4 app-server question reports cancel_supported:false',
      },
      acceptance_boundary: {
        count_and_baseline_measured_here: true,
        separate_fault_injections_still_required: [
          'two_browser_tabs_plus_android_atomic_race',
          'disconnect_before_and_after_submit',
          'proxy_and_relay_reconnect',
          'app_server_restart',
          'reordered_and_duplicate_frames',
          'question_replacement',
          'stale_generation',
        ],
      },
      runs: [],
      failures: [],
    };
  }
  const plan = buildPlan(options, manifest);
  if (options.planOnly) {
    process.stdout.write(JSON.stringify({
      ok: true,
      mutation: false,
      planned_runs: plan.length,
      adapters: options.adapters,
      count_per_adapter: options.countPerAdapter,
      response_coverage: options.adapters.reduce((coverage, adapter) => {
        coverage[adapter] = Array.from(new Set(
          Array.from({ length: options.countPerAdapter }, (_, index) =>
            JSON.stringify(responsePlan(adapter, index + 1))),
        )).map(value => JSON.parse(value));
        return coverage;
      }, {}),
      child_process_windows_hidden: true,
    }, null, 2) + '\n');
    return;
  }

  writeJsonAtomic(options.output, summarize(manifest));
  for (const item of plan) {
    process.stdout.write(JSON.stringify({
      event: 'run_start',
      adapter: item.adapter,
      index: item.index,
      form: item.plan.form,
      response: item.plan.response,
    }) + '\n');
    const childResult = await runChild(item);
    let raw = null;
    try { raw = readJson(item.rawPath); } catch {}
    if (childResult.code !== 0 || !raw || !rawPass(item.adapter, raw)) {
      const failure = {
        adapter: item.adapter,
        index: item.index,
        attempt: item.attempt,
        form: item.plan.form,
        response: item.plan.response,
        child_exit_code: childResult.code,
        stderr_tail: childResult.stderr,
        raw_path: item.rawPath,
        raw_present: !!raw,
        recorded_at: new Date().toISOString(),
      };
      manifest.failures.push(failure);
      manifest.updated_at = new Date().toISOString();
      writeJsonAtomic(options.output, summarize(manifest));
      throw new Error('live soak child failed: ' + JSON.stringify(failure));
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(item.rawPath)).digest('hex');
    manifest.runs.push(compactRun(item, raw, sha256));
    manifest.updated_at = new Date().toISOString();
    writeJsonAtomic(options.output, summarize(manifest));
    process.stdout.write(JSON.stringify({
      event: 'run_pass',
      adapter: item.adapter,
      index: item.index,
      completed: manifest.summary[item.adapter].passed,
      required: options.countPerAdapter,
    }) + '\n');
  }
  manifest.completed_at = new Date().toISOString();
  writeJsonAtomic(options.output, summarize(manifest));
  process.stdout.write(JSON.stringify({
    ok: manifest.status === 'COUNT_AND_BASELINE_PASS',
    status: manifest.status,
    summary: manifest.summary,
    output: options.output,
    raw_dir: options.rawDir,
  }, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ADAPTERS,
  buildPlan,
  childArgs,
  compactRun,
  parseArgs,
  percentile,
  responsePlan,
  readVerifiedResumeManifest,
  summarize,
  writeJsonAtomic,
};
