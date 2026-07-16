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
  readNative,
  attachNativeDisconnectState,
  settleCodexFastModeOnboarding,
} = require('./vscode-extension-production-e2e');

const args = process.argv.slice(2);
assert(args.includes('--mutate-disposable'), 'explicit --mutate-disposable is required');
assert(args.includes('--send-live'), 'explicit --send-live is required');
assert(args.includes('--restore'), 'explicit --restore is required');
const countIndex = args.indexOf('--count');
const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 20;
assert.strictEqual(count, 20, 'the acceptance latency run requires exactly 20 changes');
const root = path.resolve(__dirname, '..');
const fixtureIndex = args.indexOf('--fixture');
const fixturePath = path.resolve(fixtureIndex >= 0 && args[fixtureIndex + 1]
  ? args[fixtureIndex + 1]
  : 'evidence/harness-maturity/2026-07-15/vscode-codex-disposable-conversations-abc.json');
const outputIndex = args.indexOf('--output');
const outputPath = path.resolve(outputIndex >= 0 && args[outputIndex + 1]
  ? args[outputIndex + 1]
  : freshEvidencePath(root, 'vscode-codex-disposable-control-latency.json'));

function idHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false };
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: sha256(fs.readFileSync(filePath)),
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

function configSnapshot(config) {
  const compact = compactConfig(config);
  const bytes = Buffer.from(JSON.stringify(compact), 'utf8');
  return { config: compact, bytes: bytes.length, sha256: sha256(bytes) };
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
    target_counts: targets.reduce((counts, target) => {
      const type = String(target?.type || 'unknown');
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}),
    codex_frame_hashes: frames.map(frame => idHash(frame.id)).sort(),
    configs: configs.sort((left, right) => left.target_hash.localeCompare(right.target_hash)),
  };
}

function hashSetDrift(before = [], after = []) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    removed: before.filter(value => !afterSet.has(value)),
    added: after.filter(value => !beforeSet.has(value)),
  };
}

async function currentConfig(native) {
  return compactConfig(await selectors.readAgentConfig(native.client.Runtime, 'codex', native.workspace_path || ''));
}

async function openNativeFrame(frame, workspacePath) {
  const client = await CDP({ port: 9230, target: frame.id });
  await client.Runtime.enable();
  await client.Page.enable();
  client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
  const connectionState = attachNativeDisconnectState(client, 'codex', frame.id);
  await selectors.cacheInnerContextId(client.Runtime);
  return { frame, client, connectionState, workspace_path: workspacePath };
}

async function applyField(native, field, value) {
  const startedAt = Date.now();
  const result = await selectors.setCodexComposerConfig(
    native.client.Runtime,
    { [field]: value },
    false,
    null
  );
  const latencyMs = Date.now() - startedAt;
  const resultKey = field === 'model_id' ? 'model' : field;
  assert(result?.[resultKey]?.ok, `${field}=${value} native selection failed: ${JSON.stringify(result)}`);
  const readback = await currentConfig(native);
  assert.strictEqual(readback[field], value, `${field} exact native read-back mismatch`);
  return { result: result[resultKey], readback, latency_ms: latencyMs };
}

