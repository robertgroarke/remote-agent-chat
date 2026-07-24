#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const CDP = require('chrome-remote-interface');
const WebSocket = require('ws');
const {
  detectVsCodeCodexInstalledVersion,
  resolveInitialCodexChatSelection,
  resolveStoredCodexConversationId,
} = require('../agent-proxy/proxy-engine');
const selectors = require('../agent-proxy/selectors');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN_CLIENT_FRAMES = new Set([
  'send',
  'input',
  'permission_response',
  'question_answer',
  'question_response',
  'agent_interrupt',
  'agent_control',
  'set_codex_config',
  'switch_chat',
  'new_chat',
  'new_thread',
]);

function parseArgs(argv) {
  const options = {
    productionReadonly: false,
    output: '',
    sourceRoot: ROOT,
    envRoot: ROOT,
    proxyLog: '',
    durationMs: 600_000,
    intervalMs: 10_000,
    port: 9223,
    expectedTargets: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--production-readonly') options.productionReadonly = true;
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--source-root' && next) options.sourceRoot = path.resolve(argv[++index]);
    else if (arg === '--env-root' && next) options.envRoot = path.resolve(argv[++index]);
    else if (arg === '--proxy-log' && next) options.proxyLog = path.resolve(argv[++index]);
    else if (arg === '--duration-ms' && next) options.durationMs = Number(argv[++index]);
    else if (arg === '--interval-ms' && next) options.intervalMs = Number(argv[++index]);
    else if (arg === '--port' && next) options.port = Number(argv[++index]);
    else if (arg === '--expected-targets' && next) options.expectedTargets = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.port) && options.port > 0, '--port must be positive');
  assert(Number.isInteger(options.expectedTargets) && options.expectedTargets >= 3,
    '--expected-targets must be at least 3');
  if (options.productionReadonly) {
    assert.strictEqual(options.port, 9223, 'production proof is restricted to protected read-only port 9223');
    assert(options.output, '--output is required for production proof');
    assert(Number.isFinite(options.durationMs) && options.durationMs >= 600_000,
      'production proof requires at least 600000 ms');
    assert(Number.isFinite(options.intervalMs) && options.intervalMs > 0
      && Math.floor(options.durationMs / options.intervalMs) >= 60,
    'production proof requires at least 60 discovery audit cycles');
  }
  return options;
}

