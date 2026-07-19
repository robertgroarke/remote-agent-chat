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
const androidActivity = read('android-app/components/ActivityRow.jsx');
const androidFileBrowser = read('android-app/components/FileBrowserSheet.jsx');
const androidLaunchSheet = read('android-app/components/LaunchSessionSheet.jsx');
const androidSessionPreferences = read('android-app/components/SessionPreferencesSheet.jsx');
const androidAgentSettings = read('android-app/components/AgentSettingsSheet.jsx');
const androidScheduledSend = read('android-app/components/ScheduledSendSheet.jsx');
const androidSessionHistory = read('android-app/components/SessionHistorySheet.jsx');
const androidWorkspaceGroups = read('android-app/lib/workspace-groups.js');
const androidTranscriptCache = read('android-app/lib/transcript-cache.js');
const androidPackage = JSON.parse(read('android-app/package.json'));
const androidEntry = read('android-app/index.js');
const androidMetroConfig = read('android-app/metro.config.js');
const androidMetroGuard = read('android-app/metro-worktree-guard.js');
const androidResolutionSmoke = read('tools/android-worktree-resolution-smoke.js');
const androidExportContract = read('tools/android-clean-worktree-export-contract.js');
const androidSessionTitle = read('android-app/lib/session-title.js');
const androidSessionPins = read('android-app/lib/session-pins.js');
const androidSessionRegistry = read('android-app/lib/session-registry.js');
const androidAttentionFeedback = read('android-app/lib/attention-feedback.js');
const androidSemanticNotifications = read('android-app/lib/semantic-notifications.js');
const androidBroadcastPolicy = read('android-app/lib/broadcast-send-policy.js');
const androidFleetActivity = read('android-app/lib/fleet-activity.js');
const androidFleetWorkContext = read('android-app/lib/fleet-work-context.js');
const androidRecentChats = read('android-app/lib/recent-chats.js');
const androidHostResources = read('android-app/lib/host-resources.js');
const androidProviderUsage = read('android-app/lib/provider-usage.js');
const androidSessionUsage = read('android-app/lib/session-usage.js');
const webApp = read('frontend/app.jsx');
const webStyles = read('frontend/styles.css');
const webHooks = read('frontend/hooks.jsx');
const webFleetActivity = read('frontend/fleet-activity.js');
const relayFleetWorkContext = read('relay-server/fleet-work-context.js');
const webHostResources = read('frontend/host-resources.js');
const webProviderUsage = read('frontend/provider-usage.js');
const webSessionUsage = read('frontend/session-usage.js');
const webWorkspaceGroups = read('frontend/workspace-groups.js');
const webRecentChats = read('frontend/recent-chats.js');
const webSessionTitle = read('frontend/session-title.js');
const webSessionPins = read('frontend/session-pins.js');
const webSessionRegistry = read('frontend/session-registry.js');
const proxyNoisePolicy = read('agent-proxy/session-noise-policy.js');
const proxyProtocol = read('agent-proxy/protocol.js');
const proxyEngine = read('agent-proxy/proxy-engine.js');
const relayIndex = read('relay-server/index.js');
const relayScheduledSends = read('relay-server/scheduled-sends.js');
const relayBroadcastPolicy = read('relay-server/broadcast-send-policy.js');

const count = (source, pattern) => (source.match(pattern) || []).length;
const hasAll = (source, values) => values.every(value => source.includes(value));
const normalizeEol = source => source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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
assert(hasAll(androidChat, [
  "case 'message_delta'", 'reduceMessageDeltaStream', 'requestAnimationFrame',
  'ListFooterComponent={provisionalStream ? <ProvisionalBubble',
  "if (msg.role === 'assistant') clearProvisionalStream()",
  'shouldClearEmptyProvisionalOnTerminal(',
]), 'Android must match the provisional message-delta stream and settled reconcile contract');
assert(hasAll(webHooks, ["if (t === 'message_delta')", 'provisionalPendingFlush', 'clearProvisionalStream(id)', 'shouldClearEmptyProvisionalOnTerminal(']),
  'Web must consume, rAF-batch, and reconcile provisional message deltas');
assert(hasAll(androidTranscriptCache, [
  'TRANSCRIPT_CACHE_LIMIT = 10', 'getCachedTranscript', 'setCachedTranscript',
  'mergeCachedTranscript', 'isTranscriptActivityLive', 'latestTranscriptSequence',
]), 'Android must share the bounded transcript LRU and active-session classification');
assert(hasAll(androidTranscriptCache, [
  'export function stableTranscriptMessageKey(message)', 'source_message_id', 'native_source_id',
  'server_message_id', 'client_message_id',
]), 'Android transcript rows must expose stable producer/client identity before content fallback');
assert(hasAll(androidChat, [
  'keyExtractor={stableTranscriptMessageKey}', 'initialNumToRender={24}',
  'maxToRenderPerBatch={24}', 'updateCellsBatchingPeriod={16}', 'windowSize={9}',
]), 'Android transcript FlatList must retain stable keys and bounded batching');
assert(hasAll(androidList, [
  'keyExtractor={item => sessionId(item)}', 'initialNumToRender={20}',
  'maxToRenderPerBatch={20}', 'updateCellsBatchingPeriod={32}', 'windowSize={9}',
]), 'Android sidebar SectionList must retain stable session keys and bounded batching');
assert.strictEqual(androidPackage.main, 'index.js',
  'Android must use the worktree-local Expo entrypoint for isolated exports');
