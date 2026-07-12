'use strict';

const assert = require('assert');
const { shouldPromoteInnerContext } = require('../agent-proxy/selectors');

assert.strictEqual(
  shouldPromoteInnerContext(null, null, 15101),
  true,
  'the first available execution context must be accepted'
);
assert.strictEqual(
  shouldPromoteInnerContext(3, 15103, 15101),
  false,
  'a later shell-only context scan must not downgrade the live app context'
);
assert.strictEqual(
  shouldPromoteInnerContext(1, 15101, 15103),
  true,
  'a later Continue app context must replace the lower-scored webview shell'
);

console.log('continue-context-cache-smoke: ok');
