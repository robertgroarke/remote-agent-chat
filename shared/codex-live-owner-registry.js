'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const SCHEMA_VERSION = 1;
const OWNER_KINDS = new Set(['rotator_exec', 'proxy_app_server', 'interactive_tui']);
const DIRECT_OWNER_KINDS = new Set(['rotator_exec', 'interactive_tui']);
const OWNER_STATES = new Set(['active', 'transferring', 'quiescent', 'terminal']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_HEARTBEAT_TTL_MS = 30_000;
const DEFAULT_REGISTRY_TTL_MS = 60_000;
const DEFAULT_LEASE_TTL_MS = 15_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_WRITE_RETRIES = 8;
const DEFAULT_WRITE_RETRY_BASE_MS = 20;
const DEFAULT_STALE_TEMP_MS = 60_000;
const DEFAULT_TEMP_CLEANUP_INTERVAL_MS = 60_000;
const TRANSIENT_REPLACE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const lastTempCleanupAt = new Map();

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
    generation: 0,
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

function sameDirectOwnerProcess(left, right) {
  if (!left || !right) return false;
  if (!DIRECT_OWNER_KINDS.has(left.owner_kind) || left.owner_kind !== right.owner_kind) return false;
  if (!left.root_pid || left.root_pid !== right.root_pid) return false;
  if (left.session_id !== right.session_id) return false;
  for (const field of ['thread_id', 'rollout_identity', 'native_pid']) {
    if (left[field] && right[field] && left[field] !== right[field]) return false;
  }
  return true;
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
    ownership_health: ['healthy', 'degraded', 'recovered'].includes(value?.ownership_health)
      ? value.ownership_health
      : 'healthy',
    ownership_retry_count: Math.max(0, Number.isInteger(Number(value?.ownership_retry_count))
      ? Number(value.ownership_retry_count)
      : 0),
    ownership_degraded_since: Number.isFinite(Date.parse(value?.ownership_degraded_since || ''))
      ? new Date(Date.parse(value.ownership_degraded_since)).toISOString()
      : null,
    ownership_recovered_at: Number.isFinite(Date.parse(value?.ownership_recovered_at || ''))
      ? new Date(Date.parse(value.ownership_recovered_at)).toISOString()
      : null,
    ownership_error_code: optionalText(value?.ownership_error_code),
    runtime_generation: optionalText(value?.runtime_generation),
    model: optionalText(value?.model),
    effort: optionalText(value?.effort),
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
  const generation = Number(value.generation);
  normalized.generation = Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function ownerTempIdentity(registryPath, name) {
  const escaped = path.basename(registryPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(name || '').match(new RegExp(`^${escaped}\\.(\\d+)\\.(\\d+)(?:\\.[^.]+)*\\.tmp$`));
  if (!match) return null;
  return { pid: Number(match[1]), created_at_ms: Number(match[2]) };
}

function cleanupOwnerRegistryTempFiles(registryPath, options = {}) {
  const fsOps = options.fsOps || fs;
  const directory = path.dirname(registryPath);
  if (!fsOps.existsSync(directory)) return { examined: 0, removed: 0, retained_live: 0, retained_young: 0 };
  const nowMs = Number(options.nowMs) || Date.now();
  const staleTempMs = Math.max(0, Number(options.staleTempMs) || DEFAULT_STALE_TEMP_MS);
  const alive = options.processIsAlive || processIsAlive;
  const result = { examined: 0, removed: 0, retained_live: 0, retained_young: 0 };
  for (const name of fsOps.readdirSync(directory)) {
    const identity = ownerTempIdentity(registryPath, name);
    if (!identity) continue;
    result.examined += 1;
    if (alive(identity.pid) !== false) {
      result.retained_live += 1;
      continue;
    }
    if (nowMs - identity.created_at_ms < staleTempMs) {
      result.retained_young += 1;
      continue;
    }
    try {
      fsOps.unlinkSync(path.join(directory, name));
      result.removed += 1;
    } catch {}
  }
  return result;
}

function maybeCleanupOwnerRegistryTempFiles(registryPath, options = {}) {
  const nowMs = Number(options.nowMs) || Date.now();
  const intervalMs = Math.max(1, Number(options.tempCleanupIntervalMs) || DEFAULT_TEMP_CLEANUP_INTERVAL_MS);
  const previous = lastTempCleanupAt.get(registryPath) || 0;
  if (options.forceTempCleanup !== true && nowMs - previous < intervalMs) {
    return { examined: 0, removed: 0, retained_live: 0, retained_young: 0, throttled: true };
  }
  const result = cleanupOwnerRegistryTempFiles(registryPath, { ...options, nowMs });
  lastTempCleanupAt.set(registryPath, nowMs);
  return { ...result, throttled: false };
}

function retryTransientPhase(phase, operation, options, telemetry, generation) {
  const retries = Math.max(1, Number(options.writeRetries) || DEFAULT_WRITE_RETRIES);
  const baseDelayMs = Math.max(1, Number(options.writeRetryBaseMs) || DEFAULT_WRITE_RETRY_BASE_MS);
  const wait = options.pause || pause;
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return { value: operation(attempt), retry_count: attempt - 1 };
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_REPLACE_ERRORS.has(error?.code)) throw error;
      if (attempt >= retries) break;
      telemetry({
        event: 'registry_write_retry', phase, retry_count: attempt,
        error_code: error.code, generation,
      });
      const jitter = (process.pid + attempt * 17) % 11;
      wait(baseDelayMs * attempt + jitter);
    }
  }
  const exhausted = new Error(`Codex owner registry ${phase} failed after ${retries} attempts`);
  exhausted.code = 'CODEX_OWNER_WRITE_RETRY_EXHAUSTED';
  exhausted.phase = phase;
  exhausted.cause = lastError;
  exhausted.retry_count = retries;
  telemetry({
    event: 'registry_write_exhausted', phase, retry_count: retries,
    error_code: lastError?.code || 'unknown', generation,
  });
  throw exhausted;
}

