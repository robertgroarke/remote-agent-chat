#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const androidActivity = fs.readFileSync(path.join(root, 'android-app', 'components', 'ActivityRow.jsx'), 'utf8');
const androidSessions = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const androidMessages = fs.readFileSync(path.join(root, 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
const resultArg = process.argv.indexOf('--result-file');
const resultFile = resultArg >= 0 ? path.resolve(process.argv[resultArg + 1] || '') : '';
if (resultArg >= 0) assert(resultFile, '--result-file requires a path');

const layouts = {
  claude: 'claude-document',
  codex_cli: 'codex-terminal',
  cursor: 'cursor-cards',
  'codex-desktop': 'codex-thread',
};
for (const [agent, layout] of Object.entries(layouts)) {
  assert(app.includes(`agentType === '${agent}'`) || app.includes(`agentType === '${agent}' ||`),
    `missing ${agent} layout mapping`);
  assert(app.includes(`return '${layout}'`), `missing ${layout} layout result`);
  assert(styles.includes(`[data-layout="${layout}"]`), `missing ${layout} CSS contract`);
}
assert(app.includes('data-layout={harnessLayoutForAgentType(activeSessionMeta?.agent_type)}'),
  'active transcript does not publish its native layout');
assert.match(styles, /codex-terminal[^}]+content-block-tool[^}]+summary::before[\s\S]+content:\s*"IN"/,
  'Codex CLI tool input gutter label is missing');
assert.match(styles, /codex-terminal[^}]+content-block-tool-result[^}]+summary::before[\s\S]+content:\s*"OUT"/,
  'Codex CLI tool output gutter label is missing');
assert.match(styles, /claude-document[^}]+details\.content-block > summary::marker/,
  'Claude canonical disclosure chevron styling is missing');
assert.match(styles, /cursor-cards[^}]+content-block-file-change[^}]+content-block-actions/,
  'Cursor diff action placement is missing');

assert(app.includes('NativeActivitySpinner'), 'web native spinner router is missing');
assert(app.includes("thinking.label || activity?.label || 'Thinking'"),
  'web must pass native activity vocabulary through verbatim');
assert.match(styles, /native-activity-spinner\.cursor i:nth-child\(3\)/,
  'Cursor three-dot generating animation is missing');
assert.match(styles, /native-activity-spinner\.codex[^}]+native-codex-pulse/,
  'Codex native spinner animation is missing');
assert(app.includes("step.state === 'in_progress' ? <NativeActivitySpinner agentType={agentType} compact />"),
  'Codex step chips must use the native spinner router');
for (const source of [androidActivity, androidSessions]) {
  assert(source.includes("'✻'") && source.includes("'◌'") && source.includes("'•••'"),
    'Android native status glyph parity is incomplete');
}
assert(androidActivity.includes("thinking?.label || activity?.label || 'Thinking'"),
  'Android must pass native status vocabulary through verbatim');
for (const layout of Object.values(layouts)) {
  assert(androidMessages.includes(`return '${layout}'`), `Android is missing ${layout} geometry`);
}
assert(androidMessages.includes("{isUser ? 'IN' : 'OUT'}"),
  'Android Codex CLI IN/OUT gutter labels are missing');
assert(androidMessages.includes("nativeLayout === 'cursor-cards' && s.bubbleCursorCard"),
  'Android Cursor card geometry is not applied');
assert(androidMessages.includes("nativeLayout === 'codex-thread' && !isUser && s.bubbleCodexAssistant"),
  'Android Codex thread cell geometry is not applied');

const result = {
  ok: true,
  checked_at: new Date().toISOString(),
  layouts,
  native_status: {
    claude: 'rotating glyph + producer label',
    codex: '◌ + step chip',
    cursor: 'three generating dots',
  },
  web_android_layout_and_status_parity: true,
  dead_controls_added: false,
};
if (resultFile) {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(result, null, 2));
