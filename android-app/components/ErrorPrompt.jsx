import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';

export default function ErrorPrompt({ prompt, blocking, onAction }) {
  if (!prompt) return null;

  const actions = Array.isArray(prompt.actions) ? prompt.actions : [];
  const submittingActionId = prompt.submitting_action_id || null;
  const errorOutput = String(prompt.error_output || '').trim();

  return (
    <View
      style={[s.container, blocking && s.blocking]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={s.eyebrow}>{blocking ? 'ACTION REQUIRED' : 'ATTENTION'}</Text>
      <Text style={s.title}>{prompt.title || 'Error handling model response'}</Text>
      <Text style={s.message}>{prompt.message || 'There was an error handling the model response.'}</Text>

      {!!errorOutput && (
        <ScrollView style={s.outputScroll} nestedScrollEnabled>
          <Text style={s.outputLabel}>ERROR OUTPUT</Text>
          <Text style={s.output} selectable>{errorOutput}</Text>
        </ScrollView>
      )}

      {!!prompt.error && <Text style={s.error}>{prompt.error}</Text>}

      <View style={s.actions}>
        {actions.map((action, index) => {
          const actionId = String(action?.action_id || action?.id || `action-${index}`);
          const pending = submittingActionId === actionId;
          return (
            <TouchableOpacity
              key={actionId}
              style={[s.action, action?.style === 'danger' && s.actionDanger, pending && s.actionPending]}
              activeOpacity={0.75}
              disabled={!!submittingActionId}
              onPress={() => onAction(prompt.prompt_id, actionId)}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!submittingActionId, busy: pending }}
            >
              <Text style={[s.actionText, action?.style === 'danger' && s.actionDangerText]}>
                {action?.label || 'Action'}{pending ? ' · Sending…' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#251c1d',
    borderTopWidth: 1,
    borderTopColor: '#f85149',
    padding: 14,
  },
  blocking: {
    borderLeftWidth: 4,
    borderLeftColor: '#f85149',
  },
  eyebrow: {
    color: '#f85149',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  title: {
    color: '#f0f6fc',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5,
  },
  message: {
    color: '#cdd9e5',
    fontSize: 13,
    lineHeight: 18,
  },
  outputScroll: {
    maxHeight: 110,
    marginTop: 10,
    padding: 10,
    borderRadius: 7,
    backgroundColor: '#0d1117',
  },
  outputLabel: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 5,
  },
  output: {
    color: '#f0a29d',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: '#ff7b72',
    fontSize: 12,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  action: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f0883e',
    backgroundColor: '#3a2a1d',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionDanger: {
    borderColor: '#f85149',
    backgroundColor: '#4b1f22',
  },
  actionPending: {
    opacity: 0.65,
  },
  actionText: {
    color: '#f2cc60',
    fontSize: 13,
    fontWeight: '700',
  },
  actionDangerText: {
    color: '#ff7b72',
  },
});
