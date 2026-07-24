#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const WebSocket = require('../relay-server/node_modules/ws');
const codexCli = require('../agent-proxy/codex-cli');
const sessionStore = require('../agent-proxy/session-store');
const selectors = require('../agent-proxy/selectors');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');
const {
  codexDesktopCliSessionId,
  codexDesktopArchiveMessages,
} = require('../agent-proxy/codex-desktop-archive');
const {
  buildBearerToken,
  deriveRelayBaseUrls,
  loadEnvFile,
} = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const FULL_ARCHIVE_HYDRATE = {
  maxHydrateBytes: Number.MAX_SAFE_INTEGER,
  preferTailBytes: 0,
};

function parseArgs(argv) {
  const options = { output: '', desktopSessionId: '', cliSessionId: '', relayBaseUrl: '', proxyLog: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--desktop-session-id' && next) options.desktopSessionId = argv[++index];
    else if (arg === '--cli-session-id' && next) options.cliSessionId = argv[++index];
    else if (arg === '--relay-base-url' && next) options.relayBaseUrl = argv[++index].replace(/\/+$/, '');
    else if (arg === '--proxy-log' && next) options.proxyLog = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function stableSourceId(message) {
  return String(message?.source_message_id || '').trim();
}

function memoryCitationCount(messages) {
  return messages.reduce((count, message) => count + (Array.isArray(message?.content_blocks)
    ? message.content_blocks.filter(block => block?.type === 'memory_citation').length
    : 0), 0);
}

function rawMemoryProtocolCount(messages) {
  return messages.filter(message => (
    message?.role === 'assistant'
    && /<oai-mem-citation>/i.test(String(message?.content || ''))
  )).length;
}

function orderedCandidates(sessions, agentType) {
  return sessions
    .filter(session => session.agent_type === agentType && session.status === 'healthy')
    .sort((left, right) => Date.parse(right.last_seen_at || '') - Date.parse(left.last_seen_at || ''));
}

async function relayHistory(sessionId, relayBaseUrls, token) {
  let lastError = 'relay unavailable';
  for (const relayBaseUrl of relayBaseUrls) {
    try {
      const response = await fetch(`${relayBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        lastError = `${relayBaseUrl} returned ${response.status}`;
        continue;
      }
      const payload = await response.json();
      return { relayBaseUrl, messages: Array.isArray(payload.messages) ? payload.messages : [] };
    } catch (error) {
      lastError = `${relayBaseUrl}: ${error.message}`;
    }
  }
  throw new Error(lastError);
}

async function relayPromptSnapshot(relayBaseUrl, token) {
  const wsUrl = `${relayBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')}/client-ws?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for relay connection_ack'));
    }, 10_000);
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type !== 'connection_ack') return;
      clearTimeout(timer);
      socket.close();
      resolve({
        state_epoch: message.state_epoch || null,
        open_question_prompts: Array.isArray(message.open_question_prompts) ? message.open_question_prompts : [],
        open_permission_prompts: Array.isArray(message.open_prompts) ? message.open_prompts : [],
      });
    });
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function desktopNativeState() {
  return withCodexDesktopCdpLock('codex-native-relay-parity-readonly', async () => {
    const targets = await CDP.List({ port: 9225 });
    const target = targets.find(candidate => candidate.type === 'page' && candidate.title === 'Codex');
    assert(target, 'Codex Desktop target is unavailable on the configured passive CDP port');
    const client = await CDP({ port: 9225, target: target.id });
    try {
      await client.Runtime.enable();
      const [question, threads, rawMessages] = await Promise.all([
        selectors.detectCodexDesktopQuestion(client.Runtime),
        selectors.readCodexThreadList(client.Runtime, true),
        selectors.readMessages(
          client.Runtime,
          'codex-desktop',
          'codex-native-relay-parity-readonly',
          { maxRecentTurns: 24, maxRecentUnits: 96 },
        ),
      ]);
      return {
        question,
        threads: Array.isArray(threads) ? threads : [],
        rendered_message_count: rawMessages ? JSON.parse(rawMessages).length : 0,
      };
    } finally {
      await client.close();
    }
  }, { waitMs: 90_000 });
}

function proxyLogContent(logPath) {
  if (!logPath) return '';
  const paths = [logPath];
  const basename = path.basename(logPath).toLowerCase();
  if (basename === 'proxy.log') paths.push(path.join(path.dirname(logPath), 'proxy-err.log'));
  if (basename === 'proxy-err.log') paths.push(path.join(path.dirname(logPath), 'proxy.log'));
  return [...new Set(paths)]
    .filter(candidate => fs.existsSync(candidate))
    .map(candidate => fs.readFileSync(candidate, 'utf8'))
    .join('\n');
}

