#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { normalizeQuestionAnswers } = require('../relay-server/question-answers');

const prompt = {
  questions: [
    {
      question_id: 'approach',
      multi_select: false,
      choices: [
        { choice_id: 'fix', label: 'Fix launcher' },
        { choice_id: 'other', label: 'Other', requires_text: true },
      ],
    },
    {
      question_id: 'checks',
      multi_select: true,
      choices: [
        { choice_id: 'unit', label: 'Unit tests' },
        { choice_id: 'visual', label: 'Visual tests' },
      ],
    },
  ],
};

const valid = normalizeQuestionAnswers(prompt, [
  { question_id: 'checks', choice_ids: ['unit', 'visual'] },
  { question_id: 'approach', choice_ids: ['other'], other_text: 'Use the hidden launcher' },
]);
assert.strictEqual(valid.ok, true);
assert.deepStrictEqual(valid.answers, [
  { question_id: 'approach', choice_ids: ['other'], other_text: 'Use the hidden launcher' },
  { question_id: 'checks', choice_ids: ['unit', 'visual'] },
]);

const rejected = [
  [{ question_id: 'approach', choice_ids: ['fix'] }],
  [
    { question_id: 'approach', choice_ids: ['fix'] },
    { question_id: 'approach', choice_ids: ['other'], other_text: 'duplicate' },
  ],
  [
    { question_id: 'approach', choice_ids: ['fix', 'other'], other_text: 'too many' },
    { question_id: 'checks', choice_ids: ['unit'] },
  ],
  [
    { question_id: 'approach', choice_ids: ['other'] },
    { question_id: 'checks', choice_ids: ['unit'] },
  ],
  [
    { question_id: 'approach', choice_ids: ['fix'], other_text: 'not requested' },
    { question_id: 'checks', choice_ids: ['unit'] },
  ],
  [
    { question_id: 'approach', choice_ids: ['fix'] },
    { question_id: 'checks', choice_ids: ['unit', 'unit'] },
  ],
  [
    { question_id: 'approach', choice_ids: ['unknown'] },
    { question_id: 'checks', choice_ids: ['unit'] },
  ],
];
for (const answers of rejected) {
  assert.strictEqual(normalizeQuestionAnswers(prompt, answers).ok, false);
}

console.log(JSON.stringify({
  ok: true,
  questions: prompt.questions.length,
  valid_answers: valid.answers.length,
  rejected_shapes: rejected.length,
}));
