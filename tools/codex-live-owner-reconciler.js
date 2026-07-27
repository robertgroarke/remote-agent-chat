#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  DEFAULT_MANIFEST,
  loadManifest,
} = require('./codex-session-manifest');
const {
  findInteractiveCodexSessionOwner,
  findOwnedHeadlessWorker,
  listCodexProcesses,
  processIsAlive,
} = require('./codex-session-processes');
const {
  DEFAULT_HEARTBEAT_TTL_MS,
  defaultRegistryPath,
  normalizeOwner,
  rolloutFileIdentity,
  sameDirectOwnerProcess,
  updateOwnerRegistry,
} = require('../shared/codex-live-owner-registry');

const RECONCILER_PROCESS_EPOCH = randomUUID();

function processEpochFor(owner, fallback = 'unknown-start') {
  return `${owner.rootPid}:${owner.createdAt || fallback}`;
}

function readLatestTurnId(filePath, maxBytes = 2 * 1024 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, Math.max(0, size - length));
    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const event = JSON.parse(lines[index]);
        const turnId = event?.turn_id || event?.turnId || event?.turn?.id;
        if (typeof turnId === 'string' && turnId.trim()) return turnId.trim();
      } catch {}
    }
  } catch {
    return null;
  } finally {
    if (handle != null) try { fs.closeSync(handle); } catch {}
  }
  return null;
}

function ownerFromRotator(entry, logicalName, worker, processes, nowIso) {
  const native = processes.find(item => worker.pids.includes(item.pid) && item.name === 'codex.exe') || null;
  const createdAt = processes.find(item => item.pid === worker.rootPid)?.createdAt || null;
  const epoch = processEpochFor({ ...worker, createdAt });
  return normalizeOwner({
    session_id: entry.sessionId,
    owner_id: `rotator_exec:${worker.rootPid}:${epoch}`,
    owner_kind: 'rotator_exec',
    state: 'active',
    root_pid: worker.rootPid,
    native_pid: native?.pid || entry.lastWorkerNativePid || null,
    connection_id: null,
    rac_session_id: null,
    thread_id: entry.sessionId,
    turn_id: readLatestTurnId(entry.lastWorkerStdoutPath),
    process_epoch: epoch,
    rollout_path: fs.realpathSync(entry.rolloutPath),
    rollout_identity: rolloutFileIdentity(entry.rolloutPath),
    logical_name: logicalName,
    started_at: createdAt || nowIso,
    heartbeat_at: nowIso,
    terminal_at: null,
    proof: worker.proof,
  });
}

function ownerFromInteractive(entry, logicalName, interactive, nowIso) {
  const epoch = processEpochFor(interactive);
  return normalizeOwner({
    session_id: entry.sessionId,
    owner_id: `interactive_tui:${interactive.rootPid}:${epoch}`,
    owner_kind: 'interactive_tui',
    state: 'active',
    root_pid: interactive.rootPid,
    native_pid: interactive.nativePid,
    connection_id: null,
    rac_session_id: null,
    thread_id: entry.sessionId,
    turn_id: null,
    process_epoch: epoch,
    rollout_path: fs.realpathSync(entry.rolloutPath),
    rollout_identity: rolloutFileIdentity(entry.rolloutPath),
    logical_name: logicalName,
    started_at: interactive.createdAt || nowIso,
    heartbeat_at: nowIso,
    terminal_at: null,
    proof: interactive.proof,
  });
}

function discoverLineageOwner(entry, logicalName, processes, nowIso) {
  const listProcesses = () => processes;
  const worker = findOwnedHeadlessWorker(entry, { listProcesses });
  if (worker) return ownerFromRotator(entry, logicalName, worker, processes, nowIso);
  const interactive = findInteractiveCodexSessionOwner(entry.sessionId, { listProcesses });
  if (interactive) return ownerFromInteractive(entry, logicalName, interactive, nowIso);
  return null;
}

