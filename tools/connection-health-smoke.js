#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('../frontend/node_modules/esbuild');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;

function timerHarness() {
  const timers = new Map();
  let sequence = 0;
  return {
    timers,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay, interval: false });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    runTimeout(delay) {
      const entry = [...timers.entries()].find(([, value]) => !value.interval && value.delay === delay);
      assert(entry, `missing ${delay} ms timeout`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    runInterval(delay) {
      const entry = [...timers.values()].find(value => value.interval && value.delay === delay);
      if (!entry) return false;
      entry.callback();
      return true;
    },
  };
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code: 1006, reason: 'fixture' }); }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

class NativeEventWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    NativeEventWebSocket.instances.push(this);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, event = {}) {
    this[`on${type}`]?.(event);
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  open() { this.readyState = NativeEventWebSocket.OPEN; this.dispatch('open'); }
  openWithoutEvent() { this.readyState = NativeEventWebSocket.OPEN; }
  close() {
    this.readyState = NativeEventWebSocket.CLOSED;
    this.dispatch('close', { code: 1006, reason: 'fixture' });
  }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  receive(message) { this.dispatch('message', { data: JSON.stringify(message) }); }
  receiveRaw(data) { this.dispatch('message', { data }); }
}

function createReact(timers) {
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  return {
    states,
    api: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }];
      },
      useRef(initial) {
        const index = refIndex++;
        if (!refs[index]) refs[index] = { current: initial };
        return refs[index];
      },
      useCallback(callback) { return callback; },
      useEffect(callback) { callback(); },
    },
    resetRender() { stateIndex = 0; refIndex = 0; },
  };
}

