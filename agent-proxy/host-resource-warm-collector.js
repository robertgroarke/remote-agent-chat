'use strict';

const path = require('path');
const { spawn } = require('child_process');

const READY_TIMEOUT_MS = 8_000;
const DETAIL_TIMEOUT_MS = 4_000;
const MAX_LINE_BYTES = 4 * 1024 * 1024;

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
    this.readyTimeoutMs = options.readyTimeoutMs || READY_TIMEOUT_MS;
    this.detailTimeoutMs = options.detailTimeoutMs || DETAIL_TIMEOUT_MS;
    this.log = options.log || (() => {});
    this.child = null;
    this.buffer = '';
    this.readyInfo = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.pending = new Map();
    this.sequence = 0;
    this.stopping = false;
    this.stopPromise = null;
    this.readyTimer = null;
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
      entry.resolve(message);
    } else {
      entry.reject(new Error(message?.message || 'Warm host resource collector failed'));
    }
  }

  _handleStdout(chunk) {
    this.buffer += String(chunk || '');
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
      this._terminate(new Error('Warm host resource collector exceeded its line limit'));
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try { this._handleMessage(JSON.parse(line)); } catch {
        this._terminate(new Error('Warm host resource collector emitted invalid JSON'));
        return;
      }
    }
  }

  _terminate(error) {
    const child = this.child;
    this.child = null;
    this.readyInfo = null;
    this.readyPromise = null;
    this._failReady(error);
    this._settlePending(error);
    if (child && !child.killed) {
      try { child.kill(); } catch {}
    }
  }

  async start() {
    if (this.stopPromise) await this.stopPromise;
    if (this.child && this.readyPromise) return this.readyPromise;
    this.stopping = false;
    this.buffer = '';
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
        this._terminate(new Error('Warm host resource collector startup timed out'));
      }, this.readyTimeoutMs);
    });
    child.stdout.on('data', chunk => this._handleStdout(chunk));
    child.stdin.on('error', error => {
      if (!this.stopping) this._terminate(error);
    });
    child.once('error', error => this._terminate(error));
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      const expected = this.stopping;
      this.child = null;
      this.readyInfo = null;
      this.readyPromise = null;
      if (!expected) {
        const error = new Error(`Warm host resource collector exited (${code ?? signal ?? 'unknown'})`);
        this._failReady(error);
        this._settlePending(error);
      }
    });
    return this.readyPromise;
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
      pending.reject(new Error('Warm host resource detail timed out'));
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
    const child = this.child;
    if (!child) return;
    this.stopping = true;
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
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.stopPromise = null;
  }
}

module.exports = {
  DETAIL_TIMEOUT_MS,
  MAX_LINE_BYTES,
  READY_TIMEOUT_MS,
  WarmHostResourceCollector,
};
