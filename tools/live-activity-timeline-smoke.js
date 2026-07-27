'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isActiveActivity,
  normalizeActivityTimeline,
} = require('../relay-server/activity-timeline');

const root = path.resolve(__dirname, '..');
const checks = [];
function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
}

const first = normalizeActivityTimeline(
  {
    kind: 'thinking',
    label: 'Thinking',
    updated_at: '2026-07-11T12:00:00.000Z',
    goal: { text: 'Finish production maturity', state: 'active', time_used_seconds: 90 },
    thinking: { text: 'Inspecting the native surface.' },
    step: { current: 1, total: 4, state: 'in_progress', text: 'Inspect native surface' },
    usage: { state: 'exhausted', title: "You're out of Codex and Work usage" },
  },
  null,
  '2026-07-11T12:00:01.000Z',
);
check('first active status receives a started_at anchor', first.started_at === '2026-07-11T12:00:00.000Z');
check('thinking activity is active', isActiveActivity(first));
check('goal receives an independent stable start', first.goal.started_at === '2026-07-11T12:00:00.000Z');
check('thinking receives an independent stable start', first.thinking.since === '2026-07-11T12:00:00.000Z');

const tool = normalizeActivityTimeline(
  {
    kind: 'running_command',
    label: 'Running tests',
    updated_at: '2026-07-11T12:00:05.000Z',
    goal: { text: 'Finish production maturity', state: 'active', time_used_seconds: 95 },
    thinking: { text: 'Inspecting the native surface in more detail.' },
    current: { kind: 'tool', label: 'Running command', partial: '$ npm test' },
  },
  first,
  '2026-07-11T12:00:05.000Z',
);
check('tool label change preserves the active interval', tool.started_at === first.started_at);
check('tool activity is active', isActiveActivity(tool));
check('goal start survives active updates', tool.goal.started_at === first.goal.started_at);
check('thinking start survives streaming text updates', tool.thinking.since === first.thinking.since);
check('current output receives its own start', tool.current.since === '2026-07-11T12:00:05.000Z');

const toolPartial = normalizeActivityTimeline(
  {
    kind: 'running_command',
    label: 'Running tests',
    updated_at: '2026-07-11T12:00:07.000Z',
    goal: tool.goal,
    current: { kind: 'tool', label: 'Running command', partial: '$ npm test\n42 passed' },
  },
  tool,
);
check('streaming current output preserves its channel start', toolPartial.current.since === tool.current.since);

const explicit = normalizeActivityTimeline(
  {
    kind: 'reading_files',
    label: 'Reading files',
    started_at: '2026-07-11T11:59:58.000Z',
    updated_at: '2026-07-11T12:00:06.000Z',
  },
  tool,
);
check('producer started_at remains authoritative', explicit.started_at === '2026-07-11T11:59:58.000Z');

const idle = normalizeActivityTimeline(
  { kind: 'idle', label: '', updated_at: '2026-07-11T12:00:10.000Z' },
  explicit,
);
check('inactive status clears the elapsed anchor', idle.started_at === null);
check('inactive status clears ephemeral channels', idle.thinking === null && idle.current === null);
check('idle activity is inactive', !isActiveActivity(idle));

const restarted = normalizeActivityTimeline(
  { kind: 'generating', label: 'Working', updated_at: '2026-07-11T12:01:00.000Z' },
  idle,
);
check('a new active interval receives a new anchor', restarted.started_at === '2026-07-11T12:01:00.000Z');

const relay = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const row = fs.readFileSync(path.join(root, 'android-app', 'components', 'ActivityRow.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const protocol = fs.readFileSync(path.join(root, 'protocol.md'), 'utf8');

check('relay normalizes activity before session persistence', /activity:\s*broadcastActivity/.test(relay));
check('relay broadcasts the normalized activity', /const statusMsg = \{[\s\S]{0,320}activity:\s*broadcastActivity/.test(relay));
check('Android preserves the canonical activity object', /\.\.\.msg\.activity/.test(chat));
check('Android preserves relay streaming activity text', /msg\.thinking_content[\s\S]{0,180}msg\.activity\.thinkingContent/.test(chat));
check('Android elapsed ticker updates once per second', /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1_000\)/.test(row));
check('Android elapsed ticker uses the stable started_at anchor', /activity\?\.started_at/.test(row));
check('Android renders the native Codex stack in canonical order', /current \?[\s\S]+thinking \?[\s\S]+step \?[\s\S]+goal \?[\s\S]+usage \?/.test(row));
check('Android defaults live activity to one bounded disclosure row',
  /detailsExpanded[\s\S]+compactSummary[\s\S]+accessibilityState=\{\{ expanded: detailsExpanded \}\}/.test(row)
  && /compactSummary:\s*\{[\s\S]{0,180}minHeight:\s*44[\s\S]{0,80}maxHeight:\s*52/.test(row));
check('Android derives the expanded detail budget from the visible window',
  /useWindowDimensions\(\)/.test(row)
  && /Math\.max\(112,\s*Math\.min\(240,\s*Math\.round\(windowHeight \* 0\.32\)\)\)/.test(row)
  && /nestedScrollEnabled/.test(row));
check('Android exposes full reasoning and current output only inside the disclosure',
  /detailsExpanded && hasDisclosureContent[\s\S]+thinking\.text[\s\S]{0,140}<Text style=\{s\.thinkingText\} selectable>/.test(row)
  && /current\.partial[\s\S]{0,180}<Text style=\{current\.kind === 'tool' \? s\.currentOutput : s\.narrationText\} selectable>/.test(row));
check('Android keeps interruption, connection failure, and usage prominent',
  /interruption \?[\s\S]+connectionFailed \? <ConnectionStatusRow[\s\S]+detailsExpanded && hasDisclosureContent[\s\S]+usage \?/.test(row));
check('Web renders the native Codex stack in canonical order', /data-live-channel="current"[\s\S]+data-live-channel="thinking"[\s\S]+data-live-channel="step"[\s\S]+data-live-channel="goal"[\s\S]+data-live-channel="usage"/.test(app));
check('protocol defines relay started_at continuity', /stable `activity\.started_at`[\s\S]{0,240}tool\/kind\/label changes/.test(protocol));
check('protocol forbids client-side channel guessing', /clients must not infer reasoning from a[\s\S]{0,100}tool label/.test(protocol));

const result = {
  ok: true,
  checks: checks.length,
  stable_active_anchor: first.started_at,
  tool_transition_anchor: tool.started_at,
  restarted_anchor: restarted.started_at,
  android_ticker_interval_ms: 1000,
  verified_at: new Date().toISOString(),
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

console.log(JSON.stringify(result, null, 2));
