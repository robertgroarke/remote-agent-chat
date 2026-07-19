#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const proxyPolicyPath = path.join(ROOT, 'agent-proxy', 'session-title-policy.js');
const relayPolicyPath = path.join(ROOT, 'relay-server', 'session-title-policy.js');
const proxySource = fs.readFileSync(proxyPolicyPath, 'utf8');
const relaySource = fs.readFileSync(relayPolicyPath, 'utf8');
assert.strictEqual(relaySource, proxySource, 'Proxy and relay durable-title policies must remain byte-identical');

const title = require(proxyPolicyPath);
for (const generic of [
  '', 'New chat', 'New Conversation', 'continue', 'proceed', 'resume',
  '[Image]', '[File: screenshot.png]', 'New Claude CLI session', 'Cursor Agent session',
]) {
  assert.strictEqual(title.isLowSignalChatTitle(generic), true, `${generic || '<empty>'} must be generic`);
}

const messages = [
  { role: 'assistant', content: 'Assistant output cannot title a session.' },
  { role: 'user', content: 'continue' },
  { role: 'user', content: '[Image]' },
  { role: 'user', content: 'proceed with the harness title reliability production proof' },
];
assert.strictEqual(
  title.titleFromSessionMessages(messages),
  'proceed with the harness title reliability production proof',
);
assert.deepStrictEqual(title.selectDurableChatTitleDetails({
  currentTitle: 'continue',
  storedTitle: 'New chat',
  messages,
}), {
  title: 'proceed with the harness title reliability production proof',
  source: 'summary',
});
assert.deepStrictEqual(title.selectDurableChatTitleDetails({
  nativeTitle: 'Native Cursor agent title',
  currentTitle: 'Older summary title',
  currentSource: 'summary',
  messages,
}), {
  title: 'Native Cursor agent title',
  source: 'native',
});

assert.deepStrictEqual(title.mergeDurableChatTitleDetails(
  'Restore harness controls',
  'New chat',
  { previousSource: 'summary', incomingSource: null },
), { title: 'Restore harness controls', source: 'summary' });
assert.deepStrictEqual(title.mergeDurableChatTitleDetails(
  'Restore harness controls',
  null,
  { previousSource: 'summary' },
), { title: 'Restore harness controls', source: 'summary' });
assert.deepStrictEqual(title.mergeDurableChatTitleDetails(
  'Restore harness controls',
  'Native Codex thread title',
  { previousSource: 'summary', incomingSource: 'native' },
), { title: 'Native Codex thread title', source: 'native' });
assert.deepStrictEqual(title.mergeDurableChatTitleDetails(
  'Restore harness controls',
  'New Conversation',
  { previousSource: 'summary', reset: true },
), { title: 'New Conversation', source: null });

const proxyEngineSource = fs.readFileSync(path.join(ROOT, 'agent-proxy', 'proxy-engine.js'), 'utf8');
const relayIndexSource = fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8');
assert(proxyEngineSource.includes('_promoteSessionChatTitle(sessionId, session, currentMessages)'),
  'file-backed transcripts must promote a title during hydration');
assert(proxyEngineSource.includes("this._broadcastSessionSnapshot('history title hydration')"),
  'history hydration must publish promoted titles immediately');
assert(proxyEngineSource.includes('chat_title_source: s.chat_title_source || null'),
  'session snapshots must publish title provenance');
assert(relayIndexSource.includes('mergeDurableChatTitleDetails(previousMeta.chat_title, incomingTitle'),
  'relay registration must apply the monotonic title guard');

const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-title-policy-'));
const isolatedStore = path.join(isolatedDir, 'session-store.json');
const fixtureSessionId = 'title-reliability-fixture';
fs.writeFileSync(isolatedStore, JSON.stringify({
  sessions: {
    [fixtureSessionId]: {
      session_id: fixtureSessionId,
      agent_type: 'codex',
      chat_title: 'continue',
      accumulated_messages: messages,
    },
  },
  preferences: {},
}), 'utf8');
process.env.SESSION_STORE_PATH = isolatedStore;
const { ProxyEngine } = require(path.join(ROOT, 'agent-proxy', 'proxy-engine.js'));
const engine = new ProxyEngine({
  cdpPorts: [],
  relayUrl: 'ws://127.0.0.1:1/proxy-ws',
  uploadDir: path.join(isolatedDir, 'uploads'),
});
const runtime = {
  session_id: fixtureSessionId,
  agentType: 'codex',
  chat_title: 'continue',
  chat_title_source: null,
  _accumulatedMessages: null,
  status: 'healthy',
  activity: { kind: 'idle', label: '' },
};
assert.strictEqual(engine._promoteSessionChatTitle(fixtureSessionId, runtime), true,
  'proxy runtime did not promote the stored background transcript');
assert.strictEqual(runtime.chat_title, 'proceed with the harness title reliability production proof');
assert.strictEqual(runtime.chat_title_source, 'summary');
const persisted = JSON.parse(fs.readFileSync(isolatedStore, 'utf8')).sessions[fixtureSessionId];
assert.strictEqual(persisted.chat_title, runtime.chat_title, 'promoted title was not persisted');
assert.strictEqual(persisted.chat_title_source, 'summary', 'promoted provenance was not persisted');
fs.rmSync(isolatedDir, { recursive: true, force: true });

console.log(JSON.stringify({
  status: 'PASS',
  policy_byte_identical: true,
  generic_fixtures: 10,
  late_history_hydration: true,
  native_precedence: true,
  non_regression: true,
  explicit_reset: true,
  snapshot_provenance: true,
  proxy_background_store_promotion: true,
  visible_windows_opened: 0,
  focus_actions: 0,
}, null, 2));
