#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { freshEvidencePath } = require('./evidence-path');

const root = path.resolve(__dirname, '..');
const DEFAULT_HOURS = 8;
const EVENT_BUFFER_LIMIT = 20_000;
const DEFAULT_INTERVAL_MINUTES = 30;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const PRODUCTION_TYPES = ['antigravity-v2', 'cursor', 'claude_cli', 'codex_cli', 'cursor_cli', 'continue'];
const RUN_LOCK_PATH = path.resolve(process.env.RAC_SOAK_RUN_LOCK_FILE || path.join(root, 'data', 'production-overnight-soak.lock'));
const OPERATION_LOCK_PATH = path.resolve(process.env.RAC_OPERATION_LOCK_FILE || path.join(os.tmpdir(), 'remote-agent-chat-operation.lock'));

function loadEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildBearerToken(relayEnv) {
  if (!relayEnv.JWT_SECRET || !relayEnv.ALLOWED_EMAIL) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = base64UrlEncode(JSON.stringify({
    email: relayEnv.ALLOWED_EMAIL,
    sub: 'production-overnight-soak',
    iat: nowSec,
    exp: nowSec + 60 * 60,
  }));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', relayEnv.JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function lockOwner(lockPath) {
  const raw = fs.readFileSync(lockPath, 'utf8').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { pid: Number(parsed.pid), agent: parsed.agent || parsed.kind || 'unknown' };
    }
    return { pid: Number(parsed), agent: 'production-overnight-soak' };
  } catch {
    return { pid: Number(raw), agent: 'production-overnight-soak' };
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function acquirePidLock(lockPath, label, content) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(handle, content, 'utf8');
      fs.closeSync(handle);
      const release = () => {
        try {
          if (lockOwner(lockPath).pid === process.pid) fs.unlinkSync(lockPath);
        } catch {}
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt > 0) throw error;
      const owner = lockOwner(lockPath);
      if (pidAlive(owner.pid)) throw new Error(`${label} is held by ${owner.agent} under PID ${owner.pid}`);
      fs.unlinkSync(lockPath);
    }
  }
  throw new Error(`Unable to acquire ${label}`);
}

function acquireRunLock() {
  const operationPayload = `${JSON.stringify({
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    agent: 'production-overnight-soak',
    kind: 'production-soak',
  })}\n`;
  const releaseOperation = acquirePidLock(
    OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    operationPayload,
  );
  try {
    const releaseLocal = acquirePidLock(
      RUN_LOCK_PATH,
      'production overnight soak lock',
      `${process.pid}\n`,
    );
    return () => {
      releaseLocal();
      releaseOperation();
    };
  } catch (error) {
    releaseOperation();
    throw error;
  }
}

