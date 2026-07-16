#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');

const SPECS = [
  {
    agentType: 'gemini',
    extensionId: 'google.geminicodeassist',
    directoryPrefix: 'google.geminicodeassist-',
    activityLabel: 'Gemini Code Assist (Alt+G)',
  },
  {
    agentType: 'continue',
    extensionId: 'Continue.continue',
    directoryPrefix: 'continue.continue-',
    activityLabel: 'Continue',
  },
  {
    agentType: 'roo_code',
    extensionId: 'RooVeterinaryInc.roo-cline',
    directoryPrefix: 'rooveterinaryinc.roo-cline-',
    activityLabel: 'Roo Code',
    commandLabel: 'Roo Code: Focus on Roo Code View',
  },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    out[key.slice(2)] = value;
  }
  return out;
}

function required(args, name) {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function targetUrl(target) {
  try { return decodeURIComponent(String(target?.url || '')); } catch { return String(target?.url || ''); }
}

function extensionFromTarget(target) {
  return ((targetUrl(target).match(/[?&]extensionId=([^&]+)/i) || [])[1] || '').toLowerCase();
}

function summarizeTarget(target) {
  return {
    id: target.id,
    type: target.type,
    extension_id: (targetUrl(target).match(/[?&]extensionId=([^&]+)/i) || [])[1] || null,
    parent_id: (targetUrl(target).match(/[?&]parentId=([^&]+)/i) || [])[1] || null,
    purpose: (targetUrl(target).match(/[?&]purpose=([^&]+)/i) || [])[1] || null,
  };
}

function readInstalledVersion(extensionsDir, prefix) {
  const matches = fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map(entry => path.join(extensionsDir, entry.name));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one installed ${prefix} directory, found ${matches.length}`);
  }
  const manifestPath = path.join(matches[0], 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { directory: matches[0], version: manifest.version, display_name: manifest.displayName };
}

function assertDisposableSettings(userDataDir) {
  const settingsPath = path.join(userDataDir, 'User', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (settings['update.mode'] !== 'none') {
    throw new Error(`Disposable profile must set update.mode=none: ${settingsPath}`);
  }
  return settingsPath;
}

async function getTargets(port) {
  return CDP.List({ port });
}

async function guardedWorkbench(port, expectedWorkspace) {
  const targets = await getTargets(port);
  const pages = targets.filter(target =>
    target.type === 'page' &&
    /Visual Studio Code/i.test(target.title || '') &&
    (target.title || '').toLowerCase().includes(expectedWorkspace.toLowerCase())
  );
  if (pages.length !== 1) {
    throw new Error(`Expected exactly one disposable ${expectedWorkspace} workbench on ${port}, found ${pages.length}`);
  }
  return pages[0];
}

async function clickExactActivityLabel(port, workbench, label) {
  const client = await CDP({ port, target: workbench });
  try {
    await client.Runtime.enable();
    const result = await client.Runtime.evaluate({
      expression: `(() => {
        const matches = Array.from(document.querySelectorAll('a[aria-label]'))
          .filter(el => el.getAttribute('aria-label') === ${JSON.stringify(label)} && el.offsetParent !== null);
        if (matches.length !== 1) return { ok: false, count: matches.length };
        matches[0].click();
        return { ok: true, label: matches[0].getAttribute('aria-label') };
      })()`,
      returnByValue: true,
    });
    const value = result.result?.value;
    if (!value?.ok) throw new Error(`Exact activity label ${JSON.stringify(label)} matched ${value?.count ?? 0} controls`);
    return value;
  } finally {
    await client.close();
  }
}

async function openPanel(port, workbench, spec) {
  if (spec.activityLabel) {
    try {
      return await clickExactActivityLabel(port, workbench, spec.activityLabel);
    } catch (error) {
      if (!spec.commandLabel) throw error;
    }
  }
  return runExactCommand(port, workbench, spec.commandLabel);
}

async function runExactCommand(port, workbench, commandLabel) {
  const client = await CDP({ port, target: workbench });
  try {
    await client.Runtime.enable();
    const { Input } = client;
    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112 });
    await Input.dispatchKeyEvent({ type: 'keyUp', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112 });
    await sleep(350);
    await Input.insertText({ text: commandLabel });
    await sleep(600);
    const result = await client.Runtime.evaluate({
      expression: `(() => {
        const widgets = Array.from(document.querySelectorAll('.quick-input-widget')).filter(el => el.offsetParent !== null);
        const text = widgets.map(el => el.innerText || '').join('\n');
        return { widget_count: widgets.length, text };
      })()`,
      returnByValue: true,
    });
    const surface = result.result?.value || {};
    if (surface.widget_count !== 1 || !surface.text.includes(commandLabel)) {
      throw new Error(`Command palette did not resolve exact command ${JSON.stringify(commandLabel)}: ${JSON.stringify(surface)}`);
    }
    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    return { ok: true, command: commandLabel, palette: surface.text.slice(0, 500) };
  } finally {
    await client.close();
  }
}

async function waitForExtensionTarget(port, extensionId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getTargets(port);
    const matches = targets.filter(target =>
      target.type === 'iframe' && extensionFromTarget(target) === extensionId.toLowerCase()
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`${extensionId} produced ${matches.length} iframe targets; refusing ambiguous audit`);
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${extensionId} target on ${port}`);
}

