'use strict';

const DELIVERY_STATE_RANK = Object.freeze({
  offline_queued: 0,
  queued: 0,
  accepted: 2,
  busy_queued: 3,
  steered: 3,
  launch_accepted: 3,
  failed: 4,
  delivered: 5,
  agent_started: 6,
});

const DELIVERY_LIFECYCLE_FIELDS = Object.freeze([
  'status',
  '_queued',
  '_delivered',
  '_agentStarted',
  '_launchAcceptedAt',
  'launch_accepted_at',
  '_deliveryAttempt',
  'delivery_attempt',
  '_sendError',
  'failure_code',
  'failure_reason',
  'failure_native_attempted',
  'failure_retryable',
]);

function clientMessageIdOf(message) {
  const value = message?._cid ?? message?.client_message_id ?? message?.client_msg_id;
  return value == null ? '' : String(value).trim();
}

function deliveryAttemptOf(value) {
  const raw = typeof value === 'object' && value !== null
    ? (value._deliveryAttempt ?? value.delivery_attempt)
    : value;
  const attempt = Number(raw);
  return Number.isInteger(attempt) && attempt >= 1 ? attempt : 0;
}

function deliveryStateOf(message) {
  if (!message || typeof message !== 'object') return '';
  if (message._agentStarted || message.status === 'agent_started') return 'agent_started';
  if (message._delivered || message.status === 'delivered') return 'delivered';
  if (message.status === 'failed' || message._sendError) return 'failed';
  if (message._launchAcceptedAt || message.launch_accepted_at) return 'launch_accepted';
  if (message.status === 'accepted') return 'accepted';
  if (message._queued) return 'busy_queued';
  return '';
}

function shouldAdvanceDeliveryState(currentState, nextState, force = false) {
  if (force || !currentState) return true;
  return (DELIVERY_STATE_RANK[nextState] ?? -1) >= (DELIVERY_STATE_RANK[currentState] ?? -1);
}

function acceptDeliveryAttempt(attempts, clientMessageId, rawAttempt, options = {}) {
  if (!clientMessageId) return { accepted: false, advanced: false, attempt: 0 };
  const current = Math.max(0, Number(attempts[clientMessageId]) || 0);
  const incoming = deliveryAttemptOf(rawAttempt);
  if (!incoming) {
    const accepted = current <= 1 || options.allowMissingCurrent === true;
    return { accepted, advanced: false, attempt: current || 1, legacy: true };
  }
  if (incoming < current) {
    return { accepted: false, advanced: false, attempt: current, legacy: false };
  }
  const advanced = incoming > current;
  if (advanced) attempts[clientMessageId] = incoming;
  return { accepted: true, advanced, attempt: incoming, legacy: false };
}

function normalizeDeliveryMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const clientMessageId = clientMessageIdOf(message);
  const attempt = deliveryAttemptOf(message);
  if (!clientMessageId && !attempt && message.status !== 'failed') return message;
  return {
    ...message,
    ...(clientMessageId ? { _cid: clientMessageId } : {}),
    ...(attempt ? { _deliveryAttempt: attempt } : {}),
    ...(message.status === 'failed' && !message._sendError
      ? { _sendError: message.failure_reason || message.failure_code || 'Send failed' }
      : {}),
  };
}

function preserveLifecycleFields(target, source) {
  const next = { ...target };
  DELIVERY_LIFECYCLE_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source, field)) next[field] = source[field];
    else delete next[field];
  });
  return next;
}

function clearFailureFields(message) {
  return {
    ...message,
    _sendError: null,
    failure_code: null,
    failure_reason: null,
    failure_native_attempted: null,
    failure_retryable: null,
  };
}

function mergeMessageValues(current, incoming) {
  const currentHasCitation = Array.isArray(current?.content_blocks)
    && current.content_blocks.some(block => block?.type === 'memory_citation');
  const incomingHasCitation = Array.isArray(incoming?.content_blocks)
    && incoming.content_blocks.some(block => block?.type === 'memory_citation');
  return currentHasCitation && !incomingHasCitation
    ? { ...current, ...incoming, content: current.content, content_blocks: current.content_blocks }
    : { ...current, ...incoming };
}

function mergeDeliveryMessage(currentValue, incomingValue) {
  const current = normalizeDeliveryMessage(currentValue);
  const incoming = normalizeDeliveryMessage(incomingValue);
  if (!current) return incoming;
  if (!incoming) return current;

  const currentId = clientMessageIdOf(current);
  const incomingId = clientMessageIdOf(incoming);
  if (!currentId || !incomingId || currentId !== incomingId) return mergeMessageValues(current, incoming);

  const currentAttempt = deliveryAttemptOf(current) || 1;
  const incomingAttempt = deliveryAttemptOf(incoming);
  let merged = { ...mergeMessageValues(current, incoming), _cid: currentId };

  if ((!incomingAttempt && currentAttempt > 1) || (incomingAttempt && incomingAttempt < currentAttempt)) {
    return preserveLifecycleFields(merged, current);
  }

  const attemptAdvanced = incomingAttempt > currentAttempt;
  if (!attemptAdvanced) {
    const currentState = deliveryStateOf(current);
    const incomingState = deliveryStateOf(incoming);
    if (currentState && (!incomingState || !shouldAdvanceDeliveryState(currentState, incomingState))) {
      return preserveLifecycleFields(merged, current);
    }
  }

  const incomingState = deliveryStateOf(incoming);
  if (attemptAdvanced || (incomingState && incomingState !== 'failed')) {
    merged = clearFailureFields(merged);
  }
  return merged;
}

function canonicalMessageKey(message) {
  const clientMessageId = clientMessageIdOf(message);
  if (clientMessageId) return `client:${clientMessageId}`;
  if (message?.source_message_id) return `source:${message.source_message_id}`;
  if (message?.native_source_id) return `native:${message.native_source_id}`;
  if (message?.id != null) return `id:${message.id}`;
  if (message?.server_message_id != null) return `server:${message.server_message_id}`;
  if (message?.sequence != null) return `sequence:${message.sequence}`;
  return `content:${message?.role || ''}:${message?.ts || message?.created_at || ''}:${String(message?.content || '')}`;
}

function messageTimeMs(message) {
  const raw = message?.created_at ?? message?.timestamp ?? message?.ts;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeCanonicalDeliveryMessages(values) {
  const merged = [];
  const indexes = new Map();
  (Array.isArray(values) ? values : []).forEach(value => {
    const message = normalizeDeliveryMessage(value);
    const key = canonicalMessageKey(message);
    if (!indexes.has(key)) {
      indexes.set(key, merged.length);
      merged.push(message);
      return;
    }
    const index = indexes.get(key);
    merged[index] = mergeDeliveryMessage(merged[index], message);
  });
  return merged.sort((left, right) => {
    const leftSequence = Number(left?.sequence);
    const rightSequence = Number(right?.sequence);
    if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    return messageTimeMs(left) - messageTimeMs(right);
  });
}

module.exports = {
  DELIVERY_STATE_RANK,
  acceptDeliveryAttempt,
  canonicalMessageKey,
  clientMessageIdOf,
  deliveryAttemptOf,
  deliveryStateOf,
  mergeCanonicalDeliveryMessages,
  mergeDeliveryMessage,
  normalizeDeliveryMessage,
  shouldAdvanceDeliveryState,
};
