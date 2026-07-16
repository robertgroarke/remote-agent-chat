function sessionIdOf(session) {
  return typeof session === 'string' ? session : (session?.session_id || session?.id || '');
}
export function sessionPinOrder(preference) {
  const value = Number(preference?.pin_order);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function sessionIsPinned(preference) {
  return preference?.pinned === true || sessionPinOrder(preference) > 0;
}

export function partitionPinnedSessions(sessions, preferences = {}) {
  const pinned = [];
  const unpinned = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = sessionIdOf(session);
    const preference = id ? preferences[id] : null;
    if (sessionIsPinned(preference)) {
      pinned.push({ session, id, order: sessionPinOrder(preference) });
    } else {
      unpinned.push(session);
    }
  }
  pinned.sort((left, right) => (
    (left.order || Number.MAX_SAFE_INTEGER) - (right.order || Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
  ));
  return {
    pinned: pinned.map(entry => entry.session),
    unpinned,
  };
}
