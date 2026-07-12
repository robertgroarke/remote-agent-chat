import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';

// Renders a single permission prompt with its choices.
// Props:
//   prompt  — { prompt_id, title, description, choices: [{ id, label, style }] }
//   onChoice — (promptId, choiceId) => void
export default function PermissionPrompt({ prompt, onChoice }) {
  if (!prompt) return null;
  const submittingChoiceId = prompt.submitting_choice_id || null;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.icon}>🔐</Text>
        <Text style={s.title} numberOfLines={2}>{prompt.title || 'Permission Required'}</Text>
      </View>

      {!!(prompt.description || prompt.prompt_text || prompt.message) && (
        <ScrollView style={s.descScroll} nestedScrollEnabled>
          <Text style={s.desc}>{prompt.description || prompt.prompt_text || prompt.message}</Text>
        </ScrollView>
      )}

      {!!prompt.error && <Text style={s.error}>{prompt.error}</Text>}

      <View style={s.choices}>
        {(prompt.choices || []).map((choice, index) => {
          const choiceId = choice.choice_id || choice.id || choice.value || `choice-${index}`;
          const pending = submittingChoiceId === choiceId;
          return (
            <TouchableOpacity
              key={choiceId}
              style={[s.choiceBtn, choiceStyle(choice.style), pending && s.choicePending]}
              activeOpacity={0.75}
              disabled={!!submittingChoiceId}
              onPress={() => onChoice(prompt.prompt_id, choiceId)}
              accessibilityState={{ disabled: !!submittingChoiceId, busy: pending }}
            >
              <Text style={[s.choiceText, choiceTextStyle(choice.style)]}>
                {choice.label || choice.title || choice.text || choiceId}{pending ? ' · Sending…' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function choiceStyle(style) {
  switch (style) {
    case 'primary':   return s.choicePrimary;
    case 'danger':    return s.choiceDanger;
    default:          return s.choiceDefault;
  }
}

function choiceTextStyle(style) {
  switch (style) {
    case 'primary':   return s.choiceTextPrimary;
    case 'danger':    return s.choiceTextDanger;
    default:          return s.choiceTextDefault;
  }
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#1c2128',
    borderTopWidth:  1,
    borderTopColor:  '#f0883e',
    padding:         16,
  },
  header: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  8,
    gap:           8,
  },
  icon: {
    fontSize: 18,
  },
  title: {
    flex:       1,
    color:      '#cdd9e5',
    fontSize:   15,
    fontWeight: '600',
  },
  descScroll: {
    maxHeight:    80,
    marginBottom: 12,
  },
  desc: {
    color:    '#768390',
    fontSize: 13,
  },
  error: {
    color: '#ff7b72',
    fontSize: 12,
    marginBottom: 10,
  },
  choices: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  choiceBtn: {
    borderRadius:    8,
    paddingVertical:   10,
    paddingHorizontal: 16,
    borderWidth:     1,
  },
  choicePending: {
    opacity: 0.65,
  },
  choicePrimary: {
    backgroundColor: '#1f4d8a',
    borderColor:     '#58a6ff',
  },
  choiceDanger: {
    backgroundColor: '#3d1a1a',
    borderColor:     '#f85149',
  },
  choiceDefault: {
    backgroundColor: '#21262d',
    borderColor:     '#30363d',
  },
  choiceText: {
    fontSize:   14,
    fontWeight: '500',
  },
  choiceTextPrimary: { color: '#58a6ff' },
  choiceTextDanger:  { color: '#f85149' },
  choiceTextDefault: { color: '#cdd9e5' },
});
