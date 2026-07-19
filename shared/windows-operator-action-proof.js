'use strict';

const crypto = require('crypto');
const policy = require('./windows-automation-launch-policy.json');

function createRelayOperatorActionProof({ action, requestId, channel, nowMs = Date.now() } = {}) {
  return {
    kind: 'relay_operator_action',
    policy_id: policy.policy_id,
    classification: policy.operator_action.classification,
    action,
    request_id: requestId,
    channel,
    authenticated: true,
    user_gesture: true,
    issued_at_ms: nowMs,
    nonce: crypto.randomUUID(),
  };
}

module.exports = { createRelayOperatorActionProof };
