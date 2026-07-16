#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('../frontend/node_modules/playwright-core');
const pixelmatch = require('../frontend/node_modules/pixelmatch');
const { PNG } = require('../frontend/node_modules/pngjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GOLDEN_DIR = path.join(ROOT, 'evidence', 'harness-maturity', 'visual-goldens');
const AGENTS = [
  'claude',
  'codex',
  'codex-desktop',
  'cursor',
  'continue',
  'antigravity-v2',
  'claude_cli',
  'codex_cli',
  'cursor_cli',
];
const BLOCKS = [
  'markdown',
  'thinking',
  'tool_call',
  'tool_result',
  'terminal',
  'file_changes',
  'artifact',
  'prompt',
  'plan',
  'queued_message',
  'notice',
  'error',
  'status',
];
const LIVE_STATUS_AGENTS = ['codex', 'codex-desktop', 'codex_cli'];
const LIVE_STATUS_CASES = ['current_status', 'thinking', 'step', 'goal', 'usage', 'all', 'provisional'];
const SIDEBAR_CASES = ['ordered'];
const LAYOUT_AGENTS = ['claude', 'codex', 'codex-desktop', 'cursor', 'codex_cli'];
const LAYOUT_CASES = ['message_layout'];
const COMPOSER_AGENTS = ['claude', 'codex', 'codex-desktop', 'cursor', 'codex_cli'];
const COMPOSER_CASES = ['composer_chrome'];
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};
const THEMES = ['dark', 'light'];

function parseArgs(argv) {
  const out = {
    updateGoldens: false,
    agent: '',
    theme: '',
    threshold: 0.1,
    maxDiffRatio: 0.01,
    goldenDir: DEFAULT_GOLDEN_DIR,
    outputDir: path.join(ROOT, 'evidence', 'harness-maturity', new Date().toISOString().slice(0, 10), 'visual-regression'),
    resultFile: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--update-goldens') out.updateGoldens = true;
    else if (arg === '--agent') out.agent = String(argv[++i] || '');
    else if (arg === '--theme') out.theme = String(argv[++i] || '');
    else if (arg === '--threshold') out.threshold = Number(argv[++i]);
    else if (arg === '--max-diff-ratio') out.maxDiffRatio = Number(argv[++i]);
    else if (arg === '--golden-dir') out.goldenDir = path.resolve(argv[++i]);
    else if (arg === '--output-dir') out.outputDir = path.resolve(argv[++i]);
    else if (arg === '--result-file') out.resultFile = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.agent && !AGENTS.includes(out.agent)) throw new Error(`Unknown agent: ${out.agent}`);
  if (out.theme && !THEMES.includes(out.theme)) throw new Error(`Unknown theme: ${out.theme}`);
  if (!(out.threshold >= 0 && out.threshold <= 1)) throw new Error('--threshold must be between 0 and 1');
  if (!(out.maxDiffRatio >= 0 && out.maxDiffRatio <= 1)) throw new Error('--max-diff-ratio must be between 0 and 1');
  if (!out.resultFile) out.resultFile = path.join(out.outputDir, 'visual-regression-result.json');
  return out;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const chrome = candidates.find(candidate => fs.existsSync(candidate));
  if (!chrome) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return chrome;
}

function slug(agent) {
  return agent.replace(/[^a-z0-9_-]/gi, '-');
}

function fileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function fixtureHtml(css) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${css}</style>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; height: auto; background: var(--bg); color: var(--text); }
    body { display: block; position: static; width: auto; overflow: visible; }
    .visual-fixture { width: min(760px, calc(100vw - 24px)); margin: 12px auto; }
    .visual-fixture .fixture-block { margin: 0 0 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); }
    /* Keep later locator screenshots on the established pixel phase when the
       Codex Desktop terminal case changes semantic height. Margins are outside
       the terminal locator screenshot; only the 9/16px fractional remainder
       from the native-flat height delta is preserved. */
    .visual-fixture.harness-theme-codex-desktop [data-visual-block="terminal"] { margin-bottom: 12.5625px; }
    /* Claude's native IN/OUT table is shorter than the former generic terminal
       disclosure. Preserve the established pixel phase of later independent
       locators; this compensating margin is outside the terminal screenshot. */
    .visual-fixture.harness-theme-claude [data-visual-block="terminal"] { margin-bottom: 84.46875px; }
    /* The native-flat Antigravity error is shorter than the former shared
       card. Keep later independent locator captures on their established
       pixel phase; this margin is outside the error locator screenshot. */
    .visual-fixture.harness-theme-antigravity-v2 [data-visual-block="error"] { margin-bottom: 33.75px; }
    /* Cursor CLI's two-line native terminal error has different desktop and
       mobile heights than the shared alert fixture. These outside margins
       preserve the established pixel phase of later independent locators. */
    .visual-fixture.harness-theme-cursor_cli [data-visual-block="error"] { margin-bottom: 14.859375px; }
    /* Claude CLI's native-flat tool rows and task list are shorter than the
       former shared disclosures. Keep every later independent locator on its
       approved pixel phase; these margins sit outside the captured rows. */
    :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="tool_call"],
    :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="tool_result"] { margin-bottom: 28.578125px; }
    :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="plan"] { margin-bottom: 14.578125px; }
    /* Claude's observed native action prompt is substantially shorter than the
       former questionnaire fixture. Keep independent locator captures after it
       on the established device-pixel phase; this margin remains outside the
       prompt locator screenshot. */
    :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude [data-visual-block="prompt"] { margin-bottom: 300.671875px; }
    :root[data-theme="light"] .visual-fixture.harness-theme-claude [data-visual-block="prompt"] { margin-bottom: 267.546875px; }
    /* Cursor's current flat light edit summary is 61px shorter than the former
       detailed diff card. Keep later independent locators on their approved
       pixel phase; the compensating margin remains outside this screenshot. */
    :root[data-theme="light"] .visual-fixture.harness-theme-cursor [data-visual-block="file_changes"] { margin-bottom: 73.5px; }
    @media (max-width: 600px) {
      :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude [data-visual-block="prompt"] { margin-bottom: 267.28125px; }
      :root[data-theme="light"] .visual-fixture.harness-theme-claude [data-visual-block="prompt"] { margin-bottom: 226.15625px; }
    }
    .fixture-label { margin-bottom: 9px; color: var(--muted); font: 600 11px/1.3 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; }
    .visual-fixture .message { max-width: none; margin: 0; }
    .visual-fixture .message-body { padding-left: 0; }
    .visual-fixture .user-text { margin-bottom: 8px; }
    .visual-fixture table { width: 100%; }
    .visual-sidebar { width: min(340px, 100%); padding: 8px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
    .visual-sidebar .session-list { max-height: none; overflow: visible; }
    .visual-sidebar .session-card { cursor: default; }
    @media (max-width: 520px) {
      .visual-fixture { width: calc(100vw - 16px); margin: 8px auto; }
      .visual-fixture .fixture-block { padding: 9px; margin-bottom: 8px; }
      .visual-fixture.harness-theme-codex-desktop [data-visual-block="terminal"] { margin-bottom: 8.5625px; }
      .visual-fixture.harness-theme-claude [data-visual-block="terminal"] { margin-bottom: 80.46875px; }
      .visual-fixture.harness-theme-antigravity-v2 [data-visual-block="error"] { margin-bottom: 52.5px; }
      .visual-fixture.harness-theme-cursor_cli [data-visual-block="error"] { margin-bottom: 17.28125px; }
      :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="tool_call"],
      :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="tool_result"] { margin-bottom: 24.578125px; }
      :root:not([data-theme="light"]) .visual-fixture.harness-theme-claude_cli [data-visual-block="plan"] { margin-bottom: 10.578125px; }
      :root[data-theme="light"] .visual-fixture.harness-theme-cursor [data-visual-block="file_changes"] { margin-bottom: 69.5px; }
    }
  </style>
