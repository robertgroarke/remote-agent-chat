'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  QuestionContractError,
  canonicalQuestionPrompt,
  canonicalQuestionResponse,
} = require('../shared/question-prompt-contract');

const METHOD = 'item/tool/requestUserInput';
const SUPPORTED_SURFACES = new Set(['codex_cli', 'codex', 'codex-desktop']);

class CodexQuestionBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CodexQuestionBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CodexQuestionBridgeError(code, message);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail('schema_read_failed', `Could not read generated schema ${path.basename(filePath)}: ${error.message}`);
  }
}

function sorted(values) {
  return [...values].sort();
}

function sameMembers(actual, expected) {
  return JSON.stringify(sorted(actual || [])) === JSON.stringify(sorted(expected || []));
}

function schemaTypes(schema) {
  if (Array.isArray(schema?.type)) return schema.type;
  return schema?.type ? [schema.type] : [];
}

function requireTypes(schema, expected, field) {
  if (!sameMembers(schemaTypes(schema), expected)) {
    fail('schema_incompatible', `${field} types changed`);
  }
}

function validateGeneratedQuestionSchemas(schemaDir) {
  const params = readJson(path.join(schemaDir, 'ToolRequestUserInputParams.json'));
  const response = readJson(path.join(schemaDir, 'ToolRequestUserInputResponse.json'));
  const serverRequest = readJson(path.join(schemaDir, 'ServerRequest.json'));
  const requestVariant = (serverRequest.oneOf || []).find(variant => (
    variant?.properties?.method?.enum?.includes(METHOD)
  ));
  if (!requestVariant || !sameMembers(requestVariant.required, ['id', 'method', 'params'])) {
    fail('schema_incompatible', `${METHOD} server request envelope changed`);
  }
  if (requestVariant.properties?.params?.$ref !== '#/definitions/ToolRequestUserInputParams') {
    fail('schema_incompatible', `${METHOD} params reference changed`);
  }
  if (!sameMembers(params.required, ['itemId', 'questions', 'threadId', 'turnId'])) {
    fail('schema_incompatible', 'request_user_input required params changed');
  }
  const expectedParamProperties = ['autoResolutionMs', 'itemId', 'questions', 'threadId', 'turnId'];
  if (!sameMembers(Object.keys(params.properties || {}), expectedParamProperties)) {
    fail('schema_incompatible', 'request_user_input param fields changed');
  }
  for (const field of ['itemId', 'threadId', 'turnId']) requireTypes(params.properties[field], ['string'], field);
  requireTypes(params.properties.autoResolutionMs, ['integer', 'null'], 'autoResolutionMs');
  requireTypes(params.properties.questions, ['array'], 'questions');
  const question = params.definitions?.ToolRequestUserInputQuestion;
  if (!sameMembers(question?.required, ['header', 'id', 'question'])) {
    fail('schema_incompatible', 'request_user_input question required fields changed');
  }
  if (!sameMembers(Object.keys(question?.properties || {}), ['header', 'id', 'isOther', 'isSecret', 'options', 'question'])) {
    fail('schema_incompatible', 'request_user_input question fields changed');
  }
  for (const field of ['header', 'id', 'question']) requireTypes(question.properties[field], ['string'], `question.${field}`);
  for (const field of ['isOther', 'isSecret']) requireTypes(question.properties[field], ['boolean'], `question.${field}`);
  requireTypes(question.properties.options, ['array', 'null'], 'question.options');
  const option = params.definitions?.ToolRequestUserInputOption;
  if (!sameMembers(option?.required, ['description', 'label'])
      || !sameMembers(Object.keys(option?.properties || {}), ['description', 'label'])) {
    fail('schema_incompatible', 'request_user_input option fields changed');
  }
  for (const field of ['description', 'label']) requireTypes(option.properties[field], ['string'], `option.${field}`);
  if (!sameMembers(response.required, ['answers'])
      || !sameMembers(Object.keys(response.properties || {}), ['answers'])) {
    fail('schema_incompatible', 'request_user_input response fields changed');
  }
  requireTypes(response.properties.answers, ['object'], 'response.answers');
  const answer = response.definitions?.ToolRequestUserInputAnswer;
  if (!sameMembers(answer?.required, ['answers'])
      || !sameMembers(Object.keys(answer?.properties || {}), ['answers'])) {
    fail('schema_incompatible', 'request_user_input answer fields changed');
  }
  requireTypes(answer.properties.answers, ['array'], 'response.answer.answers');
  requireTypes(answer.properties.answers.items, ['string'], 'response.answer.answers[]');
  return {
    ok: true,
    method: METHOD,
    request_required: [...params.required],
    response_required: [...response.required],
  };
}

function nativeRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) fail('invalid_native_request', 'native request must be an object');
  if (message.id === undefined || message.id === null || !['string', 'number'].includes(typeof message.id)) {
    fail('invalid_native_request_id', 'native request ID must be a string or number');
  }
  if (message.method !== METHOD) fail('wrong_native_method', `expected ${METHOD}`);
  const params = message.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) fail('invalid_native_params', 'native params must be an object');
  for (const field of ['threadId', 'turnId', 'itemId']) {
    if (typeof params[field] !== 'string' || !params[field].trim()) fail('invalid_native_params', `${field} is required`);
  }
  if (!Array.isArray(params.questions) || params.questions.length === 0) fail('invalid_native_questions', 'questions are required');
  if (params.autoResolutionMs != null && (!Number.isSafeInteger(params.autoResolutionMs) || params.autoResolutionMs < 0)) {
    fail('invalid_native_auto_resolution', 'autoResolutionMs is invalid');
  }
  return { id: message.id, params };
}

function normalizedQuestionIdentity(params) {
  return JSON.stringify({
    thread_id: params.threadId,
    turn_id: params.turnId,
    item_id: params.itemId,
    questions: params.questions.map(question => ({
      id: question.id,
      header: question.header,
      question: question.question,
      options: Array.isArray(question.options)
        ? question.options.map(option => ({
            label: option.label,
            description: option.description,
          }))
        : null,
      is_other: question.isOther === true,
      is_secret: question.isSecret === true,
    })),
  });
}

function identityToken(domain, params) {
  return crypto.createHash('sha256')
    .update(`rac-codex-question-v1\0${domain}\0${normalizedQuestionIdentity(params)}`)
    .digest('hex');
}

class CodexQuestionBridge {
  constructor({ sessionId, surface, version, connectionGeneration = crypto.randomUUID(), now = () => Date.now() }) {
    if (!SUPPORTED_SURFACES.has(surface)) fail('unsupported_surface', `unsupported Codex question surface: ${surface}`);
    this.sessionId = String(sessionId || '').trim();
    if (!this.sessionId) fail('invalid_session_id', 'sessionId is required');
    this.surface = surface;
    this.version = String(version || '').trim();
    if (!this.version) fail('invalid_surface_version', 'surface version is required');
    this.connectionGeneration = String(connectionGeneration || '').trim();
    if (!this.connectionGeneration) fail('invalid_connection_generation', 'connection generation is required');
    this.now = now;
    this.connected = true;
    this.entries = new Map();
  }

