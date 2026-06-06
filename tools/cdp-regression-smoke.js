#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');

function requireCdp() {
  try {
    return require('chrome-remote-interface');
  } catch (_) {
    return require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
  }
}

const CDP = requireCdp();

const PORTS = {
  antigravity: 9223,
  antigravityV2: 9226,
  codexDesktop: 9225,
};

const STATUS_PASS = 'pass';
const STATUS_FAIL = 'fail';
const STATUS_SKIP = 'skip_precondition';

const SURFACE_SET = new Set([
  'codex-desktop',
  'claude',
  'codex',
  'continue',
  'roo_code',
  'cline',
  'antigravity_panel',
  'antigravity-v2',
  'workbench',
]);

const PATTERNS = {
  claude: [/Anthropic\.claude-code/i],
  codex: [/openai\.chatgpt/i, /openai/i],
  continue: [/Continue\.continue/i, /continue/i],
  roo_code: [/RooVeterinaryInc\.roo-cline/i, /roo-cline/i, /roo/i],
  cline: [/saoudrizwan\.claude-dev/i, /cline/i],
};

function truncate(value, limit = 160) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + '...';
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content_blocks)) {
    return message.content_blocks.map((block) => {
      if (!block) return '';
      if (typeof block === 'string') return block;
      return block.content || block.text || block.markdown || block.title || block.label || '';
    }).filter(Boolean).join('\n\n');
  }
  return String(message.content || '');
}

function findSuspiciousCodexToolBlocks(messages) {
  if (!Array.isArray(messages)) return [];
  const suspects = [];
  const blockRe = /\[(Bash|Edit) ([^\]\n]*(?:\d+\s+commands?|files?)[^\]\n]*)\]\n([\s\S]*?)\n?\[end\]/gi;
  for (let i = 0; i < messages.length; i++) {
    const text = messageText(messages[i]);
    blockRe.lastIndex = 0;
    let match;
    while ((match = blockRe.exec(text))) {
      const body = String(match[3] || '').trim();
      const markerHits = (body.match(/\b(?:Sent as goal|Context automatically compacted|Worked for|Working for)\b/g) || []).length;
      const emptyMultiCommand = /Bash/i.test(match[1]) && /^\d+\s+commands?\b/i.test(String(match[2] || '').trim()) && body.length === 0;
      if (body.length > 20000 || markerHits >= 3 || emptyMultiCommand) {
        suspects.push({
          message_index: i,
          role: messages[i].role || '',
          header: `[${match[1]} ${match[2]}]`,
          body_length: body.length,
          marker_hits: markerHits,
          empty_multi_command: emptyMultiCommand,
          preview: truncate(body, 220),
        });
      }
    }
  }
  return suspects;
}

async function readCodexDesktopVisualUnitStats(Runtime) {
  try {
    const result = await Runtime.evaluate({
      expression: `(() => {
        const units = Array.from(document.querySelectorAll('[data-content-search-unit-key]'));
        const turns = new Set();
        for (const unit of units) {
          const turn = unit.closest('[data-testid*="conversation-turn"], [data-turn-id], [class*="turn"], article, section') || unit.parentElement;
          if (turn) turns.add(turn);
        }
        return { units: units.length, turns: turns.size };
      })()`,
      returnByValue: true,
    });
    return result?.result?.value || { units: 0, turns: 0 };
  } catch (_) {
    return { units: 0, turns: 0 };
  }
}

function createReporter(options) {
  const results = [];
  const summary = { pass: 0, fail: 0, skip_precondition: 0 };

  function color(status, text) {
    if (options.json) return text;
    if (status === STATUS_PASS) return '\x1b[32m' + text + '\x1b[0m';
    if (status === STATUS_FAIL) return '\x1b[31m' + text + '\x1b[0m';
    return '\x1b[33m' + text + '\x1b[0m';
  }

  function add(result) {
    const normalized = {
      surface: result.surface,
      test_id: result.test_id,
      status: result.status,
      detail: result.detail || '',
      native_evidence: result.native_evidence || null,
      webui_evidence: result.webui_evidence || null,
      expected: result.expected || null,
      actual: result.actual || null,
      investigation_hint: result.investigation_hint || null,
    };
    results.push(normalized);
    if (summary[normalized.status] == null) summary[normalized.status] = 0;
    summary[normalized.status]++;
    if (!options.json) {
      const label = normalized.status === STATUS_PASS ? 'PASS' : normalized.status === STATUS_FAIL ? 'FAIL' : 'SKIP';
      console.log('  ' + color(normalized.status, label) + ' ' + normalized.test_id + ': ' + normalized.detail);
    }
  }

  function buildReport(meta = {}) {
    return {
      generated_at: new Date().toISOString(),
      options: {
        surfaces: options.surfaces,
        strict: !!options.strict,
      },
      meta,
      summary,
      results,
    };
  }

  return { add, buildReport, results, summary };
}

