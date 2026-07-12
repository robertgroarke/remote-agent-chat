#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const engine = new ProxyEngine({
  cdpPorts: [],
  relayUrl: 'ws://127.0.0.1:1',
  uploadDir: path.join(os.tmpdir(), 'rac-editor-capability-uploads'),
});

const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-editor-nongit-'));
const gitWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-editor-git-'));
try {
  execFileSync('git', ['-C', gitWorkspace, 'init'], { stdio: 'ignore' });

  for (const agentType of ['claude', 'codex', 'gemini', 'continue', 'roo_code', 'cursor', 'claude_cli', 'codex_cli', 'cursor_cli']) {
    const missing = engine._buildCapabilities(agentType, null);
    assert.equal(missing.file_browser, false, `${agentType} must not advertise file browsing without a workspace`);
    assert.equal(missing.branch_list, false, `${agentType} must not advertise branch listing without a Git workspace`);
    assert.equal(missing.switch_branch, false, `${agentType} must not advertise branch switching without a Git workspace`);
    assert.equal(missing.create_branch, false, `${agentType} must not advertise branch creation without a Git workspace`);

    const plain = engine._buildCapabilities(agentType, nonGit);
    assert.equal(plain.file_browser, true, `${agentType} should browse a real non-Git workspace`);
    assert.equal(plain.branch_list, false, `${agentType} must hide branch controls for a non-Git workspace`);

    const git = engine._buildCapabilities(agentType, gitWorkspace);
    assert.equal(git.file_browser, true, `${agentType} should browse a real Git workspace`);
    assert.equal(git.branch_list, true, `${agentType} should list branches for a Git workspace`);
    assert.equal(git.switch_branch, true, `${agentType} should switch branches for a Git workspace`);
    assert.equal(git.create_branch, true, `${agentType} should create branches for a Git workspace`);
  }

  const antigravityV2 = engine._buildCapabilities('antigravity-v2', gitWorkspace);
  assert.equal(antigravityV2.file_browser, false);
  assert.equal(antigravityV2.branch_list, false);

  const continueCaps = engine._buildCapabilities('continue', gitWorkspace);
  assert.equal(continueCaps.chat_list, false, 'Continue editor tabs must not be advertised as native chat history');
  assert.equal(continueCaps.switch_chat, false, 'Continue editor tabs must not be exposed as native chat switching');
  assert.equal(engine._buildCapabilities('codex', gitWorkspace).chat_list, true, 'Codex native task history remains supported');

  console.log('editor workspace capability smoke: PASS');
} finally {
  fs.rmSync(nonGit, { recursive: true, force: true });
  fs.rmSync(gitWorkspace, { recursive: true, force: true });
}
