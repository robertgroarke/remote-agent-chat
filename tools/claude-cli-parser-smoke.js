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
      uuid: 'assistant-read-tool',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{
          type: 'tool_use',
          id: 'tool-call-2',
          name: 'Read',
          input: { file_path: 'README.md' },
        }],
      },
    }),
    record({
      type: 'user',
      uuid: 'tool-result-2',
      sourceToolAssistantUUID: 'assistant-read-tool',
      toolUseResult: { content: 'fixture file content' },
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-call-2', content: 'fixture file content' }],
      },
    }),
    record({
      type: 'assistant',
      uuid: 'assistant-plan-tool',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{
          type: 'tool_use',
          id: 'tool-call-3',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Inspect fixture', activeForm: 'Inspecting fixture', status: 'completed' },
              { content: 'Verify mapping', activeForm: 'Verifying mapping', status: 'in_progress' },
            ],
          },
        }],
      },
    }),
    record({
      type: 'user',
      uuid: 'tool-result-3',
      sourceToolAssistantUUID: 'assistant-plan-tool',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-call-3', content: 'Todos updated' }],
      },
    }),
    record({
      type: 'assistant',
      uuid: 'assistant-question-tool',
      message: {
        role: 'assistant',
        model: 'claude-test-model',
        content: [{
          type: 'tool_use',
          id: 'tool-call-4',
          name: 'AskUserQuestion',
          input: {
            questions: [{
              header: 'Approach',
              question: 'Which verified approach should continue?',
              multiSelect: false,
              options: [
                { label: 'Canonical', description: 'Preserve structured semantics.' },
                { label: 'Flattened', description: 'Use generic Markdown.' },
              ],
            }],
          },
        }],
      },
    }),
    record({
      type: 'user',
      uuid: 'tool-result-4',
      sourceToolAssistantUUID: 'assistant-question-tool',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-call-4', content: 'Canonical' }],
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
  assert.strictEqual(messages.length, 10, 'terminal output stays combined while structured calls and results remain distinct');
  assert(messages.every(message => message.role === 'user' || message.role === 'assistant'));

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

  const toolCall = messages[3].content_blocks?.[0];
  assert.strictEqual(toolCall.type, 'tool_call');
  assert.strictEqual(toolCall.title, 'Read');
  assert.match(toolCall.content, /README\.md/);
  assert.doesNotMatch(toolCall.content, /fixture file content/, 'tool call must not flatten its result');
  assert.strictEqual(toolCall.call_id, 'tool-call-2');

  const toolResult = messages[4].content_blocks?.[0];
  assert.strictEqual(toolResult.type, 'tool_result');
  assert.strictEqual(toolResult.title, 'Tool result: Read');
  assert.match(toolResult.content, /fixture file content/);
  assert.strictEqual(toolResult.call_id, 'tool-call-2');
  assert.strictEqual(toolResult.tool_name, 'Read');
  assert.strictEqual(toolResult.status, 'completed');
  assert.strictEqual(toolResult.collapsed, false);

  const plan = messages[5].content_blocks?.[0];
  assert.strictEqual(plan.type, 'plan');
  assert.strictEqual(plan.title, 'Tasks');
  assert.deepStrictEqual(plan.tasks.map(task => task.status), ['completed', 'in_progress']);
  assert.deepStrictEqual(plan.tasks.map(task => task.step), ['Inspect fixture', 'Verify mapping']);
  assert.strictEqual(plan.call_id, 'tool-call-3');
  assert.strictEqual(plan.collapsed, false);

  const planResult = messages[6].content_blocks?.[0];
  assert.strictEqual(planResult.type, 'tool_result');
  assert.strictEqual(planResult.call_id, 'tool-call-3');

  const prompt = messages[7].content_blocks?.[0];
  assert.strictEqual(prompt.type, 'prompt');
  assert.strictEqual(prompt.title, 'Approach');
  assert.match(prompt.content, /Which verified approach should continue\?/);
  assert.match(prompt.content, /Canonical/);
  assert.match(prompt.content, /Preserve structured semantics/);
  assert.strictEqual(prompt.call_id, 'tool-call-4');
  assert.strictEqual(prompt.collapsed, false);

  const promptResult = messages[8].content_blocks?.[0];
  assert.strictEqual(promptResult.type, 'tool_result');
  assert.strictEqual(promptResult.call_id, 'tool-call-4');

  const markdown = messages[9].content_blocks?.[0];
  assert.deepStrictEqual(markdown, { type: 'markdown', content: 'Fixture complete.' });

  const summary = claudeCli.readSessionSummary(transcriptPath);
  assert.strictEqual(summary.workspacePath, exactWorkspace, 'exact JSONL cwd must win over lossy folder decoding');
  assert.strictEqual(summary.workspaceName, path.basename(exactWorkspace));
  assert.strictEqual(summary.model_id, 'claude-test-model');
  assert.strictEqual(summary.permission_mode, 'bypassPermissions');
  assert.strictEqual(summary.isCliLike, true);
  assert.strictEqual(summary.title, 'Inspect the fixture.');

  console.log('PASS claude-cli parser: exact cwd, canonical plan/prompt/tool-result blocks, terminal output, expanded defaults, and config metadata');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
