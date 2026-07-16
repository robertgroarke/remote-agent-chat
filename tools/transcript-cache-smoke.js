#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webModulePath = path.join(root, 'frontend', 'transcript-cache.js');
const androidModulePath = path.join(root, 'android-app', 'lib', 'transcript-cache.js');
const webTimePath = path.join(root, 'frontend', 'message-time.js');
const androidTimePath = path.join(root, 'android-app', 'lib', 'message-time.js');
const webSource = fs.readFileSync(webModulePath, 'utf8');
const androidSource = fs.readFileSync(androidModulePath, 'utf8');
const webTimeSource = fs.readFileSync(webTimePath, 'utf8');
const androidTimeSource = fs.readFileSync(androidTimePath, 'utf8');
assert.strictEqual(androidSource, webSource, 'web and Android transcript caches must remain byte-identical');
assert.strictEqual(androidTimeSource, webTimeSource, 'web and Android timestamp normalization must remain byte-identical');

function loadCache(source, timeSource) {
  const executable = `${timeSource
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')}
${source
    .replace(/^import[^\n]+\n/mg, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')}
return {
  TRANSCRIPT_CACHE_LIMIT,
  appendCachedTranscript,
  cachedTranscriptSessionIds,
  clearTranscriptCache,
  getCachedTranscript,
  getTranscriptSnapshot,
  isTranscriptActivityLive,
  latestTranscriptSequence,
  mergeCachedTranscript,
  mergeTranscriptMessages,
  setCachedTranscript,
  subscribeCachedTranscript,
  transcriptStoreView,
  updateTranscriptStore,
  messageInstant,
  normalizeMessageTimestamp,
  normalizeTranscriptTimestamps,
  parseMessageInstant,
};`;
  return Function(executable)();
}

const cache = loadCache(webSource, webTimeSource);
assert.strictEqual(cache.TRANSCRIPT_CACHE_LIMIT, 10);
cache.clearTranscriptCache();
for (let index = 1; index <= 11; index += 1) {
  cache.setCachedTranscript(`session-${index}`, [{ sequence: index, role: 'assistant', content: `row ${index}` }]);
}
assert.deepStrictEqual(cache.cachedTranscriptSessionIds(), [
  'session-2', 'session-3', 'session-4', 'session-5', 'session-6',
  'session-7', 'session-8', 'session-9', 'session-10', 'session-11',
]);
assert.strictEqual(cache.getCachedTranscript('session-2')[0].content, 'row 2');
cache.setCachedTranscript('session-12', [{ sequence: 12, role: 'assistant', content: 'row 12' }]);
assert(!cache.cachedTranscriptSessionIds().includes('session-3'), 'least-recently used transcript must be evicted');
assert(cache.cachedTranscriptSessionIds().includes('session-2'), 'cache read must refresh recency');

const merged = cache.mergeTranscriptMessages(
  [{ sequence: 1, role: 'assistant', content: 'old' }],
  [
    { sequence: 1, role: 'assistant', content: 'settled' },
    { sequence: 2, role: 'assistant', content: 'next' },
  ],
);
assert.deepStrictEqual(merged.map(message => message.content), ['settled', 'next']);
const distinctIdentical = cache.mergeTranscriptMessages([], [
  { source_message_id: 'native-answer-1', role: 'assistant', ts: 1, content: 'identical answer' },
  { source_message_id: 'native-answer-2', role: 'assistant', ts: 1, content: 'identical answer' },
]);
assert.deepStrictEqual(distinctIdentical.map(message => message.source_message_id), [
  'native-answer-1', 'native-answer-2',
], 'distinct identical native answers must remain separate cache rows');
const replayedNative = cache.mergeTranscriptMessages(distinctIdentical, [
  { source_message_id: 'native-answer-1', role: 'assistant', ts: 1, content: 'identical answer' },
]);
assert.strictEqual(replayedNative.length, 2, 'replayed native source IDs must merge idempotently');
cache.mergeCachedTranscript('merge-session', merged, { replace: true });
cache.appendCachedTranscript('merge-session', { sequence: 3, role: 'assistant', content: 'tail' });
assert.deepStrictEqual(cache.getCachedTranscript('merge-session').map(message => message.sequence), [1, 2, 3]);
assert.strictEqual(cache.latestTranscriptSequence(cache.getCachedTranscript('merge-session')), 3);
assert.strictEqual(cache.latestTranscriptSequence([{ sequence: '7' }, { content: 'no sequence' }]), 7);

const normalizedTime = cache.normalizeMessageTimestamp({
  created_at: '2026-11-01T09:30:00.000Z',
  timestamp: '2026-11-01T08:30:00.000Z',
  ts: 1,
});
assert.strictEqual(normalizedTime.timestamp, '2026-11-01T09:30:00.000Z', 'producer created_at must win normalization');
assert.strictEqual(normalizedTime.timestamp_ms, 1793525400000);
assert.strictEqual(normalizedTime.ts, 1793525400);
const missingTime = { role: 'assistant', content: 'legacy missing timestamp' };
assert.strictEqual(cache.normalizeMessageTimestamp(missingTime), missingTime, 'missing legacy timestamps must remain unknown');
const malformedTime = { role: 'assistant', timestamp: 'not-a-date' };
assert.strictEqual(cache.normalizeMessageTimestamp(malformedTime), malformedTime, 'malformed timestamps must remain unknown');
const repeatedHour = [
  cache.parseMessageInstant('2026-11-01T01:30:00-07:00'),
  cache.parseMessageInstant('2026-11-01T01:30:00-08:00'),
];
assert.strictEqual(repeatedHour[1].epoch_ms - repeatedHour[0].epoch_ms, 60 * 60 * 1000,
  'DST repeated-hour instants must remain distinct');

