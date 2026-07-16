'use strict';

const MAX_APPEND_BYTES = 64 * 1024;
const STREAM_TTL_MS = 10 * 60 * 1000;
const OPERATIONS = new Set(['block_open', 'append', 'block_close']);

function deltaKey(message) {
  return `${message.session_id}\u0000${message.message_id}\u0000${message.block_index}`;
}

function validateMessageDelta(message) {
  if (!message || message.type !== 'message_delta') return { ok: false, code: 'invalid_type' };
  if (typeof message.session_id !== 'string' || !message.session_id.trim()) return { ok: false, code: 'invalid_session' };
  if (typeof message.message_id !== 'string' || !message.message_id.trim() || message.message_id.length > 200) {
    return { ok: false, code: 'invalid_message_id' };
  }
  if (!Number.isSafeInteger(message.block_index) || message.block_index < 0) return { ok: false, code: 'invalid_block_index' };
  if (!Number.isSafeInteger(message.seq) || message.seq < 0) return { ok: false, code: 'invalid_sequence' };
  if (!OPERATIONS.has(message.op)) return { ok: false, code: 'invalid_operation' };
  if (message.op === 'append') {
    if (typeof message.append !== 'string' || message.append.length === 0) return { ok: false, code: 'invalid_append' };
    if (Buffer.byteLength(message.append, 'utf8') > MAX_APPEND_BYTES) return { ok: false, code: 'append_too_large' };
  } else if (message.append != null && message.append !== '') {
    return { ok: false, code: 'marker_has_append' };
  }
  return { ok: true };
}

class MessageDeltaGate {
  constructor(options = {}) {
    this.streams = new Map();
    this.ttlMs = Math.max(1_000, Number(options.ttlMs) || STREAM_TTL_MS);
    this.maxStreams = Math.max(16, Number(options.maxStreams) || 2048);
  }

  prune(nowMs) {
    for (const [key, state] of this.streams) {
      if (nowMs - state.updatedAtMs > this.ttlMs) this.streams.delete(key);
    }
  }

  clearSession(sessionId) {
    const prefix = `${sessionId}\u0000`;
    for (const key of this.streams.keys()) {
      if (key.startsWith(prefix)) this.streams.delete(key);
    }
  }

  accept(message, receivedAtMs = Date.now()) {
    const valid = validateMessageDelta(message);
    if (!valid.ok) return valid;
    this.prune(receivedAtMs);
    const key = deltaKey(message);
    const state = this.streams.get(key);

    if (message.op === 'block_open') {
      if (message.seq !== 0) return { ok: false, code: 'open_sequence_must_be_zero' };
      if (state) return { ok: false, code: state.closed ? 'stream_closed' : 'stream_already_open' };
      this.streams.set(key, { lastSeq: 0, closed: false, updatedAtMs: receivedAtMs });
      while (this.streams.size > this.maxStreams) this.streams.delete(this.streams.keys().next().value);
    } else {
      if (!state) return { ok: false, code: 'stream_not_open' };
      if (state.closed) return { ok: false, code: 'stream_closed' };
      if (message.seq !== state.lastSeq + 1) {
        return { ok: false, code: 'sequence_gap', expected_seq: state.lastSeq + 1 };
      }
      state.lastSeq = message.seq;
      state.closed = message.op === 'block_close';
      state.updatedAtMs = receivedAtMs;
    }

    const forwarded = {
      type: 'message_delta',
      protocol_version: 1,
      session: message.session_id,
      session_id: message.session_id,
      message_id: message.message_id,
      role: message.role || 'assistant',
      block_index: message.block_index,
      block_type: message.block_type || 'text',
      seq: message.seq,
      op: message.op,
      ...(message.op === 'append' ? { append: message.append } : {}),
      relay_received_at_ms: receivedAtMs,
    };
    if (message.stream_trace && typeof message.stream_trace === 'object') {
      forwarded.stream_trace = { ...message.stream_trace, relay_received_at_ms: receivedAtMs };
    }
    return { ok: true, message: forwarded };
  }
}

module.exports = { MAX_APPEND_BYTES, MessageDeltaGate, validateMessageDelta };