function atomicReplaceBytes(filePath, content, options = {}, validateBytes = null) {
  const fsOps = options.fsOps || fs;
  const payload = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const nowMs = Number(options.nowMs) || Date.now();
  const telemetry = typeof options.onTelemetry === 'function' ? options.onTelemetry : () => {};
  const generation = Math.max(0, Number(options.generation) || 0);
  const uuid = options.randomUUID || randomUUID;
  let tempPath = null;
  let committed = false;
  let retryCount = 0;
  try {
    const prepared = retryTransientPhase('candidate_prepare', attempt => {
      tempPath = `${filePath}.${process.pid}.${nowMs}.${attempt}.${uuid()}.tmp`;
      let descriptor = null;
      try {
        fsOps.mkdirSync(path.dirname(filePath), { recursive: true });
        descriptor = fsOps.openSync(tempPath, 'wx');
        fsOps.writeFileSync(descriptor, payload);
        if (options.skipFsync !== true && typeof fsOps.fsyncSync === 'function') fsOps.fsyncSync(descriptor);
        fsOps.closeSync(descriptor);
        descriptor = null;
        const candidate = fsOps.readFileSync(tempPath);
        if (!Buffer.from(candidate).equals(payload)) throw new Error('Codex owner registry candidate verification failed');
        if (validateBytes) validateBytes(Buffer.from(candidate));
        return tempPath;
      } catch (error) {
        if (descriptor != null) try { fsOps.closeSync(descriptor); } catch {}
        if (tempPath && fsOps.existsSync(tempPath)) {
          try { fsOps.unlinkSync(tempPath); } catch {}
        }
        throw error;
      }
    }, options, telemetry, generation);
    retryCount += prepared.retry_count;

    const replaced = retryTransientPhase('replace', () => {
      fsOps.renameSync(tempPath, filePath);
      committed = true;
      return true;
    }, options, telemetry, generation);
    retryCount += replaced.retry_count;

    const verified = retryTransientPhase('committed_readback', () => {
      const observed = fsOps.readFileSync(filePath);
      if (!Buffer.from(observed).equals(payload)) throw new Error('Codex owner registry replacement verification failed');
      if (validateBytes) validateBytes(Buffer.from(observed));
      return true;
    }, options, telemetry, generation);
    retryCount += verified.retry_count;
    telemetry({ event: 'registry_write_succeeded', retry_count: retryCount, generation });
    return { retry_count: retryCount, generation };
  } finally {
    if (!committed && tempPath && fsOps.existsSync(tempPath)) {
      try {
        retryTransientPhase('candidate_cleanup', () => {
          fsOps.unlinkSync(tempPath);
          return true;
        }, options, telemetry, generation);
      } catch (error) {
        telemetry({
          event: 'registry_cleanup_deferred', phase: 'candidate_cleanup',
          error_code: error?.cause?.code || error?.code || 'unknown', generation,
        });
      }
    }
  }
}

function atomicReplaceText(filePath, serialized, options = {}, validateText = null) {
  return atomicReplaceBytes(filePath, Buffer.from(serialized, 'utf8'), options, candidate => {
    if (validateText) validateText(candidate.toString('utf8'));
  });
}

function atomicWriteJson(filePath, value, options = {}) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return atomicReplaceText(filePath, serialized, {
    ...options,
    generation: value?.generation || 0,
  }, candidate => validateRegistry(JSON.parse(candidate)));
}

