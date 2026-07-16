'use strict';

const crypto = require('crypto');

const QUESTION_PROMPT_VERSION = 1;
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 20;
const MAX_TEXT_LENGTH = 2000;
const TERMINAL_STATES = new Set([
  'answered', 'auto_resolved', 'cancelled', 'expired', 'failed',
]);

class QuestionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QuestionContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new QuestionContractError(code, message);
}

function boundedString(value, field, { allowEmpty = false, max = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== 'string') fail(`invalid_${field}`, `${field} must be a string`);
  const text = value.trim();
  if (!allowEmpty && !text) fail(`invalid_${field}`, `${field} must not be empty`);
  if (text.length > max) fail(`invalid_${field}`, `${field} is too long`);
  return text;
}

function optionalTimestamp(value, field) {
  if (value == null) return null;
  const text = boundedString(value, field, { max: 80 });
  if (!Number.isFinite(Date.parse(text))) fail(`invalid_${field}`, `${field} must be an ISO timestamp`);
  return new Date(Date.parse(text)).toISOString();
}

function stableChoiceId(questionId, index, label) {
  const digest = crypto.createHash('sha256')
    .update(`${questionId}\0${index}\0${label}`)
    .digest('hex')
    .slice(0, 16);
  return `choice-${digest}`;
}

function canonicalQuestion(raw, index) {
  const questionId = boundedString(raw?.question_id || raw?.id, 'question_id', { max: 120 });
  const header = boundedString(raw?.header || raw?.label || `Question ${index + 1}`, 'header', { max: 120 });
  const message = boundedString(raw?.message || raw?.question, 'question', { max: 4000 });
  const optionInput = raw?.options !== undefined ? raw.options : raw?.choices;
  const rawOptions = optionInput == null ? null : optionInput;
  if (rawOptions !== null && !Array.isArray(rawOptions)) {
    fail('invalid_question_options', 'question options must be an array or null');
  }
  if (Array.isArray(rawOptions) && rawOptions.length > MAX_OPTIONS) {
    fail('too_many_question_options', `question options exceed ${MAX_OPTIONS}`);
  }
  const choices = (rawOptions || []).map((option, optionIndex) => {
    const label = boundedString(option?.label, 'option_label', { max: 240 });
    const choiceId = boundedString(
      option?.choice_id || option?.id || stableChoiceId(questionId, optionIndex, label),
      'choice_id',
      { max: 160 },
    );
    return {
      choice_id: choiceId,
      label,
      description: typeof option?.description === 'string'
        ? boundedString(option.description, 'option_description', { allowEmpty: true, max: 1000 })
        : '',
      selected: option?.selected === true,
      requires_text: option?.requires_text === true,
      is_other: option?.is_other === true,
    };
  });
  if (new Set(choices.map(choice => choice.choice_id)).size !== choices.length) {
    fail('duplicate_choice_id', 'choice IDs must be unique within a question');
  }
  const multiSelect = raw?.multi_select === true;
  const allowOther = raw?.allow_other === true || raw?.isOther === true;
  const secret = raw?.secret === true || raw?.isSecret === true;
  if (allowOther && choices.length > 0 && !choices.some(choice => choice.is_other)) {
    choices.push({
      choice_id: stableChoiceId(questionId, choices.length, 'Other'),
      label: 'Other',
      description: 'Enter another answer.',
      selected: false,
      requires_text: true,
      is_other: true,
    });
  }
  const answerMode = choices.length === 0 ? 'text' : (multiSelect ? 'multiple' : 'single');
  return {
    question_id: questionId,
    header,
    message,
    answer_mode: answerMode,
    required: raw?.required !== false,
    multi_select: multiSelect,
    allow_other: allowOther,
    secret,
    choices,
  };
}

