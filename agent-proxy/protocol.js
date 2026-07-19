// protocol.js — Protocol v1 message builders for the agent proxy
//
// Proxy-originated messages follow the shapes defined in protocol.md.
// For backward compat with an un-upgraded relay, each message also
// includes the legacy field names so both old and new relay code works.
//
// Covers task: A3-01 (proxy protocol handshake and ack flow)

'use strict';

const { parseResetAt } = require('../relay-server/usage-resume');

const { resolveProjectRoot } = require('./project-root');

const PROTOCOL_VERSION = 1;

// ─── Connection lifecycle ─────────────────────────────────────────────────────

function hello(machineLabel, proxyId, proxySecret) {
  const msg = {
    type: 'connection_hello',
    protocol_version: PROTOCOL_VERSION,
    peer_role: 'proxy',
    client_name: 'agent-proxy',
    client_version: 'dev',
    machine_label: machineLabel,
    proxy_id: proxyId,
  };
  if (proxySecret) msg.secret = proxySecret; // SEC-02: send secret in hello, not URL
  return msg;
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function heartbeat(connectionId, requestId) {
  return {
    type: 'heartbeat',
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId,
    connection_id: connectionId,
    client_ts: new Date().toISOString(),
  };
}

// ─── Session events ───────────────────────────────────────────────────────────

// Sent after connect and after rediscovery (replaces legacy session_list)
function sessionSnapshot(sessions, workspaces, proxyId) {
  const msg = {
    type: 'proxy_session_snapshot',
    protocol_version: PROTOCOL_VERSION,
    sessions: (sessions || []).map(session => {
      if (!session || typeof session !== 'object') return session;
      return {
        ...session,
        project_root: resolveProjectRoot(session.workspace_path),
      };
    }),
    // legacy compat: relay may still read session_list
    // (we send session_list separately in broadcastSessionSnapshot)
  };
  if (proxyId) msg.proxy_id = proxyId;
  if (workspaces && workspaces.length > 0) msg.workspaces = workspaces;
  return msg;
}

// ─── Transcript events ────────────────────────────────────────────────────────

// Proxy observed a transcript message (replaces legacy 'message').
// Includes legacy fields so an un-upgraded relay that checks `type === 'message'`
// still works — but 'proxy_message' is the canonical v1 type.
function proxyMessage(sessionId, role, content, extra = null) {
  const contentBlocks = Array.isArray(extra?.content_blocks) ? extra.content_blocks : null;
  const sourceMessageId = typeof extra?.source_message_id === 'string' ? extra.source_message_id : null;
  const sourceCursor = extra?.source_cursor && typeof extra.source_cursor === 'object' ? extra.source_cursor : null;
  const parsedTimestamp = [extra?.created_at, extra?.timestamp, extra?.ts]
    .map((value) => {
      const numericTimestamp = Number(value);
      return (typeof value === 'number'
        || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())))
        ? (Number.isFinite(numericTimestamp) && numericTimestamp > 0
            ? new Date(numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000)
            : null)
        : (value ? new Date(value) : null);
    })
    .find(date => date && Number.isFinite(date.getTime()) && date.getTime() > 0) || null;
  const createdAt = parsedTimestamp && Number.isFinite(parsedTimestamp.getTime()) && parsedTimestamp.getTime() > 0
    ? parsedTimestamp.toISOString()
    : null;
  const msg = {
    type: 'proxy_message',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    message: {
      role,
      content,
    },
    // legacy compat: relay handles 'proxy_message' but older builds may check 'message'
    session: sessionId,
    role,
    content,
  };
  if (createdAt) {
    msg.message.created_at = createdAt;
    msg.created_at = createdAt;
    msg.ts = parsedTimestamp.getTime() / 1000;
  }
  if (contentBlocks) {
    msg.message.content_blocks = contentBlocks;
    msg.content_blocks = contentBlocks;
  }
  if (sourceMessageId) {
    msg.source_message_id = sourceMessageId;
    msg.message.source_message_id = sourceMessageId;
  }
  if (sourceCursor) {
    msg.source_cursor = sourceCursor;
    msg.message.source_cursor = sourceCursor;
  }
  if (extra?.source) {
    msg.source = String(extra.source);
    msg.message.source = String(extra.source);
  }
  return msg;
}

