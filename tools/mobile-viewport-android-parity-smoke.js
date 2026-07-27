#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const activity = read('android-app/components/ActivityRow.jsx');
const chat = read('android-app/screens/ChatScreen.jsx');
const count = (source, token) => source.split(token).length - 1;

assert(activity.includes('const [detailsExpanded, setDetailsExpanded] = useState(false)'),
  'Android live activity must default collapsed');
assert.strictEqual(count(activity, 'setDetailsExpanded'), 2,
  'Only the operator disclosure press may change Android live-activity expansion');
assert.match(activity, /compactSummary:\s*\{[\s\S]{0,180}minHeight:\s*44[\s\S]{0,80}maxHeight:\s*52/,
  'Android live-activity summary must remain a 44-52 dp touch row');
assert(activity.includes('accessibilityState={{ expanded: detailsExpanded }}')
  && activity.includes("${detailsExpanded ? 'Collapse' : 'Expand'} live activity details"),
  'Android live activity must expose one labelled reversible disclosure');
assert(activity.includes('useWindowDimensions()')
  && activity.includes('Math.round(windowHeight * 0.32)')
  && activity.includes('nestedScrollEnabled'),
  'Android live-activity details must use a visible-window-derived internal scroll budget');
assert.match(activity, /detailsExpanded && hasDisclosureContent[\s\S]+<ScrollView[\s\S]+current \?[\s\S]+thinking \?[\s\S]+planTasks\.length[\s\S]+step \?[\s\S]+goal \?/,
  'Goal, thinking, current output, plan, and step detail must live inside one disclosure');
assert(!activity.includes('numberOfLines={4}'),
  'Expanded Android live activity must expose full producer-owned text');
assert.match(activity, /interruption \?[\s\S]+connectionFailed \? <ConnectionStatusRow[\s\S]+detailsExpanded && hasDisclosureContent[\s\S]+usage \?/,
  'Interruption, connection failure, and usage states must remain prominent outside the disclosure');
assert(activity.includes('return <RateLimitRow until={activity.rate_limited_until} />'),
  'Rate limits must remain a direct prominent row');

assert(chat.includes('const [writeGateExpanded, setWriteGateExpanded] = useState(false)'),
  'Android write-gate detail must default collapsed');
assert.strictEqual(count(chat, 'setWriteGateExpanded'), 2,
  'Only the operator disclosure press may change Android write-gate expansion');
assert(chat.includes('accessibilityState={{ expanded: writeGateExpanded }}')
  && chat.includes('Harness writes paused')
  && chat.includes('Read-only transcript access remains available.'),
  'Android must preserve the unmistakable safety gate and full explanation');
assert.match(chat, /revalidationGateSummary:\s*\{[\s\S]{0,180}minHeight:\s*44[\s\S]{0,80}maxHeight:\s*44/,
  'The collapsed Android write gate must remain one 44 dp touch row');
assert(chat.includes('Math.round(windowHeight * 0.24)')
  && chat.includes('accessibilityLabel="Harness write gate details"')
  && chat.includes('nestedScrollEnabled'),
  'Expanded Android write-gate text must use a visible-window-derived internal scroller');
assert.match(chat, /<ActivityRow[\s\S]+<PermissionPrompt[\s\S]+<ErrorPrompt/,
  'Native prompts and actionable errors must remain separate prominent surfaces');
assert.match(chat, /writeGateExpanded[\s\S]+<\/View>\s*\)\}\s*\{!threadViewDetached && <PaneRestoreRail records=\{minimizedPaneRecords\} onRestore=\{restorePane\} \/>\}\s*<View style=\{s\.inputRow\}>/,
  'The bounded restore rail must remain selected-thread-only and immediately adjacent to the composer after the compact write gate');
assert.match(chat, /paneRestoreRail:\s*\{[\s\S]{0,180}minHeight:\s*48[\s\S]{0,80}maxHeight:\s*48/,
  'The Android minimized-pane restore rail must remain exactly 48 dp');
assert.match(chat, /paneRestoreChip:\s*\{[\s\S]{0,180}minWidth:\s*44[\s\S]{0,80}minHeight:\s*44/,
  'Every Android minimized-pane restore chip must retain a 44 dp target');
assert.match(chat, /paneMinimizeButton:\s*\{[\s\S]{0,180}minWidth:\s*44[\s\S]{0,80}minHeight:\s*44/,
  'Every Android pane minimize control must retain a 44 dp target');
assert(chat.includes('Math.round(windowHeight * 0.45)')
  && chat.includes('accessibilityLabel="Minimize Session usage"')
  && chat.includes('onRequestClose={usagePane.minimize}'),
  'Android session usage must remain bounded to 45% and minimize without clearing retained state');
assert(chat.includes('composerBlockedByPrompt = !!visiblePermPrompt || errorPromptIsBlocking')
  && chat.includes('onPress={nativeActionPane.minimize}')
  && chat.includes('attention_count: nativeActionSourceKey ? 1 : 0'),
  'Minimized native prompts must remain authoritative, composer-blocking, and visible in the restore rail');

const receipt = {
  result: 'PASS',
  checked_at: new Date().toISOString(),
  android: {
    collapsed_live_activity_dp: { min: 44, max: 52 },
    collapsed_write_gate_dp: 44,
    detail_budget: 'live activity <= 32% of window; write gate <= 24% of window',
    operator_only_disclosures: true,
    ordinary_refresh_auto_expands: false,
    full_details_internally_scrollable: true,
    prompts_interruptions_failures_prominent: true,
    composer_reachable: true,
    minimized_restore_rail_dp: 48,
    pane_touch_target_dp: 44,
    session_usage_max_window_ratio: 0.45,
    minimized_native_prompt_remains_blocking: true,
  },
  explicit_difference: {
    web: 'visualViewport CSS budget plus Chromium/WebKit interaction and geometry matrix',
    android: 'React Native window-height budget; native render/export evidence is a separate gate',
  },
  source_only: true,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(receipt, null, 2));
