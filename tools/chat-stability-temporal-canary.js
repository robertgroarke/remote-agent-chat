#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const { analyzeTemporalTrace } = require('./chat-stability-temporal-contract');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'relay-server', 'public');
const SESSION_COUNT = 69;
const HISTORY_ROWS = 4_000;
const SELECTED_SESSION = 'temporal-session-000';
const CANONICAL_CONVERSATION_ID = 'codex:temporal-fixture-thread-001';
const FINAL_SUMMARY = 'Designing process management helpers';
const COMPOSER_DRAFT_SENTINEL = 'Temporal draft must survive refresh';
const DEPTHS = [
  { name: 'top', fraction: 0, sidebarFraction: 0 },
  { name: '25_percent', fraction: 0.25, sidebarFraction: 0.25 },
  { name: '50_percent', fraction: 0.5, sidebarFraction: 0.5 },
  { name: '75_percent', fraction: 0.75, sidebarFraction: 0.75 },
  { name: 'near_bottom', fraction: 0.95, sidebarFraction: 0.95 },
];

function parseArgs(argv) {
  const options = {
    durationMs: 120_000,
    output: '',
    width: 1440,
    height: 900,
    retainTrace: false,
    bundlePath: path.join(PUBLIC_ROOT, 'dist', 'bundle.js'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--duration-ms' && next) options.durationMs = Number(argv[++index]);
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--width' && next) options.width = Number(argv[++index]);
    else if (arg === '--height' && next) options.height = Number(argv[++index]);
    else if (arg === '--bundle-path' && next) options.bundlePath = path.resolve(argv[++index]);
    else if (arg === '--retain-trace') options.retainTrace = true;
    else if (arg === '--read-only') continue;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.durationMs) && options.durationMs >= 5_000,
    '--duration-ms must be at least 5000');
  assert(Number.isInteger(options.width) && options.width >= 390, '--width must be at least 390');
  assert(Number.isInteger(options.height) && options.height >= 600, '--height must be at least 600');
  assert(fs.existsSync(options.bundlePath), `bundle path does not exist: ${options.bundlePath}`);
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fixtureSessions() {
  const surfaces = ['codex-desktop', 'codex', 'codex_cli', 'claude', 'cursor', 'antigravity_panel', 'roo_code'];
  const base = Date.parse('2026-07-21T18:00:00Z');
  return Array.from({ length: SESSION_COUNT }, (_, index) => ({
    session_id: `temporal-session-${String(index).padStart(3, '0')}`,
    canonical_conversation_id: index === 0 ? CANONICAL_CONVERSATION_ID : `fixture:${index}`,
    display_name: index === 0 ? 'Codex Desktop temporal stability' : `Temporal mixed harness ${index}`,
    chat_title: index === 0 ? 'Reasoning summary temporal stability' : `Mixed harness fixture ${index}`,
    agent_type: index === 0 ? 'codex-desktop' : surfaces[index % surfaces.length],
    status: 'healthy',
    health: 'connected',
    is_test_session: false,
    workspace_path: ROOT,
    project_root: ROOT,
    last_seen_at: new Date(base - index * 1000).toISOString(),
    activity: { kind: 'idle', label: '' },
  }));
}

function fixtureMessages() {
  const base = Date.parse('2026-07-21T18:30:00Z');
  return Array.from({ length: HISTORY_ROWS }, (_, index) => ({
    id: `temporal-history-${index + 1}`,
    source_message_id: `temporal-source-${index + 1}`,
    sequence: index + 1,
    ts: (base + index * 1000) / 1000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === HISTORY_ROWS - 1
      ? `Temporal transcript ready row ${index + 1}`
      : `Temporal deterministic transcript row ${index + 1}`,
  }));
}

function settledSummaryMessage() {
  return {
    id: 'temporal-summary-message',
    source_message_id: 'response_item:temporal-turn-101:reasoning',
    native_source_id: 'response_item:temporal-turn-101:reasoning',
    source_cursor: 'temporal-cursor-101',
    source: 'codex_native_jsonl',
    sequence: HISTORY_ROWS + 1,
    created_at: '2026-07-21T20:31:01.237Z',
    timestamp: '2026-07-21T20:31:01.237Z',
    role: 'assistant',
    content: FINAL_SUMMARY,
    content_blocks: [{
      type: 'thinking',
      title: 'Thinking',
      content: FINAL_SUMMARY,
      text: FINAL_SUMMARY,
      activity_summary: true,
      native_turn_id: 'temporal-turn-101',
      lifecycle_generation: 101,
      native_source_id: 'response_item:temporal-turn-101:reasoning',
      source_cursor: 'temporal-cursor-101',
      source_surface: 'codex-desktop',
      timestamp: '2026-07-21T20:31:01.237Z',
    }],
  };
}

function metricMap(payload) {
  return Object.fromEntries((payload?.metrics || []).map(item => [item.name, item.value]));
}

function percentile(values, fraction) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return 0;
  return finite[Math.min(finite.length - 1, Math.ceil(finite.length * fraction) - 1)];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    samples: finite.length,
    p50_ms: Number(percentile(finite, 0.5).toFixed(3)),
    p95_ms: Number(percentile(finite, 0.95).toFixed(3)),
    p99_ms: Number(percentile(finite, 0.99).toFixed(3)),
    max_ms: Number(Math.max(0, ...finite).toFixed(3)),
  };
}

