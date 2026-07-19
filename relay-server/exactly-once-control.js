'use strict';

const crypto = require('crypto');

// Keeps a native control operation single-shot even when two authenticated
// clients submit the same generation concurrently. The relay owns the claim;
// the proxy sees one upstream request and every waiter receives a correlated
// copy of the exact native receipt.
class ExactlyOnceControlRegistry {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.ttlMs = Math.max(1_000, Number(options.ttlMs) || 30_000);
    this.maxEntries = Math.max(16, Number(options.maxEntries) || 2_048);
    this.activeByKey = new Map();
    this.activeByUpstream = new Map();
    this.completedByKey = new Map();
  }

  _prune() {
    const now = this.now();
    for (const [key, completed] of this.completedByKey) {
      if (completed.expiresAt <= now) this.completedByKey.delete(key);
    }
    while (this.completedByKey.size > this.maxEntries) {
      this.completedByKey.delete(this.completedByKey.keys().next().value);
    }
  }

  claim({ key, requestId, client, context = null }) {
    this._prune();
    if (!key || !requestId || !client) throw new Error('control_claim_invalid');
    const completed = this.completedByKey.get(key);
    if (completed) {
      return {
        state: 'replay',
        receipt: { ...completed.receipt, request_id: requestId, replayed: true },
      };
    }
    const existing = this.activeByKey.get(key);
    if (existing) {
      existing.waiters.set(requestId, { requestId, client });
      return { state: 'coalesced', upstreamRequestId: existing.upstreamRequestId };
    }
    const upstreamRequestId = `control-${this.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const entry = {
      key,
      upstreamRequestId,
      context,
      createdAt: this.now(),
      waiters: new Map([[requestId, { requestId, client }]]),
    };
    this.activeByKey.set(key, entry);
    this.activeByUpstream.set(upstreamRequestId, entry);
    return { state: 'claimed', upstreamRequestId, entry };
  }

  resolve(upstreamRequestId, receipt) {
    const entry = this.activeByUpstream.get(upstreamRequestId);
    if (!entry) return null;
    this.activeByUpstream.delete(upstreamRequestId);
    this.activeByKey.delete(entry.key);
    const canonicalReceipt = { ...receipt, request_id: upstreamRequestId };
    this.completedByKey.set(entry.key, {
      receipt: canonicalReceipt,
      expiresAt: this.now() + this.ttlMs,
    });
    this._prune();
    return {
      context: entry.context,
      deliveries: [...entry.waiters.values()].map(waiter => ({
        client: waiter.client,
        receipt: { ...canonicalReceipt, request_id: waiter.requestId },
      })),
    };
  }

  abandonClient(client) {
    for (const entry of this.activeByKey.values()) {
      for (const [requestId, waiter] of entry.waiters) {
        if (waiter.client === client) entry.waiters.delete(requestId);
      }
    }
  }
}

module.exports = { ExactlyOnceControlRegistry };
