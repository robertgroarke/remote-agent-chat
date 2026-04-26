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

async function findBestRooCodeTarget(targets) {
  const candidates = targets.filter((t) => t.type === 'iframe' && PATTERNS.roo_code.some((pattern) => pattern.test((t.url || '') + ' ' + (t.title || ''))));
  if (candidates.length === 0) return null;
  // Roo Code uses a nested iframe architecture: the outer iframe (index.html)
  // contains a script that loads an inner iframe (fake.html) where the actual
  // React UI lives.  The inner iframe is the one we need to talk to.
  const inner = candidates.find((t) => (t.url || '').includes('fake.html'));
  if (inner) return inner;
  if (candidates.length === 1) return candidates[0];
  // Fallback: prefer targets with non-empty textContent
  for (const t of candidates) {
    try {
      const client = await CDP({ port: PORTS.antigravity, target: t.id });
      try {
        await client.Runtime.enable();
        const res = await client.Runtime.evaluate({
          expression: `(function() { return (document.body ? (document.body.textContent || '').length : 0); })()`,
          returnByValue: true,
        });
        const len = res.result?.value || 0;
        if (len > 100) return t;
      } finally {
        await client.close();
      }
    } catch {}
  }
  return candidates[0];
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

async function runIframeSurfaceSuite(targets, reporter, surface) {
  const patterns = PATTERNS[surface];
  if (!patterns) return;
  let target;
  if (surface === 'roo_code') {
    target = Array.isArray(targets) ? await findBestRooCodeTarget(targets) : null;
  } else {
    target = Array.isArray(targets) ? findFirstMatchingTarget(targets, patterns) : null;
  }
  if (!target) {
    reporter.add({
      surface,
      test_id: surface + '.target.detect',
      status: STATUS_SKIP,
      detail: 'No live ' + surface + ' iframe target found on port 9223',
      investigation_hint: 'Open the ' + surface + ' surface in Antigravity before running the smoke suite',
    });
    return;
  }

  reporter.add({
    surface,
    test_id: surface + '.target.detect',
    status: STATUS_PASS,
    detail: 'Found ' + surface + ' iframe target',
    native_evidence: { target_id: target.id, url: truncate(target.url, 240), title: truncate(target.title || '') },
  });

  await withTarget(PORTS.antigravity, target, async (Runtime) => {
    const detectedType = await selectors.detectAgentType(Runtime, (target.url || '') + ' ' + (target.title || ''));
    const expectedType = surface === 'codex' ? 'codex' : surface;
    reporter.add({
      surface,
      test_id: surface + '.type.detect',
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
      test_id: surface + '.config.read',
      status: configOk ? STATUS_PASS : STATUS_FAIL,
      detail: configOk ? 'Read ' + surface + ' config' : 'Could not read ' + surface + ' config',
      native_evidence: config,
      investigation_hint: 'Check readAgentConfig for ' + surface + ' in selectors.js',
    });

    const messagesRaw = await selectors.readMessages(Runtime, expectedType, 'smoke-' + surface);
    const messages = parseMaybeJson(messagesRaw, []);
    reporter.add({
      surface,
      test_id: surface + '.messages.read',
      status: Array.isArray(messages) ? STATUS_PASS : STATUS_FAIL,
      detail: 'Read ' + (Array.isArray(messages) ? messages.length : 0) + ' transcript messages',
      native_evidence: Array.isArray(messages) && messages.length > 0 ? { last_message: truncate(messages[messages.length - 1].content || '', 220) } : null,
      expected: 'array',
      actual: Array.isArray(messages) ? messages.length : null,
      investigation_hint: 'Check readMessages dispatch and ' + surface + ' message selectors',
    });

    const thinking = await selectors.detectThinking(Runtime, expectedType);
    reporter.add({
      surface,
      test_id: surface + '.thinking.detect',
      status: STATUS_PASS,
      detail: 'Thinking=' + !!thinking.thinking + ' label="' + truncate(thinking.label || '') + '"',
      native_evidence: thinking,
      investigation_hint: 'Check detectThinking for ' + surface,
    });

    if (surface === 'codex') {
      const chats = await selectors.readCodexChatList(Runtime, false);
      reporter.add({
        surface,
        test_id: 'codex.chat-list.read',
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
    codex_desktop_targets: Array.isArray(targetsByPort.codexDesktop) ? targetsByPort.codexDesktop.length : 0,
    antigravity_error: Array.isArray(targetsByPort.antigravity) ? null : targetsByPort.antigravity.error,
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

  if (options.surfaces.includes('workbench') || options.surfaces.includes('antigravity_panel')) {
    await runWorkbenchSuite(Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity : [], reporter);
  }

  if (options.surfaces.includes('codex-desktop')) {
    await runCodexDesktopSuite(Array.isArray(targetsByPort.codexDesktop) ? targetsByPort.codexDesktop : [], reporter);
  }

  for (const surface of ['claude', 'codex', 'continue', 'roo_code', 'cline']) {
    if (!options.surfaces.includes(surface)) continue;
    await runIframeSurfaceSuite(Array.isArray(targetsByPort.antigravity) ? targetsByPort.antigravity : [], reporter, surface);
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
