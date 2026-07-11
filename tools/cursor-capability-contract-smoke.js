#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const cursorSelectors = require('../agent-proxy/cursor-selectors');
const selectors = require('../agent-proxy/selectors');

function makeEngine() {
  return new ProxyEngine({
    cdpPorts: [],
    relayUrl: 'ws://127.0.0.1:1',
    uploadDir: path.join(os.tmpdir(), 'rac-cursor-capability-uploads'),
  });
}

async function main() {
  const engine = makeEngine();
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cursor-nongit-'));
  const gitWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cursor-git-'));
  try {
    execFileSync('git', ['-C', gitWorkspace, 'init'], { stdio: 'ignore' });

    const noWorkspace = engine._buildCapabilities('cursor');
    assert.equal(noWorkspace.native_window, false, 'Cursor IDE must not advertise the CLI native-window action');
    assert.equal(noWorkspace.file_browser, false, 'Cursor file browser requires a real workspace path');
    assert.equal(noWorkspace.branch_list, false, 'Cursor branch controls require a Git worktree');
    assert.equal(noWorkspace.switch_branch, false);
    assert.equal(noWorkspace.create_branch, false);

    const nonGitCaps = engine._buildCapabilities('cursor', nonGit);
    assert.equal(nonGitCaps.file_browser, true, 'a real non-Git workspace still supports file browsing');
    assert.equal(nonGitCaps.file_changes, false,
      'Cursor 3.5 Review/Commit has no reversible Keep/Undo control to advertise');
    assert.equal(nonGitCaps.branch_list, false, 'a non-Git workspace must not render broken branch controls');

    const gitCaps = engine._buildCapabilities('cursor', gitWorkspace);
    assert.equal(gitCaps.file_browser, true);
    assert.equal(gitCaps.branch_list, true);
    assert.equal(gitCaps.switch_branch, true);
    assert.equal(gitCaps.create_branch, true);
    assert.equal(gitCaps.terminal_input, true);

    const emitted = [];
    engine._sendToRelay = message => emitted.push(message);
    engine.sessions.set('cursor-smoke', {
      agentType: 'cursor',
      workspace_path: nonGit,
      client: { Runtime: {}, Input: {} },
    });
    const originalWrite = cursorSelectors.writeCursorTerminalInput;
    cursorSelectors.writeCursorTerminalInput = async () => ({ ok: false, detail: 'no-terminal' });
    try {
      engine._handleRelayMessage({
        type: 'terminal_input',
        session_id: 'cursor-smoke',
        request_id: 'terminal-smoke',
        text: 'Write-Output smoke',
      });
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      cursorSelectors.writeCursorTerminalInput = originalWrite;
    }
    const result = emitted.find(message => message.type === 'agent_control_result' && message.request_id === 'terminal-smoke');
    assert.equal(result?.result, 'failed', 'terminal input must fail closed when native input is unavailable');
    assert.equal(result?.error?.message, 'no-terminal');

    const originalSwitch = cursorSelectors.switchCursorAgent;
    const originalAgentList = cursorSelectors.readCursorAgentList;
    const originalReadMessages = selectors.readMessages;
    const originalWithTimeout = engine._withTimeout;
    cursorSelectors.switchCursorAgent = async () => ({ ok: true, detail: 'already-active' });
    cursorSelectors.readCursorAgentList = async () => ([{
      id: 'agent-owned', cache_key: '00000000-0000-4000-8000-000000000001', active: true,
    }]);
    selectors.readMessages = () => new Promise(() => {});
    let simulateNativeSwitchTimeout = false;
    engine._withTimeout = async (promise, timeoutMs, label) => {
      if (simulateNativeSwitchTimeout && String(label).startsWith('cursor switch native ')) {
        throw new Error('simulated native switch timeout');
      }
      if (String(label).startsWith('cursor switch transcript ')) {
        throw new Error('simulated post-switch snapshot timeout');
      }
      return promise;
    };
    try {
      engine._handleRelayMessage({
        type: 'switch_thread',
        session_id: 'cursor-smoke',
        request_id: 'switch-timeout-smoke',
        thread_id: 'agent-owned',
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      simulateNativeSwitchTimeout = true;
      engine._handleRelayMessage({
        type: 'switch_thread',
        session_id: 'cursor-smoke',
        request_id: 'switch-native-timeout-smoke',
        thread_id: 'agent-owned',
      });
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      cursorSelectors.switchCursorAgent = originalSwitch;
      cursorSelectors.readCursorAgentList = originalAgentList;
      selectors.readMessages = originalReadMessages;
      engine._withTimeout = originalWithTimeout;
    }
    const switchResult = emitted.find(message =>
      message.type === 'agent_control_result' && message.request_id === 'switch-timeout-smoke');
    assert.equal(switchResult?.result, 'ok',
      'a successful native Cursor switch must acknowledge even if its immediate snapshot refresh times out');
    const nativeTimeoutResult = emitted.find(message =>
      message.type === 'agent_control_result' && message.request_id === 'switch-native-timeout-smoke');
    assert.equal(nativeTimeoutResult?.result, 'failed',
      'a stalled native Cursor switch must return a bounded failed result instead of hanging the caller');
    assert.equal(nativeTimeoutResult?.error?.message, 'simulated native switch timeout');

    console.log('PASS Cursor capability, terminal fail-closed, and bounded switch acknowledgement contract');
  } finally {
    fs.rmSync(nonGit, { recursive: true, force: true });
    fs.rmSync(gitWorkspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
