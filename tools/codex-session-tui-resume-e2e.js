#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pty = require('../agent-proxy/node_modules/node-pty');
const {
  codexHome,
  findRolloutPath,
} = require('./codex-session-manifest');
const {
  resolveCodexCommand,
} = require('./codex-session-launch');
const {
  parseThreadId,
  runCodexProcess,
} = require('./codex-session-rotator');

const ROOT = path.resolve(__dirname, '..');
const EXEC_TOKEN = 'CODEX_ROTATOR_EXEC_CREATED';
const TUI_TOKEN = 'CODEX_ROTATOR_TUI_RESUMED';

function tailText(filePath, maxBytes = 4 * 1024 * 1024) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(handle, buffer, 0, length, size - length);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function waitForRolloutToken(filePath, token, terminal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let terminalOutput = '';
    let settled = false;
    const dataSubscription = terminal.onData(chunk => {
      terminalOutput = `${terminalOutput}${chunk}`.slice(-200_000);
    });
    const exitSubscription = terminal.onExit(event => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      dataSubscription.dispose();
      reject(new Error(`Codex TUI exited before emitting ${token}: code=${event.exitCode}; output=${terminalOutput.slice(-4000)}`));
    });
    const timer = setInterval(() => {
      if (settled) return;
      try {
        if (tailText(filePath).includes(token)) {
          settled = true;
          clearInterval(timer);
          dataSubscription.dispose();
          exitSubscription.dispose();
          resolve({ terminalOutput });
          return;
        }
      } catch {}
      if (Date.now() - started >= timeoutMs) {
        settled = true;
        clearInterval(timer);
        dataSubscription.dispose();
        exitSubscription.dispose();
        reject(new Error(`Timed out waiting for ${token}; terminal output=${terminalOutput.slice(-4000)}`));
      }
    }, 500);
  });
}

function stopTerminalGracefully(terminal, timeoutMs = 10_000) {
  return new Promise(resolve => {
    let settled = false;
    let secondInterrupt = null;
    let hardStop = null;
    const finish = graceful => {
      if (settled) return;
      settled = true;
      clearTimeout(secondInterrupt);
      clearTimeout(hardStop);
      exitSubscription.dispose();
      if (!graceful) {
        try { terminal.kill(); } catch {}
      }
      resolve(graceful);
    };
    const exitSubscription = terminal.onExit(() => finish(true));
    secondInterrupt = setTimeout(() => {
      try { terminal.write('\x03'); } catch {}
    }, 1500);
    hardStop = setTimeout(() => finish(false), timeoutMs);
    terminal.write('\x03');
  });
}

async function main() {
  const entry = {
    cwd: ROOT,
    codexGlobalArgs: [],
    environment: {},
    ensureOllama: false,
  };
  let sessionId = null;
  let terminal = null;
  let archived = false;
  let deleted = false;
  try {
    const created = await runCodexProcess(entry, [
      'exec', '--json', '--skip-git-repo-check', '-C', ROOT,
      `Reply with exactly ${EXEC_TOKEN} and do not use tools.`,
    ], 180_000);
    sessionId = parseThreadId(created.stdout);
    if (!sessionId) throw new Error('Disposable exec did not emit thread.started');
    if (!created.stdout.includes(EXEC_TOKEN)) throw new Error(`Disposable exec did not return ${EXEC_TOKEN}`);
    const rolloutPath = findRolloutPath(sessionId);
    if (!rolloutPath) throw new Error(`Disposable rollout not found for ${sessionId}`);

    const resolved = resolveCodexCommand();
    terminal = pty.spawn(resolved.command, [
      ...resolved.argsPrefix,
      'resume',
      sessionId,
      `Reply with exactly ${TUI_TOKEN} and do not use tools.`,
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: ROOT,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: true,
    });
    await waitForRolloutToken(rolloutPath, TUI_TOKEN, terminal, 180_000);
    const gracefulTuiExit = await stopTerminalGracefully(terminal);
    terminal = null;
    await new Promise(resolve => setTimeout(resolve, 1000));

    await runCodexProcess(entry, ['archive', sessionId], 60_000);
    archived = true;
    await runCodexProcess(entry, ['delete', '--force', sessionId], 60_000);
    deleted = true;
    const remaining = findRolloutPath(sessionId, codexHome(), { includeArchived: true });
    if (remaining) throw new Error(`Disposable session survived cleanup at ${remaining}`);

    process.stdout.write(`${JSON.stringify({
      status: 'pass',
      session_id: sessionId,
      exec_created_token: EXEC_TOKEN,
      tui_resume_token: TUI_TOKEN,
      transport: 'headless node-pty ConPTY',
      visible_windows_opened: 0,
      graceful_tui_exit: gracefulTuiExit,
      archived,
      deleted,
    }, null, 2)}\n`);
  } finally {
    if (terminal) {
      try { terminal.kill(); } catch {}
    }
    if (sessionId && !deleted) {
      try {
        if (!archived) await runCodexProcess(entry, ['archive', sessionId], 60_000);
      } catch {}
      try { await runCodexProcess(entry, ['delete', '--force', sessionId], 60_000); } catch {}
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
