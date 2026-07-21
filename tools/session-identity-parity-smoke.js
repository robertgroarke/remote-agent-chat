#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.resolve(__dirname, '..');
const ALIAS_ID = process.env.RAC_IDENTITY_ALIAS_SESSION_ID || 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CANONICAL_ID = process.env.RAC_IDENTITY_CANONICAL_SESSION_ID || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function loadBundled(relativePath, name, plugins = []) {
  const filename = path.join(ROOT, relativePath);
  const build = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    plugins,
  });
  const loaded = new Module(name, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(build.outputFiles[0].text, filename);
  return loaded.exports;
}

const authStub = {
  name: 'auth-stub',
  setup(build) {
    build.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth-stub', namespace: 'identity-smoke' }));
    build.onLoad({ filter: /.*/, namespace: 'identity-smoke' }, () => ({
      contents: 'export async function getStoredJwt(){ return "fixture"; } export const RELAY_URL="https://relay.invalid";',
      loader: 'js',
    }));
  },
};

async function main() {
  const { RelayClient } = await loadBundled('android-app/lib/relay.js', 'android-relay-identity-smoke', [authStub]);
  const transcript = await loadBundled('android-app/lib/transcript-cache.js', 'android-transcript-identity-smoke');
  const sent = [];
  global.WebSocket = { OPEN: 1 };
  const client = new RelayClient(() => {});
  client.ws = { readyState: 1, send: value => sent.push(JSON.parse(value)) };
  client.setSessionSubscriptions([ALIAS_ID]);
  assert.strictEqual(client._applySessionAlias({
    alias_session_id: ALIAS_ID,
    canonical_session_id: CANONICAL_ID,
    generation: 2,
  }), true);
  client.sendMessage(ALIAS_ID, 'fixture', 'fixture-message');
  assert.strictEqual(sent.at(-1).session, CANONICAL_ID);
  assert.deepStrictEqual(client._sessionSubscriptions, [CANONICAL_ID]);
  const snapshot = client._canonicalizeSessionMessage({
    type: 'session_list',
    sessions: [
      { session_id: ALIAS_ID, title: 'archive alias' },
      { session_id: CANONICAL_ID, title: 'canonical live row' },
    ],
    session_health: { [ALIAS_ID]: 'disconnected', [CANONICAL_ID]: 'healthy' },
  });
  assert.strictEqual(snapshot.sessions.length, 1);
  assert.strictEqual(snapshot.sessions[0].session_id, CANONICAL_ID);
  assert.strictEqual(snapshot.sessions[0].title, 'canonical live row');
  assert.deepStrictEqual(snapshot.session_health, { [CANONICAL_ID]: 'healthy' });

  transcript.clearTranscriptCache();
  transcript.setCachedTranscript(ALIAS_ID, [
    { source_message_id: 'native-1', role: 'assistant', content: 'alias history', sequence: 1 },
  ]);
  transcript.setCachedTranscript(CANONICAL_ID, [
    { source_message_id: 'native-1', role: 'assistant', content: 'canonical history', sequence: 1 },
    { source_message_id: 'native-2', role: 'assistant', content: 'canonical second', sequence: 2 },
  ]);
  const migrated = transcript.migrateCachedTranscript(ALIAS_ID, CANONICAL_ID);
  assert.strictEqual(migrated.length, 2);
  assert.strictEqual(transcript.hasCachedTranscript(ALIAS_ID), false);
  assert.strictEqual(transcript.getCachedTranscript(CANONICAL_ID)[0].content, 'alias history');

  const sources = Object.fromEntries([
    'frontend/hooks.jsx',
    'frontend/app.jsx',
    'android-app/screens/SessionListScreen.jsx',
    'android-app/screens/ChatScreen.jsx',
  ].map(relative => [relative, fs.readFileSync(path.join(ROOT, relative), 'utf8')]));
  for (const relative of [
    'frontend/hooks.jsx',
    'android-app/screens/SessionListScreen.jsx',
    'android-app/screens/ChatScreen.jsx',
  ]) assert(sources[relative].includes('session_alias_reconciled'), `${relative} does not reconcile canonical aliases`);
  assert(sources['frontend/app.jsx'].includes('sessionAliases'));
  assert(sources['frontend/app.jsx'].includes('scrollSnapshotRef.current = { ...scrollSnapshotRef.current, sessionId: canonicalId }'));
  assert(sources['frontend/app.jsx'].includes('routeScrollSnapshotRef.current = { ...routeScrollSnapshotRef.current, sessionId: canonicalId }'));
  assert(sources['android-app/screens/ChatScreen.jsx'].includes('AsyncStorage.removeItem(aliasDraftKey)'));
  assert(sources['android-app/screens/SessionListScreen.jsx'].includes('setBroadcastSelectedIds'));

  console.log(JSON.stringify({
    ok: true,
    alias_session_id: ALIAS_ID,
    canonical_session_id: CANONICAL_ID,
    android_outgoing_canonicalized: true,
    android_snapshot_rows: snapshot.sessions.length,
    android_transcript_messages: migrated.length,
    web_scroll_identity_preserved: true,
    web_android_surfaces: Object.keys(sources).length,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
