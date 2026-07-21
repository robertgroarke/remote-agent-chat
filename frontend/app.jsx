// app.jsx — App component and entry point
// Primary file for Agent 5 UI redesign work.

import { getLang, isTextFile, sessionLabel } from './file-utils.js';
import { MarkdownContent } from './markdown.js';
import { shouldRefreshNativeCliPlaceholder, useRelay } from './hooks.jsx';
import {
  resolveSessionChatTitle,
  resolveSessionChatTitleProjection,
  retainStrongerSessionChatTitleProjection,
} from './session-title.js';
import { partitionPinnedSessions } from './session-pins.js';
import { normalizeLatestVisibleMessage, projectRecentChatOwnership } from './recent-chats.js';
import {
  formatAbsoluteMessageTime,
  formatVisibleMessageTime,
  messageInstant,
  parseMessageInstant,
} from './message-time.js';
import {
  getTranscriptSnapshot,
  subscribeCachedTranscript,
} from './transcript-cache.js';
import {
  DEFAULT_GROUP_ALIASES,
  GROUP_ALIAS_STORAGE_KEY,
  createSidebarOrderLedger,
  createSidebarWorkingLedger,
  groupSessionsByDirectory,
  normalizeGroupAliases,
  partitionSidebarSessionsByWorking,
  reconcileSidebarOrderLedger,
  reconcileSidebarWorkingLedger,
  sessionIsTestSession,
  sortSidebarOrderLedger,
} from './workspace-groups.js';
import {
  MAX_BROADCAST_CONTENT_CHARS,
  MAX_BROADCAST_SESSIONS,
  createBroadcastReceiptState,
  normalizeBroadcastRequest,
  sessionSupportsBroadcast,
} from './broadcast-send-policy.js';
import { FullTitleDisclosure } from './title-disclosure.jsx';
import {
  GOAL_CONTROL_SLASH_COMMANDS,
  classifyGoalCommandIntent,
  satisfiedGoalCommandLabel,
} from './goal-command.js';
import {
  formatOllamaDuration,
  formatOllamaTokenRate,
  formatProviderCredits,
  formatProviderPercent,
  formatProviderUsageAge,
  formatProviderUsageReset,
  normalizeProviderUsage,
  providerFinancialRows,
  selectEstimatedCost,
} from './provider-usage.js';
import { ProviderMark } from './provider-marks.jsx';
import { sessionUsageProjection, sessionUsageWindowLabel } from './session-usage.js';
import {
  DEFAULT_ACTIVITY_FRESHNESS_MS,
  classifyFleetActivity,
  fleetActivityObservedAtMs,
  fleetFreshnessLabel,
  fleetGoalElapsedSeconds,
  fleetGoalSubstateLabel,
  fleetStateIsWorking,
  fleetStateLabel,
} from './fleet-activity.js';
import {
  HOST_RESOURCE_CHART_RANGES,
  downsampleHostResourceSeries,
  formatHostResourceAge,
  formatHostResourceBytes,
  formatHostResourcePercent,
  formatHostResourceRate,
  formatHostResourceTimestamp,
  formatHostResourceTimestampFull,
  hostResourceIntervalStats,
  hostResourceMetricValue,
  hostResourceNiceScale,
  hostResourceTimeFraction,
  hostResourceTimeTicks,
  hostResourceTimeline,
  normalizeHostResources,
  projectHostResourceStrip,
  selectHostResourceRange,
} from './host-resources.js';
import {
  claimSemanticNotification,
  recordSemanticNotificationStage,
  semanticNotificationAllowed,
} from './semantic-notifications.js';
import fleetWorkContextPolicy from '../relay-server/fleet-work-context.js';

const {
  goalLifecycleSupported,
  latestUserRequestFromMessages,
  projectFleetWorkContext,
} = fleetWorkContextPolicy;

const { useState, useRef, useEffect, useLayoutEffect } = React;

const DRAFT_STORAGE_KEY = 'remote-agent-chat:drafts:v1';
const SHOW_TEST_SESSIONS_STORAGE_KEY = 'remote-agent-chat:show-test-sessions:v1';
const DEFAULT_INITIAL_HISTORY_LIMIT = 120;
const CODEX_INITIAL_HISTORY_LIMIT = 500;
const CODEX_CLI_INITIAL_HISTORY_LIMIT = 160;
const CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES = 256 * 1024;
const EMPTY_MESSAGES = Object.freeze([]);
const SLASH_COMMANDS = [
  ...GOAL_CONTROL_SLASH_COMMANDS,
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
  cursor_cli:        { name: 'Cursor CLI',      color: '#7c6cf0', abbr: 'CLI', logo: '/logo-cursor.svg' },
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

function historyLimitForAgentType(agentType) {
  if (agentType === 'codex_cli' || agentType === 'cursor_cli') return CODEX_CLI_INITIAL_HISTORY_LIMIT;
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
  if (msg.source_message_id) return `source:${msg.source_message_id}`;
  if (msg.native_source_id) return `native:${msg.native_source_id}`;
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

function messageContentIdentityHash(msg) {
  const content = normalizeMessageContent(msg?.content) || contentBlocksFallback(msg?.content_blocks);
  const blocks = Array.isArray(msg?.content_blocks) ? JSON.stringify(msg.content_blocks) : '';
  return stableContentHash(`${content}\n${blocks}`);
}

function topLevelMessageBlockType(msg) {
  if (msg?.role === 'user') return 'user';
  return normalizeContentBlocks(msg?.content_blocks)[0]?.type || 'markdown';
}

function scrollIdentityKeysForMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((msg, i) => messageIdentityKey(msg, i));
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
      if (type === 'tool_output' || type === 'result') return { ...block, type: 'tool_result' };
      if (type === 'thought') return { ...block, type: 'thinking' };
      if (type === 'task_list') return { ...block, type: 'plan' };
      if (type === 'queue' || type === 'queued') return { ...block, type: 'queued_message' };
      if (type === 'banner' || type === 'notification') return { ...block, type: 'notice' };
      if (type === 'worked' || type === 'activity') return { ...block, type: 'status' };
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
  if (Array.isArray(block.tasks) && block.tasks.length > 0) {
    const tasks = block.tasks.map(task => {
      const text = safeString(task?.text || task?.step || task?.title).trim();
      const state = safeString(task?.state || task?.status || 'pending').trim();
      return text ? `[${state}] ${text}` : '';
    }).filter(Boolean).join('\n');
    return [block.content || '', tasks].filter(Boolean).join('\n');
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

const TRANSCRIPT_DISCLOSURE_CACHE_LIMIT = 512;
const transcriptDisclosureState = new Map();

function rememberTranscriptDisclosure(stateKey, open) {
  if (!stateKey) return;
  transcriptDisclosureState.delete(stateKey);
  transcriptDisclosureState.set(stateKey, open);
  while (transcriptDisclosureState.size > TRANSCRIPT_DISCLOSURE_CACHE_LIMIT) {
    transcriptDisclosureState.delete(transcriptDisclosureState.keys().next().value);
  }
}

function TranscriptDisclosure({ className, summary, children, stateKey = '', defaultOpen = true }) {
  const [open, setOpen] = React.useState(() => (
    stateKey && transcriptDisclosureState.has(stateKey)
      ? transcriptDisclosureState.get(stateKey)
      : defaultOpen
  ));
  const handleToggle = React.useCallback((event) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    rememberTranscriptDisclosure(stateKey, nextOpen);
  }, [stateKey]);
  return (
    <details
      className={className}
      open={open}
      onToggle={handleToggle}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

function cursorFileChangeSummaryParts(value) {
  const match = safeString(value).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);
  if (!match) return null;
  return { label: match[1], additions: match[2] || '', deletions: match[3] || '' };
}

function ContentBlocks({
  blocks,
  monospace,
  autoExpandLongCodeBlocks,
  onOpenPath,
  agentType,
  richContentEager = true,
  richContentCacheIdentity = '',
}) {
  const normalized = normalizeContentBlocks(blocks);
  if (normalized.length === 0) return null;
  const isCursor = safeString(agentType).toLowerCase() === 'cursor';
  const isClaude = safeString(agentType).toLowerCase() === 'claude';
  const isCodex = safeString(agentType).toLowerCase() === 'codex';
  const isCodexDesktop = safeString(agentType).toLowerCase() === 'codex-desktop';
  const isAntigravityV2 = safeString(agentType).toLowerCase() === 'antigravity-v2';
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
  function richMarkdown(value, blockIndex) {
    return (
      <MarkdownContent
        content={value}
        monospace={monospace}
        autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
        onOpenPath={onOpenPath}
        deferUntilVisible={!richContentEager}
        cacheIdentity={`${richContentCacheIdentity}:block:${blockIndex}`}
      />
    );
  }
  return (
    <div className={`content-blocks${isCursor ? ' content-blocks-cursor' : ''}`}>
      {normalized.map((block, index) => {
        const type = safeString(block.type || 'markdown').toLowerCase();
        const title = safeString(block.title || block.label || block.summary || type);
        const body = blockBody(block);
        if (type === 'status') {
          return (
            <div key={index} className="content-block content-block-status-chip" title={title}>
              {title || 'Status'}
            </div>
          );
        }
        if (type === 'thinking') {
          // Cursor "Thought for Ns" chips are header-only; keep them compact like Agents.
          const bodyIsTitleOnly = !body || safeString(body).replace(/\s+/g, ' ').trim() === title;
          // Codex renders intermediate commentary as ordinary transcript prose. It does not
          // wrap settled reasoning in the shared labeled disclosure used by other harnesses.
          if (isCodex) {
            const nativeThinkingBody = body && !bodyIsTitleOnly
              ? body
              : (title && title.toLowerCase() !== 'thinking' ? title : '');
            return nativeThinkingBody ? (
              <div key={index} className="content-block content-block-thinking-native">
                {richMarkdown(nativeThinkingBody, index)}
              </div>
            ) : null;
          }
          // Codex Desktop exposes settled reasoning as a flat "Worked for ..."
          // row followed by ordinary transcript blocks. The parser preserves
          // that native split, so a title-only thinking block must not become
          // the shared italic, left-rail card or a fake empty disclosure.
          if (isCodexDesktop && bodyIsTitleOnly) {
            return (
              <div key={index} className="content-block content-block-thinking-codex-desktop">
                <span>{title || 'Worked'}</span>
                <span className="content-block-thinking-codex-desktop-chevron" aria-hidden="true">⌄</span>
              </div>
            );
          }
          if (isCodexDesktop) {
            return (
              <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className="content-block content-block-thinking-codex-desktop" summary={title || 'Worked'}>
                {richMarkdown(body, index)}
              </TranscriptDisclosure>
            );
          }
          if (isCursor && bodyIsTitleOnly) {
            return (
              <div key={index} className="content-block content-block-status-chip thinking" title={title}>
                {title || 'Thinking'}
              </div>
            );
          }
          return (
            <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className="content-block content-block-thinking" summary={title || 'Thinking'}>
              {body && !bodyIsTitleOnly && richMarkdown(body, index)}
            </TranscriptDisclosure>
          );
        }
        if (type === 'tool_call' || type === 'tool_result') {
          // Cursor step-group headers ("Explored…", "Running…") are often body-less.
          const bodyIsTitleOnly = !body || safeString(body).replace(/\s+/g, ' ').trim() === title;
          if (isCursor && bodyIsTitleOnly) {
            return (
              <div key={index} className="content-block content-block-status-chip tool" title={title}>
                {title || 'Tool'}
              </div>
            );
          }
          return (
            <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className={`content-block content-block-${type === 'tool_result' ? 'tool-result' : 'tool'}`} summary={(
              <>
                <span>{title || (type === 'tool_result' ? 'Tool result' : 'Tool')}</span>
                {block.status && <span className={`content-block-status ${safeString(block.status).toLowerCase()}`}>{block.status}</span>}
              </>
            )}>
              {body && <pre className="content-block-pre">{body}</pre>}
              <ContentBlockActions actions={block.actions} />
            </TranscriptDisclosure>
          );
        }
        if (type === 'terminal') {
          if (isClaude) {
            const titleParts = (title || 'Bash').match(/^(\S+)(?:\s+([\s\S]*))?$/);
            const toolName = titleParts?.[1] || 'Bash';
            const toolDescription = titleParts?.[2] || '';
            const terminalStatus = safeString(block.status || 'running').toLowerCase();
            return (
              <div key={index} className="content-block content-block-terminal-claude" role="group" aria-label={title || 'Bash command'}>
                <div className="content-block-terminal-claude-header">
                  <span className={`content-block-terminal-claude-dot ${terminalStatus}`} aria-hidden="true" />
                  <strong>{toolName}</strong>
                  {toolDescription && <span>{toolDescription}</span>}
                </div>
                <div className="content-block-terminal-claude-body">
                  {block.command && (
                    <div className="content-block-terminal-claude-row">
                      <span>IN</span>
                      <pre>{block.command}</pre>
                    </div>
                  )}
                  {block.stdout && (
                    <div className="content-block-terminal-claude-row">
                      <span>OUT</span>
                      <pre>{block.stdout}</pre>
                    </div>
                  )}
                  {block.stderr && (
                    <div className="content-block-terminal-claude-row error">
                      <span>ERR</span>
                      <pre>{block.stderr}</pre>
                    </div>
                  )}
                </div>
                <ContentBlockActions actions={block.actions} />
              </div>
            );
          }
          if (isCodexDesktop) {
            return (
              <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className="content-block content-block-terminal-codex-desktop" summary={(
                <span>Ran commands</span>
              )}>
                {body && <pre className="content-block-pre">{body}</pre>}
                <ContentBlockActions actions={block.actions} />
              </TranscriptDisclosure>
            );
          }
          return (
            <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className="content-block content-block-terminal" summary={(
              <>
                <span>{title || 'Terminal'}</span>
                {block.exit_code != null && <span className="content-block-status">exit {block.exit_code}</span>}
              </>
            )}>
              {body && <pre className="content-block-pre">{body}</pre>}
              <ContentBlockActions actions={block.actions} />
            </TranscriptDisclosure>
          );
        }
        if (type === 'file_changes') {
          const cursorSummary = cursorFileChangeSummaryParts(title);
          const isCursorSummaryOnly = Boolean(
            isCursor
            && cursorSummary
            && !body
            && (!Array.isArray(block.files) || block.files.length === 0)
            && (!Array.isArray(block.actions) || block.actions.length === 0)
          );
          if (isCursorSummaryOnly) {
            return (
              <div key={index} className="content-block content-block-file-change content-block-file-change-cursor-summary">
                <span>{cursorSummary.label}</span>
                {cursorSummary.additions && <span className="content-block-add">{cursorSummary.additions}</span>}
                {cursorSummary.deletions && <span className="content-block-del">{cursorSummary.deletions}</span>}
              </div>
            );
          }
          const stats = [
            block.files_changed != null ? `${block.files_changed} files` : null,
            block.additions != null ? `+${block.additions}` : null,
            block.deletions != null ? `-${block.deletions}` : null,
          ].filter(Boolean).join(' ');
          return (
            <TranscriptDisclosure key={index} stateKey={`${richContentCacheIdentity}:disclosure:${index}`} className="content-block content-block-file-change" summary={(
              <>
                <span>{title || 'File changes'}{stats ? ` ${stats}` : ''}</span>
                {block.status && <span className={`content-block-status ${safeString(block.status).toLowerCase()}`}>{block.status}</span>}
              </>
            )}>
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
              {body && richMarkdown(body, index)}
              <ContentBlockActions actions={block.actions} />
            </TranscriptDisclosure>
          );
        }
        if (type === 'artifact') {
          return (
            <div key={index} className="content-block content-block-artifact">
              <div className="content-block-title">{title || 'Artifact'}</div>
              {body && richMarkdown(body, index)}
            </div>
          );
        }
        if (type === 'plan') {
          const tasks = Array.isArray(block.tasks) ? block.tasks : [];
          return (
            <div key={index} className="content-block content-block-plan">
              <div className="content-block-title">{title || 'Plan'}</div>
              {tasks.length > 0 && (
                <ol className="content-block-plan-list">
                  {tasks.map((task, taskIndex) => {
                    const state = safeString(task?.state || task?.status || 'pending').toLowerCase();
                    return (
                      <li key={task.id || taskIndex} className={`content-block-plan-item ${state}`}>
                        <span className="content-block-plan-marker" aria-hidden="true">
                          {state === 'completed' ? '✓' : state === 'in_progress' ? '•' : '○'}
                        </span>
                        <span>{task.text || task.step || task.title || ''}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {body && !tasks.length && richMarkdown(body, index)}
            </div>
          );
        }
        if (type === 'queued_message') {
          return (
            <div key={index} className="content-block content-block-queued-message">
              <span className="content-block-queued-label">{title || 'Queued message'}</span>
              {body && <span className="content-block-queued-body">{body}</span>}
            </div>
          );
        }
        if (type === 'notice') {
          return (
            <div key={index} className={`content-block content-block-notice ${safeString(block.tone || block.status || 'info').toLowerCase()}`}>
              <div className="content-block-title">{title || 'Notice'}</div>
              {body && richMarkdown(body, index)}
              <ContentBlockActions actions={block.actions} />
            </div>
          );
        }
        if (type === 'error' && isAntigravityV2) {
          return (
            <TranscriptDisclosure
              key={index}
              stateKey={`${richContentCacheIdentity}:disclosure:${index}`}
              className="content-block content-block-error content-block-error-antigravity-v2"
              defaultOpen={false}
              summary={(
                <>
                  <span className="content-block-error-antigravity-v2-label">{title || 'Error'}</span>
                  {body && <span className="content-block-error-antigravity-v2-message">{body}</span>}
                </>
              )}
            >
              <ContentBlockActions actions={block.actions} />
            </TranscriptDisclosure>
          );
        }
        if (type === 'prompt' || type === 'error') {
          return (
            <div key={index} className={`content-block content-block-${type}`}>
              <div className="content-block-title">{title || type}</div>
              {body && richMarkdown(body, index)}
              <ContentBlockActions actions={block.actions} />
            </div>
          );
        }
        return (
          <div key={index} className="content-block content-block-markdown">
            {richMarkdown(body || title, index)}
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

function MessageTimestamp({ message = null, instant = null }) {
  const parsed = instant == null
    ? messageInstant(message)
    : parseMessageInstant(instant);
  if (!parsed) {
    return (
      <span
        className="message-timestamp message-timestamp-unknown"
        aria-label="Sent time unknown"
        title="Sent time unknown"
      >
        Time unknown
      </span>
    );
  }
  const absolute = formatAbsoluteMessageTime(parsed);
  return (
    <time
      className="message-timestamp"
      dateTime={parsed.iso}
      title={absolute}
      aria-label={`Sent ${absolute}`}
    >
      {formatVisibleMessageTime(parsed)}
    </time>
  );
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
  if (raw.includes('cursor cli') || raw.includes('cursor_cli')) return 'cursor_cli';
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

function sidebarChatTitle(sessionOrId, fallbackId, agentConfig, sessionMessages = []) {
  return resolveSessionChatTitle(
    sessionOrId,
    sessionOrId && typeof sessionOrId === 'object' ? sessionOrId.custom_display_name : '',
    sessionMessages,
  );
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

function projectSidebarOrder(groups, snapshot) {
  const groupPositions = new Map((snapshot?.groupOrder || []).map((key, index) => [key, index]));
  const sessionPositions = new Map((snapshot?.sessionOrder || []).map((id, index) => [id, index]));
  return [...(groups || [])].sort((left, right) => (
    (groupPositions.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (groupPositions.get(right.key) ?? Number.MAX_SAFE_INTEGER)
  )).map(group => ({
    ...group,
    sessions: [...(group.sessions || [])].sort((left, right) => (
      (sessionPositions.get(sessionIdOf(left)) ?? Number.MAX_SAFE_INTEGER)
      - (sessionPositions.get(sessionIdOf(right)) ?? Number.MAX_SAFE_INTEGER)
    )),
  }));
}

function harnessLayoutForAgentType(agentType) {
  if (agentType === 'claude') return 'claude-document';
  if (agentType === 'codex_cli') return 'codex-terminal';
  if (agentType === 'cursor') return 'cursor-cards';
  if (agentType === 'codex-desktop' || agentType === 'codex') return 'codex-thread';
  return 'unified-flow';
}

function composerSkinForAgentType(agentType) {
  if (agentType === 'codex_cli') return 'codex-cli';
  if (agentType === 'codex' || agentType === 'codex-desktop') return 'codex';
  if (agentType === 'claude' || agentType === 'claude_cli') return 'claude';
  if (agentType === 'cursor' || agentType === 'cursor_cli') return 'cursor';
  return 'default';
}

function fuzzySessionMatchScore(value, query) {
  const text = safeString(value).toLowerCase().replace(/\s+/g, ' ').trim();
  const needle = safeString(query).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!needle) return 0;
  const directIndex = text.indexOf(needle);
  if (directIndex >= 0) return 2000 - Math.min(directIndex, 500) - Math.max(0, text.length - needle.length) * 0.01;
  let score = 0;
  let cursor = 0;
  let previous = -1;
  for (const char of needle) {
    if (char === ' ') continue;
    const index = text.indexOf(char, cursor);
    if (index < 0) return Number.NEGATIVE_INFINITY;
    score += previous < 0 ? Math.max(0, 80 - index) : Math.max(1, 24 - (index - previous - 1) * 3);
    if (index === 0 || /[\s/\\_.:-]/.test(text[index - 1])) score += 35;
    previous = index;
    cursor = index + 1;
  }
  return score;
}

function rankQuickSwitcherItems(items, query) {
  const terms = safeString(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.map((item, sidebarIndex) => {
    const score = terms.reduce((total, term) => {
      const fields = Array.isArray(item.searchFields) && item.searchFields.length
        ? item.searchFields
        : [item.searchText];
      const next = Math.max(...fields.map(field => fuzzySessionMatchScore(field, term)));
      return Number.isFinite(total) && Number.isFinite(next) ? total + next : Number.NEGATIVE_INFINITY;
    }, 0);
    return { item, sidebarIndex, score };
  }).filter(row => Number.isFinite(row.score))
    .sort((left, right) => (
      Number(!!right.item.working) - Number(!!left.item.working)
      || right.score - left.score
      || left.sidebarIndex - right.sidebarIndex
    ))
    .map(row => row.item);
}

function isEditableShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function countTranscriptArrivalsSince(baseline, current) {
  if (!baseline || !current || baseline.sessionId !== current.sessionId) return 0;
  const settled = Math.max(0, Number(current.messageCount || 0) - Number(baseline.messageCount || 0));
  const provisionalChanged = !!current.provisionalId && (
    current.provisionalId !== baseline.provisionalId
    || Number(current.provisionalLength || 0) > Number(baseline.provisionalLength || 0)
  );
  return settled + (provisionalChanged && settled === 0 ? 1 : 0);
}

function useStableSidebarGroups(groups, rankOptions, freezeStructure = false) {
  const [ledger, setLedger] = React.useState(() => createSidebarOrderLedger(groups, rankOptions));
  const projection = React.useMemo(() => reconcileSidebarOrderLedger(ledger, groups, {
    ...rankOptions,
    freezeStructure,
  }), [ledger, groups, rankOptions, freezeStructure]);

  React.useEffect(() => {
    if (projection.ledger !== ledger) setLedger(projection.ledger);
  }, [ledger, projection]);

  const sortNow = React.useCallback(() => {
    setLedger(previous => sortSidebarOrderLedger(previous, groups, rankOptions));
  }, [groups, rankOptions]);

  return {
    groups: projection.groups,
    orderChanged: projection.orderChanged,
    sortNow,
    revision: projection.ledger.revision,
  };
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

function formatUsageResetLabel(value) {
  const raw = safeString(value).trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function SessionUsageMiniMonitor({ session, config, providerUsage, onOpenUsage }) {
  const [open, setOpen] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const triggerRef = React.useRef(null);
  const popoverRef = React.useRef(null);
  const normalizedUsage = React.useMemo(() => normalizeProviderUsage(providerUsage), [providerUsage]);
  const projection = React.useMemo(
    () => sessionUsageProjection(session, config, normalizedUsage, nowMs),
    [session, config, normalizedUsage, nowMs],
  );
  const headerRows = projection.headerWindows.map(sessionUsageWindowLabel);

  React.useEffect(() => {
    if (!open) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    const onPointerDown = event => {
      if (triggerRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      close(false);
    };
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => popoverRef.current?.querySelector('button')?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!projection.supported) return null;
  const compactValue = projection.state === 'local'
    ? 'Local'
    : projection.state === 'exhausted'
      ? 'Limit'
      : headerRows[0]?.compactValue || 'Usage ?';
  const creditSummary = formatProviderCredits(projection.credits);
  const financialRows = providerFinancialRows(projection.financials);
  const openInternalUsage = () => {
    setOpen(false);
    onOpenUsage();
  };
  return (
    <div className={`session-usage-mini tone-${projection.tone} state-${projection.state}`} data-testid="session-usage-mini">
      <button
        ref={triggerRef}
        type="button"
        className="session-usage-mini-trigger"
        aria-expanded={open}
        aria-controls="session-usage-popover"
        title={`${projection.billingProviderName}: ${compactValue}`}
        onClick={() => setOpen(value => !value)}
      >
        <ProviderMark providerId={projection.providerMarkId} providerName={projection.billingProviderName} />
        <span className="session-usage-mini-rows">
          {projection.state === 'local' ? (
            <span className="session-usage-mini-row"><strong>Local</strong><em>no plan limit</em></span>
          ) : headerRows.length > 0 ? headerRows.map((row, index) => (
            <span className={`session-usage-mini-row ${row.tone}`} key={`${row.label}:${index}`}>
              <strong>{row.label}</strong><em>{row.compactValue}</em>
              <i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(100, Number(row.usedPercent) || 0))}%` }} /></i>
            </span>
          )) : (
            <span className="session-usage-mini-row unavailable"><strong>Usage</strong><em>{projection.state === 'ambiguous' ? 'ambiguous' : 'unavailable'}</em></span>
          )}
        </span>
        <span className="session-usage-mini-compact">{compactValue}</span>
      </button>
      {open && (
        <div ref={popoverRef} id="session-usage-popover" className="session-usage-popover" role="dialog" aria-modal="false" aria-label="Session usage details">
          <div className="session-usage-popover-heading">
            <ProviderMark providerId={projection.providerMarkId} providerName={projection.billingProviderName} />
            <span><strong>{projection.billingProviderName}</strong><small>{projection.plan || projection.message || 'Usage details'}</small></span>
            <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }} aria-label="Close usage details">×</button>
          </div>
          <dl className="session-usage-popover-meta">
            <div><dt>Billing provider</dt><dd>{projection.billingProviderName}</dd></div>
            <div><dt>Model vendor</dt><dd>{projection.modelVendor}</dd></div>
            <div><dt>Current model</dt><dd>{projection.modelLabel || projection.modelId || 'Not reported'}</dd></div>
            <div><dt>Account</dt><dd>{projection.accountLabel || (projection.state === 'ambiguous' ? 'Ambiguous' : 'Unavailable')}</dd></div>
            <div><dt>Quota domain</dt><dd>{projection.quotaDomain || 'Unavailable'}</dd></div>
            <div><dt>Mapping</dt><dd>{projection.mappingConfidence.replace(/_/g, ' ')}</dd></div>
          </dl>
          {projection.state === 'local' ? (
            <div className="session-usage-popover-state local"><strong>Local · no plan limit</strong><span>{projection.localRuntime?.loadedModelsCount ?? 0} loaded model(s)</span></div>
          ) : projection.applicableWindows.length > 0 ? (
            <div className="session-usage-popover-windows">
              {projection.applicableWindows.map((window, index) => {
                const row = sessionUsageWindowLabel(window);
                return (
                  <div className={`session-usage-popover-window ${row.tone}`} key={`${window.id}:${index}`}>
                    <span><strong>{row.label}</strong><em>{row.usedPercent == null ? 'Usage unavailable' : `${formatProviderPercent(row.usedPercent)} used · ${row.compactValue}`}</em></span>
                    <i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(100, Number(row.usedPercent) || 0))}%` }} /></i>
                    <small>{row.reset ? `Resets ${formatProviderUsageReset(row.reset, nowMs)}` : 'Reset not reported'}{window.modelScope?.label ? ` · ${window.modelScope.label}` : ''}</small>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`session-usage-popover-state ${projection.state}`}><strong>{projection.message}</strong><span>No percentage or $0 value is inferred.</span></div>
          )}
          {(creditSummary || financialRows.length > 0) && (
            <div className="session-usage-popover-financial">
              <strong>Credits / overage</strong>
              {creditSummary && <span>{creditSummary}</span>}
              {financialRows.map(row => <span key={row.id}>{row.label}: {row.value}</span>)}
            </div>
          )}
          <div className="session-usage-popover-source">
            <span>{projection.source || 'Source unavailable'} · {formatProviderUsageAge(projection.capturedAt, nowMs)}</span>
            <span>Generation {projection.generation} · {projection.freshness}</span>
          </div>
          <button type="button" className="session-usage-open-dashboard" onClick={openInternalUsage}>Open Usage &amp; limits</button>
        </div>
      )}
    </div>
  );
}

function sessionHostLabel(session) {
  if (!session || typeof session !== 'object') return '';
  return safeString(session.host_label || (
    session.host_type === 'vscode' ? 'VS Code'
      : session.host_type === 'antigravity_ide' ? 'Antigravity IDE'
        : ''
  ));
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

function NativeActivitySpinner({ agentType, compact = false, animate = true }) {
  const type = String(agentType || 'default').toLowerCase();
  const staticClass = animate ? '' : ' static';
  if (type === 'claude' || type === 'claude_cli') {
    return (
      <span className={`native-activity-spinner claude${compact ? ' compact' : ''}${staticClass}`}>
        {animate ? <ClaudeSpinner /> : <span className="claude-spinner-icon">{SPINNER_SYMBOLS[0]}</span>}
      </span>
    );
  }
  if (type === 'codex' || type === 'codex-desktop' || type === 'codex_cli') {
    return <span className={`native-activity-spinner codex${compact ? ' compact' : ''}${staticClass}`} aria-label="Working">◌</span>;
  }
  if (type === 'cursor') {
    return <span className={`native-activity-spinner cursor${compact ? ' compact' : ''}${staticClass}`} aria-label="Generating"><i /><i /><i /></span>;
  }
  return <span className={`native-activity-spinner generic${compact ? ' compact' : ''}${staticClass}`}><i /></span>;
}

// ─── DeliveryStatus ───────────────────────────────────────────────────────────
// Shows the send lifecycle state for a user message bubble.
//   _optimistic + queued   → pulsing dots (in-flight)
//   _optimistic + accepted → ✓ (relay stored it)
//   launch_accepted        → ↗ (native dispatch started; receipt pending)
//   _optimistic + failed   → ✗ with error label
//   delivered/_delivered   → ✓✓ (exact native user turn observed)
//   agent_started          → ▶ (later native activity observed for that turn)
//   (historical without receipt provenance) → Recorded

function DeliveryStatus({ msg, deliveryStates, onSteer, onRetry }) {
  if (msg._optimistic) {
    const status = deliveryStates[msg._cid] || 'queued';
    if (status === 'offline_queued') return <span className="delivery offline-queued" title="Queued until relay reconnects" aria-label="Queued offline">offline</span>;
    if (status === 'queued')   return <span className="delivery queued" title="Sending…" aria-label="Sending to relay">···</span>;
    if (status === 'busy_queued') return (
      <span className="delivery busy-queued" title="Agent is busy — message queued" aria-label="Queued while agent is busy">
        <span className="queued-label">queued</span>
        {onSteer && <button className="steer-btn" onClick={(e) => { e.stopPropagation(); onSteer(msg._cid, msg.content); }} title="Inject into agent's context now">Steer ▸</button>}
      </span>
    );
    if (status === 'steered') return <span className="delivery steered" title="Injected into agent context" aria-label="Steered into agent context">⤳</span>;
    if (status === 'accepted') return <span className="delivery accepted" title="Received by relay" aria-label="Relay accepted; native receipt pending">✓</span>;
    if (status === 'launch_accepted') return <span className="delivery launch-accepted" title="Native launch accepted; user-turn receipt pending" aria-label="Native launch accepted; user-turn receipt pending">↗</span>;
    if (status === 'delivered') return <span className="delivery delivered" title="Native user turn observed" aria-label="Native user turn delivered">✓✓</span>;
    if (status === 'agent_started') return <span className="delivery agent-started" title="Agent started working" aria-label="Agent started working">▶</span>;
    if (status === 'failed') return (
      <span className="delivery failed" title={msg._sendError || "Failed — agent may be offline"} aria-label={`Send failed: ${msg._sendError || 'agent may be offline'}`}>
        <span aria-hidden="true">✕</span>
        {onRetry && (
          <button type="button" className="delivery-retry" onClick={(event) => { event.stopPropagation(); onRetry(msg); }}>
            Retry
          </button>
        )}
      </span>
    );
  }
  if (msg._agentStarted || msg.status === 'agent_started') return <span className="delivery agent-started" title="Agent started working" aria-label="Agent started working">▶</span>;
  if (msg._delivered || msg.status === 'delivered') return <span className="delivery delivered" title="Native user turn observed" aria-label="Native user turn delivered">✓✓</span>;
  if (msg.status === 'failed') return <span className="delivery failed" title={msg.failure_code || 'Send failed'} aria-label={`Send failed: ${msg.failure_code || 'unknown failure'}`}>✕</span>;
  if (msg._launchAcceptedAt || msg.launch_accepted_at) return <span className="delivery launch-accepted" title="Native launch accepted; user-turn receipt pending" aria-label="Native launch accepted; user-turn receipt pending">↗</span>;
  if (msg.status === 'accepted') return <span className="delivery accepted" title="Received by relay; native receipt pending" aria-label="Relay accepted; native receipt pending">✓</span>;
  return <span className="delivery recorded" title="Recorded — native delivery receipt unknown" aria-label="Recorded; native delivery receipt unknown">Recorded</span>;
}

function useStableWorkingSessions(sessions, freezeStructure = false) {
  const [ledger, setLedger] = React.useState(() => createSidebarWorkingLedger(sessions));
  const projection = React.useMemo(
    () => reconcileSidebarWorkingLedger(ledger, sessions, { freezeStructure }),
    [ledger, sessions, freezeStructure],
  );

  React.useEffect(() => {
    if (projection.ledger !== ledger) setLedger(projection.ledger);
  }, [ledger, projection]);

  return {
    sessions: projection.sessions,
    revision: projection.ledger.revision,
    deferred: projection.deferred,
  };
}

function useSidebarFreshnessClock(activities, sessions) {
  const [nowMs, setNowMs] = React.useState(Date.now());
  React.useEffect(() => {
    const now = Date.now();
    const activityRows = [
      ...Object.values(activities || {}),
      ...(Array.isArray(sessions) ? sessions.map(session => session?.activity) : []),
    ];
    const nextDeadline = activityRows.reduce((next, activity) => {
      const observedAt = fleetActivityObservedAtMs(activity);
      const deadline = observedAt ? observedAt + DEFAULT_ACTIVITY_FRESHNESS_MS : 0;
      if (deadline <= now) return next;
      return next === 0 ? deadline : Math.min(next, deadline);
    }, 0);
    if (!nextDeadline) return undefined;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(25, nextDeadline - now + 25));
    return () => clearTimeout(timer);
  }, [activities, sessions, nowMs]);
  return nowMs;
}

function ProvisionalStreamingBubble({ stream, activeAgent, monospace }) {
  const textRef = useRef(null);
  const renderedContentRef = useRef('');
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    const next = String(stream?.content || '');
    const previous = renderedContentRef.current;
    if (next.startsWith(previous)) {
      const append = next.slice(previous.length);
      if (append) node.appendChild(document.createTextNode(append));
    } else {
      node.textContent = next;
    }
    renderedContentRef.current = next;
  }, [stream?.content]);
  return (
    <div
      className={`message assistant live-draft provisional-stream${monospace ? ' monospace' : ''}`}
      data-message-id={stream?.messageId || 'awaiting-first-delta'}
      data-message-role="assistant"
      data-message-timestamp={parseMessageInstant(stream?.startedAtMs)?.iso || undefined}
      data-stream-open={stream?.open ? 'true' : 'false'}
    >
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
          <span className="message-role-label">{activeAgent.name}</span>
          <MessageTimestamp instant={stream?.startedAtMs} />
        </div>
        <div className="provisional-stream-text" ref={textRef} />
        {stream?.open && <span className="provisional-stream-caret" aria-label="Streaming response" />}
      </div>
    </div>
  );
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
  onRetry,
  richContentEager,
  searchMatch = false,
}) {
  const normalizedContent = normalizeMessageContent(msg.content) || contentBlocksFallback(msg.content_blocks);
  const renderableUserContent = recoverUploadedImageMarkdown(msg.content);
  const instant = messageInstant(msg);
  const hasStructuredBlocks = msg.role !== 'user' && normalizeContentBlocks(msg.content_blocks).length > 0;
  const sourceIdentity = msg.source_message_id || msg.native_source_id || '';
  const contentIdentityHash = messageContentIdentityHash(msg);
  const blockType = topLevelMessageBlockType(msg);
  if (msg.role === 'user') {
    const deliveryStatesForMessage = msg._cid ? { [msg._cid]: deliveryState } : {};
    return (
      <div
        className={`message user transcript-virtual-row${msg._optimistic && deliveryState === 'failed' ? ' failed' : ''}${searchMatch ? ' search-match' : ''}`}
        data-message-key={messageKey}
        data-message-id={msg.id || undefined}
        data-message-role="user"
        data-message-block-type={blockType}
        data-message-content-hash={contentIdentityHash}
        data-message-source-id={sourceIdentity || undefined}
        data-message-timestamp={instant?.iso || 'unknown'}
      >
        <div className="user-gutter">
          <div className="user-glyph" />
        </div>
        <div className="user-content">
          <div className="message-role">
            <span className="message-role-label">You</span>
            <MessageTimestamp message={msg} />
            <DeliveryStatus msg={msg} deliveryStates={deliveryStatesForMessage} onSteer={onSteer} onRetry={onRetry} />
          </div>
          {/!\[[^\]]*\]\((?:data:|\/uploads\/)/.test(renderableUserContent) ? (
            <div className="user-text">
              <MarkdownContent
                content={renderableUserContent}
                deferUntilVisible={!richContentEager}
                cacheIdentity={`${messageKey}:user`}
              />
            </div>
          ) : (
            <div className="user-text">{normalizedContent}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`message assistant transcript-virtual-row${assistantMonospace ? ' monospace' : ''}${searchMatch ? ' search-match' : ''}`}
      data-message-key={messageKey}
      data-message-id={msg.id || undefined}
      data-message-role="assistant"
      data-message-block-type={blockType}
      data-message-content-hash={contentIdentityHash}
      data-message-source-id={sourceIdentity || undefined}
      data-message-timestamp={instant?.iso || 'unknown'}
    >
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
          <span className="message-role-label">{activeAgent.name}</span>
          <MessageTimestamp message={msg} />
        </div>
        {hasStructuredBlocks ? (
          <ContentBlocks
            blocks={msg.content_blocks}
            monospace={assistantMonospace}
            autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
            onOpenPath={(path) => onOpenPath(messageKey, path)}
            agentType={agentType}
            richContentEager={richContentEager}
            richContentCacheIdentity={messageKey}
          />
        ) : (
          <MarkdownContent
            content={normalizeMessageContent(msg.content)}
            monospace={assistantMonospace}
            autoExpandLongCodeBlocks={autoExpandLongCodeBlocks}
            onOpenPath={(path) => onOpenPath(messageKey, path)}
            deferUntilVisible={!richContentEager}
            cacheIdentity={`${messageKey}:assistant`}
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
    && prev.deliveryState === next.deliveryState
    && prev.onRetry === next.onRetry
    && prev.richContentEager === next.richContentEager
    && prev.searchMatch === next.searchMatch;
}

const MemoTranscriptMessage = React.memo(TranscriptMessage, areTranscriptMessagePropsEqual);

const TRANSCRIPT_WINDOW_THRESHOLD = 100;
const TRANSCRIPT_WINDOW_OVERSCAN_PX = 1200;
const TRANSCRIPT_WINDOW_FALLBACK_ROWS = 32;

function estimatedTranscriptRowHeight(message) {
  const content = normalizeMessageContent(message?.content) || contentBlocksFallback(message?.content_blocks);
  const lineCount = Math.max(1, safeString(content).split('\n').length);
  if (message?.role === 'user') return Math.min(180, 40 + Math.max(0, lineCount - 1) * 18);
  const wrappedLines = Math.ceil(safeString(content).length / 100);
  const structuredBonus = normalizeContentBlocks(message?.content_blocks).length * 28;
  return Math.min(420, 68 + Math.max(lineCount, wrappedLines) * 18 + structuredBonus);
}

function transcriptPrefixIndex(prefix, offset) {
  let low = 0;
  let high = Math.max(0, prefix.length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (prefix[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function VirtualTranscriptRow({ index, messageKey, onMeasure, children }) {
  const rowRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const node = rowRef.current;
    if (!node) return undefined;
    const measure = () => onMeasure(index, messageKey, node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [index, messageKey, onMeasure]);
  return <div className="transcript-window-row" data-window-index={index} ref={rowRef}>{children}</div>;
}

function useTranscriptWindow({ messages, containerRef, sessionId, routeActive }) {
  const enabled = routeActive && messages.length > TRANSCRIPT_WINDOW_THRESHOLD;
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  const heightsRef = React.useRef(new Map());
  const heightsSessionRef = React.useRef(sessionId);
  if (heightsSessionRef.current !== sessionId) {
    heightsRef.current.clear();
    heightsSessionRef.current = sessionId;
  }
  const prefixRef = React.useRef([0]);
  const viewportAnchorRef = React.useRef(null);
  const pendingAnchorRestoreRef = React.useRef(null);
  const anchorReleaseTimerRef = React.useRef(0);
  const routeRestoreFrameRef = React.useRef(0);
  const previousWindowRef = React.useRef({ sessionId: null, keys: [], prefix: [0] });
  const measureFrameRef = React.useRef(0);
  const scrollFrameRef = React.useRef(0);
  const pinnedIndexRef = React.useRef(null);
  const pinnedMessageKeyRef = React.useRef(null);
  const pinReleaseTimerRef = React.useRef(0);
  const pendingAnchorDeltaRef = React.useRef(0);
  const [heightRevision, setHeightRevision] = React.useState(0);
  const [range, setRange] = React.useState({ sessionId: null, start: 0, end: 0 });

  const keys = React.useMemo(
    () => messages.map((message, index) => `${sessionId || ''}\u0001${messageIdentityKey(message, index)}`),
    [messages, sessionId],
  );
  const prefix = React.useMemo(() => {
    const next = new Array(messages.length + 1);
    next[0] = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const measured = heightsRef.current.get(keys[index]);
      next[index + 1] = next[index] + (measured || estimatedTranscriptRowHeight(messages[index]));
    }
    return next;
  }, [messages, keys, heightRevision]);
  prefixRef.current = prefix;

  const captureViewportAnchor = React.useCallback(() => {
    if (pendingAnchorRestoreRef.current) return;
    const list = containerRef.current;
    if (!enabled || !list) return;
    const listRect = list.getBoundingClientRect();
    const listTop = listRect.top;
    const rows = Array.from(list.querySelectorAll('.transcript-window-row[data-window-index]'));
    const anchorRow = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= listTop && rect.top < listRect.bottom;
    }) || rows.find(row => row.getBoundingClientRect().bottom > listTop) || rows[0];
    if (!anchorRow) return;
    const index = Number(anchorRow.dataset.windowIndex);
    if (!Number.isInteger(index) || !keys[index]) return;
    viewportAnchorRef.current = {
      sessionId,
      key: keys[index],
      viewportOffset: anchorRow.getBoundingClientRect().top - listTop,
    };
  }, [containerRef, enabled, keys, sessionId]);

  const releasePinnedIndex = React.useCallback(() => {
    pinnedIndexRef.current = null;
    pinnedMessageKeyRef.current = null;
    if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
    pinReleaseTimerRef.current = 0;
  }, []);

  const updateRange = React.useCallback(() => {
    const list = containerRef.current;
    if (!enabled || !list) return;
    const pendingAnchor = pendingAnchorRestoreRef.current;
    if (pendingAnchor?.sessionId === sessionId) {
      const pendingIndex = keys.indexOf(pendingAnchor.key);
      if (pendingIndex >= 0) {
        setRange(previous => (
          previous.sessionId === sessionId
            && previous.start === pendingIndex
            && previous.end === Math.min(messages.length, pendingIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS)
            ? previous
            : {
                sessionId,
                start: pendingIndex,
                end: Math.min(messages.length, pendingIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS),
              }
        ));
        return;
      }
    }
    captureViewportAnchor();
    const activePrefix = prefixRef.current;
    const startOffset = Math.max(0, list.scrollTop - TRANSCRIPT_WINDOW_OVERSCAN_PX);
    const endOffset = list.scrollTop + list.clientHeight + TRANSCRIPT_WINDOW_OVERSCAN_PX;
    const rawStart = Math.max(0, transcriptPrefixIndex(activePrefix, startOffset) - 1);
    const rawEnd = Math.min(messages.length, transcriptPrefixIndex(activePrefix, endOffset) + 2);
    let start = rawEnd >= messages.length
      ? Math.max(0, messages.length - TRANSCRIPT_WINDOW_FALLBACK_ROWS)
      : rawStart;
    let end = rawEnd;
    const pinnedKey = pinnedMessageKeyRef.current;
    const resolvedPinnedIndex = pinnedKey ? keys.indexOf(pinnedKey) : pinnedIndexRef.current;
    if (resolvedPinnedIndex >= 0) pinnedIndexRef.current = resolvedPinnedIndex;
    const pinnedIndex = resolvedPinnedIndex;
    if (Number.isInteger(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < messages.length) {
      start = Math.min(start, Math.max(0, pinnedIndex - TRANSCRIPT_WINDOW_FALLBACK_ROWS));
      end = Math.max(end, Math.min(messages.length, pinnedIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS + 1));
    }
    React.startTransition(() => {
      setRange(previous => (
        previous.sessionId === sessionId && previous.start === start && previous.end === end
          ? previous
          : { sessionId, start, end }
      ));
    });
  }, [captureViewportAnchor, containerRef, enabled, keys, messages.length, sessionId]);

  React.useLayoutEffect(() => {
    const previous = previousWindowRef.current;
    previousWindowRef.current = { sessionId, keys, prefix };
    if (!enabled || previous.sessionId !== sessionId || !previous.keys.length) {
      if (!pendingAnchorRestoreRef.current?.routeRestore) {
        pendingAnchorRestoreRef.current = null;
      }
      if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
      anchorReleaseTimerRef.current = 0;
      captureViewportAnchor();
      return;
    }
    const anchor = viewportAnchorRef.current;
    if (!anchor || anchor.sessionId !== sessionId || !anchor.key) return;
    const previousIndex = previous.keys.indexOf(anchor.key);
    const nextIndex = keys.indexOf(anchor.key);
    if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return;
    const list = containerRef.current;
    if (!list) return;
    const previousOffset = previous.prefix[previousIndex] || 0;
    const nextOffset = prefix[nextIndex] || 0;
    pendingAnchorRestoreRef.current = {
      sessionId,
      key: anchor.key,
      viewportOffset: anchor.viewportOffset,
    };
    pinnedIndexRef.current = nextIndex;
    pinnedMessageKeyRef.current = anchor.key;
    if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
    anchorReleaseTimerRef.current = setTimeout(() => {
      pendingAnchorRestoreRef.current = null;
      anchorReleaseTimerRef.current = 0;
      releasePinnedIndex();
      captureViewportAnchor();
    }, 1500);
    setRange({
      sessionId,
      start: nextIndex,
      end: Math.min(messages.length, nextIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS),
    });
    setScrollTopInstant(list, Math.max(0, list.scrollTop + nextOffset - previousOffset));
  }, [captureViewportAnchor, containerRef, enabled, keys, messages.length, prefix, releasePinnedIndex, sessionId]);

  React.useLayoutEffect(() => {
    const pending = pendingAnchorRestoreRef.current;
    if (!pending || pending.sessionId !== sessionId) return;
    const index = keys.indexOf(pending.key);
    if (index < range.start || index >= range.end) return;
    const list = containerRef.current;
    const row = list?.querySelector(`.transcript-window-row[data-window-index="${index}"]`);
    if (!list || !row) return;
    if (pending.atBottom) {
      setScrollTopInstant(list, list.scrollHeight);
      viewportAnchorRef.current = pending;
      return;
    }
    const currentOffset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const correction = currentOffset - pending.viewportOffset;
    if (Math.abs(correction) >= 0.5) {
      setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
    }
    viewportAnchorRef.current = pending;
  }, [containerRef, enabled, keys, prefix, range, sessionId]);

  React.useLayoutEffect(() => {
    const pending = pendingAnchorRestoreRef.current;
    if (!enabled || !pending?.routeRestore) return;
    let active = true;
    const restoreRouteAnchor = () => {
      if (!active) return;
      const current = pendingAnchorRestoreRef.current;
      const list = containerRef.current;
      if (!current?.routeRestore || current.sessionId !== sessionId || !list) return;
      const index = keys.indexOf(current.key);
      const row = index >= 0
        ? list.querySelector(`.transcript-window-row[data-window-index="${index}"]`)
        : null;
      if (row) {
        if (current.atBottom) {
          setScrollTopInstant(list, list.scrollHeight);
        } else {
          const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
          const correction = offset - current.viewportOffset;
          if (Math.abs(correction) >= 0.5) {
            setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
          }
        }
      }
      routeRestoreFrameRef.current = requestAnimationFrame(restoreRouteAnchor);
    };
    restoreRouteAnchor();
    if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
    anchorReleaseTimerRef.current = setTimeout(() => {
      pendingAnchorRestoreRef.current = null;
      anchorReleaseTimerRef.current = 0;
      if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
      routeRestoreFrameRef.current = 0;
      releasePinnedIndex();
      captureViewportAnchor();
    }, 1500);
    return () => {
      active = false;
      if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
      routeRestoreFrameRef.current = 0;
    };
  }, [captureViewportAnchor, containerRef, enabled, keys, releasePinnedIndex, sessionId]);

  React.useLayoutEffect(() => {
    if (!enabled) {
      releasePinnedIndex();
      return undefined;
    }
    const list = containerRef.current;
    if (!list) return undefined;
    updateRange();
    const onScroll = () => {
      captureViewportAnchor();
      const pinnedKey = pinnedMessageKeyRef.current;
      const resolvedPinnedIndex = pinnedKey ? keys.indexOf(pinnedKey) : pinnedIndexRef.current;
      if (resolvedPinnedIndex >= 0) pinnedIndexRef.current = resolvedPinnedIndex;
      const pinnedIndex = resolvedPinnedIndex;
      const activePrefix = prefixRef.current;
      if (Number.isInteger(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < messages.length) {
        const pinnedStart = activePrefix[pinnedIndex] || 0;
        const pinnedEnd = activePrefix[pinnedIndex + 1] || pinnedStart;
        const viewportStart = list.scrollTop;
        const viewportEnd = viewportStart + list.clientHeight;
        if (pinnedEnd < viewportStart - TRANSCRIPT_WINDOW_OVERSCAN_PX
          || pinnedStart > viewportEnd + TRANSCRIPT_WINDOW_OVERSCAN_PX) {
          releasePinnedIndex();
        }
      }
      if (scrollFrameRef.current) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = 0;
        updateRange();
      });
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      list.removeEventListener('scroll', onScroll);
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
    };
  }, [captureViewportAnchor, enabled, routeActive, sessionId, keys, messages.length, updateRange, releasePinnedIndex]);

  React.useLayoutEffect(() => {
    if (!enabled) return;
    updateRange();
  }, [enabled, prefix, updateRange]);

  const onMeasure = React.useCallback((index, key, rawHeight) => {
    if (!enabledRef.current) return;
    const nextHeight = Math.max(1, Math.ceil(rawHeight));
    const previousHeight = heightsRef.current.get(key) || estimatedTranscriptRowHeight(messages[index]);
    if (Math.abs(nextHeight - previousHeight) < 1) return;
    heightsRef.current.set(key, nextHeight);
    const list = containerRef.current;
    const anchorIndex = list ? transcriptPrefixIndex(prefixRef.current, list.scrollTop) : 0;
    if (index < anchorIndex) pendingAnchorDeltaRef.current += nextHeight - previousHeight;
    if (measureFrameRef.current) return;
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = 0;
      if (!enabledRef.current) {
        pendingAnchorDeltaRef.current = 0;
        return;
      }
      const activeList = containerRef.current;
      const anchorDelta = pendingAnchorDeltaRef.current;
      pendingAnchorDeltaRef.current = 0;
      if (activeList && Math.abs(anchorDelta) >= 1) {
        setScrollTopInstant(activeList, Math.max(0, activeList.scrollTop + anchorDelta));
      }
      setHeightRevision(revision => revision + 1);
    });
  }, [containerRef, messages]);

  React.useLayoutEffect(() => {
    if (enabled || !measureFrameRef.current) return;
    cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = 0;
    pendingAnchorDeltaRef.current = 0;
  }, [enabled]);

  React.useEffect(() => () => {
    if (measureFrameRef.current) cancelAnimationFrame(measureFrameRef.current);
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
    if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
    if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
    if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
  }, []);

  const scrollToIndex = React.useCallback((index, align = 'center') => {
    const list = containerRef.current;
    const activePrefix = prefixRef.current;
    if (!list || index < 0 || index >= messages.length) return false;
    pinnedIndexRef.current = index;
    pinnedMessageKeyRef.current = keys[index] || null;
    if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
    pinReleaseTimerRef.current = setTimeout(() => {
      releasePinnedIndex();
    }, 1500);
    const rowStart = activePrefix[index] || 0;
    const rowEnd = activePrefix[index + 1] || rowStart;
    const target = align === 'start'
      ? rowStart
      : align === 'end'
        ? rowEnd - list.clientHeight
        : rowStart - Math.max(0, (list.clientHeight - (rowEnd - rowStart)) / 2);
    setScrollTopInstant(list, Math.max(0, target));
    const start = Math.max(0, index - TRANSCRIPT_WINDOW_FALLBACK_ROWS);
    const end = Math.min(messages.length, index + TRANSCRIPT_WINDOW_FALLBACK_ROWS + 1);
    setRange({ sessionId, start, end });
    return true;
  }, [containerRef, keys, messages.length, releasePinnedIndex, sessionId]);

  const prepareForPrepend = React.useCallback(() => {
    captureViewportAnchor();
    const anchor = viewportAnchorRef.current;
    if (!anchor || anchor.sessionId !== sessionId) return false;
    const index = keys.indexOf(anchor.key);
    if (index < 0) return false;
    pinnedIndexRef.current = index;
    pinnedMessageKeyRef.current = anchor.key;
    return true;
  }, [captureViewportAnchor, keys, sessionId]);

  const prepareForRouteChange = React.useCallback(() => {
    const list = containerRef.current;
    if (!enabled || !list) return false;
    captureViewportAnchor();
    const anchor = viewportAnchorRef.current;
    if (!anchor || anchor.sessionId !== sessionId || !anchor.key) return false;
    const index = keys.indexOf(anchor.key);
    if (index < 0) return false;
    pendingAnchorRestoreRef.current = {
      ...anchor,
      routeRestore: true,
      atBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 80,
    };
    pinnedIndexRef.current = index;
    pinnedMessageKeyRef.current = anchor.key;
    return true;
  }, [captureViewportAnchor, containerRef, enabled, keys, sessionId]);

  const cancelRouteRestore = React.useCallback(() => {
    if (!pendingAnchorRestoreRef.current?.routeRestore) return false;
    pendingAnchorRestoreRef.current = null;
    if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
    anchorReleaseTimerRef.current = 0;
    if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
    routeRestoreFrameRef.current = 0;
    releasePinnedIndex();
    captureViewportAnchor();
    return true;
  }, [captureViewportAnchor, releasePinnedIndex]);

  let start = 0;
  let end = messages.length;
  if (enabled) {
    if (range.sessionId === sessionId && range.end > range.start) {
      start = range.start;
      end = range.end;
    } else {
      start = Math.max(0, messages.length - TRANSCRIPT_WINDOW_FALLBACK_ROWS);
    }
  }
  return {
    enabled,
    start,
    end,
    totalHeight: prefix[prefix.length - 1] || 0,
    topSpacerHeight: enabled ? prefix[start] || 0 : 0,
    bottomSpacerHeight: enabled ? (prefix[prefix.length - 1] - (prefix[end] || 0)) : 0,
    onMeasure,
    scrollToIndex,
    prepareForPrepend,
    prepareForRouteChange,
    cancelRouteRestore,
  };
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
        <span className="queued-item-text">{qm.content}</span>
        {qm.status && qm.status !== 'queued' && <span className={`queued-item-status ${qm.status}`}>{qm.status}</span>}
        <div className="queued-actions">
          <button className="steer-btn" onClick={onSteer} title="Click Steer in Codex">Steer ▸</button>
          <button className="queued-trash-btn" onClick={onDiscard} title="Delete queued message">🗑</button>
        </div>
      </div>
    );
  }

  return (
    <div className="queued-item">
      <span className="queued-item-text">{qm.content}</span>
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

function SessionCard({ session, health, unread, isThinking, isActive, agentConfig, activity, sessionMessages, hasBlockingPrompt, blockingPromptLabel, muted, pinned, workspaceLabel, recentMessageAt, menuOpen, onMenuToggle, onSelect, onClose, onManage, onPinChange, onAutomations, showAutomationsActive, onSkills, showSkillsActive }) {
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
  const goalSubstate = fleetGoalSubstateLabel(activity, { health });
  const activityLabel = isThinking ? (goalSubstate || activity?.label || 'Working') : null;
  const hostLabel = sessionHostLabel(session);
  const agentContext = workspaceLabel ? `${agent.name} / ${workspaceLabel}` : agent.name;
  const recentMessageInstant = recentMessageAt ? parseMessageInstant(recentMessageAt) : null;

  return (
    <div
      className={`session-card${isActive ? ' active' : ''}${isHardLimited ? ' rate-limited' : ''}${pinned ? ' pinned' : ''}`}
      data-session-id={sessionId}
      data-last-message-at={recentMessageInstant?.iso || undefined}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        onSelect();
      }}
      tabIndex={0}
      aria-label={`${chatTitle}. ${winLabel || agent.name}`}
      title={cardTitle || sessionId}
    >
      <div className="session-card-badge-wrap">
        <div
          className="agent-badge"
          style={{ color: agent.color, borderColor: agent.color + '55', background: agent.color + '18' }}
        >
          {agent.logo
            ? <img src={agent.logo} alt={agent.abbr} className="agent-badge-logo" />
            : agent.abbr}
        </div>
        <div className="session-card-health" style={{ background: dotColor }} title={health || 'unknown'} />
        {muted && <span className="session-card-muted" title="Notifications muted" aria-label="Notifications muted">M</span>}
        {pinned && <button
          type="button"
          className="session-card-pin-toggle"
          title={`Unpin ${chatTitle}`}
          aria-label={`Unpin ${chatTitle}`}
          aria-pressed="true"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onPinChange?.(false);
          }}
        ><span aria-hidden="true">📌</span></button>}
        <span className="session-card-attention-slot">
          {hasBlockingPrompt && <span className="session-card-perm-badge" title={blockingPromptLabel || 'Action required'}>⚠</span>}
          {!hasBlockingPrompt && isHardLimited && <span className="session-card-perm-badge" title="Usage limited">⏳</span>}
          {!hasBlockingPrompt && !isHardLimited && isThinking && <span className="session-card-native-status" title={activityLabel || 'Thinking…'}><NativeActivitySpinner agentType={session?.agent_type} compact animate={false} /></span>}
          {!isThinking && !hasBlockingPrompt && !isHardLimited && unread > 0 && (
            <span className="session-card-badge">{unread > 99 ? '99+' : unread}</span>
          )}
        </span>
      </div>
      <div className="session-card-body">
        <FullTitleDisclosure
          title={chatTitle}
          disclosureKey={sessionId}
          kind="session"
          wrapperClassName="session-title-details"
          triggerClassName="session-card-name"
          disclosureClassName="session-title-disclosure"
          triggerLabel={`Show full title: ${chatTitle}`}
          triggerTag="div"
        />
        <div className={`session-card-sub${hasBlockingPrompt ? ' perm-active' : ''}${recentMessageInstant ? ' has-recent-message' : ''}`}>
          <span className="session-card-sub-context">
            {hasBlockingPrompt ? `${agentContext} · ${blockingPromptLabel || 'Action required'}`
              : isHardLimited ? `${agentContext} · ⏳ Usage limited${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · resets ${formatUsageResetLabel(rateLimitedUntil)}` : ' · reset unknown'}`
              : quotaSummary ? `${agentContext} · ${quotaSummary}`
              : isAntigravitySession && pctUsed != null ? `${agentContext} · 📊 ${pctUsed}% used${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · ${rateLimitedUntil}` : ''}`
              : pctUsed >= 75 ? `${agentContext} · 📊 ${pctUsed}% used${rateLimitedUntil && rateLimitedUntil !== 'unknown' ? ` · resets ${formatUsageResetLabel(rateLimitedUntil)}` : ''}`
              : activityLabel ? `${agentContext} · ${activityLabel}`
              : hostLabel ? `${agentContext} · ${hostLabel}`
              : agentContext}
          </span>
          {recentMessageInstant && <><span aria-hidden="true">{' \u00b7 '}</span><time dateTime={recentMessageInstant.iso}>{formatVisibleMessageTime(recentMessageInstant)}</time></>}
        </div>
      </div>
      <div className="session-card-right">
        <details
          className="session-card-menu"
          open={menuOpen}
          onToggle={event => onMenuToggle?.(event.currentTarget.open)}
          onClick={event => event.stopPropagation()}
        >
          <summary className="session-card-manage" title="Session actions" aria-label={`Session actions for ${chatTitle}`}>⋯</summary>
          <div className="session-card-menu-popover" role="menu" aria-label={`Actions for ${chatTitle}`}>
            <button role="menuitem" onClick={() => onPinChange?.(!pinned)}>{pinned ? 'Unpin chat' : 'Pin chat'}</button>
            <button role="menuitem" onClick={() => onManage && onManage()}>Manage session</button>
            {onAutomations && <button role="menuitem" className={showAutomationsActive ? 'active' : ''} onClick={() => onAutomations()}>Automations</button>}
            {onSkills && <button role="menuitem" className={showSkillsActive ? 'active' : ''} onClick={() => onSkills()}>Skills</button>}
            <button role="menuitem" className="danger" onClick={() => onClose && onClose()}>Close session</button>
          </div>
        </details>
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
    activity.goal_run?.lifecycle || '',
    activity.goal_run?.lease_active === true ? 'leased' : 'released',
    activity.goal_run?.transition_id || '',
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
    && prev.muted === next.muted
    && prev.pinned === next.pinned
    && prev.workspaceLabel === next.workspaceLabel
    && prev.recentMessageAt === next.recentMessageAt
    && prev.menuOpen === next.menuOpen
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
  const [reducedMotion, setReducedMotion] = React.useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = event => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  React.useEffect(() => {
    if (reducedMotion) {
      setFrame(0);
      return undefined;
    }
    let remaining = SPINNER_SYMBOLS.length * 3;
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(id);
        setFrame(0);
        return;
      }
      setFrame(f => (f + 1) % SPINNER_SYMBOLS.length);
    }, 120);
    return () => clearInterval(id);
  }, [reducedMotion]);
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
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${String(hours % 24).padStart(2, '0')}h ${String(remMinutes).padStart(2, '0')}m${includeSeconds ? ` ${String(seconds).padStart(2, '0')}s` : ''}`;
  }
  return `${hours}h ${String(remMinutes).padStart(2, '0')}m${includeSeconds ? ` ${String(seconds).padStart(2, '0')}s` : ''}`;
}

function formatGoalElapsed(goal, nowMs, goalRun = null) {
  if (!goal) return '';
  return formatClockDuration(fleetGoalElapsedSeconds(goal, goalRun, nowMs), { includeSeconds: true });
}

function ActivityRow({ activity, thinkingText, agentType, pinned = false }) {
  const kind = activity?.kind || 'working';
  const meta = ACTIVITY_META[kind] || ACTIVITY_META.working;
  const goal = activity?.goal || null;
  const isActive = meta.tone === 'thinking' || meta.tone === 'info';
  const goalActive = (goal?.state || goal?.status) === 'active';
  const goalTimerActive = goalActive && (!activity?.goal_run || activity.goal_run.lease_active === true);
  const hasCanonicalChannels = !!(activity?.thinking || activity?.current);
  const legacyText = String(thinkingText || activity?.thinkingContent || '').trim();
  const isClaude = agentType === 'claude' || agentType === 'claude_cli';
  const thinking = activity?.thinking || (!hasCanonicalChannels && (kind === 'thinking' || isClaude)
    ? { text: legacyText, since: activity?.startedAt || activity?.updatedAt || null }
    : null);
  const current = activity?.current || (!hasCanonicalChannels && !thinking && isActive
    ? {
        kind: kind === 'running_command' ? 'tool' : 'answer',
        label: activity?.label || (kind === 'running_command' ? 'Running command' : 'Working'),
        partial: legacyText,
        since: activity?.startedAt || activity?.updatedAt || null,
      }
    : null);
  const step = activity?.step || null;
  const usage = activity?.usage || null;
  const [nowMs, setNowMs] = React.useState(Date.now());
  const thinkingTimerSource = thinking ? (thinking.since || activity?.startedAt || activity?.updatedAt) : null;
  const currentTimerSource = current ? (current.since || activity?.startedAt || activity?.updatedAt) : null;
  const hasTimestamp = value => Boolean(value) && Number.isFinite(new Date(value).getTime());
  const hasLiveTimerSource = (goalTimerActive && hasTimestamp(goal?.updated_at))
    || hasTimestamp(thinkingTimerSource)
    || hasTimestamp(currentTimerSource);
  React.useEffect(() => {
    if (!hasLiveTimerSource) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasLiveTimerSource, goal?.updated_at, thinkingTimerSource, currentTimerSource]);
  const hint = activity?.interruptHint || activity?.interrupt_hint || '';
  const goalElapsed = goal ? formatGoalElapsed(goal, nowMs, activity?.goal_run) : '';
  const goalText = String(goal?.text || goal?.objective || '').trim();
  const thinkingElapsed = thinking ? formatActivityElapsed(thinkingTimerSource, nowMs) : '';
  const currentElapsed = current ? formatActivityElapsed(currentTimerSource, nowMs) : '';
  if (!goal && !thinking && !current && !step && !usage) return null;

  return (
    <div className={`live-status-stack${pinned ? ' pinned' : ''}`} data-testid="live-status-stack">
      {current && (
        <div className={`live-current-status ${current.kind || 'answer'}`} data-live-channel="current">
          <div className="live-current-tool-heading">
            {current.kind === 'tool'
              ? <span className="live-status-icon">▶</span>
              : <NativeActivitySpinner agentType={agentType} compact />}
            <span className="live-status-label">{current.label || (current.kind === 'tool' ? 'Running tool' : 'Working')}</span>
            <span className="live-status-meta">{[currentElapsed, hint].filter(Boolean).join(' · ')}</span>
          </div>
          {current.partial && (
            current.kind === 'tool'
              ? <pre className="live-current-output">{current.partial}</pre>
              : <p className="live-current-narration">{current.partial}</p>
          )}
        </div>
      )}
      {thinking && (
        <div className="live-thinking-row" data-live-channel="thinking">
          <div className="live-thinking-heading">
            <NativeActivitySpinner agentType={agentType} />
            <span className="live-status-label">{thinking.label || activity?.label || 'Thinking'}</span>
            {thinkingElapsed && <span className="live-status-meta">{thinkingElapsed}</span>}
          </div>
          {thinking.text && <div className="live-thinking-text">{thinking.text}</div>}
        </div>
      )}
      {step && (
        <div className="live-step-wrap" data-live-channel="step">
          <div className="live-step-chip" title={step.text || ''}>
            {step.state === 'in_progress' ? <NativeActivitySpinner agentType={agentType} compact /> : <span>◌</span>}
            <span>Step {step.current || 1} / {step.total || 1}</span>
            {(step.added != null || step.deleted != null) && (
              <span className="live-step-diff">· +{step.added || 0} −{step.deleted || 0}</span>
            )}
          </div>
        </div>
      )}
      {goal && (
        <details className="live-goal-row" data-live-channel="goal">
          <summary title={goalText}>
            <span className="live-status-icon">⛳</span>
            <span className="live-status-label">{goal.label || 'Pursuing goal'}</span>
            <span className="live-goal-objective">{goalText || 'Active goal'}</span>
            <span className="live-status-meta">{goalElapsed || goal.state || goal.status || 'active'}</span>
          </summary>
          {goalText && <div className="live-goal-expanded">{goalText}</div>}
        </details>
      )}
      {usage && (
        <div className="live-usage-banner" data-live-channel="usage" role="status">
          <div className="live-usage-title">{usage.title || 'Usage limit reached'}</div>
          <div className="live-usage-detail">{usage.detail || (usage.resets_at ? `Your rate limit resets at ${usage.resets_at}.` : 'Usage is currently exhausted.')}</div>
        </div>
      )}
    </div>
  );
}

function TaskList({ taskList, sessionId }) {
  const planBlock = taskList?.content_blocks?.find(block => block?.type === 'plan');
  const typedTaskList = planBlock ? { ...taskList, ...planBlock } : taskList;
  if (!typedTaskList || !typedTaskList.tasks || typedTaskList.tasks.length === 0) return null;
  const storageKey = sessionId ? `remote-agent-chat:task-list-collapsed:${sessionId}` : null;
  const defaultCollapsed = false;
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
  const activeTask = typedTaskList.tasks.find(t => t.state === 'in_progress');
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
        <span className="codex-task-count">{typedTaskList.completed}/{typedTaskList.total} tasks</span>
        {collapsed && activeTask?.text && (
          <span className="codex-task-active-summary">{activeTask.text}</span>
        )}
      </button>
      {!collapsed && (
        <div className="codex-task-items">
          {typedTaskList.tasks.map((t, i) => (
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

function typedPromptBlock(prompt, acceptedTypes) {
  const accepted = new Set(Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes]);
  return (Array.isArray(prompt?.content_blocks) ? prompt.content_blocks : [])
    .find(block => accepted.has(block?.type)) || null;
}

function promptBody(prompt) {
  return typedPromptBlock(prompt, 'prompt')?.content
    || prompt?.prompt_text || prompt?.message || prompt?.text || 'Agent requires permission to continue.';
}

function formatPromptCountdown(msLeft) {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function questionDeadlineCopy(prompt, msLeft) {
  if (!prompt?.deadline_at) return '';
  if (msLeft <= 0) return 'Native deadline elapsed · awaiting receipt';
  const prefix = prompt.auto_resolution_policy === 'native'
    ? 'Native auto-resolution in' : 'Response deadline in';
  return `${prefix} ${formatPromptCountdown(msLeft)}`;
}

function PermissionOverlay({ prompt, sessionId, agentType, onRespond, onDismissFocus }) {
  const [now, setNow] = React.useState(Date.now());
  const [questionSelections, setQuestionSelections] = React.useState({});
  const [questionOtherText, setQuestionOtherText] = React.useState({});
  const [questionTextAnswers, setQuestionTextAnswers] = React.useState({});
  const [alternateInstruction, setAlternateInstruction] = React.useState('');
  const [keyboardChoiceId, setKeyboardChoiceId] = React.useState(null);
  const [keyboardDismissed, setKeyboardDismissed] = React.useState(false);

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    setQuestionSelections({});
    setQuestionOtherText({});
    setQuestionTextAnswers({});
    setAlternateInstruction('');
    setKeyboardChoiceId(null);
    setKeyboardDismissed(false);
  }, [prompt?.prompt_id]);

  const timeoutMs = Math.max(0, Number(prompt?.timeout_ms) || 0);
  const receivedAt = Number(prompt?.received_at) || Date.now();
  const deadlineAt = Date.parse(prompt?.deadline_at || '');
  const hasQuestionDeadline = prompt?.type === 'question_prompt' && Number.isFinite(deadlineAt);
  const msLeft = hasQuestionDeadline
    ? Math.max(0, deadlineAt - now)
    : (timeoutMs > 0 ? Math.max(0, timeoutMs - (now - receivedAt)) : 0);
  const choices = Array.isArray(prompt?.choices) ? prompt.choices : [];
  const submittingChoiceId = prompt?.submitting_choice_id || null;
  const firstClassQuestionLocked = prompt?.type === 'question_prompt' && prompt?.lifecycle !== 'open';
  const defaultChoiceId = prompt?.default_choice || null;
  const questions = (prompt?.kind === 'question' || prompt?.type === 'question_prompt') && Array.isArray(prompt?.questions)
    ? prompt.questions.filter(question => question && typeof question === 'object')
    : [];
  const structuredQuestion = questions.length > 0;
  const claudeActionPrompt = agentType === 'claude' && !structuredQuestion;
  const claudeCommand = safeString(prompt?.command).trim();
  const claudeTitle = safeString(prompt?.title).trim()
    || (!claudeCommand ? promptBody(prompt) : 'Allow this action?');
  const claudeDescription = safeString(prompt?.description).trim();
  const alternateInstructionSupported = claudeActionPrompt && prompt?.alternate_instruction_supported === true;
  const structuredKeyboardChoices = questions.flatMap(question => (
    (Array.isArray(question.choices) ? question.choices : []).map((choice, index) => ({
      question,
      choiceId: promptChoiceId(choice, index),
    }))
  )).slice(0, 9);

  const toggleQuestionChoice = (question, choiceId) => {
    setQuestionSelections(prev => {
      const current = Array.isArray(prev[question.question_id]) ? prev[question.question_id] : [];
      const next = question.multi_select
        ? (current.includes(choiceId) ? current.filter(id => id !== choiceId) : [...current, choiceId])
        : [choiceId];
      return { ...prev, [question.question_id]: next };
    });
  };

  const questionReady = questions.every(question => {
    const questionChoices = Array.isArray(question.choices) ? question.choices : [];
    if (question.answer_mode === 'text' || questionChoices.length === 0) {
      return question.required === false || safeString(questionTextAnswers[question.question_id]).trim().length > 0;
    }
    const selected = questionSelections[question.question_id] || [];
    if (selected.length === 0) return false;
    return selected.every(choiceId => {
      const choice = questionChoices.find((item, index) => promptChoiceId(item, index) === choiceId);
      return !choice?.requires_text || safeString(questionOtherText[`${question.question_id}:${choiceId}`]).trim();
    });
  });

  const submitQuestionAnswers = () => {
    if (!questionReady || submittingChoiceId || firstClassQuestionLocked) return;
    const answers = questions.map(question => {
      const questionChoices = Array.isArray(question.choices) ? question.choices : [];
      if (question.answer_mode === 'text' || questionChoices.length === 0) {
        return {
          question_id: question.question_id,
          text: safeString(questionTextAnswers[question.question_id]).trim(),
        };
      }
      const choiceIds = questionSelections[question.question_id] || [];
      const otherChoice = questionChoices.find((choice, index) => (
        choice.requires_text && choiceIds.includes(promptChoiceId(choice, index))
      ));
      const otherChoiceIndex = otherChoice ? questionChoices.indexOf(otherChoice) : -1;
      const otherChoiceId = otherChoice ? promptChoiceId(otherChoice, otherChoiceIndex) : null;
      return {
        question_id: question.question_id,
        choice_ids: choiceIds,
        ...(otherChoiceId ? { other_text: safeString(questionOtherText[`${question.question_id}:${otherChoiceId}`]).trim() } : {}),
      };
    });
    onRespond(sessionId, prompt.prompt_id, null, { answers });
  };

  React.useEffect(() => {
    const handlePromptKey = event => {
      const promptShortcutTarget = event.target?.closest?.('.permission-card');
      const composerTarget = event.target?.matches?.('.input-area textarea');
      const neutralPromptShortcutTarget = event.target === document.body || event.target === document.documentElement;
      if (!promptShortcutTarget && !composerTarget && !neutralPromptShortcutTarget) return;
      if (firstClassQuestionLocked && event.key !== 'Escape') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (structuredQuestion && prompt?.type === 'question_prompt'
          && prompt?.cancel_supported === true && !submittingChoiceId && !firstClassQuestionLocked) {
          onRespond(sessionId, prompt.prompt_id, null, { action: 'cancel' });
          return;
        }
        const claudeCancelChoice = claudeActionPrompt
          ? choices.find((choice, index) => /^(?:reject|deny|cancel|block|not now|no)\b/i.test(
            promptChoiceLabel(choice, index).replace(/^\d+\s+/, ''),
          ))
          : null;
        if (claudeCancelChoice && !submittingChoiceId) {
          onRespond(sessionId, prompt.prompt_id, promptChoiceId(claudeCancelChoice, choices.indexOf(claudeCancelChoice)));
          return;
        }
        setKeyboardDismissed(true);
        onDismissFocus?.();
        return;
      }
      if (keyboardDismissed) return;
      const editableTarget = isEditableShortcutTarget(event.target);
      const otherTextSubmit = event.key === 'Enter' && event.target?.closest?.('.permission-other-input');
      const alternateInstructionSubmit = event.key === 'Enter'
        && !event.shiftKey
        && event.target?.closest?.('.permission-alternate-input');
      if (alternateInstructionSubmit) {
        event.preventDefault();
        const instruction = alternateInstruction.trim();
        if (instruction && !submittingChoiceId) {
          onRespond(sessionId, prompt.prompt_id, null, { instruction });
        }
        return;
      }
      if (submittingChoiceId || (editableTarget && !otherTextSubmit && !composerTarget)) return;
      if (/^[1-9]$/.test(event.key)) {
        const optionIndex = Number(event.key) - 1;
        event.preventDefault();
        if (structuredQuestion) {
          const option = structuredKeyboardChoices[optionIndex];
          if (option) toggleQuestionChoice(option.question, option.choiceId);
        } else {
          const choice = choices[optionIndex];
          if (choice) setKeyboardChoiceId(promptChoiceId(choice, optionIndex));
        }
        return;
      }
      if (event.key !== 'Enter') return;
      if (structuredQuestion) {
        if (questionReady) {
          event.preventDefault();
          submitQuestionAnswers();
        }
        return;
      }
      const selectedChoiceId = keyboardChoiceId || defaultChoiceId;
      if (selectedChoiceId && choices.some((choice, index) => promptChoiceId(choice, index) === selectedChoiceId)) {
        event.preventDefault();
        onRespond(sessionId, prompt.prompt_id, selectedChoiceId);
      }
    };
    window.addEventListener('keydown', handlePromptKey);
    return () => window.removeEventListener('keydown', handlePromptKey);
  }, [
    alternateInstruction,
    choices,
    claudeActionPrompt,
    defaultChoiceId,
    firstClassQuestionLocked,
    keyboardDismissed,
    keyboardChoiceId,
    onDismissFocus,
    onRespond,
    prompt?.prompt_id,
    questionReady,
    questionSelections,
    questionOtherText,
    questionTextAnswers,
    sessionId,
    structuredKeyboardChoices,
    structuredQuestion,
    submittingChoiceId,
  ]);

  return (
    <div className="permission-overlay">
      <div
        className={`permission-card${claudeActionPrompt ? ' permission-card-claude' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label={claudeActionPrompt ? 'Claude Code permission prompt' : 'Permission or question prompt'}
        onPointerDown={() => setKeyboardDismissed(false)}
      >
        {claudeActionPrompt ? (
          <>
            <div className="permission-title permission-title-claude">{claudeTitle}</div>
            {claudeCommand && <pre className="permission-command-claude">{claudeCommand}</pre>}
            {claudeDescription && <div className="permission-body permission-body-claude">{claudeDescription}</div>}
          </>
        ) : (
          <>
            <div className="permission-eyebrow">{structuredQuestion ? 'Question' : 'Permission Required'}</div>
            <div className="permission-title">
              {structuredQuestion
                ? safeString(prompt?.title, 'Answer the native question')
                : `Agent Paused In ${sessionId ? sessionSubLabel(sessionId, sessionId) : 'Active Session'}`}
            </div>
            {!structuredQuestion && <div className="permission-body">{promptBody(prompt)}</div>}
            <div className="permission-meta">
              {hasQuestionDeadline && <span className="permission-timer">{questionDeadlineCopy(prompt, msLeft)}</span>}
              {!hasQuestionDeadline && timeoutMs > 0 && <span className="permission-timer">Auto-choice in {formatPromptCountdown(msLeft)}</span>}
              {defaultChoiceId && <span className="permission-default">Default: {defaultChoiceId}</span>}
            </div>
          </>
        )}
        {prompt?.error && <div className="permission-error">{prompt.error}</div>}
        <div className={`permission-actions${structuredQuestion ? ' permission-question-list' : ''}`}>
          {structuredQuestion ? questions.map((question, questionIndex) => (
            <fieldset className="permission-question" key={question.question_id || questionIndex}>
              <legend>{safeString(question.header || question.label, `Question ${questionIndex + 1}`)}</legend>
              {safeString(question.message).trim() && <div className="permission-question-message">{safeString(question.message)}</div>}
              <div className="permission-question-options">
                {(question.answer_mode === 'text' || !Array.isArray(question.choices) || question.choices.length === 0) ? (
                  <input
                    className="permission-question-text-input"
                    type={question.secret === true ? 'password' : 'text'}
                    value={questionTextAnswers[question.question_id] || ''}
                    maxLength={2000}
                    disabled={!!submittingChoiceId || firstClassQuestionLocked}
                    autoComplete="off"
                    spellCheck={question.secret === true ? 'false' : undefined}
                    placeholder={question.secret === true ? 'Enter private answer' : 'Enter answer'}
                    aria-label={`${safeString(question.header || question.label, `Question ${questionIndex + 1}`)} answer`}
                    onChange={event => setQuestionTextAnswers(prev => ({ ...prev, [question.question_id]: event.target.value }))}
                  />
                ) : question.choices.map((choice, index) => {
                  const choiceId = promptChoiceId(choice, index);
                  const selected = (questionSelections[question.question_id] || []).includes(choiceId);
                  const otherKey = `${question.question_id}:${choiceId}`;
                  return (
                    <div className="permission-question-option" key={choiceId}>
                      <button
                        type="button"
                        className={`permission-action${selected ? ' selected' : ''}`}
                        role={question.multi_select ? 'checkbox' : 'radio'}
                        aria-checked={selected}
                        disabled={!!submittingChoiceId || firstClassQuestionLocked}
                        aria-keyshortcuts={structuredKeyboardChoices.findIndex(option => option.question === question && option.choiceId === choiceId) >= 0
                          ? String(structuredKeyboardChoices.findIndex(option => option.question === question && option.choiceId === choiceId) + 1)
                          : undefined}
                        onClick={() => toggleQuestionChoice(question, choiceId)}
                      >
                        {structuredKeyboardChoices.findIndex(option => option.question === question && option.choiceId === choiceId) >= 0 && (
                          <kbd className="permission-key-hint">{structuredKeyboardChoices.findIndex(option => option.question === question && option.choiceId === choiceId) + 1}</kbd>
                        )}
                        <span className="permission-choice-marker" aria-hidden="true">{question.multi_select ? (selected ? '✓' : '□') : (selected ? '●' : '○')}</span>
                        <span className="permission-choice-copy">
                          <span>{promptChoiceLabel(choice, index)}</span>
                          {safeString(choice?.description).trim() && <span className="permission-action-desc">{safeString(choice.description)}</span>}
                        </span>
                      </button>
                      {selected && choice.requires_text && (
                        <input
                          className="permission-other-input"
                          type={question.secret === true ? 'password' : 'text'}
                          value={questionOtherText[otherKey] || ''}
                          maxLength={2000}
                          disabled={!!submittingChoiceId || firstClassQuestionLocked}
                          autoComplete="off"
                          spellCheck={question.secret === true ? 'false' : undefined}
                          placeholder="Enter another answer"
                          aria-label={`${promptChoiceLabel(choice, index)} answer`}
                          onChange={event => setQuestionOtherText(prev => ({ ...prev, [otherKey]: event.target.value }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )) : choices.map((choice, index) => {
            const choiceId = promptChoiceId(choice, index);
            const isPending = submittingChoiceId === choiceId;
            const isDefault = defaultChoiceId && defaultChoiceId === choiceId;
            const isSelected = keyboardChoiceId === choiceId;
            const isNativeSelected = claudeActionPrompt && !keyboardChoiceId && !defaultChoiceId && index === 0;
            const displayLabel = claudeActionPrompt
              ? promptChoiceLabel(choice, index).replace(new RegExp(`^${index + 1}\\s+`), '')
              : promptChoiceLabel(choice, index);
            const destination = claudeActionPrompt ? safeString(choice?.destination).trim() : '';
            const labelPrefix = destination && displayLabel.endsWith(destination)
              ? displayLabel.slice(0, -destination.length)
              : displayLabel;
            return (
              <button
                key={choiceId}
                className={`permission-action${isDefault ? ' default' : ''}${isSelected || isNativeSelected ? ' selected' : ''}${isPending ? ' pending' : ''}`}
                disabled={!!submittingChoiceId}
                aria-pressed={isSelected || isNativeSelected}
                aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
                onClick={() => onRespond(sessionId, prompt.prompt_id, choiceId)}
              >
                {index < 9 && <kbd className="permission-key-hint">{safeString(choice?.shortcut, String(index + 1))}</kbd>}
                <span>
                  {labelPrefix}
                  {destination && <span className="permission-choice-destination-claude">{destination}</span>}
                </span>
                {safeString(choice?.description).trim() && (
                  <span className="permission-action-desc">{safeString(choice.description)}</span>
                )}
                {isPending && <span className="permission-action-state">Sending...</span>}
              </button>
            );
          })}
        </div>
        {alternateInstructionSupported && (
          <textarea
            className="permission-alternate-input"
            rows="1"
            maxLength={2000}
            value={alternateInstruction}
            disabled={!!submittingChoiceId}
            placeholder={safeString(prompt?.alternate_instruction_placeholder, 'Tell Claude what to do instead')}
            aria-label="Tell Claude what to do instead"
            onChange={event => setAlternateInstruction(event.target.value)}
          />
        )}
        {structuredQuestion && (
          <div className="permission-question-footer">
            <button
              type="button"
              className="permission-question-submit"
              disabled={!questionReady || !!submittingChoiceId || firstClassQuestionLocked}
              onClick={submitQuestionAnswers}
            >
              {submittingChoiceId ? 'Sending...' : safeString(prompt.submit_label, 'Submit answers')}
            </button>
            {prompt?.type === 'question_prompt' && prompt?.cancel_supported === true && (
              <button
                type="button"
                className="permission-question-cancel"
                disabled={!!submittingChoiceId || firstClassQuestionLocked}
                onClick={() => onRespond(sessionId, prompt.prompt_id, null, { action: 'cancel' })}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        <div className="permission-keyboard-help">
          {claudeActionPrompt
            ? safeString(prompt?.cancel_hint, 'Esc to cancel')
            : `1–9 select · Enter submit · Esc ${prompt?.cancel_supported === true ? 'cancel' : 'return to composer'}`}
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
  const block = typedPromptBlock(prompt, ['error', 'notice']);
  const actions = Array.isArray(prompt?.actions) ? prompt.actions : (block?.actions || []);
  const submittingActionId = prompt?.submitting_action_id || null;
  const errorOutput = safeString(prompt?.error_output || block?.error_output).trim();

  return (
    <div className="permission-overlay">
      <div className="permission-card error-prompt-card">
        <div className="permission-eyebrow error-prompt-eyebrow">Action Required</div>
        <div className="permission-title">{safeString(block?.label || prompt?.title, 'Error handling model response')}</div>
        <div className="permission-body">{safeString(block?.content || prompt?.message, 'There was an error handling the model response.')}</div>
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
                onClick={event => onRespond(sessionId, prompt.prompt_id, actionId, event)}
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
  const block = typedPromptBlock(prompt, ['error', 'notice']);
  const actions = Array.isArray(prompt?.actions) ? prompt.actions : (block?.actions || []);
  const submittingActionId = prompt?.submitting_action_id || null;
  const errorOutput = safeString(prompt?.error_output || block?.error_output).trim();

  return (
    <div className="inline-error-prompt">
      <div className="inline-error-prompt-body">
        <div className="inline-error-prompt-title">{safeString(block?.label || prompt?.title, 'Codex requires attention')}</div>
        <div className="inline-error-prompt-message">{safeString(block?.content || prompt?.message, 'There was an error handling the model response.')}</div>
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
              onClick={event => onRespond(sessionId, prompt.prompt_id, actionId, event)}
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

function NewSessionPanel({ launchStates, onLaunch, onResume, onClose, workspaces, showTestSessions = false }) {
  const [mode,        setMode]        = React.useState('new');   // 'new' | 'resume'
  const [agentType,   setAgentType]   = React.useState('claude');
  const [wsMode,      setWsMode]      = React.useState('');
  const [customPath,  setCustomPath]  = React.useState('');
  const [claudeCliModel, setClaudeCliModel] = React.useState('deepseek-v4-pro:cloud');
  const [codexCliModel, setCodexCliModel] = React.useState('gpt-5.5');
  const [cursorCliModel, setCursorCliModel] = React.useState('grok-4.5-fast-high');
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
    if (mode === 'resume' && !historyLoading) {
      setHistoryLoading(true);
      fetch(`/api/sessions/history?limit=30&include_test=${showTestSessions ? 'true' : 'false'}`, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => setHistory(data.sessions || []))
        .catch(() => setHistory([]))
        .finally(() => setHistoryLoading(false));
    }
  }, [mode, showTestSessions]);

  function handleSubmit(e) {
    e.preventDefault();
    if (isLaunching) return;
    const wsPath = wsMode === 'custom' ? customPath.trim() : wsMode;
    const launchOptions = agentType === 'claude_cli'
      ? { model_id: claudeCliModel.trim() || 'default' }
      : agentType === 'codex_cli'
      ? { model_id: codexCliModel.trim() || 'gpt-5.5', permission_mode: 'workspace-write', effort: 'medium' }
      : agentType === 'cursor_cli'
      ? { model_id: cursorCliModel.trim() || 'grok-4.5-fast-high', permission_mode: 'force' }
      : {};
    const rid = onLaunch(agentType, wsPath || undefined, launchOptions);
    setRequestId(rid);
  }

  function handleResume(session) {
    if (isLaunching) return;
    // Prefer the history row's agent type so Resume doesn't launch the wrong product.
    const resumeAgentType = session.agent_type || agentType;
    const wsPath = session.workspace_path
      || (wsMode === 'custom' ? customPath.trim() : wsMode)
      || undefined;
    const rid = onResume(session.session_id, resumeAgentType, wsPath, {
      cli_session_id: session.cli_session_id || undefined,
      model_id: session.model_id || undefined,
      permission_mode: session.permission_mode || undefined,
    });
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
          {agentType === 'cursor_cli' && (
            <select
              className="new-session-workspace"
              value={cursorCliModel}
              onChange={e => setCursorCliModel(e.target.value)}
              disabled={isLaunching}
            >
              {KNOWN_CURSOR_CLI_MODELS.map(model => (
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
              {history
                .filter(s => !agentType || !s.agent_type || s.agent_type === agentType)
                .map(s => (
                <button
                  key={s.session_id}
                  className="session-history-item"
                  onClick={() => handleResume(s)}
                  disabled={isLaunching}
                >
                  <div className="session-history-preview">{s.preview || '(empty session)'}</div>
                  <div className="session-history-meta">
                    <span>{s.message_count} msg{s.message_count !== 1 ? 's' : ''}</span>
                    {s.agent_type && <span className="session-history-workspace">{AGENT_CONFIG[s.agent_type]?.name || s.agent_type}</span>}
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
    { value: 'default',           label: 'Ask before edit' },
    { value: 'acceptEdits',       label: 'Edit automatically' },
    { value: 'plan',              label: 'Plan mode' },
    { value: 'auto',              label: 'Auto mode' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
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
  cursor_cli: [
    { value: 'default', label: 'Default' },
    { value: 'force',   label: 'Force (Yolo)' },
    { value: 'plan',    label: 'Plan' },
    { value: 'ask',     label: 'Ask' },
  ],
  codex:  [],  // Codex permission mode not configurable via settings
  gemini: [],  // Gemini permission mode not configurable via settings
};

function defaultPermissionModeFor(agentType) {
  if (agentType === 'codex_cli') return 'workspace-write';
  if (agentType === 'cursor_cli') return 'force';
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
  { id: 'gpt-5.6',                     label: 'GPT-5.6' },
  { id: 'gpt-5.6-sol',                 label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra',               label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna',                label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5',                     label: 'GPT-5.5' },
  { id: 'gpt-5.4',                     label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini',                label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex-spark',         label: 'GPT-5.3 Codex Spark' },
  { id: 'gpt-5.3-codex',               label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',               label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2',                     label: 'GPT-5.2' },
  { id: 'gpt-5.1-codex',               label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1',                     label: 'GPT-5.1' },
  { id: 'gpt-5',                       label: 'GPT-5' },
  { id: 'ollama:deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)' },
  { id: 'ollama:kimi-k2.6:cloud',       label: 'Kimi K2.6 (Ollama Cloud)' },
];

const KNOWN_CURSOR_CLI_MODELS = [
  { id: 'grok-4.5-fast-high',          label: 'Grok 4.5 Fast (High)' },
  { id: 'grok-4.5-fast-xhigh',         label: 'Grok 4.5 Fast (XHigh)' },
  { id: 'claude-fable-5-thinking-high', label: 'Claude Fable 5 (Thinking High)' },
  { id: 'claude-opus-4-8-thinking-high',label: 'Claude Opus 4.8 (Thinking High)' },
  { id: 'composer-2.5',                 label: 'Composer 2.5' },
  { id: 'composer-2.5-fast',            label: 'Composer 2.5 Fast' },
  { id: 'gpt-5.5-high',                 label: 'GPT-5.5 (High)' },
  { id: 'gpt-5.3-codex',                label: 'GPT-5.3 Codex' },
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
  if (agentType === 'cursor_cli') return KNOWN_CURSOR_CLI_MODELS;
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

function applicationServerKeyBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
  permission_required: true,
  agent_ready: true,
  turn_ready: false,
  goal_completed: false,
  goal_attention: true,
  provider_usage_warning: true,
  agent_error: true,
  session_offline: true,
  rate_limit_cleared: true,
  completion_sound: false,
  completion_haptic: false,
});

// Delivery policy is unknown until the authenticated relay has answered. Keep
// every category disabled during startup so connection history cannot race a
// persisted opt-out (or a per-session mute) and surface a stale notification.
const NOTIFICATION_PREFERENCE_PENDING = Object.freeze(
  Object.fromEntries(Object.keys(NOTIFICATION_PREFERENCE_DEFAULTS).map(key => [key, false])),
);

let attentionAudioContext = null;
let lastAttentionSoundAt = 0;

function primeAttentionAudio() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  attentionAudioContext ||= new AudioContextClass();
  if (attentionAudioContext.state === 'suspended') {
    attentionAudioContext.resume().catch(() => {});
  }
  return attentionAudioContext;
}

function playAttentionSound(kind = 'completion') {
  const wallNow = Date.now();
  if (wallNow - lastAttentionSoundAt < 600) return false;
  const context = primeAttentionAudio();
  if (!context || context.state !== 'running') return false;
  lastAttentionSoundAt = wallNow;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(kind === 'prompt' ? 740 : 620, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === 'prompt' ? 880 : 760, now + 0.11);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.15);
  return true;
}

function attentionEventIsUnfocused(sessionId, activeSessionId) {
  if (sessionId !== activeSessionId) return true;
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

function NotificationSettingsPanel({ onClose, onPreferencesChange }) {
  const defaults = NOTIFICATION_PREFERENCE_DEFAULTS;
  const [preferences, setPreferences] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const [webPushStatus, setWebPushStatus] = useState('checking');
  const [webPushBusy, setWebPushBusy] = useState(false);

  async function loadPreferences() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/preferences/notifications', { credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load notification settings.');
      const next = { ...defaults, ...(body.preferences || {}), turn_ready: false };
      setPreferences(next);
      onPreferencesChange?.(next);
    } catch (err) {
      setError(err.message || 'Unable to load notification settings.');
    } finally {
      setLoading(false);
    }
  }

  async function loadWebPushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setWebPushStatus('unsupported');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setWebPushStatus(subscription ? 'enabled' : Notification.permission === 'denied' ? 'denied' : 'available');
    } catch {
      setWebPushStatus('error');
    }
  }

  useEffect(() => {
    loadPreferences();
    loadWebPushState();
  }, []);

  async function enableWebPush() {
    if (webPushBusy) return;
    setWebPushBusy(true);
    setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setWebPushStatus(permission === 'denied' ? 'denied' : 'available');
        return;
      }
      const configResponse = await fetch('/api/push/web-config', { credentials: 'same-origin' });
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !config.public_key) throw new Error(config.error || 'Web Push is unavailable.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyBytes(config.public_key),
        });
      }
      const response = await fetch('/api/push/web-subscription', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to register browser notifications.');
      setWebPushStatus('enabled');
    } catch (err) {
      setWebPushStatus('error');
      setError(err.message || 'Unable to enable browser notifications.');
    } finally {
      setWebPushBusy(false);
    }
  }

  async function disableWebPush() {
    if (webPushBusy) return;
    setWebPushBusy(true);
    setError('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/web-subscription', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setWebPushStatus('available');
    } catch (err) {
      setWebPushStatus('error');
      setError(err.message || 'Unable to disable browser notifications.');
    } finally {
      setWebPushBusy(false);
    }
  }

  async function togglePreference(key) {
    if (saving || key === 'turn_ready') return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    if (key === 'completion_sound' && next.completion_sound) primeAttentionAudio();
    setPreferences(next);
    setSaving(key);
    setError('');
    try {
      const response = await fetch('/api/preferences/notifications', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to save notification settings.');
      const saved = { ...defaults, ...(body.preferences || {}) };
      setPreferences(saved);
      onPreferencesChange?.(saved);
    } catch (err) {
      setPreferences(previous);
      setError(err.message || 'Unable to save notification settings.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="settings-panel notification-settings-panel">
      <div className="settings-panel-header">
        <span>Notifications</span>
        <button className="settings-panel-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="settings-panel-body">
        <div className="notification-setting-row web-push-setting-row">
          <span>
            <strong>Browser notifications</strong>
            <small>{webPushStatus === 'enabled' ? 'Enabled for this browser'
              : webPushStatus === 'denied' ? 'Blocked in browser site settings'
                : webPushStatus === 'unsupported' ? 'Not supported by this browser'
                  : webPushStatus === 'checking' ? 'Checking browser support…'
                    : 'Receive notifications when this PWA is closed'}</small>
          </span>
          {webPushStatus === 'enabled' ? (
            <button type="button" disabled={webPushBusy} onClick={disableWebPush}>Disable</button>
          ) : (
            <button
              type="button"
              disabled={webPushBusy || webPushStatus === 'checking' || webPushStatus === 'unsupported' || webPushStatus === 'denied'}
              onClick={enableWebPush}
            >{webPushBusy ? 'Enabling…' : 'Enable'}</button>
          )}
        </div>
        <label className="notification-setting-row">
          <span><strong>Permission required</strong><small>When an agent needs approval to continue</small></span>
          <input
            type="checkbox"
            checked={preferences.permission_required}
            disabled={loading || !!saving}
            onChange={() => togglePreference('permission_required')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Turn finished</strong><small>Unavailable until this harness supplies an authoritative native turn boundary</small></span>
          <input
            type="checkbox"
            checked={false}
            disabled
            onChange={() => togglePreference('turn_ready')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Goal completed</strong><small>Only when the native goal reaches its terminal completed state</small></span>
          <input
            type="checkbox"
            checked={preferences.goal_completed}
            disabled={loading || !!saving}
            onChange={() => togglePreference('goal_completed')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Goal needs attention</strong><small>Paused, blocked, limited, cancelled, or failed goals</small></span>
          <input
            type="checkbox"
            checked={preferences.goal_attention}
            disabled={loading || !!saving}
            onChange={() => togglePreference('goal_attention')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Provider usage warning</strong><small>At 75%, 90%, and exhaustion for each provider account window</small></span>
          <input
            type="checkbox"
            checked={preferences.provider_usage_warning}
            disabled={loading || !!saving}
            onChange={() => togglePreference('provider_usage_warning')}
          />
        </label>
        <div className="settings-note">Active /goal loop checkpoints stay quiet between turns.</div>
        <label className="notification-setting-row">
          <span><strong>Agent error or rate limit</strong><small>When an agent stops and needs attention</small></span>
          <input
            type="checkbox"
            checked={preferences.agent_error}
            disabled={loading || !!saving}
            onChange={() => togglePreference('agent_error')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Session offline</strong><small>When an agent disconnects from the relay</small></span>
          <input
            type="checkbox"
            checked={preferences.session_offline}
            disabled={loading || !!saving}
            onChange={() => togglePreference('session_offline')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Rate limit cleared</strong><small>When a model's rate limit expires</small></span>
          <input
            type="checkbox"
            checked={preferences.rate_limit_cleared}
            disabled={loading || !!saving}
            onChange={() => togglePreference('rate_limit_cleared')}
          />
        </label>
        <label className="notification-setting-row">
          <span><strong>Notification sound</strong><small>Subtle cue for allowed prompts and explicit goal lifecycle events</small></span>
          <input
            type="checkbox"
            checked={preferences.completion_sound}
            disabled={loading || !!saving}
            onChange={() => togglePreference('completion_sound')}
          />
        </label>
        {loading && <div className="settings-note">Loading relay preferences…</div>}
        {!!error && (
          <div className="notification-settings-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={loadPreferences}>Retry</button>
          </div>
        )}
        <div className="settings-note">These preferences sync across web and Android.</div>
      </div>
    </div>
  );
}

function SessionManagementPanel({ sessions, preferences, initialSessionId, onSave, onExport, onClose }) {
  const firstId = initialSessionId || sessionIdOf(sessions[0]) || '';
  const [selectedId, setSelectedId] = useState(firstId);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const selected = sessions.find(session => sessionIdOf(session) === selectedId) || null;
  const preference = preferences[selectedId] || { display_name: '', archived: false, muted: false, pinned: false, pin_order: 0 };

  useEffect(() => {
    setDisplayName(preference.display_name || '');
    setError('');
  }, [selectedId, preference.display_name]);
  useEffect(() => {
    if (initialSessionId) setSelectedId(initialSessionId);
  }, [initialSessionId]);

  async function update(updates) {
    if (!selectedId || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(selectedId, updates);
    } catch (err) {
      setError(err.message || 'Unable to save session settings.');
    } finally {
      setSaving(false);
    }
  }

  async function downloadExport(format) {
    if (!selectedId || exporting) return;
    setExporting(format);
    setError('');
    try {
      await onExport(selectedId, format);
    } catch (err) {
      setError(err.message || 'Unable to export session.');
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="settings-panel session-management-panel">
      <div className="settings-panel-header">
        <span>Manage sessions</span>
        <button className="settings-panel-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="settings-panel-body">
        {sessions.length === 0 ? <div className="settings-note">No sessions available.</div> : <>
          <label className="settings-row session-management-field">
            <span className="settings-label">Session</span>
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
              {sessions.map(session => {
                const id = sessionIdOf(session);
                const pref = preferences[id] || {};
                const label = pref.display_name || session?.display_name || session?.workspace_name || session?.name || id;
                return <option key={id} value={id}>{pref.archived ? '[Hidden] ' : ''}{label}</option>;
              })}
            </select>
          </label>
          {selected && <>
            <label className="settings-row session-management-field">
              <span className="settings-label">Custom name</span>
              <input
                value={displayName}
                maxLength={100}
                placeholder={selected?.display_name || selected?.workspace_name || selected?.name || selectedId}
                onChange={event => setDisplayName(event.target.value)}
              />
            </label>
            <label className="notification-setting-row">
              <span><strong>Pin chat</strong><small>Keep this chat in the operator-ordered pinned section</small></span>
              <input
                type="checkbox"
                checked={!!preference.pinned}
                disabled={saving}
                onChange={() => update({ pinned: !preference.pinned })}
              />
            </label>
            <label className="notification-setting-row">
              <span><strong>Mute notifications</strong><small>Suppress push notifications for this session</small></span>
              <input
                type="checkbox"
                checked={!!preference.muted}
                disabled={saving}
                onChange={() => update({ muted: !preference.muted })}
              />
            </label>
            <div className="session-management-actions">
              <button disabled={saving} onClick={() => update({ display_name: displayName })}>Save name</button>
              <button
                className={preference.archived ? '' : 'danger'}
                disabled={saving}
                onClick={() => update({ archived: !preference.archived })}
              >{preference.archived ? 'Restore to sidebar' : 'Hide from sidebar'}</button>
            </div>
            <div className="session-management-actions session-export-actions" aria-label="Export session">
              <button disabled={!!exporting} onClick={() => downloadExport('markdown')}>{exporting === 'markdown' ? 'Preparing…' : 'Download Markdown'}</button>
              <button disabled={!!exporting} onClick={() => downloadExport('json')}>{exporting === 'json' ? 'Preparing…' : 'Download JSON'}</button>
            </div>
          </>}
        </>}
        {!!error && <div className="settings-error" role="alert">{error}</div>}
        <div className="settings-note">Names, pinned order, hidden state, and mute settings sync across web and Android.</div>
      </div>
    </div>
  );
}

function ScheduledSendPanel({ sessionId, initialContent, jobs, onSchedule, onCancel, onCreated, onClose }) {
  const [content, setContent] = useState(initialContent || '');
  const [triggerKind, setTriggerKind] = useState('idle');
  const [deliverAt, setDeliverAt] = useState(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function createJob(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      await onSchedule(sessionId, content, triggerKind, triggerKind === 'at' ? new Date(deliverAt).toISOString() : null);
      onCreated?.();
      setContent('');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function cancelJob(id) {
    try { await onCancel(id); } catch (err) { setError(err.message); }
  }
  return <div className="settings-panel scheduled-send-panel" data-testid="scheduled-send-panel">
    <div className="settings-panel-header"><span>Schedule message</span><button className="settings-panel-close" onClick={onClose} title="Close">×</button></div>
    <form className="settings-panel-body" onSubmit={createJob}>
      <label className="settings-row session-management-field"><span className="settings-label">Message</span><textarea value={content} maxLength={524288} onChange={event => setContent(event.target.value)} /></label>
      <label className="settings-row session-management-field"><span className="settings-label">Deliver</span><select value={triggerKind} onChange={event => setTriggerKind(event.target.value)}><option value="idle">When session is next idle</option><option value="at">At a specific time</option></select></label>
      {triggerKind === 'at' && <label className="settings-row session-management-field"><span className="settings-label">Local time</span><input type="datetime-local" value={deliverAt} onChange={event => setDeliverAt(event.target.value)} /></label>}
      <div className="session-management-actions"><button type="submit" disabled={saving || !content.trim()}>{saving ? 'Scheduling…' : 'Schedule'}</button></div>
      {!!error && <div className="settings-error" role="alert">{error}</div>}
      {!!jobs.length && <div className="scheduled-send-list"><strong>Pending</strong>{jobs.map(job => <div className="scheduled-send-row" key={job.id}><span>{job.trigger_kind === 'idle' ? 'Next idle' : new Date(job.deliver_at).toLocaleString()} · {job.content}</span><button type="button" onClick={() => cancelJob(job.id)} disabled={job.state !== 'pending'}>{job.state === 'dispatching' ? 'Sending…' : 'Cancel'}</button></div>)}</div>}
    </form>
  </div>;
}

function AgentSettingsPanel({ session, config, configControlStates, onRequestRefresh, onSetModel, onSetEffort, onSetPermissionMode, onSetAutoApprovePermissions, onSetMode, onSetCodexConfig, onSwitchWorkspace, onClose }) {
  const [showBypassConfirmation, setShowBypassConfirmation] = React.useState(false);
  const [localBypassRestoreProfile, setLocalBypassRestoreProfile] = React.useState(null);
  const sessionId    = sessionIdOf(session);
  const controlFor = field => configControlStates?.[`${sessionId}:${field}`] || null;
  const isPendingControl = control => control && (control.status === 'pending' || control.status === 'awaiting_config');
  const modelControl = controlFor('model');
  const permissionControl = controlFor('permission_mode');
  const effortControl = controlFor('effort');
  const autoApproveControl = controlFor('auto_approve_permissions');
  const modeControl = controlFor('mode');
  const speedControl = controlFor('speed');
  const accessControl = controlFor('access_mode');
  const permissionProfileControl = controlFor('permission_profile');
  const workspaceControl = controlFor('workspace');
  const activeControl = [modelControl, permissionControl, effortControl, autoApproveControl, modeControl, speedControl, accessControl, permissionProfileControl, workspaceControl]
    .find(control => isPendingControl(control) || control?.status === 'failed');
  const controlStatusLabel = activeControl
    ? isPendingControl(activeControl)
      ? `Saving ${activeControl.field.replace(/_/g, ' ')}…`
      : activeControl.error
    : null;
  const agentType    = (session && typeof session === 'object') ? session.agent_type : null;
  const caps         = config?.capabilities || {};
  const splitObservedConfig = agentType === 'codex_cli' && config?.config_semantics === 'observed_and_next_send';
  const isVsCodeCodex = agentType === 'codex';
  const codexControlsAvailable = !isVsCodeCodex || config?.controls_available !== false;
  const currentModel   = config?.model_id || 'unknown';
  const nextSendModel = config?.next_send_model_id || '';
  const rateLimitedUntil = (session && typeof session === 'object') ? session.rate_limited_until || null : null;
  const antigravityQuotaModels = Array.isArray(session?.antigravity_quota_models) ? session.antigravity_quota_models : [];
  const activeQuotaModel = session?.active_quota_model || null;
  const permMode       = config?.permission_mode || 'unknown';
  const convMode       = config?.conversation_mode || 'unknown';
  const currentMode    = (config?.mode && config.mode !== 'unknown') ? config.mode : convMode;
  const autoApproveEnabled = typeof config?.auto_approve_permissions === 'boolean'
    ? config.auto_approve_permissions
    : !!session?.auto_approve_permissions;
  const codexLiveOwner = agentType === 'codex_cli' ? session?.codex_live_owner : null;
  const codexLiveOwnerLabel = !codexLiveOwner
    ? 'Ownership status unavailable'
    : codexLiveOwner.state === 'confirmed'
      ? ({
          interactive_tui: 'Interactive terminal active',
          proxy_app_server: 'Headless RAC app-server turn active',
          rotator_exec: 'Headless rotator worker active',
        }[codexLiveOwner.owner_kind] || 'Live owner active')
      : codexLiveOwner.state === 'multiple'
        ? 'Needs attention: multiple owners'
        : codexLiveOwner.state === 'stale'
          ? 'Needs attention: stale owner proof'
          : codexLiveOwner.state === 'unavailable'
            ? 'Ownership startup is not ready'
            : 'No live owner';
  const codexLiveOwnerDetail = codexLiveOwner
    ? [
        codexLiveOwner.thread_id ? `thread ${codexLiveOwner.thread_id}` : null,
        codexLiveOwner.turn_id ? `turn ${codexLiveOwner.turn_id}` : null,
        codexLiveOwner.root_pid ? `PID ${codexLiveOwner.root_pid}` : null,
        codexLiveOwner.reason || null,
      ].filter(Boolean).join(' · ')
    : '';
  const effortLevel    = config?.effort || null;
  const nextSendEffort = config?.next_send_effort || '';
  const fileScope    = config?.file_access_scope || 'unknown';
  const permModes    = permissionModeOptionsFor(agentType, config);
  const modeOptions  = modeOptionsFor(agentType, config);
  let modelOptions = (agentType === 'claude' || agentType === 'claude_cli') ? KNOWN_CLAUDE_MODELS
    : agentType === 'codex_cli' ? KNOWN_CODEX_CLI_MODELS
    : agentType === 'cursor_cli' ? KNOWN_CURSOR_CLI_MODELS
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
    if (!modelId || modelId === (splitObservedConfig ? nextSendModel : currentModel)) return;
    onSetModel(sessionId, modelId);
  }

  function handlePermModeChange(mode) {
    if (!mode || mode === permMode) return;
    onSetPermissionMode(sessionId, mode);
  }

  function handleEffortChange(effort) {
    if (!effort || effort === (splitObservedConfig ? nextSendEffort : effortLevel)) return;
    onSetEffort && onSetEffort(sessionId, effort);
  }

  function handleModeChange(mode) {
    if (!mode || mode === currentMode) return;
    onSetMode && onSetMode(sessionId, mode);
  }

  function handleAutoApproveChange(enabled) {
    if (autoApproveEnabled === !!enabled) return;
    onSetAutoApprovePermissions && onSetAutoApprovePermissions(sessionId, !!enabled);
  }

  function handleCodexPermissionProfile(permissionProfile, confirmBypass = false) {
    if (!permissionProfile || permissionProfile === config?.permission_profile) return;
    if (permissionProfile === 'full-access' && !confirmBypass) {
      setShowBypassConfirmation(true);
      return;
    }
    if (permissionProfile === 'full-access') {
      setLocalBypassRestoreProfile(
        config?.permission_profile && config.permission_profile !== 'full-access'
          ? config.permission_profile
          : 'auto',
      );
    }
    setShowBypassConfirmation(false);
    onSetCodexConfig?.({
      permission_profile: permissionProfile,
      ...(confirmBypass ? { confirm_bypass: true } : {}),
    });
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <span>Session Settings</span>
        <button className="settings-panel-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="settings-panel-body">

        {agentType === 'codex_cli' && (
          <div className="settings-row" data-testid="codex-live-owner-status">
            <span className="settings-label">Live owner</span>
            <span
              className={`settings-value${['multiple', 'stale', 'unavailable'].includes(codexLiveOwner?.state) ? ' error' : ''}`}
              title={codexLiveOwnerDetail}
            >{codexLiveOwnerLabel}</span>
          </div>
        )}
        {agentType === 'codex_cli' && (
          <div className="settings-row" data-testid="codex-headless-send-mode">
            <span className="settings-label">Remote sends</span>
            <span className="settings-value" title={config?.send_execution_detail}>
              {config?.send_execution_label || 'Headless / out-of-process'}
            </span>
            <span className="settings-value small">Interactive TUI may stay idle</span>
          </div>
        )}

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
          <span className="settings-label">{splitObservedConfig ? 'Observed model' : 'Model'}</span>
          <div className="settings-model-wrap">
            {splitObservedConfig ? (
              <span className={`settings-value${currentModel === 'unknown' ? ' dim' : ''}`} title={config?.model_provenance?.source || 'No exact native metadata observed'}>
                {currentModel}
              </span>
            ) : caps.set_model && modelOptions.length > 0 ? (
              <select
                className="settings-perm-select"
                value={currentModel}
                disabled={isPendingControl(modelControl)}
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
          {modelControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
        </div>

        {splitObservedConfig && caps.set_model && modelOptions.length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Next send model</span>
            <select
              className="settings-perm-select"
              value={nextSendModel}
              disabled={isPendingControl(modelControl)}
              onChange={e => handleModelChange(e.target.value)}
            >
              <option value="" disabled>Choose model…</option>
              {modelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className={`settings-value small${config?.next_send_model_status === 'failed' ? ' error' : ''}`}>
              {config?.next_send_model_status || 'unset'}
            </span>
          </div>
        )}

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
              disabled={isPendingControl(modeControl)}
              onChange={e => handleModeChange(e.target.value)}
            >
              {ANTIGRAVITY_MODES.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {modeControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
          </div>
        )}

        {/* Permission mode — Claude and Continue YOLO, Codex handled separately below */}
        {isClineLikeAgentType(agentType) && caps.set_mode && modeOptions.length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Mode</span>
            <select
              className="settings-perm-select"
              value={currentMode === 'unknown' ? modeOptions[0].id : currentMode}
              disabled={isPendingControl(modeControl)}
              onChange={e => handleModeChange(e.target.value)}
            >
              {modeOptions.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {currentMode !== 'unknown' && !modeOptions.some(m => m.id === currentMode) && (
                <option value={currentMode}>{currentMode}</option>
              )}
            </select>
            {modeControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
          </div>
        )}

        {(agentType === 'claude' || agentType === 'claude_cli' || agentType === 'codex_cli' || agentType === 'cursor_cli' || agentType === 'continue_yolo' || isClineLikeAgentType(agentType)) && (
          <div className="settings-row">
            <span className="settings-label">Permission mode</span>
            {caps.permission_mode_change && permModes.length > 0 ? (
              <select
                className="settings-perm-select"
                value={permMode === 'unknown' ? defaultPermissionModeFor(agentType) : permMode}
                disabled={isPendingControl(permissionControl)}
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
            {permissionControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
          </div>
        )}

        {agentType === 'codex_cli' && config?.approval_policy && (
          <div className="settings-row">
            <span className="settings-label">Approval policy</span>
            <span className="settings-value">{config.approval_policy}</span>
          </div>
        )}

        {agentType === 'claude' && effortLevel && effortLevel !== 'unknown' && (
          <div className="settings-row">
            <span className="settings-label">Effort</span>
            <span className="settings-value">
              {((config?.available_efforts || []).find(m => m.id === effortLevel) || {}).label || effortLevel}
            </span>
          </div>
        )}

        {(agentType === 'claude_cli' || agentType === 'codex_cli' || agentType === 'cursor_cli') && caps.set_effort && (config?.available_efforts || []).length > 0 && (
          <div className="settings-row">
            <span className="settings-label">{splitObservedConfig ? 'Observed effort' : 'Effort'}</span>
            {splitObservedConfig ? (
              <span className={`settings-value${!effortLevel || effortLevel === 'unknown' ? ' dim' : ''}`} title={config?.effort_provenance?.source || 'No exact native metadata observed'}>
                {effortLevel || 'unknown'}
              </span>
            ) : (
              <select
                className="settings-perm-select"
                value={effortLevel || 'medium'}
                disabled={isPendingControl(effortControl)}
                onChange={e => handleEffortChange(e.target.value)}
              >
                {(config.available_efforts || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            )}
            {effortControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
          </div>
        )}

        {splitObservedConfig && caps.set_effort && (config?.available_efforts || []).length > 0 && (
          <div className="settings-row">
            <span className="settings-label">Next send effort</span>
            <select
              className="settings-perm-select"
              value={nextSendEffort}
              disabled={isPendingControl(effortControl)}
              onChange={e => handleEffortChange(e.target.value)}
            >
              <option value="" disabled>Choose effort…</option>
              {(config.available_efforts || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className={`settings-value small${config?.next_send_effort_status === 'failed' ? ' error' : ''}`}>
              {config?.next_send_effort_status && config.next_send_effort_status !== 'unset'
                ? config.next_send_effort_status
                : 'No override selected'}
            </span>
          </div>
        )}

        {/* Codex-specific controls. VS Code is native next-turn/thread scope;
            Desktop retains its separate restart-scoped contract. */}
        {(agentType === 'codex' || agentType === 'codex-desktop') && caps.set_codex_config && (
          <>
            {caps.codex_model_change && (config?.available_models || []).length > 0 && <div className="settings-row">
              <span className="settings-label">{isVsCodeCodex ? 'Next turn model' : 'Model'}</span>
              <select
                className="settings-perm-select"
                value={config?.model_id || 'unknown'}
                disabled={isPendingControl(modelControl) || !codexControlsAvailable}
                onChange={e => { onSetCodexConfig?.({ model_id: e.target.value }); }}
              >
                {(config?.available_models || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {config?.model_id && !(config?.available_models || []).some(m => m.id === config.model_id) && config.model_id !== 'unknown' && (
                  <option value={config.model_id}>{config.model_id}</option>
                )}
              </select>
              {modelControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
            </div>}
            {caps.codex_effort_change && (config?.available_efforts || []).length > 0 && <div className="settings-row">
              <span className="settings-label">{isVsCodeCodex ? 'Next turn effort' : 'Effort'}</span>
              <select
                className="settings-perm-select"
                value={(config?.effort || 'unknown').toLowerCase()}
                disabled={isPendingControl(effortControl) || !codexControlsAvailable}
                onChange={e => { onSetCodexConfig?.({ effort: e.target.value }); }}
              >
                {(config?.available_efforts || []).map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {effortControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
            </div>}
            {caps.codex_permission_profile_change && (config?.available_permission_profiles || []).length > 0 && <div className="settings-row">
              <span className="settings-label">Next turn permissions</span>
              <select
                className="settings-perm-select"
                value={config?.permission_profile || 'unknown'}
                disabled={isPendingControl(permissionProfileControl) || !codexControlsAvailable}
                onChange={e => handleCodexPermissionProfile(e.target.value)}
              >
                {(config?.available_permission_profiles || []).map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
              {permissionProfileControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
            </div>}
            {showBypassConfirmation && <div className="settings-bypass-confirmation" role="alert">
              <strong>Enable Bypass permissions?</strong>
              <span>Full access sets approval policy to Never and sandbox access to danger-full-access for this Codex conversation.</span>
              <div className="settings-bypass-actions">
                <button type="button" onClick={() => setShowBypassConfirmation(false)}>Cancel</button>
                <button type="button" className="danger" onClick={() => handleCodexPermissionProfile('full-access', true)}>Enable Full access</button>
              </div>
            </div>}
            {isVsCodeCodex && config?.bypass_permissions_active && (localBypassRestoreProfile || config?.bypass_restore_profile) && <div className="settings-row">
              <span className="settings-label">Bypass permissions</span>
              <button
                type="button"
                className="settings-restore-safe"
                disabled={isPendingControl(permissionProfileControl)}
                onClick={() => handleCodexPermissionProfile(localBypassRestoreProfile || config.bypass_restore_profile)}
              >Restore previous safe permissions</button>
            </div>}
            {isVsCodeCodex && <>
              <div className="settings-row">
                <span className="settings-label">Approval policy</span>
                <span className="settings-value">{config?.approval_policy || 'Native custom policy'}</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">Access / sandbox</span>
                <span className="settings-value">{config?.permission_mode || 'Native custom access'}</span>
              </div>
              {!codexControlsAvailable && <div className="settings-control-unavailable" role="status">
                {config?.controls_unavailable_reason || 'Codex controls are unavailable for this conversation.'}
              </div>}
            </>}
            {caps.codex_access_change && (config?.available_access || []).length > 0 && <div className="settings-row">
              <span className="settings-label">Access</span>
              <select
                className="settings-perm-select"
                value={config?.permission_mode || 'unknown'}
                disabled={isPendingControl(accessControl)}
                onChange={e => { onSetCodexConfig?.({ access_mode: e.target.value }); }}
              >
                {(config?.available_access || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>}
            {caps.codex_speed_change && (config?.available_speeds || []).length > 0 && <div className="settings-row">
              <span className="settings-label">Speed</span>
              <select
                className="settings-perm-select"
                value={(config?.speed || 'standard').toLowerCase()}
                disabled={isPendingControl(speedControl)}
                onChange={e => { onSetCodexConfig?.({ speed: e.target.value }); }}
              >
                {(config?.available_speeds || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>}
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
                  disabled={isPendingControl(workspaceControl)}
                  onChange={e => { if (onSwitchWorkspace) onSwitchWorkspace(sessionId, e.target.value); }}
                >
                  {(config.available_workspaces || []).map(m => (
                    <option key={m.id} value={m.path || m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {controlStatusLabel && <div className="settings-row"><span className={activeControl?.status === 'failed' ? 'settings-error' : 'settings-inline-ok'} role="status">{controlStatusLabel}</span></div>}
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
                disabled={isPendingControl(autoApproveControl)}
                onChange={e => handleAutoApproveChange(e.target.checked)}
              />
              <span>Auto-approve permission prompts</span>
            </label>
            {autoApproveControl?.status === 'ok' && <span className="settings-inline-ok">Saved</span>}
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

        {controlStatusLabel && !(agentType === 'codex' || agentType === 'codex-desktop') && (
          <div className={activeControl?.status === 'failed' ? 'settings-error' : 'settings-inline-ok'} role="status">
            {controlStatusLabel}
          </div>
        )}

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
              key={thread.cache_key || thread.id || i}
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
              key={thread.cache_key || thread.id || i}
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
function TerminalViewer({ entries, canRead, canInput, onClose, onRefresh, onSend, controlResults }) {
  const [command, setCommand] = useState('');
  const [requestId, setRequestId] = useState(null);
  const controlResult = requestId ? controlResults?.[requestId] : null;

  function submitCommand(event) {
    event.preventDefault();
    const text = command.trim();
    if (!text || !onSend) return;
    setRequestId(onSend(text));
    setCommand('');
  }

  return (
    <div className="terminal-viewer">
      <div className="terminal-viewer-header">
        <span className="terminal-viewer-title">Terminal</span>
        {canRead && <button className="terminal-viewer-refresh" onClick={onRefresh} title="Refresh">↻</button>}
        <button className="terminal-viewer-close" onClick={onClose} title="Close">✕</button>
      </div>
      {canRead ? (
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
      ) : (
        <div className="terminal-viewer-empty">Terminal output is unavailable for this harness.</div>
      )}
      {canInput && (
        <form className="terminal-input-form" onSubmit={submitCommand}>
          <input
            className="terminal-input"
            type="text"
            value={command}
            onChange={event => setCommand(event.target.value)}
            placeholder="Enter a command in this session's terminal"
            aria-label="Terminal command"
          />
          <button className="terminal-input-send" type="submit" disabled={!command.trim()}>Run</button>
          {requestId && (
            <div className={`terminal-input-status ${controlResult?.result || 'pending'}`} role="status">
              {!controlResult
                ? 'Command pending…'
                : controlResult.result === 'ok'
                  ? 'Command sent'
                  : `Command failed: ${controlResult.error?.message || controlResult.error?.code || 'unknown error'}`}
            </div>
          )}
        </form>
      )}
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

function formatUsageTokens(value) {
  return new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, Number(value) || 0));
}

function UsageCostPanel({ cost, detailState, onRequestDetail }) {
  const [days, setDays] = React.useState(1);
  const [project, setProject] = React.useState('');
  const localSelected = React.useMemo(() => selectEstimatedCost(cost, { days, project }), [cost, days, project]);
  const detail = detailState?.status === 'ready' ? detailState.detail : null;
  const detailMatches = !!detail
    && Number(detail.query?.days) === days
    && String(detail.query?.project || '') === project
    && (!cost?.generatedAt || String(detail.generated_at || '') === cost.generatedAt);
  const loadingInitialPageMatches = detailState?.status === 'loading'
    && Number(detailState.query?.days) === days
    && String(detailState.query?.project || '') === project
    && String(detailState.query?.cursor || '0') === '0';
  const readyInitialPageMatches = detailMatches
    && String(detail.pagination?.cursor || '0') === '0';
  const selected = detailMatches ? {
    costUsd: Math.max(0, Number(detail.summary?.cost_usd) || 0),
    records: Math.max(0, Number(detail.summary?.records) || 0),
    tokens: {
      input: Math.max(0, Number(detail.summary?.tokens?.input) || 0),
      cached: Math.max(0, Number(detail.summary?.tokens?.cached) || 0),
      output: Math.max(0, Number(detail.summary?.tokens?.output) || 0),
    },
    byModel: Array.isArray(detail.summary?.by_model) ? detail.summary.by_model : [],
    byDay: Array.isArray(detail.summary?.by_day) ? detail.summary.by_day : [],
  } : localSelected;
  React.useEffect(() => {
    if (!cost?.detail?.truncated || !onRequestDetail) return;
    if (loadingInitialPageMatches || readyInitialPageMatches) return;
    onRequestDetail({ days, project, cursor: '0', pageSize: cost.detail.pageSize || 256 });
  }, [cost?.detail?.truncated, cost?.detail?.pageSize, cost?.generatedAt, days, project, onRequestDetail]);
  if (!cost) return null;
  const hasAuthoritativeTotals = (['ready', 'partial', 'stale'].includes(cost.status)
    || (cost.status === 'scanning' && !!cost.lastGoodGeneratedAt))
    && cost.costUsd != null && cost.records != null
    && cost.tokens.input != null && cost.tokens.cached != null && cost.tokens.output != null;
  const stateCopy = {
    'not-started': ['Not scanned yet', 'The local cost scan has not completed.'],
    idle: ['Not scanned yet', 'The local cost scan has not completed.'],
    scanning: ['Scanning local history', 'Provider quota remains available while cost files are scanned.'],
    error: ['Cost scan unavailable', 'The last cost payload failed its bounded structural contract. Provider quota is still current.'],
    unavailable: ['Cost scan unavailable', 'Local cost sources are unavailable. Provider quota is still current.'],
    cancelled: ['Cost scan cancelled', 'No zero total is reported because the scan did not complete.'],
  }[cost.status] || ['Cost data pending', 'Waiting for an authoritative local cost scan.'];
  if (!hasAuthoritativeTotals) return (
    <section className="usage-cost-panel" aria-labelledby="usage-cost-heading">
      <div className="usage-cost-heading">
        <span>
          <h3 id="usage-cost-heading">Local estimated API-equivalent cost</h3>
          <small>Separate from subscription quota</small>
        </span>
        <span className={`usage-cost-status ${cost.status}`}>{cost.status}</span>
      </div>
      <div className="usage-cost-state" role="status">
        <strong>{stateCopy[0]}</strong>
        <span>{stateCopy[1]}</span>
        {cost.reasonCode && <small>Reason: {cost.reasonCode}{cost.reasonPath ? ` (${cost.reasonPath})` : ''}</small>}
      </div>
      <div className="usage-cost-scan">{Number.isFinite(Number(cost.scan.files_complete))
        ? `Incremental local JSONL scan - ${cost.scan.files_complete}/${cost.scan.files_total || 0} files`
        : 'Incremental local JSONL scan has not reported file progress.'}</div>
    </section>
  );
  const projects = [...new Set(cost.byProject.map(row => row.project).filter(Boolean))].sort();
  const modelRows = [...(selected?.byModel || [])].sort((left, right) => right.cost_usd - left.cost_usd).slice(0, 12);
  const dayRows = [...(selected?.byDay || [])].sort((left, right) => left.day.localeCompare(right.day));
  const maximumDayCost = Math.max(0.000001, ...dayRows.map(row => Number(row.cost_usd) || 0));
  return (
    <section className="usage-cost-panel" aria-labelledby="usage-cost-heading">
      <div className="usage-cost-heading">
        <span>
          <h3 id="usage-cost-heading">Local estimated API-equivalent cost</h3>
          <small>Separate from subscription quota · pricing {cost.catalogVersion || 'unavailable'}</small>
        </span>
        <span className={`usage-cost-status ${cost.status}`}>{cost.status}</span>
      </div>
      <div className="usage-cost-controls">
        <label>Range
          <select value={days} onChange={event => setDays(Number(event.target.value))}>
            {[1, 7, 30, 90, 365].map(value => <option key={value} value={value}>{value === 1 ? 'Today' : `${value} days`}</option>)}
          </select>
        </label>
        <label>Project
          <select value={project} onChange={event => setProject(event.target.value)}>
            <option value="">All projects</option>
            {projects.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="usage-cost-summary">
        <span><strong>${(selected?.costUsd || 0).toFixed(2)}</strong><small>estimated cost</small></span>
        <span><strong>{formatUsageTokens(selected?.tokens.input)}</strong><small>input tokens</small></span>
        <span><strong>{formatUsageTokens(selected?.tokens.cached)}</strong><small>cached tokens</small></span>
        <span><strong>{formatUsageTokens(selected?.tokens.output)}</strong><small>output tokens</small></span>
      </div>
      {cost.detail?.truncated && <div className="usage-cost-detail-state" role="status">
        {detailMatches
          ? `Showing detail rows ${Number(detail.pagination?.cursor || 0) + 1}-${Number(detail.pagination?.cursor || 0) + Number(detail.pagination?.returned_rows || 0)} of ${Number(detail.pagination?.total_rows || 0)}.`
          : detailState?.status === 'error'
            ? 'Cost detail is unavailable.'
            : `Loading a bounded detail page for ${cost.detail.totalRows} cost-detail rows.`}
      </div>}
      <div className="usage-cost-chart" role="img" aria-label={`${days}-day estimated cost by day`}>
        {(dayRows.length ? dayRows : [{ day: 'No data', cost_usd: 0 }]).map(row => (
          <span key={row.day} title={`${row.day}: $${Number(row.cost_usd).toFixed(4)}`}>
            <i style={{ height: `${Math.max(3, (Number(row.cost_usd) / maximumDayCost) * 100)}%` }} />
            <small>{row.day.slice(5)}</small>
          </span>
        ))}
      </div>
      {cost.detail?.truncated && <details className="usage-cost-detail-table">
        <summary>Cost detail rows</summary>
        {detailState?.status === 'loading' && <div className="usage-cost-detail-state">Loading cost detail…</div>}
        {detailState?.status === 'error' && <div className="usage-cost-detail-state">Cost detail unavailable: {detailState.error}</div>}
        {detailMatches && <>
          <div className="usage-cost-detail-pager" aria-label="Cost detail pagination">
            <button type="button" disabled={Number(detail.pagination?.cursor || 0) <= 0} onClick={() => onRequestDetail({
              days, project,
              cursor: String(Math.max(0, Number(detail.pagination.cursor || 0) - Number(detail.pagination.page_size || 256))),
              pageSize: detail.pagination.page_size || 256,
            })}>Previous</button>
            <span>{detail.pagination.returned_rows} rows · {detail.pagination.total_rows} total</span>
            <button type="button" disabled={!detail.pagination?.next_cursor} onClick={() => onRequestDetail({
              days, project, cursor: detail.pagination.next_cursor, pageSize: detail.pagination.page_size || 256,
            })}>Next</button>
          </div>
          <div className="usage-cost-table-wrap">
            <table className="usage-cost-table">
              <caption>Paginated local cost detail</caption>
              <thead><tr><th>Day</th><th>Provider / model</th><th>Project</th><th>Speed</th><th>Cost</th></tr></thead>
              <tbody>{(detail.rows || []).map((row, index) => <tr key={`${detail.pagination.cursor}:${index}`}>
                <td>{row.day}</td><th scope="row">{row.provider_id} · {row.model}</th><td>{row.project}</td>
                <td>{row.speed}</td><td>${Number(row.cost_usd).toFixed(4)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
      </details>}
      <div className="usage-cost-table-wrap">
        <table className="usage-cost-table">
          <caption>Estimated cost and tokens by provider model</caption>
          <thead><tr><th>Provider / model</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th></tr></thead>
          <tbody>{modelRows.map(row => (
            <tr key={`${row.provider_id}:${row.model}`}>
              <th scope="row">{row.provider_id === 'openai-codex' ? 'Codex' : 'Claude'} · {row.model}</th>
              <td>{formatUsageTokens(row.input)}</td><td>{formatUsageTokens(row.cached)}</td>
              <td>{formatUsageTokens(row.output)}</td><td>${Number(row.cost_usd).toFixed(4)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {cost.unknownModels.length > 0 && (
        <div className="usage-cost-fallbacks">
          <strong>Fallback pricing</strong>
          {cost.unknownModels.map(item => <span key={`${item.provider_id}:${item.model}`}>{item.model} → {item.fallback}</span>)}
        </div>
      )}
      <div className="usage-cost-scan">Incremental local JSONL scan · {cost.scan.files_complete || 0}/{cost.scan.files_total || 0} files · {cost.records} deduplicated records</div>
    </section>
  );
}

function UsageDashboard({ usage, refreshReceipt, resetReceipt, costDetail, onBack, onRefresh, onWatch, onConsumeResetCredit, onRequestCostDetail }) {
  const normalized = React.useMemo(() => normalizeProviderUsage(usage), [usage]);
  const [nowMs, setNowMs] = React.useState(Date.now());
  React.useEffect(() => {
    if (normalized.collectionState === 'not-started') onRefresh(false);
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [onRefresh, normalized.collectionState]);
  React.useEffect(() => {
    onWatch(true);
    return () => onWatch(false);
  }, [onWatch]);
  const statusLabel = status => ({
    fresh: 'Fresh', refreshing: 'Refreshing', stale: 'Stale', auth_required: 'Sign in required',
    rate_limited: 'Refresh limited', unavailable: 'Unavailable',
  })[status] || 'Unavailable';
  const resetAttention = normalized.entries.find(entry => (
    entry.providerId === 'openai-codex'
    && Number(entry.resetCredits?.available_count) > 0
    && entry.windows.some(window => window.usedPercent >= 100)
  ));
  const resetPending = ['requested', 'accepted'].includes(resetReceipt?.status);

  return (
    <div className="usage-dashboard" data-testid="usage-dashboard">
      <div className="automations-header usage-dashboard-header">
        <button className="automations-back" onClick={onBack} title="Back to sessions">←</button>
        <div className="automations-header-text">
          <h2>Usage & limits</h2>
          <p>Provider-account quotas shared by connected harnesses. Warnings start at 75% used.</p>
        </div>
        <button
          type="button"
          className="usage-dashboard-refresh"
          onClick={() => onRefresh(true)}
          disabled={normalized.inFlight}
          aria-label="Refresh provider usage"
        >
          {normalized.inFlight ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {normalized.collectionState !== 'ready' && <div className={`usage-dashboard-collection-state ${normalized.collectionState}`} role="status">
        <strong>{({
          'not-started': 'Provider usage has not been collected yet',
          refreshing: 'Refreshing provider usage',
          partial: 'Some provider usage is unavailable',
          stale: 'Showing last-good provider usage',
          unavailable: 'Provider usage is unavailable',
        })[normalized.collectionState] || 'Provider usage is pending'}</strong>
        <span>Generation {normalized.generation}{normalized.generatedAt ? ` · ${formatProviderUsageAge(normalized.generatedAt, nowMs)}` : ''}</span>
      </div>}
      <div className="usage-dashboard-summary" aria-label="Usage summary">
        <div><strong>{normalized.summaryAuthoritative ? normalized.summary.providers : '—'}</strong><span>providers</span></div>
        <div><strong>{normalized.summaryAuthoritative ? normalized.summary.accounts : '—'}</strong><span>accounts</span></div>
        <div><strong>{normalized.summaryAuthoritative ? normalized.summary.reporting : '—'}</strong><span>reporting</span></div>
        <div className={normalized.summary.nearLimit > 0 ? 'warning' : ''}><strong>{normalized.summaryAuthoritative ? normalized.summary.nearLimit : '—'}</strong><span>near limit</span></div>
        <div className={normalized.summary.exhausted > 0 ? 'critical' : ''}><strong>{normalized.summaryAuthoritative ? normalized.summary.exhausted : '—'}</strong><span>exhausted</span></div>
      </div>
      {refreshReceipt && <div className={`usage-refresh-receipt ${refreshReceipt.status}`} role="status">
        Refresh {refreshReceipt.status}{refreshReceipt.generation != null ? ` · generation ${refreshReceipt.generation}` : ''}
      </div>}
      {resetAttention && <div className="usage-reset-attention" role="alert" data-testid="codex-reset-credit-attention">
        <span>
          <strong>{resetAttention.resetCredits.available_count} limit reset{resetAttention.resetCredits.available_count === 1 ? '' : 's'} available — apply one?</strong>
          <small>Remote Agent Chat will use Codex's native reset action only after this approval.</small>
        </span>
        <button type="button" onClick={onConsumeResetCredit} disabled={resetPending}>
          {resetPending ? 'Applying…' : 'Apply one reset'}
        </button>
      </div>}
      {resetReceipt && !['requested'].includes(resetReceipt.status) && <div className={`usage-refresh-receipt ${resetReceipt.status}`} role="status" data-testid="codex-reset-credit-receipt">
        Reset {resetReceipt.status}{resetReceipt.outcome ? `: ${resetReceipt.outcome}` : ''}{resetReceipt.error ? ` (${resetReceipt.error})` : ''}
      </div>}
      <UsageCostPanel cost={normalized.estimatedCost} detailState={costDetail} onRequestDetail={onRequestCostDetail} />
      <div className="usage-dashboard-grid">
        {normalized.entries.map(entry => {
          const creditLabel = formatProviderCredits(entry.credits);
          const financialRows = providerFinancialRows(entry.financials);
          const creditReset = entry.credits?.resets_at
            ? formatProviderUsageReset(entry.credits.resets_at, nowMs)
            : '';
          const cardRefreshReceipt = refreshReceipt?.provider_id === entry.providerId ? refreshReceipt : null;
          const cardRefreshPending = ['requested', 'accepted', 'coalesced'].includes(cardRefreshReceipt?.status);
          return (
            <details
              open
              className={`usage-dashboard-card ${entry.tone}`}
              key={entry.key}
              data-provider-id={entry.providerId}
              data-account-fingerprint={entry.accountFingerprint}
            >
              <summary className="usage-dashboard-card-summary">
                <ProviderMark providerId={entry.providerId} providerName={entry.providerName} />
                <span className="usage-dashboard-card-title">
                  <strong>{entry.providerName}</strong>
                  <span>{entry.accountLabel}{entry.plan ? ` · ${entry.plan}` : ''}</span>
                </span>
                <span className={`usage-dashboard-status ${entry.status}`}>{statusLabel(entry.status)}</span>
              </summary>
              <div className="usage-dashboard-card-body">
                <div className="usage-dashboard-card-meta">
                  <span>{entry.sessionCount} mapped session{entry.sessionCount === 1 ? '' : 's'}</span>
                  <span>{entry.harnessTypes.length > 0 ? entry.harnessTypes.join(', ') : 'No mapped surfaces'}</span>
                  <span>{entry.status === 'stale' ? `Stale - ${formatProviderUsageAge(entry.capturedAt, nowMs)}` : formatProviderUsageAge(entry.capturedAt, nowMs)}</span>
                  {entry.nextRefreshAt && <span>Next refresh {formatProviderUsageReset(entry.nextRefreshAt, nowMs)}</span>}
                  {entry.refreshIntervalMs > 0 && <span>{entry.watchBoostActive ? `Live cadence ${Math.round(entry.refreshIntervalMs / 1000)}s` : `Idle cadence ${Math.round(entry.refreshIntervalMs / 1000)}s`}</span>}
                  <button
                    type="button"
                    className="usage-card-refresh"
                    onClick={() => onRefresh(true, entry.providerId)}
                    disabled={cardRefreshPending}
                    aria-label={`Refresh ${entry.providerName} usage now`}
                  >{cardRefreshPending ? 'Refreshing...' : 'Refresh now'}</button>
                </div>
                {cardRefreshReceipt && <div className={`usage-refresh-receipt ${cardRefreshReceipt.status}`} role="status">
                  Refresh {cardRefreshReceipt.status}{cardRefreshReceipt.code ? ` (${cardRefreshReceipt.code})` : ''}
                  {cardRefreshReceipt.retry_after_ms ? ` - retry in ${Math.ceil(cardRefreshReceipt.retry_after_ms / 1000)}s` : ''}
                </div>}
                {entry.windows.length > 0 ? (
                  <div className="usage-dashboard-windows">
                    {entry.windows.map(window => {
                      const tone = window.tone;
                      const reset = window.resetDescription || formatProviderUsageReset(window.resetsAt, nowMs);
                      return (
                        <div className={`usage-dashboard-window ${tone}`} key={window.id}>
                          <div className="usage-dashboard-window-heading">
                            <span>
                              <strong>{window.label}</strong>
                              {window.modelScope?.label ? <small>Model: {window.modelScope.label}</small>
                                : window.scope && window.scope !== window.label ? <small>{window.scope}</small> : null}
                            </span>
                            <span>
                              <strong>{window.remainingPercent == null ? 'Unavailable' : `${formatProviderPercent(window.remainingPercent)} left`}</strong>
                              <small>{window.usedPercent == null ? 'No reported value' : `${formatProviderPercent(window.usedPercent)} used`}</small>
                            </span>
                          </div>
                          {window.usedPercent != null && <div
                            className="usage-dashboard-meter"
                            role="progressbar"
                            aria-label={`${entry.providerName} ${window.label}`}
                            aria-valuetext={`${formatProviderPercent(window.usedPercent)} used`}
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={Math.round(window.visualPercent)}
                          ><span style={{ width: `${window.visualPercent}%` }} /></div>}
                          <div className="usage-window-thresholds">
                            Warning {formatProviderPercent(window.thresholds.warningPercent)} · Critical {formatProviderPercent(window.thresholds.criticalPercent)}
                          </div>
                          {window.pace && <div className={`usage-pace ${window.pace.category}`}>
                            <div className="usage-pace-heading">
                              <span className="usage-pace-category">{window.pace.category}</span>
                              <span>Ideal {formatProviderPercent(window.pace.expectedUsedPercent)} · projected {formatProviderPercent(window.pace.projectedUsedPercent)}</span>
                            </div>
                            <div className="usage-pace-chart" role="img" aria-label={`${window.label} actual ${formatProviderPercent(window.usedPercent)}, ideal ${formatProviderPercent(window.pace.expectedUsedPercent)}, projected ${formatProviderPercent(window.pace.projectedUsedPercent)}`}>
                              <span className="usage-pace-actual" style={{ width: `${window.visualPercent}%` }} />
                              <i className="usage-pace-ideal" style={{ left: `${Math.min(100, window.pace.expectedUsedPercent)}%` }} />
                              <i className="usage-pace-projected" style={{ left: `${Math.min(100, window.pace.projectedUsedPercent)}%` }} />
                            </div>
                            <div className="usage-pace-budgets">
                              {Object.entries({ Now: 'now', '+1 hour': 'next_hour', '+5 hours': 'next_five_hours', Today: 'today' }).map(([label, key]) => (
                                <span key={key}><small>{label}</small><strong>{formatProviderPercent(window.pace.budgets?.[key] || 0)}</strong></span>
                              ))}
                            </div>
                            <div className="usage-pace-outcome">{window.usedPercent >= 100
                              ? 'Quota is exhausted'
                              : window.pace.willLastToReset
                                ? 'Current pace lasts to reset'
                                : `Projected exhaustion ${formatProviderUsageReset(window.pace.exhaustionAt, nowMs)}`}</div>
                          </div>}
                          {reset && <div className="usage-dashboard-reset">Resets {reset}</div>}
                          <div className="usage-window-provenance">{window.source || entry.source}{window.provenance ? ` · ${window.provenance}` : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : !entry.localRuntime && !entry.cloudUsage ? (
                  <div className="usage-dashboard-unavailable">{entry.error?.message || 'This provider did not report quota windows.'}</div>
                ) : null}
                {entry.cloudUsage && entry.providerId === 'ollama-local' && (
                  entry.cloudUsage.subscriptionState === 'active' ? (
                    <div className="usage-dashboard-credit-row" data-testid="ollama-cloud-usage">
                      <span><strong>Ollama Cloud</strong>{entry.windows.length} quota window{entry.windows.length === 1 ? '' : 's'}<small>{formatProviderUsageAge(entry.cloudUsage.capturedAt, nowMs)}</small></span>
                      <span><strong>Auto-reload</strong>{entry.cloudUsage.autoReloadEnabled == null ? 'Not reported' : entry.cloudUsage.autoReloadEnabled ? 'On' : 'Off'}<small>Extra usage balance is separate from plan quota</small></span>
                    </div>
                  ) : entry.cloudUsage.subscriptionState === 'none' ? (
                    <div className="usage-dashboard-unavailable" data-testid="ollama-cloud-no-subscription"><strong>No cloud subscription</strong> - local models remain unlimited</div>
                  ) : (
                    <div className="usage-dashboard-unavailable" data-testid="ollama-cloud-unavailable"><strong>Cloud usage unavailable</strong> - {entry.cloudUsage.error?.message || 'Open the signed-in Ollama Usage page to expose account quota.'}</div>
                  )
                )}
                {entry.localRuntime && (
                  <div className="usage-dashboard-credit-row" data-testid="ollama-local-runtime">
                    <span><strong>Local runtime</strong>{entry.localRuntime.loadedModelsCount} loaded / {entry.localRuntime.installedModelsCount} installed<small>{entry.localRuntime.endpointScope.replace(/_/g, ' ')}</small></span>
                    <span><strong>Request telemetry</strong>{entry.localRuntime.telemetryStatus.replace(/_/g, ' ')}<small>{entry.localRuntime.telemetryReason}</small></span>
                  </div>
                )}
                {entry.localRuntime?.latestRequest && (
                  <div className="usage-dashboard-credit-row" data-testid="ollama-owned-request-metrics">
                    <span><strong>Latest owned request</strong>{entry.localRuntime.latestRequest.model}<small>{entry.localRuntime.latestRequest.surface.replace(/_/g, ' ')} - {formatProviderUsageAge(entry.localRuntime.latestRequest.capturedAt, nowMs)}</small></span>
                    <span><strong>Tokens</strong>{entry.localRuntime.latestRequest.promptTokens} prompt - {entry.localRuntime.latestRequest.responseTokens} output<small>{formatOllamaTokenRate(entry.localRuntime.latestRequest.tokensPerSecond)}</small></span>
                    <span><strong>Total / load</strong>{formatOllamaDuration(entry.localRuntime.latestRequest.totalDurationNs)} / {formatOllamaDuration(entry.localRuntime.latestRequest.loadDurationNs)}<small>terminal response metrics</small></span>
                    <span><strong>Prompt / eval</strong>{formatOllamaDuration(entry.localRuntime.latestRequest.promptEvalDurationNs)} / {formatOllamaDuration(entry.localRuntime.latestRequest.evalDurationNs)}<small>{entry.localRuntime.observedRequestCount} owned receipt{entry.localRuntime.observedRequestCount === 1 ? '' : 's'}</small></span>
                  </div>
                )}
                {financialRows.length > 0 && (
                  <div className="usage-dashboard-credit-row usage-dashboard-financial-row">
                    {financialRows.map(row => <span key={row.id}><strong>{row.label}</strong>{row.value}</span>)}
                  </div>
                )}
                {(creditLabel || entry.resetCredits) && (
                  <div className="usage-dashboard-credit-row">
                    {creditLabel && <span><strong>Credits</strong>{creditLabel}{creditReset && <small>Resets {creditReset}</small>}</span>}
                    {entry.resetCredits && <span><strong>Rate-limit resets</strong>{entry.resetCredits.available_count || 0} available</span>}
                  </div>
                )}
                {Array.isArray(entry.resetCredits?.details) && entry.resetCredits.details.length > 0 && (
                  <div className="usage-dashboard-reset-credits">
                    {entry.resetCredits.details.map((credit, index) => (
                      <span key={`${credit.title || 'reset'}-${index}`}>
                        <strong>{credit.title || `Reset credit ${index + 1}`}</strong>
                        {credit.status && <small>{credit.status}</small>}
                        {credit.expires_at && <small>Expires {formatProviderUsageReset(credit.expires_at, nowMs)}</small>}
                      </span>
                    ))}
                  </div>
                )}
                {entry.error?.message && entry.windows.length > 0 && <div className="usage-dashboard-stale-error">Last refresh: {entry.error.message}</div>}
                <div className="usage-dashboard-source-row">
                  <span>Source: {entry.source ? entry.source.replace(/_/g, ' ') : 'not available'}{entry.latencyMs != null ? ` · ${entry.latencyMs} ms` : ''}</span>
                  {entry.dashboardUrl && <a href={entry.dashboardUrl} target="_blank" rel="noreferrer">Open provider dashboard</a>}
                </div>
              </div>
            </details>
          );
        })}
        {normalized.entries.length === 0 && (
          <div className="usage-dashboard-empty">
            <strong>{normalized.collectionState === 'ready'
              ? 'The completed scan found no provider usage.'
              : 'Provider usage is not available yet.'}</strong>
            <span>{normalized.collectionState === 'ready'
              ? 'Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local Ollama, then refresh.'
              : 'Quota totals remain unknown until a provider collection completes.'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const HOST_RESOURCE_CHART_WIDTH = 640;
const HOST_RESOURCE_CHART_HEIGHT = 220;
const HOST_RESOURCE_CHART_MARGIN = Object.freeze({ left: 54, right: 14, top: 12, bottom: 32 });

function clampHostViewport(viewport) {
  const width = Math.max(0.04, Math.min(1, Number(viewport?.end) - Number(viewport?.start) || 1));
  const start = Math.max(0, Math.min(1 - width, Number(viewport?.start) || 0));
  return { start, end: start + width };
}

function hostResourceChartPath(samples, valueField, xFor, yFor) {
  let path = '';
  let drawing = false;
  samples.forEach(sample => {
    const value = sample[valueField];
    if (sample.gap || value == null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    path += `${drawing ? 'L' : 'M'}${xFor(sample).toFixed(2)},${yFor(value).toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function HostResourceChart({
  title, description, frames, series, percentScale = false,
  viewport, onViewportChange, crosshairSequence, onCrosshairChange,
  range = 'live', nowMs = Date.now(), paused = false, subscriptionStatus = 'live',
}) {
  const chartRef = React.useRef(null);
  const pointersRef = React.useRef(new Map());
  const gestureRef = React.useRef(null);
  const previousAutoMaximumRef = React.useRef(0);
  const [hiddenSeries, setHiddenSeries] = React.useState({});
  const [scale, setScale] = React.useState({ mode: 'auto', fixedMax: null });
  const plotWidth = HOST_RESOURCE_CHART_WIDTH - HOST_RESOURCE_CHART_MARGIN.left - HOST_RESOURCE_CHART_MARGIN.right;
  const plotHeight = HOST_RESOURCE_CHART_HEIGHT - HOST_RESOURCE_CHART_MARGIN.top - HOST_RESOURCE_CHART_MARGIN.bottom;
  const timeline = hostResourceTimeline(frames, {
    nowMs, paused, connected: subscriptionStatus !== 'reconnecting', subscriptionStatus,
  });
  const orderedFrames = timeline.frames;
  const boundedViewport = clampHostViewport(viewport);
  const rangeDuration = HOST_RESOURCE_CHART_RANGES[range] ?? HOST_RESOURCE_CHART_RANGES.live;
  const baseEndMs = paused ? (timeline.endMs || nowMs) : nowMs;
  const baseStartMs = rangeDuration === Infinity
    ? (timeline.startMs || baseEndMs - HOST_RESOURCE_CHART_RANGES.live)
    : baseEndMs - rangeDuration;
  const baseSpanMs = Math.max(1, baseEndMs - baseStartMs);
  const visibleStartMs = baseStartMs + baseSpanMs * boundedViewport.start;
  const visibleEndMs = baseStartMs + baseSpanMs * boundedViewport.end;
  const visibleFrames = orderedFrames.filter(frame => (
    Number(frame.chart_time_ms) >= visibleStartMs && Number(frame.chart_time_ms) <= visibleEndMs
  ));
  const chartSeries = series.map(entry => {
    const sourceFrames = entry.frames
      ? hostResourceTimeline(entry.frames, { nowMs, paused: true }).frames
      : visibleFrames;
    const boundedSource = entry.frames
      ? sourceFrames.filter(frame => Number(frame.chart_time_ms) >= visibleStartMs && Number(frame.chart_time_ms) <= visibleEndMs)
      : sourceFrames;
    return {
      ...entry,
      visibleFrames: boundedSource,
      samples: downsampleHostResourceSeries(boundedSource, entry.metric, 180),
    };
  });
  const activeSeries = chartSeries.filter(entry => !hiddenSeries[entry.key]);
  const rawPeak = Math.max(0, ...activeSeries.flatMap(entry => entry.samples.map(sample => sample.max || 0)));
  const automaticScale = hostResourceNiceScale(rawPeak, previousAutoMaximumRef.current, { percent: percentScale });
  if (!percentScale && scale.mode === 'auto') previousAutoMaximumRef.current = automaticScale.maximum;
  const scaleContract = scale.mode === 'fixed' && scale.fixedMax
    ? hostResourceNiceScale(scale.fixedMax, scale.fixedMax, { percent: percentScale })
    : automaticScale;
  const yMaximum = scaleContract.maximum;
  const xFor = sample => HOST_RESOURCE_CHART_MARGIN.left
    + hostResourceTimeFraction(sample, visibleStartMs, visibleEndMs) * plotWidth;
  const yFor = value => HOST_RESOURCE_CHART_MARGIN.top + plotHeight
    - (Math.max(0, Math.min(yMaximum, value)) / Math.max(1, yMaximum)) * plotHeight;
  const crosshairFrame = visibleFrames.find(frame => frame.sample_sequence === crosshairSequence) || visibleFrames.at(-1) || null;
  const crosshairX = crosshairFrame
    ? HOST_RESOURCE_CHART_MARGIN.left + hostResourceTimeFraction(crosshairFrame, visibleStartMs, visibleEndMs) * plotWidth
    : null;
  const formatValue = series[0]?.format || (value => String(value));
  const xTicks = hostResourceTimeTicks(visibleStartMs, visibleEndMs,
    typeof window !== 'undefined' && window.innerWidth <= 600 ? 4 : 5);
  const statusLabel = timeline.status[0]?.toUpperCase() + timeline.status.slice(1);

  function clientFraction(event) {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds?.width) return 0.5;
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  }

  function sequenceAtFraction(fraction) {
    if (!visibleFrames.length) return 0;
    const targetTime = visibleStartMs + (visibleEndMs - visibleStartMs) * fraction;
    return visibleFrames.reduce((closest, frame) => (
      Math.abs(Number(frame.chart_time_ms) - targetTime) < Math.abs(Number(closest.chart_time_ms) - targetTime)
        ? frame : closest
    ), visibleFrames[0]).sample_sequence;
  }

  function zoomAt(factor, fraction = 0.5) {
    const current = clampHostViewport(viewport);
    const width = Math.max(0.04, Math.min(1, (current.end - current.start) * factor));
    const absoluteCenter = current.start + (current.end - current.start) * fraction;
    onViewportChange(clampHostViewport({ start: absoluteCenter - width * fraction, end: absoluteCenter + width * (1 - fraction) }));
  }

  React.useEffect(() => {
    const node = chartRef.current;
    if (!node) return undefined;
    const onWheel = event => {
      event.preventDefault();
      zoomAt(event.deltaY > 0 ? 1.2 : 0.8, clientFraction(event));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  });

  function onPointerDown(event) {
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    onCrosshairChange(sequenceAtFraction(clientFraction(event)));
    if (pointersRef.current.size === 1) {
      gestureRef.current = { mode: 'pan', pointerId: event.pointerId, startX: event.clientX, viewport: clampHostViewport(viewport) };
    } else if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      gestureRef.current = {
        mode: 'pinch', distance: Math.max(1, Math.abs(points[1].x - points[0].x)),
        center: (clientFraction({ clientX: points[0].x }) + clientFraction({ clientX: points[1].x })) / 2,
        viewport: clampHostViewport(viewport),
      };
    }
  }

  function onPointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) {
      onCrosshairChange(sequenceAtFraction(clientFraction(event)));
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (gesture?.mode === 'pinch' && pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()];
      const distance = Math.max(1, Math.abs(points[1].x - points[0].x));
      const originalWidth = gesture.viewport.end - gesture.viewport.start;
      const width = Math.max(0.04, Math.min(1, originalWidth * gesture.distance / distance));
      const absoluteCenter = gesture.viewport.start + originalWidth * gesture.center;
      onViewportChange(clampHostViewport({
        start: absoluteCenter - width * gesture.center,
        end: absoluteCenter + width * (1 - gesture.center),
      }));
      return;
    }
    if (gesture?.mode === 'pan' && gesture.pointerId === event.pointerId) {
      const bounds = chartRef.current?.getBoundingClientRect();
      const width = gesture.viewport.end - gesture.viewport.start;
      const shift = bounds?.width ? -(event.clientX - gesture.startX) / bounds.width * width : 0;
      onViewportChange(clampHostViewport({ start: gesture.viewport.start + shift, end: gesture.viewport.end + shift }));
    }
  }

  function onPointerUp(event) {
    pointersRef.current.delete(event.pointerId);
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch {}
    if (pointersRef.current.size === 0) gestureRef.current = null;
  }

  function onKeyDown(event) {
    if (!visibleFrames.length) return;
    const currentIndex = Math.max(0, visibleFrames.findIndex(frame => frame.sample_sequence === crosshairSequence));
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (event.shiftKey) {
        const width = boundedViewport.end - boundedViewport.start;
        const shift = width * (event.key === 'ArrowLeft' ? -0.1 : 0.1);
        onViewportChange(clampHostViewport({ start: boundedViewport.start + shift, end: boundedViewport.end + shift }));
      } else {
        const next = Math.max(0, Math.min(visibleFrames.length - 1, currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)));
        onCrosshairChange(visibleFrames[next].sample_sequence);
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onCrosshairChange((event.key === 'Home' ? visibleFrames[0] : visibleFrames.at(-1)).sample_sequence);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); zoomAt(0.75);
    } else if (event.key === '-') {
      event.preventDefault(); zoomAt(1.25);
    }
  }

  return (
    <section className="host-resource-chart" aria-label={`${title} chart`}>
      <div className="host-resource-chart-heading">
        <span><strong>{title}</strong><small>{description}</small></span>
        {!percentScale && (
          <button type="button" onClick={() => setScale(previous => (
            previous.mode === 'auto' ? { mode: 'fixed', fixedMax: automaticScale.maximum } : { mode: 'auto', fixedMax: null }
          ))}>{scale.mode === 'auto' ? 'Auto scale' : `Fixed ${formatValue(scale.fixedMax)}`}</button>
        )}
      </div>
      <div className={`host-resource-chart-quality ${timeline.status}`} role="status">
        <strong>{statusLabel}</strong>
        <span>{timeline.receivedCount} received / {timeline.validCount} valid / {timeline.expectedCount} expected / {timeline.droppedCount} dropped</span>
        <span>{Math.round(timeline.cadenceMs)} ms cadence</span>
        <span>{timeline.gapCount} gap{timeline.gapCount === 1 ? '' : 's'}</span>
        <span>{timeline.duplicateCount} duplicate / {timeline.outOfOrderCount} out of order</span>
      </div>
      <div className="host-resource-chart-legend" aria-label={`${title} series`}>
        {chartSeries.map((entry, index) => (
          <button
            type="button" key={entry.key} aria-pressed={!hiddenSeries[entry.key]}
            onClick={() => setHiddenSeries(previous => ({ ...previous, [entry.key]: !previous[entry.key] }))}
          ><i className={`marker marker-${index % 3}`} style={{ '--series-color': entry.color }} />{entry.label}</button>
        ))}
      </div>
      <div
        className="host-resource-chart-canvas" ref={chartRef} role="group" tabIndex="0"
        aria-label={`${title}. Drag to pan, wheel or pinch to zoom, arrow keys move the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <svg viewBox={`0 0 ${HOST_RESOURCE_CHART_WIDTH} ${HOST_RESOURCE_CHART_HEIGHT}`} aria-hidden="true">
          {timeline.gaps.filter(gap => gap.endMs >= visibleStartMs && gap.startMs <= visibleEndMs).map((gap, index) => {
            const left = HOST_RESOURCE_CHART_MARGIN.left + Math.max(0, (gap.startMs - visibleStartMs) / Math.max(1, visibleEndMs - visibleStartMs)) * plotWidth;
            const right = HOST_RESOURCE_CHART_MARGIN.left + Math.min(1, (gap.endMs - visibleStartMs) / Math.max(1, visibleEndMs - visibleStartMs)) * plotWidth;
            return <rect key={`${gap.reason}-${index}`} className="host-resource-chart-gap" x={left} y={HOST_RESOURCE_CHART_MARGIN.top} width={Math.max(2, right - left)} height={plotHeight} />;
          })}
          {[...scaleContract.ticks].reverse().map(value => {
            const y = yFor(value);
            return <React.Fragment key={value}><line className="host-resource-chart-grid" x1={HOST_RESOURCE_CHART_MARGIN.left} x2={HOST_RESOURCE_CHART_WIDTH - HOST_RESOURCE_CHART_MARGIN.right} y1={y} y2={y} /><text className="host-resource-chart-y-label" textAnchor="end" x={HOST_RESOURCE_CHART_MARGIN.left - 7} y={y + 4}>{formatValue(value)}</text></React.Fragment>;
          })}
          {xTicks.map((tick, index) => {
            const x = HOST_RESOURCE_CHART_MARGIN.left + tick.fraction * plotWidth;
            return <text key={tick.timeMs} className="host-resource-chart-x-label" aria-label={tick.accessibleLabel} textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'} x={x} y={HOST_RESOURCE_CHART_HEIGHT - 7}>{tick.label}</text>;
          })}
          {activeSeries.flatMap(entry => entry.samples.map(sample => (
            sample.gap || sample.min == null || sample.max == null ? null : (
              <line key={`${entry.key}-${sample.endSequence}`} className="host-resource-chart-range" stroke={entry.color}
                x1={xFor(sample)} x2={xFor(sample)} y1={yFor(sample.min)} y2={yFor(sample.max)} />
            )
          )))}
          {activeSeries.map((entry, index) => (
            <path key={entry.key} className={`host-resource-chart-line series-${index % 3}`} stroke={entry.color}
              strokeDasharray={entry.dashed || index % 3 === 1 ? '7 4' : index % 3 === 2 ? '2 4' : undefined}
              d={hostResourceChartPath(entry.samples, 'average', xFor, yFor)} />
          ))}
          {activeSeries.flatMap((entry, seriesIndex) => entry.visibleFrames.length < 10
            ? entry.visibleFrames.map(frame => {
              const value = hostResourceMetricValue(frame, entry.metric);
              return value == null ? null : <circle key={`${entry.key}-point-${frame.sample_sequence}`} className={`host-resource-chart-point marker-${seriesIndex % 3}`} cx={xFor(frame)} cy={yFor(value)} r="3" stroke={entry.color} />;
            }) : [])}
          {crosshairX != null && <line className="host-resource-chart-crosshair" x1={crosshairX} x2={crosshairX} y1={HOST_RESOURCE_CHART_MARGIN.top} y2={HOST_RESOURCE_CHART_MARGIN.top + plotHeight} />}
        </svg>
        {crosshairFrame && (
          <div className={`host-resource-chart-tooltip ${crosshairX > HOST_RESOURCE_CHART_WIDTH / 2 ? 'flip' : ''}`} role="status">
            <strong>{formatHostResourceTimestampFull(crosshairFrame.chart_time_ms)} / seq {crosshairFrame.sample_sequence}</strong>
            <span>{Math.max(0, Math.round((nowMs - Number(crosshairFrame.chart_time_ms)) / 1000))}s old / {crosshairFrame.sample_interval_ms || timeline.cadenceMs} ms / {statusLabel} / source {crosshairFrame.status || 'unknown'}</span>
            {chartSeries.map(entry => (
              <span key={entry.key}><i style={{ background: entry.color }} />{entry.label}: {entry.format(hostResourceMetricValue(
                entry.visibleFrames.find(frame => frame.sample_sequence === crosshairFrame.sample_sequence), entry.metric,
              ))}</span>
            ))}
          </div>
        )}
      </div>
      <div className="host-resource-chart-stats">
        {chartSeries.filter(entry => !hiddenSeries[entry.key]).map(entry => {
          const stats = hostResourceIntervalStats(entry.visibleFrames, entry.metric);
          const peakFrame = entry.visibleFrames.find(frame => frame.sample_sequence === stats.peakSequence);
          return (
            <span key={entry.key}>
              <strong>{entry.label}</strong>
              <span>Latest-good {entry.format(stats.current)}</span><span>Min {entry.format(stats.min)}</span>
              <span>Avg {entry.format(stats.average)} ({stats.averageMethod})</span><span>Max {entry.format(stats.max)}</span>
              <span>{stats.p95Ready ? `p95 ${entry.format(stats.p95)}` : `p95 collecting (${stats.count}/20)`}</span>
              <small>{stats.count} raw / {Math.round(stats.elapsedMs / 1000)}s / {stats.cadenceMs || timeline.cadenceMs} ms cadence / {Math.max(stats.gapCount, timeline.gapCount)} gaps / {statusLabel} / peak {formatHostResourceTimestamp(peakFrame?.captured_at)}</small>
            </span>
          );
        })}
      </div>
      <details className="host-resource-chart-data">
        <summary>Accessible data table</summary>
        <div><table><caption>Latest {Math.min(120, visibleFrames.length)} of {visibleFrames.length} visible samples</caption><thead><tr><th>Time / sequence</th>{chartSeries.map(entry => <th key={entry.key}>{entry.label}</th>)}</tr></thead><tbody>
          {visibleFrames.slice(-120).map(frame => <tr key={`${frame.sample_sequence}:${frame.chart_time_ms}`}><th>{formatHostResourceTimestampFull(frame.chart_time_ms)} / {frame.sample_sequence}{frame.gap_before ? ` / gap: ${frame.gap_reason}` : ''}</th>{chartSeries.map(entry => <td key={entry.key}>{entry.format(hostResourceMetricValue(entry.visibleFrames.find(candidate => candidate.sample_sequence === frame.sample_sequence), entry.metric))}</td>)}</tr>)}
        </tbody></table></div>
      </details>
    </section>
  );
}

function hostResourceProcessRows(processes, search, filter, sort, expanded) {
  const query = search.trim().toLowerCase();
  const matches = process => (!query || [process.name, process.agentLabel, process.workspaceLabel, process.pid, process.attributionReason]
    .some(value => String(value || '').toLowerCase().includes(query)))
    && (filter === 'all' || process.attributionLevel === filter);
  const candidates = processes.filter(matches);
  const candidateKeys = new Set(candidates.map(process => process.stableKey));
  const compare = (left, right) => {
    if (sort === 'name') return (left.agentLabel || left.name).localeCompare(right.agentLabel || right.name) || left.pid - right.pid;
    if (sort === 'memory') return right.memoryBytes - left.memoryBytes || left.pid - right.pid;
    if (sort === 'read') return right.ioReadBps - left.ioReadBps || left.pid - right.pid;
    if (sort === 'write') return right.ioWriteBps - left.ioWriteBps || left.pid - right.pid;
    return right.cpuHostPercent - left.cpuHostPercent || left.pid - right.pid;
  };
  const children = new Map();
  candidates.forEach(process => {
    const parent = candidateKeys.has(process.parentKey) ? process.parentKey : '';
    children.set(parent, [...(children.get(parent) || []), process]);
  });
  const rows = [];
  function visit(parent, depth) {
    (children.get(parent) || []).sort(compare).forEach(process => {
      rows.push({ process, depth });
      if (expanded[process.stableKey] !== false) visit(process.stableKey, depth + 1);
    });
  }
  visit('', 0);
  return rows;
}

function hostResourceStripSparklinePath(frames, metric, width = 44, height = 16) {
  const values = (Array.isArray(frames) ? frames : [])
    .map(frame => hostResourceMetricValue(frame, metric))
    .filter(value => value !== null);
  if (values.length < 2) return '';
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function GlobalHostResourceStrip({
  connected, error, history, subscription, onOpen, onRefresh, onSubscribe, onUnsubscribe,
}) {
  const desktopQuery = '(min-width: 900px)';
  const [desktop, setDesktop] = React.useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(desktopQuery).matches
      : false
  ));
  const [nowMs, setNowMs] = React.useState(Date.now());
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(desktopQuery);
    const update = () => setDesktop(media.matches);
    update();
    if (typeof media.addEventListener === 'function') media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);
  React.useEffect(() => {
    if (!desktop) return undefined;
    onSubscribe(true, 'global-strip');
    return () => onUnsubscribe('global-strip');
  }, [desktop, onSubscribe, onUnsubscribe]);
  React.useEffect(() => {
    if (!desktop) return undefined;
    const tick = () => setNowMs(Date.now());
    const timer = setInterval(tick, 1_000);
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      tick();
      onRefresh(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [desktop, onRefresh]);
  const projection = React.useMemo(() => projectHostResourceStrip(history, {
    connected,
    error: Boolean(error),
    nowMs,
    subscriptionStatus: subscription?.status,
  }), [connected, error, history, nowMs, subscription?.status]);
  if (!desktop) return null;
  const metricText = value => (value == null ? '\u2014' : String(Math.round(value))).padStart(3, '\u2007');
  const levelMark = level => level === 'critical' ? '!!' : level === 'warning' ? '!' : '';
  const statusText = projection.status === 'stale'
    ? `stale ${projection.ageSeconds}s`
    : projection.status;
  const memoryDetail = projection.memoryUsedBytes !== null && projection.memoryTotalBytes !== null
    ? `${formatHostResourceBytes(projection.memoryUsedBytes)} of ${formatHostResourceBytes(projection.memoryTotalBytes)}`
    : 'memory totals unavailable';
  const title = projection.point
    ? `Host CPU ${projection.cpuPercent?.toFixed(1) ?? 'unknown'}%; memory ${projection.memoryPercent?.toFixed(1) ?? 'unknown'}% (${memoryDetail}); ${statusText}; sample ${projection.sampleSequence}`
    : `Host resources ${statusText}`;
  const ariaLabel = projection.point
    ? `Open Host resources. CPU ${projection.cpuPercent?.toFixed(1) ?? 'unknown'} percent, ${projection.cpuLevel}. RAM ${projection.memoryPercent?.toFixed(1) ?? 'unknown'} percent, ${projection.memoryLevel}. ${statusText}. Sample ${projection.sampleSequence}.`
    : `Open Host resources. CPU and RAM waiting. ${statusText}.`;
  return (
    <div className="global-desktop-status-rail" data-testid="global-desktop-status-rail">
      <button
        type="button"
        className={`global-host-resource-strip ${projection.attention}`}
        data-testid="global-host-resource-strip"
        data-status={projection.status}
        data-cpu-level={projection.cpuLevel}
        data-memory-level={projection.memoryLevel}
        data-sample-sequence={projection.sampleSequence || ''}
        data-sample-captured-at={projection.capturedAt || ''}
        data-cpu-percent={projection.cpuPercent ?? ''}
        data-memory-percent={projection.memoryPercent ?? ''}
        data-history-count={projection.frames.length}
        aria-label={ariaLabel}
        title={title}
        onClick={onOpen}
      >
        <span className={`global-host-resource-metric ${projection.cpuLevel}`}>
          <span className="label">CPU{' '}</span>
          <span className="value">{metricText(projection.cpuPercent)}</span>
          <span className="unit">%</span>
          <span className="attention-mark">{levelMark(projection.cpuLevel)}</span>
        </span>
        <span className="global-host-resource-divider" aria-hidden="true">{'\u00b7'}</span>
        <span className={`global-host-resource-metric ${projection.memoryLevel}`}>
          <span className="label">RAM{' '}</span>
          <span className="value">{metricText(projection.memoryPercent)}</span>
          <span className="unit">%</span>
          <span className="attention-mark">{levelMark(projection.memoryLevel)}</span>
        </span>
        <svg className="global-host-resource-sparkline" viewBox="0 0 44 16" aria-hidden="true">
          <path className="cpu" d={hostResourceStripSparklinePath(projection.frames, 'cpu_total_percent')} />
          <path className="memory" d={hostResourceStripSparklinePath(projection.frames, 'memory_used_percent')} />
        </svg>
        <span className="global-host-resource-state">{statusText}</span>
      </button>
    </div>
  );
}

function HostResourceDashboard({
  snapshot, error, history, details, subscription,
  onBack, onRefresh, onSubscribe, onUnsubscribe,
}) {
  const normalized = React.useMemo(() => normalizeHostResources(snapshot), [snapshot]);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [range, setRange] = React.useState('live');
  const [pausedSequence, setPausedSequence] = React.useState(null);
  const [pausedAtMs, setPausedAtMs] = React.useState(null);
  const [viewport, setViewport] = React.useState({ start: 0, end: 1 });
  const [crosshairSequence, setCrosshairSequence] = React.useState(0);
  const [aggregateOnly, setAggregateOnly] = React.useState(false);
  const [processSearch, setProcessSearch] = React.useState('');
  const [processFilter, setProcessFilter] = React.useState('all');
  const [processSort, setProcessSort] = React.useState('cpu');
  const [expandedProcesses, setExpandedProcesses] = React.useState({});
  const [selectedProcessKey, setSelectedProcessKey] = React.useState('');
  React.useEffect(() => {
    onSubscribe(aggregateOnly, 'dashboard');
    return () => onUnsubscribe('dashboard');
  }, [aggregateOnly, onSubscribe, onUnsubscribe]);
  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const liveHistory = React.useMemo(() => (
    pausedSequence == null ? history : history.filter(frame => frame.sample_sequence <= pausedSequence)
  ), [history, pausedSequence]);
  const rangeNowMs = pausedSequence == null ? nowMs : pausedAtMs || nowMs;
  const rangeFrames = React.useMemo(() => selectHostResourceRange(liveHistory, range, {
    nowMs: rangeNowMs,
    paused: pausedSequence != null,
    subscriptionStatus: subscription?.status,
    connected: subscription?.status !== 'reconnecting',
    error: Boolean(error),
  }), [liveHistory, range, rangeNowMs, pausedSequence, subscription?.status, error]);
  const timeline = React.useMemo(() => hostResourceTimeline(liveHistory, {
    nowMs: rangeNowMs,
    paused: pausedSequence != null,
    subscriptionStatus: subscription?.status,
    connected: subscription?.status !== 'reconnecting',
    error: Boolean(error),
  }), [liveHistory, rangeNowMs, pausedSequence, subscription?.status, error]);
  const staleRefreshKeyRef = React.useRef('');
  React.useEffect(() => {
    if (!['delayed', 'stale'].includes(timeline.status) || pausedSequence != null) {
      staleRefreshKeyRef.current = '';
      return;
    }
    const key = `${timeline.status}:${timeline.points.at(-1)?.sampleSequence || 0}`;
    if (staleRefreshKeyRef.current === key) return;
    staleRefreshKeyRef.current = key;
    onRefresh(false);
  }, [timeline.status, timeline.points, pausedSequence, onRefresh]);
  React.useEffect(() => {
    if (!crosshairSequence && rangeFrames.length) setCrosshairSequence(rangeFrames.at(-1).sample_sequence);
  }, [crosshairSequence, rangeFrames]);
  const system = normalized.system;
  const diskRate = system ? system.disk.readBps + system.disk.writeBps : 0;
  const networkRate = system ? system.network.receiveBps + system.network.sendBps : 0;
  const processRows = React.useMemo(() => hostResourceProcessRows(
    normalized.processes, processSearch, processFilter, processSort, expandedProcesses,
  ), [normalized.processes, processSearch, processFilter, processSort, expandedProcesses]);
  const selectedProcess = normalized.processes.find(process => process.stableKey === selectedProcessKey) || null;
  const detailFailureAge = normalized.lastGoodCapturedAt
    ? formatHostResourceAge(normalized.lastGoodCapturedAt, nowMs).replace(/^Updated\s+/i, '')
    : 'not yet available';
  const selectedProcessFrames = React.useMemo(() => (selectedProcessKey ? details.flatMap(detail => {
    const process = (detail.processes || []).find(entry => entry.stable_key === selectedProcessKey);
    if (!process) return [];
    return [{
      frame_kind: 'system', sample_sequence: detail.sample_sequence, captured_at: detail.captured_at,
      sample_interval_ms: detail.sample_interval_ms, dropped_gap_count: detail.dropped_gap_count,
      status: detail.status, cpu: { total_percent: process.cpu_host_percent },
      disk: { read_bps: process.io_read_bps, write_bps: process.io_write_bps },
    }];
  }) : []), [details, selectedProcessKey]);
  const percent = value => value == null ? '—' : formatHostResourcePercent(value);
  const rate = value => value == null ? '—' : formatHostResourceRate(value);
  const timelineStatusLabel = ({ live: 'Live', delayed: 'Delayed', reconnecting: 'Reconnecting', paused: 'Paused', stale: 'Stale', waiting: 'Waiting', unavailable: 'Unavailable' })[timeline.status] || 'Unavailable';
  const cpuSeries = [
    { key: 'cpu-total', metric: 'cpu_total_percent', label: 'Total', color: '#58a6ff', format: percent },
    { key: 'cpu-user', metric: 'cpu_user_percent', label: 'User', color: '#3fb950', format: percent },
    { key: 'cpu-kernel', metric: 'cpu_privileged_percent', label: 'Kernel', color: '#d29922', format: percent },
    ...(selectedProcessFrames.length ? [{ key: 'process-cpu', metric: 'cpu_total_percent', label: `${selectedProcess?.agentLabel || selectedProcess?.name || 'Process'} overlay`, color: '#f778ba', format: percent, frames: selectedProcessFrames, dashed: true }] : []),
  ];
  const diskSeries = [
    { key: 'disk-read', metric: 'disk_read_bps', label: 'Read', color: '#58a6ff', format: rate },
    { key: 'disk-write', metric: 'disk_write_bps', label: 'Write', color: '#f0883e', format: rate },
    ...(selectedProcessFrames.length ? [
      { key: 'process-read', metric: 'disk_read_bps', label: 'Process read overlay', color: '#bc8cff', format: rate, frames: selectedProcessFrames, dashed: true },
      { key: 'process-write', metric: 'disk_write_bps', label: 'Process write overlay', color: '#f778ba', format: rate, frames: selectedProcessFrames, dashed: true },
    ] : []),
  ];
  return (
    <div className="host-resource-dashboard" data-testid="host-resource-dashboard">
      <div className="automations-header host-resource-header">
        <button className="automations-back" onClick={onBack} title="Back to sessions">&larr;</button>
        <div className="automations-header-text">
          <h2>Host resources</h2>
          <p>Live, ephemeral Windows metrics. Process commands and executable paths never leave the proxy.</p>
        </div>
        <button type="button" className="usage-dashboard-refresh" onClick={() => onRefresh(true)} aria-label="Capture host resource detail now">Capture detail</button>
      </div>
      <div className="host-resource-meta">
        <span className={`host-resource-status ${timeline.status}`}>{timelineStatusLabel}</span>
        <span>{aggregateOnly ? 'Aggregate-only' : normalized.machineLabel || 'Windows host'}</span>
        <span>{formatHostResourceAge(normalized.capturedAt, nowMs)}</span>
        <span>{timeline.receivedCount} received / {timeline.validCount} valid / {timeline.expectedCount} expected / {timeline.droppedCount} dropped / {timeline.gapCount} gaps / {timeline.duplicateCount} dup / {timeline.outOfOrderCount} out-of-order</span>
        <span>{Math.round(timeline.cadenceMs)} ms cadence / seq {normalized.sampleSequence || '—'}</span>
      </div>
      <div className="host-resource-controls" aria-label="Host resource timeline controls">
        <div className="host-resource-range" role="group" aria-label="Time range">
          {[['live', 'Live'], ['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['since_open', 'Since open']].map(([value, label]) => (
            <button key={value} type="button" className={range === value ? 'active' : ''} aria-pressed={range === value}
              onClick={() => { setRange(value); setViewport({ start: 0, end: 1 }); }}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={() => {
          if (pausedSequence == null) {
            setPausedAtMs(Date.now());
            setPausedSequence(history.at(-1)?.sample_sequence || 0);
          } else {
            setPausedSequence(null);
            setPausedAtMs(null);
          }
        }}>{pausedSequence == null ? 'Pause' : 'Resume'}</button>
        <button type="button" disabled={viewport.start === 0 && viewport.end === 1} onClick={() => setViewport({ start: 0, end: 1 })}>Reset zoom</button>
        <label><input type="checkbox" checked={aggregateOnly} onChange={event => { setAggregateOnly(event.target.checked); setSelectedProcessKey(''); }} /> Aggregate-only privacy</label>
        <span>{rangeFrames.length} raw samples / {Math.round(timeline.elapsedMs / 1000)}s actual{pausedSequence == null ? '' : ` / paused at ${pausedSequence}`}</span>
      </div>
      {(error || normalized.error) && <div className="host-resource-error" role="status">
        {error?.message || normalized.error?.message}
        {normalized.error && ` Last full detail: ${detailFailureAge}.`}
      </div>}
      {system ? (
        <>
          <div className="host-resource-summary" aria-label="Host resource summary">
            <div><strong>{Math.round(system.cpuPercent)}%</strong><span>CPU</span><small>{system.cpu.logicalCoreCount || '—'} logical / {system.cpu.physicalCoreCount || '—'} physical cores</small></div>
            <div><strong>{Math.round(system.memory.usedPercent)}%</strong><span>memory</span><small>{formatHostResourceBytes(system.memory.usedBytes)} / {formatHostResourceBytes(system.memory.totalBytes)}; commit {Math.round(system.memory.commitPercent)}%</small></div>
            <div><strong>{formatHostResourceRate(diskRate)}</strong><span>disk I/O</span><small>Read {formatHostResourceRate(system.disk.readBps)} / write {formatHostResourceRate(system.disk.writeBps)} / {Math.round(system.disk.busyPercent)}% busy</small></div>
            <div><strong>{formatHostResourceRate(networkRate)}</strong><span>network I/O</span><small>Receive {formatHostResourceRate(system.network.receiveBps)} / send {formatHostResourceRate(system.network.sendBps)}</small></div>
          </div>
          <div className="host-resource-charts">
            <HostResourceChart title="CPU" description="Total outline; User and Kernel component overlays (%)" frames={rangeFrames} series={cpuSeries} percentScale viewport={viewport} onViewportChange={setViewport} crosshairSequence={crosshairSequence} onCrosshairChange={setCrosshairSequence} range={range} nowMs={rangeNowMs} paused={pausedSequence != null} subscriptionStatus={subscription?.status} />
            <HostResourceChart title="Memory" description="Physical used and committed (%)" frames={rangeFrames} series={[
              { key: 'memory-used', metric: 'memory_used_percent', label: 'Physical used', color: '#bc8cff', format: percent },
              { key: 'memory-commit', metric: 'memory_commit_percent', label: 'Committed', color: '#f778ba', format: percent },
            ]} percentScale viewport={viewport} onViewportChange={setViewport} crosshairSequence={crosshairSequence} onCrosshairChange={setCrosshairSequence} range={range} nowMs={rangeNowMs} paused={pausedSequence != null} subscriptionStatus={subscription?.status} />
            <HostResourceChart title="Disk" description="Aggregate throughput (IEC bytes/s); isolate unequal series in the legend" frames={rangeFrames} series={diskSeries} viewport={viewport} onViewportChange={setViewport} crosshairSequence={crosshairSequence} onCrosshairChange={setCrosshairSequence} range={range} nowMs={rangeNowMs} paused={pausedSequence != null} subscriptionStatus={subscription?.status} />
            <HostResourceChart title="Network" description="Physical-default receive and send (IEC bytes/s)" frames={rangeFrames} series={[
              { key: 'network-receive', metric: 'network_receive_bps', label: 'Receive', color: '#3fb950', format: rate },
              { key: 'network-send', metric: 'network_send_bps', label: 'Send', color: '#d29922', format: rate },
            ]} viewport={viewport} onViewportChange={setViewport} crosshairSequence={crosshairSequence} onCrosshairChange={setCrosshairSequence} range={range} nowMs={rangeNowMs} paused={pausedSequence != null} subscriptionStatus={subscription?.status} />
          </div>
          {!aggregateOnly && (
            <section className="host-resource-process-section" aria-labelledby="host-resource-process-heading">
              <div className="host-resource-process-heading">
                <span><strong id="host-resource-process-heading">Processes</strong><small>Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-session ownership.</small></span>
                <span>{normalized.attributedProcesses.length} attributed / {normalized.processes.length} shown</span>
              </div>
              <div className="host-resource-process-controls">
                <label>Search <input value={processSearch} onChange={event => setProcessSearch(event.target.value)} placeholder="Name, PID, agent, workspace" /></label>
                <label>Attribution <select value={processFilter} onChange={event => setProcessFilter(event.target.value)}><option value="all">All</option><option value="owned">Owned</option><option value="runtime">Runtime match</option><option value="workspace-associated">Workspace-associated</option><option value="unattributed">Unattributed</option></select></label>
                <label>Sort <select value={processSort} onChange={event => setProcessSort(event.target.value)}><option value="cpu">CPU</option><option value="memory">Memory</option><option value="read">Read</option><option value="write">Write</option><option value="name">Name</option></select></label>
              </div>
              {selectedProcess && (
                <div className="host-resource-process-overlay" role="region" aria-label={`Process detail for ${selectedProcess.agentLabel || selectedProcess.name}`}>
                  <div><strong>{selectedProcess.agentLabel || selectedProcess.name}</strong><span>{selectedProcess.name} / PID {selectedProcess.pid} / started {selectedProcess.startTime ? formatHostResourceTimestamp(selectedProcess.startTime) : 'unknown'}</span><small>{selectedProcess.attributionLevel}: {selectedProcess.attributionReason}. CPU and disk overlays use the same synchronized timebase.</small></div>
                  <button type="button" onClick={() => setSelectedProcessKey('')}>Remove overlay</button>
                  <dl><div><dt>Host CPU</dt><dd>{selectedProcess.cpuHostPercent.toFixed(1)}%</dd></div><div><dt>Core equivalent</dt><dd>{selectedProcess.cpuCoreEquivalent.toFixed(1)}%</dd></div><div><dt>Working set</dt><dd>{formatHostResourceBytes(selectedProcess.memoryBytes)}</dd></div><div><dt>Private / commit</dt><dd>{formatHostResourceBytes(selectedProcess.privateBytes)} / {formatHostResourceBytes(selectedProcess.commitBytes)}</dd></div><div><dt>Threads / handles</dt><dd>{selectedProcess.threadCount} / {selectedProcess.handleCount}</dd></div><div><dt>I/O operations</dt><dd>R {selectedProcess.ioReadOps} / W {selectedProcess.ioWriteOps}</dd></div><div><dt>64-bit byte counters</dt><dd>R {selectedProcess.counterTotals.ioReadBytes} / W {selectedProcess.counterTotals.ioWriteBytes}</dd></div><div><dt>Detail samples</dt><dd>{selectedProcessFrames.length} / 5s cadence</dd></div></dl>
                </div>
              )}
              <div className="host-resource-process-scroll">
                <table className="host-resource-process-table">
                  <thead><tr><th scope="col">Agent / process tree</th><th scope="col">Confidence</th><th scope="col">CPU host / core</th><th scope="col">Memory</th><th scope="col">Read</th><th scope="col">Write</th></tr></thead>
                  <tbody>
                    {processRows.map(({ process, depth }) => (
                      <tr key={process.stableKey} className={`${process.attributed ? 'attributed' : ''} ${selectedProcessKey === process.stableKey ? 'selected' : ''}`} data-agent-attributed={process.attributed ? 'true' : 'false'}>
                        <td style={{ '--process-depth': depth }}>
                          {process.childCount > 0 && <button className="host-resource-process-expand" type="button" aria-label={`${expandedProcesses[process.stableKey] === false ? 'Expand' : 'Collapse'} ${process.name}`} aria-expanded={expandedProcesses[process.stableKey] !== false} onClick={() => setExpandedProcesses(previous => ({ ...previous, [process.stableKey]: previous[process.stableKey] !== false ? false : true }))}>{expandedProcesses[process.stableKey] === false ? '+' : '-'}</button>}
                          <button className="host-resource-process-select" type="button" onClick={() => setSelectedProcessKey(process.stableKey)}><strong>{process.agentLabel || process.name}</strong><span>{process.agentLabel ? `${process.name} / ` : ''}PID {process.pid}{process.workspaceLabel ? ` / ${process.workspaceLabel}` : ''}{process.parentKey ? ' / child process' : process.parentPid ? ` / parent PID ${process.parentPid} outside sample` : ''}</span></button>
                        </td>
                        <td data-label="Confidence"><strong>{process.attributionLevel}</strong><span title={process.attributionReason}>{process.attributionReason}</span></td>
                        <td data-label="CPU host / core">{process.cpuHostPercent.toFixed(1)}% / {process.cpuCoreEquivalent.toFixed(1)}%</td>
                        <td data-label="Memory">{formatHostResourceBytes(process.memoryBytes)}</td>
                        <td data-label="Read">{formatHostResourceRate(process.ioReadBps)}</td>
                        <td data-label="Write">{formatHostResourceRate(process.ioWriteBps)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="host-resource-privacy"><strong>Privacy boundary:</strong> sanitized metrics cross the authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also removes machine, device, adapter, workspace, process, and PID labels.</div>
        </>
      ) : (
        <div className="usage-dashboard-empty host-resource-empty"><strong>Waiting for the Windows proxy.</strong><span>The subscription is {subscription?.status || 'starting'}. Gaps remain visible; unavailable samples are not interpolated.</span></div>
      )}
    </div>
  );
}


function fleetWorkContextProgress(context) {
  const explicit = Number(context?.percent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  const completed = Number(context?.completed);
  const total = Number(context?.total);
  return Number.isInteger(completed) && Number.isInteger(total) && total > 0
    ? Math.max(0, Math.min(100, (completed / total) * 100))
    : null;
}

function fleetSessionSnippet(session, sessionMessages) {
  const direct = safeString(session?.last_snippet).trim();
  if (direct) return direct.replace(/\s+/g, ' ').slice(0, 180);
  const list = Array.isArray(sessionMessages) ? sessionMessages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = stripTitleNoise(list[index]?.content || contentBlocksFallback(list[index]?.content_blocks));
    if (text) return text.slice(0, 180);
  }
  return 'No recent message reported.';
}

function fleetElapsed(activity, nowMs) {
  if (activity?.goal) return formatGoalElapsed(activity.goal, nowMs, activity.goal_run);
  const startedAt = Date.parse(activity?.startedAt || activity?.started_at || activity?.since || '');
  return Number.isFinite(startedAt)
    ? formatClockDuration(Math.max(0, (nowMs - startedAt) / 1000), { includeSeconds: true })
    : 'live';
}

function reconcileFleetSelection(previous, entryById, limit = MAX_BROADCAST_SESSIONS) {
  const next = previous.filter(id => entryById[id]?.canReceiveBroadcast).slice(0, limit);
  return next.length === previous.length && next.every((id, index) => id === previous[index])
    ? previous : next;
}

function FleetView({ sessions, activities, thinking, permissionPrompts, errorPrompts, messages, agentConfigs, sessionAttention, health, connected, deliveryStates, stopPending, goalControlPending, onBroadcastSend, onInterrupt, onGoalControl, onBack, onSelectSession }) {
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [showIdle, setShowIdle] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [broadcastPrompt, setBroadcastPrompt] = React.useState('');
  const [broadcastConfirmation, setBroadcastConfirmation] = React.useState('');
  const [broadcastError, setBroadcastError] = React.useState('');
  const [broadcastReceipts, setBroadcastReceipts] = React.useState({});
  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const allEntries = React.useMemo(() => (sessions || []).map(session => {
    const id = sessionIdOf(session);
    const hasLiveActivity = Object.prototype.hasOwnProperty.call(activities, id);
    const activity = hasLiveActivity ? (activities[id] || { kind: 'idle', label: '' }) : (session?.activity || { kind: 'idle', label: '' });
    const prompt = permissionPrompts[id] || (isBlockingErrorPrompt(errorPrompts[id]) ? errorPrompts[id] : null);
    // Completion cues remain useful in the sidebar/toast, but they are not a
    // blocking agent condition. Fleet reserves Needs attention for prompts,
    // failures, and other actionable signals so a newly active session cannot
    // be masked by an older completion notification.
    const attentionSignal = sessionAttention[id] || null;
    const attention = !!prompt || session?.rate_limit_active === true
      || ['goal_attention', 'provider_usage_threshold'].includes(attentionSignal?.kind);
    const config = agentConfigs[id] || {};
    const agentType = session?.agent_type;
    const goalCapable = goalLifecycleSupported(agentType, config.capabilities);
    const capabilitySafeActivity = goalCapable ? activity : { ...activity, goal: null };
    const activityForState = thinking[id] && !capabilitySafeActivity?.kind
      ? { ...capabilitySafeActivity, kind: 'thinking' }
      : capabilitySafeActivity;
    const state = classifyFleetActivity(activityForState, attention, {
      connected,
      health: health[id],
      nowMs,
      requireFreshness: true,
    });
    const needsAttention = state === 'needs_attention';
    const working = fleetStateIsWorking(state);
    const goalSubstate = fleetGoalSubstateLabel(capabilitySafeActivity, {
      connected,
      health: health[id],
    });
    const agent = sessionAgent(session, config);
    const workContext = projectFleetWorkContext({
      agentType,
      capabilities: config.capabilities,
      activity: capabilitySafeActivity,
      latestUserRequest: session?.last_user_request || latestUserRequestFromMessages(messages[id] || []),
    });
    const goal = workContext.kind === 'goal' ? capabilitySafeActivity?.goal || null : null;
    const goalState = String(goal?.state || goal?.status || '').toLowerCase();
    const goalBlocked = goalState === 'blocked';
    const blockedResumeSupported = goalBlocked && config.capabilities?.goal_blocked_resume === true;
    const goalAction = goalState === 'active'
      ? 'pause'
      : (goalState === 'paused' || blockedResumeSupported ? 'resume' : null);
    const goalBlockedReason = goalBlocked
      ? safeString(goal?.block_reason || goal?.reason || capabilitySafeActivity?.label || 'Goal blocked').trim()
      : '';
    const turnActive = ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working']
      .includes(String(capabilitySafeActivity?.kind || '').toLowerCase());
    const activityKind = safeString(capabilitySafeActivity?.kind).replace(/_/g, ' ');
    const usagePercent = Number(session?.percent_used);
    const usageReset = session?.rate_limited_until && session.rate_limited_until !== 'unknown'
      ? formatUsageResetLabel(session.rate_limited_until) : '';
    const usageStatus = session?.rate_limit_active === true
      ? `Usage limited${usageReset ? ` · resets ${usageReset}` : ' · reset unknown'}`
      : Number.isFinite(usagePercent) && usagePercent >= 75
        ? `Usage ${Math.round(usagePercent)}% used${usageReset ? ` · resets ${usageReset}` : ''}`
        : '';
    return {
      id, session, agent, activity: capabilitySafeActivity, attention: needsAttention, working, state, goal, config,
      stateLabel: session?.rate_limit_active === true ? 'Usage limited' : fleetStateLabel(state),
      title: sidebarChatTitle(session, id, config, messages[id] || []),
      status: prompt ? (safeString(prompt.title).trim() || 'Action required')
        : (usageStatus || goalSubstate || safeString(activity?.label).trim()
          || (state === 'idle' ? (goal ? 'Goal paused' : 'Idle') : (activityKind || (goal ? 'Goal active' : 'Working')))),
      workContext,
      progress: fleetWorkContextProgress(workContext),
      snippet: fleetSessionSnippet(session, messages[id] || []),
      health: health[id] || 'unknown',
      canReceiveBroadcast: sessionSupportsBroadcast(session, agentConfigs[id], health[id] || 'unknown', connected),
      freshness: fleetFreshnessLabel(activity, nowMs),
      activityLatencyMs: Number.isFinite(Number(activity?.transport?.latency_ms)) ? Math.round(Number(activity.transport.latency_ms)) : null,
      goalAction,
      canControlGoal: !!(goalAction && goal?.fingerprint && config.capabilities?.goal_pause_resume === true
        && Number(session?.control_generation) > 0),
      goalBlocked,
      goalBlockedReason,
      canInterrupt: !!(turnActive && config.capabilities?.interrupt === true
        && Number(session?.control_generation) > 0 && Number(session?.turn_generation) > 0),
    };
  }).filter(Boolean).sort((left, right) => (
    Number(right.attention) - Number(left.attention)
    || Number(right.working) - Number(left.working)
    || left.title.localeCompare(right.title)
  )), [sessions, activities, thinking, permissionPrompts, errorPrompts, messages, agentConfigs, sessionAttention, health, connected, nowMs]);
  const entries = React.useMemo(() => allEntries.filter(entry => showIdle || entry.state !== 'idle' || entry.goal), [allEntries, showIdle]);
  const attentionCount = allEntries.filter(entry => entry.state === 'needs_attention').length;
  const workingCount = allEntries.filter(entry => entry.working).length;
  const workingGoalCount = allEntries.filter(entry => entry.state === 'working_goal').length;
  const idleCount = allEntries.filter(entry => entry.state === 'idle').length;
  const entryById = React.useMemo(() => Object.fromEntries(entries.map(entry => [entry.id, entry])), [entries]);
  const expectedConfirmation = `SEND TO ${selectedIds.length} SESSIONS`;
  React.useEffect(() => {
    if (selectedIds.length <= MAX_BROADCAST_SESSIONS
      && selectedIds.every(id => entryById[id]?.canReceiveBroadcast)) return;
    setSelectedIds(previous => reconcileFleetSelection(previous, entryById));
  }, [entryById, selectedIds]);
  React.useEffect(() => {
    if (Object.keys(broadcastReceipts).length === 0) return;
    setBroadcastReceipts(previous => {
      let changed = false;
      const next = {};
      Object.entries(previous).forEach(([sessionId, receipt]) => {
        const lifecycle = deliveryStates[receipt.clientMessageId] || receipt.status;
        const status = ['offline_queued', 'busy_queued', 'steered'].includes(lifecycle) ? 'queued' : lifecycle;
        const normalized = ['queued', 'accepted', 'launch_accepted', 'delivered', 'agent_started', 'failed'].includes(status) ? status : receipt.status;
        next[sessionId] = normalized === receipt.status ? receipt : { ...receipt, status: normalized };
        if (next[sessionId] !== receipt) changed = true;
      });
      return changed ? next : previous;
    });
  }, [deliveryStates]);

  function toggleBroadcastSelection(sessionId) {
    setBroadcastError('');
    setSelectedIds(previous => previous.includes(sessionId)
      ? previous.filter(id => id !== sessionId)
      : previous.length < MAX_BROADCAST_SESSIONS ? [...previous, sessionId] : previous);
  }

  function submitBroadcast() {
    const normalized = normalizeBroadcastRequest({
      session_ids: selectedIds,
      content: broadcastPrompt,
      confirmation: broadcastConfirmation,
    }, sessionId => !!entryById[sessionId]?.canReceiveBroadcast);
    if (!normalized.ok) {
      setBroadcastError(normalized.error);
      return;
    }
    const initial = createBroadcastReceiptState(normalized.sessionIds);
    const receipts = {};
    normalized.sessionIds.forEach(sessionId => {
      const clientMessageId = onBroadcastSend(sessionId, normalized.content);
      receipts[sessionId] = {
        ...initial[sessionId],
        clientMessageId,
        title: entryById[sessionId]?.title || sessionId,
      };
    });
    setBroadcastReceipts(receipts);
    setBroadcastPrompt('');
    setBroadcastConfirmation('');
    setBroadcastError('');
  }

  return (
    <div className="fleet-view" data-testid="fleet-view">
      <div className="automations-header fleet-view-header">
        <button className="automations-back" onClick={onBack} title="Back to sessions">{'\u2190'}</button>
        <div className="automations-header-text">
          <h2>Fleet view</h2>
          <p>Live monitoring across every active harness session.</p>
        </div>
      </div>
      <div className="fleet-summary" aria-label="Fleet summary">
        <div><strong>{allEntries.length}</strong><span>sessions</span></div>
        <div className={workingCount ? 'working' : ''}><strong>{workingCount}</strong><span>working</span></div>
        <div className={workingGoalCount ? 'working-goal' : ''}><strong>{workingGoalCount}</strong><span>on goal</span></div>
        <div><strong>{idleCount}</strong><span>idle</span></div>
        <div className={attentionCount ? 'attention' : ''}><strong>{attentionCount}</strong><span>need attention</span></div>
      </div>
      <div className="fleet-filter-row">
        <span>{workingCount} working now</span>
        <button type="button" onClick={() => setShowIdle(value => !value)} aria-pressed={showIdle}>
          {showIdle ? 'Hide idle sessions' : `Show ${idleCount} idle session${idleCount === 1 ? '' : 's'}`}
        </button>
      </div>
      <section className="fleet-broadcast" data-testid="broadcast-send">
        <div className="fleet-broadcast-heading">
          <div><strong>Broadcast prompt</strong><span>Select up to {MAX_BROADCAST_SESSIONS} capable sessions.</span></div>
          <span>{selectedIds.length} selected</span>
        </div>
        <textarea
          value={broadcastPrompt}
          onChange={event => setBroadcastPrompt(event.target.value)}
          maxLength={MAX_BROADCAST_CONTENT_CHARS}
          placeholder="Prompt every selected session..."
          aria-label="Broadcast prompt"
        />
        <div className="fleet-broadcast-confirm">
          <label><span>Type <strong>{expectedConfirmation}</strong> to confirm</span><input value={broadcastConfirmation} onChange={event => setBroadcastConfirmation(event.target.value)} aria-label="Broadcast confirmation" /></label>
          <button type="button" onClick={submitBroadcast} disabled={!connected || selectedIds.length === 0 || !broadcastPrompt.trim() || broadcastConfirmation !== expectedConfirmation}>Send to {selectedIds.length || 0}</button>
        </div>
        {broadcastError && <div className="fleet-broadcast-error" role="alert">{broadcastError}</div>}
        {Object.keys(broadcastReceipts).length > 0 && (
          <div className="fleet-broadcast-receipts" aria-label="Broadcast delivery receipts">
            {Object.entries(broadcastReceipts).map(([sessionId, receipt]) => <span key={sessionId} className={`fleet-broadcast-receipt ${receipt.status}`} title={receipt.title}><strong>{receipt.title}</strong><em>{receipt.status.replace(/_/g, ' ')}</em></span>)}
          </div>
        )}
      </section>
      {entries.length === 0 ? (
        <div className="fleet-empty"><strong>Fleet is idle</strong><span>{idleCount} connected session{idleCount === 1 ? ' is' : 's are'} idle. Show idle sessions to inspect them.</span></div>
      ) : (
        <div className="fleet-grid">
          {entries.map(entry => (
            <div role="button" tabIndex={0} className={`fleet-card state-${entry.state}${entry.attention ? ' attention' : ''}${selectedIds.includes(entry.id) ? ' selected' : ''}`} key={entry.id} data-session-id={entry.id} data-activity-state={entry.state} data-activity-lag-ms={entry.activityLatencyMs ?? ''} onClick={() => onSelectSession(entry.id, entry.session)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) onSelectSession(entry.id, entry.session); }}>
              <span className="fleet-card-top">
                <span className="agent-badge" style={{ color: entry.agent.color, borderColor: entry.agent.color + '55', background: entry.agent.color + '18' }}>
                  {entry.agent.logo ? <img src={entry.agent.logo} alt="" className="agent-badge-logo" /> : entry.agent.abbr}
                </span>
                <span className="fleet-card-identity"><strong>{entry.title}</strong><span>{entry.agent.name}</span></span>
                <span className={`fleet-health ${entry.health}`} title={entry.health} />
                <label className={`fleet-select${entry.canReceiveBroadcast ? '' : ' unavailable'}`} onClick={event => event.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.includes(entry.id)} disabled={!entry.canReceiveBroadcast} onChange={() => toggleBroadcastSelection(entry.id)} aria-label={`Select ${entry.title} for broadcast`} />
                  <span>{entry.canReceiveBroadcast ? 'Select' : 'Unavailable'}</span>
                </label>
              </span>
              <span className="fleet-card-status">
                {entry.working && <NativeActivitySpinner agentType={entry.session?.agent_type} compact animate={false} />}
                <span className={`fleet-state-badge ${entry.state}`}>{entry.stateLabel}</span>
                <strong>{entry.status}</strong>
                {entry.working && <time>{fleetElapsed(entry.activity, nowMs)}</time>}
              </span>
              <span className="fleet-freshness" title="Proxy-to-Fleet delivery time">Activity {entry.freshness}</span>
              {(entry.canControlGoal || entry.goalBlocked || entry.canInterrupt) && <span className="fleet-control-actions" role="group" aria-label={`Controls for ${entry.title}`} onClick={event => event.stopPropagation()}>
                {entry.canControlGoal && <button
                  type="button"
                  onClick={() => onGoalControl(entry.id, entry.goalAction, entry.goal, entry.session)}
                  disabled={!connected || !!goalControlPending?.[entry.id]}
                  aria-label={`${entry.goalAction === 'pause' ? 'Pause' : entry.goalBlocked ? 'Resume blocked' : 'Resume'} goal for ${entry.title}`}
                  title={entry.goalBlocked ? entry.goalBlockedReason : undefined}
                >
                  {goalControlPending?.[entry.id]
                    ? (entry.goalAction === 'pause' ? 'Pausing...' : 'Resuming...')
                    : (entry.goalAction === 'pause' ? 'Pause goal' : entry.goalBlocked ? 'Resume blocked goal' : 'Resume goal')}
                </button>}
                {entry.goalBlocked && !entry.canControlGoal && <button
                  type="button"
                  disabled
                  aria-label={`Goal blocked for ${entry.title}; resolve in the native session`}
                  title={entry.goalBlockedReason || 'No verified native unblock action is available'}
                >Goal blocked · native action required</button>}
                {entry.canInterrupt && <button
                  type="button"
                  className="danger"
                  onClick={() => onInterrupt(entry.id, entry.session)}
                  disabled={!connected || !!stopPending?.[entry.id]}
                  aria-label={`Interrupt turn for ${entry.title}`}
                >{stopPending?.[entry.id] ? 'Interrupting...' : 'Interrupt turn'}</button>}
              </span>}
              {entry.session?.agent_type === 'codex_cli' && entry.config?.config_semantics === 'observed_and_next_send' && (
                <span className="fleet-freshness" title="Native observation and pending next-send override">
                  Observed {entry.config.observed_model_id || 'unknown'} / {entry.config.observed_effort || 'unknown'}
                  {' · '}Next {entry.config.next_send_model_id || 'unset'} / {entry.config.next_send_effort || 'unset'}
                </span>
              )}
              <span
                className={`fleet-work-context kind-${entry.workContext.kind}`}
                aria-label={`${entry.workContext.label}: ${entry.workContext.text}`}
                data-work-context-kind={entry.workContext.kind}
                data-work-context-source={entry.workContext.source}
              >
                <strong>{entry.workContext.label}</strong>
                <span>{entry.workContext.text}</span>
                {Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total)
                  ? <em>{entry.workContext.completed}/{entry.workContext.total}</em> : null}
              </span>
              {(entry.workContext.kind === 'goal' || entry.progress != null) && <span
                className={`fleet-work-meter kind-${entry.workContext.kind}${entry.progress == null && entry.working ? ' indeterminate' : ''}${entry.working ? '' : ' inactive'}`}
                aria-label={entry.progress == null
                  ? `${entry.workContext.label} ${entry.stateLabel.toLowerCase()}`
                  : Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total)
                    ? `${entry.workContext.label} ${entry.workContext.completed} of ${entry.workContext.total} complete`
                    : `${entry.workContext.label} ${Math.round(entry.progress)}% complete`}
              >
                <span style={entry.progress == null ? undefined : { width: `${entry.progress}%` }} />
              </span>}
              <span className="fleet-snippet">{entry.snippet}</span>
              <span className="fleet-jump" aria-label="Open session">Open session <span className="fleet-jump-chevron" aria-hidden="true">{'\u203A'}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptSearchView({ onBack, onOpenResult }) {
  const [query, setQuery] = React.useState('');
  const [project, setProject] = React.useState('');
  const [harness, setHarness] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [indexReady, setIndexReady] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  async function runSearch(event) {
    event?.preventDefault();
    if (query.trim().length < 2 || loading) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: '50' });
      if (project.trim()) params.set('project', project.trim());
      if (harness.trim()) params.set('harness', harness.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const response = await fetch(`/api/search/messages?${params.toString()}`, { credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Transcript search failed.');
      setResults(Array.isArray(body.results) ? body.results : []);
      setIndexReady(body.index?.ready !== false);
    } catch (searchError) {
      setResults([]);
      setError(searchError?.message || 'Transcript search failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="transcript-search-view" data-testid="transcript-search-view">
      <div className="automations-header transcript-search-header">
        <button className="skills-back" onClick={onBack} title="Back to sessions">←</button>
        <div><h2>Transcript search</h2><p>Search every relay-backed message.</p></div>
      </div>
      <form className="transcript-search-form" onSubmit={runSearch}>
        <label className="transcript-search-query"><span>Search text</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Words from any conversation" maxLength={200} autoFocus /></label>
        <div className="transcript-search-filters">
          <label><span>Project</span><input value={project} onChange={event => setProject(event.target.value)} placeholder="Exact workspace or project" maxLength={300} /></label>
          <label><span>Harness</span><input value={harness} onChange={event => setHarness(event.target.value)} placeholder="e.g. codex_cli" maxLength={80} /></label>
          <label><span>From</span><input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
        </div>
        <button type="submit" className="transcript-search-submit" disabled={query.trim().length < 2 || loading}>{loading ? 'Searching…' : 'Search transcripts'}</button>
      </form>
      {!indexReady && <div className="transcript-search-indexing">Older history is still indexing; current results are partial.</div>}
      {error && <div className="transcript-search-error" role="alert">{error}</div>}
      {!loading && !error && results.length === 0 && query.trim().length >= 2 && <div className="fleet-empty"><strong>No matches</strong><span>Try fewer words or clear a filter.</span></div>}
      <div className="transcript-search-results" aria-live="polite">
        {results.map(result => (
          <button type="button" className="transcript-search-result" key={`${result.session_id}:${result.message_id}`} onClick={() => onOpenResult(result)}>
            <span className="transcript-search-result-top"><strong>{result.workspace_name || result.project_root || result.session_id}</strong><em>{result.agent_type || 'unknown'} · {result.role}</em></span>
            <span className="transcript-search-snippet">{result.snippet || '(empty message)'}</span>
            <span className="transcript-search-result-bottom"><time>{result.matched_at ? new Date(result.matched_at).toLocaleString() : ''}</time><span>Open match ›</span></span>
          </button>
        ))}
      </div>
    </div>
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

class SidebarScrollCoordinator extends React.Component {
  componentDidMount() {
    this.props.finishStructureChange(null);
  }

  getSnapshotBeforeUpdate(previousProps) {
    if (previousProps.structureKey === this.props.structureKey) return null;
    return this.props.prepareStructureChange(previousProps.placements, this.props.placements);
  }

  componentDidUpdate(previousProps, _previousState, snapshot) {
    if (previousProps.structureKey !== this.props.structureKey) {
      this.props.finishStructureChange(snapshot);
    }
  }

  render() {
    return this.props.children;
  }
}

function App() {
  const { sessions, messages, provisionalStreams, historyMeta, historyLoading, connected, connectionHealth, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, errorPrompts, respondToErrorPrompt, interruptSession, controlGoal, agentConfigs, configControlStates, requestAgentConfig, setAgentModel, setAgentEffort, setAgentPermissionMode, setAutoApprovePermissions, setAntigravityMode, setCodexConfig, newThread, openPanel, openNativeWindow, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, sendTerminalInput, terminalOutputs, requestFileChanges, respondToFileChange, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, scheduledSends, scheduleSend, cancelScheduledSend, launchSession, resumeSession, closeSession, activeSessionRef, restoreCachedTranscript, setSessionSubscriptions, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, automationViews, showCodexAutomation, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent, requestHistory, requestHistoryChunk, duplicateProxyAlarms, nightlyValidationFailures, latestAppUpdateValidation, revalidationProgramHealth, providerUsage, providerUsageRefreshReceipt, requestProviderUsageRefresh, setProviderUsageWatching, providerUsageResetReceipt, consumeProviderUsageResetCredit, providerUsageCostDetail, requestProviderUsageCostDetail, hostResources, hostResourceError, hostResourceHistory, hostResourceDetails, hostResourceSubscription, subscribeHostResources, unsubscribeHostResources, requestHostResourceRefresh, semanticNotifications } = useRelay();
  const [activeSession, setActiveSession] = useState(null);
  const subscribeActiveTranscript = React.useCallback(
    listener => subscribeCachedTranscript(activeSession, listener),
    [activeSession],
  );
  const readActiveTranscript = React.useCallback(
    () => getTranscriptSnapshot(activeSession),
    [activeSession],
  );
  const activeTranscriptMessages = React.useSyncExternalStore(
    subscribeActiveTranscript,
    readActiveTranscript,
    readActiveTranscript,
  );
  const [drafts, setDrafts]             = useState({});
  const [draftFiles, setDraftFiles]     = useState({});
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [toast, setToast]               = useState('');
  const [attentionToast, setAttentionToast] = useState(null);
  const [sessionAttention, setSessionAttention] = useState({});
  const [attentionFeedbackPreferences, setAttentionFeedbackPreferences] = useState(NOTIFICATION_PREFERENCE_PENDING);
  const [notificationPreferencesLoaded, setNotificationPreferencesLoaded] = useState(false);
  const attentionToastTimerRef = useRef(null);
  const previousPermissionPromptsRef = useRef({});
  const promptSoundReadyRef = useRef(false);
  const [uploading, setUploading]       = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showSessionManagement, setShowSessionManagement] = useState(false);
  const [showScheduledSend, setShowScheduledSend] = useState(false);
  const [managedSessionId, setManagedSessionId] = useState('');
  const [sessionPreferences, setSessionPreferences] = useState({});
  const [sessionPreferencesLoaded, setSessionPreferencesLoaded] = useState(false);
  const [openSidebarMenuId, setOpenSidebarMenuId] = useState('');
  const [showSettings, setShowSettings]     = useState(false);
  const [showComposerSettings, setShowComposerSettings] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('');
  const [quickSwitcherIndex, setQuickSwitcherIndex] = useState(0);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [revalidationLedgerOpen, setRevalidationLedgerOpen] = useState(false);
  const [stopPending, setStopPending]       = useState({});
  const [goalControlPending, setGoalControlPending] = useState({});
  const [goalCommandNotices, setGoalCommandNotices] = useState({});
  const pendingGoalSlashControlsRef = useRef(new Map());
  const [interruptConfirmSession, setInterruptConfirmSession] = useState(null);
  const interruptConfirmRef = useRef({ sessionId: null, expiresAt: 0 });
  const interruptConfirmTimerRef = useRef(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
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
  const [showUsageDashboard, setShowUsageDashboard] = useState(false);
  const [showHostResourceDashboard, setShowHostResourceDashboard] = useState(false);
  const [showFleetView, setShowFleetView]           = useState(false);
  const [showTranscriptSearch, setShowTranscriptSearch] = useState(false);
  const [transcriptSearchTarget, setTranscriptSearchTarget] = useState(null);
  const [showFileBrowser, setShowFileBrowser]       = useState(false);
  const [fileBrowserPath, setFileBrowserPath]       = useState('.');
  const [viewingFile, setViewingFile]               = useState(null); // { path, content } when viewing a file
  const [transcriptPreview, setTranscriptPreview]   = useState(null);
  const systemBannerRef = useRef(null);
  const [systemBannerHeight, setSystemBannerHeight] = useState(0);
  const quickSwitcherInputRef = useRef(null);
  const [theme, setTheme]                           = useState(() => {
    try { return localStorage.getItem('remote-agent-chat-theme') || 'dark'; } catch { return 'dark'; }
  });
  const [collapsedSessionGroups, setCollapsedSessionGroups] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('remote-agent-chat:collapsed-directories:v1') || '[]');
      return Array.isArray(stored) ? Object.fromEntries(stored.map(key => [String(key), true])) : {};
    } catch {
      return {};
    }
  });
  const [showTestSessions, setShowTestSessions] = useState(() => {
    try { return localStorage.getItem(SHOW_TEST_SESSIONS_STORAGE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHOW_TEST_SESSIONS_STORAGE_KEY, showTestSessions ? '1' : '0'); } catch {}
  }, [showTestSessions]);
  const [sessionGroupAliases] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(GROUP_ALIAS_STORAGE_KEY) || '{}');
      return normalizeGroupAliases(stored);
    } catch {
      return normalizeGroupAliases(DEFAULT_GROUP_ALIASES);
    }
  });
  useEffect(() => {
    try { localStorage.setItem(GROUP_ALIAS_STORAGE_KEY, JSON.stringify(sessionGroupAliases)); } catch {}
  }, [sessionGroupAliases]);
  useEffect(() => {
    fetch('/api/preferences/sessions', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Session settings unavailable')))
      .then(body => {
        setSessionPreferences(body.preferences || {});
        setSessionPreferencesLoaded(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let mounted = true;
    fetch('/api/preferences/notifications', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Notification settings unavailable')))
      .then(body => {
        if (mounted) {
          setAttentionFeedbackPreferences({
            ...NOTIFICATION_PREFERENCE_DEFAULTS,
            ...(body.preferences || {}),
            turn_ready: false,
          });
          setNotificationPreferencesLoaded(true);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!attentionFeedbackPreferences.completion_sound) return undefined;
    const prime = () => primeAttentionAudio();
    document.addEventListener('pointerdown', prime, { once: true });
    document.addEventListener('keydown', prime, { once: true });
    return () => {
      document.removeEventListener('pointerdown', prime);
      document.removeEventListener('keydown', prime);
    };
  }, [attentionFeedbackPreferences.completion_sound]);
  async function saveSessionPreference(sessionId, updates) {
    const response = await fetch(`/api/preferences/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preference: updates }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to save session settings.');
    setSessionPreferences(previous => ({ ...previous, [sessionId]: body.preference }));
    if (body.preference?.archived && activeSession === sessionId) setActiveSession(null);
    return body.preference;
  }
  async function downloadSessionExport(sessionId, format) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export?format=${encodeURIComponent(format)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to export session.');
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    let filename = `session.${format === 'json' ? 'json' : 'md'}`;
    if (encodedName) {
      try { filename = decodeURIComponent(encodedName); } catch {}
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    try {
      const collapsed = Object.keys(collapsedSessionGroups).filter(key => collapsedSessionGroups[key]);
      localStorage.setItem('remote-agent-chat:collapsed-directories:v1', JSON.stringify(collapsed));
    } catch {}
  }, [collapsedSessionGroups]);
  const toggleSessionGroup = React.useCallback((key) => {
    setCollapsedSessionGroups(previous => ({ ...previous, [key]: !previous[key] }));
  }, []);
  const steerMessageRef = useRef(steerMessage);
  useEffect(() => { steerMessageRef.current = steerMessage; }, [steerMessage]);
  const handleTranscriptSteer = React.useCallback((cid, content) => {
    if (!activeSession) return;
    steerMessageRef.current(activeSession, cid, content);
  }, [activeSession]);
  const sendToSessionRef = useRef(sendToSession);
  useEffect(() => { sendToSessionRef.current = sendToSession; }, [sendToSession]);
  const handleTranscriptRetry = React.useCallback((message) => {
    if (!activeSession || !message?._cid) return;
    sendToSessionRef.current(activeSession, message.content, message._cid);
  }, [activeSession]);
  const requestFileContentRef = useRef(requestFileContent);
  useEffect(() => { requestFileContentRef.current = requestFileContent; }, [requestFileContent]);
  const allManagedSessions = React.useMemo(() => [...(sessions || [])].map(session => {
    const id = sessionIdOf(session);
    const preference = sessionPreferences[id];
    if (!preference?.display_name) return session;
    return typeof session === 'object'
      ? { ...session, custom_display_name: preference.display_name }
      : { session_id: id, custom_display_name: preference.display_name };
  }), [sessions, sessionPreferences]);
  const testSessionIds = React.useMemo(() => new Set(
    allManagedSessions.filter(sessionIsTestSession).map(sessionIdOf),
  ), [allManagedSessions]);
  const operatorManagedSessions = React.useMemo(
    () => allManagedSessions.filter(session => !sessionIsTestSession(session)),
    [allManagedSessions],
  );
  const sidebarManagedSessions = showTestSessions ? allManagedSessions : operatorManagedSessions;
  const orderedSessions = React.useMemo(
    () => sidebarManagedSessions.filter(session => !sessionPreferences[sessionIdOf(session)]?.archived),
    [sidebarManagedSessions, sessionPreferences],
  );
  const operatorOrderedSessions = React.useMemo(
    () => operatorManagedSessions.filter(session => !sessionPreferences[sessionIdOf(session)]?.archived),
    [operatorManagedSessions, sessionPreferences],
  );
  const sidebarNowMs = useSidebarFreshnessClock(activities, orderedSessions);
  const sidebarStateOptions = React.useMemo(() => ({
    activities,
    thinking,
    pendingPrompts: permissionPrompts,
    errorPrompts: Object.fromEntries(Object.entries(errorPrompts || {}).filter(([, prompt]) => isBlockingErrorPrompt(prompt))),
    health,
    connected,
    nowMs: sidebarNowMs,
    requireFreshness: true,
  }), [activities, thinking, permissionPrompts, errorPrompts, health, connected, sidebarNowMs]);
  const {
    working: workingSessionCandidates,
    states: sidebarStateBySessionId,
  } = React.useMemo(
    () => partitionSidebarSessionsByWorking(orderedSessions, sidebarStateOptions),
    [orderedSessions, sidebarStateOptions],
  );
  const sidebarListRef = useRef(null);
  const pendingSidebarSortAnchorRef = useRef(null);
  const sidebarInteractionTimerRef = useRef(null);
  const sidebarInteractionEpochRef = useRef(0);
  const sidebarExpectedProgrammaticScrollRef = useRef(null);
  const sidebarExpectedProgrammaticScrollFrameRef = useRef(null);
  const sidebarStructuralTransactionFrameRef = useRef(null);
  const [sidebarStructureLocked, setSidebarStructureLocked] = useState(false);
  const beginSidebarInteraction = React.useCallback(() => {
    if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
    sidebarInteractionTimerRef.current = null;
    setSidebarStructureLocked(true);
  }, []);
  const endSidebarInteraction = React.useCallback((delay = 0) => {
    if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
    sidebarInteractionTimerRef.current = setTimeout(() => {
      sidebarInteractionTimerRef.current = null;
      setSidebarStructureLocked(false);
    }, delay);
  }, []);
  React.useEffect(() => {
    const releasePointer = () => endSidebarInteraction(80);
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
    return () => {
      window.removeEventListener('pointerup', releasePointer, true);
      window.removeEventListener('pointercancel', releasePointer, true);
      if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
      if (sidebarExpectedProgrammaticScrollFrameRef.current) {
        cancelAnimationFrame(sidebarExpectedProgrammaticScrollFrameRef.current);
      }
      if (sidebarStructuralTransactionFrameRef.current) {
        cancelAnimationFrame(sidebarStructuralTransactionFrameRef.current);
      }
    };
  }, [endSidebarInteraction]);
  const {
    sessions: workingSessions,
  } = useStableWorkingSessions(workingSessionCandidates, sidebarStructureLocked);
  const workingSessionIds = React.useMemo(
    () => new Set(workingSessions.map(sessionIdOf)),
    [workingSessions],
  );
  const { pinned: allPinnedSessions } = React.useMemo(
    () => partitionPinnedSessions(orderedSessions, sessionPreferences),
    [orderedSessions, sessionPreferences],
  );
  const pinnedSessionIds = React.useMemo(
    () => new Set(allPinnedSessions.map(sessionIdOf)),
    [allPinnedSessions],
  );
  const recentChatOwnership = React.useMemo(
    () => projectRecentChatOwnership(orderedSessions, { workingSessionIds, pinnedSessionIds }),
    [orderedSessions, workingSessionIds, pinnedSessionIds],
  );
  const recentSessions = recentChatOwnership.recent;
  const recentSessionIds = React.useMemo(
    () => new Set(recentSessions.map(sessionIdOf)),
    [recentSessions],
  );
  const pinnedSessions = recentChatOwnership.pinned;
  const rawSessionGroups = React.useMemo(
    () => groupSessionsByDirectory(recentChatOwnership.remaining, agentConfigs, sessionGroupAliases),
    [recentChatOwnership.remaining, agentConfigs, sessionGroupAliases],
  );
  const workspaceLabelBySessionId = React.useMemo(() => Object.fromEntries(
    groupSessionsByDirectory(orderedSessions, agentConfigs, sessionGroupAliases).flatMap(group => (
      group.sessions.map(session => [sessionIdOf(session), group.label])
    )),
  ), [orderedSessions, agentConfigs, sessionGroupAliases]);
  const sidebarRankOptions = React.useMemo(() => ({
    ...sidebarStateOptions,
    messages,
    rankWorking: false,
  }), [sidebarStateOptions, messages]);
  const {
    groups: stableSessionGroups,
    orderChanged: sidebarOrderChanged,
    sortNow: sortSidebarNow,
  } = useStableSidebarGroups(rawSessionGroups, sidebarRankOptions, sidebarStructureLocked);
  const sessionGroups = React.useMemo(
    () => stableSessionGroups.filter(group => group.sessions.length > 0),
    [stableSessionGroups],
  );
  const workspaceOwnedSessionIds = React.useMemo(
    () => new Set(sessionGroups.flatMap(group => group.sessions.map(sessionIdOf))),
    [sessionGroups],
  );
  const applySidebarSortNow = React.useCallback(() => {
    const list = sidebarListRef.current;
    const selectedCard = activeSession
      ? list?.querySelector(`[data-session-id="${CSS.escape(activeSession)}"]`)
      : null;
    pendingSidebarSortAnchorRef.current = selectedCard ? {
      sessionId: activeSession,
      top: selectedCard.getBoundingClientRect().top,
    } : null;
    sortSidebarNow();
  }, [activeSession, sortSidebarNow]);
  const normalizedSidebarSearchQuery = sidebarSearchQuery.trim().toLowerCase();
  const sidebarSearchTextBySessionId = React.useMemo(() => Object.fromEntries(
    orderedSessions.map(session => {
      const id = sessionIdOf(session);
      const agent = sessionAgent(session, agentConfigs[id]);
      return [id, [
        sidebarChatTitle(session, id, agentConfigs[id], messages[id] || []),
        sessionSubLabel(session, id, agentConfigs[id]),
        workspaceLabelBySessionId[id] || 'Unscoped',
        sessionPreferences[id]?.pinned ? 'Pinned' : '',
        agent.name,
        session?.agent_type,
        session?.workspace_name,
        session?.workspace_path,
        id,
      ].filter(Boolean).join(' ').toLowerCase()];
    }),
  ), [orderedSessions, agentConfigs, messages, workspaceLabelBySessionId, sessionPreferences]);
  const filterSidebarSessions = React.useCallback(sessionList => (
    normalizedSidebarSearchQuery
      ? sessionList.filter(session => (
        sidebarSearchTextBySessionId[sessionIdOf(session)] || ''
      ).includes(normalizedSidebarSearchQuery))
      : sessionList
  ), [normalizedSidebarSearchQuery, sidebarSearchTextBySessionId]);
  const displayedWorkingSessions = React.useMemo(
    () => filterSidebarSessions(workingSessions),
    [filterSidebarSessions, workingSessions],
  );
  const displayedRecentSessions = React.useMemo(
    () => filterSidebarSessions(recentSessions),
    [filterSidebarSessions, recentSessions],
  );
  const displayedPinnedSessions = React.useMemo(
    () => filterSidebarSessions(pinnedSessions),
    [filterSidebarSessions, pinnedSessions],
  );
  const displayedSessionGroups = React.useMemo(() => sessionGroups.map(group => ({
    ...group,
    sessions: filterSidebarSessions(group.sessions),
  })).filter(group => group.sessions.length > 0), [filterSidebarSessions, sessionGroups]);
  const sidebarDisplaySessions = React.useMemo(
    () => [...workingSessions, ...recentSessions, ...pinnedSessions, ...sessionGroups.flatMap(group => group.sessions)],
    [workingSessions, recentSessions, pinnedSessions, sessionGroups],
  );
  const sidebarPortalSessions = React.useMemo(() => {
    const seen = new Set();
    return orderedSessions.filter(session => {
      const id = sessionIdOf(session);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [orderedSessions]);
  const sidebarPortalSessionIds = React.useMemo(
    () => new Set(sidebarPortalSessions.map(sessionIdOf)),
    [sidebarPortalSessions],
  );
  const sidebarPlacementBySessionId = React.useMemo(() => {
    const placements = new Map();
    const claim = (sessions, placement) => {
      for (const session of sessions) {
        const id = sessionIdOf(session);
        if (id && !placements.has(id)) placements.set(id, placement);
      }
    };
    claim(workingSessions, 'working');
    claim(recentSessions, 'recent');
    claim(pinnedSessions, 'pinned');
    for (const group of sessionGroups) claim(group.sessions, `workspace:${group.key}`);
    return placements;
  }, [workingSessions, recentSessions, pinnedSessions, sessionGroups]);
  const sidebarStructureKey = React.useMemo(() => [
    `working:${workingSessions.map(sessionIdOf).join(',')}`,
    `recent:${recentSessions.map(sessionIdOf).join(',')}`,
    `pinned:${pinnedSessions.map(sessionIdOf).join(',')}`,
    ...sessionGroups.map(group => `${group.key}:${group.sessions.map(sessionIdOf).join(',')}`),
    `collapsed:${Object.keys(collapsedSessionGroups).filter(key => collapsedSessionGroups[key]).sort().join(',')}`,
    `filter:${normalizedSidebarSearchQuery}`,
  ].join('|'), [
    workingSessions,
    recentSessions,
    pinnedSessions,
    sessionGroups,
    collapsedSessionGroups,
    normalizedSidebarSearchQuery,
  ]);
  const sidebarCardHostsRef = useRef(new Map());
  const sidebarCardPoolRef = useRef(null);
  const prepareSidebarStructureChange = React.useCallback((previousPlacements, nextPlacements) => {
    const list = sidebarListRef.current;
    if (!list) return null;
    if (sidebarStructuralTransactionFrameRef.current) {
      cancelAnimationFrame(sidebarStructuralTransactionFrameRef.current);
      sidebarStructuralTransactionFrameRef.current = null;
    }
    list.classList.add('sidebar-structural-transaction');
    const activeElement = document.activeElement;
    const activeHost = activeElement instanceof Element
      ? activeElement.closest('[data-sidebar-card-host]')
      : null;
    const listRect = list.getBoundingClientRect();
    const cards = Array.from(list.querySelectorAll('[data-session-id]'));
    const focusedCard = activeElement instanceof Element
      ? activeElement.closest('[data-session-id]')
      : null;
    const visibleCards = cards.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > listRect.top && rect.top < listRect.bottom;
    });
    const focusedCardIsVisible = focusedCard && visibleCards.includes(focusedCard);
    const anchorCards = [
      ...(focusedCardIsVisible ? [focusedCard] : []),
      ...visibleCards.filter(card => card !== focusedCard),
    ];
    const anchorCandidates = anchorCards.map(card => ({
      sessionId: card.dataset.sessionId,
      top: card.getBoundingClientRect().top,
    }));
    const capturedScrollTop = list.scrollTop;
    const changedHosts = [];
    for (const [id, previousPlacement] of previousPlacements) {
      const nextPlacement = nextPlacements.get(id);
      if (!nextPlacement || nextPlacement === previousPlacement) continue;
      const host = sidebarCardHostsRef.current.get(id);
      if (host) changedHosts.push(host);
    }
    if (changedHosts.length > 0) {
      let pool = sidebarCardPoolRef.current;
      if (!pool) {
        pool = document.createElement('div');
        pool.setAttribute('data-sidebar-card-pool', '');
        Object.assign(pool.style, {
          position: 'fixed',
          left: '-10000px',
          top: '-10000px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          pointerEvents: 'none',
        });
        document.body.appendChild(pool);
        sidebarCardPoolRef.current = pool;
      }
      for (const host of changedHosts) {
        const slot = host.closest('[data-sidebar-card-slot]');
        if (slot) {
          const card = host.querySelector('[data-session-id]');
          const cardStyle = card ? getComputedStyle(card) : null;
          const height = card ? card.getBoundingClientRect().height
            + (Number.parseFloat(cardStyle?.marginTop) || 0)
            + (Number.parseFloat(cardStyle?.marginBottom) || 0) : 0;
          slot.style.display = 'block';
          slot.style.height = `${height}px`;
          slot.setAttribute('data-sidebar-card-placeholder', '');
        }
        pool.appendChild(host);
      }
    }
    if (activeHost && activeElement?.isConnected && document.activeElement !== activeElement) {
      activeElement.focus({ preventScroll: true });
    }
    return {
      candidates: anchorCandidates,
      scrollTop: capturedScrollTop,
      interactionEpoch: sidebarInteractionEpochRef.current,
      focusedElement: activeHost ? activeElement : null,
      focusedHost: activeHost,
      movedHostCount: changedHosts.length,
    };
  }, []);
  const finishSidebarStructureChange = React.useCallback((snapshot) => {
    const list = sidebarListRef.current;
    if (!list) return;
    const focusedElement = snapshot?.focusedElement || document.activeElement;
    const focusedHost = snapshot?.focusedHost || (focusedElement instanceof Element
      ? focusedElement.closest('[data-sidebar-card-host]')
      : null);
    const retainedIds = new Set();
    for (const slot of list.querySelectorAll('[data-sidebar-card-slot]')) {
      const id = slot.getAttribute('data-sidebar-card-slot') || '';
      const host = sidebarCardHostsRef.current.get(id);
      if (!id || !host) continue;
      retainedIds.add(id);
      if (host.parentElement !== slot) {
        const restoreExactFocus = focusedHost === host && focusedElement?.isConnected;
        slot.appendChild(host);
        if (restoreExactFocus && document.activeElement !== focusedElement && focusedElement.isConnected) {
          focusedElement.focus({ preventScroll: true });
        }
      }
    }
    const explicitSortAnchor = pendingSidebarSortAnchorRef.current;
    const pendingAnchor = explicitSortAnchor
      ? { candidates: [explicitSortAnchor], scrollTop: list.scrollTop, interactionEpoch: sidebarInteractionEpochRef.current }
      : snapshot;
    if (pendingAnchor && pendingAnchor.interactionEpoch === sidebarInteractionEpochRef.current) {
      const candidates = Array.isArray(pendingAnchor.candidates) ? pendingAnchor.candidates : [];
      const survivingAnchor = candidates.map(candidate => ({
        ...candidate,
        card: Array.from(list.querySelectorAll('[data-session-id]'))
          .find(node => node.dataset.sessionId === candidate.sessionId),
      })).find(candidate => candidate.card);
      let targetScrollTop = null;
      let anchorSessionId = null;
      if (survivingAnchor) {
        const delta = survivingAnchor.card.getBoundingClientRect().top - survivingAnchor.top;
        if (Math.abs(delta) > 0.5) targetScrollTop = list.scrollTop + delta;
        anchorSessionId = survivingAnchor.sessionId;
      } else if (Number.isFinite(pendingAnchor.scrollTop)) {
        targetScrollTop = pendingAnchor.scrollTop;
      }
      if (targetScrollTop != null) {
        const clampedTarget = Math.max(0, Math.min(
          targetScrollTop,
          Math.max(0, list.scrollHeight - list.clientHeight),
        ));
        if (Math.abs(list.scrollTop - clampedTarget) > 0.5) {
          const from = list.scrollTop;
          sidebarExpectedProgrammaticScrollRef.current = { target: clampedTarget };
          list.scrollTop = clampedTarget;
          list.dispatchEvent(new CustomEvent('rac-sidebar-scroll-correction', {
            detail: { from, to: list.scrollTop, anchorSessionId, explicitSort: !!explicitSortAnchor },
          }));
          if (sidebarExpectedProgrammaticScrollFrameRef.current) {
            cancelAnimationFrame(sidebarExpectedProgrammaticScrollFrameRef.current);
          }
          sidebarExpectedProgrammaticScrollFrameRef.current = requestAnimationFrame(() => {
            sidebarExpectedProgrammaticScrollRef.current = null;
            sidebarExpectedProgrammaticScrollFrameRef.current = null;
          });
        }
      }
    }
    pendingSidebarSortAnchorRef.current = null;
    for (const [id, host] of sidebarCardHostsRef.current) {
      if (retainedIds.has(id) || sidebarPortalSessionIds.has(id)) continue;
      host.remove();
      sidebarCardHostsRef.current.delete(id);
    }
    if (snapshot?.focusedElement?.isConnected
        && document.activeElement !== snapshot.focusedElement) {
      snapshot.focusedElement.focus({ preventScroll: true });
    }
    sidebarStructuralTransactionFrameRef.current = requestAnimationFrame(() => {
      sidebarStructuralTransactionFrameRef.current = requestAnimationFrame(() => {
        list.classList.remove('sidebar-structural-transaction');
        sidebarStructuralTransactionFrameRef.current = null;
      });
    });
  }, [sidebarPortalSessionIds]);
  useEffect(() => () => {
    for (const host of sidebarCardHostsRef.current.values()) host.remove();
    sidebarCardHostsRef.current.clear();
    sidebarCardPoolRef.current?.remove();
    sidebarCardPoolRef.current = null;
    pendingSidebarSortAnchorRef.current = null;
  }, []);
  const summarizeSidebarSessions = React.useCallback(sessionList => sessionList.reduce((result, session) => {
    const id = sessionIdOf(session);
    result.unread += testSessionIds.has(id) ? 0 : unread[id] || 0;
    result.hasPrompt = result.hasPrompt || !!permissionPrompts[id] || !!isBlockingErrorPrompt(errorPrompts[id]);
    result.working = result.working || fleetStateIsWorking(sidebarStateBySessionId[id]);
    return result;
  }, { unread: 0, hasPrompt: false, working: false }), [
    testSessionIds, unread, permissionPrompts, errorPrompts, sidebarStateBySessionId,
  ]);
  const workingSessionSummary = React.useMemo(
    () => summarizeSidebarSessions(displayedWorkingSessions),
    [summarizeSidebarSessions, displayedWorkingSessions],
  );
  const recentSessionSummary = React.useMemo(
    () => summarizeSidebarSessions(displayedRecentSessions),
    [summarizeSidebarSessions, displayedRecentSessions],
  );
  const pinnedSessionSummary = React.useMemo(
    () => summarizeSidebarSessions(displayedPinnedSessions),
    [summarizeSidebarSessions, displayedPinnedSessions],
  );
  const quickSwitcherItems = React.useMemo(() => sidebarDisplaySessions.map(session => {
      const id = sessionIdOf(session);
      const agent = sessionAgent(session, agentConfigs[id]);
      const title = sidebarChatTitle(session, id, agentConfigs[id], messages[id] || []);
      const subtitle = sessionSubLabel(session, id, agentConfigs[id]);
      const groupLabel = workspaceLabelBySessionId[id] || 'Unscoped';
      const searchFields = [
        title,
        subtitle,
        groupLabel,
        sessionPreferences[id]?.pinned ? 'Pinned' : '',
        agent.name,
        session?.agent_type,
        session?.workspace_name,
        session?.workspace_path,
        id,
      ].filter(Boolean);
      return {
        id,
        session,
        groupLabel,
        title,
        subtitle,
        agentName: agent.name,
        agentColor: agent.color,
        working: fleetStateIsWorking(sidebarStateBySessionId[id]),
        searchFields,
        searchText: searchFields.join(' '),
      };
    }), [sidebarDisplaySessions, workspaceLabelBySessionId, sessionPreferences, agentConfigs, messages, sidebarStateBySessionId]);
  const quickSwitcherResults = React.useMemo(
    () => rankQuickSwitcherItems(quickSwitcherItems, quickSwitcherQuery).slice(0, 60),
    [quickSwitcherItems, quickSwitcherQuery],
  );
  useEffect(() => {
    setQuickSwitcherIndex(index => Math.max(0, Math.min(index, quickSwitcherResults.length - 1)));
  }, [quickSwitcherResults.length]);
  useEffect(() => {
    if (!quickSwitcherOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      quickSwitcherInputRef.current?.focus();
      quickSwitcherInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [quickSwitcherOpen]);
  useEffect(() => {
    if (!quickSwitcherOpen) return;
    document.getElementById(`quick-switcher-option-${quickSwitcherIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [quickSwitcherIndex, quickSwitcherOpen]);
  useEffect(() => {
    const closeQuickSwitcher = () => {
      setQuickSwitcherOpen(false);
      setQuickSwitcherQuery('');
      setQuickSwitcherIndex(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const chooseItem = (item) => {
      if (!item) return;
      selectSession(item.id, item.session);
      setSidebarOpen(false);
      closeQuickSwitcher();
    };
    const onGlobalShortcut = (event) => {
      const key = safeString(event.key).toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === 'p') {
        event.preventDefault();
        setShortcutHelpOpen(false);
        setQuickSwitcherOpen(true);
        return;
      }
      if (quickSwitcherOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeQuickSwitcher();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          setQuickSwitcherIndex(index => quickSwitcherResults.length ? (index + 1) % quickSwitcherResults.length : 0);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setQuickSwitcherIndex(index => quickSwitcherResults.length ? (index - 1 + quickSwitcherResults.length) % quickSwitcherResults.length : 0);
        } else if (event.key === 'Enter' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          chooseItem(quickSwitcherResults[quickSwitcherIndex] || quickSwitcherResults[0]);
        }
        return;
      }
      if (shortcutHelpOpen) {
        if (event.key === 'Escape' || (event.key === '?' && !isEditableShortcutTarget(event.target))) {
          event.preventDefault();
          setShortcutHelpOpen(false);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (quickSwitcherItems.length === 0) return;
        event.preventDefault();
        const currentIndex = quickSwitcherItems.findIndex(item => item.id === activeSession);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const fallback = direction > 0 ? -1 : 0;
        const nextIndex = (Math.max(currentIndex, fallback) + direction + quickSwitcherItems.length) % quickSwitcherItems.length;
        chooseItem(quickSwitcherItems[nextIndex]);
        return;
      }
      if (event.key === '?' && !event.altKey && !event.ctrlKey && !event.metaKey && !isEditableShortcutTarget(event.target)) {
        event.preventDefault();
        setShortcutHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onGlobalShortcut);
    return () => window.removeEventListener('keydown', onGlobalShortcut);
  }, [activeSession, quickSwitcherIndex, quickSwitcherItems, quickSwitcherOpen, quickSwitcherResults, shortcutHelpOpen]);
  const activeSessionMeta = React.useMemo(
    () => orderedSessions.find(s => sessionIdOf(s) === activeSession),
    [orderedSessions, activeSession],
  );
  const activeMessagesForScroll = activeSession ? activeTranscriptMessages : EMPTY_MESSAGES;
  const activeProvisionalStream = activeSession ? (provisionalStreams[activeSession] || null) : null;
  const activeNativeCliPlaceholder = shouldRefreshNativeCliPlaceholder(activeSessionMeta, activeMessagesForScroll);
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
      activeProvisionalStream?.messageId || '',
      activeProvisionalStream?.content?.length || 0,
      activeProvisionalStream?.open ? 'open' : 'closed',
    ].join('\u0001');
  }, [
    activeActivityForScroll,
    activeThinkingForScroll,
    activePermissionPromptForScroll,
    activeErrorPromptForScroll,
    activeProvisionalStream,
  ]);
  const activeTranscriptArrival = {
    sessionId: activeSession,
    messageCount: activeMessagesForScroll.length,
    provisionalId: activeProvisionalStream?.messageId || '',
    provisionalLength: activeProvisionalStream?.content?.length || 0,
  };
  const messagesEndRef  = useRef(null);
  const messagesListRef = useRef(null);
  const isAtBottom      = useRef(true);   // updated by scroll listener before DOM changes
  const stickyToNewestRef = useRef(true); // false only after an intentional user scroll away from newest
  const userScrollIntentUntilRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const scrollPinGenerationRef = useRef(0);
  const pinnedToNewestUntilRef = useRef(0);
  const requestOlderHistoryRef = useRef(null);
  const nonWindowedPrependAnchorRef = useRef(null);
  const blockingPromptScrollKeyRef = useRef('');
  const selectedSessionRef = useRef(activeSession);
  const scrollSnapshotRef = useRef({
    sessionId: null,
    keys: [],
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    atBottom: true,
  });
  const routeScrollSnapshotRef = useRef(null);
  const routeScrollRestoreFrameRef = useRef(0);
  const textareaRef     = useRef(null);
  const fileInputRef    = useRef(null);
  const transcriptArrivalRef = useRef(activeTranscriptArrival);
  const jumpBaselineRef = useRef(activeTranscriptArrival);
  const sendHistoryRef = useRef({});
  const sendHistoryCursorRef = useRef({ sessionId: null, index: 0, scratch: '' });
  const prevConnected   = useRef(connected);
  const pendingAttachmentReqs = useRef({});
  const seenAttachmentResults = useRef({});
  transcriptArrivalRef.current = activeTranscriptArrival;

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
      const requestedId = new URLSearchParams(window.location.search).get('session');
      const requested = requestedId
        ? orderedSessions.find(session => sessionIdOf(session) === requestedId)
        : null;
      const selected = requested || orderedSessions[0];
      const id = sessionIdOf(selected);
      if (id) {
        selectSession(id, selected);
        if (requested) window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [orderedSessions, activeSession]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const handlePushClick = event => {
      if (event.data?.type !== 'push_notification_clicked') return;
      const requestedId = event.data.data?.session_id;
      const requested = orderedSessions.find(session => sessionIdOf(session) === requestedId);
      if (requestedId && requested) selectSession(requestedId, requested);
    };
    navigator.serviceWorker.addEventListener('message', handlePushClick);
    return () => navigator.serviceWorker.removeEventListener('message', handlePushClick);
  }, [orderedSessions]);

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
      // A real wheel/touch/scrollbar gesture must take precedence immediately,
      // even if it lands during the short guard for our previous auto-scroll.
      programmaticScrollUntilRef.current = 0;
      scrollPinGenerationRef.current += 1;
      if (stickyToNewestRef.current) {
        jumpBaselineRef.current = transcriptArrivalRef.current;
        setNewMessagesBelow(0);
      }
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
      if (userInitiated && !programmatic && list.scrollTop < 160) {
        requestOlderHistoryRef.current?.();
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
  }, [activeSession]); // the keyed transcript element is replaced on session switches

  function stickTranscriptToNewest(keys, frameCount = 2) {
    const sessionAtStart = activeSession;
    const pinGeneration = scrollPinGenerationRef.current + 1;
    scrollPinGenerationRef.current = pinGeneration;
    const apply = () => {
      const list = messagesListRef.current;
      if (!list
        || selectedSessionRef.current !== sessionAtStart
        || scrollPinGenerationRef.current !== pinGeneration) return false;
      programmaticScrollUntilRef.current = Date.now() + 800;
      stickyToNewestRef.current = true;
      jumpBaselineRef.current = transcriptArrivalRef.current;
      setScrollTopInstant(list, list.scrollHeight);
      isAtBottom.current = true;
      setShowJumpButton(false);
      setNewMessagesBelow(0);
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
    const keys = scrollIdentityKeysForMessages(activeMessagesForScroll);
    pinnedToNewestUntilRef.current = Date.now() + 5000;
    stickTranscriptToNewest(keys, 4);
  }

  // Keep transcript hydration visually stable. Tail chunks should land at the
  // bottom, but older backfill chunks are prepended above the viewport; preserve
  // the current anchor by adding the rendered height delta to scrollTop.
  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const keys = scrollIdentityKeysForMessages(activeMessagesForScroll);
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
    } else if (olderPrepended) {
      stickyToNewestRef.current = false;
      pinnedToNewestUntilRef.current = 0;
      if (list.dataset.transcriptWindowed !== 'true') {
        const heightDelta = list.scrollHeight - (Number(prev.scrollHeight) || 0);
        programmaticScrollUntilRef.current = Date.now() + 500;
        setScrollTopInstant(list, Math.max(0, (Number(prev.scrollTop) || 0) + heightDelta));
        const anchor = nonWindowedPrependAnchorRef.current;
        const anchorRow = anchor
          ? Array.from(list.querySelectorAll('.message[data-message-key]'))
              .find(row => row.dataset.messageKey === anchor.messageKey)
          : null;
        if (anchorRow) {
          const currentViewportTop = anchorRow.getBoundingClientRect().top;
          const correction = currentViewportTop - anchor.viewportTop;
          if (Math.abs(correction) >= 0.5) {
            setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
          }
        }
        nonWindowedPrependAnchorRef.current = null;
      }
    } else if (wasAtBottom) {
      stickTranscriptToNewest(keys, 3);
    }

    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    isAtBottom.current = atBottom;
    setShowJumpButton(!atBottom && !stickyToNewestRef.current);
    setNewMessagesBelow(atBottom || stickyToNewestRef.current
      ? 0
      : countTranscriptArrivalsSince(jumpBaselineRef.current, activeTranscriptArrival));
    scrollSnapshotRef.current = {
      sessionId: activeSession,
      keys,
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      atBottom: atBottom || stickyToNewestRef.current,
    };
  }, [activeSession, activeMessagesForScroll, activeLiveScrollVersion]);

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

  useEffect(() => {
    const completedStops = Object.entries(stopPending)
      .filter(([, requestId]) => controlResults[requestId]);
    const completedGoals = Object.entries(goalControlPending)
      .filter(([, requestId]) => controlResults[requestId]);
    if (completedStops.length > 0) {
      const completedIds = new Set(completedStops.map(([sessionId]) => sessionId));
      setStopPending(previous => Object.fromEntries(
        Object.entries(previous).filter(([sessionId]) => !completedIds.has(sessionId)),
      ));
    }
    if (completedGoals.length > 0) {
      const completedIds = new Set(completedGoals.map(([sessionId]) => sessionId));
      setGoalControlPending(previous => Object.fromEntries(
        Object.entries(previous).filter(([sessionId]) => !completedIds.has(sessionId)),
      ));
      for (const [sessionId, requestId] of completedGoals) {
        const pending = pendingGoalSlashControlsRef.current.get(requestId);
        if (!pending) continue;
        const result = controlResults[requestId];
        pendingGoalSlashControlsRef.current.delete(requestId);
        if (result?.result === 'ok') {
          setDraftForSession(sessionId, current => (
            String(current || '').trim().toLowerCase() === pending.command ? '' : current
          ));
          setGoalCommandNotices(previous => ({
            ...previous,
            [sessionId]: {
              status: 'success',
              requestId,
              text: pending.action === 'pause' ? 'Goal paused' : 'Goal resumed',
            },
          }));
          showToast(pending.action === 'pause' ? 'Goal paused' : 'Goal resumed');
        } else {
          const detail = result?.error?.message || 'Native goal control did not apply.';
          setGoalCommandNotices(previous => ({
            ...previous,
            [sessionId]: {
              status: 'failed', requestId, text: `${detail} Command retained; press Send to retry.`,
            },
          }));
        }
      }
    }
    const failure = [...completedStops, ...completedGoals]
      .map(([, requestId]) => controlResults[requestId])
      .find(receipt => receipt?.result === 'failed');
    if (failure) showToast(failure.error?.message || (
      failure.command === 'agent_interrupt' ? 'Interrupt did not apply' : 'Goal control did not apply'
    ));
  }, [controlResults, stopPending, goalControlPending]);

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

  function attentionSessionLabel(sessionId) {
    const session = orderedSessions.find(item => sessionIdOf(item) === sessionId);
    return session
      ? sidebarChatTitle(session, sessionId, agentConfigs[sessionId], messages[sessionId] || [])
      : sessionId;
  }

  function showAttentionToast(sessionId, kind, title, detail = '') {
    if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
    setAttentionToast({
      sessionId,
      kind,
      title,
      detail: detail || attentionSessionLabel(sessionId),
    });
    attentionToastTimerRef.current = setTimeout(() => {
      attentionToastTimerRef.current = null;
      setAttentionToast(null);
    }, 8000);
  }

  function clearAttentionToast() {
    if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
    attentionToastTimerRef.current = null;
    setAttentionToast(null);
  }

  useEffect(() => () => {
    if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
  }, []);

  useEffect(() => {
    const previous = previousPermissionPromptsRef.current;
    const current = permissionPrompts || {};
    const resolvedSessionIds = Object.keys(previous).filter(sessionId => !current[sessionId]);
    if (resolvedSessionIds.length > 0) {
      setSessionAttention(existing => {
        const next = { ...existing };
        resolvedSessionIds.forEach(sessionId => {
          if (next[sessionId]?.kind === 'prompt') delete next[sessionId];
        });
        return next;
      });
      setAttentionToast(existing => (
        existing?.kind === 'prompt' && resolvedSessionIds.includes(existing.sessionId) ? null : existing
      ));
    }
    Object.entries(current).forEach(([sessionId, prompt]) => {
      const promptId = prompt?.prompt_id || prompt?.request_id || prompt?.id || 'prompt';
      const previousPrompt = previous[sessionId];
      const previousPromptId = previousPrompt?.prompt_id || previousPrompt?.request_id || previousPrompt?.id || null;
      if (promptId === previousPromptId) return;
      if (
        promptSoundReadyRef.current
        && attentionFeedbackPreferences.completion_sound
        && attentionEventIsUnfocused(sessionId, activeSession)
      ) {
        playAttentionSound('prompt');
      }
      if (sessionId === activeSession) return;
      const title = prompt?.type === 'question_prompt' || prompt?.kind === 'question'
        ? 'Question needs an answer'
        : 'Permission needs attention';
      setSessionAttention(existing => ({
        ...existing,
        [sessionId]: { kind: 'prompt', promptId },
      }));
      showAttentionToast(sessionId, 'prompt', title);
    });
    previousPermissionPromptsRef.current = current;
    promptSoundReadyRef.current = true;
  }, [permissionPrompts, activeSession, attentionFeedbackPreferences.completion_sound]);

  useEffect(() => {
    if (!activeSession || attentionToast?.sessionId !== activeSession) return;
    if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
    attentionToastTimerRef.current = null;
    setAttentionToast(null);
  }, [activeSession, attentionToast?.sessionId]);

  useEffect(() => {
    if (!notificationPreferencesLoaded || !sessionPreferencesLoaded) return undefined;
    let cancelled = false;
    async function processSemanticNotifications() {
      for (const event of semanticNotifications || []) {
        const sessionId = event.session_id || event.session;
        if (!semanticNotificationAllowed(event, attentionFeedbackPreferences)) {
          recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'client_preference' });
          continue;
        }
        if (sessionPreferences[sessionId]?.muted) {
          recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'session_muted' });
          continue;
        }
        if (!attentionEventIsUnfocused(sessionId, activeSession)) {
          recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'focused_session' });
          continue;
        }
        const claimed = await claimSemanticNotification(event);
        if (cancelled) continue;
        if (!claimed) {
          recordSemanticNotificationStage(event, 'suppressed', { reasonCode: 'client_duplicate' });
          continue;
        }
        recordSemanticNotificationStage(event, 'claimed');
        const kind = event.event_type;
        if (attentionFeedbackPreferences.completion_sound) {
          playAttentionSound(kind === 'goal_attention' || kind === 'provider_usage_threshold' ? 'prompt' : 'completion');
        }
        if (sessionId !== activeSession) {
          setSessionAttention(existing => ({
            ...existing,
            [sessionId]: {
              kind,
              dedupeKey: event.dedupe_key,
              createdAt: event.created_at || new Date().toISOString(),
            },
          }));
        }
        showAttentionToast(sessionId, kind, event.title, event.body);
        const afterPaint = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : callback => setTimeout(callback, 16);
        afterPaint(() => {
          if (!cancelled) recordSemanticNotificationStage(event, 'displayed');
        });
      }
    }
    processSemanticNotifications().catch(() => {});
    return () => { cancelled = true; };
  }, [semanticNotifications, activeSession, sessionPreferences, attentionFeedbackPreferences,
    notificationPreferencesLoaded, sessionPreferencesLoaded]);

  function setDraftForSession(sessionId, value) {
    if (!sessionId) return;
    setDrafts(prev => ({
      ...prev,
      [sessionId]: typeof value === 'function' ? value(prev[sessionId] || '') : value,
    }));
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
    const agentType = sessionMeta?.agent_type;
    return {
      limit: historyLimitForAgentType(agentType),
      ...((agentType === 'codex_cli' || agentType === 'cursor_cli')
        ? { chunkBytes: CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES }
        : {}),
    };
  }

  function historyRequestOptionsForSessionId(sessionId) {
    const meta = orderedSessions.find(session => sessionIdOf(session) === sessionId);
    return historyRequestOptionsFor(meta);
  }

  function selectSession(id, sessionMeta) {
    const reselectingActiveSession = activeSessionRef.current === id;
    restoreCachedTranscript(id);
    setActiveSession(id);
    activeSessionRef.current = id;
    sendHistoryCursorRef.current = {
      sessionId: id,
      index: (sendHistoryRef.current[id] || []).length,
      scratch: '',
    };
    setUnread(prev => ({ ...prev, [id]: 0 }));
    setSessionAttention(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (attentionToast?.sessionId === id) clearAttentionToast();
    setSidebarOpen(false);
    setShowSlashMenu(false);
    setShowChatList(false);
    setShowThreadList(false);
    setShowTranscriptSearch(false);
    // A changed activeSession reconciles in the effect below. Re-selecting the
    // current card still needs an explicit refresh because React will not rerun it.
    if (reselectingActiveSession) {
      setTimeout(() => requestHistory(id, historyRequestOptionsFor(sessionMeta)), 0);
    }
  }

  function openTranscriptSearchResult(result) {
    const id = result?.session_id;
    const messageId = Number(result?.message_id);
    if (!id || !Number.isSafeInteger(messageId) || messageId <= 0) return;
    const sessionMeta = orderedSessions.find(session => sessionIdOf(session) === id) || {
      session_id: id,
      workspace_path: result.workspace_path || null,
      project_root: result.project_root || null,
      workspace_name: result.workspace_name || null,
      agent_type: result.agent_type || null,
      status: 'history',
    };
    transcriptWindow.cancelRouteRestore();
    routeScrollSnapshotRef.current = null;
    setTranscriptSearchTarget({ sessionId: id, messageId });
    selectSession(id, sessionMeta);
    setShowTranscriptSearch(false);
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
    if (activeBlockingPrompt) return;
    const currentInput = activeSession ? (drafts[activeSession] || '') : '';
    const attachedFiles = activeSession ? (draftFiles[activeSession] || []) : [];
    const text = currentInput.trim();
    if (!text && attachedFiles.length === 0) return;
    if (!activeSession) return;

    const goalIntent = classifyGoalCommandIntent(currentInput, { attachmentCount: attachedFiles.length });
    if (goalIntent.kind !== 'chat') {
      handleGoalCommandIntent(goalIntent);
      return;
    }

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
    if (text) {
      const previous = sendHistoryRef.current[activeSession] || [];
      const next = previous[previous.length - 1] === text
        ? previous
        : [...previous, text].slice(-100);
      sendHistoryRef.current[activeSession] = next;
      sendHistoryCursorRef.current = { sessionId: activeSession, index: next.length, scratch: '' };
    }
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

  function clearInterruptConfirm() {
    if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
    interruptConfirmTimerRef.current = null;
    interruptConfirmRef.current = { sessionId: null, expiresAt: 0 };
    setInterruptConfirmSession(null);
  }

  function armInterruptConfirm() {
    if (!activeSession) return;
    const expiresAt = Date.now() + 2500;
    interruptConfirmRef.current = { sessionId: activeSession, expiresAt };
    setInterruptConfirmSession(activeSession);
    if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
    interruptConfirmTimerRef.current = setTimeout(() => {
      if (interruptConfirmRef.current.sessionId === activeSession
          && interruptConfirmRef.current.expiresAt === expiresAt) {
        interruptConfirmRef.current = { sessionId: null, expiresAt: 0 };
        interruptConfirmTimerRef.current = null;
        setInterruptConfirmSession(null);
      }
    }, 2500);
  }

  function performInterrupt() {
    if (!activeSession || !thinking[activeSession] || stopPending[activeSession]) {
      clearInterruptConfirm();
      return;
    }
    clearInterruptConfirm();
    requestSessionInterrupt(activeSession, activeSessionMeta);
  }

  function requestSessionInterrupt(sessionId, sessionMeta) {
    if (!sessionId || stopPending[sessionId]) return null;
    const requestId = interruptSession(sessionId, {
      sessionGeneration: sessionMeta?.control_generation,
      turnGeneration: sessionMeta?.turn_generation,
    });
    setStopPending(prev => ({ ...prev, [sessionId]: requestId }));
    return requestId;
  }

  function requestGoalControl(sessionId, action, goal, sessionMeta, options = {}) {
    if (!sessionId || !goal || goalControlPending[sessionId]) return null;
    const requestId = controlGoal(sessionId, action, goal, {
      sessionGeneration: sessionMeta?.control_generation,
      requestId: options.requestId,
    });
    setGoalControlPending(prev => ({ ...prev, [sessionId]: requestId }));
    return requestId;
  }

  function handleGoalCommandIntent(intent) {
    if (!activeSession) return;
    const fail = text => {
      setGoalCommandNotices(previous => ({
        ...previous,
        [activeSession]: { status: 'failed', requestId: null, text },
      }));
      showToast(text);
      setShowSlashMenu(false);
    };
    if (intent.kind === 'unsupported_goal_control') {
      fail('Unsupported goal command. Use /goal resume or /goal pause.');
      return;
    }
    if (!connected) {
      fail('Goal control is offline. Command retained; reconnect and press Send to retry.');
      return;
    }
    if (goalControlPending[activeSession]) {
      fail('A goal control is already applying. Command retained.');
      return;
    }
    const agentType = activeSessionMeta?.agent_type;
    if (!['codex', 'codex-desktop', 'codex_cli'].includes(agentType)
        || activeConfig?.capabilities?.goal_pause_resume !== true
        || !activeGoal?.fingerprint
        || Number(activeSessionMeta?.control_generation) <= 0) {
      fail('This session has no verified native goal control. Command retained.');
      return;
    }
    const satisfied = satisfiedGoalCommandLabel(intent.action, activeGoalState);
    if (satisfied) {
      setDraftForSession(activeSession, '');
      setGoalCommandNotices(previous => ({
        ...previous,
        [activeSession]: { status: 'success', requestId: null, text: satisfied },
      }));
      showToast(satisfied);
      setShowSlashMenu(false);
      return;
    }
    if (intent.action === 'resume' && activeGoalState === 'blocked'
        && activeConfig?.capabilities?.goal_blocked_resume !== true) {
      fail('Blocked-goal resume is not verified for this session. Command retained.');
      return;
    }
    const expectedState = intent.action === 'pause'
      ? activeGoalState === 'active'
      : ['paused', 'blocked'].includes(activeGoalState);
    if (!expectedState) {
      fail(`Goal state is ${activeGoalState || 'unknown'}; refresh before retrying this command.`);
      return;
    }
    const requestId = `goal-slash-${intent.action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingGoalSlashControlsRef.current.set(requestId, {
      action: intent.action,
      command: intent.command,
    });
    setGoalCommandNotices(previous => ({
      ...previous,
      [activeSession]: { status: 'applying', requestId, text: 'Validating goal, then applying native control…' },
    }));
    const sentRequestId = requestGoalControl(activeSession, intent.action, activeGoal, activeSessionMeta, { requestId });
    if (!sentRequestId) {
      pendingGoalSlashControlsRef.current.delete(requestId);
      fail('Goal control could not be queued. Command retained; press Send to retry.');
      return;
    }
    setShowSlashMenu(false);
  }

  useEffect(() => () => {
    if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
  }, []);

  useEffect(() => {
    if (interruptConfirmSession
        && (interruptConfirmSession !== activeSession || !thinking[interruptConfirmSession])) {
      clearInterruptConfirm();
    }
  }, [activeSession, thinking, interruptConfirmSession]);

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      textareaRef.current?.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (showSlashMenu) {
        setShowSlashMenu(false);
        return;
      }
      if (activeBlockingPrompt) return;
      if (isActiveThinking && !isStopPending) {
        e.preventDefault();
        const armed = interruptConfirmRef.current.sessionId === activeSession
          && interruptConfirmRef.current.expiresAt >= Date.now();
        if (armed) performInterrupt();
        else armInterruptConfirm();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey
        && interruptConfirmRef.current.sessionId === activeSession
        && interruptConfirmRef.current.expiresAt >= Date.now()) {
      e.preventDefault();
      performInterrupt();
      return;
    }
    const history = activeSession ? (sendHistoryRef.current[activeSession] || []) : [];
    const historyCursor = sendHistoryCursorRef.current;
    const historyCursorActive = historyCursor.sessionId === activeSession
      && historyCursor.index >= 0
      && historyCursor.index < history.length;
    if (e.key === 'ArrowUp' && history.length > 0 && (currentInput === '' || historyCursorActive)) {
      e.preventDefault();
      const cursor = historyCursor.sessionId === activeSession
        ? historyCursor
        : { sessionId: activeSession, index: history.length, scratch: currentInput };
      cursor.index = Math.max(0, cursor.index - 1);
      sendHistoryCursorRef.current = cursor;
      setDraftForSession(activeSession, history[cursor.index]);
      return;
    }
    if (e.key === 'ArrowDown' && historyCursorActive) {
      e.preventDefault();
      const nextIndex = Math.min(history.length, historyCursor.index + 1);
      sendHistoryCursorRef.current = { ...historyCursor, index: nextIndex };
      setDraftForSession(activeSession, nextIndex === history.length ? historyCursor.scratch : history[nextIndex]);
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
  const resizeComposerTextarea = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maximum = Math.max(42, Math.floor(window.innerHeight * 0.4));
    textarea.style.height = 'auto';
    const nextHeight = Math.max(42, Math.min(textarea.scrollHeight, maximum));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximum ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(() => {
    resizeComposerTextarea();
  }, [activeSession, currentInput, resizeComposerTextarea]);
  useEffect(() => {
    window.addEventListener('resize', resizeComposerTextarea);
    return () => window.removeEventListener('resize', resizeComposerTextarea);
  }, [resizeComposerTextarea]);
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
  const renderedMessages = React.useMemo(() => {
    return currentMessages.filter(msg => hasVisibleMessage(msg));
  }, [currentMessages]);
  const chatRouteActive = !showAutomations
    && !showSkills
    && !showUsageDashboard
    && !showHostResourceDashboard
    && !showFleetView
    && !showTranscriptSearch;
  const transcriptWindow = useTranscriptWindow({
    messages: renderedMessages,
    containerRef: messagesListRef,
    sessionId: activeSession,
    routeActive: chatRouteActive,
  });
  const captureChatRouteScroll = React.useCallback(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    routeScrollSnapshotRef.current = {
      sessionId: activeSession,
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      atBottom,
    };
    transcriptWindow.prepareForRouteChange();
  }, [activeSession, transcriptWindow.prepareForRouteChange]);
  useLayoutEffect(() => {
    if (!chatRouteActive || transcriptWindow.enabled) return undefined;
    const pending = routeScrollSnapshotRef.current;
    const list = messagesListRef.current;
    if (!list || pending?.sessionId !== activeSession) return undefined;
    const restore = () => {
      const activeList = messagesListRef.current;
      if (!activeList || pending.sessionId !== activeSession) return;
      const target = pending.atBottom
        ? activeList.scrollHeight
        : Math.min(pending.scrollTop, Math.max(0, activeList.scrollHeight - activeList.clientHeight));
      programmaticScrollUntilRef.current = Date.now() + 800;
      setScrollTopInstant(activeList, target);
    };
    restore();
    routeScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      routeScrollRestoreFrameRef.current = 0;
      restore();
    });
    return () => {
      if (routeScrollRestoreFrameRef.current) cancelAnimationFrame(routeScrollRestoreFrameRef.current);
      routeScrollRestoreFrameRef.current = 0;
    };
  }, [activeSession, chatRouteActive, transcriptWindow.enabled]);
  useEffect(() => {
    if (!renderProfileEnabled) return undefined;
    window.__RAC_TRANSCRIPT_WINDOW__ = {
      total: renderedMessages.length,
      scrollToIndex: transcriptWindow.scrollToIndex,
    };
    return () => {
      if (window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex === transcriptWindow.scrollToIndex) {
        delete window.__RAC_TRANSCRIPT_WINDOW__;
      }
    };
  }, [renderedMessages.length, transcriptWindow.scrollToIndex]);
  const activePrompt    = activeSession ? permissionPrompts[activeSession] || null : null;
  const activeErrorPrompt = activeSession ? errorPrompts[activeSession] || null : null;
  const activeBlockingErrorPrompt = isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
  const activeInlineErrorPrompt = activeErrorPrompt && !isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
  const activeBlockingPrompt = activePrompt || activeBlockingErrorPrompt;
  const activeBlockingPromptLabel = activePrompt
    ? (activePrompt.type === 'question_prompt' ? 'Question required' : 'Permission required')
    : activeBlockingErrorPrompt
      ? safeString(activeBlockingErrorPrompt.title, 'Action required')
      : null;
  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const promptKey = activePrompt
      ? `${activeSession || ''}\u0000${activePrompt.prompt_id || activePrompt.request_id || activePrompt.id || 'prompt'}`
      : '';
    const previousPromptKey = blockingPromptScrollKeyRef.current;
    blockingPromptScrollKeyRef.current = promptKey;
    if (promptKey) {
      scrollPinGenerationRef.current += 1;
      pinnedToNewestUntilRef.current = 0;
      stickyToNewestRef.current = false;
      programmaticScrollUntilRef.current = Date.now() + 800;
      setScrollTopInstant(list, 0);
      isAtBottom.current = list.scrollHeight - list.clientHeight < 80;
      setShowJumpButton(false);
      setNewMessagesBelow(0);
    } else if (previousPromptKey) {
      stickTranscriptToNewest(scrollIdentityKeysForMessages(activeMessagesForScroll), 3);
    }
  }, [activeSession, activePrompt?.prompt_id, activeLiveScrollVersion, activeMessagesForScroll]);
  const activeWriteGate = activeSession
    ? agentConfigs[activeSession]?.capabilities?.write_capability_gate || null
    : null;
  const canSend         = !!(currentInput.trim() || attachedFiles.length > 0) && !!activeSession && !uploading && !activeBlockingPrompt && !activeWriteGate;
  const relayHealthState = connected ? (connectionHealth?.state || 'connecting') : 'offline';
  const relayRttText = connectionHealth?.rttMs != null ? ` · ${connectionHealth.rttMs} ms` : '';
  const unreadTotal     = Object.entries(unread).reduce((total, [sessionId, count]) => (
    testSessionIds.has(sessionId) ? total : total + Number(count || 0)
  ), 0);
  const attentionTotal  = Object.keys(sessionAttention).filter(sessionId => sessionId !== activeSession && !testSessionIds.has(sessionId)).length;
  const appUpdateValidationAgeMs = latestAppUpdateValidation?.completed_at
    ? Date.now() - Date.parse(latestAppUpdateValidation.completed_at)
    : Number.POSITIVE_INFINITY;
  const recentAppUpdateValidation = appUpdateValidationAgeMs >= 0 && appUpdateValidationAgeMs <= 24 * 60 * 60 * 1000
    ? latestAppUpdateValidation
    : null;
  const visibleNightlyValidationFailures = recentAppUpdateValidation
    ? nightlyValidationFailures.filter(item => item.run_id !== recentAppUpdateValidation.run_id)
    : nightlyValidationFailures;
  const revalidationCoverageByHarness = Object.fromEntries(
    (revalidationProgramHealth?.coverage_matrix || []).map(row => [row.harness, row]),
  );
  const revalidationRows = Object.entries(revalidationProgramHealth?.harnesses || {})
    .sort(([left], [right]) => left.localeCompare(right));
  const hasSystemBanner = duplicateProxyAlarms.length > 0 || visibleNightlyValidationFailures.length > 0 || !!recentAppUpdateValidation || !!activeWriteGate;
  const slashQuery      = currentInput.startsWith('/') ? currentInput.slice(1).trim().toLowerCase() : '';
  const filteredSlashCommands = currentInput.startsWith('/')
    ? SLASH_COMMANDS.filter(item => item.command.slice(1).includes(slashQuery))
    : [];
  useLayoutEffect(() => {
    const banner = systemBannerRef.current;
    if (!hasSystemBanner || !banner) {
      setSystemBannerHeight(0);
      return undefined;
    }
    const updateHeight = () => setSystemBannerHeight(Math.ceil(banner.getBoundingClientRect().height));
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(banner);
    return () => observer.disconnect();
  }, [hasSystemBanner, duplicateProxyAlarms.length, visibleNightlyValidationFailures.length, recentAppUpdateValidation?.run_id, activeWriteGate]);

  // Resolve display label for the active session
  const activeConfig = activeSession ? (agentConfigs[activeSession] || null) : null;
  const activeConfigControls = activeSession
    ? Object.values(configControlStates || {}).filter(control => control.sessionId === activeSession)
    : [];
  const activePendingConfigControl = activeConfigControls.find(control => control.status === 'pending' || control.status === 'awaiting_config') || null;
  const activeFailedConfigControl = activeConfigControls.find(control => control.status === 'failed') || null;
  const activeHistoryMeta = activeSession ? (historyMeta[activeSession] || null) : null;
  const activeHistoryLoading = activeSession ? (historyLoading[activeSession] || null) : null;

  // Transcript history is loaded newest-first for the selected session only.
  // Relay-backed sessions page through SQLite chunks; Codex CLI pages through
  // the native JSONL archive so refresh never has to hydrate a full transcript.
  useEffect(() => {
    if (!activeSession || !connected) return;
    if (transcriptSearchTarget?.sessionId === activeSession) return;
    const existing = messages[activeSession] || [];
    const lastSequence = existing.reduce((maximum, message) => (
      Math.max(maximum, Number(message?.sequence || 0))
    ), 0);
    if (lastSequence > 0) {
      requestHistory(activeSession, { afterSequence: lastSequence });
      return;
    }
    const tailOptions = historyRequestOptionsFor(activeSessionMeta);
    const chunkSource = (activeSessionMeta?.agent_type === 'codex_cli' || activeSessionMeta?.agent_type === 'cursor_cli') ? 'native' : 'relay_sqlite';
    requestHistoryChunk(activeSession, { ...tailOptions, mode: 'tail', source: chunkSource });
  }, [activeSession, connected, activeSessionMeta?.agent_type, transcriptSearchTarget?.sessionId]);
  useEffect(() => {
    if (!connected || !transcriptSearchTarget || activeSession !== transcriptSearchTarget.sessionId) return;
    const targetAlreadyLoaded = (messages[activeSession] || []).some(message => (
      String(message?.id) === String(transcriptSearchTarget.messageId)
    ));
    if (targetAlreadyLoaded) return;
    const requestAroundMatch = () => requestHistoryChunk(activeSession, {
        mode: 'around',
        source: 'relay_sqlite',
        aroundId: transcriptSearchTarget.messageId,
        limit: 200,
        replace: true,
        userInitiated: true,
      });
    requestAroundMatch();
    const retryTimer = setTimeout(requestAroundMatch, 600);
    return () => clearTimeout(retryTimer);
  }, [connected, activeSession, transcriptSearchTarget?.sessionId, transcriptSearchTarget?.messageId, messages[activeSession]]);
  useEffect(() => {
    if (!transcriptSearchTarget || activeSession !== transcriptSearchTarget.sessionId) return undefined;
    const selector = `[data-message-id="${transcriptSearchTarget.messageId}"]`;
    const targetIndex = renderedMessages.findIndex(message => String(message?.id) === String(transcriptSearchTarget.messageId));
    if (targetIndex >= 0) transcriptWindow.scrollToIndex(targetIndex, 'center');
    let attempts = 0;
    let clearHighlightTimer = null;
    const timer = setInterval(() => {
      attempts++;
      const row = messagesListRef.current?.querySelector(selector);
      if (row) {
        clearInterval(timer);
        row.scrollIntoView({ block: 'center', behavior: 'instant' });
        clearHighlightTimer = setTimeout(() => {
          setTranscriptSearchTarget(current => (
            current?.sessionId === activeSession
              && String(current?.messageId) === String(transcriptSearchTarget.messageId)
              ? null
              : current
          ));
        }, 5000);
      } else if (attempts >= 40) {
        clearInterval(timer);
        setTranscriptSearchTarget(null);
        showToast('Matched message could not be loaded');
      }
    }, 100);
    return () => {
      clearInterval(timer);
      if (clearHighlightTimer) clearTimeout(clearHighlightTimer);
    };
  }, [activeSession, transcriptSearchTarget?.sessionId, transcriptSearchTarget?.messageId, messages[activeSession], renderedMessages, transcriptWindow.scrollToIndex]);
  useEffect(() => {
    // Full transcript traffic is selected-session only. Working background
    // sessions stay live through session_summary without history hydration.
    setSessionSubscriptions(activeSession ? [activeSession] : []);
  }, [activeSession, setSessionSubscriptions]);
  useEffect(() => {
    if (!activeSession || !connected || !activeNativeCliPlaceholder) return;
    const tailOptions = historyRequestOptionsFor(activeSessionMeta);
    requestHistoryChunk(activeSession, { ...tailOptions, mode: 'tail', source: 'native' });
  }, [activeSession, connected, activeNativeCliPlaceholder]);
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
  const activeWorkspaceLabel = activeSession ? workspaceLabelBySessionId[activeSession] : '';
  const activeWorkspacePath = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.workspace_path
    : '';
  const activeWorkspaceBasename = activeWorkspacePath
    ? activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() || activeWorkspacePath
    : '';
  const activeWorkspaceContext = activeWorkspaceBasename
    || (activeWorkspaceLabel && activeWorkspaceLabel !== 'Unscoped' ? activeWorkspaceLabel : '')
    || safeString(activeSessionMeta?.workspace_name)
    || 'Unscoped';
  const activeTitleProjectionCacheRef = useRef(new Map());
  const activeTitleSession = React.useMemo(() => (
    isAntigravityV2 && optimisticV2Focus?.title
      ? { ...(activeSessionMeta || {}), native_chat_title: optimisticV2Focus.title }
      : activeSessionMeta
  ), [activeSessionMeta, isAntigravityV2, optimisticV2Focus?.title]);
  const activeChatTitleProjection = React.useMemo(() => {
    if (!activeSession) return { title: 'Agent Chat', source: 'fallback', field: 'no_session' };
    const next = resolveSessionChatTitleProjection(
      activeTitleSession,
      activeTitleSession?.custom_display_name || '',
      activeMessagesForScroll,
    );
    const retained = retainStrongerSessionChatTitleProjection(
      activeTitleProjectionCacheRef.current.get(activeSession),
      next,
    );
    activeTitleProjectionCacheRef.current.set(activeSession, retained);
    return retained;
  }, [activeSession, activeTitleSession, activeMessagesForScroll]);
  const activeChatTitle = activeChatTitleProjection.title;
  const activeAutomationView = activeSession ? automationViews[activeSession] : null;
  const activeLooksLikeCodex = activeAgent?.name === 'Codex';
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
  const canLaunchNewThread = !!activeConfig?.capabilities?.new_thread;
  const isCodexDesktop = activeSessionMeta?.agent_type === 'codex-desktop';
  const isCursor = activeSessionMeta?.agent_type === 'cursor';
  const isDesktopAgent = isCodexDesktop || isCursor;
  const newThreadLabel = isDesktopAgent ? 'New chat' : 'New thread';
  const activeMachine = activeSessionMeta && typeof activeSessionMeta === 'object'
    ? activeSessionMeta.machine_label
    : '';
  const activeHostLabel = sessionHostLabel(activeSessionMeta);
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
  const activeGoal = activeActivity?.goal || null;
  const activeGoalState = String(activeGoal?.state || activeGoal?.status || '').toLowerCase();
  const activeGoalBlocked = activeGoalState === 'blocked';
  const activeBlockedResumeSupported = activeGoalBlocked
    && activeConfig?.capabilities?.goal_blocked_resume === true;
  const activeGoalAction = activeGoalState === 'active'
    ? 'pause'
    : (activeGoalState === 'paused' || activeBlockedResumeSupported ? 'resume' : null);
  const activeGoalBlockedReason = activeGoalBlocked
    ? safeString(activeGoal?.block_reason || activeGoal?.reason || activeActivity?.label || 'Goal blocked').trim()
    : '';
  const activeGoalControlAvailable = !!(
    activeGoalAction
    && activeGoal?.fingerprint
    && activeConfig?.capabilities?.goal_pause_resume === true
    && Number(activeSessionMeta?.control_generation) > 0
  );
  const activeInterruptAvailable = !!(
    isActiveThinking
    && activeConfig?.capabilities?.interrupt === true
    && Number(activeSessionMeta?.control_generation) > 0
    && Number(activeSessionMeta?.turn_generation) > 0
  );
  const activeContextCard = activeActivity?.context_card || null;
  const showLastUserBanner = !!(
    activeSession
    && lastUserText
    && !((activeSessionMeta?.agent_type === 'cline' || activeSessionMeta?.agent_type === 'roo_code') && activeContextCard)
  );
  const assistantMonospace = ['claude_cli', 'codex_cli', 'cursor_cli'].includes(activeSessionMeta?.agent_type);
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
    && !activeActivity?.thinking
    && !activeActivity?.current
    && !activeActivity?.task_list
    && hasSubstantiveLiveText(liveThinkingText)
  );
  const showLiveAssistantDraft = !!(
    activeSession
    && !activeProvisionalStream
    && activeActivity
    && (activeActivity.kind === 'thinking' || activeActivity.kind === 'generating')
    && !activeActivity?.thinking
    && !activeActivity?.current
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
  const showTranscriptFooterActivity = !!(
    activeActivity
    && (
      activeActivity?.goal
      || activeActivity?.thinking
      || activeActivity?.current
      || activeActivity?.step
      || activeActivity?.usage
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
    if (!transcriptWindow.prepareForPrepend()) {
      const list = messagesListRef.current;
      const listRect = list?.getBoundingClientRect();
      const listTop = listRect?.top || 0;
      const rows = list ? Array.from(list.querySelectorAll('.message[data-message-key]')) : [];
      const anchorRow = rows.find(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= listTop && rect.top < listRect.bottom;
      }) || rows.find(row => row.getBoundingClientRect().bottom > listTop) || rows[0] || null;
      nonWindowedPrependAnchorRef.current = anchorRow ? {
        messageKey: anchorRow.dataset.messageKey,
        viewportTop: anchorRow.getBoundingClientRect().top,
      } : null;
    }
    const chunkSource = (activeSessionMeta?.agent_type === 'codex_cli' || activeSessionMeta?.agent_type === 'cursor_cli') ? 'native' : 'relay_sqlite';
    requestHistoryChunk(activeSession, {
      mode: activeHistoryMeta?.cursor ? 'older' : 'tail',
      source: chunkSource,
      userInitiated: true,
      beforeOffset: activeHistoryMeta?.cursor?.next_before_offset,
      beforeId: activeHistoryMeta?.cursor?.next_before_id,
      ...historyRequestOptionsFor(activeSessionMeta),
    });
  }
  useEffect(() => {
    requestOlderHistoryRef.current = showPartialHistoryBanner && !activeHistoryLoading
      ? loadOlderActiveHistory
      : null;
    return () => {
      requestOlderHistoryRef.current = null;
    };
  }, [
    activeSession,
    activeSessionMeta?.agent_type,
    activeHistoryLoading,
    showPartialHistoryBanner,
    activeHistoryMeta?.cursor?.next_before_offset,
    activeHistoryMeta?.cursor?.next_before_id,
  ]);
  function retryActiveHistory() {
    if (!activeSession) return;
    const chunkSource = (activeSessionMeta?.agent_type === 'codex_cli' || activeSessionMeta?.agent_type === 'cursor_cli') ? 'native' : 'relay_sqlite';
    requestHistoryChunk(activeSession, {
      ...historyRequestOptionsFor(activeSessionMeta),
      mode: 'tail',
      source: chunkSource,
      userInitiated: true,
    });
  }
  const shouldBottomAlignMessages = !!(
    activeSession
    && (currentMessages.length > 0 || showLiveAssistantDraft || activeProvisionalStream)
  );
  const activeAgentMemoKey = activeAgentKey(activeAgent);
  const renderedMessageNodes = React.useMemo(() => (
    renderedMessages.slice(transcriptWindow.start, transcriptWindow.end).map((msg, windowIndex) => {
      const i = transcriptWindow.start + windowIndex;
      const messageKey = messageIdentityKey(msg, i);
      const searchMatch = !!(
        transcriptSearchTarget?.sessionId === activeSession
        && String(msg?.id) === String(transcriptSearchTarget?.messageId)
      );
      // Virtualization already bounds mounted transcript work to a small window.
      // Rendering those rows as deferred empty shells changes their measured
      // heights after every range swap and can make the window oscillate.
      const richContentEager = transcriptWindow.enabled
        || searchMatch
        || i >= Math.max(0, renderedMessages.length - 48);
      const preview = transcriptPreview?.sessionId === activeSession && transcriptPreview?.messageKey === messageKey
        ? transcriptPreview
        : null;
      const messageNode = (
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
          onRetry={handleTranscriptRetry}
          richContentEager={richContentEager}
          searchMatch={searchMatch}
        />
      );
      return transcriptWindow.enabled ? (
        <VirtualTranscriptRow
          key={messageKey}
          index={i}
          messageKey={`${activeSession || ''}\u0001${messageKey}`}
          onMeasure={transcriptWindow.onMeasure}
        >
          {messageNode}
        </VirtualTranscriptRow>
      ) : messageNode;
    })
  ), [
    renderedMessages,
    transcriptWindow.start,
    transcriptWindow.end,
    transcriptWindow.enabled,
    transcriptWindow.onMeasure,
    activeSession,
    transcriptSearchTarget?.sessionId,
    transcriptSearchTarget?.messageId,
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
    handleTranscriptRetry,
  ]);
  // Auto-fetch thread list for desktop sessions with no messages (e.g. Codex Desktop showing chat picker)
  const hasThreadCap = activeConfig?.capabilities?.thread_list;
  const hasNativeDraftThread = !!activeSessionMeta?.is_new_chat_draft;
  const showDesktopThreadTabs = !!(
    activeSession
    && (activeSessionMeta?.agent_type === 'codex-desktop' || activeSessionMeta?.agent_type === 'cursor')
    && hasThreadCap
    && (threadLists[activeSession]?.length > 0 || pendingDraftThreads[activeSession] || hasNativeDraftThread)
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
    return list;
  }, [activeSession, threadLists, optimisticThreadFocus]);
  const activeTranscriptRenderKey = React.useMemo(() => {
    const focusedThreadId = optimisticThreadFocus[activeSession];
    const activeThread = (threadLists[activeSession] || []).find(thread => thread?.active);
    const activeThreadId = activeThread?.cache_key || activeThread?.id;
    const draftKey = (pendingDraftThreads[activeSession] || hasNativeDraftThread) ? 'draft' : '';
    return `${activeSession || 'none'}:${draftKey || focusedThreadId || activeThreadId || 'default'}`;
  }, [activeSession, threadLists, optimisticThreadFocus, pendingDraftThreads, hasNativeDraftThread]);
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
    if (!(activeSession && hasThreadCap && (isDesktopAgent || showThreadList))) return undefined;
    requestThreadList(activeSession);
    const intervalId = setInterval(
      () => requestThreadList(activeSession),
      showThreadList ? 3000 : 5000,
    );
    return () => clearInterval(intervalId);
  }, [activeSession, activeSessionMeta?.agent_type, hasThreadCap, showThreadList]);
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
  }

  function handleSwitchThread(sessionId, threadId) {
    if (!(sessionId && threadId)) return;
    setPendingDraftThreads(prev => ({ ...prev, [sessionId]: false }));
    setOptimisticThreadFocus(prev => ({ ...prev, [sessionId]: threadId }));
    setDraftMessageBaselines(prev => ({ ...prev, [sessionId]: 0 }));
    switchThread(sessionId, threadId);
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
  }

  function updateInput(value) {
    if (!activeSession) return;
    sendHistoryCursorRef.current = {
      sessionId: activeSession,
      index: (sendHistoryRef.current[activeSession] || []).length,
      scratch: value,
    };
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

  function renderSidebarSessionCard(session, pinned = false, workspaceLabel = '') {
    const id = sessionIdOf(session);
    const recentMessage = recentSessionIds.has(id) ? normalizeLatestVisibleMessage(session) : null;
    let host = sidebarCardHostsRef.current.get(id);
    if (!host) {
      host = document.createElement('div');
      host.className = 'sidebar-card-host';
      host.setAttribute('data-sidebar-card-host', id);
      sidebarCardHostsRef.current.set(id, host);
    }
    return ReactDOM.createPortal((
      <MemoSessionCard
        session={session}
        health={health[id]}
        unread={testSessionIds.has(id) ? 0 : unread[id] || 0}
        isThinking={!!thinking[id] || !!fleetGoalSubstateLabel(activities[id], { health: health[id] })}
        isActive={id === activeSession}
        agentConfig={agentConfigs[id] || null}
        activity={activities[id] || null}
        sessionMessages={messages[id] || []}
        hasBlockingPrompt={!!permissionPrompts[id] || !!isBlockingErrorPrompt(errorPrompts[id])}
        blockingPromptLabel={permissionPrompts[id]
          ? (permissionPrompts[id].type === 'question_prompt' ? 'Question required' : 'Permission required')
          : (errorPrompts[id]?.title || 'Action required')}
        muted={!!sessionPreferences[id]?.muted}
        pinned={pinned}
        workspaceLabel={workspaceLabel}
        recentMessageAt={recentMessage?.at || null}
        menuOpen={openSidebarMenuId === id}
        onMenuToggle={open => setOpenSidebarMenuId(current => open ? id : (current === id ? '' : current))}
        onPinChange={nextPinned => saveSessionPreference(id, { pinned: nextPinned }).catch(error => {
          showToast(error?.message || `Unable to ${nextPinned ? 'pin' : 'unpin'} chat`);
        })}
        onSelect={() => selectSession(id, session)}
        onManage={() => {
          setManagedSessionId(id);
          setShowSessionManagement(true);
          setShowNotificationSettings(false);
          setShowNewSession(false);
        }}
        onClose={() => {
          const isDisconnected = health[id] === 'disconnected' || !health[id];
          const msg = isDisconnected
            ? 'Remove session from the list?'
            : `Close session "${id}"?`;
          if (window.confirm(msg)) closeSession(id, isDisconnected);
        }}
        onAutomations={(session?.agent_type === 'codex-desktop') ? () => { if (!showAutomations) captureChatRouteScroll(); setShowAutomations(open => !open); setShowSkills(false); setShowFleetView(false); setShowUsageDashboard(false); setShowHostResourceDashboard(false); setSidebarOpen(false); } : undefined}
        showAutomationsActive={showAutomations}
        onSkills={(session?.agent_type === 'codex-desktop') ? () => { if (!showSkills) captureChatRouteScroll(); setShowSkills(open => !open); setShowAutomations(false); setShowFleetView(false); setShowUsageDashboard(false); setShowHostResourceDashboard(false); setSidebarOpen(false); if (!skillLists[id]) requestSkillList(id); } : undefined}
        showSkillsActive={showSkills}
      />
    ), host, id);
  }

  function renderSidebarSessionSlot(session, visible = true) {
    const id = sessionIdOf(session);
    return (
      <div
        key={id}
        className={`sidebar-card-slot${visible ? '' : ' sidebar-card-slot-filtered'}`}
        data-sidebar-card-slot={id}
        aria-hidden={visible ? undefined : 'true'}
        inert={visible ? undefined : ''}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`app${hasSystemBanner ? ' has-system-banner' : ''}`}
      style={hasSystemBanner ? { '--system-banner-height': `${systemBannerHeight}px` } : undefined}
    >
      {quickSwitcherOpen && (
        <div
          className="quick-switcher-overlay"
          onMouseDown={event => {
            if (event.target !== event.currentTarget) return;
            setQuickSwitcherOpen(false);
            setQuickSwitcherQuery('');
            setQuickSwitcherIndex(0);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        >
          <div className="quick-switcher" role="dialog" aria-modal="true" aria-label="Switch session">
            <div className="quick-switcher-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                ref={quickSwitcherInputRef}
                className="quick-switcher-input"
                value={quickSwitcherQuery}
                onChange={event => {
                  setQuickSwitcherQuery(event.target.value);
                  setQuickSwitcherIndex(0);
                }}
                placeholder="Search sessions, projects, or harnesses"
                aria-label="Search sessions"
                aria-controls="quick-switcher-results"
                aria-activedescendant={quickSwitcherResults.length ? `quick-switcher-option-${quickSwitcherIndex}` : undefined}
                autoComplete="off"
                spellCheck="false"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="quick-switcher-results" id="quick-switcher-results" role="listbox">
              {quickSwitcherResults.length === 0 ? (
                <div className="quick-switcher-empty">No matching sessions</div>
              ) : quickSwitcherResults.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  id={`quick-switcher-option-${index}`}
                  aria-selected={index === quickSwitcherIndex}
                  className={`quick-switcher-option${index === quickSwitcherIndex ? ' selected' : ''}${item.id === activeSession ? ' active' : ''}`}
                  key={item.id}
                  onMouseEnter={() => setQuickSwitcherIndex(index)}
                  onClick={() => {
                    selectSession(item.id, item.session);
                    setSidebarOpen(false);
                    setQuickSwitcherOpen(false);
                    setQuickSwitcherQuery('');
                    setQuickSwitcherIndex(0);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                >
                  <span className="quick-switcher-dot" style={{ background: item.agentColor }} />
                  <span className="quick-switcher-copy">
                    <span className="quick-switcher-title">{item.title}</span>
                    <span className="quick-switcher-meta">{item.groupLabel} · {item.agentName}{item.subtitle ? ` · ${item.subtitle}` : ''}</span>
                  </span>
                  {item.id === activeSession && <span className="quick-switcher-current">Current</span>}
                </button>
              ))}
            </div>
            <div className="quick-switcher-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
              <span><kbd>Enter</kbd> Switch</span>
              <span>{quickSwitcherResults.length} of {quickSwitcherItems.length}</span>
            </div>
          </div>
        </div>
      )}
      {shortcutHelpOpen && (
        <div
          className="shortcut-help-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setShortcutHelpOpen(false);
          }}
        >
          <div className="shortcut-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
            <div className="shortcut-help-header">
              <strong>Keyboard shortcuts</strong>
              <button type="button" onClick={() => setShortcutHelpOpen(false)} aria-label="Close keyboard shortcuts">×</button>
            </div>
            <div className="shortcut-help-list">
              <div><span>Switch session</span><kbd>Ctrl/Cmd P</kbd></div>
              <div><span>Previous / next session</span><kbd>Alt ↑ / ↓</kbd></div>
              <div><span>Focus composer</span><kbd>Ctrl/Cmd K</kbd></div>
              <div><span>Send / newline</span><kbd>Enter / Shift Enter</kbd></div>
              <div><span>Open / close this guide</span><kbd>?</kbd></div>
            </div>
            <div className="shortcut-help-note">Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt.</div>
          </div>
        </div>
      )}
      {revalidationLedgerOpen && (
        <div
          className="shortcut-help-overlay revalidation-ledger-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setRevalidationLedgerOpen(false);
          }}
        >
          <div className="revalidation-ledger" role="dialog" aria-modal="true" aria-label="Harness revalidation program health">
            <div className="shortcut-help-header">
              <strong>Harness revalidation program</strong>
              <button type="button" onClick={() => setRevalidationLedgerOpen(false)} aria-label="Close validation health">{'\u00d7'}</button>
            </div>
            <p className="revalidation-ledger-summary">
              Continuous version watch, nightly tier-1, and staggered weekly tier-2. Write controls fail closed after drift until the installed version passes its required tiers.
            </p>
            {revalidationRows.length === 0 ? (
              <div className="revalidation-ledger-empty">Program health has not been published by the updated sentinel yet.</div>
            ) : (
              <div className="revalidation-ledger-table-wrap">
                <table className="revalidation-ledger-table">
                  <thead><tr><th>Harness</th><th>Version</th><th>Fixture</th><th>Tier 1</th><th>Tier 2</th><th>Write gate</th><th>Next tier 2</th></tr></thead>
                  <tbody>{revalidationRows.map(([harness, record]) => {
                    const coverage = revalidationCoverageByHarness[harness] || {};
                    const tier2 = coverage.tier2 || {};
                    const tier2Label = record.last_tier2_status
                      || (tier2.mode === 'gated' ? 'gated' : 'scheduled');
                    return <tr key={harness}>
                      <th scope="row">{harness}</th>
                      <td>{record.installed_version || 'not installed'}</td>
                      <td>{coverage.fixture ? 'covered' : 'missing'}</td>
                      <td>{coverage.tier1 ? 'covered' : 'missing'}</td>
                      <td className={`validation-state-${tier2Label}`}>{tier2Label}</td>
                      <td className={`validation-state-${record.status || 'pending'}`}>{record.status === 'pass' ? 'available' : record.status || 'pending'}</td>
                      <td>{record.next_tier2_at ? new Date(record.next_tier2_at).toLocaleString() : 'unscheduled'}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      <div className={`overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />
      {hasSystemBanner && (
        <div className={`duplicate-proxy-banner${recentAppUpdateValidation?.status === 'pass' && duplicateProxyAlarms.length === 0 && visibleNightlyValidationFailures.length === 0 && !activeWriteGate ? ' app-update-pass' : ''}`} role={recentAppUpdateValidation?.status === 'pass' && duplicateProxyAlarms.length === 0 && visibleNightlyValidationFailures.length === 0 && !activeWriteGate ? 'status' : 'alert'} ref={systemBannerRef}>
          {duplicateProxyAlarms.length > 0 && <>
            <strong>Duplicate proxy detected.</strong>
            <span>{duplicateProxyAlarms.length} session{duplicateProxyAlarms.length === 1 ? '' : 's'} claimed by multiple proxies. Stop the extra proxy to prevent conflicting controls.</span>
          </>}
          {visibleNightlyValidationFailures.length > 0 && <>
            <strong>Nightly validation failed.</strong>
            <span>{visibleNightlyValidationFailures.map(item => `${item.harness} (${item.app_version})`).join(', ')}. Check the validation ledger before using affected controls.</span>
          </>}
          {recentAppUpdateValidation && <>
            <strong>{recentAppUpdateValidation.status === 'pass' ? 'App update validated.' : 'App update drift validation failed.'}</strong>
            <span>{recentAppUpdateValidation.harness} {recentAppUpdateValidation.previous_app_version} -&gt; {recentAppUpdateValidation.app_version}. {recentAppUpdateValidation.status === 'pass' ? 'Harness controls remain available.' : 'A triage item was added to the maturity backlog.'}</span>
          </>}
          {activeWriteGate && <>
            <strong>Harness writes paused.</strong>
            <span>{activeWriteGate}. Read-only transcript access remains available.</span>
          </>}
          {revalidationProgramHealth && <button type="button" className="validation-health-link" onClick={() => setRevalidationLedgerOpen(true)}>View program health</button>}
        </div>
      )}

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <span className="logo">⌬</span>
          <span style={{ flex: 1 }}>Agent Sessions</span>
          <button
            className={`new-session-btn notification-settings-btn${revalidationLedgerOpen ? ' active' : ''}`}
            title="Harness validation health"
            aria-label="Harness validation health"
            onClick={() => setRevalidationLedgerOpen(true)}
          >V</button>
          <button
            className={`new-session-btn notification-settings-btn${shortcutHelpOpen ? ' active' : ''}`}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            onClick={() => {
              setShortcutHelpOpen(open => !open);
              setQuickSwitcherOpen(false);
            }}
          >?</button>
          <button
            className={`new-session-btn notification-settings-btn${showNotificationSettings ? ' active' : ''}`}
            title="Notification settings"
            aria-label="Notification settings"
            onClick={() => {
              setShowNotificationSettings(open => !open);
              setShowNewSession(false);
              setShowSessionManagement(false);
            }}
          >♢</button>
          <button
            className={`new-session-btn notification-settings-btn${showSessionManagement ? ' active' : ''}`}
            title="Manage sessions"
            aria-label="Manage sessions"
            onClick={() => {
              setManagedSessionId(
                activeSession && (showTestSessions || !testSessionIds.has(activeSession))
                  ? activeSession
                  : sessionIdOf(sidebarManagedSessions[0]) || '',
              );
              setShowSessionManagement(open => !open);
              setShowNewSession(false);
              setShowNotificationSettings(false);
            }}
          >⋯</button>
          <button
            className={`new-session-btn${showNewSession ? ' active' : ''}`}
            title="New session"
            onClick={() => {
              setShowNewSession(o => !o);
              setShowNotificationSettings(false);
              setShowSessionManagement(false);
            }}
          >+</button>
        </div>
        <div className="sidebar-session-search">
          <input
            type="search"
            value={sidebarSearchQuery}
            onChange={event => setSidebarSearchQuery(event.target.value)}
            placeholder="Filter sessions"
            aria-label="Filter sidebar sessions"
            autoComplete="off"
            spellCheck="false"
          />
          {sidebarSearchQuery && (
            <button
              type="button"
              onClick={() => setSidebarSearchQuery('')}
              aria-label="Clear sidebar filter"
              title="Clear filter"
            >x</button>
          )}
        </div>
        <div
          className={`sidebar-order-control${sidebarOrderChanged ? ' changed' : ''}`}
          aria-hidden={!sidebarOrderChanged}
          aria-live="polite"
        >
          <span>Order changed</span>
          <button
            type="button"
            onClick={applySidebarSortNow}
            disabled={!sidebarOrderChanged}
            tabIndex={sidebarOrderChanged ? 0 : -1}
          >Sort now</button>
        </div>
        {showNotificationSettings && (
          <NotificationSettingsPanel
            onClose={() => setShowNotificationSettings(false)}
            onPreferencesChange={next => {
              setAttentionFeedbackPreferences({ ...next, turn_ready: false });
              setNotificationPreferencesLoaded(true);
            }}
          />
        )}
        {showSessionManagement && (
          <SessionManagementPanel
            sessions={sidebarManagedSessions}
            preferences={sessionPreferences}
            initialSessionId={managedSessionId}
            onSave={saveSessionPreference}
            onExport={downloadSessionExport}
            onClose={() => setShowSessionManagement(false)}
          />
        )}
        {showNewSession && (
          <NewSessionPanel
            launchStates={launchStates}
            onLaunch={(agentType, workspacePath, options) => launchSession(agentType, workspacePath, options)}
            onResume={(sourceSession, agentType, workspacePath, options) => resumeSession(sourceSession, agentType, workspacePath, options)}
            onClose={() => setShowNewSession(false)}
            workspaces={workspaces}
            showTestSessions={showTestSessions}
          />
        )}
        <SidebarScrollCoordinator
          structureKey={sidebarStructureKey}
          placements={sidebarPlacementBySessionId}
          prepareStructureChange={prepareSidebarStructureChange}
          finishStructureChange={finishSidebarStructureChange}
        >
          <div
            className="session-list"
            ref={sidebarListRef}
          onPointerDown={() => {
            sidebarInteractionEpochRef.current += 1;
            beginSidebarInteraction();
          }}
          onPointerUp={() => endSidebarInteraction(80)}
          onPointerCancel={() => endSidebarInteraction(80)}
          onWheel={() => {
            sidebarInteractionEpochRef.current += 1;
            beginSidebarInteraction();
            endSidebarInteraction(180);
          }}
          onTouchStart={() => {
            sidebarInteractionEpochRef.current += 1;
            beginSidebarInteraction();
          }}
          onKeyDown={event => {
            if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
            sidebarInteractionEpochRef.current += 1;
            beginSidebarInteraction();
            endSidebarInteraction(180);
          }}
          onScroll={event => {
            const expected = sidebarExpectedProgrammaticScrollRef.current;
            if (expected && Math.abs(event.currentTarget.scrollTop - expected.target) <= 0.5) {
              sidebarExpectedProgrammaticScrollRef.current = null;
              return;
            }
            sidebarInteractionEpochRef.current += 1;
            beginSidebarInteraction();
            endSidebarInteraction(180);
          }}
        >
          {orderedSessions.length === 0 && !showNewSession && (
            <div className="session-empty">No agents connected</div>
          )}
          {orderedSessions.length > 0 && normalizedSidebarSearchQuery
            && displayedWorkingSessions.length === 0
            && displayedRecentSessions.length === 0
            && displayedPinnedSessions.length === 0
            && displayedSessionGroups.length === 0 && (
              <div className="session-empty">No matching sessions</div>
          )}
          {workingSessions.length > 0 && (
            <section className={`session-group working-session-group${normalizedSidebarSearchQuery && displayedWorkingSessions.length === 0 ? ' sidebar-group-filtered' : ''}`} aria-label="Working now">
              <div className="session-group-header">
                <span className="working-session-group-icon" aria-hidden="true">W</span>
                <span className="session-group-name pinned-session-group-name">Working now</span>
                <span className="session-group-status-slot">
                  {workingSessionSummary.hasPrompt && <span className="session-group-alert" title="Action required">!</span>}
                  <span className="session-group-working" title="Sessions working" />
                  {workingSessionSummary.unread > 0 && (
                    <span className="session-group-unread" title={`${workingSessionSummary.unread} unread`}>{workingSessionSummary.unread > 99 ? '99+' : workingSessionSummary.unread}</span>
                  )}
                  <span className="session-group-count">{displayedWorkingSessions.length}</span>
                </span>
              </div>
              <div className="session-group-items">
                <div className="session-group-items-inner">
                  {workingSessions.map(session => renderSidebarSessionSlot(
                    session,
                    !normalizedSidebarSearchQuery || displayedWorkingSessions.includes(session),
                  ))}
                </div>
              </div>
            </section>
          )}
          {recentSessions.length > 0 && (
            <section
              className={`session-group recent-session-group${collapsedSessionGroups.__recent__ && !normalizedSidebarSearchQuery ? ' collapsed' : ''}${normalizedSidebarSearchQuery && displayedRecentSessions.length === 0 ? ' sidebar-group-filtered' : ''}`}
              aria-label="Recent chats"
            >
              <div className="session-group-header">
                <button
                  type="button"
                  className="session-group-toggle"
                  title={`${collapsedSessionGroups.__recent__ ? 'Expand' : 'Collapse'} Recent chats`}
                  aria-label={`${collapsedSessionGroups.__recent__ ? 'Expand' : 'Collapse'} Recent chats`}
                  aria-expanded={!collapsedSessionGroups.__recent__ || !!normalizedSidebarSearchQuery}
                  onClick={() => toggleSessionGroup('__recent__')}
                >
                  <span className="session-group-caret" aria-hidden="true">{collapsedSessionGroups.__recent__ && !normalizedSidebarSearchQuery ? '>' : 'v'}</span>
                </button>
                <span className="recent-session-group-icon" aria-hidden="true">R</span>
                <span className="session-group-name pinned-session-group-name">Recent chats</span>
                <span className="session-group-status-slot">
                  {recentSessionSummary.hasPrompt && <span className="session-group-alert" title="Action required">!</span>}
                  {recentSessionSummary.working && <span className="session-group-working" title="Session working" />}
                  {recentSessionSummary.unread > 0 && (
                    <span className="session-group-unread" title={`${recentSessionSummary.unread} unread`}>{recentSessionSummary.unread > 99 ? '99+' : recentSessionSummary.unread}</span>
                  )}
                  <span className="session-group-count">{displayedRecentSessions.length}</span>
                </span>
              </div>
              <div className="session-group-items">
                <div className="session-group-items-inner">
                  {recentSessions.map(session => renderSidebarSessionSlot(
                    session,
                    !normalizedSidebarSearchQuery || displayedRecentSessions.includes(session),
                  ))}
                </div>
              </div>
            </section>
          )}
          {pinnedSessions.length > 0 && (
            <section className={`session-group pinned-session-group${normalizedSidebarSearchQuery && displayedPinnedSessions.length === 0 ? ' sidebar-group-filtered' : ''}`} aria-label="Pinned chats">
              <div className="session-group-header">
                <span className="session-group-pin-icon" aria-hidden="true">📌</span>
                <span className="session-group-name pinned-session-group-name">Pinned chats</span>
                <span className="session-group-status-slot">
                  {pinnedSessionSummary.hasPrompt && <span className="session-group-alert" title="Action required">!</span>}
                  {pinnedSessionSummary.working && <span className="session-group-working" title="Session working" />}
                  {pinnedSessionSummary.unread > 0 && (
                    <span className="session-group-unread" title={`${pinnedSessionSummary.unread} unread`}>{pinnedSessionSummary.unread > 99 ? '99+' : pinnedSessionSummary.unread}</span>
                  )}
                  <span className="session-group-count">{displayedPinnedSessions.length}</span>
                </span>
              </div>
              <div className="session-group-items">
                <div className="session-group-items-inner">
                  {pinnedSessions.map(session => renderSidebarSessionSlot(
                    session,
                    !normalizedSidebarSearchQuery || displayedPinnedSessions.includes(session),
                  ))}
                </div>
              </div>
            </section>
          )}
          {sessionGroups.map(group => {
            const collapsed = !!collapsedSessionGroups[group.key] && !normalizedSidebarSearchQuery;
            const displayedGroup = displayedSessionGroups.find(candidate => candidate.key === group.key);
            const displayedGroupSessions = displayedGroup?.sessions || [];
            const summary = summarizeSidebarSessions(displayedGroupSessions);
            return (
            <div className={`session-group${collapsed ? ' collapsed' : ''}${normalizedSidebarSearchQuery && displayedGroupSessions.length === 0 ? ' sidebar-group-filtered' : ''}`} key={group.key}>
              <div className="session-group-header">
                <button
                  type="button"
                  className="session-group-toggle"
                  title={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                  aria-expanded={!collapsed}
                  onClick={() => toggleSessionGroup(group.key)}
                >
                  <span className="session-group-caret" aria-hidden="true">{collapsed ? '>' : 'v'}</span>
                </button>
                <FullTitleDisclosure
                  title={group.label}
                  disclosureKey={group.key}
                  kind="group"
                  wrapperClassName="session-group-title-details"
                  triggerClassName="session-group-name"
                  disclosureClassName="session-group-disclosure"
                  triggerLabel={`Show full group name: ${group.label}`}
                />
                <span className="session-group-status-slot">
                  {summary.hasPrompt && <span className="session-group-alert" title="Action required">!</span>}
                  {summary.working && <span className="session-group-working" title="Session working" />}
                  {summary.unread > 0 && (
                    <span className="session-group-unread" title={`${summary.unread} unread`}>{summary.unread > 99 ? '99+' : summary.unread}</span>
                  )}
                  <span className="session-group-count">{normalizedSidebarSearchQuery ? displayedGroupSessions.length : group.sessions.length}</span>
                </span>
              </div>
              <div className="session-group-items" aria-hidden={collapsed}>
                <div className="session-group-items-inner">
              {group.sessions.map(session => renderSidebarSessionSlot(
                session,
                !normalizedSidebarSearchQuery || displayedGroupSessions.includes(session),
              ))}
                </div>
              </div>
            </div>
            );
          })}
          {sidebarPortalSessions.map(session => {
            const id = sessionIdOf(session);
            return renderSidebarSessionCard(
              session,
              !!sessionPreferences[id]?.pinned,
              workspaceOwnedSessionIds.has(id) ? '' : (workspaceLabelBySessionId[id] || 'Unscoped'),
            );
          })}
          </div>
        </SidebarScrollCoordinator>
        <div className="sidebar-footer">
          <span className={`status-dot ${relayHealthState}`} />
          <span className="sidebar-footer-health">
            <span>{connected ? `Relay ${relayHealthState}` : 'Reconnecting…'}</span>
            <span className="sidebar-footer-rtt">{connected ? (relayRttText.replace(/^\s*·\s*/, '') || '\u00a0') : '\u00a0'}</span>
          </span>
          <button
            type="button"
            className={`sidebar-footer-action test-session-toggle${showTestSessions ? ' active' : ''}`}
            title={showTestSessions ? 'Hide test sessions' : `Show test sessions (${testSessionIds.size})`}
            aria-label={showTestSessions ? 'Hide test sessions' : 'Show test sessions'}
            aria-pressed={showTestSessions}
            onClick={() => setShowTestSessions(value => !value)}
          >T{testSessionIds.size > 99 ? '99+' : testSessionIds.size || ''}</button>
          <button
            type="button"
            className={`sidebar-footer-action${showUsageDashboard ? ' active' : ''}`}
            title="Usage and limits"
            aria-label="Usage and limits"
            onClick={() => {
              if (!showUsageDashboard) captureChatRouteScroll();
              setShowUsageDashboard(open => !open);
              setShowHostResourceDashboard(false);
              setShowAutomations(false);
              setShowSkills(false);
              setShowNewSession(false);
              setShowNotificationSettings(false);
              setShowSessionManagement(false);
              setShowFleetView(false);
              setShowTranscriptSearch(false);
              setSidebarOpen(false);
            }}
          >◔</button>
          <button
            type="button"
            className={`sidebar-footer-action host-resource-footer-action${showHostResourceDashboard ? ' active' : ''}`}
            title="Host resources"
            aria-label="Host resources"
            onClick={() => {
              if (!showHostResourceDashboard) captureChatRouteScroll();
              setShowHostResourceDashboard(open => !open);
              setShowUsageDashboard(false);
              setShowFleetView(false);
              setShowAutomations(false);
              setShowSkills(false);
              setShowNewSession(false);
              setShowNotificationSettings(false);
              setShowSessionManagement(false);
              setShowTranscriptSearch(false);
              setSidebarOpen(false);
            }}
          >R</button>
          <button
            type="button"
            className={`sidebar-footer-action fleet-footer-action${showFleetView ? ' active' : ''}`}
            title="Fleet view"
            aria-label="Fleet view"
            onClick={() => {
              if (!showFleetView) captureChatRouteScroll();
              setShowFleetView(open => !open);
              setShowUsageDashboard(false);
              setShowHostResourceDashboard(false);
              setShowAutomations(false);
              setShowSkills(false);
              setShowNewSession(false);
              setShowNotificationSettings(false);
              setShowSessionManagement(false);
              setShowTranscriptSearch(false);
              setSidebarOpen(false);
            }}
          >▦</button>
          <button
            type="button"
            className={`sidebar-footer-action transcript-search-footer-action${showTranscriptSearch ? ' active' : ''}`}
            title="Search all transcripts"
            aria-label="Search all transcripts"
            onClick={() => {
              if (!showTranscriptSearch) captureChatRouteScroll();
              setShowTranscriptSearch(open => !open);
              setShowFleetView(false);
              setShowUsageDashboard(false);
              setShowHostResourceDashboard(false);
              setShowAutomations(false);
              setShowSkills(false);
              setShowNewSession(false);
              setShowNotificationSettings(false);
              setShowSessionManagement(false);
              setSidebarOpen(false);
            }}
          >⌕</button>
          <a href="/agent-chat.apk" download className="apk-download-link" title="Download Android APK">⬇ APK</a>
        </div>
      </div>

      {/* Main panel */}
      <div className={`main${showAutomations || showSkills || showUsageDashboard || showHostResourceDashboard || showFleetView || showTranscriptSearch ? ' automations-active' : ''}`}>
        <GlobalHostResourceStrip
          connected={connected}
          error={hostResourceError}
          history={hostResourceHistory}
          subscription={hostResourceSubscription}
          onRefresh={requestHostResourceRefresh}
          onSubscribe={subscribeHostResources}
          onUnsubscribe={unsubscribeHostResources}
          onOpen={() => {
            if (!showHostResourceDashboard) captureChatRouteScroll();
            setShowHostResourceDashboard(true);
            setShowUsageDashboard(false);
            setShowFleetView(false);
            setShowAutomations(false);
            setShowSkills(false);
            setShowNewSession(false);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
            setShowTranscriptSearch(false);
            setSidebarOpen(false);
          }}
        />
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
        {showScheduledSend && activeSession && (
          <ScheduledSendPanel
            sessionId={activeSession}
            initialContent={currentInput}
            jobs={scheduledSends.filter(job => job.session_id === activeSession)}
            onSchedule={scheduleSend}
            onCancel={cancelScheduledSend}
            onCreated={() => setDraftForSession(activeSession, '')}
            onClose={() => setShowScheduledSend(false)}
          />
        )}
        {showUsageDashboard && (
          <UsageDashboard
            usage={providerUsage}
            refreshReceipt={providerUsageRefreshReceipt}
            resetReceipt={providerUsageResetReceipt}
            costDetail={providerUsageCostDetail}
            onBack={() => setShowUsageDashboard(false)}
            onRefresh={requestProviderUsageRefresh}
            onWatch={setProviderUsageWatching}
            onConsumeResetCredit={consumeProviderUsageResetCredit}
            onRequestCostDetail={requestProviderUsageCostDetail}
          />
        )}
        {showHostResourceDashboard && (
          <HostResourceDashboard
            snapshot={hostResources}
            error={hostResourceError}
            history={hostResourceHistory}
            details={hostResourceDetails}
            subscription={hostResourceSubscription}
            onBack={() => setShowHostResourceDashboard(false)}
            onRefresh={requestHostResourceRefresh}
            onSubscribe={subscribeHostResources}
            onUnsubscribe={unsubscribeHostResources}
          />
        )}
        {showFleetView && (
          <FleetView
            sessions={operatorOrderedSessions}
            activities={activities}
            thinking={thinking}
            permissionPrompts={permissionPrompts}
            errorPrompts={errorPrompts}
            messages={messages}
            agentConfigs={agentConfigs}
            sessionAttention={sessionAttention}
            health={health}
            connected={connected}
            deliveryStates={deliveryStates}
            stopPending={stopPending}
            goalControlPending={goalControlPending}
            onBroadcastSend={sendToSession}
            onInterrupt={requestSessionInterrupt}
            onGoalControl={requestGoalControl}
            onBack={() => setShowFleetView(false)}
            onSelectSession={(sessionId, session) => {
              selectSession(sessionId, session);
              setShowFleetView(false);
            }}
          />
        )}
        {showTranscriptSearch && (
          <TranscriptSearchView
            onBack={() => setShowTranscriptSearch(false)}
            onOpenResult={openTranscriptSearchResult}
          />
        )}
      {!showAutomations && !showSkills && !showUsageDashboard && !showHostResourceDashboard && !showFleetView && !showTranscriptSearch && (<>
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
            ☰
            {unreadTotal > 0 && <span className="hamburger-badge">{unreadTotal}</span>}
            {attentionTotal > 0 && (
              <span className="hamburger-attention" title={`${attentionTotal} session${attentionTotal === 1 ? '' : 's'} need attention`} aria-label={`${attentionTotal} sessions need attention`}>!</span>
            )}
          </button>
          <div className="topbar-context">
            {activeSession ? (
              <>
                <div
                  className="topbar-title-row"
                  role="group"
                  aria-label={`${activeAgent.name} chat: ${activeChatTitle}`}
                >
                  <div
                    className="agent-badge topbar-agent-badge"
                    style={{ color: activeAgent.color, borderColor: activeAgent.color + '55', background: activeAgent.color + '18' }}
                  >
                    {activeAgent.logo
                      ? <img src={activeAgent.logo} alt={activeAgent.abbr} className="agent-badge-logo" />
                      : activeAgent.abbr}
                  </div>
                  <div className="topbar-title-group" style={{ color: activeAgent.color }}>
                    <div
                      className="topbar-title-projection"
                      data-chat-title-source={activeChatTitleProjection.source}
                      data-chat-title-field={activeChatTitleProjection.field}
                    >
                      <FullTitleDisclosure
                        title={activeChatTitle}
                        disclosureKey={`topbar-${activeSession}`}
                        kind="chat"
                        wrapperClassName="topbar-title-details"
                        triggerClassName="topbar-title"
                        disclosureClassName="topbar-title-disclosure"
                        triggerLabel={`Show full chat title: ${activeChatTitle}`}
                        triggerTag="div"
                      />
                    </div>
                    <div
                      className="topbar-subtitle"
                      title={activeWorkspacePath || undefined}
                    >
                      <span className="topbar-workspace-icon">⌂</span>{activeWorkspaceContext}
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
                    className={`context-pill topbar-relay-status ${connected ? 'ok' : 'warn'}`}
                    title={connected ? 'Relay connected' : 'Relay disconnected — reconnecting'}
                  >
                    {connected ? 'relay live' : 'reconnecting'}
                  </span>
                  <span
                    className={`context-pill topbar-proxy-health ${
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
                  {activeHostLabel && (
                    <span className="context-pill" title="Native editor host">{activeHostLabel}</span>
                  )}
                  <SessionUsageMiniMonitor
                    session={activeSessionMeta}
                    config={activeConfig}
                    providerUsage={providerUsage}
                    onOpenUsage={() => { captureChatRouteScroll(); setShowUsageDashboard(true); setShowHostResourceDashboard(false); setShowFleetView(false); }}
                  />
                  {(activeGoalControlAvailable || activeGoalBlocked) && (
                    <button
                      type="button"
                      className="context-pill session-control-pill goal-control"
                      onClick={() => activeGoalControlAvailable
                        && requestGoalControl(activeSession, activeGoalAction, activeGoal, activeSessionMeta)}
                      disabled={!activeGoalControlAvailable || !connected || !!goalControlPending[activeSession]}
                      aria-label={activeGoalControlAvailable
                        ? `${activeGoalAction === 'pause' ? 'Pause' : activeGoalBlocked ? 'Resume blocked' : 'Resume'} goal`
                        : 'Goal blocked; resolve in the native session'}
                      title={activeGoalBlocked ? (activeGoalBlockedReason || 'No verified native unblock action is available') : undefined}
                    >
                      {goalControlPending[activeSession]
                        ? (activeGoalAction === 'pause' ? 'Pausing goal...' : 'Resuming goal...')
                        : (activeGoalAction === 'pause'
                          ? 'Pause goal'
                          : activeGoalBlocked
                            ? (activeGoalControlAvailable ? 'Resume blocked goal' : 'Goal blocked · native action required')
                            : 'Resume goal')}
                    </button>
                  )}
                  {activeInterruptAvailable && (
                    <button
                      type="button"
                      className="context-pill session-control-pill interrupt-control"
                      onClick={() => requestSessionInterrupt(activeSession, activeSessionMeta)}
                      disabled={!connected || !!stopPending[activeSession]}
                      aria-label="Interrupt turn"
                    >
                      {stopPending[activeSession] ? 'Interrupting...' : 'Interrupt turn'}
                    </button>
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
                  {(activeConfig?.capabilities?.terminal_output || activeConfig?.capabilities?.terminal_input) && (
                    <button
                      className={`context-pill terminal-toggle${showTerminal ? ' active' : ''}`}
                      title="Open terminal controls"
                      onClick={() => {
                        const next = !showTerminal;
                        setShowTerminal(next);
                        if (next && activeConfig?.capabilities?.terminal_output) requestTerminalOutput(activeSession);
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
                      title={`Open this ${agentTypeLabel(activeSessionMeta?.agent_type) || 'CLI'} session in a native command window`}
                      onClick={event => openNativeWindow(activeSession, event)}
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
            showDraftTab={!!pendingDraftThreads[activeSession] || hasNativeDraftThread}
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
        {showJumpButton && !activeBlockingPrompt && (
          <button
            className="jump-to-newest"
            onClick={pinTranscriptToNewest}
          >{newMessagesBelow > 0 ? `↓ ${newMessagesBelow} new` : '↓ Jump to Newest'}</button>
        )}
        <div
          className={`messages harness-theme harness-theme-${safeString(activeSessionMeta?.agent_type || 'default').replace(/[^a-z0-9_-]/gi, '-')}`}
          data-agent-type={activeSessionMeta?.agent_type || 'default'}
          data-layout={harnessLayoutForAgentType(activeSessionMeta?.agent_type)}
          data-transcript-windowed={transcriptWindow.enabled ? 'true' : 'false'}
          data-total-message-count={renderedMessages.length}
          data-window-start={transcriptWindow.start}
          data-window-end={transcriptWindow.end}
          key={activeTranscriptRenderKey}
          ref={messagesListRef}
        >
          {shouldBottomAlignMessages && <div className="messages-flex-spacer" />}
          {activePrompt && (
            <PermissionOverlay
              prompt={activePrompt}
              sessionId={activeSession}
              agentType={activeSessionMeta?.agent_type}
              onRespond={respondToPrompt}
              onDismissFocus={() => textareaRef.current?.focus()}
            />
          )}
          {activeBlockingErrorPrompt && !activePrompt && (
            <ErrorPromptOverlay
              prompt={activeBlockingErrorPrompt}
              sessionId={activeSession}
              onRespond={respondToErrorPrompt}
            />
          )}
          {(activeSessionMeta?.rate_limit_active || (activeSessionMeta?.percent_used != null && activeSessionMeta.percent_used >= 75)) && (
            <div className={`rate-limit-overlay${activeSessionMeta?.rate_limit_active ? ' critical' : activeSessionMeta?.percent_used >= 90 ? ' critical' : activeSessionMeta?.percent_used >= 75 ? ' warning' : ''}`}>
              <span className="rate-limit-icon">{activeSessionMeta?.rate_limit_active ? '⏳' : '📊'}</span>
              <span className="rate-limit-text">
                {activeSessionMeta?.rate_limit_active
                  ? <>Rate limited{activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== 'unknown' ? <> — resets <strong>{formatUsageResetLabel(activeSessionMeta.rate_limited_until)}</strong></> : null}</>
                  : <>Used <strong>{activeSessionMeta.percent_used}%</strong> of session limit{activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== 'unknown' ? <> · resets <strong>{formatUsageResetLabel(activeSessionMeta.rate_limited_until)}</strong></> : null}</>
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
          {activeSession && activeHistoryLoading && currentMessages.length > 0 && !showPartialHistoryBanner && (
            <div className="history-tail-banner history-refresh-banner" role="status">
              <span>Refreshing latest messages...</span>
            </div>
          )}
          {activeSession && activeHistoryMeta?.error && (
            <div className="history-tail-banner history-error-inline" role="alert">
              <span>{activeHistoryMeta.error}</span>
              <button type="button" onClick={retryActiveHistory} disabled={!!activeHistoryLoading}>Retry transcript</button>
            </div>
          )}
          {!activeSession ? (
            <div className="empty-state"><div className="icon">🤖</div><div>Select an agent session</div></div>
          ) : currentMessages.length === 0 && !activeProvisionalStream && hasThreadCap && activeSessionMeta?.is_list_view && (threadLists[activeSession]?.length > 0) && !pendingDraftThreads[activeSession] && !hasNativeDraftThread ? (
            <div className="thread-picker-empty">
              <div className="thread-picker-header">Select a chat</div>
              <div className="thread-picker-list">
                {threadLists[activeSession].map((thread, i) => (
                  <button
                    key={thread.cache_key || thread.id || i}
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
          ) : currentMessages.length === 0 && !activeProvisionalStream && isAntigravityV2 && activeSessionMeta?.is_list_view ? (
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
          ) : currentMessages.length === 0 && !activeProvisionalStream && isAntigravityV2 && chatLists[activeSession]?.length > 0 ? (
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
          ) : currentMessages.length === 0 && !activeProvisionalStream && activeSessionMeta?.is_list_view && chatLists[activeSession]?.length > 0 ? (
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
          ) : currentMessages.length === 0 && !activeProvisionalStream && activeHistoryLoading ? (
            <div className="empty-state history-loading-state">
              <span className="new-session-spinner" />
              <div>{activeHistoryLoading.mode === 'older' ? 'Loading older messages...' : 'Loading latest messages...'}</div>
            </div>
          ) : currentMessages.length === 0 && !activeProvisionalStream ? (
            <div className="empty-state"><div className="icon">💬</div><div>No messages yet</div></div>
          ) : (
            <>
              {transcriptWindow.enabled && (
                <div
                  className="transcript-window-spacer top"
                  data-testid="transcript-window-top-spacer"
                  style={{ height: `${transcriptWindow.topSpacerHeight}px` }}
                />
              )}
              {renderedMessageNodes}
              {transcriptWindow.enabled && (
                <div
                  className="transcript-window-spacer bottom"
                  data-testid="transcript-window-bottom-spacer"
                  style={{ height: `${transcriptWindow.bottomSpacerHeight}px` }}
                />
              )}
            </>
          )}
          {activeProvisionalStream && (
            <ProvisionalStreamingBubble
              stream={activeProvisionalStream}
              activeAgent={activeAgent}
              monospace={assistantMonospace}
            />
          )}
          {showLiveAssistantDraft && (
            <div
              className={`message assistant live-draft${assistantMonospace ? ' monospace' : ''}`}
              data-message-role="assistant"
              data-message-timestamp={parseMessageInstant(activeActivity?.started_at || activeActivity?.updated_at)?.iso || 'unknown'}
            >
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
                  <span className="message-role-label">{activeAgent.name}</span>
                  <MessageTimestamp instant={activeActivity?.started_at || activeActivity?.updated_at} />
                </div>
                <MarkdownContent content={liveThinkingText} monospace={assistantMonospace} autoExpandLongCodeBlocks={autoExpandLongCodeBlocks} onOpenPath={(path) => openTranscriptPreview('live-draft', path)} />
              </div>
            </div>
          )}
          {activeInlineErrorPrompt && !activePrompt && (
            <ErrorPromptInline
              prompt={activeInlineErrorPrompt}
              sessionId={activeSession}
              onRespond={respondToErrorPrompt}
            />
          )}
          <div ref={messagesEndRef} />
        </div>
        <CodexAutomationPane
          view={activeAutomationView}
          onShow={() => activeSession && showCodexAutomation(activeSession)}
        />
        </div>

        {(activeActivity?.task_list || showTranscriptFooterActivity) && !showFileBrowser && (
          <div className="transcript-live-footer" data-testid="transcript-live-footer">
            {activeActivity?.task_list && !activeActivity?.step && (
              <div className="session-tasklist-strip">
                <TaskList taskList={activeActivity.task_list} sessionId={activeSession} />
              </div>
            )}
            {showTranscriptFooterActivity && (
              <div className="composer-live-status-strip">
                <ActivityRow
                  activity={activeActivity}
                  thinkingText={activeSession ? (thinkingContent[activeSession] || '') : ''}
                  agentType={activeSessionMeta?.agent_type}
                  pinned
                />
              </div>
            )}
          </div>
        )}

        {showSettings && activeSession && (
          <AgentSettingsPanel
            session={activeSessionMeta || activeSession}
            config={activeConfig}
            configControlStates={configControlStates}
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

        {!showFileBrowser && showTerminal && activeSession && (activeConfig?.capabilities?.terminal_output || activeConfig?.capabilities?.terminal_input) && (
          <TerminalViewer
            entries={terminalOutputs[activeSession] || []}
            canRead={!!activeConfig?.capabilities?.terminal_output}
            canInput={!!activeConfig?.capabilities?.terminal_input}
            onRefresh={() => requestTerminalOutput(activeSession)}
            onSend={text => sendTerminalInput(activeSession, text)}
            controlResults={controlResults}
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

        <div
          className={`input-area composer-skin-${composerSkinForAgentType(activeSessionMeta?.agent_type)}`}
          data-composer-skin={composerSkinForAgentType(activeSessionMeta?.agent_type)}
          style={showFileBrowser ? { display: 'none' } : undefined}
        >
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
            {activeSession && goalCommandNotices[activeSession] && (
              <div
                className={`goal-command-notice ${goalCommandNotices[activeSession].status}`}
                role={goalCommandNotices[activeSession].status === 'failed' ? 'alert' : 'status'}
                data-request-id={goalCommandNotices[activeSession].requestId || undefined}
              >
                <strong>Goal control</strong>
                <span>{goalCommandNotices[activeSession].text}</span>
              </div>
            )}
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
                  ? `Resolve the ${activePrompt?.type === 'question_prompt' ? 'question' : (activePrompt ? 'permission prompt' : 'error prompt')} above to continue`
                  : activeSession
                    ? (window.innerWidth < 600 ? 'Enter message…' : 'Message… (/ for commands)')
                    : 'Select a session'}
                disabled={!activeSession || !!activeBlockingPrompt}
                rows={1}
              />
              <div className="textarea-btns">
                {activeSession && (
                  <button
                    className={`composer-gear-btn schedule-send-btn${showScheduledSend ? ' active' : ''}`}
                    onClick={() => setShowScheduledSend(open => !open)}
                    title="Schedule this message"
                    aria-label="Schedule message"
                  >◷</button>
                )}
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
                    onClick={event => openNativeWindow(activeSession, event)}
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
                {activeInterruptAvailable ? (
                  <button
                    className={`stop-btn${isStopPending ? ' pending' : ''}`}
                    title={isStopPending ? 'Interrupting…' : 'Interrupt agent'}
                    disabled={isStopPending}
                    onClick={performInterrupt}
                  >
                    {isStopPending ? <span className="stop-btn-spinner" /> : '■'}
                  </button>
                ) : (
                  <button className="send-btn" onClick={sendMessage} disabled={!canSend} title={connected ? 'Send' : 'Queue until reconnected'}>
                    {uploading ? '…' : '↑'}
                  </button>
                )}
              </div>
            </div>
            <div className="composer-meta">
              {interruptConfirmSession === activeSession && isActiveThinking && !isStopPending && (
                <span className="interrupt-confirm-inline" role="status" aria-live="polite">
                  Press Esc again or Enter to interrupt
                </span>
              )}
              {(isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.mode && activeConfig.mode !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.mode}</span>
              )}
              {(isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.model_id && activeConfig.model_id !== 'unknown' && (
                <span className="composer-hint" style={{ color: '#d29922' }}>{activeConfig.model_id}</span>
              )}
              {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                <span className="composer-hint" style={{ color: '#8b949e' }}>
                  Observed {activeConfig.observed_model_id || 'unknown'} / {activeConfig.observed_effort || 'unknown'}
                  {' · '}Next {activeConfig.next_send_model_id || 'unset'} / {activeConfig.next_send_effort || 'unset'}
                </span>
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
                {(activePendingConfigControl || activeFailedConfigControl) && (
                  <div className={`composer-control-state ${activeFailedConfigControl ? 'failed' : 'pending'}`} role="status">
                    {activeFailedConfigControl
                      ? activeFailedConfigControl.error
                      : `Saving ${activePendingConfigControl.field.replace(/_/g, ' ')}…`}
                  </div>
                )}
                {(activeConfig?.capabilities?.set_model || activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') && (
                  <>
                    {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                      <span className="composer-setting-label" data-control="observed-model">
                        <span className="composer-setting-key">Observed model</span>
                        <span className="composer-hint">{activeConfig.observed_model_id || 'unknown'}</span>
                      </span>
                    )}
                    <label className="composer-setting-label" data-control="model">
                      <span className="composer-setting-key">
                        {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' ? 'Next model' : 'Model'}
                      </span>
                      <select
                        className="composer-setting-select"
                        value={activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send'
                          ? (activeConfig.next_send_model_id || '')
                          : (activeConfig?.model_id || 'default')}
                        onChange={e => setAgentModel(activeSession, e.target.value)}
                      >
                        {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                          <option value="" disabled>Choose model…</option>
                        )}
                        {composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        {activeConfig?.model_id
                          && !composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).some(m => m.id === activeConfig.model_id)
                          && activeConfig.model_id !== 'unknown'
                          && activeConfig.config_semantics !== 'observed_and_next_send' && (
                          <option value={activeConfig.model_id}>{activeConfig.model_id}</option>
                        )}
                      </select>
                      {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                        <span className="composer-hint">{activeConfig.next_send_model_status || 'unset'}</span>
                      )}
                    </label>
                  </>
                )}
                {(activeSessionMeta?.agent_type === 'antigravity' || activeSessionMeta?.agent_type === 'antigravity_panel') && (
                  <label className="composer-setting-label" data-control="mode">
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
                {(isClineLikeAgentType(activeSessionMeta?.agent_type) || activeSessionMeta?.agent_type === 'cursor') && activeConfig?.capabilities?.set_mode && modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).length > 0 && (
                  <label className="composer-setting-label" data-control="mode">
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
                  <label className="composer-setting-label" data-control="permission">
                    <span className="composer-setting-key">{activeSessionMeta?.agent_type === 'codex_cli' ? 'Access' : 'Permission'}</span>
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
                  </label>
                )}
                {(activeSessionMeta?.agent_type === 'claude_cli' || activeSessionMeta?.agent_type === 'codex_cli' || activeSessionMeta?.agent_type === 'cursor_cli') && activeConfig?.capabilities?.set_effort && (activeConfig.available_efforts || []).length > 0 && (
                  <>
                    {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                      <span className="composer-setting-label" data-control="observed-effort">
                        <span className="composer-setting-key">Observed effort</span>
                        <span className="composer-hint">{activeConfig.observed_effort || 'unknown'}</span>
                      </span>
                    )}
                    <label className="composer-setting-label" data-control="effort">
                      <span className="composer-setting-key">
                        {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' ? 'Next effort' : 'Effort'}
                      </span>
                      <select
                        className="composer-setting-select"
                        value={activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send'
                          ? (activeConfig.next_send_effort || '')
                          : (activeConfig.effort || 'medium')}
                        onChange={e => setAgentEffort(activeSession, e.target.value)}
                        title={`${activeSessionMeta?.agent_type === 'codex_cli' ? 'Codex' : activeSessionMeta?.agent_type === 'cursor_cli' ? 'Cursor' : 'Claude'} CLI effort`}
                      >
                        {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                          <option value="" disabled>Choose effort…</option>
                        )}
                        {(activeConfig.available_efforts || []).map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                      {activeSessionMeta?.agent_type === 'codex_cli' && activeConfig?.config_semantics === 'observed_and_next_send' && (
                        <span className="composer-hint">
                          {activeConfig.next_send_effort_status && activeConfig.next_send_effort_status !== 'unset'
                            ? activeConfig.next_send_effort_status
                            : 'No override selected'}
                        </span>
                      )}
                    </label>
                  </>
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
                    {activeConfig?.capabilities?.codex_model_change && <label className="composer-setting-label" data-control="model">
                      <span className="composer-setting-key">{activeSessionMeta?.agent_type === 'codex' ? 'Next model' : 'Model'}</span>
                      <select
                        className="composer-setting-select"
                        value={activeConfig.model_id || 'unknown'}
                        disabled={(activeSessionMeta?.agent_type === 'codex' && activeConfig.controls_available === false)
                          || ['pending', 'awaiting_config'].includes(configControlStates?.[`${activeSession}:model`]?.status)}
                        onChange={e => setCodexConfig(activeSession, { model_id: e.target.value })}
                        title={activeSessionMeta?.agent_type === 'codex' ? 'Next-turn Codex model' : 'Codex Desktop model'}
                      >
                        {(activeConfig.available_models || []).map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        {activeConfig.model_id && !(activeConfig.available_models || []).some(m => m.id === activeConfig.model_id) && activeConfig.model_id !== 'unknown' && (
                          <option value={activeConfig.model_id}>{activeConfig.model_id}</option>
                        )}
                      </select>
                    </label>}
                    {activeConfig?.capabilities?.codex_effort_change && <label className="composer-setting-label" data-control="effort">
                      <span className="composer-setting-key">{activeSessionMeta?.agent_type === 'codex' ? 'Next effort' : 'Effort'}</span>
                      <select
                        className="composer-setting-select"
                        value={(activeConfig.effort || 'unknown').toLowerCase()}
                        disabled={(activeSessionMeta?.agent_type === 'codex' && activeConfig.controls_available === false)
                          || ['pending', 'awaiting_config'].includes(configControlStates?.[`${activeSession}:effort`]?.status)}
                        onChange={e => setCodexConfig(activeSession, { effort: e.target.value })}
                        title={activeSessionMeta?.agent_type === 'codex' ? 'Next-turn reasoning effort' : 'Codex Desktop reasoning effort'}
                      >
                        {(activeConfig.available_efforts || []).map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </label>}
                    {activeConfig?.capabilities?.codex_permission_profile_change && <label className="composer-setting-label" data-control="permission-profile">
                      <span className="composer-setting-key">Next permissions</span>
                      <select
                        className="composer-setting-select"
                        value={activeConfig.permission_profile || 'unknown'}
                        disabled={activeConfig.controls_available === false
                          || ['pending', 'awaiting_config'].includes(configControlStates?.[`${activeSession}:permission_profile`]?.status)}
                        onChange={e => setCodexConfig(activeSession, { permission_profile: e.target.value })}
                        title="Next-turn native Codex permissions profile"
                      >
                        {activeConfig.permission_profile === 'full-access' && <option value="full-access" disabled>Full access</option>}
                        {(activeConfig.available_permission_profiles || []).filter(profile => profile.id !== 'full-access').map(profile => (
                          <option key={profile.id} value={profile.id}>{profile.label}</option>
                        ))}
                      </select>
                    </label>}
                    {activeConfig?.capabilities?.codex_bypass_permissions && <button
                      type="button"
                      className="composer-desktop-action composer-bypass-action"
                      onClick={() => { setShowSettings(true); setShowComposerSettings(false); }}
                      title="Review and confirm Full access in Session Settings"
                    >{activeConfig.bypass_permissions_active ? 'Bypass active' : 'Bypass…'}</button>}
                    {activeConfig?.capabilities?.codex_speed_change && <label className="composer-setting-label" data-control="speed">
                      <span className="composer-setting-key">Speed</span>
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
                    </label>}
                    {activeConfig?.capabilities?.codex_access_change && <label className="composer-setting-label" data-control="permission">
                      <span className="composer-setting-key">Access</span>
                      <select
                        className="composer-setting-select"
                        value={activeConfig.permission_mode || 'unknown'}
                        onChange={e => setCodexConfig(activeSession, { access_mode: e.target.value })}
                        title="Codex Desktop access mode"
                      >
                        {(activeConfig.available_access || []).map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        {activeConfig.permission_mode && !(activeConfig.available_access || []).some(m => m.id === activeConfig.permission_mode) && activeConfig.permission_mode !== 'unknown' && (
                          <option value={activeConfig.permission_mode}>{activeConfig.permission_mode}</option>
                        )}
                      </select>
                    </label>}
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
                <button
                  className="composer-desktop-action"
                  onClick={() => { setShowSettings(true); setShowComposerSettings(false); }}
                >⚙ Session details</button>
                <div className="composer-mobile-actions">
                  <button
                    className="composer-mobile-action"
                    onClick={() => { setShowSettings(true); setShowComposerSettings(false); }}
                  >⚙ Session details</button>
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

      {attentionToast && (
        <div className="attention-toast" role="status" aria-live="polite">
          <span className={`attention-toast-icon ${attentionToast.kind}`} aria-hidden="true">
            {attentionToast.kind === 'prompt' || ['goal_attention', 'provider_usage_threshold'].includes(attentionToast.kind) ? '!' : '✓'}
          </span>
          <span className="attention-toast-copy">
            <strong>{attentionToast.title}</strong>
            <span>{attentionToast.detail}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              const session = orderedSessions.find(item => sessionIdOf(item) === attentionToast.sessionId);
              if (session) selectSession(attentionToast.sessionId, session);
              clearAttentionToast();
            }}
          >Jump</button>
        </div>
      )}
      <div className={`toast ${toast ? 'visible' : ''}`}>{toast}</div>
    </div>
  );
}

export { App };

const renderProfileEnabled = (() => {
  try { return new URLSearchParams(window.location.search).get('render_profile') === '1'; }
  catch { return false; }
})();

function recordRenderProfile(id, phase, actualDuration, baseDuration, startTime, commitTime) {
  const entries = window.__RAC_RENDER_PROFILER__ || (window.__RAC_RENDER_PROFILER__ = []);
  entries.push({
    id,
    phase,
    route: document.querySelector('[data-testid="fleet-view"]')
      ? 'fleet'
      : document.querySelector('[data-testid="usage-dashboard"]')
        ? 'usage'
        : document.querySelector('[data-testid="host-resource-dashboard"]')
          ? 'host-resources'
          : document.querySelector('.messages')
            ? 'chat'
            : 'other',
    actual_duration_ms: Number(actualDuration.toFixed(3)),
    base_duration_ms: Number(baseDuration.toFixed(3)),
    start_time_ms: Number(startTime.toFixed(3)),
    commit_time_ms: Number(commitTime.toFixed(3)),
  });
  if (entries.length > 2000) entries.splice(0, entries.length - 2000);
}

const appRoot = (
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

ReactDOM.createRoot(document.getElementById('root')).render(
  renderProfileEnabled
    ? <React.Profiler id="AgentChatRoot" onRender={recordRenderProfile}>{appRoot}</React.Profiler>
    : appRoot
);
