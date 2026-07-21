'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-conversation-identity-'));
const storePath = path.join(tempRoot, 'session-store.json');
const ownerRegistryPath = path.join(tempRoot, 'missing-owner-registry.json');
process.env.SESSION_STORE_PATH = storePath;
process.env.SESSION_STORE_SAVE_DEBOUNCE_MS = '250';

const {
  CanonicalConversationRegistry,
  canonicalConversationId,
  reconcileConversationClaims,
} = require('../shared/conversation-identity');
const codexCli = require('../agent-proxy/codex-cli');

const nativeId = process.env.RAC_IDENTITY_NATIVE_ID || '11111111-2222-4333-8444-555555555555';
const desktopSessionId = process.env.RAC_IDENTITY_CANONICAL_SESSION_ID || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const cliAliasSessionId = process.env.RAC_IDENTITY_ALIAS_SESSION_ID || 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const observedAt = '2026-07-21T18:00:00.000Z';

function claim(overrides = {}) {
  return {
    session_id: desktopSessionId,
    agent_type: 'codex-desktop',
    native_conversation_id: nativeId,
    native_active: true,
    connected: true,
    observed_at: observedAt,
    ...overrides,
  };
}

async function main() {
  const jsonlPath = path.join(tempRoot, `rollout-${nativeId}.jsonl`);
  const lines = [
    {
      timestamp: '2026-07-13T04:40:31.000Z',
      type: 'session_meta',
      payload: {
        id: nativeId,
        originator: 'Codex Desktop',
        source: 'vscode',
        thread_source: 'local',
        cwd: 'C:\\synthetic\\workspace',
      },
    },
    {
      timestamp: '2026-07-13T04:40:32.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'PRIVATE_FIXTURE_PROMPT_MUST_NOT_LEAK' },
    },
  ];
  fs.writeFileSync(jsonlPath, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  const stat = fs.statSync(jsonlPath);
  const summary = codexCli.readLightweightSessionSummary(jsonlPath, stat);
  assert.strictEqual(summary.cliSessionId, nativeId);
  assert.deepStrictEqual(
    {
      originator: summary.provenance.originator,
      source: summary.provenance.source,
      thread_source: summary.provenance.thread_source,
      session_uuid: summary.provenance.session_uuid,
    },
    {
      originator: 'Codex Desktop',
      source: 'vscode',
      thread_source: 'local',
      session_uuid: nativeId,
    },
  );
  assert.strictEqual(summary.provenance.first_native_cursor.byte_offset, 0);
  assert.strictEqual(summary.provenance.last_native_cursor.file_size, stat.size);
  assert(!JSON.stringify(summary.provenance).includes('PRIVATE_FIXTURE_PROMPT_MUST_NOT_LEAK'));
  assert(!JSON.stringify(summary.provenance).includes(jsonlPath));

  const resolution = reconcileConversationClaims([
    claim(),
    claim({
      session_id: cliAliasSessionId,
      agent_type: 'codex_cli',
      native_active: false,
      archive_only: true,
      owner_evidence: { verified: false, state: 'none' },
      provenance: summary.provenance,
      native_sequence: stat.size,
    }),
  ]);
  assert.strictEqual(resolution.canonical_id, canonicalConversationId('codex', nativeId));
  assert.strictEqual(resolution.visible_session_id, desktopSessionId);
  assert.strictEqual(resolution.current_surface_label, 'Codex Desktop');
  assert.strictEqual(resolution.worker_count, 1);
  assert.strictEqual(resolution.multi_surface, false);
  assert.strictEqual(resolution.aliases.find(alias => alias.session_id === cliAliasSessionId).suppression_reason,
    'shared_archive_without_current_owner');

  const registry = new CanonicalConversationRegistry();
  const shuffled = [];
  for (let index = 0; index < 500; index += 1) {
    shuffled.push(claim({ native_sequence: index * 2 + 1 }));
    shuffled.push(claim({
      session_id: cliAliasSessionId,
      agent_type: 'codex_cli',
      native_active: false,
      archive_only: true,
      owner_evidence: { verified: false, state: 'none' },
      native_sequence: index * 2 + 2,
      provenance: summary.provenance,
    }));
  }
  shuffled.sort((left, right) => {
    const leftHash = (Number(left.native_sequence) * 2654435761) >>> 0;
    const rightHash = (Number(right.native_sequence) * 2654435761) >>> 0;
    return leftHash - rightHash;
  });
  const replayed = registry.replace(shuffled)[0];
  assert.strictEqual(replayed.visible_session_id, desktopSessionId);
  assert.strictEqual(replayed.aliases.length, 2);
  assert.strictEqual(replayed.worker_count, 1);
  const accepted = registry.apply(claim({ native_sequence: 2001 }));
  const rejected = registry.apply(claim({ native_sequence: 1999 }));
  assert.strictEqual(accepted.accepted, true);
  assert.deepStrictEqual(
    { accepted: rejected.accepted, reason: rejected.reason },
    { accepted: false, reason: 'stale_generation' },
  );

  const ownedCli = reconcileConversationClaims([
    claim({ native_sequence: 10 }),
    claim({
      session_id: cliAliasSessionId,
      agent_type: 'codex_cli',
      native_active: true,
      connected: true,
      owner_generation: 2,
      native_sequence: 20,
      owner_evidence: {
        verified: true,
        kind: 'interactive_tui',
        state: 'confirmed',
        generation: 'epoch-2',
      },
    }),
  ]);
  assert.strictEqual(ownedCli.current_surface_label, 'Codex CLI');
  assert.strictEqual(ownedCli.multi_surface, true);
  assert.strictEqual(ownedCli.worker_count, 1);

  const titleOnlyRegistry = new CanonicalConversationRegistry();
  assert.strictEqual(titleOnlyRegistry.apply({
    session_id: 'session-a', agent_type: 'cursor', title: 'same', workspace_name: 'same',
  }).reason, 'identity_unavailable');
  assert.strictEqual(titleOnlyRegistry.apply({
    session_id: 'session-b', agent_type: 'cursor_cli', title: 'same', workspace_name: 'same',
  }).reason, 'identity_unavailable');

  fs.writeFileSync(storePath, JSON.stringify({
    sessions: {
      [desktopSessionId]: {
        session_id: desktopSessionId,
        agent_type: 'codex-desktop',
        status: 'healthy',
        display_name: 'Codex Desktop',
        codex_desktop_active_thread_key: `local:${nativeId}`,
        last_seen_at: observedAt,
      },
      [cliAliasSessionId]: {
        session_id: cliAliasSessionId,
        agent_type: 'codex_cli',
        status: 'healthy',
        display_name: 'Codex CLI',
        cli_session_id: nativeId,
        codex_cli_archive_discovered: true,
        codex_cli_external_active: false,
        last_seen_at: observedAt,
      },
    },
    preferences: {},
  }, null, 2));

  const { ProxyEngine } = require('../agent-proxy/proxy-engine');
  const sessionStore = require('../agent-proxy/session-store');
  const engine = new ProxyEngine({
    cdpPorts: [],
    relayUrl: 'ws://127.0.0.1:1',
    machineLabel: 'synthetic-host',
    uploadDir: path.join(tempRoot, 'uploads'),
    codexOwnerRegistryPath: ownerRegistryPath,
  });
  engine.sessions.set(desktopSessionId, {
    session_id: desktopSessionId,
    agentType: 'codex-desktop',
    status: 'healthy',
    display_name: 'Codex Desktop',
    machine_label: 'synthetic-host',
    workspace_name: 'synthetic-workspace',
    workspace_path: 'C:\\synthetic\\workspace',
    last_seen_at: observedAt,
    _activeThreadKey: `local:${nativeId}`,
    codexDesktopActiveThreadKey: `local:${nativeId}`,
  });
  const registered = engine._registerCodexCliSession({
    ...summary,
    workspacePath: 'C:\\synthetic\\workspace',
    workspaceName: 'synthetic-workspace',
  }, { archiveDiscovered: true, externalActive: false, sendInitialHistory: false });
  assert.strictEqual(registered, null);
  assert.strictEqual(engine.sessions.size, 1);
  const durableAlias = sessionStore.getSession(cliAliasSessionId);
  assert.strictEqual(durableAlias.status, 'disconnected');
  assert.strictEqual(durableAlias.canonical_suppressed, true);
  assert.strictEqual(durableAlias.canonical_session_id, desktopSessionId);
  const metas = engine._buildSessionMetas();
  assert.strictEqual(metas.length, 1);
  assert.strictEqual(metas[0].session_id, desktopSessionId);
  assert.strictEqual(metas[0].canonical_native_id, nativeId);
  assert.strictEqual(metas[0].current_surface_label, 'Codex Desktop');
  assert.strictEqual(metas[0].worker_count, 1);
  assert(!JSON.stringify(metas).includes(cliAliasSessionId));

  await sessionStore.flushPendingSaves();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(JSON.stringify({
    ok: true,
    native_id: nativeId,
    shuffled_events: shuffled.length,
    canonical_rows: metas.length,
    cli_alias_rows: 0,
    worker_count: metas[0].worker_count,
    provenance_prompt_leaks: 0,
  }, null, 2));
}

main().catch(error => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
