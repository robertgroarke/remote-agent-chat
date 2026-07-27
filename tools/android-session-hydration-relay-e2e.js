#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-android-hydration-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const healthy = await new Promise(resolve => {
      const request = http.get(`http://127.0.0.1:${port}/healthz`, response => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.once('error', () => resolve(false));
      request.setTimeout(500, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (healthy) return;
    await sleep(25);
  }
  throw new Error('isolated relay did not become healthy');
}

function openSocket(port, route, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const messages = [];
    ws.on('message', data => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
    });
    ws.once('open', () => {
      ws.send(JSON.stringify(hello));
      resolve({ ws, messages });
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1_000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function verifyRelayReplay(port) {
  const proxy = await openSocket(port, '/proxy-ws', {
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'proxy',
    proxy_id: 'android-hydration-fixture-proxy',
    machine_label: 'android-hydration-fixture',
  });
  await waitFor(() => proxy.messages.find(message => message.type === 'connection_ack'),
    8_000, 'proxy connection ack');
  proxy.ws.send(JSON.stringify({
    type: 'session_list',
    protocol_version: 1,
    proxy_id: 'android-hydration-fixture-proxy',
    sessions: [{
      session_id: 'android-hydration-session',
      agent_type: 'codex_cli',
      name: 'Android hydration fixture',
      status: 'idle',
    }],
  }));
  await sleep(100);

  const replayClient = await openSocket(port, '/client-ws', {
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'android',
    client_name: 'android-app',
    last_sequence: 0,
    request_connection_ack: true,
  });
  await waitFor(
    () => replayClient.messages.filter(message => message.type === 'connection_ack').length >= 2,
    8_000,
    'explicit connection ack replay',
  );
  const replayAcks = replayClient.messages.filter(message => message.type === 'connection_ack');
  const replayInventory = replayAcks.at(-1).sessions || [];
  assert(replayInventory.some(session => session.session_id === 'android-hydration-session'),
    'replayed acknowledgement omitted the authoritative session inventory');

  const webClient = await openSocket(port, '/client-ws', {
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'browser',
    client_name: 'ordinary-web-client',
    last_sequence: 0,
  });
  await waitFor(() => webClient.messages.find(message => message.type === 'connection_ack'),
    8_000, 'ordinary eager ack');
  await sleep(100);
  assert.strictEqual(webClient.messages.filter(message => message.type === 'connection_ack').length, 1,
    'ordinary Web hello unexpectedly duplicated connection state');

  await closeSocket(webClient.ws);
  await closeSocket(replayClient.ws);
  await closeSocket(proxy.ws);
  return {
    eager_ack_intentionally_ignored: 1,
    replay_ack_received: 1,
    replay_session_count: replayInventory.length,
    ordinary_web_duplicate_acks: 0,
  };
}

async function verifyFastOpenClientRecovery() {
  let source = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8')
    .replace(/import \{ getStoredJwt, RELAY_URL \} from '\.\/auth';/,
      "const getStoredJwt = async () => 'fixture-jwt'; const RELAY_URL = 'https://relay.fixture';")
    .replace(/import \{ estimateRelayClockOffset \} from '\.\/latency-clock';/,
      "const estimateRelayClockOffset = () => ({ ok: false, code: 'unused' });")
    .replace(/import \{ DeviceEventEmitter, Platform(?:, unstable_batchedUpdates)? \} from 'react-native';/,
      "const DeviceEventEmitter = globalThis.__fixtureDeviceEventEmitter; const Platform = globalThis.__fixturePlatform || { OS: 'web' }; const unstable_batchedUpdates = callback => callback();")
    .replace('export function classifyRelayRtt', 'function classifyRelayRtt')
    .replace('export class RelayClient', 'class RelayClient');
  source += '\nmodule.exports = { RelayClient };';

  let socketCount = 0;
  class AlreadyOpenSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = AlreadyOpenSocket.OPEN;
      this.sent = [];
      socketCount += 1;
      AlreadyOpenSocket.latest = this;
    }

    send(raw) {
      this.sent.push(JSON.parse(raw));
    }

    close() {
      this.readyState = AlreadyOpenSocket.CLOSED;
    }
  }

  const events = [];
  const sandbox = {
    module: { exports: {} },
    exports: {},
    WebSocket: AlreadyOpenSocket,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'android-app/lib/relay.js' });
  const client = new sandbox.module.exports.RelayClient(message => events.push(message));
  await client.connect();
  await sleep(20);
  assert(events.some(message => message.type === '_connected'),
    'already-open socket did not recover the missed open event');
  const hellos = AlreadyOpenSocket.latest.sent.filter(message => message.type === 'connection_hello');
  assert.strictEqual(hellos.length, 1);
  assert.strictEqual(hellos[0].request_connection_ack, true);
  await client.connect();
  assert.strictEqual(socketCount, 1, 'refresh created a duplicate native socket');
  assert.strictEqual(
    AlreadyOpenSocket.latest.sent.filter(message => message.type === 'connection_hello').length,
    2,
    'refresh did not request another authoritative snapshot',
  );
  client.disconnect();
  return { missed_open_recovered: true, duplicate_native_sockets: 0 };
}

