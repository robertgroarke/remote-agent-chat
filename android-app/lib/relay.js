// lib/relay.js — WebSocket relay client
//
// Ported from frontend/hooks.jsx. Maintains the same JSON message protocol
// as the web client. The JWT is passed as a query parameter since React
// Native's WebSocket implementation does not support custom headers.

import { getStoredJwt, RELAY_URL } from './auth';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const HEARTBEAT_MS      = 30_000;

export class RelayClient {
  constructor(onMessage) {
    this.onMessage      = onMessage;  // (msg) => void — called for every incoming event
    this.ws             = null;
    this.reconnectMs    = RECONNECT_BASE_MS;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this.stopped        = false;
  }

  // ── Connect ────────────────────────────────────────────────────────────────

  async connect() {
    if (this.stopped) return;
    const jwt = await getStoredJwt();
    if (!jwt) {
      // Not authenticated — surface as disconnected event and stop
      this.onMessage({ type: '_disconnected', reason: 'unauthenticated' });
      return;
    }
    const wsBase = RELAY_URL.replace(/^http/, 'ws');
    const url    = `${wsBase}/client-ws?token=${encodeURIComponent(jwt)}`;
    this.ws      = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[RelayClient] Connected to', wsBase);
      this.reconnectMs = RECONNECT_BASE_MS;
      this._startHeartbeat();
      this.onMessage({ type: '_connected' });
      // Ask for current session list and history on connect
      this._send({ type: 'connection_hello', last_sequence: 0 });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        // Emit initial activity from session_list metadata so badges appear
        // immediately on connect (before the first 'status' event arrives)
        if (msg.type === 'session_list' && Array.isArray(msg.sessions)) {
          this.onMessage(msg);
          for (const s of msg.sessions) {
            if (s && typeof s === 'object' && s.session_id && s.activity) {
              const kind = s.activity.kind || 'idle';
              if (kind !== 'idle') {
                this.onMessage({
                  type:     'status',
                  session:  s.session_id,
                  thinking: kind !== 'idle',
                  label:    s.activity.label || '',
                });
              }
            }
          }
          return;
        }
        this.onMessage(msg);
      } catch { /* ignore malformed frames */ }
    };

    this.ws.onerror = (err) => {
      console.warn('[RelayClient] WebSocket error', err?.message || err);
    };

    this.ws.onclose = (e) => {
      console.log('[RelayClient] Disconnected', e?.code, e?.reason);
      this._stopHeartbeat();
      this.onMessage({ type: '_disconnected' });
      if (!this.stopped) this._scheduleReconnect();
    };
  }

  // ── Send helpers ───────────────────────────────────────────────────────────

  sendMessage(sessionId, content, clientMsgId) {
    this._send({
      type:          'send',
      session:       sessionId,
      content,
      client_msg_id: clientMsgId || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }

  resumeSession(sourceSession, agentType, workspacePath) {
    const requestId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'resume_session',
      source_session: sourceSession,
      agent_type: agentType || 'claude',
      workspace_path: workspacePath || undefined,
      request_id: requestId,
    });
    return requestId;
  }

  requestHistory(sessionId, afterSeq = 0) {
    this._send({ type: 'get_history', session: sessionId, after_sequence: afterSeq });
  }

  interrupt(sessionId) {
    this._send({ type: 'agent_interrupt', session_id: sessionId });
  }

  respondToPermission(sessionId, promptId, choiceId) {
    const requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'permission_response', session_id: sessionId, prompt_id: promptId, choice_id: choiceId, request_id: requestId });
    return requestId;
  }

  requestAgentConfig(sessionId) {
    const requestId = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'agent_config_request', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  setAgentModel(sessionId, modelId) {
    const requestId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'agent_set_model', session_id: sessionId, model_id: modelId, request_id: requestId });
    return requestId;
  }

  setAgentPermissionMode(sessionId, mode) {
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'agent_set_permission_mode', session_id: sessionId, mode, request_id: requestId });
    return requestId;
  }

  setAntigravityMode(sessionId, mode) {
    const requestId = `mode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'agent_set_mode', session_id: sessionId, mode, request_id: requestId });
    return requestId;
  }

  setCodexConfig(sessionId, updates) {
    const requestId = `codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'set_codex_config', session_id: sessionId, ...updates, request_id: requestId });
    return requestId;
  }

  // ── Panel control (Epic 9) ─────────────────────────────────────────────────

  openPanel(sessionId) {
    const requestId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'open_panel', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  requestChatList(sessionId) {
    const requestId = `chatlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'chat_list', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  switchChat(sessionId, chatId) {
    const requestId = `switch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'switch_chat', session_id: sessionId, chat_id: chatId, request_id: requestId });
    return requestId;
  }

  newChat(sessionId) {
    const requestId = `newchat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'new_chat', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  // ── Thread control (Epic 2) ────────────────────────────────────────────────

  requestThreadList(sessionId) {
    const requestId = `threads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'thread_list', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  switchThread(sessionId, threadId) {
    const requestId = `swthread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'switch_thread', session_id: sessionId, thread_id: threadId, request_id: requestId });
    return requestId;
  }

  // ── Skills list (Codex Desktop) ─────────────────────────────────────────────

  requestSkillList(sessionId) {
    const requestId = `skills-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'skill_list', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  // ── Terminal output (Epic 4) ────────────────────────────────────────────────

  requestTerminalOutput(sessionId) {
    const requestId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'terminal_output', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  sendTerminalInput(sessionId, text) {
    const requestId = `termin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'terminal_input', session_id: sessionId, request_id: requestId, text });
    return requestId;
  }

  // ── File changes / diff (Epic 5) ──────────────────────────────────────────

  requestFileChanges(sessionId) {
    const requestId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'file_changes', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  // ── Image / file attachment (Epic 6) ──────────────────────────────────────

  sendAttachment(sessionId, base64Data, mimeType, filename) {
    const requestId = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'send_attachment', session_id: sessionId, request_id: requestId, data: base64Data, mime_type: mimeType, filename });
    return requestId;
  }

  // ── Branch control ───────────────────────────────────────────────────────

  requestBranchList(sessionId) {
    const requestId = `branches-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'branch_list', session_id: sessionId, request_id: requestId });
    return requestId;
  }

  switchBranch(sessionId, branchName) {
    const requestId = `swbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'switch_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
    return requestId;
  }

  createBranch(sessionId, branchName) {
    const requestId = `newbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'create_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
    return requestId;
  }

  // ── Workspace switching (Epic 3) ──────────────────────────────────────────

  switchWorkspace(sessionId, folderPath) {
    const requestId = `swws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'switch_workspace', session_id: sessionId, folder_path: folderPath, request_id: requestId });
    return requestId;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  disconnect() {
    this.stopped = true;
    clearTimeout(this._reconnectTimer);
    this._stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => this._send({ type: 'ping' }), HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    console.log(`[RelayClient] Reconnecting in ${this.reconnectMs}ms`);
    this._reconnectTimer = setTimeout(() => {
      this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectMs);
  }
}