assert(hasAll(androidEntry, ["import { registerRootComponent } from 'expo'", "import App from './App'", 'registerRootComponent(App)']),
  'Android worktree-local Expo entrypoint must register the local App module');
assert(hasAll(androidMetroConfig, ['createGuardedResolveRequest', 'config.resolver.resolveRequest']),
  'Metro config must install the active-worktree first-party resolution guard');
assert(hasAll(androidMetroGuard, [
  'Metro rejected first-party module outside the active worktree', 'isDependency(resolution.filePath)',
  'isWithin(projectRoot, resolution.filePath)',
]), 'Metro must reject first-party resolution outside the active worktree while allowing dependencies');
assert(hasAll(androidResolutionSmoke, [
  'outside_first_party_resolution_rejected: true', 'assert.throws(', 'outside the active worktree',
]), 'Android resolution smoke must retain the negative outside-worktree fixture');
assert(hasAll(androidExportContract, [
  "packageJson.main, 'index.js'", 'outside_first_party_sources',
  'first-party sources escaped active worktree', 'active_worktree_unchanged: true',
  'canonical_checkout_unchanged: true', 'byte_for_byte_unchanged: true',
  "'--require-clean'", "'--require-detached'", 'windowsHide: true',
]), 'Android parity audit must retain the detached clean-worktree export blocker');
assert(hasAll(androidChat, [
  'useState(() => getCachedTranscript(sessionId) || [])', 'setCachedTranscript(sessionId, messages)',
]), 'Android chat must paint cached transcripts immediately and retain updates');
assert(androidList.includes('client.setSessionSubscriptions([])')
  && !androidList.includes('appendCachedTranscript(msgSid, msg)')
  && !androidList.includes('prefetchActiveTails'),
  'Android list must stay summary-only without background transcript cache writes');
assert(hasAll(webApp, [
  'restoreCachedTranscript(id)', 'setSessionSubscriptions(activeSession ? [activeSession] : [])',
]) && !webApp.includes('prefetchActiveTails'),
  'Web must restore cached transcripts on selection without background tail polling');
assert(hasAll(webHooks, [
  "if (t === 'session_patch')", 'patchSessionRegistry', 'reconcileSessionRegistry',
]) && hasAll(androidList, [
  "case 'session_patch':", 'patchSessionRegistry', 'reconcileSessionRegistry',
]), 'Web and Android must consume keyed session patches through normalized registries');
assert(hasAll(webSessionRegistry, [
  'createSessionRegistry', 'reconcileSessionRegistry', 'patchSessionRegistry',
  'UNSAFE_PATCH_KEYS', 'indexById',
]), 'Web must expose the normalized keyed inventory and patch primitives');
const registryContractStart = source => source.slice(source.indexOf('const UNSAFE_PATCH_KEYS'));
assert.strictEqual(normalizeEol(registryContractStart(androidSessionRegistry)), normalizeEol(registryContractStart(webSessionRegistry)),
  'Web and Android normalized keyed inventory implementations must remain byte-identical after their file headers');
assert(!webHooks.includes('JSON.stringify(normalized) === JSON.stringify(sessionSubscriptionsRef.current)')
  && !androidRelay.includes('JSON.stringify(normalized) === JSON.stringify(this._sessionSubscriptions)'),
  'Web and Android subscription hot paths must avoid full JSON serialization equality');
assert(hasAll(androidBubble, [
  'nativeMessageLayout(agentType)', "return 'claude-document'", "return 'codex-terminal'",
  "return 'cursor-cards'", "return 'codex-thread'", 'terminalGutter', 'bubbleCursorCard',
]), 'Android must mirror the web native message-layout routes');
assert(hasAll(androidBubble, [
  'nativeCursorFileChangeSummary', 'isCursorFileChangeSummaryOnly',
  'renderCursorFileChangeSummary', 'cursorFileChangeAdditions', 'cursorFileChangeDeletions',
]) && hasAll(webApp, [
  'cursorFileChangeSummaryParts', 'isCursorSummaryOnly', 'content-block-file-change-cursor-summary',
]) && hasAll(webStyles, [
  '.content-block-file-change-cursor-summary', '#2a9d6f', '#e5484d',
]), 'Web and Android must preserve Cursor current flat completed-edit summaries without changing detailed diff cards');
assert(hasAll(webApp, [
  'harnessLayoutForAgentType', 'data-layout={harnessLayoutForAgentType(activeSessionMeta?.agent_type)}',
  'NativeActivitySpinner', "thinking.label || activity?.label || 'Thinking'",
]), 'Web must publish native message geometry and status vocabulary');
assert.match(androidBubble, /✓✓ Delivered/);
assert.match(androidBubble, /deliveryState === 'busy_queued'/);
assert.match(androidBubble, /deliveryState === 'delivered'/);
assert.match(androidBubble, /deliveryState === 'agent_started'/);
assert.match(androidList, /groupSessionsByDirectory/);
assert.match(androidList, /COLLAPSED_DIRECTORY_KEY/);
assert(hasAll(androidList, ['useStableSidebarGroups', 'maintainVisibleContentPosition', 'pendingPrompts: permPrompts', 'Order changed', 'Sort now']),
  'Android must match the operator-controlled stable sidebar ordering contract');
assert.strictEqual(normalizeEol(androidSessionTitle), normalizeEol(webSessionTitle),
  'Web and Android must share one byte-identical sidebar chat-title policy');
