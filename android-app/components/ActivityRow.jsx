import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Shows the current agent activity (generating / tool use / rate limited).
// Props:
//   activity — activity event object or null
export default function ActivityRow({ activity }) {
  if (!activity) return null;

  if (activity.rate_limited_until) {
    return <RateLimitRow until={activity.rate_limited_until} />;
  }

  let label = null;
  let color = '#58a6ff';

  if (activity.generating) {
    // Use granular label if available (e.g. "Reading files", "Writing code")
    label = activity.label && activity.label !== 'Generating' && activity.label !== 'Thinking'
      ? activity.label
      : 'Generating…';
    color = '#58a6ff';
  } else if (activity.tool_use) {
    label = activity.tool_name ? `Running: ${activity.tool_name}` : 'Tool use…';
    color = '#3fb950';
  } else if (activity.label) {
    // Granular activity from enhanced thinking detection (Epic 8)
    label = activity.label;
    color = '#58a6ff';
  }

  if (!label) return null;

  return (
    <View style={[s.row, { borderLeftColor: color }]}>
      <Text style={[s.dot, { color }]}>●</Text>
      <Text style={[s.label, { color }]}>{label}</Text>
    </View>
  );
}

// Live countdown for rate limit — updates every second
function RateLimitRow({ until }) {
  const [remaining, setRemaining] = useState(() => formatRemaining(until));

  useEffect(() => {
    setRemaining(formatRemaining(until));
    const id = setInterval(() => {
      const r = formatRemaining(until);
      setRemaining(r);
      if (r.ms <= 0) clearInterval(id);
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
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderLeftWidth: 2,
    marginHorizontal: 12,
    marginBottom:    4,
    gap:             6,
  },
  dot: {
    fontSize: 8,
  },
  label: {
    fontSize: 13,
    fontStyle: 'italic',
  },
});
