'use strict';

const fs = require('fs');
const path = require('path');
const { loadSharedRuntimeContract } = require('./shared-runtime-contract');
const {
  latencyStageDurations,
  normalizeLatencyTraceTerminal,
  summarizeLatencyRows,
} = loadSharedRuntimeContract('latency-trace.js');

class LatencyTraceLedger {
  constructor(filePath, { log = () => {} } = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new TypeError('latency trace ledger path is required');
    }
    this.filePath = path.resolve(filePath);
    this.log = log;
    this.completedTraceIds = new Set();
    this.loadDiagnostics = {
      rows: 0,
      valid_rows: 0,
      malformed_rows: 0,
      duplicate_rows: 0,
    };
    this._hydrateCompletedTraceIds();
  }

  _hydrateCompletedTraceIds() {
    if (!fs.existsSync(this.filePath)) return;
    const text = fs.readFileSync(this.filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.loadDiagnostics.rows += 1;
      try {
        const row = JSON.parse(line);
        const measured = latencyStageDurations(row);
        const terminal = normalizeLatencyTraceTerminal(row);
        const traceId = measured.ok
          ? measured.trace.trace_id
          : (terminal.ok ? terminal.terminal.trace_id : null);
        if (!traceId) {
          this.loadDiagnostics.malformed_rows += 1;
          continue;
        }
        if (this.completedTraceIds.has(traceId)) {
          this.loadDiagnostics.duplicate_rows += 1;
          continue;
        }
        this.completedTraceIds.add(traceId);
        this.loadDiagnostics.valid_rows += 1;
      } catch {
        this.loadDiagnostics.malformed_rows += 1;
      }
    }
    if (this.loadDiagnostics.malformed_rows > 0 || this.loadDiagnostics.duplicate_rows > 0) {
      this.log('warn', 'latency-trace', 'Ledger hydration found invalid rows', {
        ...this.loadDiagnostics,
        path: this.filePath,
      });
    }
  }

  append(trace, { recordedAt = new Date().toISOString() } = {}) {
    const measured = latencyStageDurations(trace);
    if (!measured.ok) return measured;
    const traceId = measured.trace.trace_id;
    if (this.completedTraceIds.has(traceId)) {
      return { ok: true, appended: false, duplicate: true, trace_id: traceId };
    }
    const row = {
      ...measured.trace,
      sample_kind: 'real_webui_send',
      durations_ms: measured.durations,
      raw_durations_ms: measured.raw_durations,
      recorded_at: recordedAt,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
    this.completedTraceIds.add(traceId);
    return { ok: true, appended: true, duplicate: false, trace_id: traceId, row };
  }

  appendTerminal(terminal, { recordedAt = new Date().toISOString() } = {}) {
    const normalized = normalizeLatencyTraceTerminal(terminal);
    if (!normalized.ok) return normalized;
    const traceId = normalized.terminal.trace_id;
    if (this.completedTraceIds.has(traceId)) {
      return { ok: true, appended: false, duplicate: true, trace_id: traceId };
    }
    const row = {
      ...normalized.terminal,
      sample_kind: 'real_webui_send',
      measurement_status: 'unmeasured',
      recorded_at: recordedAt,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
    this.completedTraceIds.add(traceId);
    return { ok: true, appended: true, duplicate: false, trace_id: traceId, row };
  }

  readRows() {
    if (!fs.existsSync(this.filePath)) return [];
    const rows = [];
    for (const line of fs.readFileSync(this.filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (latencyStageDurations(row).ok) rows.push(row);
      } catch {
        // Invalid rows are retained for forensic review but excluded from metrics.
      }
    }
    return rows;
  }

  summarize() {
    return summarizeLatencyRows(this.readRows());
  }
}

module.exports = {
  LatencyTraceLedger,
};
