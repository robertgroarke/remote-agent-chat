'use strict';

function normalizeTranscriptCursor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const generation = typeof value.generation === 'string' ? value.generation.trim() : '';
  const messageIndex = Number(value.message_index);
  const endOffset = Number(value.end_offset);
  const fileSize = Number(value.file_size);
  if (!generation || generation.length > 128 || /[\u0000-\u001f\u007f]/.test(generation)) return null;
  if (!Number.isSafeInteger(messageIndex) || messageIndex < 0) return null;
  if (!Number.isSafeInteger(endOffset) || endOffset < 0) return null;
  if (!Number.isSafeInteger(fileSize) || fileSize < endOffset) return null;
  return {
    generation,
    message_index: messageIndex,
    end_offset: endOffset,
    file_size: fileSize,
  };
}

function evaluateTranscriptCursor(previousValue, incomingValue) {
  const incoming = normalizeTranscriptCursor(incomingValue);
  if (!incoming) return { accepted: false, code: 'invalid_cursor', incoming: null };
  const previous = normalizeTranscriptCursor(previousValue);
  if (!previous) return { accepted: true, code: 'baseline', incoming, previous: null };
  if (incoming.generation !== previous.generation) {
    return { accepted: false, code: 'generation_changed', incoming, previous };
  }
  if (incoming.message_index <= previous.message_index || incoming.end_offset < previous.end_offset) {
    return { accepted: false, code: 'stale_cursor', incoming, previous };
  }
  if (incoming.message_index !== previous.message_index + 1) {
    return {
      accepted: false,
      code: 'cursor_gap',
      expected_message_index: previous.message_index + 1,
      incoming,
      previous,
    };
  }
  return { accepted: true, code: 'append', incoming, previous };
}

module.exports = { normalizeTranscriptCursor, evaluateTranscriptCursor };
