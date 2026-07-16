#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');
const fixtures = require('./cdp-regression-fixtures');

const thinking = {
  type: 'thinking',
  label: 'Thought for 1s',
  content: 'Inspected the workspace.',
  collapsed: false,
};
const tool = {
  type: 'tool_call',
  label: 'Analyzed README.md#L1-20',
  status: 'done',
  content: 'Read the requested file range.',
};

const completed = selectors._buildAntigravityV2WorkedForEnvelope(
  '  Worked for 25s  ',
  [thinking, null, tool],
);
assert.deepStrictEqual(completed, {
  type: 'execution',
  blocks: [
    {
      type: 'status',
      label: 'Worked for 25s',
      title: 'Worked for 25s',
      content: 'Worked for 25s',
      status: 'completed',
      collapsed: true,
    },
    thinking,
    tool,
  ],
}, 'Worked-for completion status must precede recovered execution steps');

const statusOnly = selectors._buildAntigravityV2WorkedForEnvelope('Worked for 2m', []);
assert.strictEqual(statusOnly.blocks.length, 1, 'A collapsed turn without recovered steps must retain its status chip');
assert.strictEqual(statusOnly.blocks[0].type, 'status');
assert.strictEqual(statusOnly.blocks[0].status, 'completed');

assert.strictEqual(
  selectors._buildAntigravityV2WorkedForEnvelope('Thought for 2m', [thinking]),
  null,
  'Reasoning duration labels must remain outside the completed-work status mapper',
);

const structural = fixtures.evaluateAntigravityV2StructuralFixtures();
const statusFixture = structural.find(result => result.fixture_id === 'agv2_status');
assert(statusFixture, 'Antigravity v2 status fixture is missing');
assert.strictEqual(statusFixture.status, 'pass', statusFixture.failures.join('; '));

console.log('PASS Antigravity v2 worked-for structured status mapping');
