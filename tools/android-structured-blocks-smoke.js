#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  CANONICAL_BLOCK_TYPES,
  normalizeMessageBlocks,
  terminalText,
  fileChangesText,
  blocksToPlainText,
} = require('../android-app/lib/content-blocks');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;

const fixtures = [
  { type: 'markdown', content: '# Result\n\nBody' },
  { type: 'thinking', label: 'Thought for 2s', content: 'Inspected the request.' },
  { type: 'tool_call', label: 'Run command', status: 'done', content: 'Executed a safe command.' },
  { type: 'tool_result', label: 'Command result', status: 'done', content: '42 checks passed.' },
  { type: 'terminal', command: 'node --version', stdout: 'v24.11.1', stderr: '', exit_code: 0 },
  { type: 'file_changes', summary: '1 file changed', files: [{ path: 'x.js', added: 2, removed: 1 }] },
  { type: 'artifact', label: 'Walkthrough', content: 'Artifact body.' },
  { type: 'prompt', label: 'Permission required', content: 'Allow?', actions: [{ id: 'allow', label: 'Allow' }] },
  { type: 'plan', label: 'Plan', tasks: [{ text: 'Inspect state', state: 'completed' }, { text: 'Apply fix', state: 'in_progress' }] },
  { type: 'queued_message', label: 'Queued message', content: 'Run the next check.' },
  { type: 'notice', label: 'Response delayed', content: 'Still working.' },
  { type: 'error', label: 'Failed', content: 'Failure body.', actions: [{ id: 'retry', label: 'Retry' }] },
  { type: 'status', label: 'Worked for 3s' },
];

const normalized = normalizeMessageBlocks({
  role: 'assistant',
  content: 'legacy fallback must not replace structured blocks',
  content_blocks: fixtures,
});
assert.deepStrictEqual(normalized.map(block => block.type), CANONICAL_BLOCK_TYPES);

