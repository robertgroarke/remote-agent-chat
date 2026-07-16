#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LocalUsageCostScanner,
  COST_SCHEMA_VERSION,
  PRICING_CATALOG_VERSION,
  aggregateRecords,
  calendarDay,
  priceRecord,
} = require('../agent-proxy/usage-costs');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const now = Date.parse('2026-07-15T12:00:00.000Z');

function codexContext(model, cwd = 'C:\\work\\alpha', tier = 'default') {
  return JSON.stringify({
    timestamp: '2026-07-15T01:00:00.000Z', type: 'turn_context',
    payload: { model, cwd, service_tier: tier },
  });
}

function codexUsage(id, timestamp, input = 1000, cached = 200, output = 100) {
  return JSON.stringify({
    timestamp, type: 'event_msg',
    payload: { type: 'token_count', id, info: { last_token_usage: {
      input_tokens: input, cached_input_tokens: cached, output_tokens: output,
    } } },
  });
}

function claudeUsage(id, model, timestamp, project, extra = {}) {
  return JSON.stringify({
    type: 'assistant', timestamp, cwd: `C:\\work\\${project}`,
    message: { id, model, usage: {
      input_tokens: extra.input ?? 100,
      cache_creation_input_tokens: extra.cacheCreate ?? 20,
      cache_read_input_tokens: extra.cacheRead ?? 10,
      output_tokens: extra.output ?? 30,
      service_tier: extra.tier || 'standard',
    } },
  });
}

async function runToBoundary(scanner, maxRuns = 30) {
  let result;
  for (let run = 0; run < maxRuns; run += 1) {
    result = await scanner.refresh();
    if (result.status === 'ready' || result.scan.bytes_read === 0) return result;
  }
  throw new Error('incremental scanner did not converge within the bounded fixture runs');
}

function monitorEventLoop(intervalMs = 10) {
  let expectedAt = Date.now() + intervalMs;
  const lags = [];
  const timer = setInterval(() => {
    const observedAt = Date.now();
    lags.push(Math.max(0, observedAt - expectedAt));
    expectedAt = observedAt + intervalMs;
  }, intervalMs);
  timer.unref();
  return async () => {
    await new Promise(resolve => setImmediate(resolve));
    clearInterval(timer);
    const ordered = lags.slice().sort((left, right) => left - right);
    return {
      samples: ordered.length,
      p95_ms: ordered.length ? ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] : 0,
      max_ms: ordered.length ? ordered[ordered.length - 1] : 0,
    };
  };
}

