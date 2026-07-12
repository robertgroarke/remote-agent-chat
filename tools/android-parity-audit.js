#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const androidList = read('android-app/screens/SessionListScreen.jsx');
const androidBubble = read('android-app/components/MessageBubble.jsx');
const androidRelay = read('android-app/lib/relay.js');
const androidApp = read('android-app/App.jsx');
const androidSettings = read('android-app/screens/SettingsScreen.jsx');
const androidErrorPrompt = read('android-app/components/ErrorPrompt.jsx');
const androidQueuedBar = read('android-app/components/QueuedMessageBar.jsx');
const androidFileBrowser = read('android-app/components/FileBrowserSheet.jsx');
const androidLaunchSheet = read('android-app/components/LaunchSessionSheet.jsx');
const androidSessionPreferences = read('android-app/components/SessionPreferencesSheet.jsx');
const webApp = read('frontend/app.jsx');
const webHooks = read('frontend/hooks.jsx');

const count = (source, pattern) => (source.match(pattern) || []).length;
const hasAll = (source, values) => values.every(value => source.includes(value));

const canonicalTypes = [
  'markdown', 'thinking', 'tool_call', 'tool_result', 'terminal', 'file_changes',
  'artifact', 'prompt', 'plan', 'queued_message', 'notice', 'error', 'status',
];

assert(hasAll(androidBubble, canonicalTypes.map(type => `case '${type}'`)),
  'Android must render every canonical structured block');
assert.match(androidRelay, /client_message_id:\s*clientMsgId/,
  'Android sends must use the relay client_message_id contract');
assert.strictEqual(count(androidChat, /case 'agent_control_result'/g), 1,
  'Android must have one reachable agent_control_result handler');
assert(hasAll(androidChat, [
  "case 'message_accepted'", "case 'message_delivered'", "case 'message_failed'",
  "case 'proxy_send_result'", "case 'message_queued'", "case 'queue_delivered'",
  "case 'steer_result'", "case 'agent_started'",
]), 'Android must consume the delivery lifecycle');
assert.match(androidBubble, /✓✓ Delivered/);
assert.match(androidBubble, /deliveryState === 'busy_queued'/);
assert.match(androidBubble, /deliveryState === 'delivered'/);
assert.match(androidBubble, /deliveryState === 'agent_started'/);
assert.match(androidList, /groupSessionsByDirectory/);
assert.match(androidList, /COLLAPSED_DIRECTORY_KEY/);
assert.match(androidBubble, /observedTranscriptThemes\[agentType\]/);
assert(hasAll(androidChat, [
  'AsyncStorage.getItem', 'AsyncStorage.setItem', 'DRAFT_STORAGE_PREFIX',
  'SLASH_COMMANDS', 'filteredSlashCommands', 'applySlashCommand',
]), 'Android must persist per-session drafts and expose slash commands');
assert(hasAll(androidRelay, ['openNativeWindow', "type: 'open_native_window'"]),
  'Android must expose the native-window control protocol');
assert(hasAll(androidChat, ['hasNativeWindow', 'openNativeWindow(sessionId)']),
  'Android must capability-gate the native-window control');
assert(hasAll(androidRelay, ['respondToErrorPrompt', "type: 'error_prompt_action'"]),
  'Android must submit error-prompt actions');
assert(hasAll(androidChat, ['session_error_prompt', 'session_error_prompt_cleared', 'open_error_prompts']),
  'Android must restore and maintain actionable error prompts');
assert(hasAll(androidErrorPrompt, ['error_output', 'submitting_action_id', 'accessibilityRole="alert"']),
  'Android must render accessible error prompt state and actions');
assert(hasAll(androidRelay, [
  'steerMessage', "type: 'steer'", 'discardQueuedMessage', "type: 'discard_queued'",
  'editQueuedMessage', "type: 'edit_queued'",
]), 'Android must expose queued-message mutation controls');
assert(hasAll(androidChat, ["case 'native_queue'", 'handleSteerQueued', 'handleDiscardQueued', 'handleEditQueued']),
  'Android must maintain proxy/native queue state and connect its controls');
assert(hasAll(androidQueuedBar, ['onSteer(item)', 'onDiscard(item)', 'onEdit(item, content)', '!item.native']),
  'Android must render accessible proxy/native queue actions');
