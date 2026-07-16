#!/usr/bin/env node
'use strict';

const path = require('path');

const DISPOSABLE_EDIT_FILE = 'tests/fixtures/cdp-regression/disposable-edit.txt';
const PREVIEW_SOURCE_FILE = 'tests/fixtures/cdp-regression/preview-source.md';

function normalizeRunId(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'fixture-run';
}

function buildLongBlock(runId) {
  const lines = [];
  for (let i = 1; i <= 320; i++) {
    const n = String(i).padStart(4, '0');
    lines.push(`CDP_LONG_BLOCK_${n} ${runId} This paragraph exists to exercise large pasted message handling without introducing random text drift.`);
  }
  return lines.join('\n');
}

const FIXTURES = {
  TEXT_SHORT: {
    id: 'TEXT_SHORT',
    kind: 'message',
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'antigravity-v2', 'codex-desktop'],
    description: 'Short deterministic round-trip prompt.',
    prompt({ runId }) {
      return [
        `CDP_FIXTURE TEXT_SHORT ${runId}`,
        '',
        'Reply with exactly this single line and nothing else:',
        `CDP_FIXTURE_ACK TEXT_SHORT ${runId}`,
      ].join('\n');
    },
    expectedAssistantMarkers({ runId }) {
      return [`CDP_FIXTURE_ACK TEXT_SHORT ${runId}`];
    },
  },

  TEXT_LONG: {
    id: 'TEXT_LONG',
    kind: 'message',
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'antigravity-v2', 'codex-desktop'],
    description: 'Large deterministic pasted prompt over 20 KB.',
    prompt({ runId }) {
      return [
        `CDP_FIXTURE TEXT_LONG ${runId}`,
        '',
        'Keep the response short. Reply with exactly this single line and nothing else:',
        `CDP_FIXTURE_ACK TEXT_LONG ${runId}`,
        '',
        'Long body begins below. Do not summarize it back to me.',
        buildLongBlock(runId),
      ].join('\n');
    },
    expectedAssistantMarkers({ runId }) {
      return [`CDP_FIXTURE_ACK TEXT_LONG ${runId}`];
    },
  },

  TOOL_HEAVY: {
    id: 'TOOL_HEAVY',
    kind: 'message',
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'antigravity-v2', 'codex-desktop'],
    description: 'Safe tool-heavy prompt that should emit shell/read activity and deterministic headings.',
    prompt({ runId }) {
      return [
        `CDP_FIXTURE TOOL_HEAVY ${runId}`,
        '',
        'Run these safe checks in the repo and then answer with the exact headings shown below:',
        `1. pwd`,
        `2. git status --short`,
        `3. read ${PREVIEW_SOURCE_FILE}`,
        '',
        'Use this exact response structure:',
        `CDP_FIXTURE_ACK TOOL_HEAVY ${runId}`,
        `CDP_FIXTURE_TOOL_STATUS ${runId}`,
        `CDP_FIXTURE_TOOL_FILE ${runId} ${PREVIEW_SOURCE_FILE}`,
      ].join('\n');
    },
    expectedAssistantMarkers({ runId }) {
      return [
        `CDP_FIXTURE_ACK TOOL_HEAVY ${runId}`,
        `CDP_FIXTURE_TOOL_STATUS ${runId}`,
        `CDP_FIXTURE_TOOL_FILE ${runId} ${PREVIEW_SOURCE_FILE}`,
      ];
    },
  },

  DIFF_HEAVY: {
    id: 'DIFF_HEAVY',
    kind: 'message',
    surfaces: ['claude', 'codex', 'continue', 'codex-desktop'],
    description: 'Small disposable edit against a tracked regression fixture file.',
    prompt({ runId }) {
      return [
        `CDP_FIXTURE DIFF_HEAVY ${runId}`,
        '',
        `Edit ${DISPOSABLE_EDIT_FILE}.`,
        'Make only these changes:',
        `- Replace the line "STATUS: ORIGINAL" with "STATUS: UPDATED ${runId}"`,
        `- Append the line "RUN_ID: ${runId}" at the end of the file`,
        '',
        'After the edit, reply with exactly these two lines:',
        `CDP_FIXTURE_ACK DIFF_HEAVY ${runId}`,
        `CDP_FIXTURE_DIFF_FILE ${runId} ${DISPOSABLE_EDIT_FILE}`,
      ].join('\n');
    },
    expectedAssistantMarkers({ runId }) {
      return [
        `CDP_FIXTURE_ACK DIFF_HEAVY ${runId}`,
        `CDP_FIXTURE_DIFF_FILE ${runId} ${DISPOSABLE_EDIT_FILE}`,
      ];
    },
  },

  THREAD_SWITCH: {
    id: 'THREAD_SWITCH',
    kind: 'manual',
    surfaces: ['codex', 'antigravity_panel', 'antigravity-v2', 'codex-desktop'],
    description: 'Manual thread/chat switch procedure with deterministic message text.',
    operatorSteps({ runId }) {
      return [
        'Create a new thread or chat in the native surface.',
        `Send: CDP_FIXTURE THREAD_SWITCH ${runId}`,
        `Wait for the assistant to reply with: CDP_FIXTURE_ACK THREAD_SWITCH ${runId}`,
        'Switch away to another thread or chat.',
        'Switch back and verify both the user message and assistant reply still appear.',
      ];
    },
    prompt({ runId }) {
      return [
        `CDP_FIXTURE THREAD_SWITCH ${runId}`,
        '',
        'Reply with exactly this single line and nothing else:',
        `CDP_FIXTURE_ACK THREAD_SWITCH ${runId}`,
      ].join('\n');
    },
    expectedAssistantMarkers({ runId }) {
      return [`CDP_FIXTURE_ACK THREAD_SWITCH ${runId}`];
    },
  },

  IMAGE_PASTE: {
    id: 'IMAGE_PASTE',
    kind: 'manual',
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'antigravity-v2', 'codex-desktop'],
    description: 'Manual screenshot/image attachment check.',
    operatorSteps({ runId }) {
      return [
        'Paste or attach a screenshot in the native surface.',
        `Send the line: CDP_FIXTURE IMAGE_PASTE ${runId}`,
        'Verify the image renders inline in the native UI and in the WebUI.',
        'Verify the WebUI transcript does not show a leaked local file path instead of the image.',
      ];
    },
  },

  PERMISSION_TOGGLE: {
    id: 'PERMISSION_TOGGLE',
    kind: 'control',
    surfaces: ['claude'],
    description: 'Safe control test for Claude Code permission mode toggling.',
    operatorSteps() {
      return [
        'Read the current permission mode from the native Claude Code surface.',
        'Toggle to a different safe mode through the WebUI control.',
        'Verify the native Claude Code dropdown reflects the change.',
        'Restore the original mode and verify it returned.',
      ];
    },
  },
};

