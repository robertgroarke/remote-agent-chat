'use strict';

const { UsageThresholdTracker } = require('./usage-thresholds');

function sessionType(meta) {
  return String(meta?.agent_type || meta?.agentType || '');
}

function matchingSessionIds(snapshot, sessionMetas, allowedSessionIds = null) {
  const types = new Set(Array.isArray(snapshot?.mapped_harness_types) ? snapshot.mapped_harness_types : []);
  if (types.size === 0) return [];
  const allowed = allowedSessionIds instanceof Set ? allowedSessionIds : null;
  const matches = [];
  for (const [sessionId, meta] of sessionMetas || []) {
    if (allowed && !allowed.has(sessionId)) continue;
    if (types.has(sessionType(meta))) matches.push(sessionId);
  }
  return matches.sort();
}

function accountIdentity(snapshot) {
  return [snapshot?.provider_id, snapshot?.account_fingerprint, snapshot?.quota_domain]
    .map(value => String(value || 'unknown'))
    .join(':');
}

function windowCycleKey(snapshot, window) {
  return [
    accountIdentity(snapshot),
    String(window?.id || window?.label || 'window'),
    String(window?.resets_at || window?.reset_description || 'open-cycle'),
  ].join(':');
}

class ProviderUsageAuthority {
  constructor(options = {}) {
    this.thresholds = options.thresholds || new UsageThresholdTracker();
    this.cyclesByIdentity = new Map();
    this.authorityBySession = new Map();
    this.maxIdentities = Math.max(8, Number(options.maxIdentities) || 128);
  }

  observe(payload, sessionMetas, allowedSessionIds = null, nowMs = Date.now()) {
    const alerts = [];
    const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    for (const snapshot of snapshots) {
      const identity = accountIdentity(snapshot);
      const affectedSessionIds = matchingSessionIds(snapshot, sessionMetas, allowedSessionIds);
      const authorityUntil = Date.parse(snapshot?.stale_after || '');
      const authoritative = ['fresh', 'refreshing'].includes(snapshot?.status)
        && Number.isFinite(authorityUntil)
        && authorityUntil > nowMs;
      for (const sessionId of affectedSessionIds) {
        if (authoritative) {
          this.authorityBySession.set(sessionId, { identity, until: authorityUntil });
        } else if (this.authorityBySession.get(sessionId)?.identity === identity) {
          this.authorityBySession.delete(sessionId);
        }
      }

      const nextCycles = new Set();
      for (const window of Array.isArray(snapshot?.windows) ? snapshot.windows : []) {
        const percentUsed = Number(window?.used_percent);
        if (!Number.isFinite(percentUsed)) continue;
        const cycleKey = windowCycleKey(snapshot, window);
        nextCycles.add(cycleKey);
        if (snapshot.status !== 'fresh') continue;
        const hardLimited = percentUsed >= 100;
        const threshold = this.thresholds.observe(cycleKey, {
          percentUsed,
          hardLimited,
          thresholds: window.thresholds,
        });
        if (threshold == null) continue;
        alerts.push({
          identity,
          cycleKey,
          threshold,
          warningThreshold: Number(window?.thresholds?.warning_percent) || 80,
          criticalThreshold: Number(window?.thresholds?.critical_percent) || 90,
          hardLimited,
          percentUsed,
          resetHint: window.resets_at || window.reset_description || null,
          windowId: window.id || null,
          windowLabel: window.label || 'Usage',
          providerId: snapshot.provider_id,
          providerName: snapshot.provider_name || snapshot.provider_id || 'Provider',
          accountLabel: snapshot.account_label || 'Local account',
          affectedSessionIds,
        });
      }
      const previousCycles = this.cyclesByIdentity.get(identity) || new Set();
      for (const cycleKey of previousCycles) {
        if (!nextCycles.has(cycleKey)) this.thresholds.clear(cycleKey);
      }
      if (this.cyclesByIdentity.has(identity)) this.cyclesByIdentity.delete(identity);
      this.cyclesByIdentity.set(identity, nextCycles);
      while (this.cyclesByIdentity.size > this.maxIdentities) {
        const oldestIdentity = this.cyclesByIdentity.keys().next().value;
        const oldCycles = this.cyclesByIdentity.get(oldestIdentity) || [];
        for (const cycleKey of oldCycles) this.thresholds.clear(cycleKey);
        this.cyclesByIdentity.delete(oldestIdentity);
      }
    }
    return alerts;
  }

  isAuthoritative(sessionId, nowMs = Date.now()) {
    const authority = this.authorityBySession.get(sessionId);
    if (!authority) return false;
    if (authority.until <= nowMs) {
      this.authorityBySession.delete(sessionId);
      return false;
    }
    return true;
  }

  clearSession(sessionId) {
    this.authorityBySession.delete(sessionId);
  }
}

module.exports = {
  ProviderUsageAuthority,
  accountIdentity,
  matchingSessionIds,
  windowCycleKey,
};
