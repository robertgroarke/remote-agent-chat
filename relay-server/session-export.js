'use strict';

const CANONICAL_BLOCK_LABELS = {
  markdown: 'Markdown', thinking: 'Thinking', tool_call: 'Tool call', tool_result: 'Tool result',
  terminal: 'Terminal', file_changes: 'File changes', artifact: 'Artifact', prompt: 'Prompt',
  plan: 'Plan', queued_message: 'Queued message', notice: 'Notice', error: 'Error', status: 'Status',
};

function parseBlocks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function isoTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const milliseconds = number < 10_000_000_000 ? number * 1000 : number;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeFilename(value) {
  const normalized = String(value || 'session')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return normalized || 'session';
}

function normalizedMessage(row) {
  return {
    id: Number(row.id ?? row.server_message_id) || null,
    sequence: Number(row.sequence) || 0,
    role: String(row.role || 'unknown'),
    content: String(row.content || ''),
    content_blocks: parseBlocks(row.content_blocks),
    status: row.status || null,
    client_message_id: row.client_msg_id || row.client_message_id || null,
    timestamp: isoTimestamp(row.ts),
  };
}

function blockText(block) {
  for (const key of ['content', 'text', 'output', 'message', 'detail', 'command', 'title', 'label']) {
    if (typeof block?.[key] === 'string' && block[key]) return block[key];
  }
  return '';
}

function renderBlockMarkdown(block, index) {
  const type = String(block?.type || 'unknown');
  const label = CANONICAL_BLOCK_LABELS[type] || type.replace(/_/g, ' ');
  const text = blockText(block);
  const remaining = block && typeof block === 'object'
    ? Object.fromEntries(Object.entries(block).filter(([key, value]) => key !== 'type' && !(typeof value === 'string' && value === text)))
    : {};
  const lines = [`### ${index + 1}. ${label}`];
  if (text) {
    if (['terminal', 'tool_result', 'tool_call', 'file_changes', 'error'].includes(type)) {
      lines.push('', '```text', text, '```');
    } else {
      lines.push('', text);
    }
  }
  if (Object.keys(remaining).length) lines.push('', '```json', JSON.stringify(remaining, null, 2), '```');
  if (!text && !Object.keys(remaining).length) lines.push('', '_(empty block)_');
  return lines.join('\n');
}

function exportMarkdown({ sessionId, metadata = {}, rows = [], exportedAt = new Date().toISOString() }) {
  const messages = rows.map(normalizedMessage);
  const title = metadata.display_name || metadata.workspace_name || metadata.project_root || sessionId;
  const lines = [
    `# ${title || 'Session export'}`,
    '',
    `- Session: \`${sessionId}\``,
    `- Harness: ${metadata.agent_type || 'unknown'}`,
    `- Workspace: ${metadata.project_root || metadata.workspace_path || metadata.workspace_name || 'unknown'}`,
    `- Exported: ${exportedAt}`,
    `- Messages: ${messages.length}`,
  ];
  for (const message of messages) {
    const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);
    lines.push('', '---', '', `## ${role}${message.timestamp ? ` - ${message.timestamp}` : ''}`, '');
    // Structured assistant rows use content as a transport fallback; rendering both
    // would duplicate the same answer. Match the clients: canonical blocks win.
    if (message.content && !message.content_blocks.length) lines.push(message.content);
    if (message.content_blocks.length) {
      lines.push('', ...message.content_blocks.map((block, index) => renderBlockMarkdown(block, index)));
    }
    if (!message.content && !message.content_blocks.length) lines.push('_(empty message)_');
  }
  return `${lines.join('\n')}\n`;
}

function exportJson({ sessionId, metadata = {}, rows = [], exportedAt = new Date().toISOString() }) {
  return `${JSON.stringify({
    schema_version: 1,
    exported_at: exportedAt,
    session: { session_id: sessionId, ...metadata },
    messages: rows.map(normalizedMessage),
  }, null, 2)}\n`;
}

function buildSessionExport({ sessionId, metadata = {}, rows = [], format = 'markdown', exportedAt } = {}) {
  if (!sessionId) throw new Error('Session id is required');
  if (!['markdown', 'json'].includes(format)) throw new Error('Unsupported export format');
  const stem = safeFilename(metadata.display_name || metadata.workspace_name || metadata.agent_type || sessionId);
  if (format === 'json') return {
    body: exportJson({ sessionId, metadata, rows, exportedAt }),
    contentType: 'application/json; charset=utf-8',
    filename: `${stem}.json`,
  };
  return {
    body: exportMarkdown({ sessionId, metadata, rows, exportedAt }),
    contentType: 'text/markdown; charset=utf-8',
    filename: `${stem}.md`,
  };
}

module.exports = { buildSessionExport, exportJson, exportMarkdown, normalizedMessage, parseBlocks, safeFilename };
