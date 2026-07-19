'use strict';

function semanticChoice(question, label) {
  const matches = (question?.choices || []).filter(choice =>
    choice.label === label || choice.label === label + ' (Recommended)');
  if (matches.length > 1) {
    throw new Error('question prompt has ambiguous ' + label + ' choices');
  }
  return matches[0] || null;
}

module.exports = { semanticChoice };
