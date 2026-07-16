#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const { PNG } = require('../frontend/node_modules/pngjs');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');
const selectors = require('../agent-proxy/selectors');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const README_PATH = path.join(guard.WORKSPACE_PATH, 'README.md');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function lightPixelStats(png) {
  const xStart = Math.max(0, Math.floor(png.width * 0.02));
  const xEnd = Math.max(xStart + 1, Math.floor(png.width * 0.75));
  const yStart = Math.max(0, Math.floor(png.height * 0.05));
  const yEnd = Math.max(yStart + 1, Math.floor(png.height * 0.95));
  const stepX = Math.max(1, Math.floor((xEnd - xStart) / 36));
  const stepY = Math.max(1, Math.floor((yEnd - yStart) / 30));
  let samples = 0;
  let light = 0;
  let lumaTotal = 0;
  for (let y = yStart; y < yEnd; y += stepY) {
    for (let x = xStart; x < xEnd; x += stepX) {
      const offset = ((y * png.width) + x) * 4;
      if (png.data[offset + 3] < 200) continue;
      const luma = (png.data[offset] * 0.2126)
        + (png.data[offset + 1] * 0.7152)
        + (png.data[offset + 2] * 0.0722);
      samples += 1;
      lumaTotal += luma;
      if (luma >= 180) light += 1;
    }
  }
  assert(samples > 0, 'Native capture exposed no opaque theme pixels');
  const averageLuma = lumaTotal / samples;
  const lightRatio = light / samples;
  return {
    samples,
    average_luma: Number(averageLuma.toFixed(3)),
    light_ratio: Number(lightRatio.toFixed(4)),
    is_light: averageLuma >= 200 && lightRatio >= 0.75,
  };
}

