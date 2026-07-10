#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const selectors = require('../agent-proxy/selectors');
const fidelity = require('./run-fidelity-regression');

function requireFromLocalOr(dir, mod) {
  try {
    return require(mod);
  } catch (_) {
    return require(path.join(__dirname, '..', dir, 'node_modules', mod));
  }
}

const WebSocket = requireFromLocalOr('relay-server', 'ws');
const CDP = requireFromLocalOr('agent-proxy', 'chrome-remote-interface');
const MUTATION_LOCK_PATH = path.join(os.tmpdir(), 'remote-agent-chat-antigravity-v2-live-e2e.lock');

function parseArgs(argv) {
  const options = {
    sendLive: false,
    relayWsUrl: null,
    timeoutMs: 180000,
    runId: crypto.randomBytes(4).toString('hex'),
    promptProfile: 'fidelity',
    skipMutationLock: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--relay-ws-url' && argv[i + 1]) options.relayWsUrl = argv[++i];
    else if (arg === '--timeout-ms' && argv[i + 1]) options.timeoutMs = Math.max(10000, parseInt(argv[++i], 10) || options.timeoutMs);
    else if (arg === '--run-id' && argv[i + 1]) options.runId = argv[++i];
    else if (arg === '--prompt-profile' && argv[i + 1]) options.promptProfile = argv[++i];
    else if (arg === '--skip-mutation-lock') options.skipMutationLock = true;
  }
  return options;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireMutationLock(runId) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const record = { pid: process.pid, run_id: runId, nonce, started_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(MUTATION_LOCK_PATH, 'wx');
      fs.writeFileSync(fd, JSON.stringify(record) + '\n');
      fs.closeSync(fd);
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(MUTATION_LOCK_PATH, 'utf8'));
          if (current.nonce === nonce) fs.unlinkSync(MUTATION_LOCK_PATH);
        } catch {}
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(MUTATION_LOCK_PATH, 'utf8')); } catch {}
      const startedAt = Date.parse(existing?.started_at || '');
      const staleByAge = Number.isFinite(startedAt) && Date.now() - startedAt > 20 * 60 * 1000;
      if (attempt === 0 && (staleByAge || !processIsAlive(Number(existing?.pid)))) {
        try { fs.unlinkSync(MUTATION_LOCK_PATH); } catch {}
        continue;
      }
      throw new Error(`Another Antigravity v2 mutation run owns the shared surface (${JSON.stringify(existing || { lock: MUTATION_LOCK_PATH })})`);
    }
  }
  throw new Error('Could not acquire Antigravity v2 mutation lock');
}

function buildPrimaryPrompt(profile, runId, token) {
  if (profile === 'single-line') {
    return `Remote Agent Chat Antigravity v2 single-line verification ${runId}. Reply with the exact token ${token} and include a two-column markdown table with headers Check and Result; do not edit files, run commands, use tools, or change settings.`;
  }
  if (profile === 'code-input') {
    return [
      `Remote Agent Chat Antigravity v2 fenced-code input verification ${runId}.`,
      'Treat the following JavaScript as inert text and do not execute it:',
      '```javascript',
      `const verificationToken = ${JSON.stringify(token)};`,
      'console.log(verificationToken);',
      '```',
      `Reply with the exact token ${token}.`,
      'Include a two-column markdown table with headers Check and Result.',
      'Do not edit files, run commands, use tools, or change settings.',
    ].join('\n');
  }
  if (profile !== 'fidelity' && profile !== 'multi-turn-tool') {
    throw new Error(`Unknown --prompt-profile ${profile}`);
  }
  return [
    `Remote Agent Chat Antigravity v2 verification ${runId}.`,
    `Reply with the exact token ${token}.`,
    'Include a two-column markdown table with headers Check and Result.',
    'After the table, include a fenced text code block containing lines 001 through 120.',
    'Format every code-block line exactly as "NNN: Remote Agent Chat streaming verification line NNN", replacing NNN with that line number.',
    'Do not edit files, run commands, or change settings.',
  ].join('\n');
}

