// app.jsx — App component and entry point
// Primary file for Agent 5 UI redesign work.

import { getLang, isTextFile, sessionLabel } from './file-utils.js';
import { MarkdownContent } from './markdown.js';
import { useRelay } from './hooks.jsx';

const { useState, useRef, useEffect } = React;

const DRAFT_STORAGE_KEY = 'remote-agent-chat:drafts:v1';
const SLASH_COMMANDS = [
  { command: '/plan', detail: 'Outline the implementation approach and major steps.' },
  { command: '/review', detail: 'Review the current changes for bugs, regressions, and missing tests.' },
  { command: '/fix', detail: 'Implement or repair the current issue.' },
  { command: '/summarize', detail: 'Summarize the current state and important changes.' },
];

// ─── Agent identity ───────────────────────────────────────────────────────────

const AGENT_CONFIG = {
  claude:            { name: 'Claude Code',      color: '#cc785c', abbr: 'CC', logo: '/logo-claude-in-ag.svg' },
  'claude-desktop':  { name: 'Claude Desktop',  color: '#cc785c', abbr: 'CD', logo: '/logo-claude-in-ag.svg' },
  codex:             { name: 'Codex',            color: '#10a37f', abbr: 'CX', logo: '/logo-codex-in-ag.svg' },
  'codex-desktop':   { name: 'Codex Desktop',   color: '#10a37f', abbr: 'CX', logo: '/logo-codex.svg' },
  gemini:            { name: 'Gemini',           color: '#4285f4', abbr: 'GC', logo: '/logo-gemini-in-ag.svg' },
  continue:          { name: 'Continue',         color: '#d29922', abbr: 'CN', logo: null },
  antigravity:       { name: 'Antigravity',      color: '#a855f7', abbr: 'AG', logo: '/logo-antigravity.svg' },
  antigravity_panel: { name: 'Antigravity Chat', color: '#a855f7', abbr: 'AC', logo: '/logo-antigravity.svg' },
};
const DEFAULT_AGENT = { name: 'Agent', color: '#8b949e', abbr: 'AG' };

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (typeof part.url === 'string') return part.url;
        if (typeof part.image_url === 'string') return part.image_url;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (typeof content.url === 'string') return content.url;
    if (typeof content.image_url === 'string') return content.image_url;
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  return '';
}

function hasVisibleMessageContent(content) {
  return normalizeMessageContent(content).trim().length > 0;
}

