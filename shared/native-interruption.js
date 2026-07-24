'use strict';

const crypto = require('crypto');

const INTERRUPTION_SCHEMA_VERSION = 1;
const TERMINAL_STATES = new Set(['resolved', 'dismissed', 'superseded']);

function iso(value, fallback = null) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function redactNativeInterruptionText(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\bhttps?:\/\/([^/\s:@]+):([^@\s/]+)@/gi, 'https://$1:[redacted]@')
    .replace(/\bhttps?:\/\/[^\s<>"')]+/gi, raw => {
      try {
        const url = new URL(raw);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '');
      } catch {
        return '[redacted-url]';
      }
    })
    .replace(/\b[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '%USERPROFILE%')
    .replace(/\b\/(?:home|Users)\/[^/\s]+/g, match => (
      match.startsWith('/home/') ? '$HOME' : '/Users/[user]'
    ));
  return text.slice(0, 4000);
}

function classifyNativeInterruption(message, providerCode = '') {
  const text = `${message}\n${providerCode}`.toLowerCase();
  if (/\b(no such host|enotfound|eai_again|getaddrinfo|os error 11001|dns)\b/.test(text)) {
    return { category: 'dns_offline', code: 'network_dns', title: 'Network name resolution failed', severity: 'error', blocking: true, action_required: true, retryable: true };
  }
  if (/\b(websocket|websockets).*(fallback|https)|falling back.*https transport/.test(text)) {
    return { category: 'transport_fallback', code: 'transport_fallback', title: 'Transport fallback', severity: 'warning', blocking: false, action_required: false, retryable: true };
  }
  if (/\b(stream disconnected|connection reset|econnreset|connection closed|network error|offline)\b/.test(text)) {
    return { category: 'stream_interruption', code: 'stream_interrupted', title: 'Provider stream interrupted', severity: 'error', blocking: true, action_required: true, retryable: true };
  }
  if (/\b(tls|ssl|certificate|cert_|handshake)\b/.test(text)) {
    return { category: 'tls', code: 'transport_tls', title: 'Secure connection failed', severity: 'error', blocking: true, action_required: true, retryable: true };
  }
  if (/\b(401|403|unauthorized|forbidden|authentication|sign[ -]?in|login)\b/.test(text)) {
    return { category: 'authentication', code: 'provider_auth', title: 'Provider authentication failed', severity: 'error', blocking: true, action_required: true, retryable: false };
  }
  if (/\b(429|rate limit|quota|usage limit|credits? exhausted)\b/.test(text)) {
    return { category: 'quota', code: 'provider_quota', title: 'Provider usage limit reached', severity: 'error', blocking: true, action_required: true, retryable: false };
  }
  if (/\b(refus(?:e|ed|al)|policy|safety)\b/.test(text)) {
    return { category: 'policy_refusal', code: 'provider_policy', title: 'Provider refused the request', severity: 'error', blocking: true, action_required: true, retryable: false };
  }
  if (/\b(500|502|503|504|server error|service unavailable|overloaded)\b/.test(text)) {
    return { category: 'provider_server', code: 'provider_server', title: 'Provider service failed', severity: 'error', blocking: true, action_required: true, retryable: true };
  }
  if (/\b(interrupt(?:ed)?|aborted|cancelled|canceled)\b/.test(text)) {
    return { category: 'user_interrupt', code: 'user_interrupt', title: 'Turn interrupted', severity: 'notice', blocking: false, action_required: false, retryable: true };
  }
  if (/\b(crash|update required|unsupported version|incompatible version)\b/.test(text)) {
    return { category: 'app_failure', code: 'app_failure', title: 'Harness stopped', severity: 'error', blocking: true, action_required: true, retryable: true };
  }
  return { category: 'unknown_terminal', code: 'unknown_terminal', title: 'Harness request failed', severity: 'error', blocking: true, action_required: true, retryable: false };
}