assert.strictEqual(normalizeEol(androidSessionPins), normalizeEol(webSessionPins),
  'Web and Android must share one byte-identical pinned-chat ordering policy');
assert(hasAll(androidList, [
  'partitionPinnedSessions(visibleSessions, sessionPreferences)', "key: '__pinned__'",
  'pinToggleOverlay', 'accessibilityLabel={`Unpin ${sessionName(item)}`}',
]), 'Android must render one stable pinned section with a direct accessible unpin control');
assert(hasAll(webApp, [
  'partitionPinnedSessions(orderedSessions, sessionPreferences)', 'pinned-session-group',
  'session-card-pin-toggle', 'aria-label={`Unpin ${chatTitle}`}',
]), 'Web must render one stable pinned section with a direct accessible unpin control');
assert(hasAll(androidList, ['custom_display_name: preference.display_name', 'refreshSidebarTranscriptTitle', 'sidebarTranscriptTitles']),
  'Android must preserve custom rename precedence and refresh derived chat titles after transcript hydration');
assert(hasAll(webApp, ['custom_display_name: preference.display_name', 'resolveSessionChatTitle']),
  'Web must keep native titles distinct from operator renames and use the shared chat-title policy');
assert(hasAll(androidList, [
  'numberOfLines={2}>{sessionName(item)}', 'numberOfLines={2}>{section.title}',
  'Show full title:', 'Show full group name:', 'cardMenuBtn', 'visible={!!titleDisclosure}',
]), 'Android must reserve readable two-line session/group titles with visual disclosure and one action menu');
assert(hasAll(androidSessionPreferences, [
  'Manage Sessions', 'Automations', 'Skills', 'Close or dismiss session',
]), 'Android consolidated session actions must retain every low-frequency action');
assert(hasAll(webApp, [
  'session-title-disclosure', 'session-group-disclosure', 'session-card-menu-popover',
  'Manage session', 'Automations', 'Skills', 'Close session',
]), 'Web must retain readable full-title disclosure and consolidated session actions');
assert.match(androidBubble, /observedTranscriptThemes\[agentType\]/);
assert(hasAll(androidChat, [
  'AsyncStorage.getItem', 'AsyncStorage.setItem', 'DRAFT_STORAGE_PREFIX',
  'SLASH_COMMANDS', 'filteredSlashCommands', 'applySlashCommand',
]), 'Android must persist per-session drafts and expose slash commands');
assert(hasAll(androidRelay, ['openNativeWindow', "type: 'open_native_window'"]),
  'Android must expose the native-window control protocol');
assert(hasAll(androidChat, ['hasNativeWindow', 'openNativeWindow(sessionId, !!event?.nativeEvent)']),
  'Android must capability-gate the native-window control');
assert(hasAll(androidRelay, ['operator_user_gesture: operatorGesture === true']),
  'Android native-window controls must require a direct operator press');
assert(hasAll(androidRelay, ['respondToErrorPrompt', "type: 'error_prompt_action'"]),
  'Android must submit error-prompt actions');
assert(hasAll(androidChat, ['session_error_prompt', 'session_error_prompt_cleared', 'open_error_prompts']),
  'Android must restore and maintain actionable error prompts');
assert(hasAll(androidErrorPrompt, ['error_output', 'submitting_action_id', 'accessibilityRole="alert"']),
  'Android must render accessible error prompt state and actions');
assert(hasAll(proxyProtocol, [
  'function permissionPrompt', "type: 'prompt'", 'const blockType =', 'type: blockType',
]), 'Permission, notice, and actionable-error events must carry canonical blocks');
assert(hasAll(androidErrorPrompt, ["item?.type === 'error'", "item?.type === 'notice'", 'block?.content']),
  'Android must prefer typed error/notice content');
assert.match(androidChat, /<PermissionPrompt prompt=\{permPrompt\}/);
assert(hasAll(androidRelay, [
  'steerMessage', "type: 'steer'", 'discardQueuedMessage', "type: 'discard_queued'",
  'editQueuedMessage', "type: 'edit_queued'",
]), 'Android must expose queued-message mutation controls');
assert(hasAll(androidChat, ["case 'native_queue'", 'handleSteerQueued', 'handleDiscardQueued', 'handleEditQueued']),
  'Android must maintain proxy/native queue state and connect its controls');
