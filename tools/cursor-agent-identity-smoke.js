#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));

(async () => {
  const targets = await CDP.List({ port: 9227 });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'No guarded cursor-test target');
  guard.assertProbeTarget(page, __filename);
  const client = await CDP({ port: 9227, target: page.id });
  try {
    await client.Runtime.enable();
    const agents = await cursorSel.readCursorAgentList(client.Runtime);
    const active = agents.filter(agent => agent && agent.active);
    assert.equal(active.length, 1, `expected one active Cursor agent, got ${active.length}`);
    assert.match(
      String(active[0].cache_key || ''),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'active Cursor agent must expose the native editor resource UUID',
    );
    assert.equal(new Set(agents.map(agent => agent.id)).size, agents.length, 'Cursor control IDs must remain unique');
    assert.equal(
      agents.some(agent => /^review:\s*/i.test(String(agent?.title || ''))),
      false,
      'Cursor multi-diff Review editor tabs must not masquerade as agent threads',
    );
    console.log(`cursor agent identity smoke: PASS (${active[0].cache_key})`);
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error(`cursor agent identity smoke: FAIL (${error.message})`);
  process.exit(1);
});