  open(message) {
    if (!this.connected) fail('adapter_disconnected', 'Codex question adapter is disconnected');
    const native = nativeRequest(message);
    const promptId = `codex-question-${identityToken('prompt', native.params).slice(0, 32)}`;
    const generation = identityToken('generation', native.params);
    const existing = this.entries.get(promptId);
    if (existing) {
      if (existing.prompt.generation !== generation) {
        fail('prompt_id_collision', 'question prompt identity was reused for a different generation');
      }
      // App-server may replay the same still-open request after a transport
      // reconnect. Refresh only the native response destination; preserve the
      // canonical prompt object, observed time, and deadline so downstream
      // clients see continuous membership rather than a replacement.
      existing.nativeRequestId = native.id;
      existing.threadId = native.params.threadId;
      existing.turnId = native.params.turnId;
      existing.itemId = native.params.itemId;
      return existing.prompt;
    }
    const observedMs = this.now();
    const autoResolutionMs = native.params.autoResolutionMs ?? null;
    const prompt = canonicalQuestionPrompt({
      prompt_id: promptId,
      session_id: this.sessionId,
      generation,
      kind: 'request_user_input',
      source: { surface: this.surface, version: this.version },
      title: native.params.questions.length === 1 ? native.params.questions[0].header : 'Codex questions',
      questions: native.params.questions,
      native_at: null,
      observed_at: new Date(observedMs).toISOString(),
      deadline_at: autoResolutionMs == null ? null : new Date(observedMs + autoResolutionMs).toISOString(),
      auto_resolution_ms: autoResolutionMs,
      auto_resolution_policy: autoResolutionMs == null ? null : 'native',
      cancel_supported: false,
    });
    this.entries.set(promptId, {
      prompt,
      nativeRequestId: native.id,
      threadId: native.params.threadId,
      turnId: native.params.turnId,
      itemId: native.params.itemId,
      state: 'open',
    });
    return prompt;
  }

  buildResponse(rawResponse) {
    if (!this.connected) fail('adapter_disconnected', 'Codex question adapter is disconnected');
    const promptId = typeof rawResponse?.prompt_id === 'string' ? rawResponse.prompt_id : '';
    const entry = this.entries.get(promptId);
    if (!entry) fail('prompt_not_found', 'question prompt is not open on this connection');
    if (entry.state !== 'open') fail('prompt_already_claimed', 'question prompt was already claimed');
    let response;
    try {
      response = canonicalQuestionResponse(entry.prompt, rawResponse);
    } catch (error) {
      if (error instanceof QuestionContractError) fail(error.code, error.message);
      throw error;
    }
    if (response.action !== 'answer') fail('native_cancel_unsupported', 'request_user_input cannot be cancelled by a synthetic response');
    const nativeAnswers = {};
    for (const answer of response.answers) {
      const question = entry.prompt.questions.find(item => item.question_id === answer.question_id);
      if (!question) fail('question_not_found', 'answer question is not open');
      if (question.answer_mode === 'text') {
        nativeAnswers[question.question_id] = { answers: [answer.text] };
        continue;
      }
      const byId = new Map(question.choices.map(choice => [choice.choice_id, choice]));
      nativeAnswers[question.question_id] = {
        answers: answer.choice_ids.map(choiceId => {
          const choice = byId.get(choiceId);
          return choice.requires_text || choice.is_other ? answer.other_text : choice.label;
        }),
      };
    }
    entry.state = 'claimed';
    return {
      id: entry.nativeRequestId,
      result: { answers: nativeAnswers },
      prompt_id: promptId,
      generation: entry.prompt.generation,
    };
  }

  confirmNativeReceipt(promptId) {
    const entry = this.entries.get(promptId);
    if (!entry) fail('prompt_not_found', 'question prompt is not open on this connection');
    if (entry.state !== 'claimed') fail('prompt_not_claimed', 'question response has not been claimed');
    entry.state = 'answered';
    entry.nativeRequestId = null;
    return { prompt_id: promptId, lifecycle: 'answered' };
  }

  // Backward-compatible name for the initial contract smoke. Production
  // adapters call confirmNativeReceipt only after a same-turn native event.
  confirmWritten(promptId) {
    return this.confirmNativeReceipt(promptId);
  }

  disconnect() {
    this.connected = false;
    const expired = [];
    for (const [promptId, entry] of this.entries) {
      if (entry.state === 'answered') continue;
      entry.state = 'failed';
      entry.nativeRequestId = null;
      expired.push({ prompt_id: promptId, lifecycle: 'failed', error_code: 'adapter_disconnected' });
    }
    return expired;
  }
}

module.exports = {
  METHOD,
  CodexQuestionBridge,
  CodexQuestionBridgeError,
  validateGeneratedQuestionSchemas,
};