function ownerIsLive(owner, nowMs, isAlive) {
  return (
    (owner.state === 'active' || owner.state === 'transferring')
    && nowMs - Date.parse(owner.heartbeat_at) <= DEFAULT_HEARTBEAT_TTL_MS
    && (!owner.root_pid || isAlive(owner.root_pid))
    && (!owner.native_pid || isAlive(owner.native_pid))
  );
}

function directOwnerScore(owner) {
  let score = 0;
  if (owner.proof === 'launcher_exact_resume_uuid') score += 1_000;
  if (owner.runtime_generation) score += 100;
  if (owner.model) score += 10;
  if (owner.effort) score += 10;
  if (owner.process_epoch) score += 5;
  return score;
}

function preferDirectOwner(left, right) {
  const scoreDelta = directOwnerScore(left) - directOwnerScore(right);
  if (scoreDelta !== 0) return scoreDelta > 0 ? left : right;
  const heartbeatDelta = Date.parse(left.heartbeat_at) - Date.parse(right.heartbeat_at);
  if (heartbeatDelta !== 0) return heartbeatDelta > 0 ? left : right;
  return left.owner_id.localeCompare(right.owner_id) <= 0 ? left : right;
}

function mergeObservedDirectOwner(authoritative, observed, nowIso) {
  return normalizeOwner({
    ...observed,
    ...authoritative,
    native_pid: authoritative.native_pid || observed.native_pid,
    thread_id: authoritative.thread_id || observed.thread_id,
    rollout_path: authoritative.rollout_path || observed.rollout_path,
    rollout_identity: authoritative.rollout_identity || observed.rollout_identity,
    logical_name: authoritative.logical_name || observed.logical_name,
    proof: authoritative.proof || observed.proof,
    runtime_generation: authoritative.runtime_generation || observed.runtime_generation,
    model: authoritative.model || observed.model,
    effort: authoritative.effort || observed.effort,
    heartbeat_at: nowIso,
  });
}

function collapseDirectOwners(owners) {
  const canonical = [];
  for (const owner of [...owners].sort((left, right) => left.owner_id.localeCompare(right.owner_id))) {
    const matchingIndex = canonical.findIndex(item => sameDirectOwnerProcess(item, owner));
    if (matchingIndex === -1) canonical.push(owner);
    else canonical[matchingIndex] = preferDirectOwner(canonical[matchingIndex], owner);
  }
  return canonical;
}

function reconcileLineageOwners(lineage, observedOwner, nowMs, nowIso, isAlive) {
  const liveOwners = lineage.owners.filter(owner => ownerIsLive(owner, nowMs, isAlive));
  const proxyOwners = liveOwners.filter(owner => owner.owner_kind === 'proxy_app_server');
  let directOwners = collapseDirectOwners(liveOwners.filter(owner => owner.owner_kind !== 'proxy_app_server'));
  if (observedOwner) {
    const matchingIndex = directOwners.findIndex(owner => sameDirectOwnerProcess(owner, observedOwner));
    if (matchingIndex === -1) directOwners.push(observedOwner);
    else {
      const authoritative = preferDirectOwner(directOwners[matchingIndex], observedOwner);
      directOwners[matchingIndex] = mergeObservedDirectOwner(authoritative, observedOwner, nowIso);
    }
    directOwners = collapseDirectOwners(directOwners);
  }
  return [...proxyOwners, ...directOwners];
}

