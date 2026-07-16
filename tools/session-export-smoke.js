'use strict';

const assert = require('assert');
const { buildSessionExport } = require('../relay-server/session-export');

const blocks = [
  { type: 'markdown', content: '# Result' },
  { type: 'thinking', text: 'Consider the edge case.' },
  { type: 'tool_call', command: 'npm test', arguments: { cwd: 'repo' } },
  { type: 'tool_result', output: '37 tests passed' },
  { type: 'terminal', text: 'build complete' },
  { type: 'file_changes', content: 'M frontend/app.jsx', files: [{ path: 'frontend/app.jsx' }] },
  { type: 'artifact', title: 'report.json', url: '/artifact/report.json' },
  { type: 'prompt', message: 'Approve?', actions: ['yes', 'no'] },
  { type: 'plan', text: '1. Inspect\n2. Fix' },
  { type: 'queued_message', content: 'Continue after reset' },
  { type: 'notice', message: 'Rate limit clears soon' },
  { type: 'error', message: 'Target unavailable', code: 'offline' },
  { type: 'status', label: 'Working', kind: 'running_command' },
];
const rows = [
  { id: 1, sequence: 1, role: 'user', content: 'Please inspect.', ts: 1_780_000_000 },
  { id: 2, sequence: 2, role: 'assistant', content: '', content_blocks: JSON.stringify(blocks), ts: 1_780_000_010 },
];
const input = {
  sessionId: 'session/export:test',
  metadata: { display_name: 'Export: Test / Session', agent_type: 'codex_cli', project_root: 'C:/work/repo' },
  rows,
  exportedAt: '2026-07-12T22:00:00.000Z',
};
const markdown = buildSessionExport({ ...input, format: 'markdown' });
assert.equal(markdown.filename, 'Export- Test - Session.md');
assert(markdown.body.includes('Messages: 2'));
for (const label of ['Markdown', 'Thinking', 'Tool call', 'Tool result', 'Terminal', 'File changes', 'Artifact', 'Prompt', 'Plan', 'Queued message', 'Notice', 'Error', 'Status']) {
  assert(markdown.body.includes(label), `Markdown export missing ${label}`);
}
assert(markdown.body.includes('37 tests passed'));
assert(markdown.body.includes('"files"'));
assert(markdown.body.includes('Please inspect.'));
const json = buildSessionExport({ ...input, format: 'json' });
const parsed = JSON.parse(json.body);
assert.equal(parsed.schema_version, 1);
assert.equal(parsed.messages.length, 2);
assert.equal(parsed.messages[1].content_blocks.length, 13);
assert.equal(parsed.messages[1].content_blocks[5].files[0].path, 'frontend/app.jsx');

console.log(JSON.stringify({
  ok: true, formats: ['markdown', 'json'], messages: 2,
  canonical_blocks_expanded: blocks.length, filename_sanitized: true,
}, null, 2));
