#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const selectors = require(path.join(__dirname, '..', 'agent-proxy', 'selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'vscode-probe-guard'));
const { settleCodexFastModeOnboarding } = require('./vscode-extension-production-e2e');

async function main(argv = process.argv.slice(2)) {
  if (!argv.includes('--mutate-disposable-dom')) {
    throw new Error('Refusing fixture injection without --mutate-disposable-dom');
  }
  guard.assertUpdatesDisabled('Codex Fast mode onboarding live smoke');
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const picked = guard.assertTargetSet(targets, 'codex', 'Codex Fast mode onboarding live smoke');
  const client = await CDP({ port: guard.CDP_PORT, target: picked.frame.id });
  const native = {
    client,
    frame: picked.frame,
    connectionState: { disconnected: false, target_id: picked.frame.id },
  };
  const fixtureId = 'rac-fast-mode-onboarding-live-smoke';
  try {
    await client.Runtime.enable();
    client.Runtime._webviewId = (picked.frame.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    const baseline = await settleCodexFastModeOnboarding(native);
    assert.equal(baseline.status, 'absent', 'real disposable frame already has Fast mode onboarding open');

    const injected = await selectors.evalInFrame(client.Runtime, `
      var old = d.getElementById(${JSON.stringify(fixtureId)});
      if (old) old.remove();
      window.__racFastModeSmokeClicks = 0;
      var dialog = d.createElement('section');
      dialog.id = ${JSON.stringify(fixtureId)};
      dialog.setAttribute('role', 'dialog');
      dialog.style.cssText = 'position:fixed;inset:20px;display:block;z-index:2147483647;background:white';
      var title = d.createElement('h2');
      title.textContent = 'Introducing Fast mode';
      var standard = d.createElement('button');
      standard.textContent = 'Use standard speed';
      var fast = d.createElement('button');
      fast.textContent = 'Turn on Fast mode';
      standard.addEventListener('click', function() {
        window.__racFastModeSmokeClicks += 1;
        dialog.remove();
      });
      dialog.append(title, standard, fast);
      d.body.appendChild(dialog);
      return !!d.getElementById(${JSON.stringify(fixtureId)});
    `);
    assert.equal(injected, true);

    const outcome = await settleCodexFastModeOnboarding(native);
    assert.deepEqual(outcome, { status: 'dismissed' });
    const finalState = await selectors.evalInFrame(client.Runtime, `
      return {
        fixture_present: !!d.getElementById(${JSON.stringify(fixtureId)}),
        standard_clicks: window.__racFastModeSmokeClicks || 0,
      };
    `);
    assert.deepEqual(finalState, { fixture_present: false, standard_clicks: 1 });
    assert.equal(native.fastModeOnboardingDismissals, 1);
    console.log(JSON.stringify({
      ok: true,
      cdp_port: guard.CDP_PORT,
      target_id: picked.frame.id,
      exact_choice: 'Use standard speed',
      standard_clicks: finalState.standard_clicks,
    }, null, 2));
  } finally {
    try {
      await selectors.evalInFrame(client.Runtime, `
        var fixture = d.getElementById(${JSON.stringify(fixtureId)});
        if (fixture) fixture.remove();
        delete window.__racFastModeSmokeClicks;
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
