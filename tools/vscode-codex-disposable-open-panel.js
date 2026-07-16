#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

async function composerCount(frame) {
  let client;
  try {
    client = await CDP({ port: guard.CDP_PORT, target: frame.id });
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    return Number(await selectors.evalInFrame(client.Runtime, `
      function visible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return rect.width > 0 && rect.height > 0 && (!style || (
          style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        ));
      }
      return Array.from(d.querySelectorAll('.ProseMirror')).filter(visible).length;
    `)) || 0;
  } finally {
    await client?.close().catch(() => {});
  }
}

async function main() {
  guard.assertUpdatesDisabled('VS Code Codex disposable panel activation');
  assert.strictEqual(guard.CDP_PORT, 9230, 'Disposable Codex panel activation is restricted to port 9230');
  const protectedBefore = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const picked = guard.assertTargetSet(targets, 'codex', 'Codex panel activation');

  let pageClient;
  let activation;
  try {
    pageClient = await CDP({ port: guard.CDP_PORT, target: picked.page.id });
    await pageClient.Runtime.enable();
    activation = await selectors.openCodexPanel(pageClient.Runtime);
  } finally {
    await pageClient?.close().catch(() => {});
  }
  assert(activation?.ok, `Codex activity-bar activation failed: ${JSON.stringify(activation)}`);

  const started = Date.now();
  let readyFrame = null;
  let readyComposerCount = 0;
  while (Date.now() - started < 30_000) {
    const current = await CDP.List({ port: guard.CDP_PORT });
    const frames = current.filter(target => guard.isThrowawayIframe(target, 'codex'));
    for (const frame of frames) {
      try {
        const count = await composerCount(frame);
        if (count > 0) {
          readyFrame = frame;
          readyComposerCount = count;
          break;
        }
      } catch {}
    }
    if (readyFrame) break;
    await sleep(100);
  }
  assert(readyFrame, 'Codex panel activated but no disposable composer became ready');
  const protectedAfter = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  assert.deepStrictEqual(protectedAfter, protectedBefore, 'Protected 9223 target set changed during disposable activation');

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    port: guard.CDP_PORT,
    workbench_hash: hash(picked.page.id),
    frame_hash: hash(readyFrame.id),
    activation_method: activation.method || '',
    activation_detail: String(activation.detail || '').slice(0, 160),
    composer_count: readyComposerCount,
    elapsed_ms: Date.now() - started,
    protected_target_count: protectedAfter.length,
    protected_target_set_unchanged: true,
    activity_bar_clicks: 1,
    sends: 0,
    controls: 0,
    permission_actions: 0,
    page_reloads: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`VS Code Codex disposable panel activation: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
