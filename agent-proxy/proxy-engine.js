// proxy-engine.js — Core proxy engine, shared between standalone and VSIX modes
//
// Extracts the CDP discovery, relay connection, session polling, and message
// handling logic from index.js into a reusable class. Both the standalone
// Node.js process and the VS Code extension instantiate this engine with
// their respective configurations.
//
// Usage:
//   const { ProxyEngine } = require('./proxy-engine');
//   const engine = new ProxyEngine({ cdpPorts, relayUrl, ... });
//   engine.on('log', (level, msg) => console.log(msg));
//   await engine.start();
//   // later:
//   engine.stop();

'use strict';

const CDP = require('chrome-remote-interface');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { AsyncLocalStorage } = require('async_hooks');

const selectors    = require('./selectors');
const { acquireCodexDesktopCdpLock } = require('./codex-desktop-cdp-lock');
const { listCdpTargets, connectCdpTarget } = require('./cdp-loopback');
const proto        = require('./protocol');
const sessionStore = require('./session-store');
const antigravityQuotaCache = require('./antigravity-quota-cache');
const {
  isEditorWorkbenchPage,
  detectWorkbenchHost,
  readVsCodeWindowPaths,
  workbenchWindowKey,
} = require('./workbench-host');
const launchers    = require('./launchers');
const claudeCli    = require('./claude-cli');
const codexCli     = require('./codex-cli');
const { CodexCliAppServerTurn } = require('./codex-cli-app-server');
const { CodexAppServerConnection } = require('./codex-app-server');
const {
  codexDesktopCliSessionId,
  codexDesktopArchiveMessages,
  codexDesktopStructuredBlockCounts,
} = require('./codex-desktop-archive');
const cursorCli    = require('./cursor-cli');
const { nativeLaunchState } = require('./native-launch-mode');
const { validateOperatorActionProof } = require('./windows-automation-launch-policy');
const { CdpDomPushManager } = require('./cdp-dom-push');
const { sessionNoiseMetadata } = require('./session-noise-policy');
const { selectDurableChatTitleDetails } = require('./session-title-policy');
const { ProviderUsageRegistry } = require('./provider-usage');
const { LocalUsageCostScanner } = require('./usage-costs');
const { HostResourceMonitor } = require('./host-resource-monitor');
const { normalizeRateLimitState } = require('../tools/codex-session-native');
const { pruneDirectory } = require('../relay-server/storage-retention');
const { appendBoundedFileSync } = require('./bounded-file-log');
const { canonicalGoalRecord, reduceGoalRunLifecycle } = require('./goal-lifecycle');
const {
  QuestionContractError,
  canonicalQuestionPrompt,
  canonicalQuestionResponse,
} = require('../shared/question-prompt-contract');
const {
  buildProducerFleetSummary,
  projectFleetSummary,
} = require('../shared/fleet-summary');
const { LatestSessionOperationQueue } = require('./latest-session-operation-queue');
const { normalizeNavigationEpoch } = require('../relay-server/navigation-epoch');
const {
  applyWriteCapabilityGate,
  isWriteCommand,
  validationGateForAgentType,
} = require('./harness-revalidation');

const SERIALIZED_NAVIGATION = Symbol('serializedNavigation');
const PRIORITY_RELAY_CONTROL = Symbol('priorityRelayControl');
const PRIORITY_RELAY_TYPES = new Set([
  'send_message',
  'send',
  'new_chat',
  'new_thread',
  'switch_chat',
  'switch_thread',
  'interrupt',
  'agent_interrupt',
  'agent_goal_control',
  'question_response',
  'permission_response',
  'error_prompt_action',
  'agent_set_model',
  'agent_set_mode',
  'agent_set_permission_mode',
]);
const NAVIGATION_SCOPED_RELAY_TYPES = new Set([
  'agent_control_result',
  'history',
  'history_snapshot',
  'chat_list',
  'thread_list',
  'status',
  'proxy_status',
  'session_list',
  'proxy_session_snapshot',
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectCodexDesktopInstalledVersion({
  override = process.env.CODEX_DESKTOP_SURFACE_VERSION,
  windowsApps = 'C:\\Program Files\\WindowsApps',
} = {}) {
  const configured = String(override || '').trim();
  if (configured) return configured;
  if (process.platform !== 'win32') return 'unknown';
  try {
    const versions = fs.readdirSync(windowsApps, { withFileTypes: true })
      .map(entry => entry.name.match(/^OpenAI\.Codex_(\d+(?:\.\d+){3})_[^_]+__/i)?.[1] || null)
      .filter(Boolean)
      .sort((left, right) => {
        const a = left.split('.').map(Number);
        const b = right.split('.').map(Number);
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
          const delta = (a[index] || 0) - (b[index] || 0);
          if (delta) return delta;
        }
        return 0;
      });
    return versions.at(-1) || 'unknown';
  } catch {
    return 'unknown';
  }
}

function detectVsCodeCodexInstalledVersion({
  override = process.env.VSCODE_CODEX_SURFACE_VERSION,
  extensionRoots = null,
} = {}) {
  const configured = String(override || '').trim();
  if (configured) return configured;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const roots = Array.isArray(extensionRoots) && extensionRoots.length > 0
    ? extensionRoots
    : [path.join(home, '.vscode', 'extensions'), path.join(home, '.vscode-insiders', 'extensions')];
  const versions = [];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const match = entry.name.match(/^openai\.chatgpt-(\d+(?:\.\d+)+)(?:-|$)/i);
        if (match) versions.push(match[1]);
      }
    } catch {}
  }
  versions.sort((left, right) => {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta) return delta;
    }
    return 0;
  });
  return versions.at(-1) || 'unknown';
}

function boundOldestMap(map, maxEntries) {
  if (!(map instanceof Map)) return 0;
  let removed = 0;
  while (map.size > maxEntries) {
    map.delete(map.keys().next().value);
    removed += 1;
  }
  return removed;
}

function pruneExpiredMap(map, now = Date.now()) {
  if (!(map instanceof Map)) return 0;
  let removed = 0;
  for (const [key, expiresAt] of map) {
    if (Number(expiresAt) > now) continue;
    map.delete(key);
    removed += 1;
  }
  return removed;
}

function mergeCodexCliArchiveDiscoverySummaries(activeSummaries, archiveSummaries, limit = 0) {
  const externalActiveIds = new Set();
  const mergedById = new Map();
  for (const summary of Array.isArray(activeSummaries) ? activeSummaries : []) {
    const cliSessionId = String(summary?.cliSessionId || '').trim();
    if (!cliSessionId) continue;
    externalActiveIds.add(cliSessionId);
    if (!mergedById.has(cliSessionId)) mergedById.set(cliSessionId, summary);
  }
  for (const summary of Array.isArray(archiveSummaries) ? archiveSummaries : []) {
    const cliSessionId = String(summary?.cliSessionId || '').trim();
    if (!cliSessionId || mergedById.has(cliSessionId)) continue;
    mergedById.set(cliSessionId, summary);
  }
  const configuredLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : 0;
  const effectiveLimit = configuredLimit > 0
    ? Math.max(configuredLimit, externalActiveIds.size)
    : 0;
  const summaries = Array.from(mergedById.values());
  return {
    externalActiveIds,
    summaries: effectiveLimit > 0 ? summaries.slice(0, effectiveLimit) : summaries,
  };
}

function shouldImmediatelyStreamCursorAssistant(pending, current) {
  return pending?.role === 'assistant'
    && current?.role === 'assistant'
    && String(current.content || '').length > 0
    && String(current.content || '') !== String(pending.content || '');
}

function shouldImmediatelyStreamAntigravityV2Assistant(pending, current) {
  return current?.role === 'assistant'
    && String(current.content || '').length > 0
    && (!pending || pending.role === 'assistant')
    && String(current.content || '') !== String(pending?.content || '');
}

function shouldPrioritizeCliAssistantSnapshot(previousCount, messages) {
  if (!Array.isArray(messages) || messages.length <= Number(previousCount || 0)) return false;
  const tail = messages[messages.length - 1];
  return tail?.role === 'assistant' && String(tail.content || '').length > 0;
}

function shouldImmediatelyStreamContinueAssistant(pending, current) {
  return shouldImmediatelyStreamCursorAssistant(pending, current);
}

function shouldSendStablePendingMessage(
  pending,
  lastStreamedContent,
  pendingStreamContent = pending?.content,
) {
  return !(pending?.role === 'assistant'
    && String(pendingStreamContent || '').length > 0
    && String(pendingStreamContent || '') === String(lastStreamedContent || ''));
}

function completedPrefixMutationIndex(previousMessages, currentMessages, sentCount) {
  if (!Array.isArray(previousMessages) || !Array.isArray(currentMessages)) return -1;
  const limit = Math.min(
    Math.max(0, Number(sentCount) || 0),
    previousMessages.length,
    currentMessages.length,
  );
  for (let index = 0; index < limit; index++) {
    const previous = previousMessages[index] || {};
    const current = currentMessages[index] || {};
    const previousSig = JSON.stringify([
      previous.role || '',
      previous.content || '',
      previous.content_blocks || null,
    ]);
    const currentSig = JSON.stringify([
      current.role || '',
      current.content || '',
      current.content_blocks || null,
    ]);
    if (previousSig !== currentSig) return index;
  }
  return -1;
}

function appendedMutationCandidateStableEnd(candidateMessages, currentMessages) {
  if (!Array.isArray(candidateMessages) || !Array.isArray(currentMessages)) return -1;
  if (candidateMessages.length === 0 || currentMessages.length <= candidateMessages.length) return -1;
  for (let index = 0; index < candidateMessages.length; index++) {
    const candidate = candidateMessages[index] || {};
    const current = currentMessages[index] || {};
    const candidateSig = JSON.stringify([
      candidate.role || '',
      candidate.content || '',
      candidate.content_blocks || null,
    ]);
    const currentSig = JSON.stringify([
      current.role || '',
      current.content || '',
      current.content_blocks || null,
    ]);
    if (candidateSig !== currentSig) return -1;
  }
  return currentMessages.length - 1;
}

function shouldRunContinueRemoteFastPoll(session, now = Date.now()) {
  return (session?.agentType === 'continue' || session?.agentType === 'continue_yolo')
    && Number(session._remoteFastPollUntil || 0) > now
    && (
      session.waitingForAssistant === true
      || Number(session._continueTailSettleUntil || 0) > now
    );
}

function shouldFastPollCodexCliSession(session) {
  return session?.agentType === 'codex_cli'
    && !!(session._codexAppServerTurn || session._codexCliChild);
}

function shouldHoldContinueRemoteWaitOnRegression(
  session,
  effectiveMessageCount,
  previousObservedCount,
  now = Date.now(),
) {
  return shouldRunContinueRemoteFastPoll(session, now)
    && Number(effectiveMessageCount) < Number(previousObservedCount);
}

function shouldImmediatelyStreamContinueInPlace(session, current, now = Date.now()) {
  return shouldRunContinueRemoteFastPoll(session, now)
    && shouldImmediatelyStreamContinueAssistant(session?.pendingLast, current);
}

function shouldImmediatelyStreamContinueTailMutation(session, current, now = Date.now()) {
  return (session?.agentType === 'continue' || session?.agentType === 'continue_yolo')
    && Number(session._continueTailSettleUntil || 0) > now
    && current?.role === 'assistant'
    && String(current.content || '').length > 0
    && String(current.content || '') !== String(session._continueTailContent || '');
}

const CURSOR_PASSIVE_ROTATION_GRACE_MS = 30_000;

function shouldPreserveCursorPassiveRotation(session, now = Date.now()) {
  if (!session || session.agentType !== 'cursor') return false;
  const kind = String(session.activity?.kind || '').toLowerCase();
  const remoteTurnActive = session.waitingForAssistant === true
    || ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(kind);
  if (remoteTurnActive) {
    session._cursorPassiveRotationGraceUntil = now + CURSOR_PASSIVE_ROTATION_GRACE_MS;
  }
  return Number(session._cursorPassiveRotationGraceUntil || 0) >= now;
}

function liveStepFromTaskList(taskList) {
  const tasks = Array.isArray(taskList?.tasks) ? taskList.tasks : [];
  if (tasks.length === 0) return null;
  let index = tasks.findIndex(task => task?.state === 'in_progress');
  if (index < 0) index = tasks.findIndex(task => task?.state === 'pending');
  if (index < 0) index = Math.max(0, tasks.length - 1);
  return {
    current: index + 1,
    total: tasks.length,
    state: tasks[index]?.state || 'pending',
    text: tasks[index]?.text || '',
  };
}

function expectedCodexQuestionAnswers(prompt, response) {
  if (response?.action === 'cancel') return {};
  const questions = Array.isArray(prompt?.questions) ? prompt.questions : [];
  const answers = Array.isArray(response?.answers) ? response.answers : [];
  const expected = {};
  for (const answer of answers) {
    const question = questions.find(candidate => candidate?.question_id === answer?.question_id);
    if (!question) continue;
    let values = [];
    if (typeof answer.other_text === 'string' && answer.other_text.trim()) {
      values = [answer.other_text.trim()];
    } else {
      const choiceIds = Array.isArray(answer.choice_ids) ? answer.choice_ids : [];
      values = choiceIds.map(choiceId => (
        (question.choices || []).find(choice => choice?.choice_id === choiceId)?.label || ''
      )).filter(Boolean);
    }
    expected[question.question_id] = { answers: values };
  }
  return expected;
}

function codexUsageActivity(session) {
  const percentUsed = Number(session?.percentUsed ?? session?.percent_used);
  if (!session?.rateLimitActive && !(percentUsed >= 100)) return null;
  const reset = session.rate_limited_until && session.rate_limited_until !== 'unknown'
    ? session.rate_limited_until
    : null;
  return {
    state: 'exhausted',
    title: "You're out of Codex and Work usage",
    detail: reset ? `Your rate limit resets at ${reset}.` : 'Your rate limit reset time is not available yet.',
    resets_at: reset,
    percent_used: percentUsed || 100,
  };
}

function shouldBypassHistoryBulkQueue(agentType, reason, byteLength) {
  const maxBytes = agentType === 'antigravity-v2' ? 256 * 1024 : 64 * 1024;
  return (agentType === 'cursor'
      || agentType === 'antigravity-v2'
      || agentType === 'codex_cli'
      || agentType === 'cursor_cli'
      || agentType === 'continue'
      || agentType === 'continue_yolo')
    && String(reason || '').toLowerCase() === 'assistant completion'
    && Number.isFinite(byteLength)
    && byteLength > 0
    && byteLength <= maxBytes;
}

function isPathWithinWorkspace(workspacePath, candidatePath) {
  const normalize = value => {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const root = normalize(workspacePath);
  const candidate = normalize(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function resolveWorkspaceRequestPath(workspacePath, requestPath) {
  const lexicalRoot = path.resolve(String(workspacePath || ''));
  const lexicalCandidate = path.resolve(lexicalRoot, String(requestPath || '.'));
  if (!isPathWithinWorkspace(lexicalRoot, lexicalCandidate)) {
    return { ok: false, code: 'path_traversal', message: 'Path is outside workspace' };
  }

  try {
    const realRoot = fs.realpathSync.native(lexicalRoot);
    const realCandidate = fs.realpathSync.native(lexicalCandidate);
    if (!isPathWithinWorkspace(realRoot, realCandidate)) {
      return { ok: false, code: 'path_traversal', message: 'Path is outside workspace' };
    }
    return { ok: true, path: realCandidate, workspace: realRoot };
  } catch (error) {
    return { ok: false, code: 'fs_error', message: error.message };
  }
}

function validateAttachmentPayload(data, mimeType, filename) {
  const encoded = typeof data === 'string' ? data.trim() : '';
  const mime = String(mimeType || 'image/png').trim().toLowerCase();
  const name = String(filename || 'image.png').trim() || 'image.png';
  if (!encoded) {
    return { ok: false, code: 'invalid_message', message: 'send_attachment requires base64 image data' };
  }
  if (!mime.startsWith('image/')) {
    return { ok: false, code: 'invalid_mime_type', message: 'send_attachment supports image MIME types only' };
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return { ok: false, code: 'invalid_base64', message: 'Attachment data is not valid base64' };
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
    return { ok: false, code: 'invalid_base64', message: 'Attachment data is not canonical base64' };
  }
  if (bytes.length > 10 * 1024 * 1024) {
    return { ok: false, code: 'attachment_too_large', message: 'Attachment exceeds the 10 MiB direct-image limit' };
  }
  return { ok: true, data: encoded, mime_type: mime, filename: name, size: bytes.length };
}

// Codex Desktop can open ordinary browser pages (for example an OAuth sign-in)
// inside the same Electron debugging port as the native app. Those pages are
// not harness sessions and must never be registered in the relay/sidebar.
function isDesktopAppPage(target, agentType) {
  if (!target || target.type !== 'page') return false;
  const url = String(target.url || '');
  if (!url || url.startsWith('devtools') || url.startsWith('chrome-extension')) return false;
  if (agentType === 'codex-desktop') {
    return /^app:\/\/-\/index\.html(?:[?#].*)?$/i.test(url);
  }
  return true;
}

function isStoredDesktopTargetCanonical(session, target) {
  if (session?.agent_type !== 'codex-desktop') return true;
  return isDesktopAppPage(target, 'codex-desktop');
}

function classifyStoredCdpOrphan(session, target, successfulCdpPorts, liveSessions = []) {
  const targetOwnedByAnotherCursorSession = session?.agent_type === 'cursor'
    && liveSessions.some(live => (
      live.agentType === 'cursor'
      && live.targetId === session.target_id
      && live.session_id !== session.session_id
    ));
  if (targetOwnedByAnotherCursorSession) return 'owned by another canonical Cursor session';
  if (target) {
    return isStoredDesktopTargetCanonical(session, target) ? null : 'not a canonical app target';
  }

  // A missing target is authoritative only when its own CDP port answered this
  // discovery pass. Failure or cooldown on another port must preserve it.
  const storedPort = Number(session?.cdp_port);
  if (!Number.isInteger(storedPort) || !successfulCdpPorts?.has(storedPort)) return null;
  return 'gone';
}

function classifyActiveSessionTarget(existingSession, target, currentTargetIds) {
  if (!existingSession) return 'new';
  if (existingSession.targetId === target?.id) return 'same_target';
  if (
    Number(existingSession._cdpPort) === Number(target?._cdpPort)
    && !currentTargetIds.has(existingSession.targetId)
  ) {
    return 'replace_stale_target';
  }
  return 'duplicate_live_target';
}

function targetDiscoveryDueOnTick(tick, intervalTicks = 10) {
  return Number.isInteger(tick)
    && tick > 0
    && Number.isInteger(intervalTicks)
    && intervalTicks > 0
    && tick % intervalTicks === 0;
}

function normalizeCursorWorkspaceToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cursorFileUriToPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw.replace(/^file:\/\/\//i, '')); } catch {}
  decoded = decoded.replace(/\//g, '\\');
  if (/^\/[a-z]:/i.test(decoded)) decoded = decoded.substring(1);
  return path.normalize(decoded);
}

function resolveCursorWorkspacePath(agent, candidates) {
  const workspaceName = normalizeCursorWorkspaceToken(agent?.workspace_name);
  const repoSlug = normalizeCursorWorkspaceToken(
    String(agent?.workspace_key || '').split('/').filter(Boolean).pop() || ''
  );
  const ranked = (Array.isArray(candidates) ? candidates : []).map(candidate => {
    const candidatePath = String(candidate?.path || '');
    if (!candidatePath) return null;
    const basename = normalizeCursorWorkspaceToken(path.basename(candidatePath));
    const title = normalizeCursorWorkspaceToken(candidate?.title);
    let score = 0;
    if (repoSlug && basename === repoSlug) score = Math.max(score, 120);
    if (repoSlug && title === repoSlug) score = Math.max(score, 110);
    if (workspaceName && basename === workspaceName) score = Math.max(score, 100);
    if (workspaceName && title === workspaceName) score = Math.max(score, 90);
    return score > 0 ? { candidate, score } : null;
  }).filter(Boolean);
  ranked.sort((a, b) => b.score - a.score || a.candidate.path.length - b.candidate.path.length);
  return ranked[0]?.candidate || null;
}

const CURSOR_WORKING_CONTINUITY_LEASE_MS = 5_000;
const CURSOR_NATIVE_OBSERVED_SOURCE = 'cursor_native_observed';

function cursorNativeActivity(agent, previous = null, options = {}) {
  const signalValues = [
    agent?.native_status,
    ...(Array.isArray(agent?.native_status_signals)
      ? agent.native_status_signals.map(signal => signal?.value || signal)
      : []),
  ];
  const status = signalValues.map(value => String(value || '').toLowerCase()).filter(Boolean).join(' | ');
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const now = new Date(nowMs).toISOString();
  const previousKind = String(previous?.kind || '').toLowerCase();
  const transitionAt = kind => (
    previousKind === kind && previous?.updated_at ? previous.updated_at : now
  );
  const needsAttention = /needs|attention|blocked|error|failed|permission/.test(status);
  const terminal = /(?:^|[^a-z])(?:done(?:[-_ ]?(?:seen|unseen))?|complete(?:d)?|finished|idle|stopped|cancel(?:led|ed)|aborted)(?:$|[^a-z])/.test(status);
  const nativeWorking = agent?.native_working === true
    || /working|running|generating|thinking|in[-_ ]?progress|executing/.test(status);
  const transcriptWorking = options.correlatedTranscriptWorking === true;

  if (needsAttention) {
    const capabilities = {
      kind: 'needs_attention',
      label: 'Needs attention',
      updated_at: transitionAt('needs_attention'),
      cursor_evidence_at: now,
      cursor_evidence_source: 'native_status',
    };
    return applyWriteCapabilityGate(capabilities, agentType);
  }
  if (terminal) {
    return {
      kind: 'idle',
      label: '',
      updated_at: transitionAt('idle'),
      cursor_evidence_at: now,
      cursor_evidence_source: 'native_terminal',
    };
  }
  if (nativeWorking || transcriptWorking) {
    return {
      kind: 'generating',
      label: 'Working',
      updated_at: transitionAt('generating'),
      cursor_evidence_at: now,
      cursor_evidence_source: nativeWorking ? 'native_status' : 'active_transcript',
    };
  }

  const previousEvidenceAt = Math.max(
    Date.parse(previous?.cursor_evidence_at || '') || 0,
    Date.parse(previous?.observed_at || '') || 0,
    Date.parse(previous?.updated_at || '') || 0,
  );
  if (
    previousKind === 'generating'
    && Number.isFinite(previousEvidenceAt)
    && nowMs - previousEvidenceAt <= CURSOR_WORKING_CONTINUITY_LEASE_MS
  ) {
    return {
      ...previous,
      kind: 'generating',
      label: previous?.label || 'Working',
      updated_at: previous?.updated_at || now,
      cursor_evidence_at: new Date(previousEvidenceAt).toISOString(),
      cursor_evidence_source: 'continuity_lease',
    };
  }
  return { kind: 'idle', label: '', updated_at: transitionAt('idle') };
}

function cursorHasAuthoritativeWorkingSignal(agent) {
  const activity = cursorNativeActivity(agent, null, { nowMs: 0 });
  return activity.kind === 'generating' && activity.cursor_evidence_source === 'native_status';
}

function cursorAgentEligible(agent, existing = false) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(String(agent?.id || '')) && (
    agent?.workspace_expanded !== false
    || agent?.active === true
    || cursorHasAuthoritativeWorkingSignal(agent)
    || existing === true
  );
}

function codexDesktopThreadKeysMatch(storedKey, currentKey) {
  const stored = String(storedKey || '');
  const current = String(currentKey || '');
  if (!stored || !current) return true;
  return stored === current || stored.startsWith(`${current}:`);
}

function isClosedCdpTransportError(error) {
  return /WebSocket is not open|readyState\s+\d+\s*\(CLOSED\)|target closed|session closed|connection closed|ECONNRESET|EPIPE/i
    .test(String(error?.message || error || ''));
}

function countExactCodexUserMessages(raw, content) {
  let messages = raw;
  try {
    if (typeof raw === 'string') messages = JSON.parse(raw || '[]');
  } catch {
    return 0;
  }
  if (!Array.isArray(messages)) return 0;
  const wanted = String(content || '').replace(/\s+/g, ' ').trim();
  if (!wanted) return 0;
  return messages.filter(message => (
    message?.role === 'user'
    && String(message.content || '').replace(/\s+/g, ' ').trim() === wanted
  )).length;
}

function codexArchiveAppendContainsExactUser(raw, content) {
  const wanted = String(content || '').replace(/\s+/g, ' ').trim();
  if (!wanted) return false;
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const payload = entry?.payload || {};
    const candidates = [];
    if (entry?.type === 'event_msg' && payload.type === 'user_message') {
      candidates.push(payload.message);
    }
    if (entry?.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      for (const item of (Array.isArray(payload.content) ? payload.content : [])) {
        if (item?.type === 'input_text' || item?.type === 'text') candidates.push(item.text);
      }
    }
    if (candidates.some(value => String(value || '').replace(/\s+/g, ' ').trim() === wanted)) return true;
  }
  return false;
}

function shouldRetainCodexDesktopPermissionTimeout(session, error) {
  return session?.agentType === 'codex-desktop'
    && String(error?.message || error || '').startsWith('permission poll timeout after ');
}

function resolveCodexDesktopThreadMetadata(
  threadKey,
  activeThreadTitle = '',
  findSessionByCliId = codexCli.findSessionByCliId,
) {
  const cliSessionId = String(threadKey || '').match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1];
  if (!cliSessionId || typeof findSessionByCliId !== 'function') return null;

  const summary = findSessionByCliId(cliSessionId, { includeMessages: false });
  if (!summary) return null;
  const workspacePath = String(summary.workspacePath || '').trim() || null;
  return {
    cliSessionId,
    workspacePath,
    workspaceName: String(summary.workspaceName || (workspacePath ? path.basename(workspacePath) : '')).trim() || null,
    chatTitle: String(activeThreadTitle || summary.title || '').trim() || null,
  };
}

function shouldRestoreCodexDesktopAccumulator(options = {}) {
  const storedMessages = Array.isArray(options.storedMessages) ? options.storedMessages : [];
  const initialMessages = Array.isArray(options.initialMessages) ? options.initialMessages : [];
  if (storedMessages.length === 0) return false;
  if (!codexDesktopThreadKeysMatch(options.storedThreadKey, options.currentThreadKey)) return false;
  return initialMessages.length === 0 || options.storedContainsInitial === true;
}

function envMbBytes(name, fallbackMb, minMb = 1, maxMb = 96) {
  const parsed = Number(process.env[name] || '');
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return Math.max(minMb, Math.min(maxMb, mb)) * 1024 * 1024;
}

// Deterministic per-session stagger offset so different periodic reads
// (task_list, rate_limit, native_queue, automation_view…) don't fire on the
// same poll tick. Without this, every counter starts at 0 and they all hit
// their threshold together, which fires a burst of 4-5 heavy CDP evals at
// once and visibly locks up the renderer for codex / codex-desktop.
function staggerOffset(sessionId, key, modulo) {
  if (!modulo || modulo <= 1) return 0;
  let h = 2166136261;
  const s = String(sessionId || '') + '|' + String(key || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % modulo;
}

// ─── Codex model/effort/access constants ────────────────────────────────────

const CODEX_MODELS = [
  { id: 'gpt-5.6',         label: 'GPT-5.6' },
  { id: 'gpt-5.6-sol',     label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra',   label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna',    label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5',           label: 'GPT-5.5' },
  { id: 'gpt-5.4',           label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',      label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { id: 'gpt-5.3-codex',     label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',     label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2',           label: 'GPT-5.2' },
  { id: 'gpt-5.1-codex',     label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1',           label: 'GPT-5.1' },
  { id: 'gpt-5',             label: 'GPT-5' },
];
const CODEX_EFFORTS = [
  { id: 'low',        label: 'Low' },
  { id: 'medium',     label: 'Medium' },
  { id: 'high',       label: 'High' },
  { id: 'extra-high', label: 'Extra High' },
];
const CODEX_ACCESS_MODES = [
  { id: 'read-only',          label: 'Read only' },
  { id: 'workspace-write',    label: 'Workspace write' },
  { id: 'danger-full-access', label: 'Full access' },
];
const CODEX_SPEEDS = [
  { id: 'standard', label: 'Standard' },
  { id: 'fast',     label: 'Fast' },
];
// Native inventory captured from VS Code Codex 26.707.71524 on the isolated
// 9230 profile. Keep this surface-specific: Desktop still owns its broader
// restart-scoped fallback catalog above.
const VSCODE_CODEX_MODELS = [
  { id: 'gpt-5.5',     label: 'GPT-5.5' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
];
const VSCODE_CODEX_EFFORTS = [
  { id: 'low',        label: 'Light' },
  { id: 'medium',     label: 'Medium' },
  { id: 'high',       label: 'High' },
  { id: 'extra-high', label: 'Extra High' },
  { id: 'ultra',      label: 'Ultra' },
];
const VSCODE_CODEX_PERMISSION_PROFILES = [
  { id: 'auto', label: 'Ask for approval', description: 'Always ask to edit external files and use the internet.' },
  { id: 'guardian-approvals', label: 'Approve for me', description: 'Only ask for actions detected as potentially unsafe.' },
  { id: 'full-access', label: 'Full access', description: 'Unrestricted internet and file access; approval policy is Never.' },
  { id: 'custom', label: 'Custom (config.toml)', description: 'Use the permissions already defined by native Codex configuration.' },
];
const VSCODE_CODEX_CATALOG = Object.freeze({
  source: 'native_disposable_probe',
  observed_at: '2026-07-15T12:54:24.026Z',
  client_version: '26.707.71524',
});
const CODEX_CONFIG_CONTROL_CACHE_MAX = 512;
const CLAUDE_CODE_PERMISSION_MODES = [
  { value: 'default',           label: 'Ask before edit' },
  { value: 'acceptEdits',       label: 'Edit automatically' },
  { value: 'plan',              label: 'Plan mode' },
  { value: 'auto',              label: 'Auto mode' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
];
const CLAUDE_CODE_EFFORTS = [
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
];
const CLAUDE_CODE_MODELS = [
  { id: 'default', label: 'Default (recommended)' },
  { id: 'sonnet',  label: 'Sonnet' },
  { id: 'fable',   label: 'Fable' },
  { id: 'opus',    label: 'Opus' },
  { id: 'haiku',   label: 'Haiku' },
];

function normalizeCodexSpeed(value) {
  const speed = String(value || '').toLowerCase().trim();
  if (!speed || speed === 'unknown') return 'standard';
  if (speed === 'default' || speed === 'auto') return 'standard';
  return speed;
}

function normalizeCodexEffort(value) {
  const effort = String(value || '').toLowerCase().trim().replace(/_/g, '-');
  if (!effort || effort === 'unknown') return 'unknown';
  if (effort === 'light') return 'low';
  if (effort === 'xhigh' || effort === 'extra high') return 'extra-high';
  return effort;
}

function codexSpeedToConfigValue(speed) {
  return normalizeCodexSpeed(speed) === 'standard' ? 'default' : normalizeCodexSpeed(speed);
}

// ─── Retriable send codes ───────────────────────────────────────────────────

const RETRIABLE_SEND_CODES = new Set([
  'input_not_found',
  'send_button_failed',
  'fallback_no_input',
  // agent_busy is NOT retriable — messages are queued instead (steer feature)
]);
const SEND_MAX_RETRIES    = 8;
const SEND_RETRY_DELAY_MS = 3000;
const CODEX_DESKTOP_HARD_STUCK_COOLDOWN_MS = Math.max(
  60_000,
  parseInt(process.env.CODEX_DESKTOP_HARD_STUCK_COOLDOWN_MS || '900000', 10) || 900_000
);
// Keep below the relay's 128 MB ws maxPayload, but large enough for long
// virtualized Codex transcripts that must be resynced as one authoritative
// history snapshot.
const RELAY_MESSAGE_MAX_BYTES = 96 * 1024 * 1024;
// On reconnect, session discovery can queue large history snapshots before the
// relay handshake completes. The WebUI asks for the selected transcript tail
// after the session list arrives, so do not block/kill the socket by flushing
// multi-megabyte archives ahead of the sidebar.
const DEFERRED_HISTORY_FLUSH_MAX_BYTES = 512 * 1024;
// Keep automatic transcript traffic from building an unbounded WebSocket
// write queue. Control receipts/status messages must stay responsive even
// while several large CLI sessions are changing at once.
const RELAY_BULK_HIGH_WATER_BYTES = Math.max(
  64 * 1024,
  parseInt(process.env.RAC_RELAY_BULK_HIGH_WATER_BYTES || String(512 * 1024), 10) || 512 * 1024
);
const RELAY_BULK_FRAME_MAX_BYTES = Math.min(
  RELAY_MESSAGE_MAX_BYTES,
  Math.max(64 * 1024, parseInt(process.env.RAC_RELAY_BULK_FRAME_MAX_BYTES || String(4 * 1024 * 1024), 10) || 4 * 1024 * 1024)
);
const RELAY_BULK_MAX_DEFERRAL_MS = 250;
const RUNTIME_METADATA_MAP_MAX_ENTRIES = 512;
const PENDING_RELAY_BULK_MAX_ENTRIES = 128;
const PENDING_RELAY_BULK_MAX_BYTES = 32 * 1024 * 1024;
const PENDING_PRE_READY_HISTORY_MAX_ENTRIES = 64;
const LOCAL_UPLOAD_RETENTION_MS = Math.max(1, parseInt(process.env.RAC_UPLOAD_RETENTION_DAYS || '365', 10) || 365) * 24 * 60 * 60 * 1000;
const LOCAL_UPLOAD_MAX_BYTES = envMbBytes('RAC_UPLOAD_MAX_TOTAL_MB', 512, 16, 4096);
const LOCAL_UPLOAD_MAX_FILES = Math.max(100, parseInt(process.env.RAC_UPLOAD_MAX_FILES || '5000', 10) || 5000);
const LOCAL_UPLOAD_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Automatic history snapshots run from poll/reconnect paths. Large transcripts
// should be loaded through explicit tail requests or incremental messages, not
// repeatedly serialized and pushed through the relay during page refresh.
const AUTOMATIC_HISTORY_SNAPSHOT_MAX_BYTES = Math.min(
  RELAY_BULK_FRAME_MAX_BYTES,
  envMbBytes('RAC_HISTORY_SNAPSHOT_AUTO_MAX_MB', 4, 1, 64)
);
const CODEX_CLI_HISTORY_CHUNK_BYTES = envMbBytes('CODEX_CLI_HISTORY_CHUNK_MB', 1, 1, 16);
const CODEX_CLI_HISTORY_TAIL_MIN_INTERVAL_MS = 1_500;
const CODEX_CLI_HISTORY_OLDER_MIN_INTERVAL_MS = 5_000;
const CODEX_CLI_HISTORY_REPEAT_CURSOR_MS = 60_000;
const FILE_TRANSCRIPT_ASYNC_APPEND_THRESHOLD = 20;
const FILE_TRANSCRIPT_APPEND_BATCH_ROWS = 8;
const FILE_TRANSCRIPT_APPEND_BATCH_MS = 8;
const FILE_TRANSCRIPT_RECOVERY_BLOCK_MS = 60_000;
const FILE_TRANSCRIPT_RECOVERY_ROW_OVERHEAD_BYTES = 256;
const POLL_BUDGET_SAMPLE_MAX = 1800;
const POLL_BUDGET_REPORT_EVERY_TICKS = 30;
const CODEX_CLI_OWNER_MISSING_GRACE_MS = Math.min(120_000, Math.max(
  5_000,
  parseInt(process.env.CODEX_CLI_OWNER_MISSING_GRACE_MS || '30000', 10) || 30_000,
));
const ACTIVITY_OBSERVATION_HEARTBEAT_MS = 5_000;
const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'reading_files', 'running_command', 'applying_patch', 'working',
]);
const VSCODE_CODEX_NATIVE_DEADLINE_RECEIPT_GRACE_MS = 15000;

// ─── Cursor CLI history streaming constants ─────────────────────────────────
// Env vars: CURSOR_CLI_PATH, CURSOR_CLI_SESSION_LIMIT (20),
//           CURSOR_CLI_ARCHIVE_MAX_AGE_HOURS (72),
//           CURSOR_CLI_DISCOVER_ARCHIVES, CURSOR_CLI_WATCH_SESSIONS
const CURSOR_CLI_HISTORY_CHUNK_BYTES = envMbBytes('CURSOR_CLI_HISTORY_CHUNK_MB', 1, 1, 16);
const CURSOR_CLI_HISTORY_TAIL_MIN_INTERVAL_MS = 1_500;
const CURSOR_CLI_HISTORY_OLDER_MIN_INTERVAL_MS = 5_000;
const CURSOR_CLI_HISTORY_REPEAT_CURSOR_MS = 60_000;

// ─── ProxyEngine class ─────────────────────────────────────────────────────

class ProxyEngine extends EventEmitter {

  /**
   * @param {object} config
   * @param {number[]} config.cdpPorts       — CDP port numbers to scan
   * @param {string}   config.relayUrl       — Base relay WebSocket URL
   * @param {string}   [config.proxySecret]  — Shared secret for relay auth
   * @param {string}   [config.machineLabel] — Machine label for session metadata
   * @param {string}   [config.uploadDir]    — Directory for uploaded files
   */
  constructor(config) {
    super();

    this.CDP_PORTS = config.cdpPorts;
    this.RELAY_URL_BASE = config.relayUrl;
    this.PROXY_SECRET = config.proxySecret || null;
    this.RELAY_URL = this.RELAY_URL_BASE; // SEC-02: secret moved to connection_hello message
    this.MACHINE_LABEL = config.machineLabel || require('os').hostname();
    this.PROXY_ID = crypto.randomUUID();
    this.POLL_INTERVAL_MS = 1000;
    this.CODEX_DESKTOP_PERMISSION_POLL_TIMEOUT_MS = Math.max(
      10,
      Number(config.codexDesktopPermissionPollTimeoutMs || 3500),
    );
    this.CODEX_DESKTOP_QUESTION_POLL_TIMEOUT_MS = Math.max(
      10,
      Number(config.codexDesktopQuestionPollTimeoutMs || 1500),
    );
    this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS = Math.max(
      50,
      Number(config.codexDesktopQuestionActivePollIntervalMs || 200),
    );
    this.CODEX_DESKTOP_QUESTION_IDLE_POLL_INTERVAL_MS = Math.max(
      this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      Number(config.codexDesktopQuestionIdlePollIntervalMs || 750),
    );
    this.CODEX_DESKTOP_QUESTION_REMOTE_POLL_WINDOW_MS = Math.max(
      this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      Number(config.codexDesktopQuestionRemotePollWindowMs || 120000),
    );
    this.VSCODE_CODEX_QUESTION_POLL_TIMEOUT_MS = Math.max(
      10,
      Number(config.vscodeCodexQuestionPollTimeoutMs || 1500),
    );
    this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS = Math.max(
      50,
      Number(config.vscodeCodexQuestionActivePollIntervalMs || 150),
    );
    this.VSCODE_CODEX_QUESTION_IDLE_POLL_INTERVAL_MS = Math.max(
      this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      Number(config.vscodeCodexQuestionIdlePollIntervalMs || 750),
    );
    this.VSCODE_CODEX_QUESTION_REMOTE_POLL_WINDOW_MS = Math.max(
      this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      Number(config.vscodeCodexQuestionRemotePollWindowMs || 120000),
    );
    this.VSCODE_CODEX_QUESTION_MISSING_GRACE_MS = Math.max(
      this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      Number(config.vscodeCodexQuestionMissingGraceMs || 600),
    );
    this.CODEX_CLI_GOAL_MONITOR_INTERVAL_MS = Math.max(
      250,
      Number(config.codexCliGoalMonitorIntervalMs || 750),
    );
    this.CODEX_CLI_GOAL_MONITOR_REQUEST_TIMEOUT_MS = Math.max(
      1000,
      Number(config.codexCliGoalMonitorRequestTimeoutMs || 1800),
    );
    this.CODEX_DESKTOP_SEND_LOCK_WAIT_MS = Math.max(
      1000,
      Number(config.codexDesktopSendLockWaitMs || 30000),
    );

    // Upload directory
    this.LOCAL_UPLOAD_DIR = config.uploadDir || path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(this.LOCAL_UPLOAD_DIR)) fs.mkdirSync(this.LOCAL_UPLOAD_DIR, { recursive: true });
    this._localUploadMaintenanceTimer = null;
    this._lastLocalUploadMaintenanceAt = 0;
    this._localUploadInventory = { retained: 0, retainedBytes: 0 };

    // Codex config path
    this.CODEX_CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'config.toml');
    this.CODEX_DESKTOP_SURFACE_VERSION = config.codexDesktopSurfaceVersion
      || detectCodexDesktopInstalledVersion();
    this.VSCODE_CODEX_SURFACE_VERSION = config.vscodeCodexSurfaceVersion
      || detectVsCodeCodexInstalledVersion();

    // In-memory session runtime state
    this.sessions = new Map();
    this.activePermissionPrompts = new Map();
    this.activeQuestionPromptAdapters = new Map();
    this.activeErrorPrompts = new Map();
    this._codexCliAppServerTurnFactory = config.codexCliAppServerTurnFactory
      || (options => new CodexCliAppServerTurn(options));
    this._codexCliGoalDecisionConnectionFactory = config.codexCliGoalDecisionConnectionFactory
      || (options => new CodexAppServerConnection(options));
    this._codexCliGoalMonitorConnectionFactory = config.codexCliGoalMonitorConnectionFactory
      || (options => new CodexAppServerConnection(options));
    this._codexCliGoalMonitorOwnerProbe = config.codexCliGoalMonitorOwnerProbe
      || ((cliSessionId, options) => codexCli.codexCliSessionOwnerStateAsync(cliSessionId, options));
    this._codexCliGoalMonitorConnection = null;
    this._codexCliGoalMonitorStartPromise = null;
    this._codexCliGoalMonitorInFlight = new Map();
    this._codexCliGoalMonitorTimer = null;
    this._codexVsCodeQuestionResolutionReader = config.codexVsCodeQuestionResolutionReader
      || codexCli.readCodexRequestUserInputResolution;
    this._codexConfigQueues = new Map();
    this._codexConfigPending = new Map();
    this._codexConfigReceipts = new Map();
    this.openWorkspaces = [];
    this._cdpPortCooldownUntil = new Map();
    this._cdpTargetCooldownUntil = new Map();

    // Relay connection state
    this.relayWs = null;
    this.relayReady = false;
    this.connectionId = null;
    this._relayEpoch = 0;
    this.hbIntervalMs = 10000;
    this.hbTimer = null;
    this.reconnectAttempt = 0;
    this.MAX_RECONNECT_DELAY_MS = 60000;
    this._navigationContext = new AsyncLocalStorage();
    this._navigationOperations = new LatestSessionOperationQueue({
      onSupersede: operation => {
        this._sendToRelay({
          ...proto.agentControlResult(
            operation.sessionId,
            operation.requestId,
            operation.command,
            'failed',
            {
              code: 'operation_superseded',
              message: 'A newer navigation selection replaced this request before it started.',
            },
          ),
          navigation_epoch: operation.navigationEpoch,
        });
      },
      onError: (error, operation) => {
        this._log(
          'error',
          `[ctrl] ${operation?.command || 'navigation'} queue failed for ${operation?.sessionId || 'unknown'}: ${error?.message || error}`,
        );
      },
    });

    // Snapshot debounce timer
    this._snapshotTimer = null;
    this._largeHistorySkipLogAt = new Map();
    this._codexCliHistoryChunkRequests = new Map();
    this._cursorCliWatcher = null;
    this._cursorCliHistoryChunkRequests = new Map();

    // Main poll interval handle
    this._pollTimer = null;
    this._pollBudgetTelemetry = {
      durationsMs: [],
      completedTicks: 0,
      lastReportedSkippedTicks: 0,
      latest: null,
    };
    this._antigravityV2PollTimer = null;
    this._antigravityV2PollInProgress = false;
    this._codexDesktopPollTimer = null;
    this._codexDesktopPollInProgress = false;
    this._continueRemotePollTimer = null;
    this._codexCliWatcher = null;
    this._cursorAgentDiscoveryTimer = null;
    this._cursorAgentDiscoveryInProgress = false;
    this._cursorDisconnectClients = new WeakSet();
    this._cursorWorkspacePathCache = { readAt: 0, candidates: [] };

    // Window-staggered polling: rotate which parentId (window) gets polled each tick
    // to avoid rapid CDP interactions across multiple Antigravity windows that cause
    // OS-level focus stealing.
    this._pollWindowIndex = 0;
    this._pollWindowSessionIndexes = new Map();
    this._domPushSecondaryPollTimers = new Map();
    this._domPushSecondaryPollInFlight = new Set();
    this._domPushSecondaryDelayMs = 750;

    // Persistent CDP targets notify the proxy immediately when their DOM
    // changes. Timer polling remains as an adaptive safety/fallback path.
    this._domPush = new CdpDomPushManager({
      log: (level, message) => this._log(level, message),
      onDirty: (sessionId, event) => this._handleDomPush(sessionId, event),
    });

    // Last-good Antigravity quota data is persisted as a strict normalized
    // allowlist.  Raw RPC responses and in-renderer credentials never enter
    // the session store or relay payload.
    this._antigravityQuotaCache = antigravityQuotaCache.hydrateCache(sessionStore)
      || { schemaVersion: 1, fetchedAt: 0, nextRefreshAt: 0, source: null, sourceHistory: [], data: null };
    this._antigravityQuotaRefreshInFlight = null;
    this._antigravityQuotaLastReceipt = null;

    // Provider/account quota aggregation is deliberately proxy-owned: local
    // credentials never cross the relay boundary, and the registry emits only
    // its normalized, redacted public snapshot.
    this._providerUsage = new ProviderUsageRegistry({
      getSessions: () => this.sessions.values(),
      getAntigravityQuota: async context => {
        await this._refreshAntigravityQuotaUsage(context?.force === true);
        return this._antigravityQuotaCache;
      },
      onSnapshot: snapshot => this._sendToRelay({
        type: 'provider_usage_snapshot',
        protocol_version: proto.PROTOCOL_VERSION,
        snapshot,
      }),
      log: (level, message) => this._log(level, message),
      machineLabel: this.MACHINE_LABEL,
      costScanner: new LocalUsageCostScanner(),
    });
    this._providerUsageResetInFlight = null;
    this._codexUsageResetConnectionFactory = config.codexUsageResetConnectionFactory
      || (options => new CodexAppServerConnection(options));
    this._hostResourceMonitor = new HostResourceMonitor({
      getSessions: () => this.sessions.values(),
      onSnapshot: (snapshot, requestId) => this._sendToRelay(proto.hostResourceSnapshot(requestId, snapshot)),
      onLivePoint: (point, subscriberId) => this._sendToRelay({
        type: 'host_resource_live',
        protocol_version: proto.PROTOCOL_VERSION,
        subscription_id: subscriberId,
        point,
      }),
      onDetailSnapshot: (snapshot, subscriberId) => this._sendToRelay({
        type: 'host_resource_detail',
        protocol_version: proto.PROTOCOL_VERSION,
        subscription_id: subscriberId,
        snapshot,
      }),
      log: (level, message) => this._log(level, message),
      machineLabel: this.MACHINE_LABEL,
    });

    // Running flag
    this._running = false;
  }

  // ─── Logging helper ──────────────────────────────────────────────────────

  _log(level, msg) {
    this.emit('log', level, msg);
  }

  _runLocalUploadMaintenance() {
    this._lastLocalUploadMaintenanceAt = Date.now();
    const result = pruneDirectory(this.LOCAL_UPLOAD_DIR, {
      maxAgeMs: LOCAL_UPLOAD_RETENTION_MS,
      maxBytes: LOCAL_UPLOAD_MAX_BYTES,
      maxFiles: LOCAL_UPLOAD_MAX_FILES,
    });
    if (result.removed > 0) {
      this._log('info', `[uploads] Removed ${result.removed} expired/overflow file(s), reclaimed ${result.removedBytes} bytes`);
    }
    this._localUploadInventory = result;
    return result;
  }

  async _handleDomPush(sessionId, event) {
    let session = this.sessions.get(sessionId);
    if (!this._running || !session) return;
    if (session._cursorVirtual) {
      session = Array.from(this.sessions.values()).find(candidate => (
        candidate._cursorVirtual
        && candidate.targetId === session.targetId
        && candidate._cursorNativeActive
      )) || session;
      sessionId = session.session_id;
    }
    const startedAt = Date.now();
    const signalMs = Number.isFinite(event?.sourceAt)
      ? Math.max(0, Date.now() - event.sourceAt)
      : null;
    const signalBreakdown = Number.isFinite(event?.cdpToQueueMs) && Number.isFinite(event?.queueToDispatchMs)
      ? `; cdp=${event.cdpToQueueMs}ms queue=${event.queueToDispatchMs}ms`
      : '';
    this._log('debug', `[push] ${sessionId} DOM signal -> poll${signalMs === null ? '' : ` (${signalMs}ms${signalBreakdown})`}`);
    this._domPush.notePoll(sessionId, session);
    if (session.agentType === 'codex-desktop') {
      await this._pollCodexDesktopQuestionBounded(sessionId);
      if (this._isCodexDesktopQuestionLatencyWindow(sessionId, session)) {
        this._cancelDomPushSecondaryPoll(sessionId);
        this._log('debug', `[push] ${sessionId} native question latency lane active; deferring transcript and permission reads`);
        return;
      }
      this._scheduleDomPushSecondaryPoll(sessionId);
      this._log('debug', `[push] ${sessionId} native question lane complete in ${Date.now() - startedAt}ms; secondary reads scheduled`);
      return;
    } else if (session.agentType === 'codex') {
      await this._pollCodexVsCodeQuestionBounded(sessionId, event?.executionContextId);
      if (this._isCodexVsCodeQuestionLatencyWindow(sessionId, session)) {
        this._cancelDomPushSecondaryPoll(sessionId);
        this._log('debug', `[push] ${sessionId} native VS Code question latency lane active; deferring transcript and permission reads`);
        return;
      }
      this._scheduleDomPushSecondaryPoll(sessionId);
      this._log('debug', `[push] ${sessionId} native VS Code question lane complete in ${Date.now() - startedAt}ms; secondary reads scheduled`);
      return;
    }
    await this._pollSessionBounded(sessionId);
    await this._pollPermissionsBounded(sessionId);
    this._log(
      'debug',
      `[push] ${sessionId} ${session.agentType} poll complete in ${Date.now() - startedAt}ms`
      + `${Number.isFinite(event?.bindingToProxyMs) ? ` (binding=${event.bindingToProxyMs}ms)` : ''}`,
    );
  }

  _cancelDomPushSecondaryPoll(sessionId) {
    const timer = this._domPushSecondaryPollTimers?.get(sessionId);
    if (!timer) return false;
    clearTimeout(timer);
    this._domPushSecondaryPollTimers.delete(sessionId);
    return true;
  }

  _scheduleDomPushSecondaryPoll(sessionId, delayMs = this._domPushSecondaryDelayMs) {
    if (!this._running || !this.sessions.has(sessionId)) return false;
    if (!this._domPushSecondaryPollTimers) this._domPushSecondaryPollTimers = new Map();
    if (!this._domPushSecondaryPollInFlight) this._domPushSecondaryPollInFlight = new Set();
    this._cancelDomPushSecondaryPoll(sessionId);
    const configuredDelayMs = Number(delayMs);
    const effectiveDelayMs = Number.isFinite(configuredDelayMs) && configuredDelayMs > 0
      ? configuredDelayMs
      : 750;
    const timer = setTimeout(() => {
      this._domPushSecondaryPollTimers.delete(sessionId);
      this._runDomPushSecondaryPoll(sessionId).catch(error => {
        this._log('warn', `[push] ${sessionId} secondary poll failed: ${error.message}`);
      });
    }, Math.max(25, effectiveDelayMs));
    timer.unref?.();
    this._domPushSecondaryPollTimers.set(sessionId, timer);
    return true;
  }

  async _runDomPushSecondaryPoll(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!this._running || !session) return false;
    if (!this._domPushSecondaryPollTimers) this._domPushSecondaryPollTimers = new Map();
    if (!this._domPushSecondaryPollInFlight) this._domPushSecondaryPollInFlight = new Set();
    if ((this._priorityControlInFlight || 0) > 0
        || this._isCodexDesktopQuestionLatencyWindow(sessionId, session)
        || this._isCodexVsCodeQuestionLatencyWindow(sessionId, session)
        || this._domPushSecondaryPollInFlight.has(sessionId)) {
      this._scheduleDomPushSecondaryPoll(sessionId);
      return false;
    }
    this._domPushSecondaryPollInFlight.add(sessionId);
    const startedAt = Date.now();
    try {
      await this._pollSessionBounded(sessionId);
      if ((this._priorityControlInFlight || 0) > 0
          || this._isCodexDesktopQuestionLatencyWindow(sessionId, session)
          || this._isCodexVsCodeQuestionLatencyWindow(sessionId, session)) {
        return false;
      }
      await this._pollPermissionsBounded(sessionId);
      this._log('debug', `[push] ${sessionId} ${session.agentType} secondary poll complete in ${Date.now() - startedAt}ms`);
      return true;
    } finally {
      this._domPushSecondaryPollInFlight.delete(sessionId);
    }
  }

  async _runAdaptivePollCycle(sessionId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (!options.force && !this._domPush.shouldRunFallback(sessionId, session)) return false;
    this._domPush.notePoll(sessionId, session);
    if (session.agentType === 'codex-desktop') {
      await this._pollCodexDesktopQuestionBounded(sessionId);
      if (this._isCodexDesktopQuestionLatencyWindow(sessionId, session)) return true;
    } else if (session.agentType === 'codex') {
      await this._pollCodexVsCodeQuestionBounded(sessionId);
      if (this._isCodexVsCodeQuestionLatencyWindow(sessionId, session)) return true;
    }
    await this._pollSessionBounded(sessionId);
    if (options.includePermissions !== false) {
      await this._pollPermissionsBounded(sessionId);
    }
    return true;
  }

  async _syncDomPushObservers() {
    const liveIds = new Set(this.sessions.keys());
    for (const observedId of this._domPush.sessionIds()) {
      if (!liveIds.has(observedId)) await this._domPush.detach(observedId);
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.client?.Runtime
          || this._isEphemeralIframeAgent(session.agentType)
          || (session._cursorVirtual && !session._cursorPageOwner)) {
        await this._domPush.detach(sessionId);
        continue;
      }
      const priorState = this._domPush.getState(sessionId);
      const attached = await this._domPush.attach(sessionId, session.client, {
        resolveContextId: async () => {
          // VS Code Codex is a persistent iframe target. Its native question
          // card mutates inside the cached extension-frame context, not the
          // outer workbench document. Keep page-level surfaces unscoped.
          if (session.agentType !== 'codex' && !session._iframeInnerContextId) return null;
          try {
            if (!Number.isInteger(session.client.Runtime?._innerContextId)) {
              await selectors.cacheInnerContextId(session.client.Runtime);
            }
            session._iframeInnerContextId = Number.isInteger(session.client.Runtime?._innerContextId)
              ? session.client.Runtime._innerContextId
              : null;
          } catch {}
          return Number.isInteger(session._iframeInnerContextId) ? session._iframeInnerContextId : null;
        },
        requireContext: session.agentType === 'codex',
      });
      if (!priorState) {
        this._log(
          attached?.ok ? 'info' : 'warn',
          `[push] ${sessionId} ${session.agentType} observer ${attached?.ok ? 'active' : `fallback (${attached?.reason || 'unavailable'})`}`,
        );
      }
    }
  }

  /** Dedupe high-volume discover lines (windowId map, target counts) to limit proxy.log growth. */
  _logDiscoverDeduped(key, msg) {
    if (!this._discoverLogDedupe) this._discoverLogDedupe = new Map();
    const now = Date.now();
    const prev = this._discoverLogDedupe.get(key);
    if (prev && prev.sig === msg && now - prev.at < 60000) return;
    this._discoverLogDedupe.set(key, { sig: msg, at: now });
    boundOldestMap(this._discoverLogDedupe, RUNTIME_METADATA_MAP_MAX_ENTRIES);
    this._log('info', msg);
  }

  // ─── Antigravity settings helpers ────────────────────────────────────────

  _readAntigravitySettings() {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return {};
      const settingsPath = path.join(appData, 'Antigravity', 'User', 'settings.json');
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeAntigravitySetting(key, value) {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return false;
      const settingsPath = path.join(appData, 'Antigravity', 'User', 'settings.json');
      const data = this._readAntigravitySettings();
      data[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  // ─── Codex config.toml helpers ───────────────────────────────────────────

  _readCodexConfigToml() {
    try {
      return fs.readFileSync(this.CODEX_CONFIG_PATH, 'utf8');
    } catch {
      return '';
    }
  }

  _writeCodexConfigValues(updates) {
    try {
      let toml = this._readCodexConfigToml();
      for (const [key, value] of Object.entries(updates)) {
        const quoted = JSON.stringify(String(value));
        const lineRe = new RegExp(`^${key}\\s*=.*$`, 'm');
        if (lineRe.test(toml)) {
          toml = toml.replace(lineRe, `${key} = ${quoted}`);
        } else {
          const sectionIdx = toml.indexOf('\n[');
          if (sectionIdx !== -1) {
            toml = toml.slice(0, sectionIdx) + `\n${key} = ${quoted}` + toml.slice(sectionIdx);
          } else {
            toml = toml.trimEnd() + `\n${key} = ${quoted}\n`;
          }
        }
      }
      fs.writeFileSync(this.CODEX_CONFIG_PATH, toml, 'utf8');
      return true;
    } catch (e) {
      this._log('error', `[codex-cfg] Write failed: ${e.message}`);
      return false;
    }
  }

  _readGitBranch(workspacePath) {
    if (!workspacePath || workspacePath === 'unknown') return null;
    try {
      const { execFileSync } = require('child_process');
      const branch = execFileSync('git', ['-C', workspacePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 2000, stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim();
      return branch || null;
    } catch { return null; }
  }

  _configuredVsCodeUserDataRoots() {
    return String(process.env.VSCODE_USER_DATA_DIRS || '')
      .split(path.delimiter)
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => path.resolve(value));
  }

  _vsCodeSettingsPathForSession(sessionData) {
    if (sessionData?.host_type !== 'vscode') return null;
    const workspacePath = String(sessionData.workspace_path || '').trim();
    if (!workspacePath) return null;
    let normalizedWorkspace;
    try { normalizedWorkspace = path.resolve(workspacePath).toLowerCase(); } catch { return null; }

    const matches = [];
    for (const root of this._configuredVsCodeUserDataRoots()) {
      const workspaces = readVsCodeWindowPaths({ appData: '', userDataDirs: root });
      if (workspaces.some(workspace => {
        try { return path.resolve(workspace.path).toLowerCase() === normalizedWorkspace; } catch { return false; }
      })) {
        matches.push(root);
      }
    }
    if (matches.length !== 1) return null;
    return path.join(matches[0], 'User', 'settings.json');
  }

  _writeWorkbenchSetting(sessionData, key, value) {
    if (sessionData?.host_type === 'vscode') {
      const settingsPath = this._vsCodeSettingsPathForSession(sessionData);
      if (!settingsPath) return { ok: false, path: null, host: 'VS Code' };
      try {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        data[key] = value;
        fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
        return { ok: true, path: settingsPath, host: 'VS Code' };
      } catch {
        return { ok: false, path: settingsPath, host: 'VS Code' };
      }
    }
    const ok = this._writeAntigravitySetting(key, value);
    const appData = process.env.APPDATA || '';
    return {
      ok,
      path: appData ? path.join(appData, 'Antigravity', 'User', 'settings.json') : null,
      host: 'Antigravity IDE',
    };
  }

  _isGitWorkspace(workspacePath) {
    if (!workspacePath || workspacePath === 'unknown') return false;
    try {
      const { execFileSync } = require('child_process');
      return execFileSync('git', ['-C', workspacePath, 'rev-parse', '--is-inside-work-tree'], {
        timeout: 2000, stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim() === 'true';
    } catch { return false; }
  }

  _listGitBranches(workspacePath) {
    if (!workspacePath || workspacePath === 'unknown') return null;
    try {
      const { execFileSync } = require('child_process');
      const current = this._readGitBranch(workspacePath) || '';
      const raw = execFileSync('git', ['-C', workspacePath, 'branch', '--list', '--no-color'], {
        timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim();
      if (!raw) return { current, branches: [] };
      const branches = raw.split('\n')
        .map(line => line.replace(/^\*?\s*/, '').trim())
        .filter(Boolean);
      return { current, branches };
    } catch { return null; }
  }

  _switchGitBranch(workspacePath, branchName) {
    if (!workspacePath || workspacePath === 'unknown') return { ok: false, error: 'No workspace path' };
    try {
      const { execFileSync } = require('child_process');
      execFileSync('git', ['-C', workspacePath, 'checkout', branchName], {
        timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr?.toString().trim() || err.message };
    }
  }

  _createGitBranch(workspacePath, branchName) {
    if (!workspacePath || workspacePath === 'unknown') return { ok: false, error: 'No workspace path' };
    try {
      const { execFileSync } = require('child_process');
      execFileSync('git', ['-C', workspacePath, 'checkout', '-b', branchName], {
        timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr?.toString().trim() || err.message };
    }
  }

  _readCodexConfigValues() {
    const toml = this._readCodexConfigToml();
    const result = {};
    for (const line of toml.split('\n')) {
      const m = line.match(/^(\w+)\s*=\s*"([^"]*)"$/);
      if (m) result[m[1]] = m[2];
    }
    return result;
  }

  // ─── Agent config helpers ──────────────────────────────────────────────

  _buildCapabilities(agentType, workspacePath = null) {
    const isCursor  = agentType === 'cursor';
    const isCodex   = agentType === 'codex' || agentType === 'codex-desktop';
    const isClaude  = agentType === 'claude' || agentType === 'claude-desktop';
    const isAntigravityV2 = agentType === 'antigravity-v2';
    const isClaudeCli = agentType === 'claude_cli';
    const isCodexCli = agentType === 'codex_cli';
    const isCursorCli = agentType === 'cursor_cli';
    const isStoreBackedCli = isClaudeCli || isCodexCli || isCursorCli;
    const isDesktop = agentType === 'codex-desktop' || agentType === 'claude-desktop' || isCursor;
    const isContinue = agentType === 'continue' || agentType === 'continue_yolo';
    const isRooCode = agentType === 'roo_code';
    const isClineLike = isRooCode || agentType === 'cline';
    const hasWorkspace = (
      typeof workspacePath === 'string'
      && workspacePath !== 'unknown'
      && fs.existsSync(workspacePath)
    );
    const hasGitWorkspace = hasWorkspace && this._isGitWorkspace(workspacePath);
    const interruptMethods = {
      claude: 'native_stop',
      claude_cli: 'owned_process_tree',
      codex_cli: 'turn_interrupt_or_owned_process_tree',
      cursor_cli: 'owned_process_tree',
      codex: 'native_stop',
      gemini: 'native_stop',
      continue: 'native_stop',
      continue_yolo: 'native_stop',
      'antigravity-v2': 'native_stop',
      'claude-desktop': 'native_stop',
      'codex-desktop': 'native_stop',
      cursor: 'native_stop',
      roo_code: 'native_stop',
      cline: 'native_stop',
    };
    const interruptMethod = interruptMethods[agentType] || null;
    return {
      interrupt:              !!interruptMethod,
      interrupt_method:       interruptMethod,
      interrupt_gate:         interruptMethod ? null : 'no_verified_session_scoped_stop',
      // Goal lifecycle is an explicit Codex-family contract. Consumers must
      // ignore stray goal-shaped fields from every other harness.
      goal_lifecycle:         isCodex || isCodexCli,
      goal_pause_resume:      isCodex || isCodexCli,
      set_model:              ['claude', 'claude_cli', 'codex_cli', 'cursor_cli', 'antigravity', 'antigravity_panel', 'gemini', 'continue', 'continue_yolo', 'cursor'].includes(agentType) || isClineLike,
      // Cursor 3.5 Agents UI has no reliable Ask/Edit/Agent/Composer page-level toggle in CDP probes.
      set_mode:               agentType === 'antigravity' || isClineLike,
      permission_mode_change: agentType === 'claude' || isClaudeCli || isCodexCli || isCursorCli || agentType === 'continue_yolo' || isRooCode,
      auto_approve_permissions_toggle: agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'antigravity_panel' || agentType === 'cursor',
      // Headless Codex/Cursor CLI runs have no actionable approval-dialog
      // channel. Their sandbox/access modes are configurable, but native
      // prompts cannot be answered through the JSONL transport, so do not
      // advertise that control.
      // VS Code Codex exposes a conversation-scoped permission profile, but it
      // still has no separately actionable approval-dialog response channel.
      permission_dialogs:     isClaude || isClaudeCli || agentType === 'codex-desktop' || agentType === 'antigravity' || agentType === 'antigravity_panel' || isContinue || isClineLike || isCursor,
      // Independent from permissions and goal lifecycle. Each Codex surface
      // is enabled only after its installed-version native adapter has passed.
      question_prompts:       isCodex || isCodexCli,
      // Codex Desktop retains the legacy restart-scoped bundle. VS Code Codex
      // 26.707.71524 uses the granular, thread-scoped composer controls below.
      set_codex_config:       agentType === 'codex' || agentType === 'codex-desktop',
      codex_model_change:     agentType === 'codex' || agentType === 'codex-desktop',
      codex_effort_change:    agentType === 'codex' || agentType === 'codex-desktop',
      codex_access_change:    agentType === 'codex-desktop',
      codex_speed_change:     agentType === 'codex-desktop',
      codex_permission_profile_change: agentType === 'codex',
      codex_bypass_permissions: agentType === 'codex',
      set_effort:             isClaudeCli || isCodexCli,
      new_thread:             isDesktop,
      thread_list:            isDesktop,
      switch_thread:          isDesktop,
      switch_workspace:       agentType === 'codex-desktop' || agentType === 'claude-desktop',
      // Cursor IDE is already the native surface. The open-native-window command
      // launches CLI processes only and must not be advertised for the IDE.
      // Claude Code 2.1.207 exits a prompt-less `--resume <id>` with
      // "No deferred tool marker found" instead of reopening the TUI. A new
      // Claude chat still opens its initial native window, but an advertised
      // reopen control would fail for every transcript-backed session.
      native_window:          isCodexCli || isCursorCli,
      open_panel:             false, // Codex side pane is already open if session exists
      // Continue 2.0's workbench tabs are editor tabs, not native Continue
      // conversations. Do not expose them as chat history until the extension
      // provides an addressable native history surface.
      chat_list:              agentType === 'codex' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || isCursor || isClineLike || isAntigravityV2,
      switch_chat:            agentType === 'codex' || agentType === 'antigravity_panel' || agentType === 'claude-desktop' || isCursor || isClineLike || isAntigravityV2,
      new_chat:               agentType === 'codex' || agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'antigravity_panel' || agentType === 'antigravity-v2' || agentType === 'claude-desktop' || agentType === 'cursor' || agentType === 'claude' || isClaudeCli || isCodexCli || isCursorCli || isClineLike,
      // Cursor integrated terminal renders via xterm canvas — DOM/a11y read returns [] (see cursor-cdp-notes.md).
      terminal_output:        isCodex || agentType === 'claude-desktop',
      // Current Codex Desktop has command transcript blocks but no addressable
      // xterm/input surface. Do not advertise a control that can only fail.
      terminal_input:         isCursor,
      // Cursor 3.5 applies edits immediately and exposes only Review/Commit;
      // the former Keep/Undo actions no longer exist. Keep the transcript's
      // expanded diff blocks, but do not advertise a dead reversible control.
      file_changes:           isCodex || agentType === 'claude-desktop',
      send_attachment:        isCodex,
      // Cursor workspaces are not necessarily Git repositories. Avoid rendering
      // branch controls that can only return git_error for the current session.
      branch_list:            !isAntigravityV2 && hasGitWorkspace,
      switch_branch:          !isAntigravityV2 && hasGitWorkspace,
      create_branch:          !isAntigravityV2 && hasGitWorkspace,
      skill_list:             agentType === 'codex-desktop',
      automation_view:        agentType === 'codex-desktop',
      file_browser:           !isAntigravityV2 && hasWorkspace, // v2 exposes only a worktree label until a real path is verified
    };
  }

  _configLogSummary(config, capabilities = null) {
    const cfg = config && typeof config === 'object' ? config : {};
    const caps = capabilities && typeof capabilities === 'object' ? capabilities : cfg.capabilities;
    return {
      model_id: cfg.model_id || 'unknown',
      mode: cfg.mode || cfg.conversation_mode || undefined,
      permission_mode: cfg.permission_mode || undefined,
      file_access_scope: cfg.file_access_scope || undefined,
      branch: cfg.branch || undefined,
      capabilities: caps ? Object.keys(caps).filter(key => caps[key] === true).sort() : undefined,
    };
  }

  _readJsonFileIfPresent(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  _modelOption(id, label) {
    const value = String(id || '').trim();
    if (!value) return null;
    return { id: value, label: String(label || value).trim() || value };
  }

  _mergeModelOptions(...lists) {
    const out = [];
    const seen = new Set();
    const add = item => {
      const option = typeof item === 'string'
        ? this._modelOption(item)
        : this._modelOption(item?.id || item?.value || item?.model || item?.name, item?.label || item?.name || item?.id);
      if (!option) return;
      const key = option.id.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(option);
    };
    for (const list of lists) {
      if (Array.isArray(list)) list.forEach(add);
      else if (list) add(list);
    }
    return out;
  }

  _readRooOllamaModelOptions() {
    const appdata = process.env.APPDATA;
    if (!appdata) return [];
    const filePath = path.join(appdata, 'Antigravity', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'cache', 'ollama_models.json');
    const data = this._readJsonFileIfPresent(filePath);
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data)
      .map(([id, info]) => this._modelOption(id, info?.name || id))
      .filter(Boolean);
  }

  _readClineHistoryModelOptions() {
    const appdata = process.env.APPDATA;
    if (!appdata) return [];
    const filePath = path.join(appdata, 'Antigravity', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'state', 'taskHistory.json');
    const data = this._readJsonFileIfPresent(filePath);
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.tasks) ? data.tasks : []);
    return rows
      .map(row => row?.modelId || row?.model_id)
      .filter(Boolean)
      .map(id => this._modelOption(id))
      .filter(Boolean);
  }

  _stripProviderPrefix(modelId) {
    const raw = String(modelId || '').trim();
    const match = raw.match(/^(anthropic|openai|openrouter|gemini|lmstudio|vscode-lm|ollama|hicap|requesty|cline):(.+)$/i);
    return match ? match[2].trim() : raw;
  }

  _augmentClineLikeModels(agentType, domCfg) {
    const current = this._stripProviderPrefix(domCfg?.model_id);
    const domModels = Array.isArray(domCfg?.available_models)
      ? domCfg.available_models.map(model => {
          if (typeof model === 'string') return this._stripProviderPrefix(model);
          const id = this._stripProviderPrefix(model?.id || model?.value || model?.model || model?.name);
          return { ...model, id, label: model?.label || id };
        })
      : [];
    if (agentType === 'cline') {
      return this._mergeModelOptions(
        current && current !== 'unknown' ? current : null,
        domModels,
        this._readClineHistoryModelOptions(),
        this._readRooOllamaModelOptions()
      );
    }
    return this._mergeModelOptions(
      current && current !== 'unknown' ? current : null,
      domModels,
      this._readRooOllamaModelOptions()
    );
  }

  _stabilizeCursorModelOptions(session, cfg) {
    if (!session || session.agentType !== 'cursor' || !cfg) return cfg;
    if (Array.isArray(cfg.available_models) && cfg.available_models.length > 0) {
      session._lastAvailableModels = cfg.available_models;
    } else if (Array.isArray(session._lastAvailableModels) && session._lastAvailableModels.length > 0) {
      cfg.available_models = session._lastAvailableModels;
    }
    return cfg;
  }

  _mergeAgentConfig(agentType, domCfg, workspacePath) {
    const branch = this._readGitBranch(workspacePath);
    const codexCfg = this._readCodexConfigValues();
    if (agentType === 'claude') {
      const settings = this._readAntigravitySettings();
      const permMode  = domCfg?.permission_mode || settings['claudeCode.initialPermissionMode'] || 'unknown';
      const settingsModel = settings['claudeCode.selectedModel'];
      const modelId = (domCfg?.model_id && domCfg.model_id !== 'unknown')
        ? domCfg.model_id
        : ((settingsModel && settingsModel !== 'default') ? settingsModel : 'unknown');
      return {
        model_id:          modelId,
        mode:              domCfg?.mode || permMode,
        permission_mode:   permMode,
        effort:            domCfg?.effort || 'unknown',
        file_access_scope: workspacePath || 'unknown',
        available_permission_modes: Array.isArray(domCfg?.available_permission_modes) && domCfg.available_permission_modes.length > 0
          ? domCfg.available_permission_modes
          : CLAUDE_CODE_PERMISSION_MODES,
        available_efforts: Array.isArray(domCfg?.available_efforts) && domCfg.available_efforts.length > 0
          ? domCfg.available_efforts
          : CLAUDE_CODE_EFFORTS,
        available_models:  Array.isArray(domCfg?.available_models) && domCfg.available_models.length > 0
          ? domCfg.available_models
          : CLAUDE_CODE_MODELS,
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'claude_cli') {
      return {
        model_id:          domCfg?.model_id || 'default',
        permission_mode:   domCfg?.permission_mode || 'default',
        effort:            domCfg?.effort || 'medium',
        file_access_scope: workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:  claudeCli.CLAUDE_CLI_MODELS,
        available_efforts: claudeCli.CLAUDE_CLI_EFFORTS,
        available_permission_modes: claudeCli.CLAUDE_CLI_PERMISSION_MODES,
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'codex_cli') {
      return {
        model_id:          domCfg?.model_id || 'unknown',
        observed_model_id: domCfg?.observed_model_id || domCfg?.model_id || 'unknown',
        observed_model_raw: domCfg?.observed_model_raw || null,
        model_provenance:  domCfg?.model_provenance || null,
        next_send_model_id: domCfg?.next_send_model_id || null,
        next_send_model_status: domCfg?.next_send_model_status || 'unset',
        next_send_model_error: domCfg?.next_send_model_error || null,
        active_launch_model_id: domCfg?.active_launch_model_id || null,
        active_launch_model_provenance: domCfg?.active_launch_model_provenance || null,
        effective_model_id: domCfg?.effective_model_id || domCfg?.observed_model_id || domCfg?.next_send_model_id || 'unknown',
        effective_model_provenance: domCfg?.effective_model_provenance || 'unknown',
        permission_mode:   domCfg?.permission_mode || domCfg?.access_mode || 'workspace-write',
        approval_policy:   domCfg?.approval_policy || null,
        effort:            domCfg?.effort || 'unknown',
        observed_effort:   domCfg?.observed_effort || domCfg?.effort || 'unknown',
        observed_effort_raw: domCfg?.observed_effort_raw || null,
        effort_provenance: domCfg?.effort_provenance || null,
        next_send_effort:  domCfg?.next_send_effort || null,
        next_send_effort_status: domCfg?.next_send_effort_status || 'unset',
        next_send_effort_error: domCfg?.next_send_effort_error || null,
        active_launch_effort: domCfg?.active_launch_effort || null,
        active_launch_effort_provenance: domCfg?.active_launch_effort_provenance || null,
        effective_effort: domCfg?.effective_effort || domCfg?.observed_effort || domCfg?.next_send_effort || 'unknown',
        effective_effort_provenance: domCfg?.effective_effort_provenance || 'unknown',
        file_access_scope: workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:  codexCli.CODEX_CLI_MODELS,
        available_efforts: codexCli.CODEX_CLI_EFFORTS,
        model_catalog:     {
          source: codexCli.CODEX_CLI_CATALOG.source,
          fetched_at: codexCli.CODEX_CLI_CATALOG.fetched_at,
          client_version: codexCli.CODEX_CLI_CATALOG.client_version,
        },
        config_semantics:  'observed_and_next_send',
        available_permission_modes: codexCli.CODEX_CLI_ACCESS_MODES,
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'cursor_cli') {
      return {
        model_id:          domCfg?.model_id || 'grok-4.5-fast-high',
        permission_mode:   domCfg?.permission_mode || 'force',
        sandbox:           domCfg?.sandbox || 'disabled',
        file_access_scope: workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:  cursorCli.CURSOR_CLI_MODELS,
        available_permission_modes: cursorCli.CURSOR_CLI_PERMISSION_MODES,
        available_sandbox_modes: cursorCli.CURSOR_CLI_SANDBOX_MODES,
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'codex') {
      // Never fall back to ~/.codex/config.toml for the VS Code extension.
      // That file is global and cannot truthfully describe the selected native
      // conversation. Unknown native values remain unknown until the frame is
      // readable again.
      const modelId = domCfg?.model_id && domCfg.model_id !== 'unknown'
        ? domCfg.model_id
        : 'unknown';
      const effort = normalizeCodexEffort(domCfg?.effort || 'unknown');
      const permissionMode = domCfg?.permission_mode && domCfg.permission_mode !== 'unknown'
        ? domCfg.permission_mode
        : 'unknown';
      const speed = domCfg?.speed && domCfg.speed !== 'unknown'
        ? normalizeCodexSpeed(domCfg.speed)
        : 'unknown';
      const includeCurrent = (catalog, current, label) => {
        const options = catalog.map(option => ({ ...option }));
        if (current && current !== 'unknown' && !options.some(option => option.id === current)) {
          options.unshift({ id: current, label: label || current, current_only: true });
        }
        return options;
      };
      const controlsAvailable = domCfg?.conversation_scoped === true;
      return {
        model_id:           modelId,
        permission_mode:    permissionMode,
        permission_profile: domCfg?.permission_profile || 'unknown',
        approval_policy:    domCfg?.approval_policy || null,
        approvals_reviewer: domCfg?.approvals_reviewer || null,
        bypass_permissions_active: domCfg?.bypass_permissions_active === true,
        conversation_scoped: controlsAvailable,
        controls_available: controlsAvailable,
        controls_unavailable_reason: controlsAvailable
          ? null
          : 'Send the first message before changing controls so Codex can scope them to this conversation.',
        effort:             effort,
        speed:              speed,
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   includeCurrent(VSCODE_CODEX_MODELS, modelId, modelId),
        available_efforts:  includeCurrent(VSCODE_CODEX_EFFORTS, effort, effort),
        available_access:   permissionMode === 'unknown'
          ? []
          : [{ id: permissionMode, label: permissionMode, current_only: true, read_only: true }],
        available_permission_profiles: includeCurrent(
          VSCODE_CODEX_PERMISSION_PROFILES,
          domCfg?.permission_profile,
          domCfg?.permission_profile,
        ),
        available_speeds:   [],
        model_catalog: {
          ...VSCODE_CODEX_CATALOG,
          degraded: modelId !== 'unknown' && !VSCODE_CODEX_MODELS.some(option => option.id === modelId),
        },
        effort_catalog: { ...VSCODE_CODEX_CATALOG, degraded: false },
        permission_catalog: { ...VSCODE_CODEX_CATALOG, degraded: false },
        config_semantics:   'next_turn_native',
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'cursor') {
      const cursorSel = require('./cursor-selectors');
      const cfg = domCfg || {};
      return {
        model_id:          cfg.model_id || 'unknown',
        mode:              cfg.mode || 'unknown',
        available_models:  cfg.available_models || cursorSel.readCursorSettingsModels(),
        available_modes:   cfg.available_modes || [],
        file_access_scope: workspacePath || cfg.file_access_scope || 'unknown',
        branch:            branch || 'unknown',
      };
    }
    if (agentType === 'codex-desktop') {
      const modelId = (domCfg?.model_id && domCfg.model_id !== 'unknown')
        ? domCfg.model_id
        : (codexCfg.model || 'unknown');
      const effort = normalizeCodexEffort((domCfg?.effort && domCfg.effort !== 'unknown')
        ? domCfg.effort
        : (codexCfg.model_reasoning_effort || codexCfg.reasoning_effort || 'unknown'));
      const permissionMode = (domCfg?.permission_mode && domCfg.permission_mode !== 'unknown')
        ? domCfg.permission_mode
        : (codexCfg.sandbox_mode || 'unknown');
      const speed = normalizeCodexSpeed((domCfg?.speed && domCfg.speed !== 'unknown')
        ? domCfg.speed
        : (codexCfg.service_tier || codexCfg.model_speed || codexCfg.speed || 'standard'));
      return {
        model_id:           modelId,
        permission_mode:    permissionMode,
        effort:             effort,
        speed:              speed,
        file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
        available_models:   CODEX_MODELS,
        available_efforts:  CODEX_EFFORTS,
        available_access:   CODEX_ACCESS_MODES,
        available_speeds:   CODEX_SPEEDS,
        branch:             branch || 'unknown',
        sandbox_status:     domCfg?.sandbox_status  || null,
      };
    }
    if (agentType === 'continue' || agentType === 'continue_yolo') {
      return {
        model_id:           domCfg?.model_id        || 'unknown',
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   domCfg?.available_models || [],
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'roo_code') {
      const availableModels = this._augmentClineLikeModels(agentType, domCfg);
      const modelId = this._stripProviderPrefix(domCfg?.model_id) || 'unknown';
      return {
        model_id:           modelId,
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   availableModels,
        available_modes:    domCfg?.available_modes || [],
        available_permission_modes: domCfg?.available_permission_modes || [],
        has_model_dropdown: !!domCfg?.has_model_dropdown,
        has_mode_control:   !!domCfg?.has_mode_control,
        has_permission_dropdown: !!domCfg?.has_permission_dropdown,
        branch:             branch || 'unknown',
      };
    }
    if (agentType === 'cline') {
      const availableModels = this._augmentClineLikeModels(agentType, domCfg);
      const modelId = this._stripProviderPrefix(domCfg?.model_id) || 'unknown';
      return {
        model_id:           modelId,
        mode:               domCfg?.mode            || 'unknown',
        permission_mode:    domCfg?.permission_mode || 'unknown',
        file_access_scope:  workspacePath || 'unknown',
        available_models:   availableModels,
        available_modes:    domCfg?.available_modes || [],
        available_permission_modes: domCfg?.available_permission_modes || [],
        has_model_dropdown: !!domCfg?.has_model_dropdown,
        has_mode_control:   !!domCfg?.has_mode_control,
        has_permission_dropdown: !!domCfg?.has_permission_dropdown,
        branch:             branch || 'unknown',
      };
    }
    return {
      model_id:           domCfg?.model_id           || 'unknown',
      conversation_mode:  domCfg?.conversation_mode  || 'unknown',
      permission_mode:    domCfg?.permission_mode    || 'unknown',
      file_access_scope:  workspacePath || domCfg?.file_access_scope || 'unknown',
      branch:             branch || 'unknown',
    };
  }

  _decorateAgentConfig(session, config) {
    const decorated = {
      ...config,
      auto_approve_permissions: !!session?.autoApprovePermissions,
    };
    if (session?.agentType === 'codex') {
      decorated.bypass_restore_profile = session._codexSafePermissionProfile || null;
      const revisionShape = {
        model_id: decorated.model_id || 'unknown',
        effort: decorated.effort || 'unknown',
        permission_profile: decorated.permission_profile || 'unknown',
        permission_mode: decorated.permission_mode || 'unknown',
        approval_policy: decorated.approval_policy || null,
        conversation_scoped: decorated.conversation_scoped === true,
      };
      decorated.source_revision = `codex-${crypto.createHash('sha256')
        .update(JSON.stringify(revisionShape))
        .digest('hex')
        .slice(0, 20)}`;
      session._codexConfigRevision = decorated.source_revision;
    }
    if (session?.agentType === 'claude') {
      const stableModelId = session._currentModelId || session.model_id;
      if ((!decorated.model_id || decorated.model_id === 'unknown') && stableModelId) {
        decorated.model_id = stableModelId;
      }
      if ((!Array.isArray(decorated.available_models) || decorated.available_models.length === 0)
          && Array.isArray(session._lastAvailableModels) && session._lastAvailableModels.length > 0) {
        decorated.available_models = session._lastAvailableModels;
      }
    }
    return decorated;
  }

  _codexConfigIntent(msg, agentType) {
    const fieldNames = ['model_id', 'effort', 'speed', 'access_mode', 'permission_profile', 'workspace_mode'];
    const fields = fieldNames.filter(field => msg[field] !== undefined && msg[field] !== null);
    if (fields.length !== 1) {
      return { ok: false, code: 'invalid_message', message: 'Exactly one Codex config field is required.' };
    }
    const field = fields[0];
    const value = msg[field];
    if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
      return { ok: false, code: 'invalid_message', message: `Invalid Codex config ${field}.` };
    }
    if (typeof msg.request_id !== 'string' || !msg.request_id || msg.request_id.length > 200) {
      return { ok: false, code: 'invalid_message', message: 'A bounded request id is required.' };
    }
    if (msg.source_revision !== undefined
        && (typeof msg.source_revision !== 'string' || !msg.source_revision || msg.source_revision.length > 200)) {
      return { ok: false, code: 'invalid_message', message: 'Invalid Codex config source revision.' };
    }
    const allowed = agentType === 'codex'
      ? new Set(['model_id', 'effort', 'permission_profile'])
      : new Set(['model_id', 'effort', 'speed', 'access_mode']);
    if (!allowed.has(field)) {
      return { ok: false, code: 'not_supported', message: `${field} is not supported for ${agentType || 'unknown'}.` };
    }
    if (field === 'model_id' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) {
      return { ok: false, code: 'invalid_value', message: 'Invalid Codex model id.' };
    }
    if (field === 'effort' && !new Set(['light', 'low', 'medium', 'high', 'extra-high', 'ultra']).has(value)) {
      return { ok: false, code: 'invalid_value', message: 'Unsupported Codex effort.' };
    }
    if (field === 'speed' && !new Set(['standard', 'fast']).has(value)) {
      return { ok: false, code: 'invalid_value', message: 'Unsupported Codex speed.' };
    }
    if (field === 'access_mode' && !new Set(['read-only', 'workspace-write', 'danger-full-access']).has(value)) {
      return { ok: false, code: 'invalid_value', message: 'Unsupported Codex access mode.' };
    }
    if (field === 'permission_profile'
        && !new Set(['auto', 'guardian-approvals', 'full-access', 'custom']).has(value)) {
      return { ok: false, code: 'invalid_value', message: 'Unsupported Codex permission profile.' };
    }
    if (field === 'permission_profile' && value === 'full-access' && msg.confirm_bypass !== true) {
      return { ok: false, code: 'confirmation_required', message: 'Full access requires explicit bypass confirmation.' };
    }
    if (msg.confirm_bypass === true && !(field === 'permission_profile' && value === 'full-access')) {
      return { ok: false, code: 'invalid_message', message: 'Bypass confirmation is only valid for Full access.' };
    }
    return { ok: true, field, value };
  }

  _codexReadbackMatches(intent, readback) {
    if (!readback) return false;
    if (intent.field === 'model_id') return readback.model_id === intent.value;
    if (intent.field === 'effort') return normalizeCodexEffort(readback.effort) === normalizeCodexEffort(intent.value);
    if (intent.field === 'speed') return normalizeCodexSpeed(readback.speed) === normalizeCodexSpeed(intent.value);
    if (intent.field === 'access_mode') return readback.permission_mode === intent.value;
    if (intent.field === 'permission_profile') {
      if (readback.permission_profile !== intent.value) return false;
      if (intent.value !== 'full-access') return readback.bypass_permissions_active !== true;
      return readback.permission_mode === 'danger-full-access'
        && readback.approval_policy === 'never'
        && readback.bypass_permissions_active === true;
    }
    return false;
  }

  _codexRollbackUpdate(intent, before) {
    if (!before) return null;
    if (intent.field === 'model_id' && before.model_id && before.model_id !== 'unknown') {
      return { model_id: before.model_id };
    }
    if (intent.field === 'effort' && before.effort && before.effort !== 'unknown') {
      return { effort: before.effort };
    }
    if (intent.field === 'permission_profile'
        && before.permission_profile
        && before.permission_profile !== 'unknown') {
      return {
        permission_profile: before.permission_profile,
        confirm_bypass: before.permission_profile === 'full-access',
      };
    }
    return null;
  }

  _rememberCodexConfigReceipt(key, receipt) {
    if (this._codexConfigReceipts.has(key)) this._codexConfigReceipts.delete(key);
    this._codexConfigReceipts.set(key, receipt);
    while (this._codexConfigReceipts.size > CODEX_CONFIG_CONTROL_CACHE_MAX) {
      this._codexConfigReceipts.delete(this._codexConfigReceipts.keys().next().value);
    }
  }

  _sendCodexConfigReceipt(key, sessionId, requestId, result, details) {
    const receipt = proto.agentControlResult(sessionId, requestId, 'set_codex_config', result, details);
    this._rememberCodexConfigReceipt(key, receipt);
    this._sendToRelay(receipt);
    return receipt;
  }

  async _applyVsCodeCodexConfig(msg, sessionData, intent, requestKey) {
    const sid = msg.session_id || msg.session;
    const requestId = msg.request_id;
    let before = null;
    let setterStarted = false;
    try {
      before = await selectors.readAgentConfig(sessionData.client.Runtime, 'codex', sessionData.workspace_path);
      if (this.sessions.get(sid) !== sessionData) {
        throw Object.assign(new Error('The selected Codex frame changed before the control could apply.'), { code: 'stale_frame' });
      }
      const current = this._decorateAgentConfig(sessionData, this._mergeAgentConfig('codex', before, sessionData.workspace_path));
      if (msg.source_revision
          && msg.source_revision !== current.source_revision
          && msg._sourceRevisionAcceptedAtQueue !== true) {
        throw Object.assign(new Error('The native Codex settings changed. Refresh and try again.'), { code: 'stale_config' });
      }
      if (before?.conversation_scoped !== true) {
        throw Object.assign(new Error('Send the first message before changing controls so Codex can scope them to this conversation.'), { code: 'conversation_required' });
      }

      const update = { [intent.field]: intent.value };
      if (intent.field === 'access_mode') update.access_mode = intent.value;
      if (intent.field === 'permission_profile') update.confirm_bypass = msg.confirm_bypass === true;
      if (intent.field === 'permission_profile'
          && intent.value === 'full-access'
          && before.permission_profile
          && !['unknown', 'full-access'].includes(before.permission_profile)) {
        sessionData._codexSafePermissionProfile = before.permission_profile;
      }
      setterStarted = true;
      const result = await selectors.setCodexComposerConfig(
        sessionData.client.Runtime,
        update,
        false,
        null,
      );
      if (this.sessions.get(sid) !== sessionData) {
        throw Object.assign(new Error('The selected Codex frame changed while the control was applying.'), { code: 'stale_frame' });
      }
      if (result?.ok === false) {
        throw Object.assign(new Error(result.detail || 'Native Codex rejected the setting.'), { code: result.code || 'native_rejected' });
      }
      const resultKey = intent.field === 'model_id' ? 'model'
        : intent.field === 'permission_profile' ? 'permissions'
          : intent.field === 'access_mode' ? 'access'
            : intent.field;
      if (result?.[resultKey]?.ok !== true) {
        throw Object.assign(new Error(result?.[resultKey]?.detail || 'Native Codex did not select the requested option.'), { code: 'native_rejected' });
      }

      const readback = await selectors.readAgentConfig(sessionData.client.Runtime, 'codex', sessionData.workspace_path);
      if (this.sessions.get(sid) !== sessionData) {
        throw Object.assign(new Error('The selected Codex frame changed before read-back.'), { code: 'stale_frame' });
      }
      if (!this._codexReadbackMatches(intent, readback)) {
        throw Object.assign(new Error('Native Codex read-back did not match the requested setting.'), { code: 'readback_mismatch' });
      }
      const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig('codex', readback, sessionData.workspace_path));
      this._sendToRelay(proto.agentConfig(sid, {
        ...merged,
        capabilities: this._buildCapabilities('codex', sessionData.workspace_path),
      }));
      this._sendCodexConfigReceipt(requestKey, sid, requestId, 'ok', {
        field: intent.field,
        value: intent.value,
        source_revision: merged.source_revision,
        readback: {
          model_id: merged.model_id,
          effort: merged.effort,
          permission_profile: merged.permission_profile,
          permission_mode: merged.permission_mode,
          approval_policy: merged.approval_policy,
          bypass_permissions_active: merged.bypass_permissions_active === true,
        },
      });
    } catch (error) {
      let rollback = 'not_needed';
      if (setterStarted && this.sessions.get(sid) === sessionData) {
        const rollbackUpdate = this._codexRollbackUpdate(intent, before);
        if (rollbackUpdate) {
          try {
            const current = await selectors.readAgentConfig(sessionData.client.Runtime, 'codex', sessionData.workspace_path);
            if (!this._codexReadbackMatches({ ...intent, value: before[intent.field] }, current)) {
              const rollbackResult = await selectors.setCodexComposerConfig(
                sessionData.client.Runtime,
                rollbackUpdate,
                false,
                null,
              );
              const restored = await selectors.readAgentConfig(sessionData.client.Runtime, 'codex', sessionData.workspace_path);
              rollback = rollbackResult && this._codexReadbackMatches({ ...intent, value: before[intent.field] }, restored)
                ? 'restored'
                : 'failed';
            }
          } catch {
            rollback = 'failed';
          }
        }
      }
      this._sendCodexConfigReceipt(requestKey, sid, requestId, 'failed', {
        code: error?.code || 'exception',
        message: error?.message || 'Codex config control failed.',
        rollback,
      });
    }
  }

  _queueVsCodeCodexConfig(msg, sessionData, intent) {
    const sid = msg.session_id || msg.session;
    const requestKey = `${sid}\u0001${msg.request_id}`;
    const completed = this._codexConfigReceipts.get(requestKey);
    if (completed) {
      this._sendToRelay(completed);
      return;
    }
    if (this._codexConfigPending.has(requestKey)) return;
    const queuedMessage = {
      ...msg,
      _sourceRevisionAcceptedAtQueue: !msg.source_revision
        || msg.source_revision === sessionData._codexConfigRevision,
    };
    const previous = this._codexConfigQueues.get(sid) || Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(() => this._applyVsCodeCodexConfig(queuedMessage, sessionData, intent, requestKey));
    this._codexConfigPending.set(requestKey, work);
    const tail = work.finally(() => {
      this._codexConfigPending.delete(requestKey);
      if (this._codexConfigQueues.get(sid) === tail) this._codexConfigQueues.delete(sid);
    });
    this._codexConfigQueues.set(sid, tail);
  }

  _supportsAutoApprovePermissions(agentType) {
    return agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'antigravity_panel' || agentType === 'cursor';
  }

  _normalizeAutoApprovePreferencePart(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\\/]+/g, '/')
      .replace(/\s+/g, ' ');
  }

  _buildAutoApprovePreferenceKey(agentType, context = {}) {
    if (!this._supportsAutoApprovePermissions(agentType)) return null;
    const workspacePath = this._normalizeAutoApprovePreferencePart(context.workspacePath);
    const workspaceName = this._normalizeAutoApprovePreferencePart(context.workspaceName);
    const windowTitle = this._normalizeAutoApprovePreferencePart(context.windowTitle);
    const base = workspacePath || workspaceName || windowTitle;
    if (!base) return null;
    return `${agentType}|${base}`;
  }

  _resolveAutoApproveState(agentType, sessionMeta, context = {}) {
    const preferenceKey = this._buildAutoApprovePreferenceKey(agentType, context);
    const pref = preferenceKey ? sessionStore.getPreference(preferenceKey) : null;
    const enabled = pref?.auto_approve_permissions === true || sessionMeta?.auto_approve_permissions === true;
    if (enabled && preferenceKey && pref?.auto_approve_permissions !== true) {
      sessionStore.updatePreference(preferenceKey, { auto_approve_permissions: true });
    }
    return { enabled, preferenceKey };
  }

  _refreshSessionPreferenceKey(session) {
    if (!session || !this._supportsAutoApprovePermissions(session.agentType)) return;
    const preferenceKey = this._buildAutoApprovePreferenceKey(session.agentType, {
      workspacePath: session.workspace_path,
      workspaceName: session.workspace_name,
      windowTitle: session.windowTitle,
    });
    if (!preferenceKey || preferenceKey === session.preferenceKey) return;
    session.preferenceKey = preferenceKey;
    if (session.autoApprovePermissions) {
      sessionStore.updatePreference(preferenceKey, { auto_approve_permissions: true });
    }
  }

  _selectAutoApproveChoice(prompt) {
    const choices = Array.isArray(prompt?.choices) ? prompt.choices : [];
    const positivePatterns = [
      /\baccept\b/i,
      /\ballow\b/i,
      /\bapprove\b/i,
      /\brun\b/i,
      /\bcontinue\b/i,
      /\bproceed\b/i,
      // Antigravity surfaces a "Running background command" prompt with
      // [Relocate / Always run / Cancel] after a long-running command starts.
      // Relocate just dismisses the UI prompt (the command keeps running),
      // so treat it as the auto-approve action to clear the dialog.
      /\brelocate\b/i,
    ];
    // "always run"/"allow always" are mode toggles on dropdowns (e.g. Antigravity
    // side panel) — selecting them changes the permission setting but does not
    // actually approve the pending action. Skip them so we fall through to the
    // real Run/Accept button.
    const negativePattern = /\b(reject|deny|cancel|block|stop|not now|always)\b/i;
    for (const choice of choices) {
      const label = String(choice?.label || choice?.title || choice?.text || choice?.choice_id || '').trim();
      const cid = String(choice?.choice_id || choice?.id || choice?.value || '').trim();
      if (!label || negativePattern.test(label) || negativePattern.test(cid)) continue;
      if (positivePatterns.some(pattern => pattern.test(label))) {
        return choice.choice_id || choice.id || choice.value || null;
      }
    }
    return null;
  }

  async _attemptAutoApprovePrompt(sessionId, session, prompt, surfacedToRelay = false) {
    if (!session || !session.autoApprovePermissions || !this._supportsAutoApprovePermissions(session.agentType)) {
      return false;
    }
    // AskUserQuestion is a request for user intent, not a permission grant. Never infer
    // an answer from labels such as "Proceed" even when auto-approve is enabled.
    if (prompt?.kind === 'question') return false;
    const choiceId = this._selectAutoApproveChoice(prompt);
    if (!choiceId) return false;

    this.activePermissionPrompts.set(sessionId, {
      prompt_id: prompt.prompt_id,
      prompt,
      surfaced: false,
      auto_pending: true,
    });
    this._log('info', `[${sessionId}] [perm] Auto-approving "${choiceId}"`);

    try {
      const permissionPromise = this._isEphemeralIframeAgent(session.agentType)
        ? this._withEphemeralIframeClient(session, client =>
            selectors.respondToPermissionDialog(client.Runtime, session.agentType, choiceId, sessionId, client)
          , 'permission_response')
        : selectors.respondToPermissionDialog(session.client.Runtime, session.agentType, choiceId, sessionId, session.client);
      const result = await permissionPromise;
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (!result.ok) {
        this._log('warn', `[${sessionId}] [perm] Auto-approve failed: ${result.detail || result.code || 'unknown'}`);
        return false;
      }
      if (surfacedToRelay) {
        this._sendToRelay({
          type:             'permission_prompt_expired',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id:       sessionId,
          prompt_id:        prompt.prompt_id,
          applied_choice:   choiceId,
          expired_at:       new Date().toISOString(),
        });
      }
      return true;
    } catch (err) {
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      this._log('warn', `[${sessionId}] [perm] Auto-approve exception: ${err.message}`);
      return false;
    }
  }

  async _handlePermissionDialogState(sessionId, session, perm) {
    if (perm) {
      const promptId = this._makePromptId(sessionId, perm.message, perm.choices);
      const last = this.activePermissionPrompts.get(sessionId);
      const isSameAsLast = last && last.prompt_id === promptId;

      // Same prompt as last poll — if it's already been surfaced to the webui
      // and auto-approve is now on (or a previous auto-approve attempt failed),
      // retry the click so the webui prompt clears once the click lands.
      // Without this, a prompt that fails initial auto-approve (e.g. button
      // not rendered yet) gets stuck on the webui forever.
      if (isSameAsLast) {
        if (session?.autoApprovePermissions && last.surfaced) {
          if (await this._attemptAutoApprovePrompt(sessionId, session, last.prompt, true)) {
            return;
          }
        }
        return;
      }

      const prompt = proto.permissionPrompt(sessionId, {
        prompt_id:        promptId,
        message:          perm.message,
        choices:          perm.choices,
        ...(perm.title ? { title: perm.title } : {}),
        ...(perm.command ? { command: perm.command } : {}),
        ...(perm.description ? { description: perm.description } : {}),
        ...(perm.alternate_instruction_supported === true ? { alternate_instruction_supported: true } : {}),
        ...(perm.alternate_instruction_placeholder ? { alternate_instruction_placeholder: perm.alternate_instruction_placeholder } : {}),
        ...(perm.cancel_hint ? { cancel_hint: perm.cancel_hint } : {}),
        ...(perm.kind ? { kind: perm.kind } : {}),
        ...(Array.isArray(perm.questions) ? { questions: perm.questions } : {}),
        ...(perm.submit_label ? { submit_label: perm.submit_label } : {}),
        timeout_ms:       300000,
      });

      if (await this._attemptAutoApprovePrompt(sessionId, session, prompt, false)) {
        return;
      }

      // Diagnostic-only prompts (no actionable choices) — log and skip relay.
      if (perm.message?.startsWith?.('[fwc-diag]')) {
        this._log('info', `[${sessionId}] [perm] ${perm.message.substring(0, 1500)}`);
        return;
      }

      this._log('info', `[${sessionId}] [perm] Permission dialog detected: "${perm.message.substring(0, 60)}..."`);
      this.activePermissionPrompts.set(sessionId, { prompt_id: promptId, prompt, surfaced: true });
      this._sendToRelay(prompt);
      return;
    }

    if (this.activePermissionPrompts.has(sessionId)) {
      const last = this.activePermissionPrompts.get(sessionId);
      this._log('info', `[${sessionId}] [perm] Permission dialog dismissed`);
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (last?.surfaced) {
        this._sendToRelay({
          type:             'permission_prompt_expired',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id:       sessionId,
          prompt_id:        last.prompt_id,
          expired_at:       new Date().toISOString(),
        });
      }
    }
  }

  // ─── Panel management helpers ───────────────────────────────────────────

  _hasOpenCodexDesktopQuestion(sessionId) {
    const entry = this.activeQuestionPromptAdapters.get(sessionId);
    return entry?.adapter_surface === 'codex-desktop';
  }

  _hasOpenCodexVsCodeQuestion(sessionId) {
    const entry = this.activeQuestionPromptAdapters.get(sessionId);
    return entry?.adapter_surface === 'codex';
  }

  _isCodexVsCodeQuestionLatencyWindow(sessionId, session = this.sessions.get(sessionId), now = Date.now()) {
    return session?.agentType === 'codex'
      && (Number(session._vscodeQuestionRemotePollUntil || 0) > now
        || this._hasOpenCodexVsCodeQuestion(sessionId));
  }

  _isCodexDesktopQuestionLatencyWindow(sessionId, session = this.sessions.get(sessionId), now = Date.now()) {
    return session?.agentType === 'codex-desktop'
      && (Number(session._codexDesktopQuestionRemotePollUntil || 0) > now
        || this._hasOpenCodexDesktopQuestion(sessionId));
  }

  _scheduleCodexVsCodeQuestionPoll(sessionId, session, delayMs) {
    if (!session || session._vscodeQuestionPollTimer) return;
    session._vscodeQuestionPollTimer = setTimeout(() => {
      session._vscodeQuestionPollTimer = null;
      this._pollCodexVsCodeQuestionBounded(sessionId).catch(error => {
        this._log('warn', `[${sessionId}] [question] Scheduled VS Code poll error: ${error.message}`);
      });
    }, Math.max(10, Number(delayMs) || 10));
    session._vscodeQuestionPollTimer.unref?.();
  }

  _scheduleCodexVsCodeQuestionDeadlinePoll(sessionId, session, deadlineMs, delayMs = null) {
    if (!session || !Number.isFinite(Number(deadlineMs))) return;
    if (session._vscodeQuestionDeadlineTimer) clearTimeout(session._vscodeQuestionDeadlineTimer);
    const dueMs = delayMs == null
      ? Math.max(10, Math.round(Number(deadlineMs) - Date.now() + 25))
      : Math.max(10, Math.round(Number(delayMs) || 10));
    session._vscodeQuestionDeadlineTimer = setTimeout(() => {
      session._vscodeQuestionDeadlineTimer = null;
      try {
        this._pollCodexVsCodeQuestionDeadlineReceipt(sessionId, Number(deadlineMs));
      } catch (error) {
        this._log('warn', `[${sessionId}] [question] Deadline VS Code poll error: ${error.message}`);
      }
    }, dueMs);
    session._vscodeQuestionDeadlineTimer.unref?.();
  }

  _scheduleCodexDesktopQuestionPoll(sessionId, session, delayMs) {
    if (!session || session._questionPollTimer) return;
    session._questionPollTimer = setTimeout(() => {
      session._questionPollTimer = null;
      this._pollCodexDesktopQuestionBounded(sessionId).catch(error => {
        this._log('warn', `[${sessionId}] [question] Scheduled Desktop poll error: ${error.message}`);
      });
    }, Math.max(10, Number(delayMs) || 10));
    session._questionPollTimer.unref?.();
  }

  async _withFreshCodexDesktopQuestionClient(session, work, reason = 'poll') {
    if (!session?.targetId || !session?._cdpPort) {
      const error = new Error('Codex Desktop question target identity is unavailable');
      error.code = 'CODEX_DESKTOP_QUESTION_TARGET_UNAVAILABLE';
      throw error;
    }
    const shortId = String(session.session_id || session.targetId).substring(0, 8);
    let client = null;
    try {
      client = await this._connectCdpTarget(
        { id: session.targetId, _cdpHost: session._cdpHost || null },
        session._cdpPort,
        `Codex Desktop question ${reason} connect ${shortId}`,
        2500,
      );
      await this._withTimeout(
        client.Runtime.enable(),
        1000,
        `Codex Desktop question ${reason} Runtime.enable ${shortId}`,
      );
      return await work(client);
    } finally {
      await this._safeClose(client, `Codex Desktop question ${reason} close ${shortId}`);
    }
  }

  async _handleCodexDesktopQuestionState(sessionId, session, observed) {
    const existing = this.activeQuestionPromptAdapters.get(sessionId);
    const isDesktopEntry = existing?.adapter_surface === 'codex-desktop';
    if (observed?.error) {
      const signature = `${observed.error}:${observed.count || ''}:${observed.detail || ''}`;
      if (session._lastCodexDesktopQuestionError !== signature) {
        session._lastCodexDesktopQuestionError = signature;
        this._log('warn', `[${sessionId}] [question] Codex Desktop fail-closed: ${signature}`);
      }
      return;
    }
    session._lastCodexDesktopQuestionError = null;
    if (!observed) {
      if (isDesktopEntry && existing.claimed !== true) {
        const deadlineMs = Date.parse(existing.prompt.deadline_at || '');
        const autoResolved = Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;
        this._clearQuestionPromptAdapter(sessionId, autoResolved ? 'auto_resolved' : 'expired', {
          error_code: autoResolved ? 'native_auto_resolution' : 'native_question_disappeared',
        });
      }
      return;
    }

    let activeThreadKey = String(session._activeThreadKey || session.codexDesktopActiveThreadKey || '');
    if (observed.active_thread_proven === true
        && observed.native_thread_id
        && !codexDesktopThreadKeysMatch(activeThreadKey, observed.native_thread_id)) {
      this._applyCodexDesktopActiveThread(sessionId, session, {
        id: observed.native_thread_id,
        cache_key: observed.native_thread_id,
        title: observed.native_thread_title || '',
        active: true,
      }, { refreshMetadata: false });
      activeThreadKey = String(session._activeThreadKey || session.codexDesktopActiveThreadKey || '');
    }
    if (!activeThreadKey || !codexDesktopThreadKeysMatch(activeThreadKey, observed.native_thread_id)) {
      this._log('warn', `[${sessionId}] [question] Refusing Desktop prompt outside exact active thread ${activeThreadKey || '(unknown)'}`);
      return;
    }
    session._codexDesktopQuestionRemotePollUntil = 0;
    const signatureDigest = crypto.createHash('sha256')
      .update(String(observed.native_signature || ''))
      .digest('hex');
    if (isDesktopEntry
        && existing.native_thread_id === observed.native_thread_id
        && existing.native_signature_digest === signatureDigest) {
      return;
    }
    if (isDesktopEntry) {
      if (existing.claimed === true) return;
      this._clearQuestionPromptAdapter(sessionId, 'expired', { error_code: 'native_question_replaced' });
    } else if (existing) {
      this._log('warn', `[${sessionId}] [question] Refusing to replace a non-Desktop owned question adapter`);
      return;
    }

    const observedMs = Date.now();
    const remainingSeconds = observed.auto_resolution_seconds_remaining == null
      ? null
      : Number(observed.auto_resolution_seconds_remaining);
    const autoResolutionMs = remainingSeconds != null && Number.isFinite(remainingSeconds) && remainingSeconds >= 0
      ? Math.round(remainingSeconds * 1000)
      : null;
    let prompt;
    try {
      prompt = canonicalQuestionPrompt({
        prompt_id: crypto.randomUUID(),
        session_id: sessionId,
        generation: crypto.createHash('sha256')
          .update(`${this.PROXY_ID}\0${sessionId}\0${observed.native_thread_id}\0${signatureDigest}\0${crypto.randomUUID()}`)
          .digest('hex'),
        kind: 'request_user_input',
        source: { surface: 'codex-desktop', version: this.CODEX_DESKTOP_SURFACE_VERSION },
        title: observed.title,
        questions: observed.questions,
        native_at: null,
        observed_at: new Date(observedMs).toISOString(),
        deadline_at: autoResolutionMs == null ? null : new Date(observedMs + autoResolutionMs).toISOString(),
        auto_resolution_ms: autoResolutionMs,
        auto_resolution_policy: observed.auto_resolution_policy,
        cancel_supported: observed.cancel_supported === true,
      });
    } catch (error) {
      this._log('warn', `[${sessionId}] [question] Invalid Desktop question contract: ${error.code || error.message}`);
      return;
    }

    const adapterIdentity = {
      adapter_surface: 'codex-desktop',
      native_thread_id: observed.native_thread_id,
      native_signature: observed.native_signature,
      native_signature_digest: signatureDigest,
      skip_label: observed.skip_label || 'Skip',
    };
    this._registerQuestionPromptAdapter(sessionId, prompt, async rawResponse => {
      let response;
      try {
        response = canonicalQuestionResponse(prompt, rawResponse);
      } catch (error) {
        return {
          ok: false,
          native_attempted: false,
          retryable: true,
          code: error instanceof QuestionContractError ? error.code : 'invalid_question_response',
          detail: error.message,
        };
      }
      let answerStarted = false;
      const answerLockRelease = await acquireCodexDesktopCdpLock(
        `proxy-question-answer-${sessionId}`,
        { waitMs: this.CODEX_DESKTOP_SEND_LOCK_WAIT_MS || 30000 },
      );
      if (!answerLockRelease) {
        return {
          ok: false,
          native_attempted: false,
          retryable: true,
          code: 'codex_desktop_cdp_busy',
          detail: `Codex Desktop CDP remained busy for ${this.CODEX_DESKTOP_SEND_LOCK_WAIT_MS || 30000}ms`,
        };
      }
      try {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession || currentSession !== session || !currentSession.client) {
          return { ok: false, native_attempted: false, retryable: false, code: 'desktop_session_changed', detail: 'The native Desktop session changed' };
        }
        return await this._withFreshCodexDesktopQuestionClient(currentSession, async questionClient => {
          answerStarted = true;
          const result = await selectors.respondToCodexDesktopQuestion(
            questionClient.Runtime,
            response,
            { ...adapterIdentity, prompt },
          );
          if (result?.ok && result.native_acknowledged === true) {
            const nativeActivity = await selectors.detectThinking(questionClient.Runtime, 'codex-desktop').catch(() => null);
            const waiting = currentSession.pendingLast !== null || currentSession.waitingForAssistant;
            const kind = nativeActivity?.thinking ? 'thinking' : (waiting ? 'generating' : 'idle');
            const nextActivity = {
              kind,
              label: nativeActivity?.label || (kind === 'idle' ? '' : 'Generating'),
              updated_at: new Date().toISOString(),
            };
            currentSession._activityEpoch = Number(currentSession._activityEpoch || 0) + 1;
            currentSession.activity = nextActivity;
            sessionStore.updateSession(sessionId, { activity: nextActivity });
            this._sendToRelay(proto.proxyStatus(sessionId, currentSession.status || 'healthy', nextActivity));
          }
          return result;
        }, 'answer');
      } catch (error) {
        this._log('warn', `[${sessionId}] [question] Desktop answer client error: ${error.message}`);
        return {
          ok: false,
          native_attempted: answerStarted,
          retryable: !answerStarted,
          code: answerStarted ? 'desktop_question_answer_uncertain' : 'desktop_question_client_unavailable',
          detail: error.message,
        };
      } finally {
        answerLockRelease();
      }
    }, adapterIdentity);
    this._log(
      'info',
      `[${sessionId}] [question] Codex Desktop prompt detected on exact native thread ${observed.native_thread_id}`,
    );

    const attention = {
      kind: 'waiting_for_user',
      label: observed.title || 'Needs input',
      updated_at: new Date().toISOString(),
      ...(session.activity?.goal ? { goal: session.activity.goal } : {}),
    };
    session._activityEpoch = Number(session._activityEpoch || 0) + 1;
    session.activity = attention;
    sessionStore.updateSession(sessionId, { activity: attention });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', attention));
  }

  _readCodexVsCodeQuestionResolution(existing) {
    const deadlineMs = Date.parse(existing?.prompt?.deadline_at || '');
    if (!Number.isFinite(deadlineMs) || Date.now() < deadlineMs - 2000) return null;
    const reader = this._codexVsCodeQuestionResolutionReader
      || codexCli.readCodexRequestUserInputResolution;
    try {
      return reader(existing.native_conversation_id, {
        turnId: existing.native_turn_id,
        questions: existing.prompt.questions,
        deadlineMs,
      });
    } catch (error) {
      this._log('warn', `[question] VS Code native resolution read failed: ${error.message}`);
      return null;
    }
  }

  _finishCodexVsCodeQuestionFromNative(sessionId, session, existing) {
    if (!existing || existing.claimed === true) return false;
    const resolution = this._readCodexVsCodeQuestionResolution(existing);
    if (!resolution?.native_acknowledged) return false;
    session._codexVsCodeQuestionTerminalSignature = existing.native_signature;
    const errorCode = resolution.lifecycle === 'auto_resolved'
      ? 'native_auto_resolution'
      : resolution.lifecycle === 'answered'
        ? 'native_answered_locally'
        : 'native_question_cancelled';
    this._clearQuestionPromptAdapter(sessionId, resolution.lifecycle, { error_code: errorCode });
    this._log(
      'info',
      `[${sessionId}] [question] VS Code Codex native terminal ${resolution.lifecycle} `
        + `for conversation ${existing.native_conversation_id} turn ${existing.native_turn_id}`,
    );
    return true;
  }

  async _finishCodexVsCodeQuestionFromNativeDom(sessionId, session, existing) {
    if (!existing || existing.claimed === true || !session?.client?.Runtime) return false;
    let resolution = null;
    try {
      const timeoutMs = Math.max(100, Math.min(
        1500,
        Number(this.VSCODE_CODEX_QUESTION_POLL_TIMEOUT_MS || 1500),
      ));
      resolution = await this._withTimeout(
        Promise.resolve().then(() => selectors.detectCodexVsCodeQuestionReceipt(
          session.client.Runtime,
          { ...existing, prompt: existing.prompt },
        )),
        timeoutMs,
        `VS Code native DOM receipt ${String(sessionId).slice(0, 8)}`,
      );
    } catch (error) {
      this._log('warn', `[${sessionId}] [question] VS Code native DOM receipt read failed: ${error.message}`);
      return false;
    }
    if (!resolution || resolution.error || resolution.native_acknowledged !== true
        || !['answered', 'auto_resolved', 'cancelled'].includes(resolution.lifecycle)) return false;
    session._codexVsCodeQuestionTerminalSignature = existing.native_signature;
    const errorCode = resolution.lifecycle === 'auto_resolved'
      ? 'native_auto_resolution'
      : resolution.lifecycle === 'answered'
        ? 'native_answered_locally'
        : 'native_question_cancelled';
    this._clearQuestionPromptAdapter(sessionId, resolution.lifecycle, { error_code: errorCode });
    this._log(
      'info',
      `[${sessionId}] [question] VS Code Codex native DOM terminal ${resolution.lifecycle} `
        + `for conversation ${existing.native_conversation_id} turn ${existing.native_turn_id}`,
    );
    return true;
  }

  _pollCodexVsCodeQuestionDeadlineReceipt(sessionId, expectedDeadlineMs) {
    const session = this.sessions.get(sessionId);
    const existing = this.activeQuestionPromptAdapters.get(sessionId);
    if (!session || session.agentType !== 'codex' || existing?.adapter_surface !== 'codex') return false;
    const deadlineMs = Date.parse(existing.prompt?.deadline_at || '');
    if (!Number.isFinite(deadlineMs) || deadlineMs !== Number(expectedDeadlineMs)) return false;
    if (Date.now() < deadlineMs) {
      this._scheduleCodexVsCodeQuestionDeadlinePoll(sessionId, session, deadlineMs);
      return true;
    }
    if (this._finishCodexVsCodeQuestionFromNative(sessionId, session, existing)) return true;
    if (Date.now() <= deadlineMs + VSCODE_CODEX_NATIVE_DEADLINE_RECEIPT_GRACE_MS) {
      this._scheduleCodexVsCodeQuestionDeadlinePoll(sessionId, session, deadlineMs, 100);
      return true;
    }
    session._codexVsCodeQuestionTerminalSignature = existing.native_signature;
    this._clearQuestionPromptAdapter(sessionId, 'expired', {
      error_code: 'native_resolution_receipt_missing',
    });
    return true;
  }

  _reconcileCodexVsCodeQuestionReceiptForCliSession(cliSessionId) {
    const exactCliSessionId = String(cliSessionId || '');
    if (!exactCliSessionId) return 0;
    let matched = 0;
    for (const [sessionId, existing] of this.activeQuestionPromptAdapters.entries()) {
      if (existing?.adapter_surface !== 'codex'
          || existing.native_conversation_id !== exactCliSessionId
          || existing.claimed === true) continue;
      const deadlineMs = Date.parse(existing.prompt?.deadline_at || '');
      if (!Number.isFinite(deadlineMs) || Date.now() < deadlineMs - 2000) continue;
      matched += 1;
      this._pollCodexVsCodeQuestionDeadlineReceipt(sessionId, deadlineMs);
    }
    return matched;
  }

  async _readCodexVsCodeQuestionCallEvidence(observed) {
    const reader = this._codexVsCodeQuestionCallEvidenceReader
      || codexCli.readCodexRequestUserInputCallEvidence;
    const options = {
      turnId: observed.native_turn_id,
      questions: observed.questions.map(question => ({
        question_id: question.question_id,
        header: question.header,
        message: question.question,
        choices: question.options,
      })),
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const evidence = reader(observed.native_conversation_id, options);
        if (evidence?.native_at) return evidence;
      } catch (error) {
        this._log('warn', `[question] VS Code native producer timestamp read failed: ${error.message}`);
        return null;
      }
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 20));
    }
    return null;
  }

  _sweepCodexVsCodeQuestionDeadlineReceipts() {
    let checked = 0;
    const now = Date.now();
    for (const [sessionId, existing] of this.activeQuestionPromptAdapters.entries()) {
      if (existing?.adapter_surface !== 'codex' || existing.claimed === true) continue;
      const deadlineMs = Date.parse(existing.prompt?.deadline_at || '');
      if (!Number.isFinite(deadlineMs) || now < deadlineMs) continue;
      if (!existing.deadline_sweep_observed_at) {
        existing.deadline_sweep_observed_at = new Date(now).toISOString();
        this._log(
          'info',
          `[${sessionId}] [question] Engine deadline receipt sweep entered at ${now - deadlineMs}ms`,
        );
      }
      checked += 1;
      this._pollCodexVsCodeQuestionDeadlineReceipt(sessionId, deadlineMs);
    }
    return checked;
  }

  _sweepCodexVsCodeActiveQuestionPolls() {
    const now = Date.now();
    let started = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session?.agentType !== 'codex'
          || now >= Number(session._vscodeQuestionRemotePollUntil || 0)
          || this._hasOpenCodexVsCodeQuestion(sessionId)) continue;
      started += 1;
      this._pollCodexVsCodeQuestionBounded(sessionId).catch(error => {
        this._log('warn', `[${sessionId}] [question] Active VS Code sweep error: ${error.message}`);
      });
    }
    return started;
  }

  _reconcileCodexVsCodeQuestionDeadline(sessionId, session, existing) {
    const deadlineMs = Date.parse(existing?.prompt?.deadline_at || '');
    if (!Number.isFinite(deadlineMs) || Date.now() < deadlineMs) return false;
    return this._pollCodexVsCodeQuestionDeadlineReceipt(sessionId, deadlineMs);
  }

  async _handleCodexVsCodeQuestionState(sessionId, session, observed) {
    const existing = this.activeQuestionPromptAdapters.get(sessionId);
    const isVsCodeEntry = existing?.adapter_surface === 'codex';
    if (observed?.error) {
      const signature = `${observed.error}:${observed.count || ''}:${observed.detail || ''}`;
      if (session._lastCodexVsCodeQuestionError !== signature) {
        session._lastCodexVsCodeQuestionError = signature;
        this._log('warn', `[${sessionId}] [question] VS Code Codex fail-closed: ${signature}`);
      }
      return;
    }
    session._lastCodexVsCodeQuestionError = null;
    if (!observed) {
      session._codexVsCodeQuestionTerminalSignature = null;
      if (isVsCodeEntry && existing.claimed !== true) {
        const deadlineMs = Date.parse(existing.prompt?.deadline_at || '');
        if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs
            && this._finishCodexVsCodeQuestionFromNative(sessionId, session, existing)) return;
        if (await this._finishCodexVsCodeQuestionFromNativeDom(sessionId, session, existing)) return;
        if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs
            && Date.now() <= deadlineMs + VSCODE_CODEX_NATIVE_DEADLINE_RECEIPT_GRACE_MS) {
          this._scheduleCodexVsCodeQuestionPoll(sessionId, session, 100);
        }
        if (this._reconcileCodexVsCodeQuestionDeadline(sessionId, session, existing)) return;
        const now = Date.now();
        const missingSince = Number(session._codexVsCodeQuestionMissingSince || 0);
        const graceMs = Math.max(0, Number(this.VSCODE_CODEX_QUESTION_MISSING_GRACE_MS || 600));
        if (!missingSince || now - missingSince < graceMs) {
          if (!missingSince) session._codexVsCodeQuestionMissingSince = now;
          this._scheduleCodexVsCodeQuestionPoll(
            sessionId,
            session,
            Math.max(25, Math.min(
              Number(this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS || 150),
              graceMs - (missingSince ? now - missingSince : 0),
            )),
          );
          return;
        }
        session._codexVsCodeQuestionMissingSince = 0;
        this._clearQuestionPromptAdapter(sessionId, 'expired', {
          error_code: 'native_question_disappeared',
        });
      } else if (!isVsCodeEntry) {
        session._codexVsCodeQuestionMissingSince = 0;
      }
      return;
    }
    session._codexVsCodeQuestionMissingSince = 0;
    if (session._codexVsCodeQuestionTerminalSignature === observed.native_signature) return;
    if (session._codexVsCodeQuestionTerminalSignature) {
      session._codexVsCodeQuestionTerminalSignature = null;
    }

    const proxyKnownConversation = String(session._activeCodexChatId || '');
    if (/^[0-9a-f-]{20,}$/i.test(proxyKnownConversation)
        && proxyKnownConversation !== observed.native_conversation_id) {
      this._log('warn', `[${sessionId}] [question] Refusing VS Code prompt outside proxy-selected conversation ${proxyKnownConversation}`);
      return;
    }
    const signatureDigest = crypto.createHash('sha256')
      .update(String(observed.native_signature || ''))
      .digest('hex');
    if (isVsCodeEntry
        && existing.native_conversation_id === observed.native_conversation_id
        && existing.native_turn_id === observed.native_turn_id
        && existing.native_request_id === observed.native_request_id
        && existing.native_signature_digest === signatureDigest) {
      const deadlineMs = Date.parse(existing.prompt?.deadline_at || '');
      if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs) {
        if (this._finishCodexVsCodeQuestionFromNative(sessionId, session, existing)) return;
        if (await this._finishCodexVsCodeQuestionFromNativeDom(sessionId, session, existing)) return;
      }
      if (this._reconcileCodexVsCodeQuestionDeadline(sessionId, session, existing)) return;
      return;
    }
    if (isVsCodeEntry) {
      if (existing.claimed === true) return;
      this._clearQuestionPromptAdapter(sessionId, 'expired', { error_code: 'native_question_replaced' });
    } else if (existing) {
      this._log('warn', `[${sessionId}] [question] Refusing to replace a non-VS-Code owned question adapter`);
      return;
    }

    const observedMs = Date.now();
    session._vscodeQuestionRemotePollUntil = 0;
    const nativeDeadlineMs = observed.native_deadline_ms == null
      ? null
      : Number(observed.native_deadline_ms);
    const exactDeadlineMs = nativeDeadlineMs != null && Number.isFinite(nativeDeadlineMs)
      && nativeDeadlineMs >= observedMs
      ? Math.round(nativeDeadlineMs)
      : null;
    const remainingSeconds = observed.auto_resolution_seconds_remaining == null
      ? null
      : Number(observed.auto_resolution_seconds_remaining);
    const autoResolutionMs = exactDeadlineMs != null
      ? exactDeadlineMs - observedMs
      : remainingSeconds != null && Number.isFinite(remainingSeconds) && remainingSeconds >= 0
        ? Math.round(remainingSeconds * 1000)
        : null;
    const nativeCallEvidence = await this._readCodexVsCodeQuestionCallEvidence(observed);
    let prompt;
    try {
      prompt = canonicalQuestionPrompt({
        prompt_id: crypto.randomUUID(),
        session_id: sessionId,
        generation: crypto.createHash('sha256')
          .update(`${this.PROXY_ID}\0${sessionId}\0${session.targetId || ''}\0${observed.native_conversation_id}\0${observed.native_turn_id}\0${observed.native_request_id}\0${signatureDigest}\0${crypto.randomUUID()}`)
          .digest('hex'),
        kind: 'request_user_input',
        source: { surface: 'codex', version: this.VSCODE_CODEX_SURFACE_VERSION },
        title: observed.title,
        questions: observed.questions,
        native_at: nativeCallEvidence?.native_at || null,
        observed_at: new Date(observedMs).toISOString(),
        deadline_at: exactDeadlineMs == null
          ? (autoResolutionMs == null ? null : new Date(observedMs + autoResolutionMs).toISOString())
          : new Date(exactDeadlineMs).toISOString(),
        auto_resolution_ms: autoResolutionMs,
        auto_resolution_policy: observed.auto_resolution_policy,
        cancel_supported: observed.cancel_supported === true,
      });
    } catch (error) {
      this._log('warn', `[${sessionId}] [question] Invalid VS Code question contract: ${error.code || error.message}`);
      return;
    }

    const adapterIdentity = {
      adapter_surface: 'codex',
      target_id: session.targetId,
      cdp_port: Number(session._cdpPort || 0),
      native_conversation_id: observed.native_conversation_id,
      native_turn_id: observed.native_turn_id,
      native_request_id: observed.native_request_id,
      native_signature: observed.native_signature,
      native_signature_digest: signatureDigest,
      skip_label: observed.skip_label || 'Skip',
    };
    this._registerQuestionPromptAdapter(sessionId, prompt, async rawResponse => {
      let response;
      try {
        response = canonicalQuestionResponse(prompt, rawResponse);
      } catch (error) {
        return {
          ok: false,
          native_attempted: false,
          retryable: true,
          code: error instanceof QuestionContractError ? error.code : 'invalid_question_response',
          detail: error.message,
        };
      }
      const currentSession = this.sessions.get(sessionId);
      if (!currentSession || !currentSession.client
          || currentSession.agentType !== 'codex'
          || currentSession.targetId !== adapterIdentity.target_id
          || Number(currentSession._cdpPort || 0) !== adapterIdentity.cdp_port) {
        return { ok: false, native_attempted: false, retryable: false, code: 'vscode_session_changed', detail: 'The native VS Code Codex session or target changed' };
      }
      try {
        const expectedAnswers = expectedCodexQuestionAnswers(prompt, response);
        const readNativeResolution = () => {
          const reader = this._codexVsCodeQuestionResolutionReader
            || codexCli.readCodexRequestUserInputResolution;
          return reader(adapterIdentity.native_conversation_id, {
            turnId: adapterIdentity.native_turn_id,
            questions: prompt.questions,
            deadlineMs: Date.parse(prompt.deadline_at || ''),
            expectedAnswers,
          });
        };
        const result = await selectors.respondToCodexVsCodeQuestion(
          currentSession.client.Runtime,
          currentSession.client.Input,
          response,
          { ...adapterIdentity, prompt, readNativeResolution },
        );
        if (result?.ok && result.native_acknowledged === true) {
          const nativeActivity = await selectors.detectThinking(currentSession.client.Runtime, 'codex').catch(() => null);
          const waiting = currentSession.pendingLast !== null || currentSession.waitingForAssistant;
          const kind = nativeActivity?.thinking ? 'thinking' : (waiting ? 'generating' : 'idle');
          const nextActivity = {
            kind,
            label: nativeActivity?.label || (kind === 'idle' ? '' : 'Generating'),
            updated_at: new Date().toISOString(),
          };
          currentSession._activityEpoch = Number(currentSession._activityEpoch || 0) + 1;
          currentSession.activity = nextActivity;
          sessionStore.updateSession(sessionId, { activity: nextActivity });
          this._sendToRelay(proto.proxyStatus(sessionId, currentSession.status || 'healthy', nextActivity));
        }
        return result;
      } catch (error) {
        this._log('warn', `[${sessionId}] [question] VS Code answer error: ${error.message}`);
        return {
          ok: false,
          native_attempted: false,
          retryable: true,
          code: 'vscode_question_answer_failed',
          detail: error.message,
        };
      }
    }, adapterIdentity);
    if (exactDeadlineMs != null) {
      this._scheduleCodexVsCodeQuestionDeadlinePoll(sessionId, session, exactDeadlineMs);
    }
    this._log(
      'info',
      `[${sessionId}] [question] VS Code Codex prompt detected on native conversation ${observed.native_conversation_id} `
        + `turn ${observed.native_turn_id}`,
    );

    const attention = {
      kind: 'waiting_for_user',
      label: observed.title || 'Needs input',
      updated_at: new Date().toISOString(),
      ...(session.activity?.goal ? { goal: session.activity.goal } : {}),
    };
    session._activityEpoch = Number(session._activityEpoch || 0) + 1;
    session.activity = attention;
    sessionStore.updateSession(sessionId, { activity: attention });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', attention));
  }

  async _openCodexPanelViaWorkbench(sessionId, requestId, sessionData) {
    const cdpPort = sessionData?._cdpPort || this.CDP_PORTS[0];
    let targets;
    try {
      targets = await CDP.List({ port: cdpPort });
    } catch (e) {
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'cdp_unavailable', message: 'Cannot list CDP targets',
      }));
      return;
    }

    // Find the workbench page (same window as the session if possible)
    const workbenchPages = targets.filter(t =>
      t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    if (workbenchPages.length === 0) {
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'no_workbench', message: 'No Antigravity workbench page found',
      }));
      return;
    }

    // Prefer the workbench page matching the session's parentId
    let workbenchTarget = workbenchPages[0];
    if (sessionData?.parentId) {
      for (const page of workbenchPages) {
        let pageClient;
        try {
          pageClient = await CDP({ port: cdpPort, target: page.id });
          await pageClient.Runtime.enable();
          const res = await pageClient.Runtime.evaluate({
            expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
            returnByValue: true,
          });
          await pageClient.close();
          if (res.result?.value === sessionData.parentId) {
            workbenchTarget = page;
            break;
          }
        } catch {
          if (pageClient) try { await pageClient.close(); } catch {}
        }
      }
    }

    let client;
    try {
      client = await CDP({ port: cdpPort, target: workbenchTarget.id });
      await client.Runtime.enable();
      const result = await selectors.openCodexPanel(client.Runtime);
      await this._safeClose(client);

      if (result.ok) {
        this._log('info', `[ctrl] open_panel OK for ${sessionId}: method=${result.method} detail=${result.detail}`);
        this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'ok'));
      } else {
        this._log('warn', `[ctrl] open_panel failed for ${sessionId}: ${result.detail}`);
        this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
          code: 'icon_not_found', message: result.detail || 'Could not find Codex activity bar icon',
        }));
      }
    } catch (e) {
      await this._safeClose(client);
      this._log('warn', `[ctrl] open_panel error for ${sessionId}: ${e.message}`);
      this._sendToRelay(proto.agentControlResult(sessionId, requestId, 'open_panel', 'failed', {
        code: 'cdp_error', message: e.message,
      }));
    }
  }

  // ─── Workspace discovery helpers ─────────────────────────────────────────

  _stripEditorWindowTitleDecorations(value) {
    return String(value || '')
      .replace(/\s+\(Workspace\)$/i, '')
      .replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i, '')
      .trim();
  }

  _isEditorAppChromeLabel(value) {
    return /^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.test(String(value || '').trim());
  }

  _parseEditorWindowTitleParts(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const parts = raw.split(/\s+-\s+/)
      .map(part => this._stripEditorWindowTitleDecorations(part))
      .filter(Boolean);
    while (parts.length && this._isEditorAppChromeLabel(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts;
  }

  _workspaceTitleFromEditorWindowTitle(value) {
    const parts = this._parseEditorWindowTitleParts(value);
    if (parts.length >= 2) return parts[parts.length - 1];
    return null;
  }

  _readCursorWindowPaths(force = false) {
    const now = Date.now();
    if (!force
        && this._cursorWorkspacePathCache.candidates.length > 0
        && now - this._cursorWorkspacePathCache.readAt < 30000) {
      return this._cursorWorkspacePathCache.candidates.slice();
    }
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return [];
      const userRoot = path.join(appData, 'Cursor', 'User');
      const candidates = [];
      const addPath = (candidatePath, title = null) => {
        if (!candidatePath) return;
        const normalized = path.normalize(candidatePath);
        candidates.push({ title: title || path.basename(normalized) || normalized, path: normalized });
      };
      const addWorkspaceFile = (workspacePath) => {
        if (!workspacePath || !fs.existsSync(workspacePath)) return;
        try {
          const raw = fs.readFileSync(workspacePath, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/,\s*([}\]])/g, '$1');
          const workspace = JSON.parse(raw);
          for (const folder of workspace.folders || []) {
            const folderPath = folder.path
              ? path.resolve(path.dirname(workspacePath), folder.path)
              : cursorFileUriToPath(folder.uri);
            addPath(folderPath, folder.name || null);
          }
        } catch {}
      };

      const storagePath = path.join(userRoot, 'globalStorage', 'storage.json');
      if (fs.existsSync(storagePath)) {
        const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
        const ws = data.windowsState || {};
        const allWindows = [
          ...(ws.lastActiveWindow ? [ws.lastActiveWindow] : []),
          ...(ws.openedWindows || []),
        ];
        for (const windowState of allWindows) {
          if (windowState.folder) addPath(cursorFileUriToPath(windowState.folder));
          if (windowState.workspace) addWorkspaceFile(cursorFileUriToPath(windowState.workspace));
        }
      }

      const workspaceStorage = path.join(userRoot, 'workspaceStorage');
      if (fs.existsSync(workspaceStorage)) {
        for (const entry of fs.readdirSync(workspaceStorage, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const descriptorPath = path.join(workspaceStorage, entry.name, 'workspace.json');
          if (!fs.existsSync(descriptorPath)) continue;
          try {
            const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
            if (descriptor.folder) addPath(cursorFileUriToPath(descriptor.folder));
            if (descriptor.workspace) addWorkspaceFile(cursorFileUriToPath(descriptor.workspace));
          } catch {}
        }
      }

      const seen = new Set();
      const resolved = candidates.filter(candidate => {
        const key = candidate.path.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this._cursorWorkspacePathCache = { readAt: now, candidates: resolved };
      return resolved.slice();
    } catch {
      return this._cursorWorkspacePathCache.candidates.slice();
    }
  }

  _readAntigravityWindowPaths() {
    try {
      const appData = process.env.APPDATA || '';
      if (!appData) return [];
      const storagePath = path.join(appData, 'Antigravity', 'User', 'globalStorage', 'storage.json');
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      const ws = data.windowsState || {};
      const allWindows = [
        ...(ws.lastActiveWindow ? [ws.lastActiveWindow] : []),
        ...(ws.openedWindows || []),
      ];
      const seen = new Set();
      return allWindows
        .filter(w => w.folder)
        .map(w => {
          let p = decodeURIComponent(w.folder.replace(/^file:\/\/\//, ''));
          p = p.replace(/\//g, '\\');
          const title = p.split('\\').filter(Boolean).pop() || p;
          return { title, path: p };
        })
        .filter(w => {
          if (seen.has(w.path.toLowerCase())) return false;
          seen.add(w.path.toLowerCase());
          return true;
        });
    } catch {
      return [];
    }
  }

  // ─── Transcript signature ────────────────────────────────────────────────

  _transcriptSignature(messages) {
    return JSON.stringify((messages || []).map(m => [m.role, m.content, m.content_blocks || null]));
  }

  _cloneTranscriptMessages(messages) {
    try { return JSON.parse(JSON.stringify(Array.isArray(messages) ? messages : [])); } catch { return []; }
  }

  _cursorObservationTimestampSeconds(message) {
    for (const value of [message?.created_at, message?.timestamp, message?.ts]) {
      if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric / 1000 : numeric;
        continue;
      }
      const parsed = Date.parse(String(value || ''));
      if (Number.isFinite(parsed) && parsed > 0) return parsed / 1000;
    }
    return 0;
  }

  _cursorObservationSequenceFromId(agentId, sourceMessageId) {
    const prefix = `${CURSOR_NATIVE_OBSERVED_SOURCE}:${String(agentId || '').toLowerCase()}:`;
    const value = String(sourceMessageId || '').toLowerCase();
    if (!value.startsWith(prefix)) return 0;
    const sequence = Number.parseInt(value.substring(prefix.length).split(':', 1)[0], 10);
    return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
  }

  _cursorObservedMessageId(agentId, sequence, message) {
    const semantic = JSON.stringify([
      String(message?.role || '').toLowerCase(),
      String(message?.content || '').replace(/\s+/g, ' ').trim(),
      Array.isArray(message?.content_blocks) ? message.content_blocks : null,
    ]);
    const fingerprint = crypto.createHash('sha256').update(semantic).digest('hex').substring(0, 16);
    return `${CURSOR_NATIVE_OBSERVED_SOURCE}:${String(agentId || '').toLowerCase()}:${sequence}:${fingerprint}`;
  }

  _preserveCursorObservationMetadata(previous, observed) {
    const next = { ...(observed || {}) };
    for (const key of ['source_message_id', 'source', 'ts', 'timestamp', 'created_at']) {
      if (previous && Object.prototype.hasOwnProperty.call(previous, key)) next[key] = previous[key];
    }
    return next;
  }

  _prepareCursorMessageObservations(agentId, messages, options = {}) {
    const rows = Array.isArray(messages) ? messages : [];
    const observedAtMs = Number.isFinite(Number(options.observedAtMs))
      ? Number(options.observedAtMs)
      : Date.now();
    const observeCurrent = options.observeCurrent === true;
    let sequence = Math.max(0, Number(options.sequence) || 0);
    let changed = false;
    let newlyObserved = 0;
    const prepared = rows.map(message => {
      const row = message && typeof message === 'object' ? message : {};
      const existingSourceId = String(row.source_message_id || '').trim();
      sequence = Math.max(sequence, this._cursorObservationSequenceFromId(agentId, existingSourceId));
      if (existingSourceId) {
        if (this._cursorObservationTimestampSeconds(row) > 0 || Object.prototype.hasOwnProperty.call(row, 'ts')) {
          return row;
        }
        changed = true;
        return { ...row, ts: 0 };
      }

      sequence += 1;
      const sourceMessageId = this._cursorObservedMessageId(agentId, sequence, row);
      const timestampSeconds = observeCurrent ? observedAtMs / 1000 : 0;
      const next = {
        ...row,
        source_message_id: sourceMessageId,
        source: CURSOR_NATIVE_OBSERVED_SOURCE,
        ts: timestampSeconds,
      };
      if (timestampSeconds > 0) {
        const observedAt = new Date(observedAtMs).toISOString();
        next.timestamp = observedAt;
        next.created_at = observedAt;
        newlyObserved += 1;
      }
      changed = true;
      return next;
    });
    return { messages: prepared, sequence, changed, newlyObserved };
  }

  _fileTranscriptGeneration(agentType, filePath, sourceCursor, nonce = '') {
    const basis = [
      String(agentType || 'cli'),
      path.resolve(String(filePath || '.')).toLowerCase(),
      String(nonce || ''),
    ].join('\u0000');
    return crypto.createHash('sha1').update(basis).digest('hex').substring(0, 16);
  }

  _fileTranscriptMessageIds(agentType, generation, messages, occurrences = new Map()) {
    return (Array.isArray(messages) ? messages : []).map((message) => {
      const parserSourceId = String(message?.source_message_id || '').trim();
      if (parserSourceId) return parserSourceId;
      const nativeSourceId = String(message?.native_source_id || '').trim();
      if (nativeSourceId) {
        const nativeFingerprint = crypto.createHash('sha1')
          .update(`${String(agentType || 'cli')}\u0000${nativeSourceId}`)
          .digest('hex')
          .substring(0, 20);
        const nativeOccurrence = occurrences.get(nativeFingerprint) || 0;
        occurrences.set(nativeFingerprint, nativeOccurrence + 1);
        return `${agentType}:${generation}:native:${nativeFingerprint}:${nativeOccurrence}`;
      }
      const semantic = JSON.stringify([
        String(agentType || 'cli'),
        message?.role || '',
        Number(message?.ts) || 0,
        message?.created_at || '',
        message?.content || '',
        message?.content_blocks || null,
      ]);
      const fingerprint = crypto.createHash('sha1').update(semantic).digest('hex').substring(0, 20);
      const occurrence = occurrences.get(fingerprint) || 0;
      occurrences.set(fingerprint, occurrence + 1);
      return `${agentType}:${generation}:${fingerprint}:${occurrence}`;
    });
  }

  _fileTranscriptState(agentType, filePath, messages, sourceCursor, nonce = '') {
    const generation = this._fileTranscriptGeneration(agentType, filePath, sourceCursor, nonce);
    const clonedMessages = this._cloneTranscriptMessages(messages);
    const messageIdOccurrences = new Map();
    return {
      agentType,
      filePath,
      generation,
      messages: clonedMessages,
      messageIds: this._fileTranscriptMessageIds(agentType, generation, clonedMessages, messageIdOccurrences),
      messageIdOccurrences,
      messageBaseIndex: 0,
      approximateRecoveryBytes: this._fileTranscriptApproximateSizeInfo(clonedMessages).bytes,
      sourceCursor: sourceCursor ? { ...sourceCursor } : null,
    };
  }

  _fileTranscriptApproximateSizeInfo(messages, maxBytes = Infinity) {
    const rows = Array.isArray(messages) ? messages : [];
    let bytes = 512;
    for (let index = 0; index < rows.length; index++) {
      let encoded;
      try { encoded = JSON.stringify(rows[index]); } catch {
        encoded = JSON.stringify({
          role: rows[index]?.role || '',
          content: this._messageContentText(rows[index]),
        });
      }
      bytes += Buffer.byteLength(encoded || 'null', 'utf8')
        + FILE_TRANSCRIPT_RECOVERY_ROW_OVERHEAD_BYTES;
      if (bytes > maxBytes) return { fits: false, bytes, counted: index + 1 };
    }
    return { fits: bytes <= maxBytes, bytes, counted: rows.length };
  }

  _fileTranscriptStableKey(message) {
    if (!message || typeof message !== 'object') return 'empty';
    const sourceId = String(message?.source_message_id || '').trim();
    if (sourceId) return `source:${sourceId}`;
    const nativeId = String(message?.native_source_id || '').trim();
    if (nativeId) return `native:${nativeId}`;
    return `semantic:${crypto.createHash('sha1').update(this._transcriptSignature([message])).digest('hex')}`;
  }

  _fileTranscriptWindowOverlap(previousMessages, currentMessages) {
    const previous = (Array.isArray(previousMessages) ? previousMessages : []).map(message => this._fileTranscriptStableKey(message));
    const current = (Array.isArray(currentMessages) ? currentMessages : []).map(message => this._fileTranscriptStableKey(message));
    if (previous.length === 0 || current.length === 0) return 0;
    const separator = Symbol('file-transcript-overlap');
    const combined = [...current, separator, ...previous];
    const prefix = new Array(combined.length).fill(0);
    for (let index = 1; index < combined.length; index++) {
      let matched = prefix[index - 1];
      while (matched > 0 && combined[index] !== combined[matched]) matched = prefix[matched - 1];
      if (combined[index] === combined[matched]) matched += 1;
      prefix[index] = matched;
    }
    return Math.min(prefix[prefix.length - 1], previous.length, current.length);
  }

  _fileTranscriptObservationKey(filePath, sourceCursor, messages) {
    const rows = Array.isArray(messages) ? messages : [];
    const last = rows.length > 0 ? rows[rows.length - 1] : null;
    if (!sourceCursor) return `${String(filePath || '')}\u0000fallback\u0000${rows.length}\u0000${this._fileTranscriptStableKey(last)}`;
    return [
      String(filePath || ''),
      Number(sourceCursor.end_offset) || 0,
      Number(sourceCursor.file_size) || 0,
      Number(sourceCursor.mtime_ms) || 0,
      Number(sourceCursor.window_start_offset) || 0,
      rows.length,
      last ? this._fileTranscriptStableKey(last) : '',
    ].join('\u0000');
  }

  _fileTranscriptRecoveryPreflight(sessionId, session, messages, reason) {
    const now = Date.now();
    if (Number(session?._fileTranscriptRecoveryBlockedUntil || 0) > now) {
      return { allowed: false, reason: 'cooldown', retryAfterMs: session._fileTranscriptRecoveryBlockedUntil - now };
    }
    const maxBytes = this._historySnapshotLimitBytes(reason);
    // Inspect at most the automatic frame budget. This is deliberately based
    // on the candidate rows rather than cached state: a mutation can replace a
    // short transcript with a much larger one at the same path.
    const sizeInfo = this._fileTranscriptApproximateSizeInfo(messages, maxBytes);
    if (sizeInfo.fits) return { allowed: true, maxBytes, sizeInfo };
    if (session) session._fileTranscriptRecoveryBlockedUntil = now + FILE_TRANSCRIPT_RECOVERY_BLOCK_MS;
    if (this._shouldLogLargeHistorySkip(sessionId, reason)) {
      this._log('warn', `[${sessionId}] Deferred oversized ${reason} before row remap (${sizeInfo.counted} rows inspected, >${Math.round(maxBytes / 1024)} KB); selected-history loading remains available`);
    }
    return { allowed: false, reason: 'oversized', retryAfterMs: FILE_TRANSCRIPT_RECOVERY_BLOCK_MS, maxBytes, sizeInfo };
  }

  _fileTranscriptMessage(state, message, index, sourceCursor) {
    const sourceMessageId = state.messageIds?.[index]
      || this._fileTranscriptMessageIds(state.agentType, state.generation, state.messages || [])[index]
      || `${state.agentType}:${state.generation}:row:${index}`;
    return {
      ...message,
      source_message_id: sourceMessageId,
      source_cursor: {
        generation: state.generation,
        message_index: Math.max(0, Number(state.messageBaseIndex) || 0) + index,
        end_offset: Number(sourceCursor?.end_offset) || 0,
        file_size: Number(sourceCursor?.file_size) || 0,
      },
      source: `${state.agentType}_jsonl`,
    };
  }

  _scheduleFileTranscriptAppendDrain(sessionId, session, drain) {
    if (!drain || drain.scheduled || session?._fileTranscriptAppendDrain !== drain) return;
    drain.scheduled = true;
    const immediate = setImmediate(() => {
      drain.scheduled = false;
      this._drainFileTranscriptAppend(sessionId, session, drain);
    });
    immediate.unref?.();
  }

  _drainFileTranscriptAppend(sessionId, session, drain) {
    if (!session || session._fileTranscriptAppendDrain !== drain || this._running === false) return;
    const startedAt = Date.now();
    let batchRows = 0;
    while (drain.nextIndex < drain.candidate.messages.length
      && batchRows < FILE_TRANSCRIPT_APPEND_BATCH_ROWS
      && Date.now() - startedAt < FILE_TRANSCRIPT_APPEND_BATCH_MS) {
      const index = drain.nextIndex;
      const message = drain.candidate.messages[index];
      const frame = this._fileTranscriptMessage(drain.candidate, message, index, drain.sourceCursor);
      if (!this._sendProxyMessage(sessionId, frame)) {
        const acceptedMessages = drain.candidate.messages.slice(0, index);
        session._fileTranscriptState = {
          ...drain.candidate,
          messages: acceptedMessages,
          messageIds: drain.candidate.messageIds.slice(0, index),
          approximateRecoveryBytes: this._fileTranscriptApproximateSizeInfo(acceptedMessages).bytes,
        };
        session.lastObservedCount = acceptedMessages.length;
        session.lastMessageCount = acceptedMessages.length;
        const pending = drain.pending;
        session._fileTranscriptAppendDrain = null;
        if (pending) setImmediate(() => this._sendFileBackedTranscriptUpdate(
          sessionId,
          session,
          pending.messages,
          pending.options,
        ));
        return;
      }
      drain.nextIndex += 1;
      drain.sent += 1;
      batchRows += 1;
    }
    if (drain.nextIndex < drain.candidate.messages.length) {
      this._scheduleFileTranscriptAppendDrain(sessionId, session, drain);
      return;
    }
    session._fileTranscriptState = drain.candidate;
    session._lastFileTranscriptObservationKey = drain.candidate.observationKey
      || this._fileTranscriptObservationKey(drain.candidate.filePath, drain.candidate.sourceCursor, drain.candidate.messages);
    const pending = drain.pending;
    session._fileTranscriptAppendDrain = null;
    this._log('info', `[${sessionId}] Emitted ${drain.sent} ${drain.agentType} semantic append rows in priority-safe batches (${drain.reason}, cursor ${drain.sourceCursor?.start_offset ?? '?'}-${drain.sourceCursor?.end_offset ?? '?'})`);
    if (pending) setImmediate(() => this._sendFileBackedTranscriptUpdate(
      sessionId,
      session,
      pending.messages,
      pending.options,
    ));
  }

  _sendFileBackedTranscriptUpdate(sessionId, session, messages, {
    agentType,
    filePath,
    sourceCursor = null,
    reason = 'file changed',
    allowInitialAppend = false,
  } = {}) {
    const currentMessages = Array.isArray(messages) ? messages : [];
    const previous = session?._fileTranscriptState || null;
    if (!session || !agentType || !filePath) return { mode: 'ignored', sent: 0 };
    if (session._fileTranscriptAppendDrain) {
      session._fileTranscriptAppendDrain.pending = {
        messages: [...currentMessages],
        options: { agentType, filePath, sourceCursor, reason, allowInitialAppend },
      };
      return { mode: 'append_coalesced', sent: 0 };
    }
    if (this._promoteSessionChatTitle(sessionId, session, currentMessages)) {
      this._broadcastSessionSnapshot('file-backed title hydration');
    }

    if (!previous || previous.agentType !== agentType || previous.filePath !== filePath) {
      const seeded = this._fileTranscriptState(agentType, filePath, currentMessages, sourceCursor);
      seeded.observationKey = this._fileTranscriptObservationKey(filePath, sourceCursor, currentMessages);
      session._fileTranscriptState = seeded;
      session._lastFileTranscriptObservationKey = seeded.observationKey;
      if (!allowInitialAppend || currentMessages.length === 0 || currentMessages.length > 20) {
        return { mode: 'baseline', sent: 0 };
      }
      let sent = 0;
      currentMessages.forEach((message, index) => {
        if (this._sendProxyMessage(sessionId, this._fileTranscriptMessage(seeded, message, index, sourceCursor))) sent += 1;
      });
      this._log('info', `[${sessionId}] Emitted ${sent} initial ${agentType} semantic rows (${reason})`);
      return { mode: 'initial_append', sent };
    }

    const priorMessages = previous.messages || [];
    const cursorMode = String(sourceCursor?.mode || '');
    if (cursorMode === 'bounded_rebase') {
      const candidate = this._fileTranscriptState(agentType, filePath, currentMessages, sourceCursor);
      const overlap = this._fileTranscriptWindowOverlap(priorMessages, candidate.messages);
      if (overlap > 0) {
        const previousStart = priorMessages.length - overlap;
        candidate.messageBaseIndex = Math.max(0, Number(previous.messageBaseIndex) || 0) + previousStart;
        const occurrences = new Map(previous.messageIdOccurrences || []);
        const appendedIds = this._fileTranscriptMessageIds(
          previous.agentType,
          previous.generation,
          candidate.messages.slice(overlap),
          occurrences,
        );
        candidate.generation = previous.generation;
        candidate.messageIds = [
          ...(previous.messageIds || []).slice(previousStart),
          ...appendedIds,
        ];
        candidate.messageIdOccurrences = occurrences;
        candidate.observationKey = this._fileTranscriptObservationKey(filePath, sourceCursor, currentMessages);
        const appended = candidate.messages.slice(overlap);
        if (appended.length > FILE_TRANSCRIPT_ASYNC_APPEND_THRESHOLD) {
          const drain = {
            agentType,
            candidate,
            sourceCursor: sourceCursor ? { ...sourceCursor } : previous.sourceCursor,
            reason,
            nextIndex: overlap,
            sent: 0,
            scheduled: false,
            pending: null,
          };
          session._fileTranscriptAppendDrain = drain;
          this._scheduleFileTranscriptAppendDrain(sessionId, session, drain);
          return { mode: 'bounded_rebase_append_scheduled', sent: 0, pending: appended.length, overlap };
        }
        let sent = 0;
        appended.forEach((message, offset) => {
          const index = overlap + offset;
          if (this._sendProxyMessage(sessionId, this._fileTranscriptMessage(candidate, message, index, sourceCursor))) sent += 1;
        });
        if (sent !== appended.length) {
          session.lastObservedCount = priorMessages.length;
          session.lastMessageCount = priorMessages.length;
          return { mode: 'bounded_rebase_append_deferred', sent, overlap };
        }
        session._fileTranscriptState = candidate;
        session._lastFileTranscriptObservationKey = candidate.observationKey;
        this._log('info', `[${sessionId}] Rebased bounded ${agentType} tail with ${overlap} overlapping rows and ${sent} semantic appends (${reason})`);
        return { mode: sent > 0 ? 'bounded_rebase_append' : 'bounded_rebase_unchanged', sent, overlap };
      }
      this._log('warn', `[${sessionId}] Bounded ${agentType} tail rebase had no semantic overlap; preserving the prior cursor until authoritative recovery is available (${reason})`);
      return { mode: 'bounded_rebase_deferred', sent: 0, overlap: 0 };
    }

    let prefixCount = 0;
    const shared = Math.min(priorMessages.length, currentMessages.length);
    const appendCursorFastPath = cursorMode === 'append'
      && currentMessages.length >= priorMessages.length
      && (
        priorMessages.length === 0
        || this._transcriptSignature([priorMessages[priorMessages.length - 1]])
          === this._transcriptSignature([currentMessages[priorMessages.length - 1]])
      );
    if (appendCursorFastPath) {
      prefixCount = priorMessages.length;
    } else {
      while (
        prefixCount < shared
        && this._transcriptSignature([priorMessages[prefixCount]]) === this._transcriptSignature([currentMessages[prefixCount]])
      ) prefixCount += 1;
    }

    if (prefixCount === priorMessages.length && currentMessages.length >= priorMessages.length) {
      const appended = currentMessages.slice(priorMessages.length);
      if (appended.length === 0) {
        session._fileTranscriptState = {
          ...previous,
          sourceCursor: sourceCursor ? { ...sourceCursor } : previous.sourceCursor,
          observationKey: this._fileTranscriptObservationKey(filePath, sourceCursor, currentMessages),
        };
        session._lastFileTranscriptObservationKey = session._fileTranscriptState.observationKey;
        return { mode: 'unchanged', sent: 0 };
      }
      const appendedMessages = this._cloneTranscriptMessages(appended);
      const occurrences = new Map(previous.messageIdOccurrences || []);
      const candidate = {
        ...previous,
        messages: [...priorMessages, ...appendedMessages],
        messageIds: [
          ...(previous.messageIds || []),
          ...this._fileTranscriptMessageIds(previous.agentType, previous.generation, appendedMessages, occurrences),
        ],
        messageIdOccurrences: occurrences,
        approximateRecoveryBytes: Number(previous.approximateRecoveryBytes || 512)
          + Math.max(0, this._fileTranscriptApproximateSizeInfo(appendedMessages).bytes - 512),
        sourceCursor: sourceCursor ? { ...sourceCursor } : previous.sourceCursor,
        observationKey: this._fileTranscriptObservationKey(filePath, sourceCursor, currentMessages),
      };
      if (appended.length > FILE_TRANSCRIPT_ASYNC_APPEND_THRESHOLD) {
        const drain = {
          agentType,
          candidate,
          sourceCursor: sourceCursor ? { ...sourceCursor } : previous.sourceCursor,
          reason,
          nextIndex: priorMessages.length,
          sent: 0,
          scheduled: false,
          pending: null,
        };
        session._fileTranscriptAppendDrain = drain;
        this._scheduleFileTranscriptAppendDrain(sessionId, session, drain);
        return { mode: 'append_scheduled', sent: 0, pending: appended.length };
      }
      let sent = 0;
      appended.forEach((message, offset) => {
        const index = priorMessages.length + offset;
        if (this._sendProxyMessage(sessionId, this._fileTranscriptMessage(candidate, message, index, sourceCursor))) sent += 1;
      });
      if (sent !== appended.length) {
        session.lastObservedCount = priorMessages.length;
        session.lastMessageCount = priorMessages.length;
        return { mode: 'append_deferred', sent };
      }
      session._fileTranscriptState = candidate;
      session._lastFileTranscriptObservationKey = candidate.observationKey;
      if (sent > 0) {
        this._log('info', `[${sessionId}] Emitted ${sent} ${agentType} semantic append rows (${reason}, cursor ${sourceCursor?.start_offset ?? '?'}-${sourceCursor?.end_offset ?? '?'})`);
      }
      return { mode: appended.length > 0 ? 'append' : 'unchanged', sent };
    }

    const now = Date.now();
    const minResyncIntervalMs = 5000;
    if (session._lastFileTranscriptResyncAt && now - session._lastFileTranscriptResyncAt < minResyncIntervalMs) {
      session.lastObservedCount = priorMessages.length;
      session.lastMessageCount = priorMessages.length;
      this._log('warn', `[${sessionId}] Deferred ${agentType} mutation recovery inside ${minResyncIntervalMs} ms rate limit (${reason})`);
      return { mode: 'resync_throttled', sent: 0 };
    }
    const preflight = this._fileTranscriptRecoveryPreflight(
      sessionId,
      session,
      currentMessages,
      `${agentType} mutation recovery`,
    );
    if (!preflight.allowed) {
      session.lastObservedCount = priorMessages.length;
      session.lastMessageCount = priorMessages.length;
      return { mode: `resync_${preflight.reason}`, sent: 0, retry_after_ms: preflight.retryAfterMs };
    }
    const resyncId = crypto.randomUUID();
    const recovered = this._fileTranscriptState(agentType, filePath, currentMessages, sourceCursor, resyncId);
    const recoveredMessages = currentMessages.map((message, index) => (
      this._fileTranscriptMessage(recovered, message, index, sourceCursor)
    ));
    const accepted = this._sendHistorySnapshot(sessionId, recoveredMessages, `${agentType} mutation recovery`, {
      resyncId,
      resyncReason: reason,
      source: `${agentType}_jsonl`,
      sourceCursor,
      sourceBytes: Number(sourceCursor?.bytes_read) || 0,
      rateLimitMs: minResyncIntervalMs,
    });
    if (!accepted) {
      session.lastObservedCount = priorMessages.length;
      session.lastMessageCount = priorMessages.length;
      return { mode: 'resync_deferred', sent: 0 };
    }
    session._lastFileTranscriptResyncAt = now;
    session._fileTranscriptState = recovered;
    recovered.observationKey = this._fileTranscriptObservationKey(filePath, sourceCursor, currentMessages);
    session._lastFileTranscriptObservationKey = recovered.observationKey;
    this._log('warn', `[${sessionId}] Sent bounded ${agentType} mutation recovery ${resyncId} (${prefixCount}/${priorMessages.length} prefix, ${reason})`);
    return { mode: 'resync', sent: recoveredMessages.length, resync_id: resyncId };
  }

  _isTranscriptAccumulating(agentType) {
    return agentType === 'antigravity_panel'
      || agentType === 'antigravity-v2'
      || agentType === 'antigravity'
      || agentType === 'claude'
      || agentType === 'codex'
      || agentType === 'codex-desktop'
      || agentType === 'cursor';
  }

  _shouldResetAccumulatorOnNoOverlap(agentType) {
    return agentType === 'codex' || agentType === 'codex-desktop' || agentType === 'antigravity-v2';
  }

  _maybePersistAccumulatedMessages(sessionId, session, options = {}) {
    if (!session || !Array.isArray(session._accumulatedMessages)) return;
    if (!session._accumulatedDirty && !options.force) return;
    const now = Date.now();
    const minIntervalMs = options.force ? 0 : 15000;
    if (!options.force && session._lastAccumulatedPersistAt && now - session._lastAccumulatedPersistAt < minIntervalMs) {
      return;
    }
    const updates = { accumulated_messages: session._accumulatedMessages };
    if (session.agentType === 'cursor') {
      this._cacheCursorActiveTranscript(session);
      updates.cursor_agent_histories = session._cursorAgentHistories || {};
      updates.cursor_active_thread_key = session._activeThreadKey || null;
      updates.cursor_message_observation_seq = Math.max(0, Number(session._cursorMessageObservationSeq) || 0);
    }
    if (session.agentType === 'codex-desktop') {
      updates.codex_desktop_active_thread_key = session._activeThreadKey || null;
      updates.codex_desktop_active_thread_title = session._activeThreadTitle || null;
    }
    sessionStore.updateSession(sessionId, updates);
    session._accumulatedDirty = false;
    session._lastAccumulatedPersistAt = now;
  }

  _transcriptWindowOffset(accumulated, windowMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const win = Array.isArray(windowMessages) ? windowMessages : [];
    if (win.length === 0) return acc.length;
    if (win.length > acc.length) return -1;
    for (let start = 0; start <= acc.length - win.length; start++) {
      let match = true;
      for (let i = 0; i < win.length; i++) {
        if (!this._messagesSoftMatch(acc[start + i], win[i])) {
          match = false;
          break;
        }
      }
      if (match) return start;
    }
    return -1;
  }

  _accumulatedTranscriptContainsWindow(accumulated, windowMessages) {
    return this._transcriptWindowOffset(accumulated, windowMessages) >= 0;
  }

  _readVsCodeWindowPaths() {
    return readVsCodeWindowPaths();
  }

  _mergeCursorTranscriptWindow(accumulated, windowMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const win = Array.isArray(windowMessages) ? windowMessages : [];
    if (win.length === 0) return { messages: acc, changed: false };
    if (acc.length === 0) return { messages: win.slice(), changed: true };

    // Cursor can retain an old user anchor while virtualizing that anchor's
    // assistant response. Treat the visible DOM as an ordered subsequence of
    // the durable transcript, not as a contiguous replacement window, so a
    // missing historical block is never spliced out of relay history.
    let searchStart = 0;
    let changed = false;
    for (let winIndex = 0; winIndex < win.length; winIndex++) {
      const observed = win[winIndex];
      let matchIndex = -1;
      for (let accIndex = searchStart; accIndex < acc.length; accIndex++) {
        if (this._cursorMessagesSoftMatch(acc[accIndex], observed)) {
          matchIndex = accIndex;
          break;
        }
      }

      if (matchIndex >= 0) {
        if (this._shouldReplaceAccumulatedMessage('cursor', acc[matchIndex], observed)) {
          acc[matchIndex] = this._preserveCursorObservationMetadata(acc[matchIndex], observed);
          changed = true;
        }
        searchStart = matchIndex + 1;
        continue;
      }

      // A short streaming assistant tail may not soft-match its next, longer
      // sample. Grow that one tail in place; every other unmatched observation
      // is genuinely new and belongs at the end of the accumulated transcript.
      const tailIndex = acc.length - 1;
      if (
        winIndex === win.length - 1
        && searchStart === tailIndex
        && acc[tailIndex]?.role === observed?.role
        && this._shouldReplaceAccumulatedMessage('cursor', acc[tailIndex], observed)
      ) {
        acc[tailIndex] = this._preserveCursorObservationMetadata(acc[tailIndex], observed);
      } else {
        acc.push(observed);
      }
      searchStart = acc.length;
      changed = true;
    }

    return { messages: acc, changed };
  }

  _cursorTranscriptWindowMatches(accumulated, windowMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const win = Array.isArray(windowMessages) ? windowMessages : [];
    if (win.length === 0) return acc.length === 0;
    let searchStart = 0;
    let lastMatch = -1;
    for (const observed of win) {
      let matchIndex = -1;
      for (let index = searchStart; index < acc.length; index++) {
        if (this._cursorMessagesSoftMatch(acc[index], observed)) {
          matchIndex = index;
          break;
        }
      }
      if (matchIndex < 0) return false;
      lastMatch = matchIndex;
      searchStart = matchIndex + 1;
    }
    return lastMatch === acc.length - 1;
  }

  _cacheCursorActiveTranscript(session) {
    if (!session || session.agentType !== 'cursor') return;
    const threadKey = String(session._activeThreadKey || '');
    if (!threadKey || !Array.isArray(session._accumulatedMessages)) return;
    if (!session._cursorAgentHistories || typeof session._cursorAgentHistories !== 'object') {
      session._cursorAgentHistories = {};
    }
    session._cursorAgentHistories[threadKey] = session._accumulatedMessages.slice();
  }

  _restoreCursorTranscriptForThread(session, threadKey, freshMessages) {
    const fresh = Array.isArray(freshMessages) ? freshMessages : [];
    if (!session._cursorAgentHistories || typeof session._cursorAgentHistories !== 'object') {
      session._cursorAgentHistories = {};
    }
    const cached = Array.isArray(session._cursorAgentHistories[threadKey])
      ? session._cursorAgentHistories[threadKey]
      : null;
    let restored = fresh.slice();
    if (cached && (fresh.length === 0 || this._cursorTranscriptWindowMatches(cached, fresh))) {
      restored = this._mergeCursorTranscriptWindow(cached.slice(), fresh).messages;
    }
    session._cursorAgentHistories[threadKey] = restored.slice();
    session._accumulatedMessages = restored.slice();
    session._accumulatedDirty = true;
    return restored;
  }

  _codexDesktopRestoreWindowMatches(accumulated, windowMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const win = Array.isArray(windowMessages) ? windowMessages : [];
    if (acc.length === 0) return false;
    if (win.length === 0) return true;
    if (this._transcriptWindowOffset(acc, win) >= 0) return true;

    // Bounded native reads contain the newest visual units, not necessarily a
    // contiguous slice of the durable message accumulator. Tool expansion and
    // active output can also mutate one message between samples. Require a
    // meaningful ordered overlap (including a user turn when present) before
    // restoring; the stable native thread ID remains the primary identity gate.
    let searchStart = 0;
    let matchedCount = 0;
    let matchedUserCount = 0;
    for (const message of win) {
      const index = this._findMatchingMessageIndex(acc, message, searchStart);
      if (index < 0) continue;
      matchedCount++;
      if (message?.role === 'user') matchedUserCount++;
      searchStart = index + 1;
    }
    const requiredMatches = Math.min(win.length, Math.max(2, Math.floor(win.length * 0.08)));
    if (matchedCount < requiredMatches) return false;
    if (win.some(message => message?.role === 'user') && matchedUserCount === 0) return false;
    return true;
  }

  _mergeTranscriptWindow(sessionId, session, windowMessages) {
    const dom = Array.isArray(windowMessages) ? windowMessages : [];
    if (!session._accumulatedMessages) {
      session._accumulatedMessages = dom.slice();
      return session._accumulatedMessages;
    }

    const acc = session._accumulatedMessages;
    if (dom.length === 0) return acc;

    const existingOffset = this._transcriptWindowOffset(acc, dom);
    if (existingOffset >= 0) {
      for (let i = 0; i < dom.length; i++) {
        const accIdx = existingOffset + i;
        if (this._messageContentText(dom[i]).length > this._messageContentText(acc[accIdx]).length) {
          acc[accIdx] = dom[i];
        }
      }
      return acc;
    }

    let overlapLen = 0;
    for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
      let match = true;
      for (let k = 0; k < tryLen; k++) {
        if (!this._messagesSoftMatch(acc[acc.length - tryLen + k], dom[k])) {
          match = false;
          break;
        }
      }
      if (match) {
        overlapLen = tryLen;
        break;
      }
    }

    if (overlapLen > 0) {
      for (let k = 0; k < overlapLen; k++) {
        const accIdx = acc.length - overlapLen + k;
        if (this._messageContentText(dom[k]).length > this._messageContentText(acc[accIdx]).length) {
          acc[accIdx] = dom[k];
        }
      }
      for (let k = overlapLen; k < dom.length; k++) acc.push(dom[k]);
      return acc;
    }

    this._log('warn', `[${sessionId}] No transcript overlap while accumulating ${session.agentType}; appending visible window`);
    for (const m of dom) acc.push(m);
    return acc;
  }

  _resetTranscriptState(session, reason) {
    session._accumulatedMessages = null;
    session.lastMessageCount = 0;
    session.lastObservedCount = 0;
    session.lastTranscriptSig = '';
    session.pendingLast = null;
    session._pendingFirstSeenAt = null;
    session._lastStreamedContent = null;
    session.resyncCandidateSig = null;
    session.waitingForAssistant = false;
    session._forceHistoryResync = reason || 'transcript reset';
  }

  _refreshCodexDesktopThreadMetadata(sessionId, session, activeThreadKey, activeThreadTitle = '') {
    if (!session || session.agentType !== 'codex-desktop' || !activeThreadKey) return false;
    session._lastCodexDesktopWorkspaceLookupKey = activeThreadKey;
    session._lastCodexDesktopWorkspaceLookupAt = Date.now();
    let resolved;
    try {
      resolved = resolveCodexDesktopThreadMetadata(activeThreadKey, activeThreadTitle);
    } catch (e) {
      this._log('warn', `[${sessionId}] Codex Desktop thread metadata lookup failed: ${e.message}`);
      return false;
    }
    if (!resolved) return false;

    const nextWorkspaceName = resolved.workspaceName || session.workspace_name || 'Codex Desktop';
    const nextChatTitle = resolved.chatTitle || session.chat_title || null;
    const nextChatTitleSource = resolved.chatTitle ? 'native' : (session.chat_title_source || null);
    const changed = session.workspace_path !== resolved.workspacePath
      || session.workspace_name !== nextWorkspaceName
      || session.chat_title !== nextChatTitle
      || session.chat_title_source !== nextChatTitleSource;

    session.workspace_path = resolved.workspacePath;
    session.workspace_name = nextWorkspaceName;
    session.chat_title = nextChatTitle;
    session.chat_title_source = nextChatTitleSource;
    session._codexDesktopWorkspaceThreadKey = activeThreadKey;
    sessionStore.updateSession(sessionId, {
      workspace_path: resolved.workspacePath,
      workspace_name: nextWorkspaceName,
      chat_title: nextChatTitle,
      chat_title_source: nextChatTitleSource,
    });

    if (changed) {
      this._log('info', `[${sessionId}] Refreshed Codex Desktop workspace from active thread ${resolved.cliSessionId}: ${resolved.workspacePath || 'unknown'}`);
      this._broadcastSessionSnapshot();
    }
    return changed;
  }

  _applyCodexDesktopActiveThread(sessionId, session, activeThread, options = {}) {
    if (!session || session.agentType !== 'codex-desktop' || !activeThread) return;
    const activeThreadKey = String(activeThread.cache_key || activeThread.id || activeThread.title || '');
    if (!activeThreadKey) return;
    const previousThreadKey = session._activeThreadKey || session.codexDesktopActiveThreadKey || session.codex_desktop_active_thread_key || '';
    const previousMatchesActive = codexDesktopThreadKeysMatch(previousThreadKey, activeThreadKey);
    if (previousThreadKey && !previousMatchesActive) {
      this._log('info', `[${sessionId}] Codex Desktop active thread changed; resetting transcript accumulator`);
      this._resetTranscriptState(session, 'codex-desktop active thread change');
      sessionStore.updateSession(sessionId, {
        accumulated_messages: null,
        codex_desktop_active_thread_key: activeThreadKey,
        codex_desktop_active_thread_title: activeThread.title || null,
      });
      session._codexDesktopArchiveMessages = null;
      session._codexDesktopArchivePath = null;
      session._codexDesktopArchiveUpdatedAt = null;
      session._codexDesktopArchiveSizeBytes = null;
      session._codexDesktopArchivePollSettledActivity = null;
      session._codexDesktopArchiveCliSessionId = null;
      session._codexDesktopArchiveBlockCounts = null;
      session._codexDesktopArchivePartial = false;
      session._lastStreamedContent = null;
    }
    session._activeThreadKey = activeThreadKey;
    session._activeThreadTitle = activeThread.title || session._activeThreadTitle || null;
    session.codexDesktopActiveThreadKey = activeThreadKey;
    session.chat_title = session._activeThreadTitle || session.chat_title || null;
    if (session._activeThreadTitle) session.chat_title_source = 'native';
    sessionStore.updateSession(sessionId, {
      codex_desktop_active_thread_key: activeThreadKey,
      codex_desktop_active_thread_title: session._activeThreadTitle || null,
      chat_title: session.chat_title,
      chat_title_source: session.chat_title_source || null,
    });
    const lookupDue = session._codexDesktopWorkspaceThreadKey !== activeThreadKey
      && (
        session._lastCodexDesktopWorkspaceLookupKey !== activeThreadKey
        || Date.now() - Number(session._lastCodexDesktopWorkspaceLookupAt || 0) >= 30000
      );
    if (lookupDue && options.refreshMetadata !== false) {
      this._refreshCodexDesktopThreadMetadata(
        sessionId,
        session,
        activeThreadKey,
        session._activeThreadTitle || '',
      );
    }
  }

  _applyCodexDesktopThreadList(sessionId, session, threads) {
    if (!session || !['codex-desktop', 'cursor'].includes(session.agentType) || !Array.isArray(threads) || threads.length === 0) return;

    if (session.agentType === 'cursor' && session._cursorVirtual) {
      this._applyCursorVirtualAgentList(session.targetId, threads);
      return;
    }

    const threadListSig = JSON.stringify(threads.map(t => `${t.id || ''}:${t.title || ''}:${!!t.active}:${t.age || ''}`));
    if (threadListSig !== session._lastThreadListSig) {
      session._lastThreadListSig = threadListSig;
      this._sendToRelay(proto.threadList(sessionId, threads));
    }
    session._lastThreadList = threads.slice();

    const activeThread = threads.find(t => t && t.active);
    // Stable native IDs are the thread identity. Titles are mutable and the
    // previous presentation-class selector could normalize them differently
    // across builds, causing a false thread change after restart.
    const activeThreadKey = activeThread ? String(activeThread.cache_key || activeThread.id || activeThread.title || '') : '';
    if (session.agentType === 'cursor') {
      const preservePassiveRotation = shouldPreserveCursorPassiveRotation(session);
      const previousThreadKey = session._activeThreadKey || '';
      if (activeThreadKey && previousThreadKey && previousThreadKey !== activeThreadKey) {
        if (preservePassiveRotation) {
          this._log('info', `[${sessionId}] Cursor active agent changed during remote turn; preserving transcript accumulator`);
          this._cacheCursorActiveTranscript(session);
          if (!session._cursorAgentHistories || typeof session._cursorAgentHistories !== 'object') {
            session._cursorAgentHistories = {};
          }
          const inherited = Array.isArray(session._accumulatedMessages)
            ? session._accumulatedMessages.slice()
            : [];
          const destination = session._cursorAgentHistories[activeThreadKey];
          if (!Array.isArray(destination) || destination.length === 0) {
            session._cursorAgentHistories[activeThreadKey] = inherited.slice();
          }
          session._activeThreadKey = activeThreadKey;
          session._activeThreadTitle = activeThread?.title || session._activeThreadTitle || null;
          sessionStore.updateSession(sessionId, {
            accumulated_messages: inherited,
            cursor_agent_histories: session._cursorAgentHistories,
            cursor_active_thread_key: activeThreadKey,
          });
          return;
        }
        this._log('info', `[${sessionId}] Cursor active agent changed; rotating transcript accumulator`);
        this._cacheCursorActiveTranscript(session);
        this._resetTranscriptState(session, 'cursor active agent change');
        const restored = this._restoreCursorTranscriptForThread(session, activeThreadKey, []);
        sessionStore.updateSession(sessionId, {
          accumulated_messages: restored,
          cursor_agent_histories: session._cursorAgentHistories,
          cursor_active_thread_key: activeThreadKey,
        });
      }
      if (activeThreadKey) {
        session._activeThreadKey = activeThreadKey;
        session._activeThreadTitle = activeThread?.title || session._activeThreadTitle || null;
      }
      return;
    }
    if (activeThreadKey) this._applyCodexDesktopActiveThread(sessionId, session, activeThread);
  }

  // ─── Reconnect backoff ───────────────────────────────────────────────────

  _reconnectDelay() {
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt), this.MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    return delay;
  }

  _withTimeout(promise, timeoutMs, label) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // chrome-remote-interface's client.close() awaits the WebSocket close
  // handshake. When the underlying socket is wedged (renderer hung, network
  // drop), that handshake never completes and the await hangs forever. We
  // see this as the proxy poll loop "skipping" thousands of ticks because
  // a tear-down step never returns. Always close clients via this helper.
  async _safeClose(client, label = 'close') {
    if (!client) return;
    try {
      await this._withTimeout(client.close(), 2000, label);
    } catch {}
  }

  _isCodexSurface(agentType) {
    return agentType === 'codex' || agentType === 'codex-desktop';
  }

  _isCdpPortCooling(port) {
    const until = this._cdpPortCooldownUntil.get(port) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this._cdpPortCooldownUntil.delete(port);
      return false;
    }
    return true;
  }

  _cooldownCdpPort(port, reason, ms = 15000) {
    if (!port) return;
    const until = Date.now() + ms;
    const prev = this._cdpPortCooldownUntil.get(port) || 0;
    this._cdpPortCooldownUntil.set(port, Math.max(prev, until));
    if (!prev || Date.now() >= prev) {
      this._log('warn', `[cdp] Cooling down port ${port} for ${Math.round(ms / 1000)}s (${reason})`);
    }
  }

  _isCdpTargetCooling(targetId) {
    if (!targetId) return false;
    const until = this._cdpTargetCooldownUntil.get(targetId) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this._cdpTargetCooldownUntil.delete(targetId);
      return false;
    }
    return true;
  }

  _cooldownCdpTarget(targetOrSession, reason, ms = 30000) {
    const targetId = targetOrSession?.targetId || targetOrSession?.id;
    if (!targetId) return;
    const until = Date.now() + ms;
    const prev = this._cdpTargetCooldownUntil.get(targetId) || 0;
    this._cdpTargetCooldownUntil.set(targetId, Math.max(prev, until));
    pruneExpiredMap(this._cdpTargetCooldownUntil);
    boundOldestMap(this._cdpTargetCooldownUntil, RUNTIME_METADATA_MAP_MAX_ENTRIES);
    if (targetOrSession?._cdpPort) this._cooldownCdpPort(targetOrSession._cdpPort, reason, Math.min(ms, 15000));
    if (!prev || Date.now() >= prev) {
      this._log('warn', `[cdp] Cooling down target ${targetId.substring(0, 8)} for ${Math.round(ms / 1000)}s (${reason})`);
    }
  }

  _connectCdpTarget(target, port, label, timeoutMs = 4000) {
    const targetId = typeof target === 'string' ? target : target.id;
    const host = typeof target === 'string' ? null : target?._cdpHost;
    return this._withTimeout(
      connectCdpTarget(CDP, { port, host, target: targetId }),
      timeoutMs,
      label || `CDP connect ${targetId?.substring?.(0, 8) || targetId}`,
    );
  }

  _attachDesktopCdpDisconnectHandler(sessionId, agentType, client) {
    client.on('disconnect', () => {
      const current = this.sessions.get(sessionId);
      if (current && current.client !== client) {
        this._log('debug', `[${sessionId}] Ignoring disconnect from replaced ${agentType} CDP client`);
        return;
      }
      if (!current) return;
      this._log('info', `[${sessionId}] ${agentType} CDP disconnected`);
      sessionStore.markDisconnected(sessionId);
      this.sessions.delete(sessionId);
      this._broadcastSessionSnapshot();
    });
  }

  async _readCodexDesktopActiveThread(sessionId, session) {
    const threads = await this._withTimeout(
      selectors.readCodexThreadList(session.client.Runtime, true),
      3000,
      `Codex Desktop active thread read ${sessionId.substring(0, 8)}`,
    );
    const active = Array.isArray(threads) ? threads.find(thread => thread?.active) : null;
    return active ? String(active.id || active.title || '') : '';
  }

  async _readCodexDesktopRecentMessages(sessionId, session) {
    return this._withTimeout(
      selectors.readMessages(session.client.Runtime, 'codex-desktop', `${sessionId}:send-recovery`, {
        maxRecentTurns: 8,
        maxRecentUnits: 80,
        primeCollapsed: false,
        bypassCache: true,
      }),
      5000,
      `Codex Desktop send recovery read ${sessionId.substring(0, 8)}`,
    );
  }

  async _captureCodexDesktopArchiveReceiptBaseline(sessionId, session, content) {
    if (!session || session.agentType !== 'codex-desktop') return null;
    const expectedThreadKey = String(session._activeThreadKey || session.codexDesktopActiveThreadKey || '');
    if (!expectedThreadKey) return null;
    const activeThreadKey = await this._readCodexDesktopActiveThread(sessionId, session);
    if (!activeThreadKey || !codexDesktopThreadKeysMatch(expectedThreadKey, activeThreadKey)) return null;

    const provisionalThreadKey = /^local:client-new-thread:/i.test(expectedThreadKey);
    const activeCliSessionId = provisionalThreadKey ? '' : codexDesktopCliSessionId(expectedThreadKey);
    let summary = null;
    if (session._codexDesktopArchivePath) {
      summary = codexCli.readSessionSummary(
        session._codexDesktopArchivePath,
        this._codexCliActiveSummaryOptions(),
      );
    } else if (activeCliSessionId) {
      summary = codexCli.findSessionByCliId(activeCliSessionId, this._codexCliActiveSummaryOptions());
    } else if (provisionalThreadKey) {
      let freshMessages = await this._readCodexDesktopRecentMessages(sessionId, session);
      try {
        if (typeof freshMessages === 'string') freshMessages = JSON.parse(freshMessages || '[]');
      } catch {
        freshMessages = [];
      }
      const provisionalAnchors = Array.from(new Set(
        (Array.isArray(freshMessages) ? freshMessages : [])
          .filter(message => message?.role === 'user' && this._isStrongCodexArchiveAnchor(message))
          .map(message => this._messageContentText(message).replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      )).slice(-4);
      // The relay accumulator can still describe the previously selected
      // thread while a guarded switch is settling. Anchors above therefore
      // come only from a fresh bypass-cache native read, and the active native
      // thread must remain unchanged across that read before it can identify
      // an archive or establish a pre-send byte offset.
      const confirmedThreadKey = await this._readCodexDesktopActiveThread(sessionId, session);
      if (!confirmedThreadKey || !codexDesktopThreadKeysMatch(expectedThreadKey, confirmedThreadKey)) return null;
      if (provisionalAnchors.length >= 2) {
        // A retained owned thread can keep its client placeholder after the
        // one-hour provisional creation window. Multiple exact native anchors
        // are already ambiguity-rejecting, so allow a bounded search across
        // the newest archives instead of falling back to DOM-only receipts.
        summary = codexCli.findRecentSessionByUserAnchors(provisionalAnchors, {
          sinceMs: 0,
          maxFiles: 100,
          summaryOptions: this._codexCliActiveSummaryOptions(),
        });
      } else if (provisionalAnchors.length === 1) {
        summary = codexCli.findRecentSessionByUserAnchor(provisionalAnchors[0], {
          sinceMs: Date.now() - (60 * 60 * 1000),
          maxFiles: 40,
          summaryOptions: this._codexCliActiveSummaryOptions(),
        });
      }
    }
    if (!summary?.filePath || !Array.isArray(summary.messages)) return null;
    if (activeCliSessionId && summary.cliSessionId !== activeCliSessionId) return null;
    if (provisionalThreadKey) {
      session._codexDesktopArchivePath = summary.filePath;
      session._codexDesktopArchiveCliSessionId = summary.cliSessionId || null;
    }

    let archiveOffset = null;
    try { archiveOffset = fs.statSync(summary.filePath).size; } catch {}
    // Anchor subsequent activity reads to the exact pre-send archive state.
    // Without this baseline, the completed previous turn could be mistaken
    // for fresh idle evidence before the newly submitted turn is persisted.
    session._codexDesktopArchiveUpdatedAt = summary.updatedAt || null;
    session._codexDesktopArchiveSizeBytes = Number.isFinite(Number(summary.sizeBytes))
      ? Number(summary.sizeBytes)
      : archiveOffset;

    return {
      active_thread_key: activeThreadKey,
      archive_path: summary.filePath,
      cli_session_id: summary.cliSessionId || null,
      exact_user_matches: countExactCodexUserMessages(summary.messages, content),
      archive_offset: archiveOffset,
    };
  }

  async _confirmCodexDesktopArchiveReceipt(sessionId, session, content, baseline) {
    if (!baseline?.archive_path || !baseline.active_thread_key) return null;
    const current = this.sessions.get(sessionId) || session;
    if (!current?.client) return null;
    try {
      const activeThreadKey = await this._readCodexDesktopActiveThread(sessionId, current);
      if (!activeThreadKey || !codexDesktopThreadKeysMatch(baseline.active_thread_key, activeThreadKey)) {
        return null;
      }
      if (Number.isFinite(baseline.archive_offset)) {
        const stat = fs.statSync(baseline.archive_path);
        if (!stat.isFile() || stat.size < baseline.archive_offset) return null;
        const available = stat.size - baseline.archive_offset;
        if (available <= 0) return null;
        // The persisted user row is the first event of a turn. Read only the
        // first bounded append, avoiding a full-history parse and making
        // repeated prompt text safe even when an active archive is hydrated
        // from a moving tail window.
        const bytesToRead = Math.min(available, 2 * 1024 * 1024);
        const fd = fs.openSync(baseline.archive_path, 'r');
        let appended;
        try {
          const buffer = Buffer.alloc(bytesToRead);
          const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, baseline.archive_offset);
          appended = buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
        if (!codexArchiveAppendContainsExactUser(appended, content)) return null;
        this._log('warn', `[${sessionId}] Recovered Codex Desktop delivery receipt from the exact active-thread archive append; duplicate retry suppressed`);
        return { ok: true, method: 'codex_desktop_archive_append_receipt' };
      }
      const summary = codexCli.readSessionSummary(
        baseline.archive_path,
        this._codexCliActiveSummaryOptions(),
      );
      if (!summary?.filePath || !Array.isArray(summary.messages)) return null;
      if (baseline.cli_session_id && summary.cliSessionId !== baseline.cli_session_id) return null;
      const observedMatches = countExactCodexUserMessages(summary.messages, content);
      if (observedMatches <= Number(baseline.exact_user_matches || 0)) return null;
      this._log('warn', `[${sessionId}] Recovered Codex Desktop delivery receipt from the exact active-thread archive; duplicate retry suppressed`);
      return { ok: true, method: 'codex_desktop_archive_receipt_confirmed' };
    } catch (error) {
      this._log('warn', `[${sessionId}] Codex Desktop archive receipt confirmation failed closed: ${error.message}`);
      return null;
    }
  }

  async _rebindCodexDesktopClient(sessionId, priorSession) {
    const expectedThreadKey = String(priorSession?._activeThreadKey || priorSession?.codexDesktopActiveThreadKey || '');
    const alreadyRebound = this.sessions.get(sessionId);
    if (alreadyRebound?.client && alreadyRebound.client !== priorSession?.client) {
      const activeThreadKey = await this._readCodexDesktopActiveThread(sessionId, alreadyRebound);
      if (!expectedThreadKey || !activeThreadKey || !codexDesktopThreadKeysMatch(expectedThreadKey, activeThreadKey)) {
        return { ok: false, code: 'codex_desktop_thread_changed', session: alreadyRebound };
      }
      return { ok: true, session: alreadyRebound, reusedDiscovery: true };
    }

    const port = Number(priorSession?._cdpPort || 9225);
    let targets;
    try {
      targets = await this._withTimeout(
        listCdpTargets(CDP, { port, ...(priorSession?._cdpHost ? { host: priorSession._cdpHost } : {}) }),
        4000,
        `Codex Desktop send recovery target list ${port}`,
      );
    } catch (error) {
      return { ok: false, code: 'codex_desktop_rebind_failed', detail: error.message, session: priorSession };
    }
    const canonicalTargets = targets.filter(target => isDesktopAppPage({ ...target, _cdpPort: port }, 'codex-desktop'));
    const target = canonicalTargets.find(candidate => candidate.id === priorSession?.targetId)
      || (canonicalTargets.length === 1 ? canonicalTargets[0] : null);
    if (!target) {
      return {
        ok: false,
        code: 'codex_desktop_rebind_failed',
        detail: `Expected one canonical Codex Desktop target, found ${canonicalTargets.length}`,
        session: priorSession,
      };
    }

    let client = null;
    try {
      client = await this._connectCdpTarget(
        { ...target, _cdpPort: port },
        port,
        `Codex Desktop send recovery connect ${target.id.substring(0, 8)}`,
      );
      await this._withTimeout(client.Runtime.enable(), 3000, 'Codex Desktop send recovery Runtime.enable');
      const candidateSession = { ...priorSession, client, targetId: target.id, _cdpPort: port, _cdpHost: target._cdpHost || null };
      const activeThreadKey = await this._readCodexDesktopActiveThread(sessionId, candidateSession);
      if (!expectedThreadKey || !activeThreadKey || !codexDesktopThreadKeysMatch(expectedThreadKey, activeThreadKey)) {
        await this._safeClose(client, `Codex Desktop wrong-thread recovery close ${sessionId.substring(0, 8)}`);
        return {
          ok: false,
          code: 'codex_desktop_thread_changed',
          detail: `Refusing send recovery across thread ${expectedThreadKey || '(unknown)'} -> ${activeThreadKey || '(unknown)'}`,
          session: priorSession,
        };
      }

      const oldClient = priorSession.client;
      priorSession.client = client;
      priorSession.targetId = target.id;
      priorSession._cdpPort = port;
      priorSession._cdpHost = target._cdpHost || null;
      priorSession.status = 'healthy';
      this.sessions.set(sessionId, priorSession);
      sessionStore.updateSession(sessionId, {
        target_id: target.id,
        cdp_port: port,
        status: 'healthy',
        last_seen_at: new Date().toISOString(),
      });
      this._attachDesktopCdpDisconnectHandler(sessionId, 'codex-desktop', client);
      await this._domPush.detach(sessionId);
      await this._domPush.attach(sessionId, client);
      await this._safeClose(oldClient, `Codex Desktop replaced-client close ${sessionId.substring(0, 8)}`);
      this._broadcastSessionSnapshot();
      this._log('warn', `[${sessionId}] Rebound closed Codex Desktop CDP client on the unchanged active thread`);
      return { ok: true, session: priorSession, rebound: true };
    } catch (error) {
      await this._safeClose(client, `Codex Desktop failed-recovery close ${sessionId.substring(0, 8)}`);
      return { ok: false, code: 'codex_desktop_rebind_failed', detail: error.message, session: priorSession };
    }
  }

  async _recoverCodexDesktopSendAfterTransportLoss(sessionId, priorSession, content, failedResult) {
    const current = this.sessions.get(sessionId);
    let transportLost = !current || current.client !== priorSession.client;
    if (!transportLost) {
      const readyState = Number(priorSession.client?._ws?.readyState);
      transportLost = readyState === 2 || readyState === 3;
    }
    if (!transportLost) {
      try {
        await this._withTimeout(priorSession.client.Runtime.evaluate({
          expression: 'true',
          returnByValue: true,
          silent: true,
        }), 1500, 'Codex Desktop send transport probe');
      } catch (error) {
        transportLost = isClosedCdpTransportError(error);
      }
    }
    if (!transportLost) return { result: failedResult, session: priorSession };

    const rebound = await this._rebindCodexDesktopClient(sessionId, priorSession);
    if (!rebound.ok) {
      return {
        result: { ok: false, code: rebound.code, detail: rebound.detail || 'Codex Desktop recovery was not safe' },
        session: rebound.session || priorSession,
      };
    }

    let observedMatches;
    try {
      const raw = await this._readCodexDesktopRecentMessages(sessionId, rebound.session);
      observedMatches = countExactCodexUserMessages(raw, content);
    } catch (error) {
      return {
        result: { ok: false, code: 'codex_desktop_recovery_unverified', detail: error.message },
        session: rebound.session,
      };
    }
    const baselineMatches = Math.max(0, Number(failedResult?.baseline_matches || 0));
    if (observedMatches > baselineMatches) {
      this._log('warn', `[${sessionId}] Recovered Codex Desktop delivery receipt after CDP rebind; duplicate retry suppressed`);
      return {
        result: { ok: true, method: 'cdp_rebind_receipt_recovered' },
        session: rebound.session,
      };
    }
    if (observedMatches !== baselineMatches) {
      return {
        result: {
          ok: false,
          code: 'codex_desktop_recovery_unverified',
          detail: `Exact user-message count changed unexpectedly (${baselineMatches} -> ${observedMatches})`,
        },
        session: rebound.session,
      };
    }

    this._log('warn', `[${sessionId}] Closed CDP transport confirmed with no persisted user turn; retrying once on the unchanged thread`);
    const retryResult = await this._sendSessionMessage(rebound.session, content, sessionId);
    return { result: retryResult, session: rebound.session };
  }

  // ─── CDP target resolution ───────────────────────────────────────────────

  async _listTargetsOnPort(port) {
    if (this._isCdpPortCooling(port)) return [];
    return this._withTimeout(listCdpTargets(CDP, { port }), 3000, `CDP list port ${port}`);
  }

  async _resolveCdpTargets() {
    const candidatePorts = this.CDP_PORTS.filter(port => !this._isCdpPortCooling(port));
    if (candidatePorts.length === 0) {
      throw new Error(`All configured CDP ports are cooling down (configured: ${this.CDP_PORTS.join(', ')})`);
    }
    const results = await Promise.allSettled(
      candidatePorts.map(port => this._listTargetsOnPort(port).then(targets =>
        targets.map(t => Object.assign({}, t, { _cdpPort: port }))
      ))
    );

    const allTargets = [];
    const successfulCdpPorts = new Set();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        successfulCdpPorts.add(candidatePorts[i]);
        allTargets.push(...r.value);
      } else {
        if (!r.reason?.message?.includes('ECONNREFUSED')) {
          this._log('warn', `[cdp] Port ${candidatePorts[i]} error: ${r.reason?.message}`);
          if (String(r.reason?.message || '').includes('timed out')) {
            this._cooldownCdpPort(candidatePorts[i], r.reason.message, 15000);
          }
        }
      }
    }

    if (successfulCdpPorts.size === 0) {
      throw new Error(`No configured CDP ports responded (tried: ${this.CDP_PORTS.join(', ')})`);
    }

    return { targets: allTargets, successfulCdpPorts };
  }

  // ─── Relay connection ────────────────────────────────────────────────────

  connectRelay() {
    if (!this._running) return;
    const attempt = this.reconnectAttempt + 1;
    this._log('info', `[relay] Connecting to ${this.RELAY_URL} (attempt ${attempt})...`);
    const ws = new WebSocket(this.RELAY_URL);
    this.relayWs = ws;

    ws.on('open', () => {
      this._log('info', '[relay] Socket open — sending connection_hello');
      ws.send(JSON.stringify(proto.hello(this.MACHINE_LABEL, this.PROXY_ID, this.PROXY_SECRET)));
    });

    ws.on('message', (data) => {
      try {
        this._handleRelayMessage(JSON.parse(data.toString()));
      } catch (e) {
        this._log('error', `[relay] Bad message: ${e.message}`);
      }
    });

    ws.on('close', (code) => {
      this.relayReady   = false;
      this.connectionId = null;
      this._stopHeartbeat();
      this._hostResourceMonitor.detachAll();
      if (!this._running) return;
      const delay = this._reconnectDelay();
      this._log('info', `[relay] Closed (${code}). Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connectRelay(), delay);
    });

    ws.on('error', (err) => {
      this._log('error', `[relay] Error: ${err.message}`);
    });
  }

  _registerQuestionPromptAdapter(sessionId, prompt, answer, metadata = {}) {
    if (!sessionId || !prompt?.prompt_id || !prompt?.generation || typeof answer !== 'function') {
      throw new Error('A question prompt adapter requires a session, prompt generation, and answer function');
    }
    if (prompt.session_id && prompt.session_id !== sessionId) {
      throw new Error('Question prompt session does not match its adapter destination');
    }
    const entry = { prompt: proto.questionPrompt(sessionId, prompt), answer, claimed: false, ...metadata };
    this.activeQuestionPromptAdapters.set(sessionId, entry);
    this._sendToRelay(entry.prompt);
    return entry.prompt;
  }

  _clearQuestionPromptAdapter(sessionId, lifecycle, details = {}) {
    const entry = this.activeQuestionPromptAdapters.get(sessionId);
    if (!entry) return false;
    this.activeQuestionPromptAdapters.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session?._vscodeQuestionDeadlineTimer) {
      clearTimeout(session._vscodeQuestionDeadlineTimer);
      session._vscodeQuestionDeadlineTimer = null;
    }
    this._sendToRelay(proto.questionPromptState(
      sessionId,
      entry.prompt.prompt_id,
      entry.prompt.generation,
      lifecycle,
      details,
    ));
    return true;
  }

  _handleRelayMessage(msg) {
    const { type } = msg;

    if (PRIORITY_RELAY_TYPES.has(type) && !msg[PRIORITY_RELAY_CONTROL]) {
      const sessionId = msg.session_id || msg.session;
      const prioritySession = sessionId ? this.sessions.get(sessionId) : null;
      this._priorityControlInFlight = (this._priorityControlInFlight || 0) + 1;
      if (prioritySession) {
        prioritySession._priorityControlInFlight = (prioritySession._priorityControlInFlight || 0) + 1;
      }
      if (sessionId) this._cancelDomPushSecondaryPoll(sessionId);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this._priorityControlInFlight = Math.max(0, (this._priorityControlInFlight || 1) - 1);
        if (prioritySession) {
          prioritySession._priorityControlInFlight = Math.max(
            0,
            (prioritySession._priorityControlInFlight || 1) - 1,
          );
        }
      };
      let result;
      try {
        result = this._handleRelayMessage({ ...msg, [PRIORITY_RELAY_CONTROL]: true });
      } catch (error) {
        release();
        throw error;
      }
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(release);
      }
      release();
      return result;
    }

    if (isWriteCommand(type)) {
      const sessionId = msg.session_id || msg.session;
      const session = sessionId ? this.sessions.get(sessionId) : null;
      const gate = validationGateForAgentType(session?.agentType);
      if (session && gate.gated) {
        const error = {
          code: 'pending_revalidation',
          message: gate.reason,
          retryable: true,
          revalidation_harness: gate.harness,
          revalidation_version: gate.installed_version,
        };
        if ((type === 'send' || type === 'send_message') && msg.client_message_id) {
          this._sendToRelay(proto.proxySendResult(sessionId, msg.client_message_id, 'failed', error));
        } else {
          this._sendToRelay(proto.agentControlResult(
            sessionId,
            msg.request_id || msg.client_message_id || null,
            type,
            'failed',
            error,
          ));
        }
        return;
      }
    }

    if (['new_chat', 'new_thread', 'switch_chat', 'switch_thread'].includes(type)
        && !msg[SERIALIZED_NAVIGATION]) {
      const sessionId = msg.session_id || msg.session;
      const session = this.sessions.get(sessionId);
      if (sessionId && session) {
        const incomingEpoch = normalizeNavigationEpoch(msg.navigation_epoch);
        const navigationEpoch = incomingEpoch || (Number(session._navigationRevision || 0) + 1);
        session._navigationRevision = navigationEpoch;
        return this._navigationOperations.enqueue(
          sessionId,
          { sessionId, requestId: msg.request_id, command: type, navigationEpoch },
          () => this._navigationContext.run(
            { sessionId, navigationEpoch },
            () => this._handleRelayMessage({
              ...msg,
              navigation_epoch: navigationEpoch,
              [SERIALIZED_NAVIGATION]: true,
            }),
          ),
        );
      }
    }

    // ── Protocol v1 handshake ───────────────────────────────────────────
    if (type === 'connection_ack') {
      this.reconnectAttempt = 0;
      this.relayReady       = true;
      this.connectionId     = msg.connection_id || null;
      this._relayEpoch      = (this._relayEpoch || 0) + 1;
      this.hbIntervalMs     = msg.heartbeat_interval_ms || 10000;
      this._log('info', `[relay] Handshake OK. connection_id=${this.connectionId}, hb=${this.hbIntervalMs}ms`);
      this._startHeartbeat();
      // The relay deliberately clears cached prompts when a proxy socket
      // disconnects. Re-emit prompts that are still visible natively after
      // every successful handshake; otherwise the proxy's local dedupe map
      // suppresses them forever and a reconnected WebUI silently loses the
      // actionable status surface.
      for (const entry of this.activePermissionPrompts.values()) {
        if (entry?.surfaced && entry.prompt) this._sendToRelay(entry.prompt);
      }
      for (const entry of this.activeQuestionPromptAdapters.values()) {
        if (entry?.prompt && entry.claimed !== true) this._sendToRelay(entry.prompt);
      }
      for (const [sessionId, entry] of this.activeErrorPrompts.entries()) {
        if (entry?.surfaced && entry.prompt) {
          this._sendToRelay(proto.sessionErrorPrompt(sessionId, {
            prompt_id: entry.prompt_id,
            ...entry.prompt,
          }));
        }
      }
      // Flush any history snapshots that were emitted while relayReady was
      // still false (the discovery path runs in parallel with this handshake
      // on startup, so its initial-snapshot _sendToRelay calls hit before
      // we're allowed to send and would otherwise be lost).
      this._lastSessionSnapshotSig = null;
      this._sendSessionSnapshotNow('connection_ack');
      this._providerUsage.emit();
      this._flushPendingPreReadyHistory();
      // Send all known sessions from session-store for relay backfill
      this._sendSessionMetaBackfill();
      // Re-emit agent config for all active sessions
      for (const [sessionId, session] of this.sessions.entries()) {
        const agentCaps = this._buildCapabilities(session.agentType, session.workspace_path);
        const resolvedPath = session.workspace_path;
        this._readSessionConfig(session, resolvedPath)
          .then(cfg => {
            const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, cfg, resolvedPath));
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}): ${JSON.stringify(this._configLogSummary(merged, agentCaps))}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          })
          .catch(err => {
            const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, null, resolvedPath));
            this._log('info', `[startup-cfg] ${sessionId} (${session.agentType}) fallback (err: ${err?.message}): ${JSON.stringify(this._configLogSummary(merged, agentCaps))}`);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          });
      }
      // Re-sync transcript history
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType === 'codex_cli' && session.codexCliArchiveDiscovered === true
            && !session._codexCliChild && !session._codexAppServerTurn
            && session._goalRunLifecycle?.lease_active !== true) {
          continue;
        }
        if (shouldFastPollCodexCliSession(session)) {
          everyTickIds.push(sessionId);
          continue;
        }
        if (session.agentType === 'cursor_cli' && session.cursorCliArchiveDiscovered === true && !session._cursorCliChild) {
          continue;
        }
        const relayEpoch = this._relayEpoch;
        const navigationRevision = Number(session._navigationRevision || 0);
        this._readSessionMessages(session, sessionId)
          .then(raw => {
            if (relayEpoch !== this._relayEpoch
                || this.sessions.get(sessionId) !== session
                || Number(session._navigationRevision || 0) !== navigationRevision) {
              this._log('debug', `[relay] Discarded stale reconnect history for ${sessionId}`);
              return;
            }
            if (!raw && !session._accumulatedMessages) return;
            const msgs = raw ? JSON.parse(raw) : [];
            const effMsgs = session._accumulatedMessages || msgs;
            if (effMsgs.length > 0) this._sendHistorySnapshot(sessionId, effMsgs, 'relay reconnect resync');
          })
          .catch(e => this._log('warn', `[relay] History resync failed for ${sessionId}: ${e.message}`));
      }
      // Re-broadcast queued messages so the frontend queue bar survives refresh
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.messageQueue?.length) {
          for (const item of session.messageQueue) {
            this._sendToRelay(proto.messageQueued(sessionId, item.client_message_id, item.content));
          }
          this._log('info', `[relay] Re-broadcast ${session.messageQueue.length} queued messages for ${sessionId}`);
        }
        // Re-broadcast native queue state and reset signature so next poll re-sends
        if (session.nativeQueue?.length) {
          this._sendToRelay(proto.nativeQueue(sessionId, session.nativeQueue));
          this._log('info', `[relay] Re-broadcast ${session.nativeQueue.length} native queue items for ${sessionId}`);
        }
        session._nativeQueueSig = null; // Force re-detection on next poll
      }
      return;
    }

    if (type === 'heartbeat_ack') return;

    if (type === 'provider_usage_watch') {
      this._providerUsage.setWatching(msg.active === true).catch(error => {
        this._log('warn', `[usage] Watch cadence update failed: ${error?.message || 'unknown error'}`);
      });
      return;
    }

    if (type === 'provider_usage_refresh') {
      const requestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      const providerId = typeof msg.provider_id === 'string' ? msg.provider_id.slice(0, 80) : null;
      if (providerId && msg.force === true) {
        const claim = this._providerUsage.claimManualRefresh(providerId);
        if (!claim.ok) {
          this._sendToRelay({
            type: 'provider_usage_refresh_receipt',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            provider_id: providerId,
            status: 'error',
            code: claim.code,
            retry_after_ms: claim.retryAfterMs,
          });
          return;
        }
      }
      const coalesced = !!this._providerUsage.inFlight;
      this._providerUsage.refresh({
        force: msg.force === true,
        reason: 'client',
        waitForCost: false,
        providerId,
      }).then(snapshot => {
        this._sendToRelay({
          type: 'provider_usage_refresh_receipt',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          provider_id: providerId,
          status: 'completed',
          coalesced,
          generation: Number(snapshot?.generation) || 0,
          cost_status: snapshot?.estimated_cost?.status || 'unavailable',
        });
      }).catch(error => {
        this._log('warn', `[usage] Refresh failed: ${error?.message || 'unknown error'}`);
        this._sendToRelay({
          type: 'provider_usage_refresh_receipt',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          provider_id: providerId,
          status: 'error',
          code: String(error?.code || 'refresh_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        });
      });
      return;
    }

    if (type === 'provider_usage_reset_credit_consume') {
      const requestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 120) : null;
      if (!requestId || msg.approved !== true) {
        this._sendToRelay({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          status: 'error',
          code: requestId ? 'operator_approval_required' : 'invalid_request_id',
        });
        return;
      }
      if (this._providerUsageResetInFlight) {
        this._sendToRelay({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          status: 'error',
          code: 'reset_in_progress',
        });
        return;
      }
      const run = (async () => {
        const connection = this._codexUsageResetConnectionFactory({
          sessionId: 'provider-usage-reset',
          cwd: process.cwd(),
          clientName: 'remote-agent-chat-usage-reset',
          clientVersion: '1.0.0',
        });
        try {
          await connection.start();
          const before = normalizeRateLimitState(await connection.readRateLimits());
          let outcome = 'nothingToReset';
          if (before.limited && before.resetCreditsAvailable > 0) {
            const consumed = await connection.consumeRateLimitResetCredit(null, requestId);
            outcome = consumed?.outcome || 'unknown';
          } else if (before.limited) {
            outcome = 'noCredit';
          }
          let after = before;
          try {
            after = normalizeRateLimitState(await connection.readRateLimits());
          } catch (error) {
            this._log('warn', `[usage] Post-reset limit read failed: ${error?.message || 'unknown error'}`);
          }
          this._sendToRelay({
            type: 'provider_usage_reset_credit_receipt',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            status: 'completed',
            outcome,
            reset_credits_available: after.resetCreditsAvailable,
          });
          await this._providerUsage.refresh({ force: true, reason: 'reset_credit', waitForCost: false })
            .catch(error => this._log('warn', `[usage] Post-reset refresh failed: ${error?.message || 'unknown error'}`));
        } finally {
          await connection.stop().catch(() => {});
        }
      })().catch(error => {
        this._log('warn', `[usage] Reset credit action failed: ${error?.message || 'unknown error'}`);
        this._sendToRelay({
          type: 'provider_usage_reset_credit_receipt',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          status: 'error',
          code: String(error?.code || 'reset_credit_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        });
      }).finally(() => {
        if (this._providerUsageResetInFlight === run) this._providerUsageResetInFlight = null;
      });
      this._providerUsageResetInFlight = run;
      return;
    }

    if (type === 'provider_usage_cost_detail_request') {
      const requestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 80) : null;
      this._providerUsage.costDetailPage({
        days: msg.days,
        providerId: msg.provider_id,
        project: msg.project,
        cursor: msg.cursor,
        pageSize: msg.page_size,
      }).then(detail => {
        this._sendToRelay({
          type: 'provider_usage_cost_detail',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          detail,
        });
      }).catch(error => {
        this._sendToRelay({
          type: 'provider_usage_cost_detail_error',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          code: String(error?.code || 'cost_detail_failed').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60),
        });
      });
      return;
    }

    if (type === 'host_resource_refresh') {
      this._hostResourceMonitor.refresh({
        requestId: msg.request_id,
        force: msg.force === true,
        aggregateOnly: msg.aggregate_only === true,
      }).catch(error => {
        this._log('warn', `[resources] Refresh failed: ${error?.message || 'unknown error'}`);
      });
      return;
    }

    if (type === 'host_resource_subscribe') {
      const requestId = typeof msg.request_id === 'string' ? msg.request_id.slice(0, 120) : null;
      const subscriberId = typeof msg.subscription_id === 'string' ? msg.subscription_id.slice(0, 120) : null;
      try {
        const subscription = this._hostResourceMonitor.subscribe({
          subscriberId,
          aggregateOnly: msg.aggregate_only === true,
        });
        this._sendToRelay({
          type: 'host_resource_subscription_ack',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          ...subscription,
        });
      } catch (error) {
        this._sendToRelay({
          type: 'host_resource_subscription_error',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          code: 'subscription_failed',
        });
      }
      return;
    }

    if (type === 'host_resource_detach') {
      this._hostResourceMonitor.detach(msg.subscription_id);
      return;
    }

    if (type === 'host_resource_unsubscribe') {
      this._hostResourceMonitor.unsubscribe(msg.subscription_id);
      this._sendToRelay({
        type: 'host_resource_unsubscribed',
        protocol_version: proto.PROTOCOL_VERSION,
        request_id: typeof msg.request_id === 'string' ? msg.request_id.slice(0, 120) : null,
        subscription_id: typeof msg.subscription_id === 'string' ? msg.subscription_id.slice(0, 120) : null,
      });
      return;
    }

    if (type === 'host_resource_history_request') {
      const chunk = this._hostResourceMonitor.historyChunk(
        msg.subscription_id,
        msg.stream,
        { afterSequence: msg.after_sequence, maxPoints: msg.max_points },
      );
      this._sendToRelay({
        type: chunk ? 'host_resource_history_chunk' : 'host_resource_subscription_error',
        protocol_version: proto.PROTOCOL_VERSION,
        request_id: typeof msg.request_id === 'string' ? msg.request_id.slice(0, 120) : null,
        subscription_id: typeof msg.subscription_id === 'string' ? msg.subscription_id.slice(0, 120) : null,
        ...(chunk ? { chunk } : { code: 'subscription_unknown' }),
      });
      return;
    }

    if (type === 'session_snapshot_ack') {
      const duplicates = msg.duplicate_sessions || [];
      if (duplicates.length > 0) {
        this._log('warn', `[proxy] WARNING: ${duplicates.length} session(s) already registered under a different proxy — possible duplicate proxy process. Sessions: ${duplicates.join(', ')}`);
      }
      return;
    }

    if (type === 'connection_error') {
      this._log('error', `[relay] Protocol error: ${msg.code} — ${msg.message}`);
      return;
    }

    // ── Send requests ───────────────────────────────────────────────────
    if (type === 'send_message') {
      return this._handleSendRequest({
        session:           msg.session_id,
        content:           msg.content,
        file:              msg.file,
        client_message_id: msg.client_message_id,
      });
      return;
    }

    if (type === 'send') {
      return this._handleSendRequest(msg);
    }

    if (type === 'steer') {
      this._handleSteerRequest(msg);
      return;
    }

    if (type === 'discard_queued') {
      const sid = msg.session_id || msg.session;
      const session = this.sessions.get(sid);
      const cid = msg.client_message_id;

      // Native queue item — click Codex's "Delete queued message" button
      if (cid && cid.startsWith('native-') && session) {
        const idx = parseInt(cid.replace('native-', ''), 10) || 0;
        const usePageEval = session.agentType === 'codex-desktop';
        const evalFn = usePageEval ? selectors.evalInPage : selectors.evalInFrame;
        evalFn(session.client.Runtime, `
          var delBtns = Array.from(d.querySelectorAll('button[aria-label="Delete queued message"]'));
          if (delBtns.length > ${idx}) { delBtns[${idx}].click(); return 'deleted-' + ${idx}; }
          if (delBtns.length > 0) { delBtns[0].click(); return 'deleted-0-fallback'; }
          return 'no-delete-btn';
        `).then(r => {
          this._log('info', `[${sid}] Native queue delete: ${r}`);
          // Reset native queue sig to force re-detection
          session._nativeQueueSig = null;
        }).catch(() => {});
        return;
      }

      // Proxy-queued item
      if (session?.messageQueue) {
        const wasFirst = session.messageQueue[0]?.client_message_id === cid;
        session.messageQueue = session.messageQueue.filter(m => m.client_message_id !== cid);
        this._log('info', `[${sid}] Discarded queued message ${cid} (remaining: ${session.messageQueue.length})`);
        // If the discarded message was the one in ProseMirror, type the next one
        if (wasFirst) this._typeNextQueuedIntoProseMirror(sid);
      }
      return;
    }

    if (type === 'edit_queued') {
      const sid = msg.session_id || msg.session;
      const session = this.sessions.get(sid);
      if (session?.messageQueue) {
        const item = session.messageQueue.find(m => m.client_message_id === msg.client_message_id);
        if (item) {
          item.content = msg.content;
          this._log('info', `[${sid}] Edited queued message ${msg.client_message_id}`);
        }
      }
      return;
    }

    // ── Agent control commands ──────────────────────────────────────────
    if (type === 'transcript_resync_required') {
      this._handleTranscriptResyncRequest(msg);
      return;
    }

    if (type === 'history_chunk_request') {
      this._handleHistoryChunkRequest(msg);
      return;
    }

    if (type === 'agent_goal_control') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_goal_control', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`, native_attempted: false, retryable: true,
        }));
        return;
      }
      const capabilities = this._buildCapabilities(sessionData.agentType, sessionData.workspace_path);
      if (capabilities.goal_pause_resume !== true) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_goal_control', 'failed', {
          code: 'goal_control_unsupported', message: 'This session has no verified native goal control', native_attempted: false, retryable: false,
        }));
        return;
      }
      return this._controlCodexGoal(sid, sessionData, msg).then(details => {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_goal_control', 'ok', details));
      }).catch(error => {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_goal_control', 'failed', {
          code: error?.code || 'goal_control_failed',
          message: error?.message || 'Goal control failed',
          native_attempted: error?.native_attempted === true,
          retryable: error?.retryable !== false,
        }));
      });
    }

    if (type === 'agent_interrupt') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }

      const interruptCapability = this._buildCapabilities(sessionData.agentType, sessionData.workspace_path);
      if (interruptCapability.interrupt !== true) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
          code: 'interrupt_unsupported', message: interruptCapability.interrupt_gate || 'No verified session-scoped stop exists',
          native_attempted: false, retryable: false,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_interrupt for ${sid} (${sessionData.agentType})`);
      const retainedGoal = sessionData.activity?.goal || null;
      if (sessionData.agentType === 'claude_cli' || sessionData.agentType === 'codex_cli' || sessionData.agentType === 'cursor_cli') {
        if (sessionData.agentType === 'codex_cli' && sessionData._codexAppServerTurn) {
          const turn = sessionData._codexAppServerTurn;
          sessionData._codexCliInterrupted = true;
          Promise.resolve(turn.interrupt())
            .then(() => {
              if (this.sessions.get(sid) !== sessionData) return;
              const activity = {
                kind: 'idle', label: 'Interrupted', updated_at: new Date().toISOString(),
                ...(retainedGoal ? { goal: retainedGoal } : {}),
              };
              sessionData.activity = activity;
              sessionData.waitingForAssistant = false;
              sessionStore.updateSession(sid, { activity, codex_cli_interrupted: true });
              this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', activity));
              this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'ok', {
                native_acknowledged: true, method: 'codex_app_server_turn_interrupt', native_operations: 1,
              }));
            })
            .catch(error => {
              sessionData._codexCliInterrupted = false;
              this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
                code: 'interrupt_failed', message: error.message || 'Could not interrupt the owned Codex turn',
              }));
            });
          return;
        }
        const childKey = sessionData.agentType === 'codex_cli' ? '_codexCliChild'
          : sessionData.agentType === 'cursor_cli' ? '_cursorCliChild'
          : '_claudeCliChild';
        if (sessionData.agentType === 'claude_cli' && sessionData[childKey]) {
          sessionData._claudeCliInterrupted = true;
          const stopped = claudeCli.stopNativeClaudeWindow(sessionData[childKey]);
          if (!stopped.ok) {
            sessionData._claudeCliInterrupted = false;
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
              code: 'interrupt_failed', message: stopped.detail || 'Could not stop Claude CLI process tree',
            }));
            return;
          }
        } else if (sessionData.agentType === 'codex_cli' && sessionData[childKey]) {
          sessionData._codexCliInterrupted = true;
          const stopped = codexCli.stopCodexExecSession(sessionData[childKey]);
          if (!stopped.ok) {
            sessionData._codexCliInterrupted = false;
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
              code: 'interrupt_failed', message: stopped.detail || 'Could not stop Codex CLI process tree',
            }));
            return;
          }
        } else if (sessionData.agentType === 'cursor_cli' && sessionData[childKey]) {
          sessionData._cursorCliInterrupted = true;
          const stopped = cursorCli.stopCursorExecSession(sessionData[childKey]);
          if (!stopped.ok) {
            sessionData._cursorCliInterrupted = false;
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
              code: 'interrupt_failed', message: stopped.detail || 'Could not stop Cursor CLI process tree',
            }));
            return;
          }
        } else if (sessionData[childKey]) {
          try { sessionData[childKey].kill(); } catch {}
          sessionData[childKey] = null;
        } else {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
            code: 'interrupt_unavailable', message: 'No RAC-owned native turn or child process is running',
            native_attempted: false, retryable: true,
          }));
          return;
        }
        const activity = {
          kind: 'idle', label: 'Interrupted', updated_at: new Date().toISOString(),
          ...(retainedGoal ? { goal: retainedGoal } : {}),
        };
        sessionData.activity = activity;
        sessionStore.updateSession(sid, {
          activity,
          ...(sessionData.agentType === 'codex_cli' ? { codex_cli_interrupted: true } : {}),
          ...(sessionData.agentType === 'cursor_cli' ? { cursor_cli_interrupted: true } : {}),
        });
        this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', activity));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'ok', {
          native_acknowledged: true, method: 'owned_process_tree_stop', native_operations: 1,
        }));
        return;
      }
      const interruptAndVerify = async client => {
        const result = await selectors.interruptAgent(client.Runtime, sessionData.agentType, sid, client);
        if (!result?.ok) return result;
        let consecutiveIdleObservations = 0;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const observed = await selectors.detectThinking(client.Runtime, sessionData.agentType);
          if (observed?.thinking !== true) {
            consecutiveIdleObservations += 1;
            if (consecutiveIdleObservations >= 2) {
              return { ...result, ok: true, native_acknowledged: true, native_operations: 1 };
            }
          } else {
            consecutiveIdleObservations = 0;
          }
          await sleep(100);
        }
        return {
          ok: false,
          code: 'interrupt_not_acknowledged',
          detail: 'The native surface still reports an in-flight turn after Stop',
          native_attempted: true,
          retryable: true,
        };
      };
      const interruptPromise = (async () => {
        if (sessionData.agentType === 'cursor' && sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) {
            return { ok: false, code: 'cursor_agent_not_active', detail: activated.detail };
          }
        }
        return this._isEphemeralIframeAgent(sessionData.agentType)
          ? this._withEphemeralIframeClient(sessionData, client => interruptAndVerify(client), 'interrupt')
          : interruptAndVerify(sessionData.client);
      })();
      interruptPromise
        .then((result) => {
          if (result.ok && result.native_acknowledged === true) {
            const activity = {
              kind: 'idle', label: 'Interrupted', updated_at: new Date().toISOString(),
              ...(retainedGoal ? { goal: retainedGoal } : {}),
            };
            sessionData._activityEpoch = (sessionData._activityEpoch || 0) + 1;
            sessionData._interruptSettled = true;
            sessionData.activity = activity;
            sessionData.waitingForAssistant = false;
            if (this._isCodexSurface(sessionData.agentType)) {
              selectors.setCodexCachedThinking(sid, { thinking: false, label: '', goal: retainedGoal });
            }
            sessionStore.updateSession(sid, { activity });
            this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', activity));
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'ok', {
              native_acknowledged: true,
              method: result.method || 'native_stop',
              native_operations: Number(result.native_operations) || 1,
            }));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
              code: result.code || 'interrupt_failed', message: result.detail || 'Interrupt failed',
              native_attempted: result.native_attempted === true, retryable: result.retryable !== false,
            }));
          }
        })
        .catch((err) => {
          this._log('error', `[ctrl] agent_interrupt failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_interrupt', 'failed', {
            code: 'interrupt_exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_set_auto_approve_permissions') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const enabled = msg.enabled === true;
      const agentT = sessionData?.agentType;

      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      if (!this._supportsAutoApprovePermissions(agentT)) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'failed', {
          code: 'not_supported', message: `Auto-approve is not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      sessionData.autoApprovePermissions = enabled;
      sessionStore.updateSession(sid, { auto_approve_permissions: enabled });
      if (sessionData.preferenceKey) {
        sessionStore.updatePreference(sessionData.preferenceKey, { auto_approve_permissions: enabled });
      }
      this._log('info', `[ctrl] auto_approve_permissions for ${sid}: ${enabled}`);
      this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_auto_approve_permissions', 'ok'));

      this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
        .then(cfg => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
        })
        .catch(() => {
          const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, sessionData.workspace_path));
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
        });

      const lastPrompt = this.activePermissionPrompts.get(sid);
      if (enabled && lastPrompt?.prompt) {
        this._attemptAutoApprovePrompt(sid, sessionData, lastPrompt.prompt, !!lastPrompt.surfaced).catch(() => {});
      }
      return;
    }

    if (type === 'question_response') {
      const sid = msg.session_id || msg.session;
      const entry = this.activeQuestionPromptAdapters.get(sid);
      if (!entry) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'question_response', 'failed', {
          code: 'question_prompt_not_owned', message: 'Answer in native Codex; this proxy does not own the open question.',
        }));
        return;
      }
      if (entry.prompt.prompt_id !== msg.prompt_id || entry.prompt.generation !== msg.generation) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'question_response', 'failed', {
          code: 'stale_question_generation', message: 'The native question changed before this response arrived.',
        }));
        return;
      }
      if (entry.claimed) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'question_response', 'failed', {
          code: 'question_response_already_claimed', message: 'The native question response was already claimed.',
        }));
        return;
      }
      entry.claimed = true;
      return Promise.resolve(entry.answer(msg))
        .then(result => {
          if (result?.ok && result?.native_acknowledged === true) {
            this.activeQuestionPromptAdapters.delete(sid);
            this._sendToRelay({
              ...proto.agentControlResult(sid, msg.request_id, 'question_response', 'ok'),
              native_acknowledged: true,
              lifecycle: result.lifecycle || (msg.action === 'cancel' ? 'cancelled' : 'answered'),
              ...(result.native_receipt ? { native_receipt: result.native_receipt } : {}),
            });
          } else {
            const nativeAttempted = result?.native_attempted !== false;
            if (nativeAttempted) this.activeQuestionPromptAdapters.delete(sid);
            else entry.claimed = false;
            this._sendToRelay({
              ...proto.agentControlResult(sid, msg.request_id, 'question_response', 'failed', {
                code: result?.code || 'native_question_not_acknowledged',
                message: result?.detail || 'The native question did not acknowledge this response.',
              }),
              native_attempted: nativeAttempted,
              retryable: result?.retryable === true && !nativeAttempted,
            });
          }
        })
        .catch(error => {
          this.activeQuestionPromptAdapters.delete(sid);
          const nativeAttempted = error.native_attempted !== false;
          this._sendToRelay({
            ...proto.agentControlResult(sid, msg.request_id, 'question_response', 'failed', {
              code: error.code || 'question_adapter_exception', message: error.message,
            }),
            native_attempted: nativeAttempted,
            retryable: false,
          });
        });
      return;
    }

    if (type === 'permission_response') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      const choiceId = msg.choice_id;
      const answers = Array.isArray(msg.answers) ? msg.answers : [];
      const instruction = typeof msg.instruction === 'string' ? msg.instruction.trim() : '';
      this._log('info', `[ctrl] permission_response for ${sid} prompt=${msg.prompt_id} choice=${choiceId} answers=${answers.length} instruction=${instruction ? 'yes' : 'no'} auto=${!!msg.auto_applied}`);

      // Auto-expiration from relay with no valid choice — just clear local state
      // so the dialog can be re-detected on the next poll cycle
      if (msg.auto_applied && !choiceId) {
        this._log('info', `[ctrl] Auto-expired prompt for ${sid}, clearing for re-detection`);
        this.activePermissionPrompts.delete(sid);
        this.activeErrorPrompts.delete(sid);
        return;
      }

      const permissionPromise = (async () => {
        if (sessionData.agentType === 'cursor' && sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) return { ok: false, code: 'cursor_agent_not_active', detail: activated.detail };
        }
        return this._isEphemeralIframeAgent(sessionData.agentType)
          ? this._withEphemeralIframeClient(sessionData, client =>
              selectors.respondToPermissionDialog(client.Runtime, sessionData.agentType, choiceId, sid, client, { answers, instruction })
            , 'permission_response')
          : selectors.respondToPermissionDialog(sessionData.client.Runtime, sessionData.agentType, choiceId, sid, sessionData.client, { answers, instruction });
      })();
      permissionPromise
        .then(result => {
          if (result.ok) {
            this.activePermissionPrompts.delete(sid);
            this.activeErrorPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'ok'));
          } else {
            // Clear activePermissionPrompts on failure so re-detection works
            this.activePermissionPrompts.delete(sid);
            this.activeErrorPrompts.delete(sid);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
              code: result.code || 'click_failed', message: result.detail || 'Could not click permission dialog button',
            }));
          }
        })
        .catch(err => {
          // Clear activePermissionPrompts on error so re-detection works
          this.activePermissionPrompts.delete(sid);
          this.activeErrorPrompts.delete(sid);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'permission_response', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'error_prompt_action') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      this._log('info', `[ctrl] error_prompt_action for ${sid} action=${msg.action_id}`);
      if (sessionData.agentType === 'claude_cli') {
        if (msg.action_id === 'open_native_window') {
          try {
            const child = claudeCli.startNativeClaudeWindow({
              workspacePath: sessionData.workspace_path || process.cwd(),
              cliSessionId: sessionData.cliSessionId || crypto.randomUUID(),
              resume: !!sessionData.claudeCliFilePath,
              model: sessionData.model_id,
              effort: sessionData.effort,
              permissionMode: sessionData.permission_mode,
              title: `${sessionData.workspace_name || 'Claude Code'} - Claude CLI`,
              launchMode: 'foreground',
              operatorActionProof: msg.operator_action_proof,
              requestId: msg.request_id,
            });
            sessionData.nativeClaudeWindowChild = child;
            this._log('info', `[ctrl] reopened native Claude CLI window for ${sid} pid=${child?.pid || 'unknown'}`);
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'ok'));
          } catch (e) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
              code: e.code || 'spawn_failed', message: e.message,
            }));
          }
          return;
        }
        if (msg.action_id === 'trust_workspace') {
          claudeCli.trustWorkspace({
            workspacePath: sessionData.workspace_path || process.cwd(),
            model: sessionData.model_id,
            effort: sessionData.effort,
            permissionMode: sessionData.permission_mode,
          }).then(result => {
            if (!result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
                code: 'trust_failed', message: result.detail || 'Claude CLI trust helper failed',
              }));
              return;
            }
            try {
              sessionData.nativeCliStatus = 'background_ready';
              sessionData.nativeCliWindowOpened = false;
              sessionStore.updateSession(sid, {
                native_cli_status: sessionData.nativeCliStatus,
                native_cli_window_opened: false,
              });
              this._log('info', `[ctrl] trusted Claude workspace for ${sid}; native window remains operator-action-only`);
              this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'ok'));
            } catch (e) {
              this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
                code: 'spawn_failed', message: e.message,
              }));
            }
          }).catch(e => {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
              code: 'exception', message: e.message,
            }));
          });
          return;
        }
      }
      const actionPromise = this._isEphemeralIframeAgent(sessionData.agentType)
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.respondToSessionErrorPrompt(client.Runtime, sessionData.agentType, msg.action_id, sid)
          , 'error_prompt_action')
        : selectors.respondToSessionErrorPrompt(sessionData.client.Runtime, sessionData.agentType, msg.action_id, sid);
      actionPromise
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
              code: result.code || 'click_failed', message: result.detail || 'Could not apply error prompt action',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'error_prompt_action', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_set_model') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      const modelId = msg.model_id;
      this._log('info', `[ctrl] agent_set_model for ${sid} model=${modelId}`);
      if (sessionData.agentType === 'claude_cli' || sessionData.agentType === 'codex_cli' || sessionData.agentType === 'cursor_cli') {
        const cliAgentType = sessionData.agentType;
        if (cliAgentType === 'codex_cli') {
          const normalizedModelId = codexCli.normalizeCodexModelAlias(modelId, codexCli.CODEX_CLI_MODELS);
          const allowedModels = new Set(codexCli.CODEX_CLI_MODELS.map(item => item.id));
          if (!normalizedModelId || !allowedModels.has(normalizedModelId)) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
              code: 'unsupported_model_alias',
              message: `Codex CLI does not currently advertise model ${modelId || '(empty)'}`,
            }));
            return;
          }
          sessionData.nextSendModelId = normalizedModelId;
          sessionData.nextSendModelStatus = 'pending';
          sessionData.nextSendModelError = null;
          const advertisedModel = codexCli.CODEX_CLI_MODELS.find(item => item.id === normalizedModelId);
          if (sessionData.nextSendEffort && advertisedModel?.supported_efforts?.length
              && !advertisedModel.supported_efforts.includes(sessionData.nextSendEffort)) {
            sessionData.nextSendEffortStatus = 'failed';
            sessionData.nextSendEffortError = 'effort_not_advertised_for_model';
          }
          sessionData.codexCliModelConfigured = true;
          sessionStore.updateSession(sid, {
            codex_cli_model_configured: true,
            codex_cli_next_model_id: normalizedModelId,
            codex_cli_next_model_status: 'pending',
            codex_cli_next_model_error: null,
            codex_cli_next_effort_status: sessionData.nextSendEffortStatus || 'unset',
            codex_cli_next_effort_error: sessionData.nextSendEffortError || null,
          });
          this._publishCodexCliConfig(sid, sessionData);
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
          return;
        }
        sessionData.model_id = modelId || 'default';
        if (cliAgentType === 'cursor_cli') sessionData.cursorCliModelConfigured = true;
        sessionStore.updateSession(sid, {
          model_id: sessionData.model_id,
          ...(cliAgentType === 'cursor_cli' ? { cursor_cli_model_configured: true } : {}),
        });
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(cliAgentType, {
          model_id: sessionData.model_id,
          permission_mode: sessionData.permission_mode,
          effort: sessionData.effort,
          sandbox: sessionData.sandbox,
        }, sessionData.workspace_path));
        this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(cliAgentType, sessionData.workspace_path) }));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
        return;
      }
      const setModelPromise = (async () => {
        if (sessionData.agentType === 'cursor' && sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) return { ok: false, code: 'cursor_agent_not_active', detail: activated.detail };
        }
        return this._isEphemeralIframeAgent(sessionData.agentType)
          ? this._withEphemeralIframeClient(sessionData, client =>
              selectors.setAgentModel(client.Runtime, sessionData.agentType, modelId, sid, client.Input)
            , 'set_model')
          : selectors.setAgentModel(sessionData.client.Runtime, sessionData.agentType, modelId, sid, sessionData.client.Input);
      })();
      setModelPromise
        .then(result => {
          if (result.ok) {
            if (sessionData.agentType === 'claude' && result.model_id) {
              sessionData.model_id = result.model_id;
              sessionData._currentModelId = result.model_id;
              if (Array.isArray(result.available_models) && result.available_models.length > 0) {
                sessionData._lastAvailableModels = result.available_models;
              }
              sessionStore.updateSession(sid, { model_id: result.model_id });
            }
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'ok'));
            return this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                if (sessionData.agentType === 'claude') {
                  cfg = { ...(cfg || {}) };
                  if (result.model_id) cfg.model_id = result.model_id;
                  if (Array.isArray(result.available_models) && result.available_models.length > 0) {
                    cfg.available_models = result.available_models;
                  }
                }
                const merged = this._stabilizeCursorModelOptions(
                  sessionData,
                  this._decorateAgentConfig(sessionData, this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path))
                );
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(sessionData.agentType, sessionData.workspace_path) }));
              }).catch(() => {});
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
              code: result.code || 'select_failed', message: result.detail || 'Model selection failed',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_model', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_set_mode') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      if (!sessionData) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'session_unknown', message: `No active session: ${sid}`,
        }));
        return;
      }
      const isRooCodeLike = sessionData.agentType === 'roo_code' || sessionData.agentType === 'cline';
      if (sessionData.agentType !== 'antigravity' && !isRooCodeLike) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'not_supported', message: `Conversation mode not supported for ${sessionData.agentType}`,
        }));
        return;
      }
      if (!isRooCodeLike && !sessionData.client.Input) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
          code: 'no_input_domain', message: 'CDP Input domain not available',
        }));
        return;
      }
      const mode = msg.mode;
      this._log('info', `[ctrl] agent_set_mode for ${sid} mode=${mode}`);
      const setModePromise = isRooCodeLike
        ? this._withEphemeralIframeClient(sessionData, client =>
            selectors.setRooCodeMode(client.Runtime, mode, sid, client.Input)
          , 'set_mode')
        : selectors.setAntigravityMode(sessionData.client.Runtime, sessionData.client.Input, mode, sid);
      setModePromise
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'ok'));
            return this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(sessionData.agentType, cfg, sessionData.workspace_path));
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(sessionData.agentType, sessionData.workspace_path) }));
              }).catch(() => {});
          } else {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
              code: result.code || 'set_failed', message: result.detail || 'Mode selection failed',
            }));
          }
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_mode', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    if (type === 'agent_config_request') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const capabilities = this._buildCapabilities(agentT, sessionData?.workspace_path);

      if (!sessionData) {
        this._sendToRelay(proto.agentConfig(sid, {
          model_id: 'unknown', permission_mode: 'unknown', file_access_scope: 'unknown', auto_approve_permissions: false, capabilities, request_id: msg.request_id || null,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_config_request for ${sid} (${agentT})`);
      this._readSessionConfig(
        sessionData,
        sessionData.workspace_path,
        (agentT === 'continue' || agentT === 'continue_yolo') ? { forceRefresh: true } : {}
      )
        .then(cfg => {
          const merged = this._stabilizeCursorModelOptions(
            sessionData,
            this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path))
          );
          this._log('info', `[ctrl] agent_config sending for ${sid}: ${JSON.stringify(this._configLogSummary(merged, capabilities))}`);
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities, request_id: msg.request_id || null }));
        })
        .catch(() => {
          const merged = this._stabilizeCursorModelOptions(
            sessionData,
            this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, sessionData.workspace_path))
          );
          this._log('info', `[ctrl] agent_config sending (fallback) for ${sid}: ${JSON.stringify(this._configLogSummary(merged, capabilities))}`);
          this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities, request_id: msg.request_id || null }));
        });
      return;
    }

    if (type === 'agent_set_permission_mode') {
      const sid = msg.session_id || msg.session;
      const mode = msg.mode;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      const isRooCodeLike = agentT === 'roo_code' || agentT === 'cline';
      if (agentT !== 'claude' && agentT !== 'claude_cli' && agentT !== 'codex_cli' && agentT !== 'cursor_cli' && agentT !== 'continue_yolo' && !isRooCodeLike) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
          code: 'not_supported', message: `Permission mode change not supported for ${agentT || 'unknown'} agent`,
        }));
        return;
      }

      this._log('info', `[ctrl] agent_set_permission_mode for ${sid} mode=${mode}`);
      if (agentT === 'claude_cli' || agentT === 'codex_cli' || agentT === 'cursor_cli') {
        sessionData.permission_mode = mode || (
          agentT === 'codex_cli' ? 'workspace-write'
            : agentT === 'cursor_cli' ? 'force'
              : 'default'
        );
        if (agentT === 'codex_cli') sessionData.codexCliPermissionConfigured = true;
        if (agentT === 'cursor_cli') sessionData.cursorCliPermissionConfigured = true;
        sessionStore.updateSession(sid, {
          permission_mode: sessionData.permission_mode,
          ...(agentT === 'codex_cli' ? { codex_cli_permission_configured: true } : {}),
          ...(agentT === 'cursor_cli' ? { cursor_cli_permission_configured: true } : {}),
        });
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, {
          model_id: sessionData.model_id,
          permission_mode: sessionData.permission_mode,
          effort: sessionData.effort,
          sandbox: sessionData.sandbox,
        }, sessionData.workspace_path));
        this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'ok'));
        return;
      }
      this._withEphemeralIframeClient(sessionData, client =>
        selectors.setAgentPermissionMode(client.Runtime, agentT, mode, sid, client.Input)
      , 'set_permission_mode')
        .then(result => {
          if (!result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
              code: result.code || 'set_failed',
              message: result.detail || 'Could not update Claude permission mode in the live session',
            }));
            return;
          }
          const persistence = agentT === 'claude'
            ? this._writeWorkbenchSetting(sessionData, 'claudeCode.initialPermissionMode', mode)
            : { ok: true, path: null, host: null };
          if (agentT === 'claude' && !persistence.ok) {
            this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
              code: 'write_failed',
              message: `Updated the live Claude session, but could not persist ${persistence.host || 'editor'} settings.json`,
            }));
            return;
          }

          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'ok'));
          setTimeout(() => {
            this._readSessionConfig(sessionData, sessionData.workspace_path, { forceRefresh: true })
              .then(cfg => {
                const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
                this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
              })
              .catch(() => {});
          }, 250);
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_permission_mode', 'failed', {
            code: 'exception', message: err.message,
          }));
        });
      return;
    }

    // ── Codex config change ─────────────────────────────────────────────
    if (type === 'agent_set_effort') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const effort = msg.effort;
      if (!sessionData || (sessionData.agentType !== 'claude_cli' && sessionData.agentType !== 'codex_cli')) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'failed', {
          code: 'not_supported', message: `Effort change not supported for ${sessionData?.agentType || 'unknown'} agent`,
        }));
        return;
      }
      const allowed = new Set((sessionData.agentType === 'codex_cli' ? codexCli.CODEX_CLI_EFFORTS : claudeCli.CLAUDE_CLI_EFFORTS).map(item => item.id));
      if (!effort || !allowed.has(effort)) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'failed', {
          code: 'invalid_effort', message: `Unsupported ${sessionData.agentType === 'codex_cli' ? 'Codex' : 'Claude'} CLI effort: ${effort || 'empty'}`,
        }));
        return;
      }
      if (sessionData.agentType === 'codex_cli') {
        const targetModelId = sessionData.nextSendModelId
          || (sessionData.observedModelId !== 'unknown' ? sessionData.observedModelId : null);
        const targetModel = targetModelId
          ? codexCli.CODEX_CLI_MODELS.find(model => model.id === targetModelId)
          : null;
        if (targetModel?.supported_efforts?.length && !targetModel.supported_efforts.includes(effort)) {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'failed', {
            code: 'effort_not_advertised_for_model',
            message: `${targetModelId} does not advertise reasoning effort ${effort}`,
          }));
          return;
        }
        sessionData.nextSendEffort = effort;
        sessionData.nextSendEffortStatus = 'pending';
        sessionData.nextSendEffortError = null;
        sessionData.codexCliEffortConfigured = true;
        sessionStore.updateSession(sid, {
          codex_cli_effort_configured: true,
          codex_cli_next_effort: effort,
          codex_cli_next_effort_status: 'pending',
          codex_cli_next_effort_error: null,
        });
        this._publishCodexCliConfig(sid, sessionData);
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'ok'));
        return;
      }
      sessionData.effort = effort;
      sessionStore.updateSession(sid, {
        effort,
      });
      const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(sessionData.agentType, {
        model_id: sessionData.model_id,
        permission_mode: sessionData.permission_mode,
        effort: sessionData.effort,
      }, sessionData.workspace_path));
      this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(sessionData.agentType, sessionData.workspace_path) }));
      this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'agent_set_effort', 'ok'));
      return;
    }

    if (type === 'set_codex_config') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      if (agentT !== 'codex' && agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'not_supported', message: `set_codex_config not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }
      const intent = this._codexConfigIntent(msg, agentT);
      if (!intent.ok) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: intent.code, message: intent.message,
        }));
        return;
      }
      if (agentT === 'codex') {
        this._queueVsCodeCodexConfig(msg, sessionData, intent);
        return;
      }

      const updates = {};
      if (msg.model_id)      updates.model             = msg.model_id;
      if (msg.effort)        updates.reasoning_effort   = msg.effort;
      if (msg.access_mode)   updates.sandbox_mode       = msg.access_mode;
      if (msg.speed)         updates.service_tier       = codexSpeedToConfigValue(msg.speed);

      if (Object.keys(updates).length === 0) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'no_fields', message: 'No config fields specified',
        }));
        return;
      }

      this._log('info', `[ctrl] set_codex_config for ${sid}: ${JSON.stringify(updates)}`);

      const cdpUpdates = {};
      if (msg.model_id)    cdpUpdates.model_id    = msg.model_id;
      if (msg.effort)      cdpUpdates.effort      = msg.effort;
      if (msg.access_mode) cdpUpdates.access_mode = msg.access_mode;
      if (msg.speed)       cdpUpdates.speed       = msg.speed;
      selectors.setCodexDesktopConfig(
        sessionData.client.Runtime,
        cdpUpdates,
        true,
        sessionData.client.Input || null
      ).catch(() => {});

      const ok = this._writeCodexConfigValues(updates);
      if (ok) {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'ok'));
        selectors.readAgentConfig(sessionData.client.Runtime, agentT, sessionData.workspace_path)
          .then(cfg => {
            const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, sessionData.workspace_path));
            if (msg.model_id)    merged.model_id        = msg.model_id;
            if (msg.effort)      merged.effort           = msg.effort;
            if (msg.access_mode) merged.permission_mode  = msg.access_mode;
            if (msg.speed)       merged.speed            = msg.speed;
            this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
          })
          .catch(() => {});
      } else {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'set_codex_config', 'failed', {
          code: 'write_failed', message: 'Could not write ~/.codex/config.toml',
        }));
      }
      return;
    }

    // ── Switch workspace (codex-desktop, Epic 3) ───────────────────────
    if (type === 'switch_workspace') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const folderPath = msg.folder_path;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
          code: 'not_supported', message: `switch_workspace not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!folderPath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
          code: 'invalid_message', message: 'switch_workspace requires folder_path',
        }));
        return;
      }

      this._log('info', `[ctrl] switch_workspace for ${sid}: ${folderPath}`);
      selectors.switchCodexWorkspace(sessionData.client.Runtime, folderPath, true)
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'ok'));
            // Refresh config after workspace switch
            setTimeout(() => {
              selectors.readAgentConfig(sessionData.client.Runtime, agentT, folderPath)
                .then(cfg => {
                  const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, cfg, folderPath));
                  this._sendToRelay(proto.agentConfig(sid, { ...merged, capabilities: this._buildCapabilities(agentT, sessionData.workspace_path) }));
                }).catch(() => {});
            }, 2000);
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', {
              code: result.code || 'workspace_not_found', message: result.detail || 'Workspace not found',
            }));
          }
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_workspace', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Thread list (codex-desktop, Epic 2) ─────────────────────────────
    if (type === 'thread_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'failed', {
          code: 'not_supported', message: `thread_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (sessionData._cursorVirtual) {
        this._sendToRelay(proto.threadList(sid, [{
          id: sessionData.cursorAgentId,
          cache_key: sessionData.cursorAgentId,
          title: sessionData.chat_title || sessionData.windowTitle || 'Cursor agent',
          active: sessionData._cursorNativeActive === true,
          workspace_name: sessionData.workspace_name,
          workspace_key: sessionData.cursorWorkspaceKey || null,
          native_status: sessionData.nativeStatus || null,
        }]));
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'ok'));
        return;
      }

      const threadListPromise = agentT === 'cursor'
        ? require('./cursor-selectors').readCursorAgentList(sessionData.client.Runtime)
        : selectors.readCodexThreadList(sessionData.client.Runtime, true);
      threadListPromise
        .then(threads => {
          this._sendToRelay(proto.threadList(sid, threads));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] thread_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'thread_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Switch thread (codex-desktop, Epic 2) ────────────────────────────
    if (type === 'switch_thread') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const threadId = msg.thread_id;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
          code: 'not_supported', message: `switch_thread not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!threadId) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
          code: 'invalid_message', message: 'switch_thread requires thread_id',
        }));
        return;
      }

      if (sessionData._cursorVirtual) {
        if (threadId !== sessionData.cursorAgentId) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
            code: 'cursor_agent_session_boundary',
            message: 'Choose the other Cursor agent session from the Agent Sessions sidebar',
          }));
          return;
        }
        return this._ensureCursorVirtualSessionActive(sessionData).then(result => {
          this._sendToRelay(proto.agentControlResult(
            sid,
            requestId,
            'switch_thread',
            result.ok ? 'ok' : 'failed',
            result.ok ? undefined : { code: 'cursor_agent_not_active', message: result.detail },
          ));
        }).catch(error => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
            code: 'cdp_error', message: error.message,
          }));
        });
      }

      const switchPromise = agentT === 'cursor'
        ? this._withTimeout(
            require('./cursor-selectors').switchCursorAgent(sessionData.client.Runtime, threadId),
            10000,
            `cursor switch native ${sid}`,
          )
        : selectors.switchCodexThread(sessionData.client.Runtime, threadId, true);
      return switchPromise
        .then(async result => {
          if (result.ok) {
            try {
              if (agentT === 'cursor' && sessionData._newChatPending) {
                delete sessionData._newChatPending;
                sessionStore.updateSession(sid, { cursor_new_chat_pending: false });
                this._broadcastSessionSnapshot();
              }
              if (agentT === 'cursor') this._cacheCursorActiveTranscript(sessionData);
              let cursorThreadKey = threadId;
              if (agentT === 'cursor') {
                const cursorThreads = await this._withTimeout(
                  require('./cursor-selectors').readCursorAgentList(sessionData.client.Runtime),
                  5000,
                  `cursor switch thread list ${sid}`,
                );
                const activeCursorThread = Array.isArray(cursorThreads) ? cursorThreads.find(thread => thread && thread.active) : null;
                cursorThreadKey = String(activeCursorThread?.cache_key || activeCursorThread?.id || threadId);
                if (Array.isArray(cursorThreads)) this._sendToRelay(proto.threadList(sid, cursorThreads));
              }
              const freshRaw = agentT === 'cursor'
                ? await this._withTimeout(
                    selectors.readMessages(sessionData.client.Runtime, sessionData.agentType, sid),
                    10000,
                    `cursor switch transcript ${sid}`,
                  )
                : await selectors.readMessages(sessionData.client.Runtime, sessionData.agentType, sid);
              const freshMessages = typeof freshRaw === 'string' ? JSON.parse(freshRaw || '[]') : freshRaw;
              const restoredMessages = agentT === 'cursor'
                ? this._restoreCursorTranscriptForThread(sessionData, cursorThreadKey, freshMessages)
                : freshMessages;
              if (agentT === 'cursor') {
                sessionData._activeThreadKey = cursorThreadKey;
                sessionStore.updateSession(sid, {
                  accumulated_messages: restoredMessages,
                  cursor_agent_histories: sessionData._cursorAgentHistories,
                  cursor_active_thread_key: cursorThreadKey,
                });
              } else if (agentT === 'codex-desktop') {
                // The just-read native snapshot is the authoritative transcript
                // for the selected thread. Keep it in the same accumulator that
                // send receipt baselines inspect; emitting it only to relay left
                // an immediate post-switch send with no archive identity anchors.
                this._resetTranscriptState(sessionData, 'codex-desktop remote thread switch');
                sessionData._accumulatedMessages = Array.isArray(restoredMessages)
                  ? restoredMessages.slice()
                  : [];
                sessionData._activeThreadKey = threadId;
                sessionData.codexDesktopActiveThreadKey = threadId;
                sessionData._codexDesktopArchiveMessages = null;
                sessionData._codexDesktopArchivePath = null;
                sessionData._codexDesktopArchiveUpdatedAt = null;
                sessionData._codexDesktopArchiveSizeBytes = null;
                sessionData._codexDesktopArchivePollSettledActivity = null;
                sessionData._codexDesktopArchiveCliSessionId = null;
                sessionData._codexDesktopArchiveBlockCounts = null;
                sessionData._codexDesktopArchivePartial = false;
                sessionStore.updateSession(sid, {
                  accumulated_messages: sessionData._accumulatedMessages,
                  codex_desktop_active_thread_key: threadId,
                });
              } else {
                sessionData._accumulatedMessages = null;
                sessionStore.updateSession(sid, { accumulated_messages: null });
              }
              sessionData.lastMessageCount = restoredMessages.length;
              sessionData.lastObservedCount = restoredMessages.length;
              sessionData.pendingLast = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(restoredMessages);
              this._sendHistorySnapshot(sid, restoredMessages, 'switch_thread');
            } catch (err) {
              this._log('warn', `[ctrl] switch_thread post-switch snapshot failed for ${sid}: ${err.message}`);
            }
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
              code: 'thread_not_found', message: result.detail || 'Thread not found',
            }));
          }
        })
        .catch(err => {
          this._log('warn', `[ctrl] switch_thread failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_thread', 'failed', {
            code: 'cdp_error', message: err.message,
          }));
        });
    }

    // ── New thread (codex-desktop) ──────────────────────────────────────
    if (type === 'new_thread') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;

      if (agentT !== 'codex-desktop' && agentT !== 'claude-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', 'failed', {
          code: 'not_supported', message: `new_thread not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'cursor') this._cacheCursorActiveTranscript(sessionData);
      const newThreadPromise = agentT === 'cursor'
        ? require('./cursor-selectors').newCursorAgent(sessionData.client.Runtime, sessionData.client.Input)
        : selectors.newCodexThread(sessionData.client.Runtime, true).then(ok => ({ ok }));
      return newThreadPromise
        .then(async result => {
          let finalOk = !!result?.ok;
          if (!finalOk && agentT === 'codex-desktop') {
            try {
              const res = await sessionData.client.Runtime.evaluate({
                expression: `(function() {
                  const body = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
                  return /let.?s build|message codex|what can i help|start typing/.test(body);
                })()`,
                returnByValue: true,
                awaitPromise: false,
              });
              finalOk = !!res?.result?.value;
            } catch {}
          }
          if (finalOk) {
            try {
              if (agentT === 'cursor') {
                sessionData._newChatPending = Date.now();
                sessionData._activeThreadKey = '';
                sessionStore.updateSession(sid, { cursor_new_chat_pending: true });
                this._broadcastSessionSnapshot();
              }
              const freshRaw = await selectors.readMessages(sessionData.client.Runtime, sessionData.agentType, sid);
              const freshMessages = typeof freshRaw === 'string' ? JSON.parse(freshRaw || '[]') : freshRaw;
              sessionData._accumulatedMessages = null;
              sessionStore.updateSession(sid, agentT === 'cursor'
                ? {
                    accumulated_messages: null,
                    cursor_agent_histories: sessionData._cursorAgentHistories || {},
                    cursor_active_thread_key: null,
                  }
                : { accumulated_messages: null });
              sessionData.lastMessageCount = freshMessages.length;
              sessionData.lastObservedCount = freshMessages.length;
              sessionData.pendingLast = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
              this._sendHistorySnapshot(sid, freshMessages, 'new_thread');
            } catch {}
          }
          this._sendToRelay(proto.agentControlResult(
            sid,
            msg.request_id,
            'new_thread',
            finalOk ? 'ok' : 'failed',
            finalOk ? undefined : { code: 'new_thread_failed', message: result?.detail || 'Native new thread did not settle' }
          ));
        })
        .catch(err => {
          this._sendToRelay(proto.agentControlResult(sid, msg.request_id, 'new_thread', 'failed', { code: 'cdp_error', message: err.message }));
        });
    }

    // ── Open panel (codex — activity bar click on workbench page) ──────
    if (type === 'open_panel') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'antigravity_panel') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
          code: 'not_supported', message: `open_panel not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'antigravity_panel') {
        // antigravity_panel sessions already have a workbench page Runtime
        selectors.openAntigravityPanel(sessionData.client.Runtime)
          .then(result => {
            if (result.ok) {
              this._log('info', `[ctrl] open_panel OK for AG panel ${sid}: method=${result.method} detail=${result.detail}`);
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'ok'));
              // Trigger rediscovery after a short delay so the newly opened panel
              // is picked up as a session without waiting for the next poll cycle
              setTimeout(() => this._discoverTargets().catch(() => {}), 2000);
            } else {
              this._log('warn', `[ctrl] open_panel failed for AG panel ${sid}: ${result.detail}`);
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
                code: result.code || 'panel_not_found', message: result.detail || 'Panel icon not found',
              }));
            }
          })
          .catch(e => {
            this._log('warn', `[ctrl] open_panel error for AG panel ${sid}: ${e.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_panel', 'failed', {
              code: 'cdp_error', message: e.message,
            }));
          });
        return;
      }

      // Connect to a workbench page to click the activity bar
      this._openCodexPanelViaWorkbench(sid, requestId, sessionData);
      return;
    }

    // ── Chat list (codex / codex-desktop) ────────────────────────────────
    if (type === 'chat_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      this._log('info', `[ctrl] chat_list request for ${sid} (${agentT || 'no session'})`);

      if (agentT !== 'codex' && agentT !== 'continue' && agentT !== 'codex-desktop' && agentT !== 'cursor' && agentT !== 'antigravity_panel' && agentT !== 'antigravity-v2' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', {
          code: 'not_supported', message: `chat_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'cursor') {
        if (sessionData._cursorVirtual) {
          this._sendToRelay(proto.chatList(sid, [{
            id: sessionData.cursorAgentId,
            title: sessionData.chat_title || sessionData.windowTitle || 'Cursor agent',
            active: sessionData._cursorNativeActive === true,
            workspace_name: sessionData.workspace_name,
            workspace_key: sessionData.cursorWorkspaceKey || null,
            native_status: sessionData.nativeStatus || null,
          }]));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          return;
        }
        require('./cursor-selectors').readCursorAgentList(sessionData.client.Runtime)
          .then(chats => {
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] chat_list failed for cursor ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      if (agentT === 'antigravity_panel') {
        selectors.readAntigravityPanelChatList(sessionData.client.Runtime)
          .then(chats => {
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] chat_list failed for AG panel ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      if (agentT === 'antigravity-v2') {
        selectors.readAntigravityV2ChatList(sessionData.client.Runtime)
          .then(chats => {
            sessionData._lastChatList = Array.isArray(chats) ? chats : [];
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] chat_list failed for AG v2 ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      if (agentT === 'codex-desktop') {
        sessionData._accumulatedMessages = null;
        sessionStore.updateSession(sid, { accumulated_messages: null });
      }
      if (agentT === 'continue') {
        return this._withWorkbenchClient(sessionData, client =>
          selectors.readContinueWorkbenchChatList(client.Runtime, sessionData._webviewId)
        )
          .then(chats => {
            this._log('info', `[ctrl] chat_list result for ${sid}: ${chats.length} continue tabs`);
            this._sendToRelay(proto.chatList(sid, chats));
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
          })
          .catch(err => {
            this._log('warn', `[ctrl] continue chat_list failed for ${sid}: ${err.message}`);
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
          });
      }
      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      // For desktop apps, reuse the thread list reader which understands the page-level DOM
      const readerFn = (agentT === 'codex-desktop' || agentT === 'claude-desktop')
        ? selectors.readCodexThreadList(sessionData.client.Runtime, true)
        : selectors.readCodexChatList(sessionData.client.Runtime, usePageEval, true, sessionData._activeCodexChatId || '');
      readerFn
        .then(chats => {
          this._log('info', `[ctrl] chat_list result for ${sid}: ${chats.length} chats`);
          this._sendToRelay(proto.chatList(sid, chats));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] chat_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'chat_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Switch chat (codex / codex-desktop) ──────────────────────────────
    if (type === 'switch_chat') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const chatId = msg.chat_id;

      if (agentT !== 'codex' && agentT !== 'continue' && agentT !== 'codex-desktop' && agentT !== 'cursor' && agentT !== 'antigravity_panel' && agentT !== 'antigravity-v2' && agentT !== 'claude-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
          code: 'not_supported', message: `switch_chat not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (!chatId) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
          code: 'invalid_message', message: 'switch_chat requires chat_id',
        }));
        return;
      }

      if (sessionData._cursorVirtual) {
        if (chatId !== sessionData.cursorAgentId) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
            code: 'cursor_agent_session_boundary',
            message: 'Choose the other Cursor agent session from the Agent Sessions sidebar',
          }));
          return;
        }
        return this._ensureCursorVirtualSessionActive(sessionData).then(result => {
          this._sendToRelay(proto.agentControlResult(
            sid,
            requestId,
            'switch_chat',
            result.ok ? 'ok' : 'failed',
            result.ok ? undefined : { code: 'cursor_agent_not_active', message: result.detail },
          ));
        }).catch(error => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
            code: 'cdp_error', message: error.message,
          }));
        });
      }

      if (agentT === 'antigravity_panel') {
        return selectors.switchAntigravityPanelChat(sessionData.client.Runtime, chatId)
          .then(result => {
            if (result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
            } else {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
                code: result.code || 'chat_not_found', message: result.detail || 'Chat not found',
              }));
            }
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error' }));
          });
        return;
      }

      if (agentT === 'antigravity-v2') {
        return selectors.switchAntigravityV2Chat(sessionData.client.Runtime, chatId)
          .then(async result => {
            if (!result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
                code: result.code || 'chat_not_found', message: result.detail || 'Chat not found',
              }));
              return;
            }

            if (result.action === 'see_all' || result.action === 'project') {
              const chats = await selectors.readAntigravityV2ChatList(sessionData.client.Runtime).catch(() => []);
              if (Array.isArray(chats)) {
                sessionData._lastChatList = chats;
                sessionData._lastChatListSig = JSON.stringify(chats.map(c => `${c.kind || 'chat'}:${c.id || ''}:${c.title || ''}:${!!c.active}:${c.project || ''}`));
                this._sendToRelay(proto.chatList(sid, chats));
              }
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
              return;
            }

            const navigatedToListView = !!result.view && result.view !== 'conversation' && !result.after;
            sessionData.v2ConversationId = result.after || (navigatedToListView ? null : chatId);
            sessionData._listView = navigatedToListView;
            if (navigatedToListView) {
              sessionData.chat_title = result.title || 'Antigravity v2';
              sessionData.windowTitle = result.title || sessionData.windowTitle;
            }
            sessionData.lastMessageCount = 0;
            sessionData.lastObservedCount = 0;
            sessionData.lastTranscriptSig = '';
            sessionData.pendingLast = null;
            sessionData.resyncCandidateSig = null;
            sessionData.waitingForAssistant = false;
            sessionData._accumulatedMessages = null;
            const chats = await selectors.readAntigravityV2ChatList(sessionData.client.Runtime).catch(() => []);
            if (Array.isArray(chats)) {
              sessionData._lastChatList = chats;
              this._sendToRelay(proto.chatList(sid, chats));
              const activeChat = chats.find(c => c && c.active);
              if (activeChat?.title) sessionData.chat_title = activeChat.title;
            }
            if (navigatedToListView) {
              this._sendHistorySnapshot(sid, [], `antigravity v2 ${result.view || 'navigation'}`);
              this._broadcastSessionSnapshot();
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
              return;
            }
            const freshRaw = await selectors.readMessages(sessionData.client.Runtime, 'antigravity-v2', sid).catch(() => '[]');
            const freshMessages = freshRaw ? JSON.parse(freshRaw) : [];
            sessionData._accumulatedMessages = freshMessages.slice();
            sessionData.lastMessageCount = freshMessages.length;
            sessionData.lastObservedCount = freshMessages.length;
            sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
            sessionData.pendingLast = null;
            sessionData.waitingForAssistant = freshMessages.length > 0 && freshMessages[freshMessages.length - 1]?.role === 'user';
            if (!sessionData.waitingForAssistant) {
              const idleActivity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              sessionData.thinking = false;
              sessionData.thinkingLabel = '';
              sessionData.thinkingContent = '';
              sessionData.activity = idleActivity;
              sessionStore.updateSession(sid, { activity: idleActivity });
              this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', idleActivity));
            }
            this._sendHistorySnapshot(sid, freshMessages, 'antigravity v2 switch chat');
            this._broadcastSessionSnapshot();
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
          })
          .catch(err => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error', message: err.message }));
          });
      }

      if (agentT === 'continue') {
        return this._withWorkbenchClient(sessionData, client =>
          selectors.switchContinueWorkbenchChat(client.Runtime, sessionData._webviewId, chatId)
        )
          .then(async result => {
            if (!result.ok) {
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
                code: result.code || 'chat_not_found', message: result.detail || 'Chat not found',
              }));
              return;
            }

            sessionData._continueConfigCache = null;
            sessionData.lastMessageCount = 0;
            sessionData.lastObservedCount = 0;
            sessionData.lastTranscriptSig = '';
            sessionData.pendingLast = null;
            sessionData.waitingForAssistant = false;
            sessionData.resyncCandidateSig = null;
            sessionData._lastStreamedContent = null;
            this._sendHistorySnapshot(sid, [], 'continue switch chat clear');

            if (Array.isArray(result.chats)) {
              const chatListSig = JSON.stringify(result.chats.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
              sessionData._lastChatListSig = chatListSig;
              this._sendToRelay(proto.chatList(sid, result.chats));
              const activeChat = result.chats.find(c => c && c.active);
              if (activeChat?.title) {
                sessionData.chat_title = activeChat.title;
              }
            }

            this._broadcastSessionSnapshot();
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error' }));
          });
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop' || agentT === 'cursor';
      // For desktop apps, use the thread switcher which understands the page-level DOM
      const switchPromise = agentT === 'cursor'
        ? require('./cursor-selectors').switchCursorAgent(sessionData.client.Runtime, chatId)
        : ((agentT === 'codex-desktop' || agentT === 'claude-desktop')
          ? selectors.switchCodexThread(sessionData.client.Runtime, chatId, true)
          : selectors.switchCodexChat(sessionData.client.Runtime, chatId, usePageEval));
      return switchPromise
        .then(async result => {
          if (result.ok) {
            if (agentT === 'cursor') {
              if (sessionData._newChatPending) {
                delete sessionData._newChatPending;
                sessionStore.updateSession(sid, { cursor_new_chat_pending: false });
              }
              sessionData._activeThreadKey = chatId;
              const freshRaw = await selectors.readMessages(sessionData.client.Runtime, agentT, sid);
              const freshMessages = typeof freshRaw === 'string' ? JSON.parse(freshRaw || '[]') : freshRaw;
              sessionData._accumulatedMessages = null;
              sessionData.lastMessageCount = freshMessages.length;
              sessionData.lastObservedCount = freshMessages.length;
              sessionData.pendingLast = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
              sessionStore.updateSession(sid, { accumulated_messages: null });
              const chats = await require('./cursor-selectors').readCursorAgentList(sessionData.client.Runtime);
              this._sendToRelay(proto.chatList(sid, chats));
              this._sendHistorySnapshot(sid, freshMessages, 'cursor switch_chat');
              this._broadcastSessionSnapshot();
            } else if (agentT === 'codex') {
              sessionData._activeCodexChatId = chatId;
              const freshRaw = await selectors.readMessages(sessionData.client.Runtime, agentT, sid);
              const freshMessages = typeof freshRaw === 'string' ? JSON.parse(freshRaw || '[]') : freshRaw;
              const thinkingState = await selectors.detectThinking(sessionData.client.Runtime, agentT);
              const isWorking = thinkingState?.thinking === true;
              sessionData._accumulatedMessages = freshMessages.slice();
              sessionData.lastMessageCount = freshMessages.length;
              sessionData.lastObservedCount = freshMessages.length;
              sessionData.pendingLast = null;
              sessionData.resyncCandidateSig = null;
              sessionData.lastTranscriptSig = this._transcriptSignature(freshMessages);
              sessionData.waitingForAssistant = isWorking;
              sessionData.thinking = isWorking;
              const activity = isWorking
                ? { kind: 'generating', label: thinkingState.label || 'Generating', updated_at: new Date().toISOString() }
                : { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              sessionData.activity = activity;
              sessionStore.updateSession(sid, { accumulated_messages: freshMessages, activity });
              this._sendHistorySnapshot(sid, freshMessages, 'codex switch_chat');
              this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', activity));
              this._broadcastSessionSnapshot();
            }
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', {
              code: 'chat_not_found', message: result.detail || 'Chat not found',
            }));
          }
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_chat', 'failed', { code: 'cdp_error' }));
        });
    }

    // ── New chat (codex / codex-desktop) ─────────────────────────────────
    if (type === 'new_chat') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'cursor' && agentT !== 'continue' && agentT !== 'continue_yolo' && agentT !== 'antigravity_panel' && agentT !== 'antigravity-v2' && agentT !== 'claude-desktop' && agentT !== 'claude' && agentT !== 'claude_cli' && agentT !== 'codex_cli' && agentT !== 'cursor_cli') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
          code: 'not_supported', message: `new_chat not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      if (agentT === 'claude_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspacePath = sessionData.workspace_path || process.cwd();
        const workspaceName = sessionData.workspace_name || path.basename(workspacePath) || 'Claude CLI';
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath,
          workspaceName,
          title: 'New Claude CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: sessionData.model_id || 'default',
          permission_mode: sessionData.permission_mode || 'default',
          effort: sessionData.effort || 'medium',
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'background_ready',
          nativeCliWindowOpened: false,
        };
        const newSession = this._registerClaudeCliSession(summary, { sendInitialHistory: false });
        if (newSession) {
          try {
            const child = claudeCli.startNativeClaudeWindow({
              workspacePath,
              cliSessionId,
              resume: false,
              model: newSession.model_id,
              effort: newSession.effort,
              permissionMode: newSession.permission_mode,
              title: `${workspaceName} - Claude CLI`,
              launchMode: 'background',
            });
            const launchState = nativeLaunchState(child);
            if (launchState.windowOpened) newSession.nativeClaudeWindowChild = child;
            newSession.nativeCliStartedAt = summary.nativeCliStartedAt;
            newSession.nativeCliStatus = launchState.status;
            newSession.nativeCliWindowOpened = launchState.windowOpened;
            sessionStore.updateSession(newSession.session_id, {
              native_cli_started_at: newSession.nativeCliStartedAt,
              native_cli_status: newSession.nativeCliStatus,
              native_cli_window_opened: newSession.nativeCliWindowOpened,
            });
            this._sendHistorySnapshot(newSession.session_id, this._claudeCliPendingTranscriptMessages(newSession), 'claude cli background ready');
            this._log('info', `[ctrl] prepared background Claude CLI session for new_chat ${newSession.session_id} model=${newSession.model_id || 'default'}`);
          } catch (e) {
            this._log('warn', `[ctrl] new_chat native Claude CLI window failed for ${newSession.session_id}: ${e.message}`);
            newSession.nativeCliStatus = 'native_window_failed';
            sessionStore.updateSession(newSession.session_id, { native_cli_status: newSession.nativeCliStatus });
            this._sendHistorySnapshot(newSession.session_id, this._claudeCliPendingTranscriptMessages(newSession), 'claude cli native startup failed');
          }
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay(proto.agentControlResult(
          sid,
          requestId,
          'new_chat',
          newSession ? 'ok' : 'failed',
          newSession ? undefined : { code: 'create_failed', message: 'Could not create Claude CLI session' }
        ));
        return;
      }

      if (agentT === 'codex_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspacePath = sessionData.workspace_path || process.cwd();
        const workspaceName = sessionData.workspace_name || path.basename(workspacePath) || 'Codex CLI';
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath,
          workspaceName,
          title: 'New Codex CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: 'unknown',
          permission_mode: sessionData.permission_mode || 'workspace-write',
          effort: 'unknown',
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'background_ready',
          nativeCliWindowOpened: false,
        };
        const newSession = this._registerCodexCliSession(summary, { sendInitialHistory: false });
        if (newSession) {
          newSession.nextSendModelId = sessionData.nextSendModelId
            || (sessionData.observedModelId && sessionData.observedModelId !== 'unknown' ? sessionData.observedModelId : null);
          newSession.nextSendModelStatus = newSession.nextSendModelId ? 'pending' : 'unset';
          newSession.nextSendEffort = sessionData.nextSendEffortStatus === 'failed'
            ? null
            : (sessionData.nextSendEffort
              || (sessionData.observedEffort && sessionData.observedEffort !== 'unknown' ? sessionData.observedEffort : null));
          newSession.nextSendEffortStatus = newSession.nextSendEffort ? 'pending' : 'unset';
          sessionStore.updateSession(newSession.session_id, {
            codex_cli_next_model_id: newSession.nextSendModelId,
            codex_cli_next_model_status: newSession.nextSendModelStatus,
            codex_cli_next_effort: newSession.nextSendEffort,
            codex_cli_next_effort_status: newSession.nextSendEffortStatus,
          });
          this._publishCodexCliConfig(newSession.session_id, newSession);
          try {
            const child = codexCli.startNativeCodexWindow({
              workspacePath,
              cliSessionId,
              resume: false,
              model: newSession.nextSendModelId,
              effort: newSession.nextSendEffort,
              permissionMode: newSession.permission_mode,
              title: `${workspaceName} - Codex CLI`,
              elevated: false,
              launchMode: 'background',
            });
            const launchState = nativeLaunchState(child);
            newSession.nativeCliStartedAt = summary.nativeCliStartedAt;
            newSession.nativeCliStatus = launchState.status;
            newSession.nativeCliWindowOpened = launchState.windowOpened;
            sessionStore.updateSession(newSession.session_id, {
              native_cli_started_at: newSession.nativeCliStartedAt,
              native_cli_status: newSession.nativeCliStatus,
              native_cli_window_opened: newSession.nativeCliWindowOpened,
            });
            this._sendHistorySnapshot(newSession.session_id, this._codexCliPendingTranscriptMessages(newSession), 'codex cli background ready');
            this._log('info', `[ctrl] prepared background Codex CLI session for new_chat ${newSession.session_id} next_model=${newSession.nextSendModelId || 'unset'}`);
          } catch (e) {
            this._log('warn', `[ctrl] new_chat native Codex CLI window failed for ${newSession.session_id}: ${e.message}`);
            newSession.nativeCliStatus = 'native_window_failed';
            sessionStore.updateSession(newSession.session_id, { native_cli_status: newSession.nativeCliStatus });
            this._sendHistorySnapshot(newSession.session_id, this._codexCliPendingTranscriptMessages(newSession), 'codex cli native startup failed');
          }
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay(proto.agentControlResult(
          sid,
          requestId,
          'new_chat',
          newSession ? 'ok' : 'failed',
          newSession ? undefined : { code: 'create_failed', message: 'Could not create Codex CLI session' }
        ));
        return;
      }

      if (agentT === 'cursor_cli') {
        return (async () => {
          let cliSessionId = null;
          let chatCreated = false;
          try {
            cliSessionId = await cursorCli.createChatId();
            chatCreated = true;
          } catch (e) {
            this._log('warn', `[ctrl] cursor create-chat failed, falling back to local uuid: ${e.message}`);
            cliSessionId = crypto.randomUUID();
          }
          const workspacePath = sessionData.workspace_path || process.cwd();
          const workspaceName = sessionData.workspace_name || path.basename(workspacePath) || 'Cursor CLI';
          const modelId = sessionData.model_id || 'grok-4.5-fast-high';
          const permissionMode = sessionData.permission_mode || 'force';
          const filePath = cursorCli.ensureSessionFile(cliSessionId, {
            workspacePath,
            workspaceName,
            model_id: modelId,
            permission_mode: permissionMode,
            title: 'New Cursor CLI session',
          });
          const summary = {
            cliSessionId,
            filePath,
            workspacePath,
            workspaceName,
            title: 'New Cursor CLI session',
            messages: [],
            messageCount: 0,
            updatedAt: new Date().toISOString(),
            model_id: modelId,
            permission_mode: permissionMode,
            nativeCliStartedAt: new Date().toISOString(),
            nativeCliStatus: 'background_ready',
            nativeCliWindowOpened: false,
          };
          const newSession = this._registerCursorCliSession(summary, { sendInitialHistory: false });
          if (newSession) {
            newSession.cursorCliChatCreated = chatCreated;
            try {
              const child = cursorCli.startNativeCursorWindow({
                workspacePath,
                cliSessionId,
                resume: chatCreated,
                model: newSession.model_id,
                permissionMode: newSession.permission_mode,
                sandbox: newSession.sandbox,
                title: `${workspaceName} - Cursor CLI`,
                launchMode: 'background',
              });
              const launchState = nativeLaunchState(child);
              newSession.nativeCliStartedAt = summary.nativeCliStartedAt;
              newSession.nativeCliStatus = launchState.status;
              newSession.nativeCliWindowOpened = launchState.windowOpened;
              sessionStore.updateSession(newSession.session_id, {
                native_cli_started_at: newSession.nativeCliStartedAt,
                native_cli_status: newSession.nativeCliStatus,
                native_cli_window_opened: newSession.nativeCliWindowOpened,
                cursor_cli_file_path: filePath,
                cursor_cli_chat_created: chatCreated,
              });
              this._sendHistorySnapshot(newSession.session_id, this._cursorCliPendingTranscriptMessages(newSession), 'cursor cli background ready');
              this._log('info', `[ctrl] prepared background Cursor CLI session for new_chat ${newSession.session_id} model=${newSession.model_id || 'default'}`);
            } catch (e) {
              this._log('warn', `[ctrl] new_chat native Cursor CLI window failed for ${newSession.session_id}: ${e.message}`);
              newSession.nativeCliStatus = 'native_window_failed';
              sessionStore.updateSession(newSession.session_id, { native_cli_status: newSession.nativeCliStatus });
              this._sendHistorySnapshot(newSession.session_id, this._cursorCliPendingTranscriptMessages(newSession), 'cursor cli native startup failed');
            }
          }
          this._broadcastSessionSnapshot();
          this._sendToRelay(proto.agentControlResult(
            sid,
            requestId,
            'new_chat',
            newSession ? 'ok' : 'failed',
            newSession ? undefined : { code: 'create_failed', message: 'Could not create Cursor CLI session' }
          ));
        })().catch(err => {
          this._log('warn', `[ctrl] cursor_cli new_chat failed: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
            code: 'create_failed',
            message: err.message,
          }));
        });
      }

      // Claude Code extension: open its native New session surface.
      if (agentT === 'claude') {
        return selectors.newClaudeChat(sessionData.client.Runtime)
          .then(ok => {
            if (ok) {
              this._resetTranscriptState(sessionData, 'claude new chat');
              sessionData.waitingForAssistant = false;
              const idleActivity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              sessionData.activity = idleActivity;
              sessionStore.updateSession(sid, { accumulated_messages: null, activity: idleActivity });
              this._sendHistorySnapshot(sid, [], 'claude new chat');
              this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', idleActivity));
              this._broadcastSessionSnapshot();
              setTimeout(() => this._discoverTargets().catch(() => {}), 500);
            }
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', ok ? 'ok' : 'failed',
              ok ? undefined : { code: 'new_chat_failed', message: 'Claude Code New session did not settle' }));
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
          });
      }

      if (agentT === 'antigravity_panel') {
        // Suppress hasContent removal check while the panel resets
        sessionData._newChatPending = Date.now();
        // Clear accumulated message buffer so we start fresh
        sessionData._accumulatedMessages = null;
        sessionStore.updateSession(sid, { accumulated_messages: null });
        return selectors.newAntigravityPanelChat(sessionData.client.Runtime)
          .then(result => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', result.ok ? 'ok' : 'failed',
              result.ok ? undefined : { code: result.code || 'new_chat_failed', message: result.detail }));
          })
          .catch(() => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
          });
      }

      if (agentT === 'antigravity-v2') {
        sessionData._newChatPending = Date.now();
        sessionData._accumulatedMessages = null;
        sessionData._listView = true;
        sessionData.v2ConversationId = null;
        sessionData.chat_title = 'New Conversation';
        sessionData.windowTitle = 'New Conversation';
        sessionData.lastMessageCount = 0;
        sessionData.lastObservedCount = 0;
        sessionData.lastTranscriptSig = '';
        sessionData.pendingLast = null;
        sessionData.resyncCandidateSig = null;
        sessionData.waitingForAssistant = false;
        sessionStore.updateSession(sid, { accumulated_messages: null, chat_title: 'New Conversation', window_title: 'New Conversation' });
        return selectors.newAntigravityV2Conversation(sessionData.client.Runtime)
          .then(async result => {
            if (result.ok) {
              this._sendHistorySnapshot(sid, [], 'antigravity v2 new conversation');
              const chats = await selectors.readAntigravityV2ChatList(sessionData.client.Runtime).catch(() => []);
              if (Array.isArray(chats)) {
                sessionData._lastChatList = chats;
                this._sendToRelay(proto.chatList(sid, chats));
              }
              this._broadcastSessionSnapshot();
            }
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', result.ok ? 'ok' : 'failed',
              result.ok ? undefined : { code: result.code || 'new_chat_failed', message: result.detail || 'Could not start a new Antigravity v2 conversation' }));
          })
          .catch(err => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error', message: err.message }));
          });
      }

      if (agentT === 'continue') {
        return (async () => {
          const clicked = await this._withWorkbenchClient(
            sessionData,
            client => selectors.newContinueChatFromWorkbench(client.Runtime),
          );
          if (!clicked?.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
              code: clicked?.code || 'new_chat_failed',
              message: `Continue New Session matched ${clicked?.count ?? 0} controls`,
            }));
            return;
          }

          const deadline = Date.now() + 15000;
          let freshMessages = null;
          while (Date.now() <= deadline) {
            const raw = await this._withEphemeralIframeClient(
              sessionData,
              client => selectors.readMessages(client.Runtime, 'continue', sid),
              'new_chat',
            );
            freshMessages = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
            if (Array.isArray(freshMessages) && freshMessages.length === 0) break;
            await sleep(250);
          }
          if (!Array.isArray(freshMessages) || freshMessages.length !== 0) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
              code: 'new_chat_not_empty',
              message: `Continue New Session retained ${freshMessages?.length ?? 'unknown'} messages`,
            }));
            return;
          }

          this._resetTranscriptState(sessionData, 'continue new chat');
          sessionData.waitingForAssistant = false;
          const idleActivity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
          sessionData.activity = idleActivity;
          sessionStore.updateSession(sid, { accumulated_messages: null, activity: idleActivity });
          this._sendHistorySnapshot(sid, [], 'continue new chat');
          this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', idleActivity));
          this._broadcastSessionSnapshot();
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'ok'));
        })().catch(error => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
            code: 'cdp_error', message: error.message,
          }));
        });
      }

      if (agentT === 'continue_yolo') {
        launchers.launchSession({
          agentType: 'continue_yolo',
          port: this.CDP_PORTS[0],
          sessions: this.sessions,
          requestId,
          workspacePath: sessionData.workspace_path || undefined,
          onSuccess: async newTarget => {
            const launchedFilter = new Set([newTarget.id]);
            let newSession = null;
            for (let i = 0; i < 5 && !newSession; i++) {
              await this._discoverTargets(launchedFilter);
              newSession = Array.from(this.sessions.values()).find(s => s.targetId === newTarget.id);
              if (!newSession) await sleep(1000);
            }
            this._sendToRelay(proto.agentControlResult(
              sid,
              requestId,
              'new_chat',
              newSession ? 'ok' : 'failed',
              newSession ? undefined : { code: 'register_failed', message: 'Continue YOLO session opened but was not discovered' }
            ));
          },
          onFailure: (reason, errorCode) => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', {
              code: errorCode || 'new_chat_failed',
              message: reason || 'Could not open a new Continue YOLO session',
            }));
          },
        });
        return;
      }

      if (agentT === 'cursor') {
        return require('./cursor-selectors').newCursorAgent(sessionData.client.Runtime, sessionData.client.Input)
          .then(async r => {
            if (r.ok) {
              this._cacheCursorActiveTranscript(sessionData);
              this._resetTranscriptState(sessionData, 'cursor new agent');
              sessionData._newChatPending = Date.now();
              sessionStore.updateSession(sid, {
                accumulated_messages: null,
                cursor_agent_histories: sessionData._cursorAgentHistories || {},
                cursor_new_chat_pending: true,
              });
              this._sendHistorySnapshot(sid, [], 'cursor new agent');
              const threads = await require('./cursor-selectors').readCursorAgentList(sessionData.client.Runtime).catch(() => []);
              if (Array.isArray(threads)) this._sendToRelay(proto.threadList(sid, threads));
              this._broadcastSessionSnapshot();
            }
            this._sendToRelay(proto.agentControlResult(
              sid,
              requestId,
              'new_chat',
              r.ok ? 'ok' : 'failed',
              r.ok ? undefined : { code: 'new_chat_failed', message: r.detail || 'Cursor New Agent did not settle' }
            ));
          })
          .catch(err => {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error', message: err.message }));
          });
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop';
      return selectors.newCodexChat(sessionData.client.Runtime, usePageEval)
        .then(ok => {
          if (ok) {
            if (agentT === 'codex') sessionData._activeCodexChatId = null;
            this._resetTranscriptState(sessionData, `${agentT} new chat`);
            sessionData.waitingForAssistant = false;
            sessionData.messageQueue = [];
            const idleActivity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
            sessionData.activity = idleActivity;
            sessionStore.updateSession(sid, { accumulated_messages: null, activity: idleActivity });
            this._sendHistorySnapshot(sid, [], `${agentT} new chat`);
            this._sendToRelay(proto.proxyStatus(sid, sessionData.status || 'healthy', idleActivity));
            this._broadcastSessionSnapshot();
          }
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', ok ? 'ok' : 'failed'));
        })
        .catch(() => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'new_chat', 'failed', { code: 'cdp_error' }));
        });
    }

    // ── Terminal output (codex / codex-desktop) ────────────────────────
    if (type === 'terminal_output') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'claude-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'failed', {
          code: 'not_supported', message: `terminal_output not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop' || agentT === 'cursor';
      const readFn = agentT === 'cursor'
        ? require('./cursor-selectors').readCursorTerminalOutput
        : (agentT === 'claude-desktop'
          ? selectors.readClaudeDesktopTerminalOutput || selectors.readCodexTerminalOutput
          : selectors.readCodexTerminalOutput);
      const readArgs = agentT === 'cursor'
        ? [sessionData.client.Runtime]
        : [sessionData.client.Runtime, usePageEval];
      const accumulatedEntries = agentT === 'codex-desktop'
        ? this._codexDesktopTerminalEntries(sessionData)
        : null;
      const readPromise = (async () => {
        if (sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) throw new Error(activated.detail || 'Cursor agent could not be activated');
        }
        return accumulatedEntries !== null ? accumulatedEntries : readFn(...readArgs);
      })();
      readPromise
        .then(entries => {
          this._sendToRelay(proto.terminalOutput(sid, entries));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] terminal_output failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_output', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Terminal input (codex-desktop) ─────────────────────────────────
    if (type === 'terminal_input') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const text = msg.text || '';

      if (agentT !== 'codex-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'failed', {
          code: 'not_supported', message: `terminal_input not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const writeFn = agentT === 'cursor'
        ? (rt, client, t) => require('./cursor-selectors').writeCursorTerminalInput(rt, client, t)
        : (rt, _pe, t) => selectors.writeCodexTerminalInput(rt, true, t);
      const writeArgs = agentT === 'cursor'
        ? [sessionData.client.Runtime, sessionData.client, text]
        : [sessionData.client.Runtime, true, text];
      (async () => {
        if (sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) return { ok: false, detail: activated.detail };
        }
        return writeFn(...writeArgs);
      })()
        .then((result) => {
          if (!result?.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'failed', {
              code: 'input_failed', message: result?.detail || 'Could not write to the Cursor terminal',
            }));
            return;
          }
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'ok'));
          // Auto-refresh terminal output after a short delay so the user sees the result
          setTimeout(() => {
            const readTerm = agentT === 'cursor'
              ? require('./cursor-selectors').readCursorTerminalOutput
              : selectors.readCodexTerminalOutput;
            const readTermArgs = agentT === 'cursor'
              ? [sessionData.client.Runtime]
              : [sessionData.client.Runtime, true];
            readTerm(...readTermArgs)
              .then(entries => this._sendToRelay(proto.terminalOutput(sid, entries)))
              .catch(() => {});
          }, 500);
        })
        .catch(err => {
          this._log('warn', `[ctrl] terminal_input failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'terminal_input', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── File change accept/reject (cursor) ─────────────────────────────
    if (type === 'file_change_response') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;
      const changeId = msg.change_id;
      const action = msg.action;

      if (agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_change_response', 'failed', {
          code: 'not_supported', message: `file_change_response not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }
      if (!changeId || (action !== 'accept' && action !== 'reject')) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_change_response', 'failed', {
          code: 'invalid_request', message: 'change_id and action (accept|reject) required',
        }));
        return;
      }
      const cursorSel = require('./cursor-selectors');
      const fn = action === 'accept' ? cursorSel.acceptCursorFileChange : cursorSel.rejectCursorFileChange;
      (async () => {
        if (sessionData._cursorVirtual) {
          const activated = await this._ensureCursorVirtualSessionActive(sessionData);
          if (!activated.ok) return { ok: false, detail: activated.detail };
        }
        return fn(sessionData.client.Runtime, changeId, sessionData.client.Input);
      })()
        .then((result) => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_change_response', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_change_response', 'failed', {
              code: 'click_failed', message: result.detail || 'Could not click file change button',
            }));
          }
        })
        .catch((err) => {
          this._log('warn', `[ctrl] file_change_response failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_change_response', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── File changes / diff (codex / codex-desktop) ────────────────────
    if (type === 'file_changes') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop' && agentT !== 'claude-desktop' && agentT !== 'cursor') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'failed', {
          code: 'not_supported', message: `file_changes not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop' || agentT === 'claude-desktop' || agentT === 'cursor';
      const readFn = agentT === 'cursor'
        ? require('./cursor-selectors').readCursorFileChanges
        : (agentT === 'claude-desktop'
          ? selectors.readClaudeDesktopFileChanges || selectors.readCodexFileChanges
          : selectors.readCodexFileChanges);
      const accumulatedEntries = agentT === 'codex-desktop'
        ? this._codexDesktopFileChangeEntries(sessionData)
        : null;
      const readPromise = accumulatedEntries !== null
        ? Promise.resolve(accumulatedEntries)
        : readFn(sessionData.client.Runtime, usePageEval);
      readPromise
        .then(entries => {
          this._sendToRelay(proto.fileChanges(sid, entries));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] file_changes failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'file_changes', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── File browser: list directory ──────────────────────────────────────
    if (type === 'list_directory') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const workspacePath = sessionData?.workspace_path;

      if (!workspacePath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
          code: 'no_workspace', message: 'Session has no workspace path',
        }));
        return;
      }

      const requestPath = msg.path || '.';
      const resolved = resolveWorkspaceRequestPath(workspacePath, requestPath);
      if (!resolved.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
          code: resolved.code, message: resolved.message,
        }));
        return;
      }
      const absPath = resolved.path;

      fs.readdir(absPath, { withFileTypes: true }, (err, dirents) => {
        if (err) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'failed', {
            code: 'fs_error', message: err.message,
          }));
          return;
        }

        const entries = [];
        let pending = dirents.length;
        if (pending === 0) {
          this._sendToRelay(proto.directoryListing(sid, requestPath, [], requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
          return;
        }

        for (const d of dirents) {
          // Skip hidden files/dirs (starting with .) and node_modules
          if (d.name.startsWith('.') || d.name === 'node_modules') {
            if (--pending === 0) {
              entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              this._sendToRelay(proto.directoryListing(sid, requestPath, entries, requestId));
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
            }
            continue;
          }
          const fullPath = path.join(absPath, d.name);
          fs.stat(fullPath, (statErr, stats) => {
            if (!statErr) {
              entries.push({
                name: d.name,
                type: d.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime.toISOString(),
              });
            }
            if (--pending === 0) {
              entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              this._sendToRelay(proto.directoryListing(sid, requestPath, entries, requestId));
              this._sendToRelay(proto.agentControlResult(sid, requestId, 'list_directory', 'ok'));
            }
          });
        }
      });
      return;
    }

    // ── File browser: read file ─────────────────────────────────────────
    if (type === 'read_file') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const workspacePath = sessionData?.workspace_path;
      const requestedMaxSize = Number(msg.max_size);
      const MAX_FILE_SIZE = Number.isFinite(requestedMaxSize) && requestedMaxSize > 0
        ? Math.min(Math.floor(requestedMaxSize), 4 * 1024 * 1024)
        : 512 * 1024;

      if (!workspacePath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: 'no_workspace', message: 'Session has no workspace path',
        }));
        return;
      }

      const requestPath = msg.path;
      if (!requestPath) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: 'invalid_message', message: 'read_file requires path',
        }));
        return;
      }

      const resolved = resolveWorkspaceRequestPath(workspacePath, requestPath);
      if (!resolved.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
          code: resolved.code, message: resolved.message,
        }));
        return;
      }
      const absPath = resolved.path;

      fs.stat(absPath, (statErr, stats) => {
        if (statErr) {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
            code: 'fs_error', message: statErr.message,
          }));
          return;
        }

        const truncated = stats.size > MAX_FILE_SIZE;
        const readSize = truncated ? MAX_FILE_SIZE : stats.size;

        if (readSize === 0) {
          this._sendToRelay(proto.fileContent(sid, requestPath, '', false, requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'ok'));
          return;
        }

        // Read up to MAX_FILE_SIZE bytes
        const stream = fs.createReadStream(absPath, { start: 0, end: readSize - 1, encoding: 'utf8' });
        let content = '';
        stream.on('data', chunk => { content += chunk; });
        stream.on('end', () => {
          this._sendToRelay(proto.fileContent(sid, requestPath, content, truncated, requestId));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'ok'));
        });
        stream.on('error', readErr => {
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'read_file', 'failed', {
            code: 'fs_error', message: readErr.message,
          }));
        });
      });
      return;
    }

    // ── Send attachment / image (codex / codex-desktop) ──────────────────
    if (type === 'send_attachment') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex' && agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', {
          code: 'not_supported', message: `send_attachment not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      const usePageEval = agentT === 'codex-desktop';
      const payload = validateAttachmentPayload(msg.data, msg.mime_type, msg.filename);
      if (!payload.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', {
          code: payload.code, message: payload.message,
        }));
        return;
      }
      selectors.injectCodexImage(
        sessionData.client.Runtime,
        payload.data,
        payload.mime_type,
        payload.filename,
        usePageEval,
      )
        .then(result => {
          if (result.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', {
              code: result?.detail || 'inject_failed',
            }));
          }
        })
        .catch(err => {
          this._log('warn', `[ctrl] send_attachment failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'send_attachment', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Branch list ──────────────────────────────────────────────────────
    if (type === 'branch_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch listing',
        }));
        return;
      }

      const result = this._listGitBranches(wp);
      if (!result) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'failed', {
          code: 'git_error', message: 'Failed to list branches',
        }));
        return;
      }

      this._sendToRelay(proto.branchList(sid, result.branches, result.current));
      this._sendToRelay(proto.agentControlResult(sid, requestId, 'branch_list', 'ok'));
      return;
    }

    // ── Switch branch ────────────────────────────────────────────────────
    if (type === 'switch_branch') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const branchName = msg.branch_name;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch switch',
        }));
        return;
      }

      if (!branchName) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'invalid_message', message: 'switch_branch requires branch_name',
        }));
        return;
      }

      this._log('info', `[ctrl] switch_branch for ${sid}: ${branchName}`);
      const result = this._switchGitBranch(wp, branchName);
      if (result.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'ok'));
        // Refresh config to update branch display
        const agentT = sessionData?.agentType;
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, wp));
        merged.capabilities = this._buildCapabilities(agentT, wp);
        this._sendToRelay(proto.agentConfig(sid, merged));
      } else {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'switch_branch', 'failed', {
          code: 'git_error', message: result.error,
        }));
      }
      return;
    }

    // ── Create branch ────────────────────────────────────────────────────
    if (type === 'create_branch') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;
      const branchName = msg.branch_name;
      const wp = sessionData?.workspace_path;

      if (!wp) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'no_workspace', message: 'No workspace path for branch creation',
        }));
        return;
      }

      if (!branchName) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'invalid_message', message: 'create_branch requires branch_name',
        }));
        return;
      }

      this._log('info', `[ctrl] create_branch for ${sid}: ${branchName}`);
      const result = this._createGitBranch(wp, branchName);
      if (result.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'ok'));
        // Refresh config to update branch display
        const agentT = sessionData?.agentType;
        const merged = this._decorateAgentConfig(sessionData, this._mergeAgentConfig(agentT, null, wp));
        merged.capabilities = this._buildCapabilities(agentT, wp);
        this._sendToRelay(proto.agentConfig(sid, merged));
      } else {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'create_branch', 'failed', {
          code: 'git_error', message: result.error,
        }));
      }
      return;
    }

    // ── Skills list (codex-desktop) ────────────────────────────────────
    if (type === 'skill_list') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'failed', {
          code: 'not_supported', message: `skill_list not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.readCodexSkillsList(sessionData.client.Runtime, true)
        .then(skills => {
          this._sendToRelay(proto.skillsList(sid, skills));
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'ok'));
        })
        .catch(err => {
          this._log('warn', `[ctrl] skill_list failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'skill_list', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    // ── Launch / close ──────────────────────────────────────────────────
    if (type === 'automation_view_action') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const agentT = sessionData?.agentType;
      const requestId = msg.request_id;

      if (agentT !== 'codex-desktop') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', {
          code: 'not_supported', message: `automation_view_action not supported for ${agentT || 'unknown'}`,
        }));
        return;
      }

      selectors.clickCodexAutomationAction(sessionData.client.Runtime, true)
        .then(result => {
          if (result?.ok) {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'ok'));
          } else {
            this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', {
              code: 'action_not_found', message: result?.detail || 'Show Automation action not found',
            }));
          }
        })
        .catch(err => {
          this._log('warn', `[ctrl] automation_view_action failed for ${sid}: ${err.message}`);
          this._sendToRelay(proto.agentControlResult(sid, requestId, 'automation_view_action', 'failed', { code: 'cdp_error' }));
        });
      return;
    }

    if (type === 'open_native_window') {
      const sid = msg.session_id || msg.session;
      const sessionData = this.sessions.get(sid);
      const requestId = msg.request_id;

      if (sessionData?.agentType !== 'claude_cli' && sessionData?.agentType !== 'codex_cli' && sessionData?.agentType !== 'cursor_cli') {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'failed', {
          code: 'not_supported', message: `native window not supported for ${sessionData?.agentType || 'unknown'}`,
        }));
        return;
      }

      const operatorProof = validateOperatorActionProof(msg.operator_action_proof, {
        action: 'open_native_window',
        requestId,
        consume: false,
      });
      if (!operatorProof.ok) {
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'failed', {
          code: 'operator_action_only',
          message: `Visible native windows are operator-action-only (${operatorProof.reason})`,
        }));
        return;
      }

      try {
        const cliSessionId = sessionData.cliSessionId || crypto.randomUUID();
        sessionData.cliSessionId = cliSessionId;
        sessionData.nativeCliStartedAt = new Date().toISOString();
        sessionData.nativeCliStatus = 'native_window_opened';
        sessionData.nativeCliWindowOpened = true;
        const isCodexCli = sessionData.agentType === 'codex_cli';
        const isCursorCli = sessionData.agentType === 'cursor_cli';
        sessionStore.updateSession(sid, {
          cli_session_id: cliSessionId,
          ...(isCodexCli ? { codex_cli_archive_discovered: false }
            : isCursorCli ? { cursor_cli_archive_discovered: false }
            : { claude_cli_archive_discovered: false }),
          native_cli_started_at: sessionData.nativeCliStartedAt,
          native_cli_status: sessionData.nativeCliStatus,
          native_cli_window_opened: true,
        });
        let child;
        if (isCodexCli) {
          child = codexCli.startNativeCodexWindow({
            workspacePath: sessionData.workspace_path || process.cwd(),
            cliSessionId,
            resume: !!sessionData.codexCliFilePath,
            model: sessionData.model_id,
            effort: sessionData.effort,
            permissionMode: sessionData.permission_mode,
            title: `${sessionData.workspace_name || 'Codex'} - Codex CLI`,
            elevated: false,
            launchMode: 'foreground',
            operatorActionProof: msg.operator_action_proof,
            requestId,
          });
        } else if (isCursorCli) {
          const existingSummary = sessionData.cursorCliFilePath
            ? cursorCli.readSessionSummary(sessionData.cursorCliFilePath, this._cursorCliActiveSummaryOptions())
            : null;
          const shouldResumeNative = sessionData.cursorCliChatCreated === true
            || sessionData.cursor_cli_chat_created === true
            || !!(existingSummary && existingSummary.messageCount > 0)
            || sessionData.cursorCliArchiveDiscovered === true;
          child = cursorCli.startNativeCursorWindow({
            workspacePath: sessionData.workspace_path || process.cwd(),
            cliSessionId,
            resume: shouldResumeNative,
            model: sessionData.model_id,
            permissionMode: sessionData.permission_mode,
            sandbox: sessionData.sandbox,
            title: `${sessionData.workspace_name || 'Cursor'} - Cursor CLI`,
            launchMode: 'foreground',
            operatorActionProof: msg.operator_action_proof,
            requestId,
          });
        } else {
          child = claudeCli.startNativeClaudeWindow({
            workspacePath: sessionData.workspace_path || process.cwd(),
            cliSessionId,
            resume: !!sessionData.claudeCliFilePath,
            model: sessionData.model_id,
            effort: sessionData.effort,
            permissionMode: sessionData.permission_mode,
            title: `${sessionData.workspace_name || 'Claude Code'} - Claude CLI`,
            launchMode: 'foreground',
            operatorActionProof: msg.operator_action_proof,
            requestId,
          });
          sessionData.nativeClaudeWindowChild = child;
        }
        const pendingMsgs = isCodexCli ? this._codexCliPendingTranscriptMessages(sessionData)
          : isCursorCli ? this._cursorCliPendingTranscriptMessages(sessionData)
          : this._claudeCliPendingTranscriptMessages(sessionData);
        const label = isCodexCli ? 'codex' : isCursorCli ? 'cursor' : 'claude';
        const hasTranscript = isCodexCli ? !!sessionData.codexCliFilePath
          : isCursorCli ? !!sessionData.cursorCliFilePath
          : !!sessionData.claudeCliFilePath;
        if (!hasTranscript) this._sendHistorySnapshot(sid, pendingMsgs, `${label} cli native startup`);
        this._log('info', `[ctrl] opened native ${isCodexCli ? 'Codex' : isCursorCli ? 'Cursor' : 'Claude'} CLI window for ${sid} pid=${child?.pid || 'unknown'} model=${sessionData.model_id || 'default'}`);
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'ok'));
      } catch (e) {
        this._log('warn', `[ctrl] open_native_window failed for ${sid}: ${e.message}`);
        sessionData.nativeCliStatus = 'native_window_failed';
        sessionStore.updateSession(sid, { native_cli_status: sessionData.nativeCliStatus });
        const isCursorCli = sessionData.agentType === 'cursor_cli';
        const isCodexCli = sessionData.agentType === 'codex_cli';
        const pendingMsgs = isCodexCli ? this._codexCliPendingTranscriptMessages(sessionData)
          : isCursorCli ? this._cursorCliPendingTranscriptMessages(sessionData)
          : this._claudeCliPendingTranscriptMessages(sessionData);
        const label = isCodexCli ? 'codex' : isCursorCli ? 'cursor' : 'claude';
        const hasTranscript = isCodexCli ? !!sessionData.codexCliFilePath
          : isCursorCli ? !!sessionData.cursorCliFilePath
          : !!sessionData.claudeCliFilePath;
        if (!hasTranscript) this._sendHistorySnapshot(sid, pendingMsgs, `${label} cli native startup failed`);
        this._sendToRelay(proto.agentControlResult(sid, requestId, 'open_native_window', 'failed', {
          code: e.code || 'spawn_failed', message: e.message,
        }));
      }
      return;
    }

    if (type === 'launch_session') {
      const agentType    = msg.agent_type;
      const requestId    = msg.request_id;
      const workspacePath = msg.workspace_path || null;
      this._log('info', `[ctrl] launch_session agent=${agentType} request=${requestId}`);

      if (agentType === 'claude_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspace = workspacePath || process.cwd();
        const workspaceName = path.basename(workspace) || 'Claude CLI';
        const modelId = msg.model_id || 'default';
        const permissionMode = msg.permission_mode || 'default';
        const effort = msg.effort || 'medium';
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath: workspace,
          workspaceName,
          title: 'New Claude CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: modelId,
          permission_mode: permissionMode,
          effort,
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'background_ready',
          nativeCliWindowOpened: false,
        };
        const session = this._registerClaudeCliSession(summary, { sendInitialHistory: false });
        if (!session) {
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            agent_type: agentType,
            reason: 'Could not create Claude CLI session',
            error_code: 'create_failed',
          });
          return;
        }
        try {
          const child = claudeCli.startNativeClaudeWindow({
            workspacePath: workspace,
            cliSessionId,
            resume: false,
            model: modelId,
            effort,
            permissionMode,
            title: `${workspaceName} - Claude CLI`,
            launchMode: 'background',
          });
          const launchState = nativeLaunchState(child);
          if (launchState.windowOpened) session.nativeClaudeWindowChild = child;
          session.nativeCliStartedAt = summary.nativeCliStartedAt;
          session.nativeCliStatus = launchState.status;
          session.nativeCliWindowOpened = launchState.windowOpened;
          sessionStore.updateSession(session.session_id, {
            native_cli_started_at: session.nativeCliStartedAt,
            native_cli_status: session.nativeCliStatus,
            native_cli_window_opened: session.nativeCliWindowOpened,
          });
          this._sendHistorySnapshot(session.session_id, this._claudeCliPendingTranscriptMessages(session), 'claude cli background ready');
          this._log('info', `[ctrl] prepared background Claude CLI session for launch_session ${session.session_id} model=${modelId || 'default'}`);
        } catch (e) {
          this._log('warn', `[ctrl] launch_session native Claude CLI window failed for ${session.session_id}: ${e.message}`);
          session.nativeCliStatus = 'native_window_failed';
          sessionStore.updateSession(session.session_id, { native_cli_status: session.nativeCliStatus });
          this._sendHistorySnapshot(session.session_id, this._claudeCliPendingTranscriptMessages(session), 'claude cli native startup failed');
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay({
          type: 'session_launch_ack',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          session_id: session.session_id,
          agent_type: agentType,
        });
        return;
      }

      if (agentType === 'codex_cli') {
        const cliSessionId = crypto.randomUUID();
        const workspace = workspacePath || process.cwd();
        const workspaceName = path.basename(workspace) || 'Codex CLI';
        const collaborationMode = msg.collaboration_mode == null
          ? null
          : String(msg.collaboration_mode).trim().toLowerCase();
        if (collaborationMode && collaborationMode !== 'plan') {
          this._sendToRelay({
            type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId, agent_type: agentType,
            reason: `Codex CLI collaboration mode ${msg.collaboration_mode} is not supported`,
            error_code: 'invalid_collaboration_mode',
          });
          return;
        }
        const modelId = msg.model_id
          ? codexCli.normalizeCodexModelAlias(msg.model_id, codexCli.CODEX_CLI_MODELS)
          : null;
        const permissionMode = msg.permission_mode || 'workspace-write';
        const effort = msg.effort || null;
        if (modelId && !codexCli.CODEX_CLI_MODELS.some(item => item.id === modelId)) {
          this._sendToRelay({
            type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId, agent_type: agentType,
            reason: `Codex CLI does not currently advertise model ${msg.model_id}`,
            error_code: 'unsupported_model_alias',
          });
          return;
        }
        if (effort && !codexCli.CODEX_CLI_EFFORTS.some(item => item.id === effort)) {
          this._sendToRelay({
            type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId, agent_type: agentType,
            reason: `Codex CLI does not currently advertise effort ${effort}`,
            error_code: 'invalid_effort',
          });
          return;
        }
        const advertisedModel = modelId
          ? codexCli.CODEX_CLI_MODELS.find(item => item.id === modelId)
          : null;
        if (effort && advertisedModel?.supported_efforts?.length
            && !advertisedModel.supported_efforts.includes(effort)) {
          this._sendToRelay({
            type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId, agent_type: agentType,
            reason: `${modelId} does not advertise reasoning effort ${effort}`,
            error_code: 'effort_not_advertised_for_model',
          });
          return;
        }
        const summary = {
          cliSessionId,
          filePath: null,
          workspacePath: workspace,
          workspaceName,
          title: 'New Codex CLI session',
          messages: [],
          messageCount: 0,
          updatedAt: new Date().toISOString(),
          model_id: 'unknown',
          permission_mode: permissionMode,
          effort: 'unknown',
          nativeCliStartedAt: new Date().toISOString(),
          nativeCliStatus: 'background_ready',
          nativeCliWindowOpened: false,
          codexCliCollaborationMode: collaborationMode,
        };
        const session = this._registerCodexCliSession(summary, { sendInitialHistory: false });
        if (!session) {
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            agent_type: agentType,
            reason: 'Could not create Codex CLI session',
            error_code: 'create_failed',
          });
          return;
        }
        session.nextSendModelId = modelId;
        session.nextSendModelStatus = modelId ? 'pending' : 'unset';
        session.nextSendEffort = effort;
        session.nextSendEffortStatus = effort ? 'pending' : 'unset';
        session.codexCliCollaborationMode = collaborationMode;
        sessionStore.updateSession(session.session_id, {
          codex_cli_next_model_id: modelId,
          codex_cli_next_model_status: session.nextSendModelStatus,
          codex_cli_next_effort: effort,
          codex_cli_next_effort_status: session.nextSendEffortStatus,
          codex_cli_collaboration_mode: collaborationMode,
        });
        this._publishCodexCliConfig(session.session_id, session);
        try {
          const child = codexCli.startNativeCodexWindow({
            workspacePath: workspace,
            cliSessionId,
            resume: false,
            model: modelId,
            effort,
            permissionMode,
            title: `${workspaceName} - Codex CLI`,
            elevated: false,
            launchMode: 'background',
          });
          const launchState = nativeLaunchState(child);
          session.nativeCliStartedAt = summary.nativeCliStartedAt;
          session.nativeCliStatus = launchState.status;
          session.nativeCliWindowOpened = launchState.windowOpened;
          sessionStore.updateSession(session.session_id, {
            native_cli_started_at: session.nativeCliStartedAt,
            native_cli_status: session.nativeCliStatus,
            native_cli_window_opened: session.nativeCliWindowOpened,
          });
          this._sendHistorySnapshot(session.session_id, this._codexCliPendingTranscriptMessages(session), 'codex cli background ready');
          this._log('info', `[ctrl] prepared background Codex CLI session for launch_session ${session.session_id} model=${modelId || 'default'}`);
        } catch (e) {
          this._log('warn', `[ctrl] launch_session native Codex CLI window failed for ${session.session_id}: ${e.message}`);
          session.nativeCliStatus = 'native_window_failed';
          sessionStore.updateSession(session.session_id, { native_cli_status: session.nativeCliStatus });
          this._sendHistorySnapshot(session.session_id, this._codexCliPendingTranscriptMessages(session), 'codex cli native startup failed');
        }
        this._broadcastSessionSnapshot();
        this._sendToRelay({
          type: 'session_launch_ack',
          protocol_version: proto.PROTOCOL_VERSION,
          request_id: requestId,
          session_id: session.session_id,
          agent_type: agentType,
        });
        return;
      }

      if (agentType === 'cursor_cli') {
        (async () => {
          const resumeCliId = msg.cli_session_id
            || (msg.resume_source_session ? sessionStore.getSession(msg.resume_source_session)?.cli_session_id : null)
            || null;
          let cliSessionId = resumeCliId || null;
          let chatCreated = false;
          let isResume = !!resumeCliId;
          if (!cliSessionId) {
            try {
              cliSessionId = await cursorCli.createChatId();
              chatCreated = true;
            } catch (e) {
              this._log('warn', `[ctrl] cursor create-chat failed, falling back to local uuid: ${e.message}`);
              cliSessionId = crypto.randomUUID();
            }
          } else {
            chatCreated = true; // known Cursor chat id — always --resume
          }
          const workspace = workspacePath
            || (msg.resume_source_session ? sessionStore.getSession(msg.resume_source_session)?.workspace_path : null)
            || process.cwd();
          const workspaceName = path.basename(workspace) || 'Cursor CLI';
          const prior = resumeCliId ? cursorCli.findSessionByCliId(resumeCliId) : null;
          const modelId = msg.model_id
            || prior?.model_id
            || (msg.resume_source_session ? sessionStore.getSession(msg.resume_source_session)?.model_id : null)
            || 'grok-4.5-fast-high';
          const permissionMode = msg.permission_mode
            || prior?.permission_mode
            || (msg.resume_source_session ? sessionStore.getSession(msg.resume_source_session)?.permission_mode : null)
            || 'force';
          const existingSummary = prior
            || (resumeCliId ? cursorCli.findSessionByCliId(resumeCliId) : null);
          const filePath = existingSummary?.filePath || cursorCli.ensureSessionFile(cliSessionId, {
            workspacePath: workspace,
            workspaceName,
            model_id: modelId,
            permission_mode: permissionMode,
            title: isResume ? (existingSummary?.title || 'Resumed Cursor CLI session') : 'New Cursor CLI session',
          });
          const hydrated = existingSummary?.messages?.length
            ? existingSummary
            : (filePath ? cursorCli.readSessionSummary(filePath, this._cursorCliActiveSummaryOptions()) : null);
          const summary = {
            cliSessionId,
            filePath,
            workspacePath: hydrated?.workspacePath || workspace,
            workspaceName: hydrated?.workspaceName || workspaceName,
            title: hydrated?.title || (isResume ? 'Resumed Cursor CLI session' : 'New Cursor CLI session'),
            messages: hydrated?.messages || [],
            messageCount: hydrated?.messageCount || (hydrated?.messages || []).length || 0,
            updatedAt: hydrated?.updatedAt || new Date().toISOString(),
            model_id: modelId,
            permission_mode: permissionMode,
            nativeCliStartedAt: new Date().toISOString(),
            nativeCliStatus: 'background_ready',
            nativeCliWindowOpened: false,
            cursorCliChatCreated: chatCreated || isResume,
          };
          const session = this._registerCursorCliSession(summary, { sendInitialHistory: true });
          if (!session) {
            this._sendToRelay({
              type: 'session_launch_failed',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId,
              agent_type: agentType,
              reason: 'Could not create Cursor CLI session',
              error_code: 'create_failed',
            });
            return;
          }
          session.cursorCliChatCreated = chatCreated || isResume;
          try {
            const child = cursorCli.startNativeCursorWindow({
              workspacePath: session.workspace_path || workspace,
              cliSessionId,
              resume: chatCreated || isResume,
              model: modelId,
              permissionMode,
              sandbox: session.sandbox,
              title: `${session.workspace_name || workspaceName} - Cursor CLI`,
              launchMode: 'background',
            });
            const launchState = nativeLaunchState(child);
            session.nativeCliStartedAt = summary.nativeCliStartedAt;
            session.nativeCliStatus = launchState.status;
            session.nativeCliWindowOpened = launchState.windowOpened;
            sessionStore.updateSession(session.session_id, {
              native_cli_started_at: session.nativeCliStartedAt,
              native_cli_status: session.nativeCliStatus,
              native_cli_window_opened: session.nativeCliWindowOpened,
              cursor_cli_file_path: filePath,
              cursor_cli_chat_created: session.cursorCliChatCreated === true,
              cli_session_id: cliSessionId,
              model_id: modelId,
              permission_mode: permissionMode,
            });
            this._sendHistorySnapshot(session.session_id, this._cursorCliPendingTranscriptMessages(session), 'cursor cli background ready');
            this._log('info', `[ctrl] prepared background Cursor CLI session for launch_session ${session.session_id} model=${modelId || 'default'} resume=${chatCreated || isResume} cli=${cliSessionId}`);
          } catch (e) {
            this._log('warn', `[ctrl] launch_session native Cursor CLI window failed for ${session.session_id}: ${e.message}`);
            session.nativeCliStatus = 'native_window_failed';
            sessionStore.updateSession(session.session_id, { native_cli_status: session.nativeCliStatus });
            this._sendHistorySnapshot(session.session_id, this._cursorCliPendingTranscriptMessages(session), 'cursor cli native startup failed');
          }
          this._broadcastSessionSnapshot();
          this._sendToRelay({
            type: 'session_launch_ack',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            session_id: session.session_id,
            agent_type: agentType,
          });
        })().catch(err => {
          this._log('warn', `[ctrl] cursor_cli launch_session failed: ${err.message}`);
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: requestId,
            agent_type: agentType,
            reason: err.message || 'Could not create Cursor CLI session',
            error_code: 'create_failed',
          });
        });
        return;
      }

      // Antigravity window: File > New Window via DOM menu on existing workbench
      if (agentType === 'antigravity') {
        (async () => {
          try {
            const targets = await CDP.List({ port: this.CDP_PORTS[0] });
            const workbenchPages = targets.filter(t =>
              t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
            );
            if (workbenchPages.length === 0) {
              launchers.spawnAntigravity(this.CDP_PORTS[0]);
              this._log('info', `[launch] No Antigravity workbench — spawned fresh`);
            } else {
              const page = workbenchPages[0];
              let pageClient;
              try {
                pageClient = await CDP({ port: this.CDP_PORTS[0], target: page.id });
                await pageClient.Runtime.enable();
                await pageClient.Runtime.evaluate({ expression: 'window.focus()' });
                await sleep(200);
                // Alt+F to open File menu (DOM-based in Antigravity)
                await pageClient.Input.dispatchKeyEvent({ type: 'rawKeyDown', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 1 });
                await pageClient.Input.dispatchKeyEvent({ type: 'keyUp', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 });
                await sleep(600);
                // Click "New Window" by aria-label
                const result = await pageClient.Runtime.evaluate({
                  expression: `(function() {
                    var item = document.querySelector('[aria-label="New Window"]');
                    if (item) { item.click(); return 'ok'; }
                    return 'not-found';
                  })()`,
                  returnByValue: true,
                });
                await pageClient.close();
                const val = result.result?.value;
                if (val === 'ok') {
                  this._log('info', `[launch] Clicked File > New Window on "${page.title}"`);
                } else {
                  this._log('warn', `[launch] New Window menu item not found`);
                  launchers.spawnAntigravity(this.CDP_PORTS[0]);
                }
              } catch (e) {
                if (pageClient) try { await pageClient.close(); } catch {}
                this._log('warn', `[launch] File > New Window failed: ${e.message}`);
                launchers.spawnAntigravity(this.CDP_PORTS[0]);
              }
            }
            this._sendToRelay({
              type: 'session_launch_ack',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId,
              session_id: null,
              fire_and_forget: true,
              message: 'Antigravity window opened — select a workspace to start chatting',
            });
          } catch (e) {
            this._log('error', `[launch] Antigravity launch error: ${e.message}`);
            this._sendToRelay({
              type: 'session_launch_failed',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId,
              agent_type: agentType,
              reason: e.message,
              error_code: 'spawn_failed',
            });
          }
        })();
        return;
      }

      // Antigravity Chat: open the side panel on an existing workbench page
      if (agentType === 'antigravity_panel') {
        this._log('info', `[launch] Opening Antigravity side-panel`);
        (async () => {
          try {
            // Check if a panel session already exists for the target workspace
            const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
            const wantedBase = workspacePath ? normalise(workspacePath).split('/').filter(Boolean).pop() : '';
            const existingPanel = Array.from(this.sessions.values()).find(s =>
              s.agentType === 'antigravity_panel' && wantedBase &&
              (normalise(s.workspace_path) === normalise(workspacePath) ||
               (s.windowTitle || '').toLowerCase().includes(wantedBase))
            );
            if (existingPanel) {
              this._log('info', `[launch] Panel already exists for workspace: ${existingPanel.session_id}`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: existingPanel.session_id,
              });
              return;
            }

            const targets = await CDP.List({ port: this.CDP_PORTS[0] });
            const workbenchPages = targets.filter(t =>
              t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
            );
            if (workbenchPages.length === 0) {
              this._sendToRelay({
                type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, agent_type: agentType,
                reason: 'No Antigravity window open — launch Antigravity first',
                error_code: 'agent_not_open',
              });
              return;
            }
            // If workspace specified, prefer matching window
            if (workspacePath && workbenchPages.length > 1) {
              const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
              const wanted = normalise(workspacePath);
              const wantedBase = wanted.split('/').filter(Boolean).pop() || '';
              workbenchPages.sort((a, b) => {
                const aT = (a.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
                const bT = (b.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
                return (bT === wantedBase || wanted.endsWith(bT) ? 1 : 0)
                     - (aT === wantedBase || wanted.endsWith(aT) ? 1 : 0);
              });
            }
            let panelOpened = false;
            for (const page of workbenchPages) {
              let pageClient;
              try {
                pageClient = await CDP({ port: this.CDP_PORTS[0], target: page.id });
                await pageClient.Runtime.enable();
                const result = await selectors.openAntigravityPanel(pageClient.Runtime);
                await pageClient.close();
                if (result.ok) {
                  this._log('info', `[launch] Opened Antigravity side-panel: method=${result.method} on "${page.title}"`);
                  panelOpened = true;
                  break;
                }
              } catch (e) {
                if (pageClient) try { await pageClient.close(); } catch {}
                this._log('warn', `[launch] openAntigravityPanel failed on ${page.id.substring(0, 8)}: ${e.message}`);
              }
            }
            if (!panelOpened) {
              this._sendToRelay({
                type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, agent_type: agentType,
                reason: 'Could not open Antigravity side panel',
                error_code: 'panel_open_failed',
              });
              return;
            }
            // Wait for discovery to pick up the new panel session
            this._log('info', `[launch] Waiting for side-panel session to appear...`);
            await sleep(3000);
            await this._discoverTargets();
            // Find the newly appeared antigravity_panel session
            const panelSession = Array.from(this.sessions.values()).find(s =>
              s.agentType === 'antigravity_panel' && (!workspacePath ||
                (s.windowTitle || '').toLowerCase().includes(
                  (workspacePath || '').split(/[\\/]/).filter(Boolean).pop().toLowerCase()
                ))
            );
            if (panelSession) {
              this._log('info', `[launch] session_launch_ack: ${panelSession.session_id}`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: panelSession.session_id,
              });
            } else {
              // Panel opened but no session yet — fire-and-forget, discovery will catch it
              this._log('info', `[launch] Panel opened but session not yet discovered — acking without session`);
              this._sendToRelay({
                type: 'session_launch_ack', protocol_version: proto.PROTOCOL_VERSION,
                request_id: requestId, session_id: null,
                fire_and_forget: true,
                message: 'Antigravity side panel opened — session will appear shortly',
              });
            }
          } catch (e) {
            this._log('error', `[launch] Antigravity panel launch error: ${e.message}`);
            this._sendToRelay({
              type: 'session_launch_failed', protocol_version: proto.PROTOCOL_VERSION,
              request_id: requestId, agent_type: agentType,
              reason: e.message, error_code: 'panel_open_failed',
            });
          }
        })();
        return;
      }

      launchers.launchSession({
        agentType,
        port:          this.CDP_PORTS[0],
        sessions:      this.sessions,
        requestId,
        workspacePath,
        onSuccess: async (newTarget, reqId, wsPath) => {
          const launchedFilter = new Set([newTarget.id]);
          let newSession = null;
          for (let i = 0; i < 5 && !newSession; i++) {
            await this._discoverTargets(launchedFilter);
            newSession = Array.from(this.sessions.values()).find(s => s.targetId === newTarget.id);
            if (!newSession) await sleep(1000);
          }
          if (!newSession) {
            this._log('error', `[launch] Target ${newTarget.id.substring(0, 8)} appeared but could not be registered`);
            this._sendToRelay({
              type: 'session_launch_failed',
              protocol_version: proto.PROTOCOL_VERSION,
              request_id: reqId,
              agent_type: agentType,
              reason: 'Session appeared but failed to register',
              error_code: 'register_failed',
            });
            return;
          }
          const sessionId = newSession.session_id;
          this._log('info', `[launch] session_launch_ack: ${sessionId}`);
          this._sendToRelay({
            type: 'session_launch_ack',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: reqId,
            session_id: sessionId,
          });
        },
        onFailure: (reason, errorCode, reqId) => {
          this._log('warn', `[launch] session_launch_failed: ${reason} (${errorCode})`);
          this._sendToRelay({
            type: 'session_launch_failed',
            protocol_version: proto.PROTOCOL_VERSION,
            request_id: reqId,
            agent_type: agentType,
            reason,
            error_code: errorCode,
          });
        },
      });
      return;
    }

    if (type === 'close_session') {
      const sid = msg.session_id || msg.session;
      this._log('info', `[ctrl] close_session for ${sid}`);
      const sessionData = this.sessions.get(sid);

      const finishClose = () => {
        sessionStore.markDisconnected(sid);
        this.sessions.delete(sid);
        this.activeQuestionPromptAdapters.delete(sid);
        this.activePermissionPrompts.delete(sid);
        this.activeErrorPrompts.delete(sid);
        this._sendToRelay({
          type: 'session_closed',
          protocol_version: proto.PROTOCOL_VERSION,
          session_id: sid,
        });
        this._broadcastSessionSnapshot();
      };

      if (!sessionData) {
        finishClose();
        return;
      }

      const agentT = sessionData.agentType;
      const isDesktopApp = agentT === 'codex-desktop' || agentT === 'claude-desktop';

      if (agentT === 'claude_cli') {
        if (sessionData._claudeCliChild) {
          try { sessionData._claudeCliChild.kill(); } catch {}
          sessionData._claudeCliChild = null;
        }
        finishClose();
        return;
      }

      if (agentT === 'codex_cli') {
        if (sessionData._codexCliChild) {
          try { codexCli.stopCodexExecSession(sessionData._codexCliChild); } catch {}
          sessionData._codexCliChild = null;
        }
        const ownedTurn = sessionData._codexAppServerTurn || null;
        sessionData._codexAppServerTurn = null;
        sessionData._codexAppServerTurnIdentity = null;
        sessionData._codexAppServerTurnCompleted = false;
        sessionData.waitingForAssistant = false;
        if (ownedTurn) {
          Promise.resolve(ownedTurn.stop()).catch(() => {}).finally(finishClose);
        } else {
          finishClose();
        }
        return;
      }

      if (isDesktopApp) {
        // Desktop apps are standalone windows — /json/close/ is safe here
        launchers.closeSession({
          targetId: sessionData.targetId,
          port: sessionData._cdpPort || this.CDP_PORTS[0],
          host: sessionData._cdpHost || null,
        })
          .then(finishClose)
          .catch(finishClose);
        return;
      }

      // For Antigravity sessions: click the tab/panel close button in the
      // workbench DOM instead of using /json/close/ (which kills the whole window).
      const cdpPort = sessionData._cdpPort || this.CDP_PORTS[0];
      const closeOpts = {
        webviewId: sessionData._webviewId || null,
        chatTitle: sessionData.chat_title || null,
      };

      (async () => {
        try {
          const targets = await CDP.List({ port: cdpPort });
          const workbenchPages = targets.filter(t =>
            t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
          );

          // Prefer the workbench page matching the session's parentId
          let workbenchTarget = workbenchPages[0];
          if (sessionData.parentId) {
            for (const page of workbenchPages) {
              let pageClient;
              try {
                pageClient = await CDP({ port: cdpPort, target: page.id });
                await pageClient.Runtime.enable();
                const res = await pageClient.Runtime.evaluate({
                  expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
                  returnByValue: true,
                });
                await pageClient.close();
                if (res.result?.value === sessionData.parentId) {
                  workbenchTarget = page;
                  break;
                }
              } catch {
                if (pageClient) try { await pageClient.close(); } catch {}
              }
            }
          }

          if (workbenchTarget) {
            let wbClient;
            try {
              wbClient = await CDP({ port: cdpPort, target: workbenchTarget.id });
              await wbClient.Runtime.enable();
              const result = await selectors.closeSessionTab(wbClient.Runtime, closeOpts);
              await wbClient.close();
              this._log('info', `[ctrl] closeSessionTab(${JSON.stringify(closeOpts)}): ${JSON.stringify(result)}`);
            } catch (e) {
              if (wbClient) try { await wbClient.close(); } catch {}
              this._log('warn', `[ctrl] closeSessionTab error: ${e.message}`);
            }
          }
        } catch (e) {
          this._log('warn', `[ctrl] close_session CDP error: ${e.message}`);
        }

        // Always disconnect our CDP client and clean up
        if (sessionData.client) {
          try { sessionData.client.close(); } catch {}
        }
        finishClose();
      })();
      return;
    }

    // ── Legacy relay support ────────────────────────────────────────────
    if (!this.relayReady) {
      this._log('info', `[relay] Received '${type}' before ack — assuming legacy relay, marking ready`);
      this.reconnectAttempt = 0;
      this.relayReady = true;
      this._lastSessionSnapshotSig = null;
      this._sendSessionSnapshotNow('connection_ack');
      this._flushPendingPreReadyHistory();
    }
  }

  _cursorCliHistoryCursorSig(msg) {
    const beforeOffset = msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? null;
    return `${msg.mode || 'tail'}:${beforeOffset ?? 'end'}`;
  }

  _cursorCliHistoryChunkThrottle(sessionId, msg) {
    const now = Date.now();
    const mode = msg.mode === 'older' ? 'older' : 'tail';
    const minInterval = mode === 'older' ? CURSOR_CLI_HISTORY_OLDER_MIN_INTERVAL_MS : CURSOR_CLI_HISTORY_TAIL_MIN_INTERVAL_MS;
    const key = `${sessionId}:${mode}`;
    const cursorSig = this._cursorCliHistoryCursorSig(msg);
    const previous = this._cursorCliHistoryChunkRequests.get(key);
    if (previous) {
      const elapsed = now - previous.at;
      if (elapsed < minInterval && previous.cursorSig === cursorSig) {
        const wait = minInterval - elapsed;
        return {
          code: 'throttled',
          message: `Cursor CLI history chunk requests are throttled; retry in ${Math.ceil(wait / 1000)}s`,
        };
      }
      if (elapsed >= CURSOR_CLI_HISTORY_REPEAT_CURSOR_MS) {
        this._cursorCliHistoryChunkRequests.delete(key);
      }
    }
    this._cursorCliHistoryChunkRequests.set(key, { at: now, cursorSig });
    boundOldestMap(this._cursorCliHistoryChunkRequests, RUNTIME_METADATA_MAP_MAX_ENTRIES);
    return null;
  }

  _codexCliHistoryCursorSig(msg) {
    if (!msg || msg.mode !== 'older') return '';
    const beforeOffset = msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? '';
    const beforeId = msg.before_id ?? msg.beforeId ?? msg.cursor?.next_before_id ?? '';
    return `${beforeOffset}\u0001${beforeId}`;
  }

  _codexCliHistoryChunkThrottle(sessionId, msg) {
    const mode = msg.mode === 'older' ? 'older' : 'tail';
    if (mode === 'older' && !msg.user_initiated) {
      return {
        code: 'history_older_requires_user_action',
        message: 'Older Codex CLI history chunks require a current manual WebUI request.',
      };
    }
    const now = Date.now();
    const key = `${sessionId}:${mode}`;
    const cursorSig = this._codexCliHistoryCursorSig(msg);
    const minInterval = mode === 'older'
      ? CODEX_CLI_HISTORY_OLDER_MIN_INTERVAL_MS
      : CODEX_CLI_HISTORY_TAIL_MIN_INTERVAL_MS;
    const previous = this._codexCliHistoryChunkRequests.get(key);
    if (previous) {
      const elapsed = now - previous.at;
      if (elapsed < minInterval) {
        return {
          code: 'history_chunk_throttled',
          message: 'Codex CLI history chunk request throttled to protect the browser and proxy.',
        };
      }
      if (mode === 'older' && cursorSig && previous.cursorSig === cursorSig && elapsed < CODEX_CLI_HISTORY_REPEAT_CURSOR_MS) {
        return {
          code: 'history_chunk_duplicate_cursor',
          message: 'Duplicate older Codex CLI history cursor ignored.',
        };
      }
    }
    this._codexCliHistoryChunkRequests.set(key, { at: now, cursorSig });
    boundOldestMap(this._codexCliHistoryChunkRequests, RUNTIME_METADATA_MAP_MAX_ENTRIES);
    return null;
  }

  _handleTranscriptResyncRequest(msg) {
    const sessionId = msg.session_id || msg.session;
    const session = sessionId ? this.sessions.get(sessionId) : null;
    const state = session?._fileTranscriptState || null;
    if (!sessionId || !session || !state || !Array.isArray(state.messages)) {
      this._log('warn', `[relay] Cannot satisfy transcript resync for ${sessionId || 'unknown'}: file-backed state unavailable`);
      return;
    }
    const source = `${state.agentType}_jsonl`;
    if (msg.source && msg.source !== source) {
      this._log('warn', `[relay] Ignored transcript resync source mismatch for ${sessionId}: ${msg.source} != ${source}`);
      return;
    }
    session._pendingRelayTranscriptResync = msg;
    if (session._relayTranscriptResyncTimer) return;
    const minResyncIntervalMs = 5000;
    const elapsed = Date.now() - Number(session._lastFileTranscriptResyncAt || 0);
    if (elapsed < minResyncIntervalMs) {
      session._relayTranscriptResyncTimer = setTimeout(() => {
        session._relayTranscriptResyncTimer = null;
        const pending = session._pendingRelayTranscriptResync;
        session._pendingRelayTranscriptResync = null;
        if (pending) this._handleTranscriptResyncRequest(pending);
      }, minResyncIntervalMs - elapsed + 25);
      return;
    }
    session._pendingRelayTranscriptResync = null;
    const sourceCursor = state.sourceCursor ? { ...state.sourceCursor } : null;
    const preflight = this._fileTranscriptRecoveryPreflight(
      sessionId,
      session,
      state.messages,
      `${state.agentType} relay cursor recovery`,
    );
    if (!preflight.allowed) {
      this._log('warn', `[${sessionId}] Relay-requested ${state.agentType} recovery deferred (${preflight.reason}, retry after ${preflight.retryAfterMs} ms)`);
      return;
    }
    const recoveredMessages = state.messages.map((message, index) => (
      this._fileTranscriptMessage(state, message, index, sourceCursor)
    ));
    const resyncId = String(msg.resync_id || crypto.randomUUID());
    const accepted = this._sendHistorySnapshot(sessionId, recoveredMessages, `${state.agentType} relay cursor recovery`, {
      resyncId,
      resyncReason: String(msg.reason || 'relay cursor recovery'),
      source,
      sourceCursor,
      sourceBytes: Number(sourceCursor?.bytes_read ?? sourceCursor?.file_size ?? 0) || 0,
      rateLimitMs: minResyncIntervalMs,
    });
    if (accepted) {
      session._lastFileTranscriptResyncAt = Date.now();
      this._log('warn', `[${sessionId}] Sent relay-requested ${state.agentType} transcript recovery ${resyncId} (${recoveredMessages.length} rows)`);
    } else {
      this._log('warn', `[${sessionId}] Could not send relay-requested ${state.agentType} transcript recovery ${resyncId}`);
    }
  }

  _handleHistoryChunkRequest(msg) {
    const sessionId = msg.session_id || msg.session;
    const requestId = msg.request_id || null;
    const fail = (code, message, source = 'codex_cli_jsonl') => {
      if (!sessionId) return;
      this._sendToRelay(proto.historyChunk(sessionId, {
        requestId,
        messages: [],
        mode: msg.mode || 'tail',
        replace: msg.mode !== 'older' && msg.replace === true,
        partial: false,
        complete: true,
        source,
        error: { code, message },
      }));
    };
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return fail('session_not_found', 'Session not found');

    if (session.agentType === 'cursor_cli') {
      const filePath = session.cursorCliFilePath || session.cursor_cli_file_path;
      if (!filePath) return fail('archive_not_found', 'Cursor CLI archive path is unavailable', 'cursor_cli_jsonl');
      const throttle = this._cursorCliHistoryChunkThrottle(sessionId, msg);
      if (throttle) return fail(throttle.code, throttle.message, 'cursor_cli_jsonl');
      const requestedBytes = Number(msg.chunk_bytes || msg.chunkBytes || 0);
      const chunkBytes = Number.isFinite(requestedBytes) && requestedBytes > 0
        ? Math.max(256 * 1024, Math.min(16 * 1024 * 1024, Math.floor(requestedBytes)))
        : CURSOR_CLI_HISTORY_CHUNK_BYTES;
      const beforeOffset = msg.mode === 'older'
        ? (msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? null)
        : null;
      try {
        const chunk = cursorCli.parseCursorJsonlChunk(filePath, { beforeOffset, chunkBytes });
        if (!chunk) return fail('archive_unreadable', 'Cursor CLI archive could not be read', 'cursor_cli_jsonl');
        const messages = Array.isArray(chunk.state?.messages) ? chunk.state.messages : [];
        this._sendToRelay(proto.historyChunk(sessionId, {
          requestId,
          messages,
          mode: msg.mode === 'older' ? 'older' : 'tail',
          replace: msg.mode !== 'older' && msg.replace === true,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          nextBeforeOffset: chunk.nextBeforeOffset,
          totalBytes: chunk.stat?.size || 0,
          partial: !!chunk.nextBeforeOffset,
          complete: !chunk.nextBeforeOffset,
          source: 'cursor_cli_jsonl',
        }));
        this._log('info', `[${sessionId}] Sent Cursor CLI history chunk (${messages.length} msgs, ${chunk.startOffset}-${chunk.endOffset}/${chunk.stat?.size || 0})`);
      } catch (e) {
        fail('chunk_read_failed', e.message || 'Cursor CLI archive chunk read failed', 'cursor_cli_jsonl');
      }
      return;
    }

    if (session.agentType !== 'codex_cli') {
      return fail('unsupported_agent_type', 'Chunked native history is only available for Codex CLI or Cursor CLI sessions');
    }
    const filePath = session.codexCliFilePath || session.codex_cli_file_path;
    if (!filePath) return fail('archive_not_found', 'Codex CLI archive path is unavailable');
    const throttle = this._codexCliHistoryChunkThrottle(sessionId, msg);
    if (throttle) return fail(throttle.code, throttle.message);

    const requestedBytes = Number(msg.chunk_bytes || msg.chunkBytes || 0);
    const chunkBytes = Number.isFinite(requestedBytes) && requestedBytes > 0
      ? Math.max(256 * 1024, Math.min(16 * 1024 * 1024, Math.floor(requestedBytes)))
      : CODEX_CLI_HISTORY_CHUNK_BYTES;
    const requestedLimit = Math.max(0, Math.min(1000, Math.floor(Number(msg.limit) || 0)));
    const beforeOffset = msg.mode === 'older'
      ? (msg.before_offset ?? msg.beforeOffset ?? msg.cursor?.next_before_offset ?? null)
      : null;
    try {
      const chunk = codexCli.parseCodexJsonlChunk(filePath, {
        beforeOffset,
        chunkBytes,
        minimumMessages: requestedLimit,
      });
      if (!chunk) return fail('archive_unreadable', 'Codex CLI archive could not be read');
      const parsedMessages = Array.isArray(chunk.state?.messages) ? chunk.state.messages : [];
      const firstReturnedIndex = requestedLimit > 0 && parsedMessages.length > requestedLimit
        ? parsedMessages.length - requestedLimit
        : 0;
      const messages = firstReturnedIndex > 0
        ? parsedMessages.slice(firstReturnedIndex)
        : parsedMessages;
      const firstReturnedOffset = Math.max(
        0,
        Number(chunk.messageStartOffsets?.[firstReturnedIndex]) || Number(chunk.startOffset) || 0,
      );
      const nextBeforeOffset = firstReturnedOffset > 0 ? firstReturnedOffset : null;
      this._sendToRelay(proto.historyChunk(sessionId, {
        requestId,
        messages,
        mode: msg.mode === 'older' ? 'older' : 'tail',
        replace: msg.mode !== 'older' && msg.replace === true,
        startOffset: firstReturnedOffset,
        endOffset: chunk.endOffset,
        nextBeforeOffset,
        totalBytes: chunk.stat?.size || 0,
        partial: !!nextBeforeOffset,
        complete: !nextBeforeOffset,
        source: 'codex_cli_jsonl',
      }));
      this._log('info', `[${sessionId}] Sent Codex CLI history chunk (${messages.length}/${parsedMessages.length} msgs, scanned ${chunk.bytesRead || 0} bytes, ${firstReturnedOffset}-${chunk.endOffset}/${chunk.stat?.size || 0})`);
    } catch (e) {
      fail('chunk_read_failed', e.message || 'Codex CLI archive chunk read failed');
    }
  }

  _scheduleRelayBulkFlush() {
    if (this._relayBulkFlushTimer) return;
    this._relayBulkFlushTimer = setTimeout(() => {
      this._relayBulkFlushTimer = null;
      this._flushPendingRelayBulk();
    }, 50);
  }

  _queueRelayBulk(key, encoded, msg) {
    if (!this._pendingRelayBulk) this._pendingRelayBulk = new Map();
    const existing = this._pendingRelayBulk.get(key);
    if (existing) this._pendingRelayBulk.delete(key);
    this._pendingRelayBulk.set(key, {
      encoded,
      byteLen: Buffer.byteLength(encoded, 'utf8'),
      type: msg?.type || 'unknown',
      sessionId: msg?.session_id || msg?.session || 'unknown',
      queuedAt: existing?.queuedAt || Date.now(),
    });
    let queuedBytes = 0;
    for (const item of this._pendingRelayBulk.values()) queuedBytes += item.byteLen;
    let evicted = 0;
    while (this._pendingRelayBulk.size > PENDING_RELAY_BULK_MAX_ENTRIES
      || queuedBytes > PENDING_RELAY_BULK_MAX_BYTES) {
      const oldestKey = this._pendingRelayBulk.keys().next().value;
      const oldest = this._pendingRelayBulk.get(oldestKey);
      this._pendingRelayBulk.delete(oldestKey);
      this._relayBulkDeferralLogAt?.delete(oldestKey);
      queuedBytes -= Number(oldest?.byteLen || 0);
      evicted += 1;
    }
    if (evicted > 0) {
      this._log('warn', `[relay] Dropped ${evicted} oldest deferred bulk snapshot(s) to enforce the ${PENDING_RELAY_BULK_MAX_ENTRIES}-entry/${Math.round(PENDING_RELAY_BULK_MAX_BYTES / 1024 / 1024)} MiB queue limit`);
    }
    if (!this._relayBulkDeferralLogAt) this._relayBulkDeferralLogAt = new Map();
    const now = Date.now();
    const last = this._relayBulkDeferralLogAt.get(key) || 0;
    if (now - last >= 30000) {
      this._relayBulkDeferralLogAt.set(key, now);
      boundOldestMap(this._relayBulkDeferralLogAt, RUNTIME_METADATA_MAP_MAX_ENTRIES);
      this._log('warn', `[relay] Coalescing bulk ${msg?.type || 'message'} for ${msg?.session_id || msg?.session || 'unknown'} at ${this.relayWs?.bufferedAmount || 0} buffered bytes`);
    }
    this._scheduleRelayBulkFlush();
  }

  _flushPendingRelayBulk() {
    const pending = this._pendingRelayBulk;
    if (!pending || pending.size === 0) return;
    if (!(this.relayReady && this.relayWs && this.relayWs.readyState === WebSocket.OPEN)) return;
    const [key, item] = pending.entries().next().value;
    if (item.byteLen > RELAY_BULK_FRAME_MAX_BYTES) {
      pending.delete(key);
      this._relayBulkDeferralLogAt?.delete(key);
      this._log('warn', `[relay] Dropping oversized deferred bulk ${item.type} for ${item.sessionId} (${item.byteLen} bytes)`);
      this._scheduleRelayBulkFlush();
      return;
    }
    const bufferedAmount = this.relayWs.bufferedAmount || 0;
    // A single authoritative snapshot may legitimately be larger than the
    // normal queued-byte budget. Let exactly one such bounded frame start only
    // after the socket is fully drained; control/status frames still bypass
    // this queue while it waits. Requiring frame <= high-water made every
    // 512 KiB+ snapshot impossible to send and left relay SQLite permanently
    // behind the native transcript.
    const waitedMs = Date.now() - (item.queuedAt || Date.now());
    const socketReadyForFrame = item.byteLen > RELAY_BULK_HIGH_WATER_BYTES
      ? bufferedAmount === 0
        || (waitedMs >= RELAY_BULK_MAX_DEFERRAL_MS && bufferedAmount <= RELAY_BULK_HIGH_WATER_BYTES)
      : bufferedAmount + item.byteLen <= RELAY_BULK_HIGH_WATER_BYTES;
    if (!socketReadyForFrame) {
      this._scheduleRelayBulkFlush();
      return;
    }

    pending.delete(key);
    this._relayBulkDeferralLogAt?.delete(key);
    try {
      this.relayWs.send(item.encoded, (error) => {
        if (error) this._log('warn', `[relay] Deferred bulk ${item.type} failed for ${item.sessionId}: ${error.message}`);
        this._scheduleRelayBulkFlush();
      });
    } catch (error) {
      this._log('warn', `[relay] Deferred bulk ${item.type} failed for ${item.sessionId}: ${error.message}`);
      this._scheduleRelayBulkFlush();
    }
  }

  _stampNavigationMessage(msg) {
    const context = this._navigationContext?.getStore();
    if (!context || !NAVIGATION_SCOPED_RELAY_TYPES.has(msg?.type)) return msg;
    if (normalizeNavigationEpoch(msg.navigation_epoch)) return msg;
    const messageSessionId = String(msg?.session_id || msg?.session || '');
    if (messageSessionId && messageSessionId !== context.sessionId) return msg;
    return {
      ...msg,
      navigation_epoch: context.navigationEpoch,
      ...(!messageSessionId ? { navigation_session_id: context.sessionId } : {}),
    };
  }

  _sendToRelay(msg, options = {}) {
    msg = this._stampNavigationMessage(msg);
    if (msg?.type === 'rate_limit_active' || msg?.type === 'rate_limit_cleared') {
      this._providerUsage?.refresh({ force: true, reason: msg.type }).catch(() => {});
    }
    const encoded = JSON.stringify(msg);
    const byteLen = Buffer.byteLength(encoded, 'utf8');
    if (byteLen > RELAY_MESSAGE_MAX_BYTES) {
      const kind = msg?.type || 'unknown';
      const sessionId = msg?.session_id || msg?.session || 'unknown';
      this._log('warn', `[relay] Dropping oversized ${kind} for ${sessionId} (${byteLen} bytes)`);
      return false;
    }
    if (this.relayReady && this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      const bulkKey = options.bulkKey || '';
      if (bulkKey && byteLen > RELAY_BULK_FRAME_MAX_BYTES) {
        const sessionId = msg?.session_id || msg?.session || 'unknown';
        this._log('warn', `[relay] Dropping oversized bulk ${msg?.type || 'message'} for ${sessionId} (${byteLen} bytes)`);
        return false;
      }
      const projectedBufferedAmount = (this.relayWs.bufferedAmount || 0) + byteLen;
      if (bulkKey && (projectedBufferedAmount > RELAY_BULK_HIGH_WATER_BYTES || this._pendingRelayBulk?.size > 0)) {
        this._queueRelayBulk(bulkKey, encoded, msg);
        return true;
      }
      this.relayWs.send(encoded);
      return true;
    }
    // Relay not ready yet (e.g. discovery is running in parallel with the
    // WebSocket handshake on startup). Queue the latest snapshot per session
    // so it flushes when the relay becomes ready — otherwise the WebUI stays
    // stuck on whatever the DB had before the proxy restarted.
    const type = msg && msg.type;
    if (type === 'history' || type === 'history_snapshot') {
      const sid = msg.session_id || msg.session;
      if (sid) {
        if (byteLen > DEFERRED_HISTORY_FLUSH_MAX_BYTES) {
          this._log('info', `[relay] Skipped pre-ready history snapshot for ${sid} (${Math.round(byteLen / 1024)} KB); browser will request transcript tail on selection`);
          return false;
        }
        if (!this._pendingPreReadyHistory) this._pendingPreReadyHistory = new Map();
        // Keep only the most recent snapshot per session — older queued ones
        // are obsolete the moment a newer one arrives.
        this._pendingPreReadyHistory.delete(sid);
        this._pendingPreReadyHistory.set(sid, encoded);
        boundOldestMap(this._pendingPreReadyHistory, PENDING_PRE_READY_HISTORY_MAX_ENTRIES);
      }
    }
    if (type === 'proxy_send_result' || type === 'agent_started') {
      const sid = msg.session_id || msg.session;
      const clientMessageId = msg.client_message_id;
      if (sid && clientMessageId) {
        if (!this._pendingPreReadyEvents) this._pendingPreReadyEvents = new Map();
        const key = `${type}:${sid}:${clientMessageId}`;
        this._pendingPreReadyEvents.set(key, encoded);
        // Delivery results are tiny. Bound the queue so a prolonged outage
        // cannot grow memory without limit.
        while (this._pendingPreReadyEvents.size > 256) {
          this._pendingPreReadyEvents.delete(this._pendingPreReadyEvents.keys().next().value);
        }
      }
    }
    return false;
  }

  _flushPendingPreReadyHistory() {
    if (!(this.relayReady && this.relayWs && this.relayWs.readyState === WebSocket.OPEN)) return;
    const q = this._pendingPreReadyHistory;
    if (q && q.size > 0) {
      for (const [sid, encoded] of q.entries()) {
        try {
          const byteLen = Buffer.byteLength(encoded, 'utf8');
          if (byteLen > DEFERRED_HISTORY_FLUSH_MAX_BYTES) {
            this._log('info', `[relay] Skipped deferred history snapshot for ${sid} (${Math.round(byteLen / 1024)} KB); browser will request transcript tail on selection`);
            continue;
          }
          this.relayWs.send(encoded);
          this._log('info', `[relay] Flushed deferred history snapshot for ${sid}`);
        } catch (e) {
          this._log('warn', `[relay] Failed to flush deferred snapshot for ${sid}: ${e.message}`);
        }
      }
      q.clear();
    }

    const events = this._pendingPreReadyEvents;
    if (events && events.size > 0) {
      for (const [key, encoded] of events.entries()) {
        try {
          this.relayWs.send(encoded);
          this._log('info', `[relay] Flushed deferred control result ${key}`);
        } catch (e) {
          this._log('warn', `[relay] Failed to flush deferred control result ${key}: ${e.message}`);
        }
      }
      events.clear();
    }
    this._flushPendingRelayBulk();
  }

  _historySnapshotLimitBytes(reason = 'history') {
    if (!(this.relayReady && this.relayWs && this.relayWs.readyState === WebSocket.OPEN)) {
      return DEFERRED_HISTORY_FLUSH_MAX_BYTES;
    }
    const r = String(reason || '').toLowerCase();
    // User-directed navigation snapshots are allowed to be larger because they
    // are infrequent and make the selected native conversation appear.
    if (/\b(switch|new_thread|new conversation)\b/.test(r)) {
      return RELAY_MESSAGE_MAX_BYTES;
    }
    return AUTOMATIC_HISTORY_SNAPSHOT_MAX_BYTES;
  }

  _historySnapshotSizeInfo(sessionId, messages, maxBytes, includeLegacyHistory = true) {
    const emptySnapshot = proto.historySnapshot(sessionId, [], { includeLegacyHistory });
    const arrayCopies = includeLegacyHistory ? 2 : 1;
    // Start from the empty shape and add each serialized array payload below.
    // The compatibility shape carries the transcript twice (messages/history),
    // so its byte budget must count both copies.
    let bytes = Buffer.byteLength(JSON.stringify(emptySnapshot), 'utf8');
    for (let i = 0; i < messages.length; i++) {
      let encoded = '';
      try {
        encoded = JSON.stringify(messages[i]);
      } catch {
        encoded = JSON.stringify({
          role: messages[i]?.role || '',
          content: this._messageContentText(messages[i]),
        });
      }
      bytes += arrayCopies * (Buffer.byteLength(encoded || 'null', 'utf8') + (i > 0 ? 1 : 0));
      if (bytes > maxBytes) {
        return { fits: false, bytes, counted: i + 1 };
      }
    }
    return { fits: bytes <= maxBytes, bytes, counted: messages.length };
  }

  _shouldLogLargeHistorySkip(sessionId, reason) {
    const key = `${sessionId}:${String(reason || 'history').toLowerCase()}`;
    const now = Date.now();
    const last = this._largeHistorySkipLogAt.get(key) || 0;
    if (now - last < 30000) return false;
    this._largeHistorySkipLogAt.set(key, now);
    boundOldestMap(this._largeHistorySkipLogAt, RUNTIME_METADATA_MAP_MAX_ENTRIES);
    return true;
  }

  _sessionSnapshotSignature(metas) {
    const stableMetas = metas.map(meta => ({
      ...meta,
      last_seen_at: undefined,
      // Activity and live timers are broadcast through proxy_status; including
      // them here turns every status tick into a full session-list update.
      activity: undefined,
    }));
    return JSON.stringify({ sessions: stableMetas, workspaces: this.openWorkspaces || [] });
  }

  _sendSessionSnapshotNow(reason = 'snapshot') {
    const metas = this._buildSessionMetas();
    const snapshotSig = this._sessionSnapshotSignature(metas);
    if (snapshotSig === this._lastSessionSnapshotSig) return;
    this._lastSessionSnapshotSig = snapshotSig;
    this._log('info', `[snapshot] Broadcasting ${metas.length} sessions${reason ? ` (${reason})` : ''}: ${metas.map(m => m.session_id.substring(0,8) + '(' + m.agent_type + ')').join(', ')}`);
    this._sendToRelay(proto.sessionSnapshot(metas, this.openWorkspaces, this.PROXY_ID));
  }

  _sendHistorySnapshot(sessionId, messages, reason = 'history', options = {}) {
    const fullMessages = Array.isArray(messages) ? messages : [];
    const titleSession = this.sessions.get(sessionId);
    if (titleSession && this._promoteSessionChatTitle(sessionId, titleSession, fullMessages)) {
      this._broadcastSessionSnapshot('history title hydration');
    }
    const buildSnapshot = (msgs, liveUpdate = null, includeLegacyHistory = true) => proto.historySnapshot(
      sessionId,
      msgs,
      { ...(liveUpdate ? { liveUpdate } : {}), includeLegacyHistory, ...options },
    );

    if (fullMessages.length === 0) {
      this._log('info', `[${sessionId}] Sending empty history snapshot (${reason})`);
      return this._sendToRelay(buildSnapshot([]));
    }

    const maxBytes = this._historySnapshotLimitBytes(reason);
    let includeLegacyHistory = true;
    let sizeInfo = this._historySnapshotSizeInfo(sessionId, fullMessages, maxBytes, true);
    if (!sizeInfo.fits) {
      const compactSizeInfo = this._historySnapshotSizeInfo(sessionId, fullMessages, maxBytes, false);
      if (compactSizeInfo.fits) {
        includeLegacyHistory = false;
        sizeInfo = compactSizeInfo;
        if (this._shouldLogLargeHistorySkip(sessionId, reason)) {
          this._log(
            'info',
            `[${sessionId}] Sending compact history snapshot (${fullMessages.length} msgs, ${Math.round(sizeInfo.bytes / 1024)} KB, ${reason}); omitted redundant legacy history array`
          );
        }
      }
    }
    if (sizeInfo.fits) {
      const userDirected = /\b(switch|new_thread|new conversation)\b/i.test(String(reason || ''));
      const agentType = this.sessions.get(sessionId)?.agentType;
      const priorityLiveUpdate = (
        agentType === 'cursor'
        || agentType === 'antigravity-v2'
        || agentType === 'codex_cli'
        || agentType === 'cursor_cli'
        || agentType === 'continue'
        || agentType === 'continue_yolo'
      ) && String(reason || '').toLowerCase() === 'assistant completion';
      if (shouldBypassHistoryBulkQueue(agentType, reason, sizeInfo.bytes)) {
        this._pendingRelayBulk?.delete(`history_snapshot:${sessionId}`);
        return this._sendToRelay(buildSnapshot(fullMessages, 'assistant_completion', includeLegacyHistory));
      }
      return this._sendToRelay(
        buildSnapshot(fullMessages, priorityLiveUpdate ? 'assistant_completion' : null, includeLegacyHistory),
        userDirected ? {} : { bulkKey: `history_snapshot:${sessionId}` }
      );
    }

    // Do not send a clipped history snapshot. The relay treats snapshots as
    // authoritative and replaces persisted history; sending only the tail would
    // erase older messages from the WebUI.
    if (this._shouldLogLargeHistorySkip(sessionId, reason)) {
      this._log(
        'warn',
        `[${sessionId}] Skipping large history snapshot (${fullMessages.length} msgs, >${Math.round(maxBytes / 1024)} KB after ${sizeInfo.counted} msgs, ${reason}); browser will request transcript tail on selection`
      );
    }
    return false;

  }

  _recordPollTickBudget(durationMs) {
    if (!this._pollBudgetTelemetry) {
      this._pollBudgetTelemetry = {
        durationsMs: [], completedTicks: 0, lastReportedSkippedTicks: 0, latest: null,
      };
    }
    const telemetry = this._pollBudgetTelemetry;
    telemetry.durationsMs.push(Math.max(0, Number(durationMs) || 0));
    if (telemetry.durationsMs.length > POLL_BUDGET_SAMPLE_MAX) {
      telemetry.durationsMs.splice(0, telemetry.durationsMs.length - POLL_BUDGET_SAMPLE_MAX);
    }
    telemetry.completedTicks += 1;
    if (telemetry.completedTicks % POLL_BUDGET_REPORT_EVERY_TICKS !== 0) {
      return telemetry.latest;
    }
    const sorted = [...telemetry.durationsMs].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    const skippedTotal = Math.max(0, Number(this._skippedPollTicks) || 0);
    const latest = {
      completed_ticks: telemetry.completedTicks,
      window_samples: sorted.length,
      p95_ms: sorted[p95Index] || 0,
      max_ms: sorted[sorted.length - 1] || 0,
      skipped_total: skippedTotal,
      skipped_delta: skippedTotal - telemetry.lastReportedSkippedTicks,
    };
    telemetry.latest = latest;
    telemetry.lastReportedSkippedTicks = skippedTotal;
    this._log('info', `[poll] budget completed=${latest.completed_ticks} window=${latest.window_samples} p95_ms=${latest.p95_ms} max_ms=${latest.max_ms} skipped_total=${latest.skipped_total} skipped_delta=${latest.skipped_delta}`);
    return latest;
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────

  _sendProxyMessage(sessionId, msg) {
    if (!msg) return false;
    return this._sendToRelay(proto.proxyMessage(sessionId, msg.role, msg.content, msg));
  }

  _messageContentText(msg) {
    if (Array.isArray(msg?.content_blocks) && msg.content_blocks.length > 0) {
      return msg.content_blocks.map(block => {
        if (!block) return '';
        if (typeof block === 'string') return block;
        const terminalParts = [
          block.workdir ? `cwd: ${block.workdir}` : '',
          block.command ? `$ ${block.command}` : '',
          block.stdout || '',
          block.stderr ? `stderr:\n${block.stderr}` : '',
          block.exit_code != null ? `exit code: ${block.exit_code}` : '',
        ].filter(Boolean);
        if (terminalParts.length > 0) return terminalParts.join('\n\n');
        if (Array.isArray(block.files) && block.files.length > 0) {
          const files = block.files.map(file => [
            file.path || file.file || '',
            file.added != null ? `+${file.added}` : '',
            file.removed != null ? `-${file.removed}` : '',
          ].filter(Boolean).join(' ')).filter(Boolean).join('\n');
          return [block.content || block.text || block.markdown || '', files].filter(Boolean).join('\n\n');
        }
        return block.content || block.text || block.markdown || block.title || block.label || '';
      }).filter(Boolean).join('\n\n') || String(msg?.content || '');
    }
    const content = msg?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.content || JSON.stringify(part);
      }).join('\n');
    }
    if (content == null) return '';
    return String(content);
  }

  _codexDesktopTerminalEntries(session) {
    if (!Array.isArray(session?._accumulatedMessages)) return null;
    return selectors.codexTerminalEntriesFromMessages(session._accumulatedMessages);
  }

  _codexDesktopFileChangeEntries(session) {
    if (!Array.isArray(session?._accumulatedMessages)) return null;
    return selectors.codexFileChangeEntriesFromMessages(session._accumulatedMessages);
  }

  _shouldReplaceAccumulatedMessage(agentType, accumulated, observed) {
    const accumulatedText = this._messageContentText(accumulated);
    const observedText = this._messageContentText(observed);
    if (observedText.length > accumulatedText.length) return true;
    if (
      agentType === 'antigravity-v2' &&
      observedText === accumulatedText &&
      this._transcriptSignature([observed]) !== this._transcriptSignature([accumulated])
    ) {
      return true;
    }
    return false;
  }

  _messagesSoftMatch(a, b) {
    if (!a || !b || a.role !== b.role) return false;
    const left = this._messageContentText(a).replace(/\s+/g, ' ').trim();
    const right = this._messageContentText(b).replace(/\s+/g, ' ').trim();
    if (!left || !right) return left === right;
    if (left === right) return true;
    if (
      (a.agentType === 'codex' || b.agentType === 'codex' || a.agent_type === 'codex' || b.agent_type === 'codex')
      || (Array.isArray(a.content_blocks) || Array.isArray(b.content_blocks))
      || /\[[^\]\n]+][\s\S]*?\[end]/.test(left + right)
    ) {
      if (this._codexToolKeysSoftMatch(a, b)) return true;
    }
    const probeLen = Math.min(160, left.length, right.length);
    if (probeLen < 40) return false;
    const leftProbe = left.substring(0, probeLen);
    const rightProbe = right.substring(0, probeLen);
    return left.startsWith(rightProbe) || right.startsWith(leftProbe);
  }

  _cursorMessagesSoftMatch(a, b) {
    if (this._messagesSoftMatch(a, b)) return true;
    if (!a || !b || a.role !== 'assistant' || b.role !== 'assistant') return false;
    const left = this._messageContentText(a).replace(/\s+/g, ' ').trim();
    const right = this._messageContentText(b).replace(/\s+/g, ' ').trim();
    if (Math.min(left.length, right.length) < 24) return false;
    // Cursor may discard an assistant's streamed preamble/tool block from the
    // rendered DOM while retaining only the final answer. That final answer is
    // an exact suffix of the richer durable message and is the same turn, not a
    // new assistant message.
    return left.endsWith(right) || right.endsWith(left);
  }

  _isCodexCompletionSummaryMessage(msg) {
    if (!msg || msg.role !== 'assistant') return false;
    const text = this._messageContentText(msg).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /^Worked for\s+/i.test(text)
      || /\bTask completed\b/i.test(text)
      || /\bImplemented and (?:committed|pushed)\b/i.test(text)
      || /\bWhat changed:\b/i.test(text)
      || /\bVerified:\b/i.test(text)
      || /\b\d+\s+files?\s+changed\b/i.test(text);
  }

  _titleTokenOverlap(left, right) {
    const make = value => new Set(String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !/^(with|from|this|that|code|task|chat|session)$/.test(t)));
    const a = make(left);
    const b = make(right);
    if (a.size === 0 || b.size === 0) return 0;
    let overlap = 0;
    for (const token of a) if (b.has(token)) overlap++;
    return overlap / Math.max(1, Math.min(a.size, b.size));
  }

  _codexDesktopLooksCollapsed(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0 || list.length > 5) return false;
    const assistantCount = list.filter(m => m && m.role === 'assistant').length;
    const hasCompletion = list.some(m => this._isCodexCompletionSummaryMessage(m));
    return assistantCount > 0 && hasCompletion;
  }

  _isStrongCodexArchiveAnchor(msg) {
    if (!msg) return false;
    const text = this._messageContentText(msg).replace(/\s+/g, ' ').trim();
    if (this._isCodexCompletionSummaryMessage(msg)) return text.length >= 40;
    return text.length >= 80;
  }

  _codexDesktopArchiveAnchor(archiveMessages, domMessages) {
    const archive = Array.isArray(archiveMessages) ? archiveMessages : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    if (archive.length === 0 || dom.length === 0) return -1;

    const windowOffset = this._transcriptWindowOffset(archive, dom);
    if (windowOffset >= 0) return windowOffset;

    const domUsers = dom.filter(m => m && m.role === 'user');
    for (const user of domUsers) {
      if (!this._isStrongCodexArchiveAnchor(user)) continue;
      const idx = this._findMatchingMessageIndex(archive, user);
      if (idx >= 0) return idx;
    }

    const domCompletion = dom.find(m => this._isCodexCompletionSummaryMessage(m));
    if (domCompletion) {
      const idx = this._findMatchingMessageIndex(archive, domCompletion);
      if (idx >= 0) return idx;
    }

    return -1;
  }

  _codexDesktopArchiveCoversVisibleUsers(archiveMessages, domMessages) {
    const archive = Array.isArray(archiveMessages) ? archiveMessages : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    const visibleUsers = dom.filter(m =>
      m &&
      m.role === 'user' &&
      this._isStrongCodexArchiveAnchor(m)
    );
    if (visibleUsers.length === 0) return true;
    return visibleUsers.every(user => this._findMatchingMessageIndex(archive, user) >= 0);
  }

  _boundedCodexDesktopArchiveMessages(archiveMessages, domMessages, anchorIdx) {
    const archive = Array.isArray(archiveMessages) ? archiveMessages : [];
    if (archive.length <= 2000) return archive;

    const dom = Array.isArray(domMessages) ? domMessages : [];
    const hasUsefulAnchor = Number.isInteger(anchorIdx) && anchorIdx >= 0;
    const start = hasUsefulAnchor
      ? Math.max(0, anchorIdx - 40)
      : Math.max(0, archive.length - 2000);
    const end = Math.min(archive.length, Math.max(start + 2000, start + dom.length + 80));
    return archive.slice(start, end);
  }

  _maybeUseCodexDesktopArchive(sessionId, session, domMessages) {
    if (!session || session.agentType !== 'codex-desktop') return domMessages;
    session._codexDesktopArchivePollSettledActivity = null;
    const dom = Array.isArray(domMessages) ? domMessages : [];
    const now = Date.now();
    const collapsed = this._codexDesktopLooksCollapsed(dom);
    const provisionalThreadKey = /^local:client-new-thread:/i.test(String(session._activeThreadKey || ''));
    const confirmedProvisionalArchivePath = provisionalThreadKey
      ? String(session._codexDesktopArchivePath || '')
      : '';
    // The client placeholder itself ends in a request UUID. It is not the
    // native Codex archive UUID and must never enter the exact-ID lookup.
    const activeCliSessionId = provisionalThreadKey
      ? ''
      : codexDesktopCliSessionId(session._activeThreadKey);
    const domBlockCounts = codexDesktopStructuredBlockCounts(dom);
    const domStructuredCount = Number(domBlockCounts.terminal || 0)
      + Number(domBlockCounts.file_changes || 0)
      + Number(domBlockCounts.tool_call || 0)
      + Number(domBlockCounts.tool_result || 0);
    const provisionalUserAnchor = provisionalThreadKey
      ? dom.find(message => message?.role === 'user' && this._isStrongCodexArchiveAnchor(message))
      : null;
    // Current Codex Desktop persists completed turns as generic assistant
    // units after a full app restart. Its in-page expanded-command cache is
    // intentionally gone, so a rich local thread can have zero durable DOM
    // tool blocks. An exact native thread UUID is a stronger archive identity
    // than presentation text and permits a bounded archive recovery probe.
    const needsExactStructuredRecovery = !!activeCliSessionId && domStructuredCount === 0;
    // A newly submitted Desktop thread can remain keyed by the client-side
    // placeholder until the app is restarted even though its UUID JSONL has
    // already been created. Only that explicit placeholder is allowed to use
    // the full visible user turn as a recent archive resolver. The normal
    // presentation-title fallback and its fail-closed anchor checks remain
    // unchanged for every other thread shape.
    const needsProvisionalStructuredRecovery = !!provisionalUserAnchor && domStructuredCount === 0;
    // A send baseline resolves a provisional placeholder from a fresh native
    // read, verifies that the active thread is unchanged, then caches the exact
    // JSONL path before Enter. Once that stronger identity exists, keep reading
    // it even when the older DOM window still has structured blocks; otherwise
    // a newly appended turn can be receipt-confirmed but never reach history.
    const needsConfirmedProvisionalRefresh = !!confirmedProvisionalArchivePath;
    const accumulatedHasMore = Array.isArray(session._accumulatedMessages) && session._accumulatedMessages.length > dom.length;
    const accumulatedContainsVisibleWindow = accumulatedHasMore && this._transcriptWindowOffset(session._accumulatedMessages, dom) >= 0;
    if (
      !collapsed
      && !accumulatedContainsVisibleWindow
      && !needsExactStructuredRecovery
      && !needsProvisionalStructuredRecovery
      && !needsConfirmedProvisionalRefresh
    ) return dom;
    const archiveCheckIntervalMs = ['generating', 'thinking', 'running_command', 'tool'].includes(session.activity?.kind)
      ? 250
      : 10000;
    if (session._lastCodexDesktopArchiveCheckAt && now - session._lastCodexDesktopArchiveCheckAt < archiveCheckIntervalMs) {
      const cached = Array.isArray(session._codexDesktopArchiveMessages) ? session._codexDesktopArchiveMessages : null;
      const cachedExact = !!activeCliSessionId
        && session._codexDesktopArchiveCliSessionId === activeCliSessionId;
      if (cachedExact && cached) {
        const cachedCounts = session._codexDesktopArchiveBlockCounts
          || codexDesktopStructuredBlockCounts(cached);
        const cachedStructuredCount = Number(cachedCounts.terminal || 0)
          + Number(cachedCounts.file_changes || 0)
          + Number(cachedCounts.tool_call || 0)
          + Number(cachedCounts.tool_result || 0);
        if (
          this._codexDesktopArchiveCoversVisibleUsers(cached, dom)
          && (cached.length > dom.length || cachedStructuredCount > domStructuredCount)
        ) return cached;
      } else if (cached && cached.length > dom.length) {
        const cachedAnchor = this._codexDesktopArchiveAnchor(cached, dom);
        if (cachedAnchor >= 0 && this._codexDesktopArchiveCoversVisibleUsers(cached, dom)) return cached;
      }
      return dom;
    }
    session._lastCodexDesktopArchiveCheckAt = now;

    const activeTitle = session._activeThreadTitle || session.chat_title || '';
    const provisionalTitle = provisionalUserAnchor
      ? this._messageContentText(provisionalUserAnchor)
      : '';
    const summary = confirmedProvisionalArchivePath
      ? codexCli.readSessionSummary(confirmedProvisionalArchivePath, this._codexCliActiveSummaryOptions())
      : (activeCliSessionId
        ? codexCli.findSessionByCliId(activeCliSessionId)
        : (provisionalUserAnchor
        ? codexCli.findRecentSessionByUserAnchor(provisionalTitle, {
            sinceMs: now - (60 * 60 * 1000),
            maxFiles: 40,
          })
        : codexCli.findLatestSessionForTitle({
            workspacePath: session.workspace_path || null,
            workspaceName: session.workspace_name || null,
            title: activeTitle,
            maxFiles: 20,
          })));
    if (!summary || !Array.isArray(summary.messages)) return dom;
    const exactThread = !!activeCliSessionId && summary.cliSessionId === activeCliSessionId;
    const confirmedProvisionalThread = !!confirmedProvisionalArchivePath
      && path.resolve(summary.filePath) === path.resolve(confirmedProvisionalArchivePath);
    const normalizedMessages = codexDesktopArchiveMessages(summary.messages);
    if (normalizedMessages.length === 0) return dom;

    const anchorIdx = this._codexDesktopArchiveAnchor(normalizedMessages, dom);
    if (!exactThread && !confirmedProvisionalThread && anchorIdx < 0) return dom;
    if (!this._codexDesktopArchiveCoversVisibleUsers(normalizedMessages, dom)) return dom;

    const previousUpdatedAt = session._codexDesktopArchiveUpdatedAt || null;
    const previousSizeBytes = Number(session._codexDesktopArchiveSizeBytes);
    const currentSizeBytes = Number(summary.sizeBytes);
    const archiveAdvanced = (
      (!!previousUpdatedAt && !!summary.updatedAt && previousUpdatedAt !== summary.updatedAt)
      || (Number.isFinite(previousSizeBytes) && Number.isFinite(currentSizeBytes) && currentSizeBytes > previousSizeBytes)
    );
    session._codexDesktopArchiveUpdatedAt = summary.updatedAt || previousUpdatedAt;
    if (Number.isFinite(currentSizeBytes)) session._codexDesktopArchiveSizeBytes = currentSizeBytes;
    const archiveActivity = summary.activity || {
      kind: 'idle',
      label: '',
      updated_at: summary.updatedAt || new Date().toISOString(),
    };
    if (archiveAdvanced && archiveActivity.kind === 'idle') {
      // This marker is poll-scoped. It is deliberately unavailable to cached
      // archive reads, so an idle previous turn cannot clear a new send.
      session._codexDesktopArchivePollSettledActivity = archiveActivity;
    }

    const archiveMessages = this._boundedCodexDesktopArchiveMessages(normalizedMessages, dom, anchorIdx);
    const archiveBlockCounts = codexDesktopStructuredBlockCounts(archiveMessages);
    const archiveStructuredCount = Number(archiveBlockCounts.terminal || 0)
      + Number(archiveBlockCounts.file_changes || 0)
      + Number(archiveBlockCounts.tool_call || 0)
      + Number(archiveBlockCounts.tool_result || 0);
    if (archiveMessages.length <= dom.length && archiveStructuredCount <= domStructuredCount) return dom;

    session._codexDesktopArchiveMessages = archiveMessages;
    session._codexDesktopArchivePath = summary.filePath;
    session._codexDesktopArchiveCliSessionId = (exactThread || confirmedProvisionalThread)
      ? (summary.cliSessionId || activeCliSessionId || null)
      : null;
    session._codexDesktopArchiveBlockCounts = archiveBlockCounts;
    session._codexDesktopArchivePartial = summary.messagesPartial === true;
    this._log('info', `[${sessionId}] Using ${(exactThread || confirmedProvisionalThread) ? 'exact-thread ' : ''}Codex Desktop JSONL transcript (${archiveMessages.length}/${summary.messages.length} msgs; ${archiveStructuredCount} structured blocks) to keep completed task expanded`);
    return archiveMessages;
  }

  _applyCodexDesktopArchiveSettledActivity(sessionId, session) {
    const observed = session?._codexDesktopArchivePollSettledActivity;
    if (!session || session.agentType !== 'codex-desktop' || observed?.kind !== 'idle') return false;

    const prevKind = session.activity?.kind || 'idle';
    const wasActive = ['generating', 'thinking', 'running_command', 'tool'].includes(prevKind)
      || session.thinking
      || session.waitingForAssistant
      || session.pendingLast !== null;
    const canonicalGoal = this._canonicalGoalForSession(
      sessionId,
      session,
      observed.goal,
      'codex_desktop_archive',
    );
    const idleActivity = this._applyGoalRunLifecycle(sessionId, session, {
      ...observed,
      kind: 'idle',
      label: observed.label || '',
      updated_at: observed.updated_at || new Date().toISOString(),
      ...(canonicalGoal ? { goal: canonicalGoal } : {}),
    }, {
      source: 'codex_desktop_archive',
      sourceCursor: canonicalGoal?.native_cursor || null,
      nativeEventAt: canonicalGoal?.native_updated_at || observed.updated_at || null,
      observedAt: new Date().toISOString(),
      evidenceType: 'desktop_task_complete',
      liveLeaseProof: false,
      ownerState: 'confirmed',
      taskStartedTurnId: 'desktop-archive-settled',
      taskCompletedTurnId: 'desktop-archive-settled',
    });
    session.pendingLast = null;
    session._pendingFirstSeenAt = null;
    session._lastStreamedContent = null;
    session.waitingForAssistant = false;
    session.thinking = false;
    session.thinkingLabel = idleActivity.label;
    session.thinkingContent = '';
    session._goalSig = idleActivity.goal ? JSON.stringify(idleActivity.goal) : '';
    session._liveChannelsSig = JSON.stringify({
      thinking: null,
      current: null,
      step: idleActivity.step || null,
      usage: idleActivity.usage || null,
    });
    session.activity = idleActivity;
    selectors.setCodexCachedThinking(sessionId, {
      thinking: false,
      label: idleActivity.label,
      goal: idleActivity.goal || null,
    });
    sessionStore.updateSession(sessionId, { activity: idleActivity });
    if (wasActive || prevKind !== 'idle') {
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', idleActivity));
      this._log('info', `[${sessionId}] Exact Codex Desktop archive completed; publishing idle without waiting for stale DOM activity`);
      if (['generating', 'thinking', 'running_command', 'tool'].includes(prevKind)) {
        this._processMessageQueue(sessionId);
      }
    }
    return true;
  }

  _findMatchingMessageIndex(messages, needle, startAt = 0) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = Math.max(0, startAt); i < list.length; i++) {
      if (this._messagesSoftMatch(list[i], needle)) return i;
    }
    return -1;
  }

  _mergeCodexCompletionCollapse(accumulated, domMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    if (acc.length === 0 || dom.length < 2) return { matched: false, changed: false, messages: acc };

    const domUserIdx = dom.findIndex(m => m && m.role === 'user');
    if (domUserIdx < 0) return { matched: false, changed: false, messages: acc };

    const completionIdx = dom.reduce((last, msg, idx) => (
      this._isCodexCompletionSummaryMessage(msg) ? idx : last
    ), -1);
    if (completionIdx <= domUserIdx) return { matched: false, changed: false, messages: acc };

    const accUserIdx = this._findMatchingMessageIndex(acc, dom[domUserIdx]);
    if (accUserIdx < 0) return { matched: false, changed: false, messages: acc };

    const priorWork = acc.slice(accUserIdx + 1).some(msg =>
      msg &&
      msg.role === 'assistant' &&
      !this._isCodexCompletionSummaryMessage(msg) &&
      this._messageContentText(msg).trim().length > 120
    );
    if (!priorWork) return { matched: false, changed: false, messages: acc };

    let changed = false;
    const merged = acc.slice();
    for (let i = domUserIdx + 1; i < dom.length; i++) {
      const msg = dom[i];
      if (!msg || msg.role !== 'assistant') continue;
      if (!this._isCodexCompletionSummaryMessage(msg)) continue;

      const existingIdx = this._findMatchingMessageIndex(merged, msg, accUserIdx + 1);
      if (existingIdx >= 0) {
        if (this._messageContentText(msg).length > this._messageContentText(merged[existingIdx]).length) {
          merged[existingIdx] = msg;
          changed = true;
        }
        continue;
      }

      merged.push(msg);
      changed = true;
    }

    return { matched: true, changed, messages: merged };
  }

  _mergeCodexSparseTranscriptWindow(accumulated, domMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    if (acc.length === 0 || dom.length === 0) return { matched: false, changed: false, messages: acc };

    const merged = acc.slice();
    let searchStart = 0;
    let matchedCount = 0;
    let matchedUserCount = 0;
    let changed = false;
    let pending = [];

    for (const msg of dom) {
      const existingIdx = this._findMatchingMessageIndex(merged, msg, searchStart);
      if (existingIdx < 0) {
        pending.push(msg);
        continue;
      }

      let matchIdx = existingIdx;
      if (pending.length > 0) {
        merged.splice(existingIdx, 0, ...pending);
        matchIdx = existingIdx + pending.length;
        pending = [];
        changed = true;
      }

      const expanded = this._mergeCodexExpandedToolContent(merged[matchIdx], msg);
      if (this._messageContentText(expanded).length > this._messageContentText(merged[matchIdx]).length) {
        merged[matchIdx] = expanded;
        changed = true;
      }
      searchStart = matchIdx + 1;
      matchedCount++;
      if (msg.role === 'user') matchedUserCount++;
    }

    if (matchedCount === 0) return { matched: false, changed: false, messages: acc };
    if (dom.length >= 12) {
      const requiredMatches = Math.max(2, Math.floor(dom.length * 0.08));
      if (matchedCount < requiredMatches) return { matched: false, changed: false, messages: acc };
      if (dom.some(msg => msg && msg.role === 'user') && matchedUserCount === 0) {
        return { matched: false, changed: false, messages: acc };
      }
    }

    if (pending.length > 0) {
      merged.push(...pending);
      changed = true;
    }

    return { matched: true, changed, messages: merged };
  }

  _shouldReplaceCodexDesktopAccumulatorWithFreshWindow(accumulated, domMessages) {
    const acc = Array.isArray(accumulated) ? accumulated : [];
    const dom = Array.isArray(domMessages) ? domMessages : [];
    if (acc.length === 0 || dom.length < 40) return false;
    if (this._codexDesktopLooksCollapsed(dom)) return false;
    if (this._transcriptWindowOffset(acc, dom) >= 0) return false;

    // If the current native window is already large and overlaps most of the
    // accumulated transcript, prefer the fresh native shape. This repairs
    // persisted Codex Desktop history created by older coarse readers without
    // discarding genuinely longer retained history.
    const maxReplaceSlack = Math.max(60, Math.floor(dom.length * 0.35));
    if (acc.length > dom.length + maxReplaceSlack) return false;

    let searchStart = 0;
    let matchedCount = 0;
    for (const msg of dom) {
      const idx = this._findMatchingMessageIndex(acc, msg, searchStart);
      if (idx < 0) continue;
      matchedCount++;
      searchStart = idx + 1;
    }

    const matchedEnough = matchedCount >= Math.max(24, Math.floor(dom.length * 0.6));
    const staleExtras = acc.length - matchedCount;
    return matchedEnough && staleExtras >= Math.max(8, Math.floor(dom.length * 0.08));
  }

  _extractToolBlocks(content) {
    const text = this._messageContentText({ content });
    const blocks = [];
    const re = /\[([^\]\n]+)\]\n([\s\S]*?)\n?\[end\]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      blocks.push({
        raw: match[0],
        name: String(match[1] || '').trim(),
        body: String(match[2] || '').trim(),
      });
    }
    return blocks;
  }

  _extractStructuredCodexToolBlocks(msg) {
    const blocks = Array.isArray(msg?.content_blocks) ? msg.content_blocks : [];
    return blocks.map(block => {
      if (!block || typeof block !== 'object') return null;
      if (block.command) {
        return {
          raw: null,
          name: `Bash ${block.command}`,
          body: [block.stdout || '', block.stderr || '', block.exit_code != null ? `exit code: ${block.exit_code}` : '']
            .filter(Boolean)
            .join('\n')
            .trim(),
        };
      }
      if (Array.isArray(block.files) && block.files.length > 0) {
        const file = block.files.find(f => f && (f.path || f.file)) || {};
        return {
          raw: null,
          name: `Edit ${file.path || file.file || ''}`.trim(),
          body: this._messageContentText({ content_blocks: [block] }).trim(),
        };
      }
      return null;
    }).filter(Boolean);
  }

  _extractCodexToolBlocks(msg) {
    return [
      ...this._extractToolBlocks(this._messageContentText(msg)),
      ...this._extractStructuredCodexToolBlocks(msg),
    ];
  }

  _codexToolKeySet(msg) {
    const keys = new Set();
    for (const block of this._extractCodexToolBlocks(msg)) {
      const key = this._codexToolKey(block);
      if (key) keys.add(key);
    }
    return keys;
  }

  _codexToolKeysSoftMatch(leftMsg, rightMsg) {
    const left = this._codexToolKeySet(leftMsg);
    const right = this._codexToolKeySet(rightMsg);
    if (left.size === 0 || right.size === 0) return false;
    let overlap = 0;
    for (const key of left) if (right.has(key)) overlap++;
    return overlap >= Math.max(1, Math.min(left.size, right.size));
  }

  _codexToolKey(block) {
    if (!block || !block.name) return '';
    const name = block.name.replace(/\s+/g, ' ').trim();
    const bash = name.match(/^Bash\s+(.+)$/i);
    if (bash) {
      return `bash:${bash[1]
        .replace(/\s+for\s+\d+(?:ms|s|m)\s*$/i, '')
        .replace(/^Ran\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()}`;
    }
    const edit = name.match(/^(Edit|Write|Read|Created|Deleted)\s+(.+)$/i);
    if (edit) {
      return `file:${edit[2].replace(/\s+/g, ' ').trim().toLowerCase()}`;
    }
    return '';
  }

  _isRicherCodexToolBody(previous, next) {
    const prevBody = String(previous?.body || '').trim();
    const nextBody = String(next?.body || '').trim();
    if (!prevBody) return false;
    if (!nextBody) return true;
    const prevDiff = /(^|\n)(\+|-|@@)/.test(prevBody);
    const nextDiff = /(^|\n)(\+|-|@@)/.test(nextBody);
    if (prevDiff && !nextDiff) return true;
    return prevBody.length > nextBody.length + 80;
  }

  _mergeCodexExpandedToolContent(previousMsg, nextMsg) {
    if (!previousMsg || !nextMsg || previousMsg.role !== 'assistant' || nextMsg.role !== 'assistant') return nextMsg;
    const previousContent = this._messageContentText(previousMsg);
    const nextContent = this._messageContentText(nextMsg);
    if (!previousContent || !nextContent || previousContent === nextContent) return nextMsg;

    const previousBlocks = this._extractCodexToolBlocks(previousMsg);
    const nextBlocks = this._extractCodexToolBlocks(nextMsg);
    if (previousBlocks.length === 0 || nextBlocks.length === 0) return nextMsg;

    const previousByKey = new Map();
    for (const block of previousBlocks) {
      const key = this._codexToolKey(block);
      if (!key) continue;
      const existing = previousByKey.get(key);
      if (!existing || this._isRicherCodexToolBody(block, existing)) previousByKey.set(key, block);
    }

    let merged = nextContent;
    let changed = false;
    for (const block of nextBlocks) {
      const key = this._codexToolKey(block);
      const previous = key ? previousByKey.get(key) : null;
      if (!previous || !block.raw || !this._isRicherCodexToolBody(previous, block)) continue;
      merged = merged.replace(block.raw, previous.raw);
      changed = true;
    }

    if (!changed) return nextMsg;
    return { ...nextMsg, content: merged };
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (!this.relayReady || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return;
      const requestId = `hb_${Date.now()}`;
      this.relayWs.send(JSON.stringify(proto.heartbeat(this.connectionId, requestId)));
    }, this.hbIntervalMs);
  }

  _stopHeartbeat() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
  }

  // ─── Session broadcast ───────────────────────────────────────────────

  _promoteSessionChatTitle(sessionId, session, messages = null, nativeTitle = null) {
    if (!session || session._newChatPending) {
      return false;
    }
    const stored = sessionStore.getSession(sessionId) || {};
    const effectiveMessages = Array.isArray(messages)
      ? messages
      : Array.isArray(session._accumulatedMessages)
        ? session._accumulatedMessages
        : Array.isArray(stored.accumulated_messages)
          ? stored.accumulated_messages
          : [];
    const selected = selectDurableChatTitleDetails({
      nativeTitle: [
        nativeTitle,
        session.agentType === 'codex-desktop' || session.agentType === 'cursor'
          ? session._activeThreadTitle : null,
        session._activeChatTitle,
        session.native_chat_title,
      ],
      currentTitle: session.chat_title,
      currentSource: session.chat_title_source,
      storedTitle: stored.chat_title,
      storedSource: stored.chat_title_source,
      messages: effectiveMessages,
    });
    if (!selected.title) return false;
    if (session.chat_title === selected.title && session.chat_title_source === selected.source) return false;
    const previous = session.chat_title || '';
    session.chat_title = selected.title;
    session.chat_title_source = selected.source;
    sessionStore.updateSession(sessionId, {
      chat_title: selected.title,
      chat_title_source: selected.source,
    });
    this._log('info', `[${sessionId}] Promoted chat title (${selected.source}): "${previous}" -> "${selected.title}"`);
    return true;
  }

  _buildFleetSummary(session) {
    if (!session?.session_id) return {};
    const stored = sessionStore.getSession(session.session_id) || {};
    const previous = session._fleetSummary || stored.fleet_summary || null;
    const messages = Array.isArray(session._accumulatedMessages)
      ? session._accumulatedMessages
      : Array.isArray(stored.accumulated_messages) ? stored.accumulated_messages : [];
    const summary = buildProducerFleetSummary({
      sessionId: session.session_id,
      session,
      messages,
      previous,
    });
    if (!summary) return previous ? projectFleetSummary(previous) : {};
    session._fleetSummary = summary;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(summary)) {
      sessionStore.updateSession(session.session_id, { fleet_summary: summary });
    }
    return projectFleetSummary(summary);
  }

  _buildSessionMetas() {
    return Array.from(this.sessions.values()).map(s => {
      this._promoteSessionChatTitle(s.session_id, s);
      const fleetProjection = this._buildFleetSummary(s);
      const activity = fleetProjection.fleet_work_context && !s.activity?.work_context
        ? { ...(s.activity || { kind: 'idle', label: '' }), work_context: fleetProjection.fleet_work_context }
        : s.activity;
      return ({
      session_id:       s.session_id,
      agent_type:       s.agentType,
      host_type:        s.host_type || null,
      host_label:       s.host_label || null,
      display_name:     s.display_name,
      window_title:     s.windowTitle,
      workspace_name:   s.workspace_name,
      workspace_path:   s.workspace_path,
      panel_title:      s.panel_title || null,
      panel_mode:       s.panel_mode || null,
      panel_model:      s.panel_model || null,
      panel_agent:      s.panel_agent || null,
      visible_pane_title:    s.visible_pane_title || null,
      visible_pane_agent:    s.visible_pane_agent || null,
      visible_pane_location: s.visible_pane_location || null,
      visible_pane_visible:  s.visible_pane_visible || false,
      machine_label:    s.machine_label,
      target_signature: s.target_signature,
      chat_title:       s.chat_title || null,
      chat_title_source: s.chat_title_source || null,
      codex_desktop_active_thread_title: s.agentType === 'codex-desktop'
        ? (s._activeThreadTitle || null) : null,
      cursor_agent_title: s.agentType === 'cursor'
        ? (s._activeThreadTitle || s.chat_title || null) : null,
      cursor_agent_id:  s.cursorAgentId || null,
      cursor_workspace_key: s.cursorWorkspaceKey || null,
      cursor_native_status: s.nativeStatus || null,
      cursor_native_working: s.nativeWorking === true,
      status:           s.status,
      activity,
      last_seen_at:     s.last_seen_at,
      rate_limited_until: s.rate_limited_until || null,
      rate_limit_active:  s.rateLimitActive    || false,
      percent_used:       s.percentUsed        ?? null,
      auto_approve_permissions: !!s.autoApprovePermissions,
      active_quota_model: s.activeQuotaModel   || null,
      available_ai_credits: s.availableAiCredits ?? null,
      antigravity_quota_models: Array.isArray(s.antigravityQuotaModels) ? s.antigravityQuotaModels : null,
      antigravity_quota_source: s.antigravityQuotaSource || null,
      antigravity_quota_fetched_at: s.antigravityQuotaFetchedAt || null,
      antigravity_quota_next_refresh_at: s.antigravityQuotaNextRefreshAt || null,
      is_list_view:       s._panelEmpty        || s._listView || false,
      is_new_chat_draft:  !!s._newChatPending,
      ...sessionNoiseMetadata(s),
      ...(s.cliSessionId ? { cli_session_id: s.cliSessionId } : {}),
      ...(s.model_id ? { model_id: s.model_id } : {}),
      ...(s.permission_mode ? { permission_mode: s.permission_mode } : {}),
      ...(Array.isArray(s._lastChatList) ? { chat_list: s._lastChatList } : {}),
      ...fleetProjection,
      });
    });
  }

  _sendSessionMetaBackfill() {
    const allSessions = sessionStore.getAllSessions();
    if (allSessions.length === 0) return;
    const backfill = allSessions
      .filter(s => s.workspace_path || s.workspace_name || s.cli_session_id)
      .map(s => ({
        session_id:     s.session_id,
        workspace_path: s.workspace_path || null,
        project_root:   s.project_root || null,
        workspace_name: s.workspace_name || null,
        agent_type:     s.agent_type || null,
        cli_session_id: s.cli_session_id || null,
        ...sessionNoiseMetadata(s),
      }));
    if (backfill.length === 0) return;
    this._log('info', `[relay] Sending session_meta backfill for ${backfill.length} sessions`);
    this._sendToRelay({ type: 'session_meta_backfill', protocol_version: proto.PROTOCOL_VERSION, sessions: backfill });
  }

  _broadcastSessionSnapshot() {
    if (this._snapshotTimer) return;
    this._snapshotTimer = setTimeout(() => {
      this._snapshotTimer = null;
      const metas = this._buildSessionMetas();
      const snapshotSig = this._sessionSnapshotSignature(metas);
      if (snapshotSig === this._lastSessionSnapshotSig) return;
      this._lastSessionSnapshotSig = snapshotSig;
      this._log('info', `[snapshot] Broadcasting ${metas.length} sessions: ${metas.map(m => m.session_id.substring(0,8) + '(' + m.agent_type + ')').join(', ')}`);
      this._sendToRelay(proto.sessionSnapshot(metas, this.openWorkspaces, this.PROXY_ID));
    }, 250);
    this._snapshotTimer.unref?.();
  }

  // ─── Ephemeral CDP polling (Continue) ─────────────────────────────────
  //
  // Continue iframe targets in Electron/Antigravity steal focus and reset
  // scroll position when Runtime.evaluate is called on a persistent CDP
  // connection (the execution context stays "active").
  //
  // Fix: for Continue sessions, open a fresh CDP connection per poll,
  // perform all reads, then immediately disconnect.  This prevents the
  // webview from staying activated between polls.

  _isEphemeralIframeAgent(agentType) {
    // Claude used to use ephemeral CDP to avoid focus-stealing, but creating a
    // fresh CDP WebSocket connection every poll tick itself steals focus in
    // Electron (debugger attach activates the target).  With the persistent-
    // connection path now:
    //   - using cached inner contextId (no active-frame.contentDocument access)
    //   - passive executionContextCreated watcher (auto-recovers on reload)
    //   - silent:true + userGesture:false on all evaluate calls
    //   - no synthetic click dispatches in _expandOutputDetails
    // persistent CDP should no longer cause focus steal for Claude sessions.
    // Continue, Continue YOLO, and Roo Code remain ephemeral because they show
    // distinct focus-stealing symptoms there.
    return agentType === 'continue' || agentType === 'continue_yolo' || agentType === 'roo_code' || agentType === 'cline';
  }

  async _ephemeralCdpPoll(session, sessionId, options = {}) {
    const { includeConfig = false, includeRateLimit = false, forceRefreshContext = false } = options;
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    let client;
    try {
      this._log('info', `[${sessionId}] [${focusTag}] poll attach:start target=${session.targetId}`);
      client = await CDP({ port: session._cdpPort || this.CDP_PORTS[0], target: session.targetId });
      client.Runtime._webviewId = session._webviewId || null;
      await this._primeEphemeralIframeRuntime(session, client.Runtime, forceRefreshContext);

      let raw      = await selectors.readMessages(client.Runtime, session.agentType, sessionId);
      let thinking = await selectors.detectThinking(client.Runtime, session.agentType);
      const sessionTitle = session.agentType === 'claude'
        ? await selectors.readClaudeSessionTitle(client.Runtime).catch(() => null)
        : null;
      const perm   = await selectors.detectPermissionDialog(client.Runtime, session.agentType);
      const errorPrompt = await selectors.detectSessionErrorPrompt(client.Runtime, session.agentType).catch(() => null);
      const config = includeConfig
        ? await selectors.readAgentConfig(client.Runtime, session.agentType, session.workspace_path).catch(() => null)
        : null;
      const taskList = (session.agentType === 'roo_code' || session.agentType === 'cline')
        ? await selectors.readRooCodeTaskList(client.Runtime).catch(() => null)
        : null;
      const contextUsage = session.agentType === 'cline'
        ? await selectors.readClineContextUsage(client.Runtime).catch(() => null)
        : session.agentType === 'roo_code'
          ? await selectors.readRooCodePromptView(client.Runtime).catch(() => null)
          : null;
      const rateLimit = includeRateLimit
        ? await selectors.readClaudeRateLimit(client.Runtime).catch(() => null)
        : null;

      if (raw === JSON.stringify([]) && (session.lastObservedCount || 0) > 0) {
        await this._primeEphemeralIframeRuntime(session, client.Runtime, true);
        raw = await selectors.readMessages(client.Runtime, session.agentType, sessionId);
        thinking = await selectors.detectThinking(client.Runtime, session.agentType);
      }

      return { raw, thinking, sessionTitle, perm, errorPrompt, config, taskList, contextUsage, rateLimit };
    } finally {
      this._log('info', `[${sessionId}] [${focusTag}] poll attach:end`);
      await this._safeClose(client);
    }
  }

  async _withEphemeralIframeClient(session, work, reason = 'unknown') {
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    const priorityControl = /^(send_message|new_chat|interrupt|permission_response|error_prompt_action|set_model|set_mode|set_permission_mode)$/.test(reason);
    if (priorityControl) {
      this._priorityControlInFlight = (this._priorityControlInFlight || 0) + 1;
    }
    let client;
    try {
      this._log('info', `[${session.session_id}] [${focusTag}] client attach:start reason=${reason} target=${session.targetId}`);
      client = await CDP({ port: session._cdpPort || this.CDP_PORTS[0], target: session.targetId });
      client.Runtime._webviewId = session._webviewId || null;
      await this._primeEphemeralIframeRuntime(session, client.Runtime);
      return await work(client);
    } finally {
      this._log('info', `[${session.session_id}] [${focusTag}] client attach:end reason=${reason}`);
      await this._safeClose(client);
      if (priorityControl) {
        this._priorityControlInFlight = Math.max(0, (this._priorityControlInFlight || 1) - 1);
      }
    }
  }

  _hasLatencySensitiveQuestionWindow(now = Date.now()) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this._isCodexVsCodeQuestionLatencyWindow(sessionId, session, now)) {
        return true;
      }
      if (session?.agentType === 'codex-desktop'
          && this._isCodexDesktopQuestionLatencyWindow(sessionId, session, now)) {
        return true;
      }
    }
    return false;
  }

  async _runBackgroundMaintenanceStep(label, work, options = {}) {
    // Yield once before synchronous discovery/summary work. A relay control
    // already queued on the event loop can then claim the priority lane before
    // maintenance starts instead of waiting behind a multi-second scan.
    await new Promise(resolve => setImmediate(resolve));
    const priorityControlActive = (this._priorityControlInFlight || 0) > 0;
    const questionLatencyActive = options.deferForQuestionLatency === true
      && this._hasLatencySensitiveQuestionWindow();
    if (priorityControlActive || questionLatencyActive) {
      const now = Date.now();
      if (!this._lastPriorityMaintenanceDeferralAt || now - this._lastPriorityMaintenanceDeferralAt >= 30000) {
        this._lastPriorityMaintenanceDeferralAt = now;
        this._log(
          'info',
          `[poll] Deferring ${label}; ${priorityControlActive
            ? 'user control is in flight'
            : 'native question latency lane is active'}`,
        );
      }
      return false;
    }
    await work();
    return true;
  }

  _scheduleBackgroundMaintenanceStep(label, work, options = {}) {
    if (!this._backgroundMaintenanceInFlight) this._backgroundMaintenanceInFlight = new Map();
    if (this._backgroundMaintenanceInFlight.has(label)) return false;
    const startedAt = Date.now();
    const pending = this._runBackgroundMaintenanceStep(label, work, options)
      .then(ran => {
        if (ran) {
          const durationMs = Date.now() - startedAt;
          if (durationMs >= 2000) {
            this._log('info', `[poll] Background ${label} completed in ${durationMs}ms`);
          }
        }
        return ran;
      })
      .catch(error => {
        this._log('warn', `[poll] Background ${label} failed: ${error.message}`);
        return false;
      })
      .finally(() => {
        if (this._backgroundMaintenanceInFlight.get(label) === pending) {
          this._backgroundMaintenanceInFlight.delete(label);
        }
      });
    this._backgroundMaintenanceInFlight.set(label, pending);
    return true;
  }

  async _primeEphemeralIframeRuntime(session, Runtime, forceRefresh = false) {
    const focusTag = session.agentType === 'claude' ? 'claude-focus' : 'continue-focus';
    const cachedContextId = session._iframeInnerContextId || session._continueInnerContextId || null;
    if (!forceRefresh && cachedContextId) {
      Runtime._innerContextId = cachedContextId;
      return cachedContextId;
    }
    this._log('info', `[${session.session_id}] [${focusTag}] context cache:start force=${forceRefresh}`);
    const contextId = await selectors.cacheInnerContextId(Runtime);
    if (contextId) {
      session._iframeInnerContextId = contextId;
      session._continueInnerContextId = contextId;
      Runtime._innerContextId = contextId;
    } else if (cachedContextId) {
      Runtime._innerContextId = cachedContextId;
    }
    this._log('info', `[${session.session_id}] [${focusTag}] context cache:end resolved=${Runtime._innerContextId || 'null'}`);
    return Runtime._innerContextId || null;
  }

  async _withWorkbenchClient(session, work) {
    const cdpPort = session._cdpPort || this.CDP_PORTS[0];
    const targets = await CDP.List({ port: cdpPort });
    const workbenchPages = targets.filter(t =>
      t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    if (workbenchPages.length === 0) {
      throw new Error('No workbench page found');
    }

    let workbenchTarget = workbenchPages[0];
    if (session.parentId) {
      for (const page of workbenchPages) {
        let pageClient;
        try {
          pageClient = await CDP({ port: cdpPort, target: page.id });
          await pageClient.Runtime.enable();
          const res = await pageClient.Runtime.evaluate({
            expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
            returnByValue: true,
          });
          await pageClient.close();
          if (res.result?.value === session.parentId) {
            workbenchTarget = page;
            break;
          }
        } catch {
          if (pageClient) try { await pageClient.close(); } catch {}
        }
      }
    }

    let client;
    try {
      client = await CDP({ port: cdpPort, target: workbenchTarget.id });
      await client.Runtime.enable();
      return await work(client);
    } finally {
      await this._safeClose(client);
    }
  }

  async _withAntigravitySettingsClient(work) {
    let lastFailure = null;
    for (const cdpPort of this.CDP_PORTS) {
      let targets;
      try {
        targets = await this._withTimeout(
          CDP.List({ port: cdpPort }),
          3000,
          'CDP.List for Antigravity quota page on ' + cdpPort
        );
      } catch {
        continue;
      }
      const settingsPages = targets.filter(t => {
        if (t.type !== 'page' || !t.url) return false;
        if (t.title === 'Settings' && t.url.includes('workbench-jetski-agent')) return true;
        if (t.title !== 'Antigravity') return false;
        try {
          const url = new URL(t.url);
          return ['http:', 'https:'].includes(url.protocol)
            && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
            && url.pathname === '/';
        } catch {
          return false;
        }
      });
      for (const settingsPage of settingsPages) {
        let client;
        try {
          client = await this._withTimeout(
            CDP({ port: cdpPort, target: settingsPage.id }),
            4000,
            'CDP attach Antigravity quota page on ' + cdpPort
          );
          await this._withTimeout(client.Runtime.enable(), 3000, 'Runtime.enable Antigravity quota');
          // The callback is read-only. It may inspect a protected signed-in
          // page, but must never navigate, focus, click, or refresh it.
          const result = await this._withTimeout(work(client), 8000, 'antigravity quota read');
          if (result) return result;
        } catch (error) {
          lastFailure = error;
          // Continue to the next exact Antigravity candidate/port.
        } finally {
          if (client) {
            try { await this._withTimeout(client.close(), 2000, 'close Antigravity quota client'); } catch {}
          }
        }
      }
    }
    const error = new Error('No readable Antigravity quota source found');
    error.code = lastFailure?.code || 'quota_source_unavailable';
    throw error;
  }

  _normalizeAntigravityModelName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  _findAntigravityQuotaEntry(session, snapshot) {
    const models = Array.isArray(snapshot?.models) ? snapshot.models : [];
    if (models.length === 0) return null;
    const currentModel = session._currentModelId || session.panel_model || null;
    if (!currentModel) return null;

    const target = this._normalizeAntigravityModelName(currentModel);
    if (!target) return null;

    let best = null;
    let bestScore = -1;
    for (const entry of models) {
      const candidate = this._normalizeAntigravityModelName(entry?.model);
      if (!candidate) continue;
      let score = -1;
      if (candidate === target) score = 1000;
      else if (candidate.includes(target) || target.includes(candidate)) score = Math.min(candidate.length, target.length);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  _applyAntigravityQuotaSnapshot(snapshot) {
    let changed = false;
    for (const session of this.sessions.values()) {
      if (!['antigravity', 'antigravity_panel', 'antigravity-v2', 'gemini'].includes(session.agentType)) continue;
      const entry = this._findAntigravityQuotaEntry(session, snapshot);
      const nextPct = entry?.percent_used ?? null;
      const nextReset = entry?.resets_at || entry?.refreshes_in || null;
      const nextCredits = snapshot?.available_ai_credits ?? null;
      const nextActiveModel = entry?.model || null;
      const nextSource = this._antigravityQuotaCache.source || snapshot?.source || null;
      const nextFetchedAt = snapshot?.fetched_at || null;
      const nextRefreshAt = Number.isFinite(this._antigravityQuotaCache.nextRefreshAt)
        ? new Date(this._antigravityQuotaCache.nextRefreshAt).toISOString()
        : null;
      const nextQuotaModels = Array.isArray(snapshot?.models)
        ? snapshot.models.map(model => ({
            model: model?.model || null,
            refreshes_in: model?.refreshes_in || null,
            resets_at: model?.resets_at || null,
            window_kind: model?.window_kind || null,
            percent_used: model?.percent_used ?? null,
            percent_remaining: model?.percent_remaining ?? null,
            color: model?.color || null,
          }))
        : null;
      if ((session.percentUsed ?? null) !== nextPct) {
        session.percentUsed = nextPct;
        changed = true;
      }
      if ((session.activeQuotaModel || null) !== nextActiveModel) {
        session.activeQuotaModel = nextActiveModel;
        changed = true;
      }
      if ((session.rate_limited_until || null) !== nextReset) {
        session.rate_limited_until = nextReset;
        changed = true;
      }
      if ((session.availableAiCredits ?? null) !== nextCredits) {
        session.availableAiCredits = nextCredits;
        changed = true;
      }
      if (JSON.stringify(session.antigravityQuotaModels || null) !== JSON.stringify(nextQuotaModels)) {
        session.antigravityQuotaModels = nextQuotaModels;
        changed = true;
      }
      if ((session.antigravityQuotaSource || null) !== nextSource) {
        session.antigravityQuotaSource = nextSource;
        changed = true;
      }
      if ((session.antigravityQuotaFetchedAt || null) !== nextFetchedAt) {
        session.antigravityQuotaFetchedAt = nextFetchedAt;
        changed = true;
      }
      if ((session.antigravityQuotaNextRefreshAt || null) !== nextRefreshAt) {
        session.antigravityQuotaNextRefreshAt = nextRefreshAt;
        changed = true;
      }
    }
    if (changed) this._broadcastSessionSnapshot();
    return changed;
  }

  async _refreshAntigravityQuotaUsage(force = false) {
    const hasAntigravitySessions = Array.from(this.sessions.values()).some(s =>
      ['antigravity', 'antigravity_panel', 'antigravity-v2', 'gemini'].includes(s.agentType)
    );
    if (!hasAntigravitySessions) return false;

    if (this._antigravityQuotaRefreshInFlight) return this._antigravityQuotaRefreshInFlight;

    const now = Date.now();
    if (!force && this._antigravityQuotaCache.data && now < this._antigravityQuotaCache.nextRefreshAt) {
      return this._applyAntigravityQuotaSnapshot(this._antigravityQuotaCache.data);
    }

    const refreshRun = (async () => {
      try {
        const priorSourceHistory = Array.isArray(this._antigravityQuotaCache.sourceHistory)
          ? this._antigravityQuotaCache.sourceHistory
          : [];
        const acquisition = await this._withTimeout(
          this._withAntigravitySettingsClient(async client => {
            const internal = await this._withTimeout(
              selectors.readAntigravityInternalQuota(client.Runtime, true),
              18000,
              'read Antigravity in-app quota API',
            );
            if (internal?.ok && Array.isArray(internal.models) && internal.models.length > 0) {
              return {
                snapshot: internal,
                source: 'in_app_api',
                sourceHistory: [
                  ...priorSourceHistory,
                  antigravityQuotaCache.sourceAttempt('official_cli', 'unavailable', 'interactive_tui_only'),
                  antigravityQuotaCache.sourceAttempt('in_app_api', 'ok'),
                ],
              };
            }

            // Existing open Settings surfaces remain a read-only fallback.
            // This does not create, navigate, focus, or click a target.
            const settingsSnapshot = await this._withTimeout(
              selectors.readAntigravityModelQuota(client.Runtime),
              4000,
              'read existing Antigravity quota surface',
            );
            if (settingsSnapshot?.models?.length) {
              return {
                snapshot: { ...settingsSnapshot, source: 'settings_surface' },
                source: 'settings_surface',
                sourceHistory: [
                  ...priorSourceHistory,
                  antigravityQuotaCache.sourceAttempt('official_cli', 'unavailable', 'interactive_tui_only'),
                  antigravityQuotaCache.sourceAttempt('in_app_api', 'unavailable', internal?.code || 'schema_mismatch'),
                  antigravityQuotaCache.sourceAttempt('settings_surface', 'ok'),
                ],
              };
            }
            const sourceError = new Error('Antigravity quota source schema did not match');
            sourceError.code = internal?.code || 'quota_schema_mismatch';
            throw sourceError;
          }),
          // Tier B performs two bounded local RPC reads after its optional
          // refresh RPC. Keep the cap outside the main poll loop as well.
          20000,
          'antigravity quota refresh',
        );
        const cache = antigravityQuotaCache.createCache(acquisition?.snapshot, {
          source: acquisition?.source,
          sourceHistory: acquisition?.sourceHistory,
        });
        if (!cache) {
          const schemaError = new Error('Antigravity quota normalization failed');
          schemaError.code = 'quota_normalization_failed';
          throw schemaError;
        }
        this._antigravityQuotaLastReceipt = acquisition.snapshot?.source_receipt || null;
        this._antigravityQuotaCache = cache;
        antigravityQuotaCache.persistCache(sessionStore, cache);
        return this._applyAntigravityQuotaSnapshot(cache.data);
      } catch (error) {
        if (this._antigravityQuotaCache.data) {
          this._antigravityQuotaCache = antigravityQuotaCache.cacheAfterFailure(
            this._antigravityQuotaCache,
            error?.code || 'refresh_failed',
            Date.now(),
          );
          antigravityQuotaCache.persistCache(sessionStore, this._antigravityQuotaCache);
          return this._applyAntigravityQuotaSnapshot(this._antigravityQuotaCache.data);
        }
        return false;
      }
    })();
    this._antigravityQuotaRefreshInFlight = refreshRun;
    return refreshRun.finally(() => {
      if (this._antigravityQuotaRefreshInFlight === refreshRun) {
        this._antigravityQuotaRefreshInFlight = null;
      }
    });
  }

  _claudeCliPendingTranscriptMessages(session) {
    const workspaceName = session.workspace_name || session.workspaceName || 'the selected workspace';
    const model = session.model_id && session.model_id !== 'default' ? session.model_id : 'Default';
    const permissionMode = session.permission_mode || 'default';
    const effort = session.effort || 'medium';
    const backgroundReady = session.nativeCliStatus === 'background_ready';
    const failedNativeWindow = session.nativeCliStatus === 'native_window_failed';
    const hasNativeWindow = session.nativeCliWindowOpened === true || session.nativeCliStatus === 'native_window_opened';
    const nativeText = backgroundReady
      ? 'This session is ready in background mode. Send the first message to start the hidden CLI runner; no native terminal window will be opened.'
      : failedNativeWindow
      ? 'The proxy tried to open a native Claude Code CLI window, but the native launch reported a failure.'
      : hasNativeWindow
      ? 'A native Claude Code CLI window was opened for this session.'
      : 'This Claude Code CLI session does not have a transcript file yet.';
    return [{
      role: 'assistant',
      content: [
        '**Claude Code CLI is waiting for a native transcript.**',
        '',
        nativeText,
        `Workspace: ${workspaceName}`,
        `Model: ${model}`,
        `Permission mode: ${permissionMode}`,
        `Effort: ${effort}`,
        '',
        ...(backgroundReady ? [] : ['If the native cmd window is showing the Claude workspace trust prompt, choose `1. Yes, I trust this folder` and press Enter there. Claude does not write JSONL transcript messages until that startup prompt is completed.']),
        '',
        'Once Claude creates or updates the transcript file, this placeholder will be replaced with the real CLI chat history.',
      ].join('\n'),
      ts: session.nativeCliStartedAt ? Math.floor(new Date(session.nativeCliStartedAt).getTime() / 1000) : undefined,
    }];
  }

  _claudeCliTrustPrompt(session) {
    const workspacePath = session.workspace_path || session.workspacePath;
    if (claudeCli.isWorkspaceTrusted(workspacePath)) return null;
    if (!workspacePath && session.claudeCliFilePath) return null;
    const workspaceName = session.workspace_name || session.workspaceName || 'the selected workspace';
    return {
      title: 'Claude CLI needs workspace trust',
      message: `Claude CLI is waiting for workspace trust before it can create a transcript for ${workspaceName}.`,
      error_output: session.nativeCliStatus === 'background_ready'
        ? 'Choose Trust workspace here before sending the first background message, or explicitly open the native window if interactive confirmation is needed.'
        : 'The native Claude window is showing the "Quick safety check" prompt. Choose Trust workspace here to send the trust confirmation and reopen the native window.',
      display_mode: 'inline',
      blocking: false,
      actions: [
        { action_id: 'trust_workspace', label: 'Trust workspace' },
        { action_id: 'open_native_window', label: 'Open native window' },
      ],
    };
  }

  _codexCliPendingTranscriptMessages(session) {
    const workspaceName = session.workspace_name || session.workspaceName || 'the selected workspace';
    const observedModel = session.observedModelId || 'unknown';
    const nextModel = session.nextSendModelId || 'unset';
    const permissionMode = session.permission_mode || 'workspace-write';
    const observedEffort = session.observedEffort || 'unknown';
    const nextEffort = session.nextSendEffort || 'unset';
    const backgroundReady = session.nativeCliStatus === 'background_ready';
    return [{
      role: 'assistant',
      content: [
        '**Codex CLI is waiting for a native transcript.**',
        '',
        `Workspace: ${workspaceName}`,
        `Observed model: ${observedModel}`,
        `Next send model: ${nextModel}`,
        `Access: ${permissionMode}`,
        `Observed effort: ${observedEffort}`,
        `Next send effort: ${nextEffort}`,
        '',
        ...(backgroundReady ? ['Background mode is ready. Send the first message to start the hidden Codex CLI runner; no native terminal window will be opened.', ''] : []),
        'Once Codex creates or updates the JSONL transcript file, this placeholder will be replaced with the real CLI chat history.',
      ].join('\n'),
      ts: session.nativeCliStartedAt ? Math.floor(new Date(session.nativeCliStartedAt).getTime() / 1000) : undefined,
    }];
  }

  async _readSessionMessages(session, sessionId) {
    if (session.agentType === 'claude_cli') {
      const messages = session.claudeCliFilePath ? claudeCli.parseClaudeJsonl(session.claudeCliFilePath) : [];
      return JSON.stringify(messages.length > 0 ? messages : this._claudeCliPendingTranscriptMessages(session));
    }
    if (session.agentType === 'codex_cli') {
      const summary = session.codexCliFilePath
        ? codexCli.readSessionSummary(session.codexCliFilePath, this._codexCliActiveSummaryOptions())
        : null;
      const messages = summary?.messages || [];
      return JSON.stringify(messages.length > 0 ? messages : this._codexCliPendingTranscriptMessages(session));
    }
    if (session.agentType === 'cursor_cli') {
      const summary = session.cursorCliFilePath
        ? cursorCli.readSessionSummary(session.cursorCliFilePath, this._cursorCliActiveSummaryOptions())
        : null;
      const messages = summary?.messages || [];
      return JSON.stringify(messages.length > 0 ? messages : this._cursorCliPendingTranscriptMessages(session));
    }
    if (session.agentType === 'cursor' && session._cursorVirtual) {
      return JSON.stringify(Array.isArray(session._accumulatedMessages) ? session._accumulatedMessages : []);
    }
    if (this._isEphemeralIframeAgent(session.agentType)) {
      return this._withEphemeralIframeClient(session, client =>
        selectors.readMessages(client.Runtime, session.agentType, sessionId)
      , 'read_messages');
    }
    return selectors.readMessages(session.client.Runtime, session.agentType, sessionId);
  }

  async _readSessionConfig(session, workspacePath, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    if (session.agentType === 'claude_cli') {
      return {
        model_id: session.model_id || 'default',
        permission_mode: session.permission_mode || 'default',
        effort: session.effort || 'medium',
        file_access_scope: workspacePath || session.workspace_path || 'unknown',
      };
    }
    if (session.agentType === 'codex_cli') {
      return {
        ...this._codexCliConfigPayload(session),
        file_access_scope: workspacePath || session.workspace_path || 'unknown',
      };
    }
    if (session.agentType === 'cursor_cli') {
      return {
        model_id: session.model_id || 'grok-4.5-fast-high',
        permission_mode: session.permission_mode || 'force',
        sandbox: session.sandbox || 'disabled',
        file_access_scope: workspacePath || session.workspace_path || 'unknown',
      };
    }
    if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
      if (!forceRefresh && session._continueConfigCache) {
        return session._continueConfigCache;
      }
      if (session.agentType === 'continue_yolo') {
        const directCfg = await this._withEphemeralIframeClient(session, client =>
          selectors.readAgentConfig(client.Runtime, session.agentType, workspacePath)
        , forceRefresh ? 'read_config_force' : 'read_config').catch(() => null);

        let workbenchCfg = null;
        if (session._webviewId) {
          workbenchCfg = await this._withWorkbenchClient(session, client =>
            selectors.readContinueConfigFromWorkbench(client.Runtime, session._webviewId, workspacePath)
          ).catch(() => null);
        }

        const merged = this._mergeContinueConfigs(directCfg, workbenchCfg);
        if (merged) {
          return this._stabilizeContinueConfig(session, merged) || null;
        }
        return null;
      }
      return this._withEphemeralIframeClient(session, client =>
        selectors.readAgentConfig(client.Runtime, session.agentType, workspacePath)
      , forceRefresh ? 'read_config_force' : 'read_config').then(cfg => {
        if (cfg) {
          cfg = this._stabilizeContinueConfig(session, cfg);
        }
        return cfg || null;
      });
    }
    return selectors.readAgentConfig(session.client.Runtime, session.agentType, workspacePath);
  }

  async _refreshWorkbenchPaneMeta(session) {
    if (!session || !session.parentId) return false;
    try {
      const summary = await this._withWorkbenchClient(session, client =>
        selectors.readWorkbenchPaneSummary(client.Runtime)
      );
      const nextTitle = summary?.auxiliary_title || null;
      const nextAgent = summary?.auxiliary_agent || null;
      const nextVisible = summary?.auxiliary_visible === true;
      const nextLocation = nextVisible ? 'right' : null;
      let changed = false;
      if ((session.visible_pane_title || null) !== nextTitle) {
        session.visible_pane_title = nextTitle;
        changed = true;
      }
      if ((session.visible_pane_agent || null) !== nextAgent) {
        session.visible_pane_agent = nextAgent;
        changed = true;
      }
      if ((session.visible_pane_location || null) !== nextLocation) {
        session.visible_pane_location = nextLocation;
        changed = true;
      }
      if ((session.visible_pane_visible || false) !== nextVisible) {
        session.visible_pane_visible = nextVisible;
        changed = true;
      }
      return changed;
    } catch (e) {
      this._log('warn', `[${session.session_id}] workbench pane meta error: ${e.message}`);
      return false;
    }
  }

  async _sendSessionMessage(session, content, sessionId, sendContext = {}) {
    if (session.agentType === 'claude_cli') {
      return this._sendClaudeCliMessage(session, content, sessionId);
    }
    if (session.agentType === 'codex_cli') {
      return this._sendCodexCliMessage(session, content, sessionId, sendContext);
    }
    if (session.agentType === 'cursor_cli') {
      return this._sendCursorCliMessage(session, content, sessionId);
    }
    if (this._isEphemeralIframeAgent(session.agentType)) {
      return this._withEphemeralIframeClient(session, client =>
        selectors.sendMessage(client.Runtime, session.agentType, content, sessionId, client)
      , 'send_message');
    }
    if (session.agentType === 'cursor' && session._cursorVirtual) {
      const activated = await this._ensureCursorVirtualSessionActive(session);
      if (!activated.ok) {
        return { ok: false, code: 'cursor_agent_not_active', detail: activated.detail || 'Could not activate Cursor agent' };
      }
    }
    return selectors.sendMessage(session.client.Runtime, session.agentType, content, sessionId, session.client, {
      preferBlankComposer: session.agentType === 'cursor' && !!session._newChatPending,
      codexConfirmationClientProvider: session.agentType === 'codex-desktop'
        ? () => this.sessions.get(sessionId)?.client || null
        : null,
    });
  }

  _buildClaudeCliSessionFromSummary(sessionMeta, summary) {
    const now = new Date().toISOString();
    return {
      session_id:       sessionMeta.session_id,
      display_name:     sessionMeta.display_name || 'Claude Code CLI',
      workspace_name:   summary.workspaceName || sessionMeta.workspace_name,
      workspace_path:   summary.workspacePath || sessionMeta.workspace_path,
      machine_label:    sessionMeta.machine_label,
      target_signature: sessionMeta.target_signature,
      chat_title:       summary.title || null,
      client:           null,
      lastMessageCount: summary.messageCount || 0,
      lastObservedCount: summary.messageCount || 0,
      lastTranscriptSig: this._transcriptSignature(summary.messages || []),
      nullPollCount:    0,
      pendingLast:      null,
      resyncCandidateSig: null,
      waitingForAssistant: false,
      thinking:         false,
      thinkingLabel:    '',
      autoApprovePermissions: false,
      status:           'healthy',
      activity:         sessionMeta.activity || { kind: 'idle', label: '', updated_at: now },
      last_seen_at:     summary.updatedAt || now,
      windowTitle:      sessionMeta.window_title || summary.workspaceName || 'Claude Code CLI',
      agentType:        'claude_cli',
      parentId:         null,
      ext:              null,
      targetId:         null,
      cliSessionId:     summary.cliSessionId,
      claudeCliFilePath: summary.filePath,
      claudeCliArchiveDiscovered: sessionMeta.claude_cli_archive_discovered === true,
      nativeCliStartedAt: sessionMeta.native_cli_started_at || summary.nativeCliStartedAt || null,
      nativeCliStatus:    sessionMeta.native_cli_status || summary.nativeCliStatus || null,
      nativeCliWindowOpened: sessionMeta.native_cli_window_opened === true || summary.nativeCliWindowOpened === true,
      model_id:         sessionMeta.model_id || 'default',
      effort:           sessionMeta.effort || 'medium',
      permission_mode:  sessionMeta.permission_mode || 'default',
      _fileTranscriptState: this._fileTranscriptState(
        'claude_cli', summary.filePath, summary.messages || [], summary.sourceCursor || null
      ),
    };
  }

  _registerClaudeCliSession(summary, { sendInitialHistory = true, archiveDiscovered = false } = {}) {
    if (!summary?.cliSessionId) return null;
    const displayName = 'Claude Code CLI';
    const sessionMeta = sessionStore.resolveVirtualSession({
      virtualId: `claude-cli:${summary.cliSessionId}`,
      agentType: 'claude_cli',
      displayName,
      workspaceName: summary.workspaceName,
      workspacePath: summary.workspacePath,
      windowTitle: summary.workspaceName || displayName,
      extra: {
        cli_session_id: summary.cliSessionId,
        claude_cli_file_path: summary.filePath,
        claude_cli_archive_discovered: archiveDiscovered === true,
        chat_title: summary.title || null,
        model_id: summary.model_id || undefined,
        permission_mode: summary.permission_mode || undefined,
        effort: summary.effort || undefined,
        native_cli_started_at: summary.nativeCliStartedAt || undefined,
        native_cli_status: summary.nativeCliStatus || undefined,
        native_cli_window_opened: summary.nativeCliWindowOpened === true || undefined,
      },
    });
    const sessionId = sessionMeta.session_id;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.workspace_name = summary.workspaceName || existing.workspace_name;
      existing.workspace_path = summary.workspacePath || existing.workspace_path;
      existing.chat_title = summary.title || existing.chat_title;
      existing.last_seen_at = summary.updatedAt || existing.last_seen_at;
      existing.claudeCliFilePath = summary.filePath || existing.claudeCliFilePath;
      existing.claudeCliArchiveDiscovered = archiveDiscovered === true;
      existing.cliSessionId = summary.cliSessionId;
      if (summary.model_id) existing.model_id = summary.model_id;
      if (summary.permission_mode) existing.permission_mode = summary.permission_mode;
      if (summary.effort) existing.effort = summary.effort;
      if (summary.nativeCliStartedAt) existing.nativeCliStartedAt = summary.nativeCliStartedAt;
      if (summary.nativeCliStatus) existing.nativeCliStatus = summary.nativeCliStatus;
      if (summary.nativeCliWindowOpened === true) existing.nativeCliWindowOpened = true;
      const summaryMessages = summary.messages || [];
      const effectiveMessages = summaryMessages.length > 0 ? summaryMessages : this._claudeCliPendingTranscriptMessages(existing);
      const sig = this._transcriptSignature(effectiveMessages);
      if (sig !== existing.lastTranscriptSig) {
        existing.lastTranscriptSig = sig;
        existing.lastObservedCount = effectiveMessages.length;
        existing.lastMessageCount = effectiveMessages.length;
        const provisionalStreamActive = this._claudeCliMessageDeltaEnabled()
          && existing._claudeCliChild;
        if (!provisionalStreamActive) {
          this._sendFileBackedTranscriptUpdate(sessionId, existing, effectiveMessages, {
            agentType: 'claude_cli', filePath: summary.filePath,
            sourceCursor: summary.sourceCursor, reason: 'claude cli file changed',
            allowInitialAppend: true,
          });
        }
      }
      return existing;
    }

    const session = this._buildClaudeCliSessionFromSummary(sessionMeta, summary);
    this.sessions.set(sessionId, session);
    this._log('info', `[claude-cli] registered ${sessionId} cli=${summary.cliSessionId} (${summary.messageCount} msgs)`);
    if (sendInitialHistory) {
      const initialMessages = summary.messages?.length ? summary.messages : this._claudeCliPendingTranscriptMessages(session);
      session.lastTranscriptSig = this._transcriptSignature(initialMessages);
      session.lastObservedCount = initialMessages.length;
      session.lastMessageCount = initialMessages.length;
    }
    const cfg = this._decorateAgentConfig(session, this._mergeAgentConfig('claude_cli', null, session.workspace_path));
    this._sendToRelay(proto.agentConfig(sessionId, { ...cfg, capabilities: this._buildCapabilities('claude_cli', session.workspace_path) }));
    return session;
  }

  async _discoverClaudeCliSessions() {
    if (process.env.CLAUDE_CLI_DISCOVER_ARCHIVES !== 'true') {
      if (!this._claudeCliArchiveDiscoveryLogged) {
        this._claudeCliArchiveDiscoveryLogged = true;
        this._log('info', '[claude-cli] archive transcript discovery disabled (set CLAUDE_CLI_DISCOVER_ARCHIVES=true to enable)');
      }
      let changed = false;
      const storedSessions = sessionStore.getAllSessions();
      for (const sess of storedSessions) {
        if (sess.agent_type !== 'claude_cli') continue;
        if (sess.claude_cli_archive_discovered !== true) continue;
        if (sess.status !== 'healthy') continue;
        sessionStore.markDisconnected(sess.session_id);
        changed = true;
      }
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType !== 'claude_cli') continue;
        if (session.claudeCliArchiveDiscovered !== true) continue;
        this.sessions.delete(sessionId);
        changed = true;
      }
      for (const sess of storedSessions) {
        if (sess.agent_type !== 'claude_cli') continue;
        if (sess.status !== 'healthy') continue;
        if (sess.claude_cli_archive_discovered === true) continue;
        if (!sess.cli_session_id) continue;
        if (this.sessions.has(sess.session_id)) continue;

        let messages = [];
        let updatedAt = sess.last_seen_at || new Date().toISOString();
        const filePath = sess.claude_cli_file_path || null;
        if (filePath && fs.existsSync(filePath)) {
          try {
            messages = claudeCli.parseClaudeJsonl(filePath);
            updatedAt = fs.statSync(filePath).mtime.toISOString();
          } catch (e) {
            this._log('warn', `[claude-cli] failed to restore transcript ${filePath}: ${e.message}`);
          }
        }

        const before = this.sessions.size;
        this._registerClaudeCliSession({
          cliSessionId: sess.cli_session_id,
          filePath,
          workspacePath: sess.workspace_path || process.cwd(),
          workspaceName: sess.workspace_name || 'Claude CLI',
          title: sess.chat_title || 'Claude CLI session',
          messages,
          messageCount: messages.length,
          updatedAt,
          model_id: sess.model_id,
          permission_mode: sess.permission_mode,
          effort: sess.effort,
        }, { archiveDiscovered: false });
        if (this.sessions.size !== before) changed = true;
      }
      if (changed) this._broadcastSessionSnapshot();
      return;
    }
    const limit = parseInt(process.env.CLAUDE_CLI_SESSION_LIMIT || '40', 10);
    const summaries = claudeCli.discoverSessions(Number.isFinite(limit) ? limit : 40);
    let changed = false;
    for (const summary of summaries) {
      const before = this.sessions.size;
      this._registerClaudeCliSession(summary, { archiveDiscovered: true });
      if (this.sessions.size !== before) changed = true;
    }
    if (changed) this._broadcastSessionSnapshot();
  }

  _findClaudeCliSummaryByCliId(cliSessionId) {
    if (!cliSessionId) return null;
    if (typeof claudeCli.findSessionByCliId === 'function') {
      return claudeCli.findSessionByCliId(cliSessionId);
    }
    const summaries = claudeCli.discoverSessions(parseInt(process.env.CLAUDE_CLI_SESSION_LIMIT || '80', 10));
    return summaries.find(s => s.cliSessionId === cliSessionId) || null;
  }

  _claudeCliMessageDeltaEnabled() {
    return process.env.RAC_CLAUDE_CLI_MESSAGE_DELTA === 'true';
  }

  _extractClaudeCliStreamText(evt) {
    if (!evt || typeof evt !== 'object') return null;
    if (evt.type === 'stream_event') {
      const event = evt.event || {};
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        const text = event.content_block.text;
        return typeof text === 'string' && text ? { text, cumulative: false } : null;
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = event.delta.text;
        return typeof text === 'string' && text ? { text, cumulative: false } : null;
      }
      return null;
    }
    if (evt.type !== 'assistant') return null;
    const content = evt.message?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
    return text ? { text, cumulative: true } : null;
  }

  _emitClaudeCliMessageDelta(session, sessionId, append, streamTrace) {
    if (!this._claudeCliMessageDeltaEnabled() || typeof append !== 'string' || append.length === 0) return false;
    if (!session._claudeCliDeltaMessageId) {
      session._claudeCliDeltaMessageId = `claude-cli-${crypto.randomUUID()}`;
      session._claudeCliDeltaSeq = 0;
      session._claudeCliDeltaOpen = true;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._claudeCliDeltaMessageId,
        0,
        0,
        'block_open',
      ));
    }
    const chunks = [];
    const maxChunkBytes = 48 * 1024;
    let chunk = '';
    let chunkBytes = 0;
    for (const symbol of append) {
      const symbolBytes = Buffer.byteLength(symbol, 'utf8');
      if (chunk && chunkBytes + symbolBytes > maxChunkBytes) {
        chunks.push(chunk);
        chunk = '';
        chunkBytes = 0;
      }
      chunk += symbol;
      chunkBytes += symbolBytes;
    }
    if (chunk) chunks.push(chunk);
    for (const deltaChunk of chunks) {
      const seq = ++session._claudeCliDeltaSeq;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._claudeCliDeltaMessageId,
        0,
        seq,
        'append',
        deltaChunk,
        { stream_trace: { ...streamTrace, proxy_sent_at_ms: Date.now() } },
      ));
    }
    return true;
  }

  _closeClaudeCliMessageDelta(session, sessionId) {
    if (!this._claudeCliMessageDeltaEnabled() || !session._claudeCliDeltaOpen || !session._claudeCliDeltaMessageId) return false;
    const seq = ++session._claudeCliDeltaSeq;
    this._sendToRelay(proto.messageDelta(
      sessionId,
      session._claudeCliDeltaMessageId,
      0,
      seq,
      'block_close',
    ));
    session._claudeCliDeltaOpen = false;
    return true;
  }

  _handleClaudeCliStreamJsonEvent(session, sessionId, line, proxyReadAtMs = Date.now()) {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    const extracted = this._extractClaudeCliStreamText(evt);
    if (!extracted) return;
    const prior = session._claudeCliLiveText || '';
    const append = extracted.cumulative
      ? (extracted.text.startsWith(prior) ? extracted.text.slice(prior.length) : extracted.text)
      : extracted.text;
    if (!append) return;
    const nextText = extracted.cumulative
      ? (extracted.text.startsWith(prior) ? extracted.text : `${prior}${extracted.text}`)
      : `${prior}${extracted.text}`;
    session._claudeCliLiveText = nextText;
    if (!session._claudeCliLiveStartedAt) session._claudeCliLiveStartedAt = new Date(proxyReadAtMs).toISOString();
    const embeddedNativeAtMs = Number.isFinite(Number(evt.timestamp_ms))
      ? Number(evt.timestamp_ms)
      : Date.parse(evt.timestamp || evt.created_at || '');
    const nativeEventAtMs = Number.isFinite(embeddedNativeAtMs) ? embeddedNativeAtMs : proxyReadAtMs;
    const streamTrace = {
      trace_id: crypto.randomUUID(),
      agent_type: 'claude_cli',
      session_id: sessionId,
      native_event_at_ms: nativeEventAtMs,
      native_timestamp_source: Number.isFinite(embeddedNativeAtMs) ? 'claude_stream_json' : 'claude_stdout_observed',
      proxy_read_at_ms: proxyReadAtMs,
      proxy_normalized_at_ms: Date.now(),
    };
    const streamViaDeltas = this._claudeCliMessageDeltaEnabled();
    this._emitClaudeCliMessageDelta(session, sessionId, append, streamTrace);
    const activity = {
      kind: 'generating',
      label: 'Claude CLI running',
      current: {
        kind: 'answer',
        label: 'Answering',
        ...(streamViaDeltas
          ? { streaming_transport: 'message_delta' }
          : { partial: nextText }),
        since: session._claudeCliLiveStartedAt,
      },
      ...(streamViaDeltas ? {} : { thinkingContent: nextText }),
      updated_at: new Date().toISOString(),
    };
    session.activity = activity;
    const status = proto.proxyStatus(sessionId, session.status || 'healthy', activity);
    status.stream_trace = { ...streamTrace, proxy_sent_at_ms: Date.now() };
    this._sendToRelay(status);
  }

  _sendClaudeCliMessage(session, content, sessionId) {
    if (session._claudeCliChild) {
      return Promise.resolve({ ok: false, code: 'agent_busy', detail: 'Claude CLI process is already running' });
    }
    const cliSessionId = session.cliSessionId || crypto.randomUUID();
    session.cliSessionId = cliSessionId;
    sessionStore.updateSession(sessionId, { cli_session_id: cliSessionId });
    const workspacePath = session.workspace_path || process.cwd();
    const stderrChunks = [];
    let stdoutBuffer = '';
    session._claudeCliLiveText = '';
    session._claudeCliLiveStartedAt = null;
    session._claudeCliDeltaMessageId = null;
    session._claudeCliDeltaSeq = 0;
    session._claudeCliDeltaOpen = false;

    const child = claudeCli.startClaudePrintSession({
      workspacePath,
      cliSessionId,
      resume: !!session.claudeCliFilePath,
      content,
      model: session.model_id,
      effort: session.effort,
      permissionMode: session.permission_mode,
      onStdout: chunk => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const stdoutLine of lines) {
          if (stdoutLine.trim()) this._handleClaudeCliStreamJsonEvent(session, sessionId, stdoutLine);
        }
      },
      onStderr: chunk => {
        if (chunk) stderrChunks.push(chunk);
      },
      onExit: (code, err) => {
        if (session._claudeCliChild === child) session._claudeCliChild = null;
        if (stdoutBuffer.trim()) this._handleClaudeCliStreamJsonEvent(session, sessionId, stdoutBuffer.trim());
        stdoutBuffer = '';
        this._closeClaudeCliMessageDelta(session, sessionId);
        const wasInterrupted = session._claudeCliInterrupted === true;
        session._claudeCliInterrupted = false;
        (async () => {
          let summary = this._findClaudeCliSummaryByCliId(cliSessionId);
          for (let attempt = 0; code === 0 && !summary && attempt < 8; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 250));
            summary = this._findClaudeCliSummaryByCliId(cliSessionId);
          }
          if (summary) {
            session.claudeCliFilePath = summary.filePath;
            session.workspace_path = summary.workspacePath || session.workspace_path;
            session.workspace_name = summary.workspaceName || session.workspace_name;
            session.chat_title = summary.title || session.chat_title;
            session.claudeCliArchiveDiscovered = false;
            this._registerClaudeCliSession(summary, { sendInitialHistory: false });
            const effectiveMessages = summary.messages?.length ? summary.messages : this._claudeCliPendingTranscriptMessages(session);
            session.lastMessageCount = effectiveMessages.length;
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = this._transcriptSignature(effectiveMessages);
          }
          if (!summary && !wasInterrupted && (code !== 0 || err)) {
            const stderr = stderrChunks.join('').trim();
            const detail = stderr || err?.message || `Claude CLI exited with code ${code}`;
            this._sendToRelay(proto.proxyMessage(
              sessionId,
              'assistant',
              `Claude CLI failed to start or complete the request.\n\n${detail}`,
              { created_at: new Date().toISOString() },
            ));
          } else if (!summary && !wasInterrupted) {
            this._sendToRelay(proto.proxyMessage(
              sessionId,
              'assistant',
              'Claude CLI exited without producing a transcript file for this session.',
              { created_at: new Date().toISOString() },
            ));
          }
          const activity = {
            kind: 'idle',
            label: wasInterrupted ? 'Interrupted' : (code === 0 && summary ? '' : 'Claude CLI failed'),
            updated_at: new Date().toISOString(),
          };
          session.activity = activity;
          session.waitingForAssistant = false;
          sessionStore.updateSession(sessionId, {
            activity,
            workspace_path: session.workspace_path || null,
            workspace_name: session.workspace_name || null,
            cli_session_id: cliSessionId,
            claude_cli_file_path: session.claudeCliFilePath || null,
            claude_cli_archive_discovered: false,
          });
          this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
          // A relay send can race the final native process exit and be queued
          // after the last general poll transition. Claude CLI sessions use a
          // dedicated lifecycle path, so drain that queue here once the child
          // is cleared and the session is genuinely idle.
          if (session.messageQueue?.length) {
            await this._processMessageQueue(sessionId);
          }
          if (!wasInterrupted && (code !== 0 || err)) {
            this._log('warn', `[claude-cli] send exited code=${code} err=${err?.message || ''} stderr=${stderrChunks.join('').slice(0, 500)}`);
          }
          this._broadcastSessionSnapshot();
        })().catch(exitErr => {
          this._log('warn', `[claude-cli] send exit handler failed: ${exitErr.message}`);
        });
      },
    });
    session._claudeCliChild = child;
    return Promise.resolve({ ok: true });
  }

  async _pollSessionClaudeCli(sessionId, session) {
    const now = Date.now();
    const shouldLookupTranscript = !session._lastClaudeCliTranscriptLookupAt
      || now - session._lastClaudeCliTranscriptLookupAt >= 10000;
    if (!session.claudeCliFilePath && session.cliSessionId && shouldLookupTranscript) {
      session._lastClaudeCliTranscriptLookupAt = now;
      const summary = this._findClaudeCliSummaryByCliId(session.cliSessionId);
      if (summary?.filePath) {
        session.claudeCliFilePath = summary.filePath;
        session.workspace_path = summary.workspacePath || session.workspace_path;
        session.workspace_name = summary.workspaceName || session.workspace_name;
        session.chat_title = summary.title || session.chat_title;
        session.claudeCliArchiveDiscovered = false;
        sessionStore.updateSession(sessionId, {
          workspace_path: session.workspace_path || null,
          workspace_name: session.workspace_name || null,
          claude_cli_file_path: session.claudeCliFilePath,
          claude_cli_archive_discovered: false,
          chat_title: session.chat_title || null,
        });
      }
    }
    let messages = [];
    let sourceCursor = null;
    let transcriptMaybeChanged = !session.claudeCliFilePath;
    if (session.claudeCliFilePath) {
      const stat = (() => { try { return fs.statSync(session.claudeCliFilePath); } catch { return null; } })();
      const fileSig = stat ? `${stat.mtimeMs}:${stat.size}` : 'missing';
      if (fileSig === session._lastClaudeCliFileSig && Array.isArray(session._lastClaudeCliMessages)) {
        messages = session._lastClaudeCliMessages;
        sourceCursor = session._lastClaudeCliSourceCursor || null;
      } else {
        transcriptMaybeChanged = true;
        const summary = stat ? claudeCli.readSessionSummary(session.claudeCliFilePath) : null;
        messages = summary?.messages || [];
        sourceCursor = summary?.sourceCursor || null;
        session._lastClaudeCliFileSig = fileSig;
        session._lastClaudeCliMessages = messages;
        session._lastClaudeCliSourceCursor = sourceCursor;
      }
    }
    const effectiveMessages = messages.length > 0 ? messages : this._claudeCliPendingTranscriptMessages(session);
    if (transcriptMaybeChanged || !session.lastTranscriptSig) {
      const sig = this._transcriptSignature(effectiveMessages);
      if (sig !== session.lastTranscriptSig) {
        session.lastTranscriptSig = sig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastMessageCount = effectiveMessages.length;
        const provisionalStreamActive = this._claudeCliMessageDeltaEnabled()
          && session._claudeCliChild;
        if (!provisionalStreamActive) {
          this._sendFileBackedTranscriptUpdate(sessionId, session, effectiveMessages, {
            agentType: 'claude_cli', filePath: session.claudeCliFilePath,
            sourceCursor,
            reason: messages.length > 0 ? 'claude cli poll' : 'claude cli pending transcript',
          });
        }
      }
    }
    const kind = session._claudeCliChild ? 'generating' : 'idle';
    const label = session._claudeCliChild ? 'Claude CLI running' : '';
    if (session.activity?.kind !== kind || session.activity?.label !== label) {
      const activity = { kind, label, updated_at: new Date().toISOString() };
      session.activity = activity;
      sessionStore.updateSession(sessionId, { activity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
    } else if (session._claudeCliChild) {
      this._emitActivityObservationHeartbeat(sessionId, session);
    }
    await this._handleSessionErrorPromptState(
      sessionId,
      session,
      this._claudeCliTrustPrompt(session)
    );
  }

  // ─── Continue-specific poll (ephemeral CDP) ─────────────────────────

  _activitySemanticSignature(activity) {
    if (!activity) return '';
    const goal = activity.goal && typeof activity.goal === 'object'
      ? { ...activity.goal, updated_at: undefined }
      : activity.goal || null;
    const goalRun = activity.goal_run && typeof activity.goal_run === 'object'
      ? {
          ...activity.goal_run,
          observed_at: undefined,
          lease_observed_at: undefined,
          source_cursor: undefined,
          source_sequence: undefined,
          native_event_at: undefined,
          evidence_type: undefined,
        }
      : activity.goal_run || null;
    return JSON.stringify({
      ...activity,
      updated_at: undefined,
      started_at: activity.started_at || null,
      goal,
      goal_run: goalRun,
    });
  }

  _emitActivityObservationHeartbeat(sessionId, session, {
    observedAt = new Date().toISOString(),
    minIntervalMs = ACTIVITY_OBSERVATION_HEARTBEAT_MS,
  } = {}) {
    if (!sessionId || !session?.activity) return false;
    const health = String(session.status || '').trim().toLowerCase();
    if (['disconnected', 'dead', 'archived'].includes(health)) return false;
    const kind = String(session.activity.kind || '').trim().toLowerCase();
    if (session.activity.generating !== true && !ACTIVE_ACTIVITY_KINDS.has(kind)) return false;
    const observedAtMs = Date.parse(observedAt);
    if (!Number.isFinite(observedAtMs)) return false;
    const previousObservedAtMs = Math.max(
      Date.parse(session.activity.observed_at || '') || 0,
      Date.parse(session.activity.updated_at || session.activity.updatedAt || '') || 0,
    );
    const boundedIntervalMs = Math.max(1_000, Number(minIntervalMs) || ACTIVITY_OBSERVATION_HEARTBEAT_MS);
    if (previousObservedAtMs > 0 && observedAtMs - previousObservedAtMs < boundedIntervalMs) return false;
    const nextActivity = { ...session.activity, observed_at: observedAt };
    session.activity = nextActivity;
    sessionStore.updateSession(sessionId, { activity: nextActivity });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', nextActivity));
    return true;
  }

  _canonicalGoalForSession(sessionId, session, observedGoal, source = '') {
    const previousGoal = session?._lastCanonicalGoal || session?.activity?.goal || null;
    if (!observedGoal || typeof observedGoal !== 'object') {
      // A missing/temporarily hidden goal chip is not a terminal transition.
      // Retain the last authoritative record until a newer native state arrives.
      return previousGoal;
    }
    const sourceName = source || observedGoal.source || (
      session?.agentType === 'codex_cli'
        ? 'codex_cli_jsonl'
        : (session?.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom')
    );
    const sessionKey = session?.cliSessionId
      || session?.codexDesktopCliSessionId
      || session?.codexDesktopThreadId
      || session?.activeThreadId
      || sessionId;
    const nativeUpdatedAt = ['codex_cli_jsonl', 'codex_cli_goal_controller'].includes(sourceName)
      ? (observedGoal.native_updated_at || null)
      : null;
    const canonical = canonicalGoalRecord(observedGoal, {
      previousGoal,
      sessionKey,
      source: sourceName,
      sourceCursor: observedGoal.native_cursor || observedGoal.source_cursor || null,
      nativeUpdatedAt,
      observedAt: observedGoal.observed_at || new Date().toISOString(),
    });
    if (canonical && previousGoal) {
      const previousGeneration = Math.max(1, Number(previousGoal.generation) || 1);
      const canonicalGeneration = Math.max(1, Number(canonical.generation) || 1);
      const previousState = String(previousGoal.state || previousGoal.status || '').toLowerCase();
      if (canonicalGeneration < previousGeneration
          || (['complete', 'cancelled', 'failed'].includes(previousState)
            && canonical.state === 'active' && canonicalGeneration <= previousGeneration)) {
        return previousGoal;
      }
    }
    if (canonical) session._lastCanonicalGoal = canonical;
    return canonical;
  }

  _codexCliGoalRunOwnerState(session) {
    if (session?._codexAppServerTurn || session?._codexCliChild) {
      session._goalRunOwnerMissingSinceMs = 0;
      session._goalRunOwnerMissingChecks = 0;
      return 'confirmed';
    }
    const probe = codexCli.codexCliSessionOwnerState(session?.cliSessionId, { cacheMs: 750 });
    if (probe.state === 'confirmed') {
      session._goalRunOwnerMissingSinceMs = 0;
      session._goalRunOwnerMissingChecks = 0;
      session._goalRunLastOwnerCheckAtMs = probe.checked_at_ms || Date.now();
      return 'confirmed';
    }
    if (probe.state !== 'missing') return 'ambiguous';
    const checkedAt = Number(probe.checked_at_ms) || Date.now();
    if (checkedAt !== Number(session._goalRunLastOwnerCheckAtMs || 0)) {
      session._goalRunLastOwnerCheckAtMs = checkedAt;
      session._goalRunOwnerMissingChecks = Number(session._goalRunOwnerMissingChecks || 0) + 1;
      if (!session._goalRunOwnerMissingSinceMs) session._goalRunOwnerMissingSinceMs = checkedAt;
    }
    const missingForMs = checkedAt - Number(session._goalRunOwnerMissingSinceMs || checkedAt);
    return session._goalRunOwnerMissingChecks >= 2 && missingForMs >= 1500 ? 'gone' : 'ambiguous';
  }

  async _ensureCodexCliGoalMonitorConnection() {
    const current = this._codexCliGoalMonitorConnection;
    if (current?._racGoalMonitorReady === true && current.disconnected !== true) return current;
    if (this._codexCliGoalMonitorStartPromise) return this._codexCliGoalMonitorStartPromise;
    const factory = this._codexCliGoalMonitorConnectionFactory
      || (options => new CodexAppServerConnection(options));
    const connection = factory({
      sessionId: `goal-monitor-${this.PROXY_ID || crypto.randomUUID()}`,
      cwd: process.cwd(),
      clientName: 'remote-agent-chat-goal-monitor',
      clientVersion: '1.0.0',
      requestTimeoutMs: Number(this.CODEX_CLI_GOAL_MONITOR_REQUEST_TIMEOUT_MS || 1800),
    });
    this._codexCliGoalMonitorConnection = connection;
    connection.on?.('disconnect', () => {
      connection._racGoalMonitorReady = false;
      if (this._codexCliGoalMonitorConnection === connection) {
        this._codexCliGoalMonitorConnection = null;
      }
    });
    const startPromise = Promise.resolve(connection.start()).then(() => {
      if (this._codexCliGoalMonitorConnection !== connection) {
        throw new Error('Codex goal monitor was superseded during startup');
      }
      connection._racGoalMonitorReady = true;
      return connection;
    }).catch(async error => {
      connection._racGoalMonitorReady = false;
      if (this._codexCliGoalMonitorConnection === connection) {
        this._codexCliGoalMonitorConnection = null;
      }
      try { await connection.stop?.(); } catch {}
      throw error;
    }).finally(() => {
      if (this._codexCliGoalMonitorStartPromise === startPromise) {
        this._codexCliGoalMonitorStartPromise = null;
      }
    });
    this._codexCliGoalMonitorStartPromise = startPromise;
    return startPromise;
  }

  async _stopCodexCliGoalMonitor() {
    const pending = this._codexCliGoalMonitorStartPromise;
    let connection = this._codexCliGoalMonitorConnection;
    this._codexCliGoalMonitorConnection = null;
    this._codexCliGoalMonitorStartPromise = null;
    if (pending) {
      try { connection = await pending; } catch {}
    }
    if (!connection) return;
    connection._racGoalMonitorReady = false;
    try { await connection.stop?.(); } catch {}
  }

  _codexCliGoalControllerIso(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
    const number = Number(value);
    if (Number.isFinite(number) && String(value).trim() !== '') {
      const ms = number < 1e12 ? number * 1000 : number;
      return new Date(ms).toISOString();
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  _canonicalCodexCliControllerGoal(sessionId, session, nativeGoal, observedAt) {
    if (!nativeGoal || typeof nativeGoal !== 'object') return null;
    const objective = String(nativeGoal.objective || '').trim();
    if (!objective) return null;
    const sessionKey = String(session?.cliSessionId || sessionId || '').trim();
    const createdAt = this._codexCliGoalControllerIso(nativeGoal.createdAt ?? nativeGoal.created_at);
    const updatedAt = this._codexCliGoalControllerIso(nativeGoal.updatedAt ?? nativeGoal.updated_at);
    const objectiveHash = crypto.createHash('sha256').update(objective, 'utf8').digest('hex');
    const previousGoal = session?._lastCanonicalGoal || session?.activity?.goal || null;
    const previousGeneration = Math.max(1, Number(previousGoal?.generation) || 1);
    const fingerprint = `goal:${crypto.createHash('sha256').update([
      sessionKey,
      objectiveHash,
      createdAt || `generation:${previousGeneration}`,
    ].join('\u0000')).digest('hex').slice(0, 40)}`;
    const generation = previousGoal
      ? (String(previousGoal.fingerprint || '') === fingerprint
        ? previousGeneration
        : previousGeneration + 1)
      : 1;
    const nativeState = String(nativeGoal.status || nativeGoal.state || '').trim() || 'active';
    const controllerCursor = {
      kind: 'codex_cli_goal_controller',
      signature: crypto.createHash('sha256')
        .update(`${nativeState}\u0000${updatedAt || createdAt || fingerprint}`)
        .digest('hex')
        .slice(0, 32),
    };
    return this._canonicalGoalForSession(sessionId, session, {
      objective,
      objective_hash: objectiveHash,
      fingerprint,
      generation,
      raw_state: nativeState,
      state: nativeState,
      status: nativeState,
      created_at: createdAt,
      native_updated_at: updatedAt,
      observed_at: observedAt,
      native_cursor: controllerCursor,
      time_used_seconds: Math.max(0, Number(nativeGoal.timeUsedSeconds ?? nativeGoal.time_used_seconds) || 0),
      tokens_used: Math.max(0, Number(nativeGoal.tokensUsed ?? nativeGoal.tokens_used) || 0),
      source: 'codex_cli_goal_controller',
    }, 'codex_cli_goal_controller');
  }

  _codexCliGoalControllerActivity(session, goal, observedAt) {
    const state = String(goal?.state || '').toLowerCase();
    const previous = session?.activity && typeof session.activity === 'object'
      ? session.activity
      : { kind: 'idle', label: '' };
    let kind = previous.kind || 'idle';
    let label = previous.label || '';
    if (state === 'paused' || ['complete', 'cancelled'].includes(state)) {
      kind = 'idle';
      label = goal.label || '';
    } else if (state === 'failed') {
      kind = 'failed';
      label = goal.label || 'Goal failed';
    } else if (state === 'blocked') {
      kind = 'blocked';
      label = goal.label || 'Goal blocked';
    } else if (state === 'usagelimited') {
      kind = 'usage_limited';
      label = goal.label || 'Goal usage limited';
    } else if (state === 'budgetlimited') {
      kind = 'budget_limited';
      label = goal.label || 'Goal budget limited';
    }
    return { ...previous, kind, label, goal, updated_at: observedAt };
  }

  async _auditCodexCliGoalController(sessionId, session, { force = false, nowMs = Date.now() } = {}) {
    if (!sessionId || !session || session.agentType !== 'codex_cli' || !session.cliSessionId) return false;
    if (this.sessions?.get(sessionId) !== session) return false;
    const owned = !!(session._codexCliChild || session._codexAppServerTurn);
    if (!owned && session.codexCliExternalActive !== true) return false;
    if (!this._codexCliGoalMonitorInFlight) this._codexCliGoalMonitorInFlight = new Map();
    if (this._codexCliGoalMonitorInFlight.has(sessionId)) {
      return this._codexCliGoalMonitorInFlight.get(sessionId);
    }
    const intervalMs = Number(this.CODEX_CLI_GOAL_MONITOR_INTERVAL_MS || 750);
    if (!force && session._lastCodexCliGoalMonitorAtMs
        && nowMs - session._lastCodexCliGoalMonitorAtMs < intervalMs) return false;
    session._lastCodexCliGoalMonitorAtMs = nowMs;

    const audit = (async () => {
      const ownerProbe = this._codexCliGoalMonitorOwnerProbe
        || ((cliSessionId, options) => codexCli.codexCliSessionOwnerStateAsync(cliSessionId, options));
      const ownerPromise = owned
        ? Promise.resolve({ state: 'confirmed', checked_at_ms: Date.now() })
        : Promise.resolve().then(() => ownerProbe(session.cliSessionId, { cacheMs: 500 }));
      const goalPromise = Promise.resolve()
        .then(() => this._ensureCodexCliGoalMonitorConnection())
        .then(connection => connection.getGoal(session.cliSessionId));
      const [ownerSettled, goalSettled] = await Promise.allSettled([ownerPromise, goalPromise]);
      const owner = ownerSettled.status === 'fulfilled'
        ? ownerSettled.value
        : { state: 'unknown', checked_at_ms: Date.now() };
      if (this.sessions?.get(sessionId) !== session) return false;
      if (owner?.state !== 'confirmed') {
        if (session.activity?.goal) {
          const ownerState = owner?.state === 'missing'
            ? this._codexCliGoalRunOwnerState(session)
            : 'ambiguous';
          return this._setCodexCliActivity(sessionId, session, session.activity, {
            source: 'codex_cli_goal_controller',
            goalSource: 'codex_cli_goal_controller',
            observedAt: new Date().toISOString(),
            evidenceType: ownerState === 'gone' ? 'confirmed_owner_gone' : 'owner_reconnect_audit',
            ownerState,
            liveLeaseProof: false,
          });
        }
        return false;
      }
      if (goalSettled.status === 'rejected') {
        const error = goalSettled.reason;
        let ownerHeartbeat = false;
        if (session.activity?.goal && session.activity?.goal_run?.lease_active === true) {
          this._setCodexCliActivity(sessionId, session, session.activity, {
            source: 'codex_cli_goal_controller',
            goalSource: 'codex_cli_goal_controller',
            observedAt: new Date().toISOString(),
            evidenceType: 'goal_controller_query_failed',
            ownerState: 'ambiguous',
            liveLeaseProof: false,
          });
        } else if (!session.activity?.goal) {
          ownerHeartbeat = this._emitActivityObservationHeartbeat(sessionId, session, {
            observedAt: new Date(owner.checked_at_ms || Date.now()).toISOString(),
          });
        }
        const logNow = Date.now();
        if (!session._lastCodexCliGoalMonitorErrorAtMs
            || logNow - session._lastCodexCliGoalMonitorErrorAtMs >= 30000) {
          session._lastCodexCliGoalMonitorErrorAtMs = logNow;
          this._log('warn', `[goal-run] controller query failed harness=codex_cli code=${error?.code || error?.name || 'unknown'}`);
        }
        return ownerHeartbeat;
      }
      const result = goalSettled.value;
      if (this.sessions?.get(sessionId) !== session) return false;
      const observedAt = new Date().toISOString();
      const nativeGoal = result?.goal || null;
      if (!nativeGoal) {
        if (!session.activity?.goal || session.activity?.goal_run?.lease_active !== true) {
          return this._emitActivityObservationHeartbeat(sessionId, session, {
            observedAt: new Date(owner.checked_at_ms || Date.now()).toISOString(),
          });
        }
        return this._setCodexCliActivity(sessionId, session, session.activity, {
          source: 'codex_cli_goal_controller',
          goalSource: 'codex_cli_goal_controller',
          observedAt,
          evidenceType: 'goal_controller_absent',
          ownerState: 'confirmed',
          controllerGoalAbsent: true,
          liveLeaseProof: false,
        });
      }
      const goal = this._canonicalCodexCliControllerGoal(sessionId, session, nativeGoal, observedAt);
      if (!goal) return false;
      const activity = this._codexCliGoalControllerActivity(session, goal, observedAt);
      return this._setCodexCliActivity(sessionId, session, activity, {
        source: 'codex_cli_goal_controller',
        goalSource: 'codex_cli_goal_controller',
        sourceCursor: goal.native_cursor || null,
        nativeEventAt: goal.native_updated_at || observedAt,
        observedAt,
        evidenceType: 'native_goal_controller',
        ownerState: 'confirmed',
        liveLeaseProof: goal.state === 'active',
      });
    })();
    this._codexCliGoalMonitorInFlight.set(sessionId, audit);
    try {
      return await audit;
    } finally {
      if (this._codexCliGoalMonitorInFlight.get(sessionId) === audit) {
        this._codexCliGoalMonitorInFlight.delete(sessionId);
      }
    }
  }

  _scheduleCodexCliGoalControllerAudit(sessionId, session) {
    this._auditCodexCliGoalController(sessionId, session).catch(error => {
      this._log('warn', `[goal-run] controller audit failed harness=codex_cli code=${error?.code || error?.name || 'unknown'}`);
    });
  }

  _applyGoalRunLifecycle(sessionId, session, activity, context = {}) {
    if (!activity?.goal || typeof activity.goal !== 'object') return activity;
    const previousRun = session?._goalRunLifecycle || session?.activity?.goal_run || null;
    const activityKind = String(activity.kind || '').trim().toLowerCase();
    const goalState = String(activity.goal.state || activity.goal.status || '').trim().toLowerCase();
    const ownerAuditRelevant = goalState === 'active'
      && !['waiting_for_user', 'needs_attention', 'blocked', 'rate_limited', 'usage_limited', 'budget_limited', 'failed', 'error'].includes(activityKind);
    const ownerState = context.ownerState || (
      session?.agentType === 'codex_cli' && ownerAuditRelevant
        ? this._codexCliGoalRunOwnerState(session)
        : (context.liveLeaseProof === true ? 'confirmed' : 'ambiguous')
    );
    const activeOwnedTurn = !!(session?._codexCliChild
      || (session?._codexAppServerTurn && session._codexAppServerTurnCompleted !== true));
    const run = reduceGoalRunLifecycle(previousRun, {
      session_key: session?.cliSessionId || session?.codexDesktopThreadId || session?.activeThreadId || sessionId,
      goal: activity.goal,
      activity_kind: activity.kind,
      task_started_turn_id: context.taskStartedTurnId || null,
      task_completed_turn_id: context.taskCompletedTurnId || null,
      source: context.source || activity.goal.source || (
        session?.agentType === 'codex_cli' ? 'codex_cli_jsonl' : `${session?.agentType || 'codex'}_dom`
      ),
      source_cursor: context.sourceCursor || activity.goal.native_cursor || null,
      native_event_at: context.nativeEventAt || activity.goal.native_updated_at || activity.updated_at || null,
      observed_at: context.observedAt || new Date().toISOString(),
      evidence_type: context.evidenceType || (activeOwnedTurn ? 'owned_turn' : 'activity_observation'),
      live_lease_proof: context.liveLeaseProof === true || activeOwnedTurn,
      owner_state: ownerState,
      explicit_stop: context.explicitStop === true || session?._codexCliInterrupted === true,
      controller_goal_absent: context.controllerGoalAbsent === true,
      confirmed_disconnect: context.confirmedDisconnect === true || ownerState === 'gone',
    });
    if (!run) return activity;
    const priorSeq = Number(previousRun?.transition_seq || 0);
    const priorLifecycle = previousRun?.lifecycle || 'none';
    session._goalRunLifecycle = run;
    if (run.transition_seq !== priorSeq || run.lifecycle !== priorLifecycle) {
      const sessionHash = crypto.createHash('sha256').update(String(sessionId || '')).digest('hex').slice(0, 12);
      this._log('info', `[goal-run] session=${sessionHash} harness=${session?.agentType || 'unknown'} goal=${String(run.goal_fingerprint || '').slice(0, 12)} generation=${run.goal_generation || 0} ${priorLifecycle}->${run.lifecycle} seq=${run.transition_seq} source_seq=${run.source_sequence || 0} owner=${run.owner_state} evidence=${run.evidence_type}`);
    }
    let label = activity.label || '';
    if (run.lease_active === true) {
      if (run.lifecycle === 'checkpoint_pending_continuation') label = 'Waiting for next goal turn';
      else if (run.lifecycle === 'verifying') label = 'Reconnecting';
      else if (run.lifecycle === 'starting') label = 'Starting goal';
      else if (run.lifecycle === 'running_turn' && !label) label = 'Working';
    }
    return { ...activity, label, goal_run: run };
  }

  _codexCliGoalRunContext(summary, {
    liveObserved = false,
    evidenceType = '',
    ownerState = '',
  } = {}) {
    const cursor = summary?.sourceCursor || null;
    const currentAppend = cursor?.mode === 'append' && Number(cursor?.events_read || 0) > 0;
    const completedCheckpoint = !!summary?.taskCompletedTurnId
      && summary.taskCompletedTurnId === summary.taskStartedTurnId;
    return {
      taskStartedTurnId: summary?.taskStartedTurnId || null,
      taskCompletedTurnId: summary?.taskCompletedTurnId || null,
      source: 'codex_cli_jsonl',
      sourceCursor: cursor,
      nativeEventAt: completedCheckpoint
        ? summary?.taskCompletedAt || summary?.activity?.updated_at || summary?.updatedAt || null
        : summary?.taskStartedAt || summary?.activity?.updated_at || summary?.updatedAt || null,
      observedAt: new Date().toISOString(),
      evidenceType: evidenceType || (ownerState === 'confirmed'
        ? 'confirmed_native_owner'
        : (completedCheckpoint ? 'task_complete' : (currentAppend ? 'current_generation_event' : 'summary_snapshot'))),
      liveLeaseProof: (liveObserved === true && currentAppend) || ownerState === 'confirmed',
      ...(ownerState || liveObserved === true ? { ownerState: ownerState || 'confirmed' } : {}),
    };
  }

  _setCodexCliActivity(sessionId, session, activity, lifecycleContext = {}) {
    const sourceActivityBase = activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() };
    const retainedObservedAt = sourceActivityBase.observed_at || session.activity?.observed_at || null;
    const sourceActivity = lifecycleContext.liveLeaseProof === true
      ? {
          ...sourceActivityBase,
          observed_at: lifecycleContext.observedAt || new Date().toISOString(),
        }
      : retainedObservedAt
        ? { ...sourceActivityBase, observed_at: retainedObservedAt }
        : sourceActivityBase;
    const terminalCompletedAtMs = Number(session._codexAppServerTerminalCompletedAtMs || 0);
    const sourceUpdatedAtMs = Date.parse(sourceActivity.updated_at || sourceActivity.started_at || '');
    const staleAfterOwnedTerminal = terminalCompletedAtMs > 0
      && ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files', 'waiting_for_user']
        .includes(String(sourceActivity.kind || '').toLowerCase())
      && (!Number.isFinite(sourceUpdatedAtMs) || sourceUpdatedAtMs <= terminalCompletedAtMs)
      && session.activity?.kind === 'idle';
    const activeQuestion = this.activeQuestionPromptAdapters.get(sessionId);
    const sourceGoalDecisionIdentity = this._codexCliGoalDecisionIdentity(
      sessionId,
      session,
      sourceActivity.goal,
    );
    const preserveGoalDecision = activeQuestion?.adapter_surface === 'codex_cli_goal_decision'
      && session.activity?.kind === 'waiting_for_user'
      && session.codexCliExternalActive === true
      && sourceGoalDecisionIdentity?.key === activeQuestion.goal_identity?.key;
    const preserveOwnedQuestion = (session._codexAppServerTurn
      && session._codexAppServerTurnCompleted !== true
      && activeQuestion
      && session.activity?.kind === 'waiting_for_user')
      || preserveGoalDecision;
    const preserveOwnedTurn = session._codexAppServerTurn
      && session._codexAppServerTurnCompleted !== true
      && sourceActivity.kind === 'idle'
      && ['generating', 'waiting_for_user'].includes(session.activity?.kind);
    const incomingActivity = preserveOwnedQuestion || preserveOwnedTurn || staleAfterOwnedTerminal
      ? session.activity
      : sourceActivity;
    const canonicalGoal = this._canonicalGoalForSession(
      sessionId,
      session,
      incomingActivity.goal,
      lifecycleContext.goalSource || lifecycleContext.source || 'codex_cli_jsonl',
    );
    const canonicalActivity = canonicalGoal
      ? { ...incomingActivity, goal: canonicalGoal }
      : incomingActivity;
    const observedActivity = this._applyGoalRunLifecycle(
      sessionId,
      session,
      canonicalActivity,
      lifecycleContext,
    );
    const nextActivity = session._codexCliInterrupted === true && observedActivity.kind !== 'idle'
      ? {
        kind: 'idle',
        label: 'Interrupted',
        updated_at: session.activity?.updated_at || new Date().toISOString(),
        ...(canonicalGoal ? { goal: canonicalGoal } : {}),
        ...(observedActivity.goal_run ? { goal_run: observedActivity.goal_run } : {}),
      }
      : observedActivity;
    const prevSig = this._activitySemanticSignature(session.activity || null);
    const nextSig = this._activitySemanticSignature(nextActivity);
    const changed = prevSig !== nextSig;
    const previousSourceSequence = Number(session.activity?.goal_run?.source_sequence || 0);
    const nextSourceSequence = Number(nextActivity.goal_run?.source_sequence || 0);
    if (changed) {
      session.activity = nextActivity;
      if (nextActivity.thinkingContent) session.thinkingContent = nextActivity.thinkingContent;
      else session.thinkingContent = '';
      sessionStore.updateSession(sessionId, { activity: nextActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', nextActivity));
    } else if (nextSourceSequence > previousSourceSequence) {
      // Persist replay protection without producing a cosmetic status frame.
      session.activity = nextActivity;
      sessionStore.updateSession(sessionId, { activity: nextActivity });
    }
    const promptChanged = this._syncCodexCliGoalDecisionPrompt(sessionId, session, nextActivity);
    if (this._running === true) this._scheduleCodexCliGoalControllerAudit(sessionId, session);
    return changed || promptChanged;
  }

  _codexCliGoalDecisionIdentity(sessionId, session, goal = session?.activity?.goal) {
    const threadId = String(session?.cliSessionId || '').trim();
    if (!sessionId || !threadId || !goal || goal.state !== 'paused') return null;
    const objectiveHash = String(goal.objective_hash || crypto.createHash('sha256')
      .update(String(goal.objective || goal.text || ''), 'utf8')
      .digest('hex'));
    const stable = {
      session_id: sessionId,
      thread_id: threadId,
      fingerprint: String(goal.fingerprint || ''),
      generation: Math.max(1, Number(goal.generation) || 1),
      transition_id: String(goal.transition_id || ''),
      objective_hash: objectiveHash,
      objective: String(goal.objective || goal.text || ''),
    };
    return {
      ...stable,
      key: crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex'),
    };
  }

  _syncCodexCliGoalDecisionPrompt(sessionId, session, activity = session?.activity) {
    if (!session || session.agentType !== 'codex_cli') return false;
    const existing = this.activeQuestionPromptAdapters.get(sessionId);
    const existingGoalDecision = existing?.adapter_surface === 'codex_cli_goal_decision';
    const identity = this._codexCliGoalDecisionIdentity(sessionId, session, activity?.goal);
    if (!identity || activity?.kind !== 'idle' || session.codexCliExternalActive !== true
        || session._codexAppServerTurn || session._codexCliChild) {
      if (existingGoalDecision && !existing.claimed) {
        this._clearQuestionPromptAdapter(sessionId, 'expired', { error_code: 'native_goal_changed' });
        session.waitingForAssistant = false;
      }
      return false;
    }
    if (session._codexCliGoalDecisionDismissedIdentity === identity.key) return false;
    if (existing) {
      return existingGoalDecision && existing.goal_identity?.key === identity.key;
    }

    const prompt = canonicalQuestionPrompt({
      prompt_id: crypto.randomUUID(),
      session_id: sessionId,
      generation: crypto.createHash('sha256')
        .update(`goal_resume_decision\0${identity.key}\0${crypto.randomUUID()}`)
        .digest('hex'),
      kind: 'goal_resume_decision',
      source: {
        surface: 'codex_cli',
        version: String(codexCli.CODEX_CLI_CATALOG.client_version || 'app-server-goal-v1'),
      },
      title: 'Goal paused',
      questions: [{
        id: 'goal_resume_decision',
        header: 'Goal',
        message: 'Resume paused goal?',
        options: [
          {
            id: 'resume',
            label: 'Resume goal',
            description: 'Mark it active and continue when idle',
          },
          {
            id: 'leave_paused',
            label: 'Leave paused',
            description: 'Keep it paused; use /goal resume later',
          },
        ],
      }],
      observed_at: new Date().toISOString(),
      cancel_supported: false,
    });
    this._registerQuestionPromptAdapter(sessionId, prompt, response => (
      this._answerCodexCliGoalDecision(sessionId, session, prompt, identity, response)
    ), {
      adapter_surface: 'codex_cli_goal_decision',
      goal_identity: identity,
    });
    session.waitingForAssistant = true;
    const attention = {
      kind: 'waiting_for_user',
      label: 'Goal decision required',
      updated_at: new Date().toISOString(),
      goal: activity.goal,
    };
    session.activity = attention;
    sessionStore.updateSession(sessionId, { activity: attention });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', attention));
    return true;
  }

  async _controlCodexGoal(sessionId, session, message) {
    const action = String(message?.action || '').trim().toLowerCase();
    if (!['pause', 'resume'].includes(action)) {
      throw Object.assign(new Error('Goal action must be pause or resume'), {
        code: 'invalid_goal_action', native_attempted: false, retryable: false,
      });
    }
    if (!['codex', 'codex-desktop', 'codex_cli'].includes(session?.agentType)) {
      throw Object.assign(new Error('This harness has no Codex goal lifecycle'), {
        code: 'goal_control_unsupported', native_attempted: false, retryable: false,
      });
    }
    if (this.sessions.get(sessionId) !== session) {
      throw Object.assign(new Error('The session changed before goal control'), {
        code: 'goal_session_changed', native_attempted: false, retryable: true,
      });
    }
    const currentGoal = session.activity?.goal || null;
    if (!currentGoal) {
      throw Object.assign(new Error('This thread has no goal'), {
        code: 'goal_not_found', native_attempted: false, retryable: false,
      });
    }
    const currentGeneration = Math.max(1, Number(currentGoal.generation) || 1);
    const requestedGeneration = Math.max(0, Number(message.goal_generation) || 0);
    if (!requestedGeneration || requestedGeneration !== currentGeneration
        || (message.goal_fingerprint && message.goal_fingerprint !== currentGoal.fingerprint)) {
      throw Object.assign(new Error('The goal generation changed before control'), {
        code: 'stale_goal_generation', native_attempted: false, retryable: true,
      });
    }
    const expectedBefore = action === 'pause' ? 'active' : 'paused';
    const expectedAfter = action === 'pause' ? 'paused' : 'active';
    const currentState = String(currentGoal.state || currentGoal.status || '').toLowerCase();
    if (currentState !== expectedBefore) {
      throw Object.assign(new Error(`The goal is no longer ${expectedBefore}`), {
        code: 'native_goal_changed', native_attempted: false, retryable: true,
      });
    }
    const objective = String(currentGoal.objective || currentGoal.text || '').trim();
    const tokenBudget = currentGoal.token_budget ?? currentGoal.tokenBudget ?? null;
    let result;
    let nativeVersion = null;
    if (session.agentType === 'codex_cli') {
      const threadId = String(session.cliSessionId || '').trim();
      if (!threadId) {
        throw Object.assign(new Error('The owned Codex thread identity is unavailable'), {
          code: 'goal_thread_missing', native_attempted: false, retryable: true,
        });
      }
      const factory = this._codexCliGoalControlConnectionFactory
        || this._codexCliGoalDecisionConnectionFactory
        || (options => new CodexAppServerConnection(options));
      const connection = factory({
        sessionId,
        cwd: session.workspace_path || process.cwd(),
        clientName: 'remote-agent-chat-goal-control',
        clientVersion: '1.0.0',
        requestTimeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_APP_SERVER_TIMEOUT_MS) || 120000),
      });
      try {
        const started = await connection.start();
        nativeVersion = started?.version || null;
        result = await connection.controlGoal(threadId, action, { objective, tokenBudget });
      } finally {
        await connection.stop();
      }
    } else {
      result = await selectors.controlCodexGoal(session.client.Runtime, session.agentType, action, { objective, tokenBudget });
    }
    if (!result?.ok || result.native_acknowledged !== true
        || result.native_operations !== 1
        || result.transcript_messages_appended !== 0) {
      throw Object.assign(new Error(result?.detail || 'The native goal action was not acknowledged'), {
        code: result?.code || 'goal_action_not_acknowledged',
        native_attempted: result?.native_attempted !== false,
        retryable: result?.retryable !== false,
      });
    }
    if (this.sessions.get(sessionId) !== session) {
      throw Object.assign(new Error('The session changed after native goal control'), {
        code: 'goal_session_changed', native_attempted: true, retryable: true,
      });
    }
    let canonicalGoal;
    if (session.agentType === 'codex_cli') {
      canonicalGoal = this._canonicalCodexCliControllerGoal(
        sessionId,
        session,
        result.after,
        new Date().toISOString(),
      );
    } else {
      canonicalGoal = this._canonicalGoalForSession(
        sessionId,
        session,
        { ...result.after, raw_state: expectedAfter },
        session.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom',
      );
    }
    if (!canonicalGoal || String(canonicalGoal.state || canonicalGoal.status || '').toLowerCase() !== expectedAfter
        || String(canonicalGoal.objective || canonicalGoal.text || '').trim() !== objective
        || (canonicalGoal.token_budget ?? canonicalGoal.tokenBudget ?? null) !== tokenBudget) {
      throw Object.assign(new Error('Authoritative goal readback did not preserve identity'), {
        code: 'goal_identity_changed', native_attempted: true, retryable: false,
      });
    }
    const observedAt = new Date().toISOString();
    const nextActivity = this._applyGoalRunLifecycle(sessionId, session, {
      ...(session.activity || {}),
      kind: expectedAfter === 'paused' ? 'idle' : (session.activity?.kind || 'idle'),
      label: expectedAfter === 'paused' ? '' : (session.activity?.label || ''),
      goal: canonicalGoal,
      updated_at: observedAt,
    }, {
      source: session.agentType === 'codex_cli' ? 'codex_cli_goal_controller'
        : (session.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom'),
      nativeEventAt: observedAt,
      observedAt,
      evidenceType: 'native_goal_control_receipt',
      liveLeaseProof: expectedAfter === 'active',
      ownerState: expectedAfter === 'active' ? 'confirmed' : 'ambiguous',
      explicitStop: expectedAfter === 'paused',
    });
    session._activityEpoch = Number(session._activityEpoch || 0) + 1;
    session.activity = nextActivity;
    if (session.agentType !== 'codex_cli') {
      selectors.setCodexCachedThinking(sessionId, {
        thinking: expectedAfter === 'active' && session.thinking === true,
        label: session.thinkingLabel || '',
        goal: canonicalGoal,
      });
    }
    sessionStore.updateSession(sessionId, { activity: nextActivity });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', nextActivity));
    return {
      native_acknowledged: true,
      action,
      before_status: expectedBefore,
      after_status: expectedAfter,
      goal_generation: currentGeneration,
      goal_fingerprint: canonicalGoal.fingerprint,
      objective_hash: canonicalGoal.objective_hash || null,
      native_operations: 1,
      transcript_messages_appended: 0,
      transport: session.agentType === 'codex_cli' ? 'codex_app_server' : result.method,
      ...(nativeVersion ? { codex_cli_version: nativeVersion } : {}),
      goal: canonicalGoal,
    };
  }

  async _answerCodexCliGoalDecision(sessionId, session, prompt, identity, rawResponse) {
    if (this.sessions.get(sessionId) !== session) {
      throw Object.assign(new Error('The Codex CLI session changed before the goal decision arrived'), {
        code: 'goal_session_changed',
        native_attempted: false,
      });
    }
    const currentIdentity = this._codexCliGoalDecisionIdentity(sessionId, session, session.activity?.goal);
    if (!currentIdentity || currentIdentity.key !== identity.key) {
      throw Object.assign(new Error('The native Codex goal changed before the decision arrived'), {
        code: 'stale_goal_generation',
        native_attempted: false,
      });
    }
    const response = canonicalQuestionResponse(prompt, rawResponse);
    const decision = response.answers[0]?.choice_ids?.[0];
    if (!['resume', 'leave_paused'].includes(decision)) {
      throw Object.assign(new Error('The goal decision is not supported'), {
        code: 'invalid_goal_decision',
        native_attempted: false,
      });
    }
    const factory = this._codexCliGoalDecisionConnectionFactory
      || (options => new CodexAppServerConnection(options));
    const connection = factory({
      sessionId,
      cwd: session.workspace_path || process.cwd(),
      clientName: 'remote-agent-chat-goal-control',
      clientVersion: '1.0.0',
      requestTimeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_APP_SERVER_TIMEOUT_MS) || 120000),
    });
    try {
      const started = await connection.start();
      const before = (await connection.getGoal(identity.thread_id))?.goal;
      if (!before || before.status !== 'paused') {
        throw Object.assign(new Error('The authoritative Codex goal is no longer paused'), {
          code: 'native_goal_changed',
        });
      }
      if (String(before.objective || '') !== identity.objective) {
        throw Object.assign(new Error('The authoritative Codex goal objective changed'), {
          code: 'native_goal_changed',
        });
      }
      const result = await connection.resolveGoalDecision(identity.thread_id, decision);
      const expectedStatus = decision === 'resume' ? 'active' : 'paused';
      if (result?.native_acknowledged !== true
          || result?.native_operations !== 1
          || result?.transcript_messages_appended !== 0
          || result?.after?.status !== expectedStatus) {
        throw Object.assign(new Error('Codex did not return the exact goal-decision receipt'), {
          code: 'goal_decision_not_acknowledged',
        });
      }
      session._codexCliGoalDecisionDismissedIdentity = decision === 'leave_paused' ? identity.key : null;
      const goal = this._canonicalGoalForSession(sessionId, session, {
        ...result.after,
        raw_state: result.after.status,
      }, 'codex_cli_app_server');
      const activity = {
        kind: 'idle',
        label: '',
        updated_at: new Date().toISOString(),
        ...(goal ? { goal } : {}),
      };
      session.waitingForAssistant = false;
      this._setCodexCliActivity(sessionId, session, activity, {
        source: 'codex_cli_app_server',
        nativeEventAt: activity.updated_at,
        observedAt: activity.updated_at,
        evidenceType: 'native_goal_controller_receipt',
        liveLeaseProof: decision === 'resume',
        ownerState: decision === 'resume' ? 'confirmed' : 'ambiguous',
      });
      sessionStore.updateSession(sessionId, {
        codex_cli_goal_decision_dismissed_identity: session._codexCliGoalDecisionDismissedIdentity,
      });
      return {
        ok: true,
        native_acknowledged: true,
        lifecycle: 'answered',
        native_receipt: {
          transport: 'codex_app_server',
          method: 'thread/goal/set',
          codex_cli_version: started.version || null,
          thread_id: identity.thread_id,
          decision,
          before_status: result.before.status,
          after_status: result.after.status,
          native_operations: result.native_operations,
          transcript_messages_appended: result.transcript_messages_appended,
          observed_at: new Date().toISOString(),
        },
      };
    } finally {
      await connection.stop();
    }
  }

  _observeCodexCliOwnedTurnCompletion(sessionId, session, summary) {
    const turn = session?._codexAppServerTurn;
    const identity = session?._codexAppServerTurnIdentity;
    const lastIdentity = session?._codexAppServerLastTurnIdentity;
    const pendingReceipt = session?._codexCliPendingReceipt?.native_receipt;
    const completedTurnId = String(summary?.taskCompletedTurnId || '').trim();
    if (!completedTurnId) return false;
    const ownedTurnId = String(identity?.turn_id || turn?.turnId || lastIdentity?.turn_id || pendingReceipt?.turn_id || '').trim();
    const ownedThreadId = String(identity?.thread_id || turn?.threadId || lastIdentity?.thread_id || pendingReceipt?.thread_id || session?.cliSessionId || '').trim();
    if (!ownedTurnId) return false;
    const summaryThreadId = String(summary?.cliSessionId || '').trim();
    const exactTurn = !!ownedTurnId && completedTurnId === ownedTurnId;
    const exactThread = !summaryThreadId || (!!ownedThreadId && summaryThreadId === ownedThreadId);
    const alreadyReconciled = session?._codexAppServerTerminalReconciledTurnId === completedTurnId;
    if (exactTurn && exactThread && alreadyReconciled && !turn && session.activity?.kind === 'idle') {
      return true;
    }
    this._log(
      'info',
      `[codex-cli] terminal JSONL observed for ${sessionId} `
        + `summary=${summaryThreadId || 'unknown'}/${completedTurnId} `
        + `owned=${ownedThreadId || 'unknown'}/${ownedTurnId || 'unknown'} `
        + `live_turn=${!!turn} match=${exactThread && exactTurn}`,
    );
    if (!exactTurn || !exactThread) return false;
    session._codexAppServerTerminalReconciledTurnId = completedTurnId;
    const completedAtMs = Date.parse(summary.taskCompletedAt || '');
    session._codexAppServerTerminalCompletedAtMs = Number.isFinite(completedAtMs)
      ? Math.max(Number(session._codexAppServerTerminalCompletedAtMs || 0), completedAtMs)
      : Date.now();
    if (turn) {
      turn.emit('turn_completed', {
        thread_id: ownedThreadId,
        turn_id: ownedTurnId,
        status: 'completed',
        source: 'codex_cli_jsonl',
        completed_at: summary.taskCompletedAt || null,
      });
    } else {
      session.waitingForAssistant = false;
      this._closeCodexCliMessageDelta(session, sessionId);
      const terminalActivity = {
        kind: 'idle',
        label: '',
        updated_at: summary.taskCompletedAt || new Date().toISOString(),
      };
      const changed = this._setCodexCliActivity(sessionId, session, terminalActivity);
      if (!changed) {
        // Activity is intentionally excluded from full session-list snapshot
        // signatures. Re-emit the authoritative terminal status when another
        // app-server path already changed memory to idle but its cleanup is
        // still pending or the client missed that earlier frame.
        this._sendToRelay(proto.proxyStatus(
          sessionId,
          session.status || 'healthy',
          session.activity || terminalActivity,
        ));
      }
    }
    return true;
  }

  _codexCliConfigPayload(session) {
    const observedModel = session?.observedModelId && session.observedModelId !== 'unknown'
      ? session.observedModelId
      : null;
    const observedEffort = session?.observedEffort && session.observedEffort !== 'unknown'
      ? session.observedEffort
      : null;
    const activeLaunch = session?._codexCliActiveLaunchConfig || null;
    const effectiveModel = observedModel || activeLaunch?.model_id || session?.nextSendModelId || 'unknown';
    const effectiveEffort = observedEffort || activeLaunch?.effort || session?.nextSendEffort || 'unknown';
    return this._decorateAgentConfig(session, this._mergeAgentConfig('codex_cli', {
      model_id: session?.observedModelId || 'unknown',
      observed_model_id: session?.observedModelId || 'unknown',
      observed_model_raw: session?.observedModelRaw || null,
      model_provenance: session?.modelProvenance || null,
      next_send_model_id: session?.nextSendModelId || null,
      next_send_model_status: session?.nextSendModelStatus || 'unset',
      next_send_model_error: session?.nextSendModelError || null,
      active_launch_model_id: activeLaunch?.model_id || null,
      active_launch_model_provenance: activeLaunch ? activeLaunch.source : null,
      effective_model_id: effectiveModel,
      effective_model_provenance: observedModel
        ? 'latest_native_metadata'
        : (activeLaunch?.model_id ? activeLaunch.source : (session?.nextSendModelId ? 'next_send_override' : 'unknown')),
      permission_mode: session?.permission_mode || 'workspace-write',
      approval_policy: session?.approval_policy || null,
      effort: session?.observedEffort || 'unknown',
      observed_effort: session?.observedEffort || 'unknown',
      observed_effort_raw: session?.observedEffortRaw || null,
      effort_provenance: session?.effortProvenance || null,
      next_send_effort: session?.nextSendEffort || null,
      next_send_effort_status: session?.nextSendEffortStatus || 'unset',
      next_send_effort_error: session?.nextSendEffortError || null,
      active_launch_effort: activeLaunch?.effort || null,
      active_launch_effort_provenance: activeLaunch ? activeLaunch.source : null,
      effective_effort: effectiveEffort,
      effective_effort_provenance: observedEffort
        ? 'latest_native_metadata'
        : (activeLaunch?.effort ? activeLaunch.source : (session?.nextSendEffort ? 'next_send_override' : 'unknown')),
    }, session?.workspace_path));
  }

  _publishCodexCliConfig(sessionId, session) {
    const cfg = this._codexCliConfigPayload(session);
    this._sendToRelay(proto.agentConfig(sessionId, {
      ...cfg,
      capabilities: this._buildCapabilities('codex_cli', session?.workspace_path),
    }));
    return cfg;
  }

  _buildCodexCliSessionFromSummary(sessionMeta, summary, { rehydrateGoalRun = false } = {}) {
    const now = new Date().toISOString();
    const interrupted = sessionMeta.codex_cli_interrupted === true;
    const observedModelId = summary.model_observation ? (summary.model_id || 'unknown') : 'unknown';
    const observedEffort = summary.effort_observation ? (summary.effort || 'unknown') : 'unknown';
    const legacyNextModel = sessionMeta.codex_cli_model_configured === true ? sessionMeta.model_id : null;
    const legacyNextEffort = sessionMeta.codex_cli_effort_configured === true ? sessionMeta.effort : null;
    const persistedGoalRun = rehydrateGoalRun === true
      && sessionMeta.activity?.goal_run
      && typeof sessionMeta.activity.goal_run === 'object'
      ? sessionMeta.activity.goal_run
      : null;
    return {
      session_id: sessionMeta.session_id,
      display_name: sessionMeta.display_name || 'Codex CLI',
      workspace_name: summary.workspaceName || sessionMeta.workspace_name,
      workspace_path: summary.workspacePath || sessionMeta.workspace_path,
      machine_label: sessionMeta.machine_label,
      target_signature: sessionMeta.target_signature,
      chat_title: summary.title || null,
      client: null,
      lastMessageCount: summary.messageCount || 0,
      lastObservedCount: summary.messageCount || 0,
      // Codex file-backed transcripts use the parser cursor/last semantic
      // identity as their hot-path observation key. Avoid serializing a
      // multi-megabyte active tail merely to rediscover the same cursor.
      lastTranscriptSig: '',
      nullPollCount: 0,
      waitingForAssistant: false,
      thinking: false,
      thinkingLabel: '',
      autoApprovePermissions: false,
      status: 'healthy',
      activity: interrupted
        ? { kind: 'idle', label: 'Interrupted', updated_at: sessionMeta.activity?.updated_at || now }
        : {
            ...(summary.activity || { kind: 'idle', label: '', updated_at: summary.updatedAt || now }),
            ...(persistedGoalRun ? { goal_run: persistedGoalRun } : {}),
          },
      last_seen_at: summary.updatedAt || now,
      windowTitle: sessionMeta.window_title || summary.workspaceName || 'Codex CLI',
      agentType: 'codex_cli',
      parentId: null,
      ext: null,
      targetId: null,
      cliSessionId: summary.cliSessionId,
      codexCliFilePath: summary.filePath,
      codexCliArchiveDiscovered: sessionMeta.codex_cli_archive_discovered === true,
      codexCliExternalActive: sessionMeta.codex_cli_external_active === true,
      codexCliOwnerDemoted: sessionMeta.codex_cli_owner_demoted === true,
      nativeCliStartedAt: sessionMeta.native_cli_started_at || summary.nativeCliStartedAt || null,
      nativeCliStatus: sessionMeta.native_cli_status || summary.nativeCliStatus || null,
      nativeCliWindowOpened: sessionMeta.native_cli_window_opened === true || summary.nativeCliWindowOpened === true,
      model_id: observedModelId,
      observedModelId,
      observedModelRaw: summary.model_observation?.raw_value || null,
      modelProvenance: summary.model_observation || null,
      nextSendModelId: sessionMeta.codex_cli_next_model_id || legacyNextModel || null,
      nextSendModelStatus: sessionMeta.codex_cli_next_model_status || (legacyNextModel ? 'pending' : 'unset'),
      nextSendModelError: sessionMeta.codex_cli_next_model_error || null,
      effort: observedEffort,
      observedEffort,
      observedEffortRaw: summary.effort_observation?.raw_value || null,
      effortProvenance: summary.effort_observation || null,
      nextSendEffort: sessionMeta.codex_cli_next_effort || legacyNextEffort || null,
      nextSendEffortStatus: sessionMeta.codex_cli_next_effort_status || (legacyNextEffort ? 'pending' : 'unset'),
      nextSendEffortError: sessionMeta.codex_cli_next_effort_error || null,
      permission_mode: sessionMeta.permission_mode || summary.permission_mode || 'workspace-write',
      approval_policy: sessionMeta.approval_policy || summary.approval_policy || null,
      percentUsed: summary.percent_used ?? sessionMeta.percent_used ?? null,
      rateLimitActive: summary.rate_limit_active === true || sessionMeta.rate_limit_active === true,
      rate_limited_until: summary.rate_limited_until || sessionMeta.rate_limited_until || null,
      codexCliModelConfigured: sessionMeta.codex_cli_model_configured === true,
      codexCliPermissionConfigured: sessionMeta.codex_cli_permission_configured === true,
      codexCliEffortConfigured: sessionMeta.codex_cli_effort_configured === true,
      _fileTranscriptState: this._fileTranscriptState(
        'codex_cli', summary.filePath, summary.messages || [], summary.sourceCursor || null
      ),
      _lastFileTranscriptObservationKey: this._fileTranscriptObservationKey(
        summary.filePath, summary.sourceCursor || null, summary.messages || []
      ),
      _codexCliInterrupted: interrupted,
      _codexCliPendingReceipt: sessionMeta.codex_cli_pending_receipt || null,
      _codexCliGoalDecisionDismissedIdentity:
        sessionMeta.codex_cli_goal_decision_dismissed_identity || null,
      _goalRunLifecycle: persistedGoalRun,
    };
  }

  _applyCodexCliSummaryMetadata(sessionId, session, summary) {
    if (!session || !summary) return false;
    let changed = false;
    const wasRateLimitActive = session.rateLimitActive === true;
    const nextWorkspaceName = summary.workspaceName || session.workspace_name;
    const nextWorkspacePath = summary.workspacePath || session.workspace_path;
    const nextChatTitle = summary.title || session.chat_title;
    if (nextWorkspaceName && nextWorkspaceName !== session.workspace_name) {
      session.workspace_name = nextWorkspaceName;
      changed = true;
    }
    if (nextWorkspacePath && nextWorkspacePath !== session.workspace_path) {
      session.workspace_path = nextWorkspacePath;
      changed = true;
    }
    if (nextChatTitle && nextChatTitle !== session.chat_title) {
      session.chat_title = nextChatTitle;
      changed = true;
    }
    if (summary.updatedAt && summary.updatedAt !== session.last_seen_at) {
      session.last_seen_at = summary.updatedAt;
    }
    if (summary.filePath && summary.filePath !== session.codexCliFilePath) {
      session.codexCliFilePath = summary.filePath;
      changed = true;
    }
    if (summary.model_observation && summary.model_id && (
      summary.model_id !== session.observedModelId
      || JSON.stringify(summary.model_observation) !== JSON.stringify(session.modelProvenance)
    )) {
      session.observedModelId = summary.model_id;
      session.model_id = summary.model_id;
      session.observedModelRaw = summary.model_observation.raw_value || summary.model_id;
      session.modelProvenance = summary.model_observation;
      changed = true;
    }
    if (session.codexCliPermissionConfigured !== true && summary.permission_mode && summary.permission_mode !== session.permission_mode) {
      session.permission_mode = summary.permission_mode;
      changed = true;
    }
    if (summary.effort_observation && summary.effort && (
      summary.effort !== session.observedEffort
      || JSON.stringify(summary.effort_observation) !== JSON.stringify(session.effortProvenance)
    )) {
      session.observedEffort = summary.effort;
      session.effort = summary.effort;
      session.observedEffortRaw = summary.effort_observation.raw_value || summary.effort;
      session.effortProvenance = summary.effort_observation;
      changed = true;
    }
    if (session.nextSendModelId && summary.model_observation && summary.model_id === session.nextSendModelId
        && session.nextSendModelStatus !== 'confirmed') {
      session.nextSendModelStatus = 'confirmed';
      session.nextSendModelError = null;
      changed = true;
    }
    if (session.nextSendEffort && summary.effort_observation && summary.effort === session.nextSendEffort
        && session.nextSendEffortStatus !== 'confirmed') {
      session.nextSendEffortStatus = 'confirmed';
      session.nextSendEffortError = null;
      changed = true;
    }
    const exactTurnObserved = ['native_user_turn_observed', 'delivery_emitted', 'agent_started_emitted']
      .includes(session._codexCliPendingReceipt?.state)
      || session._codexCliPendingReceipt?.native_receipt;
    if (exactTurnObserved && session.nextSendModelId && summary.model_observation
        && summary.model_id !== session.nextSendModelId
        && session.nextSendModelStatus === 'applying') {
      session.nextSendModelStatus = 'failed';
      session.nextSendModelError = 'native_metadata_mismatch';
      changed = true;
    }
    if (exactTurnObserved && session.nextSendEffort && summary.effort_observation
        && summary.effort !== session.nextSendEffort
        && session.nextSendEffortStatus === 'applying') {
      session.nextSendEffortStatus = 'failed';
      session.nextSendEffortError = 'native_metadata_mismatch';
      changed = true;
    }
    if (summary.approval_policy && summary.approval_policy !== session.approval_policy) {
      session.approval_policy = summary.approval_policy;
      changed = true;
    }
    if (summary.percent_used != null && summary.percent_used !== session.percentUsed) {
      session.percentUsed = summary.percent_used;
      changed = true;
    }
    if (summary.rate_limit_active != null && (summary.rate_limit_active === true) !== session.rateLimitActive) {
      session.rateLimitActive = summary.rate_limit_active === true;
      changed = true;
    }
    if (summary.rate_limited_until !== undefined && (summary.rate_limited_until || null) !== (session.rate_limited_until || null)) {
      session.rate_limited_until = summary.rate_limited_until || null;
      changed = true;
    }
    if (changed) {
      session.windowTitle = session.workspace_name || session.windowTitle || 'Codex CLI';
      sessionStore.updateSession(sessionId, {
        workspace_path: session.workspace_path || null,
        workspace_name: session.workspace_name || null,
        window_title: session.windowTitle || null,
        chat_title: session.chat_title || null,
        codex_cli_file_path: session.codexCliFilePath || null,
        model_id: session.observedModelId || null,
        codex_cli_observed_model_id: session.observedModelId || null,
        codex_cli_observed_model_raw: session.observedModelRaw || null,
        codex_cli_model_provenance: session.modelProvenance || null,
        codex_cli_next_model_id: session.nextSendModelId || null,
        codex_cli_next_model_status: session.nextSendModelStatus || 'unset',
        codex_cli_next_model_error: session.nextSendModelError || null,
        permission_mode: session.permission_mode || null,
        effort: session.observedEffort || null,
        codex_cli_observed_effort: session.observedEffort || null,
        codex_cli_observed_effort_raw: session.observedEffortRaw || null,
        codex_cli_effort_provenance: session.effortProvenance || null,
        codex_cli_next_effort: session.nextSendEffort || null,
        codex_cli_next_effort_status: session.nextSendEffortStatus || 'unset',
        codex_cli_next_effort_error: session.nextSendEffortError || null,
        approval_policy: session.approval_policy || null,
        percent_used: session.percentUsed ?? null,
        rate_limit_active: session.rateLimitActive === true,
        rate_limited_until: session.rate_limited_until || null,
      });
    }
    if (!wasRateLimitActive && session.rateLimitActive === true) {
      this._sendToRelay(proto.rateLimitActive(sessionId, session.rate_limited_until, session.percentUsed, true));
    } else if (wasRateLimitActive && session.rateLimitActive !== true) {
      this._sendToRelay(proto.rateLimitCleared(sessionId));
    }
    return changed;
  }

  _codexCliTranscriptKeyMatches(summary, sessionLike) {
    if (!summary || !sessionLike) return false;
    const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const summaryFile = norm(summary.filePath);
    const storedFile = norm(sessionLike.codexCliFilePath || sessionLike.codex_cli_file_path);
    if (summaryFile && storedFile && summaryFile === storedFile) return true;
    const summaryCliId = String(summary.cliSessionId || '');
    const storedCliId = String(sessionLike.cliSessionId || sessionLike.cli_session_id || '');
    return !!summaryCliId && !!storedCliId && summaryCliId === storedCliId;
  }

  _dedupeCodexCliSessionAliases(summary, canonicalSessionId) {
    if (!summary?.cliSessionId || !canonicalSessionId) return false;
    let changed = false;
    for (const sess of sessionStore.getAllSessions()) {
      if (sess.agent_type !== 'codex_cli') continue;
      if (sess.session_id === canonicalSessionId) continue;
      if (sess.status !== 'healthy') continue;
      if (!this._codexCliTranscriptKeyMatches(summary, sess)) continue;
      sessionStore.markDisconnected(sess.session_id);
      changed = true;
      this._log('info', `[codex-cli] disconnected duplicate alias ${sess.session_id} for cli=${summary.cliSessionId}`);
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId === canonicalSessionId) continue;
      if (session.agentType !== 'codex_cli') continue;
      if (!this._codexCliTranscriptKeyMatches(summary, session)) continue;
      this.sessions.delete(sessionId);
      changed = true;
      this._log('info', `[codex-cli] removed duplicate in-memory alias ${sessionId} for cli=${summary.cliSessionId}`);
    }
    return changed;
  }

  _persistCodexCliReceiptState(sessionId, session, updates = {}) {
    if (!session?._codexCliPendingReceipt) return null;
    session._codexCliPendingReceipt = {
      ...session._codexCliPendingReceipt,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    sessionStore.updateSession(sessionId, {
      codex_cli_pending_receipt: session._codexCliPendingReceipt,
    });
    return session._codexCliPendingReceipt;
  }

  _recoverCodexCliPendingReceipt(sessionId, session, summary = null) {
    const pending = session?._codexCliPendingReceipt;
    const baseline = pending?.baseline;
    if (!baseline?.client_message_id || session._codexCliReceiptRecoveryRunning) return;
    const capturedAtMs = Number(baseline.captured_at_ms || Date.parse(baseline.captured_at || ''));
    if (Number.isFinite(capturedAtMs) && Date.now() - capturedAtMs > 24 * 60 * 60 * 1000) return;
    if (!baseline.cli_session_id && (summary?.cliSessionId || session.cliSessionId)) {
      baseline.cli_session_id = summary?.cliSessionId || session.cliSessionId;
    }
    if (!baseline.file_path && (summary?.filePath || session.codexCliFilePath)) {
      baseline.file_path = summary?.filePath || session.codexCliFilePath;
    }
    session._codexCliReceiptRecoveryRunning = true;
    Promise.resolve().then(() => {
      const inspected = codexCli.inspectCodexReceipt(baseline);
      if (!inspected.ok) return;
      const receipt = pending.native_receipt || inspected.receipt;
      if (pending.delivery_emitted !== true) {
        const emitted = this._sendToRelay(proto.proxySendResult(
          sessionId,
          baseline.client_message_id,
          'delivered',
          {
            lifecycle: 'native_user_turn_observed',
            native_receipt: receipt,
            process_epoch: baseline.process_epoch || null,
          },
        ));
        if (emitted) this._persistCodexCliReceiptState(sessionId, session, {
          state: 'native_user_turn_observed',
          native_receipt: receipt,
          delivery_emitted: true,
        });
      }
      if (inspected.agent_started && pending.agent_started_emitted !== true) {
        const emitted = this._sendToRelay(proto.agentStarted(
          sessionId,
          baseline.client_message_id,
          receipt,
          inspected.agent_started,
        ));
        if (emitted) this._persistCodexCliReceiptState(sessionId, session, {
          native_receipt: receipt,
          delivery_emitted: true,
          agent_started_emitted: true,
        });
      }
    }).catch(error => {
      this._log('warn', `[codex-cli] receipt recovery failed for ${sessionId}: ${error.message}`);
    }).finally(() => {
      session._codexCliReceiptRecoveryRunning = false;
    });
  }

  _registerCodexCliSession(summary, {
    sendInitialHistory = true,
    archiveDiscovered = false,
    externalActive = null,
    liveObserved = false,
    evidenceType = '',
  } = {}) {
    if (!summary?.cliSessionId) return null;
    const displayName = 'Codex CLI';
    const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const pendingEntry = Array.from(this.sessions.entries()).find(([, s]) =>
      s.agentType === 'codex_cli'
      && (
        this._codexCliTranscriptKeyMatches(summary, s)
        || (
          !s.codexCliFilePath
          && norm(s.workspace_path) === norm(summary.workspacePath)
          && (s.cliSessionId === summary.cliSessionId || s.nativeCliWindowOpened === true
            || s._codexCliChild || s._codexAppServerTurn)
        )
      )
    );
    if (pendingEntry) {
      const [sessionId, existing] = pendingEntry;
      const externalActiveFlag = externalActive == null
        ? existing.codexCliExternalActive === true
        : externalActive === true;
      const metaChanged = this._applyCodexCliSummaryMetadata(sessionId, existing, summary);
      existing.codexCliArchiveDiscovered = archiveDiscovered === true;
      existing.codexCliExternalActive = externalActiveFlag;
      if (externalActiveFlag) existing.codexCliOwnerDemoted = false;
      existing.cliSessionId = summary.cliSessionId;
      const migratedMeta = sessionStore.migrateVirtualSession(
        sessionId,
        `codex-cli:${summary.cliSessionId}`,
        'codex_cli'
      );
      if (migratedMeta?.target_signature) existing.target_signature = migratedMeta.target_signature;
      const ownedTurnCompleted = this._observeCodexCliOwnedTurnCompletion(sessionId, existing, summary);
      const lifecycleContext = this._codexCliGoalRunContext(summary, {
        liveObserved,
        evidenceType,
        ownerState: summary._racCodexCliOwnerConfirmed === true ? 'confirmed' : '',
      });
      this._setCodexCliActivity(sessionId, existing,
        ownedTurnCompleted && summary.activity?.kind !== 'idle'
          ? { ...summary.activity, kind: 'idle', label: '', updated_at: summary.taskCompletedAt || summary.updatedAt || new Date().toISOString() }
          : (summary.activity || { kind: 'idle', label: '', updated_at: summary.updatedAt || new Date().toISOString() }),
        lifecycleContext);
      sessionStore.updateSession(sessionId, {
        cli_session_id: existing.cliSessionId,
        codex_cli_file_path: existing.codexCliFilePath || null,
        codex_cli_archive_discovered: archiveDiscovered === true,
        codex_cli_external_active: externalActiveFlag,
        codex_cli_owner_demoted: externalActiveFlag ? false : existing.codexCliOwnerDemoted === true,
        chat_title: existing.chat_title || null,
        workspace_path: existing.workspace_path || null,
        workspace_name: existing.workspace_name || null,
      });
      if (metaChanged) {
        this._publishCodexCliConfig(sessionId, existing);
        this._broadcastSessionSnapshot();
      }
      this._recoverCodexCliPendingReceipt(sessionId, existing, summary);
      const summaryMessages = summary.messages || [];
      const effectiveMessages = summaryMessages.length > 0
        ? summaryMessages
        : (summary.filePath ? [] : this._codexCliPendingTranscriptMessages(existing));
      if (effectiveMessages.length === 0) return existing;
      const observationKey = this._fileTranscriptObservationKey(summary.filePath, summary.sourceCursor, effectiveMessages);
      if (observationKey !== existing._lastFileTranscriptObservationKey) {
        const reason = shouldPrioritizeCliAssistantSnapshot(existing.lastObservedCount, effectiveMessages)
          ? 'assistant completion'
          : 'codex cli file attached';
        existing.lastObservedCount = effectiveMessages.length;
        existing.lastMessageCount = effectiveMessages.length;
        this._sendFileBackedTranscriptUpdate(sessionId, existing, effectiveMessages, {
          agentType: 'codex_cli', filePath: summary.filePath,
          sourceCursor: summary.sourceCursor, reason, allowInitialAppend: true,
        });
      }
      return existing;
    }
    const storedConfig = sessionStore.getAllSessions().find(sess => (
      sess.agent_type === 'codex_cli'
      && (sess.cli_session_id === summary.cliSessionId || sess.virtual_id === `codex-cli:${summary.cliSessionId}`)
    ));
    const sessionMeta = sessionStore.resolveVirtualSession({
      virtualId: `codex-cli:${summary.cliSessionId}`,
      agentType: 'codex_cli',
      displayName,
      workspaceName: summary.workspaceName,
      workspacePath: summary.workspacePath,
      windowTitle: summary.workspaceName || displayName,
      extra: {
        cli_session_id: summary.cliSessionId,
        codex_cli_file_path: summary.filePath,
        codex_cli_archive_discovered: archiveDiscovered === true,
        codex_cli_external_active: externalActive === true,
        codex_cli_owner_demoted: false,
        chat_title: summary.title || null,
        model_id: summary.model_observation ? (summary.model_id || undefined) : undefined,
        codex_cli_observed_model_id: summary.model_observation ? (summary.model_id || undefined) : undefined,
        codex_cli_observed_model_raw: summary.model_observation?.raw_value || undefined,
        codex_cli_model_provenance: summary.model_observation || undefined,
        permission_mode: storedConfig?.codex_cli_permission_configured === true ? undefined : (summary.permission_mode || undefined),
        effort: summary.effort_observation ? (summary.effort || undefined) : undefined,
        codex_cli_observed_effort: summary.effort_observation ? (summary.effort || undefined) : undefined,
        codex_cli_observed_effort_raw: summary.effort_observation?.raw_value || undefined,
        codex_cli_effort_provenance: summary.effort_observation || undefined,
        approval_policy: summary.approval_policy || undefined,
        percent_used: summary.percent_used ?? undefined,
        rate_limit_active: summary.rate_limit_active === true || undefined,
        rate_limited_until: summary.rate_limited_until || undefined,
        native_cli_started_at: summary.nativeCliStartedAt || undefined,
        native_cli_status: summary.nativeCliStatus || undefined,
        native_cli_window_opened: summary.nativeCliWindowOpened === true || undefined,
      },
    });
    const sessionId = sessionMeta.session_id;
    const dedupedAliases = this._dedupeCodexCliSessionAliases(summary, sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      const externalActiveFlag = externalActive == null
        ? existing.codexCliExternalActive === true
        : externalActive === true;
      const metaChanged = this._applyCodexCliSummaryMetadata(sessionId, existing, summary);
      existing.codexCliArchiveDiscovered = archiveDiscovered === true;
      existing.codexCliExternalActive = externalActiveFlag;
      if (externalActiveFlag) existing.codexCliOwnerDemoted = false;
      existing.cliSessionId = summary.cliSessionId;
      const ownedTurnCompleted = this._observeCodexCliOwnedTurnCompletion(sessionId, existing, summary);
      const lifecycleContext = this._codexCliGoalRunContext(summary, {
        liveObserved,
        evidenceType,
        ownerState: summary._racCodexCliOwnerConfirmed === true ? 'confirmed' : '',
      });
      this._setCodexCliActivity(sessionId, existing,
        ownedTurnCompleted && summary.activity?.kind !== 'idle'
          ? { ...summary.activity, kind: 'idle', label: '', updated_at: summary.taskCompletedAt || summary.updatedAt || new Date().toISOString() }
          : (summary.activity || { kind: 'idle', label: '', updated_at: summary.updatedAt || new Date().toISOString() }),
        lifecycleContext);
      if (metaChanged) this._publishCodexCliConfig(sessionId, existing);
      if (metaChanged || dedupedAliases) this._broadcastSessionSnapshot();
      this._recoverCodexCliPendingReceipt(sessionId, existing, summary);
      const summaryMessages = summary.messages || [];
      const effectiveMessages = summaryMessages.length > 0
        ? summaryMessages
        : (summary.filePath ? [] : this._codexCliPendingTranscriptMessages(existing));
      if (effectiveMessages.length === 0) return existing;
      const observationKey = this._fileTranscriptObservationKey(summary.filePath, summary.sourceCursor, effectiveMessages);
      if (observationKey !== existing._lastFileTranscriptObservationKey) {
        const reason = shouldPrioritizeCliAssistantSnapshot(existing.lastObservedCount, effectiveMessages)
          ? 'assistant completion'
          : 'codex cli file changed';
        existing.lastObservedCount = effectiveMessages.length;
        existing.lastMessageCount = effectiveMessages.length;
        this._sendFileBackedTranscriptUpdate(sessionId, existing, effectiveMessages, {
          agentType: 'codex_cli', filePath: summary.filePath,
          sourceCursor: summary.sourceCursor, reason,
        });
      }
      return existing;
    }
    const ownerProbe = externalActive === true
      ? codexCli.codexCliSessionOwnerState(summary.cliSessionId, { cacheMs: 750 })
      : { state: 'unknown' };
    const rehydrateGoalRun = externalActive === true && ownerProbe.state === 'confirmed';
    const session = this._buildCodexCliSessionFromSummary(sessionMeta, summary, { rehydrateGoalRun });
    this.sessions.set(sessionId, session);
    this._setCodexCliActivity(
      sessionId,
      session,
      summary.activity || { kind: 'idle', label: '', updated_at: summary.updatedAt || new Date().toISOString() },
      this._codexCliGoalRunContext(summary, {
        liveObserved,
        evidenceType,
        ownerState: ownerProbe.state === 'confirmed' ? 'confirmed' : '',
      }),
    );
    this._log('info', `[codex-cli] registered ${sessionId} cli=${summary.cliSessionId} (${summary.messageCount} msgs)`);
    if (sendInitialHistory) {
      const initialMessages = summary.messages?.length
        ? summary.messages
        : (summary.filePath ? [] : this._codexCliPendingTranscriptMessages(session));
      if (initialMessages.length > 0) {
        session.lastObservedCount = initialMessages.length;
        session.lastMessageCount = initialMessages.length;
      }
    }
    this._publishCodexCliConfig(sessionId, session);
    this._syncCodexCliGoalDecisionPrompt(sessionId, session, session.activity);
    this._recoverCodexCliPendingReceipt(sessionId, session, summary);
    if (dedupedAliases) this._broadcastSessionSnapshot();
    return session;
  }

  _codexCliArchiveDiscoveryEnabled() {
    return process.env.CODEX_CLI_DISCOVER_ARCHIVES !== 'false';
  }

  _codexCliArchiveSessionLimit() {
    const limit = parseInt(process.env.CODEX_CLI_SESSION_LIMIT || '20', 10);
    return Number.isFinite(limit) && limit >= 0 ? limit : 20;
  }

  _codexCliArchiveMaxAgeMs() {
    const hours = Number(process.env.CODEX_CLI_ARCHIVE_MAX_AGE_HOURS || '72');
    if (!Number.isFinite(hours) || hours < 0) return 72 * 60 * 60 * 1000;
    return hours === 0 ? 0 : hours * 60 * 60 * 1000;
  }

  _codexCliArchiveSummaryVisible(summary, nowMs = Date.now()) {
    const maxAgeMs = this._codexCliArchiveMaxAgeMs();
    if (!maxAgeMs) return true;
    const updatedMs = Date.parse(summary?.updatedAt || summary?.startedAt || '');
    if (!Number.isFinite(updatedMs)) return true;
    return nowMs - updatedMs <= maxAgeMs;
  }

  _codexCliActiveSummaryOptions() {
    return {
      maxHydrateBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES,
      preferTailBytes: codexCli.CODEX_CLI_ACTIVE_HYDRATE_TAIL_BYTES,
    };
  }

  _codexCliExternalActiveSummaries(nowMs = Date.now()) {
    const configuredLimit = parseInt(process.env.CODEX_CLI_ACTIVE_SESSION_LIMIT || '', 10);
    const ownerSnapshot = codexCli.runningCodexCliSessionOwners({ cacheMs: 2000 });
    const ownerIds = ownerSnapshot.state === 'confirmed'
      ? Array.from(ownerSnapshot.owners.keys())
      : [];
    const limitedOwnerIds = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? ownerIds.slice(0, configuredLimit)
      : ownerIds;
    if (!this._codexCliExternalOwnerLedger) this._codexCliExternalOwnerLedger = new Map();
    if (this._codexCliExternalOwnerLedgerSeeded !== true) {
      this._codexCliExternalOwnerLedgerSeeded = true;
      for (const stored of sessionStore.getAllSessions()) {
        if (stored.agent_type !== 'codex_cli' || stored.codex_cli_external_active !== true) continue;
        const lastEvidenceMs = Date.parse(
          stored.activity?.goal_run?.lease_observed_at
          || stored.activity?.observed_at
          || stored.last_seen_at
          || '',
        );
        if (!Number.isFinite(lastEvidenceMs) || nowMs - lastEvidenceMs > CODEX_CLI_OWNER_MISSING_GRACE_MS) continue;
        const summary = this._findCodexCliSummaryByCliId(stored.cli_session_id);
        if (!summary) continue;
        this._codexCliExternalOwnerLedger.set(stored.cli_session_id, {
          summary,
          last_confirmed_at_ms: lastEvidenceMs,
        });
      }
    }
    const processCountSig = `${ownerSnapshot.state}:${ownerIds.length}:${limitedOwnerIds.length}`;
    if (this._lastCodexCliProcessCountSig !== processCountSig) {
      this._lastCodexCliProcessCountSig = processCountSig;
      this._log('info', `[codex-cli] exact owner snapshot state=${ownerSnapshot.state} owners=${ownerIds.length} selected=${limitedOwnerIds.length}`);
    }
    const selected = new Set(limitedOwnerIds);
    for (const cliSessionId of limitedOwnerIds) {
      const summary = this._findCodexCliSummaryByCliId(cliSessionId);
      if (!summary) continue;
      this._codexCliExternalOwnerLedger.set(cliSessionId, {
        summary,
        last_confirmed_at_ms: ownerSnapshot.checked_at_ms || nowMs,
      });
    }
    const summaries = [];
    for (const [cliSessionId, record] of this._codexCliExternalOwnerLedger) {
      const confirmed = selected.has(cliSessionId);
      const missingForMs = nowMs - Number(record.last_confirmed_at_ms || 0);
      if (!confirmed && missingForMs > CODEX_CLI_OWNER_MISSING_GRACE_MS) {
        this._codexCliExternalOwnerLedger.delete(cliSessionId);
        continue;
      }
      if (record.summary) {
        record.summary._racCodexCliOwnerConfirmed = confirmed;
        summaries.push(record.summary);
      }
    }
    return summaries;
  }

  _demoteCodexCliExternalSession(sessionId, session, evidenceType = 'confirmed_owner_gone') {
    if (!sessionId || !session || session.agentType !== 'codex_cli'
        || session.codexCliExternalActive !== true) return false;
    session.codexCliExternalActive = false;
    session.codexCliOwnerDemoted = true;
    const lastEvidenceAt = session.activity?.goal_run?.lease_observed_at
      || session.activity?.updated_at
      || session.activity?.updatedAt
      || new Date().toISOString();
    const {
      thinking: _thinking,
      current: _current,
      thinkingContent: _thinkingContent,
      ...settledActivity
    } = session.activity || {};
    this._setCodexCliActivity(sessionId, session, {
      ...settledActivity,
      kind: 'idle',
      label: '',
      updated_at: lastEvidenceAt,
    }, {
      source: 'codex_cli_native_owner',
      goalSource: session.activity?.goal?.source || 'codex_cli_jsonl',
      observedAt: new Date().toISOString(),
      evidenceType,
      ownerState: 'gone',
      confirmedDisconnect: true,
      liveLeaseProof: false,
    });
    sessionStore.updateSession(sessionId, {
      codex_cli_external_active: false,
      codex_cli_owner_demoted: true,
      activity: session.activity,
    });
    return true;
  }

  _codexCliExternalActiveIds() {
    return new Set(this._codexCliExternalActiveSummaries().map(summary => summary.cliSessionId));
  }

  async _discoverCodexCliSessions() {
    if (!this._codexCliArchiveDiscoveryEnabled()) {
      let changed = false;
      const externalActiveSummaries = this._codexCliExternalActiveSummaries();
      const externalActiveIds = new Set(externalActiveSummaries.map(summary => summary.cliSessionId));
      const activeSummaryOptions = this._codexCliActiveSummaryOptions();
      for (const summary of externalActiveSummaries) {
        const before = this.sessions.size;
        this._registerCodexCliSession(summary, { archiveDiscovered: false, externalActive: true });
        if (this.sessions.size !== before) changed = true;
      }
      const storedSessions = sessionStore.getAllSessions();
      for (const sess of storedSessions) {
        if (sess.agent_type !== 'codex_cli') continue;
        const cliSessionId = sess.cli_session_id || null;
        const isExternalActive = cliSessionId && externalActiveIds.has(cliSessionId);
        const isArchiveOnly = sess.codex_cli_archive_discovered === true && !isExternalActive;
        const isStaleExternal = sess.codex_cli_external_active === true && !isExternalActive;
        if (sess.status === 'healthy' && isStaleExternal) {
          const inMemory = this.sessions.get(sess.session_id);
          if (!inMemory) {
            const lastEvidenceAt = sess.activity?.goal_run?.lease_observed_at
              || sess.activity?.updated_at
              || sess.last_seen_at
              || new Date().toISOString();
            sessionStore.updateSession(sess.session_id, {
              codex_cli_external_active: false,
              codex_cli_owner_demoted: true,
              activity: { ...(sess.activity || {}), kind: 'idle', label: '', updated_at: lastEvidenceAt },
            });
          }
          changed = true;
          continue;
        }
        if (sess.status === 'healthy' && isArchiveOnly) {
          sessionStore.markDisconnected(sess.session_id);
          changed = true;
        }
      }
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType !== 'codex_cli') continue;
        const isExternalActive = session.cliSessionId && externalActiveIds.has(session.cliSessionId);
        if (session.codexCliExternalActive === true && !isExternalActive) {
          if (this._demoteCodexCliExternalSession(sessionId, session)) changed = true;
          continue;
        }
        if ((session.codexCliArchiveDiscovered === true && !isExternalActive)
          || (session.codexCliExternalActive === true && !isExternalActive)) {
          this.sessions.delete(sessionId);
          changed = true;
        }
      }
      for (const sess of sessionStore.getAllSessions()) {
        if (sess.agent_type !== 'codex_cli') continue;
        if (sess.status !== 'healthy') continue;
        if (!sess.cli_session_id) continue;
        if (this.sessions.has(sess.session_id)) continue;
        const externalActive = externalActiveIds.has(sess.cli_session_id);
        if (sess.codex_cli_archive_discovered === true && !externalActive) continue;
        let messages = [];
        let updatedAt = sess.last_seen_at || new Date().toISOString();
        let activity = sess.activity || null;
        const filePath = sess.codex_cli_file_path || null;
        if (filePath && fs.existsSync(filePath)) {
          try {
            const summary = codexCli.readSessionSummary(filePath, externalActive ? activeSummaryOptions : undefined);
            messages = summary?.messages || codexCli.parseCodexJsonl(filePath);
            updatedAt = summary?.updatedAt || fs.statSync(filePath).mtime.toISOString();
            activity = summary?.activity || activity;
          } catch (e) {
            this._log('warn', `[codex-cli] failed to restore transcript ${filePath}: ${e.message}`);
          }
        }
        const before = this.sessions.size;
        this._registerCodexCliSession({
          cliSessionId: sess.cli_session_id,
          filePath,
          workspacePath: sess.workspace_path || process.cwd(),
          workspaceName: sess.workspace_name || 'Codex CLI',
          title: sess.chat_title || 'Codex CLI session',
          messages,
          messageCount: messages.length,
          updatedAt,
          activity,
          model_id: sess.model_id,
          permission_mode: sess.permission_mode,
          effort: sess.effort,
        }, { archiveDiscovered: false, externalActive });
        if (this.sessions.size !== before) changed = true;
      }
      if (changed) this._broadcastSessionSnapshot();
      return;
    }
    const limit = this._codexCliArchiveSessionLimit();
    const scanLimit = limit > 0 ? Math.max(limit * 4, 80) : 0;
    const includeMessages = process.env.CODEX_CLI_HYDRATE_ARCHIVES === 'true';
    const nowMs = Date.now();
    const archiveSummaries = codexCli
      .discoverSessions(scanLimit, { includeMessages })
      .filter(summary => this._codexCliArchiveSummaryVisible(summary, nowMs));
    const {
      externalActiveIds,
      summaries,
    } = mergeCodexCliArchiveDiscoverySummaries(
      this._codexCliExternalActiveSummaries(),
      archiveSummaries,
      limit,
    );
    const visibleCliIds = new Set(summaries.map(summary => summary.cliSessionId).filter(Boolean));
    let changed = false;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.agentType !== 'codex_cli') continue;
      if (session.codexCliExternalActive !== true) continue;
      if (session.cliSessionId && externalActiveIds.has(session.cliSessionId)) continue;
      if (this._demoteCodexCliExternalSession(sessionId, session)) changed = true;
    }
    for (const sess of sessionStore.getAllSessions()) {
      if (sess.agent_type !== 'codex_cli') continue;
      if (sess.status !== 'healthy') continue;
      if (sess.codex_cli_archive_discovered !== true) continue;
      if (sess.cli_session_id && visibleCliIds.has(sess.cli_session_id)) continue;
      if (sess.codex_cli_owner_demoted === true && sess.codex_cli_file_path
          && fs.existsSync(sess.codex_cli_file_path)) continue;
      sessionStore.markDisconnected(sess.session_id);
      changed = true;
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.agentType !== 'codex_cli') continue;
      if (session.codexCliArchiveDiscovered !== true) continue;
      if (session.cliSessionId && visibleCliIds.has(session.cliSessionId)) continue;
      if (session.codexCliOwnerDemoted === true && session.codexCliFilePath
          && fs.existsSync(session.codexCliFilePath)) continue;
      this.sessions.delete(sessionId);
      changed = true;
    }
    for (const summary of summaries) {
      const before = this.sessions.size;
      this._registerCodexCliSession(summary, {
        archiveDiscovered: true,
        externalActive: externalActiveIds.has(summary.cliSessionId),
        sendInitialHistory: summary.messagesHydrated === true,
      });
      if (this.sessions.size !== before) changed = true;
    }
    if (changed) this._broadcastSessionSnapshot();
  }

  _findCodexCliSummaryByCliId(cliSessionId) {
    if (!cliSessionId) return null;
    return codexCli.findSessionByCliId(cliSessionId, this._codexCliActiveSummaryOptions());
  }

  _startCodexCliWatcher() {
    if (this._codexCliWatcher) return;
    if (!this._codexCliMessageDeltaFlagLogged) {
      this._codexCliMessageDeltaFlagLogged = true;
      this._log('info', `[codex-cli] message_delta producer ${this._codexCliMessageDeltaEnabled() ? 'enabled' : 'disabled'} (RAC_CODEX_CLI_MESSAGE_DELTA)`);
    }
    const archiveDiscovery = this._codexCliArchiveDiscoveryEnabled();
    if (!archiveDiscovery && process.env.CODEX_CLI_WATCH_SESSIONS !== 'true') {
      if (!this._codexCliWatcherDisabledLogged) {
        this._codexCliWatcherDisabledLogged = true;
        this._log('info', '[codex-cli] archive watcher disabled; using active CLI history plus polling (set CODEX_CLI_WATCH_SESSIONS=true to opt in)');
      }
      return;
    }
    const watcher = codexCli.watchSessions({
      summaryOptions: this._codexCliActiveSummaryOptions(),
      deferMs: this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS,
      shouldDefer: () => this._hasLatencySensitiveQuestionWindow(),
      onSummary: summary => {
        if (!this._running || !summary?.cliSessionId) return;
        this._reconcileCodexVsCodeQuestionReceiptForCliSession(summary.cliSessionId);
        if (archiveDiscovery && !this._codexCliArchiveSummaryVisible(summary)) return;
        const existing = Array.from(this.sessions.values()).find(s =>
          s.agentType === 'codex_cli' && s.cliSessionId === summary.cliSessionId
        );
        if (!archiveDiscovery && !existing) return;
        const before = this.sessions.size;
        const liveObserved = summary.sourceCursor?.mode === 'append'
          && Number(summary.sourceCursor?.events_read || 0) > 0;
        const session = this._registerCodexCliSession(summary, {
          archiveDiscovered: archiveDiscovery,
          externalActive: existing?.codexCliExternalActive === true,
          liveObserved,
          evidenceType: liveObserved ? 'watch_append' : 'watch_snapshot',
        });
        if (session) {
          const changed = this.sessions.size !== before;
          if (changed || session.last_seen_at === summary.updatedAt) this._broadcastSessionSnapshot();
        }
      },
      onError: err => this._log('warn', `[codex-cli] session watcher: ${err.message}`),
    });
    if (watcher) {
      this._codexCliWatcher = watcher;
      this._log('info', '[codex-cli] watching Codex session store for live JSONL changes');
    } else {
      this._log('warn', '[codex-cli] session watcher unavailable; falling back to periodic polling');
    }
  }

  _extractCodexCliEventText(evt) {
    const item = evt?.item || evt?.message || evt?.delta || evt?.payload || evt;
    const candidates = [
      item?.text,
      item?.content,
      item?.message,
      item?.delta,
      evt?.text,
      evt?.content,
      evt?.delta,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
      if (Array.isArray(candidate)) {
        const text = candidate.map(part => {
          if (typeof part === 'string') return part;
          return part?.text || part?.content || '';
        }).filter(Boolean).join('');
        if (text.trim()) return text;
      }
    }
    return '';
  }

  _codexCliMessageDeltaEnabled() {
    return process.env.RAC_CODEX_CLI_MESSAGE_DELTA === 'true';
  }

  _emitCodexCliMessageDelta(session, sessionId, append, streamTrace) {
    if (!this._codexCliMessageDeltaEnabled() || typeof append !== 'string' || append.length === 0) return false;
    if (!session._codexCliDeltaMessageId) {
      session._codexCliDeltaMessageId = `codex-cli-${crypto.randomUUID()}`;
      session._codexCliDeltaSeq = 0;
      session._codexCliDeltaOpen = true;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._codexCliDeltaMessageId,
        0,
        0,
        'block_open',
      ));
    }
    const chunks = [];
    const maxChunkBytes = 48 * 1024;
    let chunk = '';
    let chunkBytes = 0;
    for (const symbol of append) {
      const symbolBytes = Buffer.byteLength(symbol, 'utf8');
      if (chunk && chunkBytes + symbolBytes > maxChunkBytes) {
        chunks.push(chunk);
        chunk = '';
        chunkBytes = 0;
      }
      chunk += symbol;
      chunkBytes += symbolBytes;
    }
    if (chunk) chunks.push(chunk);
    for (const deltaChunk of chunks) {
      const seq = ++session._codexCliDeltaSeq;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._codexCliDeltaMessageId,
        0,
        seq,
        'append',
        deltaChunk,
        { stream_trace: { ...streamTrace, proxy_sent_at_ms: Date.now() } },
      ));
    }
    return true;
  }

  _closeCodexCliMessageDelta(session, sessionId) {
    if (!this._codexCliMessageDeltaEnabled() || !session._codexCliDeltaOpen || !session._codexCliDeltaMessageId) return false;
    const seq = ++session._codexCliDeltaSeq;
    this._sendToRelay(proto.messageDelta(
      sessionId,
      session._codexCliDeltaMessageId,
      0,
      seq,
      'block_close',
    ));
    session._codexCliDeltaOpen = false;
    return true;
  }

  _handleCodexCliJsonEvent(session, sessionId, line, proxyReadAtMs = Date.now()) {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    if (evt.type === 'thread.started' && evt.thread_id && evt.thread_id !== session.cliSessionId) {
      session.cliSessionId = evt.thread_id;
      sessionStore.updateSession(sessionId, { cli_session_id: evt.thread_id });
      return;
    }
    const itemType = evt.item?.type || evt.message?.type || evt.payload?.type || '';
    const looksAssistantText = itemType === 'agent_message'
      || itemType === 'assistant_message'
      || /agent_message|assistant|message|delta/i.test(String(evt.type || ''));
    if (!looksAssistantText) return;
    const text = this._extractCodexCliEventText(evt);
    if (!text) return;
    const prior = session._codexCliLiveText || '';
    const append = text.startsWith(prior) ? text.slice(prior.length) : text;
    const nextText = text.startsWith(prior) ? text : `${prior}${text}`;
    session._codexCliLiveText = nextText;
    if (!session._codexCliLiveStartedAt) session._codexCliLiveStartedAt = new Date(proxyReadAtMs).toISOString();
    const embeddedNativeAtMs = Number.isFinite(Number(evt.timestamp_ms))
      ? Number(evt.timestamp_ms)
      : Date.parse(evt.timestamp || evt.created_at || '');
    const nativeEventAtMs = Number.isFinite(embeddedNativeAtMs) ? embeddedNativeAtMs : proxyReadAtMs;
    const streamTrace = {
      trace_id: crypto.randomUUID(),
      agent_type: 'codex_cli',
      session_id: sessionId,
      native_event_at_ms: nativeEventAtMs,
      native_timestamp_source: Number.isFinite(embeddedNativeAtMs) ? 'codex_exec_json' : 'codex_exec_stdout_observed',
      proxy_read_at_ms: proxyReadAtMs,
      proxy_normalized_at_ms: Date.now(),
    };
    const streamViaDeltas = this._codexCliMessageDeltaEnabled();
    this._emitCodexCliMessageDelta(session, sessionId, append, streamTrace);
    const activity = {
      kind: 'generating',
      label: 'Codex CLI running',
      current: {
        kind: 'answer',
        label: 'Answering',
        ...(streamViaDeltas
          ? { streaming_transport: 'message_delta' }
          : { partial: nextText }),
        since: session._codexCliLiveStartedAt,
      },
      ...(streamViaDeltas ? {} : { thinkingContent: nextText }),
      updated_at: new Date().toISOString(),
    };
    session.activity = activity;
    const status = proto.proxyStatus(sessionId, session.status || 'healthy', activity);
    status.stream_trace = { ...streamTrace, proxy_sent_at_ms: Date.now() };
    this._sendToRelay(status);
  }

  async _sendCodexCliMessage(session, content, sessionId, sendContext = {}) {
    if (process.env.RAC_CODEX_CLI_APP_SERVER === 'false') {
      return this._sendCodexCliExecMessage(session, content, sessionId, sendContext);
    }
    return this._sendCodexCliAppServerMessage(session, content, sessionId, sendContext);
  }

  async _sendCodexCliAppServerMessage(session, content, sessionId, { clientMessageId = null } = {}) {
    if (session._codexAppServerTurn || session._codexCliChild) {
      return { ok: false, code: 'agent_busy', detail: 'Codex CLI already has an owned turn running' };
    }
    session._codexCliInterrupted = false;
    sessionStore.updateSession(sessionId, { codex_cli_interrupted: false });
    const workspacePath = session.workspace_path || process.cwd();
    const processEpoch = crypto.randomUUID();
    const requestedModel = session.nextSendModelId
      || (session.observedModelId && session.observedModelId !== 'unknown' ? session.observedModelId : null);
    const requestedEffort = session.nextSendEffortError === 'effort_not_advertised_for_model'
      ? null
      : session.nextSendEffort
      || (session.observedEffort && session.observedEffort !== 'unknown' ? session.observedEffort : null);
    const requestedModelCatalogEntry = requestedModel
      ? codexCli.CODEX_CLI_MODELS.find(item => item.id === requestedModel)
      : null;
    if (requestedEffort && requestedModelCatalogEntry?.supported_efforts?.length
        && !requestedModelCatalogEntry.supported_efforts.includes(requestedEffort)) {
      return {
        ok: false,
        code: 'codex_cli_config_incompatible',
        detail: `${requestedModel} does not advertise reasoning effort ${requestedEffort}`,
      };
    }
    const existingSummary = session.codexCliFilePath
      ? null
      : this._findCodexCliSummaryByCliId(session.cliSessionId || null);
    const shouldResume = !!(session.codexCliFilePath || existingSummary?.filePath);
    if (existingSummary?.filePath) {
      session.codexCliFilePath = existingSummary.filePath;
      session.workspace_path = existingSummary.workspacePath || session.workspace_path;
      session.workspace_name = existingSummary.workspaceName || session.workspace_name;
    }
    const receiptBaseline = codexCli.captureCodexReceiptBaseline({
      filePath: session.codexCliFilePath || existingSummary?.filePath || null,
      cliSessionId: shouldResume ? (session.cliSessionId || null) : null,
      workspacePath,
      content,
      clientMessageId,
      processEpoch,
    });
    const turn = this._codexCliAppServerTurnFactory({
      sessionId,
      cwd: workspacePath,
      requestTimeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_APP_SERVER_TIMEOUT_MS) || 120000),
      questionReceiptTimeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_QUESTION_RECEIPT_TIMEOUT_MS) || 30000),
    });
    session._codexAppServerTurn = turn;
    session._codexAppServerTurnCompleted = false;
    session._codexAppServerLastTurnIdentity = null;
    session._codexAppServerTerminalReconciledTurnId = null;
    session._codexAppServerTerminalCompletedAtMs = 0;
    const releaseTurn = async ({ failed = false, detail = null } = {}) => {
      if (session._codexAppServerTurn !== turn) return;
      session._codexAppServerTurn = null;
      session._codexAppServerTurnIdentity = null;
      session._codexAppServerTurnCompleted = false;
      this._clearQuestionPromptAdapter(sessionId, failed ? 'failed' : 'expired', {
        error_code: failed ? 'app_server_disconnected' : 'native_turn_completed',
      });
      if (failed && session._codexCliInterrupted !== true) {
        const activity = { kind: 'idle', label: detail || 'Codex CLI failed', updated_at: new Date().toISOString() };
        session.waitingForAssistant = false;
        this._setCodexCliActivity(sessionId, session, activity);
      }
      try { await turn.stop(); } catch {}
      if (session.messageQueue?.length) await this._processMessageQueue(sessionId);
      this._broadcastSessionSnapshot();
    };
    turn.on('question_prompt', prompt => {
      if (this.sessions.get(sessionId) !== session || session._codexAppServerTurn !== turn) return;
      try {
        this._registerQuestionPromptAdapter(sessionId, prompt, async response => {
          const result = await turn.answerQuestion(response);
          if (result?.native_acknowledged === true) {
            setImmediate(() => {
              if (this.sessions.get(sessionId) !== session || session._codexAppServerTurn !== turn) return;
              this._setCodexCliActivity(sessionId, session, {
                kind: 'generating',
                label: 'Codex CLI running',
                updated_at: new Date().toISOString(),
              });
            });
          }
          return result;
        });
        session.waitingForAssistant = true;
        this._setCodexCliActivity(sessionId, session, {
          kind: 'waiting_for_user',
          label: 'Answer required',
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        this._log('warn', `[codex-cli] question adapter rejected for ${sessionId}: ${error.message}`);
      }
    });
    turn.on('question_error', error => {
      this._log('warn', `[codex-cli] native question rejected for ${sessionId}: ${error.code || error.message}`);
    });
    turn.on('unsupported_server_request', request => {
      this._log('warn', `[codex-cli] unsupported app-server request for ${sessionId}: ${request.method || 'unknown'}`);
    });
    turn.on('turn_completed', completion => {
      if (this.sessions.get(sessionId) !== session || session._codexAppServerTurn !== turn) return;
      session._codexAppServerTurnCompleted = true;
      const completedAtMs = Date.parse(completion.completed_at || '');
      session._codexAppServerTerminalCompletedAtMs = Number.isFinite(completedAtMs)
        ? Math.max(Number(session._codexAppServerTerminalCompletedAtMs || 0), completedAtMs)
        : Date.now();
      session.waitingForAssistant = false;
      this._closeCodexCliMessageDelta(session, sessionId);
      this._setCodexCliActivity(sessionId, session, {
        kind: 'idle',
        label: completion.status === 'failed' ? 'Codex CLI failed' : '',
        updated_at: new Date().toISOString(),
      });
      releaseTurn({ failed: completion.status === 'failed' }).catch(error => {
        this._log('warn', `[codex-cli] app-server turn cleanup failed for ${sessionId}: ${error.message}`);
      });
    });
    turn.on('disconnect', details => {
      if (details.expected || this.sessions.get(sessionId) !== session || session._codexAppServerTurn !== turn) return;
      releaseTurn({ failed: true, detail: 'Codex app-server disconnected' }).catch(() => {});
    });

    session._codexCliPendingReceipt = {
      baseline: receiptBaseline,
      state: 'launch_accepted',
      updated_at: new Date().toISOString(),
    };
    try {
      const started = await turn.start({
        threadId: shouldResume ? (session.cliSessionId || null) : null,
        content,
        model: requestedModel,
        effort: requestedEffort,
        sandbox: session.permission_mode,
        clientMessageId,
        collaborationMode: session.codexCliCollaborationMode || null,
      });
      if (this.sessions.get(sessionId) !== session || session._codexAppServerTurn !== turn) {
        await releaseTurn({ failed: true, detail: 'Codex CLI session changed during app-server startup' });
        return { ok: false, code: 'session_gone', detail: 'Codex CLI session changed during app-server startup' };
      }
      session.cliSessionId = started.thread_id;
      session.codexCliFilePath = started.thread_path || session.codexCliFilePath || null;
      session._codexAppServerTurnIdentity = {
        thread_id: started.thread_id,
        turn_id: started.turn_id,
        process_epoch: processEpoch,
      };
      session._codexAppServerLastTurnIdentity = { ...session._codexAppServerTurnIdentity };
      receiptBaseline.cli_session_id = started.thread_id;
      if (started.thread_path) receiptBaseline.file_path = started.thread_path;
      session._codexCliPendingReceipt = {
        ...session._codexCliPendingReceipt,
        state: 'native_user_turn_observed',
        native_receipt: started.native_receipt,
        updated_at: new Date().toISOString(),
      };
      if (session.nextSendModelId) {
        session.nextSendModelStatus = 'applying';
        session.nextSendModelError = null;
      }
      if (session.nextSendEffort) {
        session.nextSendEffortStatus = 'applying';
        session.nextSendEffortError = null;
      }
      session.waitingForAssistant = true;
      this._setCodexCliActivity(sessionId, session, {
        kind: 'generating',
        label: 'Codex CLI running',
        updated_at: new Date().toISOString(),
      });
      sessionStore.updateSession(sessionId, {
        cli_session_id: started.thread_id,
        codex_cli_file_path: session.codexCliFilePath,
        codex_cli_pending_receipt: session._codexCliPendingReceipt,
        codex_cli_next_model_status: session.nextSendModelStatus || 'unset',
        codex_cli_next_model_error: null,
        codex_cli_next_effort_status: session.nextSendEffortStatus || 'unset',
        codex_cli_next_effort_error: null,
      });
      this._publishCodexCliConfig(sessionId, session);
      if (clientMessageId) {
        this._sendToRelay(proto.proxySendResult(sessionId, clientMessageId, 'launch_accepted', {
          lifecycle: 'proxy_launch_accepted',
          process_epoch: processEpoch,
          accepted_at: new Date().toISOString(),
        }));
      }
      return {
        ok: true,
        lifecycle_managed: true,
        native_receipt: started.native_receipt,
        process_epoch: processEpoch,
        agent_start_promise: Promise.resolve({
          ok: true,
          receipt: started.native_receipt,
          agent_started: {
            kind: 'turn_started',
            thread_id: started.thread_id,
            turn_id: started.turn_id,
            observed_at: started.native_receipt.observed_at,
          },
        }),
      };
    } catch (error) {
      await releaseTurn({ failed: true, detail: 'Codex app-server launch failed' });
      this._log('warn', `[codex-cli] app-server send failed for ${sessionId}: ${error.code || error.message}`);
      return {
        ok: false,
        code: error.code || 'codex_app_server_send_failed',
        detail: error.message || 'Codex app-server could not start the owned turn',
        lifecycle_managed: true,
        process_epoch: processEpoch,
      };
    }
  }

  async _sendCodexCliExecMessage(session, content, sessionId, { clientMessageId = null } = {}) {
    if (session._codexCliChild) {
      return { ok: false, code: 'agent_busy', detail: 'Codex CLI process is already running' };
    }
    session._codexCliInterrupted = false;
    sessionStore.updateSession(sessionId, { codex_cli_interrupted: false });
    let cliSessionId = session.cliSessionId || null;
    const existingSummary = session.codexCliFilePath
      ? null
      : this._findCodexCliSummaryByCliId(cliSessionId);
    const shouldResume = !!(session.codexCliFilePath || existingSummary?.filePath);
    if (existingSummary?.filePath) {
      session.codexCliFilePath = existingSummary.filePath;
      session.workspace_path = existingSummary.workspacePath || session.workspace_path;
      session.workspace_name = existingSummary.workspaceName || session.workspace_name;
    }
    if (!shouldResume) cliSessionId = null;
    if (cliSessionId) {
      session.cliSessionId = cliSessionId;
      sessionStore.updateSession(sessionId, { cli_session_id: cliSessionId });
    }
    const workspacePath = session.workspace_path || process.cwd();
    const startedAtMs = Date.now();
    const processEpoch = crypto.randomUUID();
    const requestedModel = session.nextSendModelId
      || (session.observedModelId && session.observedModelId !== 'unknown' ? session.observedModelId : null);
    const requestedEffort = session.nextSendEffortError === 'effort_not_advertised_for_model'
      ? null
      : session.nextSendEffort
      || (session.observedEffort && session.observedEffort !== 'unknown' ? session.observedEffort : null);
    const requestedModelCatalogEntry = requestedModel
      ? codexCli.CODEX_CLI_MODELS.find(item => item.id === requestedModel)
      : null;
    if (requestedEffort && requestedModelCatalogEntry?.supported_efforts?.length
        && !requestedModelCatalogEntry.supported_efforts.includes(requestedEffort)) {
      return {
        ok: false,
        code: 'codex_cli_config_incompatible',
        detail: `${requestedModel} does not advertise reasoning effort ${requestedEffort}`,
      };
    }
    const receiptBaseline = codexCli.captureCodexReceiptBaseline({
      filePath: session.codexCliFilePath || existingSummary?.filePath || null,
      cliSessionId: cliSessionId || null,
      workspacePath,
      content,
      clientMessageId,
      processEpoch,
    });
    const exitState = { exited: false, code: null, error: null, stderr: '' };
    session._codexCliActiveLaunchConfig = {
      model_id: requestedModel,
      effort: requestedEffort,
      source: 'owned_active_resume_launch_args',
      process_epoch: processEpoch,
      launched_at: new Date(startedAtMs).toISOString(),
    };
    session._codexCliDeltaMessageId = null;
    session._codexCliDeltaSeq = -1;
    session._codexCliDeltaOpen = false;
    const stderrChunks = [];
    let stdoutBuffer = '';
    let child;
    try {
      child = codexCli.startCodexExecSession({
        workspacePath,
        cliSessionId,
        resume: shouldResume,
        content,
        model: requestedModel,
        effort: requestedEffort,
        permissionMode: session.permission_mode,
        onStdout: chunk => {
          stdoutBuffer += chunk || '';
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) {
              this._handleCodexCliJsonEvent(session, sessionId, line);
              if (!receiptBaseline.cli_session_id && session.cliSessionId) {
                receiptBaseline.cli_session_id = session.cliSessionId;
              }
            }
          }
        },
        onStderr: chunk => { if (chunk) stderrChunks.push(chunk); },
        onExit: (code, err) => {
          exitState.exited = true;
          exitState.code = code;
          exitState.error = err || null;
          exitState.stderr = stderrChunks.join('');
          if (stdoutBuffer.trim()) {
            this._handleCodexCliJsonEvent(session, sessionId, stdoutBuffer.trim());
            if (!receiptBaseline.cli_session_id && session.cliSessionId) {
              receiptBaseline.cli_session_id = session.cliSessionId;
            }
            stdoutBuffer = '';
          }
          this._closeCodexCliMessageDelta(session, sessionId);
          const wasInterrupted = session._codexCliInterrupted === true;
          if (session._codexCliChild === child) session._codexCliChild = null;
        (async () => {
          const resolvedCliSessionId = session.cliSessionId || cliSessionId;
          let summary = this._findCodexCliSummaryByCliId(resolvedCliSessionId)
            || codexCli.findLatestSessionForWorkspace(workspacePath, startedAtMs - 5000, this._codexCliActiveSummaryOptions());
          for (let attempt = 0; code === 0 && !summary && attempt < 8; attempt++) {
            await sleep(250);
            summary = this._findCodexCliSummaryByCliId(resolvedCliSessionId)
              || codexCli.findLatestSessionForWorkspace(workspacePath, startedAtMs - 5000, this._codexCliActiveSummaryOptions());
          }
          if (summary) {
            session.cliSessionId = summary.cliSessionId;
            session.codexCliFilePath = summary.filePath;
            session.workspace_path = summary.workspacePath || session.workspace_path;
            session.workspace_name = summary.workspaceName || session.workspace_name;
            session.chat_title = summary.title || session.chat_title;
            session.codexCliArchiveDiscovered = false;
            this._registerCodexCliSession(summary, { sendInitialHistory: false });
            const effectiveMessages = summary.messages?.length ? summary.messages : this._codexCliPendingTranscriptMessages(session);
            session.lastMessageCount = effectiveMessages.length;
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = this._transcriptSignature(effectiveMessages);
            this._applyCodexCliSummaryMetadata(sessionId, session, summary);
          } else if (!wasInterrupted) {
            const stderr = stderrChunks.join('').trim();
            this._sendToRelay(proto.proxyMessage(
              sessionId,
              'assistant',
              code === 0 && !err
                ? 'Codex CLI exited without producing a transcript file for this session.'
                : `Codex CLI failed to start or complete the request.\n\n${stderr || err?.message || `Codex CLI exited with code ${code}`}`,
              { created_at: new Date().toISOString() },
            ));
          }
          const activity = { kind: 'idle', label: summary || wasInterrupted ? (wasInterrupted ? 'Interrupted' : '') : 'Codex CLI failed', updated_at: new Date().toISOString() };
          session.activity = activity;
          session._codexCliActiveLaunchConfig = null;
          session._codexCliLiveText = '';
          session._codexCliLiveStartedAt = null;
          session.waitingForAssistant = false;
          sessionStore.updateSession(sessionId, {
            activity,
            workspace_path: session.workspace_path || null,
            workspace_name: session.workspace_name || null,
            cli_session_id: session.cliSessionId || cliSessionId || null,
            codex_cli_file_path: session.codexCliFilePath || null,
            codex_cli_archive_discovered: false,
          });
          this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
          this._publishCodexCliConfig(sessionId, session);
          // Parsed task completion can publish idle just before the native
          // process exits. A relay send in that narrow window is queued by
          // _sendCodexCliMessage; drain it now that the child is cleared so
          // the queued turn cannot remain stranded indefinitely.
          if (session.messageQueue?.length) {
            await this._processMessageQueue(sessionId);
          }
          this._broadcastSessionSnapshot();
        })().catch(exitErr => {
          this._log('warn', `[codex-cli] send exit handler failed: ${exitErr.message}`);
        });
      },
      });
    } catch (e) {
      this._log('warn', `[codex-cli] failed to spawn Codex CLI for ${sessionId}: ${e.message}`);
      session._codexCliActiveLaunchConfig = null;
      return { ok: false, code: 'codex_cli_spawn_failed', detail: e.message };
    }
    session._codexCliChild = child;
    session._codexCliPendingReceipt = {
      baseline: receiptBaseline,
      state: 'launch_accepted',
      updated_at: new Date().toISOString(),
    };
    if (session.nextSendModelId) {
      session.nextSendModelStatus = 'applying';
      session.nextSendModelError = null;
    }
    if (session.nextSendEffort) {
      session.nextSendEffortStatus = 'applying';
      session.nextSendEffortError = null;
    }
    sessionStore.updateSession(sessionId, {
      codex_cli_next_model_status: session.nextSendModelStatus || 'unset',
      codex_cli_next_model_error: null,
      codex_cli_next_effort_status: session.nextSendEffortStatus || 'unset',
      codex_cli_next_effort_error: null,
      codex_cli_active_launch_config: session._codexCliActiveLaunchConfig,
      codex_cli_pending_receipt: session._codexCliPendingReceipt,
    });
    this._publishCodexCliConfig(sessionId, session);
    if (clientMessageId) {
      this._sendToRelay(proto.proxySendResult(sessionId, clientMessageId, 'launch_accepted', {
        lifecycle: 'proxy_launch_accepted',
        process_epoch: processEpoch,
        accepted_at: new Date().toISOString(),
      }));
    }
    const receiptResult = await codexCli.waitForCodexReceipt(receiptBaseline, {
      timeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_RECEIPT_TIMEOUT_MS) || 30000),
      childState: () => ({ ...exitState, stderr: exitState.stderr || stderrChunks.join('') }),
    });
    if (!receiptResult.ok) {
      session._codexCliPendingReceipt = {
        ...session._codexCliPendingReceipt,
        state: 'failed_pending_late_receipt',
        failure_code: receiptResult.code || 'native_user_turn_not_observed',
        updated_at: new Date().toISOString(),
      };
      if (session.nextSendModelId) {
        session.nextSendModelStatus = 'failed';
        session.nextSendModelError = receiptResult.code;
      }
      if (session.nextSendEffort) {
        session.nextSendEffortStatus = 'failed';
        session.nextSendEffortError = receiptResult.code;
      }
      sessionStore.updateSession(sessionId, {
        codex_cli_next_model_status: session.nextSendModelStatus || 'unset',
        codex_cli_next_model_error: session.nextSendModelError || null,
        codex_cli_next_effort_status: session.nextSendEffortStatus || 'unset',
        codex_cli_next_effort_error: session.nextSendEffortError || null,
        codex_cli_pending_receipt: session._codexCliPendingReceipt,
      });
      this._publishCodexCliConfig(sessionId, session);
      return {
        ok: false,
        code: receiptResult.code || 'native_user_turn_not_observed',
        detail: receiptResult.detail || 'Exact native Codex user-turn receipt was not observed',
        lifecycle_managed: true,
        process_epoch: processEpoch,
      };
    }
    session._codexCliPendingReceipt = {
      ...session._codexCliPendingReceipt,
      state: 'native_user_turn_observed',
      native_receipt: receiptResult.receipt,
      updated_at: new Date().toISOString(),
    };
    sessionStore.updateSession(sessionId, {
      codex_cli_pending_receipt: session._codexCliPendingReceipt,
    });
    const agentStartPromise = receiptResult.agent_started
      ? Promise.resolve({ ok: true, agent_started: receiptResult.agent_started, receipt: receiptResult.receipt })
      : codexCli.waitForCodexAgentStart(receiptBaseline, receiptResult.receipt, {
        timeoutMs: Math.max(1000, Number(process.env.CODEX_CLI_AGENT_START_TIMEOUT_MS) || 120000),
      });
    return {
      ok: true,
      lifecycle_managed: true,
      native_receipt: receiptResult.receipt,
      process_epoch: processEpoch,
      agent_start_promise: agentStartPromise,
    };
  }

  // ─── Cursor CLI session helpers ──────────────────────────────────────────

  _cursorCliPendingTranscriptMessages(session) {
    const workspaceName = session.workspace_name || session.workspaceName || 'the selected workspace';
    const model = session.model_id && session.model_id !== 'default' ? session.model_id : 'Default';
    const permissionMode = session.permission_mode || 'default';
    const backgroundReady = session.nativeCliStatus === 'background_ready';
    return [{
      role: 'assistant',
      content: [
        '**Cursor CLI is waiting for a native transcript.**',
        '',
        `Workspace: ${workspaceName}`,
        `Model: ${model}`,
        `Permission mode: ${permissionMode}`,
        '',
        ...(backgroundReady ? ['Background mode is ready. Send the first message to start the hidden Cursor CLI runner; no native terminal window will be opened.', ''] : []),
        'Once Cursor Agent creates or updates the JSONL transcript file, this placeholder will be replaced with the real CLI chat history.',
      ].join('\n'),
      ts: session.nativeCliStartedAt ? Math.floor(new Date(session.nativeCliStartedAt).getTime() / 1000) : undefined,
    }];
  }

  _setCursorCliActivity(sessionId, session, activity, { producerObserved = false, observedAt = null } = {}) {
    const observedActivityBase = activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() };
    const observedActivity = producerObserved
      ? { ...observedActivityBase, observed_at: observedAt || new Date().toISOString() }
      : observedActivityBase;
    const nextActivity = session._cursorCliInterrupted === true
      ? { kind: 'idle', label: 'Interrupted', updated_at: session.activity?.updated_at || new Date().toISOString() }
      : observedActivity;
    const prevSig = this._activitySemanticSignature(session.activity || null);
    const nextSig = this._activitySemanticSignature({
      ...nextActivity,
      observed_at: session.activity?.observed_at,
    });
    if (prevSig === nextSig) {
      return producerObserved
        ? this._emitActivityObservationHeartbeat(sessionId, session, { observedAt: observedActivity.observed_at })
        : false;
    }
    session.activity = nextActivity;
    if (nextActivity.thinkingContent) session.thinkingContent = nextActivity.thinkingContent;
    else session.thinkingContent = '';
    sessionStore.updateSession(sessionId, { activity: nextActivity });
    this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', nextActivity));
    return true;
  }

  _buildCursorCliSessionFromSummary(sessionMeta, summary) {
    const now = new Date().toISOString();
    const interrupted = sessionMeta.cursor_cli_interrupted === true;
    return {
      session_id: sessionMeta.session_id,
      display_name: sessionMeta.display_name || 'Cursor CLI',
      workspace_name: summary.workspaceName || sessionMeta.workspace_name,
      workspace_path: summary.workspacePath || sessionMeta.workspace_path,
      machine_label: sessionMeta.machine_label,
      target_signature: sessionMeta.target_signature,
      chat_title: summary.title || null,
      client: null,
      lastMessageCount: summary.messageCount || 0,
      lastObservedCount: summary.messageCount || 0,
      lastTranscriptSig: this._transcriptSignature(summary.messages || []),
      nullPollCount: 0,
      waitingForAssistant: false,
      thinking: false,
      thinkingLabel: '',
      autoApprovePermissions: false,
      status: 'healthy',
      activity: interrupted
        ? { kind: 'idle', label: 'Interrupted', updated_at: sessionMeta.activity?.updated_at || now }
        : (summary.activity || sessionMeta.activity || { kind: 'idle', label: '', updated_at: now }),
      last_seen_at: summary.updatedAt || now,
      windowTitle: sessionMeta.window_title || summary.workspaceName || 'Cursor CLI',
      agentType: 'cursor_cli',
      parentId: null,
      ext: null,
      targetId: null,
      cliSessionId: summary.cliSessionId,
      cursorCliFilePath: summary.filePath,
      cursorCliArchiveDiscovered: sessionMeta.cursor_cli_archive_discovered === true,
      nativeCliStartedAt: sessionMeta.native_cli_started_at || summary.nativeCliStartedAt || null,
      nativeCliStatus: sessionMeta.native_cli_status || summary.nativeCliStatus || null,
      nativeCliWindowOpened: sessionMeta.native_cli_window_opened === true || summary.nativeCliWindowOpened === true,
      cursorCliChatCreated: sessionMeta.cursor_cli_chat_created === true || summary.cursorCliChatCreated === true,
      model_id: sessionMeta.model_id || summary.model_id || 'grok-4.5-fast-high',
      permission_mode: sessionMeta.permission_mode || summary.permission_mode || 'force',
      sandbox: sessionMeta.sandbox || summary.sandbox || 'disabled',
      cursorCliModelConfigured: sessionMeta.cursor_cli_model_configured === true,
      cursorCliPermissionConfigured: sessionMeta.cursor_cli_permission_configured === true,
      _fileTranscriptState: this._fileTranscriptState(
        'cursor_cli', summary.filePath, summary.messages || [], summary.sourceCursor || null
      ),
      _cursorCliInterrupted: interrupted,
    };
  }

  _startClaudeCliWatcher() {
    if (!this._claudeCliMessageDeltaFlagLogged) {
      this._claudeCliMessageDeltaFlagLogged = true;
      this._log('info', `[claude-cli] message_delta producer ${this._claudeCliMessageDeltaEnabled() ? 'enabled' : 'disabled'} (RAC_CLAUDE_CLI_MESSAGE_DELTA)`);
    }
    if (this._claudeCliWatcher) return;
    const watcher = claudeCli.watchSessions(summary => {
      if (!this._running || !summary?.cliSessionId) return;
      const existing = Array.from(this.sessions.values()).find(session =>
        session.agentType === 'claude_cli' && session.cliSessionId === summary.cliSessionId
      );
      const before = this.sessions.size;
      const session = this._registerClaudeCliSession(summary, {
        sendInitialHistory: false,
        archiveDiscovered: existing?.claudeCliArchiveDiscovered === true,
      });
      if (session && (this.sessions.size !== before || session.last_seen_at === summary.updatedAt)) {
        this._broadcastSessionSnapshot();
      }
    }, { onError: error => this._log('warn', `[claude-cli] session watcher: ${error.message}`) });
    if (watcher) {
      this._claudeCliWatcher = watcher;
      this._log('info', '[claude-cli] watching Claude session store for live JSONL changes');
    } else {
      this._log('warn', '[claude-cli] session watcher unavailable; falling back to periodic polling');
    }
  }

  _applyCursorCliSummaryMetadata(sessionId, session, summary) {
    if (!session || !summary) return false;
    let changed = false;
    const nextWorkspaceName = summary.workspaceName || session.workspace_name;
    const nextWorkspacePath = summary.workspacePath || session.workspace_path;
    const nextChatTitle = summary.title || session.chat_title;
    if (nextWorkspaceName && nextWorkspaceName !== session.workspace_name) {
      session.workspace_name = nextWorkspaceName;
      changed = true;
    }
    if (nextWorkspacePath && nextWorkspacePath !== session.workspace_path) {
      session.workspace_path = nextWorkspacePath;
      changed = true;
    }
    if (nextChatTitle && nextChatTitle !== session.chat_title) {
      session.chat_title = nextChatTitle;
      changed = true;
    }
    if (summary.updatedAt && summary.updatedAt !== session.last_seen_at) {
      session.last_seen_at = summary.updatedAt;
    }
    if (summary.filePath && summary.filePath !== session.cursorCliFilePath) {
      session.cursorCliFilePath = summary.filePath;
      changed = true;
    }
    if (session.cursorCliModelConfigured !== true && summary.model_id && summary.model_id !== session.model_id) {
      session.model_id = summary.model_id;
      changed = true;
    }
    if (session.cursorCliPermissionConfigured !== true && summary.permission_mode && summary.permission_mode !== session.permission_mode) {
      session.permission_mode = summary.permission_mode;
      changed = true;
    }
    if (changed) {
      session.windowTitle = session.workspace_name || session.windowTitle || 'Cursor CLI';
      sessionStore.updateSession(sessionId, {
        workspace_path: session.workspace_path || null,
        workspace_name: session.workspace_name || null,
        window_title: session.windowTitle || null,
        chat_title: session.chat_title || null,
        cursor_cli_file_path: session.cursorCliFilePath || null,
        model_id: session.model_id || null,
        permission_mode: session.permission_mode || null,
      });
    }
    return changed;
  }

  _registerCursorCliSession(summary, { sendInitialHistory = true, archiveDiscovered = false } = {}) {
    if (!summary?.cliSessionId) return null;
    const displayName = 'Cursor CLI';
    const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const pendingEntry = Array.from(this.sessions.entries()).find(([, s]) =>
      s.agentType === 'cursor_cli'
      && !s.cursorCliFilePath
      && norm(s.workspace_path) === norm(summary.workspacePath)
      && (s.cliSessionId === summary.cliSessionId || s.nativeCliWindowOpened === true || s._cursorCliChild)
    );
    if (pendingEntry) {
      const [sessionId, existing] = pendingEntry;
      const metaChanged = this._applyCursorCliSummaryMetadata(sessionId, existing, summary);
      existing.cursorCliArchiveDiscovered = archiveDiscovered === true;
      if (summary.cursorCliChatCreated === true) existing.cursorCliChatCreated = true;
      existing.cliSessionId = summary.cliSessionId;
      if (existing.cursorCliModelConfigured !== true && summary.model_id) existing.model_id = summary.model_id;
      if (!(this._cursorCliMessageDeltaEnabled() && existing._cursorCliChild)) {
        this._setCursorCliActivity(sessionId, existing, summary.activity);
      }
      sessionStore.updateSession(sessionId, {
        cli_session_id: existing.cliSessionId,
        cursor_cli_file_path: existing.cursorCliFilePath || null,
        cursor_cli_archive_discovered: archiveDiscovered === true,
        cursor_cli_chat_created: existing.cursorCliChatCreated === true || undefined,
        chat_title: existing.chat_title || null,
        workspace_path: existing.workspace_path || null,
        workspace_name: existing.workspace_name || null,
      });
      if (metaChanged) this._broadcastSessionSnapshot();
      if (cursorCli.shouldApplyCursorSummaryHistory(summary, sendInitialHistory)) {
        const effectiveMessages = (summary.messages || []).length > 0 ? summary.messages : this._cursorCliPendingTranscriptMessages(existing);
        const sig = this._transcriptSignature(effectiveMessages);
        if (sig !== existing.lastTranscriptSig) {
          const reason = shouldPrioritizeCliAssistantSnapshot(existing.lastObservedCount, effectiveMessages)
            ? 'assistant completion'
            : 'cursor cli file attached';
          existing.lastTranscriptSig = sig;
          existing.lastObservedCount = effectiveMessages.length;
          existing.lastMessageCount = effectiveMessages.length;
          const provisionalStreamActive = this._cursorCliMessageDeltaEnabled()
            && existing._cursorCliChild;
          if (!provisionalStreamActive) {
            this._sendFileBackedTranscriptUpdate(sessionId, existing, effectiveMessages, {
              agentType: 'cursor_cli', filePath: summary.filePath,
              sourceCursor: summary.sourceCursor, reason, allowInitialAppend: true,
            });
          }
        }
      }
      return existing;
    }
    const storedConfig = sessionStore.getAllSessions().find(sess => (
      sess.agent_type === 'cursor_cli'
      && (sess.cli_session_id === summary.cliSessionId || sess.virtual_id === `cursor-cli:${summary.cliSessionId}`)
    ));
    const sessionMeta = sessionStore.resolveVirtualSession({
      virtualId: `cursor-cli:${summary.cliSessionId}`,
      agentType: 'cursor_cli',
      displayName,
      workspaceName: summary.workspaceName,
      workspacePath: summary.workspacePath,
      windowTitle: summary.workspaceName || displayName,
      extra: {
        cli_session_id: summary.cliSessionId,
        cursor_cli_file_path: summary.filePath,
        cursor_cli_archive_discovered: archiveDiscovered === true,
        cursor_cli_chat_created: summary.cursorCliChatCreated === true || undefined,
        chat_title: summary.title || null,
        model_id: storedConfig?.cursor_cli_model_configured === true ? undefined : (summary.model_id || undefined),
        permission_mode: storedConfig?.cursor_cli_permission_configured === true ? undefined : (summary.permission_mode || undefined),
        native_cli_started_at: summary.nativeCliStartedAt || undefined,
        native_cli_status: summary.nativeCliStatus || undefined,
        native_cli_window_opened: summary.nativeCliWindowOpened === true || undefined,
      },
    });
    const sessionId = sessionMeta.session_id;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      const metaChanged = this._applyCursorCliSummaryMetadata(sessionId, existing, summary);
      existing.cursorCliArchiveDiscovered = archiveDiscovered === true;
      if (summary.cursorCliChatCreated === true) existing.cursorCliChatCreated = true;
      existing.cliSessionId = summary.cliSessionId;
      if (existing.cursorCliModelConfigured !== true && summary.model_id) existing.model_id = summary.model_id;
      if (existing.cursorCliPermissionConfigured !== true && summary.permission_mode) existing.permission_mode = summary.permission_mode;
      if (!(this._cursorCliMessageDeltaEnabled() && existing._cursorCliChild)) {
        this._setCursorCliActivity(sessionId, existing, summary.activity);
      }
      if (metaChanged) this._broadcastSessionSnapshot();
      if (cursorCli.shouldApplyCursorSummaryHistory(summary, sendInitialHistory)) {
        const summaryMessages = summary.messages || [];
        const effectiveMessages = summaryMessages.length > 0 ? summaryMessages : this._cursorCliPendingTranscriptMessages(existing);
        const sig = this._transcriptSignature(effectiveMessages);
        if (sig !== existing.lastTranscriptSig) {
          const reason = shouldPrioritizeCliAssistantSnapshot(existing.lastObservedCount, effectiveMessages)
            ? 'assistant completion'
            : 'cursor cli file changed';
          existing.lastTranscriptSig = sig;
          existing.lastObservedCount = effectiveMessages.length;
          existing.lastMessageCount = effectiveMessages.length;
          const provisionalStreamActive = this._cursorCliMessageDeltaEnabled()
            && existing._cursorCliChild;
          if (!provisionalStreamActive) {
            this._sendFileBackedTranscriptUpdate(sessionId, existing, effectiveMessages, {
              agentType: 'cursor_cli', filePath: summary.filePath,
              sourceCursor: summary.sourceCursor, reason,
            });
          }
        }
      }
      return existing;
    }
    const session = this._buildCursorCliSessionFromSummary(sessionMeta, summary);
    this.sessions.set(sessionId, session);
    sessionStore.updateSession(sessionId, { activity: session.activity });
    this._log('info', `[cursor-cli] registered ${sessionId} cli=${summary.cliSessionId} (${summary.messageCount} msgs)`);
    if (sendInitialHistory) {
      const initialMessages = summary.messages?.length ? summary.messages : this._cursorCliPendingTranscriptMessages(session);
      session.lastTranscriptSig = this._transcriptSignature(initialMessages);
      session.lastObservedCount = initialMessages.length;
      session.lastMessageCount = initialMessages.length;
    }
    const cfg = this._decorateAgentConfig(session, this._mergeAgentConfig('cursor_cli', {
      model_id: session.model_id,
      permission_mode: session.permission_mode,
      sandbox: session.sandbox,
    }, session.workspace_path));
    this._sendToRelay(proto.agentConfig(sessionId, { ...cfg, capabilities: this._buildCapabilities('cursor_cli') }));
    return session;
  }

  _cursorCliArchiveDiscoveryEnabled() {
    return process.env.CURSOR_CLI_DISCOVER_ARCHIVES !== 'false';
  }

  _cursorCliArchiveSessionLimit() {
    const limit = parseInt(process.env.CURSOR_CLI_SESSION_LIMIT || '20', 10);
    return Number.isFinite(limit) && limit >= 0 ? limit : 20;
  }

  _cursorCliArchiveMaxAgeMs() {
    const hours = Number(process.env.CURSOR_CLI_ARCHIVE_MAX_AGE_HOURS || '72');
    if (!Number.isFinite(hours) || hours < 0) return 72 * 60 * 60 * 1000;
    return hours === 0 ? 0 : hours * 60 * 60 * 1000;
  }

  _cursorCliArchiveSummaryVisible(summary, nowMs = Date.now()) {
    const maxAgeMs = this._cursorCliArchiveMaxAgeMs();
    if (!maxAgeMs) return true;
    const updatedMs = Date.parse(summary?.updatedAt || summary?.startedAt || '');
    if (!Number.isFinite(updatedMs)) return true;
    return nowMs - updatedMs <= maxAgeMs;
  }

  _cursorCliActiveSummaryOptions() {
    return {
      maxHydrateBytes: cursorCli.CURSOR_CLI_ACTIVE_HYDRATE_MAX_BYTES,
      preferTailBytes: cursorCli.CURSOR_CLI_ACTIVE_HYDRATE_TAIL_BYTES,
    };
  }

  async _discoverCursorCliSessions() {
    const limit = this._cursorCliArchiveSessionLimit();
    const scanLimit = limit > 0 ? Math.max(limit * 4, 80) : 0;
    const includeMessages = process.env.CURSOR_CLI_HYDRATE_ARCHIVES === 'true';
    const nowMs = Date.now();
    const archiveDiscovery = this._cursorCliArchiveDiscoveryEnabled();
    let changed = false;

    if (!archiveDiscovery) {
      // Restore only previously-known healthy sessions from the session store
      for (const sess of sessionStore.getAllSessions()) {
        if (sess.agent_type !== 'cursor_cli') continue;
        if (sess.status !== 'healthy') continue;
        if (!sess.cli_session_id) continue;
        if (this.sessions.has(sess.session_id)) continue;
        let messages = [];
        let updatedAt = sess.last_seen_at || new Date().toISOString();
        let activity = sess.activity || null;
        const filePath = sess.cursor_cli_file_path || null;
        if (filePath && fs.existsSync(filePath)) {
          try {
            const summary = cursorCli.readSessionSummary(filePath, this._cursorCliActiveSummaryOptions());
            messages = summary?.messages || cursorCli.parseCursorJsonl(filePath);
            updatedAt = summary?.updatedAt || fs.statSync(filePath).mtime.toISOString();
            activity = summary?.activity || activity;
          } catch (e) {
            this._log('warn', `[cursor-cli] failed to restore transcript ${filePath}: ${e.message}`);
          }
        }
        const before = this.sessions.size;
        this._registerCursorCliSession({
          cliSessionId: sess.cli_session_id,
          filePath,
          workspacePath: sess.workspace_path || process.cwd(),
          workspaceName: sess.workspace_name || 'Cursor CLI',
          title: sess.chat_title || 'Cursor CLI session',
          messages,
          messageCount: messages.length,
          updatedAt,
          activity,
          model_id: sess.model_id,
          permission_mode: sess.permission_mode,
          cursorCliChatCreated: sess.cursor_cli_chat_created === true,
        }, { archiveDiscovered: false });
        const restored = this.sessions.get(sess.session_id);
        if (restored && sess.cursor_cli_chat_created === true) {
          restored.cursorCliChatCreated = true;
        }
        if (this.sessions.size !== before) changed = true;
      }
      if (changed) this._broadcastSessionSnapshot();
      return;
    }

    const summaries = cursorCli
      .discoverSessions(scanLimit, { includeMessages })
      .filter(summary => this._cursorCliArchiveSummaryVisible(summary, nowMs))
      .slice(0, limit > 0 ? limit : undefined);
    const visibleCliIds = new Set(summaries.map(summary => summary.cliSessionId).filter(Boolean));
    for (const sess of sessionStore.getAllSessions()) {
      if (sess.agent_type !== 'cursor_cli') continue;
      if (sess.status !== 'healthy') continue;
      if (sess.cursor_cli_archive_discovered !== true) continue;
      if (sess.cli_session_id && visibleCliIds.has(sess.cli_session_id)) continue;
      sessionStore.markDisconnected(sess.session_id);
      changed = true;
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.agentType !== 'cursor_cli') continue;
      if (session.cursorCliArchiveDiscovered !== true) continue;
      if (session.cliSessionId && visibleCliIds.has(session.cliSessionId)) continue;
      this.sessions.delete(sessionId);
      changed = true;
    }
    for (const summary of summaries) {
      const before = this.sessions.size;
      this._registerCursorCliSession(summary, { archiveDiscovered: true, sendInitialHistory: summary.messagesHydrated === true });
      if (this.sessions.size !== before) changed = true;
    }
    if (changed) this._broadcastSessionSnapshot();
  }

  _findCursorCliSummaryByCliId(cliSessionId) {
    if (!cliSessionId) return null;
    return cursorCli.findSessionByCliId(cliSessionId, this._cursorCliActiveSummaryOptions());
  }

  _cursorCliMessageDeltaEnabled() {
    return process.env.RAC_CURSOR_CLI_MESSAGE_DELTA === 'true';
  }

  _emitCursorCliMessageDelta(session, sessionId, append, streamTrace) {
    if (!this._cursorCliMessageDeltaEnabled() || typeof append !== 'string' || append.length === 0) return false;
    if (!session._cursorCliDeltaMessageId) {
      session._cursorCliDeltaMessageId = `cursor-cli-${crypto.randomUUID()}`;
      session._cursorCliDeltaSeq = 0;
      session._cursorCliDeltaOpen = true;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._cursorCliDeltaMessageId,
        0,
        0,
        'block_open',
      ));
    }
    const chunks = [];
    const maxChunkBytes = 48 * 1024;
    let chunk = '';
    let chunkBytes = 0;
    for (const symbol of append) {
      const symbolBytes = Buffer.byteLength(symbol, 'utf8');
      if (chunk && chunkBytes + symbolBytes > maxChunkBytes) {
        chunks.push(chunk);
        chunk = '';
        chunkBytes = 0;
      }
      chunk += symbol;
      chunkBytes += symbolBytes;
    }
    if (chunk) chunks.push(chunk);
    for (const deltaChunk of chunks) {
      const seq = ++session._cursorCliDeltaSeq;
      this._sendToRelay(proto.messageDelta(
        sessionId,
        session._cursorCliDeltaMessageId,
        0,
        seq,
        'append',
        deltaChunk,
        { stream_trace: { ...streamTrace, proxy_sent_at_ms: Date.now() } },
      ));
    }
    return true;
  }

  _closeCursorCliMessageDelta(session, sessionId) {
    if (!this._cursorCliMessageDeltaEnabled() || !session._cursorCliDeltaOpen || !session._cursorCliDeltaMessageId) return false;
    const seq = ++session._cursorCliDeltaSeq;
    this._sendToRelay(proto.messageDelta(
      sessionId,
      session._cursorCliDeltaMessageId,
      0,
      seq,
      'block_close',
    ));
    session._cursorCliDeltaOpen = false;
    return true;
  }

  _startCursorCliWatcher() {
    if (!this._cursorCliMessageDeltaFlagLogged) {
      this._cursorCliMessageDeltaFlagLogged = true;
      this._log('info', `[cursor-cli] message_delta producer ${this._cursorCliMessageDeltaEnabled() ? 'enabled' : 'disabled'} (RAC_CURSOR_CLI_MESSAGE_DELTA)`);
    }
    if (this._cursorCliWatcher) return;
    const archiveDiscovery = this._cursorCliArchiveDiscoveryEnabled();
    if (!archiveDiscovery && process.env.CURSOR_CLI_WATCH_SESSIONS !== 'true') {
      if (!this._cursorCliWatcherDisabledLogged) {
        this._cursorCliWatcherDisabledLogged = true;
        this._log('info', '[cursor-cli] archive watcher disabled; using polling (set CURSOR_CLI_WATCH_SESSIONS=true to opt in)');
      }
      return;
    }
    const watcher = cursorCli.watchSessions(
      summary => {
        if (!this._running || !summary?.cliSessionId) return;
        if (archiveDiscovery && !this._cursorCliArchiveSummaryVisible(summary)) return;
        const existing = Array.from(this.sessions.values()).find(s =>
          s.agentType === 'cursor_cli' && s.cliSessionId === summary.cliSessionId
        );
        if (!archiveDiscovery && !existing) return;
        const before = this.sessions.size;
        const session = this._registerCursorCliSession(summary, { archiveDiscovered: archiveDiscovery });
        if (session) {
          const changed = this.sessions.size !== before;
          if (changed || session.last_seen_at === summary.updatedAt) this._broadcastSessionSnapshot();
        }
      },
      { onError: err => this._log('warn', `[cursor-cli] session watcher: ${err.message}`) }
    );
    if (watcher) {
      this._cursorCliWatcher = watcher;
      this._log('info', '[cursor-cli] watching Cursor session store for live JSONL changes');
    } else {
      this._log('warn', '[cursor-cli] session watcher unavailable; falling back to periodic polling');
    }
  }

  _handleCursorCliJsonEvent(session, sessionId, event, proxyReadAtMs = Date.now()) {
    if (!event || typeof event !== 'object') return;
    const thinkingTypes = new Set(['thinking']);
    const assistantTypes = new Set(['assistant', 'agent_message', 'assistant_message']);
    const isThinking = thinkingTypes.has(event.type);
    const isAssistant = assistantTypes.has(event.type);
    if (!isThinking && !isAssistant) return;
    let text = '';
    if (typeof event.text === 'string') text = event.text;
    else if (event.message && typeof event.message.content === 'string') text = event.message.content;
    else if (typeof event.content === 'string') text = event.content;
    if (!text) return;
    if (isThinking) {
      const priorThinking = session._cursorCliThinkingText || '';
      const nextThinking = text.startsWith(priorThinking) ? text : `${priorThinking}${text}`;
      session._cursorCliThinkingText = nextThinking;
      const activity = {
        kind: 'generating',
        label: 'Cursor CLI running',
        thinkingContent: nextThinking,
        updated_at: new Date().toISOString(),
      };
      session.activity = activity;
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
      return;
    }
    const prior = session._cursorCliLiveText || '';
    const append = text.startsWith(prior) ? text.slice(prior.length) : text;
    if (!append) return;
    const nextText = text.startsWith(prior) ? text : `${prior}${text}`;
    session._cursorCliLiveText = nextText;
    if (!session._cursorCliLiveStartedAt) session._cursorCliLiveStartedAt = new Date(proxyReadAtMs).toISOString();
    const embeddedNativeAtMs = Number.isFinite(Number(event.timestamp_ms))
      ? Number(event.timestamp_ms)
      : Date.parse(event.timestamp || event.created_at || '');
    const nativeEventAtMs = Number.isFinite(embeddedNativeAtMs) ? embeddedNativeAtMs : proxyReadAtMs;
    const streamTrace = {
      trace_id: crypto.randomUUID(),
      agent_type: 'cursor_cli',
      session_id: sessionId,
      native_event_at_ms: nativeEventAtMs,
      native_timestamp_source: Number.isFinite(embeddedNativeAtMs) ? 'cursor_stream_json' : 'cursor_stdout_observed',
      proxy_read_at_ms: proxyReadAtMs,
      proxy_normalized_at_ms: Date.now(),
    };
    const streamViaDeltas = this._cursorCliMessageDeltaEnabled();
    this._emitCursorCliMessageDelta(session, sessionId, append, streamTrace);
    const activity = {
      kind: 'generating',
      label: 'Cursor CLI running',
      current: {
        kind: 'answer',
        label: 'Answering',
        ...(streamViaDeltas
          ? { streaming_transport: 'message_delta' }
          : { partial: nextText }),
        since: session._cursorCliLiveStartedAt,
      },
      ...(streamViaDeltas ? {} : { thinkingContent: nextText }),
      updated_at: new Date().toISOString(),
    };
    session.activity = activity;
    const status = proto.proxyStatus(sessionId, session.status || 'healthy', activity);
    status.stream_trace = { ...streamTrace, proxy_sent_at_ms: Date.now() };
    this._sendToRelay(status);
  }

  _sendCursorCliMessage(session, content, sessionId) {
    if (session._cursorCliChild) {
      return Promise.resolve({ ok: false, code: 'agent_busy', detail: 'Cursor CLI process is already running' });
    }
    session._cursorCliInterrupted = false;
    sessionStore.updateSession(sessionId, { cursor_cli_interrupted: false });
    let cliSessionId = session.cliSessionId || null;
    const existingSummary = this._findCursorCliSummaryByCliId(cliSessionId)
      || (session.cursorCliFilePath
        ? cursorCli.readSessionSummary(session.cursorCliFilePath, this._cursorCliActiveSummaryOptions())
        : null);
    if (existingSummary?.filePath) {
      session.cursorCliFilePath = existingSummary.filePath;
      session.workspace_path = existingSummary.workspacePath || session.workspace_path;
      session.workspace_name = existingSummary.workspaceName || session.workspace_name;
    }
    // Ensure a cliSessionId is always set before spawning so startCursorExecSession
    // can create the transcript file and pass --new-session-id or --resume.
    if (!cliSessionId) {
      cliSessionId = crypto.randomUUID();
    }
    session.cliSessionId = cliSessionId;
    sessionStore.updateSession(sessionId, { cli_session_id: cliSessionId });
    // Resume only when the chat already has real transcript turns (or was
    // created via `agent create-chat`). An empty local meta-only file from
    // launch/ensureSessionFile must still use --new-session-id on first send.
    const shouldResume = !!(existingSummary && existingSummary.messageCount > 0)
      || session.cursorCliChatCreated === true
      || session.cursor_cli_chat_created === true;
    const workspacePath = session.workspace_path || process.cwd();
    const startedAtMs = Date.now();
    const stderrChunks = [];
    session._cursorCliLiveText = '';
    session._cursorCliThinkingText = '';
    session._cursorCliLiveStartedAt = null;
    session._cursorCliDeltaMessageId = null;
    session._cursorCliDeltaSeq = 0;
    session._cursorCliDeltaOpen = false;
    let child;
    try {
      child = cursorCli.startCursorExecSession({
        workspacePath,
        cliSessionId,
        resume: shouldResume,
        content,
        model: session.model_id,
        permissionMode: session.permission_mode,
        sandbox: session.sandbox,
        onStdout: () => {},
        onStderr: chunk => { if (chunk) stderrChunks.push(chunk); },
        onEvent: event => {
          this._handleCursorCliJsonEvent(session, sessionId, event);
        },
        onExit: (code, err) => {
          const wasInterrupted = session._cursorCliInterrupted === true;
          if (session._cursorCliChild === child) session._cursorCliChild = null;
          this._closeCursorCliMessageDelta(session, sessionId);
          (async () => {
            const resolvedCliSessionId = session.cliSessionId || cliSessionId;
            let summary = this._findCursorCliSummaryByCliId(resolvedCliSessionId)
              || cursorCli.findLatestSessionForWorkspace(workspacePath, startedAtMs - 5000, this._cursorCliActiveSummaryOptions());
            for (let attempt = 0; code === 0 && !summary && attempt < 8; attempt++) {
              await sleep(250);
              summary = this._findCursorCliSummaryByCliId(resolvedCliSessionId)
                || cursorCli.findLatestSessionForWorkspace(workspacePath, startedAtMs - 5000, this._cursorCliActiveSummaryOptions());
            }
            if (summary) {
              session.cliSessionId = summary.cliSessionId;
              session.cursorCliFilePath = summary.filePath;
              session.workspace_path = summary.workspacePath || session.workspace_path;
              session.workspace_name = summary.workspaceName || session.workspace_name;
              session.chat_title = summary.title || session.chat_title;
              session.cursorCliArchiveDiscovered = false;
              this._registerCursorCliSession(summary, { sendInitialHistory: false });
              const effectiveMessages = summary.messages?.length ? summary.messages : this._cursorCliPendingTranscriptMessages(session);
              session.lastMessageCount = effectiveMessages.length;
              session.lastObservedCount = effectiveMessages.length;
              session.lastTranscriptSig = this._transcriptSignature(effectiveMessages);
            }
            const failed = !wasInterrupted && (code !== 0 || !!err || !summary);
            if (failed) {
              const stderr = stderrChunks.join('').trim();
              this._log('warn', `[cursor-cli] request failed for ${sessionId}: ${stderr || err?.message || `exit ${code}`}`);
              this._sendToRelay(proto.proxyMessage(
                sessionId,
                'assistant',
                code === 0 && !err
                  ? 'Cursor CLI exited without producing a transcript file for this session.'
                  : `Cursor CLI failed to start or complete the request.\n\n${stderr || err?.message || `Cursor CLI exited with code ${code}`}`,
                { created_at: new Date().toISOString() },
              ));
            }
            const activity = {
              kind: 'idle',
              label: wasInterrupted ? 'Interrupted' : (failed ? 'Cursor CLI failed' : ''),
              updated_at: new Date().toISOString(),
            };
            session.activity = activity;
            session._cursorCliLiveText = '';
            session._cursorCliThinkingText = '';
            session.waitingForAssistant = false;
            sessionStore.updateSession(sessionId, {
              activity,
              workspace_path: session.workspace_path || null,
              workspace_name: session.workspace_name || null,
              cli_session_id: session.cliSessionId || cliSessionId || null,
              cursor_cli_file_path: session.cursorCliFilePath || null,
              cursor_cli_archive_discovered: false,
              cursor_cli_interrupted: wasInterrupted,
            });
            this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', activity));
            this._broadcastSessionSnapshot();
          })().catch(exitErr => {
            this._log('warn', `[cursor-cli] send exit handler failed: ${exitErr.message}`);
          });
        },
      });
    } catch (e) {
      this._log('warn', `[cursor-cli] failed to spawn Cursor CLI for ${sessionId}: ${e.message}`);
      return Promise.resolve({ ok: false, code: 'cursor_cli_spawn_failed', detail: e.message });
    }
    session._cursorCliChild = child;
    return Promise.resolve({ ok: true });
  }

  async _pollSessionCursorCli(sessionId, session) {
    const now = Date.now();
    const shouldLookupTranscript = !session._lastCursorCliTranscriptLookupAt
      || now - session._lastCursorCliTranscriptLookupAt >= 10000;
    if (!session.cursorCliFilePath && session.cliSessionId && shouldLookupTranscript) {
      session._lastCursorCliTranscriptLookupAt = now;
      const nativeStartMs = session.nativeCliStartedAt ? new Date(session.nativeCliStartedAt).getTime() : 0;
      const summary = this._findCursorCliSummaryByCliId(session.cliSessionId)
        || cursorCli.findLatestSessionForWorkspace(session.workspace_path || process.cwd(), nativeStartMs ? nativeStartMs - 5000 : 0, this._cursorCliActiveSummaryOptions());
      if (summary?.filePath) {
        session.cursorCliFilePath = summary.filePath;
        session.workspace_path = summary.workspacePath || session.workspace_path;
        session.workspace_name = summary.workspaceName || session.workspace_name;
        session.chat_title = summary.title || session.chat_title;
        sessionStore.updateSession(sessionId, {
          workspace_path: session.workspace_path || null,
          workspace_name: session.workspace_name || null,
          cursor_cli_file_path: session.cursorCliFilePath,
          cursor_cli_archive_discovered: false,
          chat_title: session.chat_title || null,
        });
      }
    }
    let messages = [];
    let summaryActivity = null;
    let ownedTurnCompleted = false;
    let ownedTurnCompletedAt = null;
    let summaryPartial = false;
    let summaryCursor = null;
    let transcriptMaybeChanged = !session.cursorCliFilePath;
    if (session.cursorCliFilePath) {
      const stat = (() => { try { return fs.statSync(session.cursorCliFilePath); } catch { return null; } })();
      const fileSig = stat ? `${stat.mtimeMs}:${stat.size}` : '';
      if (fileSig && fileSig === session._lastCursorCliFileSig && Array.isArray(session._lastCursorCliMessages)) {
        messages = session._lastCursorCliMessages;
        summaryActivity = session._lastCursorCliActivity || null;
        summaryPartial = session._lastCursorCliMessagesPartial === true;
      } else {
        transcriptMaybeChanged = true;
        const summary = cursorCli.readSessionSummary(session.cursorCliFilePath, this._cursorCliActiveSummaryOptions());
        messages = summary?.messages || [];
        summaryActivity = summary?.activity || null;
        summaryPartial = summary?.messagesPartial === true;
        summaryCursor = summary?.sourceCursor || null;
        session._lastCursorCliFileSig = fileSig;
        session._lastCursorCliMessages = messages;
        session._lastCursorCliActivity = summaryActivity;
        session._lastCursorCliMessagesPartial = summaryPartial;
        if (summary) {
          if (this._applyCursorCliSummaryMetadata(sessionId, session, summary)) {
            this._broadcastSessionSnapshot();
          }
          if (session.cursorCliModelConfigured !== true && summary.model_id) session.model_id = summary.model_id;
          if (session.cursorCliPermissionConfigured !== true && summary.permission_mode) session.permission_mode = summary.permission_mode;
        }
      }
    }
    const effectiveMessages = messages.length > 0 ? messages : this._cursorCliPendingTranscriptMessages(session);
    if (transcriptMaybeChanged || !session.lastTranscriptSig) {
      const sig = this._transcriptSignature(effectiveMessages);
      if (sig !== session.lastTranscriptSig) {
        session.lastTranscriptSig = sig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastMessageCount = effectiveMessages.length;
        const provisionalStreamActive = this._cursorCliMessageDeltaEnabled()
          && session._cursorCliChild;
        if (!provisionalStreamActive) {
          this._sendFileBackedTranscriptUpdate(sessionId, session, effectiveMessages, {
            agentType: 'cursor_cli', filePath: session.cursorCliFilePath,
            sourceCursor: summaryCursor,
            reason: messages.length > 0 ? 'cursor cli poll' : 'cursor cli pending transcript',
          });
        }
      }
    }
    const fallbackActivity = session._cursorCliChild
      ? (this._cursorCliMessageDeltaEnabled()
        ? { kind: 'generating', label: 'Cursor CLI running', current: {
            kind: 'answer', label: 'Answering', streaming_transport: 'message_delta',
            since: session._cursorCliLiveStartedAt || new Date().toISOString(),
          }, updated_at: new Date().toISOString() }
        : { kind: 'generating', label: 'Cursor CLI running', thinkingContent: session._cursorCliLiveText || '', updated_at: new Date().toISOString() })
      : (session.activity?.kind === 'idle' ? session.activity : { kind: 'idle', label: '', updated_at: new Date().toISOString() });
    this._setCursorCliActivity(
      sessionId,
      session,
      this._cursorCliMessageDeltaEnabled() && session._cursorCliChild
        ? fallbackActivity
        : (summaryActivity || fallbackActivity),
      {
        producerObserved: !!session._cursorCliChild || transcriptMaybeChanged,
        observedAt: new Date(now).toISOString(),
      },
    );
  }

  async _pollSessionCodexCli(sessionId, session) {
    const now = Date.now();
    let ownedTurnCompleted = false;
    let ownedTurnCompletedAt = null;
    let lifecycleContext = {};
    const shouldLookupTranscript = !session._lastCodexCliTranscriptLookupAt
      || now - session._lastCodexCliTranscriptLookupAt >= 10000;
    if (!session.codexCliFilePath && session.cliSessionId && shouldLookupTranscript) {
      session._lastCodexCliTranscriptLookupAt = now;
      const nativeStartMs = session.nativeCliStartedAt ? new Date(session.nativeCliStartedAt).getTime() : 0;
      const summary = this._findCodexCliSummaryByCliId(session.cliSessionId)
        || codexCli.findLatestSessionForWorkspace(session.workspace_path || process.cwd(), nativeStartMs ? nativeStartMs - 5000 : 0, this._codexCliActiveSummaryOptions());
      if (summary?.filePath) {
        session.codexCliFilePath = summary.filePath;
        session.workspace_path = summary.workspacePath || session.workspace_path;
        session.workspace_name = summary.workspaceName || session.workspace_name;
        session.chat_title = summary.title || session.chat_title;
        sessionStore.updateSession(sessionId, {
          workspace_path: session.workspace_path || null,
          workspace_name: session.workspace_name || null,
          codex_cli_file_path: session.codexCliFilePath,
          codex_cli_archive_discovered: false,
          chat_title: session.chat_title || null,
        });
      }
    }
    let messages = [];
    let summaryActivity = null;
    let summaryPartial = false;
    let summaryCursor = null;
    let transcriptMaybeChanged = !session.codexCliFilePath;
    if (session.codexCliFilePath) {
      const stat = (() => { try { return fs.statSync(session.codexCliFilePath); } catch { return null; } })();
      const fileSig = stat ? `${stat.mtimeMs}:${stat.size}` : '';
      if (fileSig && fileSig === session._lastCodexCliFileSig && Array.isArray(session._lastCodexCliMessages)) {
        messages = session._lastCodexCliMessages;
        summaryActivity = session._lastCodexCliActivity || null;
        summaryPartial = session._lastCodexCliMessagesPartial === true;
        lifecycleContext = this._codexCliGoalRunContext(
          session._lastCodexCliLifecycleSummary || null,
          { liveObserved: false, evidenceType: 'poll_unchanged' },
        );
      } else {
        transcriptMaybeChanged = true;
        const summary = codexCli.readSessionSummary(session.codexCliFilePath, this._codexCliActiveSummaryOptions());
        messages = summary?.messages || [];
        summaryActivity = summary?.activity || null;
        summaryPartial = summary?.messagesPartial === true;
        summaryCursor = summary?.sourceCursor || null;
        session._lastCodexCliFileSig = fileSig;
        session._lastCodexCliMessages = messages;
        session._lastCodexCliActivity = summaryActivity;
        session._lastCodexCliMessagesPartial = summaryPartial;
        if (summary) {
          session._lastCodexCliLifecycleSummary = {
            taskStartedTurnId: summary.taskStartedTurnId || null,
            taskStartedAt: summary.taskStartedAt || null,
            taskCompletedTurnId: summary.taskCompletedTurnId || null,
            taskCompletedAt: summary.taskCompletedAt || null,
            sourceCursor: summary.sourceCursor || null,
            activity: summary.activity || null,
            updatedAt: summary.updatedAt || null,
          };
          const liveObserved = summary.sourceCursor?.mode === 'append'
            && Number(summary.sourceCursor?.events_read || 0) > 0;
          lifecycleContext = this._codexCliGoalRunContext(summary, {
            liveObserved,
            evidenceType: liveObserved ? 'poll_append' : 'poll_snapshot',
          });
          ownedTurnCompleted = this._observeCodexCliOwnedTurnCompletion(sessionId, session, summary);
          ownedTurnCompletedAt = summary.taskCompletedAt || null;
          if (this._applyCodexCliSummaryMetadata(sessionId, session, summary)) {
            this._broadcastSessionSnapshot();
          }
        }
      }
    }
    const effectiveMessages = messages.length > 0
      ? messages
      : (session.codexCliFilePath ? [] : this._codexCliPendingTranscriptMessages(session));
    if (effectiveMessages.length > 0 && (transcriptMaybeChanged || !session._lastFileTranscriptObservationKey)) {
      const observationKey = this._fileTranscriptObservationKey(
        session.codexCliFilePath,
        summaryCursor,
        effectiveMessages,
      );
      if (observationKey !== session._lastFileTranscriptObservationKey) {
        session.lastObservedCount = effectiveMessages.length;
        session.lastMessageCount = effectiveMessages.length;
        this._sendFileBackedTranscriptUpdate(sessionId, session, effectiveMessages, {
          agentType: 'codex_cli', filePath: session.codexCliFilePath,
          sourceCursor: summaryCursor,
          reason: messages.length > 0 ? 'codex cli poll' : 'codex cli pending transcript',
        });
      }
    }
    const fallbackActivity = session._codexCliChild || session._codexAppServerTurn
      ? { kind: 'generating', label: 'Codex CLI running', thinkingContent: session._codexCliLiveText || '', updated_at: new Date().toISOString() }
      : (session.activity?.kind === 'idle' ? session.activity : { kind: 'idle', label: '', updated_at: new Date().toISOString() });
    const observedActivity = ownedTurnCompleted && summaryActivity?.kind !== 'idle'
      ? { ...summaryActivity, kind: 'idle', label: '', updated_at: ownedTurnCompletedAt || new Date().toISOString() }
      : (summaryActivity || fallbackActivity);
    const activityChanged = this._setCodexCliActivity(sessionId, session, observedActivity, lifecycleContext);
    if (!activityChanged && (session._codexCliChild || session._codexAppServerTurn)) {
      this._emitActivityObservationHeartbeat(sessionId, session, { observedAt: new Date(now).toISOString() });
    }
  }

  async _pollSessionContinue(sessionId, session) {
    const configNow = Date.now();
    const includeConfig = this._shouldBackgroundPollContinueConfig(session)
      && (!session._lastConfigPollAt || configNow - session._lastConfigPollAt > 15000);
    if (includeConfig) session._lastConfigPollAt = configNow;
    let pollResult;
    try {
      pollResult = await this._ephemeralCdpPoll(session, sessionId, { includeConfig });
    } catch (e) {
      this._log('error', `[${sessionId}] Continue ephemeral poll error: ${e.message}`);
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 consecutive Continue poll failures — removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    let { raw, thinking: ts, perm, errorPrompt, config, taskList, contextUsage } = pollResult;
    if (includeConfig && session.agentType === 'continue_yolo' && session._webviewId) {
      try {
        const wbConfig = await this._withWorkbenchClient(session, client =>
          selectors.readContinueConfigFromWorkbench(client.Runtime, session._webviewId, session.workspace_path)
        );
        if (wbConfig) config = this._mergeContinueConfigs(config, wbConfig);
      } catch {}
    }
    const thinkingState = ts && typeof ts === 'object'
      ? ts
      : { thinking: false, label: '', thinkingContent: '' };

    // ── Null-read handling ──
    if (!raw) {
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount === 5 && session.status === 'healthy') {
        const failures = selectors.getSelectorFailures(sessionId);
        this._log('warn', `[${sessionId}] 5 null reads — marking degraded`);
        session.status = 'degraded';
        sessionStore.updateSession(sessionId, { status: 'degraded' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
      }
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 null — removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    if (session.nullPollCount > 0 && session.status === 'degraded') {
      this._log('info', `[${sessionId}] Reads recovered — marking healthy`);
      session.status = 'healthy';
      sessionStore.updateSession(sessionId, { status: 'healthy' });
      this._sendToRelay(proto.proxyStatus(sessionId, 'healthy', session.activity));
    }
    session.nullPollCount = 0;

    // ── Config refresh ──
    if (config) {
      try {
        const stabilized = this._stabilizeContinueConfig(session, config);
        const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, stabilized, session.workspace_path));
        session._currentModelId = merged.model_id || null;
        const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
        if (cfgSig !== session._lastConfigSig) {
          session._lastConfigSig = cfgSig;
          const capabilities = this._buildCapabilities(session.agentType, session.workspace_path);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
        }
      } catch {}
    }

    if (taskList !== undefined) {
      const sig = taskList ? JSON.stringify(taskList) : '';
      if (sig !== (session._taskListSig || '')) {
        session._taskListSig = sig;
        session.taskList = taskList;
        this._log('info', `[${sessionId}] task_list update: ${taskList ? taskList.tasks.length + ' tasks, ' + taskList.completed + '/' + taskList.total + ' done' : 'null'}`);
        if (!session.activity) {
          session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
        }
        session.activity.task_list = taskList;
        if (session.contextCard) session.activity.context_card = session.contextCard;
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
      }
    }

    if (session.agentType === 'cline' || session.agentType === 'roo_code') {
      const contextSig = contextUsage ? JSON.stringify(contextUsage) : '';
      if (contextSig !== (session._contextCardSig || '')) {
        session._contextCardSig = contextSig;
        session.contextCard = contextUsage || null;
        if (!session.activity) {
          session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
        }
        session.activity.context_card = session.contextCard;
        sessionStore.updateSession(sessionId, { activity: session.activity });
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
      }
    }

    // ── Message processing ── (same logic as generic _pollSession)
    const now = Date.now();
    if (session.agentType === 'continue' && (!session._lastContinueChatListPollAt || now - session._lastContinueChatListPollAt > 5000)) {
      session._lastContinueChatListPollAt = now;
      try {
        const chatList = await this._withWorkbenchClient(session, client =>
          selectors.readContinueWorkbenchChatList(client.Runtime, session._webviewId)
        );
        const chatListSig = JSON.stringify(chatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
        if (chatListSig !== session._lastChatListSig) {
          session._lastChatListSig = chatListSig;
          this._sendToRelay(proto.chatList(sessionId, chatList));
        }
        const activeChat = Array.isArray(chatList) ? chatList.find(c => c && c.active) : null;
        if (activeChat?.title && activeChat.title !== session.chat_title) {
          this._promoteSessionChatTitle(sessionId, session, null, activeChat.title);
          this._broadcastSessionSnapshot();
        }
      } catch (e) {
        this._log('warn', `[${sessionId}] readContinueWorkbenchChatList poll error: ${e.message}`);
      }
    }

    const messages = JSON.parse(raw);
    const effectiveMessages = messages;
    const transcriptSig = this._transcriptSignature(effectiveMessages);
    const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

    if (effectiveMessages.length < prevObservedCount) {
      if (shouldHoldContinueRemoteWaitOnRegression(
        session,
        effectiveMessages.length,
        prevObservedCount,
        now,
      )) {
        if (session._continueHeldRegressionSig !== transcriptSig) {
          session._continueHeldRegressionSig = transcriptSig;
          this._log(
            'warn',
            `[${sessionId}] Holding transient Continue regression ${prevObservedCount} -> ${effectiveMessages.length} during remote fast-follow`,
          );
        }
      } else {
        session._continueHeldRegressionSig = null;
        this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session._resyncCandidateMessages = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      }
      // Still process thinking + permissions below
    } else if (
      session.lastTranscriptSig &&
      transcriptSig !== session.lastTranscriptSig &&
      effectiveMessages.length === prevObservedCount
    ) {
      const inPlaceCurrent = effectiveMessages[Math.min(
        session.lastMessageCount,
        effectiveMessages.length - 1,
      )];
      if (shouldImmediatelyStreamContinueInPlace(session, inPlaceCurrent, now)) {
        session._lastStreamedContent = inPlaceCurrent.content;
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
        this._log(
          'info',
          `[${sessionId}] Streaming in-place Continue assistant (${inPlaceCurrent.content.length} chars)`,
        );
        session.pendingLast = inPlaceCurrent;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      } else if (shouldImmediatelyStreamContinueTailMutation(session, inPlaceCurrent, now)) {
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
        this._log(
          'info',
          `[${sessionId}] Streaming Continue tail mutation (${inPlaceCurrent.content.length} chars)`,
        );
        session._continueTailContent = inPlaceCurrent.content;
        session._continueTailSettleUntil = Date.now() + 5000;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      } else if (session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Transcript mutated in place, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript mutation');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        session.resyncCandidateSig = transcriptSig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
      }
    } else {
      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        if (session.agentType === 'codex-desktop' || session.agentType === 'cursor') {
          try {
            const ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
            if (ts?.thinking) {
              session.lastObservedCount = effectiveMessages.length;
              session.lastTranscriptSig = transcriptSig;
              return;
            }
          } catch {}
        }
        this._log('warn', `[${sessionId}] Mutated transcript stabilized — resyncing`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        session._continueHeldRegressionSig = null;
        if (effectiveMessages.length < session.lastMessageCount) {
          this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} → ${effectiveMessages.length}, resetting`);
          session.lastMessageCount = effectiveMessages.length;
          session.pendingLast = null;
        }

        const streamFlushThresholdMs = session.agentType === 'continue_yolo' ? 1200 : 5000;

        // Pending stabilisation
        if (session.pendingLast !== null) {
          const p = session.pendingLast;
          const current = effectiveMessages[session.lastMessageCount];
          if (current && current.role === p.role && current.content === p.content) {
            this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
            if (shouldSendStablePendingMessage(p, session._lastStreamedContent)) {
              this._sendProxyMessage(sessionId, p);
            }
            session.lastMessageCount++;
            session.pendingLast = null;
            session._pendingFirstSeenAt = null;
            session._lastStreamedContent = null;
            if (p.role === 'user') session.waitingForAssistant = true;
            if (p.role === 'assistant') {
              session.waitingForAssistant = false;
              if (Number(session._remoteFastPollUntil || 0) > Date.now()) {
                session._continueTailContent = p.content;
                session._continueTailSettleUntil = Date.now() + 5000;
              }
            }
          } else if (current) {
            if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
            const pendingAge = Date.now() - session._pendingFirstSeenAt;
            const streamContinueAssistantNow = shouldImmediatelyStreamContinueAssistant(p, current);
            if ((streamContinueAssistantNow || pendingAge > streamFlushThresholdMs)
              && current.content !== session._lastStreamedContent) {
              session._lastStreamedContent = current.content;
              this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
              this._log(
                'info',
                `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge)}ms)`
              );
            }
            session.pendingLast = current;
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = transcriptSig;
          }
        }

        // Send newly complete messages
        const prev = session.lastMessageCount;
        if (effectiveMessages.length > prev && session.pendingLast === null) {
          for (let i = prev; i < effectiveMessages.length - 1; i++) {
            this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
            this._sendProxyMessage(sessionId, effectiveMessages[i]);
            if (effectiveMessages[i].role === 'user') session.waitingForAssistant = true;
            if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
          }
          session.lastMessageCount = effectiveMessages.length - 1;
          const last = effectiveMessages[effectiveMessages.length - 1];
          session.pendingLast = last;
        }

        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      }
    }

    // ── Thinking / activity state ──
    const active = session.pendingLast !== null || session.waitingForAssistant;
    const isContinueFamily = session.agentType === 'continue' || session.agentType === 'continue_yolo';
    const kind = isContinueFamily
      ? ((thinkingState.thinking || active) ? 'generating' : 'idle')
      : (thinkingState.thinking ? 'thinking' : active ? 'generating' : 'idle');
    const label = thinkingState.label || (active ? 'Generating' : '');
    const newActivity = { kind, label, updated_at: new Date().toISOString() };
    if (kind === 'idle' && Number(session._continueTailSettleUntil || 0) <= Date.now()) {
      session._remoteFastPollUntil = 0;
    }
    if (session.taskList) newActivity.task_list = session.taskList;
    if (session.contextCard) newActivity.context_card = session.contextCard;
    if (thinkingState.goal) newActivity.goal = thinkingState.goal;
    if (thinkingState.thinkingContent) newActivity.thinkingContent = thinkingState.thinkingContent;

    const prevKind = session.activity?.kind || 'idle';
    const prevThinkingContent = session.thinkingContent || '';
    const currThinkingContent = thinkingState.thinkingContent || '';
    const prevContextSig = session.activity?.context_card ? JSON.stringify(session.activity.context_card) : '';
    const currContextSig = newActivity.context_card ? JSON.stringify(newActivity.context_card) : '';
    const prevGoalSig = session.activity?.goal ? JSON.stringify([
      session.activity.goal.label,
      session.activity.goal.status,
      session.activity.goal.objective,
      session.activity.goal.time_used_seconds,
    ]) : '';
    const currGoalSig = newActivity.goal ? JSON.stringify([
      newActivity.goal.label,
      newActivity.goal.status,
      newActivity.goal.objective,
      newActivity.goal.time_used_seconds,
    ]) : '';
    if (thinkingState.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent || currContextSig !== prevContextSig || currGoalSig !== prevGoalSig) {
      session.thinking = thinkingState.thinking;
      session.thinkingLabel = label;
      session.thinkingContent = currThinkingContent;
      session.activity = newActivity;
      sessionStore.updateSession(sessionId, { activity: newActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));
      if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
        this._processMessageQueue(sessionId);
      }
    } else {
      this._emitActivityObservationHeartbeat(sessionId, session, { observedAt: newActivity.updated_at });
    }

    // ── Permission dialog ──
    await this._handlePermissionDialogState(sessionId, session, perm);
    await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);
  }

  // ─── Session polling ─────────────────────────────────────────────────

  async _pollSessionClaude(sessionId, session) {
    if (session.rateLimitActive && session.rate_limited_until && session.rate_limited_until !== 'unknown') {
      const untilStr = session.rate_limited_until;
      let resetMs = null;
      const hmMatch = untilStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (hmMatch) {
        let h = parseInt(hmMatch[1], 10);
        const m = parseInt(hmMatch[2], 10);
        const ampm = (hmMatch[3] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        const now = new Date();
        const resetDate = new Date(now);
        resetDate.setHours(h, m, 0, 0);
        resetMs = resetDate.getTime();
      }
      const durationMatch = untilStr.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$|^(\d+)\s*m$/i);
      if (durationMatch && session._rateLimitDetectedAt) {
        const hours = parseInt(durationMatch[1] || '0', 10);
        const mins = parseInt(durationMatch[2] || durationMatch[3] || '0', 10);
        resetMs = session._rateLimitDetectedAt + (hours * 3600000) + (mins * 60000);
      }
      if (resetMs && Date.now() > resetMs) {
        this._log('info', `[${sessionId}] [rate-limit] Time-based auto-clear: ${untilStr} has passed`);
        session.rateLimitActive = false;
        session.rate_limited_until = null;
        session.percentUsed = null;
        session._rateLimitSig = null;
        this._sendToRelay(proto.rateLimitCleared(sessionId));
        this._broadcastSessionSnapshot();
      }
    }

    const configNow = Date.now();
    const includeConfig = !session._lastConfigPollAt || configNow - session._lastConfigPollAt > 15000;
    const includeRateLimit = (session._rateLimitPollCount || 0) + 1 >= 10;
    if (includeConfig) session._lastConfigPollAt = configNow;

    let pollResult;
    try {
      pollResult = await this._ephemeralCdpPoll(session, sessionId, {
        includeConfig,
        includeRateLimit,
      });
    } catch (e) {
      this._log('error', `[${sessionId}] Claude ephemeral poll error: ${e.message}`);
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 consecutive Claude poll failures - removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    const { raw, thinking: ts, sessionTitle, perm, errorPrompt, config, rateLimit } = pollResult;
    const thinkingState = ts && typeof ts === 'object'
      ? ts
      : { thinking: false, label: '', thinkingContent: '' };

    if (sessionTitle && sessionTitle !== session.chat_title) {
      this._log('info', `[${sessionId}] Claude conversation title: "${session.chat_title || ''}" -> "${sessionTitle}"`);
      this._promoteSessionChatTitle(sessionId, session, null, sessionTitle);
      this._broadcastSessionSnapshot();
    }

    if (!raw) {
      session.nullPollCount = (session.nullPollCount || 0) + 1;
      if (session.nullPollCount === 5 && session.status === 'healthy') {
        const failures = selectors.getSelectorFailures(sessionId);
        this._log('warn', `[${sessionId}] 5 null reads - marking degraded`);
        session.status = 'degraded';
        sessionStore.updateSession(sessionId, { status: 'degraded' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
      }
      if (session.nullPollCount >= 15) {
        this._log('warn', `[${sessionId}] 15 null - removing session for re-discovery`);
        sessionStore.markDisconnected(sessionId);
        await this._safeClose(session.client);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
      return;
    }

    if (session.nullPollCount > 0 && session.status === 'degraded') {
      this._log('info', `[${sessionId}] Reads recovered - marking healthy`);
      session.status = 'healthy';
      sessionStore.updateSession(sessionId, { status: 'healthy' });
      this._sendToRelay(proto.proxyStatus(sessionId, 'healthy', session.activity));
    }
    session.nullPollCount = 0;

    if (config) {
      try {
        const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, config, session.workspace_path));
        const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
        if (cfgSig !== session._lastConfigSig) {
          session._lastConfigSig = cfgSig;
          const capabilities = this._buildCapabilities(session.agentType, session.workspace_path);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
        }
      } catch {}
    }

    const messages = JSON.parse(raw);
    const effectiveMessages = messages;
    const transcriptSig = this._transcriptSignature(effectiveMessages);
    const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;

    if (effectiveMessages.length < prevObservedCount) {
      this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}, forcing history snapshot`);
      this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
      session.lastMessageCount = effectiveMessages.length;
      session.lastObservedCount = effectiveMessages.length;
      session.lastTranscriptSig = transcriptSig;
      session.pendingLast = null;
      session.resyncCandidateSig = null;
      session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
    } else if (
      session.lastTranscriptSig &&
      transcriptSig !== session.lastTranscriptSig &&
      effectiveMessages.length === prevObservedCount
    ) {
      if (session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Transcript mutated in place, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript mutation');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        session.resyncCandidateSig = transcriptSig;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
      }
    } else {
      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Mutated transcript stabilized - resyncing`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
      } else {
        if (effectiveMessages.length < session.lastMessageCount) {
          this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} -> ${effectiveMessages.length}, resetting`);
          session.lastMessageCount = effectiveMessages.length;
          session.pendingLast = null;
        }

        if (session.pendingLast !== null) {
          const p = session.pendingLast;
          const current = effectiveMessages[session.lastMessageCount];
          if (current && current.role === p.role && current.content === p.content) {
            this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
            this._sendProxyMessage(sessionId, p);
            session.lastMessageCount++;
            session.pendingLast = null;
            session._pendingFirstSeenAt = null;
            if (p.role === 'user') session.waitingForAssistant = true;
            if (p.role === 'assistant') session.waitingForAssistant = false;
          } else if (current) {
            if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
            const pendingAge = Date.now() - session._pendingFirstSeenAt;
            if (pendingAge > 5000 && current.content !== session._lastStreamedContent) {
              session._lastStreamedContent = current.content;
              this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
              this._log('info', `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge / 1000)}s)`);
            }
            session.pendingLast = current;
            session.lastObservedCount = effectiveMessages.length;
            session.lastTranscriptSig = transcriptSig;
          }
        }

        const prev = session.lastMessageCount;
        if (effectiveMessages.length > prev && session.pendingLast === null) {
          for (let i = prev; i < effectiveMessages.length - 1; i++) {
            this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
            this._sendProxyMessage(sessionId, effectiveMessages[i]);
            if (effectiveMessages[i].role === 'user') session.waitingForAssistant = true;
            if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
          }
          session.lastMessageCount = effectiveMessages.length - 1;
          const last = effectiveMessages[effectiveMessages.length - 1];
          session.pendingLast = last;
        }

        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.resyncCandidateSig = null;
      }
    }

    const active = session.pendingLast !== null || session.waitingForAssistant;
    const kind = thinkingState.thinking ? 'thinking' : active ? 'generating' : 'idle';
    const label = thinkingState.label || (active ? 'Generating' : '');
    const newActivity = { kind, label, updated_at: new Date().toISOString() };
    if (session.taskList) newActivity.task_list = session.taskList;
    if (thinkingState.goal) newActivity.goal = thinkingState.goal;
    if (thinkingState.thinkingContent) newActivity.thinkingContent = thinkingState.thinkingContent;

    const prevKind = session.activity?.kind || 'idle';
    const prevThinkingContent = session.thinkingContent || '';
    const currThinkingContent = thinkingState.thinkingContent || '';
    const prevGoalSig = session.activity?.goal ? JSON.stringify([
      session.activity.goal.label,
      session.activity.goal.status,
      session.activity.goal.objective,
      session.activity.goal.time_used_seconds,
    ]) : '';
    const currGoalSig = newActivity.goal ? JSON.stringify([
      newActivity.goal.label,
      newActivity.goal.status,
      newActivity.goal.objective,
      newActivity.goal.time_used_seconds,
    ]) : '';
    if (thinkingState.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent || currGoalSig !== prevGoalSig) {
      session.thinking = thinkingState.thinking;
      session.thinkingLabel = label;
      session.thinkingContent = currThinkingContent;
      session.activity = newActivity;
      sessionStore.updateSession(sessionId, { activity: newActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));
      if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
        this._processMessageQueue(sessionId);
      }
    } else {
      this._emitActivityObservationHeartbeat(sessionId, session, { observedAt: newActivity.updated_at });
    }

    await this._handlePermissionDialogState(sessionId, session, perm);
    await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);

    session._rateLimitPollCount = includeRateLimit ? 0 : ((session._rateLimitPollCount || 0) + 1);
    if (includeRateLimit) {
      const rl = rateLimit;
      const wasActive = session.rateLimitActive || false;
      const nowActive = rl?.rate_limited === true;
      const untilText = rl?.until_text || null;
      const pctUsed = rl?.percent_used ?? null;
      const hasBanner = pctUsed != null;
      const sig = `${nowActive}|${pctUsed}|${untilText}`;
      if (sig !== session._rateLimitSig) {
        session._rateLimitSig = sig;
        session.rateLimitActive = nowActive;
        session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
        session.percentUsed = hasBanner ? pctUsed : null;
        if (nowActive) {
          if (!wasActive) session._rateLimitDetectedAt = Date.now();
          this._log('info', `[${sessionId}] [rate-limit] Active: ${pctUsed != null ? pctUsed + '%' : ''} resets ${untilText || 'unknown'}`);
          this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed, true));
        } else if (hasBanner) {
          this._log('info', `[${sessionId}] [rate-limit] Usage: ${pctUsed}% resets ${untilText || 'unknown'}`);
          this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed, false));
        } else if (wasActive || session.percentUsed != null) {
          this._log('info', `[${sessionId}] [rate-limit] Cleared`);
          this._sendToRelay(proto.rateLimitCleared(sessionId));
        }
        this._broadcastSessionSnapshot();
      }
    }
  }

  async _pollSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session._pollInProgress) {
      session._skippedOverlappingPolls = (session._skippedOverlappingPolls || 0) + 1;
      if (session._skippedOverlappingPolls === 1 || session._skippedOverlappingPolls % 10 === 0) {
        this._log('warn', `[${sessionId}] Skipping overlapping poll (${session._skippedOverlappingPolls})`);
      }
      return;
    }
    session._pollInProgress = true;
    session._pollStartedAt = Date.now();
    const pollActivityEpoch = session._activityEpoch || 0;

    try {
      // Iframe-backed editor agents need target-specific CDP reads so stale
      // workbench window metadata does not mask the active webview transcript.
      if (session.agentType === 'claude_cli') {
        return await this._pollSessionClaudeCli(sessionId, session);
      }
      if (session.agentType === 'codex_cli') {
        return await this._pollSessionCodexCli(sessionId, session);
      }
      if (session.agentType === 'cursor_cli') {
        return await this._pollSessionCursorCli(sessionId, session);
      }
      if (session.agentType === 'claude') {
        return await this._pollSessionClaude(sessionId, session);
      }
      if (session.agentType === 'continue' || session.agentType === 'continue_yolo' || session.agentType === 'roo_code' || session.agentType === 'cline') {
        return await this._pollSessionContinue(sessionId, session);
      }

      // Cursor 3.5+ virtual rows all share one workbench Runtime.  Only the
      // selected UUID owns the visible transcript, while the dedicated
      // page-owner inventory lane refreshes identity/status for every UUID.
      // Returning here prevents every inactive row from independently
      // walking the same global Agents DOM and starving that owner read.
      if (session.agentType === 'cursor' && session._cursorVirtual && !session._cursorNativeActive) {
        return;
      }

      // Task list detection — runs before readMessages so it isn't skipped
      // by early returns in null-read or pending-stabilisation paths
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (codexAuxBusy) session._lastBusyAt = Date.now();
        // Task lists / native queues / automation views only meaningfully
        // change while the agent is working. Gate aux polls to busy + a
        // 30s grace window (catches the final state after generation ends).
        const auxRelevant = codexAuxBusy ||
          (session._lastBusyAt && Date.now() - session._lastBusyAt < 30000);
        const taskListPollEvery = session.agentType === 'codex-desktop' ? 30 : 15;
        if (session._taskListPollCount === undefined) {
          session._taskListPollCount = staggerOffset(sessionId, 'taskList', taskListPollEvery);
        }
        session._taskListPollCount += 1;
        if (auxRelevant && !session._taskListPollInProgress && session._taskListPollCount >= taskListPollEvery) {
          session._taskListPollCount = 0;
          session._taskListPollInProgress = true;
          const usePageEval = session.agentType === 'codex-desktop';
          const handleTaskList = (taskList) => {
            const sig = taskList ? JSON.stringify(taskList) : '';
            if (sig !== (session._taskListSig || '')) {
              session._taskListSig = sig;
              session.taskList = taskList;
              this._log('info', `[${sessionId}] task_list update: ${taskList ? taskList.tasks.length + ' tasks, ' + taskList.completed + '/' + taskList.total + ' done' : 'null'}`);
              if (!session.activity) {
                session.activity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
              }
              session.activity.task_list = taskList;
              this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', session.activity));
            }
          };
          // Fire-and-forget for all codex variants — previously codex-desktop
          // serialised this with the rest of the poll, blocking readMessages
          // behind a slow DOM walk.
          selectors.readCodexTaskList(session.client.Runtime, usePageEval)
            .then(handleTaskList)
            .catch(e => { this._log('warn', `[${sessionId}] task_list error: ${e.message}`); })
            .finally(() => { session._taskListPollInProgress = false; });
        }
      }

      // Codex Desktop thread switches are native app state, not transcript
      // state. Refresh the active-thread marker even while busy so the WebUI
      // does not keep showing the previous thread's accumulated history after
      // the user switches chats or Codex focuses a different thread.
      if (session.agentType === 'codex-desktop'
          || (session.agentType === 'cursor' && !session._cursorVirtual)) {
        const now = Date.now();
        if (!session._lastCodexDesktopThreadPollAt || now - session._lastCodexDesktopThreadPollAt > 5000) {
          session._lastCodexDesktopThreadPollAt = now;
          try {
            const listFn = session.agentType === 'cursor'
              ? () => require('./cursor-selectors').readCursorAgentList(session.client.Runtime)
              : () => selectors.readCodexThreadList(session.client.Runtime, true);
            const threads = await this._withTimeout(
              listFn(),
              2000,
              `${session.agentType} thread list ${sessionId.substring(0, 8)}`
            );
            this._applyCodexDesktopThreadList(sessionId, session, threads);
          } catch (e) {
            this._log('warn', `[${sessionId}] ${session.agentType} thread list poll failed: ${e.message}`);
          }
        }
      }

      const raw = await selectors.readMessages(
        session.client.Runtime,
        session.agentType,
        sessionId,
        session.agentType === 'codex-desktop' ? { maxRecentTurns: 24, maxRecentUnits: 96 } : {},
      );

      if (!raw) {
        session.nullPollCount = (session.nullPollCount || 0) + 1;

        if (session.nullPollCount === 5 && session.status === 'healthy') {
          const failures = selectors.getSelectorFailures(sessionId);
          this._log('warn', `[${sessionId}] 5s null reads — marking degraded (readFails=${failures.readFails} sendFails=${failures.sendFails})`);
          session.status = 'degraded';
          sessionStore.updateSession(sessionId, { status: 'degraded' });
          this._sendToRelay(proto.proxyStatus(sessionId, 'degraded', session.activity, failures));
        }

        if (session.nullPollCount >= 15) {
          this._log('warn', `[${sessionId}] 15s null — closing CDP client to force re-discovery`);
          sessionStore.markDisconnected(sessionId);
          await this._safeClose(session.client);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        }
        return;
      }

      if (!this.sessions.has(sessionId) || session._intentionalPollClose) return;

      // A send/interrupt control can settle while this CDP read is in flight.
      // Never let the older poll result overwrite the explicit control state.
      if ((session._activityEpoch || 0) !== pollActivityEpoch) return;

      if (session.nullPollCount > 0 && session.status === 'degraded') {
        this._log('info', `[${sessionId}] Reads recovered — marking healthy`);
        session.status = 'healthy';
        sessionStore.updateSession(sessionId, { status: 'healthy' });
        this._sendToRelay(proto.proxyStatus(sessionId, 'healthy', session.activity));
      }
      session.nullPollCount = 0;

      // Periodic agent config refresh (branch, model changes) — every 15s
      const configNow = Date.now();
      const configPollMs = this._isCodexSurface(session.agentType) ? 30000 : 15000;
      if (
        (!session._lastConfigPollAt || configNow - session._lastConfigPollAt > configPollMs) &&
        !session._configPollInProgress
      ) {
        session._lastConfigPollAt = configNow;
        session._configPollInProgress = true;
        selectors.readAgentConfig(session.client.Runtime, session.agentType, session.workspace_path)
          .then(cfg => {
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(session.agentType, cfg, session.workspace_path));
          if (merged.model_id && merged.model_id !== 'unknown') {
            session._currentModelId = merged.model_id;
          }
          const cfgSig = `${merged.branch}|${merged.model_id}|${merged.permission_mode}`;
          if (cfgSig !== session._lastConfigSig) {
            session._lastConfigSig = cfgSig;
            const capabilities = this._buildCapabilities(session.agentType, session.workspace_path);
            this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities }));
          }
          })
          .catch(() => {})
          .finally(() => { session._configPollInProgress = false; });
      }

      // Antigravity Manager title polling
      if (session.agentType === 'antigravity') {
        const now = Date.now();
        if (!session._lastTitleCheckAt || now - session._lastTitleCheckAt > 5000) {
          session._lastTitleCheckAt = now;
          try {
            const newTitle = await selectors.readAntigravitySessionTitle(session.client.Runtime);
            if (newTitle && newTitle !== session.windowTitle) {
              this._log('info', `[${sessionId}] Antigravity conversation changed: "${session.windowTitle}" → "${newTitle}"`);
              session.windowTitle  = newTitle;
              session.workspace_name = newTitle;
              sessionStore.updateSession(sessionId, { window_title: newTitle, workspace_name: newTitle });
              this._broadcastSessionSnapshot();
            }
          } catch {}
        }
      }

      // Antigravity side-panel title polling
      if (session.agentType === 'antigravity_panel') {
        const now = Date.now();
        if (!session._lastTitleCheckAt || now - session._lastTitleCheckAt > 5000) {
          session._lastTitleCheckAt = now;
          try {
            const hasContent = await selectors.detectAntigravityPanelHasContent(session.client.Runtime);
            this._log('info', `[${sessionId}] panel poll: hasContent=${hasContent} _panelEmpty=${!!session._panelEmpty} lastMsgCount=${session.lastMessageCount}`);
            if (!hasContent) {
              // Panel is in "new chat" / list view — no active conversation.
              // Clear any stale messages from the web UI so it doesn't show
              // old content that doesn't match what the user sees.
              if (session.lastMessageCount > 0) {
                this._log('info', `[${sessionId}] Panel empty — clearing ${session.lastMessageCount} stale messages from web UI`);
                this._sendHistorySnapshot(sessionId, [], 'empty list view clear');
                session.lastMessageCount = 0;
                session.lastObservedCount = 0;
                session.lastTranscriptSig = '';
                session._accumulatedMessages = null;
                sessionStore.updateSession(sessionId, { accumulated_messages: null });
              }
              if (session._newChatPending) {
                delete session._newChatPending;
              }
              // Mark panel as empty so we skip stale message processing below
              session._panelEmpty = true;
            } else if (session._newChatPending) {
              // Panel has content again after new_chat — clear the flag and update title
              delete session._newChatPending;
            }
            if (hasContent) session._panelEmpty = false;
            const panelSummary = await selectors.readAntigravityPanelSummary(session.client.Runtime);
            const panelTitle = panelSummary?.title || await selectors.readAntigravityPanelTitle(session.client.Runtime);
            const workspacePart = session.workspace_name || session.windowTitle.split(' / ')[0];
            const newTitle = panelTitle ? `${workspacePart} / ${panelTitle}` : workspacePart;
            let panelMetaChanged = false;
            if ((panelTitle || null) !== (session.panel_title || null)) {
              session.panel_title = panelTitle || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.mode || null) !== (session.panel_mode || null)) {
              session.panel_mode = panelSummary?.mode || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.model || null) !== (session.panel_model || null)) {
              session.panel_model = panelSummary?.model || null;
              panelMetaChanged = true;
            }
            if ((panelSummary?.pane_agent || null) !== (session.panel_agent || null)) {
              session.panel_agent = panelSummary?.pane_agent || null;
              panelMetaChanged = true;
            }
            if (newTitle && newTitle !== session.windowTitle) {
              this._log('info', `[${sessionId}] Panel conversation changed: "${session.windowTitle}" → "${newTitle}"`);
              session.windowTitle = newTitle;
              sessionStore.updateSession(sessionId, { window_title: newTitle, workspace_name: workspacePart });
              this._broadcastSessionSnapshot();
            } else if (panelMetaChanged) {
              this._broadcastSessionSnapshot();
            }

            // Proactively send chat list so the web UI can show conversation history
            try {
              const chatList = await selectors.readAntigravityPanelChatList(session.client.Runtime);
              this._log('info', `[${sessionId}] chatList: ${chatList.length} items`);
              const chatListSig = JSON.stringify(chatList.map(c => c.title + ':' + c.active));
              if (chatListSig !== session._lastChatListSig) {
                session._lastChatListSig = chatListSig;
                this._sendToRelay(proto.chatList(sessionId, chatList));
                this._log('info', `[${sessionId}] Sent chat_list with ${chatList.length} conversations`);
              }
            } catch (e) {
              this._log('warn', `[${sessionId}] readAntigravityPanelChatList error: ${e.message}`);
            }
          } catch {}
        }
      }

      if (session.agentType === 'antigravity-v2') {
        const now = Date.now();
        const needsImmediateConversationIdentity = !!session._listView || !!session._newChatPending;
        if (needsImmediateConversationIdentity || !session._lastV2MetaPollAt || now - session._lastV2MetaPollAt > 30000) {
          session._lastV2MetaPollAt = now;
          try {
            const active = await selectors.readAntigravityV2ActiveConversation(session.client.Runtime);
            const chatList = await selectors.readAntigravityV2ChatList(session.client.Runtime);
            const activeChat = Array.isArray(chatList)
              ? chatList.find(c => c && c.kind === 'chat' && ((active?.conversation_id && c.id === active.conversation_id) || c.active))
              : null;
            if (active?.conversation_id && active.conversation_id !== session.v2ConversationId) {
              this._log('info', `[${sessionId}] Antigravity v2 conversation changed: ${session.v2ConversationId || 'unknown'} -> ${active.conversation_id}`);
              session.v2ConversationId = active.conversation_id;
              session._listView = false;
              delete session._newChatPending;
              session.chat_title = activeChat?.title || active.title || session.chat_title;
              session.windowTitle = activeChat?.title || active.title || session.windowTitle;
              session.workspace_name = activeChat?.project || session.workspace_name || 'Antigravity v2';
              this._resetTranscriptState(session, 'antigravity v2 conversation change');
              sessionStore.updateSession(sessionId, {
                window_title: session.windowTitle,
                workspace_name: session.workspace_name,
                chat_title: session.chat_title,
                antigravity_v2_conversation_id: active.conversation_id,
                accumulated_messages: null,
              });
              this._broadcastSessionSnapshot();
            } else if (active && !active.conversation_id && !session._listView) {
              this._log('info', `[${sessionId}] Antigravity v2 moved to ${active.view || 'navigation'} view`);
              session.v2ConversationId = null;
              session._listView = true;
              session.chat_title = active.title || 'Agent Manager';
              session.windowTitle = active.title || 'Agent Manager';
              session.workspace_name = 'Agent Manager';
              session._accumulatedMessages = null;
              session.lastMessageCount = 0;
              session.lastObservedCount = 0;
              session.lastTranscriptSig = '';
              this._sendHistorySnapshot(sessionId, [], 'antigravity v2 list view');
              this._broadcastSessionSnapshot();
            } else if (activeChat?.project && activeChat.project !== session.workspace_name) {
              session.workspace_name = activeChat.project;
              session.chat_title = activeChat.title || session.chat_title;
              session.windowTitle = activeChat.title || session.windowTitle;
              sessionStore.updateSession(sessionId, {
                window_title: session.windowTitle,
                workspace_name: session.workspace_name,
                chat_title: session.chat_title,
              });
              this._broadcastSessionSnapshot();
            }
            const chatListSig = JSON.stringify(chatList.map(c => `${c.kind || 'chat'}:${c.id || ''}:${c.title || ''}:${!!c.active}:${c.project || ''}`));
            if (chatListSig !== session._lastChatListSig) {
              session._lastChatList = Array.isArray(chatList) ? chatList : [];
              session._lastChatListSig = chatListSig;
              this._sendToRelay(proto.chatList(sessionId, chatList));
              this._broadcastSessionSnapshot();
            }
          } catch (e) {
            this._log('warn', `[${sessionId}] Antigravity v2 metadata poll failed: ${e.message}`);
          }
        }
      }

      // Codex chat-list polling: when the side pane is showing conversation history
      // with no active chat, treat that as list view and clear stale transcript state.
      if (session.agentType === 'codex') {
        const now = Date.now();
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexAuxBusy && (!session._lastWorkbenchPanePollAt || now - session._lastWorkbenchPanePollAt > 15000)) {
          session._lastWorkbenchPanePollAt = now;
          const changed = await this._refreshWorkbenchPaneMeta(session);
          if (changed) this._broadcastSessionSnapshot();
        }
        if (!codexAuxBusy && (!session._lastCodexChatListPollAt || now - session._lastCodexChatListPollAt > 15000)) {
          session._lastCodexChatListPollAt = now;
          try {
            const chatList = await selectors.readCodexChatList(session.client.Runtime, false);
            const chatListSig = JSON.stringify(chatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
            if (chatListSig !== session._lastChatListSig) {
              session._lastChatListSig = chatListSig;
              this._sendToRelay(proto.chatList(sessionId, chatList));
            }

            const hasChats = Array.isArray(chatList) && chatList.length > 0;
            const hasActiveChat = hasChats && chatList.some(c => c && c.active);
            const activeChat = hasActiveChat ? chatList.find(c => c && c.active) : null;
            const activeChatKey = activeChat ? `${activeChat.id || ''}:${activeChat.title || ''}` : '';
            if (activeChatKey && session._activeChatKey && activeChatKey !== session._activeChatKey) {
              this._log('info', `[${sessionId}] Codex active chat changed; resetting transcript accumulator`);
              this._resetTranscriptState(session, 'codex active chat change');
              sessionStore.updateSession(sessionId, { accumulated_messages: null });
            }
            if (activeChatKey) {
              const identityChanged = activeChatKey !== session._activeChatKey
                || activeChat.title !== session._activeChatTitle;
              session._activeChatKey = activeChatKey;
              session._activeChatTitle = activeChat.title || session._activeChatTitle || null;
              const titleChanged = this._promoteSessionChatTitle(sessionId, session, null, activeChat.title);
              if (identityChanged || titleChanged) {
                sessionStore.updateSession(sessionId, {
                  codex_active_chat_key: activeChatKey,
                  codex_active_chat_title: session._activeChatTitle,
                  chat_title: session.chat_title || null,
                  chat_title_source: session.chat_title_source || null,
                });
                this._broadcastSessionSnapshot();
              }
            }
            const shouldBeListView = hasChats && !hasActiveChat;
            if (shouldBeListView) {
              const wasListView = !!session._listView;
              let clearedMessages = false;
              if (!session._listView) {
                this._log('info', `[${sessionId}] Codex chat list visible with no active chat; entering list-view mode`);
              }
              if (session.lastMessageCount > 0) {
                this._log('info', `[${sessionId}] Codex list view - clearing ${session.lastMessageCount} stale messages from web UI`);
                this._sendHistorySnapshot(sessionId, [], 'codex list view clear');
                session.lastMessageCount = 0;
                session.lastObservedCount = 0;
                session.lastTranscriptSig = '';
                session.waitingForAssistant = false;
                session.pendingLast = null;
                clearedMessages = true;
              }
              session._listView = true;
              if (!wasListView || clearedMessages) {
                this._broadcastSessionSnapshot();
              }
            } else if (session._listView) {
              this._log('info', `[${sessionId}] Codex active chat resumed; leaving list-view mode`);
              session._listView = false;
              this._broadcastSessionSnapshot();
            }
          } catch (e) {
            this._log('warn', `[${sessionId}] readCodexChatList poll error: ${e.message}`);
          }
        }
      }

      // Skip stale message processing when the visible surface is in empty/list-view mode.
      // Codex Desktop still needs one pass below while already flagged list-view so
      // it can clear stale relay history after discovery/restores.
      if (session._panelEmpty || (session._listView && session.agentType !== 'codex-desktop')) return;

      let messages = JSON.parse(raw);
      if (session.agentType === 'cursor' && session._newChatPending && messages.length > 0) {
        delete session._newChatPending;
        sessionStore.updateSession(sessionId, { cursor_new_chat_pending: false });
        this._broadcastSessionSnapshot();
      }
      if (session.agentType === 'codex-desktop') {
        const desktopThreads = Array.isArray(session._lastThreadList) ? session._lastThreadList : [];
        const hasThreadRows = desktopThreads.length > 0;
        const hasActiveThread = hasThreadRows && desktopThreads.some(t => t && t.active);
        const shouldBeListView = hasThreadRows && !hasActiveThread && messages.length === 0;
        if (shouldBeListView) {
          const wasListView = !!session._listView;
          let clearedMessages = false;
          if (!session._listView) {
            this._log('info', `[${sessionId}] Codex Desktop thread list/home visible with no active thread; entering list-view mode`);
            this._sendHistorySnapshot(sessionId, [], 'codex desktop list view clear');
            clearedMessages = true;
          }
          if (session.lastMessageCount > 0) {
            this._log('info', `[${sessionId}] Codex Desktop list view - clearing ${session.lastMessageCount} stale messages from web UI`);
            session.lastMessageCount = 0;
            session.lastObservedCount = 0;
            session.lastTranscriptSig = '';
            session.waitingForAssistant = false;
            session.pendingLast = null;
            session._accumulatedMessages = null;
            sessionStore.updateSession(sessionId, { accumulated_messages: null });
          }
          session._listView = true;
          if (!wasListView || clearedMessages) {
            this._broadcastSessionSnapshot();
          }
        } else if (session._listView && (!hasThreadRows || hasActiveThread || messages.length > 0)) {
          this._log('info', `[${sessionId}] Codex Desktop active transcript resumed; leaving list-view mode`);
          session._listView = false;
          this._broadcastSessionSnapshot();
        }
        if (session._listView) return;
      }
      if (session.agentType === 'codex-desktop') {
        messages = this._maybeUseCodexDesktopArchive(sessionId, session, messages);
        this._applyCodexDesktopArchiveSettledActivity(sessionId, session);
      }

      // ── Antigravity accumulation layer ──────────────────────────────
      // The Antigravity side panel virtualizes older turns — they disappear
      // from the DOM as the conversation grows.  Instead of treating the DOM
      // snapshot as authoritative (which would wipe history), we accumulate
      // messages in session._accumulatedMessages and merge new DOM content
      // into that buffer.
      const isAccumulating = this._isTranscriptAccumulating(session.agentType);
      let skipUnstableNoOverlap = false;

      if (isAccumulating) {
        if (!session._accumulatedMessages) {
          // First poll — seed with whatever the DOM has
          session._accumulatedMessages = messages.slice();
          session._accumulatedDirty = true;
        } else {
          let completionCollapseMatched = false;
          if (
            session.agentType === 'codex-desktop'
            && this._shouldReplaceCodexDesktopAccumulatorWithFreshWindow(session._accumulatedMessages, messages)
          ) {
            session._accumulatedMessages = messages.slice();
            session._accumulatedDirty = true;
            session._forceHistoryResync = 'codex desktop fresh visual window';
            completionCollapseMatched = true;
            this._log('info', `[${sessionId}] Replaced stale Codex Desktop accumulated transcript with fresh visual-unit window`);
            this._maybePersistAccumulatedMessages(sessionId, session);
          }
          if (
            session.agentType === 'codex-desktop' ||
            (session.agentType === 'codex' && messages.length <= 8)
          ) {
            const completionMerge = this._mergeCodexCompletionCollapse(session._accumulatedMessages, messages);
            if (completionMerge.matched) {
              completionCollapseMatched = true;
              if (completionMerge.changed) {
                session._accumulatedMessages = completionMerge.messages;
                session._accumulatedDirty = true;
                session._forceHistoryResync = 'codex completion collapse retained';
                this._log('info', `[${sessionId}] Retained Codex work transcript across completed-task collapse`);
              }
              this._maybePersistAccumulatedMessages(sessionId, session);
            }

            if (session.agentType === 'codex-desktop') {
              const sparseMerge = this._mergeCodexSparseTranscriptWindow(session._accumulatedMessages, messages);
              if (sparseMerge.matched) {
                completionCollapseMatched = true;
                if (sparseMerge.changed) {
                  session._accumulatedMessages = sparseMerge.messages;
                  session._accumulatedDirty = true;
                  session._forceHistoryResync = 'codex desktop sparse transcript merge';
                  this._log('info', `[${sessionId}] Merged sparse Codex Desktop transcript window into retained history`);
                }
                this._maybePersistAccumulatedMessages(sessionId, session);
              }
            }
          }

          // Merge: find where current DOM messages overlap with the accumulated tail
          // The DOM always shows the newest N messages, so we match backwards.
          const acc  = session._accumulatedMessages;
          const dom  = messages;

          if (dom.length > 0 && !completionCollapseMatched) {
            // Find the longest suffix of `acc` that is a prefix of `dom`
            // (i.e. how many of the last accumulated messages are still visible)
            let expandedHistoricalMessage = false;
            let overlapLen = 0;
            for (let tryLen = Math.min(acc.length, dom.length); tryLen >= 1; tryLen--) {
              let match = true;
              for (let k = 0; k < tryLen; k++) {
                const accMsg = acc[acc.length - tryLen + k];
                const domMsg = dom[k];
                const messagesMatch = session.agentType === 'cursor'
                  ? this._cursorMessagesSoftMatch(accMsg, domMsg)
                  : this._messagesSoftMatch(accMsg, domMsg);
                if (!messagesMatch) { match = false; break; }
              }
              if (match) { overlapLen = tryLen; break; }
            }

            if (overlapLen > 0) {
              const accStart = acc.length - overlapLen;
              if (
                this._shouldResetAccumulatorOnNoOverlap(session.agentType) &&
                accStart === 0 &&
                dom.length < acc.length
              ) {
                const domSig = this._transcriptSignature(dom);
                if (session._accumulatorPrefixTruncateSig === domSig) {
                  this._log('warn', `[${sessionId}] ${session.agentType} transcript tail disappeared twice; trimming accumulated history to active chat/thread`);
                  session._accumulatedMessages = dom.slice();
                  session._accumulatedDirty = true;
                  session._forceHistoryResync = `${session.agentType} accumulator trim`;
                  session._accumulatorPrefixTruncateSig = null;
                } else {
                  this._log('warn', `[${sessionId}] ${session.agentType} transcript is a shorter prefix; waiting for stable repeat before trimming`);
                  session._accumulatorPrefixTruncateSig = domSig;
                  skipUnstableNoOverlap = true;
                }
              }
              // Update overlapping tail (content may have grown from streaming)
              for (let k = 0; !skipUnstableNoOverlap && !session._forceHistoryResync && k < overlapLen; k++) {
                const accIdx = acc.length - overlapLen + k;
                const domIdx = k;
                const mergedMsg = (session.agentType === 'codex' || session.agentType === 'codex-desktop')
                  ? this._mergeCodexExpandedToolContent(acc[accIdx], dom[domIdx])
                  : dom[domIdx];
                if (mergedMsg !== dom[domIdx]) {
                  dom[domIdx] = mergedMsg;
                }
                // Keep growing content. Antigravity v2 also finalizes metadata such as
                // `Thinking.` -> `Thought for 1s` without changing block text; retain
                // those equal-text structural updates so relay history matches native.
                if (this._shouldReplaceAccumulatedMessage(session.agentType, acc[accIdx], dom[domIdx])) {
                  acc[accIdx] = session.agentType === 'cursor'
                    ? this._preserveCursorObservationMetadata(acc[accIdx], dom[domIdx])
                    : dom[domIdx];
                  session._accumulatedDirty = true;
                  if (accIdx < acc.length - 1) expandedHistoricalMessage = true;
                  if (
                    !session._forceHistoryResync &&
                    accIdx === acc.length - 1 &&
                    (session.agentType === 'codex' || session.agentType === 'codex-desktop') &&
                    this._isCodexCompletionSummaryMessage(dom[domIdx])
                  ) {
                    session._forceHistoryResync = `${session.agentType} completion tail update`;
                  }
                }
              }
              if (expandedHistoricalMessage && !session._forceHistoryResync) {
                session._forceHistoryResync = `${session.agentType} expanded historical transcript content`;
              }
              // Append truly new messages
              for (let k = overlapLen; !skipUnstableNoOverlap && !session._forceHistoryResync && k < dom.length; k++) {
                acc.push(dom[k]);
                session._accumulatedDirty = true;
              }
              if (!skipUnstableNoOverlap && !session._forceHistoryResync) {
                session._accumulatorNoOverlapCandidateSig = null;
                session._accumulatorPrefixTruncateSig = null;
              }
            } else {
              // No overlap — the DOM jumped to completely new content.
              // This can happen after a /clear or new_chat. Check if all DOM
              // messages are already in the tail of acc (subset check).
              if (this._shouldResetAccumulatorOnNoOverlap(session.agentType)) {
                const domSig = this._transcriptSignature(dom);
                if (session._accumulatorNoOverlapCandidateSig === domSig) {
                  this._log('warn', `[${sessionId}] ${session.agentType} transcript window lost overlap twice; resetting accumulated history to active chat/thread`);
                  session._accumulatedMessages = dom.slice();
                  session._accumulatedDirty = true;
                  session._forceHistoryResync = `${session.agentType} accumulator reset`;
                  session._accumulatorNoOverlapCandidateSig = null;
                } else {
                  this._log('warn', `[${sessionId}] ${session.agentType} transcript window lost overlap; waiting for a stable repeat before resetting`);
                  session._accumulatorNoOverlapCandidateSig = domSig;
                  skipUnstableNoOverlap = true;
                }
              } else {
                if (session.agentType === 'cursor') {
                  const cursorMerge = this._mergeCursorTranscriptWindow(acc, dom);
                  session._accumulatedMessages = cursorMerge.messages;
                  if (cursorMerge.changed) session._accumulatedDirty = true;
                } else {
                  const lastAccContent = acc.length > 0 ? acc[acc.length - 1].content : '';
                  const firstDomContent = dom[0]?.content || '';
                  // If the DOM first message matches nothing in recent history, append all
                  if (!lastAccContent || !firstDomContent.startsWith(lastAccContent.substring(0, 80))) {
                    for (const m of dom) {
                      acc.push(m);
                      session._accumulatedDirty = true;
                    }
                  }
                }
              }
            }
          }
        }
        let cursorObservation = null;
        if (session.agentType === 'cursor' && Array.isArray(session._accumulatedMessages)) {
          cursorObservation = this._prepareCursorMessageObservations(
            session.cursorAgentId || session._activeThreadKey,
            session._accumulatedMessages,
            {
              sequence: session._cursorMessageObservationSeq,
              observedAtMs: Date.now(),
              observeCurrent: true,
            },
          );
          session._cursorMessageObservationSeq = cursorObservation.sequence;
          if (cursorObservation.changed) {
            session._accumulatedMessages = cursorObservation.messages;
            session._accumulatedDirty = true;
          }
        }
        this._maybePersistAccumulatedMessages(sessionId, session, {
          force: cursorObservation?.newlyObserved > 0,
        });
        if (cursorObservation?.newlyObserved > 0) sessionStore.flushPendingSaves();
      }

      // Use accumulated messages for antigravity sessions, DOM snapshot for others
      const effectiveMessages = isAccumulating ? (session._accumulatedMessages || messages) : messages;
      const transcriptSig = this._transcriptSignature(effectiveMessages);
      const prevObservedCount = session.lastObservedCount ?? session.lastMessageCount;
      const previousObservedMessages = Array.isArray(session._lastObservedMessages)
        ? session._lastObservedMessages
        : null;
      const prefixMutationIndex = effectiveMessages.length > prevObservedCount
        ? completedPrefixMutationIndex(
          previousObservedMessages,
          effectiveMessages,
          session.lastMessageCount,
        )
        : -1;
      const appendedCandidateStableEnd = appendedMutationCandidateStableEnd(
        session._resyncCandidateMessages,
        effectiveMessages,
      );
      session._lastObservedMessages = this._cloneTranscriptMessages(effectiveMessages);

      // Keep _lastFirstMessageContent in sync with the last KNOWN-STABLE
      // state (when sig matches lastTranscriptSig, nothing changed since
      // the last successful sync). When sig changes and we enter the
      // "in-place mutation" branch below, _lastFirstMessageContent still
      // reflects the prior chat's first message, so we can compare and
      // detect a chat switch on the very first observation.
      if (transcriptSig === session.lastTranscriptSig && effectiveMessages.length > 0) {
        session._lastFirstMessageContent = (effectiveMessages[0]?.content || '').substring(0, 200);
      }

      if (skipUnstableNoOverlap) {
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        return;
      }

      if (session._forceHistoryResync) {
        const reason = session._forceHistoryResync;
        session._forceHistoryResync = null;
        this._sendHistorySnapshot(sessionId, effectiveMessages, reason);
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
        session._lastRegressionSnapshotSig = null;
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session._lastFirstMessageContent = (effectiveMessages[0]?.content || '').substring(0, 200);
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session._resyncCandidateMessages = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      if (prefixMutationIndex >= 0 || appendedCandidateStableEnd >= 0) {
        const codexArchiveSettled = session.agentType === 'codex-desktop'
          && session._codexDesktopArchivePollSettledActivity?.kind === 'idle';
        const stableEnd = codexArchiveSettled
          ? effectiveMessages.length
          : appendedCandidateStableEnd >= 0
            ? appendedCandidateStableEnd
            : effectiveMessages.length - 1;
        const stableMessages = effectiveMessages.slice(0, stableEnd);
        this._log(
          'warn',
          `[${sessionId}] Completed prefix mutation at ${prefixMutationIndex >= 0 ? prefixMutationIndex : 'stabilized candidate'} with appended tail; resyncing ${stableEnd} stable messages`,
        );
        const accepted = this._sendHistorySnapshot(
          sessionId,
          stableMessages,
          'completed prefix mutation',
        );
        if (!accepted) {
          session._lastObservedMessages = previousObservedMessages;
          return;
        }
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
        session._lastRegressionSnapshotSig = null;
        session.lastMessageCount = stableEnd;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session._lastFirstMessageContent = (effectiveMessages[0]?.content || '').substring(0, 200);
        session.pendingLast = stableEnd < effectiveMessages.length
          ? effectiveMessages[effectiveMessages.length - 1]
          : null;
        session.resyncCandidateSig = null;
        session._resyncCandidateMessages = null;
        session.waitingForAssistant = stableEnd > 0
          && effectiveMessages[stableEnd - 1]?.role === 'user';
        return;
      }

      if (effectiveMessages.length < prevObservedCount) {
        // For accumulating sessions this should rarely happen (new chat / clear)
        const regressionSig = `${prevObservedCount}->${effectiveMessages.length}:${transcriptSig}`;
        if (session._lastRegressionSnapshotSig === regressionSig) {
          session.lastMessageCount = effectiveMessages.length;
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          session.pendingLast = null;
          session.resyncCandidateSig = null;
          session._resyncCandidateMessages = null;
          session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
          return;
        }
        session._lastRegressionSnapshotSig = regressionSig;
        this._log('warn', `[${sessionId}] Transcript regressed ${prevObservedCount} -> ${effectiveMessages.length}${isAccumulating ? ' (accumulated)' : ''}, forcing history snapshot`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'transcript regression');
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session._lastFirstMessageContent = (effectiveMessages[0]?.content || '').substring(0, 200);
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session._resyncCandidateMessages = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      const pendingTail = session.pendingLast !== null
        ? effectiveMessages[session.lastMessageCount]
        : null;
      const isV2PendingAssistantMutation = session.agentType === 'antigravity-v2' &&
        session.pendingLast?.role === 'assistant' &&
        pendingTail?.role === 'assistant';

      if (
        session.lastTranscriptSig &&
        transcriptSig !== session.lastTranscriptSig &&
        effectiveMessages.length === prevObservedCount &&
        !isV2PendingAssistantMutation
      ) {
        // Chat switch detection: if the FIRST message content differs from
        // what we last sent, this isn't a streaming mutation — the user
        // navigated to a different conversation. Fire the snapshot on the
        // first observation instead of waiting for a stable repeat (which
        // added 2-3s of WebUI lag on every chat switch).
        const firstChanged = (() => {
          if (!session._lastFirstMessageContent) return false;
          const newFirst = effectiveMessages[0]?.content || '';
          return newFirst.substring(0, 200) !== session._lastFirstMessageContent;
        })();
        if (firstChanged || session.resyncCandidateSig === transcriptSig) {
          const reason = firstChanged ? 'chat switch' : 'transcript mutation';
          this._log('warn', `[${sessionId}] ${reason} detected, forcing history snapshot`);
          this._sendHistorySnapshot(sessionId, effectiveMessages, reason);
          this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
          session.lastMessageCount = effectiveMessages.length;
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          session._lastFirstMessageContent = (effectiveMessages[0]?.content || '').substring(0, 200);
          session.pendingLast = null;
          session.resyncCandidateSig = null;
          session._resyncCandidateMessages = null;
          session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
          return;
        }
        session.resyncCandidateSig = transcriptSig;
        session._resyncCandidateMessages = this._cloneTranscriptMessages(effectiveMessages);
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        return;
      }

      if (session.resyncCandidateSig && session.resyncCandidateSig === transcriptSig) {
        this._log('warn', `[${sessionId}] Mutated transcript stabilized — resyncing`);
        this._sendHistorySnapshot(sessionId, effectiveMessages, 'message count drift');
        this._maybePersistAccumulatedMessages(sessionId, session, { force: true });
        session.lastMessageCount = effectiveMessages.length;
        session.lastObservedCount = effectiveMessages.length;
        session.lastTranscriptSig = transcriptSig;
        session.pendingLast = null;
        session.resyncCandidateSig = null;
        session._resyncCandidateMessages = null;
        session.waitingForAssistant = effectiveMessages.length > 0 && effectiveMessages[effectiveMessages.length - 1].role === 'user';
        return;
      }

      if (effectiveMessages.length < session.lastMessageCount) {
        this._log('warn', `[${sessionId}] Msg count regressed ${session.lastMessageCount} → ${effectiveMessages.length}, resetting`);
        session.lastMessageCount = effectiveMessages.length;
        session.pendingLast = null;
      }

      // Pending stabilisation
      if (session.pendingLast !== null) {
        const p       = session.pendingLast;
        const current = effectiveMessages[session.lastMessageCount];
        const pendingMatchesCurrent = current && current.role === p.role && (
          session.agentType === 'antigravity-v2'
            ? this._transcriptSignature([current]) === this._transcriptSignature([p])
            : current.content === p.content
        );
        if (pendingMatchesCurrent) {
          if (session.agentType === 'codex-desktop' && p.role === 'assistant') {
            try {
              const ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
              if (ts?.thinking) {
                const observedAt = new Date().toISOString();
                let genActivity = {
                  kind: 'thinking',
                  label: ts.label || 'Thinking',
                  updated_at: observedAt,
                };
                if (session.taskList) {
                  genActivity.task_list = session.taskList;
                  genActivity.step = liveStepFromTaskList(session.taskList);
                }
                const canonicalGoal = this._canonicalGoalForSession(
                  sessionId,
                  session,
                  ts.goal,
                  session.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom',
                );
                if (canonicalGoal) genActivity.goal = canonicalGoal;
                const usage = codexUsageActivity(session);
                if (usage) genActivity.usage = usage;
                if (ts.reasoningText || /^Thinking$/i.test(ts.label || '')) {
                  genActivity.thinking = { text: ts.reasoningText || '' };
                }
                if (ts.current) genActivity.current = ts.current;
                else if (/^Generating$/i.test(ts.label || '')) {
                  genActivity.current = { kind: 'answer', label: 'Answering', partial: '' };
                }
                if (ts.thinkingContent) genActivity.thinkingContent = ts.thinkingContent;
                genActivity = this._applyGoalRunLifecycle(sessionId, session, genActivity, {
                  source: 'codex_desktop_dom',
                  sourceCursor: { mode: 'live_dom', end_offset: Date.now() },
                  nativeEventAt: observedAt,
                  observedAt,
                  evidenceType: 'native_goal_dom',
                  liveLeaseProof: !!ts.goal,
                  ownerState: 'confirmed',
                });
                session.thinking = true;
                session.thinkingLabel = genActivity.label;
                session.thinkingContent = ts.thinkingContent || '';
                session._goalSig = canonicalGoal ? JSON.stringify({
                  fingerprint: canonicalGoal.fingerprint || '',
                  state: canonicalGoal.state || canonicalGoal.status || '',
                  transition_seq: Number(canonicalGoal.transition_seq || 0),
                  time_used_seconds: Number(canonicalGoal.time_used_seconds || 0),
                }) : '';
                session.activity = genActivity;
                sessionStore.updateSession(sessionId, { activity: genActivity });
                this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
                session.lastObservedCount = effectiveMessages.length;
                session.lastTranscriptSig = transcriptSig;
                return;
              }
            } catch {}
          }
          this._log('info', `[${sessionId}] Stable ${p.role} msg (${p.content.length} chars)`);
          const stableStreamContent = session.agentType === 'antigravity-v2'
            ? this._transcriptSignature([p])
            : p.content;
          if (shouldSendStablePendingMessage(p, session._lastStreamedContent, stableStreamContent)) {
            this._sendProxyMessage(sessionId, p);
          }
          session.lastMessageCount++;
          session.pendingLast = null;
          session._pendingFirstSeenAt = null;
          session._lastStreamedContent = null;
          if (p.role === 'user')      session.waitingForAssistant = true;
          if (p.role === 'assistant') session.waitingForAssistant = false;
        } else if (current) {
          // Track how long the pending message has been changing
          if (!session._pendingFirstSeenAt) session._pendingFirstSeenAt = Date.now();
          const pendingAge = Date.now() - session._pendingFirstSeenAt;
          // Flush a full resync while content is changing.
          // Codex (both side pane and Desktop) benefits from a much shorter
          // threshold because its transcript/tool output evolves rapidly.
          const isCodexAny = session.agentType === 'codex' || session.agentType === 'codex-desktop' || session.agentType === 'cursor';
          const streamFlushMs = session.agentType === 'antigravity-v2' ? 500 : (isCodexAny ? 1500 : 5000);
          // Previously codex-desktop assistant updates were held back here, which
          // left the WebUI permanently stale during long generations (the /goal
          // task case where the assistant grows for hours without "stabilising").
          // Stream them through like every other agent — the relay's per-session
          // history throttle already coalesces over-frequent broadcasts.
          const streamedSignature = session.agentType === 'antigravity-v2'
            ? this._transcriptSignature([current])
            : current.content;
          const streamCursorAssistantNow = session.agentType === 'cursor'
            && shouldImmediatelyStreamCursorAssistant(p, current);
          const streamAntigravityV2AssistantNow = session.agentType === 'antigravity-v2'
            && shouldImmediatelyStreamAntigravityV2Assistant(p, current);
          if ((streamCursorAssistantNow || streamAntigravityV2AssistantNow || pendingAge > streamFlushMs)
            && streamedSignature !== session._lastStreamedContent) {
            session._lastStreamedContent = streamedSignature;
            this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
            this._log('info', `[${sessionId}] Streaming flush (${effectiveMessages.length} msgs, pending ${Math.round(pendingAge / 1000)}s)`);
          }
          session.pendingLast = current;
          session.lastObservedCount = effectiveMessages.length;
          session.lastTranscriptSig = transcriptSig;
          if (session.activity?.kind !== 'generating' && session.activity?.kind !== 'thinking') {
            const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
            if (session.taskList) genActivity.task_list = session.taskList;
            session.activity = genActivity;
            sessionStore.updateSession(sessionId, { activity: genActivity });
            this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
          }
          return;
        }
      }

      // Send newly complete messages
      const prev = session.lastMessageCount;
      if (effectiveMessages.length > prev) {
        const codexArchiveSettled = session.agentType === 'codex-desktop'
          && session._codexDesktopArchivePollSettledActivity?.kind === 'idle';
        const stableEnd = codexArchiveSettled
          ? effectiveMessages.length
          : effectiveMessages.length - 1;
        for (let i = prev; i < stableEnd; i++) {
          this._log('info', `[${sessionId}] New ${effectiveMessages[i].role} msg (${effectiveMessages[i].content.length} chars)`);
          this._sendProxyMessage(sessionId, effectiveMessages[i]);
          if (effectiveMessages[i].role === 'user')      session.waitingForAssistant = true;
          if (effectiveMessages[i].role === 'assistant') session.waitingForAssistant = false;
        }
        session.lastMessageCount = stableEnd;
        if (codexArchiveSettled) {
          session.pendingLast = null;
          session.waitingForAssistant = false;
        } else {
          const last = effectiveMessages[effectiveMessages.length - 1];
          session.pendingLast = last;
          if (session.agentType === 'antigravity-v2' && last?.role === 'assistant') {
            session._pendingFirstSeenAt = Date.now();
            if (shouldImmediatelyStreamAntigravityV2Assistant(null, last)) {
              session._lastStreamedContent = this._transcriptSignature([last]);
              this._sendHistorySnapshot(sessionId, effectiveMessages, 'assistant completion');
              this._log('info', `[${sessionId}] Streaming first Antigravity v2 assistant tail (${last.content.length} chars)`);
            }
          }
        }
      }

      session.lastObservedCount = effectiveMessages.length;
      session.lastTranscriptSig = transcriptSig;
      session.resyncCandidateSig = null;
      session._resyncCandidateMessages = null;

      // Thinking / activity state. For Codex surfaces, reuse the cached
      // detection when the conversation DOM signature is unchanged from
      // the previous poll — detectThinking does a heavy DOM walk that
      // saturates the renderer's main thread and is the largest remaining
      // contributor to Codex wedging on idle sessions.
      let ts;
      if (this._isCodexSurface(session.agentType)) {
        const cachedTs = selectors.getCodexCachedThinking(sessionId);
        if (cachedTs) {
          ts = cachedTs;
        } else {
          ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
          selectors.setCodexCachedThinking(sessionId, ts);
        }
      } else {
        ts = await selectors.detectThinking(session.client.Runtime, session.agentType);
      }
      if ((session._activityEpoch || 0) !== pollActivityEpoch) return;
      if (session._interruptSettled && ts.thinking) session._interruptSettled = false;
      const active = session._interruptSettled
        ? false
        : (session.pendingLast !== null || session.waitingForAssistant);
      const ownedQuestion = this.activeQuestionPromptAdapters.get(sessionId);
      const waitingForQuestion = ['codex', 'codex-desktop'].includes(ownedQuestion?.adapter_surface)
        && ownedQuestion.claimed !== true;
      let kind = waitingForQuestion ? 'waiting_for_user' : ts.thinking ? 'thinking' : active ? 'generating' : 'idle';
      let label = waitingForQuestion
        ? (ownedQuestion.prompt?.title || 'Needs input')
        : (ts.label || (active ? 'Generating' : ''));
      const observedAt = new Date().toISOString();
      let newActivity;
      if (session.agentType === 'cursor') {
        newActivity = cursorNativeActivity({
          native_status: session.nativeStatus,
          native_working: session.nativeWorking === true,
        }, session.activity, {
          nowMs: Date.parse(observedAt),
          correlatedTranscriptWorking: ts.thinking === true || active,
        });
        kind = newActivity.kind;
        label = newActivity.label;
      } else {
        newActivity = { kind, label, updated_at: observedAt };
      }
      // Carry forward task list from previous activity
      if (session.taskList) {
        newActivity.task_list = session.taskList;
        newActivity.step = liveStepFromTaskList(session.taskList);
      }
      const canonicalGoal = this._canonicalGoalForSession(
        sessionId,
        session,
        ts.goal,
        session.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom',
      );
      if (canonicalGoal) newActivity.goal = canonicalGoal;
      const usage = codexUsageActivity(session);
      if (usage) newActivity.usage = usage;
      if (ts.reasoningText || (ts.thinking && /^Thinking$/i.test(label))) {
        newActivity.thinking = { text: ts.reasoningText || '' };
      }
      if (ts.current) newActivity.current = ts.current;
      else if (active && /^Generating$/i.test(label)) {
        newActivity.current = { kind: 'answer', label: 'Answering', partial: '' };
      }
      // Legacy field retained while older clients roll forward. Canonical
      // clients consume the separate thinking/current channels above.
      if (ts.thinkingContent) {
        newActivity.thinkingContent = ts.thinkingContent;
      }
      newActivity = this._applyGoalRunLifecycle(sessionId, session, newActivity, {
        source: session.agentType === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom',
        sourceCursor: { mode: 'live_dom', end_offset: Date.now() },
        nativeEventAt: observedAt,
        observedAt,
        evidenceType: 'native_goal_dom',
        liveLeaseProof: !!ts.goal,
        ownerState: 'confirmed',
      });

      const prevKind = session.activity?.kind || 'idle';
      const prevThinkingContent = session.thinkingContent || '';
      const currThinkingContent = ts.thinkingContent || '';
      const liveChannelsSig = JSON.stringify({
        thinking: newActivity.thinking ? { text: newActivity.thinking.text || '' } : null,
        current: newActivity.current ? {
          kind: newActivity.current.kind || '',
          label: newActivity.current.label || '',
          partial: newActivity.current.partial || '',
        } : null,
        step: newActivity.step || null,
        usage: newActivity.usage || null,
      });
      const goalSig = canonicalGoal ? JSON.stringify({
        fingerprint: canonicalGoal.fingerprint || '',
        state: canonicalGoal.state || canonicalGoal.status || '',
        transition_seq: Number(canonicalGoal.transition_seq || 0),
        time_used_seconds: Number(canonicalGoal.time_used_seconds || 0),
      }) : '';
      if (ts.thinking !== session.thinking || label !== session.thinkingLabel || kind !== prevKind || currThinkingContent !== prevThinkingContent || goalSig !== (session._goalSig || '') || liveChannelsSig !== (session._liveChannelsSig || '')) {
        session.thinking     = ts.thinking;
        session.thinkingLabel = label;
        session.thinkingContent = currThinkingContent;
        session._goalSig = goalSig;
        session._liveChannelsSig = liveChannelsSig;
        session.activity     = newActivity;
        sessionStore.updateSession(sessionId, { activity: newActivity });
        this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', newActivity));

        // Auto-send queued messages when agent transitions to idle
        if ((prevKind === 'generating' || prevKind === 'thinking') && kind === 'idle') {
          this._processMessageQueue(sessionId);
        }
      } else {
        if (session.agentType === 'cursor') session.activity = newActivity;
        if (session.agentType !== 'cursor' || newActivity.cursor_evidence_source !== 'continuity_lease') {
          this._emitActivityObservationHeartbeat(sessionId, session, { observedAt });
        }
      }


      // Thread list polling — Codex Desktop only (Epic 2)
      // Polls every 10 cycles (~30-50s) to keep the thread list current.
      if (session.agentType === 'codex-desktop'
          || (session.agentType === 'cursor' && !session._cursorVirtual)) {
        if (session._threadListPollCount === undefined) {
          session._threadListPollCount = staggerOffset(sessionId, 'threadList', 60);
        }
        session._threadListPollCount += 1;
        const codexThreadBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexThreadBusy && session._threadListPollCount >= 60) {
          session._threadListPollCount = 0;
          const listPromise = session.agentType === 'cursor'
            ? require('./cursor-selectors').readCursorAgentList(session.client.Runtime)
            : selectors.readCodexThreadList(session.client.Runtime, true);
          await listPromise
            .then(threads => {
              this._applyCodexDesktopThreadList(sessionId, session, threads);
            })
            .catch(() => {});
        }
      }

      // Rate limit / usage warning check — Codex and Claude
      if (session.agentType === 'codex') {
        // Time-based auto-clear: if we have a reset time and it's passed, clear immediately
        if (session.rateLimitActive && session.rate_limited_until && session.rate_limited_until !== 'unknown') {
          const untilStr = session.rate_limited_until;
          // Parse time like "2:50 PM", "14:50", "3h", "30m"
          let resetMs = null;
          const hmMatch = untilStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
          if (hmMatch) {
            let h = parseInt(hmMatch[1], 10);
            const m = parseInt(hmMatch[2], 10);
            const ampm = (hmMatch[3] || '').toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            const now = new Date();
            const resetDate = new Date(now);
            resetDate.setHours(h, m, 0, 0);
            // If the reset time is earlier today, it may have been yesterday's — assume it's passed
            resetMs = resetDate.getTime();
          }
          const durationMatch = untilStr.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$|^(\d+)\s*m$/i);
          if (durationMatch && session._rateLimitDetectedAt) {
            const hours = parseInt(durationMatch[1] || '0', 10);
            const mins = parseInt(durationMatch[2] || durationMatch[3] || '0', 10);
            resetMs = session._rateLimitDetectedAt + (hours * 3600000) + (mins * 60000);
          }
          if (resetMs && Date.now() > resetMs) {
            this._log('info', `[${sessionId}] [rate-limit] Time-based auto-clear: ${untilStr} has passed`);
            session.rateLimitActive = false;
            session.rate_limited_until = null;
            session.percentUsed = null;
            session._rateLimitSig = null;
            this._sendToRelay(proto.rateLimitCleared(sessionId));
            this._broadcastSessionSnapshot();
          }
        }

        if (session._rateLimitPollCount === undefined) {
          session._rateLimitPollCount = staggerOffset(sessionId, 'rateLimit', 30);
        }
        session._rateLimitPollCount += 1;
        const codexRateBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!codexRateBusy && !session._rateLimitPollInProgress && session._rateLimitPollCount >= 30) {
          session._rateLimitPollCount = 0;
          session._rateLimitPollInProgress = true;
          const readFn = session.agentType === 'codex'
            ? selectors.readCodexRateLimit(session.client.Runtime)
            : selectors.readClaudeRateLimit(session.client.Runtime);
          readFn.then(rl => {
            const wasActive = session.rateLimitActive || false;
            const nowActive = rl?.rate_limited === true;
            const untilText = rl?.until_text || null;
            const pctUsed   = rl?.percent_used ?? null;
            const hasBanner = pctUsed != null;
            const sig = `${nowActive}|${pctUsed}|${untilText}`;
            if (sig !== session._rateLimitSig) {
              session._rateLimitSig = sig;
              session.rateLimitActive    = nowActive;
              session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
              session.percentUsed        = hasBanner ? pctUsed : null;
              if (nowActive) {
                if (!wasActive) session._rateLimitDetectedAt = Date.now();
                this._log('info', `[${sessionId}] [rate-limit] Active: ${pctUsed != null ? pctUsed + '%' : ''} resets ${untilText || 'unknown'}`);
                this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed, true));
              } else if (hasBanner) {
                // Usage warning (banner visible but not hard-limited) — send percent for display
                this._log('info', `[${sessionId}] [rate-limit] Usage: ${pctUsed}% resets ${untilText || 'unknown'}`);
                this._sendToRelay(proto.rateLimitActive(sessionId, untilText, pctUsed, false));
              } else if (wasActive || session.percentUsed != null) {
                this._log('info', `[${sessionId}] [rate-limit] Cleared`);
                this._sendToRelay(proto.rateLimitCleared(sessionId));
              }
              this._broadcastSessionSnapshot();
            }
          }).catch(() => {})
            .finally(() => { session._rateLimitPollInProgress = false; });
        }
      }

      if (session.agentType === 'cursor') {
        if (session._rateLimitPollCount === undefined) {
          session._rateLimitPollCount = staggerOffset(sessionId, 'rateLimit', 30);
        }
        session._rateLimitPollCount += 1;
        const cursorRateBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (!cursorRateBusy && !session._rateLimitPollInProgress && session._rateLimitPollCount >= 30) {
          session._rateLimitPollCount = 0;
          session._rateLimitPollInProgress = true;
          require('./cursor-selectors').readCursorRateLimit(session.client.Runtime)
            .then(rl => {
              const wasActive = session.rateLimitActive || false;
              const nowActive = rl?.rate_limited === true;
              const untilText = rl?.until_text || null;
              const sig = `${nowActive}|${untilText}`;
              if (sig !== session._rateLimitSig) {
                session._rateLimitSig = sig;
                session.rateLimitActive = nowActive;
                session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
                if (nowActive && !wasActive) {
                  this._sendToRelay(proto.rateLimitActive(sessionId, untilText, null, true));
                  this._broadcastSessionSnapshot();
                } else if (wasActive && !nowActive) {
                  this._sendToRelay(proto.rateLimitCleared(sessionId));
                  this._broadcastSessionSnapshot();
                }
              }
            })
            .catch(() => {})
            .finally(() => { session._rateLimitPollInProgress = false; });
        }
      }

      // Native queue detection — Codex side-panel queue items (messages with Steer buttons)
      if (session.agentType === 'codex' || session.agentType === 'codex-desktop') {
        const nativeQueuePollEvery = 10;
        if (session._nativeQueuePollCount === undefined) {
          session._nativeQueuePollCount = staggerOffset(sessionId, 'nativeQueue', nativeQueuePollEvery);
        }
        session._nativeQueuePollCount += 1;
        if (!session._nativeQueuePollInProgress && session._nativeQueuePollCount >= nativeQueuePollEvery) {
          session._nativeQueuePollCount = 0;
          session._nativeQueuePollInProgress = true;
          const usePageEval = session.agentType === 'codex-desktop';
          selectors.readCodexNativeQueue(session.client.Runtime, usePageEval).then(items => {
            const sig = items.map(i => i.text).join('|');
            const changed = sig !== (session._nativeQueueSig || '');
            // Always re-send every ~10 polls (~30s) so new browsers pick it up
            session._nativeQueueResendCount = (session._nativeQueueResendCount || 0) + 1;
            const forceResend = items.length > 0 && session._nativeQueueResendCount >= 10;
            if (changed || forceResend) {
              if (forceResend) session._nativeQueueResendCount = 0;
              session._nativeQueueSig = sig;
              session.nativeQueue = items;
              if (changed && items.length > 0) {
                this._log('info', `[${sessionId}] [native-queue] ${items.length} items detected`);
              }
              this._sendToRelay(proto.nativeQueue(sessionId, items));
            }
          }).catch((e) => { this._log('warn', `[${sessionId}] [native-queue] Error: ${e.message}`); })
            .finally(() => { session._nativeQueuePollInProgress = false; });
          // Fire-and-forget — previously codex-desktop awaited this and the
          // task list serially, stacking ~6s of CDP eval per poll on long sessions.
        }
      }

      if (session.agentType === 'codex-desktop') {
        if (session._automationViewPollCount === undefined) {
          session._automationViewPollCount = staggerOffset(sessionId, 'automationView', 30);
        }
        session._automationViewPollCount += 1;
        const codexAuxBusy = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
        if (codexAuxBusy) session._lastBusyAt = Date.now();
        const auxRelevant = codexAuxBusy ||
          (session._lastBusyAt && Date.now() - session._lastBusyAt < 30000);
        if (auxRelevant && !session._automationViewPollInProgress && session._automationViewPollCount >= 30) {
          session._automationViewPollCount = 0;
          session._automationViewPollInProgress = true;
          selectors.readCodexAutomationView(session.client.Runtime, true)
            .then(view => {
            const sig = view ? JSON.stringify(view) : '';
            if (sig !== (session._automationViewSig || '')) {
              session._automationViewSig = sig;
              this._sendToRelay(proto.codexAutomationView(sessionId, view));
            }
            })
            .catch(e => { this._log('warn', `[${sessionId}] automation_view error: ${e.message}`); })
            .finally(() => { session._automationViewPollInProgress = false; });
        }
      }


    } catch (e) {
      this._log('error', `[${sessionId}] Poll error: ${e.message}`);
    } finally {
      session._pollInProgress = false;
      session._pollStartedAt = 0;
    }
  }

  // ─── Permission dialog polling ───────────────────────────────────────

  async _pollCodexVsCodeQuestionBounded(sessionId, hintContextId = null) {
    const session = this.sessions.get(sessionId);
    if (!session || session.agentType !== 'codex' || !session.client?.Runtime) return;
    if (Number.isInteger(hintContextId)) {
      if (!(session._vscodeQuestionPollHintContextIds instanceof Set)) {
        session._vscodeQuestionPollHintContextIds = new Set();
      }
      session._vscodeQuestionPollHintContextIds.add(hintContextId);
    }
    if (session._vscodeQuestionPollInProgress) {
      this._scheduleCodexVsCodeQuestionPoll(sessionId, session, 50);
      return;
    }
    const now = Date.now();
    if (session._vscodeQuestionPollBackoffUntil && now < session._vscodeQuestionPollBackoffUntil) {
      this._scheduleCodexVsCodeQuestionPoll(
        sessionId,
        session,
        session._vscodeQuestionPollBackoffUntil - now,
      );
      return;
    }
    session._vscodeQuestionPollBackoffUntil = 0;

    const activityKind = String(session.activity?.kind || '').toLowerCase();
    const remotePollWindowActive = now < Number(session._vscodeQuestionRemotePollUntil || 0);
    const questionRelevant = session.pendingLast !== null
      || session.waitingForAssistant === true
      || remotePollWindowActive
      || this._hasOpenCodexVsCodeQuestion(sessionId)
      || ['thinking', 'generating', 'working', 'waiting_for_user'].includes(activityKind);
    const minIntervalMs = questionRelevant
      ? Number(this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS || 150)
      : Number(this.VSCODE_CODEX_QUESTION_IDLE_POLL_INTERVAL_MS || 750);
    const elapsedMs = now - Number(session._lastCodexVsCodeQuestionPollAt || 0);
    if (session._lastCodexVsCodeQuestionPollAt && elapsedMs < minIntervalMs) {
      this._scheduleCodexVsCodeQuestionPoll(sessionId, session, minIntervalMs - elapsedMs);
      return;
    }

    session._vscodeQuestionPollInProgress = true;
    session._lastCodexVsCodeQuestionPollAt = now;
    const work = (async () => {
      const hintedContextIds = session._vscodeQuestionPollHintContextIds instanceof Set
        ? [...session._vscodeQuestionPollHintContextIds]
        : [];
      const observerContextIds = (this._domPush?.getState?.(sessionId)?.installedContextIds || [])
        .filter(Number.isInteger)
        .reverse();
      const candidateContextIds = [...new Set([...hintedContextIds, ...observerContextIds])];
      session._vscodeQuestionPollHintContextIds = new Set();
      let question = null;
      let matchedContextId = null;
      let validHintContextId = null;
      for (const contextId of candidateContextIds) {
        question = await selectors.detectCodexVsCodeQuestion(
          session.client.Runtime,
          { contextId },
        );
        if (!question?.error) validHintContextId = contextId;
        if (question) {
          matchedContextId = contextId;
          break;
        }
      }
      if (!question && Number.isInteger(validHintContextId)) {
        session.client.Runtime._innerContextId = validHintContextId;
        session._iframeInnerContextId = validHintContextId;
      }
      if (!question) question = await selectors.detectCodexVsCodeQuestion(session.client.Runtime);
      if (this.sessions.get(sessionId) !== session) return;
      if (question && !question.error && Number.isInteger(matchedContextId)) {
        session.client.Runtime._innerContextId = matchedContextId;
        session._iframeInnerContextId = matchedContextId;
      }
      await this._handleCodexVsCodeQuestionState(sessionId, session, question);
      session._vscodeQuestionPollBackoffUntil = 0;
    })();
    const settled = work.then(
      () => ({ status: 'settled' }),
      error => {
        this._log('warn', `[${sessionId}] [question] VS Code fast poll error: ${error.message}`);
        return { status: 'failed' };
      },
    ).finally(() => {
      session._vscodeQuestionPollInProgress = false;
    });

    const timeoutMs = Math.max(10, Number(this.VSCODE_CODEX_QUESTION_POLL_TIMEOUT_MS || 1500));
    let timeout;
    const outcome = await Promise.race([
      settled,
      new Promise(resolve => {
        timeout = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (outcome.status === 'timeout') {
      session._vscodeQuestionPollBackoffUntil = Date.now() + 250;
      this._scheduleCodexVsCodeQuestionPoll(sessionId, session, 250);
      this._log('warn', `[${sessionId}] [question] VS Code fast poll exceeded ${timeoutMs}ms; retaining the in-flight read`);
    }
    const current = this.sessions.get(sessionId);
    if (current === session && !this._hasOpenCodexVsCodeQuestion(sessionId)) {
      const currentActivityKind = String(session.activity?.kind || '').toLowerCase();
      const stillQuestionRelevant = session.pendingLast !== null
        || session.waitingForAssistant === true
        || Date.now() < Number(session._vscodeQuestionRemotePollUntil || 0)
        || ['thinking', 'generating', 'working'].includes(currentActivityKind);
      if (stillQuestionRelevant) {
        this._scheduleCodexVsCodeQuestionPoll(
          sessionId,
          session,
          Number(this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS || 150),
        );
      }
    }
  }

  async _pollCodexDesktopQuestionBounded(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.agentType !== 'codex-desktop' || !session.client?.Runtime) return;
    if (session._questionPollInProgress) {
      this._scheduleCodexDesktopQuestionPoll(sessionId, session, 50);
      return;
    }
    const now = Date.now();
    if (session._questionPollBackoffUntil && now < session._questionPollBackoffUntil) {
      this._scheduleCodexDesktopQuestionPoll(sessionId, session, session._questionPollBackoffUntil - now);
      return;
    }
    session._questionPollBackoffUntil = 0;

    const activityKind = String(session.activity?.kind || '').toLowerCase();
    const remotePollWindowActive = now < Number(session._codexDesktopQuestionRemotePollUntil || 0);
    const questionRelevant = session.pendingLast !== null
      || session.waitingForAssistant === true
      || remotePollWindowActive
      || this._hasOpenCodexDesktopQuestion(sessionId)
      || ['thinking', 'generating', 'working', 'waiting_for_user'].includes(activityKind);
    const minIntervalMs = questionRelevant
      ? Number(this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS || 200)
      : Number(this.CODEX_DESKTOP_QUESTION_IDLE_POLL_INTERVAL_MS || 750);
    const elapsedMs = now - Number(session._lastCodexDesktopQuestionPollAt || 0);
    if (session._lastCodexDesktopQuestionPollAt && elapsedMs < minIntervalMs) {
      this._scheduleCodexDesktopQuestionPoll(sessionId, session, minIntervalMs - elapsedMs);
      return;
    }

    session._questionPollInProgress = true;
    session._lastCodexDesktopQuestionPollAt = now;
    const work = (async () => {
      // This detector is deliberately read-only and uses an isolated exact-target
      // client without waiting for the shared mutation lock. A long transcript
      // read or the originating send can hold that lock across the native card's
      // only DOM signal. Exact active-thread validation below fails closed if a
      // concurrent owner temporarily changes the selected thread. Answers remain
      // serialized under the shared lock.
      const question = await this._withFreshCodexDesktopQuestionClient(
        session,
        client => selectors.detectCodexDesktopQuestion(client.Runtime),
        'poll',
      );
      if (this.sessions.get(sessionId) !== session) return;
      await this._handleCodexDesktopQuestionState(sessionId, session, question);
      session._questionPollBackoffUntil = 0;
    })();
    const settled = work.then(
      () => ({ status: 'settled' }),
      error => {
        this._log('warn', `[${sessionId}] [question] Desktop fast poll error: ${error.message}`);
        return { status: 'failed' };
      },
    ).finally(() => {
      session._questionPollInProgress = false;
    });

    const timeoutMs = Math.max(10, Number(this.CODEX_DESKTOP_QUESTION_POLL_TIMEOUT_MS || 1500));
    let timeout;
    const outcome = await Promise.race([
      settled,
      new Promise(resolve => {
        timeout = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (outcome.status === 'timeout') {
      session._questionPollBackoffUntil = Date.now() + 250;
      this._scheduleCodexDesktopQuestionPoll(sessionId, session, 250);
      this._log('warn', `[${sessionId}] [question] Desktop fast poll exceeded ${timeoutMs}ms; retaining the in-flight read`);
    }
    const current = this.sessions.get(sessionId);
    if (current === session && !this._hasOpenCodexDesktopQuestion(sessionId)) {
      const currentActivityKind = String(session.activity?.kind || '').toLowerCase();
      const stillQuestionRelevant = session.pendingLast !== null
        || session.waitingForAssistant === true
        || Date.now() < Number(session._codexDesktopQuestionRemotePollUntil || 0)
        || ['thinking', 'generating', 'working'].includes(currentActivityKind);
      if (stillQuestionRelevant) {
        this._scheduleCodexDesktopQuestionPoll(
          sessionId,
          session,
          Number(this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS || 200),
        );
      }
    }
  }

  async _pollSessionBounded(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const now = Date.now();
    if (this._isCodexSurface(session.agentType) && session._pollInProgress) {
      const inFlightAge = now - Number(session._pollStartedAt || now);
      if ((session._priorityControlInFlight || 0) > 0) return;
      if (inFlightAge < 60000) return;
      this._log('warn', `[${sessionId}] Codex poll remained in-flight for ${inFlightAge}ms; closing genuinely stuck CDP client`);
      session._intentionalPollClose = true;
      if (session.client?.Runtime) session.client.Runtime._suppressReadErrors = true;
      this._cooldownCdpTarget(
        session,
        `hard-stuck Codex Desktop poll (${inFlightAge}ms)`,
        CODEX_DESKTOP_HARD_STUCK_COOLDOWN_MS
      );
      sessionStore.markDisconnected(sessionId);
      await this._safeClose(session.client, `hard-stuck poll close ${sessionId.substring(0, 8)}`);
      this.sessions.delete(sessionId);
      this._broadcastSessionSnapshot();
      return;
    }
    if (this._isCdpTargetCooling(session.targetId)) return;
    if (session._pollBackoffUntil && now < session._pollBackoffUntil) return;
    if (session._pollBackoffUntil && now >= session._pollBackoffUntil) {
      session._pollBackoffUntil = 0;
    }
    let cdpLockRelease = null;
    if (session.agentType === 'codex-desktop') {
      cdpLockRelease = await acquireCodexDesktopCdpLock(`proxy-poll-${sessionId}`, { waitMs: 0 });
      if (!cdpLockRelease) return;
    }
    const timeoutMs =
      session.agentType === 'codex-desktop' ? 15000 :
      this._isCodexSurface(session.agentType) ? 6000 :
      (session.agentType === 'continue' || session.agentType === 'continue_yolo') ? 10000 :
      12000;
    let timer = null;
    let pollPromise = null;
    const pollStartedAt = Date.now();
    try {
      pollPromise = this._pollSession(sessionId);
      if (cdpLockRelease) pollPromise.then(cdpLockRelease, cdpLockRelease);
      await Promise.race([
        pollPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`poll timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      // Surface unusually slow polls — these correspond to long-blocking
      // CDP evals on the agent's renderer. Legitimate streaming polls take
      // 1-2s while the renderer's main thread is busy producing content,
      // so 4s is the threshold that distinguishes "busy" from "stuck".
      const dur = Date.now() - pollStartedAt;
      const slowThresh = (session.agentType === 'codex' || session.agentType === 'codex-desktop') ? 4000 : 3000;
      if (dur >= slowThresh) {
        if (this._isCodexSurface(session.agentType)) {
          session._slowCodexPollCount = (session._slowCodexPollCount || 0) + 1;
          if (session._slowCodexPollCount >= 5) {
            session._pollBackoffUntil = Date.now() + 3000;
            session._slowCodexPollCount = 0;
            this._log('warn', `[${sessionId}] Codex polling backed off for 3s after repeated slow polls`);
          }
        }
        this._log('warn', `[${sessionId}] slow poll: ${dur}ms (agent=${session.agentType})`);
      } else if (this._isCodexSurface(session.agentType)) {
        session._slowCodexPollCount = 0;
      }
      // Reset timeout counter on successful poll. Tracked on `this` keyed
      // by targetId so the count persists across the session deletion that
      // happens on timeout (a rediscovered session gets a fresh object).
      if (!this._consecutiveTimeoutsByTarget) this._consecutiveTimeoutsByTarget = new Map();
      if (session.targetId) this._consecutiveTimeoutsByTarget.delete(session.targetId);
    } catch (e) {
      if (session.agentType === 'codex'
          && String(e.message || '').startsWith('poll timeout after ')
          && (session._priorityControlInFlight || 0) > 0) {
        // A relay send/control shares this target's CDP socket. Runtime.evaluate
        // cannot be cancelled, so closing the timed-out background poll here
        // also rejects the authoritative control and can escape as a transport
        // error. Preserve the socket until the exact session control settles;
        // the in-flight watchdog above still closes a true 60-second wedge.
        session._pollBackoffUntil = Date.now() + 5000;
        this._log('warn', `[${sessionId}] Codex poll exceeded ${timeoutMs}ms during a priority control; retaining the shared CDP client`);
        return;
      }
      if (session.agentType === 'codex-desktop' && String(e.message || '').startsWith('poll timeout after ')) {
        // Runtime.evaluate cannot be cancelled. During active output (or a
        // simultaneous read-only validator) a valid bounded read can remain
        // queued behind Electron work for longer than the normal budget.
        // Keep the CDP client and accumulator intact so the in-flight promise
        // can settle; the 60-second watchdog above still closes a true wedge.
        session._pollBackoffUntil = Date.now() + 5000;
        this._log('warn', `[${sessionId}] Codex Desktop poll exceeded ${timeoutMs}ms; retaining session while the in-flight read settles`);
        return;
      }

      this._log('warn', `[${sessionId}] ${e.message}; closing CDP client for rediscovery`);
      if (this._isCodexSurface(session.agentType)) {
        // Escalating cooldown: a single timeout is often transient (renderer
        // briefly busy), but consecutive timeouts mean Codex is genuinely
        // wedged — and continued CDP polling makes recovery slower. Back off
        // hard so the renderer has breathing room to unwedge itself.
        if (!this._consecutiveTimeoutsByTarget) this._consecutiveTimeoutsByTarget = new Map();
        const tid = session.targetId;
        const prev = this._consecutiveTimeoutsByTarget.get(tid) || 0;
        const next = prev + 1;
        this._consecutiveTimeoutsByTarget.set(tid, next);
        boundOldestMap(this._consecutiveTimeoutsByTarget, RUNTIME_METADATA_MAP_MAX_ENTRIES);
        // Escalating: 0s → 10s → 30s → 60s
        let cooldown = 0;
        if (next >= 4) cooldown = 60000;
        else if (next === 3) cooldown = 30000;
        else if (next === 2) cooldown = 10000;
        if (cooldown > 0) {
          this._cooldownCdpTarget(session, e.message, cooldown);
          this._log('warn', `[${sessionId}] Codex target cooled ${cooldown/1000}s after ${next} consecutive timeouts`);
        }
      }
      sessionStore.markDisconnected(sessionId);
      await this._safeClose(session.client, `poll close ${sessionId.substring(0,8)}`);
      this.sessions.delete(sessionId);
      this._broadcastSessionSnapshot();
    } finally {
      if (timer) clearTimeout(timer);
      if (cdpLockRelease && !pollPromise) cdpLockRelease();
    }
  }

  _makePromptId(sessionId, message, choices) {
    const raw = `${sessionId}||${message}||${choices.map(c => c.choice_id).join('|')}`;
    return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
  }

  _makeErrorPromptId(sessionId, prompt = {}) {
    const actions = Array.isArray(prompt.actions) ? prompt.actions.map(a => a.action_id || a.label || '').join('|') : '';
    const raw = `${sessionId}||${prompt.title || ''}||${prompt.message || ''}||${prompt.error_output || ''}||${prompt.display_mode || ''}||${prompt.blocking === false ? 'nonblocking' : 'blocking'}||${actions}`;
    return crypto.createHash('sha1').update(raw).digest('hex').substring(0, 16);
  }

  async _pollPermissions(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.agentType === 'claude_cli' || session.agentType === 'codex_cli' || session.agentType === 'cursor_cli') return;
    if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
      try {
        const promptState = await this._withEphemeralIframeClient(session, async client => {
          const [dialog, errorPrompt] = await Promise.all([
            selectors.detectPermissionDialog(client.Runtime, session.agentType),
            selectors.detectSessionErrorPrompt(client.Runtime, session.agentType),
          ]);
          return { dialog, errorPrompt };
        }, 'permission_detect');
        const dialog = promptState?.dialog || null;
        const errorPrompt = promptState?.errorPrompt || null;
        await this._handlePermissionDialogState(sessionId, session, dialog);
        await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);
      } catch (e) {
        this._log('error', `[${sessionId}] [perm] Continue poll error: ${e.message}`);
      }
      return;
    }

    try {
      if (session.agentType === 'codex') {
        await this._pollCodexVsCodeQuestionBounded(sessionId);
        if (this._hasOpenCodexVsCodeQuestion(sessionId)) return;
      }
      if (session.agentType === 'codex-desktop') {
        const question = await selectors.detectCodexDesktopQuestion(session.client.Runtime);
        await this._handleCodexDesktopQuestionState(sessionId, session, question);
        if (this._hasOpenCodexDesktopQuestion(sessionId)) return;
      }
      const [dialog, errorPrompt] = await Promise.all([
        selectors.detectPermissionDialog(session.client.Runtime, session.agentType),
        selectors.detectSessionErrorPrompt(session.client.Runtime, session.agentType),
      ]);
      await this._handlePermissionDialogState(sessionId, session, dialog);
      await this._handleSessionErrorPromptState(sessionId, session, errorPrompt);
    } catch (e) {
      this._log('error', `[${sessionId}] [perm] Poll error: ${e.message}`);
    }
  }

  async _pollPermissionsBounded(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session._permissionPollInProgress) return;
    if (session._permissionPollBackoffUntil && Date.now() < session._permissionPollBackoffUntil) return;
    if (session._permissionPollBackoffUntil) session._permissionPollBackoffUntil = 0;

    let cdpLockRelease = null;
    if (session.agentType === 'codex-desktop') {
      cdpLockRelease = await acquireCodexDesktopCdpLock(`proxy-permission-${sessionId}`, { waitMs: 0 });
      if (!cdpLockRelease) return;
    }

    const timeoutMs =
      session.agentType === 'codex-desktop'
        ? this.CODEX_DESKTOP_PERMISSION_POLL_TIMEOUT_MS
        : session.agentType === 'continue' || session.agentType === 'continue_yolo' || session.agentType === 'roo_code' || session.agentType === 'cline'
        ? 5000
        : 3500;

    session._permissionPollInProgress = true;
    let timer = null;
    let permissionPromise = null;
    try {
      permissionPromise = this._pollPermissions(sessionId);
      if (cdpLockRelease) permissionPromise.then(cdpLockRelease, cdpLockRelease);
      await Promise.race([
        permissionPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`permission poll timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (e) {
      this._log('warn', `[${sessionId}] [perm] ${e.message}`);
      if (shouldRetainCodexDesktopPermissionTimeout(session, e)) {
        // Runtime.evaluate cannot be cancelled. A busy Codex renderer can
        // legitimately exceed this small permission budget while its
        // transcript is changing. Closing the shared client here races relay
        // sends and leaves them holding a dead session object. Keep the
        // in-flight read and its CDP lock intact; a real disconnect still
        // removes the session through the client's disconnect handler.
        session._permissionPollBackoffUntil = Date.now() + 5000;
        this._log('warn', `[${sessionId}] [perm] Codex Desktop permission read is still in flight; retaining shared CDP client`);
        return;
      }
      if (!this._isEphemeralIframeAgent(session.agentType)) {
        await this._safeClose(session.client, `perm close ${sessionId.substring(0,8)}`);
        sessionStore.markDisconnected(sessionId);
        this.sessions.delete(sessionId);
        this._broadcastSessionSnapshot();
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (cdpLockRelease && !permissionPromise) cdpLockRelease();
      session._permissionPollInProgress = false;
    }
  }

  async _handleSessionErrorPromptState(sessionId, session, prompt) {
    if (prompt) {
      const promptId = this._makeErrorPromptId(sessionId, prompt);
      const last = this.activeErrorPrompts.get(sessionId);
      if (last && last.prompt_id === promptId) return;

      const payload = {
        prompt_id:     promptId,
        title:         prompt.title || 'Error handling model response',
        message:       prompt.message || 'There was an error handling the model response.',
        error_output:  prompt.error_output || null,
        actions:       Array.isArray(prompt.actions) ? prompt.actions : [],
        display_mode:  prompt.display_mode || 'overlay',
        blocking:      prompt.blocking !== false,
      };
      this._log('info', `[${sessionId}] [error-prompt] detected: "${payload.title}" actions=${payload.actions.map(a => a.action_id).join(',')}`);
      this.activeErrorPrompts.set(sessionId, { prompt_id: promptId, prompt: payload, surfaced: true });
      this._sendToRelay(proto.sessionErrorPrompt(sessionId, payload));
      return;
    }

    if (this.activeErrorPrompts.has(sessionId)) {
      const last = this.activeErrorPrompts.get(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      if (last?.surfaced) {
        this._log('info', `[${sessionId}] [error-prompt] cleared`);
        this._sendToRelay(proto.sessionErrorPromptCleared(sessionId, last.prompt_id));
      }
    }
  }

  _stabilizeContinueConfig(session, cfg) {
    if (!session || !cfg) return cfg;

    if (this._isContinuePlaceholderValue(cfg.model_id)) {
      cfg.model_id = 'unknown';
    }
    if (this._isContinuePlaceholderValue(cfg.permission_mode)) {
      cfg.permission_mode = 'unknown';
    }
    cfg.available_models = this._sanitizeContinueModelList(cfg.available_models);

    if (!this._isContinuePlaceholderValue(cfg.model_id)) {
      session._lastContinueModelId = cfg.model_id;
    }
    if (!this._isContinuePlaceholderValue(cfg.permission_mode)) {
      session._lastContinuePermissionMode = cfg.permission_mode;
    }
    if (Array.isArray(cfg.available_models) && cfg.available_models.length > 0) {
      session._lastAvailableModels = cfg.available_models;
    }

    if (this._isContinuePlaceholderValue(cfg.model_id) && session._lastContinueModelId) {
      cfg.model_id = session._lastContinueModelId;
    }
    if (this._isContinuePlaceholderValue(cfg.permission_mode) && session._lastContinuePermissionMode) {
      cfg.permission_mode = session._lastContinuePermissionMode;
    }

    if ((!Array.isArray(cfg.available_models) || cfg.available_models.length === 0) && Array.isArray(session._lastAvailableModels) && session._lastAvailableModels.length > 0) {
      cfg.available_models = session._lastAvailableModels;
    } else if (!cfg.model_id || cfg.model_id === 'unknown' || !cfg.permission_mode || cfg.permission_mode === 'unknown' || !Array.isArray(cfg.available_models) || cfg.available_models.length === 0) {
      const sibling = Array.from(this.sessions.values()).find(s =>
        s !== session &&
        s.agentType === session.agentType &&
        s.workspace_path === session.workspace_path &&
        (
          (s._lastContinueModelId && s._lastContinueModelId !== 'unknown') ||
          (s._lastContinuePermissionMode && s._lastContinuePermissionMode !== 'unknown') ||
          (Array.isArray(s._lastAvailableModels) && s._lastAvailableModels.length > 0)
        )
      );
      if (sibling) {
        if ((!cfg.permission_mode || cfg.permission_mode === 'unknown') && sibling._lastContinuePermissionMode) {
          cfg.permission_mode = sibling._lastContinuePermissionMode;
          session._lastContinuePermissionMode = sibling._lastContinuePermissionMode;
        }
        if ((!Array.isArray(cfg.available_models) || cfg.available_models.length === 0) && Array.isArray(sibling._lastAvailableModels) && sibling._lastAvailableModels.length > 0) {
          cfg.available_models = sibling._lastAvailableModels;
          session._lastAvailableModels = sibling._lastAvailableModels;
        }
      }
    }

    session._continueConfigCache = cfg;
    return cfg;
  }

  _isContinuePlaceholderValue(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    return (
      text === 'unknown' ||
      text === 'select model' ||
      text === 'loading config' ||
      text === 'loading' ||
      text === 'choose model'
    );
  }

  _isUsableContinueModelOption(value) {
    const text = String(value || '').trim();
    if (this._isContinuePlaceholderValue(text)) return false;
    if (text.length > 120) return false;
    if (/\.md\b/i.test(text)) return false;
    if (/always applied/i.test(text)) return false;
    if (/^[0-9]+\.\s/.test(text)) return false;
    if (/[|`]/.test(text)) return false;
    if (/[\\/]/.test(text) && !/^[a-z0-9._:+ -]+$/i.test(text)) return false;
    return true;
  }

  _sanitizeContinueModelList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const cleaned = [];
    for (const item of list) {
      const text = String(item || '').trim();
      if (!this._isUsableContinueModelOption(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(text);
    }
    return cleaned;
  }

  _hasUsableContinueModels(list) {
    return this._sanitizeContinueModelList(list).length > 0;
  }

  _mergeContinueConfigs(primary, secondary) {
    if (!primary && !secondary) return null;
    if (!primary) return secondary;
    if (!secondary) return primary;

    const merged = { ...primary };
    const primaryModelUsable = !this._isContinuePlaceholderValue(primary.model_id);
    const secondaryModelUsable = !this._isContinuePlaceholderValue(secondary.model_id);
    const primaryModeUsable = !this._isContinuePlaceholderValue(primary.mode);
    const secondaryModeUsable = !this._isContinuePlaceholderValue(secondary.mode);
    const primaryPermUsable = !this._isContinuePlaceholderValue(primary.permission_mode);
    const secondaryPermUsable = !this._isContinuePlaceholderValue(secondary.permission_mode);
    const primaryModelsUsable = this._hasUsableContinueModels(primary.available_models);
    const secondaryModelsUsable = this._hasUsableContinueModels(secondary.available_models);

    if (!primaryModelUsable && secondaryModelUsable) merged.model_id = secondary.model_id;
    if (!primaryModeUsable && secondaryModeUsable) merged.mode = secondary.mode;
    if (!primaryPermUsable && secondaryPermUsable) merged.permission_mode = secondary.permission_mode;
    if (!primaryModelsUsable && secondaryModelsUsable) merged.available_models = secondary.available_models;

    return merged;
  }

  _shouldBackgroundPollContinueConfig(session) {
    if (!session || (session.agentType !== 'continue' && session.agentType !== 'continue_yolo')) return false;
    if (session.agentType === 'continue_yolo') {
      const cached = session._continueConfigCache || null;
      const modelKnown = !!(cached && !this._isContinuePlaceholderValue(cached.model_id));
      const permKnown = !!(cached && !this._isContinuePlaceholderValue(cached.permission_mode));
      const modelsKnown = !!(cached && this._hasUsableContinueModels(cached.available_models));
      return !(modelKnown && permKnown && modelsKnown);
    }
    return true;
  }

  // ─── Send request handler ────────────────────────────────────────────

  async _handleSendRequest(msg) {
    const { session: sessionId, content, file, client_message_id } = msg;
    let sessionData = this.sessions.get(sessionId);

    if (!sessionData) {
      this._log('warn', `[send] Unknown session: ${sessionId}`);
      if (client_message_id) {
        this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'failed', {
          error: { code: 'session_unknown', message: `No active session: ${sessionId}` },
        }));
      }
      return;
    }

    let messageContent = content;

    if (file) {
      const localPath = path.join(this.LOCAL_UPLOAD_DIR, file.storedName);
      try {
        const decoded = Buffer.from(file.data, 'base64');
        fs.writeFileSync(localPath, decoded);
        this._localUploadInventory.retained += 1;
        this._localUploadInventory.retainedBytes += decoded.length;
        if (Date.now() - this._lastLocalUploadMaintenanceAt >= 60_000
          || this._localUploadInventory.retained > LOCAL_UPLOAD_MAX_FILES
          || this._localUploadInventory.retainedBytes > LOCAL_UPLOAD_MAX_BYTES) {
          this._runLocalUploadMaintenance();
        }
        this._log('info', `[${sessionId}] File saved: ${localPath}`);
        const winPath = localPath.replace(/\//g, '\\');
        messageContent = content
          .replace(/\[File: [^\]]+\]\(\/uploads\/[^)]+\)/, `[File: ${file.originalName} → ${winPath}]`)
          .replace(/!\[[^\]]*\]\(\/uploads\/[^)]+\)/, `[File: ${file.originalName} → ${winPath}]`);
      } catch (e) {
        this._log('error', `[${sessionId}] File save failed: ${e.message}`);
      }
    }

    const sendFingerprint = crypto.createHash('sha256').update(String(messageContent || ''), 'utf8').digest('hex');
    this._log('info', `[${sessionId}] Injecting cid=${client_message_id || 'legacy'} sha256=${sendFingerprint} bytes=${Buffer.byteLength(String(messageContent || ''), 'utf8')}`);

    // Pre-send busy check for Codex: if the agent is busy, queue the message
    // and type it into ProseMirror so Codex shows its native Steer button.
    // The web UI shows queued messages with Steer buttons that click the native button.
    const isCodexType = sessionData.agentType === 'codex' || sessionData.agentType === 'codex-desktop';
    let activityKind = sessionData.activity?.kind;
    if (isCodexType && (activityKind === 'thinking' || activityKind === 'generating') && client_message_id) {
      const cachedActivityKind = activityKind;
      try {
        const freshThinking = await selectors.detectThinking(sessionData.client.Runtime, sessionData.agentType);
        if (freshThinking?.thinking === false) {
          const idleActivity = { kind: 'idle', label: '', updated_at: new Date().toISOString() };
          activityKind = 'idle';
          sessionData.thinking = false;
          sessionData.thinkingLabel = '';
          sessionData.thinkingContent = '';
          sessionData.waitingForAssistant = false;
          sessionData.activity = idleActivity;
          sessionStore.updateSession(sessionId, { activity: idleActivity });
          this._sendToRelay(proto.proxyStatus(sessionId, sessionData.status || 'healthy', idleActivity));
          this._log('info', `[${sessionId}] [send] Cleared stale ${cachedActivityKind} cache after native idle recheck`);
        }
      } catch (error) {
        this._log('warn', `[${sessionId}] [send] Native busy recheck failed; preserving ${activityKind}: ${error.message}`);
      }
    }
    if (isCodexType && (activityKind === 'thinking' || activityKind === 'generating') && client_message_id) {
      if (!sessionData.messageQueue) sessionData.messageQueue = [];
      const isFirstInQueue = sessionData.messageQueue.length === 0;
      sessionData.messageQueue.push({ content: messageContent, client_message_id, queued_at: Date.now() });
      // Only type the FIRST queued message into ProseMirror (so Codex shows its
      // native Steer button). Subsequent messages stay in proxy queue — typing
      // each one would overwrite the previous in the single ProseMirror input.
      if (isFirstInQueue) {
        const usePageEval = sessionData.agentType === 'codex-desktop';
        await selectors.steerCodexInput(sessionData.client.Runtime, messageContent, usePageEval);
      }
      this._log('info', `[${sessionId}] Agent is ${activityKind} — queued ${client_message_id} (depth: ${sessionData.messageQueue.length})${isFirstInQueue ? ' + typed into input' : ''}`);
      this._sendToRelay(proto.messageQueued(sessionId, client_message_id, messageContent));
      return;
    }

    let result;
    let sendLockRelease = null;
    let codexDesktopArchiveBaseline = null;
    try {
      if (sessionData.agentType === 'codex-desktop') {
        sendLockRelease = await acquireCodexDesktopCdpLock(`proxy-send-${sessionId}`, {
          waitMs: this.CODEX_DESKTOP_SEND_LOCK_WAIT_MS,
        });
        if (!sendLockRelease) {
          result = {
            ok: false,
            code: 'codex_desktop_cdp_busy',
            detail: `Codex Desktop CDP remained busy for ${this.CODEX_DESKTOP_SEND_LOCK_WAIT_MS}ms`,
          };
        } else {
          // Discovery may have replaced a disconnected client while this send
          // waited for the shared lock. Always use the current session object.
          sessionData = this.sessions.get(sessionId) || sessionData;
          try {
            codexDesktopArchiveBaseline = await this._captureCodexDesktopArchiveReceiptBaseline(
              sessionId,
              sessionData,
              messageContent,
            );
            if (!codexDesktopArchiveBaseline) {
              this._log('warn', `[${sessionId}] Codex Desktop exact archive receipt baseline unavailable; retaining DOM-only confirmation`);
            }
          } catch (error) {
            this._log('warn', `[${sessionId}] Codex Desktop archive receipt baseline unavailable: ${error.message}`);
          }
        }
      }

      if (!result) {
        for (let attempt = 0; attempt <= SEND_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            this._log('info', `[${sessionId}] [send] Retry ${attempt}/${SEND_MAX_RETRIES} in ${SEND_RETRY_DELAY_MS}ms (prev: ${result.code})`);
            await new Promise(r => setTimeout(r, SEND_RETRY_DELAY_MS));
            if (!this.sessions.has(sessionId)) {
              result = { ok: false, code: 'session_gone', detail: 'Session removed during send retry' };
              break;
            }
          }
          result = await this._sendSessionMessage(sessionData, messageContent, sessionId, {
            clientMessageId: client_message_id || null,
          });
          if (result.ok) break;
          if (!RETRIABLE_SEND_CODES.has(result.code)) break;
        }
      }

      if (
        sessionData.agentType === 'codex-desktop'
        && result?.code === 'native_user_turn_not_observed'
      ) {
        const archiveReceipt = await this._confirmCodexDesktopArchiveReceipt(
          sessionId,
          sessionData,
          messageContent,
          codexDesktopArchiveBaseline,
        );
        if (archiveReceipt?.ok) {
          result = archiveReceipt;
        } else {
          const recovery = await this._recoverCodexDesktopSendAfterTransportLoss(
            sessionId,
            sessionData,
            messageContent,
            result,
          );
          result = recovery.result;
          sessionData = recovery.session;
        }
      }
    } finally {
      if (sendLockRelease) sendLockRelease();
    }

    // Queue message if agent is busy (steer feature)
    if (!result.ok && result.code === 'agent_busy' && client_message_id) {
      if (!sessionData.messageQueue) sessionData.messageQueue = [];
      sessionData.messageQueue.push({ content: messageContent, client_message_id, queued_at: Date.now() });
      this._log('info', `[${sessionId}] Agent busy — queued message ${client_message_id} (queue depth: ${sessionData.messageQueue.length})`);
      this._sendToRelay(proto.messageQueued(sessionId, client_message_id, messageContent));
      return;
    }

    if (result.ok && !result.lifecycle_managed) {
      sessionData._activityEpoch = (sessionData._activityEpoch || 0) + 1;
      sessionData._interruptSettled = false;
      sessionData.waitingForAssistant = true;
      const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
      sessionData.activity = genActivity;
      if (sessionData.agentType === 'continue' || sessionData.agentType === 'continue_yolo') {
        sessionData._remoteFastPollUntil = Date.now() + 120000;
        sessionData._continueTailSettleUntil = 0;
        sessionData._continueTailContent = null;
      }
      sessionStore.updateSession(sessionId, { activity: genActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, sessionData.status || 'healthy', genActivity));
    } else if (result.ok && result.lifecycle_managed) {
      sessionData.waitingForAssistant = true;
    }
    if (result.ok && sessionData.agentType === 'codex') {
      sessionData._vscodeQuestionRemotePollUntil = Date.now()
        + Number(this.VSCODE_CODEX_QUESTION_REMOTE_POLL_WINDOW_MS || 120000);
      this._scheduleCodexVsCodeQuestionPoll(
        sessionId,
        sessionData,
        Number(this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS || 150),
      );
    }
    if (result.ok && sessionData.agentType === 'codex-desktop') {
      sessionData._codexDesktopQuestionRemotePollUntil = Date.now()
        + Number(this.CODEX_DESKTOP_QUESTION_REMOTE_POLL_WINDOW_MS || 120000);
      this._scheduleCodexDesktopQuestionPoll(
        sessionId,
        sessionData,
        Number(this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS || 200),
      );
    }

    if (client_message_id) {
      if (result.ok) {
        const deliveryEmitted = this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'delivered', {
          lifecycle: result.lifecycle_managed ? 'native_user_turn_observed' : 'injection_confirmed',
          native_receipt: result.native_receipt || null,
          process_epoch: result.process_epoch || null,
        }));
        if (result.lifecycle_managed && deliveryEmitted) {
          this._persistCodexCliReceiptState(sessionId, sessionData, {
            state: 'native_user_turn_observed',
            native_receipt: result.native_receipt,
            delivery_emitted: true,
          });
        }
        if (result.lifecycle_managed && result.agent_start_promise) {
          Promise.resolve(result.agent_start_promise).then(agentStart => {
            if (agentStart?.ok) {
              const emitted = this._sendToRelay(proto.agentStarted(
                sessionId,
                client_message_id,
                result.native_receipt,
                agentStart.agent_started,
              ));
              if (emitted) this._persistCodexCliReceiptState(sessionId, sessionData, {
                native_receipt: result.native_receipt,
                delivery_emitted: true,
                agent_started_emitted: true,
              });
            } else {
              this._log('warn', `[${sessionId}] [send] ${agentStart?.code || 'agent_start_not_observed'} for ${client_message_id}`);
            }
          }).catch(error => {
            this._log('warn', `[${sessionId}] [send] agent-start receipt failed for ${client_message_id}: ${error.message}`);
          });
        }
      } else {
        this._sendToRelay(proto.proxySendResult(sessionId, client_message_id, 'failed', {
          error: {
            code: result.code || 'send_injection_failed',
            message: result.detail || 'Inject failed after all strategies',
          },
        }));
      }
    }
  }

  // Process queued messages when agent goes idle
  async _processMessageQueue(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.messageQueue || session.messageQueue.length === 0) return;

    const item = session.messageQueue.shift();
    this._log('info', `[${sessionId}] Auto-sending queued message ${item.client_message_id}`);

    const result = await this._sendSessionMessage(session, item.content, sessionId, {
      clientMessageId: item.client_message_id || null,
    });

    if (result.ok && !result.lifecycle_managed) {
      session.waitingForAssistant = true;
      const genActivity = { kind: 'generating', label: 'Generating', updated_at: new Date().toISOString() };
      if (session.taskList) genActivity.task_list = session.taskList;
      session.activity = genActivity;
      if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
        session._remoteFastPollUntil = Date.now() + 120000;
        session._continueTailSettleUntil = 0;
        session._continueTailContent = null;
      }
      sessionStore.updateSession(sessionId, { activity: genActivity });
      this._sendToRelay(proto.proxyStatus(sessionId, session.status || 'healthy', genActivity));
    } else if (result.ok && result.lifecycle_managed) {
      session.waitingForAssistant = true;
    }
    if (result.ok && session.agentType === 'codex') {
      session._vscodeQuestionRemotePollUntil = Date.now()
        + Number(this.VSCODE_CODEX_QUESTION_REMOTE_POLL_WINDOW_MS || 120000);
      this._scheduleCodexVsCodeQuestionPoll(
        sessionId,
        session,
        Number(this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS || 150),
      );
    }
    if (result.ok && session.agentType === 'codex-desktop') {
      session._codexDesktopQuestionRemotePollUntil = Date.now()
        + Number(this.CODEX_DESKTOP_QUESTION_REMOTE_POLL_WINDOW_MS || 120000);
      this._scheduleCodexDesktopQuestionPoll(
        sessionId,
        session,
        Number(this.CODEX_DESKTOP_QUESTION_ACTIVE_POLL_INTERVAL_MS || 200),
      );
    }
    if (result.ok) {
      this._sendToRelay(proto.queueDelivered(sessionId, item.client_message_id));
      const deliveryEmitted = this._sendToRelay(proto.proxySendResult(sessionId, item.client_message_id, 'delivered', {
        lifecycle: result.lifecycle_managed ? 'native_user_turn_observed' : 'injection_confirmed',
        native_receipt: result.native_receipt || null,
        process_epoch: result.process_epoch || null,
      }));
      if (result.lifecycle_managed && deliveryEmitted) {
        this._persistCodexCliReceiptState(sessionId, session, {
          state: 'native_user_turn_observed',
          native_receipt: result.native_receipt,
          delivery_emitted: true,
        });
      }
      if (result.lifecycle_managed && result.agent_start_promise) {
        Promise.resolve(result.agent_start_promise).then(agentStart => {
          if (agentStart?.ok) {
            const emitted = this._sendToRelay(proto.agentStarted(
              sessionId,
              item.client_message_id,
              result.native_receipt,
              agentStart.agent_started,
            ));
            if (emitted) this._persistCodexCliReceiptState(sessionId, session, {
              native_receipt: result.native_receipt,
              delivery_emitted: true,
              agent_started_emitted: true,
            });
          } else {
            this._log('warn', `[${sessionId}] [queue] ${agentStart?.code || 'agent_start_not_observed'} for ${item.client_message_id}`);
          }
        }).catch(error => {
          this._log('warn', `[${sessionId}] [queue] agent-start receipt failed for ${item.client_message_id}: ${error.message}`);
        });
      }
      // Type next queued message into ProseMirror
      await this._typeNextQueuedIntoProseMirror(sessionId);
    } else if (result.code === 'agent_busy') {
      // Agent went busy again — re-queue
      session.messageQueue.unshift(item);
    } else {
      this._sendToRelay(proto.proxySendResult(sessionId, item.client_message_id, 'failed', {
        error: { code: result.code, message: result.detail || 'Queued send failed' },
      }));
      // Type next queued message into ProseMirror even on failure
      await this._typeNextQueuedIntoProseMirror(sessionId);
    }
  }

  // Handle steer request — force-send a queued message to Codex even while busy.
  // Uses steerCodexInput (type text) + Enter key dispatch (submit) to bypass
  // the SVG-based busy check that would normally block sendCodexPrimary.
  async _handleSteerRequest(msg) {
    const { session_id: sessionId, client_message_id, content, native_index } = msg;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'failed', 'Session not found'));
      return;
    }

    // Remove from proxy queue (only relevant for proxy-queued items, not native)
    if (session.messageQueue) {
      session.messageQueue = session.messageQueue.filter(m => m.client_message_id !== client_message_id);
    }

    if (session.agentType !== 'codex' && session.agentType !== 'codex-desktop') {
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'failed', 'Steer not supported'));
      return;
    }

    const idx = native_index != null ? native_index : 0;
    this._log('info', `[${sessionId}] Steer: clicking Codex native Steer button (index: ${idx})`);

    const usePageEval = session.agentType === 'codex-desktop';
    const evalFn = usePageEval ? selectors.evalInPage : selectors.evalInFrame;

    // Find and click Codex's native "Steer" button in the DOM at the specified index.
    const clickResult = await evalFn(session.client.Runtime, `
      var btns = Array.from(d.querySelectorAll('button')).filter(function(b) {
        return b.textContent.trim() === 'Steer';
      });
      var targetIdx = ${idx};
      if (btns.length > targetIdx) { btns[targetIdx].click(); return 'clicked-steer-' + targetIdx + '-of-' + btns.length; }
      if (btns.length > 0) { btns[0].click(); return 'clicked-steer-0-fallback-of-' + btns.length; }
      return 'no-steer-button';
    `);

    if (clickResult && clickResult.startsWith('clicked')) {
      this._log('info', `[${sessionId}] Steer: ${clickResult}`);
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, 'ok'));
    } else {
      // Fallback: type + Enter if native steer button not found
      this._log('warn', `[${sessionId}] Steer: native button not found (${clickResult}), falling back to type+Enter`);
      const typeResult = await selectors.steerCodexInput(session.client.Runtime, content, usePageEval);
      if (typeResult.ok) {
        await new Promise(r => setTimeout(r, 400));
        await evalFn(session.client.Runtime, `
          var input = d.querySelector('.ProseMirror');
          if (input) { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }
        `);
      }
      this._sendToRelay(proto.steerResult(sessionId, client_message_id, typeResult.ok ? 'ok' : 'failed', typeResult.ok ? null : 'fallback'));
    }
    // Type the next queued message into ProseMirror (if any remain)
    await this._typeNextQueuedIntoProseMirror(sessionId);
  }

  // After a queued message is consumed (steered/delivered/discarded),
  // type the next one into ProseMirror so Codex shows its native Steer button.
  async _typeNextQueuedIntoProseMirror(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session?.messageQueue?.length) return;
    const next = session.messageQueue[0];
    const usePageEval = session.agentType === 'codex-desktop';
    try {
      await selectors.steerCodexInput(session.client.Runtime, next.content, usePageEval);
      this._log('info', `[${sessionId}] Typed next queued message into ProseMirror: ${next.client_message_id}`);
    } catch (e) {
      this._log('warn', `[${sessionId}] Failed to type next queued: ${e.message}`);
    }
  }

  // ─── Target discovery ────────────────────────────────────────────────

  _applyCursorVirtualAgentList(targetId, agents) {
    const list = Array.isArray(agents) ? agents : [];
    const byId = new Map(list.map(agent => [String(agent?.id || ''), agent]));
    let changed = false;
    for (const session of this.sessions.values()) {
      if (!session._cursorVirtual || session.targetId !== targetId) continue;
      const agent = byId.get(String(session.cursorAgentId || ''));
      const nextActive = agent?.active === true;
      if (session._cursorNativeActive !== nextActive) {
        session._cursorNativeActive = nextActive;
        changed = true;
      }
      if (!agent) continue;
      const nextActivity = cursorNativeActivity(agent, session.activity);
      const nextNativeWorking = agent.native_working === true;
      if (session.nativeStatus !== (agent.native_status || '')
          || session.nativeWorking !== nextNativeWorking
          || session.activity?.kind !== nextActivity.kind
          || session.activity?.label !== nextActivity.label) {
        session.nativeStatus = agent.native_status || '';
        session.nativeWorking = nextNativeWorking;
        session.activity = nextActivity;
        session.waitingForAssistant = nextActivity.kind === 'generating';
        sessionStore.updateSession(session.session_id, {
          activity: nextActivity,
          cursor_native_status: session.nativeStatus,
          cursor_native_working: session.nativeWorking,
        });
        this._sendToRelay(proto.proxyStatus(session.session_id, session.status || 'healthy', nextActivity));
        changed = true;
      } else {
        session.activity = nextActivity;
        if (nextActivity.kind === 'generating' && nextActivity.cursor_evidence_source !== 'continuity_lease') {
          this._emitActivityObservationHeartbeat(session.session_id, session, {
            observedAt: nextActivity.cursor_evidence_at,
          });
        }
      }
    }
    if (changed) this._broadcastSessionSnapshot();
    return changed;
  }

  async _ensureCursorVirtualSessionActive(session) {
    if (!session?._cursorVirtual || !session.cursorAgentId) return { ok: true };
    const cursorSel = require('./cursor-selectors');
    let agents = await cursorSel.readCursorAgentList(session.client.Runtime);
    let active = agents.find(agent => agent?.active);
    if (active?.id !== session.cursorAgentId) {
      const switched = await cursorSel.switchCursorAgent(session.client.Runtime, session.cursorAgentId);
      if (!switched?.ok) return switched || { ok: false, detail: 'cursor agent switch failed' };
      agents = await cursorSel.readCursorAgentList(session.client.Runtime);
      active = agents.find(agent => agent?.active);
    }
    this._applyCursorVirtualAgentList(session.targetId, agents);
    if (active?.id !== session.cursorAgentId) {
      return { ok: false, detail: `Cursor did not activate agent ${session.cursorAgentId}` };
    }
    return { ok: true };
  }

  _attachCursorTargetDisconnectHandler(client, targetId) {
    if (!client || this._cursorDisconnectClients.has(client)) return;
    this._cursorDisconnectClients.add(client);
    client.on('disconnect', () => {
      const removed = [];
      for (const [sessionId, session] of this.sessions.entries()) {
        if (!session._cursorVirtual || session.targetId !== targetId || session.client !== client) continue;
        removed.push(sessionId);
        sessionStore.markDisconnected(sessionId);
        this.sessions.delete(sessionId);
        this.activePermissionPrompts.delete(sessionId);
        this.activeErrorPrompts.delete(sessionId);
      }
      if (removed.length > 0) {
        this._log('info', `[cursor] Shared target ${targetId.substring(0, 8)} disconnected; removed ${removed.length} agent session(s)`);
        this._broadcastSessionSnapshot();
      }
    });
  }

  async _syncCursorVirtualSessions(target, client, agents) {
    const allAgents = Array.isArray(agents) ? agents : [];
    const existingIds = new Set(Array.from(this.sessions.values())
      .filter(session => session._cursorVirtual && session.targetId === target.id)
      .map(session => session.cursorAgentId));
    const eligible = allAgents.filter(agent => cursorAgentEligible(agent, existingIds.has(agent?.id)));
    if (eligible.length === 0) return { count: 0, changed: false };

    let cursorPaths = this._readCursorWindowPaths();
    let refreshedCursorPaths = false;
    const storedSessions = sessionStore.getAllSessions();
    const legacySurfaces = storedSessions.filter(session => (
      session.agent_type === 'cursor' && !session.cursor_agent_id
    ));
    const eligibleIds = new Set(eligible.map(agent => agent.id));
    let changed = false;
    const runtimeByAgent = new Map();

    for (const agent of eligible) {
      let workspaceMatch = resolveCursorWorkspacePath(agent, cursorPaths);
      if (!workspaceMatch && !refreshedCursorPaths) {
        cursorPaths = this._readCursorWindowPaths(true);
        refreshedCursorPaths = true;
        workspaceMatch = resolveCursorWorkspacePath(agent, cursorPaths);
      }
      let runtime = Array.from(this.sessions.values()).find(session => (
        session._cursorVirtual && session.cursorAgentId === agent.id
      ));
      let sessionMeta = runtime ? sessionStore.getSession(runtime.session_id) : null;
      if (!runtime) {
        const sigSource = sessionStore.buildCursorStableSignatureSource({
          workspacePath: workspaceMatch?.path || null,
          workspaceName: agent.workspace_name || target.title || 'Cursor Agents',
          windowTitle: agent.title || target.title || 'Cursor',
          cursorAgentId: agent.id,
          cursorWorkspaceKey: agent.workspace_key || null,
        });
        sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: agent.title || target.title || 'Cursor',
          agentType: 'cursor',
          workspaceName: workspaceMatch?.title || agent.workspace_name || target.title || 'Cursor Agents',
          workspacePath: workspaceMatch?.path || null,
          sigOverride: sigSource,
          cursorAgentId: agent.id,
          cursorAgentTitle: agent.title || null,
          cursorWorkspaceKey: agent.workspace_key || null,
        });

        let initialMessages = Array.isArray(sessionMeta.accumulated_messages)
          ? sessionMeta.accumulated_messages.slice()
          : [];
        if (initialMessages.length === 0) {
          for (const legacy of legacySurfaces) {
            const histories = legacy.cursor_agent_histories || {};
            const migrated = histories[agent.id] || histories[agent.legacy_id] || null;
            if (Array.isArray(migrated) && migrated.length > 0) {
              initialMessages = migrated.slice();
              break;
            }
          }
        }
        const hadDurableHistory = initialMessages.length > 0;
        let observationSequence = Math.max(0, Number(sessionMeta.cursor_message_observation_seq) || 0);
        if (hadDurableHistory) {
          const baseline = this._prepareCursorMessageObservations(agent.id, initialMessages, {
            sequence: observationSequence,
            observeCurrent: false,
          });
          initialMessages = baseline.messages;
          observationSequence = baseline.sequence;
        }
        if (agent.active) {
          const raw = await selectors.readMessages(client.Runtime, 'cursor', sessionMeta.session_id).catch(() => null);
          const fresh = raw ? JSON.parse(raw) : [];
          if (fresh.length > 0) {
            initialMessages = initialMessages.length > 0 && this._cursorTranscriptWindowMatches(initialMessages, fresh)
              ? this._mergeCursorTranscriptWindow(initialMessages.slice(), fresh).messages
              : fresh;
          }
        }
        const nowMs = Date.now();
        const activity = cursorNativeActivity(agent, sessionMeta.activity, { nowMs });
        const initialObservation = this._prepareCursorMessageObservations(agent.id, initialMessages, {
          sequence: observationSequence,
          observedAtMs: nowMs,
          observeCurrent: hadDurableHistory
            || (sessionMeta._matched_existing === false && activity.kind === 'generating'),
        });
        initialMessages = initialObservation.messages;
        observationSequence = initialObservation.sequence;
        const now = new Date(nowMs).toISOString();
        runtime = {
          session_id: sessionMeta.session_id,
          display_name: 'Cursor',
          workspace_name: workspaceMatch?.title || agent.workspace_name || 'Cursor Agents',
          workspace_path: workspaceMatch?.path || sessionMeta.workspace_path || null,
          chat_title: agent.title || sessionMeta.chat_title || null,
          chat_title_source: agent.title ? 'native' : (sessionMeta.chat_title_source || null),
          machine_label: sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount: initialMessages.length,
          lastObservedCount: initialMessages.length,
          lastTranscriptSig: this._transcriptSignature(initialMessages),
          _accumulatedMessages: initialMessages.slice(),
          _cursorAgentHistories: { [agent.id]: initialMessages.slice() },
          _cursorMessageObservationSeq: observationSequence,
          _activeThreadKey: agent.id,
          _activeThreadTitle: agent.title || '',
          _lastThreadList: eligible.slice(),
          _lastThreadListSig: JSON.stringify(eligible.map(item => `${item.id}:${item.title}:${!!item.active}:${item.native_status || ''}`)),
          nullPollCount: 0,
          pendingLast: null,
          resyncCandidateSig: null,
          waitingForAssistant: activity.kind === 'generating',
          thinking: activity.kind === 'generating',
          thinkingLabel: activity.label,
          autoApprovePermissions: sessionMeta.auto_approve_permissions === true,
          status: 'healthy',
          activity,
          nativeStatus: agent.native_status || '',
          nativeWorking: agent.native_working === true,
          last_seen_at: now,
          windowTitle: agent.title || target.title || 'Cursor',
          agentType: 'cursor',
          parentId: null,
          ext: null,
          targetId: target.id,
          _cdpPort: target._cdpPort,
          _cdpHost: target._cdpHost || null,
          _targetUrl: target.url || '',
          _cursorVirtual: true,
          _cursorNativeActive: agent.active === true,
          cursorAgentId: agent.id,
          cursorWorkspaceKey: agent.workspace_key || null,
        };
        this.sessions.set(runtime.session_id, runtime);
        sessionStore.updateSession(runtime.session_id, {
          display_name: 'Cursor',
          window_title: runtime.windowTitle,
          workspace_name: runtime.workspace_name,
          workspace_path: runtime.workspace_path,
          chat_title: runtime.chat_title,
          chat_title_source: runtime.chat_title_source,
          cursor_agent_id: agent.id,
          cursor_agent_title: agent.title || null,
          cursor_workspace_key: agent.workspace_key || null,
          cursor_native_status: runtime.nativeStatus,
          cursor_native_working: runtime.nativeWorking,
          cursor_active_thread_key: agent.id,
          cursor_message_observation_seq: observationSequence,
          accumulated_messages: initialMessages,
          cursor_agent_histories: runtime._cursorAgentHistories,
          activity,
          status: 'healthy',
        });
        if (initialMessages.length > 0) {
          this._sendHistorySnapshot(runtime.session_id, initialMessages, 'Cursor per-agent discovery');
        }
        this._sendToRelay(proto.agentConfig(runtime.session_id, {
          agent_type: 'cursor',
          display_name: 'Cursor',
          workspace_name: runtime.workspace_name,
          capabilities: this._buildCapabilities('cursor', runtime.workspace_path),
        }));
        this._log('info', `[cursor] Registered native agent ${agent.id} as ${runtime.session_id} "${agent.title}" (${runtime.workspace_name})`);
        changed = true;
      } else {
        const nextWorkspaceName = workspaceMatch?.title || agent.workspace_name || runtime.workspace_name;
        const nextWorkspacePath = workspaceMatch?.path || runtime.workspace_path || null;
        const nextActivity = cursorNativeActivity(agent, runtime.activity);
        const nextNativeWorking = agent.native_working === true;
        const activityChanged = runtime.nativeStatus !== (agent.native_status || '')
          || runtime.nativeWorking !== nextNativeWorking
          || runtime.activity?.kind !== nextActivity.kind
          || runtime.activity?.label !== nextActivity.label;
        const metaChanged = runtime.chat_title !== agent.title
          || runtime.workspace_name !== nextWorkspaceName
          || runtime.workspace_path !== nextWorkspacePath
          || runtime.windowTitle !== agent.title;
        runtime.client = client;
        runtime.targetId = target.id;
        runtime._cdpPort = target._cdpPort;
        runtime._cdpHost = target._cdpHost || null;
        runtime._targetUrl = target.url || runtime._targetUrl || '';
        runtime.last_seen_at = new Date().toISOString();
        runtime._cursorNativeActive = agent.active === true;
        runtime.nativeWorking = nextNativeWorking;
        runtime.cursorWorkspaceKey = agent.workspace_key || runtime.cursorWorkspaceKey || null;
        runtime._lastThreadList = eligible.slice();
        runtime._lastThreadListSig = JSON.stringify(eligible.map(item => `${item.id}:${item.title}:${!!item.active}:${item.native_status || ''}`));
        if (metaChanged || activityChanged) {
          runtime.chat_title = agent.title || runtime.chat_title;
          if (agent.title) runtime.chat_title_source = 'native';
          runtime.windowTitle = agent.title || runtime.windowTitle;
          runtime.workspace_name = nextWorkspaceName;
          runtime.workspace_path = nextWorkspacePath;
          runtime.nativeStatus = agent.native_status || '';
          if (activityChanged) {
            runtime.activity = nextActivity;
            runtime.waitingForAssistant = nextActivity.kind === 'generating';
            this._sendToRelay(proto.proxyStatus(runtime.session_id, runtime.status || 'healthy', nextActivity));
          }
          sessionStore.updateSession(runtime.session_id, {
            target_id: target.id,
            cdp_port: target._cdpPort,
            window_title: runtime.windowTitle,
            workspace_name: runtime.workspace_name,
            workspace_path: runtime.workspace_path,
            chat_title: runtime.chat_title,
            chat_title_source: runtime.chat_title_source || null,
            cursor_agent_title: agent.title || null,
            cursor_workspace_key: agent.workspace_key || null,
            cursor_native_status: runtime.nativeStatus,
            cursor_native_working: runtime.nativeWorking,
            activity: runtime.activity,
            status: 'healthy',
          });
          changed = true;
        }
        if (!activityChanged) {
          runtime.activity = nextActivity;
          if (nextActivity.kind === 'generating' && nextActivity.cursor_evidence_source !== 'continuity_lease') {
            this._emitActivityObservationHeartbeat(runtime.session_id, runtime, {
              observedAt: nextActivity.cursor_evidence_at,
            });
          }
        }
      }
      runtimeByAgent.set(agent.id, runtime);
    }

    const priorOwner = Array.from(this.sessions.values()).find(session => (
      session._cursorVirtual
      && session.targetId === target.id
      && session._cursorPageOwner
      && runtimeByAgent.has(session.cursorAgentId)
    ));
    const deterministicOwnerId = Array.from(runtimeByAgent.keys()).sort()[0];
    const owner = priorOwner || runtimeByAgent.get(deterministicOwnerId);
    for (const session of this.sessions.values()) {
      if (!session._cursorVirtual || session.targetId !== target.id) continue;
      const nextOwner = session === owner;
      if (session._cursorPageOwner !== nextOwner) {
        session._cursorPageOwner = nextOwner;
        changed = true;
      }
    }

    const listedIds = new Set(allAgents.map(agent => String(agent?.id || '')));
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (!session._cursorVirtual || session.targetId !== target.id) continue;
      if (listedIds.has(String(session.cursorAgentId || '')) && eligibleIds.has(session.cursorAgentId)) continue;
      sessionStore.markDisconnected(sessionId);
      this.sessions.delete(sessionId);
      this.activePermissionPrompts.delete(sessionId);
      this.activeErrorPrompts.delete(sessionId);
      changed = true;
    }

    this._attachCursorTargetDisconnectHandler(client, target.id);
    if (changed) this._broadcastSessionSnapshot();
    return { count: runtimeByAgent.size, changed };
  }

  async _discoverCursorTarget(target) {
    const existing = Array.from(this.sessions.values()).find(session => (
      session._cursorVirtual && session.targetId === target.id && session.client
    ));
    let client = existing?.client || null;
    const ownsClient = !client;
    try {
      if (!client) {
        client = await this._connectCdpTarget(target, target._cdpPort, `cursor ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable cursor ${target.id.substring(0, 8)}`);
      }
      const agents = await this._withTimeout(
        this._readCursorAgentInventory(target.id, client.Runtime),
        3000,
        `Cursor agent inventory ${target.id.substring(0, 8)}`,
      );
      const result = await this._syncCursorVirtualSessions(target, client, agents);
      if (result.count === 0 && ownsClient) await this._safeClose(client);
      return result;
    } catch (error) {
      if (ownsClient) await this._safeClose(client);
      throw error;
    }
  }

  _readCursorAgentInventory(targetId, Runtime) {
    if (!this._cursorAgentInventoryReads) this._cursorAgentInventoryReads = new Map();
    const key = String(targetId || 'cursor-global');
    const existing = this._cursorAgentInventoryReads.get(key);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(() => require('./cursor-selectors').readCursorAgentList(Runtime))
      .finally(() => {
        if (this._cursorAgentInventoryReads.get(key) === pending) {
          this._cursorAgentInventoryReads.delete(key);
        }
      });
    this._cursorAgentInventoryReads.set(key, pending);
    return pending;
  }

  async _refreshCursorVirtualTargets() {
    const owners = Array.from(this.sessions.values()).filter(session => (
      session._cursorVirtual && session._cursorPageOwner && session.client
    ));
    for (const owner of owners) {
      const target = {
        id: owner.targetId,
        title: 'Cursor Agents',
        url: owner._targetUrl || '',
        _cdpPort: owner._cdpPort,
        _cdpHost: owner._cdpHost || null,
      };
      const agents = await this._withTimeout(
        this._readCursorAgentInventory(owner.targetId, owner.client.Runtime),
        2000,
        `Cursor virtual inventory ${owner.targetId.substring(0, 8)}`,
      );
      await this._syncCursorVirtualSessions(target, owner.client, agents);
    }
  }

  async _discoverTargets(allowedTargetIds = null) {
    let targets;
    let successfulCdpPorts;
    try {
      ({ targets, successfulCdpPorts } = await this._resolveCdpTargets());
    } catch (e) {
      const triedPorts = this.CDP_PORTS.join(', ');
      this._log('error', `[cdp] Cannot list targets on configured ports (${triedPorts}): ${e.message}`);
      return;
    }

    const DESKTOP_PORT_MAP = { 9224: 'claude-desktop', 9225: 'codex-desktop', 9227: 'cursor' };
    const looksLikeAntigravityV2Page = (t) => {
      const url = String(t.url || '');
      const title = String(t.title || '');
      if (t.type !== 'page') return false;
      if (DESKTOP_PORT_MAP[t._cdpPort]) return false;
      if (/\s-\s*Cursor\b/i.test(title)) return false;
      if (/\/c\/[0-9a-f-]{36}/i.test(url)) return true;
      if (/^https?:\/\/127\.0\.0\.1:\d+\/?(?:\?[^#]*)?(?:#.*)?$/i.test(url) && /^Antigravity$/i.test(title.trim())) return true;
      return false;
    };
    const looksLikeEditorWorkbenchPage = (t) => {
      const title = String(t.title || '');
      if (!isEditorWorkbenchPage(t)) return false;
      if (DESKTOP_PORT_MAP[t._cdpPort]) return false;
      if (looksLikeAntigravityV2Page(t)) return false;
      if (/\s-\s*Cursor\b/i.test(title)) return false;
      return true;
    };
    const iframes       = targets.filter(t => t.type === 'iframe');
    const workbenchPg   = targets.filter(looksLikeEditorWorkbenchPage);
    const antigravityPg = workbenchPg.filter(t => detectWorkbenchHost(t).type === 'antigravity_ide');
    const antigravityV2Pg = targets.filter(looksLikeAntigravityV2Page);
    const desktopPg     = targets.filter(t => {
      const agentType = DESKTOP_PORT_MAP[t._cdpPort];
      return !!agentType && isDesktopAppPage(t, agentType);
    });
    this._logDiscoverDeduped(
      'target-counts',
      `[discover] ${targets.length} targets — ${iframes.length} iframes, ${workbenchPg.length} editor-pages (${workbenchPg.filter(t => detectWorkbenchHost(t).type === 'vscode').length} VS Code, ${antigravityPg.length} Antigravity IDE), ${desktopPg.length} desktop-pages`
    );

    const storagePaths = [
      ...this._readAntigravityWindowPaths().map(w => ({ ...w, host_type: 'antigravity_ide' })),
      ...this._readVsCodeWindowPaths(),
    ];

    // Build vscodeWindowId → page target map.
    // Window ids are process-local, so map them with the owning CDP port.
    // Cache by page.id to avoid opening new CDP connections to workbench pages
    // on every discovery cycle — those connections can steal window focus.
    if (!this._windowIdCache) this._windowIdCache = new Map(); // pageId → winId
    const windowIdToPage = new Map();
    const winIdPages = workbenchPg.filter(t =>
      t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
    );
    for (const page of winIdPages) {
      // Use cached windowId if we already resolved this page target
      const cached = this._windowIdCache.get(page.id);
      if (cached) {
        windowIdToPage.set(workbenchWindowKey(page._cdpPort, cached), page);
        continue;
      }
      let pageClient;
      try {
        pageClient = await this._connectCdpTarget(page, page._cdpPort || this.CDP_PORTS[0], `workbench page ${page.id.substring(0, 8)}`);
        await this._withTimeout(pageClient.Runtime.enable(), 3000, `Runtime.enable workbench ${page.id.substring(0, 8)}`);
        const res = await this._withTimeout(pageClient.Runtime.evaluate({
          expression: '(typeof window.vscodeWindowId !== "undefined") ? String(window.vscodeWindowId) : null',
          returnByValue: true,
        }), 3000, `window id read ${page.id.substring(0, 8)}`);
        const winId = res.result?.value;
        if (winId) {
          windowIdToPage.set(workbenchWindowKey(page._cdpPort, winId), page);
          this._windowIdCache.set(page.id, winId);
        }
        await pageClient.close();
      } catch (e) {
        if (pageClient) try { await pageClient.close(); } catch {}
      }
    }
    // Prune cached windowIds for page targets that no longer exist
    const currentPageIds = new Set(winIdPages.map(p => p.id));
    for (const cachedPageId of this._windowIdCache.keys()) {
      if (!currentPageIds.has(cachedPageId)) this._windowIdCache.delete(cachedPageId);
    }
    if (windowIdToPage.size > 0) {
      const entries = Array.from(windowIdToPage.entries()).map(([id, p]) => `${id}→"${p.title.substring(0,40)}"`);
      this._logDiscoverDeduped('windowId-map', `[discover] windowId map: ${entries.join(', ')}`);
    }

    // Refresh workspace list
    if (!allowedTargetIds) {
      this.openWorkspaces = workbenchPg
        .map(p => {
          const host = detectWorkbenchHost(p);
          const title = this._workspaceTitleFromEditorWindowTitle(p.title)
            || this._stripEditorWindowTitleDecorations(p.title.replace(/ - Antigravity.*/, '').trim());
          if (!title || title.toLowerCase() === 'antigravity') return null;
          const match = storagePaths.find(w => w.host_type === host.type && w.title.toLowerCase() === title.toLowerCase());
          return { title, path: match ? match.path : null, host_type: host.type, host_label: host.label };
        })
        .filter(Boolean);

      let sessionMetaChanged = false;
      const openWithPaths = this.openWorkspaces.filter(w => w.path);
      for (const [sid, session] of this.sessions.entries()) {
        const nameBad = !session.workspace_name
          || /^window-\d+$/.test(session.workspace_name)
          || !!this._workspaceTitleFromEditorWindowTitle(session.workspace_name);

        // Use windowIdToPage to resolve the correct workspace from parentId
        const parentPageForSession = session.parentId
          ? windowIdToPage.get(workbenchWindowKey(session._cdpPort, session.parentId))
          : null;
        if (parentPageForSession) {
          const resolvedTitle = this._workspaceTitleFromEditorWindowTitle(parentPageForSession.title)
            || this._stripEditorWindowTitleDecorations(parentPageForSession.title.replace(/ - Antigravity.*/, '').trim());
          const parentHost = detectWorkbenchHost(parentPageForSession);
          const wsMatch = this.openWorkspaces.find(w =>
            w.path
            && w.host_type === parentHost.type
            && w.title.toLowerCase() === resolvedTitle.toLowerCase()
          );
          if (wsMatch) {
            // Correct workspace if it differs from what's stored
            const pathChanged = session.workspace_path !== wsMatch.path;
            const nameChanged = session.workspace_name !== wsMatch.title;
            if (pathChanged || nameChanged) {
              session.workspace_path = wsMatch.path;
              session.workspace_name = wsMatch.title;
              session.windowTitle = resolvedTitle;
              this._refreshSessionPreferenceKey(session);
              sessionStore.updateSession(sid, {
                workspace_path: wsMatch.path,
                workspace_name: wsMatch.title,
                window_title: resolvedTitle,
              });
              this._log('info', `[discover] Corrected workspace for ${sid}: "${wsMatch.title}" (${wsMatch.path})`);
              sessionMetaChanged = true;
            }
            continue;
          }
        }

        // Fallback: derive workspace_name from workspace_path if we have one
        if (session.workspace_path && nameBad) {
          const derived = session.workspace_path.split(/[/\\]/).filter(Boolean).pop() || session.workspace_path;
          session.workspace_name = derived;
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { workspace_name: derived });
          this._log('info', `[discover] Derived workspace name for ${sid}: "${derived}"`);
          sessionMetaChanged = true;
          continue;
        }
        if (session.workspace_path) continue;

        // No parentId match and no workspace_path — try title-based resolution
        const resolvedTitle = parentPageForSession
          ? (this._workspaceTitleFromEditorWindowTitle(parentPageForSession.title)
              || this._stripEditorWindowTitleDecorations(parentPageForSession.title.replace(/ - Antigravity.*/, '').trim()))
          : (this._workspaceTitleFromEditorWindowTitle(session.windowTitle) || session.windowTitle);
        const sessionOpenWithPaths = session.host_type
          ? openWithPaths.filter(w => w.host_type === session.host_type)
          : openWithPaths;
        const wsMatch = sessionOpenWithPaths.find(w => w.path && w.title.toLowerCase() === resolvedTitle?.toLowerCase())
          || (sessionOpenWithPaths.length === 1 ? sessionOpenWithPaths[0] : null);
        if (nameBad && resolvedTitle && resolvedTitle !== session.windowTitle) {
          session.windowTitle = resolvedTitle;
          session.workspace_name = resolvedTitle;
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { window_title: resolvedTitle, workspace_name: resolvedTitle });
          this._log('info', `[discover] Fixed window title for ${sid}: "${resolvedTitle}"`);
          sessionMetaChanged = true;
        }
        if (wsMatch) {
          session.workspace_path = wsMatch.path;
          session.workspace_name = wsMatch.title;
          this._refreshSessionPreferenceKey(session);
          sessionStore.updateSession(sid, { workspace_path: wsMatch.path, workspace_name: wsMatch.title });
          this._log('info', `[discover] Resolved workspace for ${sid}: ${wsMatch.path}`);
          sessionMetaChanged = true;
        }
      }
      if (sessionMetaChanged) {
        this._broadcastSessionSnapshot();
      }
    }

    // ── Process iframe targets ──────────────────────────────────────────
    for (const target of antigravityV2Pg) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;
      const routeConversationId = ((target.url || '').match(/\/c\/([0-9a-f-]{36})/i) || [])[1] || null;
      const existingForTarget = Array.from(this.sessions.values()).find(s => s.targetId === target.id && s.agentType === 'antigravity-v2');
      if (existingForTarget) {
        continue;
      }
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      this._log('info', `[discover] Probing Antigravity v2 page ${target.id.substring(0, 8)} (${target.title || target.url})`);
      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `antigravity v2 ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable antigravity v2 ${target.id.substring(0, 8)}`);
        const activeInfo = await this._withTimeout(selectors.readAntigravityV2ActiveConversation(client.Runtime), 3000, `antigravity v2 active ${target.id.substring(0, 8)}`);
        const conversationId = activeInfo?.conversation_id || routeConversationId || null;
        let initialChatList = [];
        try {
          initialChatList = await this._withTimeout(selectors.readAntigravityV2ChatList(client.Runtime), 3000, `antigravity v2 chat list ${target.id.substring(0, 8)}`);
        } catch (e) {
          this._log('warn', `[discover] initial Antigravity v2 chat list failed for target ${target.id.substring(0, 8)}: ${e.message}`);
        }
        const activeChat = Array.isArray(initialChatList)
          ? initialChatList.find(c => c && c.kind === 'chat' && ((conversationId && c.id === conversationId) || c.active))
          : null;
        const displayName = conversationId
          ? (activeChat?.title || activeInfo?.title || target.title || 'Antigravity v2')
          : 'Agent Manager';
        const workspaceName = activeChat?.project || (conversationId ? 'Antigravity v2' : 'Agent Manager');
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: displayName,
          agentType: 'antigravity-v2',
          workspaceName,
          workspacePath: null,
          // Agent Manager owns one logical surface per CDP port. The target ID
          // changes on a full app restart, so including it forks the durable
          // relay/sidebar identity instead of reconnecting the existing session.
          sigOverride: `antigravity-v2::app::${target._cdpPort || 9226}`,
        });
        const sessionId = sessionMeta.session_id;
        if (this.sessions.has(sessionId)) {
          await this._safeClose(client);
          continue;
        }
        const raw = await this._withTimeout(selectors.readMessages(client.Runtime, 'antigravity-v2', sessionId), 5000, `antigravity v2 initial read ${sessionId.substring(0, 8)}`);
        const initialMsgs = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;
        sessionStore.updateSession(sessionId, {
          window_title: displayName,
          workspace_name: workspaceName,
          chat_title: conversationId ? displayName : null,
          antigravity_v2_conversation_id: conversationId,
        });
        this.sessions.set(sessionId, {
          session_id: sessionId,
          display_name: sessionMeta.display_name,
          workspace_name: workspaceName,
          workspace_path: null,
          machine_label: sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount: initialCount,
          lastObservedCount: initialCount,
          lastTranscriptSig: this._transcriptSignature(initialMsgs),
          _accumulatedMessages: initialMsgs.slice(),
          nullPollCount: 0,
          pendingLast: null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking: false,
          thinkingLabel: '',
          autoApprovePermissions: false,
          status: 'healthy',
          activity: sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at: new Date().toISOString(),
          windowTitle: displayName,
          chat_title: conversationId ? displayName : null,
          agentType: 'antigravity-v2',
          targetId: target.id,
          _cdpPort: target._cdpPort,
          v2ConversationId: conversationId,
          v2SectionId: activeInfo?.section_id || null,
          _listView: !conversationId,
          _lastChatList: Array.isArray(initialChatList) ? initialChatList : [],
          _lastChatListSig: Array.isArray(initialChatList) ? JSON.stringify(initialChatList.map(c => `${c.kind || 'chat'}:${c.id || ''}:${c.title || ''}:${!!c.active}:${c.project || ''}`)) : '',
        });
        this._log('info', `[cdp] antigravity-v2 -> ${sessionId} "${displayName}" (${initialCount} msgs, conversation=${conversationId})`);
        if (raw && initialCount > 0) this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        if (Array.isArray(initialChatList) && initialChatList.length > 0) this._sendToRelay(proto.chatList(sessionId, initialChatList));
        const agentCaps = this._buildCapabilities('antigravity-v2');
        selectors.readAgentConfig(client.Runtime, 'antigravity-v2', null).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig('antigravity-v2', cfg, null));
          if (session) session._currentModelId = merged.model_id || null;
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        }).catch(() => {
          this._sendToRelay(proto.agentConfig(sessionId, { ...this._mergeAgentConfig('antigravity-v2', null, null), capabilities: agentCaps }));
        });
        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] Antigravity v2 CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });
        this._broadcastSessionSnapshot();
      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe Antigravity v2 ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    for (const target of iframes) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;

      const hostMatch   = target.url.match(/vscode-webview:\/\/([^/]+)/);
      const parentMatch = target.url.match(/parentId=(\w+)/);
      const extMatch    = target.url.match(/extensionId=([^&]+)/);
      const ext         = extMatch ? extMatch[1] : 'unknown';

      if (!hostMatch || !parentMatch) continue;

      const parentId = parentMatch[1];

      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      const isAgent = ext.toLowerCase().includes('anthropic') ||
                      ext.toLowerCase().includes('claude')    ||
                      ext.toLowerCase().includes('openai')    ||
                      ext.toLowerCase().includes('chatgpt')   ||
                      ext.toLowerCase().includes('googlecloud') ||
                      ext.toLowerCase().includes('gemini')    ||
                      ext.toLowerCase().includes('continue.continue') ||
                      ext.toLowerCase().includes('continue.continue-yolo') ||
                      ext.toLowerCase().includes('continue-yolo') ||
                      ext.toLowerCase().includes('roo') ||
                      ext.toLowerCase().includes('saoudrizwan.claude-dev') ||
                      ext.toLowerCase().includes('cline');
      if (!isAgent) continue;

      this._log('info', `[discover] Probing ${target.id.substring(0, 8)} ext=${ext}`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `iframe ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable iframe ${target.id.substring(0, 8)}`);
        client.Runtime._webviewId = (target.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || null;

        // Cache inner-frame context ID to avoid active-frame traversal
        // which causes focus/scroll steal in iframe-backed editor webviews
        if (ext.toLowerCase().includes('continue.continue') || ext.toLowerCase().includes('continue-yolo') || ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) {
          const focusTag = (ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) ? 'claude-focus' : 'continue-focus';
          this._log('info', `[discover] [${focusTag}] initial context cache:start target=${target.id}`);
        }
        await this._withTimeout(selectors.cacheInnerContextId(client.Runtime), 3000, `context cache ${target.id.substring(0, 8)}`);
        if (ext.toLowerCase().includes('continue.continue') || ext.toLowerCase().includes('continue-yolo') || ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) {
          const focusTag = (ext.toLowerCase().includes('anthropic') || ext.toLowerCase().includes('claude')) ? 'claude-focus' : 'continue-focus';
          this._log('info', `[discover] [${focusTag}] initial context cache:end target=${target.id} resolved=${client.Runtime?._innerContextId || 'null'}`);
        }

        const agentType = await this._withTimeout(selectors.detectAgentType(client.Runtime, ext), 3000, `agent detect ${target.id.substring(0, 8)}`);
        if (!agentType) {
          this._log('info', `[discover] ${target.id.substring(0, 8)}: detectAgentType=null, skipping`);
          await this._safeClose(client);
          continue;
        }

        const parentPage   = windowIdToPage.get(workbenchWindowKey(target._cdpPort, parentId));
        const workbenchHost = detectWorkbenchHost(parentPage);
        const rawWindowTitle = parentPage ? parentPage.title : `window-${parentId}`;
        const workspaceTitle = this._workspaceTitleFromEditorWindowTitle(rawWindowTitle)
          || this._stripEditorWindowTitleDecorations(rawWindowTitle.replace(/ - Antigravity.*/, '').trim());
        const windowTitle = rawWindowTitle;

        // Match workspace by title; only use single-workspace fallback when
        // parentId couldn't be resolved (window-N placeholder), to avoid
        // mis-attributing sessions from other Antigravity windows.
        const hasParentPage = !!parentPage;
        const openWithPaths  = this.openWorkspaces.filter(w => w.path);
        const hostStoragePaths = storagePaths.filter(w => w.host_type === workbenchHost.type);
        const workspaceMatch = hostStoragePaths.find(w => w.title.toLowerCase() === workspaceTitle.toLowerCase())
          || hostStoragePaths.find(w => w.title.toLowerCase() === windowTitle.toLowerCase())
          || (!hasParentPage && openWithPaths.length === 1 ? openWithPaths[0] : null)
          || (!hasParentPage && hostStoragePaths.length === 1 ? hostStoragePaths[0] : null);
        const workspacePath  = workspaceMatch ? workspaceMatch.path : null;

        const sessionMeta = sessionStore.resolveSession({
          target,
          windowTitle,
          agentType,
          workspaceName: workspaceMatch?.title || workspaceTitle || windowTitle,
          workspacePath,
          hostType: workbenchHost.type,
          hostLabel: workbenchHost.label,
        });
        const { enabled: autoApprovePermissions, preferenceKey } = this._resolveAutoApproveState(agentType, sessionMeta, {
          workspacePath,
          workspaceName: workspaceMatch?.title || workspaceTitle || windowTitle,
          windowTitle,
        });
        const sessionId = sessionMeta.session_id;

        const currentTargetIds = new Set(targets.map(t => t.id));
        const existingSession = this.sessions.get(sessionId);
        const activeTargetState = classifyActiveSessionTarget(existingSession, target, currentTargetIds);
        if (activeTargetState === 'replace_stale_target') {
          this._log('info', `[discover] Rebinding session ${sessionId} from stale target ${existingSession.targetId?.substring(0, 8)} to ${target.id?.substring(0, 8)}`);
          await this._safeClose(existingSession.client);
          this.sessions.delete(sessionId);
          this.activePermissionPrompts.delete(sessionId);
          this.activeErrorPrompts.delete(sessionId);
        } else if (activeTargetState !== 'new') {
          this._log('info', `[discover] Session ${sessionId} already active, skipping ${activeTargetState === 'same_target' ? 'same' : 'duplicate'} target`);
          await this._safeClose(client);
          continue;
        }

        for (const [staleSid, staleSession] of this.sessions.entries()) {
          if (staleSession.agentType === agentType &&
              staleSession._cdpPort === target._cdpPort &&
              staleSession.parentId === parentId &&
              !currentTargetIds.has(staleSession.targetId)) {
            this._log('info', `[discover] Evicting stale session ${staleSid} — target ${staleSession.targetId?.substring(0,8)} no longer in CDP list`);
            sessionStore.markDisconnected(staleSid);
            await this._safeClose(staleSession.client);
            this.sessions.delete(staleSid);
            this.activePermissionPrompts.delete(staleSid);
            this.activeErrorPrompts.delete(staleSid);
          }
        }

        const raw          = await this._withTimeout(selectors.readMessages(client.Runtime, agentType, sessionId), 5000, `initial read ${sessionId.substring(0, 8)}`);
        const domMsgs      = raw ? JSON.parse(raw) : [];
        const isAccumAccum = this._isTranscriptAccumulating(agentType);
        let initialListView = false;
        let initialChatList = null;
        if (agentType === 'codex') {
          try {
            initialChatList = await this._withTimeout(
              selectors.readCodexChatList(client.Runtime, false),
              3000,
              `initial codex chat list ${sessionId.substring(0, 8)}`
            );
            const hasChats = Array.isArray(initialChatList) && initialChatList.length > 0;
            const hasActiveChat = hasChats && initialChatList.some(c => c && c.active);
            initialListView = hasChats && !hasActiveChat;
          } catch (e) {
            this._log('warn', `[discover] initial readCodexChatList failed for ${sessionId}: ${e.message}`);
          }
        }
        let initialThreadList = null;
        let initialActiveThread = null;
        let initialActiveThreadKey = '';
        if (agentType === 'codex-desktop') {
          try {
            initialThreadList = await this._withTimeout(
              selectors.readCodexThreadList(client.Runtime, true),
              3000,
              `initial codex desktop thread list ${sessionId.substring(0, 8)}`
            );
            initialActiveThread = Array.isArray(initialThreadList) ? initialThreadList.find(t => t && t.active) : null;
            initialActiveThreadKey = initialActiveThread ? `${initialActiveThread.id || ''}:${initialActiveThread.title || ''}` : '';
            if (Array.isArray(initialThreadList) && initialThreadList.length > 0) {
              this._sendToRelay(proto.threadList(sessionId, initialThreadList));
              if (!initialActiveThread && domMsgs.length === 0) {
                initialListView = true;
              }
            }
          } catch (e) {
            this._log('warn', `[discover] initial codex desktop thread list failed for ${sessionId}: ${e.message}`);
          }
        }
        const storedCursorAgentHistories = agentType === 'cursor'
          && sessionMeta.cursor_agent_histories
          && typeof sessionMeta.cursor_agent_histories === 'object'
          ? sessionMeta.cursor_agent_histories
          : {};
        const storedCursorThreadKey = agentType === 'cursor' ? String(sessionMeta.cursor_active_thread_key || '') : '';
        const storedCodexChatKey = agentType === 'codex' ? String(sessionMeta.codex_active_chat_key || '') : '';
        const storedCodexChatTitle = agentType === 'codex' ? String(sessionMeta.codex_active_chat_title || '') : '';
        let storedAccumulated = Array.isArray(sessionMeta.accumulated_messages) ? sessionMeta.accumulated_messages : null;
        if (agentType === 'cursor' && storedCursorThreadKey && Array.isArray(storedCursorAgentHistories[storedCursorThreadKey])) {
          storedAccumulated = storedCursorAgentHistories[storedCursorThreadKey];
        }
        if (agentType === 'codex-desktop') {
          const storedThreadKey = sessionMeta.codex_desktop_active_thread_key || '';
          if (storedAccumulated && storedThreadKey && initialActiveThreadKey && storedThreadKey !== initialActiveThreadKey) {
            this._log('info', `[discover] Codex Desktop active thread changed since last persist; dropping stale accumulated history for ${sessionId}`);
            storedAccumulated = null;
            sessionStore.updateSession(sessionId, {
              accumulated_messages: null,
              codex_desktop_active_thread_key: initialActiveThreadKey,
              codex_desktop_active_thread_title: initialActiveThread?.title || null,
            });
          } else if (initialActiveThreadKey) {
            sessionStore.updateSession(sessionId, {
              codex_desktop_active_thread_key: initialActiveThreadKey,
              codex_desktop_active_thread_title: initialActiveThread?.title || null,
            });
          }
        }
        let useStoredAccumulated = false;
        if (isAccumAccum && storedAccumulated && domMsgs.length > 0) {
          const windowOffset = this._transcriptWindowOffset(storedAccumulated, domMsgs);
          const requiresTailMatch = agentType === 'codex' || agentType === 'codex-desktop';
          useStoredAccumulated = agentType === 'cursor'
            ? this._cursorTranscriptWindowMatches(storedAccumulated, domMsgs)
            : requiresTailMatch
              ? (windowOffset >= 0 && windowOffset + domMsgs.length === storedAccumulated.length)
              : windowOffset >= 0;
          if (
            !useStoredAccumulated &&
            (
              agentType === 'codex-desktop' ||
              (agentType === 'codex' && domMsgs.length <= 8)
            )
          ) {
            const completionMerge = this._mergeCodexCompletionCollapse(storedAccumulated, domMsgs);
            if (completionMerge.matched) {
              storedAccumulated = completionMerge.messages;
              useStoredAccumulated = true;
              if (completionMerge.changed) {
                sessionStore.updateSession(sessionId, { accumulated_messages: storedAccumulated });
              }
            }
          }
        }
        const initialMsgs  = initialListView
          ? []
          : (useStoredAccumulated ? storedAccumulated : domMsgs);
        const initialCount = initialMsgs.length;

        const innerClaudeTitle = agentType === 'claude'
          ? await this._withTimeout(
              selectors.readClaudeSessionTitle(client.Runtime),
              1500,
              `initial claude title ${sessionId.substring(0, 8)}`
            ).catch(() => null)
          : null;
        const initialActiveChat = Array.isArray(initialChatList) ? initialChatList.find(c => c && c.active) : null;
        const initialTitle = selectDurableChatTitleDetails({
          nativeTitle: [innerClaudeTitle, initialActiveChat?.title, storedCodexChatTitle],
          storedTitle: sessionMeta.chat_title,
          storedSource: sessionMeta.chat_title_source,
          messages: initialMsgs,
        });
        const chatTitle = initialTitle.title;
        const chatTitleSource = initialTitle.source;
        if (chatTitle && (chatTitle !== sessionMeta.chat_title || chatTitleSource !== sessionMeta.chat_title_source)) {
          sessionStore.updateSession(sessionId, {
            chat_title: chatTitle,
            chat_title_source: chatTitleSource,
          });
        }
        const initialActiveChatKey = initialActiveChat ? `${initialActiveChat.id || ''}:${initialActiveChat.title || ''}` : '';

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   workspaceMatch?.title || sessionMeta.workspace_name,
          workspace_path:   workspacePath || sessionMeta.workspace_path,
          host_type:        sessionMeta.host_type || workbenchHost.type,
          host_label:       sessionMeta.host_label || workbenchHost.label,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          chat_title:       chatTitle,
          chat_title_source: chatTitleSource,
          client,
          lastMessageCount: initialCount,
          lastObservedCount: initialCount,
          lastTranscriptSig: this._transcriptSignature(initialMsgs),
          _accumulatedMessages: isAccumAccum ? initialMsgs.slice() : null,
          _cursorAgentHistories: agentType === 'cursor' ? { ...storedCursorAgentHistories } : null,
          nullPollCount:    0,
          pendingLast:      null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:         false,
          thinkingLabel:    '',
          autoApprovePermissions,
          preferenceKey,
          status:           'healthy',
          activity:         sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:     new Date().toISOString(),
          windowTitle,
          agentType,
          parentId,
          ext,
          targetId:         target.id,
          _cdpPort:         target._cdpPort,
          _webviewId:       (target.url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || null,
          _iframeInnerContextId: (agentType === 'codex' || this._isEphemeralIframeAgent(agentType))
            ? (client.Runtime?._innerContextId || null)
            : null,
          _continueInnerContextId: (agentType === 'continue' || agentType === 'continue_yolo') ? (client.Runtime?._innerContextId || null) : null,
          _listView:        initialListView,
          _lastChatListSig: initialChatList ? JSON.stringify(initialChatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`)) : '',
          _lastChatList:    initialChatList ? initialChatList.slice() : [],
          _activeChatTitle: initialActiveChat?.title || storedCodexChatTitle || null,
          _lastThreadListSig: initialThreadList ? JSON.stringify(initialThreadList.map(t => `${t.id || ''}:${t.title || ''}:${!!t.active}:${t.age || ''}`)) : '',
          _lastThreadList: initialThreadList ? initialThreadList.slice() : [],
          _activeChatKey:   initialActiveChatKey || storedCodexChatKey,
          _activeThreadTitle: initialActiveThread?.title || null,
          _activeThreadKey:   initialActiveThreadKey || storedCursorThreadKey,
          codexDesktopActiveThreadKey: initialActiveThreadKey,
        });

        if (agentType === 'codex') {
          try {
            await this._withTimeout(
              this._refreshWorkbenchPaneMeta(this.sessions.get(sessionId)),
              3000,
              `initial workbench pane meta ${sessionId.substring(0, 8)}`
            );
          } catch {}
        }
        if (agentType === 'continue') {
          try {
            const continueSession = this.sessions.get(sessionId);
            const continueChatList = await this._withTimeout(
              this._withWorkbenchClient(continueSession, wbClient =>
                selectors.readContinueWorkbenchChatList(wbClient.Runtime, continueSession._webviewId)
              ),
              3000,
              `initial continue chat list ${sessionId.substring(0, 8)}`
            );
            if (Array.isArray(continueChatList) && continueChatList.length > 0) {
              continueSession._lastChatListSig = JSON.stringify(continueChatList.map(c => `${c.id || ''}:${c.title || ''}:${!!c.active}`));
              const activeChat = continueChatList.find(c => c && c.active);
              if (activeChat?.title) {
                this._promoteSessionChatTitle(sessionId, continueSession, initialMsgs, activeChat.title);
              }
              initialChatList = continueChatList;
            }
          } catch (e) {
            this._log('warn', `[discover] initial Continue chat list failed for ${sessionId}: ${e.message}`);
          }
        }

        // Continue uses ephemeral connections — drop the persistent client.
        // Claude keeps its persistent client (focus-stealing was caused by
        // active-frame access, now fixed via cached contextId + passive watcher).
        if (agentType === 'continue' || agentType === 'continue_yolo') {
          await this._safeClose(client);
          client = null;
          const ephemeralSession = this.sessions.get(sessionId);
          if (ephemeralSession) ephemeralSession.client = null;
        }

        this._log('info', `[cdp] ${agentType} → ${sessionId} in "${windowTitle}" (${initialCount} existing msgs)`);

        const shouldSendInitialHistory = raw && initialCount > 0 && (
          !isAccumAccum ||
          useStoredAccumulated ||
          sessionMeta._matched_existing === false ||
          agentType === 'claude' ||
          agentType === 'codex' ||
          agentType === 'codex-desktop'
        );
        if (shouldSendInitialHistory) {
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        } else if (initialListView && (agentType === 'codex' || agentType === 'codex-desktop')) {
          this._sendHistorySnapshot(sessionId, [], `${agentType} initial list view clear`);
        }
        if (initialChatList) {
          this._sendToRelay(proto.chatList(sessionId, initialChatList));
        }

        const resolvedPath = workspacePath || sessionMeta.workspace_path;
        const agentCaps = this._buildCapabilities(agentType, resolvedPath);

        if (agentType === 'codex') {
          selectors.readCodexRateLimit(client.Runtime).then(rl => {
            const session = this.sessions.get(sessionId);
            if (!session) return;
            const nowActive = rl?.rate_limited === true;
            const untilText = rl?.until_text || null;
            session.rateLimitActive    = nowActive;
            session.rate_limited_until = nowActive ? (untilText || 'unknown') : null;
            if (nowActive) {
              this._log('info', `[${sessionId}] [rate-limit] Initial detection: ${untilText || 'no reset time'}`);
              this._sendToRelay(proto.rateLimitActive(sessionId, untilText, null, true));
              this._broadcastSessionSnapshot();
            }
          }).catch(() => {});
        }

        this._readSessionConfig(this.sessions.get(sessionId), resolvedPath).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, cfg, resolvedPath));
          if (session) session._currentModelId = merged.model_id || null;
          this._log('info', `[init-cfg] ${sessionId} (${agentType}): ${JSON.stringify(this._configLogSummary(merged, agentCaps))}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
          if (session && merged.file_access_scope && merged.file_access_scope !== 'unknown') {
            const scopePath = merged.file_access_scope;
            const scopeName = scopePath.split(/[/\\]/).filter(Boolean).pop() || scopePath;
            if (!session.workspace_path || /^window-\d+$/.test(session.workspace_name)) {
              session.workspace_path = scopePath;
              session.workspace_name = scopeName;
              this._refreshSessionPreferenceKey(session);
              sessionStore.updateSession(sessionId, { workspace_path: scopePath, workspace_name: scopeName });
              this._log('info', `[init-cfg] ${sessionId}: backfilled workspace_name="${scopeName}" from file_access_scope`);
              this._broadcastSessionSnapshot();
            }
          }
        }).catch(err => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, null, resolvedPath));
          if (session) session._currentModelId = merged.model_id || null;
          this._log('info', `[init-cfg] ${sessionId} (${agentType}) fallback (${err?.message}): ${JSON.stringify(this._configLogSummary(merged, agentCaps))}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        });

        if (client) {
          client.on('disconnect', () => {
            this._log('info', `[${sessionId}] CDP disconnected`);
            sessionStore.markDisconnected(sessionId);
            this.sessions.delete(sessionId);
            this.activePermissionPrompts.delete(sessionId);
            this.activeErrorPrompts.delete(sessionId);
            this._broadcastSessionSnapshot();
          });
        }

        this._broadcastSessionSnapshot();

      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Antigravity native Agent Manager pages ──────────────────────────
    const managerPages = antigravityPg.filter(t =>
      t.url && t.url.includes('workbench-jetski-agent') &&
      t.title && !['Settings', 'Launchpad'].includes(t.title)
    );

    for (const target of managerPages) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      this._log('info', `[discover] Probing Antigravity Manager page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `manager ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable manager ${target.id.substring(0, 8)}`);

        const convoTitle = await this._withTimeout(
          selectors.readAntigravitySessionTitle(client.Runtime),
          3000,
          `manager title ${target.id.substring(0, 8)}`
        );
        const displayName = convoTitle || target.title || 'Antigravity Agent';

        const sigSource = `${target.url}::${target.title}`;
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: displayName,
          agentType: 'antigravity',
          workspaceName: displayName,
          workspacePath: null,
          sigOverride: sigSource,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] Antigravity session ${sessionId} already active, skipping`);
          await this._safeClose(client);
          continue;
        }

        const raw          = await this._withTimeout(
          selectors.readMessages(client.Runtime, 'antigravity', sessionId),
          5000,
          `manager initial read ${sessionId.substring(0, 8)}`
        );
        const initialMsgs  = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   displayName,
          workspace_path:   null,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:     initialCount,
          lastObservedCount:    initialCount,
          lastTranscriptSig:    this._transcriptSignature(initialMsgs),
          nullPollCount:        0,
          pendingLast:          null,
          resyncCandidateSig:   null,
          waitingForAssistant:  false,
          thinking:             false,
          thinkingLabel:        '',
          autoApprovePermissions: sessionMeta.auto_approve_permissions === true,
          status:               'healthy',
          activity:             sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:         new Date().toISOString(),
          windowTitle:          displayName,
          agentType:            'antigravity',
          targetId:             target.id,
        });

        this._log('info', `[cdp] antigravity → ${sessionId} "${displayName}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }

        const agentCaps = this._buildCapabilities('antigravity');
        selectors.readAgentConfig(client.Runtime, 'antigravity', null).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig('antigravity', cfg, null));
          if (session) session._currentModelId = merged.model_id || null;
          this._log('info', `[init-cfg] ${sessionId} (antigravity): ${JSON.stringify(this._configLogSummary(merged, agentCaps))}`);
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        }).catch(() => {});

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] Antigravity Manager CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe Antigravity Manager ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Antigravity side-panel sessions ─────────────────────────────────
    const workspacePages = antigravityPg.filter(t =>
      t.url && t.url.includes('workbench.html') && t.title && t.title.includes('Antigravity')
    );
    this._logDiscoverDeduped(
      'side-panel-check',
      `[discover] Checking ${workspacePages.length} workspace page(s) for Antigravity side-panel`
    );
    // Optional panel-discovery file log (off by default). Debounced + signature-gated to avoid GB-scale logs.
    if (process.env.PANEL_DISCOVERY_LOG === '1') {
      const targetSig = Array.from(this.sessions.values())
        .map(s => `${s.targetId?.substring(0, 8)}(${s.agentType})`)
        .sort()
        .join(',');
      const sig = `${workspacePages.length}|${this.sessions.size}|${targetSig}`;
      const now = Date.now();
      if (!this._panelDiscoveryLogState) this._panelDiscoveryLogState = { lastSig: '', lastAt: 0 };
      const elapsed = now - this._panelDiscoveryLogState.lastAt;
      if (sig !== this._panelDiscoveryLogState.lastSig || elapsed >= 60000) {
        try {
          appendBoundedFileSync(
            path.join(__dirname, 'panel-discovery.log'),
            `${new Date().toISOString()} Checking ${workspacePages.length} pages, sessions=${this.sessions.size}, sessionTargetIds=[${targetSig}]\n`
          );
        } catch {}
        this._panelDiscoveryLogState = { lastSig: sig, lastAt: now };
      }
    }

    for (const target of workspacePages) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) {
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} skipped: not in allowedTargetIds`);
        continue;
      }
      if (this._isCdpTargetCooling(target.id)) continue;
      const existingSession = Array.from(this.sessions.values()).find(s => s.targetId === target.id);
      if (existingSession) {
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} skipped: targetId owned by session ${existingSession.session_id.substring(0,8)} (${existingSession.agentType})`);
        continue;
      }

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort || this.CDP_PORTS[0], `antigravity panel ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable antigravity panel ${target.id.substring(0, 8)}`);

        const hasContent = await this._withTimeout(
          selectors.detectAntigravityPanelHasContent(client.Runtime),
          3000,
          `antigravity panel content ${target.id.substring(0, 8)}`
        );
        this._log('info', `[discover] Side-panel ${target.id.substring(0,8)} "${target.title.substring(0,40)}" hasContent=${hasContent}`);
        // Register the panel even when empty so it shows in the web UI immediately.
        // The user can start typing and the session will persist.

        const workspaceName = this._workspaceTitleFromEditorWindowTitle(target.title)
          || this._stripEditorWindowTitleDecorations((target.title || '').replace(/ - Antigravity.*/, '').trim())
          || target.title;
        const panelSummary  = await this._withTimeout(
          selectors.readAntigravityPanelSummary(client.Runtime),
          3000,
          `antigravity panel summary ${target.id.substring(0, 8)}`
        );
        const panelTitle    = panelSummary?.title || await this._withTimeout(
          selectors.readAntigravityPanelTitle(client.Runtime),
          3000,
          `antigravity panel title ${target.id.substring(0, 8)}`
        );
        const displayName   = panelTitle ? `${workspaceName} / ${panelTitle}` : workspaceName;

        this._log('info', `[discover] Probing Antigravity side-panel in "${workspaceName}" (${target.id.substring(0, 8)})`);

        const sigSource  = `${target.url}::panel::${workspaceName}`;
        // Resolve workspace path from open workspaces list
        const panelWsMatch = this.openWorkspaces.find(w =>
          w.path && w.title && w.title.toLowerCase() === workspaceName.toLowerCase()
        );
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: displayName,
          agentType: 'antigravity_panel',
          workspaceName: displayName,
          workspacePath: panelWsMatch?.path || null,
          sigOverride: sigSource,
        });
        const { enabled: autoApprovePermissions, preferenceKey } = this._resolveAutoApproveState('antigravity_panel', sessionMeta, {
          workspacePath: panelWsMatch?.path || null,
          workspaceName,
          windowTitle: displayName,
        });
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          await this._safeClose(client);
          continue;
        }

        const raw          = await this._withTimeout(
          selectors.readMessages(client.Runtime, 'antigravity_panel', sessionId),
          5000,
          `antigravity panel initial read ${sessionId.substring(0, 8)}`
        );
        const initialMsgs  = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     displayName,
          workspace_name:   workspaceName,
          workspace_path:   panelWsMatch?.path || null,
          panel_title:      panelTitle || null,
          panel_mode:       panelSummary?.mode || null,
          panel_model:      panelSummary?.model || null,
          panel_agent:      panelSummary?.pane_agent || null,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:  effectiveInitialCount,
          lastObservedCount: effectiveInitialCount,
          lastTranscriptSig: this._transcriptSignature(initialAccumulated),
          nullPollCount:     0,
          pendingLast:       null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:          false,
          thinkingLabel:     '',
          autoApprovePermissions,
          preferenceKey,
          status:            'healthy',
          activity:          sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:      new Date().toISOString(),
          windowTitle:       displayName,
          agentType:         'antigravity_panel',
          parentId:          null,
          ext:               null,
          targetId:          target.id,
        });

        this._log('info', `[cdp] antigravity_panel → ${sessionId} "${displayName}" (${initialCount} msgs)`);

        if (raw && initialCount > 0) {
          this._sendHistorySnapshot(sessionId, initialMsgs, 'initial discovery');
        }

        const agentCaps = this._buildCapabilities('antigravity_panel');
        this._sendToRelay(proto.agentConfig(sessionId, {
          agent_type: 'antigravity_panel',
          display_name: displayName,
          workspace_name: workspaceName,
          capabilities: agentCaps,
        }));

        client.on('disconnect', () => {
          this._log('info', `[${sessionId}] Antigravity side-panel CDP disconnected`);
          sessionStore.markDisconnected(sessionId);
          this.sessions.delete(sessionId);
          this._broadcastSessionSnapshot();
        });

        this._broadcastSessionSnapshot();

      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe Antigravity side-panel ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Desktop app sessions ────────────────────────────────────────────
    for (const target of desktopPg) {
      if (allowedTargetIds && !allowedTargetIds.has(target.id)) continue;
      if (this._isCdpTargetCooling(target.id)) continue;
      const agentType = DESKTOP_PORT_MAP[target._cdpPort];
      if (agentType === 'cursor') {
        try {
          const result = await this._discoverCursorTarget(target);
          this._logDiscoverDeduped(
            `cursor-virtual-${target.id}`,
            `[discover] Cursor target ${target.id.substring(0, 8)} exposes ${result.count} durable agent session(s)`,
          );
        } catch (e) {
          if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
          this._log('error', `[cdp] Failed to discover Cursor agents on ${target.id.substring(0, 8)}: ${e.message}`);
        }
        continue;
      }
      if (Array.from(this.sessions.values()).some(s => s.targetId === target.id)) continue;

      this._log('info', `[discover] Probing ${agentType} page ${target.id.substring(0, 8)} (${target.title})`);

      let client;
      try {
        client = await this._connectCdpTarget(target, target._cdpPort, `${agentType} ${target.id.substring(0, 8)} connect`);
        await this._withTimeout(client.Runtime.enable(), 3000, `Runtime.enable ${agentType} ${target.id.substring(0, 8)}`);

        if (agentType === 'cursor') {
          const cursorTitle = String(target.title || '').trim();
          const stableCursorTitle = cursorTitle === 'Cursor Agents'
            || /\s-\s.*Cursor(?:\s|\[|$)/i.test(cursorTitle);
          if (!stableCursorTitle || /^vscode-file:/i.test(cursorTitle) || cursorTitle === target.url) {
            this._log('info', `[discover] Cursor target ${target.id.substring(0, 8)} title not settled; deferring registration`);
            await this._safeClose(client);
            continue;
          }
        }

        const cursorPaths = agentType === 'cursor' ? this._readCursorWindowPaths() : [];
        const wsTitle = this._workspaceTitleFromEditorWindowTitle(target.title)
          || this._stripEditorWindowTitleDecorations((target.title || '').replace(/\s-\s*Cursor.*$/i, '').trim());
        const wsTitleLower = (wsTitle || '').toLowerCase();
        const workspaceMatch = agentType === 'cursor'
          ? cursorPaths.find(w => {
            const wt = (w.title || '').toLowerCase();
            const wp = (w.path || '').toLowerCase();
            return wt === wsTitleLower
              || (wsTitleLower && (wp.endsWith('\\' + wsTitleLower) || wp.endsWith('/' + wsTitleLower)));
          })
          : null;
        // Cursor workbench target IDs change after a full app restart. Workspace
        // paths keep separate windows distinct while remaining stable across
        // that restart; the pathless Agents surface falls back to its stable name.
        const sigSource = agentType === 'cursor'
          ? sessionStore.buildCursorStableSignatureSource({
            workspacePath: workspaceMatch?.path || null,
            workspaceName: workspaceMatch?.title || wsTitle || target.title || agentType,
            windowTitle: target.title || agentType,
          })
          : `${agentType}::${target.url}`;
        const sessionMeta = sessionStore.resolveSession({
          target: { ...target, id: target.id },
          windowTitle: target.title || agentType,
          agentType,
          workspaceName: workspaceMatch?.title || wsTitle || target.title || agentType,
          workspacePath: workspaceMatch?.path || null,
          sigOverride: sigSource,
        });
        const autoApproveCtx = {
          workspacePath: workspaceMatch?.path || null,
          workspaceName: workspaceMatch?.title || wsTitle || target.title || agentType,
          windowTitle: target.title || agentType,
        };
        const { enabled: autoApprovePermissions, preferenceKey } = agentType === 'cursor'
          ? this._resolveAutoApproveState('cursor', sessionMeta, autoApproveCtx)
          : { enabled: sessionMeta.auto_approve_permissions === true, preferenceKey: null };
        const sessionId = sessionMeta.session_id;

        if (this.sessions.has(sessionId)) {
          this._log('info', `[discover] ${agentType} session ${sessionId} already active, skipping`);
          await this._safeClose(client);
          continue;
        }

        const raw         = await this._withTimeout(
          selectors.readMessages(
            client.Runtime,
            agentType,
            sessionId,
            agentType === 'codex-desktop' ? { maxRecentTurns: 24, maxRecentUnits: 96 } : {},
          ),
          5000,
          `${agentType} initial read ${sessionId.substring(0, 8)}`
        ).catch(() => null);
        const initialMsgs = raw ? JSON.parse(raw) : [];
        const initialCount = initialMsgs.length;

        let initialThreadList = null;
        if (agentType === 'cursor') {
          try {
            initialThreadList = await this._withTimeout(
              require('./cursor-selectors').readCursorAgentList(client.Runtime),
              3000,
              `initial cursor agent list ${sessionId.substring(0, 8)}`
            );
            if (Array.isArray(initialThreadList) && initialThreadList.length > 0) {
              this._sendToRelay(proto.threadList(sessionId, initialThreadList));
            }
          } catch (e) {
            this._log('warn', `[discover] initial cursor agent list failed for ${sessionId}: ${e.message}`);
          }
        } else if (agentType === 'codex-desktop') {
          try {
            initialThreadList = await this._withTimeout(
              selectors.readCodexThreadList(client.Runtime, true),
              3000,
              `initial codex desktop thread list ${sessionId.substring(0, 8)}`
            );
            if (Array.isArray(initialThreadList) && initialThreadList.length > 0) {
              this._sendToRelay(proto.threadList(sessionId, initialThreadList));
            }
          } catch (e) {
            this._log('warn', `[discover] initial Codex Desktop thread list failed for ${sessionId}: ${e.message}`);
          }
        }

        const initialCursorActiveThread = agentType === 'cursor' && Array.isArray(initialThreadList)
          ? initialThreadList.find(thread => thread && thread.active)
          : null;
        const initialCursorActiveThreadKey = initialCursorActiveThread
          ? String(initialCursorActiveThread.cache_key || initialCursorActiveThread.id || initialCursorActiveThread.title || '')
          : '';
        const storedCursorAgentHistories = agentType === 'cursor'
          && sessionMeta.cursor_agent_histories
          && typeof sessionMeta.cursor_agent_histories === 'object'
          ? sessionMeta.cursor_agent_histories
          : {};
        const storedCursorThreadKey = agentType === 'cursor'
          ? String(sessionMeta.cursor_active_thread_key || '')
          : '';
        const effectiveCursorThreadKey = initialCursorActiveThreadKey || storedCursorThreadKey;
        const storedCursorAccumulated = effectiveCursorThreadKey
          && Array.isArray(storedCursorAgentHistories[effectiveCursorThreadKey])
          ? storedCursorAgentHistories[effectiveCursorThreadKey]
          : null;
        const restoreStoredCursorAccumulator = agentType === 'cursor'
          && !!storedCursorAccumulated
          && initialMsgs.length > 0
          && this._cursorTranscriptWindowMatches(storedCursorAccumulated, initialMsgs);

        const initialActiveThread = agentType === 'codex-desktop' && Array.isArray(initialThreadList)
          ? initialThreadList.find(thread => thread && thread.active)
          : null;
        const initialActiveThreadKey = initialActiveThread
          ? String(initialActiveThread.id || initialActiveThread.title || '')
          : '';
        const storedActiveThreadKey = String(sessionMeta.codex_desktop_active_thread_key || '');
        const storedAccumulated = agentType === 'codex-desktop' && Array.isArray(sessionMeta.accumulated_messages)
          ? sessionMeta.accumulated_messages
          : null;
        const storedContainsInitial = !!storedAccumulated
          && this._codexDesktopRestoreWindowMatches(storedAccumulated, initialMsgs);
        const restoreStoredAccumulator = agentType === 'codex-desktop'
          && shouldRestoreCodexDesktopAccumulator({
            storedMessages: storedAccumulated,
            initialMessages: initialMsgs,
            storedThreadKey: storedActiveThreadKey,
            currentThreadKey: initialActiveThreadKey,
            storedContainsInitial,
          });
        const initialAccumulated = restoreStoredCursorAccumulator
          ? storedCursorAccumulated.slice()
          : restoreStoredAccumulator
            ? storedAccumulated.slice()
            : initialMsgs.slice();
        const effectiveInitialCount = initialAccumulated.length;
        const initialCursorAgentHistories = agentType === 'cursor'
          ? { ...storedCursorAgentHistories }
          : null;
        if (initialCursorAgentHistories && effectiveCursorThreadKey) {
          initialCursorAgentHistories[effectiveCursorThreadKey] = initialAccumulated.slice();
        }

        const initialDesktopTitle = selectDurableChatTitleDetails({
          nativeTitle: agentType === 'cursor'
            ? initialCursorActiveThread?.title
            : initialActiveThread?.title,
          storedTitle: sessionMeta.chat_title,
          storedSource: sessionMeta.chat_title_source,
          messages: initialAccumulated,
        });

        this.sessions.set(sessionId, {
          session_id:       sessionId,
          display_name:     sessionMeta.display_name,
          workspace_name:   workspaceMatch?.title || wsTitle || target.title || agentType,
          workspace_path:   workspaceMatch?.path || sessionMeta.workspace_path || null,
          chat_title:       initialDesktopTitle.title,
          chat_title_source: initialDesktopTitle.source,
          machine_label:    sessionMeta.machine_label,
          target_signature: sessionMeta.target_signature,
          client,
          lastMessageCount:  effectiveInitialCount,
          lastObservedCount: effectiveInitialCount,
          lastTranscriptSig: this._transcriptSignature(initialAccumulated),
          nullPollCount:     0,
          pendingLast:       null,
          resyncCandidateSig: null,
          waitingForAssistant: false,
          thinking:          false,
          thinkingLabel:     '',
          autoApprovePermissions: agentType === 'cursor' ? autoApprovePermissions : (sessionMeta.auto_approve_permissions === true),
          preferenceKey:     agentType === 'cursor' ? preferenceKey : undefined,
          status:            'healthy',
          activity:          sessionMeta.activity || { kind: 'idle', label: '', updated_at: new Date().toISOString() },
          last_seen_at:      new Date().toISOString(),
          windowTitle:       target.title || agentType,
          agentType,
          parentId:          null,
          ext:               null,
          targetId:          target.id,
          _cdpPort:          target._cdpPort,
          _cdpHost:          target._cdpHost || null,
          _lastThreadListSig: initialThreadList
            ? JSON.stringify(initialThreadList.map(t => `${t.id || ''}:${t.title || ''}:${!!t.active}`))
            : '',
          _lastThreadList: Array.isArray(initialThreadList) ? initialThreadList.slice() : [],
          _activeThreadKey: agentType === 'cursor'
            ? effectiveCursorThreadKey
            : (initialActiveThreadKey || storedActiveThreadKey || ''),
          _activeThreadTitle: agentType === 'cursor'
            ? (initialCursorActiveThread?.title || '')
            : (initialActiveThread?.title || sessionMeta.codex_desktop_active_thread_title || ''),
          codexDesktopActiveThreadKey: initialActiveThreadKey || storedActiveThreadKey || '',
          _cursorAgentHistories: initialCursorAgentHistories,
          _accumulatedMessages: agentType === 'codex-desktop' || agentType === 'cursor'
            ? initialAccumulated
            : null,
          _lastConfigPollAt: agentType === 'codex-desktop' ? Date.now() : 0,
          _lastCodexDesktopThreadPollAt: agentType === 'codex-desktop' ? Date.now() : 0,
          _newChatPending: agentType === 'cursor' && sessionMeta.cursor_new_chat_pending && initialCount === 0
            ? Date.now()
            : undefined,
        });
        if (initialDesktopTitle.title && (
          initialDesktopTitle.title !== sessionMeta.chat_title
          || initialDesktopTitle.source !== sessionMeta.chat_title_source
        )) {
          sessionStore.updateSession(sessionId, {
            chat_title: initialDesktopTitle.title,
            chat_title_source: initialDesktopTitle.source,
          });
        }

        if (agentType === 'codex-desktop' && initialActiveThreadKey) {
          this._refreshCodexDesktopThreadMetadata(
            sessionId,
            this.sessions.get(sessionId),
            initialActiveThreadKey,
            initialActiveThread?.title || '',
          );
        }

        this._log('info', `[cdp] ${agentType} → ${sessionId} "${target.title}" (${initialCount} msgs)`);

        if (effectiveInitialCount > 0) {
          this._sendHistorySnapshot(
            sessionId,
            initialAccumulated,
            restoreStoredCursorAccumulator || restoreStoredAccumulator
              ? 'restored discovery'
              : 'initial discovery'
          );
        }

        const agentCaps = this._buildCapabilities(agentType, this.sessions.get(sessionId)?.workspace_path);
        selectors.readAgentConfig(client.Runtime, agentType, null).then(cfg => {
          const session = this.sessions.get(sessionId);
          const merged = this._decorateAgentConfig(session, this._mergeAgentConfig(agentType, cfg, null));
          if (session) session._currentModelId = merged.model_id || null;
          this._sendToRelay(proto.agentConfig(sessionId, { ...merged, capabilities: agentCaps }));
        }).catch(() => {
          this._sendToRelay(proto.agentConfig(sessionId, { agent_type: agentType, capabilities: agentCaps }));
        });

        this._attachDesktopCdpDisconnectHandler(sessionId, agentType, client);

        this._broadcastSessionSnapshot();

      } catch (e) {
        await this._safeClose(client);
        if (String(e.message || '').includes('timed out')) this._cooldownCdpTarget(target, e.message, 30000);
        this._log('error', `[cdp] Failed to probe ${agentType} target ${target.id.substring(0, 8)}: ${e.message}`);
      }
    }

    // ── Orphan sweep ────────────────────────────────────────────────────
    if (!allowedTargetIds) {
      const currentTargetsById = new Map(targets.map(t => [t.id, t]));
      const liveSessions = Array.from(this.sessions.values());
      for (const sess of sessionStore.getAllSessions()) {
        if (sess.status !== 'healthy') continue;
        if (this.sessions.has(sess.session_id)) continue;
        if (!sess.target_id) continue;
        const target = currentTargetsById.get(sess.target_id);
        const reason = classifyStoredCdpOrphan(sess, target, successfulCdpPorts, liveSessions);
        if (reason) {
          this._log('info', `[discover] Orphan sweep: marking ${sess.session_id} disconnected — target ${sess.target_id.substring(0, 8)} ${reason}`);
          sessionStore.markDisconnected(sess.session_id);
        }
      }
      this._broadcastSessionSnapshot();
    }
    await this._syncDomPushObservers();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Start the proxy engine: prune stale sessions, connect to relay,
   * discover initial targets, and start the poll loop.
   */
  async start() {
    if (this._running) return;
    this._running = true;
    this._log('info', `[proxy] Starting — CDP ports ${this.CDP_PORTS.join(', ')}, relay ${this.RELAY_URL}, machine ${this.MACHINE_LABEL}, proxy_id ${this.PROXY_ID}`);

    sessionStore.pruneStale(7);
    this._runLocalUploadMaintenance();
    this._localUploadMaintenanceTimer = setInterval(
      () => this._runLocalUploadMaintenance(),
      LOCAL_UPLOAD_MAINTENANCE_INTERVAL_MS,
    );
    this._localUploadMaintenanceTimer.unref?.();

    // Native Codex JSONL receipts are authoritative at request_user_input
    // deadlines. Keep one engine-owned lane independent of CDP renderer
    // reads, per-session timer ownership, and filesystem watcher delivery.
    this._codexVsCodeQuestionDeadlineSweepTimer = setInterval(() => {
      try {
        this._sweepCodexVsCodeQuestionDeadlineReceipts();
      } catch (error) {
        this._log('warn', `[question] VS Code deadline receipt sweep failed: ${error.message}`);
      }
    }, 100);
    this._codexVsCodeQuestionDeadlineSweepTimer.unref?.();
    this._codexVsCodeQuestionActiveSweepTimer = setInterval(() => {
      try {
        this._sweepCodexVsCodeActiveQuestionPolls();
      } catch (error) {
        this._log('warn', `[question] Active VS Code question sweep failed: ${error.message}`);
      }
    }, this.VSCODE_CODEX_QUESTION_ACTIVE_POLL_INTERVAL_MS);
    this._codexVsCodeQuestionActiveSweepTimer.unref?.();
    let deadlineSweepSourceHash = 'unavailable';
    try {
      deadlineSweepSourceHash = crypto.createHash('sha256')
        .update(fs.readFileSync(__filename))
        .digest('hex')
        .slice(0, 16);
    } catch {}
    this._log(
      'info',
      `[question] VS Code deadline receipt sweep active (100ms, source ${deadlineSweepSourceHash})`,
    );

    this.connectRelay();
    await this._discoverClaudeCliSessions();
    this._startClaudeCliWatcher();
    await this._discoverCodexCliSessions();
    this._startCodexCliWatcher();
    this._codexCliGoalMonitorTimer = setInterval(() => {
      if (!this._running) return;
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType !== 'codex_cli') continue;
        if (session.codexCliExternalActive !== true
            && !session._codexCliChild
            && !session._codexAppServerTurn) continue;
        this._scheduleCodexCliGoalControllerAudit(sessionId, session);
      }
    }, this.CODEX_CLI_GOAL_MONITOR_INTERVAL_MS);
    this._codexCliGoalMonitorTimer.unref?.();
    await this._discoverCursorCliSessions();
    this._startCursorCliWatcher();
    await this._discoverTargets();
    await this._refreshAntigravityQuotaUsage(true);
    this._providerUsage.start();

    // Cursor 3.5+ renders every workspace's agents inside one global page.
    // Inventory that page independently of the 10-second CDP target sweep so
    // new native agent UUIDs reach the relay within the <=5-second contract.
    this._cursorAgentDiscoveryTimer = setInterval(async () => {
      if (!this._running || this._cursorAgentDiscoveryInProgress) return;
      this._cursorAgentDiscoveryInProgress = true;
      try {
        await this._refreshCursorVirtualTargets();
        await this._syncDomPushObservers();
      } catch (e) {
        this._log('warn', `[cursor] Agent inventory refresh failed: ${e.message}`);
      } finally {
        this._cursorAgentDiscoveryInProgress = false;
      }
    }, 2000);

    // Antigravity v2 must not share the sequential desktop/side-pane poll
    // queue. Large Codex transcripts can keep that queue occupied for more
    // than a minute, leaving Agent Manager's final structured snapshot and
    // idle transition stale in the WebUI. Keep one bounded, non-overlapping
    // v2 lane so unrelated harnesses cannot starve its completion updates.
    this._antigravityV2PollTimer = setInterval(async () => {
      if (!this._running || this._antigravityV2PollInProgress) return;
      const v2Session = Array.from(this.sessions.entries()).find(([, session]) =>
        session.agentType === 'antigravity-v2'
      );
      if (!v2Session) return;
      this._antigravityV2PollInProgress = true;
      try {
        const [sessionId] = v2Session;
        await this._runAdaptivePollCycle(sessionId);
      } catch (e) {
        this._log('warn', '[poll] Antigravity v2 lane: ' + e.message);
      } finally {
        this._antigravityV2PollInProgress = false;
      }
    }, this.POLL_INTERVAL_MS);

    // Codex Desktop also gets an isolated lane. Its large, actively mutating
    // transcript can keep Electron's renderer busy beyond the side-pane
    // timeout even with a bounded 96-unit read. Isolation prevents that work
    // from starving every other harness, while the longer per-session bound
    // avoids destructive rediscovery during a valid busy-renderer sample.
    this._codexDesktopPollTimer = setInterval(async () => {
      if (!this._running || this._codexDesktopPollInProgress) return;
      const desktopSession = Array.from(this.sessions.entries()).find(([, session]) =>
        session.agentType === 'codex-desktop'
      );
      if (!desktopSession) return;
      const [sessionId] = desktopSession;

      this._codexDesktopPollInProgress = true;
      try {
        await this._runAdaptivePollCycle(sessionId);
      } catch (e) {
        this._log('warn', '[poll] Codex Desktop lane: ' + e.message);
      } finally {
        this._codexDesktopPollInProgress = false;
      }
    }, this.POLL_INTERVAL_MS);

    // Claude CLI transcripts and lifecycle state are local-file/process reads.
    // They must not rotate through the much slower CDP/window group queue,
    // where a large unrelated history can delay interrupt and trust updates
    // for tens of seconds. Poll every active/restored Claude CLI session in a
    // bounded, non-overlapping lane instead.
    this._claudeCliPollTimer = setInterval(async () => {
      if (!this._running || this._claudeCliPollInProgress) return;
      const claudeCliSessionIds = Array.from(this.sessions.entries())
        .filter(([, session]) => session.agentType === 'claude_cli')
        .map(([sessionId]) => sessionId);
      if (claudeCliSessionIds.length === 0) return;
      this._claudeCliPollInProgress = true;
      try {
        for (const sessionId of claudeCliSessionIds) {
          await this._pollSessionBounded(sessionId);
        }
      } catch (e) {
        this._log('warn', '[poll] Claude CLI lane: ' + e.message);
      } finally {
        this._claudeCliPollInProgress = false;
      }
    }, this.POLL_INTERVAL_MS);

    // Continue webviews cannot keep a persistent CDP observer without known
    // focus/scroll side effects. After an explicit remote send, poll only that
    // active Continue session through the existing fresh-attach path until its
    // assistant turn stabilizes, with a hard two-minute expiry. Idle Continue
    // sessions retain the conservative window-rotated fallback below.
    this._continueRemotePollTimer = setInterval(async () => {
      if (!this._running || this._continueRemotePollInProgress) return;
      this._continueRemotePollInProgress = true;
      try {
        for (const [sessionId, session] of this.sessions.entries()) {
          if (!shouldRunContinueRemoteFastPoll(session) || session._remoteFastPollInProgress) continue;
          session._remoteFastPollInProgress = true;
          try {
            await this._pollSessionBounded(sessionId);
          } catch (e) {
            this._log('warn', `[poll] Continue remote fast-follow: ${e.message}`);
          } finally {
            session._remoteFastPollInProgress = false;
          }
        }
      } finally {
        this._continueRemotePollInProgress = false;
      }
    }, 750);

    let tick = 0;
    this._pollTimer = setInterval(async () => {
      if (!this._running) return;
      if (this._pollLoopInProgress) {
        this._skippedPollTicks = (this._skippedPollTicks || 0) + 1;
        if (this._skippedPollTicks === 1 || this._skippedPollTicks % 10 === 0) {
          this._log('warn', `[poll] Previous tick still running; skipped ${this._skippedPollTicks} tick(s)`);
        }
        return;
      }
      const pollTickStartedAt = Date.now();
      this._pollLoopInProgress = true;
      try {
      tick++;

      if (targetDiscoveryDueOnTick(tick)) this._targetDiscoveryDue = true;
      if (tick % 30 === 0) {
        this._cliDiscoveryDue = true;
        this._statusMaintenanceDue = true;
      }

      // Top-level caps on discovery and quota refresh so a single hung
      // CDP renderer can never freeze the entire poll loop. Each function
      // already has internal per-step timeouts; these are belt-and-braces.
      if (this._targetDiscoveryDue) {
        const ran = await this._runBackgroundMaintenanceStep('target discovery', async () => {
          try {
            await this._withTimeout(this._discoverTargets(), 30000, 'tick discoverTargets');
          } catch (e) { this._log('warn', `[poll] discoverTargets: ${e.message}`); }
        }, { deferForQuestionLatency: true });
        if (ran) this._targetDiscoveryDue = false;
      }
      if (this._statusMaintenanceDue && this.sessions.size > 0) {
        const ran = await this._runBackgroundMaintenanceStep('quota/status maintenance', async () => {
          try {
            await this._refreshAntigravityQuotaUsage();
          } catch (e) { this._log('warn', `[poll] refreshAntigravityQuota: ${e.message}`); }
          for (const [id, s] of this.sessions.entries()) {
            this._log('info', `[status] ${id} (${s.agentType}): ${s.lastMessageCount} msgs, relay ${this.relayReady ? 'up' : 'down'}, status=${s.status}`);
          }
          this._broadcastSessionSnapshot();
        });
        if (ran) this._statusMaintenanceDue = false;
      }

      // Poll desktop apps, Codex side pane sessions, and Continue YOLO every
      // tick. Continue YOLO still uses ephemeral CDP attaches via
      // _pollSessionContinue/_isEphemeralIframeAgent, but it should not share
      // the slow sidepane-Continue throttle because the editor-panel UX needs
      // near-live transcript sync.
      const everyTickIds = [];
      // Group remaining window-backed sessions by parentId (Antigravity window)
      // so we only interact with one window's CDP targets per tick.
      const windowGroups = new Map(); // parentId → [sessionId, ...]
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.agentType === 'codex_cli' && session.codexCliArchiveDiscovered === true
            && !session._codexCliChild && !session._codexAppServerTurn
            && session._goalRunLifecycle?.lease_active !== true) {
          continue;
        }
        if (session.agentType === 'codex_cli') {
          everyTickIds.push(sessionId);
          continue;
        }
        if (session.agentType === 'cursor_cli' && session.cursorCliArchiveDiscovered === true && !session._cursorCliChild) {
          continue;
        }
        if (session.agentType === 'antigravity-v2' || session.agentType === 'codex-desktop') {
          continue;
        }
        if (session.agentType === 'claude_cli') {
          continue;
        }
        if (
          session.agentType === 'claude-desktop' ||
          session.agentType === 'cursor' ||
          session.agentType === 'codex'
        ) {
          if (session._cursorVirtual && !session._cursorNativeActive) continue;
          everyTickIds.push(sessionId);
          continue;
        }
        const key = session.parentId
          ? workbenchWindowKey(session._cdpPort, session.parentId)
          : sessionId;
        if (!windowGroups.has(key)) windowGroups.set(key, []);
        windowGroups.get(key).push(sessionId);
      }

      for (const sessionId of everyTickIds) {
        const session = this.sessions.get(sessionId);
        if (!session) continue;
        if (session.agentType === 'continue_yolo') {
          await this._pollSessionBounded(sessionId);
          continue;
        }
        // Throttle desktop apps when idle — the user is most likely typing
        // and our DOM walking (readMessages + detectThinking) blocks the
        // renderer thread.  Poll every 3rd tick (~3s) when idle, every tick
        // when actively generating.
        if (
          this._domPush.getState(sessionId)?.status === 'active'
          && (session.agentType === 'codex-desktop' || session.agentType === 'claude-desktop' || session.agentType === 'cursor')
        ) {
          const isActive = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
          // codex-desktop / cursor: 2 ticks active (responsive streaming), 4 ticks
          // idle (cuts CDP pressure in half during long idle stretches
          // without making chat-switch detection feel slow). claude-desktop
          // keeps the prior idle/active distinction.
          let threshold;
          if (session.agentType === 'codex-desktop' || session.agentType === 'cursor') {
            threshold = isActive ? 2 : 4;
            // Wedge backoff: when Codex Desktop has been timing out
            // repeatedly, the renderer is pegged and any extra CDP pressure
            // makes recovery slower. Back off to 15 ticks (~15s) until the
            // health counter clears via a successful poll.
            const timeoutCount = (this._consecutiveTimeoutsByTarget || new Map()).get(session.targetId) || 0;
            if (timeoutCount >= 2) threshold = Math.max(threshold, 15);
          } else {
            threshold = isActive ? 1 : 3;
          }
          if (!isActive) {
            session._desktopIdlePollCount = (session._desktopIdlePollCount || 0) + 1;
            if (session._desktopIdlePollCount < threshold) continue;
            session._desktopIdlePollCount = 0;
          } else {
            session._desktopActivePollCount = (session._desktopActivePollCount || 0) + 1;
            if (session._desktopActivePollCount < threshold) continue;
            session._desktopActivePollCount = 0;
          }
        }
        if (session.agentType === 'codex' && this._domPush.getState(sessionId)?.status === 'active') {
          // 3 ticks active, 5 ticks idle. The dirty-check is cheap so we
          // don't need the old adaptive backoff that stretched to 16/24
          // ticks (which made chat switches feel broken).
          const isActive = session.activity?.kind === 'generating' || session.activity?.kind === 'thinking';
          const threshold = isActive ? 3 : 5;
          session._codexPollCount = (session._codexPollCount || 0) + 1;
          if (session._codexPollCount < threshold) continue;
          session._codexPollCount = 0;
        }
        await this._runAdaptivePollCycle(sessionId);
      }

      const windowKeys = Array.from(windowGroups.keys());
      const liveWindowKeys = new Set(windowKeys);
      for (const key of this._pollWindowSessionIndexes.keys()) {
        if (!liveWindowKeys.has(key)) this._pollWindowSessionIndexes.delete(key);
      }
      if (windowKeys.length > 0) {
        // Pick which window to poll this tick (round-robin)
        this._pollWindowIndex = this._pollWindowIndex % windowKeys.length;
        const activeKey = windowKeys[this._pollWindowIndex];
        this._pollWindowIndex++;

        // Poll a small slice of the selected window. Polling every session in
        // a busy window can monopolize the tick and starve desktop app reads.
        const group = windowGroups.get(activeKey) || [];
        let polledWindowSessions = 0;
        let visitedWindowSessions = 0;
        const startIndex = group.length > 0
          ? ((this._pollWindowSessionIndexes.get(activeKey) || 0) % group.length)
          : 0;
        while (visitedWindowSessions < group.length && polledWindowSessions < 2) {
          const sessionId = group[(startIndex + visitedWindowSessions) % group.length];
          visitedWindowSessions++;
          const session = this.sessions.get(sessionId);
          if (!session) continue;
          // Throttle Continue sessions — CDP eval on their iframe steals
          // VS Code panel focus.  Poll every 5s instead of every tick.
          if (session.agentType === 'continue' || session.agentType === 'continue_yolo') {
            const shouldFastPollPermissions = session.autoApprovePermissions || this.activePermissionPrompts.has(sessionId);
            if (shouldFastPollPermissions) {
              await this._pollPermissionsBounded(sessionId);
            } else {
              session._continuePermissionPollCount = (session._continuePermissionPollCount || 0) + 1;
              if (session._continuePermissionPollCount >= 2) {
                session._continuePermissionPollCount = 0;
                await this._pollPermissionsBounded(sessionId);
              }
            }

            session._continuePollCount = (session._continuePollCount || 0) + 1;
            if (session._continuePollCount < 5) continue;
            session._continuePollCount = 0;
            await this._runAdaptivePollCycle(sessionId);
            polledWindowSessions++;
            continue;
          }
          if (await this._runAdaptivePollCycle(sessionId)) polledWindowSessions++;
        }
        if (group.length > 0) {
          this._pollWindowSessionIndexes.set(
            activeKey,
            (startIndex + Math.max(visitedWindowSessions, 1)) % group.length
          );
        }
      }
      } catch (e) {
        this._log('error', `[poll] Tick error: ${e.message}`);
      } finally {
        this._recordPollTickBudget(Date.now() - pollTickStartedAt);
        this._pollLoopInProgress = false;
        // CLI archive discovery performs bounded synchronous filesystem work.
        // Start it only after releasing the primary tick so timer callbacks do
        // not count that independent maintenance as an overlapping poll.
        if (this._cliDiscoveryDue) {
          this._scheduleBackgroundMaintenanceStep('CLI discovery', async () => {
            try {
              await this._withTimeout(this._discoverClaudeCliSessions(), 10000, 'tick discoverClaudeCli');
            } catch (e) { this._log('warn', `[poll] discoverClaudeCli: ${e.message}`); }
            try {
              await this._withTimeout(this._discoverCodexCliSessions(), 10000, 'tick discoverCodexCli');
            } catch (e) { this._log('warn', `[poll] discoverCodexCli: ${e.message}`); }
            try {
              await this._withTimeout(this._discoverCursorCliSessions(), 10000, 'tick discoverCursorCli');
            } catch (e) { this._log('warn', `[poll] discoverCursorCli: ${e.message}`); }
            this._cliDiscoveryDue = false;
          }, { deferForQuestionLatency: true });
        }
      }
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop the proxy engine: close relay, close all CDP clients, clear timers.
   */
  stop() {
    this._running = false;
    this._log('info', '[proxy] Stopping engine...');
    this._providerUsage.stop();
    this._hostResourceMonitor.stop();

    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._antigravityV2PollTimer) {
      clearInterval(this._antigravityV2PollTimer);
      this._antigravityV2PollTimer = null;
    }
    this._antigravityV2PollInProgress = false;
    if (this._codexDesktopPollTimer) {
      clearInterval(this._codexDesktopPollTimer);
      this._codexDesktopPollTimer = null;
    }
    this._codexDesktopPollInProgress = false;
    if (this._continueRemotePollTimer) {
      clearInterval(this._continueRemotePollTimer);
      this._continueRemotePollTimer = null;
    }
    if (this._cursorAgentDiscoveryTimer) {
      clearInterval(this._cursorAgentDiscoveryTimer);
      this._cursorAgentDiscoveryTimer = null;
    }
    this._cursorAgentDiscoveryInProgress = false;
    if (this._claudeCliPollTimer) {
      clearInterval(this._claudeCliPollTimer);
      this._claudeCliPollTimer = null;
    }
    this._claudeCliPollInProgress = false;
    this._continueRemotePollInProgress = false;
    if (this._snapshotTimer) { clearTimeout(this._snapshotTimer); this._snapshotTimer = null; }
    for (const timer of this._domPushSecondaryPollTimers?.values() || []) clearTimeout(timer);
    this._domPushSecondaryPollTimers?.clear();
    this._domPushSecondaryPollInFlight?.clear();
    if (this._localUploadMaintenanceTimer) {
      clearInterval(this._localUploadMaintenanceTimer);
      this._localUploadMaintenanceTimer = null;
    }
    if (this._codexVsCodeQuestionDeadlineSweepTimer) {
      clearInterval(this._codexVsCodeQuestionDeadlineSweepTimer);
      this._codexVsCodeQuestionDeadlineSweepTimer = null;
    }
    if (this._codexVsCodeQuestionActiveSweepTimer) {
      clearInterval(this._codexVsCodeQuestionActiveSweepTimer);
      this._codexVsCodeQuestionActiveSweepTimer = null;
    }
    if (this._relayBulkFlushTimer) {
      clearTimeout(this._relayBulkFlushTimer);
      this._relayBulkFlushTimer = null;
    }
    if (this._codexCliWatcher) {
      try { this._codexCliWatcher.close(); } catch {}
      this._codexCliWatcher = null;
    }
    if (this._codexCliGoalMonitorTimer) {
      clearInterval(this._codexCliGoalMonitorTimer);
      this._codexCliGoalMonitorTimer = null;
    }
    this._stopCodexCliGoalMonitor().catch(() => {});
    this._codexCliGoalMonitorInFlight?.clear();
    if (this._claudeCliWatcher) {
      try { this._claudeCliWatcher.close(); } catch {}
      this._claudeCliWatcher = null;
    }
    this._stopHeartbeat();
    this._domPush.close().catch(() => {});

    // Close all CDP clients
    for (const [sid, session] of this.sessions.entries()) {
      if (session._relayTranscriptResyncTimer) {
        clearTimeout(session._relayTranscriptResyncTimer);
        session._relayTranscriptResyncTimer = null;
      }
      if (session.client) {
        try { session.client.close(); } catch {}
      }
      if (session._codexAppServerTurn) {
        try { session._codexAppServerTurn.stop().catch(() => {}); } catch {}
        session._codexAppServerTurn = null;
      }
    }
    this.sessions.clear();
    this.activePermissionPrompts.clear();
    this.activeQuestionPromptAdapters.clear();
    this.activeErrorPrompts.clear();
    this._pendingRelayBulk?.clear();
    this._relayBulkDeferralLogAt?.clear();
    this._pendingPreReadyHistory?.clear();
    this._pendingPreReadyEvents?.clear();
    this._largeHistorySkipLogAt.clear();
    this._codexCliHistoryChunkRequests.clear();
    this._cursorCliHistoryChunkRequests.clear();
    this._codexConfigQueues.clear();
    this._codexConfigPending.clear();
    this._codexConfigReceipts.clear();
    this._pollWindowSessionIndexes.clear();
    this._cdpPortCooldownUntil.clear();
    this._cdpTargetCooldownUntil.clear();
    this._discoverLogDedupe?.clear();
    this._consecutiveTimeoutsByTarget?.clear();
    sessionStore.flushPendingSaves();

    // Close relay
    if (this.relayWs) {
      try { this.relayWs.close(); } catch {}
      this.relayWs = null;
    }
    this.relayReady = false;

    this._log('info', '[proxy] Engine stopped');
  }

  /**
   * Get current session count (for status display).
   */
  getSessionCount() {
    return this.sessions.size;
  }

  /**
   * Get whether relay is connected.
   */
  isRelayConnected() {
    return this.relayReady;
  }
}

module.exports = {
  ProxyEngine,
  mergeCodexCliArchiveDiscoverySummaries,
  detectCodexDesktopInstalledVersion,
  detectVsCodeCodexInstalledVersion,
  codexDesktopThreadKeysMatch,
  resolveCodexDesktopThreadMetadata,
  isDesktopAppPage,
  isStoredDesktopTargetCanonical,
  classifyStoredCdpOrphan,
  classifyActiveSessionTarget,
  countExactCodexUserMessages,
  codexArchiveAppendContainsExactUser,
  isClosedCdpTransportError,
  shouldRetainCodexDesktopPermissionTimeout,
  targetDiscoveryDueOnTick,
  shouldRestoreCodexDesktopAccumulator,
  isPathWithinWorkspace,
  resolveWorkspaceRequestPath,
  normalizeCursorWorkspaceToken,
  resolveCursorWorkspacePath,
  cursorNativeActivity,
  cursorHasAuthoritativeWorkingSignal,
  cursorAgentEligible,
  CURSOR_WORKING_CONTINUITY_LEASE_MS,
  CURSOR_NATIVE_OBSERVED_SOURCE,
  validateAttachmentPayload,
  shouldImmediatelyStreamCursorAssistant,
  shouldImmediatelyStreamAntigravityV2Assistant,
  shouldPrioritizeCliAssistantSnapshot,
  shouldImmediatelyStreamContinueAssistant,
  shouldSendStablePendingMessage,
  completedPrefixMutationIndex,
  appendedMutationCandidateStableEnd,
  shouldRunContinueRemoteFastPoll,
  shouldFastPollCodexCliSession,
  shouldHoldContinueRemoteWaitOnRegression,
  shouldImmediatelyStreamContinueInPlace,
  shouldImmediatelyStreamContinueTailMutation,
  shouldPreserveCursorPassiveRotation,
  shouldBypassHistoryBulkQueue,
  expectedCodexQuestionAnswers,
};