async function main() {
  const timers = timerHarness();
  const React = createReact(timers);
  const builtHooks = esbuild.buildSync({
    entryPoints: [path.join(root, 'frontend', 'hooks.jsx')],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const hookModule = { exports: {} };
  const hookContext = vm.createContext({
    module: hookModule, exports: hookModule.exports, React: React.api,
    WebSocket: FakeWebSocket,
    location: { protocol: 'https:', host: 'agent-chat.test' },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    requestAnimationFrame: callback => callback(), cancelAnimationFrame() {},
    console,
  });
  vm.runInContext(builtHooks.outputFiles[0].text, hookContext, { filename: 'hooks.bundle.cjs' });
  const preservedHistory = hookModule.exports.preserveOptimisticMessagesAcrossHistory(
    [{ role: 'assistant', content: 'authoritative', sequence: 5 }],
    [{ role: 'user', content: 'offline', _cid: 'offline-cid', _optimistic: true }],
  );
  assert.equal(preservedHistory.length, 2, 'reconnect history replacement dropped an optimistic offline message');
  assert.equal(preservedHistory[1]._cid, 'offline-cid');
  const relay = hookModule.exports.useRelay();
  const firstSocket = FakeWebSocket.instances[0];
  firstSocket.open();
  firstSocket.receive({
    type: 'connection_ack', heartbeat_interval_ms: 10000, heartbeat_timeout_ms: 30000,
    sessions: [], workspaces: [],
  });
  const firstHeartbeat = firstSocket.sent.find(message => message.type === 'heartbeat');
  assert(firstHeartbeat?.request_id, 'web client did not send documented heartbeat');
  firstSocket.receive({ type: 'heartbeat_ack', request_id: firstHeartbeat.request_id, server_ts: new Date().toISOString() });
  assert(React.states.some(value => value?.state === 'healthy' && Number.isFinite(value.rttMs)), 'web RTT did not reach visible healthy state');

  firstSocket.close();
  timers.runTimeout(250);
  const secondSocket = FakeWebSocket.instances[1];
  const cid = relay.sendToSession('offline-fixture', 'queue while offline');
  assert(cid, 'web offline send did not return a correlation id');
  assert(!secondSocket.sent.some(message => message.type === 'send'), 'web sent before the socket reconnected');
  assert(React.states.some(value => value?.[cid] === 'offline_queued'), 'web did not expose offline_queued receipt state');
  secondSocket.open();
  assert(!secondSocket.sent.some(message => message.type === 'send'), 'web flushed before connection_ack');
  secondSocket.receive({
    type: 'connection_ack', heartbeat_interval_ms: 10000, heartbeat_timeout_ms: 30000,
    sessions: [], workspaces: [],
  });
  const flushed = secondSocket.sent.find(message => message.type === 'send');
  assert.equal(flushed?.client_message_id, cid, 'web offline flush changed the client_message_id');
  assert.equal(flushed?.content, 'queue while offline');

  const androidPath = path.join(root, 'android-app', 'lib', 'relay.js');
  const androidSource = fs.readFileSync(androidPath, 'utf8').replace(
    "import { getStoredJwt, RELAY_URL } from './auth';",
    "const getStoredJwt = async () => 'fixture-jwt'; const RELAY_URL = 'http://relay.test';",
  ).replace(
    "import { estimateRelayClockOffset } from './latency-clock';",
    "const estimateRelayClockOffset = () => ({ ok: false, code: 'fixture_clock_unavailable' });",
  ).replace(
    /import \{ DeviceEventEmitter, Platform(?:, unstable_batchedUpdates)? \} from 'react-native';/,
    "const DeviceEventEmitter = undefined; const Platform = { OS: 'web' }; const unstable_batchedUpdates = callback => callback();",
  );
  const transformedAndroid = esbuild.transformSync(androidSource, { loader: 'js', format: 'cjs', target: 'es2020' });
  const androidModule = { exports: {} };
  const androidTimers = timerHarness();
  const androidEvents = [];
  let androidNowMs = Date.now();
  class AndroidFixtureDate extends Date {
    static now() { return androidNowMs; }
  }
  const androidContext = vm.createContext({
    module: androidModule, exports: androidModule.exports, WebSocket: NativeEventWebSocket,
    setTimeout: androidTimers.setTimeout, clearTimeout: androidTimers.clearTimeout,
    setInterval: androidTimers.setInterval, clearInterval: androidTimers.clearInterval,
    console, URL, encodeURIComponent, Date: AndroidFixtureDate,
  });
  vm.runInContext(transformedAndroid.code, androidContext, { filename: 'android-relay.cjs' });
  assert.equal(androidModule.exports.classifyRelayRtt(25), 'healthy');
  assert.equal(androidModule.exports.classifyRelayRtt(750), 'slow');
  assert.equal(androidModule.exports.classifyRelayRtt(2500), 'poor');
  const androidClient = new androidModule.exports.RelayClient(message => androidEvents.push(message));
  await androidClient.connect();
  const androidSocket = NativeEventWebSocket.instances.at(-1);
  assert(androidSocket, `Android did not construct a native EventTarget socket: ${JSON.stringify(androidEvents)}`);
  androidSocket.open();
  androidSocket.receive({
    type: 'connection_ack', heartbeat_interval_ms: 10000, heartbeat_timeout_ms: 30000,
    sessions: [],
  });
  assert(!androidSocket.sent.some(message => message.type === 'heartbeat'),
    'Android sampled heartbeat RTT before yielding connection state');
  androidTimers.runTimeout(0);
  androidTimers.runTimeout(0);
  const androidHeartbeat = androidSocket.sent.find(message => message.type === 'heartbeat');
  assert(androidHeartbeat?.request_id, 'Android client did not send documented heartbeat');
  assert(!androidSocket.sent.some(message => message.type === 'ping'), 'Android retained the unacknowledged legacy ping');
  androidSocket.receive({ type: 'heartbeat_ack', request_id: androidHeartbeat.request_id });
  assert(androidEvents.some(message => message.type === '_connection_health' && message.state === 'healthy'), 'Android did not emit RTT health');
  androidSocket.receiveRaw('{');
  assert(androidEvents.some(message => message.type === '_transport_diagnostic'
    && message.reason === 'malformed_frame'), 'Android silently dropped an invalid relay frame');

  const recoveredEvents = [];
  const recoveredClient = new androidModule.exports.RelayClient(message => recoveredEvents.push(message));
  await recoveredClient.connect();
  const recoveredSocket = NativeEventWebSocket.instances.at(-1);
  androidTimers.runTimeout(0);
  recoveredSocket.openWithoutEvent();
  assert(androidTimers.runInterval(250),
    'Android relay client has no bounded native socket-open watchdog');
  assert(recoveredEvents.some(message => message.type === '_connected'),
    'Android did not recover a native socket that opened after the zero-delay probe');
  assert.equal(recoveredEvents.filter(message => message.type === '_connected').length, 1,
    'Android emitted more than one connected transition for one native socket');
  assert(recoveredSocket.sent.some(message => message.type === 'connection_hello'
    && message.request_connection_ack === true),
  'Android open recovery did not request an authoritative session inventory');

  const stalledEvents = [];
  const stalledClient = new androidModule.exports.RelayClient(message => stalledEvents.push(message));
  await stalledClient.connect();
  const stalledSocket = NativeEventWebSocket.instances.at(-1);
  androidNowMs += 15_001;
  assert(androidTimers.runInterval(250), 'Android open timeout watchdog was not armed');
  assert(stalledEvents.some(message => message.type === '_disconnected'
    && message.reason === 'relay_open_timeout'), 'Android did not bound a stalled relay connection');
  assert.equal(stalledSocket.readyState, NativeEventWebSocket.CLOSED,
    'Android left the timed-out native socket open');

  const appSource = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
  const stylesSource = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
  const chatSource = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
  const listSource = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  const bubbleSource = fs.readFileSync(path.join(root, 'android-app', 'components', 'MessageBubble.jsx'), 'utf8');
  const protocol = fs.readFileSync(path.join(root, 'protocol.md'), 'utf8');
  assert(/Relay \$\{relayHealthState\}/.test(appSource)
    && /sidebar-footer-rtt[^]*?relayRttText/.test(appSource), 'web RTT is not visible');
  assert(/Queue until reconnected/.test(appSource), 'web composer does not advertise offline queueing');
  const composerDisabled = /disabled=\{([^}]+)\}\s*rows=\{1\}/.exec(appSource)?.[1] || '';
  assert(composerDisabled.includes('!activeSession')
    && composerDisabled.includes('!!activeBlockingPrompt')
    && composerDisabled.includes('activeCodexDesktopThreadDetached'),
  'web textarea is missing a native blocking condition');
  assert(!/\bconnected\b/.test(composerDisabled), 'web textarea is still disabled while offline');
  assert(/offline-queued/.test(stylesSource), 'web offline receipt has no styling');
  assert(/Relay \$\{connectionHealth\.state\}/.test(chatSource) && /Relay \$\{connectionHealth\.state\}/.test(listSource), 'Android RTT state is not visible on both screens');
  assert(/offline_queued[^\n]+Queued offline/.test(bubbleSource), 'Android offline receipt is not explicit');
  assert(/same\s+`client_message_id`[\s\S]{0,180}receipt/.test(protocol), 'protocol does not preserve offline-send correlation');

  const result = {
    ok: true,
    web_heartbeat_type: firstHeartbeat.type,
    web_rtt_visible: true,
    web_offline_queue_correlation_id: cid,
    web_flush_after_connection_ack: true,
    android_heartbeat_type: androidHeartbeat.type,
    android_legacy_ping_removed: true,
    android_event_target_transport: true,
    android_delayed_open_recovered_exactly_once: true,
    android_open_timeout_ms: 15000,
    android_malformed_frame_diagnostic: true,
    rtt_tones: ['healthy', 'slow', 'poor'],
    checks: 30,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`connection health smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