const ANTIGRAVITY_V2_STRUCTURAL_FIXTURES = [
  {
    id: 'agv2_finished_markdown',
    description: 'Finished assistant transcript with markdown, table, and fenced code.',
    messages: [{
      role: 'assistant',
      content_blocks: [
        { type: 'markdown', content: '# Done\n\n| Check | Result |\n| --- | --- |\n| v2 | pass |\n\n```js\nconsole.log("agv2");\n```' },
      ],
    }],
  },
  {
    id: 'agv2_thinking',
    description: 'Collapsed thinking/work block.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'thinking', label: 'Thought for 2m', content: 'Inspected the page and selected a plan.', collapsed: true }] }],
  },
  {
    id: 'agv2_status',
    description: 'Completed work-duration status chip.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'status', label: 'Worked for 25s', content: 'Worked for 25s', status: 'completed', collapsed: true }] }],
  },
  {
    id: 'agv2_tool_running',
    description: 'Running tool call block.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'tool_call', label: 'Task', status: 'running', content: 'Checking workspace state...' }] }],
  },
  {
    id: 'agv2_tool_done',
    description: 'Completed tool call block.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'tool_call', label: 'Walkthrough', status: 'done', content: 'Opened the walkthrough artifact.' }] }],
  },
  {
    id: 'agv2_terminal',
    description: 'Terminal command output.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'terminal', command: 'node --version', stdout: 'v24.11.1', stderr: '', exit_code: 0 }] }],
  },
  {
    id: 'agv2_file_changes',
    description: 'Multi-file change summary.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'file_changes', summary: '2 files changed', files_changed: 2, additions: 52, deletions: 5, files: [{ path: 'agent-proxy/selectors.js', added: 40, removed: 2 }, { path: 'frontend/app.jsx', added: 12, removed: 3 }] }] }],
  },
  {
    id: 'agv2_artifact',
    description: 'Named artifact chip.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'artifact', label: 'Verify Fix', artifact_type: 'task', content: 'Verification artifact opened.' }] }],
  },
  {
    id: 'agv2_error',
    description: 'Failed turn/error block.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'error', label: 'Failed', content: 'The request failed.', actions: [{ id: 'retry', label: 'Retry' }] }] }],
  },
  {
    id: 'agv2_prompt',
    description: 'Permission or approval prompt block.',
    messages: [{ role: 'assistant', content_blocks: [{ type: 'prompt', label: 'Approval required', content: 'Allow this safe action?', actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] }] }],
  },
];

const CANONICAL_BLOCK_TYPES = new Set(['markdown', 'thinking', 'tool_call', 'terminal', 'file_changes', 'artifact', 'prompt', 'error', 'status']);

