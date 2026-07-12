'use strict';

const assert = require('assert');
const { newContinueChatFromWorkbench } = require('../agent-proxy/selectors');

async function main() {
  let expression = '';
  const Runtime = {
    async evaluate(options) {
      expression = options.expression;
      return { result: { value: { ok: true, label: 'New Session' } } };
    },
  };
  const result = await newContinueChatFromWorkbench(Runtime);
  assert.deepStrictEqual(result, { ok: true, label: 'New Session' });
  assert.match(expression, /\[aria-label="New Session"\]/);
  assert.match(expression, /matches\.length !== 1/);
  assert.doesNotMatch(expression, /new chat|new conversation/i);
  console.log('continue-new-session-selector-smoke: ok');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
