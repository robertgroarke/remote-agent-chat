'use strict';

const DEFAULT_MAX_ENTRIES = 4096;
const EPOCHS_PER_MILLISECOND = 1000;

function normalizeNavigationEpoch(value) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) return 0;
  return epoch;
}

function navigationSessionId(message) {
  return String(
    message?.navigation_session_id
    || message?.session_id
    || message?.session
    || '',
  );
}

function evaluateNavigationMessage(registry, message) {
  const sessionId = navigationSessionId(message);
  const decision = registry.observe(sessionId, message?.navigation_epoch);
  if (decision.accepted) return { accepted: true, decision, message };
  if (message?.type !== 'agent_control_result') {
    return { accepted: false, decision, message };
  }
  return {
    accepted: true,
    decision,
    message: {
      ...message,
      result: 'failed',
      error: {
        code: 'operation_superseded',
        message: 'A newer navigation selection replaced this result.',
      },
      navigation_epoch: decision.latest,
      superseded_navigation_epoch: decision.epoch,
    },
  };
}

class NavigationEpochRegistry {
  constructor(options = {}) {
    this._maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
    this._now = typeof options.now === 'function' ? options.now : Date.now;
    this._latestBySession = new Map();
  }

  get size() {
    return this._latestBySession.size;
  }

  latest(sessionId) {
    return this._latestBySession.get(String(sessionId || '')) || 0;
  }

  issue(sessionId) {
    const key = String(sessionId || '');
    if (!key) return 0;
    const wallClockEpoch = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(1, Math.trunc(Number(this._now()) || 0)) * EPOCHS_PER_MILLISECOND,
    );
    const epoch = Math.max(this.latest(key) + 1, wallClockEpoch);
    this._remember(key, epoch);
    return epoch;
  }

  observe(sessionId, value) {
    const key = String(sessionId || '');
    const epoch = normalizeNavigationEpoch(value);
    if (!key || !epoch) {
      return { accepted: true, stale: false, epoch: 0, latest: this.latest(key) };
    }
    const latest = this.latest(key);
    if (epoch < latest) return { accepted: false, stale: true, epoch, latest };
    this._remember(key, epoch);
    return { accepted: true, stale: false, epoch, latest: Math.max(latest, epoch) };
  }

  delete(sessionId) {
    return this._latestBySession.delete(String(sessionId || ''));
  }

  _remember(key, epoch) {
    this._latestBySession.delete(key);
    this._latestBySession.set(key, epoch);
    while (this._latestBySession.size > this._maxEntries) {
      this._latestBySession.delete(this._latestBySession.keys().next().value);
    }
  }
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  NavigationEpochRegistry,
  evaluateNavigationMessage,
  navigationSessionId,
  normalizeNavigationEpoch,
};
