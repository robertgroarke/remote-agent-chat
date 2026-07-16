#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const sessionId = 'keyboard-prompt-fixture';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function contentType(filePath) {
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const responses = [];
  let fixtureSocket;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)
      || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  const send = payload => fixtureSocket?.readyState === fixtureSocket?.OPEN
    && fixtureSocket.send(JSON.stringify(payload));
  const showPrompt = prompt => send({
    type: 'permission_prompt', session_id: sessionId, timeout_ms: 300000, ...prompt,
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    let acknowledged = false;
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sid = message.session_id || message.session;
      if (!acknowledged && ['connection_hello', 'hello', 'subscribe'].includes(message.type)) {
        acknowledged = true;
        send({
          type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
          sessions: [{
            session_id: sessionId, agent_type: 'claude', title: 'Keyboard prompt fixture',
            chat_title: 'Keyboard prompt fixture', status: 'healthy', workspace_name: 'Remote Agent Chat',
            is_test_session: false,
          }],
          workspaces: [],
        });
      }
      if (message.type === 'permission_response') responses.push(message);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, capabilities: {} });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail',
          replace: message.replace !== false, messages: [{ role: 'assistant', content: 'Prompt keyboard fixture ready.', sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: 'Prompt keyboard fixture ready.', sequence: 1 }] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1 });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let originalUrl;
  let originalViewport;
  let originalTheme;
  const browserDiagnostics = [];
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    [page] = pages;
    page.on('console', message => browserDiagnostics.push({ type: `console:${message.type()}`, text: message.text() }));
    page.on('pageerror', error => browserDiagnostics.push({ type: 'pageerror', text: error.message }));
    originalUrl = page.url();
    originalViewport = page.viewportSize();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    originalTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    try {
      await page.locator(`.session-card[data-session-id="${sessionId}"]`).waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        url: location.href,
        body: document.body?.innerText?.slice(0, 2000) || '',
        crash: sessionStorage.getItem('agent-chat:last-render-error'),
        windowError: sessionStorage.getItem('agent-chat:last-window-error'),
        promiseError: sessionStorage.getItem('agent-chat:last-promise-error'),
      })).catch(() => ({}));
      throw new Error(`${error.message}\nfixture diagnostics=${JSON.stringify({ state, browserDiagnostics }, null, 2)}`);
    }

    showPrompt({
      prompt_id: 'generic-default', message: 'Allow the default action?', default_choice: 'allow',
      choices: [{ choice_id: 'deny', label: 'Deny' }, { choice_id: 'allow', label: 'Allow' }],
    });
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 3000 });
    assert.deepStrictEqual(await page.locator('.permission-key-hint').allTextContents(), ['1', '2']);
    await page.locator('.input-area textarea').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.strictEqual(responses[0]?.choice_id, 'allow', 'Enter did not submit the default choice');

    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'generic-default' });
    await page.waitForFunction(() => !document.querySelector('.permission-card'));
    showPrompt({
      prompt_id: 'generic-selected', message: 'Choose with a number key.', default_choice: 'allow',
      choices: [{ choice_id: 'deny', label: 'Deny' }, { choice_id: 'allow', label: 'Allow' }],
    });
    await page.waitForFunction(() => document.querySelector('.permission-card')?.textContent.includes('Choose with a number key.'));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('1');
    assert.strictEqual(responses.length, 1, 'number key submitted instead of selecting');
    assert.strictEqual(await page.locator('.permission-action.selected').innerText().then(value => value.replace(/\s+/g, ' ').trim()), '1 Deny');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.strictEqual(responses[1]?.choice_id, 'deny', 'Enter did not submit the numbered selection');

    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'generic-selected' });
    await page.waitForFunction(() => !document.querySelector('.permission-card'));
    showPrompt({
      prompt_id: 'claude-native-action',
      title: 'Allow this bash command?',
      command: 'powershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION"',
      description: 'Echo permission test string',
      message: 'Allow this bash command?\npowershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION"\nEcho permission test string',
      alternate_instruction_supported: true,
      alternate_instruction_placeholder: 'Tell Claude what to do instead',
      cancel_hint: 'Esc to cancel',
      choices: [
        { choice_id: '1_yes', shortcut: '1', label: 'Yes' },
        { choice_id: '2_yes_for_project', shortcut: '2', label: 'Yes, allow powershell -NoPro… for this project (just you)' },
        { choice_id: '3_no', shortcut: '3', label: 'No' },
      ],
    });
    await page.waitForFunction(() => document.querySelector('.permission-card-claude')?.textContent.includes('Allow this bash command?'));
    assert.strictEqual(await page.locator('.permission-title-claude').innerText(), 'Allow this bash command?');
    assert.strictEqual(await page.locator('.permission-command-claude').innerText(), 'powershell -NoProfile -Command "Write-Output RAC_CLAUDE_PERMISSION"');
    assert.deepStrictEqual(
      (await page.locator('.permission-card-claude .permission-action').allInnerTexts())
        .map(value => value.replace(/\s+/g, ' ').trim()),
      [
        '1 Yes',
        '2 Yes, allow powershell -NoPro… for this project (just you)',
        '3 No',
      ],
    );
    assert.strictEqual(await page.locator('.permission-card-claude .permission-action.selected').count(), 1);
    const nativeWebScreenshot = outputPath
      ? path.join(path.dirname(outputPath), 'claude-native-dark-permission-web.png') : null;
    if (nativeWebScreenshot) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.locator('.permission-card-claude').screenshot({ path: nativeWebScreenshot, animations: 'disabled' });
    }
    await page.locator('.permission-alternate-input').fill('Do not run it; explain what the command would do.');
    await page.locator('.permission-alternate-input').press('Enter');
    await page.waitForTimeout(50);
    assert.strictEqual(responses[2]?.instruction, 'Do not run it; explain what the command would do.');

    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'claude-native-action' });
    await page.waitForFunction(() => !document.querySelector('.permission-card'));
    showPrompt({
      prompt_id: 'claude-native-escape',
      title: 'Allow this bash command?',
      command: 'echo RAC_CLAUDE_ESCAPE',
      description: 'Echo permission escape test',
      message: 'Allow this bash command?\necho RAC_CLAUDE_ESCAPE\nEcho permission escape test',
      alternate_instruction_supported: true,
      alternate_instruction_placeholder: 'Tell Claude what to do instead',
      cancel_hint: 'Esc to cancel',
      choices: [
        { choice_id: '1_yes', shortcut: '1', label: 'Yes' },
        { choice_id: '2_yes_for_project', shortcut: '2', label: 'Yes for this project' },
        { choice_id: '3_no', shortcut: '3', label: 'No' },
      ],
    });
    await page.waitForFunction(() => document.querySelector('.permission-card-claude')?.textContent.includes('RAC_CLAUDE_ESCAPE'));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.strictEqual(responses[3]?.choice_id, '3_no', 'Claude native Escape did not submit the negative choice');

    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'claude-native-escape' });
    await page.waitForFunction(() => !document.querySelector('.permission-card'));
    showPrompt({
      prompt_id: 'structured', kind: 'question', message: 'Answer both questions.', submit_label: 'Submit answers',
      questions: [
        { question_id: 'q1', label: 'Scope', message: 'Which scope?', multi_select: false, choices: [{ label: 'Default scope' }, { label: 'Other', requires_text: true }] },
        { question_id: 'q2', label: 'Checks', message: 'Which checks?', multi_select: true, choices: [{ label: 'Tests' }, { label: 'Lint' }, { label: 'Docs' }] },
      ],
    });
    await page.waitForFunction(() => document.querySelector('.permission-card')?.textContent.includes('Answer both questions.'));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('2');
    const otherInput = page.locator('.permission-other-input');
    await otherInput.fill('Custom scope');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('3');
    await page.keyboard.press('5');
    assert.strictEqual(responses.length, 4, 'structured number keys submitted prematurely');
    const screenshotDir = outputPath ? path.dirname(outputPath) : null;
    const desktopScreenshot = screenshotDir ? path.join(screenshotDir, 'keyboard-prompt-structured-dark-desktop.png') : null;
    const mobileScreenshot = screenshotDir ? path.join(screenshotDir, 'keyboard-prompt-structured-light-mobile.png') : null;
    if (desktopScreenshot) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.locator('.permission-card').evaluate(node => { node.scrollTop = 0; });
      await page.locator('.permission-card').screenshot({ path: desktopScreenshot, animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.locator('.permission-card').evaluate(node => { node.scrollTop = 0; });
      await page.locator('.permission-card').screenshot({ path: mobileScreenshot, animations: 'disabled' });
      if (originalViewport) await page.setViewportSize(originalViewport);
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme || 'dark'), originalTheme);
    }
    await otherInput.focus();
    await page.keyboard.type('1');
    assert.strictEqual(await otherInput.inputValue(), 'Custom scope1', 'number key was captured while typing Other text');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.deepStrictEqual(responses[4]?.answers, [
      { question_id: 'q1', choice_ids: ['choice-1'], other_text: 'Custom scope1' },
      { question_id: 'q2', choice_ids: ['choice-0', 'choice-2'] },
    ]);

    send({ type: 'permission_prompt_expired', session_id: sessionId, prompt_id: 'structured' });
    await page.waitForFunction(() => !document.querySelector('.permission-card'));
    showPrompt({
      prompt_id: 'escape-focus', message: 'Return focus without responding.', default_choice: 'stay',
      choices: [{ choice_id: 'stay', label: 'Stay' }],
    });
    await page.waitForFunction(() => document.querySelector('.permission-card')?.textContent.includes('Return focus without responding.'));
    await page.locator('.permission-action').focus();
    await page.keyboard.press('Escape');
    const composerState = await page.locator('.input-area textarea').evaluate(node => ({
      focused: document.activeElement === node, readOnly: node.readOnly, disabled: node.disabled,
    }));
    assert.deepStrictEqual(composerState, { focused: false, readOnly: false, disabled: true });
    assert.strictEqual(await page.locator('.permission-action.selected').count(), 0, 'dismissed prompt still captured composer number typing');
    assert.strictEqual(responses.length, 5, 'Escape responded to a prompt without a negative choice');
    assert.strictEqual(await page.locator('.permission-card').count(), 1, 'Escape discarded the unresolved prompt');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      persistent_browser_pages: pages.length,
      generic_default_enter: responses[0]?.choice_id,
      generic_number_then_enter: responses[1]?.choice_id,
      claude_native_instruction: responses[2]?.instruction,
      claude_native_escape_choice: responses[3]?.choice_id,
      claude_native_selected_choice_count: 1,
      structured_answers: responses[4]?.answers,
      other_input_enter_submitted: true,
      escape_composer_state: composerState,
      unresolved_escape_kept_blocking_composer: true,
      unresolved_prompt_preserved_after_escape: true,
      permission_responses: responses.length,
      visible_windows_opened: 0,
      external_focus_actions: 0,
      user_messages_sent: 0,
      unrelated_controls_invoked: 0,
      screenshots: [nativeWebScreenshot, desktopScreenshot, mobileScreenshot].filter(Boolean).map(file => path.relative(root, file)),
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
