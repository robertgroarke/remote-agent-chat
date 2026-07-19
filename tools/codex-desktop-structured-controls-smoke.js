#!/usr/bin/env node
'use strict';

const assert = require('assert');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const selectors = require('../agent-proxy/selectors');
const codexCli = require('../agent-proxy/codex-cli');
const {
  codexDesktopCliSessionId,
  codexDesktopArchiveMessages,
  codexDesktopStructuredBlockCounts,
} = require('../agent-proxy/codex-desktop-archive');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');
const { listCdpTargets, connectCdpTarget } = require('../agent-proxy/cdp-loopback');

const PORT = Number(process.env.CODEX_DESKTOP_CDP_PORT || 9225);
const TIMEOUT_MS = Number(process.env.CODEX_DESKTOP_STRUCTURED_TIMEOUT_MS || 30000);

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  const targets = await withTimeout(listCdpTargets(CDP, { port: PORT }), 'Codex Desktop target list');
  const target = targets.find(item => item.type === 'page' && item.url === 'app://-/index.html');
  assert(target, `Codex Desktop app target not found on port ${PORT}`);
  const client = await withTimeout(connectCdpTarget(CDP, {
    port: PORT,
    host: target._cdpHost,
    target: target.id,
  }), 'Codex Desktop attach');

  try {
    await client.Runtime.enable();
    const initialThreads = await withTimeout(
      selectors.readCodexThreadList(client.Runtime, true),
      'initial native thread list',
    );
    const originalThread = initialThreads.find(thread => thread && thread.active) || null;
    const originalThreadId = String(originalThread?.id || '');
    assert(originalThreadId, 'current native thread was not detected');

    // The currently selected thread may intentionally contain no commands or
    // edits. Choose a listed thread whose exact local archive has both
    // structures, but never switch the native UI: aggregate validation must
    // remain a passive read of the operator's current selection.
    const orderedThreads = [
      originalThread,
      ...initialThreads.filter(thread => thread && thread.id !== originalThreadId),
    ];
    let validationThread = null;
    let validationArchive = null;
    for (const thread of orderedThreads) {
      const cliSessionId = codexDesktopCliSessionId(thread?.id);
      if (!cliSessionId) continue;
      const archive = codexCli.findSessionByCliId(cliSessionId);
      const normalized = codexDesktopArchiveMessages(archive?.messages);
      const counts = codexDesktopStructuredBlockCounts(normalized);
      if (Number(counts.terminal || 0) > 0 && Number(counts.file_changes || 0) > 0) {
        validationThread = thread;
        validationArchive = archive;
        break;
      }
    }
    assert(validationThread && validationArchive,
      'no listed Codex Desktop thread has an exact archive with terminal and file-change blocks');
    const validationThreadId = String(validationThread.id || '');

    const messageRaw = await withTimeout(
      selectors.readMessages(
        client.Runtime,
        'codex-desktop',
        'structured-control-smoke',
        { maxRecentTurns: 24, maxRecentUnits: 96 },
      ),
      'bounded native structured messages',
    );
    const recentMessages = JSON.parse(messageRaw || '[]');
    const nativeThreads = await withTimeout(
      selectors.readCodexThreadList(client.Runtime, true),
      'current native thread list',
    );
    const nativeActiveThread = nativeThreads.find(thread => thread && thread.active) || null;
    const nativeActiveThreadKey = String(nativeActiveThread?.id || '');
    assert.equal(nativeActiveThreadKey, originalThreadId,
      'passive structured validation changed the native active thread');
    const engine = Object.create(ProxyEngine.prototype);
    engine._log = () => {};
    const messages = engine._maybeUseCodexDesktopArchive(
      'structured-control-smoke',
      {
        agentType: 'codex-desktop',
        _activeThreadKey: validationThreadId,
        _activeThreadTitle: validationThread?.title || '',
      },
      [],
    );
    const nativeTerminalBlocks = [];
    const nativeChangeBlocks = [];
    for (const message of messages) {
      for (const block of (message.content_blocks || [])) {
        if (block.type === 'terminal') nativeTerminalBlocks.push(block);
        if (block.type === 'file_changes') nativeChangeBlocks.push(block);
      }
    }
    assert(nativeTerminalBlocks.length > 0, 'live native transcript has no terminal blocks to validate');
    assert(nativeChangeBlocks.length > 0, 'live native transcript has no file-change blocks to validate');

    const recentTerminalEntries = selectors.codexTerminalEntriesFromMessages(recentMessages);
    const recentChangeEntries = selectors.codexFileChangeEntriesFromMessages(recentMessages);
    assert(Array.isArray(recentTerminalEntries), 'bounded live terminal extraction must return an array');
    assert(Array.isArray(recentChangeEntries), 'bounded live file-change extraction must return an array');
    assert(recentTerminalEntries.every(entry => entry.collapsed === false),
      'bounded live terminal entries must remain expanded');
    assert(recentTerminalEntries.every(entry => typeof entry.output === 'string'),
      'bounded live terminal output must remain string-preserved');
    assert(recentChangeEntries.every(entry => entry.can_accept === false && entry.can_reject === false),
      'bounded live file-change actions must remain inactive');
    assert(recentChangeEntries.every(entry => typeof entry.content === 'string'),
      'bounded live file-change content must remain string-preserved');

    const runtimeSession = { _accumulatedMessages: messages };
    const terminalEntries = engine._codexDesktopTerminalEntries(runtimeSession);
    assert.equal(terminalEntries.length, nativeTerminalBlocks.length,
      'terminal viewer must preserve every native terminal block');
    for (let i = 0; i < terminalEntries.length; i++) {
      assert.equal(terminalEntries[i].command, nativeTerminalBlocks[i].command || nativeTerminalBlocks[i].label || null);
      assert.equal(terminalEntries[i].output, String(nativeTerminalBlocks[i].stdout ?? ''));
      assert.equal(terminalEntries[i].status, nativeTerminalBlocks[i].status || null);
      assert.equal(terminalEntries[i].exit_code, nativeTerminalBlocks[i].exit_code ?? null);
      assert.equal(terminalEntries[i].collapsed, false);
    }

    const changeEntries = engine._codexDesktopFileChangeEntries(runtimeSession);
    assert.equal(changeEntries.length, nativeChangeBlocks.length,
      'file-change viewer must preserve every native file-change block');
    for (let i = 0; i < changeEntries.length; i++) {
      const native = nativeChangeBlocks[i];
      assert.equal(changeEntries[i].summary, native.summary || null);
      assert.equal(changeEntries[i].content, String(native.content ?? ''));
      assert.deepEqual(changeEntries[i].files, native.files || []);
      assert.equal(changeEntries[i].files_changed, native.files_changed ?? (native.files || []).length);
      assert.equal(changeEntries[i].can_accept, false, 'unsupported native actions must not become active controls');
      assert.equal(changeEntries[i].can_reject, false, 'unsupported native actions must not become active controls');
    }

    const xtermResult = await client.Runtime.evaluate({
      expression: `document.querySelectorAll('.xterm-helper-textarea, [data-codex-terminal] textarea').length`,
      returnByValue: true,
    });
    assert.equal(Number(xtermResult.result?.value || 0), 0,
      'live Codex Desktop unexpectedly exposes a terminal-input surface; revisit capability gating');

    const capabilities = ProxyEngine.prototype._buildCapabilities.call({}, 'codex-desktop');
    assert.equal(capabilities.terminal_output, true);
    assert.equal(capabilities.file_changes, true);
    assert.equal(capabilities.terminal_input, false,
      'Codex Desktop terminal input must stay gated without a native target');

    const historyScope = validationArchive.messagesPartial
      ? 'bounded exact-thread native JSONL tail'
      : 'complete exact-thread native JSONL archive';
    console.log(
      `Codex Desktop structured controls smoke: PASS ` +
      `(${terminalEntries.length} terminal, ${changeEntries.length} file-change blocks from ${historyScope}; ` +
      `${recentTerminalEntries.length}/${recentChangeEntries.length} in current bounded window)`,
    );
  } finally {
    await client.close();
  }
}

withCodexDesktopCdpLock('codex-desktop-structured-controls', main, { waitMs: 90000 }).catch(error => {
  console.error(`Codex Desktop structured controls smoke: FAIL (${error.message})`);
  process.exit(1);
});