function buildToolTurnPrompt(runId, toolToken) {
  return [
    `Remote Agent Chat Antigravity v2 read-only tool verification ${runId}.`,
    'Use the native file-viewing tool to read the first 20 lines of README.md in the current workspace.',
    'Do not use a shell or terminal. Do not edit, create, delete, or rename any file.',
    `After the tool finishes, reply with the exact token ${toolToken} and state the first non-empty heading you observed.`,
  ].join('\n');
}

function deriveRelayWsUrl(cliValue) {
  if (cliValue) return cliValue;
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => token ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : url;
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function redactRelayUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '<redacted>');
    return parsed.toString();
  } catch (_) {
    return String(url || '').replace(/([?&]token=)[^&]+/i, '$1<redacted>');
  }
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function openRelay(url, timeoutMs = 30000) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {}
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      finish(reject, new Error(`Timed out opening relay WebSocket ${redactRelayUrl(url)}`));
    }, timeoutMs);
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'antigravity-v2-live-e2e' }));
      finish(resolve, { ws, messages });
    });
    ws.once('error', error => finish(reject, error));
  });
}

function closeRelay(client) {
  if (!client?.ws) return;
  try { client.ws.close(); } catch {}
  try { client.ws.terminate(); } catch {}
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ((msg.type === 'connection_ack' || msg.type === 'session_list' || msg.type === 'session_snapshot') && Array.isArray(msg.sessions)) {
      return msg.sessions;
    }
  }
  return [];
}