const aliases = normalizeMessageBlocks({
  role: 'assistant',
  content_blocks: [
    { type: 'code', language: 'js', content: 'const ok = true;' },
    { type: 'file_change', summary: 'changed' },
    { type: 'tool', label: 'Tool' },
    { type: 'tool_output', label: 'Result' },
    { type: 'thought', content: 'Reasoning' },
    { type: 'task_list', tasks: [] },
    { type: 'queue', content: 'Queued' },
    { type: 'banner', content: 'Notice' },
    { type: 'activity', label: 'Working' },
  ],
});
assert.deepStrictEqual(aliases.map(block => block.type), [
  'markdown', 'file_changes', 'tool_call', 'tool_result', 'thinking', 'plan', 'queued_message', 'notice', 'status',
]);
assert.match(aliases[0].content, /^```js/);

assert.deepStrictEqual(normalizeMessageBlocks({ role: 'user', content: 'hello', content_blocks: fixtures }), [
  { type: 'text', text: 'hello' },
]);
assert.deepStrictEqual(normalizeMessageBlocks({ role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { path: 'x' } }] }), [
  { type: 'tool_use', name: 'Read', input: { path: 'x' } },
]);

assert.match(terminalText(fixtures[4]), /\$ node --version/);
assert.match(terminalText(fixtures[4]), /exit code: 0/);
assert.match(fileChangesText(fixtures[5]), /x\.js \+2 -1/);
const plain = blocksToPlainText(fixtures);
for (const expected of ['Body', 'Inspected', 'safe command', '42 checks', 'v24.11.1', 'x.js +2 -1', 'Artifact body', 'Allow?', 'Inspect state', 'Run the next check', 'Still working', 'Failure body', 'Worked for 3s']) {
  assert(plain.includes(expected), `plain-text copy is missing ${expected}`);
}

const bubbleSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
const chatSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
for (const type of CANONICAL_BLOCK_TYPES) {
  assert.match(bubbleSource, new RegExp(`case ['\"]${type}['\"]`), `Android renderer is missing ${type}`);
}
assert.match(bubbleSource, /normalizeMessageBlocks\(message\)/);
assert.match(bubbleSource, /case 'tool_call'[\s\S]*?defaultOpen/);
assert.match(bubbleSource, /case 'terminal'[\s\S]*?defaultOpen/);
assert.match(bubbleSource, /case 'terminal'[\s\S]*?nativeClaudeTerminal[\s\S]*?<ClaudeTerminalBlock/);
assert.match(bubbleSource, /function ClaudeTerminalBlock\(/);
assert.match(bubbleSource, /case 'tool_use'[\s\S]*?defaultOpen/);
assert.match(bubbleSource, /case 'tool_result'[\s\S]*?defaultOpen/);
const legacyTextCase = bubbleSource.match(/case 'text':[\s\S]*?case 'markdown':/)?.[0] || '';
assert.match(legacyTextCase, /<Markdown[\s\S]*?\{block\.text\}[\s\S]*?<\/Markdown>/);
assert(!legacyTextCase.includes('renderCollapsibleText'),
  'legacy Android assistant text must never auto-collapse');
assert.match(chatSource, /<MessageBubble[\s\S]*?message=\{item\}[\s\S]*?agentType=\{agentType\}[\s\S]*?deliveryState=/);
assert.match(bubbleSource, /function themeForAgent\(agentType, isLight = false\)/);
assert.match(bubbleSource, /observedTranscriptThemes\[agentType\] \|\| defaultTranscriptTheme/);
assert.match(bubbleSource, /useColorScheme\(\) === 'light'/);
assert.match(bubbleSource, /lightCodeBackgrounds/);
assert.match(bubbleSource, /function lightTranscriptTheme/);
assert.match(bubbleSource, /backgroundColor: codeBackground, color: '#24292f'/);
assert.match(bubbleSource, /backgroundColor: '#eff1f3', color: '#24292f'/);
assert.match(bubbleSource, /continueMarkdownStyles[\s\S]*?fontSize:\s*14[\s\S]*?lineHeight:\s*21/);
assert.match(bubbleSource, /code_block:[\s\S]*?fontSize:\s*13[\s\S]*?lineHeight:\s*20/);
for (const agentType of [
  'claude', 'codex', 'codex-desktop', 'cursor', 'continue', 'continue_yolo',
  'antigravity-v2', 'antigravity', 'antigravity_panel', 'claude_cli', 'codex_cli', 'cursor_cli',
]) {
  const quoted = agentType.includes('-') ? "'" + agentType + "'" : agentType + ':';
  assert(bubbleSource.includes(quoted), 'Android transcript theme map is missing ' + agentType);
}
assert.match(bubbleSource, /monospaceBody:\s*true/);
assert.match(bubbleSource, /nativeClaudeTerminal:\s*normalizedAgent === 'claude'/);

const toolSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'ToolSection.jsx'), 'utf8');
assert.match(toolSource, /defaultOpen = true/);
assert.match(toolSource, /useState\(defaultOpen\)/);
assert.match(toolSource, /textTheme = null/);
assert.match(toolSource, /light = false/);
assert.match(toolSource, /textTheme\?\.code/);
assert.match(toolSource, /containerLight:[\s\S]*?backgroundColor: '#f6f8fa'/);
assert.match(toolSource, /codeLight:[\s\S]*?backgroundColor: '#ffffff'/);
assert(!/<Text style=\{s\.name\} numberOfLines=\{1\}>/.test(toolSource),
  'Android tool names must wrap instead of truncating to one line');

const terminalSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'TerminalViewer.jsx'), 'utf8');
assert.match(terminalSource, /useColorScheme\(\) === 'light'/);
assert.match(terminalSource, /sheetLight:[\s\S]*?backgroundColor: '#f6f8fa'/);
assert.match(terminalSource, /outputLight:[\s\S]*?color: '#24292f'/);

const result = {
  ok: true,
  canonical_block_types: CANONICAL_BLOCK_TYPES,
  alias_types: aliases.map(block => block.type),
  android_renderers: CANONICAL_BLOCK_TYPES,
  canonical_tool_sections_default_open: true,
  legacy_tool_sections_default_open: true,
  tool_names_wrap_in_full: true,
  continue_text_theme: { body_size: 14, body_line: 21, code_size: 14, code_line: 21 },
  observed_text_theme_agent_types: [
    'claude', 'codex', 'codex-desktop', 'cursor', 'continue', 'continue_yolo',
    'antigravity-v2', 'antigravity', 'antigravity_panel', 'claude_cli', 'codex_cli', 'cursor_cli',
  ],
  light_mode_code_palette: true,
  light_mode_tool_palette: true,
  light_mode_terminal_palette: true,
  legacy_text_default_expanded: true,
  legacy_claude_blocks_preserved: true,
  plain_text_copy_length: plain.length,
  generated_at: new Date().toISOString(),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
process.stdout.write(serialized);
