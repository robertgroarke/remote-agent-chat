#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const guard = require('../agent-proxy/vscode-probe-guard');
const { freshEvidencePath } = require('./evidence-path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
assert(args.includes('--trust-disposable-parent'), 'explicit --trust-disposable-parent is required');
const outputIndex = args.indexOf('--output');
const outputPath = path.resolve(outputIndex >= 0 && args[outputIndex + 1]
  ? args[outputIndex + 1]
  : freshEvidencePath(root, 'vscode-disposable-parent-trust.json'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function fileSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  return {
    bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function isDisposableWorkbench(target) {
  return target?.type === 'page'
    && /workbench\.html/i.test(String(target.url || ''))
    && /remote-agent-vscode-test(?:-[bc])?\s+-\s+visual studio code/i.test(String(target.title || ''));
}

async function main() {
  const settingsPath = guard.assertUpdatesDisabled('VS Code disposable parent trust');
  assert.strictEqual(guard.CDP_PORT, 9230, 'trust action is restricted to disposable port 9230');
  const settingsBefore = fileSnapshot(settingsPath);
  const protectedBefore = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  const targets = await CDP.List({ port: 9230 });
  const pages = targets.filter(isDisposableWorkbench);
  assert.strictEqual(pages.length, 3, `expected three disposable workbenches, found ${pages.length}`);
  const trustPage = pages.find(page => /remote-agent-vscode-test-c\s+-/i.test(String(page.title || '')));
  assert(trustPage, 'workspace C workbench not found');

  const client = await CDP({ port: 9230, target: trustPage.id });
  let action;
  try {
    await client.Runtime.enable();
    const evaluated = await client.Runtime.evaluate({
      expression: `(() => {
        function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
        const checkbox = Array.from(document.querySelectorAll('[role="checkbox"]')).find(element =>
          /Trust the authors of all files in the parent folder 'temp'/i.test(element.getAttribute('aria-label') || '')
        );
        const yes = Array.from(document.querySelectorAll('a[role="button"],button,[role="button"]')).find(element =>
          norm(element.innerText || element.textContent) === 'Yes, I trust the authors'
        );
        if (!checkbox || !yes) return JSON.stringify({ ok: false, checkbox: !!checkbox, yes: !!yes });
        if (checkbox.getAttribute('aria-checked') !== 'true') checkbox.click();
        yes.click();
        return JSON.stringify({ ok: true, parent: 'C:\\temp', checkbox_clicked: true, trust_clicked: true });
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    action = JSON.parse(evaluated.result.value || '{}');
    assert(action.ok, `disposable parent trust controls unavailable: ${JSON.stringify(action)}`);
  } finally {
    await client.close();
  }

  const readiness = {};
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const page of pages.filter(item => /remote-agent-vscode-test-[bc]\s+-/i.test(String(item.title || '')))) {
      const pageClient = await CDP({ port: 9230, target: page.id });
      try {
        await pageClient.Runtime.enable();
        const value = await pageClient.Runtime.evaluate({
          expression: `(() => {
            const actions = Array.from(document.querySelectorAll('.activitybar .action-item a,.composite.bar .action-item a,[id*="activitybar"] .action-item a'));
            const codex = actions.find(element => /codex|chatgpt|openai/i.test([
              element.getAttribute('aria-label'), element.title, element.id, element.getAttribute('data-action-id')
            ].join(' ')));
            const restricted = Array.from(document.querySelectorAll('[aria-label]')).some(element =>
              /Restricted Mode: Some features are disabled because this folder is not trusted/i.test(element.getAttribute('aria-label') || '')
            );
            return JSON.stringify({ codex_activity: !!codex, restricted });
          })()`,
          returnByValue: true,
        });
        readiness[page.title] = JSON.parse(value.result.value || '{}');
      } finally {
        await pageClient.close();
      }
    }
    if (Object.keys(readiness).length === 2
      && Object.values(readiness).every(value => value.codex_activity && !value.restricted)) break;
    await sleep(100);
  }
  assert.strictEqual(Object.keys(readiness).length, 2, 'did not observe both B/C workbenches');
  assert(Object.values(readiness).every(value => value.codex_activity && !value.restricted),
    `B/C did not become trusted Codex workbenches: ${JSON.stringify(readiness)}`);
  const settingsAfter = fileSnapshot(settingsPath);
  assert.deepStrictEqual(settingsAfter, settingsBefore, 'workspace trust action changed VS Code user settings');
  const protectedAfter = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  assert.deepStrictEqual(protectedAfter, protectedBefore, 'protected 9223 target set changed');

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    port: 9230,
    trusted_parent: 'C:\\temp',
    action,
    readiness,
    settings_unchanged: true,
    protected_target_set_unchanged: true,
    trust_dialog_answers: 1,
    agent_permission_dialog_answers: 0,
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
  console.error(`VS Code disposable parent trust: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
