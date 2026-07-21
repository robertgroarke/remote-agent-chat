#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_ROOT = path.resolve(process.env.RAC_CONFIG_ROOT || ROOT);
const liveSockets = new Set();

function closeAllConnections() {
  for (const ws of liveSockets) {
    try { ws.terminate(); } catch {}
  }
  liveSockets.clear();
}

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function atRoutineAnchor(iso, intervalMs) {
  const timestamp = Date.parse(iso || '');
  if (!Number.isFinite(timestamp) || !(intervalMs > 0)) return false;
  const remainder = ((timestamp % intervalMs) + intervalMs) % intervalMs;
  return remainder <= 30_000 || intervalMs - remainder <= 30_000;
}

function providerCadenceTruthful(summary) {
  const generatedAt = Date.parse(summary?.generated_at || '');
  return Number.isFinite(generatedAt)
    && Array.isArray(summary?.provider_calls)
    && summary.provider_calls.length > 0
    && summary.provider_calls.every(provider => {
      const nextAt = Date.parse(provider.next_refresh_at || '');
      return provider.refresh_interval_ms >= 60_000
        && provider.refresh_interval_ms <= 600_000
        && Number.isFinite(nextAt)
        && nextAt > generatedAt - 30_000;
    });
}

function summarizeSnapshot(snapshot, frameBytes = null) {
  const providers = Array.isArray(snapshot?.snapshots) ? snapshot.snapshots : [];
  const reporting = providers.filter(provider =>
    ['fresh', 'stale'].includes(provider.status) && Array.isArray(provider.windows) && provider.windows.length > 0);
  const cost = snapshot?.estimated_cost || {};
  return {
    generation: Number(snapshot?.generation) || 0,
    generated_at: snapshot?.generated_at || null,
    poll_interval_ms: Number(snapshot?.poll_interval_ms) || 0,
    cadence_mode: snapshot?.cadence_mode || null,
    in_flight: snapshot?.in_flight === true,
    frame_bytes: frameBytes,
    providers: providers.length,
    reporting_providers: reporting.length,
    quota_windows: reporting.reduce((sum, provider) => sum + provider.windows.length, 0),
    provider_calls: providers.map(provider => ({
      provider_id: provider.provider_id,
      status: provider.status,
      source: provider.source || null,
      request_count: Number(provider.request_count) || 0,
      latency_ms: Number(provider.latency_ms) || 0,
      cadence_class: provider.cadence_class || null,
      refresh_interval_ms: Number(provider.refresh_interval_ms) || 0,
      next_refresh_at: provider.next_refresh_at || null,
      window_count: Array.isArray(provider.windows) ? provider.windows.length : 0,
    })).sort((left, right) => left.provider_id.localeCompare(right.provider_id)),
    cost_status: cost.status || null,
    cost_records: Number(cost.records) || 0,
    cost_files_complete: Number(cost.scan?.files_complete) || 0,
    cost_files_total: Number(cost.scan?.files_total) || 0,
    cost_checkpoint_hash: cost.scan?.checkpoint_hash || null,
  };
}

function assertPopulated(summary, label) {
  assertQuotaPopulated(summary, label);
  assert(['partial', 'ready', 'stale'].includes(summary.cost_status), `${label} has no retained cost state`);
  assert(summary.cost_records > 0, `${label} has no cost records`);
}

function assertQuotaPopulated(summary, label) {
  assert(summary.reporting_providers >= 3, `${label} has fewer than three reporting providers`);
  assert(summary.quota_windows >= 7, `${label} has fewer than seven quota windows`);
}

function relayConfig() {
  const deployEnv = fidelity.loadEnvFile(path.join(CONFIG_ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(CONFIG_ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(CONFIG_ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  assert(token, 'JWT bearer token could not be built');
  assert(base, 'relay base URL could not be derived');
  return {
    url: base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      + '/client-ws?token=' + encodeURIComponent(token),
    deployEnv,
  };
}

function connect(url, onMessage = null) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    liveSockets.add(ws);
    ws.once('close', () => liveSockets.delete(ws));
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('production WebSocket connection timed out'));
    }, 15_000);
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ws.on('message', data => {
      const bytes = Buffer.byteLength(data);
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      onMessage?.(message, bytes);
      if (message.type !== 'connection_ack') return;
      clearTimeout(timer);
      resolve({ ws, ack: message, bytes });
    });
  });
}

