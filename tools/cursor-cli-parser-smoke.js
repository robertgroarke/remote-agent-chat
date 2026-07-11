'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const cursorCli = require('../agent-proxy/cursor-cli');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function writeFixture(events) {
  const sid = crypto.randomUUID();
  const filePath = cursorCli.ensureSessionFile(sid, {
    workspacePath: 'c:\\temp\\cursor-test',
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'Fixture',
  });
  for (const ev of events) {
    cursorCli.appendStreamEvent(filePath, { ...ev, session_id: sid });
  }
  return { sid, filePath, summary: cursorCli.readSessionSummary(filePath) };
}

(async () => {
  const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
  assert(
    /activity: interrupted[\s\S]*\(summary\.activity \|\| sessionMeta\.activity \|\| \{ kind: 'idle', label: '', updated_at: now \}\)/.test(proxySource),
    'Cursor CLI discovery must preserve interrupted idle and otherwise treat a completed summary as authoritative idle',
  );
  assert(
    (proxySource.match(/_setCursorCliActivity\(sessionId, existing, summary\.activity\);/g) || []).length >= 2,
    'Cursor CLI re-registration must clear stale stored activity',
  );
  assert(
    /sessionStore\.updateSession\(sessionId, \{ activity: session\.activity \}\);/.test(proxySource),
    'new Cursor CLI discovery must persist its authoritative activity',
  );
  assert(
    /cursor_cli_model_configured: true/.test(proxySource)
      && /cursor_cli_permission_configured: true/.test(proxySource),
    'Cursor CLI configuration controls must persist explicit model and permission choices',
  );
  assert(
    /session\.cursorCliModelConfigured !== true && summary\.model_id/.test(proxySource)
      && /session\.cursorCliPermissionConfigured !== true && summary\.permission_mode/.test(proxySource),
    'Cursor CLI discovery must not overwrite explicit configuration with archived metadata',
  );

  console.log('--- parser fixture ---');
  const fixture = writeFixture([
    { type: 'system', subtype: 'init', cwd: 'c:\\temp\\cursor-test', model: 'Cursor Grok 4.5 Medium Fast', permissionMode: 'default' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Run echo hello and summarize' }] } },
    { type: 'thinking', subtype: 'delta', text: 'I will run echo.' },
    { type: 'thinking', subtype: 'completed' },
    {
      type: 'tool_call',
      subtype: 'started',
      call_id: 'c1',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo hello', description: 'Echo hello' },
          description: 'Echo hello',
        },
      },
    },
    {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'c1',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo hello', description: 'Echo hello' },
          result: { success: { command: 'echo hello', exitCode: 0, stdout: 'hello\r\n', stderr: '', interleavedOutput: 'hello\r\n' } },
          description: 'Echo hello',
        },
      },
    },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }, timestamp_ms: 1 },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'result', subtype: 'success', result: 'Done.' },
  ]);

  assert(fixture.summary.messageCount >= 3, 'fixture messageCount too low: ' + fixture.summary.messageCount);
  const roles = fixture.summary.messages.map((m) => m.role);
  assert(roles.includes('user'), 'fixture missing user');
  assert(roles.includes('assistant'), 'fixture missing assistant');
  const terminalBlock = fixture.summary.messages
    .flatMap((m) => m.content_blocks || [])
    .find((b) => b.type === 'terminal');
  assert(terminalBlock, 'missing terminal block');
  assert(terminalBlock.command === 'echo hello', 'bad terminal.command: ' + terminalBlock.command);
  assert(String(terminalBlock.stdout || '').includes('hello'), 'bad terminal.stdout: ' + terminalBlock.stdout);
  assert(terminalBlock.exit_code === 0, 'bad exit_code: ' + terminalBlock.exit_code);
  const collapsibleBlocks = fixture.summary.messages
    .flatMap((m) => m.content_blocks || [])
    .filter((b) => b.type === 'thinking' || b.type === 'terminal' || b.type === 'tool_call' || b.type === 'file_changes');
  assert(collapsibleBlocks.length >= 2, 'expected thinking and tool blocks in fixture');
  assert(collapsibleBlocks.every((b) => b.collapsed === false), 'Cursor CLI transcript blocks must expand by default');
  console.log('PASS parser fixture', {
    messageCount: fixture.summary.messageCount,
    terminal: terminalBlock,
    title: fixture.summary.title,
  });

  console.log('--- live send/resume ---');
  const resolved = cursorCli.resolveCursorCommand();
  assert(resolved, 'binary missing');
  const workspacePath = 'c:\\temp\\cursor-test';
  fs.mkdirSync(workspacePath, { recursive: true });

  const chatId = await cursorCli.createChatId();
  assert(/^[0-9a-f-]{36}$/i.test(chatId), 'bad chat id ' + chatId);
  const filePath = cursorCli.ensureSessionFile(chatId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'Cursor CLI smoke',
  });

  const events = [];
  await new Promise((resolve, reject) => {
    let timer;
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: chatId,
      resume: true,
      content: 'Reply with exactly: CURSOR_CLI_SMOKE_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onEvent: (ev) => events.push(ev),
      onExit: (code, err) => {
        clearTimeout(timer);
        if (err || code !== 0) reject(err || new Error('exit ' + code));
        else resolve();
      },
    });
    if (!child) return reject(new Error('null child'));
    timer = setTimeout(() => reject(new Error('timeout')), 120000);
  });
  assert(events.some((e) => e.type === 'result'), 'no result');
  assert(events.some((e) => e.type === 'assistant'), 'no assistant');
  const liveSummary = cursorCli.readSessionSummary(filePath);
  assert(liveSummary.messages.some((m) => m.role === 'user'), 'no user in summary');
  assert(liveSummary.messages.some((m) => m.role === 'assistant'), 'no assistant in summary');
  console.log('PASS live send', {
    events: events.map((e) => e.type + (e.subtype ? '/' + e.subtype : '')),
    messageCount: liveSummary.messageCount,
    title: liveSummary.title,
  });

  const before = fs.statSync(filePath).size;
  await new Promise((resolve, reject) => {
    let timer;
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: chatId,
      resume: true,
      content: 'Reply with exactly: CURSOR_CLI_SMOKE_RESUME_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onExit: (code, err) => {
        clearTimeout(timer);
        if (err || code !== 0) reject(err || new Error('exit ' + code));
        else resolve();
      },
    });
    if (!child) return reject(new Error('null child'));
    timer = setTimeout(() => reject(new Error('timeout')), 120000);
  });
  const after = cursorCli.readSessionSummary(filePath);
  assert(fs.statSync(filePath).size > before, 'resume did not grow file');
  assert(after.messages.filter((m) => m.role === 'user').length >= 2, 'expected 2+ user messages');
  console.log('PASS resume', { messageCount: after.messageCount, users: after.messages.filter((m) => m.role === 'user').length });

  console.log('--- live tool fidelity ---');
  const toolEvents = [];
  const toolChatId = await cursorCli.createChatId();
  const toolFile = cursorCli.ensureSessionFile(toolChatId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'Cursor CLI tool smoke',
  });
  await new Promise((resolve, reject) => {
    let timer;
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: toolChatId,
      resume: true,
      content: process.platform === 'win32'
        ? 'Run the shell command exactly: powershell -NoProfile -Command "Start-Sleep -Milliseconds 10; Write-Output CURSOR_CLI_TOOL_OK"'
        : 'Run the shell command exactly: printf CURSOR_CLI_TOOL_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onEvent: (ev) => toolEvents.push(ev),
      onExit: (code, err) => {
        clearTimeout(timer);
        if (err || code !== 0) reject(err || new Error('exit ' + code));
        else resolve();
      },
    });
    if (!child) return reject(new Error('null child'));
    timer = setTimeout(() => reject(new Error('timeout')), 120000);
  });
  const toolSummary = cursorCli.readSessionSummary(toolFile);
  const toolBlock = toolSummary.messages.flatMap((m) => m.content_blocks || []).find((b) => b.type === 'terminal' || b.type === 'tool_call');
  assert(toolEvents.some((e) => e.type === 'tool_call'), 'live tool_call event missing');
  assert(toolBlock, 'parsed tool/terminal block missing');
  if (toolBlock.type === 'terminal') {
    assert(String(toolBlock.command || '').includes('echo') || String(toolBlock.title || '').length > 0, 'terminal command/title empty');
  }
  const joined = toolSummary.messages.map((m) => [m.content, ...(m.content_blocks || []).map((b) => [b.content, b.stdout, b.command].join(' '))].join(' ')).join('\n');
  assert(/CURSOR_CLI_TOOL_OK/.test(joined), 'tool output missing from transcript');
  console.log('PASS tool fidelity', {
    toolBlock,
    blockTypes: toolSummary.messages.flatMap((m) => (m.content_blocks || []).map((b) => b.type)),
  });

  const discovered = cursorCli.discoverSessions(50);
  assert(discovered.some((s) => s.cliSessionId === chatId), 'discover missing session');
  console.log('PASS discover', discovered.length);
  console.log('ALL PASS');
})().catch((e) => {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});