function normalizeNativeInterruption(input = {}) {
  const safeText = redactNativeInterruptionText(
    input.safe_display_text || input.message || input.text || 'The native harness reported an error.',
  );
  const classified = classifyNativeInterruption(safeText, input.provider_error_code || input.code || '');
  const nativeTimestamp = iso(input.native_timestamp || input.timestamp, null);
  const observedAt = iso(input.observed_at, nativeTimestamp);
  const sessionId = String(input.session_id || '').trim();
  const surface = String(input.surface || input.agent_type || 'unknown').trim().toLowerCase();
  const nativeThreadId = String(input.native_thread_id || '').trim() || null;
  const turnId = String(input.turn_id || '').trim() || null;
  const sourceKind = String(input.source_kind || 'native').trim();
  const eventBasis = [sessionId, surface, nativeThreadId || '', turnId || '', classified.code, safeText].join('\u0000');
  const eventId = String(input.event_id || '').trim()
    || `interrupt:${crypto.createHash('sha256').update(eventBasis).digest('hex').slice(0, 40)}`;
  return {
    schema_version: INTERRUPTION_SCHEMA_VERSION,
    event_id: eventId,
    session_id: sessionId || null,
    surface,
    native_thread_id: nativeThreadId,
    turn_id: turnId,
    goal_fingerprint: String(input.goal_fingerprint || '').trim() || null,
    native_timestamp: nativeTimestamp,
    observed_at: observedAt,
    forwarded_at: iso(input.forwarded_at, null),
    severity: input.severity || classified.severity,
    category: input.category || classified.category,
    code: input.code || classified.code,
    provider_error_code: String(input.provider_error_code || '').trim() || null,
    title: String(input.title || classified.title).trim().slice(0, 160),
    safe_display_text: safeText,
    blocking: input.blocking == null ? classified.blocking : input.blocking === true,
    action_required: input.action_required == null ? classified.action_required : input.action_required === true,
    retryable: input.retryable == null ? classified.retryable : input.retryable === true,
    resolution_state: String(input.resolution_state || 'unresolved').trim().toLowerCase(),
    transition_seq: Math.max(1, Math.floor(Number(input.transition_seq) || 1)),
    resolved_at: iso(input.resolved_at, null),
    resolution_reason: String(input.resolution_reason || '').trim() || null,
    tombstone: input.tombstone === true,
    provenance: {
      source_kind: sourceKind,
      source_id: String(input.source_id || '').trim() || null,
      immutable_native: input.immutable_native !== false,
    },
  };
}

function resolveNativeInterruption(interruption, input = {}) {
  if (!interruption) return null;
  const resolvedAt = iso(input.resolved_at || input.timestamp, interruption.native_timestamp);
  return {
    ...interruption,
    resolution_state: String(input.resolution_state || 'resolved').trim().toLowerCase(),
    transition_seq: Math.max(
      Math.floor(Number(interruption.transition_seq) || 1) + 1,
      Math.floor(Number(input.transition_seq) || 0),
    ),
    resolved_at: resolvedAt,
    resolution_reason: String(input.resolution_reason || 'later_native_progress').trim(),
    tombstone: true,
  };
}

function reduceNativeInterruption(previous, incoming) {
  if (!previous) return { value: incoming || null, code: incoming ? 'accepted_initial' : 'empty' };
  if (!incoming) return { value: previous, code: 'retained_missing_update' };
  if (previous.event_id !== incoming.event_id) {
    const previousAt = Date.parse(previous.native_timestamp || previous.observed_at || '') || 0;
    const incomingAt = Date.parse(incoming.native_timestamp || incoming.observed_at || '') || 0;
    return incomingAt >= previousAt
      ? { value: incoming, code: 'accepted_newer_event' }
      : { value: previous, code: 'rejected_older_event' };
  }
  const previousSeq = Math.max(0, Number(previous.transition_seq) || 0);
  const incomingSeq = Math.max(0, Number(incoming.transition_seq) || 0);
  const previousTerminal = TERMINAL_STATES.has(String(previous.resolution_state || '').toLowerCase());
  const incomingTerminal = TERMINAL_STATES.has(String(incoming.resolution_state || '').toLowerCase());
  if (previousTerminal && !incomingTerminal) return { value: previous, code: 'rejected_resurrection' };
  if (incomingSeq < previousSeq) return { value: previous, code: 'rejected_sequence_regression' };
  if (incomingSeq === previousSeq && previousTerminal && incomingTerminal) {
    return { value: previous, code: 'retained_terminal_replay' };
  }
  return { value: incoming, code: incomingTerminal ? 'accepted_terminal' : 'accepted_update' };
}

module.exports = {
  INTERRUPTION_SCHEMA_VERSION,
  TERMINAL_STATES,
  redactNativeInterruptionText,
  classifyNativeInterruption,
  normalizeNativeInterruption,
  resolveNativeInterruption,
  reduceNativeInterruption,
};