function reconcileCodexLiveOwners(options = {}) {
  const manifestPath = path.resolve(options.manifestPath || DEFAULT_MANIFEST);
  const registryPath = path.resolve(options.registryPath || defaultRegistryPath(options.env));
  const manifest = options.manifest || loadManifest(manifestPath);
  const nowMs = Number(options.nowMs) || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const discovered = new Map();
  try {
    const processes = options.processes || (options.listProcesses || listCodexProcesses)();
    for (const [logicalName, entry] of Object.entries(manifest.sessions)) {
      if (!entry.rolloutPath || !fs.existsSync(entry.rolloutPath)) {
        throw new Error(`Cannot reconcile ${logicalName}: rollout path is unavailable`);
      }
      discovered.set(entry.sessionId, {
        logicalName,
        owner: discoverLineageOwner(entry, logicalName, processes, nowIso),
      });
    }
  } catch (error) {
    try {
      updateOwnerRegistry(registryPath, registry => {
        registry.authority = {
          state: 'not_ready',
          producer_id: options.producerId || `codex-owner-reconciler:${process.pid}`,
          producer_pid: options.producerPid || process.pid,
          process_epoch: options.processEpoch || RECONCILER_PROCESS_EPOCH,
          heartbeat_at: nowIso,
          manifest_path: fs.existsSync(manifestPath) ? fs.realpathSync(manifestPath) : manifestPath,
          manifest_identity: fs.existsSync(manifestPath) ? rolloutFileIdentity(manifestPath) : null,
          runtime_generation: options.runtimeGeneration || process.env.RAC_CODEX_RUNTIME_GENERATION || 'worktree',
          scanned_lineages: discovered.size,
          proof: `reconciliation_failed:${error.code || error.name || 'error'}`,
        };
        return registry;
      }, { nowMs });
    } catch {}
    throw error;
  }

  const skippedLeases = [];
  updateOwnerRegistry(registryPath, registry => {
    const isAlive = options.processIsAlive || processIsAlive;
    const manifestSessionIds = new Set(discovered.keys());
    for (const [sessionId, lineage] of Object.entries(registry.lineages)) {
      if (manifestSessionIds.has(sessionId)) continue;
      const liveLease = lineage.lease && Date.parse(lineage.lease.expires_at) > nowMs
        ? lineage.lease
        : null;
      const liveOwners = lineage.owners.filter(owner => ownerIsLive(owner, nowMs, isAlive));
      if (!liveLease && !liveOwners.length) delete registry.lineages[sessionId];
      else registry.lineages[sessionId] = { owners: liveOwners, lease: liveLease };
    }
    for (const [sessionId, result] of discovered) {
      const lineage = registry.lineages[sessionId] || { owners: [], lease: null };
      if (lineage.lease && Date.parse(lineage.lease.expires_at) > nowMs) {
        skippedLeases.push(sessionId);
        continue;
      }
      const owners = reconcileLineageOwners(lineage, result.owner, nowMs, nowIso, isAlive);
      registry.lineages[sessionId] = { owners, lease: null };
    }
    registry.authority = {
      state: 'ready',
      producer_id: options.producerId || `codex-owner-reconciler:${process.pid}`,
      producer_pid: options.producerPid || process.pid,
      process_epoch: options.processEpoch || RECONCILER_PROCESS_EPOCH,
      heartbeat_at: nowIso,
      manifest_path: fs.realpathSync(manifestPath),
      manifest_identity: rolloutFileIdentity(manifestPath),
      runtime_generation: options.runtimeGeneration || process.env.RAC_CODEX_RUNTIME_GENERATION || 'worktree',
      scanned_lineages: discovered.size,
      proof: 'manifest_rollout_plus_exact_process_inventory',
    };
    return registry;
  }, { nowMs, processIsAlive: options.processIsAlive, recoverInvalid: true });

  return {
    status: skippedLeases.length ? 'ready_with_leased_lineages' : 'ready',
    registry_path: registryPath,
    manifest_path: manifestPath,
    scanned_lineages: discovered.size,
    owners: [...discovered.values()].filter(item => item.owner).map(item => ({
      logical_name: item.logicalName,
      owner_kind: item.owner.owner_kind,
      root_pid: item.owner.root_pid,
      native_pid: item.owner.native_pid,
      session_id: item.owner.session_id,
    })),
    skipped_leases: skippedLeases,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--manifest' && argv[index + 1]) options.manifestPath = argv[++index];
    else if (value === '--registry' && argv[index + 1]) options.registryPath = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${value}`);
  }
  return options;
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(reconcileCodexLiveOwners(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  RECONCILER_PROCESS_EPOCH,
  discoverLineageOwner,
  ownerFromInteractive,
  ownerFromRotator,
  parseArgs,
  readLatestTurnId,
  reconcileLineageOwners,
  reconcileCodexLiveOwners,
};
