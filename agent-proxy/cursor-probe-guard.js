'use strict';
/**
 * Cursor CDP probe safety — never mutate host or GWA workspaces.
 *
 * BLOCKED (mutations + mutating probes):
 *   Host:      2b1bf862-afc3-45a1-8e1a-2ce51924f860 / D947691B…
 *   GWA:       284751e2-a2af-47de-a510-3c9e8d479c75 / 2A1EAEB0…
 *
 * PREFERRED (all probes):
 *   Throwaway: a3a0c862-dbbd-4115-9221-6824680a8d72 / 99D49855… / cursor-test
 */

const HOST_SESSION_ID = '2b1bf862-afc3-45a1-8e1a-2ce51924f860';
const HOST_TARGET_ID_PREFIX = 'D947691B';

const GWA_SESSION_ID = '284751e2-a2af-47de-a510-3c9e8d479c75';
const GWA_TARGET_ID_PREFIX = '2A1EAEB0';

const THROWAWAY_SESSION_ID = 'a3a0c862-dbbd-4115-9221-6824680a8d72';
const THROWAWAY_TARGET_ID_PREFIX = '99D49855';

const BLOCKED_TARGET_PREFIXES = [HOST_TARGET_ID_PREFIX, GWA_TARGET_ID_PREFIX];

function targetIdUpper(target) {
  return String(target?.id || '').toUpperCase();
}

function isHostTarget(target) {
  return targetIdUpper(target).startsWith(HOST_TARGET_ID_PREFIX);
}

function isGwaTarget(target) {
  return targetIdUpper(target).startsWith(GWA_TARGET_ID_PREFIX);
}

function isThrowawayTarget(target) {
  if (targetIdUpper(target).startsWith(THROWAWAY_TARGET_ID_PREFIX)) return true;
  // Prefer title match when Cursor reassigns CDP target ids across restarts.
  return String(target?.title || '').toLowerCase().includes('cursor-test');
}

function isBlockedTarget(target) {
  if (isThrowawayTarget(target)) return false;
  return isHostTarget(target) || isGwaTarget(target);
}

function isHostSessionId(sessionId) {
  return String(sessionId || '') === HOST_SESSION_ID;
}

function isGwaSessionId(sessionId) {
  return String(sessionId || '') === GWA_SESSION_ID;
}

function isBlockedSessionId(sessionId) {
  return isHostSessionId(sessionId) || isGwaSessionId(sessionId);
}

function isThrowawaySessionId(sessionId) {
  return String(sessionId || '') === THROWAWAY_SESSION_ID;
}

/**
 * True when a relay session row is the cursor-test throwaway workspace.
 * Prefer workspace path/name over the historical session UUID — CDP target
 * churn reassigns durable session ids across Cursor restarts.
 */
function isThrowawaySession(session) {
  if (!session || typeof session === 'string') {
    return isThrowawaySessionId(session);
  }
  if (session.agent_type && session.agent_type !== 'cursor') return false;
  const sid = session.session_id || session.id || '';
  if (isThrowawaySessionId(sid)) return true;
  if (isBlockedSessionId(sid)) return false;
  const hay = [
    session.workspace_path,
    session.workspace_name,
    session.window_title,
    session.display_name,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return hay.includes('cursor-test') || /[\\/]temp[\\/]cursor-test\b/i.test(hay);
}

function pickThrowawaySession(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.find((s) => {
    const agentType = typeof s === 'string' ? null : s?.agent_type;
    if (agentType && agentType !== 'cursor') return false;
    return isThrowawaySession(s);
  }) || null;
}

/**
 * Pick the throwaway cursor-test workbench page. Never falls back to GWA or host.
 */
function pickProbePage(targets, _titleFilter) {
  const pages = (targets || []).filter(
    (t) => t.type === 'page' && String(t.url || '').includes('workbench')
  );
  const throwaway = pages.find((t) => isThrowawayTarget(t));
  if (throwaway) return { page: throwaway, blocked: null };
  return { page: null, blocked: 'throwaway window not open' };
}

function assertProbeTarget(target, callSite) {
  if (!target) {
    const err = new Error(`PROBE TARGET BLOCKED at ${callSite}: no target`);
    err.code = 'PROBE_TARGET_BLOCKED';
    throw err;
  }
  if (isThrowawayTarget(target)) return;
  if (isHostTarget(target)) {
    const err = new Error(
      `SELF-TARGET BLOCKED at ${callSite}: host target ${target.id} (${HOST_SESSION_ID})`
    );
    err.code = 'SELF_TARGET_BLOCKED';
    throw err;
  }
  if (isGwaTarget(target)) {
    const err = new Error(
      `GWA-TARGET BLOCKED at ${callSite}: GWA target ${target.id} (${GWA_SESSION_ID})`
    );
    err.code = 'GWA_TARGET_BLOCKED';
    throw err;
  }
  const err = new Error(
    `PROBE TARGET BLOCKED at ${callSite}: not throwaway target ${target.id}`
  );
  err.code = 'PROBE_TARGET_BLOCKED';
  throw err;
}

function assertNotHostSession(sessionId, callSite) {
  if (isHostSessionId(sessionId)) {
    const err = new Error(`SELF-TARGET BLOCKED at ${callSite}: session ${HOST_SESSION_ID}`);
    err.code = 'SELF_TARGET_BLOCKED';
    throw err;
  }
}

function listProbeTargets(targets) {
  return (targets || [])
    .filter((t) => t.type === 'page')
    .map((t) => {
      let tag = 'other';
      if (isThrowawayTarget(t)) tag = 'throwaway-OK';
      else if (isHostTarget(t)) tag = 'HOST-BLOCKED';
      else if (isGwaTarget(t)) tag = 'GWA-BLOCKED';
      return { id: t.id, title: t.title, tag };
    });
}

module.exports = {
  HOST_SESSION_ID,
  HOST_TARGET_ID_PREFIX,
  GWA_SESSION_ID,
  GWA_TARGET_ID_PREFIX,
  THROWAWAY_SESSION_ID,
  THROWAWAY_TARGET_ID_PREFIX,
  isHostTarget,
  isGwaTarget,
  isThrowawayTarget,
  isBlockedTarget,
  isHostSessionId,
  isGwaSessionId,
  isBlockedSessionId,
  isThrowawaySessionId,
  isThrowawaySession,
  pickThrowawaySession,
  pickProbePage,
  assertProbeTarget,
  assertNotHostSession,
  listProbeTargets,
};