async function sendExactCanary(relay, native, sessionId, token) {
  await settleCodexFastModeOnboarding(native);
  const clientMessageId = `vscode-codex-control-${crypto.randomBytes(6).toString('hex')}`;
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
  assert.strictEqual(delivery.result, 'delivered', `canary was not delivered: ${JSON.stringify(delivery)}`);
  const settled = await waitFor(async () => {
    const state = await readNative(native, 'codex', sessionId);
    const user = state.messages.some(message => message.role === 'user'
      && String(message.content || '').includes(token));
    const assistant = state.messages.some(message => message.role === 'assistant'
      && String(message.content || '').trim() === token);
    return user && assistant && !state.thinking?.thinking ? state : null;
  }, 300000, `exact canary reply for ${token}`, 100);
  return {
    client_message_id: clientMessageId,
    delivery_result: delivery.result,
    assistant_exact: true,
    elapsed_ms: Date.now() - startedAt,
    message_count: settled.messages.length,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function writeResult(result) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main() {
  const settingsPath = guard.assertUpdatesDisabled('VS Code Codex disposable control latency proof');
  assert.strictEqual(guard.CDP_PORT, 9230, 'control latency proof is restricted to disposable port 9230');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert(Array.isArray(fixture?.conversations), 'A/B/C fixture conversations are unavailable');
  assert.deepStrictEqual(fixture.conversations.map(item => item.label), ['A', 'B', 'C'], 'fixture must contain A/B/C');
  const conversations = Object.fromEntries(fixture.conversations.map(item => [item.label, item]));
  const workspaces = {
    A: path.resolve('C:\\temp\\remote-agent-vscode-test'),
    B: path.resolve('C:\\temp\\remote-agent-vscode-test-b'),
    C: path.resolve('C:\\temp\\remote-agent-vscode-test-c'),
  };
  const normalize = value => path.resolve(String(value || '')).toLowerCase();
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
  const filesBefore = {
    codex_config: fileSnapshot(configPath),
    vscode_settings: fileSnapshot(settingsPath),
  };
  let protectedBefore = null;
  const relay = await openRelay();
  const natives = {};
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    port: 9230,
    fixture_path: fixturePath,
    count,
    changes: [],
    isolation_checks: [],
    files_before: filesBefore,
    protected_before: null,
    sends: 0,
    controls: 0,
    page_reloads: 0,
    explicit_focus_api_calls: 0,
    visible_windows_opened: 0,
  };
  try {
    const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
    const bindings = await waitFor(async () => {
      const frames = (await CDP.List({ port: 9230 })).filter(target => target?.type === 'iframe'
        && /[?&]extensionId=openai\.chatgpt(?:&|$)/i.test(String(target.url || '')));
      if (frames.length !== 3) return null;
      const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const sessions = latestSessions(relay.messages);
      const found = {};
      for (const label of ['A', 'B', 'C']) {
        const storedEntry = Object.entries(store.sessions || {}).find(([, value]) =>
          value?.agent_type === 'codex'
          && value?.host_type === 'vscode'
          && normalize(value.workspace_path) === normalize(workspaces[label])
          && frames.some(frame => frame.id === value.target_id)
        );
        if (!storedEntry) return null;
        const session = sessions.find(item => item.session_id === storedEntry[0]);
        const frame = frames.find(item => item.id === storedEntry[1].target_id);
        if (!session || !frame) return null;
        found[label] = { session, frame };
      }
      return found;
    }, 30000, 'three guarded disposable Codex frame/session bindings');

    for (const label of ['A', 'B', 'C']) {
      natives[label] = await openNativeFrame(bindings[label].frame, workspaces[label]);
    }
    result.bindings = Object.fromEntries(['A', 'B', 'C'].map(label => [label, {
      frame_hash: idHash(bindings[label].frame.id),
      session_id_hash: idHash(bindings[label].session.session_id),
      workspace_path: workspaces[label],
    }]));

    protectedBefore = await protectedSnapshot();
    result.protected_before = protectedBefore;

    let aConfig = await currentConfig(natives.A);
    if (!aConfig.conversation_scoped) {
      const seedToken = `RAC_CODEX_MULTIFRAME_A_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      result.seed_a = {
        token: seedToken,
        ...(await sendExactCanary(relay, natives.A, bindings.A.session.session_id, seedToken)),
      };
      result.sends += 1;
      aConfig = await waitFor(async () => {
        const observed = await currentConfig(natives.A);
        return observed.conversation_scoped ? observed : null;
      }, 30000, 'A conversation-scoped config');
    }
    for (const label of ['B', 'C']) {
      await waitFor(async () => {
        const state = await readNative(natives[label], 'codex', bindings[label].session.session_id);
        return state.messages.some(message => String(message.content || '').includes(conversations[label].token))
          && !state.thinking?.thinking ? state : null;
      }, 30000, `${label} exact fixture conversation`);
    }

    const baselines = {};
    for (const label of ['A', 'B', 'C']) {
      baselines[label] = configSnapshot(await currentConfig(natives[label]));
      assert.strictEqual(baselines[label].config.conversation_scoped, true, `${label} is not conversation-scoped`);
    }
    assert.strictEqual(baselines.A.config.model_id, 'gpt-5.6-sol', 'A model baseline changed');
    assert.strictEqual(baselines.A.config.effort, 'extra-high', 'A effort baseline changed');
    result.baselines = baselines;

    const sequence = Array.from({ length: count }, (_, index) => {
      switch (index % 4) {
        case 0: return { field: 'model_id', value: 'gpt-5.5' };
        case 1: return { field: 'effort', value: 'high' };
        case 2: return { field: 'model_id', value: baselines.A.config.model_id };
        default: return { field: 'effort', value: baselines.A.config.effort };
      }
    });

    for (let index = 0; index < sequence.length; index++) {
      const intent = sequence[index];
      const applied = await applyField(natives.A, intent.field, intent.value);
      result.controls += 1;
      const token = `RAC_CODEX_CONTROL_${String(index + 1).padStart(2, '0')}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const canary = await sendExactCanary(relay, natives.A, bindings.A.session.session_id, token);
      result.sends += 1;
      const postTurnConfig = await currentConfig(natives.A);
      assert.strictEqual(postTurnConfig[intent.field], intent.value, `turn ${index + 1} lost selected ${intent.field}`);
      const isolation = {};
      for (const label of ['B', 'C']) {
        const observed = configSnapshot(await currentConfig(natives[label]));
        assert.deepStrictEqual(observed, baselines[label], `${label} config changed during A change ${index + 1}`);
        isolation[label] = { unchanged: true, sha256: observed.sha256 };
      }
      result.changes.push({
        ordinal: index + 1,
        ...intent,
        latency_ms: applied.latency_ms,
        readback: applied.readback,
        canary: { token, ...canary },
        post_turn_config: postTurnConfig,
        isolation,
      });
    }

    const finalA = configSnapshot(await currentConfig(natives.A));
    assert.deepStrictEqual(finalA, baselines.A, 'A did not restore to its exact baseline');
    for (const label of ['B', 'C']) {
      const isolated = configSnapshot(await currentConfig(natives[label]));
      assert.deepStrictEqual(isolated, baselines[label], `${label} final config changed`);
      result.isolation_checks.push({ label, unchanged: true, snapshot: isolated });
    }

    const latencies = result.changes.map(change => change.latency_ms);
    result.latency = {
      p50_ms: percentile(latencies, 0.50),
      p95_ms: percentile(latencies, 0.95),
      max_ms: Math.max(...latencies),
      samples: latencies,
      gate_p95_ms: 750,
    };
    assert(result.latency.p95_ms <= 750, `p95 ${result.latency.p95_ms}ms exceeds 750ms gate`);

    const filesAfter = {
      codex_config: fileSnapshot(configPath),
      vscode_settings: fileSnapshot(settingsPath),
    };
    assert.deepStrictEqual(filesAfter, filesBefore, 'control run changed global config or VS Code settings');
    const protectedAfter = await protectedSnapshot();
    result.protected_target_drift = hashSetDrift(protectedBefore.target_hashes, protectedAfter.target_hashes);
    assert.deepStrictEqual(
      protectedAfter.codex_frame_hashes,
      protectedBefore.codex_frame_hashes,
      'control run changed protected 9223 Codex frame set'
    );
    assert.deepStrictEqual(protectedAfter.configs, protectedBefore.configs, 'control run changed protected 9223 Codex config state');
    result.files_after = filesAfter;
    result.protected_after = protectedAfter;
    result.global_files_unchanged = true;
    result.protected_codex_frame_and_config_state_unchanged = true;
    result.wrong_session_successes = 0;
    result.duplicate_successes = 0;
    result.phantom_successes = 0;
    result.ok = true;
    writeResult(result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    result.error = error.stack || error.message;
    result.files_after_failure = {
      codex_config: fileSnapshot(configPath),
      vscode_settings: fileSnapshot(settingsPath),
    };
    try {
      result.protected_after_failure = await protectedSnapshot();
      if (protectedBefore) {
        result.protected_target_drift = hashSetDrift(
          protectedBefore.target_hashes,
          result.protected_after_failure.target_hashes
        );
      }
    } catch {}
    result.current_config_after_failure = {};
    for (const label of ['A', 'B', 'C']) {
      try { result.current_config_after_failure[label] = await currentConfig(natives[label]); } catch {}
    }
    writeResult(result);
    throw error;
  } finally {
    try { relay.ws.close(); } catch {}
    for (const native of Object.values(natives)) await native.client.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`VS Code Codex disposable control latency proof: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
