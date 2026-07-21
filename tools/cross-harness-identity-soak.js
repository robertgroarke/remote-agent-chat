#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  CanonicalConversationRegistry,
  canonicalConversationId,
} = require('../shared/conversation-identity');
const { acquirePidLock } = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const OPERATION_LOCK_PATH = path.resolve(process.env.RAC_OPERATION_LOCK_FILE
  || path.join(os.tmpdir(), 'remote-agent-chat-operation.lock'));
const CONVERSATION_COUNT = 60;
const TARGET_NATIVE_ID = process.env.RAC_IDENTITY_NATIVE_ID || '11111111-2222-4333-8444-555555555555';
const TARGET_DESKTOP_SESSION = process.env.RAC_IDENTITY_CANONICAL_SESSION_ID || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TARGET_CLI_ALIAS = process.env.RAC_IDENTITY_ALIAS_SESSION_ID || 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function parseArgs(argv) {
  const options = { durationMs: 30 * 60 * 1000, output: '', restartProbe: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--duration-ms' && argv[index + 1]) options.durationMs = Number(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--restart-probe' && argv[index + 1]) options.restartProbe = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (options.restartProbe) return options;
  const minimum = process.env.RAC_IDENTITY_SOAK_ALLOW_SHORT === '1' ? 5_000 : 30 * 60 * 1000;
  assert(Number.isInteger(options.durationMs) && options.durationMs >= minimum,
    `--duration-ms must be an integer >=${minimum}`);
  assert(options.output, '--output is required');
  return options;
}

function syntheticUuid(index) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function surfaceClaim({ sessionId, agentType, nativeId, generation, active, archiveOnly = false, owner = null }) {
  return {
    session_id: sessionId,
    agent_type: agentType,
    native_conversation_id: nativeId,
    native_active: active,
    connected: active,
    archive_only: archiveOnly,
    owner_generation: generation,
    native_sequence: generation,
    observed_at: new Date(1_700_000_000_000 + generation).toISOString(),
    owner_evidence: owner || { verified: false, state: 'none' },
  };
}

function phaseFor(elapsedMs, durationMs) {
  const fraction = elapsedMs / Math.max(1, durationMs);
  if (fraction < 0.25) return 'desktop';
  if (fraction < 0.5) return 'multi_surface';
  if (fraction < 0.75) return 'cli';
  return 'vscode';
}

function buildClaims(generation, phase) {
  const claims = [];
  for (let index = 0; index < CONVERSATION_COUNT; index += 1) {
    if (index === 0) {
      const desktopActive = ['desktop', 'multi_surface'].includes(phase);
      const cliActive = ['multi_surface', 'cli'].includes(phase);
      const vscodeActive = phase === 'vscode';
      claims.push(surfaceClaim({
        sessionId: TARGET_DESKTOP_SESSION, agentType: 'codex-desktop', nativeId: TARGET_NATIVE_ID,
        generation, active: desktopActive,
      }));
      claims.push(surfaceClaim({
        sessionId: TARGET_CLI_ALIAS, agentType: 'codex_cli', nativeId: TARGET_NATIVE_ID,
        generation: generation + (phase === 'cli' ? 1 : 0), active: cliActive, archiveOnly: !cliActive,
        owner: cliActive
          ? { verified: true, kind: 'interactive_tui', state: 'confirmed', generation: `owner-${generation}` }
          : { verified: false, state: 'none' },
      }));
      claims.push(surfaceClaim({
        sessionId: 'identity-vscode-target', agentType: 'codex', nativeId: TARGET_NATIVE_ID,
        generation: generation + (vscodeActive ? 2 : 0), active: vscodeActive,
      }));
      continue;
    }
    const familyIndex = index % 3;
    const family = familyIndex === 0 ? 'codex' : familyIndex === 1 ? 'claude' : 'cursor';
    const nativeId = family === 'codex' ? syntheticUuid(index) : `${family}-native-${String(index).padStart(4, '0')}`;
    const primaryType = family === 'codex' ? 'codex-desktop' : family === 'claude' ? 'claude' : 'cursor';
    const cliType = family === 'codex' ? 'codex_cli' : family === 'claude' ? 'claude_cli' : 'cursor_cli';
    claims.push(surfaceClaim({
      sessionId: `${family}-primary-${index}`, agentType: primaryType, nativeId, generation, active: true,
    }));
    claims.push(surfaceClaim({
      sessionId: `${family}-archive-${index}`, agentType: cliType, nativeId,
      generation: generation + 1, active: false, archiveOnly: true,
    }));
  }
  return claims.sort((left, right) => {
    const leftKey = (left.native_sequence * 2654435761 + left.session_id.length * 97) >>> 0;
    const rightKey = (right.native_sequence * 2654435761 + right.session_id.length * 97) >>> 0;
    return leftKey - rightKey || left.session_id.localeCompare(right.session_id);
  });
}

