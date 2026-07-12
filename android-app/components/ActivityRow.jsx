import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const INACTIVE_KINDS = new Set([
  '', 'idle', 'waiting_for_user', 'completed', 'done', 'failed', 'error', 'interrupted',
]);

// Shows the current agent activity (generating / tool use / rate limited).
// The relay supplies a stable started_at anchor so elapsed time survives label changes
// and reconnects instead of resetting on every status refresh.
export default function ActivityRow({ activity }) {
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

  useEffect(() => {
    if (!active || !startedAt) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  if (!activity) return null;

  if (activity.rate_limited_until) {
    return <RateLimitRow until={activity.rate_limited_until} />;
  }

  let label = null;
  let color = '#58a6ff';

  if (activity.generating || kind === 'generating' || kind === 'thinking' || kind === 'working') {
    label = activity.label || (kind === 'thinking' ? 'Thinking' : 'Working');
  } else if (activity.tool_use || kind === 'running_command') {
    label = activity.label || (activity.tool_name ? `Running: ${activity.tool_name}` : 'Running command');
    color = '#3fb950';
  } else if (activity.label) {
    label = activity.label;
  } else if (kind) {
    label = kind.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
  }

  if (!label) return null;

  const elapsed = active ? formatElapsed(startedAt, nowMs) : '';
  const interruptHint = activity.interrupt_hint || activity.interruptHint || '';
  const detail = [elapsed, interruptHint].filter(Boolean).join(' • ');
  const liveText = String(activity.thinkingContent || activity.thinking_content || '').trim();

  return (
    <View style={[s.row, { borderLeftColor: color }]}>
      <Text style={[s.dot, { color }]}>●</Text>
      <View style={s.copy}>
        <Text style={[s.label, { color }]}>{detail ? `${label} (${detail})` : label}</Text>
        {active && liveText ? (
          <Text style={s.liveText} selectable numberOfLines={3}>{liveText}</Text>
        ) : null}
      </View>
    </View>
  );
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
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
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