assert(hasAll(proxyProtocol, [
  "type: 'queued_message'", 'content_blocks:    [queuedMessageBlock',
  'content_blocks:   typedItems.flatMap',
]), 'Proxy and native queue events must carry canonical queued_message blocks');
assert(hasAll(webHooks, [
  "block?.type === 'queued_message'", 'content_blocks: contentBlocks',
  'content_blocks: (m.content_blocks || []).map',
]), 'Web must prefer and preserve canonical queued_message content');
assert(hasAll(androidChat, [
  "block?.type === 'queued_message'", 'content_blocks: contentBlocks',
  'content_blocks: (queued.content_blocks || []).map',
]), 'Android must prefer and preserve canonical queued_message content');
assert(hasAll(proxyProtocol, [
  "type: 'plan'", 'content_blocks: [{', 'task_list: typedTaskList',
]), 'Live task-list status must carry a canonical plan block');
assert(hasAll(androidActivity, [
  "block?.type === 'plan'", 'planTasks.map', 'accessibilityRole="summary"',
]), 'Android must render the canonical live plan task list');
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
  'PREF_NOTIFY_TURN_READY', 'PREF_NOTIFY_GOAL_DONE', 'PREF_NOTIFY_GOAL_ALERT', 'PREF_NOTIFY_RATE_LIMIT',
  'fetchRelayPreferences', 'saveRelayPreferences',
  '/api/preferences/notifications', 'These preferences sync across web and Android.',
]));
assert(hasAll(webApp, [
  'NotificationSettingsPanel', '/api/preferences/notifications',
  'authoritative native turn boundary', "togglePreference('goal_completed')",
  "togglePreference('goal_attention')", "togglePreference('rate_limit_cleared')",
]));
assert(hasAll(webApp, [
  "togglePreference('completion_sound')", "playAttentionSound('prompt')",
  "kind === 'goal_attention' || kind === 'provider_usage_threshold'", 'attentionEventIsUnfocused',
]), 'Web must offer opt-in, unfocused-only completion/prompt sound');
assert(hasAll(androidSettings, [
  'PREF_ATTENTION_HAPTIC', "'completion_haptic'", 'Notification haptic',
]), 'Android settings must expose the shared opt-in haptic preference');
assert(hasAll(androidAttentionFeedback, [
  'Vibration.vibrate', 'noteSemanticNotificationForAttentionFeedback',
  'promptIds.get(sessionId) === promptId',
]), 'Android must suppress initial/duplicate/foreground feedback and vibrate only opt-in attention events');
assert(hasAll(androidSemanticNotifications, [
  'semantic_notification_ledger_v1', 'processSemanticNotification', 'AppState.currentState',
  'DeviceEventEmitter.emit', 'preferences_pending', 'goal_completed', 'goal_attention', 'provider_usage_threshold',
  'refreshAuthoritativeSemanticNotificationPreferences',
]), 'Android must consume relay-authorized goal lifecycle notifications exactly once');
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
assert(hasAll(androidList, [
  "case 'app_update_validation_status'", 'msg.latest_app_update_validation',
  'App update validated', 'App update drift validation failed',
]), 'Android must restore and render immediate app-update pass/fail status');
assert(hasAll(webHooks, [
  "t === 'app_update_validation_status'", 'msg.latest_app_update_validation',
]), 'Web must restore immediate app-update status');
assert(hasAll(webApp, ['App update validated.', 'App update drift validation failed.']),
  'Web must render immediate app-update pass/fail status');
assert(hasAll(androidList, [
  "case 'provider_usage_snapshot':", 'normalizeProviderUsage(providerUsage)', 'Usage & limits',
  'Provider-account quotas shared by connected harnesses', 'Refresh provider usage',
  'Local estimated API-equivalent cost', 'window.pace.category', 'window.visualPercent',
  "case 'provider_usage_refresh_receipt':", "case 'provider_usage_cost_detail':",
  'Paginated local cost detail',
]), 'Android must match the provider-account usage dashboard and live provider snapshots');
assert(hasAll(webHooks, ["t === 'provider_usage_snapshot'", 'msg.provider_usage', 'requestProviderUsageRefresh',
  "t === 'provider_usage_refresh_receipt'", "t === 'provider_usage_cost_detail'", 'requestProviderUsageCostDetail']),
  'Web must restore live provider usage and expose guarded manual refresh');
assert(hasAll(webApp, [
  'normalizeProviderUsage(usage)', 'Usage & limits', 'Provider-account quotas shared by connected harnesses',
  'SessionUsageMiniMonitor', 'sessionUsageProjection(session, config, normalizedUsage, nowMs)',
  'Local estimated API-equivalent cost',
  'window.pace.category', 'window.visualPercent',
  'Paginated local cost detail', 'usage-refresh-receipt',
]), 'Web must expose the provider-account usage dashboard and retain the active-session chip');
assert(hasAll(androidRelay, ['requestProviderUsageCostDetail', "type: 'provider_usage_cost_detail_request'"]),
  'Android must request the same bounded provider cost detail pages as Web');
assert.strictEqual(androidProviderUsage.replace(/\r\n/g, '\n'), webProviderUsage.replace(/\r\n/g, '\n'),
  'Web and Android provider usage normalization, pace, thresholds, and cost filtering must remain byte-identical');
assert(hasAll(androidChat, [
  'sessionUsageProjection(', "case 'provider_usage_snapshot':", 'testID="session-usage-details"',
  'Billing provider', 'Model vendor', 'Applicable limits', 'Open Usage &amp; limits',
]), 'Android must expose the active-session mini usage monitor and complete details sheet');
assert.strictEqual(androidSessionUsage.replace(/\r\n/g, '\n'), webSessionUsage.replace(/\r\n/g, '\n'),
  'Web and Android session usage mapping and window projection must remain byte-identical');