async function verifyReactNativePropertyHandlerRecovery() {
  let source = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8')
    .replace(/import \{ getStoredJwt, RELAY_URL \} from '\.\/auth';/,
      "const getStoredJwt = async () => 'fixture-jwt'; const RELAY_URL = 'https://relay.fixture';")
    .replace(/import \{ estimateRelayClockOffset \} from '\.\/latency-clock';/,
      "const estimateRelayClockOffset = () => ({ ok: false, code: 'unused' });")
    .replace(/import \{ DeviceEventEmitter, Platform(?:, unstable_batchedUpdates)? \} from 'react-native';/,
      "const DeviceEventEmitter = globalThis.__fixtureDeviceEventEmitter; const Platform = globalThis.__fixturePlatform || { OS: 'web' }; const unstable_batchedUpdates = callback => callback();")
    .replace('export function classifyRelayRtt', 'function classifyRelayRtt')
    .replace('export class RelayClient', 'class RelayClient');
  source += '\nmodule.exports = { RelayClient };';

  class ReactNativePropertySocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = ReactNativePropertySocket.CONNECTING;
      this.sent = [];
      this.eventTargetListeners = new Map();
      ReactNativePropertySocket.latest = this;
    }

    open() {
      this.readyState = ReactNativePropertySocket.OPEN;
      this.onopen?.({});
    }

    receive(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }

    send(raw) {
      this.sent.push(JSON.parse(raw));
    }

    close() {
      this.readyState = ReactNativePropertySocket.CLOSED;
      this.onclose?.({ code: 1000, reason: 'fixture' });
    }
  }

  const events = [];
  const sandbox = {
    module: { exports: {} },
    exports: {},
    WebSocket: ReactNativePropertySocket,
    __fixturePlatform: { OS: 'android' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'android-app/lib/relay.js' });
  const client = new sandbox.module.exports.RelayClient(message => events.push(message));
  await client.connect();
  const socket = ReactNativePropertySocket.latest;
  assert(socket, 'React Native property-only fixture did not construct a socket');
  assert.strictEqual(socket.eventTargetListeners.size, 0,
    'React Native release fixture incorrectly selected EventTarget handlers');
  socket.open();
  const hellos = socket.sent.filter(message => message.type === 'connection_hello');
  assert.strictEqual(hellos.length, 1, 'React Native property open did not send one handshake');
  socket.receive({
    type: 'connection_ack',
    sessions: [{ session_id: 'react-native-property-session', agent_type: 'codex_cli' }],
  });
  assert(events.some(message => message.type === 'connection_ack'
    && message.sessions?.[0]?.session_id === 'react-native-property-session'),
  'React Native property message did not deliver the authoritative inventory');
  client.disconnect();
  return {
    property_handler_open_recovered: true,
    property_handler_message_recovered: true,
    connection_hello_count: hellos.length,
    event_target_listeners_registered: socket.eventTargetListeners.size,
  };
}

