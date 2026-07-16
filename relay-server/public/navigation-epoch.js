export const NAVIGATION_EPOCH_MAX_ENTRIES = 512;

export function normalizeNavigationEpoch(value) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) return 0;
  return epoch;
}

export function navigationSessionId(message) {
  return String(
    message?.navigation_session_id
    || message?.session_id
    || message?.session
    || '',
  );
}

export function createNavigationEpochGate(options = {}) {
  const maxEntries = Math.max(
    1,
    Number(options.maxEntries) || NAVIGATION_EPOCH_MAX_ENTRIES,
  );
  const latestBySession = new Map();

  function remember(sessionId, epoch) {
    latestBySession.delete(sessionId);
    latestBySession.set(sessionId, epoch);
    while (latestBySession.size > maxEntries) {
      latestBySession.delete(latestBySession.keys().next().value);
    }
  }

  return {
    accept(message) {
      const sessionId = navigationSessionId(message);
      const epoch = normalizeNavigationEpoch(message?.navigation_epoch);
      if (!sessionId || !epoch) return true;
      const latest = latestBySession.get(sessionId) || 0;
      if (epoch < latest) return false;
      remember(sessionId, epoch);
      return true;
    },
    latest(sessionId) {
      return latestBySession.get(String(sessionId || '')) || 0;
    },
    get size() {
      return latestBySession.size;
    },
  };
}
