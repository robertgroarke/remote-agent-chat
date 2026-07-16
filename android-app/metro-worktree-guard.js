'use strict';

const fs = require('fs');
const path = require('path');

function realPath(filePath) {
  const absolute = path.resolve(filePath);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(absolute) : fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(realPath(root), realPath(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isDependency(filePath) {
  return realPath(filePath).split(path.sep).some(part => part.toLowerCase() === 'node_modules');
}

function assertWorktreeResolution(projectRoot, resolution, moduleName = '<unknown>') {
  if (!resolution || resolution.type !== 'sourceFile' || !resolution.filePath) return resolution;
  if (isDependency(resolution.filePath) || isWithin(projectRoot, resolution.filePath)) return resolution;
  throw new Error(
    `Metro rejected first-party module outside the active worktree: ${moduleName} -> ${realPath(resolution.filePath)} `
    + `(root ${realPath(projectRoot)})`,
  );
}

function createGuardedResolveRequest(projectRoot) {
  const root = realPath(projectRoot);
  return (context, moduleName, platform) => {
    const resolution = context.resolveRequest(context, moduleName, platform);
    return assertWorktreeResolution(root, resolution, moduleName);
  };
}

module.exports = {
  assertWorktreeResolution,
  createGuardedResolveRequest,
  isDependency,
  isWithin,
  realPath,
};
