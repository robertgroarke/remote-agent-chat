#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const { openNative } = require('./codex-desktop-owned-controls-e2e');
const {
  OPERATION_LOCK_PATH,
  acquirePidLock,
} = require('./production-harness-overnight-soak');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    archive: '',
    threadId: '',
    originalThreadId: '',
    output: freshEvidencePath(ROOT, 'codex-desktop-owned-interrupt-race-result.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--archive' && argv[index + 1]) options.archive = path.resolve(argv[++index]);
    else if (arg === '--thread-id' && argv[index + 1]) options.threadId = argv[++index];
    else if (arg === '--original-thread-id' && argv[index + 1]) options.originalThreadId = argv[++index];
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.archive, '--archive is required');
  assert(options.threadId, '--thread-id is required');
  assert(options.originalThreadId, '--original-thread-id is required');
  return options;
}

function summarizeArchive(archivePath) {
  const bytes = fs.readFileSync(archivePath);
  const summary = {
    path: archivePath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    lines: 0,
    task_started: 0,
    task_complete: 0,
    turn_aborted: 0,
    assistant_response_items: 0,
    last_event_at: null,
    last_task_complete_at: null,
  };
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    summary.lines += 1;
    const entry = JSON.parse(line);
    const payload = entry && entry.payload;
    const payloadType = payload && payload.type;
    summary.last_event_at = entry.timestamp || summary.last_event_at;
    if (payloadType === 'task_started') summary.task_started += 1;
    if (payloadType === 'task_complete') {
      summary.task_complete += 1;
      summary.last_task_complete_at = entry.timestamp || summary.last_task_complete_at;
    }
    if (payloadType === 'turn_aborted' || entry.type === 'turn_aborted') summary.turn_aborted += 1;
    if (entry.type === 'response_item' && payloadType === 'message' && payload.role === 'assistant') {
      summary.assistant_response_items += 1;
    }
  }
  return summary;
}

async function inspectThreadRow(Runtime, threadId) {
  return selectors.evalInPage(Runtime, `
    function visible(el) {
      return !!(el && el.isConnected && el.offsetParent !== null);
    }
    var threadId = ${JSON.stringify(threadId)};
    var row = Array.from(d.querySelectorAll('[data-app-action-sidebar-thread-row]')).find(function(candidate) {
      return candidate.getAttribute('data-app-action-sidebar-thread-id') === threadId;
    });
    var spinner = row
      ? Array.from(row.querySelectorAll('[class*="animate-spin"]')).find(visible)
      : null;
    return {
      found: !!row,
      active: !!row && (
        row.getAttribute('data-app-action-sidebar-thread-active') === 'true' ||
        row.getAttribute('aria-current') === 'page'
      ),
      visible_spinner: !!spinner,
    };
  `);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    status: 'audit_failed',
    focus_actions: 0,
    visible_windows_opened: 0,
    app_restarted: false,
    control_mutations: {
      sends: 0,
      thread_switches: 0,
      interrupts: 0,
    },
    interrupt_coverage_proved: false,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  let releaseOperation = null;
  let native = null;
  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-desktop-interrupt-race-audit', kind: 'read-only-audit', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = OPERATION_LOCK_PATH;
    result.archive = summarizeArchive(options.archive);
    native = await openNative();
    const threads = await selectors.readCodexThreadList(native.client.Runtime, true);
    const active = threads.find(thread => thread.active) || null;
    const target = threads.find(thread => thread.id === options.threadId) || null;
    const row = await inspectThreadRow(native.client.Runtime, options.threadId);
    const thinking = await selectors.detectThinking(native.client.Runtime, 'codex-desktop');
    result.native = {
      thread_count: threads.length,
      active_thread_id: active && active.id,
      expected_original_thread_id: options.originalThreadId,
      original_thread_restored: active && active.id === options.originalThreadId,
      disposable_thread_id: options.threadId,
      disposable_thread_found: !!target,
      disposable_thread_active: !!target && !!target.active,
      disposable_row: row,
      current_active_thinking: !!thinking.thinking,
      current_active_thinking_label: String(thinking.label || ''),
    };
    const completedBeforeRecovery = result.archive.task_started === result.archive.task_complete &&
      result.archive.task_started >= 2 && result.archive.turn_aborted === 0;
    assert(completedBeforeRecovery, 'archive does not prove that the owned turn completed before recovery');
    assert(result.native.original_thread_restored, 'operator original thread is not restored');
    assert(result.native.disposable_thread_found, 'owned disposable thread is absent from the native sidebar');
    assert.strictEqual(result.native.disposable_thread_active, false, 'completed disposable thread is unexpectedly active');
    assert.strictEqual(result.native.disposable_row.visible_spinner, false, 'completed disposable thread still has an active spinner');
    result.status = 'external_race_completed_before_recovery';
    result.reason = 'The already-running owned turn completed naturally before recovery could issue an interrupt; no replacement prompt or control was sent.';
    result.ok = true;
    return result;
  } finally {
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
    try { await native?.client?.close(); } catch {}
    try { releaseOperation?.(); } catch {}
  }
}

if (require.main === module) {
  main().then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  inspectThreadRow,
  main,
  parseArgs,
  summarizeArchive,
};
