'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const {
  CodexQuestionBridge,
  validateGeneratedQuestionSchemas,
} = require('./codex-question-bridge');

const MAX_STDIO_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const schemaCache = new Map();

class CodexAppServerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CodexAppServerError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new CodexAppServerError(code, message, details);
}

function existingFile(value) {
  if (!value) return null;
  try { return fs.statSync(value).isFile() ? value : null; } catch { return null; }
}

function resolveCodexInvocation() {
  const explicit = existingFile(process.env.CODEX_CLI_PATH);
  if (explicit) {
    return /\.m?js$/i.test(explicit)
      ? { command: process.execPath, prefix: [explicit] }
      : { command: explicit, prefix: [] };
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmEntrypoint = existingFile(path.join(
      process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js',
    ));
    if (npmEntrypoint) return { command: process.execPath, prefix: [npmEntrypoint] };
  }
  return { command: 'codex', prefix: [] };
}

function runCodexSync(args, timeoutMs = 30000) {
  const invocation = resolveCodexInvocation();
  return spawnSync(invocation.command, [...invocation.prefix, ...args], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

function installedCodexVersion() {
  const result = runCodexSync(['--version'], 10000);
  if (result.status !== 0) fail('codex_version_failed', 'Could not read the installed Codex version');
  const match = String(result.stdout || '').match(/(\d+\.\d+\.\d+)/);
  if (!match) fail('codex_version_invalid', 'Installed Codex returned an unrecognized version');
  return match[1];
}

function prepareQuestionSchemas(version = installedCodexVersion()) {
  if (schemaCache.has(version)) return schemaCache.get(version);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rac-codex-schema-${version.replace(/[^a-z0-9.-]/gi, '-')}-`));
  const result = runCodexSync(['app-server', 'generate-json-schema', '--experimental', '--out', root], 30000);
  if (result.status !== 0) {
    fail('codex_schema_generation_failed', 'Codex app-server schema generation failed');
  }
  const validation = validateGeneratedQuestionSchemas(root);
  const prepared = { version, schemaDir: root, validation };
  schemaCache.set(version, prepared);
  return prepared;
}

function boundedStderr(current, chunk) {
  const next = `${current}${chunk || ''}`;
  return Buffer.byteLength(next, 'utf8') <= MAX_STDERR_BYTES
    ? next
    : Buffer.from(next, 'utf8').subarray(-MAX_STDERR_BYTES).toString('utf8');
}

class CodexAppServerConnection extends EventEmitter {
  constructor({
    sessionId,
    cwd = process.cwd(),
    clientName = 'remote-agent-chat',
    clientVersion = '1.0.0',
    requestTimeoutMs = 30000,
    questionReceiptTimeoutMs = 20000,
  } = {}) {
    super();
    this.sessionId = String(sessionId || '').trim();
    if (!this.sessionId) fail('invalid_session_id', 'An RAC session ID is required');
    this.cwd = cwd;
    this.clientName = clientName;
    this.clientVersion = clientVersion;
    this.requestTimeoutMs = Math.max(1000, Number(requestTimeoutMs) || 30000);
    this.questionReceiptTimeoutMs = Math.max(1000, Number(questionReceiptTimeoutMs) || 20000);
    this.connectionGeneration = null;
    this.child = null;
    this.version = null;
    this.schema = null;
    this.bridge = null;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.nextRequestId = 1;
    this.pending = new Map();
    this.activeQuestions = new Map();
    this.receiptWaiters = new Set();
    this.messageSequence = 0;
    this.started = false;
    this.stopping = false;
    this.disconnected = false;
  }

  async start() {
    if (this.started) return { version: this.version, schema: this.schema };
    this.disconnected = false;
    this.stopping = false;
    this.connectionGeneration = crypto.randomUUID();
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.messageSequence = 0;
    this.version = installedCodexVersion();
    this.schema = prepareQuestionSchemas(this.version);
    this.bridge = new CodexQuestionBridge({
      sessionId: this.sessionId,
      surface: 'codex_cli',
      version: this.version,
      connectionGeneration: this.connectionGeneration,
    });
    const invocation = resolveCodexInvocation();
    this.child = spawn(invocation.command, [...invocation.prefix, 'app-server', '--stdio'], {
      cwd: this.cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', chunk => this._readStdout(chunk));
    this.child.stderr.on('data', chunk => {
      this.stderrTail = boundedStderr(this.stderrTail, chunk.toString('utf8'));
    });
    this.child.on('error', error => this._disconnect('app_server_spawn_failed', error.message));
    this.child.on('exit', code => {
      if (!this.stopping) this._disconnect('app_server_exited', `Codex app-server exited (${code ?? 'unknown'})`);
    });
    let initialized;
    try {
      initialized = await this.request('initialize', {
        clientInfo: { name: this.clientName, version: this.clientVersion },
        capabilities: { experimentalApi: true },
      }, this.requestTimeoutMs);
    } catch (error) {
      this._disconnect('app_server_initialization_failed', 'Codex app-server initialization failed');
      throw error;
    }
    this._write({ method: 'initialized' });
    this.started = true;
    return { version: this.version, schema: this.schema, initialized };
  }

  request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new CodexAppServerError('app_server_disconnected', 'Codex app-server is not connected'));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new CodexAppServerError('app_server_request_timeout', `${method} timed out`));
      }, Math.max(1000, Number(timeoutMs) || this.requestTimeoutMs));
      timer.unref?.();
      this.pending.set(String(id), { method, resolve, reject, timer });
      try { this._write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  async startThread(params = {}) {
    const result = await this.request('thread/start', {
      cwd: this.cwd,
      ephemeral: true,
      ...params,
    });
    const threadId = result?.thread?.id;
    if (!threadId) fail('thread_start_invalid', 'Codex app-server did not return a thread ID');
    return result;
  }

  async resumeThread(threadId, params = {}) {
    if (!threadId) fail('thread_id_required', 'A Codex thread ID is required');
    return this.request('thread/resume', { threadId, ...params });
  }

  async startTurn(threadId, text, params = {}) {
    if (!threadId) fail('thread_id_required', 'A Codex thread ID is required');
    if (typeof text !== 'string' || !text.trim()) fail('turn_text_required', 'Turn text is required');
    return this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
      ...params,
    });
  }

  async getGoal(threadId) {
    return this.request('thread/goal/get', { threadId });
  }

  async setGoal(threadId, status, options = {}) {
    if (!threadId) fail('thread_id_required', 'A Codex thread ID is required');
    const params = { threadId, status };
    if (options.objective != null) params.objective = options.objective;
    if (options.tokenBudget != null) params.tokenBudget = options.tokenBudget;
    return this.request('thread/goal/set', params);
  }

  async clearGoal(threadId) {
    if (!threadId) fail('thread_id_required', 'A Codex thread ID is required');
    return this.request('thread/goal/clear', { threadId });
  }

  async controlGoal(threadId, action, expected = {}) {
    if (!['pause', 'resume'].includes(action)) {
      fail('invalid_goal_action', 'Goal action must be pause or resume');
    }
    const before = (await this.getGoal(threadId))?.goal;
    if (!before) fail('goal_not_found', 'The Codex thread has no goal');
    const beforeStatuses = action === 'pause' ? ['active'] : ['paused', 'blocked'];
    const afterStatus = action === 'pause' ? 'paused' : 'active';
    if (!beforeStatuses.includes(before.status)) {
      fail('native_goal_changed', `The Codex goal is no longer ${beforeStatuses.join(' or ')}`);
    }
    if (expected.objective != null && String(before.objective || '') !== String(expected.objective)) {
      fail('native_goal_changed', 'The Codex goal objective changed');
    }
    const beforeTokenBudget = before.tokenBudget ?? before.token_budget ?? null;
    const setResult = await this.setGoal(threadId, afterStatus, {
      objective: before.objective,
      ...(beforeTokenBudget != null ? { tokenBudget: beforeTokenBudget } : {}),
    });
    const after = (await this.getGoal(threadId))?.goal || setResult?.goal;
    if (!after || after.status !== afterStatus) {
      fail('goal_action_not_acknowledged', `Codex did not report goal status ${afterStatus}`);
    }
    const afterTokenBudget = after.tokenBudget ?? after.token_budget ?? null;
    if (after.objective !== before.objective || afterTokenBudget !== beforeTokenBudget) {
      fail('goal_identity_changed', 'Goal control changed the objective or token budget');
    }
    return {
      ok: true,
      native_acknowledged: true,
      action,
      before,
      after,
      native_operations: 1,
      transcript_messages_appended: 0,
    };
  }

  async readRateLimits() {
    return this.request('account/rateLimits/read', {});
  }

  async consumeRateLimitResetCredit(creditId = null, idempotencyKey = crypto.randomUUID()) {
    const params = { idempotencyKey: String(idempotencyKey) };
    if (creditId != null && String(creditId).trim()) params.creditId = String(creditId).trim();
    return this.request('account/rateLimitResetCredit/consume', params);
  }

  async resolveGoalDecision(threadId, decision) {
    if (!['resume', 'leave_paused'].includes(decision)) {
      fail('invalid_goal_decision', 'Goal decision must be resume or leave_paused');
    }
    const before = (await this.getGoal(threadId))?.goal;
    if (!before) fail('goal_not_found', 'The Codex thread has no goal');
    const expectedStatus = decision === 'resume' ? 'active' : 'paused';
    const setResult = await this.setGoal(threadId, expectedStatus);
    const after = (await this.getGoal(threadId))?.goal || setResult?.goal;
    if (!after || after.status !== expectedStatus) {
      fail('goal_decision_not_acknowledged', `Codex did not report goal status ${expectedStatus}`);
    }
    if (after.objective !== before.objective || after.tokenBudget !== before.tokenBudget) {
      fail('goal_identity_changed', 'Goal decision changed the objective or token budget');
    }
    return {
      ok: true,
      native_acknowledged: true,
      lifecycle: 'answered',
      decision,
      before,
      after,
      native_operations: 1,
      transcript_messages_appended: 0,
    };
  }

  async answerQuestion(response) {
    if (!this.bridge) fail('app_server_disconnected', 'Question bridge is unavailable');
    const entry = this.activeQuestions.get(response?.prompt_id);
    if (!entry) fail('prompt_not_found', 'The app-server question is no longer open');
    const wire = this.bridge.buildResponse(response);
    const afterSequence = this.messageSequence;
    const receiptPromise = this._waitForQuestionReceipt(entry, afterSequence);
    this._write({ id: wire.id, result: wire.result });
    try {
      const receipt = await receiptPromise;
      this.bridge.confirmNativeReceipt(response.prompt_id);
      this.activeQuestions.delete(response.prompt_id);
      return {
        ok: true,
        native_acknowledged: true,
        lifecycle: 'answered',
        native_receipt: receipt,
      };
    } catch (error) {
      this.activeQuestions.delete(response.prompt_id);
      throw error;
    }
  }

  async stop() {
    this.stopping = true;
    this.started = false;
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try { child.stdin.end(); } catch {}
    if (child.exitCode == null) {
      try { child.kill(); } catch {}
    }
    await new Promise(resolve => {
      if (child.exitCode != null) return resolve();
      const timer = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this._disconnect('app_server_stopped', 'Codex app-server stopped');
  }

  _write(message) {
    if (!this.child?.stdin?.writable) fail('app_server_disconnected', 'Codex app-server stdin is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _readStdout(chunk) {
    this.stdoutBuffer += chunk.toString('utf8');
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_STDIO_LINE_BYTES) {
      this._disconnect('app_server_frame_too_large', 'Codex app-server emitted an oversized frame');
      return;
    }
    let newline;
    while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        this._disconnect('app_server_invalid_json', 'Codex app-server emitted invalid JSON');
        return;
      }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    this.messageSequence += 1;
    const sequence = this.messageSequence;
    if (message?.id != null && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(new CodexAppServerError(
          'app_server_request_failed',
          `${pending.method} failed`,
          { rpcError: message.error },
        ));
      } else pending.resolve(message.result);
      return;
    }
    if (message?.id != null && message.method) {
      if (message.method === 'item/tool/requestUserInput') {
        try {
          const prompt = this.bridge.open(message);
          this.activeQuestions.set(prompt.prompt_id, {
            prompt,
            requestId: message.id,
            identity: {
              threadId: message.params.threadId,
              turnId: message.params.turnId,
              itemId: message.params.itemId,
            },
          });
          this.emit('question_prompt', prompt);
        } catch (error) {
          this._write({
            id: message.id,
            error: { code: -32602, message: 'Remote Agent Chat rejected an incompatible question request.' },
          });
          this.emit('question_error', error);
        }
      } else {
        this.emit('server_request', message);
        this._write({
          id: message.id,
          error: { code: -32601, message: 'Remote Agent Chat has no adapter for this server request.' },
        });
      }
      return;
    }
    if (message?.method) {
      this._settleReceiptWaiters(message, sequence);
      this.emit('notification', message);
    }
  }

  _waitForQuestionReceipt(entry, afterSequence) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.receiptWaiters.delete(waiter);
        reject(new CodexAppServerError(
          'native_question_receipt_timeout',
          'Codex app-server did not acknowledge the exact question request',
        ));
      }, this.questionReceiptTimeoutMs);
      timer.unref?.();
      const waiter = { entry, afterSequence, resolve, reject, timer };
      this.receiptWaiters.add(waiter);
    });
  }

  _settleReceiptWaiters(message, sequence) {
    if (message?.method !== 'serverRequest/resolved') return;
    const params = message.params || {};
    for (const waiter of [...this.receiptWaiters]) {
      if (sequence <= waiter.afterSequence) continue;
      if (String(params.requestId) !== String(waiter.entry.requestId)) continue;
      if (params.threadId !== waiter.entry.identity.threadId) continue;
      clearTimeout(waiter.timer);
      this.receiptWaiters.delete(waiter);
      waiter.resolve({
        method: message.method,
        thread_id: waiter.entry.identity.threadId,
        turn_id: waiter.entry.identity.turnId,
        item_id: waiter.entry.identity.itemId,
        observed_at: new Date().toISOString(),
      });
    }
  }

  _disconnect(code, message) {
    if (this.disconnected) return;
    this.disconnected = true;
    this.started = false;
    const child = this.child;
    this.child = null;
    if (child?.exitCode == null) {
      try { child.kill(); } catch {}
    }
    const error = new CodexAppServerError(code, message);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.receiptWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.receiptWaiters.clear();
    const failedPrompts = this.bridge?.disconnect() || [];
    this.activeQuestions.clear();
    this.emit('disconnect', { code, failedPrompts });
  }
}

module.exports = {
  CodexAppServerConnection,
  CodexAppServerError,
  installedCodexVersion,
  prepareQuestionSchemas,
  resolveCodexInvocation,
};