function proxyMigrationRowCount(logPath, sessionId) {
  const content = proxyLogContent(logPath);
  if (!content) return null;
  const pattern = new RegExp(`\\[${sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] Sent bounded codex_cli canonical transcript schema migration [^\\r\\n]+ \\((\\d+) rows`, 'g');
  let match;
  let rows = null;
  while ((match = pattern.exec(content))) rows = Number(match[1]);
  return Number.isFinite(rows) ? rows : null;
}

function proxyStatusRowCount(logPath, sessionId) {
  const content = proxyLogContent(logPath);
  if (!content) return null;
  const pattern = new RegExp(`\\[status\\] ${sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\([^\\r\\n]+\\): (\\d+) msgs`, 'g');
  let match;
  let rows = null;
  while ((match = pattern.exec(content))) rows = Number(match[1]);
  return Number.isFinite(rows) ? rows : null;
}

function adapterReceipt(
  surface,
  session,
  nativeSummary,
  nativeMessages,
  relayMessages,
  nativePrompt,
  proxyObservedCount = null,
  options = {},
) {
  const nativeIds = nativeMessages.map(stableSourceId);
  const relayIds = relayMessages.map(stableSourceId);
  const exact = nativeMessages.length === relayMessages.length
    && nativeIds.every((id, index) => id && id === relayIds[index]);
  return {
    surface,
    session_id: session.session_id,
    native_conversation_id: options.nativeConversationId === undefined
      ? (session.cli_session_id
        || codexDesktopCliSessionId(session.codex_desktop_active_thread_key || session.codexDesktopActiveThreadKey))
      : options.nativeConversationId,
    native_surface_state: options.nativeSurfaceState || 'conversation',
    native_message_count: nativeMessages.length,
    native_source_bytes: Number(nativeSummary?.sizeBytes) || null,
    native_source_cursor_end: Number(nativeSummary?.sourceCursor?.end_offset) || null,
    native_fully_hydrated: nativeSummary?.messagesHydrated === true
      && nativeSummary?.messagesPartial !== true,
    proxy_persisted_message_count: Array.isArray(session.accumulated_messages)
      ? session.accumulated_messages.length
      : null,
    proxy_observed_message_count: Number.isFinite(proxyObservedCount) ? proxyObservedCount : null,
    relay_message_count: relayMessages.length,
    native_stable_id_count: nativeIds.filter(Boolean).length,
    relay_stable_id_count: relayIds.filter(Boolean).length,
    stable_id_sequence_exact: exact,
    duplicate_native_ids: nativeIds.length - new Set(nativeIds).size,
    duplicate_relay_ids: relayIds.length - new Set(relayIds).size,
    native_memory_citation_blocks: memoryCitationCount(nativeMessages),
    relay_memory_citation_blocks: memoryCitationCount(relayMessages),
    native_raw_memory_protocol_rows: rawMemoryProtocolCount(nativeMessages),
    relay_raw_memory_protocol_rows: rawMemoryProtocolCount(relayMessages),
    native_open_prompt_count: nativePrompt ? 1 : 0,
    messages: relayMessages.map((message, index) => ({
      source_message_id: relayIds[index],
      ...(message.native_source_id ? { native_source_id: message.native_source_id } : {}),
      ...(message.native_turn_id ? { native_turn_id: message.native_turn_id } : {}),
      role: message.role,
      sequence: Number(message.sequence) || index + 1,
      ts: Number(message.ts) || index + 1,
    })),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessions = sessionStore.getAllSessions();
  const desktop = options.desktopSessionId
    ? sessionStore.getSession(options.desktopSessionId)
    : orderedCandidates(sessions, 'codex-desktop')[0];
  assert(desktop, 'No healthy Codex Desktop session is available');

  let cli = options.cliSessionId ? sessionStore.getSession(options.cliSessionId) : null;
  if (!cli) {
    cli = orderedCandidates(sessions, 'codex_cli').find(session => {
      const goalStatus = session.activity?.goal?.status;
      return session.activity?.kind === 'idle' && ['paused', 'complete', 'completed'].includes(goalStatus);
    }) || orderedCandidates(sessions, 'codex_cli').find(session => session.activity?.kind === 'idle');
  }
  assert(cli?.codex_cli_file_path, 'No idle Codex CLI session with an immutable rollout is available');

  const desktopState = await desktopNativeState();
  assert.strictEqual(desktopState.question?.error, undefined,
    `Codex Desktop native question scan failed closed: ${desktopState.question?.error}`);
  const activeDesktopThread = desktopState.threads.find(thread => thread && thread.active) || null;
  const desktopConversationId = activeDesktopThread
    ? codexDesktopCliSessionId(activeDesktopThread.cache_key || activeDesktopThread.id || '')
    : null;
  // This is an acceptance reader for one explicitly selected immutable source,
  // not the latency-sensitive discovery path. Never let the interactive 75 MB
  // hydration ceiling silently turn exact parity into a moving-tail sample.
  const desktopSummary = desktopConversationId
    ? codexCli.findSessionByCliId(desktopConversationId, FULL_ARCHIVE_HYDRATE)
    : {
        messages: [],
        messagesHydrated: true,
        messagesPartial: false,
        sizeBytes: 0,
        sourceCursor: null,
      };
  const cliSummary = codexCli.readSessionSummary(cli.codex_cli_file_path, FULL_ARCHIVE_HYDRATE);
  assert(Array.isArray(desktopSummary?.messages), 'Codex Desktop immutable native transcript is unavailable');
  assert(Array.isArray(cliSummary?.messages), 'Codex CLI immutable native transcript is unavailable');
  assert(desktopSummary.messagesHydrated && !desktopSummary.messagesPartial,
    'Codex Desktop immutable native transcript was only partially hydrated');
  assert(cliSummary.messagesHydrated && !cliSummary.messagesPartial,
    'Codex CLI immutable native transcript was only partially hydrated');

  const relayEnv = loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const relayBaseUrls = deriveRelayBaseUrls(options.relayBaseUrl, relayEnv, proxyEnv);
  const token = buildBearerToken(relayEnv);
  assert(token, 'Relay read-only JWT configuration is unavailable');

  const [desktopRelay, cliRelay] = await Promise.all([
    relayHistory(desktop.session_id, relayBaseUrls, token),
    relayHistory(cli.session_id, relayBaseUrls, token),
  ]);
  const promptSnapshot = await relayPromptSnapshot(desktopRelay.relayBaseUrl, token);
  const desktopNative = codexDesktopArchiveMessages(desktopSummary.messages);
  const cliNativePrompt = codexCli.readCodexRequestUserInputCallEvidence(cli.codex_cli_file_path);
  const adapters = {
    'codex-desktop': adapterReceipt(
      'codex-desktop', desktop, desktopSummary, desktopNative, desktopRelay.messages, desktopState.question,
      Array.isArray(desktop.accumulated_messages)
        ? desktop.accumulated_messages.length
        : proxyStatusRowCount(options.proxyLog, desktop.session_id),
      {
        nativeConversationId: desktopConversationId,
        nativeSurfaceState: desktopConversationId ? 'conversation' : 'list_view',
      },
    ),
    codex_cli: adapterReceipt(
      'codex_cli', cli, cliSummary, cliSummary.messages, cliRelay.messages, cliNativePrompt,
      proxyMigrationRowCount(options.proxyLog, cli.session_id),
    ),
  };
  const selectedIds = new Set([desktop.session_id, cli.session_id]);
  const relayOpenQuestions = promptSnapshot.open_question_prompts
    .filter(prompt => selectedIds.has(prompt.session_id || prompt.session));
  const relayOpenPermissions = promptSnapshot.open_permission_prompts
    .filter(prompt => selectedIds.has(prompt.session_id || prompt.session));
  const ok = Object.values(adapters).every(adapter => (
    adapter.stable_id_sequence_exact
    && adapter.native_fully_hydrated
    && (adapter.native_message_count > 0 || adapter.native_surface_state === 'list_view')
    && adapter.native_message_count === adapter.native_stable_id_count
    && adapter.relay_message_count === adapter.relay_stable_id_count
    && adapter.duplicate_native_ids === 0
    && adapter.duplicate_relay_ids === 0
    && adapter.native_memory_citation_blocks === adapter.relay_memory_citation_blocks
    && adapter.native_raw_memory_protocol_rows === 0
    && adapter.relay_raw_memory_protocol_rows === 0
    && (!options.proxyLog || adapter.proxy_observed_message_count === adapter.native_message_count)
    && adapter.native_open_prompt_count === 0
  )) && relayOpenQuestions.length === 0 && relayOpenPermissions.length === 0;
  const result = {
    ok,
    generated_at: new Date().toISOString(),
    source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
    }).trim(),
    proxy_log_receipt: options.proxyLog ? path.basename(options.proxyLog) : null,
    relay_origin: new URL(desktopRelay.relayBaseUrl).origin,
    relay_state_epoch: promptSnapshot.state_epoch,
    selected_relay_open_question_count: relayOpenQuestions.length,
    selected_relay_open_permission_count: relayOpenPermissions.length,
    adapters,
    safety: {
      passive_native_reads_only: true,
      protected_session_mutations: 0,
      visible_windows_opened: 0,
    },
  };
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    ...result,
    adapters: Object.fromEntries(Object.entries(adapters).map(([surface, adapter]) => [surface, {
      ...adapter,
      messages: `[${adapter.messages.length} sanitized stable-ID rows written to receipt]`,
    }])),
  }, null, 2));
  assert.strictEqual(ok, true, 'Codex native/proxy/relay parity failed');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
