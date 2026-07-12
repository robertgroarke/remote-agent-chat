'use strict';

const crypto = require('crypto');

const DEFAULT_POLICY = Object.freeze({
  bindingName: '__racDomChanged',
  observerKey: '__racDomObserver',
  debounceMs: 50,
  reinstallMs: 100,
  observerWorkingFallbackMs: 5000,
  observerIdleFallbackMs: 30000,
  unavailableWorkingFallbackMs: 750,
  unavailableIdleFallbackMs: 5000,
});

function observerExpression(bindingName, observerKey, token) {
  return `(() => {
    const bindingName = ${JSON.stringify(bindingName)};
    const observerKey = ${JSON.stringify(observerKey)};
    const token = ${JSON.stringify(token)};
    const existing = globalThis[observerKey];
    if (token === ${JSON.stringify(token)} && existing && existing.token === token) {
      return { ok: true, reused: true };
    }
    try { existing?.observer?.disconnect(); } catch {}
    if (typeof MutationObserver !== 'function' || !document?.documentElement) {
      return { ok: false, reason: 'mutation_observer_unavailable' };
    }
    let sequence = 0;
    const notify = () => {
      try {
        globalThis[bindingName](JSON.stringify({
          token,
          sequence: ++sequence,
          source_at: Date.now()
        }));
      } catch {}
    };
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'aria-label', 'class', 'data-state']
    });
    globalThis[observerKey] = { token, observer };
    return { ok: true, reused: false };
  })()`;
}

class CdpDomPushManager {
  constructor({ onDirty, log = () => {}, policy = {} }) {
    this.onDirty = onDirty;
    this.log = log;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.states = new Map();
    this.fallbackStates = new Map();
  }

  sessionIds() {
    return this.states.keys();
  }

  getState(sessionId) {
    const state = this.states.get(sessionId);
    if (!state) return null;
    return {
      status: state.status,
      lastPollAt: state.lastPollAt || 0,
      lastSignalAt: state.lastSignalAt || 0,
    };
  }

  notePoll(sessionId, session, now = Date.now()) {
    const state = this.states.get(sessionId) || this.fallbackStates.get(sessionId) || {};
    state.lastPollAt = now;
    state.lastActive = session?.activity?.kind === 'generating' || session?.activity?.kind === 'thinking';
    if (this.states.has(sessionId)) this.states.set(sessionId, state);
    else this.fallbackStates.set(sessionId, state);
  }

  shouldRunFallback(sessionId, session, now = Date.now()) {
    const active = session?.activity?.kind === 'generating' || session?.activity?.kind === 'thinking';
    const attached = this.states.get(sessionId);
    const interval = attached
      ? (active ? this.policy.observerWorkingFallbackMs : this.policy.observerIdleFallbackMs)
      : (active ? this.policy.unavailableWorkingFallbackMs : this.policy.unavailableIdleFallbackMs);
    let state = attached || this.fallbackStates.get(sessionId);
    if (!state) {
      state = { lastPollAt: now - interval + 1 };
      this.fallbackStates.set(sessionId, state);
    }
    return now - Number(state.lastPollAt || 0) >= interval;
  }

  async _resolveContextId(options) {
    if (Number.isInteger(options.contextId)) return options.contextId;
    if (typeof options.resolveContextId !== 'function') return null;
    try { return await options.resolveContextId(); } catch { return null; }
  }

  async _install(state) {
    const contextId = await this._resolveContextId(state.options);
    const result = await state.runtime.evaluate({
      expression: observerExpression(this.policy.bindingName, this.policy.observerKey, state.token),
      returnByValue: true,
      silent: true,
      userGesture: false,
      ...(Number.isInteger(contextId) ? { contextId } : {}),
    });
    const value = result?.result?.value || { ok: false, reason: 'observer_result_missing' };
    state.status = value.ok ? 'active' : 'fallback';
    return value;
  }