async function withTimeout(label, operation, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function auditSurface(port, target, spec, workspacePath) {
  const client = await CDP({ port, target });
  try {
    const { Runtime } = client;
    Runtime._webviewId = (targetUrl(target).match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await Runtime.enable();
    await withTimeout(`${spec.agentType} context cache`, () => selectors.cacheInnerContextId(Runtime), 5000);
    const detected = await withTimeout(`${spec.agentType} detection`, () => selectors.detectAgentType(Runtime, spec.extensionId));
    const rawMessages = await withTimeout(`${spec.agentType} transcript read`, () => selectors.readMessages(Runtime, spec.agentType, 'tier2-readonly'));
    const messages = rawMessages ? JSON.parse(rawMessages) : [];
    const thinking = await withTimeout(`${spec.agentType} thinking read`, () => selectors.detectThinking(Runtime, spec.agentType));
    const config = await withTimeout(`${spec.agentType} config read`, () => selectors.readAgentConfig(Runtime, spec.agentType, workspacePath));
    const permission = await withTimeout(`${spec.agentType} permission read`, () => selectors.detectPermissionDialog(Runtime, spec.agentType));
    if (detected !== spec.agentType) throw new Error(`${spec.extensionId} detected as ${detected}`);
    return {
      detected_agent_type: detected,
      inner_context_id: Runtime._innerContextId || null,
      message_count: messages.length,
      first_message: messages[0] || null,
      thinking,
      config,
      permission_prompt: permission,
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(required(args, 'port'));
  const expectedWorkspace = required(args, 'expected-workspace');
  const workspacePath = path.resolve(required(args, 'workspace-path'));
  const userDataDir = path.resolve(required(args, 'user-data-dir'));
  const extensionsDir = path.resolve(required(args, 'extensions-dir'));
  const outputPath = args.output ? path.resolve(args.output) : null;
  const onlyAgentType = args.only ? String(args.only).trim() : null;

  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid --port: ${args.port}`);
  if (port === 9223) throw new Error('Port 9223 is the user VS Code host and is forbidden for panel-opening retriage');
  if (!fs.existsSync(workspacePath)) throw new Error(`Disposable workspace is missing: ${workspacePath}`);
  if (!fs.existsSync(extensionsDir)) throw new Error(`Extensions directory is missing: ${extensionsDir}`);
  if (onlyAgentType && !SPECS.some(spec => spec.agentType === onlyAgentType)) {
    throw new Error(`Unknown --only agent type: ${onlyAgentType}`);
  }

  const settingsPath = assertDisposableSettings(userDataDir);
  const workbench = await guardedWorkbench(port, expectedWorkspace);
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    mutation_scope: 'panel-open-only; no chats created; no messages sent; user port 9223 refused',
    guard: {
      port,
      expected_workspace: expectedWorkspace,
      workspace_path: workspacePath,
      user_data_dir: userDataDir,
      update_settings: settingsPath,
      workbench: { id: workbench.id, title: workbench.title },
    },
    harnesses: [],
  };

  const selectedSpecs = onlyAgentType ? SPECS.filter(spec => spec.agentType === onlyAgentType) : SPECS;
  for (const spec of selectedSpecs) {
    const installed = readInstalledVersion(extensionsDir, spec.directoryPrefix);
    const opened = await openPanel(port, workbench, spec);
    const target = await waitForExtensionTarget(port, spec.extensionId);
    const audit = await auditSurface(port, target, spec, workspacePath);
    result.harnesses.push({
      agent_type: spec.agentType,
      extension_id: spec.extensionId,
      installed,
      opened,
      target: summarizeTarget(target),
      audit,
      triage_result: 'PROMOTED_TO_FULL_EPIC',
    });
  }

  result.ok = result.harnesses.length === selectedSpecs.length && result.harnesses.every(row =>
    row.target && row.audit.detected_agent_type === row.agent_type
  );
  result.completed_at = new Date().toISOString();

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
