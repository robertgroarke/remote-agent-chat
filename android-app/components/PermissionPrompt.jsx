import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, useColorScheme,
} from 'react-native';
import PROMPT_THEMES from './permission-prompt-theme.json';

const idFor = (choice, index) => choice.choice_id || choice.id || choice.value || `choice-${index}`;

export default function PermissionPrompt({ prompt, agentType, onChoice, colorScheme = null }) {
  const systemColorScheme = useColorScheme();
  const [now, setNow] = useState(Date.now());
  const [selections, setSelections] = useState({});
  const [otherText, setOtherText] = useState({});
  const [textAnswers, setTextAnswers] = useState({});
  const [alternateInstruction, setAlternateInstruction] = useState('');
  useEffect(() => {
    setSelections({});
    setOtherText({});
    setTextAnswers({});
    setAlternateInstruction('');
  }, [prompt?.prompt_id]);
  useEffect(() => {
    if (!prompt?.deadline_at) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [prompt?.deadline_at]);
  if (!prompt) return null;

  const block = (Array.isArray(prompt.content_blocks) ? prompt.content_blocks : [])
    .find(item => item?.type === 'prompt');
  const submittingChoiceId = prompt.submitting_choice_id || null;
  const firstClassQuestion = prompt.type === 'question_prompt';
  const firstClassQuestionLocked = firstClassQuestion && prompt.lifecycle !== 'open';
  const deadlineAt = Date.parse(prompt.deadline_at || '');
  const deadlineMsLeft = Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - now) : null;
  const questions = (firstClassQuestion || prompt.kind === 'question') && Array.isArray(prompt.questions)
    ? prompt.questions.filter(question => question && typeof question === 'object')
    : [];
  const structured = questions.length > 0;
  const structuredTheme = structured
    ? PROMPT_THEMES[colorScheme === 'light' || (!colorScheme && systemColorScheme === 'light') ? 'light' : 'dark']
    : null;
  const claudeAction = agentType === 'claude' && !structured;
  const alternateInstructionSupported = claudeAction && prompt.alternate_instruction_supported === true;
  const selectedFor = question => selections[question.question_id] || [];
  const ready = questions.every(question => {
    const choices = Array.isArray(question.choices) ? question.choices : [];
    const textMode = question.answer_mode === 'text' || choices.length === 0;
    if (textMode) return question.required === false || String(textAnswers[question.question_id] || '').trim().length > 0;
    const selected = selectedFor(question);
    if (selected.length === 0) return false;
    return selected.every(id => {
      const choice = choices.find((item, index) => idFor(item, index) === id);
      return !choice?.requires_text || String(otherText[`${question.question_id}:${id}`] || '').trim();
    });
  });

  const toggle = (question, id) => setSelections(prev => {
    const current = prev[question.question_id] || [];
    const next = question.multi_select
      ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id])
      : [id];
    return { ...prev, [question.question_id]: next };
  });

  const submit = () => {
    if (!ready || submittingChoiceId || firstClassQuestionLocked) return;
    const answers = questions.map(question => {
      const choices = Array.isArray(question.choices) ? question.choices : [];
      if (question.answer_mode === 'text' || choices.length === 0) {
        return {
          question_id: question.question_id,
          text: String(textAnswers[question.question_id] || '').trim(),
        };
      }
      const choiceIds = selectedFor(question);
      const other = choices.find((choice, index) => choice.requires_text && choiceIds.includes(idFor(choice, index)));
      const otherId = other ? idFor(other, choices.indexOf(other)) : null;
      return {
        question_id: question.question_id,
        choice_ids: choiceIds,
        ...(otherId ? { other_text: String(otherText[`${question.question_id}:${otherId}`] || '').trim() } : {}),
      };
    });
    onChoice(prompt.prompt_id, null, { answers });
  };

  return (
    <View style={[
      s.container,
      structuredTheme && { backgroundColor: structuredTheme.container, borderTopColor: structuredTheme.border },
      claudeAction && s.claudeContainer,
    ]}>
      {claudeAction ? (
        <Text style={s.claudeTitle} numberOfLines={2}>
          {prompt.title || (!prompt.command ? (block?.content || prompt.prompt_text || prompt.message || 'Allow this action?') : 'Allow this action?')}
        </Text>
      ) : (
        <View style={s.header}>
          <Text style={s.icon}>{structured ? '?' : '🔐'}</Text>
          <Text style={[s.title, structuredTheme && { color: structuredTheme.text }]} numberOfLines={2}>{block?.label || prompt.title || (structured ? 'Question' : 'Permission Required')}</Text>
        </View>
      )}

      {claudeAction && !!prompt.command && <Text style={s.claudeCommand}>{prompt.command}</Text>}
      {!!(claudeAction ? prompt.description : (block?.content || prompt.description || prompt.prompt_text || prompt.message || (structured ? 'Answer all questions to resume the native turn.' : ''))) && (
        <ScrollView style={s.descScroll} nestedScrollEnabled>
          <Text style={[s.desc, structuredTheme && { color: structuredTheme.muted }, claudeAction && s.claudeDesc]}>
            {claudeAction ? prompt.description : (block?.content || prompt.description || prompt.prompt_text || prompt.message || (structured ? 'Answer all questions to resume the native turn.' : ''))}
          </Text>
        </ScrollView>
      )}
      {!!prompt.error && <Text style={s.error}>{prompt.error}</Text>}

      <View style={[s.choices, structured && s.questionList, claudeAction && s.claudeChoices]}>
        {structured ? questions.map((question, questionIndex) => (
          <View style={[s.question, { borderColor: structuredTheme.questionBorder }]} key={question.question_id || questionIndex}>
            <Text style={[s.questionTitle, { color: structuredTheme.text }]}>{question.header || question.label || `Question ${questionIndex + 1}`}</Text>
            {!!question.message && <Text style={[s.questionMessage, { color: structuredTheme.muted }]}>{question.message}</Text>}
            {(question.answer_mode === 'text' || !Array.isArray(question.choices) || question.choices.length === 0) ? (
              <TextInput
                style={[
                  s.questionTextInput,
                  {
                    color: structuredTheme.text,
                    backgroundColor: structuredTheme.inputBackground,
                    borderColor: structuredTheme.inputBorder,
                  },
                ]}
                value={textAnswers[question.question_id] || ''}
                maxLength={2000}
                editable={!submittingChoiceId && !firstClassQuestionLocked}
                secureTextEntry={question.secret === true}
                autoCorrect={question.secret !== true}
                autoCapitalize={question.secret === true ? 'none' : 'sentences'}
                placeholder={question.secret === true ? 'Enter private answer' : 'Enter answer'}
                placeholderTextColor={structuredTheme.muted}
                accessibilityLabel={`${question.header || question.label || `Question ${questionIndex + 1}`} answer`}
                onChangeText={value => setTextAnswers(prev => ({ ...prev, [question.question_id]: value }))}
              />
            ) : question.choices.map((choice, index) => {
              const id = idFor(choice, index);
              const selected = selectedFor(question).includes(id);
              const otherKey = `${question.question_id}:${id}`;
              return (
                <View key={id} style={s.questionOption}>
                  <TouchableOpacity
                    style={[
                      s.choiceBtn,
                      s.questionChoice,
                      { backgroundColor: structuredTheme.optionBackground, borderColor: structuredTheme.optionBorder },
                      selected && s.choiceSelected,
                      selected && { backgroundColor: structuredTheme.selectedBackground, borderColor: structuredTheme.selectedBorder },
                    ]}
                    activeOpacity={0.75}
                    disabled={!!submittingChoiceId || firstClassQuestionLocked}
                    onPress={() => toggle(question, id)}
                    accessibilityRole={question.multi_select ? 'checkbox' : 'radio'}
                    accessibilityState={{ disabled: !!submittingChoiceId || firstClassQuestionLocked, checked: selected }}
                  >
                    <Text style={[s.choiceMarker, { color: structuredTheme.accent }]}>{question.multi_select ? (selected ? '✓' : '□') : (selected ? '●' : '○')}</Text>
                    <View style={s.choiceCopy}>
                      <Text style={[s.choiceText, { color: structuredTheme.text }]}>{choice.label || choice.title || choice.text || id}</Text>
                      {!!choice.description && <Text style={[s.choiceDesc, { color: structuredTheme.muted }]}>{choice.description}</Text>}
                    </View>
                  </TouchableOpacity>
                  {selected && choice.requires_text && (
                    <TextInput
                      style={[
                        s.otherInput,
                        {
                          color: structuredTheme.text,
                          backgroundColor: structuredTheme.inputBackground,
                          borderColor: structuredTheme.inputBorder,
                        },
                      ]}
                      value={otherText[otherKey] || ''}
                      maxLength={2000}
                      editable={!submittingChoiceId && !firstClassQuestionLocked}
                      secureTextEntry={question.secret === true}
                      autoCorrect={question.secret !== true}
                      autoCapitalize={question.secret === true ? 'none' : 'sentences'}
                      placeholder="Enter another answer"
                      placeholderTextColor={structuredTheme.muted}
                      accessibilityLabel={`${choice.label || 'Other'} answer`}
                      onChangeText={value => setOtherText(prev => ({ ...prev, [otherKey]: value }))}
                    />
                  )}
                </View>
              );
            })}
          </View>
        )) : (prompt.choices || []).map((choice, index) => {
          const id = idFor(choice, index);
          const pending = submittingChoiceId === id;
          const selected = claudeAction && index === 0;
          const label = String(choice.label || choice.title || choice.text || id)
            .replace(claudeAction ? new RegExp(`^${index + 1}\\s+`) : /$^/, '');
          const destination = claudeAction ? String(choice.destination || '').trim() : '';
          const labelPrefix = destination && label.endsWith(destination)
            ? label.slice(0, -destination.length) : label;
          return (
            <TouchableOpacity
              key={id}
              style={[s.choiceBtn, choiceStyle(choice.style), claudeAction && s.claudeChoice, selected && s.claudeChoiceSelected, pending && s.choicePending]}
              activeOpacity={0.75}
              disabled={!!submittingChoiceId}
              onPress={() => onChoice(prompt.prompt_id, id)}
              accessibilityState={{ disabled: !!submittingChoiceId, busy: pending, selected }}
            >
              {claudeAction && <Text style={[s.choiceShortcut, selected && s.claudeChoiceSelectedText]}>{choice.shortcut || index + 1}</Text>}
              <Text style={[s.choiceText, choiceTextStyle(choice.style), selected && s.claudeChoiceSelectedText]}>
                {labelPrefix}
                {!!destination && <Text style={s.choiceDestination}>{destination}</Text>}
                {pending ? ' · Sending…' : ''}
              </Text>
              {!!choice.description && <Text style={s.choiceDesc}>{choice.description}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {alternateInstructionSupported && (
        <TextInput
          style={s.alternateInput}
          value={alternateInstruction}
          maxLength={2000}
          editable={!submittingChoiceId}
          placeholder={prompt.alternate_instruction_placeholder || 'Tell Claude what to do instead'}
          placeholderTextColor="#949494"
          accessibilityLabel="Tell Claude what to do instead"
          returnKeyType="send"
          blurOnSubmit={false}
          onChangeText={setAlternateInstruction}
          onSubmitEditing={() => {
            const instruction = alternateInstruction.trim();
            if (instruction && !submittingChoiceId) onChoice(prompt.prompt_id, null, { instruction });
          }}
        />
      )}

      {claudeAction && <Text style={s.claudeHint}>{prompt.cancel_hint || 'Esc to cancel'}</Text>}

      {structured && (
        <TouchableOpacity
          style={[
            s.submitBtn,
            { backgroundColor: structuredTheme.submitBackground },
            (!ready || submittingChoiceId || firstClassQuestionLocked) && s.submitDisabled,
          ]}
          disabled={!ready || !!submittingChoiceId || firstClassQuestionLocked}
          onPress={submit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || !!submittingChoiceId || firstClassQuestionLocked, busy: !!submittingChoiceId }}
        >
          <Text style={[s.submitText, { color: structuredTheme.submitText }]}>{submittingChoiceId ? 'Sending…' : (prompt.submit_label || 'Submit answers')}</Text>
        </TouchableOpacity>
      )}
      {structured && deadlineMsLeft !== null && (
        <Text style={[s.deadline, { color: structuredTheme.muted }]}>
          {deadlineMsLeft > 0
            ? `${prompt.auto_resolution_policy === 'native' ? 'Native auto-resolution in' : 'Response deadline in'} ${formatCountdown(deadlineMsLeft)}`
            : 'Native deadline elapsed · awaiting receipt'}
        </Text>
      )}
      {structured && firstClassQuestion && prompt.cancel_supported === true && (
        <TouchableOpacity
          style={[s.cancelBtn, (submittingChoiceId || firstClassQuestionLocked) && s.submitDisabled]}
          disabled={!!submittingChoiceId || firstClassQuestionLocked}
          onPress={() => onChoice(prompt.prompt_id, null, { action: 'cancel' })}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!submittingChoiceId || firstClassQuestionLocked }}
        >
          <Text style={[s.cancelText, { color: structuredTheme.muted }]}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function choiceStyle(style) {
  switch (style) {
    case 'primary': return s.choicePrimary;
    case 'danger': return s.choiceDanger;
    default: return s.choiceDefault;
  }
}

function formatCountdown(msLeft) {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function choiceTextStyle(style) {
  switch (style) {
    case 'primary': return s.choiceTextPrimary;
    case 'danger': return s.choiceTextDanger;
    default: return s.choiceTextDefault;
  }
}

const s = StyleSheet.create({
  container: { backgroundColor: '#1c2128', borderTopWidth: 1, borderTopColor: '#f0883e', padding: 16 },
  claudeContainer: { marginHorizontal: 8, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: '#484848', borderRadius: 8, backgroundColor: '#30302f' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  icon: { fontSize: 18 },
  title: { flex: 1, color: '#cdd9e5', fontSize: 15, fontWeight: '600' },
  descScroll: { maxHeight: 80, marginBottom: 12 },
  desc: { color: '#768390', fontSize: 13 },
  claudeTitle: { color: '#f2f2f2', fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 8 },
  claudeCommand: { color: '#d6b7ff', fontSize: 12, lineHeight: 18, fontFamily: 'monospace', marginBottom: 7 },
  claudeDesc: { color: '#b5b5b5', fontSize: 12, lineHeight: 17 },
  error: { color: '#ff7b72', fontSize: 12, marginBottom: 10 },
  deadline: { fontSize: 11, marginBottom: 10 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  claudeChoices: { flexDirection: 'column', flexWrap: 'nowrap', gap: 6 },
  questionList: { flexDirection: 'column', flexWrap: 'nowrap' },
  question: { borderWidth: 1, borderColor: '#30363d', borderRadius: 8, padding: 10, gap: 7 },
  questionTitle: { color: '#cdd9e5', fontSize: 14, fontWeight: '600' },
  questionMessage: { color: '#768390', fontSize: 12 },
  questionOption: { width: '100%' },
  questionChoice: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  choiceSelected: { borderColor: '#58a6ff', backgroundColor: '#1b365d' },
  choiceMarker: { width: 16, color: '#58a6ff', fontSize: 14 },
  choiceCopy: { flex: 1, gap: 2 },
  choiceBtn: { minHeight: 44, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1 },
  claudeChoice: { width: '100%', minHeight: 34, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 3, borderColor: '#4a4a49', backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 7 },
  claudeChoiceSelected: { borderColor: '#1788e6', backgroundColor: '#0e7dcc' },
  claudeChoiceSelectedText: { color: '#ffffff' },
  choiceShortcut: { width: 12, color: '#b7b7b7', fontSize: 11, fontFamily: 'monospace' },
  choiceDestination: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  choicePending: { opacity: 0.65 },
  choicePrimary: { backgroundColor: '#1f4d8a', borderColor: '#58a6ff' },
  choiceDanger: { backgroundColor: '#3d1a1a', borderColor: '#f85149' },
  choiceDefault: { backgroundColor: '#21262d', borderColor: '#30363d' },
  choiceText: { color: '#cdd9e5', fontSize: 14, fontWeight: '500' },
  choiceDesc: { color: '#768390', fontSize: 11, lineHeight: 15 },
  otherInput: { minHeight: 44, marginTop: 6, color: '#cdd9e5', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 },
  questionTextInput: { minHeight: 44, color: '#cdd9e5', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 },
  alternateInput: { width: '100%', minHeight: 34, maxHeight: 84, marginTop: 8, color: '#ededed', backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4a4a49', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 7, fontSize: 12 },
  claudeHint: { marginTop: 6, color: '#aaaaaa', fontSize: 10 },
  submitBtn: { minHeight: 44, marginTop: 12, backgroundColor: '#1f6feb', borderRadius: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelBtn: { minHeight: 44, marginTop: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600' },
  choiceTextPrimary: { color: '#58a6ff' },
  choiceTextDanger: { color: '#f85149' },
  choiceTextDefault: { color: '#cdd9e5' },
});
