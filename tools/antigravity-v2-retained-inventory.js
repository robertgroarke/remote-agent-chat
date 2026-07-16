#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const {
  blockInventory,
  pageState,
} = require('./antigravity-v2-native-retained-capture');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');

function parseArgs(argv) {
  const options = { retainedInventory: false, chatIds: [], resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--retained-inventory') options.retainedInventory = true;
    else if (arg === '--chat-id' && argv[index + 1]) options.chatIds.push(String(argv[++index]));
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.retainedInventory) {
    throw new Error('Pass --retained-inventory to acknowledge reversible conversation selection');
  }
  options.chatIds = [...new Set(options.chatIds)];
  if (!options.chatIds.length || options.chatIds.length > 8) {
    throw new Error('Provide between one and eight unique retained --chat-id values');
  }
  for (const chatId of options.chatIds) {
    if (!/^[0-9a-f-]{36}$/i.test(chatId)) throw new Error(`Invalid retained conversation UUID: ${chatId}`);
  }
  if (!options.resultFile || path.extname(options.resultFile).toLowerCase() !== '.json') {
    throw new Error('--result-file must be JSON');
  }
  const relative = path.relative(EVIDENCE_ROOT, options.resultFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('result must stay under the evidence tree');
  }
  return options;
}

function exactRestoration(original, before, active, after) {
  return Boolean(
    active?.conversation_id === original?.conversation_id
    && active?.section_id === original?.section_id
    && active?.url === original?.url
    && after?.href === before?.href
    && after?.title === before?.title
    && after?.scroll_y === before?.scroll_y
    && after?.focus === false
    && after?.visibility === 'hidden'
  );
}

