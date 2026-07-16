#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const codexCli = require('../agent-proxy/codex-cli');
const production = require('./vscode-extension-production-e2e');
const {
  nativeDraftState,
  nativeState,
  openNative,
  requestConfig,
  restoreOriginal,
} = require('./codex-desktop-owned-controls-e2e');
const {
  OPERATION_LOCK_PATH,
  acquirePidLock,
} = require('./production-harness-overnight-soak');
const { freshEvidenceDirectory, freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const BROWSER_CDP = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function parseArgs(argv) {
  const options = {
    sendLive: false,
    allowShortSoak: false,
    soakMinutes: 10,
    soakIntervalMs: 60_000,
    soakTurnLimit: 0,
    timeoutMs: 240_000,
    output: freshEvidencePath(ROOT, 'codex-desktop-owned-soak-result.json'),
    progress: freshEvidencePath(ROOT, 'codex-desktop-owned-soak-live.jsonl'),
    evidenceDir: freshEvidenceDirectory(ROOT, 'codex-desktop-owned-soak-visuals'),
    proxyLogDir: ROOT,
    ownedThreadId: '',
    ownedMarker: '',
    idleStabilityMs: 30_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--allow-short-soak') options.allowShortSoak = true;
    else if (arg === '--soak-minutes' && argv[index + 1]) options.soakMinutes = Number(argv[++index]);
    else if (arg === '--soak-interval-ms' && argv[index + 1]) options.soakIntervalMs = Number(argv[++index]);
    else if (arg === '--soak-turn-limit' && argv[index + 1]) options.soakTurnLimit = Number(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--progress' && argv[index + 1]) options.progress = path.resolve(argv[++index]);
    else if (arg === '--evidence-dir' && argv[index + 1]) options.evidenceDir = path.resolve(argv[++index]);
    else if (arg === '--proxy-log-dir' && argv[index + 1]) options.proxyLogDir = path.resolve(argv[++index]);
    else if (arg === '--owned-thread-id' && argv[index + 1]) options.ownedThreadId = String(argv[++index]);
    else if (arg === '--owned-marker' && argv[index + 1]) options.ownedMarker = String(argv[++index]);
    else if (arg === '--idle-stability-ms' && argv[index + 1]) options.idleStabilityMs = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.sendLive) throw new Error('Refusing Codex Desktop mutation without --send-live');
  if (!Number.isFinite(options.soakMinutes) || options.soakMinutes <= 0) throw new Error('--soak-minutes must be positive');
  if (!Number.isFinite(options.soakIntervalMs) || options.soakIntervalMs < 0) throw new Error('--soak-interval-ms must be non-negative');
  if (!Number.isFinite(options.soakTurnLimit) || options.soakTurnLimit < 0) throw new Error('--soak-turn-limit must be non-negative');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) throw new Error('--timeout-ms must be at least 30000');
  if (!Number.isFinite(options.idleStabilityMs) || options.idleStabilityMs < 5_000) throw new Error('--idle-stability-ms must be at least 5000');
  if (!!options.ownedThreadId !== !!options.ownedMarker) {
    throw new Error('--owned-thread-id and --owned-marker must be supplied together');
  }
  if (!options.allowShortSoak && options.soakMinutes < 10) {
    throw new Error('Production Codex Desktop soak must be at least 10 minutes');
  }
  if (!options.allowShortSoak && (options.soakIntervalMs !== 60_000 || options.soakTurnLimit > 0)) {
    throw new Error('Accelerated soak controls require --allow-short-soak');
  }
  return options;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function reporter(filePath) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, '', 'utf8');
  return (event, details = {}) => {
    const record = { at: new Date().toISOString(), event, ...details };
    const line = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(filePath, line, 'utf8');
    process.stdout.write(line);
  };
}

