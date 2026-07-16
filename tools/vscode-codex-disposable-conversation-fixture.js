#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');
const { freshEvidencePath } = require('./evidence-path');
const {
  waitFor,
  openRelay,
  latestSessions,
  openNative,
  readNative,
  control,
  requestCodexChatList,
  settleCodexFastModeOnboarding,
} = require('./vscode-extension-production-e2e');

const args = process.argv.slice(2);
assert(args.includes('--send-live'), 'explicit --send-live is required');
const countIndex = args.indexOf('--count');
const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 3;
assert.strictEqual(count, 3, 'the acceptance fixture requires exactly three conversations');
const root = path.resolve(__dirname, '..');
const outputIndex = args.indexOf('--output');
const outputPath = path.resolve(outputIndex >= 0 && args[outputIndex + 1]
  ? args[outputIndex + 1]
  : freshEvidencePath(root, 'vscode-codex-disposable-conversations-abc.json'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function idHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function fileSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false };
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function compactConfig(config) {
  return {
    model_id: String(config?.model_id || ''),
    effort: String(config?.effort || ''),
    permission_profile: String(config?.permission_profile || ''),
    permission_mode: String(config?.permission_mode || ''),
    approval_policy: String(config?.approval_policy || ''),
    approvals_reviewer: String(config?.approvals_reviewer || ''),
    bypass_permissions_active: config?.bypass_permissions_active === true,
    conversation_scoped: config?.conversation_scoped === true,
  };
}

async function readFrameConfig(port, frame) {
  let client;
  try {
    client = await CDP({ port, target: frame.id });
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    return compactConfig(await selectors.readAgentConfig(client.Runtime, 'codex', ''));
  } finally {
    await client?.close().catch(() => {});
  }
}

async function protectedSnapshot() {
  const targets = await CDP.List({ port: 9223 });
  const frames = targets.filter(target => target?.type === 'iframe'
    && /[?&]extensionId=openai\.chatgpt(?:&|$)/i.test(String(target.url || '')));
  const configs = [];
  for (const frame of frames) {
    configs.push({ target_hash: idHash(frame.id), config: await readFrameConfig(9223, frame) });
  }
  return {
    target_hashes: targets.map(target => idHash(target.id)).sort(),
    configs: configs.sort((left, right) => left.target_hash.localeCompare(right.target_hash)),
  };
}

async function currentConfig(native) {
  return compactConfig(await selectors.readAgentConfig(native.client.Runtime, 'codex', guard.WORKSPACE_PATH));
}

async function sendExactTurn(relay, native, sessionId, token) {
  await settleCodexFastModeOnboarding(native);
  const clientMessageId = `vscode-codex-fixture-${crypto.randomBytes(6).toString('hex')}`;
  const startedAt = Date.now();
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type: 'send',
    session: sessionId,
    content: `Reply with exactly ${token} and nothing else.`,
    client_message_id: clientMessageId,
  }));
  const delivery = await waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'proxy_send_result'
      && message.client_message_id === clientMessageId),
    60000,
    `delivery for ${token}`,
    25
  );
  assert.strictEqual(delivery.result, 'delivered', `send was not delivered: ${JSON.stringify(delivery)}`);
  await waitFor(async () => {
    const state = await readNative(native, 'codex', sessionId);
    return state.messages.some(message => message.role === 'user' && String(message.content || '').includes(token));
  }, 60000, `native user echo for ${token}`, 100);
  const settled = await waitFor(async () => {
    const state = await readNative(native, 'codex', sessionId);
    const exact = state.messages.find(message => message.role === 'assistant'
      && String(message.content || '').trim() === token);
    return exact && !state.thinking?.thinking ? state : null;
  }, 300000, `exact native assistant reply for ${token}`, 100);
  await settleCodexFastModeOnboarding(native);
  return {
    client_message_id: clientMessageId,
    delivery_result: delivery.result,
    assistant_exact: true,
    elapsed_ms: Date.now() - startedAt,
    message_count: settled.messages.length,
  };
}

