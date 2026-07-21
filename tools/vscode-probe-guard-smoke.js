#!/usr/bin/env node
'use strict';

const assert = require('assert');
const guard = require('../agent-proxy/vscode-probe-guard');

const workbench = {
  id: 'workbench',
  type: 'page',
  title: 'Fixture - remote-agent-vscode-test - Visual Studio Code',
  url: 'vscode-file://vscode-app/workbench/workbench.html',
};
const neighboringWorkbench = {
  ...workbench,
  id: 'workbench-b',
  title: 'Fixture - remote-agent-vscode-test-b - Visual Studio Code',
};

function claudeFrame(id, suffix = '') {
  return {
    id,
    type: 'iframe',
    title: 'Claude fixture',
    url: `vscode-webview://fixture/index.html?id=${id}&extensionId=Anthropic.claude-code${suffix}`,
  };
}

const markerless = claudeFrame('markerless');
assert.equal(guard.isThrowawayWorkbench(neighboringWorkbench), false,
  'a neighboring disposable workspace must not match by name prefix');
assert.strictEqual(
  guard.assertTargetSet([workbench, neighboringWorkbench, markerless], 'claude', 'single markerless fixture').frame.id,
  markerless.id,
  'a single current Claude frame must be unambiguous without the legacy purpose marker'
);

const launcher = claudeFrame('launcher', '&purpose=webviewView');
const editor = claudeFrame('editor');
assert.strictEqual(
  guard.assertTargetSet([workbench, launcher, editor], 'claude', 'legacy launcher fixture').frame.id,
  launcher.id,
  'the explicit legacy launcher marker must remain authoritative'
);

assert.throws(
  () => guard.assertTargetSet([workbench, claudeFrame('one'), claudeFrame('two')], 'claude', 'ambiguous fixture'),
  /extension iframe not found/,
  'multiple markerless Claude frames must fail closed'
);

console.log(JSON.stringify({
  ok: true,
  single_markerless_fallback: true,
  exact_workspace_title_boundary: true,
  explicit_launcher_preferred: true,
  ambiguous_markerless_failed_closed: true,
}, null, 2));
