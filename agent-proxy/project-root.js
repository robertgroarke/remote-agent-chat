'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRootCache = new Map();

function normalizedCacheKey(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function existingDirectory(value) {
  if (!value || !path.isAbsolute(value)) return null;
  try {
    const resolved = fs.realpathSync.native(value);
    return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return null;
  }
}

function gitValue(workspacePath, args) {
  try {
    return execFileSync('git', ['-C', workspacePath, ...args], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a working directory to the stable project root used by sidebar groups.
 * Git linked worktrees intentionally resolve through --git-common-dir so every
 * worktree for one repository shares the same project key.
 */
function resolveProjectRoot(workspacePath) {
  const key = normalizedCacheKey(workspacePath);
  if (!key || key === 'unknown') return null;
  if (projectRootCache.has(key)) return projectRootCache.get(key);

  const workspace = existingDirectory(String(workspacePath));
  if (!workspace) {
    projectRootCache.set(key, null);
    return null;
  }

  const commonGitDir = gitValue(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  let root = null;
  if (commonGitDir && path.basename(commonGitDir).toLowerCase() === '.git') {
    root = existingDirectory(path.dirname(commonGitDir));
  }
  if (!root) {
    root = existingDirectory(gitValue(workspace, ['rev-parse', '--show-toplevel'])) || workspace;
  }

  projectRootCache.set(key, root);
  return root;
}

function clearProjectRootCache() {
  projectRootCache.clear();
}

module.exports = { clearProjectRootCache, resolveProjectRoot };
