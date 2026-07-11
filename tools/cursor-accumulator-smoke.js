#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
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