function parseArgs(argv) {
  const options = {
    json: false,
    strict: false,
    surfaces: Array.from(SURFACE_SET),
    jsonFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--json-file' && argv[i + 1]) {
      options.jsonFile = argv[++i];
      continue;
    }
    if ((arg === '--surface' || arg === '--surfaces') && argv[i + 1]) {
      const values = argv[++i].split(',').map((v) => v.trim()).filter(Boolean);
      const filtered = values.filter((v) => SURFACE_SET.has(v));
      if (filtered.length > 0) options.surfaces = filtered;
    }
  }

  return options;
}

async function listTargetsByPort() {
  const meta = {};
  for (const [name, port] of Object.entries(PORTS)) {
    try {
      meta[name] = await CDP.List({ port });
    } catch (error) {
      meta[name] = { error: error.message };
    }
  }
  return meta;
}

async function withTarget(port, target, fn) {
  const client = await CDP({ port, target: target.id });
  try {
    await client.Runtime.enable();
    return await fn(client.Runtime, client);
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

function findWorkbenchTarget(targets) {
  return targets.find((t) => t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski'));
}

function findFirstMatchingTarget(targets, patterns) {
  return targets.find((t) => t.type === 'iframe' && patterns.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
}

function findMatchingTargets(targets, patterns) {
  return targets.filter((t) => t.type === 'iframe' && patterns.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
}

async function findBestRooCodeTarget(targets) {
  const candidates = targets.filter((t) => t.type === 'iframe' && PATTERNS.roo_code.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let best = null;
  let bestScore = -1;
  for (const t of candidates) {
    try {
      const client = await CDP({ port: PORTS.antigravity, target: t.id });
      try {
        await client.Runtime.enable();
        const res = await client.Runtime.evaluate({
          expression: `(function() {
            const d = document.getElementById('active-frame')?.contentDocument || document;
            const text = d.body ? (d.body.innerText || d.body.textContent || '') : '';
            const rows = d.querySelectorAll('[data-testid="virtuoso-item-list"] > div').length;
            const hasChat = !!d.querySelector('[data-testid="chat-view"]');
            const onboarding = /Help Improve Roo Code|Roo is a whole AI dev team/i.test(text);
            return { score: (hasChat ? 1000 : 0) + rows * 100 + Math.min(text.length, 5000) - (onboarding ? 2000 : 0), rows, len: text.length };
          })()`,
          returnByValue: true,
        });
        const score = Number(res.result?.value?.score || 0);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      } finally {
        await client.close();
      }
    } catch {}
  }
  return best || candidates[0];
}

async function runCodexDesktopSuite(targets, reporter) {
  const surface = 'codex-desktop';
  const target = Array.isArray(targets) ? targets.find((t) => t.type === 'page' && t.title === 'Codex') : null;
  if (!target) {
    reporter.add({
      surface,
      test_id: 'codex-desktop.target.detect',
      status: STATUS_SKIP,
      detail: 'No Codex Desktop page target found on port 9225',
      investigation_hint: 'Open Codex Desktop and ensure remote debugging is enabled on port 9225',
    });
    return;
  }

  reporter.add({
    surface,
    test_id: 'codex-desktop.target.detect',
    status: STATUS_PASS,
    detail: 'Found Codex Desktop page target "' + truncate(target.title || target.id) + '"',
    native_evidence: { target_id: target.id, url: truncate(target.url, 240) },
  });

  await withTarget(PORTS.codexDesktop, target, async (Runtime) => {
    const composer = await selectors.evalInPage(Runtime, 'return !!d.querySelector(".ProseMirror");');
    reporter.add({
      surface,
      test_id: 'codex-desktop.composer.detect',
      status: composer ? STATUS_PASS : STATUS_FAIL,
      detail: composer ? 'ProseMirror composer detected' : 'ProseMirror composer missing',
      actual: composer,
      expected: true,
      investigation_hint: 'Check Codex Desktop composer selectors in selectors.js',
    });

    const config = await selectors.readAgentConfig(Runtime, 'codex-desktop');
    const configOk = !!(
      config &&
      (
        (config.model_id && config.model_id !== 'unknown') ||
        (config.effort && config.effort !== 'unknown') ||
        (config.speed && config.speed !== 'unknown') ||
        (config.permission_mode && config.permission_mode !== 'unknown')
      )
    );
    reporter.add({
      surface,
      test_id: 'codex-desktop.config.read',
      status: configOk ? STATUS_PASS : STATUS_FAIL,
      detail: configOk ? 'Read Codex Desktop config' : 'Could not read Codex Desktop config',
      native_evidence: config,
      investigation_hint: 'Check readAgentConfig for codex-desktop in selectors.js',
    });

    const messagesRaw = await selectors.readMessages(Runtime, 'codex-desktop', 'smoke-codex-desktop');
    const messages = parseMaybeJson(messagesRaw, []);
    reporter.add({
      surface,
      test_id: 'codex-desktop.messages.read',
      status: Array.isArray(messages) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(messages) ? messages.length : 0) + ' transcript messages',
      actual: Array.isArray(messages) ? messages.length : null,
      expected: 'array',
      native_evidence: Array.isArray(messages) && messages.length > 0 ? { last_message: truncate(messages[messages.length - 1].content || '', 220) } : null,
      investigation_hint: 'Check readCodexMessages in selectors.js',
    });

    const visualUnitStats = await readCodexDesktopVisualUnitStats(Runtime);
    const visualUnitCount = Number(visualUnitStats.units || 0);
    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const segmentationOk = visualUnitCount < 40 || messageCount >= Math.max(20, Math.floor(visualUnitCount * 0.5));
    reporter.add({
      surface,
      test_id: 'codex-desktop.messages.visual-unit-segmentation',
      status: segmentationOk ? STATUS_PASS : STATUS_FAIL,
      detail: segmentationOk
        ? `Selector preserves visual units (${messageCount} messages from ${visualUnitCount} native units)`
        : `Selector collapsed too many native units (${messageCount} messages from ${visualUnitCount} native units)`,
      actual: { messages: messageCount, ...visualUnitStats },
      expected: 'Large Codex Desktop transcripts should not be collapsed into a handful of giant assistant messages',
      investigation_hint: 'Keep Codex Desktop native assistant/tool units as separate WebUI messages so the chat stays visually faithful',
    });

    const suspiciousToolBlocks = findSuspiciousCodexToolBlocks(messages);
    reporter.add({
      surface,
      test_id: 'codex-desktop.messages.richness',
      status: suspiciousToolBlocks.length === 0 ? STATUS_PASS : STATUS_FAIL,
      detail: suspiciousToolBlocks.length === 0
        ? 'No oversized/cross-turn collapsed tool bodies detected'
        : 'Detected ' + suspiciousToolBlocks.length + ' suspicious collapsed tool bodies',
      native_evidence: suspiciousToolBlocks.slice(0, 3),
      investigation_hint: 'Collapsed Codex Desktop tool cards should not cache broad ancestor text as command output',
    });

    const thinking = await selectors.detectThinking(Runtime, 'codex-desktop');
    reporter.add({
      surface,
      test_id: 'codex-desktop.thinking.detect',
      status: STATUS_PASS,
      detail: 'Thinking=' + !!thinking.thinking + ' label="' + truncate(thinking.label || '') + '"',
      native_evidence: thinking,
      investigation_hint: 'Check detectThinking for codex-desktop if state is stale or wrong',
    });

    const threads = await selectors.readCodexThreadList(Runtime, true);
    reporter.add({
      surface,
      test_id: 'codex-desktop.thread-list.read',
      status: STATUS_PASS,
      detail: 'Read ' + threads.length + ' thread entries',
      native_evidence: threads.slice(0, 3),
      investigation_hint: 'Check readCodexThreadList in selectors.js',
    });

    const terminal = await selectors.readCodexTerminalOutput(Runtime, true);
    reporter.add({
      surface,
      test_id: 'codex-desktop.terminal.read',
      status: STATUS_PASS,
      detail: 'Read ' + terminal.length + ' terminal entries',
      native_evidence: terminal.length > 0 ? { preview: truncate(terminal[0].output || '', 220), live: !!terminal[0].live } : null,
      investigation_hint: 'Check readCodexTerminalOutput in selectors.js',
    });

    const changes = await selectors.readCodexFileChanges(Runtime, true);
    reporter.add({
      surface,
      test_id: 'codex-desktop.changes.read',
      status: STATUS_PASS,
      detail: 'Read ' + changes.length + ' change entries',
      native_evidence: changes.slice(0, 3),
      investigation_hint: 'Check readCodexFileChanges in selectors.js',
    });

    const sandbox = await selectors.readCodexSandboxStatus(Runtime, true);
    reporter.add({
      surface,
      test_id: 'codex-desktop.sandbox.read',
      status: sandbox ? STATUS_PASS : STATUS_SKIP,
      detail: sandbox ? 'Read Codex Desktop sandbox status' : 'No sandbox status available',
      native_evidence: sandbox,
      investigation_hint: 'Check readCodexSandboxStatus in selectors.js',
    });
  });
}

async function runWorkbenchSuite(targets, reporter) {
  const surface = 'workbench';
  const target = Array.isArray(targets) ? findWorkbenchTarget(targets) : null;
  if (!target) {
    reporter.add({
      surface,
      test_id: 'workbench.target.detect',
      status: STATUS_SKIP,
      detail: 'No Antigravity workbench page target found on port 9223',
      investigation_hint: 'Open Antigravity IDE with remote debugging enabled on port 9223',
    });
    return null;
  }

  reporter.add({
    surface,
    test_id: 'workbench.target.detect',
    status: STATUS_PASS,
    detail: 'Found Antigravity workbench page "' + truncate(target.title || target.id) + '"',
    native_evidence: { target_id: target.id, url: truncate(target.url, 240) },
  });

  return withTarget(PORTS.antigravity, target, async (Runtime) => {
    const paneSummary = await selectors.readWorkbenchPaneSummary(Runtime);
    reporter.add({
      surface,
      test_id: 'workbench.pane-summary.read',
      status: paneSummary ? STATUS_PASS : STATUS_FAIL,
      detail: paneSummary ? 'Read workbench pane summary' : 'Workbench pane summary missing',
      native_evidence: paneSummary,
      investigation_hint: 'Check readWorkbenchPaneSummary in selectors.js',
    });

    const panelOpen = await selectors.detectAntigravityPanelOpen(Runtime);
    reporter.add({
      surface: 'antigravity_panel',
      test_id: 'antigravity_panel.open.detect',
      status: STATUS_PASS,
      detail: 'Panel open=' + !!panelOpen,
      actual: !!panelOpen,
      investigation_hint: 'Check detectAntigravityPanelOpen and workbench activity-bar selectors',
    });

    const panelSummary = await selectors.readAntigravityPanelSummary(Runtime);
    reporter.add({
      surface: 'antigravity_panel',
      test_id: 'antigravity_panel.summary.read',
      status: panelSummary ? STATUS_PASS : STATUS_SKIP,
      detail: panelSummary ? 'Read right-hand pane summary' : 'Right-hand pane summary unavailable',
      native_evidence: panelSummary,
      investigation_hint: 'Check readAntigravityPanelSummary in selectors.js',
    });

    const panelChats = await selectors.readAntigravityPanelChatList(Runtime);
    reporter.add({
      surface: 'antigravity_panel',
      test_id: 'antigravity_panel.chat-list.read',
      status: Array.isArray(panelChats) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(panelChats) ? panelChats.length : 0) + ' right-hand pane chat entries',
      native_evidence: Array.isArray(panelChats) ? panelChats.slice(0, 3) : null,
      investigation_hint: 'Check readAntigravityPanelChatList in selectors.js',
    });

    return { target, paneSummary };
  });
}

async function runAntigravityV2Suite(targets, reporter) {
  const surface = 'antigravity-v2';
  const target = Array.isArray(targets) ? targets.find((t) => t.type === 'page' && /\/c\/[0-9a-f-]{36}/i.test(t.url || '')) || targets.find((t) => t.type === 'page') : null;
  if (!target) {
    reporter.add({
      surface,
      test_id: 'antigravity-v2.target.detect',
      status: STATUS_SKIP,
      detail: 'No Antigravity v2 page target found on port 9226',
      investigation_hint: 'Open Antigravity v2 Agent Manager with remote debugging enabled on port 9226',
    });
    return;
  }

  reporter.add({
    surface,
    test_id: 'antigravity-v2.target.detect',
    status: STATUS_PASS,
    detail: 'Found Antigravity v2 page "' + truncate(target.title || target.id) + '"',
    native_evidence: { target_id: target.id, url: truncate(target.url, 240), title: truncate(target.title || '') },
  });

  await withTarget(PORTS.antigravityV2, target, async (Runtime) => {
    const active = await selectors.readAntigravityV2ActiveConversation(Runtime);
    const activeOk = !!(active && (active.conversation_id || active.is_list_view));
    reporter.add({
      surface,
      test_id: 'antigravity-v2.active-conversation.read',
      status: activeOk ? STATUS_PASS : STATUS_FAIL,
      detail: active?.conversation_id
        ? 'Read active conversation UUID'
        : active?.is_list_view
          ? 'Read v2 list-view route (no active conversation)'
          : 'Could not read active conversation UUID or list-view route',
      native_evidence: active,
      investigation_hint: 'Check readAntigravityV2ActiveConversation in selectors.js',
    });

    const chats = await selectors.readAntigravityV2ChatList(Runtime);
    reporter.add({
      surface,
      test_id: 'antigravity-v2.chat-list.read',
      status: Array.isArray(chats) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(chats) ? chats.length : 0) + ' v2 conversation entries',
      native_evidence: Array.isArray(chats) ? chats.slice(0, 5) : null,
      investigation_hint: 'Check readAntigravityV2ChatList in selectors.js',
    });

    const config = await selectors.readAgentConfig(Runtime, 'antigravity-v2');
    reporter.add({
      surface,
      test_id: 'antigravity-v2.config.read',
      status: config?.model_id && config.model_id !== 'unknown' ? STATUS_PASS : STATUS_FAIL,
      detail: config?.model_id ? 'Read v2 model/config' : 'Could not read v2 model/config',
      native_evidence: config,
      investigation_hint: 'Check readAntigravityV2Config in selectors.js',
    });

    const messagesRaw = await selectors.readMessages(Runtime, 'antigravity-v2', 'smoke-antigravity-v2');
    const messages = parseMaybeJson(messagesRaw, []);
    const hasBlocks = Array.isArray(messages) && messages.some(m => Array.isArray(m.content_blocks) && m.content_blocks.length > 0);
    reporter.add({
      surface,
      test_id: 'antigravity-v2.messages.read',
      status: Array.isArray(messages) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(messages) ? messages.length : 0) + ' v2 transcript messages',
      native_evidence: Array.isArray(messages) && messages.length > 0 ? { last_message: truncate(messages[messages.length - 1].content || '', 220), has_content_blocks: hasBlocks } : null,
      investigation_hint: 'Check readAntigravityV2Messages and content_blocks extraction',
    });

    const thinking = await selectors.detectThinking(Runtime, 'antigravity-v2');
    reporter.add({
      surface,
      test_id: 'antigravity-v2.thinking.detect',
      status: STATUS_PASS,
      detail: 'Thinking=' + !!thinking.thinking + ' label="' + truncate(thinking.label || '') + '"',
      native_evidence: thinking,
      investigation_hint: 'Check detectAntigravityV2Thinking in selectors.js',
    });
  });
}

async function runIframeSurfaceSuite(targets, reporter, surface, targetOverride = null, targetIndex = null) {
  const patterns = PATTERNS[surface];
  if (!patterns) return;
  let target;
  if (targetOverride) {
    target = targetOverride;
  } else if (surface === 'roo_code') {
    target = Array.isArray(targets) ? await findBestRooCodeTarget(targets) : null;
  } else {
    target = Array.isArray(targets) ? findFirstMatchingTarget(targets, patterns) : null;
  }
  const testPrefix = targetIndex == null ? surface : `${surface}.${targetIndex}`;
  if (!target) {
    reporter.add({
      surface,
      test_id: testPrefix + '.target.detect',
      status: STATUS_SKIP,
      detail: 'No live ' + surface + ' iframe target found on port 9223',
      investigation_hint: 'Open the ' + surface + ' surface in Antigravity before running the smoke suite',
    });
    return;
  }

  reporter.add({
    surface,
    test_id: testPrefix + '.target.detect',
    status: STATUS_PASS,
    detail: 'Found ' + surface + ' iframe target',
    native_evidence: { target_id: target.id, url: truncate(target.url, 240), title: truncate(target.title || '') },
  });

  await withTarget(PORTS.antigravity, target, async (Runtime) => {
    const detectedType = await selectors.detectAgentType(Runtime, (target.url || '') + ' ' + (target.title || ''));
    const expectedType = surface === 'codex' ? 'codex' : surface;
    reporter.add({
      surface,
      test_id: testPrefix + '.type.detect',
      status: detectedType === expectedType ? STATUS_PASS : STATUS_FAIL,
      detail: 'Detected type "' + detectedType + '"',
      expected: expectedType,
      actual: detectedType,
      investigation_hint: 'Check detectAgentType and current DOM markers for ' + surface,
    });

    const config = await selectors.readAgentConfig(Runtime, expectedType);
    const configOk = !!(
      config &&
      (
        (config.model_id && config.model_id !== 'unknown') ||
        (config.effort && config.effort !== 'unknown') ||
        (config.speed && config.speed !== 'unknown') ||
        (config.permission_mode && config.permission_mode !== 'unknown') ||
        (config.mode && config.mode !== 'unknown') ||
        (config.version && config.version !== 'unknown')
      )
    );
    reporter.add({
      surface,
      test_id: testPrefix + '.config.read',
      status: configOk ? STATUS_PASS : STATUS_FAIL,
      detail: configOk ? 'Read ' + surface + ' config' : 'Could not read ' + surface + ' config',
      native_evidence: config,
      investigation_hint: 'Check readAgentConfig for ' + surface + ' in selectors.js',
    });

    const messagesRaw = await selectors.readMessages(Runtime, expectedType, 'smoke-' + surface);
    const messages = parseMaybeJson(messagesRaw, []);
    reporter.add({
      surface,
      test_id: testPrefix + '.messages.read',
      status: Array.isArray(messages) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(messages) ? messages.length : 0) + ' transcript messages',
      native_evidence: Array.isArray(messages) && messages.length > 0 ? { last_message: truncate(messages[messages.length - 1].content || '', 220) } : null,
      expected: 'array',
      actual: Array.isArray(messages) ? messages.length : null,
      investigation_hint: 'Check readMessages dispatch and ' + surface + ' message selectors',
    });

    if (surface === 'codex') {
      const suspiciousToolBlocks = findSuspiciousCodexToolBlocks(messages);
      reporter.add({
        surface,
        test_id: testPrefix + '.messages.richness',
        status: suspiciousToolBlocks.length === 0 ? STATUS_PASS : STATUS_FAIL,
        detail: suspiciousToolBlocks.length === 0
          ? 'No oversized/cross-turn collapsed tool bodies detected'
          : 'Detected ' + suspiciousToolBlocks.length + ' suspicious collapsed tool bodies',
        native_evidence: suspiciousToolBlocks.slice(0, 3),
        investigation_hint: 'Collapsed Codex side-pane tool cards should not cache broad ancestor text as command output',
      });
    }

    const thinking = await selectors.detectThinking(Runtime, expectedType);
    reporter.add({
      surface,
      test_id: testPrefix + '.thinking.detect',
      status: STATUS_PASS,
      detail: 'Thinking=' + !!thinking.thinking + ' label="' + truncate(thinking.label || '') + '"',
      native_evidence: thinking,
      investigation_hint: 'Check detectThinking for ' + surface,
    });

    if (surface === 'codex') {
      const chats = await selectors.readCodexChatList(Runtime, false);
      reporter.add({
        surface,
        test_id: testPrefix + '.chat-list.read',
        status: Array.isArray(chats) ? STATUS_PASS : STATUS_FAIL,
        detail: 'Read ' + (Array.isArray(chats) ? chats.length : 0) + ' Codex side pane chats',
        native_evidence: Array.isArray(chats) ? chats.slice(0, 3) : null,
        investigation_hint: 'Check readCodexChatList in selectors.js',
      });
    }

    if (surface === 'continue') {
      const dialog = await selectors.detectPermissionDialog(Runtime, 'continue');
      reporter.add({
        surface,
        test_id: 'continue.permission-dialog.detect',
        status: STATUS_PASS,
        detail: dialog ? 'Visible Continue permission dialog detected' : 'No Continue permission dialog visible',
        native_evidence: dialog,
        investigation_hint: 'Check detectPermissionDialog for continue in selectors.js',
      });
    }

    if (surface === 'claude') {
      const dialog = await selectors.detectPermissionDialog(Runtime, 'claude');
      reporter.add({
        surface,
        test_id: 'claude.permission-dialog.detect',
        status: STATUS_PASS,
        detail: dialog ? 'Visible Claude permission dialog detected' : 'No Claude permission dialog visible',
        native_evidence: dialog,
        investigation_hint: 'Check detectPermissionDialog for claude in selectors.js',
      });
    }

    if (surface === 'roo_code') {
      const promptView = await selectors.readRooCodePromptView(Runtime);
      reporter.add({
        surface,
        test_id: 'roo_code.prompt-view.read',
        status: promptView ? STATUS_PASS : STATUS_SKIP,
        detail: promptView ? 'Read Roo Code prompt view: ' + truncate(promptView.label || promptView.title || '') : 'Roo Code prompt view not available',
        native_evidence: promptView,
        investigation_hint: 'Check readRooCodePromptView in selectors.js',
      });

      const dialog = await selectors.detectPermissionDialog(Runtime, 'roo_code');
      reporter.add({
        surface,
        test_id: 'roo_code.permission-dialog.detect',
        status: STATUS_PASS,
        detail: dialog ? 'Visible Roo Code permission dialog detected' : 'No Roo Code permission dialog visible',
        native_evidence: dialog,
        investigation_hint: 'Check detectPermissionDialog for roo_code in selectors.js',
      });
    }

    if (surface === 'cline') {
      const dialog = await selectors.detectPermissionDialog(Runtime, 'cline');
      reporter.add({
        surface,
        test_id: 'cline.permission-dialog.detect',
        status: STATUS_PASS,
        detail: dialog ? 'Visible Cline permission dialog detected' : 'No Cline permission dialog visible',
        native_evidence: dialog,
        investigation_hint: 'Check detectPermissionDialog for cline in selectors.js',
      });

      const mode = await selectors.readClineMode(Runtime);
      reporter.add({
        surface,
        test_id: 'cline.mode.read',
        status: mode ? STATUS_PASS : STATUS_SKIP,
        detail: mode ? 'Read Cline mode: ' + truncate(mode.label || '') : 'Cline mode not available',
        native_evidence: mode,
        investigation_hint: 'Check readClineMode in selectors.js',
      });

      const context = await selectors.readClineContextUsage(Runtime);
      reporter.add({
        surface,
        test_id: 'cline.context-usage.read',
        status: context ? STATUS_PASS : STATUS_SKIP,
        detail: context ? 'Read Cline context: ' + truncate(context.label || '') : 'Cline context usage not available',
        native_evidence: context,
        investigation_hint: 'Check readClineContextUsage in selectors.js',
      });
    }
  });
}

async function runSmokeSuite(options = {}) {
  const reporter = createReporter(options);
  const targetsByPort = await listTargetsByPort();

  const meta = {
    antigravity_targets: Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity.length : 0,
    antigravity_v2_targets: Array.isArray(targetsByPort.antigravityV2) ? targetsByPort.antigravityV2.length : 0,
    codex_desktop_targets: Array.isArray(targetsByPort.codexDesktop) ? targetsByPort.codexDesktop.length : 0,
    antigravity_error: Array.isArray(targetsByPort.antigravity) ? null : targetsByPort.antigravity.error,
    antigravity_v2_error: Array.isArray(targetsByPort.antigravityV2) ? null : targetsByPort.antigravityV2.error,
    codex_desktop_error: Array.isArray(targetsByPort.codexDesktop) ? null : targetsByPort.codexDesktop.error,
  };

  const needsAntigravityPort = options.surfaces.some(surface =>
    surface === 'workbench' ||
    surface === 'antigravity_panel' ||
    surface === 'claude' ||
    surface === 'codex' ||
    surface === 'continue' ||
    surface === 'roo_code' ||
    surface === 'cline'
  );
  const needsCodexDesktopPort = options.surfaces.includes('codex-desktop');
  const needsAntigravityV2Port = options.surfaces.includes('antigravity-v2');

  if (needsAntigravityPort && !Array.isArray(targetsByPort.antigravity)) {
    reporter.add({
      surface: 'workbench',
      test_id: 'workbench.port.connect',
      status: STATUS_FAIL,
      detail: 'Could not list Antigravity CDP targets: ' + targetsByPort.antigravity.error,
      investigation_hint: 'Check port 9223 and whether Antigravity was launched with remote debugging',
    });
  }

  if (needsCodexDesktopPort && !Array.isArray(targetsByPort.codexDesktop)) {
    reporter.add({
      surface: 'codex-desktop',
      test_id: 'codex-desktop.port.connect',
      status: STATUS_FAIL,
      detail: 'Could not list Codex Desktop CDP targets: ' + targetsByPort.codexDesktop.error,
      investigation_hint: 'Check port 9225 and whether Codex Desktop was launched with remote debugging',
    });
  }

  if (needsAntigravityV2Port && !Array.isArray(targetsByPort.antigravityV2)) {
    reporter.add({
      surface: 'antigravity-v2',
      test_id: 'antigravity-v2.port.connect',
      status: STATUS_FAIL,
      detail: 'Could not list Antigravity v2 CDP targets: ' + targetsByPort.antigravityV2.error,
      investigation_hint: 'Check port 9226 and whether Antigravity v2 was launched with remote debugging',
    });
  }

  if (options.surfaces.includes('workbench') || options.surfaces.includes('antigravity_panel')) {
    await runWorkbenchSuite(Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity : [], reporter);
  }

  if (options.surfaces.includes('codex-desktop')) {
    await runCodexDesktopSuite(Array.isArray(targetsByPort.codexDesktop) ? targetsByPort.codexDesktop : [], reporter);
  }

  if (options.surfaces.includes('antigravity-v2')) {
    await runAntigravityV2Suite(Array.isArray(targetsByPort.antigravityV2) ? targetsByPort.antigravityV2 : [], reporter);
  }

  for (const surface of ['claude', 'codex', 'continue', 'roo_code', 'cline']) {
    if (!options.surfaces.includes(surface)) continue;
    const antigravityTargets = Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity : [];
    if (surface === 'codex') {
      const codexTargets = findMatchingTargets(antigravityTargets, PATTERNS.codex);
      if (codexTargets.length === 0) {
        await runIframeSurfaceSuite(antigravityTargets, reporter, surface);
      } else {
        for (let i = 0; i < codexTargets.length; i++) {
          await runIframeSurfaceSuite(antigravityTargets, reporter, surface, codexTargets[i], i);
        }
      }
      continue;
    }
    await runIframeSurfaceSuite(antigravityTargets, reporter, surface);
  }

  return reporter.buildReport(meta);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await runSmokeSuite(options);

  if (options.json) {
    const jsonText = JSON.stringify(report, null, 2);
    if (options.jsonFile) {
      fs.writeFileSync(options.jsonFile, jsonText);
    } else {
      process.stdout.write(jsonText + '\n');
    }
  } else {
    console.log('\n=== CDP SMOKE SUMMARY ===\n');
    console.log('  PASS ' + report.summary.pass + '  FAIL ' + report.summary.fail + '  SKIP ' + report.summary.skip_precondition);
    console.log('  Total ' + report.results.length);
    if (options.jsonFile) {
      fs.writeFileSync(options.jsonFile, JSON.stringify(report, null, 2));
      console.log('  Wrote JSON report to ' + options.jsonFile);
    }
  }

  if (options.strict && report.summary.fail > 0) {
    process.exitCode = 1;
  }

  return report;
}

module.exports = {
  main,
  parseArgs,
  runSmokeSuite,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}