function ownerDegradationDirectory(registryPath) {
  return `${registryPath}.degraded`;
}

function ownerDegradationPath(registryPath, owner) {
  const normalized = normalizeOwner(owner);
  const identity = String(normalized.process_epoch || normalized.owner_id)
    .replace(/[^a-z0-9._-]+/gi, '_').slice(0, 160);
  return path.join(ownerDegradationDirectory(registryPath), `${normalized.session_id}.${identity}.json`);
}

function normalizeOwnerDegradation(value) {
  const sessionId = optionalText(value?.session_id);
  const ownerId = optionalText(value?.owner_id);
  const degradedAt = optionalText(value?.degraded_at);
  if (!UUID_RE.test(sessionId || '')) throw new Error('Owner degradation session_id must be a UUID');
  if (!ownerId) throw new Error('Owner degradation owner_id is required');
  if (!Number.isFinite(Date.parse(degradedAt || ''))) throw new Error('Owner degradation degraded_at is required');
  return {
    schema_version: 1,
    session_id: sessionId,
    owner_id: ownerId,
    process_epoch: optionalText(value?.process_epoch),
    root_pid: optionalPid(value?.root_pid),
    native_pid: optionalPid(value?.native_pid),
    degraded_at: new Date(Date.parse(degradedAt)).toISOString(),
    error_code: optionalText(value?.error_code) || 'owner_write_failed',
    retry_count: Math.max(1, Number(value?.retry_count) || 1),
    health_status: ['owner_registry_degraded', 'legacy_runtime'].includes(value?.health_status)
      ? value.health_status
      : 'owner_registry_degraded',
    recovery_action: ['retry_automatic', 'operator_reopen_required'].includes(value?.recovery_action)
      ? value.recovery_action
      : 'retry_automatic',
    runtime_generation: optionalText(value?.runtime_generation),
    last_good_heartbeat_at: Number.isFinite(Date.parse(value?.last_good_heartbeat_at || ''))
      ? new Date(Date.parse(value.last_good_heartbeat_at)).toISOString()
      : null,
  };
}

function publishOwnerDegradation(owner, error, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const record = normalizeOwnerDegradation({
    session_id: owner.session_id,
    owner_id: owner.owner_id,
    process_epoch: owner.process_epoch,
    root_pid: owner.root_pid,
    native_pid: owner.native_pid,
    degraded_at: owner.ownership_degraded_since || new Date(Number(options.nowMs) || Date.now()).toISOString(),
    error_code: error?.cause?.code || error?.code || owner.ownership_error_code || 'owner_write_failed',
    retry_count: owner.ownership_retry_count || 1,
    health_status: options.healthStatus,
    recovery_action: options.recoveryAction,
    runtime_generation: owner.runtime_generation || options.runtimeGeneration,
    last_good_heartbeat_at: owner.heartbeat_at,
  });
  const degradationPath = ownerDegradationPath(registryPath, owner);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  atomicReplaceText(degradationPath, serialized, options, candidate => {
    normalizeOwnerDegradation(JSON.parse(candidate));
  });
  return { ...record, path: degradationPath };
}

function clearOwnerDegradation(owner, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const degradationPath = ownerDegradationPath(registryPath, owner);
  const fsOps = options.fsOps || fs;
  if (!fsOps.existsSync(degradationPath)) return false;
  const telemetry = typeof options.onTelemetry === 'function' ? options.onTelemetry : () => {};
  retryTransientPhase('degradation_cleanup', () => {
    fsOps.unlinkSync(degradationPath);
    return true;
  }, options, telemetry, 0);
  return true;
}

function loadOwnerDegradations(sessionId, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const directory = ownerDegradationDirectory(registryPath);
  const fsOps = options.fsOps || fs;
  if (!fsOps.existsSync(directory)) return [];
  const alive = options.processIsAlive || processIsAlive;
  const prefix = `${sessionId}.`;
  const records = [];
  for (const name of fsOps.readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const filePath = path.join(directory, name);
    try {
      const record = normalizeOwnerDegradation(JSON.parse(fsOps.readFileSync(filePath, 'utf8')));
      const pid = record.native_pid || record.root_pid;
      if (!pid || alive(pid) !== false) records.push({ ...record, path: filePath });
    } catch (error) {
      // A corrupt degradation tombstone is itself an ownership ambiguity.
      records.push({
        schema_version: 1,
        session_id: sessionId,
        owner_id: 'invalid_degradation_tombstone',
        degraded_at: null,
        error_code: 'degradation_tombstone_invalid',
        retry_count: 0,
        path: filePath,
        detail: error.message,
      });
    }
  }
  return records;
}

function pause(milliseconds) {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, Math.max(1, milliseconds));
}

