// app.jsx — App component and entry point
// Primary file for Agent 5 UI redesign work.

import { getLang, isTextFile, sessionLabel } from './file-utils.js';
import { MarkdownContent } from './markdown.js';
import { useRelay } from './hooks.jsx';

const { useState, useRef, useEffect, useLayoutEffect } = React;

const DRAFT_STORAGE_KEY = 'remote-agent-chat:drafts:v1';
const DEFAULT_INITIAL_HISTORY_LIMIT = 120;
const CODEX_INITIAL_HISTORY_LIMIT = 500;
const CODEX_CLI_INITIAL_HISTORY_LIMIT = 160;
const TRANSCRIPT_RENDER_TAIL_LIMIT = 96;
const CODEX_TRANSCRIPT_RENDER_TAIL_LIMIT = 512;
const EMPTY_MESSAGES = Object.freeze([]);
const SLASH_COMMANDS = [
  { command: '/plan', detail: 'Outline the implementation approach and major steps.' },
  { command: '/review', detail: 'Review the current changes for bugs, regressions, and missing tests.' },
  { command: '/fix', detail: 'Implement or repair the current issue.' },
  { command: '/summarize', detail: 'Summarize the current state and important changes.' },
];

// ─── Agent identity ───────────────────────────────────────────────────────────

const AGENT_CONFIG = {
  claude:            { name: 'Claude Code',      color: '#cc785c', abbr: 'CC', logo: '/logo-claude-in-ag.svg' },
  claude_cli:        { name: 'Claude Code CLI',  color: '#d97757', abbr: 'CLI', logo: '/logo-claude-in-ag.svg' },
  'claude-desktop':  { name: 'Claude Desktop',  color: '#cc785c', abbr: 'CD', logo: '/logo-claude-in-ag.svg' },
  codex:             { name: 'Codex',            color: '#10a37f', abbr: 'CX', logo: '/logo-codex-in-ag.svg' },
  codex_cli:         { name: 'Codex CLI',        color: '#10a37f', abbr: 'CLI', logo: '/logo-codex.svg' },
  'codex-desktop':   { name: 'Codex Desktop',   color: '#10a37f', abbr: 'CX', logo: '/logo-codex.svg' },
  cursor:            { name: 'Cursor',          color: '#7AA2F7', abbr: 'CR', logo: '/logo-cursor.svg' },
  gemini:            { name: 'Gemini',           color: '#4285f4', abbr: 'GC', logo: '/logo-gemini-in-ag.svg' },
  continue:          { name: 'Continue',         color: '#d29922', abbr: 'CN', logo: '/logo-continue.png' },
  continue_yolo:     { name: 'Continue YOLO',    color: '#f59e0b', abbr: 'CY', logo: '/logo-continue.png' },
  roo_code:          { name: 'Roo Code',         color: '#06b6d4', abbr: 'RC', logo: '/logo-continue.png' },
  cline:             { name: 'Cline',            color: '#6366f1', abbr: 'CL', logo: '/logo-cline.svg' },
  antigravity:       { name: 'Antigravity',      color: '#a855f7', abbr: 'AG', logo: '/logo-antigravity.svg' },
  antigravity_panel: { name: 'Antigravity Chat', color: '#a855f7', abbr: 'AC', logo: '/logo-antigravity.svg' },
  'antigravity-v2':  { name: 'Antigravity v2',   color: '#7c3aed', abbr: 'A2', logo: null },
};
const DEFAULT_AGENT = { name: 'Agent', color: '#8b949e', abbr: 'AG' };

function isContinueLikeAgentType(agentType) {
  return agentType === 'continue' || agentType === 'continue_yolo';
}

function isClineLikeAgentType(agentType) {
  return agentType === 'cline' || agentType === 'roo_code';
}

function isRooCodeLikeAgentType(agentType) {
  return agentType === 'roo_code';
}

function isCodexTranscriptAgentType(agentType) {
  return agentType === 'codex' || agentType === 'codex-desktop';
}

function transcriptRenderTailLimitForAgentType(agentType) {
  return isCodexTranscriptAgentType(agentType)
    ? CODEX_TRANSCRIPT_RENDER_TAIL_LIMIT
    : TRANSCRIPT_RENDER_TAIL_LIMIT;
}

function historyLimitForAgentType(agentType) {
  if (agentType === 'codex_cli') return CODEX_CLI_INITIAL_HISTORY_LIMIT;
  if (isCodexTranscriptAgentType(agentType)) return CODEX_INITIAL_HISTORY_LIMIT;
  return DEFAULT_INITIAL_HISTORY_LIMIT;
}

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

function stableContentHash(value) {
  const text = typeof value === 'string' ? value : safeString(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function messageIdentityKey(msg, fallbackIndex = 0) {
  if (!msg || typeof msg !== 'object') return `empty:${fallbackIndex}`;
  if (msg._cid) return `cid:${msg._cid}`;
  if (msg.id != null) return `id:${msg.id}`;
  if (msg.server_message_id != null) return `server:${msg.server_message_id}`;
  if (msg.client_msg_id) return `client:${msg.client_msg_id}`;
  if (msg.sequence != null) return `seq:${msg.sequence}`;
  const content = normalizeMessageContent(msg.content) || contentBlocksFallback(msg.content_blocks);
  const blocks = Array.isArray(msg.content_blocks) ? JSON.stringify(msg.content_blocks) : '';
  return [
    'body',
    msg.role || '',
    msg.ts || '',
    stableContentHash(`${content}\n${blocks}`),
  ].join(':');
}

function scrollIdentityKeysForMessages(messages, renderAll = false, tailLimit = TRANSCRIPT_RENDER_TAIL_LIMIT) {
  const list = Array.isArray(messages) ? messages : [];
  const limit = Math.max(1, Number(tailLimit) || TRANSCRIPT_RENDER_TAIL_LIMIT);
  const keySource = (!renderAll && list.length > limit)
    ? list.slice(-limit)
    : list;
  const offset = list.length - keySource.length;
  return keySource.map((msg, i) => messageIdentityKey(msg, offset + i));
}

function setScrollTopInstant(element, value) {
  if (!element) return;
  const previous = element.style.scrollBehavior;
  element.style.scrollBehavior = 'auto';
  element.scrollTop = value;
  requestAnimationFrame(() => {
    if (element.style.scrollBehavior === 'auto') {
      element.style.scrollBehavior = previous;
    }
  });
}

function recoverUploadedImageMarkdown(content) {
  const text = normalizeMessageContent(content);
  const match = text.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);
  if (!match) return text;
  const [, originalName, , storedName] = match;
  if (!/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(originalName)) return text;
  return `![${originalName}](/uploads/${storedName})`;
}

function hasVisibleMessageContent(content) {
  return normalizeMessageContent(content).trim().length > 0;
}

function normalizeContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter(block => block && typeof block === 'object')
    .map(block => {
      const type = safeString(block.type || 'markdown').toLowerCase();
      if (type === 'code') {
        const lang = safeString(block.language || block.lang || '').trim();
        const content = normalizeMessageContent(block.content || block.text || block.markdown || '');
        return { ...block, type: 'markdown', content: `\`\`\`${lang}\n${content}\n\`\`\`` };
      }
      if (type === 'file_change') return { ...block, type: 'file_changes' };
      if (type === 'tool') return { ...block, type: 'tool_call' };
      if (type === 'thought') return { ...block, type: 'thinking' };
      return block;
    });
}

function contentBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  const terminalParts = [
    block.workdir ? `cwd: ${block.workdir}` : null,
    block.command ? `$ ${block.command}` : null,
    block.stdout || null,
    block.stderr ? `stderr:\n${block.stderr}` : null,
    block.exit_code != null ? `exit code: ${block.exit_code}` : null,
  ].filter(Boolean);
  if (terminalParts.length) return terminalParts.join('\n\n');
  if (Array.isArray(block.files) && block.files.length > 0) {
    const files = block.files.map(file => [
      file.path || file.file || '',
      file.added != null ? `+${file.added}` : '',
      file.removed != null ? `-${file.removed}` : '',
    ].filter(Boolean).join(' ')).filter(Boolean).join('\n');
    return [block.content || block.text || block.markdown || '', files].filter(Boolean).join('\n\n');
  }
  return block.content || block.text || block.markdown || block.title || block.label || '';
}

function hasVisibleMessage(msg) {
  if (!msg) return false;
  if (hasVisibleMessageContent(msg.content)) return true;
  return normalizeContentBlocks(msg.content_blocks).some(block =>
    normalizeMessageContent(contentBlockText(block)).trim().length > 0
  );
}

function contentBlocksFallback(blocks) {
  return normalizeContentBlocks(blocks)
    .map(block => normalizeMessageContent(contentBlockText(block)))
    .filter(Boolean)
    .join('\n\n');
}

function ContentBlockActions({ actions }) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  return (
    <div className="content-block-actions">
      {actions.map((action, actionIndex) => (
        <span
          key={action.id || actionIndex}
          className={`content-block-action-label${action.unsupported ? ' unsupported' : ''}`}
          title={action.unsupported ? 'This Codex control is visible in the source app but is not currently available from the web UI.' : undefined}
        >
          {action.label || action.id || 'Action'}
        </span>
      ))}
    </div>
  );
}