async function verifyReactNativeRawEmitterRecovery() {
  let source = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8')
    .replace(/import \{ getStoredJwt, RELAY_URL \} from '\.\/auth';/,
      "const getStoredJwt = async () => 'fixture-jwt'; const RELAY_URL = 'https://relay.fixture';")
    .replace(/import \{ estimateRelayClockOffset \} from '\.\/latency-clock';/,
      "const estimateRelayClockOffset = () => ({ ok: false, code: 'unused' });")
    .replace(/import \{ DeviceEventEmitter, Platform(?:, unstable_batchedUpdates)? \} from 'react-native';/,
      "const DeviceEventEmitter = globalThis.__fixtureDeviceEventEmitter; const Platform = globalThis.__fixturePlatform || { OS: 'web' }; const unstable_batchedUpdates = callback => callback();")
    .replace('export function classifyRelayRtt', 'function classifyRelayRtt')
    .replace('export class RelayClient', 'class RelayClient');
  source += '\nmodule.exports = { RelayClient };';

  const listeners = new Map();
  let listenerRegistrations = 0;
  const nativeEmitter = {
    addListener(type, listener) {
      const typeListeners = listeners.get(type) || new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
      listenerRegistrations += 1;
      return {
        remove() {
          typeListeners.delete(listener);
        },
      };
    },
    emit(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    activeListenerCount() {
      return [...listeners.values()].reduce((count, typeListeners) => count + typeListeners.size, 0);
    },
  };

  class ReactNativeRawSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this._socketId = 73;
      this.readyState = ReactNativeRawSocket.CONNECTING;
      this.sent = [];
      this.eventTargetRegistrations = 0;
      ReactNativeRawSocket.latest = this;
    }

    open() {
      nativeEmitter.emit('websocketOpen', { id: this._socketId, protocol: '' });
    }

    receive(message) {
      nativeEmitter.emit('websocketMessage', {
        id: this._socketId,
        type: 'text',
        data: JSON.stringify(message),
      });
    }

    send(raw) {
      this.sent.push(JSON.parse(raw));
    }

    close() {
      this.readyState = ReactNativeRawSocket.CLOSED;
      nativeEmitter.emit('websocketClosed', {
        id: this._socketId,
        code: 1000,
        reason: 'fixture',
      });
    }
  }

  const events = [];
  const sandbox = {
    module: { exports: {} },
    exports: {},
    WebSocket: ReactNativeRawSocket,
    __fixturePlatform: { OS: 'android' },
    __fixtureDeviceEventEmitter: nativeEmitter,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'android-app/lib/relay.js' });
  const client = new sandbox.module.exports.RelayClient(message => events.push(message));
  await client.connect();
  const socket = ReactNativeRawSocket.latest;
  assert(socket, 'React Native raw-emitter fixture did not construct a socket');
  assert.strictEqual(listenerRegistrations, 4,
    'React Native raw-emitter path did not register the four socket lifecycle events');
  assert.strictEqual(socket.eventTargetRegistrations, 0,
    'React Native raw-emitter fixture incorrectly selected EventTarget handlers');
  nativeEmitter.emit('websocketOpen', { id: socket._socketId + 1, protocol: '' });
  assert.strictEqual(socket.sent.length, 0, 'another native socket id leaked into this client');
  socket.open();
  assert.strictEqual(socket.readyState, ReactNativeRawSocket.OPEN,
    'raw native open did not promote the wrapper readyState before the handshake');
  const hellos = socket.sent.filter(message => message.type === 'connection_hello');
  assert.strictEqual(hellos.length, 1, 'React Native raw open did not send one handshake');
  socket.receive({
    type: 'connection_ack',
    sessions: [{ session_id: 'react-native-raw-session', agent_type: 'codex_cli' }],
  });
  assert.strictEqual(events.filter(message => message.type === 'connection_ack').length, 1,
    'React Native raw message was not delivered exactly once');
  assert(events.some(message => message.type === 'connection_ack'
    && message.sessions?.[0]?.session_id === 'react-native-raw-session'),
  'React Native raw message did not deliver the authoritative inventory');
  client.disconnect();
  assert.strictEqual(nativeEmitter.activeListenerCount(), 0,
    'React Native raw socket listeners survived disconnect');
  return {
    raw_emitter_open_recovered: true,
    raw_emitter_message_recovered: true,
    raw_emitter_socket_id_leaks: 0,
    raw_emitter_ready_state_promoted: true,
    raw_emitter_listener_registrations: listenerRegistrations,
    raw_emitter_active_listeners_after_disconnect: nativeEmitter.activeListenerCount(),
    raw_emitter_connection_hello_count: hellos.length,
    raw_emitter_event_target_registrations: socket.eventTargetRegistrations,
    platform_native_detection_without_navigator: true,
  };
}

