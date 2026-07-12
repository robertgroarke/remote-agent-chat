#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const readOnly = args.includes('--read-only');
if (args.some(arg => arg !== '--read-only' && arg !== '--send-live') || (readOnly && args.includes('--send-live'))) {
  console.error('Codex Desktop validate-all accepts --read-only or --send-live.');
  process.exit(2);
}
const stepTimeoutMs = Number(process.env.CODEX_DESKTOP_VALIDATE_STEP_TIMEOUT_MS || 60000);
const steps = [
  ['proxy syntax', ['--check', 'agent-proxy/proxy-engine.js']],
  ['selector syntax', ['--check', 'agent-proxy/selectors.js']],
  ['protocol syntax', ['--check', 'agent-proxy/protocol.js']],
  ['relay syntax', ['--check', 'relay-server/index.js']],
  ['target discovery regression', ['tools/codex-desktop-target-discovery-smoke.js']],
  ['native thread list regression', ['tools/codex-desktop-thread-list-smoke.js']],
  ['structured terminal and file-change regression', ['tools/codex-desktop-structured-controls-smoke.js']],
  ['relay/session discovery retry regression', ['tools/codex-desktop-readonly-retry-smoke.js']],
  ['read-only terminal and file-change relay E2E', ['tools/codex-desktop-readonly-controls-e2e.js']],
  ['active fidelity normalization regression', ['tools/codex-fidelity-normalization-smoke.js']],
  ['prompt reconnect regression', ['tools/proxy-prompt-reconnect-smoke.js']],
  ['frontend history regression', ['tools/frontend-history-reconnect-smoke.js']],
  ['frontend transcript fidelity', ['tools/frontend-transcript-fidelity-smoke.js']],
  ['Codex Desktop CDP regression', ['tools/cdp-regression-smoke.js', '--surfaces', 'codex-desktop', '--strict']],
  ['native/relay fidelity tail', [
    'tools/run-fidelity-regression.js', '--surfaces', 'codex-desktop',
    ...(!readOnly ? ['--allow-active'] : []), '--tail', '40', '--strict',
  ]],
];
if (!readOnly) {
  steps.splice(11, 0, ['notice, goal, queue, and action fixture', ['tools/codex-notice-smoke.js']]);
}

function runStep(label, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: stepTimeoutMs,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${label} timed out after ${stepTimeoutMs}ms`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status || 1}`);
  }
}

async function main() {
  runStep('CDP serialization regression', ['tools/codex-desktop-cdp-lock-smoke.js']);
  await withCodexDesktopCdpLock('codex-desktop-validate-all', async () => {
    for (const [label, args] of steps) {
      runStep(label, args);
    }
  }, { waitMs: 90000 });

  console.log('\nCodex Desktop validate-all: PASS');
  if (readOnly) console.log('READ-ONLY PASS (DOM action fixture and all mutating controls were intentionally not run)');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
