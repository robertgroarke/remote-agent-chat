#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCodexJsonl } = require('../agent-proxy/codex-cli');

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function entry(timestamp, type, payload) {
  return { timestamp, type, payload };
}

function pairedAnswer(timestamp, id, content) {
  return [
    entry(timestamp, 'event_msg', { type: 'agent_message', message: content, phase: 'final_answer' }),
    entry(timestamp, 'response_item', {
      type: 'message',
      id,
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: content }],
    }),
  ];
}

const fixture = [
  entry('2026-07-13T08:00:00.000Z', 'session_meta', { id: 'fixture-session' }),
  ...pairedAnswer('2026-07-13T08:00:01.000Z', 'msg-before', 'fixture prose before'),
  entry('2026-07-13T08:00:02.000Z', 'response_item', {
    type: 'function_call', id: 'call-1', call_id: 'call-1', name: 'shell_command', arguments: '{"command":"fixture"}',
  }),
  entry('2026-07-13T08:00:03.000Z', 'response_item', {
    type: 'function_call_output', call_id: 'call-1', output: 'fixture result',
  }),
  ...pairedAnswer('2026-07-13T08:00:04.000Z', 'msg-repeat-1', 'fixture repeated answer'),
  ...pairedAnswer('2026-07-13T08:00:05.000Z', 'msg-repeat-2', 'fixture repeated answer'),
  entry('2026-07-13T08:00:06.000Z', 'event_msg', {
    type: 'patch_apply_end', call_id: 'patch-1', success: true,
    changes: [{ path: 'fixture.txt', added: 1, removed: 0, diff: '@@ -0,0 +1 @@\n+fixture' }],
  }),
  ...pairedAnswer('2026-07-13T08:00:07.000Z', 'msg-between', 'fixture prose between'),
  entry('2026-07-13T08:00:08.000Z', 'event_msg', {
    type: 'exec_command_end', command: 'fixture command', stdout: 'fixture output', exit_code: 0,
  }),
  ...pairedAnswer('2026-07-13T08:00:09.000Z', 'msg-after', 'fixture prose after'),
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-fidelity-'));
const archive = path.join(directory, 'rollout-fixture-session.jsonl');

try {
  fs.writeFileSync(archive, `${fixture.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  const messages = parseCodexJsonl(archive);
  const rows = messages.map((message, index) => ({
    index,
    source_id: message.source_message_id || '',
    role: message.role || '',
    block_type: message.content_blocks?.[0]?.type || 'text',
    content_hash: hash(message.content),
    timestamp: message.ts ?? null,
  }));
  const markdownRows = rows.filter(row => row.block_type === 'markdown');
  const repeatedHash = hash('fixture repeated answer');
  const repeatedRows = markdownRows.filter(row => row.content_hash === repeatedHash);

  if (markdownRows.length !== 5) {
    throw new Error(`expected 5 conversational rows, received ${markdownRows.length}`);
  }
  if (repeatedRows.length !== 2) {
    throw new Error(`distinct identical answers collapsed: expected 2, received ${repeatedRows.length}`);
  }
  if (new Set(rows.map(row => row.source_id).filter(Boolean)).size !== rows.length) {
    throw new Error('every parsed row must retain one unique content-safe source_message_id');
  }
  if (rows.some(row => row.timestamp == null || !Number.isFinite(Number(row.timestamp)))) {
    throw new Error('every fixture row must retain its producer timestamp');
  }
  const blockTypes = rows.map(row => row.block_type);
  const expectedBlockTypes = [
    'markdown', 'tool_call', 'tool_result', 'markdown', 'markdown',
    'file_changes', 'markdown', 'terminal', 'markdown',
  ];
  if (JSON.stringify(blockTypes) !== JSON.stringify(expectedBlockTypes)) {
    throw new Error(`native interleave changed: ${JSON.stringify(blockTypes)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    row_count: rows.length,
    conversation_count: markdownRows.length,
    distinct_identical_count: repeatedRows.length,
    block_types: blockTypes,
    ordered_tuple_hash: hash(JSON.stringify(rows)),
    source_ids_unique: true,
    producer_timestamps_complete: true,
  }, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
