'use strict';

const path = require('path');

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function boundedString(value, { min = 1, max = 200 } = {}) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function decodeBoundedBase64(value, maxBytes) {
  if (typeof value !== 'string' || !Number.isInteger(maxBytes) || maxBytes < 1) {
    return { ok: false, error: 'Invalid base64 upload' };
  }
  const encoded = value.trim();
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (!encoded || encoded.length > maxEncodedLength || encoded.length % 4 === 1 || !BASE64_RE.test(encoded)) {
    return { ok: false, error: encoded.length > maxEncodedLength ? 'File too large' : 'Invalid base64 upload' };
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxBytes) return { ok: false, error: 'File too large' };
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== encoded.replace(/=+$/, '')) return { ok: false, error: 'Invalid base64 upload' };
  return { ok: true, bytes };
}

function resolveUploadReference(uploadDirectory, storedName) {
  if (!boundedString(storedName, { max: 255 })
      || path.basename(storedName) !== storedName
      || !/^\d{10,16}_[A-Za-z0-9._-]+$/.test(storedName)) {
    return { ok: false, error: 'Invalid upload reference' };
  }
  const root = path.resolve(uploadDirectory);
  const target = path.resolve(root, storedName);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return { ok: false, error: 'Invalid upload reference' };
  }
  return { ok: true, path: target };
}

function validateWebPushEndpoint(value) {
  const endpoint = typeof value === 'string' ? value.trim() : '';
  if (!boundedString(endpoint, { min: 10, max: 2048 })) {
    return { ok: false, error: 'Invalid Web Push endpoint' };
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      return { ok: false, error: 'Invalid Web Push endpoint' };
    }
  } catch {
    return { ok: false, error: 'Invalid Web Push endpoint' };
  }
  return { ok: true, endpoint };
}

function validateWebPushSubscription(value) {
  const subscription = value?.subscription || value || {};
  const endpointResult = validateWebPushEndpoint(subscription.endpoint);
  const p256dh = typeof subscription.keys?.p256dh === 'string' ? subscription.keys.p256dh.trim() : '';
  const auth = typeof subscription.keys?.auth === 'string' ? subscription.keys.auth.trim() : '';
  if (
    !endpointResult.ok
    || !boundedString(p256dh, { min: 43, max: 256 })
    || !boundedString(auth, { min: 16, max: 128 })
    || !BASE64URL_RE.test(p256dh)
    || !BASE64URL_RE.test(auth)
  ) {
    return { ok: false, error: 'Invalid Web Push subscription' };
  }
  return { ok: true, endpoint: endpointResult.endpoint, p256dh, auth };
}

function createPrincipalWindowLimiter({ limit, windowMs = 60_000, maxPrincipals = 2048 }) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1
    || !Number.isInteger(maxPrincipals) || maxPrincipals < 1) {
    throw new Error('Invalid rate limiter configuration');
  }
  const hitsByPrincipal = new Map();
  let nextSweepAt = 0;
  return {
    size() { return hitsByPrincipal.size; },
    consume(principal) {
      const now = Date.now();
      const key = String(principal || 'unknown').toLowerCase();
      if (now >= nextSweepAt) {
        for (const [candidate, timestamps] of hitsByPrincipal) {
          if (!timestamps.some(timestamp => now - timestamp < windowMs)) hitsByPrincipal.delete(candidate);
        }
        nextSweepAt = now + windowMs;
      }
      const hits = (hitsByPrincipal.get(key) || []).filter(timestamp => now - timestamp < windowMs);
      if (hits.length >= limit) {
        return {
          ok: false,
          retryAfterMs: Math.max(1, windowMs - (now - hits[0])),
        };
      }
      hits.push(now);
      if (hitsByPrincipal.has(key)) hitsByPrincipal.delete(key);
      hitsByPrincipal.set(key, hits);
      while (hitsByPrincipal.size > maxPrincipals) hitsByPrincipal.delete(hitsByPrincipal.keys().next().value);
      return { ok: true, remaining: limit - hits.length };
    },
  };
}

function createPrincipalRateLimit({ name, limit, windowMs = 60_000, principal }) {
  if (!name || typeof principal !== 'function') {
    throw new Error('Invalid rate limiter configuration');
  }
  const limiter = createPrincipalWindowLimiter({ limit, windowMs });
  return function principalRateLimit(req, res, next) {
    const key = String(principal(req) || req.ip || req.socket?.remoteAddress || 'unknown').toLowerCase();
    const result = limiter.consume(key);
    if (!result.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: `Too many ${name} requests - try again later` });
    }
    return next();
  };
}