function validateSnapshot(snapshot, phase, counters, options = {}) {
  assert.strictEqual(snapshot.length, CONVERSATION_COUNT, 'canonical conversation count drifted');
  assert.strictEqual(new Set(snapshot.map(row => row.canonical_id)).size, CONVERSATION_COUNT,
    'canonical identity collision or duplicate row');
  assert(snapshot.every(row => row.worker_count === 1), 'a canonical conversation counted more than one worker');
  const target = snapshot.find(row => row.canonical_id === canonicalConversationId('codex', TARGET_NATIVE_ID));
  assert(target, 'target native conversation disappeared');
  if (options.requireStableSession !== false) {
    assert.strictEqual(target.canonical_session_id, TARGET_DESKTOP_SESSION, 'stable canonical session identity changed');
  }
  assert.strictEqual(target.aliases.length, 3, 'target surface alias inventory changed');
  assert.strictEqual(target.worker_count, 1);
  const expectedSurface = phase === 'cli' ? 'codex_cli' : phase === 'vscode' ? 'codex_vscode' : 'codex_desktop';
  assert.strictEqual(target.current_surface, expectedSurface, 'newest verified owner did not win');
  assert.strictEqual(target.multi_surface, phase === 'multi_surface');
  if (phase !== 'multi_surface') {
    assert.strictEqual(target.live_surfaces.length, 1, 'inactive aliases became live surfaces');
  }
  for (const row of snapshot) {
    const unownedCli = row.aliases.filter(alias => alias.surface.endsWith('_cli') && !alias.owner_evidence.verified);
    if (unownedCli.some(alias => !alias.suppressed)) counters.aliasResurrections += 1;
  }
}

