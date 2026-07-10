'use strict';

/**
 * End-to-end control/fidelity checks for Cursor CLI without the full proxy process.
 * Covers: create-chat, new-session-id, resume, interrupt, model/permission args,
 * parser fidelity for thinking + shell tools, and discover.
 */

const fs = require('fs');
const crypto = require('crypto');
const cursorCli = require('../agent-proxy/cursor-cli');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function runExec(opts) {
  const events = [];
  return new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      ...opts,
      onEvent: (ev) => {
        events.push(ev);
        if (opts.onEvent) opts.onEvent(ev);
      },
      onExit: (code, err) => {
        if (err) reject(Object.assign(err, { events, code }));
        else if (code !== 0 && !opts.allowNonZero) reject(Object.assign(new Error('exit ' + code), { events, code }));
        else resolve({ code, events, child });
      },
    });
    if (!child) reject(new Error('spawn returned null'));
    const timeoutMs = opts.timeoutMs || 120000;
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(Object.assign(new Error('timeout'), { events }));
    }, timeoutMs);
    child.on('close', () => clearTimeout(timer));
  });
}

(async () => {
  const workspacePath = 'c:\\temp\\cursor-test';
  fs.mkdirSync(workspacePath, { recursive: true });

  console.log('--- resolve + models ---');
  const resolved = cursorCli.resolveCursorCommand();
  assert(resolved, 'Cursor CLI binary missing');
  const models = await cursorCli.listModels();
  assert(models.length > 3, 'too few models');
  console.log('PASS resolve/models', { bin: resolved.command, models: models.length });

  console.log('--- create-chat + resume first send ---');
  const chatId = await cursorCli.createChatId();
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId), 'bad create-chat id');
  const filePath = cursorCli.ensureSessionFile(chatId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'E2E create-chat',
  });
  // Empty meta-only file: messageCount should be 0 (resume decision must use chatCreated flag)
  const emptySummary = cursorCli.readSessionSummary(filePath);
  assert((emptySummary?.messageCount || 0) === 0, 'expected empty transcript before first send');

  const first = await runExec({
    workspacePath,
    cliSessionId: chatId,
    resume: true, // create-chat IDs must resume
    content: 'Reply with exactly: CURSOR_CLI_E2E_CREATE_OK',
    model: 'grok-4.5-fast-high',
    permissionMode: 'force',
  });
  assert(first.events.some(e => e.type === 'result'), 'create-chat send missing result');
  assert(first.events.some(e => e.session_id === chatId || (e.type === 'result' && e.session_id === chatId)), 'session_id mismatch on create-chat send');
  const afterFirst = cursorCli.readSessionSummary(filePath);
  assert(afterFirst.messageCount >= 2, 'expected user+assistant after first send');
  console.log('PASS create-chat resume', { messageCount: afterFirst.messageCount, session_id: chatId });

  console.log('--- second resume append ---');
  const beforeSize = fs.statSync(filePath).size;
  const second = await runExec({
    workspacePath,
    cliSessionId: chatId,
    resume: true,
    content: 'Reply with exactly: CURSOR_CLI_E2E_RESUME_OK',
    model: 'grok-4.5-fast-high',
    permissionMode: 'force',
  });
  assert(second.events.some(e => e.type === 'result'), 'resume missing result');
  assert(fs.statSync(filePath).size > beforeSize, 'resume did not grow transcript');
  const afterSecond = cursorCli.readSessionSummary(filePath);
  assert(afterSecond.messages.filter(m => m.role === 'user').length >= 2, 'expected 2+ user turns');
  console.log('PASS resume append', { users: afterSecond.messages.filter(m => m.role === 'user').length });

  console.log('--- new-session-id first send (local uuid) ---');
  const localId = crypto.randomUUID();
  const localFile = cursorCli.ensureSessionFile(localId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'E2E new-session-id',
  });
  const local = await runExec({
    workspacePath,
    cliSessionId: localId,
    resume: false,
    content: 'Reply with exactly: CURSOR_CLI_E2E_NEWSID_OK',
    model: 'grok-4.5-fast-high',
    permissionMode: 'force',
  });
  assert(local.events.some(e => e.type === 'result' && e.session_id === localId), 'new-session-id result session mismatch');
  const localSummary = cursorCli.readSessionSummary(localFile);
  assert(localSummary.messages.some(m => m.role === 'assistant'), 'new-session-id missing assistant');
  console.log('PASS new-session-id', { messageCount: localSummary.messageCount });

  console.log('--- interrupt mid-run ---');
  let interrupted = false;
  await new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: crypto.randomUUID(),
      resume: false,
      content: 'Write a long poem of at least 40 lines about debugging, then stop.',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onEvent: () => {},
      onExit: (code) => {
        interrupted = true;
        resolve({ code });
      },
    });
    if (!child) return reject(new Error('interrupt spawn null'));
    setTimeout(() => {
      try { child.kill(); } catch (e) { reject(e); }
    }, 2500);
    setTimeout(() => reject(new Error('interrupt timeout')), 30000);
  });
  assert(interrupted, 'interrupt did not exit');
  console.log('PASS interrupt');

  console.log('--- tool + thinking fidelity ---');
  const toolChat = await cursorCli.createChatId();
  const toolFile = cursorCli.ensureSessionFile(toolChat, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'E2E tools',
  });
  const tool = await runExec({
    workspacePath,
    cliSessionId: toolChat,
    resume: true,
    content: 'Run the shell command exactly: echo CURSOR_CLI_E2E_TOOL_OK. Then reply with one short sentence.',
    model: 'grok-4.5-fast-high',
    permissionMode: 'force',
  });
  assert(tool.events.some(e => e.type === 'tool_call'), 'missing tool_call events');
  const toolSummary = cursorCli.readSessionSummary(toolFile);
  const blocks = toolSummary.messages.flatMap(m => m.content_blocks || []);
  const terminal = blocks.find(b => b.type === 'terminal' || b.type === 'tool_call');
  assert(terminal, 'missing parsed terminal/tool block');
  const blob = JSON.stringify(toolSummary.messages);
  assert(/CURSOR_CLI_E2E_TOOL_OK/.test(blob), 'tool stdout missing from transcript');
  console.log('PASS tool fidelity', {
    blockTypes: blocks.map(b => b.type),
    terminalCommand: terminal.command || terminal.title || null,
  });

  console.log('--- discover ---');
  await sleep(200);
  const discovered = cursorCli.discoverSessions(50);
  assert(discovered.some(s => s.cliSessionId === chatId), 'discover missing create-chat session');
  assert(discovered.some(s => s.cliSessionId === localId), 'discover missing new-session-id session');
  console.log('PASS discover', discovered.length);

  console.log('--- permission mode arg mapping (plan) ---');
  // Plan mode is read-only; ask a question that needs no tools.
  const plan = await runExec({
    workspacePath,
    cliSessionId: crypto.randomUUID(),
    resume: false,
    content: 'Reply with exactly: CURSOR_CLI_E2E_PLAN_OK',
    model: 'grok-4.5-fast-high',
    permissionMode: 'plan',
  });
  assert(plan.events.some(e => e.type === 'result'), 'plan mode missing result');
  console.log('PASS plan mode');

  console.log('ALL E2E CONTROLS PASS');
})().catch((e) => {
  console.error('FAIL', e && e.stack || e);
  if (e && e.events) {
    console.error('events', e.events.map(ev => ev.type + (ev.subtype ? '/' + ev.subtype : '')).join(' > '));
  }
  process.exit(1);
});
