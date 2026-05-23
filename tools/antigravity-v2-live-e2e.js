#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
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

function parseArgs(argv) {
  const options = {
    sendLive: false,
    relayWsUrl: null,
    timeoutMs: 180000,
    runId: crypto.randomBytes(4).toString('hex'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--relay-ws-url' && argv[i + 1]) options.relayWsUrl = argv[++i];
    else if (arg === '--timeout-ms' && argv[i + 1]) options.timeoutMs = Math.max(10000, parseInt(argv[++i], 10) || options.timeoutMs);
    else if (arg === '--run-id' && argv[i + 1]) options.runId = argv[++i];
  }
  return options;
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

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.sendLive) {
    throw new Error('Refusing to send live prompt without --send-live');
  }

  const runId = options.runId.replace(/[^A-Za-z0-9_-]/g, '');
  const token = `RAC_V2_VERIFY_${runId}`;
  const prompt = [
    `Remote Agent Chat Antigravity v2 verification ${runId}.`,
    `Reply with the exact token ${token}.`,
    'Include a two-column markdown table with headers Check and Result.',
    'Do not edit files, run commands, or change settings.',
  ].join('\n');

  const relayUrl = deriveRelayWsUrl(options.relayWsUrl);
  let client = null;
  let reconnect = null;

  try {
    client = await openRelay(relayUrl);
    const { ws, messages } = client;

    const session = await waitFor(() => latestSessions(messages).find(s => agentTypeOf(s) === 'antigravity-v2'), 30000, 'antigravity-v2 session');
    const sessionId = sessionIdOf(session);
    ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));

    const beforeNative = await readNativeMessages(sessionId);
    const requestId = `ag-v2-e2e-${runId}`;
    ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: requestId }));

    await waitFor(() => messages.find(m => m.type === 'message_accepted' && m.client_message_id === requestId), 30000, 'message_accepted');
    const sendResult = await waitFor(() => messages.find(m => m.type === 'proxy_send_result' && m.client_message_id === requestId), 60000, 'proxy_send_result');
    if (sendResult.result !== 'delivered') throw new Error(`proxy_send_result was ${sendResult.result}`);

    await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'user' && String(m.content || '').includes(token)), 60000, 'WebUI user echo');
    await waitFor(async () => (await readNativeMessages(sessionId)).some(m => m.role === 'user' && String(m.content || '').includes(token)), 60000, 'native user receipt');

    const streamSnapshots = new Set();
    await waitFor(() => {
      const assistant = messagesFor(messages, sessionId).filter(m => m.role === 'assistant');
      assistant.forEach(m => {
        const text = String(m.content || '').trim();
        if (text) streamSnapshots.add(text.slice(0, 500));
      });
      return streamSnapshots.size >= 2 || assistant.some(m => String(m.content || '').includes(token));
    }, options.timeoutMs, 'assistant stream/update');

    await waitFor(() => messagesFor(messages, sessionId).some(m => m.role === 'assistant' && String(m.content || '').includes(token)), options.timeoutMs, 'assistant final token');
    if (streamSnapshots.size < 2) {
      throw new Error(`Expected at least 2 streaming/update observations, saw ${streamSnapshots.size}`);
    }

    const finalNative = await readNativeMessages(sessionId);
    if (!finalNative.some(m => m.role === 'assistant' && String(m.content || '').includes(token))) {
      throw new Error('Native transcript did not contain final assistant token');
    }

    closeRelay(client);
    client = null;
    reconnect = await openRelay(relayUrl);
    reconnect.ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));
    const replayMessages = await waitFor(() => {
      const history = messagesFor(reconnect.messages, sessionId);
      return history.some(m => m.role === 'assistant' && String(m.content || '').includes(token)) ? history : null;
    }, 30000, 'SQLite replay token after reconnect');
    const replayHasBlocks = replayMessages.some(m => Array.isArray(m.content_blocks) && m.content_blocks.length > 0);
    if (!replayHasBlocks) throw new Error('SQLite replay did not preserve any content_blocks');
    assertImportantTextPresent(finalNative, replayMessages, token);

    const result = {
      ok: true,
      run_id: runId,
      token,
      session_id: sessionId,
      relay_url: redactRelayUrl(relayUrl),
      before_native_count: beforeNative.length,
      final_native_count: finalNative.length,
      streaming_observation_count: streamSnapshots.size,
      live_event_webui_count: messagesFor(messages, sessionId).length,
      replay_webui_count: replayMessages.length,
      replay_content_blocks_seen: replayHasBlocks,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    closeRelay(reconnect);
    closeRelay(client);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
