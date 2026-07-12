import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, useColorScheme,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import ToolSection from './ToolSection';
import CollapsibleBlock from './CollapsibleBlock';
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
export default function MessageBubble({ message, agentType, deliveryState }) {
  const isUser = message.role === 'user';
  const blocks = normalizeMessageBlocks(message);
  const isLight = useColorScheme() === 'light';
  const transcriptTheme = themeForAgent(agentType, isLight);
  const [showCopied, setShowCopied] = useState(false);

  const handleLongPress = useCallback(() => {
    const plain = blocksToPlainText(blocks);
    if (!plain) return;
    Clipboard.setStringAsync(plain);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1500);
  }, [blocks]);

  return (
    <View style={[s.wrapper, isUser ? s.wrapperUser : s.wrapperAssistant]}>
      <Pressable onLongPress={handleLongPress} delayLongPress={400}>
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}>
          {blocks.map((block, i) => renderBlock(block, i, isUser, transcriptTheme))}
          {showCopied && (
            <View style={s.copiedToast}>
              <Text style={s.copiedText}>Copied</Text>
            </View>
          )}
        </View>
      </Pressable>
      {(message.timestamp || isUser) && (
        <View style={[s.metaRow, isUser && s.metaRowUser]}>
          {!!message.timestamp && (
            <Text style={[s.time, isUser && s.timeUser]}>{formatTime(message.timestamp)}</Text>
          )}
          {isUser && (
            <Text style={[s.delivery, deliveryState === 'failed' && s.deliveryFailed]}>
              {deliveryLabel(message, deliveryState)}
            </Text>
          )}
        </View>
      )}
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
      return renderStructuredCard(block, i, 'Notice', 'notice', theme.markdown);

    case 'error':
      return renderStructuredCard(block, i, 'Error', 'error', theme.markdown);

    case 'status':
      return (
        <View key={i} style={s.statusChip}>
          <Text style={s.statusChipText}>{block.label || block.title || block.content || 'Status'}</Text>
        </View>
      );

    case 'thinking':
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

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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

function deliveryLabel(message, deliveryState) {
  if (deliveryState === 'offline_queued') return 'Queued offline';
  if (deliveryState === 'queued') return 'Sending…';
  if (deliveryState === 'busy_queued' || message._queued) return 'Queued';
  if (deliveryState === 'steered') return 'Steered';
  if (deliveryState === 'failed') return 'Failed';
  if (deliveryState === 'delivered') return '✓✓ Delivered';
  if (deliveryState === 'agent_started' || message._agentStarted) return '▶ Agent started';
  if (message._delivered) return '✓✓ Delivered';
  return '✓ Sent';
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
  return isLight ? lightTranscriptTheme(darkTheme, agentType) : { ...darkTheme, isLight: false };
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
    color:     '#444c56',
    fontSize:  11,
    marginTop: 3,
    marginHorizontal: 4,
  },
  timeUser: {
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
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
