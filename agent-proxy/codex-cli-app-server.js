'use strict';

const { EventEmitter } = require('events');
const { CodexAppServerConnection } = require('./codex-app-server');

const CODEX_SANDBOX_MODES = new Set([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

function optionalString(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text !== 'default' && text !== 'unknown' ? text : null;
}

class CodexCliAppServerTurn extends EventEmitter {
  constructor({
    sessionId,
    cwd,
    connectionFactory = options => new CodexAppServerConnection(options),
    requestTimeoutMs = 120000,
    questionReceiptTimeoutMs = 30000,
  } = {}) {
    super();
    this.sessionId = String(sessionId || '').trim();
    if (!this.sessionId) throw new Error('A Codex CLI app-server turn requires an RAC session ID');
    this.cwd = cwd;
    this.connectionFactory = connectionFactory;
    this.requestTimeoutMs = requestTimeoutMs;
    this.questionReceiptTimeoutMs = questionReceiptTimeoutMs;
    this.connection = null;
    this.threadId = null;
    this.turnId = null;
    this.started = false;
    this.stopping = false;
    this.pendingTurnCompletions = new Map();
    this.completedTurnId = null;
  }

  _emitTurnCompletion(message) {
    const nativeThreadId = String(message?.params?.threadId || '').trim();
    const nativeTurn = message?.params?.turn;
    const nativeTurnId = String(nativeTurn?.id || '').trim();
    if (!nativeThreadId || nativeThreadId !== this.threadId || !nativeTurnId) return false;
    if (!this.turnId) {
      this.pendingTurnCompletions.delete(nativeTurnId);
      this.pendingTurnCompletions.set(nativeTurnId, message);
      while (this.pendingTurnCompletions.size > 8) {
        this.pendingTurnCompletions.delete(this.pendingTurnCompletions.keys().next().value);
      }
      return false;
    }
    if (nativeTurnId !== this.turnId || this.completedTurnId === nativeTurnId) return false;
    this.completedTurnId = nativeTurnId;
    const nativeError = nativeTurn?.error && typeof nativeTurn.error === 'object'
      ? nativeTurn.error
      : null;
    this.emit('turn_completed', {
      thread_id: this.threadId,
      turn_id: this.turnId,
      status: nativeTurn?.status || null,
      ...(nativeError ? {
        error: {
          code: String(nativeError.code || nativeError.type || '').slice(0, 120) || null,
          message: String(nativeError.message || nativeError.text || '').slice(0, 500) || null,
        },
      } : {}),
    });
    return true;
  }

  flushPendingTurnCompletion() {
    if (!this.turnId) return false;
    const pendingCompletion = this.pendingTurnCompletions.get(this.turnId);
    this.pendingTurnCompletions.clear();
    return pendingCompletion ? this._emitTurnCompletion(pendingCompletion) : false;
  }

  async start({
    threadId = null,
    content,
    model = null,
    effort = null,
    sandbox = null,
    clientMessageId = null,
    collaborationMode = null,
  } = {}) {
    if (this.started || this.connection) throw new Error('Codex CLI app-server turn is already active');
    if (typeof content !== 'string' || !content.trim()) throw new Error('Codex CLI app-server turn content is required');
    const requestedModel = optionalString(model);
    const requestedEffort = optionalString(effort);
    const requestedSandbox = CODEX_SANDBOX_MODES.has(sandbox) ? sandbox : null;
    const connection = this.connectionFactory({
      sessionId: this.sessionId,
      cwd: this.cwd,
      clientName: 'remote-agent-chat',
      clientVersion: '1.0.0',
      requestTimeoutMs: this.requestTimeoutMs,
      questionReceiptTimeoutMs: this.questionReceiptTimeoutMs,
    });
    this.connection = connection;
    connection.on('question_prompt', prompt => this.emit('question_prompt', prompt));
    connection.on('question_error', error => this.emit('question_error', error));
    connection.on('server_request', request => this.emit('unsupported_server_request', {
      method: request?.method || null,
    }));
    connection.on('notification', message => {
      this.emit('notification', message);
      if (message?.method !== 'turn/completed') return;
      this._emitTurnCompletion(message);
    });
    connection.on('disconnect', details => {
      this.started = false;
      this.emit('disconnect', { ...details, expected: this.stopping === true });
    });

    try {
      const startup = await connection.start();
      const threadParams = {
        approvalPolicy: 'never',
        ...(requestedModel ? { model: requestedModel } : {}),
        ...(requestedSandbox ? { sandbox: requestedSandbox } : {}),
      };
      const threadResult = threadId
        ? await connection.resumeThread(threadId, threadParams)
        : await connection.startThread({ ...threadParams, ephemeral: false });
      this.threadId = threadResult?.thread?.id;
      if (!this.threadId) throw new Error('Codex app-server did not return the controlled thread ID');
      const effectiveCollaborationMode = collaborationMode === 'plan'
        ? {
          mode: 'plan',
          settings: {
            model: threadResult.model || requestedModel,
            reasoning_effort: requestedEffort || 'medium',
            developer_instructions: null,
          },
        }
        : collaborationMode;
      if (effectiveCollaborationMode?.mode === 'plan' && !effectiveCollaborationMode.settings?.model) {
        throw new Error('Codex app-server did not report a model for Plan collaboration mode');
      }
      const turnResult = await connection.startTurn(this.threadId, content, {
        approvalPolicy: 'never',
        ...(requestedModel ? { model: requestedModel } : {}),
        ...(requestedEffort ? { effort: requestedEffort } : {}),
        ...(clientMessageId ? { clientUserMessageId: clientMessageId } : {}),
        ...(effectiveCollaborationMode ? { collaborationMode: effectiveCollaborationMode } : {}),
      });
      this.turnId = turnResult?.turn?.id;
      if (!this.turnId) throw new Error('Codex app-server did not return the controlled turn ID');
      this.started = true;
      return {
        ok: true,
        codex_cli_version: startup.version,
        thread_id: this.threadId,
        turn_id: this.turnId,
        thread_path: threadResult.thread.path || null,
        model: threadResult.model || requestedModel || null,
        native_receipt: {
          transport: 'codex_app_server',
          thread_id: this.threadId,
          turn_id: this.turnId,
          observed_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.stopping = true;
      try { await connection.stop(); } catch {}
      this.connection = null;
      this.started = false;
      this.pendingTurnCompletions.clear();
      throw error;
    }
  }

  answerQuestion(response) {
    if (!this.connection || !this.started) {
      return Promise.reject(new Error('Codex CLI app-server turn is not active'));
    }
    return this.connection.answerQuestion(response);
  }

  interrupt() {
    if (!this.connection || !this.started || !this.threadId || !this.turnId) {
      return Promise.reject(new Error('Codex CLI app-server turn is not active'));
    }
    return this.connection.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    });
  }

  async stop() {
    if (!this.connection) return;
    const connection = this.connection;
    this.connection = null;
    this.stopping = true;
    this.started = false;
    this.pendingTurnCompletions.clear();
    await connection.stop();
  }
}

module.exports = {
  CodexCliAppServerTurn,
  CODEX_SANDBOX_MODES,
  optionalString,
};
