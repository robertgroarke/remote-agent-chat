'use strict';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function boundedString(value, { min = 1, max = 200 } = {}) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
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

function createPrincipalRateLimit({ name, limit, windowMs = 60_000, principal }) {
  if (!name || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error('Invalid rate limiter configuration');
  }
  const hitsByPrincipal = new Map();
  return function principalRateLimit(req, res, next) {
    const now = Date.now();
    const key = String(principal(req) || req.ip || req.socket?.remoteAddress || 'unknown').toLowerCase();
    const hits = (hitsByPrincipal.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (hits.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: `Too many ${name} requests - try again later` });
    }
    hits.push(now);
    hitsByPrincipal.set(key, hits);
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

module.exports = {
  boundedString,
  createPrincipalRateLimit,
  validateQueueControlMessage,
  validateWebPushEndpoint,
  validateWebPushSubscription,
  validateWorkspaceControlMessage,
};
