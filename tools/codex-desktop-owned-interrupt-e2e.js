#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const production = require('./vscode-extension-production-e2e');
const {
  nativeState,
  openNative,
  requestConfig,
  restoreOriginal,
  send,
} = require('./codex-desktop-owned-controls-e2e');
const { inspectThreadRow, summarizeArchive } = require('./codex-desktop-owned-interrupt-race-audit');
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
    output: freshEvidencePath(ROOT, 'codex-desktop-owned-interrupt-result.json'),
    marker: '',
    recoverActive: false,
    sendLive: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--recover-active') options.recoverActive = true;
    else if (arg === '--archive' && argv[index + 1]) options.archive = path.resolve(argv[++index]);
    else if (arg === '--thread-id' && argv[index + 1]) options.threadId = argv[++index];
    else if (arg === '--original-thread-id' && argv[index + 1]) options.originalThreadId = argv[++index];
    else if (arg === '--marker' && argv[index + 1]) options.marker = argv[++index];
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert.notStrictEqual(options.sendLive, options.recoverActive, 'Choose exactly one of --send-live or --recover-active');
  if (options.recoverActive) assert(options.marker, '--marker is required with --recover-active');
  assert(options.archive, '--archive is required');
  assert(options.threadId, '--thread-id is required');
  assert(options.originalThreadId, '--original-thread-id is required');
  return options;
}

