export function createStateSequenceGate() {
  const latestByKey = new Map();
  const maxKeys = 2048;
  let relayEpoch = '';

  return {
    reset(nextEpoch = '') {
      const normalized = String(nextEpoch || '');
      if (normalized === relayEpoch) return;
      relayEpoch = normalized;
      latestByKey.clear();
    },

    accept(message, key) {
      const seq = Number(message?.state_seq);
      if (!Number.isSafeInteger(seq) || seq < 0) return true;
      const epoch = String(message?.state_epoch || relayEpoch || 'legacy');
      if (relayEpoch && epoch !== relayEpoch) return false;
      if (!relayEpoch) {
        relayEpoch = epoch;
      }
      const normalizedKey = String(key || message?.type || 'state');
      const previous = latestByKey.get(normalizedKey);
      if (previous?.epoch === epoch && seq <= previous.seq) return false;
      if (latestByKey.has(normalizedKey)) latestByKey.delete(normalizedKey);
      latestByKey.set(normalizedKey, { epoch, seq });
      while (latestByKey.size > maxKeys) latestByKey.delete(latestByKey.keys().next().value);
      return true;
    },

    size() { return latestByKey.size; },
  };
}
