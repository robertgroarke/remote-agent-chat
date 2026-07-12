'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  detectWorkbenchHost,
  isEditorWorkbenchPage,
  vsCodeWindowPathsFromState,
  workbenchWindowKey,
} = require('../agent-proxy/workbench-host');
const { buildTargetSignature } = require('../agent-proxy/session-store');
const { detectAgentType } = require('../agent-proxy/selectors');

const vscodePage = {
  type: 'page',
  title: 'Remote Agent Chat - Visual Studio Code [Administrator]',
  url: 'vscode-file://vscode-app/c:/Users/test/AppData/Local/Programs/Microsoft%20VS%20Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html',
};
const antigravityPage = {
  type: 'page',
  title: 'Remote Agent Chat - Antigravity',
  url: 'vscode-file://vscode-app/c:/Users/test/AppData/Local/Programs/Antigravity/resources/app/out/vs/code/electron-browser/workbench/workbench.html',
};
const iframeUrl = 'vscode-webview://host/index.html?id=00000000-0000-0000-0000-000000000001&parentId=2&extensionId=Anthropic.claude-code';

assert.strictEqual(isEditorWorkbenchPage(vscodePage), true);
assert.strictEqual(isEditorWorkbenchPage(antigravityPage), true);
assert.deepStrictEqual(detectWorkbenchHost(vscodePage), { type: 'vscode', label: 'VS Code' });
assert.deepStrictEqual(detectWorkbenchHost(antigravityPage), { type: 'antigravity_ide', label: 'Antigravity IDE' });

const legacy = buildTargetSignature(iframeUrl, vscodePage.title, 'claude');
const vscode = buildTargetSignature(iframeUrl, vscodePage.title, 'claude', 'vscode');
const antigravity = buildTargetSignature(iframeUrl, vscodePage.title, 'claude', 'antigravity_ide');
assert.notStrictEqual(vscode, antigravity, 'same agent/webview must not collide across editor hosts');
assert.notStrictEqual(vscode, legacy, 'host-qualified signature must differ from the legacy signature');
assert.notStrictEqual(workbenchWindowKey(9223, '1'), workbenchWindowKey(9229, '1'), 'window ids must be port scoped');

const profilePaths = vsCodeWindowPathsFromState({
  windowsState: {
    lastActiveWindow: { folder: 'file:///c%3A/temp/remote-agent-vscode-test' },
    openedWindows: [{ workspaceIdentifier: { configURIPath: 'file:///c%3A/work/demo.code-workspace' } }],
  },
});
assert.deepStrictEqual(profilePaths, [
  { title: 'remote-agent-vscode-test', path: 'c:\\temp\\remote-agent-vscode-test', host_type: 'vscode' },
  { title: 'demo', path: 'c:\\work', host_type: 'vscode' },
]);

const result = {
  ok: true,
  hosts: [detectWorkbenchHost(vscodePage), detectWorkbenchHost(antigravityPage)],
  signatures: { legacy, vscode, antigravity },
  profile_paths: profilePaths,
};

async function validateLivePort(port, expectedHost) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(10000),
  });
  assert.strictEqual(response.ok, true, `CDP ${port} target list was not available`);
  const targets = await response.json();
  const workbenchPages = targets.filter(isEditorWorkbenchPage);
  assert.ok(workbenchPages.length > 0, `CDP ${port} has no editor workbench pages`);
  const pageHosts = [...new Set(workbenchPages.map(target => detectWorkbenchHost(target).type))];
  assert.deepStrictEqual(pageHosts, [expectedHost], `CDP ${port} workbench host mismatch`);

  const agentIframes = targets.filter(target => {
    if (target.type !== 'iframe') return false;
    const ext = (String(target.url || '').match(/extensionId=([^&]+)/) || [])[1] || '';
    return /anthropic|claude|openai|chatgpt/i.test(ext);
  });
  assert.ok(agentIframes.length > 0, `CDP ${port} has no Claude Code or Codex iframe targets`);

  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const sessions = Object.values(store.sessions || {});
  const rows = agentIframes.map(target => {
    const matches = sessions.filter(session => session.target_id === target.id);
    assert.strictEqual(matches.length, 1, `target ${target.id} must map to exactly one durable session`);
    const session = matches[0];
    assert.strictEqual(session.host_type, expectedHost, `session ${session.session_id} host_type mismatch`);
    assert.ok(session.host_label, `session ${session.session_id} is missing host_label`);
    return {
      session_id: session.session_id,
      agent_type: session.agent_type,
      host_type: session.host_type,
      host_label: session.host_label,
      workspace_name: session.workspace_name,
      workspace_path_present: !!session.workspace_path,
    };
  });
  assert.strictEqual(new Set(rows.map(row => row.session_id)).size, rows.length, 'live targets produced duplicate session IDs');
  return {
    port,
    expected_host: expectedHost,
    workbench_pages: workbenchPages.length,
    agent_iframes: agentIframes.length,
    duplicate_sessions: 0,
    workspace_paths_present: rows.filter(row => row.workspace_path_present).length,
    rows,
  };
}

async function main() {
  const emptyRuntime = {
    _webviewId: '',
    evaluate: async () => ({ result: { value: null } }),
  };
  assert.strictEqual(await detectAgentType(emptyRuntime, 'Anthropic.claude-code'), 'claude');
  assert.strictEqual(await detectAgentType(emptyRuntime, 'openai.chatgpt'), 'codex');
  const liveIndex = process.argv.indexOf('--live-port');
  if (liveIndex >= 0) {
    const port = Number(process.argv[liveIndex + 1]);
    const expectedIndex = process.argv.indexOf('--expected-host');
    const expectedHost = expectedIndex >= 0 ? process.argv[expectedIndex + 1] : 'vscode';
    assert.ok(Number.isInteger(port) && port > 0, '--live-port requires a valid port number');
    result.live = await validateLivePort(port, expectedHost);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
