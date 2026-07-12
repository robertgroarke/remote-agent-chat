#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const app = read('frontend/app.jsx');
const hooks = read('frontend/hooks.jsx');
const markdown = read('frontend/markdown.js');
const styles = read('frontend/styles.css');
const bundle = read('frontend/dist/bundle.js');
const indexHtml = read('frontend/index.html');
const serviceWorker = read('frontend/sw.js');

for (const forbidden of [
  'TRANSCRIPT_RENDER_TAIL_LIMIT',
  'CODEX_TRANSCRIPT_RENDER_TAIL_LIMIT',
  'Rendering latest',
  'Return to latest only',
  'hiddenLoadedMessageCount',
]) {
  assert(!app.includes(forbidden), `transcript auto-windowing remains: ${forbidden}`);
}

assert.match(app, /function TranscriptDisclosure\([\s\S]*?React\.useState\(true\)/);
assert.match(app, /<details[\s\S]*?open=\{open\}[\s\S]*?onToggle=/);
assert((app.match(/<TranscriptDisclosure\b/g) || []).length >= 4,
  'thinking, tool, terminal, and file-change blocks must use expanded disclosures');

const messagesIndex = app.indexOf('className={`messages harness-theme');
const footerIndex = app.indexOf('className="transcript-live-footer"');
const inputIndex = app.indexOf('<div className="input-area"');
assert(messagesIndex >= 0 && footerIndex > messagesIndex && inputIndex > footerIndex,
  'live task/activity footer must be in document flow between transcript and composer');
assert.match(app, /data-agent-type=\{activeSessionMeta\?\.agent_type \|\| 'default'\}/,
  'transcript root must expose its active harness identity');
assert.match(app, /\['claude_cli', 'codex_cli', 'cursor_cli'\]\.includes\(activeSessionMeta\?\.agent_type\)/,
  'only CLI harnesses should force terminal-style assistant monospace');
assert.match(app, /const defaultCollapsed = false;/,
  'task lists must not auto-collapse based on length');
assert.match(app, /inline-error-prompt-title/,
  'inline Codex notices must render their native title');
assert.match(app, /activity-goal-objective[^\n]*\{goal\.objective\}/,
  'goal status rows must render the native objective as visible text');
assert(!app.includes("qm.content.substring(0, 77)"),
  'queued Codex content must not be truncated at 80 characters');
assert(!app.includes('Open this Claude CLI session in a native command window'),
  'native-window labels must name the selected CLI harness');
assert.match(app, /Open this \$\{agentTypeLabel\(activeSessionMeta\?\.agent_type\)/,
  'native-window labels must derive the visible harness name');
assert.match(app, /function formatGoalElapsed\(goal, nowMs, activity\)[\s\S]*?const liveAnchor = Math\.max\([\s\S]*?activityIsLive/,
  'goal elapsed time must use the current active-task anchor, not idle wall-clock time');
const goalFormatterSource = app.match(/function formatGoalElapsed\(goal, nowMs, activity\) \{[\s\S]*?\n\}/)?.[0];
assert(goalFormatterSource, 'goal elapsed formatter source is missing');
const testGoalElapsed = new Function('formatClockDuration', `${goalFormatterSource}; return formatGoalElapsed;`)(
  seconds => `${Math.floor(seconds / 60)}m`,
);
const goalNow = Date.now();
assert.strictEqual(
  testGoalElapsed(
    { status: 'active', time_used_seconds: 521, updated_at: new Date(goalNow - 7 * 86400000).toISOString() },
    goalNow,
    { kind: 'generating', startedAt: new Date(goalNow - 10000).toISOString() },
  ),
  '8m',
  'goal elapsed formatter must exclude idle wall-clock time before the current task',
);

assert.match(markdown, /const collapsible = false;/,
  'code blocks must render at full height');
assert.match(markdown, /const collapsed = !hasContent;/,
  'tool blocks with content must initialize expanded');
assert.match(markdown, /file-changes-toggle[^\n]*aria-expanded="true"/,
  'file-change sections must initialize expanded');

assert.match(styles, /\.transcript-live-footer\s*\{[\s\S]*?display:\s*flex;[\s\S]*?position:\s*relative;/);
assert.match(hooks, /t === 'message_delivered'[\s\S]*?t === 'proxy_send_result'[\s\S]*?msg\.result === 'delivered'/,
  'web client must consume canonical and raw proxy delivery results');
assert.match(hooks, /t === 'message_failed'[\s\S]*?t === 'proxy_send_result'[\s\S]*?msg\.result === 'failed'/,
  'web client must consume canonical and raw proxy failure results');
assert.match(app, /status === 'delivered'[\s\S]*?Delivered to agent/,
  'web delivery status must render proxy-confirmed delivery');
for (const harness of ['claude', 'codex', 'codex-desktop', 'cursor', 'continue', 'antigravity-v2', 'claude_cli', 'codex_cli', 'cursor_cli']) {
  assert(styles.includes(`.harness-theme-${harness}`), `missing transcript theme pack for ${harness}`);
}
const continueTheme = styles.match(/\.harness-theme-continue,[\s\S]*?\n\}/)?.[0] || '';
assert.match(continueTheme, /--harness-body-font:\s*system-ui/);
assert.match(continueTheme, /--harness-body-size:\s*14px/);
assert.match(continueTheme, /--harness-body-line:\s*21px/);
assert.match(continueTheme, /--harness-code-size:\s*14px/);
assert.match(continueTheme, /--harness-code-line:\s*21px/);
for (const token of ['--harness-body-font', '--harness-body-size', '--harness-body-line', '--harness-code-font', '--harness-thinking']) {
  assert(styles.includes(token), `missing harness theme token ${token}`);
}
assert.match(styles, /\.activity-command code\s*\{[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/);
const subagentRule = styles.match(/\.subagent-prompt\s*\{([\s\S]*?)\}/)?.[1] || '';
assert(subagentRule && !/line-clamp|text-overflow:\s*ellipsis/.test(subagentRule),
  'subagent transcript content must not be line-clamped');
const queuedItemRule = styles.match(/\.queued-item-text\s*\{([\s\S]*?)\}/)?.[1] || '';
assert(queuedItemRule && /white-space:\s*pre-wrap/.test(queuedItemRule) && !/text-overflow:\s*ellipsis/.test(queuedItemRule),
  'queued Codex content must wrap in full without ellipsis');
const goalObjectiveRule = styles.match(/\.activity-goal-objective\s*\{([\s\S]*?)\}/)?.[1] || '';
assert(goalObjectiveRule && /white-space:\s*normal/.test(goalObjectiveRule) && /overflow-wrap:\s*anywhere/.test(goalObjectiveRule),
  'goal objectives must remain fully visible at narrow viewport widths');

assert(bundle.includes('transcript-live-footer'), 'compiled bundle is missing the live footer');
assert(bundle.includes('harness-theme-'), 'compiled bundle is missing per-harness transcript theming');
assert(bundle.includes('agent_started'), 'compiled bundle is missing the final send lifecycle receipt');
assert(!bundle.includes('Rendering latest'), 'compiled bundle still contains transcript auto-windowing');
const assetVersion = serviceWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
const cacheName = serviceWorker.match(/const CACHE_NAME = '([^']+)'/)?.[1];
assert(assetVersion, 'service worker is missing ASSET_VERSION');
assert(/^agent-chat-v\d+$/.test(cacheName || ''), 'service-worker cache generation is invalid');
assert(indexHtml.includes(`styles.css?v=${assetVersion}`),
  'stylesheet cachebuster does not match the service-worker asset version');
assert(indexHtml.includes(`bundle.js?v=${assetVersion}`),
  'bundle cachebuster does not match the service-worker asset version');

for (const asset of ['app.jsx', 'hooks.jsx', 'workspace-groups.js', 'styles.css', 'index.html', 'sw.js']) {
  assert.strictEqual(
    read(`relay-server/public/${asset}`),
    read(`frontend/${asset}`),
    `relay-served ${asset} is not synced with frontend source`,
  );
}
assert.strictEqual(read('relay-server/public/dist/bundle.js'), bundle,
  'relay-served bundle is not synced with the frontend build');

console.log('frontend transcript fidelity smoke: PASS');
