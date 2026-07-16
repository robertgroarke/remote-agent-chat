import { normalizeTranscriptTimestamps } from './message-time.js';

export const TRANSCRIPT_CACHE_LIMIT = 10;

const transcriptCache = new Map();
const transcriptListeners = new Map();
const EMPTY_TRANSCRIPT = Object.freeze([]);

function normalizedSessionId(sessionId) {
  return String(sessionId || '').trim();
}

export function stableTranscriptMessageKey(message) {
  if (!message || typeof message !== 'object') return '';
  if (message.source_message_id) return `source:${message.source_message_id}`;
  if (message.native_source_id) return `native:${message.native_source_id}`;
  if (message.id != null) return `id:${message.id}`;
  if (message.server_message_id != null) return `server:${message.server_message_id}`;
  if (message.sequence != null) return `sequence:${message.sequence}`;
  if (message.client_message_id) return `client:${message.client_message_id}`;
  if (message.client_msg_id) return `client:${message.client_msg_id}`;
  if (message._cid) return `client:${message._cid}`;
  return `content:${message.role || ''}:${message.ts || ''}:${String(message.content || '')}`;
}

export function mergeTranscriptMessages(existing, incoming) {
  const merged = [];
  const indexes = new Map();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .forEach(message => {
      const key = stableTranscriptMessageKey(message);
      if (key && indexes.has(key)) {
        const index = indexes.get(key);
        merged[index] = { ...merged[index], ...message };
        return;
      }
      if (key) indexes.set(key, merged.length);
      merged.push(message);
    });
  return merged.sort((left, right) => {
    const leftSequence = Number(left?.sequence);
    const rightSequence = Number(right?.sequence);
    if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    return (Number(left?.ts) || 0) - (Number(right?.ts) || 0);
  });
}

export function getCachedTranscript(sessionId) {
  const id = normalizedSessionId(sessionId);
  if (!id || !transcriptCache.has(id)) return null;
  const messages = transcriptCache.get(id);
  transcriptCache.delete(id);
  transcriptCache.set(id, messages);
  return messages;
}

export function getTranscriptSnapshot(sessionId) {
  const id = normalizedSessionId(sessionId);
  return (id && transcriptCache.get(id)) || EMPTY_TRANSCRIPT;
}

export function subscribeCachedTranscript(sessionId, listener) {
  const id = normalizedSessionId(sessionId);
  if (!id || typeof listener !== 'function') return () => {};
  const listeners = transcriptListeners.get(id) || new Set();
  listeners.add(listener);
  transcriptListeners.set(id, listeners);
  return () => {
    const current = transcriptListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) transcriptListeners.delete(id);
  };
}

function notifyTranscript(sessionId) {
  const listeners = transcriptListeners.get(sessionId);
  if (!listeners) return;
  [...listeners].forEach(listener => listener());
}

export function hasCachedTranscript(sessionId) {
  const id = normalizedSessionId(sessionId);
  return !!id && transcriptCache.has(id);
}

export function setCachedTranscript(sessionId, messages, limit = TRANSCRIPT_CACHE_LIMIT) {
  const id = normalizedSessionId(sessionId);
  if (!id || !Array.isArray(messages)) return [];
  const normalizedMessages = normalizeTranscriptTimestamps(messages);
  const previous = transcriptCache.get(id);
  transcriptCache.delete(id);
  transcriptCache.set(id, normalizedMessages);
  const evicted = [];
  const boundedLimit = Math.max(1, Number(limit) || TRANSCRIPT_CACHE_LIMIT);
  while (transcriptCache.size > boundedLimit) {
    const oldest = transcriptCache.keys().next().value;
    transcriptCache.delete(oldest);
    evicted.push(oldest);
  }
  if (previous !== normalizedMessages) notifyTranscript(id);
  evicted.forEach(notifyTranscript);
  return evicted;
}

export function deleteCachedTranscript(sessionId) {
  const id = normalizedSessionId(sessionId);
  if (!id || !transcriptCache.has(id)) return false;
  transcriptCache.delete(id);
  notifyTranscript(id);
  return true;
}

function transcriptMapSnapshot() {
  return Object.fromEntries([...transcriptCache.entries()]);
}

export function updateTranscriptStore(updater) {
  const previous = transcriptMapSnapshot();
  const next = typeof updater === 'function' ? updater(previous) : updater;
  if (!next || next === previous || typeof next !== 'object') return previous;
  const nextIds = new Set(Object.keys(next));
  Object.keys(previous).forEach(id => {
    if (!nextIds.has(id)) deleteCachedTranscript(id);
  });
  Object.entries(next).forEach(([id, messages]) => {
    if (Array.isArray(messages) && previous[id] !== messages) setCachedTranscript(id, messages);
  });
  return next;
}

export const transcriptStoreView = new Proxy({}, {
  get(_target, property) {
    if (typeof property !== 'string') return undefined;
    return transcriptCache.get(property);
  },
  ownKeys() {
    return [...transcriptCache.keys()];
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property === 'string' && transcriptCache.has(property)) {
      return { configurable: true, enumerable: true, value: transcriptCache.get(property) };
    }
    return undefined;
  },
  set(_target, property, value) {
    if (typeof property !== 'string' || !Array.isArray(value)) return false;
    setCachedTranscript(property, value);
    return true;
  },
  deleteProperty(_target, property) {
    return typeof property === 'string' ? deleteCachedTranscript(property) : false;
  },
});

export function mergeCachedTranscript(sessionId, messages, options = {}) {
  const id = normalizedSessionId(sessionId);
  if (!id) return [];
  const previous = transcriptCache.get(id) || [];
  const next = options.replace
    ? (Array.isArray(messages) ? messages : [])
    : mergeTranscriptMessages(previous, messages);
  setCachedTranscript(id, next, options.limit);
  return next;
}

export function appendCachedTranscript(sessionId, message, options = {}) {
  return mergeCachedTranscript(sessionId, message ? [message] : [], options);
}

export function latestTranscriptSequence(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((maximum, message) => {
    const sequence = Number(message?.sequence);
    return Number.isFinite(sequence) && sequence > maximum ? sequence : maximum;
  }, 0);
}

export function cachedTranscriptSessionIds() {
  return [...transcriptCache.keys()];
}

export function clearTranscriptCache() {
  const ids = [...transcriptCache.keys()];
  transcriptCache.clear();
  ids.forEach(notifyTranscript);
}

export function isTranscriptActivityLive(activity, thinking = false) {
  if (thinking || activity?.generating) return true;
  const kind = String(activity?.kind || '').toLowerCase();
  return !!activity && !['', 'idle', 'waiting_for_user', 'completed', 'done', 'failed', 'error', 'interrupted']
    .includes(kind);
}