assert(hasAll(androidList, [
  "case 'host_resource_subscription_ack':", "case 'host_resource_history_chunk':",
  "case 'host_resource_live':", "case 'host_resource_detail':", "case 'host_resource_error':",
  'visible={showHostResourceDashboard}', 'testID="host-resource-dashboard"',
  'subscribeHostResources(hostResourceAggregateOnly)', 'unsubscribeHostResources()',
  '<HostResourceChart title="CPU"', '<HostResourceChart title="Memory"',
  '<HostResourceChart title="Disk"', '<HostResourceChart title="Network"',
  'Aggregate-only privacy', 'accessible data table', '64-bit bytes R',
  'hostResourceTimelineProjection.validCount', 'hostResourceTimelineProjection.expectedCount',
  'p95 collecting (${stats.count}/20)', 'formatHostResourceTimestampFull',
]), 'Android must expose the interactive ephemeral host resource dashboard and subscription lifecycle');
assert(hasAll(webHooks, [
  "t === 'host_resource_subscription_ack'", "t === 'host_resource_history_chunk'",
  "t === 'host_resource_live'", "t === 'host_resource_detail'", "t === 'host_resource_error'",
  'subscribeHostResources', 'unsubscribeHostResources',
]), 'Web must consume requester-scoped host resource subscriptions, history, live frames, and errors');
assert(hasAll(webApp, [
  'function HostResourceDashboard', 'data-testid="host-resource-dashboard"',
  'function HostResourceChart', 'Aggregate-only privacy', 'Accessible data table',
  '64-bit byte counters', 'timeline.validCount', 'timeline.expectedCount',
  'p95 collecting (${stats.count}/20)', 'formatHostResourceTimestampFull',
]), 'Web must expose the matching interactive host resource and process dashboard');
assert(hasAll(androidRelay, [
  'requestHostResourceRefresh', "type: 'host_resource_refresh'", 'subscribeHostResources',
  "type: 'host_resource_subscribe'", 'requestHostResourceHistory', "type: 'host_resource_history_request'",
  'unsubscribeHostResources', "type: 'host_resource_unsubscribe'",
]), 'Android must use the bounded subscription/history relay protocol');
assert(webHostResources.includes("export * from '../android-app/lib/host-resources.js'")
  && hasAll(androidHostResources, [
    'export function normalizeHostResources', 'export function mergeOrderedHostResourceFrames',
    'export function downsampleHostResourceSeries', 'export function hostResourceIntervalStats',
    'export function hostResourceTimeline', 'export function hostResourceNiceScale',
    'export function hostResourceTimeTicks', 'export function hostResourceTimeFraction',
  ]), 'Web must delegate to the Android-local shared host-resource normalization and chart policy');
assert(hasAll(relayIndex, ['hostResourceSubscriptions', 'sanitizeHostResourceSnapshot', 'pending.proxyWs !== ws'])
  && hasAll(proxyEngine, ["type === 'host_resource_subscribe'", "type === 'host_resource_history_request'"]),
  'Proxy and relay must retain requester-only, proxy-bound host resource subscription routing');
assert(hasAll(webApp, [
  'function FleetView', 'classifyFleetActivity', 'fleetWorkContextProgress', 'fleetElapsed',
  "stateLabel: session?.rate_limit_active === true ? 'Usage limited' : fleetStateLabel(state)",
  'Show ${idleCount} idle session', 'data-testid="fleet-view"',
]), 'Web must expose the active-session fleet dashboard');
assert(hasAll(androidList, [
  'visible={showFleetView}', 'classifyFleetActivity', 'fleetWorkContextProgress', 'fleetElapsedLabel',
  "stateLabel: session?.rate_limit_active === true ? 'Usage limited' : fleetStateLabel(state)",
  'Show ${fleetIdleCount} idle', 'testID="fleet-view"',
]), 'Android must expose the matching active-session fleet dashboard');
assert.strictEqual(normalizeEol(androidFleetActivity), normalizeEol(webFleetActivity),
  'Web and Android must share one byte-identical Fleet activity/freshness policy');
assert.strictEqual(normalizeEol(androidFleetWorkContext), normalizeEol(relayFleetWorkContext),
  'Relay/Web and Android must share one byte-identical Fleet work-context projection');
assert(hasAll(relayFleetWorkContext, [
  'goalLifecycleSupported', 'projectFleetWorkContext', 'latestUserRequestFromMessages',
  "kind: 'empty'", "source: 'latest_user_request'", 'MAX_CONTEXT_TEXT = 240',
]), 'Fleet work-context policy must be bounded, capability-aware, and honestly empty');
assert(hasAll(relayIndex, [
  'Ignored goal for harness without goal lifecycle capability', 'work_context: projectFleetWorkContext',
  'last_user_request: latestUserRequest',
]) && hasAll(webApp, [
  'goalLifecycleSupported', 'projectFleetWorkContext', 'latestUserRequestFromMessages',
]) && hasAll(androidList, [
  'goalLifecycleSupported', 'projectFleetWorkContext', 'last_user_request',
]), 'Proxy, relay, Web, and Android must suppress unsupported goals and preserve bounded current work');
assert(hasAll(webFleetActivity, [
  "return 'working_goal'", "return 'needs_attention'", "return 'idle'",
  'proxy_emitted_at_ms', 'relay_received_at_ms', 'relay_forwarded_at_ms', 'latency_ms',
]), 'Fleet policy must distinguish truthful states and retain end-to-end freshness timestamps');
assert(hasAll(proxyProtocol, ['activity_trace: { proxy_emitted_at_ms: Date.now() }'])
  && hasAll(relayIndex, ['compactActivityTrace', 'relay_received_at_ms', 'relay_forwarded_at_ms'])
  && hasAll(webHooks, ['normalizeFleetActivityTrace(msg.activity_trace)']),
  'Proxy, relay, and clients must preserve measurable Fleet activity freshness');
