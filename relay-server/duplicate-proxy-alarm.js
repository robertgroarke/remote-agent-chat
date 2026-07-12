'use strict';

function buildDuplicateProxyAlarms(claimEntries, openReadyState = 1) {
  const claimsBySession = new Map();
  for (const [socket, claim] of claimEntries || []) {
    if (socket?.readyState !== openReadyState) continue;
    for (const sessionId of claim?.sessions || []) {
      if (!claimsBySession.has(sessionId)) claimsBySession.set(sessionId, []);
      claimsBySession.get(sessionId).push(claim.proxy_id || 'unknown-proxy');
    }
  }
  return Array.from(claimsBySession.entries())
    .filter(([, proxyIds]) => proxyIds.length > 1)
    .map(([sessionId, proxyIds]) => ({
      session_id: sessionId,
      proxy_ids: [...new Set(proxyIds)].sort(),
    }))
    .sort((a, b) => a.session_id.localeCompare(b.session_id));
}

module.exports = { buildDuplicateProxyAlarms };