function blockPlainText(block) {
  if (!block || typeof block !== 'object') return '';
  return [
    block.label,
    block.summary,
    block.content,
    block.command,
    block.stdout,
    block.stderr,
    Array.isArray(block.files) ? block.files.map(file => `${file.path || ''} +${file.added || 0} -${file.removed || 0}`).join('\n') : '',
  ].filter(Boolean).join('\n');
}

function evaluateAntigravityV2StructuralFixtures() {
  const results = [];
  for (const fixture of ANTIGRAVITY_V2_STRUCTURAL_FIXTURES) {
    const failures = [];
    for (const message of fixture.messages || []) {
      const blocks = Array.isArray(message.content_blocks) ? message.content_blocks : [];
      if (!blocks.length) failures.push('missing content_blocks');
      for (const block of blocks) {
        if (!CANONICAL_BLOCK_TYPES.has(block.type)) failures.push(`off-spec block type ${block.type}`);
        if (!blockPlainText(block).trim()) failures.push(`empty ${block.type} block`);
      }
      const fallback = blocks.map(blockPlainText).filter(Boolean).join('\n\n').trim();
      if (!fallback) failures.push('empty plain-text fallback');
    }
    results.push({
      fixture_id: fixture.id,
      description: fixture.description,
      status: failures.length ? 'fail' : 'pass',
      failures,
    });
  }
  return results;
}

function listFixtures() {
  return Object.values(FIXTURES).map((fixture) => ({
    id: fixture.id,
    kind: fixture.kind,
    surfaces: fixture.surfaces.slice(),
    description: fixture.description,
  }));
}

function getFixture(id) {
  return FIXTURES[String(id || '').trim()] || null;
}

function renderFixturePrompt(id, options = {}) {
  const fixture = getFixture(id);
  if (!fixture) throw new Error(`Unknown fixture: ${id}`);
  const runId = normalizeRunId(options.runId);
  const workspacePath = options.workspacePath || path.resolve(__dirname, '..');
  return {
    fixture_id: fixture.id,
    kind: fixture.kind,
    run_id: runId,
    workspace_path: workspacePath,
    surfaces: fixture.surfaces.slice(),
    description: fixture.description,
    prompt: typeof fixture.prompt === 'function' ? fixture.prompt({ runId, workspacePath, surface: options.surface || null }) : null,
    expected_assistant_markers: typeof fixture.expectedAssistantMarkers === 'function'
      ? fixture.expectedAssistantMarkers({ runId, workspacePath, surface: options.surface || null })
      : [],
    operator_steps: typeof fixture.operatorSteps === 'function'
      ? fixture.operatorSteps({ runId, workspacePath, surface: options.surface || null })
      : [],
  };
}

function evaluateFixtureMessages(messages, fixtureId, runId) {
  const fixture = getFixture(fixtureId);
  if (!fixture) throw new Error(`Unknown fixture: ${fixtureId}`);
  const normalizedRunId = normalizeRunId(runId);
  const expectedMarkers = typeof fixture.expectedAssistantMarkers === 'function'
    ? fixture.expectedAssistantMarkers({ runId: normalizedRunId })
    : [];
  const anchor = `CDP_FIXTURE ${fixture.id} ${normalizedRunId}`;
  const list = Array.isArray(messages) ? messages : [];

  const userIndex = list.findIndex((msg) =>
    String(msg.role || '').trim() === 'user' &&
    String(msg.content || '').includes(anchor)
  );

  const assistantIndex = userIndex === -1
    ? -1
    : list.findIndex((msg, index) =>
      index > userIndex &&
      String(msg.role || '').trim() === 'assistant' &&
      expectedMarkers.every((marker) => String(msg.content || '').includes(marker))
    );

  const missingMarkers = assistantIndex === -1
    ? expectedMarkers.slice()
    : expectedMarkers.filter((marker) => !String(list[assistantIndex].content || '').includes(marker));

  return {
    fixture_id: fixture.id,
    run_id: normalizedRunId,
    pass: userIndex !== -1 && assistantIndex !== -1 && missingMarkers.length === 0,
    user_index: userIndex,
    assistant_index: assistantIndex,
    missing_markers: missingMarkers,
    expected_assistant_markers: expectedMarkers,
    anchor,
  };
}

module.exports = {
  DISPOSABLE_EDIT_FILE,
  PREVIEW_SOURCE_FILE,
  FIXTURES,
  ANTIGRAVITY_V2_STRUCTURAL_FIXTURES,
  evaluateFixtureMessages,
  evaluateAntigravityV2StructuralFixtures,
  getFixture,
  listFixtures,
  normalizeRunId,
  renderFixturePrompt,
};