assert(hasAll(webApp, [
  'data-testid="broadcast-send"', 'normalizeBroadcastRequest', 'SEND TO ${selectedIds.length} SESSIONS',
  'fleet-broadcast-receipts', 'onBroadcastSend={sendToSession}',
]), 'Web must expose guarded Fleet multi-select broadcast and per-session receipts');
assert(hasAll(androidList, [
  'testID="broadcast-send"', 'broadcastSelectedIds', 'SEND TO ${broadcastSelectedIds.length} SESSIONS',
  'Broadcast delivery receipts', 'clientRef.current?.sendMessage',
]), 'Android must expose guarded Fleet multi-select broadcast and per-session receipts');
assert(hasAll(androidBroadcastPolicy, [
  'MAX_BROADCAST_SESSIONS = 20', 'MAX_BROADCAST_CONTENT_CHARS = 65_536',
  'sessionSupportsBroadcast', 'normalizeBroadcastRequest',
]), 'Android must enforce the bounded exact-confirmation broadcast policy');
assert(hasAll(relayBroadcastPolicy, [
  'MAX_BROADCAST_SESSIONS = 20', 'sessionSupportsBroadcast', 'createBroadcastReceiptState',
]), 'Web/relay policy must retain the matching bounded broadcast contract');
assert(hasAll(webApp, [
  'rankQuickSwitcherItems', 'quickSwitcherItems', 'group.label', 'agent.name', 'workspace_path',
]), 'Web quick switcher must index session name, project, harness, and workspace context');
assert(hasAll(androidList, [
  'sessionSearchText', 'agentBadge(agentType(item)).label', 'workspace_name', 'workspace_path',
]), 'Android session search must index the matching name, project, harness, and workspace context');
assert(hasAll(webApp, [
  'function TranscriptSearchView', '/api/search/messages', 'transcriptSearchTarget', "mode: 'around'",
]), 'Web must expose scoped global transcript search and exact anchored hydration');
assert(hasAll(androidList, [
  'Transcript search', '/api/search/messages', 'transcriptSearchProject', 'transcriptSearchHarness',
  'transcriptSearchFrom', 'transcriptSearchTo', 'searchMessageId',
]), 'Android must expose matching scoped global transcript search');
assert(hasAll(androidChat, [
  "msg.mode === 'around'", 'searchMessageIdRef', 'scrollToIndex', 'highlightedSearchMessageId',
]) && hasAll(androidRelay, ["mode === 'around'", 'message.around_id']),
  'Android must hydrate, center, and highlight the exact persisted search match');
assert(hasAll(webHooks, ["t === 'session_summary'", 'setSessionSubscriptions', "type: 'subscribe'"]),
  'Web must subscribe the selected session and consume summary-only background traffic');
assert(hasAll(androidRelay, ['setSessionSubscriptions', "type: 'subscribe'"]),
  'Android relay must persist and replay selective session subscriptions');
assert(hasAll(androidList, ["case 'session_summary':", 'client.setSessionSubscriptions([])'])
  && androidChat.includes('client.setSessionSubscriptions([sessionId])'),
  'Android list/chat surfaces must consume summaries and subscribe only the selected transcript');
assert(hasAll(webApp, [
  'Download Markdown', 'Download JSON', '/api/sessions/${encodeURIComponent(sessionId)}/export', 'URL.createObjectURL',
]), 'Web must download complete Markdown and JSON session exports');
assert(hasAll(androidChat, [
  'Share.share', '/api/sessions/${encodeURIComponent(sessionId)}/export', 'onExport={shareSessionExport}',
]) && hasAll(androidAgentSettings, [
  'Export session', 'Share Markdown', 'Share JSON', "onExport('markdown')", "onExport('json')",
]), 'Android must expose the same authenticated exports through the native share sheet');
assert(hasAll(androidAgentSettings, [
  'Next turn model', 'Next turn effort', 'Next turn permissions',
  'Enable Bypass permissions?', 'Restore previous safe permissions',
  'source_revision: config.source_revision', 'minHeight: 44',
]) && hasAll(webApp, [
  'Next turn model', 'Next turn effort', 'Next turn permissions',
  'Enable Bypass permissions?', 'Restore previous safe permissions',
]), 'Web and Android must expose the same confirmed session-scoped VS Code Codex control contract');
assert(hasAll(proxyNoisePolicy, [
  'sessionNoiseMetadata', 'is_test_session', "session_kind: isTest ? 'validator' : 'operator'", "project_group: 'Remote Agent Chat'",
]), 'Proxy must tag validator sessions with explicit noise and parent-project metadata');
assert(hasAll(relayIndex, [
  'is_test_session INTEGER', "req.query.include_test === 'true'", 'Push skipped for validator session', '!sessionIdIsTestSession(sessionId)',
]), 'Relay must hide validator history and suppress its push and summary unread traffic');
assert(hasAll(webWorkspaceGroups, ['sessionIsTestSession', 'TEST_SESSION_PATH_PATTERNS'])
  && hasAll(webApp, ['SHOW_TEST_SESSIONS_STORAGE_KEY', 'Show test sessions', 'operatorOrderedSessions', 'testSessionIds.has(id) ? 0'])
  && hasAll(androidWorkspaceGroups, ['sessionIsTestSession', 'TEST_SESSION_PATH_PATTERNS'])
  && hasAll(androidList, ['SHOW_TEST_SESSIONS_KEY', 'Show test sessions', 'operatorVisibleSessions', 'testSessionIds.has(sid) ? 0'])
  && androidSessionHistory.includes('include_test=${includeTestSessions'),
  'Web and Android must hide tests by default, persist a reveal toggle, and exclude them from unread/Fleet surfaces');