function parseArgs(argv) {
  const options = {
    sendLive: false,
    sessionId: '',
    expectedReadmeSha256: '',
    screenshot: '',
    resultFile: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--session-id') options.sessionId = String(argv[++i] || '').trim();
    else if (arg === '--expected-readme-sha256') options.expectedReadmeSha256 = String(argv[++i] || '').trim().toLowerCase();
    else if (arg === '--screenshot') options.screenshot = path.resolve(argv[++i] || '');
    else if (arg === '--result-file') options.resultFile = path.resolve(argv[++i] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.sendLive, 'Refusing Claude file-change mutation without --send-live');
  assert(/^[0-9a-f-]{36}$/i.test(options.sessionId), '--session-id must be an explicit UUID');
  assert(/^[0-9a-f]{64}$/.test(options.expectedReadmeSha256), '--expected-readme-sha256 must be 64 lowercase hex characters');
  for (const [label, output, extension] of [
    ['screenshot', options.screenshot, '.png'],
    ['result', options.resultFile, '.json'],
  ]) {
    assert(output, `--${label === 'result' ? 'result-file' : label} is required`);
    const relative = path.relative(EVIDENCE_ROOT, output);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${label} output must stay under the evidence tree`);
    assert.equal(path.extname(output).toLowerCase(), extension, `${label} output must use ${extension}`);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 200) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || `${fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '')}/client-ws`;
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(String(data))); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'vscode-claude-file-change-native-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  await waitFor(() => messages.some(message => message.type === 'connection_ack'), 30000, 'relay connection_ack');
  return { ws, messages };
}

function positiveChoice(prompt) {
  return (prompt?.choices || []).find(choice =>
    String(choice.choice_id || '') === '1_yes'
    || /^(?:1[_\s]+)?(?:yes|allow|approve)\b/i.test(String(choice.label || choice.choice_id || ''))
  ) || null;
}

function negativeChoice(prompt) {
  return (prompt?.choices || []).find(choice =>
    /^(?:\d+[_\s]+)?(?:reject|deny|cancel|block|not now|no)\b/i.test(String(choice.label || choice.choice_id || ''))
  ) || null;
}

async function frameInputState(Runtime) {
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

async function nativeFileChangeSurface(Runtime, marker) {
  const raw = await selectors.evalInFrame(Runtime, `
    function visible(el) {
      if (!el || !el.isConnected || !el.getBoundingClientRect) return false;
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function compact(value, limit) { return String(value || '').replace(/\\s+/g, ' ').trim().substring(0, limit); }
    var marker = ${JSON.stringify(marker)};
    var nodes = Array.from(d.querySelectorAll('[class*="toolUse_"], [class*="diffEditorWrapper_"], [class*="toolResult_"]'))
      .filter(visible)
      .map(function(el) { return { class_name: compact(el.className, 240), text: compact(el.innerText || el.textContent, 1200) }; })
      .filter(function(row) { return /README\\.md/i.test(row.text) || row.text.indexOf(marker) !== -1; });
    return JSON.stringify({ matching_visible_nodes: nodes.length, nodes: nodes.slice(0, 12) });
  `);
  return JSON.parse(raw || '{}');
}

async function captureHiddenLightWorkbench(pageTarget, frameRuntime, outputPath) {
  const client = await withTimeout(
    CDP({ port: guard.CDP_PORT, target: pageTarget.id }),
    10000,
    'Native capture CDP connection',
  );
  try {
    await withTimeout(client.Page.enable(), 10000, 'Native capture Page.enable');
    await withTimeout(client.Runtime.enable(), 10000, 'Native capture Runtime.enable');
    const before = await withTimeout(client.Runtime.evaluate({
      expression: `(() => {
        const workbench = document.querySelector('.monaco-workbench');
        return {
          title: document.title,
          url: location.href,
          visibility: document.visibilityState,
          has_focus: document.hasFocus(),
          workbench_class: workbench?.className || '',
          workbench_background: workbench ? getComputedStyle(workbench).getPropertyValue('--vscode-editor-background') : ''
        };
      })()`,
      returnByValue: true,
    }), 10000, 'Native capture workbench preflight');
    const pageState = before.result.value;
    assert.equal(pageState.visibility, 'hidden', 'Disposable VS Code workbench must remain hidden');
    const workbenchTokens = String(pageState.workbench_class || '').split(/\s+/).filter(Boolean);
    assert(workbenchTokens.includes('vs') && !workbenchTokens.includes('vs-dark')
      && /light/i.test(pageState.workbench_class),
      `Disposable VS Code workbench is not light themed: ${JSON.stringify(pageState)}`);
    const innerState = JSON.parse(await withTimeout(selectors.evalInFrame(frameRuntime, `return JSON.stringify({
      visibility: d.visibilityState,
      has_focus: d.hasFocus(),
      url: d.location.href,
      body_class: d.body?.className || '',
      theme_kind: d.body?.getAttribute('data-vscode-theme-kind') || '',
      theme_name: d.body?.getAttribute('data-vscode-theme-name') || '',
      editor_background: getComputedStyle(d.documentElement).getPropertyValue('--vscode-editor-background')
    });`), 10000, 'Native capture Claude frame preflight') || '{}');
    assert.equal(innerState.visibility, 'hidden', 'Disposable Claude webview must remain hidden');
    assert(/\bvscode-light\b/.test(`${innerState.body_class} ${innerState.theme_kind}`),
      `Disposable Claude webview is not light themed: ${JSON.stringify(innerState)}`);
    let captured = null;
    const attempts = [];
    for (const fromSurface of [true, true, true]) {
      const shot = await withTimeout(
        client.Page.captureScreenshot({ format: 'png', fromSurface, captureBeyondViewport: false }),
        15000,
        'Native capture Page.captureScreenshot',
      );
      const bytes = Buffer.from(shot.data, 'base64');
      const png = PNG.sync.read(bytes);
      const pixelTheme = lightPixelStats(png);
      attempts.push({ from_surface: fromSurface, ...pixelTheme });
      if (pixelTheme.is_light) {
        captured = { bytes, png, fromSurface, pixelTheme };
        break;
      }
      await sleep(350);
    }
    assert(captured, `Disposable VS Code compositor did not paint the light theme: ${JSON.stringify(attempts)}`);
    const { bytes, png, fromSurface, pixelTheme } = captured;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bytes);
    const after = await withTimeout(client.Runtime.evaluate({
      expression: `({ title: document.title, url: location.href, visibility: document.visibilityState, has_focus: document.hasFocus() })`,
      returnByValue: true,
    }), 10000, 'Native capture workbench postflight');
    assert.equal(after.result.value.title, pageState.title, 'Native capture changed the workbench title');
    assert.equal(after.result.value.url, pageState.url, 'Native capture changed the workbench URL');
    assert.equal(after.result.value.visibility, pageState.visibility, 'Native capture changed workbench visibility');
    assert.equal(after.result.value.has_focus, pageState.has_focus, 'Native capture changed document focus state');
    return {
      path: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
      sha256: sha256(bytes),
      width: png.width,
      height: png.height,
      bytes: bytes.length,
      from_surface: fromSurface,
      pixel_theme: pixelTheme,
      capture_attempts: attempts,
      workbench_before: pageState,
      workbench_after: after.result.value,
      inner_frame: innerState,
    };
  } finally {
    await withTimeout(client.close(), 3000, 'Native capture CDP close').catch(() => {});
  }
}

async function readMessages(Runtime, sessionId) {
  const raw = await selectors.readMessages(Runtime, 'claude', sessionId);
  return Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
}

function ownedChangeState(messages, marker) {
  const rows = Array.isArray(messages) ? messages : [];
  const fileBlocks = rows.flatMap(message => message.content_blocks || [])
    .filter(block => block?.type === 'file_changes');
  const shellBlocks = rows.flatMap(message => message.content_blocks || [])
    .filter(block => block?.type === 'terminal' && JSON.stringify(block).includes(marker));
  const finalMarkdownBlocks = rows.filter(message => message?.role === 'assistant')
    .flatMap(message => message.content_blocks || [])
    .filter(block => block?.type === 'markdown' && String(block.content || block.text || '').trim() === marker);
  return {
    fileBlocks,
    shellBlocks,
    finalMarkdownBlocks,
    settled: fileBlocks.length > 0 && shellBlocks.length === 0 && finalMarkdownBlocks.length > 0,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const settingsPath = guard.assertUpdatesDisabled('VS Code Claude file-change native E2E');
  assert.equal(guard.CDP_PORT, 9230, 'File-change E2E is restricted to disposable CDP port 9230');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert(/light/i.test(String(settings['workbench.colorTheme'] || '')),
    'Disposable profile must explicitly select a light workbench theme');

  const baselineReadme = fs.readFileSync(README_PATH);
  assert.equal(sha256(baselineReadme), options.expectedReadmeSha256, 'README baseline hash changed');
  const targets = await CDP.List({ port: guard.CDP_PORT });
  const targetSet = guard.assertTargetSet(targets, 'claude', 'Claude file-change native E2E');
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-proxy', 'session-store.json'), 'utf8'));
  const session = store.sessions?.[options.sessionId];
  assert(session, `Requested disposable Claude session is not stored: ${options.sessionId}`);
  assert(guard.isThrowawaySession(session, 'claude'), 'Requested Claude session is outside the exact disposable workspace');
  assert.equal(Number(session.cdp_port), guard.CDP_PORT, 'Requested Claude session uses the wrong CDP port');
  assert.equal(session.status, 'healthy', 'Requested Claude session is not healthy');
  assert.equal(session.target_id, targetSet.frame.id, 'Requested Claude session does not bind the exact live frame');

  const relay = await openRelay();
  const client = await CDP({ port: guard.CDP_PORT, target: targetSet.frame.id });
  let activePrompt = null;
  let result = null;
  const cleanup = { readme_restored: false, readme_sha256: null };
  try {
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(targetSet.frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    assert.equal(await selectors.detectPermissionDialog(client.Runtime, 'claude'), null,
      'Disposable Claude already has a permission prompt');
    await waitFor(async () => !((await selectors.detectThinking(client.Runtime, 'claude'))?.thinking),
      60000, 'Claude idle before owned file change');
    const draft = await frameInputState(client.Runtime);
    assert.equal(draft.error, undefined, JSON.stringify(draft));
    assert.equal(draft.text, '', 'Disposable Claude draft must be empty before owned file change');

    const baselineMessages = await readMessages(client.Runtime, session.session_id);
    const runId = crypto.randomBytes(4).toString('hex');
    const marker = `RAC_CLAUDE_FILE_CHANGE_${runId}`;
    const clientMessageId = `claude-file-change-${runId}`;
    const relayStart = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'send',
      session: session.session_id,
      client_message_id: clientMessageId,
      content: `Use the Edit or Write file tool, never Bash or a terminal, to append one new line containing exactly ${marker} to README.md in the current workspace. Then reply with exactly ${marker}.`,
    }));
    await waitFor(() => relay.messages.slice(relayStart).find(message =>
      message.type === 'proxy_send_result'
      && message.client_message_id === clientMessageId
      && message.result === 'delivered'), 60000, 'Claude file-change send receipt');

    let permission = null;
    const editDeadline = Date.now() + 180000;
    while (Date.now() < editDeadline && !fs.readFileSync(README_PATH, 'utf8').includes(marker)) {
      const prompt = relay.messages.slice(relayStart).find(message =>
        message.type === 'permission_prompt'
        && (message.session_id || message.session) === session.session_id
        && message.prompt_id !== permission?.prompt_id);
      if (prompt) {
        activePrompt = prompt;
        const promptText = `${prompt.title || ''} ${prompt.message || ''} ${prompt.command || ''}`;
        assert(/README\.md|Edit file|Write file/i.test(promptText), `Refusing unrelated permission: ${promptText}`);
        assert(!/Bash|PowerShell|command/i.test(String(prompt.command || '')), 'Refusing shell permission during file-change capture');
        const accept = positiveChoice(prompt);
        assert(accept, `Owned file-change permission exposed no one-time positive choice: ${JSON.stringify(prompt.choices)}`);
        const requestId = `claude-file-change-permission-${runId}`;
        const responseStart = relay.messages.length;
        relay.ws.send(JSON.stringify({
          type: 'permission_response',
          session_id: session.session_id,
          prompt_id: prompt.prompt_id,
          choice_id: accept.choice_id,
          request_id: requestId,
        }));
        const control = await waitFor(() => relay.messages.slice(responseStart).find(message =>
          message.type === 'agent_control_result' && message.request_id === requestId),
        30000, 'Claude one-time file-change permission response');
        assert.equal(control.result, 'ok', JSON.stringify(control));
        await waitFor(() => relay.messages.slice(responseStart).find(message =>
          message.type === 'permission_prompt_expired' && message.prompt_id === prompt.prompt_id),
        30000, 'Claude file-change prompt expiration');
        activePrompt = null;
        permission = { prompt_id: prompt.prompt_id, choice_id: accept.choice_id, control_result: control.result };
      }
      await sleep(250);
    }
    assert(fs.readFileSync(README_PATH, 'utf8').includes(marker), 'Claude did not persist the owned README marker');
    await waitFor(async () => !((await selectors.detectThinking(client.Runtime, 'claude'))?.thinking),
      120000, 'Claude idle after owned file change');

    const afterMessages = await waitFor(async () => {
      const messages = await readMessages(client.Runtime, session.session_id);
      const newMessages = messages.slice(Math.max(0, baselineMessages.length - 1));
      const state = ownedChangeState(newMessages, marker);
      return state.settled ? { messages, ...state } : null;
    }, 60000, 'canonical file-change block and final assistant marker without owned terminal output');
    const nativeSurface = await nativeFileChangeSurface(client.Runtime, marker);
    assert(nativeSurface.matching_visible_nodes > 0,
      `No visible native README file-change surface found: ${JSON.stringify(nativeSurface)}`);
    const capture = await captureHiddenLightWorkbench(targetSet.page, client.Runtime, options.screenshot);

    result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      target_id: targetSet.frame.id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      marker,
      baseline_readme_sha256: options.expectedReadmeSha256,
      baseline_messages: baselineMessages.length,
      final_messages: afterMessages.messages.length,
      canonical_file_change_blocks: afterMessages.fileBlocks.length,
      canonical_final_markdown_blocks: afterMessages.finalMarkdownBlocks.length,
      owned_terminal_blocks: afterMessages.shellBlocks.length,
      permission,
      native_surface: nativeSurface,
      native_capture: capture,
      protected_host: { port: 9223, untouched: true },
      safety: {
        disposable_sends: 1,
        one_time_file_permissions: permission ? 1 : 0,
        shell_permissions: 0,
        focus_actions: 0,
        visible_windows_opened: 0,
        new_windows_opened: 0,
      },
    };
  } finally {
    if (activePrompt) {
      const reject = negativeChoice(activePrompt);
      if (reject) {
        try {
          relay.ws.send(JSON.stringify({
            type: 'permission_response',
            session_id: session.session_id,
            prompt_id: activePrompt.prompt_id,
            choice_id: reject.choice_id,
            request_id: `claude-file-change-cleanup-${crypto.randomBytes(4).toString('hex')}`,
          }));
          await sleep(1000);
        } catch {}
      }
    }
    fs.writeFileSync(README_PATH, baselineReadme);
    cleanup.readme_sha256 = sha256(fs.readFileSync(README_PATH));
    cleanup.readme_restored = cleanup.readme_sha256 === options.expectedReadmeSha256;
    assert(cleanup.readme_restored, 'README cleanup did not restore the exact baseline bytes');
    try { await client.close(); } catch {}
    try { relay.ws.close(); } catch {}
    try { relay.ws.terminate(); } catch {}
  }

  result.cleanup = cleanup;
  fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
  fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude file-change native E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = {
  captureHiddenLightWorkbench,
  lightPixelStats,
  main,
  nativeFileChangeSurface,
  negativeChoice,
  ownedChangeState,
  parseArgs,
  positiveChoice,
  readMessages,
  withTimeout,
};