function ContentBlocks({ blocks, monospace, autoExpandLongCodeBlocks, onOpenPath, agentType }) {
  const normalized = normalizeContentBlocks(blocks);
  if (normalized.length === 0) return null;
  const isCodexCli = safeString(agentType).toLowerCase() === 'codex_cli';
  function blockBody(block) {
    const terminalParts = [
      block.workdir ? `cwd: ${block.workdir}` : null,
      block.command ? `$ ${block.command}` : null,
      block.stdout || null,
      block.stderr ? `stderr:\n${block.stderr}` : null,
      block.exit_code != null ? `exit code: ${block.exit_code}` : null,
    ].filter(Boolean);
    if (terminalParts.length) return terminalParts.join('\n\n');
    return normalizeMessageContent(block.content || block.text || block.markdown || '');
  }
  function explicitOpen(block) {
    if (block.collapsed === false || block.default_open === true || block.open === true) return true;
    if (block.collapsed === true) return false;
    return null;
  }
  function isCodexCliExpandedToolBlock(block, title) {
    if (!isCodexCli) return false;
    if (block.command) return true;
    const normalizedTitle = safeString(title).toLowerCase();
    if (safeString(block.type).toLowerCase() === 'tool_call') return true;
    return normalizedTitle.startsWith('tool:')
      || normalizedTitle.includes('shell_command')
      || normalizedTitle.includes('local_shell')
      || normalizedTitle.includes('custom_tool');
  }
  return (
    <div className="content-blocks">
      {normalized.map((block, index) => {
        const type = safeString(block.type || 'markdown').toLowerCase();
        const title = safeString(block.title || block.label || block.summary || type);
        const body = blockBody(block);
        if (type === 'thinking') {
          return (
            <details key={index} className="content-block content-block-thinking" open={block.collapsed === false}>
              <summary>{title || 'Thinking'}</summary>
              {body && <MarkdownContent content={body} monospace={monospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={onOpenPath} />}
            </details>
          );
        }
        if (type === 'tool_call') {
          const open = explicitOpen(block);
          return (
            <details key={index} className="content-block content-block-tool" open={open ?? (block.status === 'running' || isCodexCliExpandedToolBlock(block, title))}>
              <summary>
                <span>{title || 'Tool'}</span>
                {block.status && <span className={`content-block-status ${safeString(block.status).toLowerCase()}`}>{block.status}</span>}
              </summary>
              {body && <pre className="content-block-pre">{body}</pre>}
              <ContentBlockActions actions={block.actions} />
            </details>
          );
        }
        if (type === 'terminal') {
          const open = explicitOpen(block);
          return (
            <details key={index} className="content-block content-block-terminal" open={open ?? isCodexCli}>
              <summary>
                <span>{title || 'Terminal'}</span>
                {block.exit_code != null && <span className="content-block-status">exit {block.exit_code}</span>}
              </summary>
              {body && <pre className="content-block-pre">{body}</pre>}
              <ContentBlockActions actions={block.actions} />
            </details>
          );
        }
        if (type === 'file_changes') {
          const open = explicitOpen(block);
          const stats = [
            block.files_changed != null ? `${block.files_changed} files` : null,
            block.additions != null ? `+${block.additions}` : null,
            block.deletions != null ? `-${block.deletions}` : null,
          ].filter(Boolean).join(' ');
          return (
            <details key={index} className="content-block content-block-file-change" open={open ?? isCodexCli}>
              <summary>
                <span>{title || 'File changes'}{stats ? ` ${stats}` : ''}</span>
                {block.status && <span className={`content-block-status ${safeString(block.status).toLowerCase()}`}>{block.status}</span>}
              </summary>
              {Array.isArray(block.files) && block.files.length > 0 && (
                <div className="content-block-file-list">
                  {block.files.map((file, fileIndex) => (
                    <div className="content-block-file-row" key={file.path || fileIndex}>
                      <span className="content-block-file-path">{file.path || 'file'}</span>
                      {file.added != null && <span className="content-block-add">+{file.added}</span>}
                      {file.removed != null && <span className="content-block-del">-{file.removed}</span>}
                    </div>
                  ))}
                </div>
              )}
              {body && <MarkdownContent content={body} monospace={monospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={onOpenPath} />}
              <ContentBlockActions actions={block.actions} />
            </details>
          );
        }
        if (type === 'artifact') {
          return (
            <div key={index} className="content-block content-block-artifact">
              <div className="content-block-title">{title || 'Artifact'}</div>
              {body && <MarkdownContent content={body} monospace={monospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={onOpenPath} />}
            </div>
          );
        }
        if (type === 'prompt' || type === 'error') {
          return (
            <div key={index} className={`content-block content-block-${type}`}>
              <div className="content-block-title">{title || type}</div>
              {body && <MarkdownContent content={body} monospace={monospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={onOpenPath} />}
              <ContentBlockActions actions={block.actions} />
            </div>
          );
        }
        return (
          <div key={index} className="content-block content-block-markdown">
            <MarkdownContent content={body || title} monospace={monospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={onOpenPath} />
          </div>
        );
      })}
    </div>
  );
}

function hasSubstantiveLiveText(content) {
  const text = normalizeMessageContent(content).trim();
  if (!text) return false;
  if (text.length < 4) return false;
  if (/^[\s*._|`~•·▌]+$/.test(text)) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;
  return true;
}

function formatMessageTimestamp(ts) {
  if (ts == null) return '';
  const numeric = Number(ts);
  if (!Number.isFinite(numeric)) return '';
  const ms = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

function normalizeAgentTypeHint(value) {
  const raw = safeString(value).toLowerCase();
  if (!raw) return null;
  if (raw.includes('roo code') || raw.includes('roo_code') || raw.includes('roo-cline')) return 'roo_code';
  if (raw.includes('cline') || raw.includes('claude-dev')) return 'cline';
  if (raw.includes('continue yolo') || raw.includes('continue_yolo')) return 'continue_yolo';
  if (raw.includes('continue')) return 'continue';
  if (raw.includes('codex cli') || raw.includes('codex_cli')) return 'codex_cli';
  if (raw.includes('codex desktop')) return 'codex-desktop';
  if (/\bcursor\b/.test(raw) || raw === 'cursor' || raw.includes('cursor ide')) return 'cursor';
  if (raw.includes('codex')) return 'codex';
  if (raw.includes('claude code') || raw.includes('claude')) return 'claude';
  if (raw.includes('antigravity chat') || raw.includes('antigravity_panel')) return 'antigravity_panel';
  if (raw.includes('antigravity-v2') || raw.includes('antigravity v2')) return 'antigravity-v2';
  return null;
}

function normalizedSessionAgentType(sessionOrId) {
  if (sessionOrId && typeof sessionOrId === 'object') {
    const direct = sessionOrId.agent_type;
    if (AGENT_CONFIG[direct]) return direct;
    return normalizeAgentTypeHint(sessionOrId.display_name)
      || normalizeAgentTypeHint(sessionOrId.agent_type)
      || normalizeAgentTypeHint(sessionOrId.session_title)
      || normalizeAgentTypeHint(sessionOrId.window_title)
      || normalizeAgentTypeHint(sessionOrId.chat_title)
      || normalizeAgentTypeHint(sessionOrId.session_id);
  }
  if (typeof sessionOrId === 'string') {
    const prefix = sessionOrId.split('-')[0].toLowerCase();
    if (AGENT_CONFIG[prefix]) return prefix;
    return normalizeAgentTypeHint(sessionOrId);
  }
  return null;
}

function sessionIdOf(sessionOrId) {
  return typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.session_id;
}

function sessionAgent(sessionOrId, agentConfig) {
  if (sessionOrId && typeof sessionOrId === 'object') {
    const type = normalizedSessionAgentType(sessionOrId);
    return AGENT_CONFIG[type] || agentFromId(sessionOrId.session_id);
  }
  const type = normalizedSessionAgentType(sessionOrId);
  return AGENT_CONFIG[type] || agentFromId(sessionOrId);
}

function sessionSubLabel(sessionOrId, fallbackId, agentConfig) {
  if (sessionOrId && typeof sessionOrId === 'object') {
    const workspaceCandidate = workspaceCandidateFromSession(sessionOrId, agentConfig);
    const scopeBasename = agentConfig?.file_access_scope
      ? agentConfig.file_access_scope.replace(/\\/g, '/').split('/').filter(Boolean).pop()
      : null;
    const panelSuffix = sessionOrId.agent_type === 'antigravity_panel' && sessionOrId.panel_title
      ? ` / ${sessionOrId.panel_title}`
      : '';
    const workspacePart = (workspaceCandidate?.label || sessionOrId.workspace_name || scopeBasename || sessionOrId.window_title || sessionOrId.workspace_path || fallbackId || 'Session') + panelSuffix;
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

function basenameFromPath(value) {
  const text = safeString(value).replace(/\\/g, '/').replace(/\/+$/, '').trim();
  if (!text) return '';
  return text.split('/').filter(Boolean).pop() || text;
}

function normalizePathForDisplay(value) {
  return safeString(value).replace(/\\/g, '/').replace(/\/+$/, '').trim();
}

function looksLikeAbsolutePath(value) {
  const text = normalizePathForDisplay(value);
  return /^[A-Za-z]:\//.test(text) || text.startsWith('//') || text.startsWith('/');
}

function isUserHomeOrDocumentsPath(value) {
  const text = normalizePathForDisplay(value).toLowerCase();
  return /^[a-z]:\/users\/[^/]+$/.test(text)
    || /^[a-z]:\/users\/[^/]+\/documents$/.test(text)
    || /^\/users\/[^/]+$/.test(text)
    || /^\/users\/[^/]+\/documents$/.test(text)
    || /^\/home\/[^/]+$/.test(text);
}

function userProfileNameFromPath(value) {
  const text = normalizePathForDisplay(value);
  const windowsMatch = text.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);
  if (windowsMatch) return windowsMatch[1];
  const unixMatch = text.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
  return unixMatch ? unixMatch[1] : '';
}

function isUserHomeWorkspaceName(nameValue, pathValue) {
  const profileName = userProfileNameFromPath(pathValue);
  return Boolean(profileName) && safeString(nameValue).trim().toLowerCase() === profileName.toLowerCase();
}

function stripWorkspaceDecorations(value) {
  return safeString(value)
    .replace(/\s+\(Workspace\)$/i, '')
    .replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i, '')
    .trim();
}

function isEditorAppChromeLabel(value) {
  const text = safeString(value).trim();
  return /^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.test(text);
}

function hasEditorAppChromeSuffix(value) {
  return /\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.test(safeString(value));
}

function parseVSCodeWindowParts(value) {
  const raw = safeString(value).trim();
  if (!raw) return [];
  const parts = raw.split(/\s+-\s+/).map(part => stripWorkspaceDecorations(part)).filter(Boolean);
  while (parts.length && isEditorAppChromeLabel(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts;
}

const IMAGE_TITLE_RE = /\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i;
const ABSOLUTE_PATH_TITLE_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i;
const FILE_ACTION_TITLE_RE = /^(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|cat|get-content|select-string)\b/i;

function stripTitleAttachmentNoise(value) {
  return safeString(value)
    .replace(/!\[[^\]]*\]\(\s*(?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg)[^)]*)\)/gi, ' ')
    .replace(/\[File:\s*[^\]]+\]/gi, ' ')
    .replace(ABSOLUTE_PATH_TITLE_RE, ' ')
    .replace(IMAGE_TITLE_RE, ' ')
    .replace(/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*(?:\d{2,}\s*[x\u00d7]\s*\d{2,})\b/gi, ' ')
    .replace(/\b(?:file|image|screenshot|attached|uploaded|read|open|view|inspect|check|review|show|load|get-content|select-string)\b/gi, ' ')
    .replace(/[\s:;,.()[\]{}'"`/\\|-]+/g, ' ')
    .trim();
}

function isLowSignalChatTitle(value) {
  const text = safeString(value).trim();
  if (!text) return false;
  if (/^!\[[^\]]*\]\(\s*(?:data:image\/|\/uploads\/|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))/i.test(text)) return true;
  if (/^\[File:\s*[^\]]+\]/i.test(text)) return true;
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)/i.test(text)) return true;

  const hasImageName = IMAGE_TITLE_RE.test(text);
  const hasPath = ABSOLUTE_PATH_TITLE_RE.test(text);
  if (hasImageName && stripTitleAttachmentNoise(text).length < 12) return true;
  if (hasPath && (FILE_ACTION_TITLE_RE.test(text) || stripTitleAttachmentNoise(text).length < 16)) return true;
  if (/^(?:image|screenshot|screen\s*shot|capture)\b/i.test(text) && stripTitleAttachmentNoise(text).length < 16) return true;
  if (/^!\[[^\]]*\]\(\s*data:image\//i.test(text)) return true;
  if (/^\[File:\s*[^\\\]]+\.(png|jpe?g|gif|webp|bmp|svg)(?:\b|[0-9x×])/i.test(text)) return true;
  if (/^(image|screenshot)[\w .-]*\.(png|jpe?g|gif|webp|bmp|svg)(?:\b|[0-9x×])/i.test(text)) return true;
  if (/^(?:[A-Za-z]:\\|\/|\\\\).+\.(png|jpe?g|gif|webp|bmp|svg|md|js|jsx|ts|tsx|json|log|txt)\b/i.test(text)) return true;
  return false;
}

const LOW_SIGNAL_WORKSPACE_LABELS = new Set([
  'agent',
  'agent manager',
  'agent session',
  'antigravity',
  'antigravity chat',
  'antigravity v2',
  'claude',
  'claude code',
  'codex',
  'codex cli',
  'codex desktop',
  'connected session',
  'other',
  'session',
  'unknown',
]);

const LOW_SIGNAL_WORKSPACE_KEYS = new Set(
  Array.from(LOW_SIGNAL_WORKSPACE_LABELS, label => label.replace(/[^a-z0-9]+/g, ''))
);

function humanizeWorkspaceLabel(value) {
  const stripped = stripWorkspaceDecorations(value);
  if (!stripped) return '';
  const base = basenameFromPath(stripped);
  const hadWordSeparators = /[-_]/.test(base);
  let label = base.replace(/[-_]+/g, ' ');
  if (hadWordSeparators || !/\s/.test(base)) {
    label = label.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return label
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowSignalWorkspaceLabel(value) {
  const label = humanizeWorkspaceLabel(value).toLowerCase();
  if (!label) return true;
  if (/^window\s+\d+$/.test(label)) return true;
  if (isEditorAppChromeLabel(label)) return true;
  if (LOW_SIGNAL_WORKSPACE_LABELS.has(label)) return true;
  const compact = label.replace(/[^a-z0-9]+/g, '');
  return LOW_SIGNAL_WORKSPACE_KEYS.has(compact);
}

function workspaceLabelsEqual(left, right) {
  return safeString(left).toLowerCase() === safeString(right).toLowerCase();
}

function makeWorkspaceCandidate(label, key) {
  const display = humanizeWorkspaceLabel(label);
  if (isLowSignalWorkspaceLabel(display)) return null;
  return {
    label: display,
    key: safeString(key || display).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(),
  };
}

function pathWorkspaceCandidate(pathValue) {
  const pathText = normalizePathForDisplay(pathValue);
  if (!pathText || !looksLikeAbsolutePath(pathText) || isUserHomeOrDocumentsPath(pathText)) return null;
  return makeWorkspaceCandidate(basenameFromPath(pathText), pathText);
}

function vscodeWorkspaceCandidate(titleValue) {
  const parts = parseVSCodeWindowParts(titleValue);
  if (parts.length < 2) return null;
  return makeWorkspaceCandidate(parts[parts.length - 1], parts[parts.length - 1]);
}

function namedWorkspaceCandidate(value) {
  const raw = safeString(value);
  if (hasEditorAppChromeSuffix(raw)) return null;
  const text = stripWorkspaceDecorations(value);
  if (!text || looksLikeAbsolutePath(text)) return null;
  if (parseVSCodeWindowParts(text).length >= 2) return null;
  return makeWorkspaceCandidate(text, text);
}

function workspaceTextVariants(label) {
  const base = safeString(label).toLowerCase().trim();
  return [
    base,
    base.replace(/\s+/g, '-'),
    base.replace(/\s+/g, ''),
  ].filter(Boolean);
}

function knownWorkspaceCandidateFromText(values, knownWorkspaces = []) {
  const textFields = values.map(value => safeString(value).toLowerCase()).filter(Boolean);
  const sortedKnown = [...knownWorkspaces].sort((a, b) => b.label.length - a.label.length);
  for (const known of sortedKnown) {
    const variants = workspaceTextVariants(known.label);
    if (textFields.some(text => variants.some(variant => variant && text.includes(variant)))) {
      return known;
    }
  }
  return null;
}

function workspaceCandidateFromSession(sessionOrId, agentConfig, knownWorkspaces = []) {
  if (!sessionOrId || typeof sessionOrId !== 'object') return null;

  const knownMatch = knownWorkspaceCandidateFromText([
    sessionOrId.window_title,
    sessionOrId.workspace_name,
    sessionOrId.chat_title,
    sessionOrId.session_title,
  ], knownWorkspaces);

  const directCandidates = [
    pathWorkspaceCandidate(sessionOrId.workspace_path),
    pathWorkspaceCandidate(agentConfig?.file_access_scope),
    knownMatch,
    vscodeWorkspaceCandidate(sessionOrId.window_title),
    vscodeWorkspaceCandidate(sessionOrId.workspace_name),
    isUserHomeWorkspaceName(sessionOrId.workspace_name, sessionOrId.workspace_path) ? null : namedWorkspaceCandidate(sessionOrId.workspace_name),
  ].filter(Boolean);
  if (directCandidates.length > 0) {
    const candidate = directCandidates[0];
    return knownWorkspaces.find(known => workspaceLabelsEqual(known.label, candidate.label)) || candidate;
  }

  const textFields = [
    sessionOrId.chat_title,
    sessionOrId.session_title,
    sessionOrId.title,
    sessionOrId.display_title,
    sessionOrId.window_title,
    sessionOrId.workspace_name,
  ].map(value => safeString(value).toLowerCase()).filter(Boolean);
  const textMatch = knownWorkspaceCandidateFromText(textFields, knownWorkspaces);
  if (textMatch) return textMatch;

  return null;
}

function collectKnownWorkspaceCandidates(sessionList, agentConfigs = {}) {
  const byLabel = new Map();
  function remember(candidate) {
    if (!candidate) return;
    const labelKey = candidate.label.toLowerCase();
    const existing = byLabel.get(labelKey);
    if (!existing || (looksLikeAbsolutePath(candidate.key) && !looksLikeAbsolutePath(existing.key))) {
      byLabel.set(labelKey, candidate);
    }
  }
  for (const session of sessionList || []) {
    const id = sessionIdOf(session);
    const config = id ? agentConfigs[id] : null;
    if (!session || typeof session !== 'object') continue;
    [
      pathWorkspaceCandidate(session.workspace_path),
      vscodeWorkspaceCandidate(session.window_title),
      vscodeWorkspaceCandidate(session.workspace_name),
      isUserHomeWorkspaceName(session.workspace_name, session.workspace_path) ? null : namedWorkspaceCandidate(session.workspace_name),
      pathWorkspaceCandidate(config?.file_access_scope),
    ].forEach(remember);
  }
  return Array.from(byLabel.values());
}

function workspaceGroupCandidate(sessionOrId, agentConfig, knownWorkspaces = []) {
  const candidate = workspaceCandidateFromSession(sessionOrId, agentConfig, knownWorkspaces);
  if (candidate && !isLowSignalWorkspaceLabel(candidate.label)) return candidate;
  return null;
}

function sidebarWorkspaceLabel(sessionOrId, agentConfig, knownWorkspaces = []) {
  return workspaceGroupCandidate(sessionOrId, agentConfig, knownWorkspaces)?.label || 'Unscoped Sessions';
}

function sidebarWorkspaceKey(sessionOrId, agentConfig, knownWorkspaces = []) {
  const candidate = workspaceGroupCandidate(sessionOrId, agentConfig, knownWorkspaces);
  return candidate?.key || 'unscoped-sessions';
}

function compactSessionId(value) {
  const id = safeString(value).trim();
  if (!id) return '';
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function stripTitleNoise(content) {
  return normalizeMessageContent(content)
    .replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi, ' ')
    .replace(/\[File:\s*[^\]]+\]/gi, ' ')
    .replace(ABSOLUTE_PATH_TITLE_RE, ' ')
    .replace(IMAGE_TITLE_RE, ' ')
    .replace(/<goal_context>[\s\S]*?<\/goal_context>/gi, ' ')
    .replace(/<[^>\n]{1,80}>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromMessageContent(content) {
  const originalText = normalizeMessageContent(content);
  if (isLowSignalChatTitle(originalText)) return '';
  const text = stripTitleNoise(content);
  if (!text || isLowSignalChatTitle(text)) return '';
  if (/^(thinking|working|tool result|tool:|exit code|wall time)\b/i.test(text)) return '';
  if (/^(?:read|open|view|inspect|check|review|show|load|attach|attached|uploaded|cat|get-content|select-string|file|image|screenshot|cli)$/i.test(text)) return '';
  if (/^[^A-Za-z0-9]+$/.test(text)) return '';
  return text.slice(0, 80).trim();
}

function titleFromSessionMessages(sessionMessages) {
  const list = Array.isArray(sessionMessages) ? sessionMessages : [];
  const sample = list.length > 80
    ? [...list.slice(0, 40), ...list.slice(-40)]
    : list;
  const user = sample.find(msg => msg?.role === 'user' && titleFromMessageContent(msg.content));
  if (user) return titleFromMessageContent(user.content);
  const any = sample.find(msg => titleFromMessageContent(msg?.content || contentBlocksFallback(msg?.content_blocks)));
  return any ? titleFromMessageContent(any.content || contentBlocksFallback(any.content_blocks)) : '';
}

function sidebarChatTitle(sessionOrId, fallbackId, agentConfig, sessionMessages = []) {
  const agent = sessionAgent(sessionOrId, agentConfig);
  if (sessionOrId && typeof sessionOrId === 'object') {
    const explicit = safeString(
      sessionOrId.chat_title
      || sessionOrId.session_title
      || sessionOrId.title
      || sessionOrId.display_title
    ).trim();
    if (explicit && !isLowSignalChatTitle(explicit)) return explicit;

    const messageTitle = titleFromSessionMessages(sessionMessages);
    if (messageTitle) return messageTitle;
    if (explicit) return explicit;
  }
  const id = fallbackId || sessionIdOf(sessionOrId);
  if (typeof id === 'string' && id && !isUuidLike(id) && !/[\\/:]/.test(id) && id.length <= 48) return id;
  const shortId = compactSessionId(id);
  if (shortId) return `${agent.name || 'Session'} ${shortId}`;
  return agent.name || 'Session';
}

function groupSessionsByWorkspace(sessionList, agentConfigs = {}) {
  const groups = [];
  const byKey = new Map();
  const knownWorkspaces = collectKnownWorkspaceCandidates(sessionList, agentConfigs);
  for (const session of sessionList || []) {
    const id = sessionIdOf(session);
    const config = id ? agentConfigs[id] : null;
    const candidate = workspaceGroupCandidate(session, config, knownWorkspaces);
    const label = candidate?.label || 'Unscoped Sessions';
    const key = candidate?.key || 'unscoped-sessions';
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, sessions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
}

function workspaceKeyOf(sessionOrId) {
  if (!sessionOrId || typeof sessionOrId !== 'object') return null;
  if (sessionOrId.workspace_path) return safeString(sessionOrId.workspace_path).toLowerCase();
  const raw = safeString(sessionOrId.workspace_name || sessionOrId.window_title || '');
  if (!raw) return null;
  return raw.split(' / ')[0].trim().toLowerCase() || null;
}

function findVisiblePaneSession(sessionList, targetSession) {
  const targetId = sessionIdOf(targetSession);
  const targetKey = workspaceKeyOf(targetSession);
  if (!targetKey) return null;
  return (sessionList || []).find(session =>
    session
    && typeof session === 'object'
    && session.agent_type === 'antigravity_panel'
    && sessionIdOf(session) !== targetId
    && workspaceKeyOf(session) === targetKey
  ) || null;
}

function formatPaneSummary(session) {
  if (!session || typeof session !== 'object') return '';
  return [
    session.panel_title || null,
    session.panel_model || null,
    session.panel_mode || null,
  ].filter(Boolean).join(' · ');
}

function sortSessionsForDisplay(sessionList) {
  return [...(sessionList || [])].sort((left, right) => {
    const a = typeof left === 'object' ? left : { session_id: left };
    const b = typeof right === 'object' ? right : { session_id: right };
    const aPanel = a.agent_type === 'antigravity_panel' ? 1 : 0;
    const bPanel = b.agent_type === 'antigravity_panel' ? 1 : 0;
    if (aPanel !== bPanel) return bPanel - aPanel;
    const aSeen = safeString(a.last_seen_at || '');
    const bSeen = safeString(b.last_seen_at || '');
    return bSeen.localeCompare(aSeen);
  });
}

function formatVisiblePaneSummary(session) {
  if (!session || typeof session !== 'object') return '';
  if (session.visible_pane_visible) {
    return [
      session.visible_pane_title || null,
      session.visible_pane_location === 'right' ? 'Right Pane' : null,
    ].filter(Boolean).join(' · ');
  }
  return formatPaneSummary(session);
}

function formatAntigravityQuotaLabel(modelName) {
  const raw = safeString(modelName);
  if (!raw) return '';
  return raw
    .replace(/^Gemini\s+/i, 'G ')
    .replace(/^Claude\s+/i, '')
    .replace(/\s*\(Thinking\)\s*/i, '')
    .replace(/\s*\(Medium\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAntigravityQuotaSummary(models, maxItems = 3) {
  if (!Array.isArray(models) || models.length === 0) return '';
  return models
    .slice(0, maxItems)
    .map(entry => {
      const pct = entry?.percent_used;
      if (pct == null) return null;
      const label = formatAntigravityQuotaLabel(entry?.model);
      if (!label) return null;
      return `${label} ${pct}%`;
    })
    .filter(Boolean)
    .join(' · ');
}

function agentTypeLabel(agentType) {
  if (!agentType) return '';
  return AGENT_CONFIG[agentType]?.name || agentType;
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
    if (status === 'failed')   return <span className="delivery failed"   title={msg._sendError || "Failed — agent may be offline"}>✕</span>;
  }
  if (msg._delivered) return <span className="delivery delivered" title="Delivered to agent">✓✓</span>;
  return <span className="delivery delivered" title="Sent">✓</span>;
}

// Memoized transcript rows keep live status ticks from repainting Markdown/code blocks.
function TranscriptMessage({
  msg,
  messageKey,
  activeAgent,
  assistantMonospace,
  autoExpandLongCodeBlocks,
  onOpenPath,
  agentType,
  preview,
  fileContents,
  onClosePreview,
  deliveryState,
  onSteer,
}) {
  const normalizedContent = normalizeMessageContent(msg.content) || contentBlocksFallback(msg.content_blocks);
  const renderableUserContent = recoverUploadedImageMarkdown(msg.content);
  const timestampLabel = formatMessageTimestamp(msg.ts);
  const hasStructuredBlocks = msg.role !== 'user' && normalizeContentBlocks(msg.content_blocks).length > 0;
  if (msg.role === 'user') {
    const deliveryStatesForMessage = msg._cid ? { [msg._cid]: deliveryState } : {};
    return (
      <div className={`message user${msg._optimistic && deliveryState === 'failed' ? ' failed' : ''}`}>
        <div className="user-gutter">
          <div className="user-glyph" />
        </div>
        <div className="user-content">
          <div className="message-role">
            <span>You</span>
            {timestampLabel && <span className="message-timestamp">{timestampLabel}</span>}
            <DeliveryStatus msg={msg} deliveryStates={deliveryStatesForMessage} onSteer={onSteer} />
          </div>
          {/!\[[^\]]*\]\((?:data:|\/uploads\/)/.test(renderableUserContent) ? (
            <div className="user-text"><MarkdownContent content={renderableUserContent} /></div>
          ) : (
            <div className="user-text">{normalizedContent}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`message assistant${assistantMonospace ? ' monospace' : ''}`}>
      <div className="assistant-gutter">
        <div
          className="agent-badge transcript-agent-badge"
          style={{ color: activeAgent.color, borderColor: activeAgent.color + '55', background: activeAgent.color + '18' }}
        >
          {activeAgent.logo
            ? <img src={activeAgent.logo} alt={activeAgent.abbr} className="agent-badge-logo" />
            : activeAgent.abbr}
        </div>
      </div>
      <div className="assistant-content">
        <div className="message-role">
          <span>{activeAgent.name}</span>
          {timestampLabel && <span className="message-timestamp">{timestampLabel}</span>}
        </div>
        {hasStructuredBlocks ? (
          <ContentBlocks
            blocks={msg.content_blocks}
            monospace={assistantMonospace}
            autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
            onOpenPath={(path) => onOpenPath(messageKey, path)}
            agentType={agentType}
          />
        ) : (
          <MarkdownContent
            content={normalizeMessageContent(msg.content)}
            monospace={assistantMonospace}
            autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
            onOpenPath={(path) => onOpenPath(messageKey, path)}
          />
        )}
        {preview && (
          <TranscriptInlineFilePreview
            sessionId={preview.sessionId}
            filePath={preview.path}
            fileContents={fileContents}
            onClose={onClosePreview}
          />
        )}
      </div>
    </div>
  );
}

function transcriptPreviewKey(preview) {
  return preview ? `${preview.sessionId}\u0001${preview.messageKey}\u0001${preview.path}` : '';
}

function activeAgentKey(agent) {
  return [agent?.name, agent?.color, agent?.abbr, agent?.logo || ''].join('\u0001');
}

function areTranscriptMessagePropsEqual(prev, next) {
  return prev.msg === next.msg
    && prev.messageKey === next.messageKey
    && prev.assistantMonospace === next.assistantMonospace
    && prev.autoExpandLongCodeBlocks === next.autoExpandLongCodeBlocks
    && prev.agentType === next.agentType
    && activeAgentKey(prev.activeAgent) === activeAgentKey(next.activeAgent)
    && transcriptPreviewKey(prev.preview) === transcriptPreviewKey(next.preview)
    && prev.fileContents === next.fileContents
    && prev.deliveryState === next.deliveryState;
}

const MemoTranscriptMessage = React.memo(TranscriptMessage, areTranscriptMessagePropsEqual);

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

function SessionCard({ session, health, unread, isThinking, isActive, agentConfig, activity, sessionMessages, hasBlockingPrompt, blockingPromptLabel, onSelect, onClose, onAutomations, showAutomationsActive, onSkills, showSkillsActive }) {
  const sessionId = sessionIdOf(session);
  const agent    = sessionAgent(session, agentConfig);
  const winLabel = sessionSubLabel(session, sessionId, agentConfig);
  const chatTitle = sidebarChatTitle(session, sessionId, agentConfig, sessionMessages);
  const cardTitle = [chatTitle, winLabel || agent.name].filter(Boolean).join(' - ');
  const dotColor = HEALTH_COLOR[health] || '#444c56';
  const rateLimitedUntil = session?.rate_limited_until || null;
  const isHardLimited = session?.rate_limit_active === true;
  const pctUsed = session?.percent_used;
  const isAntigravitySession = session?.agent_type === 'antigravity' || session?.agent_type === 'antigravity_panel';
  const quotaSummary = isAntigravitySession ? formatAntigravityQuotaSummary(session?.antigravity_quota_models, 3) : '';
  const activityLabel = isThinking && activity?.label ? activity.label : null;

  return (
    <div
      className={`session-card${isActive ? ' active' : ''}${isHardLimited ? ' rate-limited' : ''}`}
      onClick={onSelect}
      title={cardTitle || sessionId}
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
        <div className="session-card-name">{chatTitle}</div>
        <div className={`session-card-sub${hasBlockingPrompt ? ' perm-active' : ''}`}>
          {hasBlockingPrompt ? (blockingPromptLabel || 'Action required')
            : isHardLimited ? `⏳ Rate limited${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · ${rateLimitedUntil}` : ''}`
            : quotaSummary ? quotaSummary
            : isAntigravitySession && pctUsed != null ? `📊 ${pctUsed}% used${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · ${rateLimitedUntil}` : ''}`
            : pctUsed >= 80 ? `📊 ${pctUsed}% used`
            : activityLabel ? activityLabel
            : agent.name}
        </div>
      </div>
      <div className="session-card-right">
        {hasBlockingPrompt && <div className="session-card-perm-badge" title={blockingPromptLabel || 'Action required'}>⚠</div>}
        {isThinking  && <div className="session-card-spinner" title={activityLabel || 'Thinking…'} />}
        {!isThinking && !hasBlockingPrompt && unread > 0 && (
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

function sessionCardMessagesKey(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return '0';
  const first = list[0];
  const last = list[list.length - 1];
  return [
    list.length,
    first?.role || '',
    safeString(first?.content).slice(0, 120),
    last?.role || '',
    safeString(last?.content).slice(0, 120),
  ].join('\u0001');
}

function sessionCardAgentConfigKey(config) {
  if (!config) return '';
  return [
    config.model_id || '',
    config.effort || '',
    config.permission_mode || '',
    config.file_access_scope || '',
  ].join('\u0001');
}

function sessionCardActivityKey(activity) {
  if (!activity) return '';
  return [
    activity.kind || '',
    activity.label || '',
    activity.goal?.status || '',
    activity.goal?.label || '',
  ].join('\u0001');
}

function areSessionCardPropsEqual(prev, next) {
  return prev.session === next.session
    && prev.health === next.health
    && prev.unread === next.unread
    && prev.isThinking === next.isThinking
    && prev.isActive === next.isActive
    && prev.hasBlockingPrompt === next.hasBlockingPrompt
    && prev.blockingPromptLabel === next.blockingPromptLabel
    && prev.showAutomationsActive === next.showAutomationsActive
    && prev.showSkillsActive === next.showSkillsActive
    && sessionCardAgentConfigKey(prev.agentConfig) === sessionCardAgentConfigKey(next.agentConfig)
    && sessionCardActivityKey(prev.activity) === sessionCardActivityKey(next.activity)
    && sessionCardMessagesKey(prev.sessionMessages) === sessionCardMessagesKey(next.sessionMessages);
}

const MemoSessionCard = React.memo(SessionCard, areSessionCardPropsEqual);

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

function formatActivityElapsed(updatedAt, nowMs) {
  const started = updatedAt ? new Date(updatedAt).getTime() : 0;
  if (!Number.isFinite(started) || started <= 0) return '';
  const totalSeconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  return formatClockDuration(totalSeconds, { includeSeconds: true });
}

function formatClockDuration(totalSeconds, { includeSeconds = false } = {}) {
  totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return includeSeconds ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, '0')}m`;
}

function formatGoalElapsed(goal, nowMs) {
  if (!goal) return '';
  const base = Number(goal.time_used_seconds ?? goal.timeUsedSeconds ?? 0) || 0;
  const updated = goal.updated_at ? new Date(goal.updated_at).getTime() : 0;
  const liveDelta = goal.status === 'active' && Number.isFinite(updated) && updated > 0
    ? Math.max(0, Math.floor((nowMs - updated) / 1000))
    : 0;
  return formatClockDuration(base + liveDelta);
}

function ActivityRow({ activity, thinkingText, isClaude, pinned = false, showGoal = true, showStatus = true, showCommand = true }) {
  const kind = activity?.kind || 'working';
  const meta = ACTIVITY_META[kind] || ACTIVITY_META.working;
  const goal = activity?.goal || null;
  const isActive = meta.tone === 'thinking' || meta.tone === 'info';
  const goalActive = goal?.status === 'active';
  const [nowMs, setNowMs] = React.useState(Date.now());
  React.useEffect(() => {
    if ((!isActive || !(activity?.startedAt || activity?.updatedAt)) && !goalActive) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, activity?.startedAt, activity?.updatedAt, goalActive, goal?.updated_at]);
  const rawLabel = activity?.label ?? '';
  const baseLabel = rawLabel || (kind === 'idle' && goal ? '' : kind.replaceAll('_', ' '));
  const elapsed = isActive ? formatActivityElapsed(activity?.startedAt || activity?.updatedAt, nowMs) : '';
  const hint = activity?.interruptHint || activity?.interrupt_hint || '';
  const labelDetail = [elapsed, hint].filter(Boolean).join(' • ');
  const label = baseLabel && labelDetail ? `${baseLabel} (${labelDetail})` : baseLabel;
  const goalElapsed = goal ? formatGoalElapsed(goal, nowMs) : '';
  const isThinkingKind = kind === 'thinking' || kind === 'generating';
  const showBlob = isClaude && isThinkingKind;
  const visibleThinkingText = showBlob ? '' : (thinkingText || activity?.thinkingContent || '').trim();

  return (
    <div className={`activity-row ${meta.tone}${isActive ? ' active' : ''}${showBlob ? ' claude-thinking' : ''}${pinned ? ' pinned' : ''}`}>
      {!showBlob && (
        <div className="activity-icon">
          {isActive
            ? <div className="activity-spinner" />
            : meta.icon}
        </div>
      )}
      <div className="activity-copy">
        {showGoal && goal && (
          <div className="activity-goal" title={goal.objective || ''}>
            <span>{goal.label || 'Pursuing goal'}</span>
            {goalElapsed && <span className="activity-goal-time">({goalElapsed})</span>}
          </div>
        )}
        {showStatus && (label || showBlob) && (
          <div className={`activity-label${showBlob ? ' inline-blob' : ''}`}>
            {showBlob && <ClaudeSpinner />}
            {label && <span>{label}</span>}
          </div>
        )}
        {showCommand && isActive && visibleThinkingText && (
          showBlob ? (
            <div className="thinking-inline-text">
              {visibleThinkingText}
            </div>
          ) : (
            <div className="activity-command">
              <code>{visibleThinkingText}</code>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TaskList({ taskList, sessionId }) {
  if (!taskList || !taskList.tasks || taskList.tasks.length === 0) return null;
  const storageKey = sessionId ? `remote-agent-chat:task-list-collapsed:${sessionId}` : null;
  const defaultCollapsed = taskList.tasks.length > 8;
  const [collapsed, setCollapsed] = React.useState(() => {
    if (!storageKey) return defaultCollapsed;
    const saved = localStorage.getItem(storageKey);
    return saved == null ? defaultCollapsed : saved === '1';
  });

  React.useEffect(() => {
    if (!storageKey) {
      setCollapsed(defaultCollapsed);
      return;
    }
    const saved = localStorage.getItem(storageKey);
    setCollapsed(saved == null ? defaultCollapsed : saved === '1');
  }, [storageKey, defaultCollapsed]);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
      return next;
    });
  };

  const stateIcon = { completed: '\u2713', in_progress: '\u25CC', pending: '\u25CB' };
  const stateCls = { completed: 'done', in_progress: 'active', pending: '' };
  const activeTask = taskList.tasks.find(t => t.state === 'in_progress');
  return (
    <div className={`codex-task-list${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="codex-task-header"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand task list' : 'Collapse task list'}
      >
        <span className="codex-task-chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
        <span className="codex-task-count">{taskList.completed}/{taskList.total} tasks</span>
        {collapsed && activeTask?.text && (
          <span className="codex-task-active-summary">{activeTask.text}</span>
        )}
      </button>
      {!collapsed && (
        <div className="codex-task-items">
          {taskList.tasks.map((t, i) => (
            <div key={i} className={`codex-task-item ${stateCls[t.state] || ''}`}>
              <span className="codex-task-icon">{stateIcon[t.state] || '\u25CB'}</span>
              <span className="codex-task-text">{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClineContextCard({ card, tone = 'cline' }) {
  if (!card) return null;
  const pct = Number.isFinite(Number(card.percent_used))
    ? Math.max(0, Math.min(100, Number(card.percent_used)))
    : null;
  const title = safeString(card.title || 'Current context');
  const subtitle = safeString(card.subtitle || '');
  const detail = safeString(card.detail || '');
  const usageLabel = safeString(card.label || card.usage_label || '');

  return (
    <div className={`cline-context-card ${tone}-context-card`}>
      <div className="cline-context-header">
        <div className="cline-context-copy">
          <div className="cline-context-title">{title}</div>
          {subtitle && <div className="cline-context-subtitle">{subtitle}</div>}
          {detail && <div className="cline-context-detail">{detail}</div>}
        </div>
        {usageLabel && <div className="cline-context-usage">{usageLabel}</div>}
      </div>
      {pct != null && (
        <div className="cline-context-meter" title={`${card.percent_used}% of context window used`}>
          <div className="cline-context-meter-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
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

function errorPromptActionLabel(action) {
  return safeString(action?.label, 'Action');
}

function isBlockingErrorPrompt(prompt) {
  return !!prompt && prompt.blocking !== false && prompt.display_mode !== 'inline';
}

function ErrorPromptOverlay({ prompt, sessionId, onRespond }) {
  const actions = Array.isArray(prompt?.actions) ? prompt.actions : [];
  const submittingActionId = prompt?.submitting_action_id || null;
  const errorOutput = safeString(prompt?.error_output).trim();

  return (
    <div className="permission-overlay">
      <div className="permission-card error-prompt-card">
        <div className="permission-eyebrow error-prompt-eyebrow">Action Required</div>
        <div className="permission-title">{safeString(prompt?.title, 'Error handling model response')}</div>
        <div className="permission-body">{safeString(prompt?.message, 'There was an error handling the model response.')}</div>
        {errorOutput && (
          <div className="error-prompt-output-wrap">
            <div className="error-prompt-output-label">Error Output</div>
            <pre className="error-prompt-output">{errorOutput}</pre>
          </div>
        )}
        {prompt?.error && <div className="permission-error">{prompt.error}</div>}
        <div className="permission-actions">
          {actions.map(action => {
            const actionId = safeString(action?.action_id);
            const isPending = submittingActionId === actionId;
            return (
              <button
                key={actionId || errorPromptActionLabel(action)}
                className={`permission-action error-prompt-action${isPending ? ' pending' : ''}`}
                disabled={!!submittingActionId}
                onClick={() => onRespond(sessionId, prompt.prompt_id, actionId)}
              >
                <span>{errorPromptActionLabel(action)}</span>
                {isPending && <span className="permission-action-state">Sending...</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ErrorPromptInline({ prompt, sessionId, onRespond }) {
  const actions = Array.isArray(prompt?.actions) ? prompt.actions : [];
  const submittingActionId = prompt?.submitting_action_id || null;
  const errorOutput = safeString(prompt?.error_output).trim();

  return (
    <div className="inline-error-prompt">
      <div className="inline-error-prompt-body">
        <div className="inline-error-prompt-message">{safeString(prompt?.message, 'There was an error handling the model response.')}</div>
        {errorOutput && <pre className="inline-error-prompt-output">{errorOutput}</pre>}
        {prompt?.error && <div className="permission-error">{prompt.error}</div>}
      </div>
      <div className="inline-error-prompt-actions">
        {actions.map(action => {
          const actionId = safeString(action?.action_id);
          const isPending = submittingActionId === actionId;
          return (
            <button
              key={actionId || errorPromptActionLabel(action)}
              className={`permission-action error-prompt-action${isPending ? ' pending' : ''}`}
              disabled={!!submittingActionId}
              onClick={() => onRespond(sessionId, prompt.prompt_id, actionId)}
            >
              <span>{errorPromptActionLabel(action)}</span>
              {isPending && <span className="permission-action-state">Sending...</span>}
            </button>
          );
        })}
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
  const [claudeCliModel, setClaudeCliModel] = React.useState('deepseek-v4-pro:cloud');
  const [codexCliModel, setCodexCliModel] = React.useState('gpt-5.5');
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
    const launchOptions = agentType === 'claude_cli'
      ? { model_id: claudeCliModel.trim() || 'default' }
      : agentType === 'codex_cli'
      ? { model_id: codexCliModel.trim() || 'gpt-5.5', permission_mode: 'workspace-write', effort: 'medium' }
      : {};
    const rid = onLaunch(agentType, wsPath || undefined, launchOptions);
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
          {agentType === 'claude_cli' && (
            <input
              className="new-session-workspace"
              type="text"
              placeholder="Claude CLI model, e.g. deepseek-v4-pro:cloud"
              value={claudeCliModel}
              onChange={e => setClaudeCliModel(e.target.value)}
              disabled={isLaunching}
            />
          )}
          {agentType === 'codex_cli' && (
            <select
              className="new-session-workspace"
              value={codexCliModel}
              onChange={e => setCodexCliModel(e.target.value)}
              disabled={isLaunching}
            >
              {KNOWN_CODEX_CLI_MODELS.map(model => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
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
  claude_cli: [
    { value: 'default',           label: 'Default' },
    { value: 'acceptEdits',       label: 'Accept edits' },
    { value: 'auto',              label: 'Auto' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
    { value: 'dontAsk',           label: 'Do not ask' },
    { value: 'plan',              label: 'Plan' },
  ],
  continue_yolo: [
    { value: 'ask',    label: 'Ask for permissions' },
    { value: 'bypass', label: 'Bypass permissions' },
  ],
  roo_code: [
    { value: 'BRRR',         label: 'BRRR' },
    { value: 'YOLO',         label: 'YOLO' },
    { value: 'Ask',          label: 'Ask' },
    { value: 'Auto-approve', label: 'Auto-approve' },
  ],
  cline: [
    { value: 'YOLO', label: 'YOLO' },
  ],
  codex_cli: [
    { value: 'read-only',          label: 'Read only' },
    { value: 'workspace-write',    label: 'Workspace write' },
    { value: 'danger-full-access', label: 'Full access' },
  ],
  codex:  [],  // Codex permission mode not configurable via settings
  gemini: [],  // Gemini permission mode not configurable via settings
};

function defaultPermissionModeFor(agentType) {
  if (agentType === 'codex_cli') return 'workspace-write';
  if (agentType === 'continue_yolo' || agentType === 'roo_code' || agentType === 'cline') return 'ask';
  return 'default';
}

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
  { id: 'deepseek-v4-pro:cloud',   label: 'DeepSeek V4 Pro (Ollama Cloud)' },
];

const KNOWN_CODEX_CLI_MODELS = [
  { id: 'gpt-5.5',                     label: 'GPT-5.5' },
  { id: 'gpt-5.4',                     label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',                label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex',               label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',               label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2',                     label: 'GPT-5.2' },
  { id: 'gpt-5.1-codex',               label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1',                     label: 'GPT-5.1' },
  { id: 'gpt-5',                       label: 'GPT-5' },
  { id: 'ollama:deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)' },
  { id: 'ollama:kimi-k2.6:cloud',       label: 'Kimi K2.6 (Ollama Cloud)' },
];

const ANTIGRAVITY_MODES = [
  { id: 'Planning', label: 'Planning' },
  { id: 'Fast',     label: 'Fast' },
];

const ROO_CODE_MODES = [
  { id: 'Architect',    label: 'Architect' },
  { id: 'Code',         label: 'Code' },
  { id: 'Ask',          label: 'Ask' },
  { id: 'Debug',        label: 'Debug' },
  { id: 'Orchestrator', label: 'Orchestrator' },
];

const CLINE_MODES = [
  { id: 'Plan', label: 'Plan' },
  { id: 'Act',  label: 'Act' },
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

function composerModelOptionsFor(agentType, config) {
  if (Array.isArray(config?.available_models) && config.available_models.length > 0) {
    return config.available_models.map(model => (
      typeof model === 'string' ? { id: model, label: model } : model
    ));
  }
  if (agentType === 'continue_yolo' || agentType === 'continue' || agentType === 'roo_code' || agentType === 'cline') return [];
  if (agentType === 'claude_cli') return KNOWN_CLAUDE_MODELS;
  if (agentType === 'codex_cli') return KNOWN_CODEX_CLI_MODELS;
  if (agentType === 'antigravity' || agentType === 'antigravity_panel') return KNOWN_ANTIGRAVITY_MODELS;
  if (agentType === 'gemini') return KNOWN_GEMINI_MODELS;
  return KNOWN_CLAUDE_MODELS;
}

function modeOptionsFor(agentType, config) {
  if (Array.isArray(config?.available_modes) && config.available_modes.length > 0) {
    return config.available_modes.map(mode => (
      typeof mode === 'string' ? { id: mode, label: mode } : mode
    ));
  }
  if (agentType === 'roo_code') return ROO_CODE_MODES;
  if (agentType === 'cline') return CLINE_MODES;
  if (agentType === 'antigravity' || agentType === 'antigravity_panel') return ANTIGRAVITY_MODES;
  return [];
}

function permissionModeOptionsFor(agentType, config) {
  if (Array.isArray(config?.available_permission_modes) && config.available_permission_modes.length > 0) {
    return config.available_permission_modes.map(mode => (
      typeof mode === 'string' ? { value: mode, label: mode } : { value: mode.id || mode.value, label: mode.label || mode.id || mode.value }
    )).filter(mode => mode.value);
  }
  return PERMISSION_MODES[agentType] || [];
}

function AgentSettingsPanel({ session, config, onRequestRefresh, onSetModel, onSetEffort, onSetPermissionMode, onSetAutoApprovePermissions, onSetMode, onSetCodexConfig, onSwitchWorkspace, onClose }) {
  const [pendingModel, setPendingModel] = React.useState(null);
  const [modelOk, setModelOk]           = React.useState(null);
  const [pendingPerm, setPendingPerm]   = React.useState(null);
  const [permOk, setPermOk]             = React.useState(null);
  const [pendingEffort, setPendingEffort] = React.useState(null);
  const [effortOk, setEffortOk]           = React.useState(null);
  const [pendingAutoApprove, setPendingAutoApprove] = React.useState(null);
  const [autoApproveOk, setAutoApproveOk]           = React.useState(null);
  const [pendingMode, setPendingMode]   = React.useState(null);
  const [modeOk, setModeOk]             = React.useState(null);
  const [codexOk, setCodexOk]           = React.useState(null);

  const sessionId    = sessionIdOf(session);
  const agentType    = (session && typeof session === 'object') ? session.agent_type : null;
  const caps         = config?.capabilities || {};
  const currentModel   = config?.model_id || 'unknown';
  const rateLimitedUntil = (session && typeof session === 'object') ? session.rate_limited_until || null : null;
  const antigravityQuotaModels = Array.isArray(session?.antigravity_quota_models) ? session.antigravity_quota_models : [];
  const activeQuotaModel = session?.active_quota_model || null;
  const permMode       = config?.permission_mode || 'unknown';
  const convMode       = config?.conversation_mode || 'unknown';
  const currentMode    = (config?.mode && config.mode !== 'unknown') ? config.mode : convMode;
  const autoApproveEnabled = typeof config?.auto_approve_permissions === 'boolean'
    ? config.auto_approve_permissions
    : !!session?.auto_approve_permissions;
  const effortLevel    = config?.effort || null;
  const fileScope    = config?.file_access_scope || 'unknown';
  const permModes    = permissionModeOptionsFor(agentType, config);
  const modeOptions  = modeOptionsFor(agentType, config);
  let modelOptions = (agentType === 'claude' || agentType === 'claude_cli') ? KNOWN_CLAUDE_MODELS
    : agentType === 'codex_cli' ? KNOWN_CODEX_CLI_MODELS
    : (agentType === 'antigravity' || agentType === 'antigravity_panel') ? KNOWN_ANTIGRAVITY_MODELS
    : agentType === 'gemini' ? KNOWN_GEMINI_MODELS
    : [];

  if (config?.available_models && Array.isArray(config.available_models) && config.available_models.length > 0) {
    modelOptions = config.available_models.map(m => typeof m === 'string' ? { id: m, label: m } : m);
  }

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

  function handleEffortChange(effort) {
    if (!effort || effort === effortLevel) return;
    setEffortOk(null);
    setPendingEffort(effort);
    onSetEffort && onSetEffort(sessionId, effort);
  }

  function handleModeChange(mode) {
    if (!mode || mode === currentMode) return;
    setModeOk(null);
    setPendingMode(mode);
    onSetMode && onSetMode(sessionId, mode);
  }

  function handleAutoApproveChange(enabled) {
    if (autoApproveEnabled === !!enabled) return;
    setAutoApproveOk(null);
    setPendingAutoApprove(!!enabled);
    onSetAutoApprovePermissions && onSetAutoApprovePermissions(sessionId, !!enabled);
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
    if (pendingEffort && config?.effort && config.effort === pendingEffort) {
      setEffortOk('Saved');
      setPendingEffort(null);
      setTimeout(() => setEffortOk(null), 2000);
    }
  }, [config?.effort]);

  React.useEffect(() => {
    if (pendingMode && ((config?.conversation_mode && config.conversation_mode === pendingMode) || (config?.mode && config.mode === pendingMode))) {
      setModeOk('Saved');
      setPendingMode(null);
      setTimeout(() => setModeOk(null), 2000);
    }
  }, [config?.conversation_mode, config?.mode]);

  React.useEffect(() => {
    if (pendingAutoApprove != null && autoApproveEnabled === pendingAutoApprove) {
      setAutoApproveOk('Saved');
      setPendingAutoApprove(null);
      setTimeout(() => setAutoApproveOk(null), 2000);
    }
  }, [autoApproveEnabled]);

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

        {(agentType === 'antigravity' || agentType === 'antigravity_panel') && antigravityQuotaModels.length > 0 && (
          <div className="settings-row" style={{ alignItems: 'flex-start' }}>
            <span className="settings-label">Quotas</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
              {session?.available_ai_credits != null && (
                <span className="settings-value">AI credits: {session.available_ai_credits}</span>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {antigravityQuotaModels.map((entry, index) => {
                  const pct = entry?.percent_used;
                  const label = formatAntigravityQuotaLabel(entry?.model);
                  const tone = pct >= 90 ? '#f85149' : pct >= 75 ? '#d29922' : '#8b949e';
                  const isActiveQuota = !!activeQuotaModel && activeQuotaModel === entry?.model;
                  return (
                    <span
                      key={entry?.model || `quota-${index}`}
                      className="composer-hint"
                      title={entry?.refreshes_in ? `${entry.model} · resets in ${entry.refreshes_in}` : entry?.model || ''}
                      style={{
                        color: tone,
                        border: `1px solid ${isActiveQuota ? tone : '#30363d'}`,
                        borderRadius: 999,
                        padding: '2px 8px',
                        background: isActiveQuota ? `${tone}18` : 'rgba(110,118,129,0.08)',
                      }}
                    >
                      {label} {pct != null ? `${pct}%` : 'n/a'}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Conversation mode — Antigravity only (Planning | Fast) */}
        {(agentType === 'antigravity' || agentType === 'antigravity_panel') && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <select
              className="settings-perm-select"
              value={currentMode === 'unknown' ? 'Planning' : currentMode}
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

        {/* Permission mode — Claude and Continue YOLO, Codex handled separately below */}
        {isClineLikeAgentType(agentType) && caps.set_mode && modeOptions.length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <select
              className="settings-perm-select"
              value={currentMode === 'unknown' ? modeOptions[0].id : currentMode}
              disabled={!!pendingMode}
              onChange={e => handleModeChange(e.target.value)}
            >
              {modeOptions.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {currentMode !== 'unknown' && !modeOptions.some(m => m.id === currentMode) && (
                <option value={currentMode}>{currentMode}</option>
              )}
            </select>
            {modeOk && <span className="settings-inline-ok">{modeOk}</span>}
          </div>
        )}

        {(agentType === 'claude' || agentType === 'claude_cli' || agentType === 'codex_cli' || agentType === 'continue_yolo' || isClineLikeAgentType(agentType)) && (
          <div className="settings-row">
            <span className="settings-label">Permission mode</span>
            {caps.permission_mode_change && permModes.length > 0 ? (
              <select
                className="settings-perm-select"
                value={permMode === 'unknown' ? defaultPermissionModeFor(agentType) : permMode}
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

        {agentType === 'codex_cli' && config?.approval_policy && (
          <div className="settings-row">
            <span className="settings-label">Approval policy</span>
            <span className="settings-value">{config.approval_policy}</span>
          </div>
        )}

        {(agentType === 'claude_cli' || agentType === 'codex_cli') && caps.set_effort && (config?.available_efforts || []).length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Effort</span>
            <select
              className="settings-perm-select"
              value={effortLevel || 'medium'}
              disabled={!!pendingEffort}
              onChange={e => handleEffortChange(e.target.value)}
            >
              {(config.available_efforts || []).map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {effortOk && <span className="settings-inline-ok">{effortOk}</span>}
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
            <div className="settings-row">
              <span className="settings-label">Speed</span>
              <select
                className="settings-perm-select"
                value={(config?.speed || 'standard').toLowerCase()}
                onChange={e => { onSetCodexConfig && onSetCodexConfig({ speed: e.target.value }); setCodexOk(agentType === 'codex-desktop' ? 'Saved' : 'Saved — restart Codex to apply'); setTimeout(() => setCodexOk(null), 3000); }}
              >
                {(config?.available_speeds || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {config?.speed && !(config?.available_speeds || []).some(m => m.id === config.speed) && config.speed !== 'unknown' && (
                  <option value={config.speed}>{config.speed}</option>
                )}
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
        {isContinueLikeAgentType(agentType) && config?.mode && config.mode !== 'unknown' && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <span className="settings-value">{config.mode}</span>
          </div>
        )}

        {caps.auto_approve_permissions_toggle && (
          <div className="settings-row settings-row-checkbox">
            <span className="settings-label">Tool Prompts</span>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={autoApproveEnabled}
                disabled={pendingAutoApprove != null}
                onChange={e => handleAutoApproveChange(e.target.checked)}
              />
              <span>Auto-approve permission prompts</span>
            </label>
            {autoApproveOk && <span className="settings-inline-ok">{autoApproveOk}</span>}
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
function AntigravityV2NavPanel({ items, onNavigate, onNew, onClose, embedded = false, loading = false }) {
  const normalized = Array.isArray(items) ? items : [];
  const navItems = normalized.filter(item => item?.kind === 'nav');
  const projects = normalized.filter(item => item?.kind === 'project');
  const chats = normalized.filter(item => !item?.kind || item.kind === 'chat');
  const seeAllItems = normalized.filter(item => item?.kind === 'see_all');
  const projectKeys = [];
  const projectLabels = new Map();
  projects.forEach(project => {
    const key = project.project_index != null ? `idx:${project.project_index}` : `name:${project.project || project.title || 'Project'}`;
    if (!projectLabels.has(key)) {
      projectKeys.push(key);
      projectLabels.set(key, project.title || project.project || 'Project');
    }
  });
  chats.forEach(chat => {
    const key = chat.project_index != null ? `idx:${chat.project_index}` : `name:${chat.project || 'Other'}`;
    if (!projectLabels.has(key)) {
      projectKeys.push(key);
      projectLabels.set(key, chat.project || 'Other');
    }
  });
  const ungrouped = chats.filter(chat => chat.project_index == null && !chat.project);

  function navTitle(action) {
    if (action === 'new_conversation') return 'New Conversation';
    if (action === 'conversation_history') return 'Conversation History';
    if (action === 'scheduled_tasks') return 'Scheduled Tasks';
    return 'Agent Manager';
  }

  function renderChat(chat, i) {
    return (
      <button
        key={chat.id || i}
        className={`agv2-chat-item${chat.active ? ' active' : ''}`}
        type="button"
        onClick={() => onNavigate(chat.id)}
        title={chat.title || 'Untitled'}
      >
        <span className="agv2-chat-title">{chat.title || 'Untitled'}</span>
        {chat.age && <span className="agv2-chat-age">{chat.age}</span>}
        {chat.active && <span className="agv2-chat-active">●</span>}
      </button>
    );
  }

  const body = (
    <>
      <div className="agv2-nav-actions">
        {(navItems.length ? navItems : [
          { id: '__agv2:new_conversation', action: 'new_conversation' },
          { id: '__agv2:conversation_history', action: 'conversation_history' },
          { id: '__agv2:scheduled_tasks', action: 'scheduled_tasks' },
        ]).map(item => (
          <button
            key={item.id || item.action}
            className={`agv2-nav-action ${item.action || ''}`}
            type="button"
            onClick={() => item.action === 'new_conversation' ? onNew() : onNavigate(item.id)}
          >
            <span className="agv2-nav-action-icon">{item.action === 'new_conversation' ? '+' : item.action === 'scheduled_tasks' ? '◷' : '↺'}</span>
            <span>{item.title || navTitle(item.action)}</span>
          </button>
        ))}
      </div>
      <div className="agv2-project-list">
        {projectKeys.length === 0 && ungrouped.length === 0 ? (
          <div className="chat-list-empty">{loading ? 'Loading conversations...' : 'No projects or conversations found'}</div>
        ) : (
          <>
            {projectKeys.map(projectKey => {
              const label = projectLabels.get(projectKey) || 'Project';
              const projectChats = chats.filter(chat => {
                const key = chat.project_index != null ? `idx:${chat.project_index}` : `name:${chat.project || 'Other'}`;
                return key === projectKey;
              });
              const projectSeeAll = seeAllItems.filter(item => {
                const key = item.project_index != null ? `idx:${item.project_index}` : `name:${item.project || 'Other'}`;
                return key === projectKey;
              });
              return (
                <section className="agv2-project-section" key={projectKey}>
                  <div className="agv2-project-header">
                    <span className="agv2-project-icon">⌂</span>
                    <span className="agv2-project-title">{label}</span>
                  </div>
                  <div className="agv2-project-chats">
                    {projectChats.length === 0 ? (
                      <div className="agv2-project-empty">No visible conversations</div>
                    ) : (
                      projectChats.map(renderChat)
                    )}
                    {projectSeeAll.map(item => (
                      <button
                        key={item.id}
                        className="agv2-see-all"
                        type="button"
                        onClick={() => onNavigate(item.id)}
                      >
                        {item.title || 'See all'}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {ungrouped.length > 0 && (
              <section className="agv2-project-section">
                <div className="agv2-project-header">
                  <span className="agv2-project-icon">⌂</span>
                  <span className="agv2-project-title">Other</span>
                </div>
                <div className="agv2-project-chats">
                  {ungrouped.map(renderChat)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="agv2-nav-embedded">{body}</div>;
  }

  return (
    <div className="chat-list-panel agv2-nav-panel">
      <div className="chat-list-header">
        <span className="chat-list-title">Antigravity Agent Manager</span>
        <button className="chat-list-new-btn" onClick={onNew} title="New conversation">+</button>
        <button className="chat-list-close-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="chat-list-body agv2-nav-body">
        {body}
      </div>
    </div>
  );
}

function ThreadHistoryPanel({ threads, sessionId, onSwitch, onNew, onClose, newLabel = 'New thread' }) {
  return (
    <div className="chat-list-panel">
      <div className="chat-list-header">
        <span className="chat-list-title">Threads</span>
        <button className="chat-list-new-btn" onClick={onNew} title={newLabel}>+</button>
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

function ThreadTabsBar({ threads, activeThreadId, onSwitch, onNew, onOpenHistory, showDraftTab = false, newLabel = 'New chat' }) {
  return (
    <div className="thread-tabs-bar">
      <div className="thread-tabs-scroll">
        {showDraftTab && (
          <button className="thread-tab active draft" type="button" title={newLabel}>
            <span className="thread-tab-title">{newLabel}</span>
          </button>
        )}
        {(threads || []).map((thread, i) => {
          const isActive = activeThreadId ? thread.id === activeThreadId : !!thread.active;
          return (
            <button
              key={thread.id || i}
              className={`thread-tab${isActive ? ' active' : ''}`}
              type="button"
              title={thread.title || 'Untitled'}
              onClick={() => onSwitch(thread.id)}
            >
              <span className="thread-tab-title">{thread.title || 'Untitled'}</span>
              {thread.age && <span className="thread-tab-age">{thread.age}</span>}
            </button>
          );
        })}
      </div>
      <div className="thread-tabs-actions">
        <button className="thread-tabs-btn" type="button" onClick={onOpenHistory} title="Show all threads">All</button>
        <button className="thread-tabs-btn accent" type="button" onClick={onNew} title={newLabel}>+</button>
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

function DiffViewer({ entries, onClose, onRefresh, onAccept, onReject }) {
  const summaryChips = (summary) => {
    const text = String(summary || '').trim();
    if (!text) return [];
    return text.split(/\s+/).filter(Boolean).map(token => ({
      text: token,
      cls: token.startsWith('+') ? 'add' : token.startsWith('-') ? 'del' : 'neutral',
    }));
  };
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
                <div className="diff-file-header">
                  <span>{entry.file || entry.path}</span>
                  {(entry.can_accept || entry.can_reject) && onAccept && onReject && (
                    <span className="diff-file-actions">
                      {entry.can_accept && (
                        <button type="button" className="diff-action-accept" onClick={() => onAccept(entry.id || entry.path)}>Accept</button>
                      )}
                      {entry.can_reject && (
                        <button type="button" className="diff-action-reject" onClick={() => onReject(entry.id || entry.path)}>Reject</button>
                      )}
                    </span>
                  )}
                </div>
              )}
              {entry.summary && (
                <div className="diff-file-summary">
                  {summaryChips(entry.summary).map((chip, ci) => (
                    <span key={ci} className={`diff-file-summary-chip diff-file-summary-chip-${chip.cls}`}>{chip.text}</span>
                  ))}
                </div>
              )}
              {entry.content ? (
                <pre className="diff-content">{entry.content.split('\n').map((line, li) => {
                  const cls = line.startsWith('+') ? 'diff-add' :
                              line.startsWith('-') ? 'diff-del' :
                              line.startsWith('@@') ? 'diff-hunk' : '';
                  return <span key={li} className={cls}>{line}{'\n'}</span>;
                })}</pre>
              ) : (
                !entry.summary && <pre className="diff-content">No content</pre>
              )}
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

function TranscriptFilePreview({ sessionId, filePath, fileContents, onClose }) {
  const key = `${sessionId}:${filePath}`;
  const fileData = fileContents[key];
  const content = fileData?.content || '';
  const truncated = fileData?.truncated || false;

  return (
    <div className="transcript-file-modal-overlay" onClick={onClose}>
      <div className="transcript-file-modal" onClick={e => e.stopPropagation()}>
        {!fileData ? (
          <div className="transcript-file-loading">
            <div className="transcript-file-loading-title">{filePath}</div>
            <div>Loading file preview…</div>
          </div>
        ) : isMarkdownFile(filePath) ? (
          <MarkdownViewer path={filePath} content={content} truncated={truncated} onBack={onClose} />
        ) : (
          <PlainFileViewer path={filePath} content={content} truncated={truncated} onBack={onClose} />
        )}
      </div>
    </div>
  );
}

function buildTranscriptPreviewContent(filePath, content) {
  const lang = getLang(filePath || 'text');
  const maxBackticks = Math.max(...String(content || '').match(/`+/g)?.map(run => run.length) || [0]);
  const fence = '`'.repeat(Math.max(3, maxBackticks + 1));
  return `${fence}${lang}\n${content || ''}\n${fence}`;
}

function TranscriptInlineFilePreview({ sessionId, filePath, fileContents, onClose }) {
  const key = `${sessionId}:${filePath}`;
  const fileData = fileContents[key];
  const content = fileData?.content || '';
  const truncated = fileData?.truncated || false;
  const previewContent = React.useMemo(
    () => buildTranscriptPreviewContent(filePath, content),
    [filePath, content],
  );

  return (
    <div className="transcript-inline-preview">
      <div className="transcript-inline-preview-header">
        <span className="transcript-inline-preview-title" title={filePath}>{filePath}</span>
        {truncated && <span className="file-viewer-truncated">truncated</span>}
        <button className="transcript-inline-preview-close" onClick={onClose} title="Collapse">Collapse</button>
      </div>
      {!fileData ? (
        <div className="transcript-file-loading">
          <div>Loading file preview...</div>
        </div>
      ) : (
        <MarkdownContent content={previewContent} monospace />
      )}
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
function CodexAutomationPane({ view, onShow }) {
  if (!view?.visible) return null;
  const statusRows = Array.isArray(view.status_rows) ? view.status_rows : [];
  const detailRows = Array.isArray(view.detail_rows) ? view.detail_rows : [];
  const status = view.status || statusRows.find(row => row.label === 'Status')?.value || '';
  return (
    <aside className="codex-automation-pane" aria-label="Codex automation">
      <div className="codex-automation-pane-header">
        <div className="codex-automation-pane-icon">o</div>
        <div className="codex-automation-pane-title">{view.title || 'Automation'}</div>
      </div>
      {view.description && (
        <div className="codex-automation-pane-desc">{view.description}</div>
      )}
      {(statusRows.length > 0 || status) && (
        <div className="codex-automation-pane-section">
          <div className="codex-automation-pane-section-title">Status</div>
          {statusRows.length > 0 ? statusRows.map((row, i) => (
            <div key={`${row.label}-${i}`} className="codex-automation-pane-row">
              <span>{row.label}</span>
              <strong className={row.label === 'Status' && /active/i.test(row.value) ? 'active' : ''}>{row.value}</strong>
            </div>
          )) : (
            <div className="codex-automation-pane-row"><span>Status</span><strong>{status}</strong></div>
          )}
        </div>
      )}
      {detailRows.length > 0 && (
        <div className="codex-automation-pane-section">
          <div className="codex-automation-pane-section-title">Details</div>
          {detailRows.map((row, i) => (
            <div key={`${row.label}-${i}`} className="codex-automation-pane-row">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
      {view.action_label && (
        <button className="codex-automation-pane-action" onClick={onShow}>
          {view.action_label}
        </button>
      )}
    </aside>
  );
}

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
  const { sessions, messages, historyMeta, historyLoading, connected, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, errorPrompts, respondToErrorPrompt, interruptSession, agentConfigs, requestAgentConfig, setAgentModel, setAgentEffort, setAgentPermissionMode, setAutoApprovePermissions, setAntigravityMode, setCodexConfig, newThread, openPanel, openNativeWindow, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, terminalOutputs, requestFileChanges, respondToFileChange, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, launchSession, resumeSession, closeSession, activeSessionRef, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, automationViews, showCodexAutomation, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent, requestHistory, requestHistoryChunk } = useRelay();
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
  const [expandedTranscriptSessions, setExpandedTranscriptSessions] = useState({});
  const [showChatList, setShowChatList]     = useState(false);
  const [agv2NavigatorOpen, setAgv2NavigatorOpen] = useState(true);
  const [optimisticV2ChatFocus, setOptimisticV2ChatFocus] = useState({});
  const [showThreadList, setShowThreadList] = useState(false);
  const [pendingDraftThreads, setPendingDraftThreads] = useState({});
  const [optimisticThreadFocus, setOptimisticThreadFocus] = useState({});
  const [draftMessageBaselines, setDraftMessageBaselines] = useState({});
  const [showTerminal, setShowTerminal]   = useState(false);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [showAutomations, setShowAutomations]       = useState(false);
  const [showSkills, setShowSkills]                 = useState(false);
  const [showFileBrowser, setShowFileBrowser]       = useState(false);
  const [fileBrowserPath, setFileBrowserPath]       = useState('.');
  const [viewingFile, setViewingFile]               = useState(null); // { path, content } when viewing a file
  const [transcriptPreview, setTranscriptPreview]   = useState(null);
  const [theme, setTheme]                           = useState(() => {
    try { return localStorage.getItem('remote-agent-chat-theme') || 'dark'; } catch { return 'dark'; }
  });
  const steerMessageRef = useRef(steerMessage);
  useEffect(() => { steerMessageRef.current = steerMessage; }, [steerMessage]);
  const handleTranscriptSteer = React.useCallback((cid, content) => {
    if (!activeSession) return;
    steerMessageRef.current(activeSession, cid, content);
  }, [activeSession]);
  const requestFileContentRef = useRef(requestFileContent);
  useEffect(() => { requestFileContentRef.current = requestFileContent; }, [requestFileContent]);
  const orderedSessions = React.useMemo(() => sortSessionsForDisplay(sessions), [sessions]);
  const sessionGroups = React.useMemo(
    () => groupSessionsByWorkspace(orderedSessions, agentConfigs),
    [orderedSessions, agentConfigs],
  );
  const activeSessionMeta = React.useMemo(
    () => orderedSessions.find(s => sessionIdOf(s) === activeSession),
    [orderedSessions, activeSession],
  );
  const activeMessagesForScroll = activeSession && messages[activeSession]
    ? messages[activeSession]
    : EMPTY_MESSAGES;
  const activeTranscriptExpandedForScroll = !!(activeSession && expandedTranscriptSessions[activeSession]);
  const activeTranscriptRenderTailLimitForScroll = transcriptRenderTailLimitForAgentType(activeSessionMeta?.agent_type);
  const activeActivityForScroll = activeSession ? activities[activeSession] : null;
  const activeThinkingForScroll = activeSession ? (thinkingContent[activeSession] || '') : '';
  const activePermissionPromptForScroll = activeSession ? permissionPrompts[activeSession] || null : null;
  const activeErrorPromptForScroll = activeSession ? errorPrompts[activeSession] || null : null;
  const activeLiveScrollVersion = React.useMemo(() => {
    const activity = activeActivityForScroll && typeof activeActivityForScroll === 'object'
      ? activeActivityForScroll
      : null;
    const goal = activity?.goal || null;
    const tasks = Array.isArray(activity?.task_list?.tasks)
      ? activity.task_list.tasks.map(task => `${task.state || ''}:${task.text || task.title || task.label || ''}`).join('|')
      : '';
    return [
      activeThinkingForScroll,
      activity?.kind || '',
      activity?.label || '',
      activity?.updatedAt || '',
      activity?.startedAt || '',
      activity?.interruptHint || '',
      activity?.thinkingContent || '',
      goal?.status || '',
      goal?.label || '',
      goal?.objective || '',
      goal?.time_used_seconds ?? goal?.timeUsedSeconds ?? '',
      goal?.updated_at || '',
      tasks,
      activePermissionPromptForScroll?.id || activePermissionPromptForScroll?.request_id || '',
      activeErrorPromptForScroll?.id || activeErrorPromptForScroll?.request_id || '',
    ].join('\u0001');
  }, [
    activeActivityForScroll,
    activeThinkingForScroll,
    activePermissionPromptForScroll,
    activeErrorPromptForScroll,
  ]);
  const messagesEndRef  = useRef(null);
  const messagesListRef = useRef(null);
  const isAtBottom      = useRef(true);   // updated by scroll listener before DOM changes
  const stickyToNewestRef = useRef(true); // false only after an intentional user scroll away from newest
  const userScrollIntentUntilRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const pinnedToNewestUntilRef = useRef(0);
  const selectedSessionRef = useRef(activeSession);
  const scrollSnapshotRef = useRef({
    sessionId: null,
    keys: [],
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    atBottom: true,
  });
  const textareaRef     = useRef(null);
  const fileInputRef    = useRef(null);
  const prevConnected   = useRef(connected);
  const pendingAttachmentReqs = useRef({});
  const seenAttachmentResults = useRef({});

  useLayoutEffect(() => {
    selectedSessionRef.current = activeSession;
  }, [activeSession]);

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
    if (!activeSession && orderedSessions.length > 0) {
      const first = orderedSessions[0];
      const id    = typeof first === 'string' ? first : first?.session_id;
      if (id) selectSession(id, first);
    }
  }, [orderedSessions, activeSession]);

  // Auto-select a just-launched session once it appears in the sessions list
  useEffect(() => {
    if (!justLaunched) return;
    const found = orderedSessions.find(s => (typeof s === 'string' ? s : s?.session_id) === justLaunched);
    if (found) {
      selectSession(justLaunched, found);
      setJustLaunched(null);
    }
  }, [justLaunched, orderedSessions]);

  // Track whether the user is near the bottom via a scroll listener.
  // Updates isAtBottom.current and shows/hides the "Jump to Newest" button.
  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    let touchStartY = null;
    const markUserScrollAwayIntent = () => {
      userScrollIntentUntilRef.current = Date.now() + 1200;
    };
    const onWheel = (event) => {
      if (event.deltaY < -1) markUserScrollAwayIntent();
    };
    const onPointerDown = (event) => {
      const rect = list.getBoundingClientRect();
      if (event.clientX >= rect.right - 16) markUserScrollAwayIntent();
    };
    const onTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event) => {
      const y = event.touches?.[0]?.clientY ?? null;
      if (touchStartY != null && y != null && y - touchStartY > 4) markUserScrollAwayIntent();
    };
    const onKeyDown = (event) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) markUserScrollAwayIntent();
    };
    const onScroll = () => {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      const now = Date.now();
      const userInitiated = now < userScrollIntentUntilRef.current;
      const programmatic = now < programmaticScrollUntilRef.current;
      isAtBottom.current = atBottom;
      if (atBottom) {
        stickyToNewestRef.current = true;
      } else if (userInitiated && !programmatic) {
        stickyToNewestRef.current = false;
        pinnedToNewestUntilRef.current = 0;
      }
      setShowJumpButton(!atBottom && !stickyToNewestRef.current);
      scrollSnapshotRef.current = {
        ...scrollSnapshotRef.current,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        atBottom: atBottom || stickyToNewestRef.current,
      };
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    list.addEventListener('wheel', onWheel, { passive: true });
    list.addEventListener('touchstart', onTouchStart, { passive: true });
    list.addEventListener('touchmove', onTouchMove, { passive: true });
    list.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('wheel', onWheel);
      list.removeEventListener('touchstart', onTouchStart);
      list.removeEventListener('touchmove', onTouchMove);
      list.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);  // mount only — list ref is stable

  function stickTranscriptToNewest(keys, frameCount = 2) {
    const sessionAtStart = activeSession;
    const apply = () => {
      const list = messagesListRef.current;
      if (!list || selectedSessionRef.current !== sessionAtStart) return false;
      programmaticScrollUntilRef.current = Date.now() + 800;
      stickyToNewestRef.current = true;
      setScrollTopInstant(list, list.scrollHeight);
      isAtBottom.current = true;
      setShowJumpButton(false);
      scrollSnapshotRef.current = {
        sessionId: sessionAtStart,
        keys,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        atBottom: true,
      };
      return true;
    };
    apply();
    let remaining = Math.max(0, frameCount);
    const tick = () => {
      if (remaining <= 0) return;
      remaining -= 1;
      if (apply()) requestAnimationFrame(tick);
    };
    if (remaining > 0) requestAnimationFrame(tick);
  }

  function pinTranscriptToNewest() {
    const list = messagesListRef.current;
    if (!list) return;
    const keys = scrollIdentityKeysForMessages(
      activeMessagesForScroll,
      activeTranscriptExpandedForScroll,
      activeTranscriptRenderTailLimitForScroll,
    );
    pinnedToNewestUntilRef.current = Date.now() + 5000;
    stickTranscriptToNewest(keys, 4);
  }

  // Keep transcript hydration visually stable. Tail chunks should land at the
  // bottom, but older backfill chunks are prepended above the viewport; preserve
  // the current anchor by adding the rendered height delta to scrollTop.
  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const keys = scrollIdentityKeysForMessages(
      activeMessagesForScroll,
      activeTranscriptExpandedForScroll,
      activeTranscriptRenderTailLimitForScroll,
    );
    const prev = scrollSnapshotRef.current || {};
    const sameSession = prev.sessionId === activeSession;
    const prevKeys = Array.isArray(prev.keys) ? prev.keys : [];
    const prevFirst = prevKeys[0] || null;
    const prevLast = prevKeys[prevKeys.length - 1] || null;
    const prevFirstIndex = prevFirst ? keys.indexOf(prevFirst) : -1;
    const prevLastIndex = prevLast ? keys.indexOf(prevLast) : -1;
    const sameRenderedKeys = !!(
      sameSession
      && keys.length === prevKeys.length
      && keys.every((key, index) => key === prevKeys[index])
    );
    const previousBottomGap = (Number(prev.scrollHeight) || 0)
      - (Number(prev.scrollTop) || 0)
      - (Number(prev.clientHeight) || 0);
    const forcePinnedToNewest = Date.now() < pinnedToNewestUntilRef.current;
    const wasAtBottom = forcePinnedToNewest
      || stickyToNewestRef.current
      || prev.atBottom !== false
      || previousBottomGap < 120;
    const olderPrepended = !!(
      sameSession
      && prevKeys.length
      && prevFirstIndex > 0
      && prevLastIndex >= prevFirstIndex
    );

    if (sameRenderedKeys && !forcePinnedToNewest && !wasAtBottom) {
      // Older hydration chunks often change the backing array without changing
      // the rendered tail window. Leave scrollTop alone so the browser does not
      // visibly bounce while history backfills in the background.
    } else if (!sameSession) {
      setTranscriptPreview(null);
      stickTranscriptToNewest(keys, 3);
    } else if (wasAtBottom) {
      stickTranscriptToNewest(keys, 3);
    } else if (olderPrepended) {
      const heightDelta = list.scrollHeight - (Number(prev.scrollHeight) || 0);
      programmaticScrollUntilRef.current = Date.now() + 500;
      setScrollTopInstant(list, Math.max(0, (Number(prev.scrollTop) || 0) + heightDelta));
    }

    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    isAtBottom.current = atBottom;
    setShowJumpButton(!atBottom && !stickyToNewestRef.current);
    scrollSnapshotRef.current = {
      sessionId: activeSession,
      keys,
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      atBottom: atBottom || stickyToNewestRef.current,
    };
  }, [activeSession, activeMessagesForScroll, activeTranscriptExpandedForScroll, activeLiveScrollVersion]);

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
  setDraftFileForSession(sessionId, { name: filename, url, isText: false, mimeType });
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

  function historyRequestOptionsFor(sessionMeta) {
    return { limit: historyLimitForAgentType(sessionMeta?.agent_type) };
  }

  function historyRequestOptionsForSessionId(sessionId) {
    const meta = orderedSessions.find(session => sessionIdOf(session) === sessionId);
    return historyRequestOptionsFor(meta);
  }

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
        if ((f.mimeType || '').startsWith('image/')) {
          return `![${f.name}](${f.url})`;
        }
        return `[File: ${f.name}](${f.url})`;
      });
      content = fileParts.join('\n\n');
      if (text) content += `\n\n${text}`;
    } else {
      content = text;
    }

    sendToSession(activeSession, content);
    setPendingDraftThreads(prev => ({ ...prev, [activeSession]: false }));
    setDraftMessageBaselines(prev => ({
      ...prev,
      [activeSession]: Math.min(prev[activeSession] || 0, (messages[activeSession] || []).length),
    }));
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
  const rawCurrentMessages = activeMessagesForScroll;
  const draftBaseline = activeSession && pendingDraftThreads[activeSession]
    ? (draftMessageBaselines[activeSession] || 0)
    : 0;
  const currentMessages = React.useMemo(() => {
    const baseline = Math.min(draftBaseline, rawCurrentMessages.length);
    if (baseline <= 0) return rawCurrentMessages;
    if (baseline >= rawCurrentMessages.length) return EMPTY_MESSAGES;
    return rawCurrentMessages.slice(baseline);
  }, [rawCurrentMessages, draftBaseline]);
  const renderAllLoadedTranscript = !!(activeSession && expandedTranscriptSessions[activeSession]);
  const transcriptRenderTailLimit = transcriptRenderTailLimitForAgentType(activeSessionMeta?.agent_type);
  const renderedMessages = React.useMemo(() => {
    if (renderAllLoadedTranscript || currentMessages.length <= transcriptRenderTailLimit) {
      return currentMessages.filter(msg => hasVisibleMessage(msg));
    }
    const tailWindow = currentMessages.slice(-transcriptRenderTailLimit * 2);
    return tailWindow.filter(msg => hasVisibleMessage(msg)).slice(-transcriptRenderTailLimit);
  }, [currentMessages, renderAllLoadedTranscript, transcriptRenderTailLimit]);
  const hiddenLoadedMessageCount = renderAllLoadedTranscript
    ? 0
    : Math.max(0, currentMessages.length - renderedMessages.length);
  const activePrompt    = activeSession ? permissionPrompts[activeSession] || null : null;
  const activeErrorPrompt = activeSession ? errorPrompts[activeSession] || null : null;
  const activeBlockingErrorPrompt = isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
  const activeInlineErrorPrompt = activeErrorPrompt && !isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
  const activeBlockingPrompt = activePrompt || activeBlockingErrorPrompt;
  const activeBlockingPromptLabel = activePrompt
    ? 'Permission required'
    : activeBlockingErrorPrompt
      ? safeString(activeBlockingErrorPrompt.title, 'Action required')
      : null;
  const canSend         = !!(currentInput.trim() || attachedFiles.length > 0) && !!activeSession && connected && !uploading && !activeBlockingPrompt;
  const unreadTotal     = Object.values(unread).reduce((a, b) => a + b, 0);
  const slashQuery      = currentInput.startsWith('/') ? currentInput.slice(1).trim().toLowerCase() : '';
  const filteredSlashCommands = currentInput.startsWith('/')
    ? SLASH_COMMANDS.filter(item => item.command.slice(1).includes(slashQuery))
    : [];

  // Resolve display label for the active session
  const activeConfig = activeSession ? (agentConfigs[activeSession] || null) : null;
  const activeHistoryMeta = activeSession ? (historyMeta[activeSession] || null) : null;
  const activeHistoryLoading = activeSession ? (historyLoading[activeSession] || null) : null;

  // Transcript history is loaded newest-first for the selected session only.
  // Relay-backed sessions page through SQLite chunks; Codex CLI pages through
  // the native JSONL archive so refresh never has to hydrate a full transcript.
  useEffect(() => {
    if (!activeSession || !connected) return;
    const tailOptions = historyRequestOptionsFor(activeSessionMeta);
    const chunkSource = activeSessionMeta?.agent_type === 'codex_cli' ? 'native' : 'relay_sqlite';
    requestHistoryChunk(activeSession, { ...tailOptions, mode: 'tail', source: chunkSource });
  }, [activeSession, connected, activeSessionMeta?.agent_type]);
  const isAntigravityV2 = activeSessionMeta?.agent_type === 'antigravity-v2';
  const rawActiveChatList = activeSession ? (chatLists[activeSession] || []) : [];
  const optimisticV2Focus = activeSession ? optimisticV2ChatFocus[activeSession] : null;
  const activeChatList = React.useMemo(() => {
    if (!(isAntigravityV2 && optimisticV2Focus?.id)) return rawActiveChatList;
    return rawActiveChatList.map(item => (
      (!item?.kind || item.kind === 'chat')
        ? { ...item, active: item.id === optimisticV2Focus.id }
        : item
    ));
  }, [rawActiveChatList, isAntigravityV2, optimisticV2Focus?.id]);
  const activeChatListLoaded = !!(
    activeSession
    && Object.prototype.hasOwnProperty.call(chatLists, activeSession)
  );
  const activeV2ConversationCount = activeChatList.filter(item => !item?.kind || item.kind === 'chat').length;
  const showAntigravityV2Navigator = !!(activeSession && isAntigravityV2 && !showFileBrowser);
  const autoExpandLongCodeBlocks = activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel' || activeSessionMeta?.agent_type === 'antigravity-v2';
  const visiblePaneSession = activeSessionMeta ? findVisiblePaneSession(orderedSessions, activeSessionMeta) : null;
  const codexWorkbenchPaneSummary = activeSessionMeta?.agent_type === 'codex' && activeSessionMeta?.visible_pane_visible
    ? {
        pane_agent: activeSessionMeta.visible_pane_agent || null,
        summary: formatVisiblePaneSummary(activeSessionMeta),
        sourceSession: activeSessionMeta,
      }
    : null;
  const fallbackPaneSummary = visiblePaneSession
    ? {
        pane_agent: visiblePaneSession.panel_agent || null,
        summary: formatVisiblePaneSummary(visiblePaneSession),
        sourceSession: visiblePaneSession,
      }
    : null;
  const effectiveVisiblePane = codexWorkbenchPaneSummary || fallbackPaneSummary;
  const rawVisiblePaneSummary = effectiveVisiblePane?.summary || '';
  const visiblePaneAgent = effectiveVisiblePane?.pane_agent || null;
  const visiblePaneLabel = rawVisiblePaneSummary
    || agentTypeLabel(visiblePaneAgent)
    || sessionSubLabel(effectiveVisiblePane?.sourceSession, sessionIdOf(effectiveVisiblePane?.sourceSession));
  const visiblePaneSummary = visiblePaneLabel;
  const activeCodexPaneLive = !!(
    activeSessionMeta
    && activeSessionMeta.agent_type === 'codex'
    && activeSessionMeta.visible_pane_visible
    && activeSessionMeta.visible_pane_agent === 'codex'
  );
  const activeCodexPaneMismatch = !!(
    activeSessionMeta
    && activeSessionMeta.agent_type === 'codex'
    && activeSessionMeta.visible_pane_visible
    && activeSessionMeta.visible_pane_agent
    && activeSessionMeta.visible_pane_agent !== 'codex'
  );
  const activeAgent = sessionAgent(activeSessionMeta || activeSession, activeConfig);
  const activeSessionGroup = React.useMemo(() => (
    activeSession
      ? sessionGroups.find(group => group.sessions.some(session => sessionIdOf(session) === activeSession))
      : null
  ), [activeSession, sessionGroups]);
  const activeGroupLabel = activeSessionGroup?.label && activeSessionGroup.label !== 'Unscoped Sessions'
    ? activeSessionGroup.label
    : '';
  const activeLabel = activeSession
    ? `${activeAgent.name}${activeGroupLabel ? ` — ${activeGroupLabel}` : ''}`
    : 'Agent Chat';
  const activeAutomationView = activeSession ? automationViews[activeSession] : null;
  const activeLooksLikeCodex = activeAgent?.name === 'Codex' || /^Codex\b/.test(activeLabel || '');
  const showVisiblePaneBanner = !!(
    activeLooksLikeCodex
    && activeSessionMeta
    && activeSessionMeta.agent_type === 'codex'
    && (
      (activeCodexPaneMismatch && visiblePaneSession)
      || (
        !codexWorkbenchPaneSummary
        && visiblePaneSession
        && (visiblePaneSession.panel_agent === 'antigravity_panel' || visiblePaneSummary)
      )
    )
  );
  let activeWindowLabel = activeSession ? sessionSubLabel(activeSessionMeta, activeSession) : '';
  if (isAntigravityV2 && optimisticV2Focus?.title) {
    const workspaceLabel = activeSessionMeta?.workspace_name || activeWorkspaceBasename || 'Antigravity v2';
    activeWindowLabel = `${workspaceLabel} / ${optimisticV2Focus.title}`;
  }
  const activeWorkspacePath = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.workspace_path
    : '';
  const activeWorkspaceBasename = activeWorkspacePath
    ? activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() || activeWorkspacePath
    : '';
  const canLaunchNewThread = !!activeConfig?.capabilities?.new_thread;
  const isCodexDesktop = activeSessionMeta?.agent_type === 'codex-desktop';
  const isCursor = activeSessionMeta?.agent_type === 'cursor';
  const isDesktopAgent = isCodexDesktop || isCursor;
  const newThreadLabel = isDesktopAgent ? 'New chat' : 'New thread';
  const activeMachine = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.machine_label
    : '';
  // Last user message — shown as sticky context banner at top of chat
  const lastUserMsg = React.useMemo(() => {
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (currentMessages[i]?.role === 'user') return currentMessages[i];
    }
    return null;
  }, [currentMessages]);
  const lastUserText = lastUserMsg
    ? normalizeMessageContent(lastUserMsg.content)
      .replace(/\s+/g, ' ').trim()
    : '';
  const activeHealth = activeSession ? (health[activeSession] || activeSessionMeta?.status || 'unknown') : '';
  const normalizeTranscriptPreviewPath = React.useCallback((rawPath) => {
    const cleaned = safeString(rawPath)
      .replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
    if (!cleaned) return '';
    const normalized = cleaned.replace(/\\/g, '/');
    const workspace = safeString(activeWorkspacePath).replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
      if (!workspace) return '';
      const lhs = normalized.toLowerCase();
      const rhs = workspace.toLowerCase();
      if (lhs === rhs) return '.';
      if (lhs.startsWith(rhs + '/')) return normalized.slice(workspace.length + 1);
      return '';
    }
    return normalized.replace(/^\.\/+/, '').replace(/^\/+/, '');
  }, [activeWorkspacePath]);
  const openTranscriptPreview = React.useCallback((messageKey, rawPath) => {
    if (!activeSession) return;
    const relativePath = normalizeTranscriptPreviewPath(rawPath);
    if (!relativePath) {
      showToast('File is outside the current workspace');
      return;
    }
    setTranscriptPreview(prev => (
      prev && prev.sessionId === activeSession && prev.messageKey === messageKey && prev.path === relativePath
        ? null
        : { sessionId: activeSession, messageKey, path: relativePath }
    ));
    requestFileContentRef.current(activeSession, relativePath);
  }, [activeSession, normalizeTranscriptPreviewPath]);
  const closeTranscriptPreview = React.useCallback(() => setTranscriptPreview(null), []);
  // Use real-time activity when present. Fall back to session-metadata activity ONLY
  // when no status event has arrived yet for this session (undefined), not when it
  // was explicitly cleared to false by the idle timeout — that would resurrect a
  // stale "generating" indicator after the agent has already finished.
  const activeActivity = activeSession
    ? (activities[activeSession] !== undefined
        ? activities[activeSession]
        : (activeSessionMeta && typeof activeSessionMeta === 'object' ? activeSessionMeta.activity : null))
    : null;
  const activeContextCard = activeActivity?.context_card || null;
  const showLastUserBanner = !!(
    activeSession
    && lastUserText
    && !((activeSessionMeta?.agent_type === 'cline' || activeSessionMeta?.agent_type === 'roo_code') && activeContextCard)
  );
  const assistantMonospace = activeSessionMeta?.agent_type === 'codex' || activeSessionMeta?.agent_type === 'codex_cli';
  const lastAssistantMsg = React.useMemo(() => {
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (currentMessages[i]?.role === 'assistant') return currentMessages[i];
    }
    return null;
  }, [currentMessages]);
  const liveThinkingText = activeSession ? (thinkingContent[activeSession] || '').trim() : '';
  const lastAssistantText = lastAssistantMsg ? normalizeMessageContent(lastAssistantMsg.content).trim() : '';
  const showPinnedThinkingRow = !!(
    activeActivity
    && !activeActivity?.task_list
    && hasSubstantiveLiveText(liveThinkingText)
  );
  const showLiveAssistantDraft = !!(
    activeSession
    && activeActivity
    && (activeActivity.kind === 'thinking' || activeActivity.kind === 'generating')
    && !showPinnedThinkingRow
    && hasSubstantiveLiveText(liveThinkingText)
    && (
      activeSessionMeta?.agent_type === 'codex'
      || activeSessionMeta?.agent_type === 'codex-desktop'
      || activeSessionMeta?.agent_type === 'cursor'
      || activeSessionMeta?.agent_type === 'antigravity_panel'
    )
    && liveThinkingText !== lastAssistantText
    && !lastAssistantText.includes(liveThinkingText)
  );
  const showInlineClaudeActivity = !!(
    activeActivity
    && !activeActivity?.task_list
    && activeSessionMeta?.agent_type === 'claude'
  );
  const isActiveCodexCli = activeSessionMeta?.agent_type === 'codex_cli';
  const showLiveStatusStrip = !!(
    activeActivity
    && !showInlineClaudeActivity
    && (
      (!isActiveCodexCli && activeActivity?.goal)
      || (!isActiveCodexCli && activeActivity?.task_list)
      || (
        !isActiveCodexCli
        && (activeActivity.kind !== 'idle' || hasSubstantiveLiveText(liveThinkingText || activeActivity.thinkingContent || ''))
      )
    )
  );
  const showCodexCliWorkingStrip = !!(
    isActiveCodexCli
    && activeActivity
    && !showInlineClaudeActivity
    && (
      activeActivity?.goal
      || activeActivity?.task_list
      || activeActivity.kind !== 'idle'
      || hasSubstantiveLiveText(liveThinkingText || activeActivity.thinkingContent || '')
    )
  );
  const showPartialHistoryBanner = !!(
    activeSession
    && activeHistoryMeta?.partial
    && Number(activeHistoryMeta.total || 0) > Number(activeHistoryMeta.loaded || currentMessages.length || 0)
  );
  const partialHistoryLoaded = Number(activeHistoryMeta?.loaded || currentMessages.length || 0);
  const partialHistoryTotal = Number(activeHistoryMeta?.total || partialHistoryLoaded || 0);
  function loadOlderActiveHistory() {
    if (!activeSession) return;
    const chunkSource = activeSessionMeta?.agent_type === 'codex_cli' ? 'native' : 'relay_sqlite';
    requestHistoryChunk(activeSession, {
      mode: activeHistoryMeta?.cursor ? 'older' : 'tail',
      source: chunkSource,
      userInitiated: true,
      beforeOffset: activeHistoryMeta?.cursor?.next_before_offset,
      beforeId: activeHistoryMeta?.cursor?.next_before_id,
      ...historyRequestOptionsFor(activeSessionMeta),
    });
  }
  const shouldBottomAlignMessages = !!(
    activeSession
    && (currentMessages.length > 0 || showLiveAssistantDraft || showInlineClaudeActivity)
  );
  const activeAgentMemoKey = activeAgentKey(activeAgent);
  const renderedMessageNodes = React.useMemo(() => (
    renderedMessages.map((msg, i) => {
      const messageKey = messageIdentityKey(msg, hiddenLoadedMessageCount + i);
      const preview = transcriptPreview?.sessionId === activeSession && transcriptPreview?.messageKey === messageKey
        ? transcriptPreview
        : null;
      return (
        <MemoTranscriptMessage
          key={messageKey}
          msg={msg}
          messageKey={messageKey}
          activeAgent={activeAgent}
          assistantMonospace={assistantMonospace}
          autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
          onOpenPath={openTranscriptPreview}
          agentType={activeSessionMeta?.agent_type}
          preview={preview}
          fileContents={fileContents}
          onClosePreview={closeTranscriptPreview}
          deliveryState={msg._cid ? deliveryStates[msg._cid] : null}
          onSteer={handleTranscriptSteer}
        />
      );
    })
  ), [
    renderedMessages,
    hiddenLoadedMessageCount,
    activeSession,
    activeAgentMemoKey,
    assistantMonospace,
    autoExpandLongCodeBlocks,
    openTranscriptPreview,
    activeSessionMeta?.agent_type,
    transcriptPreview,
    fileContents,
    closeTranscriptPreview,
    deliveryStates,
    handleTranscriptSteer,
  ]);
  // Auto-fetch thread list for desktop sessions with no messages (e.g. Codex Desktop showing chat picker)
  const hasThreadCap = activeConfig?.capabilities?.thread_list;
  const showDesktopThreadTabs = !!(
    activeSession
    && (activeSessionMeta?.agent_type === 'codex-desktop' || activeSessionMeta?.agent_type === 'cursor')
    && hasThreadCap
    && (threadLists[activeSession]?.length > 0 || pendingDraftThreads[activeSession])
    && !showFileBrowser
  );
  const desktopThreadTabs = React.useMemo(() => {
    const list = [...(threadLists[activeSession] || [])];
    if (list.length === 0) return list;
    const focusId = optimisticThreadFocus[activeSession];
    const focusIndex = focusId ? list.findIndex(thread => thread.id === focusId) : -1;
    const activeIndex = focusIndex >= 0 ? focusIndex : list.findIndex(thread => thread.active);
    if (activeIndex > 0) {
      const [activeThread] = list.splice(activeIndex, 1);
      list.unshift(activeThread);
    }
    return list.slice(0, 8);
  }, [activeSession, threadLists, optimisticThreadFocus]);
  const noMessages = currentMessages.length === 0;
  React.useEffect(() => {
    if (activeSession && hasThreadCap && noMessages) {
      requestThreadList(activeSession);
    }
  }, [activeSession, hasThreadCap, noMessages]);
  React.useEffect(() => {
    if (!(activeSession && isAntigravityV2 && connected)) return undefined;
    requestChatList(activeSession);
    const retryTimers = [600, 1800, 4200].map(delay => setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      requestChatList(activeSession);
    }, delay));
    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      requestChatList(activeSession);
    };
    const intervalId = setInterval(refreshIfVisible, 30000);
    const onVisibility = () => refreshIfVisible();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      retryTimers.forEach(timer => clearTimeout(timer));
      clearInterval(intervalId);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeSession, isAntigravityV2, connected]);
  React.useEffect(() => {
    if (activeSession && isAntigravityV2) {
      setAgv2NavigatorOpen(true);
      setShowChatList(false);
    }
  }, [activeSession, isAntigravityV2]);
  React.useEffect(() => {
    if (!(activeSession && isAntigravityV2)) return;
    const activeChat = rawActiveChatList.find(item => (!item?.kind || item.kind === 'chat') && item.active);
    if (!activeChat) return;
    setOptimisticV2ChatFocus(prev => {
      const current = prev[activeSession];
      if (!current) return prev;
      if (current.id !== activeChat.id && Date.now() - (current.at || 0) < 15000) return prev;
      const next = { ...prev };
      delete next[activeSession];
      return next;
    });
  }, [activeSession, isAntigravityV2, rawActiveChatList]);
  React.useEffect(() => {
    if (!(activeSession && isDesktopAgent && noMessages)) return undefined;
    const tailOptions = historyRequestOptionsFor(activeSessionMeta);
    requestHistory(activeSession, tailOptions);
    const intervalId = setInterval(() => requestHistory(activeSession, tailOptions), 3000);
    return () => clearInterval(intervalId);
  }, [activeSession, activeSessionMeta?.agent_type, noMessages]);
  React.useEffect(() => {
    if (!(activeSession && isDesktopAgent && hasThreadCap)) return undefined;
    requestThreadList(activeSession);
    const intervalId = setInterval(() => requestThreadList(activeSession), 5000);
    return () => clearInterval(intervalId);
  }, [activeSession, activeSessionMeta?.agent_type, hasThreadCap]);
  React.useEffect(() => {
    if (!(activeSession && hasThreadCap && showThreadList)) return undefined;
    requestThreadList(activeSession);
    const intervalId = setInterval(() => requestThreadList(activeSession), 3000);
    return () => clearInterval(intervalId);
  }, [activeSession, hasThreadCap, showThreadList]);
  React.useEffect(() => {
    if (!activeSession) return;
    const baseline = draftMessageBaselines[activeSession] || 0;
    const rawCount = rawCurrentMessages.length;
    if (baseline > rawCount) {
      setDraftMessageBaselines(prev => ({ ...prev, [activeSession]: rawCount }));
    }
  }, [activeSession, draftMessageBaselines, rawCurrentMessages.length]);
  React.useEffect(() => {
    if (!activeSession || currentMessages.length === 0) return;
    setPendingDraftThreads(prev => (
      prev[activeSession]
        ? { ...prev, [activeSession]: false }
        : prev
    ));
  }, [activeSession, currentMessages.length]);
  React.useEffect(() => {
    if (!activeSession) return;
    const liveThreads = threadLists[activeSession] || [];
    const focusedThreadId = optimisticThreadFocus[activeSession];
    if (!focusedThreadId) return;
    if (liveThreads.some(thread => thread.id === focusedThreadId && thread.active)) {
      setOptimisticThreadFocus(prev => {
        const next = { ...prev };
        delete next[activeSession];
        return next;
      });
    }
  }, [activeSession, threadLists, optimisticThreadFocus]);
  function handleNewThread(sessionId = activeSession) {
    if (!sessionId) return;
    setPendingDraftThreads(prev => ({ ...prev, [sessionId]: true }));
    setOptimisticThreadFocus(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setDraftMessageBaselines(prev => ({
      ...prev,
      [sessionId]: (messages[sessionId] || []).length,
    }));
    setShowThreadList(false);
    newThread(sessionId);
    if (agentConfigs[sessionId]?.capabilities?.thread_list) {
      const tailOptions = historyRequestOptionsForSessionId(sessionId);
      setTimeout(() => requestHistory(sessionId, tailOptions), 150);
      setTimeout(() => requestHistory(sessionId, tailOptions), 650);
      setTimeout(() => requestThreadList(sessionId), 400);
      setTimeout(() => requestThreadList(sessionId), 1400);
    }
  }

  function handleSwitchThread(sessionId, threadId) {
    if (!(sessionId && threadId)) return;
    setPendingDraftThreads(prev => ({ ...prev, [sessionId]: false }));
    setOptimisticThreadFocus(prev => ({ ...prev, [sessionId]: threadId }));
    setDraftMessageBaselines(prev => ({ ...prev, [sessionId]: 0 }));
    switchThread(sessionId, threadId);
    const tailOptions = historyRequestOptionsForSessionId(sessionId);
    setTimeout(() => requestHistory(sessionId, tailOptions), 120);
    setTimeout(() => requestHistory(sessionId, tailOptions), 550);
    setTimeout(() => requestThreadList(sessionId), 300);
    setTimeout(() => requestThreadList(sessionId), 1200);
  }

  function handleAntigravityV2New(sessionId = activeSession) {
    if (!sessionId) return;
    setAgv2NavigatorOpen(true);
    setShowChatList(false);
    setOptimisticV2ChatFocus(prev => ({
      ...prev,
      [sessionId]: { id: '__agv2:new_conversation', title: 'New Conversation', kind: 'nav', at: Date.now() },
    }));
    newChat(sessionId);
    setTimeout(() => requestHistory(sessionId, historyRequestOptionsForSessionId(sessionId)), 150);
    setTimeout(() => requestChatList(sessionId), 500);
    setTimeout(() => requestChatList(sessionId), 1400);
  }

  function handleAntigravityV2Navigate(itemId, sessionId = activeSession) {
    if (!(sessionId && itemId)) return;
    setAgv2NavigatorOpen(true);
    setShowChatList(false);
    const item = (chatLists[sessionId] || []).find(entry => entry?.id === itemId);
    const fallbackTitle = itemId === '__agv2:new_conversation'
      ? 'New Conversation'
      : itemId === '__agv2:conversation_history'
        ? 'Conversation History'
        : itemId === '__agv2:scheduled_tasks'
          ? 'Scheduled Tasks'
          : 'Antigravity v2';
    setOptimisticV2ChatFocus(prev => ({
      ...prev,
      [sessionId]: {
        id: itemId,
        title: item?.title || fallbackTitle,
        kind: item?.kind || 'chat',
        at: Date.now(),
      },
    }));
    if (itemId === '__agv2:new_conversation') {
      handleAntigravityV2New(sessionId);
      return;
    }
    switchChat(sessionId, itemId);
    setTimeout(() => requestHistory(sessionId, historyRequestOptionsForSessionId(sessionId)), 180);
    setTimeout(() => requestChatList(sessionId), 450);
    setTimeout(() => requestChatList(sessionId), 1200);
  }

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
            onLaunch={(agentType, workspacePath, options) => launchSession(agentType, workspacePath, options)}
            onResume={(sourceSession, agentType, workspacePath) => resumeSession(sourceSession, agentType, workspacePath)}
            onClose={() => setShowNewSession(false)}
            workspaces={workspaces}
          />
        )}
        <div className="session-list">
          {orderedSessions.length === 0 && !showNewSession && (
            <div className="session-empty">No agents connected</div>
          )}
          {sessionGroups.map(group => (
            <div className="session-group" key={group.key}>
              <div className="session-group-header" title={group.label}>
                <span className="session-group-name">{group.label}</span>
                <span className="session-group-count">{group.sessions.length}</span>
              </div>
              {group.sessions.map(s => {
                const id = typeof s === 'string' ? s : s?.session_id;
                return (
                  <MemoSessionCard
                    key={id}
                    session={s}
                    health={health[id]}
                    unread={unread[id] || 0}
                    isThinking={!!thinking[id]}
                    isActive={id === activeSession}
                    agentConfig={agentConfigs[id] || null}
                    activity={activities[id] || null}
                    sessionMessages={messages[id] || []}
                    hasBlockingPrompt={!!permissionPrompts[id] || !!isBlockingErrorPrompt(errorPrompts[id])}
                    blockingPromptLabel={permissionPrompts[id] ? 'Permission required' : (errorPrompts[id]?.title || 'Action required')}
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
          ))}
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
                    {activeAgent.logo
                      ? <img src={activeAgent.logo} alt={activeAgent.abbr} className="agent-badge-logo" />
                      : activeAgent.abbr}
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
                  {activeSessionMeta?.agent_type === 'codex' && activeSessionMeta?.visible_pane_visible && (
                    <span
                      className={`context-pill ${activeCodexPaneLive ? 'ok' : 'warn'}`}
                      title={activeCodexPaneLive ? 'This Codex session is the visible right-hand pane' : `Visible right-hand pane is ${visiblePaneLabel}`}
                    >
                      {activeCodexPaneLive ? 'right pane live' : `right pane: ${agentTypeLabel(activeSessionMeta.visible_pane_agent) || 'other'}`}
                    </span>
                  )}
                  {currentMessages.length > 0 && (
                    <span className="context-pill" title="Messages in this session">
                      {currentMessages.length} msg{currentMessages.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {(activeConfig?.capabilities?.chat_list || isAntigravityV2) && (
                    <button
                      className={`context-pill chat-list-toggle${(isAntigravityV2 ? agv2NavigatorOpen : showChatList) ? ' active' : ''}`}
                      title={isAntigravityV2 ? `${agv2NavigatorOpen ? 'Hide' : 'Show'} Agent Manager projects and conversations` : 'View conversations'}
                      onClick={() => {
                        if (isAntigravityV2) {
                          setAgv2NavigatorOpen(open => !open);
                          setShowChatList(false);
                          requestChatList(activeSession);
                          return;
                        }
                        const next = !showChatList;
                        setShowChatList(next);
                        if (next) requestChatList(activeSession);
                      }}
                    >
                      {isAntigravityV2 ? 'projects' : 'chats'}
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
                  {activeAutomationView?.visible && (
                    <span className="context-pill ok" title={activeAutomationView.title || 'Automation'}>
                      automation
                    </span>
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
                  {activeConfig?.capabilities?.native_window && (
                    <button
                      className="context-pill open-panel-btn"
                      title="Open this Claude CLI session in a native command window"
                      onClick={() => openNativeWindow(activeSession)}
                    >
                      native
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
            <TaskList taskList={activeActivity.task_list} sessionId={activeSession} />
          </div>
        )}

        {showLiveStatusStrip && (
          <div className="session-live-status-strip">
            <ActivityRow
              activity={activeActivity}
              thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
              isClaude={activeSessionMeta?.agent_type === 'claude'}
              showStatus={!isActiveCodexCli}
              showCommand={!isActiveCodexCli}
              pinned
            />
          </div>
        )}

        {(activeSessionMeta?.agent_type === 'cline' || activeSessionMeta?.agent_type === 'roo_code') && activeContextCard && (
          <div className={`cline-context-strip ${activeSessionMeta?.agent_type === 'roo_code' ? 'roo-context-strip' : ''}`}>
            <ClineContextCard
              card={activeContextCard}
              tone={activeSessionMeta?.agent_type === 'roo_code' ? 'roo' : 'cline'}
            />
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
        <div className={`messages-wrap${activeAutomationView?.visible ? ' has-automation-pane' : ''}`} style={showFileBrowser ? { display: 'none' } : undefined}>
        {showDesktopThreadTabs && (
          <ThreadTabsBar
            threads={desktopThreadTabs}
            activeThreadId={optimisticThreadFocus[activeSession] || null}
            showDraftTab={!!pendingDraftThreads[activeSession]}
            newLabel={newThreadLabel}
            onSwitch={(threadId) => handleSwitchThread(activeSession, threadId)}
            onNew={() => handleNewThread(activeSession)}
            onOpenHistory={() => {
              requestThreadList(activeSession);
              setShowThreadList(true);
            }}
          />
        )}
        {showLastUserBanner && (
          <div className="last-user-banner" title={lastUserText}>
            <span className="last-user-banner-icon">↵</span>
            <span className="last-user-banner-text">{lastUserText}</span>
          </div>
        )}
        {showVisiblePaneBanner && (
          <div className="rate-limit-overlay warning">
            <span className="rate-limit-icon">⌘</span>
            <span className="rate-limit-text">
              The visible right-hand pane for this workspace is showing <strong>{visiblePaneSummary || sessionSubLabel(visiblePaneSession, sessionIdOf(visiblePaneSession))}</strong>, not this transcript.
            </span>
            <button
              className="context-pill"
              onClick={() => selectSession(sessionIdOf(visiblePaneSession), visiblePaneSession)}
              title="Switch to the live right-hand pane session"
            >
              View live pane
            </button>
          </div>
        )}
        {showAntigravityV2Navigator && (
          <div className={`agv2-session-nav${agv2NavigatorOpen ? '' : ' collapsed'}`}>
            <div className="agv2-session-nav-header">
              <div className="agv2-session-nav-copy">
                <span className="agv2-session-nav-title">Agent Manager</span>
                <span className="agv2-session-nav-meta">
                  {activeV2ConversationCount} conversation{activeV2ConversationCount === 1 ? '' : 's'}
                </span>
              </div>
              <button
                className="agv2-session-nav-btn"
                type="button"
                onClick={() => requestChatList(activeSession)}
                title="Refresh Agent Manager conversations"
              >
                Refresh
              </button>
              <button
                className="agv2-session-nav-btn"
                type="button"
                onClick={() => {
                  setAgv2NavigatorOpen(open => !open);
                  requestChatList(activeSession);
                }}
                title={agv2NavigatorOpen ? 'Hide Agent Manager conversations' : 'Show Agent Manager conversations'}
              >
                {agv2NavigatorOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {agv2NavigatorOpen && (
              <AntigravityV2NavPanel
                items={activeChatList}
                embedded
                loading={!activeChatListLoaded}
                onNavigate={(itemId) => handleAntigravityV2Navigate(itemId)}
                onNew={() => handleAntigravityV2New(activeSession)}
              />
            )}
          </div>
        )}
        {showJumpButton && (
          <button
            className="jump-to-newest"
            onClick={pinTranscriptToNewest}
          >↓ Jump to Newest</button>
        )}
        <div className={`messages${showInlineClaudeActivity ? ' compact-footer-gap' : ''}`} ref={messagesListRef}>
          {shouldBottomAlignMessages && <div className="messages-flex-spacer" />}
          {activePrompt && (
            <PermissionOverlay
              prompt={activePrompt}
              sessionId={activeSession}
              onRespond={respondToPrompt}
            />
          )}
          {activeBlockingErrorPrompt && !activePrompt && (
            <ErrorPromptOverlay
              prompt={activeBlockingErrorPrompt}
              sessionId={activeSession}
              onRespond={respondToErrorPrompt}
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
          {showPartialHistoryBanner && (
            <div className="history-tail-banner">
              <span>Showing latest {partialHistoryLoaded.toLocaleString()} of {partialHistoryTotal.toLocaleString()} messages</span>
              <button type="button" onClick={loadOlderActiveHistory} disabled={!!activeHistoryLoading}>
                {activeHistoryLoading ? 'Loading older messages...' : 'Load older messages'}
              </button>
            </div>
          )}
          {!activeSession ? (
            <div className="empty-state"><div className="icon">🤖</div><div>Select an agent session</div></div>
          ) : currentMessages.length === 0 && hasThreadCap && activeSessionMeta?.is_list_view && (threadLists[activeSession]?.length > 0) && !pendingDraftThreads[activeSession] ? (
            <div className="thread-picker-empty">
              <div className="thread-picker-header">Select a chat</div>
              <div className="thread-picker-list">
                {threadLists[activeSession].map((thread, i) => (
                  <button
                    key={thread.id || i}
                    className={`thread-picker-item${thread.active ? ' active' : ''}`}
                    onClick={() => {
                      handleSwitchThread(activeSession, thread.id);
                    }}
                    title={thread.title}
                  >
                    <span className="thread-picker-title">{thread.title || 'Untitled'}</span>
                    {thread.age && <span className="thread-picker-age">{thread.age}</span>}
                  </button>
                ))}
              </div>
              <button
                className="thread-picker-new"
                onClick={() => handleNewThread(activeSession)}
              >+ New Thread</button>
            </div>
          ) : currentMessages.length === 0 && isAntigravityV2 && activeSessionMeta?.is_list_view ? (
            <div className="thread-picker-empty agv2-picker-empty">
              <div className="thread-picker-header">Choose a conversation or start a new one</div>
              {agv2NavigatorOpen ? null : (chatLists[activeSession]?.length > 0) ? (
                <AntigravityV2NavPanel
                  items={chatLists[activeSession] || []}
                  embedded
                  loading={!activeChatListLoaded}
                  onNavigate={(itemId) => handleAntigravityV2Navigate(itemId)}
                  onNew={() => handleAntigravityV2New(activeSession)}
                />
              ) : (
                <button className="thread-picker-new" onClick={() => handleAntigravityV2New(activeSession)}>+ New Conversation</button>
              )}
            </div>
          ) : currentMessages.length === 0 && isAntigravityV2 && chatLists[activeSession]?.length > 0 ? (
            <div className="thread-picker-empty agv2-picker-empty">
              <div className="thread-picker-header">Select an Antigravity project or conversation</div>
              {!agv2NavigatorOpen && <AntigravityV2NavPanel
                items={chatLists[activeSession] || []}
                embedded
                loading={!activeChatListLoaded}
                onNavigate={(itemId) => handleAntigravityV2Navigate(itemId)}
                onNew={() => handleAntigravityV2New(activeSession)}
              />}
            </div>
          ) : currentMessages.length === 0 && activeSessionMeta?.is_list_view && chatLists[activeSession]?.length > 0 ? (
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
          ) : currentMessages.length === 0 && activeHistoryLoading ? (
            <div className="empty-state history-loading-state">
              <span className="new-session-spinner" />
              <div>{activeHistoryLoading.mode === 'older' ? 'Loading older messages...' : 'Loading latest messages...'}</div>
            </div>
          ) : currentMessages.length === 0 ? (
            <div className="empty-state"><div className="icon">💬</div><div>No messages yet</div></div>
          ) : (
            <>
              {hiddenLoadedMessageCount > 0 && (
                <div className="history-tail-banner transcript-render-window-banner">
                  <span>Rendering latest {renderedMessages.length.toLocaleString()} of {currentMessages.length.toLocaleString()} loaded messages</span>
                  <button
                    type="button"
                    onClick={() => setExpandedTranscriptSessions(prev => ({ ...prev, [activeSession]: true }))}
                  >Render all loaded</button>
                </div>
              )}
              {renderAllLoadedTranscript && currentMessages.length > transcriptRenderTailLimit && (
                <div className="history-tail-banner transcript-render-window-banner">
                  <span>Rendering all {currentMessages.length.toLocaleString()} loaded messages</span>
                  <button
                    type="button"
                    onClick={() => setExpandedTranscriptSessions(prev => ({ ...prev, [activeSession]: false }))}
                  >Return to latest only</button>
                </div>
              )}
              {renderedMessageNodes}
            </>
          )}
          {showLiveAssistantDraft && (
            <div className={`message assistant live-draft${assistantMonospace ? ' monospace' : ''}`}>
              <div className="assistant-gutter">
                <div
                  className="agent-badge transcript-agent-badge"
                  style={{ color: activeAgent.color, borderColor: activeAgent.color + '55', background: activeAgent.color + '18' }}
                >
                  {activeAgent.logo
                    ? <img src={activeAgent.logo} alt={activeAgent.abbr} className="agent-badge-logo" />
                    : activeAgent.abbr}
                </div>
              </div>
              <div className="assistant-content">
                <div className="message-role"><span>{activeAgent.name}</span></div>
                <MarkdownContent content={liveThinkingText} monospace={assistantMonospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={(path) => openTranscriptPreview('live-draft', path)} />
              </div>
            </div>
          )}
          {showInlineClaudeActivity && <ActivityRow
            activity={activeActivity}
            thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
            isClaude
          />}
          {activeInlineErrorPrompt && !activePrompt && (
            <ErrorPromptInline
              prompt={activeInlineErrorPrompt}
              sessionId={activeSession}
              onRespond={respondToErrorPrompt}
            />
          )}
          <div ref={messagesEndRef} />
        </div>
        {!showLiveStatusStrip && !showCodexCliWorkingStrip && activeActivity && !showInlineClaudeActivity && (activeActivity.kind !== 'idle' || hasSubstantiveLiveText(thinkingContent[activeSession] || activeActivity.thinkingContent || '')) && <ActivityRow
          activity={activeActivity}
          thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
          isClaude={activeSessionMeta?.agent_type === 'claude'}
          pinned
        />}
        <CodexAutomationPane
          view={activeAutomationView}
          onShow={() => activeSession && showCodexAutomation(activeSession)}
        />
        </div>

        {showSettings && activeSession && (
          <AgentSettingsPanel
            session={activeSessionMeta || activeSession}
            config={activeConfig}
            onRequestRefresh={requestAgentConfig}
            onSetModel={(sid, modelId) => setAgentModel(sid, modelId)}
            onSetEffort={(sid, effort) => setAgentEffort(sid, effort)}
            onSetPermissionMode={(sid, mode) => setAgentPermissionMode(sid, mode)}
            onSetAutoApprovePermissions={(sid, enabled) => setAutoApprovePermissions(sid, enabled)}
            onSetMode={(sid, mode) => setAntigravityMode && setAntigravityMode(sid, mode)}
            onSetCodexConfig={(updates) => setCodexConfig(activeSession, updates)}
            onSwitchWorkspace={(sid, folderPath) => switchWorkspace(sid, folderPath)}
            onClose={() => setShowSettings(false)}
          />
        )}

        {false && transcriptPreview && (
          <TranscriptFilePreview
            sessionId={transcriptPreview.sessionId}
            filePath={transcriptPreview.path}
            fileContents={fileContents}
            onClose={() => setTranscriptPreview(null)}
          />
        )}

        {showChatList && activeSession && activeConfig?.capabilities?.chat_list && !isAntigravityV2 && (
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
            newLabel={newThreadLabel}
            onSwitch={(threadId) => {
              handleSwitchThread(activeSession, threadId);
              setShowThreadList(false);
            }}
            onNew={() => {
              handleNewThread(activeSession);
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
            onAccept={(changeId) => respondToFileChange(activeSession, changeId, 'accept')}
            onReject={(changeId) => respondToFileChange(activeSession, changeId, 'reject')}
            onClose={() => setShowDiffViewer(false)}
          />
        )}

        {showCodexCliWorkingStrip && (
          <div className="composer-live-status-strip">
            <ActivityRow
              activity={activeActivity}
              thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
              isClaude={false}
              pinned
            />
          </div>
        )}

        <div className="input-area" style={showFileBrowser ? { display: 'none' } : undefined}>
          <label className={`attach-btn ${!activeSession || !connected || !!activeBlockingPrompt ? 'disabled' : ''}`} title="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input
              type="file"
              hidden
              multiple
              ref={fileInputRef}
              onChange={handleFileSelect}
              disabled={!activeSession || !connected || !!activeBlockingPrompt}
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
                placeholder={activeBlockingPrompt
                  ? `Resolve the ${activePrompt ? 'permission prompt' : 'error prompt'} above to continue`
                  : activeSession
                    ? (window.innerWidth < 600 ? 'Enter message…' : 'Message… (/ for commands)')
                    : 'Select a session'}
                disabled={!activeSession || !connected || !!activeBlockingPrompt}
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
                {canLaunchNewThread && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => handleNewThread(activeSession)}
                    title={newThreadLabel}
                  >✎</button>
                )}
                {(activeConfig?.capabilities?.chat_list || isAntigravityV2) && (
                  <button
                    className={`composer-gear-btn mobile-hide${(isAntigravityV2 ? agv2NavigatorOpen : showChatList) ? ' active' : ''}`}
                    onClick={() => {
                      if (isAntigravityV2) {
                        setAgv2NavigatorOpen(open => !open);
                        setShowChatList(false);
                        requestChatList(activeSession);
                        return;
                      }
                      const willShow = !showChatList;
                      setShowChatList(willShow);
                      if (willShow) requestChatList(activeSession);
                    }}
                    title={isAntigravityV2 ? 'Agent Manager conversations' : 'Chat history'}
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
                {activeConfig?.capabilities?.native_window && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => openNativeWindow(activeSession)}
                    title="Open native command window"
                  >cmd</button>
                )}
                {activeConfig?.capabilities?.new_chat && (
                  <button
                    className="composer-gear-btn mobile-hide"
                    onClick={() => isAntigravityV2 ? handleAntigravityV2New(activeSession) : newChat(activeSession)}
                    title={isAntigravityV2 ? 'New Antigravity conversation' : 'New chat'}
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
              {(isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.mode && activeConfig.mode !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.mode}</span>
              )}
              {(isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.model_id && activeConfig.model_id !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.model_id}</span>
              )}
              {activeSessionMeta?.agent_type === 'antigravity-v2' && activeConfig?.model_id && activeConfig.model_id !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#8b949e' }}>{activeConfig.model_id}</span>
              )}
              {(activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') && (
                Array.isArray(activeSessionMeta?.antigravity_quota_models) && activeSessionMeta.antigravity_quota_models.length > 0 ? (
                  <span className="composer-hint" style={{ color: '#8b949e' }}>
                    {formatAntigravityQuotaSummary(activeSessionMeta.antigravity_quota_models, 4)}
                  </span>
                ) : activeSessionMeta?.percent_used != null ? (
                  <span className="composer-hint" style={{ color: activeSessionMeta.percent_used >= 90 ? '#f85149' : activeSessionMeta.percent_used >= 75 ? '#d29922' : '#8b949e' }}>
                    Quota {activeSessionMeta.percent_used}%{activeSessionMeta?.rate_limited_until && activeSessionMeta.rate_limited_until !== 'unknown' ? ` · ${activeSessionMeta.rate_limited_until}` : ''}
                  </span>
                ) : null
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
                      {composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {!composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).some(m => m.id === activeConfig.model_id) && activeConfig?.model_id && activeConfig.model_id !== 'unknown' && (
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
                {isClineLikeAgentType(activeSessionMeta?.agent_type) && activeConfig?.capabilities?.set_mode && modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).length > 0 && (
                  <label className="composer-setting-label">
                    <span className="composer-setting-key">Mode</span>
                    <select
                      className="composer-setting-select"
                      value={activeConfig?.mode || modeOptionsFor(activeSessionMeta?.agent_type, activeConfig)[0]?.id || 'unknown'}
                      onChange={e => setAntigravityMode(activeSession, e.target.value)}
                    >
                      {modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {activeConfig?.mode && activeConfig.mode !== 'unknown' && !modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).some(m => m.id === activeConfig.mode) && (
                        <option value={activeConfig.mode}>{activeConfig.mode}</option>
                      )}
                    </select>
                  </label>
                )}
                {activeConfig?.capabilities?.permission_mode_change && (
                  <select
                    className="composer-setting-select"
                    value={activeConfig.permission_mode || defaultPermissionModeFor(activeSessionMeta?.agent_type)}
                    onChange={e => setAgentPermissionMode(activeSession, e.target.value)}
                    title="Permission mode"
                  >
                    {permissionModeOptionsFor(activeSessionMeta?.agent_type || 'claude', activeConfig).map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    {activeConfig.permission_mode && !permissionModeOptionsFor(activeSessionMeta?.agent_type, activeConfig).some(m => m.value === activeConfig.permission_mode) && activeConfig.permission_mode !== 'unknown' && (
                      <option value={activeConfig.permission_mode}>{activeConfig.permission_mode}</option>
                    )}
                  </select>
                )}
                {(activeSessionMeta?.agent_type === 'claude_cli' || activeSessionMeta?.agent_type === 'codex_cli') && activeConfig?.capabilities?.set_effort && (activeConfig.available_efforts || []).length > 0 && (
                  <select
                    className="composer-setting-select"
                    value={activeConfig.effort || 'medium'}
                    onChange={e => setAgentEffort(activeSession, e.target.value)}
                    title={`${activeSessionMeta?.agent_type === 'codex_cli' ? 'Codex' : 'Claude'} CLI effort`}
                  >
                    {(activeConfig.available_efforts || []).map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                )}
                {activeConfig?.capabilities?.auto_approve_permissions_toggle && (
                  <label className="composer-setting-toggle" title="Automatically approve permission prompts for this session">
                    <input
                      type="checkbox"
                      checked={
                        typeof activeConfig?.auto_approve_permissions === 'boolean'
                          ? activeConfig.auto_approve_permissions
                          : !!activeSessionMeta?.auto_approve_permissions
                      }
                      onChange={e => setAutoApprovePermissions(activeSession, e.target.checked)}
                    />
                    <span>Auto-approve prompts</span>
                  </label>
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
                      value={(activeConfig.speed || 'standard').toLowerCase()}
                      onChange={e => setCodexConfig(activeSession, { speed: e.target.value })}
                      title="Speed"
                    >
                      {(activeConfig.available_speeds || []).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      {activeConfig.speed && !(activeConfig.available_speeds || []).some(m => m.id === activeConfig.speed) && activeConfig.speed !== 'unknown' && (
                        <option value={activeConfig.speed}>{activeConfig.speed}</option>
                      )}
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
                  {canLaunchNewThread && (
                    <button className="composer-mobile-action" onClick={() => newThread(activeSession)}>✎ New thread</button>
                  )}
                  {(activeConfig?.capabilities?.chat_list || isAntigravityV2) && (
                    <button className="composer-mobile-action" onClick={() => {
                      requestChatList(activeSession);
                      if (isAntigravityV2) {
                        setAgv2NavigatorOpen(true);
                        setShowChatList(false);
                      } else {
                        setShowChatList(true);
                      }
                      setShowComposerSettings(false);
                    }}>☰ {isAntigravityV2 ? 'Projects' : 'Chat history'}</button>
                  )}
                  {activeConfig?.capabilities?.thread_list && (
                    <button className="composer-mobile-action" onClick={() => { requestThreadList(activeSession); setShowThreadList(true); setShowComposerSettings(false); }}>⊟ Threads</button>
                  )}
                  {activeConfig?.capabilities?.open_panel && (
                    <button className="composer-mobile-action" onClick={() => openPanel(activeSession)}>⊞ Open panel</button>
                  )}
                  {activeConfig?.capabilities?.new_chat && (
                    <button className="composer-mobile-action" onClick={() => isAntigravityV2 ? handleAntigravityV2New(activeSession) : newChat(activeSession)}>+ New chat</button>
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