cache.clearTranscriptCache();
cache.setCachedTranscript('selected', []);
let selectedNotifications = 0;
const unsubscribeSelected = cache.subscribeCachedTranscript('selected', () => {
  selectedNotifications += 1;
});
cache.setCachedTranscript('background', [{ sequence: 1, role: 'assistant', content: 'background' }]);
assert.strictEqual(selectedNotifications, 0, 'background transcript writes must not notify the selected transcript');
cache.updateTranscriptStore(previous => ({
  ...previous,
  selected: [{ sequence: 1, role: 'assistant', content: 'selected' }],
}));
assert.strictEqual(selectedNotifications, 1, 'selected transcript writes must notify exactly its subscriber');
assert.strictEqual(cache.getTranscriptSnapshot('selected')[0].content, 'selected');
assert.strictEqual(cache.transcriptStoreView.selected[0].content, 'selected');
unsubscribeSelected();

assert.strictEqual(cache.isTranscriptActivityLive({ kind: 'generating' }), true);
assert.strictEqual(cache.isTranscriptActivityLive({ kind: 'running_command' }), true);
assert.strictEqual(cache.isTranscriptActivityLive({ kind: 'idle', generating: true }), true);
assert.strictEqual(cache.isTranscriptActivityLive({ kind: 'idle' }), false);
assert.strictEqual(cache.isTranscriptActivityLive({ kind: 'waiting_for_user' }), false);
assert.strictEqual(cache.isTranscriptActivityLive(null, true), true);

const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const androidChat = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const androidList = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const androidRelay = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'frontend', 'build.js'), 'utf8');
assert(hooks.includes('restoreCachedTranscript') && hooks.includes('updateTranscriptStore'),
  'web relay state must expose cached restore through the external transcript store');
assert(app.includes('React.useSyncExternalStore') && app.includes('subscribeCachedTranscript'),
  'web app must subscribe only to the selected transcript snapshot');
assert(app.indexOf('restoreCachedTranscript(id);') < app.indexOf('setActiveSession(id);'),
  'web session selection must restore cache before selecting');
assert(!app.includes('activeTranscriptPrefetchIds') && !app.includes('prefetchActiveTails'),
  'web must not prefetch or poll background transcript tails');
assert(!app.includes('setInterval(() => requestHistory(activeSession'),
  'web must not poll the selected desktop transcript after its bounded selection hydrate');
assert(app.includes('setSessionSubscriptions(activeSession ? [activeSession] : [])'),
  'web must subscribe only the selected transcript');
assert(androidChat.includes('useState(() => getCachedTranscript(sessionId) || [])'),
  'Android chat must initialize from cached transcript state');
assert(androidChat.includes('setCachedTranscript(sessionId, messages)'),
  'Android chat must retain transcript updates in the shared cache');
assert(!androidList.includes('appendCachedTranscript(msgSid, msg)')
  && !androidList.includes('prefetchActiveTails')
  && !androidList.includes('activeTranscriptPrefetchIds'),
  'Android session list must not hydrate or poll background transcripts');
assert(androidList.includes('client.setSessionSubscriptions([])'),
  'Android list route must explicitly request summary-only background traffic');
assert(hooks.includes('setSessionSubscriptions') && hooks.includes("t === 'session_summary'"),
  'web relay state must subscribe the selected session and consume summaries elsewhere');
assert(app.includes('setSessionSubscriptions(activeSession ? [activeSession] : [])'),
  'web must isolate full fidelity to the selected transcript');
assert(androidRelay.includes('setSessionSubscriptions(sessionIds)') && androidRelay.includes("type: 'subscribe'"),
  'Android relay client must persist and resend session subscriptions');
assert(androidList.includes('client.setSessionSubscriptions([])')
  && androidList.includes("case 'session_summary':"),
  'Android session list must consume summaries without full transcript subscriptions');
assert(androidChat.includes('client.setSessionSubscriptions([sessionId])'),
  'Android chat must subscribe its selected transcript before connecting');
assert(build.includes("'transcript-cache.js'"), 'frontend build must sync the source cache to relay public assets');
assert(build.includes("'message-time.js'"), 'frontend build must sync shared timestamp normalization to relay public assets');

console.log(JSON.stringify({
  ok: true,
  clients: ['web', 'android'],
  cache_limit: cache.TRANSCRIPT_CACHE_LIMIT,
  lru_touch_and_evict: true,
  merge_and_dedupe: true,
  source_identity_preserves_distinct_identical_rows: true,
  timestamp_normalization_shared: true,
  missing_timestamp_not_fabricated: true,
  dst_repeated_hour_distinct: true,
  immediate_cached_restore: true,
  active_tail_prefetch: false,
  zero_background_history_requests: true,
  selective_session_subscription: true,
  background_session_summaries: true,
  selected_transcript_subscription_isolation: true,
}, null, 2));