async function main() {
  const outputPath = path.resolve(option('--output'));
  const referencePath = path.resolve(option('--reference'));
  const resumePath = option('--resume-checkpoint') ? path.resolve(option('--resume-checkpoint')) : null;
  const restartSourceRoot = path.resolve(option('--restart-source-root'));
  const firstCycleGeneration = Number(option('--first-cycle-generation'));
  const firstCycleAt = option('--first-cycle-at');
  const stormSize = Math.max(2, Math.min(50, Number(option('--storm-size', '25')) || 25));
  assert(option('--output'), '--output is required');
  assert(option('--reference'), '--reference is required');
  assert(option('--restart-source-root'), '--restart-source-root is required');
  if (firstCycleGeneration || firstCycleAt) {
    assert(Number.isInteger(firstCycleGeneration) && firstCycleGeneration > 0,
      '--first-cycle-generation must be a positive integer');
    assert(Number.isFinite(Date.parse(firstCycleAt)), '--first-cycle-at must be an ISO timestamp');
  }
  assert(fs.existsSync(path.join(restartSourceRoot, 'agent-proxy', 'proxy-engine.js')),
    'restart source root is invalid');

  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  assert(reference.ok, 'production browser reference did not pass');
  const intervalMs = 300_000;
  if (firstCycleGeneration) {
    assert(firstCycleGeneration > reference.refresh_generation_after,
      'first scheduled generation did not advance beyond the manual reference');
    assert(Number.isFinite(Date.parse(firstCycleAt)), 'first scheduled cycle timestamp is invalid');
  }

  const { url } = relayConfig();
  const snapshots = [];
  const receipts = new Map();
  const waiters = [];
  let latest = null;
  function observe(message, bytes) {
    if (message.type === 'provider_usage_snapshot' && message.snapshot) {
      const summary = summarizeSnapshot(message.snapshot, bytes);
      snapshots.push(summary);
      latest = summary;
      for (const waiter of [...waiters]) {
        if (waiter.predicate(summary)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          clearTimeout(waiter.timer);
          waiter.resolve(summary);
        }
      }
    }
    if (message.type === 'provider_usage_refresh_receipt' && message.request_id) {
      const entry = receipts.get(message.request_id) || { request_id: message.request_id, stages: [] };
      entry.stages.push({
        status: message.status,
        coalesced: message.coalesced === true,
        generation: Number(message.generation) || 0,
        cost_status: message.cost_status || null,
        code: message.code || null,
      });
      receipts.set(message.request_id, entry);
    }
  }
  function waitForSnapshot(predicate, timeoutMs = 360_000) {
    const existing = [...snapshots].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('timed out waiting for production provider snapshot'));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  const primary = await connect(url, observe);
  process.stderr.write('[usage-soak] initial production acknowledgement received\n');
  const initial = summarizeSnapshot(primary.ack.provider_usage, primary.bytes);
  latest = initial;
  assertQuotaPopulated(initial, 'initial relay cache');
  let cycles;
  let beforeStorm;
  let stormStarted;
  let requestIds;
  let terminalGenerations;
  let afterStorm;
  if (resumePath) {
    const checkpoint = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    const restartBoundary = checkpoint.checkpoint === 'cycles_and_refresh_storm_complete_restart_pending';
    const completedRestartEvidence = checkpoint.ok === true
      && checkpoint.hidden_restart
      && checkpoint.hidden_restart.false_zero_frames === 0;
    assert(restartBoundary || completedRestartEvidence,
      'resume input is neither a restart-boundary checkpoint nor completed restart evidence');
    cycles = checkpoint.scheduled_cycles;
    assert(Array.isArray(cycles) && cycles.length === 2, 'resume checkpoint lacks two scheduled cycles');
    cycles.forEach((cycle, index) => {
      assert(cycle.per_provider_deadlines_truthful || cycle.wall_clock_anchored,
        `resume scheduled cycle ${index + 1} lacks cadence proof`);
      assertQuotaPopulated(cycle, `resume scheduled cycle ${index + 1}`);
    });
    beforeStorm = cycles[1];
    stormStarted = Date.parse(checkpoint.generated_at) || Date.now();
    requestIds = Array.from({ length: checkpoint.refresh_storm.requesters }, (_, index) => `checkpoint-${index}`);
    terminalGenerations = [checkpoint.refresh_storm.terminal_generation];
    afterStorm = checkpoint.refresh_storm.post_snapshot;
    assert.strictEqual(checkpoint.refresh_storm.accepted, 1, 'resume storm accepted count drifted');
    assert.strictEqual(checkpoint.refresh_storm.coalesced, checkpoint.refresh_storm.requesters - 1,
      'resume storm coalesced count drifted');
    assert.strictEqual(checkpoint.refresh_storm.completed, checkpoint.refresh_storm.requesters,
      'resume storm completion count drifted');
    assertPopulated(afterStorm, 'resume post-storm snapshot');
  } else {
    cycles = firstCycleGeneration ? [{
      generation: firstCycleGeneration,
      generated_at: firstCycleAt,
      provenance: 'pre-run authenticated connection_ack probe',
      per_provider_deadlines_truthful: true,
    }] : [];
    let lastCycleGeneration = firstCycleGeneration || initial.generation;
    if (firstCycleGeneration && cycles.length < 2 && initial.generation > lastCycleGeneration
        && providerCadenceTruthful(initial)) {
      cycles.push({ ...initial, provenance: 'run initial connection_ack', per_provider_deadlines_truthful: true });
      lastCycleGeneration = initial.generation;
    }
    while (cycles.length < 2) {
      const cycle = await waitForSnapshot(summary =>
        summary.generation > lastCycleGeneration
        && providerCadenceTruthful(summary));
      assertQuotaPopulated(cycle, `scheduled cycle ${cycles.length + 1}`);
      cycles.push({ ...cycle, provenance: 'live provider_usage_snapshot', per_provider_deadlines_truthful: true });
      lastCycleGeneration = cycle.generation;
    }
    assert(cycles[1].generation > cycles[0].generation, 'scheduled cycles did not advance generation');
    beforeStorm = latest;
    stormStarted = Date.now();
    requestIds = Array.from({ length: stormSize }, (_, index) =>
      `production-usage-storm-${stormStarted}-${String(index + 1).padStart(2, '0')}`);
    for (const requestId of requestIds) {
      primary.ws.send(JSON.stringify({
        type: 'provider_usage_refresh', protocol_version: 1, request_id: requestId, force: true,
      }));
    }
    const receiptDeadline = Date.now() + 120_000;
    while (Date.now() < receiptDeadline) {
      const done = requestIds.every(requestId =>
        receipts.get(requestId)?.stages.some(stage => stage.status === 'completed' || stage.status === 'error'));
      if (done) break;
      await sleep(100);
    }
    assert(requestIds.every(requestId => receipts.get(requestId)?.stages.some(stage => stage.status === 'completed')),
      'refresh storm did not return completed receipts to every requester');
    const initialStages = requestIds.map(requestId => receipts.get(requestId).stages[0]);
    assert.strictEqual(initialStages.filter(stage => stage.status === 'accepted').length, 1,
      'refresh storm did not have exactly one accepted requester');
    assert.strictEqual(initialStages.filter(stage => stage.status === 'coalesced').length, stormSize - 1,
      'refresh storm followers were not all coalesced');
    terminalGenerations = [...new Set(requestIds.map(requestId =>
      receipts.get(requestId).stages.find(stage => stage.status === 'completed').generation))];
    assert.strictEqual(terminalGenerations.length, 1, 'refresh storm completed at multiple generations');
    afterStorm = await waitForSnapshot(summary =>
      summary.generation === terminalGenerations[0], 30_000);
    assert.strictEqual(afterStorm.generation, beforeStorm.generation + 1,
      'refresh storm advanced provider generation more than once');
    assertPopulated(afterStorm, 'post-storm snapshot');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({
      ok: false,
      checkpoint: 'cycles_and_refresh_storm_complete_restart_pending',
      generated_at: new Date().toISOString(),
      scheduled_cycles: cycles,
      refresh_storm: {
        requesters: stormSize,
        accepted: 1,
        coalesced: stormSize - 1,
        completed: stormSize,
        terminal_generation: terminalGenerations[0],
        post_snapshot: afterStorm,
      },
    }, null, 2)}\n`, 'utf8');
  }

  const restartStartedAt = new Date().toISOString();
  process.stderr.write('[usage-soak] starting hidden mutex restart\n');
  let restartStdout = '';
  let restartStderr = '';
  let killedResolve;
  const killed = new Promise(resolve => { killedResolve = resolve; });
  const python = process.env.PYTHON || 'python';
  const child = spawn(python, [
    '-u', path.join(ROOT, 'proxy_restart_lock.py'), '--agent', 'phase2-maturity',
    '--source-root', restartSourceRoot,
  ], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => {
    restartStdout += String(chunk);
    if (/Killed PID/.test(restartStdout)) killedResolve();
  });
  child.stderr.on('data', chunk => { restartStderr += String(chunk); });
  const childResult = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(code) : reject(new Error(
      `hidden proxy restart failed (${code}): ${restartStderr.slice(-1000)}`)));
  });
  await Promise.race([killed, sleep(15_000)]);
  const duringRestartConnection = await connect(url);
  const duringRestart = summarizeSnapshot(duringRestartConnection.ack.provider_usage, duringRestartConnection.bytes);
  assertQuotaPopulated(duringRestart, 'relay cache during hidden restart');
  process.stderr.write('[usage-soak] populated relay cache observed during restart\n');
  duringRestartConnection.ws.close();
  await childResult;
  process.stderr.write('[usage-soak] hidden mutex restart completed\n');
  const helperEvents = restartStdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('[proxy_restart_lock]'));
  const hiddenRestartLifecycle = {
    lock_acquired: helperEvents.some(line => /Lock acquired by phase2-maturity/.test(line)),
    old_proxy_killed: helperEvents.some(line => /Killed PID \d+/.test(line)),
    replacement_ready: helperEvents.some(line => /Proxy back up \(PID\(s\): \[[^\]]+\]\)/.test(line)),
    restart_complete: helperEvents.some(line => /Proxy restart complete\./.test(line)),
    lock_released: helperEvents.some(line => /Lock released by phase2-maturity/.test(line)),
    helper_events: helperEvents,
  };
  for (const [event, observed] of Object.entries(hiddenRestartLifecycle)) {
    if (event === 'helper_events') continue;
    assert.strictEqual(observed, true,
      `hidden restart lifecycle did not prove ${event}: ${JSON.stringify(helperEvents)}`);
  }
  let afterRestart = null;
  const reconnectDeadline = Date.now() + 180_000;
  while (Date.now() < reconnectDeadline) {
    const probe = await connect(url);
    const summary = summarizeSnapshot(probe.ack.provider_usage, probe.bytes);
    probe.ws.close();
    if (summary.reporting_providers >= 3) {
      afterRestart = summary;
      if (!summary.in_flight && summary.cost_records > 0) break;
    }
    await sleep(2_000);
  }
  assert(afterRestart, 'post-restart relay cache never repopulated');
  assertQuotaPopulated(afterRestart, 'post-restart snapshot');
  process.stderr.write('[usage-soak] populated post-restart cache observed\n');
  const restartWindow = snapshots.filter(summary =>
    Date.parse(summary.generated_at || '') >= Date.parse(restartStartedAt));
  const falseZeroFrames = restartWindow.filter(summary => summary.reporting_providers < 3);
  assert.strictEqual(falseZeroFrames.length, 0,
    `a false-zero provider frame appeared during restart: ${JSON.stringify(falseZeroFrames)}`);
  const reconnect = await connect(url);
  const reconnectSnapshot = summarizeSnapshot(reconnect.ack.provider_usage, reconnect.bytes);
  assertQuotaPopulated(reconnectSnapshot, 'post-restart reconnect cache');
  process.stderr.write('[usage-soak] populated fresh-client acknowledgement observed\n');
  reconnect.ws.close();

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: restartSourceRoot, encoding: 'utf8', windowsHide: true,
    }).trim(),
    reference: {
      path: path.relative(ROOT, referencePath).replace(/\\/g, '/'),
      manual_refresh_generation: reference.refresh_generation_after,
      manual_refresh_generated_at: reference.provider_snapshot_generated_at,
      asset_version: reference.asset_version,
    },
    scheduled_cycles: cycles,
    refresh_storm: {
      requesters: stormSize,
      accepted: 1,
      coalesced: stormSize - 1,
      completed: stormSize,
      terminal_generation: terminalGenerations[0],
      unique_generation_advances: 1,
      elapsed_ms: resumePath ? null : Date.now() - stormStarted,
      post_snapshot: afterStorm,
    },
    hidden_restart: {
      started_at: restartStartedAt,
      source_root: restartSourceRoot,
      ...hiddenRestartLifecycle,
      during_restart_cache: duringRestart,
      post_restart_snapshot: afterRestart,
      reconnect_cache: reconnectSnapshot,
      false_zero_frames: falseZeroFrames.length,
    },
    observed_snapshots: snapshots,
    safety: {
      visible_windows_opened: 0,
      focus_actions: 0,
      protected_session_mutations: 0,
      sends_or_harness_controls: 0,
      browser_pages_opened: 0,
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  primary.ws.close();
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    scheduled_cycles: result.scheduled_cycles.map(cycle => ({ generation: cycle.generation, generated_at: cycle.generated_at })),
    refresh_storm: result.refresh_storm,
    hidden_restart: result.hidden_restart,
    output: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
  }, null, 2)}\n`);
  closeAllConnections();
}

main().catch(error => {
  closeAllConnections();
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
