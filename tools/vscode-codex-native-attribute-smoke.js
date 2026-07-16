#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : '';

function normalizeNativeEffort(value) {
  const effort = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (effort === 'light') return 'low';
  if (effort === 'xhigh') return 'extra-high';
  return effort;
}

async function main() {
  guard.assertUpdatesDisabled('VS Code Codex native attribute smoke');
  assert.equal(guard.CDP_PORT, 9230, 'native attribute smoke is restricted to disposable CDP port 9230');
  const targets = (await CDP.List({ port: guard.CDP_PORT }))
    .filter(target => guard.isThrowawayIframe(target, 'codex'));
  assert(targets.length >= 3, 'Expected at least three disposable Codex frames, found ' + targets.length);

  const frames = [];
  for (const target of targets) {
    let client;
    try {
      client = await CDP({ port: guard.CDP_PORT, target: target.id });
      await client.Runtime.enable();
      client.Runtime._webviewId = (String(target.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
      await selectors.cacheInnerContextId(client.Runtime);
      const native = await selectors.evalInFrame(client.Runtime, [
        "var trigger = d.querySelector('[data-codex-intelligence-trigger=\"true\"]');",
        "return trigger ? {",
        "  present: true,",
        "  raw_effort: trigger.getAttribute('data-selected-reasoning-effort') || '',",
        "  model_label: String(trigger.innerText || trigger.textContent || '').replace(/\\s+/g, ' ').trim()",
        "} : { present: false, raw_effort: '', model_label: '' };",
      ].join('\n'));
      const config = await selectors.readAgentConfig(client.Runtime, 'codex', '');
      assert.equal(native?.present, true, 'Frame ' + target.id + ' omitted the native intelligence trigger');
      assert(native.raw_effort, 'Frame ' + target.id + ' omitted data-selected-reasoning-effort');
      assert.equal(config.effort, normalizeNativeEffort(native.raw_effort),
        'Frame ' + target.id + ' effort alias did not normalize exactly');
      assert(config.model_id && config.model_id !== 'unknown', 'Frame ' + target.id + ' model was unreadable');
      frames.push({
        target_id: target.id,
        raw_effort: native.raw_effort,
        normalized_effort: config.effort,
        model_id: config.model_id,
        permission_profile: config.permission_profile,
      });
    } finally {
      await client?.close().catch(() => {});
    }
  }

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    cdp_port: guard.CDP_PORT,
    frames,
    visible_windows_opened: 0,
    focus_actions: 0,
    control_actions: 0,
    user_messages_sent: 0,
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error('VS Code Codex native attribute smoke: FAIL (' + (error.stack || error.message) + ')');
  process.exit(1);
});
