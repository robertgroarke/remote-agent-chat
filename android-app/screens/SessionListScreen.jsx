import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Animated,
  Platform,
  Alert, Linking, Modal, ScrollView,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RelayClient }   from '../lib/relay';
import { createStateSequenceGate } from '../lib/state-sequence';
import {
  createSessionRegistry,
  patchSessionRegistry,
  reconcileSessionRegistry,
} from '../lib/session-registry';
import {
  DEFAULT_GROUP_ALIASES,
  GROUP_ALIAS_STORAGE_KEY,
  createSidebarOrderLedger,
  createSidebarWorkingLedger,
  groupSessionsByDirectory,
  normalizeGroupAliases,
  partitionSidebarSessionsByWorking,
  reconcileSidebarOrderLedger,
  reconcileSidebarWorkingLedger,
  sessionIsTestSession,
  sortSidebarOrderLedger,
} from '../lib/workspace-groups';
import { getStoredJwt, getJwtDaysRemaining, RELAY_URL, signOut } from '../lib/auth';
import { registerForPushNotifications, subscribeToTokenRefresh } from '../lib/notifications';
import {
  clearPromptAttentionFeedback,
  notePromptForAttentionFeedback,
  refreshAttentionHapticPreference,
  rememberPromptForAttentionFeedback,
} from '../lib/attention-feedback';
import { processSemanticNotification } from '../lib/semantic-notifications';
import { AgentIcon } from '../components/AgentIcons';
import ProviderMark from '../components/ProviderMark';
import { useReducedMotion } from '../lib/reduced-motion';
import SessionHistorySheet from '../components/SessionHistorySheet';
import LaunchSessionSheet from '../components/LaunchSessionSheet';
import SessionPreferencesSheet from '../components/SessionPreferencesSheet';
import {
  getCachedTranscript,
  isTranscriptActivityLive,
} from '../lib/transcript-cache';
import { resolveSessionChatTitle, sessionChatTitleMetadataPatch, titleFromSessionMessages } from '../lib/session-title';
import { partitionPinnedSessions } from '../lib/session-pins';
import {
  latestVisibleMessageSessionPatch,
  normalizeLatestVisibleMessage,
  projectRecentChatOwnership,
} from '../lib/recent-chats';
import { formatVisibleMessageTime, parseMessageInstant } from '../lib/message-time';
import {
  MAX_BROADCAST_CONTENT_CHARS,
  MAX_BROADCAST_SESSIONS,
  normalizeBroadcastRequest,
  sessionSupportsBroadcast,
} from '../lib/broadcast-send-policy';
import {
  formatOllamaDuration,
  formatOllamaTokenRate,
  formatProviderCredits,
  formatProviderPercent,
  formatProviderUsageAge,
  formatProviderUsageReset,
  normalizeProviderUsage,
  providerFinancialRows,
  retainNewerProviderUsage,
  selectEstimatedCost,
} from '../lib/provider-usage';
import {
  HOST_RESOURCE_CHART_RANGES,
  downsampleHostResourceSeries,
  formatHostResourceAge,
  formatHostResourceBytes,
  formatHostResourcePercent,
  formatHostResourceRate,
  formatHostResourceTimestamp,
  formatHostResourceTimestampFull,
  hostResourceIntervalStats,
  hostResourceMetricValue,
  hostResourceNiceScale,
  hostResourceTimeFraction,
  hostResourceTimeTicks,
  hostResourceTimeline,
  mergeOrderedHostResourceFrames,
  normalizeHostResources,
  selectHostResourceRange,
} from '../lib/host-resources';
import {
  DEFAULT_ACTIVITY_FRESHNESS_MS,
  classifyFleetActivity,
  fleetActivityObservedAtMs,
  fleetFreshnessLabel,
  fleetGoalElapsedSeconds,
  fleetGoalSubstateLabel,
  fleetStateIsWorking,
  fleetStateLabel,
  normalizeFleetActivityTrace,
} from '../lib/fleet-activity';
const {
  goalLifecycleSupported,
  projectFleetWorkContext,
} = require('../lib/fleet-work-context');

const COLLAPSED_DIRECTORY_KEY = 'remote-agent-chat:collapsed-directories:v1';
const SHOW_TEST_SESSIONS_KEY = 'remote-agent-chat:show-test-sessions:v1';

function sessionKey(session) {
  return typeof session === 'string' ? session : (session?.session_id || session?.id || '');
}

