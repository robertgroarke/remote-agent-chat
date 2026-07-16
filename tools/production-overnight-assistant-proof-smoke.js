#!/usr/bin/env node
'use strict';

const assert = require('assert');
const runner = require('./production-harness-overnight-soak');

const token = 'RAC_OVERNIGHT_TEST_01_CLAUDE_CLI';
const prompt = runner.assistantTokenPrompt(token);

assert(!prompt.includes(token), 'the user prompt must not contain the contiguous answer token');
assert.strictEqual(runner.eventHasAssistantToken({
  type: 'message', session: 'owned', role: 'user', content: token,
}, token), false, 'top-level user echo must not satisfy assistant proof');
assert.strictEqual(runner.eventHasAssistantToken({
  type: 'history', session: 'owned', messages: [{ role: 'user', content: token }],
}, token), false, 'history user echo must not satisfy assistant proof');
assert.strictEqual(runner.eventHasAssistantToken({
  type: 'message', session: 'owned', role: 'assistant', content: token,
}, token), true, 'top-level assistant token must satisfy proof');
assert.strictEqual(runner.eventHasAssistantToken({
  type: 'history', session: 'owned', messages: [{ role: 'assistant', content: token }],
}, token), true, 'history assistant token must satisfy proof');
assert.strictEqual(runner.eventHasAssistantToken({
  type: 'message', session: 'owned', message: { role: 'assistant', content: token },
}, token), true, 'nested assistant token must satisfy proof');

console.log(JSON.stringify({
  ok: true,
  prompt_excludes_contiguous_token: true,
  user_echo_rejected: true,
  assistant_role_required: true,
}, null, 2));