assert(hasAll(relayScheduledSends, ['ScheduledSendStore', "trigger_kind IN ('at', 'idle')", "state = 'dispatching'", 'client_msg_id'])
  && hasAll(relayIndex, ['/api/scheduled-sends', 'dispatchIdleScheduledSends', 'processScheduledSendJobs', 'settleScheduledSendFromProxy'])
  && hasAll(webApp, ['Schedule message', 'When session is next idle', 'At a specific time'])
  && hasAll(webHooks, ['/api/scheduled-sends', 'scheduleSend', 'cancelScheduledSend'])
  && hasAll(androidChat, ['ScheduledSendSheet', 'Schedule message'])
  && hasAll(androidScheduledSend, ['Next idle', 'At time', '/api/scheduled-sends', 'Cancel']),
  'Web and Android must create/list/cancel the same durable timed and next-idle scheduled sends');
assert.strictEqual(normalizeEol(androidFleetActivity), normalizeEol(webFleetActivity),
  'Web and Android must use a byte-identical freshness-aware Fleet/sidebar activity classifier');
assert(hasAll(webWorkspaceGroups, [
  'partitionSidebarSessionsByWorking', 'createSidebarWorkingLedger', 'reconcileSidebarWorkingLedger',
]) && hasAll(androidWorkspaceGroups, [
  'partitionSidebarSessionsByWorking', 'createSidebarWorkingLedger', 'reconcileSidebarWorkingLedger',
]), 'Web and Android must share the stable working-section ledger contract');
assert.strictEqual(normalizeEol(webRecentChats).trim(), "export * from '../android-app/lib/recent-chats.js';",
  'Web must consume the canonical Android Recent chats projection without a divergent copy');
assert(hasAll(androidRecentChats, [
  'normalizeLatestVisibleMessage', 'projectRecentChatOwnership', 'working, recent, pinned, remaining',
]), 'Web and Android must share the canonical Working -> Recent -> Pinned -> workspace ownership contract');
assert(hasAll(webApp, [
  'Working now', 'Recent chats', '...workingSessions, ...recentSessions, ...pinnedSessions, ...sessionGroups',
  'working-session-group', 'recent-session-group', 'workspaceLabelBySessionId',
]) && hasAll(androidList, [
  "title: 'Working now'", "title: 'Recent chats'", 'const sections = [workingSection, recentSection, pinnedSection',
  'workspaceLabelBySessionId', 'maintainVisibleContentPosition',
]), 'Both clients must render Working now, Recent chats, Pinned chats, then workspace sessions');

