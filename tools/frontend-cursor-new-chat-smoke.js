#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const hooksPath = path.join(root, 'frontend', 'hooks.jsx');
const appPath = path.join(root, 'frontend', 'app.jsx');
const servedHooksPath = path.join(root, 'relay-server', 'public', 'hooks.jsx');
const servedAppPath = path.join(root, 'relay-server', 'public', 'app.jsx');
const bundlePath = path.join(root, 'frontend', 'dist', 'bundle.js');
const servedBundlePath = path.join(root, 'relay-server', 'public', 'dist', 'bundle.js');

const hooks = fs.readFileSync(hooksPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const servedHooks = fs.readFileSync(servedHooksPath, 'utf8');
const servedApp = fs.readFileSync(servedAppPath, 'utf8');
const bundle = fs.readFileSync(bundlePath, 'utf8');
const servedBundle = fs.readFileSync(servedBundlePath, 'utf8');

const newThreadResult = hooks.match(/if \(sid && msg\.result === 'ok' && msg\.command === 'new_thread'\) \{[\s\S]*?\n        \}/)?.[0] || '';
if (!newThreadResult.includes('clearSessionTranscript(sid)')) throw new Error('new_thread success must clear the draft transcript');
if (newThreadResult.includes('requestHistory(')) throw new Error('new_thread success must trust the authoritative proxy snapshot');

const switchThreadResult = hooks.match(/if \(sid && msg\.result === 'ok' && msg\.command === 'switch_thread'\) \{[\s\S]*?\n        \}/)?.[0] || '';
if (switchThreadResult) throw new Error('switch_thread result must not clear the authoritative proxy snapshot');

const handleNewThreadStart = app.indexOf('function handleNewThread');
const handleNewThreadEnd = app.indexOf('function handleSwitchThread', handleNewThreadStart);
const handleNewThread = handleNewThreadStart >= 0 && handleNewThreadEnd > handleNewThreadStart
  ? app.slice(handleNewThreadStart, handleNewThreadEnd)
  : '';
if (!handleNewThread.includes('newThread(sessionId)')) throw new Error('handleNewThread no longer sends the control');
if (handleNewThread.includes('requestHistory(')) throw new Error('handleNewThread must not race authoritative empty history');
const handleSwitchThreadStart = app.indexOf('function handleSwitchThread');
const handleSwitchThreadEnd = app.indexOf('function handleAntigravityV2New', handleSwitchThreadStart);
const handleSwitchThread = handleSwitchThreadStart >= 0 && handleSwitchThreadEnd > handleSwitchThreadStart
  ? app.slice(handleSwitchThreadStart, handleSwitchThreadEnd)
  : '';
if (!handleSwitchThread.includes('switchThread(sessionId, threadId)')) throw new Error('handleSwitchThread no longer sends the control');
if (handleSwitchThread.includes('requestHistory(')) throw new Error('handleSwitchThread must trust the proxy switch snapshot');
if (!app.includes('hasNativeDraftThread') || !app.includes('|| hasNativeDraftThread) return undefined')) {
  throw new Error('desktop empty-history polling must pause for a native draft thread');
}
if (!app.includes('const activeTranscriptRenderKey = React.useMemo') || !app.includes('key={activeTranscriptRenderKey}')) {
  throw new Error('desktop thread switches must remount the transcript container');
}
if (!hooks.includes('const activeCursorThreadIdentity = useRef({})')
  || !hooks.includes("cursorIdentity !== previousIdentity")
  || !hooks.includes('clearSessionTranscript(sid)')) {
  throw new Error('Cursor native UUID changes must clear stale per-session transcript state');
}
if (!hooks.includes('const pendingCursorThreadHistoryReset = useRef({})')
  || !hooks.includes('forceCursorIdentityReplace')
  || !hooks.includes('!forceCursorIdentityReplace')) {
  throw new Error('first non-empty history after a Cursor UUID change must replace stale tail metadata');
}
if (!app.includes('activeThread?.cache_key || activeThread?.id')
  || !app.includes('key={thread.cache_key || thread.id || i}')) {
  throw new Error('Cursor transcript and tab render keys must prefer the native UUID');
}

if (servedHooks !== hooks || servedApp !== app) throw new Error('served frontend sources are not synchronized');
if (servedBundle !== bundle) throw new Error('served frontend bundle is not synchronized');
if (!bundle.includes('Native new thread did not settle') && !bundle.includes('empty-store fetch')) {
  // The explanatory source comment is minified away; retain a broad bundle
  // guard that still fails before the new control-result split is built.
  const newThreadIndex = bundle.indexOf('new_thread');
  const switchThreadIndex = bundle.indexOf('switch_thread');
  if (newThreadIndex < 0 || switchThreadIndex < 0 || newThreadIndex === switchThreadIndex) {
    throw new Error('compiled bundle lacks distinct new/switch thread handling');
  }
}

console.log('PASS frontend Cursor new-chat loading regression');
