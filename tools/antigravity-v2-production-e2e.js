#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const live = require('./antigravity-v2-live-e2e');

function parseArgs(argv) {
  const options = {
    sendLive: false,
    allowShortSoak: false,
    skipProfiles: false,
    soakMinutes: 10,
    timeoutMs: 180000,
    relayWsUrl: null,
    conversationId: null,
    runId: crypto.randomBytes(4).toString('hex'),
    progressFile: null,
    resultFile: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--allow-short-soak') options.allowShortSoak = true;
    else if (arg === '--skip-profiles') options.skipProfiles = true;
    else if (arg === '--soak-minutes' && argv[index + 1]) options.soakMinutes = Number(argv[++index]);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Math.max(30000, Number(argv[++index]) || options.timeoutMs);
    else if (arg === '--relay-ws-url' && argv[index + 1]) options.relayWsUrl = argv[++index];
    else if (arg === '--conversation-id' && argv[index + 1]) options.conversationId = argv[++index];
    else if (arg === '--run-id' && argv[index + 1]) options.runId = argv[++index];
    else if (arg === '--progress-file' && argv[index + 1]) options.progressFile = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
  }
  if (!Number.isFinite(options.soakMinutes) || options.soakMinutes <= 0) {
    throw new Error('--soak-minutes must be a positive number');
  }
  if (options.skipProfiles && !options.conversationId) {
    throw new Error('--skip-profiles requires --conversation-id for an owned throwaway conversation');
  }
  return options;
}

function ensureParent(filePath) {
  if (filePath) fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function makeReporter(progressFile) {
  ensureParent(progressFile);
  if (progressFile) fs.writeFileSync(progressFile, '');
  return (event, details = {}) => {
    const record = { at: new Date().toISOString(), event, ...details };
    const line = JSON.stringify(record);
    process.stdout.write(line + '\n');
    if (progressFile) fs.appendFileSync(progressFile, line + '\n');
  };
}

function writeResult(resultFile, value) {
  if (!resultFile) return;
  ensureParent(resultFile);
  fs.writeFileSync(resultFile, JSON.stringify(value, null, 2) + '\n');
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function relayOpen(ws) {
  return ws && ws.readyState === 1;
}

async function openRelayWithRetries(url, report, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const client = await live.openRelay(url, 45000);
      report('relay_open', { attempt, elapsed_ms: Date.now() - startedAt });
      return client;
    } catch (error) {
      lastError = error;
      report('relay_open_retry', { attempt, error: error.message });
      if (attempt < attempts) await sleep(2000);
    }
  }
  throw lastError || new Error('Relay WebSocket did not open');
}

function activityKindsSince(messages, sessionId, startIndex) {
  return live.activityKinds(messages.slice(startIndex), sessionId);
}

async function sendTurn({ ws, messages, sessionId, runId, name, prompt, token, timeoutMs }) {
  if (!relayOpen(ws)) throw new Error(`Relay closed before ${name}`);
  const startIndex = messages.length;
  const clientMessageId = `ag-v2-production-${runId}-${name}`;
  ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: clientMessageId }));
  await live.waitFor(
    () => messages.slice(startIndex).find(message => message.type === 'message_accepted' && message.client_message_id === clientMessageId),
    30000,
    `${name} message_accepted`,
  );
  const sendResult = await live.waitFor(
    () => messages.slice(startIndex).find(message => message.type === 'proxy_send_result' && message.client_message_id === clientMessageId),
    60000,
    `${name} proxy_send_result`,
  );
  if (sendResult.result !== 'delivered') {
    throw new Error(`${name} delivery was ${sendResult.result}: ${JSON.stringify(sendResult.error || sendResult)}`);
  }
  await live.waitFor(
    () => live.messagesFor(messages, sessionId).some(message => message.role === 'user' && String(message.content || '').includes(token)),
    60000,
    `${name} user echo`,
  );
  const workingKind = await live.waitFor(
    () => activityKindsSince(messages, sessionId, startIndex).find(kind =>
      ['thinking', 'generating', 'working', 'running_command', 'reading_files'].includes(kind)
    ),
    60000,
    `${name} working activity`,
  );
  await live.waitFor(
    () => live.messagesFor(messages, sessionId).some(message => message.role === 'assistant' && String(message.content || '').includes(token)),
    timeoutMs,
    `${name} assistant token`,
  );
  await live.waitFor(() => {
    const kinds = activityKindsSince(messages, sessionId, startIndex);
    const workingIndex = kinds.findIndex(kind => kind === workingKind ||
      ['thinking', 'generating', 'working', 'running_command', 'reading_files'].includes(kind));
    return workingIndex >= 0 && kinds.slice(workingIndex + 1).includes('idle');
  }, 60000, `${name} final idle`);
  return { startIndex, clientMessageId, workingKind };
}