function temporalInitScript() {
  const MAX_EVENTS = 20_000;
  const EXACT_SUMMARY = 'Designing process management helpers';
  const browserPercentile = (values, fraction) => {
    const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!finite.length) return 0;
    return finite[Math.min(finite.length - 1, Math.ceil(finite.length * fraction) - 1)];
  };
  const state = window.__RAC_TEMPORAL_CANARY__ = {
    active: false,
    allowLiveEdge: false,
    events: [],
    droppedSamples: 0,
    frameCount: 0,
    mutationBatches: [],
    longTasks: [],
    relayFrames: [],
    reactCommits: [],
    transcriptMeasurements: [],
    scrollWrites: 0,
    scrollWritesByContainer: { transcript: 0, sidebar: 0 },
    unattributedScrollWrites: 0,
    nativeScrollEvents: 0,
    focusLosses: 0,
    overheadMs: 0,
    userScrollEpoch: 0,
    firstExactPaintAt: null,
    typedFrameReceivedAt: null,
    selectedSession: '',
    canonicalConversationId: '',
    depth: '',
    sidebarDepth: '',
    paintSamplePending: false,
    paintSampleRequested: true,
    lastPaintSampleAt: 0,
  };
  const pushBounded = (target, value) => {
    if (target.length >= MAX_EVENTS) {
      state.droppedSamples += 1;
      return;
    }
    target.push(value);
  };
  const hash = value => {
    let result = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  };

  const listenerTargets = new Map();
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const captureOf = options => options === true || !!options?.capture;
  EventTarget.prototype.addEventListener = function temporalAdd(type, listener, options) {
    if (listener) {
      let byType = listenerTargets.get(this);
      if (!byType) {
        byType = new Map();
        listenerTargets.set(this, byType);
      }
      const key = `${type}:${captureOf(options) ? 1 : 0}`;
      let listeners = byType.get(key);
      if (!listeners) {
        listeners = new Set();
        byType.set(key, listeners);
      }
      listeners.add(listener);
    }
    return originalAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function temporalRemove(type, listener, options) {
    const key = `${type}:${captureOf(options) ? 1 : 0}`;
    listenerTargets.get(this)?.get(key)?.delete(listener);
    return originalRemove.call(this, type, listener, options);
  };
  state.listenerCount = () => {
    let total = 0;
    for (const [target, byType] of listenerTargets) {
      if (target instanceof Node && target !== document && !target.isConnected) {
        listenerTargets.delete(target);
        continue;
      }
      for (const listeners of byType.values()) total += listeners.size;
    }
    return total;
  };

  const activeTimeouts = new Map();
  const activeIntervals = new Map();
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    let id;
    const wrapped = (...callbackArgs) => {
      activeTimeouts.delete(id);
      if (typeof callback === 'function') return callback(...callbackArgs);
      return undefined;
    };
    id = originalSetTimeout(wrapped, delay, ...args);
    activeTimeouts.set(id, { kind: 'timeout', delay_ms: Number(delay) || 0, stack_hash: hash(new Error().stack) });
    return id;
  };
  window.clearTimeout = id => {
    activeTimeouts.delete(id);
    return originalClearTimeout(id);
  };
  window.setInterval = (callback, delay, ...args) => {
    const id = originalSetInterval(callback, delay, ...args);
    activeIntervals.set(id, { kind: 'interval', delay_ms: Number(delay) || 0, stack_hash: hash(new Error().stack) });
    return id;
  };
  window.clearInterval = id => {
    activeIntervals.delete(id);
    return originalClearInterval(id);
  };
  state.timerCount = () => activeTimeouts.size + activeIntervals.size;
  state.timerDetails = () => [...activeTimeouts.values(), ...activeIntervals.values()];

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class TemporalWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      originalAdd.call(this, 'message', event => {
        const started = performance.now();
        try {
          const payload = JSON.parse(String(event.data || ''));
          const entry = {
            at_epoch_ms: Date.now(),
            type: String(payload.type || ''),
            session_id: String(payload.session_id || payload.session || ''),
            state_seq: Number(payload.state_seq) || null,
            fixture_refresh_kind: payload.fixture_refresh_kind || null,
            source_message_id: payload.source_message_id || null,
          };
          if (entry.source_message_id === 'response_item:temporal-turn-101:reasoning'
            && state.typedFrameReceivedAt == null) {
            state.typedFrameReceivedAt = entry.at_epoch_ms;
          }
          pushBounded(state.relayFrames, entry);
          state.paintSampleRequested = true;
        } catch {}
        state.overheadMs += performance.now() - started;
      });
    }
  };

  const descriptorOwner = (() => {
    let owner = HTMLElement.prototype;
    while (owner && !Object.getOwnPropertyDescriptor(owner, 'scrollTop')) owner = Object.getPrototypeOf(owner);
    return owner;
  })();
  const scrollDescriptor = descriptorOwner && Object.getOwnPropertyDescriptor(descriptorOwner, 'scrollTop');
  if (descriptorOwner && scrollDescriptor?.get && scrollDescriptor?.set) {
    Object.defineProperty(descriptorOwner, 'scrollTop', {
      configurable: scrollDescriptor.configurable,
      enumerable: scrollDescriptor.enumerable,
      get: scrollDescriptor.get,
      set(value) {
        const container = this instanceof Element && this.matches?.('.messages')
          ? 'transcript'
          : this instanceof Element && this.matches?.('.session-list')
            ? 'sidebar'
            : '';
        const before = container ? scrollDescriptor.get.call(this) : null;
        const context = container ? window.__RAC_SCROLL_WRITE_CONTEXT__ || null : null;
        scrollDescriptor.set.call(this, value);
        if (container && state.active) {
          state.paintSampleRequested = true;
          state.scrollWrites += 1;
          state.scrollWritesByContainer[container] += 1;
          if (!context || context.container !== container) state.unattributedScrollWrites += 1;
          pushBounded(state.events, {
            phase: 'programmatic_scroll_write', at_epoch_ms: Date.now(),
            before_scroll_top: before, requested_scroll_top: Number(value),
            after_scroll_top: scrollDescriptor.get.call(this),
            container,
            writer: context?.writer || 'javascript_scrollTop_setter',
            reason: context?.reason || 'unattributed_programmatic',
            interaction_epoch: context?.interaction_epoch ?? null,
            route_session_id: context?.route_session_id ?? null,
            anchor_id: context?.anchor_id ?? null,
            anchor_offset_px: context?.anchor_offset_px ?? null,
            bottom_gap_px: context?.bottom_gap_px ?? null,
            payload_generation: context?.payload_generation ?? null,
            stack_hash: hash(new Error().stack), user_scroll_epoch: state.userScrollEpoch,
          });
        }
      },
    });
  }

  originalAdd.call(document, 'wheel', event => {
    if (event.target?.closest?.('.messages,.session-list')) state.userScrollEpoch += 1;
  }, { capture: true, passive: true });
  originalAdd.call(document, 'keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      state.userScrollEpoch += 1;
    }
  }, true);
  originalAdd.call(document, 'scroll', event => {
    if (!state.active || !event.target?.matches?.('.messages,.session-list')) return;
    state.nativeScrollEvents += 1;
    state.paintSampleRequested = true;
    pushBounded(state.events, {
      phase: 'native_scroll', at_epoch_ms: Date.now(),
      container: event.target.matches('.messages') ? 'transcript' : 'sidebar',
      scroll_top: event.target.scrollTop,
      scroll_height: event.target.scrollHeight,
      client_height: event.target.clientHeight,
      user_scroll_epoch: state.userScrollEpoch,
    });
  }, true);

  state.readSemantic = () => {
    const list = state.list || document.querySelector('.messages');
    if (!list) return {};
    const exactRows = [...list.querySelectorAll('.content-block-thinking-native-summary')]
      .filter(node => String(node.textContent || '').includes(EXACT_SUMMARY));
    const activeCard = document.querySelector('.session-card.active[data-session-id]');
    const prompt = document.querySelector('.permission-overlay,[data-testid="permission-overlay"],.permission-prompt');
    return {
      active_session_id: activeCard?.dataset?.sessionId || null,
      canonical_card_count: document.querySelectorAll(`.session-card[data-session-id="${state.selectedSession}"]`).length,
      prompt_id: prompt?.dataset?.promptId || prompt?.getAttribute?.('data-prompt-id') || null,
      prompt_count: document.querySelectorAll('.permission-overlay,[data-testid="permission-overlay"],.permission-prompt').length,
      live_thinking_text: document.querySelector('.live-thinking-row')?.textContent?.trim() || '',
      exact_summary_count: exactRows.length,
      total_message_count: Number(list.dataset.totalMessageCount || 0),
      surface_owner: list.dataset.agentType || '',
    };
  };

  state.snapshot = (phase, refreshSemantic = false) => {
    const started = performance.now();
    const list = state.list || document.querySelector('.messages');
    const sidebar = state.sidebarList || document.querySelector('.session-list');
    if (!list || !sidebar) return null;
    state.list = list;
    state.sidebarList = sidebar;
    if (refreshSemantic || !state.semantic) state.semantic = state.readSemantic();
    const listRect = list.getBoundingClientRect();
    let anchorRow = state.anchorRow;
    if (!anchorRow) {
      anchorRow = [...list.querySelectorAll('.message[data-message-key]')].find(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > listRect.top + 1 && rect.top < listRect.bottom - 1;
      }) || null;
      state.anchorRow = anchorRow;
    }
    const anchorRect = anchorRow?.isConnected ? anchorRow.getBoundingClientRect() : null;
    const sidebarRect = sidebar.getBoundingClientRect();
    let sidebarAnchorRow = state.sidebarAnchorRow;
    if (!sidebarAnchorRow?.isConnected) {
      sidebarAnchorRow = [...sidebar.querySelectorAll('.session-card[data-session-id]')].find(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > sidebarRect.top + 1 && rect.top < sidebarRect.bottom - 1;
      }) || null;
      state.sidebarAnchorRow = sidebarAnchorRow;
    }
    const sidebarAnchorRect = sidebarAnchorRow?.isConnected ? sidebarAnchorRow.getBoundingClientRect() : null;
    const sidebarOrder = [...sidebar.querySelectorAll('.session-card[data-session-id]')]
      .map(row => row.dataset.sessionId || '').filter(Boolean);
    const focused = document.activeElement;
    const composer = document.querySelector('.textarea-row textarea');
    const profiler = window.__RAC_RENDER_PROFILER__ || [];
    const result = {
      phase,
      at_epoch_ms: Date.now(),
      route: document.querySelector('.messages') ? 'chat' : 'other',
      session_id: state.selectedSession,
      canonical_conversation_id: state.canonicalConversationId,
      depth: state.depth,
      scroll_top: Number(list.scrollTop.toFixed(3)),
      scroll_height: list.scrollHeight,
      client_height: list.clientHeight,
      anchor_key: anchorRow?.dataset?.messageKey || null,
      anchor_offset_px: anchorRect ? Number((anchorRect.top - listRect.top).toFixed(3)) : null,
      sidebar_depth: state.sidebarDepth,
      sidebar_scroll_top: Number(sidebar.scrollTop.toFixed(3)),
      sidebar_scroll_height: sidebar.scrollHeight,
      sidebar_client_height: sidebar.clientHeight,
      sidebar_anchor_id: sidebarAnchorRow?.dataset?.sessionId || null,
      sidebar_anchor_offset_px: sidebarAnchorRect ? Number((sidebarAnchorRect.top - sidebarRect.top).toFixed(3)) : null,
      sidebar_order_hash: hash(sidebarOrder.join('\u0001')),
      ...state.semantic,
      focus: focused === document.body ? 'body' : `${focused?.tagName?.toLowerCase() || 'none'}:${focused?.className || ''}`.slice(0, 180),
      composer_draft_hash: hash(composer?.value || ''),
      composer_draft_length: String(composer?.value || '').length,
      composer_selection_start: Number.isInteger(composer?.selectionStart) ? composer.selectionStart : null,
      composer_selection_end: Number.isInteger(composer?.selectionEnd) ? composer.selectionEnd : null,
      composer_has_focus: focused === composer,
      react_commit_sequence: state.reactCommits.length || profiler.length,
      relay_frame_sequence: state.relayFrames.length,
      user_scroll_epoch: state.userScrollEpoch,
    };
    if (result.exact_summary_count === 1 && state.firstExactPaintAt == null) state.firstExactPaintAt = result.at_epoch_ms;
    state.overheadMs += performance.now() - started;
    return result;
  };

  state.start = ({ sessionId, canonicalConversationId, depth, sidebarDepth, allowLiveEdge }) => {
    state.selectedSession = sessionId;
    state.canonicalConversationId = canonicalConversationId;
    state.depth = depth;
    state.sidebarDepth = sidebarDepth || depth;
    state.allowLiveEdge = !!allowLiveEdge;
    state.events = [];
    state.droppedSamples = 0;
    state.frameCount = 0;
    state.mutationBatches = [];
    state.longTasks = [];
    state.reactCommits = [];
    state.transcriptMeasurements = [];
    state.scrollWrites = 0;
    state.scrollWritesByContainer = { transcript: 0, sidebar: 0 };
    state.unattributedScrollWrites = 0;
    state.nativeScrollEvents = 0;
    state.focusLosses = 0;
    state.overheadMs = 0;
    state.firstExactPaintAt = null;
    state.typedFrameReceivedAt = null;
    state.startedAtEpochMs = Date.now();
    state.list = document.querySelector('.messages');
    state.sidebarList = document.querySelector('.session-list');
    state.anchorRow = null;
    state.sidebarAnchorRow = null;
    state.semantic = null;
    state.paintSamplePending = false;
    state.paintSampleRequested = true;
    state.lastPaintSampleAt = 0;
    state.renderProfileStart = (window.__RAC_RENDER_PROFILER__ || []).length;
    state.listenerBaseline = state.listenerCount();
    state.timerBaseline = state.timerCount();
    state.timerBaselineDetails = state.timerDetails();
    state.nodeBaseline = document.querySelectorAll('*').length;
    state.baseline = state.snapshot('baseline', true);
    state.lastFingerprint = '';
    state.active = true;
    state.mutationObserver = new MutationObserver(records => {
      const started = performance.now();
      const mutationTargets = [...new Set(records.map(record => {
        const target = record.target?.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
        if (!(target instanceof Element)) return record.target?.nodeName || 'unknown';
        const classes = [...target.classList].slice(0, 4).join('.');
        return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${classes ? `.${classes}` : ''}`.slice(0, 240);
      }))];
      const cacheRelevant = mutationTargets.some(target => target !== 'span.sidebar-footer-rtt');
      pushBounded(state.mutationBatches, {
        at_epoch_ms: Date.now(), records: records.length,
        child_list: records.filter(record => record.type === 'childList').length,
        character_data: records.filter(record => record.type === 'characterData').length,
        attributes: records.filter(record => record.type === 'attributes').length,
        targets: mutationTargets,
        cache_relevant: cacheRelevant,
      });
      state.semantic = state.readSemantic();
      state.paintSampleRequested = true;
      state.overheadMs += performance.now() - started;
    });
    state.mutationObserver.observe(document.getElementById('root'), {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    try {
      state.longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          pushBounded(state.longTasks, { start_ms: entry.startTime, duration_ms: entry.duration });
        }
      });
      state.longTaskObserver.observe({ type: 'longtask', buffered: false });
    } catch {}
    const frame = () => {
      if (!state.active) return;
      state.frameCount += 1;
      const shouldSample = state.paintSampleRequested || performance.now() - state.lastPaintSampleAt >= 100;
      if (shouldSample && !state.paintSamplePending) {
        state.paintSamplePending = true;
        state.paintSampleRequested = false;
        // A zero-delay task queued from rAF runs after the browser's paint
        // opportunity. This avoids treating another component's later rAF
        // callback in the same frame as a user-visible excursion.
        originalSetTimeout(() => {
          state.paintSamplePending = false;
          if (!state.active) return;
          state.lastPaintSampleAt = performance.now();
          const sample = state.snapshot('paint_sample');
          if (sample) {
            const fingerprint = [sample.scroll_top, sample.scroll_height, sample.anchor_key,
              sample.anchor_offset_px, sample.active_session_id, sample.canonical_card_count,
              sample.sidebar_scroll_top, sample.sidebar_scroll_height, sample.sidebar_anchor_id,
              sample.sidebar_anchor_offset_px, sample.sidebar_order_hash,
              sample.prompt_id, sample.prompt_count, sample.live_thinking_text,
              sample.exact_summary_count, sample.total_message_count, sample.focus,
              sample.composer_draft_hash, sample.composer_draft_length,
              sample.composer_selection_start, sample.composer_selection_end, sample.composer_has_focus,
              sample.react_commit_sequence, sample.relay_frame_sequence].join('|');
            if (fingerprint !== state.lastFingerprint) {
              pushBounded(state.events, sample);
              state.lastFingerprint = fingerprint;
            }
          }
        }, 0);
      }
      state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
    return state.baseline;
  };

  state.stop = durationMs => {
    state.active = false;
    cancelAnimationFrame(state.raf);
    state.mutationObserver?.disconnect();
    state.longTaskObserver?.disconnect();
    const final = state.snapshot('final', true);
    const observedDurationMs = Math.max(1, Date.now() - state.startedAtEpochMs);
    const profiler = (window.__RAC_RENDER_PROFILER__ || []).slice(state.renderProfileStart);
    const commits = state.reactCommits.slice();
    const refreshFrames = state.relayFrames.filter(frame => (
      frame.fixture_refresh_kind === 'unchanged' && frame.at_epoch_ms >= state.baseline.at_epoch_ms
    ));
    const materialMutationBatches = state.mutationBatches.filter(batch => batch.cache_relevant !== false);
    const quietRefreshes = refreshFrames.filter(frame => !materialMutationBatches.some(batch => (
      batch.at_epoch_ms >= frame.at_epoch_ms && batch.at_epoch_ms <= frame.at_epoch_ms + 100
    )));
    return {
      baseline: state.baseline,
      final,
      events: state.events,
      sampled_animation_frames: state.frameCount,
      dropped_samples: state.droppedSamples,
      programmatic_scroll_writes: state.scrollWrites,
      programmatic_scroll_writes_by_container: { ...state.scrollWritesByContainer },
      unattributed_programmatic_scroll_writes: state.unattributedScrollWrites,
      native_scroll_events: state.nativeScrollEvents,
      mutation_batches: state.mutationBatches,
      relay_frames: state.relayFrames.filter(frame => frame.at_epoch_ms >= state.baseline.at_epoch_ms),
      long_tasks: state.longTasks,
      listener_baseline: state.listenerBaseline,
      listener_final: state.listenerCount(),
      listener_delta: state.listenerCount() - state.listenerBaseline,
      timer_baseline: state.timerBaseline,
      timer_final: state.timerCount(),
      timer_delta: state.timerCount() - state.timerBaseline,
      timer_baseline_details: state.timerBaselineDetails,
      timer_final_details: state.timerDetails(),
      dom_nodes_baseline: state.nodeBaseline,
      dom_nodes_final: document.querySelectorAll('*').length,
      dom_nodes_delta: document.querySelectorAll('*').length - state.nodeBaseline,
      observer_overhead_ms: Number(state.overheadMs.toFixed(3)),
      observer_duration_ms: observedDurationMs,
      observer_cpu_percent: Number((state.overheadMs * 100 / observedDurationMs).toFixed(4)),
      render_count: commits.length || profiler.length,
      render_actual_duration_ms: Number(profiler.reduce((sum, entry) => sum + Number(entry.actual_duration_ms || 0), 0).toFixed(3)),
      render_p95_ms: Number(browserPercentile(profiler.map(entry => Number(entry.actual_duration_ms || 0)), 0.95).toFixed(3)),
      refresh_frames: refreshFrames.length,
      unchanged_refresh_cache_hits: quietRefreshes.length,
      unchanged_refresh_cache_hit_rate: refreshFrames.length
        ? Number((quietRefreshes.length / refreshFrames.length).toFixed(4)) : 0,
      cache_ignored_background_mutation_batches: state.mutationBatches.length - materialMutationBatches.length,
      typed_frame_received_at_ms: state.typedFrameReceivedAt,
      exact_summary_first_paint_at_ms: state.firstExactPaintAt,
      react_commits: commits,
      transcript_measurements: state.transcriptMeasurements.slice(),
    };
  };
}

async function settlePaint(page, frames = 4) {
  await page.evaluate(frameCount => new Promise(resolve => {
    let remaining = frameCount;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);
}

async function prepareComposerIntent(page) {
  await page.locator('.textarea-row textarea').evaluate((composer, draft) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(composer, draft);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.focus({ preventScroll: true });
    composer.setSelectionRange(9, 14, 'forward');
  }, COMPOSER_DRAFT_SENTINEL);
  await page.waitForFunction(draft => (
    document.querySelector('.textarea-row textarea')?.value === draft
      && !!document.querySelector('.composer-hint.draft-live')
  ), COMPOSER_DRAFT_SENTINEL, { timeout: 5_000 });
  await settlePaint(page, 4);
}

async function preparePage(context, port, depth) {
  const page = await context.newPage();
  page.on('pageerror', error => process.stderr.write(`TEMPORAL_PAGE_ERROR ${depth.name} ${error.message}\n`));
  page.on('console', message => {
    if (message.type() === 'error') process.stderr.write(`TEMPORAL_CONSOLE_ERROR ${depth.name} ${message.text()}\n`);
  });
  await page.goto(`http://127.0.0.1:${port}/?session=${SELECTED_SESSION}&render_profile=1`, {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  });
  try {
    await page.waitForFunction(({ rows, sessions }) => (
      Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0) === rows
        && document.querySelectorAll('.session-card[data-session-id]').length === sessions
        && String(document.querySelector('.messages')?.textContent || '').includes('Temporal transcript ready')
    ), { rows: HISTORY_ROWS, sessions: SESSION_COUNT }, { timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      title: document.title,
      root_text: document.getElementById('root')?.textContent?.slice(0, 500) || '',
      cards: document.querySelectorAll('.session-card[data-session-id]').length,
      total_messages: Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0),
      rendered_messages: document.querySelectorAll('.messages .message').length,
      active_session: document.querySelector('.session-card.active')?.dataset?.sessionId || null,
      temporal_loaded: !!window.__RAC_TEMPORAL_CANARY__,
    })).catch(inner => ({ diagnostic_error: inner.message }));
    throw new Error(`page did not reach temporal fixture readiness: ${JSON.stringify(diagnostic)}; ${error.message}`);
  }
  await page.locator('.messages').evaluate((list, fraction) => {
    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.round(max * fraction);
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, depth.fraction);
  await page.locator('.session-list').evaluate((list, fraction) => {
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.round(max * fraction);
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, depth.sidebarFraction);
  await settlePaint(page, 8);
  await page.waitForTimeout(150);
  await prepareComposerIntent(page);
  const baseline = await page.evaluate(({ sessionId, canonicalConversationId, name, sidebarDepth }) => (
    window.__RAC_TEMPORAL_CANARY__.start({
      sessionId, canonicalConversationId, depth: name, sidebarDepth, allowLiveEdge: false,
    })
  ), {
    sessionId: SELECTED_SESSION,
    canonicalConversationId: CANONICAL_CONVERSATION_ID,
    name: depth.name,
    sidebarDepth: `${Math.round(depth.sidebarFraction * 100)}_percent`,
  });
  return { page, depth, baseline };
}

async function prepareVerifierPage(context, port) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/?session=${SELECTED_SESSION}&render_profile=1`, {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  });
  await page.waitForFunction(rows => (
    Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0) === rows
      && String(document.querySelector('.messages')?.textContent || '').includes('Temporal transcript ready')
  ), HISTORY_ROWS, { timeout: 30_000 });
  await page.locator('.messages').evaluate(list => {
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.locator('.session-list').evaluate(list => {
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await settlePaint(page, 6);
  await prepareComposerIntent(page);
  await page.locator('.messages').evaluate(list => {
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await settlePaint(page, 4);
  await page.evaluate(({ sessionId, canonicalConversationId }) => (
    window.__RAC_TEMPORAL_CANARY__.start({
      sessionId, canonicalConversationId, depth: 'live_edge_verifier', allowLiveEdge: true,
      sidebarDepth: '100_percent',
    })
  ), { sessionId: SELECTED_SESSION, canonicalConversationId: CANONICAL_CONVERSATION_ID });
  return page;
}

function analyzeDepth(raw) {
  const frames = raw.events.filter(event => event.phase === 'paint_sample');
  const baseline = raw.baseline;
  const scrollDrifts = frames.map(frame => Math.abs(frame.scroll_top - baseline.scroll_top));
  const anchorDrifts = frames
    .filter(frame => frame.anchor_key === baseline.anchor_key
      && frame.anchor_offset_px != null && baseline.anchor_offset_px != null)
    .map(frame => Math.abs(frame.anchor_offset_px - baseline.anchor_offset_px));
  const sidebarScrollDrifts = frames.map(frame => Math.abs(frame.sidebar_scroll_top - baseline.sidebar_scroll_top));
  const sidebarAnchorDrifts = frames
    .filter(frame => frame.sidebar_anchor_id === baseline.sidebar_anchor_id
      && frame.sidebar_anchor_offset_px != null && baseline.sidebar_anchor_offset_px != null)
    .map(frame => Math.abs(frame.sidebar_anchor_offset_px - baseline.sidebar_anchor_offset_px));
  const transcriptBottomGaps = frames.map(frame => Math.max(0,
    frame.scroll_height - frame.scroll_top - frame.client_height));
  const sidebarBottomGaps = frames.map(frame => Math.max(0,
    frame.sidebar_scroll_height - frame.sidebar_scroll_top - frame.sidebar_client_height));
  const values = frames.map(frame => ({ at: frame.at_epoch_ms, value: frame.scroll_top }));
  let reversalsWithinTwoSeconds = 0;
  let previousDirection = 0;
  const reversals = [];
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index].value - values[index - 1].value;
    const direction = Math.abs(delta) <= 0.5 ? 0 : Math.sign(delta);
    if (direction && previousDirection && direction !== previousDirection) {
      reversals.push(values[index].at);
      previousDirection = direction;
    } else if (direction) previousDirection = direction;
  }
  for (const at of reversals) {
    if (reversals.filter(candidate => candidate >= at - 2_000 && candidate <= at).length >= 3) {
      reversalsWithinTwoSeconds += 1;
    }
  }
  const canonicalCounts = frames.map(frame => frame.canonical_card_count);
  const promptCounts = frames.map(frame => frame.prompt_count);
  const activeSessions = new Set(frames.map(frame => frame.active_session_id));
  const intentSamples = [...frames, raw.final].filter(Boolean);
  const composerIntentChanged = intentSamples.some(frame => (
    frame.focus !== baseline.focus
    || frame.composer_draft_hash !== baseline.composer_draft_hash
    || frame.composer_draft_length !== baseline.composer_draft_length
    || frame.composer_selection_start !== baseline.composer_selection_start
    || frame.composer_selection_end !== baseline.composer_selection_end
    || frame.composer_has_focus !== baseline.composer_has_focus
  ));
  return {
    ...raw,
    max_scroll_top_drift_px: Number(Math.max(0, ...scrollDrifts).toFixed(3)),
    max_logical_anchor_drift_px: Number(Math.max(0, ...anchorDrifts).toFixed(3)),
    max_sidebar_scroll_top_drift_px: Number(Math.max(0, ...sidebarScrollDrifts).toFixed(3)),
    max_sidebar_anchor_drift_px: Number(Math.max(0, ...sidebarAnchorDrifts).toFixed(3)),
    sidebar_relative_order_changed: frames.some(frame => frame.sidebar_order_hash !== baseline.sidebar_order_hash),
    final_transcript_bottom_gap_px: Number(Math.max(0,
      raw.final.scroll_height - raw.final.scroll_top - raw.final.client_height).toFixed(3)),
    final_sidebar_bottom_gap_px: Number(Math.max(0,
      raw.final.sidebar_scroll_height - raw.final.sidebar_scroll_top - raw.final.sidebar_client_height).toFixed(3)),
    max_painted_transcript_bottom_gap_px: Number(Math.max(0, ...transcriptBottomGaps).toFixed(3)),
    max_painted_sidebar_bottom_gap_px: Number(Math.max(0, ...sidebarBottomGaps).toFixed(3)),
    direction_reversal_windows: reversalsWithinTwoSeconds,
    canonical_card_count_min: Math.min(...canonicalCounts),
    canonical_card_count_max: Math.max(...canonicalCounts),
    prompt_count_max: Math.max(0, ...promptCounts),
    active_session_ids: [...activeSessions],
    final_total_message_count: raw.final.total_message_count,
    composer_intent_changed: composerIntentChanged,
    composer_intent_baseline: {
      focus: baseline.focus,
      draft_hash: baseline.composer_draft_hash,
      draft_length: baseline.composer_draft_length,
      selection_start: baseline.composer_selection_start,
      selection_end: baseline.composer_selection_end,
      has_focus: baseline.composer_has_focus,
    },
  };
}

function temporalContractForDepth(result, allowLiveEdge = false) {
  const samples = [result.baseline, ...result.events, result.final]
    .filter(Boolean)
    .map(sample => ({
      ...sample,
      session_id: sample.session_id || result.baseline.session_id,
      canonical_conversation_id: sample.canonical_conversation_id || result.baseline.canonical_conversation_id,
      canonical_card_count: sample.canonical_card_count ?? result.baseline.canonical_card_count,
      prompt_count: sample.prompt_count ?? result.baseline.prompt_count,
      ...(allowLiveEdge && sample.phase === 'programmatic_scroll_write'
        ? { intentional_live_edge_append: true }
        : {}),
    }));
  return analyzeTemporalTrace({
    samples,
    dropped_samples: result.dropped_samples,
    truth: {
      session_id: result.baseline.session_id,
      canonical_conversation_id: result.baseline.canonical_conversation_id,
      native_prompts: [],
    },
  });
}

function compactDepthResult(result) {
  const {
    events, mutation_batches: mutationBatches, timer_baseline_details: timerBaselineDetails,
    timer_final_details: timerFinalDetails, react_commits: reactCommits,
    transcript_measurements: transcriptMeasurements, relay_frames: relayFrames, ...summary
  } = result;
  return {
    ...summary,
    retained_trace: false,
    event_count: events.length,
    mutation_batch_count: mutationBatches.length,
    relay_frame_count: relayFrames.length,
    timer_baseline_signature_count: timerBaselineDetails.length,
    timer_final_signature_count: timerFinalDetails.length,
    react_commit_count: reactCommits.length,
    transcript_measurement_count: transcriptMeasurements.length,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const sessions = fixtureSessions();
  const baseHistory = fixtureMessages();
  const settled = settledSummaryMessage();
  let history = baseHistory;
  const clientFrames = [];
  const historyRequests = [];
  const relayEvents = [];
  const sockets = new Set();
  const port = await freePort();
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{},"settings":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = relative === 'dist/bundle.js'
      ? options.bundlePath
      : path.resolve(PUBLIC_ROOT, relative);
    const allowed = relative === 'dist/bundle.js'
      ? path.resolve(filePath) === path.resolve(options.bundlePath)
      : filePath.startsWith(`${path.resolve(PUBLIC_ROOT)}${path.sep}`);
    if (!allowed || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    sockets.add(ws);
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', protocol_version: 1, heartbeat_interval_ms: 1_000,
      heartbeat_timeout_ms: 5_000, session_subscriptions: true,
      max_session_subscriptions: 128, state_epoch: 'temporal-canary', sessions, workspaces: [],
    });
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientFrames.push(message.type);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'subscribe') {
        send({ type: 'subscription_ack', protocol_version: 1, request_id: message.request_id,
          sessions: message.sessions || [], summary_only_for_others: true });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: message.session_id || message.session, capabilities: {} });
      } else if (['history_chunk_request', 'get_history', 'history_request'].includes(message.type)) {
        const sessionId = message.session_id || message.session;
        if (sessionId !== SELECTED_SESSION) return;
        historyRequests.push({ type: message.type, mode: message.mode || 'tail', at_ms: Date.now() });
        send({
          type: 'history_chunk', protocol_version: 1, session: SELECTED_SESSION,
          session_id: SELECTED_SESSION, request_id: message.request_id,
          source: 'relay_sqlite', mode: message.mode === 'older' ? 'older' : 'tail',
          replace: message.mode !== 'older', messages: message.mode === 'older' ? [] : history,
          partial: false, complete: true, total_messages: history.length, loaded_messages: history.length,
        });
      }
    });
  });

  const broadcast = (payload, producerAt = process.hrtime.bigint()) => {
    const relayAt = process.hrtime.bigint();
    const encoded = JSON.stringify(payload);
    let recipients = 0;
    for (const ws of sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(encoded);
      recipients += 1;
    }
    relayEvents.push({
      type: payload.type,
      source_message_id: payload.source_message_id || null,
      fixture_refresh_kind: payload.fixture_refresh_kind || null,
      recipients,
      producer_to_relay_ms: Number(relayAt - producerAt) / 1e6,
      relay_at_epoch_ms: Date.now(),
    });
  };

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
  const browser = await chromium.launch({
    executablePath: findChrome(), headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--js-flags=--expose-gc'],
  });
  const contexts = [];
  const pages = [];
  try {
    const createFixtureContext = async () => {
      const fixtureContext = await browser.newContext({
        viewport: { width: options.width, height: options.height },
        colorScheme: 'dark', reducedMotion: 'reduce',
      });
      contexts.push(fixtureContext);
      await fixtureContext.addInitScript(temporalInitScript);
      return fixtureContext;
    };
    for (const depth of DEPTHS) {
      const prepared = await preparePage(await createFixtureContext(), port, depth);
      pages.push(prepared);
      process.stderr.write(`TEMPORAL_READY ${depth.name} scroll=${prepared.baseline.scroll_top}\n`);
    }
    const verifierPage = await prepareVerifierPage(await createFixtureContext(), port);
    const allPages = [...pages.map(item => item.page), verifierPage];
    const cdps = await Promise.all(allPages.map(page => page.context().newCDPSession(page)));
    await Promise.all(cdps.map(cdp => cdp.send('Performance.enable')));
    await Promise.all(cdps.map(cdp => cdp.send('HeapProfiler.enable')));
    await Promise.all(cdps.map(cdp => cdp.send('HeapProfiler.collectGarbage')));
    const metricsBefore = await Promise.all(cdps.map(cdp => cdp.send('Performance.getMetrics').then(metricMap)));
    const heapBefore = await Promise.all(cdps.map(cdp => cdp.send('Runtime.getHeapUsage').then(value => value.usedSize)));

    const startedAt = Date.now();
    let tick = 0;
    let stateSeq = 0;
    let initialLiveSent = false;
    let finalLiveSent = false;
    let settledSent = false;
    let duplicateSent = false;
    let rehydrated = false;
    let reconnected = false;
    let refreshFramesSent = 0;
    let staticRefreshFramesSent = 0;
    let burstFramesSent = 0;
    let inventoryRefreshes = 0;
    const semanticTimes = options.durationMs >= 120_000
      ? {
        // The acceptance contract requires >=1,000 completely static refresh
        // frames before any semantic transition is introduced.
        initial_live_ms: 100_500,
        final_live_ms: 103_000,
        settle_ms: 106_000,
        duplicate_ms: 109_000,
        rehydrate_ms: 112_000,
        reconnect_ms: 115_000,
      }
      : {
        initial_live_ms: Math.max(500, Math.floor(options.durationMs * 0.08)),
        final_live_ms: Math.max(1_000, Math.floor(options.durationMs * 0.15)),
        settle_ms: Math.max(1_500, Math.floor(options.durationMs * 0.25)),
        duplicate_ms: Math.max(2_000, Math.floor(options.durationMs * 0.38)),
        rehydrate_ms: Math.max(2_500, Math.floor(options.durationMs * 0.48)),
        reconnect_ms: Math.max(3_000, Math.floor(options.durationMs * 0.58)),
      };
    while (Date.now() - startedAt < options.durationMs) {
      const targetAt = startedAt + tick * 100;
      const delayMs = targetAt - Date.now();
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      const elapsed = Date.now() - startedAt;
      if (!initialLiveSent && elapsed >= semanticTimes.initial_live_ms) {
        initialLiveSent = true;
        stateSeq += 1;
        broadcast({
          type: 'session_summary', protocol_version: 1, session: SELECTED_SESSION,
          activity: {
            kind: 'thinking', label: 'Examining activity summary fidelity',
            thinking: { label: 'Thinking', text: 'Examining activity summary fidelity',
              native_turn_id: 'temporal-turn-101', lifecycle_generation: 101,
              native_source_id: 'event_msg:temporal-turn-101:reasoning:0',
              source_cursor: 'temporal-cursor-100', source_surface: 'codex-desktop',
              timestamp: '2026-07-21T20:31:00.237Z' },
          },
          state_seq: stateSeq, state_epoch: 'temporal-canary',
        });
      }
      if (!finalLiveSent && elapsed >= semanticTimes.final_live_ms) {
        finalLiveSent = true;
        stateSeq += 1;
        broadcast({
          type: 'session_summary', protocol_version: 1, session: SELECTED_SESSION,
          activity: {
            kind: 'thinking', label: FINAL_SUMMARY,
            thinking: { label: 'Thinking', text: FINAL_SUMMARY,
              native_turn_id: 'temporal-turn-101', lifecycle_generation: 101,
              native_source_id: 'response_item:temporal-turn-101:reasoning',
              source_cursor: 'temporal-cursor-101', source_surface: 'codex-desktop',
              timestamp: '2026-07-21T20:31:01.237Z' },
          },
          state_seq: stateSeq, state_epoch: 'temporal-canary',
        });
      }
      if (!settledSent && elapsed >= semanticTimes.settle_ms) {
        settledSent = true;
        const producerAt = process.hrtime.bigint();
        broadcast({
          type: 'proxy_message', protocol_version: 1, session: SELECTED_SESSION,
          session_id: SELECTED_SESSION, ...settled,
        }, producerAt);
        stateSeq += 1;
        broadcast({
          type: 'session_summary', protocol_version: 1, session: SELECTED_SESSION,
          activity: { kind: 'idle', label: '' }, state_seq: stateSeq, state_epoch: 'temporal-canary',
        });
        history = [...baseHistory, settled];
      }
      if (!duplicateSent && elapsed >= semanticTimes.duplicate_ms) {
        duplicateSent = true;
        broadcast({
          type: 'proxy_message', protocol_version: 1, session: SELECTED_SESSION,
          session_id: SELECTED_SESSION, ...settled,
        });
      }
      if (!rehydrated && elapsed >= semanticTimes.rehydrate_ms) {
        rehydrated = true;
        broadcast({
          type: 'history_chunk', protocol_version: 1, session: SELECTED_SESSION,
          session_id: SELECTED_SESSION, source: 'relay_sqlite', mode: 'tail', replace: true,
          messages: history, partial: false, complete: true,
          total_messages: history.length, loaded_messages: history.length,
        });
      }
      if (!reconnected && elapsed >= semanticTimes.reconnect_ms) {
        reconnected = true;
        const expected = sockets.size;
        for (const ws of [...sockets]) ws.terminate();
        const deadline = Date.now() + 10_000;
        while (sockets.size < expected && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.strictEqual(sockets.size, expected, `only ${sockets.size}/${expected} pages reconnected`);
        broadcast({
          type: 'history_chunk', protocol_version: 1, session: SELECTED_SESSION,
          session_id: SELECTED_SESSION, source: 'relay_sqlite', mode: 'tail', replace: true,
          messages: history, partial: false, complete: true,
          total_messages: history.length, loaded_messages: history.length,
        });
      }
      const oneHz = tick % 10 === 0;
      {
        stateSeq += 1;
        const activity = settledSent
          ? { kind: 'idle', label: '' }
          : finalLiveSent
            ? { kind: 'thinking', label: FINAL_SUMMARY,
              thinking: { label: 'Thinking', text: FINAL_SUMMARY,
                native_turn_id: 'temporal-turn-101', lifecycle_generation: 101,
                native_source_id: 'response_item:temporal-turn-101:reasoning',
                source_cursor: 'temporal-cursor-101', source_surface: 'codex-desktop',
                timestamp: '2026-07-21T20:31:01.237Z' } }
            : initialLiveSent
              ? { kind: 'thinking', label: 'Examining activity summary fidelity',
                thinking: { label: 'Thinking', text: 'Examining activity summary fidelity',
                  native_turn_id: 'temporal-turn-101', lifecycle_generation: 101,
                  native_source_id: 'event_msg:temporal-turn-101:reasoning:0',
                  source_cursor: 'temporal-cursor-100', source_surface: 'codex-desktop',
                  timestamp: '2026-07-21T20:31:00.237Z' } }
              : { kind: 'idle', label: '' };
        broadcast({
          type: 'session_summary', protocol_version: 1, session: SELECTED_SESSION,
          activity, state_seq: stateSeq, state_epoch: 'temporal-canary',
          fixture_refresh_kind: 'unchanged',
        });
        refreshFramesSent += 1;
        if (!initialLiveSent) staticRefreshFramesSent += 1;
        if (!oneHz) burstFramesSent += 1;
        if (oneHz) inventoryRefreshes += 1;
      }
      tick += 1;
    }

    const stormEndedAt = Date.now();
    // Let transient reconnect/toast timers expire while the observer remains
    // armed; bounded steady state must return to its baseline after the storm.
    await new Promise(resolve => setTimeout(resolve, 3_200));

    await settlePaint(verifierPage, 4);
    await Promise.all(cdps.map(cdp => cdp.send('HeapProfiler.collectGarbage')));
    const metricsAfter = await Promise.all(cdps.map(cdp => cdp.send('Performance.getMetrics').then(metricMap)));
    const heapAfter = await Promise.all(cdps.map(cdp => cdp.send('Runtime.getHeapUsage').then(value => value.usedSize)));
    const rawDepths = await Promise.all(pages.map(item => item.page.evaluate(durationMs => (
      window.__RAC_TEMPORAL_CANARY__.stop(durationMs)
    ), options.durationMs)));
    const verifierRaw = await verifierPage.evaluate(durationMs => (
      window.__RAC_TEMPORAL_CANARY__.stop(durationMs)
    ), options.durationMs);
    const depthResults = rawDepths.map(analyzeDepth);
    const verifier = analyzeDepth(verifierRaw);
    const temporalContracts = Object.fromEntries(depthResults.map((item, index) => (
      [DEPTHS[index].name, temporalContractForDepth(item)]
    )));
    const temporalContractPass = Object.values(temporalContracts).every(contract => contract.ok);
    const summaryRows = await verifierPage.locator('.content-block-thinking-native-summary').evaluateAll(nodes => (
      nodes.map(node => ({
        text: node.textContent.trim(), role: node.getAttribute('role'),
        aria_label: node.getAttribute('aria-label'),
        source_id: node.getAttribute('data-native-source-id'),
        turn_id: node.getAttribute('data-native-turn-id'),
      }))
    ));
    const producerToRelay = relayEvents
      .filter(event => event.source_message_id === 'response_item:temporal-turn-101:reasoning')
      .slice(0, 1)
      .map(event => event.producer_to_relay_ms);
    const relayToPaint = [verifier.exact_summary_first_paint_at_ms - verifier.typed_frame_received_at_ms]
      .filter(Number.isFinite);
    const perf = metricsAfter.map((after, index) => ({
      page: index < DEPTHS.length ? DEPTHS[index].name : 'live_edge_verifier',
      main_thread_task_time_ms: Number((((after.TaskDuration || 0) - (metricsBefore[index].TaskDuration || 0)) * 1000).toFixed(3)),
      script_time_ms: Number((((after.ScriptDuration || 0) - (metricsBefore[index].ScriptDuration || 0)) * 1000).toFixed(3)),
      heap_before_bytes: heapBefore[index],
      heap_after_gc_bytes: heapAfter[index],
      heap_delta_after_gc_bytes: heapAfter[index] - heapBefore[index],
      nodes_metric_delta: Number(after.Nodes || 0) - Number(metricsBefore[index].Nodes || 0),
    }));
    const depthPass = depthResults.every(result => (
      result.max_scroll_top_drift_px <= 1
      && result.max_logical_anchor_drift_px <= 1
      && result.max_sidebar_scroll_top_drift_px <= 1
      && result.max_sidebar_anchor_drift_px <= 1
      && result.sidebar_relative_order_changed === false
      && result.composer_intent_changed === false
      && result.direction_reversal_windows === 0
      && (result.programmatic_scroll_writes_by_container?.transcript || 0) === 0
      && result.unattributed_programmatic_scroll_writes === 0
      && result.canonical_card_count_min === 1
      && result.canonical_card_count_max === 1
      && result.prompt_count_max === 0
      && result.active_session_ids.length === 1
      && result.active_session_ids[0] === SELECTED_SESSION
      && result.final_total_message_count === HISTORY_ROWS + 1
      && result.dropped_samples === 0
      && result.listener_delta <= 0
      && result.timer_delta <= 0
      && (options.durationMs < 120_000 || result.observer_cpu_percent <= 1)
      && (options.durationMs < 120_000 || result.unchanged_refresh_cache_hit_rate >= 0.9)
      && (options.durationMs < 120_000
        || result.long_tasks.filter(task => task.duration_ms > 50).length === 0)
    ));
    const maxRetainedHeapDelta = Math.max(...perf.map(item => item.heap_delta_after_gc_bytes));
    const result = {
      ok: depthPass
        && temporalContractPass
        && verifier.max_sidebar_scroll_top_drift_px <= 1
        && verifier.max_sidebar_anchor_drift_px <= 1
        && verifier.sidebar_relative_order_changed === false
        && verifier.max_painted_transcript_bottom_gap_px <= 1
        && verifier.max_painted_sidebar_bottom_gap_px <= 1
        && verifier.final_transcript_bottom_gap_px <= 1
        && verifier.final_sidebar_bottom_gap_px <= 1
        && verifier.unattributed_programmatic_scroll_writes === 0
        && verifier.composer_intent_changed === false
        && summaryRows.length === 1
        && summaryRows[0].text.includes(FINAL_SUMMARY)
        && summaryRows[0].role === 'note'
        && summaryRows[0].aria_label === 'Codex activity summary'
        && summaryRows[0].turn_id === 'temporal-turn-101'
        && producerToRelay.length === 1
        && percentile(producerToRelay, 0.95) <= 250
        && relayToPaint.length === 1
        && percentile(relayToPaint, 0.95) <= 250
        && maxRetainedHeapDelta <= 10 * 1024 * 1024
        && (options.durationMs < 120_000 || staticRefreshFramesSent >= 1_000),
      generated_at: new Date().toISOString(),
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      bundle_sha256: crypto.createHash('sha256').update(fs.readFileSync(options.bundlePath)).digest('hex'),
      acceptance_class: options.durationMs >= 120_000 ? 'canonical_120_second_temporal_matrix' : 'diagnostic_short_matrix',
      fixture: {
        sessions: SESSION_COUNT,
        selected_transcript_messages_before: HISTORY_ROWS,
        selected_transcript_messages_after: HISTORY_ROWS + 1,
        transcript_scroll_depths: [...DEPTHS.map(item => item.name), 'tail'],
        sidebar_scroll_depths_percent: [...DEPTHS.map(item => Math.round(item.sidebarFraction * 100)), 100],
        tabs: pages.length + 1,
        viewport: { width: options.width, height: options.height },
        browser: 'chromium', headless: true, visible_windows_opened: 0,
        focus_actions: 0, production_mutations: 0, protected_sessions_touched: 0,
        proxy_restarts: 0, deploys: 0,
      },
      storm: {
        requested_duration_ms: options.durationMs,
        actual_duration_ms: stormEndedAt - startedAt,
        one_hz_refreshes: inventoryRefreshes,
        ten_hz_burst_frames: burstFramesSent,
        total_refresh_frames: refreshFramesSent,
        static_refresh_frames_before_semantic: staticRefreshFramesSent,
        reconnects: reconnected ? 1 : 0,
        history_rehydrates: rehydrated ? 2 : 0,
        duplicate_settled_replays: duplicateSent ? 1 : 0,
      },
      latency: {
        event_to_relay: distribution(producerToRelay),
        relay_to_paint: distribution(relayToPaint),
        event_to_paint_p95_ms: Number((percentile(producerToRelay, 0.95) + percentile(relayToPaint, 0.95)).toFixed(3)),
        required_p95_ms: 250,
      },
      reasoning_summary: {
        expected_text: FINAL_SUMMARY,
        rendered_rows: summaryRows,
        live_replacement_observed: verifier.events.some(event => String(event.live_thinking_text || '').includes(FINAL_SUMMARY)),
        settled_once_after_duplicate_replay_rehydrate_reconnect: summaryRows.length === 1,
        encrypted_content_fields_emitted: 0,
      },
      temporal_contract: {
        ok: temporalContractPass,
        detection_classes: ['temporal_scroll_oscillation', 'false_prompt_lifecycle_oscillation', 'canonical_session_duplication'],
        depths: temporalContracts,
      },
      depths: Object.fromEntries(depthResults.map((item, index) => [DEPTHS[index].name, item])),
      live_edge_verifier: verifier,
      performance: perf,
      maximum_retained_heap_delta_bytes: maxRetainedHeapDelta,
      protocol: {
        connected_clients_at_end: sockets.size,
        history_requests: historyRequests.length,
        client_frame_types: Object.fromEntries([...new Set(clientFrames)].map(type => (
          [type, clientFrames.filter(item => item === type).length]
        ))),
      },
      budgets: {
        max_unsolicited_scroll_or_anchor_drift_px: 1,
        max_sidebar_scroll_or_anchor_drift_px: 1,
        max_direction_reversal_windows: 0,
        max_unattributed_programmatic_scroll_writes: 0,
        minimum_static_refresh_frames_before_semantic: 1_000,
        minimum_unchanged_refresh_cache_hit_rate: 0.9,
        max_observer_cpu_percent: 1,
        max_retained_heap_delta_bytes: 10 * 1024 * 1024,
        max_long_task_ms: 50,
      },
    };
    if (result.ok && !options.retainTrace) {
      result.depths = Object.fromEntries(Object.entries(result.depths).map(([name, value]) => (
        [name, compactDepthResult(value)]
      )));
      result.live_edge_verifier = compactDepthResult(result.live_edge_verifier);
    }
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assert(result.ok, 'chat stability temporal canary acceptance failed');
    return result;
  } finally {
    for (const item of pages) await item.page.close().catch(() => {});
    await Promise.all(contexts.map(fixtureContext => fixtureContext.close().catch(() => {})));
    await browser.close().catch(() => {});
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Chat stability temporal canary: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = { analyzeDepth, distribution, fixtureMessages, fixtureSessions, main, parseArgs };
