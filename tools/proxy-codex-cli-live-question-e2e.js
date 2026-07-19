#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');
const production = require('./vscode-extension-production-e2e');
const soak = require('./production-harness-overnight-soak');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const { semanticChoice } = require('../shared/question-choice-label');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const workspacePath = 'C:\\temp\\remote-agent-codex-cli-question-production';

function parseArgs(argv) {
  const options = {
    sendLive: false,
    requireCapability: false,
    answerViaCdp: false,
    browserCdp: process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240',
    pendingScreenshot: '',
    response: 'relay',
    output: freshEvidencePath(ROOT, 'codex-cli-live-question-e2e.json'),
    timeoutMs: 180000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--require-capability') options.requireCapability = true;
    else if (arg === '--answer-via-cdp') options.answerViaCdp = true;
    else if (arg === '--browser-cdp' && argv[index + 1]) options.browserCdp = String(argv[++index]);
    else if (arg === '--pending-screenshot' && argv[index + 1]) options.pendingScreenshot = path.resolve(argv[++index]);
    else if (arg === '--response' && argv[index + 1]) options.response = String(argv[++index]).toLowerCase();
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert.strictEqual(options.sendLive, true, 'explicit --send-live is required');
  assert(['relay', 'native'].includes(options.response),
    '--response must be relay or native');
  assert(Number.isFinite(options.timeoutMs) && options.timeoutMs >= 30000, '--timeout-ms must be at least 30000');
  if (options.answerViaCdp) {
    assert.strictEqual(options.response, 'relay', '--answer-via-cdp currently requires --response relay');
    assert(options.pendingScreenshot, '--answer-via-cdp requires --pending-screenshot');
    const evidenceRoot = path.join(ROOT, 'evidence');
    const relative = path.relative(evidenceRoot, options.pendingScreenshot);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      '--pending-screenshot must stay under the evidence tree');
    assert.strictEqual(path.extname(options.pendingScreenshot).toLowerCase(), '.png',
      '--pending-screenshot must use a .png path');
    const endpoint = new URL(options.browserCdp);
    assert(['127.0.0.1', 'localhost'].includes(endpoint.hostname), '--browser-cdp must be loopback');
    assert.strictEqual(Number(endpoint.port || 80), 9240, '--answer-via-cdp is restricted to the dedicated CDP-9240 browser');
  }
  return options;
}

function waitForFrame(messages, start, predicate, timeoutMs, label) {
  return production.waitFor(
    () => messages.slice(start).find(predicate),
    timeoutMs,
    label,
    25,
  );
}

