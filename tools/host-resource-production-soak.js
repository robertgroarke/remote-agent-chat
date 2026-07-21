#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const diagnostic = args.includes('--diagnostic');
const durationSeconds = Math.max(30, Number(option('--duration-seconds', diagnostic ? '60' : '1800')) || 0);
const outputPath = option('--output') ? path.resolve(option('--output')) : '';
const formal = !diagnostic && durationSeconds >= 1800;
const runtimeRoot = option('--runtime-root') ? path.resolve(option('--runtime-root')) : root;
const proxyLogPath = path.join(runtimeRoot, 'proxy.log');
const proxyErrorLogPath = path.join(runtimeRoot, 'proxy-err.log');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      let value;
      try { value = predicate(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

function percentile(values, quantile) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function summary(values) {
  const rows = values.filter(Number.isFinite);
  return {
    samples: rows.length,
    min: rows.length ? Math.min(...rows) : null,
    p50: percentile(rows, 0.5),
    p95: percentile(rows, 0.95),
    max: rows.length ? Math.max(...rows) : null,
    mean: rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null,
  };
}

function readSuffix(filePath, offset) {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const start = stat.size >= offset ? offset : 0;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, stat.size - start));
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function latestPollBudget(text) {
  const matches = [...String(text || '').matchAll(
    /\[poll\] budget completed=(\d+) window=(\d+) p95_ms=(\d+) max_ms=(\d+) skipped_total=(\d+) skipped_delta=(\d+)/g,
  )];
  if (!matches.length) return null;
  const match = matches.at(-1);
  return {
    completed_ticks: Number(match[1]),
    window_samples: Number(match[2]),
    p95_ms: Number(match[3]),
    max_ms: Number(match[4]),
    skipped_total: Number(match[5]),
    skipped_delta: Number(match[6]),
  };
}

function countMatches(text, pattern) {
  return [...String(text || '').matchAll(pattern)].length;
}

function proxyWorkerPid() {
  const lockPath = path.join(runtimeRoot, 'data', 'proxy-supervisor.lock');
  const supervisorPid = Number(String(fs.readFileSync(lockPath, 'utf8')).split(/\r?\n/)[0]);
  assert(Number.isSafeInteger(supervisorPid) && supervisorPid > 0, 'proxy supervisor PID unavailable');
  const script = [
    `$row=Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${supervisorPid}`,
    "-and $_.Name -eq 'node.exe' } | Select-Object -First 1;",
    "if($row){$row.ProcessId}else{exit 3}",
  ].join(' ');
  const raw = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
  ], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const workerPid = Number(raw);
  assert(Number.isSafeInteger(workerPid) && workerPid > 0, 'proxy worker PID unavailable');
  return workerPid;
}

function processSample(workerPid) {
  const script = [
    `$row=Get-Process -Id ${workerPid} -ErrorAction Stop;`,
    '[pscustomobject]@{cpu_seconds=$row.CPU;working_set_bytes=$row.WorkingSet64;started_at=$row.StartTime.ToUniversalTime().ToString("o")}',
    '| ConvertTo-Json -Compress',
  ].join(' ');
  const raw = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
  ], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const parsed = JSON.parse(raw);
  return {
    at_ms: Date.now(),
    cpu_seconds: Number(parsed.cpu_seconds),
    working_set_bytes: Number(parsed.working_set_bytes),
    started_at: String(parsed.started_at || ''),
  };
}

