'use strict';

const crypto = require('crypto');

const CONNECTION_STATES = new Set(['reconnecting', 'reconnected', 'failed']);
const CONNECTION_PROVENANCE = new Set(['codex_desktop_dom', 'codex_extension_dom']);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function lifecycleGeneration({ session_id, thread_id, turn_id, provenance, generation_seq }) {
  const input = [session_id, thread_id, turn_id, provenance, generation_seq].map(value => String(value || '')).join('\0');
  return `provider-connection-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
}

function normalizeProviderConnection(value, context = {}) {
  if (!value || typeof value !== 'object') return { ok: false, code: 'connection_missing' };
  const state = text(value.state)?.toLowerCase();
  const provenance = text(value.provenance || value.surface_provenance?.source);
  const sessionId = text(value.session_id || context.session_id);
  const threadId = text(value.thread_id || value.native_thread_id || context.thread_id);
  const turnId = text(value.turn_id || value.native_turn_id || context.turn_id);
  const sourceId = text(value.source_id || value.native_source_id);
  const producerTimestamp = timestamp(value.producer_timestamp || value.observed_at || context.producer_timestamp);
  const generationSeq = Number(value.generation_seq ?? context.generation_seq);
  if (!CONNECTION_STATES.has(state)) return { ok: false, code: 'connection_state_invalid' };
  if (!CONNECTION_PROVENANCE.has(provenance)) return { ok: false, code: 'connection_provenance_invalid' };
  if (!sessionId || !threadId || !turnId || !sourceId) return { ok: false, code: 'connection_owner_incomplete' };
  if (!producerTimestamp) return { ok: false, code: 'connection_timestamp_invalid' };
  if (!Number.isSafeInteger(generationSeq) || generationSeq < 1) return { ok: false, code: 'connection_generation_invalid' };
  let attempt = value.attempt == null ? null : Number(value.attempt);
  let attemptLimit = value.attempt_limit == null ? null : Number(value.attempt_limit);
  if (state === 'reconnecting') {
    if (!Number.isInteger(attempt) || !Number.isInteger(attemptLimit)
        || attempt < 1 || attemptLimit < 1 || attempt > attemptLimit || attemptLimit > 100) {
      return { ok: false, code: 'connection_counter_invalid' };
    }
  } else {
    if (attempt != null && (!Number.isInteger(attempt) || attempt < 1)) attempt = null;
    if (attemptLimit != null && (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 100)) attemptLimit = null;
  }
  const generation = text(value.generation)
    || lifecycleGeneration({ session_id: sessionId, thread_id: threadId, turn_id: turnId, provenance, generation_seq: generationSeq });
  const label = state === 'reconnecting'
    ? `Reconnecting ${attempt}/${attemptLimit}`
    : state === 'failed' ? 'Native connection failed' : 'Reconnected';
  return { ok: true, connection: {
    schema_version: 1,
    state,
    attempt,
    attempt_limit: attemptLimit,
    label,
    producer_timestamp: producerTimestamp,
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    generation,
    generation_seq: generationSeq,
    source_id: sourceId,
    source_cursor: value.source_cursor || value.native_source_cursor || null,
    provenance,
    surface_provenance: value.surface_provenance || null,
  } };
}

function semanticIdentity(value) {
  return JSON.stringify([
    value.state, value.attempt, value.attempt_limit, value.session_id, value.thread_id,
    value.turn_id, value.generation, value.generation_seq, value.source_id, value.provenance,
  ]);
}

function reduceProviderConnection(previous, incoming, context = {}) {
  const normalized = normalizeProviderConnection(incoming, context);
  if (!normalized.ok) return { connection: previous || null, accepted: false, visible: null, code: normalized.code };
  const next = normalized.connection;
  if (!previous) return { connection: next, accepted: true, visible: next, code: 'connection_observed' };
  const prior = normalizeProviderConnection(previous, previous);
  if (!prior.ok) return { connection: next, accepted: true, visible: next, code: 'connection_replaced_invalid_prior' };
  const current = prior.connection;
  if (next.session_id !== current.session_id) {
    return { connection: current, accepted: false, visible: null, code: 'connection_cross_session_rejected' };
  }
  if (next.generation_seq < current.generation_seq) {
    return { connection: current, accepted: false, visible: null, code: 'connection_stale_generation_rejected' };
  }
  if (next.generation_seq === current.generation_seq) {
    if (next.generation !== current.generation || next.thread_id !== current.thread_id || next.turn_id !== current.turn_id) {
      return { connection: current, accepted: false, visible: null, code: 'connection_generation_owner_rejected' };
    }
    if (semanticIdentity(next) === semanticIdentity(current)) {
      return { connection: current, accepted: false, visible: current, code: 'connection_duplicate_suppressed' };
    }
    if (current.state !== 'reconnecting' && next.state === 'reconnecting') {
      return { connection: current, accepted: false, visible: null, code: 'connection_terminal_regression_rejected' };
    }
    if (current.state === 'reconnecting' && next.state === 'reconnecting') {
      if (next.attempt_limit !== current.attempt_limit || next.attempt < current.attempt) {
        return { connection: current, accepted: false, visible: null, code: 'connection_counter_regression_rejected' };
      }
    }
  }
  return {
    connection: next,
    accepted: true,
    visible: next,
    code: next.state === 'failed' ? 'connection_failed'
      : next.state === 'reconnected' ? 'connection_recovered'
        : 'connection_attempt_advanced',
  };
}

module.exports = {
  CONNECTION_PROVENANCE,
  CONNECTION_STATES,
  lifecycleGeneration,
  normalizeProviderConnection,
  reduceProviderConnection,
};