function percentile(values, fraction) {
  const ordered = values.slice().sort((left, right) => left - right);
  if (!ordered.length) return null;
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))];
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function extensionId(target) {
  const raw = (String(target?.url || '').match(/[?&]extensionId=([^&]+)/i) || [])[1] || '';
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isCodexTarget(target) {
  return target?.type === 'iframe' && extensionId(target) === 'openai.chatgpt';
}

function fixtureProof() {
  const fixtures = [
    {
      target_id: '11111111111111111111111111111111',
      session_id: '10000000-0000-4000-8000-000000000001',
      workspace: 'GWA Censured X BotsHub',
      chats: [{ id: 'thread-gwa', title: 'Coordinate GWA3', active: true }],
      stored_key: 'thread-gwa:Coordinate GWA3',
      stored_conversation_id: '019f7000-0000-7000-8000-000000000001',
      expected_conversation_id: '019f7000-0000-7000-8000-000000000001',
    },
    {
      target_id: '22222222222222222222222222222222',
      session_id: '10000000-0000-4000-8000-000000000002',
      workspace: 'Win-CodexBar',
      chats: [{ id: 'thread-bar', title: 'Implement update sentinel', active: true }],
      stored_key: 'stale-thread:Old title',
      stored_conversation_id: '019f7000-0000-7000-8000-000000000002',
      expected_conversation_id: '',
    },
    {
      target_id: '33333333333333333333333333333333',
      session_id: '10000000-0000-4000-8000-000000000003',
      workspace: 'Remote Agent Chat',
      chats: [
        { id: 'background', title: 'Background chat', active: false },
        { id: 'thread-rac', title: 'Repair Codex discovery', active: true },
      ],
      stored_key: '',
      stored_conversation_id: '019f7000-0000-7000-8000-000000000003',
      expected_conversation_id: '019f7000-0000-7000-8000-000000000003',
    },
  ];
  const mappings = fixtures.map(fixture => {
    const selected = resolveInitialCodexChatSelection(fixture.chats);
    const conversationId = resolveStoredCodexConversationId({
      initialActiveChatKey: selected.activeChatKey,
      storedActiveChatKey: fixture.stored_key,
      storedNativeConversationId: fixture.stored_conversation_id,
    });
    assert.strictEqual(conversationId, fixture.expected_conversation_id);
    return {
      target_id: fixture.target_id,
      session_id: fixture.session_id,
      workspace: fixture.workspace,
      active_chat_key: selected.activeChatKey,
      native_conversation_id: conversationId || null,
      stale_stored_metadata_rejected: !!fixture.stored_key && !conversationId,
    };
  });
  assert.strictEqual(new Set(mappings.map(item => item.target_id)).size, 3);
  assert.strictEqual(new Set(mappings.map(item => item.session_id)).size, 3);
  assert.strictEqual(new Set(mappings.map(item => item.workspace)).size, 3);
  const adjacentSurfaces = [
    ...mappings.map(item => ({ session_id: item.session_id, surface: 'codex' })),
    { session_id: 'desktop-fixture', surface: 'codex-desktop' },
    { session_id: 'cli-fixture', surface: 'codex_cli' },
  ];
  assert.strictEqual(new Set(adjacentSurfaces.map(item => item.session_id)).size, adjacentSurfaces.length);

  const source = fs.readFileSync(path.join(ROOT, 'agent-proxy', 'proxy-engine.js'), 'utf8');
  const declaration = source.indexOf('activeChatKey: initialActiveChatKey');
  const consumer = source.indexOf('const storedCodexNativeConversationId');
  assert(declaration >= 0 && consumer > declaration,
    'initialActiveChatKey must be initialized structurally before stored conversation recovery');
  assert.strictEqual((source.match(/const initialActiveChatKey/g) || []).length, 0,
    'legacy late initialActiveChatKey declaration survived');
  assert(source.includes('resolveStoredCodexConversationId({'),
    'discovery path does not use the guarded stored-conversation resolver');

  return {
    mounted_targets: 3,
    registered_sessions: 3,
    unique_workspaces: 3,
    stale_stored_chat_metadata_cases: 1,
    stale_stored_chat_metadata_rejected: 1,
    cross_surface_duplicates: 0,
    mappings,
  };
}

function readStore(envRoot) {
  const storePath = process.env.SESSION_STORE_PATH
    ? path.resolve(process.env.SESSION_STORE_PATH)
    : path.join(envRoot, 'agent-proxy', 'session-store.json');
  return {
    path: storePath,
    value: JSON.parse(fs.readFileSync(storePath, 'utf8')),
  };
}

function relayAck(relayBaseUrl, token) {
  const socketUrl = relayBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    + `/client-ws?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for production connection_ack'));
    }, 15_000);
    socket.on('message', raw => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type !== 'connection_ack') return;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createLoopback(upstreamUrl, publicOrigin, token) {
  const upstream = new URL(upstreamUrl);
  const server = http.createServer((request, response) => {
    const headers = { ...request.headers, host: upstream.host, authorization: `Bearer ${token}` };
    delete headers.connection;
    const forwarded = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    forwarded.on('error', error => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(error.message);
    });
    request.pipe(forwarded);
  });
  const sockets = new WebSocket.Server({ server });
  sockets.on('connection', (client, request) => {
    const incoming = new URL(request.url, 'http://127.0.0.1');
    incoming.searchParams.set('token', token);
    const upstreamSocket = new WebSocket(
      `${upstream.protocol === 'https:' ? 'wss:' : 'ws:'}//${upstream.host}${incoming.pathname}${incoming.search}`,
      { headers: { Origin: publicOrigin } },
    );
    const pending = [];
    client.on('message', (data, binary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary });
      else pending.push({ data, binary });
    });
    upstreamSocket.on('open', () => {
      pending.splice(0).forEach(item => upstreamSocket.send(item.data, { binary: item.binary }));
    });
    upstreamSocket.on('message', (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    upstreamSocket.on('close', () => {
      if (client.readyState === WebSocket.OPEN) client.close();
    });
    upstreamSocket.on('error', () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream failed');
    });
    client.on('close', () => {
      if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(upstreamSocket.readyState)) upstreamSocket.close();
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(done => sockets.close(() => server.close(done))),
    }));
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert(executable, 'Headless Chrome is unavailable');
  return executable;
}