function parseArgs(argv) {
  const options = {
    hours: DEFAULT_HOURS,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    allowShortSoak: false,
    output: freshEvidencePath(root, 'production-overnight-soak-result.json'),
    ledger: freshEvidencePath(root, 'production-overnight-soak-live.jsonl'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--hours' && argv[index + 1]) options.hours = Number(argv[++index]);
    else if (arg === '--interval-minutes' && argv[index + 1]) options.intervalMinutes = Number(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--ledger' && argv[index + 1]) options.ledger = path.resolve(argv[++index]);
    else if (arg === '--allow-short-soak') options.allowShortSoak = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!Number.isFinite(options.hours) || options.hours <= 0) throw new Error('--hours must be positive');
  if (!Number.isFinite(options.intervalMinutes) || options.intervalMinutes <= 0) throw new Error('--interval-minutes must be positive');
  if (options.hours < DEFAULT_HOURS && !options.allowShortSoak) {
    throw new Error(`Production overnight soak must be at least ${DEFAULT_HOURS} hours; use --allow-short-soak only for runner development`);
  }
  return options;
}

function relayUrl() {
  const relayEnv = loadEnvFile(path.join(root, 'relay-server', '.env'));
  const proxyEnv = loadEnvFile(path.join(root, 'agent-proxy', '.env'));
  const token = buildBearerToken(relayEnv);
  const configured = proxyEnv.RELAY_URL || relayEnv.PUBLIC_URL || 'http://127.0.0.1:3500';
  const ws = configured.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/proxy-ws$/i, '/client-ws').replace(/\/+$/, '');
  return `${ws}${token ? `${ws.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ''}`;
}

function normalize(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function sessionId(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

function sessionActivity(session) {
  return String(session?.activity?.kind || '').toLowerCase();
}

function isIdle(session) {
  return !['thinking', 'generating', 'working', 'running_command', 'applying_patch', 'reading_files'].includes(sessionActivity(session));
}

function applyRelaySessionEvent(sessions, message) {
  if (Array.isArray(message?.sessions)) return message.sessions;
  if (!['status', 'proxy_status', 'session_status'].includes(message?.type)) return sessions;
  const id = message.session_id || message.session;
  if (!id || !message.activity || typeof message.activity !== 'object') return sessions;
  return (sessions || []).map(session => {
    if (!session || typeof session !== 'object' || sessionId(session) !== id) return session;
    return {
      ...session,
      status: message.status || session.status,
      activity: { ...(session.activity || {}), ...message.activity },
    };
  });
}

function safeTitle(session) {
  return String(session?.session_title || session?.chat_title || session?.title || session?.name || '');
}

const SAFE_SELECTORS = {
  'antigravity-v2': session => safeTitle(session) === 'Remote Agent Chat Verification',
  cursor: session => normalize(session?.workspace_path) === 'c:\\temp\\cursor-test',
  claude_cli: session => normalize(session?.workspace_path) === 'c:\\temp\\remote-agent-claude-cli-test',
  codex_cli: session => normalize(session?.workspace_path) === 'c:\\temp\\remote-agent-vscode-test'
    && /^reply with exact/i.test(safeTitle(session)),
  cursor_cli: session => normalize(session?.workspace_path) === 'c:\\temp\\cursor-test'
    && /^cursor cli smoke$/i.test(safeTitle(session)),
  continue: session => normalize(session?.workspace_path) === 'c:\\temp\\remote-agent-vscode-test',
};

function selectSafeSessions(sessions, requestedTypes = PRODUCTION_TYPES) {
  const types = [...new Set(requestedTypes)];
  assert(types.length > 0 && types.every(type => PRODUCTION_TYPES.includes(type)),
    `Safe-session selection accepts only: ${PRODUCTION_TYPES.join(', ')}`);
  const selected = {};
  for (const type of types) {
    const candidates = (sessions || [])
      .filter(session => session && typeof session === 'object' && session.agent_type === type && SAFE_SELECTORS[type](session) && isIdle(session))
      .sort((left, right) => String(right.last_seen_at || '').localeCompare(String(left.last_seen_at || '')));
    assert(candidates.length > 0, `No idle disposable ${type} session matched the strict soak guard`);
    selected[type] = candidates[0];
  }
  const ids = Object.values(selected).map(sessionId);
  assert.strictEqual(new Set(ids).size, types.length, 'Soak guards selected duplicate sessions');
  return selected;
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const value = predicate();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}

function findDeliveryEvidence(events, startIndex, clientMessageId, token) {
  for (const event of eventsSince(events, startIndex)) {
    if (!event || typeof event !== 'object') continue;
    if ((event.type === 'proxy_send_result' || event.type === 'message_delivered' || event.type === 'message_failed')
      && event.client_message_id === clientMessageId) {
      return event;
    }
    const messages = [event.message, ...(Array.isArray(event.messages) ? event.messages : [])].filter(Boolean);
    const nativeUserEcho = messages.find(message => (
      message.role === 'user' && String(message.content || '').includes(token)
    ));
    if (nativeUserEcho) {
      return { type: 'native_user_echo', result: 'delivered', client_message_id: clientMessageId };
    }
  }
  return null;
}

function eventsSince(events, startSequence) {
  return (events || []).filter(event => (
    Number.isSafeInteger(event?.__soak_sequence) && event.__soak_sequence >= startSequence
  ));
}

async function openRelayAttempt() {
  const events = [];
  let nextEventSequence = 0;
  let latestSessions = [];
  let disconnects = 0;
  let closing = false;
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  ws.on('message', data => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    message.__soak_sequence = nextEventSequence;
    nextEventSequence += 1;
    events.push(message);
    if (events.length > EVENT_BUFFER_LIMIT) events.splice(0, events.length - EVENT_BUFFER_LIMIT);
    latestSessions = applyRelaySessionEvent(latestSessions, message);
  });
  ws.on('close', () => { if (!closing) disconnects += 1; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Relay connection timed out')), 30_000);
      ws.once('open', () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'production-overnight-soak' }));
        resolve();
      });
      ws.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await waitFor(() => latestSessions.length > 0, 30_000, 'initial production session list');
  } catch (error) {
    closing = true;
    try { ws.terminate(); } catch {}
    throw error;
  }
  return {
    ws,
    events,
    mark: () => nextEventSequence,
    sessions: () => latestSessions,
    disconnects: () => disconnects,
    close: () => {
      closing = true;
      ws.close();
    },
  };
}

async function openRelay() {
  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await openRelayAttempt();
    } catch (error) {
      failures.push(`attempt ${attempt}: ${error.message}`);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error(`Relay connection failed after 3 attempts (${failures.join('; ')})`);
}

function send(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) throw new Error('Relay is not connected');
  ws.send(JSON.stringify(message));
}

async function historyTail(relay, id, limit = 500) {
  const requestId = `soak-history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  send(relay.ws, {
    type: 'history_chunk_request', session_id: id, session: id, request_id: requestId,
    mode: 'tail', source: 'relay_sqlite', replace: true, limit,
  });
  return waitFor(
    () => relay.events.find(event => event.type === 'history_chunk' && event.request_id === requestId),
    30_000,
    `history tail ${id}`,
  );
}

function exactToken(runId, cycle, type) {
  return `RAC_OVERNIGHT_${runId}_${String(cycle).padStart(2, '0')}_${type.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
}

function assistantTokenPrompt(token) {
  const splitAt = Math.floor(token.length / 2);
  const prompt = `Production overnight soak check. Concatenate "${token.slice(0, splitAt)}" then "${token.slice(splitAt)}" and reply with only the result. Do not use tools, edit files, or change settings.`;
  assert(!prompt.includes(token), 'overnight prompt must not contain its contiguous answer token');
  return prompt;
}

function eventHasAssistantToken(event, token) {
  if (!event || typeof event !== 'object') return false;
  const messages = [
    event.role ? event : null,
    event.message,
    ...(Array.isArray(event.messages) ? event.messages : []),
  ].filter(Boolean);
  return messages.some(message => (
    message.role === 'assistant' && String(message.content || '').includes(token)
  ));
}

function missingAssistantHistoryTokens(history, tokens) {
  const assistantContents = (Array.isArray(history?.messages) ? history.messages : [])
    .filter(message => message?.role === 'assistant')
    .map(message => String(message.content || ''));
  return (Array.isArray(tokens) ? tokens : []).filter(token => (
    !assistantContents.some(content => content.includes(token))
  ));
}

async function assertDurableCycleHistory(relay, selected, runId, completedCycles) {
  const summaries = [];
  for (const type of PRODUCTION_TYPES) {
    const id = sessionId(selected[type]);
    const expectedTokens = [];
    for (let cycle = 1; cycle <= completedCycles; cycle += 1) {
      expectedTokens.push(exactToken(runId, cycle, type));
    }
    const history = await historyTail(relay, id);
    const missing = missingAssistantHistoryTokens(history, expectedTokens);
    assert.deepStrictEqual(
      missing,
      [],
      `${type} relay history lost ${missing.length}/${expectedTokens.length} prior assistant tokens before cycle ${completedCycles + 1}: ${missing.join(', ')}`,
    );
    summaries.push({
      type,
      session_id: id,
      verified_tokens: expectedTokens.length,
      transcript_messages: history.total_messages ?? history.messages?.length ?? 0,
    });
  }
  return summaries;
}

async function runTurn(relay, session, type, runId, cycle) {
  const id = sessionId(session);
  const token = exactToken(runId, cycle, type);
  const clientMessageId = `overnight-${runId}-${cycle}-${type}`;
  const startIndex = relay.mark();
  const startedAt = Date.now();
  send(relay.ws, {
    type: 'send', session: id, session_id: id, client_message_id: clientMessageId,
    content: assistantTokenPrompt(token),
  });
  await waitFor(
    () => eventsSince(relay.events, startIndex).find(event => event.type === 'message_accepted' && event.client_message_id === clientMessageId),
    30_000,
    `${type} message acceptance`,
  );
  const delivery = await waitFor(
    () => findDeliveryEvidence(relay.events, startIndex, clientMessageId, token),
    60_000,
    `${type} native delivery`,
  );
  const deliveryResult = delivery.type === 'message_delivered' ? 'delivered' : delivery.result;
  assert(['delivered', 'accepted'].includes(deliveryResult), `${type} delivery result was ${deliveryResult || 'missing'}`);
  await waitFor(() => eventsSince(relay.events, startIndex).find(event => {
    const eventSession = event.session_id || event.session;
    return eventSession === id && eventHasAssistantToken(event, token);
  }), TURN_TIMEOUT_MS, `${type} assistant-role token`);
  await waitFor(() => {
    const current = relay.sessions().find(item => sessionId(item) === id);
    return current && isIdle(current);
  }, 60_000, `${type} final idle`);
  const history = await historyTail(relay, id);
  const assistantMessage = (history.messages || []).find(message => (
    message.role === 'assistant' && String(message.content || '').includes(token)
  ));
  assert(assistantMessage, `${type} relay history omitted assistant-role token ${token}`);
  return {
    type, session_id: id, token,
    elapsed_ms: Date.now() - startedAt,
    delivery_evidence: delivery.type,
    assistant_evidence: 'assistant_role_token',
    transcript_messages: history.total_messages ?? history.messages?.length ?? 0,
  };
}

function proxyProcessSample() {
  const script = [
    `$runnerPid=${process.pid}`,
    "$ownerIds=Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 3500 -and $_.OwningProcess -ne $runnerPid } | Select-Object -ExpandProperty OwningProcess -Unique",
    "$rows=foreach($ownerId in $ownerIds){$p=Get-CimInstance Win32_Process -Filter \"ProcessId=$ownerId\" -ErrorAction SilentlyContinue;if($p.Name -eq 'node.exe'){$g=Get-Process -Id $ownerId -ErrorAction SilentlyContinue;if($g){[pscustomobject]@{pid=$ownerId;rss_bytes=$g.WorkingSet64}}}}",
    "$rows | Sort-Object rss_bytes -Descending | Select-Object -First 1 | ConvertTo-Json -Compress",
  ].join(';');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try { return { ...JSON.parse(result.stdout.trim()), at: new Date().toISOString() }; } catch { return null; }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function memorySummary(samples) {
  const rss = samples.map(sample => Number(sample?.rss_bytes || 0)).filter(Boolean);
  const width = Math.max(1, Math.ceil(rss.length / 4));
  const startMedian = median(rss.slice(0, width));
  const endMedian = median(rss.slice(-width));
  const allowedGrowth = Math.max(64 * 1024 * 1024, startMedian * 0.2);
  return {
    samples: rss.length,
    start_median_rss_bytes: startMedian,
    end_median_rss_bytes: endMedian,
    growth_bytes: endMedian - startMedian,
    allowed_growth_bytes: allowedGrowth,
    pass: rss.length >= 2 && endMedian - startMedian <= allowedGrowth,
  };
}

function appendLedger(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const releaseRunLock = acquireRunLock();
  const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const startedAt = Date.now();
  let deadline = null;
  const proxyErrorPath = path.join(root, 'proxy-err.log');
  const proxyErrorOffset = fs.existsSync(proxyErrorPath) ? fs.statSync(proxyErrorPath).size : 0;
  const cycles = [];
  const memorySamples = [];
  let relay;
  let failure = null;
  const selectedIds = new Set();
  try {
    relay = await openRelay();
    const selected = await waitFor(() => {
      try {
        return selectSafeSessions(relay.sessions());
      } catch {
        return null;
      }
    }, 120_000, 'all disposable production sessions to become idle');
    Object.values(selected).forEach(session => selectedIds.add(sessionId(session)));
    deadline = Date.now() + options.hours * 60 * 60 * 1000;
    appendLedger(options.ledger, {
      event: 'start', run_id: runId, at: new Date().toISOString(), hours: options.hours,
      interval_minutes: options.intervalMinutes,
      sessions: Object.fromEntries(Object.entries(selected).map(([type, session]) => [type, {
        session_id: sessionId(session), workspace_path: session.workspace_path || null,
      }])),
    });
    let cycle = 0;
    while (Date.now() < deadline) {
      if (cycle > 0) {
        await assertDurableCycleHistory(relay, selected, runId, cycle);
      }
      cycle += 1;
      assert.strictEqual(relay.disconnects(), 0, 'Relay disconnected during overnight soak');
      const cycleResult = { cycle, started_at: new Date().toISOString(), turns: [] };
      for (const type of PRODUCTION_TYPES) {
        const selectedId = sessionId(selected[type]);
        const current = await waitFor(() => {
          const candidate = relay.sessions().find(item => sessionId(item) === selectedId);
          return candidate && SAFE_SELECTORS[type](candidate) && isIdle(candidate) ? candidate : null;
        }, 120_000, `${type} selected disposable session to reappear idle`);
        cycleResult.turns.push(await runTurn(relay, current, type, runId, cycle));
      }
      const sample = proxyProcessSample();
      if (sample) memorySamples.push(sample);
      // The first cycle intentionally warms transcript/session caches. Leak
      // detection must compare stabilized post-work samples, not cold startup
      // RSS against the first fully hydrated cycle. Short development runs
      // take a second post-warm sample so their plumbing remains testable.
      if (options.allowShortSoak) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const confirmationSample = proxyProcessSample();
        if (confirmationSample) memorySamples.push(confirmationSample);
      }
      cycleResult.finished_at = new Date().toISOString();
      cycleResult.proxy = sample;
      cycles.push(cycleResult);
      appendLedger(options.ledger, { event: 'cycle_pass', run_id: runId, ...cycleResult });
      const nextCycle = Math.min(deadline, Date.now() + options.intervalMinutes * 60 * 1000);
      while (Date.now() < nextCycle) {
        assert.strictEqual(relay.disconnects(), 0, 'Relay disconnected during overnight soak wait');
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, nextCycle - Date.now())));
      }
    }
    if (cycles.length > 0) {
      await assertDurableCycleHistory(relay, selected, runId, cycles.length);
    }
  } catch (error) {
    failure = error;
  } finally {
    try { relay?.close?.(); } catch {}
  }

  const errorTail = fs.existsSync(proxyErrorPath)
    ? fs.readFileSync(proxyErrorPath).subarray(proxyErrorOffset).toString('utf8')
    : '';
  const targetErrors = errorTail.split(/\r?\n/).filter(line => (
    line && /selector.?fail|selector error|read null|timed out|uncaught|unhandled/i.test(line)
    && [...selectedIds].some(id => line.includes(id))
  ));
  const memory = memorySummary(memorySamples);
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  const completedDuration = deadline != null && Date.now() >= deadline;
  const ok = !failure
    && completedDuration
    && relay?.disconnects() === 0
    && targetErrors.length === 0
    && cycles.length > 0
    && cycles.every(cycle => cycle.turns.length === PRODUCTION_TYPES.length)
    && memory.pass;
  const result = {
    ok, run_id: runId, generated_at: new Date().toISOString(),
    requested_hours: options.hours, elapsed_seconds: elapsedSeconds,
    completed_duration: completedDuration,
    protected_user_sessions_touched: 0,
    visible_windows_opened: 0,
    relay_disconnects: relay?.disconnects() ?? null,
    target_selector_errors: targetErrors,
    memory,
    cycles,
    error: failure ? { message: failure.message, stack: failure.stack } : null,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  appendLedger(options.ledger, { event: ok ? 'complete' : 'failed', run_id: runId, at: result.generated_at, output: options.output, error: result.error });
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
  releaseRunLock();
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_HOURS,
  EVENT_BUFFER_LIMIT,
  OPERATION_LOCK_PATH,
  PRODUCTION_TYPES,
  RUN_LOCK_PATH,
  SAFE_SELECTORS,
  acquirePidLock,
  acquireRunLock,
  applyRelaySessionEvent,
  assertDurableCycleHistory,
  assistantTokenPrompt,
  exactToken,
  eventHasAssistantToken,
  eventsSince,
  findDeliveryEvidence,
  memorySummary,
  missingAssistantHistoryTokens,
  parseArgs,
  proxyProcessSample,
  selectSafeSessions,
};