async function requestConfig(relay, sessionId) {
  const requestId = `codex-cli-question-config-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitForFrame(
    relay.messages,
    start,
    message => message.type === 'agent_config' && message.request_id === requestId,
    30000,
    'Codex CLI production config',
  );
}

function responseFrame(prompt, requestId, label) {
  const question = prompt.questions.find(item => Array.isArray(item.choices) && item.choices.length > 0);
  assert(question, 'production CLI prompt has no choice question');
  const choice = semanticChoice(question, label);
  assert(choice, 'production CLI prompt has no ' + label + ' choice');
  return {
    type: 'question_response',
    protocol_version: 1,
    request_id: requestId,
    session_id: prompt.session_id,
    prompt_id: prompt.prompt_id,
    generation: prompt.generation,
    action: 'answer',
    answers: [{ question_id: question.question_id, choice_ids: [choice.choice_id] }],
  };
}

function compactSessionStateTimeline(messages, sessionId, startIndex = 0) {
  const timeline = [];
  for (let index = Math.max(0, Number(startIndex) || 0); index < messages.length; index += 1) {
    const message = messages[index];
    let state = null;
    if (Array.isArray(message?.sessions)) {
      state = message.sessions.find(session => session?.session_id === sessionId) || null;
    } else if ((message?.session_id || message?.session) === sessionId) {
      state = message.patch?.activity
        ? { status: message.patch.status, activity: message.patch.activity }
        : message;
    }
    if (!state?.activity || typeof state.activity !== 'object') continue;
    timeline.push({
      message_index: index,
      type: message.type || 'sessions',
      state_seq: message.state_seq ?? null,
      state_epoch: message.state_epoch ?? null,
      status: state.status || message.status || null,
      activity: {
        kind: state.activity.kind || null,
        label: state.activity.label || '',
        updated_at: state.activity.updated_at || null,
        started_at: state.activity.started_at || null,
      },
    });
  }
  return timeline.slice(-60);
}

function relaySessionActivity(message, sessionId) {
  if ((message?.session_id || message?.session) !== sessionId) return null;
  const activity = message.patch?.activity || message.activity;
  return activity && typeof activity === 'object' ? activity : null;
}

function idHash(value) {
  return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16) : null;
}

function producerRequestSummary(prompt, delivery) {
  return {
    kind: prompt.kind,
    source: prompt.source,
    title: prompt.title,
    questions: prompt.questions.map(question => ({
      header: question.header,
      message: question.message,
      answer_mode: question.answer_mode,
      required: question.required,
      multi_select: question.multi_select,
      allow_other: question.allow_other,
      secret: question.secret,
      choices: (question.choices || []).map(choice => ({
        label: choice.label,
        description: choice.description,
        requires_text: choice.requires_text,
        is_other: choice.is_other,
      })),
    })),
    private_identity_hashes: {
      prompt_id: idHash(prompt.prompt_id),
      generation: idHash(prompt.generation),
      native_thread_id: idHash(delivery?.native_receipt?.thread_id),
      native_turn_id: idHash(delivery?.native_receipt?.turn_id),
    },
  };
}

function redactedRelayFrame(message) {
  return {
    type: message?.type || null,
    command: message?.command || null,
    result: message?.result || null,
    lifecycle: message?.lifecycle || null,
    native_acknowledged: message?.native_acknowledged === true,
    server_ts: message?.server_ts || null,
    private_identity_hashes: {
      request_id: idHash(message?.request_id),
      session_id: idHash(message?.session_id || message?.session),
      prompt_id: idHash(message?.prompt_id),
    },
    native_receipt: message?.native_receipt ? {
      method: message.native_receipt.method || null,
      same_thread: message.native_receipt.same_thread === true
        || !!message.native_receipt.thread_id,
      same_turn: message.native_receipt.same_turn === true
        || !!message.native_receipt.turn_id,
    } : null,
  };
}

async function pageState(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.session-card.active[data-session-id]');
    const route = document.querySelector('[data-testid="fleet-view"]') ? 'fleet'
      : document.querySelector('[data-testid="usage-dashboard"]') ? 'usage'
        : document.querySelector('[data-testid="host-resource-dashboard"]') ? 'host-resources'
          : document.querySelector('.transcript-search-view') ? 'transcript-search'
            : 'chat';
    return {
      href: location.href,
      title: document.title,
      route,
      active_session_id: active?.getAttribute('data-session-id') || null,
      session_cards: document.querySelectorAll('.session-card[data-session-id]').length,
      prompt_cards: document.querySelectorAll('.permission-card[role="dialog"]').length,
      sidebar_open: !!document.querySelector('.sidebar.open'),
      visibility_state: document.visibilityState,
      document_has_focus: document.hasFocus(),
    };
  });
}

function browserQuestionFrameProbeInit() {
  const NativeWebSocket = window.WebSocket;
  const probe = {
    NativeWebSocket,
    connections: 0,
    inbound: [],
    outbound: [],
    sockets: [],
  };
  const record = (direction, value) => {
    if (typeof value !== 'string') return;
    let message;
    try { message = JSON.parse(value); } catch { return; }
    if (direction === 'outbound' && message?.type === 'question_response') {
      probe.outbound.push({
        type: message.type,
        request_id: message.request_id || null,
        session_id: message.session_id || message.session || null,
        prompt_id: message.prompt_id || null,
        generation: message.generation || null,
        action: message.action || null,
        answers: Array.isArray(message.answers) ? message.answers.map(answer => ({
          question_id: answer?.question_id || null,
          choice_ids: Array.isArray(answer?.choice_ids) ? [...answer.choice_ids] : [],
          has_text: typeof answer?.text === 'string' && answer.text.length > 0,
          has_other_text: typeof answer?.other_text === 'string' && answer.other_text.length > 0,
        })) : [],
        observed_at: new Date().toISOString(),
      });
      return;
    }
    if (direction !== 'inbound') return;
    if (message?.type === 'agent_control_result' && message.command === 'question_response') {
      probe.inbound.push({
        type: message.type,
        request_id: message.request_id || null,
        session_id: message.session_id || message.session || null,
        command: message.command,
        result: message.result || null,
        lifecycle: message.lifecycle || null,
        native_acknowledged: message.native_acknowledged === true,
        native_attempted: message.native_attempted,
        error: message.error ? {
          code: message.error.code || null,
          message: message.error.message || null,
        } : null,
        native_receipt: message.native_receipt ? {
          method: message.native_receipt.method || null,
          thread_id: message.native_receipt.thread_id || null,
          turn_id: message.native_receipt.turn_id || null,
          item_id: message.native_receipt.item_id || null,
        } : null,
        server_ts: message.server_ts || null,
        observed_at: new Date().toISOString(),
      });
    } else if (['question_prompt', 'question_prompt_state'].includes(message?.type)) {
      probe.inbound.push({
        type: message.type,
        session_id: message.session_id || message.session || null,
        prompt_id: message.prompt_id || null,
        generation: message.generation || null,
        lifecycle: message.lifecycle || null,
        server_ts: message.server_ts || null,
        observed_at: new Date().toISOString(),
      });
    }
  };
  class QuestionProbeWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      probe.connections += 1;
      const onMessage = event => record('inbound', event.data);
      this.addEventListener('message', onMessage);
      const nativeSend = this.send;
      Object.defineProperty(this, 'send', {
        configurable: true,
        value(data) {
          record('outbound', data);
          return nativeSend.call(this, data);
        },
      });
      probe.sockets.push({ socket: this, onMessage });
    }
  }
  Object.setPrototypeOf(QuestionProbeWebSocket, NativeWebSocket);
  window.WebSocket = QuestionProbeWebSocket;
  window.__RAC_PRODUCTION_QUESTION_WS_PROBE__ = probe;
}

async function browserQuestionFrameProbeBaseline(page) {
  return page.evaluate(() => {
    const probe = window.__RAC_PRODUCTION_QUESTION_WS_PROBE__;
    return {
      installed: !!probe,
      connections: probe?.connections || 0,
      inbound: probe?.inbound?.length || 0,
      outbound: probe?.outbound?.length || 0,
    };
  });
}

async function waitForBrowserQuestionReceipt(page, sessionId, prompt, baseline, timeoutMs) {
  const handle = await page.waitForFunction(({ expectedSessionId, promptId, generation, inboundStart, outboundStart }) => {
    const probe = window.__RAC_PRODUCTION_QUESTION_WS_PROBE__;
    if (!probe) return null;
    const outbound = probe.outbound.slice(outboundStart).find(message => (
      message.session_id === expectedSessionId
      && message.prompt_id === promptId
      && message.generation === generation
    ));
    if (!outbound?.request_id) return null;
    const receipt = probe.inbound.slice(inboundStart).find(message => (
      message.type === 'agent_control_result'
      && message.command === 'question_response'
      && message.session_id === expectedSessionId
      && message.request_id === outbound.request_id
    ));
    return receipt ? { outbound, receipt } : null;
  }, {
    expectedSessionId: sessionId,
    promptId: prompt.prompt_id,
    generation: prompt.generation,
    inboundStart: baseline.inbound,
    outboundStart: baseline.outbound,
  }, { timeout: timeoutMs });
  try {
    return await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
}

async function removeBrowserQuestionFrameProbe(page) {
  return page.evaluate(() => {
    const probe = window.__RAC_PRODUCTION_QUESTION_WS_PROBE__;
    if (!probe) return { removed: false, restored_constructor: true };
    for (const entry of probe.sockets) {
      try { entry.socket.removeEventListener('message', entry.onMessage); } catch {}
      try { delete entry.socket.send; } catch {}
    }
    window.WebSocket = probe.NativeWebSocket;
    const result = {
      removed: true,
      restored_constructor: window.WebSocket === probe.NativeWebSocket,
      connections: probe.connections,
      inbound_frames: probe.inbound.length,
      outbound_frames: probe.outbound.length,
    };
    delete window.__RAC_PRODUCTION_QUESTION_WS_PROBE__;
    return result;
  });
}

async function promptDom(page, sessionId) {
  return page.evaluate((expectedSessionId) => {
    const active = document.querySelector('.session-card.active[data-session-id]');
    const card = document.querySelector('.permission-card[role="dialog"]');
    const sessionCard = document.querySelector(`.session-card[data-session-id="${CSS.escape(expectedSessionId)}"]`);
    if (!card) return null;
    return {
      active_session_matches: active?.getAttribute('data-session-id') === expectedSessionId,
      eyebrow: card.querySelector('.permission-eyebrow')?.textContent?.trim() || '',
      title: card.querySelector('.permission-title')?.textContent?.trim() || '',
      question: card.querySelector('.permission-question-message')?.textContent?.trim() || '',
      options: [...card.querySelectorAll('.permission-action[role="radio"], .permission-action[role="checkbox"]')].map(option => ({
        label: option.querySelector('.permission-choice-copy > span:first-child')?.textContent?.trim() || '',
        description: option.querySelector('.permission-action-desc')?.textContent?.trim() || '',
        role: option.getAttribute('role'),
        checked: option.getAttribute('aria-checked'),
        disabled: option.disabled,
      })),
      submit: {
        text: card.querySelector('.permission-question-submit')?.textContent?.trim() || '',
        disabled: card.querySelector('.permission-question-submit')?.disabled ?? null,
      },
      cancel: {
        present: !!card.querySelector('.permission-question-cancel'),
        disabled: card.querySelector('.permission-question-cancel')?.disabled ?? null,
      },
      sidebar_attention: {
        badge_present: !!sessionCard?.querySelector('.session-card-perm-badge'),
        label: sessionCard?.querySelector('.session-card-sub')?.textContent?.trim() || '',
      },
    };
  }, sessionId);
}

async function installPendingProbe(page, sessionId) {
  await page.evaluate((expectedSessionId) => {
    window.__RAC_QUESTION_PENDING_PROBE__?.observer?.disconnect?.();
    const records = [];
    const snapshot = (reason) => {
      const active = document.querySelector('.session-card.active[data-session-id]');
      const card = document.querySelector('.permission-card[role="dialog"]');
      const submit = card?.querySelector('.permission-question-submit');
      const cancel = card?.querySelector('.permission-question-cancel');
      const record = {
        reason,
        wall_time: new Date().toISOString(),
        monotonic_ms: performance.now(),
        active_session_matches: active?.getAttribute('data-session-id') === expectedSessionId,
        card_present: !!card,
        submit_text: submit?.textContent?.trim() || '',
        submit_disabled: submit?.disabled ?? null,
        cancel_present: !!cancel,
        cancel_disabled: cancel?.disabled ?? null,
      };
      const previous = records[records.length - 1];
      if (!previous || JSON.stringify({ ...previous, reason: '' }) !== JSON.stringify({ ...record, reason: '' })) {
        records.push(record);
      }
    };
    const observer = new MutationObserver(() => snapshot('mutation'));
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.__RAC_QUESTION_PENDING_PROBE__ = { records, observer };
    snapshot('installed');
  }, sessionId);
}

async function readPendingProbe(page) {
  return page.evaluate(() => {
    const probe = window.__RAC_QUESTION_PENDING_PROBE__;
    probe?.observer?.disconnect?.();
    return Array.isArray(probe?.records) ? probe.records : [];
  });
}

async function prepareProductionPage(options, result) {
  const browser = await chromium.connectOverCDP(options.browserCdp);
  const contexts = browser.contexts();
  const pages = contexts.flatMap(context => context.pages());
  assert.strictEqual(pages.length, 1, `expected exactly one CDP-9240 page, found ${pages.length}`);
  const page = pages[0];
  result.browser = {
    cdp: options.browserCdp,
    pages_before: pages.length,
    new_pages_opened: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
    page_reloads: 1,
    original: await pageState(page),
  };
  await page.addInitScript(browserQuestionFrameProbeInit);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.session-card[data-session-id]').first().waitFor({ state: 'attached', timeout: 30000 });
  result.browser.after_reload = await pageState(page);
  result.browser.websocket_probe = await browserQuestionFrameProbeBaseline(page);
  assert.strictEqual(result.browser.websocket_probe.installed, true, 'browser question frame probe was not installed');
  assert(result.browser.websocket_probe.connections >= 1, 'browser question frame probe observed no relay connection');
  result.browser.restore_session_id = result.browser.after_reload.active_session_id;
  result.browser.restore_sidebar_open = result.browser.original.sidebar_open;
  return { browser, page };
}

async function ensureSessionCardClickable(page, card) {
  let bounds = await card.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  let sidebar_opened = false;
  const outsideViewport = () => !bounds
    || bounds.x + bounds.width <= 0
    || bounds.y + bounds.height <= 0
    || bounds.x >= viewport.width
    || bounds.y >= viewport.height;
  if (outsideViewport()) {
    const hamburger = page.locator('button.hamburger');
    assert.strictEqual(await hamburger.count(), 1, 'offscreen session card has no mobile sidebar control');
    await hamburger.click({ timeout: 10000 });
    await page.waitForFunction(() => {
      const sidebar = document.querySelector('.sidebar.open');
      if (!sidebar) return false;
      const sidebarBounds = sidebar.getBoundingClientRect();
      return sidebarBounds.x >= -1 && sidebarBounds.right > 0;
    }, null, { timeout: 10000 });
    sidebar_opened = true;
  }
  await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  bounds = await card.boundingBox();
  assert(bounds && bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0
    && bounds.x < viewport.width && bounds.y < viewport.height,
  `session card stayed outside the viewport: ${JSON.stringify({ bounds, viewport })}`);
  return { sidebar_opened, bounds, viewport };
}

async function activeSessionId(page) {
  return page.evaluate(() => (
    document.querySelector('.session-card.active[data-session-id]')?.getAttribute('data-session-id') || null
  ));
}

async function installSessionSelectionProbe(page, sessionId, initialSessionId) {
  await page.evaluate(({ expectedSessionId, originalSessionId }) => {
    const events = [];
    const eventTypes = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup'];
    const listener = event => {
      const targetCard = event.target?.closest?.('.session-card[data-session-id]');
      const targetSessionId = targetCard?.getAttribute('data-session-id') || null;
      events.push({
        type: event.type,
        is_trusted: event.isTrusted === true,
        target_is_card: !!targetCard,
        target_matches_expected: targetSessionId === expectedSessionId,
        target_matches_original: targetSessionId === originalSessionId,
        key: typeof event.key === 'string' ? event.key : '',
      });
    };
    eventTypes.forEach(type => document.addEventListener(type, listener, true));
    window.__RAC_SESSION_SELECTION_PROBE__ = { events, eventTypes, listener };
  }, { expectedSessionId: sessionId, originalSessionId: initialSessionId });
}

async function readSessionSelectionProbe(page) {
  return page.evaluate(() => {
    const probe = window.__RAC_SESSION_SELECTION_PROBE__;
    if (!probe) return [];
    probe.eventTypes.forEach(type => document.removeEventListener(type, probe.listener, true));
    delete window.__RAC_SESSION_SELECTION_PROBE__;
    return probe.events;
  });
}

async function waitForActiveSession(page, sessionId, timeoutMs) {
  try {
    await page.waitForFunction(expectedSessionId => (
      document.querySelector('.session-card.active[data-session-id]')?.getAttribute('data-session-id') === expectedSessionId
    ), sessionId, { timeout: timeoutMs });
    return true;
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
    return false;
  }
}

async function selectDisposableQuestion(page, sessionId, prompt, screenshotPath) {
  const card = page.locator(`.session-card[data-session-id="${sessionId}"]`);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  const navigation = await ensureSessionCardClickable(page, card);
  const initialSessionId = await activeSessionId(page);
  await installSessionSelectionProbe(page, sessionId, initialSessionId);
  await card.click({ timeout: 10000 });
  let selectionPath = 'trusted_pointer';
  let activated = await waitForActiveSession(page, sessionId, 1500);
  const afterPointerSessionId = await activeSessionId(page);
  if (!activated && afterPointerSessionId === initialSessionId) {
    selectionPath = 'trusted_keyboard_fallback';
    await card.press('Enter', { timeout: 10000 });
    activated = await waitForActiveSession(page, sessionId, 10000);
  }
  const finalSessionId = await activeSessionId(page);
  const selectionEvents = await readSessionSelectionProbe(page);
  const classify = value => value === sessionId ? 'expected'
    : value === initialSessionId ? 'original'
      : value ? 'other' : 'none';
  const selectionReceipt = {
    path: selectionPath,
    after_pointer: classify(afterPointerSessionId),
    final: classify(finalSessionId),
    events: selectionEvents,
  };
  assert(activated && finalSessionId === sessionId,
    `trusted session selection failed: ${JSON.stringify(selectionReceipt)}`);
  assert(selectionEvents.length > 0 && selectionEvents.every(event => event.is_trusted),
    `session selection included untrusted input: ${JSON.stringify(selectionReceipt)}`);
  navigation.selection = selectionReceipt;
  const dialog = page.locator('.permission-card[role="dialog"]').filter({ hasText: prompt.title });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  const dom = await promptDom(page, sessionId);
  assert.equal(dom?.active_session_matches, true);
  assert.equal(dom?.eyebrow, 'Question');
  assert.equal(dom?.title, prompt.title);
  assert.equal(dom?.question, prompt.questions[0].message);
  assert(dom.sidebar_attention.badge_present && /Question required/i.test(dom.sidebar_attention.label));
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await dialog.screenshot({ path: screenshotPath });
  return { ...dom, navigation };
}

async function submitDisposableQuestion(page, sessionId, expectedLabel) {
  await installPendingProbe(page, sessionId);
  const websocketBaseline = await browserQuestionFrameProbeBaseline(page);
  const option = page.locator('.permission-card .permission-action[role="radio"]')
    .filter({ hasText: expectedLabel });
  assert.strictEqual(await option.count(), 1, `expected one ${expectedLabel} question option`);
  const selectionStartedAt = Date.now();
  await option.click({ timeout: 10000 });
  const selectionClickCompletedAt = Date.now();
  await production.waitFor(
    async () => (await option.getAttribute('aria-checked')) === 'true',
    5000,
    `${expectedLabel} Web selection`,
    20,
  );
  const selectionConfirmedAt = Date.now();
  const selected = await promptDom(page, sessionId);
  const submit = page.locator('.permission-card .permission-question-submit');
  assert.strictEqual(await submit.count(), 1, 'expected one Web question submit control');
  assert.strictEqual(await submit.isEnabled(), true, 'Web question submit is not enabled after selection');
  const submitStartedAt = Date.now();
  await submit.click({ timeout: 10000, noWaitAfter: true });
  const submitCompletedAt = Date.now();
  return {
    selected,
    submitStartedAt,
    interaction_timing: {
      selection_click_ms: selectionClickCompletedAt - selectionStartedAt,
      selection_confirm_ms: selectionConfirmedAt - selectionStartedAt,
      submit_click_ms: submitCompletedAt - submitStartedAt,
    },
    websocket_baseline: websocketBaseline,
  };
}

async function restoreSidebarState(page, expectedOpen) {
  const before = await page.evaluate(() => !!document.querySelector('.sidebar.open'));
  if (before !== expectedOpen) {
    if (expectedOpen) {
      const hamburger = page.locator('button.hamburger');
      assert.strictEqual(await hamburger.count(), 1, 'cannot open mobile sidebar');
      await hamburger.click({ timeout: 10000 });
    } else {
      const overlay = page.locator('.overlay.open');
      assert.strictEqual(await overlay.count(), 1, 'cannot close mobile sidebar');
      const overlayBounds = await overlay.boundingBox();
      assert(overlayBounds && overlayBounds.width > 20 && overlayBounds.height > 20,
        'mobile sidebar backdrop has no trusted click target');
      await overlay.click({
        position: { x: overlayBounds.width - 10, y: overlayBounds.height / 2 },
        timeout: 10000,
      });
    }
    await page.waitForFunction(shouldBeOpen => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return false;
      const bounds = sidebar.getBoundingClientRect();
      return shouldBeOpen
        ? sidebar.classList.contains('open') && bounds.x >= -1 && bounds.right > 0
        : !sidebar.classList.contains('open') && bounds.right <= 1;
    }, expectedOpen, { timeout: 10000 });
  }
  const after = await page.evaluate(() => !!document.querySelector('.sidebar.open'));
  return { before, after, changed: before !== after };
}

async function restoreProductionPage(page, originalSessionId, originalSidebarOpen = false) {
  let navigation = { required: false };
  if (originalSessionId && await activeSessionId(page) !== originalSessionId) {
    const card = page.locator(`.session-card[data-session-id="${originalSessionId}"]`);
    if (await card.count() !== 1 || !await card.isVisible()) {
      return { attempted: true, restored: false, reason: 'original_session_card_unavailable' };
    }
    navigation = { required: true, ...await ensureSessionCardClickable(page, card) };
    await card.click({ timeout: 10000 });
    let activated = await waitForActiveSession(page, originalSessionId, 1500);
    if (!activated) {
      await card.press('Enter', { timeout: 10000 });
      activated = await waitForActiveSession(page, originalSessionId, 10000);
      navigation.selection_path = 'trusted_keyboard_fallback';
    } else {
      navigation.selection_path = 'trusted_pointer';
    }
    assert.strictEqual(activated, true, 'original session could not be restored');
  }
  const sidebar = await restoreSidebarState(page, originalSidebarOpen);
  const restored = (!originalSessionId || await activeSessionId(page) === originalSessionId)
    && sidebar.after === originalSidebarOpen;
  return { attempted: true, restored, navigation, sidebar };
}

async function archiveThread(threadId) {
  if (!threadId) return false;
  const connection = new CodexAppServerConnection({
    sessionId: `codex-cli-question-cleanup-${crypto.randomUUID()}`,
    cwd: workspacePath,
    clientName: 'remote-agent-chat-production-question-cleanup',
    clientVersion: '1.0.0',
    requestTimeoutMs: 30000,
  });
  try {
    await connection.start();
    await connection.request('thread/archive', { threadId }, 10000);
    return true;
  } finally {
    await connection.stop();
  }
}

async function closeOwnedSession(relay, sessionId) {
  if (!relay || relay.ws.readyState !== WebSocket.OPEN || !sessionId) return false;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'close_session',
    protocol_version: 1,
    request_id: `codex-cli-question-close-${crypto.randomBytes(5).toString('hex')}`,
    session_id: sessionId,
  }));
  const closed = await waitForFrame(
    relay.messages,
    start,
    message => message.type === 'session_closed'
      && (message.session_id === sessionId || message.session === sessionId),
    30000,
    'owned Codex CLI session close',
  );
  return !!closed;
}

async function requestHistory(relay, sessionId, timeoutMs) {
  const requestId = `codex-cli-question-history-${crypto.randomBytes(5).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'get_history', session: sessionId, request_id: requestId, limit: 200 }));
  return waitForFrame(
    relay.messages,
    start,
    message => ['history', 'history_snapshot'].includes(message.type)
      && (message.session_id === sessionId || message.session === sessionId)
      && (!message.request_id || message.request_id === requestId),
    timeoutMs,
    'owned Codex CLI history',
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = crypto.randomBytes(6).toString('hex');
  const result = {
    result: 'FAIL',
    generated_at: new Date().toISOString(),
    run_id: runId,
    production_proxy: true,
    answer_path: options.answerViaCdp ? 'authenticated_cdp_9240_typed_presenter' : 'direct_relay_client',
    workspace_path: workspacePath,
    focus_actions: 0,
    visible_windows_opened: 0,
    native_window_launch_mode: 'background',
    protected_user_sessions_touched: 0,
    stages: [],
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });

  let releaseOperation = null;
  let relay = null;
  let browser = null;
  let page = null;
  let pageRestored = false;
  let sessionId = '';
  let responseStartIndex = 0;
  let nativeThreadId = '';
  let sessionClosed = false;
  let threadArchived = false;
  try {
    releaseOperation = soak.acquirePidLock(
      soak.OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-cli-live-question-e2e', kind: 'owned-mutation', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = soak.OPERATION_LOCK_PATH;
    result.stages.push('operation_lock');

    if (options.answerViaCdp) {
      ({ browser, page } = await prepareProductionPage(options, result));
      result.stages.push('authenticated_single_page');
    }

    relay = await production.openRelay();
    await production.waitFor(
      () => production.latestSessions(relay.messages).length > 0,
      30000,
      'production session inventory',
    );
    result.stages.push('production_relay');

    const launchRequestId = `codex-cli-question-launch-${runId}`;
    const launchStart = relay.messages.length;
    relay.ws.send(JSON.stringify({
      type: 'launch_session',
      protocol_version: 1,
      request_id: launchRequestId,
      agent_type: 'codex_cli',
      workspace_path: workspacePath,
      permission_mode: 'read-only',
      collaboration_mode: 'plan',
    }));
    const launch = await waitForFrame(
      relay.messages,
      launchStart,
      message => message.request_id === launchRequestId
        && ['session_launch_ack', 'session_launch_failed'].includes(message.type),
      60000,
      'disposable Codex CLI launch',
    );
    assert.strictEqual(launch.type, 'session_launch_ack', JSON.stringify(launch));
    sessionId = launch.session_id;
    result.session_id = sessionId;
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item => item.session_id === sessionId),
      60000,
      'disposable Codex CLI session inventory',
    );
    assert.strictEqual(session.agent_type, 'codex_cli');
    assert.strictEqual(session.status, 'healthy');
    assert.notStrictEqual(session.native_cli_window_opened, true, 'disposable CLI launch opened a native window');
    result.stages.push('owned_background_session');

    const config = await requestConfig(relay, sessionId);
    result.question_prompts_capability = config.capabilities?.question_prompts === true;
    if (options.requireCapability) {
      assert.strictEqual(result.question_prompts_capability, true, 'production CLI question_prompts capability is not advertised');
    }
    result.stages.push('capability_read');

    const promptText = [
      'This is an owned disposable Remote Agent Chat production validation turn.',
      'Call request_user_input now and do not answer it yourself.',
      'Ask exactly one question with id route, header Route, and body Choose a route.',
      'Offer Relay with description Answer through RAC. and Native with description Answer locally.',
      'After the tool response, acknowledge the selected route briefly and finish.',
      'Do not call any other tool.',
    ].join(' ');
    const clientMessageId = `codex-cli-live-question-${runId}`;
    const messageStart = relay.messages.length;
    const deliveryStarted = Date.now();
    relay.ws.send(JSON.stringify({
      type: 'send',
      session: sessionId,
      content: promptText,
      client_message_id: clientMessageId,
    }));
    const delivery = await waitForFrame(
      relay.messages,
      messageStart,
      message => message.type === 'proxy_send_result'
        && message.client_message_id === clientMessageId
        && ['delivered', 'failed', 'rejected'].includes(message.result),
      90000,
      'Codex CLI native delivery receipt',
    );
    assert.strictEqual(delivery.result, 'delivered', JSON.stringify(delivery));
    assert.strictEqual(delivery.native_receipt?.transport, 'codex_app_server', JSON.stringify(delivery));
    nativeThreadId = delivery.native_receipt.thread_id;
    result.delivery = {
      result: delivery.result,
      transport: delivery.native_receipt.transport,
      thread_id: nativeThreadId,
      turn_id: delivery.native_receipt.turn_id,
      receipt_ms: Date.now() - deliveryStarted,
    };
    result.stages.push('native_delivery');

    const visibleStarted = Date.now();
    const prompt = await waitForFrame(
      relay.messages,
      messageStart,
      message => message.type === 'question_prompt'
        && message.session_id === sessionId
        && message.source?.surface === 'codex_cli'
        && message.lifecycle === 'open',
      options.timeoutMs,
      'production Codex CLI question prompt',
    );
    result.delivery_to_visible_ms = Date.now() - visibleStarted;
    result.producer_to_visible_ms = Math.max(0, Date.now() - Date.parse(prompt.observed_at));
    assert.strictEqual(prompt.title, 'Route');
    assert.strictEqual(prompt.questions.length, 1);
    assert.strictEqual(prompt.questions[0].message, 'Choose a route.');
    const relayChoice = semanticChoice(prompt.questions[0], 'Relay');
    const nativeChoice = semanticChoice(prompt.questions[0], 'Native');
    assert(relayChoice && nativeChoice, 'production prompt did not preserve both native choices');
    result.prompt = {
      prompt_id: prompt.prompt_id,
      generation: prompt.generation,
      source: prompt.source,
      title: prompt.title,
      question: prompt.questions[0].message,
      choices: prompt.questions[0].choices.map(choice => ({ label: choice.label, description: choice.description })),
      lifecycle: prompt.lifecycle,
      observed_at: prompt.observed_at,
      deadline_at: prompt.deadline_at,
      auto_resolution_ms: prompt.auto_resolution_ms,
      auto_resolution_policy: prompt.auto_resolution_policy,
    };
    result.producer_request = producerRequestSummary(prompt, delivery);
    result.stages.push('browser_question_visible');

    const waiting = await waitForFrame(
      relay.messages,
      messageStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind === 'waiting_for_user',
      30000,
      'Codex CLI waiting_for_user activity',
    );
    result.waiting_activity = waiting.activity;
    result.stages.push('waiting_for_user');

    if (options.answerViaCdp) {
      result.pending_ui_before_answer = await selectDisposableQuestion(
        page,
        sessionId,
        prompt,
        options.pendingScreenshot,
      );
      const uiObservedAt = Date.now();
      const screenshot = fs.readFileSync(options.pendingScreenshot);
      result.pending_ui_screenshot = {
        path: path.relative(ROOT, options.pendingScreenshot).replace(/\\/g, '/'),
        bytes: screenshot.length,
        sha256: crypto.createHash('sha256').update(screenshot).digest('hex'),
      };
      result.producer_to_authenticated_ui_ms = Math.max(0, uiObservedAt - Date.parse(prompt.observed_at));
      result.stages.push('authenticated_ui_question_visible');
    }

    const requestId = `codex-cli-live-answer-${runId}`;
    const responseLabel = options.response === 'native' ? 'Native' : 'Relay';
    const response = responseFrame(prompt, requestId, responseLabel);
    const expectedLifecycle = 'answered';
    result.requested_response = options.response;
    const responseStart = relay.messages.length;
    responseStartIndex = responseStart;
    let answerStarted = Date.now();
    if (options.answerViaCdp) {
      const submitted = await submitDisposableQuestion(page, sessionId, responseLabel);
      result.authenticated_ui_selected = submitted.selected;
      result.authenticated_ui_input_timing = submitted.interaction_timing;
      result.browser_question_frame_baseline = submitted.websocket_baseline;
      answerStarted = submitted.submitStartedAt;
      result.stages.push('authenticated_ui_submitted');
    } else {
      relay.ws.send(JSON.stringify(response));
    }
    const submitting = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'question_prompt'
        && message.prompt_id === prompt.prompt_id
        && message.lifecycle === 'submitting',
      30000,
      'Codex CLI question submitting lifecycle',
    );
    result.submitting_lifecycle = {
      lifecycle: submitting.lifecycle,
      submitted_at: submitting.submitted_at,
      server_ts: submitting.server_ts,
    };
    let browserQuestionResponse = null;
    const receipt = options.answerViaCdp
      ? (browserQuestionResponse = await waitForBrowserQuestionReceipt(
        page,
        sessionId,
        prompt,
        result.browser_question_frame_baseline,
        30000,
      )).receipt
      : await waitForFrame(
        relay.messages,
        responseStart,
        message => message.type === 'agent_control_result' && message.request_id === requestId,
        30000,
        'Codex CLI native question receipt',
      );
    const browserReceiptAt = Date.parse(receipt.observed_at || '');
    result.click_to_native_ack_ms = Number.isFinite(browserReceiptAt)
      ? Math.max(0, browserReceiptAt - answerStarted)
      : Date.now() - answerStarted;
    if (browserQuestionResponse) {
      result.browser_question_response = {
        outbound: {
          request_id_hash: idHash(browserQuestionResponse.outbound.request_id),
          session_matches: browserQuestionResponse.outbound.session_id === sessionId,
          prompt_matches: browserQuestionResponse.outbound.prompt_id === prompt.prompt_id,
          generation_matches: browserQuestionResponse.outbound.generation === prompt.generation,
          action: browserQuestionResponse.outbound.action,
          answers: browserQuestionResponse.outbound.answers,
          observed_at: browserQuestionResponse.outbound.observed_at,
        },
        inbound: redactedRelayFrame(receipt),
        receipt_observed_at: receipt.observed_at,
      };
    }
    assert.strictEqual(receipt.result, 'ok', JSON.stringify(receipt));
    assert.strictEqual(receipt.native_acknowledged, true, JSON.stringify(receipt));
    assert.strictEqual(receipt.native_receipt?.method, 'serverRequest/resolved', JSON.stringify(receipt));
    assert.strictEqual(receipt.native_receipt?.thread_id, delivery.native_receipt.thread_id);
    assert.strictEqual(receipt.native_receipt?.turn_id, delivery.native_receipt.turn_id);
    result.redacted_relay_frame = redactedRelayFrame(receipt);
    result.native_receipt = {
      method: receipt.native_receipt.method,
      same_thread: true,
      same_turn: true,
      native_acknowledged: true,
    };

    const terminal = await waitForFrame(
      relay.messages,
      responseStart,
      message => message.type === 'question_prompt_state'
        && message.prompt_id === prompt.prompt_id
        && message.lifecycle === expectedLifecycle,
      30000,
      `${expectedLifecycle} CLI question terminal state`,
    );
    result.terminal_lifecycle = terminal.lifecycle;
    const resumed = await waitForFrame(
      relay.messages,
      responseStart,
      message => ['status', 'session_summary'].includes(message.type)
        && (message.session === sessionId || message.session_id === sessionId)
        && message.activity?.kind !== 'waiting_for_user',
      90000,
      'Codex CLI post-answer activity',
    );
    result.after_answer_activity = resumed.activity;
    if (options.answerViaCdp) {
      await page.locator('.permission-card[role="dialog"]').waitFor({ state: 'detached', timeout: 30000 });
      const pendingRecords = await readPendingProbe(page);
      const pendingRecord = pendingRecords.find(record => (
        record.card_present
        && record.submit_disabled === true
        && record.submit_text === 'Sending...'
        && (prompt.cancel_supported === true
          ? record.cancel_present === true && record.cancel_disabled === true
          : record.cancel_present === false && record.cancel_disabled === null)
      ));
      assert(pendingRecord, `authenticated UI never exposed truthful pending controls: ${JSON.stringify(pendingRecords)}`);
      const afterDom = await page.evaluate((expectedSessionId) => {
        const card = document.querySelector(`.session-card[data-session-id="${CSS.escape(expectedSessionId)}"]`);
        return {
          prompt_present: !!document.querySelector('.permission-card[role="dialog"]'),
          sidebar_attention_badge_present: !!card?.querySelector('.session-card-perm-badge'),
          sidebar_label: card?.querySelector('.session-card-sub')?.textContent?.trim() || '',
        };
      }, sessionId);
      assert.strictEqual(afterDom.prompt_present, false);
      assert.strictEqual(afterDom.sidebar_attention_badge_present, false);
      result.authenticated_ui_pending = {
        observed: true,
        record: pendingRecord,
        records_observed: pendingRecords.length,
      };
      result.authenticated_ui_after_ack = afterDom;
      result.stages.push('authenticated_ui_terminal');
    }
    result.stages.push('native_answer_acknowledged');

    const duplicateRequestId = `codex-cli-live-duplicate-${runId}`;
    const duplicateStart = relay.messages.length;
    relay.ws.send(JSON.stringify({ ...response, request_id: duplicateRequestId }));
    const duplicate = await waitForFrame(
      relay.messages,
      duplicateStart,
      message => message.type === 'agent_control_result' && message.request_id === duplicateRequestId,
      15000,
      'duplicate CLI question rejection',
    );
    assert.strictEqual(duplicate.result, 'failed', JSON.stringify(duplicate));
    assert.strictEqual(duplicate.error?.code, 'prompt_already_claimed', JSON.stringify(duplicate));
    assert.notStrictEqual(duplicate.native_attempted, true, JSON.stringify(duplicate));
    result.duplicate = {
      code: duplicate.error.code,
      native_attempted: false,
      rejection_boundary: 'relay_question_registry',
    };
    result.stages.push('duplicate_rejected');

    const settledEvent = await production.waitFor(
      () => relay.messages.slice(responseStartIndex).find(message => {
        if (!['status', 'session_summary', 'session_patch'].includes(message?.type)) return false;
        const activity = relaySessionActivity(message, sessionId);
        return activity && !['thinking', 'generating', 'working', 'waiting_for_user'].includes(activity.kind);
      }),
      90000,
      'settled disposable Codex CLI session',
      100,
    );
    result.settled_activity = relaySessionActivity(settledEvent, sessionId);
    result.settled_state_seq = settledEvent.state_seq ?? null;
    result.settled_event_type = settledEvent.type || null;
    result.session_state_timeline = compactSessionStateTimeline(relay.messages, sessionId, responseStartIndex);
    const history = await requestHistory(relay, sessionId, 30000);
    const messages = Array.isArray(history.messages) ? history.messages : [];
    result.history = {
      messages: messages.length,
      user_messages: messages.filter(message => message.role === 'user').length,
      assistant_messages: messages.filter(message => message.role === 'assistant').length,
      ordinary_answer_messages: messages.filter(message =>
        message.role === 'user'
          && /^(?:Relay|Native)(?: \(Recommended\))?$/.test(String(message.content || '').trim())).length,
    };
    assert.strictEqual(result.history.ordinary_answer_messages, 0, 'native question answer became an ordinary user message');

    threadArchived = await archiveThread(nativeThreadId);
    assert.strictEqual(threadArchived, true, 'owned Codex CLI thread was not archived');
    result.thread_archived = true;
    nativeThreadId = '';
    sessionClosed = await closeOwnedSession(relay, sessionId);
    assert.strictEqual(sessionClosed, true, 'owned Codex CLI session did not close');
    result.session_closed = true;
    if (page) {
      result.browser.restore = await restoreProductionPage(
        page,
        result.browser.restore_session_id,
        result.browser.restore_sidebar_open,
      );
      pageRestored = result.browser.restore.restored;
      result.browser.final = await pageState(page);
      result.browser.pages_after = browser.contexts().flatMap(context => context.pages()).length;
      assert.strictEqual(result.browser.pages_after, 1, 'authenticated browser page count changed');
      assert.strictEqual(result.browser.new_pages_opened, 0);
      assert.strictEqual(result.browser.focus_actions, 0);
      assert.strictEqual(result.browser.visible_windows_opened, 0);
    }
    result.stages.push('owned_cleanup');

    result.duplicate_native_answers = 0;
    result.wrong_session_answers = 0;
    result.false_success_receipts = 0;
    result.result = 'PASS';
    return result;
  } catch (error) {
    if (sessionId && relay) {
      result.settle_diagnostics = {
        latest_reduced_session: production.latestSessions(relay.messages)
          .find(item => item.session_id === sessionId) || null,
        session_state_timeline: compactSessionStateTimeline(relay.messages, sessionId, responseStartIndex),
      };
    }
    result.error = error.stack || error.message;
    throw error;
  } finally {
    if (sessionId && !sessionClosed) {
      try {
        sessionClosed = await closeOwnedSession(relay, sessionId);
        result.cleanup_session_closed = sessionClosed;
      } catch {}
    }
    if (nativeThreadId && !threadArchived) {
      try {
        threadArchived = await archiveThread(nativeThreadId);
        result.cleanup_thread_archived = threadArchived;
      } catch {}
    }
    if (page && !pageRestored) {
      try {
        result.browser = result.browser || {};
        result.browser.cleanup_restore = await restoreProductionPage(
          page,
          result.browser.restore_session_id,
          result.browser.restore_sidebar_open,
        );
        pageRestored = result.browser.cleanup_restore.restored;
      } catch {}
    }
    if (page) {
      try {
        await page.evaluate(() => {
          window.__RAC_QUESTION_PENDING_PROBE__?.observer?.disconnect?.();
          delete window.__RAC_QUESTION_PENDING_PROBE__;
        });
      } catch {}
      try { result.browser.final = await pageState(page); } catch {}
      try {
        result.browser.websocket_probe_cleanup = await removeBrowserQuestionFrameProbe(page);
      } catch {}
    }
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
    try { relay?.ws?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { releaseOperation?.(); } catch {}
    const resolvedWorkspace = path.resolve(workspacePath).toLowerCase();
    if (resolvedWorkspace.startsWith(path.resolve('C:\\temp').toLowerCase() + path.sep)) {
      try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch {}
    }
  }
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  compactSessionStateTimeline,
  main,
  parseArgs,
  producerRequestSummary,
  redactedRelayFrame,
  relaySessionActivity,
  responseFrame,
  semanticChoice,
};
