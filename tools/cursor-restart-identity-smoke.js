#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildCursorStableSignatureSource,
  findCursorStableSession,
} = require('../agent-proxy/session-store');

const first = buildCursorStableSignatureSource({
  workspacePath: 'C:/temp/cursor-test/',
  workspaceName: 'cursor-test',
  windowTitle: 'First title - Cursor',
});
const restarted = buildCursorStableSignatureSource({
  workspacePath: 'c:\\temp\\cursor-test',
  workspaceName: 'cursor-test',
  windowTitle: 'Different active agent - Cursor [Administrator]',
});
const other = buildCursorStableSignatureSource({
  workspacePath: 'C:\\temp\\other-workspace',
  workspaceName: 'other-workspace',
  windowTitle: 'Other - Cursor',
});
assert.strictEqual(first, restarted, 'target/title churn must not change Cursor workspace identity');
assert.notStrictEqual(first, other, 'different Cursor workspace paths must remain distinct');
assert.strictEqual(
  buildCursorStableSignatureSource({ workspaceName: 'Cursor Agents' }),
  buildCursorStableSignatureSource({ workspaceName: ' cursor   agents ' }),
  'pathless Cursor surface names must normalize stably',
);

const fixtures = {
  newerShortDuplicate: {
    agent_type: 'cursor',
    workspace_path: 'c:\\temp\\cursor-test',
    created_at: '2026-07-11T03:10:57.011Z',
    accumulated_messages: Array(5).fill({ role: 'user', content: 'short' }),
  },
  durableOriginal: {
    agent_type: 'cursor',
    workspace_path: 'C:/temp/cursor-test/',
    created_at: '2026-07-10T13:52:57.839Z',
    accumulated_messages: Array(22).fill({ role: 'user', content: 'durable' }),
  },
  otherWorkspace: {
    agent_type: 'cursor',
    workspace_path: 'c:\\temp\\other-workspace',
    created_at: '2026-07-09T00:00:00.000Z',
    accumulated_messages: Array(100).fill({ role: 'user', content: 'other' }),
  },
  newerAgentsSurface: {
    agent_type: 'cursor',
    workspace_name: 'Cursor Agents',
    workspace_path: null,
    created_at: '2026-07-11T03:10:56.949Z',
  },
  originalAgentsSurface: {
    agent_type: 'cursor',
    workspace_name: 'Cursor Agents',
    workspace_path: null,
    created_at: '2026-07-10T13:52:56.309Z',
  },
};

assert.strictEqual(
  findCursorStableSession(fixtures, { workspacePath: 'c:\\temp\\cursor-test' })?.[0],
  'durableOriginal',
  'migration must prefer the deepest durable Cursor transcript',
);
assert.strictEqual(
  findCursorStableSession(fixtures, { workspaceName: 'Cursor Agents' })?.[0],
  'originalAgentsSurface',
  'equal pathless surfaces must prefer the earliest durable record',
);

const storeSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.js'), 'utf8');
assert(
  storeSource.indexOf('const cursorMatch = agentType') < storeSource.indexOf('// Primary match: same signature'),
  'Cursor workspace migration must run before generic signature and target-ID matching',
);
const engineSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
assert(engineSource.includes("const restoreStoredCursorAccumulator = agentType === 'cursor'"));
assert(engineSource.includes('_cursorAgentHistories: initialCursorAgentHistories'));
assert(engineSource.includes("agentType === 'codex-desktop' || agentType === 'cursor'"));
assert(engineSource.includes('title not settled; deferring registration'));
assert(engineSource.includes('targetOwnedByAnotherCursorSession'));

console.log('cursor restart identity smoke: PASS');