async function verifyReactNativeEventTargetRecovery() {
  let source = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8')
    .replace(/import \{ getStoredJwt, RELAY_URL \} from '\.\/auth';/,
      "const getStoredJwt = async () => 'fixture-jwt'; const RELAY_URL = 'https://relay.fixture';")
    .replace(/import \{ estimateRelayClockOffset \} from '\.\/latency-clock';/,
      "const estimateRelayClockOffset = () => ({ ok: false, code: 'unused' });")
    .replace(/import \{ DeviceEventEmitter, Platform(?:, unstable_batchedUpdates)? \} from 'react-native';/,
      "const DeviceEventEmitter = globalThis.__fixtureDeviceEventEmitter; const Platform = globalThis.__fixturePlatform || { OS: 'web' }; const unstable_batchedUpdates = callback => callback();")
    .replace('export function classifyRelayRtt', 'function classifyRelayRtt')
    .replace('export class RelayClient', 'class RelayClient');
  source += '\nmodule.exports = { RelayClient };';

  let nativeEmitterRegistrations = 0;
  const inertNativeEmitter = {
    addListener() {
      nativeEmitterRegistrations += 1;
      return { remove() {} };
    },
  };

  class ReactNativeEventTargetSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this._socketId = 91;
      this.readyState = ReactNativeEventTargetSocket.CONNECTING;
      this.sent = [];
      this.listeners = new Map();
      ReactNativeEventTargetSocket.latest = this;
    }

    addEventListener(type, listener) {
      const typeListeners = this.listeners.get(type) || new Set();
      typeListeners.add(listener);
      this.listeners.set(type, typeListeners);
    }

    emit(type, event) {
      for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    }

    open() {
      this.readyState = ReactNativeEventTargetSocket.OPEN;
      this.emit('open', {});
    }

    receive(message) {
      this.emit('message', { data: JSON.stringify(message) });
    }

    send(raw) {
      this.sent.push(JSON.parse(raw));
    }

    close() {
      this.readyState = ReactNativeEventTargetSocket.CLOSED;
      this.emit('close', { code: 1000, reason: 'fixture' });
    }
  }

  const events = [];
  const sandbox = {
    module: { exports: {} },
    exports: {},
    WebSocket: ReactNativeEventTargetSocket,
    __fixturePlatform: { OS: 'android' },
    __fixtureDeviceEventEmitter: inertNativeEmitter,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'android-app/lib/relay.js' });
  const client = new sandbox.module.exports.RelayClient(message => events.push(message));
  await client.connect();
  const socket = ReactNativeEventTargetSocket.latest;
  assert(socket, 'React Native EventTarget fixture did not construct a socket');
  socket.open();
  await sleep(20);
  const hellos = socket.sent.filter(message => message.type === 'connection_hello');
  assert.strictEqual(hellos.length, 1,
    'React Native EventTarget open did not send one handshake');
  const inventory = Array.from({ length: 96 }, (_, index) => ({
    session_id: `react-native-event-target-session-${String(index).padStart(3, '0')}`,
    agent_type: 'codex_cli',
    activity: { kind: index % 2 === 0 ? 'working' : 'idle' },
  }));
  socket.receive({
    type: 'connection_ack',
    sessions: inventory,
  });
  const listStatusFanout = events.filter(message => message.type === 'status').length;
  const heartbeatStartedAfterInventoryYield =
    !socket.sent.some(message => message.type === 'heartbeat');
  await sleep(10);
  const heartbeat = socket.sent.find(message => message.type === 'heartbeat');
  assert(heartbeat?.request_id, 'React Native EventTarget client did not start its heartbeat');
  const summaryFrames = 1_000;
  for (let index = 0; index < summaryFrames; index += 1) {
    socket.receive({
      type: 'session_summary',
      session_id: inventory[index % inventory.length].session_id,
      state_seq: index + 1,
      activity: { kind: index % 2 === 0 ? 'working' : 'idle' },
      unread_delta: 1,
    });
  }
  socket.receive({
    type: 'heartbeat_ack',
    request_id: heartbeat.request_id,
    relay_received_at_ms: Date.now(),
    relay_sent_at_ms: Date.now(),
  });
  const heartbeatHealthIndex = events.findIndex(message =>
    message.type === '_connection_health' && message.state !== 'connecting');
  const firstSummaryIndexBeforeFlush = events.findIndex(message => message.type === 'session_summary');
  const heartbeatAckPreemptedSummaries = heartbeatHealthIndex >= 0
    && (firstSummaryIndexBeforeFlush === -1 || heartbeatHealthIndex < firstSummaryIndexBeforeFlush);
  await sleep(150);
  const deliveredSummaries = events.filter(message => message.type === 'session_summary');
  client.disconnect();
  assert(heartbeatStartedAfterInventoryYield,
    'first heartbeat sampled synchronous inventory render work as relay RTT');
  assert(heartbeatAckPreemptedSummaries,
    'summary callbacks blocked the heartbeat acknowledgement');
  assert.strictEqual(deliveredSummaries.length, inventory.length,
    'summary coalescer did not emit exactly one latest frame per session');
  assert.strictEqual(
    deliveredSummaries.reduce((sum, message) => sum + Number(message.unread_delta || 0), 0),
    summaryFrames,
    'summary coalescer dropped or duplicated unread deltas',
  );
  assert.strictEqual(events.filter(message => message.type === 'connection_ack').length, 1,
    'React Native EventTarget message was not delivered exactly once');
  assert(events.some(message => message.type === 'connection_ack'
    && message.sessions?.[0]?.session_id === 'react-native-event-target-session-000'),
  'React Native EventTarget message did not deliver the authoritative inventory');
  assert.strictEqual(listStatusFanout, 0,
    'unsubscribed list client received per-session status fanout from its authoritative inventory');
  assert.strictEqual(nativeEmitterRegistrations, 0,
    'React Native EventTarget socket incorrectly selected the raw emitter path');

  const selectedEvents = [];
  const selectedClient = new sandbox.module.exports.RelayClient(message => selectedEvents.push(message));
  selectedClient.setSessionSubscriptions(['react-native-event-target-session-042']);
  await selectedClient.connect();
  const selectedSocket = ReactNativeEventTargetSocket.latest;
  selectedSocket.open();
  selectedSocket.receive({ type: 'connection_ack', sessions: inventory });
  const selectedStatuses = selectedEvents.filter(message => message.type === 'status');
  assert.strictEqual(selectedStatuses.length, 1,
    'selected chat did not receive exactly one initial activity projection');
  assert.strictEqual(selectedStatuses[0].session, 'react-native-event-target-session-042');
  selectedClient.disconnect();
  return {
    event_target_open_recovered: true,
    event_target_message_recovered: true,
    event_target_connection_hello_count: hellos.length,
    event_target_native_emitter_registrations: nativeEmitterRegistrations,
    list_inventory_session_count: inventory.length,
    list_inventory_status_fanout: 0,
    selected_chat_status_fanout: selectedStatuses.length,
    summary_frames_received: summaryFrames,
    summary_callbacks_delivered: deliveredSummaries.length,
    heartbeat_ack_preempted_summary_callbacks: true,
    first_heartbeat_started_after_inventory_yield: true,
  };
}

