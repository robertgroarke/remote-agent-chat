#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CANONICAL_BLOCK_TYPES, normalizeMessageBlocks, blocksToPlainText } = require('../android-app/lib/content-blocks');
const { parseCodexJsonl } = require('../agent-proxy/codex-cli');
const protocol = require('../agent-proxy/protocol');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_TYPES = [
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
];

assert.deepStrictEqual(CANONICAL_BLOCK_TYPES, EXPECTED_TYPES);

const normalizedAliases = normalizeMessageBlocks({
  role: 'assistant',
  content_blocks: [
    { type: 'tool_output', content: 'done' },
    { type: 'task_list', tasks: [{ step: 'Ship it', status: 'in_progress' }] },
    { type: 'queued', content: 'after this turn' },
    { type: 'notification', content: 'still working' },
  ],
});
assert.deepStrictEqual(
  normalizedAliases.map(block => block.type),
  ['tool_result', 'plan', 'queued_message', 'notice'],
);
assert.match(blocksToPlainText(normalizedAliases), /Ship it/);

const proxyQueueEvent = protocol.messageQueued('session-queue', 'cmsg-queue', 'Run after this turn');
assert.deepStrictEqual(proxyQueueEvent.content_blocks, [{
  type: 'queued_message',
  label: 'Queued message',
  content: 'Run after this turn',
  client_message_id: 'cmsg-queue',
  status: 'queued',
}]);
const nativeQueueEvent = protocol.nativeQueue('session-native-queue', [
  { text: 'Steer this next', index: 4, state: 'paused' },
]);
assert.deepStrictEqual(nativeQueueEvent.items[0].content_blocks, [{
  type: 'queued_message',
  label: 'Queued message',
  content: 'Steer this next',
  client_message_id: 'native-4',
  status: 'paused',
}]);
assert.deepStrictEqual(nativeQueueEvent.content_blocks, nativeQueueEvent.items[0].content_blocks);
const taskListEvent = protocol.proxyStatus('session-plan', 'healthy', {
  kind: 'working',
  task_list: {
    completed: 1,
    total: 2,
    tasks: [
      { text: 'Inspect state', state: 'completed' },
      { text: 'Apply fix', state: 'in_progress' },
    ],
  },
});
assert.deepStrictEqual(taskListEvent.activity.task_list.content_blocks, [{
  type: 'plan',
  label: 'Plan',
  total: 2,
  completed: 1,
  tasks: taskListEvent.activity.task_list.tasks,
}]);
const permissionEvent = protocol.permissionPrompt('session-prompt', {
  prompt_id: 'prompt-1',
  title: 'Approval required',
  message: 'Allow this command?',
  choices: [{ choice_id: 'allow', label: 'Allow' }, { choice_id: 'deny', label: 'Deny' }],
});
assert.deepStrictEqual(permissionEvent.content_blocks, [{
  type: 'prompt',
  label: 'Approval required',
  content: 'Allow this command?',
  actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
}]);
const noticeEvent = protocol.sessionErrorPrompt('session-notice', {
  prompt_id: 'notice-1', title: 'Response delayed', message: 'Retry or keep waiting.',
  display_mode: 'inline', blocking: false,
  actions: [{ action_id: 'retry', label: 'Retry' }],
});
assert.strictEqual(noticeEvent.content_blocks[0].type, 'notice');
assert.deepStrictEqual(noticeEvent.content_blocks[0].actions, [{ id: 'retry', label: 'Retry' }]);
const errorEvent = protocol.sessionErrorPrompt('session-error', {
  prompt_id: 'error-1', title: 'Action required', message: 'The request failed.',
  actions: [{ action_id: 'dismiss', label: 'Dismiss' }],
});
assert.strictEqual(errorEvent.content_blocks[0].type, 'error');

const frontendSource = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const androidSource = fs.readFileSync(path.join(ROOT, 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
const protocolSource = fs.readFileSync(path.join(ROOT, 'protocol.md'), 'utf8');
const webMarkers = {
  markdown: 'content-block-markdown',
  thinking: 'content-block-thinking',
  tool_call: "type === 'tool_call'",
  tool_result: "type === 'tool_result'",
  terminal: 'content-block-terminal',
  file_changes: 'content-block-file-change',
  artifact: 'content-block-artifact',
  prompt: "type === 'prompt' || type === 'error'",
  plan: 'content-block-plan',
  queued_message: 'content-block-queued-message',
  notice: 'content-block-notice',
  error: "type === 'prompt' || type === 'error'",
  status: 'content-block-status-chip',
};
for (const type of EXPECTED_TYPES) {
  assert(frontendSource.includes(webMarkers[type]), 'web renderer is missing ' + type);
  assert.match(androidSource, new RegExp("case ['\"]" + type + "['\"]"), 'Android renderer is missing ' + type);
  const tick = String.fromCharCode(96);
  assert(
    protocolSource.includes(tick + type + tick) || protocolSource.includes('"type": "' + type + '"'),
    'protocol is missing ' + type,
  );
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-content-blocks-'));
const fixturePath = path.join(tempRoot, 'rollout.jsonl');
const now = new Date().toISOString();
const entries = [
  { timestamp: now, type: 'session_meta', payload: { id: 'content-block-smoke', cwd: ROOT } },
  {
    timestamp: now,
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      call_id: 'call_plan',
      arguments: JSON.stringify({
        plan: [
          { step: 'Inspect state', status: 'completed' },
          { step: 'Apply fix', status: 'in_progress' },
        ],
      }),
    },
  },
  {
    timestamp: now,
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call_plan',
      output: 'Plan updated',
    },
  },
  { timestamp: now, type: 'event_msg', payload: { type: 'context_compacted', message: 'Older context summarized.' } },
  { timestamp: now, type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } },
];
fs.writeFileSync(fixturePath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');

let parsed;
try {
  parsed = parseCodexJsonl(fixturePath);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
const produced = parsed.flatMap(message => message.content_blocks || []);
assert(produced.some(block => block.type === 'plan' && block.tasks?.length === 2), 'Codex CLI must emit a typed plan');
assert(produced.some(block => block.type === 'tool_result' && /Plan updated/.test(block.content)), 'Codex CLI must emit a typed tool result');
assert(produced.filter(block => block.type === 'notice').length >= 2, 'Codex CLI must emit typed compaction and rollback notices');

const result = {
  ok: true,
  canonical_block_types: EXPECTED_TYPES,
  alias_types: normalizedAliases.map(block => block.type),
  codex_cli_producer_types: [...new Set(produced.map(block => block.type))],
  queued_event_producer_types: [
    proxyQueueEvent.content_blocks[0].type,
    nativeQueueEvent.content_blocks[0].type,
  ],
  live_task_list_producer_type: taskListEvent.activity.task_list.content_blocks[0].type,
  prompt_event_producer_types: [
    permissionEvent.content_blocks[0].type,
    noticeEvent.content_blocks[0].type,
    errorEvent.content_blocks[0].type,
  ],
  web_renderers: EXPECTED_TYPES,
  android_renderers: EXPECTED_TYPES,
  generated_at: new Date().toISOString(),
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
