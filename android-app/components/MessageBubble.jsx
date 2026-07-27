import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, useColorScheme,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import ToolSection from './ToolSection';
import CollapsibleBlock from './CollapsibleBlock';
import {
  formatAbsoluteMessageTime,
  formatVisibleMessageTime,
  messageInstant,
  parseMessageInstant,
} from '../lib/message-time';
const {
  normalizeMessageBlocks,
  terminalText,
  fileChangesText,
  extractLegacyToolResult,
  blocksToPlainText,
} = require('../lib/content-blocks');

// Renders a single chat message (user or assistant).
// Props:
//   message — { role, content, sequence, timestamp }
//   content may be a string or an array of content blocks (Claude format)
export default function MessageBubble({ message, agentType, deliveryState, onRetry }) {
  const isUser = message.role === 'user';
  const blocks = normalizeMessageBlocks(message);
  const isLight = useColorScheme() === 'light';
  const transcriptTheme = themeForAgent(agentType, isLight);
  const nativeLayout = nativeMessageLayout(agentType);
  const [showCopied, setShowCopied] = useState(false);
  const instant = messageInstant(message);
  const absoluteTimestamp = instant ? formatAbsoluteMessageTime(instant) : 'time unknown';
  const visibleTimestamp = instant ? formatVisibleMessageTime(instant) : 'Time unknown';
  const deliveryText = isUser ? deliveryLabel(message, deliveryState) : '';
  const deliveryFailure = isUser ? deliveryFailureForMessage(message, deliveryState, onRetry) : null;

  const copyMessage = useCallback(() => {
    const plain = blocksToPlainText(blocks);
    if (!plain) return;
    Clipboard.setStringAsync(plain);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1500);
  }, [blocks]);

  const bubble = (
    <Pressable
      style={nativeLayout === 'codex-terminal' ? s.terminalContent : null}
      onLongPress={copyMessage}
      delayLongPress={400}
    >
      <View style={[
        s.bubble,
        isUser ? s.bubbleUser : s.bubbleAssistant,
        nativeLayout === 'claude-document' && s.bubbleDocument,
        nativeLayout === 'codex-terminal' && s.bubbleTerminal,
        nativeLayout === 'cursor-cards' && s.bubbleCursorCard,
        nativeLayout === 'codex-thread' && !isUser && s.bubbleCodexAssistant,
        nativeLayout === 'codex-thread' && isUser && s.bubbleCodexUser,
        (nativeLayout === 'claude-document' || nativeLayout === 'codex-terminal' || (nativeLayout === 'codex-thread' && !isUser))
          && { backgroundColor: 'transparent' },
        nativeLayout === 'cursor-cards' && { backgroundColor: isLight ? '#f6f8fa' : '#161b22' },
      ]}>
        {blocks.map((block, i) => renderBlock(block, i, isUser, transcriptTheme))}
        {showCopied && (
          <View style={s.copiedToast}>
            <Text style={s.copiedText}>Copied</Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  return (
    <View style={[
      s.wrapper,
      isUser ? s.wrapperUser : s.wrapperAssistant,
      nativeLayout !== 'unified-flow' && s.wrapperNativeFull,
    ]}>
      {nativeLayout === 'codex-terminal' ? (
        <View style={s.terminalRow}>
          <Text style={s.terminalGutter}>{isUser ? 'IN' : 'OUT'}</Text>
          {bubble}
        </View>
      ) : bubble}
      <View style={[s.metaRow, isUser && s.metaRowUser]}>
          <Text
            style={[s.time, isLight && s.timeLight, isUser && s.timeUser]}
            accessibilityLabel={`Sent ${absoluteTimestamp}`}
          >
            {visibleTimestamp}
          </Text>
          {isUser && (
            <>
              <Text
                style={[s.delivery, deliveryFailure && s.deliveryFailed]}
                accessibilityLabel={deliveryText.replace(/^[✓✕▶↗·\s]+/u, '') || deliveryText}
              >
                {deliveryText}
              </Text>
              {deliveryFailure && (
                <View style={s.deliveryActions}>
                  {deliveryFailure.canRetry && (
                    <Pressable
                      style={[s.deliveryAction, isLight && s.deliveryActionLight]}
                      onPress={() => onRetry(message)}
                      accessibilityRole="button"
                      accessibilityLabel="Retry failed message"
                      accessibilityHint={deliveryFailure.detail}
                    >
                      <Text style={[s.deliveryActionText, isLight && s.deliveryActionTextLight]}>Retry</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[s.deliveryAction, isLight && s.deliveryActionLight]}
                    onPress={copyMessage}
                    accessibilityRole="button"
                    accessibilityLabel="Copy failed message"
                  >
                    <Text style={[s.deliveryActionText, isLight && s.deliveryActionTextLight]}>Copy</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
      </View>
    </View>
  );
}

// ── Content normalization ─────────────────────────────────────────────────────

// ── Block renderers ───────────────────────────────────────────────────────────

function renderBlock(block, i, isUser, theme) {
  switch (block.type) {
    case 'text':
      if (isUser) {
        return <Text key={i} style={[s.text, theme.userText]} selectable>{block.text}</Text>;
      }
      return (
        <Markdown key={i} style={theme.markdown}>
          {block.text}
        </Markdown>
      );

    case 'markdown':
      return (
        <Markdown key={i} style={theme.markdown}>
          {block.content || block.text || block.markdown || ''}
        </Markdown>
      );

    case 'tool_use':
      return (
        <ToolSection
          key={i}
          name={block.name}
          input={block.input}
          textTheme={theme.tool}
          light={theme.isLight}
          defaultOpen
        />
      );

    case 'tool_result':
      return (
        <ToolSection
          key={i}
          name={block.tool_name || 'Result'}
          input={null}
          output={extractToolResultText(block.content)}
          isError={block.is_error}
          textTheme={theme.tool}
          light={theme.isLight}
          defaultOpen
        />
      );

    case 'tool_call':
      return (
        <ToolSection
          key={i}
          name={block.label || block.title || 'Tool'}
          input={block.command ? { command: block.command } : null}
          output={block.content || block.text || null}
          isError={block.status === 'error'}
          status={block.status}
          textTheme={theme.tool}
          light={theme.isLight}
          defaultOpen
        />
      );

    case 'terminal':
      if (theme.nativeClaudeTerminal) {
        return <ClaudeTerminalBlock key={i} block={block} light={theme.isLight} />;
      }
      if (theme.nativeDesktopTerminal) {
        return <CodexDesktopTerminalBlock key={i} block={block} light={theme.isLight} />;
      }
      return (
        <ToolSection
          key={i}
          name={block.label || block.title || 'Terminal'}
          input={block.command ? { command: block.command } : null}
          output={terminalText({ ...block, command: '' })}
          isError={!!block.stderr || (block.exit_code != null && block.exit_code !== 0)}
          textTheme={theme.tool}
          light={theme.isLight}
          status={block.exit_code != null ? `exit ${block.exit_code}` : block.status}
          defaultOpen
        />
      );

    case 'file_changes':
      if (theme.nativeCursorFileChangeSummary && isCursorFileChangeSummaryOnly(block)) {
        return renderCursorFileChangeSummary(block, i, theme);
      }
      return renderStructuredCard(block, i, 'File changes', 'file', theme.markdown);

    case 'artifact':
      return renderStructuredCard(block, i, 'Artifact', 'artifact', theme.markdown);

    case 'prompt':
      return renderStructuredCard(block, i, 'Permission required', 'prompt', theme.markdown);

    case 'plan':
      return (
        <View key={i} style={[s.structuredCard, s.structuredCard_plan]}>
          <Text style={s.structuredTitle}>{block.label || block.title || 'Plan'}</Text>
          {Array.isArray(block.tasks) && block.tasks.map((task, taskIndex) => {
            const state = task.state || task.status || 'pending';
            return (
              <View key={task.id || taskIndex} style={s.planRow}>
                <Text style={[s.planMarker, state === 'completed' && s.planMarkerComplete]}>
                  {state === 'completed' ? '✓' : state === 'in_progress' ? '•' : '○'}
                </Text>
                <Text style={[s.planText, state === 'completed' && s.planTextComplete]} selectable>
                  {task.text || task.step || task.title || ''}
                </Text>
              </View>
            );
          })}
        </View>
      );

    case 'queued_message':
      return renderStructuredCard(block, i, 'Queued message', 'queued', theme.markdown);

    case 'notice':
      if (theme.nativeInlineNotice) {
        return renderCursorNativeNotice(block, i, theme);
      }
      if (theme.nativeDesktopNotice) {
        return renderCodexDesktopNotice(block, i, theme);
      }
      return renderStructuredCard(block, i, 'Notice', 'notice', theme.markdown);

    case 'memory_citation':
      return renderStructuredCard(block, i, 'Sources', 'notice', theme.markdown);

    case 'error':
      if (theme.nativeAntigravityError) {
        return <AntigravityErrorBlock key={i} block={block} theme={theme} />;
      }
      if (theme.nativePlainError) {
        return (
          <Text key={i} style={[theme.markdown.body, s.cursorNativeError]} selectable accessibilityRole="alert">
            <Text style={s.cursorNativeErrorLabel}>{block.label || block.title || 'Error'}: </Text>
            {block.content || block.text || block.markdown || ''}
          </Text>
        );
      }
      return renderStructuredCard(block, i, 'Error', 'error', theme.markdown);

    case 'status':
      return (
        <View key={i} style={s.statusChip}>
          <Text style={s.statusChipText}>{block.label || block.title || block.content || 'Status'}</Text>
        </View>
      );

    case 'thinking':
      if (block.activity_summary === true && theme.nativeCodexActivitySummary) {
        return <CodexActivitySummaryBlock key={block.native_source_id || i} block={block} theme={theme} />;
      }
      if (theme.nativePlainThinking) {
        const content = block.content || block.thinking || block.text || '';
        return content ? <Markdown key={i} style={theme.markdown}>{content}</Markdown> : null;
      }
      if (theme.nativeDesktopThinking) {
        const label = block.label || block.title || 'Worked';
        const content = block.content || block.thinking || block.text || '';
        const bodyIsTitleOnly = !content || String(content).replace(/\s+/g, ' ').trim() === String(label).replace(/\s+/g, ' ').trim();
        return (
          <View key={i} style={s.codexDesktopThinking}>
            <View style={s.codexDesktopThinkingHeader}>
              <Text style={s.codexDesktopThinkingLabel}>{label}</Text>
              <Text style={s.codexDesktopThinkingChevron} accessibilityElementsHidden>⌄</Text>
            </View>
            {!bodyIsTitleOnly && <Markdown style={theme.markdown}>{content}</Markdown>}
          </View>
        );
      }
      return (
        <View key={i} style={s.thinkingBlock}>
          <Text style={s.thinkingLabel}>{block.label || block.title || 'Thinking'}</Text>
          <Text style={[s.thinkingText, theme.thinking]} selectable>{block.content || block.thinking}</Text>
        </View>
      );

    default:
      return null;
  }
}

function CodexActivitySummaryBlock({ block, theme }) {
  const content = String(block.content || block.thinking || block.text || '').trim();
  if (!content) return null;
  const instant = parseMessageInstant(
    block.producer_timestamp || block.created_at || block.timestamp || block.ts,
  );
  const visibleTimestamp = instant ? formatVisibleMessageTime(instant) : 'Time unknown';
  const absoluteTimestamp = instant ? formatAbsoluteMessageTime(instant) : 'time unknown';
  const activityMarkdown = {
    ...theme.markdown,
    body: {
      ...(theme.markdown?.body || {}),
      ...(theme.thinking || {}),
      fontStyle: 'normal',
    },
    paragraph: {
      ...(theme.markdown?.paragraph || {}),
      marginTop: 0,
      marginBottom: 0,
    },
  };
  return (
    <View
      style={s.codexActivitySummary}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Codex activity summary. ${content}. Sent ${absoluteTimestamp}`}
    >
      <CollapsibleBlock maxHeight={154}>
        <Markdown style={activityMarkdown}>{content}</Markdown>
      </CollapsibleBlock>
      <Text style={[s.codexActivitySummaryTime, theme.isLight && s.codexActivitySummaryTimeLight]}>
        {visibleTimestamp}
      </Text>
    </View>
  );
}

function ClaudeTerminalBlock({ block, light }) {
  const title = String(block.label || block.title || 'Bash').trim();
  const titleParts = title.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const toolName = titleParts?.[1] || 'Bash';
  const description = titleParts?.[2] || '';
  const status = String(block.status || 'running').toLowerCase();
  const failed = status === 'error' || status === 'failed';
  const rows = [
    block.command ? { label: 'IN', text: block.command, error: false } : null,
    block.stdout ? { label: 'OUT', text: block.stdout, error: false } : null,
    block.stderr ? { label: 'ERR', text: block.stderr, error: true } : null,
  ].filter(Boolean);
  return (
    <View style={s.claudeTerminal} accessibilityLabel={title}>
      <View style={s.claudeTerminalHeader}>
        <View style={[
          s.claudeTerminalDot,
          status === 'completed' && s.claudeTerminalDotCompleted,
          failed && s.claudeTerminalDotFailed,
        ]} />
        <Text style={[s.claudeTerminalName, light && s.claudeTerminalTextLight]}>{toolName}</Text>
        {!!description && (
          <Text style={[s.claudeTerminalDescription, light && s.claudeTerminalTextLight]}>{description}</Text>
        )}
      </View>
      {rows.length > 0 && (
        <View style={[s.claudeTerminalBody, light && s.claudeTerminalBodyLight]}>
          {rows.map((row, index) => (
            <View key={`${row.label}-${index}`} style={[
              s.claudeTerminalRow,
              index > 0 && s.claudeTerminalRowBorder,
              index > 0 && light && s.claudeTerminalRowBorderLight,
            ]}>
              <Text style={[s.claudeTerminalRowLabel, light && s.claudeTerminalMutedLight]}>{row.label}</Text>
              <Text style={[
                s.claudeTerminalRowText,
                light && s.claudeTerminalTextLight,
                row.error && s.claudeTerminalRowError,
              ]} selectable>{row.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CodexDesktopTerminalBlock({ block, light }) {
  const [open, setOpen] = useState(true);
  const body = terminalText(block);
  return (
    <View style={s.codexDesktopTerminal}>
      <Pressable
        style={s.codexDesktopTerminalHeader}
        onPress={() => setOpen(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.codexDesktopTerminalIcon, light && s.codexDesktopTerminalMutedLight]} accessibilityElementsHidden>▣</Text>
        <Text style={[s.codexDesktopTerminalLabel, light && s.codexDesktopTerminalMutedLight]}>Ran commands</Text>
        <Text style={[s.codexDesktopTerminalChevron, light && s.codexDesktopTerminalMutedLight]} accessibilityElementsHidden>{open ? '⌄' : '›'}</Text>
      </Pressable>
      {open && !!body && (
        <Text style={[s.codexDesktopTerminalBody, light && s.codexDesktopTerminalBodyLight]} selectable>{body}</Text>
      )}
    </View>
  );
}

function AntigravityErrorBlock({ block, theme }) {
  const [open, setOpen] = useState(false);
  const title = block.label || block.title || 'Error';
  const body = block.content || block.text || block.markdown || '';
  const actions = Array.isArray(block.actions) ? block.actions : [];
  return (
    <View style={s.antigravityError} accessibilityRole="alert">
      <Pressable
        style={s.antigravityErrorSummary}
        onPress={() => setOpen(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[title, body].filter(Boolean).join(' ')}
      >
        <Text style={[theme.markdown.body, s.antigravityErrorText]} selectable>
          <Text style={s.antigravityErrorLabel}>{title}</Text>
          {!!body && ` ${body}`}
        </Text>
        <Text style={s.antigravityErrorChevron} accessibilityElementsHidden>{open ? '\u2304' : '\u203A'}</Text>
      </Pressable>
      {open && actions.length > 0 && (
        <View style={s.structuredActions}>
          {actions.map((action, index) => (
            <View key={action.id || index} style={s.structuredAction}>
              <Text style={s.structuredActionText}>{action.label || action.id || 'Action'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function renderStructuredCard(block, key, fallbackTitle, tone, activeMarkdownStyles) {
  const body = block.type === 'file_changes'
    ? fileChangesText(block)
    : (block.content || block.text || block.markdown || '');
  const actions = Array.isArray(block.actions) ? block.actions : [];
  return (
    <View key={key} style={[s.structuredCard, s[`structuredCard_${tone}`]]}>
      <Text style={s.structuredTitle}>{block.label || block.title || block.summary || fallbackTitle}</Text>
      {!!body && <Markdown style={activeMarkdownStyles}>{body}</Markdown>}
      {actions.length > 0 && (
        <View style={s.structuredActions}>
          {actions.map((action, index) => (
            <View key={action.id || index} style={s.structuredAction}>
              <Text style={s.structuredActionText}>{action.label || action.id || 'Action'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function cursorFileChangeSummaryParts(value) {
  const match = String(value || '').trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);
  if (!match) return null;
  return { label: match[1], additions: match[2] || '', deletions: match[3] || '' };
}

function isCursorFileChangeSummaryOnly(block) {
  const title = block.label || block.title || block.summary || '';
  return Boolean(
    cursorFileChangeSummaryParts(title)
    && !(block.content || block.text || block.markdown)
    && (!Array.isArray(block.files) || block.files.length === 0)
    && (!Array.isArray(block.actions) || block.actions.length === 0)
  );
}

function renderCursorFileChangeSummary(block, key, theme) {
  const title = block.label || block.title || block.summary || '';
  const summary = cursorFileChangeSummaryParts(title);
  return (
    <Text
      key={key}
      style={[theme.markdown.body, s.cursorFileChangeSummary]}
      selectable
      accessibilityLabel={title}
    >
      {summary.label}
      {!!summary.additions && <Text style={s.cursorFileChangeAdditions}>{` ${summary.additions}`}</Text>}
      {!!summary.deletions && <Text style={s.cursorFileChangeDeletions}>{` ${summary.deletions}`}</Text>}
    </Text>
  );
}

function renderCursorNativeNotice(block, key, theme) {
  const title = block.label || block.title || block.summary || '';
  const body = block.content || block.text || block.markdown || '';
  const actions = Array.isArray(block.actions) ? block.actions : [];
  const text = [title, body].filter(Boolean).join(title && body ? ': ' : '');
  return (
    <View
      key={key}
      style={[s.cursorNativeNotice, theme.isLight && s.cursorNativeNoticeLight]}
      accessibilityRole="alert"
    >
      <Text style={[s.cursorNativeNoticeIcon, theme.isLight && s.cursorNativeNoticeIconLight]} accessibilityElementsHidden>
        {'\u24D8'}
      </Text>
      <View style={s.cursorNativeNoticeContent}>
        <Text style={[theme.markdown.body, s.cursorNativeNoticeText]} selectable>{text || 'Notice'}</Text>
        {actions.length > 0 && (
          <View style={s.cursorNativeNoticeActions}>
            {actions.map((action, index) => (
              <View key={action.id || index} style={[s.structuredAction, s.cursorNativeNoticeAction]}>
                <Text style={[s.structuredActionText, s.cursorNativeNoticeActionText]}>
                  {action.label || action.id || 'Action'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function renderCodexDesktopNotice(block, key, theme) {
  const title = block.label || block.title || block.summary || 'Notice';
  const body = block.content || block.text || block.markdown || '';
  const actions = Array.isArray(block.actions) ? block.actions : [];
  return (
    <View key={key} style={s.codexDesktopNotice} accessibilityRole="alert">
      <Text style={s.codexDesktopNoticeIcon} accessibilityElementsHidden>{'\u25F4'}</Text>
      <View style={s.codexDesktopNoticeContent}>
        <Text style={s.codexDesktopNoticeTitle} selectable>{title}</Text>
        {!!body && <Markdown style={theme.markdown}>{body}</Markdown>}
        {actions.length > 0 && (
          <View style={s.codexDesktopNoticeActions}>
            {actions.map((action, index) => (
              <View key={action.id || index} style={s.codexDesktopNoticeAction}>
                <Text style={s.codexDesktopNoticeActionText}>{action.label || action.id || 'Action'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function nativeMessageLayout(agentType) {
  const type = String(agentType || '').toLowerCase();
  if (type === 'claude' || type === 'claude_cli') return 'claude-document';
  if (type === 'codex_cli') return 'codex-terminal';
  if (type === 'cursor') return 'cursor-cards';
  if (type === 'codex' || type === 'codex-desktop') return 'codex-thread';
  return 'unified-flow';
}

// Split text at code fence boundaries and wrap each segment in a CollapsibleBlock.
// Text segments collapse at ~240px (~12 lines), code segments at ~120px (~6 lines).
function renderCollapsibleText(text, blockKey) {
  const segments = splitAtFences(text);

  // Single short segment — render directly without collapse wrapper
  if (segments.length === 1 && countLines(segments[0].content) <= 15) {
    return (
      <Markdown key={blockKey} style={markdownStyles}>
        {segments[0].content}
      </Markdown>
    );
  }

  return (
    <View key={blockKey}>
      {segments.map((seg, j) => {
        const lineCount = countLines(seg.content);
        const threshold = seg.type === 'code' ? 120 : 240;
        const needsCollapse = seg.type === 'code' ? lineCount > 6 : lineCount > 12;

        if (!needsCollapse) {
          return (
            <Markdown key={j} style={markdownStyles}>
              {seg.content}
            </Markdown>
          );
        }

        return (
          <CollapsibleBlock key={j} maxHeight={threshold}>
            <Markdown style={markdownStyles}>
              {seg.content}
            </Markdown>
          </CollapsibleBlock>
        );
      })}
    </View>
  );
}

// Split markdown text into alternating text/code segments at ``` fence boundaries.
function splitAtFences(text) {
  const segments = [];
  const fenceRegex = /^(```[^\n]*\n[\s\S]*?\n```)/gm;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(text)) !== null) {
    // Text before the fence
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
    }
    segments.push({ type: 'code', content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last fence
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim();
    if (rest) segments.push({ type: 'text', content: rest });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}

function countLines(text) {
  return (text.match(/\n/g) || []).length + 1;
}

const extractToolResultText = extractLegacyToolResult;

// ── Time format ───────────────────────────────────────────────────────────────

// ── Markdown styles ──────────────────────────────────────────────────────────

const markdownStyles = {
  body:         { color: '#cdd9e5', fontSize: 14, lineHeight: 20 },
  paragraph:    { marginTop: 0, marginBottom: 6 },
  code_block:   { backgroundColor: '#0d1117', color: '#e6edf3', fontFamily: 'monospace',
                  padding: 10, borderRadius: 6, fontSize: 12, lineHeight: 17 },
  code_inline:  { backgroundColor: '#21262d', color: '#e6edf3', fontFamily: 'monospace',
                  paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, fontSize: 13 },
  fence:        { backgroundColor: '#0d1117', color: '#e6edf3', fontFamily: 'monospace',
                  padding: 10, borderRadius: 6, fontSize: 12, lineHeight: 17,
                  borderWidth: 1, borderColor: '#21262d' },
  blockquote:   { borderLeftColor: '#30363d', borderLeftWidth: 3, paddingLeft: 10,
                  backgroundColor: 'transparent' },
  link:         { color: '#58a6ff', textDecorationLine: 'none' },
  heading1:     { color: '#cdd9e5', fontWeight: '700', fontSize: 20, marginBottom: 8, marginTop: 12 },
  heading2:     { color: '#cdd9e5', fontWeight: '700', fontSize: 17, marginBottom: 6, marginTop: 10 },
  heading3:     { color: '#cdd9e5', fontWeight: '600', fontSize: 15, marginBottom: 4, marginTop: 8 },
  bullet_list:  { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item:    { marginVertical: 2 },
  strong:       { color: '#cdd9e5', fontWeight: '700' },
  em:           { color: '#cdd9e5', fontStyle: 'italic' },
  hr:           { backgroundColor: '#21262d', height: 1, marginVertical: 8 },
  table:        { borderColor: '#30363d' },
  thead:        { backgroundColor: '#161b22' },
  th:           { color: '#cdd9e5', fontWeight: '600', padding: 6, borderColor: '#30363d' },
  td:           { color: '#cdd9e5', padding: 6, borderColor: '#30363d' },
};

// ── Styles ──────────────────────────────────────────────────────────────────────

const continueMarkdownStyles = {
  ...markdownStyles,
  body:        { ...markdownStyles.body, color: '#cccccc', fontSize: 14, lineHeight: 21 },
  paragraph:   { ...markdownStyles.paragraph, marginBottom: 4 },
  code_block:  { ...markdownStyles.code_block, fontSize: 14, lineHeight: 21, borderRadius: 0 },
  code_inline: { ...markdownStyles.code_inline, fontSize: 14, borderRadius: 0 },
  fence:       { ...markdownStyles.fence, fontSize: 14, lineHeight: 21, borderRadius: 0 },
  heading1:    { ...markdownStyles.heading1, color: '#cccccc', fontSize: 18 },
  heading2:    { ...markdownStyles.heading2, color: '#cccccc', fontSize: 16 },
  heading3:    { ...markdownStyles.heading3, color: '#cccccc', fontSize: 14 },
  strong:      { ...markdownStyles.strong, color: '#cccccc' },
  em:          { ...markdownStyles.em, color: '#cccccc' },
  th:          { ...markdownStyles.th, color: '#cccccc' },
  td:          { ...markdownStyles.td, color: '#cccccc' },
};

const defaultTranscriptTheme = {
  markdown: markdownStyles,
  userText: null,
  thinking: null,
  tool: null,
};

function measuredTranscriptTheme({
  bodySize,
  bodyLine,
  codeSize,
  codeLine,
  bodyColor = '#cdd9e5',
  mutedColor = '#768390',
  monospaceBody = false,
  userSize = bodySize,
  userLine = bodyLine,
}) {
  const bodyFont = monospaceBody ? { fontFamily: 'monospace' } : {};
  const themedMarkdown = {
    ...markdownStyles,
    body:        { ...markdownStyles.body, ...bodyFont, color: bodyColor, fontSize: bodySize, lineHeight: bodyLine },
    code_block:  { ...markdownStyles.code_block, fontSize: codeSize, lineHeight: codeLine },
    code_inline: { ...markdownStyles.code_inline, fontSize: codeSize },
    fence:       { ...markdownStyles.fence, fontSize: codeSize, lineHeight: codeLine },
    heading1:    { ...markdownStyles.heading1, ...bodyFont, color: bodyColor, fontSize: Math.max(bodySize + 5, 17) },
    heading2:    { ...markdownStyles.heading2, ...bodyFont, color: bodyColor, fontSize: Math.max(bodySize + 3, 15) },
    heading3:    { ...markdownStyles.heading3, ...bodyFont, color: bodyColor, fontSize: Math.max(bodySize + 1, 14) },
    strong:      { ...markdownStyles.strong, ...bodyFont, color: bodyColor },
    em:          { ...markdownStyles.em, ...bodyFont, color: bodyColor },
    th:          { ...markdownStyles.th, ...bodyFont, color: bodyColor },
    td:          { ...markdownStyles.td, ...bodyFont, color: bodyColor },
  };
  return {
    markdown: themedMarkdown,
    userText: { ...bodyFont, color: bodyColor, fontSize: userSize, lineHeight: userLine },
    thinking: { ...bodyFont, color: mutedColor, fontSize: Math.max(bodySize - 1, 11), lineHeight: bodyLine },
    tool: {
      body: { ...bodyFont, color: bodyColor, fontSize: bodySize, lineHeight: bodyLine },
      muted: { color: mutedColor },
      code: { color: bodyColor, fontFamily: 'monospace', fontSize: codeSize, lineHeight: codeLine },
    },
  };
}

function deliveryFailureText(value) {
  const raw = String(value || 'Send failed').trim();
  const normalized = raw.toLowerCase();
  if (normalized.includes('pending_revalidation')
      || normalized.includes('fixture version mismatch')
      || normalized.includes('validation pending')) return 'Update validation pending';
  if (normalized.includes('agent_busy') || normalized.includes('agent is generating')) return 'Agent busy';
  if (normalized.includes('codex_desktop_thread_not_open')
      || normalized.includes('codex_desktop_thread_changed')
      || normalized.includes('open this thread')) return 'Open this thread in Codex Desktop';
  if (normalized.includes('native_user_turn_not_observed')
      || normalized.includes('native user turn')
      || normalized.includes('could not confirm native delivery')) return 'Could not confirm native delivery';
  if (normalized.includes('input_verify_failed')
      || normalized.includes('composer input could not be verified')
      || normalized.includes('verified send-ready state')) return 'Composer input could not be verified';
  if (normalized === 'send_failed') return 'Send failed';
  return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
}

function deliveryFailureForMessage(message, deliveryState, onRetry) {
  if (deliveryState && deliveryState !== 'failed') return null;
  if (deliveryState !== 'failed' && message.status !== 'failed') return null;
  const detail = message.failure_reason || message._sendError || message.failure_code || 'Send failed';
  const retrySafetyKnown = message.failure_retryable != null || message.failure_native_attempted != null;
  const canRetry = typeof onRetry === 'function' && (
    (message.failure_retryable === true && message.failure_native_attempted === false)
    || (message._optimistic && !retrySafetyKnown)
  );
  return { detail, canRetry };
}

function deliveryLabel(message, deliveryState) {
  if (deliveryState === 'offline_queued') return 'Queued offline';
  if (deliveryState === 'queued') return 'Sending…';
  if (deliveryState === 'busy_queued' || message._queued) return 'Queued';
  if (deliveryState === 'steered') return 'Steered';
  if (deliveryState === 'failed') return `✕ ${deliveryFailureText(message.failure_reason || message._sendError || message.failure_code)}`;
  if (deliveryState === 'launch_accepted') return '↗ Native launch accepted · receipt pending';
  if (deliveryState === 'delivered') return '✓✓ Delivered';
  if (deliveryState === 'agent_started' || message._agentStarted) return '▶ Agent started';
  if (message._delivered) return '✓✓ Delivered';
  if (message.status === 'failed') return `✕ ${deliveryFailureText(message.failure_reason || message.failure_code || message._sendError)}`;
  if (message._launchAcceptedAt || message.launch_accepted_at) return '↗ Native launch accepted · receipt pending';
  if (message.status === 'accepted') return '✓ Relay accepted';
  return 'Recorded · receipt unknown';
}

const continueTranscriptTheme = {
  markdown: continueMarkdownStyles,
  userText: { color: '#cccccc', fontSize: 14, lineHeight: 21 },
  thinking: { color: '#999999', fontSize: 13, lineHeight: 21 },
  tool: {
    body: { color: '#cccccc', fontSize: 14, lineHeight: 21 },
    muted: { color: '#999999' },
    code: { color: '#cccccc', fontFamily: 'monospace', fontSize: 14, lineHeight: 21 },
  },
};

const antigravityTranscriptTheme = measuredTranscriptTheme({
  bodySize: 14, bodyLine: 23, codeSize: 14, codeLine: 23, bodyColor: '#cccccc', mutedColor: '#949494',
});
const cliTranscriptTheme = measuredTranscriptTheme({
  bodySize: 13, bodyLine: 20, codeSize: 12, codeLine: 18, bodyColor: '#c9d1d9', mutedColor: '#8b949e', monospaceBody: true,
});
const observedTranscriptThemes = {
  claude: measuredTranscriptTheme({ bodySize: 13, bodyLine: 19.5, codeSize: 12, codeLine: 18.5, mutedColor: '#9d9d9d' }),
  codex: measuredTranscriptTheme({ bodySize: 13, bodyLine: 21, codeSize: 12, codeLine: 18.5, mutedColor: '#9d9d9d' }),
  'codex-desktop': measuredTranscriptTheme({ bodySize: 14, bodyLine: 22, codeSize: 13, codeLine: 20, mutedColor: '#9d9d9d' }),
  cursor: measuredTranscriptTheme({ bodySize: 14, bodyLine: 21, codeSize: 14, codeLine: 20, mutedColor: '#858585' }),
  continue: continueTranscriptTheme,
  continue_yolo: continueTranscriptTheme,
  'antigravity-v2': antigravityTranscriptTheme,
  antigravity: antigravityTranscriptTheme,
  antigravity_panel: antigravityTranscriptTheme,
  claude_cli: cliTranscriptTheme,
  codex_cli: cliTranscriptTheme,
  cursor_cli: cliTranscriptTheme,
};

const lightCodeBackgrounds = {
  claude: '#f4f4f4',
  codex: '#f3f3f3',
  'codex-desktop': '#f2f3f5',
  cursor: '#f5f5f5',
  continue: '#f5f5f5',
  continue_yolo: '#f5f5f5',
  'antigravity-v2': '#fafafa',
  antigravity: '#fafafa',
  antigravity_panel: '#fafafa',
  claude_cli: '#f6f8fa',
  codex_cli: '#f6f8fa',
  cursor_cli: '#f6f8fa',
};

function lightTranscriptTheme(darkTheme, agentType) {
  const codeBackground = lightCodeBackgrounds[agentType] || '#f6f8fa';
  const markdown = darkTheme.markdown || markdownStyles;
  const lightMarkdown = {
    ...markdown,
    body:        { ...markdown.body, color: '#24292f' },
    code_block:  { ...markdown.code_block, backgroundColor: codeBackground, color: '#24292f', borderWidth: 1, borderColor: '#d0d7de' },
    code_inline: { ...markdown.code_inline, backgroundColor: '#eff1f3', color: '#24292f' },
    fence:       { ...markdown.fence, backgroundColor: codeBackground, color: '#24292f', borderColor: '#d0d7de' },
    blockquote:  { ...markdown.blockquote, borderLeftColor: '#afb8c1' },
    link:        { ...markdown.link, color: '#0969da' },
    heading1:    { ...markdown.heading1, color: '#24292f' },
    heading2:    { ...markdown.heading2, color: '#24292f' },
    heading3:    { ...markdown.heading3, color: '#24292f' },
    strong:      { ...markdown.strong, color: '#24292f' },
    em:          { ...markdown.em, color: '#24292f' },
    hr:          { ...markdown.hr, backgroundColor: '#d0d7de' },
    table:       { ...markdown.table, borderColor: '#d0d7de' },
    thead:       { ...markdown.thead, backgroundColor: '#f6f8fa' },
    th:          { ...markdown.th, color: '#24292f', borderColor: '#d0d7de' },
    td:          { ...markdown.td, color: '#24292f', borderColor: '#d0d7de' },
  };
  return {
    ...darkTheme,
    isLight: true,
    markdown: lightMarkdown,
    userText: { ...(darkTheme.userText || {}), color: '#24292f' },
    thinking: { ...(darkTheme.thinking || {}), color: '#57606a' },
    tool: {
      body: { ...(darkTheme.tool?.body || {}), color: '#24292f' },
      muted: { ...(darkTheme.tool?.muted || {}), color: '#57606a' },
      code: { ...(darkTheme.tool?.code || {}), color: '#24292f' },
    },
  };
}

function themeForAgent(agentType, isLight = false) {
  const darkTheme = observedTranscriptThemes[agentType] || defaultTranscriptTheme;
  const resolved = isLight ? lightTranscriptTheme(darkTheme, agentType) : { ...darkTheme, isLight: false };
  const normalizedAgent = String(agentType || '').toLowerCase();
  return {
    ...resolved,
    nativeAntigravityError: normalizedAgent === 'antigravity-v2',
    nativePlainError: normalizedAgent === 'cursor',
    nativeCursorFileChangeSummary: normalizedAgent === 'cursor',
    nativeInlineNotice: normalizedAgent === 'cursor',
    nativeDesktopNotice: normalizedAgent === 'codex-desktop' && isLight,
    nativeCodexActivitySummary: ['codex', 'codex-desktop', 'codex_cli'].includes(normalizedAgent),
    nativePlainThinking: normalizedAgent === 'codex',
    nativeDesktopThinking: normalizedAgent === 'codex-desktop',
    nativeClaudeTerminal: normalizedAgent === 'claude',
    nativeDesktopTerminal: normalizedAgent === 'codex-desktop',
  };
}

const s = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    marginVertical:    4,
  },
  wrapperUser: {
    alignItems: 'flex-end',
  },
  wrapperAssistant: {
    alignItems: 'flex-start',
  },
  wrapperNativeFull: {
    alignItems: 'stretch',
  },
  bubble: {
    maxWidth:     '90%',
    borderRadius: 12,
    padding:      12,
  },
  bubbleUser: {
    backgroundColor: '#1f4d8a',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: '#161b22',
    borderWidth:     1,
    borderColor:     '#30363d',
    borderBottomLeftRadius: 4,
  },
  bubbleDocument: {
    width: '100%',
    maxWidth: '100%',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  terminalRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363d',
  },
  terminalGutter: {
    width: 30,
    paddingTop: 12,
    color: '#768390',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  terminalContent: {
    flex: 1,
  },
  bubbleTerminal: {
    width: '100%',
    maxWidth: '100%',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  bubbleCursorCard: {
    width: '100%',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 10,
  },
  bubbleCodexAssistant: {
    width: '100%',
    maxWidth: '100%',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  bubbleCodexUser: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    borderRadius: 16,
    borderWidth: 0,
    backgroundColor: '#2b2b2b',
  },
  text: {
    color:      '#cdd9e5',
    fontSize:   14,
    lineHeight: 20,
  },
  thinkingBlock: {
    backgroundColor: '#0b0f14',
    borderRadius:    6,
    padding:         8,
    marginTop:       4,
    borderLeftWidth: 2,
    borderLeftColor: '#444c56',
  },
  thinkingLabel: {
    color:        '#444c56',
    fontSize:     11,
    fontWeight:   '600',
    textTransform: 'uppercase',
    marginBottom:  4,
  },
  thinkingText: {
    color:      '#768390',
    fontSize:   12,
    fontStyle:  'italic',
    lineHeight: 18,
  },
  codexActivitySummary: {
    alignSelf:    'stretch',
    minWidth:     0,
    marginTop:    3,
    marginBottom: 6,
  },
  codexActivitySummaryTime: {
    color:      '#8b949e',
    fontSize:   11,
    lineHeight: 16,
    marginTop:  2,
    fontVariant: ['tabular-nums'],
  },
  codexActivitySummaryTimeLight: {
    color: '#57606a',
  },
  codexDesktopThinking: {
    alignSelf:    'stretch',
    marginTop:    3,
    marginBottom: 3,
  },
  codexDesktopThinkingHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  codexDesktopThinkingLabel: {
    color:      '#9d9d9d',
    fontSize:   14,
    lineHeight: 22,
    fontWeight: '400',
  },
  codexDesktopThinkingChevron: {
    color:      '#9d9d9d',
    fontSize:   12,
    lineHeight: 18,
  },
  claudeTerminal: {
    alignSelf:    'stretch',
    marginTop:    4,
    marginBottom: 9,
  },
  claudeTerminalHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           7,
    marginLeft:    8,
    marginBottom:  8,
  },
  claudeTerminalDot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: '#858585',
  },
  claudeTerminalDotCompleted: {
    backgroundColor: '#69c487',
  },
  claudeTerminalDotFailed: {
    backgroundColor: '#d5534f',
  },
  claudeTerminalName: {
    color:      '#cdd9e5',
    fontSize:   13,
    lineHeight: 20,
    fontWeight: '700',
  },
  claudeTerminalDescription: {
    flexShrink: 1,
    color:      '#cdd9e5',
    fontSize:   13,
    lineHeight: 20,
  },
  claudeTerminalBody: {
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     '#3c3c3c',
    borderRadius:    5,
    backgroundColor: '#1f1f1f',
  },
  claudeTerminalBodyLight: {
    borderColor:     '#c8c8c8',
    backgroundColor: '#ffffff',
  },
  claudeTerminalRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  claudeTerminalRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3c3c3c',
  },
  claudeTerminalRowBorderLight: {
    borderTopColor: '#c8c8c8',
  },
  claudeTerminalRowLabel: {
    width:      38,
    color:      '#9d9d9d',
    fontFamily: 'monospace',
    fontSize:   9,
    lineHeight: 19,
  },
  claudeTerminalRowText: {
    flex:       1,
    color:      '#cdd9e5',
    fontFamily: 'monospace',
    fontSize:   12,
    lineHeight: 19,
  },
  claudeTerminalRowError: {
    color: '#ff8a80',
  },
  claudeTerminalTextLight: {
    color: '#24292f',
  },
  claudeTerminalMutedLight: {
    color: '#57606a',
  },
  codexDesktopTerminal: {
    alignSelf:    'stretch',
    marginTop:    3,
    marginBottom: 3,
  },
  codexDesktopTerminalHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  codexDesktopTerminalIcon: {
    color:    '#9d9d9d',
    fontSize: 11,
  },
  codexDesktopTerminalLabel: {
    color:      '#9d9d9d',
    fontSize:   14,
    lineHeight: 22,
    fontWeight: '400',
  },
  codexDesktopTerminalChevron: {
    color:      '#9d9d9d',
    fontSize:   12,
    lineHeight: 18,
  },
  codexDesktopTerminalMutedLight: {
    color: '#6e6e6e',
  },
  codexDesktopTerminalBody: {
    marginTop:  5,
    marginLeft: 21,
    color:      '#a7a7a7',
    fontFamily: 'monospace',
    fontSize:   13,
    lineHeight: 20,
  },
  codexDesktopTerminalBodyLight: {
    color: '#5f5f5f',
  },
  statusChip: {
    alignSelf:         'flex-start',
    backgroundColor:  '#21262d',
    borderRadius:      999,
    paddingHorizontal: 9,
    paddingVertical:   4,
    marginVertical:    3,
  },
  statusChipText: {
    color:      '#768390',
    fontSize:   11,
    fontWeight: '600',
  },
  structuredCard: {
    backgroundColor: '#161b22',
    borderWidth:     1,
    borderColor:     '#30363d',
    borderRadius:    8,
    padding:         10,
    marginVertical:  4,
  },
  structuredCard_file:     { borderLeftWidth: 3, borderLeftColor: '#3fb950' },
  structuredCard_artifact: { borderLeftWidth: 3, borderLeftColor: '#a371f7' },
  structuredCard_prompt:   { borderLeftWidth: 3, borderLeftColor: '#d29922' },
  structuredCard_plan:     { borderLeftWidth: 3, borderLeftColor: '#58a6ff' },
  structuredCard_queued:   { borderLeftWidth: 3, borderLeftColor: '#8b949e' },
  structuredCard_notice:   { borderLeftWidth: 3, borderLeftColor: '#dbab09' },
  structuredCard_error:    { borderLeftWidth: 3, borderLeftColor: '#f85149' },
  cursorFileChangeSummary: {
    alignSelf: 'flex-start',
    marginVertical: 3,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '400',
  },
  cursorFileChangeAdditions: {
    color: '#2a9d6f',
  },
  cursorFileChangeDeletions: {
    color: '#e5484d',
  },
  cursorNativeError: {
    marginVertical: 4,
    fontWeight: '600',
  },
  cursorNativeErrorLabel: {
    fontWeight: '700',
  },
  antigravityError: {
    alignSelf: 'stretch',
    marginVertical: 2,
  },
  antigravityErrorSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  antigravityErrorText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 20,
  },
  antigravityErrorLabel: {
    fontWeight: '400',
  },
  antigravityErrorChevron: {
    flexShrink: 0,
    marginLeft: 4,
    color: '#949494',
    fontSize: 15,
    lineHeight: 20,
  },
  cursorNativeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: 7,
    marginVertical: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#2d2d30',
    borderRadius: 4,
    backgroundColor: '#252526',
  },
  codexDesktopNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#e7e7e7',
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  codexDesktopNoticeIcon: {
    color: '#202124',
    fontSize: 17,
    lineHeight: 20,
  },
  codexDesktopNoticeContent: {
    flex: 1,
    gap: 2,
  },
  codexDesktopNoticeTitle: {
    color: '#202124',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  codexDesktopNoticeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 5,
  },
  codexDesktopNoticeAction: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#202124',
    borderRadius: 999,
    backgroundColor: '#202124',
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  codexDesktopNoticeActionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  cursorNativeNoticeLight: {
    borderColor: '#e1e1e1',
    backgroundColor: '#f2f2f2',
  },
  cursorNativeNoticeIcon: {
    color: '#75beff',
    fontSize: 12,
    lineHeight: 18,
  },
  cursorNativeNoticeIconLight: {
    color: '#006ab1',
  },
  cursorNativeNoticeContent: {
    flex: 1,
    minWidth: 0,
  },
  cursorNativeNoticeText: {
    marginTop: 0,
    marginBottom: 0,
    fontSize: 12,
    lineHeight: 18,
  },
  cursorNativeNoticeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 3,
  },
  cursorNativeNoticeAction: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 0,
  },
  cursorNativeNoticeActionText: {
    fontSize: 11,
    lineHeight: 16,
  },
  structuredTitle: {
    color:        '#cdd9e5',
    fontSize:     13,
    fontWeight:   '600',
    marginBottom: 6,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginVertical: 3,
  },
  planMarker: {
    color: '#58a6ff',
    width: 14,
    fontSize: 13,
    lineHeight: 19,
  },
  planMarkerComplete: { color: '#3fb950' },
  planText: {
    color: '#cdd9e5',
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  planTextComplete: {
    color: '#768390',
    textDecorationLine: 'line-through',
  },
  structuredActions: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           6,
    marginTop:     6,
  },
  structuredAction: {
    borderWidth:       1,
    borderColor:       '#444c56',
    borderRadius:      999,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  structuredActionText: {
    color:    '#768390',
    fontSize: 10,
  },
  time: {
    color:     '#8b949e',
    fontSize:  12,
    lineHeight: 16,
    minWidth:  0,
    flexShrink: 1,
    marginTop: 3,
    marginHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  timeLight: {
    color: '#5f6368',
  },
  timeUser: {
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    alignItems:    'center',
    gap:           6,
  },
  metaRowUser: {
    justifyContent: 'flex-end',
  },
  delivery: {
    color:     '#768390',
    fontSize:  11,
    marginTop: 3,
  },
  deliveryFailed: {
    color: '#f85149',
  },
  deliveryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  deliveryAction: {
    minWidth: 52,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#58a6ff',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  deliveryActionLight: {
    borderColor: '#0969da',
  },
  deliveryActionText: {
    color: '#58a6ff',
    fontSize: 11,
    fontWeight: '600',
  },
  deliveryActionTextLight: {
    color: '#0969da',
  },
  copiedToast: {
    position:        'absolute',
    top:             '50%',
    alignSelf:       'center',
    backgroundColor: 'rgba(88, 166, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical:   4,
    borderRadius:    8,
    marginTop:       -12,
  },
  copiedText: {
    color:      '#fff',
    fontSize:   12,
    fontWeight:  '600',
  },
});