// Incremental in-flight transcript content. The settled proxyMessage remains the
// authoritative persisted record and reconciles this ephemeral stream.
function messageDelta(sessionId, messageId, blockIndex, seq, op, append = '', extra = null) {
  const msg = {
    type: 'message_delta',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    session: sessionId,
    message_id: messageId,
    role: extra?.role || 'assistant',
    block_index: blockIndex,
    block_type: extra?.block_type || 'text',
    seq,
    op,
  };
  if (op === 'append') msg.append = append;
  if (extra?.stream_trace) msg.stream_trace = extra.stream_trace;
  return msg;
}

// ─── Status events ────────────────────────────────────────────────────────────

// Session health or activity changed (replaces legacy 'status')
// selectorFailures is optional — included when degrading so the relay/browser
// can surface read/send failure counts for diagnostics (A3-05).
function proxyStatus(sessionId, status, activity, selectorFailures) {
  const taskList = activity?.task_list;
  const typedTaskList = taskList && Array.isArray(taskList.tasks) ? {
    ...taskList,
    content_blocks: [{
      type: 'plan',
      label: 'Plan',
      total: Number(taskList.total) || taskList.tasks.length,
      completed: Number(taskList.completed) || 0,
      tasks: taskList.tasks,
    }],
  } : taskList;
  const typedActivity = taskList ? { ...activity, task_list: typedTaskList } : activity;
  const thinking = typedActivity?.kind === 'thinking' || typedActivity?.kind === 'generating';
  const label = typedActivity?.label || '';
  const msg = {
    type: 'proxy_status',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    status,
    activity: typedActivity,
    activity_trace: { proxy_emitted_at_ms: Date.now() },
    // legacy compat
    session: sessionId,
    thinking,
    label,
  };
  // Claude Code thinking content — passed through activity.thinkingContent
  if (typedActivity?.thinkingContent) {
    msg.thinking_content = typedActivity.thinkingContent;
  }
  if (selectorFailures && (selectorFailures.readFails > 0 || selectorFailures.sendFails > 0)) {
    msg.selector_failures = {
      read:  selectorFailures.readFails  || 0,
      send:  selectorFailures.sendFails  || 0,
    };
  }
  return msg;
}

// ─── Send lifecycle ───────────────────────────────────────────────────────────

// Proxy reports success or failure of a send injection
function proxySendResult(sessionId, clientMessageId, result, extra) {
  const msg = {
    type: 'proxy_send_result',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    client_message_id: clientMessageId,
    result,
  };
  if (result === 'launch_accepted') {
    msg.accepted_at = extra?.accepted_at || new Date().toISOString();
  } else if (result === 'delivered') {
    msg.delivered_at = new Date().toISOString();
  } else {
    msg.failed_at = new Date().toISOString();
    if (extra?.error) msg.error = extra.error;
  }
  if (extra?.lifecycle) msg.lifecycle = extra.lifecycle;
  if (extra?.native_receipt) msg.native_receipt = extra.native_receipt;
  if (extra?.process_epoch) msg.process_epoch = extra.process_epoch;
  return msg;
}

function agentStarted(sessionId, clientMessageId, nativeReceipt, nativeStart) {
  return {
    type: 'agent_started',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    client_message_id: clientMessageId,
    delivered_at: nativeReceipt?.observed_at || new Date().toISOString(),
    started_at: nativeStart?.native_event_at || nativeStart?.observed_at || new Date().toISOString(),
    native_receipt: nativeReceipt || null,
    native_start: nativeStart || null,
  };
}

// ─── History ──────────────────────────────────────────────────────────────────

// Proxy sends initial history on session discovery.
// Uses v1 'history_snapshot' type; includes legacy 'history' type field and
// 'session' field so un-upgraded relay still handles it. Large snapshots may
// omit the redundant legacy history array once the v1 messages array alone is
// needed to stay inside the bounded relay frame budget.
function historySnapshot(sessionId, messages, options = {}) {
  const snapshot = {
    type: 'history_snapshot',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    last_sequence: 0,   // relay will assign real sequences on insert
    messages,
    // legacy compat
    session: sessionId,
  };
  if (options.includeLegacyHistory !== false) snapshot.history = messages;
  if (options.liveUpdate === 'assistant_completion') {
    snapshot.live_update = 'assistant_completion';
  }
  if (options.resyncId) snapshot.resync_id = String(options.resyncId);
  if (options.resyncReason) snapshot.resync_reason = String(options.resyncReason);
  if (options.source) snapshot.source = String(options.source);
  if (options.sourceCursor && typeof options.sourceCursor === 'object') snapshot.source_cursor = options.sourceCursor;
  if (Number.isFinite(Number(options.sourceBytes))) snapshot.source_bytes = Number(options.sourceBytes);
  if (Number.isFinite(Number(options.rateLimitMs))) snapshot.resync_rate_limit_ms = Number(options.rateLimitMs);
  return snapshot;
}

