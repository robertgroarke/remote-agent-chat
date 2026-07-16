#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  ProxyEngine,
  shouldPreserveCursorPassiveRotation,
} = require('../agent-proxy/proxy-engine');
const sessionStore = require('../agent-proxy/session-store');
const { accumulatedTailMatches } = require('./cursor-production-e2e');

const engine = Object.create(ProxyEngine.prototype);
const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });
const turn = number => [
  user(`Cursor soak turn ${number}`),
  assistant(`RAC_CURSOR_SOAK_${String(number).padStart(2, '0')}`),
];

const toolUser = user('Read README.md with a tool');
const toolAssistant = assistant('Read README.md L1-3\n\n# Cursor probe target\n\nRAC_CURSOR_TOOL');
const accumulated = [toolUser, toolAssistant, ...Array.from({ length: 8 }, (_, index) => turn(index + 1)).flat()];

// Cursor may retain the first user anchor while virtualizing only its assistant
// block. A later window must append turn 9 without deleting the tool response.
const gappedWindow = [toolUser, ...Array.from({ length: 9 }, (_, index) => turn(index + 1)).flat()];
const gapped = engine._mergeCursorTranscriptWindow(accumulated.slice(), gappedWindow);
assert.equal(gapped.changed, true);
assert.equal(gapped.messages.length, 20);
assert.deepEqual(gapped.messages[0], toolUser);
assert.deepEqual(gapped.messages[1], toolAssistant);
assert.deepEqual(gapped.messages.slice(-2), turn(9));

const stable = engine._mergeCursorTranscriptWindow(gapped.messages.slice(), gappedWindow);
assert.equal(stable.changed, false, 're-reading the same gapped window must not churn history');
assert.deepEqual(stable.messages, gapped.messages);

// At Cursor's current long-window boundary, the first assistant tool turn can
// be rewritten from its full streamed/tool form to only the final answer. The
// final answer is an exact suffix of the durable message and must align with
// that existing turn instead of causing the whole visible window to append.
const richToolAssistant = assistant(
  'I’ll read README.md with the read-only file tool now.\n\nFirst heading: # Cursor probe target\n\nRAC_CURSOR_TOOL',
);
const finalToolSuffix = assistant('First heading: # Cursor probe target\n\nRAC_CURSOR_TOOL');
const beforeSuffixRewrite = [toolUser, richToolAssistant, ...Array.from({ length: 7 }, (_, index) => turn(index + 1)).flat()];
const suffixRewriteWindow = [toolUser, finalToolSuffix, ...Array.from({ length: 8 }, (_, index) => turn(index + 1)).flat()];
const suffixRewrite = engine._mergeCursorTranscriptWindow(beforeSuffixRewrite.slice(), suffixRewriteWindow);
assert.equal(suffixRewrite.messages.length, 18, 'assistant suffix rewrite must append only the new turn');
assert.deepEqual(suffixRewrite.messages[1], richToolAssistant, 'richer tool structure must remain retained');
assert.deepEqual(suffixRewrite.messages.slice(-2), turn(8));

// A fully virtualized prefix is also a subsequence window. Preserve the hidden
// prefix and append only the genuinely new pair.
const lateWindow = [...Array.from({ length: 5 }, (_, index) => turn(index + 5)).flat(), ...turn(10)];
const late = engine._mergeCursorTranscriptWindow(gapped.messages.slice(), lateWindow);
assert.equal(late.messages.length, 22);
assert.deepEqual(late.messages.slice(0, 2), [toolUser, toolAssistant]);
assert.deepEqual(late.messages.slice(-2), turn(10));

// Short streaming tails can fail soft matching; grow the one active assistant
// tail in place instead of duplicating it.
const streamingUser = user('Stream a response');
const streaming = engine._mergeCursorTranscriptWindow(
  [streamingUser, assistant('Working')],
  [streamingUser, assistant('Working through the requested verification now.')],
);
assert.equal(streaming.messages.length, 2);
assert.equal(streaming.messages[1].content, 'Working through the requested verification now.');

const cachedSession = {
  agentType: 'cursor',
  _activeThreadKey: 'agent-long',
  _accumulatedMessages: gapped.messages.slice(),
  _cursorAgentHistories: {},
};
engine._cacheCursorActiveTranscript(cachedSession);
assert.deepEqual(cachedSession._cursorAgentHistories['agent-long'], gapped.messages);
cachedSession._accumulatedMessages = [];
const restoredFromGap = engine._restoreCursorTranscriptForThread(cachedSession, 'agent-long', gappedWindow.slice(-5));
assert.deepEqual(restoredFromGap, gapped.messages, 'returning to a virtualized Cursor agent must restore its full cache');

