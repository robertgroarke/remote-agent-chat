#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const productionQuestion = require('./proxy-codex-cli-live-question-e2e');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(__dirname, 'proxy-codex-cli-live-question-e2e.js');

function rejects(args, pattern) {
  assert.throws(() => productionQuestion.parseArgs(args), pattern);
}

const screenshot = path.join(ROOT, 'evidence', 'harness-maturity', '2026-07-16', 'fixture-question.png');
const options = productionQuestion.parseArgs([
  '--send-live',
  '--require-capability',
  '--answer-via-cdp',
  '--browser-cdp', 'http://127.0.0.1:9240',
  '--pending-screenshot', screenshot,
  '--response', 'relay',
  '--output', path.join(ROOT, 'evidence', 'harness-maturity', '2026-07-16', 'fixture-question.json'),
]);
assert.equal(options.answerViaCdp, true);
assert.equal(options.browserCdp, 'http://127.0.0.1:9240');
assert.equal(options.pendingScreenshot, screenshot);
assert.equal(options.response, 'relay');

rejects(['--send-live', '--answer-via-cdp', '--response', 'relay'], /requires --pending-screenshot/);
rejects([
  '--send-live', '--answer-via-cdp', '--response', 'relay', '--pending-screenshot', screenshot,
  '--browser-cdp', 'http://127.0.0.1:9223',
], /restricted to the dedicated CDP-9240/);
rejects([
  '--send-live', '--answer-via-cdp', '--response', 'relay', '--pending-screenshot', screenshot,
  '--browser-cdp', 'http://example.com:9240',
], /must be loopback/);
rejects([
  '--send-live', '--answer-via-cdp', '--response', 'native', '--pending-screenshot', screenshot,
], /requires --response relay/);

const prompt = {
  prompt_id: 'private-prompt-id',
  generation: 'private-generation',
  kind: 'request_user_input',
  source: { surface: 'codex_cli', version: '0.144.4' },
  title: 'Route',
  questions: [{
    question_id: 'route-private-id',
    header: 'Route',
    message: 'Choose a route.',
    answer_mode: 'single',
    required: true,
    multi_select: false,
    allow_other: true,
    secret: false,
    choices: [{
      choice_id: 'private-choice-id',
      label: 'Relay',
      description: 'Answer through RAC.',
      requires_text: false,
      is_other: false,
    }],
  }],
};
const producer = productionQuestion.producerRequestSummary(prompt, {
  native_receipt: { thread_id: 'private-thread-id', turn_id: 'private-turn-id' },
});
const producerJson = JSON.stringify(producer);
for (const secret of [
  'private-prompt-id', 'private-generation', 'route-private-id', 'private-choice-id',
  'private-thread-id', 'private-turn-id',
]) {
  assert(!producerJson.includes(secret), `producer summary leaked ${secret}`);
}
assert.equal(producer.title, 'Route');
assert.equal(producer.questions[0].message, 'Choose a route.');
assert.equal(producer.questions[0].choices[0].description, 'Answer through RAC.');

const relay = productionQuestion.redactedRelayFrame({
  type: 'agent_control_result',
  command: 'question_response',
  result: 'ok',
  lifecycle: 'answered',
  native_acknowledged: true,
  request_id: 'private-request-id',
  session_id: 'private-session-id',
  prompt_id: 'private-prompt-id',
  native_receipt: {
    method: 'serverRequest/resolved',
    thread_id: 'private-thread-id',
    turn_id: 'private-turn-id',
  },
});
const relayJson = JSON.stringify(relay);
for (const secret of [
  'private-request-id', 'private-session-id', 'private-prompt-id', 'private-thread-id', 'private-turn-id',
]) {
  assert(!relayJson.includes(secret), `redacted relay frame leaked ${secret}`);
}
assert.equal(relay.native_acknowledged, true);
assert.equal(relay.native_receipt.method, 'serverRequest/resolved');
assert.equal(relay.native_receipt.same_thread, true);
assert.equal(relay.native_receipt.same_turn, true);

const source = fs.readFileSync(SOURCE_PATH, 'utf8');
for (const forbidden of ['.newPage(', 'bringToFront(', 'page.focus(', 'window.open(']) {
  assert(!source.includes(forbidden), `production question browser path contains forbidden ${forbidden}`);
}
for (const required of [
  "assert.strictEqual(pages.length, 1",
  "page.reload({ waitUntil: 'domcontentloaded'",
  ".session-card[data-session-id=",
  "button.hamburger",
  "sidebar.getBoundingClientRect()",
  "document.querySelector('.session-card.active[data-session-id]')",
  "card.press('Enter'",
  "event.isTrusted === true",
  "class QuestionProbeWebSocket extends NativeWebSocket",
  "browser_question_response",
  "restored_constructor",
  "page.locator('.overlay.open')",
  "scrollIntoView({ block: 'center'",
  ".permission-card[role=\"dialog\"]",
  "record.submit_text === 'Sending...'",
  "prompt.cancel_supported === true",
  "record.cancel_present === false",
  "restore_sidebar_open",
  "restoreProductionPage(page",
  "answer_path: options.answerViaCdp ? 'authenticated_cdp_9240_typed_presenter'",
]) {
  assert(source.includes(required), `production question browser path is missing ${required}`);
}

console.log(JSON.stringify({
  result: 'PASS',
  cdp_port: 9240,
  exact_existing_page_required: true,
  new_page_paths: 0,
  focus_paths: 0,
  visible_window_paths: 0,
  typed_presenter_selection: true,
  truthful_pending_state_required: true,
  prior_page_state_restore_required: true,
  producer_private_identity_leaks: 0,
  relay_private_identity_leaks: 0,
}, null, 2));