</head>
<body>
  <main id="fixture"></main>
  <script>
    const params = new URLSearchParams(location.search);
    const agent = params.get('agent') || 'codex';
    const theme = params.get('theme') || 'dark';
    document.documentElement.dataset.theme = theme;
    const safeAgent = agent.replace(/[^a-z0-9_-]/gi, '-');
    const label = agent.replace(/[-_]/g, ' ');
    const wrap = (type, body) => '<section class="fixture-block" data-visual-block="' + type + '"><div class="fixture-label">' + label + ' · ' + type.replace(/_/g, ' ') + '</div>' + body + '</section>';
    const wrapLive = (type, body) => '<section class="fixture-block" data-live-status-case="' + type + '"><div class="fixture-label">' + label + ' · live ' + type + '</div><div class="transcript-live-footer"><div class="composer-live-status-strip">' + body + '</div></div></section>';
    const wrapProvisional = body => '<section class="fixture-block" data-live-status-case="provisional"><div class="fixture-label">' + label + ' · provisional stream</div>' + body + '</section>';
    const currentRow = '<div class="live-current-status answer" data-live-channel="current"><p class="live-current-narration">The audit found the concrete Codex defects. I’ll fix the canonical data shape first, then verify the native stack.</p></div>';
    const thinkingRow = '<div class="live-thinking-row" data-live-channel="thinking"><div class="live-thinking-heading"><div class="activity-spinner"></div><span class="live-status-label">Thinking</span><span class="live-status-meta">18s</span></div><div class="live-thinking-text">Checking the retained transcript before changing the parser.</div></div>';
    const stepRow = '<div class="live-step-wrap" data-live-channel="step"><div class="live-step-chip"><div class="activity-spinner"></div><span>Step 1 / 4</span><span class="live-step-diff">· +9135 −3</span></div></div>';
    const goalRow = '<details class="live-goal-row" data-live-channel="goal"><summary><span class="live-status-icon">⛳</span><span class="live-status-label">Pursuing goal</span><span class="live-goal-objective">Finish production maturity across every supported harness</span><span class="live-status-meta">1d 15h 35m 35s</span></summary><div class="live-goal-expanded">Finish production maturity across every supported harness</div></details>';
    const usageRow = '<div class="live-usage-banner" data-live-channel="usage"><div class="live-usage-title">You’re out of Codex and Work usage</div><div class="live-usage-detail">Your rate limit resets on Jul 17, 11:02 PM.</div></div>';
    const provisionalClass = agent.endsWith('_cli') ? ' monospace' : '';
    const provisionalBadge = agent === 'codex_cli' ? 'CLI' : agent === 'codex-desktop' ? 'CD' : 'CX';
    const liveStatusCases = [
      wrapLive('current_status', '<div class="live-status-stack pinned">' + currentRow + '</div>'),
      wrapLive('thinking', '<div class="live-status-stack pinned">' + thinkingRow + '</div>'),
      wrapLive('step', '<div class="live-status-stack pinned">' + stepRow + '</div>'),
      wrapLive('goal', '<div class="live-status-stack pinned">' + goalRow + '</div>'),
      wrapLive('usage', '<div class="live-status-stack pinned">' + usageRow + '</div>'),
      wrapLive('all', '<div class="live-status-stack pinned">' + currentRow + thinkingRow + stepRow + goalRow + usageRow + '</div>'),
      wrapProvisional('<div class="message assistant live-draft provisional-stream' + provisionalClass + '" data-message-id="fixture-stream" data-stream-open="true"><div class="assistant-gutter"><div class="agent-badge transcript-agent-badge">' + provisionalBadge + '</div></div><div class="assistant-content"><div class="message-role"><span>' + label + '</span></div><div class="provisional-stream-text">Streaming the answer in small native chunks without repainting the settled transcript.</div><span class="provisional-stream-caret"></span></div></div>'),
    ];
    const sidebarCase = '<section class="fixture-block" data-sidebar-case="ordered"><div class="fixture-label">sidebar &middot; chat summaries + harness subtitles</div><aside class="visual-sidebar"><div class="session-list"><div class="session-group"><button class="session-group-header"><span class="session-group-caret">v</span><span class="session-group-name">Remote Agent Chat</span><span class="session-group-alert">!</span><span class="session-group-working"></span><span class="session-group-count">3</span></button><div class="session-group-items"><div class="session-group-items-inner"><div class="session-card"><div class="agent-badge">CC</div><div class="session-card-body"><div class="session-card-name">Choose validation scope</div><div class="session-card-sub perm-active">Claude Code &middot; Permission required</div></div><div class="session-card-right"><div class="session-card-perm-badge">&#9888;</div></div></div><div class="session-card"><div class="agent-badge">CX</div><div class="session-card-body"><div class="session-card-name">Restore harness maturity</div><div class="session-card-sub">Codex &middot; Running tests</div></div><div class="session-card-right"><div class="session-card-spinner"></div></div></div><div class="session-card"><div class="agent-badge">CLI</div><div class="session-card-body"><div class="session-card-name">Older completed audit</div><div class="session-card-sub">Codex CLI</div></div></div></div></div></div></div><div class="session-group"><button class="session-group-header"><span class="session-group-caret">v</span><span class="session-group-name">Secondary Project</span><span class="session-group-count">1</span></button><div class="session-group-items"><div class="session-group-items-inner"><div class="session-card"><div class="agent-badge">CR</div><div class="session-card-body"><div class="session-card-name">Idle reference</div><div class="session-card-sub">Cursor</div></div></div></div></div></div></div></aside></section>';
    const layoutMap = { claude: 'claude-document', codex: 'codex-thread', 'codex-desktop': 'codex-thread', cursor: 'cursor-cards', codex_cli: 'codex-terminal' };
    const layoutName = layoutMap[agent] || 'unified-flow';
    const layoutCase = '<section class="fixture-block" data-layout-case="message_layout"><div class="fixture-label">' + label + ' &middot; native message layout</div><div class="harness-theme harness-theme-' + safeAgent + ' message-layout-fixture" data-layout="' + layoutName + '"><article class="message user"><div class="user-gutter"><span class="user-glyph"></span></div><div class="user-content"><div class="message-role"><span>You</span></div><div class="user-text">Review the native layout and keep the controls grounded.</div></div></article><article class="message assistant"><div class="assistant-gutter"><span class="transcript-agent-badge"></span></div><div class="assistant-content"><div class="message-role"><span>' + label + '</span></div><div class="message-body"><p>The transcript keeps harness-specific message geometry instead of one generic bubble.</p></div><div class="content-blocks"><details class="content-block content-block-tool" open><summary><span>Run validation</span><span class="content-block-status running">running</span></summary><pre class="content-block-pre">scope: production</pre></details><details class="content-block content-block-tool-result" open><summary><span>Validation result</span><span class="content-block-status completed">completed</span></summary><pre class="content-block-pre">42 checks passed</pre></details><details class="content-block content-block-file-change" open><summary><span>1 File +8 -2</span></summary><div class="content-block-file-list"><div class="content-block-file-row"><span class="content-block-file-path">src/harness.js</span><span class="content-block-add">+8</span><span class="content-block-del">-2</span></div></div><div class="content-block-actions"><span class="content-block-action-label">Undo</span><span class="content-block-action-label">Keep</span></div></details></div></div></article></div></section>';
    const composerSkinMap = { claude: 'claude', codex: 'codex', 'codex-desktop': 'codex', cursor: 'cursor', codex_cli: 'codex-cli' };
    const composerControlMap = {
      claude: '<label class="composer-setting-label" data-control="permission"><span class="composer-setting-key">Permission</span><select class="composer-setting-select"><option>Edit automatically</option></select></label><label class="composer-setting-label" data-control="model"><span class="composer-setting-key">Model</span><select class="composer-setting-select"><option>Claude Sonnet 4</option></select></label>',
      codex: '<label class="composer-setting-label" data-control="model"><span class="composer-setting-key">Model</span><select class="composer-setting-select"><option>GPT-5</option></select></label><label class="composer-setting-label" data-control="permission"><span class="composer-setting-key">Access</span><select class="composer-setting-select"><option>Workspace</option></select></label><label class="composer-setting-label" data-control="effort"><span class="composer-setting-key">Effort</span><select class="composer-setting-select"><option>High</option></select></label><label class="composer-setting-label" data-control="speed"><span class="composer-setting-key">Speed</span><select class="composer-setting-select"><option>Standard</option></select></label>',
      'codex-desktop': '<label class="composer-setting-label" data-control="model"><span class="composer-setting-key">Model</span><select class="composer-setting-select"><option>GPT-5</option></select></label><label class="composer-setting-label" data-control="permission"><span class="composer-setting-key">Access</span><select class="composer-setting-select"><option>Workspace</option></select></label><label class="composer-setting-label" data-control="effort"><span class="composer-setting-key">Effort</span><select class="composer-setting-select"><option>High</option></select></label><label class="composer-setting-label" data-control="speed"><span class="composer-setting-key">Speed</span><select class="composer-setting-select"><option>Standard</option></select></label>',
      cursor: '<label class="composer-setting-label" data-control="mode"><span class="composer-setting-key">Mode</span><select class="composer-setting-select"><option>Agent</option></select></label><label class="composer-setting-label" data-control="model"><span class="composer-setting-key">Model</span><select class="composer-setting-select"><option>Auto</option></select></label>',
      codex_cli: '<label class="composer-setting-label" data-control="model"><span class="composer-setting-key">Model</span><select class="composer-setting-select"><option>gpt-5</option></select></label><label class="composer-setting-label" data-control="permission"><span class="composer-setting-key">Access</span><select class="composer-setting-select"><option>On request</option></select></label><label class="composer-setting-label" data-control="effort"><span class="composer-setting-key">Effort</span><select class="composer-setting-select"><option>High</option></select></label>',
    };
    const composerSkin = composerSkinMap[agent] || 'default';
    const composerCase = '<section class="fixture-block" data-composer-case="composer_chrome"><div class="fixture-label">' + label + ' &middot; native composer chrome</div><div class="input-area composer-skin-' + composerSkin + '" data-composer-skin="' + composerSkin + '"><span class="attach-btn" aria-hidden="true">+</span><div class="input-col"><div class="textarea-row"><textarea rows="1" placeholder="Message..."></textarea><div class="textarea-btns"><button class="composer-gear-btn">&#9881;</button><button class="send-btn">&#8593;</button></div></div><div class="composer-settings is-open">' + (composerControlMap[agent] || '') + '<span class="composer-workspace">&#8962; Remote Agent Chat</span></div></div></div></section>';
    const thinkingBlock = agent === 'codex'
      ? '<div class="content-blocks"><div class="content-block content-block-thinking-native"><div class="message-body"><p>Inspecting the current harness state before acting.</p></div></div></div>'
      : agent === 'codex-desktop'
        ? '<div class="content-blocks"><div class="content-block content-block-thinking-codex-desktop"><span>Worked for 19m 5s</span><span class="content-block-thinking-codex-desktop-chevron" aria-hidden="true">⌄</span></div></div>'
        : '<div class="content-blocks"><details class="content-block content-block-thinking" open><summary>Thinking</summary><div class="message-body"><p>Inspecting the current harness state before acting.</p></div></details></div>';
    const terminalBlock = agent === 'claude'
      ? '<div class="content-blocks"><div class="content-block content-block-terminal-claude"><div class="content-block-terminal-claude-header"><span class="content-block-terminal-claude-dot completed"></span><strong>Bash</strong><span>Run tests</span></div><div class="content-block-terminal-claude-body"><div class="content-block-terminal-claude-row"><span>IN</span><pre>npm test</pre></div><div class="content-block-terminal-claude-row"><span>OUT</span><pre>42 passed, 0 failed</pre></div></div></div></div>'
      : agent === 'codex-desktop'
        ? '<div class="content-blocks"><details class="content-block content-block-terminal-codex-desktop" open><summary><span>Ran commands</span></summary><pre class="content-block-pre">$ npm test\\n42 passed, 0 failed\\nexit code: 0</pre></details></div>'
        : '<div class="content-blocks"><details class="content-block content-block-terminal" open><summary><span>Terminal</span><span class="content-block-status">exit 0</span></summary><pre class="content-block-pre">cwd: C:\\\\workspace\\n\\n$ npm test\\n\\n42 passed, 0 failed\\n\\nexit code: 0</pre></details></div>';
    const errorBlock = agent === 'antigravity-v2'
      ? '<div class="content-blocks"><details class="content-block content-block-error content-block-error-antigravity-v2"><summary><span class="content-block-error-antigravity-v2-label">Error</span><span class="content-block-error-antigravity-v2-message">Agent execution terminated due to error</span></summary></details></div>'
      : agent === 'cursor_cli'
        ? '<div class="content-blocks"><div class="content-block content-block-error"><div class="content-block-title">Warning</div><div class="message-body"><p><span class="cursor-cli-native-error-primary">The provided API key is invalid.</span><br><span class="cursor-cli-native-error-secondary">Please check you have the right key, create a new one, or authenticate without it.</span></p></div></div></div>'
        : '<div class="content-blocks"><div class="content-block content-block-error"><div class="content-block-title">Harness error</div><div class="message-body"><p>The native selector changed and the action was not attempted.</p></div></div></div>';
    const promptBlock = agent === 'claude'
      ? '<div class="permission-card permission-card-claude" role="dialog" aria-label="Claude Code permission prompt"><div class="permission-title permission-title-claude">Allow this bash command?</div><pre class="permission-command-claude">powershell -NoProfile -Command &quot;Write-Output RAC_CLAUDE_PERMISSION&quot;</pre><div class="permission-body permission-body-claude">Echo permission test string</div><div class="permission-actions"><button class="permission-action selected" aria-pressed="true"><kbd class="permission-key-hint">1</kbd><span>Yes</span></button><button class="permission-action" aria-pressed="false"><kbd class="permission-key-hint">2</kbd><span>Yes, allow powershell -NoPro&hellip; for <span class="permission-choice-destination-claude">this project (just you)</span></span></button><button class="permission-action" aria-pressed="false"><kbd class="permission-key-hint">3</kbd><span>No</span></button></div><textarea class="permission-alternate-input" rows="1" placeholder="Tell Claude what to do instead" aria-label="Tell Claude what to do instead"></textarea><div class="permission-keyboard-help">Esc to cancel</div></div>'
      : '<div class="permission-card"><div class="permission-eyebrow">Question</div><div class="permission-title">Choose implementation details</div><div class="permission-body">Select one approach and any validation checks.</div><div class="permission-actions permission-question-list"><fieldset class="permission-question"><legend>Implementation approach</legend><div class="permission-question-options"><button class="permission-action"><span class="permission-choice-marker">○</span><span class="permission-choice-copy"><span>Fix the launcher script</span><span class="permission-action-desc">Repair the existing guarded launcher.</span></span></button><div class="permission-question-option"><button class="permission-action selected"><span class="permission-choice-marker">●</span><span class="permission-choice-copy"><span>Other</span><span class="permission-action-desc">Provide a custom approach.</span></span></button><input class="permission-other-input" value="Bounded fallback" aria-label="Other answer"></div></div></fieldset><fieldset class="permission-question"><legend>Validation checks</legend><div class="permission-question-options"><button class="permission-action selected"><span class="permission-choice-marker">✓</span><span class="permission-choice-copy"><span>Tests</span><span class="permission-action-desc">Run the focused suite.</span></span></button><button class="permission-action"><span class="permission-choice-marker">□</span><span class="permission-choice-copy"><span>Docs</span><span class="permission-action-desc">Update operator guidance.</span></span></button></div></fieldset></div><button class="permission-question-submit">Submit answers</button></div>';
    const fileChangesBlock = agent === 'cursor' && theme === 'light'
      ? '<div class="content-blocks"><div class="content-block content-block-file-change content-block-file-change-cursor-summary"><span>Edited 6 files</span><span class="content-block-add">+124</span><span class="content-block-del">-7</span></div></div>'
      : '<div class="content-blocks"><details class="content-block content-block-file-change" open><summary><span>File changes 2 files +12 -3</span><span class="content-block-status completed">completed</span></summary><div class="content-block-file-list"><div class="content-block-file-row"><span class="content-block-file-path">src/harness.js</span><span class="content-block-add">+8</span><span class="content-block-del">-2</span></div><div class="content-block-file-row"><span class="content-block-file-path">tests/harness.test.js</span><span class="content-block-add">+4</span><span class="content-block-del">-1</span></div></div></details></div>';
    const blocks = [
      wrap('markdown', '<article class="message user"><div class="user-gutter"><span class="user-glyph"></span></div><div class="user-content"><div class="user-text">Please review the production harness output.</div></div></article><article class="message assistant"><div class="assistant-gutter"><span class="transcript-agent-badge"></span></div><div class="assistant-content"><div class="message-body"><div class="content-blocks"><div class="content-block content-block-markdown"><h2>Release check</h2><p>Body text with <strong>emphasis</strong>, <code>inlineCode()</code>, and a <a href="#">native link</a>.</p><ul><li>First fidelity item</li><li>Second fidelity item</li></ul><blockquote>Rendered in native order.</blockquote><pre><code>const ready = true;\\nconsole.log(ready);</code></pre><table><thead><tr><th>Surface</th><th>State</th></tr></thead><tbody><tr><td>Transcript</td><td>Ready</td></tr></tbody></table></div></div></div></div></article>'),
      wrap('thinking', thinkingBlock),
      wrap('tool_call', '<div class="content-blocks"><details class="content-block content-block-tool" open><summary><span>Tool: validate harness</span><span class="content-block-status running">running</span></summary><pre class="content-block-pre">input: { &quot;scope&quot;: &quot;production&quot; }\\nstatus: collecting evidence</pre></details></div>'),
      wrap('terminal', terminalBlock),
      wrap('file_changes', fileChangesBlock),
      wrap('artifact', '<div class="content-blocks"><div class="content-block content-block-artifact"><div class="content-block-title">Evidence artifact</div><div class="message-body"><p><code>evidence/production-result.json</code></p></div></div></div>'),
      wrap('prompt', promptBlock),
      wrap('error', errorBlock),
      wrap('tool_result', '<div class="content-blocks"><details class="content-block content-block-tool-result" open><summary><span>Tool result: validate harness</span><span class="content-block-status completed">completed</span></summary><pre class="content-block-pre">result: 42 checks passed<br>evidence: production-result.json</pre></details></div>'),
      wrap('plan', '<div class="content-blocks"><div class="content-block content-block-plan"><div class="content-block-title">Production plan · 1/3 complete</div><ol class="content-block-plan-list"><li class="content-block-plan-item completed"><span class="content-block-plan-marker">✓</span><span>Inspect the native surface</span></li><li class="content-block-plan-item in_progress"><span class="content-block-plan-marker">•</span><span>Validate transcript parity</span></li><li class="content-block-plan-item pending"><span class="content-block-plan-marker">○</span><span>Record production evidence</span></li></ol></div></div>'),
      wrap('queued_message', '<div class="content-blocks"><div class="content-block content-block-queued-message"><span class="content-block-queued-label">Queued message</span><span class="content-block-queued-body">Run the next guarded validation after this turn.</span></div></div>'),
      wrap('notice', '<div class="content-blocks"><div class="content-block content-block-notice warning"><div class="content-block-title">Response delayed</div><div class="message-body"><p>The harness is still working. Retry remains available without losing the turn.</p></div><div class="content-block-actions"><span class="content-block-action-label">Retry</span></div></div></div>'),
      wrap('status', '<div class="content-blocks"><div class="content-block content-block-status-chip">Working · validating transcript fidelity</div></div>'),
    ];
    document.getElementById('fixture').className = 'visual-fixture messages harness-theme harness-theme-' + safeAgent;
    document.getElementById('fixture').dataset.agentType = agent;
    document.getElementById('fixture').dataset.layout = agent === 'claude' ? 'claude-document'
      : agent === 'codex_cli' ? 'codex-terminal'
        : agent === 'cursor' ? 'cursor-cards'
          : (agent === 'codex' || agent === 'codex-desktop') ? 'codex-thread' : 'unified-flow';
    document.getElementById('fixture').innerHTML = blocks.join('') + (${JSON.stringify(['codex', 'codex-desktop', 'codex_cli'])}.includes(agent) ? liveStatusCases.join('') : '') + (agent === 'codex' ? sidebarCase : '') + (${JSON.stringify(['claude', 'codex', 'codex-desktop', 'cursor', 'codex_cli'])}.includes(agent) ? layoutCase + composerCase : '');
    document.documentElement.dataset.visualReady = 'true';
  </script>
