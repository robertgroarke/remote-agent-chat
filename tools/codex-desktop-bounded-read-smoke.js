#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');

function fakeRuntime(expressions) {
  return {
    async evaluate(options) {
      expressions.push(options.expression);
      const isTranscriptRead = options.expression.includes('__remoteAgentPrimeCollapsed');
      return { result: { value: isTranscriptRead ? '[]' : `sig-${expressions.length}` } };
    },
  };
}

async function capture(sessionId, options) {
  const expressions = [];
  const raw = await selectors.readMessages(fakeRuntime(expressions), 'codex-desktop', sessionId, options);
  assert.equal(raw, '[]', 'synthetic transcript read must complete');
  const transcriptExpression = expressions.find(expression => expression.includes('__remoteAgentPrimeCollapsed'));
  assert(transcriptExpression, 'transcript expression must declare the priming contract');
  return transcriptExpression;
}

async function main() {
  const bounded = await capture('bounded-read-smoke', { maxRecentTurns: 24, maxRecentUnits: 96 });
  assert(
    bounded.includes('var __remoteAgentPrimeCollapsed = false;'),
    'bounded production reads must not expand collapsed command groups',
  );
  assert(
    bounded.includes('if (_REMOTE_AGENT_PRIME_COLLAPSED) {'),
    'collapsed-group priming must remain explicitly guarded',
  );

  const unbounded = await capture('unbounded-read-smoke', {});
  assert(
    unbounded.includes('var __remoteAgentPrimeCollapsed = true;'),
    'explicit unbounded fidelity reads must retain disclosure priming',
  );

  console.log('Codex Desktop bounded transcript read smoke: PASS');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
