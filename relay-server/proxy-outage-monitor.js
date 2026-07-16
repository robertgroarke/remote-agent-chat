'use strict';

class ProxyOutageMonitor {
  constructor({
    graceMs = 120_000,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onOffline = () => {},
    onRecovered = () => {},
  } = {}) {
    if (!Number.isFinite(graceMs) || graceMs < 1) throw new Error('graceMs must be positive');
    this.graceMs = graceMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onOffline = onOffline;
    this.onRecovered = onRecovered;
    this.hasSeenProxy = false;
    this.missingSince = null;
    this.incidentId = null;
    this.notified = false;
    this.timer = null;
  }

  observe(connectionCount) {
    const count = Math.max(0, Number(connectionCount) || 0);
    const now = this.now();
    if (count > 0) {
      this.hasSeenProxy = true;
      if (this.timer) this.clearTimer(this.timer);
      this.timer = null;
      if (this.notified) {
        this.onRecovered({
          incident_id: this.incidentId,
          missing_since: new Date(this.missingSince).toISOString(),
          recovered_at: new Date(now).toISOString(),
          missing_ms: Math.max(0, now - this.missingSince),
          proxy_connections: count,
        });
      }
      this.missingSince = null;
      this.incidentId = null;
      this.notified = false;
      return 'healthy';
    }

    if (!this.hasSeenProxy) return 'waiting_for_first_proxy';
    if (this.missingSince == null) {
      this.missingSince = now;
      this.incidentId = `proxy-${now}`;
      this.timer = this.setTimer(() => this._expire(), this.graceMs);
      this.timer?.unref?.();
    }
    return this.notified ? 'offline' : 'grace';
  }

  _expire() {
    this.timer = null;
    if (this.missingSince == null || this.notified) return;
    const now = this.now();
    const elapsed = now - this.missingSince;
    if (elapsed < this.graceMs) {
      this.timer = this.setTimer(() => this._expire(), this.graceMs - elapsed);
      this.timer?.unref?.();
      return;
    }
    this.notified = true;
    this.onOffline({
      incident_id: this.incidentId,
      missing_since: new Date(this.missingSince).toISOString(),
      detected_at: new Date(now).toISOString(),
      missing_ms: Math.max(0, elapsed),
      proxy_connections: 0,
    });
  }

  snapshot() {
    return {
      has_seen_proxy: this.hasSeenProxy,
      state: this.notified ? 'offline' : (this.missingSince == null ? 'healthy' : 'grace'),
      incident_id: this.incidentId,
      missing_since: this.missingSince == null ? null : new Date(this.missingSince).toISOString(),
      notified: this.notified,
      grace_ms: this.graceMs,
    };
  }
}

module.exports = { ProxyOutageMonitor };