async function waitForExactParity(messages, sessionId, label, timeoutMs = 60000) {
  let lastMismatch = null;
  try {
    return await live.waitFor(async () => {
      const nativeMessages = await live.readNativeMessages(sessionId);
      const webuiMessages = live.messagesFor(messages, sessionId);
      try {
        live.assertOrderedTranscriptMatch(nativeMessages, webuiMessages, label);
        live.assertContentBlocksMatch(nativeMessages, webuiMessages);
        return { nativeMessages, webuiMessages };
      } catch (error) {
        lastMismatch = error;
        return null;
      }
    }, timeoutMs, `${label} exact native/WebUI parity`);
  } catch (error) {
    if (lastMismatch) {
      throw new Error(`${error.message}; last mismatch: ${lastMismatch.message}`);
    }
    throw error;
  }
}

function readLogOffset(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function readLogTail(filePath, offset) {
  try {
    const bytes = fs.readFileSync(filePath);
    return bytes.subarray(Math.min(offset, bytes.length)).toString('utf8');
  } catch {
    return '';
  }
}

function selectorFailuresInTail(text, sessionId) {
  return String(text || '').split(/\r?\n/).filter(line => {
    if (!line) return false;
    const belongsToSurface = line.includes(sessionId) || /antigravity-v2/i.test(line);
    return belongsToSurface && /selector.?fail|read (?:null|error)|\[sel\].*(?:error|null)/i.test(line);
  });
}

async function runProfile(options, profile, runId, report) {
  report('profile_start', { profile, run_id: runId });
  const args = [
    '--send-live',
    '--skip-mutation-lock',
    '--run-id', runId,
    '--timeout-ms', String(options.timeoutMs),
    '--prompt-profile', profile,
  ];
  if (options.relayWsUrl) args.push('--relay-ws-url', options.relayWsUrl);
  const result = await live.main(args);
  report('profile_pass', {
    profile,
    run_id: runId,
    conversation_id: result.owned_conversation_id,
    native_messages: result.final_native_count,
    tool_blocks: result.native_tool_block_count,
  });
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.sendLive) throw new Error('Refusing live production mutation without --send-live');
  if (options.soakMinutes < 10 && !options.allowShortSoak) {
    throw new Error('Production soak must be at least 10 minutes; use --allow-short-soak only for script development');
  }

  const runId = options.runId.replace(/[^A-Za-z0-9_-]/g, '');
  const report = makeReporter(options.progressFile);
  const proxyLog = path.join(__dirname, '..', 'proxy.log');
  const proxyErrLog = path.join(__dirname, '..', 'proxy-err.log');
  const logOffsets = { proxy: readLogOffset(proxyLog), error: readLogOffset(proxyErrLog) };
  const profileResults = {};
  const soakTurns = [];
  const checkpoints = [];
  const startedAt = Date.now();
  let client = null;
  let releaseMutationLock = null;

  try {
    releaseMutationLock = live.acquireMutationLock(`production-${runId}`);
    report('start', { run_id: runId, soak_minutes: options.soakMinutes, skip_profiles: options.skipProfiles });
    let conversationId = options.conversationId;
    if (!options.skipProfiles) {
      profileResults.single_line = await runProfile(options, 'single-line', `${runId}single`, report);
      profileResults.code_input = await runProfile(options, 'code-input', `${runId}code`, report);
      profileResults.multi_turn_tool = await runProfile(options, 'multi-turn-tool', `${runId}tool`, report);
      conversationId = profileResults.multi_turn_tool.owned_conversation_id;
    }

    const relayUrl = live.deriveRelayWsUrl(options.relayWsUrl);
    client = await openRelayWithRetries(relayUrl, report);
    const { ws, messages } = client;
    const session = await live.waitFor(
      () => live.latestSessions(messages).find(item => live.agentTypeOf(item) === 'antigravity-v2'),
      30000,
      'antigravity-v2 session',
    );
    const sessionId = live.sessionIdOf(session);

    const switchRequestId = `ag-v2-production-switch-${runId}`;
    ws.send(JSON.stringify({ type: 'switch_chat', session_id: sessionId, chat_id: conversationId, request_id: switchRequestId }));
    const switchResult = await live.waitFor(
      () => live.controlResult(messages, switchRequestId, 'switch_chat'),
      30000,
      'production switch_chat result',
    );
    if (switchResult.result !== 'ok') throw new Error(`switch_chat failed: ${JSON.stringify(switchResult)}`);
    await live.waitFor(async () => {
      const state = await live.readNativeState(sessionId);
      return state.active?.conversation_id === conversationId ? state : null;
    }, 30000, 'exact owned production conversation');
    const historyStart = messages.length;
    ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));
    await live.waitFor(() => messages.slice(historyStart).find(message =>
      (message.type === 'history' || message.type === 'history_snapshot') &&
      (message.session || message.session_id) === sessionId
    ), 30000, 'fresh production conversation history');
    await waitForExactParity(messages, sessionId, 'production conversation before soak', options.timeoutMs);
    report('owned_conversation', { session_id: sessionId, conversation_id: conversationId });
    report('interrupt_gated', { advertised: false, reason: 'no deterministic conversation-scoped Stop control' });

    const soakStartedAt = Date.now();
    const soakDurationMs = options.soakMinutes * 60 * 1000;
    const soakDeadline = soakStartedAt + soakDurationMs;
    const midpointAt = soakStartedAt + soakDurationMs / 2;
    let midpointReported = false;
    let turn = 0;
    while (Date.now() < soakDeadline) {
      turn += 1;
      const turnToken = `RAC_V2_SOAK_${runId}_${String(turn).padStart(2, '0')}`;
      const turnStartedAt = Date.now();
      await sendTurn({
        ws,
        messages,
        sessionId,
        runId,
        name: `soak-${turn}`,
        token: turnToken,
        timeoutMs: options.timeoutMs,
        prompt: `Active soak turn ${turn}. Reply with exactly ${turnToken} and nothing else.`,
      });
      const parity = await waitForExactParity(messages, sessionId, `soak turn ${turn}`, options.timeoutMs);
      const turnEvidence = {
        turn,
        token: turnToken,
        elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
        native_messages: parity.nativeMessages.length,
        webui_messages: parity.webuiMessages.length,
      };
      soakTurns.push(turnEvidence);
      report('soak_turn_pass', turnEvidence);

      if (!midpointReported && Date.now() >= midpointAt) {
        midpointReported = true;
        const checkpoint = { kind: 'midpoint', elapsed_seconds: turnEvidence.elapsed_seconds, turn };
        checkpoints.push(checkpoint);
        report('checkpoint', checkpoint);
      }
      const nextTurnAt = Math.min(soakDeadline, turnStartedAt + 60000);
      while (Date.now() < nextTurnAt) {
        if (!relayOpen(ws)) throw new Error('Relay disconnected during soak wait');
        await sleep(Math.min(5000, nextTurnAt - Date.now()));
      }
    }

    const finalParity = await waitForExactParity(messages, sessionId, 'soak final', options.timeoutMs);
    const finalCheckpoint = {
      kind: 'final',
      elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
      turn,
      native_messages: finalParity.nativeMessages.length,
      webui_messages: finalParity.webuiMessages.length,
    };
    checkpoints.push(finalCheckpoint);
    report('checkpoint', finalCheckpoint);

    const selectorFailures = [
      ...selectorFailuresInTail(readLogTail(proxyLog, logOffsets.proxy), sessionId),
      ...selectorFailuresInTail(readLogTail(proxyErrLog, logOffsets.error), sessionId),
    ];
    if (selectorFailures.length) {
      throw new Error(`Selector failures appeared during production sweep: ${JSON.stringify(selectorFailures)}`);
    }

    const result = {
      ok: true,
      run_id: runId,
      session_id: sessionId,
      owned_conversation_id: conversationId,
      profile_results: profileResults,
      interrupt_advertised: false,
      soak_minutes_requested: options.soakMinutes,
      soak_elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
      soak_turns: soakTurns,
      checkpoints,
      selector_failures: selectorFailures,
      total_elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    writeResult(options.resultFile, result);
    report('complete', { ok: true, total_elapsed_seconds: result.total_elapsed_seconds });
    return result;
  } catch (error) {
    const result = {
      ok: false,
      run_id: runId,
      error: error.message,
      profile_results: profileResults,
      soak_turns: soakTurns,
      checkpoints,
      total_elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    writeResult(options.resultFile, result);
    report('failed', { error: error.message });
    throw error;
  } finally {
    live.closeRelay(client);
    if (releaseMutationLock) releaseMutationLock();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