// Ephemeral, requester-scoped Windows host telemetry. The relay must never
// cache, persist, or broadcast this payload.
function hostResourceSnapshot(requestId, snapshot) {
  return {
    type: 'host_resource_snapshot',
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId || null,
    snapshot,
  };
}

function historyChunk(sessionId, options = {}) {
  const {
    requestId = null,
    messages = [],
    mode = 'tail',
    startOffset = 0,
    endOffset = 0,
    nextBeforeOffset = null,
    totalBytes = 0,
    partial = false,
    complete = !partial,
    source = 'native',
    replace = false,
    error = null,
  } = options;
  const cursor = {
    start_offset: Math.max(0, Number(startOffset) || 0),
    end_offset: Math.max(0, Number(endOffset) || 0),
    next_before_offset: nextBeforeOffset == null ? null : Math.max(0, Number(nextBeforeOffset) || 0),
    total_bytes: Math.max(0, Number(totalBytes) || 0),
  };
  const msg = {
    type: 'history_chunk',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    session: sessionId,
    request_id: requestId || null,
    mode,
    source,
    replace: !!replace,
    messages: Array.isArray(messages) ? messages : [],
    partial: !!partial,
    complete: !!complete,
    cursor,
  };
  if (error) msg.error = error;
  return msg;
}

// ─── Agent control results ────────────────────────────────────────────────────

// Sent by proxy to relay in response to a control command.
// Relay routes back to the originating browser via request_id.
function agentControlResult(sessionId, requestId, command, result, details) {
  const msg = {
    type: 'agent_control_result',
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId,
    session_id: sessionId,
    command,
    result,
    server_ts: new Date().toISOString(),
  };
  if (result === 'failed' && details) {
    msg.error = details;
    if (typeof details.native_attempted === 'boolean') msg.native_attempted = details.native_attempted;
    if (typeof details.retryable === 'boolean') msg.retryable = details.retryable;
  }
  if (result === 'ok' && details) {
    msg.details = details;
    if (typeof details.native_acknowledged === 'boolean') msg.native_acknowledged = details.native_acknowledged;
  }
  return msg;
}

// ─── Rate limit events (A12-03) ───────────────────────────────────────────────

// Emitted when rate limiting is first detected for a session.
// retry_after_hint is a human-readable string (e.g. "3:00 PM", "March 15 at 3pm") or null.
function rateLimitActive(sessionId, retryAfterHint, percentUsed, hardLimited) {
  const msg = {
    type:             'rate_limit_active',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    detected_at:      new Date().toISOString(),
  };
  if (retryAfterHint) msg.retry_after_hint = retryAfterHint;
  const resetAt = parseResetAt(retryAfterHint);
  if (resetAt) msg.reset_at = resetAt;
  if (percentUsed != null) msg.percent_used = percentUsed;
  if (hardLimited != null) msg.hard_limited = hardLimited === true;
  return msg;
}

// Emitted when the rate limit indicator disappears for a session.
function rateLimitCleared(sessionId) {
  return {
    type:             'rate_limit_cleared',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    cleared_at:       new Date().toISOString(),
  };
}

// ─── Agent config ─────────────────────────────────────────────────────────────

// Sent by proxy to relay when config is read on connect, on request, or after change.
// Relay caches and broadcasts to all browsers for the session.
function agentConfig(sessionId, config) {
  return {
    type: 'agent_config',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    ...config,
    read_at: new Date().toISOString(),
  };
}

function canonicalPromptActions(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: item?.choice_id || item?.action_id || item?.id || item?.value || `action-${index}`,
    label: item?.label || item?.title || item?.text || 'Action',
    ...(item?.style ? { style: item.style } : {}),
  }));
}

