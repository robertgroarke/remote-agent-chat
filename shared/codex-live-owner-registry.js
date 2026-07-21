'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const SCHEMA_VERSION = 1;
const OWNER_KINDS = new Set(['rotator_exec', 'proxy_app_server', 'interactive_tui']);
const OWNER_STATES = new Set(['active', 'transferring', 'quiescent', 'terminal']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_HEARTBEAT_TTL_MS = 30_000;
const DEFAULT_REGISTRY_TTL_MS = 60_000;
const DEFAULT_LEASE_TTL_MS = 15_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;

function defaultRegistryPath(env = process.env) {
  if (env.RAC_CODEX_OWNER_REGISTRY) return path.resolve(env.RAC_CODEX_OWNER_REGISTRY);
  const root = path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  return path.join(root, 'state', 'codex-session-live-owners.json');
}

function rolloutFileIdentity(filePath) {
  const resolved = fs.realpathSync(filePath);
  const stats = fs.statSync(resolved, { bigint: true });
  return [
    process.platform === 'win32' ? resolved.toLowerCase() : resolved,
    `dev=${String(stats.dev)}`,
    `ino=${String(stats.ino)}`,
    `birth=${String(stats.birthtimeMs)}`,
  ].join('|');
}

function normalizeAuthority(value) {
  const state = optionalText(value?.state) || 'not_ready';
  if (!['not_ready', 'ready'].includes(state)) {
    throw new Error(`Unsupported Codex owner registry authority state: ${state}`);
  }
  const heartbeatAt = optionalText(value?.heartbeat_at);
  if (state === 'ready' && !Number.isFinite(Date.parse(heartbeatAt || ''))) {
    throw new Error('Ready Codex owner registry authority requires heartbeat_at');
  }
  const scannedLineages = Number(value?.scanned_lineages);
  return {
    state,
    producer_id: optionalText(value?.producer_id),
    producer_pid: optionalPid(value?.producer_pid),
    process_epoch: optionalText(value?.process_epoch),
    heartbeat_at: Number.isFinite(Date.parse(heartbeatAt || ''))
      ? new Date(Date.parse(heartbeatAt)).toISOString()
      : null,
    manifest_path: optionalText(value?.manifest_path),
    manifest_identity: optionalText(value?.manifest_identity),
    runtime_generation: optionalText(value?.runtime_generation),
    scanned_lineages: Number.isInteger(scannedLineages) && scannedLineages >= 0 ? scannedLineages : 0,
    proof: optionalText(value?.proof),
  };
}

function emptyRegistry(now = new Date().toISOString()) {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: now,
    authority: normalizeAuthority({ state: 'not_ready' }),
    lineages: {},
  };
}

