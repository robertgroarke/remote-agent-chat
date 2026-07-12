'use strict';

const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'running_command', 'applying_patch',
  'reading_files', 'working',
]);

class SendLifecycleTracker {
  constructor({ now = () => Date.now(), maxPendingMs = 120000, preDeliveryWindowMs = 2000 } = {}) {
    this.now = now;
    this.maxPendingMs = maxPendingMs;
    this.preDeliveryWindowMs = preDeliveryWindowMs;
    this.pending = new Map();
    this.lastActive = new Map();
  }

  markProxyResult(message = {}) {
    const sessionId = message.session_id || message.session;
    const clientMessageId = message.client_message_id;
    if (!sessionId || !clientMessageId) return;
    if (message.result === 'delivered') {
      this.pending.set(sessionId, {
        clientMessageId,
        deliveredAt: message.delivered_at || new Date(this.now()).toISOString(),
        recordedAt: this.now(),
      });
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
}

module.exports = { ACTIVE_ACTIVITY_KINDS, SendLifecycleTracker };
