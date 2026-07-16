#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  shouldImmediatelyStreamContinueAssistant,
  shouldSendStablePendingMessage,
  shouldRunContinueRemoteFastPoll,
  shouldHoldContinueRemoteWaitOnRegression,
  shouldImmediatelyStreamContinueInPlace,
  shouldImmediatelyStreamContinueTailMutation,
  shouldBypassHistoryBulkQueue,
} = require('../agent-proxy/proxy-engine');

const now = Date.now();
assert.strictEqual(shouldRunContinueRemoteFastPoll({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now + 1000,
}, now), true);
assert.strictEqual(shouldRunContinueRemoteFastPoll({
  agentType: 'continue',
  waitingForAssistant: false,
  _remoteFastPollUntil: now + 1000,
}, now), false);
assert.strictEqual(shouldRunContinueRemoteFastPoll({
  agentType: 'continue',
  waitingForAssistant: false,
  _remoteFastPollUntil: now + 6000,
  _continueTailSettleUntil: now + 5000,
}, now), true, 'a bounded post-assistant tail watch must keep polling without keeping activity working');

assert.strictEqual(shouldHoldContinueRemoteWaitOnRegression({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now + 1000,
}, 2, 3, now), true, 'a transient shorter Continue DOM must not end an explicit remote turn');
assert.strictEqual(shouldHoldContinueRemoteWaitOnRegression({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now - 1,
}, 2, 3, now), false, 'the regression hold must end at the bounded fast-follow expiry');
assert.strictEqual(shouldHoldContinueRemoteWaitOnRegression({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now + 1000,
}, 3, 3, now), false, 'a stable message count is not a regression');
assert.strictEqual(shouldImmediatelyStreamContinueInPlace({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now + 1000,
  pendingLast: { role: 'assistant', content: '' },
}, { role: 'assistant', content: 'RAC_E2E_CONTINUE_TOKEN' }, now), true,
'a non-empty assistant replacement at the same message count must bypass two-poll stabilization');
assert.strictEqual(shouldImmediatelyStreamContinueInPlace({
  agentType: 'continue',
  waitingForAssistant: false,
  _remoteFastPollUntil: now + 1000,
  pendingLast: { role: 'assistant', content: '' },
}, { role: 'assistant', content: 'historical mutation' }, now), false,
'historical Continue transcript mutations must retain the conservative stabilizer');
assert.strictEqual(shouldImmediatelyStreamContinueTailMutation({
  agentType: 'continue',
  waitingForAssistant: false,
  _remoteFastPollUntil: now + 6000,
  _continueTailSettleUntil: now + 5000,
  _continueTailContent: 'MRHD9K56_1',
}, { role: 'assistant', content: 'RAC_E2E_CONTINUE_MRHD9K56_1' }, now), true,
'the full assistant answer must replace a stable suffix during the bounded tail watch');
assert.strictEqual(shouldImmediatelyStreamContinueTailMutation({
  agentType: 'continue',
  _continueTailSettleUntil: now - 1,
  _continueTailContent: 'partial',
}, { role: 'assistant', content: 'historical mutation' }, now), false,
'the tail mutation bypass must expire instead of changing idle historical polling');
assert.strictEqual(shouldRunContinueRemoteFastPoll({
  agentType: 'continue',
  waitingForAssistant: true,
  _remoteFastPollUntil: now - 1,
}, now), false);
assert.strictEqual(shouldRunContinueRemoteFastPoll({
  agentType: 'cursor',
  waitingForAssistant: true,
  _remoteFastPollUntil: now + 1000,
}, now), false);

assert.strictEqual(shouldImmediatelyStreamContinueAssistant(
  { role: 'assistant', content: '' },
  { role: 'assistant', content: 'RAC_E2E_CONTINUE_TOKEN' },
), true);
assert.strictEqual(shouldBypassHistoryBulkQueue('continue', 'assistant completion', 16 * 1024), true);
assert.strictEqual(shouldSendStablePendingMessage(
  { role: 'assistant', content: 'RAC_E2E_CONTINUE_TOKEN' },
  'RAC_E2E_CONTINUE_TOKEN',
), false, 'a streamed assistant tail must not append again when it stabilizes');
assert.strictEqual(shouldSendStablePendingMessage(
  { role: 'assistant', content: 'fresh answer' },
  'older partial',
), true);

const source = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
assert.match(source, /_remoteFastPollUntil = Date\.now\(\) \+ 120000/);
assert.match(source, /_continueRemotePollTimer = setInterval/);
assert.match(source, /clearInterval\(this\._continueRemotePollTimer\)/);
assert.match(source, /kind === 'idle' && Number\(session\._continueTailSettleUntil/);
assert.match(source, /session\._continueTailSettleUntil = Date\.now\(\) \+ 5000/);

console.log('PASS Continue remote fast-follow polling and streaming contract');
