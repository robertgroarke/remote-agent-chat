#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : null;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function smallestTranscript(agentType, field) {
  const store = JSON.parse(fs.readFileSync(path.join(root, 'agent-proxy', 'session-store.json'), 'utf8'));
  return Object.values(store.sessions || {})
    .filter(session => session.agent_type === agentType && session[field])
    .map(session => {
      try { return { path: session[field], size: fs.statSync(session[field]).size }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.size - b.size)[0];
}

async function measureHarness({ agentType, sourceField, startWatcher }) {
  const source = smallestTranscript(agentType, sourceField);
  assert(source, `no readable ${agentType} transcript fixture found`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `rac-${agentType}-watch-`));
  const fixturePath = path.join(tempRoot, path.basename(source.path));
  fs.copyFileSync(source.path, fixturePath);
  let pending = null;
  let watcher;
  let rawEvents = 0;
  const watcherErrors = [];
  try {
    watcher = startWatcher(tempRoot, summary => {
      if (pending && summary) {
        const resolve = pending.resolve;
        pending = null;
        resolve(Date.now());
      }
    }, error => watcherErrors.push(error.message));
    assert(watcher, `${agentType} watcher unavailable`);
    watcher.on('all', () => { rawEvents++; });
    await Promise.race([
      new Promise(resolve => watcher.once('ready', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${agentType} watcher did not become ready`)), 5000)),
    ]);
    await wait(100);
    const samples = [];
    for (let index = 0; index < 5; index++) {
      const observed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.timer === timer) pending = null;
          reject(new Error(`${agentType} watcher timed out (raw_events=${rawEvents}, errors=${watcherErrors.join('|') || 'none'})`));
        }, 5000);
        pending = {
          timer,
          resolve: timestamp => {
            clearTimeout(timer);
            resolve(timestamp);
          },
        };
      });
      const appendedAt = Date.now();
      fs.appendFileSync(fixturePath, `\n${' '.repeat(index + 1)}\n`);
      const receivedAt = await observed;
      samples.push(receivedAt - appendedAt);
      // Windows directory notifications can collapse same-file writes that
      // land in the same coarse timestamp bucket. Keep samples independent.
      await wait(250);
    }
    return {
      agent_type: agentType,
      source_fixture_bytes: source.size,
      samples_ms: samples,
      p50_ms: percentile(samples, 0.5),
      p95_ms: percentile(samples, 0.95),
      max_ms: Math.max(...samples),
      watcher_debounce_ms: 10,
    };
  } finally {
    if (watcher) await watcher.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

(async () => {
  const results = [];
  results.push(await measureHarness({
    agentType: 'claude_cli',
    sourceField: 'claude_cli_file_path',
    startWatcher: (rootDir, onSummary, onError) => claudeCli.watchSessions(onSummary, { rootDir, debounceMs: 10, onError }),
  }));
  results.push(await measureHarness({
    agentType: 'codex_cli',
    sourceField: 'codex_cli_file_path',
    startWatcher: (rootDir, onSummary, onError) => codexCli.watchSessions({ onSummary, rootDir, debounceMs: 10, onError }),
  }));
  results.push(await measureHarness({
    agentType: 'cursor_cli',
    sourceField: 'cursor_cli_file_path',
    startWatcher: (rootDir, onSummary, onError) => cursorCli.watchSessions(onSummary, { rootDir, debounceMs: 10, onError }),
  }));

  const result = {
    ok: results.every(entry => entry.p95_ms <= 500),
    scope: 'isolated copies of real native CLI JSONL transcripts; append to parsed watcher callback',
    harnesses: results,
    downstream_existing_evidence: {
      relay_roundtrip_ms: 1,
      browser_render_ms: 9,
      source_files: [
        'live-activity-production-roundtrip-result.json',
        'live-activity-browser-result.json',
      ],
    },
    target_status_latency_ms: 1000,
    generated_at: new Date().toISOString(),
  };
  assert(result.ok, 'one or more CLI watcher p95 values exceeded 500 ms');
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
})().catch(error => {
  console.error(`CLI watcher latency smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
