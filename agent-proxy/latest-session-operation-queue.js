'use strict';

/**
 * Serializes stateful native operations per session while retaining only the
 * newest operation that has not started yet. Different sessions remain fully
 * independent. This prevents slow native navigation from completing out of
 * order without allowing an abandoned queue to grow during rapid UI input.
 */
class LatestSessionOperationQueue {
  constructor(options = {}) {
    this._states = new Map();
    this._onSupersede = typeof options.onSupersede === 'function'
      ? options.onSupersede
      : () => {};
    this._onError = typeof options.onError === 'function'
      ? options.onError
      : () => {};
  }

  enqueue(sessionId, metadata, task) {
    if (!sessionId || typeof task !== 'function') {
      return Promise.reject(new TypeError('sessionId and task are required'));
    }

    let state = this._states.get(sessionId);
    if (!state) {
      state = { running: false, pending: null };
      this._states.set(sessionId, state);
    }

    return new Promise(resolve => {
      const operation = { metadata, task, resolve };
      if (state.pending) {
        const superseded = state.pending;
        state.pending = null;
        try {
          this._onSupersede(superseded.metadata, metadata);
        } catch (error) {
          this._onError(error, superseded.metadata);
        }
        superseded.resolve({ superseded: true });
      }
      state.pending = operation;
      if (!state.running) void this._drain(sessionId, state);
    });
  }

  get size() {
    return this._states.size;
  }

  async _drain(sessionId, state) {
    state.running = true;
    while (state.pending) {
      const operation = state.pending;
      state.pending = null;
      try {
        const value = await operation.task();
        operation.resolve({ superseded: false, value });
      } catch (error) {
        try {
          this._onError(error, operation.metadata);
        } catch {}
        operation.resolve({ superseded: false, error });
      }
    }
    state.running = false;
    if (this._states.get(sessionId) === state && !state.pending) {
      this._states.delete(sessionId);
    }
  }
}

module.exports = { LatestSessionOperationQueue };
