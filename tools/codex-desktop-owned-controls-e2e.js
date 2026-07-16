#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const { listCdpTargets, connectCdpTarget } = require('../agent-proxy/cdp-loopback');
const production = require('./vscode-extension-production-e2e');
const {
  OPERATION_LOCK_PATH,
  acquirePidLock,
} = require('./production-harness-overnight-soak');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.CODEX_DESKTOP_CDP_PORT || 9225);

function parseArgs(argv) {
  const options = {
    sendLive: false,
    diagnoseNewThread: false,
    output: freshEvidencePath(ROOT, 'codex-desktop-owned-controls-result.json'),
    timeoutMs: 180000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--diagnose-new-thread') options.diagnoseNewThread = true;
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.sendLive && !options.diagnoseNewThread) {
    throw new Error('Refusing Codex Desktop mutation without --send-live or --diagnose-new-thread');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30000) throw new Error('--timeout-ms must be at least 30000');
  return options;
}

function isCanonicalTarget(target) {
  return target?.type === 'page' && /^app:\/\/-\/index\.html(?:[?#]|$)/i.test(String(target.url || ''));
}

async function openNative() {
  const targets = (await listCdpTargets(CDP, { port: PORT })).filter(isCanonicalTarget);
  assert.strictEqual(targets.length, 1, `expected one canonical Codex Desktop target, found ${targets.length}`);
  const target = targets[0];
  const client = await connectCdpTarget(CDP, {
    port: PORT,
    host: target._cdpHost,
    target: target.id,
  });
  await client.Runtime.enable();
  return { target, client };
}

async function nativeState(native, sessionId) {
  const threads = await selectors.readCodexThreadList(native.client.Runtime, true);
  const rawMessages = await selectors.readMessages(native.client.Runtime, 'codex-desktop', sessionId);
  const thinking = await selectors.detectThinking(native.client.Runtime, 'codex-desktop');
  const active = threads.find(thread => thread.active);
  return {
    threads,
    active,
    messages: JSON.parse(rawMessages || '[]'),
    thinking,
  };
}

async function nativeDraftState(native) {
  return selectors.evalInPage(native.client.Runtime, `
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    }
    var input = Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]')).find(visible);
    var hasTurns = !!document.querySelector('[data-content-search-turn-key], [data-turn-key], [data-testid="user-message"], [data-testid="assistant-message"]');
    var body = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 1200);
    var composerText = input ? (input.innerText || input.textContent || '').trim() : '';
    return {
      composer_visible: !!input,
      composer_text_length: composerText.length,
      blank_composer: !!input && !composerText,
      has_turns: hasTurns,
      draft_marker: /let.?s build|message codex|what can i help|start typing/i.test(body),
    };
  `);
}

async function nativeSurfaceState(native) {
  return selectors.evalInPage(native.client.Runtime, `
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    function has(pattern, value) { return pattern.test(String(value || '').toLowerCase()); }
    var body = d.body && d.body.innerText ? d.body.innerText : '';
    var buttons = Array.from(d.querySelectorAll('button, [role="button"], [role="menuitem"]')).filter(visible);
    var labels = buttons.map(function(button) {
      return String(button.innerText || button.textContent || button.getAttribute('aria-label') || '')
        .replace(/\\s+/g, ' ').trim().toLowerCase();
    });
    function labelMatches(pattern) { return labels.some(function(label) { return pattern.test(label); }); }
    var active = d.activeElement;
    return {
      route: String(location.pathname || '') + String(location.search || '') + String(location.hash || ''),
      visible_composer_count: Array.from(d.querySelectorAll('.ProseMirror[data-codex-composer="true"], .ProseMirror')).filter(visible).length,
      visible_contenteditable_count: Array.from(d.querySelectorAll('[contenteditable="true"]')).filter(visible).length,
      visible_dialog_count: Array.from(d.querySelectorAll('[role="dialog"]')).filter(visible).length,
      visible_main_count: Array.from(d.querySelectorAll('main, [role="main"]')).filter(visible).length,
      active_element: active ? {
        tag: active.tagName || '',
        aria_label: String(active.getAttribute && active.getAttribute('aria-label') || '').slice(0, 80),
        role: String(active.getAttribute && active.getAttribute('role') || '').slice(0, 40)
      } : null,
      markers: {
        new_task: labelMatches(/^new task(?:\\s|$)/),
        chat: labelMatches(/^chat(?:\\s|$)/),
        open_folder: labelMatches(/open (?:a )?folder|open project/),
        choose_folder: labelMatches(/choose (?:a )?folder|select (?:a )?folder/),
        choose_project: labelMatches(/choose (?:a )?project|select (?:a )?project/),
        create_task: labelMatches(/create (?:a )?(?:task|thread)/),
        start_task: labelMatches(/start (?:a )?(?:task|thread)/),
        recent: labelMatches(/^recent(?:\\s|$)/) || has(/recent projects|recent folders/, body),
        workspace_required: has(/choose.*(?:workspace|project|folder)|select.*(?:workspace|project|folder)|open.*(?:workspace|project|folder)/, body),
        message_codex: has(/message codex|what can i help|let.?s build|start typing/, body)
      }
    };
  `);
}

function isOwnedDisposableComposer(state, draft) {
  if (state?.active?.id || (state?.messages?.length || 0) !== 0 || draft?.has_turns) return false;
  if (draft?.blank_composer) return true;
  return draft?.composer_visible === true;
}

async function requestConfig(relay, sessionId) {
  const requestId = `codex-desktop-owned-config-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return production.waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config' && message.request_id === requestId),
    30000,
    'Codex Desktop config',
  );
}

async function send(relay, sessionId, prompt, clientMessageId) {
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'send',
    session: sessionId,
    content: prompt,
    client_message_id: clientMessageId,
  }));
  const receipt = await production.waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'proxy_send_result' && message.client_message_id === clientMessageId),
    60000,
    'Codex Desktop delivery receipt',
    50,
  );
  assert.strictEqual(receipt.result, 'delivered', JSON.stringify(receipt));
  return receipt;
}

async function restoreOriginal(native, relay, sessionId, originalThreadId) {
  let state;
  if (relay?.ws?.readyState === 1) {
    try {
      await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
        thread_id: originalThreadId,
      });
      state = await production.waitFor(async () => {
        const current = await nativeState(native, sessionId);
        return current.active?.id === originalThreadId ? current : null;
      }, 30000, 'restore original Codex Desktop thread', 100);
      return state.active.id === originalThreadId;
    } catch {}
  }
  const direct = await selectors.switchCodexThread(native.client.Runtime, originalThreadId, true);
  return !!direct?.ok;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = Date.now().toString(36);
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    run_id: runId,
    cdp_port: PORT,
    focus_actions: 0,
    visible_windows_opened: 0,
    app_restarted: false,
    stages: [],
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });

  let releaseOperation = null;
  let native = null;
  let relay = null;
  let sessionId = '';
  let originalThreadId = '';
  let newThreadRequested = false;
  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-desktop-owned-controls', kind: 'owned-mutation', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = OPERATION_LOCK_PATH;
    result.stages.push('operation_lock');

    native = await openNative();
    relay = await production.openRelay();
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.agent_type === 'codex-desktop' && item.status !== 'disconnected'),
      30000,
      'connected Codex Desktop relay session',
    );
    sessionId = session.session_id;
    result.session_id = sessionId;

    const baseline = await nativeState(native, sessionId);
    assert(baseline.active?.id, 'Codex Desktop has no exact active thread');
    assert.strictEqual(baseline.thinking?.thinking, false, 'Codex Desktop is active; refusing owned mutation');
    originalThreadId = baseline.active.id;
    result.original_thread = { id: originalThreadId, title: baseline.active.title || '' };
    result.baseline_thread_count = baseline.threads.length;
    result.stages.push('idle_guard');

    const config = await requestConfig(relay, sessionId);
    for (const capability of ['new_thread', 'thread_list', 'switch_thread', 'interrupt']) {
      assert.strictEqual(config.capabilities?.[capability], true, `Codex Desktop did not advertise ${capability}`);
    }
    result.capabilities = Object.fromEntries(
      ['new_thread', 'thread_list', 'switch_thread', 'interrupt'].map(key => [key, true]),
    );
    result.stages.push('capabilities');

    await production.control(relay.ws, relay.messages, sessionId, 'new_thread');
    newThreadRequested = true;
    result.stages.push('new_thread_control');
    const disposable = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      const draft = await nativeDraftState(native);
      result.new_thread_observation = {
        active_id: state.active?.id || null,
        messages: state.messages.length,
        ...draft,
        surface: await nativeSurfaceState(native),
      };
      return isOwnedDisposableComposer(state, draft)
        ? { ...state, draft }
        : null;
    }, 30000, 'empty disposable Codex Desktop thread', 100);
    result.disposable_thread = { id: null, title: '', unpersisted_draft: true };
    result.stages.push('new_thread');

    if (options.diagnoseNewThread) {
      await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
        thread_id: originalThreadId,
      });
      await production.waitFor(async () => {
        const state = await nativeState(native, sessionId);
        return state.active?.id === originalThreadId ? state : null;
      }, 30000, 'original Codex Desktop thread after diagnostic', 100);
      result.stages.push('diagnostic_restore');
      result.original_thread_restored = true;
      result.ok = true;
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    const completionToken = `RAC_CODEX_DESKTOP_OWNED_${runId.toUpperCase()}`;
    const completionPrompt = `Reply with exactly ${completionToken} and nothing else.`;
    const completionStarted = Date.now();
    await send(relay, sessionId, completionPrompt, `codex-desktop-owned-send-${runId}`);
    const completed = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      const hasUser = state.messages.some(message => message.role === 'user' && String(message.content || '').includes(completionToken));
      const hasAssistant = state.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(completionToken));
      return hasUser && hasAssistant && !state.thinking?.thinking && state.active?.id !== originalThreadId ? state : null;
    }, options.timeoutMs, 'owned Codex Desktop answer', 250);
    result.disposable_thread = {
      id: completed.active.id,
      title: completed.active.title || '',
      unpersisted_draft: false,
    };
    result.send = {
      token: completionToken,
      elapsed_ms: Date.now() - completionStarted,
      messages: completed.messages.length,
    };
    result.stages.push('send');

    const interruptMarker = `RAC_CODEX_DESKTOP_INTERRUPT_${runId.toUpperCase()}`;
    const interruptPrompt = `Write a numbered list of 1000 distinct software testing facts. Put ${interruptMarker} only in item 1000. Do not use tools.`;
    await send(relay, sessionId, interruptPrompt, `codex-desktop-owned-interrupt-${runId}`);
    await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      return state.thinking?.thinking ? state : null;
    }, 60000, 'Codex Desktop generating before interrupt', 100);
    const interruptStarted = Date.now();
    await production.control(relay.ws, relay.messages, sessionId, 'agent_interrupt');
    const interrupted = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      return !state.thinking?.thinking ? state : null;
    }, 60000, 'Codex Desktop idle after interrupt', 100);
    assert(!interrupted.messages.some(message =>
      message.role === 'assistant' && String(message.content || '').includes(interruptMarker)),
    'interrupt marker completed instead of stopping');
    result.interrupt = { marker: interruptMarker, elapsed_ms: Date.now() - interruptStarted };
    result.stages.push('interrupt');

    await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
      thread_id: originalThreadId,
    });
    const restored = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      return state.active?.id === originalThreadId ? state : null;
    }, 30000, 'original Codex Desktop thread', 100);
    result.restored_thread = { id: restored.active.id, title: restored.active.title || '' };
    result.stages.push('switch_thread');
    result.original_thread_restored = true;
    result.ok = true;
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (native && newThreadRequested) {
      try {
        const state = await nativeState(native, sessionId);
        const prompt = await selectors.detectSessionErrorPrompt(native.client.Runtime, 'codex-desktop');
        result.failure_native_state = {
          active_thread: state.active ? { id: state.active.id, title: state.active.title || '' } : null,
          messages: state.messages.map(message => ({
            role: message.role,
            content: String(message.content || '').slice(0, 500),
          })),
          thinking: state.thinking,
          error_prompt: prompt || null,
          surface: await nativeSurfaceState(native),
        };
        if (state.active?.id && state.active.id !== originalThreadId) {
          result.disposable_thread = {
            id: state.active.id,
            title: state.active.title || '',
            unpersisted_draft: false,
          };
        }
      } catch {}
    }
    result.error = error.stack || error.message;
    throw error;
  } finally {
    if (native && originalThreadId && newThreadRequested) {
      try { result.original_thread_restored = await restoreOriginal(native, relay, sessionId, originalThreadId); } catch {}
    }
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
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
  isCanonicalTarget,
  isOwnedDisposableComposer,
  main,
  nativeDraftState,
  nativeState,
  nativeSurfaceState,
  openNative,
  parseArgs,
  requestConfig,
  restoreOriginal,
  send,
};
