'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-claude-tool-results-'));
const transcriptPath = path.join(tempRoot, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl');
const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function record(value) {
  return JSON.stringify({
    sessionId,
    cwd: tempRoot,
    entrypoint: 'cli',
    timestamp: '2026-07-20T12:00:00.000Z',
    ...value,
  });
}

function toolUse(id, name, input) {
  return record({
    type: 'assistant',
    uuid: `assistant-${id}`,
    message: { role: 'assistant', model: 'claude-test-model', content: [{ type: 'tool_use', id, name, input }] },
  });
}

function toolResult(id, content, toolUseResult) {
  return record({
    type: 'user',
    uuid: `result-${id}`,
    toolUseResult,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
}

try {
  const grepMatch = 'src/example.js:42:const CLAUDE_RESULT_SENTINEL = true;';
  const readBody = 'alpha\nREAD_RESULT_SENTINEL\nomega';
  const editDiffLine = '+const EDIT_RESULT_SENTINEL = true;';
  const largePrefix = 'LARGE_RESULT_PREFIX';
  const largeSuffix = 'LARGE_RESULT_SUFFIX_MUST_BE_TRUNCATED';
  const largeBody = `${largePrefix}${'x'.repeat(75_000)}${largeSuffix}`;
  fs.writeFileSync(transcriptPath, [
    toolUse('grep-call', 'Grep', { pattern: 'CLAUDE_RESULT_SENTINEL', path: 'src' }),
    toolResult('grep-call', '1 line of output', { mode: 'content', content: grepMatch, numLines: 1 }),
    toolUse('read-call', 'Read', { file_path: 'fixture.txt' }),
    toolResult('read-call', readBody, { type: 'text', file: { filePath: 'fixture.txt', content: readBody, numLines: 3 } }),
    toolUse('edit-call', 'Edit', { file_path: 'fixture.js', old_string: 'old', new_string: 'new' }),
    toolResult('edit-call', 'The file fixture.js has been updated.', {
      filePath: 'fixture.js',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const old = true;', editDiffLine] }],
    }),
    toolUse('large-read-call', 'Read', { file_path: 'large.txt' }),
    toolResult('large-read-call', largeBody, {}),
  ].join('\n') + '\n', 'utf8');

  const messages = claudeCli.parseClaudeJsonl(transcriptPath);
  const blocks = messages.flatMap(message => message.content_blocks || []);
  assert.strictEqual(blocks.length, 4, 'each generic call/result pair must consolidate into one block');
  assert(blocks.every(block => block.type === 'tool_result'));
  assert(blocks.every(block => block.status === 'completed' && block.collapsed === false));
  assert.strictEqual(blocks.filter(block => block.type === 'tool_call').length, 0,
    'settled generic tools must not retain an input-only call card');

  const grep = blocks.find(block => block.tool_name === 'Grep');
  assert(grep.content.includes(grepMatch), 'Grep block dropped the actual matched line');
  assert(grep.content.includes('1 line of output'), 'Grep block may retain the native summary alongside real output');
  assert(!grep.content.includes('"pattern": "CLAUDE_RESULT_SENTINEL"'), 'Grep result must not echo only its input');

  const read = blocks.find(block => block.call_id === 'read-call');
  assert(read.content.includes(readBody), 'Read block dropped verbatim file content');

  const edit = blocks.find(block => block.tool_name === 'Edit');
  assert(edit.content.includes(editDiffLine), 'Edit block dropped the structured patch content');

  const large = blocks.find(block => block.call_id === 'large-read-call');
  assert(large.content.includes(largePrefix));
  assert(!large.content.includes(largeSuffix));
  assert.match(large.content, /\.\.\.\[truncated \d+ characters from Claude tool result\]$/,
    'large result cap must be explicit and truthful');

  console.log(JSON.stringify({
    ok: true,
    generic_pairs: blocks.length,
    tools: blocks.map(block => block.tool_name),
    grep_actual_content: true,
    read_actual_content: true,
    edit_actual_content: true,
    large_result_labeled: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
