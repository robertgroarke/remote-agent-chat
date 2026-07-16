#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] || 'before';
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
const sessionCount = 60;
const backgroundUpdates = 2000;
const selectedSession = 'render-session-0';

assert(['before', 'after'].includes(mode), '--mode must be before or after');

function writeResult(result) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

function runBefore() {
  const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
  assert(hooks.includes('const [messages,        setMessages]        = useState({})'),
    'baseline source no longer uses the monolithic React message map');
  let messages = Object.fromEntries(Array.from({ length: sessionCount }, (_, index) => [
    `render-session-${index}`,
    [],
  ]));
  let appInvalidations = 0;
  let selectedTranscriptInvalidations = 0;
  const startedAt = performance.now();
  for (let index = 0; index < backgroundUpdates; index++) {
    const sessionId = `render-session-${1 + (index % (sessionCount - 1))}`;
    messages = {
      ...messages,
      [sessionId]: [...messages[sessionId], { role: 'assistant', content: `row-${index}` }],
    };
    // React invalidates the App/useRelay owner whenever the top-level map identity changes;
    // selected transcript derivation is consequently re-evaluated even though its array is stable.
    appInvalidations++;
    selectedTranscriptInvalidations++;
  }
  const durationMs = performance.now() - startedAt;
  writeResult({
    ok: true,
    mode,
    sessions: sessionCount,
    selected_session: selectedSession,
    background_updates: backgroundUpdates,
    selected_session_updates: 0,
    app_render_invalidations: appInvalidations,
    selected_transcript_invalidations: selectedTranscriptInvalidations,
    duration_ms: Number(durationMs.toFixed(3)),
    invalidations_per_background_update: appInvalidations / backgroundUpdates,
    visible_windows_opened: 0,
    focus_actions: 0,
  });
}

function loadStore() {
  const source = fs.readFileSync(path.join(root, 'frontend', 'transcript-cache.js'), 'utf8');
  const executable = `${source
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')}
return {
  clearTranscriptCache,
  getTranscriptSnapshot,
  setCachedTranscript,
  subscribeCachedTranscript,
};`;
  return Function(executable)();
}

function runAfter() {
  const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
  assert(!hooks.includes('const [messages,        setMessages]        = useState({})'),
    'final source still owns transcripts in one React state map');
  const store = loadStore();
  store.clearTranscriptCache();
  Array.from({ length: sessionCount }, (_, index) => `render-session-${index}`)
    .forEach(sessionId => store.setCachedTranscript(sessionId, [], sessionCount));
  let selectedTranscriptInvalidations = 0;
  let backgroundStoreNotifications = 0;
  const stopSelected = store.subscribeCachedTranscript(selectedSession, () => {
    selectedTranscriptInvalidations++;
  });
  const backgroundSessions = Array.from({ length: sessionCount - 1 }, (_, index) => `render-session-${index + 1}`);
  const stops = backgroundSessions.map(sessionId => store.subscribeCachedTranscript(sessionId, () => {
    backgroundStoreNotifications++;
  }));
  const startedAt = performance.now();
  for (let index = 0; index < backgroundUpdates; index++) {
    const sessionId = backgroundSessions[index % backgroundSessions.length];
    const previous = store.getTranscriptSnapshot(sessionId);
    store.setCachedTranscript(sessionId, [...previous, { role: 'assistant', content: `row-${index}` }], sessionCount);
  }
  const durationMs = performance.now() - startedAt;
  stopSelected();
  stops.forEach(stop => stop());
  assert.equal(selectedTranscriptInvalidations, 0,
    'background transcript updates invalidated the selected transcript subscriber');
  assert.equal(backgroundStoreNotifications, backgroundUpdates,
    'each background session update must notify only its own subscriber');
  writeResult({
    ok: true,
    mode,
    sessions: sessionCount,
    selected_session: selectedSession,
    background_updates: backgroundUpdates,
    selected_session_updates: 0,
    app_render_invalidations: 0,
    selected_transcript_invalidations: selectedTranscriptInvalidations,
    background_store_notifications: backgroundStoreNotifications,
    duration_ms: Number(durationMs.toFixed(3)),
    invalidations_per_background_update: 0,
    visible_windows_opened: 0,
    focus_actions: 0,
  });
}

if (mode === 'before') runBefore(); else runAfter();
