#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');

const detectionSource = selectors.detectThinking.toString();
const selectorSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'selectors.js'), 'utf8');

assert(
  detectionSource.includes('[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]'),
  'Codex Desktop thinking detection must scope sidebar activity to the active thread row',
);
assert(
  detectionSource.includes("activeThreadRow.querySelectorAll('[class*=\"animate-spin\"]')"),
  'Codex Desktop thinking detection must recognize the active row spinner',
);
assert(
  detectionSource.includes('if (activeThreadSpinner)') && detectionSource.includes('hasSpinnerSignal = true'),
  'active row spinner must become a trusted live spinner signal',
);
assert(
  selectorSource.includes("(activeThreadSpinner ? '1' : '0')"),
  'Codex DOM signature must invalidate the cached thinking state when active-row activity changes',
);
assert(
  detectionSource.includes("!el.closest('nav')"),
  'generic spinner detection must continue excluding unrelated sidebar activity',
);

async function main() {
  let emittedExpression = '';
  const Runtime = {
    async evaluate(options) {
      emittedExpression = String(options.expression || '');
      // Compile the exact Runtime.evaluate payload. Source-string assertions alone
      // do not catch template-literal escapes that become invalid page JavaScript.
      new Function(emittedExpression);
      return { result: { value: JSON.stringify({ thinking: false, label: '' }) } };
    },
  };
  const result = await selectors.detectThinking(Runtime, 'codex-desktop');
  assert(emittedExpression.includes('activeThreadSpinner'), 'runtime probe must include active-row spinner detection');
  assert.strictEqual(result.thinking, false, 'compile-only runtime response should remain idle');
  assert.strictEqual(result.diagnostic, undefined, 'Codex thinking runtime expression must compile without diagnostics');
  console.log('Codex Desktop active-row spinner thinking smoke: PASS (active exact; background excluded; cache invalidated; runtime expression compiles)');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
