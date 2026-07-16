#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { assertAssetPairsSynced } = require('./frontend-asset-sync');

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
const inputIndex = app.indexOf('className={`input-area');
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
assert.match(app, /live-goal-objective[^\n]*\{goalText \|\| 'Active goal'\}/,
  'goal status rows must render the native objective as visible text');
const liveOrder = ['data-live-channel="current"', 'data-live-channel="thinking"', 'data-live-channel="step"', 'data-live-channel="goal"', 'data-live-channel="usage"']
  .map(marker => app.indexOf(marker));
assert(liveOrder.every((value, index) => value >= 0 && (index === 0 || value > liveOrder[index - 1])),
  'Codex live area must render narration, Thinking, step, goal, and usage in native order');
assert(!app.includes("qm.content.substring(0, 77)"),
  'queued Codex content must not be truncated at 80 characters');
assert(!app.includes('Open this Claude CLI session in a native command window'),
  'native-window labels must name the selected CLI harness');
assert.match(app, /Open this \$\{agentTypeLabel\(activeSessionMeta\?\.agent_type\)/,
  'native-window labels must derive the visible harness name');
assert.match(app, /function formatGoalElapsed\(goal, nowMs\)[\s\S]*?goal\?\.state \|\| goal\?\.status/,
  'goal elapsed time must continue from canonical goal state');
const goalFormatterSource = app.match(/function formatGoalElapsed\(goal, nowMs\) \{[\s\S]*?\n\}/)?.[0];
assert(goalFormatterSource, 'goal elapsed formatter source is missing');
const testGoalElapsed = new Function('formatClockDuration', `${goalFormatterSource}; return formatGoalElapsed;`)(
  (seconds, { includeSeconds = false } = {}) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return includeSeconds ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${minutes}m`;
  },
);
const goalNow = Date.now();
assert.strictEqual(
  testGoalElapsed(
    { state: 'active', time_used_seconds: 521, updated_at: new Date(goalNow - 7 * 86400000).toISOString() },
    goalNow,
  ),
  '10088m 41s',
  'active goal elapsed formatter must remain persistent while the agent is idle',
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
assert.match(app, /status === 'launch_accepted'[\s\S]*?user-turn receipt pending/,
  'web delivery status must distinguish native launch from native delivery');
assert.match(app, /status === 'delivered'[\s\S]*?Native user turn observed/,
  'web delivery status must render receipt-confirmed native delivery');
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
const goalObjectiveRule = styles.match(/\.live-goal-objective\s*\{([\s\S]*?)\}/)?.[1] || '';
const goalExpandedRule = styles.match(/\.live-goal-expanded\s*\{([\s\S]*?)\}/)?.[1] || '';
assert(goalObjectiveRule && /text-overflow:\s*ellipsis/.test(goalObjectiveRule) && /white-space:\s*nowrap/.test(goalObjectiveRule),
  'compact goal pill must truncate calmly at narrow viewport widths');
assert(goalExpandedRule && /white-space:\s*pre-wrap/.test(goalExpandedRule) && /overflow-wrap:\s*anywhere/.test(goalExpandedRule),
  'expanded goal content must expose the full objective');
assert.match(styles, /\.live-current-narration\s*\{[\s\S]*?margin:\s*0;/,
  'current Codex narration must remain an unboxed plain paragraph');

assert(bundle.includes('transcript-live-footer'), 'compiled bundle is missing the live footer');
assert(bundle.includes('harness-theme-'), 'compiled bundle is missing per-harness transcript theming');
assert(bundle.includes('agent_started'), 'compiled bundle is missing the final send lifecycle receipt');
assert(!bundle.includes('Rendering latest'), 'compiled bundle still contains transcript auto-windowing');
const assetVersion = serviceWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
const cacheName = serviceWorker.match(/const CACHE_NAME = '([^']+)'/)?.[1];
assert(assetVersion, 'service worker is missing ASSET_VERSION');
assert.strictEqual(cacheName, `agent-chat-${assetVersion}`,
  'service-worker cache generation must be derived from the immutable asset version');
assert(/^build-[a-f0-9]{16}$/.test(assetVersion), 'asset version must be a content-derived build identity');
assert(indexHtml.includes(`styles.css?v=${assetVersion}`),
  'stylesheet cachebuster does not match the service-worker asset version');
assert(indexHtml.includes(`bundle.js?v=${assetVersion}`),
  'bundle cachebuster does not match the service-worker asset version');

assertAssetPairsSynced(root, [
  ...['app.jsx', 'hooks.jsx', 'message-delta.js', 'workspace-groups.js', 'styles.css', 'index.html', 'sw.js']
    .map(asset => [`frontend/${asset}`, `relay-server/public/${asset}`]),
  ['frontend/dist/bundle.js', 'relay-server/public/dist/bundle.js'],
]);

console.log('frontend transcript fidelity smoke: PASS');
