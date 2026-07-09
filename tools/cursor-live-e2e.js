#!/usr/bin/env node
'use strict';
// Relay → proxy → Cursor CDP send verification (mirrors antigravity-v2-live-e2e.js).
// Usage: node tools/cursor-live-e2e.js --send-live [--workspace-filter remote-agent-chat]

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
    verifyRest: false,
    workspaceFilter: 'cursor-test',
    timeoutMs: 120000,
    runId: crypto.randomBytes(4).toString('hex'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send-live') options.sendLive = true;
    else if (arg === '--verify-rest') options.verifyRest = true;
    else if (arg === '--workspace-filter' && argv[i + 1]) options.workspaceFilter = argv[++i];
    else if (arg === '--timeout-ms' && argv[i + 1]) options.timeoutMs = Math.max(10000, parseInt(argv[++i], 10) || options.timeoutMs);
    else if (arg === '--run-id' && argv[i + 1]) options.runId = argv[++i];
  }
  return options;
}

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function openRelay(url) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString())); } catch {}
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('Timed out opening relay WebSocket'));
    }, 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'cursor-live-e2e',
      }));
      resolve({ ws, messages });
    });
    ws.once('error', reject);
  });
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ((msg.type === 'connection_ack' || msg.type === 'session_list' || msg.type === 'session_snapshot')
      && Array.isArray(msg.sessions)) {
      return msg.sessions;
    }
  }
  return [];
}

function sessionIdOf(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

function pickCursorSession(sessions, filter) {
  const throwaway = guard.pickThrowawaySession(sessions);
  if (throwaway) return throwaway;
  const f = (filter || '').toLowerCase();
  return sessions.find((s) => {
    if (s.agent_type !== 'cursor') return false;
    const sid = sessionIdOf(s);
    if (guard.isBlockedSessionId(sid)) return false;
    const hay = `${s.display_name || ''} ${s.workspace_name || ''} ${s.window_title || ''} ${s.workspace_path || ''}`.toLowerCase();
    return !f || hay.includes(f);
  });
}

async function readNativeMessages(targetId) {
  const client = await CDP({ port: CDP_PORT, target: targetId });
  try {
    await client.Runtime.enable();
    return JSON.parse(await cursorSel.readCursorMessages(client.Runtime) || '[]');
  } finally {
    try { await client.close(); } catch {}
  }
}

async function findCdpTarget() {
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'throwaway CDP page not open');
  guard.assertProbeTarget(page, __filename);
  return page;
}

async function verifyRestHistory(sessionId, token) {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const bearerToken = fidelity.buildBearerToken(relayEnv);
  const relayBaseUrls = fidelity.deriveRelayBaseUrls(null, relayEnv, proxyEnv);
  if (!bearerToken) throw new Error('JWT_SECRET + ALLOWED_EMAIL required for REST verify');
  for (const base of relayBaseUrls) {
    const res = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const messages = data.messages || [];
    const hit = messages.some((m) => m.role === 'user' && String(m.content || '').includes(token));
    if (hit) {
      console.log('PASS REST history', { base, count: messages.length });
      return;
    }
  }
  throw new Error(`REST history missing token ${token}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sendLive) throw new Error('Refusing to send live prompt without --send-live');

  const runId = options.runId.replace(/[^A-Za-z0-9_-]/g, '');
  const token = `RAC_CURSOR_E2E_${runId}`;
  const prompt = [
    `Remote Agent Chat Cursor relay verification ${runId}.`,
    `Reply with the exact token ${token}.`,
    'One short sentence only. Do not edit files or run commands.',
  ].join('\n');

  const relayUrl = deriveRelayWsUrl();
  const cdpTarget = await findCdpTarget();

  const client = await openRelay(relayUrl);
  const { ws, messages } = client;

  try {
    const session = await waitFor(
      () => pickCursorSession(latestSessions(messages), options.workspaceFilter),
      45000,
      'cursor session on relay'
    );
    const sessionId = sessionIdOf(session);
    if (guard.isBlockedSessionId(sessionId)) {
      throw new Error(`Blocked relay session ${sessionId} (host/GWA); need cursor-test throwaway`);
    }
    if (!guard.isThrowawaySession(session)) {
      throw new Error(`Relay session ${sessionId} is not cursor-test throwaway (${session.workspace_name || session.window_title || 'unknown'})`);
    }
    console.log('relay session', sessionId, session.display_name || session.workspace_name);

    ws.send(JSON.stringify({ type: 'get_history', session: sessionId }));
    await waitFor(() => messages.some((m) => m.type === 'history' && (m.session || m.session_id) === sessionId), 15000, 'history');

    const requestId = `cursor-e2e-${runId}`;
    ws.send(JSON.stringify({ type: 'send', session: sessionId, content: prompt, client_message_id: requestId }));

    await waitFor(
      () => messages.find((m) => m.type === 'message_accepted' && m.client_message_id === requestId),
      30000,
      'message_accepted'
    );
    const sendResult = await waitFor(
      () => messages.find((m) => m.type === 'proxy_send_result' && m.client_message_id === requestId),
      60000,
      'proxy_send_result'
    );
    console.log('proxy_send_result', sendResult.result, sendResult.detail || '');
    if (sendResult.result !== 'delivered') throw new Error(`proxy_send_result was ${sendResult.result}`);

    await waitFor(async () => {
      const native = await readNativeMessages(cdpTarget.id);
      return native.some((m) => m.role === 'user' && String(m.content || '').includes(token));
    }, 60000, 'native user receipt');

    console.log('PASS relay send delivered; native transcript contains token');
    if (options.verifyRest) await verifyRestHistory(sessionId, token);
  } finally {
    try { ws.close(); } catch {}
  }
}

module.exports = { main, parseArgs, verifyRestHistory };

if (require.main === module) {
  main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
  });
}
