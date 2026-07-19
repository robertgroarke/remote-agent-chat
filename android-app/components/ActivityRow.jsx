import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { fleetGoalElapsedSeconds } from '../lib/fleet-activity';

const INACTIVE_KINDS = new Set([
  '', 'idle', 'waiting_for_user', 'completed', 'done', 'failed', 'error', 'interrupted',
]);

// Shows the current agent activity (generating / tool use / rate limited).
// The relay supplies a stable started_at anchor so elapsed time survives label changes
// and reconnects instead of resetting on every status refresh.
export default function ActivityRow({ activity, agentType }) {
  const kind = String(
    activity?.kind
    || (activity?.generating ? 'generating' : '')
    || (activity?.tool_use ? 'running_command' : ''),
  ).toLowerCase();
  const active = !!activity && !INACTIVE_KINDS.has(kind);
  const startedAt = activity?.started_at
    || activity?.startedAt
    || activity?.updated_at
    || activity?.updatedAt
    || null;
  const [nowMs, setNowMs] = useState(Date.now());
  const [goalExpanded, setGoalExpanded] = useState(false);
  const hasCanonicalChannels = !!(activity?.thinking || activity?.current);
  const legacyText = String(activity?.thinkingContent || activity?.thinking_content || '').trim();
  const thinking = activity?.thinking || (!hasCanonicalChannels && kind === 'thinking'
    ? { text: legacyText, since: startedAt }
    : null);
  const current = activity?.current || (!hasCanonicalChannels && active && !thinking
    ? {
        kind: kind === 'running_command' ? 'tool' : 'answer',
        label: activity?.label || (kind === 'running_command' ? 'Running command' : 'Working'),
        partial: legacyText,
        since: startedAt,
      }
    : null);
  const goal = activity?.goal || null;
  const goalRun = activity?.goal_run || null;
  const step = activity?.step || null;
  const usage = activity?.usage || null;
  const taskList = activity?.task_list || null;
  const planBlock = taskList?.content_blocks?.find(block => block?.type === 'plan');
  const plan = planBlock ? { ...taskList, ...planBlock } : taskList;
  const planTasks = Array.isArray(plan?.tasks) ? plan.tasks : [];

  useEffect(() => {
    if (!(active || (goal && (!goalRun || goalRun.lease_active === true)) || step || planTasks.length)) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active, startedAt, goal?.updated_at, goal?.status, goal?.state, goalRun?.lease_active, step?.state, planTasks.length]);

  if (!activity) return null;

  if (activity.rate_limited_until && !usage) {
    return <RateLimitRow until={activity.rate_limited_until} />;
  }

  const interruptHint = activity.interrupt_hint || activity.interruptHint || '';
  const goalText = String(goal?.text || goal?.objective || '').trim();
  const goalElapsed = goal ? formatGoalElapsed(goal, nowMs, goalRun) : '';
  const thinkingElapsed = thinking ? formatElapsed(thinking.since || startedAt, nowMs) : '';
  const currentElapsed = current ? formatElapsed(current.since || startedAt, nowMs) : '';
  const nativeGlyph = nativeStatusGlyph(agentType);
  const nativeLabel = thinking?.label || activity?.label || 'Thinking';
  if (!goal && !thinking && !current && !step && !usage && planTasks.length === 0) return null;

  return (
    <View style={s.stack} testID="live-status-stack">
      {current ? (
        <View style={current.kind === 'tool' ? s.currentTool : s.currentNarration}>
          {current.kind === 'tool' ? (
            <View style={s.heading}>
              <Text style={s.toolIcon}>▶</Text>
              <Text style={s.currentLabel}>{current.label || 'Running tool'}</Text>
              <Text style={s.meta}>{[currentElapsed, interruptHint].filter(Boolean).join(' · ')}</Text>
            </View>
          ) : null}
          {current.partial ? (
            <Text style={current.kind === 'tool' ? s.currentOutput : s.narrationText} selectable numberOfLines={4}>{current.partial}</Text>
          ) : null}
        </View>
      ) : null}
      {thinking ? (
        <View style={s.thinkingPlain}>
          <View style={s.heading}>
            <Text style={s.thinkingIcon}>{nativeGlyph}</Text>
            <Text style={s.thinkingLabel}>{nativeLabel}</Text>
            {thinkingElapsed ? <Text style={s.meta}>{thinkingElapsed}</Text> : null}
          </View>
          {thinking.text ? <Text style={s.thinkingText} selectable numberOfLines={4}>{thinking.text}</Text> : null}
        </View>
      ) : null}
      {planTasks.length > 0 ? (
        <View style={[s.channel, s.planChannel]} accessibilityRole="summary">
          <View style={s.heading}>
            <Text style={s.planIcon}>{'\u2637'}</Text>
            <Text style={s.planLabel}>{plan?.label || plan?.title || 'Plan'}</Text>
            <Text style={s.meta}>{Number(plan?.completed) || 0}/{Number(plan?.total) || planTasks.length}</Text>
          </View>
          <View style={s.planItems}>
            {planTasks.map((task, index) => {
              const state = String(task?.state || task?.status || 'pending').toLowerCase();
              return (
                <View key={task?.id || index} style={s.planItem}>
                  <Text style={[s.planMarker, state === 'completed' && s.planMarkerComplete]}>
                    {state === 'completed' ? '\u2713' : state === 'in_progress' ? '\u2022' : '\u25CB'}
                  </Text>
                  <Text style={[s.planText, state === 'completed' && s.planTextComplete]} selectable>
                    {task?.text || task?.step || task?.title || ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      {step ? (
        <View style={s.stepWrap}>
          <View style={s.stepChip}>
            <Text style={s.stepText}>{step.state === 'in_progress' ? '◉' : '◌'} Step {step.current || 1} / {step.total || 1}</Text>
            {(step.added != null || step.deleted != null) ? <Text style={s.stepDiff}>· +{step.added || 0} −{step.deleted || 0}</Text> : null}
          </View>
        </View>
      ) : null}
      {goal ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: goalExpanded }}
          onPress={() => setGoalExpanded(value => !value)}
          style={[s.channel, s.goalChannel]}
        >
          <View style={s.heading}>
            <Text style={s.goalIcon}>⛳</Text>
            <Text style={s.goalLabel}>{goal.label || 'Pursuing goal'}</Text>
            <Text style={s.goalText} numberOfLines={1}>{goalText || 'Active goal'}</Text>
            <Text style={s.meta}>{goalElapsed || goal.state || goal.status || 'active'}</Text>
          </View>
          {goalExpanded && goalText ? <Text style={s.goalExpanded} selectable>{goalText}</Text> : null}
        </Pressable>
      ) : null}
      {usage ? (
        <View style={[s.channel, s.usageChannel]} accessibilityRole="alert">
          <Text style={s.usageTitle}>{usage.title || 'Usage limit reached'}</Text>
          <Text style={s.usageDetail}>{usage.detail || (usage.resets_at ? `Your rate limit resets at ${usage.resets_at}.` : 'Usage is currently exhausted.')}</Text>
        </View>
      ) : null}
    </View>
  );
}

function nativeStatusGlyph(agentType) {
  const type = String(agentType || '').toLowerCase();
  if (type === 'claude' || type === 'claude_cli') return '✻';
  if (type === 'codex' || type === 'codex-desktop' || type === 'codex_cli') return '◌';
  if (type === 'cursor') return '•••';
  return '●';
}

function formatElapsed(startedAt, nowMs) {
  const startedMs = startedAt ? new Date(startedAt).getTime() : 0;
  if (!Number.isFinite(startedMs) || startedMs <= 0) return '';
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${String(hours % 24).padStart(2, '0')}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatGoalElapsed(goal, nowMs, goalRun = null) {
  return formatDuration(fleetGoalElapsedSeconds(goal, goalRun, nowMs), true);
}

function formatDuration(totalSeconds, includeSeconds = false) {
  totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${includeSeconds ? ` ${String(seconds).padStart(2, '0')}s` : ''}`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h ${String(minutes % 60).padStart(2, '0')}m${includeSeconds ? ` ${String(seconds).padStart(2, '0')}s` : ''}`;
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m${includeSeconds ? ` ${String(seconds).padStart(2, '0')}s` : ''}`;
}

// Live countdown for rate limit — updates every second.
function RateLimitRow({ until }) {
  const [remaining, setRemaining] = useState(() => formatRemaining(until));

  useEffect(() => {
    setRemaining(formatRemaining(until));
    const id = setInterval(() => {
      const next = formatRemaining(until);
      setRemaining(next);
      if (next.ms <= 0) clearInterval(id);
    }, 1_000);
    return () => clearInterval(id);
  }, [until]);

  const color = '#f0883e';
  return (
    <View style={[s.row, { borderLeftColor: color }]}>
      <Text style={[s.dot, { color }]}>●</Text>
      <Text style={[s.label, { color }]}>{remaining.text}</Text>
    </View>
  );
}

function formatRemaining(until) {
  const ms = new Date(until) - Date.now();
  if (ms <= 0) return { ms: 0, text: 'Rate limit clearing…' };
  const totalSecs = Math.ceil(ms / 1_000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const text = mins > 0
    ? `Rate limited — clears in ${mins}m ${secs}s`
    : `Rate limited — clears in ${secs}s`;
  return { ms, text };
}

const s = StyleSheet.create({
  stack: {
    marginHorizontal: 12,
    marginBottom: 6,
    gap: 5,
  },
  currentNarration: {
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  narrationText: {
    color: '#f0f3f6',
    fontSize: 13,
    lineHeight: 20,
  },
  currentTool: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  thinkingPlain: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  stepWrap: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 999,
    backgroundColor: '#161b22',
  },
  stepText: { color: '#9da7b3', fontFamily: 'monospace', fontSize: 10 },
  stepDiff: { color: '#7d8590', fontFamily: 'monospace', fontSize: 10 },
  channel: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#30363d',
    borderLeftWidth: 3,
    borderRadius: 7,
    backgroundColor: '#121820',
  },
  goalChannel: {
    borderLeftColor: '#b15cff',
    backgroundColor: '#191320',
  },
  usageChannel: {
    borderLeftColor: '#d29922',
    backgroundColor: '#211b10',
  },
  planChannel: {
    borderLeftColor: '#58a6ff',
    backgroundColor: '#111a24',
  },
  planIcon: { color: '#79c0ff', fontSize: 12 },
  planLabel: { color: '#c9e3ff', fontSize: 12, fontWeight: '700' },
  planItems: { marginTop: 6, gap: 4 },
  planItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  planMarker: { color: '#79c0ff', width: 12, fontSize: 12 },
  planMarkerComplete: { color: '#3fb950' },
  planText: { color: '#d7dde5', flex: 1, fontSize: 12, lineHeight: 17 },
  planTextComplete: { color: '#8b949e', textDecorationLine: 'line-through' },
  usageTitle: { color: '#f0f3f6', fontSize: 13, fontWeight: '700' },
  usageDetail: { color: '#9da7b3', fontSize: 12, lineHeight: 17, marginTop: 3 },
  thinkingChannel: {
    borderLeftColor: '#58a6ff',
    backgroundColor: '#111a24',
  },
  toolChannel: {
    borderLeftColor: '#3fb950',
    backgroundColor: '#111c17',
  },
  answerChannel: {
    borderLeftColor: '#58a6ff',
    backgroundColor: '#111a24',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 6,
  },
  goalIcon: { color: '#c98aff', fontSize: 12 },
  goalLabel: { color: '#e1c4ff', fontSize: 12, fontWeight: '700' },
  goalText: { color: '#d9b8ff', fontSize: 12, flex: 1, minWidth: 0 },
  goalExpanded: { color: '#d9b8ff', fontSize: 12, lineHeight: 17, marginTop: 6, marginLeft: 18 },
  thinkingIcon: { color: '#58a6ff', fontSize: 8 },
  thinkingLabel: { color: '#c9e3ff', fontSize: 12, fontWeight: '700' },
  thinkingText: { color: '#9da7b3', fontSize: 12, fontStyle: 'italic', lineHeight: 17, marginTop: 5, marginLeft: 18 },
  toolIcon: { color: '#3fb950', fontSize: 11 },
  answerIcon: { color: '#58a6ff', fontSize: 12 },
  currentLabel: { color: '#f0f3f6', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  currentOutput: {
    marginTop: 5,
    marginLeft: 18,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 5,
    backgroundColor: '#0d1117',
    color: '#d7dde5',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  meta: { color: '#8b949e', fontFamily: 'monospace', fontSize: 10, marginLeft: 'auto' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderLeftWidth: 2,
    marginHorizontal: 12,
    marginBottom: 4,
    gap: 6,
  },
  dot: {
    fontSize: 8,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  liveText: {
    marginTop: 3,
    color: '#9da7b3',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
});