function runRestartProbe(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const registry = new CanonicalConversationRegistry();
  const snapshot = registry.replace(payload.claims);
  const counters = { aliasResurrections: 0 };
  validateSnapshot(snapshot, payload.phase, counters, { requireStableSession: false });
  assert.strictEqual(snapshot.find(row => row.canonical_id === canonicalConversationId('codex', TARGET_NATIVE_ID))?.canonical_id,
    canonicalConversationId('codex', TARGET_NATIVE_ID), 'restart changed the canonical native identity');
  assert.strictEqual(counters.aliasResurrections, 0);
  process.stdout.write(`${JSON.stringify({ ok: true, canonical_rows: snapshot.length })}\n`);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.restartProbe) {
    runRestartProbe(options.restartProbe);
    return;
  }
  const startedAt = new Date();
  const registry = new CanonicalConversationRegistry();
  const releaseOperation = acquirePidLock(
    OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: startedAt.toISOString(),
      agent: 'cross-harness-identity-soak',
      kind: 'production-soak',
    })}\n`,
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cross-harness-identity-soak-'));
  const counters = {
    ticks: 0, ownerTransitions: 0, canonicalCollisions: 0, falseWorkers: 0,
    aliasResurrections: 0, duplicateNotifications: 0, historyLosses: 0, hiddenRestarts: 0,
  };
  let previousPhase = '';
  let restartDone = false;
  const stableHistory = new Map(Array.from({ length: CONVERSATION_COUNT }, (_, index) => [
    index, [`history-${index}-0`, `history-${index}-1`],
  ]));
  try {
    const deadline = Date.now() + options.durationMs;
    while (Date.now() < deadline) {
      const elapsedMs = Date.now() - startedAt.getTime();
      const phase = phaseFor(elapsedMs, options.durationMs);
      if (previousPhase && phase !== previousPhase) counters.ownerTransitions += 1;
      previousPhase = phase;
      const claims = buildClaims(counters.ticks * 10 + 1, phase);
      const snapshot = registry.replace(claims);
      try {
        validateSnapshot(snapshot, phase, counters);
      } catch (error) {
        if (/worker/.test(error.message)) counters.falseWorkers += 1;
        else counters.canonicalCollisions += 1;
        throw error;
      }
      const notificationIds = snapshot.map(row => `identity:${row.canonical_id}:${phase}`);
      counters.duplicateNotifications += notificationIds.length - new Set(notificationIds).size;
      for (const [index, messages] of stableHistory) {
        if (messages.length !== 2 || messages[0] !== `history-${index}-0`) counters.historyLosses += 1;
      }
      if (!restartDone && elapsedMs >= options.durationMs / 2) {
        const restartState = path.join(tempRoot, 'restart-state.json');
        atomicWriteJson(restartState, { phase, claims });
        const restarted = spawnSync(process.execPath, [__filename, '--restart-probe', restartState], {
          cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30_000,
        });
        assert.strictEqual(restarted.status, 0, restarted.stderr || restarted.stdout || 'restart probe failed');
        assert.strictEqual(JSON.parse(restarted.stdout).canonical_rows, CONVERSATION_COUNT);
        counters.hiddenRestarts += 1;
        restartDone = true;
      }
      counters.ticks += 1;
      const waitMs = Math.min(100, Math.max(0, deadline - Date.now()));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    const completedAt = new Date();
    assert.strictEqual(counters.aliasResurrections, 0);
    assert.strictEqual(counters.canonicalCollisions, 0);
    assert.strictEqual(counters.falseWorkers, 0);
    assert.strictEqual(counters.duplicateNotifications, 0);
    assert.strictEqual(counters.historyLosses, 0);
    assert.strictEqual(counters.hiddenRestarts, 1);
    assert(counters.ownerTransitions >= 3, 'all Desktop -> multi-surface -> CLI -> VS Code transitions were not observed');
    const result = {
      ok: true,
      acceptance_class: options.durationMs >= 30 * 60 * 1000
        ? 'canonical_30_minute_cross_harness_identity_soak' : 'diagnostic_short_identity_soak',
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      requested_duration_ms: options.durationMs,
      actual_duration_ms: completedAt - startedAt,
      conversations: CONVERSATION_COUNT,
      surfaces_per_target: 3,
      events_applied: counters.ticks * (CONVERSATION_COUNT * 2 + 1),
      ...counters,
      target: {
        native_id: TARGET_NATIVE_ID,
        canonical_rows: 1,
        cli_alias_rows: 0,
        worker_count: 1,
        terminal_surface: 'codex_vscode',
        stable_canonical_session_during_live_migrations: true,
        restart_canonical_conversation_id_preserved: true,
      },
      safety: {
        synthetic_identities_only: true,
        visible_windows: 0,
        focus_actions: 0,
        protected_session_mutations: 0,
        production_mutations: 0,
        proxy_restarts: 0,
        deploys: 0,
        formal_operation_lock: true,
        hidden_isolated_restart_probes: counters.hiddenRestarts,
      },
    };
    atomicWriteJson(options.output, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    releaseOperation();
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-cross-harness-identity-soak-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = { buildClaims, main, parseArgs, phaseFor, validateSnapshot };
