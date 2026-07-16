#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const guard = require('../agent-proxy/vscode-probe-guard');
const selectors = require('../agent-proxy/selectors');
const {
  captureHiddenLightWorkbench,
  nativeFileChangeSurface,
  ownedChangeState,
  readMessages,
  withTimeout,
} = require('./vscode-claude-file-change-native-e2e');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');

function assertEvidencePath(output, extension, label) {
  assert(output, `--${label} is required`);
  const relative = path.relative(EVIDENCE_ROOT, output);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} output must stay under the evidence tree`);
  assert.equal(path.extname(output).toLowerCase(), extension, `${label} output must use ${extension}`);
}

function parseArgs(argv) {
  const options = { readOnly: false, sessionId: '', marker: '', screenshot: '', resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--session-id') options.sessionId = String(argv[++index] || '').trim();
    else if (arg === '--marker') options.marker = String(argv[++index] || '').trim();
    else if (arg === '--screenshot') options.screenshot = path.resolve(argv[++index] || '');
    else if (arg === '--result-file') options.resultFile = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnly, 'Explicit --read-only is required');
  assert(/^[0-9a-f-]{36}$/i.test(options.sessionId), '--session-id must be an explicit UUID');
  assert(/^RAC_CLAUDE_FILE_CHANGE_[0-9a-f]{8}$/.test(options.marker), '--marker must be an exact owned file-change marker');
  assertEvidencePath(options.screenshot, '.png', 'screenshot');
  assertEvidencePath(options.resultFile, '.json', 'result-file');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const settingsPath = guard.assertUpdatesDisabled('VS Code Claude retained file-change native capture');
  assert.equal(guard.CDP_PORT, 9230, 'Retained capture is restricted to disposable CDP port 9230');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert(/light/i.test(String(settings['workbench.colorTheme'] || '')),
    'Disposable profile must explicitly select a light workbench theme');

  const targetSet = guard.assertTargetSet(await withTimeout(
    CDP.List({ port: guard.CDP_PORT }), 10000, 'Retained capture target discovery'),
    'claude', 'Claude retained file-change native capture');
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-proxy', 'session-store.json'), 'utf8'));
  const session = store.sessions?.[options.sessionId];
  assert(session, `Requested disposable Claude session is not stored: ${options.sessionId}`);
  assert(guard.isThrowawaySession(session, 'claude'), 'Requested Claude session is outside the exact disposable workspace');
  assert.equal(Number(session.cdp_port), guard.CDP_PORT, 'Requested Claude session uses the wrong CDP port');
  assert.equal(session.status, 'healthy', 'Requested Claude session is not healthy');
  assert.equal(session.target_id, targetSet.frame.id, 'Requested Claude session does not bind the exact live frame');

  const client = await withTimeout(
    CDP({ port: guard.CDP_PORT, target: targetSet.frame.id }),
    10000,
    'Retained capture Claude frame connection',
  );
  try {
    await withTimeout(client.Runtime.enable(), 10000, 'Retained capture Runtime.enable');
    client.Runtime._webviewId = (String(targetSet.frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await withTimeout(selectors.cacheInnerContextId(client.Runtime), 10000, 'Retained capture inner frame discovery');
    assert.equal(await withTimeout(selectors.detectPermissionDialog(client.Runtime, 'claude'),
      10000, 'Retained capture permission inspection'), null,
      'Disposable Claude has an active permission prompt');
    assert.equal((await withTimeout(selectors.detectThinking(client.Runtime, 'claude'),
      10000, 'Retained capture thinking inspection'))?.thinking, false,
      'Disposable Claude is still thinking');

    const messages = await withTimeout(
      readMessages(client.Runtime, session.session_id),
      20000,
      'Retained capture transcript read',
    );
    let promptIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user' && String(messages[index].content || '').includes(options.marker)) {
        promptIndex = index;
        break;
      }
    }
    assert(promptIndex >= 0, 'Owned file-change prompt is absent from the retained transcript');
    const retainedMessages = messages.slice(promptIndex);
    const state = ownedChangeState(retainedMessages, options.marker);
    assert(state.settled, 'Retained file-change turn is not canonically settled');
    const nativeSurface = await withTimeout(
      nativeFileChangeSurface(client.Runtime, options.marker),
      10000,
      'Retained capture native file-change inspection',
    );
    assert(nativeSurface.matching_visible_nodes > 0,
      `No visible retained native README file-change surface found: ${JSON.stringify(nativeSurface)}`);
    const capture = await captureHiddenLightWorkbench(targetSet.page, client.Runtime, options.screenshot);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      read_only: true,
      session_id: session.session_id,
      target_id: targetSet.frame.id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      marker: options.marker,
      prompt_message_index: promptIndex,
      final_messages: messages.length,
      retained_messages: retainedMessages.length,
      canonical_file_change_blocks: state.fileBlocks.length,
      canonical_final_markdown_blocks: state.finalMarkdownBlocks.length,
      owned_terminal_blocks: state.shellBlocks.length,
      native_surface: nativeSurface,
      native_capture: capture,
      protected_host: { port: 9223, untouched: true },
      safety: {
        sends: 0,
        controls: 0,
        permissions: 0,
        focus_actions: 0,
        visible_windows_opened: 0,
        new_windows_opened: 0,
      },
    };
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await withTimeout(client.close(), 3000, 'Retained capture Claude frame close').catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude retained file-change native capture: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
