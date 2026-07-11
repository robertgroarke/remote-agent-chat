#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  codexDesktopThreadKeysMatch,
  isDesktopAppPage,
  isStoredDesktopTargetCanonical,
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
