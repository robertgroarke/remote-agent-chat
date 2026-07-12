#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  isPathWithinWorkspace,
  resolveWorkspaceRequestPath,
} = require('../agent-proxy/proxy-engine');

const workspace = path.resolve('C:\\temp\\remote-agent-vscode-test');
const readme = path.join(workspace, 'README.md');

assert.equal(isPathWithinWorkspace(workspace, workspace), true);
assert.equal(isPathWithinWorkspace(workspace, readme), true);
assert.equal(isPathWithinWorkspace(workspace, path.resolve(workspace, '..')), false);
assert.equal(
  isPathWithinWorkspace(workspace, path.resolve(workspace, '..', 'remote-agent-vscode-test-sibling')),
  false,
  'a sibling sharing the workspace-name prefix must not pass containment',
);

const resolvedReadme = resolveWorkspaceRequestPath(workspace, 'README.md');
assert.equal(resolvedReadme.ok, true, JSON.stringify(resolvedReadme));
assert.equal(path.normalize(resolvedReadme.path), path.normalize(readme));

const parent = resolveWorkspaceRequestPath(workspace, '..');
assert.deepEqual(
  { ok: parent.ok, code: parent.code },
  { ok: false, code: 'path_traversal' },
);

const prefixSibling = resolveWorkspaceRequestPath(workspace, '..\\remote-agent-vscode-test-sibling');
assert.deepEqual(
  { ok: prefixSibling.ok, code: prefixSibling.code },
  { ok: false, code: 'path_traversal' },
);

const missingInside = resolveWorkspaceRequestPath(workspace, 'missing-file.txt');
assert.deepEqual(
  { ok: missingInside.ok, code: missingInside.code },
  { ok: false, code: 'fs_error' },
  'a missing in-workspace file must remain an fs error, not be mislabeled as traversal',
);

console.log(JSON.stringify({
  ok: true,
  workspace,
  readme: resolvedReadme.path,
  parent_code: parent.code,
  prefix_sibling_code: prefixSibling.code,
  missing_inside_code: missingInside.code,
}, null, 2));
