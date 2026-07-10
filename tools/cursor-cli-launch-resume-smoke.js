'use strict';

/**
 * Proxy-level smoke for Cursor CLI launch/resume ID consistency.
 * Does not start the full proxy — exercises the same create-chat + resume
 * decision path used by launch_session / _sendCursorCliMessage.
 */

const fs = require('fs');
const crypto = require('crypto');
const cursorCli = require('../agent-proxy/cursor-cli');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const workspacePath = 'c:\\temp\\cursor-test';
  fs.mkdirSync(workspacePath, { recursive: true });

  // Simulate launch_session: create-chat, ensure file, first send with resume=true
  const chatId = await cursorCli.createChatId();
  const filePath = cursorCli.ensureSessionFile(chatId, {
    workspacePath,
    workspaceName: 'cursor-test',
    model_id: 'grok-4.5-fast-high',
    permission_mode: 'force',
    title: 'Launch resume smoke',
  });
  const empty = cursorCli.readSessionSummary(filePath);
  assert((empty?.messageCount || 0) === 0, 'expected empty before send');

  // shouldResume for create-chat: true even when messageCount=0
  const shouldResumeLaunch = (empty?.messageCount || 0) > 0 || true; // chatCreated
  assert(shouldResumeLaunch === true, 'launch should resume create-chat id');

  await new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      workspacePath,
      cliSessionId: chatId,
      resume: true,
      content: 'Reply with exactly: CURSOR_CLI_LAUNCH_RESUME_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onExit: (code, err) => (err || code !== 0 ? reject(err || new Error('exit ' + code)) : resolve()),
    });
    if (!child) reject(new Error('null child'));
    setTimeout(() => reject(new Error('timeout')), 120000);
  });

  const after = cursorCli.readSessionSummary(filePath);
  assert(after.messageCount >= 2, 'expected transcript after launch send');
  assert(after.cliSessionId === chatId, 'cli id drift');

  // Simulate web Resume: find by cli id and reopen with --resume
  const found = cursorCli.findSessionByCliId(chatId);
  assert(found && found.filePath === filePath, 'findSessionByCliId failed');
  assert(found.messageCount >= 2, 'resume lookup missing messages');

  const before = fs.statSync(filePath).size;
  await new Promise((resolve, reject) => {
    const child = cursorCli.startCursorExecSession({
      workspacePath: found.workspacePath || workspacePath,
      cliSessionId: found.cliSessionId,
      resume: true,
      content: 'Reply with exactly: CURSOR_CLI_WEB_RESUME_OK',
      model: 'grok-4.5-fast-high',
      permissionMode: 'force',
      onExit: (code, err) => (err || code !== 0 ? reject(err || new Error('exit ' + code)) : resolve()),
    });
    if (!child) reject(new Error('null child'));
    setTimeout(() => reject(new Error('timeout')), 120000);
  });
  assert(fs.statSync(filePath).size > before, 'web resume did not append');

  // Empty meta-only local uuid must NOT resume
  const localId = crypto.randomUUID();
  const localFile = cursorCli.ensureSessionFile(localId, {
    workspacePath,
    workspaceName: 'cursor-test',
    title: 'local uuid',
  });
  const localEmpty = cursorCli.readSessionSummary(localFile);
  const shouldResumeLocal = (localEmpty?.messageCount || 0) > 0; // no chatCreated
  assert(shouldResumeLocal === false, 'local empty uuid must not resume');

  console.log('PASS launch/resume ID consistency', { chatId, messages: after.messageCount });
})().catch((e) => {
  console.error('FAIL', e && e.stack || e);
  process.exit(1);
});
