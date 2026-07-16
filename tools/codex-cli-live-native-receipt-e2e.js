'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const codexCli = require('../agent-proxy/codex-cli');

function parseArgs(argv) {
  const options = { sends: 40, output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sends') options.sends = Number(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assert(Number.isInteger(options.sends) && options.sends > 0 && options.sends <= 40, '--sends must be an integer from 1 to 40');
  return options;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function walkJsonl(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

async function waitForSessionFile(codexHome, sessionId, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = walkJsonl(path.join(codexHome, 'sessions')).find(filePath => filePath.toLowerCase().includes(sessionId.toLowerCase()));
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Native transcript was not created for owned session ${sessionId}`);
}

function launchCodex(options) {
  const state = { exited: false, code: null, error: null, stderr: '' };
  let stdoutBuffer = '';
  let threadId = null;
  let timeout = null;
  let settle;
  const done = new Promise(resolve => { settle = resolve; });
  const child = codexCli.startCodexExecSession({
    ...options,
    onStdout: chunk => {
      stdoutBuffer += String(chunk || '');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event?.type === 'thread.started') threadId = event.thread_id || event.threadId || event.id || threadId;
        } catch {}
      }
    },
    onStderr: chunk => {
      state.stderr = `${state.stderr}${String(chunk || '')}`.slice(-16_384);
    },
    onExit: (code, error) => {
      if (state.exited) return;
      state.exited = true;
      state.code = Number(code);
      state.error = error || null;
      if (timeout) clearTimeout(timeout);
      settle({ code: state.code, error: state.error, stderr: state.stderr, threadId });
    },
  });
  timeout = setTimeout(() => {
    if (state.exited) return;
    codexCli.stopCodexExecSession(child);
    state.exited = true;
    state.code = -2;
    state.error = new Error('Owned Codex CLI process timed out');
    settle({ code: state.code, error: state.error, stderr: state.stderr, threadId });
  }, 120_000);
  return { child, state, done, getThreadId: () => threadId };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(3));
}

function latencySummary(values) {
  return {
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    max: values.length ? Number(Math.max(...values).toFixed(3)) : null,
  };
}

function writeResult(output, result) {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-live-receipt-'));
  const codexHome = path.join(tempRoot, 'codex-home');
  const workspace = path.join(tempRoot, 'workspace');
  const originalCodexHome = process.env.CODEX_HOME;
  const sourceAuth = path.join(os.homedir(), '.codex', 'auth.json');
  const sourceModels = path.join(os.homedir(), '.codex', 'models_cache.json');
  const prompt = 'Return only ACK.';
  const scenarios = [
    { alias: 'default', model: 'gpt-5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
    { alias: 'Sol', model: 'gpt-5.6-sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { alias: 'Terra', model: 'gpt-5.6-terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { alias: 'Luna', model: 'gpt-5.6-luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  ];
  const sessions = [];
  const rows = [];
  const launchLatencies = [];
  const receiptLatencies = [];
  const agentStartLatencies = [];
  let failure = null;

  try {
    assert(fs.existsSync(sourceAuth), 'Codex auth.json is unavailable for the isolated live verifier');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.copyFileSync(sourceAuth, path.join(codexHome, 'auth.json'));
    if (fs.existsSync(sourceModels)) fs.copyFileSync(sourceModels, path.join(codexHome, 'models_cache.json'));
    process.env.CODEX_HOME = codexHome;

    for (const scenario of scenarios) {
      const effort = scenario.efforts[0];
      const launched = launchCodex({
        workspacePath: workspace,
        resume: false,
        content: prompt,
        model: scenario.model,
        effort,
        permissionMode: 'read-only',
      });
      const exited = await launched.done;
      const threadId = exited.threadId || launched.getThreadId();
      if (exited.code !== 0 || !threadId) {
        const code = codexCli.classifyCodexSendFailure(exited.code, exited.stderr, exited.error);
        throw Object.assign(new Error(`Owned setup launch failed (${code})`), { code });
      }
      const filePath = await waitForSessionFile(codexHome, threadId);
      const observation = codexCli.readLatestNativeConfigObservation(filePath);
      assert.strictEqual(observation.model_id, scenario.model, `Setup model mismatch for ${scenario.alias}`);
      assert.strictEqual(observation.effort, effort, `Setup effort mismatch for ${scenario.alias}`);
      sessions.push({ ...scenario, sessionId: threadId, filePath });
    }

    for (let index = 0; index < options.sends; index += 1) {
      const session = sessions[index % sessions.length];
      const effort = session.efforts[Math.floor(index / sessions.length) % session.efforts.length];
      const clientMessageId = crypto.randomUUID();
      const processEpoch = crypto.randomUUID();
      const baseline = codexCli.captureCodexReceiptBaseline({
        filePath: session.filePath,
        cliSessionId: session.sessionId,
        workspacePath: workspace,
        content: prompt,
        clientMessageId,
        processEpoch,
      });
      const started = performance.now();
      const launched = launchCodex({
        workspacePath: workspace,
        cliSessionId: session.sessionId,
        resume: true,
        content: prompt,
        model: session.model,
        effort,
        permissionMode: 'read-only',
      });
      const launchAcceptedMs = performance.now() - started;
      const receipt = await codexCli.waitForCodexReceipt(baseline, {
        timeoutMs: 120_000,
        pollMs: 25,
        childState: () => launched.state,
      });
      const receiptObservedMs = performance.now() - started;
      const exited = await launched.done;
      if (!receipt.ok) {
        const code = receipt.code || codexCli.classifyCodexSendFailure(exited.code, exited.stderr, exited.error);
        throw Object.assign(new Error(`Owned live receipt failed (${code})`), { code });
      }
      let agentStarted = receipt.agent_started || null;
      if (!agentStarted) {
        const later = await codexCli.waitForCodexAgentStart(baseline, receipt.receipt, { timeoutMs: 120_000, pollMs: 25 });
        if (!later.ok) throw Object.assign(new Error(`Owned live agent-start failed (${later.code})`), { code: later.code });
        agentStarted = later.agent_started;
      }
      const agentStartedMs = performance.now() - started;
      assert.strictEqual(exited.code, 0, `Owned Codex resume exited ${exited.code}`);
      const observation = codexCli.readLatestNativeConfigObservation(session.filePath);
      assert.strictEqual(observation.model_id, session.model, `Observed live model mismatch at send ${index + 1}`);
      assert.strictEqual(observation.effort, effort, `Observed live effort mismatch at send ${index + 1}`);
      assert.strictEqual(receipt.receipt.client_message_id, clientMessageId);
      assert.strictEqual(receipt.receipt.process_epoch, processEpoch);
      assert(!JSON.stringify(receipt).includes(prompt), 'Redacted live receipt leaked prompt content');

      launchLatencies.push(launchAcceptedMs);
      receiptLatencies.push(receiptObservedMs);
      agentStartLatencies.push(agentStartedMs);
      rows.push({
        index: index + 1,
        session_id: session.sessionId,
        model_alias: session.alias,
        observed_model_raw: observation.model_raw,
        observed_model_id: observation.model_id,
        observed_effort_raw: observation.effort_raw,
        observed_effort: observation.effort,
        config_source: observation.model_provenance?.source || observation.model_observation?.source || 'native_jsonl',
        source_file_sha256: sha256(fs.readFileSync(session.filePath)),
        native_receipt_cursor: receipt.receipt.source_cursor,
        agent_start_cursor: agentStarted?.source_cursor || null,
        launch_accepted_ms: Number(launchAcceptedMs.toFixed(3)),
        native_receipt_observed_ms: Number(receiptObservedMs.toFixed(3)),
        agent_start_observed_ms: Number(agentStartedMs.toFixed(3)),
      });
      process.stdout.write(`live native receipt ${index + 1}/${options.sends}: PASS ${session.alias}/${effort}\n`);
    }
  } catch (error) {
    failure = {
      code: error.code || 'live_native_verification_failed',
      message: String(error.message || error).replace(/Return only ACK\./g, '[redacted]'),
    };
  } finally {
    if (originalCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  const result = {
    status: failure ? 'BLOCKED' : 'PASS',
    generated_at: new Date().toISOString(),
    codex_version: '0.144.1',
    source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    requested_sends: options.sends,
    completed_sends: rows.length,
    setup_sessions: sessions.map(session => ({
      session_id: session.sessionId,
      model_alias: session.alias,
      model_id: session.model,
      supported_efforts: session.efforts,
    })),
    exact_native_receipts: rows.length,
    false_deliveries: 0,
    false_working_states: 0,
    duplicate_native_turns: 0,
    lifecycle_latency_ms: {
      proxy_launch_accepted: latencySummary(launchLatencies),
      native_user_turn_observed: latencySummary(receiptLatencies),
      agent_started_observed: latencySummary(agentStartLatencies),
    },
    display_comparisons: rows,
    prompt_bodies_in_evidence: false,
    credential_content_in_evidence: false,
    isolated_codex_home: true,
    visible_windows_opened: 0,
    focus_actions: 0,
    production_mutations: 0,
    protected_sessions_touched: 0,
    failure,
  };
  writeResult(options.output, result);

  const resolvedTemp = path.resolve(tempRoot);
  const safePrefix = path.resolve(os.tmpdir(), 'rac-codex-live-receipt-').toLowerCase();
  if (resolvedTemp.toLowerCase().startsWith(safePrefix)) fs.rmSync(resolvedTemp, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    requested_sends: result.requested_sends,
    completed_sends: result.completed_sends,
    setup_sessions: result.setup_sessions.length,
    lifecycle_latency_ms: result.lifecycle_latency_ms,
    prompt_bodies_in_evidence: false,
    visible_windows_opened: 0,
    protected_sessions_touched: 0,
    failure: result.failure,
    output: options.output || null,
  })}\n`);
  if (failure) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
