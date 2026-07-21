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
  const root = 'C:\\Users\\Robert\\Documents\\Remote Agent Chat';
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

  const orderingSessions = [
    { session_id: 'idle-old', project_root: 'C:\\work\\alpha', last_seen_at: '2026-07-12T10:00:00Z' },
    { session_id: 'active-new', project_root: 'C:\\work\\alpha', last_seen_at: '2026-07-12T10:05:00Z' },
    { session_id: 'idle-new', project_root: 'C:\\work\\alpha', last_seen_at: '2026-07-12T10:10:00Z' },
    { session_id: 'prompt-old', project_root: 'C:\\work\\beta', last_seen_at: '2026-07-12T09:00:00Z' },
    { session_id: 'active-old', project_root: 'C:\\work\\beta', last_seen_at: '2026-07-12T08:00:00Z' },
  ];
  const orderingOptions = {
    activities: {
      'active-new': { kind: 'generating', updated_at: '2026-07-12T10:11:00Z' },
      'active-old': { kind: 'thinking', updated_at: '2026-07-12T10:12:00Z' },
    },
    pendingPrompts: { 'prompt-old': { kind: 'question' } },
    messages: {
      'idle-old': [{ role: 'assistant', ts: Date.parse('2026-07-12T10:00:00Z') }],
      'idle-new': [{ role: 'assistant', ts: Date.parse('2026-07-12T10:10:00Z') }],
      'active-new': [{ role: 'assistant', ts: Date.parse('2026-07-12T10:05:00Z') }],
      'active-old': [{ role: 'assistant', ts: Date.parse('2026-07-12T08:00:00Z') }],
    },
  };
  const webOrdered = web.orderSidebarGroups(web.groupSessionsByDirectory(orderingSessions), orderingOptions);
  const androidOrdered = android.orderSidebarGroups(android.groupSessionsByDirectory(orderingSessions), orderingOptions);
  const webOrderShape = webOrdered.map(group => [group.label, group.sessions.map(session => session.session_id)]);
  const androidOrderShape = androidOrdered.map(group => [group.title, group.sessions.map(session => session.session_id)]);
  assert.deepStrictEqual(webOrderShape, [
    ['beta', ['prompt-old', 'active-old']],
    ['alpha', ['active-new', 'idle-new', 'idle-old']],
  ]);
  assert.deepStrictEqual(androidOrderShape, webOrderShape);
  const webLedger = web.createSidebarOrderLedger(web.groupSessionsByDirectory(orderingSessions), orderingOptions);
  const androidLedger = android.createSidebarOrderLedger(android.groupSessionsByDirectory(orderingSessions), orderingOptions);
  const recencyRefresh = {
    ...orderingOptions,
    lastMessageAt: { ...orderingOptions.lastMessageAt, 'idle-old': '2026-07-12T11:00:00Z' },
  };
  const webRefresh = web.reconcileSidebarOrderLedger(webLedger, web.groupSessionsByDirectory(orderingSessions), recencyRefresh);
  const androidRefresh = android.reconcileSidebarOrderLedger(androidLedger, android.groupSessionsByDirectory(orderingSessions), recencyRefresh);
  assert.deepStrictEqual(webRefresh.groups.map(group => group.sessions.map(row => row.session_id)), webOrdered.map(group => group.sessions.map(row => row.session_id)));
  assert.deepStrictEqual(androidRefresh.groups.map(group => group.sessions.map(row => row.session_id)), androidOrdered.map(group => group.sessions.map(row => row.session_id)));
  assert.strictEqual(webRefresh.orderChanged, true);
  assert.strictEqual(androidRefresh.orderChanged, true);
  const verifyStructuralLedger = (surface, groupSessions) => {
    const initialGroups = groupSessions(orderingSessions);
    const initialLedger = surface.createSidebarOrderLedger(initialGroups, orderingOptions);
    const initialOrder = initialLedger.sessionOrder;
    const addedSession = {
      session_id: 'new-tail', project_root: 'C:\\work\\alpha', last_seen_at: '2026-07-12T12:00:00Z',
    };
    const groupsWithNewSession = groupSessions([...orderingSessions, addedSession]);
    const frozen = surface.reconcileSidebarOrderLedger(initialLedger, groupsWithNewSession, {
      ...orderingOptions, freezeStructure: true,
    });
    assert.strictEqual(frozen.deferred, true);
    assert.deepStrictEqual(frozen.ledger.sessionOrder, initialOrder);
    assert.strictEqual(frozen.groups.flatMap(group => group.sessions).some(row => row.session_id === 'new-tail'), false);

    const appended = surface.reconcileSidebarOrderLedger(initialLedger, groupsWithNewSession, orderingOptions);
    const alpha = appended.groups.find(group => group.key.endsWith('alpha'));
    assert.strictEqual(alpha.sessions.at(-1).session_id, 'new-tail');
    assert.deepStrictEqual(
      appended.ledger.sessionOrder.filter(id => id !== 'new-tail'),
      initialOrder,
      'adding a session must not displace existing ledger entries',
    );

    const lateMetadataSessions = [...orderingSessions, addedSession].map(session => session.session_id === 'idle-old'
      ? { ...session, project_root: 'C:\\work\\gamma' }
      : session);
    const lateMetadataGroups = groupSessions(lateMetadataSessions);
    const lateMetadata = surface.reconcileSidebarOrderLedger(appended.ledger, lateMetadataGroups, orderingOptions);
    assert.strictEqual(lateMetadata.groups.find(group => group.key.endsWith('alpha')).sessions.some(row => row.session_id === 'idle-old'), true);
    assert.strictEqual(lateMetadata.groups.some(group => group.key.endsWith('gamma')), false);
    assert.strictEqual(lateMetadata.orderChanged, true);
    const explicitlySorted = surface.sortSidebarOrderLedger(lateMetadata.ledger, lateMetadataGroups, orderingOptions);
    const sortedProjection = surface.projectSidebarOrderLedger(explicitlySorted, lateMetadataGroups);
    assert.strictEqual(sortedProjection.find(group => group.key.endsWith('gamma')).sessions[0].session_id, 'idle-old');

    const afterRemovalGroups = groupSessions(lateMetadataSessions.filter(session => session.session_id !== 'prompt-old'));
    const afterRemoval = surface.reconcileSidebarOrderLedger(lateMetadata.ledger, afterRemovalGroups, orderingOptions);
    assert.strictEqual(afterRemoval.ledger.sessionOrder.includes('prompt-old'), false);
    assert.deepStrictEqual(
      afterRemoval.ledger.sessionOrder,
      lateMetadata.ledger.sessionOrder.filter(id => id !== 'prompt-old'),
      'removing a session must preserve the relative order of every survivor',
    );
    const identical = surface.reconcileSidebarOrderLedger(afterRemoval.ledger, afterRemovalGroups, orderingOptions);
    assert.strictEqual(identical.ledger, afterRemoval.ledger, 'byte-identical inventory must retain the ledger object');
    assert.deepStrictEqual(identical.ledger.sessionOrder, afterRemoval.ledger.sessionOrder);
  };
  verifyStructuralLedger(web, list => web.groupSessionsByDirectory(list));
  verifyStructuralLedger(android, list => android.groupSessionsByDirectory(list));
  const tiedGroup = [{ key: 'tie', label: 'Tie', title: 'Tie', sessions: [
    { session_id: 'new' }, { session_id: 'old-a' }, { session_id: 'old-b' },
  ] }];
  const tiedOptions = { previousGroupOrder: ['tie'], previousSessionOrder: ['old-b', 'old-a'] };
  assert.deepStrictEqual(web.orderSidebarGroups(tiedGroup, tiedOptions)[0].sessions.map(row => row.session_id), ['old-b', 'old-a', 'new']);
  assert.deepStrictEqual(android.orderSidebarGroups(tiedGroup, tiedOptions)[0].sessions.map(row => row.session_id), ['old-b', 'old-a', 'new']);

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
  const stylesSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'styles.css'), 'utf8');
  const androidSource = fs.readFileSync(path.join(repoRoot, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  const relaySource = fs.readFileSync(path.join(repoRoot, 'relay-server', 'index.js'), 'utf8');
  assert.match(appSource, /remote-agent-chat:collapsed-directories:v1/);
  assert.match(appSource, /GROUP_ALIAS_STORAGE_KEY/);
  assert.match(appSource, /localStorage\.setItem\(GROUP_ALIAS_STORAGE_KEY/);
  assert.match(appSource, /session-group-working/);
  assert.match(appSource, /class SidebarScrollCoordinator extends React\.Component/);
  assert.match(appSource, /getSnapshotBeforeUpdate\(previousProps\)/);
  assert.match(appSource, /prepareStructureChange=\{prepareSidebarStructureChange\}/);
  assert.match(appSource, /finishStructureChange=\{finishSidebarStructureChange\}/);
  assert.match(appSource, /data-session-id/);
  assert.doesNotMatch(appSource, /sidebarOrderEpoch|sidebar-rank-/);
  assert.match(appSource, /Order changed/);
  assert.match(appSource, /Sort now/);
  assert.match(appSource, /sidebar-footer-health/);
  assert.match(appSource, /sidebar-footer-rtt/);
  assert.match(stylesSource, /\.session-group-count\s*\{[^}]*height:\s*16px;/s);
  assert.match(stylesSource, /\.session-group-status-slot\s*\{[^}]*height:\s*34px;/s);
  assert.match(stylesSource, /\.session-group-unread\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-width:\s*28px;[^}]*width:\s*28px;/s);
  assert.match(stylesSource, /\.sidebar-footer-health\s*\{[^}]*flex:\s*0 0 56px;[^}]*height:\s*26px;/s);
  assert.match(stylesSource, /\.sidebar-footer-rtt\s*\{[^}]*font-variant-numeric:\s*tabular-nums;[^}]*width:\s*48px;/s);
  assert.match(androidSource, /AsyncStorage\.setItem\(COLLAPSED_DIRECTORY_KEY/);
  assert.match(androidSource, /AsyncStorage\.setItem\(GROUP_ALIAS_STORAGE_KEY/);
  assert.doesNotMatch(androidSource, /LayoutAnimation/);
  assert.match(androidSource, /maintainVisibleContentPosition/);
  assert.match(androidSource, /useStableSidebarGroups/);
  assert.match(androidSource, /Order changed/);
  assert.match(androidSource, /Sort now/);
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
    ordering: {
      web: webOrderShape,
      android: androidOrderShape,
      pending_prompt_tier: 2,
      active_tier: 1,
      idle_tier: 0,
      ordinary_refresh_reorders: false,
      explicit_sort_required: true,
    },
  }, null, 2));
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}
