#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const selectors = require(path.join(__dirname, '..', 'agent-proxy', 'selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'vscode-probe-guard'));

async function main(argv = process.argv.slice(2)) {
  if (!argv.includes('--mutate-disposable-dom')) {
    throw new Error('Refusing fixture injection without --mutate-disposable-dom');
  }
  guard.assertUpdatesDisabled('Codex thinking live smoke');
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const picked = guard.assertTargetSet(targets, 'codex', 'Codex thinking live smoke');
  const client = await CDP({ port: guard.CDP_PORT, target: picked.frame.id });
  const fixtureId = 'rac-codex-thinking-live-smoke';
  try {
    await client.Runtime.enable();
    client.Runtime._webviewId = (picked.frame.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    const baseline = await selectors.detectThinking(client.Runtime, 'codex');
    assert.equal(baseline.thinking, false, 'real disposable Codex frame is already active');

    const injected = await selectors.evalInFrame(client.Runtime, `
      var old = d.getElementById(${JSON.stringify(fixtureId)});
      if (old) old.remove();
      var wrapper = d.createElement('div');
      wrapper.id = ${JSON.stringify(fixtureId)};
      wrapper.style.cssText = 'display:block;position:relative;width:20px;height:20px';
      var shimmer = d.createElement('span');
      shimmer.className = 'loading-shimmer-pure-text';
      shimmer.textContent = 'Thinking';
      shimmer.style.cssText = 'display:inline-block';
      wrapper.appendChild(shimmer);
      d.body.appendChild(wrapper);
      return {
        outside_conversation: !shimmer.closest('[data-thread-find-target="conversation"]'),
        visible_by_native_gate: shimmer.offsetParent !== null,
      };
    `);
    assert.deepEqual(injected, { outside_conversation: true, visible_by_native_gate: true });

    const detected = await selectors.detectThinking(client.Runtime, 'codex');
    assert.equal(detected.thinking, true);
    assert.equal(detected.label, 'Thinking');
    console.log(JSON.stringify({
      ok: true,
      cdp_port: guard.CDP_PORT,
      target_id: picked.frame.id,
      outside_conversation: injected.outside_conversation,
      visible_by_native_gate: injected.visible_by_native_gate,
      detected_thinking: detected.thinking,
      detected_label: detected.label,
    }, null, 2));
  } finally {
    try {
      await selectors.evalInFrame(client.Runtime, `
        var fixture = d.getElementById(${JSON.stringify(fixtureId)});
        if (fixture) fixture.remove();
        return true;
      `);
    } catch {}
    await client.close();
  }
}

if (require.main === module) main().catch(error => {
  console.error('FATAL:', error.message);
  process.exitCode = 1;
});

module.exports = { main };