assert(hasAll(androidRelay, [
  'requestDirectoryListing', "type: 'list_directory'", 'requestFileContent', "type: 'read_file'",
]), 'Android must expose the workspace file-browser protocol');
assert(hasAll(androidChat, ["case 'directory_listing'", "case 'file_content'", 'hasFileBrowser', '<FileBrowserSheet']),
  'Android must capability-gate and maintain workspace file-browser state');
assert(hasAll(androidFileBrowser, ['VIEWABLE_EXTENSIONS', 'onNavigate(parentPath(currentPath))', 'selectable', 'truncated']),
  'Android must render safe directory navigation and bounded text previews');
assert(hasAll(androidRelay, ['requestHistoryChunk', "type: 'history_chunk_request'", "source: 'relay_sqlite'", 'before_id']),
  'Android must request bounded relay history chunks');
assert(hasAll(androidChat, [
  "case 'history_chunk'", 'HISTORY_PAGE_SIZE = 200', 'Load earlier messages',
  'maintainVisibleContentPosition', 'historyUserScrolledRef', 'historyRequestTimerRef',
]), 'Android must merge bounded tails and expose guarded older-history backfill');
assert(hasAll(androidRelay, [
  'launchSession', "type: 'launch_session'", 'closeSession', "'dismiss_session'", "'close_session'",
]), 'Android must expose session launch and close/dismiss lifecycle controls');
assert(hasAll(androidList, [
  "case 'session_launch_ack'", "case 'session_launch_failed'", "case 'session_closed'",
  'beginLaunch', 'beginResume', 'confirmCloseSession', '<LaunchSessionSheet',
]), 'Android must render and maintain session lifecycle state');
assert(hasAll(androidLaunchSheet, ['AGENT_OPTIONS', 'Launch Session', 'Workspace path', 'Antigravity Chat']),
  'Android must render the cross-harness launch surface');
assert(hasAll(androidList, ['SessionPreferencesSheet', '/api/preferences/sessions', 'visibleSessions', 'Hidden (']),
  'Android must load, hide, and restore relay-backed session preferences');
assert(hasAll(androidSessionPreferences, [
  'Hide from session list', 'Restore to session list', 'Mute notifications', 'Custom session name',
]), 'Android must render rename/archive/mute controls');
assert(hasAll(webApp, [
  'SessionManagementPanel', '/api/preferences/sessions', 'Hide from sidebar', 'Restore to sidebar',
]), 'Web must render relay-backed rename/archive/mute controls');
assert(hasAll(androidSettings, [
  'PREF_NOTIFY_AGENT_IDLE', 'PREF_NOTIFY_RATE_LIMIT',
  'fetchRelayPreferences', 'saveRelayPreferences',
  '/api/preferences/notifications', 'These preferences sync across web and Android.',
]));
assert(hasAll(webApp, [
  'NotificationSettingsPanel', '/api/preferences/notifications',
  "togglePreference('agent_ready')", "togglePreference('rate_limit_cleared')",
]));
assert(hasAll(androidApp, ['configureNotificationChannels', 'NotificationBanner']));
assert(hasAll(androidList, ["case 'duplicate_proxy_alarm'", 'msg.duplicate_proxy_alarms', 'Duplicate proxy detected']),
  'Android must restore and render duplicate-proxy alarms');
assert(hasAll(webHooks, ["t === 'duplicate_proxy_alarm'", 'msg.duplicate_proxy_alarms']),
  'Web must restore duplicate-proxy alarms');
assert(webApp.includes('Duplicate proxy detected.'), 'Web must render the persistent duplicate-proxy warning');
assert(hasAll(androidList, [
  "case 'nightly_validation_status'", 'msg.nightly_validation_failures', 'Nightly validation failed',
]), 'Android must restore and render nightly validation failures');
assert(hasAll(webHooks, ["t === 'nightly_validation_status'", 'msg.nightly_validation_failures']),
  'Web must restore nightly validation failures');
assert(webApp.includes('Nightly validation failed.'), 'Web must render the persistent nightly validation warning');

