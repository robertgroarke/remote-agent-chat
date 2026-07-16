#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');
const selectors = require('../agent-proxy/selectors');
const { PNG } = require('../frontend/node_modules/pngjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { resultFile: '', sessionId: '', screenshot: '', alternateInstruction: '', acceptCommand: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
    else if (argv[i] === '--session-id') options.sessionId = String(argv[++i] || '');
    else if (argv[i] === '--screenshot') options.screenshot = path.resolve(argv[++i]);
    else if (argv[i] === '--alternate-instruction') options.alternateInstruction = String(argv[++i] || '').trim();
    else if (argv[i] === '--accept-command') options.acceptCommand = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  assert(options.alternateInstruction.length <= 2000, '--alternate-instruction must be at most 2000 characters');
  assert(!(options.acceptCommand && options.alternateInstruction),
    '--accept-command and --alternate-instruction are mutually exclusive');
  for (const [label, output, extension] of [
    ['result', options.resultFile, '.json'],
    ['screenshot', options.screenshot, '.png'],
  ]) {
    if (!output) continue;
    const relative = path.relative(path.join(ROOT, 'evidence'), output);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${label} output must stay under the evidence tree`);
    assert.equal(path.extname(output).toLowerCase(), extension, `${label} output must use ${extension}`);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 150) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/client-ws';
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'vscode-claude-permission-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function storedClaudeSession(sessionId, targetId) {
  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const sessions = Object.values(JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions || {});
  const matches = sessions.filter(session =>
    session.session_id === sessionId
    && session.agent_type === 'claude'
    && session.host_type === 'vscode'
    && Number(session.cdp_port) === guard.CDP_PORT
    && session.target_id === targetId
    && String(session.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
    && session.status === 'healthy'
  );
  assert.equal(matches.length, 1, `Expected one guarded Claude session, found ${matches.length}`);
  return matches[0];
}

async function requestConfig(relay, sessionId) {
  const requestId = `claude-perm-cfg-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'agent_config' && message.request_id === requestId),
    30000,
    'Claude permission config',
  );
}

async function inputState(Runtime) {
  const raw = await selectors.evalInFrame(Runtime, `
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.getClientRects().length > 0;
    }
    var inputs = Array.from(d.querySelectorAll('[aria-label="Message input"]')).filter(visible);
    if (inputs.length !== 1) return JSON.stringify({ error: 'message_input_count', count: inputs.length });
    return JSON.stringify({ text: inputs[0].innerText || inputs[0].textContent || '' });
  `);
  return JSON.parse(raw || '{}');
}

async function inspectNativePrompt(Runtime) {
  const raw = await selectors.evalInFrame(Runtime, `
    function visible(el) {
      if (!el || !el.isConnected || !el.getBoundingClientRect) return false;
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function compact(value, limit) {
      return String(value || '').replace(/\\s+/g, ' ').trim().substring(0, limit);
    }
    var roots = Array.from(d.querySelectorAll('[class*="permissionRequestContainer"]')).filter(function(el) {
      return visible(el) && el.querySelectorAll('button').length >= 1;
    });
    if (roots.length < 1) return JSON.stringify({ error: 'permission_root_count', count: roots.length });
    var root = roots[0];
    var rows = Array.from(root.querySelectorAll('*')).filter(visible).slice(0, 160).map(function(el) {
      var depth = 0;
      for (var parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) depth++;
      var ownText = Array.from(el.childNodes || []).filter(function(node) { return node.nodeType === 3; })
        .map(function(node) { return compact(node.nodeValue, 240); }).filter(Boolean).join(' ');
      return {
        depth: depth,
        tag: el.tagName.toLowerCase(),
        class_name: compact(el.className, 240),
        role: el.getAttribute('role') || '',
        aria_label: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        contenteditable: el.getAttribute('contenteditable') || '',
        own_text: ownText,
        value: 'value' in el ? compact(el.value, 240) : ''
      };
    });
    return JSON.stringify({
      matching_roots: roots.length,
      class_name: compact(root.className, 240),
      inner_text: String(root.innerText || '').substring(0, 2000),
      rows: rows
    });
  `);
  return JSON.parse(raw || '{}');
}

function negativeChoice(prompt) {
  return (prompt?.choices || []).find(choice =>
    /^(?:\d+[_\s]+)?(reject|deny|cancel|block|not now|no)\b/i.test(String(choice.label || choice.choice_id || ''))
  ) || null;
}

