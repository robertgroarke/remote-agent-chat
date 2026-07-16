export const MAX_BROADCAST_SESSIONS = 20;
export const MAX_BROADCAST_CONTENT_CHARS = 65_536;

const BROADCAST_SEND_AGENT_TYPES = new Set([
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini',
  'continue', 'continue_yolo', 'roo_code', 'cline',
  'antigravity', 'antigravity_panel', 'antigravity-v2',
]);

export function sessionSupportsBroadcast(session, config = {}, health = 'unknown', connected = true) {
  const sessionId = typeof session === 'string' ? session : String(session?.session_id || session?.id || '');
  const agentType = typeof session === 'object'
    ? String(session?.agent_type || config?.agent_type || '')
    : String(config?.agent_type || '');
  const capabilities = config?.capabilities || {};
  return !!sessionId
    && !!connected
    && BROADCAST_SEND_AGENT_TYPES.has(agentType)
    && health !== 'disconnected'
    && session?.disconnected !== true
    && session?.is_list_view !== true
    && capabilities.send !== false
    && capabilities.send_message !== false
    && capabilities.message_send !== false;
}

export function normalizeBroadcastRequest(request, canSendToSession = () => true) {
  const rawIds = Array.isArray(request?.session_ids) ? request.session_ids : [];
  const sessionIds = [...new Set(rawIds.map(value => String(value || '').trim()).filter(Boolean))];
  const content = typeof request?.content === 'string' ? request.content.trim() : '';
  if (sessionIds.length < 1 || sessionIds.length > MAX_BROADCAST_SESSIONS) {
    return { ok: false, error: `Select between 1 and ${MAX_BROADCAST_SESSIONS} sessions` };
  }
  if (!content || content.length > MAX_BROADCAST_CONTENT_CHARS) {
    return { ok: false, error: `Prompt must contain 1-${MAX_BROADCAST_CONTENT_CHARS} characters` };
  }
  const confirmation = `SEND TO ${sessionIds.length} SESSIONS`;
  if (request?.confirmation !== confirmation) {
    return { ok: false, error: 'Broadcast confirmation does not match the selected session count' };
  }
  const unsupported = sessionIds.filter(sessionId => !canSendToSession(sessionId));
  if (unsupported.length) return { ok: false, error: 'One or more selected sessions cannot receive messages', unsupported };
  return { ok: true, sessionIds, content, confirmation };
}

export function createBroadcastReceiptState(sessionIds) {
  return Object.fromEntries(sessionIds.map(sessionId => [sessionId, { status: 'queued', error: null }]));
}
