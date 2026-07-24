'use strict';

// Session aliases merge durable conversation identity across harness surfaces,
// but capability/config state is a contract with one concrete producer. A
// Codex CLI config must never become the config for the canonical Desktop row.
const SURFACE_SCOPED_SESSION_MESSAGE_TYPES = new Set([
  'agent_config',
]);

function isSurfaceScopedSessionMessage(message) {
  return Boolean(message && SURFACE_SCOPED_SESSION_MESSAGE_TYPES.has(String(message.type || '')));
}

function canMigrateSurfaceScopedState(aliasMeta, canonicalMeta) {
  const aliasAgentType = String(aliasMeta?.agent_type || '').trim();
  const canonicalAgentType = String(canonicalMeta?.agent_type || '').trim();
  return !aliasAgentType || !canonicalAgentType || aliasAgentType === canonicalAgentType;
}

module.exports = {
  SURFACE_SCOPED_SESSION_MESSAGE_TYPES,
  canMigrateSurfaceScopedState,
  isSurfaceScopedSessionMessage,
};