function positiveChoice(prompt) {
  return (prompt?.choices || []).find(choice =>
    String(choice.choice_id || '') === '1_yes'
    || /^(?:1[_\s]+)?yes$/i.test(String(choice.label || choice.choice_id || ''))
  ) || null;
}

async function captureNativeHost(pages, Runtime, screenshotPath) {
  const innerPageState = JSON.parse(await selectors.evalInFrame(Runtime, `JSON.stringify({
    visibility: document.visibilityState,
    has_focus: document.hasFocus(),
    url: location.href
  })`) || '{}');
  const hostClient = await CDP({ port: guard.CDP_PORT, target: pages[0].id });
  let hostPageState;
  let shot;
  try {
    await hostClient.Page.enable();
    const evaluated = await hostClient.Runtime.evaluate({
      expression: `({ visibility: document.visibilityState, has_focus: document.hasFocus(), title: document.title, url: location.href })`,
      returnByValue: true,
    });
    hostPageState = evaluated.result.value;
    shot = await hostClient.Page.captureScreenshot({
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
  } finally {
    await hostClient.close();
  }
  assert.equal(hostPageState.has_focus, false, 'Disposable VS Code host must remain unfocused');
  const bytes = Buffer.from(shot.data, 'base64');
  const png = PNG.sync.read(bytes);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, bytes);
  return {
    path: path.relative(ROOT, screenshotPath).replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: png.width,
    height: png.height,
    bytes: bytes.length,
    inner_page_state: innerPageState,
    host_page_state: hostPageState,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Claude permission E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Permission E2E is restricted to disposable CDP port 9230');

  const targets = await CDP.List({ port: guard.CDP_PORT });
  const pages = targets.filter(guard.isThrowawayWorkbench);
  const frames = targets.filter(target => guard.isThrowawayIframe(target, 'claude'));
  assert.equal(pages.length, 1, `Expected one disposable workbench, found ${pages.length}`);
  assert(frames.length >= 1, `Expected at least one disposable Claude frame, found ${frames.length}`);
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-proxy', 'session-store.json'), 'utf8'));
  const requestedStored = options.sessionId ? store.sessions?.[options.sessionId] : null;
  if (options.sessionId) {
    assert(requestedStored, `Requested disposable Claude session is not stored: ${options.sessionId}`);
    assert(guard.isThrowawaySession(requestedStored, 'claude'), 'Requested Claude session is outside the disposable workspace');
    assert.equal(Number(requestedStored.cdp_port), guard.CDP_PORT, 'Requested Claude session uses the wrong CDP port');
    assert.equal(requestedStored.status, 'healthy', 'Requested Claude session is not healthy');
  } else {
    assert.equal(frames.length, 1, `Multiple disposable Claude frames require --session-id; found ${frames.length}`);
  }
  const frame = options.sessionId
    ? frames.find(candidate => candidate.id === requestedStored.target_id)
    : frames[0];
  assert(frame, `Requested Claude target is not live: ${requestedStored?.target_id || '(missing)'}`);
  const relay = await openRelay();
  const client = await CDP({ port: guard.CDP_PORT, target: frame.id });
  let session = null;
  let activePrompt = null;

  try {
    await client.Runtime.enable();
    await client.Page.enable();
    client.Runtime._webviewId = (frame.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);

    if (options.sessionId) {
      session = storedClaudeSession(options.sessionId, frame.id);
    } else {
      const relaySession = await waitFor(() => latestSessions(relay.messages).find(candidate =>
        candidate?.agent_type === 'claude'
        && candidate?.host_type === 'vscode'
        && String(candidate?.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
        && candidate?.status === 'healthy'
      ), 90000, 'guarded live Claude relay session', 250);
      session = storedClaudeSession(relaySession.session_id, frame.id);
    }

    const config = await requestConfig(relay, session.session_id);
    assert.equal(config?.capabilities?.permission_dialogs, true, 'Claude config did not advertise permission_dialogs');
    assert.equal(config.permission_mode, 'default', `Disposable Claude mode must be default/manual, got ${config.permission_mode}`);
    assert.equal(config.auto_approve_permissions, false, 'Disposable Claude auto-approve must be off');
    const preexistingPrompt = await selectors.detectPermissionDialog(client.Runtime, 'claude');
    if (preexistingPrompt && /RAC_CLAUDE_PERMISSION_/i.test(String(preexistingPrompt.message || ''))) {
      const cleanupChoice = negativeChoice(preexistingPrompt);
      assert(cleanupChoice, `Owned stale prompt exposed no negative action: ${JSON.stringify(preexistingPrompt.choices)}`);
      const cleanup = await selectors.respondToPermissionDialog(
        client.Runtime,
        'claude',
        cleanupChoice.choice_id,
        session.session_id,
        client,
      );
      assert.equal(cleanup.ok, true, `Owned stale prompt cleanup failed: ${JSON.stringify(cleanup)}`);
      await waitFor(async () => !(await selectors.detectPermissionDialog(client.Runtime, 'claude')), 30000, 'owned stale prompt cleanup');
    } else {
      assert.equal(preexistingPrompt, null, 'Disposable Claude already has an unrelated permission prompt');
    }
    await waitFor(async () => !((await selectors.detectThinking(client.Runtime, 'claude'))?.thinking), 60000, 'Claude idle before permission mutation');
    const draft = await inputState(client.Runtime);
    assert.equal(draft.error, undefined, JSON.stringify(draft));
    assert.equal(draft.text, '', 'Disposable Claude draft must be empty before permission mutation');

    const runId = crypto.randomBytes(4).toString('hex');
    const marker = `RAC_CLAUDE_PERMISSION_${runId}`;
    const clientMessageId = `claude-permission-${runId}`;
    const start = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'send',
      session: session.session_id,
      content: `Use the Bash tool now to run exactly: powershell -NoProfile -Command "Write-Output ${marker}". Do not simulate the tool and do not answer before requesting permission.`,
      client_message_id: clientMessageId,
    }));
    await waitFor(() => relay.messages.slice(start).find(message =>
      message.type === 'proxy_send_result'
      && message.client_message_id === clientMessageId
      && message.result === 'delivered'
    ), 60000, 'Claude permission prompt send receipt');

    activePrompt = await waitFor(() => relay.messages.slice(start).find(message =>
      message.type === 'permission_prompt'
      && (message.session_id || message.session) === session.session_id
      && String(message.message || '').includes(marker)
    ), 120000, 'Claude native permission prompt');
    const reject = negativeChoice(activePrompt);
    const accept = positiveChoice(activePrompt);
    assert(reject, `Claude prompt exposed no negative action: ${JSON.stringify(activePrompt.choices)}`);
    if (options.acceptCommand) {
      assert(accept, `Claude prompt exposed no exact one-time Yes action: ${JSON.stringify(activePrompt.choices)}`);
      assert.equal(activePrompt.command, `powershell -NoProfile -Command "Write-Output ${marker}"`,
        'Accept mode is restricted to the internally generated Write-Output command');
    }
    if (options.alternateInstruction) {
      assert.equal(activePrompt.alternate_instruction_supported, true,
        `Claude prompt did not advertise alternate instruction support: ${JSON.stringify(activePrompt)}`);
    }
    const nativePrompt = await selectors.detectPermissionDialog(client.Runtime, 'claude');
    assert(nativePrompt, 'Relay surfaced a permission prompt that was not visible natively');
    assert(nativePrompt.choices.some(choice => choice.choice_id === reject.choice_id));
    const nativeSurface = await inspectNativePrompt(client.Runtime);
    assert.equal(nativeSurface.error, undefined, JSON.stringify(nativeSurface));
    let nativeCapture = null;
    if (options.screenshot && !options.acceptCommand) {
      nativeCapture = await captureNativeHost(pages, client.Runtime, options.screenshot);
    }

    const responseId = `claude-permission-response-${runId}`;
    const responseStart = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'permission_response',
      session_id: session.session_id,
      prompt_id: activePrompt.prompt_id,
      ...(options.alternateInstruction
        ? { instruction: options.alternateInstruction }
        : { choice_id: options.acceptCommand ? accept.choice_id : reject.choice_id }),
      request_id: responseId,
    }));
    const control = await waitFor(() => relay.messages.slice(responseStart).find(message =>
      message.type === 'agent_control_result' && message.request_id === responseId
    ), 30000, options.alternateInstruction
      ? 'Claude alternate-instruction control'
      : options.acceptCommand ? 'Claude exact command acceptance control' : 'Claude permission rejection control');
    assert.equal(control.result, 'ok', JSON.stringify(control));
    const expired = await waitFor(() => relay.messages.slice(responseStart).find(message =>
      message.type === 'permission_prompt_expired'
      && message.prompt_id === activePrompt.prompt_id
      && message.applied_choice === (options.alternateInstruction
        ? null : options.acceptCommand ? accept.choice_id : reject.choice_id)
    ), 30000, 'Claude permission prompt expiration');
    await waitFor(async () => !(await selectors.detectPermissionDialog(client.Runtime, 'claude')), 30000, 'native Claude prompt clearance');
    activePrompt = null;
    await waitFor(async () => !((await selectors.detectThinking(client.Runtime, 'claude'))?.thinking), 60000, 'Claude idle after permission response');

    let acceptedCommandProof = null;
    if (options.acceptCommand) {
      acceptedCommandProof = await waitFor(async () => {
        const rawMessages = await selectors.readMessages(client.Runtime, 'claude');
        const messages = Array.isArray(rawMessages) ? rawMessages : JSON.parse(rawMessages || '[]');
        const owned = messages.filter(message => JSON.stringify(message).includes(marker));
        const blocks = owned.flatMap(message => message.content_blocks || []);
        const terminal = blocks.find(block => block.type === 'terminal'
          && String(block.command || '').includes(marker)
          && String(block.stdout || '').trim() === marker
          && block.status === 'completed');
        return terminal ? {
          message_count: messages.length,
          owned_message_count: owned.length,
          block_type: terminal.type,
          block_title: terminal.title,
          block_status: terminal.status,
          exact_output_observed: true,
        } : null;
      }, 60000, 'exact accepted command output');
      if (options.screenshot) {
        nativeCapture = await captureNativeHost(pages, client.Runtime, options.screenshot);
      }
    }

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      capability: config.capabilities.permission_dialogs,
      permission_mode: config.permission_mode,
      prompt_id: expired.prompt_id,
      prompt_message: nativePrompt.message,
      native_prompt: nativePrompt,
      native_surface: nativeSurface,
      choices: activePrompt?.choices || nativePrompt.choices,
      response_mode: options.alternateInstruction
        ? 'alternate_instruction' : options.acceptCommand ? 'exact_command_accept' : 'negative_choice',
      alternate_instruction: options.alternateInstruction || null,
      accepted_choice_id: options.acceptCommand ? accept.choice_id : null,
      rejected_choice_id: options.alternateInstruction || options.acceptCommand ? null : reject.choice_id,
      accepted_command_proof: acceptedCommandProof,
      control_result: control.result,
      prompt_expired: true,
      native_prompt_cleared: true,
      native_capture: nativeCapture,
      protected_host: { port: 9223, untouched: true },
      safety: {
        disposable_sends: 1,
        permission_grants: options.acceptCommand ? 1 : 0,
        permission_rejections: options.alternateInstruction || options.acceptCommand ? 0 : 1,
        alternate_instructions: options.alternateInstruction ? 1 : 0,
        focus_actions: 0,
        visible_windows_opened: 0,
      },
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (activePrompt && session) {
      const reject = negativeChoice(activePrompt);
      if (reject) {
        try {
          relay.ws.send(JSON.stringify({
            type: 'permission_response',
            session_id: session.session_id,
            prompt_id: activePrompt.prompt_id,
            choice_id: reject.choice_id,
            request_id: `claude-permission-cleanup-${crypto.randomBytes(4).toString('hex')}`,
          }));
          await sleep(1000);
        } catch {}
        const marker = String(activePrompt.message || '').match(/RAC_CLAUDE_PERMISSION_[a-f0-9]+/i)?.[0] || '';
        const stillOpen = await selectors.detectPermissionDialog(client.Runtime, 'claude').catch(() => null);
        if (marker && stillOpen && String(stillOpen.message || '').includes(marker)) {
          const directReject = negativeChoice(stillOpen);
          if (directReject) {
            const cleanup = await selectors.respondToPermissionDialog(
              client.Runtime,
              'claude',
              directReject.choice_id,
              session.session_id,
              client,
            );
            if (!cleanup.ok) throw new Error(`Owned prompt cleanup failed: ${JSON.stringify(cleanup)}`);
            await waitFor(
              async () => !(await selectors.detectPermissionDialog(client.Runtime, 'claude')),
              30000,
              'owned prompt cleanup after failed E2E',
            );
          }
        }
      }
    }
    try { await client.close(); } catch {}
    try { relay.ws.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude permission E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
