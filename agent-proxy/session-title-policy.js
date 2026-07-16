'use strict';

const IMAGE_REFERENCE_RE = /(?:!\[[^\]]*\]\([^)]+\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi;
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/gi;

const GENERIC_TITLE_KEYS = new Set([
  'agent', 'agentmanager', 'agentsession', 'antigravity', 'antigravitychat', 'antigravityv2',
  'claude', 'claudecli', 'claudecode', 'claudecodecli', 'claudedesktop', 'cline', 'codex', 'codexcli',
  'codexdesktop', 'connected', 'connectedsession', 'continue', 'continueyolo', 'cursor',
  'cursoragent', 'cursorcli', 'cursoride', 'gemini', 'geminicodeassist', 'newchat',
  'newconversation', 'other', 'proceed', 'resume', 'roocode', 'session', 'unknown',
  'attachment', 'file', 'image', 'screenshot', 'disregardthatlastmessage',
  'ignorethatlastmessage',
]);

function stringValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return stringValue(value.text || value.content || value.markdown || value.value || '');
}

function normalizedTitle(value) {
  return stringValue(value).replace(/\s+/g, ' ').trim();
}

function resetNoiseRegexes() {
  IMAGE_REFERENCE_RE.lastIndex = 0;
  ABSOLUTE_PATH_RE.lastIndex = 0;
}

function isLowSignalChatTitle(value) {
  const text = normalizedTitle(value);
  if (!text) return true;
  if (/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.test(text)) return true;
  if (/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.test(text)) return true;
  const hasAttachmentNoise = IMAGE_REFERENCE_RE.test(text) || ABSOLUTE_PATH_RE.test(text);
  resetNoiseRegexes();
  if (hasAttachmentNoise) {
    const remainder = text.replace(IMAGE_REFERENCE_RE, ' ').replace(ABSOLUTE_PATH_RE, ' ')
      .replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi, ' ')
      .replace(/[^a-z0-9]+/gi, '')
      .trim();
    resetNoiseRegexes();
    if (remainder.length < 12) return true;
  }
  let key = text.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^remoteagent(?:chat)?/, '');
  if (!key) return !/[\p{L}\p{N}]/u.test(text);
  if (GENERIC_TITLE_KEYS.has(key)) return true;
  key = key.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g, '');
  return GENERIC_TITLE_KEYS.has(key);
}

function summarizeMessageContent(content) {
  const original = stringValue(content);
  if (!original) return '';
  const text = original
    .replace(/<goal_context>[\s\S]*?<\/goal_context>/gi, ' ')
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, ' ')
    .replace(IMAGE_REFERENCE_RE, ' ')
    .replace(ABSOLUTE_PATH_RE, ' ')
    .replace(/<[^>\n]{1,120}>/g, ' ')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
    .replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  resetNoiseRegexes();
  if (!text || isLowSignalChatTitle(text)) return '';
  if (/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.test(text)
    && text.split(/\s+/).length <= 4) return '';
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return '';
  return text.slice(0, 80).trim();
}

function titleFromSessionMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const message of list) {
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    const title = summarizeMessageContent(message?.content || message?.content_blocks);
    if (title) return title;
  }
  return '';
}

function firstDurableTitle(values) {
  for (const value of Array.isArray(values) ? values : [values]) {
    const title = normalizedTitle(value);
    if (title && !isLowSignalChatTitle(title)) return title.slice(0, 80).trim();
  }
  return '';
}

function selectDurableChatTitle({
  nativeTitle = '',
  currentTitle = '',
  storedTitle = '',
  messages = [],
} = {}) {
  return firstDurableTitle(nativeTitle)
    || firstDurableTitle(currentTitle)
    || firstDurableTitle(storedTitle)
    || titleFromSessionMessages(messages)
    || null;
}

function selectDurableChatTitleDetails({
  nativeTitle = '',
  currentTitle = '',
  currentSource = '',
  storedTitle = '',
  storedSource = '',
  messages = [],
} = {}) {
  const native = firstDurableTitle(nativeTitle);
  if (native) return { title: native, source: 'native' };
  const current = firstDurableTitle(currentTitle);
  if (current) return { title: current, source: currentSource || 'native' };
  const stored = firstDurableTitle(storedTitle);
  if (stored) return { title: stored, source: storedSource || 'native' };
  const summary = titleFromSessionMessages(messages);
  return summary ? { title: summary, source: 'summary' } : { title: null, source: null };
}

function mergeDurableChatTitle(previousTitle, incomingTitle, { reset = false } = {}) {
  const previous = normalizedTitle(previousTitle);
  const incoming = normalizedTitle(incomingTitle);
  if (reset) return incoming || null;
  return firstDurableTitle(incoming)
    || firstDurableTitle(previous)
    || incoming
    || previous
    || null;
}

function mergeDurableChatTitleDetails(previousTitle, incomingTitle, {
  previousSource = '',
  incomingSource = '',
  reset = false,
} = {}) {
  const previousDurable = firstDurableTitle(previousTitle);
  const incomingDurable = firstDurableTitle(incomingTitle);
  const title = mergeDurableChatTitle(previousTitle, incomingTitle, { reset });
  if (reset) {
    return {
      title,
      source: incomingDurable ? (incomingSource || 'native') : null,
    };
  }
  if (incomingDurable && title === incomingDurable) {
    return {
      title,
      source: incomingSource || (incomingDurable === previousDurable ? previousSource : '') || 'native',
    };
  }
  if (previousDurable && title === previousDurable) {
    return { title, source: previousSource || 'native' };
  }
  return { title, source: incomingSource || previousSource || null };
}

module.exports = {
  firstDurableTitle,
  isLowSignalChatTitle,
  mergeDurableChatTitle,
  mergeDurableChatTitleDetails,
  normalizedTitle,
  selectDurableChatTitle,
  selectDurableChatTitleDetails,
  summarizeMessageContent,
  titleFromSessionMessages,
};