function validateQueueControlMessage(message, maxContentBytes) {
  const sessionId = message?.session_id || message?.session;
  const clientMessageId = message?.client_message_id;
  if (!boundedString(sessionId, { max: 200 }) || !boundedString(clientMessageId, { max: 200 })) {
    return { ok: false, error: 'Queue control requires bounded session and client message ids' };
  }
  if (message.type === 'edit_queued') {
    if (typeof message.content !== 'string' || message.content.length === 0) {
      return { ok: false, error: 'Queued-message edit requires non-empty content' };
    }
    if (Buffer.byteLength(message.content, 'utf8') > maxContentBytes) {
      return { ok: false, error: 'Queued-message edit exceeds the content limit' };
    }
  }
  return { ok: true, sessionId, clientMessageId };
}

function validateWorkspaceControlMessage(message) {
  const sessionId = message?.session_id || message?.session;
  const requestId = message?.request_id;
  if (!boundedString(sessionId, { max: 200 }) || !boundedString(requestId, { max: 200 })) {
    return { ok: false, error: 'Workspace control requires bounded session and request ids' };
  }
  const requestPath = message?.path === undefined && message?.type === 'list_directory'
    ? '.'
    : message?.path;
  if (!boundedString(requestPath, { max: 4096 })) {
    return { ok: false, error: 'Workspace path is missing or too long' };
  }
  if (message.max_size !== undefined) {
    const maxSize = Number(message.max_size);
    if (!Number.isFinite(maxSize) || maxSize < 1 || maxSize > 4 * 1024 * 1024) {
      return { ok: false, error: 'Workspace read size must be between 1 byte and 4 MiB' };
    }
  }
  return { ok: true, sessionId, requestId, path: requestPath };
}

const CODEX_CONFIG_FIELDS = Object.freeze([
  'model_id',
  'effort',
  'speed',
  'access_mode',
  'permission_profile',
  'workspace_mode',
]);
const CODEX_EFFORT_VALUES = new Set(['light', 'low', 'medium', 'high', 'extra-high', 'ultra']);
const CODEX_SPEED_VALUES = new Set(['standard', 'fast']);
const CODEX_ACCESS_VALUES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const CODEX_PERMISSION_PROFILE_VALUES = new Set(['auto', 'guardian-approvals', 'full-access', 'custom']);

function validateCodexConfigControlMessage(message) {
  const sessionId = message?.session_id || message?.session;
  const requestId = message?.request_id;
  if (!boundedString(sessionId, { max: 200 }) || !boundedString(requestId, { max: 200 })) {
    return { ok: false, error: 'Codex config control requires bounded session and request ids' };
  }
  if (message.source_revision !== undefined
      && !boundedString(message.source_revision, { max: 200 })) {
    return { ok: false, error: 'Codex config source revision is invalid' };
  }
  const fields = CODEX_CONFIG_FIELDS.filter(field => message[field] !== undefined && message[field] !== null);
  if (fields.length !== 1) {
    return { ok: false, error: 'Codex config control requires exactly one field' };
  }
  const field = fields[0];
  const value = message[field];
  if (!boundedString(value, { max: field === 'workspace_mode' ? 200 : 80 })) {
    return { ok: false, error: `Invalid Codex config ${field}` };
  }
  if (field === 'model_id' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) {
    return { ok: false, error: 'Invalid Codex model id' };
  }
  if (field === 'effort' && !CODEX_EFFORT_VALUES.has(value)) {
    return { ok: false, error: 'Unsupported Codex effort value' };
  }
  if (field === 'speed' && !CODEX_SPEED_VALUES.has(value)) {
    return { ok: false, error: 'Unsupported Codex speed value' };
  }
  if (field === 'access_mode' && !CODEX_ACCESS_VALUES.has(value)) {
    return { ok: false, error: 'Unsupported Codex access value' };
  }
  if (field === 'permission_profile' && !CODEX_PERMISSION_PROFILE_VALUES.has(value)) {
    return { ok: false, error: 'Unsupported Codex permission profile' };
  }
  if (message.confirm_bypass !== undefined && typeof message.confirm_bypass !== 'boolean') {
    return { ok: false, error: 'Codex bypass confirmation must be boolean' };
  }
  if (field === 'permission_profile' && value === 'full-access' && message.confirm_bypass !== true) {
    return { ok: false, error: 'Full-access permission profile requires explicit confirmation' };
  }
  if (message.confirm_bypass === true && !(field === 'permission_profile' && value === 'full-access')) {
    return { ok: false, error: 'Bypass confirmation is only valid for the full-access permission profile' };
  }
  return {
    ok: true,
    sessionId,
    requestId,
    field,
    value,
    sourceRevision: message.source_revision || null,
    confirmBypass: message.confirm_bypass === true,
    fingerprint: `${sessionId}\u0001${field}\u0001${value}\u0001${message.confirm_bypass === true ? '1' : '0'}\u0001${message.source_revision || ''}`,
  };
}

module.exports = {
  boundedString,
  createPrincipalRateLimit,
  createPrincipalWindowLimiter,
  decodeBoundedBase64,
  resolveUploadReference,
  validateCodexConfigControlMessage,
  validateQueueControlMessage,
  validateWebPushEndpoint,
  validateWebPushSubscription,
  validateWorkspaceControlMessage,
};
