#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));
const { clearProjectRootCache, resolveProjectRoot } = require('../agent-proxy/project-root');
const protocol = require('../agent-proxy/protocol');

const repoRoot = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-directory-groups-'));

function compileModule(sourcePath, name) {
  const output = path.join(scratch, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [sourcePath],
    outfile: output,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return require(output);
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

try {
  const web = compileModule(path.join(repoRoot, 'frontend', 'workspace-groups.js'), 'web-groups');
  const android = compileModule(path.join(repoRoot, 'android-app', 'lib', 'workspace-groups.js'), 'android-groups');
  const root = 'C:\\workspace\\Remote Agent Chat';
  const sessions = [
    { session_id: 'codex', agent_type: 'codex_cli', project_root: root, workspace_path: `${root}\\frontend`, chat_title: 'REMOTE AGENT CODEX CLI PRODUCTION' },
    { session_id: 'claude', agent_type: 'claude_cli', project_root: root.toLowerCase().replace(/\\/g, '/'), workspace_path: root, chat_title: 'REMOTE AGENT CLAUDE CLI NEW' },
    { session_id: 'subdir-fallback', agent_type: 'cursor', workspace_path: `${root}\\relay-server` },
    { session_id: 'validator-claude', agent_type: 'claude_cli', project_root: 'C:\\temp\\remote-agent-claude-clean', workspace_path: 'C:\\temp\\remote-agent-claude-clean' },
    { session_id: 'validator-vscode', agent_type: 'continue', workspace_path: 'C:\\temp\\REMOTE AGENT VSCode Soak' },
    { session_id: 'validator-explicit', agent_type: 'codex_cli', workspace_path: 'C:\\temp\\validation-4f9a', group_alias: 'Remote Agent Chat' },
    { session_id: 'unscoped-a', agent_type: 'codex', workspace_name: 'REMOTE AGENT CODEX CLI FIX' },
    { session_id: 'unscoped-b', agent_type: 'claude', window_title: 'REMOTE AGENT CLAUDE CLI PROBE' },
  ];

  const webGroups = web.groupSessionsByDirectory(sessions);
  const androidGroups = android.groupSessionsByDirectory(sessions);
  assert.deepStrictEqual(webGroups.map(group => [group.key, group.label, group.sessions.length]), [
    ['alias:remote-agent-chat', 'Remote Agent Chat', 6],
    ['unscoped', 'Unscoped', 2],
  ]);
  assert.deepStrictEqual(androidGroups.map(group => [group.key, group.title, group.sessions.length]), [
    ['alias:remote-agent-chat', 'Remote Agent Chat', 6],
    ['unscoped', 'Unscoped', 2],
  ]);
  const customSession = { session_id: 'custom-validator', workspace_path: 'C:\\temp\\validation-fixture-17' };
  const customAliases = { '^validationfixture': 'Remote Agent Chat' };
  assert.strictEqual(web.groupSessionsByDirectory([...sessions, customSession], {}, customAliases)[0].sessions.length, 7);
  assert.strictEqual(android.groupSessionsByDirectory([...sessions, customSession], customAliases)[0].sessions.length, 7);

  const mainRepo = path.join(scratch, 'project');
  const worktree = path.join(scratch, 'project-feature');
  const subdir = path.join(mainRepo, 'src', 'nested');
  fs.mkdirSync(subdir, { recursive: true });
  git(mainRepo, ['init']);
  git(mainRepo, ['config', 'user.email', 'directory-groups@example.invalid']);
  git(mainRepo, ['config', 'user.name', 'Directory Groups Smoke']);
  fs.writeFileSync(path.join(mainRepo, 'README.md'), 'fixture\n');
  git(mainRepo, ['add', 'README.md']);
  git(mainRepo, ['commit', '-m', 'fixture']);
  git(mainRepo, ['worktree', 'add', '-b', 'fixture-worktree', worktree]);

  clearProjectRootCache();
  const expectedRoot = fs.realpathSync.native(mainRepo);
  assert.strictEqual(resolveProjectRoot(mainRepo), expectedRoot);
  assert.strictEqual(resolveProjectRoot(subdir), expectedRoot);
  assert.strictEqual(resolveProjectRoot(worktree), expectedRoot);
  assert.strictEqual(resolveProjectRoot('REMOTE AGENT CODEX CLI FIX'), null);

  const snapshot = protocol.sessionSnapshot([
    { session_id: 'main', workspace_path: subdir },
    { session_id: 'worktree', workspace_path: worktree },
    { session_id: 'unscoped', workspace_name: 'Harness-derived title' },
  ]);
  assert.strictEqual(snapshot.sessions[0].project_root, expectedRoot);
  assert.strictEqual(snapshot.sessions[1].project_root, expectedRoot);
  assert.strictEqual(snapshot.sessions[2].project_root, null);

  const appSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'app.jsx'), 'utf8');
  const androidSource = fs.readFileSync(path.join(repoRoot, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  const relaySource = fs.readFileSync(path.join(repoRoot, 'relay-server', 'index.js'), 'utf8');
  assert.match(appSource, /remote-agent-chat:collapsed-directories:v1/);
  assert.match(appSource, /GROUP_ALIAS_STORAGE_KEY/);
  assert.match(appSource, /localStorage\.setItem\(GROUP_ALIAS_STORAGE_KEY/);
  assert.match(appSource, /session-group-working/);
  assert.match(androidSource, /AsyncStorage\.setItem\(COLLAPSED_DIRECTORY_KEY/);
  assert.match(androidSource, /AsyncStorage\.setItem\(GROUP_ALIAS_STORAGE_KEY/);
  assert.match(androidSource, /LayoutAnimation\.configureNext/);
  assert.doesNotMatch(androidSource, /groups\[type\]/);
  assert.match(relaySource, /project_root\s+TEXT/);
  esbuild.transformSync(androidSource, { loader: 'jsx', target: 'es2020' });

  console.log(JSON.stringify({
    ok: true,
    web_groups: webGroups.map(group => ({ key: group.key, label: group.label, count: group.sessions.length })),
    android_groups: androidGroups.map(group => ({ key: group.key, title: group.title, count: group.sessions.length })),
    git_project_root: expectedRoot,
    worktree_project_root: snapshot.sessions[1].project_root,
    persisted_collapse: { web: 'localStorage', android: 'AsyncStorage' },
    persisted_group_aliases: { web: 'localStorage', android: 'AsyncStorage' },
    seeded_alias: { pattern: '^remoteagent', title: 'Remote Agent Chat', count: 6 },
  }, null, 2));
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}
