'use strict';

const assert = require('assert');
const {
  MAX_BROADCAST_SESSIONS,
  normalizeBroadcastRequest,
  createBroadcastReceiptState,
  reduceBroadcastReceipt,
  sessionSupportsBroadcast,
} = require('../relay-server/broadcast-send-policy');

const ids = ['claude-1', 'codex-1', 'cursor-1'];
const confirmation = 'SEND TO 3 SESSIONS';
const valid = normalizeBroadcastRequest({ session_ids: ids, content: 'Review the current changes.', confirmation });
assert(valid.ok);
assert.deepEqual(valid.sessionIds, ids);
assert.equal(normalizeBroadcastRequest({ session_ids: ids, content: 'x', confirmation: 'SEND' }).ok, false);
assert.equal(normalizeBroadcastRequest({ session_ids: [], content: 'x', confirmation: 'SEND TO 0 SESSIONS' }).ok, false);
assert.equal(normalizeBroadcastRequest({ session_ids: Array.from({ length: MAX_BROADCAST_SESSIONS + 1 }, (_, i) => `s${i}`), content: 'x', confirmation: 'x' }).ok, false);
const gated = normalizeBroadcastRequest({ session_ids: ids, content: 'x', confirmation }, id => id !== 'codex-1');
assert.deepEqual(gated.unsupported, ['codex-1']);
assert.equal(sessionSupportsBroadcast({ session_id: 's1', agent_type: 'codex_cli' }, {}, 'healthy', true), true);
assert.equal(sessionSupportsBroadcast({ session_id: 's1', agent_type: 'unknown' }, {}, 'healthy', true), false);
assert.equal(sessionSupportsBroadcast({ session_id: 's1', agent_type: 'codex_cli', is_list_view: true }, {}, 'healthy', true), false);
assert.equal(sessionSupportsBroadcast({ session_id: 's1', agent_type: 'codex_cli' }, { capabilities: { send_message: false } }, 'healthy', true), false);
assert.equal(sessionSupportsBroadcast({ session_id: 's1', agent_type: 'codex_cli' }, {}, 'disconnected', true), false);

let state = createBroadcastReceiptState(ids);
state = reduceBroadcastReceipt(state, { session_id: 'claude-1', status: 'accepted' });
state = reduceBroadcastReceipt(state, { session_id: 'claude-1', status: 'delivered' });
state = reduceBroadcastReceipt(state, { session_id: 'claude-1', status: 'agent_started' });
state = reduceBroadcastReceipt(state, { session_id: 'codex-1', status: 'failed', error: 'native target unavailable' });
assert.equal(state['claude-1'].status, 'agent_started');
assert.equal(state['codex-1'].status, 'failed');
assert.equal(state['cursor-1'].status, 'queued');

console.log(JSON.stringify({
  ok: true,
  max_sessions: MAX_BROADCAST_SESSIONS,
  exact_count_confirmation: true,
  deduplicated_selection: true,
  capability_gate: true,
  harness_capability_gate: true,
  per_session_receipts: state,
}, null, 2));
