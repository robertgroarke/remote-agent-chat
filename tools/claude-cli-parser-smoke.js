'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-claude-cli-parser-'));
const encodedProjectDir = path.join(tempRoot, 'c--workspaces-project-with-spaces');
const exactWorkspace = path.join(tempRoot, 'project-with-spaces');
const sessionId = '11111111-2222-4333-8444-555555555555';
const transcriptPath = path.join(encodedProjectDir, `${sessionId}.jsonl`);

function record(value) {
  return JSON.stringify({
    sessionId,
    cwd: exactWorkspace,
    entrypoint: 'cli',
    timestamp: '2026-07-10T12:00:00.000Z',
    ...value,
  });
}

try {
  fs.mkdirSync(encodedProjectDir, { recursive: true });
  fs.mkdirSync(exactWorkspace, { recursive: true });
  const lines = [
    record({
      type: 'user',
      uuid: 'user-1',
      message: { role: 'user', content: 'Inspect the fixture.' },
      permissionMode: 'bypassPermissions',
    }),
    record({
      type: 'assistant',
      uuid: 'assistant-thinking',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{ type: 'thinking', thinking: 'Reason through every fixture field.', signature: 'fixture-signature' }],
      },
    }),
    record({
      type: 'assistant',
      uuid: 'assistant-tool',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{
          type: 'tool_use',
          id: 'tool-call-1',
          name: 'Bash',
          input: { command: 'printf fixture-output', description: 'Print fixture output' },
        }],
      },
    }),
    record({
      type: 'user',
      uuid: 'tool-result-1',
      sourceToolAssistantUUID: 'assistant-tool',
      toolUseResult: {
        stdout: 'fixture-output',
        stderr: 'fixture-stderr',
        interrupted: false,
        noOutputExpected: false,
      },
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-call-1', content: 'fixture-output' }],
      },
    }),
    record({
      type: 'assistant',
      uuid: 'assistant-final',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{ type: 'text', text: 'Fixture complete.' }],
      },
    }),
  ];
  fs.writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf8');

  const messages = claudeCli.parseClaudeJsonl(transcriptPath);
  assert.strictEqual(messages.length, 4, 'paired tool result should enrich the call instead of duplicating it');
  assert.deepStrictEqual(messages.map(message => message.role), ['user', 'assistant', 'assistant', 'assistant']);

  const thinking = messages[1].content_blocks?.[0];
  assert.strictEqual(thinking.type, 'thinking');
  assert.strictEqual(thinking.content, 'Reason through every fixture field.');
  assert.strictEqual(thinking.collapsed, false);

  const terminal = messages[2].content_blocks?.[0];
  assert.strictEqual(terminal.type, 'terminal');
  assert.strictEqual(terminal.command, 'printf fixture-output');
  assert.strictEqual(terminal.stdout, 'fixture-output');
  assert.strictEqual(terminal.stderr, 'fixture-stderr');
  assert.strictEqual(terminal.status, 'completed');
  assert.strictEqual(terminal.collapsed, false);

  const markdown = messages[3].content_blocks?.[0];
  assert.deepStrictEqual(markdown, { type: 'markdown', content: 'Fixture complete.' });

  const summary = claudeCli.readSessionSummary(transcriptPath);
  assert.strictEqual(summary.workspacePath, exactWorkspace, 'exact JSONL cwd must win over lossy folder decoding');
  assert.strictEqual(summary.workspaceName, path.basename(exactWorkspace));
  assert.strictEqual(summary.model_id, 'claude-test-model');
  assert.strictEqual(summary.permission_mode, 'bypassPermissions');
  assert.strictEqual(summary.isCliLike, true);
  assert.strictEqual(summary.title, 'Inspect the fixture.');

  console.log('PASS claude-cli parser: exact cwd, structured thinking/tool output, expanded defaults, and config metadata');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
