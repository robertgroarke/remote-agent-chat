#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');
const production = require('./vscode-extension-production-e2e');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = { resultFile: '', timeoutMs: 240000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
    else if (argv[i] === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
  }
  return options;
}

async function requestConfig(relay, sessionId) {
  const requestId = `codex-rich-config-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return production.waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config' && message.request_id === requestId
    ),
    30000,
    'Codex rich-control config',
  );
}

async function requestPayload(relay, sessionId, type) {
  const start = relay.messages.length;
  await production.control(relay.ws, relay.messages, sessionId, type);
  return production.waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === type && (message.session_id === sessionId || message.session === sessionId)
    ),
    30000,
    `${type} payload`,
  );
}

async function readAttachmentState(native, filename) {
  return selectors.evalInFrame(native.client.Runtime, `
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    }
    var filename = ${JSON.stringify(filename)};
    var input = d.querySelector('input[type="file"]');
    var inputNames = input && input.files ? Array.from(input.files).map(function(file) { return file.name; }) : [];
    var visibleMatches = Array.from(d.querySelectorAll('button, div, span, li')).filter(function(el) {
      return visible(el) && (el.textContent || '').trim().indexOf(filename) >= 0;
    }).length;
    var removeButtons = Array.from(d.querySelectorAll('button[aria-label]')).filter(function(button) {
      return button.getAttribute('aria-label') === 'Remove ' + filename;
    }).length;
    return {
      input_names: inputNames,
      visible_filename_matches: visibleMatches,
      remove_button_count: removeButtons,
      blob_images: d.querySelectorAll('img[src^="blob:"]').length,
      accepted: inputNames.indexOf(filename) >= 0 || visibleMatches > 0 || removeButtons > 0
    };
  `);
}

function entriesText(entries) {
  return JSON.stringify(entries || []).toLowerCase();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Codex rich-controls E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Rich-controls E2E is restricted to disposable CDP port 9230');

  const runId = `codex-rich-${Date.now().toString(36)}`;
  const marker = `RAC_CODEX_RICH_${runId.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
  const terminalMarker = `${marker}_TERMINAL`;
  const filename = 'README.md';
  const attachmentName = `rac-codex-rich-${runId}.png`;
  const outputPath = path.join(guard.WORKSPACE_PATH, filename);
  const originalFile = fs.readFileSync(outputPath);
  const originalFileSha256 = crypto.createHash('sha256').update(originalFile).digest('hex');
  let workspaceRestored = false;
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    run_id: runId,
    marker,
    terminal_marker: terminalMarker,
    cdp_port: guard.CDP_PORT,
    workspace: guard.WORKSPACE_PATH,
    stages: [],
  };

  let native;
  let relay;
  try {
    native = await production.openNative('codex');
    relay = await production.openRelay();
    const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
    const session = await production.waitFor(
      () => guard.pickSessionForFrame(production.latestSessions(relay.messages), 'codex', store, native.frame),
      30000,
      'guarded Codex rich-control session',
    );
    const stored = guard.assertStoreBinding(store, session, native.frame);
    const sessionId = session.session_id;
    result.session_id = sessionId;
    result.target_id = stored.target_id;
    result.stages.push('guard');

    const config = await requestConfig(relay, sessionId);
    for (const capability of ['terminal_output', 'file_changes', 'send_attachment']) {
      assert.equal(config.capabilities?.[capability], true, `Codex did not advertise ${capability}`);
    }
    result.capabilities = {
      terminal_output: config.capabilities.terminal_output,
      file_changes: config.capabilities.file_changes,
      send_attachment: config.capabilities.send_attachment,
    };
    result.stages.push('config');

    const baselineChats = await production.requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex rich baseline');
    const baselineIds = new Set(baselineChats.map(chat => chat?.id).filter(Boolean));
    result.baseline_chat_count = baselineIds.size;

    await production.control(relay.ws, relay.messages, sessionId, 'new_chat');
    await production.waitFor(async () => {
      const state = await production.readNative(native, 'codex', sessionId);
      return state.messages.length === 0 ? state : null;
    }, 30000, 'empty owned Codex rich-control task');
    result.stages.push('new_chat');

    await production.control(relay.ws, relay.messages, sessionId, 'send_attachment', {
      data: PNG_1X1,
      mime_type: 'image/png',
      filename: attachmentName,
    });
    const attachmentState = await production.waitFor(async () => {
      const state = await readAttachmentState(native, attachmentName);
      return state?.accepted ? state : null;
    }, 30000, 'native Codex attachment chip');
    result.attachment = { filename: attachmentName, mime_type: 'image/png', ...attachmentState };
    result.stages.push('send_attachment');

    const prompt = [
      `Ignore the attached one-pixel test image except to keep it attached to this request.`,
      `Use a file editing tool, not a terminal command, to append a new final line containing exactly ${marker} to ${filename}.`,
      `Do not modify any other file. After the edit finishes, reply exactly ${marker} and nothing else.`,
    ].join(' ');
    const clientMessageId = `codex-rich-send-${crypto.randomBytes(4).toString('hex')}`;
    const sendStart = relay.messages.length;
    relay.ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: clientMessageId }));
    const delivery = await production.waitFor(
      () => relay.messages.slice(sendStart).find(message =>
        message.type === 'proxy_send_result' && message.client_message_id === clientMessageId
      ),
      60000,
      'Codex rich-control prompt delivery',
      50,
    );
    assert.equal(delivery.result, 'delivered', JSON.stringify(delivery));

    const settled = await production.waitFor(async () => {
      const state = await production.readNative(native, 'codex', sessionId);
      const hasUser = state.messages.some(message => message.role === 'user' && String(message.content || '').includes(marker));
      const hasAssistant = state.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(marker));
      return hasUser && hasAssistant && !state.thinking?.thinking ? state : null;
    }, options.timeoutMs, 'Codex rich-control completion', 250);
    result.native_message_count = settled.messages.length;
    result.output_file_exists = fs.existsSync(outputPath);
    assert.equal(result.output_file_exists, true, `Codex did not preserve ${outputPath}`);
    assert(fs.readFileSync(outputPath, 'utf8').includes(marker), 'Codex did not append the owned marker');
    result.stages.push('tool_task_complete');

    const changes = await requestPayload(relay, sessionId, 'file_changes');
    const changeEntries = changes.entries || [];
    assert(changeEntries.length > 0, 'file_changes returned no entries for the owned file task');
    const changesText = entriesText(changeEntries);
    assert(
      changesText.includes(filename.toLowerCase()) || changesText.includes(marker.toLowerCase()),
      'file_changes did not contain the owned filename or marker',
    );
    result.file_changes = { entries: changeEntries.length, marker_or_filename_matched: true };
    result.stages.push('file_changes');

    fs.writeFileSync(outputPath, originalFile);
    workspaceRestored = true;
    result.workspace_restored = true;
    result.workspace_sha256 = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
    assert.equal(result.workspace_sha256, originalFileSha256, 'Disposable README was not restored exactly');
    result.stages.push('workspace_restored');

    const terminalPrompt = [
      `Use the terminal tool to run a PowerShell command that prints exactly ${terminalMarker}.`,
      `Do not read or edit any file. After the command finishes, reply exactly ${terminalMarker} and nothing else.`,
    ].join(' ');
    const terminalMessageId = `codex-rich-terminal-${crypto.randomBytes(4).toString('hex')}`;
    const terminalSendStart = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'send',
      session: sessionId,
      content: terminalPrompt,
      client_message_id: terminalMessageId,
    }));
    const terminalDelivery = await production.waitFor(
      () => relay.messages.slice(terminalSendStart).find(message =>
        message.type === 'proxy_send_result' && message.client_message_id === terminalMessageId
      ),
      60000,
      'Codex terminal prompt delivery',
      50,
    );
    assert.equal(terminalDelivery.result, 'delivered', JSON.stringify(terminalDelivery));
    const terminalSettled = await production.waitFor(async () => {
      const state = await production.readNative(native, 'codex', sessionId);
      const hasUser = state.messages.some(message =>
        message.role === 'user' && String(message.content || '').includes(terminalMarker)
      );
      const hasAssistant = state.messages.some(message =>
        message.role === 'assistant' && String(message.content || '').includes(terminalMarker)
      );
      return hasUser && hasAssistant && !state.thinking?.thinking ? state : null;
    }, options.timeoutMs, 'Codex terminal completion', 250);
    result.native_message_count = terminalSettled.messages.length;
    result.stages.push('terminal_task_complete');

    const terminal = await requestPayload(relay, sessionId, 'terminal_output');
    const terminalEntries = terminal.entries || [];
    assert(terminalEntries.length > 0, 'terminal_output returned no entries for the owned terminal turn');
    const terminalText = entriesText(terminalEntries);
    assert(terminalText.includes(terminalMarker.toLowerCase()), 'terminal_output did not contain the owned marker');
    result.terminal_output = { entries: terminalEntries.length, marker_matched: true };
    result.stages.push('terminal_output');

    const finalChats = await production.requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex rich owned');
    const introduced = finalChats.filter(chat => chat?.id && !baselineIds.has(chat.id));
    assert.equal(introduced.length, 1, `Owned Codex task UUID was not unique: ${JSON.stringify(introduced)}`);
    result.owned_chat = { id: introduced[0].id, title: introduced[0].title || introduced[0].label || null };
    result.stages.push('owned_chat_identified');

    result.ok = true;
    result.protected_host = { port: 9223, untouched: true };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    result.error = error.message;
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    throw error;
  } finally {
    try { if (relay) relay.ws.close(); } catch {}
    try { if (native) await native.client.close(); } catch {}
    if (!workspaceRestored) {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.writeFileSync(outputPath, originalFile);
          workspaceRestored = true;
          break;
        } catch { await sleep(250); }
      }
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Codex rich-controls E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, readAttachmentState };