async function main() {
  assert.strictEqual(calendarDay('2026-07-15T01:30:00.000Z', 'America/Los_Angeles'), '2026-07-14',
    'Today cost buckets must follow the operator local calendar day rather than UTC midnight');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-provider-costs-'));
  const codexRoot = path.join(temp, 'codex');
  const claudeRoot = path.join(temp, 'claude');
  fs.mkdirSync(codexRoot, { recursive: true });
  fs.mkdirSync(claudeRoot, { recursive: true });
  const checkpoint = path.join(temp, 'state', 'checkpoint.json');
  const codexMain = path.join(codexRoot, 'session.jsonl');
  const claudeMain = path.join(claudeRoot, 'project.jsonl');
  const claudeReplay = path.join(claudeRoot, 'rotated.jsonl');
  try {
    const codexLines = [codexContext('gpt-5.6-sol')];
    for (let index = 0; index < 2000; index += 1) {
      codexLines.push(codexUsage(`sol-${index}`, `2026-07-${String(15 - (index % 10)).padStart(2, '0')}T01:00:00.000Z`));
    }
    codexLines.push(codexContext('gpt-5.6-terra-fast', 'C:\\work\\beta', 'priority'));
    codexLines.push(codexUsage('terra-fast', '2026-07-15T02:00:00.000Z', 2000, 500, 250));
    codexLines.push(codexContext('future-unknown-model', 'C:\\work\\unknown'));
    codexLines.push(codexUsage('unknown-codex', '2026-07-15T03:00:00.000Z'));
    const partial = codexUsage('partial-final', '2026-07-15T04:00:00.000Z');
    fs.writeFileSync(codexMain, `${codexLines.join('\n')}\n${partial}`, 'utf8');

    const claudeKnown = claudeUsage('claude-fable', 'claude-fable-5', '2026-07-15T05:00:00.000Z', 'gamma');
    const claudeUnknown = claudeUsage('claude-unknown', 'claude-future-9', '2026-07-14T05:00:00.000Z', 'delta', { tier: 'priority' });
    fs.writeFileSync(claudeMain, `${claudeKnown}\n${claudeUnknown}\n`, 'utf8');
    fs.writeFileSync(claudeReplay, `${claudeKnown}\n`, 'utf8');
    const oldArchiveTime = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(codexMain, oldArchiveTime, oldArchiveTime);

    const scanner = new LocalUsageCostScanner({
      roots: [
        { providerId: 'openai-codex', root: codexRoot },
        { providerId: 'anthropic-claude', root: claudeRoot },
      ],
      checkpointPath: checkpoint,
      maxBytesPerRefresh: 65536,
      now: () => now,
    });
    const stopLagMonitor = monitorEventLoop();
    const first = await scanner.refresh();
    assert.strictEqual(first.status, 'partial', 'huge fixture must require bounded incremental work');
    assert(first.scan.bytes_read <= 65536);
    assert(first.by_model.some(item => item.model === 'claude-fable-5'),
      'the first bounded pass must prioritize newer current-session files over an old huge archive');
    let settled = await runToBoundary(scanner);
    assert.strictEqual(settled.status, 'partial', 'unterminated final JSONL must remain safely pending');
    assert.strictEqual(settled.records, 2004, 'replayed Claude message must dedupe and partial Codex line must not count');
    assert(settled.unknown_models.some(item => item.model === 'future-unknown-model'));
    assert(settled.unknown_models.some(item => item.model === 'claude-future-9'));
    assert(settled.by_speed.some(item => item.speed === 'fast/priority'));
    assert(settled.by_model.some(item => item.model === 'gpt-5.6-terra'));
    assert(settled.by_model.some(item => item.model === 'claude-fable-5'));
    const eventLoopLag = await stopLagMonitor();
    assert(eventLoopLag.samples >= 5, 'large incremental scan must yield repeatedly to the event loop');
    assert(eventLoopLag.p95_ms <= 75, `large incremental scan p95 event-loop lag was ${eventLoopLag.p95_ms}ms`);
    assert(eventLoopLag.max_ms <= 250, `large incremental scan max event-loop lag was ${eventLoopLag.max_ms}ms`);

    fs.appendFileSync(codexMain, '\n', 'utf8');
    settled = await runToBoundary(scanner);
    assert.strictEqual(settled.status, 'ready');
    assert.strictEqual(settled.records, 2005);
    const readyHash = settled.scan.checkpoint_hash;
    const readyCost = settled.cost_usd;
    const checkpointMtime = fs.statSync(checkpoint).mtimeMs;
    const warm = await scanner.refresh();
    assert.strictEqual(warm.scan.bytes_read, 0, 'warm refresh must perform bounded zero-byte tail work');
    assert.strictEqual(warm.scan.checkpoint_hash, readyHash);
    assert.strictEqual(warm.cost_usd, readyCost);
    assert.strictEqual(fs.statSync(checkpoint).mtimeMs, checkpointMtime,
      'warm refresh must not rewrite an unchanged durable checkpoint');

    const restarted = new LocalUsageCostScanner({
      roots: scanner.roots, checkpointPath: checkpoint, maxBytesPerRefresh: 65536, now: () => now,
    });
    const restartWarm = await restarted.refresh();
    assert.strictEqual(restartWarm.scan.bytes_read, 0, 'restart must resume from durable checkpoints');
    assert.strictEqual(restartWarm.cost_usd, readyCost);

    const controller = new AbortController();
    controller.abort();
    const cancelled = await restarted.refresh({ signal: controller.signal });
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.scan.bytes_read, 0);
    settled = await restarted.refresh();
    assert.strictEqual(settled.status, 'ready');

    const originalText = fs.readFileSync(codexMain, 'utf8');
    const archive = path.join(codexRoot, 'archive.jsonl');
    fs.renameSync(codexMain, archive);
    const rotatedExtra = codexUsage('rotation-extra', '2026-07-15T06:00:00.000Z');
    fs.writeFileSync(codexMain, `${originalText}${rotatedExtra}\n`, 'utf8');
    settled = await runToBoundary(restarted);
    assert.strictEqual(settled.records, 2006, 'rotated/replayed archive must not double count');

    const truncatedLines = [
      codexContext('gpt-5.6-luna', 'C:\\work\\epsilon'),
      codexUsage('post-truncate', '2026-07-15T07:00:00.000Z', 3000, 1000, 500),
    ];
    fs.writeFileSync(codexMain, `${truncatedLines.join('\n')}\n`, 'utf8');
    settled = await runToBoundary(restarted);
    assert.strictEqual(settled.records, 2006,
      'truncation must remove the replaced tail while rotated owners preserve replayed history');
    assert(settled.by_model.some(item => item.model === 'gpt-5.6-luna'));

    const oracle = new LocalUsageCostScanner({
      roots: restarted.roots,
      checkpointPath: path.join(temp, 'oracle', 'checkpoint.json'),
      maxBytesPerRefresh: 16 * 1024 * 1024,
      now: () => now,
    });
    const oracleResult = await runToBoundary(oracle, 4);
    assert.deepStrictEqual(settled.tokens, oracleResult.tokens);
    assert.strictEqual(settled.cost_usd, oracleResult.cost_usd);
    assert.strictEqual(settled.records, oracleResult.records);
    assert.deepStrictEqual(settled.daily_breakdown, oracleResult.daily_breakdown);

    const lastDayAlpha = aggregateRecords(Object.values(restarted.state.records), now, 2, { project: 'alpha' });
    assert(lastDayAlpha.records > 0 && lastDayAlpha.records < settled.records,
      'date and project filters must select a strict aggregate subset');
    const claudeOnly = aggregateRecords(Object.values(restarted.state.records), now, 365, { providerId: 'anthropic-claude' });
    assert.strictEqual(claudeOnly.records, 2);

    const cachedCost = priceRecord('openai-codex', 'gpt-5.6-sol', { input: 1000000, cached: 400000, output: 1000000 });
    assert.strictEqual(Number(cachedCost.costUsd.toFixed(6)), 51.4,
      'Sol long-context pricing must retain the cached-token discount');
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      pricing_catalog_version: PRICING_CATALOG_VERSION,
      cost_schema_version: COST_SCHEMA_VERSION,
      local_calendar_day_boundaries: true,
      huge_records: 2000,
      newest_files_scanned_first: true,
      final_records: settled.records,
      partial_final_line_deferred: true,
      duplicate_replay_deduped: true,
      cached_tokens_priced: true,
      fast_priority_bucketed: true,
      unknown_alias_fallbacks: settled.unknown_models.length,
      date_and_project_filters: true,
      cancellation_checkpointed: true,
      restart_checkpoint_warm_bytes: restartWarm.scan.bytes_read,
      warm_refresh_bytes: warm.scan.bytes_read,
      warm_checkpoint_rewritten: false,
      incremental_scan_event_loop_lag: eventLoopLag,
      rotated_and_truncated_equal_oracle: true,
      checkpoint_hash: settled.scan.checkpoint_hash,
      oracle_checkpoint_hash: oracleResult.scan.checkpoint_hash,
      visible_windows_opened: 0,
      focus_actions: 0,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`provider cost scanner E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
