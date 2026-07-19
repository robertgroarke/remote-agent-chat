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
  maxConsecutiveErrors: 3,
  backoffBaseMs: 30000,
  backoffMaxMs: 300000,
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
  constructor({
    onDirty,
    log = () => {},
    policy = {},
    disabled = process.env.CDP_PUSH_DISABLED === '1',
  }) {
    this.onDirty = onDirty;
    this.log = log;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.disabled = disabled;
    this.states = new Map();
    this.fallbackStates = new Map();
  }

  sessionIds() {
    return new Set([...this.states.keys(), ...this.fallbackStates.keys()]).keys();
  }

  getState(sessionId) {
    const state = this.states.get(sessionId) || this.fallbackStates.get(sessionId);
    if (!state) return null;
    return {
      status: state.status,
      lastPollAt: state.lastPollAt || 0,
      lastSignalAt: state.lastSignalAt || 0,
      consecutiveErrors: state.consecutiveErrors || 0,
      backoffUntil: state.backoffUntil || 0,
      installedContextIds: [...(state.installedContextIds || [])],
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

  async _installInContext(state, contextId, authoritative = true) {
    const result = await state.runtime.evaluate({
      expression: observerExpression(this.policy.bindingName, this.policy.observerKey, state.token),
      returnByValue: true,
      silent: true,
      userGesture: false,
      ...(Number.isInteger(contextId) ? { contextId } : {}),
    });
    const value = result?.result?.value || { ok: false, reason: 'observer_result_missing' };
    if (authoritative) state.status = value.ok ? 'active' : 'fallback';
    if (value.ok) {
      state.installedContextIds.add(Number.isInteger(contextId) ? contextId : null);
      if (authoritative) {
        state.consecutiveErrors = 0;
        state.installedContextId = Number.isInteger(contextId) ? contextId : null;
      }
    }
    return value;
  }

  async _install(state) {
    const contextId = await this._resolveContextId(state.options);
    if (state.options.requireContext === true && !Number.isInteger(contextId)) {
      throw new Error('execution context unavailable');
    }
    return this._installInContext(state, contextId, true);
  }

  _installCreatedContext(state, contextId) {
    if (!Number.isInteger(contextId) || this.states.get(state.sessionId) !== state) return;
    if (state.contextInstallTimers.has(contextId)) clearTimeout(state.contextInstallTimers.get(contextId));
    const timer = setTimeout(() => {
      state.contextInstallTimers.delete(contextId);
      if (this.states.get(state.sessionId) !== state) return;
      this._installInContext(state, contextId, false).catch(error => {
        if (!this._isContextError(error)) {
          this.log('warn', `[${state.sessionId}] DOM push new-context install: ${error.message}`);
        }
      });
    }, Math.max(0, Number(this.policy.reinstallMs) || 0));
    timer.unref?.();
    state.contextInstallTimers.set(contextId, timer);
  }

  _scheduleReinstall(state, delayMs = this.policy.reinstallMs) {
    if (this.states.get(state.sessionId) !== state) return;
    if (state.reinstallTimer) clearTimeout(state.reinstallTimer);
    state.status = 'reinstalling';
    state.reinstallTimer = setTimeout(() => {
      state.reinstallTimer = null;
      this._install(state).catch(async error => {
        const contextError = this._isContextError(error);
        await this._recordRuntimeError(state, error, 'reinstall');
        if (contextError && this.states.get(state.sessionId) === state) {
          const retryDelay = Math.min(
            1000,
            this.policy.reinstallMs * Math.max(1, Number(state.consecutiveErrors || 1)),
          );
          this._scheduleReinstall(state, retryDelay);
        }
      });
    }, Math.max(0, Number(delayMs) || 0));
    state.reinstallTimer.unref?.();
  }

  _isContextError(error) {
    return /context|execution|exception|target closed|session closed|cannot find/i
      .test(String(error?.message || error || ''));
  }

  _backoffDelay(backoffCount) {
    return Math.min(
      this.policy.backoffMaxMs,
      this.policy.backoffBaseMs * (2 ** Math.max(0, backoffCount - 1)),
    );
  }

  async _detachState(sessionId, fallback = null) {
    const state = this.states.get(sessionId);
    if (state) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      if (state.reinstallTimer) clearTimeout(state.reinstallTimer);
      for (const timer of state.contextInstallTimers || []) clearTimeout(timer[1]);
      try { state.disposeBinding?.(); } catch {}
      try { state.disposeContexts?.(); } catch {}
      try { state.disposeContextCreated?.(); } catch {}
      try { state.disposeContextDestroyed?.(); } catch {}
      const contextIds = new Set(state.installedContextIds || []);
      if (contextIds.size === 0) {
        try { contextIds.add(await this._resolveContextId(state.options)); } catch {}
      }
      for (const contextId of contextIds) {
        try {
          await state.runtime.evaluate({
            expression: `(() => { const entry = globalThis[${JSON.stringify(this.policy.observerKey)}]; try { entry?.observer?.disconnect(); } catch {} delete globalThis[${JSON.stringify(this.policy.observerKey)}]; return true; })()`,
            returnByValue: true,
            silent: true,
            userGesture: false,
            ...(Number.isInteger(contextId) ? { contextId } : {}),
          });
        } catch {}
      }
      try { await state.runtime.removeBinding?.({ name: this.policy.bindingName }); } catch {}
      this.states.delete(sessionId);
    }
    if (fallback) this.fallbackStates.set(sessionId, fallback);
    else this.fallbackStates.delete(sessionId);
  }

  async _recordRuntimeError(state, error, phase) {
    if (this.states.get(state.sessionId) !== state) return;
    const message = String(error?.message || error || 'unknown error');
    if (!this._isContextError(error)) {
      this.log('warn', `[${state.sessionId}] DOM push ${phase}: ${message}`);
      return;
    }
    state.consecutiveErrors = Number(state.consecutiveErrors || 0) + 1;
    if (state.consecutiveErrors < this.policy.maxConsecutiveErrors) {
      this.log(
        'warn',
        `[${state.sessionId}] DOM push ${phase} context error ${state.consecutiveErrors}/${this.policy.maxConsecutiveErrors}: ${message}`,
      );
      return;
    }
    const backoffCount = Number(state.backoffCount || 0) + 1;
    const backoffMs = this._backoffDelay(backoffCount);
    const backoffUntil = Date.now() + backoffMs;
    await this._detachState(state.sessionId, {
      status: 'backoff',
      lastPollAt: state.lastPollAt || 0,
      lastActive: state.lastActive,
      lastSignalAt: state.lastSignalAt || 0,
      consecutiveErrors: state.consecutiveErrors,
      backoffCount,
      backoffUntil,
    });
    this.log(
      'warn',
      `[${state.sessionId}] DOM push auto-uninstalled after repeated ${phase} context errors; adaptive polling retained for ${backoffMs}ms`,
    );
  }

  _queueDispatch(state, payload) {
    state.pendingEvent = payload;
    // Bound first-observation latency during continuous DOM mutation storms.
    // Resetting a trailing debounce here lets animated request cards postpone
    // their first poll indefinitely; retain the latest payload but keep the
    // original deadline once a dispatch window has started.
    if (state.debounceTimer) return;
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this._dispatch(state).catch(error => {
        this._recordRuntimeError(state, error, 'dispatch').catch(() => {});
      });
    }, this.policy.debounceMs);
  }

  async _dispatch(state) {
    if (this.states.get(state.sessionId) !== state) return;
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
        cdpToQueueMs: Math.max(0, Number(payload.proxy_received_at || receivedAt) - Number(payload.source_at || receivedAt)),
        queueToDispatchMs: Math.max(0, receivedAt - Number(payload.proxy_received_at || receivedAt)),
      });
      state.consecutiveErrors = 0;
    } finally {
      state.inFlight = false;
      if (this.states.get(state.sessionId) === state && (state.queuedEvent || state.pendingEvent)) {
        await this._dispatch(state);
      }
    }
  }

  async attach(sessionId, client, options = {}) {
    if (this.disabled) {
      await this._detachState(sessionId, {
        ...(this.fallbackStates.get(sessionId) || {}),
        status: 'disabled',
      });
      return { ok: false, reason: 'disabled' };
    }
    const fallback = this.fallbackStates.get(sessionId);
    if (Number(fallback?.backoffUntil || 0) > Date.now()) {
      return { ok: false, reason: 'backoff', retryAt: fallback.backoffUntil };
    }
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
      installedContextIds: new Set(),
      contextInstallTimers: new Map(),
      disposeBinding: null,
      disposeContexts: null,
      disposeContextCreated: null,
      disposeContextDestroyed: null,
      consecutiveErrors: 0,
      backoffCount: Number(fallback?.backoffCount || 0),
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
        this._queueDispatch(state, {
          ...payload,
          proxy_received_at: Date.now(),
          executionContextId: Number.isInteger(event.executionContextId)
            ? event.executionContextId
            : null,
        });
      });
      if (typeof runtime.executionContextsCleared === 'function') {
        state.disposeContexts = runtime.executionContextsCleared(() => {
          state.installedContextId = null;
          state.installedContextIds.clear();
          this._scheduleReinstall(state);
        });
      }
      if (typeof runtime.executionContextDestroyed === 'function') {
        state.disposeContextDestroyed = runtime.executionContextDestroyed(event => {
          const contextId = Number(event?.executionContextId);
          state.installedContextIds.delete(contextId);
          if (contextId !== Number(state.installedContextId)) return;
          state.installedContextId = null;
          this._scheduleReinstall(state);
        });
      }
      if (typeof runtime.executionContextCreated === 'function') {
        state.disposeContextCreated = runtime.executionContextCreated(event => {
          const contextId = Number(event?.context?.id);
          this._installCreatedContext(state, contextId);
          if (state.status !== 'active') this._scheduleReinstall(state);
        });
      }
      const installed = await this._install(state);
      if (!installed.ok) throw new Error(installed.reason || 'observer injection failed');
      return installed;
    } catch (error) {
      const contextError = this._isContextError(error);
      const consecutiveErrors = contextError ? Number(fallback?.consecutiveErrors || 0) + 1 : 0;
      const backoffCount = Number(fallback?.backoffCount || 0)
        + (consecutiveErrors >= this.policy.maxConsecutiveErrors ? 1 : 0);
      const backoffMs = backoffCount > Number(fallback?.backoffCount || 0)
        ? this._backoffDelay(backoffCount)
        : 0;
      await this._detachState(sessionId, {
        status: backoffMs ? 'backoff' : 'fallback',
        lastPollAt: state.lastPollAt || 0,
        consecutiveErrors,
        backoffCount,
        backoffUntil: backoffMs ? Date.now() + backoffMs : 0,
      });
      if (consecutiveErrors <= 1 || backoffMs) {
        this.log('warn', `[${sessionId}] DOM push unavailable; adaptive polling retained${backoffMs ? ` for ${backoffMs}ms` : ''}: ${error.message}`);
      }
      return { ok: false, reason: error.message };
    }
  }

  async detach(sessionId) {
    await this._detachState(sessionId);
  }

  async close() {
    for (const sessionId of [...this.states.keys()]) await this.detach(sessionId);
    this.fallbackStates.clear();
  }
}

module.exports = { CdpDomPushManager, observerExpression, DEFAULT_POLICY };