async function executionInventory(Runtime) {
  const raw = await selectors.evalInPage(Runtime, `
    function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
    function increment(record, key) {
      if (!key) return;
      record[key] = (record[key] || 0) + 1;
    }
    var inventory = {
      segment_count: 0,
      step_count: 0,
      cases: {},
      statuses: {},
      value_keys: {},
      metadata_keys: {},
      result_payload_signals: {
        content: 0,
        raw_content: 0,
        results_array: 0,
        result_field: 0,
        output_field: 0,
        response_field: 0,
        stdout: 0,
        stderr: 0,
        exit_code: 0
      },
      terminal_like_steps: 0
    };
    var seenSegments = new Set();
    Array.from(d.querySelectorAll('[role="article"][aria-label="Agent response"]')).forEach(function(article) {
      Array.from(article.querySelectorAll('button')).forEach(function(button) {
        if (!/^(?:Worked for|Working|Thinking)/i.test(norm(button.innerText || button.textContent))) return;
        var fiberKey = Object.keys(button).find(function(key) { return key.indexOf('__reactFiber$') === 0; });
        var fiber = fiberKey ? button[fiberKey] : null;
        var segment = null;
        for (var depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
          var candidate = fiber.memoizedProps && fiber.memoizedProps.segment;
          if (candidate && Array.isArray(candidate.steps)) {
            segment = candidate;
            break;
          }
        }
        if (!segment || seenSegments.has(segment)) return;
        seenSegments.add(segment);
        inventory.segment_count += 1;
        segment.steps.forEach(function(step) {
          var payload = step && step.step;
          var stepCase = payload && payload.case || 'unknown';
          var value = payload && payload.value || {};
          var metadata = step && step.metadata || {};
          var keys = Object.keys(value);
          inventory.step_count += 1;
          increment(inventory.cases, stepCase);
          increment(inventory.statuses, String(step && step.status != null ? step.status : 'unknown'));
          keys.forEach(function(key) { increment(inventory.value_keys, key); });
          Object.keys(metadata).forEach(function(key) { increment(inventory.metadata_keys, key); });
          if (value.content != null) inventory.result_payload_signals.content += 1;
          if (value.rawContent != null) inventory.result_payload_signals.raw_content += 1;
          if (Array.isArray(value.results)) inventory.result_payload_signals.results_array += 1;
          if (value.result != null) inventory.result_payload_signals.result_field += 1;
          if (value.output != null) inventory.result_payload_signals.output_field += 1;
          if (value.response != null) inventory.result_payload_signals.response_field += 1;
          if (value.stdout != null) inventory.result_payload_signals.stdout += 1;
          if (value.stderr != null) inventory.result_payload_signals.stderr += 1;
          if (value.exitCode != null || value.exit_code != null) inventory.result_payload_signals.exit_code += 1;
          var terminalCases = ['runCommand', 'commandStatus', 'sendCommandInput'];
          var terminalKeys = ['command', 'commandLine', 'proposedCommandLine', 'requestedTerminalId',
            'terminalId', 'stdout', 'stderr', 'stdoutBuffer', 'stderrBuffer', 'combinedOutput',
            'combinedOutputSnapshot', 'exitCode', 'exit_code'];
          if (terminalCases.indexOf(stepCase) >= 0
              || /(?:terminal|shell|command|execute)/i.test(stepCase)
              || keys.some(function(key) { return terminalKeys.indexOf(key) >= 0; })) {
            inventory.terminal_like_steps += 1;
          }
        });
      });
    });
    return JSON.stringify(inventory);
  `);
  return raw ? JSON.parse(raw) : null;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const targets = await CDP.List({ port: 9226 });
  const pages = targets.filter(target => target.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\/c\//i.test(String(target.url || '')));
  if (pages.length !== 1) throw new Error(`Expected one Antigravity v2 conversation page, found ${pages.length}`);

  const client = await CDP({ port: 9226, target: pages[0].id });
  let original = null;
  let before = null;
  let restoreResult = null;
  let afterRestore = null;
  let afterRestoreState = null;
  let switchCount = 0;
  let primaryError = null;
  let originalInventory = null;
  const inventories = [];
  try {
    await client.Runtime.enable();
    original = await selectors.readAntigravityV2ActiveConversation(client.Runtime);
    before = await pageState(client.Runtime);
    if (!original?.conversation_id) throw new Error('The original Antigravity v2 conversation is not identifiable');
    if (before.focus || before.visibility !== 'hidden') {
      throw new Error(`Refusing retained inventory while native page is ${before.focus ? 'focused' : before.visibility}`);
    }
    const originalRaw = await selectors.readMessages(client.Runtime, 'antigravity-v2', 'native-retained-inventory-original');
    const originalMessages = JSON.parse(originalRaw || '[]');
    originalInventory = {
      message_count: originalMessages.length,
      block_inventory: blockInventory(originalMessages),
      execution_inventory: await executionInventory(client.Runtime),
    };

    const chats = await selectors.readAntigravityV2ChatList(client.Runtime);
    const retained = options.chatIds.map(chatId => {
      const chat = chats.find(candidate => candidate.kind === 'chat' && candidate.id === chatId);
      if (!chat) throw new Error(`Retained conversation ${chatId} is not in the visible guarded inventory`);
      if (chat.active || chat.id === original.conversation_id) {
        throw new Error(`Retained conversation ${chatId} is the active conversation`);
      }
      return chat;
    });

    for (const chat of retained) {
      const switchResult = await selectors.switchAntigravityV2Chat(client.Runtime, chat.id);
      if (!switchResult?.ok) {
        throw new Error(`Retained conversation switch failed for ${chat.id}: ${switchResult?.code || 'unknown'}`);
      }
      switchCount += 1;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const state = await pageState(client.Runtime);
      if (state.focus || state.visibility !== 'hidden') {
        throw new Error(`Native page became visible or focused while inventorying ${chat.id}`);
      }
      const active = await selectors.readAntigravityV2ActiveConversation(client.Runtime);
      if (active?.conversation_id !== chat.id) {
        throw new Error(`Retained conversation ${chat.id} did not become active`);
      }
      const raw = await selectors.readMessages(client.Runtime, 'antigravity-v2', 'native-retained-inventory');
      const messages = JSON.parse(raw || '[]');
      inventories.push({
        conversation: { id: chat.id, title: chat.title, project: chat.project },
        active,
        page_state: state,
        message_count: messages.length,
        block_inventory: blockInventory(messages),
        execution_inventory: await executionInventory(client.Runtime),
      });
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (switchCount > 0 && original?.conversation_id) {
      try {
        restoreResult = await selectors.switchAntigravityV2Chat(client.Runtime, original.conversation_id);
        switchCount += 1;
        await new Promise(resolve => setTimeout(resolve, 700));
        afterRestore = await selectors.readAntigravityV2ActiveConversation(client.Runtime);
        afterRestoreState = await pageState(client.Runtime);
      } catch (restoreError) {
        primaryError = primaryError
          ? new Error(`${primaryError.message}; restoration also failed: ${restoreError.message}`)
          : restoreError;
      }
    }
    await client.close();
  }

  if (!restoreResult?.ok || !exactRestoration(original, before, afterRestore, afterRestoreState)) {
    throw new Error(`Original Antigravity v2 conversation state was not restored exactly; evidence was not written${primaryError ? `; primary error: ${primaryError.message}` : ''}`);
  }
  if (primaryError) throw primaryError;

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    controlled_navigation: true,
    port: 9226,
    target: { id: pages[0].id, title: pages[0].title, url: pages[0].url },
    original_conversation: original,
    original_page_state: before,
    original_inventory: originalInventory,
    inventories,
    restoration: {
      ok: true,
      result: restoreResult,
      active: afterRestore,
      page_state: afterRestoreState,
    },
    conversation_switches: switchCount,
    focus_actions: 0,
    scroll_actions: 0,
    sends: 0,
    mutating_controls: 0,
    screenshots: 0,
    message_text_persisted: false,
    visible_windows_opened: 0,
  };
  fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
  fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { exactRestoration, executionInventory, main, parseArgs };
