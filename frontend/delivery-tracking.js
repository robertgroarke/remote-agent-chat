export function resolveDeliverySession(transcripts, clientMessageId, sessionHint = '') {
  if (!clientMessageId) return '';
  const store = transcripts || {};
  if (sessionHint && (store[sessionHint] || []).some(message => message?._cid === clientMessageId)) {
    return sessionHint;
  }
  return Object.keys(store).find(sessionId => (
    (store[sessionId] || []).some(message => message?._cid === clientMessageId)
  )) || '';
}

export function updateDeliveryMessage(transcripts, clientMessageId, sessionId, updater) {
  if (!clientMessageId || !sessionId || typeof updater !== 'function') return transcripts;
  const current = transcripts?.[sessionId] || [];
  let changed = false;
  const updated = current.map(message => {
    if (message?._cid !== clientMessageId) return message;
    const next = updater(message);
    if (next !== message) changed = true;
    return next;
  });
  return changed ? { ...transcripts, [sessionId]: updated } : transcripts;
}
