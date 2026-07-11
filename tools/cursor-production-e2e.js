#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const CDP_PORT = 9227;

function parseArgs(argv) {
  const options = {
    sendLive: false,
    allowShortSoak: false,
    keepOwned: false,
    interruptDelayMs: 0,
    soakMinutes: 10,
    soakIntervalMs: 60000,
    soakTurnLimit: 0,
    timeoutMs: 180000,
    runId: crypto.randomBytes(4).toString('hex'),
    progressFile: null,
    resultFile: null,
    evidenceDir: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--allow-short-soak') options.allowShortSoak = true;
    else if (arg === '--keep-owned') options.keepOwned = true;
    else if (arg === '--interrupt-delay-ms' && argv[index + 1]) options.interruptDelayMs = Math.max(0, Number(argv[++index]) || 0);
    else if (arg === '--soak-minutes' && argv[index + 1]) options.soakMinutes = Number(argv[++index]);
    else if (arg === '--soak-interval-ms' && argv[index + 1]) options.soakIntervalMs = Math.max(0, Number(argv[++index]) || 0);
    else if (arg === '--soak-turn-limit' && argv[index + 1]) options.soakTurnLimit = Math.max(0, Math.floor(Number(argv[++index]) || 0));
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Math.max(30000, Number(argv[++index]) || options.timeoutMs);
    else if (arg === '--run-id' && argv[index + 1]) options.runId = argv[++index];
    else if (arg === '--progress-file' && argv[index + 1]) options.progressFile = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else if (arg === '--evidence-dir' && argv[index + 1]) options.evidenceDir = path.resolve(argv[++index]);
  }
  if (!Number.isFinite(options.soakMinutes) || options.soakMinutes <= 0) {
    throw new Error('--soak-minutes must be positive');
  }
  if (!options.allowShortSoak && (options.soakIntervalMs !== 60000 || options.soakTurnLimit > 0)) {
    throw new Error('Accelerated soak options require --allow-short-soak and cannot be used for production');
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

async function waitFor(predicate, timeoutMs, label, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = url => token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

async function openRelay() {
  const ws = new WebSocket(deriveRelayWsUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay WebSocket timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'cursor-production-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function latestSessions(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if ((message.type === 'connection_ack' || message.type === 'session_list' || message.type === 'session_snapshot')
      && Array.isArray(message.sessions)) return message.sessions;
  }
  return [];
}

function sessionIdOf(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

function activityKinds(messages, sessionId, startIndex = 0) {
  return messages.slice(startIndex).filter(message =>
    ['status', 'proxy_status', 'session_status'].includes(message.type)
    && (message.session || message.session_id) === sessionId
  ).map(message => message.activity?.kind || (message.thinking ? 'thinking' : '')).filter(Boolean);
}

function historyEvent(messages, startIndex, sessionId, requestId = null) {
  return messages.slice(startIndex).find(message =>
    (message.type === 'history' || message.type === 'history_snapshot')
    && (message.session || message.session_id) === sessionId
    && (!requestId || message.request_id === requestId)
    && Array.isArray(message.messages));
}

async function probePage() {
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'No guarded cursor-test CDP target');
  guard.assertProbeTarget(page, __filename);
  return page;
}

async function readNative(page) {
  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  try {
    const [raw, agents, thinking] = await Promise.all([
      cursorSel.readCursorMessages(client.Runtime),
      cursorSel.readCursorAgentList(client.Runtime),
      cursorSel.detectCursorThinking(client.Runtime),
    ]);
    return { messages: JSON.parse(raw || '[]'), agents, thinking };
  } finally {
    await client.close();
  }
}

async function captureNative(page, outputPath, expectedAgentId = '') {
  if (!outputPath) return null;
  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  await client.Page.enable();
  try {
    if (expectedAgentId) {
      const agents = await cursorSel.readCursorAgentList(client.Runtime);
      const active = agents.filter(agent => agent && agent.active);
      if (active.length !== 1 || active[0].id !== expectedAgentId) {
        throw new Error(`Native checkpoint active-agent mismatch: ${JSON.stringify(active)}`);
      }
    }
    const shot = await client.Page.captureScreenshot({ format: 'png', fromSurface: true, captureBeyondViewport: false });
    ensureParent(outputPath);
    fs.writeFileSync(outputPath, Buffer.from(shot.data, 'base64'));
    return outputPath;
  } finally {
    await client.close();
  }
}

function normalized(messages) {
  return fidelity.normalizeMessages(messages || [], null);
}

function accumulatedTailMatches(nativeNormalized, relayNormalized) {
  if (nativeNormalized.length > relayNormalized.length) return false;
  let relayIndex = 0;
  for (const nativeMessage of nativeNormalized) {
    const nativeContent = String(nativeMessage.content || '').trim();
    let matchedIndex = -1;
    for (; relayIndex < relayNormalized.length; relayIndex++) {
      const relayMessage = relayNormalized[relayIndex];
      if (!relayMessage || nativeMessage.role !== relayMessage.role) continue;
      const relayContent = String(relayMessage.content || '').trim();
      const exact = nativeContent === relayContent;
      // Cursor can virtualize either an entire historical assistant block or
      // only its opening DOM blocks. User turns remain exact; assistant turns
      // may match only a complete retained-content suffix.
      const assistantSuffix = nativeMessage.role === 'assistant'
        && nativeContent.length > 0
        && relayContent.endsWith(nativeContent);
      if (exact || assistantSuffix) {
        matchedIndex = relayIndex;
        relayIndex++;
        break;
      }
    }
    if (matchedIndex < 0) return false;
  }
  // Native may omit historical relay messages, but it must still reach the
  // newest relay message; otherwise a stale native window could pass.
  return nativeNormalized.length === 0
    ? relayNormalized.length === 0
    : relayIndex === relayNormalized.length;
}

async function assertParity(ws, relayMessages, sessionId, page, label, timeoutMs, options = {}) {
  let last = null;
  try {
    return await waitFor(async () => {
      const startIndex = relayMessages.length;
      const requestId = `cursor-production-history-${crypto.randomBytes(4).toString('hex')}`;
      ws.send(JSON.stringify({ type: 'get_history', session: sessionId, request_id: requestId, limit: 1000 }));
      const history = await waitFor(() => historyEvent(relayMessages, startIndex, sessionId, requestId), 15000, `${label} history`);
      const native = await readNative(page);
      const nativeNormalized = normalized(native.messages);
      const relayNormalized = normalized(history.messages);
      const exact = JSON.stringify(nativeNormalized) === JSON.stringify(relayNormalized);
      const nativeIsRelaySuffix = options.allowAccumulatedPrefix === true
        && accumulatedTailMatches(nativeNormalized, relayNormalized);
      if (exact || nativeIsRelaySuffix) {
        return { native, relayMessages: history.messages };
      }
      last = `native=${nativeNormalized.length} relay=${relayNormalized.length}`;
      return null;
    }, timeoutMs, `${label} exact native/relay parity`, 1000);
  } catch (error) {
    throw new Error(`${error.message}${last ? `; last ${last}` : ''}`);
  }
}

async function switchAgent(ws, relayMessages, sessionId, page, agentId, label) {
  if (ws.readyState !== WebSocket.OPEN) throw new Error(`Relay closed before ${label}`);
  const startIndex = relayMessages.length;
  const requestId = `cursor-production-switch-${crypto.randomBytes(4).toString('hex')}`;
  ws.send(JSON.stringify({ type: 'switch_thread', session_id: sessionId, thread_id: agentId, request_id: requestId }));
  const result = await waitFor(() => relayMessages.slice(startIndex).find(message =>
    message.type === 'agent_control_result' && message.request_id === requestId), 30000, `${label} switch result`);
  if (result.result !== 'ok') throw new Error(`${label} switch failed: ${JSON.stringify(result)}`);
  return waitFor(async () => {
    const native = await readNative(page);
    const active = native.agents.filter(agent => agent && agent.active);
    return active.length === 1 && active[0].id === agentId ? native : null;
  }, 30000, `${label} exact active agent`);
}

async function sendTurn({
  ws,
  relayMessages,
  sessionId,
  page,
  prompt,
  token,
  name,
  timeoutMs,
  requireWorking,
  allowAccumulatedPrefix = false,
  requiredRelayTokens = [],
  minimumRelayMessages = 0,
  expectedRelayMessages = 0,
}) {
  if (ws.readyState !== WebSocket.OPEN) throw new Error(`Relay closed before ${name}`);
  const startIndex = relayMessages.length;
  const clientMessageId = `cursor-production-${name}-${crypto.randomBytes(3).toString('hex')}`;
  ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: clientMessageId }));
  await waitFor(() => relayMessages.slice(startIndex).find(message =>
    message.type === 'message_accepted' && message.client_message_id === clientMessageId), 30000, `${name} accepted`);
  const delivered = await waitFor(() => relayMessages.slice(startIndex).find(message =>
    message.type === 'proxy_send_result' && message.client_message_id === clientMessageId), 60000, `${name} delivered`);
  if (delivered.result !== 'delivered') throw new Error(`${name} delivery failed: ${JSON.stringify(delivered)}`);

  await waitFor(async () => {
    const native = await readNative(page);
    return native.messages.some(message => message.role === 'user' && String(message.content || '').includes(token));
  }, 60000, `${name} native user token`);

  let workingKind = null;
  if (requireWorking) {
    workingKind = await waitFor(async () => {
      const kinds = activityKinds(relayMessages, sessionId, startIndex);
      const kind = kinds.find(value => ['thinking', 'generating', 'working', 'running_command', 'reading_files'].includes(value));
      if (kind) return kind;
      const native = await readNative(page);
      return native.thinking?.thinking ? 'native-generating' : null;
    }, 60000, `${name} working activity`);
  }

  await waitFor(async () => {
    const native = await readNative(page);
    return native.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token));
  }, timeoutMs, `${name} assistant token`);
  await waitFor(async () => {
    const native = await readNative(page);
    return !native.thinking?.thinking ? native : null;
  }, 60000, `${name} native idle`);
  const parity = await assertParity(ws, relayMessages, sessionId, page, name, timeoutMs, { allowAccumulatedPrefix });
  const relayText = parity.relayMessages.map(message => String(message.content || '')).join('\n');
  const missingTokens = requiredRelayTokens.filter(required => !relayText.includes(required));
  if (missingTokens.length) throw new Error(`${name} relay history lost continuity tokens: ${missingTokens.join(', ')}`);
  if (minimumRelayMessages && parity.relayMessages.length < minimumRelayMessages) {
    throw new Error(`${name} relay history truncated: ${parity.relayMessages.length} < ${minimumRelayMessages}`);
  }
  if (expectedRelayMessages && parity.relayMessages.length !== expectedRelayMessages) {
    throw new Error(`${name} relay history count mismatch: ${parity.relayMessages.length} !== ${expectedRelayMessages}`);
  }
  return { workingKind, parity };
}

