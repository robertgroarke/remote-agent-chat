'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-receipt-'));
const codexRoot = path.join(root, '.codex');
const sessionsRoot = path.join(codexRoot, 'sessions', '2026', '07', '14');
fs.mkdirSync(sessionsRoot, { recursive: true });
fs.writeFileSync(path.join(codexRoot, 'models_cache.json'), JSON.stringify({
  fetched_at: '2026-07-14T00:00:00.000Z',
  client_version: '0.144.1',
  models: [
    {
      slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }],
    },
    {
      slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list', default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' }],
    },
    {
      slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' }],
    },
    {
      slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }],
    },
    { slug: 'codex-auto-review', display_name: 'Hidden', visibility: 'hide', supported_reasoning_levels: [{ effort: 'high' }] },
  ],
}, null, 2));

process.env.USERPROFILE = root;
const codexCli = require('../agent-proxy/codex-cli');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const line = entry => `${JSON.stringify(entry)}\n`;
const ts = (offset = 0) => new Date(Date.now() + offset).toISOString();
const userEntry = (content, offset = 0) => ({
  timestamp: ts(offset),
  type: 'response_item',
  payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
});
const reasoningEntry = (offset = 0) => ({
  timestamp: ts(offset),
  type: 'response_item',
  payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'working' }] },
});
const sessionPath = id => path.join(sessionsRoot, `rollout-2026-07-14T00-00-00-${id}.jsonl`);
const write = (filePath, entries) => fs.writeFileSync(filePath, entries.map(line).join(''));
const append = (filePath, entries) => fs.appendFileSync(filePath, entries.map(line).join(''));