function writeResult(result) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main() {
  const settingsPath = guard.assertUpdatesDisabled('VS Code Codex disposable conversation fixture');
  assert.strictEqual(guard.CDP_PORT, 9230, 'conversation fixture is restricted to disposable port 9230');
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
  const filesBefore = {
    codex_config: fileSnapshot(configPath),
    vscode_settings: fileSnapshot(settingsPath),
  };
  const protectedBefore = await protectedSnapshot();
  const native = await openNative('codex');
  const relay = await openRelay();
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    port: 9230,
    workspace_path: guard.WORKSPACE_PATH,
    frame_hash: idHash(native.frame.id),
    conversations: [],
    files_before: filesBefore,
    protected_before: protectedBefore,
    sends: 0,
    controls: 0,
    page_reloads: 0,
    explicit_focus_api_calls: 0,
    visible_windows_opened: 0,
  };
  try {
    const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
    let store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const session = await waitFor(() => {
      store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      return guard.pickSessionForFrame(latestSessions(relay.messages), 'codex', store, native.frame);
    }, 30000, 'guarded disposable Codex relay session');
    guard.assertStoreBinding(store, session, native.frame);
    const sessionId = session.session_id;
    result.session_id = sessionId;
    result.session_id_hash = idHash(sessionId);

    const baselineChats = await requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex fixture baseline');
    result.controls += 1;
    const baselineIds = new Set(baselineChats.map(chat => chat?.id).filter(Boolean));
    result.baseline_chat_count = baselineIds.size;
    const createdIds = new Set();

    for (let index = 0; index < count; index++) {
      const label = String.fromCharCode(65 + index);
      const token = `RAC_CODEX_SCOPE_${label}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      await control(relay.ws, relay.messages, sessionId, 'new_chat');
      result.controls += 1;
      const blank = await waitFor(async () => {
        const state = await readNative(native, 'codex', sessionId);
        const config = await currentConfig(native);
        return state.messages.length === 0 && config.conversation_scoped === false ? { state, config } : null;
      }, 30000, `blank draft ${label}`);

      const turn = await sendExactTurn(relay, native, sessionId, token);
      result.sends += 1;
      const scopedConfig = await waitFor(async () => {
        const config = await currentConfig(native);
        return config.conversation_scoped ? config : null;
      }, 30000, `conversation-scoped config ${label}`);
      const chats = await requestCodexChatList(relay.ws, relay.messages, sessionId, `Codex fixture ${label}`);
      result.controls += 1;
      const newCandidates = chats.filter(chat => chat?.id
        && !baselineIds.has(chat.id)
        && !createdIds.has(chat.id));
      assert.strictEqual(newCandidates.length, 1,
        `conversation ${label} did not produce exactly one new native ID: ${JSON.stringify(newCandidates)}`);
      const created = newCandidates[0];
      createdIds.add(created.id);
      // A just-completed Codex task can appear transiently in the list before
      // its durable history entry settles. Wait, re-read from list view, and
      // require the same UUID before creating the next task.
      await sleep(4000);
      const durableChats = await requestCodexChatList(relay.ws, relay.messages, sessionId, `Codex fixture ${label} durable`);
      result.controls += 1;
      assert(durableChats.some(chat => chat?.id === created.id),
        `conversation ${label} UUID was not durable after settlement: ${created.id}`);
      result.conversations.push({
        label,
        chat_id: created.id,
        chat_id_hash: idHash(created.id),
        title: created.title || created.name || '',
        token,
        blank_draft_config: blank.config,
        scoped_config: scopedConfig,
        turn,
        durable_after_settlement: true,
      });
    }

    await sleep(4000);
    const finalChats = await requestCodexChatList(relay.ws, relay.messages, sessionId, 'Codex fixture A/B/C durable');
    result.controls += 1;
    const missingFinal = result.conversations.filter(conversation =>
      !finalChats.some(chat => chat?.id === conversation.chat_id));
    assert.strictEqual(missingFinal.length, 0,
      `durable A/B/C list lost conversations: ${JSON.stringify(missingFinal.map(item => item.label))}`);

    for (const conversation of result.conversations) {
      await control(relay.ws, relay.messages, sessionId, 'switch_chat', { chat_id: conversation.chat_id });
      result.controls += 1;
      await waitFor(async () => {
        const state = await readNative(native, 'codex', sessionId);
        return state.messages.some(message => String(message.content || '').includes(conversation.token))
          && !(state.thinking?.thinking) ? state : null;
      }, 30000, `conversation ${conversation.label} durable switch`);
    }
    const active = result.conversations[result.conversations.length - 1];
    result.active_conversation = active.label;
    result.active_chat_id_hash = active.chat_id_hash;

    const filesAfter = {
      codex_config: fileSnapshot(configPath),
      vscode_settings: fileSnapshot(settingsPath),
    };
    assert.deepStrictEqual(filesAfter, filesBefore, 'conversation fixture changed global config or VS Code settings');
    const protectedAfter = await protectedSnapshot();
    assert.deepStrictEqual(protectedAfter, protectedBefore, 'conversation fixture changed protected 9223 state');
    result.files_after = filesAfter;
    result.protected_after = protectedAfter;
    result.global_files_unchanged = true;
    result.protected_target_and_config_state_unchanged = true;
    result.exact_conversation_count = result.conversations.length;
    result.ok = true;
    writeResult(result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    result.error = error.stack || error.message;
    try { result.files_after_failure = {
      codex_config: fileSnapshot(configPath),
      vscode_settings: fileSnapshot(settingsPath),
    }; } catch {}
    writeResult(result);
    throw error;
  } finally {
    try { relay.ws.close(); } catch {}
    await native.client.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`VS Code Codex disposable conversation fixture: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
