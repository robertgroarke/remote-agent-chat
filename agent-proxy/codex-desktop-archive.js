'use strict';

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function codexDesktopCliSessionId(threadKey) {
  return String(threadKey || '').match(UUID_RE)?.[1] || '';
}

function section(content, name) {
  const source = String(content || '');
  const marker = `${name}:\n`;
  const index = source.indexOf(marker);
  if (index < 0) return '';
  const value = source.slice(index + marker.length).trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function shellCommandLiterals(source) {
  const commands = [];
  const regex = /tools\.(?:shell_command|exec_command)\s*\(\s*\{[\s\S]{0,400}?\bcommand\s*:\s*("(?:\\.|[^"\\])*")/g;
  let match;
  while ((match = regex.exec(String(source || ''))) !== null) {
    try {
      const command = JSON.parse(match[1]);
      if (typeof command === 'string' && command.trim() && !commands.includes(command.trim())) {
        commands.push(command.trim());
      }
    } catch {}
  }
  return commands;
}

function shellExecDetails(block) {
  if (!block || block.type !== 'tool_call') return null;
  const toolName = String(block.tool_name || '').toLowerCase();
  const args = section(block.content, 'arguments');
  if (toolName === 'shell_command' || toolName === 'exec_command') {
    return { command: block.command || args || toolName, source: args };
  }
  if (toolName !== 'exec' || !/tools\.(?:shell_command|exec_command)\s*\(/.test(args)) return null;
  const commands = shellCommandLiterals(args);
  return {
    command: block.command || commands.join('\n\n') || args || 'shell command',
    source: args,
  };
}

function exitCodeFromOutput(output) {
  const matches = Array.from(String(output || '').matchAll(/(?:^|\n)Exit code:\s*(-?\d+)\s*(?:\n|$)/gi));
  if (matches.length === 0) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isInteger(value) ? value : null;
}

function codexDesktopArchiveMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const out = [];
  const pendingShell = new Map();

  for (const message of source) {
    const blocks = Array.isArray(message?.content_blocks) ? message.content_blocks : [];
    if (blocks.length === 1) {
      const block = blocks[0];
      const details = shellExecDetails(block);
      const callId = String(block?.call_id || '').trim();
      if (details && callId) {
        const terminal = {
          type: 'terminal',
          title: 'Command',
          collapsed: false,
          command: details.command,
          workdir: block.workdir || '',
          stdout: '',
          stderr: '',
          exit_code: null,
          status: 'running',
          call_id: callId,
        };
        const transformed = {
          ...message,
          content: `[Command]\n\n$ ${details.command}`,
          content_blocks: [terminal],
        };
        out.push(transformed);
        pendingShell.set(callId, { terminal, outputIndex: out.length - 1 });
        continue;
      }

      if (block?.type === 'tool_result' && callId && pendingShell.has(callId)) {
        const pending = pendingShell.get(callId);
        const stdout = section(block.content, 'output') || String(block.content || '');
        const exitCode = exitCodeFromOutput(stdout);
        pending.terminal.stdout = stdout;
        pending.terminal.exit_code = exitCode;
        pending.terminal.status = block.status === 'error' || (exitCode != null && exitCode !== 0)
          ? 'error'
          : 'completed';
        pending.terminal.completed_ts = message.ts || null;
        pendingShell.delete(callId);
        continue;
      }
    }
    out.push(message);
  }

  return out;
}

function codexDesktopStructuredBlockCounts(messages) {
  const counts = {};
  for (const message of (Array.isArray(messages) ? messages : [])) {
    for (const block of (Array.isArray(message?.content_blocks) ? message.content_blocks : [])) {
      const type = String(block?.type || 'unknown');
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

module.exports = {
  codexDesktopCliSessionId,
  codexDesktopArchiveMessages,
  codexDesktopStructuredBlockCounts,
  shellExecDetails,
};