async function main() {
  assert(outputPath, '--output is required');
  assert(diagnostic || formal, 'formal production soak requires at least 1800 seconds; use --diagnostic for a shorter run');
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp && token, 'production relay address or bearer token unavailable');

  const received = [];
  const live = [];
  const details = [];
  const errors = [];
  const acknowledgements = [];
  const ws = new WebSocket(`ws://${relayIp}:${relayPort}/client-ws?token=${encodeURIComponent(token)}`);
  let heartbeatTimer = null;
  ws.on('message', data => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    const entry = { message, at: Date.now() };
    if (message.type === 'connection_ack' || String(message.type || '').startsWith('host_resource')) {
      received.push(entry);
    }
    if (message.type === 'host_resource_live') live.push(entry);
    else if (message.type === 'host_resource_detail') details.push(entry);
    else if (message.type === 'host_resource_error') errors.push(entry);
    else if (message.type === 'host_resource_subscription_ack' || message.type === 'host_resource_unsubscribed') {
      acknowledgements.push(entry);
    }
    if (message.type === 'connection_ack' && !heartbeatTimer) {
      const intervalMs = Math.max(1000, Number(message.heartbeat_interval_ms || 10_000) / 2);
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'heartbeat', protocol_version: 1,
            request_id: `host-soak-heartbeat-${Date.now()}`,
          }));
        }
      }, intervalMs);
      heartbeatTimer.unref?.();
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('production WebSocket open timed out')), 15_000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });

  let subscriptionId = '';
  try {
    await waitFor(() => received.some(entry => entry.message.type === 'connection_ack'), 15_000, 'connection_ack');
    const requestId = `host-resource-production-soak-${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'host_resource_subscribe', protocol_version: 1,
      request_id: requestId, aggregate_only: false,
    }));
    const ack = await waitFor(() => acknowledgements.find(entry => (
      entry.message.type === 'host_resource_subscription_ack' && entry.message.request_id === requestId
    )), 15_000, 'host resource subscription acknowledgement');
    subscriptionId = String(ack.message.subscription_id || '');
    assert(subscriptionId, 'production subscription ID unavailable');
    await waitFor(() => live.length >= 2, 20_000, 'two production live resource frames');
    await waitFor(() => details.some(entry => entry.message?.snapshot?.status === 'fresh'), 20_000, 'fresh production detail frame');

    const proxyLogOffset = fs.existsSync(proxyLogPath) ? fs.statSync(proxyLogPath).size : 0;
    const proxyErrorLogOffset = fs.existsSync(proxyErrorLogPath) ? fs.statSync(proxyErrorLogPath).size : 0;
    const baselineBudget = latestPollBudget(fs.existsSync(proxyLogPath) ? fs.readFileSync(proxyLogPath, 'utf8') : '');
    const workerPid = proxyWorkerPid();
    const processSamples = [processSample(workerPid)];
    const soakStartedAt = Date.now();
    const soakDeadline = soakStartedAt + durationSeconds * 1000;
    let nextProcessSampleAt = soakStartedAt + 30_000;
    let nextProgressAt = soakStartedAt + 300_000;
    while (Date.now() < soakDeadline) {
      assert(ws.readyState === WebSocket.OPEN, 'production WebSocket disconnected during soak');
      const now = Date.now();
      if (now >= nextProcessSampleAt) {
        assert.strictEqual(proxyWorkerPid(), workerPid, 'production proxy worker restarted during soak');
        processSamples.push(processSample(workerPid));
        nextProcessSampleAt += 30_000;
      }
      if (now >= nextProgressAt) {
        process.stdout.write(JSON.stringify({
          progress: true,
          elapsed_seconds: Math.round((now - soakStartedAt) / 1000),
          live_frames: live.length,
          detail_frames: details.length,
          errors: errors.length,
        }) + '\n');
        nextProgressAt += 300_000;
      }
      await sleep(Math.min(1000, Math.max(1, soakDeadline - now)));
    }
    assert.strictEqual(proxyWorkerPid(), workerPid, 'production proxy worker changed at soak completion');
    processSamples.push(processSample(workerPid));
    const soakEndedAt = Date.now();
    const logSuffix = readSuffix(proxyLogPath, proxyLogOffset);
    const errorLogSuffix = readSuffix(proxyErrorLogPath, proxyErrorLogOffset);
    const combinedLog = `${logSuffix}\n${errorLogSuffix}`;
    const finalBudget = latestPollBudget(`${fs.existsSync(proxyLogPath) ? fs.readFileSync(proxyLogPath, 'utf8') : ''}`);

    const liveDuringSoak = live.filter(entry => entry.at >= soakStartedAt && entry.at <= soakEndedAt);
    const detailsDuringSoak = details.filter(entry => entry.at >= soakStartedAt && entry.at <= soakEndedAt);
    const detailSnapshots = detailsDuringSoak.map(entry => entry.message?.snapshot || {});
    const liveReceiveIntervals = liveDuringSoak.slice(1).map((entry, index) => entry.at - liveDuringSoak[index].at);
    const liveSourceTimes = liveDuringSoak.map(entry => Number(entry.message?.point?.monotonic_ms));
    const liveSourceIntervals = liveSourceTimes.slice(1).map((value, index) => value - liveSourceTimes[index]);
    const collectionDurations = detailSnapshots.map(snapshot => Number(snapshot?.sampling?.collection_duration_ms));
    const processCounts = detailSnapshots.map(snapshot => Array.isArray(snapshot?.processes) ? snapshot.processes.length : 0);
    const unavailableDetails = detailSnapshots.filter(snapshot => snapshot.status !== 'fresh');
    const cpuIntervals = processSamples.slice(1).map((sample, index) => {
      const prior = processSamples[index];
      const wallSeconds = Math.max(0.001, (sample.at_ms - prior.at_ms) / 1000);
      return Math.max(0, (sample.cpu_seconds - prior.cpu_seconds) / wallSeconds / Math.max(1, os.cpus().length) * 100);
    });
    const workingSetMb = processSamples.map(sample => sample.working_set_bytes / (1024 * 1024));
    const collectorFailurePatterns = [
      /Hidden Windows collector failed/g,
      /Warm host resource collector exited/g,
      /Warm host resource collector emitted \d+ consecutive invalid JSON lines/g,
      /Warm host resource collector startup timed out/g,
      /Warm host resource collector detail timed out/g,
    ];
    const collectorFailures = collectorFailurePatterns.reduce((sum, pattern) => sum + countMatches(combinedLog, pattern), 0);
    const invalidLineDrops = countMatches(combinedLog, /Warm collector dropped invalid JSON line/g);
    const skippedTickWarnings = countMatches(combinedLog, /Previous tick still running; skipped/g);
    const slowPollWarnings = countMatches(combinedLog, /slow poll: (?:2\d{3}|[3-9]\d{3}|\d{5,})ms/g);
    const budgetPass = !!finalBudget && finalBudget.p95_ms <= 2000;
    const skippedStable = !!baselineBudget && !!finalBudget
      && finalBudget.skipped_total === baselineBudget.skipped_total
      && skippedTickWarnings === 0;
    const correlation = collectorFailures === 0 && unavailableDetails.length === 0
      && budgetPass && skippedStable
      ? 'no_observed_correlation_after_bounded-transcript_fix'
      : 'host_degradation_correlation_remains_possible';

    const result = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      ok: formal
        ? collectorFailures === 0 && invalidLineDrops === 0 && unavailableDetails.length === 0
          && errors.length === 0 && budgetPass && skippedStable
        : true,
      mode: formal ? 'formal_30_minute_production' : 'diagnostic',
      runtime_root: runtimeRoot,
      duration: {
        requested_seconds: durationSeconds,
        actual_ms: soakEndedAt - soakStartedAt,
        started_at: new Date(soakStartedAt).toISOString(),
        ended_at: new Date(soakEndedAt).toISOString(),
      },
      production_subscription: {
        authenticated: true,
        acknowledged: true,
        aggregate_only: false,
        subscription_id_present: true,
        live_frames: liveDuringSoak.length,
        detail_frames: detailsDuringSoak.length,
        resource_errors: errors.length,
        fresh_detail_frames: detailSnapshots.length - unavailableDetails.length,
        unavailable_detail_frames: unavailableDetails.length,
        process_rows: summary(processCounts),
        collection_duration_ms: summary(collectionDurations),
        live_receive_interval_ms: summary(liveReceiveIntervals),
        live_source_interval_ms: summary(liveSourceIntervals),
      },
      collector_stability: {
        worker_identity_stable: true,
        collector_failure_lines: collectorFailures,
        invalid_json_lines_dropped: invalidLineDrops,
        unavailable_snapshots: unavailableDetails.length,
        terminations: collectorFailures,
      },
      standing_poll_budget: {
        baseline: baselineBudget,
        final: finalBudget,
        p95_at_or_below_2000_ms: budgetPass,
        skipped_tick_warnings_during_soak: skippedTickWarnings,
        skipped_total_stable: skippedStable,
        over_2s_slow_poll_warnings_during_soak: slowPollWarnings,
      },
      proxy_process: {
        samples: processSamples.length,
        worker_identity_stable: processSamples.every(sample => sample.started_at === processSamples[0].started_at),
        normalized_cpu_percent: summary(cpuIntervals),
        working_set_mb: summary(workingSetMb),
      },
      host_degradation_correlation: correlation,
      privacy: {
        bearer_token_emitted: false,
        subscription_id_emitted: false,
        process_ids_emitted: false,
        command_lines_emitted: false,
        executable_paths_emitted: false,
      },
      automation: {
        visible_windows_opened: 0,
        focus_actions: 0,
        browsers_opened: 0,
        protected_pages_touched: 0,
      },
    };
    if (formal) {
      assert(result.duration.actual_ms >= 1_800_000, 'formal soak ended before 30 minutes');
      assert(liveDuringSoak.length >= 1500, `only ${liveDuringSoak.length} live frames arrived`);
      assert(detailsDuringSoak.length >= 300, `only ${detailsDuringSoak.length} detail frames arrived`);
      assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    const unsubscribeRequestId = `host-resource-production-soak-close-${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'host_resource_unsubscribe', protocol_version: 1,
      request_id: unsubscribeRequestId, subscription_id: subscriptionId,
    }));
    await waitFor(() => acknowledgements.find(entry => (
      entry.message.type === 'host_resource_unsubscribed'
      && entry.message.request_id === unsubscribeRequestId
    )), 5000, 'host resource unsubscribe acknowledgement');
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try { ws.close(); } catch {}
  }
}

main().catch(error => {
  console.error(`host resource production soak: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
