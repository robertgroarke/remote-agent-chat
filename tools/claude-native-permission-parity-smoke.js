#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find(file => fs.existsSync(file));
}

const fixture = `<!doctype html><html><body>
  <section class="permissionRequestContainer_fixture">
    <div class="permissionRequestContainerBackground_fixture"></div>
    <div class="permissionRequestContent_fixture">
      <div class="permissionRequestHeader_fixture">Allow this bash command?</div>
      <div class="permissionRequestInput_fixture bashCommand_fixture" contenteditable="true">powershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION"</div>
      <div class="permissionRequestDescription_fixture">Echo permission test string</div>
    </div>
    <div class="buttonContainer_fixture">
      <button><span class="shortcutNum_fixture">1</span> Yes</button>
      <button><span class="shortcutNum_fixture">2</span> Yes, allow powershell for <span class="destinationLink_fixture">this project (just you)</span></button>
      <button><span class="shortcutNum_fixture">3</span> No</button>
      <div class="wrapper_fixture rejectMessageInput_fixture">
        <div class="placeholder_fixture">Tell Claude what to do instead</div>
        <div class="input_fixture" contenteditable="plaintext-only"></div>
      </div>
    </div>
    <div class="keyboardHints_fixture">Esc to cancel</div>
  </section>
  <script>
    const editor = document.querySelector('.input_fixture');
    window.nativeEvents = [];
    editor.addEventListener('input', () => window.nativeEvents.push({ type: 'input', text: editor.textContent }));
    editor.addEventListener('keydown', event => window.nativeEvents.push({ type: 'keydown', key: event.key }));
  </script>
</body></html>`;

async function main() {
  const executablePath = chromePath();
  assert(executablePath, 'Headless Chrome not found');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    const raw = await page.evaluate(source => new Function('d', source)(document), selectors.PERMISSION_DIALOG_EXPR);
    const prompt = JSON.parse(raw);
    assert.strictEqual(prompt.title, 'Allow this bash command?');
    assert.strictEqual(prompt.command, 'powershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION"');
    assert.strictEqual(prompt.description, 'Echo permission test string');
    assert.strictEqual(prompt.alternate_instruction_supported, true);
    assert.strictEqual(prompt.alternate_instruction_placeholder, 'Tell Claude what to do instead');
    assert.strictEqual(prompt.cancel_hint, 'Esc to cancel');
    assert.deepStrictEqual(prompt.choices, [
      { choice_id: '1_yes', label: 'Yes', shortcut: '1' },
      { choice_id: '2_yes_allow_powershell_for_this_project_just_you', label: 'Yes, allow powershell for this project (just you)', shortcut: '2', destination: 'this project (just you)' },
      { choice_id: '3_no', label: 'No', shortcut: '3' },
    ]);

    const instruction = 'Do not run it; explain what the command would do.';
    const submitResult = await page.evaluate(
      ({ source }) => new Function('d', source)(document),
      { source: selectors._buildClaudePermissionInstructionExpr(instruction) },
    );
    assert.strictEqual(submitResult, 'submitted-instruction');
    assert.deepStrictEqual(await page.evaluate(() => ({
      text: document.querySelector('.input_fixture').textContent,
      events: window.nativeEvents,
    })), {
      text: instruction,
      events: [
        { type: 'input', text: instruction },
        { type: 'keydown', key: 'Enter' },
      ],
    });

    const sources = {
      app: read('frontend/app.jsx'),
      styles: read('frontend/styles.css'),
      hooks: read('frontend/hooks.jsx'),
      proxy: read('agent-proxy/proxy-engine.js'),
      relay: read('relay-server/index.js'),
      androidPrompt: read('android-app/components/PermissionPrompt.jsx'),
      androidChat: read('android-app/screens/ChatScreen.jsx'),
      androidRelay: read('android-app/lib/relay.js'),
      protocol: read('protocol.md'),
      visual: read('tools/visual-regression.js'),
    };
    for (const marker of [
      'permission-card-claude', 'permission-command-claude', 'permission-alternate-input',
      "agentType={activeSessionMeta?.agent_type}", "...(instruction ? { instruction } : {})",
    ]) assert(sources.app.includes(marker) || sources.hooks.includes(marker), `web marker missing: ${marker}`);
    for (const marker of ['permission-card-claude', 'permission-command-claude', 'permission-alternate-input']) {
      assert(sources.styles.includes(marker), `style marker missing: ${marker}`);
      assert(sources.visual.includes(marker), `visual fixture marker missing: ${marker}`);
    }
    assert(sources.proxy.includes('{ answers, instruction }'));
    for (const marker of [
      '...(perm.title ? { title: perm.title } : {})',
      '...(perm.command ? { command: perm.command } : {})',
      '...(perm.description ? { description: perm.description } : {})',
      '...(perm.alternate_instruction_supported === true ? { alternate_instruction_supported: true } : {})',
      '...(perm.alternate_instruction_placeholder ? { alternate_instruction_placeholder: perm.alternate_instruction_placeholder } : {})',
      '...(perm.cancel_hint ? { cancel_hint: perm.cancel_hint } : {})',
    ]) assert(sources.proxy.includes(marker), `proxy prompt-envelope marker missing: ${marker}`);
    assert(sources.relay.includes("invalid_permission_instruction"));
    assert(sources.relay.includes("alternate_instruction_supported"));
    assert(sources.androidPrompt.includes('alternateInstructionSupported'));
    assert(sources.androidPrompt.includes("onChoice(prompt.prompt_id, null, { instruction })"));
    assert(sources.androidChat.includes('agentType={agentType}'));
    assert(sources.androidRelay.includes('{ instruction: details.instruction.trim() }'));
    assert(sources.protocol.includes('alternate_instruction_supported'));

    console.log(JSON.stringify({
      ok: true,
      native_fields: ['title', 'command', 'description', 'choices', 'alternate_instruction_placeholder', 'cancel_hint'],
      choices: prompt.choices.length,
      alternate_instruction_submitted: true,
      web_android_parity: true,
      headless: true,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
