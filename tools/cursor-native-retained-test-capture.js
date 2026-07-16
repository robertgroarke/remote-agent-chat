#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { PNG } = require('../frontend/node_modules/pngjs');
const cursorSel = require('../agent-proxy/cursor-selectors');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');

function parseArgs(argv) {
  const options = {
    retainedTestCapture: false,
    retainedLiveCapture: false,
    inventoryOnly: false,
    agentId: '',
    requireBlock: '',
    output: '',
    resultFile: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--retained-test-capture') options.retainedTestCapture = true;
    else if (arg === '--retained-live-capture') options.retainedLiveCapture = true;
    else if (arg === '--inventory-only') options.inventoryOnly = true;
    else if (arg === '--agent-id' && argv[index + 1]) options.agentId = String(argv[++index]);
    else if (arg === '--require-block' && argv[index + 1]) options.requireBlock = String(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (options.retainedTestCapture === options.retainedLiveCapture) {
    throw new Error('Pass exactly one of --retained-test-capture or --retained-live-capture');
  }
  if (!/^[0-9a-f-]{36}$/i.test(options.agentId)) throw new Error('An archived Cursor agent UUID is required');
  if (!options.inventoryOnly && !options.requireBlock) throw new Error('--require-block is required for screenshot capture');
  if (options.inventoryOnly && options.output) throw new Error('--inventory-only does not accept --output');
  if (!options.inventoryOnly && (!options.output || path.extname(options.output).toLowerCase() !== '.png')) {
    throw new Error('--output must be a PNG for screenshot capture');
  }
  if (!options.resultFile || path.extname(options.resultFile).toLowerCase() !== '.json') {
    throw new Error('--result-file must be JSON');
  }
  for (const [label, file] of [['output', options.output], ['result', options.resultFile]]) {
    if (!file) continue;
    const relative = path.relative(EVIDENCE_ROOT, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} must stay under the evidence tree`);
    }
  }
  return options;
}

async function pageState(Runtime) {
  const evaluated = await Runtime.evaluate({
    expression: `JSON.stringify({
      focus: document.hasFocus(),
      visibility: document.visibilityState,
      href: location.href,
      title: document.title,
      scroll_y: scrollY
    })`,
    returnByValue: true,
  });
  return JSON.parse(evaluated.result.value);
}

async function clickExactGlassAgent(Runtime, agentId) {
  const evaluated = await Runtime.evaluate({
    expression: `(function() {
      function reactFiberKey(el) {
        var property = Object.getOwnPropertyNames(el).find(function(key) {
          return key.indexOf('__reactFiber$') === 0;
        });
        var fiber = property ? el[property] : null;
        for (var depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
          var key = typeof fiber.key === 'string' ? fiber.key : '';
          if (/^\\.\\$[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
            return key.substring(2);
          }
        }
        return '';
      }
      var expected = ${JSON.stringify(agentId)};
      var matches = Array.from(document.querySelectorAll('.glass-sidebar-agent-menu-btn'))
        .filter(function(button) { return reactFiberKey(button) === expected; });
      if (matches.length !== 1) return 'exact-uuid-count-' + matches.length;
      matches[0].click();
      return 'clicked-exact-uuid';
    })()`,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || 'Exact Cursor UUID click failed');
  }
  return evaluated.result.value;
}

function blockInventory(messages) {
  const blocks = messages.flatMap(message => Array.isArray(message.content_blocks) ? message.content_blocks : []);
  const counts = {};
  for (const block of blocks) counts[block.type] = (counts[block.type] || 0) + 1;
  return { types: Object.keys(counts).sort(), counts };
}

function oneActiveAgent(agents) {
  const active = (agents || []).filter(agent => agent && agent.active);
  return active.length === 1 ? active[0] : null;
}

async function readSettledMessages(Runtime) {
  let previous = '';
  let stableReads = 0;
  for (let read = 1; read <= 15; read += 1) {
    const raw = await cursorSel.readCursorMessages(Runtime) || '[]';
    if (raw === previous) stableReads += 1;
    else stableReads = 0;
    previous = raw;
    if (stableReads >= 2) return { messages: JSON.parse(raw), reads: read };
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Archived Cursor transcript did not settle for three consecutive reads');
}

async function readStructuredDomInventory(Runtime) {
  const evaluated = await Runtime.evaluate({
    expression: `(function() {
      function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
      function kind(node) {
        var cls = String(node.className || '');
        if (/ui-thinking-collapsible/.test(cls)) return 'thinking';
        if (/ui-edit-tool-call/.test(cls)) return 'file_changes';
        if (/ui-shell-tool-call|ui-tool-call-card/.test(cls)) return 'tool_call';
        var header = norm((node.querySelector('.ui-collapsible-header') || {}).innerText || '');
        if (/^thought\\b|^thinking\\b/i.test(header)) return 'thinking';
        if (/^worked\\b|^taking longer\\b/i.test(header)) return 'status';
        if (/^edited\\s+\\d+\\s+files?(?:\\s+\\+\\d+)?(?:\\s+-\\d+)?$/i.test(header)) return 'file_changes';
        if (/explor|edit|search|ran |running|command|read |grep|glob|shell|creating|editing|monitored|background/i.test(header)) return 'tool_call';
        return 'status';
      }
      var nodes = Array.from(document.querySelectorAll(
        '.ui-thinking-collapsible, .ui-edit-tool-call, .ui-shell-tool-call, .ui-tool-call-card, .ui-step-group-collapsible, .ui-collapsible'
      ));
      return nodes.map(function(node) {
        var rect = node.getBoundingClientRect();
        var style = getComputedStyle(node);
        var header = node.querySelector('.ui-collapsible-header');
        var displayVisible = style.display !== 'none' && style.visibility !== 'hidden'
          && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        var inViewport = displayVisible && rect.bottom > 0 && rect.right > 0
          && rect.top < innerHeight && rect.left < innerWidth;
        return {
          type: kind(node),
          class_name: String(node.className || '').substring(0, 240),
          title: norm(header ? header.innerText : '').substring(0, 160),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display_visible: displayVisible,
          within_viewport: inViewport,
        };
      });
    })()`,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || 'Cursor structured DOM inventory failed');
  }
  return evaluated.result.value || [];
}

function exactRestoration(original, before, agents, after) {
  const active = oneActiveAgent(agents);
  return Boolean(
    active?.id === original?.id
    && after?.focus === false
    && after?.visibility === before?.visibility
    && after?.href === before?.href
    && after?.title === before?.title
    && after?.scroll_y === before?.scroll_y
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const targets = await CDP.List({ port: 9227 });
  const pages = targets.filter(target => target.type === 'page' && target.title === 'Cursor Agents');
  if (pages.length !== 1) throw new Error(`Expected one Cursor Agents page, found ${pages.length}`);

  const client = await CDP({ port: 9227, target: pages[0].id });
  let original = null;
  let target = null;
  let before = null;
  let captureState = null;
  let inventory = null;
  let messageCount = null;
  let settleReads = null;
  let domBlockSurfaces = null;
  let screenshotBuffer = null;
  let switched = false;
  let switchResult = null;
  let restoreResult = null;
  let restoredAgents = null;
  let restoredState = null;
  let primaryError = null;
  try {
    await client.Runtime.enable();
    await client.Page.enable();
    before = await pageState(client.Runtime);
    if (before.focus) throw new Error('Refusing retained capture while the Cursor page is focused');
    const agents = await cursorSel.readCursorAgentList(client.Runtime);
    original = oneActiveAgent(agents);
    if (!original) throw new Error('The original Cursor agent is not uniquely identifiable');
    target = agents.find(agent => agent && agent.id === options.agentId);
    if (!target) throw new Error(`Archived Cursor agent ${options.agentId} is not in the native inventory`);
    if (target.active) throw new Error('Target must be a different archived Cursor agent');
    if (options.retainedTestCapture
        && String(target.workspace_name || '').trim().toLowerCase() !== 'cursor-test') {
      throw new Error(`Refusing non-test Cursor workspace: ${target.workspace_name || 'unknown'}`);
    }
    if (options.retainedLiveCapture) {
      if (target.native_working !== false || !/done|complete|idle|seen/i.test(String(target.native_status || ''))) {
        throw new Error(`Refusing non-idle live Cursor agent: ${target.native_status || 'unknown'}`);
      }
      if (target.source !== 'glass-sidebar') throw new Error(`Refusing ambiguous live Cursor source: ${target.source || 'unknown'}`);
    }

    switchResult = await cursorSel.switchCursorAgent(client.Runtime, target.id);
    const afterSharedAttempt = oneActiveAgent(await cursorSel.readCursorAgentList(client.Runtime));
    if (afterSharedAttempt?.id !== original.id) switched = true;
    if (!switchResult?.ok && afterSharedAttempt?.id === target.id) {
      switchResult = { ok: true, detail: 'shared-selector-clicked-and-active' };
    }
    if (!switchResult?.ok && target.source === 'glass-sidebar') {
      const direct = await clickExactGlassAgent(client.Runtime, target.id);
      if (direct === 'clicked-exact-uuid') {
        switched = true;
        switchResult = { ok: true, detail: 'archived-test-exact-uuid-click' };
      } else {
        switchResult = { ok: false, detail: `${switchResult?.detail || 'unknown'}; ${direct}` };
      }
    }
    if (!switchResult?.ok) throw new Error(`Archived Cursor agent switch failed: ${switchResult?.detail || 'unknown'}`);
    switched = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    captureState = await pageState(client.Runtime);
    if (captureState.focus) throw new Error('Cursor page became focused during retained capture');
    const selectedAgents = await cursorSel.readCursorAgentList(client.Runtime);
    if (oneActiveAgent(selectedAgents)?.id !== target.id) throw new Error('Archived Cursor target did not stay active');
    const settled = await readSettledMessages(client.Runtime);
    messageCount = settled.messages.length;
    settleReads = settled.reads;
    inventory = blockInventory(settled.messages);
    domBlockSurfaces = await readStructuredDomInventory(client.Runtime);
    if (options.requireBlock && !inventory.types.includes(options.requireBlock)) {
      throw new Error(`Required block ${options.requireBlock} is absent from archived Cursor agent`);
    }
    if (!options.inventoryOnly) {
      const screenshot = await client.Page.captureScreenshot({
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      screenshotBuffer = Buffer.from(screenshot.data, 'base64');
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (switched && original?.id) {
      try {
        restoreResult = await cursorSel.switchCursorAgent(client.Runtime, original.id);
        if (!restoreResult?.ok) {
          const direct = await clickExactGlassAgent(client.Runtime, original.id);
          restoreResult = direct === 'clicked-exact-uuid'
            ? { ok: true, detail: 'restore-exact-uuid-click' }
            : { ok: false, detail: `${restoreResult?.detail || 'unknown'}; ${direct}` };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        restoredAgents = await cursorSel.readCursorAgentList(client.Runtime);
        restoredState = await pageState(client.Runtime);
      } catch (restoreError) {
        primaryError = primaryError
          ? new Error(`${primaryError.message}; restoration also failed: ${restoreError.message}`)
          : restoreError;
      }
    } else if (original?.id) {
      try {
        restoredAgents = await cursorSel.readCursorAgentList(client.Runtime);
        restoredState = await pageState(client.Runtime);
        restoreResult = { ok: true, detail: 'not_switched' };
      } catch (stateError) {
        primaryError = primaryError
          ? new Error(`${primaryError.message}; unchanged-state verification also failed: ${stateError.message}`)
          : stateError;
      }
    }
    await client.close();
  }

  if (!restoreResult?.ok || !exactRestoration(original, before, restoredAgents, restoredState)) {
    throw new Error(`Original Cursor agent/page state was not restored exactly; evidence was not written${primaryError ? `; primary error: ${primaryError.message}` : ''}`);
  }
  if (primaryError) throw primaryError;
  if (!options.inventoryOnly && !screenshotBuffer) throw new Error('No retained Cursor screenshot was captured');

  const png = screenshotBuffer ? PNG.sync.read(screenshotBuffer) : null;
  if (screenshotBuffer) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, screenshotBuffer);
  }
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    capture_mode: options.retainedTestCapture ? 'archived_test' : 'completed_live_read_only',
    inventory_only: options.inventoryOnly,
    controlled_navigation: true,
    port: 9227,
    target: { id: pages[0].id, title: pages[0].title, url: pages[0].url },
    original_agent: { id: original.id, title: original.title, workspace_name: original.workspace_name },
    retained_agent: { id: target.id, title: target.title, workspace_name: target.workspace_name },
    original_page_state: before,
    capture_page_state: captureState,
    message_count: messageCount,
    settle_reads: settleReads,
    block_inventory: inventory,
    dom_block_surfaces: domBlockSurfaces,
    required_block_visible: domBlockSurfaces.some(surface => (
      surface.type === options.requireBlock && surface.within_viewport
    )),
    restoration: {
      ok: true,
      result: restoreResult,
      active_agent: oneActiveAgent(restoredAgents),
      page_state: restoredState,
    },
    output: screenshotBuffer ? path.relative(ROOT, options.output).replace(/\\/g, '/') : null,
    sha256: screenshotBuffer ? crypto.createHash('sha256').update(screenshotBuffer).digest('hex') : null,
    width: png?.width || null,
    height: png?.height || null,
    bytes: screenshotBuffer?.length || 0,
    conversation_switches: 2,
    focus_actions: 0,
    scroll_actions: 0,
    sends: 0,
    mutating_controls: 0,
    screenshots: screenshotBuffer ? 1 : 0,
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

module.exports = {
  blockInventory,
  clickExactGlassAgent,
  exactRestoration,
  main,
  oneActiveAgent,
  pageState,
  parseArgs,
  readSettledMessages,
  readStructuredDomInventory,
};
