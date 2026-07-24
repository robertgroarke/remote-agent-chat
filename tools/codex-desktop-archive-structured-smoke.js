#!/usr/bin/env node
'use strict';

const assert = require('assert');
const codexCli = require('../agent-proxy/codex-cli');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const {
  codexDesktopCliSessionId,
  codexDesktopArchiveMessages,
  codexDesktopStructuredBlockCounts,
  shellExecDetails,
} = require('../agent-proxy/codex-desktop-archive');

const THREAD_ID = '019f51a6-8834-7c21-95fc-78fa8b3daba9';
const THINKING_THREAD_ID = '019f51a6-8834-7c21-95fc-78fa8b3dabb0';
const LARGE_THREAD_ID = '019f51a6-8834-7c21-95fc-78fa8b3dabb1';
const shellCall = {
  role: 'assistant',
  content: '[Tool: exec]',
  content_blocks: [{
    type: 'tool_call',
    title: 'Tool: exec',
    tool_name: 'exec',
    call_id: 'call-shell',
    status: 'completed',
    content: [
      'tool: exec',
      '',
      'call_id: call-shell',
      '',
      'arguments:',
      'const r = await tools.shell_command({command:"Get-ChildItem -Force", timeout_ms:10000});',
    ].join('\n'),
  }],
  ts: 100,
};
const shellResult = {
  role: 'assistant',
  content: '[Tool result: exec]',
  content_blocks: [{
    type: 'tool_result',
    title: 'Tool result: exec',
    call_id: 'call-shell',
    status: 'completed',
    content: `tool: exec\n\ncall_id: call-shell\n\noutput:\n${JSON.stringify('Script completed\nExit code: 0\nOutput:\nfile.txt')}`,
  }],
  ts: 101,
};
const editCall = {
  role: 'assistant',
  content: '[Tool: exec]',
  content_blocks: [{
    type: 'tool_call',
    title: 'Tool: exec',
    tool_name: 'exec',
    call_id: 'call-edit',
    status: 'completed',
    content: 'tool: exec\n\ncall_id: call-edit\n\narguments:\nawait tools.apply_patch(patch);',
  }],
  ts: 102,
};
const fileChange = {
  role: 'assistant',
  content: 'Patch applied',
  content_blocks: [{
    type: 'file_changes',
    summary: '1 file changed',
    content: 'src/app.js +1 -0',
    files: [{ path: 'src/app.js', additions: 1, deletions: 0 }],
  }],
  ts: 103,
};

assert.equal(codexDesktopCliSessionId(`local:${THREAD_ID}`), THREAD_ID);
assert.equal(codexDesktopCliSessionId('local:not-a-session'), '');
assert(shellExecDetails(shellCall.content_blocks[0]));
assert.equal(shellExecDetails(editCall.content_blocks[0]), null,
  'non-shell exec orchestration must not become a terminal block');

const normalized = codexDesktopArchiveMessages([shellCall, shellResult, editCall, fileChange]);
assert.equal(normalized.length, 3, 'paired shell call/result must become one terminal message');
const terminal = normalized[0].content_blocks[0];
assert.equal(terminal.type, 'terminal');
assert.equal(terminal.command, 'Get-ChildItem -Force');
assert.equal(terminal.stdout, 'Script completed\nExit code: 0\nOutput:\nfile.txt');
assert.equal(terminal.exit_code, 0);
assert.equal(terminal.status, 'completed');
assert.equal(terminal.completed_ts, 101);
assert.equal(normalized[1], editCall, 'non-shell exec call must retain its native tool structure');
assert.equal(normalized[2], fileChange, 'file-change block must remain ordered and unchanged');
assert.deepEqual(codexDesktopStructuredBlockCounts(normalized), {
  terminal: 1,
  tool_call: 1,
  file_changes: 1,
});

