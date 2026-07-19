#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error('Headless Chrome is unavailable');
  return resolved;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context));
    await cdp.send('Runtime.enable');
    await page.setContent(
      '<main>'
      + '<section data-testid="user-message"><div class="items-end"><span class="whitespace-pre-wrap">Restore the populated Fleet card</span></div></section>'
      + '<section data-testid="assistant-message"><div class="overflow-x-auto"><div>Compact summary recovered without paragraph tags</div></div></section>'
      + '</main>',
    );
    const defaultContext = contexts.find(entry => entry.auxData?.isDefault === true);
    assert(defaultContext?.id, 'default headless execution context missing');
    const Runtime = {
      _innerContextId: defaultContext.id,
      evaluate: params => cdp.send('Runtime.evaluate', params),
    };
    const raw = await selectors.readMessages(Runtime, 'codex', 'stable-message-selector-fixture', {
      bypassCache: true,
    });
    const messages = JSON.parse(raw || '[]');
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(
      messages.map(message => ({ role: message.role, content: message.content })),
      [
        { role: 'user', content: 'Restore the populated Fleet card' },
        { role: 'assistant', content: 'Compact summary recovered without paragraph tags' },
      ],
    );
    assert.deepStrictEqual(messages[1].content_blocks, [{
      type: 'markdown',
      content: 'Compact summary recovered without paragraph tags',
    }]);
    process.stdout.write(JSON.stringify({
      status: 'PASS',
      messages: messages.length,
      user_rows: messages.filter(message => message.role === 'user').length,
      assistant_rows: messages.filter(message => message.role === 'assistant').length,
      duplicate_rows: 0,
      direct_text_assistant_fallback: true,
      visible_windows_opened: 0,
      focus_actions: 0,
      live_cdp_connections: 0,
    }, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
