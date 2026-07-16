#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const options = {
    sendLive: false,
    readOnly: false,
    runId: `validate-${Date.now()}`,
    timeoutMs: 180000,
    relayWsUrl: null,
    promptProfile: 'fidelity',
    production: false,
    allowShortSoak: false,
    soakMinutes: 10,
    progressFile: null,
    resultFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--run-id' && argv[i + 1]) options.runId = argv[++i];
    else if (arg === '--timeout-ms' && argv[i + 1]) {
      options.timeoutMs = Math.max(10000, parseInt(argv[++i], 10) || options.timeoutMs);
    } else if (arg === '--relay-ws-url' && argv[i + 1]) {
      options.relayWsUrl = argv[++i];
    } else if (arg === '--prompt-profile' && argv[i + 1]) {
      options.promptProfile = argv[++i];
    } else if (arg === '--production') {
      options.production = true;
    } else if (arg === '--allow-short-soak') {
      options.allowShortSoak = true;
    } else if (arg === '--soak-minutes' && argv[i + 1]) {
      options.soakMinutes = Number(argv[++i]);
    } else if (arg === '--progress-file' && argv[i + 1]) {
      options.progressFile = argv[++i];
    } else if (arg === '--result-file' && argv[i + 1]) {
      options.resultFile = argv[++i];
    }
  }
  return options;
}

function runCheck(check) {
  process.stdout.write(`\n=== ${check.label} ===\n`);
  const result = spawnSync(check.command, check.args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: check.timeoutMs || 120000,
  });
  if (result.error) {
    console.error(`FAIL ${check.label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`FAIL ${check.label}: exit ${result.status}`);
    return false;
  }
  console.log(`PASS ${check.label}`);
  return true;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.sendLive && !options.readOnly) {
    console.error('Refusing ambiguous validation mode. Use --read-only or explicitly acknowledge an owned throwaway mutation with --send-live.');
    process.exitCode = 2;
    return;
  }
  if (options.sendLive && options.readOnly) {
    console.error('Choose exactly one validation mode: --read-only or --send-live.');
    process.exitCode = 2;
    return;
  }
  if (options.production && !options.sendLive) {
    console.error('--production requires --send-live because it creates owned throwaway conversations.');
    process.exitCode = 2;
    return;
  }

  const node = process.execPath;
  const checks = [
    { label: 'selectors syntax', command: node, args: ['--check', 'agent-proxy/selectors.js'] },
    { label: 'proxy engine syntax', command: node, args: ['--check', 'agent-proxy/proxy-engine.js'] },
    { label: 'relay syntax', command: node, args: ['--check', 'relay-server/index.js'] },
    { label: 'Antigravity v2 E2E syntax', command: node, args: ['--check', 'tools/antigravity-v2-live-e2e.js'] },
    { label: 'Antigravity v2 production E2E syntax', command: node, args: ['--check', 'tools/antigravity-v2-production-e2e.js'] },
    { label: 'Antigravity v2 accumulator syntax', command: node, args: ['--check', 'tools/antigravity-v2-accumulator-smoke.js'] },
    { label: 'Antigravity v2 structured status syntax', command: node, args: ['--check', 'tools/antigravity-v2-structured-status-smoke.js'] },
    { label: 'Antigravity v2 accumulator finalization', command: node, args: ['tools/antigravity-v2-accumulator-smoke.js'] },
    { label: 'Antigravity v2 structured status', command: node, args: ['tools/antigravity-v2-structured-status-smoke.js'] },
    { label: 'frontend reconnect fidelity', command: node, args: ['tools/frontend-history-reconnect-smoke.js'] },
    { label: 'frontend transcript fidelity', command: node, args: ['tools/frontend-transcript-fidelity-smoke.js'] },
    {
      label: 'Antigravity v2 CDP regression',
      command: node,
      args: ['tools/cdp-regression-smoke.js', '--surfaces', 'antigravity-v2', '--strict'],
    },
  ];

  if (options.sendLive && options.production) {
    const productionArgs = [
      'tools/antigravity-v2-production-e2e.js',
      '--send-live',
      '--run-id', options.runId,
      '--timeout-ms', String(options.timeoutMs),
      '--soak-minutes', String(options.soakMinutes),
    ];
    if (options.allowShortSoak) productionArgs.push('--allow-short-soak');
    if (options.relayWsUrl) productionArgs.push('--relay-ws-url', options.relayWsUrl);
    if (options.progressFile) productionArgs.push('--progress-file', options.progressFile);
    if (options.resultFile) productionArgs.push('--result-file', options.resultFile);
    checks.push({
      label: 'owned Antigravity v2 production WebUI E2E',
      command: node,
      args: productionArgs,
      timeoutMs: options.timeoutMs * 4 + options.soakMinutes * 60 * 1000 + 120000,
    });
  } else if (options.sendLive) {
    const liveArgs = [
      'tools/antigravity-v2-live-e2e.js',
      '--send-live',
      '--run-id', options.runId,
      '--timeout-ms', String(options.timeoutMs),
      '--prompt-profile', options.promptProfile,
    ];
    if (options.relayWsUrl) liveArgs.push('--relay-ws-url', options.relayWsUrl);
    checks.push({
      label: 'owned Antigravity v2 WebUI E2E',
      command: node,
      args: liveArgs,
      timeoutMs: options.timeoutMs + 30000,
    });
  }

  let failures = 0;
  for (const check of checks) {
    if (!runCheck(check)) failures += 1;
  }
  if (options.readOnly) {
    console.log('\nREAD-ONLY PASS (live send/new-chat/list/switch E2E intentionally not run)');
  } else if (!failures) {
    console.log('\nANTIGRAVITY V2 VALIDATION: ALL PASS');
  }
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) main();

module.exports = { main, parseArgs };