const failed = codexDesktopArchiveMessages([
  { ...shellCall, content_blocks: [{ ...shellCall.content_blocks[0], call_id: 'call-failed' }] },
  {
    ...shellResult,
    content_blocks: [{
      ...shellResult.content_blocks[0],
      call_id: 'call-failed',
      content: `tool: exec\n\ncall_id: call-failed\n\noutput:\n${JSON.stringify('Exit code: 7\nOutput:\nfailed')}`,
    }],
  },
]);
assert.equal(failed[0].content_blocks[0].exit_code, 7);
assert.equal(failed[0].content_blocks[0].status, 'error');

const originalFind = codexCli.findSessionByCliId;
const originalTitleFind = codexCli.findLatestSessionForTitle;
const originalAnchorFind = codexCli.findRecentSessionByUserAnchor;
try {
  const thinkingUser = { role: 'user', content: 'Keep exact native summary fidelity' };
  const thinkingTerminal = {
    role: 'assistant',
    content: '[Command]',
    content_blocks: [{ type: 'terminal', title: 'Command', command: 'Write-Output ok', stdout: 'ok' }],
  };
  const activitySummary = {
    type: 'thinking',
    title: 'Thinking',
    label: 'Thinking',
    content: 'Designing process management helpers',
    activity_summary: true,
    native_turn_id: 'turn-summary',
    native_source_id: 'response_item.reasoning:id:summary',
    producer_timestamp: '2026-07-21T11:47:22.971Z',
  };
  const largeNativeArchive = Array.from({ length: 3000 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Large exact native transcript row ${index + 1} with enough stable content to anchor the immutable archive.`,
    source_message_id: `large-native-source-${index + 1}`,
    native_source_id: `large-native-item-${index + 1}`,
    native_turn_id: `large-native-turn-${Math.floor(index / 2) + 1}`,
    sequence: index + 1,
    ts: 1000 + index,
  }));
  codexCli.findSessionByCliId = id => {
    if (id === THREAD_ID) return {
      cliSessionId: THREAD_ID,
      filePath: 'fixture.jsonl',
      updatedAt: '2026-07-13T00:00:00.000Z',
      messages: [shellCall, shellResult, editCall, fileChange],
      messagesPartial: true,
    };
    if (id === THINKING_THREAD_ID) return {
      cliSessionId: THINKING_THREAD_ID,
      filePath: 'thinking-fixture.jsonl',
      updatedAt: '2026-07-21T11:47:23.000Z',
      messages: [thinkingUser, {
        ...thinkingTerminal,
        content_blocks: [...thinkingTerminal.content_blocks, activitySummary],
      }],
    };
    if (id === LARGE_THREAD_ID) return {
      cliSessionId: LARGE_THREAD_ID,
      filePath: 'large-exact-fixture.jsonl',
      updatedAt: '2026-07-22T08:00:00.000Z',
      sizeBytes: 4_000_000,
      messages: largeNativeArchive,
      messagesPartial: false,
    };
    return null;
  };
  codexCli.findLatestSessionForTitle = () => {
    throw new Error('exact UUID recovery must not fall back to a title match');
  };
  const engine = Object.create(ProxyEngine.prototype);
  engine._log = () => {};
  const visibleDelegatedUser = {
    role: 'user',
    content: 'Continue the exact Desktop fidelity investigation without changing the protected session or inventing a new native prompt.',
    ts: 1784602339,
  };
  const nativeDelegatedUser = {
    ...visibleDelegatedUser,
    content: `<codex_delegation><input>${visibleDelegatedUser.content}</input></codex_delegation>`,
  };
  assert.equal(engine._codexDesktopArchiveUserIndex([nativeDelegatedUser], visibleDelegatedUser), 0,
    'a timestamp-bound native delegation envelope must cover its stripped Desktop user card');
  assert.equal(engine._codexDesktopArchiveUserIndex(
    [{ ...nativeDelegatedUser, ts: visibleDelegatedUser.ts - 2 }],
    visibleDelegatedUser,
  ), -1, 'a repeated suffix from another timestamp must not authorize archive replacement');
  const dom = [
    { role: 'assistant', content: 'Edited 1 file', content_blocks: [{ type: 'markdown', content: 'Edited 1 file' }] },
    { role: 'assistant', content: 'Context remaining', content_blocks: [{ type: 'markdown', content: 'Context remaining' }] },
  ];
  const recovered = engine._maybeUseCodexDesktopArchive('fixture-session', {
    agentType: 'codex-desktop',
    _activeThreadKey: `local:${THREAD_ID}`,
    _activeThreadTitle: 'mutable presentation title',
  }, dom);
  assert.equal(recovered.length, 3);
  assert.equal(recovered[0].content_blocks[0].type, 'terminal');

  const equalLengthDomWithTool = [thinkingUser, thinkingTerminal];
  const reasoningRecovered = engine._maybeUseCodexDesktopArchive('thinking-fixture-session', {
    agentType: 'codex-desktop',
    _activeThreadKey: `local:${THINKING_THREAD_ID}`,
    _activeThreadTitle: 'mutable title with an otherwise rich DOM',
  }, equalLengthDomWithTool);
  assert.equal(reasoningRecovered.length, equalLengthDomWithTool.length,
    'reasoning richness recovery should not depend on archive message count');
  assert(reasoningRecovered[1].content_blocks.some(block => block.activity_summary === true),
    'exact archive must win when only the reasoning-summary block is missing from a tool-rich DOM');

  const largeSession = {
    agentType: 'codex-desktop',
    _activeThreadKey: `local:${LARGE_THREAD_ID}`,
    _activeThreadTitle: 'Large exact native transcript',
  };
  const largeRecovered = engine._maybeUseCodexDesktopArchive(
    'large-exact-fixture-session',
    largeSession,
    largeNativeArchive.slice(-2),
  );
  assert.equal(largeRecovered.length, largeNativeArchive.length,
    'an exact immutable Desktop archive must never be clipped to 2,000 rows');
  assert.equal(largeSession._codexDesktopArchiveAuthoritative, true);
  const firstCanonical = engine._reconcileCodexDesktopCanonicalTranscript(
    Array.from({ length: 56 }, (_, index) => ({ role: 'assistant', content: `legacy duplicate ${index}` })),
    largeRecovered,
    { authoritative: true },
  );
  assert.equal(firstCanonical.messages.length, largeNativeArchive.length);
  assert.equal(new Set(firstCanonical.messages.map(message => message.source_message_id)).size, largeNativeArchive.length);
  const repeatedCanonical = engine._reconcileCodexDesktopCanonicalTranscript(
    firstCanonical.messages,
    JSON.parse(JSON.stringify(largeRecovered)),
    { authoritative: true },
  );
  assert.equal(repeatedCanonical.changed, false,
    'an unchanged native archive poll must retain the canonical message array and row identities');
  assert.equal(repeatedCanonical.messages, firstCanonical.messages);

  const canonicalArchiveRows = largeNativeArchive.slice(-2);
  const matchingDomRows = canonicalArchiveRows.map((message, index) => ({
    role: message.role,
    content: message.content,
    native_turn_id: message.native_turn_id,
    native_source_id: `codex_desktop_dom:${message.native_turn_id}:${message.role}:${index + 1}`,
    source_message_id: `codex-desktop-dom:${message.native_turn_id}:${message.role}:${index + 1}`,
    sequence: message.sequence,
    ts: message.ts,
  }));
  let alternatingCanonical = engine._reconcileCodexDesktopCanonicalTranscript(
    [], canonicalArchiveRows, { authoritative: true },
  ).messages;
  const alternatingIdentity = alternatingCanonical.map(message => message.source_message_id);
  for (let replay = 0; replay < 1000; replay += 1) {
    const domReplay = engine._reconcileCodexDesktopCanonicalTranscript(
      alternatingCanonical, JSON.parse(JSON.stringify(matchingDomRows)), { authoritative: false },
    );
    assert.equal(domReplay.changed, false,
      `semantic DOM overlap ${replay + 1} must retain authoritative native row identity`);
    assert.equal(domReplay.messages, alternatingCanonical);
    const archiveReplay = engine._reconcileCodexDesktopCanonicalTranscript(
      alternatingCanonical, JSON.parse(JSON.stringify(canonicalArchiveRows)), { authoritative: true },
    );
    assert.equal(archiveReplay.changed, false,
      `authoritative archive replay ${replay + 1} must not replace canonical rows`);
    assert.equal(archiveReplay.messages, alternatingCanonical);
  }
  assert.deepEqual(
    alternatingCanonical.map(message => message.source_message_id),
    alternatingIdentity,
    '1,000 alternating DOM/archive observations must preserve the native identity sequence',
  );

  const vsCodeRecovered = engine._maybeUseCodexDesktopArchive('thinking-vscode-fixture-session', {
    agentType: 'codex',
    _codexVsCodeConversationId: THINKING_THREAD_ID,
    _activeChatTitle: 'Codex side pane fixture',
  }, equalLengthDomWithTool);
  assert(vsCodeRecovered[1].content_blocks.some(block => block.activity_summary === true),
    'Codex VS Code must enrich an exact conversation from the same authoritative JSONL contract');

  const provisionalPrompt = 'This is an owned disposable Remote Agent Chat production check with a unique marker.';
  let provisionalLookup = null;
  codexCli.findRecentSessionByUserAnchor = (anchor, options) => {
    provisionalLookup = options;
    provisionalLookup.anchor = anchor;
    return {
      cliSessionId: '019f5df8-ea2b-77f0-850f-3d5f55f79205',
      filePath: 'fresh-provisional.jsonl',
      updatedAt: '2026-07-13T23:59:00.000Z',
      messages: [
        { role: 'user', content: provisionalPrompt, content_blocks: [{ type: 'markdown', content: provisionalPrompt }] },
        shellCall,
        shellResult,
        fileChange,
      ],
    };
  };
  const provisionalDom = [
    { role: 'user', content: provisionalPrompt, content_blocks: [{ type: 'markdown', content: provisionalPrompt }] },
    { role: 'assistant', content: 'Created and verified the marker.', content_blocks: [{ type: 'markdown', content: 'Created and verified the marker.' }] },
  ];
  const provisional = engine._maybeUseCodexDesktopArchive('provisional-session', {
    agentType: 'codex-desktop',
    _activeThreadKey: 'local:client-new-thread:fcc40178-89a5-48a8-92f1-c83a67c96310',
    _activeThreadTitle: 'Create marker file',
    workspace_path: 'C:\\unrelated\\prior-workspace',
  }, provisionalDom);
  assert.equal(provisional[1].content_blocks[0].type, 'terminal');
  assert.equal(provisionalLookup.anchor, provisionalPrompt,
    'provisional recovery must use the full visible user anchor rather than the generated title');
  assert(provisionalLookup.sinceMs > 0, 'provisional recovery must be recent-time bounded');
  assert.equal(provisionalLookup.maxFiles, 40, 'provisional recovery must remain file-count bounded');

  codexCli.findLatestSessionForTitle = () => {
    throw new Error('ordinary non-collapsed presentation threads must still fail closed');
  };
  const untouched = engine._maybeUseCodexDesktopArchive('no-id-session', {
    agentType: 'codex-desktop',
    _activeThreadKey: 'presentation-only',
  }, dom);
  assert.equal(untouched, dom, 'non-collapsed DOM without an exact thread UUID must fail closed');
} finally {
  codexCli.findSessionByCliId = originalFind;
  codexCli.findLatestSessionForTitle = originalTitleFind;
  codexCli.findRecentSessionByUserAnchor = originalAnchorFind;
}

console.log('Codex Desktop exact-archive structured recovery smoke passed');
