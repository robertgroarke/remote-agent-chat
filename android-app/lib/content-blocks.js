'use strict';

const CANONICAL_BLOCK_TYPES = Object.freeze([
  'markdown',
  'thinking',
  'tool_call',
  'tool_result',
  'terminal',
  'file_changes',
  'artifact',
  'prompt',
  'plan',
  'queued_message',
  'notice',
  'error',
  'status',
]);

function stringValue(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

function normalizeCanonicalBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const rawType = stringValue(block.type || 'markdown').toLowerCase();
  if (rawType === 'code') {
    const language = stringValue(block.language || block.lang).trim();
    const content = stringValue(block.content || block.text || block.markdown);
    return { ...block, type: 'markdown', content: `\`\`\`${language}\n${content}\n\`\`\`` };
  }
  if (rawType === 'file_change') return { ...block, type: 'file_changes' };
  if (rawType === 'tool') return { ...block, type: 'tool_call' };
  if (rawType === 'tool_output' || rawType === 'result') return { ...block, type: 'tool_result' };
  if (rawType === 'thought') return { ...block, type: 'thinking' };
  if (rawType === 'task_list') return { ...block, type: 'plan' };
  if (rawType === 'queue' || rawType === 'queued') return { ...block, type: 'queued_message' };
  if (rawType === 'banner' || rawType === 'notification') return { ...block, type: 'notice' };
  if (rawType === 'worked' || rawType === 'activity') return { ...block, type: 'status' };
  return { ...block, type: rawType };
}

function normalizeMessageBlocks(message) {
  const canonical = Array.isArray(message?.content_blocks)
    ? message.content_blocks.map(normalizeCanonicalBlock).filter(Boolean)
    : [];
  if (canonical.length > 0 && message?.role !== 'user') return canonical;

  const content = message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content.filter(block => block && typeof block === 'object');
  return [];
}

function terminalText(block) {
  return [
    block?.workdir ? `cwd: ${block.workdir}` : '',
    block?.command ? `$ ${block.command}` : '',
    stringValue(block?.stdout),
    block?.stderr ? `stderr:\n${block.stderr}` : '',
    block?.exit_code != null ? `exit code: ${block.exit_code}` : '',
  ].filter(Boolean).join('\n\n');
}

function fileChangesText(block) {
  const files = Array.isArray(block?.files) ? block.files.map(file => [
    file?.path || file?.file || '',
    file?.added != null ? `+${file.added}` : '',
    file?.removed != null ? `-${file.removed}` : '',
  ].filter(Boolean).join(' ')).filter(Boolean).join('\n') : '';
  return [block?.content || block?.summary || '', files].filter(Boolean).join('\n\n');
}

function extractLegacyToolResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text').map(block => block.text || '').filter(Boolean).join('\n');
}

function contentBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text') return stringValue(block.text);
  if (block.type === 'thinking') return stringValue(block.content || block.thinking || block.label);
  if (block.type === 'tool_use') return `[Tool: ${stringValue(block.name || 'Tool')}]`;
  if (block.type === 'tool_result') return extractLegacyToolResult(block.content);
  if (block.type === 'terminal') return terminalText(block);
  if (block.type === 'file_changes') return fileChangesText(block);
  if (block.type === 'plan') {
    const tasks = Array.isArray(block.tasks) ? block.tasks.map(task => {
      const label = stringValue(task?.text || task?.step || task?.title).trim();
      const state = stringValue(task?.state || task?.status || 'pending').trim();
      return label ? `[${state}] ${label}` : '';
    }).filter(Boolean).join('\n') : '';
    return [stringValue(block.content), tasks].filter(Boolean).join('\n');
  }
  return stringValue(block.content || block.text || block.markdown || block.title || block.label || block.summary);
}

function blocksToPlainText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(contentBlockText).filter(Boolean).join('\n\n');
}

module.exports = {
  CANONICAL_BLOCK_TYPES,
  normalizeCanonicalBlock,
  normalizeMessageBlocks,
  terminalText,
  fileChangesText,
  extractLegacyToolResult,
  contentBlockText,
  blocksToPlainText,
};
