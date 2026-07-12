'use strict';

const assert = require('assert');
const {
  buildSingletonExtensionStableKey,
  findSingletonExtensionSession,
} = require('../agent-proxy/session-store');

const options = {
  agentType: 'continue',
  hostType: 'vscode',
  cdpPort: 9230,
  workbenchWindowId: '1',
  workspacePath: 'C:\\temp\\remote-agent-vscode-test',
};
const stableKey = buildSingletonExtensionStableKey(options);
assert(stableKey.includes('continue'));
assert.strictEqual(buildSingletonExtensionStableKey({ ...options, agentType: 'claude' }), null);

const legacy = {
  old: {
    session_id: 'old',
    agent_type: 'continue',
    host_type: 'vscode',
    cdp_port: 9230,
    workspace_path: 'c:/temp/remote-agent-vscode-test',
    created_at: '2026-07-11T18:41:00.000Z',
    last_seen_at: '2026-07-11T19:43:02.668Z',
  },
  restartDuplicate: {
    session_id: 'restartDuplicate',
    agent_type: 'continue',
    host_type: 'vscode',
    cdp_port: 9230,
    workspace_path: 'C:\\temp\\remote-agent-vscode-test',
    created_at: '2026-07-11T19:43:02.625Z',
    last_seen_at: '2026-07-11T19:43:02.625Z',
    stable_surface_key: stableKey,
    stable_surface_version: 1,
    superseded_by: 'restartDuplicate',
  },
  otherPort: {
    session_id: 'otherPort',
    agent_type: 'continue',
    host_type: 'vscode',
    cdp_port: 9223,
    workspace_path: 'C:\\temp\\remote-agent-vscode-test',
    created_at: '2026-07-11T20:00:00.000Z',
    last_seen_at: '2026-07-11T20:00:00.000Z',
  },
};
let found = findSingletonExtensionSession(legacy, options);
assert.strictEqual(found.match[0], 'old', 'latest prior surface must survive a restart duplicate');
assert.deepStrictEqual(found.matches.map(([sid]) => sid).sort(), ['old', 'restartDuplicate']);

legacy.old.stable_surface_key = stableKey;
legacy.old.stable_surface_version = 2;
delete legacy.old.superseded_by;
legacy.restartDuplicate.last_seen_at = '2026-07-11T21:00:00.000Z';
found = findSingletonExtensionSession(legacy, options);
assert.strictEqual(found.match[0], 'old', 'persisted canonical identity must win future restarts');

console.log(JSON.stringify({
  ok: true,
  stable_key: stableKey,
  canonical_session_id: found.match[0],
  isolated_by_cdp_port: true,
}, null, 2));
