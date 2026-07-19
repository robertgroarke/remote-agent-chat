// lib/relay.js — WebSocket relay client
//
// Ported from frontend/hooks.jsx. Maintains the same JSON message protocol
// as the web client. The JWT is passed as a query parameter since React
// Native's WebSocket implementation does not support custom headers.

import { getStoredJwt, RELAY_URL } from './auth';

const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 3_000];
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

export function classifyRelayRtt(rttMs) {
  if (!Number.isFinite(rttMs) || rttMs < 0) return 'connecting';
  if (rttMs <= 500) return 'healthy';
  if (rttMs <= 2_000) return 'slow';
  return 'poor';
}

export class RelayClient {
  constructor(onMessage) {
    this.onMessage      = onMessage;  // (msg) => void — called for every incoming event
    this.ws             = null;
    this.reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS;
    this._heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this._heartbeatSequence = 0;
    this._heartbeatPending = new Map();
    this._sessionSubscriptions = [];
    this._subscriptionSequence = 0;
    this._hostResourceDesired = { active: false, aggregateOnly: false };
    this._hostResourceSubscriptionId = '';
    this._hostResourceSubscribeRequestId = '';
    this._hostResourceSequence = 0;
    this._controlConnectionId = '';
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
      this.reconnectAttempt = 0;
      this.onMessage({ type: '_connected' });
      this.onMessage({ type: '_connection_health', state: 'connecting', rttMs: null, lastAckAt: null });
      // Ask for current session list and history on connect
      this._send({ type: 'connection_hello', last_sequence: 0 });
      this._send({
        type: 'subscribe',
        protocol_version: 1,
        request_id: `android-sub-${Date.now()}-${++this._subscriptionSequence}`,
        sessions: this._sessionSubscriptions,
      });
      if (this._hostResourceDesired.active) {
        this._sendHostResourceSubscribe(
          this._hostResourceDesired.aggregateOnly,
          this._hostResourceSubscriptionId,
        );
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connection_ack') {
          this._controlConnectionId = String(msg.connection_id || '');
          this._heartbeatIntervalMs = Math.max(1_000, Number(msg.heartbeat_interval_ms) || DEFAULT_HEARTBEAT_MS);
          this._heartbeatTimeoutMs = Math.max(
            this._heartbeatIntervalMs * 2,
            Number(msg.heartbeat_timeout_ms) || DEFAULT_HEARTBEAT_TIMEOUT_MS,
          );
          this._startHeartbeat();
        } else if (msg.type === 'heartbeat_ack') {
          this._handleHeartbeatAck(msg);
        } else if (msg.type === 'host_resource_subscription_ack'
          && msg.request_id === this._hostResourceSubscribeRequestId
          && typeof msg.subscription_id === 'string') {
          this._hostResourceSubscriptionId = msg.subscription_id;
          this._hostResourceSubscribeRequestId = '';
        }
        // Emit initial activity from session_list metadata so badges appear
        // immediately on connect (before the first 'status' event arrives)
        if ((msg.type === 'session_list' || msg.type === 'connection_ack') && Array.isArray(msg.sessions)) {
          this.onMessage(msg);
          for (const s of msg.sessions) {
            if (s && typeof s === 'object' && s.session_id && s.activity) {
              const kind = s.activity.kind || 'idle';
              this.onMessage({
                type:     'status',
                session:  s.session_id,
                thinking: kind !== 'idle',
                label:    s.activity.label || '',
                activity: s.activity,
              });
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
      this.onMessage({ type: '_connection_health', state: 'offline', rttMs: null, lastAckAt: null });
      if (!this.stopped) this._scheduleReconnect();
    };
  }

  // ── Send helpers ───────────────────────────────────────────────────────────

  setSessionSubscriptions(sessionIds) {
    const normalized = [...new Set((Array.isArray(sessionIds) ? sessionIds : [])
      .filter(id => typeof id === 'string' && id.length > 0))]
      .sort()
      .slice(0, 128);
    if (normalized.length === this._sessionSubscriptions.length
      && normalized.every((id, index) => id === this._sessionSubscriptions[index])) return;
    this._sessionSubscriptions = normalized;
    this._send({
      type: 'subscribe',
      protocol_version: 1,
      request_id: `android-sub-${Date.now()}-${++this._subscriptionSequence}`,
      sessions: normalized,
    });
  }

  sendMessage(sessionId, content, clientMsgId, createdAt = null) {
    this._send({
      type:              'send',
      session:           sessionId,
      content,
      client_message_id: clientMsgId || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }

  resumeSession(sourceSession, agentType, workspacePath, options = {}) {
    const requestId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'resume_session',
      source_session: sourceSession,
      agent_type: agentType || 'claude',
      workspace_path: workspacePath || undefined,
      cli_session_id: options.cli_session_id || undefined,
      model_id: options.model_id || undefined,
      permission_mode: options.permission_mode || undefined,
      request_id: requestId,
    });
    return requestId;
  }

  requestHistory(sessionId, afterSeq = 0) {
    this._send({ type: 'get_history', session: sessionId, after_sequence: afterSeq });
  }

  requestHistoryChunk(sessionId, options = {}) {
    const requestId = `histchunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const mode = options.mode === 'older' ? 'older' : options.mode === 'around' ? 'around' : 'tail';
    const message = {
      type: 'history_chunk_request',
      session: sessionId,
      session_id: sessionId,
      request_id: requestId,
      mode,
      source: 'relay_sqlite',
      replace: mode === 'around' || (mode === 'tail' && options.replace === true),
      limit: Math.max(1, Math.min(500, Number(options.limit) || 200)),
    };
    if (mode === 'older' && options.beforeId != null) message.before_id = options.beforeId;
    if (mode === 'around' && options.aroundId != null) message.around_id = options.aroundId;
    this._send(message);
    return requestId;
  }

  launchSession(agentType, workspacePath, options = {}) {
    const requestId = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'launch_session',
      agent_type: agentType,
      workspace_path: workspacePath || undefined,
      model_id: options.model_id || undefined,
      permission_mode: options.permission_mode || undefined,
      effort: options.effort || undefined,
      request_id: requestId,
    });
    return requestId;
  }

  closeSession(sessionId, isDisconnected = false) {
    const requestId = `close-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: isDisconnected ? 'dismiss_session' : 'close_session',
      session: sessionId,
      session_id: sessionId,
      request_id: requestId,
    });
    return requestId;
  }