  _queueDispatch(state, payload) {
    state.pendingEvent = payload;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this._dispatch(state).catch(error => {
        this.log('warn', `[${state.sessionId}] DOM push dispatch: ${error.message}`);
      });
    }, this.policy.debounceMs);
  }

  async _dispatch(state) {
    if (state.inFlight) {
      state.queuedEvent = state.pendingEvent || state.queuedEvent;
      state.pendingEvent = null;
      return;
    }
    const payload = state.pendingEvent || state.queuedEvent;
    state.pendingEvent = null;
    state.queuedEvent = null;
    if (!payload) return;
    state.inFlight = true;
    const receivedAt = Date.now();
    state.lastSignalAt = receivedAt;
    try {
      await this.onDirty(state.sessionId, {
        ...payload,
        source: 'cdp_mutation_binding',
        sourceAt: Number(payload.source_at || receivedAt),
        receivedAt,
        bindingToProxyMs: Math.max(0, receivedAt - Number(payload.source_at || receivedAt)),
      });
    } finally {
      state.inFlight = false;
      if (state.queuedEvent || state.pendingEvent) await this._dispatch(state);
    }
  }

  async attach(sessionId, client, options = {}) {
    const runtime = client?.Runtime;
    if (!runtime?.addBinding || !runtime?.evaluate || !runtime?.bindingCalled) {
      this.fallbackStates.set(sessionId, this.fallbackStates.get(sessionId) || {});
      return { ok: false, reason: 'binding_unavailable' };
    }
    const existing = this.states.get(sessionId);
    if (existing?.client === client) return { ok: true, reused: true };
    if (existing) await this.detach(sessionId);
    const state = {
      sessionId,
      client,
      runtime,
      options,
      token: crypto.randomBytes(16).toString('hex'),
      status: 'installing',
      lastPollAt: this.fallbackStates.get(sessionId)?.lastPollAt || 0,
      lastSignalAt: 0,
      debounceTimer: null,
      reinstallTimer: null,
      inFlight: false,
      pendingEvent: null,
      queuedEvent: null,
      disposeBinding: null,
      disposeContexts: null,
    };
    this.fallbackStates.delete(sessionId);
    this.states.set(sessionId, state);
    try {
      await runtime.addBinding({ name: this.policy.bindingName });
      state.disposeBinding = runtime.bindingCalled(event => {
        if (event?.name !== this.policy.bindingName) return;
        let payload;
        try { payload = JSON.parse(event.payload || '{}'); } catch { return; }
        if (payload.token !== state.token) return;
        this._queueDispatch(state, payload);
      });
      if (typeof runtime.executionContextsCleared === 'function') {
        state.disposeContexts = runtime.executionContextsCleared(() => {
          if (state.reinstallTimer) clearTimeout(state.reinstallTimer);
          state.reinstallTimer = setTimeout(() => {
            state.reinstallTimer = null;
            this._install(state).catch(error => {
              state.status = 'fallback';
              this.log('warn', `[${sessionId}] DOM observer reinstall: ${error.message}`);
            });
          }, this.policy.reinstallMs);
        });
      }
      const installed = await this._install(state);
      if (!installed.ok) throw new Error(installed.reason || 'observer injection failed');
      return installed;
    } catch (error) {
      await this.detach(sessionId);
      this.log('warn', `[${sessionId}] DOM push unavailable; adaptive polling retained: ${error.message}`);
      return { ok: false, reason: error.message };
    }
  }

  async detach(sessionId) {
    const state = this.states.get(sessionId);
    if (!state) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    if (state.reinstallTimer) clearTimeout(state.reinstallTimer);
    try { state.disposeBinding?.(); } catch {}
    try { state.disposeContexts?.(); } catch {}
    try {
      const contextId = await this._resolveContextId(state.options);
      await state.runtime.evaluate({
        expression: `(() => { const entry = globalThis[${JSON.stringify(this.policy.observerKey)}]; try { entry?.observer?.disconnect(); } catch {} delete globalThis[${JSON.stringify(this.policy.observerKey)}]; return true; })()`,
        returnByValue: true,
        silent: true,
        userGesture: false,
        ...(Number.isInteger(contextId) ? { contextId } : {}),
      });
    } catch {}
    try { await state.runtime.removeBinding?.({ name: this.policy.bindingName }); } catch {}
    this.states.delete(sessionId);
    this.fallbackStates.delete(sessionId);
  }

  async close() {
    for (const sessionId of [...this.states.keys()]) await this.detach(sessionId);
    this.fallbackStates.clear();
  }
}

module.exports = { CdpDomPushManager, observerExpression, DEFAULT_POLICY };