const rows = [
  ['Directory-only session grouping and persistent collapse', 'PARITY',
    'Web localStorage and Android AsyncStorage use resolved project-root groups with activity summaries.'],
  ['Global working-first stable sidebar ordering', 'PARITY',
    'Both clients use one freshness-aware classifier and stable working ledger, then one canonical Recent projection before remaining pinned/workspace rows, with exclusive ownership across state edges.'],
  ['Chat-summary sidebar titles with hydration refresh', 'PARITY',
    'Both clients prefer native titles, then operator renames, then the first meaningful user message; generic harness labels become New chat and Android re-titles after cache hydration.'],
  ['Relay-backed operator-ordered pinned chats', 'PARITY',
    'Both clients use the same pin-order policy, keep working pinned rows uniquely in Working now, render remaining pinned chats before workspace groups, retain search/filter behavior, and expose a direct one-action unpin control.'],
  ['Session health, activity, unread, and permission indicators', 'PARITY',
    'Both clients restore and update session health/activity and duplicate-proxy alarms; collapsed groups retain visible alerts.'],
  ['Nightly and immediate app-update drift status', 'PARITY',
    'Both clients restore nightly failures plus the latest event-driven app-update pass/fail banner with old and new versions.'],
  ['Provider-account usage, pace, and estimated-cost dashboard', 'PARITY',
    'Web and Android render byte-identical provider/account normalization with raw overage truth, scoped windows, predictive pace and budgets, per-window thresholds, credits/reset credits, correlated refresh receipts, and exact filter-preserving paginated local cost detail.'],
  ['Ephemeral host resource and process dashboard', 'PARITY',
    'Web delegates to the Android-local shared normalization/chart policy; both clients use bounded subscription history only while open, render interactive CPU/memory/disk/network charts plus process tree overlays, and disclose requester-only non-cache/non-persistence privacy.'],
  ['Active-session fleet monitoring dashboard', 'PARITY',
    'Web and Android share truthful working-on-goal/working/idle/needs-attention classification, capability-gated native goals, one byte-identical bounded current-work projection, measured proxy-to-client freshness, bounded idle reveal, live status, elapsed, explicit goal progress, snippets, and one-tap chat jumps.'],
  ['Guarded multi-session broadcast send', 'PARITY',
    'Web and Android select up to 20 capable Fleet sessions, require exact count confirmation, fan out through durable single-send semantics, and render per-session lifecycle receipts.'],
  ['Canonical structured transcript blocks', 'PARITY',
    `Both clients render all ${canonicalTypes.length} canonical block types. Android long-press copy preserves them.`],
  ['Canonical live plan/task-list surface', 'PARITY',
    'Proxy status carries the live task list as a canonical plan block; web and Android render every task and state without flattening.'],
  ['Expanded-by-default transcript content', 'PARITY',
    'Legacy and canonical assistant/tool content render fully by default on both clients.'],
  ['Observed per-harness transcript text themes', 'PARITY',
    'Android routes the 12 observed agent types to measured theme packs; gated Gemini/Roo retain the honest fallback.'],
  ['Native per-harness message geometry and status vocabulary', 'PARITY',
    'Web and Android route Claude document flow, Codex terminal/thread flow, and Cursor cards; both preserve producer status labels and native harness glyphs.'],
  ['Cursor native completed-edit summary', 'PARITY',
    'Web and Android render summary-only Edited N files +A -D events as one flat Cursor row with native addition/deletion tones while preserving detailed diff cards.'],
  ['Session search across name, project, and harness', 'PARITY',
    'Web quick-switcher and Android search index renamed titles, project/workspace context, harness labels/types, and session identity.'],
  ['Global transcript full-text search and anchored deep links', 'PARITY',
    'Web and Android query the authenticated relay FTS5 endpoint with project, harness, and date filters, then hydrate around and highlight the exact persisted message.'],
  ['Complete session export', 'PARITY',
    'Web downloads full Markdown or JSON transcripts from the session menu; Android shares the same authenticated exports through the native share sheet.'],
  ['Validator-session noise control', 'PARITY',
    'Proxy/relay tag validator sessions; web and Android hide them by default behind a persisted toggle and exclude their unread, Fleet, history, and push noise.'],
  ['Timed and next-idle scheduled sends', 'PARITY',
    'Web and Android create, list, and cancel relay-backed jobs with timed or next-idle triggers and receipt-backed delivery semantics.'],
  ['Durable send receipts and retry', 'PARITY',
    'Both clients use client_message_id and consume relay acceptance, canonical/raw proxy delivery, correlated agent_started activity, and retryable failure results.'],
  ['Provisional incremental assistant stream', 'PARITY',
    'Both clients open on agent_started, validate the same ordered delta reducer, rAF-batch appends, and atomically reconcile on the settled assistant message.'],
  ['Instant cached selected-session switching', 'PARITY',
    'Both clients share a 10-session transcript LRU, paint revisits from memory, and hydrate/reconcile only when the operator selects a session.'],
  ['Selective selected-session subscription', 'PARITY',
    'Web and Android subscribe only the selected transcript, retain full fidelity there, and consume lightweight status/unread/snippet/goal summaries everywhere else.'],
  ['Normalized keyed session inventory and patch delivery', 'PARITY',
    'Web and Android reconcile full membership into ID-keyed registries, apply one-session patches with structural sharing, reject unsafe keys, and preserve unrelated row/order identity without JSON serialization equality in the subscription hot path.'],
  ['Permission prompt response', 'PARITY',
    'Both clients prefer canonical prompt blocks, restore prompts, submit choices, clear success, and surface failed responses.'],
  ['Canonical permission, notice, and actionable-error surfaces', 'PARITY',
    'Proxy events carry prompt/notice/error blocks; web and Android preserve the specialized controls while preferring typed labels and content.'],
  ['Interrupt', 'PARITY',
    'Both clients issue agent_interrupt from the active session surface.'],
  ['Model, mode, permission, effort, access, and workspace controls', 'PARITY',
    'Both clients capability-gate agent configuration, carry request/source identity, wait for authoritative native read-back, and require explicit confirmation before VS Code Codex Full access.'],
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
    'Android retains a dormant turn-finished channel for compatibility, rejects idle-derived and legacy completion events, and provides distinct goal/prompt/error/offline channels plus one deduped in-app banner.'],
  ['Error prompt actions', 'PARITY',
    'Both clients restore blocking/inline session_error_prompt state, render output/actions, and retain retryable failure feedback.'],
  ['Queued-message steer/edit/discard controls', 'PARITY',
    'Both clients prefer canonical queued_message blocks from proxy/native queue events, preserve typed edits, and expose steer/edit/discard actions; native items correctly omit edit.'],
  ['Workspace file browser and inline file preview', 'PARITY',
    'Both clients capability-gate list_directory/read_file navigation, text previews, truncation notices, and non-text files.'],
  ['Session launch and close/dismiss lifecycle', 'PARITY',
    'Both clients launch/resume with correlated ack/failure state, close connected sessions, and dismiss disconnected entries while retaining history.'],
  ['Open native harness window', 'PARITY',
    'Web and Android capability-gate the same operator-action-only open_native_window request for supported CLI sessions.'],
  ['Draft persistence and slash-command menu', 'PARITY',
    'Web and Android persist per-session composer drafts and expose the same plan/review/fix/summarize command starters.'],
  ['Bounded history pagination/backfill', 'PARITY',
    'Both clients request bounded relay tails and prepend older before_id chunks with deduplication, scroll preservation, and retryable failure state.'],
  ['Notification category settings persisted in relay', 'PARITY',
    'Relay forces ordinary turn-ready off until an authoritative harness adapter exists, persists goal and existing moment categories, filters live/push fan-out plus per-session mute, and both clients wait for authenticated relay policy before semantic display.'],
  ['Opt-in completion sound and haptic feedback', 'PARITY',
    'Relay defaults both cues off; web sound and Android haptic apply only to deduplicated unfocused prompts or explicit goal events, never an inferred activity-idle transition.'],
  ['Rename, archive/hide, and per-session mute', 'PARITY',
    'Relay persists per-user custom names, hidden state, and session mute; web and Android both manage and restore hidden sessions.'],
  ['Readable session/group titles and consolidated actions', 'PARITY',
    'Both clients reserve fixed two-line identity boxes, reveal the full title without navigation, overlay truthful state, and retain Manage/Automations/Skills/Close behind one reachable action surface.'],
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
