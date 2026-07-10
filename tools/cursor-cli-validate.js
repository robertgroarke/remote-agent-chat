'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cursorCli = require('../agent-proxy/cursor-cli');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const resolved = cursorCli.resolveCursorCommand();
  assert(resolved, 'Cursor CLI binary not found');
  console.log('PASS resolveCursorCommand', resolved.command, resolved.argsPrefix.slice(-1)[0]);

  const models = await cursorCli.listModels();
  assert(Array.isArray(models) && models.length > 5, 'listModels returned too few');
  console.log('PASS listModels', models.length, 'first=', models[0].id);

  const workspacePath = 'c:\\temp\\cursor-test';
  fs.mkdirSync(workspacePath, { recursive: true });

  const chatId = crypto.randomUUID();
  const filePath = cursorCli.ensureSessionFile(chatId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'Cursor CLI validate',
  });
  assert(fs.existsSync(filePath), 'ensureSessionFile missing file');
  console.log('PASS ensureSessionFile', filePath);

  const events = [];
  await new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: chatId,
      resume: false,
      content: 'Reply with exactly: CURSOR_CLI_VALIDATE_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onEvent: (ev) => events.push(ev),
      onExit: (code, err) => {
        if (err) reject(err);
        else if (code !== 0) reject(new Error('exit ' + code + ' events=' + events.map((e) => e.type).join(',')));
        else resolve();
      },
    });
    if (!child) reject(new Error('spawn returned null'));
    setTimeout(() => reject(new Error('timeout waiting for cursor cli')), 120000);
  });

  const types = events.map((e) => e.type + (e.subtype ? '/' + e.subtype : ''));
  console.log('PASS live send events', types.join(' > '));
  assert(events.some((e) => e.type === 'result'), 'missing result event');
  assert(events.some((e) => e.type === 'assistant'), 'missing assistant event');
  assert(events.some((e) => e.type === 'user'), 'missing user event');

  const summary = cursorCli.readSessionSummary(filePath);
  assert(summary, 'readSessionSummary failed');
  assert(summary.cliSessionId === chatId, 'cliSessionId mismatch: ' + summary.cliSessionId);
  assert(summary.messages.some((m) => m.role === 'user'), 'missing user msg');
  assert(summary.messages.some((m) => m.role === 'assistant'), 'missing assistant msg');
  console.log('PASS summary', {
    messageCount: summary.messageCount,
    title: summary.title,
    roles: summary.messages.map((m) => ({
      role: m.role,
      blocks: (m.content_blocks || []).map((b) => b.type),
      content: String(m.content || '').slice(0, 80),
    })),
    activity: summary.activity,
  });

  const found = cursorCli.findSessionByCliId(chatId);
  assert(found && found.filePath === filePath, 'findSessionByCliId failed');
  console.log('PASS findSessionByCliId');

  const discovered = cursorCli.discoverSessions(20);
  assert(discovered.some((s) => s.cliSessionId === chatId), 'discoverSessions missing new session');
  console.log('PASS discoverSessions', discovered.length);

  const beforeSize = fs.statSync(filePath).size;
  await new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: chatId,
      resume: true,
      content: 'Reply with exactly: CURSOR_CLI_RESUME_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onExit: (code, err) => (err || code !== 0 ? reject(err || new Error('exit ' + code)) : resolve()),
    });
    if (!child) reject(new Error('resume spawn null'));
    setTimeout(() => reject(new Error('resume timeout')), 120000);
  });
  const afterSize = fs.statSync(filePath).size;
  assert(afterSize > beforeSize, 'resume did not append');
  const after = cursorCli.readSessionSummary(filePath);
  assert(after.messages.filter((m) => m.role === 'user').length >= 2, 'expected >=2 user msgs after resume');
  console.log('PASS resume append', { beforeSize, afterSize, messageCount: after.messageCount });
  console.log('ALL PASS');
})().catch((e) => {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
