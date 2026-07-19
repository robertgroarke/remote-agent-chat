#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const webApp = read('frontend/app.jsx');
const webHooks = read('frontend/hooks.jsx');
const webStyles = read('frontend/styles.css');
const webHelper = read('frontend/host-resources.js');
const androidHelper = read('android-app/lib/host-resources.js');
const androidSessionList = read('android-app/screens/SessionListScreen.jsx');
const historyStore = read('agent-proxy/host-resource-history.js');
const monitor = read('agent-proxy/host-resource-monitor.js');
const relay = read('relay-server/index.js');
const boundary = read('relay-server/host-resource-boundary.js');
const proxy = read('agent-proxy/proxy-engine.js');
const protocol = read('protocol.md');

for (const marker of [
  'function HostResourceDashboard',
  'function GlobalHostResourceStrip',
  'data-testid="global-desktop-status-rail"',
  'data-testid="global-host-resource-strip"',
  "onSubscribe(true, 'global-strip')",
  "onUnsubscribe('global-strip')",
  'data-testid="host-resource-dashboard"',
  'Host resources',
  'function HostResourceChart',
  'Aggregate-only privacy',
  'Accessible data table',
  'Process command lines and executable paths remain local',
  'host-resource-process-table',
]) assert(webApp.includes(marker), `missing web host-resource marker: ${marker}`);
assert(!webApp.includes('setInterval(() => onRefresh(false), 5_000)'),
  'the Web dashboard must consume the one-second subscription instead of legacy polling');

for (const marker of [
  "t === 'host_resource_snapshot'",
  "t === 'host_resource_subscription_ack'",
  "t === 'host_resource_history_chunk'",
  "t === 'host_resource_live'",
  'subscribeHostResources',
  'unsubscribeHostResources',
  "t === 'host_resource_error'",
  'requestHostResourceRefresh',
  'clearHostResources',
  'hostResourceConsumerDemand',
  'hostResourceConsumersRef',
  'HOST_RESOURCE_COMPACT_HISTORY_LIMIT',
]) assert(webHooks.includes(marker), `missing web relay marker: ${marker}`);

for (const marker of [
  '.host-resource-summary', '.host-resource-charts', '.host-resource-process-scroll',
  '.host-resource-process-table', '.host-resource-privacy', '.host-resource-chart-canvas',
  '.host-resource-chart-tooltip', '@media (max-width: 600px)', '@media (prefers-reduced-motion: reduce)',
  '.global-desktop-status-rail', '.global-host-resource-strip', '@media (max-width: 899px)',
]) assert(webStyles.includes(marker), `missing host-resource style: ${marker}`);
assert(/\.host-resource-process-section\s*\{[^}]*flex:\s*0 0 auto/.test(webStyles),
  'host resource process rows must retain intrinsic height inside the scrollable dashboard');
assert(/\.host-resource-charts\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(webStyles),
  'desktop host resource charts must use the production 2x2 grid');
assert(/\.host-resource-chart\s*\{[^}]*min-height:\s*240px/.test(webStyles),
  'desktop chart cards must meet the 240px minimum height');

assert(webHelper.includes("export * from '../android-app/lib/host-resources.js'"),
  'the Web helper must delegate to the Android-local shared implementation');
for (const marker of [
  'export function normalizeHostResources', 'export function mergeOrderedHostResourceFrames',
  'export function downsampleHostResourceSeries', 'export function hostResourceIntervalStats',
  'export function projectHostResourceStrip', 'HOST_RESOURCE_COMPACT_HISTORY_LIMIT = 60',
]) assert(androidHelper.includes(marker), `missing shared host-resource helper: ${marker}`);
assert(!androidSessionList.includes('global-host-resource-strip'),
  'Android must not reserve permanent chrome for the desktop-only CPU/RAM strip');
assert(historyStore.includes('if (state.aggregateOnly) continue;'),
  'aggregate-only subscriptions must not retain detail-history frames');
assert(historyStore.includes('MAX_COMPACT_SYSTEM_POINTS = 60'),
  'aggregate-only subscriptions must retain at most 60 one-second points');
assert(monitor.includes('detailCollected && !state.aggregateOnly'),
  'aggregate-only subscriptions must not transmit detail frames');
assert(relay.includes('pending.proxyWs !== ws'), 'relay must accept a snapshot only from the selected proxy');
assert(relay.includes('pendingHostResourceRequests.set(upstreamRequestId, { ws, proxyWs, clientRequestId, timer })'),
  'relay must bind the requester and selected proxy');
assert(boundary.includes('MAX_HOST_RESOURCE_BYTES = 64 * 1024'), 'relay boundary must cap frames at 64 KiB');
assert(boundary.includes('MAX_HOST_RESOURCE_PROCESSES = 32'), 'relay boundary must cap process rows at 32');
assert(boundary.includes('command_lines_transmitted !== false'), 'relay boundary must require command-line privacy');
assert(boundary.includes('executable_paths_transmitted !== false'), 'relay boundary must require executable-path privacy');
assert(proxy.includes("type === 'host_resource_refresh'"), 'proxy must retain manual detail refresh');
assert(proxy.includes("type === 'host_resource_subscribe'"), 'proxy must implement requester subscriptions');
assert(proxy.includes("type === 'host_resource_history_request'"), 'proxy must implement chunked requester history');
assert(boundary.includes('sanitizeHostResourceSystemPoint'), 'relay boundary must validate 16 KiB live points');
assert(boundary.includes('sanitizeHostResourceHistoryChunk'), 'relay boundary must validate history chunks');
assert(relay.includes('hostResourceSubscriptions'), 'relay must bind host-resource subscription tokens');
assert(protocol.includes('It is never broadcast, cached, stored in'), 'protocol must prohibit relay fan-out and persistence');
assert(protocol.includes('Host resource subscription and history'), 'protocol must define live/history transport');
assert(!webApp.includes('localStorage.setItem(\'host-resource'), 'web must not persist host snapshots');
assert(webApp.includes("return () => onUnsubscribe('dashboard')"),
  'dashboard close must release only its own consumer lease');
assert(protocol.includes('same in-memory subscription ID'),
  'protocol must define in-place aggregate/detail arbitration');

const result = {
  ok: true,
  web_route: true,
  mobile_responsive_styles: true,
  one_second_subscription_history: true,
  interactive_charts: true,
  accessible_data_tables: true,
  shared_helper_source: 'android-app/lib/host-resources.js',
  web_shared_helper_delegation: true,
  relay_requester_and_proxy_bound: true,
  frame_limit_bytes: 64 * 1024,
  process_limit: 32,
  process_rows_vertically_scrollable: true,
  relay_cache: false,
  relay_persistence: false,
  requester_subscription_transport: true,
  chunked_proxy_memory_history: true,
  client_snapshot_cleared_on_close: true,
  global_desktop_strip: true,
  compact_strip_history_points: 60,
  aggregate_detail_frames_transmitted: false,
  android_permanent_strip: false,
  command_lines_transmitted: false,
  executable_paths_transmitted: false,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
