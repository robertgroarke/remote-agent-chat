'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT_FILENAME = 'question-prompt-contract.js';

function resolveQuestionContractPath(baseDir = __dirname) {
  const candidates = [
    path.join(baseDir, 'shared', CONTRACT_FILENAME),
    path.join(baseDir, '..', 'shared', CONTRACT_FILENAME),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (resolved) return resolved;
  const error = new Error('Question prompt contract is missing from both relay and repository layouts');
  error.code = 'QUESTION_CONTRACT_MISSING';
  throw error;
}

function loadQuestionPromptContract(baseDir = __dirname) {
  return require(resolveQuestionContractPath(baseDir));
}

module.exports = {
  CONTRACT_FILENAME,
  loadQuestionPromptContract,
  resolveQuestionContractPath,
};
