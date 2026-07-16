#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { sessionNoiseMetadata } = require('../agent-proxy/session-noise-policy');
const {
  codexDesktopThreadKeysMatch,
  isDesktopAppPage,
  isStoredDesktopTargetCanonical,
  resolveCodexDesktopThreadMetadata,
  shouldRestoreCodexDesktopAccumulator,
} = require('../agent-proxy/proxy-engine');

assert.equal(isDesktopAppPage({ type: 'page', url: 'app://-/index.html' }, 'codex-desktop'), true);
assert.equal(isDesktopAppPage({ type: 'page', url: 'app://-/index.html#thread' }, 'codex-desktop'), true);
assert.equal(isDesktopAppPage({ type: 'page', url: 'https://accounts.google.com/signin' }, 'codex-desktop'), false);
assert.equal(isDesktopAppPage({ type: 'page', url: 'https://agents.example/auth/callback' }, 'codex-desktop'), false);
assert.equal(isDesktopAppPage({ type: 'iframe', url: 'app://-/index.html' }, 'codex-desktop'), false);
assert.equal(isDesktopAppPage({ type: 'page', url: 'devtools://devtools/bundled/inspector.html' }, 'codex-desktop'), false);

// Other desktop surfaces retain their existing multi-window/page behavior.
assert.equal(isDesktopAppPage({ type: 'page', url: 'file:///desktop/index.html' }, 'claude-desktop'), true);

assert.equal(
  isStoredDesktopTargetCanonical(
    { agent_type: 'codex-desktop' },
    { type: 'page', url: 'app://-/index.html' }
  ),
  true
);
assert.equal(
  isStoredDesktopTargetCanonical(
    { agent_type: 'codex-desktop' },
    { type: 'page', url: 'https://accounts.google.com/signin' }
  ),
  false
);
assert.equal(
  isStoredDesktopTargetCanonical(
    { agent_type: 'cursor' },
    { type: 'page', url: 'https://accounts.google.com/signin' }
  ),
  true
);

const stableThreadId = 'local:019f4b6a-f61c-7db3-ba89-284406bbeefe';
const engine = Object.create(require('../agent-proxy/proxy-engine').ProxyEngine.prototype);
assert.equal(codexDesktopThreadKeysMatch(`${stableThreadId}:Legacy normalized title`, stableThreadId), true);
assert.equal(codexDesktopThreadKeysMatch('local:different-thread', stableThreadId), false);
let lookedUpCliSessionId = '';
const refreshedMetadata = resolveCodexDesktopThreadMetadata(
  stableThreadId,
  'goal Restore harness controls',
  (cliSessionId, options) => {
    lookedUpCliSessionId = cliSessionId;
    assert.deepEqual(options, { includeMessages: false });
    return {
      workspacePath: 'C:\\Users\\Robert\\Documents\\Remote Agent Chat',
      workspaceName: 'Remote Agent Chat',
      title: 'archive title',
    };
  },
);
assert.equal(lookedUpCliSessionId, '019f4b6a-f61c-7db3-ba89-284406bbeefe');
assert.deepEqual(refreshedMetadata, {
  cliSessionId: '019f4b6a-f61c-7db3-ba89-284406bbeefe',
  workspacePath: 'C:\\Users\\Robert\\Documents\\Remote Agent Chat',
  workspaceName: 'Remote Agent Chat',
  chatTitle: 'goal Restore harness controls',
}, 'the active native thread must replace a stale persisted workspace with its exact JSONL metadata');
assert.equal(
  sessionNoiseMetadata({ workspace_path: refreshedMetadata.workspacePath }).is_test_session,
  false,
  'the refreshed Remote Agent Chat workspace must remain visible in the default operator session list',
);
assert.equal(
  resolveCodexDesktopThreadMetadata('local:not-a-session-id', '', () => assert.fail('invalid keys must not scan sessions')),
  null,
);
assert.equal(engine._codexDesktopRestoreWindowMatches(
  [
    { role: 'user', content: 'retained user turn' },
    { role: 'assistant', content: 'retained assistant turn' },
    { role: 'assistant', content: 'intermediate structured tool output' },
    { role: 'user', content: 'newer retained user turn' },
    { role: 'assistant', content: 'newer retained assistant turn' },
  ],
  [
    { role: 'user', content: 'retained user turn' },
    { role: 'assistant', content: 'newer retained assistant turn' },
  ],
), true, 'a bounded ordered visual-unit window must restore same-thread durable history');
assert.equal(engine._codexDesktopRestoreWindowMatches(
  [{ role: 'user', content: 'retained user turn' }],
  [{ role: 'user', content: 'unrelated user turn' }],
), false, 'an unrelated bounded window must not restore durable history');
assert.equal(shouldRestoreCodexDesktopAccumulator({
  storedMessages: [{ role: 'assistant', content: 'retained' }],
  initialMessages: [],
  storedThreadKey: `${stableThreadId}:Legacy normalized title`,
  currentThreadKey: stableThreadId,
  storedContainsInitial: true,
}), true, 'empty startup DOM on the same thread must restore durable transcript state');
assert.equal(shouldRestoreCodexDesktopAccumulator({
  storedMessages: [{ role: 'assistant', content: 'retained' }],
  initialMessages: [{ role: 'assistant', content: 'unrelated' }],
  storedThreadKey: stableThreadId,
  currentThreadKey: stableThreadId,
  storedContainsInitial: false,
}), false, 'a non-overlapping native transcript must replace stale durable state');
assert.equal(shouldRestoreCodexDesktopAccumulator({
  storedMessages: [{ role: 'assistant', content: 'retained' }],
  initialMessages: [],
  storedThreadKey: 'local:different-thread',
  currentThreadKey: stableThreadId,
  storedContainsInitial: true,
}), false, 'a different active thread must never inherit the prior transcript');

console.log('Codex Desktop target discovery smoke: PASS');
