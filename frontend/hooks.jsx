// hooks.jsx — Transport/WebSocket hook (useRelay)
// Loaded via <script type="text/babel"> between markdown.js and app.jsx.
// Owns all wire-protocol logic. Agent 5 UI redesign work should not touch this file.
//
// Handles both protocol v1 messages (session metadata objects, proxy_message, etc.)
// and the legacy wire format so the frontend works with both relay versions.

const { useState, useEffect, useRef, useCallback } = React;

export function useRelay() {
    const [sessions,        setSessions]        = useState([]);   // string IDs (legacy) or metadata objects (v1)
    const [messages,        setMessages]        = useState({});   // sessionId -> [{role, content, _cid?, _optimistic?, _delivered?}]
    const [connected,       setConnected]       = useState(false);
    const [unread,          setUnread]          = useState({});   // sessionId -> count
    const [thinking,        setThinking]        = useState({});   // sessionId -> label string | false
    const [thinkingContent, setThinkingContent] = useState({});   // sessionId -> string (Claude Code thinking text) | ''
    const [activities,      setActivities]      = useState({});   // sessionId -> { kind, label, updatedAt } | false
    const [health,          setHealth]          = useState({});   // sessionId -> 'healthy'|'degraded'|'disconnected'
    const [deliveryStates,  setDeliveryStates]  = useState({});   // clientMsgId -> 'queued'|'accepted'|'failed'|'busy_queued'|'steered'
    const [queuedMessages,  setQueuedMessages]  = useState({});   // sessionId -> [{ cid, content, queuedAt }]
    const [launchStates,      setLaunchStates]      = useState({});   // requestId -> { status:'launching'|'failed', agentType, error? }
    const [justLaunched,      setJustLaunched]      = useState(null); // session_id of most recently launched session (for auto-select)
    const [permissionPrompts, setPermissionPrompts] = useState({});   // session_id -> prompt object (one active prompt per session)
    const [agentConfigs,      setAgentConfigs]      = useState({});   // session_id -> agent_config object { model_id, permission_mode, file_access_scope, capabilities, ... }
    const [workspaces,        setWorkspaces]        = useState([]);   // [{title, path}] — open Antigravity windows for the launch dropdown
    const [chatLists,         setChatLists]         = useState({});   // sessionId -> [{ id, title, active }] — Codex chat/conversation lists
    const [threadLists,       setThreadLists]       = useState({});   // sessionId -> [{ id, title, active }] — Codex Desktop thread lists
    const [terminalOutputs,   setTerminalOutputs]   = useState({});   // sessionId -> [{ command?, output, turnId? }] — Codex terminal output
    const [fileChanges,       setFileChanges]       = useState({});   // sessionId -> [{ file?, content, type }] — Codex file changes/diff
    const [branchLists,       setBranchLists]       = useState({});   // sessionId -> { branches: string[], current: string }
    const [skillLists,        setSkillLists]        = useState({});   // sessionId -> { installed: [...], recommended: [...] }

    const thinkingTimers   = useRef({});
    const wsRef            = useRef(null);
    const activeSessionRef = useRef(null);

    const send = useCallback((msg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    }, []);

    const connect = useCallback(() => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws    = new WebSocket(`${proto}://${location.host}/client-ws`);
      wsRef.current = ws;

      ws.onopen  = () => setConnected(true);
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };

      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleRelayMessage(msg);
      };
    }, [send]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { connect(); }, [connect]);

    function mergeSessionMetadataActivity(sessionList) {
      const next = {};
      (sessionList || []).forEach(session => {
        if (!session || typeof session !== 'object' || !session.session_id || !session.activity) return;
        next[session.session_id] = {
          kind:      session.activity.kind || 'working',
          label:     session.activity.label || 'Working',
          updatedAt: session.activity.updated_at || null,
        };
      });
      if (Object.keys(next).length > 0) {
        setActivities(prev => ({ ...prev, ...next }));
      }
    }

    function requestHistory(sessionOrId) {
      const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.session_id;
      if (id) send({ type: 'get_history', session: id });
    }

    // Responds to a permission prompt.
    function respondToPrompt(sessionId, promptId, choiceId) {
      const requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setPermissionPrompts(prev => prev[sessionId]
        ? { ...prev, [sessionId]: { ...prev[sessionId], submitting_choice_id: choiceId, request_id: requestId, error: null } }
        : prev);
      send({ type: 'permission_response', session_id: sessionId, prompt_id: promptId, choice_id: choiceId, request_id: requestId });
    }

    function interruptSession(sessionId) {
      const requestId = `interrupt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_interrupt', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestAgentConfig(sessionId) {
      const requestId = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_config_request', session_id: sessionId, request_id: requestId });
    }

    // Track sessions with in-flight model changes to suppress stale config updates
    const modelChangeGrace = {};

    function setAgentModel(sessionId, modelId) {
      const requestId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_set_model', session_id: sessionId, model_id: modelId, request_id: requestId });
      // Suppress config overwrites for 10s while the model change propagates
      modelChangeGrace[sessionId] = Date.now() + 10000;
      // Optimistically update the config
      setAgentConfigs(prev => {
        const existing = prev[sessionId] || {};
        return { ...prev, [sessionId]: { ...existing, model_id: modelId } };
      });
      return requestId;
    }

    function setAgentPermissionMode(sessionId, mode) {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_set_permission_mode', session_id: sessionId, mode, request_id: requestId });
      return requestId;
    }

    function setAntigravityMode(sessionId, mode) {
      const requestId = `mode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_set_mode', session_id: sessionId, mode, request_id: requestId });
      return requestId;
    }

    function setCodexConfig(sessionId, { model_id, effort, access_mode, workspace_mode }) {
      const requestId = `codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'set_codex_config', session_id: sessionId, model_id, effort, access_mode, workspace_mode, request_id: requestId });
      return requestId;
    }

    function newThread(sessionId) {
      const requestId = `new-thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'new_thread', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function openPanel(sessionId) {
      const requestId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'open_panel', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestChatList(sessionId) {
      const requestId = `chatlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'chat_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchChat(sessionId, chatId) {
      const requestId = `switch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_chat', session_id: sessionId, chat_id: chatId, request_id: requestId });
      return requestId;
    }

    function newChat(sessionId) {
      const requestId = `newchat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'new_chat', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestThreadList(sessionId) {
      const requestId = `threads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'thread_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchThread(sessionId, threadId) {
      const requestId = `swthread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_thread', session_id: sessionId, thread_id: threadId, request_id: requestId });
      return requestId;
    }

    function requestTerminalOutput(sessionId) {
      const requestId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'terminal_output', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestFileChanges(sessionId) {
      const requestId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'file_changes', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestSkillList(sessionId) {
      const requestId = `skills-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'skill_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function sendAttachment(sessionId, base64Data, mimeType, filename) {
      const requestId = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'send_attachment', session_id: sessionId, request_id: requestId, data: base64Data, mime_type: mimeType, filename: filename });
      return requestId;
    }

    function switchWorkspace(sessionId, folderPath) {
      const requestId = `swws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_workspace', session_id: sessionId, folder_path: folderPath, request_id: requestId });
      return requestId;
    }

    function requestBranchList(sessionId) {
      const requestId = `branches-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'branch_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchBranch(sessionId, branchName) {
      const requestId = `swbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }

    function createBranch(sessionId, branchName) {
      const requestId = `newbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'create_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }

    // Launches a new agent session. Returns the requestId.
    function launchSession(agentType, workspacePath) {
      const requestId = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates(prev => ({ ...prev, [requestId]: { status: 'launching', agentType } }));
      send({ type: 'launch_session', agent_type: agentType, workspace_path: workspacePath || undefined, request_id: requestId });
      return requestId;
    }

    // Resumes an old session by launching a new agent and replaying history.
    function resumeSession(sourceSession, agentType, workspacePath) {
      const requestId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates(prev => ({ ...prev, [requestId]: { status: 'launching', agentType } }));
      send({
        type: 'resume_session',
        source_session: sourceSession,
        agent_type: agentType || 'claude',
        workspace_path: workspacePath || undefined,
        request_id: requestId,
      });
      return requestId;
    }

    // Closes an existing session. For disconnected/orphaned sessions, sends
    // dismiss_session so the relay removes it from the sidebar immediately.
    function closeSession(sessionId, isDisconnected) {
      if (isDisconnected) {
        send({ type: 'dismiss_session', session: sessionId });
      } else {
        send({ type: 'close_session', session: sessionId });
      }
    }

    // Sends a user message with delivery tracking. Returns the clientMsgId.
    function sendToSession(session, content) {
      const cid = `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setDeliveryStates(prev => ({ ...prev, [cid]: 'queued' }));
      setMessages(prev => ({
        ...prev,
        [session]: [...(prev[session] || []), { role: 'user', content, _cid: cid, _optimistic: true }],
      }));
      send({ type: 'send', session, content, client_message_id: cid });
      return cid;
    }

    function steerMessage(sessionId, clientMessageId, content) {
      send({ type: 'steer', session_id: sessionId, client_message_id: clientMessageId, content });
    }

    function discardQueuedMessage(sessionId, clientMessageId) {
      send({ type: 'discard_queued', session_id: sessionId, client_message_id: clientMessageId });
      setQueuedMessages(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter(m => m.cid !== clientMessageId) }));
      setDeliveryStates(prev => { const next = { ...prev }; delete next[clientMessageId]; return next; });
      // Remove the optimistic message from chat
      setMessages(prev => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.filter(m => m._cid !== clientMessageId) };
      });
    }

    function editQueuedMessage(sessionId, clientMessageId, newContent) {
      // Update locally
      setQueuedMessages(prev => ({
        ...prev,
        [sessionId]: (prev[sessionId] || []).map(m => m.cid === clientMessageId ? { ...m, content: newContent } : m),
      }));
      // Update the optimistic message in chat
      setMessages(prev => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.map(m => m._cid === clientMessageId ? { ...m, content: newContent } : m) };
      });
      // Tell proxy to update the queued content
      send({ type: 'edit_queued', session_id: sessionId, client_message_id: clientMessageId, content: newContent });
    }

    function handleRelayMessage(msg) {
      const t = msg.type;

      // ── Session list (legacy) ───────────────────────────────────────────────
      if (t === 'session_list') {
        setSessions(msg.sessions || []);
        (msg.sessions || []).forEach(s => {
          if (s && typeof s === 'object' && s.is_list_view) {
            const id = s.session_id;
            if (id) setMessages(prev => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          } else {
            requestHistory(s);
          }
        });
        if (Array.isArray(msg.workspaces)) setWorkspaces(msg.workspaces);
        return;
      }

      // ── Session snapshot (v1) ───────────────────────────────────────────────
      if (t === 'session_snapshot' || t === 'proxy_session_snapshot') {
        setSessions(msg.sessions || []);
        mergeSessionMetadataActivity(msg.sessions || []);
        (msg.sessions || []).forEach(s => {
          if (s && typeof s === 'object' && s.is_list_view) {
            // Panel is in list/new-chat mode — clear stale messages instead of fetching
            const id = s.session_id;
            if (id) setMessages(prev => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          } else {
            requestHistory(s);
          }
        });
        return;
      }

      // ── connection_ack may include initial session list + health snapshot ────
      if (t === 'connection_ack') {
        if (msg.sessions && msg.sessions.length > 0) {
          setSessions(msg.sessions);
          mergeSessionMetadataActivity(msg.sessions);
          msg.sessions.forEach(s => {
            if (s && typeof s === 'object' && s.is_list_view) {
              const id = s.session_id;
              if (id) setMessages(prev => {
                if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
                return prev;
              });
            } else {
              requestHistory(s);
            }
          });
        }
        if (Array.isArray(msg.workspaces)) setWorkspaces(msg.workspaces);
        if (msg.session_health) {
          const h = {};
          Object.entries(msg.session_health).forEach(([id, v]) => {
            h[id] = typeof v === 'object' ? v.health : v;
          });
          setHealth(h);
        }
        // Restore cached agent configs on (re)connect
        if (msg.agent_configs && typeof msg.agent_configs === 'object') {
          setAgentConfigs(prev => ({ ...prev, ...msg.agent_configs }));
        }
        // Restore open permission prompts on reconnect
        if (msg.open_prompts && msg.open_prompts.length > 0) {
          const restored = {};
          msg.open_prompts.forEach(p => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = { ...p, received_at: Date.now() };
          });
          setPermissionPrompts(restored);
        }
        return;
      }

      // ── Session health update ────────────────────────────────────────────────
      if (t === 'session_health') {
        const id = msg.session || msg.session_id;
        if (id) setHealth(prev => ({ ...prev, [id]: msg.health }));
        return;
      }

      // ── History snapshot (legacy + v1) ──────────────────────────────────────
      if (t === 'history' || t === 'history_snapshot') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        // Don't overwrite cleared messages for sessions in list-view mode
        const sessionObj = sessions.find(s => (typeof s === 'object' ? s.session_id : s) === id);
        if (sessionObj && typeof sessionObj === 'object' && sessionObj.is_list_view && msg.messages?.length > 0) return;
        setMessages(prev => ({ ...prev, [id]: msg.messages || [] }));
        return;
      }

      // ── History delta (v1) ──────────────────────────────────────────────────
      if (t === 'history_delta') {
        const id      = msg.session || msg.session_id;
        const newMsgs = msg.messages || msg.events || [];
        if (id) setMessages(prev => ({ ...prev, [id]: [...(prev[id] || []), ...newMsgs] }));
        return;
      }

      // ── Thinking / activity status ──────────────────────────────────────────
      if (t === 'status' || t === 'proxy_status' || t === 'session_status') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        const isThinking = msg.thinking
          || msg.activity?.kind === 'thinking'
          || msg.activity?.kind === 'generating';
        const label = msg.label || msg.activity?.label || 'Thinking';
        const activity = isThinking || msg.activity
          ? {
              kind:      msg.activity?.kind || (isThinking ? 'thinking' : 'working'),
              label,
              updatedAt: msg.activity?.updated_at || null,
            }
          : false;
        if (isThinking) {
          clearTimeout(thinkingTimers.current[id]);
          setThinking(prev => ({ ...prev, [id]: label }));
          setActivities(prev => ({ ...prev, [id]: activity }));
          // Store Claude Code thinking content text
          if (msg.thinking_content != null) {
            setThinkingContent(prev => ({ ...prev, [id]: msg.thinking_content }));
          }
        } else {
          clearTimeout(thinkingTimers.current[id]);
          thinkingTimers.current[id] = setTimeout(() => {
            setThinking(prev => ({ ...prev, [id]: false }));
            setActivities(prev => ({ ...prev, [id]: false }));
            setThinkingContent(prev => ({ ...prev, [id]: '' }));
          }, 4000);
        }
        return;
      }

      // ── Permission prompts ───────────────────────────────────────────────────
      if (t === 'permission_prompt') {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts(prev => ({ ...prev, [sid]: { ...msg, received_at: Date.now() } }));
        return;
      }

      if (t === 'permission_prompt_expired') {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
        return;
      }

      // ── Chat list (Epic 9) ──────────────────────────────────────────────────
      if (t === 'chat_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setChatLists(prev => ({ ...prev, [sid]: msg.chats || [] }));
        return;
      }

      // ── Branch list ──────────────────────────────────────────────────────
      if (t === 'branch_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setBranchLists(prev => ({ ...prev, [sid]: { branches: msg.branches || [], current: msg.current || '' } }));
        return;
      }

      // ── Thread list (Epic 2) ──────────────────────────────────────────────
      if (t === 'thread_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setThreadLists(prev => ({ ...prev, [sid]: msg.threads || [] }));
        return;
      }

      // ── Skill list (Codex Desktop) ────────────────────────────────────────
      if (t === 'skill_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setSkillLists(prev => ({ ...prev, [sid]: { installed: msg.installed || [], recommended: msg.recommended || [] } }));
        return;
      }

      // ── Terminal output (Epic 4) ──────────────────────────────────────────
      if (t === 'terminal_output') {
        const sid = msg.session_id || msg.session;
        if (sid) setTerminalOutputs(prev => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }

      // ── File changes / diff (Epic 5) ──────────────────────────────────────
      if (t === 'file_changes') {
        const sid = msg.session_id || msg.session;
        if (sid) setFileChanges(prev => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }

      // ── Agent config ─────────────────────────────────────────────────────────
      if (t === 'agent_config') {
        const sid = msg.session_id || msg.session;
        if (!sid) return;
        // Don't overwrite optimistic model change during grace period
        if (modelChangeGrace[sid] && Date.now() < modelChangeGrace[sid]) {
          // Merge but keep the optimistic model_id
          setAgentConfigs(prev => {
            const existing = prev[sid] || {};
            return { ...prev, [sid]: { ...msg, model_id: existing.model_id || msg.model_id } };
          });
          return;
        }
        delete modelChangeGrace[sid];
        setAgentConfigs(prev => ({ ...prev, [sid]: msg }));
        return;
      }

      if (t === 'agent_control_result') {
        const sid = msg.session_id || msg.session;
        if (msg.command === 'permission_response' && sid) {
          if (msg.result === 'ok') {
            setPermissionPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
          } else if (msg.result === 'failed') {
            setPermissionPrompts(prev => prev[sid]
              ? { ...prev, [sid]: { ...prev[sid], submitting_choice_id: null, error: msg.error?.message || 'Permission response failed' } }
              : prev);
          }
        }
        return;
      }

      // ── Delivery ack / failure ───────────────────────────────────────────────
      if (t === 'message_accepted') {
        const cid = msg.client_message_id;
        // Don't overwrite busy_queued or steered — those are higher-priority states
        if (cid) setDeliveryStates(prev => {
          const cur = prev[cid];
          if (cur === 'busy_queued' || cur === 'steered') return prev;
          return { ...prev, [cid]: 'accepted' };
        });
        return;
      }

      if (t === 'message_failed') {
        const cid = msg.client_message_id;
        if (cid) setDeliveryStates(prev => ({ ...prev, [cid]: 'failed' }));
        return;
      }

      // ── Steer / queue messages ──────────────────────────────────────────────
      if (t === 'message_queued') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          setDeliveryStates(prev => ({ ...prev, [cid]: 'busy_queued' }));
          if (sid) {
            setQueuedMessages(prev => ({
              ...prev,
              [sid]: [...(prev[sid] || []), { cid, content: msg.content, queuedAt: msg.queued_at }],
            }));
          }
        }
        return;
      }
      if (t === 'queue_delivered') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          setDeliveryStates(prev => ({ ...prev, [cid]: 'accepted' }));
          if (sid) setQueuedMessages(prev => ({ ...prev, [sid]: (prev[sid] || []).filter(m => m.cid !== cid) }));
        }
        return;
      }
      if (t === 'steer_result') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          setDeliveryStates(prev => ({ ...prev, [cid]: msg.result === 'ok' ? 'steered' : 'failed' }));
          if (sid) setQueuedMessages(prev => ({ ...prev, [sid]: (prev[sid] || []).filter(m => m.cid !== cid) }));
        }
        return;
      }

      // ── Rate limit / usage warning ──────────────────────────────────────────
      if (t === 'rate_limit_active') {
        const sid = msg.session_id || msg.session;
        if (sid) {
          setSessions(prev => prev.map(s =>
            sessionIdOf(s) === sid
              ? { ...(typeof s === 'object' ? s : {}), session_id: sid, rate_limited_until: msg.retry_after_hint || 'unknown', rate_limit_active: true, percent_used: msg.percent_used ?? null }
              : s
          ));
        }
        return;
      }
      if (t === 'rate_limit_cleared') {
        const sid = msg.session_id || msg.session;
        if (sid) {
          setSessions(prev => prev.map(s =>
            sessionIdOf(s) === sid
              ? { ...(typeof s === 'object' ? s : {}), session_id: sid, rate_limited_until: null, rate_limit_active: false, percent_used: null }
              : s
          ));
        }
        return;
      }

      // ── Session launch lifecycle ─────────────────────────────────────────────
      if (t === 'session_launching') {
        // Relay acknowledged the launch request; proxy is now trying to open the agent.
        // launchState already set to 'launching' on send — no change needed here.
        return;
      }

      if (t === 'session_launch_ack') {
        const reqId = msg.request_id;
        const sid   = msg.session_id || msg.session;
        if (reqId) {
          setLaunchStates(prev => {
            const { [reqId]: _removed, ...rest } = prev;
            return rest;
          });
        }
        if (sid) setJustLaunched(sid);
        return;
      }

      if (t === 'session_launch_failed') {
        const reqId = msg.request_id;
        const error = msg.reason || msg.error || 'Launch failed';
        if (reqId) {
          setLaunchStates(prev => ({
            ...prev,
            [reqId]: { ...prev[reqId], status: 'failed', error },
          }));
        }
        return;
      }

      if (t === 'session_closed') {
        const id = msg.session || msg.session_id;
        if (id) {
          setSessions(prev => prev.filter(s => (typeof s === 'string' ? s : s?.session_id) !== id));
        }
        return;
      }

      // ── Transcript message (legacy + v1) ────────────────────────────────────
      if (t === 'message' || t === 'proxy_message' || t === 'message_event') {
        const id      = msg.session || msg.session_id || msg.message?.session_id;
        const role    = msg.role    || msg.message?.role;
        const content = msg.content || msg.message?.content;
        if (!id || !role || !content) return;

        setMessages(prev => {
          const existing = prev[id] || [];
          if (role === 'user') {
            // Replace a matching optimistic message with the confirmed real one.
            // Preserve _cid and _optimistic so delivery state tracking (queued/steer)
            // continues to work after the relay echoes the message back.
            const idx = existing.findIndex(m => m._optimistic && m.content === content);
            if (idx >= 0) {
              const updated = [...existing];
              const prev_msg = existing[idx];
              updated[idx] = { role, content, _delivered: true, _cid: prev_msg._cid, _optimistic: prev_msg._optimistic };
              return { ...prev, [id]: updated };
            }
          }
          // Deduplicate: skip if any existing message already has this exact role + content
          if (existing.some(m => m.role === role && m.content === content)) {
            return prev;
          }
          return { ...prev, [id]: [...existing, { role, content, _delivered: role === 'user' }] };
        });

        if (role === 'assistant' && id !== activeSessionRef.current) {
          setUnread(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
        }
        return;
      }
    }

    return { sessions, messages, connected, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, interruptSession, agentConfigs, requestAgentConfig, setAgentModel, setAgentPermissionMode, setAntigravityMode, setCodexConfig, newThread, openPanel, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, terminalOutputs, requestFileChanges, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, launchSession, resumeSession, closeSession, activeSessionRef, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList };
  }

// (removed window.useRelay — now an ES module export)