  interrupt(sessionId, options = {}) {
    const requestId = `interrupt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'agent_interrupt',
      session_id: sessionId,
      request_id: requestId,
      connection_id: this._controlConnectionId,
      session_generation: Math.max(0, Number(options.sessionGeneration) || 0),
      turn_generation: Math.max(0, Number(options.turnGeneration) || 0),
    });
    return requestId;
  }

  controlGoal(sessionId, action, goal, options = {}) {
    const requestId = `goal-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'agent_goal_control',
      session_id: sessionId,
      request_id: requestId,
      action,
      connection_id: this._controlConnectionId,
      session_generation: Math.max(0, Number(options.sessionGeneration) || 0),
      goal_generation: Math.max(0, Number(goal?.generation) || 0),
      goal_transition_seq: Math.max(0, Number(goal?.transition_seq) || 0),
      goal_fingerprint: String(goal?.fingerprint || ''),
    });
    return requestId;
  }

  respondToPermission(sessionId, promptId, choiceId, details = {}, prompt = null) {
    const requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (prompt?.type === 'question_prompt') {
      const action = details.action === 'cancel' ? 'cancel' : 'answer';
      this._send({
        type: 'question_response', session_id: sessionId, prompt_id: promptId,
        generation: prompt.generation,
        action,
        ...(action === 'answer' ? { answers: Array.isArray(details.answers) ? details.answers : [] } : {}),
        request_id: requestId,
      });
      return requestId;
    }
    this._send({
      type: 'permission_response', session_id: sessionId, prompt_id: promptId,
      ...(choiceId ? { choice_id: choiceId } : {}),
      ...(Array.isArray(details.answers) ? { answers: details.answers } : {}),
      ...(typeof details.instruction === 'string' && details.instruction.trim()
        ? { instruction: details.instruction.trim() } : {}),
      request_id: requestId,
    });
    return requestId;
  }

  respondToErrorPrompt(sessionId, promptId, actionId, operatorGesture = false) {
    const requestId = `errprompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'error_prompt_action',
      session_id: sessionId,
      prompt_id: promptId,
      action_id: actionId,
      request_id: requestId,
      ...(actionId === 'open_native_window' ? { operator_user_gesture: operatorGesture === true } : {}),
    });
    return requestId;
  }

  steerMessage(sessionId, clientMessageId, content, nativeIndex) {
    const message = {
      type: 'steer',
      session_id: sessionId,
      client_message_id: clientMessageId,
      content,
    };
    if (nativeIndex != null) message.native_index = nativeIndex;
    this._send(message);
  }

  discardQueuedMessage(sessionId, clientMessageId) {
    this._send({
      type: 'discard_queued',
      session_id: sessionId,
      client_message_id: clientMessageId,
    });
  }

  editQueuedMessage(sessionId, clientMessageId, content) {
    this._send({
      type: 'edit_queued',
      session_id: sessionId,
      client_message_id: clientMessageId,
      content,
    });
  }

  requestDirectoryListing(sessionId, dirPath = '.') {
    const requestId = `dir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'list_directory',
      session_id: sessionId,
      request_id: requestId,
      path: dirPath || '.',
    });
    return requestId;
  }

  requestFileContent(sessionId, filePath) {
    const requestId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'read_file',
      session_id: sessionId,
      request_id: requestId,
      path: filePath,
    });
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

  setAutoApprovePermissions(sessionId, enabled) {
    const requestId = `autoap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'agent_set_auto_approve_permissions',
      session_id: sessionId,
      enabled: !!enabled,
      request_id: requestId,
    });
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

  setAgentEffort(sessionId, effort) {
    const requestId = `effort-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({ type: 'agent_set_effort', session_id: sessionId, effort, request_id: requestId });
    return requestId;
  }

  openNativeWindow(sessionId, operatorGesture = false) {
    const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'open_native_window', session_id: sessionId, request_id: requestId,
      operator_user_gesture: operatorGesture === true,
    });
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

  respondToFileChange(sessionId, changeId, action) {
    const requestId = `filechg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'file_change_response',
      session_id: sessionId,
      change_id: changeId,
      action,
      request_id: requestId,
    });
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

  requestProviderUsageRefresh(force = false, providerId = null) {
    const requestId = `provider-usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'provider_usage_refresh',
      protocol_version: 1,
      force: force === true,
      ...(providerId ? { provider_id: providerId } : {}),
      request_id: requestId,
    });
    return requestId;
  }

  setProviderUsageWatching(active) {
    this._send({
      type: 'provider_usage_watch',
      protocol_version: 1,
      active: active === true,
    });
  }

  consumeProviderUsageResetCredit() {
    const requestId = `provider-reset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'provider_usage_reset_credit_consume',
      protocol_version: 1,
      request_id: requestId,
      approved: true,
    });
    return requestId;
  }

  requestProviderUsageCostDetail(options = {}) {
    const requestId = `provider-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'provider_usage_cost_detail_request',
      protocol_version: 1,
      request_id: requestId,
      days: Math.max(1, Math.min(365, Number(options.days) || 365)),
      provider_id: options.providerId || null,
      project: options.project || null,
      cursor: /^\d+$/.test(String(options.cursor ?? '0')) ? String(options.cursor ?? '0') : '0',
      page_size: Math.max(1, Math.min(256, Number(options.pageSize) || 256)),
    });
    return requestId;
  }

  requestHostResourceRefresh(force = false) {
    const requestId = `host-resource-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._send({
      type: 'host_resource_refresh',
      protocol_version: 1,
      force: force === true,
      request_id: requestId,
    });
    return requestId;
  }

  _sendHostResourceSubscribe(aggregateOnly, resumeSubscriptionId = '') {
    const requestId = `host-resource-subscribe-${Date.now()}-${++this._hostResourceSequence}`;
    this._hostResourceSubscribeRequestId = requestId;
    this._send({
      type: 'host_resource_subscribe',
      protocol_version: 1,
      request_id: requestId,
      ...(resumeSubscriptionId ? { resume_subscription_id: resumeSubscriptionId } : {}),
      aggregate_only: aggregateOnly === true,
    });
    return requestId;
  }

  subscribeHostResources(aggregateOnly = false) {
    const normalizedAggregateOnly = aggregateOnly === true;
    if (this._hostResourceDesired.active
      && this._hostResourceDesired.aggregateOnly === normalizedAggregateOnly
      && this._hostResourceSubscriptionId) return this._hostResourceSubscriptionId;
    if (this._hostResourceSubscriptionId
      && this._hostResourceDesired.aggregateOnly !== normalizedAggregateOnly) {
      this._send({
        type: 'host_resource_unsubscribe', protocol_version: 1,
        request_id: `host-resource-unsubscribe-${Date.now()}-${++this._hostResourceSequence}`,
        subscription_id: this._hostResourceSubscriptionId,
      });
      this._hostResourceSubscriptionId = '';
    }
    this._hostResourceDesired = { active: true, aggregateOnly: normalizedAggregateOnly };
    return this._sendHostResourceSubscribe(normalizedAggregateOnly, '');
  }

  requestHostResourceHistory(stream, afterSequence = 0) {
    if (!this._hostResourceSubscriptionId) return null;
    const normalizedStream = stream === 'detail' ? 'detail' : 'system';
    const requestId = `host-resource-history-${normalizedStream}-${Date.now()}-${++this._hostResourceSequence}`;
    this._send({
      type: 'host_resource_history_request', protocol_version: 1,
      request_id: requestId, subscription_id: this._hostResourceSubscriptionId,
      stream: normalizedStream,
      after_sequence: Math.max(0, Math.round(Number(afterSequence) || 0)),
      max_points: normalizedStream === 'detail' ? 8 : 64,
    });
    return requestId;
  }

  unsubscribeHostResources() {
    this._hostResourceDesired = { active: false, aggregateOnly: false };
    const subscriptionId = this._hostResourceSubscriptionId;
    this._hostResourceSubscriptionId = '';
    this._hostResourceSubscribeRequestId = '';
    if (!subscriptionId) return null;
    const requestId = `host-resource-unsubscribe-${Date.now()}-${++this._hostResourceSequence}`;
    this._send({
      type: 'host_resource_unsubscribe', protocol_version: 1,
      request_id: requestId, subscription_id: subscriptionId,
    });
    return requestId;
  }

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
    this._sendHeartbeat();
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), this._heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    for (const pending of this._heartbeatPending.values()) clearTimeout(pending.timeout);
    this._heartbeatPending.clear();
  }

  _sendHeartbeat() {
    if (this.ws?.readyState !== WebSocket.OPEN || this._heartbeatPending.size > 0) return;
    const requestId = `android-hb-${Date.now()}-${++this._heartbeatSequence}`;
    const sentAt = Date.now();
    const timeout = setTimeout(() => {
      if (!this._heartbeatPending.has(requestId)) return;
      this._heartbeatPending.delete(requestId);
      this.onMessage({ type: '_connection_health', state: 'stale', rttMs: null, lastAckAt: null });
      try { this.ws?.close(); } catch {}
    }, this._heartbeatTimeoutMs);
    this._heartbeatPending.set(requestId, { sentAt, timeout });
    this._send({
      type: 'heartbeat', protocol_version: 1, request_id: requestId,
      client_ts: new Date(sentAt).toISOString(),
    });
  }

  _handleHeartbeatAck(message) {
    const pending = this._heartbeatPending.get(message.request_id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this._heartbeatPending.delete(message.request_id);
    const rttMs = Math.max(0, Date.now() - pending.sentAt);
    this.onMessage({
      type: '_connection_health',
      state: classifyRelayRtt(rttMs),
      rttMs,
      lastAckAt: Date.now(),
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    console.log(`[RelayClient] Reconnecting in ${delay}ms`);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
