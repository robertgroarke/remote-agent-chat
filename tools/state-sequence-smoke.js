#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webPath = path.join(root, 'frontend', 'state-sequence.js');
const androidPath = path.join(root, 'android-app', 'lib', 'state-sequence.js');
const webSource = fs.readFileSync(webPath, 'utf8');
const androidSource = fs.readFileSync(androidPath, 'utf8');
assert.strictEqual(androidSource, webSource, 'web and Android state-sequence gates must remain byte-identical');

const executable = `${webSource
  .replace(/export\s+function\s+/g, 'function ')}
return { createStateSequenceGate };`;
const { createStateSequenceGate } = Function(executable)();
const gate = createStateSequenceGate();

gate.reset('epoch-a');
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 3 }, 'session_list'), true);
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 2 }, 'session_list'), false);
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 4 }, 'session_list'), true);
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 2 }, 'status:one'), true,
  'independent state keys must not share their greatest sequence');
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 2 }, 'status:one'), false);
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 1 }, 'status:two'), true);
gate.reset('epoch-b');
assert.strictEqual(gate.accept({ state_epoch: 'epoch-b', state_seq: 1 }, 'session_list'), true,
  'new relay epochs must reset prior sequence ceilings');
assert.strictEqual(gate.accept({ state_epoch: 'epoch-a', state_seq: 999 }, 'session_list'), false,
  'an event from an old relay epoch must not roll the gate backward');
assert.strictEqual(gate.accept({ type: 'status' }, 'status:legacy'), true,
  'legacy unsequenced events must remain compatible');

const relay = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
const hooks = fs.readFileSync(path.join(root, 'frontend', 'hooks.jsx'), 'utf8');
const androidList = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const androidChat = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const build = fs.readFileSync(path.join(root, 'frontend', 'build.js'), 'utf8');
assert(relay.includes('STATUS_BROADCAST_COALESCE_MS = 50')
  && relay.includes('SESSION_LIST_BROADCAST_COALESCE_MS = 250'),
  'relay must retain bounded coalescing windows');
assert(relay.includes('queueStatusBroadcast(statusMsg)')
  && relay.includes('queueSessionListBroadcast()'),
  'relay state hot paths must use the coalescing queues');
assert(relay.includes('state_epoch: RELAY_STATE_EPOCH') && relay.includes('state_seq: relayStateSeq'),
  'relay state events must carry epoch and monotonic sequence fields');
assert(hooks.includes('createStateSequenceGate') && hooks.includes('stateSequenceGate.current.accept'),
  'web client must reject stale state events');
assert(androidList.includes('stateSequenceGateRef.current.accept')
  && androidChat.includes('stateSequenceGateRef.current.accept'),
  'both Android state consumers must reject stale state events');
assert(build.includes("'state-sequence.js'"), 'frontend build must sync the state sequence module');

console.log(JSON.stringify({
  ok: true,
  clients: ['web', 'android'],
  session_list_coalesce_ms: 250,
  status_coalesce_ms: 50,
  latest_wins: true,
  per_key_stale_rejection: true,
  relay_epoch_reset: true,
  legacy_compatibility: true,
}, null, 2));