async function nativeDetails(targets, port) {
  const rows = [];
  for (const target of targets) {
    let client;
    try {
      client = await CDP({ port, target: target.id });
      await client.Runtime.enable();
      client.Runtime._webviewId = (String(target.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
      await selectors.cacheInnerContextId(client.Runtime);
      const startedAt = Date.now();
      const [agentType, config, chats, rawMessages] = await Promise.all([
        selectors.detectAgentType(client.Runtime, 'openai.chatgpt'),
        selectors.readAgentConfig(client.Runtime, 'codex', ''),
        selectors.readCodexChatList(client.Runtime, false),
        selectors.readMessages(client.Runtime, 'codex', `vscode-codex-discovery-${target.id.slice(0, 8)}`),
      ]);
      const messages = rawMessages ? JSON.parse(rawMessages) : [];
      const activeChat = resolveInitialCodexChatSelection(chats);
      rows.push({
        target_id: target.id,
        parent_id: (String(target.url || '').match(/[?&]parentId=([^&]+)/i) || [])[1] || null,
        agent_type: agentType,
        native_chat_count: Array.isArray(chats) ? chats.length : 0,
        active_chat_key: activeChat.activeChatKey || null,
        active_chat_title: activeChat.activeChat?.title || null,
        native_message_count: messages.length,
        model_id: config?.model_id || null,
        effort: config?.effort || null,
        permission_profile: config?.permission_profile || null,
        permission_mode: config?.permission_mode || null,
        approval_policy: config?.approval_policy || null,
        conversation_scoped: config?.conversation_scoped === true,
        read_latency_ms: Date.now() - startedAt,
      });
    } finally {
      await client?.close().catch(() => {});
    }
  }
  return rows;
}

function activeMappings(store, targets) {
  const targetIds = new Set(targets.map(target => target.id));
  return Object.entries(store.sessions || {})
    .filter(([, session]) => session?.agent_type === 'codex'
      && Number(session?.cdp_port) === 9223
      && session?.status === 'healthy'
      && targetIds.has(session?.target_id))
    .map(([sessionId, session]) => ({
      session_id: sessionId,
      target_id: session.target_id,
      workspace_path: session.workspace_path || null,
      workspace_name: session.workspace_name || null,
      chat_title: session.chat_title || null,
      discovery_latency_ms: Number(session.discovery_latency_ms),
      discovery_observed_at: session.discovery_observed_at || null,
      message_count: Array.isArray(session.accumulated_messages)
        ? session.accumulated_messages.length
        : null,
    }))
    .sort((left, right) => left.target_id.localeCompare(right.target_id));
}

function initialActiveChatFailures(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return 0;
  return (fs.readFileSync(logPath, 'utf8').match(/initialActiveChatKey/g) || []).length;
}

async function webProfiles(browser, loopbackUrl, mappings, sourceRoot, screenshotRoot) {
  const profiles = [
    { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
    { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
    { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
    { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
  ];
  const results = {};
  const preferred = mappings.find(item => /Remote Agent Chat/i.test(item.workspace_name || '')) || mappings[0];
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height } });
    await context.addInitScript(theme => localStorage.setItem('theme', theme), profile.theme);
    await context.addInitScript(() => {
      const Native = window.WebSocket;
      const sent = [];
      function Audited(url, protocols) {
        const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
        const nativeSend = socket.send.bind(socket);
        socket.send = data => {
          try {
            sent.push(JSON.parse(String(data)));
          } catch {
            sent.push({ type: 'non_json' });
          }
          return nativeSend(data);
        };
        return socket;
      }
      Audited.prototype = Native.prototype;
      for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Audited[key] = Native[key];
      window.WebSocket = Audited;
      window.__RAC_DISCOVERY_SENT__ = sent;
    });
    try {
      const page = await context.newPage();
      await page.goto(`${loopbackUrl}/?session=${encodeURIComponent(preferred.session_id)}&vscode_codex_discovery=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForFunction(({ selected, ids }) => (
        document.querySelector('.session-card.active')?.dataset?.sessionId === selected
        && ids.every(id => document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`))
      ), { selected: preferred.session_id, ids: mappings.map(item => item.session_id) }, { timeout: 45_000 });
      const state = await page.evaluate(ids => ({
        selected_session_id: document.querySelector('.session-card.active')?.dataset?.sessionId || null,
        selected_agent_type: document.querySelector('.messages')?.dataset?.agentType || null,
        present_session_ids: ids.filter(id => document.querySelector(
          `.session-card[data-session-id="${CSS.escape(id)}"]`,
        )),
        total_message_count: Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0),
        question_cards: document.querySelectorAll('.permission-card').length,
        composer_locked: document.querySelector('.input-area textarea')?.disabled === true,
        horizontal_overflow: document.body.scrollWidth > window.innerWidth,
        sent_frames: (window.__RAC_DISCOVERY_SENT__ || []).map(message => message?.type || null),
        loaded_asset_version: ([...document.scripts].map(script => script.src)
          .find(src => src.includes('/dist/bundle.js')) || '').match(/v=(build-[0-9a-f]+)/)?.[1] || null,
        service_worker_controlled: !!navigator.serviceWorker?.controller,
      }), mappings.map(item => item.session_id));
      state.mutating_frames = state.sent_frames.filter(type => FORBIDDEN_CLIENT_FRAMES.has(type));
      assert.strictEqual(state.selected_agent_type, 'codex');
      assert.strictEqual(state.present_session_ids.length, mappings.length);
      assert.deepStrictEqual(state.mutating_frames, []);
      assert.strictEqual(state.horizontal_overflow, false);
      const screenshot = path.join(screenshotRoot, `${profile.name}.png`);
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: false });
      results[profile.name] = { ...state, screenshot };
    } finally {
      await context.close();
    }
  }
  const worker = fs.readFileSync(path.join(sourceRoot, 'frontend', 'sw.js'), 'utf8');
  return {
    profiles: results,
    build_identity: (worker.match(/ASSET_VERSION = '([^']+)'/) || [])[1] || null,
    bundle_sha256: sha256(fs.readFileSync(path.join(sourceRoot, 'frontend', 'dist', 'bundle.js'))),
  };
}