function fleetWorkContextProgress(context) {
  const explicit = Number(context?.percent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  const completed = Number(context?.completed);
  const total = Number(context?.total);
  return Number.isInteger(completed) && Number.isInteger(total) && total > 0
    ? Math.max(0, Math.min(100, (completed / total) * 100))
    : null;
}

function fleetElapsedLabel(activity, nowMs) {
  const goal = activity?.goal;
  const started = Date.parse(activity?.startedAt || activity?.started_at || activity?.since || '');
  const total = goal
    ? fleetGoalElapsedSeconds(goal, activity?.goal_run, nowMs)
    : Math.floor(Number.isFinite(started) ? Math.max(0, (nowMs - started) / 1000) : 0);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function fleetSnippet(session) {
  const value = String(session?.last_snippet || '').replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 180) : 'No recent message reported.';
}

function compactUsageTokens(value) {
  const numeric = Math.max(0, Number(value) || 0);
  if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(numeric);
}

function clampHostResourceViewport(viewport) {
  const width = Math.max(0.04, Math.min(1, Number(viewport?.end) - Number(viewport?.start) || 1));
  const start = Math.max(0, Math.min(1 - width, Number(viewport?.start) || 0));
  return { start, end: start + width };
}

function androidHostChartPath(samples, xFor, yFor) {
  let path = '';
  let drawing = false;
  samples.forEach(sample => {
    if (sample.gap || sample.average == null || !Number.isFinite(sample.average)) {
      drawing = false;
      return;
    }
    path += `${drawing ? 'L' : 'M'}${xFor(sample).toFixed(2)},${yFor(sample.average).toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function HostResourceChart({
  title, description, frames, series, percentScale = false, viewport, onViewportChange,
  crosshairSequence, onCrosshairChange, range = 'live', nowMs = Date.now(), paused = false,
  subscriptionStatus = 'live',
}) {
  const [width, setWidth] = useState(340);
  const [hiddenSeries, setHiddenSeries] = useState({});
  const [scale, setScale] = useState({ mode: 'auto', fixedMax: null });
  const [showData, setShowData] = useState(false);
  const gestureRef = useRef(null);
  const previousAutoMaximumRef = useRef(0);
  const boundedViewport = clampHostResourceViewport(viewport);
  const timeline = hostResourceTimeline(frames, {
    nowMs, paused, connected: subscriptionStatus !== 'reconnecting', subscriptionStatus,
  });
  const rangeDuration = HOST_RESOURCE_CHART_RANGES[range] ?? HOST_RESOURCE_CHART_RANGES.live;
  const baseEndMs = paused ? timeline.endMs || nowMs : nowMs;
  const baseStartMs = rangeDuration === Infinity
    ? timeline.startMs || baseEndMs - HOST_RESOURCE_CHART_RANGES.live
    : baseEndMs - rangeDuration;
  const baseSpanMs = Math.max(1, baseEndMs - baseStartMs);
  const visibleStartMs = baseStartMs + baseSpanMs * boundedViewport.start;
  const visibleEndMs = baseStartMs + baseSpanMs * boundedViewport.end;
  const visibleFrames = timeline.frames.filter(frame => (
    Number(frame.chart_time_ms) >= visibleStartMs && Number(frame.chart_time_ms) <= visibleEndMs
  ));
  const chartSeries = series.map(entry => {
    const sourceFrames = entry.frames
      ? hostResourceTimeline(entry.frames, { nowMs, paused: true }).frames
      : visibleFrames;
    const boundedFrames = entry.frames
      ? sourceFrames.filter(frame => Number(frame.chart_time_ms) >= visibleStartMs && Number(frame.chart_time_ms) <= visibleEndMs)
      : sourceFrames;
    return {
      ...entry,
      visibleFrames: boundedFrames,
      samples: downsampleHostResourceSeries(boundedFrames, entry.metric, 90),
    };
  });
  const activeSeries = chartSeries.filter(entry => !hiddenSeries[entry.key]);
  const rawPeak = Math.max(0, ...activeSeries.flatMap(entry => entry.samples.map(sample => sample.max || 0)));
  const automaticScale = hostResourceNiceScale(rawPeak, previousAutoMaximumRef.current, { percent: percentScale });
  if (!percentScale && scale.mode === 'auto') previousAutoMaximumRef.current = automaticScale.maximum;
  const scaleContract = scale.mode === 'fixed' && scale.fixedMax
    ? hostResourceNiceScale(scale.fixedMax, scale.fixedMax, { percent: percentScale })
    : automaticScale;
  const maximum = scaleContract.maximum;
  const svgWidth = Math.max(280, width - 20);
  const svgHeight = 150;
  const left = 42;
  const right = svgWidth - 10;
  const top = 6;
  const bottom = svgHeight - 18;
  const xFor = sample => left + hostResourceTimeFraction(sample, visibleStartMs, visibleEndMs) * (right - left);
  const yFor = value => bottom - (Math.max(0, Math.min(maximum, value)) / Math.max(1, maximum)) * (bottom - top);
  const crosshairFrame = visibleFrames.find(frame => frame.sample_sequence === crosshairSequence)
    || visibleFrames[visibleFrames.length - 1] || null;
  const crosshairX = crosshairFrame
    ? left + hostResourceTimeFraction(crosshairFrame, visibleStartMs, visibleEndMs) * (right - left)
    : null;
  const formatValue = series[0]?.format || (value => String(value));
  const xTicks = hostResourceTimeTicks(visibleStartMs, visibleEndMs, 4);
  const statusLabel = timeline.status[0]?.toUpperCase() + timeline.status.slice(1);

  function sequenceAtX(locationX) {
    if (!visibleFrames.length) return 0;
    const fraction = Math.max(0, Math.min(1, locationX / Math.max(1, width)));
    const targetTime = visibleStartMs + (visibleEndMs - visibleStartMs) * fraction;
    return visibleFrames.reduce((closest, frame) => (
      Math.abs(Number(frame.chart_time_ms) - targetTime) < Math.abs(Number(closest.chart_time_ms) - targetTime)
        ? frame : closest
    ), visibleFrames[0]).sample_sequence;
  }

  function beginGesture(event) {
    const touches = event.nativeEvent.touches || [];
    onCrosshairChange(sequenceAtX(event.nativeEvent.locationX || touches[0]?.locationX || 0));
    if (touches.length >= 2) {
      const distance = Math.max(1, Math.abs(touches[1].pageX - touches[0].pageX));
      gestureRef.current = { mode: 'pinch', distance, viewport: boundedViewport };
    } else {
      gestureRef.current = { mode: 'pan', pageX: touches[0]?.pageX || event.nativeEvent.pageX || 0, viewport: boundedViewport };
    }
  }

  function moveGesture(event) {
    const gesture = gestureRef.current;
    const touches = event.nativeEvent.touches || [];
    if (!gesture) return;
    if (touches.length >= 2) {
      const distance = Math.max(1, Math.abs(touches[1].pageX - touches[0].pageX));
      const originalWidth = gesture.viewport.end - gesture.viewport.start;
      const nextWidth = Math.max(0.04, Math.min(1, originalWidth * (gesture.distance || distance) / distance));
      const center = (gesture.viewport.start + gesture.viewport.end) / 2;
      onViewportChange(clampHostResourceViewport({ start: center - nextWidth / 2, end: center + nextWidth / 2 }));
    } else if (touches.length === 1 && gesture.mode === 'pan') {
      const viewportWidth = gesture.viewport.end - gesture.viewport.start;
      const shift = -(touches[0].pageX - gesture.pageX) / Math.max(1, width) * viewportWidth;
      onViewportChange(clampHostResourceViewport({ start: gesture.viewport.start + shift, end: gesture.viewport.end + shift }));
      onCrosshairChange(sequenceAtX(touches[0].locationX || 0));
    }
  }

  return (
    <View style={s.hostResourceChart} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View style={s.hostResourceChartLabel}>
        <View style={{ flex: 1 }}><Text style={s.hostResourceChartTitle}>{title}</Text><Text style={s.hostResourceChartDescription}>{description}</Text></View>
        {!percentScale && (
          <TouchableOpacity style={s.hostResourceChartAction} accessibilityRole="button" accessibilityLabel={`${title} ${scale.mode} scale`} onPress={() => setScale(previous => previous.mode === 'auto' ? { mode: 'fixed', fixedMax: automaticScale.maximum } : { mode: 'auto', fixedMax: null })}>
            <Text style={s.hostResourceChartActionText}>{scale.mode === 'auto' ? 'Auto' : 'Fixed'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.hostResourceChartQuality} accessibilityLiveRegion="polite">
        {timeline.status.toUpperCase()} / {timeline.receivedCount} received / {timeline.validCount} valid of {timeline.expectedCount} expected / {timeline.droppedCount} dropped / {Math.round(timeline.cadenceMs)} ms / {timeline.gapCount} gaps / {timeline.duplicateCount} dup / {timeline.outOfOrderCount} out-of-order
      </Text>
      <View style={s.hostResourceChartLegend} accessibilityRole="tablist">
        {chartSeries.map(entry => (
          <TouchableOpacity key={entry.key} style={[s.hostResourceLegendButton, hiddenSeries[entry.key] ? s.hostResourceLegendButtonOff : null]} accessibilityRole="button" accessibilityState={{ selected: !hiddenSeries[entry.key] }} accessibilityLabel={`${entry.label} series`} onPress={() => setHiddenSeries(previous => ({ ...previous, [entry.key]: !previous[entry.key] }))}>
            <View style={[s.hostResourceLegendDot, { backgroundColor: entry.color }]} /><Text style={s.hostResourceLegendText}>{entry.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View
        style={s.hostResourceChartCanvas}
        accessible accessibilityRole="adjustable"
        accessibilityLabel={`${title} chart. Drag to pan and pinch to zoom.`}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={beginGesture}
        onResponderMove={moveGesture}
        onResponderRelease={() => { gestureRef.current = null; }}
        onResponderTerminate={() => { gestureRef.current = null; }}
      >
        <Svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
          {timeline.gaps.filter(gap => gap.endMs >= visibleStartMs && gap.startMs <= visibleEndMs).map((gap, index) => {
            const gapLeft = left + Math.max(0, (gap.startMs - visibleStartMs) / Math.max(1, visibleEndMs - visibleStartMs)) * (right - left);
            const gapRight = left + Math.min(1, (gap.endMs - visibleStartMs) / Math.max(1, visibleEndMs - visibleStartMs)) * (right - left);
            return <Rect key={`${gap.reason}-${index}`} x={gapLeft} y={top} width={Math.max(2, gapRight - gapLeft)} height={bottom - top} fill="#f0883e" opacity="0.12" stroke="#f0883e" strokeDasharray="3 3" />;
          })}
          {scaleContract.ticks.map(value => <Line key={value} x1={left} x2={right} y1={yFor(value)} y2={yFor(value)} stroke="#30363d" strokeWidth="1" />)}
          {activeSeries.flatMap(entry => entry.samples.map(sample => sample.gap || sample.min == null || sample.max == null ? null : (
            <Line key={`${entry.key}-${sample.endSequence}`} x1={xFor(sample)} x2={xFor(sample)} y1={yFor(sample.min)} y2={yFor(sample.max)} stroke={entry.color} strokeWidth="2" opacity="0.3" />
          )))}
          {activeSeries.map((entry, index) => <Path key={entry.key} d={androidHostChartPath(entry.samples, xFor, yFor)} fill="none" stroke={entry.color} strokeWidth="2.4" strokeDasharray={entry.dashed || index % 3 === 1 ? '7 4' : index % 3 === 2 ? '2 4' : undefined} />)}
          {activeSeries.flatMap(entry => entry.visibleFrames.length < 10 ? entry.visibleFrames.map(frame => {
            const value = hostResourceMetricValue(frame, entry.metric);
            return value == null ? null : <Circle key={`${entry.key}-${frame.sample_sequence}`} cx={xFor(frame)} cy={yFor(value)} r="3" fill="#0d1117" stroke={entry.color} strokeWidth="2" />;
          }) : [])}
          {crosshairX != null && <Line x1={crosshairX} x2={crosshairX} y1={top} y2={bottom} stroke="#f0f6fc" strokeDasharray="3 3" />}
        </Svg>
        <View pointerEvents="none" style={s.hostResourceChartAxis}>{[...scaleContract.ticks].reverse().map(value => <Text key={value} style={s.hostResourceChartValue}>{formatValue(value)}</Text>)}</View>
        <View pointerEvents="none" style={s.hostResourceChartXAxis}>{xTicks.map(tick => <Text key={tick.timeMs} style={s.hostResourceChartTime} accessibilityLabel={tick.accessibleLabel}>{tick.label}</Text>)}</View>
      </View>
      {!!crosshairFrame && (
        <View style={s.hostResourceChartTooltip} accessible accessibilityLiveRegion="polite">
          <Text style={s.hostResourceChartTooltipTitle}>{formatHostResourceTimestampFull(crosshairFrame.chart_time_ms)} / seq {crosshairFrame.sample_sequence}</Text>
          <Text style={s.hostResourceChartTooltipText}>{Math.max(0, Math.round((nowMs - Number(crosshairFrame.chart_time_ms)) / 1000))}s old / {crosshairFrame.sample_interval_ms || timeline.cadenceMs} ms / {statusLabel} / source {crosshairFrame.status || 'unknown'}</Text>
          {chartSeries.map(entry => <Text key={entry.key} style={s.hostResourceChartTooltipText}>{entry.label}: {entry.format(hostResourceMetricValue(entry.visibleFrames.find(frame => frame.sample_sequence === crosshairFrame.sample_sequence), entry.metric))}</Text>)}
        </View>
      )}
      <View style={s.hostResourceChartStats}>
        {activeSeries.map(entry => {
          const stats = hostResourceIntervalStats(entry.visibleFrames, entry.metric);
          const peak = entry.visibleFrames.find(frame => frame.sample_sequence === stats.peakSequence);
          return <Text key={entry.key} style={s.hostResourceChartStatText}>{entry.label}: latest-good {entry.format(stats.current)} / min {entry.format(stats.min)} / avg {entry.format(stats.average)} ({stats.averageMethod}) / max {entry.format(stats.max)} / {stats.p95Ready ? `p95 ${entry.format(stats.p95)}` : `p95 collecting (${stats.count}/20)`} / {stats.count} raw / {Math.round(stats.elapsedMs / 1000)}s / {Math.max(stats.gapCount, timeline.gapCount)} gaps / {statusLabel} / peak {formatHostResourceTimestamp(peak?.captured_at)}</Text>;
        })}
      </View>
      <TouchableOpacity style={s.hostResourceDataToggle} accessibilityRole="button" accessibilityState={{ expanded: showData }} onPress={() => setShowData(previous => !previous)}><Text style={s.hostResourceDataToggleText}>{showData ? 'Hide' : 'Show'} accessible data table</Text></TouchableOpacity>
      {showData && <View style={s.hostResourceDataTable} accessible accessibilityLabel={`${title} latest data table`}>
        {visibleFrames.slice(-12).map(frame => <View key={`${frame.sample_sequence}:${frame.chart_time_ms}`} style={s.hostResourceDataRow}><Text style={s.hostResourceDataTime}>{formatHostResourceTimestampFull(frame.chart_time_ms)} / {frame.sample_sequence}{frame.gap_before ? ` / gap ${frame.gap_reason}` : ''}</Text><Text style={s.hostResourceDataValues}>{chartSeries.map(entry => `${entry.label} ${entry.format(hostResourceMetricValue(entry.visibleFrames.find(candidate => candidate.sample_sequence === frame.sample_sequence), entry.metric))}`).join(' / ')}</Text></View>)}
      </View>}
    </View>
  );
}

function androidHostResourceProcessRows(processes, search, filter, sort, expanded) {
  const query = search.trim().toLowerCase();
  const candidates = processes.filter(process => (!query || [process.name, process.agentLabel, process.workspaceLabel, process.pid, process.attributionReason]
    .some(value => String(value || '').toLowerCase().includes(query)))
    && (filter === 'all' || process.attributionLevel === filter));
  const keys = new Set(candidates.map(process => process.stableKey));
  const children = new Map();
  candidates.forEach(process => {
    const parent = keys.has(process.parentKey) ? process.parentKey : '';
    children.set(parent, [...(children.get(parent) || []), process]);
  });
  const compare = (left, right) => {
    if (sort === 'name') return (left.agentLabel || left.name).localeCompare(right.agentLabel || right.name) || left.pid - right.pid;
    if (sort === 'memory') return right.memoryBytes - left.memoryBytes || left.pid - right.pid;
    if (sort === 'read') return right.ioReadBps - left.ioReadBps || left.pid - right.pid;
    if (sort === 'write') return right.ioWriteBps - left.ioWriteBps || left.pid - right.pid;
    return right.cpuHostPercent - left.cpuHostPercent || left.pid - right.pid;
  };
  const rows = [];
  function visit(parent, depth) {
    (children.get(parent) || []).sort(compare).forEach(process => {
      rows.push({ process, depth });
      if (expanded[process.stableKey] !== false) visit(process.stableKey, depth + 1);
    });
  }
  visit('', 0);
  return rows;
}

// A producer-authoritative late receipt may recover a failed/timeout row, so
// failure ranks below native delivery while still outranking relay acceptance.
const BROADCAST_RECEIPT_RANK = { queued: 0, accepted: 1, launch_accepted: 2, failed: 2, delivered: 3, agent_started: 4 };

function broadcastReceiptEvent(message) {
  const clientMessageId = message?.client_message_id;
  if (!clientMessageId) return null;
  if (message.type === 'message_accepted') {
    const storedStatus = ['accepted', 'delivered', 'agent_started', 'failed'].includes(message.status)
      ? message.status
      : 'accepted';
    const status = storedStatus === 'accepted' && message.launch_accepted_at ? 'launch_accepted' : storedStatus;
    return { clientMessageId, status, error: status === 'failed' ? (message.failure_code || 'Delivery failed') : null };
  }
  if (message.type === 'proxy_send_result' && message.result === 'launch_accepted') {
    return { clientMessageId, status: 'launch_accepted' };
  }
  if (message.type === 'message_delivered' || (message.type === 'proxy_send_result' && message.result === 'delivered')) {
    return { clientMessageId, status: 'delivered' };
  }
  if (message.type === 'agent_started') return { clientMessageId, status: 'agent_started' };
  if (message.type === 'message_failed' || (message.type === 'proxy_send_result' && message.result === 'failed')) {
    return { clientMessageId, status: 'failed', error: message.reason || message.message || message.error?.message || 'Delivery failed' };
  }
  return null;
}

function useStableSidebarGroups(groups, rankOptions, freezeStructure = false) {
  const [ledger, setLedger] = useState(() => createSidebarOrderLedger(groups, rankOptions));
  const projection = useMemo(() => reconcileSidebarOrderLedger(ledger, groups, {
    ...rankOptions,
    freezeStructure,
  }), [ledger, groups, rankOptions, freezeStructure]);

  useEffect(() => {
    if (projection.ledger !== ledger) setLedger(projection.ledger);
  }, [ledger, projection]);

  const sortNow = useCallback(() => {
    setLedger(previous => sortSidebarOrderLedger(previous, groups, rankOptions));
  }, [groups, rankOptions]);

  return {
    groups: projection.groups,
    orderChanged: projection.orderChanged,
    sortNow,
  };
}

function useStableWorkingSessions(sessions, freezeStructure = false) {
  const [ledger, setLedger] = useState(() => createSidebarWorkingLedger(sessions));
  const projection = useMemo(
    () => reconcileSidebarWorkingLedger(ledger, sessions, { freezeStructure }),
    [ledger, sessions, freezeStructure],
  );

  useEffect(() => {
    if (projection.ledger !== ledger) setLedger(projection.ledger);
  }, [ledger, projection]);

  return { sessions: projection.sessions, revision: projection.ledger.revision };
}

function useSidebarFreshnessClock(activities, sessions) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const now = Date.now();
    const activityRows = [
      ...Object.values(activities || {}),
      ...(Array.isArray(sessions) ? sessions.map(session => session?.activity) : []),
    ];
    const nextDeadline = activityRows.reduce((next, activity) => {
      const observedAt = fleetActivityObservedAtMs(activity);
      const deadline = observedAt ? observedAt + DEFAULT_ACTIVITY_FRESHNESS_MS : 0;
      if (deadline <= now) return next;
      return next === 0 ? deadline : Math.min(next, deadline);
    }, 0);
    if (!nextDeadline) return undefined;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(25, nextDeadline - now + 25));
    return () => clearTimeout(timer);
  }, [activities, sessions, nowMs]);
  return nowMs;
}

function migrateSessionKeyedObject(previous, aliasId, canonicalId, mergeValues = null) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)
    || !Object.prototype.hasOwnProperty.call(previous, aliasId)) return previous;
  const next = { ...previous };
  const aliasValue = next[aliasId];
  delete next[aliasId];
  if (!Object.prototype.hasOwnProperty.call(next, canonicalId)) next[canonicalId] = aliasValue;
  else if (typeof mergeValues === 'function') next[canonicalId] = mergeValues(next[canonicalId], aliasValue);
  return next;
}

function migrateSessionList(previous, aliasId, canonicalId) {
  const rows = Array.isArray(previous) ? previous : [];
  const canonicalPresent = rows.some(item => sessionKey(item) === canonicalId);
  return rows.flatMap(item => {
    const id = sessionKey(item);
    if (id !== aliasId) return [item];
    if (canonicalPresent) return [];
    if (typeof item === 'string') return [canonicalId];
    return [{ ...item, session_id: canonicalId, canonical_session_id: canonicalId }];
  });
}

export default function SessionListScreen({ navigation, route }) {
  const reducedMotion = useReducedMotion();
  const [sessionRegistry, setSessionRegistry] = useState(() => createSessionRegistry());
  const sessions = sessionRegistry.list;
  const setSessions = useCallback(updater => {
    setSessionRegistry(previous => {
      const next = typeof updater === 'function' ? updater(previous.list) : updater;
      return reconcileSessionRegistry(previous, next);
    });
  }, []);
  const [activities,  setActivities]  = useState({});  // sessionId → activity obj | null
  const [connected,   setConnected]   = useState(false);
  const [connectionHealth, setConnectionHealth] = useState({ state: 'connecting', rttMs: null });
  const [loading,     setLoading]     = useState(true);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [reconnectInfo, setReconnectInfo] = useState(null); // { attempt, nextRetryMs }
  const [jwtDaysLeft,   setJwtDaysLeft]   = useState(null); // days until JWT expiry
  const [healthMap,     setHealthMap]     = useState({});    // sessionId → 'healthy'|'degraded'|'disconnected'
  const [unreadMap,     setUnreadMap]     = useState({});    // sessionId → unread count
  const [showHistory,   setShowHistory]   = useState(false);
  const [permPrompts,   setPermPrompts]   = useState({});    // sessionId → prompt object
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [groupAliases, setGroupAliases] = useState(DEFAULT_GROUP_ALIASES);
  const [showTestSessions, setShowTestSessions] = useState(false);
  const [showLaunch, setShowLaunch] = useState(false);
  const [launchState, setLaunchState] = useState(null);
  const [closingSessions, setClosingSessions] = useState({});
  const [sessionPreferences, setSessionPreferences] = useState({});
  const [showSessionPreferences, setShowSessionPreferences] = useState(false);
  const [managingSession, setManagingSession] = useState(null);
  const [titleDisclosure, setTitleDisclosure] = useState(null);
  const [duplicateProxyAlarms, setDuplicateProxyAlarms] = useState([]);
  const [nightlyValidationFailures, setNightlyValidationFailures] = useState([]);
  const [latestAppUpdateValidation, setLatestAppUpdateValidation] = useState(null);
  const [revalidationProgramHealth, setRevalidationProgramHealth] = useState(null);
  const [operatorDogfoodHealth, setOperatorDogfoodHealth] = useState(null);
  const [showValidationHealth, setShowValidationHealth] = useState(false);
  const [fleetControlPending, setFleetControlPending] = useState({});
  const [providerUsage, setProviderUsage] = useState(null);
  const [providerUsageRefreshReceipt, setProviderUsageRefreshReceipt] = useState(null);
  const [providerUsageResetReceipt, setProviderUsageResetReceipt] = useState(null);
  const [providerUsageCostDetail, setProviderUsageCostDetail] = useState(null);
  const [providerUsageNowMs, setProviderUsageNowMs] = useState(Date.now());
  const [estimatedCostDays, setEstimatedCostDays] = useState(1);
  const [estimatedCostProject, setEstimatedCostProject] = useState('');
  const [collapsedProviderUsage, setCollapsedProviderUsage] = useState({});
  const [showUsageDashboard, setShowUsageDashboard] = useState(false);
  const [showHostResourceDashboard, setShowHostResourceDashboard] = useState(false);
  const [hostResources, setHostResources] = useState(null);
  const [hostResourceError, setHostResourceError] = useState(null);
  const [hostResourceHistory, setHostResourceHistory] = useState([]);
  const [hostResourceDetails, setHostResourceDetails] = useState([]);
  const [hostResourceSubscription, setHostResourceSubscription] = useState({ id: '', status: 'idle', aggregateOnly: false, resumed: false });
  const [hostResourceAggregateOnly, setHostResourceAggregateOnly] = useState(false);
  const [hostResourceRange, setHostResourceRange] = useState('live');
  const [hostResourcePausedSequence, setHostResourcePausedSequence] = useState(null);
  const [hostResourcePausedAtMs, setHostResourcePausedAtMs] = useState(null);
  const [hostResourceViewport, setHostResourceViewport] = useState({ start: 0, end: 1 });
  const [hostResourceCrosshairSequence, setHostResourceCrosshairSequence] = useState(0);
  const [hostResourceProcessSearch, setHostResourceProcessSearch] = useState('');
  const [hostResourceProcessFilter, setHostResourceProcessFilter] = useState('all');
  const [hostResourceProcessSort, setHostResourceProcessSort] = useState('cpu');
  const [hostResourceExpandedProcesses, setHostResourceExpandedProcesses] = useState({});
  const [hostResourceSelectedProcessKey, setHostResourceSelectedProcessKey] = useState('');
  const [hostResourceNowMs, setHostResourceNowMs] = useState(Date.now());
  const [showFleetView, setShowFleetView] = useState(false);
  const [showFleetIdle, setShowFleetIdle] = useState(false);
  const [showTranscriptSearch, setShowTranscriptSearch] = useState(false);
  useEffect(() => {
    if (!route?.params?.openUsageNonce) return;
    setShowUsageDashboard(true);
    setShowHostResourceDashboard(false);
    setShowFleetView(false);
    setShowTranscriptSearch(false);
  }, [route?.params?.openUsageNonce]);
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('');
  const [transcriptSearchProject, setTranscriptSearchProject] = useState('');
  const [transcriptSearchHarness, setTranscriptSearchHarness] = useState('');
  const [transcriptSearchFrom, setTranscriptSearchFrom] = useState('');
  const [transcriptSearchTo, setTranscriptSearchTo] = useState('');
  const [transcriptSearchResults, setTranscriptSearchResults] = useState([]);
  const [transcriptSearchLoading, setTranscriptSearchLoading] = useState(false);
  const [transcriptSearchError, setTranscriptSearchError] = useState('');
  const [transcriptSearchIndexReady, setTranscriptSearchIndexReady] = useState(true);
  const [fleetNowMs, setFleetNowMs] = useState(Date.now());
  const [broadcastSelectedIds, setBroadcastSelectedIds] = useState([]);
  const [broadcastPrompt, setBroadcastPrompt] = useState('');
  const [broadcastConfirmation, setBroadcastConfirmation] = useState('');
  const [broadcastError, setBroadcastError] = useState('');
  const [broadcastReceipts, setBroadcastReceipts] = useState({});
  const [sidebarTranscriptTitles, setSidebarTranscriptTitles] = useState({});
  const clientRef     = useRef(null);
  const fleetControlPendingRef = useRef({});
  const hostResourceRouteOpenRef = useRef(false);
  const hostResourceAggregateOnlyRef = useRef(false);
  const hostResourceSubscriptionRef = useRef('');
  const hostResourceHistoryRequestRef = useRef({ system: '', detail: '' });
  const hostResourceHistoryCursorRef = useRef({ system: 0, detail: 0 });
  const hostResourceLastLiveSequenceRef = useRef({ system: 0, detail: 0 });
  const stateSequenceGateRef = useRef(createStateSequenceGate());
  const activeSessionRef = useRef(null);                     // session currently being viewed
  const launchRequestRef = useRef(null);
  const sidebarInteractionTimerRef = useRef(null);
  const [sidebarStructureLocked, setSidebarStructureLocked] = useState(false);

  const beginSidebarInteraction = useCallback(() => {
    if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
    sidebarInteractionTimerRef.current = null;
    setSidebarStructureLocked(true);
  }, []);
  const endSidebarInteraction = useCallback((delay = 0) => {
    if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
    sidebarInteractionTimerRef.current = setTimeout(() => {
      sidebarInteractionTimerRef.current = null;
      setSidebarStructureLocked(false);
    }, delay);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(COLLAPSED_DIRECTORY_KEY).then(raw => {
      const stored = JSON.parse(raw || '[]');
      if (Array.isArray(stored)) {
        setCollapsedGroups(Object.fromEntries(stored.map(key => [String(key), true])));
      }
    }).catch(() => {});
    AsyncStorage.getItem(GROUP_ALIAS_STORAGE_KEY).then(raw => {
      const aliases = normalizeGroupAliases(JSON.parse(raw || '{}'));
      setGroupAliases(aliases);
      return AsyncStorage.setItem(GROUP_ALIAS_STORAGE_KEY, JSON.stringify(aliases));
    }).catch(() => {});
    AsyncStorage.getItem(SHOW_TEST_SESSIONS_KEY)
      .then(value => setShowTestSessions(value === '1'))
      .catch(() => {});
    return () => {
      if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
    };
  }, []);

  const toggleTestSessions = useCallback(() => {
    setShowTestSessions(previous => {
      const next = !previous;
      AsyncStorage.setItem(SHOW_TEST_SESSIONS_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    if (!showFleetView) return undefined;
    setFleetNowMs(Date.now());
    const timer = setInterval(() => setFleetNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showFleetView]);

  useEffect(() => {
    if (!showHostResourceDashboard) return undefined;
    hostResourceRouteOpenRef.current = true;
    hostResourceAggregateOnlyRef.current = hostResourceAggregateOnly;
    hostResourceSubscriptionRef.current = '';
    hostResourceHistoryRequestRef.current = { system: '', detail: '' };
    hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
    hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
    setHostResources(null);
    setHostResourceError(null);
    setHostResourceHistory([]);
    setHostResourceDetails([]);
    setHostResourceSubscription({ id: '', status: 'subscribing', aggregateOnly: hostResourceAggregateOnly, resumed: false });
    setHostResourceNowMs(Date.now());
    clientRef.current?.subscribeHostResources(hostResourceAggregateOnly);
    const clockTimer = setInterval(() => setHostResourceNowMs(Date.now()), 1_000);
    return () => {
      hostResourceRouteOpenRef.current = false;
      clientRef.current?.unsubscribeHostResources();
      clearInterval(clockTimer);
      hostResourceSubscriptionRef.current = '';
      hostResourceHistoryRequestRef.current = { system: '', detail: '' };
      setHostResources(null);
      setHostResourceError(null);
      setHostResourceHistory([]);
      setHostResourceDetails([]);
      setHostResourceSubscription({ id: '', status: 'idle', aggregateOnly: false, resumed: false });
    };
  }, [showHostResourceDashboard, hostResourceAggregateOnly]);

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups(previous => {
      const next = { ...previous, [key]: !previous[key] };
      const persisted = Object.keys(next).filter(groupKey => next[groupKey]);
      AsyncStorage.setItem(COLLAPSED_DIRECTORY_KEY, JSON.stringify(persisted)).catch(() => {});
      return next;
    });
  }, []);

  const loadSessionPreferences = useCallback(async () => {
    const jwt = await getStoredJwt();
    if (!jwt) return;
    const response = await fetch(`${RELAY_URL}/api/preferences/sessions`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to load session settings.');
    setSessionPreferences(body.preferences || {});
  }, []);

  async function saveSessionPreference(sessionIdValue, updates) {
    const jwt = await getStoredJwt();
    if (!jwt) throw new Error('Sign in again to sync session settings.');
    const response = await fetch(`${RELAY_URL}/api/preferences/sessions/${encodeURIComponent(sessionIdValue)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preference: updates }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to save session settings.');
    setSessionPreferences(previous => ({ ...previous, [sessionIdValue]: body.preference }));
    return body.preference;
  }

  async function runTranscriptSearch() {
    if (transcriptSearchQuery.trim().length < 2 || transcriptSearchLoading) return;
    setTranscriptSearchLoading(true);
    setTranscriptSearchError('');
    try {
      const jwt = await getStoredJwt();
      if (!jwt) throw new Error('Sign in again to search transcripts.');
      const params = new URLSearchParams({ q: transcriptSearchQuery.trim(), limit: '50' });
      if (transcriptSearchProject.trim()) params.set('project', transcriptSearchProject.trim());
      if (transcriptSearchHarness.trim()) params.set('harness', transcriptSearchHarness.trim());
      if (transcriptSearchFrom.trim()) params.set('date_from', transcriptSearchFrom.trim());
      if (transcriptSearchTo.trim()) params.set('date_to', transcriptSearchTo.trim());
      const response = await fetch(`${RELAY_URL}/api/search/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Transcript search failed.');
      setTranscriptSearchResults(Array.isArray(body.results) ? body.results : []);
      setTranscriptSearchIndexReady(body.index?.ready !== false);
    } catch (error) {
      setTranscriptSearchResults([]);
      setTranscriptSearchError(error?.message || 'Transcript search failed.');
    } finally {
      setTranscriptSearchLoading(false);
    }
  }

  // ── Message handler ─────────────────────────────────────────────────────────

  const refreshSidebarTranscriptTitle = useCallback((sid, transcript) => {
    if (!sid) return;
    const nextTitle = titleFromSessionMessages(transcript);
    setSidebarTranscriptTitles(previous => {
      if ((previous[sid] || '') === nextTitle) return previous;
      return { ...previous, [sid]: nextTitle };
    });
  }, []);

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'connection_ack') stateSequenceGateRef.current.reset(msg.state_epoch);
    const stateSessionId = msg.session || msg.session_id || '';
    const stateKey = msg.type === 'session_list'
      ? 'session_list'
      : ((msg.type === 'status' || msg.type === 'session_summary' || msg.type === 'session_patch') && stateSessionId)
        ? `status:${stateSessionId}`
        : '';
    if (stateKey && !stateSequenceGateRef.current.accept(msg, stateKey)) return;
    const receiptEvent = broadcastReceiptEvent(msg);
    if (receiptEvent) {
      setBroadcastReceipts(previous => {
        let changed = false;
        const next = {};
        Object.entries(previous).forEach(([sessionIdValue, receipt]) => {
          if (receipt.clientMessageId !== receiptEvent.clientMessageId
            || BROADCAST_RECEIPT_RANK[receiptEvent.status] < BROADCAST_RECEIPT_RANK[receipt.status]) {
            next[sessionIdValue] = receipt;
            return;
          }
          next[sessionIdValue] = { ...receipt, status: receiptEvent.status, error: receiptEvent.error || null };
          changed = true;
        });
        return changed ? next : previous;
      });
    }
    switch (msg.type) {
      case 'session_alias_reconciled': {
        const aliasId = String(msg.alias_session_id || '').trim();
        const canonicalId = String(msg.canonical_session_id || '').trim();
        if (!aliasId || !canonicalId || aliasId === canonicalId) break;
        setSessions(previous => migrateSessionList(previous, aliasId, canonicalId));
        setActivities(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setHealthMap(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setUnreadMap(previous => migrateSessionKeyedObject(
          previous, aliasId, canonicalId, (canonical, alias) => Number(canonical || 0) + Number(alias || 0),
        ));
        setPermPrompts(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setClosingSessions(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setSessionPreferences(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setFleetControlPending(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        fleetControlPendingRef.current = migrateSessionKeyedObject(
          fleetControlPendingRef.current, aliasId, canonicalId,
        );
        setBroadcastSelectedIds(previous => [...new Set(previous.map(id => id === aliasId ? canonicalId : id))]);
        setBroadcastReceipts(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setSidebarTranscriptTitles(previous => migrateSessionKeyedObject(previous, aliasId, canonicalId));
        setTranscriptSearchResults(previous => previous.map(result => {
          const resultSessionId = result?.session_id || result?.session;
          return resultSessionId === aliasId
            ? { ...result, session_id: canonicalId, session: canonicalId }
            : result;
        }));
        setManagingSession(previous => {
          if (!previous) return previous;
          if (typeof previous === 'string') return previous === aliasId ? canonicalId : previous;
          return sessionKey(previous) === aliasId
            ? { ...previous, session_id: canonicalId, canonical_session_id: canonicalId }
            : previous;
        });
        if (activeSessionRef.current === aliasId) activeSessionRef.current = canonicalId;
        break;
      }

      case '_connected':
        setConnected(true);
        setLoading(false);
        setReconnectInfo(null);
        break;

      case '_disconnected':
        setConnected(false);
        fleetControlPendingRef.current = {};
        setFleetControlPending({});
        if (msg.reason === 'unauthenticated') {
          signOut().then(() => navigation.replace('Login'));
        }
        break;

      case '_reconnecting':
        setReconnectInfo({ attempt: msg.attempt, nextRetryMs: msg.nextRetryMs });
        break;

      case '_connection_health':
        setConnectionHealth({ state: msg.state || 'connecting', rttMs: msg.rttMs ?? null });
        break;

      case 'session_list':
        setSessions(msg.sessions || []);
        setClosingSessions(previous => {
          const liveIds = new Set((msg.sessions || []).map(item => typeof item === 'string' ? item : (item.session_id || item.id)));
          return Object.fromEntries(Object.entries(previous).filter(([id]) => liveIds.has(id)));
        });
        break;

      case 'status': {
        const sid = msg.session;
        if (!sid) break;
        const kind = String(msg.activity?.kind || (msg.thinking ? 'thinking' : 'idle')).toLowerCase();
        const generating = !!msg.thinking || ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(kind);
        setActivities(prev => ({
          ...prev,
          [sid]: {
            ...(msg.activity || {}),
            kind,
            generating,
            label: msg.label || msg.activity?.label || (generating ? 'Thinking' : ''),
            transport: normalizeFleetActivityTrace(msg.activity_trace),
          },
        }));
        break;
      }

      case 'connection_ack':
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_proxy_alarms) ? msg.duplicate_proxy_alarms : []);
        setNightlyValidationFailures(Array.isArray(msg.nightly_validation_failures) ? msg.nightly_validation_failures : []);
        setLatestAppUpdateValidation(msg.latest_app_update_validation || null);
        setRevalidationProgramHealth(msg.revalidation_program_health || null);
        setOperatorDogfoodHealth(msg.operator_dogfood_health || null);
        if (msg.provider_usage && typeof msg.provider_usage === 'object') {
          setProviderUsage(previous => retainNewerProviderUsage(previous, msg.provider_usage));
        }
        if (msg.sessions) {
          setSessions(msg.sessions);
        }
        if (msg.session_health) {
          setHealthMap(msg.session_health);
        }
        {
          const restored = {};
          [...(msg.open_prompts || []), ...(msg.open_question_prompts || [])].forEach(p => {
            const sid = p.session_id || p.session;
            if (sid) {
              restored[sid] = p;
              rememberPromptForAttentionFeedback(p);
            }
          });
          setPermPrompts(restored);
        }
        (msg.semantic_notifications || []).forEach(event => {
          processSemanticNotification(event, activeSessionRef.current).catch(() => {});
        });
        break;

      case 'semantic_notification':
        processSemanticNotification(msg, activeSessionRef.current).catch(() => {});
        break;

      case 'provider_usage_snapshot':
        if (msg.snapshot && typeof msg.snapshot === 'object') {
          setProviderUsage(previous => retainNewerProviderUsage(previous, msg.snapshot));
        }
        break;

      case 'provider_usage_threshold': {
        const affected = new Set(Array.isArray(msg.affected_session_ids) ? msg.affected_session_ids.map(String) : []);
        if (affected.size > 0) setSessions(previous => previous.map(item => {
          const sid = sessionKey(item);
          if (!affected.has(sid)) return item;
          return {
            ...(typeof item === 'object' ? item : {}),
            session_id: sid,
            percent_used: Number.isFinite(Number(msg.percent_used)) ? Number(msg.percent_used) : null,
            rate_limit_active: msg.hard_limited === true,
            rate_limited_until: msg.reset_hint || 'unknown',
            usage_limit_provider: msg.provider_id || null,
            usage_limit_window: msg.window_label || msg.window_id || null,
          };
        }));
        break;
      }

      case 'provider_usage_refresh_receipt':
        setProviderUsageRefreshReceipt(previous => (
          !previous || !msg.request_id || previous.requestId === msg.request_id
            ? { requestId: msg.request_id || previous?.requestId || '', status: msg.status || 'error', ...msg }
            : previous
        ));
        break;

      case 'provider_usage_reset_credit_receipt':
        setProviderUsageResetReceipt(previous => (
          !previous || !msg.request_id || previous.requestId === msg.request_id
            ? { requestId: msg.request_id || previous?.requestId || '', status: msg.status || 'error', ...msg }
            : previous
        ));
        break;

      case 'provider_usage_cost_detail':
        setProviderUsageCostDetail(previous => previous?.requestId === msg.request_id
          ? { ...previous, status: 'ready', detail: msg.detail, error: null }
          : previous);
        break;

      case 'provider_usage_cost_detail_error':
        setProviderUsageCostDetail(previous => previous?.requestId === msg.request_id
          ? { ...previous, status: 'error', error: msg.code || 'cost_detail_failed' }
          : previous);
        break;

      case 'host_resource_snapshot':
        if (msg.snapshot && typeof msg.snapshot === 'object') {
          setHostResources(msg.snapshot);
          setHostResourceError(null);
        }
        break;

      case 'host_resource_subscription_ack': {
        if (!hostResourceRouteOpenRef.current
          || typeof msg.subscription_id !== 'string'
          || (msg.aggregate_only === true) !== hostResourceAggregateOnlyRef.current) break;
        const previousId = hostResourceSubscriptionRef.current;
        const subscriptionId = msg.subscription_id;
        const resumed = msg.resumed === true && previousId === subscriptionId;
        hostResourceSubscriptionRef.current = subscriptionId;
        if (!resumed) {
          setHostResources(null);
          setHostResourceHistory([]);
          setHostResourceDetails([]);
          hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
          hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
        }
        setHostResourceSubscription({ id: subscriptionId, status: 'live', aggregateOnly: msg.aggregate_only === true, resumed });
        for (const stream of ['system', 'detail']) {
          const requestId = clientRef.current?.requestHostResourceHistory(
            stream, resumed ? hostResourceHistoryCursorRef.current[stream] : 0,
          );
          if (requestId) hostResourceHistoryRequestRef.current[stream] = requestId;
        }
        break;
      }

      case 'host_resource_history_chunk': {
        const stream = msg.chunk?.stream === 'detail' ? 'detail' : msg.chunk?.stream === 'system' ? 'system' : '';
        if (!stream || msg.subscription_id !== hostResourceSubscriptionRef.current
          || msg.request_id !== hostResourceHistoryRequestRef.current[stream]) break;
        const points = Array.isArray(msg.chunk.points) ? msg.chunk.points : [];
        if (stream === 'system') {
          setHostResourceHistory(previous => mergeOrderedHostResourceFrames(previous, points, 900));
        } else {
          setHostResourceDetails(previous => mergeOrderedHostResourceFrames(previous, points, 180));
          const latest = [...points].filter(point => point && typeof point === 'object')
            .sort((left, right) => Number(left.sample_sequence || 0) - Number(right.sample_sequence || 0)).at(-1);
          if (latest) setHostResources(latest);
        }
        const nextSequence = Math.max(
          hostResourceHistoryCursorRef.current[stream], Number(msg.chunk.next_sequence) || 0,
        );
        hostResourceHistoryCursorRef.current[stream] = nextSequence;
        hostResourceHistoryRequestRef.current[stream] = '';
        if (msg.chunk.done !== true) {
          const requestId = clientRef.current?.requestHostResourceHistory(stream, nextSequence);
          if (requestId) hostResourceHistoryRequestRef.current[stream] = requestId;
        }
        break;
      }

      case 'host_resource_live': {
        const sequence = Number(msg.point?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current
          || !Number.isSafeInteger(sequence)
          || sequence <= hostResourceLastLiveSequenceRef.current.system) break;
        hostResourceLastLiveSequenceRef.current.system = sequence;
        hostResourceHistoryCursorRef.current.system = Math.max(hostResourceHistoryCursorRef.current.system, sequence);
        setHostResourceHistory(previous => mergeOrderedHostResourceFrames(previous, msg.point, 900));
        setHostResourceError(null);
        break;
      }

      case 'host_resource_detail': {
        const sequence = Number(msg.snapshot?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current
          || !Number.isSafeInteger(sequence)
          || sequence <= hostResourceLastLiveSequenceRef.current.detail) break;
        hostResourceLastLiveSequenceRef.current.detail = sequence;
        hostResourceHistoryCursorRef.current.detail = Math.max(hostResourceHistoryCursorRef.current.detail, sequence);
        setHostResourceDetails(previous => mergeOrderedHostResourceFrames(previous, msg.snapshot, 180));
        setHostResources(msg.snapshot);
        setHostResourceError(null);
        break;
      }

      case 'host_resource_error':
        setHostResourceError({
          code: msg.code || 'unavailable',
          message: msg.message || 'Windows host metrics are unavailable.',
        });
        break;

      case 'session_health': {
        const sid = msg.session || msg.session_id;
        if (sid) setHealthMap(prev => ({ ...prev, [sid]: msg.health }));
        break;
      }

      case 'session_patch': {
        const sid = msg.session || msg.session_id;
        if (!sid) break;
        setSessionRegistry(previous => patchSessionRegistry(previous, msg));
        const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
        if (patch.activity) {
          const kind = String(patch.activity.kind || 'idle').toLowerCase();
          setActivities(previous => ({
            ...previous,
            [sid]: {
              ...patch.activity,
              kind,
              generating: ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(kind),
            },
          }));
        }
        if (patch.status) setHealthMap(previous => ({ ...previous, [sid]: patch.status }));
        break;
      }

      case 'rate_limit_active': {
        const sid = msg.session || msg.session_id;
        if (sid) setSessions(previous => previous.map(item => sessionKey(item) === sid ? {
          ...item,
          rate_limit_active: msg.percent_used == null || Number(msg.percent_used) >= 100,
          rate_limited_until: msg.retry_after_hint || 'unknown',
          percent_used: msg.percent_used ?? null,
        } : item));
        break;
      }

      case 'rate_limit_cleared': {
        const sid = msg.session || msg.session_id;
        if (sid) setSessions(previous => previous.map(item => sessionKey(item) === sid ? {
          ...item, rate_limit_active: false, rate_limited_until: null, percent_used: null,
        } : item));
        break;
      }

      case 'session_summary': {
        const sid = msg.session_id || msg.session;
        if (!sid) break;
        setSessions(previous => previous.map(item => {
          const id = typeof item === 'string' ? item : (item.session_id || item.id);
          if (id !== sid) return item;
          return {
            ...(typeof item === 'object' ? item : {}),
            session_id: sid,
            ...(msg.status ? { status: msg.status } : {}),
            ...(msg.activity ? { activity: msg.activity } : {}),
            ...(msg.goal ? { goal: msg.goal } : {}),
            ...(msg.fleet_summary ? { fleet_summary: msg.fleet_summary } : {}),
            ...(msg.fleet_work_context ? { fleet_work_context: msg.fleet_work_context } : {}),
            ...(msg.last_user_request ? { last_user_request: msg.last_user_request } : {}),
            ...(msg.last_snippet != null ? { last_snippet: msg.last_snippet } : {}),
            ...latestVisibleMessageSessionPatch(msg),
            ...sessionChatTitleMetadataPatch(msg),
          };
        }));
        if (msg.status) setHealthMap(previous => ({ ...previous, [sid]: msg.status }));
        if (msg.activity) {
          const kind = String(msg.activity.kind || 'idle').toLowerCase();
          setActivities(previous => ({
            ...previous,
            [sid]: {
              ...msg.activity,
              kind,
              generating: isTranscriptActivityLive(msg.activity),
              label: msg.activity.label || '',
              transport: normalizeFleetActivityTrace(msg.activity_trace),
            },
          }));
        }
        if (Number(msg.unread_delta) > 0 && sid !== activeSessionRef.current) {
          setUnreadMap(previous => ({
            ...previous,
            [sid]: (previous[sid] || 0) + Number(msg.unread_delta),
          }));
        }
        break;
      }

      case 'message': {
        // A subscribed list client should receive session_summary instead of
        // full transcript rows. Preserve lightweight metadata if an older
        // relay leaks a row, but never hydrate the transcript cache here.
        const msgSid = msg.session;
        if (msgSid && msgSid !== activeSessionRef.current && msg.role === 'assistant') {
          setUnreadMap(prev => ({ ...prev, [msgSid]: (prev[msgSid] || 0) + 1 }));
        }
        if (msgSid) {
          refreshSidebarTranscriptTitle(msgSid, [msg]);
          const latestMessagePatch = latestVisibleMessageSessionPatch(msg);
          if (Object.keys(latestMessagePatch).length > 0) {
            setSessions(previous => previous.map(item => (
              sessionKey(item) === msgSid
                ? { ...(typeof item === 'object' ? item : {}), session_id: msgSid, ...latestMessagePatch }
                : item
            )));
          }
        }
        break;
      }

      case 'history':
      case 'history_snapshot':
      case 'history_chunk':
      case 'history_delta': {
        // The list route never requests history and must not populate the
        // shared transcript LRU from background traffic.
        break;
      }

      case 'permission_prompt': {
        const sid = msg.session_id || msg.session;
        if (sid) {
          notePromptForAttentionFeedback(msg, activeSessionRef.current).catch(() => {});
          setPermPrompts(prev => ({ ...prev, [sid]: msg }));
        }
        break;
      }

      case 'question_prompt': {
        const sid = msg.session_id || msg.session;
        if (sid) {
          notePromptForAttentionFeedback(msg, activeSessionRef.current).catch(() => {});
          setPermPrompts(prev => ({ ...prev, [sid]: { ...msg, type: 'question_prompt' } }));
        }
        break;
      }

      case 'question_prompt_state': {
        const sid = msg.session_id || msg.session;
        if (!sid) break;
        if (msg.lifecycle === 'failed' || ['open', 'submitting'].includes(msg.lifecycle)) {
          setPermPrompts(prev => {
            const current = prev[sid];
            const samePrompt = current?.prompt_id === msg.prompt_id && current?.generation === msg.generation;
            if (current && !samePrompt) return prev;
            return {
              ...prev,
              [sid]: {
                ...(samePrompt ? current : {}),
                ...msg,
                type: 'question_prompt',
              },
            };
          });
        } else {
          setPermPrompts(prev => {
            const current = prev[sid];
            if (current?.prompt_id !== msg.prompt_id || current?.generation !== msg.generation) return prev;
            clearPromptAttentionFeedback(msg);
            const { [sid]: _, ...rest } = prev;
            return rest;
          });
        }
        break;
      }

      case 'permission_prompt_expired': {
        const sid = msg.session_id || msg.session;
        if (sid) {
          setPermPrompts(prev => {
            if (prev[sid]?.prompt_id !== msg.prompt_id) return prev;
            clearPromptAttentionFeedback(msg);
            const { [sid]: _, ...rest } = prev;
            return rest;
          });
        }
        break;
      }

      case 'agent_control_result': {
        const sid = msg.session_id || msg.session;
        if (sid && msg.command === 'permission_response' && msg.result === 'ok') {
          setPermPrompts(prev => {
            if (!prev[sid]) return prev;
            clearPromptAttentionFeedback(msg);
            const { [sid]: _, ...rest } = prev;
            return rest;
          });
        }
        if (sid && ['agent_goal_control', 'agent_interrupt'].includes(msg.command)) {
          const pending = fleetControlPendingRef.current[sid];
          if (pending?.requestId === msg.request_id) {
            const next = { ...fleetControlPendingRef.current };
            delete next[sid];
            fleetControlPendingRef.current = next;
            setFleetControlPending(next);
            if (msg.result === 'failed') {
              Alert.alert(
                msg.command === 'agent_goal_control' ? 'Goal control failed' : 'Interrupt failed',
                msg.error?.message || 'The native control was not acknowledged.',
              );
            }
          }
        }
        break;
      }

      case 'session_meta':
        // Update display name if server sends it
        setSessions(prev =>
          prev.map(s =>
            (s.session_id || s.id || s) === msg.session_id
              ? { ...(typeof s === 'string' ? { session_id: s } : s), name: msg.name }
              : s
          )
        );
        break;

      case 'duplicate_proxy_alarm':
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_sessions) ? msg.duplicate_sessions : []);
        break;

      case 'nightly_validation_status':
        setNightlyValidationFailures(Array.isArray(msg.failures) ? msg.failures : []);
        if (msg.revalidation_program_health) setRevalidationProgramHealth(msg.revalidation_program_health);
        if (msg.operator_dogfood_health) setOperatorDogfoodHealth(msg.operator_dogfood_health);
        break;

      case 'app_update_validation_status':
        setLatestAppUpdateValidation(msg.validation || null);
        break;

      case 'harness_revalidation_status':
        setRevalidationProgramHealth(msg.program_health || null);
        break;

      case 'operator_dogfood_status':
        setOperatorDogfoodHealth(msg.program_health || null);
        break;

      case 'session_launching': {
        if (launchRequestRef.current?.requestId === msg.request_id) {
          setLaunchState(previous => ({ ...(previous || {}), status: 'launching' }));
        }
        break;
      }

      case 'session_launch_ack': {
        if (launchRequestRef.current?.requestId !== msg.request_id) break;
        const launch = launchRequestRef.current;
        const sid = msg.session_id || msg.session;
        launchRequestRef.current = null;
        setLaunchState(null);
        setShowLaunch(false);
        setShowHistory(false);
        if (sid) {
          navigation.navigate('Chat', {
            sessionId: sid,
            title: `New ${agentBadge(msg.agent_type || launch.agentType).label}`,
            agentType: msg.agent_type || launch.agentType,
            session: { session_id: sid, agent_type: msg.agent_type || launch.agentType },
          });
        }
        break;
      }

      case 'session_launch_failed': {
        if (launchRequestRef.current?.requestId !== msg.request_id) break;
        const reason = msg.reason || msg.error?.message || msg.error || 'Launch failed';
        const mode = launchRequestRef.current.mode;
        launchRequestRef.current = null;
        setLaunchState({ status: 'failed', error: reason });
        if (mode === 'resume') Alert.alert('Could not resume session', reason);
        break;
      }

      case 'session_closed': {
        const sid = msg.session_id || msg.session;
        if (!sid) break;
        setSessions(previous => previous.filter(item => sessionId(item) !== sid));
        setClosingSessions(previous => {
          const next = { ...previous };
          delete next[sid];
          return next;
        });
        break;
      }

      case 'connection_error': {
        if (msg.code === 'session_unknown') {
          setClosingSessions({});
          Alert.alert('Could not close session', msg.message || 'The session is no longer connected.');
        }
        break;
      }

      default:
        break;
    }
  }, [navigation, refreshSidebarTranscriptTitle]);

  // ── Connect / disconnect on focus ───────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      activeSessionRef.current = null; // back on session list — no session active
      refreshAttentionHapticPreference().catch(() => {});
      const client = new RelayClient(handleMessage);
      client.setSessionSubscriptions([]);
      clientRef.current = client;
      client.connect();

      // Register for push notifications once connected; subscribe to token rotation
      getStoredJwt().then(jwt => {
        if (jwt) registerForPushNotifications(jwt);
      });

      // Check JWT expiry — warn if < 7 days remaining
      getJwtDaysRemaining().then(days => setJwtDaysLeft(days));
      loadSessionPreferences().catch(() => {});

      return () => {
        client.disconnect();
        clientRef.current = null;
      };
    }, [handleMessage, loadSessionPreferences])
  );

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function sessionId(s)   { return typeof s === 'string' ? s : (s.session_id || s.id); }
  function sessionName(s) {
    const sid = sessionId(s);
    return resolveSessionChatTitle(
      typeof s === 'object' ? s : { session_id: sid },
      typeof s === 'object' ? s.custom_display_name : '',
      getCachedTranscript(sid) || [],
      sidebarTranscriptTitles[sid] || '',
    );
  }

  function sessionSubtitle(s) {
    if (typeof s !== 'object') return null;
    const harness = agentBadge(agentType(s)).label;
    const context = s.workspace_path || s.window_title;
    return context && context !== harness ? `${harness} · ${context}` : harness;
  }

  const sessionSearchText = (item) => [
    sessionName(item),
    sessionSubtitle(item),
    item?.workspace_name,
    item?.workspace_path,
    item?.window_title,
    item?.chat_title,
    item?.session_title,
    agentBadge(agentType(item)).label,
    agentType(item),
    sessionId(item),
  ].filter(Boolean).join(' ').toLowerCase();

  function activityLabel(sid, type) {
    const a = activities[sid];
    if (!a) return null;
    const substate = fleetGoalSubstateLabel(a, { connected, health: healthMap[sid] });
    const glyph = (type === 'claude' || type === 'claude_cli') ? '✻'
      : (type === 'codex' || type === 'codex-desktop' || type === 'codex_cli') ? '◌'
        : type === 'cursor' ? '•••' : '●';
    return `${glyph} ${substate || a.label || 'Generating'}`;
  }

  function healthDotColor(sid) {
    const health   = healthMap[sid];
    const activity = activities[sid];
    if (health === 'degraded')     return '#d29922';   // yellow
    if (health === 'disconnected') return '#484f58';   // gray
    if (activity?.generating)      return '#58a6ff';   // blue — active
    if (health === 'healthy')      return '#3fb950';   // green — idle
    return '#484f58';                                  // gray — unknown
  }

  const managedSessions = sessions.map(item => {
    const preference = sessionPreferences[sessionId(item)];
    if (!preference?.display_name) return item;
    return typeof item === 'object'
      ? { ...item, custom_display_name: preference.display_name }
      : { session_id: item, custom_display_name: preference.display_name };
  });
  const testSessionIds = new Set(managedSessions.filter(sessionIsTestSession).map(sessionId));
  const operatorSessions = managedSessions.filter(item => !sessionIsTestSession(item));
  const sidebarSessions = showTestSessions ? managedSessions : operatorSessions;
  const visibleSessions = sidebarSessions.filter(item => !sessionPreferences[sessionId(item)]?.archived);
  const operatorVisibleSessions = operatorSessions.filter(item => !sessionPreferences[sessionId(item)]?.archived);
  const sidebarNowMs = useSidebarFreshnessClock(activities, visibleSessions);
  const sidebarStateOptions = useMemo(() => ({
    activities,
    pendingPrompts: permPrompts,
    healthMap,
    connected,
    nowMs: sidebarNowMs,
    requireFreshness: true,
  }), [activities, permPrompts, healthMap, connected, sidebarNowMs]);
  const {
    working: workingSessionCandidates,
    states: sidebarStateBySessionId,
  } = useMemo(
    () => partitionSidebarSessionsByWorking(visibleSessions, sidebarStateOptions),
    [visibleSessions, sidebarStateOptions],
  );
  const { sessions: workingSessions } = useStableWorkingSessions(
    workingSessionCandidates,
    sidebarStructureLocked,
  );
  const workingSessionIds = useMemo(
    () => new Set(workingSessions.map(sessionId)),
    [workingSessions],
  );
  const { pinned: allPinnedSessions } = useMemo(
    () => partitionPinnedSessions(visibleSessions, sessionPreferences),
    [visibleSessions, sessionPreferences],
  );
  const pinnedSessionIds = useMemo(
    () => new Set(allPinnedSessions.map(sessionId)),
    [allPinnedSessions],
  );
  const recentChatOwnership = useMemo(
    () => projectRecentChatOwnership(visibleSessions, { workingSessionIds, pinnedSessionIds }),
    [visibleSessions, workingSessionIds, pinnedSessionIds],
  );
  const recentSessions = recentChatOwnership.recent;
  const pinnedSessions = recentChatOwnership.pinned;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const AGENT_BADGES = {
    claude:            { abbr: 'CC', color: '#cc785c', label: 'Claude Code' },
    claude_cli:        { abbr: 'CLI', color: '#d97757', label: 'Claude Code CLI' },
    'claude-desktop':  { abbr: 'CD', color: '#cc785c', label: 'Claude Desktop' },
    codex:             { abbr: 'CX', color: '#10a37f', label: 'Codex' },
    codex_cli:         { abbr: 'CLI', color: '#10a37f', label: 'Codex CLI' },
    'codex-desktop':   { abbr: 'CX', color: '#10a37f', label: 'Codex Desktop' },
    cursor:            { abbr: 'CR', color: '#7AA2F7', label: 'Cursor' },
    cursor_cli:        { abbr: 'CLI', color: '#7c6cf0', label: 'Cursor CLI' },
    gemini:            { abbr: 'GC', color: '#4285f4', label: 'Gemini' },
    continue:          { abbr: 'CN', color: '#d29922', label: 'Continue' },
    continue_yolo:     { abbr: 'CY', color: '#f59e0b', label: 'Continue YOLO' },
    roo_code:          { abbr: 'RC', color: '#06b6d4', label: 'Roo Code' },
    cline:             { abbr: 'CL', color: '#6366f1', label: 'Cline' },
    antigravity:       { abbr: 'AG', color: '#a855f7', label: 'Antigravity' },
    antigravity_panel: { abbr: 'AC', color: '#a855f7', label: 'Antigravity Chat' },
    'antigravity-v2':  { abbr: 'A2', color: '#7c3aed', label: 'Antigravity v2' },
  };
  const DEFAULT_BADGE = { abbr: 'AG', color: '#8b949e', label: 'Agent' };

  function agentType(s) {
    if (typeof s !== 'object') return 'unknown';
    return s.agent_type || 'unknown';
  }

  function agentBadge(type) {
    return AGENT_BADGES[type] || DEFAULT_BADGE;
  }

  const rawGroups = useMemo(
    () => groupSessionsByDirectory(recentChatOwnership.remaining, groupAliases),
    [recentChatOwnership.remaining, groupAliases],
  );
  const workspaceLabelBySessionId = useMemo(() => Object.fromEntries(
    groupSessionsByDirectory(visibleSessions, groupAliases).flatMap(group => (
      group.sessions.map(item => [sessionId(item), group.title])
    )),
  ), [visibleSessions, groupAliases]);

  const sidebarRankOptions = useMemo(() => ({
    ...sidebarStateOptions,
    rankWorking: false,
  }), [sidebarStateOptions]);
  const {
    groups: stableOrderedGroups,
    orderChanged: sidebarOrderChanged,
    sortNow: sortSidebarNow,
  } = useStableSidebarGroups(rawGroups, sidebarRankOptions, sidebarStructureLocked);
  const orderedGroups = useMemo(
    () => stableOrderedGroups.filter(group => group.sessions.length > 0),
    [stableOrderedGroups],
  );
  const summarizeSessions = groupSessions => groupSessions.reduce((result, item) => {
    const sid = sessionId(item);
    result.unread += testSessionIds.has(sid) ? 0 : unreadMap[sid] || 0;
    result.working = result.working || fleetStateIsWorking(sidebarStateBySessionId[sid]);
    result.hasPrompt = result.hasPrompt || !!permPrompts[sid];
    return result;
  }, { unread: 0, working: false, hasPrompt: false });
  const searchedWorkingSessions = normalizedSearchQuery
    ? workingSessions.filter(item => sessionSearchText(item).includes(normalizedSearchQuery))
    : workingSessions;
  const searchedPinnedSessions = normalizedSearchQuery
    ? pinnedSessions.filter(item => sessionSearchText(item).includes(normalizedSearchQuery))
    : pinnedSessions;
  const searchedRecentSessions = normalizedSearchQuery
    ? recentSessions.filter(item => sessionSearchText(item).includes(normalizedSearchQuery))
    : recentSessions;
  const pinnedSection = searchedPinnedSessions.length > 0 ? {
    key: '__pinned__',
    title: 'Pinned chats',
    count: searchedPinnedSessions.length,
    collapsed: false,
    pinned: true,
    ...summarizeSessions(searchedPinnedSessions),
    data: searchedPinnedSessions,
  } : null;
  const workingSection = searchedWorkingSessions.length > 0 ? {
    key: '__working__',
    title: 'Working now',
    count: searchedWorkingSessions.length,
    collapsed: false,
    workingNow: true,
    ...summarizeSessions(searchedWorkingSessions),
    data: searchedWorkingSessions,
  } : null;
  const recentCollapsed = !!collapsedGroups.__recent__ && !searchQuery;
  const recentSection = searchedRecentSessions.length > 0 ? {
    key: '__recent__',
    title: 'Recent chats',
    count: searchedRecentSessions.length,
    collapsed: recentCollapsed,
    recent: true,
    ...summarizeSessions(searchedRecentSessions),
    data: recentCollapsed ? [] : searchedRecentSessions,
  } : null;
  const sections = [workingSection, recentSection, pinnedSection, ...orderedGroups.map(group => {
    const groupSessions = normalizedSearchQuery
      ? group.sessions.filter(item => sessionSearchText(item).includes(normalizedSearchQuery))
      : group.sessions;
    if (groupSessions.length === 0) return null;
    const collapsed = !!collapsedGroups[group.key] && !searchQuery;
    const summary = summarizeSessions(groupSessions);
    return {
      key: group.key,
      title: group.title,
      count: groupSessions.length,
      collapsed,
      ...summary,
      data: collapsed ? [] : groupSessions,
    };
  })].filter(Boolean);
  const normalizedProviderUsage = useMemo(() => normalizeProviderUsage(providerUsage), [providerUsage]);
  const localSelectedEstimatedCost = useMemo(() => selectEstimatedCost(
    normalizedProviderUsage.estimatedCost,
    { days: estimatedCostDays, project: estimatedCostProject },
  ), [normalizedProviderUsage.estimatedCost, estimatedCostDays, estimatedCostProject]);
  const costDetailMatches = providerUsageCostDetail?.status === 'ready'
    && Number(providerUsageCostDetail.detail?.query?.days) === estimatedCostDays
    && String(providerUsageCostDetail.detail?.query?.project || '') === estimatedCostProject
    && (!normalizedProviderUsage.estimatedCost?.generatedAt
      || String(providerUsageCostDetail.detail?.generated_at || '') === normalizedProviderUsage.estimatedCost.generatedAt);
  const initialCostDetailMatches = (
    providerUsageCostDetail?.status === 'loading'
      ? Number(providerUsageCostDetail.query?.days) === estimatedCostDays
        && String(providerUsageCostDetail.query?.project || '') === estimatedCostProject
        && String(providerUsageCostDetail.query?.cursor || '0') === '0'
      : costDetailMatches && String(providerUsageCostDetail.detail?.pagination?.cursor || '0') === '0'
  );
  const selectedEstimatedCost = costDetailMatches ? {
    costUsd: Math.max(0, Number(providerUsageCostDetail.detail.summary?.cost_usd) || 0),
    records: Math.max(0, Number(providerUsageCostDetail.detail.summary?.records) || 0),
    tokens: {
      input: Math.max(0, Number(providerUsageCostDetail.detail.summary?.tokens?.input) || 0),
      cached: Math.max(0, Number(providerUsageCostDetail.detail.summary?.tokens?.cached) || 0),
      output: Math.max(0, Number(providerUsageCostDetail.detail.summary?.tokens?.output) || 0),
    },
    byModel: Array.isArray(providerUsageCostDetail.detail.summary?.by_model) ? providerUsageCostDetail.detail.summary.by_model : [],
    byDay: Array.isArray(providerUsageCostDetail.detail.summary?.by_day) ? providerUsageCostDetail.detail.summary.by_day : [],
  } : localSelectedEstimatedCost;
  const estimatedCostProjects = useMemo(() => [...new Set(
    (normalizedProviderUsage.estimatedCost?.byProject || []).map(row => row.project).filter(Boolean),
  )].sort(), [normalizedProviderUsage.estimatedCost]);
  const requestEstimatedCostDetail = useCallback(options => {
    const query = {
      days: estimatedCostDays,
      project: estimatedCostProject,
      cursor: '0',
      pageSize: 50,
      ...options,
    };
    const requestId = clientRef.current?.requestProviderUsageCostDetail(query);
    if (requestId) setProviderUsageCostDetail({ requestId, status: 'loading', query, detail: null, error: null });
  }, [estimatedCostDays, estimatedCostProject]);
  const normalizedHostResources = useMemo(() => normalizeHostResources(hostResources), [hostResources]);
  const visibleHostResourceHistory = useMemo(() => (
    hostResourcePausedSequence == null
      ? hostResourceHistory
      : hostResourceHistory.filter(frame => frame.sample_sequence <= hostResourcePausedSequence)
  ), [hostResourceHistory, hostResourcePausedSequence]);
  const hostResourceRangeNowMs = hostResourcePausedSequence == null
    ? hostResourceNowMs
    : hostResourcePausedAtMs || hostResourceNowMs;
  const rangedHostResourceHistory = useMemo(() => (
    selectHostResourceRange(visibleHostResourceHistory, hostResourceRange, {
      nowMs: hostResourceRangeNowMs,
      paused: hostResourcePausedSequence != null,
      subscriptionStatus: hostResourceSubscription.status,
      connected: hostResourceSubscription.status !== 'reconnecting',
      error: Boolean(hostResourceError),
    })
  ), [visibleHostResourceHistory, hostResourceRange, hostResourceRangeNowMs,
    hostResourcePausedSequence, hostResourceSubscription.status, hostResourceError]);
  const hostResourceTimelineProjection = useMemo(() => hostResourceTimeline(visibleHostResourceHistory, {
    nowMs: hostResourceRangeNowMs,
    paused: hostResourcePausedSequence != null,
    subscriptionStatus: hostResourceSubscription.status,
    connected: hostResourceSubscription.status !== 'reconnecting',
    error: Boolean(hostResourceError),
  }), [visibleHostResourceHistory, hostResourceRangeNowMs, hostResourcePausedSequence,
    hostResourceSubscription.status, hostResourceError]);
  const hostResourceStaleRefreshKeyRef = useRef('');
  useEffect(() => {
    if (!showHostResourceDashboard || hostResourcePausedSequence != null
      || !['delayed', 'stale'].includes(hostResourceTimelineProjection.status)) {
      hostResourceStaleRefreshKeyRef.current = '';
      return;
    }
    const key = `${hostResourceTimelineProjection.status}:${hostResourceTimelineProjection.points[hostResourceTimelineProjection.points.length - 1]?.sampleSequence || 0}`;
    if (hostResourceStaleRefreshKeyRef.current === key) return;
    hostResourceStaleRefreshKeyRef.current = key;
    clientRef.current?.requestHostResourceRefresh(false);
  }, [showHostResourceDashboard, hostResourcePausedSequence, hostResourceTimelineProjection.status,
    hostResourceTimelineProjection.points]);
  const hostResourceProcessRows = useMemo(() => androidHostResourceProcessRows(
    normalizedHostResources.processes,
    hostResourceProcessSearch,
    hostResourceProcessFilter,
    hostResourceProcessSort,
    hostResourceExpandedProcesses,
  ), [normalizedHostResources.processes, hostResourceProcessSearch, hostResourceProcessFilter, hostResourceProcessSort, hostResourceExpandedProcesses]);
  const selectedHostResourceProcess = normalizedHostResources.processes
    .find(process => process.stableKey === hostResourceSelectedProcessKey) || null;
  const selectedHostResourceFrames = useMemo(() => (hostResourceSelectedProcessKey ? hostResourceDetails.flatMap(detail => {
    const process = (detail.processes || []).find(entry => entry.stable_key === hostResourceSelectedProcessKey);
    if (!process) return [];
    return [{
      frame_kind: 'system', sample_sequence: detail.sample_sequence, captured_at: detail.captured_at,
      sample_interval_ms: detail.sample_interval_ms, dropped_gap_count: detail.dropped_gap_count,
      status: detail.status, cpu: { total_percent: process.cpu_host_percent },
      disk: { read_bps: process.io_read_bps, write_bps: process.io_write_bps },
    }];
  }) : []), [hostResourceDetails, hostResourceSelectedProcessKey]);
  useEffect(() => {
    if (!hostResourceCrosshairSequence && rangedHostResourceHistory.length) {
      setHostResourceCrosshairSequence(rangedHostResourceHistory[rangedHostResourceHistory.length - 1].sample_sequence);
    }
  }, [hostResourceCrosshairSequence, rangedHostResourceHistory]);
  useEffect(() => {
    if (!showUsageDashboard) return undefined;
    if (normalizedProviderUsage.collectionState === 'not-started') {
      clientRef.current?.requestProviderUsageRefresh(false);
    }
    setProviderUsageNowMs(Date.now());
    const timer = setInterval(() => setProviderUsageNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [showUsageDashboard, normalizedProviderUsage.collectionState]);
  useEffect(() => {
    if (!showUsageDashboard) return undefined;
    clientRef.current?.setProviderUsageWatching(true);
    return () => clientRef.current?.setProviderUsageWatching(false);
  }, [showUsageDashboard]);
  useEffect(() => {
    if (!showUsageDashboard || !normalizedProviderUsage.estimatedCost?.detail?.truncated) return;
    if (initialCostDetailMatches) return;
    requestEstimatedCostDetail({ cursor: '0' });
  }, [showUsageDashboard, normalizedProviderUsage.estimatedCost?.detail?.truncated,
    normalizedProviderUsage.estimatedCost?.detail?.pageSize,
    normalizedProviderUsage.estimatedCost?.generatedAt, estimatedCostDays,
    estimatedCostProject, requestEstimatedCostDetail]);
  const allFleetEntries = useMemo(() => operatorVisibleSessions.map(session => {
    const id = sessionId(session);
    const hasLiveActivity = Object.prototype.hasOwnProperty.call(activities, id);
    const activity = hasLiveActivity ? (activities[id] || { kind: 'idle', label: '' }) : (session?.activity || { kind: 'idle', label: '' });
    const type = agentType(session);
    const goalCapable = goalLifecycleSupported(type, session?.capabilities);
    const capabilitySafeActivity = goalCapable ? activity : { ...activity, goal: null };
    const attention = !!permPrompts[id] || session?.rate_limit_active === true
      || String(capabilitySafeActivity?.kind || '').toLowerCase() === 'waiting_for_user';
    const state = classifyFleetActivity(capabilitySafeActivity, attention, {
      connected,
      health: healthMap[id],
      nowMs: fleetNowMs,
      requireFreshness: true,
    });
    const needsAttention = state === 'needs_attention';
    const working = fleetStateIsWorking(state);
    const goalSubstate = fleetGoalSubstateLabel(capabilitySafeActivity, {
      connected,
      health: healthMap[id],
    });
    const badge = agentBadge(type);
    const workContext = projectFleetWorkContext({
      agentType: type,
      capabilities: session?.capabilities,
      activity: capabilitySafeActivity,
      latestUserRequest: session?.last_user_request || null,
    });
    const goal = workContext.kind === 'goal' ? capabilitySafeActivity?.goal || null : null;
    const goalState = String(goal?.state || goal?.status || '').toLowerCase();
    const goalBlocked = goalState === 'blocked';
    const blockedResumeSupported = goalBlocked && session?.capabilities?.goal_blocked_resume === true;
    const goalAction = goalState === 'active'
      ? 'pause'
      : (goalState === 'paused' || blockedResumeSupported ? 'resume' : null);
    const goalBlockedReason = goalBlocked
      ? String(goal?.block_reason || goal?.reason || capabilitySafeActivity?.label || 'Goal blocked').trim()
      : '';
    const activityKind = String(capabilitySafeActivity?.kind || '').toLowerCase();
    const turnActive = capabilitySafeActivity?.generating === true
      || ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(activityKind);
    const canControlGoal = !!(goalAction && goal?.fingerprint
      && session?.capabilities?.goal_pause_resume === true
      && Number(session?.control_generation) > 0);
    const canInterrupt = !!(turnActive && session?.capabilities?.interrupt === true
      && Number(session?.control_generation) > 0 && Number(session?.turn_generation) > 0);
    const usagePercent = Number(session?.percent_used);
    const usageReset = session?.rate_limited_until && session.rate_limited_until !== 'unknown'
      ? String(session.rate_limited_until) : '';
    const usageStatus = session?.rate_limit_active === true
      ? `Usage limited${usageReset ? ` · resets ${usageReset}` : ' · reset unknown'}`
      : Number.isFinite(usagePercent) && usagePercent >= 75
        ? `Usage ${Math.round(usagePercent)}% used${usageReset ? ` · resets ${usageReset}` : ''}`
        : '';
    return {
      id,
      session,
      activity: capabilitySafeActivity,
      attention: needsAttention,
      working,
      state,
      stateLabel: session?.rate_limit_active === true ? 'Usage limited' : fleetStateLabel(state),
      goal,
      goalAction,
      goalBlocked,
      goalBlockedReason,
      canControlGoal,
      canInterrupt,
      badge,
      title: sessionName(session),
      status: usageStatus || (attention ? 'Action required' : (goalSubstate || capabilitySafeActivity?.label || (state === 'idle' ? (goal ? 'Goal paused' : 'Idle') : String(capabilitySafeActivity?.kind || 'Working').replace(/_/g, ' ')))),
      workContext,
      progress: fleetWorkContextProgress(workContext),
      snippet: fleetSnippet(session),
      healthColor: healthDotColor(id),
      canReceiveBroadcast: sessionSupportsBroadcast(session, healthMap[id] || 'unknown', connected),
      freshness: fleetFreshnessLabel(activity, fleetNowMs),
      activityLatencyMs: Number.isFinite(Number(activity?.transport?.latency_ms)) ? Math.round(Number(activity.transport.latency_ms)) : null,
    };
  }).filter(Boolean).sort((left, right) => (
    Number(right.attention) - Number(left.attention)
    || Number(right.working) - Number(left.working)
    || left.title.localeCompare(right.title)
  )), [operatorVisibleSessions, activities, permPrompts, healthMap, connected, fleetNowMs]);
  const fleetEntries = useMemo(() => allFleetEntries.filter(entry => showFleetIdle || entry.state !== 'idle' || entry.goal), [allFleetEntries, showFleetIdle]);
  const fleetAttentionCount = allFleetEntries.filter(item => item.state === 'needs_attention').length;
  const fleetWorkingCount = allFleetEntries.filter(item => item.working).length;
  const fleetWorkingGoalCount = allFleetEntries.filter(item => item.state === 'working_goal').length;
  const fleetIdleCount = allFleetEntries.filter(item => item.state === 'idle').length;
  const fleetEntryById = useMemo(() => Object.fromEntries(fleetEntries.map(entry => [entry.id, entry])), [fleetEntries]);
  const broadcastExpectedConfirmation = `SEND TO ${broadcastSelectedIds.length} SESSIONS`;
  useEffect(() => {
    setBroadcastSelectedIds(previous => previous
      .filter(id => fleetEntryById[id]?.canReceiveBroadcast)
      .slice(0, MAX_BROADCAST_SESSIONS));
  }, [fleetEntryById]);

  function toggleBroadcastSelection(sessionIdValue) {
    setBroadcastError('');
    setBroadcastSelectedIds(previous => previous.includes(sessionIdValue)
      ? previous.filter(id => id !== sessionIdValue)
      : previous.length < MAX_BROADCAST_SESSIONS ? [...previous, sessionIdValue] : previous);
  }

  function submitBroadcast() {
    const normalized = normalizeBroadcastRequest({
      session_ids: broadcastSelectedIds,
      content: broadcastPrompt,
      confirmation: broadcastConfirmation,
    }, sessionIdValue => !!fleetEntryById[sessionIdValue]?.canReceiveBroadcast);
    if (!normalized.ok) {
      setBroadcastError(normalized.error);
      return;
    }
    const receipts = {};
    normalized.sessionIds.forEach((sessionIdValue, index) => {
      const clientMessageId = `android-broadcast-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
      clientRef.current?.sendMessage(sessionIdValue, normalized.content, clientMessageId);
      receipts[sessionIdValue] = {
        clientMessageId,
        status: 'queued',
        error: null,
        title: fleetEntryById[sessionIdValue]?.title || sessionIdValue,
      };
    });
    setBroadcastReceipts(receipts);
    setBroadcastPrompt('');
    setBroadcastConfirmation('');
    setBroadcastError('');
  }

  function handleSignOut() {
    clientRef.current?.disconnect();
    signOut().then(() => navigation.replace('Login'));
  }

  function beginLaunch(agentTypeValue, workspacePath, options) {
    const requestId = clientRef.current?.launchSession(agentTypeValue, workspacePath, options);
    if (!requestId) return;
    launchRequestRef.current = { requestId, mode: 'new', agentType: agentTypeValue };
    setLaunchState({ requestId, status: 'launching', agentType: agentTypeValue });
  }

  function beginResume(session) {
    const agentTypeValue = session.agent_type || 'claude';
    const requestId = clientRef.current?.resumeSession(
      session.session_id,
      agentTypeValue,
      session.workspace_path,
      {
        cli_session_id: session.cli_session_id,
        model_id: session.model_id,
        permission_mode: session.permission_mode,
      },
    );
    if (!requestId) return;
    launchRequestRef.current = { requestId, mode: 'resume', agentType: agentTypeValue };
    setLaunchState({ requestId, status: 'launching', agentType: agentTypeValue });
    setShowHistory(false);
  }

  function confirmCloseSession(item) {
    const sid = sessionId(item);
    const disconnected = healthMap[sid] === 'disconnected' || item?.status === 'disconnected';
    Alert.alert(
      disconnected ? 'Dismiss session?' : 'Close native session?',
      disconnected
        ? 'Remove this disconnected session from the list? Its saved history will remain available.'
        : 'This asks the desktop proxy to close the native session. Saved history will remain available.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: disconnected ? 'Dismiss' : 'Close',
          style: 'destructive',
          onPress: () => {
            setClosingSessions(previous => ({ ...previous, [sid]: true }));
            clientRef.current?.closeSession(sid, disconnected);
          },
        },
      ],
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.container}>
        <View style={{ padding: 12, gap: 8 }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} delay={i * 200} />)}
        </View>
      </View>
    );
  }

  const appUpdateValidationAgeMs = latestAppUpdateValidation?.completed_at
    ? Date.now() - Date.parse(latestAppUpdateValidation.completed_at)
    : Number.POSITIVE_INFINITY;
  const recentAppUpdateValidation = appUpdateValidationAgeMs >= 0 && appUpdateValidationAgeMs <= 24 * 60 * 60 * 1000
    ? latestAppUpdateValidation
    : null;
  const visibleNightlyValidationFailures = recentAppUpdateValidation
    ? nightlyValidationFailures.filter(item => item.run_id !== recentAppUpdateValidation.run_id)
    : nightlyValidationFailures;
  const dogfoodLatest = operatorDogfoodHealth?.latest || null;
  const dogfoodAgeMs = dogfoodLatest?.completed_at ? Date.now() - Date.parse(dogfoodLatest.completed_at) : Number.POSITIVE_INFINITY;
  const dogfoodStatus = !operatorDogfoodHealth || !dogfoodLatest || dogfoodAgeMs > 45 * 60 * 1000
    ? 'STALE' : String(operatorDogfoodHealth.status || dogfoodLatest.status || 'STALE').toUpperCase();
  const dogfoodOpenFingerprints = Array.isArray(operatorDogfoodHealth?.open_fingerprints)
    ? operatorDogfoodHealth.open_fingerprints : [];
  const dogfoodUnhealthy = dogfoodStatus !== 'PASS' || dogfoodOpenFingerprints.length > 0;

  return (
    <View style={s.container}>
      {duplicateProxyAlarms.length > 0 && (
        <View style={s.duplicateProxyBanner} accessibilityRole="alert">
          <Text style={s.duplicateProxyTitle}>Duplicate proxy detected</Text>
          <Text style={s.duplicateProxyText}>
            {duplicateProxyAlarms.length} session{duplicateProxyAlarms.length === 1 ? '' : 's'} claimed by multiple proxies. Stop the extra proxy.
          </Text>
        </View>
      )}
      {visibleNightlyValidationFailures.length > 0 && (
        <View style={s.duplicateProxyBanner} accessibilityRole="alert">
          <Text style={s.duplicateProxyTitle}>Nightly validation failed</Text>
          <Text style={s.duplicateProxyText}>
            {visibleNightlyValidationFailures.map(item => `${item.harness} (${item.app_version})`).join(', ')}. Check the validation ledger before using affected controls.
          </Text>
        </View>
      )}
      {recentAppUpdateValidation && (
        <View style={recentAppUpdateValidation.status === 'pass' ? s.appUpdatePassBanner : s.duplicateProxyBanner} accessibilityRole="alert">
          <Text style={recentAppUpdateValidation.status === 'pass' ? s.appUpdatePassTitle : s.duplicateProxyTitle}>
            {recentAppUpdateValidation.status === 'pass' ? 'App update validated' : 'App update drift validation failed'}
          </Text>
          <Text style={recentAppUpdateValidation.status === 'pass' ? s.appUpdatePassText : s.duplicateProxyText}>
            {recentAppUpdateValidation.harness} {recentAppUpdateValidation.previous_app_version} -&gt; {recentAppUpdateValidation.app_version}. {recentAppUpdateValidation.status === 'pass' ? 'Harness controls remain available.' : 'A triage item was added to the maturity backlog.'}
          </Text>
        </View>
      )}
      {/* Connection banner */}
      {!connected && (
        <TouchableOpacity
          style={s.disconnectBanner}
          activeOpacity={0.7}
          onPress={() => {
            clientRef.current?.disconnect();
            const c = new RelayClient(handleMessage);
            clientRef.current = c;
            c.connect();
          }}
        >
          <Text style={s.disconnectText}>
            {reconnectInfo && reconnectInfo.attempt >= 5
              ? "Can't reach server — tap to retry"
              : reconnectInfo
                ? `Reconnecting (attempt ${reconnectInfo.attempt}, retry in ${Math.round(reconnectInfo.nextRetryMs / 1000)}s)…`
                : 'Reconnecting…'}
          </Text>
        </TouchableOpacity>
      )}
      {connected && (
        <View style={s.connectionHealthBar} accessibilityLabel={`Relay ${connectionHealth.state}`}>
          <View style={[
            s.connectionHealthDot,
            { backgroundColor: connectionHealth.state === 'healthy' ? '#3fb950' : connectionHealth.state === 'slow' ? '#d29922' : '#f0883e' },
          ]} />
          <Text style={s.connectionHealthText}>
            {`Relay ${connectionHealth.state}${connectionHealth.rttMs != null ? ` · ${connectionHealth.rttMs} ms` : ''}`}
          </Text>
          <TouchableOpacity
            style={s.usageButton}
            onPress={() => { setShowUsageDashboard(true); setShowHostResourceDashboard(false); setShowFleetView(false); }}
            accessibilityRole="button"
            accessibilityLabel="Usage and limits"
          >
            <Text style={s.usageButtonText}>Usage</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.usageButton}
            onPress={() => { setShowHostResourceDashboard(true); setShowUsageDashboard(false); setShowFleetView(false); setShowTranscriptSearch(false); }}
            accessibilityRole="button"
            accessibilityLabel="Host resources"
          >
            <Text style={s.usageButtonText}>Host</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.usageButton}
            onPress={() => setShowValidationHealth(true)}
            accessibilityRole="button"
            accessibilityLabel="Harness validation health"
          >
            <Text style={s.usageButtonText}>Validate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.usageButton}
            onPress={() => { setShowFleetView(true); setShowUsageDashboard(false); setShowHostResourceDashboard(false); }}
            accessibilityRole="button"
            accessibilityLabel="Fleet view"
          >
            <Text style={s.usageButtonText}>Fleet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.usageButton}
            onPress={() => { setShowTranscriptSearch(true); setShowFleetView(false); setShowUsageDashboard(false); setShowHostResourceDashboard(false); }}
            accessibilityRole="button"
            accessibilityLabel="Search all transcripts"
          >
            <Text style={s.usageButtonText}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.usageButton, showTestSessions ? s.usageButtonActive : null]}
            onPress={toggleTestSessions}
            accessibilityRole="button"
            accessibilityLabel={showTestSessions ? 'Hide test sessions' : 'Show test sessions'}
          >
            <Text style={s.usageButtonText}>Tests {testSessionIds.size > 99 ? '99+' : testSessionIds.size}</Text>
          </TouchableOpacity>
        </View>
      )}
      {dogfoodUnhealthy && (
        <TouchableOpacity style={s.duplicateProxyBanner} accessibilityRole="alert" onPress={() => setShowValidationHealth(true)}>
          <Text style={s.duplicateProxyTitle}>Chat stability sentinel {dogfoodStatus.toLowerCase()}</Text>
          <Text style={s.duplicateProxyText}>
            {dogfoodOpenFingerprints.length > 0
              ? `${dogfoodOpenFingerprints.length} open P0/P1 fingerprint${dogfoodOpenFingerprints.length === 1 ? '' : 's'}. Tap for program health.`
              : 'The 30-minute canary is missing, expired, skipped, or on a different served asset. Tap for program health.'}
          </Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showValidationHealth}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowValidationHealth(false)}
      >
        <View style={s.validationModal} accessibilityViewIsModal>
          <View style={s.usageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.usageTitle}>Harness validation</Text>
              <Text style={s.usageSubtitle}>Continuous drift watch, nightly tier 1, staggered weekly tier 2</Text>
            </View>
            <TouchableOpacity onPress={() => setShowValidationHealth(false)} accessibilityRole="button" accessibilityLabel="Close validation health">
              <Text style={s.usageClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.validationList}>
            <View style={s.validationCard} accessibilityLabel="Chat stability sentinel health">
              <View style={s.validationCardHeader}>
                <Text style={s.validationHarness}>Chat stability sentinel</Text>
                <Text style={[s.validationStatus, dogfoodStatus === 'PASS' ? s.validationPass : s.validationFail]}>{dogfoodStatus}</Text>
              </View>
              <Text style={s.validationMeta}>{dogfoodLatest
                ? `${dogfoodLatest.mode || 'unknown'} / ${dogfoodLatest.trigger_source || 'unknown trigger'} / ${dogfoodLatest.duration_ms || 0} ms`
                : 'No result has been published.'}</Text>
              <Text style={s.validationMeta}>{dogfoodLatest?.refresh_count ?? 0} refreshes / {dogfoodLatest?.dropped_samples ?? 0} dropped / {dogfoodOpenFingerprints.length} open findings</Text>
              <Text style={s.validationMeta}>Source {dogfoodLatest?.source_commit || 'unavailable'} / build {dogfoodLatest?.source_bundle_sha256 || 'unavailable'}</Text>
              <Text style={s.validationMeta}>Last end {dogfoodLatest?.completed_at ? new Date(dogfoodLatest.completed_at).toLocaleString() : 'never'}</Text>
              <Text style={s.validationMeta}>Next due {dogfoodLatest?.next_due_at ? new Date(dogfoodLatest.next_due_at).toLocaleString() : 'unknown'} / scheduler {dogfoodLatest?.scheduler_last_result || 'unavailable'}</Text>
            </View>
            {Object.entries(revalidationProgramHealth?.harnesses || {}).sort(([left], [right]) => left.localeCompare(right)).map(([harness, record]) => {
              const coverage = (revalidationProgramHealth?.coverage_matrix || []).find(row => row.harness === harness) || {};
              const tier2Mode = coverage.tier2?.mode === 'gated' ? 'gated' : record.last_tier2_status || 'scheduled';
              return <View key={harness} style={s.validationCard}>
                <View style={s.validationCardHeader}>
                  <Text style={s.validationHarness}>{harness}</Text>
                  <Text style={[s.validationStatus, record.status === 'pass' ? s.validationPass : s.validationFail]}>{record.status === 'pass' ? 'writes available' : record.status || 'pending'}</Text>
                </View>
                <Text style={s.validationMeta}>Version {record.installed_version || 'not installed'}</Text>
                <Text style={s.validationMeta}>Fixture {coverage.fixture ? 'covered' : 'missing'} / tier 1 {coverage.tier1 ? 'covered' : 'missing'} / tier 2 {tier2Mode}</Text>
                <Text style={s.validationMeta}>Next tier 2 {record.next_tier2_at ? new Date(record.next_tier2_at).toLocaleString() : 'unscheduled'}</Text>
                {!!record.reason && <Text style={s.validationReason}>{record.reason}</Text>}
              </View>;
            })}
            {!Object.keys(revalidationProgramHealth?.harnesses || {}).length && <Text style={s.validationEmpty}>Program health has not been published by the updated sentinel yet.</Text>}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showUsageDashboard}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowUsageDashboard(false)}
      >
        <View style={s.usageModal}>
          <View style={s.usageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.usageTitle}>Usage & limits</Text>
              <Text style={s.usageSubtitle}>Provider-account quotas shared by connected harnesses</Text>
            </View>
            <View style={s.usageHeaderActions}>
              <TouchableOpacity
                onPress={() => {
                  const requestId = clientRef.current?.requestProviderUsageRefresh(true);
                  if (requestId) setProviderUsageRefreshReceipt({ requestId, status: 'requested' });
                }}
                accessibilityRole="button"
                accessibilityLabel="Refresh provider usage"
                disabled={normalizedProviderUsage.inFlight}
              >
                <Text style={[s.usageClose, normalizedProviderUsage.inFlight ? s.usageRefreshDisabled : null]}>
                  {normalizedProviderUsage.inFlight ? 'Refreshing...' : 'Refresh'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowUsageDashboard(false)} accessibilityRole="button" accessibilityLabel="Close usage and limits">
                <Text style={s.usageClose}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          {!!providerUsageRefreshReceipt && <View style={s.usageCostState} accessibilityRole="summary">
            <Text style={s.usageSessions}>Refresh {providerUsageRefreshReceipt.status}
              {providerUsageRefreshReceipt.generation != null ? ` - generation ${providerUsageRefreshReceipt.generation}` : ''}</Text>
          </View>}
          {!!providerUsageResetReceipt && providerUsageResetReceipt.status !== 'requested' && <View style={s.usageCostState} accessibilityRole="summary">
            <Text style={s.usageSessions}>Reset {providerUsageResetReceipt.status}
              {providerUsageResetReceipt.outcome ? ` - ${providerUsageResetReceipt.outcome}` : ''}
              {providerUsageResetReceipt.code ? ` (${providerUsageResetReceipt.code})` : ''}</Text>
          </View>}
          {normalizedProviderUsage.collectionState !== 'ready' && <View style={s.usageCostState} accessibilityRole="summary">
            <Text style={s.usageWindowTitle}>{({
              'not-started': 'Provider usage has not been collected yet',
              refreshing: 'Refreshing provider usage',
              partial: 'Some provider usage is unavailable',
              stale: 'Showing last-good provider usage',
              unavailable: 'Provider usage is unavailable',
            })[normalizedProviderUsage.collectionState] || 'Provider usage is pending'}</Text>
            <Text style={s.usageSessions}>Generation {normalizedProviderUsage.generation}</Text>
          </View>}
          <View style={s.usageSummary}>
            {[
              [normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.providers : '—', 'Providers', null],
              [normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.accounts : '—', 'Accounts', null],
              [normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.reporting : '—', 'Reporting', null],
              [normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.nearLimit : '—', 'Near limit', normalizedProviderUsage.summary.nearLimit ? '#d29922' : null],
              [normalizedProviderUsage.summaryAuthoritative ? normalizedProviderUsage.summary.exhausted : '—', 'Exhausted', normalizedProviderUsage.summary.exhausted ? '#f85149' : null],
            ].map(([value, label, color]) => (
              <View style={s.usageSummaryCell} key={label}>
                <Text style={[s.usageSummaryValue, color ? { color } : null]}>{value}</Text>
                <Text style={s.usageSummaryLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <ScrollView contentContainerStyle={s.usageList}>
            {!!normalizedProviderUsage.estimatedCost && (() => {
              const cost = normalizedProviderUsage.estimatedCost;
              const hasAuthoritativeTotals = (['ready', 'partial', 'stale'].includes(cost.status)
                || (cost.status === 'scanning' && !!cost.lastGoodGeneratedAt))
                && cost.costUsd != null && cost.records != null
                && cost.tokens.input != null && cost.tokens.cached != null && cost.tokens.output != null;
              if (!hasAuthoritativeTotals) {
                const state = {
                  'not-started': ['Not scanned yet', 'The local cost scan has not completed.'],
                  idle: ['Not scanned yet', 'The local cost scan has not completed.'],
                  scanning: ['Scanning local history', 'Provider quota remains available while cost files are scanned.'],
                  error: ['Cost scan unavailable', 'The bounded cost payload was rejected; provider quota remains available.'],
                  unavailable: ['Cost scan unavailable', 'Local cost sources are unavailable; provider quota remains available.'],
                  cancelled: ['Cost scan cancelled', 'No zero total is reported because the scan did not complete.'],
                }[cost.status] || ['Cost data pending', 'Waiting for an authoritative local cost scan.'];
                return <View style={s.usageCostPanel} accessibilityLabel="Local estimated API-equivalent cost">
                  <View style={s.usageCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.usageCardTitle}>Local estimated API-equivalent cost</Text>
                      <Text style={s.usageSessions}>Separate from subscription quota</Text>
                    </View>
                    <Text style={s.usageCostStatus}>{cost.status}</Text>
                  </View>
                  <View style={s.usageCostState} accessibilityRole="summary">
                    <Text style={s.usageWindowTitle}>{state[0]}</Text>
                    <Text style={s.usageSessions}>{state[1]}</Text>
                    {!!cost.reasonCode && <Text style={s.usageSessions}>Reason: {cost.reasonCode}{cost.reasonPath ? ` (${cost.reasonPath})` : ''}</Text>}
                  </View>
                  <Text style={s.usageSessions}>{Number.isFinite(Number(cost.scan.files_complete))
                    ? `Incremental local JSONL scan - ${cost.scan.files_complete}/${cost.scan.files_total || 0} files`
                    : 'Incremental local JSONL scan has not reported file progress.'}</Text>
                </View>;
              }
              const modelRows = [...(selectedEstimatedCost?.byModel || [])]
                .sort((left, right) => right.cost_usd - left.cost_usd).slice(0, 10);
              const dayRows = [...(selectedEstimatedCost?.byDay || [])].sort((left, right) => left.day.localeCompare(right.day));
              const maxDayCost = Math.max(0.000001, ...dayRows.map(row => Number(row.cost_usd) || 0));
              return <View style={s.usageCostPanel} accessibilityLabel="Local estimated API-equivalent cost">
                <View style={s.usageCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.usageCardTitle}>Local estimated API-equivalent cost</Text>
                    <Text style={s.usageSessions}>Separate from subscription quota - pricing {cost.catalogVersion || 'unavailable'}</Text>
                  </View>
                  <Text style={s.usageCostStatus}>{cost.status}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.usageCostControls}>
                  {[1, 7, 30, 90, 365].map(value => <TouchableOpacity
                    key={value}
                    style={[s.usageCostChip, estimatedCostDays === value ? s.usageCostChipActive : null]}
                    onPress={() => setEstimatedCostDays(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: estimatedCostDays === value }}
                    accessibilityLabel={value === 1 ? 'Estimated cost today' : `Estimated cost ${value} days`}
                  ><Text style={s.usageCostChipText}>{value === 1 ? 'Today' : `${value}d`}</Text></TouchableOpacity>)}
                </ScrollView>
                {estimatedCostProjects.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.usageCostControls}>
                  {['', ...estimatedCostProjects].map(value => <TouchableOpacity
                    key={value || 'all'}
                    style={[s.usageCostChip, estimatedCostProject === value ? s.usageCostChipActive : null]}
                    onPress={() => setEstimatedCostProject(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: estimatedCostProject === value }}
                    accessibilityLabel={`Estimated cost project ${value || 'all projects'}`}
                  ><Text style={s.usageCostChipText} numberOfLines={1}>{value || 'All projects'}</Text></TouchableOpacity>)}
                </ScrollView>}
                <View style={s.usageCostSummary}>
                  {[
                    [`$${(selectedEstimatedCost?.costUsd || 0).toFixed(2)}`, 'Estimated cost'],
                    [compactUsageTokens(selectedEstimatedCost?.tokens.input), 'Input'],
                    [compactUsageTokens(selectedEstimatedCost?.tokens.cached), 'Cached'],
                    [compactUsageTokens(selectedEstimatedCost?.tokens.output), 'Output'],
                  ].map(([value, label]) => <View style={s.usageCostSummaryCell} key={label}>
                    <Text style={s.usageCreditValue}>{value}</Text><Text style={s.usageCreditLabel}>{label}</Text>
                  </View>)}
                </View>
                {!!cost.detail?.truncated && <View style={s.usageCostState} accessibilityRole="summary">
                  <Text style={s.usageSessions}>{costDetailMatches
                    ? `Showing detail rows ${Number(providerUsageCostDetail.detail.pagination?.cursor || 0) + 1}-${Number(providerUsageCostDetail.detail.pagination?.cursor || 0) + Number(providerUsageCostDetail.detail.pagination?.returned_rows || 0)} of ${Number(providerUsageCostDetail.detail.pagination?.total_rows || 0)}.`
                    : providerUsageCostDetail?.status === 'error'
                      ? 'Cost detail is unavailable.'
                      : `Loading a bounded detail page for ${cost.detail.totalRows} cost-detail rows.`}</Text>
                </View>}
                {!!cost.detail?.truncated && providerUsageCostDetail?.status === 'error' && <View style={s.usageCostState}>
                  <Text style={s.usageUnavailable}>Cost detail unavailable: {providerUsageCostDetail.error}</Text>
                </View>}
                {!!cost.detail?.truncated && costDetailMatches && <View style={s.usageCostTable} accessibilityLabel="Paginated local cost detail">
                  <View style={s.usageCostRow}>
                    <TouchableOpacity
                      disabled={Number(providerUsageCostDetail.detail.pagination?.cursor || 0) <= 0}
                      onPress={() => requestEstimatedCostDetail({
                        cursor: String(Math.max(0, Number(providerUsageCostDetail.detail.pagination.cursor || 0)
                          - Number(providerUsageCostDetail.detail.pagination.page_size || 50))),
                      })}
                      accessibilityRole="button"
                      accessibilityLabel="Previous cost detail page"
                    ><Text style={s.usageDashboardLink}>Previous</Text></TouchableOpacity>
                    <Text style={s.usageSessions}>{providerUsageCostDetail.detail.pagination.returned_rows} rows</Text>
                    <TouchableOpacity
                      disabled={!providerUsageCostDetail.detail.pagination?.next_cursor}
                      onPress={() => requestEstimatedCostDetail({ cursor: providerUsageCostDetail.detail.pagination.next_cursor })}
                      accessibilityRole="button"
                      accessibilityLabel="Next cost detail page"
                    ><Text style={s.usageDashboardLink}>Next</Text></TouchableOpacity>
                  </View>
                  {(providerUsageCostDetail.detail.rows || []).map((row, index) => <View
                    style={s.usageCostRow}
                    key={`${providerUsageCostDetail.detail.pagination.cursor}:${index}`}
                  >
                    <Text style={s.usageCostMetric}>{row.day}</Text>
                    <Text style={s.usageCostModel} numberOfLines={1}>{row.model} - {row.project}</Text>
                    <Text style={s.usageCostMetric}>${Number(row.cost_usd).toFixed(4)}</Text>
                  </View>)}
                </View>}
                <View style={s.usageCostChart} accessibilityRole="image" accessibilityLabel={`${estimatedCostDays}-day estimated cost by day`}>
                  {(dayRows.length ? dayRows : [{ day: 'none', cost_usd: 0 }]).map(row => <View style={s.usageCostBarCell} key={row.day}>
                    <View style={[s.usageCostBar, { height: `${Math.max(3, (Number(row.cost_usd) / maxDayCost) * 100)}%` }]} />
                    <Text style={s.usageCostBarLabel}>{row.day.slice(5)}</Text>
                  </View>)}
                </View>
                <View style={s.usageCostTable} accessible accessibilityRole="text" accessibilityLabel="Estimated cost and tokens by provider model">
                  {modelRows.map(row => <View style={s.usageCostRow} key={`${row.provider_id}:${row.model}`}>
                    <Text style={s.usageCostModel} numberOfLines={1}>{row.provider_id === 'openai-codex' ? 'Codex' : 'Claude'} - {row.model}</Text>
                    <Text style={s.usageCostMetric}>{compactUsageTokens(row.input)} in</Text>
                    <Text style={s.usageCostMetric}>{compactUsageTokens(row.cached)} cache</Text>
                    <Text style={s.usageCostMetric}>${Number(row.cost_usd).toFixed(4)}</Text>
                  </View>)}
                </View>
                {cost.unknownModels.length > 0 && <View style={s.usageCostFallbacks}>
                  <Text style={s.usageCreditLabel}>Fallback pricing</Text>
                  {cost.unknownModels.map(item => <Text style={s.usageSessions} key={`${item.provider_id}:${item.model}`}>{item.model} to {item.fallback}</Text>)}
                </View>}
                <Text style={s.usageSessions}>Incremental local JSONL scan - {cost.scan.files_complete || 0}/{cost.scan.files_total || 0} files - {cost.records} deduplicated records</Text>
              </View>;
            })()}
            {normalizedProviderUsage.entries.map(entry => {
              const cardTone = entry.tone === 'critical' ? '#f85149'
                : entry.tone === 'warning' || entry.tone === 'stale' ? '#d29922'
                  : entry.tone === 'unavailable' ? '#8b949e' : '#3fb950';
              const creditLabel = formatProviderCredits(entry.credits);
              const financialRows = providerFinancialRows(entry.financials);
              const creditReset = entry.credits?.resets_at
                ? formatProviderUsageReset(entry.credits.resets_at, providerUsageNowMs)
                : '';
              const collapsed = !!collapsedProviderUsage[entry.key];
              const cardRefreshReceipt = providerUsageRefreshReceipt?.provider_id === entry.providerId
                ? providerUsageRefreshReceipt : null;
              const cardRefreshPending = ['requested', 'accepted', 'coalesced'].includes(cardRefreshReceipt?.status);
              return (
                <View
                  key={entry.key}
                  style={[s.usageCard, { borderColor: cardTone + '88' }]}
                  testID={`provider-usage-card-${entry.providerId}`}
                  accessibilityLabel={`${entry.providerName} ${entry.accountLabel} usage`}
                >
                  <TouchableOpacity
                    style={s.usageProviderHeader}
                    accessibilityRole="button"
                    accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${entry.providerName} usage`}
                    accessibilityState={{ expanded: !collapsed }}
                    onPress={() => setCollapsedProviderUsage(previous => ({ ...previous, [entry.key]: !previous[entry.key] }))}
                  >
                    <ProviderMark providerId={entry.providerId} providerName={entry.providerName} colorScheme="dark" />
                    <View style={s.usageProviderIdentity}>
                      <Text style={s.usageCardTitle}>{entry.providerName}</Text>
                      <Text style={s.usageSessions}>{entry.accountLabel}{entry.plan ? ` - ${entry.plan}` : ''}</Text>
                    </View>
                    <Text style={[s.usageStatus, { color: cardTone, borderColor: cardTone + '77' }]}>
                      {entry.status.replace(/_/g, ' ')}
                    </Text>
                    <Text style={s.usageCollapseMark}>{collapsed ? '›' : '⌄'}</Text>
                  </TouchableOpacity>
                  {!collapsed && <>
                  <View style={s.usageMetaRow}>
                    <Text style={s.usageSessions}>{entry.sessionCount} mapped session{entry.sessionCount === 1 ? '' : 's'}</Text>
                    <Text style={s.usageSessions}>{entry.harnessTypes.length ? entry.harnessTypes.join(', ') : 'No mapped surfaces'}</Text>
                    <Text style={s.usageSessions}>{entry.status === 'stale'
                      ? `Stale - ${formatProviderUsageAge(entry.capturedAt, providerUsageNowMs)}`
                      : formatProviderUsageAge(entry.capturedAt, providerUsageNowMs)}</Text>
                    {!!entry.nextRefreshAt && <Text style={s.usageSessions}>Next refresh {formatProviderUsageReset(entry.nextRefreshAt, providerUsageNowMs)}</Text>}
                    {entry.refreshIntervalMs > 0 && <Text style={s.usageSessions}>{entry.watchBoostActive ? 'Live' : 'Idle'} cadence {Math.round(entry.refreshIntervalMs / 1000)}s</Text>}
                    <TouchableOpacity
                      style={[s.usageCardRefresh, cardRefreshPending ? s.usageRefreshDisabled : null]}
                      disabled={cardRefreshPending}
                      onPress={() => {
                        const requestId = clientRef.current?.requestProviderUsageRefresh(true, entry.providerId);
                        if (requestId) setProviderUsageRefreshReceipt({
                          requestId, status: 'requested', provider_id: entry.providerId,
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Refresh ${entry.providerName} usage now`}
                    ><Text style={s.usageCardRefreshText}>{cardRefreshPending ? 'Refreshing...' : 'Refresh now'}</Text></TouchableOpacity>
                  </View>
                  {!!cardRefreshReceipt && <View style={s.usageCostState} accessibilityRole="summary">
                    <Text style={s.usageSessions}>Refresh {cardRefreshReceipt.status}
                      {cardRefreshReceipt.code ? ` (${cardRefreshReceipt.code})` : ''}
                      {cardRefreshReceipt.retry_after_ms ? ` - retry in ${Math.ceil(cardRefreshReceipt.retry_after_ms / 1000)}s` : ''}</Text>
                  </View>}
                  {entry.windows.length > 0 ? (
                    <View style={s.usageWindows}>
                      {entry.windows.map(window => {
                        const tone = window.tone === 'critical' ? '#f85149'
                          : window.tone === 'warning' ? '#d29922'
                            : window.tone === 'unavailable' ? '#8b949e' : '#3fb950';
                        const reset = window.resetDescription || formatProviderUsageReset(window.resetsAt, providerUsageNowMs);
                        return (
                          <View style={s.usageWindow} key={window.id}>
                            <View style={s.usageCardTop}>
                              <View style={{ flex: 1 }}>
                                <Text style={s.usageWindowTitle}>{window.label}</Text>
                                {!!window.modelScope?.label
                                  ? <Text style={s.usageSessions}>Model: {window.modelScope.label}</Text>
                                  : !!window.scope && window.scope !== window.label && <Text style={s.usageSessions}>{window.scope}</Text>}
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[s.usageRemaining, { color: tone }]}>{window.remainingPercent == null ? 'Unavailable' : `${formatProviderPercent(window.remainingPercent)} left`}</Text>
                                <Text style={s.usageSessions}>{window.usedPercent == null ? 'No reported value' : `${formatProviderPercent(window.usedPercent)} used`}</Text>
                              </View>
                            </View>
                            {window.usedPercent != null && <View
                              style={s.usageMeter}
                              accessibilityRole="progressbar"
                              accessibilityLabel={`${entry.providerName} ${window.label}`}
                              accessibilityValue={{ min: 0, max: 100, now: Math.round(window.visualPercent), text: `${formatProviderPercent(window.usedPercent)} used` }}
                            >
                              <View style={[s.usageMeterFill, { width: `${window.visualPercent}%`, backgroundColor: tone }]} />
                            </View>}
                            <Text style={s.usageThresholds}>Warning {formatProviderPercent(window.thresholds.warningPercent)} - Critical {formatProviderPercent(window.thresholds.criticalPercent)}</Text>
                            {!!window.pace && <View style={[s.usagePace, window.pace.category === 'burning' ? s.usagePaceBurning : window.pace.category === 'racing' ? s.usagePaceRacing : null]}>
                              <View style={s.usageCardTop}>
                                <Text style={[s.usagePaceCategory, { color: window.pace.category === 'burning' ? '#f85149' : window.pace.category === 'racing' ? '#d29922' : window.pace.category === 'slow' ? '#58a6ff' : '#8b949e' }]}>{window.pace.category}</Text>
                                <Text style={s.usageSessions}>Ideal {formatProviderPercent(window.pace.expectedUsedPercent)} - projected {formatProviderPercent(window.pace.projectedUsedPercent)}</Text>
                              </View>
                              <View style={s.usagePaceChart} accessibilityRole="image" accessibilityLabel={`${window.label} actual ${formatProviderPercent(window.usedPercent)}, ideal ${formatProviderPercent(window.pace.expectedUsedPercent)}, projected ${formatProviderPercent(window.pace.projectedUsedPercent)}`}>
                                <View style={[s.usagePaceActual, { width: `${window.visualPercent}%` }]} />
                                <View style={[s.usagePaceMarker, { left: `${Math.min(100, window.pace.expectedUsedPercent)}%`, backgroundColor: '#f0f6fc' }]} />
                                <View style={[s.usagePaceMarker, { left: `${Math.min(100, window.pace.projectedUsedPercent)}%`, backgroundColor: '#f85149' }]} />
                              </View>
                              <View style={s.usagePaceBudgets}>
                                {Object.entries({ Now: 'now', '+1 hour': 'next_hour', '+5 hours': 'next_five_hours', Today: 'today' }).map(([label, key]) => <View style={s.usagePaceBudget} key={key}>
                                  <Text style={s.usageCreditLabel}>{label}</Text><Text style={s.usageCreditValue}>{formatProviderPercent(window.pace.budgets?.[key] || 0)}</Text>
                                </View>)}
                              </View>
                              <Text style={s.usageSessions}>{window.usedPercent >= 100 ? 'Quota is exhausted' : window.pace.willLastToReset ? 'Current pace lasts to reset' : `Projected exhaustion ${formatProviderUsageReset(window.pace.exhaustionAt, providerUsageNowMs)}`}</Text>
                            </View>}
                            {!!reset && <Text style={s.usageReset}>Resets {reset}</Text>}
                            <Text style={s.usageThresholds}>{window.source || entry.source}{window.provenance ? ` - ${window.provenance}` : ''}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : !entry.localRuntime && !entry.cloudUsage ? (
                    <Text style={s.usageUnavailable}>{entry.error?.message || 'This provider did not report quota windows.'}</Text>
                  ) : null}
                  {!!entry.cloudUsage && entry.providerId === 'ollama-local' && (
                    entry.cloudUsage.subscriptionState === 'active' ? <View style={s.usageCredits} accessibilityLabel="Ollama Cloud usage">
                      <View style={s.usageCreditCell}>
                        <Text style={s.usageCreditLabel}>Ollama Cloud</Text>
                        <Text style={s.usageCreditValue}>{entry.windows.length} quota window{entry.windows.length === 1 ? '' : 's'}</Text>
                        <Text style={s.usageSessions}>{formatProviderUsageAge(entry.cloudUsage.capturedAt, providerUsageNowMs)}</Text>
                      </View>
                      <View style={s.usageCreditCell}>
                        <Text style={s.usageCreditLabel}>Auto-reload</Text>
                        <Text style={s.usageCreditValue}>{entry.cloudUsage.autoReloadEnabled == null ? 'Not reported' : entry.cloudUsage.autoReloadEnabled ? 'On' : 'Off'}</Text>
                        <Text style={s.usageSessions}>Extra usage balance is separate from plan quota</Text>
                      </View>
                    </View> : entry.cloudUsage.subscriptionState === 'none'
                      ? <Text style={s.usageUnavailable} accessibilityLabel="Ollama Cloud no subscription">No cloud subscription - local models remain unlimited</Text>
                      : <Text style={s.usageUnavailable} accessibilityLabel="Ollama Cloud usage unavailable">Cloud usage unavailable - {entry.cloudUsage.error?.message || 'Open the signed-in Ollama Usage page to expose account quota.'}</Text>
                  )}
                  {!!entry.localRuntime && <View style={s.usageCredits} accessibilityLabel="Ollama local runtime">
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Local runtime</Text>
                      <Text style={s.usageCreditValue}>{entry.localRuntime.loadedModelsCount} loaded / {entry.localRuntime.installedModelsCount} installed</Text>
                      <Text style={s.usageSessions}>{entry.localRuntime.endpointScope.replace(/_/g, ' ')}</Text>
                    </View>
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Request telemetry</Text>
                      <Text style={s.usageCreditValue}>{entry.localRuntime.telemetryStatus.replace(/_/g, ' ')}</Text>
                      <Text style={s.usageSessions}>{entry.localRuntime.telemetryReason}</Text>
                    </View>
                  </View>}
                  {!!entry.localRuntime?.latestRequest && <View style={s.usageCredits} accessibilityLabel="Ollama owned request metrics">
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Latest owned request</Text>
                      <Text style={s.usageCreditValue}>{entry.localRuntime.latestRequest.model}</Text>
                      <Text style={s.usageSessions}>{entry.localRuntime.latestRequest.surface.replace(/_/g, ' ')} - {formatProviderUsageAge(entry.localRuntime.latestRequest.capturedAt, providerUsageNowMs)}</Text>
                    </View>
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Tokens</Text>
                      <Text style={s.usageCreditValue}>{entry.localRuntime.latestRequest.promptTokens} prompt - {entry.localRuntime.latestRequest.responseTokens} output</Text>
                      <Text style={s.usageSessions}>{formatOllamaTokenRate(entry.localRuntime.latestRequest.tokensPerSecond)}</Text>
                    </View>
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Total / load</Text>
                      <Text style={s.usageCreditValue}>{formatOllamaDuration(entry.localRuntime.latestRequest.totalDurationNs)} / {formatOllamaDuration(entry.localRuntime.latestRequest.loadDurationNs)}</Text>
                      <Text style={s.usageSessions}>terminal response metrics</Text>
                    </View>
                    <View style={s.usageCreditCell}>
                      <Text style={s.usageCreditLabel}>Prompt / eval</Text>
                      <Text style={s.usageCreditValue}>{formatOllamaDuration(entry.localRuntime.latestRequest.promptEvalDurationNs)} / {formatOllamaDuration(entry.localRuntime.latestRequest.evalDurationNs)}</Text>
                      <Text style={s.usageSessions}>{entry.localRuntime.observedRequestCount} owned receipt{entry.localRuntime.observedRequestCount === 1 ? '' : 's'}</Text>
                    </View>
                  </View>}
                  {financialRows.length > 0 && <View style={s.usageCredits}>
                    {financialRows.map(row => <View style={s.usageCreditCell} key={row.id}>
                      <Text style={s.usageCreditLabel}>{row.label}</Text>
                      <Text style={s.usageCreditValue}>{row.value}</Text>
                    </View>)}
                  </View>}
                  {(creditLabel || entry.resetCredits) && (
                    <View style={s.usageCredits}>
                      {!!creditLabel && <View style={s.usageCreditCell}>
                        <Text style={s.usageCreditLabel}>Credits</Text>
                        <Text style={s.usageCreditValue}>{creditLabel}</Text>
                        {!!creditReset && <Text style={s.usageSessions}>Resets {creditReset}</Text>}
                      </View>}
                      {!!entry.resetCredits && <View style={s.usageCreditCell}>
                        <Text style={s.usageCreditLabel}>Rate-limit resets</Text>
                        <Text style={s.usageCreditValue}>{entry.resetCredits.available_count || 0} available</Text>
                      </View>}
                    </View>
                  )}
                  {entry.providerId === 'openai-codex'
                    && Number(entry.resetCredits?.available_count) > 0
                    && entry.windows.some(window => window.usedPercent >= 100) && (
                    <View style={s.usageResetAttention} accessibilityRole="alert" accessibilityLabel={`${entry.resetCredits.available_count} limit resets available - apply one?`}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.usageWindowTitle}>{entry.resetCredits.available_count} limit reset{entry.resetCredits.available_count === 1 ? '' : 's'} available — apply one?</Text>
                        <Text style={s.usageSessions}>Uses Codex's native reset action only after this approval.</Text>
                      </View>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Apply one Codex rate limit reset"
                        disabled={['requested', 'accepted'].includes(providerUsageResetReceipt?.status)}
                        onPress={() => {
                          const requestId = clientRef.current?.consumeProviderUsageResetCredit();
                          if (requestId) setProviderUsageResetReceipt({ requestId, status: 'requested' });
                        }}
                        style={s.usageResetButton}
                      >
                        <Text style={s.usageResetButtonText}>{['requested', 'accepted'].includes(providerUsageResetReceipt?.status) ? 'Applying...' : 'Apply one reset'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {Array.isArray(entry.resetCredits?.details) && entry.resetCredits.details.length > 0 && (
                    <View style={s.usageResetCredits}>
                      {entry.resetCredits.details.map((credit, index) => (
                        <View style={s.usageResetCredit} key={`${credit.title || 'reset'}-${index}`}>
                          <Text style={s.usageCreditValue}>{credit.title || `Reset credit ${index + 1}`}</Text>
                          {!!credit.status && <Text style={s.usageSessions}>{credit.status}</Text>}
                          {!!credit.expires_at && <Text style={s.usageSessions}>Expires {formatProviderUsageReset(credit.expires_at, providerUsageNowMs)}</Text>}
                        </View>
                      ))}
                    </View>
                  )}
                  {!!entry.error?.message && entry.windows.length > 0 && (
                    <Text style={s.usageStaleError}>Last refresh: {entry.error.message}</Text>
                  )}
                  <View style={s.usageSourceRow}>
                    <Text style={s.usageSessions}>Source: {entry.source ? entry.source.replace(/_/g, ' ') : 'not available'}{entry.latencyMs != null ? ` - ${entry.latencyMs} ms` : ''}</Text>
                    {!!entry.dashboardUrl && <TouchableOpacity
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${entry.providerName} usage dashboard`}
                      onPress={() => Linking.openURL(entry.dashboardUrl).catch(() => {})}
                    >
                      <Text style={s.usageDashboardLink}>Open dashboard</Text>
                    </TouchableOpacity>}
                  </View>
                  </>}
                </View>
              );
            })}
            {normalizedProviderUsage.entries.length === 0 && (
              <View style={s.usageEmpty}>
                <Text style={s.usageEmptyTitle}>{normalizedProviderUsage.collectionState === 'ready'
                  ? 'The completed scan found no provider usage.'
                  : 'Provider usage is not available yet.'}</Text>
                <Text style={s.usageUnavailable}>{normalizedProviderUsage.collectionState === 'ready'
                  ? 'Connect a supported Codex, Claude Code, Antigravity, or Cursor session, then refresh.'
                  : 'Quota totals remain unknown until a provider collection completes.'}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showHostResourceDashboard}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHostResourceDashboard(false)}
      >
        <View style={s.usageModal} testID="host-resource-dashboard">
          <View style={s.usageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.usageTitle}>Host resources</Text>
              <Text style={s.usageSubtitle}>Live, ephemeral Windows metrics. Commands and executable paths stay local.</Text>
            </View>
            <View style={s.usageHeaderActions}>
              <TouchableOpacity
                onPress={() => clientRef.current?.requestHostResourceRefresh(true)}
                accessibilityRole="button"
                accessibilityLabel="Capture host resource detail now"
              >
                <Text style={s.usageClose}>Capture</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowHostResourceDashboard(false)} accessibilityRole="button" accessibilityLabel="Close host resources">
                <Text style={s.usageClose}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView contentContainerStyle={s.hostResourceList}>
            <View style={s.hostResourceMeta}>
              <Text style={[s.hostResourceStatus,
                hostResourceTimelineProjection.status === 'live' ? s.hostResourceStatusLive
                  : ['delayed', 'stale'].includes(hostResourceTimelineProjection.status) ? s.hostResourceStatusWarning
                    : hostResourceTimelineProjection.status === 'paused' ? s.hostResourceStatusPaused
                      : hostResourceTimelineProjection.status === 'reconnecting' ? s.hostResourceStatusReconnecting
                        : s.hostResourceStatusUnavailable]}>
                {({ live: 'Live', delayed: 'Delayed', reconnecting: 'Reconnecting', paused: 'Paused', stale: 'Stale', waiting: 'Waiting', unavailable: 'Unavailable' })[hostResourceTimelineProjection.status] || 'Unavailable'}
              </Text>
              <Text style={s.usageSessions}>{hostResourceAggregateOnly ? 'Aggregate-only' : normalizedHostResources.machineLabel || 'Windows host'}</Text>
              <Text style={s.usageSessions}>{formatHostResourceAge(normalizedHostResources.capturedAt, hostResourceNowMs)}</Text>
              <Text style={s.usageSessions}>{hostResourceTimelineProjection.receivedCount} received / {hostResourceTimelineProjection.validCount} valid / {hostResourceTimelineProjection.expectedCount} expected / {hostResourceTimelineProjection.droppedCount} dropped / {hostResourceTimelineProjection.gapCount} gaps / {hostResourceTimelineProjection.duplicateCount} dup / {hostResourceTimelineProjection.outOfOrderCount} out-of-order</Text>
              <Text style={s.usageSessions}>{Math.round(hostResourceTimelineProjection.cadenceMs)} ms cadence / seq {normalizedHostResources.sampleSequence || '--'}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hostResourceControls} accessibilityLabel="Host resource timeline controls">
              {[['live', 'Live'], ['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['since_open', 'Since open']].map(([value, label]) => (
                <TouchableOpacity key={value} style={[s.hostResourceControlButton, hostResourceRange === value ? s.hostResourceControlButtonActive : null]} accessibilityRole="button" accessibilityState={{ selected: hostResourceRange === value }} onPress={() => { setHostResourceRange(value); setHostResourceViewport({ start: 0, end: 1 }); }}><Text style={[s.hostResourceControlText, hostResourceRange === value ? s.hostResourceControlTextActive : null]}>{label}</Text></TouchableOpacity>
              ))}
              <TouchableOpacity style={s.hostResourceControlButton} accessibilityRole="button" onPress={() => {
                if (hostResourcePausedSequence == null) {
                  setHostResourcePausedAtMs(Date.now());
                  setHostResourcePausedSequence(hostResourceHistory[hostResourceHistory.length - 1]?.sample_sequence || 0);
                } else {
                  setHostResourcePausedSequence(null);
                  setHostResourcePausedAtMs(null);
                }
              }}><Text style={s.hostResourceControlText}>{hostResourcePausedSequence == null ? 'Pause' : 'Resume'}</Text></TouchableOpacity>
              <TouchableOpacity style={s.hostResourceControlButton} accessibilityRole="button" accessibilityState={{ disabled: hostResourceViewport.start === 0 && hostResourceViewport.end === 1 }} disabled={hostResourceViewport.start === 0 && hostResourceViewport.end === 1} onPress={() => setHostResourceViewport({ start: 0, end: 1 })}><Text style={s.hostResourceControlText}>Reset zoom</Text></TouchableOpacity>
              <TouchableOpacity style={[s.hostResourceControlButton, hostResourceAggregateOnly ? s.hostResourceControlButtonActive : null]} accessibilityRole="checkbox" accessibilityState={{ checked: hostResourceAggregateOnly }} accessibilityLabel="Aggregate-only privacy" onPress={() => { setHostResourceAggregateOnly(previous => !previous); setHostResourceSelectedProcessKey(''); }}><Text style={[s.hostResourceControlText, hostResourceAggregateOnly ? s.hostResourceControlTextActive : null]}>Aggregate-only</Text></TouchableOpacity>
            </ScrollView>
            <Text style={s.hostResourceSampleCount}>{rangedHostResourceHistory.length} raw samples / {Math.round(hostResourceTimelineProjection.elapsedMs / 1000)}s actual{hostResourcePausedSequence == null ? '' : ` / paused at ${hostResourcePausedSequence}`}</Text>
            {!!(hostResourceError || normalizedHostResources.error) && (
              <Text style={s.hostResourceError} accessibilityRole="alert">
                {hostResourceError?.message || normalizedHostResources.error?.message}
                {normalizedHostResources.error ? ` Last full detail: ${normalizedHostResources.lastGoodCapturedAt ? formatHostResourceAge(normalizedHostResources.lastGoodCapturedAt, hostResourceNowMs).replace(/^Updated\s+/i, '') : 'not yet available'}.` : ''}
              </Text>
            )}
            {normalizedHostResources.system ? (
              <>
                <View style={s.hostResourceSummary} accessibilityLabel="Host resource summary">
                  {[
                    [`${Math.round(normalizedHostResources.system.cpuPercent)}%`, 'CPU', `${normalizedHostResources.system.cpu.logicalCoreCount || '--'} logical / ${normalizedHostResources.system.cpu.physicalCoreCount || '--'} physical cores`],
                    [`${Math.round(normalizedHostResources.system.memory.usedPercent)}%`, 'Memory', `${formatHostResourceBytes(normalizedHostResources.system.memory.usedBytes)} / ${formatHostResourceBytes(normalizedHostResources.system.memory.totalBytes)}; commit ${Math.round(normalizedHostResources.system.memory.commitPercent)}%`],
                    [formatHostResourceRate(normalizedHostResources.system.disk.readBps + normalizedHostResources.system.disk.writeBps), 'Disk I/O', `Read ${formatHostResourceRate(normalizedHostResources.system.disk.readBps)} / write ${formatHostResourceRate(normalizedHostResources.system.disk.writeBps)}`],
                    [formatHostResourceRate(normalizedHostResources.system.network.receiveBps + normalizedHostResources.system.network.sendBps), 'Network I/O', `Receive ${formatHostResourceRate(normalizedHostResources.system.network.receiveBps)} / send ${formatHostResourceRate(normalizedHostResources.system.network.sendBps)}`],
                  ].map(([value, label, detail]) => (
                    <View style={s.hostResourceSummaryCell} key={label}>
                      <Text style={s.usageSummaryValue}>{value}</Text>
                      <Text style={s.usageSummaryLabel}>{label}</Text>
                      {!!detail && <Text style={s.hostResourceSummaryDetail}>{detail}</Text>}
                    </View>
                  ))}
                </View>
                <View style={s.hostResourceCharts}>
                  <HostResourceChart title="CPU" description="Total outline; User and Kernel component overlays (%)" frames={rangedHostResourceHistory} percentScale viewport={hostResourceViewport} onViewportChange={setHostResourceViewport} crosshairSequence={hostResourceCrosshairSequence} onCrosshairChange={setHostResourceCrosshairSequence} range={hostResourceRange} nowMs={hostResourceRangeNowMs} paused={hostResourcePausedSequence != null} subscriptionStatus={hostResourceSubscription.status} series={[
                    { key: 'cpu-total', metric: 'cpu_total_percent', label: 'Total', color: '#58a6ff', format: formatHostResourcePercent },
                    { key: 'cpu-user', metric: 'cpu_user_percent', label: 'User', color: '#3fb950', format: formatHostResourcePercent },
                    { key: 'cpu-kernel', metric: 'cpu_privileged_percent', label: 'Kernel', color: '#d29922', format: formatHostResourcePercent },
                    ...(selectedHostResourceFrames.length ? [{ key: 'process-cpu', metric: 'cpu_total_percent', label: `${selectedHostResourceProcess?.agentLabel || selectedHostResourceProcess?.name || 'Process'} overlay`, color: '#f778ba', format: formatHostResourcePercent, frames: selectedHostResourceFrames, dashed: true }] : []),
                  ]} />
                  <HostResourceChart title="Memory" description="Physical used and committed (%)" frames={rangedHostResourceHistory} percentScale viewport={hostResourceViewport} onViewportChange={setHostResourceViewport} crosshairSequence={hostResourceCrosshairSequence} onCrosshairChange={setHostResourceCrosshairSequence} range={hostResourceRange} nowMs={hostResourceRangeNowMs} paused={hostResourcePausedSequence != null} subscriptionStatus={hostResourceSubscription.status} series={[
                    { key: 'memory-used', metric: 'memory_used_percent', label: 'Physical used', color: '#bc8cff', format: formatHostResourcePercent },
                    { key: 'memory-commit', metric: 'memory_commit_percent', label: 'Committed', color: '#f778ba', format: formatHostResourcePercent },
                  ]} />
                  <HostResourceChart title="Disk" description="Aggregate throughput (IEC bytes/s); isolate unequal series in the legend" frames={rangedHostResourceHistory} viewport={hostResourceViewport} onViewportChange={setHostResourceViewport} crosshairSequence={hostResourceCrosshairSequence} onCrosshairChange={setHostResourceCrosshairSequence} range={hostResourceRange} nowMs={hostResourceRangeNowMs} paused={hostResourcePausedSequence != null} subscriptionStatus={hostResourceSubscription.status} series={[
                    { key: 'disk-read', metric: 'disk_read_bps', label: 'Read', color: '#58a6ff', format: value => value == null ? '--' : formatHostResourceRate(value) },
                    { key: 'disk-write', metric: 'disk_write_bps', label: 'Write', color: '#f0883e', format: value => value == null ? '--' : formatHostResourceRate(value) },
                    ...(selectedHostResourceFrames.length ? [
                      { key: 'process-read', metric: 'disk_read_bps', label: 'Process read overlay', color: '#bc8cff', format: value => value == null ? '--' : formatHostResourceRate(value), frames: selectedHostResourceFrames, dashed: true },
                      { key: 'process-write', metric: 'disk_write_bps', label: 'Process write overlay', color: '#f778ba', format: value => value == null ? '--' : formatHostResourceRate(value), frames: selectedHostResourceFrames, dashed: true },
                    ] : []),
                  ]} />
                  <HostResourceChart title="Network" description="Physical-default receive and send (IEC bytes/s)" frames={rangedHostResourceHistory} viewport={hostResourceViewport} onViewportChange={setHostResourceViewport} crosshairSequence={hostResourceCrosshairSequence} onCrosshairChange={setHostResourceCrosshairSequence} range={hostResourceRange} nowMs={hostResourceRangeNowMs} paused={hostResourcePausedSequence != null} subscriptionStatus={hostResourceSubscription.status} series={[
                    { key: 'network-receive', metric: 'network_receive_bps', label: 'Receive', color: '#3fb950', format: value => value == null ? '--' : formatHostResourceRate(value) },
                    { key: 'network-send', metric: 'network_send_bps', label: 'Send', color: '#d29922', format: value => value == null ? '--' : formatHostResourceRate(value) },
                  ]} />
                </View>
                {!hostResourceAggregateOnly && <View style={s.hostResourceProcessCard}>
                  <View style={s.hostResourceProcessHeading}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.usageCardTitle}>Processes</Text>
                      <Text style={s.usageSessions}>Union of owned and top CPU, memory, read, and write. Attribution never implies unproved session ownership.</Text>
                    </View>
                    <Text style={s.usageSessions}>{normalizedHostResources.attributedProcesses.length} attributed / {normalizedHostResources.processes.length} shown</Text>
                  </View>
                  <View style={s.hostResourceProcessControls}>
                    <TextInput style={s.hostResourceProcessSearch} value={hostResourceProcessSearch} onChangeText={setHostResourceProcessSearch} placeholder="Search name, PID, agent, workspace" placeholderTextColor="#6e7681" accessibilityLabel="Search host processes" />
                    <TouchableOpacity style={s.hostResourceProcessControl} accessibilityRole="button" accessibilityLabel={`Attribution filter ${hostResourceProcessFilter}`} onPress={() => setHostResourceProcessFilter(previous => ({ all: 'owned', owned: 'runtime', runtime: 'workspace-associated', 'workspace-associated': 'unattributed', unattributed: 'all' })[previous] || 'all')}><Text style={s.hostResourceProcessControlText}>Filter: {hostResourceProcessFilter}</Text></TouchableOpacity>
                    <TouchableOpacity style={s.hostResourceProcessControl} accessibilityRole="button" accessibilityLabel={`Process sort ${hostResourceProcessSort}`} onPress={() => setHostResourceProcessSort(previous => ({ cpu: 'memory', memory: 'read', read: 'write', write: 'name', name: 'cpu' })[previous] || 'cpu')}><Text style={s.hostResourceProcessControlText}>Sort: {hostResourceProcessSort}</Text></TouchableOpacity>
                  </View>
                  {!!selectedHostResourceProcess && <View style={s.hostResourceProcessOverlay} accessible accessibilityLabel={`Process detail for ${selectedHostResourceProcess.agentLabel || selectedHostResourceProcess.name}`}>
                    <Text style={s.hostResourceProcessTitle}>{selectedHostResourceProcess.agentLabel || selectedHostResourceProcess.name}</Text>
                    <Text style={s.usageSessions}>{selectedHostResourceProcess.name} / PID {selectedHostResourceProcess.pid} / {selectedHostResourceProcess.attributionLevel}: {selectedHostResourceProcess.attributionReason}</Text>
                    <Text style={s.hostResourceProcessMetric}>Host CPU {selectedHostResourceProcess.cpuHostPercent.toFixed(1)}% / core equivalent {selectedHostResourceProcess.cpuCoreEquivalent.toFixed(1)}%</Text>
                    <Text style={s.hostResourceProcessMetric}>Working {formatHostResourceBytes(selectedHostResourceProcess.memoryBytes)} / private {formatHostResourceBytes(selectedHostResourceProcess.privateBytes)} / commit {formatHostResourceBytes(selectedHostResourceProcess.commitBytes)}</Text>
                    <Text style={s.hostResourceProcessIo}>64-bit bytes R {selectedHostResourceProcess.counterTotals.ioReadBytes} / W {selectedHostResourceProcess.counterTotals.ioWriteBytes}; {selectedHostResourceFrames.length} detail samples</Text>
                    <TouchableOpacity style={s.hostResourceProcessControl} accessibilityRole="button" onPress={() => setHostResourceSelectedProcessKey('')}><Text style={s.hostResourceProcessControlText}>Remove overlay</Text></TouchableOpacity>
                  </View>}
                  {hostResourceProcessRows.map(({ process, depth }) => (
                    <View key={process.stableKey} style={[s.hostResourceProcessRow, process.attributed ? s.hostResourceProcessAttributed : null, hostResourceSelectedProcessKey === process.stableKey ? s.hostResourceProcessSelected : null, { paddingLeft: 9 + depth * 14 }]}>
                      {process.childCount > 0 && <TouchableOpacity style={s.hostResourceProcessExpand} accessibilityRole="button" accessibilityState={{ expanded: hostResourceExpandedProcesses[process.stableKey] !== false }} accessibilityLabel={`${hostResourceExpandedProcesses[process.stableKey] === false ? 'Expand' : 'Collapse'} ${process.name}`} onPress={() => setHostResourceExpandedProcesses(previous => ({ ...previous, [process.stableKey]: previous[process.stableKey] !== false ? false : true }))}><Text style={s.hostResourceProcessControlText}>{hostResourceExpandedProcesses[process.stableKey] === false ? '+' : '-'}</Text></TouchableOpacity>}
                      <TouchableOpacity style={s.hostResourceProcessIdentity} accessibilityRole="button" accessibilityLabel={`${process.agentLabel || process.name}, ${process.attributionLevel}, host CPU ${process.cpuHostPercent.toFixed(1)} percent, memory ${formatHostResourceBytes(process.memoryBytes)}`} onPress={() => setHostResourceSelectedProcessKey(process.stableKey)}>
                        <Text style={[s.hostResourceProcessTitle, process.attributed ? s.hostResourceProcessTitleAttributed : null]} numberOfLines={1}>{process.agentLabel || process.name}</Text>
                        <Text style={s.usageSessions} numberOfLines={2}>{process.agentLabel ? `${process.name} / ` : ''}PID {process.pid}{process.workspaceLabel ? ` / ${process.workspaceLabel}` : ''}{process.parentKey ? ' / child process' : process.parentPid ? ` / parent PID ${process.parentPid} outside sample` : ''}</Text>
                        <Text style={s.hostResourceProcessReason} numberOfLines={2}>{process.attributionLevel}: {process.attributionReason}</Text>
                      </TouchableOpacity>
                      <View style={s.hostResourceProcessMetrics}>
                        <Text style={s.hostResourceProcessMetric}>{process.cpuHostPercent.toFixed(1)}% host / {process.cpuCoreEquivalent.toFixed(1)}% core</Text>
                        <Text style={s.hostResourceProcessMetric}>{formatHostResourceBytes(process.memoryBytes)}</Text>
                        <Text style={s.hostResourceProcessIo}>R {formatHostResourceRate(process.ioReadBps)} / W {formatHostResourceRate(process.ioWriteBps)}</Text>
                      </View>
                    </View>
                  ))}
                </View>}
                <Text style={s.hostResourcePrivacy}>Privacy boundary: sanitized metrics cross the authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also removes machine, device, adapter, workspace, process, and PID labels.</Text>
              </>
            ) : (
              <View style={s.usageEmpty}>
                <Text style={s.usageEmptyTitle}>Waiting for the Windows proxy.</Text>
                <Text style={s.usageUnavailable}>The subscription is {hostResourceSubscription.status}. Gaps remain visible; unavailable samples are not interpolated.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showFleetView}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFleetView(false)}
      >
        <View style={s.usageModal} testID="fleet-view">
          <View style={s.usageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.usageTitle}>Fleet view</Text>
              <Text style={s.usageSubtitle}>Live monitoring across active harness sessions</Text>
            </View>
            <TouchableOpacity onPress={() => setShowFleetView(false)} accessibilityRole="button" accessibilityLabel="Close fleet view">
              <Text style={s.usageClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={s.fleetSummary}>
            {[
              [allFleetEntries.length, 'Sessions', null],
              [fleetWorkingCount, 'Working', fleetWorkingCount ? '#58a6ff' : null],
              [fleetWorkingGoalCount, 'On goal', fleetWorkingGoalCount ? '#3fb950' : null],
              [fleetIdleCount, 'Idle', null],
              [fleetAttentionCount, 'Need attention', fleetAttentionCount ? '#d29922' : null],
            ].map(([value, label, color]) => (
              <View style={s.fleetSummaryCell} key={label}>
                <Text style={[s.usageSummaryValue, color ? { color } : null]}>{value}</Text>
                <Text style={s.usageSummaryLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={s.fleetFilterRow}>
            <Text style={s.fleetFilterText}>{fleetWorkingCount} working now</Text>
            <TouchableOpacity
              style={s.fleetFilterButton}
              onPress={() => setShowFleetIdle(value => !value)}
              accessibilityRole="button"
              accessibilityState={{ selected: showFleetIdle }}
              accessibilityLabel={showFleetIdle ? 'Hide idle sessions' : `Show ${fleetIdleCount} idle sessions`}
            >
              <Text style={s.fleetFilterButtonText}>{showFleetIdle ? 'Hide idle sessions' : `Show ${fleetIdleCount} idle`}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.broadcastPanel} testID="broadcast-send">
            <View style={s.broadcastHeading}>
              <View style={{ flex: 1 }}>
                <Text style={s.broadcastTitle}>Broadcast prompt</Text>
                <Text style={s.usageSubtitle}>Select up to {MAX_BROADCAST_SESSIONS} capable sessions.</Text>
              </View>
              <Text style={s.broadcastCount}>{broadcastSelectedIds.length} selected</Text>
            </View>
            <TextInput
              style={s.broadcastPrompt}
              value={broadcastPrompt}
              onChangeText={setBroadcastPrompt}
              placeholder="Prompt every selected session..."
              placeholderTextColor="#6e7681"
              multiline
              maxLength={MAX_BROADCAST_CONTENT_CHARS}
              accessibilityLabel="Broadcast prompt"
            />
            <Text style={s.broadcastConfirmLabel}>Type <Text style={s.broadcastConfirmPhrase}>{broadcastExpectedConfirmation}</Text> to confirm</Text>
            <TextInput
              style={s.broadcastConfirmation}
              value={broadcastConfirmation}
              onChangeText={setBroadcastConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Broadcast confirmation"
            />
            <TouchableOpacity
              style={[
                s.broadcastSend,
                (!connected || !broadcastPrompt.trim() || broadcastSelectedIds.length === 0 || broadcastConfirmation !== broadcastExpectedConfirmation) ? s.broadcastSendDisabled : null,
              ]}
              disabled={!connected || !broadcastPrompt.trim() || broadcastSelectedIds.length === 0 || broadcastConfirmation !== broadcastExpectedConfirmation}
              onPress={submitBroadcast}
              accessibilityRole="button"
            >
              <Text style={s.broadcastSendText}>Send to {broadcastSelectedIds.length}</Text>
            </TouchableOpacity>
            {!!broadcastError && <Text style={s.broadcastError} accessibilityRole="alert">{broadcastError}</Text>}
            {Object.keys(broadcastReceipts).length > 0 && (
              <View style={s.broadcastReceipts} accessibilityLabel="Broadcast delivery receipts">
                {Object.entries(broadcastReceipts).map(([sessionIdValue, receipt]) => (
                  <View style={[s.broadcastReceipt, ['delivered', 'agent_started'].includes(receipt.status) ? s.broadcastReceiptSuccess : null, receipt.status === 'failed' ? s.broadcastReceiptFailed : null]} key={sessionIdValue}>
                    <Text style={s.broadcastReceiptTitle} numberOfLines={1}>{receipt.title}</Text>
                    <Text style={s.broadcastReceiptStatus}>{receipt.status.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <ScrollView contentContainerStyle={s.usageList}>
            {fleetEntries.length === 0 && (
              <View style={s.fleetEmpty}>
                <Text style={s.fleetEmptyTitle}>Fleet is idle</Text>
                <Text style={s.usageSubtitle}>{fleetIdleCount} connected session{fleetIdleCount === 1 ? ' is' : 's are'} idle. Show idle sessions to inspect them.</Text>
              </View>
            )}
            {fleetEntries.map(entry => (
              <TouchableOpacity
                key={entry.id}
                testID={`fleet-card-${entry.id}`}
                style={[
                  s.fleetCard,
                  entry.state === 'working_goal' ? s.fleetCardWorkingGoal : null,
                  entry.state === 'working' ? s.fleetCardWorking : null,
                  entry.state === 'idle' ? s.fleetCardIdle : null,
                  entry.attention ? s.fleetCardAttention : null,
                ]}
                onPress={() => {
                  setShowFleetView(false);
                  activeSessionRef.current = entry.id;
                  navigation.navigate('Chat', {
                    sessionId: entry.id,
                    title: entry.title,
                    agentType: agentType(entry.session),
                    session: entry.session,
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${entry.title}`}
                accessibilityHint={`${entry.stateLabel}. Activity ${entry.freshness}.`}
              >
                <View style={s.fleetCardTop}>
                  <View style={[s.agentBadge, { backgroundColor: entry.badge.color + '22', borderColor: entry.badge.color + '55' }]}>
                    <AgentIcon agentType={agentType(entry.session)} size={20} />
                  </View>
                  <View style={s.fleetIdentity}>
                    <Text style={s.usageCardTitle} numberOfLines={1}>{entry.title}</Text>
                    <Text style={s.usageSessions}>{entry.badge.label}</Text>
                  </View>
                  <View style={[s.fleetHealth, { backgroundColor: entry.healthColor }]} />
                  <TouchableOpacity
                    style={[s.fleetSelect, broadcastSelectedIds.includes(entry.id) ? s.fleetSelectActive : null, !entry.canReceiveBroadcast ? s.fleetSelectDisabled : null]}
                    disabled={!entry.canReceiveBroadcast}
                    onPress={() => toggleBroadcastSelection(entry.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: broadcastSelectedIds.includes(entry.id), disabled: !entry.canReceiveBroadcast }}
                    accessibilityLabel={`Select ${entry.title} for broadcast`}
                  >
                    <Text style={s.fleetSelectText}>{entry.canReceiveBroadcast ? (broadcastSelectedIds.includes(entry.id) ? 'Selected' : 'Select') : 'Unavailable'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.fleetStatusRow}>
                  <Text style={[
                    s.fleetStateBadge,
                    entry.state === 'working_goal' ? s.fleetStateWorkingGoal : null,
                    entry.state === 'working' ? s.fleetStateWorking : null,
                    entry.state === 'needs_attention' ? s.fleetStateAttention : null,
                  ]}>{entry.stateLabel}</Text>
                  <Text style={s.fleetStatus} numberOfLines={1}>{entry.status}</Text>
                  {entry.working && <Text style={s.fleetElapsed}>{fleetElapsedLabel(entry.activity, fleetNowMs)}</Text>}
                </View>
                {(entry.canControlGoal || entry.goalBlocked || entry.canInterrupt) && <View style={s.fleetControlRow}>
                  {(entry.canControlGoal || entry.goalBlocked) && <TouchableOpacity
                    style={[s.fleetControlButton, (!entry.canControlGoal || fleetControlPending[entry.id]) ? s.fleetControlButtonDisabled : null]}
                    disabled={!entry.canControlGoal || !!fleetControlPending[entry.id]}
                    onPress={event => {
                      event.stopPropagation && event.stopPropagation();
                      if (!entry.canControlGoal || fleetControlPending[entry.id]) return;
                      const requestId = clientRef.current?.controlGoal(entry.id, entry.goalAction, entry.goal, {
                        sessionGeneration: entry.session?.control_generation,
                      });
                      if (requestId) {
                        const next = {
                          ...fleetControlPendingRef.current,
                          [entry.id]: { requestId, command: 'agent_goal_control' },
                        };
                        fleetControlPendingRef.current = next;
                        setFleetControlPending(next);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={entry.canControlGoal
                      ? `${entry.goalAction === 'pause' ? 'Pause' : entry.goalBlocked ? 'Resume blocked' : 'Resume'} goal for ${entry.title}`
                      : `Goal blocked for ${entry.title}; resolve in the native session`}
                    accessibilityHint={entry.goalBlockedReason || undefined}
                  >
                    <Text style={s.fleetControlButtonText}>{fleetControlPending[entry.id]?.command === 'agent_goal_control'
                      ? 'Working...'
                      : entry.goalAction === 'pause'
                        ? 'Pause goal'
                        : entry.goalBlocked
                          ? (entry.canControlGoal ? 'Resume blocked goal' : 'Goal blocked · native action required')
                          : 'Resume goal'}</Text>
                  </TouchableOpacity>}
                  {entry.canInterrupt && <TouchableOpacity
                    style={[s.fleetControlButton, s.fleetInterruptButton, fleetControlPending[entry.id] ? s.fleetControlButtonDisabled : null]}
                    disabled={!!fleetControlPending[entry.id]}
                    onPress={event => {
                      event.stopPropagation && event.stopPropagation();
                      if (fleetControlPending[entry.id]) return;
                      const requestId = clientRef.current?.interrupt(entry.id, {
                        sessionGeneration: entry.session?.control_generation,
                        turnGeneration: entry.session?.turn_generation,
                      });
                      if (requestId) {
                        const next = {
                          ...fleetControlPendingRef.current,
                          [entry.id]: { requestId, command: 'agent_interrupt' },
                        };
                        fleetControlPendingRef.current = next;
                        setFleetControlPending(next);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Interrupt turn for ${entry.title}`}
                  >
                    <Text style={s.fleetControlButtonText}>{fleetControlPending[entry.id]?.command === 'agent_interrupt' ? 'Stopping...' : 'Interrupt turn'}</Text>
                  </TouchableOpacity>}
                </View>}
                <Text style={s.fleetFreshness}>Activity {entry.freshness}</Text>
                <View
                  style={s.fleetWorkContext}
                  accessible
                  accessibilityLabel={`${entry.workContext.label}: ${entry.workContext.text}`}
                >
                  <View style={s.fleetWorkContextHeading}>
                    <Text style={s.fleetWorkContextEyebrow}>{entry.workContext.label}</Text>
                    {Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total)
                      ? <Text style={s.fleetWorkContextProgress}>{entry.workContext.completed}/{entry.workContext.total}</Text> : null}
                  </View>
                  <Text style={s.fleetWorkContextText} numberOfLines={2}>{entry.workContext.text}</Text>
                </View>
                {(entry.workContext.kind === 'goal' || entry.progress != null) && <View
                  style={s.fleetMeter}
                  accessible
                  accessibilityLabel={entry.progress == null
                    ? `${entry.workContext.label} ${entry.stateLabel.toLowerCase()}`
                    : Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total)
                      ? `${entry.workContext.label} ${entry.workContext.completed} of ${entry.workContext.total} complete`
                      : `${entry.workContext.label} ${Math.round(entry.progress)}% complete`}
                >
                  <View style={[
                    s.fleetMeterFill,
                    entry.workContext.kind === 'goal' ? s.fleetMeterGoal : null,
                    !entry.working ? s.fleetMeterInactive : null,
                    entry.progress == null ? (entry.working ? s.fleetMeterIndeterminate : { width: 0 }) : { width: `${entry.progress}%` },
                  ]} />
                </View>}
                <Text style={s.fleetSnippet} numberOfLines={2}>{entry.snippet}</Text>
                <Text style={s.fleetOpen} accessibilityLabel="Open session">Open session <Text accessibilityElementsHidden>{'\u203A'}</Text></Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showTranscriptSearch}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTranscriptSearch(false)}
      >
        <View style={s.usageModal} testID="transcript-search-view">
          <View style={s.usageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.usageTitle}>Transcript search</Text>
              <Text style={s.usageSubtitle}>Search every relay-backed message.</Text>
            </View>
            <TouchableOpacity onPress={() => setShowTranscriptSearch(false)} accessibilityRole="button" accessibilityLabel="Close transcript search">
              <Text style={s.usageClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={s.transcriptSearchForm}>
            <TextInput
              style={s.transcriptSearchInput}
              value={transcriptSearchQuery}
              onChangeText={setTranscriptSearchQuery}
              placeholder="Words from any conversation"
              placeholderTextColor="#6e7681"
              maxLength={200}
              returnKeyType="search"
              onSubmitEditing={runTranscriptSearch}
              autoFocus
            />
            <TextInput style={s.transcriptSearchInput} value={transcriptSearchProject} onChangeText={setTranscriptSearchProject} placeholder="Project (exact)" placeholderTextColor="#6e7681" maxLength={300} />
            <TextInput style={s.transcriptSearchInput} value={transcriptSearchHarness} onChangeText={setTranscriptSearchHarness} placeholder="Harness (e.g. codex_cli)" placeholderTextColor="#6e7681" maxLength={80} autoCapitalize="none" />
            <View style={s.transcriptSearchDateRow}>
              <TextInput style={[s.transcriptSearchInput, s.transcriptSearchDate]} value={transcriptSearchFrom} onChangeText={setTranscriptSearchFrom} placeholder="From YYYY-MM-DD" placeholderTextColor="#6e7681" maxLength={10} autoCapitalize="none" />
              <TextInput style={[s.transcriptSearchInput, s.transcriptSearchDate]} value={transcriptSearchTo} onChangeText={setTranscriptSearchTo} placeholder="To YYYY-MM-DD" placeholderTextColor="#6e7681" maxLength={10} autoCapitalize="none" />
            </View>
            <TouchableOpacity style={[s.transcriptSearchButton, transcriptSearchQuery.trim().length < 2 || transcriptSearchLoading ? s.broadcastSendDisabled : null]} onPress={runTranscriptSearch} disabled={transcriptSearchQuery.trim().length < 2 || transcriptSearchLoading} accessibilityRole="button">
              <Text style={s.broadcastSendText}>{transcriptSearchLoading ? 'Searching…' : 'Search transcripts'}</Text>
            </TouchableOpacity>
          </View>
          {!transcriptSearchIndexReady && <Text style={s.transcriptSearchIndexing}>Older history is still indexing; current results are partial.</Text>}
          {!!transcriptSearchError && <Text style={s.transcriptSearchError} accessibilityRole="alert">{transcriptSearchError}</Text>}
          {!transcriptSearchLoading && !transcriptSearchError && transcriptSearchResults.length === 0 && transcriptSearchQuery.trim().length >= 2 && <Text style={s.transcriptSearchEmpty}>No matches. Try fewer words or clear a filter.</Text>}
          <ScrollView contentContainerStyle={s.transcriptSearchResults} keyboardShouldPersistTaps="handled">
            {transcriptSearchResults.map(result => (
              <TouchableOpacity
                key={`${result.session_id}:${result.message_id}`}
                style={s.transcriptSearchResult}
                onPress={() => {
                  setShowTranscriptSearch(false);
                  navigation.navigate('Chat', {
                    sessionId: result.session_id,
                    title: result.workspace_name || result.project_root || result.session_id,
                    agentType: result.agent_type || 'unknown',
                    searchMessageId: result.message_id,
                    session: sessions.find(item => sessionKey(item) === result.session_id),
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open transcript match in ${result.workspace_name || result.session_id}`}
              >
                <View style={s.transcriptSearchResultTop}>
                  <Text style={s.transcriptSearchResultTitle} numberOfLines={1}>{result.workspace_name || result.project_root || result.session_id}</Text>
                  <Text style={s.transcriptSearchResultMeta}>{result.agent_type || 'unknown'} · {result.role}</Text>
                </View>
                <Text style={s.transcriptSearchSnippet} numberOfLines={4}>{result.snippet || '(empty message)'}</Text>
                <Text style={s.transcriptSearchOpen}>Open match ›</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* JWT expiry warning */}
      {jwtDaysLeft !== null && jwtDaysLeft <= 7 && (
        <TouchableOpacity
          style={s.expiryBanner}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={s.expiryText}>
            {jwtDaysLeft === 0
              ? 'Session expires today — tap to re-authenticate'
              : `Session expires in ${jwtDaysLeft} day${jwtDaysLeft === 1 ? '' : 's'} — tap to re-authenticate`}
          </Text>
        </TouchableOpacity>
      )}

      {sessions.length > 0 && (
        <View style={s.searchContainer}>
          <TextInput
            style={s.searchInput}
            placeholder="Search sessions…"
            placeholderTextColor="#484f58"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity style={s.searchClear} onPress={() => setSearchQuery('')}>
              <Text style={s.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View
        style={[s.orderControl, !sidebarOrderChanged && s.orderControlHidden]}
        pointerEvents={sidebarOrderChanged ? 'auto' : 'none'}
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={!sidebarOrderChanged}
      >
        <Text style={s.orderControlLabel}>Order changed</Text>
        <TouchableOpacity
          style={s.orderControlButton}
          accessibilityRole="button"
          accessibilityLabel="Sort now"
          disabled={!sidebarOrderChanged}
          onPress={sortSidebarNow}
        >
          <Text style={s.orderControlButtonText}>Sort now</Text>
        </TouchableOpacity>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => sessionId(item)}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={32}
        windowSize={9}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onTouchStart={beginSidebarInteraction}
        onTouchEnd={() => endSidebarInteraction(120)}
        onScrollBeginDrag={beginSidebarInteraction}
        onScrollEndDrag={() => endSidebarInteraction(220)}
        onMomentumScrollBegin={beginSidebarInteraction}
        onMomentumScrollEnd={() => endSidebarInteraction(120)}
        contentContainerStyle={sessions.length === 0 ? s.emptyContainer : s.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => clientRef.current?.connect()}
            tintColor="#58a6ff"
          />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No active sessions</Text>
            <Text style={s.emptyHint}>
              Start an agent in Antigravity IDE to see sessions here.
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={[
              s.sectionHeader,
              section.pinned && s.pinnedSectionHeader,
              section.workingNow && s.workingSectionHeader,
              section.recent && s.recentSectionHeader,
            ]}
          >
            {section.workingNow ? (
              <View style={s.sectionToggle} accessibilityElementsHidden>
                <Text style={s.sectionWorkingIcon}>W</Text>
              </View>
            ) : section.pinned ? (
              <View style={s.sectionToggle} accessibilityElementsHidden>
                <Text style={s.sectionPinIcon}>📌</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={s.sectionToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: !section.collapsed }}
                accessibilityLabel={`${section.collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
                onPress={() => toggleGroup(section.key)}
              >
                <Text style={s.sectionCaret}>{section.collapsed ? '>' : 'v'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.sectionTitleButton}
              accessibilityRole="button"
              accessibilityLabel={`Show full group name: ${section.title}`}
              onPress={() => setTitleDisclosure({ kind: section.workingNow ? 'Activity group' : section.recent ? 'Recent group' : section.pinned ? 'Pinned group' : 'Workspace group', title: section.title })}
              onLongPress={() => setTitleDisclosure({ kind: section.workingNow ? 'Activity group' : section.recent ? 'Recent group' : section.pinned ? 'Pinned group' : 'Workspace group', title: section.title })}
            >
              <Text style={s.sectionTitle} numberOfLines={2}>{section.title}</Text>
            </TouchableOpacity>
            <View style={s.sectionAlertSlot}>
              {section.hasPrompt && <Text style={s.sectionAlert}>!</Text>}
            </View>
            <View style={s.sectionWorkingSlot}>
              {section.working && <View style={s.sectionWorking} />}
            </View>
            <View style={s.sectionUnreadSlot}>
              {section.unread > 0 && <View style={s.sectionUnread}>
                <Text style={s.sectionUnreadText}>{section.unread > 99 ? '99+' : section.unread}</Text>
              </View>}
            </View>
            <View style={s.sectionCount}>
              <Text style={s.sectionCountText}>{section.count}</Text>
            </View>
          </View>
        )}
        renderItem={({ item, section }) => {
          const sid    = sessionId(item);
          const label  = activityLabel(sid, agentType(item));
          const dotColor = healthDotColor(sid);
          const subtitle = sessionSubtitle(item);
          const badge  = agentBadge(agentType(item));
          const workspaceLabel = (section.workingNow || section.recent || section.pinned)
            ? workspaceLabelBySessionId[sid] || 'Unscoped' : '';
          const contextualSubtitle = workspaceLabel ? `${subtitle || badge.label} / ${workspaceLabel}` : subtitle;
          const latestVisibleMessage = section.recent ? normalizeLatestVisibleMessage(item) : null;
          const recentMessageInstant = latestVisibleMessage ? parseMessageInstant(latestVisibleMessage.at) : null;
          const rowUsagePercent = Number(item?.percent_used);
          const rowUsageReset = item?.rate_limited_until && item.rate_limited_until !== 'unknown'
            ? String(item.rate_limited_until) : '';
          const rowUsageLabel = item?.rate_limit_active === true
            ? `Usage limited${rowUsageReset ? ` · resets ${rowUsageReset}` : ' · reset unknown'}`
            : Number.isFinite(rowUsagePercent) && rowUsagePercent >= 75
              ? `Usage ${Math.round(rowUsagePercent)}% used${rowUsageReset ? ` · resets ${rowUsageReset}` : ''}`
              : '';
          const rowActivityLabel = rowUsageLabel || (recentMessageInstant
            ? `Last message ${formatVisibleMessageTime(recentMessageInstant)}`
            : label);
          const unread = testSessionIds.has(sid) ? 0 : unreadMap[sid] || 0;
          const hasPerm = !!permPrompts[sid];
          const promptRequiredLabel = permPrompts[sid]?.type === 'question_prompt'
            ? 'Question required' : 'Permission required';
          const pinned = !!sessionPreferences[sid]?.pinned;
          return (
            <TouchableOpacity
              style={[s.card, pinned && s.pinnedCard]}
              activeOpacity={0.75}
              delayLongPress={350}
                onLongPress={() => setTitleDisclosure({ kind: 'Session', title: sessionName(item), subtitle: contextualSubtitle || badge.label })}
              onPress={() => {
                activeSessionRef.current = sid;
                setUnreadMap(prev => { const next = { ...prev }; delete next[sid]; return next; });
                navigation.navigate('Chat', {
                  sessionId:  sid,
                  title:      sessionName(item),
                  agentType:  agentType(item),
                  session:    item,
                });
              }}
            >
              <View style={s.badgeWrap}>
                <View style={[s.agentBadge, { backgroundColor: badge.color + '22', borderColor: badge.color + '55' }]}>
                  <AgentIcon agentType={agentType(item)} size={20} />
                </View>
                <View style={[s.healthDotOverlay, { backgroundColor: dotColor }]} />
                {!!sessionPreferences[sid]?.muted && <Text style={s.mutedBadgeOverlay}>M</Text>}
                {pinned && <TouchableOpacity
                  style={s.pinToggleOverlay}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Unpin ${sessionName(item)}`}
                  accessibilityState={{ selected: true }}
                  onPress={(event) => {
                    event.stopPropagation && event.stopPropagation();
                    saveSessionPreference(sid, { pinned: false })
                      .catch(error => Alert.alert('Unable to unpin chat', error.message));
                  }}
                >
                  <Text style={s.pinToggleText}>📌</Text>
                </TouchableOpacity>}
              </View>
              <View style={s.cardMain}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Show full title: ${sessionName(item)}`}
                  onPress={(event) => {
                    event.stopPropagation && event.stopPropagation();
                    setTitleDisclosure({ kind: 'Session', title: sessionName(item), subtitle: contextualSubtitle || badge.label });
                  }}
                  onLongPress={() => setTitleDisclosure({ kind: 'Session', title: sessionName(item), subtitle: contextualSubtitle || badge.label })}
                >
                  <Text style={s.cardName} numberOfLines={2}>{sessionName(item)}</Text>
                </TouchableOpacity>
                {hasPerm
                  ? <Text style={s.cardPermLabel} numberOfLines={1}>{`${badge.label} · ${promptRequiredLabel}`}</Text>
                  : <Text style={s.cardSubtitle} numberOfLines={1}>{contextualSubtitle || ' '}</Text>}
                <Text
                  style={[s.cardActivity, !rowActivityLabel && s.reservedTextHidden]}
                  numberOfLines={1}
                  accessibilityLabel={recentMessageInstant ? `Last message at ${recentMessageInstant.iso}` : undefined}
                >{rowActivityLabel || 'Reserved'}</Text>
              </View>
              <View style={s.cardSignalSlot}>
                {hasPerm
                  ? <Text style={s.permBadge}>⚠</Text>
                  : item?.rate_limit_active === true ? <Text style={s.permBadge}>⏳</Text>
                  : unread > 0 ? <View style={s.unreadBadge}>
                    <Text style={s.unreadBadgeText}>
                      {unread > 99 ? '99+' : unread}
                    </Text>
                  </View> : null}
              </View>
              <TouchableOpacity
                style={s.cardMenuBtn}
                onPress={(event) => {
                  event.stopPropagation && event.stopPropagation();
                  setManagingSession(item);
                  setShowSessionPreferences(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Session actions for ${sessionName(item)}`}
              >
                <Text style={s.cardMenuText}>⋯</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />

      <View style={s.lifecycleBar}>
        <TouchableOpacity
          style={[s.lifecycleBtn, s.launchBtn]}
          activeOpacity={0.7}
          onPress={() => {
            setLaunchState(null);
            setShowLaunch(true);
          }}
          disabled={!connected}
          accessibilityRole="button"
        >
          <Text style={s.launchBtnText}>New Session</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.lifecycleBtn}
          activeOpacity={0.7}
          onPress={() => setShowHistory(true)}
          disabled={!connected}
          accessibilityRole="button"
        >
          <Text style={s.resumeBtnText}>Resume Past</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.lifecycleBtn}
          activeOpacity={0.7}
          onPress={() => {
            setManagingSession(null);
            setShowSessionPreferences(true);
          }}
          accessibilityRole="button"
        >
          <Text style={s.resumeBtnText}>
            Hidden ({managedSessions.filter(item => sessionPreferences[sessionId(item)]?.archived).length})
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        transparent
        visible={!!titleDisclosure}
        animationType={reducedMotion ? 'none' : 'fade'}
        onRequestClose={() => setTitleDisclosure(null)}
      >
        <TouchableOpacity
          style={s.titleDisclosureOverlay}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Close full title"
          onPress={() => setTitleDisclosure(null)}
        >
          <View style={s.titleDisclosureCard} accessibilityViewIsModal>
            <Text style={s.titleDisclosureKind}>{titleDisclosure?.kind || 'Full title'}</Text>
            <Text style={s.titleDisclosureText}>{titleDisclosure?.title || ''}</Text>
            {!!titleDisclosure?.subtitle && <Text style={s.titleDisclosureSubtitle}>{titleDisclosure.subtitle}</Text>}
            <Text style={s.titleDisclosureHint}>Tap anywhere to close</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <LaunchSessionSheet
        visible={showLaunch}
        launchState={launchState}
        onLaunch={beginLaunch}
        onClose={() => {
          if (launchState?.status !== 'launching') setShowLaunch(false);
        }}
      />

      <SessionHistorySheet
        visible={showHistory}
        includeTestSessions={showTestSessions}
        onResume={beginResume}
        onClose={() => setShowHistory(false)}
      />
      <SessionPreferencesSheet
        visible={showSessionPreferences}
        sessions={sidebarSessions}
        preferences={sessionPreferences}
        initialSession={managingSession}
        onSave={saveSessionPreference}
        onCloseSession={(session) => {
          setShowSessionPreferences(false);
          confirmCloseSession(session);
        }}
        onAutomations={() => {
          setShowSessionPreferences(false);
          navigation.navigate('Automations');
        }}
        onSkills={(session) => {
          setShowSessionPreferences(false);
          navigation.navigate('Skills', { sessionId: sessionId(session) });
        }}
        onClose={() => setShowSessionPreferences(false)}
      />
    </View>
  );
}

// ── Skeleton shimmer card ────────────────────────────────────────────────────

function SkeletonCard({ delay = 0 }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.45);
      return undefined;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.6, duration: 800, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [reducedMotion]);
  return (
    <Animated.View style={[s.card, { opacity }]}>
      <View style={[s.agentBadge, { backgroundColor: '#21262d', borderColor: '#30363d', marginRight: 10 }]}>
        <View style={{ width: 14, height: 10, backgroundColor: '#30363d', borderRadius: 3 }} />
      </View>
      <View style={s.cardMain}>
        <View style={{ backgroundColor: '#30363d', borderRadius: 4, width: '60%', height: 14 }} />
        <View style={{ backgroundColor: '#21262d', borderRadius: 4, width: '35%', height: 10, marginTop: 6 }} />
      </View>
    </Animated.View>
  );
}

// Set header right button from parent
SessionListScreen.navigationOptions = ({ navigation }) => ({
  headerRight: () => (
    <TouchableOpacity onPress={() => navigation.getParent()?.setParams({ signOut: true })} style={{ marginRight: 12 }}>
      <Text style={{ color: '#768390', fontSize: 14 }}>Sign out</Text>
    </TouchableOpacity>
  ),
});

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
  },
  lifecycleBar: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#30363d',
    backgroundColor: '#0d1117',
  },
  duplicateProxyBanner: {
    backgroundColor: '#4b2e0b',
    borderBottomColor: '#d29922',
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  duplicateProxyTitle: { color: '#f0d49a', fontSize: 13, fontWeight: '700' },
  duplicateProxyText: { color: '#d7bd87', fontSize: 12, marginTop: 2 },
  appUpdatePassBanner: {
    backgroundColor: '#123b2a',
    borderBottomColor: '#3fb950',
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  appUpdatePassTitle: { color: '#b8f2c8', fontSize: 13, fontWeight: '700' },
  appUpdatePassText: { color: '#9ddeaf', fontSize: 12, marginTop: 2 },
  lifecycleBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(104, 179, 255, 0.3)',
    backgroundColor: 'rgba(104, 179, 255, 0.08)',
    alignItems: 'center',
  },
  launchBtn: {
    backgroundColor: '#238636',
    borderColor: '#2ea043',
  },
  launchBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  resumeBtnText: {
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    flex:            1,
    backgroundColor: '#0b0f14',
    justifyContent:  'center',
    alignItems:      'center',
  },
  disconnectBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#f0883e',
    paddingVertical:   8,
    alignItems:        'center',
  },
  expiryBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#d29922',
    paddingVertical:   8,
    alignItems:        'center',
    paddingHorizontal: 16,
  },
  expiryText: {
    color:    '#d29922',
    fontSize: 13,
    textAlign: 'center',
  },
  disconnectText: {
    color:    '#f0883e',
    fontSize: 13,
  },
  connectionHealthBar: {
    minHeight: 26,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0d1117',
  },
  connectionHealthDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  connectionHealthText: {
    color: '#8b949e',
    fontSize: 11,
    flexShrink: 1,
  },
  usageButton: {
    marginLeft: 0,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  usageButtonActive: { backgroundColor: '#1f3b57', borderColor: '#58a6ff' },
  usageButtonText: { color: '#58a6ff', fontSize: 11, fontWeight: '700' },
  validationModal: { flex: 1, backgroundColor: '#0b0f14' },
  validationList: { padding: 12, gap: 10, paddingBottom: 32 },
  validationCard: { backgroundColor: '#111820', borderColor: '#30363d', borderWidth: 1, borderRadius: 10, padding: 12, gap: 5 },
  validationCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  validationHarness: { color: '#f0f6fc', fontSize: 15, fontWeight: '700', flex: 1 },
  validationStatus: { fontSize: 11, fontWeight: '700' },
  validationPass: { color: '#3fb950' },
  validationFail: { color: '#f85149' },
  validationMeta: { color: '#8b949e', fontSize: 12, lineHeight: 17 },
  validationReason: { color: '#f0d49a', fontSize: 12, lineHeight: 17, marginTop: 3 },
  validationEmpty: { color: '#8b949e', fontSize: 13, lineHeight: 19, padding: 18, textAlign: 'center' },
  usageModal: { flex: 1, backgroundColor: '#0b0f14' },
  usageHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#30363d',
  },
  usageTitle: { color: '#f0f6fc', fontSize: 21, fontWeight: '700' },
  usageSubtitle: { color: '#8b949e', fontSize: 12, marginTop: 3 },
  usageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  usageClose: { color: '#58a6ff', fontSize: 14, fontWeight: '600', padding: 8 },
  usageRefreshDisabled: { opacity: 0.55 },
  usageSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14 },
  usageSummaryCell: {
    width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'baseline', gap: 7,
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 10, padding: 12,
  },
  usageSummaryValue: { color: '#f0f6fc', fontSize: 19, fontWeight: '700' },
  usageSummaryLabel: { color: '#8b949e', fontSize: 10, textTransform: 'uppercase' },
  usageList: { paddingHorizontal: 14, paddingBottom: 28, gap: 10 },
  usageCard: {
    gap: 12,
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 13,
  },
  usageProviderHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  usageProviderIdentity: { flex: 1, minWidth: 0 },
  usageStatus: { borderWidth: 1, borderRadius: 12, fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, textTransform: 'capitalize' },
  usageCollapseMark: { color: '#8b949e', fontSize: 18, width: 14, textAlign: 'center' },
  usageMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  usageCardRefresh: { borderColor: '#30363d', borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  usageCardRefreshText: { color: '#58a6ff', fontSize: 11, fontWeight: '600' },
  usageCardBody: { flex: 1, gap: 7 },
  usageCardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  usageCardTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '700' },
  usageSessions: { color: '#8b949e', fontSize: 11 },
  usageRemaining: { fontSize: 13, fontWeight: '700' },
  usageWindows: { gap: 13 },
  usageWindow: { gap: 6 },
  usageWindowTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '700' },
  usageMeter: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: '#30363d' },
  usageMeterFill: { height: 5, borderRadius: 3 },
  usageThresholds: { color: '#6e7681', fontSize: 9 },
  usagePace: { gap: 7, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 8 },
  usagePaceRacing: { borderColor: '#d2992288' },
  usagePaceBurning: { borderColor: '#f8514999' },
  usagePaceCategory: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  usagePaceChart: { height: 7, borderRadius: 4, backgroundColor: '#30363d', position: 'relative', overflow: 'visible' },
  usagePaceActual: { height: 7, borderRadius: 4, backgroundColor: '#58a6ff' },
  usagePaceMarker: { position: 'absolute', top: -3, width: 2, height: 13 },
  usagePaceBudgets: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  usagePaceBudget: { width: '47%', flexGrow: 1, minWidth: 0 },
  usageReset: { color: '#8b949e', fontSize: 11 },
  usageUnavailable: { color: '#8b949e', fontSize: 12 },
  usageCredits: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  usageCreditCell: { flexGrow: 1, minWidth: 140, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 9, gap: 2 },
  usageCreditLabel: { color: '#8b949e', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  usageCreditValue: { color: '#f0f6fc', fontSize: 11 },
  usageResetCredits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  usageResetCredit: { backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 },
  usageResetAttention: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8514914', borderWidth: 1, borderColor: '#f8514988', borderRadius: 9, padding: 10 },
  usageResetButton: { backgroundColor: '#da3633', borderWidth: 1, borderColor: '#f85149', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  usageResetButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  usageStaleError: { color: '#d29922', backgroundColor: '#d2992216', borderRadius: 7, padding: 8, fontSize: 11 },
  usageSourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  usageDashboardLink: { color: '#58a6ff', fontSize: 11, fontWeight: '600', paddingVertical: 5 },
  usageEmpty: { alignItems: 'center', gap: 5, borderWidth: 1, borderStyle: 'dashed', borderColor: '#30363d', borderRadius: 12, padding: 30 },
  usageEmptyTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '700' },
  usageCostPanel: { gap: 11, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 13 },
  usageCostStatus: { color: '#3fb950', borderWidth: 1, borderColor: '#3fb95066', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  usageCostState: { gap: 4, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 9 },
  usageCostControls: { flexDirection: 'row', gap: 6 },
  usageCostChip: { maxWidth: 160, borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 6 },
  usageCostChipActive: { borderColor: '#58a6ff', backgroundColor: '#58a6ff18' },
  usageCostChipText: { color: '#c9d1d9', fontSize: 10, fontWeight: '600' },
  usageCostSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  usageCostSummaryCell: { width: '47%', flexGrow: 1, minWidth: 0, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 8, gap: 2 },
  usageCostChart: { height: 76, flexDirection: 'row', alignItems: 'flex-end', gap: 2, overflow: 'hidden', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, paddingHorizontal: 7, paddingTop: 7 },
  usageCostBarCell: { flex: 1, minWidth: 2, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  usageCostBar: { width: '100%', maxWidth: 14, minHeight: 2, backgroundColor: '#58a6ff', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  usageCostBarLabel: { color: '#6e7681', fontSize: 7, minHeight: 9 },
  usageCostTable: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#30363d', borderRadius: 8, overflow: 'hidden' },
  usageCostRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#30363d', paddingHorizontal: 8 },
  usageCostModel: { flex: 1, minWidth: 0, color: '#f0f6fc', fontSize: 9, fontWeight: '600' },
  usageCostMetric: { color: '#8b949e', fontSize: 8 },
  usageCostFallbacks: { gap: 3, backgroundColor: '#d2992212', borderRadius: 7, padding: 8 },
  hostResourceList: { paddingHorizontal: 14, paddingBottom: 28, gap: 10 },
  hostResourceMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 12 },
  hostResourceStatus: { borderWidth: 1, borderRadius: 12, fontSize: 9, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, textTransform: 'uppercase' },
  hostResourceStatusLive: { borderColor: '#3fb95088', color: '#3fb950' },
  hostResourceStatusWarning: { borderColor: '#d2992288', color: '#d29922' },
  hostResourceStatusPaused: { borderColor: '#58a6ff88', color: '#58a6ff' },
  hostResourceStatusReconnecting: { borderColor: '#bc8cff88', color: '#bc8cff' },
  hostResourceStatusUnavailable: { borderColor: '#f8514988', color: '#f85149' },
  hostResourceError: { color: '#ff7b72', backgroundColor: '#f851491a', borderWidth: 1, borderColor: '#f8514966', borderRadius: 8, padding: 10, fontSize: 12 },
  hostResourceControls: { alignItems: 'center', gap: 6, paddingVertical: 2, paddingRight: 12 },
  hostResourceControlButton: { minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 },
  hostResourceControlButtonActive: { borderColor: '#58a6ff', backgroundColor: '#58a6ff18' },
  hostResourceControlText: { color: '#8b949e', fontSize: 10, fontWeight: '700' },
  hostResourceControlTextActive: { color: '#58a6ff' },
  hostResourceSampleCount: { color: '#8b949e', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hostResourceSummaryCell: { width: '47%', flexGrow: 1, minWidth: 0, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 10, padding: 11, gap: 2 },
  hostResourceSummaryDetail: { color: '#6e7681', fontSize: 9, marginTop: 2 },
  hostResourceCharts: { gap: 10 },
  hostResourceChart: { width: '100%', minWidth: 0, minHeight: 300, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 11, gap: 8 },
  hostResourceChartLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hostResourceChartTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '800' },
  hostResourceChartDescription: { color: '#8b949e', fontSize: 9, marginTop: 2 },
  hostResourceChartQuality: { color: '#c9d1d9', fontSize: 10, lineHeight: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceChartAction: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, paddingHorizontal: 10 },
  hostResourceChartActionText: { color: '#c9d1d9', fontSize: 9, fontWeight: '700' },
  hostResourceChartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hostResourceLegendButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#30363d', borderRadius: 16, paddingHorizontal: 8, paddingVertical: 5 },
  hostResourceLegendButtonOff: { opacity: 0.45 },
  hostResourceLegendDot: { width: 8, height: 8, borderRadius: 4 },
  hostResourceLegendText: { color: '#c9d1d9', fontSize: 9, fontWeight: '600' },
  hostResourceChartCanvas: { minHeight: 150, overflow: 'hidden', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8 },
  hostResourceChartAxis: { position: 'absolute', top: 5, left: 5, bottom: 18, justifyContent: 'space-between', alignItems: 'flex-start' },
  hostResourceChartXAxis: { position: 'absolute', left: 42, right: 10, bottom: 2, flexDirection: 'row', justifyContent: 'space-between' },
  hostResourceChartValue: { color: '#c9d1d9', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceChartTime: { color: '#c9d1d9', fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceChartTooltip: { backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 8, gap: 2 },
  hostResourceChartTooltipTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceChartTooltipText: { color: '#c9d1d9', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceChartStats: { gap: 3 },
  hostResourceChartStatText: { color: '#c9d1d9', fontSize: 10, lineHeight: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceDataToggle: { minHeight: 34, alignSelf: 'flex-start', justifyContent: 'center', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, paddingHorizontal: 10 },
  hostResourceDataToggleText: { color: '#58a6ff', fontSize: 9, fontWeight: '700' },
  hostResourceDataTable: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#30363d', borderRadius: 8, overflow: 'hidden' },
  hostResourceDataRow: { gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#30363d', paddingHorizontal: 8, paddingVertical: 6 },
  hostResourceDataTime: { color: '#8b949e', fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceDataValues: { color: '#c9d1d9', fontSize: 8, lineHeight: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceProcessCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, overflow: 'hidden' },
  hostResourceProcessHeading: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 13 },
  hostResourceProcessControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12, paddingBottom: 10 },
  hostResourceProcessSearch: { width: '100%', minHeight: 42, color: '#f0f6fc', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  hostResourceProcessControl: { minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6 },
  hostResourceProcessControlText: { color: '#c9d1d9', fontSize: 9, fontWeight: '700' },
  hostResourceProcessOverlay: { gap: 4, marginHorizontal: 12, marginBottom: 10, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#58a6ff88', borderRadius: 9, padding: 10 },
  hostResourceProcessRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#30363d' },
  hostResourceProcessAttributed: { borderLeftWidth: 3, borderLeftColor: '#58a6ff', paddingLeft: 9 },
  hostResourceProcessSelected: { backgroundColor: '#58a6ff12' },
  hostResourceProcessExpand: { width: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#30363d', borderRadius: 17 },
  hostResourceProcessIdentity: { flex: 1, minWidth: 0 },
  hostResourceProcessTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '700' },
  hostResourceProcessTitleAttributed: { color: '#58a6ff' },
  hostResourceProcessReason: { color: '#8b949e', fontSize: 9, lineHeight: 12 },
  hostResourceProcessMetrics: { alignItems: 'flex-end', gap: 2 },
  hostResourceProcessMetric: { color: '#c9d1d9', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourceProcessIo: { color: '#6e7681', fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  hostResourcePrivacy: { color: '#8b949e', fontSize: 10, lineHeight: 15 },
  fleetSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14, paddingBottom: 8 },
  fleetSummaryCell: {
    width: '47%', flexGrow: 1, minWidth: 0, alignItems: 'flex-start', gap: 2,
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 10, padding: 11,
  },
  fleetFilterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 8 },
  fleetFilterText: { color: '#8b949e', fontSize: 11 },
  fleetFilterButton: { borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  fleetFilterButtonText: { color: '#c9d1d9', fontSize: 11, fontWeight: '600' },
  broadcastPanel: {
    marginHorizontal: 14, marginBottom: 14, padding: 13, gap: 9,
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12,
  },
  broadcastHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  broadcastTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '700' },
  broadcastCount: { color: '#8b949e', fontSize: 11, borderWidth: 1, borderColor: '#30363d', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  broadcastPrompt: { minHeight: 68, color: '#f0f6fc', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 10, textAlignVertical: 'top' },
  broadcastConfirmLabel: { color: '#8b949e', fontSize: 11 },
  broadcastConfirmPhrase: { color: '#f0f6fc', fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  broadcastConfirmation: { color: '#f0f6fc', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  broadcastSend: { alignItems: 'center', backgroundColor: '#238636', borderRadius: 8, paddingVertical: 10 },
  broadcastSendDisabled: { opacity: 0.42 },
  broadcastSendText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  broadcastError: { color: '#f85149', fontSize: 12 },
  broadcastReceipts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  broadcastReceipt: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#30363d', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  broadcastReceiptSuccess: { borderColor: '#3fb95099' },
  broadcastReceiptFailed: { borderColor: '#f85149bb' },
  broadcastReceiptTitle: { color: '#f0f6fc', fontSize: 10, maxWidth: 160 },
  broadcastReceiptStatus: { color: '#8b949e', fontSize: 10 },
  fleetCard: {
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12,
    padding: 14, gap: 9,
  },
  fleetCardWorkingGoal: { borderColor: '#3fb950', borderLeftWidth: 3 },
  fleetCardWorking: { borderColor: '#58a6ff', borderLeftWidth: 3 },
  fleetCardIdle: { opacity: 0.82 },
  fleetCardAttention: { borderColor: '#d29922' },
  fleetCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fleetIdentity: { flex: 1, minWidth: 0 },
  fleetHealth: { width: 8, height: 8, borderRadius: 4 },
  fleetSelect: { borderWidth: 1, borderColor: '#30363d', borderRadius: 11, paddingHorizontal: 7, paddingVertical: 4 },
  fleetSelectActive: { borderColor: '#58a6ff', backgroundColor: '#1f6feb22' },
  fleetSelectDisabled: { opacity: 0.5 },
  fleetSelectText: { color: '#8b949e', fontSize: 10, fontWeight: '600' },
  fleetStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fleetControlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  fleetControlButton: { borderWidth: 1, borderColor: '#388bfd', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#0d2138' },
  fleetInterruptButton: { borderColor: '#d29922', backgroundColor: '#2d210d' },
  fleetControlButtonDisabled: { opacity: 0.55 },
  fleetControlButtonText: { color: '#f0f6fc', fontSize: 11, fontWeight: '700' },
  fleetStatus: { color: '#f0f6fc', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  fleetElapsed: { color: '#8b949e', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginLeft: 'auto' },
  fleetAttention: { color: '#d29922', fontSize: 10, borderWidth: 1, borderColor: '#d2992288', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  fleetStateBadge: { color: '#8b949e', fontSize: 10, fontWeight: '700', borderWidth: 1, borderColor: '#30363d', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  fleetStateWorkingGoal: { color: '#3fb950', borderColor: '#3fb95088', backgroundColor: '#3fb95018' },
  fleetStateWorking: { color: '#58a6ff', borderColor: '#58a6ff88', backgroundColor: '#58a6ff18' },
  fleetStateAttention: { color: '#d29922', borderColor: '#d2992288', backgroundColor: '#d2992218' },
  fleetFreshness: { color: '#6e7681', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: -4 },
  fleetWorkContext: { minHeight: 45, gap: 3 },
  fleetWorkContextHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fleetWorkContextEyebrow: { color: '#6e7681', fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  fleetWorkContextProgress: { color: '#8b949e', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  fleetWorkContextText: { minHeight: 32, color: '#c9d1d9', fontSize: 12, lineHeight: 16 },
  fleetMeter: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#30363d' },
  fleetMeterFill: { height: 6, borderRadius: 3, backgroundColor: '#58a6ff', minWidth: 3 },
  fleetMeterGoal: { backgroundColor: '#3fb950' },
  fleetMeterIndeterminate: { width: '35%' },
  fleetMeterInactive: { backgroundColor: '#6e7681' },
  fleetSnippet: { color: '#8b949e', fontSize: 12, lineHeight: 17 },
  fleetOpen: { color: '#58a6ff', fontSize: 11, fontWeight: '700', textAlign: 'right' },
  fleetEmpty: { alignItems: 'center', gap: 8, paddingVertical: 80 },
  fleetEmptyTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '700' },
  transcriptSearchForm: { gap: 9, padding: 14, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  transcriptSearchInput: { borderWidth: 1, borderColor: '#30363d', borderRadius: 8, backgroundColor: '#0d1117', color: '#f0f6fc', paddingHorizontal: 11, paddingVertical: 10, fontSize: 13 },
  transcriptSearchDateRow: { flexDirection: 'row', gap: 8 },
  transcriptSearchDate: { flex: 1 },
  transcriptSearchButton: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#1f6feb' },
  transcriptSearchIndexing: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: '#9e6a03', borderRadius: 8, padding: 10, color: '#d29922', backgroundColor: '#9e6a031a', fontSize: 12 },
  transcriptSearchError: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: '#f8514966', borderRadius: 8, padding: 10, color: '#ff7b72', backgroundColor: '#f851491a', fontSize: 12 },
  transcriptSearchEmpty: { color: '#8b949e', textAlign: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  transcriptSearchResults: { gap: 10, padding: 14, paddingBottom: 32 },
  transcriptSearchResult: { borderWidth: 1, borderColor: '#30363d', borderRadius: 10, backgroundColor: '#161b22', padding: 13, gap: 8 },
  transcriptSearchResultTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  transcriptSearchResultTitle: { flex: 1, minWidth: 0, color: '#f0f6fc', fontWeight: '700', fontSize: 13 },
  transcriptSearchResultMeta: { color: '#8b949e', fontSize: 10 },
  transcriptSearchSnippet: { color: '#b1bac4', fontSize: 12, lineHeight: 17 },
  transcriptSearchOpen: { color: '#58a6ff', fontSize: 11, fontWeight: '700', textAlign: 'right' },
  searchContainer: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  12,
    marginTop:         12,
    marginBottom:      4,
    backgroundColor:   '#161b22',
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#30363d',
  },
  searchInput: {
    flex:              1,
    color:             '#cdd9e5',
    fontSize:          14,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  searchClear: {
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  searchClearText: {
    color:    '#768390',
    fontSize: 14,
  },
  orderControl: {
    height:            30,
    marginHorizontal:  12,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'flex-end',
    gap:               8,
  },
  orderControlHidden: {
    opacity: 0,
  },
  orderControlLabel: {
    color:      '#9da7b3',
    fontSize:   11,
    fontWeight: '600',
  },
  orderControlButton: {
    minWidth:          64,
    height:            24,
    paddingHorizontal: 8,
    borderWidth:       1,
    borderColor:       '#58a6ff66',
    borderRadius:      6,
    alignItems:        'center',
    justifyContent:    'center',
    backgroundColor:   '#58a6ff14',
  },
  orderControlButtonText: {
    color:      '#58a6ff',
    fontSize:   11,
    fontWeight: '700',
  },
  list: {
    padding: 12,
    gap:     8,
  },
  sectionHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    height:            52,
    paddingHorizontal: 4,
    gap:               5,
  },
  pinnedSectionHeader: {
    backgroundColor:   'rgba(88,166,255,0.04)',
    borderRadius:      8,
  },
  workingSectionHeader: {
    backgroundColor:   'rgba(88,166,255,0.08)',
    borderRadius:      8,
  },
  recentSectionHeader: {
    backgroundColor:   'rgba(88,166,255,0.05)',
    borderRadius:      8,
  },
  sectionToggle: {
    width:             44,
    height:            44,
    alignItems:        'center',
    justifyContent:    'center',
  },
  sectionCaret: {
    color:             '#768390',
    fontSize:          11,
    fontFamily:        Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign:         'center',
  },
  sectionPinIcon: {
    fontSize:          15,
  },
  sectionWorkingIcon: {
    width:             22,
    height:            22,
    borderRadius:      11,
    borderWidth:       1,
    borderColor:       'rgba(88,166,255,0.52)',
    color:             '#58a6ff',
    fontSize:          9,
    fontWeight:        '800',
    lineHeight:        20,
    textAlign:         'center',
  },
  sectionTitleButton: {
    flex:              1,
    minWidth:          0,
    justifyContent:    'center',
  },
  sectionTitle: {
    color:             '#768390',
    fontSize:          12,
    fontWeight:        '600',
    lineHeight:        15,
    textTransform:     'uppercase',
    letterSpacing:     0.5,
  },
  sectionWorking: {
    width:             7,
    height:            7,
    borderRadius:      4,
    backgroundColor:   '#58a6ff',
  },
  sectionWorkingSlot: {
    width:             7,
    height:            16,
    alignItems:        'center',
    justifyContent:    'center',
  },
  sectionAlertSlot: {
    width:             16,
    height:            16,
  },
  sectionAlert: {
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    backgroundColor:   '#d29922',
    color:             '#fff',
    textAlign:         'center',
    lineHeight:        16,
    fontSize:          10,
    fontWeight:        '700',
  },
  sectionUnread: {
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    paddingHorizontal: 4,
    alignItems:        'center',
    justifyContent:    'center',
    backgroundColor:   '#58a6ff',
  },
  sectionUnreadSlot: {
    width:             28,
    height:            16,
    alignItems:        'flex-end',
  },
  sectionUnreadText: {
    color:             '#fff',
    fontSize:          9,
    fontWeight:        '700',
  },
  sectionCount: {
    width:             30,
    height:            18,
    borderRadius:      9,
    paddingHorizontal: 5,
    alignItems:        'center',
    justifyContent:    'center',
    borderWidth:       1,
    borderColor:       '#30363d',
  },
  sectionCountText: {
    color:             '#768390',
    fontSize:          10,
  },
  emptyContainer: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        40,
  },
  empty: {
    alignItems: 'center',
  },
  emptyTitle: {
    color:        '#cdd9e5',
    fontSize:     18,
    fontWeight:   '600',
    marginBottom: 8,
  },
  emptyHint: {
    color:     '#768390',
    fontSize:  14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#30363d',
    padding:         12,
    height:          106,
    flexDirection:   'row',
    alignItems:      'center',
    marginBottom:    8,
  },
  pinnedCard: {
    backgroundColor: 'rgba(88,166,255,0.07)',
    borderColor:     'rgba(88,166,255,0.32)',
  },
  badgeWrap: {
    width:        36,
    height:       36,
    marginRight:  10,
  },
  agentBadge: {
    width:        36,
    height:       36,
    borderRadius: 10,
    borderWidth:  1,
    alignItems:   'center',
    justifyContent: 'center',
  },
  agentBadgeText: {
    fontSize:   12,
    fontWeight: '700',
  },
  healthDotOverlay: {
    position:     'absolute',
    bottom:       -2,
    right:        -2,
    width:        10,
    height:       10,
    borderRadius: 5,
    borderWidth:  2,
    borderColor:  '#161b22',
  },
  cardMain: {
    flex: 1,
    height: 80,
    justifyContent: 'center',
    minWidth: 0,
  },
  cardName: {
    color:      '#cdd9e5',
    fontSize:   16,
    fontWeight: '500',
    lineHeight: 19,
    minHeight: 38,
  },
  cardSubtitle: {
    color:     '#768390',
    fontSize:  12,
    marginTop: 2,
  },
  cardActivity: {
    color:     '#58a6ff',
    fontSize:  12,
    marginTop: 4,
  },
  reservedTextHidden: {
    opacity: 0,
  },
  cardPermLabel: {
    color:      '#d9a441',
    fontSize:   12,
    fontWeight: '600',
    marginTop:  2,
  },
  permBadge: {
    fontSize:   16,
    color:      '#d9a441',
  },
  cardSignalSlot: {
    width:          28,
    height:         22,
    marginLeft:     4,
    alignItems:     'center',
    justifyContent: 'center',
  },
  mutedBadgeOverlay: {
    position:        'absolute',
    top:             -4,
    right:           -4,
    width:           16,
    height:          16,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     '#444c56',
    backgroundColor: '#161b22',
    color:           '#9da7b3',
    fontSize:        8,
    fontWeight:      '800',
    lineHeight:      14,
    textAlign:       'center',
  },
  pinToggleOverlay: {
    position:        'absolute',
    top:             -7,
    left:            -7,
    width:           20,
    height:          20,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#444c56',
    backgroundColor: '#161b22',
    alignItems:      'center',
    justifyContent:  'center',
  },
  pinToggleText: {
    fontSize:        10,
    lineHeight:      13,
  },
  cardMenuBtn: {
    width:          44,
    height:         44,
    alignItems:     'center',
    justifyContent: 'center',
  },
  cardMenuText: {
    color:      '#9da7b3',
    fontSize:   24,
    lineHeight: 26,
  },
  unreadBadge: {
    backgroundColor: '#58a6ff',
    minWidth:        20,
    height:          20,
    borderRadius:    10,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 5,
  },
  unreadBadgeText: {
    color:      '#fff',
    fontSize:   11,
    fontWeight: '700',
  },
  automationsBtn: {
    marginLeft: 8,
    padding:    4,
  },
  closeSessionBtn: {
    minWidth: 44,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  closeSessionPending: { opacity: 0.55 },
  closeSessionText: { color: '#f85149', fontSize: 11, fontWeight: '700' },
  manageSessionBtn: {
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  manageSessionText: { color: '#58a6ff', fontSize: 11, fontWeight: '700' },
  mutedBadge: { color: '#768390', fontSize: 10, fontWeight: '600' },
  mutedBadgeSlot: { width: 34, alignItems: 'center' },
  automationsBtnText: {
    color:    '#cdd9e5',
    fontSize: 16,
  },
  chevron: {
    color:    '#444c56',
    fontSize: 22,
    marginLeft: 8,
  },
  titleDisclosureOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems:      'center',
    justifyContent:  'center',
    padding:         24,
  },
  titleDisclosureCard: {
    width:           '100%',
    maxWidth:        420,
    backgroundColor: '#161b22',
    borderColor:     '#444c56',
    borderWidth:     1,
    borderRadius:    12,
    padding:         18,
    gap:             8,
  },
  titleDisclosureKind: {
    color:         '#768390',
    fontSize:      11,
    fontWeight:    '700',
    textTransform: 'uppercase',
  },
  titleDisclosureText: {
    color:      '#f0f3f6',
    fontSize:   18,
    fontWeight: '600',
    lineHeight: 24,
  },
  titleDisclosureSubtitle: { color: '#9da7b3', fontSize: 13 },
  titleDisclosureHint: { color: '#768390', fontSize: 11, marginTop: 4 },
});