async function main() {
  const catalog = codexCli.readCodexModelCatalog(path.join(codexRoot, 'models_cache.json'));
  assert.strictEqual(catalog.source, 'codex_models_cache');
  assert.deepStrictEqual(catalog.models.map(model => model.id), [
    'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  ]);
  assert(catalog.efforts.some(effort => effort.id === 'xhigh'));
  assert(catalog.efforts.some(effort => effort.id === 'ultra'));
  assert.strictEqual(codexCli.normalizeCodexModelAlias('Sol', catalog.models), 'gpt-5.6-sol');
  assert.strictEqual(codexCli.normalizeCodexModelAlias('Terra', catalog.models), 'gpt-5.6-terra');
  assert.strictEqual(codexCli.normalizeCodexModelAlias('Luna', catalog.models), 'gpt-5.6-luna');
  assert.deepStrictEqual(
    codexCli.codexCliEffortsForModel('gpt-5.6-luna').map(effort => effort.id),
    ['low', 'medium', 'high', 'xhigh', 'max'],
    'the active model must receive only its complete advertised effort list',
  );

  const modelsRef = codexCli.CODEX_CLI_MODELS;
  const effortsRef = codexCli.CODEX_CLI_EFFORTS;
  const cachePath = path.join(codexRoot, 'models_cache.json');
  const updatedCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  updatedCache.fetched_at = '2026-07-20T20:15:00.000Z';
  updatedCache.client_version = '0.144.6';
  updatedCache.models.push({
    slug: 'gpt-5.7-nova', display_name: 'GPT-5.7-Nova', visibility: 'list', default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }, { effort: 'max' }],
  });
  const replacementPath = `${cachePath}.replacement`;
  fs.writeFileSync(replacementPath, JSON.stringify(updatedCache, null, 2));
  fs.renameSync(replacementPath, cachePath);
  const refresh = codexCli.refreshCodexModelCatalog({
    nowMs: Date.now() + 20_000,
    minIntervalMs: 15_000,
  });
  assert(refresh.checked && refresh.changed, 'a changed cache must hot-refresh after the bounded interval');
  assert.strictEqual(codexCli.CODEX_CLI_MODELS, modelsRef, 'model array identity must stay live for existing imports');
  assert.strictEqual(codexCli.CODEX_CLI_EFFORTS, effortsRef, 'effort array identity must stay live for existing imports');
  assert(codexCli.CODEX_CLI_MODELS.some(model => model.id === 'gpt-5.7-nova'), 'new models must appear without a module reload');
  assert.deepStrictEqual(
    codexCli.codexCliEffortsForModel('gpt-5.7-nova').map(effort => effort.id),
    ['medium', 'high', 'max'],
  );
  fs.writeFileSync(cachePath, '{"models": [');
  const retained = codexCli.refreshCodexModelCatalog({ force: true });
  assert.strictEqual(retained.reason, 'invalid_cache_retained');
  assert(codexCli.CODEX_CLI_MODELS.some(model => model.id === 'gpt-5.7-nova'), 'partial cache writes must retain the last known-good catalog');

  const installedFixture = path.join(__dirname, 'fixtures', 'codex-cli-session-current-0.144.6.jsonl');
  const installedObservation = codexCli.readLatestNativeConfigObservation(installedFixture);
  assert.strictEqual(installedObservation.model_id, 'gpt-5.6-luna');
  assert.strictEqual(installedObservation.effort, 'max');
  assert.strictEqual(installedObservation.model_observation.source, 'turn_context');
  assert.strictEqual(installedObservation.effort_observation.source, 'turn_context');

  const completionId = '05000000-0000-4000-8000-000000000001';
  const completionFile = sessionPath(completionId);
  write(completionFile, [
    { timestamp: ts(-6000), type: 'session_meta', payload: { id: completionId, cwd: root } },
    {
      timestamp: ts(-5900),
      type: 'turn_context',
      payload: { turn_id: 'completion-turn', model: 'gpt-5.4-mini', effort: 'low' },
    },
  ]);
  const completionTurn = {};
  const completionSession = {
    codexCliFilePath: completionFile,
    _codexAppServerTurn: completionTurn,
    observedModelId: 'unknown',
    observedEffort: 'unknown',
  };
  const completionEngine = Object.create(ProxyEngine.prototype);
  completionEngine.sessions = new Map([[completionId, completionSession]]);
  completionEngine._applyCodexCliSummaryMetadata = (sessionId, session, summary) => {
    assert.strictEqual(sessionId, completionId);
    assert.strictEqual(summary.model_id, 'gpt-5.4-mini');
    assert.strictEqual(summary.effort, 'low');
    session.observedModelId = summary.model_id;
    session.observedEffort = summary.effort;
    return true;
  };
  let completionPublished = null;
  completionEngine._publishCodexCliConfig = (sessionId, session) => {
    completionPublished = {
      session_id: sessionId,
      observed_model_id: session.observedModelId,
      observed_effort: session.observedEffort,
    };
    return completionPublished;
  };
  completionEngine._log = () => {};
  const completionReceipt = await completionEngine._publishCodexCliNativeCompletionConfig(
    completionId,
    completionSession,
    completionTurn,
    { timeoutMs: 50, pollMs: 5 },
  );
  assert(completionReceipt.model_observed && completionReceipt.effort_observed);
  assert.deepStrictEqual(completionPublished, {
    session_id: completionId,
    observed_model_id: 'gpt-5.4-mini',
    observed_effort: 'low',
  });

  const configId = '10000000-0000-4000-8000-000000000001';
  const configFile = sessionPath(configId);
  write(configFile, [{ timestamp: ts(-5000), type: 'session_meta', payload: { id: configId, cwd: root } }]);
  let observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'unknown');
  assert.strictEqual(observed.effort, 'unknown');
  append(configFile, [{ timestamp: ts(-4000), type: 'turn_context', payload: { model: 'gpt-5.5', effort: 'low' } }]);
  observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'gpt-5.5');
  assert.strictEqual(observed.effort, 'low');
  append(configFile, [{ timestamp: ts(-3000), type: 'turn_context', payload: { model: 'gpt-5.6-luna', effort: 'xhigh' } }]);
  observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'gpt-5.6-luna');
  assert.strictEqual(observed.effort, 'xhigh');

  const partialConfig = JSON.stringify({ timestamp: ts(-2000), type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'ultra' } });
  fs.appendFileSync(configFile, partialConfig.slice(0, -2));
  observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'gpt-5.6-luna', 'partial config line must not replace the last complete observation');
  fs.appendFileSync(configFile, `${partialConfig.slice(-2)}\n`);
  observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'gpt-5.6-sol');
  assert.strictEqual(observed.effort, 'ultra');

  write(configFile, [
    { timestamp: ts(-1000), type: 'session_meta', payload: { id: configId, cwd: root } },
    { timestamp: ts(-900), type: 'turn_context', payload: { model: 'gpt-5.6-terra', effort: 'max' } },
  ]);
  observed = codexCli.readLatestNativeConfigObservation(configFile);
  assert.strictEqual(observed.model_id, 'gpt-5.6-terra', 'rotation/compaction must discard stale cached config');
  assert.strictEqual(observed.source_cursor.mode, 'recovery');

  const boundedId = '10000000-0000-4000-8000-000000000002';
  const boundedFile = sessionPath(boundedId);
  write(boundedFile, [
    { timestamp: ts(-800), type: 'session_meta', payload: { id: boundedId, cwd: root, model: 'gpt-5.5', effort: 'medium' } },
  ]);
  for (let index = 0; index < 90; index++) {
    fs.appendFileSync(boundedFile, line({ timestamp: ts(-700 + index), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: index } }, padding: 'x'.repeat(50 * 1024) } }));
  }
  append(boundedFile, [{ timestamp: ts(-100), type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'xhigh' } }]);
  observed = codexCli.readLatestNativeConfigObservation(boundedFile, 4 * 1024 * 1024);
  assert.strictEqual(observed.model_id, 'gpt-5.6-sol');
  assert(observed.source_cursor.start_offset > 0, 'large archives must use a bounded tail cursor');

  const matrixId = '20000000-0000-4000-8000-000000000001';
  const matrixFile = sessionPath(matrixId);
  write(matrixFile, [{ timestamp: ts(-10000), type: 'session_meta', payload: { id: matrixId, cwd: root } }]);
  const latencies = [];
  for (let index = 0; index < 40; index++) {
    const prompt = `receipt-matrix-${index % 5}`;
    const baseline = codexCli.captureCodexReceiptBaseline({
      filePath: matrixFile,
      cliSessionId: matrixId,
      workspacePath: root,
      content: prompt,
      clientMessageId: `cid-${index}`,
      processEpoch: `epoch-${index}`,
    });
    const started = process.hrtime.bigint();
    append(matrixFile, [
      { timestamp: ts(index * 3), type: 'turn_context', payload: { model: index % 2 ? 'gpt-5.6-sol' : 'gpt-5.5', effort: index % 2 ? 'xhigh' : 'medium' } },
      userEntry(prompt, index * 3 + 1),
      reasoningEntry(index * 3 + 2),
    ]);
    const receipt = codexCli.inspectCodexReceipt(baseline);
    latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
    assert(receipt.ok, `matrix send ${index} did not receive an exact native receipt: ${receipt.code}`);
    assert(receipt.agent_started, `matrix send ${index} did not correlate a later agent event`);
    assert.strictEqual(receipt.receipt.client_message_id, `cid-${index}`);
    assert.strictEqual(receipt.receipt.post_baseline_occurrence, 1);
    assert(!JSON.stringify(receipt).includes(prompt), 'receipt evidence must not contain prompt bodies');
  }

  const partialId = '30000000-0000-4000-8000-000000000001';
  const partialFile = sessionPath(partialId);
  write(partialFile, [{ timestamp: ts(-100), type: 'session_meta', payload: { id: partialId, cwd: root } }]);
  const partialBaseline = codexCli.captureCodexReceiptBaseline({ filePath: partialFile, cliSessionId: partialId, content: 'partial-turn', clientMessageId: 'cid-partial' });
  const partialLine = JSON.stringify(userEntry('partial-turn'));
  fs.appendFileSync(partialFile, partialLine);
  assert.strictEqual(codexCli.inspectCodexReceipt(partialBaseline).ok, false);
  fs.appendFileSync(partialFile, '\n');
  assert(codexCli.inspectCodexReceipt(partialBaseline).ok, 'completed partial line must become receiptable');

  const orderingId = '30000000-0000-4000-8000-000000000002';
  const orderingFile = sessionPath(orderingId);
  write(orderingFile, [{ timestamp: ts(-100), type: 'session_meta', payload: { id: orderingId, cwd: root } }]);
  const orderingBaseline = codexCli.captureCodexReceiptBaseline({ filePath: orderingFile, cliSessionId: orderingId, content: 'ordering-turn', clientMessageId: 'cid-ordering' });
  append(orderingFile, [
    { timestamp: ts(), type: 'event_msg', payload: { type: 'task_started' } },
    userEntry('ordering-turn', 1),
  ]);
  let orderingReceipt = codexCli.inspectCodexReceipt(orderingBaseline);
  assert(orderingReceipt.ok && !orderingReceipt.agent_started, 'pre-receipt task_started must not count as agent started');
  append(orderingFile, [reasoningEntry(2)]);
  orderingReceipt = codexCli.inspectCodexReceipt(orderingBaseline);
  assert(orderingReceipt.agent_started, 'later reasoning must count as agent started');

  const rotateId = '30000000-0000-4000-8000-000000000003';
  const rotateFile = sessionPath(rotateId);
  write(rotateFile, [{ timestamp: ts(-100), type: 'session_meta', payload: { id: rotateId, cwd: root } }]);
  const rotateBaseline = codexCli.captureCodexReceiptBaseline({ filePath: rotateFile, cliSessionId: rotateId, content: 'rotated-turn', clientMessageId: 'cid-rotate' });
  write(rotateFile, [
    { timestamp: ts(10), type: 'session_meta', payload: { id: rotateId, cwd: root } },
    userEntry('rotated-turn', 11),
    reasoningEntry(12),
  ]);
  const rotatedReceipt = codexCli.inspectCodexReceipt(rotateBaseline);
  assert(rotatedReceipt.ok && rotatedReceipt.receipt.source_cursor.rotated, 'rotated transcript must recover without a stale offset');

  const wrongId = '30000000-0000-4000-8000-000000000004';
  const wrongFile = sessionPath(wrongId);
  write(wrongFile, [{ timestamp: ts(), type: 'session_meta', payload: { id: wrongId, cwd: root } }]);
  const wrongBaseline = codexCli.captureCodexReceiptBaseline({ filePath: wrongFile, cliSessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', content: 'wrong-session-turn', clientMessageId: 'cid-wrong' });
  append(wrongFile, [userEntry('wrong-session-turn', 1)]);
  assert.strictEqual(codexCli.inspectCodexReceipt(wrongBaseline).code, 'native_receipt_wrong_session');

  const malformedId = '30000000-0000-4000-8000-000000000005';
  const malformedFile = sessionPath(malformedId);
  write(malformedFile, [{ timestamp: ts(), type: 'session_meta', payload: { id: malformedId, cwd: root } }]);
  const malformedBaseline = codexCli.captureCodexReceiptBaseline({ filePath: malformedFile, cliSessionId: malformedId, content: 'malformed-turn', clientMessageId: 'cid-malformed' });
  fs.appendFileSync(malformedFile, '{bad-json}\n');
  assert.strictEqual(codexCli.inspectCodexReceipt(malformedBaseline).code, 'native_receipt_malformed_tail');

  const twinContent = 'same-content-two-sessions';
  for (const [id, cid] of [
    ['40000000-0000-4000-8000-000000000001', 'cid-twin-a'],
    ['40000000-0000-4000-8000-000000000002', 'cid-twin-b'],
  ]) {
    const filePath = sessionPath(id);
    write(filePath, [{ timestamp: ts(), type: 'session_meta', payload: { id, cwd: root } }]);
    const baseline = codexCli.captureCodexReceiptBaseline({ filePath, cliSessionId: id, content: twinContent, clientMessageId: cid });
    append(filePath, [userEntry(twinContent, 1), reasoningEntry(2)]);
    const receipt = codexCli.inspectCodexReceipt(baseline);
    assert(receipt.ok && receipt.receipt.client_message_id === cid, 'simultaneous sessions must remain session-scoped');
  }

  const noAppendId = '50000000-0000-4000-8000-000000000001';
  const noAppendFile = sessionPath(noAppendId);
  write(noAppendFile, [{ timestamp: ts(), type: 'session_meta', payload: { id: noAppendId, cwd: root } }]);
  const noAppendBaseline = codexCli.captureCodexReceiptBaseline({ filePath: noAppendFile, cliSessionId: noAppendId, content: 'no-append', clientMessageId: 'cid-no-append' });
  const noAppend = await codexCli.waitForCodexReceipt(noAppendBaseline, {
    timeoutMs: 2000,
    pollMs: 25,
    childState: () => ({ exited: true, code: 0, stderr: '' }),
  });
  assert.strictEqual(noAppend.code, 'native_user_turn_not_observed');
  const nonzero = await codexCli.waitForCodexReceipt(noAppendBaseline, {
    timeoutMs: 1000,
    pollMs: 25,
    childState: () => ({ exited: true, code: 7, stderr: 'command failed' }),
  });
  assert.strictEqual(nonzero.code, 'codex_cli_nonzero_exit');
  assert.strictEqual(codexCli.classifyCodexSendFailure(1, 'HTTP 429 usage limit'), 'codex_usage_or_rate_limited');
  assert.strictEqual(codexCli.classifyCodexSendFailure(1, '401 unauthorized'), 'codex_auth_failed');

  const sorted = latencies.slice().sort((left, right) => left - right);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  const result = {
    sends: 40,
    exact_native_receipts: 40,
    false_deliveries: 0,
    duplicate_native_dispatches: 0,
    p50_ms: Number(percentile(0.50).toFixed(3)),
    p95_ms: Number(percentile(0.95).toFixed(3)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(3)),
    config_cases: ['unknown', 'later_turn_change', 'partial_line', 'rotation', 'bounded_tail', 'installed_0.144.6_turn_context', 'completion_publish_before_teardown', 'catalog_hot_refresh', 'partial_cache_retained'],
    receipt_cases: ['identical_sequential', 'partial_line', 'wrong_session', 'malformed_tail', 'rotation', 'two_sessions', 'exit_0_no_append', 'nonzero_exit'],
  };
  process.stdout.write(`PASS codex-cli receipt/config matrix ${JSON.stringify(result)}\n`);
}

main().finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