// Cursor can rotate through multiple native resource UUIDs while one remote
// turn is being delivered. Those passive identities inherit the same logical
// transcript; an empty intermediate UUID must never become an authoritative
// empty relay snapshot. Once the bounded settle window expires, an ordinary
// idle native switch retains the existing per-agent replacement behavior.
const rotationSession = {
  agentType: 'cursor',
  activity: { kind: 'generating' },
  waitingForAssistant: true,
  _activeThreadKey: 'agent-before-send',
  _activeThreadTitle: 'Before send',
  _accumulatedMessages: [...turn(1), ...turn(2)],
  _cursorAgentHistories: {},
  lastMessageCount: 4,
  lastObservedCount: 4,
  lastTranscriptSig: 'before',
  pendingLast: null,
};
assert.equal(shouldPreserveCursorPassiveRotation(rotationSession, 1_000), true);
assert.equal(rotationSession._cursorPassiveRotationGraceUntil, 31_000);
rotationSession.waitingForAssistant = false;
rotationSession.activity = { kind: 'idle' };
assert.equal(shouldPreserveCursorPassiveRotation(rotationSession, 30_999), true);
assert.equal(shouldPreserveCursorPassiveRotation(rotationSession, 31_001), false);

const relayEvents = [];
const storeUpdates = [];
const originalUpdateSession = sessionStore.updateSession;
sessionStore.updateSession = (sessionId, update) => storeUpdates.push({ sessionId, update });
engine._sendToRelay = event => relayEvents.push(event);
engine._log = () => {};
try {
  rotationSession.waitingForAssistant = true;
  rotationSession.activity = { kind: 'generating' };
  engine._applyCodexDesktopThreadList('cursor-rotation-fixture', rotationSession, [{
    id: 'transient-control-id',
    cache_key: 'agent-during-send',
    title: 'During send',
    active: true,
  }]);
  assert.equal(rotationSession._activeThreadKey, 'agent-during-send');
  assert.deepEqual(rotationSession._accumulatedMessages, [...turn(1), ...turn(2)]);
  assert.deepEqual(rotationSession._cursorAgentHistories['agent-before-send'], [...turn(1), ...turn(2)]);
  assert.deepEqual(rotationSession._cursorAgentHistories['agent-during-send'], [...turn(1), ...turn(2)]);
  assert.equal(rotationSession._forceHistoryResync, undefined,
    'remote-turn UUID rotation must not queue an authoritative history replacement');

  rotationSession.waitingForAssistant = false;
  rotationSession.activity = { kind: 'idle' };
  engine._applyCodexDesktopThreadList('cursor-rotation-fixture', rotationSession, [{
    id: 'settled-control-id',
    cache_key: 'agent-after-send',
    title: 'After send',
    active: true,
  }]);
  assert.equal(rotationSession._activeThreadKey, 'agent-after-send');
  assert.deepEqual(rotationSession._accumulatedMessages, [...turn(1), ...turn(2)]);
  assert.deepEqual(rotationSession._cursorAgentHistories['agent-after-send'], [...turn(1), ...turn(2)]);

  rotationSession._cursorPassiveRotationGraceUntil = Date.now() - 1;
  engine._applyCodexDesktopThreadList('cursor-rotation-fixture', rotationSession, [{
    id: 'manual-control-id',
    cache_key: 'manual-idle-agent',
    title: 'Manual idle switch',
    active: true,
  }]);
  assert.equal(rotationSession._activeThreadKey, 'manual-idle-agent');
  assert.deepEqual(rotationSession._accumulatedMessages, []);
  assert.equal(rotationSession._forceHistoryResync, 'cursor active agent change',
    'idle native switches outside the grace window must remain authoritative');
} finally {
  sessionStore.updateSession = originalUpdateSession;
}
assert.equal(storeUpdates.length, 3);
assert.equal(relayEvents.filter(event => event?.type === 'history_snapshot').length, 0,
  'active-agent list processing itself must not publish an empty history frame');

const relayWithVirtualizedTool = [toolUser, toolAssistant, ...turn(1), ...turn(2)];
assert.equal(
  accumulatedTailMatches([toolUser, ...turn(1), ...turn(2)], relayWithVirtualizedTool),
  true,
  'native gapped subsequence must match complete relay history',
);
assert.equal(
  accumulatedTailMatches([user('changed user turn'), ...turn(2)], relayWithVirtualizedTool),
  false,
  'changed user content must never match',
);
assert.equal(
  accumulatedTailMatches([assistant('Cursor probe target\n\nRAC_CURSOR_TOOL'), ...turn(1), ...turn(2)], relayWithVirtualizedTool),
  true,
  'virtualized assistant opening blocks may match an exact retained suffix',
);
assert.equal(
  accumulatedTailMatches([toolUser, toolAssistant, ...turn(1)], relayWithVirtualizedTool),
  false,
  'a stale native window must not pass before the newest relay message',
);

console.log('cursor accumulator smoke: PASS');
