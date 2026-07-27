export const SESSION_HYDRATION_TIMEOUT_MS = 15_000;

function finiteNow(nowMs) {
  return Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
}

export function createSessionHydrationState(nowMs = Date.now(), attempt = 1) {
  const startedAtMs = finiteNow(nowMs);
  return {
    phase: 'connecting',
    attempt: Math.max(1, Number(attempt) || 1),
    connected: false,
    sessionCount: null,
    startedAtMs,
    deadlineAtMs: startedAtMs + SESSION_HYDRATION_TIMEOUT_MS,
    reason: null,
  };
}

export function advanceSessionHydration(previous, event, nowMs = Date.now()) {
  const state = previous && typeof previous === 'object'
    ? previous : createSessionHydrationState(nowMs);
  const atMs = finiteNow(nowMs);
  const type = String(event?.type || '');

  if (type === 'retry') {
    return createSessionHydrationState(atMs, Number(state.attempt || 0) + 1);
  }
  if (type === 'socket_open') {
    if (state.phase === 'ready') return state;
    return {
      ...state,
      phase: 'awaiting_sessions',
      connected: true,
      reason: null,
    };
  }
  if (type === 'inventory') {
    const sessionCount = Math.max(0, Number(event.sessionCount) || 0);
    return {
      ...state,
      phase: 'ready',
      connected: true,
      sessionCount,
      reason: null,
      completedAtMs: atMs,
    };
  }
  if (type === 'disconnect') {
    return {
      ...state,
      phase: 'offline',
      connected: false,
      reason: String(event.reason || 'relay_disconnected'),
    };
  }
  if (type === 'timeout') {
    if (state.phase === 'ready' || atMs < Number(state.deadlineAtMs || 0)) return state;
    return {
      ...state,
      phase: 'timed_out',
      reason: state.connected ? 'session_inventory_timeout' : 'relay_connection_timeout',
    };
  }
  return state;
}

export function sessionHydrationPresentation(state) {
  const phase = String(state?.phase || 'connecting');
  if (phase === 'ready') {
    return {
      loading: false,
      retryable: false,
      title: 'Sessions ready',
      detail: `${Math.max(0, Number(state?.sessionCount) || 0)} sessions received.`,
    };
  }
  if (phase === 'offline') {
    return {
      loading: false,
      retryable: true,
      title: 'Relay disconnected',
      detail: 'Authentication is present, but the relay connection closed before the session list arrived.',
    };
  }
  if (phase === 'timed_out') {
    const connected = state?.connected === true;
    return {
      loading: false,
      retryable: true,
      title: connected ? 'Session list did not arrive' : 'Relay connection timed out',
      detail: connected
        ? 'Authenticated and connected, but still awaiting the authoritative session inventory.'
        : 'Authentication is present, but the relay connection did not become ready.',
    };
  }
  if (phase === 'awaiting_sessions') {
    return {
      loading: true,
      retryable: false,
      title: 'Connected to relay',
      detail: 'Authenticated; awaiting the authoritative session inventory.',
    };
  }
  return {
    loading: true,
    retryable: false,
    title: 'Connecting to relay',
    detail: 'Authentication is present; establishing the session connection.',
  };
}
