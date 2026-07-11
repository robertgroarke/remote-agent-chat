'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const codexCli = require('../agent-proxy/codex-cli');

const cliSessionId = '11111111-2222-4333-8444-555555555555';
const workspacePath = 'C:\\workspace with spaces';
const nativeLauncherPath = 'C:\\temp\\remote-agent-codex-cli-test.cmd';

const nativePowerShell = codexCli.buildNativeCodexWindowPowerShell({
  cwd: workspacePath,
  launcherPath: nativeLauncherPath,
});
assert.match(nativePowerShell, /-ArgumentList '\/k', 'C:\\temp\\remote-agent-codex-cli-test\.cmd'/);
assert.doesNotMatch(nativePowerShell, /-ArgumentList '\/k "/);

const resumeArgs = codexCli.buildCodexArgs({
  execMode: true,
  cliSessionId,
  resume: true,
  model: 'gpt-5.5',
  effort: 'high',
  permissionMode: 'workspace-write',
  json: true,
  workspacePath,
  extraArgs: ['resume smoke'],
});

assert.deepStrictEqual(resumeArgs, [
  'exec',
  'resume',
  '--json',
  '--skip-git-repo-check',
  '--all',
  '-m',
  'gpt-5.5',
  '-c',
  'model_reasoning_effort="high"',
  '-c',
  'sandbox_mode="workspace-write"',
  cliSessionId,
  'resume smoke',
]);
assert(!resumeArgs.includes('-s'), 'exec resume must not receive its unsupported -s flag');

const newExecArgs = codexCli.buildCodexArgs({
  execMode: true,
  resume: false,
  model: 'gpt-5.5',
  effort: 'medium',
  permissionMode: 'read-only',
  json: true,
  workspacePath,
  extraArgs: ['new session smoke'],
});

assert.deepStrictEqual(newExecArgs, [
  'exec',
  '--json',
  '--skip-git-repo-check',
  '-C',
  workspacePath,
  '-m',
  'gpt-5.5',
  '-c',
  'model_reasoning_effort="medium"',
  '-s',
  'read-only',
  'new session smoke',
]);

const nativeResumeArgs = codexCli.buildCodexArgs({
  execMode: false,
  cliSessionId,
  resume: true,
  permissionMode: 'danger-full-access',
});
assert.deepStrictEqual(nativeResumeArgs, [
  'resume',
  '-s',
  'danger-full-access',
  cliSessionId,
]);

assert.deepStrictEqual(codexCli.stopCodexExecSession(null), {
  ok: false,
  detail: 'No owned Codex CLI process to stop',
});

const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
const codexSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'codex-cli.js'), 'utf8');
assert.match(proxySource, /sessionData\._codexCliInterrupted = true;[\s\S]*?stopCodexExecSession\(sessionData\[childKey\]\)/);
assert.match(proxySource, /const wasInterrupted = session\._codexCliInterrupted === true;/);
assert.match(proxySource, /const nextActivity = session\._codexCliInterrupted === true && observedActivity\.kind !== 'idle'/);
assert.match(proxySource, /_sendCodexCliMessage[\s\S]*?session\._codexCliInterrupted = false;/);
assert.doesNotMatch(proxySource, /const wasInterrupted = session\._codexCliInterrupted === true;\s*session\._codexCliInterrupted = false;/);
assert.match(proxySource, /codex_cli_interrupted: true/);
assert.match(proxySource, /const interrupted = sessionMeta\.codex_cli_interrupted === true/);
assert.match(proxySource, /sessionStore\.updateSession\(sessionId, \{ codex_cli_interrupted: false \}\)/);
assert.match(proxySource, /permission_dialogs:\s+isClaude \|\| isClaudeCli \|\| isCursorCli/);
assert.doesNotMatch(proxySource, /permission_dialogs:[^\n]*isCodexCli/);
assert.match(
  proxySource,
  /const pendingEntry[\s\S]*?_codexCliTranscriptKeyMatches\(summary, s\)[\s\S]*?!s\.codexCliFilePath/,
  'first JSONL attachment must adopt the existing relay session before considering a new virtual alias'
);
assert.match(proxySource, /migrateVirtualSession\([\s\S]*?`codex-cli:\$\{summary\.cliSessionId\}`/);
assert.match(proxySource, /summary\.filePath \? \[\] : this\._codexCliPendingTranscriptMessages/);
assert.match(proxySource, /session\.codexCliFilePath \? \[\] : this\._codexCliPendingTranscriptMessages/);
assert.match(proxySource, /codex_cli_model_configured: true/);
assert.match(proxySource, /codex_cli_permission_configured: true/);
assert.match(proxySource, /codex_cli_effort_configured: true/);
assert.match(proxySource, /session\.codexCliModelConfigured !== true && summary\.model_id/);
assert.match(proxySource, /session\.codexCliPermissionConfigured !== true && summary\.permission_mode/);
assert.match(proxySource, /session\.codexCliEffortConfigured !== true && summary\.effort/);
assert.doesNotMatch(proxySource, /startNativeCodexWindow\(\{[\s\S]*?elevated:\s*true/);
assert.match(codexSource, /buildNativeCodexWindowPowerShell\(\{ cwd, launcherPath, elevated = false \}/);
assert.match(codexSource, /'-ArgumentList', `\$\{quotePowerShellString\('\/k'\)\}, \$\{quotePowerShellString\(launcherPath\)\}`/);
assert.match(codexSource, /startNativeCodexWindow\(\{[\s\S]*?elevated = false/);
assert.match(codexSource, /default-terminal[\s\S]*?windowsHide: false/);
assert.match(codexSource, /const resolved = resolveCodexCommand\(\);[\s\S]*?resolved\.command, \.\.\.resolved\.argsPrefix, \.\.\.args/);
assert.match(codexSource, /'-PassThru', '\|', 'Select-Object', '-ExpandProperty', 'Id'/);
assert.match(codexSource, /const result = spawnSync\('powershell\.exe'/);
assert.match(codexSource, /throw new Error\(`Could not open Codex CLI window:/);
assert.match(proxySource, /const hasTranscript = isCodexCli \? !!sessionData\.codexCliFilePath/);
assert.match(proxySource, /if \(!hasTranscript\) this\._sendHistorySnapshot\(sid, pendingMsgs, `\$\{label\} cli native startup`\)/);

console.log('PASS codex-cli controls: exec-resume flags, stable first-transcript identity, exact process-tree interrupt, and truthful prompt capabilities');