function readLogOffset(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function readLogTail(filePath, offset) {
  try {
    const body = fs.readFileSync(filePath);
    return body.subarray(Math.min(offset, body.length)).toString('utf8');
  } catch {
    return '';
  }
}

function codexFailureLines(text, sessionId) {
  return String(text || '').split(/\r?\n/).filter(line => {
    if (!line || (!line.includes(sessionId) && !/codex.?desktop/i.test(line))) return false;
    return /selector.{0,20}(?:fail|error)|(?:read|cdp).{0,20}(?:fail|error|timeout)|uncaught|exception/i.test(line);
  });
}

function blockCounts(messages) {
  const counts = {};
  for (const message of messages || []) {
    for (const block of message.content_blocks || []) {
      const type = String(block.type || block.kind || 'unknown');
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

function strongUserAnchors(messages) {
  return Array.from(new Set((Array.isArray(messages) ? messages : [])
    .filter(message => message?.role === 'user')
    .map(message => String(message.content || '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 80))).slice(-4);
}

function resolveOwnedArchive(messages) {
  const anchors = strongUserAnchors(messages);
  const options = {
    // A retained owned thread can be reused well after its archive birth
    // window. Exact multi-anchor matching already rejects ambiguous archives,
    // so do not apply the one-hour provisional-thread creation cutoff here.
    sinceMs: 0,
    maxFiles: 100,
    summaryOptions: {
      maxHydrateBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES,
      preferTailBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_TAIL_BYTES,
    },
  };
  const summary = anchors.length >= 2
    ? codexCli.findRecentSessionByUserAnchors(anchors, options)
    : (anchors.length === 1 ? codexCli.findRecentSessionByUserAnchor(anchors[0], options) : null);
  return summary?.filePath || '';
}

function archiveTokenState(archivePath, token) {
  if (!archivePath || !token) return { user: false, assistant: false };
  const summary = codexCli.readSessionSummary(archivePath, {
    maxHydrateBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES,
    preferTailBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_TAIL_BYTES,
  });
  const messages = Array.isArray(summary?.messages) ? summary.messages : [];
  return {
    user: messages.some(message => message?.role === 'user' && String(message.content || '').includes(token)),
    assistant: messages.some(message => message?.role === 'assistant' && String(message.content || '').includes(token)),
  };
}

async function history(relay, sessionId, label) {
  const requestId = `codex-desktop-soak-history-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'get_history',
    session: sessionId,
    request_id: requestId,
    limit: 1000,
    user_initiated: true,
  }));
  const frame = await production.waitFor(
    () => relay.messages.slice(start).find(message =>
      ['history', 'history_snapshot', 'history_chunk'].includes(message.type)
      && message.request_id === requestId
      && Array.isArray(message.messages)),
    30_000,
    `${label} history`,
    100,
  );
  return frame.messages;
}

function activityKinds(messages, sessionId, startIndex) {
  return messages.slice(startIndex).filter(message =>
    ['status', 'proxy_status', 'session_status', 'agent_started'].includes(message.type)
    && (message.session_id || message.session) === sessionId
  ).map(message => message.type === 'agent_started'
    ? 'agent_started'
    : String(message.activity?.kind || (message.thinking ? 'thinking' : ''))).filter(Boolean);
}

async function sendTurn({ relay, native, sessionId, ownedThreadId, archivePath, name, prompt, token, timeoutMs }) {
  assert.strictEqual(relay.ws.readyState, 1, `Relay closed before ${name}`);
  const startIndex = relay.messages.length;
  const clientMessageId = `codex-desktop-soak-${name}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();
  relay.ws.send(JSON.stringify({
    type: 'send',
    session: sessionId,
    content: prompt,
    client_message_id: clientMessageId,
  }));
  const accepted = await production.waitFor(
    () => relay.messages.slice(startIndex).find(message =>
      message.type === 'message_accepted' && message.client_message_id === clientMessageId),
    30_000,
    `${name} accepted`,
    50,
  );
  const acceptedObservedAtMs = Date.now();
  const delivered = await production.waitFor(
    () => relay.messages.slice(startIndex).find(message =>
      message.type === 'proxy_send_result' && message.client_message_id === clientMessageId),
    60_000,
    `${name} delivered`,
    50,
  );
  assert.strictEqual(delivered.result, 'delivered', JSON.stringify(delivered));

  const working = await production.waitFor(async () => {
    const kinds = activityKinds(relay.messages, sessionId, startIndex);
    const kind = kinds.find(value => /agent_started|thinking|generating|working|command|file|tool/i.test(value));
    if (kind) return kind;
    const state = await nativeState(native, sessionId);
    return state.thinking?.thinking ? 'native-thinking' : null;
  }, 60_000, `${name} active traffic`, 100);

  const settled = await production.waitFor(async () => {
    const state = await nativeState(native, sessionId);
    const activeId = String(state.active?.id || '');
    const correctThread = ownedThreadId ? activeId === ownedThreadId : !!activeId;
    const domUser = state.messages.some(message => message.role === 'user' && String(message.content || '').includes(token));
    const domAssistant = state.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token));
    const archive = archiveTokenState(archivePath, token);
    const receiptSurface = domUser && domAssistant
      ? 'native_dom'
      : (archive.user && archive.assistant ? 'exact_native_archive' : '');
    return correctThread && receiptSurface && !state.thinking?.thinking
      ? { state, receipt_surface: receiptSurface, archive }
      : null;
  }, timeoutMs, `${name} settled assistant token`, 250);

  const relayHistory = await production.waitFor(async () => {
    const messages = await history(relay, sessionId, name);
    const user = messages.some(message => message.role === 'user' && String(message.content || '').includes(token));
    const assistant = messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token));
    return user && assistant ? messages : null;
  }, timeoutMs, `${name} relay continuity`, 500);
  const resolvedArchivePath = archivePath || resolveOwnedArchive(relayHistory);
  return {
    client_message_id: clientMessageId,
    accepted_at: accepted.ts || accepted.timestamp || null,
    accepted_observed_at_ms: acceptedObservedAtMs,
    delivered_path: delivered.delivery_path || delivered.path || null,
    working,
    receipt_surface: settled.receipt_surface,
    elapsed_ms: Date.now() - startedAt,
    native_messages: settled.state.messages.length,
    relay_messages: relayHistory.length,
    block_counts: blockCounts(relayHistory),
    active_thread_id: settled.state.active.id,
    native_archive_path: resolvedArchivePath || null,
  };
}

async function waitForStableNativeIdle(native, sessionId, expectedThreadId, stabilityMs) {
  const startedAt = Date.now();
  let idleSince = 0;
  let samples = 0;
  return production.waitFor(async () => {
    const state = await nativeState(native, sessionId);
    samples += 1;
    if (state.active?.id !== expectedThreadId || state.thinking?.thinking) {
      idleSince = 0;
      return null;
    }
    if (!idleSince) idleSince = Date.now();
    if (Date.now() - idleSince < stabilityMs) return null;
    return {
      state,
      samples,
      observed_ms: Date.now() - startedAt,
      continuous_idle_ms: Date.now() - idleSince,
    };
  }, Math.max(60_000, stabilityMs * 3), `stable idle native thread ${expectedThreadId}`, 250);
}

async function captureNative(native, outputPath, token, expectedThreadId, archivePath) {
  await native.client.Page.enable();
  const state = await nativeState(native, 'codex-desktop-owned-soak-capture');
  assert.strictEqual(state.active?.id, expectedThreadId, 'Native capture thread changed');
  const tokenInDom = state.messages.some(message => String(message.content || '').includes(token));
  const archive = archiveTokenState(archivePath, token);
  assert(tokenInDom || (archive.user && archive.assistant), 'Native capture token is absent from DOM and exact archive');
  const rectResult = await native.client.Runtime.evaluate({
    expression: `(() => {
      const candidates = [...document.querySelectorAll('main, [role="main"]')];
      const target = candidates.find(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }) || document.documentElement;
      const marker = [...document.querySelectorAll('body *')].find(node =>
        node.childElementCount === 0 && String(node.textContent || '').includes(${JSON.stringify(token)}));
      marker?.scrollIntoView({ block: 'center' });
      const rect = target.getBoundingClientRect();
      return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height };
    })()`,
    returnByValue: true,
  });
  const rect = rectResult.result?.value;
  assert(rect && rect.width > 0 && rect.height > 0, 'Native transcript crop is empty');
  const shot = await native.client.Page.captureScreenshot({
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  const buffer = Buffer.from(shot.data, 'base64');
  ensureParent(outputPath);
  fs.writeFileSync(outputPath, buffer);
  return {
    path: relative(outputPath),
    bytes: buffer.length,
    sha256: sha256(buffer),
    token_in_native_dom: tokenInDom,
    token_in_exact_native_archive: archive.user && archive.assistant,
    focus_actions: 0,
  };
}

async function openBrowserEvidence(sessionId) {
  const endpoint = new URL(BROWSER_CDP);
  const host = endpoint.hostname;
  const port = Number(endpoint.port || 9240);
  const pages = (await CDP.List({ host, port })).filter(target => target.type === 'page');
  assert.strictEqual(pages.length, 1, 'Exactly one persistent verification page is required');
  const client = await CDP({ host, port, target: pages[0].id });
  await Promise.all([client.Runtime.enable(), client.Page.enable()]);
  const evaluate = async expression => {
    const response = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Browser Runtime.evaluate failed');
    return response.result?.value;
  };
  const restore = await evaluate(`(() => ({
      active_session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      sidebar_scroll_top: document.querySelector('.session-list')?.scrollTop || 0,
      transcript_scroll_top: document.querySelector('.messages')?.scrollTop || 0,
      theme: document.documentElement.dataset.theme || '',
      width: innerWidth,
      height: innerHeight,
      visibility_state: document.visibilityState,
      has_focus: document.hasFocus(),
    }))()`);
  assert.strictEqual(restore.visibility_state, 'hidden', 'Verification page is not hidden before capture');
  assert.strictEqual(restore.has_focus, false, 'Verification page is focused before capture');
  const targetFound = await evaluate(`(() => {
    const targetSessionId = ${JSON.stringify(sessionId)};
    const card = document.querySelector('.session-card[data-session-id="' + CSS.escape(targetSessionId) + '"]');
    if (!card) return false;
    card.click();
    return true;
  })()`);
  assert(targetFound, 'Codex Desktop card is not rendered in the persistent verification page');
  await production.waitFor(async () => {
    const active = await evaluate(`document.querySelector('.session-card.active')?.dataset.sessionId || ''`);
    return active === sessionId ? true : null;
  }, 30_000, 'Codex Desktop WebUI selection', 100);
  const afterSelection = await evaluate(`({ visibility_state: document.visibilityState, has_focus: document.hasFocus() })`);
  assert.strictEqual(afterSelection.visibility_state, 'hidden', 'Session selection made the verification page visible');
  assert.strictEqual(afterSelection.has_focus, false, 'Session selection focused the verification page');
  return { client, evaluate, restore, target: pages[0] };
}

function webCaptureStateIsReady(state) {
  return !!(
    state?.token_visible
    && Number(state.terminal_blocks || 0) > 0
    && Number(state.file_change_blocks || 0) > 0
    && Number(state.markdown_rows || 0) > 0
    && Array.isArray(state.active_live_channels)
    && state.active_live_channels.length === 0
    && Number(state.active_step_spinners || 0) === 0
    && Number(state.active_card_spinners || 0) === 0
    && Number(state.visible_stop_controls || 0) === 0
    && state.rect
    && Number(state.rect.width || 0) > 0
    && Number(state.rect.height || 0) > 0
    && state.visibility_state === 'hidden'
    && state.has_focus === false
  );
}

async function captureWeb(evidence, outputPath, token, viewport = null) {
  const { client, evaluate } = evidence;
  if (viewport) {
    await client.Emulation.setDeviceMetricsOverride({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
  } else {
    await client.Emulation.clearDeviceMetricsOverride();
  }
  await evaluate(`(() => {
    const messages = document.querySelector('.messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    return true;
  })()`);
  let idleSince = 0;
  const summary = await production.waitFor(async () => {
    const state = await evaluate(`(() => {
    const expectedToken = ${JSON.stringify(token)};
    const messages = document.querySelector('.messages');
    const main = document.querySelector('.main');
    const rect = main?.getBoundingClientRect();
    const visible = node => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    const activeLiveChannels = [...(main?.querySelectorAll('[data-live-channel="current"], [data-live-channel="thinking"]') || [])]
      .filter(visible)
      .map(node => String(node.dataset.liveChannel || ''));
    return {
      token_visible: String(main?.innerText || '').includes(expectedToken),
      terminal_blocks: [...(main?.querySelectorAll('.content-block-terminal') || [])].filter(visible).length,
      file_change_blocks: [...(main?.querySelectorAll('.content-block-file-change') || [])].filter(visible).length,
      markdown_rows: [...(main?.querySelectorAll('[data-message-block-type="markdown"]') || [])].filter(visible).length,
      timestamp_rows: [...(main?.querySelectorAll('.message-timestamp') || [])].filter(visible).length,
      active_live_channels: activeLiveChannels,
      active_step_spinners: [...(main?.querySelectorAll('[data-live-channel="step"] .native-activity-spinner') || [])].filter(visible).length,
      active_card_spinners: [...document.querySelectorAll('.session-card.active .session-card-native-status')].filter(visible).length,
      visible_stop_controls: [...(main?.querySelectorAll('button') || [])].filter(node =>
        visible(node) && /^stop(?:\s|$)/i.test(String(node.innerText || node.getAttribute('aria-label') || node.title || '').trim())
      ).length,
      transcript_scroll_top: messages?.scrollTop || 0,
      viewport: { width: innerWidth, height: innerHeight },
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      visibility_state: document.visibilityState,
      has_focus: document.hasFocus(),
    };
    })()`);
    if (!webCaptureStateIsReady(state)) {
      idleSince = 0;
      return null;
    }
    if (!idleSince) idleSince = Date.now();
    const idleStableMs = Date.now() - idleSince;
    return idleStableMs >= 1500 ? { ...state, idle_stable_ms: idleStableMs } : null;
  }, 60_000, 'structured idle WebUI capture state', 100);
  assert(summary.token_visible, 'WebUI capture token is absent');
  assert(summary.terminal_blocks > 0, 'WebUI has no visible terminal block');
  assert(summary.file_change_blocks > 0, 'WebUI has no visible file-change block');
  assert(summary.markdown_rows > 0, 'WebUI has no visible conversational markdown row');
  assert(summary.rect && summary.rect.width > 0 && summary.rect.height > 0, 'WebUI main crop is empty');
  assert.strictEqual(summary.visibility_state, 'hidden', 'WebUI capture made the verification page visible');
  assert.strictEqual(summary.has_focus, false, 'WebUI capture focused the verification page');
  const screenshot = await client.Page.captureScreenshot({
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { ...summary.rect, scale: 1 },
  });
  const shot = Buffer.from(screenshot.data, 'base64');
  const postCapture = await evaluate(`(() => ({
    active_live_channels: [...document.querySelectorAll('.main [data-live-channel="current"], .main [data-live-channel="thinking"]')]
      .filter(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.display !== 'none'
          && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      }).map(node => String(node.dataset.liveChannel || '')),
    active_step_spinners: document.querySelectorAll('.main [data-live-channel="step"] .native-activity-spinner').length,
    active_card_spinners: document.querySelectorAll('.session-card.active .session-card-native-status').length,
    visible_stop_controls: [...document.querySelectorAll('.main button')].filter(node => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const label = String(node.innerText || node.getAttribute('aria-label') || node.title || '').trim();
      return box.width > 0 && box.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > 0 && /^stop(?:\s|$)/i.test(label);
    }).length,
    visibility_state: document.visibilityState,
    has_focus: document.hasFocus(),
  }))()`);
  assert.deepStrictEqual(postCapture.active_live_channels, [], 'WebUI became active during capture');
  assert.strictEqual(postCapture.active_step_spinners, 0, 'WebUI step spinner appeared during capture');
  assert.strictEqual(postCapture.active_card_spinners, 0, 'WebUI card spinner appeared during capture');
  assert.strictEqual(postCapture.visible_stop_controls, 0, 'WebUI Stop control appeared during capture');
  assert.strictEqual(postCapture.visibility_state, 'hidden', 'WebUI became visible during capture');
  assert.strictEqual(postCapture.has_focus, false, 'WebUI became focused during capture');
  ensureParent(outputPath);
  fs.writeFileSync(outputPath, shot);
  return {
    path: relative(outputPath),
    bytes: shot.length,
    sha256: sha256(shot),
    ...summary,
    focus_actions: 0,
  };
}

async function closeBrowserEvidence(evidence) {
  if (!evidence) return;
  const { client, evaluate, restore } = evidence;
  try { await client.Emulation.clearDeviceMetricsOverride(); } catch {}
  if (restore.active_session_id) {
    await evaluate(`(() => {
      const activeSessionId = ${JSON.stringify(restore.active_session_id)};
      const card = document.querySelector('.session-card[data-session-id="' + CSS.escape(activeSessionId) + '"]');
      card?.click();
    })()`).catch(() => {});
    await production.waitFor(async () => {
      const active = await evaluate(`document.querySelector('.session-card.active')?.dataset.sessionId || ''`);
      return active === restore.active_session_id ? true : null;
    }, 10_000, 'restore verification browser session', 100).catch(() => {});
  }
  await evaluate(`(() => {
    const state = ${JSON.stringify(restore)};
    const sidebar = document.querySelector('.session-list');
    if (sidebar) sidebar.scrollTop = state.sidebar_scroll_top;
    const messages = document.querySelector('.messages');
    if (messages) messages.scrollTop = state.transcript_scroll_top;
    return { visibility_state: document.visibilityState, has_focus: document.hasFocus() };
  })()`).catch(() => {});
  try { await client.close(); } catch {}
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  let report = () => {};
  let ownsEvidence = false;
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    run_id: runId,
    focus_actions: 0,
    visible_windows_opened: 0,
    app_restarted: false,
    production_relay_restarts: 0,
    soak_minutes_requested: options.soakMinutes,
    turns: [],
    checkpoints: [],
  };
  ensureParent(options.output);
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const proxyLog = path.join(options.proxyLogDir, 'proxy.log');
  const proxyErrLog = path.join(options.proxyLogDir, 'proxy-err.log');
  const logOffsets = { proxy: readLogOffset(proxyLog), error: readLogOffset(proxyErrLog) };
  let releaseOperation = null;
  let native = null;
  let relay = null;
  let browserEvidence = null;
  let sessionId = '';
  let originalThreadId = '';
  let ownedThreadId = '';
  let ownedArchivePath = '';
  let threadChanged = false;
  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-desktop-owned-soak', kind: 'owned-production-soak', acquired_at: new Date().toISOString() })}\n`,
    );
    // Evidence files belong only to the process that acquired the production
    // operation lock. A rejected duplicate must not truncate progress or
    // overwrite the active owner's terminal result.
    report = reporter(options.progress);
    ownsEvidence = true;
    result.operation_lock = OPERATION_LOCK_PATH;
    native = await openNative();
    relay = await production.openRelay();
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.agent_type === 'codex-desktop' && item.status !== 'disconnected'),
      30_000,
      'connected Codex Desktop session',
    );
    sessionId = session.session_id;
    result.session_id = sessionId;
    const baseline = await nativeState(native, sessionId);
    assert(baseline.active?.id, 'Codex Desktop has no active thread');
    originalThreadId = baseline.active.id;
    result.original_thread = { id: originalThreadId, title: baseline.active.title || '' };
    const stableIdle = await waitForStableNativeIdle(
      native,
      sessionId,
      originalThreadId,
      options.idleStabilityMs,
    );
    result.original_thread_idle_guard = {
      samples: stableIdle.samples,
      observed_ms: stableIdle.observed_ms,
      continuous_idle_ms: stableIdle.continuous_idle_ms,
    };
    const config = await requestConfig(relay, sessionId);
    for (const capability of ['new_thread', 'switch_thread', 'thread_list']) {
      assert.strictEqual(config.capabilities?.[capability], true, `Missing ${capability} capability`);
    }
    report('start', { run_id: runId, session_id: sessionId, original_thread_id: originalThreadId });

    let toolToken = options.ownedMarker;
    if (options.ownedThreadId) {
      assert(
        baseline.threads.some(thread => thread.id === options.ownedThreadId),
        'Exact pre-owned Codex Desktop thread is absent',
      );
      await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
        thread_id: options.ownedThreadId,
      });
      threadChanged = true;
      ownedThreadId = options.ownedThreadId;
      const owned = await production.waitFor(async () => {
        const state = await nativeState(native, sessionId);
        const markerPresent = state.messages.some(message => String(message.content || '').includes(options.ownedMarker));
        return state.active?.id === ownedThreadId && !state.thinking?.thinking && markerPresent ? state : null;
      }, 30_000, 'exact pre-owned Codex Desktop marker thread', 100);
      const recoveredHistory = await production.waitFor(async () => {
        const messages = await history(relay, sessionId, 'pre-owned tool recovery');
        const counts = blockCounts(messages);
        return Number(counts.terminal || 0) > 0 && Number(counts.file_changes || 0) > 0
          ? { messages, counts }
          : null;
      }, options.timeoutMs, 'pre-owned structured relay recovery', 500);
      result.owned_thread_id = ownedThreadId;
      ownedArchivePath = resolveOwnedArchive(recoveredHistory.messages);
      assert(ownedArchivePath, 'Exact pre-owned Codex Desktop archive could not be resolved');
      result.owned_archive_path = ownedArchivePath;
      result.tool_turn = {
        reused_owned_thread: true,
        native_messages: owned.messages.length,
        relay_messages: recoveredHistory.messages.length,
        block_counts: recoveredHistory.counts,
      };
    } else {
      await production.control(relay.ws, relay.messages, sessionId, 'new_thread');
      threadChanged = true;
      await production.waitFor(async () => {
        const state = await nativeState(native, sessionId);
        const draft = await nativeDraftState(native);
        return !state.active?.id && state.messages.length === 0 && draft.composer_visible ? true : null;
      }, 30_000, 'empty owned Codex Desktop draft', 100);

      toolToken = `RAC_CODEX_DESKTOP_TOOL_${runId}`;
      const toolPrompt = [
        'This is an owned disposable Remote Agent Chat production check.',
        `In the current disposable workspace only, use your file-editing tool to create a UTF-8 file named rac-codex-desktop-soak-${runId}.txt whose first line is ${toolToken}.`,
        'Then use your shell tool to read that file.',
        `Finish with a normal conversational reply containing ${toolToken} and a fenced code block containing SOAK_READY.`,
        'Do not touch any other file.',
      ].join(' ');
      const toolTurn = await sendTurn({
        relay, native, sessionId, ownedThreadId: '', archivePath: '', name: 'tool', prompt: toolPrompt, token: toolToken, timeoutMs: options.timeoutMs,
      });
      ownedThreadId = toolTurn.active_thread_id;
      ownedArchivePath = toolTurn.native_archive_path || '';
      assert(ownedThreadId && ownedThreadId !== originalThreadId, 'Owned Codex Desktop thread did not persist');
      assert(ownedArchivePath, 'New owned Codex Desktop archive could not be resolved');
      result.owned_thread_id = ownedThreadId;
      result.owned_archive_path = ownedArchivePath;
      result.tool_turn = toolTurn;
    }
    assert(Number(result.tool_turn.block_counts.terminal || 0) > 0, 'Tool turn produced no relay terminal block');
    assert(Number(result.tool_turn.block_counts.file_changes || 0) > 0, 'Tool turn produced no relay file-change block');
    report('tool_turn_pass', { owned_thread_id: ownedThreadId, ...result.tool_turn });

    const soakStartedAt = Date.now();
    const soakDeadline = soakStartedAt + (options.soakMinutes * 60_000);
    const midpointAt = soakStartedAt + (options.soakMinutes * 30_000);
    let midpointCaptured = false;
    let turn = 0;
    while (Date.now() < soakDeadline && (!options.soakTurnLimit || turn < options.soakTurnLimit)) {
      turn += 1;
      const turnStartedAt = Date.now();
      const token = `RAC_CODEX_DESKTOP_SOAK_${runId}_${String(turn).padStart(2, '0')}`;
      const prompt = `Owned active soak turn ${turn}. You must use one shell command to print ${token}, then reply with exactly ${token} and nothing else. Do not edit a file.`;
      const evidence = await sendTurn({
        relay, native, sessionId, ownedThreadId, archivePath: ownedArchivePath, name: `turn-${turn}`, prompt, token, timeoutMs: options.timeoutMs,
      });
      result.turns.push({ turn, token, elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000), ...evidence });
      report('soak_turn_pass', result.turns[result.turns.length - 1]);

      if (!midpointCaptured && Date.now() >= midpointAt) {
        midpointCaptured = true;
        const checkpoint = {
          kind: 'midpoint',
          elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
          native: await captureNative(native, path.join(options.evidenceDir, 'midpoint-native.png'), token, ownedThreadId, ownedArchivePath),
        };
        result.checkpoints.push(checkpoint);
        report('checkpoint', checkpoint);
      }
      const nextTurnAt = Math.min(soakDeadline, turnStartedAt + options.soakIntervalMs);
      while (Date.now() < nextTurnAt) {
        assert.strictEqual(relay.ws.readyState, 1, 'Relay disconnected during soak wait');
        await sleep(Math.min(5_000, nextTurnAt - Date.now()));
      }
    }

    if (!options.allowShortSoak || Date.now() >= soakDeadline) {
      while (Date.now() < soakDeadline) {
        assert.strictEqual(relay.ws.readyState, 1, 'Relay disconnected before terminal soak turn');
        await sleep(Math.min(5_000, soakDeadline - Date.now()));
      }
      turn += 1;
      const token = `RAC_CODEX_DESKTOP_SOAK_${runId}_FINAL`;
      const prompt = `Final owned soak turn after the time gate. You must use one shell command to print ${token}, then reply with exactly ${token} and nothing else. Do not edit a file.`;
      const evidence = await sendTurn({
        relay, native, sessionId, ownedThreadId, archivePath: ownedArchivePath, name: 'final', prompt, token, timeoutMs: options.timeoutMs,
      });
      result.turns.push({ turn, token, elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000), ...evidence });
      report('terminal_soak_turn_pass', result.turns[result.turns.length - 1]);
    }

    const finalToken = result.turns[result.turns.length - 1].token;
    browserEvidence = await openBrowserEvidence(sessionId);
    const finalCheckpoint = {
      kind: 'final',
      elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
      native: await captureNative(native, path.join(options.evidenceDir, 'final-native.png'), finalToken, ownedThreadId, ownedArchivePath),
      web_desktop: await captureWeb(browserEvidence, path.join(options.evidenceDir, 'final-webui-desktop.png'), finalToken),
      web_mobile_390: await captureWeb(browserEvidence, path.join(options.evidenceDir, 'final-webui-mobile-390x844.png'), finalToken, { width: 390, height: 844 }),
    };
    result.checkpoints.push(finalCheckpoint);
    report('checkpoint', finalCheckpoint);

    const finalHistory = await history(relay, sessionId, 'final');
    result.final_history = { messages: finalHistory.length, block_counts: blockCounts(finalHistory) };
    assert(Number(result.final_history.block_counts.terminal || 0) > 0, 'Final relay history lost terminal blocks');
    assert(Number(result.final_history.block_counts.file_changes || 0) > 0, 'Final relay history lost file-change blocks');
    const failures = [
      ...codexFailureLines(readLogTail(proxyLog, logOffsets.proxy), sessionId),
      ...codexFailureLines(readLogTail(proxyErrLog, logOffsets.error), sessionId),
    ];
    result.proxy_log_dir = options.proxyLogDir;
    result.selector_or_read_failures = failures;
    assert.deepStrictEqual(failures, [], `Codex Desktop selector/read failures appeared: ${JSON.stringify(failures)}`);
    result.soak_elapsed_seconds = Math.round((Date.now() - soakStartedAt) / 1000);
    result.active_traffic_span_seconds = result.turns.length > 1
      ? Math.round((result.turns[result.turns.length - 1].accepted_observed_at_ms
        - result.turns[0].accepted_observed_at_ms) / 1000)
      : 0;
    if (!options.allowShortSoak) {
      assert(result.soak_elapsed_seconds >= 600, `Formal soak ended early at ${result.soak_elapsed_seconds}s`);
      assert(result.active_traffic_span_seconds >= 600, `Active traffic span ended early at ${result.active_traffic_span_seconds}s`);
    }
    result.ok = true;
    report('complete', {
      ok: true,
      soak_elapsed_seconds: result.soak_elapsed_seconds,
      active_traffic_span_seconds: result.active_traffic_span_seconds,
      turns: result.turns.length,
    });
    return result;
  } catch (error) {
    result.error = error.stack || error.message;
    report('failed', { error: result.error });
    throw error;
  } finally {
    await closeBrowserEvidence(browserEvidence).catch(() => {});
    if (native && originalThreadId && threadChanged) {
      try {
        result.original_thread_restored = await restoreOriginal(native, relay, sessionId, originalThreadId);
      } catch (error) {
        result.restore_error = error.message;
      }
    }
    result.finished_at = new Date().toISOString();
    if (ownsEvidence) fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    try { relay?.ws?.close(); } catch {}
    try { await native?.client?.close(); } catch {}
    try { releaseOperation?.(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  archiveTokenState,
  blockCounts,
  captureWeb,
  closeBrowserEvidence,
  codexFailureLines,
  main,
  openBrowserEvidence,
  parseArgs,
  resolveOwnedArchive,
  strongUserAnchors,
  webCaptureStateIsReady,
};