</body>
</html>`;
}

function comparePng(actualPath, goldenPath, diffPath, threshold) {
  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  const golden = PNG.sync.read(fs.readFileSync(goldenPath));
  if (actual.width !== golden.width || actual.height !== golden.height) {
    return { pixels: actual.width * actual.height, different: actual.width * actual.height, ratio: 1, dimension_mismatch: { actual: [actual.width, actual.height], golden: [golden.width, golden.height] } };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const different = pixelmatch(actual.data, golden.data, diff.data, actual.width, actual.height, { threshold });
  if (different > 0) {
    fs.mkdirSync(path.dirname(diffPath), { recursive: true });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }
  return { pixels: actual.width * actual.height, different, ratio: different / (actual.width * actual.height) };
}

async function capturePaintedLocator(page, locator, screenshotOptions) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await locator.screenshot(screenshotOptions);
}

async function captureAll(options) {
  const tempRoot = path.join(os.tmpdir(), `remote-agent-visual-regression-${process.pid}-${Date.now()}`);
  const fixturePath = path.join(tempRoot, 'fixture.html');
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(fixturePath, fixtureHtml(fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8')), 'utf8');
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  try {
    const page = await browser.newPage();
    const agents = options.agent ? [options.agent] : AGENTS;
    const themes = options.theme ? [options.theme] : THEMES;
    const result = {
      ok: true,
      mode: options.updateGoldens ? 'update-goldens' : 'compare',
      generated_at: new Date().toISOString(),
      chrome: browser.version(),
      driver: 'playwright-core',
      threshold: options.threshold,
      max_diff_ratio: options.maxDiffRatio,
      agents,
      themes,
      blocks: BLOCKS,
      live_status_agents: LIVE_STATUS_AGENTS,
      live_status_cases: LIVE_STATUS_CASES,
      sidebar_cases: SIDEBAR_CASES,
      layout_agents: LAYOUT_AGENTS,
      layout_cases: LAYOUT_CASES,
      composer_agents: COMPOSER_AGENTS,
      composer_cases: COMPOSER_CASES,
      viewports: VIEWPORTS,
      cases: [],
    };
    for (const agent of agents) {
      for (const theme of themes) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.goto(`${fileUrl(fixturePath)}?agent=${encodeURIComponent(agent)}&theme=${encodeURIComponent(theme)}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.visualReady === 'true');
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const renderedBlocks = await page.locator('[data-visual-block]').count();
        if (renderedBlocks !== BLOCKS.length) throw new Error(`${agent}/${theme}/${viewportName} rendered ${renderedBlocks} blocks, expected ${BLOCKS.length}`);
        for (const block of BLOCKS) {
          const name = `${slug(agent)}-${block}-${viewportName}${theme === 'dark' ? '' : `-${theme}`}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          const locator = page.locator(`[data-visual-block="${block}"]`);
          if (await locator.count() !== 1) throw new Error(`${agent}/${theme}/${viewportName}/${block} is not uniquely rendered`);
          await capturePaintedLocator(page, locator, { path: actualPath, animations: 'disabled' });
          let comparison;
          if (options.updateGoldens) {
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'updated', pixels: null, different: 0, ratio: 0 };
          } else if (!fs.existsSync(goldenPath)) {
            comparison = { status: 'missing-golden', pixels: null, different: null, ratio: 1 };
            result.ok = false;
          } else {
            const metrics = comparePng(actualPath, goldenPath, diffPath, options.threshold);
            comparison = { status: metrics.ratio <= options.maxDiffRatio ? 'pass' : 'fail', ...metrics };
            if (comparison.status === 'fail') result.ok = false;
          }
          result.cases.push({ agent, theme, block, viewport: viewportName, actual: path.relative(ROOT, actualPath), golden: path.relative(ROOT, goldenPath), diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath) : null, ...comparison });
        }
        const expectedLiveCases = LIVE_STATUS_AGENTS.includes(agent) ? LIVE_STATUS_CASES.length : 0;
        const renderedLiveCases = await page.locator('[data-live-status-case]').count();
        if (renderedLiveCases !== expectedLiveCases) {
          throw new Error(`${agent}/${theme}/${viewportName} rendered ${renderedLiveCases} live-status cases, expected ${expectedLiveCases}`);
        }
        for (const liveCase of expectedLiveCases ? LIVE_STATUS_CASES : []) {
          const block = `live_${liveCase}`;
          const name = `${slug(agent)}-${block}-${viewportName}${theme === 'dark' ? '' : `-${theme}`}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          const locator = page.locator(`[data-live-status-case="${liveCase}"]`);
          if (await locator.count() !== 1) throw new Error(`${agent}/${theme}/${viewportName}/${block} is not uniquely rendered`);
          await capturePaintedLocator(page, locator, { path: actualPath, animations: 'disabled' });
          let comparison;
          if (options.updateGoldens) {
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'updated', pixels: null, different: 0, ratio: 0 };
          } else if (!fs.existsSync(goldenPath)) {
            comparison = { status: 'missing-golden', pixels: null, different: null, ratio: 1 };
            result.ok = false;
          } else {
            const metrics = comparePng(actualPath, goldenPath, diffPath, options.threshold);
            comparison = { status: metrics.ratio <= options.maxDiffRatio ? 'pass' : 'fail', ...metrics };
            if (comparison.status === 'fail') result.ok = false;
          }
          result.cases.push({ agent, theme, block, live_status_case: liveCase, viewport: viewportName, actual: path.relative(ROOT, actualPath), golden: path.relative(ROOT, goldenPath), diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath) : null, ...comparison });
        }
        const expectedSidebarCases = agent === 'codex' ? SIDEBAR_CASES.length : 0;
        const renderedSidebarCases = await page.locator('[data-sidebar-case]').count();
        if (renderedSidebarCases !== expectedSidebarCases) {
          throw new Error(`${agent}/${theme}/${viewportName} rendered ${renderedSidebarCases} sidebar cases, expected ${expectedSidebarCases}`);
        }
        for (const sidebarCase of expectedSidebarCases ? SIDEBAR_CASES : []) {
          const block = `sidebar_${sidebarCase}`;
          const name = `${block}-${viewportName}${theme === 'dark' ? '' : `-${theme}`}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          const locator = page.locator(`[data-sidebar-case="${sidebarCase}"]`);
          if (await locator.count() !== 1) throw new Error(`${agent}/${theme}/${viewportName}/${block} is not uniquely rendered`);
          await capturePaintedLocator(page, locator, { path: actualPath, animations: 'disabled' });
          let comparison;
          if (options.updateGoldens) {
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'updated', pixels: null, different: 0, ratio: 0 };
          } else if (!fs.existsSync(goldenPath)) {
            comparison = { status: 'missing-golden', pixels: null, different: null, ratio: 1 };
            result.ok = false;
          } else {
            const metrics = comparePng(actualPath, goldenPath, diffPath, options.threshold);
            comparison = { status: metrics.ratio <= options.maxDiffRatio ? 'pass' : 'fail', ...metrics };
            if (comparison.status === 'fail') result.ok = false;
          }
          result.cases.push({ agent, theme, block, sidebar_case: sidebarCase, viewport: viewportName, actual: path.relative(ROOT, actualPath), golden: path.relative(ROOT, goldenPath), diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath) : null, ...comparison });
        }
        const expectedLayoutCases = LAYOUT_AGENTS.includes(agent) ? LAYOUT_CASES.length : 0;
        const renderedLayoutCases = await page.locator('[data-layout-case]').count();
        if (renderedLayoutCases !== expectedLayoutCases) {
          throw new Error(`${agent}/${theme}/${viewportName} rendered ${renderedLayoutCases} layout cases, expected ${expectedLayoutCases}`);
        }
        for (const layoutCase of expectedLayoutCases ? LAYOUT_CASES : []) {
          const block = `layout_${layoutCase}`;
          const name = `${slug(agent)}-${block}-${viewportName}${theme === 'dark' ? '' : `-${theme}`}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          const locator = page.locator(`[data-layout-case="${layoutCase}"]`);
          if (await locator.count() !== 1) throw new Error(`${agent}/${theme}/${viewportName}/${block} is not uniquely rendered`);
          await capturePaintedLocator(page, locator, { path: actualPath, animations: 'disabled' });
          let comparison;
          if (options.updateGoldens) {
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'updated', pixels: null, different: 0, ratio: 0 };
          } else if (!fs.existsSync(goldenPath)) {
            comparison = { status: 'missing-golden', pixels: null, different: null, ratio: 1 };
            result.ok = false;
          } else {
            const metrics = comparePng(actualPath, goldenPath, diffPath, options.threshold);
            comparison = { status: metrics.ratio <= options.maxDiffRatio ? 'pass' : 'fail', ...metrics };
            if (comparison.status === 'fail') result.ok = false;
          }
          result.cases.push({ agent, theme, block, layout_case: layoutCase, viewport: viewportName, actual: path.relative(ROOT, actualPath), golden: path.relative(ROOT, goldenPath), diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath) : null, ...comparison });
        }
        const expectedComposerCases = COMPOSER_AGENTS.includes(agent) ? COMPOSER_CASES.length : 0;
        const renderedComposerCases = await page.locator('[data-composer-case]').count();
        if (renderedComposerCases !== expectedComposerCases) {
          throw new Error(`${agent}/${theme}/${viewportName} rendered ${renderedComposerCases} composer cases, expected ${expectedComposerCases}`);
        }
        for (const composerCase of expectedComposerCases ? COMPOSER_CASES : []) {
          const block = `composer_${composerCase}`;
          const name = `${slug(agent)}-${block}-${viewportName}${theme === 'dark' ? '' : `-${theme}`}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          const locator = page.locator(`[data-composer-case="${composerCase}"]`);
          if (await locator.count() !== 1) throw new Error(`${agent}/${theme}/${viewportName}/${block} is not uniquely rendered`);
          await capturePaintedLocator(page, locator, { path: actualPath, animations: 'disabled' });
          let comparison;
          if (options.updateGoldens) {
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'updated', pixels: null, different: 0, ratio: 0 };
          } else if (!fs.existsSync(goldenPath)) {
            comparison = { status: 'missing-golden', pixels: null, different: null, ratio: 1 };
            result.ok = false;
          } else {
            const metrics = comparePng(actualPath, goldenPath, diffPath, options.threshold);
            comparison = { status: metrics.ratio <= options.maxDiffRatio ? 'pass' : 'fail', ...metrics };
            if (comparison.status === 'fail') result.ok = false;
          }
          result.cases.push({ agent, theme, block, composer_case: composerCase, viewport: viewportName, actual: path.relative(ROOT, actualPath), golden: path.relative(ROOT, goldenPath), diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath) : null, ...comparison });
        }
      }
      }
    }
    return result;
  } finally {
    try { await browser.close(); } catch {}
    const safePrefix = path.join(os.tmpdir(), 'remote-agent-visual-regression-').toLowerCase();
    if (tempRoot.toLowerCase().startsWith(safePrefix)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await captureAll(options);
  fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
  fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    cases: result.cases.length,
    passed: result.cases.filter(row => row.status === 'pass' || row.status === 'updated').length,
    failed: result.cases.filter(row => row.status === 'fail').length,
    missing: result.cases.filter(row => row.status === 'missing-golden').length,
    result_file: options.resultFile,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

module.exports = { AGENTS, BLOCKS, LIVE_STATUS_AGENTS, LIVE_STATUS_CASES, SIDEBAR_CASES, LAYOUT_AGENTS, LAYOUT_CASES, COMPOSER_AGENTS, COMPOSER_CASES, VIEWPORTS, THEMES, parseArgs, fixtureHtml, comparePng, captureAll };
