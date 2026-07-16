#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'codex-vscode-readonly-update-e2e.js'), 'utf8');
for (const forbidden of [
  'selectors.readMessages(', '.click(', '.focus(', 'Input.', 'Page.reload',
  'sendMessage(', 'sendCodex', 'dispatchMouseEvent',
]) {
  assert(!source.includes(forbidden), `read-only Codex update probe contains forbidden mutation: ${forbidden}`);
}
for (const required of [
  "assert(options.readOnly", 'CDP.List(', 'selectors.cacheInnerContextId(',
  'selectors.evalInFrame(', "selectors.readAgentConfig(client.Runtime, 'codex'", 'client?.close()',
  'transcript_content_captured: false', 'focus_actions: 0', 'visible_windows_opened: 0',
]) {
  assert(source.includes(required), `read-only Codex update probe missing contract marker: ${required}`);
}

console.log(JSON.stringify({
  ok: true,
  explicit_read_only: true,
  passive_cdp_only: true,
  transcript_content_captured: false,
  mutation_markers_rejected: true,
  focus_actions: 0,
  visible_windows_opened: 0,
}, null, 2));