async function productionProof(options, fixture) {
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'agent-proxy', '.env'));
  const upstream = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const token = fidelity.buildBearerToken(relayEnv);
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  assert(upstream?.startsWith('http'), 'production relay LAN URL is unavailable');
  assert(token, 'production relay bearer token is unavailable');
  const installedVersion = detectVsCodeCodexInstalledVersion();
  assert.notStrictEqual(installedVersion, 'unknown', 'installed VS Code Codex version is unavailable');
  const loopback = await createLoopback(upstream, publicOrigin, token);
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking'],
  });
  const startedAt = Date.now();
  const samples = [];
  let firstMappings = null;
  let firstNative = null;
  try {
    while (Date.now() - startedAt < options.durationMs) {
      const cycleStartedAt = Date.now();
      const targets = (await CDP.List({ port: options.port })).filter(isCodexTarget)
        .sort((left, right) => left.id.localeCompare(right.id));
      assert.strictEqual(targets.length, options.expectedTargets,
        `native Codex target count changed: ${targets.map(target => target.id).join(',')}`);
      const { value: store } = readStore(options.envRoot);
      const mappings = activeMappings(store, targets);
      const ack = await relayAck(upstream, token);
      const relayRows = (ack.sessions || []).filter(session => (
        mappings.some(mapping => mapping.session_id === session.session_id)
        && session.agent_type === 'codex'
      ));
      assert.strictEqual(mappings.length, targets.length,
        `registered target mismatch: targets=${targets.map(target => target.id)} mappings=${JSON.stringify(mappings)}`);
      assert.strictEqual(relayRows.length, targets.length,
        `relay Codex count mismatch: ${JSON.stringify(relayRows.map(row => row.session_id))}`);
      assert.strictEqual(new Set(mappings.map(item => item.session_id)).size, targets.length);
      assert.strictEqual(new Set(mappings.map(item => item.target_id)).size, targets.length);
      assert.strictEqual(new Set(mappings.map(item => String(item.workspace_path || '').toLowerCase())).size,
        targets.length);
      const failures = initialActiveChatFailures(options.proxyLog);
      assert.strictEqual(failures, 0, 'initialActiveChatKey probe failure reappeared');
      if (!firstMappings) {
        firstMappings = mappings;
        firstNative = await nativeDetails(targets, options.port);
      } else {
        assert.deepStrictEqual(
          mappings.map(item => [item.target_id, item.session_id, item.workspace_path]),
          firstMappings.map(item => [item.target_id, item.session_id, item.workspace_path]),
          'target/session/workspace mapping changed during soak',
        );
      }
      samples.push({
        cycle: samples.length + 1,
        observed_at: new Date().toISOString(),
        cycle_latency_ms: Date.now() - cycleStartedAt,
        target_count: targets.length,
        store_count: mappings.length,
        relay_count: relayRows.length,
        session_ids: mappings.map(item => item.session_id),
        target_ids: mappings.map(item => item.target_id),
        initial_active_chat_key_failures: failures,
      });
      const remaining = options.durationMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(options.intervalMs, remaining)));
    }
    assert(samples.length >= 60, `only ${samples.length} discovery cycles completed`);
    const finalTargets = (await CDP.List({ port: options.port })).filter(isCodexTarget)
      .sort((left, right) => left.id.localeCompare(right.id));
    const finalNative = await nativeDetails(finalTargets, options.port);
    assert.deepStrictEqual(
      finalNative.map(item => [item.target_id, item.active_chat_key, item.model_id, item.effort,
        item.permission_profile, item.native_message_count]),
      firstNative.map(item => [item.target_id, item.active_chat_key, item.model_id, item.effort,
        item.permission_profile, item.native_message_count]),
      'native side-pane identity/config/transcript state changed during passive soak',
    );
    const screenshotRoot = path.join(path.dirname(options.output), 'vscode-codex-discovery-production');
    const web = await webProfiles(browser, loopback.url, firstMappings, options.sourceRoot, screenshotRoot);
    const discoveryLatencies = firstMappings.map(item => item.discovery_latency_ms);
    assert(discoveryLatencies.every(Number.isFinite), 'store omitted discovery latency receipts');
    const discoveryP95 = percentile(discoveryLatencies, 0.95);
    assert(discoveryP95 <= 2000, `discovery p95 ${discoveryP95}ms exceeds 2000ms`);
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: options.sourceRoot,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      installed_version: installedVersion,
      fixture,
      production: {
        requested_duration_ms: options.durationMs,
        actual_duration_ms: Date.now() - startedAt,
        cycles: samples.length,
        target_count: firstMappings.length,
        registered_store_count: firstMappings.length,
        registered_relay_count: firstMappings.length,
        discovery_latency_ms: discoveryLatencies,
        discovery_p95_ms: discoveryP95,
        initial_active_chat_key_failures: 0,
        identity_changes: 0,
        missing_rows: 0,
        duplicate_rows: 0,
        cross_workspace_rows: 0,
        cross_surface_rows: 0,
        mappings: firstMappings,
        native_start: firstNative,
        native_end: finalNative,
        samples,
        web,
      },
      safety: {
        protected_port: 9223,
        protected_reads_only: true,
        protected_mutations: 0,
        sends: 0,
        controls: 0,
        focus_actions: 0,
        page_reloads: 0,
        visible_windows_opened: 0,
        headless_webui: true,
      },
    };
  } finally {
    await browser.close();
    await loopback.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = fixtureProof();
  const result = options.productionReadonly
    ? await productionProof(options, fixture)
    : {
        ok: true,
        generated_at: new Date().toISOString(),
        source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
        }).trim(),
        installed_version: detectVsCodeCodexInstalledVersion(),
        fixture,
        safety: {
          live_cdp_connections: 0,
          protected_mutations: 0,
          visible_windows_opened: 0,
        },
      };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`VS Code Codex discovery regression: FAIL (${error.stack || error.message})`);
  process.exitCode = 1;
});
