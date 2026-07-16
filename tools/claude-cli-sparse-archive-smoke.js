#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const claudeCli = require('../agent-proxy/claude-cli');

const GIB = 1024 * 1024 * 1024;
const MAX_BOUNDED_READ_BYTES = 8 * 1024 * 1024;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-claude-sparse-archive-'));
const projectDir = path.join(root, 'sparse-project');
const sessionId = '00000000-0000-4000-8000-000000000601';
const filePath = path.join(projectDir, `${sessionId}.jsonl`);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : '';

function line(value) {
  return `${JSON.stringify(value)}\n`;
}

function record(value) {
  return {
    sessionId,
    cwd: root,
    entrypoint: 'cli',
    timestamp: '2026-07-14T04:00:00.000Z',
    ...value,
  };
}

function writeResult(result) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

try {
  fs.mkdirSync(projectDir, { recursive: true });
  const handle = fs.openSync(filePath, 'w');
  try {
    fs.ftruncateSync(handle, GIB);
  } finally {
    fs.closeSync(handle);
  }
  fs.appendFileSync(filePath, `\n${line(record({
    type: 'user',
    uuid: 'claude-sparse-user-1',
    message: { role: 'user', content: 'Sparse archive initial user' },
  }))}${line(record({
    type: 'assistant',
    uuid: 'claude-sparse-assistant-1',
    message: {
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'text', text: 'Sparse archive initial answer' }],
    },
  }))}`, 'utf8');

  const baselineStarted = performance.now();
  const baseline = claudeCli.readSessionSummary(filePath);
  const baselineDurationMs = performance.now() - baselineStarted;
  const appendContent = `Sparse archive appended answer ${'x'.repeat(1024)}`;
  fs.appendFileSync(filePath, line(record({
    type: 'assistant',
    uuid: 'claude-sparse-assistant-2',
    message: {
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'text', text: appendContent }],
    },
  })), 'utf8');
  const appendStarted = performance.now();
  const appended = claudeCli.readSessionSummary(filePath);
  const appendDurationMs = performance.now() - appendStarted;

  const result = {
    ok: baseline?.sourceCursor?.bounded_window_bytes_read <= MAX_BOUNDED_READ_BYTES
      && appended?.sourceCursor?.bounded_window_bytes_read <= MAX_BOUNDED_READ_BYTES
      && appended?.sourceCursor?.mode === 'append'
      && appended.messages.some(message => message.content === appendContent),
    fixture: {
      logical_archive_bytes: fs.statSync(filePath).size,
      sparse_prefix_bytes: GIB,
      appended_payload_bytes: Buffer.byteLength(appendContent),
      visible_windows_opened: 0,
      focus_actions: 0,
      production_mutations: 0,
    },
    baseline: {
      duration_ms: Number(baselineDurationMs.toFixed(3)),
      source_cursor: baseline?.sourceCursor || null,
      message_count: baseline?.messages?.length || 0,
      messages_partial: baseline?.messagesPartial === true,
    },
    append: {
      duration_ms: Number(appendDurationMs.toFixed(3)),
      source_cursor: appended?.sourceCursor || null,
      message_count: appended?.messages?.length || 0,
      exact_appended_message: appended?.messages?.some(message => message.content === appendContent) || false,
    },
    budgets: {
      max_bounded_read_bytes: MAX_BOUNDED_READ_BYTES,
    },
  };
  writeResult(result);
  assert(result.baseline.source_cursor, 'Claude sparse archive produced no source cursor');
  assert(result.baseline.source_cursor.bounded_window_bytes_read <= MAX_BOUNDED_READ_BYTES,
    `Claude sparse baseline read ${result.baseline.source_cursor.bounded_window_bytes_read} bounded bytes`);
  assert.equal(result.append.source_cursor?.mode, 'append');
  assert(result.append.source_cursor.bounded_window_bytes_read <= MAX_BOUNDED_READ_BYTES,
    `Claude sparse append read ${result.append.source_cursor.bounded_window_bytes_read} bounded bytes`);
  assert(result.append.exact_appended_message, 'Claude sparse append was not retained');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