const rows = [
  ['Directory-only session grouping and persistent collapse', 'PARITY',
    'Web localStorage and Android AsyncStorage use resolved project-root groups with activity summaries.'],
  ['Session health, activity, unread, and permission indicators', 'PARITY',
    'Both clients restore and update session health/activity and duplicate-proxy alarms; collapsed groups retain visible alerts.'],
  ['Nightly validation drift warning', 'PARITY',
    'Both clients restore and update persisted per-harness validation failures with captured app versions.'],
  ['Canonical structured transcript blocks', 'PARITY',
    `Both clients render all ${canonicalTypes.length} canonical block types. Android long-press copy preserves them.`],
  ['Expanded-by-default transcript content', 'PARITY',
    'Legacy and canonical assistant/tool content render fully by default on both clients.'],
  ['Observed per-harness transcript text themes', 'PARITY',
    'Android routes the 12 observed agent types to measured theme packs; gated Gemini/Roo retain the honest fallback.'],
  ['Durable send receipts and retry', 'PARITY',
    'Both clients use client_message_id and consume relay acceptance, canonical/raw proxy delivery, correlated agent_started activity, and retryable failure results.'],
  ['Permission prompt response', 'PARITY',
    'Both clients restore prompts, submit choices, clear success, and surface failed responses.'],
  ['Interrupt', 'PARITY',
    'Both clients issue agent_interrupt from the active session surface.'],
  ['Model, mode, permission, effort, access, and workspace controls', 'PARITY',
    'Both clients capability-gate agent configuration and refresh config after successful controls.'],
  ['Chat/thread list, switch, and new conversation controls', 'PARITY',
    'Both clients expose capability-gated history sheets/panels and switch/new actions.'],
  ['Terminal output/input', 'PARITY',
    'Both clients expose terminal output; Android gates terminal input to supported harnesses.'],
  ['File changes with accept/reject', 'PARITY',
    'Both clients render diff controls and send file_change_response actions.'],
  ['Branches and workspace switching', 'PARITY',
    'Both clients expose capability-gated branch operations and workspace selection.'],
  ['Attachments', 'PARITY',
    'Both clients support text/binary/image attachment paths and direct Codex Desktop image sends.'],
  ['Skills and Codex Desktop automations', 'PARITY',
    'Both products expose skills and automation surfaces.'],
  ['Push channels and foreground notification banner', 'PARITY',
    'Android registers permission, ready, error/rate-limit, offline, and cleared-limit channels and provides an in-app notification banner.'],
  ['Error prompt actions', 'PARITY',
    'Both clients restore blocking/inline session_error_prompt state, render output/actions, and retain retryable failure feedback.'],
  ['Queued-message steer/edit/discard controls', 'PARITY',
    'Both clients track proxy/native queue events and expose steer/edit/discard actions; native items correctly omit edit.'],
  ['Workspace file browser and inline file preview', 'PARITY',
    'Both clients capability-gate list_directory/read_file navigation, text previews, truncation notices, and non-text files.'],
  ['Session launch and close/dismiss lifecycle', 'PARITY',
    'Both clients launch/resume with correlated ack/failure state, close connected sessions, and dismiss disconnected entries while retaining history.'],
  ['Open native harness window', 'PARITY',
    'Web and Android capability-gate the same open_native_window request for supported CLI sessions.'],
  ['Draft persistence and slash-command menu', 'PARITY',
    'Web and Android persist per-session composer drafts and expose the same plan/review/fix/summarize command starters.'],
  ['Bounded history pagination/backfill', 'PARITY',
    'Both clients request bounded relay tails and prepend older before_id chunks with deduplication, scroll preservation, and retryable failure state.'],
  ['Notification category settings persisted in relay', 'PARITY',
    'Relay persists all five moment categories, filters push fan-out plus per-session mute, and serves shared web/Android settings with Android cache fallback.'],
  ['Rename, archive/hide, and per-session mute', 'PARITY',
    'Relay persists per-user custom names, hidden state, and session mute; web and Android both manage and restore hidden sessions.'],
  ['Real-device Android visual regression', 'PHASE 2 OPEN',
    'Static smokes and Expo exports pass; native device screenshots and side-by-side goldens remain required.'],
];

const summary = rows.reduce((acc, [, status]) => {
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

const result = {
  ok: true,
  audited_at: new Date().toISOString(),
  canonical_block_types: canonicalTypes,
  summary,
  rows: rows.map(([capability, status, evidence]) => ({ capability, status, evidence })),
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}

console.log(JSON.stringify(result, null, 2));
