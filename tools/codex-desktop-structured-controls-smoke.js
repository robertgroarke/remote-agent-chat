#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const selectors = require('../agent-proxy/selectors');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');

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
  const targets = await withTimeout(CDP.List({ port: PORT }), 'Codex Desktop target list');
  const target = targets.find(item => item.type === 'page' && item.url === 'app://-/index.html');
  assert(target, `Codex Desktop app target not found on port ${PORT}`);
  const client = await withTimeout(CDP({ port: PORT, target: target.id }), 'Codex Desktop attach');

  try {
    await client.Runtime.enable();
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
    const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const storedSession = Object.values(store.sessions || {})
      .filter(session => session.agent_type === 'codex-desktop' && Array.isArray(session.accumulated_messages))
      .sort((left, right) => String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || '')))[0];
    assert(storedSession, 'durable Codex Desktop accumulator not found');
    const messages = storedSession.accumulated_messages;
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
    const engine = Object.create(ProxyEngine.prototype);
    assert.equal(engine._codexDesktopRestoreWindowMatches(messages, recentMessages), true,
      'bounded live window must overlap the durable same-thread accumulator');

    const recentTerminalEntries = selectors.codexTerminalEntriesFromMessages(recentMessages);
    const recentChangeEntries = selectors.codexFileChangeEntriesFromMessages(recentMessages);
    assert(recentTerminalEntries.length > 0, 'bounded live transcript has no terminal blocks to validate');
    assert(recentChangeEntries.length > 0, 'bounded live transcript has no file-change blocks to validate');

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

    console.log(`Codex Desktop structured controls smoke: PASS (${terminalEntries.length} terminal, ${changeEntries.length} file-change blocks)`);
  } finally {
    await client.close();
  }
}

withCodexDesktopCdpLock('codex-desktop-structured-controls', main, { waitMs: 90000 }).catch(error => {
  console.error(`Codex Desktop structured controls smoke: FAIL (${error.message})`);
  process.exit(1);
});