function canonicalQuestionPrompt(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('invalid_prompt', 'question prompt must be an object');
  }
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (questions.length === 0 || questions.length > MAX_QUESTIONS) {
    fail('invalid_questions', `question prompt must contain 1-${MAX_QUESTIONS} questions`);
  }
  const normalizedQuestions = questions.map(canonicalQuestion);
  if (new Set(normalizedQuestions.map(question => question.question_id)).size !== normalizedQuestions.length) {
    fail('duplicate_question_id', 'question IDs must be unique');
  }
  const lifecycle = raw.lifecycle || 'open';
  if (lifecycle !== 'open') fail('invalid_initial_lifecycle', 'new question prompts must start open');
  const observedAt = optionalTimestamp(raw.observed_at, 'observed_at') || new Date().toISOString();
  const nativeAt = optionalTimestamp(raw.native_at, 'native_at');
  const deadlineAt = optionalTimestamp(raw.deadline_at, 'deadline_at');
  const autoResolutionMs = raw.auto_resolution_ms == null ? null : Number(raw.auto_resolution_ms);
  if (autoResolutionMs != null && (!Number.isSafeInteger(autoResolutionMs) || autoResolutionMs < 0)) {
    fail('invalid_auto_resolution_ms', 'auto_resolution_ms must be a non-negative safe integer or null');
  }
  if (deadlineAt && Date.parse(deadlineAt) < Date.parse(observedAt)) {
    fail('invalid_deadline', 'deadline_at precedes observed_at');
  }
  return {
    type: 'question_prompt',
    contract_version: QUESTION_PROMPT_VERSION,
    prompt_id: boundedString(raw.prompt_id, 'prompt_id', { max: 160 }),
    session_id: boundedString(raw.session_id, 'session_id', { max: 240 }),
    generation: boundedString(raw.generation, 'generation', { max: 240 }),
    kind: boundedString(raw.kind || 'request_user_input', 'kind', { max: 80 }),
    source: {
      surface: boundedString(raw.source?.surface, 'source_surface', { max: 80 }),
      version: boundedString(raw.source?.version, 'source_version', { max: 80 }),
    },
    title: typeof raw.title === 'string'
      ? boundedString(raw.title, 'title', { allowEmpty: true, max: 240 })
      : normalizedQuestions[0].header,
    questions: normalizedQuestions,
    lifecycle: 'open',
    native_at: nativeAt,
    observed_at: observedAt,
    deadline_at: deadlineAt,
    auto_resolution_ms: autoResolutionMs,
    auto_resolution_policy: raw.auto_resolution_policy == null
      ? null
      : boundedString(raw.auto_resolution_policy, 'auto_resolution_policy', { max: 120 }),
    cancel_supported: raw.cancel_supported === true,
    contains_secret: normalizedQuestions.some(question => question.secret),
  };
}

function normalizedAnswer(question, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('invalid_answer', 'each answer must be an object');
  }
  const questionId = boundedString(raw.question_id, 'answer_question_id', { max: 120 });
  if (questionId !== question.question_id) fail('wrong_question', 'answer does not match the open question');
  if (question.answer_mode === 'text') {
    if (raw.choice_ids !== undefined || raw.other_text !== undefined) {
      fail('invalid_text_answer_shape', 'text answers cannot include choices');
    }
    return {
      question_id: questionId,
      text: boundedString(raw.text, 'answer_text', { allowEmpty: !question.required, max: MAX_TEXT_LENGTH }),
      secret: question.secret,
    };
  }
  if (raw.text !== undefined) fail('invalid_choice_answer_shape', 'choice answers cannot include text');
  const choiceIds = Array.isArray(raw.choice_ids) ? raw.choice_ids.map(String) : [];
  if (choiceIds.length === 0 || (!question.multi_select && choiceIds.length !== 1)) {
    fail('invalid_choice_count', question.multi_select ? 'choose at least one option' : 'choose exactly one option');
  }
  if (new Set(choiceIds).size !== choiceIds.length) fail('duplicate_choice', 'duplicate choices are not allowed');
  const byId = new Map(question.choices.map(choice => [choice.choice_id, choice]));
  if (choiceIds.some(choiceId => !byId.has(choiceId))) fail('unknown_choice', 'answer contains an unknown choice');
  const needsOther = choiceIds.some(choiceId => byId.get(choiceId).requires_text || byId.get(choiceId).is_other);
  if (needsOther && !question.allow_other && !choiceIds.some(choiceId => byId.get(choiceId).requires_text)) {
    fail('other_not_allowed', 'Other text is not allowed for this question');
  }
  const result = { question_id: questionId, choice_ids: choiceIds, secret: question.secret };
  if (needsOther) result.other_text = boundedString(raw.other_text, 'other_text', { max: MAX_TEXT_LENGTH });
  else if (raw.other_text !== undefined) fail('unexpected_other_text', 'Other text was not requested');
  return result;
}

