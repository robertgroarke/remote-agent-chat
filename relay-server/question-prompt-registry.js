'use strict';

const {
  QuestionContractError,
  advanceQuestionLifecycle,
  canonicalQuestionPrompt,
  canonicalQuestionResponse,
} = require('./question-contract-loader').loadQuestionPromptContract();

const CLIENT_REQUEST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$/;
const RETAINED_TERMINAL_STATES = new Set(['failed']);
const NATIVE_DEADLINE_RECEIPT_GRACE_MS = 5000;

function questionPromptDeadlineGraceMs(prompt) {
  return prompt?.auto_resolution_policy === 'native' ? NATIVE_DEADLINE_RECEIPT_GRACE_MS : 0;
}

class QuestionPromptRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QuestionPromptRegistryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new QuestionPromptRegistryError(code, message);
}

function keyFor(sessionId, promptId) {
  return `${sessionId}\0${promptId}`;
}

function safeError(error, fallbackCode = 'invalid_question_prompt') {
  if (error instanceof QuestionPromptRegistryError) return error;
  if (error instanceof QuestionContractError) {
    return new QuestionPromptRegistryError(error.code || fallbackCode, error.message);
  }
  return new QuestionPromptRegistryError(fallbackCode, 'Question prompt validation failed');
}

function publicView(entry) {
  return {
    ...entry.prompt,
    lifecycle: entry.lifecycle,
    ...(entry.submittedAt ? { submitted_at: entry.submittedAt } : {}),
    ...(entry.terminalAt ? { terminal_at: entry.terminalAt } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    ...(entry.retryable ? { retryable: true } : {}),
  };
}

function adaptLegacyQuestionPermissionPrompt(raw) {
  if (raw?.type !== 'permission_prompt' || raw?.kind !== 'question') {
    fail('not_legacy_question', 'only permission_prompt kind=question can use the compatibility adapter');
  }
  const observedAt = raw.detected_at || raw.observed_at || new Date().toISOString();
  const timeoutMs = Number(raw.timeout_ms);
  const derivedDeadline = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? new Date(Date.parse(observedAt) + timeoutMs).toISOString()
    : null;
  return canonicalQuestionPrompt({
    type: 'question_prompt',
    prompt_id: raw.prompt_id,
    session_id: raw.session_id || raw.session,
    generation: raw.generation || `legacy-question:${raw.prompt_id}`,
    kind: raw.question_kind || 'request_user_input',
    source: {
      surface: raw.source?.surface || raw.agent_type || 'legacy',
      version: raw.source?.version || raw.source_version || 'legacy-v1',
    },
    title: raw.title || 'Question',
    questions: (Array.isArray(raw.questions) ? raw.questions : []).map((question, index) => ({
      id: question?.question_id || question?.id || `question-${index + 1}`,
      header: question?.header || question?.label || `Question ${index + 1}`,
      question: question?.question || question?.message,
      options: Array.isArray(question?.choices) ? question.choices.map(choice => ({
        id: choice?.choice_id || choice?.id,
        label: choice?.label || choice?.title || choice?.text,
        description: choice?.description || '',
        requires_text: choice?.requires_text === true,
        is_other: choice?.is_other === true,
      })) : null,
      multi_select: question?.multi_select === true,
      allow_other: question?.allow_other === true
        || question?.choices?.some(choice => choice?.requires_text === true || choice?.is_other === true),
      secret: question?.secret === true,
      required: question?.required !== false,
    })),
    observed_at: observedAt,
    deadline_at: raw.deadline_at || derivedDeadline,
    auto_resolution_ms: raw.auto_resolution_ms ?? null,
    auto_resolution_policy: raw.auto_resolution_policy ?? null,
    cancel_supported: raw.cancel_supported === true,
  });
}

class QuestionPromptRegistry {
  constructor({ now = () => Date.now(), maxEntries = 4096, terminalTtlMs = 5 * 60 * 1000 } = {}) {
    this.now = now;
    this.maxEntries = Math.max(32, Number(maxEntries) || 4096);
    this.terminalTtlMs = Math.max(1000, Number(terminalTtlMs) || 5 * 60 * 1000);
    this.entries = new Map();
    this.requestBindings = new Map();
  }

  open(rawPrompt) {
    let prompt;
    try {
      prompt = rawPrompt?.type === 'permission_prompt'
        ? adaptLegacyQuestionPermissionPrompt(rawPrompt)
        : canonicalQuestionPrompt(rawPrompt);
    } catch (error) {
      throw safeError(error);
    }
    const key = keyFor(prompt.session_id, prompt.prompt_id);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.prompt.generation !== prompt.generation) {
        fail('prompt_id_collision', 'prompt ID was reused for a different generation');
      }
      return { status: 'duplicate', prompt: publicView(existing), replaced: [] };
    }
    const replaced = [];
    for (const entry of this.entries.values()) {
      if (entry.prompt.session_id !== prompt.session_id) continue;
      if (!['open', 'submitting'].includes(entry.lifecycle)) continue;
      entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'cancelled');
      entry.terminalAt = new Date(this.now()).toISOString();
      entry.errorCode = 'replaced_by_native_prompt';
      entry.error = 'The native surface replaced this question.';
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
      replaced.push(publicView(entry));
    }
    const entry = {
      prompt,
      lifecycle: 'open',
      requestId: null,
      submittedAt: null,
      terminalAt: null,
      error: null,
      errorCode: null,
      retryable: false,
      nativeAttempted: false,
      forwardedToProxy: false,
    };
    this.entries.set(key, entry);
    this.prune();
    return { status: 'opened', prompt: publicView(entry), replaced };
  }

  get(sessionId, promptId) {
    const entry = this.entries.get(keyFor(sessionId, promptId));
    return entry ? publicView(entry) : null;
  }

  views({ includeTerminal = false } = {}) {
    return Array.from(this.entries.values())
      .filter(entry => includeTerminal
        || ['open', 'submitting'].includes(entry.lifecycle)
        || RETAINED_TERMINAL_STATES.has(entry.lifecycle))
      .map(publicView);
  }

  claim(rawResponse) {
    const sessionId = typeof rawResponse?.session_id === 'string' ? rawResponse.session_id : '';
    const promptId = typeof rawResponse?.prompt_id === 'string' ? rawResponse.prompt_id : '';
    const requestId = typeof rawResponse?.request_id === 'string' ? rawResponse.request_id : '';
    if (!CLIENT_REQUEST_ID_RE.test(requestId)) fail('invalid_request_id', 'question response request_id is invalid');
    if (this.requestBindings.has(requestId)) fail('duplicate_request_id', 'question response request_id was already used');
    const entry = this.entries.get(keyFor(sessionId, promptId));
    if (!entry) fail('prompt_not_found', 'question prompt is not open');
    if (entry.lifecycle !== 'open') fail('prompt_already_claimed', `question prompt is already ${entry.lifecycle}`);
    if (entry.prompt.deadline_at && Date.parse(entry.prompt.deadline_at) <= this.now()) {
      if (this.now() < Date.parse(entry.prompt.deadline_at) + questionPromptDeadlineGraceMs(entry.prompt)) {
        fail('prompt_expired', 'question prompt expired before this response');
      }
      entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'expired');
      entry.terminalAt = new Date(this.now()).toISOString();
      entry.errorCode = 'native_deadline_elapsed';
      entry.error = 'The native question deadline elapsed.';
      fail('prompt_expired', 'question prompt expired before this response');
    }
    let response;
    try {
      response = canonicalQuestionResponse(entry.prompt, rawResponse);
    } catch (error) {
      throw safeError(error, 'invalid_question_response');
    }
    entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'submitting');
    entry.requestId = requestId;
    entry.submittedAt = new Date(this.now()).toISOString();
    entry.error = null;
    entry.errorCode = null;
    entry.retryable = false;
    this.requestBindings.set(requestId, entry);
    return { response, prompt: publicView(entry) };
  }

  markForwarded(requestId) {
    const entry = this.requestBindings.get(requestId);
    if (!entry || entry.lifecycle !== 'submitting') fail('response_not_claimed', 'question response is not claimed');
    entry.forwardedToProxy = true;
    return publicView(entry);
  }

  resolve(requestId, {
    ok,
    lifecycle = null,
    errorCode = null,
    error = null,
    retryable = false,
    nativeAttempted = null,
  } = {}) {
    const entry = this.requestBindings.get(requestId);
    if (!entry) return null;
    this.requestBindings.delete(requestId);
    entry.requestId = null;
    const terminal = ok
      ? (lifecycle === 'cancelled' ? 'cancelled' : 'answered')
      : 'failed';
    entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, terminal);
    entry.terminalAt = new Date(this.now()).toISOString();
    entry.errorCode = ok ? null : String(errorCode || 'native_answer_failed').slice(0, 120);
    entry.error = ok ? null : String(error || 'The native question did not accept the response.').slice(0, 500);
    entry.nativeAttempted = nativeAttempted == null ? entry.nativeAttempted : nativeAttempted === true;
    entry.retryable = !ok && retryable === true && entry.nativeAttempted === false;
    return publicView(entry);
  }

  abandonRequest(requestId, code = 'response_receipt_timeout', message = 'The native question response receipt timed out.') {
    const entry = this.requestBindings.get(requestId);
    if (!entry) return null;
    return this.resolve(requestId, {
      ok: false,
      errorCode: code,
      error: message,
      retryable: entry.forwardedToProxy === false,
      nativeAttempted: false,
    });
  }

  terminalFromSource({ session_id: sessionId, prompt_id: promptId, generation, lifecycle, error_code: errorCode, error } = {}) {
    const entry = this.entries.get(keyFor(sessionId, promptId));
    if (!entry) return null;
    if (entry.prompt.generation !== generation) fail('stale_generation', 'source terminal state has a stale generation');
    if (!['answered', 'auto_resolved', 'cancelled', 'expired', 'failed'].includes(lifecycle)) {
      fail('invalid_terminal_lifecycle', 'source lifecycle is not terminal');
    }
    if (['answered', 'auto_resolved', 'cancelled', 'expired', 'failed'].includes(entry.lifecycle)) {
      if (entry.lifecycle === lifecycle) return publicView(entry);
      fail('terminal_prompt', `question prompt is already ${entry.lifecycle}`);
    }
    if (['answered', 'auto_resolved'].includes(lifecycle) && entry.lifecycle === 'submitting') {
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
    }
    entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, lifecycle);
    entry.requestId = null;
    entry.terminalAt = new Date(this.now()).toISOString();
    entry.errorCode = errorCode ? String(errorCode).slice(0, 120) : null;
    entry.error = error ? String(error).slice(0, 500) : null;
    return publicView(entry);
  }

  expire(sessionId, promptId, generation) {
    const entry = this.entries.get(keyFor(sessionId, promptId));
    if (!entry || !['open', 'submitting'].includes(entry.lifecycle)) return null;
    if (entry.prompt.generation !== generation) return null;
    if (entry.requestId) this.requestBindings.delete(entry.requestId);
    entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'expired');
    entry.requestId = null;
    entry.terminalAt = new Date(this.now()).toISOString();
    entry.errorCode = 'native_deadline_elapsed';
    entry.error = 'The native question deadline elapsed.';
    return publicView(entry);
  }

  failSession(sessionId, code = 'adapter_disconnected', message = 'The native question adapter disconnected.') {
    const failed = [];
    for (const entry of this.entries.values()) {
      if (entry.prompt.session_id !== sessionId || !['open', 'submitting'].includes(entry.lifecycle)) continue;
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
      entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'failed');
      entry.requestId = null;
      entry.terminalAt = new Date(this.now()).toISOString();
      entry.errorCode = code;
      entry.error = message;
      entry.retryable = false;
      failed.push(publicView(entry));
    }
    return failed;
  }

  disconnectSession(sessionId) {
    const failed = [];
    for (const entry of this.entries.values()) {
      if (entry.prompt.session_id !== sessionId || entry.lifecycle !== 'submitting') continue;
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
      entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'failed');
      entry.requestId = null;
      entry.terminalAt = new Date(this.now()).toISOString();
      entry.errorCode = 'adapter_disconnected_during_submit';
      entry.error = 'The native question adapter disconnected before a receipt arrived.';
      entry.retryable = false;
      failed.push(publicView(entry));
    }
    return failed;
  }

  removeSession(sessionId) {
    for (const [key, entry] of this.entries) {
      if (entry.prompt.session_id !== sessionId) continue;
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
      this.entries.delete(key);
    }
  }

  timeoutSubmitting(now = this.now(), ttlMs = 2 * 60 * 1000) {
    const failed = [];
    for (const entry of this.entries.values()) {
      if (entry.lifecycle !== 'submitting' || !entry.submittedAt) continue;
      if (now - Date.parse(entry.submittedAt) <= ttlMs) continue;
      if (entry.requestId) this.requestBindings.delete(entry.requestId);
      entry.lifecycle = advanceQuestionLifecycle(entry.lifecycle, 'failed');
      entry.requestId = null;
      entry.terminalAt = new Date(now).toISOString();
      entry.errorCode = 'native_receipt_timeout';
      entry.error = 'The native question response receipt timed out.';
      entry.retryable = false;
      failed.push(publicView(entry));
    }
    return failed;
  }

  prune(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (!entry.terminalAt) continue;
      if (now - Date.parse(entry.terminalAt) < this.terminalTtlMs) continue;
      this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      const entry = this.entries.get(oldest);
      if (entry?.requestId) this.requestBindings.delete(entry.requestId);
      this.entries.delete(oldest);
    }
  }
}

module.exports = {
  NATIVE_DEADLINE_RECEIPT_GRACE_MS,
  QuestionPromptRegistry,
  QuestionPromptRegistryError,
  adaptLegacyQuestionPermissionPrompt,
  questionPromptDeadlineGraceMs,
};
