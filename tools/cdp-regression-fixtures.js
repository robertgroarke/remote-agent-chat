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
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'codex-desktop'],
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
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'codex-desktop'],
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
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'codex-desktop'],
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
    surfaces: ['codex', 'antigravity_panel', 'codex-desktop'],
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
    surfaces: ['claude', 'codex', 'continue', 'antigravity_panel', 'codex-desktop'],
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
  evaluateFixtureMessages,
  getFixture,
  listFixtures,
  normalizeRunId,
  renderFixturePrompt,
};