function canonicalQuestionResponse(prompt, raw) {
  if (!prompt || prompt.type !== 'question_prompt') fail('invalid_open_prompt', 'open prompt is invalid');
  if (prompt.lifecycle !== 'open') fail('prompt_not_open', 'question prompt is not open');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_response', 'question response must be an object');
  if (boundedString(raw.prompt_id, 'response_prompt_id', { max: 160 }) !== prompt.prompt_id) {
    fail('wrong_prompt', 'response does not match the open prompt');
  }
  if (boundedString(raw.session_id, 'response_session_id', { max: 240 }) !== prompt.session_id) {
    fail('wrong_session', 'response does not match the open session');
  }
  if (boundedString(raw.generation, 'response_generation', { max: 240 }) !== prompt.generation) {
    fail('stale_generation', 'response generation is stale');
  }
  const action = raw.action || 'answer';
  if (action === 'cancel') {
    if (!prompt.cancel_supported) fail('cancel_unsupported', 'this question cannot be cancelled remotely');
    if (raw.answers !== undefined) fail('cancel_with_answers', 'cancel cannot include answers');
    return {
      type: 'question_response',
      contract_version: QUESTION_PROMPT_VERSION,
      prompt_id: prompt.prompt_id,
      session_id: prompt.session_id,
      generation: prompt.generation,
      action: 'cancel',
    };
  }
  if (action !== 'answer') fail('invalid_response_action', 'response action must be answer or cancel');
  if (!Array.isArray(raw.answers) || raw.answers.length !== prompt.questions.length) {
    fail('invalid_answer_count', 'response must answer every question exactly once');
  }
  const byId = new Map();
  for (const answer of raw.answers) {
    const id = typeof answer?.question_id === 'string' ? answer.question_id.trim() : '';
    if (!id || byId.has(id)) fail('duplicate_or_missing_answer', 'answers must have unique question IDs');
    byId.set(id, answer);
  }
  const answers = prompt.questions.map(question => {
    const rawAnswer = byId.get(question.question_id);
    if (!rawAnswer) fail('missing_answer', 'response omitted a question');
    return normalizedAnswer(question, rawAnswer);
  });
  return {
    type: 'question_response',
    contract_version: QUESTION_PROMPT_VERSION,
    prompt_id: prompt.prompt_id,
    session_id: prompt.session_id,
    generation: prompt.generation,
    action: 'answer',
    answers,
  };
}

function publicQuestionResponse(response) {
  return {
    type: 'question_response_receipt',
    contract_version: QUESTION_PROMPT_VERSION,
    prompt_id: response.prompt_id,
    session_id: response.session_id,
    generation: response.generation,
    action: response.action,
  };
}

function advanceQuestionLifecycle(current, next) {
  const allowed = {
    open: new Set(['submitting', 'answered', 'auto_resolved', 'cancelled', 'expired', 'failed']),
    submitting: new Set(['answered', 'auto_resolved', 'cancelled', 'expired', 'failed']),
  };
  if (TERMINAL_STATES.has(current)) fail('terminal_prompt', `question prompt is already ${current}`);
  if (!allowed[current]?.has(next)) fail('invalid_lifecycle_transition', `cannot move question prompt from ${current} to ${next}`);
  return next;
}

module.exports = {
  MAX_QUESTIONS,
  MAX_OPTIONS,
  MAX_TEXT_LENGTH,
  QUESTION_PROMPT_VERSION,
  QuestionContractError,
  advanceQuestionLifecycle,
  canonicalQuestionPrompt,
  canonicalQuestionResponse,
  publicQuestionResponse,
};