function permissionPrompt(sessionId, prompt) {
  const content = String(prompt?.prompt_text || prompt?.message || prompt?.description || 'Agent requires permission to continue.');
  return {
    ...prompt,
    type: 'permission_prompt',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    content_blocks: [{
      type: 'prompt',
      label: prompt?.title || (prompt?.kind === 'question' ? 'Question' : 'Permission required'),
      content,
      actions: canonicalPromptActions(prompt?.choices),
    }],
    detected_at: prompt?.detected_at || new Date().toISOString(),
  };
}

function questionPrompt(sessionId, prompt) {
  return {
    ...prompt,
    type: 'question_prompt',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    detected_at: prompt?.observed_at || new Date().toISOString(),
  };
}

function questionPromptState(sessionId, promptId, generation, lifecycle, details = {}) {
  return {
    type: 'question_prompt_state',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    prompt_id: promptId,
    generation,
    lifecycle,
    ...(details.error_code ? { error_code: details.error_code } : {}),
    ...(details.error ? { error: details.error } : {}),
    observed_at: new Date().toISOString(),
  };
}

// Sent by proxy when a session shows a blocking error/action modal that the
// browser should surface with controls.
function sessionErrorPrompt(sessionId, prompt) {
  const informational = prompt?.blocking === false || prompt?.display_mode === 'inline';
  const blockType = prompt?.block_type || (informational ? 'notice' : 'error');
  return {
    ...prompt,
    type: 'session_error_prompt',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    content_blocks: [{
      type: blockType,
      label: prompt?.title || (informational ? 'Attention' : 'Action required'),
      content: String(prompt?.message || 'There was an error handling the model response.'),
      actions: canonicalPromptActions(prompt?.actions),
      ...(prompt?.error_output ? { error_output: String(prompt.error_output) } : {}),
    }],
    detected_at: new Date().toISOString(),
  };
}

// Sent by proxy when the blocking error/action modal disappears.
function sessionErrorPromptCleared(sessionId, promptId) {
  return {
    type: 'session_error_prompt_cleared',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    prompt_id: promptId,
    cleared_at: new Date().toISOString(),
  };
}

// ─── Branch list ─────────────────────────────────────────────────────────────

// Sent by proxy to relay when a branch list is read from a workspace.
function branchList(sessionId, branches, current) {
  return {
    type:             'branch_list',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    branches,         // string[]
    current,          // string — current branch name
    read_at:          new Date().toISOString(),
  };
}

// ─── Chat list (Epic 9) ──────────────────────────────────────────────────────

// Sent by proxy to relay when a chat/conversation list is read from an agent panel.
// Relay caches and broadcasts to all browsers for the session.
function chatList(sessionId, chats) {
  return {
    type:             'chat_list',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    chats,            // [{ id, title, active }]
    read_at:          new Date().toISOString(),
  };
}

// ─── Thread list (Epic 2) ────────────────────────────────────────────────────

// Sent by proxy to relay when a thread list is read from Codex Desktop.
// Relay broadcasts to all browsers for the session.
function threadList(sessionId, threads) {
  return {
    type:             'thread_list',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    threads,          // [{ id, title, active, timestamp? }]
    read_at:          new Date().toISOString(),
  };
}

// ─── Terminal output (Epic 4) ─────────────────────────────────────────────────

// Sent by proxy when terminal/command output is read from a Codex session.
function terminalOutput(sessionId, entries) {
  return {
    type:             'terminal_output',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    entries,          // [{ command?, output, turnId? }]
    read_at:          new Date().toISOString(),
  };
}

// ─── File changes / diff (Epic 5) ─────────────────────────────────────────────

// Sent by proxy when file changes are read from a Codex session's diff panel.
function fileChanges(sessionId, entries) {
  return {
    type:             'file_changes',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    entries,          // [{ file?, content, type: 'diff'|'inline', panelVisible? }]
    read_at:          new Date().toISOString(),
  };
}

// ─── Skills list (Codex Desktop) ─────────────────────────────────────────────

// Sent by proxy when the skills list is read from Codex Desktop.
function skillsList(sessionId, skills) {
  return {
    type:             'skill_list',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    installed:        skills.installed || [],   // [{ id, name, description, icon? }]
    recommended:      skills.recommended || [], // [{ id, name, description, icon? }]
    read_at:          new Date().toISOString(),
  };
}

