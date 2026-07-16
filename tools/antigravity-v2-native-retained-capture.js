#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { PNG } = require('../frontend/node_modules/pngjs');
const selectors = require('../agent-proxy/selectors');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');

function parseArgs(argv) {
  const options = { retainedCapture: false, chatId: '', requireBlock: '', output: '', resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--retained-capture') options.retainedCapture = true;
    else if (arg === '--chat-id' && argv[index + 1]) options.chatId = String(argv[++index]);
    else if (arg === '--require-block' && argv[index + 1]) options.requireBlock = String(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.retainedCapture) throw new Error('Pass --retained-capture to acknowledge reversible conversation selection');
  if (!/^[0-9a-f-]{36}$/i.test(options.chatId)) throw new Error('A retained conversation UUID is required');
  if (!options.output || path.extname(options.output).toLowerCase() !== '.png') throw new Error('--output must be a PNG');
  if (!options.resultFile || path.extname(options.resultFile).toLowerCase() !== '.json') throw new Error('--result-file must be JSON');
  for (const [label, file] of [['output', options.output], ['result', options.resultFile]]) {
    const relative = path.relative(EVIDENCE_ROOT, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} must stay under the evidence tree`);
    }
  }
  return options;
}

async function pageState(Runtime) {
  const raw = await selectors.evalInPage(Runtime, `
    return JSON.stringify({
      focus: d.hasFocus(),
      visibility: d.visibilityState,
      href: location.href,
      title: d.title,
      scroll_y: scrollY
    });
  `);
  return JSON.parse(raw);
}

function blockInventory(messages) {
  const blocks = messages.flatMap(message => Array.isArray(message.content_blocks) ? message.content_blocks : []);
  const counts = {};
  for (const block of blocks) counts[block.type] = (counts[block.type] || 0) + 1;
  return { types: Object.keys(counts).sort(), counts };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const targets = await CDP.List({ port: 9226 });
  const pages = targets.filter(target => target.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\/c\//i.test(String(target.url || '')));
  if (pages.length !== 1) throw new Error(`Expected one Antigravity v2 conversation page, found ${pages.length}`);

  const client = await CDP({ port: 9226, target: pages[0].id });
  let original = null;
  let switched = false;
  let screenshotBuffer = null;
  let captureState = null;
  let targetChat = null;
  let inventory = null;
  let restoreResult = null;
  let afterRestore = null;
  let afterRestoreState = null;
  try {
    await client.Runtime.enable();
    await client.Page.enable();
    original = await selectors.readAntigravityV2ActiveConversation(client.Runtime);
    const before = await pageState(client.Runtime);
    if (!original?.conversation_id) throw new Error('The original Antigravity v2 conversation is not identifiable');
    if (before.focus || before.visibility !== 'hidden') {
      throw new Error(`Refusing retained capture while native page is ${before.focus ? 'focused' : before.visibility}`);
    }

    const chats = await selectors.readAntigravityV2ChatList(client.Runtime);
    targetChat = chats.find(chat => chat.kind === 'chat' && chat.id === options.chatId);
    if (!targetChat) throw new Error(`Retained conversation ${options.chatId} is not in the visible guarded inventory`);
    if (targetChat.active || options.chatId === original.conversation_id) throw new Error('Target must be a different retained conversation');

    const switchResult = await selectors.switchAntigravityV2Chat(client.Runtime, options.chatId);
    if (!switchResult?.ok) throw new Error(`Retained conversation switch failed: ${switchResult?.code || 'unknown'}`);
    switched = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    captureState = await pageState(client.Runtime);
    if (captureState.focus || captureState.visibility !== 'hidden') {
      throw new Error('Native page became visible or focused during retained capture');
    }

    const raw = await selectors.readMessages(client.Runtime, 'antigravity-v2', 'native-retained-capture');
    const messages = JSON.parse(raw || '[]');
    inventory = blockInventory(messages);
    if (options.requireBlock && !inventory.types.includes(options.requireBlock)) {
      throw new Error(`Required block ${options.requireBlock} is absent from retained conversation`);
    }
    const screenshot = await client.Page.captureScreenshot({
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    screenshotBuffer = Buffer.from(screenshot.data, 'base64');
  } finally {
    if (switched && original?.conversation_id) {
      restoreResult = await selectors.switchAntigravityV2Chat(client.Runtime, original.conversation_id);
      await new Promise(resolve => setTimeout(resolve, 700));
      afterRestore = await selectors.readAntigravityV2ActiveConversation(client.Runtime);
      afterRestoreState = await pageState(client.Runtime);
    }
    await client.close();
  }

  if (!restoreResult?.ok || afterRestore?.conversation_id !== original.conversation_id) {
    throw new Error('Original Antigravity v2 conversation was not restored; evidence was not written');
  }
  if (afterRestoreState.focus || afterRestoreState.visibility !== 'hidden') {
    throw new Error('Native page was not hidden and unfocused after restoration; evidence was not written');
  }
  if (!screenshotBuffer) throw new Error('No retained screenshot was captured');

  const png = PNG.sync.read(screenshotBuffer);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, screenshotBuffer);
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    controlled_navigation: true,
    port: 9226,
    target: { id: pages[0].id, title: pages[0].title, url: pages[0].url },
    original_conversation: original,
    retained_conversation: { id: targetChat.id, title: targetChat.title, project: targetChat.project },
    capture_state: captureState,
    block_inventory: inventory,
    restoration: {
      ok: true,
      result: restoreResult,
      active: afterRestore,
      page_state: afterRestoreState,
    },
    output: path.relative(ROOT, options.output).replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(screenshotBuffer).digest('hex'),
    width: png.width,
    height: png.height,
    bytes: screenshotBuffer.length,
    conversation_switches: 2,
    focus_actions: 0,
    scroll_actions: 0,
    sends: 0,
    mutating_controls: 0,
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

module.exports = { blockInventory, main, pageState, parseArgs };
