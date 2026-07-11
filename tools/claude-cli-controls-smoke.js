'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-claude-cli-controls-'));
  const workspacePath = path.join(tempRoot, 'workspace with spaces');
  const configPath = path.join(tempRoot, '.claude.json');

  try {
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      keepMe: { exact: true },
      projects: {
        'C:\\existing-workspace': {
          hasTrustDialogAccepted: true,
          allowedTools: ['Read'],
        },
      },
    }, null, 2));

    assert.strictEqual(claudeCli.isWorkspaceTrusted(workspacePath, configPath), false);
    const result = await claudeCli.trustWorkspace({ workspacePath, configPath });
    assert.deepStrictEqual(result, { ok: true, detail: 'workspace trusted' });
    assert.strictEqual(claudeCli.isWorkspaceTrusted(workspacePath, configPath), true);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const exactWorkspace = path.resolve(workspacePath);
    assert.deepStrictEqual(updated.keepMe, { exact: true }, 'unrelated Claude config must be preserved');
    assert.deepStrictEqual(updated.projects['C:\\existing-workspace'].allowedTools, ['Read']);
    assert.strictEqual(updated.projects[exactWorkspace].hasTrustDialogAccepted, true);
    assert.deepStrictEqual(updated.projects[exactWorkspace].allowedTools, []);
    assert.strictEqual(updated.fullscreenUpsellSeenCount, 3, 'native fullscreen renderer upsell must not block remote startup');
    if (process.platform === 'win32') {
      const slashWorkspace = exactWorkspace.replace(/\\/g, '/');
      const lowerDriveWorkspace = slashWorkspace.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
      assert.strictEqual(updated.projects[slashWorkspace].hasTrustDialogAccepted, true);
      assert.strictEqual(updated.projects[lowerDriveWorkspace].hasTrustDialogAccepted, true);
    }

    const missing = await claudeCli.trustWorkspace({
      workspacePath: path.join(tempRoot, 'missing'),
      configPath,
    });
    assert.strictEqual(missing.ok, false);

    const invalidPath = path.join(tempRoot, 'invalid.json');
    fs.writeFileSync(invalidPath, '{ invalid json', 'utf8');
    const invalid = await claudeCli.trustWorkspace({ workspacePath, configPath: invalidPath });
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(fs.readFileSync(invalidPath, 'utf8'), '{ invalid json', 'invalid config must not be overwritten');

    const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
    assert.match(proxySource, /this\._claudeCliPollTimer = setInterval/);
    assert.match(proxySource, /session\.agentType === 'claude_cli'[\s\S]*?continue;/);
    assert.match(proxySource, /if \(this\._claudeCliPollTimer\)[\s\S]*?clearInterval\(this\._claudeCliPollTimer\)/);
    assert.doesNotMatch(proxySource, /messages\.length > 0 \? null : this\._claudeCliTrustPrompt/);
    assert.match(proxySource, /stopNativeClaudeWindow\(sessionData\.nativeClaudeWindowChild\)/);
    assert.match(proxySource, /sessionData\.nativeClaudeWindowChild = child/);
    assert.match(proxySource, /sessionData\._claudeCliInterrupted = true;[\s\S]*?stopNativeClaudeWindow\(sessionData\[childKey\]\)/);
    assert.match(proxySource, /const wasInterrupted = session\._claudeCliInterrupted === true/);
    assert.match(proxySource, /const cliHasGitWorkspace = !isStoreBackedCli \|\| this\._isGitWorkspace\(workspacePath\)/);
    assert.match(proxySource, /branch_list:\s+!isAntigravityV2 && cursorHasGitWorkspace && cliHasGitWorkspace/);
    assert.match(proxySource, /_buildCapabilities\('claude_cli', session\.workspace_path\)/);
    assert.match(proxySource, /native_window:\s+isCodexCli \|\| isCursorCli/);

    const storeSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.js'), 'utf8');
    assert.match(storeSource, /Object\.entries\(extra\)\.filter\(\(\[, value\]\) => value !== undefined\)/);

    const claudeSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'claude-cli.js'), 'utf8');
    assert.match(claudeSource, /const nativeExtraArgs = \['--no-chrome'\]/);
    assert.match(claudeSource, /path\.join\(process\.env\.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude\.exe'\)/);
    assert.match(claudeSource, /if \(claudeExe\) return \{ command: claudeExe, spawnArgs: args \}/);
    assert.match(claudeSource, /Could not find a valid Claude Code native executable/);
    assert.match(claudeSource, /const nativeCommand = command === 'cmd\.exe' \? \(spawnArgs\[3\]/);

    console.log('PASS claude-cli controls: durable trust, owned native replacement, config persistence, and isolated lifecycle polling');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