function sessionIdOf(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

function agentTypeOf(session) {
  return typeof session === 'string' ? '' : session?.agent_type;
}

function messagesFor(messages, sessionId) {
  const out = [];
  for (const msg of messages) {
    if ((msg.type === 'history' || msg.type === 'history_snapshot') && (msg.session || msg.session_id) === sessionId) {
      out.splice(0, out.length, ...(msg.messages || []));
    }
    if ((msg.type === 'message' || msg.type === 'proxy_message') && (msg.session || msg.session_id) === sessionId) {
      out.push({ role: msg.role || msg.message?.role, content: msg.content || msg.message?.content, content_blocks: msg.content_blocks || msg.message?.content_blocks });
    }
  }
  return out;
}

function assertOrderedTranscriptMatch(nativeMessages, webuiMessages, label) {
  const nativeNorm = fidelity.normalizeMessages(nativeMessages);
  const webuiNorm = fidelity.normalizeMessages(webuiMessages);
  let prefix = 0;
  while (
    prefix < nativeNorm.length &&
    prefix < webuiNorm.length &&
    nativeNorm[prefix].role === webuiNorm[prefix]?.role &&
    nativeNorm[prefix].content === webuiNorm[prefix]?.content
  ) {
    prefix++;
  }
  const exact = nativeNorm.length === webuiNorm.length && prefix === nativeNorm.length;
  if (!exact) {
    throw new Error(`${label} transcript mismatch: native=${nativeNorm.length} webui=${webuiNorm.length} prefix=${prefix}`);
  }
}

function assertImportantTextPresent(nativeMessages, webuiMessages, token) {
  const nativeText = fidelity.normalizeMessages(nativeMessages).map(m => `${m.role}: ${m.content}`).join('\n');
  const webuiText = fidelity.normalizeMessages(webuiMessages).map(m => `${m.role}: ${m.content}`).join('\n');
  for (const marker of [token, 'Check', 'Result']) {
    if (!nativeText.includes(marker)) throw new Error(`Native transcript missing marker ${marker}`);
    if (!webuiText.includes(marker)) throw new Error(`WebUI transcript missing marker ${marker}`);
  }
}

function normalizeBlocks(message) {
  return (Array.isArray(message?.content_blocks) ? message.content_blocks : []).map(block => ({
    type: block?.type || '',
    label: String(block?.label || block?.title || '').trim(),
    content: String(block?.content || block?.text || block?.markdown || '').trim(),
  }));
}

function assertContentBlocksMatch(nativeMessages, webuiMessages) {
  const nativeAssistant = nativeMessages.filter(message => message.role === 'assistant');
  const webuiAssistant = webuiMessages.filter(message => message.role === 'assistant');
  if (nativeAssistant.length !== webuiAssistant.length) {
    throw new Error(`Assistant block count mismatch: native=${nativeAssistant.length} webui=${webuiAssistant.length}`);
  }
  for (let index = 0; index < nativeAssistant.length; index++) {
    const nativeBlocks = normalizeBlocks(nativeAssistant[index]);
    const webuiBlocks = normalizeBlocks(webuiAssistant[index]);
    if (JSON.stringify(nativeBlocks) !== JSON.stringify(webuiBlocks)) {
      throw new Error(`Assistant content_blocks mismatch at turn ${index}: native=${JSON.stringify(nativeBlocks)} webui=${JSON.stringify(webuiBlocks)}`);
    }
  }
}

function assertThinkingNotDuplicatedInMarkdown(messages, label) {
  for (const [messageIndex, message] of (messages || []).entries()) {
    if (message?.role !== 'assistant') continue;
    const blocks = normalizeBlocks(message);
    const thinking = blocks.filter(block => block.type === 'thinking' && block.content.length >= 20);
    const markdown = blocks.filter(block => block.type === 'markdown').map(block => block.content).join('\n\n');
    const normalizedMarkdown = markdown.replace(/\s+/g, ' ').trim();
    for (const block of thinking) {
      const normalizedThinking = block.content.replace(/\s+/g, ' ').trim();
      if (normalizedThinking && normalizedMarkdown.includes(normalizedThinking)) {
        throw new Error(`${label} assistant turn ${messageIndex} duplicates thinking content inside markdown`);
      }
    }
  }
}

function streamFingerprint(message) {
  const payload = {
    content: String(message?.content || '').trim(),
    blocks: normalizeBlocks(message),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function readNativeMessages(sessionId) {
  const targets = await CDP.List({ port: 9226 });
  const target = fidelity.findAntigravityV2Target(targets);
  if (!target) throw new Error('No Antigravity v2 CDP target on port 9226');
  const client = await CDP({ port: 9226, target: target.id });
  try {
    await client.Runtime.enable();
    return JSON.parse(await selectors.readMessages(client.Runtime, 'antigravity-v2', sessionId));
  } finally {
    try { await client.close(); } catch {}
  }
}

async function openNativeMessageReader(sessionId) {
  const targets = await CDP.List({ port: 9226 });
  const target = fidelity.findAntigravityV2Target(targets);
  if (!target) throw new Error('No Antigravity v2 CDP target on port 9226');
  const client = await CDP({ port: 9226, target: target.id });
  await client.Runtime.enable();
  return {
    async read() {
      const raw = await selectors.readMessages(client.Runtime, 'antigravity-v2', sessionId);
      return raw ? JSON.parse(raw) : [];
    },
    async close() {
      try { await client.close(); } catch {}
    },
  };
}

async function readNativeState(sessionId) {
  const targets = await CDP.List({ port: 9226 });
  const target = fidelity.findAntigravityV2Target(targets);
  if (!target) throw new Error('No Antigravity v2 CDP target on port 9226');
  const client = await CDP({ port: 9226, target: target.id });
  try {
    await client.Runtime.enable();
    const [active, chats, messagesRaw] = await Promise.all([
      selectors.readAntigravityV2ActiveConversation(client.Runtime),
      selectors.readAntigravityV2ChatList(client.Runtime),
      selectors.readMessages(client.Runtime, 'antigravity-v2', sessionId),
    ]);
    return {
      active,
      chats: Array.isArray(chats) ? chats : [],
      messages: messagesRaw ? JSON.parse(messagesRaw) : [],
    };
  } finally {
    try { await client.close(); } catch {}
  }
}

function controlResult(messages, requestId, command) {
  return messages.find(message =>
    message.type === 'agent_control_result' &&
    message.request_id === requestId &&
    message.command === command
  );
}

function activityKinds(messages, sessionId) {
  return messages
    .filter(message =>
      ['proxy_status', 'status', 'session_status'].includes(message.type) &&
      (message.session_id || message.session) === sessionId
    )
    .map(message => message.activity?.kind || (message.thinking ? 'thinking' : 'idle'));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.sendLive) {
    throw new Error('Refusing to send live prompt without --send-live');
  }

  const runId = options.runId.replace(/[^A-Za-z0-9_-]/g, '');
  const token = `RAC_V2_VERIFY_${runId}`;
  const prompt = buildPrimaryPrompt(options.promptProfile, runId, token);
  const releaseMutationLock = options.skipMutationLock ? null : acquireMutationLock(runId);

  const relayUrl = deriveRelayWsUrl(options.relayWsUrl);
  let client = null;
  let reconnect = null;
  let streamTimer = null;
  let nativeStreamTimer = null;
  let nativeReader = null;
  let nativeSampleInFlight = false;
  const nativeStreamSnapshots = new Set();
  let nativeStreamSampleErrors = 0;

  try {
    client = await openRelay(relayUrl);
    const { ws, messages } = client;

    const session = await waitFor(() => latestSessions(messages).find(s => agentTypeOf(s) === 'antigravity-v2'), 30000, 'antigravity-v2 session');
    const sessionId = sessionIdOf(session);
    ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));

    const newChatRequestId = `ag-v2-new-${runId}`;
    const newChatMessageStart = messages.length;
    ws.send(JSON.stringify({ type: 'new_chat', session_id: sessionId, request_id: newChatRequestId }));
    const newChatResult = await waitFor(() => controlResult(messages, newChatRequestId, 'new_chat'), 30000, 'new_chat control result');
    if (newChatResult.result !== 'ok') {
      throw new Error(`new_chat failed: ${JSON.stringify(newChatResult.error || newChatResult)}`);
    }
    const beforeState = await waitFor(async () => {
      const state = await readNativeState(sessionId);
      return state.active?.is_list_view && !state.active?.conversation_id ? state : null;
    }, 30000, 'owned blank new-conversation route');
    const beforeNative = beforeState.messages;
    await waitFor(() => messages.slice(newChatMessageStart).find(message =>
      (message.type === 'history' || message.type === 'history_snapshot') &&
      (message.session || message.session_id) === sessionId &&
      Array.isArray(message.messages) &&
      message.messages.length === 0
    ), 30000, 'authoritative empty WebUI history after new_chat');
    if (messagesFor(messages.slice(newChatMessageStart), sessionId).length !== 0) {
      throw new Error('WebUI transcript was not empty after new_chat');
    }

    const requestId = `ag-v2-e2e-${runId}`;
    const streamSnapshots = new Set();
    const minimumStreamObservations = ['fidelity', 'multi-turn-tool'].includes(options.promptProfile) ? 2 : 1;
    nativeReader = await openNativeMessageReader(sessionId);
    nativeStreamTimer = setInterval(async () => {
      if (nativeSampleInFlight) return;
      nativeSampleInFlight = true;
      try {
        const nativeMessages = await nativeReader.read();
        nativeMessages.filter(message => message.role === 'assistant').forEach(message => {
          if (String(message.content || '').trim()) nativeStreamSnapshots.add(streamFingerprint(message));
        });
      } catch {
        nativeStreamSampleErrors++;
      } finally {
        nativeSampleInFlight = false;
      }
    }, 250);
    streamTimer = setInterval(() => {
      const assistant = messagesFor(messages, sessionId).filter(message => message.role === 'assistant');
      assistant.forEach(message => {
        const text = String(message.content || '').trim();
        if (text) streamSnapshots.add(streamFingerprint(message));
      });
    }, 100);
    ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: requestId }));

    await waitFor(() => messages.find(m => m.type === 'message_accepted' && m.client_message_id === requestId), 30000, 'message_accepted');
    const sendResult = await waitFor(() => messages.find(m => m.type === 'proxy_send_result' && m.client_message_id === requestId), 60000, 'proxy_send_result');
    if (sendResult.result !== 'delivered') {
      throw new Error(`proxy_send_result was ${sendResult.result}: ${JSON.stringify(sendResult.error || sendResult)}`);
    }

    await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'user' && String(m.content || '').includes(token)), 60000, 'WebUI user echo');
    await waitFor(async () => (await readNativeMessages(sessionId)).some(m => m.role === 'user' && String(m.content || '').includes(token)), 60000, 'native user receipt');

    const workingKind = await waitFor(() => {
      const kinds = activityKinds(messages, sessionId);
      return kinds.find(kind => ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(kind));
    }, 60000, 'working activity transition');

    try {
      await waitFor(() => {
        return streamSnapshots.size >= minimumStreamObservations;
      }, Math.min(options.timeoutMs, 90000), `at least ${minimumStreamObservations} assistant stream/update observation(s)`);
    } catch (error) {
      throw new Error(`${error.message} (relay=${streamSnapshots.size}, native=${nativeStreamSnapshots.size}, native_sample_errors=${nativeStreamSampleErrors})`);
    }

    await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'assistant' && String(m.content || '').includes(token)), options.timeoutMs, 'assistant final token');
    if (streamSnapshots.size < minimumStreamObservations) {
      throw new Error(`Expected at least ${minimumStreamObservations} streaming/update observation(s), saw ${streamSnapshots.size}`);
    }

    await waitFor(() => {
      const kinds = activityKinds(messages, sessionId);
      const workingIndex = kinds.findIndex(kind => kind === workingKind || ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(kind));
      return workingIndex >= 0 && kinds.slice(workingIndex + 1).includes('idle');
    }, 60000, 'final idle activity transition');

    let toolToken = null;
    let toolTurnWorkingKind = null;
    if (options.promptProfile === 'multi-turn-tool') {
      toolToken = `RAC_V2_TOOL_${runId}`;
      const toolPrompt = buildToolTurnPrompt(runId, toolToken);
      const toolRequestId = `ag-v2-tool-${runId}`;
      const toolMessageStart = messages.length;
      ws.send(JSON.stringify({ type: 'send', session: sessionId, content: toolPrompt, client_message_id: toolRequestId }));

      await waitFor(() => messages.find(m => m.type === 'message_accepted' && m.client_message_id === toolRequestId), 30000, 'tool-turn message_accepted');
      const toolSendResult = await waitFor(() => messages.find(m => m.type === 'proxy_send_result' && m.client_message_id === toolRequestId), 60000, 'tool-turn proxy_send_result');
      if (toolSendResult.result !== 'delivered') {
        throw new Error(`tool-turn proxy_send_result was ${toolSendResult.result}: ${JSON.stringify(toolSendResult.error || toolSendResult)}`);
      }
      await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'user' && String(m.content || '').includes(toolToken)), 60000, 'tool-turn WebUI user echo');
      await waitFor(async () => (await readNativeMessages(sessionId)).some(m => m.role === 'user' && String(m.content || '').includes(toolToken)), 60000, 'tool-turn native user receipt');

      toolTurnWorkingKind = await waitFor(() => {
        const kinds = activityKinds(messages.slice(toolMessageStart), sessionId);
        return kinds.find(kind => ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(kind));
      }, 60000, 'tool-turn working activity transition');
      await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'assistant' && String(m.content || '').includes(toolToken)), options.timeoutMs, 'tool-turn assistant final token');
      await waitFor(() => {
        const kinds = activityKinds(messages.slice(toolMessageStart), sessionId);
        const workingIndex = kinds.findIndex(kind => kind === toolTurnWorkingKind || ['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(kind));
        return workingIndex >= 0 && kinds.slice(workingIndex + 1).includes('idle');
      }, 60000, 'tool-turn final idle activity transition');
    }

    const finalNative = await readNativeMessages(sessionId);
    if (!finalNative.some(m => m.role === 'assistant' && String(m.content || '').includes(token))) {
      throw new Error('Native transcript did not contain final assistant token');
    }
    if (toolToken && !finalNative.some(m => m.role === 'assistant' && String(m.content || '').includes(toolToken))) {
      throw new Error('Native transcript did not contain final tool-turn assistant token');
    }
    assertThinkingNotDuplicatedInMarkdown(finalNative, 'Native');
    const nativeToolBlocks = finalNative
      .filter(message => message.role === 'assistant')
      .flatMap(normalizeBlocks)
      .filter(block => block.type === 'tool_call' || block.type === 'tool_result' || block.type === 'terminal');
    if (toolToken && !nativeToolBlocks.length) {
      throw new Error('Native multi-turn transcript did not expose a structured tool block');
    }

    const ownedState = await waitFor(async () => {
      const state = await readNativeState(sessionId);
      const conversationId = state.active?.conversation_id;
      return conversationId && state.chats.some(chat => chat.id === conversationId) ? state : null;
    }, 30000, 'owned conversation identity in native chat list');
    const ownedConversationId = ownedState.active.conversation_id;

    const chatListRequestId = `ag-v2-list-${runId}`;
    ws.send(JSON.stringify({ type: 'chat_list', session_id: sessionId, request_id: chatListRequestId }));
    const chatListResult = await waitFor(() => controlResult(messages, chatListRequestId, 'chat_list'), 30000, 'chat_list control result');
    if (chatListResult.result !== 'ok') throw new Error(`chat_list failed: ${JSON.stringify(chatListResult.error || chatListResult)}`);
    const relayChatList = await waitFor(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.type === 'chat_list' && message.session_id === sessionId && Array.isArray(message.chats)) {
          if (message.chats.some(chat => chat.id === ownedConversationId)) return message.chats;
        }
      }
      return null;
    }, 30000, 'owned conversation in relay chat list');

    const switchRequestId = `ag-v2-switch-${runId}`;
    ws.send(JSON.stringify({ type: 'switch_chat', session_id: sessionId, chat_id: ownedConversationId, request_id: switchRequestId }));
    const switchResult = await waitFor(() => controlResult(messages, switchRequestId, 'switch_chat'), 30000, 'switch_chat control result');
    if (switchResult.result !== 'ok') throw new Error(`switch_chat failed: ${JSON.stringify(switchResult.error || switchResult)}`);
    await waitFor(async () => {
      const state = await readNativeState(sessionId);
      return state.active?.conversation_id === ownedConversationId &&
        state.messages.some(message => String(message.content || '').includes(token));
    }, 30000, 'owned conversation after switch_chat');
    const finalActivityKind = await waitFor(() => {
      const kinds = activityKinds(messages, sessionId);
      return kinds[kinds.length - 1] === 'idle' ? 'idle' : null;
    }, 30000, 'latest post-switch activity to settle idle');

    await waitFor(() => messagesFor(messages, sessionId).some(message =>
      message.role === 'assistant' &&
      String(message.content || '').includes(token) &&
      normalizeBlocks(message).some(block => block.type === 'thinking' && block.content)
    ), 60000, 'expanded thinking block in live WebUI transcript');
    await waitFor(() => {
      const liveHistory = messagesFor(messages, sessionId);
      try {
        assertOrderedTranscriptMatch(finalNative, liveHistory, 'Antigravity v2 live');
        assertContentBlocksMatch(finalNative, liveHistory);
        return liveHistory;
      } catch {
        return null;
      }
    }, 30000, 'exact settled live WebUI transcript');

    closeRelay(client);
    client = null;
    reconnect = await openRelay(relayUrl);
    reconnect.ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));
    const replayMessages = await waitFor(() => {
      const history = messagesFor(reconnect.messages, sessionId);
      if (!history.some(m => m.role === 'assistant' && String(m.content || '').includes(token))) return null;
      try {
        assertOrderedTranscriptMatch(finalNative, history, 'Antigravity v2 reconnect');
        assertContentBlocksMatch(finalNative, history);
        return history;
      } catch {
        return null;
      }
    }, 30000, 'exact SQLite replay after reconnect');
    const replayHasBlocks = replayMessages.some(m => Array.isArray(m.content_blocks) && m.content_blocks.length > 0);
    if (!replayHasBlocks) throw new Error('SQLite replay did not preserve any content_blocks');
    assertImportantTextPresent(finalNative, replayMessages, token);
    assertOrderedTranscriptMatch(finalNative, replayMessages, 'Antigravity v2 reconnect');
    assertContentBlocksMatch(finalNative, replayMessages);
    assertThinkingNotDuplicatedInMarkdown(replayMessages, 'WebUI replay');

    const replayThinkingBlocks = replayMessages
      .filter(message => message.role === 'assistant')
      .flatMap(normalizeBlocks)
      .filter(block => block.type === 'thinking' && block.content);
    if (!replayThinkingBlocks.length) throw new Error('SQLite replay did not preserve expanded thinking content');

    const result = {
      ok: true,
      run_id: runId,
      token,
      prompt_profile: options.promptProfile,
      tool_turn_token: toolToken,
      session_id: sessionId,
      relay_url: redactRelayUrl(relayUrl),
      before_native_count: beforeNative.length,
      final_native_count: finalNative.length,
      streaming_observation_count: streamSnapshots.size,
      minimum_streaming_observation_count: minimumStreamObservations,
      native_streaming_observation_count: nativeStreamSnapshots.size,
      native_stream_sample_errors: nativeStreamSampleErrors,
      live_event_webui_count: messagesFor(messages, sessionId).length,
      replay_webui_count: replayMessages.length,
      replay_content_blocks_seen: replayHasBlocks,
      replay_thinking_block_count: replayThinkingBlocks.length,
      native_tool_block_count: nativeToolBlocks.length,
      final_turn_count: finalNative.length,
      owned_conversation_id: ownedConversationId,
      relay_chat_count: relayChatList.length,
      activity_kinds: activityKinds(messages, sessionId),
      working_kind: workingKind,
      tool_turn_working_kind: toolTurnWorkingKind,
      final_activity_kind: finalActivityKind,
      new_chat_result: newChatResult.result,
      chat_list_result: chatListResult.result,
      switch_chat_result: switchResult.result,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    if (nativeStreamTimer) clearInterval(nativeStreamTimer);
    if (streamTimer) clearInterval(streamTimer);
    if (nativeReader) await nativeReader.close();
    closeRelay(reconnect);
    closeRelay(client);
    if (releaseMutationLock) releaseMutationLock();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  buildPrimaryPrompt,
  buildToolTurnPrompt,
  deriveRelayWsUrl,
  openRelay,
  closeRelay,
  waitFor,
  latestSessions,
  sessionIdOf,
  agentTypeOf,
  messagesFor,
  normalizeBlocks,
  assertOrderedTranscriptMatch,
  assertContentBlocksMatch,
  readNativeMessages,
  openNativeMessageReader,
  readNativeState,
  controlResult,
  activityKinds,
  acquireMutationLock,
  MUTATION_LOCK_PATH,
};
