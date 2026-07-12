'use strict';

const fs = require('fs');
const path = require('path');

const WORKBENCH_HOSTS = Object.freeze({
  vscode: Object.freeze({ type: 'vscode', label: 'VS Code' }),
  antigravity_ide: Object.freeze({ type: 'antigravity_ide', label: 'Antigravity IDE' }),
  unknown_editor: Object.freeze({ type: 'unknown_editor', label: 'Editor host' }),
});

function isEditorWorkbenchPage(target) {
  if (!target || target.type !== 'page') return false;
  const url = String(target.url || '');
  return /workbench\.html|vscode-file:|vscode-app|vscode:|vscode-window-config/i.test(url);
}

function detectWorkbenchHost(target) {
  const url = String(target?.url || '');
  const title = String(target?.title || '');

  // Prefer the executable resource path over the title: a workspace can
  // legitimately contain either product name, while the path identifies the host.
  if (/Microsoft(?:%20|\s)+VS(?:%20|\s)+Code/i.test(url) || /Visual Studio Code(?:\s|\[|$)/i.test(title)) {
    return WORKBENCH_HOSTS.vscode;
  }
  if (/Antigravity/i.test(url) || /(?:^|\s-\s)Antigravity(?:\s|\[|$)/i.test(title)) {
    return WORKBENCH_HOSTS.antigravity_ide;
  }
  return WORKBENCH_HOSTS.unknown_editor;
}

function vsCodeWindowPathsFromState(data) {
  const windowsState = data?.windowsState || {};
  const windows = [
    ...(windowsState.lastActiveWindow ? [windowsState.lastActiveWindow] : []),
    ...(windowsState.openedWindows || []),
  ];
  return windows.map(windowState => {
    const rawUri = windowState.folder || windowState.workspaceIdentifier?.configURIPath || '';
    if (!rawUri) return null;
    let workspacePath = decodeURIComponent(rawUri.replace(/^file:\/\/\//, '')).replace(/\//g, '\\');
    const filename = workspacePath.split('\\').filter(Boolean).pop() || workspacePath;
    const title = filename.replace(/\.code-workspace$/i, '');
    if (/\.code-workspace$/i.test(filename)) workspacePath = path.dirname(workspacePath);
    return { title, path: workspacePath, host_type: 'vscode' };
  }).filter(Boolean);
}

function readVsCodeWindowPaths(options = {}) {
  const appData = options.appData ?? process.env.APPDATA ?? '';
  const configured = options.userDataDirs ?? process.env.VSCODE_USER_DATA_DIRS ?? '';
  const roots = [
    ...(appData ? [path.join(appData, 'Code')] : []),
    ...String(configured).split(path.delimiter).map(value => value.trim()).filter(Boolean),
  ];
  const seenRoots = new Set();
  const seenPaths = new Set();
  const results = [];
  for (const root of roots) {
    const normalizedRoot = path.resolve(root).toLowerCase();
    if (seenRoots.has(normalizedRoot)) continue;
    seenRoots.add(normalizedRoot);
    try {
      const storagePath = path.join(root, 'User', 'globalStorage', 'storage.json');
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      for (const workspace of vsCodeWindowPathsFromState(data)) {
        const key = workspace.path.toLowerCase();
        if (seenPaths.has(key)) continue;
        seenPaths.add(key);
        results.push(workspace);
      }
    } catch {}
  }
  return results;
}

function workbenchWindowKey(port, windowId) {
  return `${Number(port) || 0}:${String(windowId || '')}`;
}

module.exports = {
  WORKBENCH_HOSTS,
  isEditorWorkbenchPage,
  detectWorkbenchHost,
  vsCodeWindowPathsFromState,
  readVsCodeWindowPaths,
  workbenchWindowKey,
};
