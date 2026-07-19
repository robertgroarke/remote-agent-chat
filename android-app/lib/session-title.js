const IMAGE_REFERENCE_RE = /(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi;
const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi;

const DURATION_ONLY_RE = /^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i;
const DURATION_LIKE_RE = /^[+-]?\d+\s*[dhms]\b/i;
const AGE_ONLY_RE = /^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i;
const GOAL_STATUS_ONLY_RE = /^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i;
const PLACEHOLDER_ONLY_RE = /^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i;
const SURFACE_LABEL_ONLY_RE = /^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i;

const GENERIC_TITLE_KEYS = new Set([
  'agent', 'agentmanager', 'agentsession', 'antigravity', 'antigravitychat', 'antigravityv2',
  'claude', 'claudecli', 'claudecode', 'claudecodecli', 'claudedesktop', 'cline', 'codex', 'codexcli',
  'codexdesktop', 'connected', 'connectedsession', 'continue', 'continueyolo', 'cursor',
  'cursoragent', 'cursorcli', 'cursoride', 'gemini', 'geminicodeassist', 'newchat',
  'newconversation', 'other', 'proceed', 'resume', 'roocode', 'session', 'unknown',
  'attachment', 'file', 'image', 'screenshot',
  'disregardthatlastmessage', 'ignorethatlastmessage',
]);

function stringValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return stringValue(value.text || value.content || value.markdown || value.value || '');
}

function resetNoiseRegexes() {
  IMAGE_REFERENCE_RE.lastIndex = 0;
  ABSOLUTE_PATH_RE.lastIndex = 0;
}

export function invalidIdentityTextReason(value) {
  const text = stringValue(value).replace(/\s+/g, ' ').trim();
  if (!text) return 'empty';
  if (DURATION_ONLY_RE.test(text)) return 'duration_only';
  if (DURATION_LIKE_RE.test(text)) return 'duration_malformed';
  if (AGE_ONLY_RE.test(text)) return 'age_only';
  if (GOAL_STATUS_ONLY_RE.test(text)) return 'status_only';
  if (PLACEHOLDER_ONLY_RE.test(text)) return 'placeholder_only';
  if (SURFACE_LABEL_ONLY_RE.test(text)) return 'surface_label_only';
  return '';
}

export function isLowSignalChatTitle(value) {
  const text = stringValue(value).replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (invalidIdentityTextReason(text)) return true;
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

export function summarizeMessageContent(content) {
  const original = stringValue(content);
  if (!original) return '';
  const text = original
    .replace(/<goal_context>[\s\S]*?<\/goal_context>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(IMAGE_REFERENCE_RE, ' ')
    .replace(ABSOLUTE_PATH_RE, ' ')
    .replace(/<[^>\n]{1,120}>/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
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

export function titleFromSessionMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const message of list) {
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    const title = summarizeMessageContent(message?.content || message?.content_blocks);
    if (title) return title;
  }
  return '';
}

const TITLE_SOURCE_RANK = Object.freeze({
  fallback: 0,
  route: 0.5,
  message: 1,
  summary: 2,
  custom: 3,
  native: 4,
});
const SESSION_TITLE_METADATA_FIELDS = Object.freeze([
  'codex_desktop_active_thread_title', 'cursor_agent_title', 'native_chat_title',
  'session_title', 'thread_title', 'conversation_title', 'title', 'display_title',
  'summary', 'chat_title', 'chat_title_source', 'thread_name', 'conversation_name',
  'custom_display_name', 'is_new_chat_draft', 'is_list_view',
]);

function normalizedTitle(value) {
  return stringValue(value).replace(/\s+/g, ' ').trim();
}

export function sessionChatTitleMetadataPatch(source) {
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(SESSION_TITLE_METADATA_FIELDS
    .filter(field => Object.prototype.hasOwnProperty.call(source, field))
    .map(field => [field, source[field]]));
}

export function resolveSessionChatTitleProjection(session, customDisplayName = '', messages = [], derivedMessageTitle = '') {
  const source = session && typeof session === 'object' ? session : {};
  const nativeCandidates = [
    ['codex_desktop_active_thread_title', source.codex_desktop_active_thread_title],
    ['cursor_agent_title', source.cursor_agent_title],
    ['native_chat_title', source.native_chat_title],
    ['session_title', source.session_title],
    ['thread_title', source.thread_title],
    ['conversation_title', source.conversation_title],
    ['title', source.title],
    ['display_title', source.display_title],
    ['chat_title', source.chat_title_source === 'summary' ? '' : source.chat_title],
    ['thread_name', source.thread_name],
    ['conversation_name', source.conversation_name],
  ];
  const nativeTitle = nativeCandidates
    .map(([field, value]) => ({ field, title: normalizedTitle(value) }))
    .find(candidate => candidate.title && !isLowSignalChatTitle(candidate.title));
  if (nativeTitle) return { title: nativeTitle.title.slice(0, 80).trim(), source: 'native', field: nativeTitle.field };

  const customTitle = normalizedTitle(customDisplayName);
  if (customTitle && !isLowSignalChatTitle(customTitle)) {
    return { title: customTitle.slice(0, 80).trim(), source: 'custom', field: 'custom_display_name' };
  }

  const summaryCandidates = [
    ['chat_title', source.chat_title_source === 'summary' ? source.chat_title : ''],
    ['summary', source.summary],
    ['derived_message_title', derivedMessageTitle],
  ];
  const summaryTitle = summaryCandidates
    .map(([field, value]) => ({ field, title: summarizeMessageContent(value) }))
    .find(candidate => candidate.title);
  if (summaryTitle) return { title: summaryTitle.title, source: 'summary', field: summaryTitle.field };

  const messageTitle = titleFromSessionMessages(messages);
  if (messageTitle) return { title: messageTitle, source: 'message', field: 'first_meaningful_user_message' };
  return { title: 'New chat', source: 'fallback', field: 'new_chat' };
}

export function retainStrongerSessionChatTitleProjection(previous, next) {
  if (!previous?.title) return next;
  if (!next?.title) return previous;
  const previousRank = TITLE_SOURCE_RANK[previous.source] ?? 0;
  const nextRank = TITLE_SOURCE_RANK[next.source] ?? 0;
  return nextRank >= previousRank ? next : previous;
}

export function resolveSessionChatTitle(session, customDisplayName = '', messages = [], derivedMessageTitle = '') {
  return resolveSessionChatTitleProjection(session, customDisplayName, messages, derivedMessageTitle).title;
}
