'use strict';

const VALIDATOR_KINDS = new Set(['validator', 'test', 'fixture', 'probe', 'e2e', 'throwaway']);
const TEST_PATH_PATTERNS = [
  /(?:^|\/)cursor-test(?:\/|$)/i,
  /(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
  /(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,
  /(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i,
];

function normalizedProbe(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function sessionIsTestSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.is_test_session === false) return false;
  if (session.is_test_session === true || session.is_test_session === 1 || session.is_test_session === 'true' || session.validator_session === true) return true;
  if (VALIDATOR_KINDS.has(String(session.session_kind || session.session_class || '').trim().toLowerCase())) return true;
  const pathProbe = normalizedProbe(session.workspace_path || session.project_root);
  if (TEST_PATH_PATTERNS.some(pattern => pattern.test(pathProbe))) return true;
  const identityProbe = normalizedProbe([
    session.workspace_name, session.display_name, session.window_title, session.chat_title,
  ].filter(Boolean).join('/'));
  return /(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.test(identityProbe);
}

function sessionNoiseMetadata(session) {
  const isTest = sessionIsTestSession(session);
  const explicitGroup = String(session?.project_group || session?.group_alias || '').trim();
  return {
    is_test_session: isTest,
    session_kind: isTest ? 'validator' : 'operator',
    ...(explicitGroup ? { project_group: explicitGroup } : isTest ? { project_group: 'Remote Agent Chat' } : {}),
  };
}

module.exports = { TEST_PATH_PATTERNS, sessionIsTestSession, sessionNoiseMetadata };
