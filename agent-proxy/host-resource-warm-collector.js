'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const READY_TIMEOUT_MS = 15_000;
const DETAIL_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_CONSECUTIVE_PARSE_FAILURES = 3;
const RESPAWN_BACKOFF_INITIAL_MS = 250;
const RESPAWN_BACKOFF_MAX_MS = 5_000;
const INVALID_LINE_PREFIX_LENGTH = 160;

function collectorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function redactInvalidLinePrefix(value) {
  return String(value || '')
    .slice(0, INVALID_LINE_PREFIX_LENGTH * 4)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\bBearer\s+[^\s",}]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[a-z0-9_-]{8,})/gi, '[redacted-token]')
    .replace(/\b(api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s",}]+/gi, '$1=[redacted]')
    .replace(/(?:[a-z]:\\|\/)(?:users|home)[\\/][^\\/\s"}]+/gi, 'C:\\Users\\[redacted]')
    .replace(/("(?:command_line|executable_path|workspace_path|path)"\s*:\s*")[^"]*/gi, '$1[redacted]')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, INVALID_LINE_PREFIX_LENGTH);
}

function safeId(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
}

class WarmHostResourceCollector {
  constructor(options = {}) {
    this.scriptPath = options.scriptPath || path.join(__dirname, 'host-resource-warm-sampler.ps1');
    this.powershell = options.powershell || path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
    );
    this.spawnProcess = options.spawnProcess || spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.detailTimeoutMs = options.detailTimeoutMs ?? DETAIL_TIMEOUT_MS;
    this.maxConsecutiveParseFailures = Math.max(2, Math.min(
      10, Number(options.maxConsecutiveParseFailures ?? MAX_CONSECUTIVE_PARSE_FAILURES) || MAX_CONSECUTIVE_PARSE_FAILURES,
    ));
    this.respawnBackoffInitialMs = Math.max(
      0, Number(options.respawnBackoffInitialMs ?? RESPAWN_BACKOFF_INITIAL_MS) || 0,
    );
    this.respawnBackoffMaxMs = Math.max(
      this.respawnBackoffInitialMs,
      Number(options.respawnBackoffMaxMs ?? RESPAWN_BACKOFF_MAX_MS) || 0,
    );
    this.random = options.random || Math.random;
    this.now = options.now || Date.now;
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.log = options.log || (() => {});
    this.child = null;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.readyInfo = null;
    this.readyPromise = null;
    this.startPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.pending = new Map();
    this.sequence = 0;
    this.stopping = false;
    this.stopPromise = null;
    this.readyTimer = null;
    this.consecutiveParseFailures = 0;
    this.failureStreak = 0;
    this.nextStartAt = 0;
  }

  _settlePending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  _failReady(error) {
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (this.readyReject) this.readyReject(error);
    this.readyResolve = null;
    this.readyReject = null;
  }

  _handleMessage(message) {
    if (message?.type === 'ready') {
      this.readyInfo = message;
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
      if (this.readyResolve) this.readyResolve(message);
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    const requestId = safeId(message?.request_id);
    const entry = requestId ? this.pending.get(requestId) : null;
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    if (message.type === 'detail' && message.raw && typeof message.raw === 'object') {
      this.failureStreak = 0;
      this.nextStartAt = 0;
      entry.resolve(message);
    } else {
      entry.reject(new Error(message?.message || 'Warm host resource collector failed'));
    }
  }

  _handleStdout(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
    this.buffer += this.decoder.write(bytes);
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this._terminate(collectorError('line_limit', 'Warm host resource collector exceeded its line limit'));
        return;
      }
      try {
        this._handleMessage(JSON.parse(line));
        this.consecutiveParseFailures = 0;
      } catch {
        this.consecutiveParseFailures += 1;
        const prefix = redactInvalidLinePrefix(line);
        this.log('warn', `[resources] Warm collector dropped invalid JSON line `
          + `${this.consecutiveParseFailures}/${this.maxConsecutiveParseFailures}; `
          + `redacted_prefix=${JSON.stringify(prefix)}`);
        if (this.consecutiveParseFailures >= this.maxConsecutiveParseFailures) {
          this._terminate(collectorError(
            'invalid_json_threshold',
            `Warm host resource collector emitted ${this.consecutiveParseFailures} consecutive invalid JSON lines`,
          ));
          return;
        }
      }
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
      this._terminate(collectorError('line_limit', 'Warm host resource collector exceeded its line limit'));
    }
  }

  _registerFailure() {
    if (this.stopping) return;
    this.failureStreak = Math.min(16, this.failureStreak + 1);
    const base = Math.min(
      this.respawnBackoffMaxMs,
      this.respawnBackoffInitialMs * (2 ** Math.max(0, this.failureStreak - 1)),
    );
    const jitter = Math.floor(base * 0.25 * Math.max(0, Math.min(1, Number(this.random()) || 0)));
    this.nextStartAt = this.now() + base + jitter;
  }

  _terminate(error) {
    const child = this.child;
    const active = !!child || !!this.readyPromise;
    this.child = null;
    this.readyInfo = null;
    this.readyPromise = null;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this._failReady(error);
    this._settlePending(error);
    if (active) this._registerFailure();
    if (child && !child.killed) {
      try { child.kill(); } catch {}
    }
  }

  async _spawnAndWait() {
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.consecutiveParseFailures = 0;
    const child = this.spawnProcess(this.powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child = child;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        if (!this.readyReject) return;
        this._terminate(collectorError('startup_timeout', 'Warm host resource collector startup timed out'));
      }, this.readyTimeoutMs);
    });
    child.stdout.on('data', chunk => {
      if (this.child === child) this._handleStdout(chunk);
    });
    child.stdin.on('error', error => {
      if (!this.stopping && this.child === child) this._terminate(error);
    });
    child.once('error', error => {
      if (this.child === child) this._terminate(error);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      const expected = this.stopping;
      this.child = null;
      this.readyInfo = null;
      this.readyPromise = null;
      if (!expected) {
        const error = collectorError(
          'unexpected_exit',
          `Warm host resource collector exited (${code ?? signal ?? 'unknown'})`,
        );
        this._registerFailure();
        this._failReady(error);
        this._settlePending(error);
      }
    });
    return this.readyPromise;
  }

  async start() {
    if (this.stopPromise) await this.stopPromise;
    if (this.child && this.readyPromise) return this.readyPromise;
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    const attempt = (async () => {
      const waitMs = Math.max(0, this.nextStartAt - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      if (this.stopping) throw collectorError('stopped', 'Warm host resource collector stopped');
      return this._spawnAndWait();
    })();
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.startPromise === attempt) this.startPromise = null;
    }
  }

  async collect() {
    await this.start();
    if (!this.child?.stdin?.writable) throw new Error('Warm host resource collector is not writable');
    if (this.pending.size > 0) return [...this.pending.values()][0].promise;
    const requestId = `detail-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      const error = collectorError('detail_timeout', 'Warm host resource collector detail timed out');
      pending.reject(error);
      this._terminate(error);
    }, this.detailTimeoutMs);
    this.pending.set(requestId, { promise, resolve: resolvePromise, reject: rejectPromise, timer });
    this.child.stdin.write(`${JSON.stringify({ type: 'detail', request_id: requestId })}\n`);
    return promise;
  }

  helperPid() {
    return this.child?.pid || null;
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    let child = this.child;
    this.stopping = true;
    if (!child) {
      if (this.startPromise) {
        try { await this.startPromise; } catch {}
      }
      child = this.child;
      if (!child) return;
    }
    this._settlePending(new Error('Warm host resource collector stopped'));
    this.stopPromise = new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, 2_000);
      child.once('exit', finish);
      try { child.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`); } catch { finish(); }
    });
    await this.stopPromise;
    if (this.child === child) this.child = null;
    this.readyInfo = null;
    this.readyPromise = null;
    this.startPromise = null;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.stopPromise = null;
  }
}

module.exports = {
  DETAIL_TIMEOUT_MS,
  INVALID_LINE_PREFIX_LENGTH,
  MAX_LINE_BYTES,
  MAX_CONSECUTIVE_PARSE_FAILURES,
  READY_TIMEOUT_MS,
  RESPAWN_BACKOFF_INITIAL_MS,
  RESPAWN_BACKOFF_MAX_MS,
  WarmHostResourceCollector,
  redactInvalidLinePrefix,
};