function withRegistryLock(registryPath, callback, options = {}) {
  const lockPath = `${registryPath}.lock`;
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = Math.max(1, Number(options.staleMs) || DEFAULT_STALE_LOCK_MS);
  const pollMs = Math.max(1, Number(options.lockPollMs) || 25);
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  let descriptor;
  let lastContention = null;
  while (descriptor == null) {
    let candidateDescriptor = null;
    try {
      candidateDescriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(candidateDescriptor, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
      descriptor = candidateDescriptor;
      candidateDescriptor = null;
    } catch (error) {
      if (candidateDescriptor != null) {
        try { fs.closeSync(candidateDescriptor); } catch {}
        try { fs.unlinkSync(lockPath); } catch {}
      }
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      lastContention = error;
      try {
        const lockAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        const lockRecord = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        const alive = (options.processIsAlive || processIsAlive)(Number(lockRecord?.pid));
        if (lockAgeMs > staleMs && alive === false) fs.unlinkSync(lockPath);
      } catch {}
      if (Date.now() >= deadline) {
        const timeout = new Error(`Timed out acquiring Codex owner registry lock: ${lockPath}`);
        timeout.code = 'CODEX_OWNER_LOCK_TIMEOUT';
        timeout.cause = lastContention;
        throw timeout;
      }
      const jitter = (process.pid + Date.now()) % 7;
      (options.pause || pause)(pollMs + jitter);
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
    result.generation = Math.max(0, Number(registry.generation) || 0) + 1;
    const validated = validateRegistry(result);
    atomicWriteJson(registryPath, validated, options);
    // Cleanup follows authoritative candidate validation and committed readback.
    // A failed update never sweeps forensic temp evidence first.
    maybeCleanupOwnerRegistryTempFiles(registryPath, options);
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
    const owners = lineage.owners.filter(item => (
      item.owner_id !== normalized.owner_id
      && !sameDirectOwnerProcess(item, normalized)
    ));
    owners.push(normalized);
    registry.lineages[normalized.session_id] = { owners, lease: lineage.lease || null };
    if (registry.authority?.state === 'ready') {
      const heartbeatAt = new Date(Number(options.nowMs) || Date.now()).toISOString();
      registry.authority = normalizeAuthority({
        ...registry.authority,
        producer_id: `owner-heartbeat:${normalized.owner_kind}`,
        producer_pid: normalized.root_pid || normalized.native_pid,
        process_epoch: normalized.process_epoch,
        heartbeat_at: heartbeatAt,
        runtime_generation: normalized.runtime_generation || registry.authority.runtime_generation,
        scanned_lineages: Object.keys(registry.lineages).length,
        proof: 'owner_heartbeat_plus_exact_rollout',
      });
    }
    return registry;
  }, options);
  clearOwnerDegradation(normalized, { ...options, registryPath });
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
  try {
    clearOwnerDegradation({
      session_id: sessionId,
      owner_id: ownerId,
      owner_kind: 'interactive_tui',
      state: 'terminal',
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      process_epoch: options.processEpoch || ownerId,
    }, { ...options, registryPath });
  } catch {}
  return cleared;
}

function resolveLineageOwner(sessionId, options = {}) {
  const registryPath = options.registryPath || defaultRegistryPath(options.env);
  const degradations = loadOwnerDegradations(sessionId, { ...options, registryPath });
  if (degradations.length) {
    return {
      state: 'unavailable',
      owners: [],
      error: 'owner_registry_degraded',
      degradations,
      registry_path: registryPath,
    };
  }
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
    registry_generation: registry.generation || 0,
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
  DEFAULT_STALE_TEMP_MS,
  DEFAULT_TEMP_CLEANUP_INTERVAL_MS,
  DEFAULT_WRITE_RETRIES,
  OWNER_KINDS,
  OWNER_STATES,
  SCHEMA_VERSION,
  acquireLineageLease,
  atomicWriteJson,
  atomicReplaceBytes,
  atomicReplaceText,
  clearLiveOwner,
  clearOwnerDegradation,
  cleanupOwnerRegistryTempFiles,
  defaultRegistryPath,
  emptyRegistry,
  expireStaleOwners,
  loadOwnerRegistry,
  loadOwnerDegradations,
  markRegistryAuthorityReady,
  maybeCleanupOwnerRegistryTempFiles,
  normalizeAuthority,
  normalizeOwner,
  ownerTempIdentity,
  ownerDegradationDirectory,
  ownerDegradationPath,
  processIsAlive,
  publishLiveOwner,
  publishOwnerDegradation,
  releaseLineageLease,
  resolveLineageOwner,
  rolloutFileIdentity,
  sameDirectOwnerProcess,
  updateOwnerRegistry,
  validateRegistry,
  withRegistryLock,
};