async function verifyHydrationSequences() {
  const source = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'session-hydration.js'), 'utf8');
  const hydration = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (let index = 0; index < 1_000; index += 1) {
    const startedAt = 100_000 + index;
    let state = hydration.createSessionHydrationState(startedAt);
    state = hydration.advanceSessionHydration(state, { type: 'socket_open' }, startedAt + 1);
    const timedOut = hydration.advanceSessionHydration(
      state, { type: 'timeout' }, state.deadlineAtMs,
    );
    assert.strictEqual(timedOut.phase, 'timed_out');
    assert.strictEqual(hydration.sessionHydrationPresentation(timedOut).retryable, true);
    const retried = hydration.advanceSessionHydration(timedOut, { type: 'retry' }, startedAt + 20_000);
    const ready = hydration.advanceSessionHydration(
      retried, { type: 'inventory', sessionCount: index % 37 }, startedAt + 20_001,
    );
    assert.strictEqual(ready.phase, 'ready');
    assert.strictEqual(
      hydration.advanceSessionHydration(ready, { type: 'timeout' }, startedAt + 100_000),
      ready,
    );
  }
  return {
    sequences: 1_000,
    bounded_timeout_ms: hydration.SESSION_HYDRATION_TIMEOUT_MS,
    ready_state_regressions: 0,
  };
}

async function stopRelay(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3_000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const port = await freePort();
  const logs = [];
  const relay = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'index.js')], {
    cwd: ROOT,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'android-hydration-session-secret-0123456789',
      JWT_SECRET: 'android-hydration-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: DATA_DIR,
      GOOGLE_CLIENT_ID: 'android-hydration-client',
      GOOGLE_CLIENT_SECRET: 'android-hydration-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => logs.push(String(chunk)));
  relay.stderr.on('data', chunk => logs.push(String(chunk)));

  try {
    await waitForHealth(port);
    const result = {
      ok: true,
      relay: await verifyRelayReplay(port),
      native_client: {
        ...await verifyFastOpenClientRecovery(),
        ...await verifyReactNativePropertyHandlerRecovery(),
        ...await verifyReactNativeRawEmitterRecovery(),
        ...await verifyReactNativeEventTargetRecovery(),
      },
      hydration: await verifyHydrationSequences(),
      model: 'none',
      effort: 'none',
      model_calls: 0,
      visible_windows_opened: 0,
      protected_session_mutations: 0,
    };
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(logs.join('').slice(-8_000));
    throw error;
  } finally {
    await stopRelay(relay);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
