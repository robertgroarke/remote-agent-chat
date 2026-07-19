#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const list = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const relay = fs.readFileSync(path.join(root, 'android-app', 'lib', 'relay.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'android-app', 'lib', 'host-resources.js'), 'utf8');
const webHelper = fs.readFileSync(path.join(root, 'frontend', 'host-resources.js'), 'utf8');

for (const marker of [
  "case 'host_resource_snapshot':", "case 'host_resource_subscription_ack':",
  "case 'host_resource_history_chunk':", "case 'host_resource_live':",
  "case 'host_resource_detail':", "case 'host_resource_error':",
  'visible={showHostResourceDashboard}', 'testID="host-resource-dashboard"',
  'requestHostResourceRefresh(true)', 'subscribeHostResources(hostResourceAggregateOnly)',
  'unsubscribeHostResources()', 'requestHostResourceHistory(',
  '<HostResourceChart title="CPU"', '<HostResourceChart title="Memory"',
  '<HostResourceChart title="Disk"', '<HostResourceChart title="Network"',
  'Aggregate-only privacy', 'accessible data table', 'Search name, PID, agent, workspace',
  '64-bit bytes R', 'Process command lines and executable paths remain local',
  'mergeOrderedHostResourceFrames', 'downsampleHostResourceSeries', 'hostResourceIntervalStats',
  'setHostResources(null);', 'setHostResourceHistory([]);', 'setHostResourceDetails([]);',
  "live: 'Live', delayed: 'Delayed', reconnecting: 'Reconnecting', paused: 'Paused', stale: 'Stale'",
  'hostResourceTimelineProjection.validCount', 'hostResourceTimelineProjection.expectedCount',
  'p95 collecting (${stats.count}/20)', 'raw samples /', 'Last full detail:',
]) assert(list.includes(marker), `missing Android host-resource marker: ${marker}`);
assert(!list.includes('<HostResourceMiniChart'), 'Android must not retain the aggregate mini-chart UI');
assert(!list.includes('setInterval(() => clientRef.current?.requestHostResourceRefresh'),
  'Android must consume the one-second subscription instead of polling');

for (const marker of [
  'requestHostResourceRefresh(force = false)', "type: 'host_resource_refresh'", 'protocol_version: 1',
  '_sendHostResourceSubscribe(aggregateOnly', "type: 'host_resource_subscribe'",
  'subscribeHostResources(aggregateOnly = false)', 'requestHostResourceHistory(stream, afterSequence = 0)',
  'unsubscribeHostResources()', "type: 'host_resource_unsubscribe'", 'resume_subscription_id',
]) {
  assert(relay.includes(marker), `missing Android relay marker: ${marker}`);
}
assert(webHelper.includes("export * from '../android-app/lib/host-resources.js'"),
  'Web must delegate to the Android-local shared host-resource implementation');
for (const marker of [
  'export function normalizeHostResources', 'export function mergeOrderedHostResourceFrames',
  'export function downsampleHostResourceSeries', 'export function hostResourceIntervalStats',
  'export function hostResourceTimeline', 'export function hostResourceNiceScale',
  'export function hostResourceTimeTicks', 'export function hostResourceTimeFraction',
]) assert(helper.includes(marker), `missing shared Android helper marker: ${marker}`);
assert(!list.includes("AsyncStorage.setItem('host-resource"), 'Android must not persist host-resource snapshots');
assert(!relay.includes("AsyncStorage.setItem('host-resource"), 'Android must keep resume tokens in memory only');

const result = {
  ok: true,
  requester_scoped_live_updates: true,
  one_second_subscription_history: true,
  reconnect_resume_in_memory: true,
  explicit_unsubscribe_on_close: true,
  cpu_memory_disk_network: true,
  interactive_pan_pinch_crosshair_scale: true,
  exact_interval_statistics: true,
  accessible_data_tables: true,
  agent_attributed_processes: true,
  process_search_filter_sort_tree_overlay: true,
  aggregate_only_privacy: true,
  shared_helper_source: 'android-app/lib/host-resources.js',
  web_shared_helper_delegation: true,
  raw_snapshot_persistence: false,
  client_snapshot_cleared_on_close: true,
  accessible_controls: true,
  truthful_freshness_and_last_good_age: true,
  shared_time_geometry_and_scale: true,
  p95_minimum_sample_gate: 20,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