function normalizeLease(value) {
  if (!value) return null;
  const leaseId = optionalText(value.lease_id);
  const holderId = optionalText(value.holder_id);
  const acquiredAt = optionalText(value.acquired_at);
  const expiresAt = optionalText(value.expires_at);
  if (!leaseId || !holderId) throw new Error('Codex owner lease identity is required');
  if (!Number.isFinite(Date.parse(acquiredAt || ''))) throw new Error('Codex owner lease acquired_at is required');
  if (!Number.isFinite(Date.parse(expiresAt || ''))) throw new Error('Codex owner lease expires_at is required');
  return {
    lease_id: leaseId,
    holder_id: holderId,
    holder_pid: optionalPid(value.holder_pid),
    acquired_at: new Date(Date.parse(acquiredAt)).toISOString(),
    expires_at: new Date(Date.parse(expiresAt)).toISOString(),
  };
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function optionalPid(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeOwner(value) {
  const sessionId = optionalText(value?.session_id);
  const ownerId = optionalText(value?.owner_id);
  const ownerKind = optionalText(value?.owner_kind);
  const state = optionalText(value?.state);
  if (!UUID_RE.test(sessionId || '')) throw new Error('Codex owner session_id must be a UUID');
  if (!ownerId || ownerId.length > 256) throw new Error('Codex owner owner_id is required');
  if (!OWNER_KINDS.has(ownerKind)) throw new Error(`Unsupported Codex owner kind: ${ownerKind || 'missing'}`);
  if (!OWNER_STATES.has(state)) throw new Error(`Unsupported Codex owner state: ${state || 'missing'}`);
  const heartbeatAt = optionalText(value?.heartbeat_at);
  const startedAt = optionalText(value?.started_at);
  if (!Number.isFinite(Date.parse(heartbeatAt || ''))) throw new Error('Codex owner heartbeat_at is required');
  if (!Number.isFinite(Date.parse(startedAt || ''))) throw new Error('Codex owner started_at is required');
  return {
    session_id: sessionId,
    owner_id: ownerId,
    owner_kind: ownerKind,
    state,
    root_pid: optionalPid(value?.root_pid),
    native_pid: optionalPid(value?.native_pid),
    connection_id: optionalText(value?.connection_id),
    rac_session_id: optionalText(value?.rac_session_id),
    thread_id: optionalText(value?.thread_id),
    turn_id: optionalText(value?.turn_id),
    process_epoch: optionalText(value?.process_epoch),
    rollout_path: optionalText(value?.rollout_path),
    rollout_identity: optionalText(value?.rollout_identity),
    logical_name: optionalText(value?.logical_name),
    started_at: new Date(Date.parse(startedAt)).toISOString(),
    heartbeat_at: new Date(Date.parse(heartbeatAt)).toISOString(),
    terminal_at: Number.isFinite(Date.parse(value?.terminal_at || ''))
      ? new Date(Date.parse(value.terminal_at)).toISOString()
      : null,
    proof: optionalText(value?.proof),
  };
}

function validateRegistry(value) {
  if (!value || value.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported Codex owner registry schema: ${value?.schema_version ?? 'missing'}`);
  }
  if (!value.lineages || typeof value.lineages !== 'object' || Array.isArray(value.lineages)) {
    throw new Error('Codex owner registry requires a lineages object');
  }
  if (!Number.isFinite(Date.parse(value.updated_at || ''))) {
    throw new Error('Codex owner registry updated_at is required');
  }
  const normalized = emptyRegistry(new Date(Date.parse(value.updated_at)).toISOString());
  normalized.authority = normalizeAuthority(value.authority);
  for (const [sessionId, lineage] of Object.entries(value.lineages)) {
    if (!UUID_RE.test(sessionId)) throw new Error(`Invalid Codex owner lineage: ${sessionId}`);
    const owners = Array.isArray(lineage?.owners) ? lineage.owners.map(normalizeOwner) : [];
    if (owners.some(owner => owner.session_id !== sessionId)) {
      throw new Error(`Codex owner lineage mismatch: ${sessionId}`);
    }
    const ids = owners.map(owner => owner.owner_id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate Codex owner_id in ${sessionId}`);
    normalized.lineages[sessionId] = { owners, lease: normalizeLease(lineage?.lease) };
  }
  return normalized;
}

function loadOwnerRegistry(registryPath = defaultRegistryPath()) {
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  return validateRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function pause(milliseconds) {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, Math.max(1, milliseconds));
}

function withRegistryLock(registryPath, callback, options = {}) {
  const lockPath = `${registryPath}.lock`;
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = Math.max(1, Number(options.staleMs) || DEFAULT_STALE_LOCK_MS);
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  let descriptor;
  while (descriptor == null) {
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) fs.unlinkSync(lockPath);
      } catch {}
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring Codex owner registry lock: ${lockPath}`);
      pause(25);
    }
  }
  try { return callback(); }
  finally {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function updateOwnerRegistry(registryPath, update, options = {}) {
  return withRegistryLock(registryPath, () => {
    let registry;
    try {
      registry = loadOwnerRegistry(registryPath);
    } catch (error) {
      if (!options.recoverInvalid) throw error;
      const quarantinePath = `${registryPath}.invalid-${Date.now()}`;
      fs.renameSync(registryPath, quarantinePath);
      const prefix = `${path.basename(registryPath)}.invalid-`;
      const quarantined = fs.readdirSync(path.dirname(registryPath))
        .filter(name => name.startsWith(prefix))
        .sort()
        .reverse();
      for (const stale of quarantined.slice(3)) {
        try { fs.unlinkSync(path.join(path.dirname(registryPath), stale)); } catch {}
      }
      registry = emptyRegistry();
    }
    const result = update(registry) || registry;
    result.updated_at = new Date().toISOString();
    const validated = validateRegistry(result);
    atomicWriteJson(registryPath, validated);
    return validated;
  }, options);
}

function publishLiveOwner(owner, options = {}) {
  const normalized = normalizeOwner(owner);
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  updateOwnerRegistry(registryPath, registry => {
    const lineage = registry.lineages[normalized.session_id] || { owners: [], lease: null };
    const existing = lineage.owners.find(item => item.owner_id === normalized.owner_id);
    if (lineage.lease
        && Date.parse(lineage.lease.expires_at) > (Number(options.nowMs) || Date.now())
        && lineage.lease.lease_id !== options.leaseId
        && !existing) {
      const error = new Error(`Codex lineage handoff is leased by ${lineage.lease.holder_id}`);
      error.code = 'CODEX_OWNER_LEASE_BUSY';
      throw error;
    }
    const owners = lineage.owners.filter(item => item.owner_id !== normalized.owner_id);
    owners.push(normalized);
    registry.lineages[normalized.session_id] = { owners, lease: lineage.lease || null };
    return registry;
  }, options);
  return normalized;
}

function clearLiveOwner(sessionId, ownerId, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  let cleared = false;
  updateOwnerRegistry(registryPath, registry => {
    const lineage = registry.lineages[sessionId];
    if (!lineage) return registry;
    lineage.owners = lineage.owners.filter(owner => {
      const matches = owner.owner_id === ownerId
        && (!options.processEpoch || owner.process_epoch === options.processEpoch);
      if (matches) cleared = true;
      return !matches;
    });
    if (!lineage.owners.length && !lineage.lease) delete registry.lineages[sessionId];
    return registry;
  }, options);
  return cleared;
}

function resolveLineageOwner(sessionId, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  if (!fs.existsSync(registryPath)) {
    return { state: 'unavailable', owners: [], error: 'owner_registry_missing', registry_path: registryPath };
  }
  let registry;
  try { registry = loadOwnerRegistry(registryPath); }
  catch (error) { return { state: 'invalid', owners: [], error: error.message, registry_path: registryPath }; }
  const owners = registry.lineages[sessionId]?.owners || [];
  const lease = registry.lineages[sessionId]?.lease || null;
  const nowMs = Number(options.nowMs) || Date.now();
  const ttlMs = Math.max(1, Number(options.heartbeatTtlMs) || DEFAULT_HEARTBEAT_TTL_MS);
  const registryTtlMs = Math.max(1, Number(options.registryTtlMs) || DEFAULT_REGISTRY_TTL_MS);
  const authority = registry.authority || normalizeAuthority(null);
  const authorityAgeMs = authority.heartbeat_at ? nowMs - Date.parse(authority.heartbeat_at) : Infinity;
  const active = owners.filter(owner => (
    (owner.state === 'active' || owner.state === 'transferring')
    && nowMs - Date.parse(owner.heartbeat_at) <= ttlMs
  ));
  const stale = owners.filter(owner => (
    (owner.state === 'active' || owner.state === 'transferring')
    && nowMs - Date.parse(owner.heartbeat_at) > ttlMs
  ));
  const details = {
    stale,
    lease,
    authority,
    registry_path: registryPath,
    registry_updated_at: registry.updated_at,
  };
  if (authority.state !== 'ready') {
    return { state: 'unavailable', owners: [], error: 'owner_registry_not_ready', ...details };
  }
  if (authorityAgeMs > registryTtlMs) {
    return { state: 'unavailable', owners: [], error: 'owner_registry_stale', registry_age_ms: authorityAgeMs, ...details };
  }
  if (active.length > 1) return { state: 'multiple', owners: active, ...details };
  if (active.length === 1) return { state: 'confirmed', owner: active[0], owners: active, ...details };
  if (stale.length) return { state: 'stale', owners: [], ...details };
  const quiescent = owners.filter(owner => owner.state === 'quiescent' || owner.state === 'terminal');
  return { state: quiescent.length ? 'quiescent' : 'none', owners: [], quiescent, ...details };
}

function markRegistryAuthorityReady(authority, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const now = new Date(Number(options.nowMs) || Date.now()).toISOString();
  let normalized;
  updateOwnerRegistry(registryPath, registry => {
    normalized = normalizeAuthority({ ...authority, state: 'ready', heartbeat_at: now });
    registry.authority = normalized;
    return registry;
  }, options);
  return normalized;
}

function acquireLineageLease(sessionId, options = {}) {
  if (!UUID_RE.test(String(sessionId || ''))) throw new Error('Codex owner lease session_id must be a UUID');
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const nowMs = Number(options.nowMs) || Date.now();
  const leaseTtlMs = Math.max(1, Number(options.leaseTtlMs) || DEFAULT_LEASE_TTL_MS);
  const lease = normalizeLease({
    lease_id: options.leaseId || randomUUID(),
    holder_id: options.holderId || `pid:${process.pid}`,
    holder_pid: options.holderPid || process.pid,
    acquired_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + leaseTtlMs).toISOString(),
  });
  updateOwnerRegistry(registryPath, registry => {
    const lineage = registry.lineages[sessionId] || { owners: [], lease: null };
    const current = lineage.lease;
    if (current && Date.parse(current.expires_at) > nowMs && current.lease_id !== lease.lease_id) {
      const error = new Error(`Codex lineage handoff is already leased by ${current.holder_id}`);
      error.code = 'CODEX_OWNER_LEASE_BUSY';
      throw error;
    }
    lineage.lease = lease;
    registry.lineages[sessionId] = lineage;
    return registry;
  }, options);
  return lease;
}

function releaseLineageLease(sessionId, leaseId, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  let released = false;
  updateOwnerRegistry(registryPath, registry => {
    const lineage = registry.lineages[sessionId];
    if (!lineage || lineage.lease?.lease_id !== leaseId) return registry;
    lineage.lease = null;
    released = true;
    if (!lineage.owners.length) delete registry.lineages[sessionId];
    return registry;
  }, options);
  return released;
}

function expireStaleOwners(options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const nowMs = Number(options.nowMs) || Date.now();
  const ttlMs = Math.max(1, Number(options.heartbeatTtlMs) || DEFAULT_HEARTBEAT_TTL_MS);
  const isAlive = options.processIsAlive || (() => null);
  const removed = [];
  updateOwnerRegistry(registryPath, registry => {
    for (const [sessionId, lineage] of Object.entries(registry.lineages)) {
      lineage.owners = lineage.owners.filter(owner => {
        const heartbeatExpired = nowMs - Date.parse(owner.heartbeat_at) > ttlMs;
        const pid = owner.native_pid || owner.root_pid;
        const pidDead = pid ? isAlive(pid) === false : false;
        const terminalExpired = owner.state === 'terminal' && heartbeatExpired;
        if (!pidDead && !terminalExpired) return true;
        removed.push({ session_id: sessionId, owner_id: owner.owner_id, reason: pidDead ? 'pid_dead' : 'terminal_expired' });
        return false;
      });
      if (!lineage.owners.length && !lineage.lease) delete registry.lineages[sessionId];
    }
    return registry;
  }, options);
  return removed;
}

module.exports = {
  DEFAULT_HEARTBEAT_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_REGISTRY_TTL_MS,
  OWNER_KINDS,
  OWNER_STATES,
  SCHEMA_VERSION,
  acquireLineageLease,
  atomicWriteJson,
  clearLiveOwner,
  defaultRegistryPath,
  emptyRegistry,
  expireStaleOwners,
  loadOwnerRegistry,
  markRegistryAuthorityReady,
  normalizeAuthority,
  normalizeOwner,
  publishLiveOwner,
  releaseLineageLease,
  resolveLineageOwner,
  rolloutFileIdentity,
  updateOwnerRegistry,
  validateRegistry,
  withRegistryLock,
};