async function interruptActiveTurn({
  ws,
  relayMessages,
  sessionId,
  page,
  runId,
  timeoutMs,
  delayMs = 0,
  report = null,
  requiredRelayTokens = [],
  ownedAgentId,
}) {
  const token = `RAC_CURSOR_INTERRUPT_${runId}`;
  const startIndex = relayMessages.length;
  const clientMessageId = `cursor-production-interrupt-${runId}`;
  const prompt = `Begin a detailed numbered list of 500 distinct JavaScript facts. Include ${token} in the final item only. Do not use tools.`;
  ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: clientMessageId }));
  await waitFor(() => relayMessages.slice(startIndex).find(message =>
    message.type === 'proxy_send_result' && message.client_message_id === clientMessageId && message.result === 'delivered'),
  60000, 'interrupt prompt delivery');
  await waitFor(async () => {
    const native = await readNative(page);
    return native.messages.some(message => message.role === 'user' && String(message.content || '').includes(token));
  }, 60000, 'interrupt native user token');
  const observedWorking = await waitFor(async () => {
    const kinds = activityKinds(relayMessages, sessionId, startIndex);
    const kind = kinds.find(value => ['thinking', 'generating', 'working'].includes(value));
    if (kind) return kind;
    const native = await readNative(page);
    return native.thinking?.thinking ? 'native-generating' : null;
  }, 60000, 'interrupt precondition generating');
  if (typeof report === 'function') report('interrupt_ready', { observed_working: observedWorking, delay_ms: delayMs });
  if (delayMs > 0) await sleep(delayMs);

  const requestId = `cursor-production-interrupt-control-${runId}`;
  ws.send(JSON.stringify({ type: 'agent_interrupt', session_id: sessionId, request_id: requestId }));
  const result = await waitFor(() => relayMessages.slice(startIndex).find(message =>
    message.type === 'agent_control_result' && message.request_id === requestId), 60000, 'interrupt control result');
  if (result.result !== 'ok') throw new Error(`Interrupt failed: ${JSON.stringify(result)}`);
  await waitFor(async () => {
    const native = await readNative(page);
    return !native.thinking?.thinking ? native : null;
  }, 60000, 'native idle after interrupt');
  const finalIdle = await waitFor(() => {
    const kinds = activityKinds(relayMessages, sessionId, startIndex);
    return kinds.includes('idle') ? 'idle' : null;
  }, 60000, 'relay idle after interrupt');
  // Cursor may return focus to the previously active editor after Stop/Escape,
  // especially when the interrupted prompt temporarily retitles the agent.
  // Re-select the exact owned agent before comparing its settled transcript.
  if (ownedAgentId) {
    await switchAgent(ws, relayMessages, sessionId, page, ownedAgentId, 'owned post-interrupt restore');
  }
  const parity = await assertParity(ws, relayMessages, sessionId, page, 'interrupt settle', timeoutMs, { allowAccumulatedPrefix: true });
  const relayText = parity.relayMessages.map(message => String(message.content || '')).join('\n');
  const missingTokens = requiredRelayTokens.filter(required => !relayText.includes(required));
  if (missingTokens.length) throw new Error(`Interrupt relay history lost continuity tokens: ${missingTokens.join(', ')}`);
  if (parity.native.messages.some(message => message.role === 'assistant' && String(message.content || '').includes(token))) {
    throw new Error('Cursor completed the interrupt marker instead of stopping generation');
  }
  return { token, observedWorking, finalIdle, nativeMessages: parity.native.messages.length };
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