function safeArchiveSummary(archivePath) {
  try {
    return summarizeArchive(archivePath);
  } catch (error) {
    if (!/Unexpected end of JSON input/.test(String(error && error.message))) throw error;
    return null;
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runId = Date.now().toString(36);
  const result = {
    ok: false,
    generated_at: new Date().toISOString(),
    run_id: runId,
    focus_actions: 0,
    visible_windows_opened: 0,
    app_restarted: false,
    stages: [],
    control_mutations: {
      sends: 0,
      thread_switches: 0,
      interrupts: 0,
    },
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  let releaseOperation = null;
  let native = null;
  let relay = null;
  let sessionId = '';
  let switchedAway = false;
  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({ pid: process.pid, agent: 'codex-desktop-owned-interrupt', kind: 'owned-mutation', acquired_at: new Date().toISOString() })}\n`,
    );
    result.operation_lock = OPERATION_LOCK_PATH;
    result.stages.push('operation_lock');

    native = await openNative();
    relay = await production.openRelay();
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.agent_type === 'codex-desktop' && item.status !== 'disconnected'),
      30000,
      'connected Codex Desktop relay session',
    );
    sessionId = session.session_id;
    result.session_id = sessionId;

    const baseline = await nativeState(native, sessionId);
    assert.strictEqual(baseline.active?.id, options.originalThreadId, 'unexpected active Codex Desktop thread');
    assert.strictEqual(baseline.thinking?.thinking, false, 'operator original thread is active; refusing owned mutation');
    assert(baseline.threads.some(thread => thread.id === options.threadId), 'owned disposable thread is absent');
    result.original_thread = { id: baseline.active.id, title: baseline.active.title || '' };
    result.archive_before = summarizeArchive(options.archive);
    result.stages.push('idle_guard');

    const config = await requestConfig(relay, sessionId);
    assert.strictEqual(config.capabilities?.switch_thread, true, 'Codex Desktop did not advertise switch_thread');
    assert.strictEqual(config.capabilities?.interrupt, true, 'Codex Desktop did not advertise interrupt');
    result.stages.push('capabilities');

    await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
      thread_id: options.threadId,
    });
    result.control_mutations.thread_switches += 1;
    switchedAway = true;
    let marker = options.marker;
    if (options.recoverActive) {
      assert(
        result.archive_before.task_started > result.archive_before.task_complete,
        'native archive does not contain an active owned turn to recover',
      );
      result.stages.push('owned_active_recovery');
    } else {
      const disposable = await production.waitFor(async () => {
        const state = await nativeState(native, sessionId);
        return state.active?.id === options.threadId && !state.thinking?.thinking ? state : null;
      }, 30000, 'idle owned Codex Desktop disposable thread', 100);
      result.disposable_thread = {
        id: disposable.active.id,
        title: disposable.active.title || '',
        baseline_messages: disposable.messages.length,
      };
      result.stages.push('owned_thread');

      marker = `RAC_CODEX_DESKTOP_INTERRUPT_ONLY_${runId.toUpperCase()}`;
      const prompt = `Write 3000 numbered one-sentence descriptions of distinct fictional software test cases. Put ${marker} only in item 3000. Do not use tools.`;
      await send(relay, sessionId, prompt, `codex-desktop-owned-interrupt-only-${runId}`);
      result.control_mutations.sends += 1;
      result.stages.push('persisted_send');
    }

    const active = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      if (!state.thinking?.thinking || state.active?.id !== options.threadId) return null;
      const row = await inspectThreadRow(native.client.Runtime, options.threadId);
      return { state, row };
    }, 30000, 'Codex Desktop active before interrupt', 100);
    result.thinking_observation = {
      thinking: true,
      label: String(active.state.thinking.label || ''),
      active_row_spinner: !!active.row.visible_spinner,
      active_thread_exact: active.state.active.id === options.threadId,
    };
    result.stages.push('active_observed');

    const interruptStarted = Date.now();
    await production.control(relay.ws, relay.messages, sessionId, 'agent_interrupt');
    result.control_mutations.interrupts += 1;
    const interrupted = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      const row = await inspectThreadRow(native.client.Runtime, options.threadId);
      return state.active?.id === options.threadId && !state.thinking?.thinking && !row.visible_spinner
        ? { state, row }
        : null;
    }, 60000, 'Codex Desktop idle after interrupt', 100);
    assert(!interrupted.state.messages.some(message =>
      message.role === 'assistant' && String(message.content || '').includes(marker)),
    'interrupt marker completed instead of stopping');
    result.interrupt = {
      marker,
      elapsed_ms: Date.now() - interruptStarted,
      messages_after: interrupted.state.messages.length,
      active_row_spinner_after: interrupted.row.visible_spinner,
    };
    result.stages.push('interrupt');

    const archiveAfter = await production.waitFor(() => {
      const summary = safeArchiveSummary(options.archive);
      if (!summary) return null;
      const aborted = summary.turn_aborted > result.archive_before.turn_aborted;
      const started = options.recoverActive || summary.task_started > result.archive_before.task_started;
      return started && aborted ? summary : null;
    }, 30000, 'Codex Desktop native archive abort', 100);
    result.archive_after = archiveAfter;
    result.archive_delta = {
      task_started: archiveAfter.task_started - result.archive_before.task_started,
      task_complete: archiveAfter.task_complete - result.archive_before.task_complete,
      turn_aborted: archiveAfter.turn_aborted - result.archive_before.turn_aborted,
      assistant_response_items: archiveAfter.assistant_response_items - result.archive_before.assistant_response_items,
    };
    result.stages.push('native_abort');

    await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
      thread_id: options.originalThreadId,
    });
    result.control_mutations.thread_switches += 1;
    const restored = await production.waitFor(async () => {
      const state = await nativeState(native, sessionId);
      return state.active?.id === options.originalThreadId ? state : null;
    }, 30000, 'original Codex Desktop thread after interrupt', 100);
    result.restored_thread = { id: restored.active.id, title: restored.active.title || '' };
    result.original_thread_restored = true;
    switchedAway = false;
    result.stages.push('restore');
    result.ok = true;
    return result;
  } catch (error) {
    result.error = error.stack || error.message;
    throw error;
  } finally {
    if (native && switchedAway) {
      try {
        result.original_thread_restored = await restoreOriginal(
          native,
          relay,
          sessionId,
          options.originalThreadId,
        );
        if (result.original_thread_restored) result.control_mutations.thread_switches += 1;
      } catch {}
    }
    result.finished_at = new Date().toISOString();
    try { fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); } catch {}
    try { relay?.ws?.close(); } catch {}
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
  main,
  parseArgs,
  safeArchiveSummary,
};
