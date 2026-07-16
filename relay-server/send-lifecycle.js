'use strict';

const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'running_command', 'applying_patch',
  'reading_files', 'working',
]);

class SendLifecycleTracker {
  constructor({ now = () => Date.now(), maxPendingMs = 120000, preDeliveryWindowMs = 2000, maxSessions = 2048 } = {}) {
    this.now = now;
    this.maxPendingMs = maxPendingMs;
    this.preDeliveryWindowMs = preDeliveryWindowMs;
    this.maxSessions = Math.max(16, Number(maxSessions) || 2048);
    this.pending = new Map();
    this.lastActive = new Map();
  }

  markProxyResult(message = {}) {
    const sessionId = message.session_id || message.session;
    const clientMessageId = message.client_message_id;
    if (!sessionId || !clientMessageId) return;
    if (message.result === 'delivered') {
      // Native-receipt-managed producers emit their own agent_started event
      // only after a later native event. Relay activity is not authoritative
      // enough to derive that transition for those sends.
      if (message.lifecycle === 'native_user_turn_observed' || message.native_receipt) {
        const current = this.pending.get(sessionId);
        if (!current || current.clientMessageId === clientMessageId) this.pending.delete(sessionId);
        return null;
      }
      this.pending.set(sessionId, {
        clientMessageId,
        deliveredAt: message.delivered_at || new Date(this.now()).toISOString(),
        recordedAt: this.now(),
      });
      this._bound(this.pending);
      const recent = this.lastActive.get(sessionId);
      if (recent && this.now() - recent.recordedAt <= this.preDeliveryWindowMs) {
        return this.consumeActivity(recent.message);
      }
    } else if (message.result === 'failed') {
      const current = this.pending.get(sessionId);
      if (!current || current.clientMessageId === clientMessageId) this.pending.delete(sessionId);
    }
  }

  consumeActivity(message = {}) {
    const sessionId = message.session_id || message.session;
    const activityKind = typeof message.activity === 'object'
      ? message.activity?.kind
      : message.activity;
    const active = message.thinking || ACTIVE_ACTIVITY_KINDS.has(activityKind);
    if (!active) {
      if (activityKind === 'idle') this.lastActive.delete(sessionId);
      return null;
    }
    this.lastActive.set(sessionId, { message, recordedAt: this.now() });
    this._bound(this.lastActive);
    const pending = this.pending.get(sessionId);
    if (!pending) return null;
    if (this.now() - pending.recordedAt > this.maxPendingMs) {
      this.pending.delete(sessionId);
      return null;
    }
    this.pending.delete(sessionId);
    return {
      type: 'agent_started',
      protocol_version: 1,
      session_id: sessionId,
      client_message_id: pending.clientMessageId,
      delivered_at: pending.deliveredAt,
      started_at: message.activity?.started_at || new Date(this.now()).toISOString(),
      activity: typeof message.activity === 'object'
        ? message.activity
        : { kind: activityKind || 'working' },
    };
  }

  clearSession(sessionId) {
    this.pending.delete(sessionId);
    this.lastActive.delete(sessionId);
  }

  _bound(map) {
    while (map.size > this.maxSessions) map.delete(map.keys().next().value);
  }

  prune(nowMs = this.now()) {
    for (const [sessionId, state] of this.pending) {
      if (nowMs - state.recordedAt > this.maxPendingMs) this.pending.delete(sessionId);
    }
    for (const [sessionId, state] of this.lastActive) {
      if (nowMs - state.recordedAt > this.maxPendingMs) this.lastActive.delete(sessionId);
    }
  }
}

module.exports = { ACTIVE_ACTIVITY_KINDS, SendLifecycleTracker };