function isUuidLike(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function agentFromId(id) {
  if (!id) return DEFAULT_AGENT;
  const prefix = id.split('-')[0].toLowerCase();
  return AGENT_CONFIG[prefix] || DEFAULT_AGENT;
}

function sessionIdOf(sessionOrId) {
  return typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.session_id;
}

function sessionAgent(sessionOrId, agentConfig) {
  if (sessionOrId && typeof sessionOrId === 'object') {
    const type = sessionOrId.agent_type;
    return AGENT_CONFIG[type] || agentFromId(sessionOrId.session_id);
  }
  return agentFromId(sessionOrId);
}

function sessionSubLabel(sessionOrId, fallbackId, agentConfig) {
  if (sessionOrId && typeof sessionOrId === 'object') {
    // workspace_name is the clean basename resolved by the proxy (preferred over window_title
    // which is "window-1" for Claude/Codex/Gemini because the Electron parent lookup fails).
    const scopeBasename = agentConfig?.file_access_scope
      ? agentConfig.file_access_scope.replace(/\\/g, '/').split('/').filter(Boolean).pop()
      : null;
    const workspacePart = sessionOrId.workspace_name || scopeBasename || sessionOrId.window_title || sessionOrId.workspace_path || fallbackId || 'Session';
    // Append chat_title (first user message preview) when available and workspace name isn't already a full conversation title
    if (sessionOrId.chat_title && !workspacePart.includes('/')) {
      return `${workspacePart} / ${sessionOrId.chat_title}`;
    }
    return workspacePart;
  }
  const id = fallbackId || sessionOrId;
  if (typeof id !== 'string') return 'Session';
  if (isUuidLike(id)) return 'Connected session';
  const parts = id.split('-');
  return parts.slice(1).join('-') || id;
}

const HEALTH_COLOR = {
  healthy:      '#3fb950',
  degraded:     '#d29922',
  disconnected: '#f85149',
};

const ACTIVITY_META = {
  thinking:       { icon: '◌', tone: 'thinking' },
  generating:     { icon: '✦', tone: 'thinking' },
  reading_files:  { icon: '⊞', tone: 'info' },
  running_command:{ icon: '>', tone: 'info' },
  applying_patch: { icon: 'Δ', tone: 'info' },
  waiting_for_user:{ icon: '?', tone: 'idle' },
  idle:           { icon: '·', tone: 'idle' },
  working:        { icon: '•', tone: 'info' },
};

// ─── DeliveryStatus ───────────────────────────────────────────────────────────
// Shows the send lifecycle state for a user message bubble.
//   _optimistic + queued   → pulsing dots (in-flight)
//   _optimistic + accepted → ✓ (relay stored it)
//   _optimistic + failed   → ✗ with error label
//   _delivered             → ✓✓ (proxy echoed it back — confirmed in agent)
//   (historical)           → ✓

function DeliveryStatus({ msg, deliveryStates, onSteer }) {
  if (msg._optimistic) {
    const status = deliveryStates[msg._cid] || 'queued';
    if (status === 'queued')   return <span className="delivery queued"   title="Sending…">···</span>;
    if (status === 'busy_queued') return (
      <span className="delivery busy-queued" title="Agent is busy — message queued">
        <span className="queued-label">queued</span>
        {onSteer && <button className="steer-btn" onClick={(e) => { e.stopPropagation(); onSteer(msg._cid, msg.content); }} title="Inject into agent's context now">Steer ▸</button>}
      </span>
    );
    if (status === 'steered')  return <span className="delivery steered"  title="Injected into agent context">⤳</span>;
    if (status === 'accepted') return <span className="delivery accepted" title="Received by relay">✓</span>;
    if (status === 'failed')   return <span className="delivery failed"   title="Failed — agent may be offline">✕</span>;
  }
  if (msg._delivered) return <span className="delivery delivered" title="Delivered to agent">✓✓</span>;
  return <span className="delivery delivered" title="Sent">✓</span>;
}

// ─── QueuedItem — queued message with Steer, trash, and ... menu ─────────────
function QueuedItem({ qm, onSteer, onDiscard, onEdit }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(qm.content);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (editing) {
    return (
      <div className="queued-item editing">
        <textarea
          className="queued-edit-input"
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEdit(editText); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
          rows={2}
          autoFocus
        />
        <button className="steer-btn" onClick={() => { onEdit(editText); setEditing(false); }}>Save</button>
        <button className="queued-trash-btn" onClick={() => setEditing(false)} title="Cancel">✕</button>
      </div>
    );
  }

  // Native queue items (from Codex DOM) — Steer + trash (clicks Codex's native delete)
  if (qm.native) {
    return (
      <div className="queued-item native">
        <span className="queued-item-text">{qm.content.length > 80 ? qm.content.substring(0, 77) + '...' : qm.content}</span>
        <div className="queued-actions">
          <button className="steer-btn" onClick={onSteer} title="Click Steer in Codex">Steer ▸</button>
          <button className="queued-trash-btn" onClick={onDiscard} title="Delete queued message">🗑</button>
        </div>
      </div>
    );
  }

  return (
    <div className="queued-item">
      <span className="queued-item-text">{qm.content.length > 80 ? qm.content.substring(0, 77) + '...' : qm.content}</span>
      <div className="queued-actions">
        <button className="steer-btn" onClick={onSteer} title="Send to agent now">Steer ▸</button>
        <button className="queued-trash-btn" onClick={onDiscard} title="Discard message">🗑</button>
        <div className="queued-menu-wrap" ref={menuRef}>
          <button className="queued-more-btn" onClick={() => setMenuOpen(!menuOpen)} title="More options">···</button>
          {menuOpen && (
            <div className="queued-dropdown">
              <button onClick={() => { setMenuOpen(false); setEditText(qm.content); setEditing(true); }}>✏ Edit message</button>
              <button onClick={() => { setMenuOpen(false); onDiscard(); }}>🗑 Discard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SessionCard — IDE workbench style ────────────────────────────────────────
// Each card shows: colored agent badge, agent name, window label, health dot,
// and either a thinking spinner or an unread count badge.

function SessionCard({ session, health, unread, isThinking, isActive, agentConfig, activity, hasPermissionPrompt, onSelect, onClose, onAutomations, showAutomationsActive, onSkills, showSkillsActive }) {
  const sessionId = sessionIdOf(session);
  const agent    = sessionAgent(session, agentConfig);
  const winLabel = sessionSubLabel(session, sessionId, agentConfig);
  const dotColor = HEALTH_COLOR[health] || '#444c56';
  const rateLimitedUntil = session?.rate_limited_until || null;
  const isHardLimited = session?.rate_limit_active === true;
  const pctUsed = session?.percent_used;
  // Show granular activity label when thinking (Epic 8)
  const activityLabel = isThinking && activity?.label ? activity.label : null;

  return (
    <div
      className={`session-card${isActive ? ' active' : ''}${isHardLimited ? ' rate-limited' : ''}`}
      onClick={onSelect}
      title={sessionId}
    >
      <div
        className="agent-badge"
        style={{ color: agent.color, borderColor: agent.color + '55', background: agent.color + '18' }}
      >
        {agent.logo
          ? <img src={agent.logo} alt={agent.abbr} className="agent-badge-logo" />
          : agent.abbr}
      </div>
      <div className="session-card-body">
        <div className="session-card-name">{agent.name}</div>
        <div className={`session-card-sub${hasPermissionPrompt ? ' perm-active' : ''}`}>
          {hasPermissionPrompt ? 'Permission required'
            : isHardLimited ? `⏳ Rate limited${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · ${rateLimitedUntil}` : ''}`
            : pctUsed >= 80 ? `📊 ${pctUsed}% used`
            : activityLabel ? activityLabel
            : (winLabel || sessionId)}
        </div>
      </div>
      <div className="session-card-right">
        {hasPermissionPrompt && <div className="session-card-perm-badge" title="Permission required">⚠</div>}
        {isThinking  && <div className="session-card-spinner" title={activityLabel || 'Thinking…'} />}
        {!isThinking && !hasPermissionPrompt && unread > 0 && (
          <div className="session-card-badge">{unread > 99 ? '99+' : unread}</div>
        )}
        {onAutomations && (
          <button
            className={`session-card-automations${showAutomationsActive ? ' active' : ''}`}
            title="Automations"
            onClick={e => { e.stopPropagation(); onAutomations(); }}
          >⚡</button>
        )}
        {onSkills && (
          <button
            className={`session-card-automations${showSkillsActive ? ' active' : ''}`}
            title="Skills"
            onClick={e => { e.stopPropagation(); onSkills(); }}
          >⊞</button>
        )}
        <div className="session-card-health" style={{ background: dotColor }} title={health || 'unknown'} />
        <button
          className="session-card-close"
          title="Close session"
          onClick={e => { e.stopPropagation(); onClose && onClose(); }}
        >✕</button>
      </div>
    </div>
  );
}

// ─── ClaudeSpinner — replicates the Claude Code extension's thinking spinner ──
// Cycles through Unicode symbols at 120ms per frame, matching the extension exactly.
const SPINNER_SYMBOLS_FWD = ['·', '✢', '*', '✶', '✻', '✽'];
const SPINNER_SYMBOLS = [...SPINNER_SYMBOLS_FWD, ...[...SPINNER_SYMBOLS_FWD].reverse()];

function ClaudeSpinner() {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_SYMBOLS.length), 120);
    return () => clearInterval(id);
  }, []);
  return <span className="claude-spinner-icon">{SPINNER_SYMBOLS[frame]}</span>;
}

function ActivityRow({ activity, thinkingText, isClaude, pinned = false }) {
  const kind = activity?.kind || 'working';
  const meta = ACTIVITY_META[kind] || ACTIVITY_META.working;
  const isActive = meta.tone === 'thinking' || meta.tone === 'info';
  const label = activity?.label || kind.replaceAll('_', ' ');
  const isThinkingKind = kind === 'thinking' || kind === 'generating';
  const showBlob = isClaude && isThinkingKind;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={`activity-row ${meta.tone}${isActive ? ' active' : ''}${showBlob ? ' claude-thinking' : ''}${pinned ? ' pinned' : ''}`}>
      <div className="activity-icon">
        {showBlob
          ? <ClaudeSpinner />
          : isActive
            ? <div className="activity-spinner" />
            : meta.icon}
      </div>
      <div className="activity-copy">
        <div className="activity-label">{label}</div>
        {showBlob && thinkingText && (
          <div
            className={`thinking-content${expanded ? ' expanded' : ''}`}
            onClick={() => setExpanded(prev => !prev)}
            title={expanded ? 'Click to collapse' : 'Click to expand thinking text'}
          >
            <div className="thinking-content-text">{thinkingText}</div>
          </div>
        )}
        {!showBlob && isActive && thinkingText && (
          <div className="activity-command">
            <code>{thinkingText}</code>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskList({ taskList }) {
  if (!taskList || !taskList.tasks || taskList.tasks.length === 0) return null;
  const stateIcon = { completed: '\u2713', in_progress: '\u25CC', pending: '\u25CB' };
  const stateCls = { completed: 'done', in_progress: 'active', pending: '' };
  return (
    <div className="codex-task-list">
      <div className="codex-task-header">{taskList.completed}/{taskList.total} tasks</div>
      {taskList.tasks.map((t, i) => (
        <div key={i} className={`codex-task-item ${stateCls[t.state] || ''}`}>
          <span className="codex-task-icon">{stateIcon[t.state] || '\u25CB'}</span>
          <span className="codex-task-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function promptChoiceId(choice, index) {
  return choice?.choice_id || choice?.id || choice?.value || `choice-${index}`;
}

function promptChoiceLabel(choice, index) {
  return choice?.label || choice?.title || choice?.text || choice?.name || promptChoiceId(choice, index);
}

function promptBody(prompt) {
  return prompt?.prompt_text || prompt?.message || prompt?.text || 'Agent requires permission to continue.';
}

function formatPromptCountdown(msLeft) {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function PermissionOverlay({ prompt, sessionId, onRespond }) {
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const timeoutMs = Math.max(0, Number(prompt?.timeout_ms) || 0);
  const receivedAt = Number(prompt?.received_at) || Date.now();
  const msLeft = timeoutMs > 0 ? Math.max(0, timeoutMs - (now - receivedAt)) : 0;
  const choices = Array.isArray(prompt?.choices) ? prompt.choices : [];
  const submittingChoiceId = prompt?.submitting_choice_id || null;
  const defaultChoiceId = prompt?.default_choice || null;

  return (
    <div className="permission-overlay">
      <div className="permission-card">
        <div className="permission-eyebrow">Permission Required</div>
        <div className="permission-title">Agent Paused In {sessionId ? sessionSubLabel(sessionId, sessionId) : 'Active Session'}</div>
        <div className="permission-body">{promptBody(prompt)}</div>
        <div className="permission-meta">
          {timeoutMs > 0 && <span className="permission-timer">Auto-choice in {formatPromptCountdown(msLeft)}</span>}
          {defaultChoiceId && <span className="permission-default">Default: {defaultChoiceId}</span>}
        </div>
        {prompt?.error && <div className="permission-error">{prompt.error}</div>}
        <div className="permission-actions">
          {choices.map((choice, index) => {
            const choiceId = promptChoiceId(choice, index);
            const isPending = submittingChoiceId === choiceId;
            const isDefault = defaultChoiceId && defaultChoiceId === choiceId;
            return (
              <button
                key={choiceId}
                className={`permission-action${isDefault ? ' default' : ''}${isPending ? ' pending' : ''}`}
                disabled={!!submittingChoiceId}
                onClick={() => onRespond(sessionId, prompt.prompt_id, choiceId)}
              >
                <span>{promptChoiceLabel(choice, index)}</span>
                {isPending && <span className="permission-action-state">Sending...</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── NewSessionPanel ──────────────────────────────────────────────────────────
// Slide-in panel in the sidebar for launching a new agent session or resuming
// a previous session from conversation history.

function NewSessionPanel({ launchStates, onLaunch, onResume, onClose, workspaces }) {
  const [mode,        setMode]        = React.useState('new');   // 'new' | 'resume'
  const [agentType,   setAgentType]   = React.useState('claude');
  const [wsMode,      setWsMode]      = React.useState('');
  const [customPath,  setCustomPath]  = React.useState('');
  const [requestId,   setRequestId]   = React.useState(null);
  const [history,     setHistory]     = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const currentLaunch = requestId ? launchStates[requestId] : null;
  const isLaunching   = currentLaunch?.status === 'launching';
  const launchError   = currentLaunch?.status === 'failed' ? currentLaunch.error : null;
  const hasWorkspaces = (workspaces || []).length > 0;

  React.useEffect(() => {
    if (requestId && !launchStates[requestId]) onClose();
  }, [launchStates, requestId]);

  // Fetch session history when switching to resume mode
  React.useEffect(() => {
    if (mode === 'resume' && history.length === 0 && !historyLoading) {
      setHistoryLoading(true);
      fetch('/api/sessions/history?limit=30', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => setHistory(data.sessions || []))
        .catch(() => setHistory([]))
        .finally(() => setHistoryLoading(false));
    }
  }, [mode]);

  function handleSubmit(e) {
    e.preventDefault();
    if (isLaunching) return;
    const wsPath = wsMode === 'custom' ? customPath.trim() : wsMode;
    const rid = onLaunch(agentType, wsPath || undefined);
    setRequestId(rid);
  }

  function handleResume(session) {
    if (isLaunching) return;
    // Use the session's stored workspace, falling back to the dropdown selection
    const wsPath = session.workspace_path
      || (wsMode === 'custom' ? customPath.trim() : wsMode)
      || undefined;
    const rid = onResume(session.session_id, agentType, wsPath);
    setRequestId(rid);
  }

  function timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins  = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="new-session-panel">
      <div className="new-session-header">
        <span>{mode === 'new' ? 'New Session' : 'Resume Session'}</span>
        <button className="new-session-close" onClick={onClose} title="Cancel">✕</button>
      </div>

      {/* Tab switcher */}
      <div className="new-session-tabs">
        <button
          className={`new-session-tab${mode === 'new' ? ' active' : ''}`}
          onClick={() => setMode('new')}
        >New</button>
        <button
          className={`new-session-tab${mode === 'resume' ? ' active' : ''}`}
          onClick={() => setMode('resume')}
        >Resume</button>
      </div>

      {mode === 'new' ? (
        <form className="new-session-form" onSubmit={handleSubmit}>
          <div className="new-session-agents">
            {Object.entries(AGENT_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                className={`new-session-agent-btn${agentType === key ? ' selected' : ''}`}
                style={agentType === key ? { borderColor: cfg.color, color: cfg.color, background: cfg.color + '18' } : {}}
                onClick={() => setAgentType(key)}
              >
                <span className="agent-badge new-session-badge" style={{ color: cfg.color, borderColor: cfg.color + '55', background: cfg.color + '18' }}>{cfg.abbr}</span>
                <span className="new-session-agent-name">{cfg.name}</span>
              </button>
            ))}
          </div>
          {hasWorkspaces ? (
            <>
              <select
                className="new-session-workspace"
                value={wsMode}
                onChange={e => setWsMode(e.target.value)}
                disabled={isLaunching}
              >
                <option value="">No workspace (default)</option>
                {workspaces.map((w, i) => (
                  <option key={i} value={w.path || w.title}>{w.title}</option>
                ))}
                <option value="custom">Custom path…</option>
              </select>
              {wsMode === 'custom' && (
                <input
                  className="new-session-workspace"
                  type="text"
                  placeholder="Enter workspace path"
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  disabled={isLaunching}
                  autoFocus
                />
              )}
            </>
          ) : (
            <input
              className="new-session-workspace"
              type="text"
              placeholder="Workspace path (optional)"
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              disabled={isLaunching}
            />
          )}
          {launchError && <div className="new-session-error">{launchError}</div>}
          <button className="new-session-submit" type="submit" disabled={isLaunching}>
            {isLaunching ? <span className="new-session-spinner" /> : null}
            {isLaunching ? 'Launching…' : 'Launch'}
          </button>
        </form>
      ) : (
        <div className="new-session-form">
          {/* Agent type selector for the resumed session */}
          <div className="new-session-agents">
            {Object.entries(AGENT_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                className={`new-session-agent-btn${agentType === key ? ' selected' : ''}`}
                style={agentType === key ? { borderColor: cfg.color, color: cfg.color, background: cfg.color + '18' } : {}}
                onClick={() => setAgentType(key)}
              >
                <span className="agent-badge new-session-badge" style={{ color: cfg.color, borderColor: cfg.color + '55', background: cfg.color + '18' }}>{cfg.abbr}</span>
                <span className="new-session-agent-name">{cfg.name}</span>
              </button>
            ))}
          </div>

          {launchError && <div className="new-session-error">{launchError}</div>}

          {historyLoading ? (
            <div className="session-history-loading"><span className="new-session-spinner" /> Loading history…</div>
          ) : history.length === 0 ? (
            <div className="session-history-empty">No past sessions found</div>
          ) : (
            <div className="session-history-list">
              {history.map(s => (
                <button
                  key={s.session_id}
                  className="session-history-item"
                  onClick={() => handleResume(s)}
                  disabled={isLaunching}
                >
                  <div className="session-history-preview">{s.preview || '(empty session)'}</div>
                  <div className="session-history-meta">
                    <span>{s.message_count} msg{s.message_count !== 1 ? 's' : ''}</span>
                    {s.workspace_name && <span className="session-history-workspace" title={s.workspace_path || ''}>{s.workspace_name}</span>}
                    <span>{timeAgo(s.last_active_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AgentSettingsPanel ───────────────────────────────────────────────────────
// Slide-out panel showing the active session's model, permission mode, and
// workspace.  Allows changing the model on Claude sessions.

const PERMISSION_MODES = {
  claude: [
    { value: 'bypassPermissions', label: 'Bypass (allow all)' },
    { value: 'default',           label: 'Default (ask each time)' },
  ],
  codex:  [],  // Codex permission mode not configurable via settings
  gemini: [],  // Gemini permission mode not configurable via settings
};

const KNOWN_CLAUDE_MODELS = [
  { id: 'default',                 label: 'Auto' },
  { id: 'claude-opus-4-6',         label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6',       label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-5',         label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5',       label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5',        label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-0',         label: 'Claude Opus 4' },
  { id: 'claude-sonnet-4-0',       label: 'Claude Sonnet 4' },
  { id: 'claude-3-7-sonnet',       label: 'Claude 3.7 Sonnet' },
  { id: 'claude-3-5-sonnet',       label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku',        label: 'Claude 3.5 Haiku' },
];

const ANTIGRAVITY_MODES = [
  { id: 'Planning', label: 'Planning' },
  { id: 'Fast',     label: 'Fast' },
];

const KNOWN_ANTIGRAVITY_MODELS = [
  { id: 'Gemini 3.1 Pro (High)',        label: 'Gemini 3.1 Pro (High)' },
  { id: 'Gemini 3.1 Pro (Low)',         label: 'Gemini 3.1 Pro (Low)' },
  { id: 'Gemini 3 Flash',               label: 'Gemini 3 Flash' },
  { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'Claude Opus 4.6 (Thinking)',   label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'GPT-OSS 120B (Medium)',        label: 'GPT-OSS 120B (Medium)' },
];

// Gemini Code Assist model configs (confirmed live from mat-select options)
const KNOWN_GEMINI_MODELS = [
  { id: 'Default',          label: 'Default' },
  { id: '2.5 Flash',        label: 'Gemini 2.5 Flash' },
  { id: '2.5 Pro',          label: 'Gemini 2.5 Pro' },
  { id: '3 Flash Preview',  label: 'Gemini 3 Flash Preview' },
  { id: '3.1 Pro Preview',  label: 'Gemini 3.1 Pro Preview' },
];

function AgentSettingsPanel({ session, config, onRequestRefresh, onSetModel, onSetPermissionMode, onSetMode, onSetCodexConfig, onSwitchWorkspace, onClose }) {
  const [pendingModel, setPendingModel] = React.useState(null);
  const [modelOk, setModelOk]           = React.useState(null);
  const [pendingPerm, setPendingPerm]   = React.useState(null);
  const [permOk, setPermOk]             = React.useState(null);
  const [pendingMode, setPendingMode]   = React.useState(null);
  const [modeOk, setModeOk]             = React.useState(null);
  const [codexOk, setCodexOk]           = React.useState(null);

  const sessionId    = sessionIdOf(session);
  const agentType    = (session && typeof session === 'object') ? session.agent_type : null;
  const caps         = config?.capabilities || {};
  const currentModel   = config?.model_id || 'unknown';
  const rateLimitedUntil = (session && typeof session === 'object') ? session.rate_limited_until || null : null;
  const permMode       = config?.permission_mode || 'unknown';
  const convMode       = config?.conversation_mode || 'unknown';
  const effortLevel    = config?.effort || null;
  const fileScope    = config?.file_access_scope || 'unknown';
  const permModes    = PERMISSION_MODES[agentType] || [];
  const modelOptions = agentType === 'claude' ? KNOWN_CLAUDE_MODELS
    : (agentType === 'antigravity' || agentType === 'antigravity_panel') ? KNOWN_ANTIGRAVITY_MODELS
    : agentType === 'gemini' ? KNOWN_GEMINI_MODELS
    : [];

  React.useEffect(() => {
    if (sessionId) onRequestRefresh(sessionId);
  }, [sessionId]);

  function handleModelChange(modelId) {
    if (!modelId || modelId === currentModel) return;
    setModelOk(null);
    setPendingModel(modelId);
    onSetModel(sessionId, modelId);
  }

  function handlePermModeChange(mode) {
    if (!mode || mode === permMode) return;
    setPermOk(null);
    setPendingPerm(mode);
    onSetPermissionMode(sessionId, mode);
  }

  function handleModeChange(mode) {
    if (!mode || mode === convMode) return;
    setModeOk(null);
    setPendingMode(mode);
    onSetMode && onSetMode(sessionId, mode);
  }

  // Clear pending states when config updates confirm the change
  React.useEffect(() => {
    if (pendingModel && config?.model_id && config.model_id !== 'unknown') {
      setModelOk(`Model set to ${config.model_id}`);
      setPendingModel(null);
      setTimeout(() => setModelOk(null), 3000);
    }
  }, [config?.model_id]);

  React.useEffect(() => {
    if (pendingPerm && config?.permission_mode && config.permission_mode === pendingPerm) {
      setPermOk(`Saved`);
      setPendingPerm(null);
      setTimeout(() => setPermOk(null), 2000);
    }
  }, [config?.permission_mode]);

  React.useEffect(() => {
    if (pendingMode && config?.conversation_mode && config.conversation_mode === pendingMode) {
      setModeOk('Saved');
      setPendingMode(null);
      setTimeout(() => setModeOk(null), 2000);
    }
  }, [config?.conversation_mode]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <span>Session Settings</span>
        <button className="settings-panel-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="settings-panel-body">

        {/* Rate limit warning banner — shown above model when limited */}
        {rateLimitedUntil && (
          <div className="settings-rl-banner">
            <span className="settings-rl-icon">⚠</span>
            <span className="settings-rl-text">
              Rate limited
              {rateLimitedUntil !== 'unknown'
                ? <> — available after <strong>{rateLimitedUntil}</strong></>
                : <> — reset time unknown</>}
            </span>
          </div>
        )}

        {/* Model — dropdown for Claude, read-only for others */}
        <div className="settings-row">
          <span className="settings-label">Model</span>
          <div className="settings-model-wrap">
            {caps.set_model && modelOptions.length > 0 ? (
              <select
                className="settings-perm-select"
                value={currentModel}
                disabled={!!pendingModel}
                onChange={e => handleModelChange(e.target.value)}
              >
                {modelOptions.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {agentType !== 'antigravity' && agentType !== 'gemini' && !modelOptions.some(m => m.id === currentModel) && currentModel !== 'unknown' && (
                  <option value={currentModel}>{currentModel}</option>
                )}
              </select>
            ) : (
              <span className={`settings-value${currentModel === 'unknown' ? ' dim' : ''}`}>{currentModel}</span>
            )}
            {rateLimitedUntil && (
              <span
                className="model-rl-badge"
                title={`Rate limited${rateLimitedUntil !== 'unknown' ? ` — resets at ${rateLimitedUntil}` : ''}`}
              >⚠</span>
            )}
          </div>
          {modelOk && <span className="settings-inline-ok">{modelOk}</span>}
        </div>

        {/* Conversation mode — Antigravity only (Planning | Fast) */}
        {(agentType === 'antigravity' || agentType === 'antigravity_panel') && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <select
              className="settings-perm-select"
              value={convMode === 'unknown' ? 'Planning' : convMode}
              disabled={!!pendingMode}
              onChange={e => handleModeChange(e.target.value)}
            >
              {ANTIGRAVITY_MODES.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {modeOk && <span className="settings-inline-ok">{modeOk}</span>}
          </div>
        )}

        {/* Permission mode — Claude dropdown, Codex handled separately below */}
        {agentType === 'claude' && (
          <div className="settings-row">
            <span className="settings-label">Permission mode</span>
            {caps.permission_mode_change && permModes.length > 0 ? (
              <select
                className="settings-perm-select"
                value={permMode}
                disabled={!!pendingPerm}
                onChange={e => handlePermModeChange(e.target.value)}
              >
                {permModes.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                {!permModes.some(m => m.value === permMode) && permMode !== 'unknown' && (
                  <option value={permMode}>{permMode}</option>
                )}
              </select>
            ) : (
              <span className={`settings-value${permMode === 'unknown' ? ' dim' : ''}`}>{permMode}</span>
            )}
            {permOk && <span className="settings-inline-ok">{permOk}</span>}
          </div>
        )}

        {/* Codex-specific: model, access, effort dropdowns */}
        {(agentType === 'codex' || agentType === 'codex-desktop') && caps.set_codex_config && (
          <>
            <div className="settings-row">
              <span className="settings-label">Model</span>
              <select
                className="settings-perm-select"
                value={config?.model_id || 'unknown'}
                onChange={e => { onSetCodexConfig && onSetCodexConfig({ model_id: e.target.value }); setCodexOk(agentType === 'codex-desktop' ? 'Saved' : 'Saved — restart Codex to apply'); setTimeout(() => setCodexOk(null), 3000); }}
              >
                {(config?.available_models || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {config?.model_id && !(config?.available_models || []).some(m => m.id === config.model_id) && config.model_id !== 'unknown' && (
                  <option value={config.model_id}>{config.model_id}</option>
                )}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-label">Access</span>
              <select
                className="settings-perm-select"
                value={config?.permission_mode || 'unknown'}
                onChange={e => { onSetCodexConfig && onSetCodexConfig({ access_mode: e.target.value }); setCodexOk(agentType === 'codex-desktop' ? 'Saved' : 'Saved — restart Codex to apply'); setTimeout(() => setCodexOk(null), 3000); }}
              >
                {(config?.available_access || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {config?.permission_mode && !(config?.available_access || []).some(m => m.id === config.permission_mode) && config.permission_mode !== 'unknown' && (
                  <option value={config.permission_mode}>{config.permission_mode}</option>
                )}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-label">Effort</span>
              <select
                className="settings-perm-select"
                value={(config?.effort || 'unknown').toLowerCase()}
                onChange={e => { onSetCodexConfig && onSetCodexConfig({ effort: e.target.value }); setCodexOk(agentType === 'codex-desktop' ? 'Saved' : 'Saved — restart Codex to apply'); setTimeout(() => setCodexOk(null), 3000); }}
              >
                {(config?.available_efforts || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            {agentType === 'codex-desktop' && config?.branch && config.branch !== 'unknown' && (
              <div className="settings-row">
                <span className="settings-label">Branch</span>
                <span className="settings-value">{config.branch}</span>
              </div>
            )}
            {agentType === 'codex-desktop' && config?.sandbox_status && (
              <div className="settings-row">
                <span className="settings-label">Sandbox</span>
                <span className={`settings-value${config.sandbox_status.active ? '' : ' dim'}`}>
                  {config.sandbox_status.active ? '🟢' : '⚪'} {config.sandbox_status.label || (config.sandbox_status.active ? 'Active' : 'Inactive')}
                </span>
              </div>
            )}
            {agentType === 'codex-desktop' && (config?.available_workspaces || []).length > 0 && (
              <div className="settings-row">
                <span className="settings-label">Workspace</span>
                <select
                  className="settings-perm-select"
                  value={config?.file_access_scope || ''}
                  onChange={e => {
                    if (onSwitchWorkspace) {
                      onSwitchWorkspace(sessionId, e.target.value);
                      setCodexOk('Switching workspace…');
                      setTimeout(() => setCodexOk(null), 5000);
                    }
                  }}
                >
                  {(config.available_workspaces || []).map(m => (
                    <option key={m.id} value={m.path || m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {codexOk && <div className="settings-row"><span className="settings-inline-ok">{codexOk}</span></div>}
          </>
        )}
        {(agentType === 'codex' || agentType === 'codex-desktop') && !caps.set_codex_config && (
          <div className="settings-row">
            <span className="settings-label">Access</span>
            <span className={`settings-value${permMode === 'unknown' ? ' dim' : ''}`}>{permMode}</span>
          </div>
        )}

        {/* Continue-specific: mode (read-only, configured in Continue UI) */}
        {agentType === 'continue' && config?.mode && config.mode !== 'unknown' && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <span className="settings-value">{config.mode}</span>
          </div>
        )}

        {/* Workspace */}
        {(() => {
          const workspaceDisplay = fileScope !== 'unknown'
            ? fileScope
            : (session?.workspace_name || session?.window_title || null);
          return (
            <div className="settings-row">
              <span className="settings-label">Workspace</span>
              <span
                className={`settings-value small${!workspaceDisplay ? ' dim' : ''}`}
                title={workspaceDisplay || ''}
              >
                {workspaceDisplay
                  ? (fileScope !== 'unknown' ? workspaceDisplay.split(/[\\/]/).pop() || workspaceDisplay : workspaceDisplay)
                  : '—'}
              </span>
            </div>
          );
        })()}

      </div>
      <div className="settings-panel-footer">
        <button className="settings-refresh" onClick={() => { if (sessionId) onRequestRefresh(sessionId); }}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}

// ─── Chat list panel (Epic 9) ─────────────────────────────────────────────────
// Collapsible panel showing Codex conversations with switch/new actions.
function ChatListPanel({ chats, sessionId, onSwitch, onNew, onClose }) {
  return (
    <div className="chat-list-panel">
      <div className="chat-list-header">
        <span className="chat-list-title">Conversations</span>
        <button className="chat-list-new-btn" onClick={onNew} title="New conversation">+</button>
        <button className="chat-list-close-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="chat-list-body">
        {(!chats || chats.length === 0) ? (
          <div className="chat-list-empty">No conversations found</div>
        ) : (
          chats.map((chat, i) => (
            <button
              key={chat.id || i}
              className={`chat-list-item${chat.active ? ' active' : ''}`}
              onClick={() => onSwitch(chat.id)}
              title={chat.title}
            >
              <span className="chat-list-item-title">{chat.title}</span>
              {chat.active && <span className="chat-list-item-active">●</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Thread history panel (Epic 2) ────────────────────────────────────────────
// Collapsible panel showing Codex Desktop threads with switch/new actions.
// Reuses the same visual style as ChatListPanel.
function ThreadHistoryPanel({ threads, sessionId, onSwitch, onNew, onClose }) {
  return (
    <div className="chat-list-panel">
      <div className="chat-list-header">
        <span className="chat-list-title">Threads</span>
        <button className="chat-list-new-btn" onClick={onNew} title="New thread">+</button>
        <button className="chat-list-close-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="chat-list-body">
        {(!threads || threads.length === 0) ? (
          <div className="chat-list-empty">No threads found</div>
        ) : (
          threads.map((thread, i) => (
            <button
              key={thread.id || i}
              className={`chat-list-item${thread.active ? ' active' : ''}`}
              onClick={() => onSwitch(thread.id)}
              title={thread.title}
            >
              <span className="chat-list-item-title">{thread.title}</span>
              {thread.age && <span className="chat-list-item-age">{thread.age}</span>}
              {thread.active && <span className="chat-list-item-active">●</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Branch selector panel ─────────────────────────────────────────────────────
// Dropdown showing git branches with search, current indicator, and create-new.
function BranchSelectorPanel({ branchData, sessionId, currentBranch, onSwitch, onCreate, onClose }) {
  const [search, setSearch] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const branches = branchData?.branches || [];
  const current = branchData?.current || currentBranch || '';
  const filtered = search
    ? branches.filter(b => b.toLowerCase().includes(search.toLowerCase()))
    : branches;

  return (
    <div className="branch-selector-panel">
      <div className="branch-selector-header">
        <span className="branch-selector-title">Branches</span>
        <button className="chat-list-close-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="branch-selector-search">
        <input
          type="text"
          className="branch-search-input"
          placeholder="Search branches…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="branch-selector-body">
        {filtered.length === 0 && !creating && (
          <div className="chat-list-empty">No branches found</div>
        )}
        {filtered.map((branch, i) => (
          <button
            key={branch}
            className={`branch-item${branch === current ? ' active' : ''}`}
            onClick={() => { if (branch !== current) onSwitch(branch); }}
            title={branch}
          >
            <span className="branch-item-icon">{branch === current ? '✓' : ''}</span>
            <span className="branch-item-name">{branch}</span>
          </button>
        ))}
      </div>
      <div className="branch-selector-footer">
        {creating ? (
          <form className="branch-create-form" onSubmit={e => {
            e.preventDefault();
            if (newName.trim()) { onCreate(newName.trim()); setCreating(false); setNewName(''); }
          }}>
            <input
              type="text"
              className="branch-create-input"
              placeholder="new-branch-name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
            <button type="submit" className="branch-create-submit" disabled={!newName.trim()}>Create</button>
            <button type="button" className="branch-create-cancel" onClick={() => { setCreating(false); setNewName(''); }}>✕</button>
          </form>
        ) : (
          <button className="branch-create-btn" onClick={() => setCreating(true)}>
            + Create and checkout new branch
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Terminal viewer (Epic 4) ──────────────────────────────────────────────────
// Collapsible panel showing terminal/command output from Codex sessions.
function TerminalViewer({ entries, onClose, onRefresh }) {
  return (
    <div className="terminal-viewer">
      <div className="terminal-viewer-header">
        <span className="terminal-viewer-title">Terminal Output</span>
        <button className="terminal-viewer-refresh" onClick={onRefresh} title="Refresh">↻</button>
        <button className="terminal-viewer-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="terminal-viewer-body">
        {(!entries || entries.length === 0) ? (
          <div className="terminal-viewer-empty">No terminal output captured</div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="terminal-entry">
              {entry.command && (
                <div className="terminal-command">$ {entry.command}</div>
              )}
              <pre className="terminal-output">{entry.output}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiffViewer({ entries, onClose, onRefresh }) {
  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-viewer-title">File Changes</span>
        <button className="diff-viewer-refresh" onClick={onRefresh} title="Refresh">↻</button>
        <button className="diff-viewer-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="diff-viewer-body">
        {(!entries || entries.length === 0) ? (
          <div className="diff-viewer-empty">No file changes detected</div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="diff-entry">
              {entry.file && (
                <div className="diff-file-header">{entry.file}</div>
              )}
              <pre className="diff-content">{entry.content ? entry.content.split('\n').map((line, li) => {
                const cls = line.startsWith('+') ? 'diff-add' :
                            line.startsWith('-') ? 'diff-del' :
                            line.startsWith('@@') ? 'diff-hunk' : '';
                return <span key={li} className={cls}>{line}{'\n'}</span>;
              }) : 'No content'}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── File Browser + Markdown Viewer ─────────────────────────────────────────

const FILE_ICONS = {
  directory: '📁',
  md: '📄', txt: '📄', json: '📋', js: '📜', jsx: '📜', ts: '📜', tsx: '📜',
  py: '🐍', html: '🌐', css: '🎨', yml: '⚙', yaml: '⚙', toml: '⚙',
  sh: '⚡', bat: '⚡', ps1: '⚡', env: '🔒', lock: '🔒',
  png: '🖼', jpg: '🖼', gif: '🖼', svg: '🖼',
  default: '📄',
};

function getFileIcon(entry) {
  if (entry.type === 'directory') return FILE_ICONS.directory;
  const ext = entry.name.split('.').pop().toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Text file extensions that can be viewed
const VIEWABLE_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css',
  'yml', 'yaml', 'toml', 'sh', 'bat', 'ps1', 'cfg', 'conf', 'ini',
  'xml', 'csv', 'log', 'env', 'gitignore', 'dockerignore', 'sql',
  'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'php', 'swift',
  'kt', 'scala', 'r', 'lua', 'vim', 'zsh', 'bash', 'fish',
]);

function isViewableFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  // Also handle dotfiles like .gitignore, .env
  return VIEWABLE_EXTENSIONS.has(ext) || name.startsWith('.');
}

function isMarkdownFile(name) {
  return name.toLowerCase().endsWith('.md');
}

function MarkdownViewer({ path: filePath, content, truncated, onBack }) {
  const rendered = React.useMemo(() => {
    if (!content) return '';
    try {
      const html = marked.parse(content);
      return DOMPurify.sanitize(html);
    } catch (e) {
      return `<pre>${DOMPurify.sanitize(content)}</pre>`;
    }
  }, [content]);

  // Highlight code blocks after render
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
      });
    }
  }, [rendered]);

  const fileName = filePath ? filePath.split('/').pop().split('\\').pop() : 'File';

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <button className="file-viewer-back" onClick={onBack} title="Back to files">←</button>
        <span className="file-viewer-title" title={filePath}>{fileName}</span>
        {truncated && <span className="file-viewer-truncated">truncated</span>}
      </div>
      <div className="file-viewer-body markdown-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: rendered }} />
    </div>
  );
}

function PlainFileViewer({ path: filePath, content, truncated, onBack }) {
  const fileName = filePath ? filePath.split('/').pop().split('\\').pop() : 'File';
  const ext = fileName.split('.').pop().toLowerCase();

  const highlighted = React.useMemo(() => {
    if (!content) return '';
    try {
      if (ext && hljs.getLanguage(ext)) {
        return hljs.highlight(content, { language: ext }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch (e) {
      return DOMPurify.sanitize(content);
    }
  }, [content, ext]);

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <button className="file-viewer-back" onClick={onBack} title="Back to files">←</button>
        <span className="file-viewer-title" title={filePath}>{fileName}</span>
        {truncated && <span className="file-viewer-truncated">truncated</span>}
      </div>
      <div className="file-viewer-body">
        <pre className="file-viewer-code"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      </div>
    </div>
  );
}

function FileBrowser({ sessionId, listing, fileContents, onNavigate, onOpenFile, onClose, onRefresh, viewingFile, onBackToListing }) {
  // If viewing a file, show the appropriate viewer
  if (viewingFile) {
    const key = `${sessionId}:${viewingFile}`;
    const fileData = fileContents[key];
    const content = fileData?.content || '';
    const truncated = fileData?.truncated || false;

    if (isMarkdownFile(viewingFile)) {
      return <MarkdownViewer path={viewingFile} content={content} truncated={truncated} onBack={onBackToListing} />;
    }
    return <PlainFileViewer path={viewingFile} content={content} truncated={truncated} onBack={onBackToListing} />;
  }

  // Directory listing view
  const entries = listing?.entries || [];
  const currentPath = listing?.path || '.';
  const pathParts = currentPath === '.' ? [] : currentPath.replace(/\\/g, '/').split('/').filter(Boolean);

  return (
    <div className="file-browser">
      <div className="file-browser-header">
        <span className="file-browser-title">Files</span>
        <button className="file-browser-refresh" onClick={onRefresh} title="Refresh">↻</button>
        <button className="file-browser-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="file-browser-breadcrumbs">
        <button className="breadcrumb-item" onClick={() => onNavigate('.')}>root</button>
        {pathParts.map((part, i) => {
          const subPath = pathParts.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={subPath}>
              <span className="breadcrumb-sep">/</span>
              <button className="breadcrumb-item" onClick={() => onNavigate(subPath)}>{part}</button>
            </React.Fragment>
          );
        })}
      </div>
      <div className="file-browser-body">
        {entries.length === 0 ? (
          <div className="file-browser-empty">Empty directory</div>
        ) : (
          <div className="file-browser-list">
            {currentPath !== '.' && (
              <div className="file-browser-entry" onClick={() => {
                const parent = pathParts.slice(0, -1).join('/') || '.';
                onNavigate(parent);
              }}>
                <span className="file-entry-icon">📁</span>
                <span className="file-entry-name">..</span>
              </div>
            )}
            {entries.map(entry => (
              <div
                key={entry.name}
                className={`file-browser-entry${entry.type === 'directory' ? ' is-dir' : ''}${isViewableFile(entry.name) ? ' is-viewable' : ''}`}
                onClick={() => {
                  if (entry.type === 'directory') {
                    const newPath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
                    onNavigate(newPath);
                  } else if (isViewableFile(entry.name)) {
                    const filePath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
                    onOpenFile(filePath);
                  }
                }}
              >
                <span className="file-entry-icon">{getFileIcon(entry)}</span>
                <span className="file-entry-name">{entry.name}</span>
                <span className="file-entry-meta">
                  {entry.type === 'file' && formatFileSize(entry.size)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Automations View ───────────────────────────────────────────────────────
// Mirrors the Codex Desktop Automations UI: category-grouped cards with
// create/edit modal and manual trigger.

const SCHEDULE_LABELS = {
  daily:    'Daily',
  weekdays: 'Weekdays',
  weekly:   'Weekly',
  custom:   'Custom',
};

const CATEGORY_ICONS = {
  'Status reports': '📊',
  'Release prep':   '🚀',
  'Code quality':   '🔍',
  'Documentation':  '📝',
  'General':        '⚙',
};

function AutomationCard({ automation, onEdit, onRun, onToggle }) {
  const icon = CATEGORY_ICONS[automation.category] || '⚙';
  const scheduleLabel = SCHEDULE_LABELS[automation.schedule] || automation.schedule;
  const agentCfg = AGENT_CONFIG[automation.target_agent_type] || DEFAULT_AGENT;

  return (
    <div className={`automation-card${automation.enabled ? '' : ' disabled'}`} onClick={() => onEdit(automation)}>
      <div className="automation-card-icon">{icon}</div>
      <div className="automation-card-body">
        <div className="automation-card-name">{automation.name}</div>
        {automation.description && (
          <div className="automation-card-desc">{automation.description}</div>
        )}
      </div>
      <div className="automation-card-meta">
        <span
          className="automation-card-agent"
          style={{ color: agentCfg.color }}
          title={agentCfg.name}
        >{agentCfg.abbr}</span>
        <span className="automation-card-schedule">{scheduleLabel} {String(automation.cron_hour).padStart(2, '0')}:{String(automation.cron_minute).padStart(2, '0')}</span>
      </div>
      <div className="automation-card-actions" onClick={e => e.stopPropagation()}>
        <button
          className="automation-run-btn"
          title="Run now"
          onClick={() => onRun(automation)}
        >▶</button>
        <button
          className={`automation-toggle-btn${automation.enabled ? ' on' : ''}`}
          title={automation.enabled ? 'Disable' : 'Enable'}
          onClick={() => onToggle(automation)}
        >{automation.enabled ? '●' : '○'}</button>
      </div>
    </div>
  );
}

function AutomationModal({ automation, sessions, onSave, onDelete, onClose }) {
  const isNew = !automation?.id;
  const [form, setForm] = useState({
    name:              automation?.name || '',
    description:       automation?.description || '',
    category:          automation?.category || 'General',
    prompt:            automation?.prompt || '',
    schedule:          automation?.schedule || 'daily',
    cron_hour:         automation?.cron_hour ?? 9,
    cron_minute:       automation?.cron_minute ?? 0,
    cron_days:         automation?.cron_days || [1,2,3,4,5],
    target_agent_type: automation?.target_agent_type || 'claude',
    target_session:    automation?.target_session || '',
    enabled:           automation?.enabled !== false,
  });
  const [saving, setSaving] = useState(false);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleDay(day) {
    setForm(prev => {
      const days = prev.cron_days.includes(day)
        ? prev.cron_days.filter(d => d !== day)
        : [...prev.cron_days, day].sort();
      return { ...prev, cron_days: days };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.prompt.trim()) return;
    setSaving(true);
    await onSave({ ...form, target_session: form.target_session || null });
    setSaving(false);
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="automation-modal-overlay" onClick={onClose}>
      <div className="automation-modal" onClick={e => e.stopPropagation()}>
        <div className="automation-modal-header">
          <span>{isNew ? 'New Automation' : 'Edit Automation'}</span>
          <button className="automation-modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="automation-modal-form" onSubmit={handleSubmit}>
          <label>
            <span>Name</span>
            <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Daily standup summary" required />
          </label>
          <label>
            <span>Description</span>
            <input type="text" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Brief description (optional)" />
          </label>
          <label>
            <span>Category</span>
            <select value={form.category} onChange={e => setField('category', e.target.value)}>
              {Object.keys(CATEGORY_ICONS).map(cat => (
                <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {cat}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Prompt</span>
            <textarea rows={4} value={form.prompt} onChange={e => setField('prompt', e.target.value)} placeholder="The prompt to send to the agent..." required />
          </label>
          <div className="automation-modal-row">
            <label className="half">
              <span>Target Agent</span>
              <select value={form.target_agent_type} onChange={e => setField('target_agent_type', e.target.value)}>
                {Object.entries(AGENT_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.name}</option>
                ))}
              </select>
            </label>
            <label className="half">
              <span>Specific Session (optional)</span>
              <select value={form.target_session} onChange={e => setField('target_session', e.target.value)}>
                <option value="">Any matching session</option>
                {(sessions || []).map(s => {
                  const id = typeof s === 'string' ? s : s?.session_id;
                  const agent = sessionAgent(s);
                  return <option key={id} value={id}>{agent.name}: {sessionLabel(id) || id}</option>;
                })}
              </select>
            </label>
          </div>
          <div className="automation-modal-row">
            <label className="third">
              <span>Schedule</span>
              <select value={form.schedule} onChange={e => setField('schedule', e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom days</option>
              </select>
            </label>
            <label className="third">
              <span>Hour</span>
              <input type="number" min={0} max={23} value={form.cron_hour} onChange={e => setField('cron_hour', parseInt(e.target.value) || 0)} />
            </label>
            <label className="third">
              <span>Minute</span>
              <input type="number" min={0} max={59} value={form.cron_minute} onChange={e => setField('cron_minute', parseInt(e.target.value) || 0)} />
            </label>
          </div>
          {(form.schedule === 'custom' || form.schedule === 'weekly') && (
            <div className="automation-days-row">
              <span>Days:</span>
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  type="button"
                  className={`automation-day-btn${form.cron_days.includes(i) ? ' active' : ''}`}
                  onClick={() => toggleDay(i)}
                >{name}</button>
              ))}
            </div>
          )}
          <div className="automation-modal-footer">
            {!isNew && (
              <button type="button" className="automation-delete-btn" onClick={() => onDelete(automation)}>
                Delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="automation-cancel-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="automation-save-btn" disabled={saving || !form.name.trim() || !form.prompt.trim()}>
              {saving ? 'Saving...' : (isNew ? 'Create' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AutomationsView({ sessions, onBack }) {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [editTarget, setEditTarget]   = useState(null);     // null = closed, {} = new, {id, ...} = edit
  const [toast, setToast]             = useState('');

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function fetchAutomations() {
    try {
      const res = await fetch('/api/automations');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAutomations(data.automations || []);
    } catch (e) {
      showToast('Failed to load automations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAutomations(); }, []);

  async function handleSave(form) {
    const isNew = !editTarget?.id;
    const url = isNew ? '/api/automations' : `/api/automations/${editTarget.id}`;
    const method = isNew ? 'POST' : 'PUT';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      showToast(isNew ? 'Automation created' : 'Automation updated');
      setEditTarget(null);
      fetchAutomations();
    } catch {
      showToast('Failed to save automation');
    }
  }

  async function handleDelete(automation) {
    if (!window.confirm(`Delete "${automation.name}"?`)) return;
    try {
      await fetch(`/api/automations/${automation.id}`, { method: 'DELETE' });
      showToast('Automation deleted');
      setEditTarget(null);
      fetchAutomations();
    } catch {
      showToast('Failed to delete');
    }
  }

  async function handleRun(automation) {
    try {
      const res = await fetch(`/api/automations/${automation.id}/run`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Running "${automation.name}"...`);
      } else {
        showToast(data.error || 'Failed to run');
      }
    } catch {
      showToast('Failed to run automation');
    }
  }

  async function handleToggle(automation) {
    try {
      await fetch(`/api/automations/${automation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !automation.enabled }),
      });
      fetchAutomations();
    } catch {
      showToast('Failed to toggle');
    }
  }

  // Group by category
  const categories = {};
  for (const auto of automations) {
    const cat = auto.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(auto);
  }

  return (
    <div className="automations-view">
      <div className="automations-header">
        <button className="automations-back" onClick={onBack} title="Back to sessions">←</button>
        <div className="automations-header-text">
          <h2>Automations</h2>
          <p>Automate work by sending scheduled prompts to your agents.</p>
        </div>
        <button className="automations-new-btn" onClick={() => setEditTarget({})}>+ New automation</button>
      </div>

      {loading ? (
        <div className="automations-loading">Loading automations...</div>
      ) : automations.length === 0 ? (
        <div className="automations-empty">
          <div className="automations-empty-icon">⚙</div>
          <div className="automations-empty-text">No automations yet</div>
          <div className="automations-empty-sub">Create your first automation to schedule recurring prompts to your agents.</div>
          <button className="automations-new-btn" onClick={() => setEditTarget({})}>+ New automation</button>
        </div>
      ) : (
        <div className="automations-body">
          {Object.entries(categories).map(([cat, items]) => (
            <div key={cat} className="automations-category">
              <h3 className="automations-category-title">{cat}</h3>
              <div className="automations-card-grid">
                {items.map(auto => (
                  <AutomationCard
                    key={auto.id}
                    automation={auto}
                    onEdit={setEditTarget}
                    onRun={handleRun}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editTarget !== null && (
        <AutomationModal
          automation={editTarget?.id ? editTarget : null}
          sessions={sessions}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditTarget(null)}
        />
      )}

      {toast && <div className="automations-toast">{toast}</div>}
    </div>
  );
}

// ─── Skills View ────────────────────────────────────────────────────────────
// Displays installed and recommended skills read from Codex Desktop via CDP.
function SkillsView({ skills, onRefresh, onBack }) {
  const installed   = skills?.installed   || [];
  const recommended = skills?.recommended || [];
  const loading = installed.length === 0 && recommended.length === 0;

  return (
    <div className="skills-view">
      <div className="skills-header">
        <button className="skills-back" onClick={onBack} title="Back to sessions">←</button>
        <div className="skills-header-text">
          <h2>Skills</h2>
          <p className="skills-subtitle">Give Codex superpowers.</p>
        </div>
        <button className="skills-refresh-btn" onClick={onRefresh} title="Refresh skills">↻</button>
      </div>
      {loading ? (
        <div className="skills-loading">Loading skills…</div>
      ) : (
        <div className="skills-body">
          {installed.length > 0 && (
            <div className="skills-section">
              <h3 className="skills-section-title">Installed</h3>
              <div className="skills-card-list">
                {installed.map((skill, i) => (
                  <div key={skill.id || i} className="skills-card">
                    <div className="skills-card-icon">
                      {skill.icon ? <img src={skill.icon} alt="" className="skills-card-img" /> : <span className="skills-card-placeholder">⚙</span>}
                    </div>
                    <div className="skills-card-body">
                      <div className="skills-card-name">{skill.name}</div>
                      {skill.description && <div className="skills-card-desc">{skill.description}</div>}
                    </div>
                    <div className="skills-card-action installed">✓</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {recommended.length > 0 && (
            <div className="skills-section">
              <h3 className="skills-section-title">Recommended</h3>
              <div className="skills-card-list">
                {recommended.map((skill, i) => (
                  <div key={skill.id || i} className="skills-card">
                    <div className="skills-card-icon">
                      {skill.icon ? <img src={skill.icon} alt="" className="skills-card-img" /> : <span className="skills-card-placeholder">⚙</span>}
                    </div>
                    <div className="skills-card-body">
                      <div className="skills-card-name">{skill.name}</div>
                      {skill.description && <div className="skills-card-desc">{skill.description}</div>}
                    </div>
                    <div className="skills-card-action available">+</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      console.error('Agent Chat render crash', error, info);
      sessionStorage.setItem('agent-chat:last-render-error', JSON.stringify({
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
        at: new Date().toISOString(),
      }));
    } catch {
      // Ignore storage/logging issues so the fallback still renders.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash">
        <div className="app-crash-card">
          <div className="app-crash-title">Agent Chat hit a render error</div>
          <div className="app-crash-body">
            {this.state.error?.message || 'Unknown UI error'}
          </div>
          <div className="app-crash-actions">
            <button className="app-crash-btn" onClick={() => location.reload()}>Refresh</button>
          </div>
        </div>
      </div>
    );
  }
}

function App() {
  const { sessions, messages, connected, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, interruptSession, agentConfigs, requestAgentConfig, setAgentModel, setAgentPermissionMode, setAntigravityMode, setCodexConfig, newThread, openPanel, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, terminalOutputs, requestFileChanges, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, launchSession, resumeSession, closeSession, activeSessionRef, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent } = useRelay();
  const [activeSession, setActiveSession] = useState(null);
  const [drafts, setDrafts]             = useState({});
  const [draftFiles, setDraftFiles]     = useState({});
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [toast, setToast]               = useState('');
  const [uploading, setUploading]       = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showSettings, setShowSettings]     = useState(false);
  const [showComposerSettings, setShowComposerSettings] = useState(false);
  const [stopPending, setStopPending]       = useState({});
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [showChatList, setShowChatList]     = useState(false);
  const [showThreadList, setShowThreadList] = useState(false);
  const [showTerminal, setShowTerminal]   = useState(false);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [showAutomations, setShowAutomations]       = useState(false);
  const [showSkills, setShowSkills]                 = useState(false);
  const [showFileBrowser, setShowFileBrowser]       = useState(false);
  const [fileBrowserPath, setFileBrowserPath]       = useState('.');
  const [viewingFile, setViewingFile]               = useState(null); // { path, content } when viewing a file
  const [theme, setTheme]                           = useState(() => {
    try { return localStorage.getItem('remote-agent-chat-theme') || 'dark'; } catch { return 'dark'; }
  });
  const messagesEndRef  = useRef(null);
  const messagesListRef = useRef(null);
  const isAtBottom      = useRef(true);   // updated by scroll listener before DOM changes
  const textareaRef     = useRef(null);
  const fileInputRef    = useRef(null);
  const prevConnected   = useRef(connected);
  const pendingAttachmentReqs = useRef({});
  const seenAttachmentResults = useRef({});

  useEffect(() => {
    const onError = (event) => {
      try {
        sessionStorage.setItem('agent-chat:last-window-error', JSON.stringify({
          message: event?.error?.message || event?.message || 'Unknown window error',
          stack: event?.error?.stack || '',
          at: new Date().toISOString(),
        }));
      } catch {
        // Ignore error logging failures.
      }
    };
    const onRejection = (event) => {
      try {
        const reason = event?.reason;
        sessionStorage.setItem('agent-chat:last-promise-error', JSON.stringify({
          message: reason?.message || safeString(reason, 'Unhandled promise rejection'),
          stack: reason?.stack || '',
          at: new Date().toISOString(),
        }));
      } catch {
        // Ignore error logging failures.
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) setDrafts(JSON.parse(saved));
    } catch {
      // Ignore draft restore failures and fall back to in-memory drafts.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      // Ignore storage failures to avoid breaking compose flow.
    }
  }, [drafts]);

  useEffect(() => {
    try { localStorage.setItem('remote-agent-chat-theme', theme); } catch {}
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Auto-select first session when list arrives
  useEffect(() => {
    if (!activeSession && sessions.length > 0) {
      const first = sessions[0];
      const id    = typeof first === 'string' ? first : first?.session_id;
      if (id) selectSession(id, first);
    }
  }, [sessions]);

  // Auto-select a just-launched session once it appears in the sessions list
  useEffect(() => {
    if (!justLaunched) return;
    const found = sessions.find(s => (typeof s === 'string' ? s : s?.session_id) === justLaunched);
    if (found) {
      selectSession(justLaunched, found);
      setJustLaunched(null);
    }
  }, [justLaunched, sessions]);

  // Track whether the user is near the bottom via a scroll listener.
  // Updates isAtBottom.current and shows/hides the "Jump to Newest" button.
  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const onScroll = () => {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      isAtBottom.current = atBottom;
      setShowJumpButton(!atBottom);
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);  // mount only — list ref is stable

  // On session switch: jump to bottom instantly, hide jump button, reset msg count.
  const prevMsgCount = useRef(0);
  useEffect(() => {
    isAtBottom.current = true;
    setShowJumpButton(false);
    prevMsgCount.current = (messages[activeSession] || []).length;
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [activeSession]);

  // Auto-scroll on new messages — but ONLY when already at the bottom.
  // If the user has scrolled up to review history, never yank them down.
  useEffect(() => {
    const count = (messages[activeSession] || []).length;
    if (count > prevMsgCount.current && isAtBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCount.current = count;
  }, [messages, activeSession]);

  // Fetch agent config whenever the active session changes
  useEffect(() => {
    if (activeSession) requestAgentConfig(activeSession);
  }, [activeSession]);

  // Clear stop-pending when the agent stops thinking
  useEffect(() => {
    setStopPending(prev => {
      const keys = Object.keys(prev).filter(sid => !thinking[sid]);
      if (keys.length === 0) return prev;
      const next = { ...prev };
      keys.forEach(sid => delete next[sid]);
      return next;
    });
  }, [thinking]);

  // Connection toast
  useEffect(() => {
    if (!prevConnected.current && connected) showToast('Reconnected');
    if (prevConnected.current && !connected) showToast('Disconnected — reconnecting...');
    prevConnected.current = connected;
  }, [connected]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  function setDraftForSession(sessionId, value) {
    if (!sessionId) return;
    setDrafts(prev => ({ ...prev, [sessionId]: value }));
  }

  function setDraftFileForSession(sessionId, file) {
    if (!sessionId) return;
    setDraftFiles(prev => {
      const next = { ...prev };
      if (file === null) { delete next[sessionId]; return next; }
      // Support appending to existing array
      const existing = next[sessionId] || [];
      if (Array.isArray(file)) { next[sessionId] = file; }
      else { next[sessionId] = [...existing, file]; }
      return next;
    });
  }

  function removeDraftFile(sessionId, index) {
    if (!sessionId) return;
    setDraftFiles(prev => {
      const next = { ...prev };
      const arr = [...(next[sessionId] || [])];
      arr.splice(index, 1);
      if (arr.length === 0) delete next[sessionId];
      else next[sessionId] = arr;
      return next;
    });
  }

  async function uploadBinaryDraft(sessionId, base64, mimeType, filename) {
    const resp = await fetch('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content: base64, mimeType }),
    });
    if (!resp.ok) throw new Error('Upload failed');
    const { url } = await resp.json();
    setDraftFileForSession(sessionId, { name: filename, url, isText: false });
    return url;
  }

  function requestDirectImageAttach(sessionId, base64, mimeType, filename) {
    const requestId = sendAttachment(sessionId, base64, mimeType, filename);
    pendingAttachmentReqs.current[requestId] = {
      sessionId,
      filename,
      mimeType,
      base64,
      createdAt: Date.now(),
    };
    showToast(`Sending image to Codex: ${filename}`);
    return requestId;
  }

  useEffect(() => {
    const entries = Object.entries(controlResults || {});
    for (const [requestId, result] of entries) {
      if (!requestId.startsWith('attach-') || seenAttachmentResults.current[requestId]) continue;
      seenAttachmentResults.current[requestId] = true;
      const pending = pendingAttachmentReqs.current[requestId];
      delete pendingAttachmentReqs.current[requestId];
      if (!pending) continue;

      if (result?.result === 'ok') {
        showToast(`Image attached to Codex: ${pending.filename}`);
        continue;
      }

      (async () => {
        try {
          await uploadBinaryDraft(pending.sessionId, pending.base64, pending.mimeType, pending.filename);
          showToast(`Direct image attach failed — added ${pending.filename} as a file link draft`);
        } catch {
          const detail = result?.error?.message || result?.error?.code || 'unknown error';
          showToast(`Image attach failed: ${detail}`);
        }
      })();
    }
  }, [controlResults]);

  function selectSession(id, sessionMeta) {
    setActiveSession(id);
    activeSessionRef.current = id;
    setUnread(prev => ({ ...prev, [id]: 0 }));
    setSidebarOpen(false);
    setShowSlashMenu(false);
    setShowChatList(false);
    setShowThreadList(false);
  }

  // ── File attachment ───────────────────────────────────────────────────────

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';

    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) { showToast(`${file.name}: too large (max 2 MB)`); continue; }

      if (isTextFile(file.name) && file.size < 500 * 1024) {
        await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = ev => { setDraftFileForSession(activeSession, { name: file.name, content: ev.target.result, isText: true }); resolve(); };
          reader.onerror = () => { showToast(`Failed to read ${file.name}`); resolve(); };
          reader.readAsText(file);
        });
      } else {
        setUploading(true);
        try {
          await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async ev => {
              const base64 = ev.target.result.split(',')[1];
              const caps = activeConfig?.capabilities || {};
              if (caps.send_attachment && file.type.startsWith('image/')) {
                requestDirectImageAttach(activeSession, base64, file.type, file.name);
              } else {
                await uploadBinaryDraft(activeSession, base64, file.type, file.name);
                showToast(`Uploaded: ${file.name}`);
              }
              resolve();
            };
            reader.onerror = () => { showToast(`Failed to read ${file.name}`); resolve(); };
            reader.readAsDataURL(file);
          });
        } catch {
          showToast(`Upload failed: ${file.name}`);
        } finally {
          setUploading(false);
        }
      }
    }
  }

  // ── Clipboard paste (images / screenshots) ───────────────────────────────

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return; // no image — let normal text paste proceed

    e.preventDefault();
    if (!activeSession) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) { showToast('Image too large (max 2 MB)'); return; }

    const ext      = file.type === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `screenshot-${Date.now()}.${ext}`;

  setUploading(true);
  try {
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async ev => {
          const base64 = ev.target.result.split(',')[1];

          // For Codex sessions with direct attachment capability, inject directly and
          // wait for the proxy result before showing success.
          const caps = activeConfig?.capabilities || {};
          if (caps.send_attachment) {
            requestDirectImageAttach(activeSession, base64, file.type, filename);
          } else {
            await uploadBinaryDraft(activeSession, base64, file.type, filename);
            showToast('Screenshot attached');
          }
          resolve();
        };
        reader.onerror = () => { showToast('Failed to read clipboard image'); resolve(); };
        reader.readAsDataURL(file);
      });
    } catch {
      showToast('Paste upload failed');
    } finally {
      setUploading(false);
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  function sendMessage() {
    const currentInput = activeSession ? (drafts[activeSession] || '') : '';
    const attachedFiles = activeSession ? (draftFiles[activeSession] || []) : [];
    const text = currentInput.trim();
    if (!text && attachedFiles.length === 0) return;
    if (!activeSession) return;

    let content = '';
    if (attachedFiles.length > 0) {
      const fileParts = attachedFiles.map(f => {
        if (f.isText) {
          const lang = getLang(f.name);
          return `\`${f.name}\`\n\`\`\`${lang}\n${f.content}\n\`\`\``;
        }
        return `[File: ${f.name}](${f.url})`;
      });
      content = fileParts.join('\n\n');
      if (text) content += `\n\n${text}`;
    } else {
      content = text;
    }

    sendToSession(activeSession, content);
    setDraftForSession(activeSession, '');
    setDraftFileForSession(activeSession, null);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      textareaRef.current?.focus();
      return;
    }
    if (e.key === 'Escape') {
      setShowSlashMenu(false);
      return;
    }
    if (e.key === 'Tab' && showSlashMenu && filteredSlashCommands.length > 0) {
      e.preventDefault();
      applySlashCommand(filteredSlashCommands[0].command);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const isActiveThinking = activeSession ? !!thinking[activeSession] : false;
  const isStopPending    = activeSession ? !!stopPending[activeSession] : false;
  const currentInput    = activeSession ? (drafts[activeSession] || '') : '';
  const attachedFiles   = activeSession ? (draftFiles[activeSession] || []) : [];
  const currentMessages = messages[activeSession] || [];
  const activePrompt    = activeSession ? permissionPrompts[activeSession] || null : null;
  const canSend         = !!(currentInput.trim() || attachedFiles.length > 0) && !!activeSession && connected && !uploading && !activePrompt;
  const unreadTotal     = Object.values(unread).reduce((a, b) => a + b, 0);
  const slashQuery      = currentInput.startsWith('/') ? currentInput.slice(1).trim().toLowerCase() : '';
  const filteredSlashCommands = currentInput.startsWith('/')
    ? SLASH_COMMANDS.filter(item => item.command.slice(1).includes(slashQuery))
    : [];

  // Resolve display label for the active session
  const activeConfig = activeSession ? (agentConfigs[activeSession] || null) : null;
  const activeSessionMeta = sessions.find(s =>
    sessionIdOf(s) === activeSession
  );
  const activeLabel = activeSession ? sessionLabel(activeSessionMeta, activeSession) : 'Agent Chat';
  const activeAgent = sessionAgent(activeSessionMeta || activeSession, activeConfig);
  const activeWindowLabel = activeSession ? sessionSubLabel(activeSessionMeta, activeSession) : '';
  const activeWorkspacePath = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.workspace_path
    : '';
  const activeWorkspaceBasename = activeWorkspacePath
    ? activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() || activeWorkspacePath
    : '';
  const activeMachine = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.machine_label
    : '';
  // Last user message — shown as sticky context banner at top of chat
  const lastUserMsg = [...currentMessages].reverse().find(m => m.role === 'user');
  const lastUserText = lastUserMsg
    ? normalizeMessageContent(lastUserMsg.content)
      .replace(/\s+/g, ' ').trim()
    : '';
  const activeHealth = activeSession ? (health[activeSession] || activeSessionMeta?.status || 'unknown') : '';
  // Use real-time activity when present. Fall back to session-metadata activity ONLY
  // when no status event has arrived yet for this session (undefined), not when it
  // was explicitly cleared to false by the idle timeout — that would resurrect a
  // stale "generating" indicator after the agent has already finished.
  const activeActivity = activeSession
    ? (activities[activeSession] !== undefined
        ? activities[activeSession]
        : (activeSessionMeta && typeof activeSessionMeta === 'object' ? activeSessionMeta.activity : null))
    : null;
  const assistantMonospace = activeSessionMeta?.agent_type === 'codex';

  // Auto-fetch thread list for desktop sessions with no messages (e.g. Codex Desktop showing chat picker)
  const hasThreadCap = activeConfig?.capabilities?.thread_list;
  const noMessages = currentMessages.length === 0;
  React.useEffect(() => {
    if (activeSession && hasThreadCap && noMessages) {
      requestThreadList(activeSession);
    }
  }, [activeSession, hasThreadCap, noMessages]);

  function updateInput(value) {
    if (!activeSession) return;
    setDraftForSession(activeSession, value);
    setShowSlashMenu(value.startsWith('/'));
  }

  function applySlashCommand(command) {
    if (!activeSession) return;
    const templates = {
      '/plan': `${command} Outline the implementation approach and major steps.`,
      '/review': `${command} Review the current changes for bugs, regressions, and missing tests.`,
      '/fix': `${command} Implement or repair the current issue.`,
      '/summarize': `${command} Summarize the current state and important changes.`,
    };
    const nextValue = templates[command] || `${command} `;
    setDraftForSession(activeSession, nextValue);
    setShowSlashMenu(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <div className={`overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <span className="logo">⌬</span>
          <span style={{ flex: 1 }}>Agent Sessions</span>
          <button
            className={`new-session-btn${showNewSession ? ' active' : ''}`}
            title="New session"
            onClick={() => setShowNewSession(o => !o)}
          >+</button>
        </div>
        {showNewSession && (
          <NewSessionPanel
            launchStates={launchStates}
            onLaunch={(agentType, workspacePath) => launchSession(agentType, workspacePath)}
            onResume={(sourceSession, agentType, workspacePath) => resumeSession(sourceSession, agentType, workspacePath)}
            onClose={() => setShowNewSession(false)}
            workspaces={workspaces}
          />
        )}
        <div className="session-list">
          {sessions.length === 0 && !showNewSession && (
            <div className="session-empty">No agents connected</div>
          )}
          {sessions.map(s => {
            const id = typeof s === 'string' ? s : s?.session_id;
            return (
              <SessionCard
                key={id}
                session={s}
                health={health[id]}
                unread={unread[id] || 0}
                isThinking={!!thinking[id]}
                isActive={id === activeSession}
                agentConfig={agentConfigs[id] || null}
                activity={activities[id] || null}
                hasPermissionPrompt={!!permissionPrompts[id]}
                onSelect={() => selectSession(id, s)}
                onClose={() => {
                  const isDisconnected = health[id] === 'disconnected' || !health[id];
                  const msg = isDisconnected
                    ? `Remove session from the list?`
                    : `Close session "${id}"?`;
                  if (window.confirm(msg)) closeSession(id, isDisconnected);
                }}
                onAutomations={(s?.agent_type === 'codex-desktop') ? () => { setShowAutomations(o => !o); setShowSkills(false); setSidebarOpen(false); } : undefined}
                showAutomationsActive={showAutomations}
                onSkills={(s?.agent_type === 'codex-desktop') ? () => { setShowSkills(o => !o); setShowAutomations(false); setSidebarOpen(false); if (!skillLists[id]) requestSkillList(id); } : undefined}
                showSkillsActive={showSkills}
              />
            );
          })}
        </div>
        <div className="sidebar-footer">
          <span className={`status-dot ${connected ? 'connected' : ''}`} />
          {connected ? 'Relay connected' : 'Reconnecting…'}
          <a href="/agent-chat.apk" download className="apk-download-link" title="Download Android APK">⬇ APK</a>
        </div>
      </div>

      {/* Main panel */}
      <div className={`main${showAutomations || showSkills ? ' automations-active' : ''}`}>
        {showAutomations && (
          <AutomationsView
            sessions={sessions}
            onBack={() => setShowAutomations(false)}
          />
        )}
        {showSkills && (
          <SkillsView
            skills={skillLists[activeSession] || null}
            onRefresh={() => activeSession && requestSkillList(activeSession)}
            onBack={() => setShowSkills(false)}
          />
        )}
      {!showAutomations && !showSkills && (<>
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
            ☰
            {unreadTotal > 0 && <span className="hamburger-badge">{unreadTotal}</span>}
          </button>
          <div className="topbar-context">
            {activeSession ? (
              <>
                <div className="topbar-title-row">
                  <div
                    className="agent-badge topbar-agent-badge"
                    style={{ color: activeAgent.color, borderColor: activeAgent.color + '55', background: activeAgent.color + '18' }}
                  >
                    {activeAgent.abbr}
                  </div>
                  <div className="topbar-title-group">
                    <div className="topbar-title" style={{ color: activeAgent.color }}>
                      {activeLabel}
                    </div>
                    <div
                      className="topbar-subtitle"
                      title={activeWorkspacePath || undefined}
                    >
                      {activeWorkspaceBasename
                        ? <><span className="topbar-workspace-icon">⌂</span>{activeWorkspaceBasename}</>
                        : activeWindowLabel || (isUuidLike(activeSession) ? 'Connected session' : activeSession)
                      }
                      {activeConfig?.branch && activeConfig.branch !== 'unknown' && (
                        <button
                          className={`topbar-branch-btn${showBranchSelector ? ' active' : ''}`}
                          title={`Branch: ${activeConfig.branch}`}
                          onClick={() => {
                            const next = !showBranchSelector;
                            setShowBranchSelector(next);
                            if (next) requestBranchList(activeSession);
                          }}
                        >
                          <span className="topbar-branch-icon">⑂</span>
                          {activeConfig.branch}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="topbar-meta">
                  <button className="theme-toggle-btn" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} title="Toggle Light/Dark Mode">
                    {theme === 'light' ? '🌙' : '☀️'}
                  </button>
                  <span
                    className={`context-pill ${connected ? 'ok' : 'warn'}`}
                    title={connected ? 'Relay connected' : 'Relay disconnected — reconnecting'}
                  >
                    {connected ? 'relay live' : 'reconnecting'}
                  </span>
                  <span
                    className={`context-pill ${
                      activeHealth === 'healthy'      ? 'ok' :
                      activeHealth === 'degraded'     ? 'warn' :
                      activeHealth === 'disconnected' ? 'error' : ''
                    }`}
                    title={`Proxy: ${activeHealth || 'connecting'}`}
                  >
                    <span className="topbar-health-dot" />
                    {activeHealth === 'healthy'      ? 'live' :
                     activeHealth === 'degraded'     ? 'degraded' :
                     activeHealth === 'disconnected' ? 'offline' : 'connecting'}
                  </span>
                  {activeMachine && (
                    <span className="context-pill" title="Remote machine">{activeMachine}</span>
                  )}
                  {currentMessages.length > 0 && (
                    <span className="context-pill" title="Messages in this session">
                      {currentMessages.length} msg{currentMessages.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {activeConfig?.capabilities?.chat_list && (
                    <button
                      className={`context-pill chat-list-toggle${showChatList ? ' active' : ''}`}
                      title="View conversations"
                      onClick={() => {
                        const next = !showChatList;
                        setShowChatList(next);
                        if (next) requestChatList(activeSession);
                      }}
                    >
                      chats
                    </button>
                  )}
                  {activeConfig?.capabilities?.thread_list && (
                    <button
                      className={`context-pill chat-list-toggle${showThreadList ? ' active' : ''}`}
                      title="View threads"
                      onClick={() => {
                        const next = !showThreadList;
                        setShowThreadList(next);
                        if (next) requestThreadList(activeSession);
                      }}
                    >
                      threads
                    </button>
                  )}
                  {activeConfig?.capabilities?.terminal_output && (
                    <button
                      className={`context-pill terminal-toggle${showTerminal ? ' active' : ''}`}
                      title="View terminal output"
                      onClick={() => {
                        const next = !showTerminal;
                        setShowTerminal(next);
                        if (next) requestTerminalOutput(activeSession);
                      }}
                    >
                      terminal
                    </button>
                  )}
                  {activeConfig?.capabilities?.file_changes && (
                    <button
                      className={`context-pill diff-toggle${showDiffViewer ? ' active' : ''}`}
                      title="View file changes"
                      onClick={() => {
                        const next = !showDiffViewer;
                        setShowDiffViewer(next);
                        if (next) requestFileChanges(activeSession);
                      }}
                    >
                      changes
                    </button>
                  )}
                  {activeConfig?.capabilities?.file_browser && (
                    <button
                      className={`context-pill files-toggle${showFileBrowser ? ' active' : ''}`}
                      title="Browse workspace files"
                      onClick={() => {
                        const next = !showFileBrowser;
                        setShowFileBrowser(next);
                        if (next) {
                          setViewingFile(null);
                          setFileBrowserPath('.');
                          requestDirectoryListing(activeSession, '.');
                        }
                      }}
                    >
                      files
                    </button>
                  )}
                  {activeConfig?.capabilities?.open_panel && (
                    <button
                      className="context-pill open-panel-btn"
                      title="Open panel in Antigravity"
                      onClick={() => openPanel(activeSession)}
                    >
                      open panel
                    </button>
                  )}
                  {isActiveThinking && activeActivity?.label && activeActivity.label !== 'Generating' && (
                    <span className="context-pill thinking" title={activeActivity.label}>
                      {activeActivity.label.length > 40 ? activeActivity.label.substring(0, 40) + '…' : activeActivity.label}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="topbar-title-group">
                <div className="topbar-title">Agent Chat</div>
                <div className="topbar-subtitle">Select a session to inspect its transcript and status</div>
              </div>
            )}
          </div>
        </div>

        {activeActivity?.task_list && (
          <div className="session-tasklist-strip">
            <TaskList taskList={activeActivity.task_list} />
          </div>
        )}

        {showBranchSelector && activeSession && activeConfig?.capabilities?.branch_list && (
          <BranchSelectorPanel
            branchData={branchLists[activeSession] || null}
            sessionId={activeSession}
            currentBranch={activeConfig?.branch}
            onSwitch={(branchName) => { switchBranch(activeSession, branchName); setShowBranchSelector(false); }}
            onCreate={(branchName) => { createBranch(activeSession, branchName); setShowBranchSelector(false); }}
            onClose={() => setShowBranchSelector(false)}
          />
        )}

        {showFileBrowser && activeSession && activeConfig?.capabilities?.file_browser && (
          <FileBrowser
            sessionId={activeSession}
            listing={directoryListings[activeSession]}
            fileContents={fileContents}
            viewingFile={viewingFile}
            onNavigate={(dirPath) => {
              setFileBrowserPath(dirPath);
              setViewingFile(null);
              requestDirectoryListing(activeSession, dirPath);
            }}
            onOpenFile={(filePath) => {
              setViewingFile(filePath);
              requestFileContent(activeSession, filePath);
            }}
            onBackToListing={() => setViewingFile(null)}
            onRefresh={() => {
              if (viewingFile) {
                requestFileContent(activeSession, viewingFile);
              } else {
                requestDirectoryListing(activeSession, fileBrowserPath);
              }
            }}
            onClose={() => {
              setShowFileBrowser(false);
              setViewingFile(null);
            }}
          />
        )}
        <div className="messages-wrap" style={showFileBrowser ? { display: 'none' } : undefined}>
        {activeSession && lastUserText && (
          <div className="last-user-banner" title={lastUserText}>
            <span className="last-user-banner-icon">↵</span>
            <span className="last-user-banner-text">{lastUserText}</span>
          </div>
        )}
        {showJumpButton && (
          <button
            className="jump-to-newest"
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
          >↓ Jump to Newest</button>
        )}
        <div className="messages" ref={messagesListRef}>
          {activePrompt && (
            <PermissionOverlay
              prompt={activePrompt}
              sessionId={activeSession}
              onRespond={respondToPrompt}
            />
          )}
          {(activeSessionMeta?.rate_limit_active || (activeSessionMeta?.percent_used != null && activeSessionMeta.percent_used >= 80)) && (
            <div className={`rate-limit-overlay${activeSessionMeta?.rate_limit_active ? ' critical' : activeSessionMeta?.percent_used >= 90 ? ' critical' : activeSessionMeta?.percent_used >= 75 ? ' warning' : ''}`}>
              <span className="rate-limit-icon">{activeSessionMeta?.rate_limit_active ? '⏳' : '📊'}</span>
              <span className="rate-limit-text">
                {activeSessionMeta?.rate_limit_active
                  ? <>Rate limited{activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== 'unknown' ? <> — resets in <strong>{activeSessionMeta.rate_limited_until}</strong></> : null}</>
                  : <>Used <strong>{activeSessionMeta.percent_used}%</strong> of session limit{activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== 'unknown' ? <> · resets in <strong>{activeSessionMeta.rate_limited_until}</strong></> : null}</>
                }
              </span>
            </div>
          )}
          {!activeSession ? (
            <div className="empty-state"><div className="icon">🤖</div><div>Select an agent session</div></div>
          ) : currentMessages.length === 0 && hasThreadCap && (threadLists[activeSession]?.length > 0) ? (
            <div className="thread-picker-empty">
              <div className="thread-picker-header">Select a chat</div>
              <div className="thread-picker-list">
                {threadLists[activeSession].map((thread, i) => (
                  <button
                    key={thread.id || i}
                    className={`thread-picker-item${thread.active ? ' active' : ''}`}
                    onClick={() => switchThread(activeSession, thread.id)}
                    title={thread.title}
                  >
                    <span className="thread-picker-title">{thread.title || 'Untitled'}</span>
                    {thread.age && <span className="thread-picker-age">{thread.age}</span>}
                  </button>
                ))}
              </div>
              <button
                className="thread-picker-new"
                onClick={() => newThread(activeSession)}
              >+ New Thread</button>
            </div>
          ) : (activeSessionMeta?.is_list_view && chatLists[activeSession]?.length > 0) ? (
            <div className="thread-picker-empty">
              <div className="thread-picker-header">Select a conversation or type a new message</div>
              <div className="thread-picker-list">
                {chatLists[activeSession].map((chat, i) => (
                  <button
                    key={chat.id || i}
                    className={`thread-picker-item${chat.active ? ' active' : ''}`}
                    onClick={() => switchChat(activeSession, chat.id)}
                    title={chat.title}
                  >
                    <span className="thread-picker-title">{chat.title || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : currentMessages.length === 0 ? (
            <div className="empty-state"><div className="icon">💬</div><div>No messages yet</div></div>
          ) : (
            currentMessages.filter(msg => hasVisibleMessageContent(msg.content)).map((msg, i) => (
              msg.role === 'user' ? (
                <div key={msg._cid || i} className={`message user${msg._optimistic && deliveryStates[msg._cid] === 'failed' ? ' failed' : ''}`}>
                  <div className="user-gutter">
                    <div className="user-glyph" />
                  </div>
                  <div className="user-content">
                    <div className="message-role">
                      <span>You</span>
                      <DeliveryStatus msg={msg} deliveryStates={deliveryStates} onSteer={(cid, content) => steerMessage(activeSession, cid, content)} />
                    </div>
                    {msg.content && msg.content.includes('![screenshot](data:') ? (
                      <div className="user-text"><MarkdownContent content={normalizeMessageContent(msg.content)} /></div>
                    ) : (
                      <div className="user-text">{normalizeMessageContent(msg.content)}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={i} className={`message assistant${assistantMonospace ? ' monospace' : ''}`}>
                  <div className="assistant-gutter">
                    <div
                      className="agent-badge transcript-agent-badge"
                      style={{ color: activeAgent.color, borderColor: activeAgent.color + '55', background: activeAgent.color + '18' }}
                    >
                      {activeAgent.abbr}
                    </div>
                  </div>
                  <div className="assistant-content">
                    <div className="message-role"><span>{activeAgent.name}</span></div>
                    <MarkdownContent content={normalizeMessageContent(msg.content)} monospace={assistantMonospace} />
                  </div>
                </div>
              )
            ))
          )}
          {activeActivity && !activeActivity?.task_list && <ActivityRow
            activity={activeActivity}
            thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
            isClaude={activeSessionMeta?.agent_type === 'claude'}
          />}
          <div ref={messagesEndRef} />
        </div>
        </div>

        {showSettings && activeSession && (
          <AgentSettingsPanel
            session={activeSessionMeta || activeSession}
            config={activeConfig}
            onRequestRefresh={requestAgentConfig}
            onSetModel={(sid, modelId) => setAgentModel(sid, modelId)}
            onSetPermissionMode={(sid, mode) => setAgentPermissionMode(sid, mode)}
            onSetMode={(sid, mode) => setAntigravityMode && setAntigravityMode(sid, mode)}
            onSetCodexConfig={(updates) => setCodexConfig(activeSession, updates)}
            onSwitchWorkspace={(sid, folderPath) => switchWorkspace(sid, folderPath)}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showChatList && activeSession && activeConfig?.capabilities?.chat_list && (
          <ChatListPanel
            chats={chatLists[activeSession] || []}
            sessionId={activeSession}
            onSwitch={(chatId) => {
              switchChat(activeSession, chatId);
              setShowChatList(false);
            }}
            onNew={() => {
              newChat(activeSession);
              setShowChatList(false);
            }}
            onClose={() => setShowChatList(false)}
          />
        )}

        {showThreadList && activeSession && activeConfig?.capabilities?.thread_list && (
          <ThreadHistoryPanel
            threads={threadLists[activeSession] || []}
            sessionId={activeSession}
            onSwitch={(threadId) => {
              switchThread(activeSession, threadId);
              setShowThreadList(false);
            }}
            onNew={() => {
              newThread(activeSession);
              setShowThreadList(false);
            }}
            onClose={() => setShowThreadList(false)}
          />
        )}

        {!showFileBrowser && showTerminal && activeSession && activeConfig?.capabilities?.terminal_output && (
          <TerminalViewer
            entries={terminalOutputs[activeSession] || []}
            onRefresh={() => requestTerminalOutput(activeSession)}
            onClose={() => setShowTerminal(false)}
          />
        )}

        {!showFileBrowser && showDiffViewer && activeSession && activeConfig?.capabilities?.file_changes && (
          <DiffViewer
            entries={fileChanges[activeSession] || []}
            onRefresh={() => requestFileChanges(activeSession)}
            onClose={() => setShowDiffViewer(false)}
          />
        )}

        <div className="input-area" style={showFileBrowser ? { display: 'none' } : undefined}>
          <label className={`attach-btn ${!activeSession || !connected || !!activePrompt ? 'disabled' : ''}`} title="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input
              type="file"
              hidden
              multiple
              ref={fileInputRef}
              onChange={handleFileSelect}
              disabled={!activeSession || !connected || !!activePrompt}
            />
          </label>

          <div className="input-col">
            {attachedFiles.length > 0 && (
              <div className="file-chips">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="file-chip">
                    <span>📄 {f.name}{f.isText ? '' : ' (uploaded)'}</span>
                    <button onClick={() => removeDraftFile(activeSession, i)}>×</button>
                  </div>
                ))}
              </div>
            )}
            {showSlashMenu && filteredSlashCommands.length > 0 && (
              <div className="slash-menu">
                {filteredSlashCommands.map(item => (
                  <button
                    key={item.command}
                    type="button"
                    className="slash-item"
                    onClick={() => applySlashCommand(item.command)}
                  >
                    <span className="slash-command">{item.command}</span>
                    <span className="slash-detail">{item.detail}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Queued messages bar — shown above input when agent is busy */}
            {activeSession && (queuedMessages[activeSession] || []).length > 0 && (
              <div className="queued-bar">
                {(queuedMessages[activeSession] || []).map(qm => (
                  <QueuedItem
                    key={qm.cid}
                    qm={qm}
                    onSteer={() => steerMessage(activeSession, qm.cid, qm.content, qm.nativeIndex)}
                    onDiscard={() => discardQueuedMessage(activeSession, qm.cid)}
                    onEdit={(newContent) => editQueuedMessage(activeSession, qm.cid, newContent)}
                  />
                ))}
              </div>
            )}
            <div className="textarea-row">
              <textarea
                ref={textareaRef}
                value={currentInput}
                onChange={e => updateInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={handlePaste}
                placeholder={activePrompt
                  ? 'Resolve the permission prompt above to continue'
                  : activeSession
                    ? (window.innerWidth < 600 ? 'Enter message…' : 'Message… (/ for commands)')
                    : 'Select a session'}
                disabled={!activeSession || !connected || !!activePrompt}
                rows={1}
              />
              <div className="textarea-btns">
                {activeSession && (
                  <button
                    className={`composer-gear-btn${showComposerSettings ? ' active' : ''}`}
                    onClick={() => setShowComposerSettings(s => !s)}
                    title="Toggle settings"
                  >⚙</button>
                )}
                {activeConfig?.capabilities?.new_thread && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => newThread(activeSession)}
                    title="New thread"
                  >✎</button>
                )}
                {activeConfig?.capabilities?.chat_list && (
                  <button
                    className={`composer-gear-btn mobile-hide${showChatList ? ' active' : ''}`}
                    onClick={() => {
                      const willShow = !showChatList;
                      setShowChatList(willShow);
                      if (willShow) requestChatList(activeSession);
                    }}
                    title="Chat history"
                  >☰</button>
                )}
                {activeConfig?.capabilities?.thread_list && (
                  <button
                    className={`composer-gear-btn mobile-hide${showThreadList ? ' active' : ''}`}
                    onClick={() => {
                      const willShow = !showThreadList;
                      setShowThreadList(willShow);
                      if (willShow) requestThreadList(activeSession);
                    }}
                    title="Thread history"
                  >⊟</button>
                )}
                {activeConfig?.capabilities?.open_panel && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => openPanel(activeSession)}
                    title="Open panel"
                  >⊞</button>
                )}
                {activeConfig?.capabilities?.new_chat && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => newChat(activeSession)}
                    title="New chat"
                  >+</button>
                )}
                {isActiveThinking ? (
                  <button
                    className={`stop-btn${isStopPending ? ' pending' : ''}`}
                    title={isStopPending ? 'Interrupting…' : 'Interrupt agent'}
                    disabled={isStopPending}
                    onClick={() => {
                      setStopPending(prev => ({ ...prev, [activeSession]: true }));
                      interruptSession(activeSession);
                    }}
                  >
                    {isStopPending ? <span className="stop-btn-spinner" /> : '■'}
                  </button>
                ) : (
                  <button className="send-btn" onClick={sendMessage} disabled={!canSend} title="Send">
                    {uploading ? '…' : '↑'}
                  </button>
                )}
              </div>
            </div>
            <div className="composer-meta">
              {activeSessionMeta?.agent_type === 'continue' && activeConfig?.mode && activeConfig.mode !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.mode}</span>
              )}
              {activeSessionMeta?.agent_type === 'continue' && activeConfig?.model_id && activeConfig.model_id !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.model_id}</span>
              )}
              <span className="composer-hint">Enter send</span>
              <span className="composer-hint">Shift+Enter newline</span>
              <span className="composer-hint">Ctrl/Cmd+K focus</span>
              <span className="composer-hint">/ commands</span>
              <span className="composer-hint">Ctrl+V image</span>
              {activeSession && currentInput && <span className="composer-hint draft-live">draft saved</span>}
            </div>
            {activeSession && (
              <div className={`composer-settings${showComposerSettings ? ' is-open' : ''}`}>
                {(activeConfig?.capabilities?.set_model || activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') && (
                  <label className="composer-setting-label">
                    <span className="composer-setting-key">Model</span>
                    <select
                      className="composer-setting-select"
                      value={activeConfig?.model_id || 'default'}
                      onChange={e => setAgentModel(activeSession, e.target.value)}
                    >
                      {((activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') ? KNOWN_ANTIGRAVITY_MODELS
                        : activeSessionMeta?.agent_type === 'gemini' ? KNOWN_GEMINI_MODELS
                        : KNOWN_CLAUDE_MODELS).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {activeSessionMeta?.agent_type !== 'antigravity' && activeSessionMeta?.agent_type !== 'antigravity_panel' && activeSessionMeta?.agent_type !== 'gemini' && activeConfig?.model_id && !(KNOWN_CLAUDE_MODELS).some(m => m.id === activeConfig.model_id) && activeConfig.model_id !== 'unknown' && (
                        <option value={activeConfig.model_id}>{activeConfig.model_id}</option>
                      )}
                    </select>
                  </label>
                )}
                {(activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') && (
                  <label className="composer-setting-label">
                    <span className="composer-setting-key">Mode</span>
                    <select
                      className="composer-setting-select"
                      value={activeConfig?.conversation_mode || 'Planning'}
                      onChange={e => setAntigravityMode(activeSession, e.target.value)}
                    >
                      {ANTIGRAVITY_MODES.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {activeConfig?.capabilities?.permission_mode_change && (
                  <select
                    className="composer-setting-select"
                    value={activeConfig.permission_mode || 'default'}
                    onChange={e => setAgentPermissionMode(activeSession, e.target.value)}
                    title="Permission mode"
                  >
                    {PERMISSION_MODES[activeSessionMeta?.agent_type || 'claude']?.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    {activeConfig.permission_mode && !PERMISSION_MODES[activeSessionMeta?.agent_type]?.some(m => m.value === activeConfig.permission_mode) && activeConfig.permission_mode !== 'unknown' && (
                      <option value={activeConfig.permission_mode}>{activeConfig.permission_mode}</option>
                    )}
                  </select>
                )}
                {activeConfig?.capabilities?.set_codex_config && (
                  <>
                    <select
                      className="composer-setting-select"
                      value={activeConfig.model_id || 'unknown'}
                      onChange={e => setCodexConfig(activeSession, { model_id: e.target.value })}
                      title="Codex model (restart required)"
                    >
                      {(activeConfig.available_models || []).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {activeConfig.model_id && !(activeConfig.available_models || []).some(m => m.id === activeConfig.model_id) && activeConfig.model_id !== 'unknown' && (
                        <option value={activeConfig.model_id}>{activeConfig.model_id}</option>
                      )}
                    </select>
                    <select
                      className="composer-setting-select"
                      value={(activeConfig.effort || 'unknown').toLowerCase()}
                      onChange={e => setCodexConfig(activeSession, { effort: e.target.value })}
                      title="Reasoning effort (restart required)"
                    >
                      {(activeConfig.available_efforts || []).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <select
                      className="composer-setting-select"
                      value={activeConfig.permission_mode || 'unknown'}
                      onChange={e => setCodexConfig(activeSession, { access_mode: e.target.value })}
                      title="Access mode (restart required)"
                    >
                      {(activeConfig.available_access || []).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {activeConfig.permission_mode && !(activeConfig.available_access || []).some(m => m.id === activeConfig.permission_mode) && activeConfig.permission_mode !== 'unknown' && (
                        <option value={activeConfig.permission_mode}>{activeConfig.permission_mode}</option>
                      )}
                    </select>
                    {activeSessionMeta?.agent_type === 'codex-desktop' && (activeConfig.available_workspaces || []).length > 0 && (
                      <select
                        className="composer-setting-select"
                        value={activeConfig.file_access_scope || ''}
                        onChange={e => switchWorkspace(activeSession, e.target.value)}
                        title="Switch workspace"
                      >
                        {(activeConfig.available_workspaces || []).map(m => (
                          <option key={m.id} value={m.path || m.id}>{m.label}</option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                {activeWorkspacePath && (
                  <span className="composer-workspace" title={activeWorkspacePath}>
                    ⌂ {activeWorkspaceBasename || activeWorkspacePath}
                  </span>
                )}
                <div className="composer-mobile-actions">
                  {activeConfig?.capabilities?.new_thread && (
                    <button className="composer-mobile-action" onClick={() => newThread(activeSession)}>✎ New thread</button>
                  )}
                  {activeConfig?.capabilities?.chat_list && (
                    <button className="composer-mobile-action" onClick={() => { requestChatList(activeSession); setShowChatList(true); setShowComposerSettings(false); }}>☰ Chat history</button>
                  )}
                  {activeConfig?.capabilities?.thread_list && (
                    <button className="composer-mobile-action" onClick={() => { requestThreadList(activeSession); setShowThreadList(true); setShowComposerSettings(false); }}>⊟ Threads</button>
                  )}
                  {activeConfig?.capabilities?.open_panel && (
                    <button className="composer-mobile-action" onClick={() => openPanel(activeSession)}>⊞ Open panel</button>
                  )}
                  {activeConfig?.capabilities?.new_chat && (
                    <button className="composer-mobile-action" onClick={() => newChat(activeSession)}>+ New chat</button>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </>)}
      </div>

      <div className={`toast ${toast ? 'visible' : ''}`}>{toast}</div>
    </div>
  );
}

export { App };

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
