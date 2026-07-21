'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REGISTRY_TTL_MS,
  defaultRegistryPath,
  loadOwnerRegistry,
  normalizeOwner,
  resolveLineageOwner,
  rolloutFileIdentity,
} = require('../shared/codex-live-owner-registry');
const { DEFAULT_MANIFEST, loadManifest } = require('../tools/codex-session-manifest');

function ownershipError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertCanonicalRegistryReady(options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  if (!fs.existsSync(registryPath)) {
    throw ownershipError('codex_owner_registry_missing', 'Codex ownership is still starting; retry shortly.', { registryPath });
  }
  let registry;
  try { registry = loadOwnerRegistry(registryPath); }
  catch (error) {
    throw ownershipError('codex_owner_registry_invalid', `Codex ownership registry is invalid: ${error.message}`, { registryPath });
  }
  const authority = registry.authority;
  if (authority?.state !== 'ready') {
    throw ownershipError('codex_owner_registry_not_ready', 'Codex ownership reconciliation is not ready; retry shortly.', { registryPath });
  }
  const nowMs = Number(options.nowMs) || Date.now();
  const ttlMs = Math.max(1, Number(options.registryTtlMs) || DEFAULT_REGISTRY_TTL_MS);
  if (nowMs - Date.parse(authority.heartbeat_at || '') > ttlMs) {
    throw ownershipError('codex_owner_registry_stale', 'Codex ownership reconciliation is stale; retry shortly.', { registryPath });
  }
  return { registryPath, registry, authority };
}

function assertProxyLineageAvailable(threadId, options = {}) {
  const ready = assertCanonicalRegistryReady(options);
  if (!threadId) return { ...ready, state: 'new_thread' };
  const resolution = resolveLineageOwner(threadId, {
    registryPath: ready.registryPath,
    nowMs: options.nowMs,
    registryTtlMs: options.registryTtlMs,
    heartbeatTtlMs: options.heartbeatTtlMs,
  });
  if (resolution.lease
      && Date.parse(resolution.lease.expires_at) > (Number(options.nowMs) || Date.now())
      && resolution.lease.lease_id !== options.leaseId) {
    throw ownershipError(
      'codex_lineage_lease_active',
      `Codex thread ${threadId} is in an ownership handoff; retry shortly.`,
      { registryPath: ready.registryPath, resolution, reason: 'handoff_lease_active' },
    );
  }
  if (resolution.state === 'none' || resolution.state === 'quiescent') {
    return { ...ready, state: resolution.state, resolution };
  }
  const owner = resolution.owner;
  const reason = resolution.error || (owner ? `${owner.owner_kind}_active` : `owner_${resolution.state}`);
  throw ownershipError(
    'codex_lineage_owned',
    `Codex thread ${threadId} is not available for a second owner (${reason}).`,
    { registryPath: ready.registryPath, resolution, reason },
  );
}

function logicalNameForThread(threadId, manifestPath = DEFAULT_MANIFEST) {
  try {
    const manifest = loadManifest(manifestPath);
    return Object.entries(manifest.sessions).find(([, entry]) => entry.sessionId === threadId)?.[0] || null;
  } catch {
    return null;
  }
}

function buildProxyAppServerOwner({
  threadId,
  turnId,
  racSessionId,
  processEpoch,
  connectionId,
  rootPid = process.pid,
  nativePid,
  rolloutPath,
  logicalName = null,
  now = new Date(),
}) {
  if (!rolloutPath || !fs.existsSync(rolloutPath)) {
    throw ownershipError('codex_owner_rollout_unavailable', `Codex rollout is unavailable for ${threadId}.`);
  }
  const timestamp = now.toISOString();
  return normalizeOwner({
    session_id: threadId,
    owner_id: `proxy_app_server:${connectionId}:${processEpoch}`,
    owner_kind: 'proxy_app_server',
    state: 'active',
    root_pid: rootPid,
    native_pid: nativePid,
    connection_id: connectionId,
    rac_session_id: racSessionId,
    thread_id: threadId,
    turn_id: turnId,
    process_epoch: processEpoch,
    rollout_path: fs.realpathSync(path.resolve(rolloutPath)),
    rollout_identity: rolloutFileIdentity(rolloutPath),
    logical_name: logicalName,
    started_at: timestamp,
    heartbeat_at: timestamp,
    terminal_at: null,
    proof: 'app_server_connection_bound_to_thread_turn_epoch',
  });
}

module.exports = {
  assertCanonicalRegistryReady,
  assertProxyLineageAvailable,
  buildProxyAppServerOwner,
  logicalNameForThread,
  ownershipError,
};
