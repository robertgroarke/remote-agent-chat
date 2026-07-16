#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return found;
}

function inputBox(id, value, isMain = false) {
  return `<div data-testid="continue-input-box-${isMain ? 'main-' : ''}${id}">
    <div class="scroll-container"><div contenteditable="true" data-testid="editor-input-${isMain ? 'main' : id}"><p>${value}</p></div></div>
    <button data-testid="submit-input-button" onclick="window.clicked='${id}'; const e=this.parentElement.querySelector('[contenteditable]'); e.innerHTML='<p><br></p>'">send</button>
  </div>`;
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe id="active-frame" style="width:500px;height:500px"></iframe>`);
    const frame = page.frames()[1];
    await frame.setContent(`<div class="overflow-y-scroll no-scrollbar flex-1">
      ${inputBox('historical-1', 'old one')}${inputBox('historical-2', 'old two')}
    </div>${inputBox('composer', '', true)}`);

    const Runtime = {
      evaluate: async ({ expression }) => {
        try {
          const value = await page.evaluate(source => (0, eval)(source), expression);
          return { result: { value } };
        } catch (error) {
          return { exceptionDetails: { text: error.message, exception: { description: error.stack } } };
        }
      },
    };
    {
      const sent = await selectors.sendMessage(Runtime, 'continue', 'fresh token', 'continue-composer-fixture');
      assert.strictEqual(sent.ok, true);
      const validState = await frame.evaluate(() => ({
        clicked: window.clicked,
        historical: Array.from(document.querySelectorAll('[data-testid^="editor-input-historical"]')).map(e => e.textContent.trim()),
        main: document.querySelector('[data-testid="editor-input-main"]').textContent.trim(),
      }));
      assert.strictEqual(validState.clicked, 'composer');
      assert.deepStrictEqual(validState.historical, ['old one', 'old two']);
      assert.strictEqual(validState.main, '');

      await frame.setContent(`<div class="overflow-y-scroll no-scrollbar flex-1">
        ${inputBox('historical-1', 'old one')}${inputBox('historical-2', 'old two')}
      </div>`);
      const rejected = await selectors.sendMessage(Runtime, 'continue', 'must not overwrite', 'continue-composer-fixture');
      assert.strictEqual(rejected.ok, false);
      const rejectedState = await frame.evaluate(() => Array.from(
        document.querySelectorAll('[data-testid^="editor-input-historical"]'),
        e => e.textContent.trim(),
      ));
      assert.deepStrictEqual(rejectedState, ['old one', 'old two']);
      console.log(JSON.stringify({ ok: true, main_composer_clicked: true, historical_only_fail_closed: true, visible_windows_opened: 0 }));
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
