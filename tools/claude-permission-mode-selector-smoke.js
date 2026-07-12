#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');

async function main() {
  const evaluations = [];
  const Runtime = {
    _innerContextId: 1,
    async evaluate(params) {
      evaluations.push(params.expression);
      if (params.expression.includes('trigger.click()')) {
        assert(!params.expression.includes('var menuItems ='),
          'trigger click and portal-menu read must use separate evaluations');
        return { result: { value: JSON.stringify({ ok: true, opened: true, mode: 'default' }) } };
      }
      if (params.expression.includes('var menuItems =')) {
        return { result: { value: JSON.stringify({ ok: true, clicked: 'Edit automatically', mode: 'default' }) } };
      }
      throw new Error('Unexpected Runtime.evaluate expression');
    },
  };

  const started = Date.now();
  const result = await selectors.setAgentPermissionMode(
    Runtime,
    'claude',
    'acceptEdits',
    'claude-permission-selector-smoke',
  );

  assert.equal(result.ok, true);
  assert.equal(result.selected, 'Edit automatically');
  assert.equal(evaluations.length, 2);
  assert(Date.now() - started >= 75, 'portal render settle delay was not applied');
  console.log(JSON.stringify({
    ok: true,
    evaluations: evaluations.length,
    portal_render_retry_ms: 100,
    selected: result.selected,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
