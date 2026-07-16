#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');

function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find(file => fs.existsSync(file));
}

const fixture = `<!doctype html><html><body>
  <section class="permissionRequestContainer">
    <h2>Choose implementation details</h2>
    <div role="tablist"><button id="white-tab" data-value="white_box" role="tab" aria-controls="white-panel" aria-selected="true">White box</button><button id="checks-tab" data-value="checks" role="tab" aria-controls="checks-panel" aria-selected="false">Checks</button></div>
    <div id="white-panel" role="tabpanel" aria-labelledby="white-tab">
      <h3 class="questionTitle">Implementation approach</h3>
      <div role="radio" aria-checked="false"><span class="optionLabel">Fix the launcher script</span><span class="optionDescription">Repair the existing guarded launcher.</span></div>
      <div role="radio" aria-checked="false"><span class="optionLabel">Other</span><span class="optionDescription">Provide a custom approach.</span><input type="text"></div>
    </div>
    <div id="checks-panel" role="tabpanel" aria-labelledby="checks-tab" aria-multiselectable="true">
      <h3 class="questionTitle">Validation checks</h3>
      <div role="checkbox" aria-checked="false"><span class="optionLabel">Tests</span><span class="optionDescription">Run the focused suite.</span></div>
      <div role="checkbox" aria-checked="false"><span class="optionLabel">Docs</span><span class="optionDescription">Update operator guidance.</span></div>
    </div>
    <footer>Esc to cancel <kbd>Enter</kbd></footer><button id="submit">Submit answers</button>
  </section>
  <script>
    for (const row of document.querySelectorAll('[role=radio]')) row.addEventListener('click', () => {
      for (const peer of row.parentElement.querySelectorAll('[role=radio]')) peer.setAttribute('aria-checked', peer === row ? 'true' : 'false');
    });
    for (const row of document.querySelectorAll('[role=checkbox]')) row.addEventListener('click', () => row.setAttribute('aria-checked', row.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
    for (const tab of document.querySelectorAll('[role=tab]')) tab.addEventListener('click', () => {
      for (const peer of document.querySelectorAll('[role=tab]')) peer.setAttribute('aria-selected', peer === tab ? 'true' : 'false');
    });
    document.querySelector('#submit').addEventListener('click', () => { window.submitted = true; });
  </script>
</body></html>`;

(async () => {
  const executablePath = chromePath();
  assert(executablePath, 'Chrome is required for the headless question fixture');
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
    assert.strictEqual(prompt.kind, 'question');
    assert.strictEqual(prompt.questions.length, 2);
    assert.strictEqual(prompt.questions[0].question_id, 'white_box');
    assert.strictEqual(prompt.questions[0].multi_select, false);
    assert.strictEqual(prompt.questions[1].question_id, 'checks');
    assert.strictEqual(prompt.questions[1].multi_select, true);
    assert(prompt.choices.some(choice => choice.choice_id === 'white_box__other' && choice.requires_text));
    assert(prompt.choices.some(choice => choice.choice_id === 'checks__tests' && choice.description));
    assert(!prompt.message.includes('Esc to cancel'));
    assert(!prompt.message.includes('Submit answers'));
    assert(!prompt.message.includes('White box'), 'tab chrome leaked into the question message');

    const answers = [
      { question_id: 'white_box', choice_ids: ['white_box__other'], other_text: 'Use the bounded fallback' },
      { question_id: 'checks', choice_ids: ['checks__tests', 'checks__docs'] },
    ];
    const result = await page.evaluate(async source => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      return new AsyncFunction('d', source)(document);
    }, selectors._buildQuestionAnswerExpr(answers));
    assert.strictEqual(result, 'clicked');
    const applied = await page.evaluate(() => ({
      other: document.querySelector('input').value,
      radio: document.querySelector('[role=radio]:nth-of-type(2)')?.getAttribute('aria-checked'),
      checked: [...document.querySelectorAll('[role=checkbox]')].map(row => row.getAttribute('aria-checked')),
      submitted: window.submitted === true,
    }));
    assert.strictEqual(applied.other, 'Use the bounded fallback');
    assert.deepStrictEqual(applied.checked, ['true', 'true']);
    assert.strictEqual(applied.submitted, true);
    console.log(JSON.stringify({
      ok: true,
      questions: prompt.questions.length,
      choices: prompt.choices.length,
      multi_select: true,
      other_text: true,
      element_level_chrome_exclusion: true,
      native_submit: true,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
