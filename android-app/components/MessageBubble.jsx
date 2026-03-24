import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import ToolSection from './ToolSection';
import CollapsibleBlock from './CollapsibleBlock';

// Renders a single chat message (user or assistant).
// Props:
//   message — { role, content, sequence, timestamp }
//   content may be a string or an array of content blocks (Claude format)
export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const blocks = normalizeContent(message.content);
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
          {blocks.map((block, i) => renderBlock(block, i, isUser))}
          {showCopied && (
            <View style={s.copiedToast}>
              <Text style={s.copiedText}>Copied</Text>
            </View>
          )}
        </View>
      </Pressable>
      {message.timestamp && (
        <Text style={[s.time, isUser && s.timeUser]}>
          {message._queued ? '(queued) ' : ''}{formatTime(message.timestamp)}
        </Text>
      )}
    </View>
  );
}

// ── Content normalization ─────────────────────────────────────────────────────

function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content))      return content;
  return [];
}

function blocksToPlainText(blocks) {
  return blocks
    .map(b => {
      if (b.type === 'text')      return b.text;
      if (b.type === 'thinking')  return b.thinking;
      if (b.type === 'tool_use')  return `[Tool: ${b.name}]`;
      if (b.type === 'tool_result') return extractToolResultText(b.content);
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// ── Block renderers ───────────────────────────────────────────────────────────

function renderBlock(block, i, isUser) {
  switch (block.type) {
    case 'text':
      if (isUser) {
        return <Text key={i} style={s.text} selectable>{block.text}</Text>;
      }
      return renderCollapsibleText(block.text, i);

    case 'tool_use':
      return (
        <ToolSection
          key={i}
          name={block.name}
          input={block.input}
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
        />
      );

    case 'thinking':
      return (
        <View key={i} style={s.thinkingBlock}>
          <Text style={s.thinkingLabel}>Thinking</Text>
          <Text style={s.thinkingText} selectable>{block.thinking}</Text>
        </View>
      );

    default:
      return null;
  }
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

function extractToolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

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
  time: {
    color:     '#444c56',
    fontSize:  11,
    marginTop: 3,
    marginHorizontal: 4,
  },
  timeUser: {
    textAlign: 'right',
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
