'use strict';

export function createProvisionalStream(sessionId, clientMessageId = null, nowMs = Date.now()) {
  return {
    sessionId,
    messageId: null,
    blockIndex: 0,
    seq: -1,
    content: '',
    open: true,
    startedAtMs: nowMs,
    clientMessageId,
  };
}

export function shouldClearEmptyProvisionalOnTerminal(stream, activity, thinking = false) {
  if (!stream || String(stream.content || '').length > 0 || thinking) return false;
  const kind = String(activity?.kind || 'idle').toLowerCase();
  return ['idle', 'waiting_for_user', 'completed', 'done', 'failed', 'error', 'interrupted'].includes(kind);
}

export function reduceMessageDeltaStream(current, message, nowMs = Date.now()) {
  const sessionId = message?.session_id || message?.session || '';
  const messageId = message?.message_id || '';
  const blockIndex = Number(message?.block_index);
  const seq = Number(message?.seq);
  if (!sessionId || !messageId || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || !Number.isSafeInteger(seq) || seq < 0) {
    return { accepted: false, code: 'invalid_identity', stream: current || null };
  }
  if (message.op === 'block_open') {
    if (seq !== 0) return { accepted: false, code: 'invalid_open_sequence', stream: current || null };
    return {
      accepted: true,
      stream: {
        ...createProvisionalStream(sessionId, current?.clientMessageId || null, current?.startedAtMs || nowMs),
        messageId,
        blockIndex,
        seq,
      },
    };
  }
  if (!current || current.messageId !== messageId || current.blockIndex !== blockIndex || !current.open) {
    return { accepted: false, code: 'stream_not_open', stream: current || null };
  }
  if (seq !== current.seq + 1) return { accepted: false, code: 'sequence_gap', stream: current };
  if (message.op === 'append') {
    if (typeof message.append !== 'string' || message.append.length === 0) {
      return { accepted: false, code: 'invalid_append', stream: current };
    }
    return {
      accepted: true,
      stream: { ...current, seq, content: `${current.content || ''}${message.append}` },
    };
  }
  if (message.op === 'block_close') {
    return { accepted: true, stream: { ...current, seq, open: false } };
  }
  return { accepted: false, code: 'invalid_operation', stream: current };
}