function cursorFailures(text, sessionId) {
  return String(text || '').split(/\r?\n/).filter(line => line
    && (line.includes(sessionId) || /cursor/i.test(line))
    && /selector.?fail|read error|timeout|exception/i.test(line));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.sendLive) throw new Error('Refusing live Cursor mutation without --send-live');
  if (options.soakMinutes < 10 && !options.allowShortSoak) {
    throw new Error('Production soak must be at least 10 minutes; use --allow-short-soak only for development');
  }
  const runId = options.runId.replace(/[^A-Za-z0-9_-]/g, '');
  const report = makeReporter(options.progressFile);
  const startedAt = Date.now();
  const proxyLog = path.join(__dirname, '..', 'proxy.log');
  const proxyErrLog = path.join(__dirname, '..', 'proxy-err.log');
  const logOffsets = { proxy: readLogOffset(proxyLog), error: readLogOffset(proxyErrLog) };
  let relay = null;
  let page = null;
  let sessionId = null;
  let originalAgent = null;
  let ownedAgent = null;
  const soakTurns = [];
  const checkpoints = [];

  try {
    page = await probePage();
    const baseline = await readNative(page);
    originalAgent = baseline.agents.find(agent => agent && agent.active);
    if (!originalAgent) throw new Error('No exact active Cursor agent before production run');
    relay = await openRelay();
    const { ws, messages } = relay;
    const session = await waitFor(() => guard.pickThrowawaySession(latestSessions(messages)), 45000, 'cursor-test relay session');
    if (!guard.isThrowawaySession(session)) throw new Error('Relay session did not pass cursor-test guard');
    sessionId = sessionIdOf(session);
    report('start', { run_id: runId, session_id: sessionId, original_agent_id: originalAgent.id, soak_minutes: options.soakMinutes });

    const newThreadStart = messages.length;
    const newThreadRequest = `cursor-production-new-thread-${runId}`;
    ws.send(JSON.stringify({ type: 'new_thread', session_id: sessionId, request_id: newThreadRequest }));
    const newThread = await waitFor(() => messages.slice(newThreadStart).find(message =>
      message.type === 'agent_control_result' && message.request_id === newThreadRequest), 30000, 'owned new_thread');
    if (newThread.result !== 'ok') throw new Error(`new_thread failed: ${JSON.stringify(newThread)}`);
    await waitFor(async () => (await readNative(page)).messages.length === 0, 30000, 'owned empty native transcript');
    report('owned_thread_empty', {});

    const toolToken = `RAC_CURSOR_TOOL_${runId}`;
    const toolTurn = await sendTurn({
      ws,
      relayMessages: messages,
      sessionId,
      page,
      name: 'tool-lifecycle',
      token: toolToken,
      timeoutMs: options.timeoutMs,
      requireWorking: true,
      prompt: `Cursor production ${runId}: read README.md using a read-only tool. Then reply with its first heading and the exact token ${toolToken}. Do not edit any file.`,
    });
    const afterTool = toolTurn.parity.native;
    ownedAgent = afterTool.agents.find(agent => agent && agent.active);
    if (!ownedAgent || ownedAgent.id === originalAgent.id) {
      throw new Error(`Owned Cursor agent identity did not settle: ${JSON.stringify(afterTool.agents)}`);
    }
    const structuredBlocks = afterTool.messages.flatMap(message => Array.isArray(message.content_blocks) ? message.content_blocks : []);
    if (!structuredBlocks.some(block => /tool|file|terminal/i.test(String(block?.type || block?.kind || block?.title || '')))) {
      throw new Error('Tool lifecycle completed without a structured tool/file block');
    }
    report('tool_lifecycle_pass', {
      agent_id: ownedAgent.id,
      agent_title: ownedAgent.title,
      working_kind: toolTurn.workingKind,
      messages: afterTool.messages.length,
      structured_blocks: structuredBlocks.length,
    });
    await switchAgent(ws, messages, sessionId, page, ownedAgent.id, 'owned start checkpoint');
    if (options.evidenceDir) {
      const startShot = path.join(options.evidenceDir, `cursor-production-${runId}-start-native.png`);
      await captureNative(page, startShot, ownedAgent.id);
      checkpoints.push({ kind: 'start', native: startShot });
      report('checkpoint', checkpoints[checkpoints.length - 1]);
    }

    await switchAgent(ws, messages, sessionId, page, ownedAgent.id, 'owned interrupt precondition');
    const continuityTokens = [toolToken];
    const interrupt = await interruptActiveTurn({
      ws,
      relayMessages: messages,
      sessionId,
      page,
      runId,
      timeoutMs: options.timeoutMs,
      delayMs: options.interruptDelayMs,
      report,
      requiredRelayTokens: continuityTokens,
      ownedAgentId: ownedAgent.id,
    });
    report('interrupt_pass', interrupt);

    const soakStartedAt = Date.now();
    const soakDurationMs = options.soakMinutes * 60 * 1000;
    const soakDeadline = soakStartedAt + soakDurationMs;
    const midpointAt = soakStartedAt + soakDurationMs / 2;
    let midpointCaptured = false;
    let turn = 0;
    while (Date.now() < soakDeadline && (!options.soakTurnLimit || turn < options.soakTurnLimit)) {
      turn += 1;
      const token = `RAC_CURSOR_SOAK_${runId}_${String(turn).padStart(2, '0')}`;
      const turnStartedAt = Date.now();
      await switchAgent(ws, messages, sessionId, page, ownedAgent.id, `owned soak turn ${turn}`);
      const result = await sendTurn({
        ws,
        relayMessages: messages,
        sessionId,
        page,
        name: `soak-${turn}`,
        token,
        timeoutMs: options.timeoutMs,
        requireWorking: false,
        allowAccumulatedPrefix: true,
        requiredRelayTokens: continuityTokens,
        expectedRelayMessages: 2 + (turn * 2),
        prompt: `Active Cursor soak turn ${turn}. Reply with exactly ${token} and nothing else.`,
      });
      continuityTokens.push(token);
      const evidence = {
        turn,
        token,
        elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
        native_messages: result.parity.native.messages.length,
        relay_messages: result.parity.relayMessages.length,
      };
      soakTurns.push(evidence);
      report('soak_turn_pass', evidence);
      if (!midpointCaptured && Date.now() >= midpointAt) {
        midpointCaptured = true;
        const checkpoint = { kind: 'midpoint', turn, elapsed_seconds: evidence.elapsed_seconds };
        await switchAgent(ws, messages, sessionId, page, ownedAgent.id, 'owned midpoint checkpoint');
        if (options.evidenceDir) {
          checkpoint.native = path.join(options.evidenceDir, `cursor-production-${runId}-midpoint-native.png`);
          await captureNative(page, checkpoint.native, ownedAgent.id);
        }
        checkpoints.push(checkpoint);
        report('checkpoint', checkpoint);
      }
      const nextTurnAt = Math.min(soakDeadline, turnStartedAt + options.soakIntervalMs);
      while (Date.now() < nextTurnAt) {
        if (ws.readyState !== WebSocket.OPEN) throw new Error('Relay disconnected during soak wait');
        await sleep(Math.min(5000, nextTurnAt - Date.now()));
      }
    }

    await switchAgent(ws, messages, sessionId, page, ownedAgent.id, 'owned final checkpoint');
    const finalParity = await assertParity(ws, messages, sessionId, page, 'production final', options.timeoutMs, { allowAccumulatedPrefix: true });
    const finalRelayText = finalParity.relayMessages.map(message => String(message.content || '')).join('\n');
    const missingFinalTokens = continuityTokens.filter(token => !finalRelayText.includes(token));
    if (missingFinalTokens.length) throw new Error(`Final relay history lost continuity tokens: ${missingFinalTokens.join(', ')}`);
    const finalCheckpoint = {
      kind: 'final',
      turn: soakTurns.length,
      elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
      native_messages: finalParity.native.messages.length,
      relay_messages: finalParity.relayMessages.length,
    };
    if (options.evidenceDir) {
      finalCheckpoint.native = path.join(options.evidenceDir, `cursor-production-${runId}-final-native.png`);
      await captureNative(page, finalCheckpoint.native, ownedAgent.id);
    }
    checkpoints.push(finalCheckpoint);
    report('checkpoint', finalCheckpoint);

    const failures = [
      ...cursorFailures(readLogTail(proxyLog, logOffsets.proxy), sessionId),
      ...cursorFailures(readLogTail(proxyErrLog, logOffsets.error), sessionId),
    ];
    if (failures.length) throw new Error(`Cursor failures appeared during soak: ${JSON.stringify(failures)}`);

    const result = {
      ok: true,
      run_id: runId,
      session_id: sessionId,
      original_agent_id: originalAgent.id,
      owned_agent_id: ownedAgent.id,
      owned_agent_title: ownedAgent.title,
      tool_working_kind: toolTurn.workingKind,
      interrupt,
      soak_minutes_requested: options.soakMinutes,
      soak_elapsed_seconds: Math.round((Date.now() - soakStartedAt) / 1000),
      soak_turns: soakTurns,
      checkpoints,
      selector_failures: failures,
      total_elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    writeResult(options.resultFile, result);
    report('complete', { ok: true, total_elapsed_seconds: result.total_elapsed_seconds });
    return result;
  } catch (error) {
    const result = {
      ok: false,
      run_id: runId,
      session_id: sessionId,
      original_agent_id: originalAgent?.id || null,
      owned_agent_id: ownedAgent?.id || null,
      soak_turns: soakTurns,
      checkpoints,
      error: error.message,
      total_elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    writeResult(options.resultFile, result);
    report('failed', { error: error.message });
    throw error;
  } finally {
    if (!options.keepOwned && relay?.ws?.readyState === WebSocket.OPEN && sessionId && originalAgent?.id) {
      const requestId = `cursor-production-restore-${runId}`;
      relay.ws.send(JSON.stringify({ type: 'switch_thread', session_id: sessionId, thread_id: originalAgent.id, request_id: requestId }));
      await waitFor(() => relay.messages.find(message =>
        message.type === 'agent_control_result' && message.request_id === requestId && message.result === 'ok'),
      30000, 'original Cursor agent restore').catch(() => {});
    }
    try { relay?.ws?.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, accumulatedTailMatches };
