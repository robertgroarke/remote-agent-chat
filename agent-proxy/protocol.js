// protocol.js — Protocol v1 message builders for the agent proxy
//
// Proxy-originated messages follow the shapes defined in protocol.md.
// For backward compat with an un-upgraded relay, each message also
// includes the legacy field names so both old and new relay code works.
//
// Covers task: A3-01 (proxy protocol handshake and ack flow)

'use strict';

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
    sessions,
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
function proxyMessage(sessionId, role, content) {
  return {
    type: 'proxy_message',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    message: {
      role,
      content,
      created_at: new Date().toISOString(),
    },
    // legacy compat: relay handles 'proxy_message' but older builds may check 'message'
    session: sessionId,
    role,
    content,
  };
}

// ─── Status events ────────────────────────────────────────────────────────────

// Session health or activity changed (replaces legacy 'status')
// selectorFailures is optional — included when degrading so the relay/browser
// can surface read/send failure counts for diagnostics (A3-05).
function proxyStatus(sessionId, status, activity, selectorFailures) {
  const thinking = activity?.kind === 'thinking' || activity?.kind === 'generating';
  const label = activity?.label || '';
  const msg = {
    type: 'proxy_status',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    status,
    activity,
    // legacy compat
    session: sessionId,
    thinking,
    label,
  };
  // Claude Code thinking content — passed through activity.thinkingContent
  if (activity?.thinkingContent) {
    msg.thinking_content = activity.thinkingContent;
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
  if (result === 'delivered') {
    msg.delivered_at = new Date().toISOString();
  } else {
    msg.failed_at = new Date().toISOString();
    if (extra?.error) msg.error = extra.error;
  }
  return msg;
}

// ─── History ──────────────────────────────────────────────────────────────────

// Proxy sends initial history on session discovery.
// Uses v1 'history_snapshot' type; includes legacy 'history' type field and
// 'session' field so un-upgraded relay still handles it.
function historySnapshot(sessionId, messages) {
  return {
    type: 'history_snapshot',
    protocol_version: PROTOCOL_VERSION,
    session_id: sessionId,
    last_sequence: 0,   // relay will assign real sequences on insert
    messages,
    // legacy compat
    session: sessionId,
  };
}

// ─── Agent control results ────────────────────────────────────────────────────

// Sent by proxy to relay in response to a control command.
// Relay routes back to the originating browser via request_id.
function agentControlResult(sessionId, requestId, command, result, error) {
  const msg = {
    type: 'agent_control_result',
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId,
    session_id: sessionId,
    command,
    result,
    server_ts: new Date().toISOString(),
  };
  if (result === 'failed' && error) msg.error = error;
  return msg;
}

// ─── Rate limit events (A12-03) ───────────────────────────────────────────────

// Emitted when rate limiting is first detected for a session.
// retry_after_hint is a human-readable string (e.g. "3:00 PM", "March 15 at 3pm") or null.
function rateLimitActive(sessionId, retryAfterHint) {
  const msg = {
    type:             'rate_limit_active',
    protocol_version: PROTOCOL_VERSION,
    session_id:       sessionId,
    detected_at:      new Date().toISOString(),
  };
  if (retryAfterHint) msg.retry_after_hint = retryAfterHint;
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

module.exports = {
  PROTOCOL_VERSION,
  hello,
  heartbeat,
  sessionSnapshot,
  proxyMessage,
  proxyStatus,
  proxySendResult,
  historySnapshot,
  agentControlResult,
  agentConfig,
  rateLimitActive,
  rateLimitCleared,
  branchList,
  chatList,
  threadList,
  terminalOutput,
  fileChanges,
  skillsList,
};