// Sent by proxy when Codex Desktop shows a native automation detail pane.
function codexAutomationView(sessionId, view) {
  return {
    type:             'codex_automation_view',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    view:             view || null,
    read_at:          new Date().toISOString(),
  };
}

// ─── File browser events ─────────────────────────────────────────────────────

// Sent by proxy in response to a list_directory request from the browser.
function directoryListing(sessionId, requestPath, entries, requestId) {
  const msg = {
    type:             'directory_listing',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    path:             requestPath,     // relative to workspace root
    entries,                           // [{ name, type: 'file'|'directory', size, modified }]
    read_at:          new Date().toISOString(),
  };
  if (requestId) msg.request_id = requestId;
  return msg;
}

// Sent by proxy in response to a read_file request from the browser.
function fileContent(sessionId, requestPath, content, truncated, requestId) {
  const msg = {
    type:             'file_content',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    path:             requestPath,     // relative to workspace root
    content,                           // file content as string
    truncated:        !!truncated,     // true if content was capped at max_size
    read_at:          new Date().toISOString(),
  };
  if (requestId) msg.request_id = requestId;
  return msg;
}

// ─── Message queue events ────────────────────────────────────────────────────

// Sent when a message has been queued for delivery to the agent session.
function queuedMessageBlock(content, clientMessageId, status = 'queued') {
  return {
    type: 'queued_message',
    label: 'Queued message',
    content: String(content || ''),
    client_message_id: clientMessageId,
    status,
  };
}

function messageQueued(sessionId, clientMessageId, content) {
  return {
    type:              'message_queued',
    protocol_version:  PROTOCOL_VERSION,
    session_id:        sessionId,
    client_message_id: clientMessageId,
    content,
    content_blocks:    [queuedMessageBlock(content, clientMessageId)],
    queued_at:         new Date().toISOString(),
  };
}

// Sent when a queued message has been successfully delivered to the agent.
function queueDelivered(sessionId, clientMessageId) {
  return {
    type:              'queue_delivered',
    protocol_version:  PROTOCOL_VERSION,
    session_id:        sessionId,
    client_message_id: clientMessageId,
    delivered_at:      new Date().toISOString(),
  };
}

// Sent with the result of a steer (mid-conversation injection) attempt.
function steerResult(sessionId, clientMessageId, result, error) {
  const msg = {
    type:              'steer_result',
    protocol_version:  PROTOCOL_VERSION,
    session_id:        sessionId,
    client_message_id: clientMessageId,
    result,
    server_ts:         new Date().toISOString(),
  };
  if (result === 'failed' && error) msg.error = error;
  return msg;
}

// Sent when the native queue state changes (Codex side-panel queue items with Steer buttons).
// These are messages queued by Codex itself (not our proxy) while the agent was busy.
function nativeQueue(sessionId, items) {
  const typedItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const nativeIndex = item?.index ?? index;
    const clientMessageId = `native-${nativeIndex}`;
    const contentBlocks = [queuedMessageBlock(item?.text, clientMessageId, item?.state || 'queued')];
    return { ...item, index: nativeIndex, content_blocks: contentBlocks };
  });
  return {
    type:             'native_queue',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    items:            typedItems,
    content_blocks:   typedItems.flatMap(item => item.content_blocks),
    detected_at:      new Date().toISOString(),
  };
}

module.exports = {
  PROTOCOL_VERSION,
  hello,
  heartbeat,
  sessionSnapshot,
  proxyMessage,
  messageDelta,
  proxyStatus,
  hostResourceSnapshot,
  proxySendResult,
  agentStarted,
  historySnapshot,
  historyChunk,
  agentControlResult,
  agentConfig,
  permissionPrompt,
  questionPrompt,
  questionPromptState,
  sessionErrorPrompt,
  sessionErrorPromptCleared,
  rateLimitActive,
  rateLimitCleared,
  branchList,
  chatList,
  threadList,
  terminalOutput,
  fileChanges,
  skillsList,
  codexAutomationView,
  directoryListing,
  fileContent,
  messageQueued,
  queueDelivered,
  steerResult,
  nativeQueue,
};
