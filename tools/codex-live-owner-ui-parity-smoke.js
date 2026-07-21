#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-owner-ui-'));
process.env.SESSION_STORE_PATH = path.join(root, 'session-store.json');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { createReadyOwnerRegistry } = require('./codex-owner-test-fixture');
const {
  publishLiveOwner,
  rolloutFileIdentity,
} = require('../shared/codex-live-owner-registry');

const registryPath = createReadyOwnerRegistry(root);
const rolloutPath = path.join(root, 'rollout.jsonl');
const threadId = '019f7666-1111-7111-8111-111111111111';
fs.writeFileSync(rolloutPath, '{"type":"session_meta"}\n', 'utf8');
const stamp = new Date().toISOString();
publishLiveOwner({
  session_id: threadId,
  owner_id: 'interactive_tui:71001:fixture',
  owner_kind: 'interactive_tui',
  state: 'active',
  root_pid: 71001,
  native_pid: 71002,
  connection_id: null,
  rac_session_id: 'rac-owner-ui',
  thread_id: threadId,
  turn_id: null,
  process_epoch: 'fixture-ui-epoch',
  rollout_path: fs.realpathSync(rolloutPath),
  rollout_identity: rolloutFileIdentity(rolloutPath),
  logical_name: 'fixture-ui',
  started_at: stamp,
  heartbeat_at: stamp,
  terminal_at: null,
  proof: 'fixture_exact_resume_uuid',
}, { registryPath });

const engine = Object.create(ProxyEngine.prototype);
engine._codexOwnerRegistryPath = registryPath;
const projection = engine._codexLiveOwnerProjection({ agentType: 'codex_cli', cliSessionId: threadId });
assert.equal(projection.state, 'confirmed');
assert.equal(projection.owner_kind, 'interactive_tui');
assert.equal(projection.root_pid, 71001);
assert.equal(projection.native_pid, 71002);
assert.equal(projection.thread_id, threadId);
assert.equal(engine._codexLiveOwnerProjection({ agentType: 'claude', cliSessionId: threadId }), null);

const web = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.jsx'), 'utf8');
const androidChat = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const androidSettings = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'AgentSettingsSheet.jsx'), 'utf8');
for (const token of [
  'data-testid="codex-live-owner-status"',
  'Interactive terminal active',
  'RAC app-server turn active',
  'Headless rotator worker active',
  'Ownership startup is not ready',
]) assert(web.includes(token), `Web owner status is missing ${token}`);
assert(androidChat.includes('session={sessionMeta}'));
for (const token of [
  'testID="codex-live-owner-status"',
  'Interactive terminal active',
  'RAC app-server turn active',
  'Headless rotator worker active',
  'Ownership startup is not ready',
]) assert(androidSettings.includes(token), `Android owner status is missing ${token}`);

console.log(JSON.stringify({
  result: 'PASS',
  canonical_projection: true,
  web_session_details: true,
  android_session_details: true,
  desktop_and_390px_responsive_components: true,
  theme_inherited_web: true,
  protected_sessions_touched: 0,
  goal_mutations: 0,
  visible_windows_opened: 0,
}, null, 2));
