'use strict';

const MAX_QUESTIONS = 20;
const MAX_OTHER_TEXT = 2000;

function invalid(reason) {
  return { ok: false, reason, answers: null };
}

function normalizeQuestionAnswers(prompt, submittedAnswers) {
  const questions = Array.isArray(prompt?.questions) ? prompt.questions : [];
  if (questions.length === 0 || questions.length > MAX_QUESTIONS) {
    return invalid('prompt_questions');
  }
  if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== questions.length) {
    return invalid('answer_count');
  }

  const submittedByQuestion = new Map();
  for (const answer of submittedAnswers) {
    const questionId = String(answer?.question_id || '');
    if (!questionId || submittedByQuestion.has(questionId)) {
      return invalid('duplicate_or_missing_question');
    }
    submittedByQuestion.set(questionId, answer);
  }

  const normalized = [];
  for (const question of questions) {
    const questionId = String(question?.question_id || '');
    const answer = submittedByQuestion.get(questionId);
    if (!questionId || !answer) return invalid('unknown_or_unanswered_question');

    const choices = Array.isArray(question.choices) ? question.choices : [];
    const choiceById = new Map(choices.map(choice => [String(choice?.choice_id || ''), choice]));
    const choiceIds = Array.isArray(answer.choice_ids) ? answer.choice_ids.map(String) : [];
    const uniqueChoiceIds = new Set(choiceIds);
    const maxChoices = question.multi_select ? Math.min(20, choices.length) : 1;
    if (choiceIds.length === 0 || choiceIds.length > maxChoices || uniqueChoiceIds.size !== choiceIds.length) {
      return invalid('choice_count');
    }
    if (choiceIds.some(choiceId => !choiceId || !choiceById.has(choiceId))) {
      return invalid('unknown_choice');
    }

    const needsOtherText = choiceIds.some(choiceId => choiceById.get(choiceId)?.requires_text === true);
    const hasOtherText = typeof answer.other_text === 'string';
    const otherText = hasOtherText ? answer.other_text.trim() : '';
    if (needsOtherText && (!otherText || answer.other_text.length > MAX_OTHER_TEXT)) {
      return invalid('other_text_required');
    }
    if (!needsOtherText && answer.other_text !== undefined) {
      return invalid('unexpected_other_text');
    }

    normalized.push({
      question_id: questionId,
      choice_ids: choiceIds,
      ...(needsOtherText ? { other_text: otherText } : {}),
    });
  }

  return { ok: true, reason: null, answers: normalized };
}

module.exports = { normalizeQuestionAnswers };
