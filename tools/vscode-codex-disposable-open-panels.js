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
const { freshEvidencePath } = require('./evidence-path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
assert(args.includes('--open-disposable-panels'), 'explicit --open-disposable-panels is required');
const outputIndex = args.indexOf('--output');
const outputPath = path.resolve(outputIndex >= 0 && args[outputIndex + 1]
  ? args[outputIndex + 1]
  : freshEvidencePath(root, 'vscode-codex-disposable-three-panels.json'));
const fixtureIndex = args.indexOf('--fixture');
const fixturePath = path.resolve(fixtureIndex >= 0 && args[fixtureIndex + 1]
  ? args[fixtureIndex + 1]
  : 'evidence/harness-maturity/2026-07-15/vscode-codex-disposable-conversations-abc.json');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function isCodexFrame(target) {
  return target?.type === 'iframe'
    && /[?&]extensionId=openai\.chatgpt(?:&|$)/i.test(String(target.url || ''));
}

function isDisposableWorkbench(target) {
  return target?.type === 'page'
    && /workbench\.html/i.test(String(target.url || ''))
    && /remote-agent-vscode-test(?:-[bc])?\s+-\s+visual studio code/i.test(String(target.title || ''));
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  guard.assertUpdatesDisabled('VS Code Codex disposable panel opener');
  assert.strictEqual(guard.CDP_PORT, 9230, 'panel opener is restricted to disposable port 9230');
  const protectedBefore = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  const targetsBefore = await CDP.List({ port: 9230 });
  const pages = targetsBefore.filter(isDisposableWorkbench);
  const framesBefore = targetsBefore.filter(isCodexFrame);
  assert.strictEqual(pages.length, 3, `expected three disposable workbenches, found ${pages.length}`);
  assert(framesBefore.length >= 1 && framesBefore.length <= 3,
    `expected one to three initial Codex frames, found ${framesBefore.length}`);
  const pagesToOpen = pages.filter(page => /remote-agent-vscode-test-[bc]\s+-/i.test(String(page.title || '')));
  assert.strictEqual(pagesToOpen.length, 2, `expected B/C workbenches, found ${pagesToOpen.length}`);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert(Array.isArray(fixture?.conversations) && fixture.conversations.length === 3,
    'A/B/C fixture conversations are unavailable');
  const conversationByLabel = Object.fromEntries(fixture.conversations.map(item => [item.label, item]));

  const controls = [];
  for (const page of pagesToOpen) {
    const label = /remote-agent-vscode-test-b\s+-/i.test(String(page.title || '')) ? 'B' : 'C';
    const conversation = conversationByLabel[label];
    assert(conversation?.token, `fixture conversation ${label} has no token`);
    const marker = `RAC_CODEX_SCOPE_${label}_`;
    if (String(page.title || '').includes(marker)) {
      controls.push({
        page_hash: hash(page.id),
        title: page.title,
        conversation: label,
        result: { ok: true, method: 'already-open-host-codex-session', label: marker },
      });
      continue;
    }
    const client = await CDP({ port: 9230, target: page.id });
    try {
      await client.Runtime.enable();
      const evaluated = await client.Runtime.evaluate({
        expression: `(() => {
          const token = ${JSON.stringify(conversation.token)};
          const marker = ${JSON.stringify(marker)};
          const rows = Array.from(document.querySelectorAll('[role="treeitem"][aria-label*="Codex session"]'));
          const matches = rows.filter(element => (element.getAttribute('aria-label') || '').includes(marker));
          const row = matches.length === 1 ? matches[0] : null;
          if (!row) return JSON.stringify({ ok: false, detail: 'host-session-row-not-found', available: rows.length });
          row.click();
          return JSON.stringify({ ok: true, method: 'host-codex-session-treeitem', label: token });
        })()`,
        returnByValue: true,
      });
      const result = JSON.parse(evaluated.result.value || '{}');
      assert(result?.ok, `Codex host session did not open for ${page.title}: ${JSON.stringify(result)}`);
      controls.push({ page_hash: hash(page.id), title: page.title, conversation: label, result });
    } finally {
      await client.close();
    }
  }

  const targetsAfter = await waitFor(async () => {
    const targets = await CDP.List({ port: 9230 });
    return targets.filter(isCodexFrame).length === 3 ? targets : null;
  }, 30000, 'three disposable Codex frames');
  const framesAfter = targetsAfter.filter(isCodexFrame);
  const protectedAfter = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  assert.deepStrictEqual(protectedAfter, protectedBefore, 'protected 9223 target set changed');

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    port: 9230,
    workbench_count: pages.length,
    codex_frame_count_before: framesBefore.length,
    codex_frame_count_after: framesAfter.length,
    workbenches: pages.map(page => ({ target_hash: hash(page.id), title: page.title })),
    codex_frames: framesAfter.map(frame => ({ target_hash: hash(frame.id) })),
    controls,
    protected_target_set_unchanged: true,
    sends: 0,
    page_reloads: 0,
    focus_actions: 0,
    visible_windows_opened_on_current_desktop: 0,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  console.error(`VS Code Codex disposable panel opener: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
